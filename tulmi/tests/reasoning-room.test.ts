/**
 * THE THINKING COMES OUT OF THE ANSWER'S TOKEN CAP (src/agent/reasoning.ts, agent/llm.ts, code/brain/gateway.ts, pipeline/cleanup.ts).
 *
 * The second real-model test: minimax-m3.1-flash, which cannot think less than "low", was given `max_tokens: 250` for a one-line answer and spent all of it
 * thinking: `finish_reason: "length"`, `content: null`, a failed call. Any small call (classifier, front door, a short role) on a model that must think could
 * come back empty. What these hold down, on all three paths that talk to a model:
 *   - a model that must think is given an allowance on top of the answer's limit, by the effort sent; a model that thinks "none" is given nothing extra;
 *   - an answer that comes back empty for "length" is asked for once more, on the same model, with a larger allowance, before the ladder moves on;
 *   - that retry is once, only for "length", and a budget that cannot cover it leaves the ladder to climb as it always did;
 *   - the writer path (cleanup.ts) sends the model's own reasoning, no longer "none" to everyone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

type Said = { text: string; finish?: string } | Error;
const llm = vi.hoisted(() => ({ calls: [] as Array<Record<string, any>>, script: [] as unknown[] }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: Record<string, any>) => {
          llm.calls.push(structuredClone(body));
          const r = (llm.script.length > 1 ? llm.script.shift() : llm.script[0]) as { text: string; finish?: string } | Error;
          if (r instanceof Error) throw r;
          const finish = r.finish ?? "stop";
          if (body.stream) {
            return (async function* () {
              yield { choices: [{ delta: r.text ? { content: r.text } : {}, finish_reason: r.text ? null : finish }], provider: "Fake Cloud" };
              yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } };
            })();
          }
          return { choices: [{ message: { content: r.text || null }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.0001 } };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const R = await import("../src/agent/reasoning.js");
const { plannerRequest, planStream, AGENT_MAX_TOKENS } = await import("../src/agent/llm.js");
const { callModel, ModelUnavailable } = await import("../src/code/brain/gateway.js");
const { buildTierTable, resetTierTableForTests } = await import("../src/code/brain/tiers.js");
const { assist } = await import("../src/pipeline/cleanup.js");
const { resetConfigForTests } = await import("../src/config.js");
type Gateway = import("../src/code/brain/gateway.js").GatewayDeps;

const MINIMAX = "minimax/minimax-m3.1-flash";
const SAY = (text: string): Said => ({ text });
const CUT: Said = { text: "", finish: "length" };

beforeEach(() => {
  R.resetReasoningForTests();
  resetTierTableForTests();
  llm.calls.length = 0;
  llm.script = [];
  delete process.env.CLEANUP_MODEL;
  resetConfigForTests();
});

// ------------------------------------------------------------------ the arithmetic

describe("room for the thinking", () => {
  it("adds the allowance of the effort sent, nothing when thinking is off", () => {
    expect(R.maxTokensWithReasoning(250, { effort: "low" })).toBe(250 + R.REASONING_ALLOWANCE.low);
    expect(R.maxTokensWithReasoning(250, { effort: "minimal" })).toBe(250 + R.REASONING_ALLOWANCE.minimal);
    expect(R.maxTokensWithReasoning(250, { effort: "high" })).toBe(250 + R.REASONING_ALLOWANCE.high);
    expect(R.maxTokensWithReasoning(250, { effort: "none" })).toBe(250);
    expect(R.maxTokensWithReasoning(250, { effort: "none", enabled: false })).toBe(250);
    expect(R.maxTokensWithReasoning(250, undefined)).toBe(250);
  });

  it("a retry gives more, and at least as much as 'low' would, whatever was sent", () => {
    expect(R.maxTokensWithReasoning(250, { effort: "low" }, { retry: true })).toBe(250 + R.REASONING_ALLOWANCE.low * R.RETRY_FACTOR);
    expect(R.maxTokensWithReasoning(250, { effort: "high" }, { retry: true })).toBe(250 + R.REASONING_ALLOWANCE.high * R.RETRY_FACTOR);
    expect(R.maxTokensWithReasoning(250, { effort: "none" }, { retry: true })).toBe(250 + R.REASONING_ALLOWANCE.low * R.RETRY_FACTOR);
  });
});

// ------------------------------------------------------------------ the planner (agent/llm.ts)

describe("the planner's request", () => {
  it("gives a model that must think room on top of its limit, and every other model the limit it had", () => {
    const body = (m: string) => plannerRequest(m, "sys", "u") as Record<string, any>;
    expect(body(MINIMAX).max_tokens).toBe(AGENT_MAX_TOKENS + R.REASONING_ALLOWANCE.low);
    expect(body(MINIMAX).reasoning).toEqual({ effort: "low" });
    expect(body("deepseek/deepseek-v4.1-flash").max_tokens).toBe(AGENT_MAX_TOKENS);
    expect(body("anthropic/claude-haiku-5.5").max_tokens).toBe(AGENT_MAX_TOKENS);
    expect((plannerRequest(MINIMAX, "sys", "u", AGENT_MAX_TOKENS, { bigger: true }) as Record<string, any>).max_tokens).toBe(AGENT_MAX_TOKENS + R.REASONING_ALLOWANCE.low * R.RETRY_FACTOR);
  });
});

describe("the planner's stream", () => {
  const write = async (models: string[]) => {
    let out = "";
    for await (const c of planStream("sys", "u", { models, timeoutMs: 1000 })) out += c.delta;
    return out;
  };

  it("a model that thought through its whole limit is asked again at once with more room, and the ladder does not climb", async () => {
    llm.script = [CUT, SAY("SAY hi\nDONE")];
    expect(await write([MINIMAX, "other/model"])).toBe("SAY hi\nDONE");
    expect(llm.calls.map((c) => c.model)).toEqual([MINIMAX, MINIMAX]);
    expect(llm.calls[0]!.max_tokens).toBe(AGENT_MAX_TOKENS + R.REASONING_ALLOWANCE.low);
    expect(llm.calls[1]!.max_tokens).toBe(AGENT_MAX_TOKENS + R.REASONING_ALLOWANCE.low * R.RETRY_FACTOR);
  });

  it("only once: a second empty 'length' moves on to the next model", async () => {
    llm.script = [CUT, CUT, SAY("SAY ok")];
    expect(await write([MINIMAX, "other/model"])).toBe("SAY ok");
    expect(llm.calls.map((c) => c.model)).toEqual([MINIMAX, MINIMAX, "other/model"]);
  });

  it("an empty answer that did not run out of room is not asked again on the same model", async () => {
    llm.script = [{ text: "", finish: "stop" }, SAY("SAY ok")];
    expect(await write([MINIMAX, "other/model"])).toBe("SAY ok");
    expect(llm.calls.map((c) => c.model)).toEqual([MINIMAX, "other/model"]);
  });
});

// ------------------------------------------------------------------ the gateway (code/brain/gateway.ts)

const tiers = (over: Record<string, unknown> = {}) => buildTierTable({
  tiers: JSON.stringify({ tiny: { models: [MINIMAX, "deepseek/deepseek-v4.1-flash"], maxTokens: 250, reasoning: "none", timeoutMs: 5000, usdPerMIn: 1, usdPerMOut: 2, ...over } }),
});

/** A fake OpenRouter for the gateway: answers from a script (the last repeating) and writes down the bodies. */
function client(script: Array<Record<string, unknown> | Error>) {
  const calls: Array<Record<string, any>> = [];
  let i = 0;
  return {
    calls,
    chat: {
      completions: {
        create: async (body: Record<string, any>) => {
          calls.push(structuredClone(body));
          const r = script[Math.min(i, script.length - 1)]!;
          i += 1;
          if (r instanceof Error) throw r;
          return r;
        },
      },
    },
  };
}
const usage = { prompt_tokens: 100, completion_tokens: 250, cost: 0.0001 };
const cut = { choices: [{ message: { content: null }, finish_reason: "length" }], usage };
const said = (text: string) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage });
const deps = (c: ReturnType<typeof client>, over: Partial<Gateway> = {}): Gateway => ({
  client: c, tiers: tiers(), fx: 88, ledger: null, log: { info: () => undefined, warn: () => undefined }, breakers: null, sleep: async () => undefined, random: () => 0.5, ...over,
});
const ask = (over: Record<string, unknown> = {}) => ({ tier: "tiny" as const, messages: [{ role: "user" as const, content: "which road?" }], purpose: "test", budget: "none" as const, ...over });

describe("the gateway", () => {
  it("a small call on a model that must think keeps room to answer", async () => {
    const c = client([said("ok")]);
    const r = await callModel(ask(), deps(c));
    expect(r.text).toBe("ok");
    expect(c.calls[0]!.reasoning).toEqual({ effort: "low" });
    expect(c.calls[0]!.max_tokens).toBe(250 + R.REASONING_ALLOWANCE.low);
  });

  it("a model that can think 'none' is sent the limit the tier gave", async () => {
    const c = client([said("ok")]);
    await callModel(ask({ model: "deepseek/deepseek-v4.1-flash" }), deps(c));
    expect(c.calls[0]!.reasoning).toEqual({ effort: "none" });
    expect(c.calls[0]!.max_tokens).toBe(250);
  });

  it("a level the tier chose is not given an allowance: its limit was sized for it", async () => {
    const c = client([said("ok")]);
    await callModel(ask(), deps(c, { tiers: tiers({ reasoning: "medium", maxTokens: 4000 }) }));
    expect(c.calls[0]!.reasoning).toEqual({ effort: "medium" });
    expect(c.calls[0]!.max_tokens).toBe(4000);
  });

  it("empty for 'length' is asked again at once, on the same model, with a larger allowance", async () => {
    const c = client([cut, said("ok")]);
    const r = await callModel(ask(), deps(c));
    expect(r.text).toBe("ok");
    expect(c.calls.map((b) => b.model)).toEqual([MINIMAX, MINIMAX]);
    expect(c.calls[1]!.max_tokens).toBe(250 + R.REASONING_ALLOWANCE.low * R.RETRY_FACTOR);
    expect(r.trail).toEqual([{ model: MINIMAX, outcome: "ok", grown: true }]);
    expect(r.calls).toBe(2);
  });

  it("once only: when the larger try is empty too, the ladder climbs", async () => {
    const c = client([cut, cut, said("from the next")]);
    const r = await callModel(ask(), deps(c));
    expect(c.calls.map((b) => b.model)).toEqual([MINIMAX, MINIMAX, "deepseek/deepseek-v4.1-flash"]);
    expect(r.text).toBe("from the next");
    expect(r.trail.map((t) => t.outcome)).toEqual(["empty", "ok"]);
  });

  it("an empty answer that was not cut for length is not retried on the same model", async () => {
    const c = client([{ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage }, said("from the next")]);
    await callModel(ask(), deps(c));
    expect(c.calls.map((b) => b.model)).toEqual([MINIMAX, "deepseek/deepseek-v4.1-flash"]);
  });

  it("the budget is checked against the larger try: when it cannot pay for it, the ladder climbs instead of the call failing", async () => {
    // At $100 per million out, the first try's worst case (1,274 tokens in all) is about 1,121 paise; the larger try's (4,346 tokens) about 3,824.
    const c = client([cut, said("from the next")]);
    const r = await callModel(ask({ budget: { maxPaise: 2000 } }), deps(c, { tiers: tiers({ usdPerMOut: 100 }) }));
    expect(c.calls.map((b) => b.model)).toEqual([MINIMAX, "deepseek/deepseek-v4.1-flash"]);
    expect(r.text).toBe("from the next");
  });

  it("a ladder of one that runs out of room twice is ModelUnavailable", async () => {
    const c = client([cut]);
    await expect(callModel(ask({ model: MINIMAX, tier: undefined }), deps(c))).rejects.toBeInstanceOf(ModelUnavailable);
    expect(c.calls).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ the writer path (pipeline/cleanup.ts)

describe("the writer path", () => {
  it("sends a model that must think its lowest effort and room to answer, not 'none' and the bare limit", async () => {
    process.env.CLEANUP_MODEL = MINIMAX;
    resetConfigForTests();
    llm.script = [SAY("<send>See you at five.</send>")];
    expect(await assist("see you at five")).toBe("See you at five.");
    expect(llm.calls[0]!.model).toBe(MINIMAX);
    expect(llm.calls[0]!.reasoning).toEqual({ effort: "low" });
    expect(llm.calls[0]!.max_tokens).toBe(1024 + R.REASONING_ALLOWANCE.low);
  });

  it("an answer that ran out of room before a word is asked for again with a larger allowance", async () => {
    process.env.CLEANUP_MODEL = MINIMAX;
    resetConfigForTests();
    llm.script = [CUT, SAY("<send>See you at five.</send>")];
    expect(await assist("see you at five")).toBe("See you at five.");
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.max_tokens).toBe(1024 + R.REASONING_ALLOWANCE.low * R.RETRY_FACTOR);
  });

  it("a model that can think 'none' still is, with the limit unchanged", async () => {
    process.env.CLEANUP_MODEL = "deepseek/deepseek-v4.1-flash";
    resetConfigForTests();
    llm.script = [SAY("<send>See you at five.</send>")];
    await assist("see you at five");
    expect(llm.calls[0]!.reasoning).toEqual({ effort: "none" });
    expect(llm.calls[0]!.max_tokens).toBe(1024);
  });

  it("a model nothing was known about that answers 'Reasoning is mandatory' is asked again at its lowest effort, and remembered", async () => {
    process.env.CLEANUP_MODEL = "new/thinker";
    resetConfigForTests();
    llm.script = [Object.assign(new Error("Reasoning is mandatory for this endpoint and cannot be disabled."), { status: 400 }), SAY("<send>See you at five.</send>")];
    expect(await assist("see you at five")).toBe("See you at five.");
    expect(llm.calls.map((c) => c.reasoning)).toEqual([{ effort: "none" }, { effort: "low" }]);
    expect(R.reasoningRequired("new/thinker")).toBe(true);
  });
});

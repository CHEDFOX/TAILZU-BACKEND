/**
 * REASONING THAT CANNOT BE SWITCHED OFF (src/agent/reasoning.ts, agent/llm.ts reasoningFor, code/brain/gateway.ts).
 *
 * The first real-model test found six models that answered every call with "Reasoning is mandatory for this endpoint and cannot be disabled", because every
 * request said `reasoning: { effort: "none" }` (Anthropic's also `enabled: false`). What these hold down:
 *   - a model that requires reasoning is never sent "none" or `enabled: false`, by the planner's request or the gateway's, and is sent its lowest allowed effort;
 *   - what the catalog says (mandatory, the efforts it lists) is used, the short list and the Gemini rule are the fallback;
 *   - a model that answers that exact 400 is asked again at once with its lowest effort, on the same model, and remembered: later calls (of any step) do not
 *     waste a failed call, and the ladder did not climb.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const llm = vi.hoisted(() => ({ calls: [] as Array<Record<string, any>>, answer: (_body: Record<string, any>): unknown => undefined }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: Record<string, any>) => {
          llm.calls.push(structuredClone(body));
          const r = llm.answer(body);
          if (r instanceof Error) throw r;
          return (async function* () {
            yield { choices: [{ delta: { content: "SAY hi\nDONE" } }], provider: "Fake Cloud" };
            yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } };
          })();
        },
      },
    };
  },
}));

const { plannerRequest, planStream, reasoningFor } = await import("../src/agent/llm.js");
const R = await import("../src/agent/reasoning.js");
const { callModel, ModelUnavailable } = await import("../src/code/brain/gateway.js");
const { reasoningParam, buildTierTable, resetTierTableForTests } = await import("../src/code/brain/tiers.js");

const MANDATORY = "OpenRouter 400: Reasoning is mandatory for this endpoint and cannot be disabled.";
const mandatory400 = () => Object.assign(new Error(MANDATORY), { status: 400 });

/** The six models the first real-model test found refusing, with the lowest effort each lists. */
const SIX: Array<[string, string]> = [
  ["anthropic/claude-sonnet-5.5", "low"],
  ["openai/gpt-6.1-sol", "low"],
  ["qwen/qwen3.8-max-0902", "minimal"],
  ["moonshotai/kimi-k2.7-code", "low"],
  ["minimax/minimax-m3.1-flash", "low"],
  ["z-ai/glm-5.3-flash", "low"],
];

beforeEach(() => { R.resetReasoningForTests(); resetTierTableForTests(); llm.calls.length = 0; llm.answer = () => undefined; });
afterEach(() => { R.resetReasoningForTests(); });

describe("a model that requires reasoning", () => {
  it.each(SIX)("%s is sent %s, never none or enabled:false, by the planner and by the gateway's none", (model, effort) => {
    expect(reasoningFor(model)).toEqual({ effort });
    expect((plannerRequest(model, "sys", "u") as Record<string, any>).reasoning).toEqual({ effort });
    expect(reasoningParam(model, "none")).toEqual({ effort });
  });

  it("keeps the other families as they were: off where it can be, Anthropic's explicit switch too", () => {
    expect(reasoningFor("deepseek/deepseek-v4.1-flash")).toEqual({ effort: "none" });
    expect(reasoningFor("anthropic/claude-haiku-5.5")).toEqual({ effort: "none", enabled: false });
    expect(reasoningFor("google/gemini-2.5-pro")).toEqual({ effort: "low" });
    expect(reasoningFor("google/gemini-3.8-flash")).toEqual({ effort: "low" });
    expect(reasoningFor("who/knows")).toEqual({ effort: "none" });
  });
});

describe("what the catalog says", () => {
  const entry = (id: string, mandatory: boolean, efforts: string[], params = ["reasoning", "reasoning_effort", "include_reasoning"]) =>
    ({ id, supported_parameters: params, reasoning: { mandatory, supported_efforts: efforts } });

  it("reads mandatory and the efforts from a model list entry", () => {
    expect(R.reasoningFactsOf(entry("a/b", true, ["high", "medium", "low"]))).toEqual({ supported: true, mandatory: true, efforts: ["high", "medium", "low"] });
    expect(R.reasoningFactsOf(entry("a/b", false, ["high", "low", "none"]))).toEqual({ supported: true, mandatory: false, efforts: ["high", "low"], canBeOff: true });
    expect(R.reasoningFactsOf({ supported_parameters: ["tools"] })).toEqual({ supported: false });
    expect(R.reasoningFactsOf({ supported_parameters: ["reasoning"], reasoning: null })).toEqual({ supported: true });
  });

  it("a model the catalog says is mandatory is sent its lowest listed effort, though no list of ours knows it", () => {
    R.registerReasoningCatalog([entry("vendor/new-max", true, ["xhigh", "high", "medium"]), entry("vendor/off-ok", false, ["high", "low", "none"])]);
    expect(reasoningFor("vendor/new-max")).toEqual({ effort: "medium" });
    expect(reasoningFor("vendor/off-ok")).toEqual({ effort: "none" });
    expect(reasoningParam("vendor/new-max", "none")).toEqual({ effort: "medium" });
  });

  it("the catalog outranks the short list and the Gemini rule, and a model with no efforts listed gets low", () => {
    R.registerReasoningCatalog([entry("google/gemini-3.1-flash-lite", false, ["high", "low", "minimal", "none"]), { id: "z-ai/glm-5.3-flash", supported_parameters: ["reasoning"], reasoning: { mandatory: true } }]);
    expect(reasoningFor("google/gemini-3.1-flash-lite")).toEqual({ effort: "none" });
    expect(reasoningFor("z-ai/glm-5.3-flash")).toEqual({ effort: "low" });
  });

  it("a level a tier asks for is moved up to one the model lists, and left alone when it lists none or lists it", () => {
    R.registerReasoningCatalog([entry("vendor/new-max", true, ["xhigh", "high", "medium"])]);
    expect(reasoningParam("vendor/new-max", "low")).toEqual({ effort: "medium" });
    expect(reasoningParam("vendor/new-max", "high")).toEqual({ effort: "high" });
    expect(reasoningParam("deepseek/deepseek-v4.1-flash", "low")).toEqual({ effort: "low" });
  });
});

describe("the exact 400", () => {
  it("is recognised in the message, in the body, and in the provider's own words, and only as a 400", () => {
    expect(R.isReasoningRequiredError(mandatory400())).toBe(true);
    expect(R.isReasoningRequiredError(Object.assign(new Error("400 Bad Request"), { status: 400, error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }))).toBe(true);
    expect(R.isReasoningRequiredError(Object.assign(new Error("400"), { status: 400, error: { metadata: { raw: "reasoning cannot be turned off for this model" } } }))).toBe(true);
    expect(R.isReasoningRequiredError(Object.assign(new Error(MANDATORY), { status: 500 }))).toBe(false);
    expect(R.isReasoningRequiredError(Object.assign(new Error("400 max_tokens too large"), { status: 400 }))).toBe(false);
    expect(R.isReasoningRequiredError("Reasoning is mandatory")).toBe(false);
  });
});

describe("the gateway meeting a model that requires reasoning and was not known to", () => {
  const fake = (script: Array<unknown | Error>) => {
    const calls: Array<Record<string, any>> = [];
    let i = 0;
    return {
      calls,
      chat: {
        completions: {
          create: async (body: Record<string, any>) => {
            calls.push(structuredClone(body));
            const r = script[Math.min(i, script.length - 1)];
            i += 1;
            if (r instanceof Error) throw r;
            return r;
          },
        },
      },
    };
  };
  const ok = { choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001 } };
  const tiers = buildTierTable({ tiers: JSON.stringify({ code: { models: ["vendor/unlisted-thinker", "deepseek/fallback"], reasoning: "none", maxTokens: 500 } }) });
  const deps = (client: ReturnType<typeof fake>) => ({ client, tiers, fx: 88, ledger: null, log: { info: () => undefined, warn: () => undefined }, sleep: async () => undefined, random: () => 0.5, breakers: null });
  const ask = () => ({ tier: "code" as const, messages: [{ role: "user" as const, content: "hello" }], purpose: "t", budget: "none" as const });

  it("asks again at once, on the same model, with its lowest effort, and the ladder does not climb", async () => {
    const c = fake([mandatory400(), ok]);
    const r = await callModel(ask(), deps(c));
    expect(r.model).toBe("vendor/unlisted-thinker");
    expect(c.calls.map((x) => [x.model, x.reasoning])).toEqual([["vendor/unlisted-thinker", { effort: "none" }], ["vendor/unlisted-thinker", { effort: "low" }]]);
    expect(r.trail[0]).toMatchObject({ model: "vendor/unlisted-thinker", outcome: "ok", reasoningRetried: true });
  });

  it("remembers it: the next call of any step sends the lowest effort first, so no call is wasted", async () => {
    const c = fake([mandatory400(), ok, ok]);
    await callModel(ask(), deps(c));
    await callModel({ ...ask(), purpose: "another step" }, deps(c));
    expect(c.calls.map((x) => x.reasoning)).toEqual([{ effort: "none" }, { effort: "low" }, { effort: "low" }]);
    expect(R.reasoningLearned("vendor/unlisted-thinker")).toBe(true);
  });

  it("asks only once: a second refusal climbs the ladder, and the failure keeps the SDK error as its cause", async () => {
    const c = fake([mandatory400(), mandatory400(), ok]);
    const r = await callModel(ask(), deps(c));
    expect(c.calls.map((x) => x.model)).toEqual(["vendor/unlisted-thinker", "vendor/unlisted-thinker", "deepseek/fallback"]);
    expect(r.model).toBe("deepseek/fallback");

    const dead = fake([Object.assign(new Error("500 the provider fell over"), { status: 500 })]);
    const err = await callModel(ask(), deps(dead)).catch((e) => e);
    expect(err).toBeInstanceOf(ModelUnavailable);
    expect(err.cause).toBeDefined();
    expect((err.cause as Error).cause).toMatchObject({ status: 500 });
  });

  it("never sends none to a model it is told requires reasoning, and does not retry a 400 it could not have caused", async () => {
    R.registerReasoningCatalog([{ id: "vendor/unlisted-thinker", supported_parameters: ["reasoning"], reasoning: { mandatory: true, supported_efforts: ["medium", "high"] } }]);
    const c = fake([mandatory400(), ok]);
    const r = await callModel(ask(), deps(c));
    expect(c.calls[0]!.reasoning).toEqual({ effort: "medium" });
    // The 400 came back for a request that was not asking for none: the ladder moves on rather than asking the same thing twice.
    expect(r.model).toBe("deepseek/fallback");
    expect(c.calls).toHaveLength(2);
  });
});

describe("the planner's ladder meeting the same 400", () => {
  it("asks the same model again with its lowest effort, writes the line, and remembers", async () => {
    llm.answer = (body) => (body.reasoning?.effort === "none" ? mandatory400() : undefined);
    const seen: Array<{ model: string; outcome: string }> = [];
    const text: string[] = [];
    for await (const c of planStream("sys", "user", { models: ["vendor/unlisted-thinker", "deepseek/fallback"], log: (r) => seen.push(r) })) text.push(c.delta);
    expect(text.join("")).toBe("SAY hi\nDONE");
    expect(llm.calls.map((b) => [b.model, b.reasoning])).toEqual([["vendor/unlisted-thinker", { effort: "none" }], ["vendor/unlisted-thinker", { effort: "low" }]]);
    expect(seen).toEqual([expect.objectContaining({ model: "vendor/unlisted-thinker", outcome: "ok" })]);

    // The next step does not pay for the failed call.
    llm.calls.length = 0;
    for await (const _ of planStream("sys", "user", { models: ["vendor/unlisted-thinker", "deepseek/fallback"] })) void _;
    expect(llm.calls.map((b) => [b.model, b.reasoning])).toEqual([["vendor/unlisted-thinker", { effort: "low" }]]);
  });
});

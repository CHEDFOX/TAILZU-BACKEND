/**
 * WHAT A PLANNER CALL COST (agent/llm.ts), read off its answer.
 *
 * OpenRouter puts its usage, with the charge in US dollars, in the last chunk
 * of every streamed call. What these hold down:
 *   - the charge lands on the call's CallRecord, with the cache it wrote;
 *   - a charge that is not a plain amount is left out, never guessed;
 *   - a call cut short after its answer still logs what it was told;
 *   - the request is the same bytes as before: nothing asked for, so the
 *     prompt cache and plannerRequest's own tests are untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const llm = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, any>>,
  usage: {} as Record<string, unknown>,
}));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: Record<string, any>) => {
          llm.bodies.push(body);
          return (async function* () {
            yield { choices: [{ delta: { content: "SAY It's 4pm.\n" } }], provider: "Groq", model: "openai/gpt-6-luna-0925" };
            yield { choices: [{ delta: { content: "DONE\n" } }] };
            yield { choices: [], usage: llm.usage };
          })();
        },
      },
    };
  },
}));

const { planStream, plannerRequest } = await import("../src/agent/llm.js");
type CallRecord = import("../src/agent/llm.js").CallRecord;

/** The whole stream read, and the calls it logged. */
async function call(o: { stopAfter?: number } = {}): Promise<CallRecord[]> {
  const logged: CallRecord[] = [];
  let n = 0;
  for await (const _chunk of planStream("You are Blip.", "what time is it in london", { models: ["openai/gpt-6-luna"], log: (c) => logged.push(c) })) {
    if (o.stopAfter !== undefined && ++n >= o.stopAfter) break;
  }
  return logged;
}

beforeEach(() => {
  llm.bodies.length = 0;
  llm.usage = {};
});

describe("a planner call's cost", () => {
  it("is read from the usage OpenRouter sends, with the tokens and the cache written", async () => {
    llm.usage = {
      prompt_tokens: 3120, completion_tokens: 31, cost: 0.000327,
      prompt_tokens_details: { cached_tokens: 2900, cache_write_tokens: 120 }, completion_tokens_details: { reasoning_tokens: 0 },
    };
    const [c] = await call();
    expect(c).toEqual({
      model: "openai/gpt-6-luna", outcome: "ok", ms: expect.any(Number), firstMs: expect.any(Number),
      provider: "Groq", served: "openai/gpt-6-luna-0925",
      promptTokens: 3120, completionTokens: 31, cachedTokens: 2900, cacheWriteTokens: 120, reasoningTokens: 0, costUsd: 0.000327,
    });
  });

  it("is a free call's 0, and left out when it is not a plain amount", async () => {
    llm.usage = { prompt_tokens: 10, completion_tokens: 2, cost: 0 };
    expect((await call())[0]!.costUsd).toBe(0);
    for (const cost of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, "0.0003", null, undefined]) {
      llm.usage = { prompt_tokens: 10, completion_tokens: 2, cost };
      const [c] = await call();
      expect(c, String(cost)).not.toHaveProperty("costUsd");
      expect(c!.promptTokens).toBe(10);
    }
  });

  it("arrives after the answer when the step has its ending early and the rest is read in the background (run.ts drain)", async () => {
    llm.usage = { prompt_tokens: 3120, completion_tokens: 31, cost: 0.0004 };
    const logged: CallRecord[] = [];
    const stream = planStream("You are Blip.", "what time is it in london", { models: ["openai/gpt-6-luna"], log: (c) => logged.push(c) })[Symbol.asyncIterator]();
    await stream.next();
    // The step has its answer here; nothing is logged yet.
    expect(logged).toEqual([]);
    while (!(await stream.next()).done) { /* read to the end, as drain() does */ }
    expect(logged).toEqual([expect.objectContaining({ outcome: "ok", costUsd: 0.0004, promptTokens: 3120 })]);
  });

  it("is not known for a call cut short before its last chunk: it is logged as stopped, with no charge read", async () => {
    llm.usage = { prompt_tokens: 3120, completion_tokens: 31, cost: 0.0004 };
    const logged = await call({ stopAfter: 1 });
    expect(logged).toEqual([expect.objectContaining({ model: "openai/gpt-6-luna", outcome: "stopped" })]);
    expect(logged[0]).not.toHaveProperty("costUsd");
  });
});

describe("the request", () => {
  it("is the same bytes it always was: nothing more is asked for to get the cost", async () => {
    await call();
    const [body] = llm.bodies;
    expect(body).toEqual(plannerRequest("openai/gpt-6-luna", "You are Blip.", "what time is it in london"));
    expect(body).not.toHaveProperty("usage");
    expect(body!.stream_options).toEqual({ include_usage: true });
    expect(Object.keys(body!).sort()).toEqual(["max_tokens", "messages", "model", "provider", "reasoning", "stream", "stream_options", "temperature"]);
  });
});

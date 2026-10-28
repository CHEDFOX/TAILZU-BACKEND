/**
 * THE CODE BOT'S MODEL GATEWAY (src/code/brain/gateway.ts): callModel(), against a
 * fake OpenRouter passed in as the client. Nothing here reaches a network.
 *
 * What these hold down:
 *   - the request: providers that keep nothing (data_collection deny), the
 *     person as a hash, reasoning in OpenRouter's form, the model order;
 *   - the ladder: an error, a timeout, an empty answer or an error hidden in a
 *     200 moves on to the next model; every model failing is ModelUnavailable;
 *   - one transient retry (429, 5xx, a dropped connection) per model, jittered, honouring Retry-After,
 *     and none for a 400 or for a second failure on the same model;
 *   - JSON: parsed through a fence, checked against a schema, ONE repair that
 *     shows the model what was wrong, then the next model;
 *   - cost: OpenRouter's usage.cost, else the tokens at the tier's prices, else
 *     the characters; dollars to paise at the rate, rounded up; added to the
 *     job's spent_paise (two adds at once both count); a CallRecord to the run
 *     ledger when it is on;
 *   - BudgetExceeded BEFORE the call, at the worst case, the job's or the call's
 *     own, and again before a retry or a repair;
 *   - nothing that was sent or received, not even inside an error, in a log;
 *   - the review tier never picks the writer's family.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { callModel, BudgetExceeded, ModelUnavailable, hashedUser, parseJsonLoose, droppedConnection } = await import("../src/code/brain/gateway.js");
const { buildTierTable, resetTierTableForTests } = await import("../src/code/brain/tiers.js");
const { addJobSpend } = await import("../src/code/brain/spend.js");
const { usdToPaise, worstCasePaise, charsOf } = await import("../src/code/brain/money.js");
const { MemoryJobStore, SupabaseJobStore } = await import("../src/code/jobs/store.js");
const { MemoryRunStore, resetRunStoreForTests } = await import("../src/runs/index.js");
const { resetConfigForTests } = await import("../src/config.js");
type CallInput = import("../src/code/brain/gateway.js").CallInput;
type GatewayDeps = import("../src/code/brain/gateway.js").GatewayDeps;

// ------------------------------------------------------------------ the fake

type Reply = unknown | Error | ((body: any, opts: any) => unknown | Promise<unknown>);

/** An OpenRouter that answers from a script, the last reply repeating, and writes down what it was asked. */
function fakeRouter(script: Reply[]) {
  const calls: Array<{ body: any; opts: any }> = [];
  let i = 0;
  return {
    calls,
    models: () => calls.map((c) => c.body.model as string),
    chat: {
      completions: {
        create: async (body: any, opts: any) => {
          calls.push({ body: structuredClone(body), opts });
          const r = script[Math.min(i, script.length - 1)];
          i += 1;
          const v = typeof r === "function" ? await (r as (b: any, o: any) => unknown)(body, opts) : r;
          if (v instanceof Error) throw v;
          return v;
        },
      },
    },
  };
}

const answer = (text: string, usage: Record<string, unknown> = { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 }, extra: Record<string, unknown> = {}) => ({
  choices: [{ message: { content: text }, finish_reason: "stop" }], usage, provider: "Test", ...extra,
});

const httpError = (status: number, headers?: Record<string, string>) => Object.assign(new Error(`${status} upstream said something about the prompt`), { status, headers });

/** A call that never answers until it is aborted, as a hung provider does. */
const hang = (_b: unknown, o: { signal: AbortSignal }) =>
  new Promise((_, reject) => o.signal.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "AbortError" }))));

/** A table where "code" is three made-up models at known prices, so the arithmetic is checkable by hand. */
const table = buildTierTable({
  tiers: JSON.stringify({
    code: { models: ["a/one", "b/two", "c/three"], maxTokens: 1000, reasoning: "low", timeoutMs: 5000, usdPerMIn: 2, usdPerMOut: 10 },
  }),
});

interface Line { level: "info" | "warn"; o: Record<string, unknown>; msg: string }
function recorder() {
  const lines: Line[] = [];
  return { lines, log: { info: (o: object, msg: string) => lines.push({ level: "info", o: o as Record<string, unknown>, msg }), warn: (o: object, msg: string) => lines.push({ level: "warn", o: o as Record<string, unknown>, msg }) } };
}

/** Everything callModel needs, with no waiting and no dice. */
function rig(script: Reply[], more: Partial<GatewayDeps> = {}) {
  const router = fakeRouter(script);
  const slept: number[] = [];
  const rec = recorder();
  const deps: GatewayDeps = {
    client: router, tiers: table, fx: 88, ledger: null, log: rec.log, random: () => 0.5,
    sleep: async (ms) => { slept.push(ms); },
    ...more,
  };
  return { router, slept, deps, ...rec };
}

const ask = (over: Partial<CallInput> = {}): CallInput => ({
  tier: "code", messages: [{ role: "user", content: "write a haiku" }], purpose: "test", budget: "none", ...over,
});

beforeEach(() => { resetTierTableForTests(); });

// ------------------------------------------------------------------ request

describe("the request", () => {
  it("asks only for providers that keep and train on nothing, with usage, the tier's limit, and the tier's reasoning", async () => {
    const r = rig([answer("hi")]);
    await callModel(ask(), r.deps);
    const { body, opts } = r.router.calls[0]!;
    expect(body).toMatchObject({
      model: "a/one", provider: { data_collection: "deny" }, usage: { include: true }, max_tokens: 1000,
      reasoning: { effort: "low" }, messages: [{ role: "user", content: "write a haiku" }],
    });
    expect(opts).toMatchObject({ maxRetries: 0, timeout: 5000 });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns reasoning off in the planner's own way where the tier says none", async () => {
    const r = rig([answer("hi")], { tiers: buildTierTable({ tiers: JSON.stringify({ code: { models: ["anthropic/claude-haiku-5.5", "deepseek/x"], reasoning: "none" } }) }) });
    await callModel(ask(), r.deps);
    expect(r.router.calls[0]!.body.reasoning).toEqual({ effort: "none", enabled: false });
    expect(r.router.calls[0]!.body).not.toHaveProperty("temperature");
  });

  it("names the person by a hash, never their id, and takes the job's person when it is given a job", async () => {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "user-1234-secret", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    const r = rig([answer("hi")], { jobs });
    await callModel(ask({ jobId: job.id, budget: "job" }), r.deps);
    const sent = r.router.calls[0]!.body;
    expect(sent.user).toBe(hashedUser("user-1234-secret"));
    expect(sent.user).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sent)).not.toContain("user-1234-secret");

    const r2 = rig([answer("hi")]);
    await callModel(ask({ userId: "someone-else" }), r2.deps);
    expect(r2.router.calls[0]!.body.user).toBe(hashedUser("someone-else"));
    const r3 = rig([answer("hi")]);
    await callModel(ask(), r3.deps);
    expect(r3.router.calls[0]!.body).not.toHaveProperty("user");
  });

  it("tries the tier's models in order; a named model goes first, then the rest of the tier; a model alone is alone", async () => {
    const r1 = rig([httpError(400), httpError(400), httpError(400)]);
    await expect(callModel(ask(), r1.deps)).rejects.toBeInstanceOf(ModelUnavailable);
    expect(r1.router.models()).toEqual(["a/one", "b/two", "c/three"]);

    const r2 = rig([httpError(400), answer("ok")]);
    const got = await callModel(ask({ model: "c/three" }), r2.deps);
    expect(r2.router.models()).toEqual(["c/three", "a/one"]);
    expect(got.model).toBe("a/one");

    const r3 = rig([answer("ok")]);
    await callModel({ model: "x/solo", messages: [{ role: "user", content: "hi" }], purpose: "t", budget: "none" }, r3.deps);
    expect(r3.router.models()).toEqual(["x/solo"]);
    await expect(callModel({ messages: [], purpose: "t", budget: "none" }, r3.deps)).rejects.toThrow(TypeError);
  });

  it("sends tools in the wire's form and hands back the calls the model made, arguments as written", async () => {
    const r = rig([{
      choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 50, completion_tokens: 10, cost: 0.0002 },
    }]);
    const got = await callModel(ask({
      tools: [{ name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }],
      messages: [
        { role: "user", content: "look" },
        { role: "assistant", content: null, tool_calls: [{ id: "c0", name: "list", arguments: "{}" }] },
        { role: "tool", tool_call_id: "c0", content: "a.ts" },
      ],
    }), r.deps);
    const sent = r.router.calls[0]!.body;
    expect(sent.tools).toEqual([{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }]);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.messages[1]).toEqual({ role: "assistant", content: null, tool_calls: [{ id: "c0", type: "function", function: { name: "list", arguments: "{}" } }] });
    expect(got.toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' }]);
    expect(got.text).toBe("");
    await expect(callModel(ask({ tools: [{ name: "t", description: "d", parameters: {} }], json: true }), r.deps)).rejects.toThrow(TypeError);
  });
});

// ------------------------------------------------------------------- ladder

describe("the ladder", () => {
  it("climbs to the next model on an HTTP error before any output, and says what happened to each", async () => {
    const r = rig([httpError(400), httpError(404), answer("third time")]);
    const got = await callModel(ask(), r.deps);
    expect(got.text).toBe("third time");
    expect(got.model).toBe("c/three");
    expect(got.trail).toEqual([
      { model: "a/one", outcome: "failed", status: 400 },
      { model: "b/two", outcome: "failed", status: 404 },
      { model: "c/three", outcome: "ok" },
    ]);
  });

  it("climbs on a timeout, which is not retried, and the hung call is aborted", async () => {
    const r = rig([hang, answer("second")]);
    const got = await callModel(ask({ timeoutMs: 20 }), r.deps);
    expect(got.model).toBe("b/two");
    expect(r.router.calls[0]!.opts.signal.aborted).toBe(true);
    expect(got.trail[0]).toMatchObject({ model: "a/one", outcome: "timeout" });
    expect(r.slept).toEqual([]);
  });

  it("climbs on an answer with nothing in it (and still counts what that cost), and on an error hidden in a 200", async () => {
    const r = rig([answer("   ", { prompt_tokens: 10, completion_tokens: 0, cost: 0.002 }), { error: { code: 400, message: "upstream broke" } }, answer("finally")]);
    const got = await callModel(ask(), r.deps);
    expect(got.model).toBe("c/three");
    expect(got.trail.map((t) => t.outcome)).toEqual(["empty", "failed", "ok"]);
    expect(got.trail[1]).toMatchObject({ status: 400 });
    // The empty answer was billed: 0.002 dollars at 88 rupees, up to the paise, plus the good one's 0.001.
    expect(got.paise).toBe(usdToPaise(0.002, 88) + usdToPaise(0.001, 88));
  });

  it("is ModelUnavailable, with the whole trail, when every model failed", async () => {
    const r = rig([httpError(500), httpError(500), httpError(401), httpError(400), httpError(400)]);
    const err = await callModel(ask(), r.deps).catch((e: unknown) => e) as InstanceType<typeof ModelUnavailable>;
    expect(err).toBeInstanceOf(ModelUnavailable);
    expect(err.code).toBe("model_unavailable");
    expect(err.trail.map((t) => [t.model, t.outcome])).toEqual([["a/one", "failed"], ["b/two", "failed"], ["c/three", "failed"]]);
  });

  it("stops at once, climbing no further, when the caller aborts", async () => {
    const ctrl = new AbortController();
    const r = rig([hang, answer("never")]);
    const pending = callModel(ask({ signal: ctrl.signal }), r.deps);
    await new Promise((res) => setTimeout(res, 10));
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(r.router.calls).toHaveLength(1);
    await expect(callModel(ask({ signal: ctrl.signal }), r.deps)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never picks a reviewer of the writer's family, and keeps that rule down the ladder", async () => {
    const r = rig([httpError(400), answer("looks fine")]);
    const got = await callModel({ tier: "review", writerModel: "anthropic/claude-haiku-5.5", messages: [{ role: "user", content: "review" }], purpose: "review", budget: "none" }, { ...r.deps, tiers: undefined });
    // The default pool: haiku, gemini, deepseek, sonnet. Anthropic wrote it, so: gemini, then deepseek, and no more.
    expect(r.router.models()).toEqual(["google/gemini-2.5-flash", "deepseek/deepseek-v4.1-flash"]);
    expect(got.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(got.trail.map((t) => t.model)).toEqual(["google/gemini-2.5-flash", "deepseek/deepseek-v4.1-flash"]);
    expect(r.router.models().some((m) => m.startsWith("anthropic/"))).toBe(false);
  });

  it("refuses a pinned model of the writer's family for a review, and has no reviewer when the pool is all one family", async () => {
    const r = rig([answer("fine")]);
    await callModel({ tier: "review", model: "anthropic/claude-sonnet-5.5", writerModel: "anthropic/claude-haiku-5.5", messages: [{ role: "user", content: "r" }], purpose: "review", budget: "none" }, { ...r.deps, tiers: undefined });
    expect(r.router.models()).toEqual(["google/gemini-2.5-flash"]);

    const oneFamily = buildTierTable({ tiers: JSON.stringify({ review: { models: ["anthropic/a", "anthropic/b"] } }) });
    await expect(callModel({ tier: "review", writerModel: "anthropic/z", messages: [{ role: "user", content: "r" }], purpose: "review", budget: "none" }, { ...r.deps, tiers: oneFamily }))
      .rejects.toBeInstanceOf(ModelUnavailable);
  });
});

// -------------------------------------------------------------------- retry

describe("the one transient retry", () => {
  it("tries a 429 again on the same model after a jittered wait, and a 5xx too", async () => {
    for (const status of [429, 500, 502, 503]) {
      const r = rig([httpError(status), answer("ok")], { random: () => 0.5 });
      const got = await callModel(ask(), r.deps);
      expect(r.router.models(), String(status)).toEqual(["a/one", "a/one"]);
      expect(got.model).toBe("a/one");
      expect(got.trail).toEqual([{ model: "a/one", outcome: "ok", retried: true }]);
      // 500 ms of base, times a jitter of 0.5 + random().
      expect(r.slept).toEqual([500]);
    }
  });

  it("jitters: the wait is half to one and a half times the base, and follows Retry-After when it is given (capped)", async () => {
    const wait = async (random: number, headers?: Record<string, string>) => {
      const r = rig([httpError(429, headers), answer("ok")], { random: () => random });
      await callModel(ask(), r.deps);
      return r.slept[0];
    };
    expect(await wait(0)).toBe(250);
    expect(await wait(0.999)).toBe(750);
    expect(await wait(0.5, { "retry-after": "2" })).toBe(2000);
    expect(await wait(0.5, { "retry-after": "600" })).toBe(5000);
  });

  it("moves on when the retry fails too, and does not retry the new model's first failure twice more", async () => {
    const r = rig([httpError(503), httpError(503), httpError(429), answer("ok")]);
    const got = await callModel(ask(), r.deps);
    expect(r.router.models()).toEqual(["a/one", "a/one", "b/two", "b/two"]);
    expect(got.model).toBe("b/two");
    expect(r.slept).toHaveLength(2);
  });

  it("treats a 429 hidden in a 200's body as the transient error it is", async () => {
    const r = rig([{ error: { code: 429, message: "rate limited upstream" } }, answer("ok")]);
    const got = await callModel(ask(), r.deps);
    expect(r.router.models()).toEqual(["a/one", "a/one"]);
    expect(got.trail).toEqual([{ model: "a/one", outcome: "ok", retried: true }]);
  });

  it("tries a dropped connection again too (no status: undici's \"terminated\", the SDK's connection error), but not any error with no status", async () => {
    const terminated = Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET", message: "other side closed" } });
    const r = rig([terminated, answer("ok")], { random: () => 0.5 });
    const got = await callModel(ask(), r.deps);
    expect(r.router.models()).toEqual(["a/one", "a/one"]);
    expect(got.trail).toEqual([{ model: "a/one", outcome: "ok", retried: true }]);
    expect(r.slept).toEqual([500]);
    const sdk = Object.assign(new Error("Connection error."), { name: "APIConnectionError" });
    expect(droppedConnection(sdk) && droppedConnection(terminated)).toBe(true);
    // A bug of ours, a refusal with a status, an abort: a second try mends none of them.
    expect(droppedConnection(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(droppedConnection(httpError(400))).toBe(false);
    expect(droppedConnection(Object.assign(new Error("terminated"), { name: "AbortError" }))).toBe(false);
    const bug = rig([new Error("boom"), answer("ok")]);
    await callModel(ask(), bug.deps);
    expect(bug.router.models()).toEqual(["a/one", "b/two"]);
  });

  it("does not retry what a second try cannot mend: a 400, a 404, a timeout", async () => {
    const r = rig([httpError(400), httpError(404), answer("ok")]);
    await callModel(ask(), r.deps);
    expect(r.router.models()).toEqual(["a/one", "b/two", "c/three"]);
    expect(r.slept).toEqual([]);
  });
});

// --------------------------------------------------------------------- JSON

describe("JSON mode", () => {
  const Plan = z.object({ steps: z.array(z.string()).min(1), risky: z.boolean() }).strict();

  it("asks for JSON, parses it through a fence or a line of preamble, and validates it", async () => {
    const r = rig([answer('Sure!\n```json\n{"steps":["a","b"],"risky":false}\n```')]);
    const got = await callModel(ask({ json: Plan }), r.deps);
    expect(got.json).toEqual({ steps: ["a", "b"], risky: false });
    const sent = r.router.calls[0]!.body;
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.messages[0]).toMatchObject({ role: "system" });
    expect(sent.messages[0].content).toMatch(/JSON/);
    expect(parseJsonLoose('here: {"a":1} done')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonLoose("nothing")).toMatchObject({ ok: false });
  });

  it("puts the JSON note on the caller's own system message, and passes any JSON with `true`", async () => {
    const r = rig([answer("[1,2,3]")]);
    const got = await callModel(ask({ json: true, messages: [{ role: "system", content: "You plan." }, { role: "user", content: "go" }] }), r.deps);
    expect(got.json).toEqual([1, 2, 3]);
    expect(r.router.calls[0]!.body.messages[0].content).toMatch(/^You plan\.\n\n/);
    expect(r.router.calls[0]!.body.messages).toHaveLength(2);
  });

  it("adds the JSON note only when the system block does not already say it: a role's block carries the library's line, sent as it is", async () => {
    const { compose, stableBlock } = await import("../src/principles/index.js");
    const r = rig([answer('{"type":"bug_fix"}')]);
    await callModel(ask({ json: true, messages: compose("classify", [{ role: "user" as const, content: "go" }]) }), r.deps);
    const sent = r.router.calls[0]!.body.messages;
    expect(sent).toHaveLength(2);
    expect(sent[0].content).toBe(stableBlock("classify"));
    expect(sent[0].content.match(/JSON only when asked/g)).toHaveLength(1);
    expect(sent[0].content).not.toContain("Answer with one JSON value only");
    // a system message without it still gets the note
    const r2 = rig([answer("[1]")]);
    await callModel(ask({ json: true, messages: [{ role: "system", content: "You plan." }, { role: "user", content: "go" }] }), r2.deps);
    expect(r2.router.calls[0]!.body.messages[0].content).toMatch(/Answer with one JSON value only/);
  });

  it("repairs ONE bad answer: the same model is shown what it wrote and what was wrong, and its second answer is used", async () => {
    const r = rig([answer('{"steps":[],"risky":"no"}', { prompt_tokens: 100, completion_tokens: 10, cost: 0.001 }), answer('{"steps":["x"],"risky":true}', { prompt_tokens: 150, completion_tokens: 12, cost: 0.002 })]);
    const got = await callModel(ask({ json: Plan }), r.deps);
    expect(got.json).toEqual({ steps: ["x"], risky: true });
    expect(r.router.models()).toEqual(["a/one", "a/one"]);
    const second = r.router.calls[1]!.body.messages;
    expect(second.at(-2)).toEqual({ role: "assistant", content: '{"steps":[],"risky":"no"}' });
    expect(second.at(-1).role).toBe("user");
    expect(second.at(-1).content).toMatch(/steps/);
    expect(second.at(-1).content).toMatch(/risky/);
    expect(got.trail).toEqual([{ model: "a/one", outcome: "ok", repaired: true }]);
    // Both calls were billed and both are in the total.
    expect(got.calls).toBe(2);
    expect(got.paise).toBe(usdToPaise(0.001, 88) + usdToPaise(0.002, 88));
    expect(got.promptTokens).toBe(250);
  });

  it("repairs text that is not JSON at all, and moves to the next model when the repair fails too", async () => {
    const r = rig([answer("I think the plan is good"), answer("still prose"), answer('{"steps":["y"],"risky":false}')]);
    const got = await callModel(ask({ json: Plan }), r.deps);
    expect(r.router.models()).toEqual(["a/one", "a/one", "b/two"]);
    expect(got.model).toBe("b/two");
    expect(got.trail).toEqual([{ model: "a/one", outcome: "invalid_json", repaired: true }, { model: "b/two", outcome: "ok" }]);
  });

  it("is ModelUnavailable when no model can produce it", async () => {
    const r = rig([answer("nope")]);
    await expect(callModel(ask({ json: Plan }), r.deps)).rejects.toBeInstanceOf(ModelUnavailable);
    // A repair on each of the three models: six calls.
    expect(r.router.calls).toHaveLength(6);
  });

  it("gives the repair a retry only once per model: a 429 on the first call and on the repair is one retry, then the next model", async () => {
    const r = rig([httpError(429), answer("bad"), httpError(429), answer('{"steps":["z"],"risky":false}')]);
    const got = await callModel(ask({ json: Plan }), r.deps);
    expect(got.model).toBe("b/two");
    expect(r.router.models()).toEqual(["a/one", "a/one", "a/one", "b/two"]);
  });
});

// --------------------------------------------------------------------- cost

describe("what a call costs", () => {
  it("reads usage.cost, in dollars, and turns it into paise at the rate, rounding up", async () => {
    const r = rig([answer("ok", { prompt_tokens: 100, completion_tokens: 20, cost: 0.01 })]);
    const got = await callModel(ask(), r.deps);
    // 0.01 dollars at 88 rupees to the dollar is exactly 88 paise, not 89 by floating-point dust.
    expect(got.paise).toBe(88);
    expect(got.costUsd).toBe(0.01);
    expect(got.costSource).toBe("reported");
    expect(usdToPaise(0.000001, 88)).toBe(1);
    expect(usdToPaise(0, 88)).toBe(0);
    expect(usdToPaise(0.0123, 90)).toBe(111);
    expect(usdToPaise(Number.NaN, 88)).toBe(0);
  });

  it("is a free call's zero when OpenRouter says the charge was 0", async () => {
    const r = rig([answer("ok", { prompt_tokens: 100, completion_tokens: 20, cost: 0 })]);
    const got = await callModel(ask(), r.deps);
    expect(got.paise).toBe(0);
    expect(got.costSource).toBe("reported");
  });

  it("estimates from the tokens it reports, at the tier's prices, when OpenRouter names no charge", async () => {
    for (const cost of [undefined, -1, Number.NaN, "0.5", null]) {
      const r = rig([answer("ok", { prompt_tokens: 1000, completion_tokens: 500, cost })]);
      const got = await callModel(ask(), r.deps);
      // (1000 * 2 + 500 * 10) / 1e6 dollars at 88: 61.6, so 62.
      expect(got.costUsd).toBeCloseTo(0.007, 10);
      expect(got.paise, String(cost)).toBe(62);
      expect(got.costSource).toBe("estimated");
    }
  });

  it("estimates from the characters when it reports nothing at all", async () => {
    const r = rig([{ choices: [{ message: { content: "y".repeat(350) } }] }]);
    const got = await callModel(ask({ messages: [{ role: "user", content: "x".repeat(700) }] }), r.deps);
    // 200 tokens in, 100 out: (200 * 2 + 100 * 10) / 1e6 = 0.0014 dollars: 12.32 paise, so 13.
    expect(got.paise).toBe(13);
    expect(got.costSource).toBe("estimated");
  });

  it("uses CODE_USD_INR, 88 unless set", async () => {
    try {
      const r = rig([answer("ok", { cost: 0.01 })], { fx: undefined });
      expect((await callModel(ask(), r.deps)).paise).toBe(88);
      process.env.CODE_USD_INR = "100";
      resetConfigForTests();
      const r2 = rig([answer("ok", { cost: 0.01 })], { fx: undefined });
      expect((await callModel(ask(), r2.deps)).paise).toBe(100);
    } finally {
      delete process.env.CODE_USD_INR;
      resetConfigForTests();
    }
  });

  it("is added to the job's spent_paise, call by call, retries and repairs included", async () => {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    const r = rig([answer("bad", { cost: 0.01 }), answer('{"ok":true}', { cost: 0.02 })], { jobs });
    await callModel(ask({ jobId: job.id, budget: "job", json: true }), r.deps);
    expect((await jobs.getJobById(job.id))!.spentPaise).toBe(88 + 176);
  });

  it("rounds up ONCE over a job's calls, not once per call: twenty calls of 0.4 paise cost the job 8, where a paise each read 20 (the meter that ran twice the proxy's)", async () => {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    const r = rig([answer("ok", { cost: 0.4 / 8800 })], { jobs });
    const paise: number[] = [];
    for (let i = 0; i < 20; i += 1) paise.push((await callModel(ask({ jobId: job.id, budget: "job" }), r.deps)).paise);
    // The first call is charged as it always was (its cost rounded up); the others only when the running total passes another whole paise.
    expect(paise[0]).toBe(1);
    expect(paise.reduce((n, x) => n + x, 0)).toBe(8);
    expect((await jobs.getJobById(job.id))!.spentPaise).toBe(8);
    // A call outside any job has no running total to round against: its cost rounded up, as before.
    const one = await callModel(ask(), rig([answer("ok", { cost: 0.4 / 8800 })]).deps);
    expect(one.paise).toBe(1);
  });

  it("never reads a job's spend low, and never more than one paise high, whatever the mix of calls", async () => {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    const costs = [0.3, 2.7, 0.05, 11.2, 0.9, 0.9, 0.9, 4.01, 0.2];
    const r = rig(costs.map((c) => answer("ok", { cost: c / 8800 })), { jobs });
    let exact = 0;
    for (const c of costs) {
      exact += c;
      await callModel(ask({ jobId: job.id, budget: "job" }), r.deps);
      const spent = (await jobs.getJobById(job.id))!.spentPaise;
      expect(spent).toBeGreaterThanOrEqual(Math.ceil(Number(exact.toFixed(6))));
      expect(spent).toBeLessThan(exact + 1);
    }
  });

  it("is added even when the job is spent on by someone else at the same moment: two adds both count", async () => {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    await Promise.all([addJobSpend(jobs, job.id, 5), addJobSpend(jobs, job.id, 7), addJobSpend(jobs, job.id, 11)]);
    expect((await jobs.getJobById(job.id))!.spentPaise).toBe(23);
    expect(await addJobSpend(jobs, "no-such-job", 5)).toBeNull();
    expect(await addJobSpend(jobs, job.id, 0)).toBe(23);
    // The store refuses a change whose spend is not what the caller read.
    expect(await jobs.casJob(job.id, { spentPaise: 1 }, { spentPaise: 2 })).toBeNull();
  });

  it("is a compare-and-set on the spend in Supabase too: one UPDATE that holds only while spent_paise is what was read", async () => {
    const JID = "33333333-3333-4333-8333-333333333333";
    const log: Array<[string, unknown[]]> = [];
    const answerRow = { data: { id: JID, user_id: "11111111-1111-4111-8111-111111111111", project_id: "p", branch: "b", task: "", state: "running", placement: "none", lease_epoch: 0, checkpoint: {}, budget_paise: 500, spent_paise: 140, reassignments: 0, created_at: "2026-10-26T12:00:00.000Z", updated_at: "2026-10-26T12:00:00.000Z" }, error: null };
    const chain = (): unknown => new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answerRow);
        return (...args: unknown[]) => { log.push([String(prop), args]); return chain(); };
      },
    });
    const store = new SupabaseJobStore({ from: () => chain() } as never);
    const got = await store.casJob(JID, { spentPaise: 100 }, { spentPaise: 140 });
    expect(got?.spentPaise).toBe(140);
    expect((log.find(([m]) => m === "update")![1][0] as Record<string, unknown>).spent_paise).toBe(140);
    expect(log.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["id", JID], ["spent_paise", 100]]);
  });

  it("does not touch a job when no job is given, and a store that fails does not lose the answer", async () => {
    const r = rig([answer("ok", { cost: 0.01 })]);
    expect((await callModel(ask(), r.deps)).text).toBe("ok");
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    const broken = { getJobById: jobs.getJobById.bind(jobs), casJob: async () => { throw new Error("db down"); } };
    const r2 = rig([answer("still here", { cost: 0.01 })], { jobs: broken });
    expect((await callModel(ask({ jobId: job.id, budget: "job" }), r2.deps)).text).toBe("still here");
    expect(r2.lines.some((l) => l.level === "warn" && /spend not added/.test(l.msg))).toBe(true);
  });
});

// ------------------------------------------------------------------- ledger

describe("the run ledger", () => {
  it("is given a CallRecord for every call, failed ones too, when a ledger is passed", async () => {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    const ledger = new MemoryRunStore();
    const r = rig([httpError(400), answer("ok", { prompt_tokens: 120, completion_tokens: 30, cost: 0.004, prompt_tokens_details: { cached_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 8 } }, { model: "b/two-0925" })], { jobs, ledger });
    await callModel(ask({ jobId: job.id, budget: "job", step: 3 }), r.deps);
    await new Promise((res) => setTimeout(res, 0));
    const rows = ledger.callsOf("alice", `code:${job.id}`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ model: "a/one", outcome: "failed", status: 400, step: 3, surface: "desktop" });
    expect(rows[1]).toMatchObject({
      model: "b/two", outcome: "ok", provider: "Test", served: "b/two-0925", promptTokens: 120, completionTokens: 30,
      cachedTokens: 50, reasoningTokens: 8, costUsd: 0.004, step: 3,
    });
    expect(JSON.stringify(rows)).not.toContain("haiku");
  });

  it("is used when AGENT_RUN_LEDGER is on, and not when it is off (the default)", async () => {
    try {
      const jobs = new MemoryJobStore();
      const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
      const base = rig([answer("ok", { cost: 0.001 })], { jobs });
      const deps = { ...base.deps, ledger: undefined };

      resetRunStoreForTests(); resetConfigForTests();
      await callModel(ask({ jobId: job.id, budget: "job" }), deps);
      const { runStore } = await import("../src/runs/index.js");
      expect((runStore() as InstanceType<typeof MemoryRunStore>).callsOf("alice", `code:${job.id}`)).toHaveLength(0);

      process.env.AGENT_RUN_LEDGER = "true";
      resetRunStoreForTests(); resetConfigForTests();
      await callModel(ask({ jobId: job.id, budget: "job" }), deps);
      expect((runStore() as InstanceType<typeof MemoryRunStore>).callsOf("alice", `code:${job.id}`)).toHaveLength(1);
    } finally {
      delete process.env.AGENT_RUN_LEDGER;
      resetRunStoreForTests(); resetConfigForTests();
    }
  });

  it("is skipped without a person to write it under, and a ledger that fails does not fail the call", async () => {
    const ledger = new MemoryRunStore();
    const r = rig([answer("ok")], { ledger });
    await callModel(ask(), r.deps);
    expect(ledger.callsOf("", "code:test")).toHaveLength(0);

    const failing = { addCalls: async () => { throw new Error("ledger down"); } };
    const r2 = rig([answer("fine")], { ledger: failing });
    const got = await callModel(ask({ userId: "alice" }), r2.deps);
    expect(got.text).toBe("fine");
    await new Promise((res) => setTimeout(res, 0));
    expect(r2.lines.some((l) => l.level === "warn" && /ledger/.test(l.msg))).toBe(true);
  });
});

// ------------------------------------------------------------------- budget

describe("the budget", () => {
  const chars3500 = "x".repeat(3500);
  /** 3500 characters in is 1000 tokens, and 1000 may be written: (1000 * 2 + 1000 * 10) / 1e6 = 0.012 dollars = 105.6 paise, so 106. */
  const NEED = 106;

  async function jobWith(spent: number, budget: number) {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: budget });
    if (spent) await jobs.casJob(job.id, {}, { spentPaise: spent });
    return { jobs, job };
  }

  it("estimates the worst case from the characters, the tier's prices and maxTokens", () => {
    const chars = charsOf([{ role: "user", content: chars3500 }]);
    expect(chars).toBe(3500);
    expect(worstCasePaise({ chars, maxTokens: 1000, usdPerMIn: 2, usdPerMOut: 10 }, 88)).toBe(NEED);
    // A picture is a flat 1,200 tokens, whatever the size of its data URL.
    expect(charsOf([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(50_000) } }] }])).toBe(4200);
  });

  it("refuses BEFORE the call when the job's spend plus the worst case would pass its budget", async () => {
    const { jobs, job } = await jobWith(0, NEED - 1);
    const r = rig([answer("never asked")], { jobs });
    const err = await callModel(ask({ jobId: job.id, budget: "job", messages: [{ role: "user", content: chars3500 }] }), r.deps).catch((e: unknown) => e) as InstanceType<typeof BudgetExceeded>;
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(err).toMatchObject({ code: "budget_exceeded", needPaise: NEED, spentPaise: 0, budgetPaise: NEED - 1, scope: "job", purpose: "test", tier: "code", leftPaise: NEED - 1 });
    expect(r.router.calls).toHaveLength(0);
    expect((await jobs.getJobById(job.id))!.spentPaise).toBe(0);
  });

  it("allows a call that lands exactly on the budget, and counts what is already spent", async () => {
    const a = await jobWith(0, NEED);
    const ok = rig([answer("fits", { cost: 0 })], { jobs: a.jobs });
    await expect(callModel(ask({ jobId: a.job.id, budget: "job", messages: [{ role: "user", content: chars3500 }] }), ok.deps)).resolves.toMatchObject({ text: "fits" });

    const b = await jobWith(10, NEED + 9);
    const no = rig([answer("never")], { jobs: b.jobs });
    await expect(callModel(ask({ jobId: b.job.id, budget: "job", messages: [{ role: "user", content: chars3500 }] }), no.deps)).rejects.toMatchObject({ name: "BudgetExceeded", spentPaise: 10, leftPaise: NEED - 1 });
  });

  it("refuses a job with no budget at all (the default is 0), and reads the spend afresh before each call", async () => {
    const { jobs, job } = await jobWith(0, 0);
    const r = rig([answer("never")], { jobs });
    await expect(callModel(ask({ jobId: job.id, budget: "job" }), r.deps)).rejects.toBeInstanceOf(BudgetExceeded);

    const b = await jobWith(0, 1000);
    const two = rig([answer("one", { cost: 0.001 })], { jobs: b.jobs });
    await callModel(ask({ jobId: b.job.id, budget: "job" }), two.deps);
    // Somebody else spends the rest in between: the next call sees it.
    await b.jobs.casJob(b.job.id, {}, { spentPaise: 999 });
    await expect(callModel(ask({ jobId: b.job.id, budget: "job" }), two.deps)).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("holds a repair to the budget too: a first call that leaves too little is not followed by a second, and the ladder does not go on", async () => {
    const { jobs, job } = await jobWith(0, 150);
    // The first call costs 0.01 dollars (88 paise), so after it 62 are left and the repair needs more than that.
    const r = rig([answer("bad json", { cost: 0.01 }), answer('{"ok":1}')], { jobs });
    const err = await callModel(ask({ jobId: job.id, budget: "job", json: true, messages: [{ role: "user", content: "x".repeat(700) }] }), r.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(r.router.calls).toHaveLength(1);
    expect((await jobs.getJobById(job.id))!.spentPaise).toBe(88);
  });

  it("holds a retry to the budget, too", async () => {
    // The budget is cut to nothing between the failure and the retry, and the retry is refused.
    const { jobs, job } = await jobWith(0, 1000);
    const r = rig([async () => { await jobs.casJob(job.id, {}, { budgetPaise: 0 }); return httpError(503); }, answer("never")], { jobs });
    await expect(callModel(ask({ jobId: job.id, budget: "job", messages: [{ role: "user", content: "x".repeat(700) }] }), r.deps)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(r.router.calls).toHaveLength(1);
    expect(r.slept).toHaveLength(1);
  });

  it("holds a call without a job to its own maxPaise, repairs and retries included", async () => {
    const r = rig([answer("never")]);
    await expect(callModel(ask({ budget: { maxPaise: NEED - 1 }, messages: [{ role: "user", content: chars3500 }] }), r.deps))
      .rejects.toMatchObject({ name: "BudgetExceeded", scope: "call", budgetPaise: NEED - 1, spentPaise: 0 });
    expect(r.router.calls).toHaveLength(0);

    const ok = rig([answer("fine", { cost: 0 })]);
    await expect(callModel(ask({ budget: { maxPaise: NEED }, messages: [{ role: "user", content: chars3500 }] }), ok.deps)).resolves.toMatchObject({ text: "fine" });

    // A first call that spends 88 of 100 leaves no room for a repair.
    const rep = rig([answer("nope", { cost: 0.01 }), answer("{}")]);
    await expect(callModel(ask({ budget: { maxPaise: 100 }, json: true, messages: [{ role: "user", content: "x".repeat(350) }] }), rep.deps)).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("applies the job's budget even when a call ceiling is given, and needs a job for budget \"job\"", async () => {
    const { jobs, job } = await jobWith(0, 5);
    const r = rig([answer("never")], { jobs });
    await expect(callModel(ask({ jobId: job.id, budget: { maxPaise: 100_000 }, messages: [{ role: "user", content: chars3500 }] }), r.deps)).rejects.toMatchObject({ scope: "job" });
    await expect(callModel(ask({ budget: "job" }), r.deps)).rejects.toThrow(TypeError);
    await expect(callModel(ask({ jobId: "missing", budget: "job" }), r.deps)).rejects.toThrow(/no such job/);
  });
});

// --------------------------------------------------------------------- logs

describe("what is logged", () => {
  const SECRET_PROMPT = "PROMPT-SECRET-9f3a: the production database password is hunter2";
  const SECRET_ANSWER = "ANSWER-SECRET-77c1: here is the code you asked for";
  const SECRET_ERROR = "ERROR-SECRET-2b0e: provider echoed your prompt";

  let console_: Array<unknown[]>;
  beforeEach(() => {
    console_ = [];
    for (const m of ["info", "warn", "error", "log", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { console_.push(a); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("has the model, the purpose, the tokens, the time and the paise; never the messages, the answer or an error's words", async () => {
    const jobs = new MemoryJobStore();
    const job = await jobs.createJob({ userId: "alice", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 100_000 });
    const r = rig([Object.assign(new Error(SECRET_ERROR), { status: 400 }), answer(SECRET_ANSWER, { prompt_tokens: 321, completion_tokens: 45, cost: 0.005 })], { jobs, ledger: new MemoryRunStore() });
    await callModel(ask({ jobId: job.id, budget: "job", purpose: "write_code", messages: [{ role: "system", content: SECRET_PROMPT }, { role: "user", content: SECRET_PROMPT }] }), r.deps);

    const everything = JSON.stringify([r.lines, console_]);
    for (const secret of [SECRET_PROMPT, SECRET_ANSWER, SECRET_ERROR, "hunter2", "PROMPT-SECRET", "ANSWER-SECRET", "ERROR-SECRET"]) {
      expect(everything, secret).not.toContain(secret);
    }
    const ok = r.lines.find((l) => l.o.outcome === "ok")!;
    expect(ok.o).toMatchObject({ model: "b/two", purpose: "write_code", tier: "code", promptTokens: 321, completionTokens: 45, paise: usdToPaise(0.005, 88), outcome: "ok" });
    expect(ok.o.ms).toEqual(expect.any(Number));
    const failed = r.lines.find((l) => l.o.outcome === "failed")!;
    expect(failed.o).toMatchObject({ model: "a/one", status: 400, paise: 0 });
  });

  it("writes to the console by default, and still not a word of the content", async () => {
    const r = rig([answer(SECRET_ANSWER)], { log: undefined });
    await callModel(ask({ messages: [{ role: "user", content: SECRET_PROMPT }] }), r.deps);
    const lines = console_.flat().map(String).filter((s) => s.includes("[code-brain]"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toMatch(/"model":"a\/one"/);
    expect(JSON.stringify(console_)).not.toContain("SECRET");
  });

  it("keeps a failed JSON answer's words out of the log, though they are shown back to the model", async () => {
    const r = rig([answer(SECRET_ANSWER), answer('{"a":1}')]);
    await callModel(ask({ json: true, messages: [{ role: "user", content: SECRET_PROMPT }] }), r.deps);
    expect(JSON.stringify([r.lines, console_])).not.toContain("SECRET");
  });

  it("keeps the content out of the error it throws, too", async () => {
    const r = rig([Object.assign(new Error(SECRET_ERROR), { status: 400 })]);
    const err = await callModel(ask({ messages: [{ role: "user", content: SECRET_PROMPT }] }), r.deps).catch((e: unknown) => e) as Error;
    expect(err).toBeInstanceOf(ModelUnavailable);
    expect(JSON.stringify({ m: err.message, trail: (err as InstanceType<typeof ModelUnavailable>).trail })).not.toContain("SECRET");
  });
});

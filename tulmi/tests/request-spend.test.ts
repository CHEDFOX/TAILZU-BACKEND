/**
 * A REQUEST'S MODEL CALLS ARE ROUNDED UP TO THE PAISE ONCE, NOT ONCE PER CALL (src/code/brain/spend.ts inRequestSpend, gateway.ts, and the entry points that use it).
 *
 * Code jobs already did this (their calls carry the job id). The second real-model test found the rest still rounding per call: the front door, research and
 * artifact items read 3 to 6 times what the proxy charged (3 paise for 0.5), because a call with no job id was charged `ceil(its own cost)`. What these hold down:
 *   - calls inside `inRequestSpend` are charged against the request's running total: the sum is the total rounded up once, never low and never a paise high;
 *   - two requests at once do not share a total, and one request inside another is part of it (the front door's research);
 *   - a call outside any request is rounded by itself, as before;
 *   - the front door (decide, dispatch, ask), research, an artifact run, a bot's run and a bot's draft each open a request.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { callModel } = await import("../src/code/brain/gateway.js");
const { currentSpendScope, inRequestSpend } = await import("../src/code/brain/spend.js");
const { buildTierTable } = await import("../src/code/brain/tiers.js");
const { decide } = await import("../src/front/decide.js");
const { dispatch } = await import("../src/front/dispatch.js");
const { createFront, MemoryFrontStore, AttachmentRegistry } = await import("../src/front/index.js");
const { research } = await import("../src/web/research.js");
const { ArtifactModel } = await import("../src/artifacts/model.js");
const { ctx, model, decideJson, fakeHandlers } = await import("./front-rig.js");
const { ALICE, rig: botsRig, def } = await import("./bots-rig.js");
const { defaultGuard } = await import("../src/guard/index.js");
type GatewayDeps = import("../src/code/brain/gateway.js").GatewayDeps;

// ------------------------------------------------------------------ the arithmetic, through the real gateway

const tiers = buildTierTable();
/** $0.000045 a call: 0.396 paise at 88 rupees to the dollar. Five of them are 1.98 paise, which is 2; each by itself is 1. */
const COST_USD = 0.000045;
const client = () => ({
  chat: { completions: { create: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: COST_USD } }) } },
});
const deps = (): GatewayDeps => ({ client: client(), tiers, fx: 88, ledger: null, breakers: null, log: { info: () => undefined, warn: () => undefined } });
const small = (n = 1) => callModel({ tier: "tiny", messages: [{ role: "user", content: `question ${n}` }], purpose: "test", budget: "none" }, deps());
const paiseOf = async (n: number): Promise<number[]> => {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push((await small(i)).paise);
  return out;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("one request, one rounding", () => {
  it("charges a request's calls against its running total: five calls of 0.396 paise are 2 paise, not 5", async () => {
    const got = await inRequestSpend(() => paiseOf(5));
    expect(sum(got)).toBe(2);
    expect(got.every((p) => p === 0 || p === 1)).toBe(true);
  });

  it("leaves a call outside any request rounded by itself, as it was", async () => {
    expect(currentSpendScope()).toBeUndefined();
    expect(await paiseOf(5)).toEqual([1, 1, 1, 1, 1]);
  });

  it("keeps two requests at once apart: each rounds its own total", async () => {
    const [a, b] = await Promise.all([inRequestSpend(() => paiseOf(5)), inRequestSpend(() => paiseOf(5))]);
    expect(sum(a)).toBe(2);
    expect(sum(b)).toBe(2);
  });

  it("treats a request inside a request as part of it", async () => {
    const got = await inRequestSpend(async () => {
      const outer = (await paiseOf(2)).concat(await inRequestSpend(() => paiseOf(3)));
      return outer;
    });
    expect(sum(got)).toBe(2);
  });

  it("gives the next request a fresh count", async () => {
    expect(sum(await inRequestSpend(() => paiseOf(5)))).toBe(2);
    expect(sum(await inRequestSpend(() => paiseOf(5)))).toBe(2);
  });

  it("never reads low: whatever the number of calls, the sum is the exact total rounded up", async () => {
    for (const n of [1, 2, 3, 7, 10, 25]) {
      const exact = n * COST_USD * 88 * 100;
      expect(sum(await inRequestSpend(() => paiseOf(n)))).toBe(Math.ceil(Number(exact.toFixed(6))));
    }
  });
});

// ------------------------------------------------------------------ the entry points open one

/** The scopes seen by a function called under an entry point: all defined, and how many different. */
const distinct = (scopes: Array<string | undefined>) => ({ defined: scopes.every((s) => typeof s === "string"), count: new Set(scopes).size });

describe("the entry points", () => {
  it("front door: decide opens one for its small-model read", async () => {
    const seen: Array<string | undefined> = [];
    const m = model(() => { seen.push(currentSpendScope()); return decideJson({ confidence: 0.5 }); });
    await decide("hmm, that thing from before, can you do it", ctx(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(seen.length).toBeGreaterThan(0);
    expect(distinct(seen)).toEqual({ defined: true, count: 1 });
  });

  it("front door: dispatch opens one for every road it calls, the picture beside the answer included", async () => {
    const seen: Array<string | undefined> = [];
    const h = fakeHandlers({
      async reply() { seen.push(currentSpendScope()); return { text: "A reply.", paise: 3 }; },
      async artifact(c) { seen.push(currentSpendScope()); return { artifact: { id: "a", type: "mermaid", title: "t", version: 1, kind: c.visual.kind as never, paise: 0 }, paise: 0 }; },
    });
    const d = await decide("what is the capital of France?", ctx(), { call: model().call, tiers, fx: 88, jobBudgetPaise: 3000 });
    await dispatch({ ...d, shape: { ...d.shape, visual: { kind: "diagram", via: "artifact" } as never } }, "what is the capital of France?", ctx(), {
      handlers: h.handlers, store: new MemoryFrontStore(), daily: undefined as never,
    } as never);
    expect(seen.length).toBe(2);
    expect(distinct(seen)).toEqual({ defined: true, count: 1 });
  });

  it("front door: ask is one request over the decision and the road", async () => {
    const seen: Array<string | undefined> = [];
    const m = model(() => { seen.push(currentSpendScope()); return decideJson({ confidence: 0.5 }); });
    const h = fakeHandlers({ async reply() { seen.push(currentSpendScope()); return { text: "A reply.", paise: 3 }; } });
    const front = createFront({ force: true, handlers: h.handlers, store: new MemoryFrontStore(), guard: defaultGuard(), call: m.call, attachments: new AttachmentRegistry(), gateway: { tiers, fx: 88 } });
    await front!.ask("hmm, that thing from before, can you do it", ctx());
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(distinct(seen)).toEqual({ defined: true, count: 1 });
  });

  it("research: the plan, the answer and anything between are one request", async () => {
    const seen: Array<string | undefined> = [];
    const ask = async () => { seen.push(currentSpendScope()); return { text: "An answer [1].\n\nGAPS: none", paise: 1 }; };
    const hit = { title: "Docs", url: "https://docs.example.com/a", snippet: "s", source: "ddg", score: 0.9, reasons: [], meta: { kind: "page" } };
    await research("how do I do the thing", {
      depth: "quick", ask: ask as never,
      search: (async (q: string) => ({ plan: { intent: "how_to", queries: [q], sources: [], freshness: "any", confidence: 0.9 }, results: [hit], via: [], cached: false })) as never,
      read: (async (url: string) => ({ url, finalUrl: url, title: "Docs", text: "Documentation text about the thing. ".repeat(40), headings: [], fetchedAt: 0 })) as never,
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(distinct(seen)).toEqual({ defined: true, count: 1 });
  });

  it("artifacts: a run and its continuation after a cut-off are one request", async () => {
    const seen: Array<string | undefined> = [];
    let n = 0;
    const call = (async () => {
      seen.push(currentSpendScope());
      n += 1;
      return { text: n === 1 ? "<svg viewBox='0 0 1 1'>" : "</svg>", json: undefined, toolCalls: [], model: "fake/x", promptTokens: 1, completionTokens: 1, costUsd: 0, paise: 1, costSource: "reported", truncated: n === 1, ms: 1, calls: 1, trail: [] };
    }) as never;
    const ran = await new ArtifactModel({ call }).run<string>({
      userId: ALICE, tier: "code", purpose: "artifact.test", role: "artifact_make", artifact: "<artifact/>", instruction: "make it", maxTokens: 100, capPaise: 50,
      accept: (t) => (t.includes("</svg>") ? { ok: true, value: t } : { ok: false, reason: "not whole" }),
    });
    expect(ran.continued).toBe(true);
    expect(seen).toHaveLength(2);
    expect(distinct(seen)).toEqual({ defined: true, count: 1 });
  });

  it("bots: a run is one request over all its turns", async () => {
    const seen: Array<string | undefined> = [];
    const r = await botsRig(() => { seen.push(currentSpendScope()); return "Done."; });
    await r.bots.create(ALICE, def({ slug: "buddy" }));
    await r.bots.ask(ALICE, "buddy", { message: "hello" });
    expect(seen.length).toBeGreaterThan(0);
    expect(distinct(seen)).toEqual({ defined: true, count: 1 });
  });

  it("bots: a draft is one request over its calls", async () => {
    const seen: Array<string | undefined> = [];
    // The draft is refused by the schema (the model's JSON is incomplete), which climbs a tier: more than one call, all of them one request.
    const r = await botsRig(() => { seen.push(currentSpendScope()); return { json: { name: "Helper" } }; });
    await r.bots.draft(ALICE, "a bot that keeps my gym week on track").catch(() => undefined);
    expect(seen.length).toBeGreaterThan(0);
    expect(distinct(seen)).toEqual({ defined: true, count: 1 });
  });
});

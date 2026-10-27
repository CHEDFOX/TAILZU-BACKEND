/**
 * The model bake-off's logic, with no model and no network: the capability filter, the numbers and the early-stop rule, the ladder builder, the dry plan, the
 * edit-format appliers, the probes against a simulated model, the engine's rounds, the model x agent grid and the new-models watcher.
 */
import { describe, expect, it } from "vitest";
import { parseCatalog, type Catalog } from "../e2e/catalog.js";
import { filterPools } from "../e2e/bakeoff/capability.js";
import { Engine, pinnedTiers, summarize, type Summary } from "../e2e/bakeoff/engine.js";
import { EDIT_CASES, applyReply, scoreEditFormats } from "../e2e/bakeoff/editformat.js";
import { buildLadders } from "../e2e/bakeoff/ladders.js";
import { planBakeoff, renderPlan } from "../e2e/bakeoff/plan.js";
import { loadPools, type Pools } from "../e2e/bakeoff/pools.js";
import { ALL_PROBES, TINY_PROBES, runProbe } from "../e2e/bakeoff/probes.js";
import { quality, simClient, simPass } from "../e2e/bakeoff/sim.js";
import { MIN_N, clearlyWorse, costPerPass, leaderOf, quantile, toDrop, wilson } from "../e2e/bakeoff/stats.js";
import { losingPair, summarizeGrid, type PairResult } from "../e2e/bakeoff/grid.js";
import { makeModelKit } from "../e2e/adapters/rig.js";
import { MemoryJobStore } from "../src/code/jobs/store.js";
import { newModels } from "../scripts/models-watch.js";

const raw = (id: string, o: { inP?: number; outP?: number; tools?: boolean; image?: boolean; created?: number } = {}) => ({
  id, created: o.created ?? 1_700_000_000, context_length: 100_000,
  pricing: { prompt: String((o.inP ?? 0.1) / 1e6), completion: String((o.outP ?? 0.5) / 1e6) },
  architecture: { input_modalities: o.image ? ["text", "image"] : ["text"] }, supported_parameters: o.tools === false ? ["max_tokens"] : ["tools", "response_format"],
});

const catalogOf = (models: ReturnType<typeof raw>[], source: Catalog["source"] = "live"): Catalog => ({ fetchedAt: 1, source, models: parseCatalog({ data: models }) });

describe("the capability filter", () => {
  const pools: Pools = {
    tiers: { tiny: ["a/one"], cheap: ["a/one"], code: ["a/tools", "a/notools", "a/gone"], strong: ["a/tools"], vision: ["a/blind", "a/eyes"] },
    writingOnly: ["w/writer", "w/missing"], needs: { tiny: [], cheap: [], code: ["tools"], strong: ["tools"], vision: ["image"] }, families: ["a", "w"],
  };
  const cat = catalogOf([raw("a/one"), raw("a/tools"), raw("a/notools", { tools: false }), raw("a/blind"), raw("a/eyes", { image: true }), raw("w/writer", { tools: false })]);

  it("drops a model without tools from a tool tier, one without images from vision, and one the catalog does not know, each with its reason", () => {
    const f = filterPools(pools, cat);
    expect(f.candidates.code.map((c) => c.slug)).toEqual(["a/tools"]);
    expect(f.candidates.vision.map((c) => c.slug)).toEqual(["a/eyes"]);
    expect(f.candidates.tiny.map((c) => c.slug)).toEqual(["a/one"]);
    const why = (slug: string) => f.excluded.find((e) => e.slug === slug)!.reason;
    expect(why("a/notools")).toMatch(/no tool support/);
    expect(why("a/blind")).toMatch(/no image input/);
    expect(why("a/gone")).toMatch(/not in OpenRouter's catalog/);
    expect(f.writing.map((w) => w.slug)).toEqual(["w/writer"]);
    expect(f.excluded.some((e) => e.slug === "w/missing")).toBe(true);
  });

  it("records prices per million tokens, and says the catalog was unreadable rather than guessing", () => {
    const f = filterPools(pools, cat);
    expect(f.candidates.tiny[0]!.info.inUsdPerM).toBeCloseTo(0.1);
    expect(f.candidates.tiny[0]!.info.outUsdPerM).toBeCloseTo(0.5);
    const none = filterPools(pools, catalogOf([], "none"));
    expect(none.excluded.every((e) => /could not be read/.test(e.reason))).toBe(true);
  });

  it("the shipped pools are the ones in the brief, and each tier names what its roles need", () => {
    const p = loadPools();
    expect(p.tiers.tiny).toEqual(["qwen/qwen3.7-flash", "openai/gpt-6-luna", "anthropic/claude-haiku-5.5", "minimax/minimax-m3.1-flash"]);
    expect(p.tiers.code).toContain("moonshotai/kimi-k2.7-code");
    expect(p.tiers.strong).toContain("anthropic/claude-sonnet-5.5");
    expect(p.writingOnly).toEqual(["nousresearch/hermes-4-405b"]);
    expect(p.needs.vision).toEqual(["image"]);
    expect(p.needs.code).toEqual(["tools"]);
  });
});

describe("the numbers and the early-stop rule", () => {
  it("gives a Wilson interval that narrows with more results and stays inside 0..1", () => {
    const small = wilson(5, 10);
    const large = wilson(50, 100);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
    expect(wilson(10, 10).hi).toBeLessThanOrEqual(1);
    expect(wilson(0, 10).lo).toBe(0);
  });

  it("computes cost per pass, infinite when nothing passed, and percentiles", () => {
    expect(costPerPass({ pass: 4, n: 10, costUsd: 2 })).toBe(0.5);
    expect(costPerPass({ pass: 0, n: 10, costUsd: 2 })).toBe(Number.POSITIVE_INFINITY);
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 100], 0.95)).toBe(100);
    expect(quantile([], 0.5)).toBe(0);
  });

  it("drops a candidate only when the leader is clearly better (intervals apart) AND no dearer per pass", () => {
    const leader = { pass: 19, n: 20, costUsd: 1 };
    expect(clearlyWorse(leader, { pass: 5, n: 20, costUsd: 1 })).toBe(true);
    expect(clearlyWorse(leader, { pass: 5, n: 20, costUsd: 0.1 })).toBe(false); // cheaper per pass than the leader: not dominated
    expect(clearlyWorse(leader, { pass: 17, n: 20, costUsd: 1 })).toBe(false); // intervals overlap
    expect(clearlyWorse({ pass: 3, n: 3, costUsd: 1 }, { pass: 0, n: 3, costUsd: 1 })).toBe(false); // too few results to say
    expect(MIN_N).toBe(8);
  });

  it("finds the leader (best rate, cheaper per pass among ties) and never leaves a tier below its keep count", () => {
    const rows = [
      { id: "a", pass: 19, n: 20, costUsd: 2 }, { id: "b", pass: 19, n: 20, costUsd: 1 }, { id: "c", pass: 2, n: 20, costUsd: 1 }, { id: "d", pass: 1, n: 20, costUsd: 1 },
    ];
    expect(leaderOf(rows)!.id).toBe("b");
    expect(toDrop(rows, 2).sort()).toEqual(["c", "d"]);
    expect(toDrop(rows, 3)).toEqual(["d"]);
    expect(toDrop(rows, 4)).toEqual([]);
    expect(toDrop([], 2)).toEqual([]);
  });
});

const summary = (o: Partial<Summary> & { slug: string; tier: Summary["tier"] }): Summary => ({
  quality: 0.9, passRate: { probes: 0.9, evals: 0.9, tasks: null }, costPerPassUsd: 0.01, latencyP50Ms: 500, latencyP95Ms: 900, errorRate: 0, jsonRepairs: 0, badToolCalls: 0, calls: 10, simulated: false, priceInUsdPerM: 0.1, priceOutUsdPerM: 0.5, ...o,
});

describe("automatic ladders", () => {
  it("orders the survivors above the quality floor by cost per pass, cheapest first, and writes CODE_MODEL_TIERS", () => {
    const l = buildLadders([
      summary({ tier: "code", slug: "deepseek/a", quality: 0.8, costPerPassUsd: 0.02 }), summary({ tier: "code", slug: "z-ai/b", quality: 0.95, costPerPassUsd: 0.01 }),
      summary({ tier: "code", slug: "qwen/c", quality: 0.6, costPerPassUsd: 0.001 }), summary({ tier: "code", slug: "moonshotai/d", quality: 0.9, costPerPassUsd: 0.5, dropped: { round: "evals", why: "x" } }),
    ], 88);
    expect(l.tiers.code!.models).toEqual(["z-ai/b", "deepseek/a"]);
    const value = JSON.parse(l.codeModelTiers) as Record<string, { models: string[] }>;
    expect(value.code!.models).toEqual(["z-ai/b", "deepseek/a"]);
    expect(l.tiers.code!.why[0]!.costPerPassInr).toBeCloseTo(0.88, 3);
  });

  it("falls back to the single best survivor when nothing meets the floor, and says so; leaves a tier out when nobody survived", () => {
    const l = buildLadders([summary({ tier: "tiny", slug: "a/x", quality: 0.5 }), summary({ tier: "tiny", slug: "a/y", quality: 0.4 }), summary({ tier: "vision", slug: "a/z", dropped: { round: "probes", why: "x" } })], 88);
    expect(l.tiers.tiny!.models).toEqual(["a/x"]);
    expect(l.tiers.tiny!.note).toMatch(/quality floor/);
    expect(l.tiers.vision).toBeUndefined();
    expect(l.notes.join(" ")).toMatch(/vision: no candidate survived/);
  });

  it("caps a ladder at four rungs, and builds a review pool only from several families", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((v, i) => summary({ tier: "code", slug: `${v}/m`, costPerPassUsd: 0.01 * (i + 1) }));
    const l = buildLadders(many, 88);
    expect(l.tiers.code!.models.length).toBe(4);
    expect(l.tiers.review!.models.length).toBeGreaterThanOrEqual(2);
    expect(buildLadders([summary({ tier: "code", slug: "a/m1" }), summary({ tier: "code", slug: "a/m2" })], 88).tiers.review).toBeUndefined();
  });

  it("names one indic model only when it clearly leads the Hindi probe", () => {
    const l = buildLadders([summary({ tier: "cheap", slug: "a/x", hindi: 1 }), summary({ tier: "cheap", slug: "b/y", hindi: 0.5 })], 88);
    expect(l.codeIndicModel).toBe("a/x");
    expect(buildLadders([summary({ tier: "cheap", slug: "a/x", hindi: 0.6 })], 88).codeIndicModel).toBeUndefined();
  });
});

describe("the dry plan", () => {
  it("estimates the cost per round in rupees, and less with the early stop", () => {
    const pools = loadPools();
    const models = [...new Set(Object.values(pools.tiers).flat())].map((id) => raw(id, { tools: true, image: true, inP: 0.2, outP: 1 }));
    const f = filterPools(pools, catalogOf(models));
    const plan = planBakeoff(f, { fx: 88, tiers: ["tiny", "code"], evalRuns: 1, taskCount: 6, editFormat: true, probesOnly: false, needleTokens: 30_000 });
    expect(plan.tiers.map((t) => t.tier)).toEqual(["tiny", "code"]);
    expect(plan.totalInr).toBeGreaterThan(0);
    expect(plan.earlyInr).toBeLessThan(plan.totalInr);
    expect(plan.tiers[1]!.inr.tasks).toBeGreaterThan(plan.tiers[0]!.inr.tasks);
    expect(plan.tiers[1]!.inr.edit).toBeGreaterThan(0);
    const probesOnly = planBakeoff(f, { fx: 88, tiers: ["code"], evalRuns: 1, taskCount: 6, editFormat: false, probesOnly: true, needleTokens: 30_000 });
    expect(probesOnly.totalInr).toBeLessThan(plan.tiers[1]!.inr.total);
    expect(renderPlan(plan)).toMatch(/TOTAL: ₹/);
  });
});

describe("the edit-format probe", () => {
  const c = EDIT_CASES.find((x) => x.id === "guard")!;
  const goodExact = JSON.stringify({ edits: [{ old: "function displayName(user) {\n", new: "function displayName(user) {\n  if (user == null) return 'anonymous'\n" }] });
  const goodBlocks = "<<<<<<< SEARCH\nfunction displayName(user) {\n=======\nfunction displayName(user) {\n  if (user == null) return 'anonymous'\n>>>>>>> REPLACE";
  const goodDiff = "--- a/src/user.js\n+++ b/src/user.js\n@@ -1,3 +1,4 @@\n function displayName(user) {\n+  if (user == null) return 'anonymous'\n   const first = user.first || ''\n   const last = user.last || ''\n";

  it("applies each format's right answer to exactly the intended file", () => {
    for (const [format, reply] of [["exact", goodExact], ["blocks", goodBlocks], ["diff", goodDiff]] as const) {
      const r = applyReply(format, c, reply);
      expect(r.ok, format).toBe(true);
      if (r.ok) expect(r.text.trimEnd()).toBe(c.after.trimEnd());
    }
    expect(applyReply("exact", c, `\`\`\`json\n${goodExact}\n\`\`\``).ok).toBe(true);
  });

  it("refuses an edit that does not apply: old text missing or occurring twice, no block, a diff that matches nothing", () => {
    expect(applyReply("exact", c, JSON.stringify({ edits: [{ old: "not there", new: "x" }] }))).toMatchObject({ ok: false });
    expect(applyReply("exact", c, JSON.stringify({ edits: [{ old: "user", new: "x" }] }))).toMatchObject({ ok: false, why: expect.stringMatching(/times/) });
    expect(applyReply("exact", c, "I think you should add a null check")).toMatchObject({ ok: false });
    expect(applyReply("blocks", c, "no blocks here")).toMatchObject({ ok: false });
    expect(applyReply("diff", c, "--- a/src/user.js\n+++ b/src/user.js\n@@ -1 +1 @@\n-nothing like it\n+x\n")).toMatchObject({ ok: false });
  });

  it("scores a model per format against the ten edits, and picks the best format", async () => {
    const kit = makeModelKit({ mode: "real", client: simClient() }, new MemoryJobStore()).kit;
    const s = await scoreEditFormats((input) => kit.call(input) as never, { formats: ["exact", "blocks", "diff"] });
    expect(s.calls).toBe(30);
    expect(Object.keys(s.rates).sort()).toEqual(["blocks", "diff", "exact"]);
    expect(s.rates[s.best]).toBe(Math.max(...Object.values(s.rates)));
  }, 60_000);
});

describe("the probes, against a simulated model", () => {
  const kitOf = (slug: string) => makeModelKit({ mode: "real", tiers: pinnedTiers(slug, undefined), client: simClient({ priceOf: () => ({ inUsdPerM: 1, outUsdPerM: 2 }) }) }, new MemoryJobStore()).kit;
  const good = ["a/model-1", "b/model-2", "c/model-3", "d/model-4", "e/model-5", "f/model-6", "g/model-7", "h/model-8"].find((s) => quality(s) > 0.9)!;

  it("has the six tiny probes and two heavy ones, and each probe declares what it needs", () => {
    expect(TINY_PROBES.map((p) => p.id)).toEqual(["tool_call", "json_contract", "principles", "hindi", "image", "tool_loop3"]);
    expect(ALL_PROBES.filter((p) => p.full).map((p) => p.id)).toEqual(["tool_loop15", "needle"]);
    expect(TINY_PROBES.find((p) => p.id === "image")!.needs).toEqual(["image"]);
    expect(TINY_PROBES.find((p) => p.id === "tool_call")!.needs).toEqual(["tools"]);
  });

  it("scores a good simulated model high on every probe and a poor one lower, deterministically", async () => {
    const all = ["a/m1", "b/m2", "c/m3", "d/m4", "e/m5", "f/m6", "g/m7", "h/m8", "i/m9", "j/m10"];
    const results: Record<string, number> = {};
    for (const slug of all) {
      const kit = kitOf(slug);
      let total = 0;
      for (const p of TINY_PROBES) total += (await runProbe(p, { slug, call: (i) => kit.call(i) as never })).score;
      results[slug] = total / TINY_PROBES.length;
      const again = kitOf(slug);
      let total2 = 0;
      for (const p of TINY_PROBES) total2 += (await runProbe(p, { slug, call: (i) => again.call(i) as never })).score;
      expect(total2 / TINY_PROBES.length).toBe(results[slug]);
    }
    const best = all.reduce((a, b) => (results[a]! >= results[b]! ? a : b));
    const worst = all.reduce((a, b) => (results[a]! <= results[b]! ? a : b));
    expect(results[best]!).toBeGreaterThan(results[worst]!);
    expect(good).toBeDefined();
  }, 60_000);

  it("a probe that throws is a failed probe, not a crash", async () => {
    const r = await runProbe(TINY_PROBES[0]!, { slug: "x/y", call: async () => { throw new Error("down"); } });
    expect(r.pass).toBe(false);
    expect(r.errors.failed).toBeGreaterThan(0);
  });

  it("the simulation draws the same answer for the same question", () => {
    expect(simPass("a/x", "t", 1)).toBe(simPass("a/x", "t", 1));
    expect(quality("a/x")).toBeGreaterThanOrEqual(0.35);
    expect(quality("a/x")).toBeLessThanOrEqual(0.97);
  });
});

describe("the engine's rounds", () => {
  const pools: Pools = { tiers: { tiny: ["a/q", "b/q", "c/q", "d/q"], cheap: [], code: [], strong: [], vision: [] }, writingOnly: [], needs: { tiny: [], cheap: [], code: [], strong: [], vision: [] }, families: [] };
  const cat = catalogOf(["a/q", "b/q", "c/q", "d/q"].map((id) => raw(id)));

  it("runs the probe round on simulated models, keeps the survivors, and summarizes quality, cost and latency", async () => {
    const f = filterPools(pools, cat);
    const engine = new Engine({ mode: "sim", catalog: cat, fx: 88, early: true, keep: 2, wave: 8, evalRuns: 1, editFormat: false, needleChars: 1000, log: () => undefined });
    for (const c of f.candidates.tiny) engine.add(c);
    await engine.probeRound("tiny");
    const rows = engine.alive("tiny");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of engine.rows.values()) {
      expect(r.probes.n).toBe(r.probeResults.length);
      expect(r.probes.n).toBeGreaterThan(0);
      const s = summarize(r);
      expect(s.quality).toBeGreaterThanOrEqual(0);
      expect(s.quality).toBeLessThanOrEqual(1);
      expect(s.simulated).toBe(true);
    }
  }, 60_000);

  it("drops a clearly losing candidate between waves of the role evals, and says in which round", async () => {
    const f = filterPools(pools, cat);
    const engine = new Engine({ mode: "sim", catalog: cat, fx: 88, early: true, keep: 2, wave: 8, evalRuns: 1, editFormat: false, needleChars: 1000, log: () => undefined });
    for (const c of f.candidates.tiny) engine.add(c);
    await engine.evalRound("tiny");
    const dropped = [...engine.rows.values()].filter((r) => r.dropped);
    for (const r of dropped) expect(r.dropped!.round).toBe("evals");
    expect(engine.alive("tiny").length).toBeGreaterThanOrEqual(2);
    // With the early stop off nobody is dropped.
    const all = new Engine({ mode: "sim", catalog: cat, fx: 88, early: false, keep: 2, wave: 8, evalRuns: 1, editFormat: false, needleChars: 1000, log: () => undefined });
    for (const c of f.candidates.tiny) all.add(c);
    await all.evalRound("tiny");
    expect([...all.rows.values()].every((r) => !r.dropped)).toBe(true);
  }, 60_000);
});

describe("the model x agent grid", () => {
  const pair = (model: string, agent: string, wins: boolean[], cost = 1): PairResult => ({ model, agent, simulated: true, tasks: wins.map((w, i) => ({ id: `t${i}`, success: w, costUsd: cost, ms: 1 })) });

  it("reports the best scaffold per model and the best model per scaffold: pass rate first, then cost per pass", () => {
    const s = summarizeGrid([pair("m1", "tailzu", [true, true, false]), pair("m1", "aider", [true, true, true]), pair("m2", "tailzu", [true, true, true], 2), pair("m2", "aider", [true, true, true], 0.5)]);
    expect(s.bestAgentPerModel).toEqual({ m1: "aider", m2: "aider" });
    expect(s.bestModelPerAgent).toEqual({ tailzu: "m2", aider: "m2" });
  });

  it("stops a pair after two tasks only when it passed none and another passed at least one at no higher cost per pass", () => {
    const losing = pair("m", "a", [false, false]);
    expect(losingPair(losing, [pair("m2", "a", [true, false])])).toBe(true);
    expect(losingPair(losing, [pair("m2", "a", [false, false])])).toBe(false);
    expect(losingPair(pair("m", "a", [false, true]), [pair("m2", "a", [true, true])])).toBe(false);
    expect(losingPair(pair("m", "a", [false]), [pair("m2", "a", [true, true])])).toBe(false);
  });
});

describe("the new-models watcher", () => {
  const cat = { models: new Map([["a/old", { id: "a/old", created: 1 }], ["a/new", { id: "a/new", created: 2_000_000_000 }], ["a/pooled", { id: "a/pooled", created: 2_000_000_000 }], ["z/other", { id: "z/other", created: 2_000_000_000 }], ["a/free:free", { id: "a/free:free", created: 2_000_000_000 }]]) };
  const pools = { tiers: { tiny: ["a/pooled"] }, writingOnly: [], families: ["a"] };

  it("lists what was not seen before, from the watched families, in no pool, ignoring variants", () => {
    expect(newModels(cat, pools, { at: "x", ids: ["a/old"] })).toEqual(["a/new"]);
    expect(newModels(cat, pools, { at: "x", ids: ["a/old", "a/new"] })).toEqual([]);
  });

  it("on a first run reports the recent ones only, and --all every model of the families in no pool", () => {
    expect(newModels(cat, pools, null, { now: 2_000_000_000 * 1000 + 86_400_000 })).toEqual(["a/new"]);
    expect(newModels(cat, pools, null, { all: true })).toEqual(["a/new", "a/old"]);
  });
});

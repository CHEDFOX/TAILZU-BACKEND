/**
 * THE CODE BOT'S STEP ROUTER (src/code/brain/route.ts): which tier, and which
 * model, for a step.
 *
 * What these hold down:
 *   - the mapping, step by step and by request: plan, write_code, review, the
 *     cheap steps, vision, indic, research;
 *   - climbing one tier (tiny, cheap, code, strong) on two failures, low
 *     confidence, or more than ten files, from the higher of where the step
 *     belongs and where it was last tried, and never past strong;
 *   - review picks a model of a different family from the writer's;
 *   - the budget: the chosen tier if it can be afforded, else the cheapest
 *     tier that can still do the step, else a stop (and never below code for a
 *     plan or write_code);
 *   - learning: the cheapest model with at least 20 tries and 85% successes is
 *     named first within the tier, and only then.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { CLIMB_LADDER, baseTier, climbReasons, planRoute, routeStep } = await import("../src/code/brain/route.js");
const { MIN_SAMPLES, MIN_SUCCESS_RATE, MemoryRouteStatsStore, lookupOf, preferredModel } = await import("../src/code/brain/stats.js");
const { buildTierTable, familyOf } = await import("../src/code/brain/tiers.js");
const { worstCasePaise } = await import("../src/code/brain/money.js");
type Classification = import("../src/code/brain/types.js").Classification;
type StepName = import("../src/code/brain/types.js").StepName;
type ModelTier = import("../src/code/brain/tiers.js").ModelTier;
type RouteStat = import("../src/code/brain/stats.js").RouteStat;

const tiers = buildTierTable();

const cls = (over: Partial<Classification> = {}): Classification => ({
  type: "feature", difficulty: "medium", risk: "low", needs: { web: false, exec: false, vision: false, indic: false },
  language: "en", confidence: 0.9, signals: [], ...over,
});

const route = (step: StepName, c = cls(), history = {}, opts = {}) => routeStep(step, c, history, { tiers, ...opts });
const tierOf = (r: ReturnType<typeof route>) => r.tier;

// --------------------------------------------------------------- the mapping

describe("the mapping", () => {
  type Row = [StepName, Partial<Classification>, ModelTier];
  const rows: Row[] = [
    ["classify", {}, "tiny"],
    ["classify", { type: "plan_project", risk: "high", difficulty: "high" }, "tiny"],
    ["search", {}, "cheap"],
    ["summarize", { difficulty: "high" }, "cheap"],
    ["index", { risk: "high" }, "cheap"],
    // plan: strong when difficulty or risk is high or the request is a new project, else code.
    ["plan", { difficulty: "low", risk: "low" }, "code"],
    ["plan", { difficulty: "medium", risk: "medium" }, "code"],
    ["plan", { difficulty: "high" }, "strong"],
    ["plan", { risk: "high" }, "strong"],
    ["plan", { type: "plan_project", difficulty: "low", risk: "low" }, "strong"],
    ["plan", { type: "bug_fix", difficulty: "medium", risk: "low" }, "code"],
    // write_code: code, or strong when the risk is high.
    ["write_code", {}, "code"],
    ["write_code", { difficulty: "high" }, "code"],
    ["write_code", { type: "plan_project" }, "code"],
    ["write_code", { risk: "medium" }, "code"],
    ["write_code", { risk: "high" }, "strong"],
    ["review", {}, "review"],
    ["vision", {}, "vision"],
    ["indic_text", { language: "hi" }, "indic"],
    // research: cheap for an easy request, else code.
    ["research", { difficulty: "low" }, "cheap"],
    ["research", { difficulty: "medium" }, "code"],
    ["research", { difficulty: "high" }, "code"],
  ];
  it.each(rows.map((r) => [`${r[0]} ${JSON.stringify(r[1])} -> ${r[2]}`, ...r] as const))("%s", (_n, step, over, tier) => {
    const got = route(step, cls(over));
    expect(got.tier).toBe(tier);
    expect(got.stop).toBeUndefined();
    expect(got.reason).toEqual(expect.any(String));
    expect(got.reason.length).toBeGreaterThan(0);
  });

  it("covers every step", () => {
    const steps: StepName[] = ["classify", "search", "summarize", "index", "plan", "write_code", "review", "vision", "indic_text", "research"];
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(steps));
  });

  it("names a model only when there is a reason to: the ladder's order is the default, a review always names one", () => {
    expect(route("write_code").model).toBeUndefined();
    expect(route("classify").model).toBeUndefined();
    expect(route("review").model).toBe("anthropic/claude-haiku-5.5");
  });

  it("says why, in plain words", () => {
    expect(baseTier("plan", cls({ type: "plan_project" })).why).toMatch(/new project/);
    expect(route("write_code", cls({ risk: "high" })).reason).toMatch(/risky/);
  });
});

// ------------------------------------------------------------------- climbing

describe("climbing", () => {
  it("climbs one tier on two failures, on low confidence, and on more than ten files; not on one failure or ten files", () => {
    expect(tierOf(route("write_code", cls(), { failures: 0 }))).toBe("code");
    expect(tierOf(route("write_code", cls(), { failures: 1 }))).toBe("code");
    expect(tierOf(route("write_code", cls(), { failures: 2 }))).toBe("strong");
    expect(tierOf(route("write_code", cls(), { failures: 5 }))).toBe("strong");
    expect(tierOf(route("write_code", cls(), { lowConfidence: true }))).toBe("strong");
    expect(tierOf(route("write_code", cls(), { filesTouched: 10 }))).toBe("code");
    expect(tierOf(route("write_code", cls(), { filesTouched: 11 }))).toBe("strong");
    expect(tierOf(route("write_code", cls(), { failures: 1, filesTouched: 3, lowConfidence: false }))).toBe("code");
    expect(climbReasons({ failures: 2, lowConfidence: true, filesTouched: 11 })).toEqual(["2 failures", "low confidence", "11 files touched"]);
    expect(climbReasons({})).toEqual([]);
  });

  it("climbs the ladder tiny, cheap, code, strong, one rung from the step's own tier", () => {
    expect(CLIMB_LADDER).toEqual(["tiny", "cheap", "code", "strong"]);
    const bad = { failures: 2 };
    expect(tierOf(route("classify", cls(), bad))).toBe("cheap");
    expect(tierOf(route("search", cls(), bad))).toBe("code");
    expect(tierOf(route("summarize", cls(), bad))).toBe("code");
    expect(tierOf(route("research", cls({ difficulty: "low" }), bad))).toBe("code");
    expect(tierOf(route("research", cls({ difficulty: "high" }), bad))).toBe("strong");
    expect(tierOf(route("plan", cls(), bad))).toBe("strong");
    expect(tierOf(route("write_code", cls(), bad))).toBe("strong");
  });

  it("goes from the higher of the step's tier and the tier it was last tried on, then stays there", () => {
    const bad = { failures: 2 };
    expect(tierOf(route("search", cls(), { ...bad, lastTier: "cheap" }))).toBe("code");
    expect(tierOf(route("search", cls(), { ...bad, lastTier: "code" }))).toBe("strong");
    expect(tierOf(route("write_code", cls(), { ...bad, lastTier: "tiny" }))).toBe("strong");
    expect(tierOf(route("write_code", cls(), { ...bad, lastTier: "code" }))).toBe("strong");
    // Not failing any more, it is back at its own tier.
    expect(tierOf(route("write_code", cls(), { failures: 0, lastTier: "strong" }))).toBe("code");
  });

  it("never climbs past strong", () => {
    const bad = { failures: 9, lowConfidence: true, filesTouched: 99 };
    for (const lastTier of [undefined, "code", "strong"] as const) {
      expect(tierOf(route("write_code", cls({ risk: "high" }), { ...bad, ...(lastTier ? { lastTier } : {}) }))).toBe("strong");
      expect(tierOf(route("plan", cls({ type: "plan_project" }), { ...bad, ...(lastTier ? { lastTier } : {}) }))).toBe("strong");
    }
    expect(route("write_code", cls({ risk: "high" }), bad).reason).toMatch(/already at strong/);
  });

  it("does not climb review, vision or indic: they are not on the ladder", () => {
    const bad = { failures: 9, lowConfidence: true, filesTouched: 99, lastTier: "strong" as const };
    expect(tierOf(route("review", cls(), bad))).toBe("review");
    expect(tierOf(route("vision", cls(), bad))).toBe("vision");
    expect(tierOf(route("indic_text", cls(), bad))).toBe("indic");
  });

  it("says it climbed, and why", () => {
    const r = route("write_code", cls(), { failures: 2, filesTouched: 12 });
    expect(r.reason).toMatch(/climbed from code to strong/);
    expect(r.reason).toMatch(/2 failures/);
    expect(r.reason).toMatch(/12 files touched/);
  });
});

// --------------------------------------------------------------------- review

describe("review", () => {
  const writers: Array<[string, string]> = [
    ["deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-5.5"],
    ["z-ai/glm-5.3-flash", "anthropic/claude-haiku-5.5"],
    ["anthropic/claude-haiku-5.5", "google/gemini-2.5-flash"],
    ["anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"],
    ["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"],
    ["openai/gpt-6.1-sol", "anthropic/claude-haiku-5.5"],
  ];
  it.each(writers)("a review of %s is by %s: a different family", (writer, reviewer) => {
    const r = route("review", cls(), { writerModel: writer });
    expect(r).toMatchObject({ tier: "review", model: reviewer });
    expect(familyOf(r.model!)).not.toBe(familyOf(writer));
  });

  it("is a different family from the writer whichever tier the writer's was on, even after the writer climbed", () => {
    for (const tier of ["tiny", "cheap", "code", "strong"] as const) {
      for (const writer of tiers[tier].models) {
        const r = route("review", cls(), { writerModel: writer });
        expect(familyOf(r.model!), `${tier}: ${writer}`).not.toBe(familyOf(writer));
      }
    }
  });

  it("stops when the pool has nothing of another family", () => {
    const one = buildTierTable({ tiers: JSON.stringify({ review: { models: ["anthropic/a", "anthropic/b"] } }) });
    expect(routeStep("review", cls(), { writerModel: "anthropic/z" }, { tiers: one })).toMatchObject({ stop: "no_reviewer" });
    expect(routeStep("review", cls(), {}, { tiers: one })).toMatchObject({ tier: "review", model: "anthropic/a" });
  });
});

// --------------------------------------------------------------------- budget

describe("the budget", () => {
  const FX = 88;
  const cost = (t: ModelTier, chars = 8000) => worstCasePaise({ chars, maxTokens: tiers[t].maxTokens, usdPerMIn: tiers[t].usdPerMIn, usdPerMOut: tiers[t].usdPerMOut }, FX);
  const budget = (remainingPaise: number, inputChars?: number) => ({ budget: { remainingPaise, fx: FX, ...(inputChars ? { inputChars } : {}) } });

  it("has tiers that cost more the higher they are, so the cases below mean something", () => {
    expect(cost("tiny")).toBeLessThan(cost("cheap"));
    expect(cost("cheap")).toBeLessThan(cost("code"));
    expect(cost("code")).toBeLessThan(cost("strong"));
  });

  it("changes nothing when the chosen tier can be afforded, to the paise", () => {
    expect(route("write_code", cls({ risk: "high" }), {}, budget(cost("strong")))).toMatchObject({ tier: "strong" });
    expect(route("write_code", cls({ risk: "high" }), {}, budget(cost("strong") + 1_000_000))).toMatchObject({ tier: "strong" });
  });

  it("takes the cheapest tier that can still do the step when the chosen one cannot be afforded", () => {
    const r = route("write_code", cls({ risk: "high" }), {}, budget(cost("strong") - 1));
    expect(r).toMatchObject({ tier: "code" });
    expect(r.reason).toMatch(/strong needs up to \d+ paise and \d+ are left, so code/);
    expect(route("plan", cls({ type: "plan_project" }), {}, budget(cost("code")))).toMatchObject({ tier: "code" });
    // A step that climbed to a dearer tier than it can afford goes back down to the floor of what can do it.
    expect(route("classify", cls(), { failures: 2 }, budget(cost("cheap") - 1))).toMatchObject({ tier: "tiny" });
    expect(route("research", cls({ difficulty: "high" }), {}, budget(cost("cheap")))).toMatchObject({ tier: "cheap" });
    expect(route("search", cls(), { failures: 2 }, budget(cost("cheap")))).toMatchObject({ tier: "cheap" });
  });

  it("stops for a plan or write_code that cannot afford even code, and for steps that have nothing cheaper", () => {
    expect(route("write_code", cls(), {}, budget(cost("code") - 1))).toMatchObject({ stop: "budget" });
    expect(route("write_code", cls({ risk: "high" }), {}, budget(cost("code") - 1))).toMatchObject({ stop: "budget" });
    expect(route("plan", cls({ type: "plan_project" }), {}, budget(0))).toMatchObject({ stop: "budget" });
    expect(route("plan", cls(), {}, budget(-5))).toMatchObject({ stop: "budget" });
    expect(route("search", cls(), {}, budget(cost("cheap") - 1))).toMatchObject({ stop: "budget" });
    expect(route("classify", cls(), {}, budget(cost("tiny") - 1))).toMatchObject({ stop: "budget" });
    for (const step of ["review", "vision", "indic_text"] as const) {
      expect(route(step, cls(), {}, budget(1))).toMatchObject({ stop: "budget" });
    }
    const stop = route("write_code", cls(), {}, budget(10));
    expect(stop.tier).toBeUndefined();
    expect(stop.reason).toMatch(/10 are left/);
  });

  it("reckons with the size of the step's input, and the exchange rate", () => {
    const small = cost("code", 1000);
    const big = cost("code", 200_000);
    expect(big).toBeGreaterThan(small);
    expect(route("write_code", cls(), {}, budget(small, 1000))).toMatchObject({ tier: "code" });
    expect(route("write_code", cls(), {}, budget(small, 200_000))).toMatchObject({ stop: "budget" });
    const dear = routeStep("write_code", cls(), {}, { tiers, budget: { remainingPaise: cost("code"), fx: FX * 2 } });
    expect(dear).toMatchObject({ stop: "budget" });
  });

  it("is applied after climbing, and a stop still says what was wanted", () => {
    const r = route("write_code", cls(), { failures: 2 }, budget(cost("code")));
    expect(r.tier).toBe("code");
    expect(r.reason).toMatch(/climbed from code to strong/);
    expect(r.reason).toMatch(/so code/);
  });
});

// -------------------------------------------------------------------- learning

describe("learning from outcomes", () => {
  const stat = (model: string, successes: number, failures: number, paiseTotal: number, over: Partial<RouteStat> = {}): RouteStat => ({
    taskType: "feature", step: "write_code", model, successes, failures, paiseTotal, msTotal: 0, updatedAt: 0, ...over,
  });
  const ladder = tiers.code.models; // deepseek, glm, haiku
  const first = (rows: RouteStat[], c = cls()) => routeStep("write_code", c, {}, { tiers, stats: lookupOf(rows) });

  it("has thresholds of 20 tries and 85 successes in 100", () => {
    expect(MIN_SAMPLES).toBe(20);
    expect(MIN_SUCCESS_RATE).toBe(0.85);
  });

  it("keeps the default order with no record, or one that has not earned anything", () => {
    expect(routeStep("write_code", cls(), {}, { tiers }).model).toBeUndefined();
    expect(first([]).model).toBeUndefined();
    // Cheaper, but only 19 tries.
    expect(first([stat(ladder[2]!, 19, 0, 19)]).model).toBeUndefined();
    // 20 tries but 16 worked: 0.8.
    expect(first([stat(ladder[2]!, 16, 4, 20)]).model).toBeUndefined();
  });

  it("names the model with at least 20 tries and at least 85% successes, as the sample threshold falls", () => {
    // 20 tries, 17 worked: exactly 0.85.
    expect(first([stat(ladder[2]!, 17, 3, 40)])).toMatchObject({ tier: "code", model: ladder[2] });
    // 100 tries, 90 worked.
    expect(first([stat(ladder[1]!, 90, 10, 500)])).toMatchObject({ model: ladder[1] });
    // 19 tries is not enough; 20 is.
    expect(first([stat(ladder[2]!, 19, 0, 10)]).model).toBeUndefined();
    expect(first([stat(ladder[2]!, 20, 0, 10)]).model).toBe(ladder[2]);
    // 84 in 100 is not enough; 85 is.
    expect(first([stat(ladder[2]!, 84, 16, 10)]).model).toBeUndefined();
    expect(first([stat(ladder[2]!, 85, 15, 10)]).model).toBe(ladder[2]);
  });

  it("prefers the CHEAPEST of those that qualify, by paise a try, and the earlier on the ladder when they tie", () => {
    const rows = [
      stat(ladder[0]!, 95, 5, 100 * 8),   // 8 paise a try
      stat(ladder[1]!, 90, 10, 100 * 3),  // 3 paise a try
      stat(ladder[2]!, 99, 1, 100 * 5),   // 5
    ];
    expect(first(rows).model).toBe(ladder[1]);
    // A cheaper model that does not qualify is passed over.
    expect(first([...rows.slice(0, 1), stat(ladder[1]!, 50, 50, 1)]).model).toBeUndefined();
    // The same price: the one earlier on the ladder, which is the default, so nothing is named.
    expect(first([stat(ladder[0]!, 90, 10, 400), stat(ladder[1]!, 90, 10, 400)]).model).toBeUndefined();
    expect(first([stat(ladder[1]!, 90, 10, 400), stat(ladder[2]!, 90, 10, 400)]).model).toBe(ladder[1]);
  });

  it("leaves out the model when the best is already first on the ladder", () => {
    expect(first([stat(ladder[0]!, 100, 0, 10), stat(ladder[1]!, 100, 0, 900)]).model).toBeUndefined();
  });

  it("ignores models that are not on this tier's ladder, and other kinds of request and step", () => {
    expect(first([stat("some/other-model", 100, 0, 1)]).model).toBeUndefined();
    expect(first([stat(ladder[1]!, 100, 0, 1, { taskType: "bug_fix" })], cls({ type: "feature" }))).toMatchObject({ tier: "code" });
    const rows = [stat(ladder[1]!, 100, 0, 1, { step: "plan" })];
    const lookup = lookupOf(rows);
    expect(preferredModel(ladder, "feature", "write_code", lookup)).toBeUndefined();
    expect(preferredModel(ladder, "feature", "plan", lookup)).toBe(ladder[1]);
  });

  it("works within whichever tier the step landed on, climbing included", () => {
    const strong = tiers.strong.models;
    const r = routeStep("write_code", cls(), { failures: 2 }, { tiers, stats: lookupOf([stat(strong[1]!, 50, 2, 100)]) });
    expect(r).toMatchObject({ tier: "strong", model: strong[1] });
    expect(r.reason).toMatch(/done feature write_code steps well/);
  });

  it("reorders the review pool too, but never into the writer's family", () => {
    const rows = [
      stat("anthropic/claude-sonnet-5.5", 100, 0, 1, { step: "review" }),
      stat("deepseek/deepseek-v4.1-flash", 100, 0, 5, { step: "review" }),
      stat("google/gemini-2.5-flash", 100, 0, 9, { step: "review" }),
    ];
    const r = routeStep("review", cls(), { writerModel: "anthropic/claude-haiku-5.5" }, { tiers, stats: lookupOf(rows) });
    expect(r.model).toBe("deepseek/deepseek-v4.1-flash");
    const r2 = routeStep("review", cls(), { writerModel: "deepseek/deepseek-v4.1-flash" }, { tiers, stats: lookupOf(rows) });
    expect(r2.model).toBe("anthropic/claude-sonnet-5.5");
    expect(familyOf(r2.model!)).not.toBe("deepseek");
  });

  describe("planRoute, which reads the record from the store", () => {
    it("reorders from what the store holds", async () => {
      const store = new MemoryRouteStatsStore();
      for (let i = 0; i < 20; i += 1) await store.record({ taskType: "feature", step: "write_code", model: ladder[1]!, success: true, paise: 2, ms: 100 });
      const got = await planRoute("write_code", cls(), {}, { store, tiers });
      expect(got).toMatchObject({ tier: "code", model: ladder[1] });
      // Another kind of request has no record.
      expect((await planRoute("write_code", cls({ type: "bug_fix" }), {}, { store, tiers })).model).toBeUndefined();
    });

    it("keeps the default order when the store cannot be read", async () => {
      const broken = { record: async () => undefined, list: async () => { throw new Error("db down"); } };
      expect(await planRoute("write_code", cls(), {}, { store: broken, tiers })).toMatchObject({ tier: "code" });
      expect((await planRoute("write_code", cls(), {}, { store: broken, tiers })).model).toBeUndefined();
    });

    it("applies the budget as routeStep does", async () => {
      const store = new MemoryRouteStatsStore();
      expect(await planRoute("write_code", cls(), {}, { store, tiers, budget: { remainingPaise: 1 } })).toMatchObject({ stop: "budget" });
    });
  });
});

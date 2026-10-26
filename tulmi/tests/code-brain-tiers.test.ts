/**
 * THE CODE BOT'S MODEL TIERS (src/code/brain/tiers.ts): which models do which
 * kind of step, and how CODE_MODEL_TIERS changes them.
 *
 * What these hold down:
 *   - the defaults are the ladders that were asked for, tier by tier;
 *   - CODE_MODEL_TIERS merges per tier and per field, a `models` list replaces
 *     the ladder, and anything invalid is ignored with a warning, never a crash;
 *   - indic is the cheap ladder unless CODE_INDIC_MODEL (or its own entry) says;
 *   - the review pool gives the first model of a different family from the writer;
 *   - reasoning goes out in OpenRouter's form, the planner's way for "none".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const {
  DEFAULT_TIERS, MODEL_TIERS, buildTierTable, familyOf, ladderOf, parseTierOverrides, reasoningParam, resetTierTableForTests,
  reviewCandidates, reviewerFor, tierOfModel, tierSettings, tierTable,
} = await import("../src/code/brain/tiers.js");
const { resetConfigForTests } = await import("../src/config.js");

beforeEach(() => { resetTierTableForTests(); });
afterEach(() => {
  delete process.env.CODE_MODEL_TIERS;
  delete process.env.CODE_INDIC_MODEL;
  resetConfigForTests();
  resetTierTableForTests();
  vi.restoreAllMocks();
});

describe("the defaults", () => {
  const t = buildTierTable();

  it("are the ladders that were asked for", () => {
    expect(t.tiny.models).toEqual(["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"]);
    expect(t.cheap.models).toEqual(["deepseek/deepseek-v4.1-flash", "google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"]);
    expect(t.code.models).toEqual(["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "anthropic/claude-haiku-5.5"]);
    expect(t.strong.models).toEqual(["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol"]);
    expect(t.review.models).toEqual(["anthropic/claude-haiku-5.5", "google/gemini-2.5-flash", "deepseek/deepseek-v4.1-flash", "anthropic/claude-sonnet-5.5"]);
    expect(t.vision.models).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"]);
    expect(t.indic.models).toEqual(t.cheap.models);
    expect(MODEL_TIERS).toEqual(["tiny", "cheap", "code", "strong", "review", "vision", "indic"]);
  });

  it("give every tier a limit, a reasoning level, a timeout and a price estimate; code thinks at medium", () => {
    for (const tier of MODEL_TIERS) {
      const s = t[tier];
      expect(s.maxTokens, tier).toBeGreaterThan(0);
      expect(["none", "low", "medium", "high"], tier).toContain(s.reasoning);
      expect(s.timeoutMs, tier).toBeGreaterThan(0);
      expect(s.usdPerMIn, tier).toBeGreaterThanOrEqual(0);
      expect(s.usdPerMOut, tier).toBeGreaterThan(s.usdPerMIn);
    }
    expect(t.code.reasoning).toBe("medium");
    expect(t.tiny.reasoning).toBe("none");
    // The dearer the work, the dearer the estimate and the more it may write.
    expect(t.strong.usdPerMOut).toBeGreaterThan(t.code.usdPerMOut);
    expect(t.strong.maxTokens).toBeGreaterThan(t.code.maxTokens);
    expect(t.tiny.maxTokens).toBeLessThan(t.cheap.maxTokens);
  });

  it("are not shared: changing a built table does not change the defaults or the next table", () => {
    t.code.models.push("x/y");
    expect(DEFAULT_TIERS.code.models).toHaveLength(3);
    expect(buildTierTable().code.models).toHaveLength(3);
  });
});

describe("CODE_MODEL_TIERS", () => {
  it("merges per tier and per field, over the defaults", () => {
    const t = buildTierTable({ tiers: JSON.stringify({ code: { maxTokens: 12000, reasoning: "high" }, tiny: { timeoutMs: 5000, usdPerMIn: 0.2, usdPerMOut: 0.8 } }) });
    expect(t.code).toEqual({ ...DEFAULT_TIERS.code, maxTokens: 12000, reasoning: "high" });
    expect(t.tiny).toEqual({ ...DEFAULT_TIERS.tiny, timeoutMs: 5000, usdPerMIn: 0.2, usdPerMOut: 0.8 });
    expect(t.cheap).toEqual({ ...DEFAULT_TIERS.cheap });
  });

  it("replaces a ladder with `models`, it does not add to it, and drops repeats", () => {
    const t = buildTierTable({ tiers: JSON.stringify({ code: { models: ["a/one", " b/two ", "a/one"] } }) });
    expect(t.code.models).toEqual(["a/one", "b/two"]);
    expect(t.code.maxTokens).toBe(DEFAULT_TIERS.code.maxTokens);
  });

  it("ignores a value that is not JSON, or not an object, with a warning, and keeps the defaults", () => {
    for (const raw of ["{nope", "[]", "42", "null"]) {
      const warnings: string[] = [];
      const t = buildTierTable({ tiers: raw }, (w) => warnings.push(w));
      expect(t.code.models, raw).toEqual(DEFAULT_TIERS.code.models);
      expect(warnings, raw).toHaveLength(1);
    }
    expect(parseTierOverrides("").problems).toEqual([]);
    expect(parseTierOverrides(undefined).overrides).toEqual({});
  });

  it("ignores a tier that does not exist, or has a field it does not know, or a bad value, and keeps the rest", () => {
    const warnings: string[] = [];
    const t = buildTierTable({
      tiers: JSON.stringify({
        codee: { models: ["x/y"] },
        strong: { maxToken: 5 },
        cheap: { reasoning: "extreme" },
        vision: { models: [] },
        tiny: { maxTokens: 15 },
        review: { models: ["g/a", "h/b"], timeoutMs: 1234 },
      }),
    }, (w) => warnings.push(w));
    expect(warnings).toHaveLength(5);
    expect(warnings.join("\n")).toMatch(/codee/);
    expect(t.strong).toEqual(DEFAULT_TIERS.strong);
    expect(t.cheap).toEqual(DEFAULT_TIERS.cheap);
    expect(t.vision).toEqual(DEFAULT_TIERS.vision);
    expect(t.tiny).toEqual(DEFAULT_TIERS.tiny);
    expect(t.review.models).toEqual(["g/a", "h/b"]);
    expect(t.review.timeoutMs).toBe(1234);
  });

  it("is read from the environment through the config, built once, and warned about once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.CODE_MODEL_TIERS = JSON.stringify({ code: { models: ["env/model"] }, bogus: {} });
    resetConfigForTests();
    expect(tierTable().code.models).toEqual(["env/model"]);
    expect(tierSettings("code").models).toEqual(["env/model"]);
    expect(tierTable()).toBe(tierTable());
    expect(warn).toHaveBeenCalledTimes(1);
    // A changed value is a new table.
    process.env.CODE_MODEL_TIERS = JSON.stringify({ code: { models: ["other/model"] } });
    resetConfigForTests();
    expect(tierTable().code.models).toEqual(["other/model"]);
    // None set: the defaults.
    delete process.env.CODE_MODEL_TIERS;
    resetConfigForTests();
    expect(tierTable().code.models).toEqual(DEFAULT_TIERS.code.models);
  });
});

describe("the indic tier", () => {
  it("is the cheap ladder by default", () => {
    expect(buildTierTable().indic).toEqual(buildTierTable().cheap);
  });

  it("starts with CODE_INDIC_MODEL when it is set, and falls back to the cheap ladder behind it", () => {
    const t = buildTierTable({ indic: "sarvamai/sarvam-m" });
    expect(t.indic.models).toEqual(["sarvamai/sarvam-m", ...DEFAULT_TIERS.cheap.models]);
    expect(t.indic.maxTokens).toBe(DEFAULT_TIERS.cheap.maxTokens);
    expect(buildTierTable({ indic: "  " }).indic.models).toEqual(DEFAULT_TIERS.cheap.models);
    // A model already on the cheap ladder is not tried twice.
    expect(buildTierTable({ indic: "google/gemini-2.5-flash" }).indic.models).toEqual(["google/gemini-2.5-flash", "deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-5.5"]);
  });

  it("follows an overridden cheap tier, unless it is set on its own; its own entry beats CODE_INDIC_MODEL", () => {
    const cheap = { cheap: { models: ["c/one", "c/two"], maxTokens: 3000 } };
    expect(buildTierTable({ tiers: JSON.stringify(cheap) }).indic).toMatchObject({ models: ["c/one", "c/two"], maxTokens: 3000 });
    const own = buildTierTable({ tiers: JSON.stringify({ ...cheap, indic: { models: ["i/own"] } }), indic: "x/ignored" });
    expect(own.indic.models).toEqual(["i/own"]);
    expect(own.indic.maxTokens).toBe(3000);
  });

  it("is read from CODE_INDIC_MODEL in the environment", () => {
    process.env.CODE_INDIC_MODEL = "sarvamai/sarvam-m";
    resetConfigForTests();
    expect(ladderOf("indic")[0]).toBe("sarvamai/sarvam-m");
  });
});

describe("families and the review pool", () => {
  it("takes the family from the vendor prefix of the slug", () => {
    expect(familyOf("anthropic/claude-haiku-5.5")).toBe("anthropic");
    expect(familyOf("Z-AI/glm-5.3-flash")).toBe("z-ai");
    expect(familyOf("deepseek/deepseek-v4.1-flash:free")).toBe("deepseek");
    expect(familyOf("noslash")).toBe("noslash");
  });

  const pool = DEFAULT_TIERS.review.models;
  const cases: Array<[string | undefined, string | undefined]> = [
    ["deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-5.5"],
    ["z-ai/glm-5.3-flash", "anthropic/claude-haiku-5.5"],
    ["anthropic/claude-haiku-5.5", "google/gemini-2.5-flash"],
    ["anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"],
    ["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"],
    ["openai/gpt-6.1-sol", "anthropic/claude-haiku-5.5"],
    [undefined, "anthropic/claude-haiku-5.5"],
  ];
  it.each(cases)("reviews %s with %s", (writer, reviewer) => {
    expect(reviewerFor(pool, writer)).toBe(reviewer);
    if (writer) expect(familyOf(reviewerFor(pool, writer)!)).not.toBe(familyOf(writer));
  });

  it("lists every eligible model in the pool's order, and none when the pool is all the writer's family", () => {
    expect(reviewCandidates(pool, "anthropic/claude-haiku-5.5")).toEqual(["google/gemini-2.5-flash", "deepseek/deepseek-v4.1-flash"]);
    expect(reviewCandidates(["a/x", "a/y"], "a/z")).toEqual([]);
    expect(reviewerFor(["a/x", "a/y"], "a/z")).toBeUndefined();
    expect(ladderOf("review", { writerModel: "deepseek/x" })).toEqual(["anthropic/claude-haiku-5.5", "google/gemini-2.5-flash", "anthropic/claude-sonnet-5.5"]);
    expect(ladderOf("code")).toEqual(DEFAULT_TIERS.code.models);
  });

  it("finds the tier a model is on, for the settings of a call that names a model", () => {
    const t = buildTierTable();
    expect(tierOfModel("openai/gpt-6-luna", t)).toBe("tiny");
    expect(tierOfModel("anthropic/claude-sonnet-5.5", t)).toBe("strong");
    expect(tierOfModel("deepseek/deepseek-v4.1-flash", t)).toBe("cheap");
    expect(tierOfModel("who/knows", t)).toBeUndefined();
  });
});

describe("reasoning, in OpenRouter's form", () => {
  it("is the effort for low, medium and high", () => {
    for (const level of ["low", "medium", "high"] as const) {
      expect(reasoningParam("deepseek/deepseek-v4.1-flash", level)).toEqual({ effort: level });
      expect(reasoningParam("anthropic/claude-haiku-5.5", level)).toEqual({ effort: level });
    }
  });

  it("is the planner's own answer for none: off where it can be, low where thinking cannot be turned off", () => {
    expect(reasoningParam("deepseek/deepseek-v4.1-flash", "none")).toEqual({ effort: "none" });
    expect(reasoningParam("anthropic/claude-haiku-5.5", "none")).toEqual({ effort: "none", enabled: false });
    expect(reasoningParam("google/gemini-3-pro", "none")).toEqual({ effort: "low" });
    expect(reasoningParam("google/gemini-2.5-flash", "none")).toEqual({ effort: "none" });
  });
});

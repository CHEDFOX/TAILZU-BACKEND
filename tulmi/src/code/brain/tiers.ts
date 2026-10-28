/**
 * THE CODE BOT'S MODEL TIERS: WHICH MODELS DO WHICH KIND OF STEP.
 *
 * THE SLUGS BELOW MUST BE CHECKED AGAINST OPENROUTER'S LIVE MODEL LIST BEFORE
 * LAUNCH. They are the intended picks, not a promise that each one exists under
 * that exact name today, and the prices are estimates for budgeting, not a
 * rate card. A slug OpenRouter does not know fails with a 4xx before any
 * output, so the ladder just moves on to the next model; a wrong name is slow
 * and a little wasteful, never wrong. Change them without a deploy with
 * CODE_MODEL_TIERS (config.ts).
 *
 * The brain never names a model at a call site. It names a TIER, the job that
 * is being done:
 *
 *   tiny    classify and route: a few words in, a small JSON out
 *   cheap   search, summarise, index: reading a lot, writing little
 *   code    normal code writing
 *   strong  plans, architecture, hard or risky changes
 *   review  a second opinion on code: ALWAYS a different model family from
 *           the one that wrote it, because two models of one family share
 *           blind spots, and a review by the writer's own kin is not a review
 *   vision  reading a picture (a screenshot, a mock-up)
 *   indic   wording in Indian languages. CODE_INDIC_MODEL if it is set, else
 *           the cheap tier's ladder
 *
 * A tier is a LADDER, an ordered list of OpenRouter slugs, with its settings:
 * the most it may write (maxTokens), how hard it thinks (reasoning: none, low,
 * medium or high, in OpenRouter's own form, as agent/llm.ts sends it), how long
 * one call may take (timeoutMs), and what a call is estimated to cost in US
 * dollars per million tokens in and out. The estimate is only for deciding,
 * BEFORE a call, whether the job can afford it (money.ts): what a call really
 * cost is read off OpenRouter's own answer. It is set to the dearest model on
 * the ladder, so the check never under-reserves.
 *
 * The review tier is a POOL, not a ladder: the model is picked at call time, as
 * the first in the pool whose family (the vendor prefix of the slug) differs
 * from the writer's.
 *
 * CODE_MODEL_TIERS is merged over these per tier and per field. A `models` list
 * replaces that tier's ladder, it does not add to it. A value that is not valid
 * is ignored with one warning rather than refusing to start: the defaults are
 * always a working configuration.
 */
import { z } from "zod";
import { reasoningFor } from "../../agent/llm.js";
import { allowedEffort } from "../../agent/reasoning.js";
import { getConfig } from "../../config.js";

export const MODEL_TIERS = ["tiny", "cheap", "code", "strong", "review", "vision", "indic"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** How hard a model thinks before it answers. OpenRouter's `reasoning.effort`. */
export type Reasoning = "none" | "low" | "medium" | "high";
export const REASONING_LEVELS: readonly Reasoning[] = ["none", "low", "medium", "high"];

export interface TierSettings {
  /** The ladder, in the order it is tried. For `review`, the pool the reviewer is picked from. */
  models: string[];
  /** The most one call may write, thinking included. */
  maxTokens: number;
  reasoning: Reasoning;
  /** One call, headers to last byte. */
  timeoutMs: number;
  /** Estimated US dollars per million tokens, in and out: for budgeting before a call. */
  usdPerMIn: number;
  usdPerMOut: number;
}

/** haiku-5.5 is on most ladders and is the dearest rung of the cheap ones, so its price is the cheap tiers' estimate. */
const HAIKU_IN = 1;
const HAIKU_OUT = 5;

export const DEFAULT_TIERS: Readonly<Record<Exclude<ModelTier, "indic">, Readonly<TierSettings>>> = {
  tiny: {
    models: ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"],
    maxTokens: 600, reasoning: "none", timeoutMs: 15_000, usdPerMIn: HAIKU_IN, usdPerMOut: HAIKU_OUT,
  },
  cheap: {
    models: ["deepseek/deepseek-v4.1-flash", "google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"],
    maxTokens: 2_000, reasoning: "none", timeoutMs: 45_000, usdPerMIn: HAIKU_IN, usdPerMOut: HAIKU_OUT,
  },
  code: {
    models: ["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "anthropic/claude-haiku-5.5"],
    maxTokens: 8_000, reasoning: "medium", timeoutMs: 100_000, usdPerMIn: HAIKU_IN, usdPerMOut: HAIKU_OUT,
  },
  strong: {
    models: ["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol"],
    maxTokens: 16_000, reasoning: "high", timeoutMs: 120_000, usdPerMIn: 3, usdPerMOut: 15,
  },
  review: {
    models: ["anthropic/claude-haiku-5.5", "google/gemini-2.5-flash", "deepseek/deepseek-v4.1-flash", "anthropic/claude-sonnet-5.5"],
    maxTokens: 4_000, reasoning: "low", timeoutMs: 90_000, usdPerMIn: 3, usdPerMOut: 15,
  },
  vision: {
    models: ["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"],
    maxTokens: 2_000, reasoning: "none", timeoutMs: 60_000, usdPerMIn: HAIKU_IN, usdPerMOut: HAIKU_OUT,
  },
};

/** What a model that is on no tier is called with: a conservative middle, since nothing is known about it. */
export const UNLISTED_MODEL: Readonly<TierSettings> = {
  models: [], maxTokens: 4_000, reasoning: "none", timeoutMs: 60_000, usdPerMIn: 3, usdPerMOut: 15,
};

// --------------------------------------------------------------- the families

/**
 * A model's family: the vendor prefix of its OpenRouter slug, lowercased.
 * "anthropic/claude-haiku-5.5" is "anthropic"; "z-ai/glm-5.3-flash" is "z-ai".
 * A slug with no vendor is its own family.
 */
export function familyOf(model: string): string {
  const slug = model.trim().toLowerCase();
  const i = slug.indexOf("/");
  return i > 0 ? slug.slice(0, i) : slug;
}

/** The first model in the pool whose family differs from the writer's; undefined when there is none. With no writer, the pool's first. */
export function reviewerFor(pool: readonly string[], writerModel?: string): string | undefined {
  return reviewCandidates(pool, writerModel)[0];
}

/** The pool's models of a different family from the writer's, in the pool's order. All of it when there is no writer. */
export function reviewCandidates(pool: readonly string[], writerModel?: string): string[] {
  const writer = writerModel?.trim() ? familyOf(writerModel) : null;
  return pool.filter((m) => writer === null || familyOf(m) !== writer);
}

// --------------------------------------------------------- CODE_MODEL_TIERS

const OverrideSchema = z.object({
  models: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
  maxTokens: z.number().int().min(16).max(128_000),
  reasoning: z.enum(["none", "low", "medium", "high"]),
  timeoutMs: z.number().int().min(1).max(600_000),
  usdPerMIn: z.number().min(0).max(1_000),
  usdPerMOut: z.number().min(0).max(1_000),
}).partial().strict();

export type TierOverrides = Partial<Record<ModelTier, Partial<TierSettings>>>;

/**
 * CODE_MODEL_TIERS read: the overrides that are valid, and a plain-words line
 * for each thing that was not (the whole value, or one tier's part of it).
 */
export function parseTierOverrides(raw: string | undefined): { overrides: TierOverrides; problems: string[] } {
  const overrides: TierOverrides = {};
  const problems: string[] = [];
  if (!raw?.trim()) return { overrides, problems };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { overrides, problems: ["CODE_MODEL_TIERS is not valid JSON: it is ignored."] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { overrides, problems: ["CODE_MODEL_TIERS must be a JSON object keyed by tier: it is ignored."] };
  }
  for (const [name, part] of Object.entries(value)) {
    if (!(MODEL_TIERS as readonly string[]).includes(name)) {
      problems.push(`CODE_MODEL_TIERS names a tier that does not exist ("${name.slice(0, 40)}"): it is ignored.`);
      continue;
    }
    const parsed = OverrideSchema.safeParse(part);
    if (!parsed.success) {
      const why = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");
      problems.push(`CODE_MODEL_TIERS tier "${name}" is ignored (${why}).`);
      continue;
    }
    overrides[name as ModelTier] = dedupeModels(parsed.data);
  }
  return { overrides, problems };
}

function dedupeModels(o: Partial<TierSettings>): Partial<TierSettings> {
  return o.models ? { ...o, models: unique(o.models) } : o;
}

const unique = (models: readonly string[]): string[] => {
  const all = models.map((m) => m.trim()).filter(Boolean);
  return all.filter((m, i) => all.indexOf(m) === i);
};

const copy = (s: Readonly<TierSettings>): TierSettings => ({ ...s, models: [...s.models] });

/**
 * Every tier's settings: the defaults, then CODE_INDIC_MODEL for the indic
 * tier, then CODE_MODEL_TIERS over all of it. The indic tier starts out as the
 * cheap tier AFTER its overrides, so changing the cheap ladder moves indic with
 * it unless indic is set on its own.
 */
export function buildTierTable(env: { tiers?: string; indic?: string } = {}, warn?: (line: string) => void): Record<ModelTier, TierSettings> {
  const { overrides, problems } = parseTierOverrides(env.tiers);
  for (const p of problems) warn?.(p);
  const merge = (base: TierSettings, over: Partial<TierSettings> | undefined): TierSettings => ({ ...base, ...(over ?? {}), models: [...(over?.models ?? base.models)] });
  const tiny = merge(copy(DEFAULT_TIERS.tiny), overrides.tiny);
  const cheap = merge(copy(DEFAULT_TIERS.cheap), overrides.cheap);
  const code = merge(copy(DEFAULT_TIERS.code), overrides.code);
  const strong = merge(copy(DEFAULT_TIERS.strong), overrides.strong);
  const review = merge(copy(DEFAULT_TIERS.review), overrides.review);
  const vision = merge(copy(DEFAULT_TIERS.vision), overrides.vision);
  const indicModel = env.indic?.trim();
  // A single named model would be a ladder with no second rung, so the cheap ladder follows it.
  const indicBase: TierSettings = { ...cheap, models: indicModel ? unique([indicModel, ...cheap.models]) : [...cheap.models] };
  const indic = merge(indicBase, overrides.indic);
  return { tiny, cheap, code, strong, review, vision, indic };
}

let memo: { key: string; table: Record<ModelTier, TierSettings> } | null = null;

/** The tier table for this process's config, built once per distinct CODE_MODEL_TIERS and CODE_INDIC_MODEL. Problems are warned about once. */
export function tierTable(): Record<ModelTier, TierSettings> {
  const cfg = getConfig();
  const key = JSON.stringify([cfg.CODE_MODEL_TIERS ?? "", cfg.CODE_INDIC_MODEL ?? ""]);
  if (!memo || memo.key !== key) {
    memo = { key, table: buildTierTable({ tiers: cfg.CODE_MODEL_TIERS, indic: cfg.CODE_INDIC_MODEL }, (line) => console.warn(`[code-brain] ${line}`)) };
  }
  return memo.table;
}

export function resetTierTableForTests(): void { memo = null; }

export function tierSettings(tier: ModelTier): TierSettings {
  return tierTable()[tier];
}

/**
 * The models to try for a tier, in order. For review, the pool less the
 * writer's family (every model of it when the writer is not known).
 */
export function ladderOf(tier: ModelTier, o: { writerModel?: string; table?: Record<ModelTier, TierSettings> } = {}): string[] {
  const t = (o.table ?? tierTable())[tier];
  return tier === "review" ? reviewCandidates(unique(t.models), o.writerModel) : unique(t.models);
}

/** The tier a model is on, for settings when a caller names a model and not a tier. The first tier that lists it, review last. */
export function tierOfModel(model: string, table: Record<ModelTier, TierSettings> = tierTable()): ModelTier | undefined {
  const order: ModelTier[] = ["tiny", "cheap", "code", "strong", "vision", "indic", "review"];
  return order.find((t) => table[t].models.includes(model));
}

// ----------------------------------------------------------------- reasoning

/**
 * The reasoning setting for one model at one level, in OpenRouter's form.
 * "none" is agent/llm.ts's own answer (reasoningFor): off where a model can be
 * turned off, with Anthropic's explicit switch too, and the model's LOWEST
 * allowed effort for the models whose thinking cannot be (never "none" or
 * `enabled: false` for those: they refuse it with a 400 before writing a
 * word). The other levels are OpenRouter's effort, moved up to the nearest one
 * the model accepts when it is known to list efforts that leave the level out.
 */
export function reasoningParam(model: string, level: Reasoning): Record<string, unknown> {
  return level === "none" ? { ...reasoningFor(model) } : { effort: allowedEffort(model, level) };
}

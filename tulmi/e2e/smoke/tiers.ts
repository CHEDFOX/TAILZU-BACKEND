/**
 * THE SMOKE TIERS: THE CHEAPEST CAPABLE MODEL FOR EVERY TIER, AND SHORT ANSWERS.
 *
 * Every tier of the product (tiny, cheap, code, strong, review, vision, indic) gets one ladder: the primary model, then the fallback; at most 800 tokens a
 * call. A tier that needs a picture (vision) puts first the first of the two that takes images, by the live catalog. `--tiers default` leaves the product's
 * own ladders alone.
 */
import { buildTierTable, MODEL_TIERS, type ModelTier, type TierSettings } from "../../src/code/brain/tiers.js";
import type { Catalog } from "../catalog.js";

export const SMOKE_PRIMARY = "qwen/qwen3.7-flash";
export const SMOKE_FALLBACK = "deepseek/deepseek-v4.1-flash";
export const SMOKE_MAX_TOKENS = 800;
/**
 * The most work turns a smoke task may take. 12 stopped the "Clear completed" button task (about 15 turns on qwen3.7-flash: one failed read and one failed edit cost two)
 * with three correct files staged and not committed, and the item failed on the harness's cap and not on the product (RESULTS-2026-10-28, bug 2). With 20 it passes
 * every stage. A cassette recorded under another cap is replayed under that one (see smoke/changed.ts, `run`).
 */
export const SMOKE_MAX_TURNS = 20;

export interface SmokeModels { primary: string; fallback: string; maxTokens: number }

/** The overrides, as CODE_MODEL_TIERS would hold them: one ladder and one cap for every tier. */
export function smokeTierOverrides(m: SmokeModels, catalog?: Catalog): Partial<Record<ModelTier, Partial<TierSettings>>> {
  const info = (slug: string) => catalog?.models.get(slug);
  const imageFirst = [m.primary, m.fallback].sort((a, b) => Number(info(b)?.image ?? false) - Number(info(a)?.image ?? false));
  const overrides: Partial<Record<ModelTier, Partial<TierSettings>>> = {};
  for (const tier of MODEL_TIERS) {
    if (tier === "indic") continue;
    const models = tier === "vision" ? imageFirst : [m.primary, m.fallback];
    const p = info(models[0]!);
    overrides[tier] = {
      models, maxTokens: m.maxTokens, reasoning: "none",
      ...(p ? { usdPerMIn: p.inUsdPerM, usdPerMOut: p.outUsdPerM } : {}),
    };
  }
  return overrides;
}

/**
 * CODE_MODEL_TIERS that holds every tier's answer to `maxTokens` and changes nothing else: the product's own ladders and prices, short answers. A run that caps what a
 * call may write (the router part's 800) must cap it HERE, where the product's router and the gateway both read it, and not only in the harness's model door:
 * otherwise the router reserves each step against the tier's whole limit (8,000 or 16,000 tokens), finds a small task budget "used up" at 1% spent, and stops
 * a job that the capped calls could easily have paid for.
 */
export function cappedTierOverrides(maxTokens: number): Partial<Record<ModelTier, Partial<TierSettings>>> {
  const out: Partial<Record<ModelTier, Partial<TierSettings>>> = {};
  for (const tier of MODEL_TIERS) if (tier !== "indic") out[tier] = { maxTokens };
  return out;
}

export function smokeTiers(m: SmokeModels, catalog?: Catalog): Record<ModelTier, TierSettings> {
  return buildTierTable({ tiers: JSON.stringify(smokeTierOverrides(m, catalog)) });
}

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

export function smokeTiers(m: SmokeModels, catalog?: Catalog): Record<ModelTier, TierSettings> {
  return buildTierTable({ tiers: JSON.stringify(smokeTierOverrides(m, catalog)) });
}

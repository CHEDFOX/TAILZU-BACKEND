/**
 * AUTOMATIC LADDERS: FROM THE SCOREBOARD TO CODE_MODEL_TIERS.
 *
 * Per tier, the candidates that were not dropped and meet the QUALITY FLOOR (0.70 of the tier's checks passed, by default), ordered by COST PER PASS, the
 * cheapest first: that is the ladder the gateway walks, the cheap rung first and the dearer one when it fails. At most four rungs. A tier where nothing meets the
 * floor gets its single best survivor, and the notes say so. A tier with no survivor is left out: the product's own ladder stays.
 *
 * The review tier's pool is picked from the code and strong survivors (a reviewer is of another family from the writer, so the pool must have several), the
 * indic tier is not set (CODE_INDIC_MODEL names one model: the best at the Hindi and Hinglish probe among the cheap and code survivors, when one stands out).
 * The value is written as it goes into the environment: a JSON object keyed by tier with `models`.
 */
import { familyOf } from "../../src/code/brain/tiers.js";
import type { Summary } from "./engine.js";
import { BAKEOFF_TIERS, type BakeoffTier } from "./pools.js";

export interface LadderOptions { floor: number; max: number }
export const DEFAULT_LADDER: LadderOptions = { floor: 0.7, max: 4 };

export interface TierLadder {
  models: string[];
  /** Why each model is on the ladder: its quality and cost per pass. */
  why: Array<{ slug: string; quality: number; costPerPassInr: number | null }>;
  note?: string;
}

export interface Ladders {
  tiers: Partial<Record<BakeoffTier | "review", TierLadder>>;
  /** The value for CODE_MODEL_TIERS. */
  codeModelTiers: string;
  /** The value for CODE_INDIC_MODEL, when one model clearly leads the Hindi probe. */
  codeIndicModel?: string;
  notes: string[];
}

const byCost = (a: Summary, b: Summary): number => (a.costPerPassUsd === b.costPerPassUsd ? b.quality - a.quality : a.costPerPassUsd - b.costPerPassUsd);

export function buildLadders(all: readonly Summary[], fx: number, o: LadderOptions = DEFAULT_LADDER): Ladders {
  const tiers: Ladders["tiers"] = {};
  const notes: string[] = [];
  const inr = (usd: number): number | null => (Number.isFinite(usd) ? Math.round(usd * fx * 10_000) / 10_000 : null);
  for (const tier of BAKEOFF_TIERS) {
    const survivors = all.filter((s) => s.tier === tier && !s.dropped && s.calls > 0);
    if (!survivors.length) { notes.push(`${tier}: no candidate survived, so the product's own ladder stays`); continue; }
    const good = survivors.filter((s) => s.quality >= o.floor).sort(byCost);
    let chosen = good.slice(0, o.max);
    let note: string | undefined;
    if (!chosen.length) {
      chosen = [[...survivors].sort((a, b) => b.quality - a.quality || byCost(a, b))[0]!];
      note = `no candidate met the quality floor of ${Math.round(o.floor * 100)}%; the best survivor (${Math.round(chosen[0]!.quality * 100)}%) stands alone`;
      notes.push(`${tier}: ${note}`);
    }
    tiers[tier] = { models: chosen.map((s) => s.slug), why: chosen.map((s) => ({ slug: s.slug, quality: Math.round(s.quality * 1000) / 1000, costPerPassInr: inr(s.costPerPassUsd) })), ...(note ? { note } : {}) };
  }
  // The review pool: models that pass the floor on a tool tier, of several families, cheapest per pass first.
  const reviewers = all.filter((s) => (s.tier === "code" || s.tier === "strong") && !s.dropped && s.quality >= o.floor).sort(byCost);
  const seen = new Set<string>();
  const pool = reviewers.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true))).slice(0, 5);
  if (new Set(pool.map((s) => familyOf(s.slug))).size >= 2) tiers.review = { models: pool.map((s) => s.slug), why: pool.map((s) => ({ slug: s.slug, quality: Math.round(s.quality * 1000) / 1000, costPerPassInr: inr(s.costPerPassUsd) })) };
  else notes.push("review: fewer than two families passed the floor on a tool tier, so the product's own review pool stays");
  // The indic model: the best Hindi score among the cheap and code survivors, when it clearly beats the next.
  const hindi = all.filter((s) => (s.tier === "cheap" || s.tier === "code") && !s.dropped && s.hindi !== undefined).sort((a, b) => (b.hindi ?? 0) - (a.hindi ?? 0) || byCost(a, b));
  const codeIndicModel = hindi[0] && (hindi[0].hindi ?? 0) >= 0.9 && (hindi.length < 2 || (hindi[1]!.hindi ?? 0) < (hindi[0].hindi ?? 0) || byCost(hindi[0], hindi[1]!) <= 0) ? hindi[0].slug : undefined;
  const value = Object.fromEntries(Object.entries(tiers).map(([t, l]) => [t, { models: l!.models }]));
  return { tiers, codeModelTiers: JSON.stringify(value), ...(codeIndicModel ? { codeIndicModel } : {}), notes };
}

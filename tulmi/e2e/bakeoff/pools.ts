/**
 * THE CANDIDATE POOLS OF THE BAKE-OFF, FROM pools.json: the models tried for each tier, and what each tier's role needs of a model.
 */
import path from "node:path";
import { readJson } from "../util.js";
import { E2E_DIR } from "../util.js";

export const BAKEOFF_TIERS = ["tiny", "cheap", "code", "strong", "vision"] as const;
export type BakeoffTier = (typeof BAKEOFF_TIERS)[number];
export type Need = "tools" | "image";

export interface Pools {
  tiers: Record<BakeoffTier, string[]>;
  /** Models for roles that only write (no tools, no JSON contract): tried on the writing roles, never on tool roles. */
  writingOnly: string[];
  needs: Record<BakeoffTier, Need[]>;
  /** The vendors whose new models `models-watch` reports. */
  families: string[];
}

export function loadPools(file = path.join(E2E_DIR, "bakeoff", "pools.json")): Pools {
  const raw = readJson<Pools & { note?: string }>(file);
  for (const t of BAKEOFF_TIERS) if (!Array.isArray(raw.tiers?.[t])) throw new Error(`pools.json has no list for the ${t} tier`);
  return { tiers: raw.tiers, writingOnly: raw.writingOnly ?? [], needs: raw.needs, families: raw.families ?? [] };
}

/** Every distinct model slug in the pools, with the tiers it is a candidate for. */
export function tiersOfModels(p: Pools): Map<string, BakeoffTier[]> {
  const m = new Map<string, BakeoffTier[]>();
  for (const t of BAKEOFF_TIERS) for (const s of p.tiers[t]) m.set(s, [...(m.get(s) ?? []), t]);
  return m;
}

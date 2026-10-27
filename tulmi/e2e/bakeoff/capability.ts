/**
 * CAPABILITY FILTER: A MODEL IS A CANDIDATE FOR A TIER ONLY IF IT CAN DO WHAT THAT TIER'S ROLES NEED, BY OPENROUTER'S OWN CATALOG.
 *
 * A model with no `tools` support is no candidate for a tool-using role (the code and strong tiers run the agent loop); one that takes no image is no vision
 * candidate; one that is not in the catalog at all is dropped with that reason (a slug that was renamed or retired). Prices are recorded with each survivor.
 */
import type { Catalog, ModelInfo } from "../catalog.js";
import { BAKEOFF_TIERS, type BakeoffTier, type Pools } from "./pools.js";

export interface Candidate {
  slug: string;
  tier: BakeoffTier;
  info: ModelInfo;
}

export interface Excluded { slug: string; tier: BakeoffTier; reason: string }

export interface Filtered {
  candidates: Record<BakeoffTier, Candidate[]>;
  excluded: Excluded[];
  /** The writing-only models that are in the catalog (they are not tried for tool roles). */
  writing: Candidate[];
}

export function filterPools(pools: Pools, catalog: Catalog): Filtered {
  const candidates = Object.fromEntries(BAKEOFF_TIERS.map((t) => [t, [] as Candidate[]])) as unknown as Record<BakeoffTier, Candidate[]>;
  const excluded: Excluded[] = [];
  for (const tier of BAKEOFF_TIERS) {
    for (const slug of pools.tiers[tier]) {
      const info = catalog.models.get(slug);
      if (!info) { excluded.push({ slug, tier, reason: catalog.source === "none" ? "the catalog could not be read, so its capabilities are unknown" : "not in OpenRouter's catalog" }); continue; }
      const need = pools.needs[tier] ?? [];
      if (need.includes("tools") && !info.tools) { excluded.push({ slug, tier, reason: "no tool support, and the tier's roles call tools" }); continue; }
      if (need.includes("image") && !info.image) { excluded.push({ slug, tier, reason: "no image input, and the tier reads pictures" }); continue; }
      candidates[tier].push({ slug, tier, info });
    }
  }
  const writing: Candidate[] = [];
  for (const slug of pools.writingOnly) {
    const info = catalog.models.get(slug);
    if (info) writing.push({ slug, tier: "cheap", info });
    else excluded.push({ slug, tier: "cheap", reason: catalog.source === "none" ? "the catalog could not be read, so its capabilities are unknown" : "not in OpenRouter's catalog (writing-only role)" });
  }
  return { candidates, excluded, writing };
}

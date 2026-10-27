/**
 * Lists the models from the families in the bake-off's pools that are NEW since the last time this was run, with what each can do and costs, so they can be
 * added to e2e/bakeoff/pools.json and tried.
 *
 *   npm run models-watch                  what is new since the last run (the first run reports the models made in the last 45 days)
 *   npm run models-watch -- --all         every model of those families that is in no pool
 *   npm run models-watch -- --no-save     do not remember this run's list
 *
 * It reads OpenRouter's public model list (no key needed), keeps a copy in e2e/cache/models.json, and writes what it has seen to e2e/cache/models-seen.json.
 * Offline it says so and uses the copy. It calls no model and spends nothing.
 */
import path from "node:path";
import { loadCatalog } from "../e2e/catalog.js";
import { loadPools } from "../e2e/bakeoff/pools.js";
import { CACHE_DIR, mkdirp, readJson, writeJson } from "../e2e/util.js";

const SEEN = path.join(CACHE_DIR, "models-seen.json");
const DAY = 86_400_000;

interface Seen { at: string; ids: string[] }

/** The models of the watched families that are in no pool and are new (not seen before, or made recently on a first run). */
export function newModels(
  catalog: { models: Map<string, { id: string; created: number }> },
  pools: { tiers: Record<string, string[]>; writingOnly: string[]; families: string[] },
  seen: Seen | null,
  o: { all?: boolean; now?: number; recentDays?: number } = {},
): string[] {
  const inPools = new Set([...Object.values(pools.tiers).flat(), ...pools.writingOnly]);
  const families = new Set(pools.families);
  const now = o.now ?? Date.now();
  const before = new Set(seen?.ids ?? []);
  const out: string[] = [];
  for (const m of catalog.models.values()) {
    if (!families.has(m.id.split("/")[0]!) || inPools.has(m.id)) continue;
    if (/:(free|extended|thinking|nitro|floor|batch)$/.test(m.id)) continue;
    if (o.all) { out.push(m.id); continue; }
    if (seen ? !before.has(m.id) : m.created * 1000 >= now - (o.recentDays ?? 45) * DAY) out.push(m.id);
  }
  return out.sort();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const catalog = await loadCatalog({ maxAgeMs: 0 });
  if (catalog.source === "none") { console.error("OpenRouter's model list could not be read and there is no saved copy."); process.exitCode = 1; return; }
  if (catalog.source === "cache") console.log(`(offline: using the copy saved ${new Date(catalog.fetchedAt).toISOString().slice(0, 16)})`);
  const pools = loadPools();
  const seen = readJson<Seen | null>(SEEN, null);
  const fresh = newModels(catalog, pools, seen, { all: args.includes("--all") });
  console.log(`${fresh.length} model(s) of ${pools.families.length} watched families ${args.includes("--all") ? "in no pool" : seen ? `new since ${seen.at.slice(0, 10)}` : "made in the last 45 days (first run)"}:\n`);
  for (const id of fresh) {
    const m = catalog.models.get(id)!;
    const kind = m.tools ? (m.outUsdPerM >= 5 ? "strong or code" : m.outUsdPerM >= 1 ? "code" : "cheap or tiny") : "writing only (no tools)";
    console.log(`  ${id.padEnd(42)} ${new Date(m.created * 1000).toISOString().slice(0, 10)}  $${m.inUsdPerM.toFixed(2)}/$${m.outUsdPerM.toFixed(2)} per M  tools:${m.tools ? "yes" : "no "} image:${m.image ? "yes" : "no "}  -> ${kind}`);
  }
  if (fresh.length) console.log("\nAdd the ones you want to e2e/bakeoff/pools.json, then: npm run bakeoff -- --dry");
  if (!args.includes("--no-save")) { mkdirp(CACHE_DIR); writeJson(SEEN, { at: new Date().toISOString(), ids: [...catalog.models.keys()] } satisfies Seen); }
}

if (process.argv[1] && /models-watch\.[tj]s$/.test(process.argv[1])) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}

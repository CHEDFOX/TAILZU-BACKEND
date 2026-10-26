/**
 * SEED OUR CODING INDEX FROM OFFICIAL DOCUMENTATION SITEMAPS.
 *
 * The index (src/web/search/index.ts, migration 0027) fills itself with the
 * documentation pages the Code bot reads. This fills it ahead of time with a
 * short list of official sites (catalog.ts SEED_SITES), so a first question
 * about Vue, Next.js, Vite, Prisma, Expo, Supabase, FastAPI, Django or
 * MDN is answered from the index.
 *
 *   npx tsx scripts/seed-web-index.ts                       DRY RUN: reads the sitemaps, lists what it would fetch, writes nothing
 *   npx tsx scripts/seed-web-index.ts --sites vue,vite      only those sites
 *   npx tsx scripts/seed-web-index.ts --max 50              pages per site (default 30, at most 500)
 *   npx tsx scripts/seed-web-index.ts --apply               really fetch and index
 *
 * In the production container (tsx is not installed there; the script is
 * compiled with the server):
 *
 *   docker compose exec backend node dist/tulmi/scripts/seed-web-index.js --apply --sites vue --max 20
 *
 * The pages are read as an indexer (purpose "index"): each site's robots.txt is
 * read and obeyed (a disallowed page is skipped), and there is at most one
 * request a second to a host, so 30 pages take about half a minute per site.
 * It needs the same environment as the server for the database: SUPABASE_URL
 * and SUPABASE_SERVICE_KEY. Without them the pages go to memory and are gone
 * when the script ends, which the script says before it starts.
 *
 * Exit code 0 when every site was done, 1 when a site's sitemap could not be
 * read, 2 when the arguments are wrong. It prints addresses of documentation
 * pages and counts, never a page's text.
 */
import { getConfig } from "../src/config.js";
import { SEED_SITES } from "../src/web/search/catalog.js";
import { indexPage, searchStore } from "../src/web/search/index.js";
import { seedUrls } from "../src/web/search/seed.js";
import { readPage, TEXT_HARD_MAX } from "../src/web/reader.js";
import { WebError } from "../src/web/error.js";

interface Args { apply: boolean; max: number; sites: string[] | null }

function parseArgs(argv: string[]): Args | string {
  const a: Args = { apply: false, max: 30, sites: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--apply") a.apply = true;
    else if (arg === "--max") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 500) return "--max needs a whole number from 1 to 500";
      a.max = n;
    } else if (arg === "--sites") {
      const v = argv[++i];
      if (!v) return "--sites needs a comma-separated list";
      a.sites = v.split(",").map((s) => s.trim()).filter(Boolean);
      const unknown = a.sites.filter((s) => !SEED_SITES.some((x) => x.id === s));
      if (unknown.length) return `unknown site(s): ${unknown.join(", ")}. Known: ${SEED_SITES.map((s) => s.id).join(", ")}`;
    } else return `unknown argument ${arg}`;
  }
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    return 2;
  }
  const sites = SEED_SITES.filter((s) => !args.sites || args.sites.includes(s.id));
  console.log(`${args.apply ? "APPLY" : "DRY RUN"}: ${sites.length} site(s), up to ${args.max} page(s) each.`);
  if (args.apply && !getConfig().supabaseEnabled) {
    console.warn("No database is configured (SUPABASE_URL / SUPABASE_SERVICE_KEY): the index is in memory and will be gone when this script ends.");
  }
  if (!args.apply) console.log("Nothing is fetched except sitemaps, and nothing is written. Add --apply to index.");

  const store = args.apply ? searchStore() : null;
  let failedSites = 0;
  let indexed = 0;
  let chunks = 0;
  for (const site of sites) {
    let urls: string[];
    try {
      urls = await seedUrls(site, { max: args.max });
    } catch (err) {
      failedSites += 1;
      console.error(`${site.id}: the sitemap could not be read (${err instanceof WebError ? err.code : "failed"})`);
      continue;
    }
    console.log(`${site.id}: ${urls.length} page(s) from ${new URL(site.sitemap).host}`);
    if (!args.apply) {
      for (const u of urls.slice(0, 5)) console.log(`  ${u}`);
      if (urls.length > 5) console.log(`  ... and ${urls.length - 5} more`);
      continue;
    }
    let ok = 0;
    const skipped: Record<string, number> = {};
    for (const url of urls) {
      try {
        const page = await readPage(url, { purpose: "index", maxChars: TEXT_HARD_MAX });
        const r = await indexPage(page, { store, source: `seed:${site.id}`, anyHost: true });
        if (r.indexed) { ok += 1; indexed += 1; chunks += r.chunks; } else skipped[r.reason] = (skipped[r.reason] ?? 0) + 1;
      } catch (err) {
        const why = err instanceof WebError ? err.code : "failed";
        skipped[why] = (skipped[why] ?? 0) + 1;
      }
    }
    console.log(`  indexed ${ok}/${urls.length}${Object.keys(skipped).length ? `; skipped: ${Object.entries(skipped).map(([k, n]) => `${k} x${n}`).join(", ")}` : ""}`);
  }
  if (args.apply) console.log(`Done: ${indexed} page(s), ${chunks} chunk(s).`);
  return failedSites ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => {
  console.error("seed-web-index failed:", (err as Error)?.name ?? "error");
  process.exit(1);
});

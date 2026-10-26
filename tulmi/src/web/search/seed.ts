/**
 * THE LIST OF PAGES TO SEED OUR INDEX WITH, FROM AN OFFICIAL SITE'S SITEMAP.
 *
 * A sitemap is the site telling crawlers which pages it has. This reads one
 * (an XML list of addresses, or an index of such lists, either plain or gzipped:
 * MDN's are .xml.gz), keeps the addresses the site's SeedSite entry
 * (catalog.ts) says are documentation, and returns the first few. It only
 * lists; reading the pages (purpose "index", so robots.txt and politeness
 * apply) and indexing them is the script's (scripts/seed-web-index.ts).
 */
import { WebError } from "../error.js";
import type { SeedSite } from "./catalog.js";
import { httpGet } from "./http.js";
import { decodeEntities } from "./sources/util.js";
import type { FetchLike } from "./types.js";

/** A sitemap may be this large (nodejs.org's is 1.6 MiB). */
const SITEMAP_MAX_BYTES = 6 * 1024 * 1024;
/** A sitemap is a one-off read by a script, and some servers are slow with it (Django's takes ten seconds). */
const SITEMAP_TIMEOUT_MS = 30_000;
/** Most sitemaps followed out of an index. */
const INDEX_FOLLOW = 3;

export interface ParsedSitemap {
  /** Page addresses. */
  urls: string[];
  /** Further sitemaps (an index lists these). */
  sitemaps: string[];
}

const locs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]!).trim()).filter((u) => /^https?:\/\//i.test(u));

/** The addresses in a sitemap or a sitemap index. */
export function parseSitemap(xml: string): ParsedSitemap {
  const sitemaps: string[] = [];
  const urls: string[] = [];
  for (const m of xml.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi)) sitemaps.push(...locs(m[0]));
  const rest = xml.replace(/<sitemap\b[\s\S]*?<\/sitemap>/gi, "");
  for (const m of rest.matchAll(/<url\b[\s\S]*?<\/url>/gi)) urls.push(...locs(m[0]));
  return { urls, sitemaps };
}

/** Up to `max` documentation addresses for a site, in the order its sitemap lists them. Throws WebError if the sitemap cannot be read. */
export async function seedUrls(site: SeedSite, o: { max: number; fetchFn?: FetchLike }): Promise<string[]> {
  const get = async (url: string): Promise<ParsedSitemap> => {
    const r = await httpGet(url, { fetchFn: o.fetchFn, maxBytes: SITEMAP_MAX_BYTES, timeoutMs: SITEMAP_TIMEOUT_MS, headers: { Accept: "application/xml,text/xml,*/*;q=0.5" } });
    if (r.status < 200 || r.status >= 300) throw new WebError(`http_${r.status}`);
    return parseSitemap(r.text);
  };
  const root = await get(site.sitemap);
  let urls = root.urls;
  if (root.sitemaps.length) {
    const chosen = (site.pick ? root.sitemaps.filter((s) => site.pick!.test(s)) : root.sitemaps).slice(0, INDEX_FOLLOW);
    urls = [...urls];
    for (const s of chosen) urls.push(...(await get(s)).urls);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!site.include.test(u) || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= o.max) break;
  }
  return out;
}

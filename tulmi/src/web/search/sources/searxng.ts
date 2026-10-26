/**
 * SEARXNG: THE CLEAN WAY TO GENERAL WEB SEARCH, ON A SERVER WE RUN.
 *
 *   <WEB_SEARXNG_URL>/search?q=&format=json
 *
 * SearXNG is a self-hosted metasearch engine: it asks many engines on our
 * behalf, and the answer is JSON. It is the first discovery source tried when
 * WEB_SEARXNG_URL is set, and the one to scale on (docs/web-search.md).
 *
 * The call goes through the egress guard like every other, so the instance has
 * to be reachable at a PUBLIC https address (port 443 or 8443): put it behind
 * the reverse proxy. An address on the server's own network is refused by the
 * guard on purpose, and this source then fails and the next one is tried.
 *
 * The instance must have the json format switched on (search.formats in its
 * settings.yml); without it SearXNG answers 403, which is a failure like any other.
 */
import { getJson } from "../http.js";
import { SearchSkip, type Result, type Source, type SourceOpts } from "../types.js";
import { clip, compact, kindOfUrl, stripTags, toMs } from "./util.js";

interface SearxAnswer {
  results?: Array<{ title?: string; url?: string; content?: string; publishedDate?: string | null; engine?: string; score?: number }>;
}

export const searxng: Source = {
  id: "searxng",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const base = o.env?.searxngUrl;
    if (!base) throw new SearchSkip("not_configured");
    const text = q.trim();
    if (!text) return [];
    let url: URL;
    try { url = new URL("search", base.endsWith("/") ? base : `${base}/`); } catch { throw new SearchSkip("not_configured"); }
    url.searchParams.set("q", text);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "en");
    if (o.freshness === "month" || o.freshness === "year") url.searchParams.set("time_range", o.freshness);
    const { data } = await getJson<SearxAnswer>(url.href, { fetchFn: o.fetchFn });
    const limit = Math.min(Math.max(o.limit ?? 10, 1), 20);
    const seen = new Set<string>();
    return (data.results ?? []).flatMap((r): Result[] => {
      if (!r.url || !r.title || !/^https?:\/\//i.test(r.url) || seen.has(r.url)) return [];
      seen.add(r.url);
      const published = toMs(r.publishedDate);
      return [{
        title: stripTags(r.title), url: r.url, snippet: clip(stripTags(r.content ?? ""), 300), source: "searxng",
        ...(published ? { published } : {}),
        meta: compact({ kind: kindOfUrl(r.url), engine: r.engine }),
      }];
    }).slice(0, limit);
  },
};

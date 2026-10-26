/**
 * BRAVE SEARCH: THE PAID FALLBACK.
 *
 *   api.search.brave.com/res/v1/web/search?q=      header X-Subscription-Token
 *
 * Used only when BRAVE_SEARCH_KEY is set, and only after the free discovery
 * sources have failed or found nothing (engine.ts). The key goes in the header
 * and nowhere else; it is never in an address, so it can be in no log.
 */
import { getJson } from "../http.js";
import { SearchSkip, type Result, type Source, type SourceOpts } from "../types.js";
import { clip, compact, kindOfUrl, stripTags } from "./util.js";

interface BraveAnswer {
  web?: { results?: Array<{ title?: string; url?: string; description?: string; page_age?: string; age?: string }> };
}

export const brave: Source = {
  id: "brave",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const key = o.env?.braveKey;
    if (!key) throw new SearchSkip("not_configured");
    const text = q.trim();
    if (!text) return [];
    const count = Math.min(Math.max(o.limit ?? 10, 1), 20);
    const fresh = o.freshness === "month" ? "&freshness=pm" : o.freshness === "year" ? "&freshness=py" : "";
    const { data } = await getJson<BraveAnswer>(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(text)}&count=${count}&text_decorations=false${fresh}`,
      { fetchFn: o.fetchFn, headers: { "X-Subscription-Token": key } },
    );
    return (data.web?.results ?? []).flatMap((r): Result[] => {
      if (!r.url || !r.title || !/^https?:\/\//i.test(r.url)) return [];
      const published = r.page_age ? Date.parse(r.page_age) : NaN;
      return [{
        title: stripTags(r.title), url: r.url, snippet: clip(stripTags(r.description ?? ""), 300), source: "brave",
        ...(Number.isFinite(published) ? { published } : {}),
        meta: compact({ kind: kindOfUrl(r.url) }),
      }];
    });
  },
};

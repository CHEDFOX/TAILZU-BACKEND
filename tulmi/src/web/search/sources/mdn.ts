/**
 * MDN: THE WEB PLATFORM'S REFERENCE.
 *
 *   developer.mozilla.org/api/v1/search?q=
 *
 * Keyless. Asked for English pages only. Every result is documentation from the
 * place that is the authority on the browser's APIs, HTML and CSS, so it is a
 * "doc" and the ranker treats its host as official.
 */
import { getJson } from "../http.js";
import type { Result, Source, SourceOpts } from "../types.js";
import { clip, compact, stripTags } from "./util.js";

interface MdnAnswer {
  documents?: Array<{ mdn_url?: string; title?: string; summary?: string; slug?: string; popularity?: number; score?: number }>;
}

export const mdn: Source = {
  id: "mdn",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const text = q.trim();
    if (!text) return [];
    const { data } = await getJson<MdnAnswer>(`https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(text)}&locale=en-US`, { fetchFn: o.fetchFn });
    const limit = Math.min(Math.max(o.limit ?? 10, 1), 10);
    return (data.documents ?? []).slice(0, limit).flatMap((d): Result[] => {
      if (!d.mdn_url || !d.title || !d.mdn_url.startsWith("/")) return [];
      return [{
        title: stripTags(d.title), url: `https://developer.mozilla.org${d.mdn_url}`, snippet: clip(stripTags(d.summary ?? ""), 300), source: "mdn",
        meta: compact({ kind: "doc", slug: d.slug, popularity: d.popularity }),
      }];
    });
  },
};

/**
 * WIKIPEDIA: FOR THE QUESTIONS THAT ARE ABOUT A THING, NOT A LIBRARY.
 *
 *   en.wikipedia.org/w/rest.php/v1/search/page?q=&limit=5
 *
 * Keyless. Wikimedia asks for a User-Agent that says who is calling and answers
 * 429 to a burst, so a search makes one call and a 429 stands the source aside.
 */
import { WebError } from "../../error.js";
import { httpGet } from "../http.js";
import { SearchSkip, type Result, type Source, type SourceOpts } from "../types.js";
import { clip, compact, stripTags } from "./util.js";

interface WikiAnswer {
  pages?: Array<{ key?: string; title?: string; excerpt?: string | null; description?: string | null }>;
}

let standAsideUntil = 0;
export function resetWikipediaForTests(): void { standAsideUntil = 0; }

export const wikipedia: Source = {
  id: "wikipedia",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const text = q.trim();
    if (!text) return [];
    const now = (o.now ?? Date.now)();
    if (standAsideUntil > now) throw new SearchSkip("rate_limited");
    const limit = Math.min(Math.max(o.limit ?? 5, 1), 5);
    const r = await httpGet(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(text)}&limit=${limit}`, { fetchFn: o.fetchFn, headers: { Accept: "application/json" } });
    if (r.status === 429) { standAsideUntil = now + 60_000; throw new SearchSkip("rate_limited"); }
    if (r.status !== 200) throw new WebError(`http_${r.status}`);
    let data: WikiAnswer;
    try { data = JSON.parse(r.text) as WikiAnswer; } catch { throw new WebError("unsupported_type", "json"); }
    return (data.pages ?? []).flatMap((p): Result[] => {
      if (!p.key || !p.title) return [];
      const excerpt = stripTags(p.excerpt ?? "");
      return [{
        title: p.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key).replace(/%2F/g, "/")}`,
        snippet: clip([p.description, excerpt].filter(Boolean).join(" — "), 300), source: "wikipedia",
        meta: compact({ kind: "article", description: p.description ?? undefined }),
      }];
    });
  },
};

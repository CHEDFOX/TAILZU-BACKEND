/**
 * HACKER NEWS (BY ALGOLIA): WHAT DEVELOPERS SAID WHEN A LIBRARY CAME OUT OR WAS COMPARED.
 *
 *   hn.algolia.com/api/v1/search?query=&tags=story
 *
 * Keyless. Useful for "X vs Y" and "what's new in X", where the discussion is
 * the answer. Algolia wants EVERY word in the query to appear, so the query is
 * cut down to its meaningful words ("zod vs yup" finds nothing; "zod yup" finds
 * nine), and if even that finds nothing, to its first two. A link post is
 * returned as the article it points at, with the discussion's address in `meta`;
 * an "Ask HN" is returned as the discussion.
 */
import { getJson } from "../http.js";
import type { Result, Source, SourceOpts } from "../types.js";
import { clip, compact, significantWords, stripTags } from "./util.js";

interface HnAnswer {
  hits?: Array<{ title?: string; url?: string | null; objectID?: string; points?: number; num_comments?: number; created_at_i?: number; story_text?: string | null }>;
}

const DAY = 86_400_000;

export const hn: Source = {
  id: "hn",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const words = significantWords(q, 4);
    if (!words.length) return [];
    const per = Math.min(Math.max(o.limit ?? 10, 1), 10);
    const now = (o.now ?? Date.now)();
    const days = o.freshness === "month" ? 30 : o.freshness === "year" ? 365 : 0;
    const filter = days ? `&numericFilters=${encodeURIComponent(`created_at_i>${Math.floor((now - days * DAY) / 1000)}`)}` : "";
    const ask = async (ws: string[]) =>
      (await getJson<HnAnswer>(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(ws.join(" "))}&tags=story&hitsPerPage=${per}${filter}`, { fetchFn: o.fetchFn })).data.hits ?? [];
    let hits = await ask(words);
    if (!hits.length && words.length > 2) hits = await ask(words.slice(0, 2));

    return hits.flatMap((h): Result[] => {
      if (!h.title || !h.objectID) return [];
      const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
      return [{
        title: stripTags(h.title), url: h.url || discussion, snippet: clip(stripTags(h.story_text ?? ""), 300), source: "hn",
        ...(h.created_at_i ? { published: h.created_at_i * 1000 } : {}),
        meta: compact({ kind: "story", points: h.points, comments: h.num_comments, discussion }),
      }];
    });
  },
};

/**
 * STACK OVERFLOW: QUESTIONS, WITH WHETHER THEY HAVE AN ANSWER THAT WORKED.
 *
 *   api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=&site=stackoverflow&filter=withbody
 *
 * Keyless at 300 calls a day per address; STACKEXCHANGE_KEY (a registered app's
 * key, not a secret of a person's) raises that to 10,000. The API gzips every
 * answer whatever is asked, which http.ts inflates by the bytes it sees.
 *
 * `is_answered` and an accepted answer are carried in `meta` for the ranker to
 * boost. The question's body is stripped to text for the snippet; the answers
 * themselves are not fetched here (a page read of the question has them).
 *
 * The API tells callers to back off with a `backoff` field in the answer, and
 * to stop at `quota_remaining: 0`; both make this source stand aside (SearchSkip)
 * for that long, per process.
 */
import { WebError } from "../../error.js";
import { httpGet } from "../http.js";
import { SearchSkip, type Result, type Source, type SourceOpts } from "../types.js";
import { clip, compact, decodeEntities, stripTags } from "./util.js";

let standAsideUntil = 0;
export function resetStackOverflowForTests(): void { standAsideUntil = 0; }

const QUOTA_WAIT_MS = 60 * 60 * 1000;

interface SoAnswer {
  items?: Array<{
    title?: string; link?: string; body?: string; is_answered?: boolean; accepted_answer_id?: number; score?: number; answer_count?: number;
    tags?: string[]; creation_date?: number; last_activity_date?: number; view_count?: number; closed_date?: number;
  }>;
  backoff?: number;
  quota_remaining?: number;
  error_id?: number;
}

export const stackoverflow: Source = {
  id: "stackoverflow",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const text = q.trim();
    if (!text) return [];
    const now = (o.now ?? Date.now)();
    if (standAsideUntil > now) throw new SearchSkip("rate_limited");
    const per = Math.min(Math.max(o.limit ?? 10, 1), 10);
    const days = o.freshness === "month" ? 30 : o.freshness === "year" ? 365 : 0;
    const url = "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance"
      + `&q=${encodeURIComponent(text)}&site=stackoverflow&filter=withbody&pagesize=${per}`
      + (days ? `&fromdate=${Math.floor(now / 1000) - days * 86_400}` : "")
      + (o.env?.stackKey ? `&key=${encodeURIComponent(o.env.stackKey)}` : "");
    const r = await httpGet(url, { fetchFn: o.fetchFn, headers: { Accept: "application/json" } });
    let data: SoAnswer;
    try { data = JSON.parse(r.text) as SoAnswer; } catch { data = {}; }
    // 502 / error_id 502 is the API's "too many requests"; it comes with a backoff too.
    if (r.status === 502 || r.status === 429 || data.error_id === 502) {
      standAsideUntil = now + Math.max(data.backoff ?? 0, 30) * 1000;
      throw new SearchSkip("rate_limited");
    }
    if (r.status !== 200) throw new WebError(`http_${r.status}`);
    if (typeof data.backoff === "number" && data.backoff > 0) standAsideUntil = now + data.backoff * 1000;
    if (typeof data.quota_remaining === "number" && data.quota_remaining <= 0) standAsideUntil = Math.max(standAsideUntil, now + QUOTA_WAIT_MS);

    return (data.items ?? []).flatMap((i): Result[] => {
      if (!i.title || !i.link) return [];
      const when = i.last_activity_date ?? i.creation_date;
      return [{
        title: decodeEntities(i.title), url: i.link, snippet: clip(stripTags(i.body ?? ""), 300), source: "stackoverflow",
        ...(when ? { published: when * 1000 } : {}),
        meta: compact({
          kind: "question", answered: i.is_answered === true, accepted: typeof i.accepted_answer_id === "number",
          score: i.score, answers: i.answer_count, views: i.view_count, tags: i.tags?.length ? i.tags.slice(0, 6) : undefined,
          closed: i.closed_date ? true : undefined,
        }),
      }];
    });
  },
};

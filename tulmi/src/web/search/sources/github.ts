/**
 * GitHub: REPOSITORIES FOR "WHAT IS THIS LIBRARY", ISSUES FOR "WHY DOES THIS BREAK".
 *
 *   api.github.com/search/repositories?q=
 *   api.github.com/search/issues?q=
 *
 * Which of the two is asked follows the question: an error or a how-to goes to
 * issues (someone has almost always hit the same error, and a closed issue with
 * comments is a fix waiting to be read), everything else to repositories.
 *
 * Keyless, at GitHub's 10 searches a minute for an address; a token (from the
 * caller, never from here) makes it 30. THE LIMIT IS RESPECTED, not tested: every
 * answer's X-RateLimit-Remaining is read, and once it reaches 0 this source
 * stands aside (SearchSkip, so nothing is reported as a failure) until the
 * X-RateLimit-Reset time, without making a call. A 403 or 429 that says the
 * same does the same. The remembered limit is per process and per token (by a
 * short hash of it), so one person's token running dry does not stop another's.
 *
 * A private repository never appears: a token can see them, and a result goes
 * into a cache everyone shares (engine.ts does not cache a search made with a
 * token either; this is the second lock).
 */
import { createHash } from "node:crypto";
import { WebError } from "../../error.js";
import { httpGet } from "../http.js";
import { SearchSkip, type Result, type Source, type SourceOpts } from "../types.js";
import { clip, compact, toMs } from "./util.js";

/** When each key (the address, or a token's hash) may be asked again. Epoch ms. */
const limitedUntil = new Map<string, number>();
const LIMITED_MAX = 500;
const DEFAULT_WAIT_MS = 60_000;

export function resetGithubLimitForTests(): void { limitedUntil.clear(); }

const keyOf = (token: string | undefined) => (token ? `t:${createHash("sha256").update(token).digest("hex").slice(0, 12)}` : "anon");

interface Repo {
  full_name?: string; html_url?: string; description?: string | null; stargazers_count?: number; forks_count?: number; language?: string | null;
  updated_at?: string; pushed_at?: string; license?: { spdx_id?: string | null } | null; archived?: boolean; private?: boolean; topics?: string[];
}
interface Issue {
  title?: string; html_url?: string; body?: string | null; state?: string; comments?: number; created_at?: string; updated_at?: string;
  repository_url?: string; reactions?: { total_count?: number }; pull_request?: unknown; state_reason?: string | null;
}

async function call<T>(path: string, o: SourceOpts): Promise<T[]> {
  const token = o.env?.githubToken;
  const key = keyOf(token);
  const now = (o.now ?? Date.now)();
  const until = limitedUntil.get(key);
  if (until !== undefined) {
    if (until > now) throw new SearchSkip("rate_limited");
    limitedUntil.delete(key);
  }
  const r = await httpGet(`https://api.github.com/search/${path}`, {
    fetchFn: o.fetchFn,
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const remaining = r.headers.get("x-ratelimit-remaining");
  const reset = Number(r.headers.get("x-ratelimit-reset"));
  const retryAfter = Number(r.headers.get("retry-after"));
  const stand = () => {
    const at = retryAfter > 0 ? now + retryAfter * 1000 : reset > 0 ? reset * 1000 : now + DEFAULT_WAIT_MS;
    if (limitedUntil.size >= LIMITED_MAX) limitedUntil.delete(limitedUntil.keys().next().value!);
    limitedUntil.set(key, Math.max(at, now + 1000));
  };
  if (r.status === 429 || (r.status === 403 && (remaining === "0" || retryAfter > 0 || /rate limit/i.test(r.text)))) {
    stand();
    throw new SearchSkip("rate_limited");
  }
  if (r.status !== 200) throw new WebError(`http_${r.status}`);
  // This answer was fine, and was the last one the window allows: the next call waits for the reset.
  if (remaining !== null && Number(remaining) <= 0) stand();
  try {
    const items = (JSON.parse(r.text) as { items?: T[] }).items;
    return Array.isArray(items) ? items : [];
  } catch {
    throw new WebError("unsupported_type", "json");
  }
}

const withoutCode = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/<!--[\s\S]*?-->/g, " ");

export const github: Source = {
  id: "github",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const text = q.trim();
    if (!text) return [];
    const per = Math.min(Math.max(o.limit ?? 10, 1), 10);
    const intent = o.intent;

    if (intent === "error_fix" || intent === "how_to") {
      const issues = await call<Issue>(`issues?q=${encodeURIComponent(`${text} is:issue`)}&per_page=${per}`, o);
      return issues.flatMap((i): Result[] => {
        if (!i.title || !i.html_url || i.pull_request) return [];
        const repo = /\/repos\/([^/]+\/[^/]+)$/.exec(i.repository_url ?? "")?.[1];
        const published = toMs(i.updated_at ?? i.created_at);
        return [{
          title: i.title, url: i.html_url, snippet: clip(withoutCode(i.body ?? ""), 300), source: "github",
          ...(published ? { published } : {}),
          meta: compact({
            kind: "issue", state: i.state, comments: i.comments, repo, reactions: i.reactions?.total_count,
            // Closed as completed is the one that usually holds a fix.
            answered: i.state === "closed" && i.state_reason !== "not_planned" ? true : undefined,
          }),
        }];
      });
    }

    const repos = await call<Repo>(`repositories?q=${encodeURIComponent(text)}&per_page=${per}`, o);
    return repos.flatMap((r): Result[] => {
      if (!r.full_name || !r.html_url || r.private === true) return [];
      const published = toMs(r.pushed_at ?? r.updated_at);
      return [{
        title: r.full_name, url: r.html_url, snippet: clip(r.description ?? "", 300), source: "github",
        ...(published ? { published } : {}),
        meta: compact({
          kind: "repo", stars: r.stargazers_count, forks: r.forks_count, language: r.language ?? undefined,
          license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : undefined,
          deprecated: r.archived ? "the repository is archived" : undefined, topics: r.topics?.length ? r.topics.slice(0, 8) : undefined,
        }),
      }];
    });
  },
};

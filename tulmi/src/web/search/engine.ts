/**
 * THE SEARCH ENGINE: A QUESTION IN, RANKED RESULTS OUT, THE CHEAPEST PLACES FIRST.
 *
 *   search(question, { ctx, depth, limit = 8, ask, fetchFn, now, ... })
 *     -> { plan, results (each with score and reasons), via, cached, notes? }
 *
 * The order of things is the point:
 *
 *   1. THE CACHE. The plan is normalised (intent, sorted queries, sources, site,
 *      freshness) and a search with the same plan, asked in the last 6 hours (24
 *      for a package lookup), is answered from memory: `cached: true`, no source
 *      asked. A search made with a GitHub token is never WRITTEN to the cache,
 *      which everyone shares: a token can see private repositories.
 *   2. OUR OWN INDEX (index.ts), at most 5 chunks of documentation we already hold.
 *   3. THE DIRECT SOURCES the plan names (sources/): registries, GitHub, Stack
 *      Overflow, MDN, Hacker News, Wikipedia, in parallel (Promise.allSettled), so
 *      one that is slow or down costs only itself.
 *   4. DISCOVERY, a general web search, only if what is in hand is thin: fewer than
 *      `limit` strong results (rank.ts STRONG_SCORE), or the question is a general
 *      one or a how-to, which the web at large answers best. The engines are tried
 *      in order, the next only when one fails, is blocked, or finds nothing:
 *      SearXNG (WEB_SEARXNG_URL, ours), then DuckDuckGo's HTML page (a free guest,
 *      low volume, one request every two seconds), then Brave (BRAVE_SEARCH_KEY).
 *      `allowDiscovery` is asked before each query's turn, so a caller can hold a
 *      person to a daily number of them.
 *
 * Then the results of all of them are merged, deduped and ranked (rank.ts), and
 * the best `limit` returned.
 *
 * `depth` "quick" searches with the plan's first query only; "standard" with all
 * of them (up to three; two per source; two for discovery).
 *
 * WHAT IS NEVER DONE: no query is logged, with or without a person's id (there is
 * no person's id in here at all); a source that fails is a note ("npm:timeout"),
 * not an error; and a search that found nothing is not cached, because it may only
 * have been unlucky.
 */
import { getConfig } from "../../config.js";
import { WebError } from "../error.js";
import { DIRECT, DISCOVERY } from "./sources/index.js";
import { clip } from "./sources/util.js";
import { planByRules, planSearch } from "./plan.js";
import { rankResults, STRONG_SCORE, type Group } from "./rank.js";
import { searchCacheKey, searchStore, searchTtlMs, type IndexHit, type SearchStore } from "./index.js";
import {
  DISCOVERY_SOURCES, SearchSkip,
  type AskFn, type DiscoveryId, type FetchLike, type PlanCtx, type Ranked, type Result, type ResultSource, type SearchEnv, type SearchPlan, type Source, type SourceId, type SourceOpts,
} from "./types.js";

/** Most ranked results kept in the cache (the caller's `limit` cuts further). */
export const CACHE_RESULTS_MAX = 20;
/** Most index chunks a search takes. */
export const INDEX_HITS_MAX = 5;
/** Longest a search keeps trying discovery engines. */
export const SEARCH_BUDGET_MS = 30_000;

export interface SearchOptions {
  ctx?: PlanCtx;
  depth?: "quick" | "standard";
  /** Results returned, 1 to 20. Default 8. */
  limit?: number;
  /** A model for the planner, called only when the rules are under 0.7 sure. */
  ask?: AskFn;
  fetchFn?: FetchLike;
  now?: () => number;
  /** A plan already made (research makes its own), in place of planning the question. */
  plan?: SearchPlan;
  /** The cache and the index. The shared store unless given; null for neither. */
  store?: SearchStore | null;
  /** Keys and addresses. WEB_SEARXNG_URL, BRAVE_SEARCH_KEY and STACKEXCHANGE_KEY from the config unless given. */
  env?: SearchEnv;
  /** Sources in place of the real ones. Tests only. */
  sources?: Partial<Record<ResultSource, Source>>;
  /** Asked before each query's turn at the discovery engines; false skips discovery. For a daily number per person. */
  allowDiscovery?: () => boolean;
  /** Waits. Tests only. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export interface SearchOutcome {
  plan: SearchPlan;
  results: Ranked[];
  /** Where the results came from, in the order they were asked: "cache", or "index", the direct sources, then the discovery engine. Only those that found something. */
  via: string[];
  cached: boolean;
  /** What went wrong or was stood aside from, as "source:code" ("ddg:blocked", "npm:timeout", "discovery:daily_cap"). Never any query. */
  notes?: string[];
}

/** The keys the sources use, from the config. Empty without one. */
export function searchEnvFromConfig(): SearchEnv {
  try {
    const c = getConfig();
    return {
      ...(c.WEB_SEARXNG_URL ? { searxngUrl: c.WEB_SEARXNG_URL } : {}),
      ...(c.BRAVE_SEARCH_KEY ? { braveKey: c.BRAVE_SEARCH_KEY } : {}),
      ...(c.STACKEXCHANGE_KEY ? { stackKey: c.STACKEXCHANGE_KEY } : {}),
    };
  } catch {
    return {};
  }
}

const noteOf = (id: string, err: unknown): string =>
  `${id}:${err instanceof SearchSkip ? err.reason : err instanceof WebError ? err.code : "failed"}`;

const withSite = (q: string, site: string[] | undefined): string =>
  site?.length ? `${q} (${site.map((s) => `site:${s}`).join(" OR ")})` : q;

function indexResult(h: IndexHit): Result {
  return {
    title: h.heading ? `${h.title} — ${h.heading}` : h.title,
    url: h.url, snippet: clip(h.body, 400), source: "index",
    meta: { kind: "doc", heading: h.heading, chunk: h.chunkNo, fetchedAt: h.fetchedAt, indexScore: h.score },
  };
}

export async function search(question: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
  const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 8)) || 8, 1), 20);
  const depth = opts.depth ?? "standard";
  const now = opts.now ?? Date.now;
  const started = now();
  const env = opts.env ?? searchEnvFromConfig();
  const store = opts.store === undefined ? searchStore() : opts.store;
  const notes: string[] = [];
  const done = (plan: SearchPlan, results: Ranked[], via: string[], cached: boolean): SearchOutcome =>
    ({ plan, results, via, cached, ...(notes.length ? { notes } : {}) });

  if (!String(question ?? "").trim() && !opts.plan) return done(planByRules(""), [], [], false);
  const plan = opts.plan ?? await planSearch(question, opts.ctx, { ask: opts.ask, signal: opts.signal });
  const queries = depth === "quick" ? plan.queries.slice(0, 1) : plan.queries;

  // 1. the cache
  const key = searchCacheKey(plan, queries);
  if (store) {
    try {
      const hit = await store.getCache(key, now());
      if (hit && hit.results.length) return done(plan, hit.results.slice(0, limit), ["cache"], true);
    } catch {
      notes.push("cache:unreadable");
    }
  }

  const sopts: SourceOpts = {
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}), limit: 10, now, intent: plan.intent, freshness: plan.freshness, env,
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  };
  const pick = (id: ResultSource): Source | undefined =>
    opts.sources?.[id] ?? (id in DIRECT ? DIRECT[id as SourceId] : id in DISCOVERY ? DISCOVERY[id as DiscoveryId] : undefined);
  const groups: Group[] = [];

  // 2. our own index
  if (store) {
    const asks = depth === "quick" ? queries.slice(0, 1) : queries.slice(0, 2);
    const found = await Promise.allSettled(asks.map((q) => store.searchIndex(q, INDEX_HITS_MAX)));
    const best = new Map<string, IndexHit>();
    for (const f of found) {
      if (f.status === "rejected") { notes.push("index:failed"); continue; }
      for (const h of f.value) {
        const k = `${h.url}#${h.chunkNo}`;
        if (!best.has(k) || best.get(k)!.score < h.score) best.set(k, h);
      }
    }
    const hits = [...best.values()].sort((a, b) => b.score - a.score).slice(0, INDEX_HITS_MAX);
    if (hits.length) groups.push({ source: "index", results: hits.map(indexResult) });
  }

  // 3. the direct sources, all at once
  const perSource = depth === "quick" ? 1 : 2;
  const tasks: Array<{ id: SourceId; q: string }> = [];
  for (const id of plan.sources) {
    if (!pick(id)) continue;
    for (const q of queries.slice(0, id === "github" ? 1 : perSource)) tasks.push({ id, q });
  }
  const settled = await Promise.allSettled(tasks.map((t) => pick(t.id)!.search(t.q, sopts)));
  const byId = new Map<SourceId, Result[]>();
  settled.forEach((s, i) => {
    const id = tasks[i]!.id;
    if (s.status === "rejected") { notes.push(noteOf(id, s.reason)); return; }
    if (s.value.length) byId.set(id, [...(byId.get(id) ?? []), ...s.value]);
  });
  for (const id of plan.sources) if (byId.has(id)) groups.push({ source: id, results: byId.get(id)! });

  // 4. discovery, if what we have is thin
  const first = rankResults(plan, groups, now(), CACHE_RESULTS_MAX);
  const strong = first.filter((r) => r.score >= STRONG_SCORE).length;
  if (plan.intent === "general" || plan.intent === "how_to" || strong < limit) {
    const engines = DISCOVERY_SOURCES.filter((id) => (id === "searxng" ? Boolean(env.searxngUrl) : id === "brave" ? Boolean(env.braveKey) : true));
    const dqs = (depth === "quick" ? queries.slice(0, 1) : queries.slice(0, 2)).map((q, i) => (i === 0 ? withSite(q, plan.site) : q));
    for (const q of dqs) {
      if (now() - started > SEARCH_BUDGET_MS || opts.signal?.aborted) { notes.push("discovery:out_of_time"); break; }
      if (opts.allowDiscovery && !opts.allowDiscovery()) { notes.push("discovery:daily_cap"); break; }
      for (const id of engines) {
        const engine = pick(id);
        if (!engine) continue;
        try {
          const res = await engine.search(q, sopts);
          if (res.length) { groups.push({ source: id, results: res }); break; }
          notes.push(`${id}:empty`);
        } catch (err) {
          notes.push(noteOf(id, err));
        }
      }
    }
  }

  const ranked = rankResults(plan, groups, now(), CACHE_RESULTS_MAX);
  const via = [...new Set(groups.filter((g) => g.results.length).map((g) => g.source))];

  // A search made with a token may have seen private repositories: it goes to nobody else.
  const withToken = Boolean(env.githubToken) && plan.sources.includes("github");
  if (store && ranked.length && !withToken) {
    try {
      await store.putCache(key, { plan, results: ranked, expiresAt: now() + searchTtlMs(plan) });
    } catch {
      notes.push("cache:unwritable");
    }
  }
  return done(plan, ranked.slice(0, limit), via, false);
}

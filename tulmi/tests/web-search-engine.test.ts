/**
 * THE SEARCH ENGINE (src/web/search/engine.ts) and the ranker (rank.ts), with
 * sources that answer from a script and a memory store. Nothing here reaches a
 * network; a few tests put the REAL sources behind a fake fetch to see the
 * engine and a source work together.
 *
 * What these hold down:
 *   - the order: the cache, then our own index, then the direct sources all at
 *     once, then (only when what there is is thin, or the question is general or
 *     a how-to) the discovery engines one after another;
 *   - the cache: a hit asks nobody, six hours (a day for a package), nothing
 *     empty is kept, and a search made with a GitHub token is never written;
 *   - discovery: SearXNG, then DuckDuckGo, then Brave, the next only when one
 *     fails, is blocked or finds nothing, an engine with nothing to use skipped,
 *     the daily allowance asked before each query, the docs host named by the
 *     plan on the first query;
 *   - failure: a source that throws or stands aside is a note, not an error,
 *     and GitHub's rate limit costs a quiet note and no call;
 *   - merging and ranking: the same page found twice is one result, official docs
 *     beat padding, an accepted answer beats an unanswered question, a closed
 *     issue beats an open one for an error, an exact name wins a package lookup,
 *     freshness counts only when the plan asks, a deprecated package falls, and
 *     every result says why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

noNetwork();

const { search, searchEnvFromConfig, CACHE_RESULTS_MAX, INDEX_HITS_MAX } = await import("../src/web/search/engine.js");
const { canonicalKey, normalizeResultUrl, rankResults, scoreResult, STRONG_SCORE } = await import("../src/web/search/rank.js");
const { MemorySearchStore, indexPage, searchCacheKey, searchTtlMs } = await import("../src/web/search/index.js");
const { planByRules } = await import("../src/web/search/plan.js");
const { SearchSkip } = await import("../src/web/search/types.js");
const { WebError } = await import("../src/web/error.js");
const { resetGithubLimitForTests } = await import("../src/web/search/sources/github.js");
const { resetDdgForTests } = await import("../src/web/search/sources/ddg.js");
const { resetConfigForTests } = await import("../src/config.js");
type Result = import("../src/web/search/types.js").Result;
type Source = import("../src/web/search/types.js").Source;
type SearchPlan = import("../src/web/search/types.js").SearchPlan;
type ResultSource = import("../src/web/search/types.js").ResultSource;
type SourceOpts = import("../src/web/search/types.js").SourceOpts;

const NOW = Date.parse("2026-10-26T10:00:00.000Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = () => NOW;

beforeEach(() => {
  resetGithubLimitForTests();
  resetDdgForTests();
  resetConfigForTests();
});

// ------------------------------------------------------------------ the fakes

const res = (title: string, url: string, source: ResultSource, over: Partial<Result> = {}): Result => ({ title, url, snippet: `about ${title}`, source, ...over });

type Script = Result[] | Error | ((q: string, o: SourceOpts) => Result[] | Promise<Result[]>);

/** A source that answers from a script and writes every call into a shared log. */
function src(id: ResultSource, script: Script, log: string[] = []): Source & { calls: string[] } {
  const calls: string[] = [];
  return {
    id, calls,
    async search(q, o = {}) {
      calls.push(q);
      log.push(`${id}:${q}`);
      if (script instanceof Error) throw script;
      return typeof script === "function" ? script(q, o) : script;
    },
  };
}

const plan = (over: Partial<SearchPlan> = {}): SearchPlan => ({
  intent: "package_lookup", queries: ["zod"], sources: ["npm"], freshness: "any", confidence: 0.9, ...over,
});

const strongRegistry = (n: number) => Array.from({ length: n }, (_, i) => res(`pkg${i}`, `https://www.npmjs.com/package/pkg${i}`, "npm", { meta: { kind: "package", name: `pkg${i}` } }));

// ------------------------------------------------------------------ the order

describe("the order", () => {
  it("asks the cache, then our index, then the direct sources together, then discovery last", async () => {
    const log: string[] = [];
    const store = new MemorySearchStore(() => NOW);
    await indexPage({ url: "https://react.dev/reference/react/useEffect", title: "useEffect", lang: "en", text: "# useEffect\n\nuseEffect cleanup runs before the effect runs again and when the component unmounts. ".repeat(3), headings: [{ level: 1, text: "useEffect", offset: 0 }], fetchedAt: NOW }, { store });
    const getCache = store.getCache.bind(store);
    const searchIndex = store.searchIndex.bind(store);
    store.getCache = async (...a) => { log.push("cache"); return getCache(...a); };
    store.searchIndex = async (...a) => { log.push(`index:${a[0]}`); return searchIndex(...a); };

    // two direct sources that each wait for the other to have started: they can only finish if they run together
    let started = 0;
    const gate = (id: ResultSource, results: Result[]) => src(id, async () => {
      started += 1;
      for (let i = 0; i < 50 && started < 2; i += 1) await new Promise((r) => setTimeout(r, 1));
      return results;
    }, log);
    const npm = gate("npm", [res("zod", "https://www.npmjs.com/package/zod", "npm", { meta: { kind: "package", name: "zod" } })]);
    const github = gate("github", [res("colinhacks/zod", "https://github.com/colinhacks/zod", "github", { meta: { kind: "repo", stars: 38000 } })]);
    const ddg = src("ddg", [res("zod docs", "https://zod.dev/", "ddg")], log);

    const out = await search("zod", { plan: plan({ sources: ["npm", "github"], queries: ["zod react useEffect"] }), store, now, sources: { npm, github, ddg } });
    expect(started).toBe(2);
    expect(out.via).toEqual(["index", "npm", "github", "ddg"]);
    expect(log[0]).toBe("cache");
    expect(log[1]).toMatch(/^index:/);
    expect(log.indexOf("ddg:zod react useEffect")).toBeGreaterThan(log.indexOf("npm:zod react useEffect"));
    expect(log.indexOf("ddg:zod react useEffect")).toBeGreaterThan(log.indexOf("github:zod react useEffect"));
    expect(out.cached).toBe(false);
  });

  it("plans the question itself unless it is given a plan, and uses the model only for an unsure one", async () => {
    const ask = vi.fn(async () => ({ text: "", json: { intent: "general", queries: ["closures js"], sources: ["wikipedia"], freshness: "any", confidence: 0.8 } }));
    const wiki = src("wikipedia", [res("Closure (computer programming)", "https://en.wikipedia.org/wiki/Closure_(computer_programming)", "wikipedia", { meta: { kind: "article" } })]);
    const out = await search("explain closures", { ask, store: null, now, sources: { wikipedia: wiki, ddg: src("ddg", []) } });
    expect(ask).toHaveBeenCalledOnce();
    expect(out.plan.queries).toEqual(["closures js"]);
    expect(wiki.calls).toEqual(["closures js"]);

    const sure = vi.fn(async () => ({ text: "" }));
    await search("zod vs yup", { ask: sure, store: null, now, sources: { hn: src("hn", []), github: src("github", []), npm: src("npm", []), ddg: src("ddg", []) } });
    expect(sure).not.toHaveBeenCalled();
  });

  it("answers an empty question with nothing and asks no one", async () => {
    const npm = src("npm", strongRegistry(1));
    const out = await search("   ", { store: null, now, sources: { npm } });
    expect(out.results).toEqual([]);
    expect(npm.calls).toEqual([]);
  });

  it("uses the first query only when quick, and two per source (one for GitHub) when standard", async () => {
    const p = plan({ intent: "error_fix", queries: ["q1", "q2", "q3"], sources: ["github", "stackoverflow"] });
    const mk = () => ({ github: src("github", []), stackoverflow: src("stackoverflow", []), ddg: src("ddg", []), brave: src("brave", []) });
    const quick = mk();
    await search("x", { plan: p, depth: "quick", store: null, now, sources: quick });
    expect(quick.github.calls).toEqual(["q1"]);
    expect(quick.stackoverflow.calls).toEqual(["q1"]);
    expect(quick.ddg.calls).toEqual(["q1"]);
    const std = mk();
    await search("x", { plan: p, depth: "standard", store: null, now, sources: std });
    expect(std.github.calls).toEqual(["q1"]);
    expect(std.stackoverflow.calls).toEqual(["q1", "q2"]);
    expect(std.ddg.calls).toEqual(["q1", "q2"]);
  });

  it("takes at most five index chunks, and returns the limit asked for", async () => {
    const store = new MemorySearchStore(() => NOW);
    for (let i = 0; i < 9; i += 1) {
      await indexPage({ url: `https://react.dev/learn/page${i}`, title: `Page ${i}`, lang: "en", text: `# Page ${i}\n\nhooks effects cleanup ${"filler ".repeat(20)} number ${i}`, headings: [{ level: 1, text: `Page ${i}`, offset: 0 }], fetchedAt: NOW }, { store });
    }
    const out = await search("hooks cleanup", { plan: plan({ intent: "api_docs", queries: ["hooks cleanup"], sources: [] }), store, now, limit: 20, sources: { ddg: src("ddg", []) } });
    expect(out.results.filter((r) => r.source === "index")).toHaveLength(INDEX_HITS_MAX);
    const few = await search("hooks cleanup", { plan: plan({ intent: "api_docs", queries: ["hooks cleanup"], sources: [] }), store, now, limit: 2, sources: { ddg: src("ddg", []) } });
    expect(few.results).toHaveLength(2);
    expect(INDEX_HITS_MAX).toBe(5);
  });
});

// ------------------------------------------------------------------ the cache

describe("the cache", () => {
  it("answers a repeat from memory without asking any source, whatever order the queries were planned in", async () => {
    const store = new MemorySearchStore(() => NOW);
    const npm = src("npm", strongRegistry(3));
    const p = plan({ queries: ["Zod", "zod  schema"], sources: ["npm"] });
    const first = await search("zod", { plan: p, store, now, sources: { npm, ddg: src("ddg", []) } });
    expect(first.cached).toBe(false);
    expect(npm.calls).toHaveLength(2);
    const again = await search("zod", { plan: { ...p, queries: ["zod schema", "ZOD"] }, store, now: () => NOW + HOUR, sources: { npm, ddg: src("ddg", []) } });
    expect(again.cached).toBe(true);
    expect(again.via).toEqual(["cache"]);
    expect(again.results.map((r) => r.url)).toEqual(first.results.map((r) => r.url));
    expect(again.results[0]!.reasons.length).toBeGreaterThan(0);
    expect(npm.calls).toHaveLength(2);
  });

  it("serves a search for six hours and a package lookup for a day", async () => {
    expect(searchTtlMs(plan({ intent: "package_lookup" }))).toBe(24 * HOUR);
    expect(searchTtlMs(plan({ intent: "how_to" }))).toBe(6 * HOUR);
    for (const [intent, ttl] of [["package_lookup", 24 * HOUR], ["how_to", 6 * HOUR]] as const) {
      const store = new MemorySearchStore(() => NOW);
      const s = src("npm", strongRegistry(2));
      const p = plan({ intent, sources: ["npm"] });
      const opts = { plan: p, store, sources: { npm: s, ddg: src("ddg", []) } };
      await search("x", { ...opts, now });
      expect((await search("x", { ...opts, now: () => NOW + ttl - 1 })).cached, `${intent} just before`).toBe(true);
      expect((await search("x", { ...opts, now: () => NOW + ttl })).cached, `${intent} at the limit`).toBe(false);
    }
  });

  it("is keyed by the normalised plan: intent, queries, sources, site and freshness", () => {
    const a = searchCacheKey(plan({ queries: ["B", "a"] }));
    expect(searchCacheKey(plan({ queries: ["a ", "b"] }))).toBe(a);
    expect(searchCacheKey(plan({ queries: ["a", "b"], intent: "how_to" }))).not.toBe(a);
    expect(searchCacheKey(plan({ queries: ["a", "b"], sources: ["npm", "github"] }))).not.toBe(a);
    expect(searchCacheKey(plan({ queries: ["a", "b"], freshness: "year" }))).not.toBe(a);
    expect(searchCacheKey(plan({ queries: ["a", "b"], site: ["react.dev"] }))).not.toBe(a);
    expect(searchCacheKey(plan({ queries: ["a", "b"], sources: ["github", "npm"] }))).toBe(searchCacheKey(plan({ queries: ["a", "b"], sources: ["npm", "github"] })));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not keep a search that found nothing, since it may only have been unlucky", async () => {
    const store = new MemorySearchStore(() => NOW);
    const s = src("npm", []);
    const opts = { plan: plan(), store, now, sources: { npm: s, ddg: src("ddg", []) } };
    await search("x", opts);
    await search("x", opts);
    expect(s.calls).toHaveLength(2);
  });

  it("never writes a search made with a GitHub token (it may have seen a private repository), and still reads", async () => {
    const store = new MemorySearchStore(() => NOW);
    const s = src("github", [res("o/r", "https://github.com/o/r", "github", { meta: { kind: "repo" } })]);
    const p = plan({ sources: ["github"] });
    const mine = await search("x", { plan: p, store, now, env: { githubToken: "t" }, sources: { github: s, ddg: src("ddg", []) } });
    expect(mine.results).toHaveLength(1);
    expect((await search("x", { plan: p, store, now, env: { githubToken: "t" }, sources: { github: s, ddg: src("ddg", []) } })).cached).toBe(false);
    expect((await search("x", { plan: p, store, now, sources: { github: s, ddg: src("ddg", []) } })).cached).toBe(false);
    // written by a search without one, a search with one may read it
    expect((await search("x", { plan: p, store, now, env: { githubToken: "t" }, sources: { github: s, ddg: src("ddg", []) } })).cached).toBe(true);
    expect(s.calls.length).toBeGreaterThan(0);
  });

  it("goes on without a cache that cannot be read or written", async () => {
    const store = new MemorySearchStore(() => NOW);
    store.getCache = async () => { throw new Error("db down"); };
    store.putCache = async () => { throw new Error("db down"); };
    const out = await search("x", { plan: plan(), store, now, sources: { npm: src("npm", strongRegistry(2)), ddg: src("ddg", []) } });
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.notes).toEqual(expect.arrayContaining(["cache:unreadable", "cache:unwritable"]));
  });

  it("keeps up to twenty ranked results for the next asker and returns only the limit", async () => {
    const store = new MemorySearchStore(() => NOW);
    const s = src("npm", strongRegistry(30));
    const p = plan();
    const first = await search("x", { plan: p, store, now, limit: 3, sources: { npm: s, ddg: src("ddg", []) } });
    expect(first.results).toHaveLength(3);
    const wide = await search("x", { plan: p, store, now, limit: 15, sources: { npm: s } });
    expect(wide.cached).toBe(true);
    expect(wide.results).toHaveLength(15);
    expect(CACHE_RESULTS_MAX).toBe(20);
  });
});

// ------------------------------------------------------------------ discovery

describe("discovery", () => {
  const web = (n: number, source: ResultSource = "ddg") => Array.from({ length: n }, (_, i) => res(`Page ${i}`, `https://blog${i}.example.com/post`, source));

  it("is skipped when there are already `limit` strong results", async () => {
    const ddg = src("ddg", web(3));
    const out = await search("x", { plan: plan({ intent: "package_lookup", sources: ["npm"] }), limit: 5, store: null, now, sources: { npm: src("npm", strongRegistry(6)), ddg } });
    expect(out.results.every((r) => r.score >= STRONG_SCORE)).toBe(true);
    expect(ddg.calls).toEqual([]);
    expect(out.via).toEqual(["npm"]);
  });

  it("runs when what there is is thin, and always for a general question or a how-to", async () => {
    const thin = src("ddg", web(2));
    await search("x", { plan: plan({ sources: ["npm"] }), limit: 5, store: null, now, sources: { npm: src("npm", strongRegistry(2)), ddg: thin } });
    expect(thin.calls).toHaveLength(1);
    for (const intent of ["general", "how_to"] as const) {
      const d = src("ddg", web(1));
      await search("x", { plan: plan({ intent, sources: ["npm"] }), limit: 2, store: null, now, sources: { npm: src("npm", strongRegistry(9)), ddg: d } });
      expect(d.calls, intent).toHaveLength(1);
    }
  });

  it("tries SearXNG, then DuckDuckGo, then Brave, each only when the one before failed, was blocked or found nothing", async () => {
    const log: string[] = [];
    const searx = src("searxng", new WebError("http_403"), log);
    const ddg = src("ddg", new SearchSkip("blocked"), log);
    const brave = src("brave", web(2, "brave"), log);
    const out = await search("x", {
      plan: plan({ intent: "general", sources: [] }), store: null, now, env: { searxngUrl: "https://s.example.com", braveKey: "k" },
      sources: { searxng: searx, ddg, brave },
    });
    expect(log).toEqual(["searxng:zod", "ddg:zod", "brave:zod"]);
    expect(out.via).toEqual(["brave"]);
    expect(out.notes).toEqual(["searxng:http_403", "ddg:blocked"]);

    const empty = src("searxng", []);
    const fine = src("ddg", web(1));
    const spare = src("brave", web(1, "brave"));
    const o2 = await search("x", { plan: plan({ intent: "general", sources: [] }), store: null, now, env: { searxngUrl: "https://s.example.com", braveKey: "k" }, sources: { searxng: empty, ddg: fine, brave: spare } });
    expect(o2.via).toEqual(["ddg"]);
    expect(o2.notes).toEqual(["searxng:empty"]);
    expect(spare.calls).toEqual([]); // the paid one is not spent while a free one answers
  });

  it("leaves out an engine with nothing to use: no SearXNG address, no Brave key", async () => {
    const searx = src("searxng", web(1, "searxng"));
    const ddg = src("ddg", web(1));
    const brave = src("brave", web(1, "brave"));
    await search("x", { plan: plan({ intent: "general", sources: [] }), store: null, now, env: {}, sources: { searxng: searx, ddg, brave } });
    expect(searx.calls).toEqual([]);
    expect(ddg.calls).toHaveLength(1);
    expect(brave.calls).toEqual([]);
    const out = await search("x", { plan: plan({ intent: "general", sources: [] }), store: null, now, env: {}, sources: { ddg: src("ddg", new SearchSkip("blocked")), brave } });
    expect(out.results).toEqual([]);
    expect(brave.calls).toEqual([]);
  });

  it("asks the daily allowance before each query's turn and stops at no", async () => {
    const ddg = src("ddg", web(1));
    let allowed = 1;
    const out = await search("x", {
      plan: plan({ intent: "error_fix", queries: ["q1", "q2", "q3"], sources: [] }), store: null, now, depth: "standard",
      allowDiscovery: () => allowed-- > 0, sources: { ddg },
    });
    expect(ddg.calls).toEqual(["q1"]);
    expect(out.notes).toContain("discovery:daily_cap");
    const none = src("ddg", web(1));
    const out2 = await search("x", { plan: plan({ intent: "general", sources: [] }), store: null, now, allowDiscovery: () => false, sources: { ddg: none } });
    expect(none.calls).toEqual([]);
    expect(out2.notes).toEqual(["discovery:daily_cap"]);
  });

  it("restricts the first query to the plan's documentation host and leaves the second as it was", async () => {
    const ddg = src("ddg", web(1));
    await search("x", { plan: plan({ intent: "api_docs", queries: ["react useEffect", "useEffect cleanup"], sources: [], site: ["react.dev", "nextjs.org/docs"] }), store: null, now, sources: { ddg } });
    expect(ddg.calls).toEqual(["react useEffect (site:react.dev OR site:nextjs.org/docs)", "useEffect cleanup"]);
  });

  it("passes the plan's intent and freshness to every source", async () => {
    const seen: SourceOpts[] = [];
    const s = src("npm", (_q, o) => { seen.push(o); return []; });
    const d = src("ddg", (_q, o) => { seen.push(o); return []; });
    await search("x", { plan: plan({ intent: "version_news", freshness: "month", sources: ["npm"] }), store: null, now, sources: { npm: s, ddg: d } });
    expect(seen).toHaveLength(2);
    for (const o of seen) expect(o).toMatchObject({ intent: "version_news", freshness: "month" });
  });
});

// ------------------------------------------------------------------- failures

describe("a source that fails", () => {
  it("is a note and costs the others nothing", async () => {
    const out = await search("x", {
      plan: plan({ sources: ["npm", "github", "stackoverflow", "mdn"] }), store: null, now,
      sources: {
        npm: src("npm", new WebError("timeout")), github: src("github", new SearchSkip("rate_limited")), stackoverflow: src("stackoverflow", new TypeError("boom")),
        mdn: src("mdn", [res("Array.map", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map", "mdn", { meta: { kind: "doc" } })]),
        ddg: src("ddg", []),
      },
    });
    expect(out.results).toHaveLength(1);
    expect(out.via).toEqual(["mdn"]);
    expect(out.notes).toEqual(expect.arrayContaining(["npm:timeout", "github:rate_limited", "stackoverflow:failed"]));
    // no note holds a query or an address
    expect(JSON.stringify(out.notes)).not.toMatch(/https?:|zod/);
  });

  it("leaves out a source it has no implementation of, and returns nothing when everything fails", async () => {
    const out = await search("x", { plan: plan({ sources: ["npm"] }), store: null, now, sources: { npm: src("npm", new Error("x")), ddg: src("ddg", new Error("y")) } });
    expect(out.results).toEqual([]);
    expect(out.via).toEqual([]);
  });

  it("stands aside quietly from GitHub's rate limit, with the real source and no second call", async () => {
    const calls: string[] = [];
    const internet = async (input: string | URL) => {
      const u = new URL(String(input));
      calls.push(u.hostname + u.pathname);
      if (u.hostname === "api.github.com") {
        return new Response(JSON.stringify({ items: [{ full_name: "colinhacks/zod", html_url: "https://github.com/colinhacks/zod", stargazers_count: 100, pushed_at: "2026-10-01T00:00:00Z" }] }), { headers: { "content-type": "application/json", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor((NOW + 60_000) / 1000)) } });
      }
      return new Response("{}", { status: 404 });
    };
    const p = plan({ sources: ["github"], queries: ["zod"] });
    const first = await search("zod", { plan: p, store: null, now, fetchFn: internet, depth: "quick", sources: { ddg: src("ddg", []) } });
    expect(first.results.map((r) => r.title)).toEqual(["colinhacks/zod"]);
    const second = await search("zod validation", { plan: { ...p, queries: ["zod validation"] }, store: null, now: () => NOW + 1_000, fetchFn: internet, depth: "quick", sources: { ddg: src("ddg", []) } });
    expect(second.results).toEqual([]);
    expect(second.notes).toEqual(["github:rate_limited", "ddg:empty"]); // GitHub stood aside; the engine behind it found nothing either
    expect(calls.filter((c) => c.startsWith("api.github.com"))).toHaveLength(1);
  });

  it("reads the keys it was not given from the config", () => {
    process.env.WEB_SEARXNG_URL = "https://search.example.com/";
    process.env.BRAVE_SEARCH_KEY = " brave-key ";
    process.env.STACKEXCHANGE_KEY = "se-key";
    resetConfigForTests();
    expect(searchEnvFromConfig()).toEqual({ searxngUrl: "https://search.example.com", braveKey: "brave-key", stackKey: "se-key" });
    delete process.env.WEB_SEARXNG_URL;
    delete process.env.BRAVE_SEARCH_KEY;
    delete process.env.STACKEXCHANGE_KEY;
    resetConfigForTests();
    expect(searchEnvFromConfig()).toEqual({});
  });
});

// ------------------------------------------------------------ merging and ranking

describe("merging", () => {
  it("normalises an address to one key whichever way it was written", () => {
    const k = normalizeResultUrl("https://react.dev/learn");
    for (const same of ["http://REACT.dev/learn/", "https://www.react.dev/learn#top", "https://react.dev/learn?utm_source=x&fbclid=1", "https://react.dev:443/learn"]) {
      expect(normalizeResultUrl(same), same).toBe(k);
    }
    expect(normalizeResultUrl("https://react.dev/learn?a=2&b=1")).toBe(normalizeResultUrl("https://react.dev/learn?b=1&a=2"));
    expect(normalizeResultUrl("https://react.dev/learn?page=2")).not.toBe(k);
    expect(normalizeResultUrl("not a url")).toBe("not a url");
  });

  it("knows one package or repository under its several addresses", () => {
    expect(canonicalKey("https://www.npmjs.com/package/zod")).toBe(canonicalKey("https://npmjs.com/package/zod/"));
    expect(canonicalKey("https://www.npmjs.com/package/@tanstack/react-query")).toBe("npm:@tanstack/react-query");
    expect(canonicalKey("https://pypi.org/project/Foo_Bar/1.0/")).toBe(canonicalKey("https://pypi.org/project/foo-bar/"));
    expect(canonicalKey("https://crates.io/crates/serde")).toBe("crates:serde");
    expect(canonicalKey("https://github.com/Colinhacks/Zod")).toBe(canonicalKey("https://github.com/colinhacks/zod/"));
    expect(canonicalKey("https://github.com/colinhacks/zod.git")).toBe(canonicalKey("https://github.com/colinhacks/zod"));
    expect(canonicalKey("https://github.com/colinhacks/zod/issues/1")).not.toBe(canonicalKey("https://github.com/colinhacks/zod"));
  });

  it("makes one result of a package found by the registry and by a search engine, and says so", async () => {
    const out = await search("zod", {
      plan: plan({ sources: ["npm"] }), store: null, now,
      sources: {
        npm: src("npm", [res("zod@4", "https://www.npmjs.com/package/zod", "npm", { meta: { kind: "package", name: "zod", version: "4.0.0", license: "MIT" } })]),
        ddg: src("ddg", [res("zod - npm", "https://npmjs.com/package/zod?activeTab=readme", "ddg", { snippet: "A longer description from the engine", meta: { kind: "package" } }), res("zod.dev", "https://zod.dev/", "ddg")]),
      },
    });
    expect(out.results.filter((r) => /npmjs/.test(r.url))).toHaveLength(1);
    const pkg = out.results.find((r) => /npmjs/.test(r.url))!;
    expect(pkg.source).toBe("npm");
    expect(pkg.meta).toMatchObject({ license: "MIT", version: "4.0.0" });
    expect(pkg.reasons.some((r) => /also found via ddg/.test(r))).toBe(true);
    expect(out.via).toEqual(["npm", "ddg"]);
  });

  it("gives a result found by two sources a little more than by one", () => {
    const p = plan({ intent: "general" });
    const one = rankResults(p, [{ source: "ddg", results: [res("A", "https://a.example.com/x", "ddg")] }], NOW, 5)[0]!;
    const two = rankResults(p, [{ source: "ddg", results: [res("A", "https://a.example.com/x", "ddg")] }, { source: "brave", results: [res("A", "https://a.example.com/x/", "brave")] }], NOW, 5)[0]!;
    expect(two.score).toBeGreaterThan(one.score);
    expect(two.score).toBeLessThan(one.score * 1.2);
  });

  it("drops a result that is not a web address, and keeps the order of equal scores", () => {
    const p = plan({ intent: "general" });
    const out = rankResults(p, [{ source: "ddg", results: [res("a", "https://a.example.com/", "ddg"), res("bad", "javascript:alert(1)", "ddg"), res("b", "https://b.example.com/", "ddg")] }], NOW, 10);
    expect(out.map((r) => r.title)).toEqual(["a", "b"]);
  });
});

describe("ranking", () => {
  const top = (p: SearchPlan, ...results: Result[]) => rankResults(p, [{ source: results[0]!.source, results }], NOW, 10);
  const scoreOf = (p: SearchPlan, r: Result) => scoreResult(p, r, 0, NOW);

  it("puts official documentation above a blog about it, and above padding", () => {
    const p = plan({ intent: "api_docs", queries: ["react useEffect"], site: ["react.dev"] });
    const out = rankResults(p, [{ source: "ddg", results: [
      res("A blog", "https://someone.example.com/useeffect", "ddg", { meta: { kind: "page" } }),
      res("GfG", "https://www.geeksforgeeks.org/useeffect-hook", "ddg", { meta: { kind: "page" } }),
      res("useEffect", "https://react.dev/reference/react/useEffect", "ddg", { meta: { kind: "doc" } }),
    ] }], NOW, 10);
    expect(out.map((r) => r.title)).toEqual(["useEffect", "A blog", "GfG"]);
    expect(out[0]!.reasons).toContain("official docs the plan asked for");
    expect(out[2]!.reasons).toContain("content farm");
    expect(out[2]!.score).toBeGreaterThan(out[1]!.score * 0.7); // mild, not a ban
    expect(out[2]!.score).toBeLessThan(out[1]!.score);
  });

  it("puts an accepted Stack Overflow answer above an answered question above an unanswered one", () => {
    const p = plan({ intent: "how_to" });
    const q = (title: string, meta: Record<string, unknown>) => res(title, `https://stackoverflow.com/questions/${title.length}/x`, "stackoverflow", { meta: { kind: "question", ...meta } });
    const out = rankResults(p, [{ source: "stackoverflow", results: [q("unanswered", { answered: false }), q("answered!", { answered: true }), q("accepted answer", { answered: true, accepted: true })] }], NOW, 10);
    // each is a different position in its own source, which is worth a little; the evidence is worth more
    expect(out.map((r) => r.title)).toEqual(["accepted answer", "answered!", "unanswered"]);
    expect(out[0]!.reasons).toContain("accepted answer");
    expect(out[2]!.reasons).toContain("unanswered");
  });

  it("puts a closed issue with discussion above an open one for an error, and above a repository", () => {
    const p = plan({ intent: "error_fix", queries: ["\"TypeError\""] });
    const issue = (n: number, meta: Record<string, unknown>) => res(`issue ${n}`, `https://github.com/a/b/issues/${n}`, "github", { meta: { kind: "issue", ...meta } });
    const out = rankResults(p, [{ source: "github", results: [
      issue(1, { state: "open", comments: 1 }),
      res("some/repo", "https://github.com/some/repo", "github", { meta: { kind: "repo", stars: 50_000 } }),
      issue(2, { state: "closed", answered: true, comments: 9 }),
    ] }], NOW, 10);
    expect(out.map((r) => r.title)).toEqual(["issue 2", "issue 1", "some/repo"]);
    expect(out[0]!.reasons).toContain("closed after discussion");
  });

  it("puts the exact name first for a package lookup, and a registry entry above a blog", () => {
    const p = plan({ intent: "package_lookup", queries: ["zod"] });
    const out = rankResults(p, [{ source: "npm", results: [
      res("zod-to-json-schema", "https://www.npmjs.com/package/zod-to-json-schema", "npm", { meta: { kind: "package", name: "zod-to-json-schema" } }),
      res("zod", "https://www.npmjs.com/package/zod", "npm", { meta: { kind: "package", name: "zod" } }),
    ] }, { source: "ddg", results: [res("Zod tutorial", "https://blog.example.com/zod", "ddg", { meta: { kind: "page" } })] }], NOW, 10);
    expect(out.map((r) => r.title)).toEqual(["zod", "zod-to-json-schema", "Zod tutorial"]);
    expect(out[0]!.reasons).toEqual(expect.arrayContaining(["exact name", "registry"]));
  });

  it("counts freshness only when the plan asks for it", () => {
    const old = res("old", "https://old.example.com/", "ddg", { published: NOW - 4 * 365 * DAY });
    const fresh = res("fresh", "https://fresh.example.com/", "ddg", { published: NOW - 10 * DAY });
    const undated = res("undated", "https://undated.example.com/", "ddg");
    const any = plan({ intent: "general", freshness: "any" });
    expect(scoreOf(any, old).score).toBe(scoreOf(any, fresh).score);
    for (const freshness of ["year", "month"] as const) {
      const p = plan({ intent: "general", freshness });
      const [a, b, c] = [scoreOf(p, fresh), scoreOf(p, undated), scoreOf(p, old)];
      expect(a.score, freshness).toBeGreaterThan(b.score);
      expect(b.score, freshness).toBeGreaterThan(c.score);
      expect(a.reasons).toContain("recent");
      expect(c.reasons).toContain("old");
    }
    // a month asks for more than a year does
    expect(scoreOf(plan({ intent: "general", freshness: "month" }), res("x", "https://x.example.com/", "ddg", { published: NOW - 200 * DAY })).score)
      .toBeLessThan(scoreOf(plan({ intent: "general", freshness: "year" }), res("x", "https://x.example.com/", "ddg", { published: NOW - 200 * DAY })).score);
  });

  it("does not count documentation's or a registry entry's date against it", () => {
    const p = plan({ intent: "api_docs", freshness: "year" });
    const doc = scoreOf(p, res("d", "https://react.dev/learn", "ddg", { published: NOW - 5 * 365 * DAY }));
    expect(doc.reasons).not.toContain("old");
    const pkg = scoreOf(plan({ freshness: "year" }), res("p", "https://www.npmjs.com/package/x", "npm", { meta: { kind: "package", name: "x" } }));
    expect(pkg.reasons).not.toContain("old");
  });

  it("marks down a deprecated package and an archived repository, and says so", () => {
    const p = plan({ intent: "package_lookup", queries: ["other"] });
    const fine = scoreOf(p, res("a", "https://www.npmjs.com/package/a", "npm", { meta: { kind: "package", name: "a" } }));
    const dep = scoreOf(p, res("b", "https://www.npmjs.com/package/b", "npm", { meta: { kind: "package", name: "b", deprecated: "use c" } }));
    expect(dep.score).toBeCloseTo(fine.score * 0.5, 2);
    expect(dep.reasons).toContain("deprecated");
    const arch = scoreOf(plan({ intent: "version_news" }), res("o/r", "https://github.com/o/r", "github", { meta: { kind: "repo", deprecated: "the repository is archived" } }));
    expect(arch.reasons).toContain("archived");
  });

  it("weighs the source, the kind of result and the position, and the score is the product", () => {
    const p = plan({ intent: "general" });
    const first = scoreResult(p, res("a", "https://a.example.com/", "ddg"), 0, NOW);
    const fifth = scoreResult(p, res("a", "https://a.example.com/", "ddg"), 4, NOW);
    expect(fifth.score).toBeLessThan(first.score);
    expect(first.score).toBeCloseTo(0.8 * 1 * 1 * 1 * 1, 3); // ddg weight 0.8, "page" fits "general" at 1
    const wiki = scoreResult(p, res("w", "https://en.wikipedia.org/wiki/X", "wikipedia", { meta: { kind: "article" } }), 0, NOW);
    expect(wiki.score).toBeCloseTo(0.6 * 1 * 0.9, 3);
  });

  it("returns every result with a score and reasons, best first", async () => {
    const out = await search("x", {
      plan: plan({ intent: "error_fix", queries: ["q"], sources: ["github", "stackoverflow"] }), store: null, now,
      sources: {
        github: src("github", [res("i", "https://github.com/a/b/issues/1", "github", { meta: { kind: "issue", state: "closed", answered: true, comments: 5 } })]),
        stackoverflow: src("stackoverflow", [res("q", "https://stackoverflow.com/questions/1/x", "stackoverflow", { meta: { kind: "question", answered: true, accepted: true } })]),
        ddg: src("ddg", []),
      },
    });
    expect(out.results).toHaveLength(2);
    for (const r of out.results) {
      expect(typeof r.score).toBe("number");
      expect(r.reasons.length).toBeGreaterThan(0);
    }
    expect(out.results[0]!.score).toBeGreaterThanOrEqual(out.results[1]!.score);
  });

  it("works from a real question: a package question puts the registry first", async () => {
    const p = planByRules("npm install zod");
    const out = await search("npm install zod", {
      plan: p, store: null, now,
      sources: {
        npm: src("npm", [res("zod@4", "https://www.npmjs.com/package/zod", "npm", { meta: { kind: "package", name: "zod" } })]),
        github: src("github", [res("colinhacks/zod", "https://github.com/colinhacks/zod", "github", { meta: { kind: "repo", stars: 38_000 } })]),
        ddg: src("ddg", [res("Zod docs", "https://zod.dev/", "ddg", { meta: { kind: "page" } })]),
      },
    });
    expect(out.results[0]!.url).toBe("https://www.npmjs.com/package/zod");
    expect(out.plan.intent).toBe("package_lookup");
  });
});

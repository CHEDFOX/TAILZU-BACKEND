/**
 * THE SEARCH SOURCES (src/web/search/sources/*.ts) and the one way out they share
 * (src/web/search/http.ts), against fake fetches that answer with the shapes the
 * real services return. Nothing here reaches a network.
 *
 * What these hold down:
 *   - the request each source makes: the address, the parameters, our User-Agent
 *     (crates.io refuses a call without one), keys in headers where they belong;
 *   - the answer each source makes of what it is given: title, address, snippet,
 *     date, and the facts in `meta` that the ranker reads;
 *   - the free-tier manners: GitHub's X-RateLimit-Remaining honoured with no call
 *     made while it is 0, Stack Overflow's backoff, DuckDuckGo's one request in
 *     two seconds and ten minutes of rest after a challenge, a 429 from Wikipedia;
 *   - Stack Overflow's gzip, handled by the bytes whatever the header says, with
 *     the size cap on the inflated bytes too;
 *   - DuckDuckGo's HTML: the uddg redirect unwrapped, ads dropped, entities decoded;
 *   - the limits of the way out: ten seconds, a size cap, errors that carry a
 *     code and never the address (it holds the question).
 */
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const net = noNetwork();

const { getJson, getText, httpGet, maybeGunzip, SEARCH_MAX_BYTES } = await import("../src/web/search/http.js");
const { npm } = await import("../src/web/search/sources/npm.js");
const { pypi } = await import("../src/web/search/sources/pypi.js");
const { crates } = await import("../src/web/search/sources/crates.js");
const { github, resetGithubLimitForTests } = await import("../src/web/search/sources/github.js");
const { stackoverflow, resetStackOverflowForTests } = await import("../src/web/search/sources/stackoverflow.js");
const { mdn } = await import("../src/web/search/sources/mdn.js");
const { hn } = await import("../src/web/search/sources/hn.js");
const { wikipedia, resetWikipediaForTests } = await import("../src/web/search/sources/wikipedia.js");
const { searxng } = await import("../src/web/search/sources/searxng.js");
const { ddg, parseDdg, unwrapDdgLink, resetDdgForTests, DDG_BLOCK_MS, DDG_GAP_MS } = await import("../src/web/search/sources/ddg.js");
const { brave } = await import("../src/web/search/sources/brave.js");
const { DIRECT, DISCOVERY } = await import("../src/web/search/sources/index.js");
const { clip, decodeEntities, kindOfUrl, packageCandidates, significantWords, stripTags } = await import("../src/web/search/sources/util.js");
const { SearchSkip } = await import("../src/web/search/types.js");
const { resetConfigForTests, getConfig } = await import("../src/config.js");
type FetchLike = import("../src/connectors/egress.js").FetchLike;

const NOW = Date.parse("2026-10-26T10:00:00.000Z");

beforeEach(() => {
  resetGithubLimitForTests();
  resetStackOverflowForTests();
  resetWikipediaForTests();
  resetDdgForTests();
  resetConfigForTests();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.WEB_BOT_UA;
  resetConfigForTests();
});

// ------------------------------------------------------------------ the fakes

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function fake(handler: Handler) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchFn: FetchLike = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers) });
    return handler(new URL(url), init);
  };
  return { fetchFn, calls, urls: () => calls.map((c) => c.url) };
}

const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json", ...init.headers } });
/** What the Stack Exchange API sends: gzip, and the header saying so. */
const gz = (data: unknown) => new Response(gzipSync(Buffer.from(JSON.stringify(data))), { headers: { "content-type": "application/json; charset=utf-8", "content-encoding": "gzip" } });
const html = (body: string, init: ResponseInit = {}) => new Response(body, { ...init, headers: { "content-type": "text/html; charset=utf-8", ...init.headers } });

const failsWith = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(() => null, (e: unknown) => e as { name?: string; code?: string; message?: string });
  expect(err, "it should have thrown").not.toBeNull();
  expect(err).toMatchObject({ name: "WebError", code });
  return err!;
};

// ------------------------------------------------------------------ the way out

describe("the way out (http.ts)", () => {
  it("sends our User-Agent, and takes the headers a source adds", async () => {
    const f = fake(() => json({ ok: true }));
    await getJson("https://example.com/x?q=secret-question", { fetchFn: f.fetchFn, headers: { "X-Thing": "1" } });
    expect(f.calls[0]!.headers.get("user-agent")).toBe(getConfig().WEB_BOT_UA);
    expect(f.calls[0]!.headers.get("user-agent")).toMatch(/TailzuBot.*x0bot\.com\/bot/);
    expect(f.calls[0]!.headers.get("x-thing")).toBe("1");
    expect(f.calls[0]!.headers.get("accept")).toBe("application/json");
    expect(f.calls[0]!.headers.get("cookie")).toBeNull();
  });

  it("uses WEB_BOT_UA when it is set", async () => {
    process.env.WEB_BOT_UA = "Mozilla/5.0 (compatible; Test/1.0; +https://example.com/bot)";
    resetConfigForTests();
    const f = fake(() => json({}));
    await getJson("https://example.com/x", { fetchFn: f.fetchFn });
    expect(f.calls[0]!.headers.get("user-agent")).toBe("Mozilla/5.0 (compatible; Test/1.0; +https://example.com/bot)");
  });

  it("turns a status into http_<status> for getJson and getText, and hands it back from httpGet", async () => {
    const f = fake(() => new Response("nope", { status: 503, headers: { "x-ratelimit-remaining": "0" } }));
    await failsWith(getJson("https://example.com/x", { fetchFn: f.fetchFn }), "http_503");
    await failsWith(getText("https://example.com/x", { fetchFn: f.fetchFn }), "http_503");
    const r = await httpGet("https://example.com/x", { fetchFn: f.fetchFn });
    expect(r.status).toBe(503);
    expect(r.headers.get("x-ratelimit-remaining")).toBe("0");
  });

  it("says unsupported_type for a body that is not JSON", async () => {
    await failsWith(getJson("https://example.com/x", { fetchFn: fake(() => html("<html>")).fetchFn }), "unsupported_type");
  });

  it("gives up after its time limit whatever the fetch does, and says timeout", async () => {
    const hang: FetchLike = () => new Promise(() => { /* never answers */ });
    const t0 = Date.now();
    await failsWith(httpGet("https://example.com/x", { fetchFn: hang, timeoutMs: 40 }), "timeout");
    expect(Date.now() - t0).toBeLessThan(1000);
    // and one that answers its headers and then stalls the body
    const stall: FetchLike = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } }), { headers: { "content-type": "application/json" } });
    await failsWith(httpGet("https://example.com/x", { fetchFn: stall, timeoutMs: 40 }), "timeout");
  });

  it("refuses a body over the size cap, declared or not", async () => {
    const big = "x".repeat(SEARCH_MAX_BYTES + 10);
    await failsWith(httpGet("https://example.com/x", { fetchFn: fake(() => new Response(big)).fetchFn }), "too_large");
    await failsWith(httpGet("https://example.com/x", { fetchFn: fake(() => new Response("tiny", { headers: { "content-length": String(SEARCH_MAX_BYTES + 1) } })).fetchFn }), "too_large");
    expect((await httpGet("https://example.com/x", { fetchFn: fake(() => new Response(big)).fetchFn, maxBytes: SEARCH_MAX_BYTES * 2 })).text.length).toBe(big.length);
  });

  it("inflates gzip by its bytes, header or no header, and holds the inflated size to the cap", async () => {
    const body = JSON.stringify({ a: "é".repeat(50) });
    const fromBytes = await httpGet("https://example.com/x", { fetchFn: fake(() => new Response(gzipSync(Buffer.from(body)))).fetchFn });
    expect(fromBytes.text).toBe(body);
    expect(maybeGunzip(new TextEncoder().encode("plain"), 100)).toEqual(new TextEncoder().encode("plain"));
    // 5 MiB of zeros is a few kilobytes gzipped
    const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(SEARCH_MAX_BYTES);
    await failsWith(httpGet("https://example.com/x", { fetchFn: fake(() => new Response(bomb)).fetchFn }), "too_large");
    await failsWith(httpGet("https://example.com/x", { fetchFn: fake(() => new Response(Buffer.from([0x1f, 0x8b, 1, 2, 3]))).fetchFn }), "unsupported_type");
  });

  it("names a refused address and an unreachable server by code, and never puts the address in the message", async () => {
    const { EgressRefused } = await import("../src/connectors/egress.js");
    const priv = await failsWith(httpGet("https://internal.example/x?q=my-secret-question", { fetchFn: async () => { throw new EgressRefused("private_address"); } }), "blocked_address");
    const down = await failsWith(httpGet("https://example.com/x?q=my-secret-question", { fetchFn: async () => { throw new TypeError("fetch failed"); } }), "bad_url");
    for (const e of [priv, down]) expect(e.message).not.toMatch(/secret|example|internal/);
  });

  it("goes through the egress guard unless a fetch is given", async () => {
    const { setEgressTestHooks } = await import("../src/connectors/egress.js");
    net.allowNetwork(); // the guard refuses the address inside the connection's own lookup, before anything is sent
    setEgressTestHooks({ resolve: () => ["10.0.0.5"] });
    try {
      await failsWith(httpGet("https://search.example.com/x"), "blocked_address");
    } finally {
      setEgressTestHooks(null);
    }
  });
});

describe("the helpers", () => {
  it("decode character references and strip tags without joining words", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#39;d&#39; &#x2F; &quot;e&quot; &unknown; &#0;")).toBe("a & b <c> 'd' / \"e\" &unknown; ");
    expect(stripTags("<p>One</p><p>two <b>three</b></p><script>x()</script>&amp;")).toBe("One two three &");
    expect(clip("a ".repeat(200), 20).length).toBeLessThanOrEqual(20);
    expect(clip("short", 20)).toBe("short");
  });
  it("find the words that matter and the names that could be packages", () => {
    expect(significantWords("How do I use zod vs yup in a form?")).toEqual(["zod", "yup", "form"]);
    expect(packageCandidates("npm install zod")).toEqual(["zod"]);
    expect(packageCandidates("python requests package")).toEqual(["requests"]);
    expect(packageCandidates("@tanstack/react-query")).toEqual(["@tanstack/react-query"]);
    expect(packageCandidates("the what is")).toEqual([]);
  });
  it("say what kind of thing an address is", () => {
    expect(kindOfUrl("https://www.npmjs.com/package/zod")).toBe("package");
    expect(kindOfUrl("https://github.com/colinhacks/zod")).toBe("repo");
    expect(kindOfUrl("https://github.com/colinhacks/zod/issues/12")).toBe("issue");
    expect(kindOfUrl("https://stackoverflow.com/questions/1/x")).toBe("question");
    expect(kindOfUrl("https://react.dev/learn")).toBe("doc");
    expect(kindOfUrl("https://example.com/blog")).toBe("page");
  });
  it("has every source registered", () => {
    expect(Object.keys(DIRECT).sort()).toEqual(["crates", "github", "hn", "mdn", "npm", "pypi", "stackoverflow", "wikipedia"]);
    expect(Object.keys(DISCOVERY)).toEqual(["searxng", "ddg", "brave"]);
    for (const [id, s] of [...Object.entries(DIRECT), ...Object.entries(DISCOVERY)]) expect(s.id).toBe(id);
  });
});

// ----------------------------------------------------------------------- npm

const NPM_SEARCH = {
  objects: [
    {
      downloads: { monthly: 873_839_899, weekly: 211_917_605 }, updated: "2026-10-26T19:52:04.541Z", searchScore: 2281.8,
      package: {
        name: "zod", version: "4.6.7", description: "TypeScript-first schema declaration and validation library with static type inference",
        keywords: ["typescript", "schema", "validation"], date: "2026-10-12T16:29:37.778Z",
        links: { npm: "https://www.npmjs.com/package/zod", homepage: "https://zod.dev", repository: "git+https://github.com/colinhacks/zod.git" },
      },
    },
    {
      package: { name: "zod-to-json-schema", version: "3.24.1", description: "Converts Zod schemas to JSON Schemas", date: "2026-08-01T00:00:00.000Z", links: { npm: "https://www.npmjs.com/package/zod-to-json-schema" } },
    },
    { package: { name: "@scope/zodish", version: "1.0.0", description: "Scoped", date: "2025-01-01T00:00:00.000Z", links: {} } },
    { package: { name: "old-zod", version: "0.1.0", description: "Old", date: "2019-01-01T00:00:00.000Z", links: {} } },
  ],
};

describe("npm", () => {
  const f = () => fake((u) => {
    if (u.hostname === "registry.npmjs.org" && u.pathname === "/-/v1/search") return json(NPM_SEARCH);
    if (u.pathname === "/zod/latest") return json({ name: "zod", version: "4.6.7", license: "MIT", repository: { type: "git", url: "git+https://github.com/colinhacks/zod.git" }, homepage: "https://zod.dev" });
    if (u.pathname === "/zod-to-json-schema/latest") return json({ name: "zod-to-json-schema", license: "ISC", deprecated: "use zod's own toJSONSchema instead", repository: "git@github.com:StefanTerdell/zod-to-json-schema.git" });
    if (u.pathname === "/@scope%2Fzodish/latest") return json({ license: { type: "Apache-2.0" } });
    if (u.hostname === "api.npmjs.org") return json({ downloads: 4242, package: decodeURIComponent(u.pathname.split("/").pop()!) });
    return new Response("", { status: 404 });
  });

  it("asks the registry's search for ten, and enriches only the first three hits", async () => {
    const s = f();
    const out = await npm.search("zod", { fetchFn: s.fetchFn });
    expect(s.urls()[0]).toBe("https://registry.npmjs.org/-/v1/search?text=zod&size=10");
    const paths = s.calls.map((c) => new URL(c.url).pathname + new URL(c.url).hostname);
    expect(paths.filter((p) => p.includes("latest")).length).toBe(3);
    expect(paths.some((p) => p.includes("old-zod"))).toBe(false);
    expect(out).toHaveLength(4);
  });

  it("returns the package with its facts: version, license, repo, deprecation, modified, downloads", async () => {
    const out = await npm.search("zod", { fetchFn: f().fetchFn });
    expect(out[0]).toMatchObject({
      title: "zod@4.6.7", url: "https://www.npmjs.com/package/zod", source: "npm", published: Date.parse("2026-10-12T16:29:37.778Z"),
      meta: { kind: "package", ecosystem: "npm", name: "zod", version: "4.6.7", license: "MIT", repo: "https://github.com/colinhacks/zod", weeklyDownloads: 211_917_605, homepage: "https://zod.dev" },
    });
    expect(out[0]!.snippet).toMatch(/^TypeScript-first schema/);
    expect(out[1]!.meta).toMatchObject({ license: "ISC", deprecated: "use zod's own toJSONSchema instead", repo: "https://github.com/StefanTerdell/zod-to-json-schema", weeklyDownloads: 4242 });
    expect(out[2]!.meta).toMatchObject({ license: "Apache-2.0" });
    expect(out[3]!.meta).not.toHaveProperty("license");
  });

  it("takes weekly downloads from the downloads API when the search answer does not carry them", async () => {
    const s = f();
    await npm.search("zod", { fetchFn: s.fetchFn });
    const down = s.urls().filter((u) => u.startsWith("https://api.npmjs.org/downloads/point/last-week/"));
    expect(down).toEqual(expect.arrayContaining(["https://api.npmjs.org/downloads/point/last-week/zod-to-json-schema", "https://api.npmjs.org/downloads/point/last-week/@scope%2Fzodish"]));
    expect(down).not.toContain("https://api.npmjs.org/downloads/point/last-week/zod");
  });

  it("enriches an exact name match first, wherever the search put it", async () => {
    const s = fake((u) => {
      if (u.pathname === "/-/v1/search") return json({ objects: [1, 2, 3, 4].map((n) => ({ package: { name: `pkg${n}`, version: "1.0.0", links: {} } })).concat([{ package: { name: "target", version: "2.0.0", links: {} } }]) });
      return json({ license: "MIT", downloads: 1 });
    });
    const out = await npm.search("target", { fetchFn: s.fetchFn });
    expect(out.find((r) => r.meta?.name === "target")!.meta).toMatchObject({ license: "MIT" });
    expect(out.find((r) => r.meta?.name === "pkg4")!.meta).not.toHaveProperty("license");
  });

  it("keeps a hit whose extra calls failed, with less in meta, and fails only when the search does", async () => {
    const s = fake((u) => (u.pathname === "/-/v1/search" ? json(NPM_SEARCH) : new Response("", { status: 500 })));
    const out = await npm.search("zod", { fetchFn: s.fetchFn });
    expect(out).toHaveLength(4);
    expect(out[0]!.meta).toMatchObject({ name: "zod", version: "4.6.7", weeklyDownloads: 211_917_605 });
    await failsWith(npm.search("zod", { fetchFn: fake(() => new Response("", { status: 503 })).fetchFn }), "http_503");
  });

  it("answers an empty query with nothing, without a call", async () => {
    const s = f();
    expect(await npm.search("  ", { fetchFn: s.fetchFn })).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------- pypi

const PYPI_DOC = {
  info: {
    name: "requests", version: "2.34.2", summary: "Python HTTP for Humans.", license: "Apache-2.0", home_page: null, package_url: "https://pypi.org/project/requests/",
    project_urls: { Documentation: "https://requests.readthedocs.io", Source: "https://github.com/psf/requests" }, requires_python: ">=3.10", yanked: false,
    classifiers: ["Programming Language :: Python :: 3"],
  },
  releases: {}, urls: [{ upload_time_iso_8601: "2026-05-14T19:25:26.443000Z" }],
};

describe("pypi", () => {
  it("asks for the package by its name and returns it with its facts", async () => {
    const s = fake(() => json(PYPI_DOC));
    const out = await pypi.search("python requests package", { fetchFn: s.fetchFn });
    expect(s.urls()).toEqual(["https://pypi.org/pypi/requests/json"]);
    expect(out).toEqual([{
      title: "requests 2.34.2", url: "https://pypi.org/project/requests/", snippet: "Python HTTP for Humans.", source: "pypi", published: Date.parse("2026-05-14T19:25:26.443Z"),
      meta: { kind: "package", ecosystem: "pypi", name: "requests", version: "2.34.2", license: "Apache-2.0", repo: "https://github.com/psf/requests", requiresPython: ">=3.10", modified: Date.parse("2026-05-14T19:25:26.443Z") },
    }]);
  });

  it("treats a 404 as no such package, not as a failure", async () => {
    expect(await pypi.search("nopkgxyz", { fetchFn: fake(() => new Response("", { status: 404 })).fetchFn })).toEqual([]);
  });

  it("tries two names and keeps the one that exists; fails only when no name got an answer and one was a real error", async () => {
    const s = fake((u) => (u.pathname.includes("/flask/") ? json({ info: { name: "Flask", version: "3.0", summary: "x" }, urls: [] }) : new Response("", { status: 404 })));
    const out = await pypi.search("django flask", { fetchFn: s.fetchFn });
    expect(out.map((r) => r.title)).toEqual(["Flask 3.0"]);
    await failsWith(pypi.search("requests", { fetchFn: fake(() => new Response("", { status: 500 })).fetchFn }), "http_500");
    expect(await pypi.search("django flask", { fetchFn: fake((u) => (u.pathname.includes("/django/") ? new Response("", { status: 500 }) : new Response("", { status: 404 }))).fetchFn }).catch(() => "failed")).toBe("failed");
  });

  it("notes a yanked or inactive project, and leaves a license that is the whole license text out", async () => {
    const yanked = await pypi.search("old", { fetchFn: fake(() => json({ info: { name: "old", version: "1", yanked: true, license: "A very long license text\nthat goes on" }, urls: [] })).fetchFn });
    expect(yanked[0]!.meta).toMatchObject({ deprecated: "this release was yanked" });
    expect(yanked[0]!.meta).not.toHaveProperty("license");
    const inactive = await pypi.search("old", { fetchFn: fake(() => json({ info: { name: "old", version: "1", classifiers: ["Development Status :: 7 - Inactive"] }, urls: [] })).fetchFn });
    expect(inactive[0]!.meta).toMatchObject({ deprecated: "marked inactive" });
  });

  it("does not ask for anything that is not a name", async () => {
    const s = fake(() => json(PYPI_DOC));
    expect(await pypi.search("how do I parse json?", { fetchFn: s.fetchFn })).toEqual(expect.any(Array));
    expect(s.urls().every((u) => /^https:\/\/pypi\.org\/pypi\/[A-Za-z0-9._-]+\/json$/.test(u))).toBe(true);
  });
});

// -------------------------------------------------------------------- crates

describe("crates.io", () => {
  const ANSWER = {
    crates: [
      { id: "serde", name: "serde", max_version: "1.0.229", description: "A generic serialization/deserialization framework", downloads: 1_592_982_922, recent_downloads: 385_791_241, updated_at: "2026-07-18T23:05:13.266456Z", repository: "https://github.com/serde-rs/serde", homepage: "https://serde.rs", documentation: "https://docs.rs/serde", exact_match: true },
      { id: "serde_json", name: "serde_json", newest_version: "1.0.140", description: null, updated_at: "2026-06-01T00:00:00Z", yanked: true },
      { id: "x" },
    ],
  };

  it("sends our User-Agent (crates.io refuses a call without one) and the query", async () => {
    const s = fake(() => json(ANSWER));
    await crates.search("serde json", { fetchFn: s.fetchFn });
    expect(s.urls()).toEqual(["https://crates.io/api/v1/crates?q=serde%20json&per_page=10"]);
    expect(s.calls[0]!.headers.get("user-agent")).toMatch(/TailzuBot/);
  });

  it("returns crates with version, repository, downloads and the exact-match flag, and drops one with no name", async () => {
    const out = await crates.search("serde", { fetchFn: fake(() => json(ANSWER)).fetchFn });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "serde 1.0.229", url: "https://crates.io/crates/serde", source: "crates", published: Date.parse("2026-07-18T23:05:13.266456Z"),
      meta: { kind: "package", ecosystem: "crates", name: "serde", version: "1.0.229", repo: "https://github.com/serde-rs/serde", downloads: 1_592_982_922, recentDownloads: 385_791_241, exactMatch: true, docs: "https://docs.rs/serde" },
    });
    expect(out[1]).toMatchObject({ title: "serde_json 1.0.140", snippet: "", meta: { deprecated: "the newest version was yanked" } });
  });
});

// -------------------------------------------------------------------- github

const REPOS = {
  items: [
    { full_name: "colinhacks/zod", html_url: "https://github.com/colinhacks/zod", description: "TypeScript-first schema validation", stargazers_count: 38_000, forks_count: 1_500, language: "TypeScript", pushed_at: "2026-10-20T10:00:00Z", license: { spdx_id: "MIT" }, archived: false, private: false, topics: ["validation"] },
    { full_name: "me/secret", html_url: "https://github.com/me/secret", private: true },
    { full_name: "old/lib", html_url: "https://github.com/old/lib", description: "x", stargazers_count: 12, archived: true, license: { spdx_id: "NOASSERTION" } },
  ],
};
const ISSUES = {
  items: [
    { title: "TypeError: Cannot read properties of undefined (reading 'map')", html_url: "https://github.com/facebook/react/issues/1234", body: "I see this.\n```js\nconst x = a.map()\n```\nSteps follow <!-- hidden -->", state: "closed", state_reason: "completed", comments: 7, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z", repository_url: "https://api.github.com/repos/facebook/react", reactions: { total_count: 9 } },
    { title: "A pull request", html_url: "https://github.com/a/b/pull/3", pull_request: {}, body: "x" },
    { title: "Won't fix", html_url: "https://github.com/a/b/issues/4", state: "closed", state_reason: "not_planned", comments: 1, repository_url: "https://api.github.com/repos/a/b" },
  ],
};

describe("GitHub", () => {
  const reply = (h: Record<string, string> = {}, body: unknown = REPOS) => json(body, { headers: { "x-ratelimit-remaining": "9", "x-ratelimit-reset": String(Math.floor((NOW + 60_000) / 1000)), ...h } });

  it("searches repositories for a package question, with the headers GitHub asks for", async () => {
    const s = fake(() => reply());
    const out = await github.search("zod", { fetchFn: s.fetchFn, intent: "package_lookup" });
    expect(s.urls()).toEqual(["https://api.github.com/search/repositories?q=zod&per_page=10"]);
    expect(s.calls[0]!.headers.get("accept")).toBe("application/vnd.github+json");
    expect(s.calls[0]!.headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(s.calls[0]!.headers.get("authorization")).toBeNull();
    expect(out.map((r) => r.title)).toEqual(["colinhacks/zod", "old/lib"]); // the private one is never shown
    expect(out[0]).toMatchObject({ meta: { kind: "repo", stars: 38_000, language: "TypeScript", license: "MIT" }, published: Date.parse("2026-10-20T10:00:00Z") });
    expect(out[1]!.meta).toMatchObject({ deprecated: "the repository is archived" });
    expect(out[1]!.meta).not.toHaveProperty("license");
  });

  it("searches issues for an error or a how-to, closed ones marked answered, pull requests left out", async () => {
    for (const intent of ["error_fix", "how_to"] as const) {
      const s = fake(() => reply({}, ISSUES));
      const out = await github.search("\"TypeError: x\"", { fetchFn: s.fetchFn, intent });
      expect(s.urls()[0]).toBe(`https://api.github.com/search/issues?q=${encodeURIComponent("\"TypeError: x\" is:issue")}&per_page=10`);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ meta: { kind: "issue", state: "closed", comments: 7, repo: "facebook/react", reactions: 9, answered: true } });
      expect(out[0]!.snippet).toBe("I see this. Steps follow");
      expect(out[1]!.meta).not.toHaveProperty("answered");
    }
  });

  it("sends a token as a bearer header when it has one", async () => {
    const s = fake(() => reply());
    await github.search("zod", { fetchFn: s.fetchFn, env: { githubToken: "tok-123" } });
    expect(s.calls[0]!.headers.get("authorization")).toBe("Bearer tok-123");
  });

  it("stands aside once X-RateLimit-Remaining reaches 0, making no call until the reset, then asks again", async () => {
    const s = fake(() => reply({ "x-ratelimit-remaining": "0" }));
    await github.search("zod", { fetchFn: s.fetchFn, now: () => NOW }); // this answer is fine, and the last one
    expect(s.calls).toHaveLength(1);
    await expect(github.search("zod", { fetchFn: s.fetchFn, now: () => NOW + 1_000 })).rejects.toBeInstanceOf(SearchSkip);
    await expect(github.search("zod", { fetchFn: s.fetchFn, now: () => NOW + 30_000 })).rejects.toMatchObject({ reason: "rate_limited" });
    expect(s.calls).toHaveLength(1);
    await github.search("zod", { fetchFn: s.fetchFn, now: () => NOW + 61_000 });
    expect(s.calls).toHaveLength(2);
  });

  it("stands aside on a 403 or 429 that says the limit was passed", async () => {
    for (const res of [
      () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor((NOW + 90_000) / 1000)) } }),
      () => new Response(JSON.stringify({ message: "API rate limit exceeded for 1.2.3.4" }), { status: 403 }),
      () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
    ]) {
      resetGithubLimitForTests();
      const s = fake(res);
      await expect(github.search("zod", { fetchFn: s.fetchFn, now: () => NOW })).rejects.toBeInstanceOf(SearchSkip);
      await expect(github.search("zod", { fetchFn: s.fetchFn, now: () => NOW + 5_000 })).rejects.toBeInstanceOf(SearchSkip);
      expect(s.calls).toHaveLength(1);
    }
  });

  it("keeps one limit for the address and a separate one for each token", async () => {
    const s = fake(() => reply({ "x-ratelimit-remaining": "0" }));
    await github.search("a", { fetchFn: s.fetchFn, now: () => NOW });
    await expect(github.search("a", { fetchFn: s.fetchFn, now: () => NOW })).rejects.toBeInstanceOf(SearchSkip);
    await github.search("a", { fetchFn: s.fetchFn, now: () => NOW, env: { githubToken: "one" } });
    await expect(github.search("a", { fetchFn: s.fetchFn, now: () => NOW, env: { githubToken: "one" } })).rejects.toBeInstanceOf(SearchSkip);
    await github.search("a", { fetchFn: s.fetchFn, now: () => NOW, env: { githubToken: "two" } });
    expect(s.calls).toHaveLength(3);
  });

  it("calls a real error an error, and does not mistake an ordinary 403 for the limit", async () => {
    await failsWith(github.search("zod", { fetchFn: fake(() => new Response("{}", { status: 403 })).fetchFn }), "http_403");
    await failsWith(github.search("zod", { fetchFn: fake(() => new Response("{}", { status: 422 })).fetchFn }), "http_422");
  });
});

// ------------------------------------------------------------- stack overflow

const SO = {
  has_more: true, quota_max: 300, quota_remaining: 196,
  items: [
    { tags: ["javascript", "react", "arrays"], is_answered: true, accepted_answer_id: 41974490, view_count: 2_339_164, answer_count: 26, score: 1247, last_activity_date: 1743578381, creation_date: 1454932854, question_id: 35269179, link: "https://stackoverflow.com/questions/35269179/angular-conditional-class", title: "Angular: it&#39;s a &quot;class&quot; question", body: "<p>What is wrong with my <code>Angular</code> code?</p><pre><code>x()</code></pre>" },
    { tags: ["python"], is_answered: false, answer_count: 0, score: -1, creation_date: 1600000000, link: "https://stackoverflow.com/questions/1/x", title: "Unanswered", body: "<p>Help</p>", closed_date: 1600001000 },
    { title: "no link" },
  ],
};

describe("Stack Overflow", () => {
  it("asks the advanced search for relevance with bodies, and reads the gzip it gets back", async () => {
    const s = fake(() => gz(SO));
    const out = await stackoverflow.search("cannot read properties of undefined", { fetchFn: s.fetchFn });
    expect(s.urls()[0]).toBe("https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=cannot%20read%20properties%20of%20undefined&site=stackoverflow&filter=withbody&pagesize=10");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "Angular: it's a \"class\" question", url: "https://stackoverflow.com/questions/35269179/angular-conditional-class", source: "stackoverflow", published: 1743578381 * 1000,
      meta: { kind: "question", answered: true, accepted: true, score: 1247, answers: 26, views: 2_339_164, tags: ["javascript", "react", "arrays"] },
    });
    expect(out[0]!.snippet).toBe("What is wrong with my Angular code? x()");
    expect(out[1]!.meta).toMatchObject({ answered: false, accepted: false, closed: true });
  });

  it("also reads a plain answer, and one a real fetch has already inflated", async () => {
    const out = await stackoverflow.search("x", { fetchFn: fake(() => json(SO)).fetchFn });
    expect(out).toHaveLength(2);
  });

  it("sends the app key when it has one and a window when freshness is asked for", async () => {
    const s = fake(() => gz(SO));
    await stackoverflow.search("x", { fetchFn: s.fetchFn, env: { stackKey: "KEY(1)" }, freshness: "year", now: () => NOW });
    const u = new URL(s.urls()[0]!);
    expect(u.searchParams.get("key")).toBe("KEY(1)");
    expect(u.searchParams.get("fromdate")).toBe(String(Math.floor(NOW / 1000) - 365 * 86_400));
    const none = fake(() => gz(SO));
    await stackoverflow.search("x", { fetchFn: none.fetchFn });
    expect(none.urls()[0]).not.toMatch(/key=|fromdate/);
  });

  it("obeys the API's backoff, and stops for a while when the quota is gone", async () => {
    const s = fake(() => gz({ ...SO, backoff: 20 }));
    await stackoverflow.search("x", { fetchFn: s.fetchFn, now: () => NOW });
    await expect(stackoverflow.search("x", { fetchFn: s.fetchFn, now: () => NOW + 10_000 })).rejects.toBeInstanceOf(SearchSkip);
    expect(s.calls).toHaveLength(1);
    await stackoverflow.search("x", { fetchFn: s.fetchFn, now: () => NOW + 21_000 });
    expect(s.calls).toHaveLength(2);

    resetStackOverflowForTests();
    const q = fake(() => gz({ ...SO, quota_remaining: 0 }));
    await stackoverflow.search("x", { fetchFn: q.fetchFn, now: () => NOW });
    await expect(stackoverflow.search("x", { fetchFn: q.fetchFn, now: () => NOW + 3_600_000 - 1 })).rejects.toBeInstanceOf(SearchSkip);
  });

  it("treats the API's throttle (502, error_id 502) as a reason to stand aside, and other errors as errors", async () => {
    const s = fake(() => new Response(JSON.stringify({ error_id: 502, error_message: "too many requests" }), { status: 400 }));
    await expect(stackoverflow.search("x", { fetchFn: s.fetchFn, now: () => NOW })).rejects.toBeInstanceOf(SearchSkip);
    resetStackOverflowForTests();
    await failsWith(stackoverflow.search("x", { fetchFn: fake(() => new Response("", { status: 500 })).fetchFn }), "http_500");
  });
});

// ------------------------------------------------------ mdn, hn and wikipedia

describe("MDN", () => {
  it("asks for English, and returns the documents with their full address", async () => {
    const s = fake(() => json({
      documents: [
        { mdn_url: "/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map", score: 86.8, title: "Array.prototype.map()", locale: "en-us", slug: "web/javascript/reference/global_objects/array/map", popularity: 0.15, summary: "The map() method of Array instances\ncreates a new array." },
        { mdn_url: "javascript:alert(1)", title: "bad" },
      ],
      metadata: { took_ms: 5 },
    }));
    const out = await mdn.search("array map", { fetchFn: s.fetchFn });
    expect(s.urls()).toEqual(["https://developer.mozilla.org/api/v1/search?q=array%20map&locale=en-US"]);
    expect(out).toEqual([{
      title: "Array.prototype.map()", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map",
      snippet: "The map() method of Array instances creates a new array.", source: "mdn",
      meta: { kind: "doc", slug: "web/javascript/reference/global_objects/array/map", popularity: 0.15 },
    }]);
  });
});

describe("Hacker News", () => {
  const HITS = { hits: [
    { title: "Show HN: Unified interface for TypeScript schema validations (zod, yup)", url: "https://github.com/decs/typeschema", objectID: "36604518", points: 3, num_comments: 0, created_at_i: 1688580469 },
    { title: "Ask HN: Zod or Yup?", url: null, objectID: "111", points: 40, num_comments: 22, created_at_i: 1700000000, story_text: "<p>Which do you use?</p>" },
    { objectID: "9" },
  ] };

  it("cuts the query to its meaningful words (every word must match), and returns the article with its discussion", async () => {
    const s = fake(() => json(HITS));
    const out = await hn.search("zod vs yup for forms?", { fetchFn: s.fetchFn });
    expect(s.urls()).toEqual(["https://hn.algolia.com/api/v1/search?query=zod%20yup%20forms&tags=story&hitsPerPage=10"]);
    expect(out[0]).toMatchObject({
      title: "Show HN: Unified interface for TypeScript schema validations (zod, yup)", url: "https://github.com/decs/typeschema", source: "hn", published: 1688580469 * 1000,
      meta: { kind: "story", points: 3, discussion: "https://news.ycombinator.com/item?id=36604518" },
    });
    expect(out[1]).toMatchObject({ url: "https://news.ycombinator.com/item?id=111", snippet: "Which do you use?", meta: { comments: 22 } });
    expect(out).toHaveLength(2);
  });

  it("tries again with its first two words when all of them found nothing, and adds a date window for freshness", async () => {
    const s = fake((u) => json(u.searchParams.get("query") === "zod yup" ? HITS : { hits: [] }));
    const out = await hn.search("zod yup forms validation", { fetchFn: s.fetchFn, freshness: "month", now: () => NOW });
    expect(out).toHaveLength(2);
    expect(s.urls().map((u) => new URL(u).searchParams.get("query"))).toEqual(["zod yup forms validation", "zod yup"]);
    expect(new URL(s.urls()[0]!).searchParams.get("numericFilters")).toBe(`created_at_i>${Math.floor((NOW - 30 * 86_400_000) / 1000)}`);
  });

  it("does not call for a query that is all stop words", async () => {
    const s = fake(() => json(HITS));
    expect(await hn.search("how do i", { fetchFn: s.fetchFn })).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });
});

describe("Wikipedia", () => {
  it("returns pages with their excerpt's markup stripped", async () => {
    const s = fake(() => json({ pages: [{ id: 920901, key: "Software_versioning", title: "Software versioning", excerpt: "commonly adopted scheme is <span class=\"searchmatch\">semantic</span> <span class=\"searchmatch\">versioning</span> (SemVer)", description: "Unique identification of incremental software updates" }, { title: "no key" }] }));
    const out = await wikipedia.search("semantic versioning", { fetchFn: s.fetchFn });
    expect(s.urls()).toEqual(["https://en.wikipedia.org/w/rest.php/v1/search/page?q=semantic%20versioning&limit=5"]);
    expect(out).toEqual([{
      title: "Software versioning", url: "https://en.wikipedia.org/wiki/Software_versioning", source: "wikipedia",
      snippet: "Unique identification of incremental software updates — commonly adopted scheme is semantic versioning (SemVer)", meta: { kind: "article", description: "Unique identification of incremental software updates" },
    }]);
  });

  it("stands aside for a minute after a 429", async () => {
    const s = fake(() => new Response("You are making too many requests", { status: 429 }));
    await expect(wikipedia.search("x", { fetchFn: s.fetchFn, now: () => NOW })).rejects.toBeInstanceOf(SearchSkip);
    await expect(wikipedia.search("x", { fetchFn: s.fetchFn, now: () => NOW + 59_000 })).rejects.toBeInstanceOf(SearchSkip);
    expect(s.calls).toHaveLength(1);
  });
});

// ----------------------------------------------------------- the discovery sources

describe("SearXNG", () => {
  it("steps aside when there is no address, and asks for json when there is", async () => {
    await expect(searxng.search("x", {})).rejects.toMatchObject({ reason: "not_configured" });
    const s = fake(() => json({ results: [
      { title: "useEffect &amp; cleanup", url: "https://react.dev/reference/react/useEffect", content: "Call <b>useEffect</b> at the top level", publishedDate: "2026-01-02T00:00:00", engine: "duckduckgo" },
      { title: "dup", url: "https://react.dev/reference/react/useEffect", content: "again" },
      { title: "ftp", url: "ftp://x/y" },
    ] }));
    const out = await searxng.search("react useEffect", { fetchFn: s.fetchFn, env: { searxngUrl: "https://search.example.com/sx" }, freshness: "year" });
    const u = new URL(s.urls()[0]!);
    expect(u.origin + u.pathname).toBe("https://search.example.com/sx/search");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ q: "react useEffect", format: "json", time_range: "year" });
    expect(out).toEqual([{
      title: "useEffect & cleanup", url: "https://react.dev/reference/react/useEffect", snippet: "Call useEffect at the top level", source: "searxng",
      published: Date.parse("2026-01-02T00:00:00"), meta: { kind: "doc", engine: "duckduckgo" },
    }]);
  });
});

describe("Brave", () => {
  it("steps aside without a key, and puts the key in a header and nowhere else", async () => {
    await expect(brave.search("x", {})).rejects.toMatchObject({ reason: "not_configured" });
    const s = fake(() => json({ web: { results: [{ title: "<strong>React</strong> docs", url: "https://react.dev/", description: "The <strong>library</strong> for web", page_age: "2026-09-01T00:00:00" }, { title: "x" }] } }));
    const out = await brave.search("react docs", { fetchFn: s.fetchFn, env: { braveKey: "BSA-secret-key" }, freshness: "month" });
    expect(s.calls[0]!.headers.get("x-subscription-token")).toBe("BSA-secret-key");
    expect(s.urls()[0]).not.toContain("BSA-secret-key");
    const u = new URL(s.urls()[0]!);
    expect(u.origin + u.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ q: "react docs", freshness: "pm" });
    expect(out).toEqual([{ title: "React docs", url: "https://react.dev/", snippet: "The library for web", source: "brave", published: Date.parse("2026-09-01T00:00:00"), meta: { kind: "doc" } }]);
  });
});

const DDG_HTML = `<!DOCTYPE html><html><body><div id="links" class="results">
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Freference%2Freact%2FuseEffect&amp;rut=abc123">useEffect &#x2013; React</a></h2>
    <div class="result__extras"><a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Freference">react.dev</a></div>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Freference%2Freact%2FuseEffect&amp;rut=abc123">Call <b>useEffect</b> at the top level of your component &amp; its cleanup.</a>
    <div class="clear"></div>
  </div>
</div>
<div class="result results_links results_links_deep result--ad">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=ads.example&amp;ad_provider=x">Buy things</a></h2>
  <a class="result__snippet" href="https://duckduckgo.com/y.js?x=1">An ad</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/l/?kh=-1&uddg=https%3A%2F%2Fstackoverflow.com%2Fquestions%2F1%2Fuseeffect-cleanup%3Fnoredirect%3D1&rut=zz">Cleanup in useEffect - Stack Overflow</a></h2>
  <a class="result__snippet" href="x">How to clean up</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a class="result__a" href="https://direct.example.com/page">Direct link</a></h2>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Freference%2Freact%2FuseEffect">Duplicate</a></h2>
</div>
<div class="result results_links web-result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=javascript%3Aalert(1)">Bad scheme</a></h2></div>
</div></body></html>`;

describe("DuckDuckGo's HTML page", () => {
  it("reads the results: the uddg redirect unwrapped, ads dropped, repeats dropped, entities decoded", () => {
    const out = parseDdg(DDG_HTML);
    expect(out.map((r) => r.url)).toEqual([
      "https://react.dev/reference/react/useEffect",
      "https://stackoverflow.com/questions/1/useeffect-cleanup?noredirect=1",
      "https://direct.example.com/page",
    ]);
    expect(out[0]).toMatchObject({ title: "useEffect – React", snippet: "Call useEffect at the top level of your component & its cleanup.", source: "ddg", meta: { kind: "doc" } });
    expect(out[1]!.meta).toMatchObject({ kind: "question" });
    expect(out[2]!.snippet).toBe("");
  });

  it("unwraps a link whichever way DuckDuckGo wrote it", () => {
    expect(unwrapDdgLink("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx%3Fy%3D1&amp;rut=1")).toBe("https://a.example/x?y=1");
    expect(unwrapDdgLink("https://duckduckgo.com/l/?uddg=http%3A%2F%2Fb.example%2F")).toBe("http://b.example/");
    expect(unwrapDdgLink("https://duckduckgo.com/y.js?ad=1")).toBeNull();
    expect(unwrapDdgLink("https://duckduckgo.com/l/?rut=1")).toBeNull();
    expect(unwrapDdgLink("https://c.example/p")).toBe("https://c.example/p");
    expect(unwrapDdgLink("//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fd.example")).toBeNull();
    expect(unwrapDdgLink("")).toBeNull();
  });

  it("asks html.duckduckgo.com with the query, and a date window for freshness", async () => {
    const s = fake(() => html(DDG_HTML));
    const out = await ddg.search("react useEffect cleanup", { fetchFn: s.fetchFn, freshness: "year", now: () => NOW, sleep: async () => {} });
    expect(s.urls()).toEqual(["https://html.duckduckgo.com/html/?q=react%20useEffect%20cleanup&df=y"]);
    expect(s.calls[0]!.headers.get("user-agent")).toMatch(/TailzuBot/);
    expect(out).toHaveLength(3);
  });

  it("lets one request through in two seconds: the next waits for its turn, and a third waits for its own", async () => {
    const s = fake(() => html(DDG_HTML));
    let t = NOW;
    const waits: number[] = [];
    const o = { fetchFn: s.fetchFn, now: () => t, sleep: async (ms: number) => { waits.push(ms); t += ms; } };
    await ddg.search("a", o);
    await ddg.search("b", o);
    await ddg.search("c", o);
    expect(waits).toEqual([DDG_GAP_MS, DDG_GAP_MS]);
    t += 10_000;
    await ddg.search("d", o); // long after: no wait
    expect(waits).toHaveLength(2);
  });

  it("stands aside rather than queue behind a burst: a request that would wait more than eight seconds is skipped", async () => {
    const s = fake(() => html(DDG_HTML));
    const o = { fetchFn: s.fetchFn, now: () => NOW, sleep: () => new Promise<void>(() => { /* a long wait */ }) };
    // five turns are 0, 2, 4, 6 and 8 seconds away; the sixth would be ten
    for (const q of ["1", "2", "3", "4", "5"]) void ddg.search(q, o);
    await new Promise((r) => setTimeout(r, 5));
    await expect(ddg.search("6", { ...o, sleep: async () => {} })).rejects.toMatchObject({ reason: "busy" });
  });

  it("believes a challenge: a 202, or a page with no results that speaks of an anomaly, blocks it for ten minutes", async () => {
    const s = fake(() => html("<html><body>DuckDuckGo</body></html>", { status: 202 }));
    const o = { fetchFn: s.fetchFn, sleep: async () => {} };
    await expect(ddg.search("x", { ...o, now: () => NOW })).rejects.toMatchObject({ name: "SearchSkip", reason: "blocked" });
    await expect(ddg.search("x", { ...o, now: () => NOW + DDG_BLOCK_MS - 1 })).rejects.toMatchObject({ reason: "blocked" });
    expect(s.calls).toHaveLength(1);
    const ok = fake(() => html(DDG_HTML));
    expect(await ddg.search("x", { fetchFn: ok.fetchFn, now: () => NOW + DDG_BLOCK_MS + 5_000, sleep: async () => {} })).toHaveLength(3);

    resetDdgForTests();
    const anomaly = fake(() => html("<form id='challenge-form'><div class='anomaly-modal'>Unfortunately, bots use DuckDuckGo too.</div></form>"));
    await expect(ddg.search("x", { fetchFn: anomaly.fetchFn, now: () => NOW, sleep: async () => {} })).rejects.toMatchObject({ reason: "blocked" });
    resetDdgForTests();
    const forbidden = fake(() => new Response("", { status: 403 }));
    await expect(ddg.search("x", { fetchFn: forbidden.fetchFn, now: () => NOW, sleep: async () => {} })).rejects.toMatchObject({ reason: "blocked" });
  });

  it("calls a page with no results and no challenge an empty answer", async () => {
    expect(await ddg.search("x", { fetchFn: fake(() => html("<html><div class='no-results'>No results.</div></html>")).fetchFn, now: () => NOW, sleep: async () => {} })).toEqual([]);
  });
});

// ---------------------------------------------------------------------- the config

describe("the config for search", () => {
  const VARS = ["WEB_SEARXNG_URL", "BRAVE_SEARCH_KEY", "STACKEXCHANGE_KEY", "WEB_SEARCH_DAILY", "WEB_RESEARCH_DAILY"];
  afterEach(() => { for (const v of VARS) delete process.env[v]; resetConfigForTests(); });

  it("has no SearXNG, no keys, and daily limits of 200 searches and 30 research runs by default", () => {
    const c = getConfig();
    expect(c.WEB_SEARXNG_URL).toBeUndefined();
    expect(c.BRAVE_SEARCH_KEY).toBeUndefined();
    expect(c.STACKEXCHANGE_KEY).toBeUndefined();
    expect(c.WEB_SEARCH_DAILY).toBe(200);
    expect(c.WEB_RESEARCH_DAILY).toBe(30);
  });

  it("takes WEB_SEARXNG_URL as a plain https address, and ignores anything else with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.WEB_SEARXNG_URL = " https://search.example.com/sx/?q=1#f ";
    resetConfigForTests();
    expect(getConfig().WEB_SEARXNG_URL).toBe("https://search.example.com/sx");
    expect(warn).not.toHaveBeenCalled();
    for (const bad of ["http://search.example.com", "search.example.com", "https://user:pw@search.example.com", "ftp://x"]) {
      process.env.WEB_SEARXNG_URL = bad;
      resetConfigForTests();
      expect(getConfig().WEB_SEARXNG_URL, bad).toBeUndefined();
    }
    expect(warn.mock.calls.some((c) => String(c[0]).includes("WEB_SEARXNG_URL is not an https address"))).toBe(true);
    process.env.WEB_SEARXNG_URL = "";
    warn.mockClear();
    resetConfigForTests();
    expect(getConfig().WEB_SEARXNG_URL).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reads the keys trimmed, a blank one as not set, and the limits as whole numbers (blank is the default, not zero)", () => {
    process.env.BRAVE_SEARCH_KEY = "  BSAabc  ";
    process.env.STACKEXCHANGE_KEY = "   ";
    process.env.WEB_SEARCH_DAILY = "";
    process.env.WEB_RESEARCH_DAILY = "0";
    resetConfigForTests();
    const c = getConfig();
    expect(c.BRAVE_SEARCH_KEY).toBe("BSAabc");
    expect(c.STACKEXCHANGE_KEY).toBeUndefined();
    expect(c.WEB_SEARCH_DAILY).toBe(200);
    expect(c.WEB_RESEARCH_DAILY).toBe(0);
    process.env.WEB_SEARCH_DAILY = "1.5";
    resetConfigForTests();
    expect(() => getConfig()).toThrow(/WEB_SEARCH_DAILY/);
  });

  it("warns, as it does for the other secrets, about a $ that Docker Compose would have eaten", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.BRAVE_SEARCH_KEY = "BSA$HOME-key";
    process.env.STACKEXCHANGE_KEY = "fine-key(1))";
    resetConfigForTests();
    getConfig();
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("BRAVE_SEARCH_KEY") && l.includes("$"))).toBe(true);
    expect(lines.some((l) => l.includes("STACKEXCHANGE_KEY"))).toBe(false);
    // and a short key is not warned about: these are third parties' keys, not secrets of ours
    expect(lines.some((l) => /under 24 characters/.test(l))).toBe(false);
    warn.mockRestore();
  });

  it("belongs to the environment the suite clears, and is documented in .env.example", async () => {
    const { ENV_KEYS } = await import("../src/config.js");
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const example = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.example"), "utf8");
    for (const v of VARS) {
      expect(ENV_KEYS).toContain(v);
      expect(example, v).toMatch(new RegExp(`^# ${v}=`, "m"));
    }
    expect(example).toMatch(/BRAVE_SEARCH_KEY and STACKEXCHANGE_KEY are SECRETS/);
  });
});

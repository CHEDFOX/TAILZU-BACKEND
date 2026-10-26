/**
 * OUR OWN CODING INDEX AND THE SEARCH CACHE (src/web/search/index.ts,
 * migration 0027_web_search.sql).
 *
 * What these hold down:
 *   - chunking: pieces of about 1,500 characters cut along headings, a code
 *     block kept whole when it fits and split at line ends when it does not,
 *     a heading never left alone at the end of a chunk, a chunk closed at the
 *     next heading once it is big enough, every paragraph in some chunk;
 *   - indexPage: only public http(s) pages, never an address whose query looks
 *     like a secret, never a host that is not documentation or a public
 *     reference, the old chunks of an address replaced, the page kept under its
 *     final normalised address;
 *   - searching: stop words out, "all of" before "any of", quoted phrases and
 *     -excluded words honoured, a word in the title or heading counting more,
 *     BM25 in the memory twin and the same ranking over Postgres' candidates in
 *     the Supabase twin (asked with textSearch on tsv, websearch, 'simple');
 *   - both twins held to one script: replace, expire, prune, copies out;
 *   - the migration: the tables, the generated tsvector and its GIN index, row
 *     level security with NO policy, the same text in full_schema.sql after 0026.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { noNetwork } from "./no-network.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

noNetwork();

const {
  HARD_CHARS, INDEX_MAX_AGE_MS, MAX_CHUNKS, MEMORY_PAGES_MAX, MEMORY_SEARCHES_MAX, MemorySearchStore, SOFT_CHARS, SupabaseSearchStore, TARGET_CHARS,
  chunkPage, indexPage, isPublicHttpUrl, prepareQuery, resetSearchStoreForTests, searchCacheKey, searchIndex, searchStore, termFreqs, tokenize, websearchOf,
} = await import("../src/web/search/index.js");
const { cacheKey } = await import("../src/web/cache.js");
type Heading = import("../src/web/extract.js").Heading;
type IndexedPage = import("../src/web/search/index.js").IndexedPage;
type SearchStore = import("../src/web/search/index.js").SearchStore;
type SearchPlan = import("../src/web/search/types.js").SearchPlan;

const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const DAY = 86_400_000;

// ------------------------------------------------------------------ the pages

/** A page of sections as extract.ts would give it: markdown text, and the headings with their offsets. */
function doc(sections: Array<{ level?: number; heading?: string; paras: string[] }>): { text: string; headings: Heading[] } {
  let text = "";
  const headings: Heading[] = [];
  for (const s of sections) {
    if (s.heading) {
      headings.push({ level: s.level ?? 2, text: s.heading, offset: text.length });
      text += `${"#".repeat(s.level ?? 2)} ${s.heading}\n\n`;
    }
    text += `${s.paras.join("\n\n")}\n\n`;
  }
  return { text: text.trimEnd(), headings };
}
const para = (tag: string, chars: number) => `${tag} ${"lorem ipsum dolor sit amet ".repeat(Math.ceil(chars / 27))}`.slice(0, chars).trim();

describe("chunking", () => {
  it("keeps pieces to about 1,500 characters and numbers them in order", () => {
    const d = doc([{ heading: "Big", paras: Array.from({ length: 12 }, (_, i) => para(`P${i}`, 600)) }]);
    const chunks = chunkPage(d.text, d.headings);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    chunks.forEach((c, i) => {
      expect(c.chunkNo).toBe(i);
      expect(c.body.length).toBeLessThanOrEqual(HARD_CHARS);
      expect(c.heading).toBe("Big");
    });
    for (const c of chunks.slice(0, -1)) expect(c.body.length).toBeGreaterThan(TARGET_CHARS * 0.4);
    expect(TARGET_CHARS).toBe(1500);
  });

  it("puts every paragraph in some chunk, in order", () => {
    const d = doc([
      { paras: ["INTRO opening words before any heading, long enough to count as something."] },
      { heading: "One", paras: [para("ONE-A", 900), para("ONE-B", 900)] },
      { heading: "Two", level: 3, paras: [para("TWO-A", 300)] },
      { heading: "Three", paras: [para("THREE-A", 1200)] },
    ]);
    const joined = chunkPage(d.text, d.headings).map((c) => c.body).join("\n\n");
    const at = ["INTRO", "ONE-A", "ONE-B", "TWO-A", "THREE-A"].map((t) => joined.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("keeps a code block whole when it fits, and splits one that is too long at line ends", () => {
    const small = `\`\`\`js\n${Array.from({ length: 30 }, (_, i) => `const line${i} = ${i};`).join("\n")}\n\`\`\``;
    const big = `\`\`\`js\n${Array.from({ length: 400 }, (_, i) => `const line${i} = compute(${i}, "padding padding");`).join("\n")}\n\`\`\``;
    const d = doc([{ heading: "Code", paras: [para("BEFORE", 500), small, para("AFTER", 500), big] }]);
    const chunks = chunkPage(d.text, d.headings);
    expect(chunks.filter((c) => c.body.includes(small))).toHaveLength(1);
    for (const c of chunks) expect(c.body.length).toBeLessThanOrEqual(HARD_CHARS);
    const lines = chunks.flatMap((c) => c.body.split("\n")).filter((l) => /^const line\d+ = compute/.test(l));
    expect(lines).toHaveLength(400);
    expect(lines.every((l) => l.endsWith(";"))).toBe(true); // never cut mid-line
  });

  it("cuts a very long line at a space", () => {
    const d = doc([{ heading: "Long", paras: [`${"word ".repeat(1000)}end`] }]);
    const chunks = chunkPage(d.text, d.headings);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.body.length <= HARD_CHARS)).toBe(true);
    expect(chunks.map((c) => c.body).join(" ").split(/\s+/).filter((w) => w === "word")).toHaveLength(1000);
  });

  it("packs small sections together under the first one's heading, with the others' headings left in the text", () => {
    const d = doc([
      { heading: "Alpha", paras: [para("A", 200)] },
      { heading: "Beta", paras: [para("B", 200)] },
      { heading: "Gamma", paras: [para("G", 200)] },
    ]);
    const chunks = chunkPage(d.text, d.headings);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe("Alpha");
    expect(chunks[0]!.body).toMatch(/## Alpha[\s\S]*## Beta[\s\S]*## Gamma/);
  });

  it("closes a chunk at the next heading once it has reached its soft size, instead of running on", () => {
    const d = doc([
      { heading: "First", paras: [para("F", SOFT_CHARS + 20)] },
      { heading: "Second", paras: [para("S", 300)] },
    ]);
    const chunks = chunkPage(d.text, d.headings);
    expect(chunks.map((c) => c.heading)).toEqual(["First", "Second"]);
    // under the soft size the same two sections share a chunk
    const small = doc([{ heading: "First", paras: [para("F", 400)] }, { heading: "Second", paras: [para("S", 300)] }]);
    expect(chunkPage(small.text, small.headings)).toHaveLength(1);
  });

  it("never ends a chunk on a heading with nothing under it", () => {
    const d = doc([
      { heading: "Parent", level: 2, paras: [] },
      { heading: "Child", level: 3, paras: [para("C", 1400)] },
      { heading: "Next", level: 2, paras: [] },
      { heading: "Last", level: 3, paras: [para("L", 1400)] },
    ]);
    const chunks = chunkPage(d.text, d.headings);
    for (const c of chunks) {
      const lines = c.body.trimEnd().split("\n");
      expect(lines[lines.length - 1]).not.toMatch(/^#{1,6} /);
    }
    expect(chunks[0]!.body).toMatch(/^## Parent\n\n### Child/);
    expect(chunks[0]!.heading).toBe("Child");
  });

  it("chunks a page with no headings by its paragraphs, and returns nothing for a page with nothing in it", () => {
    const text = Array.from({ length: 8 }, (_, i) => para(`P${i}`, 700)).join("\n\n");
    const chunks = chunkPage(text, []);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.heading === "")).toBe(true);
    expect(chunkPage("", [])).toEqual([]);
    expect(chunkPage("tiny", [])).toEqual([]);
    expect(chunkPage("# Only a heading", [{ level: 1, text: "Only a heading", offset: 0 }])).toEqual([]);
  });

  it("ignores a heading whose offset is outside the text, and gives at most 80 chunks", () => {
    expect(chunkPage(para("x", 100), [{ level: 2, text: "ghost", offset: 9999 }]).length).toBe(1);
    const many = doc(Array.from({ length: 200 }, (_, i) => ({ heading: `Section ${i}`, paras: [para(`S${i}`, 1100)] })));
    expect(chunkPage(many.text, many.headings)).toHaveLength(MAX_CHUNKS);
  });

  it("trims the heading's own whitespace", () => {
    const d = doc([{ heading: "Spaced  ", paras: [para("x", 300)] }]);
    expect(chunkPage(d.text, d.headings.map((h) => ({ ...h, text: "Spaced " })))[0]!.heading).toBe("Spaced");
  });
});

// ------------------------------------------------------------------- indexPage

const page = (url: string, over: Record<string, unknown> = {}) => {
  const d = doc([{ heading: "Install", paras: [para("INSTALL", 700)] }, { heading: "Usage", paras: [para("USAGE", 900)] }]);
  return { url, title: "Guide", lang: "en-US", text: d.text, headings: d.headings, fetchedAt: T0, ...over };
};

describe("indexPage", () => {
  it("puts a documentation page in, under its normalised final address, with its language and source", async () => {
    const store = new MemorySearchStore(() => T0);
    const r = await indexPage(page("https://react.dev/learn?b=2&a=1", { finalUrl: "https://react.dev/learn/installation?z=1&a=2#top" }), { store, source: "read" });
    expect(r).toEqual({ indexed: true, chunks: expect.any(Number) });
    const hits = await store.searchIndex("INSTALL lorem", 3);
    expect(hits[0]).toMatchObject({ url: "https://react.dev/learn/installation?a=2&z=1", title: "Guide", source: "read", fetchedAt: T0 });
    expect(store.pageCount).toBe(1);
  });

  it("refuses an address that is not public http(s)", async () => {
    const store = new MemorySearchStore(() => T0);
    for (const url of [
      "http://localhost/docs", "https://localhost:3000/docs", "https://10.0.0.5/docs", "https://192.168.1.2/docs", "https://169.254.169.254/latest", "https://[::1]/docs",
      "https://intranet/docs", "https://wiki.internal/docs", "https://nas.local/docs", "https://u:p@docs.example.com/x", "ftp://docs.example.com/x", "https://docs.example.com:9999/x",
    ]) {
      expect(await indexPage(page(url), { store, anyHost: true }), url).toEqual({ indexed: false, reason: "not_public" });
    }
    expect(await indexPage(page("https://react.dev/learn", { finalUrl: "https://10.0.0.1/x" }), { store })).toEqual({ indexed: false, reason: "not_public" });
    expect(await indexPage(page("not an address"), { store })).toEqual({ indexed: false, reason: "not_public" });
    expect(store.pageCount).toBe(0);
  });

  it("refuses an address whose query looks like a secret, as the page cache does", async () => {
    const store = new MemorySearchStore(() => T0);
    for (const url of ["https://docs.example.com/x?token=abc", "https://docs.example.com/x?a=1&X-Amz-Signature=s", "https://docs.example.com/x?api_key=1", "https://docs.example.com/x?session=1"]) {
      expect(await indexPage(page(url), { store, anyHost: true }), url).toEqual({ indexed: false, reason: "secret_url" });
    }
    expect(await indexPage(page("https://react.dev/a", { finalUrl: "https://react.dev/b?code=zzz" }), { store })).toEqual({ indexed: false, reason: "secret_url" });
    expect(await indexPage(page("https://docs.example.com/x?page=2&q=cats"), { store })).toMatchObject({ indexed: true });
    expect(store.pageCount).toBe(1);
  });

  it("takes only documentation and public reference sites unless told the list is ours", async () => {
    const store = new MemorySearchStore(() => T0);
    for (const url of ["https://react.dev/learn", "https://docs.whatever.io/a", "https://project.readthedocs.io/en/latest/", "https://developer.mozilla.org/en-US/docs/Web", "https://stackoverflow.com/questions/1/x"]) {
      expect(await indexPage(page(url), { store }), url).toMatchObject({ indexed: true });
    }
    // a shared document is public to whoever has the link, so it must not be findable by someone who has not; "docs." in its name changes nothing
    for (const url of ["https://my-notes.example.com/page", "https://pastebin.com/abc", "https://docs.google.com/document/d/1/edit", "https://gist.github.com/me/abc", "https://team.notion.site/Plan-1"]) {
      expect(await indexPage(page(url), { store }), url).toEqual({ indexed: false, reason: "unlisted_host" });
    }
    expect(await indexPage(page("https://my-notes.example.com/page"), { store, anyHost: true })).toMatchObject({ indexed: true });
  });

  it("refuses a page with nothing in it, and only judges when there is no store", async () => {
    const store = new MemorySearchStore(() => T0);
    expect(await indexPage(page("https://react.dev/x", { text: "nope", headings: [] }), { store })).toEqual({ indexed: false, reason: "empty" });
    expect(await indexPage(page("https://react.dev/x"), { store: null })).toMatchObject({ indexed: true });
    expect(store.pageCount).toBe(0);
  });

  it("replaces what was held for an address, every chunk of it", async () => {
    const store = new MemorySearchStore(() => T0);
    const long = doc([{ heading: "Old", paras: Array.from({ length: 8 }, (_, i) => para(`OLDTEXT${i}`, 700)) }]);
    const first = await indexPage(page("https://react.dev/learn", { text: long.text, headings: long.headings }), { store });
    expect(first).toMatchObject({ indexed: true });
    expect(store.chunkCount).toBeGreaterThan(3);
    const short = doc([{ heading: "New", paras: [para("NEWTEXT", 300)] }]);
    await indexPage(page("https://react.dev/learn", { text: short.text, headings: short.headings, fetchedAt: T0 + 1 }), { store });
    expect(store.chunkCount).toBe(1);
    expect(await store.searchIndex("OLDTEXT3", 3)).toEqual([]);
    expect(await store.searchIndex("NEWTEXT", 3)).toHaveLength(1);
  });

  it("knows a public address when it sees one", () => {
    expect(isPublicHttpUrl(new URL("https://docs.example.com/x"))).toBe(true);
    expect(isPublicHttpUrl(new URL("http://docs.example.com:80/x"))).toBe(true);
    expect(isPublicHttpUrl(new URL("https://8.8.8.8/x"))).toBe(true);
    expect(isPublicHttpUrl(new URL("https://100.64.0.1/x"))).toBe(false);
    expect(isPublicHttpUrl(new URL("https://example/x"))).toBe(false);
    expect(isPublicHttpUrl(new URL("https://a.test/x"))).toBe(false);
  });
});

// -------------------------------------------------------------------- the words

describe("the words", () => {
  it("tokenizes to lower-case words and numbers, accents and all", () => {
    expect(tokenize("useEffect() — Café 3.12 fs.readFile")).toEqual(["useeffect", "café", "3", "12", "fs", "readfile"]);
  });

  it("cuts a question to its meaningful words, six at most", () => {
    expect(prepareQuery("How do I use the useEffect cleanup function in React?").terms).toEqual(["useeffect", "cleanup", "function", "react"]);
    expect(prepareQuery("one two three four five six seven eight").terms).toHaveLength(6);
    expect(prepareQuery("zod zod ZOD").terms).toEqual(["zod"]);
  });

  it("reads quoted phrases and -excluded words, and a one-word phrase is a word", () => {
    const p = prepareQuery('"cannot read properties" undefined -jquery "map"');
    expect(p).toEqual({ terms: ["map", "undefined"], phrases: [["cannot", "read", "properties"]], exclude: ["jquery"] });
    expect(prepareQuery("a-b well-known").exclude).toEqual([]);
  });

  it("writes Postgres' websearch text: all of them, or any of them", () => {
    const p = prepareQuery('"cannot read" undefined map -jquery');
    expect(websearchOf(p, "and")).toBe('undefined map "cannot read" -jquery');
    expect(websearchOf(p, "or")).toBe("undefined or map");
  });

  it("counts a title word three times and a heading word twice", () => {
    const { tf, len } = termFreqs("Alpha Beta", "Beta", "gamma beta");
    expect(tf.get("alpha")).toBe(3);
    expect(tf.get("beta")).toBe(3 + 2 + 1);
    expect(tf.get("gamma")).toBe(1);
    expect(len).toBe(3 * 2 + 2 + 2);
  });
});

// --------------------------------------------------------- the memory twin's BM25

describe("the memory twin's search", () => {
  const put = (store: InstanceType<typeof MemorySearchStore>, url: string, title: string, chunks: Array<[string, string]>, fetchedAt = T0) =>
    store.replacePage({ url, title, lang: "en", source: "read", fetchedAt, chunks: chunks.map(([heading, body], i) => ({ chunkNo: i, heading, body })) });

  it("ranks a chunk that is about the word above one that mentions it, and the rare word above the common one", async () => {
    const s = new MemorySearchStore(() => T0);
    await put(s, "https://react.dev/a", "Effects", [["Cleanup", "Return a cleanup function from your effect. The cleanup function runs before the effect runs again. cleanup cleanup."]]);
    await put(s, "https://react.dev/b", "Other", [["Intro", "React effect and a passing mention of cleanup, among many words about components, props, state and rendering things."]]);
    await put(s, "https://react.dev/c", "Rendering", [["Render", "Components render. Props flow down. State changes render again. Effect effect effect."]]);
    const hits = await s.searchIndex("effect cleanup", 5);
    expect(hits.map((h) => h.url)).toEqual(["https://react.dev/a", "https://react.dev/b", "https://react.dev/c"].slice(0, hits.length));
    expect(hits[0]!.url).toBe("https://react.dev/a");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("gives a title or heading word more weight than a body word", async () => {
    const s = new MemorySearchStore(() => T0);
    await put(s, "https://docs.x.dev/body", "Misc", [["Notes", "we talk about fetch here and also about plenty of unrelated words to keep it long enough for comparison"]]);
    await put(s, "https://docs.x.dev/title", "fetch API", [["Notes", "we talk about plenty of unrelated words to keep it long enough for comparison, nothing else here"]]);
    expect((await s.searchIndex("fetch", 2))[0]!.url).toBe("https://docs.x.dev/title");
  });

  it("wants all of the words first, and only then any of them", async () => {
    const s = new MemorySearchStore(() => T0);
    await put(s, "https://docs.x.dev/both", "Both", [["h", "alpha beta together"]]);
    await put(s, "https://docs.x.dev/alpha", "Alpha", [["h", "alpha alpha alpha alpha alpha only"]]);
    await put(s, "https://docs.x.dev/beta", "Beta", [["h", "beta only here"]]);
    // wanting one: only the one that has both
    expect((await s.searchIndex("alpha beta", 1)).map((h) => h.url)).toEqual(["https://docs.x.dev/both"]);
    // wanting more than there are of those: the rest by "any of", after the ones with all
    const more = await s.searchIndex("alpha beta", 5);
    expect(more[0]!.url).toBe("https://docs.x.dev/both");
    expect(more.map((h) => h.url).sort()).toEqual(["https://docs.x.dev/alpha", "https://docs.x.dev/beta", "https://docs.x.dev/both"]);
  });

  it("holds a result to a quoted phrase and to -excluded words", async () => {
    const s = new MemorySearchStore(() => T0);
    await put(s, "https://docs.x.dev/1", "One", [["h", "cannot read properties of undefined in the map call"]]);
    await put(s, "https://docs.x.dev/2", "Two", [["h", "read the properties: you cannot do that to undefined"]]);
    await put(s, "https://docs.x.dev/3", "Three", [["h", "cannot read properties with jquery undefined"]]);
    const phrase = await s.searchIndex('"cannot read properties" undefined', 5);
    expect(phrase.map((h) => h.url).sort()).toEqual(["https://docs.x.dev/1", "https://docs.x.dev/3"]);
    const excl = await s.searchIndex('"cannot read properties" undefined -jquery', 5);
    expect(excl.map((h) => h.url)).toEqual(["https://docs.x.dev/1"]);
  });

  it("answers a question of stop words, an empty store and a word nobody has with nothing", async () => {
    const s = new MemorySearchStore(() => T0);
    expect(await s.searchIndex("react", 3)).toEqual([]);
    await put(s, "https://docs.x.dev/1", "One", [["h", "something about hooks"]]);
    expect(await s.searchIndex("how do i", 3)).toEqual([]);
    expect(await s.searchIndex("zzzz", 3)).toEqual([]);
    expect(await s.searchIndex("hooks", 0)).toEqual([]);
  });

  it("returns the chunk, its heading and where it is from, and the limit asked for", async () => {
    const s = new MemorySearchStore(() => T0);
    await put(s, "https://docs.x.dev/1", "One", [["A", "hooks one"], ["B", "hooks two"], ["C", "hooks three"]]);
    const out = await searchIndex("hooks", 2, s);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ url: "https://docs.x.dev/1", title: "One", chunkNo: expect.any(Number), source: "read", fetchedAt: T0 });
    expect(["A", "B", "C"]).toContain(out[0]!.heading);
  });

  it("lets the least recently written page go for the 2,001st", async () => {
    const s = new MemorySearchStore(() => T0);
    for (let i = 0; i <= MEMORY_PAGES_MAX; i += 1) await put(s, `https://docs.x.dev/p${i}`, `P${i}`, [["h", `unique${i}word`]]);
    expect(s.pageCount).toBe(MEMORY_PAGES_MAX);
    expect(await s.searchIndex("unique0word", 1)).toEqual([]);
    expect(await s.searchIndex(`unique${MEMORY_PAGES_MAX}word`, 1)).toHaveLength(1);
  });
});

// ------------------------------------------------------------ the shared script

const SEARCH_PLAN: SearchPlan = { intent: "how_to", queries: ["a"], sources: ["stackoverflow"], freshness: "any", confidence: 0.8 };
const ranked = [{ title: "T", url: "https://x.example.com/", snippet: "s", source: "ddg" as const, score: 0.8, reasons: ["r"], meta: { kind: "page" } }];

/** The same script for both twins. */
function script(name: string, make: (clock: { now: number }) => SearchStore) {
  describe(name, () => {
    const clock = { now: T0 };
    const fresh = () => { clock.now = T0; return make(clock); };
    const pg = (url: string, chunks: string[], over: Partial<IndexedPage> = {}): IndexedPage => ({
      url, title: "Doc", lang: "en", source: "read", fetchedAt: T0, chunks: chunks.map((body, i) => ({ chunkNo: i, heading: `H${i}`, body })), ...over,
    });

    it("keeps a search and gives it back until it expires", async () => {
      const s = fresh();
      const key = searchCacheKey(SEARCH_PLAN);
      await s.putCache(key, { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 1000 });
      expect(await s.getCache(key, T0 + 999)).toEqual({ plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 1000 });
      expect(await s.getCache(key, T0 + 1000)).toBeNull();
      expect(await s.getCache("0".repeat(64), T0)).toBeNull();
    });

    it("replaces a search put again under the same key", async () => {
      const s = fresh();
      const key = searchCacheKey(SEARCH_PLAN);
      await s.putCache(key, { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 1000 });
      await s.putCache(key, { plan: SEARCH_PLAN, results: [], expiresAt: T0 + 5000 });
      expect((await s.getCache(key, T0))!.results).toEqual([]);
    });

    it("hands out copies, so a caller cannot change what is kept", async () => {
      const s = fresh();
      const key = searchCacheKey(SEARCH_PLAN);
      await s.putCache(key, { plan: SEARCH_PLAN, results: structuredClone(ranked), expiresAt: T0 + 1000 });
      (await s.getCache(key, T0))!.results.length = 0;
      expect((await s.getCache(key, T0))!.results).toHaveLength(1);
    });

    it("finds a chunk, and replaces a page's chunks together", async () => {
      const s = fresh();
      await s.replacePage(pg("https://docs.x.dev/a", ["alpha beta gamma delta", "epsilon zeta eta theta", "iota kappa lambda mu"]));
      expect((await s.searchIndex("zeta", 5)).map((h) => [h.url, h.chunkNo, h.heading])).toEqual([["https://docs.x.dev/a", 1, "H1"]]);
      await s.replacePage(pg("https://docs.x.dev/a", ["omega only"], { fetchedAt: T0 + 5 }));
      expect(await s.searchIndex("zeta", 5)).toEqual([]);
      expect(await s.searchIndex("kappa", 5)).toEqual([]);
      expect((await s.searchIndex("omega", 5))[0]).toMatchObject({ chunkNo: 0, fetchedAt: T0 + 5 });
      await s.replacePage(pg("https://docs.x.dev/a", []));
      expect(await s.searchIndex("omega", 5)).toEqual([]);
    });

    it("finds the same words in the title and the heading as in the body", async () => {
      const s = fresh();
      await s.replacePage(pg("https://docs.x.dev/t", ["nothing relevant here at all"], { title: "Quokka handbook" }));
      expect((await s.searchIndex("quokka", 5))).toHaveLength(1);
      await s.replacePage({ ...pg("https://docs.x.dev/h", ["nothing relevant here at all"]), chunks: [{ chunkNo: 0, heading: "Wombat section", body: "nothing relevant here at all" }] });
      expect((await s.searchIndex("wombat", 5))).toHaveLength(1);
    });

    it("sweeps expired searches and pages not read for 120 days, and nothing else", async () => {
      const s = fresh();
      const key = searchCacheKey(SEARCH_PLAN);
      await s.putCache(key, { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 10 });
      await s.putCache(key.replace(/^./, "f"), { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 99_999_999 });
      await s.replacePage(pg("https://docs.x.dev/old", ["ancient words"], { fetchedAt: T0 - INDEX_MAX_AGE_MS - 1 }));
      await s.replacePage(pg("https://docs.x.dev/new", ["recent words"], { fetchedAt: T0 }));
      expect(await s.prune(T0 + 50)).toEqual({ cache: 1, index: 1 });
      expect(await s.searchIndex("ancient", 5)).toEqual([]);
      expect(await s.searchIndex("recent", 5)).toHaveLength(1);
      expect(await s.getCache(key.replace(/^./, "f"), T0 + 50)).not.toBeNull();
      expect(await s.prune(T0 + 50)).toEqual({ cache: 0, index: 0 });
    });
  });
}

script("the memory twin", (clock) => new MemorySearchStore(() => clock.now));

describe("the memory twin's cache", () => {
  it("holds 300 searches and lets the least recently used go", async () => {
    const s = new MemorySearchStore(() => T0);
    for (let i = 0; i <= MEMORY_SEARCHES_MAX; i += 1) await s.putCache(`k${i}`, { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 1000 });
    expect(await s.getCache("k0", T0)).toBeNull();
    expect(await s.getCache("k1", T0)).not.toBeNull(); // a use: k1 is now the newest
    await s.putCache("extra", { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 1000 });
    expect(await s.getCache("k1", T0)).not.toBeNull();
    expect(await s.getCache("k2", T0)).toBeNull();
  });
});

// ---------------------------------------------------------------- Supabase twin

type Row = Record<string, any>;

/** The words of a websearch_to_tsquery text, enough of it for these tests: spaces are "and", `or` is "or", "quotes" are a phrase, -word is "not". */
function websearchMatcher(text: string): (doc: string) => boolean {
  const toks = [...text.matchAll(/"([^"]+)"|(-?\S+)/g)].map((m) => (m[1] ? { phrase: tokenize(m[1]).join(" ") } : { word: m[2]! }));
  const alts: Array<Array<{ phrase?: string; word?: string }>> = [[]];
  for (const t of toks) {
    if ("word" in t && t.word === "or") alts.push([]);
    else alts[alts.length - 1]!.push(t);
  }
  return (doc) => {
    const words = new Set(tokenize(doc));
    const flat = tokenize(doc).join(" ");
    return alts.some((conj) => conj.length > 0 && conj.every((t) => {
      if (t.phrase) return flat.includes(t.phrase);
      const w = t.word!;
      if (w.startsWith("-")) return !words.has(w.slice(1).toLowerCase());
      return tokenize(w).every((x) => words.has(x));
    }));
  };
}

/** A Supabase client holding web_search_cache and web_index in memory and answering what the store asks of it the way Postgres would. */
function fakeSupabase(o: { error?: string } = {}) {
  const tables: Record<string, Row[]> = { web_search_cache: [], web_index: [] };
  const log: Array<{ table: string; op: string; args: unknown[] }> = [];
  let nextId = 1;
  const keyOf = (table: string, r: Row) => (table === "web_index" ? `${r.url_hash}:${r.chunk_no}` : r.key_hash);
  const sb = {
    tables, log,
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "delete" = "select";
      let limit = Infinity;
      let wantRows = false;
      const run = () => {
        if (!(table in tables)) return { data: null, error: { message: `no table ${table}` } };
        if (o.error) return { data: null, error: { message: o.error } };
        const hit = tables[table]!.filter((r) => filters.every((f) => f(r)));
        if (op === "delete") {
          tables[table] = tables[table]!.filter((r) => !hit.includes(r));
          return { data: wantRows ? hit.map((r) => ({ id: r.id, key_hash: r.key_hash })) : null, error: null };
        }
        return { data: hit.slice(0, limit).map((r) => structuredClone(r)), error: null };
      };
      const b: any = {
        select: () => { wantRows = true; return b; },
        delete: () => { op = "delete"; log.push({ table, op: "delete", args: [] }); return b; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        gt: (c: string, v: string) => { filters.push((r) => Date.parse(r[c]) > Date.parse(v)); return b; },
        lt: (c: string, v: string) => { filters.push((r) => Date.parse(r[c]) < Date.parse(v)); return b; },
        lte: (c: string, v: string) => { filters.push((r) => Date.parse(r[c]) <= Date.parse(v)); return b; },
        gte: (c: string, v: unknown) => { filters.push((r) => (typeof v === "number" ? r[c] >= v : Date.parse(r[c]) >= Date.parse(v as string))); return b; },
        limit: (n: number) => { limit = n; return b; },
        textSearch: (col: string, q: string, opts: unknown) => {
          log.push({ table, op: "textSearch", args: [col, q, opts] });
          const match = websearchMatcher(q);
          filters.push((r) => match(`${r.title} ${r.heading} ${r.body}`));
          return b;
        },
        maybeSingle: async () => { const r = run(); return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }; },
        upsert: async (rows: Row | Row[], opts: { onConflict: string }) => {
          log.push({ table, op: "upsert", args: [rows, opts] });
          if (o.error) return { data: null, error: { message: o.error } };
          for (const row of Array.isArray(rows) ? rows : [rows]) {
            const list = tables[table]!;
            const at = list.findIndex((r) => keyOf(table, r) === keyOf(table, row));
            const stored = { ...structuredClone(row), ...(table === "web_index" ? { id: at >= 0 ? list[at]!.id : nextId++ } : {}) };
            if (at >= 0) list[at] = stored; else list.push(stored);
          }
          return { data: null, error: null };
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko),
      };
      return b;
    },
  };
  return sb;
}

script("the Supabase twin", (clock) => new SupabaseSearchStore(fakeSupabase() as never, () => clock.now));

describe("the Supabase twin", () => {
  const chunks = (...bodies: string[]) => bodies.map((body, i) => ({ chunkNo: i, heading: `H${i}`, body }));

  it("writes the chunks over the old by (url_hash, chunk_no), then deletes any beyond them", async () => {
    const sb = fakeSupabase();
    const s = new SupabaseSearchStore(sb as never, () => T0);
    const url = "https://docs.x.dev/a";
    await s.replacePage({ url, title: "Doc", lang: "en", source: "seed:vue", fetchedAt: T0, chunks: chunks("one", "two", "three") });
    const up = sb.log.find((l) => l.op === "upsert")!;
    expect(up.args[1]).toEqual({ onConflict: "url_hash,chunk_no" });
    expect((up.args[0] as Row[])[1]).toEqual({
      url_hash: cacheKey(url), url, title: "Doc", heading: "H1", chunk_no: 1, body: "two", lang: "en", source: "seed:vue", fetched_at: "2026-10-26T10:00:00.000Z",
    });
    expect(sb.tables.web_index).toHaveLength(3);
    await s.replacePage({ url, title: "Doc", lang: "en", source: "read", fetchedAt: T0, chunks: chunks("only") });
    expect(sb.tables.web_index).toHaveLength(1);
    expect(sb.tables.web_index[0]).toMatchObject({ chunk_no: 0, body: "only" });
    // the order: new rows in before the old ones go, so a search in between never finds the page missing
    const ops = sb.log.map((l) => l.op);
    expect(ops.slice(-2)).toEqual(["upsert", "delete"]);
  });

  it("asks Postgres for the websearch text on tsv with the simple configuration, all of the words first and then any of them", async () => {
    const sb = fakeSupabase();
    const s = new SupabaseSearchStore(sb as never, () => T0);
    await s.replacePage({ url: "https://docs.x.dev/a", title: "Doc", lang: "en", source: "read", fetchedAt: T0, chunks: chunks("alpha beta") });
    await s.replacePage({ url: "https://docs.x.dev/b", title: "Doc", lang: "en", source: "read", fetchedAt: T0, chunks: chunks("alpha only") });
    const hits = await s.searchIndex("how do I use alpha beta", 5);
    const asks = sb.log.filter((l) => l.op === "textSearch").map((l) => l.args);
    expect(asks).toEqual([["tsv", "alpha beta", { type: "websearch", config: "simple" }], ["tsv", "alpha or beta", { type: "websearch", config: "simple" }]]);
    expect(hits.map((h) => h.url)).toEqual(["https://docs.x.dev/a", "https://docs.x.dev/b"]);
    // enough "all of" results: no second ask
    sb.log.length = 0;
    await s.searchIndex("alpha beta", 1);
    expect(sb.log.filter((l) => l.op === "textSearch")).toHaveLength(1);
  });

  it("ranks the candidates itself: a chunk about the word above one that mentions it, phrases and exclusions held", async () => {
    const sb = fakeSupabase();
    const s = new SupabaseSearchStore(sb as never, () => T0);
    const put = (u: string, body: string, title = "Doc") => s.replacePage({ url: `https://docs.x.dev/${u}`, title, lang: "en", source: "read", fetchedAt: T0, chunks: chunks(body) });
    await put("mention", "a long passing mention of cleanup among many other words about state, props, rendering and components here");
    await put("about", "cleanup cleanup: how cleanup works, what cleanup does and when cleanup runs");
    await put("jq", "cleanup with jquery plugins");
    expect((await s.searchIndex("cleanup", 3)).map((h) => h.url)[0]).toBe("https://docs.x.dev/about");
    expect((await s.searchIndex("cleanup -jquery", 5)).map((h) => h.url)).not.toContain("https://docs.x.dev/jq");
    expect((await s.searchIndex('"cleanup works"', 5)).map((h) => h.url)).toEqual(["https://docs.x.dev/about"]);
    expect(await s.searchIndex("the", 5)).toEqual([]); // all stop words: nothing is asked
  });

  it("asks for at most sixty candidates", async () => {
    const sb = fakeSupabase();
    const s = new SupabaseSearchStore(sb as never, () => T0);
    for (let i = 0; i < 70; i += 1) await s.replacePage({ url: `https://docs.x.dev/p${i}`, title: "Doc", lang: "en", source: "read", fetchedAt: T0, chunks: chunks(`needle ${i}`) });
    expect((await s.searchIndex("needle", 100)).length).toBe(60);
  });

  it("reads and writes the search cache as a plan, results and an expiry", async () => {
    const sb = fakeSupabase();
    const s = new SupabaseSearchStore(sb as never, () => T0);
    const key = searchCacheKey(SEARCH_PLAN);
    await s.putCache(key, { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 6 * 3_600_000 });
    expect(sb.tables.web_search_cache[0]).toEqual({ key_hash: key, plan: SEARCH_PLAN, results: ranked, expires_at: "2026-10-26T16:00:00.000Z" });
    expect(sb.log.find((l) => l.op === "upsert")!.args[1]).toEqual({ onConflict: "key_hash" });
    // a row that is not what put wrote is a miss, not an error
    sb.tables.web_search_cache.push({ key_hash: "bad", plan: null, results: "nope", expires_at: "2026-10-26T16:00:00.000Z" });
    expect(await s.getCache("bad", T0)).toBeNull();
  });

  it("throws when the tables cannot be read or written (the engine treats that as no cache and no index)", async () => {
    const s = new SupabaseSearchStore(fakeSupabase({ error: "relation does not exist" }) as never, () => T0);
    await expect(s.getCache("k")).rejects.toThrow(/web search cache: relation does not exist/);
    await expect(s.putCache("k", { plan: SEARCH_PLAN, results: [], expiresAt: T0 })).rejects.toThrow(/web search cache/);
    await expect(s.replacePage({ url: "https://docs.x.dev/a", title: "", lang: "", source: "read", fetchedAt: T0, chunks: chunks("x") })).rejects.toThrow(/web index/);
    await expect(s.searchIndex("needle", 3)).rejects.toThrow(/web index/);
    await expect(s.prune()).rejects.toThrow(/web search cache/);
  });

  it("sweeps expired searches now and then as it writes", async () => {
    const sb = fakeSupabase();
    const s = new SupabaseSearchStore(sb as never, () => T0);
    sb.tables.web_search_cache.push({ key_hash: "stale", plan: SEARCH_PLAN, results: [], expires_at: "2026-10-26T09:00:00.000Z" });
    for (let i = 0; i < 99; i += 1) await s.putCache(`k${i}`, { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 1000 });
    expect(sb.tables.web_search_cache.some((r) => r.key_hash === "stale")).toBe(true);
    await s.putCache("k99", { plan: SEARCH_PLAN, results: ranked, expiresAt: T0 + 1000 });
    await new Promise((r) => setTimeout(r, 10));
    expect(sb.tables.web_search_cache.some((r) => r.key_hash === "stale")).toBe(false);
  });
});

describe("the shared store", () => {
  it("is memory without Supabase, one instance until it is reset", () => {
    resetSearchStoreForTests();
    const a = searchStore();
    expect(a).toBeInstanceOf(MemorySearchStore);
    expect(searchStore()).toBe(a);
    resetSearchStoreForTests();
    expect(searchStore()).not.toBe(a);
  });
});

// -------------------------------------------------------------------- migration

describe("migration 0027_web_search.sql", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const supabaseDir = join(here, "..", "supabase");
  const migration = readFileSync(join(supabaseDir, "migrations", "0027_web_search.sql"), "utf8");
  const full = readFileSync(join(supabaseDir, "full_schema.sql"), "utf8");
  const code = migration.replace(/--.*$/gm, "");

  it("follows 0026 in the migrations folder", () => {
    const names = readdirSync(join(supabaseDir, "migrations")).sort();
    // Not "the last one": later migrations follow it.
    const at = names.indexOf("0027_web_search.sql");
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe("0026_web_cache.sql");
  });

  it("makes web_search_cache with the columns the store reads and writes, keyed by the hash", () => {
    expect(code).toMatch(/create table if not exists public\.web_search_cache/);
    expect(code).toMatch(/key_hash\s+text primary key check \(char_length\(key_hash\) = 64\)/);
    expect(code).toMatch(/plan\s+jsonb not null/);
    expect(code).toMatch(/results\s+jsonb not null/);
    expect(code).toMatch(/expires_at timestamptz not null/);
    expect(code).toMatch(/create index if not exists web_search_cache_expires_at_idx/);
  });

  it("makes web_index with the columns the store writes, unique by (url_hash, chunk_no)", () => {
    expect(code).toMatch(/create table if not exists public\.web_index/);
    for (const col of ["id", "url_hash", "url", "title", "heading", "chunk_no", "body", "lang", "source", "fetched_at", "tsv"]) {
      expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(code).toMatch(/id\s+bigint generated always as identity primary key/);
    expect(code).toMatch(/unique \(url_hash, chunk_no\)/);
    expect(code).toMatch(/fetched_at timestamptz not null/);
  });

  it("has a generated stored tsvector over title, heading and body, in the simple configuration, with a GIN index", () => {
    expect(code).toMatch(/tsv\s+tsvector generated always as \(\s*to_tsvector\('simple', coalesce\(title, ''\) \|\| ' ' \|\| coalesce\(heading, ''\) \|\| ' ' \|\| body\)\s*\) stored/);
    expect(code).toMatch(/create index if not exists web_index_tsv_idx on public\.web_index using gin \(tsv\)/);
  });

  it("is service-only: row-level security on both tables and no policy at all", () => {
    expect(code).toMatch(/alter table public\.web_search_cache enable row level security/);
    expect(code).toMatch(/alter table public\.web_index enable row level security/);
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/grant /i);
  });

  it("can be run again: every create is guarded", () => {
    const statements = code.split(";").map((st) => st.trim()).filter(Boolean);
    for (const st of statements) if (/^create (table|index)/i.test(st)) expect(st).toMatch(/if not exists/i);
  });

  it("is in full_schema.sql, under its own heading, after 0026, and the same text", () => {
    expect(full).toContain("-- 0027_web_search.sql");
    expect(full.indexOf("-- 0027_web_search.sql")).toBeGreaterThan(full.indexOf("-- 0026_web_cache.sql"));
    expect(full).toContain(migration.trim());
    expect(full.match(/create table if not exists public\.web_index/g)).toHaveLength(1);
    expect(full.match(/create table if not exists public\.web_search_cache/g)).toHaveLength(1);
    expect(full.endsWith("\n")).toBe(true);
  });
});

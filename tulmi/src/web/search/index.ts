/**
 * OUR OWN CODING INDEX, AND THE CACHE OF SEARCHES, KEPT TOGETHER.
 *
 * Two things live behind one interface (SearchStore), as the page cache does
 * (web/cache.ts): in memory for tests and local runs, in Supabase
 * (supabase/migrations/0027_web_search.sql) in production, written with the
 * service key. Both tables have row-level security on and no policy at all.
 *
 *   web_search_cache  a finished search: the normalised plan's hash, the plan, the
 *                     ranked results, when it stops being served. Shared by
 *                     everyone, so nothing in it belongs to a person
 *   web_index         pages in pieces, searchable: one row per chunk of a page
 *
 * THE INDEX is what makes the same documentation question cost nothing the
 * second time, and lets a search find a section of a page rather than only the
 * page. indexPage(page) cuts a read page into chunks of about 1,500 characters
 * along its headings and replaces whatever the index held for that address. It
 * refuses, in this order:
 *   - an address that is not public http(s) (a private or reserved address, a
 *     name with no dot or one that ends .local, .internal, .localhost), or one
 *     with a name:password@;
 *   - an address whose query looks like a secret (web/cache.ts isCacheable: the
 *     same check that keeps such a page out of the page cache);
 *   - a host that is not documentation or a public reference site
 *     (catalog.ts isIndexableHost). The index is searched by everyone, so a page a
 *     person read through an unlisted link (a shared document, a paste) must not
 *     be findable by the next person; only pages that are public by design go in;
 *   - a page with nothing worth keeping.
 *
 * SEARCHING is by words, not meaning. The question is cut to its meaningful words
 * (no stop words, six at most), and asked first as "all of these", and only if
 * that finds fewer than were wanted, as "any of these". Supabase asks Postgres'
 * websearch full text search (to_tsvector 'simple', a GIN index) for a candidate
 * set and ranks it here; the memory twin does the same over its own chunks, with BM25
 * (k1 1.2, b 0.75) computed over the whole of them. Words in a page's title count
 * three times, words in a chunk's heading twice.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import { isBlockedAddress } from "../../connectors/egress.js";
import { cacheKey, isCacheable, normalizeUrl } from "../cache.js";
import type { Heading } from "../extract.js";
import { isIndexableHost } from "./catalog.js";
import type { Ranked, SearchPlan } from "./types.js";

/** Characters a chunk aims for; no chunk is over TARGET_CHARS + a paragraph, and none over HARD_CHARS. */
export const TARGET_CHARS = 1_500;
export const HARD_CHARS = 2_000;
/** A chunk this long is closed at the next heading instead of running on into it. */
export const SOFT_CHARS = 900;
/** A last chunk shorter than this joins the one before it. */
const MIN_TAIL_CHARS = 200;
/** Most chunks one page gives. */
export const MAX_CHUNKS = 80;
/** Pages the memory twin holds before it lets the oldest go. */
export const MEMORY_PAGES_MAX = 2_000;
/** Searches the memory twin holds. */
export const MEMORY_SEARCHES_MAX = 300;
/** Chunks fetched from Postgres to be ranked here. */
const CANDIDATES = 60;
/** An indexed page older than this is dropped by prune(). */
export const INDEX_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;
/** Most terms a query is cut to. */
const MAX_TERMS = 6;

// ------------------------------------------------------------------- the shapes

export interface IndexChunk {
  chunkNo: number;
  /** The heading the chunk is under ("" before the first). */
  heading: string;
  body: string;
}

export interface IndexedPage {
  /** The normalised address. */
  url: string;
  title: string;
  lang: string;
  /** What put it here ("read", "seed:vue"). */
  source: string;
  fetchedAt: number;
  chunks: IndexChunk[];
}

export interface IndexHit {
  url: string;
  title: string;
  heading: string;
  chunkNo: number;
  body: string;
  source: string;
  fetchedAt: number;
  score: number;
}

export interface CachedSearch {
  plan: SearchPlan;
  results: Ranked[];
  expiresAt: number;
}

export interface SearchStore {
  getCache(key: string, now?: number): Promise<CachedSearch | null>;
  putCache(key: string, entry: CachedSearch): Promise<void>;
  /** Replaces every chunk held for the page's address. An empty `chunks` removes the page. */
  replacePage(page: IndexedPage): Promise<void>;
  searchIndex(q: string, limit: number): Promise<IndexHit[]>;
  /** Forgets expired searches and pages not read in INDEX_MAX_AGE_MS. */
  prune(now?: number): Promise<{ cache: number; index: number }>;
}

// ------------------------------------------------------------------ the cache key

/** The key a search is cached under: its intent, its queries (lower case, sorted), sources, site and freshness. */
export function searchCacheKey(plan: SearchPlan, queries: string[] = plan.queries): string {
  const norm = (xs: readonly string[]) => [...xs].map((x) => x.toLowerCase().replace(/\s+/g, " ").trim()).sort();
  return createHash("sha256").update(JSON.stringify([plan.intent, norm(queries), norm(plan.sources), norm(plan.site ?? []), plan.freshness])).digest("hex");
}

/** How long a finished search is served: a day for a package, else six hours. */
export function searchTtlMs(plan: SearchPlan): number {
  return (plan.intent === "package_lookup" ? 24 : 6) * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------- the words

const STOP = new Set((
  "a an the and or but if of to in on at by for from with without about as is are was were be been being do does did can could should would will " +
  "i me my we you your it its this that these those there here how what why when where which who vs versus than then so not no please help need want " +
  "get got use using used am has have had into out up over just any some very also"
).split(" "));

/** Words and numbers, lower case. */
export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export interface PreparedQuery {
  /** The meaningful words, six at most. */
  terms: string[];
  /** Quoted phrases, each as its words. */
  phrases: string[][];
  /** Words that must not be there ("-word"). */
  exclude: string[];
}

/** A question as the words to search for. */
export function prepareQuery(q: string): PreparedQuery {
  const phrases: string[][] = [];
  const terms: string[] = [];
  let rest = q.replace(/"([^"]{2,200})"/g, (_m, p: string) => {
    const words = tokenize(p);
    if (words.length >= 2) phrases.push(words);
    else for (const w of words) if (!terms.includes(w)) terms.push(w);
    return " ";
  });
  const exclude: string[] = [];
  rest = rest.replace(/(?:^|\s)-([\p{L}\p{N}]+)/gu, (_m, w: string) => { exclude.push(w.toLowerCase()); return " "; });
  for (const w of tokenize(rest)) {
    if (STOP.has(w) || terms.includes(w)) continue;
    terms.push(w);
    if (terms.length >= MAX_TERMS) break;
  }
  return { terms, phrases, exclude };
}

/** The websearch_to_tsquery text for a prepared query: "all of" (and) or "any of" (or). */
export function websearchOf(p: PreparedQuery, mode: "and" | "or"): string {
  if (mode === "or") return p.terms.join(" or ");
  return [...p.terms, ...p.phrases.map((ph) => `"${ph.join(" ")}"`), ...p.exclude.map((w) => `-${w}`)].join(" ");
}

// ---------------------------------------------------------------------- ranking

const K1 = 1.2;
const B = 0.75;

/** Term counts of a chunk, a word in the title three times and one in the heading twice as heavy. */
export function termFreqs(title: string, heading: string, body: string): { tf: Map<string, number>; len: number } {
  const tf = new Map<string, number>();
  let len = 0;
  const add = (s: string, w: number) => {
    for (const t of tokenize(s)) { tf.set(t, (tf.get(t) ?? 0) + w); len += w; }
  };
  add(title, 3);
  add(heading, 2);
  add(body, 1);
  return { tf, len };
}

interface Doc { tf: Map<string, number>; len: number; hay?: string; text: () => string }

const bm25 = (terms: string[], d: Doc, stats: { n: number; avgLen: number; df: (t: string) => number }): number => {
  let s = 0;
  for (const t of terms) {
    const f = d.tf.get(t) ?? 0;
    if (!f) continue;
    const df = stats.df(t);
    const idf = Math.log(1 + (stats.n - df + 0.5) / (df + 0.5));
    s += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / Math.max(stats.avgLen, 1))));
  }
  return s;
};

/** Phrases and exclusions, which a ranked list is also held to. */
function allows(p: PreparedQuery, d: Doc): boolean {
  if (!p.phrases.length && !p.exclude.length) return true;
  for (const w of p.exclude) if (d.tf.has(w)) return false;
  if (p.phrases.length) {
    const hay = (d.hay ??= tokenize(d.text()).join(" "));
    for (const ph of p.phrases) if (!hay.includes(ph.join(" "))) return false;
  }
  return true;
}

// ------------------------------------------------------------------ chunking

/** Blocks of text split on blank lines, a fenced code block kept whole. */
function blocksOf(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  const flush = () => { const b = cur.join("\n").trim(); if (b) out.push(b); cur = []; };
  for (const line of text.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
    }
    if (fence === null && !line.trim()) { flush(); continue; }
    cur.push(line);
  }
  flush();
  return out;
}

/** A block longer than the limit, split at line ends (a very long line at a space). */
function splitLong(block: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trimEnd()); cur = ""; };
  for (let line of block.split("\n")) {
    while (line.length > max) {
      const sp = line.lastIndexOf(" ", max);
      const at = sp > max * 0.5 ? sp : max;
      if (cur) push();
      out.push(line.slice(0, at).trimEnd());
      line = line.slice(at).trimStart();
    }
    if (cur && cur.length + line.length + 1 > max) push();
    cur = cur ? `${cur}\n${line}` : line;
  }
  push();
  return out;
}

/**
 * A page's text cut into chunks along its headings, each about TARGET_CHARS.
 *
 * The page is first cut into pieces: a heading with the first block under it
 * (a heading with nothing under it travels on with the one after, so none ends
 * a chunk alone), then each block after that (a paragraph, a list, a fenced code
 * block kept whole; one longer than HARD_CHARS is split at line ends). The
 * pieces are then packed in order into chunks of at most TARGET_CHARS, and a
 * chunk that has reached SOFT_CHARS is closed at the next heading rather than
 * run on into it. A chunk's `heading` is the one it starts under, and the
 * headings of the sections packed into it stay in its text as markdown lines.
 */
export function chunkPage(text: string, headings: readonly Heading[]): IndexChunk[] {
  const hs = headings.filter((h) => h.offset >= 0 && h.offset < text.length).sort((a, b) => a.offset - b.offset);
  interface Piece { heading: string; text: string; starts: boolean }
  const pieces: Piece[] = [];
  let carry = "";
  const addSection = (heading: string, headLine: string, body: string) => {
    const blocks = blocksOf(body).flatMap((b) => (b.length > HARD_CHARS ? splitLong(b, TARGET_CHARS) : [b]));
    if (!blocks.length) { carry = [carry, headLine].filter(Boolean).join("\n\n"); return; }
    blocks.forEach((b, i) => {
      const lead = i === 0 ? [carry, headLine].filter(Boolean).join("\n\n") : "";
      pieces.push({ heading, text: lead ? `${lead}\n\n${b}` : b, starts: i === 0 && headLine !== "" });
    });
    carry = "";
  };

  const firstAt = hs[0]?.offset ?? text.length;
  addSection("", "", text.slice(0, firstAt));
  hs.forEach((h, i) => {
    const raw = text.slice(h.offset, hs[i + 1]?.offset ?? text.length);
    const nl = raw.indexOf("\n");
    const title = h.text.trim();
    addSection(title, `${"#".repeat(Math.max(1, Math.min(6, h.level)))} ${title}`, nl < 0 ? "" : raw.slice(nl + 1));
  });
  if (carry) pieces.push({ heading: hs[hs.length - 1]?.text.trim() ?? "", text: carry, starts: false });

  const chunks: IndexChunk[] = [];
  let cur: { heading: string; body: string } | null = null;
  const flush = () => {
    // (The table allows 4,000 characters; a chunk is far under that unless a long run of headings with nothing under them was carried into it.)
    if (cur && cur.body.trim().length >= 20) chunks.push({ chunkNo: chunks.length, heading: cur.heading, body: cur.body.trim().slice(0, 4_000) });
    cur = null;
  };
  for (const p of pieces) {
    if (cur && (cur.body.length + p.text.length + 2 > TARGET_CHARS || (p.starts && cur.body.length >= SOFT_CHARS))) flush();
    cur = cur ? { heading: cur.heading, body: `${cur.body}\n\n${p.text}` } : { heading: p.heading, body: p.text };
  }
  flush();
  // A scrap at the end joins the chunk before it, if that has room.
  const last = chunks[chunks.length - 1];
  const before = chunks[chunks.length - 2];
  if (last && before && last.body.length < MIN_TAIL_CHARS && before.body.length + last.body.length + 2 <= HARD_CHARS) {
    before.body = `${before.body}\n\n${last.body}`;
    chunks.pop();
  }
  return chunks.slice(0, MAX_CHUNKS);
}

// -------------------------------------------------------------------- the memory

interface StoredChunk extends IndexChunk, Doc { pageKey: string; url: string; title: string; source: string; fetchedAt: number }

const clone = <T>(x: T): T => structuredClone(x);

export class MemorySearchStore implements SearchStore {
  private searches = new Map<string, CachedSearch>();
  private pages = new Map<string, StoredChunk[]>();

  constructor(private readonly clock: () => number = Date.now) {}

  async getCache(key: string, now: number = this.clock()) {
    const e = this.searches.get(key);
    if (!e) return null;
    this.searches.delete(key);
    if (e.expiresAt <= now) return null;
    this.searches.set(key, e);
    return clone(e);
  }
  async putCache(key: string, entry: CachedSearch) {
    this.searches.delete(key);
    this.searches.set(key, clone(entry));
    while (this.searches.size > MEMORY_SEARCHES_MAX) this.searches.delete(this.searches.keys().next().value!);
  }
  async replacePage(page: IndexedPage) {
    const key = cacheKey(page.url);
    this.pages.delete(key);
    if (!page.chunks.length) return;
    this.pages.set(key, page.chunks.map((c): StoredChunk => ({
      ...c, pageKey: key, url: page.url, title: page.title, source: page.source, fetchedAt: page.fetchedAt,
      ...termFreqs(page.title, c.heading, c.body), text: () => `${page.title} ${c.heading} ${c.body}`,
    })));
    while (this.pages.size > MEMORY_PAGES_MAX) this.pages.delete(this.pages.keys().next().value!);
  }
  async searchIndex(q: string, limit: number): Promise<IndexHit[]> {
    const p = prepareQuery(q);
    if (!p.terms.length && !p.phrases.length) return [];
    const all = [...this.pages.values()].flat();
    if (!all.length) return [];
    const terms = p.terms.length ? p.terms : p.phrases.flat();
    const dfs = new Map<string, number>();
    for (const t of terms) dfs.set(t, all.reduce((n, c) => n + (c.tf.has(t) ? 1 : 0), 0));
    const stats = { n: all.length, avgLen: all.reduce((n, c) => n + c.len, 0) / all.length, df: (t: string) => dfs.get(t) ?? 0 };
    const run = (mode: "and" | "or") => all
      .filter((c) => (mode === "and" ? terms.every((t) => c.tf.has(t)) : terms.some((t) => c.tf.has(t))) && allows(p, c))
      .map((c) => ({ c, score: bm25(terms, c, stats) }));
    const andFound = run("and");
    let found = andFound;
    if (found.length < limit && terms.length >= 2) {
      const seen = new Set(found.map((f) => f.c));
      found = [...found, ...run("or").filter((f) => !seen.has(f.c))];
    }
    // "All of" results first, whatever the "any of" ones scored, then by score.
    return found
      .map((f, i) => ({ ...f, i, rank: i < andFound.length ? 1 : 0 }))
      .sort((a, b) => b.rank - a.rank || b.score - a.score || a.i - b.i)
      .slice(0, limit)
      .map(({ c, score }) => ({ url: c.url, title: c.title, heading: c.heading, chunkNo: c.chunkNo, body: c.body, source: c.source, fetchedAt: c.fetchedAt, score: Math.round(score * 1000) / 1000 }));
  }
  async prune(now: number = this.clock()) {
    let cache = 0;
    for (const [k, e] of [...this.searches]) if (e.expiresAt <= now) { this.searches.delete(k); cache += 1; }
    let index = 0;
    for (const [k, cs] of [...this.pages]) if (cs[0] && cs[0].fetchedAt < now - INDEX_MAX_AGE_MS) { this.pages.delete(k); index += cs.length; }
    return { cache, index };
  }
  get chunkCount(): number { return [...this.pages.values()].reduce((n, cs) => n + cs.length, 0); }
  get pageCount(): number { return this.pages.size; }
}

// ----------------------------------------------------------------- supabase

interface CacheRow { key_hash: string; plan: SearchPlan; results: Ranked[]; expires_at: string }
interface ChunkRow { url_hash: string; url: string; title: string; heading: string; chunk_no: number; body: string; source: string; fetched_at: string }

const iso = (n: number) => new Date(n).toISOString();
const PRUNE_EVERY = 100;

export class SupabaseSearchStore implements SearchStore {
  private writes = 0;

  constructor(private readonly sb: SupabaseClient, private readonly clock: () => number = Date.now) {}

  async getCache(key: string, now: number = this.clock()) {
    const res = await this.sb.from("web_search_cache").select("*").eq("key_hash", key).gt("expires_at", iso(now)).maybeSingle<CacheRow>();
    if (res.error) throw new Error(`web search cache: ${res.error.message}`);
    const r = res.data;
    const expiresAt = r ? Date.parse(r.expires_at) : NaN;
    if (!r || !Array.isArray(r.results) || !r.plan || !Number.isFinite(expiresAt)) return null;
    return { plan: r.plan, results: r.results, expiresAt };
  }
  async putCache(key: string, entry: CachedSearch) {
    const res = await this.sb.from("web_search_cache").upsert({
      key_hash: key, plan: entry.plan, results: entry.results, expires_at: iso(entry.expiresAt),
    }, { onConflict: "key_hash" });
    if (res.error) throw new Error(`web search cache: ${res.error.message}`);
    this.writes += 1;
    if (this.writes % PRUNE_EVERY === 0) this.prune().catch(() => { /* housekeeping: the next one will do it */ });
  }
  async replacePage(page: IndexedPage) {
    const hash = cacheKey(page.url);
    if (page.chunks.length) {
      const rows = page.chunks.map((c) => ({
        url_hash: hash, url: page.url, title: page.title, heading: c.heading, chunk_no: c.chunkNo, body: c.body, lang: page.lang,
        source: page.source, fetched_at: iso(page.fetchedAt),
      }));
      // Write the new chunks over the old first and drop the ones beyond them after, so the page is never missing from a search that runs in between.
      const up = await this.sb.from("web_index").upsert(rows, { onConflict: "url_hash,chunk_no" });
      if (up.error) throw new Error(`web index: ${up.error.message}`);
    }
    const del = await this.sb.from("web_index").delete().eq("url_hash", hash).gte("chunk_no", page.chunks.length);
    if (del.error) throw new Error(`web index: ${del.error.message}`);
  }
  async searchIndex(q: string, limit: number): Promise<IndexHit[]> {
    const p = prepareQuery(q);
    if (!p.terms.length && !p.phrases.length) return [];
    const terms = p.terms.length ? p.terms : p.phrases.flat();
    const fetchRows = async (text: string): Promise<ChunkRow[]> => {
      const res = await this.sb.from("web_index")
        .select("url_hash,url,title,heading,chunk_no,body,source,fetched_at")
        .textSearch("tsv", text, { type: "websearch", config: "simple" })
        .limit(CANDIDATES);
      if (res.error) throw new Error(`web index: ${res.error.message}`);
      return (res.data ?? []) as unknown as ChunkRow[];
    };
    const andRows = await fetchRows(websearchOf(p, "and"));
    let rows = andRows;
    if (andRows.length < limit && terms.length >= 2) {
      const seen = new Set(andRows.map((r) => `${r.url_hash}:${r.chunk_no}`));
      rows = [...andRows, ...(await fetchRows(websearchOf(p, "or"))).filter((r) => !seen.has(`${r.url_hash}:${r.chunk_no}`))];
    }
    // Postgres cannot order a PostgREST full text search by rank, so the candidates are ranked here, over themselves.
    const docs = rows.map((r) => ({ r, d: { ...termFreqs(r.title, r.heading, r.body), text: () => `${r.title} ${r.heading} ${r.body}` } as Doc }));
    const dfs = new Map<string, number>();
    for (const t of terms) dfs.set(t, docs.reduce((n, x) => n + (x.d.tf.has(t) ? 1 : 0), 0));
    const stats = { n: Math.max(docs.length, 1), avgLen: docs.reduce((n, x) => n + x.d.len, 0) / Math.max(docs.length, 1), df: (t: string) => dfs.get(t) ?? 0 };
    const andKeys = new Set(andRows.map((r) => `${r.url_hash}:${r.chunk_no}`));
    return docs
      .filter((x) => allows(p, x.d))
      .map((x, i) => ({ ...x, i, score: bm25(terms, x.d, stats), rank: andKeys.has(`${x.r.url_hash}:${x.r.chunk_no}`) ? 1 : 0 }))
      .sort((a, b) => b.rank - a.rank || b.score - a.score || a.i - b.i)
      .slice(0, limit)
      .map(({ r, score }) => ({ url: r.url, title: r.title, heading: r.heading, chunkNo: r.chunk_no, body: r.body, source: r.source, fetchedAt: Date.parse(r.fetched_at) || 0, score: Math.round(score * 1000) / 1000 }));
  }
  async prune(now: number = this.clock()) {
    const c = await this.sb.from("web_search_cache").delete().lte("expires_at", iso(now)).select("key_hash");
    if (c.error) throw new Error(`web search cache: ${c.error.message}`);
    const i = await this.sb.from("web_index").delete().lt("fetched_at", iso(now - INDEX_MAX_AGE_MS)).select("id");
    if (i.error) throw new Error(`web index: ${i.error.message}`);
    return { cache: (c.data ?? []).length, index: (i.data ?? []).length };
  }
}

// -------------------------------------------------------------------- the one

let current: SearchStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function searchStore(): SearchStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseSearchStore(sb) : new MemorySearchStore();
  }
  return current;
}

export function resetSearchStoreForTests(): void { current = null; }

// ------------------------------------------------------------------- indexPage

/** What indexPage needs of a page: a WebPage is one. */
export interface IndexablePage {
  url: string;
  finalUrl?: string;
  title: string;
  lang?: string;
  text: string;
  headings: readonly Heading[];
  fetchedAt: number;
}

export type IndexRefusal = "not_public" | "secret_url" | "unlisted_host" | "empty";
export type IndexResult = { indexed: true; chunks: number } | { indexed: false; reason: IndexRefusal };

const PRIVATE_NAME = /(?:^|\.)(?:localhost|local|internal|lan|home|corp|intranet|private|test|invalid|example)$|^[^.]+$/i;

/** Whether this is a public web address: http(s), no credentials, a real public name or address. */
export function isPublicHttpUrl(u: URL): boolean {
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return false;
  if (u.port && !["80", "443", "8443"].includes(u.port)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isBlockedAddress(host);
  return !PRIVATE_NAME.test(host);
}

export interface IndexOptions {
  /** Where to put it. The shared store unless given; null for nowhere (the page is only judged). */
  store?: SearchStore | null;
  /** What to call where it came from ("read", "seed:vue"). */
  source?: string;
  /** Index a page from any public host, not only documentation and reference sites. Only for a list of pages we chose ourselves (the seed script). */
  anyHost?: boolean;
}

/**
 * Puts a read page in the index, or says why not. A page already there under
 * the same address is replaced whole. Never logs anything about the page.
 */
export async function indexPage(page: IndexablePage, opts: IndexOptions = {}): Promise<IndexResult> {
  let asked: URL;
  let final: URL;
  try {
    asked = new URL(page.url);
    final = new URL(page.finalUrl || page.url);
  } catch {
    return { indexed: false, reason: "not_public" };
  }
  if (!isPublicHttpUrl(asked) || !isPublicHttpUrl(final)) return { indexed: false, reason: "not_public" };
  if (!isCacheable(asked) || !isCacheable(final)) return { indexed: false, reason: "secret_url" };
  if (!opts.anyHost && !(isIndexableHost(final.href) || isIndexableHost(asked.href))) return { indexed: false, reason: "unlisted_host" };
  const chunks = chunkPage(page.text, page.headings);
  if (!chunks.length) return { indexed: false, reason: "empty" };

  const store = opts.store === undefined ? searchStore() : opts.store;
  if (store) {
    await store.replacePage({
      url: normalizeUrl(final.href), title: page.title.slice(0, 300), lang: (page.lang ?? "").split("-")[0]!.toLowerCase().slice(0, 12),
      source: (opts.source ?? "read").slice(0, 60), fetchedAt: page.fetchedAt, chunks,
    });
  }
  return { indexed: true, chunks: chunks.length };
}

/** The best chunks for a question: convenience over the shared store. */
export function searchIndex(q: string, limit = 5, store: SearchStore = searchStore()): Promise<IndexHit[]> {
  return store.searchIndex(q, Math.max(1, Math.min(limit, 20)));
}

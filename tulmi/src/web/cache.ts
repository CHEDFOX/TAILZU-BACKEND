/**
 * WHERE A READ PAGE IS KEPT, SO THE NEXT READ OF IT COSTS NOTHING.
 *
 * What is kept is the EXTRACTED result (extract.ts: markdown, headings, links),
 * never the raw HTML: it is a fraction of the size, it has already had its
 * hidden text taken out, and nothing in it can be replayed as a page. The
 * reader keeps the whole of it (up to its own cap) and cuts it to a section or
 * a length when it is asked for one, so a cached page serves every question
 * about it.
 *
 * Behind one interface so everything above it runs against the in-memory twin
 * (a 500-entry LRU) in tests and local runs, and against the Supabase table
 * `web_pages` (supabase/migrations/0026_web_cache.sql) in production, as
 * code/store.ts does. Written with the service key: the table has row-level
 * security on and no policy at all.
 *
 * THE KEY is the sha256 of the address, normalised: host in lower case, no
 * #fragment, the query's parameters sorted. The same page is the same key
 * whichever way it was typed. The cache is shared by everyone on purpose: the
 * reader sends no cookie and no login, so every person gets the same page.
 *
 * HOW LONG: WEB_CACHE_TTL_MIN (6 hours unless set); a day, or the setting if
 * it is longer, for documentation hosts (*.readthedocs.io, docs.*,
 * developer.mozilla.org, nodejs.org/api, and raw.githubusercontent.com at a
 * commit, which never changes). 0 keeps nothing.
 *
 * WHAT IS NEVER KEPT: an error, and any address whose query carries something
 * that looks like a secret (token, key, sig, signature, auth, code, session,
 * password, access_token, X-Amz-*, and the like). Such an address is a
 * credential in itself, and a page behind one is not the same page for the
 * next person.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { Heading, PageLink } from "./extract.js";

/** Pages the memory twin holds before it lets the least recently used go. */
export const MEMORY_PAGES_MAX = 500;

/** The base TTL of a documentation host: a day. */
export const DOCS_TTL_MIN = 1440;

/** A page as it is kept: everything the reader needs to answer without going out. */
export interface CachedPage {
  /** The address as the reader asked for it (normalised: see normalizeUrl). */
  url: string;
  finalUrl: string;
  title: string;
  lang: string;
  text: string;
  headings: Heading[];
  links: PageLink[];
  codeBlocks: number;
  contentType: string;
  /** Bytes the site sent. */
  bytes: number;
  /** The text was already cut at the reader's own ceiling. */
  truncated: boolean;
  /** How it was read: with a plain fetch, or with the browser. */
  via: "fetch" | "browser";
  fetchedAt: number;
  expiresAt: number;
}

export interface WebCache {
  /** The page, unless there is none or it has expired. */
  get(url: string, now?: number): Promise<CachedPage | null>;
  put(page: CachedPage): Promise<void>;
  /** Forgets what has expired. Returns how many. */
  prune(now?: number): Promise<number>;
}

// ------------------------------------------------------------------ the key

/** The address with the differences that do not change the page taken out. Throws on a string that is not an address. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  u.username = "";
  u.password = "";
  const params = new URLSearchParams(u.search);
  params.sort(); // by name; the order within one name is kept
  u.search = params.toString(); // empty: no "?" at all
  return u.href;
}

export function cacheKey(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}

// -------------------------------------------------------------------- rules

const SECRET_NAMES = new Set(["token", "key", "sig", "signature", "auth", "code", "session", "password", "access_token", "sid", "jwt", "otp", "pwd", "passwd", "secret", "apikey"]);
const SECRET_PARTS = ["token", "secret", "passw", "apikey", "api_key", "api-key", "signature", "credential", "session", "oauth"];

/** Whether a query parameter's name says its value is a secret. */
export function isSecretParam(name: string): boolean {
  const n = name.toLowerCase();
  return SECRET_NAMES.has(n) || n.startsWith("x-amz-") || n.startsWith("x-goog-") || SECRET_PARTS.some((p) => n.includes(p));
}

/** Whether a page at this address may be kept at all. */
export function isCacheable(u: URL): boolean {
  if (u.username || u.password) return false;
  for (const name of u.searchParams.keys()) if (isSecretParam(name)) return false;
  return true;
}

/** The address with the values of secret-looking parameters blanked, for anywhere it is shown. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = ""; u.password = "";
    for (const name of [...new Set(u.searchParams.keys())]) {
      if (isSecretParam(name)) u.searchParams.set(name, "REDACTED");
    }
    return u.href;
  } catch {
    return raw;
  }
}

/** Minutes a page at this address is kept, given the base setting. 0: not at all. */
export function ttlMinutes(u: URL, base: number): number {
  if (!(base > 0)) return 0;
  const host = u.hostname.toLowerCase();
  let docs = host.endsWith(".readthedocs.io") || host.startsWith("docs.") || host === "developer.mozilla.org";
  if (host === "nodejs.org" && (u.pathname === "/api" || u.pathname.startsWith("/api/"))) docs = true;
  if (host === "raw.githubusercontent.com") docs = /^[0-9a-f]{7,40}$/i.test(u.pathname.split("/")[3] ?? ""); // /owner/repo/<ref>/path
  return docs ? Math.max(base, DOCS_TTL_MIN) : base;
}

// ------------------------------------------------------------------- memory

export class MemoryWebCache implements WebCache {
  /** Oldest use first: a Map keeps insertion order, and a use puts the entry back at the end. */
  private pages = new Map<string, CachedPage>();

  constructor(private readonly max: number = MEMORY_PAGES_MAX, private readonly clock: () => number = Date.now) {}

  async get(url: string, now: number = this.clock()) {
    const key = cacheKey(url);
    const p = this.pages.get(key);
    if (!p) return null;
    this.pages.delete(key);
    if (p.expiresAt <= now) return null;
    this.pages.set(key, p);
    return clonePage(p);
  }
  async put(page: CachedPage) {
    const key = cacheKey(page.url);
    this.pages.delete(key);
    this.pages.set(key, clonePage({ ...page, url: normalizeUrl(page.url) }));
    while (this.pages.size > this.max) this.pages.delete(this.pages.keys().next().value!);
  }
  async prune(now: number = this.clock()) {
    let n = 0;
    for (const [k, p] of [...this.pages]) if (p.expiresAt <= now) { this.pages.delete(k); n += 1; }
    return n;
  }
  get size(): number { return this.pages.size; }
}

const clonePage = (p: CachedPage): CachedPage => ({ ...p, headings: p.headings.map((h) => ({ ...h })), links: p.links.map((l) => ({ ...l })) });

// ----------------------------------------------------------------- supabase

interface PageRow {
  url_hash: string; url: string; final_url: string; title: string; lang: string; body: unknown;
  via: "fetch" | "browser"; fetched_at: string; expires_at: string;
}

interface PageBody {
  text: string; headings: Heading[]; links: PageLink[]; codeBlocks: number; contentType: string; bytes: number; truncated: boolean;
}

const iso = (n: number) => new Date(n).toISOString();
const ms = (v: unknown): number | null => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A row back into a page; null for a row that is not what put wrote (it counts as a miss, not an error). */
function pageOf(r: PageRow): CachedPage | null {
  const b = r.body as Partial<PageBody> | null;
  const fetchedAt = ms(r.fetched_at);
  const expiresAt = ms(r.expires_at);
  if (!b || typeof b !== "object" || typeof b.text !== "string" || fetchedAt === null || expiresAt === null) return null;
  return {
    url: r.url, finalUrl: r.final_url, title: r.title ?? "", lang: r.lang ?? "", text: b.text,
    headings: Array.isArray(b.headings) ? b.headings : [], links: Array.isArray(b.links) ? b.links : [],
    codeBlocks: Number(b.codeBlocks) || 0, contentType: typeof b.contentType === "string" ? b.contentType : "",
    bytes: Number(b.bytes) || 0, truncated: b.truncated === true, via: r.via === "browser" ? "browser" : "fetch", fetchedAt, expiresAt,
  };
}

/** One in this many writes also clears what has expired, so the table does not grow for ever. */
const PRUNE_EVERY = 200;

export class SupabaseWebCache implements WebCache {
  private writes = 0;

  constructor(private readonly sb: SupabaseClient, private readonly clock: () => number = Date.now) {}

  async get(url: string, now: number = this.clock()) {
    const res = await this.sb.from("web_pages").select("*").eq("url_hash", cacheKey(url)).gt("expires_at", iso(now)).maybeSingle<PageRow>();
    if (res.error) throw new Error(`web cache: ${res.error.message}`);
    return res.data ? pageOf(res.data) : null;
  }
  async put(page: CachedPage) {
    const body: PageBody = {
      text: page.text, headings: page.headings, links: page.links, codeBlocks: page.codeBlocks,
      contentType: page.contentType, bytes: page.bytes, truncated: page.truncated,
    };
    const res = await this.sb.from("web_pages").upsert({
      url_hash: cacheKey(page.url), url: normalizeUrl(page.url), final_url: page.finalUrl, title: page.title, lang: page.lang,
      body, via: page.via, fetched_at: iso(page.fetchedAt), expires_at: iso(page.expiresAt),
    }, { onConflict: "url_hash" });
    if (res.error) throw new Error(`web cache: ${res.error.message}`);
    this.writes += 1;
    if (this.writes % PRUNE_EVERY === 0) this.prune().catch(() => { /* housekeeping: the next one will do it */ });
  }
  async prune(now: number = this.clock()) {
    const res = await this.sb.from("web_pages").delete().lte("expires_at", iso(now)).select("url_hash").returns<Array<{ url_hash: string }>>();
    if (res.error) throw new Error(`web cache: ${res.error.message}`);
    return (res.data ?? []).length;
  }
}

// ------------------------------------------------------------------ the one

let current: WebCache | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function webCache(): WebCache {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseWebCache(sb) : new MemoryWebCache();
  }
  return current;
}

export function resetWebCacheForTests(): void { current = null; }

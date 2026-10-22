/**
 * MORE APPS: THE OFFICIAL MCP REGISTRY, AS A PLACE TO SEARCH.
 *
 * registry.modelcontextprotocol.io lists tens of thousands of MCP servers and
 * vets none of them: searching "notion" finds third-party proxies and no
 * Notion. So it is never a list of apps we offer. It is a search source behind
 * our own catalog, and everything found in it is shown as Unverified, with its
 * host, and added like any app pasted by link (routes/connectorsCustom.ts):
 * the same strict sign-in, the same cleaned and pinned tools, the same Ask
 * first for anything that is not plainly a read.
 *
 * SYNC (syncDirectory, every 12 hours while CUSTOM_CONNECTORS is on). The
 * first run crawls every page (version=latest, 100 a page, by cursor); after
 * that only what changed since the last run that finished (updated_since,
 * which also brings back the deleted ones, so they can go). A run that fails
 * part way leaves the marker where it was, so the next one starts over from
 * there; writing an entry twice is harmless.
 *
 * WHAT IS KEPT (readEntry): a server with a remote we can actually connect to,
 * the way an app added by link connects:
 *   - Streamable HTTP (the SSE transport is not what client.ts speaks);
 *   - https on 443 or 8443, a name and not an address, no user:password, no
 *     #fragment (the add route checks it again, DNS and all);
 *   - no {template} in the URL and no header it says is required: there is
 *     nowhere on our screens to fill those in;
 *   - not deleted. Anything else that was kept before is taken out.
 * `verifiedDomain` is set when the reverse-DNS name is the remote's own host
 * or a parent of it (com.stripe/mcp at mcp.stripe.com). That says the
 * publisher proved control of that domain to the registry, not that they are
 * the company the domain suggests, so it only lifts an entry in the order.
 *
 * SEARCH (searchDirectory): the title, name and description, any case, 20 at
 * a time. In this order: our own catalog's apps that match (they are there to
 * be connected from their own tile, and are the answer we checked), then
 * DIRECTORY_FEATURED, then the domain-verified matches, then the rest. An
 * entry at the same address as one of our switched-on apps is left out: that
 * app is already on the screen, checked.
 *
 * No icon is ever fetched: the screens draw the first letter, as they do for
 * every app. `icon` is kept as the registry gave it, and used by nothing yet.
 */
import { isIP } from "node:net";
import type { DirectoryApp } from "../../../shared/types/api.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { ConnectorDef } from "./catalog.js";
import { egressFetchWith, type FetchLike } from "./egress.js";
import { stripInvisible } from "./hygiene.js";

export const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0.1/servers";
export const SYNC_EVERY_MS = 12 * 60 * 60_000;
/** The first run waits this long after the server starts, so a deploy is not also a crawl. */
export const FIRST_SYNC_DELAY_MS = 60_000;
export const PAGE_SIZE = 100;
/** 480 pages on 2026-10-22: room to grow, and a stop if a cursor never ends. */
export const MAX_PAGES = 2000;
/** One page of results. */
export const SEARCH_LIMIT = 20;
/** An incremental run asks from a little before the last one started, so nothing published in between is missed. */
const OVERLAP_MS = 10 * 60_000;
/** A page is a hundred server.json documents: a few hundred KB. */
const PAGE_BYTES_MAX = 8 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 30_000;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 300;
/** The most an app's name may be (connector_custom.name): what Add sends is cut to it. */
const NAME_MAX = 40;
const URL_MAX = 2048;
const QUERY_MAX = 60;

/**
 * Registry names shown right after our own catalog, before the rest of what
 * matches. Empty for now. A name goes in here (exactly as the registry spells
 * it, "com.example/mcp") only after someone has added that server by link
 * against the live service: it answered, its sign-in came back to our
 * callback, its tools listed, and one read and one write did what they said.
 * Featured is about order, not trust: a featured entry is still labelled
 * Unverified, and still gets everything an app added by link gets. An app we
 * are ready to vouch for belongs in catalog.ts instead.
 */
export const DIRECTORY_FEATURED: readonly string[] = [];

/** An MCP Registry name: reverse DNS, a slash, a name ("io.github.someone/server"). */
export const REGISTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** One remote MCP server we could connect to, as kept in mcp_directory. */
export interface DirectoryEntry {
  /** The registry's name for it: the key, and what an app added from it records. */
  name: string;
  title: string;
  description: string;
  /** Its Streamable HTTP address. */
  url: string;
  host: string;
  website: string | null;
  icon: string | null;
  verifiedDomain: boolean;
  /** When the registry last changed it, ms. */
  updatedAt: number;
}

// ---------------------------------------------------------------- reading

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? stripInvisible(v).replace(/\s+/g, " ").trim().slice(0, max).trim() : "";

/** An https address an app added by link could use, or null. The add route checks it again, with DNS. */
function usableUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > URL_MAX || /[{}]/.test(raw)) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.hash) return null;
  if (!["", "443", "8443"].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || !host.includes(".") || host.endsWith(".localhost")) return null;
  return u;
}

/** The remote this code would connect to: Streamable HTTP, usable, asking for no header. */
function pickRemote(remotes: unknown): URL | null {
  if (!Array.isArray(remotes)) return null;
  for (const r of remotes) {
    if (!isObject(r) || r.type !== "streamable-http") continue;
    if (Array.isArray(r.headers) && r.headers.some((h) => isObject(h) && h.isRequired === true)) continue;
    const u = usableUrl(r.url);
    if (u) return u;
  }
  return null;
}

/** "com.stripe/mcp" -> "stripe.com"; null when the namespace is not a domain. */
export function domainOfName(name: string): string | null {
  const ns = name.split("/")[0] ?? "";
  const labels = ns.toLowerCase().split(".").filter(Boolean);
  return labels.length >= 2 ? labels.reverse().join(".") : null;
}

/** The registry name's domain is the host or a parent of it. */
export function nameMatchesHost(name: string, host: string): boolean {
  const d = domainOfName(name);
  const h = host.toLowerCase();
  return !!d && (h === d || h.endsWith(`.${d}`));
}

const https = (v: unknown): string | null => (typeof v === "string" && /^https:\/\//i.test(v) && v.length <= URL_MAX ? v : null);

/**
 * One item of a registry page: keep it, take it out (deleted, or no longer a
 * server we could connect to), or ignore it (not the latest version, or not
 * readable at all: nothing to say about it either way).
 */
export function readEntry(item: unknown): { keep: DirectoryEntry } | { drop: string } | null {
  if (!isObject(item) || !isObject(item.server)) return null;
  const s = item.server;
  const name = typeof s.name === "string" ? s.name : "";
  if (!REGISTRY_NAME.test(name)) return null;
  const meta = isObject(item._meta) ? item._meta["io.modelcontextprotocol.registry/official"] : undefined;
  const official = isObject(meta) ? meta : {};
  if (official.isLatest === false) return null;
  if (official.status === "deleted") return { drop: name };
  const url = pickRemote(s.remotes);
  if (!url) return { drop: name };
  const icon = Array.isArray(s.icons) ? s.icons.map((i) => (isObject(i) ? https(i.src) : null)).find(Boolean) ?? null : null;
  const when = Date.parse(String(official.updatedAt ?? official.publishedAt ?? ""));
  return {
    keep: {
      name,
      title: clean(s.title, TITLE_MAX) || name,
      description: clean(s.description, DESCRIPTION_MAX),
      url: url.href,
      host: url.host,
      website: https(s.websiteUrl),
      icon,
      verifiedDomain: nameMatchesHost(name, url.hostname),
      updatedAt: Number.isFinite(when) ? when : 0,
    },
  };
}

// ------------------------------------------------------------------ store

export interface FindOptions {
  /** Only these names. */
  names?: readonly string[];
  /** Not these names. */
  exclude?: readonly string[];
  limit: number;
  offset: number;
}

export interface DirectoryStore {
  /** Writes these entries, each replacing the one of its name. */
  putDirectory(entries: readonly DirectoryEntry[]): Promise<void>;
  removeDirectory(names: readonly string[]): Promise<void>;
  getDirectory(name: string): Promise<DirectoryEntry | null>;
  /**
   * Entries whose title, name or description holds `q` (any case; "_" matches
   * any one character, as in SQL), domain-verified first, then by title and name.
   * `q` is a searchTerm(): nothing in it means anything to the query but letters.
   */
  findDirectory(q: string, o: FindOptions): Promise<DirectoryEntry[]>;
  /** When the last sync that finished had started (ms), or null: none has, so the next one crawls everything. */
  directorySyncedFrom(): Promise<number | null>;
  setDirectorySyncedFrom(ms: number): Promise<void>;
}

/**
 * What a person typed, made safe to search with: letters, digits, spaces and
 * . _ - / only, so it can never be anything but text inside the query (no
 * PostgREST punctuation, no % wildcard), and short.
 */
export function searchTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return stripInvisible(raw).replace(/[^\p{L}\p{N} ._/-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, QUERY_MAX).trim();
}

const byRank = (a: DirectoryEntry, b: DirectoryEntry): number =>
  Number(b.verifiedDomain) - Number(a.verifiedDomain) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export class MemoryDirectoryStore implements DirectoryStore {
  private rows = new Map<string, DirectoryEntry>();
  private syncedFrom: number | null = null;

  async putDirectory(entries: readonly DirectoryEntry[]) { for (const e of entries) this.rows.set(e.name, { ...e }); }
  async removeDirectory(names: readonly string[]) { for (const n of names) this.rows.delete(n); }
  async getDirectory(name: string) { const e = this.rows.get(name); return e ? { ...e } : null; }
  async findDirectory(q: string, o: FindOptions) {
    // ilike's own reading of the term: "_" is any one character.
    const like = new RegExp(q.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&").replace(/_/g, "."), "i");
    return [...this.rows.values()]
      .filter((e) => (!o.names || o.names.includes(e.name)) && !o.exclude?.includes(e.name))
      .filter((e) => !q || like.test(e.title) || like.test(e.name) || like.test(e.description))
      .sort(byRank)
      .slice(o.offset, o.offset + o.limit)
      .map((e) => ({ ...e }));
  }
  async directorySyncedFrom() { return this.syncedFrom; }
  async setDirectorySyncedFrom(ms: number) { this.syncedFrom = ms; }
}

interface DirectoryRow {
  name: string; title: string; description: string; url: string; host: string; website: string | null;
  icon: string | null; verified_domain: boolean; updated_at: string;
}

const rowOf = (e: DirectoryEntry): DirectoryRow => ({
  name: e.name, title: e.title, description: e.description, url: e.url, host: e.host, website: e.website,
  icon: e.icon, verified_domain: e.verifiedDomain, updated_at: new Date(e.updatedAt).toISOString(),
});
const entryOf = (r: DirectoryRow): DirectoryEntry => ({
  name: r.name, title: r.title, description: r.description ?? "", url: r.url, host: r.host, website: r.website ?? null,
  icon: r.icon ?? null, verifiedDomain: r.verified_domain === true, updatedAt: Date.parse(r.updated_at) || 0,
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`directory store: ${res.error.message}`);
  return res.data;
}

/** A value inside a PostgREST filter, quoted. searchTerm() and REGISTRY_NAME leave nothing to escape but this. */
const quoted = (v: string) => `"${v.replace(/["\\]/g, "")}"`;

export class SupabaseDirectoryStore implements DirectoryStore {
  constructor(private readonly sb: SupabaseClient) {}

  async putDirectory(entries: readonly DirectoryEntry[]) {
    if (!entries.length) return;
    ok(await this.sb.from("mcp_directory").upsert(entries.map(rowOf), { onConflict: "name" }));
  }
  async removeDirectory(names: readonly string[]) {
    if (!names.length) return;
    ok(await this.sb.from("mcp_directory").delete().in("name", [...names]));
  }
  async getDirectory(name: string) {
    if (!REGISTRY_NAME.test(name)) return null;
    const r = ok(await this.sb.from("mcp_directory").select("*").eq("name", name).maybeSingle<DirectoryRow>());
    return r ? entryOf(r) : null;
  }
  async findDirectory(q: string, o: FindOptions) {
    let query = this.sb.from("mcp_directory").select("*");
    if (q) {
      const like = quoted(`%${q}%`);
      query = query.or(`title.ilike.${like},name.ilike.${like},description.ilike.${like}`);
    }
    if (o.names) query = query.in("name", [...o.names]);
    if (o.exclude?.length) query = query.not("name", "in", `(${o.exclude.map(quoted).join(",")})`);
    const rows = ok(await query.order("verified_domain", { ascending: false }).order("title").order("name")
      .range(o.offset, o.offset + o.limit - 1).returns<DirectoryRow[]>());
    return (rows ?? []).map(entryOf);
  }
  async directorySyncedFrom() {
    const r = ok(await this.sb.from("mcp_directory_sync").select("synced_from").eq("id", 1).maybeSingle<{ synced_from: string }>());
    const t = r ? Date.parse(r.synced_from) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  async setDirectorySyncedFrom(ms: number) {
    ok(await this.sb.from("mcp_directory_sync").upsert({ id: 1, synced_from: new Date(ms).toISOString() }, { onConflict: "id" }));
  }
}

let current: DirectoryStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function directoryStore(): DirectoryStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseDirectoryStore(sb) : new MemoryDirectoryStore();
  }
  return current;
}

// ------------------------------------------------------------------- sync

export interface SyncOptions {
  store: DirectoryStore;
  /** Default: the guarded fetch (egress.ts), thirty seconds and 8 MiB a page. */
  fetchFn?: FetchLike;
  baseUrl?: string;
  now?: () => number;
}

export interface SyncResult { full: boolean; pages: number; kept: number; dropped: number }

const registryFetch: FetchLike = egressFetchWith({ timeoutMs: PAGE_TIMEOUT_MS, maxBytes: PAGE_BYTES_MAX });

/** One run: everything the first time, then what changed since the last run that finished. Throws when a page cannot be read. */
export async function syncDirectory(o: SyncOptions): Promise<SyncResult> {
  const now = o.now ?? Date.now;
  const fetchFn = o.fetchFn ?? registryFetch;
  const startedAt = now();
  const from = await o.store.directorySyncedFrom();
  const out: SyncResult = { full: from === null, pages: 0, kept: 0, dropped: 0 };
  let cursor: string | undefined;
  const seen = new Set<string>();
  while (out.pages < MAX_PAGES) {
    const url = new URL(o.baseUrl ?? REGISTRY_URL);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("version", "latest");
    if (from !== null) url.searchParams.set("updated_since", new Date(Math.max(0, from - OVERLAP_MS)).toISOString());
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetchFn(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`registry answered ${res.status} on page ${out.pages + 1}`);
    }
    const page = (await res.json()) as { servers?: unknown; metadata?: { nextCursor?: unknown } };
    if (!Array.isArray(page?.servers)) throw new Error(`registry page ${out.pages + 1} has no servers list`);
    out.pages += 1;
    const keep: DirectoryEntry[] = [];
    const drop: string[] = [];
    for (const item of page.servers) {
      const r = readEntry(item);
      if (r && "keep" in r) keep.push(r.keep);
      else if (r) drop.push(r.drop);
    }
    await o.store.putDirectory(keep);
    await o.store.removeDirectory(drop);
    out.kept += keep.length;
    out.dropped += drop.length;
    const next = page.metadata?.nextCursor;
    // A cursor seen before would go round for ever.
    if (typeof next !== "string" || !next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  await o.store.setDirectorySyncedFrom(startedAt);
  return out;
}

/**
 * Sync now-ish and then every twelve hours, one run at a time, never in the
 * way of a request. Returns the stop. A run that fails is logged and waits
 * for the next turn.
 */
export function startDirectorySync(o: SyncOptions & {
  everyMs?: number; firstDelayMs?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncDirectory(o);
      o.log?.info(r, "mcp directory synced");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.message }, "mcp directory sync failed");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, o.firstDelayMs ?? FIRST_SYNC_DELAY_MS);
  const every = setInterval(run, o.everyMs ?? SYNC_EVERY_MS);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}

// ----------------------------------------------------------------- search

/** An address without the trailing slash, for "is this the same server". */
const sameServer = (u: string) => { try { const x = new URL(u); return `${x.host}${x.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return u; } };
const initialOf = (s: string) => s.trim().charAt(0).toUpperCase() || "?";
/** A name that fits an app's name, cut at a word where one is near. */
function fitName(title: string): string {
  if (title.length <= NAME_MAX) return title;
  const cut = title.slice(0, NAME_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > NAME_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

function catalogApp(d: ConnectorDef): DirectoryApp {
  return { id: d.id, source: "catalog", name: d.name, initial: initialOf(d.name), description: d.oneLine, host: new URL(d.url).host };
}

function registryApp(e: DirectoryEntry, featured: boolean): DirectoryApp {
  const name = fitName(e.title);
  return {
    id: e.name, source: "registry", name, initial: initialOf(name), description: e.description, host: e.host, url: e.url,
    unverified: true, ...(e.verifiedDomain ? { domainVerified: true as const } : {}), ...(featured ? { featured: true as const } : {}),
  };
}

/**
 * Our switched-on apps a search matches: by name, or by one of its aliases as
 * a whole word of the search (or the start of one, from three letters on). Not
 * by any letters anywhere: "spreadsheet" is not a search for GitHub's "pr".
 */
function catalogHits(q: string, catalog: readonly ConnectorDef[]): ConnectorDef[] {
  if (!q) return [];
  const t = q.toLowerCase();
  const words = t.split(" ");
  return catalog.filter((d) => !d.hidden && !d.custom
    && (d.name.toLowerCase().includes(t) || d.aliases.some((a) => words.includes(a) || (t.length >= 3 && a.startsWith(t)))));
}

/** The cursor is where the registry's part of the list goes on from. Anything else starts at the top. */
const offsetOf = (cursor: unknown): number => (typeof cursor === "string" && /^\d{1,5}$/.test(cursor) ? Number(cursor) : 0);

export interface DirectoryPage { apps: DirectoryApp[]; count: number; q: string; nextCursor?: string }

/** One page of More apps for `raw`: catalog, featured, domain-verified, the rest. See the top of this file. */
export async function searchDirectory(store: DirectoryStore, raw: unknown, o: {
  catalog: readonly ConnectorDef[]; cursor?: unknown; limit?: number; featured?: readonly string[];
}): Promise<DirectoryPage> {
  const q = searchTerm(raw);
  const limit = o.limit ?? SEARCH_LIMIT;
  const featured = o.featured ?? DIRECTORY_FEATURED;
  const offset = offsetOf(o.cursor);
  const ours = new Set(o.catalog.map((d) => sameServer(d.url)));
  const first = offset === 0;
  const head: DirectoryApp[] = [];
  if (first) {
    head.push(...catalogHits(q, o.catalog).slice(0, limit).map(catalogApp));
    if (featured.length && head.length < limit) {
      const picked = await store.findDirectory(q, { names: featured, limit: featured.length, offset: 0 });
      picked.sort((a, b) => featured.indexOf(a.name) - featured.indexOf(b.name));
      head.push(...picked.slice(0, limit - head.length).map((e) => registryApp(e, true)));
    }
  }
  const room = limit - head.length;
  const rest = room > 0 ? await store.findDirectory(q, { exclude: featured, limit: room, offset }) : [];
  const apps = [...head, ...rest.map((e) => registryApp(e, false))]
    .filter((a) => a.source === "catalog" || !ours.has(sameServer(a.url!)));
  return { apps, count: apps.length, q, ...(room > 0 && rest.length === room ? { nextCursor: String(offset + room) } : {}) };
}

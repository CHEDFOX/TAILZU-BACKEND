/**
 * THE PUBLIC NETWORK LISTS, DOWNLOADED BY THE SERVER ITSELF (docs/trust.md §lists).
 *
 * To say what KIND of network a request came from we need to know which ranges belong to data centres, to Tor's exits, to
 * iCloud Private Relay and to which network operator (the ASN). All of it is public, so the server fetches the lists over
 * plain GETs — nothing about a person leaves this server, and no reputation API is called, because that would mean sending
 * somebody's address to a third party. Each file is written to TRUST_LISTS_DIR (a volume), refreshed daily, and the last good
 * copy is kept: a fetch that fails changes nothing, and no list at all means the kind reads "unknown" and scores nothing.
 *
 * The ASN list has about half a million ranges, so the lookup is a binary search over sorted arrays (net.BlockList checks its
 * rules one by one, which is far too slow for that). IPv4 ranges are numbers; IPv6 ranges are 32-character hex strings, a
 * fixed width, so a plain string compare sorts and searches them.
 *
 * Every list's country column is dropped as it is read: nothing here ever works out where a person is (docs/trust.md rule 3).
 */
import { gunzip as gunzipCb, gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { v4Num, v6Hex, v6Words, ipOf } from "./netKey.js";
import { DisposableList, parseDisposableFile } from "./email.js";

/** What each file is called in TRUST_LISTS_DIR. The name says what it holds, so a person on the server can read the folder. */
export const LIST_FILES = {
  asn: "asn.tsv.gz",
  tor: "tor.txt",
  relay: "relay.csv",
  hosting: ["hosting-aws.json", "hosting-gcp.json", "hosting-oracle.json", "hosting-cf-v4.txt", "hosting-cf-v6.txt"],
  disposable: "disposable.txt",
} as const;

// ------------------------------------------------------------------ ranges

export interface V4Range { s: number; e: number }
export interface V6Range { s: string; e: string }

/** A set of ranges with nothing attached: "is this address in it?". Thousands of entries at most (Tor, the relay, hosting). */
export class RangeSet {
  constructor(readonly v4: V4Range[] = [], readonly v6: V6Range[] = []) {
    this.v4.sort((a, b) => a.s - b.s);
    this.v6.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  }
  get size(): number { return this.v4.length + this.v6.length; }

  has(raw: unknown): boolean {
    const got = ipOf(raw);
    if (!got) return false;
    if (got.family === "v4") {
      const n = v4Num(got.ip)!;
      return hit(this.v4, (r) => r.s <= n && n <= r.e, (r) => r.s - n);
    }
    const h = v6Hex(got.ip)!;
    return hit(this.v6, (r) => r.s <= h && h <= r.e, (r) => (r.s < h ? -1 : r.s > h ? 1 : 0));
  }
}

/** Binary search: the last range whose start is at or below the address, then one containment check. */
function hit<R>(rows: R[], inside: (r: R) => boolean, cmpStart: (r: R) => number): boolean {
  let lo = 0, hi = rows.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cmpStart(rows[mid]!) <= 0) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 && inside(rows[best]!);
}

/**
 * The ASN table. Half a million IPv4 ranges live in typed arrays rather than objects: the same numbers in a tenth of the
 * memory, which is the difference between this fitting on the VPS and not.
 */
export class AsnTable {
  private readonly s4: Float64Array;
  private readonly e4: Float64Array;
  private readonly a4: Int32Array;
  private readonly r6: Array<V6Range & { asn: number }>;

  constructor(v4: Array<{ s: number; e: number; asn: number }> = [], v6: Array<V6Range & { asn: number }> = []) {
    v4.sort((a, b) => a.s - b.s);
    this.s4 = Float64Array.from(v4, (r) => r.s);
    this.e4 = Float64Array.from(v4, (r) => r.e);
    this.a4 = Int32Array.from(v4, (r) => r.asn);
    this.r6 = v6.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  }
  get size(): number { return this.s4.length + this.r6.length; }

  /** The network operator's number for an address, or null when no list covers it. */
  of(raw: unknown): number | null {
    const got = ipOf(raw);
    if (!got) return null;
    if (got.family === "v4") {
      const n = v4Num(got.ip)!;
      let lo = 0, hi = this.s4.length - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.s4[mid]! <= n) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best >= 0 && n <= this.e4[best]! ? this.a4[best]! : null;
    }
    const h = v6Hex(got.ip)!;
    let lo = 0, hi = this.r6.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.r6[mid]!.s <= h) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best >= 0 && h <= this.r6[best]!.e ? this.r6[best]!.asn : null;
  }
}

// ------------------------------------------------------------------ parsing

/** One CIDR ("1.2.3.0/24" or "2001:db8::/32") as a range, or null. A bare address is a range of one. */
export function cidrRange(raw: unknown): { family: "v4"; s: number; e: number } | { family: "v6"; s: string; e: string } | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const slash = text.indexOf("/");
  const addr = slash >= 0 ? text.slice(0, slash) : text;
  const bits = slash >= 0 ? Number(text.slice(slash + 1)) : null;
  const n = v4Num(addr);
  if (n !== null) {
    const width = bits === null ? 32 : bits;
    if (!Number.isInteger(width) || width < 0 || width > 32) return null;
    const size = 2 ** (32 - width);
    const start = Math.floor(n / size) * size;
    return { family: "v4", s: start, e: start + size - 1 };
  }
  const words = v6Words(addr);
  if (!words) return null;
  const width = bits === null ? 128 : bits;
  if (!Number.isInteger(width) || width < 0 || width > 128) return null;
  const lowWords = words.slice();
  const highWords = words.slice();
  for (let i = 0; i < 8; i++) {
    const used = Math.min(16, Math.max(0, width - i * 16));
    const mask = used === 0 ? 0 : ((0xffff << (16 - used)) & 0xffff);
    lowWords[i] = words[i]! & mask;
    highWords[i] = (words[i]! & mask) | (0xffff & ~mask);
  }
  const hex = (w: number[]) => w.map((x) => (x & 0xffff).toString(16).padStart(4, "0")).join("");
  return { family: "v6", s: hex(lowWords), e: hex(highWords) };
}

/** A list of CIDRs or addresses (Tor's exit list, Cloudflare's files, the relay's first column) as a RangeSet. */
export function rangeSetOf(cidrs: Iterable<string>): RangeSet {
  const v4: V4Range[] = [], v6: V6Range[] = [];
  for (const c of cidrs) {
    const r = cidrRange(c);
    if (!r) continue;
    if (r.family === "v4") v4.push({ s: r.s, e: r.e }); else v6.push({ s: r.s, e: r.e });
  }
  return new RangeSet(v4, v6);
}

/** One CIDR or address a line, # for a comment: Tor's exit list and Cloudflare's two files. */
export const parseLines = (text: string): string[] =>
  text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);

/**
 * iCloud Private Relay's egress ranges: "1.2.3.0/24,IN,Karnataka,Bengaluru,". Only the first column is read — the country,
 * region and city columns are dropped here, where they arrive, so nothing downstream could use them even by accident.
 */
export const parseRelayCsv = (text: string): string[] =>
  text.split(/\r?\n/).map((l) => l.split(",")[0]?.trim() ?? "").filter((c) => c.includes("/") || c.includes("."));

/** AWS's ip-ranges.json, GCP's cloud.json, Oracle's public_ip_ranges.json: whichever shape it is, every prefix in it. */
export function parseHostingJson(text: string): string[] {
  const out: string[] = [];
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return out; }
  const push = (v: unknown) => { if (typeof v === "string" && v.trim()) out.push(v.trim()); };
  const walkPrefixes = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (typeof row === "string") { push(row); continue; }
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      push(r.ip_prefix); push(r.ipv6_prefix); push(r.ipv4Prefix); push(r.ipv6Prefix); push(r.cidr);
      if (Array.isArray(r.cidrs)) walkPrefixes(r.cidrs);
    }
  };
  const d = (doc ?? {}) as Record<string, unknown>;
  walkPrefixes(d.prefixes); walkPrefixes(d.ipv6_prefixes); walkPrefixes(d.regions);
  return out;
}

/**
 * iptoasn's combined file: range_start, range_end, AS number, country, description, tab separated. The country and the
 * description are dropped. Rows with AS 0 ("not routed") are dropped too: they say nothing.
 */
type AsnRows = { v4: Array<{ s: number; e: number; asn: number }>; v6: Array<V6Range & { asn: number }> };

/** One line of that file into the two lists, or nothing at all. The whole of the parsing is here, so both readers agree. */
function readAsnLine(line: string, into: AsnRows): void {
  if (!line || line.startsWith("#")) return;
  const cols = line.split("\t");
  if (cols.length < 3) return;
  const asn = Number(cols[2]);
  if (!Number.isInteger(asn) || asn <= 0) return;
  const a = cols[0]!.trim(), b = cols[1]!.trim();
  const s4 = v4Num(a), e4 = v4Num(b);
  if (s4 !== null && e4 !== null) { if (e4 >= s4) into.v4.push({ s: s4, e: e4, asn }); return; }
  const s6 = v6Hex(a), e6 = v6Hex(b);
  if (s6 && e6 && e6 >= s6) into.v6.push({ s: s6, e: e6, asn });
}

export function parseAsnTsv(text: string): AsnTable {
  const into: AsnRows = { v4: [], v6: [] };
  for (const line of text.split("\n")) readAsnLine(line, into);
  return new AsnTable(into.v4, into.v6);
}

/** How many rows are read between two turns of the event loop. Half a million rows is about 25 turns. */
const ASN_CHUNK = 20_000;

/**
 * The same parse, in chunks, letting the server answer requests in between (docs/trust.md §lists).
 *
 * That file is about half a million rows, and reading it whole takes well over a second: done in one go, at start and
 * again at every daily refresh, it would stop every request on the server for that long. So this reads a chunk, yields,
 * and reads the next — it takes a little longer in total and nothing waits on it.
 */
export async function parseAsnTsvInChunks(text: string, chunk = ASN_CHUNK): Promise<AsnTable> {
  const into: AsnRows = { v4: [], v6: [] };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    readAsnLine(lines[i]!, into);
    if (i % chunk === chunk - 1) await new Promise<void>((done) => setImmediate(done));
  }
  // The sort inside AsnTable is the one piece that cannot be broken up; on half a million rows it is a fraction of the read.
  return new AsnTable(into.v4, into.v6);
}

// ------------------------------------------------------------------ the lists, as the server holds them

export interface Lists {
  asn: AsnTable;
  tor: RangeSet;
  relay: RangeSet;
  hosting: RangeSet;
  disposable: DisposableList;
  /** When this copy was read off the disk, and how many ranges each part holds (the admin view and the log line). */
  readAt: number;
  counts: { asn: number; tor: number; relay: number; hosting: number; disposable: number };
}

/** Nothing downloaded yet: every lookup misses, so every kind reads "unknown" and nothing is scored up. */
export function emptyLists(): Lists {
  return {
    asn: new AsnTable(), tor: new RangeSet(), relay: new RangeSet(), hosting: new RangeSet(),
    disposable: new DisposableList(), readAt: 0,
    counts: { asn: 0, tor: 0, relay: 0, hosting: 0, disposable: new DisposableList().size },
  };
}

const gunzip = promisify(gunzipCb);

const readIf = (file: string): Buffer | null => {
  try { return fs.readFileSync(file); } catch { return null; }
};

/** Whatever is on the disk right now. A file that is missing or unreadable is simply not there; the rest still works. */
export function loadLists(dir: string): Lists {
  const asnRaw = readIf(path.join(dir, LIST_FILES.asn));
  let asn = new AsnTable();
  if (asnRaw) {
    try { asn = parseAsnTsv(gunzipSync(asnRaw).toString("utf8")); } catch { asn = new AsnTable(); }
  }
  return withAsn(dir, asn);
}

/**
 * The same, without stopping the server while it reads (the ASN file is the big one): the server uses this, and the
 * plain `loadLists` above stays for tests and for anything that wants one call and no turns of the loop.
 */
export async function loadListsAsync(dir: string): Promise<Lists> {
  const asnRaw = readIf(path.join(dir, LIST_FILES.asn));
  let asn = new AsnTable();
  if (asnRaw) {
    try {
      const text = (await gunzip(asnRaw)).toString("utf8");
      asn = await parseAsnTsvInChunks(text);
    } catch { asn = new AsnTable(); }
  }
  return withAsn(dir, asn);
}

/** The small lists (a few thousand ranges each, read in milliseconds) around whichever ASN table was read. */
function withAsn(dir: string, asn: AsnTable): Lists {
  const torRaw = readIf(path.join(dir, LIST_FILES.tor));
  const relayRaw = readIf(path.join(dir, LIST_FILES.relay));
  const hostingCidrs: string[] = [];
  for (const name of LIST_FILES.hosting) {
    const raw = readIf(path.join(dir, name));
    if (!raw) continue;
    const text = raw.toString("utf8");
    hostingCidrs.push(...(name.endsWith(".json") ? parseHostingJson(text) : parseLines(text)));
  }
  const dispRaw = readIf(path.join(dir, LIST_FILES.disposable));
  const tor = rangeSetOf(torRaw ? parseLines(torRaw.toString("utf8")) : []);
  const relay = rangeSetOf(relayRaw ? parseRelayCsv(relayRaw.toString("utf8")) : []);
  const hosting = rangeSetOf(hostingCidrs);
  const disposable = new DisposableList(dispRaw ? parseDisposableFile(dispRaw.toString("utf8")) : []);
  return {
    asn, tor, relay, hosting, disposable, readAt: Date.now(),
    counts: { asn: asn.size, tor: tor.size, relay: relay.size, hosting: hosting.size, disposable: disposable.size },
  };
}

let held: Lists = emptyLists();
/** The copy every request reads. Replaced whole, so a request never sees half a list. */
export const lists = (): Lists => held;
export const setLists = (l: Lists): void => { held = l; };

// ------------------------------------------------------------------ the download

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/** One file: fetched, written beside its name and moved into place, so a half-written file is never read. */
async function fetchTo(url: string, file: string, fetchFn: typeof fetch): Promise<number> {
  const res = await fetchFn(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.length) throw new Error("empty");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.new`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  return body.length;
}

export interface RefreshOpts {
  dir: string;
  urls: { asn: string; tor: string; relay: string; hosting: readonly string[] };
  fetchFn?: typeof fetch;
  log?: Log;
}

/**
 * One pass: every list fetched, each on its own. A list that fails keeps the copy already on the disk, and the pass still
 * loads and swaps in whatever is there. Returns what was fetched and what failed (names only; no addresses are logged).
 */
export async function refreshLists(o: RefreshOpts): Promise<{ got: string[]; failed: string[] }> {
  const fetchFn = o.fetchFn ?? fetch;
  const jobs: Array<[string, string, string]> = [
    ["asn", o.urls.asn, LIST_FILES.asn],
    ["tor", o.urls.tor, LIST_FILES.tor],
    ["relay", o.urls.relay, LIST_FILES.relay],
  ];
  o.urls.hosting.forEach((url, i) => {
    const name = LIST_FILES.hosting[i];
    if (name) jobs.push([`hosting${i}`, url, name]);
  });
  const got: string[] = [], failed: string[] = [];
  for (const [name, url, file] of jobs) {
    try {
      await fetchTo(url, path.join(o.dir, file), fetchFn);
      got.push(name);
    } catch (err) {
      failed.push(name);
      o.log?.warn({ list: name, error: (err as Error)?.message?.slice(0, 80) }, "trust: a network list could not be fetched; the last good copy stays");
    }
  }
  setLists(await loadListsAsync(o.dir));
  o.log?.info({ got: got.length, failed: failed.length, ...lists().counts }, "trust: network lists loaded");
  return { got, failed };
}

/**
 * Whatever is on the disk now, then a refresh every `everyMs` (a day), never two at once and never in a request's way. The
 * first fetch waits a minute, so a server that is only starting and stopping (a test) downloads nothing. Returns the stop.
 */
export function startListRefresher(o: RefreshOpts & { everyMs?: number; firstMs?: number }): () => void {
  // Read in the background, in chunks: the ASN file takes over a second, and start-up must not stop for it. Until it is
  // in, every lookup misses, which reads "unknown" and scores nothing — the same as a server that has downloaded nothing.
  void loadListsAsync(o.dir).then(setLists).catch(() => undefined);
  let busy = false;
  const pass = async () => {
    if (busy) return;
    busy = true;
    try { await refreshLists(o); } catch (err) {
      o.log?.warn({ error: (err as Error)?.name }, "trust: the list refresh failed");
    } finally { busy = false; }
  };
  const first = setTimeout(pass, o.firstMs ?? 60_000);
  const every = setInterval(pass, o.everyMs ?? 24 * 3600_000);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}

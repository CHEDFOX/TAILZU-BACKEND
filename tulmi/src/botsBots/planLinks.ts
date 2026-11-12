/**
 * THE WORK CALENDAR, BY ITS LINK (PLAN_V2_LINKS; docs/plan-ease.md "The work calendar"; design A9, B6, B12). The person pastes their
 * calendar's secret address once (Google, Outlook or iCloud all give one), and from then on their meetings are on their days: the page,
 * the notes, the clash check (busy time, never moved) and the chat's list. Nobody signs in to anything.
 *
 *   links.add(user, raw)            the link pasted: checked, read once, kept sealed. At most 3 a person
 *   links.codeFor(raw)              x0bot.com/cal on a computer: the link held sealed for 15 minutes under a 6-digit code; nothing read
 *   links.claim(user, code)         the phone types the code: the link is theirs (then as add)
 *   links.remove(user, id)          taken off, its meetings with it
 *   links.list(user)                what the link page shows: which calendar, a short hint, whether it stopped
 *   links.tick()                    every 5 minutes: the links due a read (30 minutes apart, spread out)
 *   links.freshen(user)             the Plan was opened: a link not read in 10 minutes is read now (the page waits 1.2 s at most)
 *   links.sweep()                   nightly: a link stopped for 7 days is taken off; codes and old meetings go
 *   PLAN_LINK_SOURCE (planSources)  its meetings on the person's days; what its two cards read; its line in the evening note
 *
 * THE ADDRESS IS A PASSWORD to the person's calendar. It is sealed at rest (AES-256-GCM under a key made from CONNECTOR_TOKEN_KEY for this
 * use only), read only to fetch, never logged, never in an error, never sent to any reading service, and the screen shows only a hint. Every read goes
 * through the egress guard (connectors/egress.ts): https on its own port only, never an address inside our network (checked as the
 * connection dials, so a name can't answer public to the check and private to the dial), 3 redirects at most, 10 seconds, 25 MB.
 *
 * Answers: 304 nothing changed; 200 the meetings are read (planIcs.ts) and only what changed is written; 401, 403 or 404 it stopped at
 * once; any other failure three times in a row and it stopped. Stopped for 6 hours: the "stopped" card and one line in the next evening
 * note, never a push. Stopped for 7 days: taken off, and its meetings go.
 */
import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { BotError } from "../bots/types.js";
import { decrypt, encrypt, tokenKey } from "../connectors/crypto.js";
import { checkPublicUrl, egressFetchWith, EgressRefused, type FetchLike } from "../connectors/egress.js";
import { botTopic, TOPIC } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { hintOf, ICS_MAX, linkOf, providerOf, readIcs, type IcsStart } from "./planIcs.js";
import type { DayItem } from "./planRows.js";
import { addPlanSource, type PlanSource, type SourceWindow } from "./planSources.js";
import { planOn } from "./planSwitch.js";
import { MemoryTable, SupabaseTable, table, type Table } from "./rows.js";
import { LINK_SEEN, OFFER_AFTER_DAYS, todayKey } from "./planInCards.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** A person keeps this many links. */
export const LINKS_MAX = 3;
/** Read this often, spread out; read on a Plan open when older than FRESH_MS. */
export const EVERY_MS = 30 * MIN;
const FRESH_MS = 10 * MIN;
/** What's kept: from a week back to two months on. */
const BACK_MS = 7 * DAY, AHEAD_MS = 60 * DAY;
/** Stopped this long: its card and its line in the next note. Stopped this long: taken off. */
export const STOPPED_TELL_MS = 6 * HOUR;
export const STOPPED_DROP_MS = 7 * DAY;
/** A code from x0bot.com/cal lasts this long, and is tried this many times wrong before it goes. */
export const CODE_MS = 15 * MIN;
/**
 * Wrong codes in an hour: a person, an address they come from, and everyone at once. Six numbers can be guessed, and many accounts
 * from many addresses guessing together would find a waiting code in time; the count for everyone stops that (at worst a real person
 * is asked to wait a little), and all three are kept in the database (plan_link_tries), so a restart or a second server resets nothing.
 */
const WRONG_MAX = { person: 5, from: 10, all: 100 } as const;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 25 * 1024 * 1024;

export type LinkState = "ok" | "failing" | "off";

export interface LinkRow {
  [k: string]: unknown;
  id: string; user_id: string; provider: "google" | "outlook" | "icloud" | "other";
  url_enc: string; url_hint: string; url_hash: string; state: LinkState;
  etag: string | null; last_modified: string | null;
  next_fetch_ms: number | null; fetched_ms: number | null; ok_ms: number | null; failing_ms: number | null; fails: number; events: number;
  created_ms: number; updated_ms: number;
}

export interface LinkEventRow {
  [k: string]: unknown;
  link_id: string; user_id: string; ref: string; occurs_ms: number; end_ms: number; all_day: boolean;
  title: string; place: string; busy: boolean; people: number; tz_min: number; sig: string;
}

export interface LinkCodeRow { [k: string]: unknown; code_hash: string; url_enc: string; tries: number; expires_ms: number; created_ms: number }
/** Wrong codes in the current hour, for one scope ("u:<id>", "ip:<keyed hash>", "all"). */
export interface LinkTryRow { [k: string]: unknown; scope: string; n: number; until_ms: number }

/** One link as the link page shows it: never its address. */
export interface LinkView { id: string; provider: LinkRow["provider"]; name: string; hint: string; stopped: boolean }

// ------------------------------------------------------------------ the store

export interface LinkStore {
  links: Table<LinkRow>;
  codes: Table<LinkCodeRow>;
  tries: Table<LinkTryRow>;
  /** A person's meetings between two times (busy or not), soonest first. */
  between(userId: string, fromMs: number, toMs: number, limit: number): Promise<LinkEventRow[]>;
  /** One meeting, by its id on the person's days. */
  byRef(userId: string, ref: string): Promise<LinkEventRow | null>;
  /** A link's refs and what each was. */
  sigs(linkId: string): Promise<Map<string, string>>;
  put(rows: LinkEventRow[]): Promise<void>;
  drop(linkId: string, refs: string[]): Promise<void>;
  dropLink(linkId: string): Promise<void>;
  /** Meetings that ended before `ms`, across everyone. */
  dropBefore(ms: number): Promise<void>;
  /** Links whose read is due by `now`, soonest first. */
  due(now: number, limit: number): Promise<LinkRow[]>;
  /** Codes past their time. */
  dropCodes(now: number): Promise<void>;
}

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export function linkRow(r: LinkRow): LinkRow {
  return {
    ...r, next_fetch_ms: numOrNull(r.next_fetch_ms), fetched_ms: numOrNull(r.fetched_ms), ok_ms: numOrNull(r.ok_ms), failing_ms: numOrNull(r.failing_ms),
    fails: num(r.fails ?? 0), events: num(r.events ?? 0), created_ms: num(r.created_ms), updated_ms: num(r.updated_ms),
  };
}
const eventRowOf = (r: LinkEventRow): LinkEventRow => ({ ...r, occurs_ms: num(r.occurs_ms), end_ms: num(r.end_ms), people: num(r.people ?? 0), tz_min: num(r.tz_min ?? 0), all_day: r.all_day === true, busy: r.busy !== false });

class MemoryLinkStore implements LinkStore {
  readonly links = new MemoryTable<LinkRow>();
  readonly codes = new MemoryTable<LinkCodeRow>();
  readonly tries = new MemoryTable<LinkTryRow>();
  readonly events = new MemoryTable<LinkEventRow>();
  async between(userId: string, fromMs: number, toMs: number, limit: number) {
    return (await this.events.select({ user_id: userId })).filter((e) => e.occurs_ms < toMs && e.end_ms > fromMs).sort((a, b) => a.occurs_ms - b.occurs_ms).slice(0, limit);
  }
  async byRef(userId: string, ref: string) { return (await this.events.select({ user_id: userId, ref }, { limit: 1 }))[0] ?? null; }
  async sigs(linkId: string) { return new Map((await this.events.select({ link_id: linkId })).map((e) => [e.ref, e.sig])); }
  async put(rows: LinkEventRow[]) { for (const r of rows) await this.events.upsert(r, ["link_id", "ref"]); }
  async drop(linkId: string, refs: string[]) { for (const ref of refs) await this.events.remove({ link_id: linkId, ref }); }
  async dropLink(linkId: string) { await this.events.remove({ link_id: linkId }); }
  async dropBefore(ms: number) { for (const e of this.events.rows.filter((x) => x.end_ms < ms)) await this.events.remove({ link_id: e.link_id, ref: e.ref }); }
  async due(now: number, limit: number) {
    return this.links.rows.filter((r) => r.state !== "off" && typeof r.next_fetch_ms === "number" && r.next_fetch_ms <= now)
      .sort((a, b) => Number(a.next_fetch_ms) - Number(b.next_fetch_ms)).slice(0, limit).map((r) => JSON.parse(JSON.stringify(r)) as LinkRow);
  }
  async dropCodes(now: number) {
    for (const c of this.codes.rows.filter((x) => x.expires_ms <= now)) await this.codes.remove({ code_hash: c.code_hash });
    for (const t of this.tries.rows.filter((x) => x.until_ms <= now)) await this.tries.remove({ scope: t.scope });
  }
}

class SupabaseLinkStore implements LinkStore {
  readonly links: Table<LinkRow>;
  readonly codes: Table<LinkCodeRow>;
  readonly tries: Table<LinkTryRow>;
  constructor(private readonly c: SupabaseClient, tables: { links: Table<LinkRow>; codes: Table<LinkCodeRow>; tries: Table<LinkTryRow> }) {
    this.links = tables.links; this.codes = tables.codes; this.tries = tables.tries;
  }
  private fail(what: string, e: { message: string } | null): void { if (e) throw new Error(`calendar links: ${what}: ${e.message}`); }
  async between(userId: string, fromMs: number, toMs: number, limit: number) {
    const { data, error } = await this.c.from("calendar_link_events").select("*").eq("user_id", userId).lt("occurs_ms", toMs).gt("end_ms", fromMs).order("occurs_ms").limit(limit);
    this.fail("read", error);
    return ((data ?? []) as LinkEventRow[]).map(eventRowOf);
  }
  async byRef(userId: string, ref: string) {
    const { data, error } = await this.c.from("calendar_link_events").select("*").eq("user_id", userId).eq("ref", ref).limit(1);
    this.fail("read", error);
    const r = (data ?? [])[0] as LinkEventRow | undefined;
    return r ? eventRowOf(r) : null;
  }
  async sigs(linkId: string) {
    const { data, error } = await this.c.from("calendar_link_events").select("ref,sig").eq("link_id", linkId).limit(ICS_MAX + 500);
    this.fail("read", error);
    return new Map(((data ?? []) as Array<{ ref: string; sig: string }>).map((r) => [r.ref, r.sig]));
  }
  async put(rows: LinkEventRow[]) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.c.from("calendar_link_events").upsert(rows.slice(i, i + 500), { onConflict: "link_id,ref" });
      this.fail("write", error);
    }
  }
  async drop(linkId: string, refs: string[]) {
    for (let i = 0; i < refs.length; i += 200) {
      const { error } = await this.c.from("calendar_link_events").delete().eq("link_id", linkId).in("ref", refs.slice(i, i + 200));
      this.fail("delete", error);
    }
  }
  async dropLink(linkId: string) { const { error } = await this.c.from("calendar_link_events").delete().eq("link_id", linkId); this.fail("delete", error); }
  async dropBefore(ms: number) { const { error } = await this.c.from("calendar_link_events").delete().lt("end_ms", ms); this.fail("delete", error); }
  async due(now: number, limit: number) {
    const { data, error } = await this.c.from("calendar_links").select("*").neq("state", "off").not("next_fetch_ms", "is", null).lte("next_fetch_ms", now).order("next_fetch_ms").limit(limit);
    this.fail("due", error);
    return (data ?? []) as LinkRow[];
  }
  async dropCodes(now: number) {
    const { error } = await this.c.from("plan_link_codes").delete().lte("expires_ms", now);
    this.fail("codes", error);
    const t = await this.c.from("plan_link_tries").delete().lte("until_ms", now);
    this.fail("tries", t.error);
  }
}

/** The server's: Supabase (migration 0071) when the service client exists, else memory. */
export function linkStore(): LinkStore {
  const c = supabase();
  if (!c) return new MemoryLinkStore();
  return new SupabaseLinkStore(c, {
    links: new SupabaseTable<LinkRow>(c, "calendar_links"), codes: new SupabaseTable<LinkCodeRow>(c, "plan_link_codes"), tries: new SupabaseTable<LinkTryRow>(c, "plan_link_tries"),
  });
}
export const memoryLinkStore = (): LinkStore => new MemoryLinkStore();

// ------------------------------------------------------------------ sealing

/** The key the links are sealed under: CONNECTOR_TOKEN_KEY through a labelled HMAC, so it is never the connectors' own key. */
export function linkKey(): Buffer {
  return createHmac("sha256", tokenKey()).update("tailzu:plan:calendar-link:v1").digest();
}
const hashUrl = (url: string): string => createHash("sha256").update(url).digest("hex");
const hashCode = (code: string, key: Buffer): string => createHmac("sha256", key).update(`code:${code}`).digest("hex");

/** A mistake the person can fix, in words; never with the address in it. */
const bad = (message: string) => new BotError("bad_request", message);
export const WORK_OFF = "Can't find it? Your work may have turned this off.";

// ------------------------------------------------------------------ the service

export interface PlanLinksDeps {
  store?: LinkStore;
  now?: () => number;
  /** The guarded fetch (tests hand in their own). */
  fetch?: FetchLike;
  /** The sealing key (tests); the server's is made from CONNECTOR_TOKEN_KEY. */
  key?: Buffer;
  /** A person's days changed (the page reloads; Plan Ease checks for a new clash). */
  changed?: (userId: string, tz: number) => void;
  /** Checked before a link is kept (tests skip the DNS look). */
  check?: (url: string) => Promise<void>;
}

/** What one read came to. */
type ReadResult = { ok: true; changed: boolean; n: number } | { ok: false; stop: boolean; why: string };

export class PlanLinks {
  readonly store: LinkStore;
  private readonly now: () => number;
  private readonly fetchIt: FetchLike;
  private readonly keyGiven: Buffer | null;
  private changedFn: ((userId: string, tz: number) => void) | null;
  private readonly checkUrl: (url: string) => Promise<void>;
  /** A read already running for a link, so two never run at once on this server. */
  private readonly reading = new Map<string, Promise<ReadResult>>();

  constructor(d: PlanLinksDeps = {}) {
    this.store = d.store ?? linkStore();
    this.now = d.now ?? Date.now;
    this.fetchIt = d.fetch ?? egressFetchWith({ timeoutMs: FETCH_TIMEOUT_MS, maxBytes: FETCH_MAX_BYTES });
    this.keyGiven = d.key ?? null;
    this.changedFn = d.changed ?? null;
    this.checkUrl = d.check ?? (async (url) => { await checkPublicUrl(url); });
  }

  onChanged(fn: ((userId: string, tz: number) => void) | null): void { this.changedFn = fn; }

  private key(): Buffer {
    if (this.keyGiven) return this.keyGiven;
    try { return linkKey(); } catch { throw new BotError("links_off", "Linking a calendar isn't set up here yet.", 503); }
  }
  private seal(url: string): string { return encrypt(url, this.key()); }
  private open(enc: string): string { return decrypt(enc, this.key()); }

  private async mine(userId: string): Promise<LinkRow[]> {
    return (await this.store.links.select({ user_id: userId }, { limit: 10 })).map(linkRow).filter((r) => r.state !== "off");
  }

  // ------------------------------------------------------------------ linking

  /** The link pasted on the phone or the window: checked, read once to see it opens, and kept. The same link again is the one kept. */
  async add(userId: string, raw: unknown, tz = 330): Promise<{ link: LinkView; n: number }> {
    const url = linkOf(raw);
    if (!url) throw bad("That doesn't look like a calendar link. Copy the whole link, starting with https or webcal.");
    try { await this.checkUrl(url); } catch { throw bad("That link can't be read from here. Check you copied the whole link."); }
    const hash = hashUrl(url);
    const all = await this.mine(userId);
    const had = all.find((r) => r.url_hash === hash);
    if (!had && all.length >= LINKS_MAX) throw new BotError("links_full", "You have 3 calendars linked. Take one out first.", 409);
    const at = this.now();
    const row: LinkRow = had ?? {
      id: randomUUID(), user_id: userId, provider: providerOf(url), url_enc: this.seal(url), url_hint: hintOf(url), url_hash: hash, state: "ok",
      etag: null, last_modified: null, next_fetch_ms: null, fetched_ms: null, ok_ms: null, failing_ms: null, fails: 0, events: 0, created_ms: at, updated_ms: at,
    };
    // Read it once before keeping it, so a link that doesn't open is said at once, not found out tomorrow.
    const r = await this.readOnce(row, url, tz, { first: !had });
    if (!r.ok) {
      if (!had) throw bad(`That link didn't open. Check you copied the whole link. ${WORK_OFF}`);
      throw bad(`That link still doesn't open. ${WORK_OFF}`);
    }
    return { link: viewOf((await this.store.links.select({ id: row.id }, { limit: 1 }).then((x) => x.map(linkRow)))[0] ?? row), n: r.n };
  }

  /** x0bot.com/cal: the link kept sealed under a new 6-digit code for 15 minutes. Nothing is read until a signed-in phone claims it. */
  async codeFor(raw: unknown): Promise<string> {
    const url = linkOf(raw);
    if (!url) throw bad("That doesn't look like a calendar link. Copy the whole link, starting with https or webcal.");
    const key = this.key();
    const at = this.now();
    for (let i = 0; i < 6; i += 1) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const h = hashCode(code, key);
      const [taken] = await this.store.codes.select({ code_hash: h }, { limit: 1 });
      if (taken && Number(taken.expires_ms) > at) continue;
      if (taken) await this.store.codes.remove({ code_hash: h });
      await this.store.codes.insert({ code_hash: h, url_enc: this.seal(url), tries: 0, expires_ms: at + CODE_MS, created_ms: at });
      return code;
    }
    throw new BotError("busy", "Try again in a minute.", 503);
  }

  /** The scopes a wrong code counts against: the person, where it came from (a keyed hash: never the address), everyone. */
  private scopes(userId: string, from: string | null): Array<{ scope: string; max: number }> {
    const out: Array<{ scope: string; max: number }> = [{ scope: `u:${userId}`.slice(0, 80), max: WRONG_MAX.person }, { scope: "all", max: WRONG_MAX.all }];
    if (from) out.push({ scope: `ip:${hashCode(from, this.key()).slice(0, 40)}`, max: WRONG_MAX.from });
    return out;
  }

  /** A scope's wrong codes this hour (none once its hour is up). */
  private async wrongIn(scope: string, at: number): Promise<number> {
    const [r] = await this.store.tries.select({ scope }, { limit: 1 });
    return r && Number(r.until_ms) > at ? Number(r.n) : 0;
  }

  /** One more wrong code for a scope: changed only if the count is still what was read, so two servers never lose one. */
  private async countWrong(scope: string, at: number): Promise<void> {
    for (let i = 0; i < 6; i += 1) {
      const [r] = await this.store.tries.select({ scope }, { limit: 1 });
      if (!r) {
        try { await this.store.tries.insert({ scope, n: 1, until_ms: at + HOUR }); return; } catch { continue; }
      }
      const live = Number(r.until_ms) > at;
      const moved = await this.store.tries.update({ scope, n: r.n, until_ms: r.until_ms } as Partial<LinkTryRow>,
        live ? { n: Number(r.n) + 1 } : { n: 1, until_ms: at + HOUR });
      if (moved > 0) return;
    }
  }

  /**
   * The phone types the code from x0bot.com/cal: once, within 15 minutes; then it is linked as if pasted here. `from` is the address the
   * request came from, counted (hashed) with the person and with everyone, so guessing a waiting code is stopped long before it works.
   */
  async claim(userId: string, rawCode: unknown, tz = 330, from: string | null = null): Promise<{ link: LinkView; n: number }> {
    const code = typeof rawCode === "string" ? rawCode.replace(/\D/g, "") : "";
    if (code.length !== 6) throw bad("The code is 6 numbers, from x0bot.com/cal on your computer.");
    const at = this.now();
    const scopes = this.scopes(userId, from);
    for (const s of scopes) {
      if (await this.wrongIn(s.scope, at) >= s.max) {
        throw new BotError("too_many", s.scope === "all"
          ? "Codes can't be checked just now. Try again in a little while, or paste the link here."
          : "That's a lot of tries. Paste the link on x0bot.com/cal again in an hour.", 429);
      }
    }
    const h = hashCode(code, this.key());
    const [row] = await this.store.codes.select({ code_hash: h }, { limit: 1 });
    if (!row || Number(row.expires_ms) <= at) {
      if (row) await this.store.codes.remove({ code_hash: h });
      for (const s of scopes) await this.countWrong(s.scope, at).catch(() => undefined);
      throw bad("That code didn't work. Paste the link on x0bot.com/cal again for a new one.");
    }
    // Read once, then gone: a code can never be used twice (the removal is the claim: a second server's claim finds nothing).
    if (!(await this.store.codes.remove({ code_hash: h }))) throw bad("That code didn't work. Paste the link on x0bot.com/cal again for a new one.");
    return this.add(userId, this.open(row.url_enc), tz);
  }

  async remove(userId: string, id: unknown): Promise<void> {
    if (typeof id !== "string" || !id) throw new BotError("not_found", "That calendar isn't linked any more.", 404);
    const [row] = await this.store.links.select({ id, user_id: userId }, { limit: 1 });
    if (!row) throw new BotError("not_found", "That calendar isn't linked any more.", 404);
    await this.store.dropLink(id);
    await this.store.links.remove({ id, user_id: userId });
    livePublish(userId, [botTopic("plan"), TOPIC.home]);
  }

  async list(userId: string): Promise<LinkView[]> {
    return (await this.mine(userId)).map(viewOf);
  }

  // ------------------------------------------------------------------ reading

  /** Reads one link now (a read already running is waited for, not started twice). */
  private readOnce(row: LinkRow, url: string | null, tz: number, o: { first?: boolean } = {}): Promise<ReadResult> {
    const running = this.reading.get(row.id);
    if (running) return running;
    const p = this.read(row, url, tz, o).finally(() => this.reading.delete(row.id));
    this.reading.set(row.id, p);
    return p;
  }

  private async read(row: LinkRow, urlIn: string | null, tz: number, o: { first?: boolean }): Promise<ReadResult> {
    const at = this.now();
    let url: string;
    try { url = urlIn ?? this.open(row.url_enc); } catch { return this.failed(row, at, true, "sealed"); }
    let res: Response;
    try {
      res = await this.fetchIt(url, {
        method: "GET",
        headers: {
          accept: "text/calendar, text/plain;q=0.8, */*;q=0.5", "user-agent": "X0Bot-Calendar/1.0",
          ...(!o.first && row.etag ? { "if-none-match": row.etag } : {}), ...(!o.first && row.last_modified ? { "if-modified-since": row.last_modified } : {}),
        },
      });
    } catch (err) {
      // The guard's refusal or the network's: never the address, only what kind of failure it was.
      return this.failed(row, at, err instanceof EgressRefused && err.reason !== "too_large" && err.reason !== "no_address", err instanceof EgressRefused ? err.reason : "network", o.first);
    }
    if (res.status === 304 && !o.first) {
      await res.body?.cancel().catch(() => undefined);
      await this.store.links.update({ id: row.id }, { fetched_ms: at, ok_ms: at, fails: 0, state: "ok", failing_ms: null, next_fetch_ms: this.nextAt(row.id, at), updated_ms: at });
      return { ok: true, changed: false, n: row.events };
    }
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => undefined);
      return this.failed(row, at, true, String(res.status), o.first);
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return this.failed(row, at, false, String(res.status), o.first);
    }
    let starts: IcsStart[];
    try {
      const text = await res.text();
      starts = readIcs(text, { fromMs: at - BACK_MS, toMs: at + AHEAD_MS, tz, linkId: row.id });
    } catch (err) {
      return this.failed(row, at, false, err instanceof EgressRefused ? err.reason : "unreadable", o.first);
    }
    if (o.first) await this.store.links.upsert({ ...row, updated_ms: at }, ["id"]);
    const changed = await this.keep(row, starts, tz);
    await this.store.links.update({ id: row.id }, {
      fetched_ms: at, ok_ms: at, fails: 0, state: "ok", failing_ms: null, next_fetch_ms: this.nextAt(row.id, at), events: starts.length,
      etag: clip(res.headers.get("etag"), 300), last_modified: clip(res.headers.get("last-modified"), 100), updated_ms: at,
    });
    if (changed || o.first) {
      livePublish(row.user_id, [botTopic("plan"), TOPIC.home]);
      if (changed && !o.first) { try { this.changedFn?.(row.user_id, tz); } catch { /* the page shows it at the next read anyway */ } }
    }
    return { ok: true, changed, n: starts.length };
  }

  /** Writes only what changed since the last read: new and changed meetings, and the ones gone. True when anything did. */
  private async keep(row: LinkRow, starts: IcsStart[], tz: number): Promise<boolean> {
    const had = await this.store.sigs(row.id);
    const seen = new Set<string>();
    const put: LinkEventRow[] = [];
    for (const s of starts) {
      if (seen.has(s.ref)) continue;
      seen.add(s.ref);
      const sig = createHash("sha256").update(JSON.stringify([s.start, s.end, s.allDay, s.title, s.place, s.busy, s.people])).digest("hex").slice(0, 32);
      if (had.get(s.ref) === sig) continue;
      put.push({ link_id: row.id, user_id: row.user_id, ref: s.ref, occurs_ms: s.start, end_ms: s.end, all_day: s.allDay, title: s.title, place: s.place, busy: s.busy, people: s.people, tz_min: tz, sig });
    }
    const gone = [...had.keys()].filter((ref) => !seen.has(ref));
    if (put.length) await this.store.put(put);
    if (gone.length) await this.store.drop(row.id, gone);
    return put.length > 0 || gone.length > 0;
  }

  /** A read that failed: stopped at once (it said no, or the guard refused it), or after the third in a row. Never the address. */
  private async failed(row: LinkRow, at: number, stopNow: boolean, why: string, first = false): Promise<ReadResult> {
    if (first) return { ok: false, stop: stopNow, why };
    const fails = (row.fails ?? 0) + 1;
    const stop = stopNow || fails >= 3;
    await this.store.links.update({ id: row.id }, {
      fetched_ms: at, fails, ...(stop ? { state: "failing" as const, failing_ms: row.failing_ms ?? at } : {}),
      // Stopped: tried again now and then (it may come back: a password changed and changed back), never more than every 2 hours.
      next_fetch_ms: at + (stop ? 2 * HOUR : Math.min(2 * HOUR, EVERY_MS * fails)), updated_ms: at,
    });
    return { ok: false, stop, why };
  }

  /** The next read: 30 minutes on, moved by up to 5 minutes by the link's id, so everyone's links don't all go at once. */
  private nextAt(id: string, at: number): number {
    const spread = parseInt(createHash("sha256").update(id).digest("hex").slice(0, 6), 16) % (5 * MIN);
    return at + EVERY_MS - 2 * MIN + spread;
  }

  /** Every 5 minutes: the links due a read, each claimed by moving its time on (so two servers never read one twice). */
  async tick(limit = 50, tzOf: (userId: string) => Promise<number> = async () => 330): Promise<number> {
    if (!planOn("links")) return 0;
    const at = this.now();
    let n = 0;
    // A code from x0bot.com/cal is held 15 minutes at most: past that it goes, whether or not it was claimed.
    await this.store.dropCodes(at).catch(() => undefined);
    for (const raw of await this.store.due(at, limit)) {
      const row = linkRow(raw);
      const claimed = await this.store.links.update({ id: row.id, next_fetch_ms: row.next_fetch_ms } as Partial<LinkRow>, { next_fetch_ms: at + EVERY_MS });
      if (!claimed) continue;
      await this.readOnce(row, null, await tzOf(row.user_id).catch(() => 330)).catch(() => undefined);
      n += 1;
    }
    return n;
  }

  /** The Plan was opened, or a note is about to be written: a link not read in 10 minutes is read now. */
  async freshen(userId: string, tz: number, waitMs = 1200): Promise<void> {
    if (!planOn("links")) return;
    const at = this.now();
    const stale = (await this.mine(userId)).filter((r) => r.state === "ok" && (r.fetched_ms ?? 0) < at - FRESH_MS);
    if (!stale.length) return;
    const all = Promise.all(stale.map((r) => this.readOnce(r, null, tz).catch(() => undefined)));
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([all, new Promise<void>((res) => { timer = setTimeout(res, waitMs); timer.unref?.(); })]);
    if (timer) clearTimeout(timer);
  }

  /** Nightly: a link stopped for 7 days is taken off with its meetings; codes past their time and meetings over for a week go. */
  async sweep(): Promise<number> {
    const at = this.now();
    let n = 0;
    await this.store.dropCodes(at).catch(() => undefined);
    await this.store.dropBefore(at - BACK_MS).catch(() => undefined);
    for (const raw of await this.store.links.select({ state: "failing" }, { limit: 500 })) {
      const r = linkRow(raw);
      if (r.failing_ms !== null && at - r.failing_ms >= STOPPED_DROP_MS) {
        await this.store.dropLink(r.id).catch(() => undefined);
        await this.store.links.remove({ id: r.id });
        livePublish(r.user_id, [botTopic("plan")]);
        n += 1;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ on the person's days

  /** The meetings in a window, as DayItems: someone else's (fixed), never moved, their source "link". */
  async items(userId: string, w: SourceWindow): Promise<DayItem[]> {
    if (!planOn("links")) return [];
    const links = await this.mine(userId);
    if (!links.length) return [];
    const rows = await this.store.between(userId, w.fromMs - DAY, w.toMs + DAY, ICS_MAX);
    const live = new Set(links.map((l) => l.id));
    return rows.filter((r) => live.has(r.link_id)).map((r) => linkItem(r, w.tz)).filter((it) => it.day >= w.from && it.day <= w.to);
  }

  /** One meeting, for its details. */
  async meeting(userId: string, ref: string, tz: number): Promise<(Omit<DayItem, "people"> & { people: number; provider: LinkRow["provider"] }) | null> {
    if (!/^wk-[A-Za-z0-9_-]{8,30}$/.test(ref)) return null;
    const r = await this.store.byRef(userId, ref);
    if (!r) return null;
    const [l] = await this.store.links.select({ id: r.link_id, user_id: userId }, { limit: 1 });
    if (!l || l.state === "off") return null;
    return { ...linkItem(r, tz), people: r.people, provider: linkRow(l).provider };
  }

  /** What the two cards read: whether the person has a link, and the one that stopped (6 hours or more). */
  async status(userId: string): Promise<LinkStatus> {
    const at = this.now();
    const links = await this.mine(userId).catch(() => [] as LinkRow[]);
    const stopped = links.filter((l) => l.state === "failing" && l.failing_ms !== null && at - l.failing_ms >= STOPPED_TELL_MS)
      .sort((a, b) => Number(a.failing_ms) - Number(b.failing_ms))[0];
    return { links: links.length, stopped: stopped ? { id: stopped.id, since: stopped.failing_ms!, name: nameOf(stopped.provider) } : null };
  }
}

export interface LinkStatus { links: number; stopped: { id: string; since: number; name: string } | null }

const clip = (v: string | null, max: number): string | null => (v && v.length <= max ? v : null);
const NAMES: Record<LinkRow["provider"], string> = { google: "Google Calendar", outlook: "Outlook", icloud: "iPhone (iCloud)", other: "Your calendar" };
const nameOf = (p: LinkRow["provider"]): string => NAMES[p] ?? "Your calendar";
const viewOf = (r: LinkRow): LinkView => ({ id: r.id, provider: r.provider, name: nameOf(r.provider), hint: r.url_hint, stopped: r.state === "failing" });

const dayKey = (ms: number, tz: number): string => new Date(ms + tz * MIN).toISOString().slice(0, 10);

/** A meeting as a DayItem: the work calendar's, so it is fixed (never moved, never offered as free time), and its source says so. */
export function linkItem(r: LinkEventRow, tz: number): DayItem {
  const allDay = r.all_day;
  const day = allDay ? new Date(r.occurs_ms).toISOString().slice(0, 10) : dayKey(r.occurs_ms, tz);
  const where = r.place.split(",")[0]?.trim();
  return {
    ref: "event", id: r.ref, kind: "event", title: r.title || "Busy", day, start: allDay ? null : r.occurs_ms, end: allDay ? null : r.end_ms, allDay,
    ...(where ? { where } : {}), ...(r.place ? { place: r.place } : {}), done: false, fixed: true, source: "link",
    // A meeting marked free holds no time: never a clash, never in the way of a move.
    ...(r.busy ? {} : { free: true }),
  };
}

// ------------------------------------------------------------------ the server's one, and its place on the days

let shared: PlanLinks | null = null;
export function planLinks(): PlanLinks { return (shared ??= new PlanLinks()); }
export function setPlanLinks(p: PlanLinks | null): void { shared = p; }

/** The evening note's line when a link stopped, once for each stop. */
export const STOPPED_LINE = "Your work calendar stopped updating. Link it again in Plan Ease";

/** The skips table's rows (plan_skips: planEase.ts keeps answers there; this keeps the offer's days and the stop's one line). */
type Skip = { [k: string]: unknown; user_id: string; key: string; at_ms: number };

/**
 * The work calendar as a source of the person's days (planSources.ts): its meetings, what its two cards read, its one line in the
 * evening note when it stopped, a read before a note and on a Plan open, and its lines in the chat's list.
 */
export function linkSource(links: () => PlanLinks, skips: () => Table<Skip>, tzOf: (userId: string) => Promise<number> = async () => 330): PlanSource {
  const has = async (userId: string, key: string) => (await skips().select({ user_id: userId, key }, { limit: 1 }).catch(() => [])).length > 0;
  const mark = (userId: string, key: string, at: number) => skips().upsert({ user_id: userId, key, at_ms: at }, ["user_id", "key"]).catch(() => undefined);
  return {
    name: "links",
    items: (userId, w) => links().items(userId, w),
    more: (userId) => (planOn("links") ? links().status(userId) : Promise.resolve({ links: 0, stopped: null } as LinkStatus)),
    async evening(userId, w) {
      if (!planOn("links")) return [];
      const s = await links().status(userId);
      if (!s.stopped) return [];
      const key = `linkStopped:told:${s.stopped.id}:${s.stopped.since}`;
      if (await has(userId, key)) return [];
      await mark(userId, key, w.now);
      return [STOPPED_LINE];
    },
    async beforeNote(userId) {
      if (!planOn("links")) return;
      await links().freshen(userId, await tzOf(userId).catch(() => 330), 6000);
    },
    async seen(userId, tz, now) {
      if (!planOn("links")) return;
      const s = await links().status(userId);
      if (s.links > 0) { await links().freshen(userId, tz); return; }
      // The days Plan Ease was opened with no link, up to the third: the offer comes on that day (planInCards.ts).
      const days = (await skips().select({ user_id: userId }, { limit: 500 }).catch(() => [] as Skip[])).filter((k) => k.key.startsWith(LINK_SEEN));
      const today = todayKey(now, tz);
      if (days.length < OFFER_AFTER_DAYS && !days.some((k) => k.key === `${LINK_SEEN}${today}`)) await mark(userId, `${LINK_SEEN}${today}`, now);
    },
    async lines(userId, w) {
      const items = await links().items(userId, w);
      return items.map((it) => `- ${it.day}${it.allDay || it.start === null ? ", all day" : `, ${clockLine(it.start, w.tz)}–${clockLine(it.end ?? it.start, w.tz)}`}: ${it.title}${it.where ? ` (${it.where})` : ""} (from their work calendar; read only, change it there)`);
    },
  };
}

const clockLine = (ms: number, tz: number): string => { const d = new Date(ms + tz * MIN); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

/** The work calendar on the person's days, once at start (the server's plan_skips unless a test hands in its own). */
export function plugLinks(skips?: () => Table<Skip>, tzOf?: (userId: string) => Promise<number>): void {
  addPlanSource(linkSource(planLinks, skips ?? (() => table<Skip>("plan_skips")), tzOf));
}

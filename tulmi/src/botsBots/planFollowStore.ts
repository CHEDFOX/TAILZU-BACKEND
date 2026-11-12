/**
 * FOLLOW-THROUGH'S TABLES (migration 0081_plan_follows.sql), in memory or in Supabase.
 *
 *   follows    one row per followed occurrence: who holds it, the climb (n, rung), when the sweep acts next, every answer
 *   steps      what was sent to whom on which channel, and what came of it: "never twice" (unique follow, n, rung, person) and the
 *              asker's view
 *   caps       the day's louder pings and calls per person, real calls per person, per asker and for the server, shared by every server
 *   numbers    the number an asker keeps for someone on their items, sealed: only their own Call button (X0 never dials it)
 *   phones     a person's own number for real phone calls, which they turned on themselves (the phone channel, Backend B, writes it):
 *              one account per number once proved
 *   phoneStops numbers whose owner pressed 9 (by keyed hash): no real call to them, whichever account adds them, until a fresh proving call
 *
 * Bigints may come back as strings: each row is read through its own `...RowOf`. Every write to a follow after its insert is a
 * compare-and-swap on `updated_ms` (planFollow.ts), never on a null or a jsonb column. The memory twins keep the unique keys the
 * migration has, so a test sees a second server's insert fail the way Supabase's does.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { MemoryTable, SupabaseTable, type Row, type Table } from "./rows.js";
import type {
  FollowAnswer, FollowKind, FollowPerson, FollowRung, FollowState, FollowVia, MustWhy, StepChannel, StepRung, StepState,
} from "./planFollowWords.js";

// ------------------------------------------------------------------ the rows

export interface FollowRow {
  [k: string]: unknown;
  id: string; user_id: string; item: string; source_key: string; kind: FollowKind; title: string; place: string;
  importance: "normal" | "must"; why: MustWhy | "set" | null; due_ms: number | null; day: string; tz_min: number;
  people: FollowPerson[]; holder: number; holder_key: string; cant: string[]; told: string[]; answers: FollowAnswer[];
  state: FollowState; rung: FollowRung; n: number; laters: number; base_ms: number; climb_ms: number; next_ms: number | null;
  done_by: FollowPerson | null; done_via: FollowVia | null; done_ms: number | null; created_ms: number; updated_ms: number;
}
export interface StepRow {
  [k: string]: unknown;
  id: string; follow_id: string; user_id: string; n: number; rung: StepRung; person: string; channel: StepChannel; state: StepState;
  why: string | null; ext: string | null; at_ms: number; seen_ms: number | null;
}
export interface CapRow { [k: string]: unknown; person: string; day: string; n: number }
/** plan_numbers: the asker's own number for someone on their items (their Call button). */
export interface NumberRow { [k: string]: unknown; user_id: string; member_id: string; seal: string; updated_ms: number }
/** plan_phones: a person's own number for real phone calls (the phone channel, Backend B, writes it; the ladder only reads `verified_ms`). */
export interface PhoneRow {
  [k: string]: unknown;
  user_id: string; seal: string | null; hash: string | null; verified_ms: number | null; pending_hash: string | null;
  pending_until_ms: number | null;
  /** The short code the setup screen shows while the number waits, sealed: the proving call types it, so one call proves one account. */
  pending_code?: string | null;
  stopped_ms: number | null; consent: Array<{ v: number; at: number; how: string }>;
  created_ms: number; updated_ms: number;
}
/** plan_phone_stops: a number whose owner pressed 9, by keyed hash. Adding it again never lifts it; only a fresh proving call does. */
export interface PhoneStopRow { [k: string]: unknown; hash: string; stopped_ms: number }

const num = (v: unknown, d = 0): number => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function peopleOf(v: unknown): FollowPerson[] {
  if (!Array.isArray(v)) return [];
  const out: FollowPerson[] = [];
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (o.k !== "u" || typeof o.id !== "string") continue;
    out.push({ k: "u", id: o.id, name: typeof o.name === "string" ? o.name : "" });
  }
  return out;
}

/** A follow as it was read, in its own types. */
export function followRowOf(r: Record<string, unknown>): FollowRow {
  const doneBy = r.done_by && typeof r.done_by === "object" ? peopleOf([r.done_by])[0] ?? null : null;
  return {
    ...(r as FollowRow),
    place: typeof r.place === "string" ? r.place : "",
    why: (typeof r.why === "string" ? r.why : null) as FollowRow["why"],
    due_ms: numOrNull(r.due_ms), tz_min: num(r.tz_min, 330),
    people: peopleOf(r.people), holder: num(r.holder), cant: strings(r.cant), told: strings(r.told),
    answers: Array.isArray(r.answers) ? (r.answers as FollowAnswer[]).filter((a) => a && typeof a === "object").map((a) => ({ ...a, at: num(a.at), n: num(a.n, 1) })) : [],
    n: num(r.n, 1), laters: num(r.laters), base_ms: num(r.base_ms), climb_ms: num(r.climb_ms), next_ms: numOrNull(r.next_ms),
    done_by: doneBy, done_via: (strOrNull(r.done_via) as FollowVia | null), done_ms: numOrNull(r.done_ms),
    created_ms: num(r.created_ms), updated_ms: num(r.updated_ms),
  };
}

export function stepRowOf(r: Record<string, unknown>): StepRow {
  return { ...(r as StepRow), n: num(r.n, 1), why: strOrNull(r.why), ext: strOrNull(r.ext), at_ms: num(r.at_ms), seen_ms: numOrNull(r.seen_ms) };
}

export function phoneRowOf(r: Record<string, unknown>): PhoneRow {
  return {
    ...(r as PhoneRow), seal: strOrNull(r.seal), hash: strOrNull(r.hash), verified_ms: numOrNull(r.verified_ms),
    pending_hash: strOrNull(r.pending_hash), pending_until_ms: numOrNull(r.pending_until_ms), pending_code: strOrNull(r.pending_code), stopped_ms: numOrNull(r.stopped_ms),
    consent: Array.isArray(r.consent) ? (r.consent as PhoneRow["consent"]) : [], created_ms: num(r.created_ms), updated_ms: num(r.updated_ms),
  };
}

// ------------------------------------------------------------------ the tables

export interface FollowTable extends Table<FollowRow> {
  due(now: number, limit: number): Promise<FollowRow[]>;                     // state in open|snoozed|told|nobody, next_ms <= now, soonest first
  forHolder(key: string, limit: number): Promise<FollowRow[]>;               // holder_key = key, state in open|snoozed|told
  forAsker(userId: string, since: number, limit: number): Promise<FollowRow[]>; // user_id, updated_ms >= since, newest first
  ofItem(userId: string, item: string, limit: number): Promise<FollowRow[]>; // newest first
  clean(before: number): Promise<void>;                                      // closed and updated_ms < before
  /** Follows said done since `since`, across everyone (the hourly repair of a close cut short: planFollow.ts). */
  doneSince(since: number, limit: number): Promise<FollowRow[]>;
  /** Other people's follows with this person on them (their account is being deleted: planFollow.ts forget). */
  withPerson(userId: string, limit: number): Promise<FollowRow[]>;
}
export interface StepTable extends Table<StepRow> { byExt(ext: string): Promise<StepRow[]> }
export interface CapTable extends Table<CapRow> { clean(beforeDay: string): Promise<void> }
export type NumberTable = Table<NumberRow>;
export interface PhoneTable extends Table<PhoneRow> {
  byHash(hash: string, limit: number): Promise<PhoneRow[]>;
  byPendingHash(hash: string, now: number, limit: number): Promise<PhoneRow[]>;   // pending_hash = hash and pending_until_ms > now
}
export type PhoneStopTable = Table<PhoneStopRow>;
export interface FollowStores { follows: FollowTable; steps: StepTable; caps: CapTable; numbers: NumberTable; phones: PhoneTable; phoneStops: PhoneStopTable }

const OPEN = ["open", "snoozed", "told", "nobody"];
const HELD = ["open", "snoozed", "told"];
const CLOSED = ["done", "missed", "dropped"];
const copy = <R>(r: R): R => JSON.parse(JSON.stringify(r)) as R;

/** A memory table that refuses a second row with the same `keys`, as the migration's unique constraint does (rows.ts error words). */
class UniqueMemoryTable<R extends Row> extends MemoryTable<R> {
  constructor(private readonly keys: Array<keyof R & string>, private readonly name: string) { super(); }
  override async insert(row: R): Promise<R> {
    if (this.rows.some((r) => this.keys.every((k) => r[k] === row[k]))) {
      throw new Error(`bots area: ${this.name} insert: duplicate key value violates unique constraint "${this.name}_unique"`);
    }
    return super.insert(row);
  }
}

class MemoryFollows extends UniqueMemoryTable<FollowRow> implements FollowTable {
  constructor() { super(["user_id", "source_key"], "plan_follows"); }
  async due(now: number, limit: number) {
    return this.rows.filter((r) => OPEN.includes(r.state) && typeof r.next_ms === "number" && r.next_ms <= now)
      .sort((a, b) => Number(a.next_ms) - Number(b.next_ms)).slice(0, limit).map(copy);
  }
  async forHolder(key: string, limit: number) {
    return this.rows.filter((r) => r.holder_key === key && HELD.includes(r.state)).sort((a, b) => b.updated_ms - a.updated_ms).slice(0, limit).map(copy);
  }
  async forAsker(userId: string, since: number, limit: number) {
    return this.rows.filter((r) => r.user_id === userId && r.updated_ms >= since).sort((a, b) => b.updated_ms - a.updated_ms).slice(0, limit).map(copy);
  }
  async ofItem(userId: string, item: string, limit: number) {
    return this.rows.filter((r) => r.user_id === userId && r.item === item).sort((a, b) => b.created_ms - a.created_ms).slice(0, limit).map(copy);
  }
  async clean(before: number) {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) if (CLOSED.includes(this.rows[i]!.state) && this.rows[i]!.updated_ms < before) this.rows.splice(i, 1);
  }
  async doneSince(since: number, limit: number) {
    return this.rows.filter((r) => r.state === "done" && typeof r.done_ms === "number" && r.done_ms >= since).slice(0, limit).map(copy);
  }
  async withPerson(userId: string, limit: number) {
    return this.rows.filter((r) => r.people.some((p) => p.id === userId)).slice(0, limit).map(copy);
  }
}

class MemorySteps extends UniqueMemoryTable<StepRow> implements StepTable {
  constructor() { super(["follow_id", "n", "rung", "person"], "plan_follow_steps"); }
  async byExt(ext: string) { return this.rows.filter((r) => r.ext === ext).map(copy); }
  /** Steps go with their follow (on delete cascade). */
  dropFor(followIds: Set<string>) { for (let i = this.rows.length - 1; i >= 0; i -= 1) if (followIds.has(this.rows[i]!.follow_id)) this.rows.splice(i, 1); }
}

class MemoryCaps extends UniqueMemoryTable<CapRow> implements CapTable {
  constructor() { super(["person", "day"], "plan_reach_caps"); }
  async clean(beforeDay: string) { for (let i = this.rows.length - 1; i >= 0; i -= 1) if (String(this.rows[i]!.day) < beforeDay) this.rows.splice(i, 1); }
}

class MemoryPhones extends UniqueMemoryTable<PhoneRow> implements PhoneTable {
  constructor() { super(["user_id"], "plan_phones"); }
  async byHash(hash: string, limit: number) { return this.rows.filter((r) => r.hash === hash).slice(0, limit).map(copy); }
  async byPendingHash(hash: string, now: number, limit: number) {
    return this.rows.filter((r) => r.pending_hash === hash && typeof r.pending_until_ms === "number" && r.pending_until_ms > now).slice(0, limit).map(copy);
  }
}

const fail = (table: string, what: string, error: { message: string }): never => { throw new Error(`follow: ${table} ${what}: ${error.message}`); };
const many = <R>(data: unknown, of: (r: Record<string, unknown>) => R): R[] => ((data ?? []) as Array<Record<string, unknown>>).map(of);

class SupabaseFollows extends SupabaseTable<FollowRow> implements FollowTable {
  constructor(private readonly c: SupabaseClient) { super(c, "plan_follows"); }
  async due(now: number, limit: number) {
    const { data, error } = await this.c.from("plan_follows").select("*").in("state", OPEN).not("next_ms", "is", null).lte("next_ms", now).order("next_ms").limit(limit);
    if (error) fail("plan_follows", "due", error);
    return many(data, followRowOf);
  }
  async forHolder(key: string, limit: number) {
    const { data, error } = await this.c.from("plan_follows").select("*").eq("holder_key", key).in("state", HELD).order("updated_ms", { ascending: false }).limit(limit);
    if (error) fail("plan_follows", "holder", error);
    return many(data, followRowOf);
  }
  async forAsker(userId: string, since: number, limit: number) {
    const { data, error } = await this.c.from("plan_follows").select("*").eq("user_id", userId).gte("updated_ms", since).order("updated_ms", { ascending: false }).limit(limit);
    if (error) fail("plan_follows", "asker", error);
    return many(data, followRowOf);
  }
  async ofItem(userId: string, item: string, limit: number) {
    const { data, error } = await this.c.from("plan_follows").select("*").eq("user_id", userId).eq("item", item).order("created_ms", { ascending: false }).limit(limit);
    if (error) fail("plan_follows", "item", error);
    return many(data, followRowOf);
  }
  async clean(before: number) {
    const { error } = await this.c.from("plan_follows").delete().in("state", CLOSED).lt("updated_ms", before);
    if (error) fail("plan_follows", "clean", error);
  }
  async doneSince(since: number, limit: number) {
    const { data, error } = await this.c.from("plan_follows").select("*").eq("state", "done").gte("done_ms", since).order("done_ms", { ascending: false }).limit(limit);
    if (error) fail("plan_follows", "done", error);
    return many(data, followRowOf);
  }
  async withPerson(userId: string, limit: number) {
    // jsonb containment (people @> '[{"id": ...}]'), given as text so PostgREST reads it as JSON, not as a Postgres array.
    const { data, error } = await this.c.from("plan_follows").select("*").contains("people", JSON.stringify([{ id: userId }])).limit(limit);
    if (error) fail("plan_follows", "person", error);
    return many(data, followRowOf);
  }
}

class SupabaseSteps extends SupabaseTable<StepRow> implements StepTable {
  constructor(private readonly c: SupabaseClient) { super(c, "plan_follow_steps"); }
  async byExt(ext: string) {
    const { data, error } = await this.c.from("plan_follow_steps").select("*").eq("ext", ext).limit(20);
    if (error) fail("plan_follow_steps", "ext", error);
    return many(data, stepRowOf);
  }
}

class SupabaseCaps extends SupabaseTable<CapRow> implements CapTable {
  constructor(private readonly c: SupabaseClient) { super(c, "plan_reach_caps"); }
  async clean(beforeDay: string) {
    const { error } = await this.c.from("plan_reach_caps").delete().lt("day", beforeDay);
    if (error) fail("plan_reach_caps", "clean", error);
  }
}

class SupabasePhones extends SupabaseTable<PhoneRow> implements PhoneTable {
  constructor(private readonly c: SupabaseClient) { super(c, "plan_phones"); }
  async byHash(hash: string, limit: number) {
    const { data, error } = await this.c.from("plan_phones").select("*").eq("hash", hash).limit(limit);
    if (error) fail("plan_phones", "hash", error);
    return many(data, phoneRowOf);
  }
  async byPendingHash(hash: string, now: number, limit: number) {
    const { data, error } = await this.c.from("plan_phones").select("*").eq("pending_hash", hash).gt("pending_until_ms", now).limit(limit);
    if (error) fail("plan_phones", "pending", error);
    return many(data, phoneRowOf);
  }
}

/** Fresh memory tables (tests). Closing a follow's rows in memory takes its steps with it, as the cascade does. */
export function memoryFollowStores(): FollowStores {
  const follows = new MemoryFollows();
  const steps = new MemorySteps();
  const clean = follows.clean.bind(follows);
  follows.clean = async (before: number) => {
    const had = new Set(follows.rows.map((r) => r.id));
    await clean(before);
    for (const r of follows.rows) had.delete(r.id);
    steps.dropFor(had);
  };
  return {
    follows, steps, caps: new MemoryCaps(), numbers: new UniqueMemoryTable<NumberRow>(["user_id", "member_id"], "plan_numbers"), phones: new MemoryPhones(),
    phoneStops: new UniqueMemoryTable<PhoneStopRow>(["hash"], "plan_phone_stops"),
  };
}

let made: FollowStores | null = null;
/** Supabase (SupabaseTable over each table) when supabase() exists, else memory; made once. */
export function followStores(): FollowStores {
  if (!made) {
    const c = supabase();
    made = c
      ? {
        follows: new SupabaseFollows(c), steps: new SupabaseSteps(c), caps: new SupabaseCaps(c),
        numbers: new SupabaseTable<NumberRow>(c, "plan_numbers"), phones: new SupabasePhones(c),
        phoneStops: new SupabaseTable<PhoneStopRow>(c, "plan_phone_stops"),
      }
      : memoryFollowStores();
  }
  return made;
}
export function resetFollowStoresForTests(): void { made = null; }

/** A unique-key error from either twin (rows.ts passes Supabase's message through). */
export const isDuplicate = (err: unknown): boolean => /duplicate key|unique constraint/i.test(String((err as Error)?.message ?? ""));

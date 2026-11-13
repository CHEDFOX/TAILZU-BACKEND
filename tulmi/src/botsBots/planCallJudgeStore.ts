/**
 * THE CALL JUDGE'S TABLE (migration 0086_plan_call_judge.sql), in memory or in Supabase, and the two reads it needs across people.
 *
 *   judgementStore()          -> the table: select / insert / update / remove / upsert (rows.ts's shape) plus
 *     dueRings(now, limit)      rows whose next judged ring is due, soonest first
 *     retryable(before, limit)  failed judgements (under 3 tries) untouched since `before`
 *     clean(before)             done, gone and past rows untouched since `before`, deleted: how many
 *     upcoming(from, to, limit) the items that start or fall due in the window, across everyone (the fill)
 *
 * A row is the verdict and a hash, never the item. Written by the server with the service key only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { calendarRows, memoryCalendarRows, type CalendarRows } from "../calendar/store.js";
import { dayOf, shiftDay } from "../calendar/words.js";
import { MemoryTable, SupabaseTable, type Table } from "./rows.js";

export type JudgeState = "judging" | "set" | "off" | "failed" | "done" | "gone" | "past";

export interface JudgementRow {
  [k: string]: unknown;
  user_id: string;
  /** "e:<event row id>" (a series once) | "t:<task id>". */
  item: string;
  sig: string;
  state: JudgeState;
  call: boolean;
  at: string | null;
  why: string;
  usd: number;
  tries: number;
  next_ring_ms: number | null;
  ring_key: string | null;
  changed_ms: number;
  judged_ms: number | null;
  updated_ms: number;
}

/** One item an upcoming read found: whose it is and which row; `updated` is when it last changed (the fill skips what is judged). */
export interface Upcoming { userId: string; kind: "event" | "task"; id: string; updated: number }

export interface JudgementStore extends Table<JudgementRow> {
  dueRings(now: number, limit: number): Promise<JudgementRow[]>;
  retryable(before: number, limit: number): Promise<JudgementRow[]>;
  clean(before: number): Promise<number>;
  upcoming(from: number, to: number, limit: number): Promise<Upcoming[]>;
}

const num = (v: unknown, d = 0): number => (v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** A row as it was read (bigints and numerics may come back as strings), in its own types. */
export function judgementRow(r: JudgementRow): JudgementRow {
  return {
    ...r, call: r.call === true, at: typeof r.at === "string" ? r.at : null, why: typeof r.why === "string" ? r.why : "",
    usd: num(r.usd), tries: num(r.tries), next_ring_ms: numOrNull(r.next_ring_ms), ring_key: typeof r.ring_key === "string" ? r.ring_key : null,
    changed_ms: num(r.changed_ms), judged_ms: numOrNull(r.judged_ms), updated_ms: num(r.updated_ms),
  };
}

/** The window's events and to-dos, in days: a to-do is due on a day, not at an instant, so the days around the window are read. */
const dayKeys = (from: number, to: number): [string, string] => [shiftDay(dayOf(from, 0), -1), shiftDay(dayOf(to, 0), 1)];

// ------------------------------------------------------------------ memory

/** A memory table's rows (the calendar's own, in tests and on a server with no Supabase). */
const rowsOf = (t: unknown): Array<Record<string, unknown>> => ((t as { rows?: Array<Record<string, unknown>> }).rows ?? []);

class MemoryJudgements extends MemoryTable<JudgementRow> implements JudgementStore {
  constructor(private readonly cal: CalendarRows) { super(); }

  /** The primary key (person, item) is unique, as in the table: a second insert of it fails, which is how a claim is lost. */
  override async insert(row: JudgementRow): Promise<JudgementRow> {
    if (this.rows.some((r) => r.user_id === row.user_id && r.item === row.item)) throw new Error("duplicate key value violates unique constraint");
    return super.insert(row);
  }

  async dueRings(now: number, limit: number): Promise<JudgementRow[]> {
    return this.rows.filter((r) => r.next_ring_ms !== null && r.next_ring_ms !== undefined && r.next_ring_ms <= now)
      .sort((a, b) => Number(a.next_ring_ms) - Number(b.next_ring_ms)).slice(0, limit).map((r) => judgementRow(JSON.parse(JSON.stringify(r)) as JudgementRow));
  }

  async retryable(before: number, limit: number): Promise<JudgementRow[]> {
    return this.rows.filter((r) => r.state === "failed" && r.tries < 3 && r.updated_ms <= before)
      .sort((a, b) => a.updated_ms - b.updated_ms).slice(0, limit).map((r) => judgementRow(JSON.parse(JSON.stringify(r)) as JudgementRow));
  }

  async clean(before: number): Promise<number> {
    const n = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const r = this.rows[i]!;
      if ((r.state === "done" || r.state === "gone" || r.state === "past") && r.updated_ms < before) this.rows.splice(i, 1);
    }
    return n - this.rows.length;
  }

  async upcoming(from: number, to: number, limit: number): Promise<Upcoming[]> {
    const [d0, d1] = dayKeys(from, to);
    const out: Upcoming[] = [];
    for (const r of rowsOf(this.cal.events)) {
      const series = !!r.repeat && (r.repeat_until === null || r.repeat_until === undefined || Number(r.repeat_until) >= from);
      const one = !r.repeat && Number(r.start_ms) >= from && Number(r.start_ms) < to;
      if (series || one) out.push({ userId: String(r.user_id), kind: "event", id: String(r.id), updated: Number(r.updated_ms) });
    }
    for (const r of rowsOf(this.cal.tasks)) {
      const day = typeof r.due_day === "string" ? r.due_day : null;
      if (r.done !== true && day !== null && day >= d0 && day <= d1) out.push({ userId: String(r.user_id), kind: "task", id: String(r.id), updated: Number(r.updated_ms) });
    }
    return out.slice(0, limit);
  }
}

// ------------------------------------------------------------------ Supabase

const NAME = "plan_call_judgements";
const fail = (what: string, error: { message: string }): never => { throw new Error(`call judge: ${what}: ${error.message}`); };

class SupabaseJudgements extends SupabaseTable<JudgementRow> implements JudgementStore {
  constructor(private readonly client: SupabaseClient) { super(client, NAME); }

  async dueRings(now: number, limit: number): Promise<JudgementRow[]> {
    const { data, error } = await this.client.from(NAME).select("*").not("next_ring_ms", "is", null).lte("next_ring_ms", now).order("next_ring_ms").limit(limit);
    if (error) fail("due read", error);
    return ((data ?? []) as JudgementRow[]).map(judgementRow);
  }

  async retryable(before: number, limit: number): Promise<JudgementRow[]> {
    const { data, error } = await this.client.from(NAME).select("*").eq("state", "failed").lt("tries", 3).lte("updated_ms", before).order("updated_ms").limit(limit);
    if (error) fail("retry read", error);
    return ((data ?? []) as JudgementRow[]).map(judgementRow);
  }

  async clean(before: number): Promise<number> {
    const { data, error } = await this.client.from(NAME).delete().in("state", ["done", "gone", "past"]).lt("updated_ms", before).select("item");
    if (error) fail("clean", error);
    return (data ?? []).length;
  }

  async upcoming(from: number, to: number, limit: number): Promise<Upcoming[]> {
    const [d0, d1] = dayKeys(from, to);
    const one = this.client.from("calendar_events").select("id,user_id,updated_ms").eq("repeat", "").gte("start_ms", from).lt("start_ms", to).limit(limit);
    const series = this.client.from("calendar_events").select("id,user_id,updated_ms").neq("repeat", "").or(`repeat_until.is.null,repeat_until.gte.${from}`).limit(limit);
    const tasks = this.client.from("calendar_tasks").select("id,user_id,updated_ms").eq("done", false).gte("due_day", d0).lte("due_day", d1).limit(limit);
    const [a, b, c] = await Promise.all([one, series, tasks]);
    if (a.error) fail("events read", a.error);
    if (b.error) fail("series read", b.error);
    if (c.error) fail("tasks read", c.error);
    const pick = (kind: "event" | "task") => (r: { id: string; user_id: string; updated_ms: unknown }): Upcoming => ({ userId: r.user_id, kind, id: r.id, updated: num(r.updated_ms) });
    return [...(a.data ?? []).map(pick("event")), ...(b.data ?? []).map(pick("event")), ...(c.data ?? []).map(pick("task"))].slice(0, limit);
  }
}

// ------------------------------------------------------------------ the ones the server uses

let shared: JudgementStore | null = null;

/** The server's table: Supabase when the service client exists, else memory over the calendar's own rows. */
export function judgementStore(): JudgementStore {
  if (!shared) {
    const sb = supabase();
    shared = sb ? new SupabaseJudgements(sb) : new MemoryJudgements(calendarRows());
  }
  return shared;
}

/** A fresh one in memory, reading `cal` for its upcoming items (tests). */
export function memoryJudgementStore(cal: CalendarRows = memoryCalendarRows()): JudgementStore { return new MemoryJudgements(cal); }

/** Tests: forget the shared table. */
export function resetJudgementStoreForTests(): void { shared = null; }

/**
 * TAILZU'S OWN CALENDAR: ITS TWO TABLES (migration 0054_own_calendar.sql), in memory or in Supabase.
 *
 *   calendarRows()   -> { events, tasks }: select / insert / update / remove / upsert (rows.ts's shape) plus the reads a calendar needs:
 *     events.overlapping(user, fromMs, toMs)   single events that overlap the range, and every series that started before its end
 *     tasks.between(user, fromKey, toKey)      to-dos due on those days (done or not)
 *     tasks.open(user)                         to-dos not done yet, with a day or without
 *     *.due(nowMs, limit)                      rows whose next reminder is due, across everyone (the reminder sweep)
 *
 * A row's fields are its column names; times are epoch milliseconds (bigint), lists and the source are jsonb. Written by the server
 * with the service key; every read and write here is already narrowed to the signed-in person by the caller (user_id in the match).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { MemoryTable, SupabaseTable, type Table } from "../botsBots/rows.js";
import type { Repeat } from "./words.js";

/** Where a thing came from: the person, a bot, someone in a space, or a meeting's to-do. */
export type Source =
  | { kind: "me" }
  | { kind: "bot"; name: string }
  | { kind: "space"; spaceId: string; taskId: string; by: string; name: string; space: string }
  | { kind: "note"; noteId: string; todoId: string; title: string };

export interface EventRow {
  [k: string]: unknown;
  id: string; user_id: string; title: string; notes: string; place: string;
  start_ms: number; end_ms: number; all_day: boolean; tz_min: number;
  repeat: Repeat; repeat_until: number | null; skips: string[];
  remind_min: number | null; next_remind_ms: number | null;
  source: Source; source_key: string | null;
  created_ms: number; updated_ms: number;
}

export interface TaskRow {
  [k: string]: unknown;
  id: string; user_id: string; title: string; notes: string; list: string;
  due_day: string | null; due_ms: number | null; tz_min: number;
  done: boolean; done_ms: number | null;
  remind_min: number | null; next_remind_ms: number | null;
  source: Source; source_key: string | null;
  created_ms: number; updated_ms: number;
}

export interface EventTable extends Table<EventRow> {
  overlapping(userId: string, fromMs: number, toMs: number, limit: number): Promise<EventRow[]>;
  due(nowMs: number, limit: number): Promise<EventRow[]>;
}
export interface TaskTable extends Table<TaskRow> {
  between(userId: string, fromKey: string, toKey: string, limit: number): Promise<TaskRow[]>;
  open(userId: string, limit: number): Promise<TaskRow[]>;
  due(nowMs: number, limit: number): Promise<TaskRow[]>;
}
export interface CalendarRows { events: EventTable; tasks: TaskTable }

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Supabase hands bigints back as numbers or strings: one shape either way. */
export function eventRow(r: EventRow): EventRow {
  return {
    ...r, start_ms: num(r.start_ms), end_ms: num(r.end_ms), tz_min: num(r.tz_min), repeat_until: numOrNull(r.repeat_until),
    remind_min: numOrNull(r.remind_min), next_remind_ms: numOrNull(r.next_remind_ms), created_ms: num(r.created_ms), updated_ms: num(r.updated_ms),
    skips: Array.isArray(r.skips) ? r.skips : [], repeat: (r.repeat ?? "") as Repeat, all_day: r.all_day === true,
    source: r.source && typeof r.source === "object" ? r.source : { kind: "me" },
  };
}
export function taskRow(r: TaskRow): TaskRow {
  return {
    ...r, due_ms: numOrNull(r.due_ms), tz_min: num(r.tz_min), done: r.done === true, done_ms: numOrNull(r.done_ms), remind_min: numOrNull(r.remind_min),
    next_remind_ms: numOrNull(r.next_remind_ms), created_ms: num(r.created_ms), updated_ms: num(r.updated_ms), list: r.list ?? "",
    source: r.source && typeof r.source === "object" ? r.source : { kind: "me" },
  };
}

// ------------------------------------------------------------------ memory

class MemoryEvents extends MemoryTable<EventRow> implements EventTable {
  async overlapping(userId: string, fromMs: number, toMs: number, limit: number): Promise<EventRow[]> {
    return (await this.select({ user_id: userId }, { order: "start_ms" }))
      .filter((r) => r.start_ms < toMs && (r.repeat ? true : r.end_ms > fromMs)).slice(0, limit);
  }
  async due(nowMs: number, limit: number): Promise<EventRow[]> {
    return this.rows.filter((r) => r.next_remind_ms !== null && r.next_remind_ms !== undefined && r.next_remind_ms <= nowMs)
      .sort((a, b) => Number(a.next_remind_ms) - Number(b.next_remind_ms)).slice(0, limit).map((r) => JSON.parse(JSON.stringify(r)) as EventRow);
  }
}

class MemoryTasks extends MemoryTable<TaskRow> implements TaskTable {
  async between(userId: string, fromKey: string, toKey: string, limit: number): Promise<TaskRow[]> {
    return (await this.select({ user_id: userId })).filter((r) => r.due_day !== null && r.due_day >= fromKey && r.due_day <= toKey)
      .sort((a, b) => String(a.due_day).localeCompare(String(b.due_day)) || Number(a.due_ms ?? 0) - Number(b.due_ms ?? 0)).slice(0, limit);
  }
  async open(userId: string, limit: number): Promise<TaskRow[]> {
    return (await this.select({ user_id: userId, done: false }, { order: "created_ms" })).slice(0, limit);
  }
  async due(nowMs: number, limit: number): Promise<TaskRow[]> {
    return this.rows.filter((r) => r.next_remind_ms !== null && r.next_remind_ms !== undefined && r.next_remind_ms <= nowMs)
      .sort((a, b) => Number(a.next_remind_ms) - Number(b.next_remind_ms)).slice(0, limit).map((r) => JSON.parse(JSON.stringify(r)) as TaskRow);
  }
}

// ------------------------------------------------------------------ Supabase

const fail = (table: string, error: { message: string }): never => { throw new Error(`calendar: ${table} read: ${error.message}`); };

class SupabaseEvents extends SupabaseTable<EventRow> implements EventTable {
  constructor(private readonly client: SupabaseClient) { super(client, "calendar_events"); }
  async overlapping(userId: string, fromMs: number, toMs: number, limit: number): Promise<EventRow[]> {
    const one = this.client.from("calendar_events").select("*").eq("user_id", userId).eq("repeat", "").lt("start_ms", toMs).gt("end_ms", fromMs).order("start_ms").limit(limit);
    const series = this.client.from("calendar_events").select("*").eq("user_id", userId).neq("repeat", "").lt("start_ms", toMs).order("start_ms").limit(limit);
    const [a, b] = await Promise.all([one, series]);
    if (a.error) fail("calendar_events", a.error);
    if (b.error) fail("calendar_events", b.error);
    return [...(a.data ?? []), ...(b.data ?? [])] as EventRow[];
  }
  async due(nowMs: number, limit: number): Promise<EventRow[]> {
    const { data, error } = await this.client.from("calendar_events").select("*").not("next_remind_ms", "is", null).lte("next_remind_ms", nowMs).order("next_remind_ms").limit(limit);
    if (error) fail("calendar_events", error);
    return (data ?? []) as EventRow[];
  }
}

class SupabaseTasks extends SupabaseTable<TaskRow> implements TaskTable {
  constructor(private readonly client: SupabaseClient) { super(client, "calendar_tasks"); }
  async between(userId: string, fromKey: string, toKey: string, limit: number): Promise<TaskRow[]> {
    const { data, error } = await this.client.from("calendar_tasks").select("*").eq("user_id", userId).gte("due_day", fromKey).lte("due_day", toKey).order("due_day").limit(limit);
    if (error) fail("calendar_tasks", error);
    return (data ?? []) as TaskRow[];
  }
  async open(userId: string, limit: number): Promise<TaskRow[]> {
    const { data, error } = await this.client.from("calendar_tasks").select("*").eq("user_id", userId).eq("done", false).order("created_ms").limit(limit);
    if (error) fail("calendar_tasks", error);
    return (data ?? []) as TaskRow[];
  }
  async due(nowMs: number, limit: number): Promise<TaskRow[]> {
    const { data, error } = await this.client.from("calendar_tasks").select("*").not("next_remind_ms", "is", null).lte("next_remind_ms", nowMs).order("next_remind_ms").limit(limit);
    if (error) fail("calendar_tasks", error);
    return (data ?? []) as TaskRow[];
  }
}

// ------------------------------------------------------------------ the tables

let made: CalendarRows | null = null;

/** The two tables: Supabase when the service client exists, else memory (tests, a server with none). */
export function calendarRows(): CalendarRows {
  if (!made) {
    const sb = supabase();
    made = sb ? { events: new SupabaseEvents(sb), tasks: new SupabaseTasks(sb) } : { events: new MemoryEvents(), tasks: new MemoryTasks() };
  }
  return made;
}

/** Two fresh memory tables (tests). */
export function memoryCalendarRows(): CalendarRows { return { events: new MemoryEvents(), tasks: new MemoryTasks() }; }

/** Tests: forget the tables. */
export function resetCalendarRowsForTests(): void { made = null; }

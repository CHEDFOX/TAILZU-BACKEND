/**
 * PLAN EASE'S ONE ROW A PERSON (plan_prefs, migrations 0052 and 0070): where their day starts, the travel their moves saved, their
 * offset, when their notes go and what the notes remember, the Move card last shown, when they open Plan Ease in the evening, today's
 * leave-by times, and how many pushes went today.
 *
 *   prefs.get(user)                    the row, or null
 *   prefs.patch(user, fields)          changes only those fields (a row is made when there is none: the defaults below)
 *   prefs.claim(user, field, was, to)  moves next_note_ms / next_leave_ms on only if it still is `was`: whoever moves it first sends
 *   prefs.notesDue(now) / leavesDue(now)   the rows whose note or leave-by reminder is due, across everyone (the jobs)
 *
 * In memory without Supabase (tests, a server with none). Written by the server with the service key only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { MemoryTable, table, type Table } from "./rows.js";

/** What the notes remember between one and the next (ids and times, never words). */
export interface NoteMemory {
  /** Which note the row's next_note_ms is for. */
  next?: "evening" | "morning";
  /** The day key the last evening note was about (tomorrow then), when it went, and whether it was opened or acted on. */
  eveningFor?: string; eveningAt?: number; eveningOpened?: boolean;
  /** What that day held when the evening note went: "<id>|<start>" each, so the morning knows whether it changed. */
  sig?: string[];
  /** The last morning note's day, when it went, whether it was opened; morning notes in a row never opened (morning-only mode). */
  morningFor?: string; morningAt?: number; morningOpened?: boolean; mornUnopened?: number;
  /** The one-time lines: the first evening note's, and the one when the evening note stops. */
  firstSaid?: boolean; quietSaid?: boolean;
  /** The day the Daily summary rode in the evening note (so it isn't sent on its own that day). */
  summaryFor?: string;
  /** When they last opened Plan Ease. */
  openedAt?: number;
  /** The questions that already rode in an evening note (their card keys, the last 20): a card left alone rides once, not every evening. */
  rode?: string[];
}

/** A leave-by worked out for an event (planTravel.ts), and whether its reminder went. */
export interface LeaveRow { eventId: string; start: number; leaveBy: number; minutes: number; mode: "walk" | "drive"; to: string; title: string; sent?: boolean }

/** The Move card last shown, with what it would save: a yes to it is written down from here, never from the app. */
export interface ShownMove { eventId: string; startIso: string; key: string; savedMin?: number }

export interface PlanPrefsRow {
  [k: string]: unknown;
  user_id: string;
  home: string;
  saves: Array<{ key: string; min: number; at: number }>;
  updated_ms: number;
  tz_min?: number | null;
  evening_min?: number;
  morning_min?: number;
  /** Which notes go: both, the evening one only, the morning one only (after 5 unopened evening notes), or none. */
  notes?: "both" | "evening" | "morning" | "off";
  unopened?: number;
  next_note_ms?: number | null;
  note?: NoteMemory;
  shown?: ShownMove | null;
  opens?: Array<{ day: string; min: number }>;
  leaves?: LeaveRow[];
  next_leave_ms?: number | null;
  sent?: { day?: string; n?: number };
}

export const EVENING_MIN = 20 * 60 + 30;
export const MORNING_MIN = 7 * 60 + 30;

const numOr = (v: unknown, d: number): number => (v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const obj = <T>(v: unknown, d: T): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Supabase hands bigints back as strings or numbers, and an older row has none of 0070's columns: one shape either way. */
export function prefsRow(r: Partial<PlanPrefsRow> & { user_id: string }): PlanPrefsRow {
  return {
    ...r,
    user_id: r.user_id, home: typeof r.home === "string" ? r.home : "", saves: arr(r.saves), updated_ms: numOr(r.updated_ms, 0),
    tz_min: numOrNull(r.tz_min), evening_min: numOr(r.evening_min, EVENING_MIN), morning_min: numOr(r.morning_min, MORNING_MIN),
    notes: r.notes === "evening" || r.notes === "morning" || r.notes === "off" ? r.notes : "both", unopened: numOr(r.unopened, 0),
    next_note_ms: numOrNull(r.next_note_ms), note: obj<NoteMemory>(r.note, {}), shown: r.shown ? obj<ShownMove | null>(r.shown, null) : null,
    opens: arr(r.opens), leaves: arr(r.leaves), next_leave_ms: numOrNull(r.next_leave_ms), sent: obj(r.sent, {}),
  };
}

export interface PlanPrefsTable extends Table<PlanPrefsRow> {
  /** Rows whose `field` is due by `now`, soonest first. */
  due(field: "next_note_ms" | "next_leave_ms", now: number, limit: number): Promise<PlanPrefsRow[]>;
}

/** The area's plan_prefs table (rows.ts: the same one planTravel.ts and Your space read), with the jobs' due read beside it. */
function withDue(t: Table<PlanPrefsRow>, client: SupabaseClient | null): PlanPrefsTable {
  const due: PlanPrefsTable["due"] = t instanceof MemoryTable
    ? async (field, now, limit) => (t as MemoryTable<PlanPrefsRow>).rows.filter((r) => typeof r[field] === "number" && (r[field] as number) <= now)
      .sort((a, b) => Number(a[field]) - Number(b[field])).slice(0, limit).map((r) => JSON.parse(JSON.stringify(r)) as PlanPrefsRow)
    : async (field, now, limit) => {
      if (!client) return [];
      const { data, error } = await client.from("plan_prefs").select("*").not(field, "is", null).lte(field, now).order(field).limit(limit);
      if (error) throw new Error(`plan_prefs due: ${error.message}`);
      return (data ?? []) as PlanPrefsRow[];
    };
  return {
    select: (m, o) => t.select(m, o), insert: (r) => t.insert(r), update: (m, p) => t.update(m, p), remove: (m) => t.remove(m),
    upsert: (r, k) => t.upsert(r, k), due,
  };
}

export class PlanPrefs {
  constructor(readonly table: PlanPrefsTable, private readonly now: () => number = Date.now) {}

  async get(userId: string): Promise<PlanPrefsRow | null> {
    const [r] = await this.table.select({ user_id: userId }, { limit: 1 });
    return r ? prefsRow(r) : null;
  }

  /** One person's writes, one after another in this process: two at once (a note and a page read) never make two rows or lose a field. */
  private readonly queue = new Map<string, Promise<unknown>>();

  /** Changes only `fields`; the row is made (home "", no saves) when there is none. Returns the row as it is now. */
  async patch(userId: string, fields: Partial<Omit<PlanPrefsRow, "user_id">>): Promise<PlanPrefsRow> {
    const before = this.queue.get(userId) ?? Promise.resolve();
    const mine = before.catch(() => undefined).then(() => this.write(userId, fields));
    this.queue.set(userId, mine);
    try { return await mine; } finally { if (this.queue.get(userId) === mine) this.queue.delete(userId); }
  }

  private async write(userId: string, fields: Partial<Omit<PlanPrefsRow, "user_id">>): Promise<PlanPrefsRow> {
    const at = this.now();
    const had = await this.get(userId);
    if (had) {
      await this.table.update({ user_id: userId }, { ...fields, updated_ms: at });
      return prefsRow({ ...had, ...fields, updated_ms: at });
    }
    const row = { user_id: userId, home: "", saves: [], updated_ms: at, ...fields } as PlanPrefsRow;
    try {
      await this.table.insert(row);
    } catch {
      // Made by someone else between the read and the write (a second server): change it instead.
      await this.table.update({ user_id: userId }, { ...fields, updated_ms: at });
    }
    return prefsRow(row);
  }

  /** Moves a due time on, only if it still is `was`. True: this caller moved it, and so it is this caller's to send. */
  async claim(userId: string, field: "next_note_ms" | "next_leave_ms", was: number, to: number | null): Promise<boolean> {
    return (await this.table.update({ user_id: userId, [field]: was } as Partial<PlanPrefsRow>, { [field]: to } as Partial<PlanPrefsRow>)) > 0;
  }

  async notesDue(now: number, limit = 200): Promise<PlanPrefsRow[]> { return (await this.table.due("next_note_ms", now, limit)).map(prefsRow); }
  async leavesDue(now: number, limit = 200): Promise<PlanPrefsRow[]> { return (await this.table.due("next_leave_ms", now, limit)).map(prefsRow); }
}

/** The server's: the area's plan_prefs table (Supabase when the service client exists, else memory). */
export function planPrefs(now?: () => number): PlanPrefs {
  return new PlanPrefs(withDue(table<PlanPrefsRow>("plan_prefs"), supabase()), now);
}

/** A fresh one in memory (tests). */
export const memoryPlanPrefs = (now?: () => number): PlanPrefs => new PlanPrefs(withDue(new MemoryTable<PlanPrefsRow>(), null), now);

/** One over a table a test made. */
export const planPrefsOver = (t: Table<PlanPrefsRow>, now?: () => number): PlanPrefs => new PlanPrefs(withDue(t, null), now);

/**
 * WHERE ROUTINES ARE KEPT: migration 0061 (routines), with a memory twin for tests and a server with no Supabase (a restart then forgets
 * them). Written with the service key only; a person's own token can neither read nor write a row. Rows go with the account.
 *
 * Two runs of the same routine are never started for one due time: `claim` moves `next_at` on only if it is still the time that was
 * read, so of two servers (or two ticks) that find the same routine due, one gets it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { cleanSchedule, type Schedule } from "./words.js";

export type RoutineStatus = "on" | "paused";
export type RunStatus = "done" | "needs" | "failed";

export interface Routine {
  id: string;
  userId: string;
  /** The bot that does it: a slug of the person's own bots or a built-in (never Xode: its work is a job, docs/routines.md). */
  bot: string;
  botName: string;
  task: string;
  schedule: Schedule;
  /** The person's offset when they set it up, minutes east of UTC. */
  tz: number;
  status: RoutineStatus;
  /** Why it was paused by itself (three failed runs, its bot deleted); empty when the person paused it, or it is on. */
  pausedWhy: string;
  nextAt: number | null;
  lastAt: number | null;
  lastStatus: RunStatus | null;
  /** The last answer, or why it failed (4,000 characters at most). */
  lastText: string;
  lastPaise: number;
  runs: number;
  /** Failed runs in a row. */
  fails: number;
  createdAt: number;
  updatedAt: number;
}

export type RoutinePatch = Partial<Pick<Routine, "bot" | "botName" | "task" | "schedule" | "tz" | "status" | "pausedWhy" | "nextAt" | "lastAt" | "lastStatus" | "lastText" | "lastPaise" | "runs" | "fails">>;

export interface RoutineStore {
  list(userId: string): Promise<Routine[]>;
  get(userId: string, id: string): Promise<Routine | null>;
  add(r: Routine): Promise<void>;
  update(userId: string, id: string, patch: RoutinePatch, now: number): Promise<Routine | null>;
  remove(userId: string, id: string): Promise<boolean>;
  removeAll(userId: string): Promise<void>;
  /** Routines that are on and due at `now`, the longest waiting first. */
  due(now: number, limit: number): Promise<Routine[]>;
  /** Moves a due routine's next run on, only if it is still `was`. True for the one caller that did. */
  claim(r: Routine, was: number, next: number, now: number): Promise<boolean>;
}

export class MemoryRoutineStore implements RoutineStore {
  private rows = new Map<string, Routine>();
  async list(userId: string) {
    return [...this.rows.values()].filter((r) => r.userId === userId).map((r) => structuredClone(r));
  }
  async get(userId: string, id: string) {
    const r = this.rows.get(id);
    return r && r.userId === userId ? structuredClone(r) : null;
  }
  async add(r: Routine) { this.rows.set(r.id, structuredClone(r)); }
  async update(userId: string, id: string, patch: RoutinePatch, now: number) {
    const r = this.rows.get(id);
    if (!r || r.userId !== userId) return null;
    const next = { ...r, ...structuredClone(patch), updatedAt: now };
    this.rows.set(id, next);
    return structuredClone(next);
  }
  async remove(userId: string, id: string) {
    const r = this.rows.get(id);
    if (!r || r.userId !== userId) return false;
    return this.rows.delete(id);
  }
  async removeAll(userId: string) { for (const [id, r] of this.rows) if (r.userId === userId) this.rows.delete(id); }
  async due(now: number, limit: number) {
    return [...this.rows.values()].filter((r) => r.status === "on" && r.nextAt !== null && r.nextAt <= now)
      .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0)).slice(0, limit).map((r) => structuredClone(r));
  }
  async claim(r: Routine, was: number, next: number, now: number) {
    const cur = this.rows.get(r.id);
    if (!cur || cur.status !== "on" || cur.nextAt !== was) return false;
    this.rows.set(r.id, { ...cur, nextAt: next, updatedAt: now });
    return true;
  }
}

const TABLE = "routines";
const COLUMNS = "id, user_id, bot, bot_name, task, schedule, tz_min, status, paused_why, next_at, last_at, last_status, last_text, last_paise, runs, fails, created_at, updated_at";

interface Row {
  id: string; user_id: string; bot: string; bot_name: string; task: string; schedule: unknown; tz_min: number; status: RoutineStatus; paused_why: string;
  next_at: string | null; last_at: string | null; last_status: RunStatus | null; last_text: string; last_paise: number; runs: number; fails: number;
  created_at: string; updated_at: string;
}

const ms = (s: string | null): number | null => (s ? Date.parse(s) : null);
const iso = (n: number | null | undefined): string | null => (n === null || n === undefined ? null : new Date(n).toISOString());

function fromRow(r: Row): Routine | null {
  const schedule = cleanSchedule(r.schedule);
  if (!schedule) return null;
  return {
    id: r.id, userId: r.user_id, bot: r.bot, botName: r.bot_name, task: r.task, schedule, tz: r.tz_min, status: r.status, pausedWhy: r.paused_why ?? "",
    nextAt: ms(r.next_at), lastAt: ms(r.last_at), lastStatus: r.last_status, lastText: r.last_text ?? "", lastPaise: r.last_paise ?? 0,
    runs: r.runs ?? 0, fails: r.fails ?? 0, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
  };
}

function toRow(p: RoutinePatch): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.bot !== undefined) o.bot = p.bot;
  if (p.botName !== undefined) o.bot_name = p.botName;
  if (p.task !== undefined) o.task = p.task;
  if (p.schedule !== undefined) o.schedule = p.schedule;
  if (p.tz !== undefined) o.tz_min = p.tz;
  if (p.status !== undefined) o.status = p.status;
  if (p.pausedWhy !== undefined) o.paused_why = p.pausedWhy;
  if (p.nextAt !== undefined) o.next_at = iso(p.nextAt);
  if (p.lastAt !== undefined) o.last_at = iso(p.lastAt);
  if (p.lastStatus !== undefined) o.last_status = p.lastStatus;
  if (p.lastText !== undefined) o.last_text = p.lastText;
  if (p.lastPaise !== undefined) o.last_paise = p.lastPaise;
  if (p.runs !== undefined) o.runs = p.runs;
  if (p.fails !== undefined) o.fails = p.fails;
  return o;
}

const rows = (data: Row[] | null): Routine[] => (data ?? []).map(fromRow).filter((r): r is Routine => !!r);

export class SupabaseRoutineStore implements RoutineStore {
  constructor(private readonly sb: SupabaseClient) {}

  async list(userId: string) {
    const { data, error } = await this.sb.from(TABLE).select(COLUMNS).eq("user_id", userId).order("created_at", { ascending: true }).limit(200);
    if (error) throw new Error(`${TABLE}: list failed: ${error.message}`);
    return rows(data as Row[] | null);
  }

  async get(userId: string, id: string) {
    const { data, error } = await this.sb.from(TABLE).select(COLUMNS).eq("user_id", userId).eq("id", id).maybeSingle<Row>();
    if (error) throw new Error(`${TABLE}: read failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async add(r: Routine) {
    const { error } = await this.sb.from(TABLE).insert({
      id: r.id, user_id: r.userId, ...toRow(r), created_at: iso(r.createdAt), updated_at: iso(r.updatedAt),
    });
    if (error) throw new Error(`${TABLE}: add failed: ${error.message}`);
  }

  async update(userId: string, id: string, patch: RoutinePatch, now: number) {
    const { data, error } = await this.sb.from(TABLE).update({ ...toRow(patch), updated_at: iso(now) }).eq("user_id", userId).eq("id", id).select(COLUMNS).maybeSingle<Row>();
    if (error) throw new Error(`${TABLE}: update failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async remove(userId: string, id: string) {
    const { data, error } = await this.sb.from(TABLE).delete().eq("user_id", userId).eq("id", id).select("id");
    if (error) throw new Error(`${TABLE}: delete failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async removeAll(userId: string) {
    const { error } = await this.sb.from(TABLE).delete().eq("user_id", userId);
    if (error) throw new Error(`${TABLE}: delete failed: ${error.message}`);
  }

  async due(now: number, limit: number) {
    const { data, error } = await this.sb.from(TABLE).select(COLUMNS).eq("status", "on").lte("next_at", iso(now)).order("next_at", { ascending: true }).limit(limit);
    if (error) throw new Error(`${TABLE}: due failed: ${error.message}`);
    return rows(data as Row[] | null);
  }

  async claim(r: Routine, was: number, next: number, now: number) {
    const { data, error } = await this.sb.from(TABLE).update({ next_at: iso(next), updated_at: iso(now) })
      .eq("id", r.id).eq("status", "on").eq("next_at", iso(was)).select("id");
    if (error) throw new Error(`${TABLE}: claim failed: ${error.message}`);
    return (data ?? []).length > 0;
  }
}

let current: RoutineStore | null = null;

/** Supabase when the server has it, else memory. */
export function routineStore(): RoutineStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseRoutineStore(sb) : new MemoryRoutineStore();
  }
  return current;
}

export function resetRoutineStoreForTests(): void { current = null; }

/**
 * WHERE A PROJECT'S STANDING WORK IS KEPT (migration 0095, `code_schedules`), Supabase with a memory twin, as every other
 * store here has it: the server reads and writes with the service key, and a person's own rows are theirs to read.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import { cleanSchedule, type Schedule } from "../../routines/words.js";

export type ScheduleStatus = "on" | "paused";
export type RunStatus = "started" | "failed" | "skipped";

/** One standing piece of work on one project. */
export interface CodeSchedule {
  id: string;
  userId: string;
  projectId: string;
  /** What to do, in the person's words, as a job's task. */
  task: string;
  schedule: Schedule;
  /** The person's offset when they set it up, minutes east of UTC. */
  tz: number;
  /** What ONE run may spend. Its own, because a standing job spends with nobody watching. */
  budgetPaise: number;
  status: ScheduleStatus;
  /** Why it paused itself (runs that failed, the project gone); empty when the person paused it, or it is on. */
  pausedWhy: string;
  nextAt: number | null;
  lastAt: number | null;
  /** The job the last run started, and how that run went. */
  lastJobId: string | null;
  lastStatus: RunStatus | null;
  lastText: string;
  runs: number;
  /** Runs that failed in a row. */
  fails: number;
  createdAt: number;
  updatedAt: number;
}

export interface NewCodeSchedule {
  userId: string;
  projectId: string;
  task: string;
  schedule: Schedule;
  tz: number;
  budgetPaise: number;
  nextAt: number;
}

export type CodeSchedulePatch = Partial<Pick<CodeSchedule,
  "task" | "schedule" | "tz" | "budgetPaise" | "status" | "pausedWhy" | "nextAt" | "lastAt" | "lastJobId" | "lastStatus" | "lastText" | "runs" | "fails"
>>;

export interface CodeScheduleStore {
  create(s: NewCodeSchedule): Promise<CodeSchedule>;
  byId(id: string): Promise<CodeSchedule | null>;
  /** A person's own, newest first. */
  list(userId: string): Promise<CodeSchedule[]>;
  ofProject(projectId: string): Promise<CodeSchedule[]>;
  /** The ones on and due at or before `now`, oldest due first: what one tick runs. */
  due(now: number, limit: number): Promise<CodeSchedule[]>;
  update(id: string, patch: CodeSchedulePatch): Promise<CodeSchedule | null>;
  /**
   * TAKES A DUE RUN, so two servers ticking the same minute cannot both start it: the clock is moved on in ONE write that holds only
   * while `next_at` is still what the tick read. True: this server has the run. False: another took it, or the person changed it.
   */
  claim(id: string, expected: number, nextAt: number): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

const clone = (s: CodeSchedule): CodeSchedule => ({ ...s, schedule: { ...s.schedule, ...(s.schedule.days ? { days: [...s.schedule.days] } : {}) } });

/** Enough for a server with no database, and for every test. */
export class MemoryCodeScheduleStore implements CodeScheduleStore {
  private readonly rows = new Map<string, CodeSchedule>();

  constructor(private readonly now: () => number = Date.now) {}

  async create(s: NewCodeSchedule): Promise<CodeSchedule> {
    const at = this.now();
    const row: CodeSchedule = {
      id: randomUUID(), userId: s.userId, projectId: s.projectId, task: s.task, schedule: s.schedule, tz: s.tz,
      budgetPaise: s.budgetPaise, status: "on", pausedWhy: "", nextAt: s.nextAt, lastAt: null, lastJobId: null,
      lastStatus: null, lastText: "", runs: 0, fails: 0, createdAt: at, updatedAt: at,
    };
    this.rows.set(row.id, row);
    return clone(row);
  }

  async byId(id: string): Promise<CodeSchedule | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }

  async list(userId: string): Promise<CodeSchedule[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt - a.createdAt).map(clone);
  }

  async ofProject(projectId: string): Promise<CodeSchedule[]> {
    return [...this.rows.values()].filter((r) => r.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt).map(clone);
  }

  async due(now: number, limit: number): Promise<CodeSchedule[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === "on" && r.nextAt !== null && r.nextAt <= now)
      .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))
      .slice(0, limit).map(clone);
  }

  async update(id: string, patch: CodeSchedulePatch): Promise<CodeSchedule | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    const next: CodeSchedule = { ...r, ...patch, updatedAt: this.now() };
    this.rows.set(id, next);
    return clone(next);
  }

  async claim(id: string, expected: number, nextAt: number): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.nextAt !== expected) return false;
    this.rows.set(id, { ...r, nextAt, updatedAt: this.now() });
    return true;
  }

  async remove(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
}

// ------------------------------------------------------------------ Supabase

const TABLE = "code_schedules";
const COLUMNS = "id, user_id, project_id, task, schedule, tz, budget_paise, status, paused_why, next_at, last_at, last_job_id, last_status, last_text, runs, fails, created_at, updated_at";

interface Row {
  id: string; user_id: string; project_id: string; task: string; schedule: unknown; tz: number; budget_paise: number;
  status: ScheduleStatus; paused_why: string; next_at: string | null; last_at: string | null; last_job_id: string | null;
  last_status: RunStatus | null; last_text: string; runs: number; fails: number; created_at: string; updated_at: string;
}

const ms = (s: string | null): number | null => (s ? Date.parse(s) : null);
const iso = (n: number | null | undefined): string | null => (n === null || n === undefined ? null : new Date(n).toISOString());

/** A row with a schedule that cannot be read is no schedule at all: it is left out rather than run on a guess. */
function fromRow(r: Row): CodeSchedule | null {
  const schedule = cleanSchedule(r.schedule);
  if (!schedule) return null;
  return {
    id: r.id, userId: r.user_id, projectId: r.project_id, task: r.task, schedule, tz: r.tz ?? 0, budgetPaise: r.budget_paise,
    status: r.status, pausedWhy: r.paused_why ?? "", nextAt: ms(r.next_at), lastAt: ms(r.last_at), lastJobId: r.last_job_id,
    lastStatus: r.last_status, lastText: r.last_text ?? "", runs: r.runs ?? 0, fails: r.fails ?? 0,
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
  };
}

function toRow(p: CodeSchedulePatch): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.task !== undefined) o.task = p.task;
  if (p.schedule !== undefined) o.schedule = p.schedule;
  if (p.tz !== undefined) o.tz = p.tz;
  if (p.budgetPaise !== undefined) o.budget_paise = p.budgetPaise;
  if (p.status !== undefined) o.status = p.status;
  if (p.pausedWhy !== undefined) o.paused_why = p.pausedWhy;
  if (p.nextAt !== undefined) o.next_at = iso(p.nextAt);
  if (p.lastAt !== undefined) o.last_at = iso(p.lastAt);
  if (p.lastJobId !== undefined) o.last_job_id = p.lastJobId;
  if (p.lastStatus !== undefined) o.last_status = p.lastStatus;
  if (p.lastText !== undefined) o.last_text = p.lastText;
  if (p.runs !== undefined) o.runs = p.runs;
  if (p.fails !== undefined) o.fails = p.fails;
  return o;
}

const rows = (data: Row[] | null): CodeSchedule[] => (data ?? []).map(fromRow).filter((r): r is CodeSchedule => !!r);

export class SupabaseCodeScheduleStore implements CodeScheduleStore {
  constructor(private readonly sb: SupabaseClient) {}

  async create(s: NewCodeSchedule): Promise<CodeSchedule> {
    const { data, error } = await this.sb.from(TABLE).insert({
      user_id: s.userId, project_id: s.projectId, task: s.task, schedule: s.schedule, tz: s.tz,
      budget_paise: s.budgetPaise, next_at: iso(s.nextAt),
    }).select(COLUMNS).single<Row>();
    if (error) throw new Error(`${TABLE}: create failed: ${error.message}`);
    const row = fromRow(data);
    if (!row) throw new Error(`${TABLE}: created a row whose schedule could not be read`);
    return row;
  }

  async byId(id: string): Promise<CodeSchedule | null> {
    const { data, error } = await this.sb.from(TABLE).select(COLUMNS).eq("id", id).maybeSingle<Row>();
    if (error) throw new Error(`${TABLE}: read failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async list(userId: string): Promise<CodeSchedule[]> {
    const { data, error } = await this.sb.from(TABLE).select(COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(`${TABLE}: list failed: ${error.message}`);
    return rows(data as Row[] | null);
  }

  async ofProject(projectId: string): Promise<CodeSchedule[]> {
    const { data, error } = await this.sb.from(TABLE).select(COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(`${TABLE}: list failed: ${error.message}`);
    return rows(data as Row[] | null);
  }

  async due(now: number, limit: number): Promise<CodeSchedule[]> {
    const { data, error } = await this.sb.from(TABLE).select(COLUMNS).eq("status", "on").lte("next_at", iso(now)).order("next_at", { ascending: true }).limit(limit);
    if (error) throw new Error(`${TABLE}: due failed: ${error.message}`);
    return rows(data as Row[] | null);
  }

  async update(id: string, patch: CodeSchedulePatch): Promise<CodeSchedule | null> {
    const { data, error } = await this.sb.from(TABLE).update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq("id", id).select(COLUMNS).maybeSingle<Row>();
    if (error) throw new Error(`${TABLE}: update failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async claim(id: string, expected: number, nextAt: number): Promise<boolean> {
    // One write that holds only while next_at is still what the tick read: the row's own compare-and-set.
    const { data, error } = await this.sb.from(TABLE)
      .update({ next_at: iso(nextAt), updated_at: new Date().toISOString() })
      .eq("id", id).eq("next_at", iso(expected)).eq("status", "on").select("id");
    if (error) throw new Error(`${TABLE}: claim failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async remove(id: string): Promise<boolean> {
    const { data, error } = await this.sb.from(TABLE).delete().eq("id", id).select("id");
    if (error) throw new Error(`${TABLE}: delete failed: ${error.message}`);
    return (data ?? []).length > 0;
  }
}

// --------------------------------------------------------------- the one store

let current: CodeScheduleStore | null = null;

/** The store this server uses: Supabase when it has one, memory otherwise (where a restart forgets, and the routes still work). */
export function codeScheduleStore(): CodeScheduleStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseCodeScheduleStore(sb) : new MemoryCodeScheduleStore();
  }
  return current;
}

export function resetCodeScheduleStoreForTests(): void { current = null; }

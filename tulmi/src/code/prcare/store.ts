/**
 * WHERE PR CARE KEEPS WHAT IT KNOWS OF A PULL REQUEST: ONE ROW EACH (migration 0034, code_pr_care), BEHIND ONE INTERFACE WITH A MEMORY TWIN.
 *
 * Supabase when the service client exists, else memory (tests, local runs), as the other stores are. Written with the service key only; a person's own token
 * can read their own rows. A row is a person's and a project's: asking for another project's number finds nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import { emptyState, type CareRow, type CareState } from "./types.js";

export interface CareStore {
  get(projectId: string, prNumber: number): Promise<CareRow | null>;
  /** Saves the row (made, or replaced as a whole). */
  put(row: CareRow): Promise<CareRow>;
  /** The project's rows, newest first. */
  listByProject(projectId: string): Promise<CareRow[]>;
  /** Pull requests that are not over, least recently touched first: what the sweep looks at. */
  listActive(limit: number): Promise<CareRow[]>;
  delete(projectId: string, prNumber: number): Promise<boolean>;
}

const clone = (r: CareRow): CareRow => structuredClone(r);

export class MemoryCareStore implements CareStore {
  private rows = new Map<string, CareRow>();
  private key = (p: string, n: number) => `${p}|${n}`;

  async get(projectId: string, prNumber: number) { const r = this.rows.get(this.key(projectId, prNumber)); return r ? clone(r) : null; }
  async put(row: CareRow) {
    const had = this.rows.get(this.key(row.projectId, row.prNumber));
    if (had && had.userId !== row.userId) throw new Error("code pr care store: that pull request is not theirs");
    this.rows.set(this.key(row.projectId, row.prNumber), clone(row));
    return clone(row);
  }
  async listByProject(projectId: string) {
    return [...this.rows.values()].reverse().filter((r) => r.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt).map(clone);
  }
  async listActive(limit: number) {
    return [...this.rows.values()].filter((r) => r.endedAt === null).sort((a, b) => a.updatedAt - b.updatedAt).slice(0, limit).map(clone);
  }
  async delete(projectId: string, prNumber: number) { return this.rows.delete(this.key(projectId, prNumber)); }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  project_id: string; pr_number: number; user_id: string; branch: string; origin: string; status_comment_id: number | string | null;
  ci_rounds: unknown; state: unknown; handed_at: string | null; ended_at: string | null; created_at: string; updated_at: string;
}

const ms = (v: unknown): number => { const n = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : 0; };
const msOrNull = (v: unknown): number | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

function stateOf(raw: unknown): CareState {
  const s = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<CareState>;
  return { ...emptyState(), ...s, handled: Array.isArray(s.handled) ? s.handled.filter((n): n is number => Number.isSafeInteger(n)) : [], jobs: Array.isArray(s.jobs) ? s.jobs : [], notes: Array.isArray(s.notes) ? s.notes : [] };
}

function roundsOf(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (/^\d{4}-\d\d-\d\d$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
  }
  return out;
}

const rowOf = (r: Row): CareRow => ({
  projectId: r.project_id, prNumber: r.pr_number, userId: r.user_id, branch: r.branch, origin: r.origin === "handed" ? "handed" : "tailzu",
  statusCommentId: r.status_comment_id === null || r.status_comment_id === undefined ? null : Number(r.status_comment_id), ciRounds: roundsOf(r.ci_rounds), state: stateOf(r.state),
  handedAt: msOrNull(r.handed_at), endedAt: msOrNull(r.ended_at), createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code pr care store: ${res.error.message}`);
  return res.data;
}

export class SupabaseCareStore implements CareStore {
  constructor(private readonly sb: SupabaseClient) {}

  async get(projectId: string, prNumber: number) {
    if (!UUID.test(projectId)) return null;
    const r = ok(await this.sb.from("code_pr_care").select("*").eq("project_id", projectId).eq("pr_number", prNumber).maybeSingle<Row>());
    return r ? rowOf(r) : null;
  }
  async put(row: CareRow) {
    if (!UUID.test(row.projectId) || !UUID.test(row.userId)) throw new Error("code pr care store: not a project of a signed-in person");
    const r = ok(await this.sb.from("code_pr_care").upsert({
      project_id: row.projectId, pr_number: row.prNumber, user_id: row.userId, branch: row.branch, origin: row.origin, status_comment_id: row.statusCommentId,
      ci_rounds: row.ciRounds, state: row.state, handed_at: row.handedAt === null ? null : new Date(row.handedAt).toISOString(),
      ended_at: row.endedAt === null ? null : new Date(row.endedAt).toISOString(), updated_at: new Date(row.updatedAt).toISOString(),
    }, { onConflict: "project_id,pr_number" }).select("*").single<Row>());
    return rowOf(r!);
  }
  async listByProject(projectId: string) {
    if (!UUID.test(projectId)) return [];
    const rows = ok(await this.sb.from("code_pr_care").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).returns<Row[]>());
    return (rows ?? []).map(rowOf);
  }
  async listActive(limit: number) {
    const rows = ok(await this.sb.from("code_pr_care").select("*").is("ended_at", null).order("updated_at", { ascending: true }).limit(limit).returns<Row[]>());
    return (rows ?? []).map(rowOf);
  }
  async delete(projectId: string, prNumber: number) {
    if (!UUID.test(projectId)) return false;
    const gone = ok(await this.sb.from("code_pr_care").delete().eq("project_id", projectId).eq("pr_number", prNumber).select("pr_number").returns<Array<{ pr_number: number }>>());
    return (gone ?? []).length > 0;
  }
}

let current: CareStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function careStore(): CareStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseCareStore(sb) : new MemoryCareStore();
  }
  return current;
}

export function resetCareStoreForTests(): void { current = null; }

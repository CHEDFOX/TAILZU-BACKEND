/**
 * WHERE A NEW PROJECT'S INTAKE IS KEPT: WHAT THE PERSON SAID, WHAT WAS ASKED, THE SPEC AND THE STACK.
 *
 * The table (supabase/migrations/0029_code_worklog.sql, `code_intake`), one row per
 * project, behind one interface so everything above runs against the in-memory
 * twin in tests and local runs, as code/project/store.ts does. Written with the
 * service key; a person's own token may only READ their own row.
 *
 * Like the work log, an intake that cannot be kept is not an error to the person:
 * intake.ts asks again from what it was given. The row also holds the one-time tips
 * (the "connect your host for previews" one), so a tip is shown once per project
 * and not once per server restart.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import type { IntakeRow, IntakeState, QuestionId, Spec, Stack } from "./types.js";

export type IntakePatch = Partial<Pick<IntakeRow, "state" | "request" | "answers" | "asked" | "spec" | "stack" | "tips">>;

export interface IntakeStore {
  get(projectId: string): Promise<IntakeRow | null>;
  /** Creates the row, or changes the fields given. */
  save(projectId: string, userId: string, patch: IntakePatch): Promise<IntakeRow>;
  delete(projectId: string): Promise<void>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryIntakeStore implements IntakeStore {
  private rows = new Map<string, IntakeRow>();
  constructor(private readonly now: () => number = Date.now) {}

  async get(projectId: string) {
    const r = this.rows.get(projectId);
    return r ? clone(r) : null;
  }
  async save(projectId: string, userId: string, patch: IntakePatch) {
    const at = this.now();
    const cur = this.rows.get(projectId) ?? { projectId, userId, state: "asking" as IntakeState, request: "", answers: {}, asked: [], spec: null, stack: null, tips: [], createdAt: at, updatedAt: at };
    const next: IntakeRow = { ...cur, ...clone(patch), projectId, userId: cur.userId, updatedAt: at };
    this.rows.set(projectId, next);
    return clone(next);
  }
  async delete(projectId: string) { this.rows.delete(projectId); }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  project_id: string; user_id: string; state: IntakeState; request: string; answers: Partial<Record<QuestionId, string>> | null; asked: QuestionId[] | null;
  spec: Spec | null; stack: Stack | null; tips: string[] | null; created_at: string; updated_at: string;
}

const rowOf = (r: Row): IntakeRow => ({
  projectId: r.project_id, userId: r.user_id, state: r.state, request: r.request ?? "", answers: r.answers ?? {}, asked: r.asked ?? [], spec: r.spec ?? null, stack: r.stack ?? null,
  tips: r.tips ?? [], createdAt: Date.parse(r.created_at) || 0, updatedAt: Date.parse(r.updated_at) || 0,
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code intake store: ${res.error.message}`);
  return res.data;
}

export class SupabaseIntakeStore implements IntakeStore {
  constructor(private readonly sb: SupabaseClient, private readonly now: () => number = Date.now) {}

  async get(projectId: string) {
    if (!UUID.test(projectId)) return null;
    const r = ok(await this.sb.from("code_intake").select("*").eq("project_id", projectId).maybeSingle<Row>());
    return r ? rowOf(r) : null;
  }
  async save(projectId: string, userId: string, patch: IntakePatch) {
    if (!UUID.test(projectId) || !UUID.test(userId)) throw new Error("code intake store: not a project or user id");
    const row: Record<string, unknown> = { project_id: projectId, user_id: userId, updated_at: new Date(this.now()).toISOString() };
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.request !== undefined) row.request = patch.request;
    if (patch.answers !== undefined) row.answers = patch.answers;
    if (patch.asked !== undefined) row.asked = patch.asked;
    if (patch.spec !== undefined) row.spec = patch.spec;
    if (patch.stack !== undefined) row.stack = patch.stack;
    if (patch.tips !== undefined) row.tips = patch.tips;
    return rowOf(ok(await this.sb.from("code_intake").upsert(row, { onConflict: "project_id" }).select("*").single<Row>())!);
  }
  async delete(projectId: string) {
    if (UUID.test(projectId)) ok(await this.sb.from("code_intake").delete().eq("project_id", projectId));
  }
}

// ------------------------------------------------------------------ the one

let current: IntakeStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function intakeStore(): IntakeStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseIntakeStore(sb) : new MemoryIntakeStore();
  }
  return current;
}

export function resetIntakeStoreForTests(): void { current = null; }

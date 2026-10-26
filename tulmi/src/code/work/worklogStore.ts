/**
 * WHERE A JOB'S WORK LOG IS KEPT.
 *
 * The table (supabase/migrations/0029_code_worklog.sql), behind one interface so
 * everything above runs against the in-memory twin in tests and local runs, as
 * code/project/store.ts does. Written with the service key; a person's own token
 * may only READ the rows of their own jobs.
 *
 * What is kept is already clean: worklog.ts runs every line through the secret
 * scan before it gets here, so this file only stores. Without the migration the
 * Supabase store's writes fail, and worklog.ts treats a store that cannot be
 * written as a log that is lost, never as a job that fails.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";

export const WORK_KINDS = ["step", "read", "edit", "command", "finding", "decision", "question", "note"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export interface WorkEntry {
  /** Position in the job's log, from 1. */
  seq: number;
  jobId: string;
  /** Epoch ms. */
  at: number;
  kind: WorkKind;
  text: string;
  files?: string[];
  data?: Record<string, unknown>;
}

export type NewWorkEntry = Omit<WorkEntry, "seq" | "jobId">;

export interface WorklogStore {
  append(jobId: string, e: NewWorkEntry): Promise<WorkEntry>;
  /** The job's entries in order, optionally of some kinds, at most `limit` (2,000). */
  list(jobId: string, o?: { kinds?: readonly WorkKind[]; limit?: number }): Promise<WorkEntry[]>;
  count(jobId: string): Promise<number>;
  deleteJob(jobId: string): Promise<void>;
}

/** Entries one job keeps. */
export const ENTRIES_MAX = 2000;

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryWorklogStore implements WorklogStore {
  private by = new Map<string, WorkEntry[]>();

  async append(jobId: string, e: NewWorkEntry) {
    const list = this.by.get(jobId) ?? [];
    const row: WorkEntry = { ...clone(e), seq: list.length + 1, jobId };
    list.push(row);
    this.by.set(jobId, list);
    return clone(row);
  }
  async list(jobId: string, o: { kinds?: readonly WorkKind[]; limit?: number } = {}) {
    const all = (this.by.get(jobId) ?? []).filter((e) => !o.kinds || o.kinds.includes(e.kind));
    return all.slice(0, Math.min(o.limit ?? ENTRIES_MAX, ENTRIES_MAX)).map(clone);
  }
  async count(jobId: string) { return (this.by.get(jobId) ?? []).length; }
  async deleteJob(jobId: string) { this.by.delete(jobId); }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

interface Row { id: number; job_id: string; at: string; kind: WorkKind; text: string; files: string[] | null; data: Record<string, unknown> | null }

const entryOf = (r: Row): WorkEntry => ({
  seq: Number(r.id), jobId: r.job_id, at: Date.parse(r.at) || 0, kind: r.kind, text: r.text ?? "",
  ...(r.files?.length ? { files: r.files } : {}), ...(r.data ? { data: r.data } : {}),
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code worklog store: ${res.error.message}`);
  return res.data;
}

export class SupabaseWorklogStore implements WorklogStore {
  constructor(private readonly sb: SupabaseClient) {}

  private id(jobId: string): string | null { return UUID.test(jobId) ? jobId : null; }

  async append(jobId: string, e: NewWorkEntry) {
    const id = this.id(jobId);
    if (!id) throw new Error("code worklog store: not a job id");
    const row = ok(await this.sb.from("code_worklog").insert({
      job_id: id, at: new Date(e.at).toISOString(), kind: e.kind, text: e.text, files: e.files ?? [], data: e.data ?? null,
    }).select("*").single<Row>());
    return entryOf(row!);
  }
  async list(jobId: string, o: { kinds?: readonly WorkKind[]; limit?: number } = {}) {
    const id = this.id(jobId);
    if (!id) return [];
    const limit = Math.min(o.limit ?? ENTRIES_MAX, ENTRIES_MAX);
    const out: WorkEntry[] = [];
    for (let from = 0; from < limit; from += PAGE) {
      let q = this.sb.from("code_worklog").select("*").eq("job_id", id);
      if (o.kinds?.length) q = q.in("kind", [...o.kinds]);
      const rows = ok(await q.order("id").range(from, Math.min(from + PAGE, limit) - 1).returns<Row[]>()) ?? [];
      out.push(...rows.map(entryOf));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  async count(jobId: string) {
    const id = this.id(jobId);
    if (!id) return 0;
    const r = await this.sb.from("code_worklog").select("id", { count: "exact", head: true }).eq("job_id", id);
    if (r.error) throw new Error(`code worklog store: ${r.error.message}`);
    return r.count ?? 0;
  }
  async deleteJob(jobId: string) {
    const id = this.id(jobId);
    if (id) ok(await this.sb.from("code_worklog").delete().eq("job_id", id));
  }
}

// ------------------------------------------------------------------ the one

let current: WorklogStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function worklogStore(): WorklogStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseWorklogStore(sb) : new MemoryWorklogStore();
  }
  return current;
}

export function resetWorklogStoreForTests(): void { current = null; }

/**
 * REWIND POINTS: THE STAGED EDITS OF A JOB AFTER EACH STEP, SO A PERSON CAN GO BACK.
 *
 * A step is a round of the model's work: one turn and the tool calls it made. After each, the staged changeset (the edits not committed yet) is kept
 * here with a line saying what the step did. `POST /v1/code/jobs/:id/rewind { toStep }` then:
 *
 *   BEFORE THE COMMIT   puts the staged edits back as they stood after that step, drops what the model did since, and the job goes on from there
 *   AFTER THE COMMIT    makes a NEW commit that returns the files the job changed to what they were at that step, through the policy like any commit.
 *                       History is never rewritten: no reset, no force, no rebase
 *
 * The table is migration 0034 (code_job_checkpoints), behind one interface with a memory twin for tests and local runs. The rows hold the person's code
 * (the staged files), so they are readable by the owner only, kept while the job lives (they go with it), and bounded: the last REWIND_KEEP steps and
 * REWIND_CHARS_MAX characters of text in all, the oldest dropped first.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import type { CommitFile } from "../github.js";
import { REWIND_CHARS_MAX, REWIND_KEEP, type StagedFile, type StepCheckpoint } from "./types.js";

export interface RewindStore {
  /** Keeps a step's point (a step kept again is replaced) and drops what the limits say. */
  put(jobId: string, c: StepCheckpoint): Promise<void>;
  /** One step's point, or null. */
  get(jobId: string, step: number): Promise<StepCheckpoint | null>;
  /** The job's points, oldest first, without the staged text: what a person chooses from. */
  list(jobId: string): Promise<Array<{ step: number; at: number; note: string; files: string[] }>>;
  /** Drops the points after `step` (the job went back to it: what came after is no longer so). */
  dropAfter(jobId: string, step: number): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
}

const chars = (staged: readonly StagedFile[]): number => staged.reduce((n, f) => n + (f.content?.length ?? 0), 0);
const cloneC = (c: StepCheckpoint): StepCheckpoint => structuredClone(c);

/** Which of a job's points to drop for the limits: the oldest ones past REWIND_KEEP, then the oldest until the text fits (never the newest). */
export function overflow(points: ReadonlyArray<Pick<StepCheckpoint, "step" | "staged">>): number[] {
  const sorted = [...points].sort((a, b) => a.step - b.step);
  const drop: number[] = [];
  let live = sorted;
  if (live.length > REWIND_KEEP) { drop.push(...live.slice(0, live.length - REWIND_KEEP).map((p) => p.step)); live = live.slice(live.length - REWIND_KEEP); }
  let total = live.reduce((n, p) => n + chars(p.staged), 0);
  for (let i = 0; i < live.length - 1 && total > REWIND_CHARS_MAX; i += 1) { total -= chars(live[i]!.staged); drop.push(live[i]!.step); }
  return drop;
}

/**
 * The files of the commit that takes a branch back to how the job stood after a step. History is never rewritten: this is the NEW commit's content.
 *
 *   a file the job changed (`paths`: every path its commits touched) goes to the text it had at that step: the step's staged text when the step had staged it,
 *   else the text it had before the job's first commit (`atBase`; null: it did not exist, so it is deleted)
 *
 * Only files that differ from the branch's head now (`atHead`) are in the commit, so a rewind to what the branch already is makes no commit. Pure: the three
 * readers are the caller's (GitHub at the base commit, GitHub at the head).
 */
export async function revertFiles(o: {
  paths: readonly string[];
  /** The step's staged edits (empty for step 0: before any work). */
  staged: readonly StagedFile[];
  atBase: (path: string) => Promise<string | null>;
  atHead: (path: string) => Promise<string | null>;
}): Promise<CommitFile[]> {
  const staged = new Map(o.staged.map((f) => [f.path, f]));
  const out: CommitFile[] = [];
  for (const path of [...new Set(o.paths)]) {
    const s = staged.get(path);
    const want = s ? s.content : await o.atBase(path);
    const now = await o.atHead(path);
    if (want === now) continue;
    out.push(want === null ? { path, delete: true } : { path, content: want });
  }
  return out;
}

export class MemoryRewindStore implements RewindStore {
  private by = new Map<string, Map<number, StepCheckpoint>>();

  async put(jobId: string, c: StepCheckpoint) {
    const m = this.by.get(jobId) ?? new Map<number, StepCheckpoint>();
    m.set(c.step, cloneC(c));
    this.by.set(jobId, m);
    for (const step of overflow([...m.values()])) m.delete(step);
  }
  async get(jobId: string, step: number) { const c = this.by.get(jobId)?.get(step); return c ? cloneC(c) : null; }
  async list(jobId: string) {
    return [...(this.by.get(jobId)?.values() ?? [])].sort((a, b) => a.step - b.step).map((c) => ({ step: c.step, at: c.at, note: c.note, files: c.staged.map((f) => f.path) }));
  }
  async dropAfter(jobId: string, step: number) { const m = this.by.get(jobId); if (m) for (const k of [...m.keys()]) if (k > step) m.delete(k); }
  async deleteJob(jobId: string) { this.by.delete(jobId); }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Row { job_id: string; step: number; at: string; staged: unknown; note: string | null; summary: string | null; digests: unknown }

function stagedOf(raw: unknown): StagedFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f): StagedFile[] => {
    const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const action = x.action === "create" || x.action === "delete" ? x.action : "edit";
    return typeof x.path === "string" && (x.content === null || typeof x.content === "string") ? [{ path: x.path, content: x.content as string | null, action }] : [];
  });
}
const pointOf = (r: Row): StepCheckpoint => ({
  step: r.step, at: Date.parse(r.at) || 0, note: r.note ?? "", staged: stagedOf(r.staged), summary: r.summary ?? "",
  digests: Array.isArray(r.digests) ? r.digests.filter((d): d is string => typeof d === "string") : [],
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code rewind store: ${res.error.message}`);
  return res.data;
}

export class SupabaseRewindStore implements RewindStore {
  constructor(private readonly sb: SupabaseClient) {}

  async put(jobId: string, c: StepCheckpoint) {
    if (!UUID.test(jobId)) throw new Error("code rewind store: not a job id");
    ok(await this.sb.from("code_job_checkpoints").upsert({
      job_id: jobId, step: c.step, at: new Date(c.at).toISOString(), staged: c.staged, note: c.note.slice(0, 300), summary: c.summary.slice(0, 4000), digests: c.digests,
    }, { onConflict: "job_id,step" }).select("step").maybeSingle());
    const all = ok(await this.sb.from("code_job_checkpoints").select("job_id, step, staged").eq("job_id", jobId).order("step").returns<Array<{ step: number; staged: unknown }>>()) ?? [];
    const drop = overflow(all.map((r) => ({ step: r.step, staged: stagedOf(r.staged) })));
    if (drop.length) ok(await this.sb.from("code_job_checkpoints").delete().eq("job_id", jobId).in("step", drop));
  }
  async get(jobId: string, step: number) {
    if (!UUID.test(jobId)) return null;
    const r = ok(await this.sb.from("code_job_checkpoints").select("*").eq("job_id", jobId).eq("step", step).maybeSingle<Row>());
    return r ? pointOf(r) : null;
  }
  async list(jobId: string) {
    if (!UUID.test(jobId)) return [];
    const rows = ok(await this.sb.from("code_job_checkpoints").select("*").eq("job_id", jobId).order("step").returns<Row[]>()) ?? [];
    return rows.map(pointOf).map((c) => ({ step: c.step, at: c.at, note: c.note, files: c.staged.map((f) => f.path) }));
  }
  async dropAfter(jobId: string, step: number) {
    if (!UUID.test(jobId)) return;
    const rows = ok(await this.sb.from("code_job_checkpoints").select("step").eq("job_id", jobId).returns<Array<{ step: number }>>()) ?? [];
    const gone = rows.map((r) => r.step).filter((s) => s > step);
    if (gone.length) ok(await this.sb.from("code_job_checkpoints").delete().eq("job_id", jobId).in("step", gone));
  }
  async deleteJob(jobId: string) {
    if (UUID.test(jobId)) ok(await this.sb.from("code_job_checkpoints").delete().eq("job_id", jobId));
  }
}

let current: RewindStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function rewindStore(): RewindStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseRewindStore(sb) : new MemoryRewindStore();
  }
  return current;
}

export function resetRewindStoreForTests(): void { current = null; }

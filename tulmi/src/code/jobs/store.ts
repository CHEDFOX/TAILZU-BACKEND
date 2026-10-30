/**
 * WHERE THE CODE BOT'S JOBS, THEIR STEPS, AND THE PERSON'S COMPUTE SETTINGS ARE KEPT.
 *
 * The tables (supabase/migrations/0023_code_jobs.sql), behind one interface so
 * everything above it runs against the in-memory twin in tests and local runs,
 * as code/store.ts does. Written with the service key: the tables' policies
 * only let a person READ their own rows.
 *
 *   code_jobs              one row per job: whose, which project and branch,
 *                          the task (500 characters), its state and placement,
 *                          the LEASE (holder, epoch, expiry), the CHECKPOINT,
 *                          and the money (budget and spent, in paise)
 *   code_job_steps         the job's steps, numbered from 0, with what ran,
 *                          where, how it ended, and the last 8 KB it printed
 *   code_compute_settings  the person's rule for paid compute (never, ask,
 *                          auto up to a monthly cap) and whether GitHub's free
 *                          computers may be used
 *   code_compute_usage     what they used this calendar month (UTC): GitHub
 *                          minutes and paid paise
 *
 * The one thing that must be atomic is a change to a job that depends on the
 * lease: a dispatch, an expiry, a renewal, a result. `casJob` is that: it
 * changes the job only if the epoch (and, when asked, the state or the
 * expiry) is still what the caller read, and answers null if it is not. It is
 * what makes the fencing real when two servers, or a ticker and a request, look
 * at the same job at once. (In Supabase it is one UPDATE with those conditions;
 * the in-memory twin does the same in one synchronous step.)
 *
 * THE AGENT'S CLAIM (agent, agent_holder, agent_epoch, agent_expires_at,
 * migration 0030) is the same idea on its own fields: the agent loop
 * (src/code/agent) claims a job it drives, every write it makes is fenced by the
 * claim's epoch (`agentEpoch` in casJob), and `agentFreeBy` is the condition a
 * claim is taken under (nobody holds it, or the holder's time has run out).
 * listClaimable and listAgentExpired are what the orchestrator and the ticker ask.
 *
 * Usage is added up inside the database (the `code_add_usage` function), so
 * two results arriving together can't lose one. A month can also carry one
 * flag, `github_exhausted` (supabase/migrations/0024_code_github_actions.sql):
 * set when a step pushed to GitHub's computers never ran or never reported
 * (the free minutes are used up, or Actions is off), so the router stops
 * choosing GitHub for that person for the rest of the month. It lives in the
 * usage row but is read and written on its own, so the usage figures keep
 * their shape.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import type { RunnerMinutes } from "../live/minutes.js";
import { CodeNeedsAccount } from "../store.js";
import { liveJobStore } from "../../live/writes.js";
import {
  NO_CHECKPOINT, STEPS_MAX, isEnded,
  type Checkpoint, type CodeJob, type ComputeSettings, type ComputeUsage, type JobState, type JobStep, type OverlayFile, type PaidRule,
  type Placement, type StepKind, type StepStatus, type WaitingOn,
} from "./types.js";

export interface NewJob {
  userId: string;
  projectId: string;
  branch: string;
  task: string;
  budgetPaise: number;
  /** The agent loop drives it. */
  agent?: boolean;
}

export type JobPatch = Partial<Pick<CodeJob,
  "state" | "placement" | "leaseHolder" | "leaseEpoch" | "leaseExpiresAt" | "checkpoint" | "budgetPaise" | "spentPaise"
  | "reassignments" | "reason" | "waitingOn" | "agent" | "agentHolder" | "agentEpoch" | "agentExpiresAt"
>>;

/** The states an agent job can be claimed in: a step may be out or waiting for a place (the agent that died was waiting for it), but not waiting for the person's own word. */
export const CLAIMABLE_STATES: readonly JobState[] = ["queued", "running", "waiting_for_compute", "waiting_for_you"];
/** Whether an agent job in this state and wait can be claimed. */
export const claimable = (j: Pick<CodeJob, "agent" | "state" | "waitingOn">): boolean =>
  j.agent && CLAIMABLE_STATES.includes(j.state) && (j.state !== "waiting_for_you" || j.waitingOn === null || j.waitingOn === "paid" || j.waitingOn === "commit");

/** What a change to a job requires to still be true. */
export interface JobExpect {
  leaseEpoch?: number;
  states?: readonly JobState[];
  /** The kind of place holding the lease must still be this one. */
  placement?: Placement;
  /** The lease must have run out by this time (epoch ms). */
  leaseExpiredBy?: number;
  /** The job's spend must still be this many paise: how Xode's model calls add to it without losing a concurrent add (code/brain/spend.ts). */
  spentPaise?: number;
  /** The job's budget must still be this many paise: how more budget is added without losing a concurrent add. */
  budgetPaise?: number;
  /** The agent's claim must still be at this epoch: the fence of every write the agent loop makes. */
  agentEpoch?: number;
  /** The agent's claim has no time on it, or its time ran out by this time (epoch ms): the condition a claim is taken under. */
  agentFreeBy?: number;
}

export interface NewStep {
  kind: StepKind;
  commands: string[];
  timeoutSec: number;
  estimateMinutes: number;
  status: StepStatus;
  placement?: Placement;
  finishedAt?: number | null;
  overlay?: OverlayFile[];
  discard?: boolean;
  capture?: boolean;
}

export type StepPatch = Partial<Pick<JobStep, "status" | "placement" | "epoch" | "startedAt" | "finishedAt" | "exitCode" | "outputTail" | "minutes" | "overlay" | "captured" | "declined">>;

export const DEFAULT_SETTINGS: Readonly<Omit<ComputeSettings, "userId">> = { paidRule: "never", autoCapPaise: 0, githubEnabled: true };

export interface JobStore {
  createJob(n: NewJob): Promise<CodeJob>;
  /** The person's own job, or null. */
  getJob(userId: string, id: string): Promise<CodeJob | null>;
  /** Any job, by id: for the router's own work (the ticker, the agent), which has already said whose it is. */
  getJobById(id: string): Promise<CodeJob | null>;
  /** The person's jobs, newest first. */
  listJobs(userId: string, limit: number): Promise<CodeJob[]>;
  /** How many of the person's jobs are not over. */
  countLive(userId: string): Promise<number>;
  /** Changes the job if `expect` still holds. Returns the job as it is now, or null when it didn't hold (or there is no such job). */
  casJob(id: string, expect: JobExpect, patch: JobPatch): Promise<CodeJob | null>;
  /** The person's running jobs whose lease is held by this holder on this kind of place. */
  findHeld(userId: string, placement: Placement, holder: string): Promise<CodeJob[]>;
  /** Running jobs on a place whose lease ran out by `now`, oldest first. */
  listExpired(now: number, limit: number): Promise<CodeJob[]>;
  /** Running jobs on this kind of place, whatever their lease says, oldest first (the ticker looks at each step a place that sends no heartbeats has out). */
  listRunning(placement: Placement, limit: number): Promise<CodeJob[]>;
  /** Jobs waiting for compute, and jobs waiting for a yes to paid compute (not those waiting to commit or for the agent's own waits), oldest first; one person's, or everyone's. */
  listWaiting(limit: number, userId?: string): Promise<CodeJob[]>;
  /** The agent jobs nobody drives now (no time on the claim, or it ran out by `now`), in a state they can be claimed in, oldest first. */
  listClaimable(now: number, limit: number): Promise<CodeJob[]>;
  /** The agent jobs whose claim has run out by `now`, oldest first: the ticker gives them back. */
  listAgentExpired(now: number, limit: number): Promise<CodeJob[]>;

  /** Adds a step with the next number. "too_many" past STEPS_MAX. */
  addStep(jobId: string, n: NewStep): Promise<JobStep>;
  getStep(jobId: string, idx: number): Promise<JobStep | null>;
  /** The job's steps in order. */
  listSteps(jobId: string): Promise<JobStep[]>;
  updateStep(jobId: string, idx: number, patch: StepPatch): Promise<JobStep | null>;

  /** The person's settings; the defaults when they never saved any. */
  getSettings(userId: string): Promise<ComputeSettings>;
  saveSettings(userId: string, patch: Partial<Omit<ComputeSettings, "userId">>): Promise<ComputeSettings>;

  /** The person's use in a month ("YYYY-MM"); zeros when there is none. */
  getUsage(userId: string, month: string): Promise<ComputeUsage>;
  /** Adds to the month's use and returns the total. */
  addUsage(userId: string, month: string, add: { githubMinutes?: number; paidPaise?: number }): Promise<ComputeUsage>;
  /** Whether GitHub's free computers are marked used up (or unusable) for the person this month. */
  isGithubExhausted(userId: string, month: string): Promise<boolean>;
  /** Marks them so for the rest of the month ("YYYY-MM"). Idempotent. */
  markGithubExhausted(userId: string, month: string): Promise<void>;

  /** The month's GitHub Actions minutes Tailzu has used for the person (code_runner_minutes, migration 0031, code/live/minutes.ts); zeros when there is none. */
  getRunnerMinutes(userId: string, month: string): Promise<RunnerMinutes>;
  /**
   * Adds minutes and answers the total. `crossedNotify` is true for exactly ONE call in a month: the one that took the total to `notifyAt` or
   * past it, because the row's `notified_80` is flipped in the same statement (code_add_runner_minutes), so two results arriving together tell
   * the person once.
   */
  addRunnerMinutes(userId: string, month: string, minutes: number, notifyAt: number): Promise<{ minutes: number; crossedNotify: boolean }>;
}

/** A store that has hit the most steps a job can have. */
export class TooManySteps extends Error {
  constructor() { super(`A job can have ${STEPS_MAX} steps, which is the most.`); }
}

const cloneJob = (j: CodeJob): CodeJob => ({ ...j, checkpoint: cloneCheckpoint(j.checkpoint) });
const cloneCheckpoint = (c: Checkpoint): Checkpoint => ({ ...c, ...(c.agent ? { agent: structuredClone(c.agent) } : {}) });
const cloneStep = (s: JobStep): JobStep => ({ ...s, commands: [...s.commands], overlay: s.overlay.map((f) => ({ ...f })), captured: s.captured.map((f) => ({ ...f })), declined: [...s.declined] });

// -------------------------------------------------------------------- memory

export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, CodeJob>();
  private steps = new Map<string, JobStep[]>();
  private settings = new Map<string, ComputeSettings>();
  private usage = new Map<string, ComputeUsage>();
  private exhausted = new Set<string>();
  private runnerMinutes = new Map<string, RunnerMinutes>();

  /** `now` is for tests that move the clock. */
  constructor(private readonly now: () => number = Date.now) {}

  async createJob(n: NewJob) {
    const at = this.now();
    const j: CodeJob = {
      id: randomUUID(), userId: n.userId, projectId: n.projectId, branch: n.branch, task: n.task,
      state: "queued", placement: "none", leaseHolder: null, leaseEpoch: 0, leaseExpiresAt: null,
      checkpoint: { ...NO_CHECKPOINT }, budgetPaise: n.budgetPaise, spentPaise: 0,
      reassignments: 0, reason: "", waitingOn: null, agent: n.agent === true, agentHolder: null, agentEpoch: 0, agentExpiresAt: null,
      createdAt: at, updatedAt: at,
    };
    this.jobs.set(j.id, j);
    this.steps.set(j.id, []);
    return cloneJob(j);
  }
  async getJob(userId: string, id: string) {
    const j = this.jobs.get(id);
    return j && j.userId === userId ? cloneJob(j) : null;
  }
  async getJobById(id: string) {
    const j = this.jobs.get(id);
    return j ? cloneJob(j) : null;
  }
  async listJobs(userId: string, limit: number) {
    // Reversed first, so two made in the same millisecond still list the later one first.
    return [...this.jobs.values()].reverse().filter((j) => j.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(cloneJob);
  }
  async countLive(userId: string) {
    return [...this.jobs.values()].filter((j) => j.userId === userId && !isEnded(j.state)).length;
  }
  async casJob(id: string, expect: JobExpect, patch: JobPatch) {
    const j = this.jobs.get(id);
    if (!j) return null;
    if (expect.leaseEpoch !== undefined && j.leaseEpoch !== expect.leaseEpoch) return null;
    if (expect.states && !expect.states.includes(j.state)) return null;
    if (expect.placement !== undefined && j.placement !== expect.placement) return null;
    if (expect.leaseExpiredBy !== undefined && (j.leaseExpiresAt === null || j.leaseExpiresAt > expect.leaseExpiredBy)) return null;
    if (expect.spentPaise !== undefined && j.spentPaise !== expect.spentPaise) return null;
    if (expect.budgetPaise !== undefined && j.budgetPaise !== expect.budgetPaise) return null;
    if (expect.agentEpoch !== undefined && j.agentEpoch !== expect.agentEpoch) return null;
    if (expect.agentFreeBy !== undefined && j.agentExpiresAt !== null && j.agentExpiresAt > expect.agentFreeBy) return null;
    Object.assign(j, patch, { updatedAt: this.now() });
    if (patch.checkpoint) j.checkpoint = cloneCheckpoint(patch.checkpoint);
    return cloneJob(j);
  }
  async findHeld(userId: string, placement: Placement, holder: string) {
    return [...this.jobs.values()]
      .filter((j) => j.userId === userId && j.state === "running" && j.placement === placement && j.leaseHolder === holder).map(cloneJob);
  }
  async listExpired(now: number, limit: number) {
    return [...this.jobs.values()]
      .filter((j) => j.state === "running" && j.placement !== "none" && j.leaseExpiresAt !== null && j.leaseExpiresAt <= now)
      .sort((a, b) => a.leaseExpiresAt! - b.leaseExpiresAt!).slice(0, limit).map(cloneJob);
  }
  async listRunning(placement: Placement, limit: number) {
    return [...this.jobs.values()].filter((j) => j.state === "running" && j.placement === placement)
      .sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt).slice(0, limit).map(cloneJob);
  }
  async listWaiting(limit: number, userId?: string) {
    return [...this.jobs.values()]
      .filter((j) => (userId === undefined || j.userId === userId)
        && (j.state === "waiting_for_compute" || (j.state === "waiting_for_you" && (j.waitingOn === null || j.waitingOn === "paid"))))
      .sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt).slice(0, limit).map(cloneJob);
  }
  async listClaimable(now: number, limit: number) {
    return [...this.jobs.values()]
      .filter((j) => claimable(j) && (j.agentExpiresAt === null || j.agentExpiresAt <= now))
      .sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt).slice(0, limit).map(cloneJob);
  }
  async listAgentExpired(now: number, limit: number) {
    return [...this.jobs.values()]
      .filter((j) => j.agent && !isEnded(j.state) && j.agentHolder !== null && j.agentExpiresAt !== null && j.agentExpiresAt <= now)
      .sort((a, b) => a.agentExpiresAt! - b.agentExpiresAt!).slice(0, limit).map(cloneJob);
  }

  async addStep(jobId: string, n: NewStep) {
    const list = this.steps.get(jobId);
    if (!list) throw new Error("code jobs store: no such job");
    if (list.length >= STEPS_MAX) throw new TooManySteps();
    const s: JobStep = {
      jobId, idx: list.length, kind: n.kind, commands: [...n.commands], timeoutSec: n.timeoutSec, estimateMinutes: n.estimateMinutes,
      status: n.status, placement: n.placement ?? "none", epoch: 0, startedAt: null, finishedAt: n.finishedAt ?? null,
      exitCode: null, outputTail: "", minutes: 0, overlay: (n.overlay ?? []).map((f) => ({ ...f })), discard: n.discard === true,
      capture: n.capture === true, captured: [], declined: [],
    };
    list.push(s);
    return cloneStep(s);
  }
  async getStep(jobId: string, idx: number) {
    const s = this.steps.get(jobId)?.[idx];
    return s ? cloneStep(s) : null;
  }
  async listSteps(jobId: string) {
    return (this.steps.get(jobId) ?? []).map(cloneStep);
  }
  async updateStep(jobId: string, idx: number, patch: StepPatch) {
    const s = this.steps.get(jobId)?.[idx];
    if (!s) return null;
    Object.assign(s, patch, patch.overlay ? { overlay: patch.overlay.map((f) => ({ ...f })) } : {}, patch.captured ? { captured: patch.captured.map((f) => ({ ...f })) } : {}, patch.declined ? { declined: [...patch.declined] } : {});
    return cloneStep(s);
  }

  async getSettings(userId: string) {
    return { ...(this.settings.get(userId) ?? { userId, ...DEFAULT_SETTINGS }) };
  }
  async saveSettings(userId: string, patch: Partial<Omit<ComputeSettings, "userId">>) {
    const next: ComputeSettings = { ...(await this.getSettings(userId)), ...patch, userId };
    this.settings.set(userId, next);
    return { ...next };
  }

  async getUsage(userId: string, month: string) {
    return { ...(this.usage.get(`${userId}|${month}`) ?? { userId, month, githubMinutes: 0, paidPaise: 0 }) };
  }
  async addUsage(userId: string, month: string, add: { githubMinutes?: number; paidPaise?: number }) {
    const cur = await this.getUsage(userId, month);
    const next: ComputeUsage = {
      userId, month,
      githubMinutes: cur.githubMinutes + Math.max(0, Math.round(add.githubMinutes ?? 0)),
      paidPaise: cur.paidPaise + Math.max(0, Math.round(add.paidPaise ?? 0)),
    };
    this.usage.set(`${userId}|${month}`, next);
    return { ...next };
  }
  async isGithubExhausted(userId: string, month: string) { return this.exhausted.has(`${userId}|${month}`); }
  async markGithubExhausted(userId: string, month: string) { this.exhausted.add(`${userId}|${month}`); }

  async getRunnerMinutes(userId: string, month: string) {
    return { ...(this.runnerMinutes.get(`${userId}|${month}`) ?? { userId, month, minutes: 0, notified80: false }) };
  }
  async addRunnerMinutes(userId: string, month: string, minutes: number, notifyAt: number) {
    // No await between the read and the write: two results arriving together must not both read the old total (the database twin does it in one SQL call).
    const cur = this.runnerMinutes.get(`${userId}|${month}`) ?? { userId, month, minutes: 0, notified80: false };
    const total = cur.minutes + Math.max(0, Math.round(minutes));
    const crossedNotify = !cur.notified80 && total >= notifyAt;
    this.runnerMinutes.set(`${userId}|${month}`, { userId, month, minutes: total, notified80: cur.notified80 || crossedNotify });
    return { minutes: total, crossedNotify };
  }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: unknown): number | null => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback);

interface JobRow {
  id: string; user_id: string; project_id: string; branch: string; task: string; state: JobState; placement: Placement;
  lease_holder: string | null; lease_epoch: number; lease_expires_at: string | null; checkpoint: unknown;
  budget_paise: number; spent_paise: number; reassignments: number; reason: string | null; waiting_on: WaitingOn | null;
  agent: boolean | null; agent_holder: string | null; agent_epoch: number | null; agent_expires_at: string | null;
  created_at: string; updated_at: string;
}
interface StepRow {
  job_id: string; idx: number; kind: StepKind; commands: unknown; timeout_sec: number; estimate_minutes: number; status: StepStatus;
  placement: Placement; epoch: number; started_at: string | null; finished_at: string | null; exit_code: number | null;
  output_tail: string | null; minutes: number; overlay: unknown; discard: boolean | null; capture: boolean | null; captured: unknown; declined: unknown;
}
interface SettingsRow { user_id: string; paid_rule: PaidRule; auto_cap_paise: number; github_enabled: boolean }
interface UsageRow { user_id: string; month: string; github_minutes: number; paid_paise: number }

function checkpointOf(raw: unknown): Checkpoint {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    stepIndex: typeof c.stepIndex === "number" && Number.isInteger(c.stepIndex) && c.stepIndex >= -1 ? c.stepIndex : -1,
    headSha: typeof c.headSha === "string" ? c.headSha : "",
    notes: typeof c.notes === "string" ? c.notes : "",
    // The agent loop's state rides along untouched: it is the loop's to read, and nothing else makes sense of it.
    ...(c.agent && typeof c.agent === "object" && !Array.isArray(c.agent) ? { agent: c.agent as Record<string, unknown> } : {}),
  };
}

function overlayOf(raw: unknown): OverlayFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f): OverlayFile[] => {
    const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    return typeof x.path === "string" && (x.content === null || typeof x.content === "string") ? [{ path: x.path, content: x.content as string | null }] : [];
  });
}

const jobOf = (r: JobRow): CodeJob => ({
  id: r.id, userId: r.user_id, projectId: r.project_id, branch: r.branch, task: r.task, state: r.state, placement: r.placement,
  leaseHolder: r.lease_holder ?? null, leaseEpoch: int(r.lease_epoch), leaseExpiresAt: ms(r.lease_expires_at),
  checkpoint: checkpointOf(r.checkpoint), budgetPaise: int(r.budget_paise), spentPaise: int(r.spent_paise),
  reassignments: int(r.reassignments), reason: r.reason ?? "", waitingOn: r.waiting_on ?? null,
  agent: r.agent === true, agentHolder: r.agent_holder ?? null, agentEpoch: int(r.agent_epoch), agentExpiresAt: ms(r.agent_expires_at),
  createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
});
const stepOf = (r: StepRow): JobStep => ({
  jobId: r.job_id, idx: int(r.idx), kind: r.kind,
  commands: Array.isArray(r.commands) ? r.commands.filter((c): c is string => typeof c === "string") : [],
  timeoutSec: int(r.timeout_sec), estimateMinutes: int(r.estimate_minutes), status: r.status, placement: r.placement, epoch: int(r.epoch),
  startedAt: ms(r.started_at), finishedAt: ms(r.finished_at), exitCode: r.exit_code === null || r.exit_code === undefined ? null : int(r.exit_code),
  outputTail: r.output_tail ?? "", minutes: int(r.minutes), overlay: overlayOf(r.overlay), discard: r.discard === true,
  capture: r.capture === true, captured: overlayOf(r.captured), declined: Array.isArray(r.declined) ? r.declined.filter((x): x is string => typeof x === "string") : [],
});
const settingsOf = (r: SettingsRow): ComputeSettings => ({
  userId: r.user_id, paidRule: r.paid_rule, autoCapPaise: int(r.auto_cap_paise), githubEnabled: r.github_enabled !== false,
});
const usageOf = (r: UsageRow): ComputeUsage => ({ userId: r.user_id, month: r.month, githubMinutes: int(r.github_minutes), paidPaise: int(r.paid_paise) });

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code jobs store: ${res.error.message}`);
  return res.data;
}

export class SupabaseJobStore implements JobStore {
  constructor(private readonly sb: SupabaseClient) {}

  private who(userId: string): string {
    if (!UUID.test(userId)) throw new CodeNeedsAccount();
    return userId;
  }

  async createJob(n: NewJob) {
    const r = ok(await this.sb.from("code_jobs").insert({
      user_id: this.who(n.userId), project_id: n.projectId, branch: n.branch, task: n.task, budget_paise: n.budgetPaise,
      ...(n.agent === true ? { agent: true } : {}),
    }).select("*").single<JobRow>());
    return jobOf(r!);
  }
  async getJob(userId: string, id: string) {
    if (!UUID.test(id)) return null;
    const r = ok(await this.sb.from("code_jobs").select("*").eq("user_id", this.who(userId)).eq("id", id).maybeSingle<JobRow>());
    return r ? jobOf(r) : null;
  }
  async getJobById(id: string) {
    if (!UUID.test(id)) return null;
    const r = ok(await this.sb.from("code_jobs").select("*").eq("id", id).maybeSingle<JobRow>());
    return r ? jobOf(r) : null;
  }
  async listJobs(userId: string, limit: number) {
    const rows = ok(await this.sb.from("code_jobs").select("*").eq("user_id", this.who(userId))
      .order("created_at", { ascending: false }).limit(limit).returns<JobRow[]>());
    return (rows ?? []).map(jobOf);
  }
  async countLive(userId: string) {
    const res = await this.sb.from("code_jobs").select("id", { count: "exact", head: true })
      .eq("user_id", this.who(userId)).not("state", "in", "(done,failed,cancelled)");
    if (res.error) throw new Error(`code jobs store: ${res.error.message}`);
    return res.count ?? 0;
  }
  async casJob(id: string, expect: JobExpect, patch: JobPatch) {
    if (!UUID.test(id)) return null;
    const row: Record<string, unknown> = { updated_at: iso(Date.now()) };
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.placement !== undefined) row.placement = patch.placement;
    if (patch.leaseHolder !== undefined) row.lease_holder = patch.leaseHolder;
    if (patch.leaseEpoch !== undefined) row.lease_epoch = patch.leaseEpoch;
    if (patch.leaseExpiresAt !== undefined) row.lease_expires_at = patch.leaseExpiresAt === null ? null : iso(patch.leaseExpiresAt);
    if (patch.checkpoint !== undefined) row.checkpoint = patch.checkpoint;
    if (patch.budgetPaise !== undefined) row.budget_paise = patch.budgetPaise;
    if (patch.spentPaise !== undefined) row.spent_paise = patch.spentPaise;
    if (patch.reassignments !== undefined) row.reassignments = patch.reassignments;
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.waitingOn !== undefined) row.waiting_on = patch.waitingOn;
    if (patch.agent !== undefined) row.agent = patch.agent;
    if (patch.agentHolder !== undefined) row.agent_holder = patch.agentHolder;
    if (patch.agentEpoch !== undefined) row.agent_epoch = patch.agentEpoch;
    if (patch.agentExpiresAt !== undefined) row.agent_expires_at = patch.agentExpiresAt === null ? null : iso(patch.agentExpiresAt);
    let q = this.sb.from("code_jobs").update(row).eq("id", id);
    if (expect.leaseEpoch !== undefined) q = q.eq("lease_epoch", expect.leaseEpoch);
    if (expect.states) q = q.in("state", [...expect.states]);
    if (expect.placement !== undefined) q = q.eq("placement", expect.placement);
    if (expect.leaseExpiredBy !== undefined) q = q.lte("lease_expires_at", iso(expect.leaseExpiredBy));
    if (expect.spentPaise !== undefined) q = q.eq("spent_paise", expect.spentPaise);
    if (expect.budgetPaise !== undefined) q = q.eq("budget_paise", expect.budgetPaise);
    if (expect.agentEpoch !== undefined) q = q.eq("agent_epoch", expect.agentEpoch);
    if (expect.agentFreeBy !== undefined) q = q.or(`agent_expires_at.is.null,agent_expires_at.lte.${iso(expect.agentFreeBy)}`);
    const r = ok(await q.select("*").maybeSingle<JobRow>());
    return r ? jobOf(r) : null;
  }
  async findHeld(userId: string, placement: Placement, holder: string) {
    const rows = ok(await this.sb.from("code_jobs").select("*").eq("user_id", this.who(userId)).eq("state", "running")
      .eq("placement", placement).eq("lease_holder", holder).returns<JobRow[]>());
    return (rows ?? []).map(jobOf);
  }
  async listExpired(now: number, limit: number) {
    const rows = ok(await this.sb.from("code_jobs").select("*").eq("state", "running").neq("placement", "none")
      .not("lease_expires_at", "is", null).lte("lease_expires_at", iso(now)).order("lease_expires_at").limit(limit).returns<JobRow[]>());
    return (rows ?? []).map(jobOf);
  }
  async listRunning(placement: Placement, limit: number) {
    const rows = ok(await this.sb.from("code_jobs").select("*").eq("state", "running").eq("placement", placement)
      .order("updated_at").limit(limit).returns<JobRow[]>());
    return (rows ?? []).map(jobOf);
  }
  async listWaiting(limit: number, userId?: string) {
    let q = this.sb.from("code_jobs").select("*").in("state", ["waiting_for_compute", "waiting_for_you"])
      .or("waiting_on.is.null,waiting_on.eq.paid").order("updated_at").limit(limit);
    if (userId !== undefined) q = q.eq("user_id", this.who(userId));
    return (ok(await q.returns<JobRow[]>()) ?? []).map(jobOf);
  }
  async listClaimable(now: number, limit: number) {
    // The claim's own condition is in the query (nobody holds it, or its time ran out); the wait is read here, since a wait that is the person's own to end is not one to claim.
    const rows = ok(await this.sb.from("code_jobs").select("*").eq("agent", true).in("state", [...CLAIMABLE_STATES])
      .or(`agent_expires_at.is.null,agent_expires_at.lte.${iso(now)}`).order("updated_at").limit(limit * 3).returns<JobRow[]>());
    return (rows ?? []).map(jobOf).filter(claimable).slice(0, limit);
  }
  async listAgentExpired(now: number, limit: number) {
    const rows = ok(await this.sb.from("code_jobs").select("*").eq("agent", true).not("state", "in", "(done,failed,cancelled)")
      .not("agent_holder", "is", null).lte("agent_expires_at", iso(now)).order("agent_expires_at").limit(limit).returns<JobRow[]>());
    return (rows ?? []).map(jobOf);
  }

  async addStep(jobId: string, n: NewStep) {
    // The next number is one past the last; the table's primary key (job_id, idx) refuses a second step made with the same number at the same moment, and it is asked again.
    for (let attempt = 0; ; attempt += 1) {
      const last = ok(await this.sb.from("code_job_steps").select("idx").eq("job_id", jobId).order("idx", { ascending: false }).limit(1).returns<Array<{ idx: number }>>());
      const idx = last && last.length ? int(last[0]!.idx) + 1 : 0;
      if (idx >= STEPS_MAX) throw new TooManySteps();
      const res = await this.sb.from("code_job_steps").insert({
        job_id: jobId, idx, kind: n.kind, commands: n.commands, timeout_sec: n.timeoutSec, estimate_minutes: n.estimateMinutes,
        status: n.status, placement: n.placement ?? "none", finished_at: n.finishedAt === undefined || n.finishedAt === null ? null : iso(n.finishedAt),
        ...(n.overlay?.length ? { overlay: n.overlay } : {}), ...(n.discard === true ? { discard: true } : {}), ...(n.capture === true ? { capture: true } : {}),
      }).select("*").single<StepRow>();
      if (!res.error) return stepOf(res.data!);
      if (attempt < 3 && /duplicate key|unique/i.test(res.error.message)) continue;
      throw new Error(`code jobs store: ${res.error.message}`);
    }
  }
  async getStep(jobId: string, idx: number) {
    if (!UUID.test(jobId)) return null;
    const r = ok(await this.sb.from("code_job_steps").select("*").eq("job_id", jobId).eq("idx", idx).maybeSingle<StepRow>());
    return r ? stepOf(r) : null;
  }
  async listSteps(jobId: string) {
    if (!UUID.test(jobId)) return [];
    const rows = ok(await this.sb.from("code_job_steps").select("*").eq("job_id", jobId).order("idx").returns<StepRow[]>());
    return (rows ?? []).map(stepOf);
  }
  async updateStep(jobId: string, idx: number, patch: StepPatch) {
    if (!UUID.test(jobId)) return null;
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.placement !== undefined) row.placement = patch.placement;
    if (patch.epoch !== undefined) row.epoch = patch.epoch;
    if (patch.startedAt !== undefined) row.started_at = patch.startedAt === null ? null : iso(patch.startedAt);
    if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt === null ? null : iso(patch.finishedAt);
    if (patch.exitCode !== undefined) row.exit_code = patch.exitCode;
    if (patch.outputTail !== undefined) row.output_tail = patch.outputTail;
    if (patch.minutes !== undefined) row.minutes = patch.minutes;
    if (patch.overlay !== undefined) row.overlay = patch.overlay;
    if (patch.captured !== undefined) row.captured = patch.captured;
    if (patch.declined !== undefined) row.declined = patch.declined;
    if (!Object.keys(row).length) return this.getStep(jobId, idx);
    const r = ok(await this.sb.from("code_job_steps").update(row).eq("job_id", jobId).eq("idx", idx).select("*").maybeSingle<StepRow>());
    return r ? stepOf(r) : null;
  }

  async getSettings(userId: string) {
    const r = ok(await this.sb.from("code_compute_settings").select("*").eq("user_id", this.who(userId)).maybeSingle<SettingsRow>());
    return r ? settingsOf(r) : { userId, ...DEFAULT_SETTINGS };
  }
  async saveSettings(userId: string, patch: Partial<Omit<ComputeSettings, "userId">>) {
    const next: ComputeSettings = { ...(await this.getSettings(userId)), ...patch, userId };
    const r = ok(await this.sb.from("code_compute_settings").upsert({
      user_id: this.who(userId), paid_rule: next.paidRule, auto_cap_paise: next.autoCapPaise, github_enabled: next.githubEnabled,
      updated_at: iso(Date.now()),
    }, { onConflict: "user_id" }).select("*").single<SettingsRow>());
    return settingsOf(r!);
  }

  async getUsage(userId: string, month: string) {
    const r = ok(await this.sb.from("code_compute_usage").select("*").eq("user_id", this.who(userId)).eq("month", month).maybeSingle<UsageRow>());
    return r ? usageOf(r) : { userId, month, githubMinutes: 0, paidPaise: 0 };
  }
  async addUsage(userId: string, month: string, add: { githubMinutes?: number; paidPaise?: number }) {
    const r = ok(await this.sb.rpc("code_add_usage", {
      p_user: this.who(userId), p_month: month,
      p_minutes: Math.max(0, Math.round(add.githubMinutes ?? 0)), p_paise: Math.max(0, Math.round(add.paidPaise ?? 0)),
    }).single<UsageRow>());
    return usageOf(r!);
  }
  async isGithubExhausted(userId: string, month: string) {
    const r = ok(await this.sb.from("code_compute_usage").select("github_exhausted").eq("user_id", this.who(userId)).eq("month", month)
      .maybeSingle<{ github_exhausted: boolean | null }>());
    return r?.github_exhausted === true;
  }
  async markGithubExhausted(userId: string, month: string) {
    // Only this column is written; the month's figures (and a row that is not there yet, at zero) are left to code_add_usage.
    ok(await this.sb.from("code_compute_usage").upsert({ user_id: this.who(userId), month, github_exhausted: true }, { onConflict: "user_id,month" }).select("user_id").maybeSingle());
  }

  async getRunnerMinutes(userId: string, month: string) {
    const r = ok(await this.sb.from("code_runner_minutes").select("actions_minutes, notified_80").eq("user_id", this.who(userId)).eq("month", month)
      .maybeSingle<{ actions_minutes: number; notified_80: boolean }>());
    return { userId, month, minutes: r?.actions_minutes ?? 0, notified80: r?.notified_80 === true };
  }
  async addRunnerMinutes(userId: string, month: string, minutes: number, notifyAt: number) {
    const r = ok(await this.sb.rpc("code_add_runner_minutes", {
      p_user: this.who(userId), p_month: month, p_minutes: Math.max(0, Math.round(minutes)), p_notify_at: Math.max(0, Math.round(notifyAt)),
    }).single<{ total_minutes: number; crossed: boolean }>());
    return { minutes: r?.total_minutes ?? 0, crossedNotify: r?.crossed === true };
  }
}

// ------------------------------------------------------------------ the one

let current: JobStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). A job that changes says so to the person's open
 *  screens (live/writes.ts liveJobStore). */
export function jobStore(): JobStore {
  if (!current) {
    const sb = supabase();
    current = liveJobStore(sb ? new SupabaseJobStore(sb) : new MemoryJobStore());
  }
  return current;
}

export function resetJobStoreForTests(): void { current = null; }

/**
 * THE ENVIRONMENT ROUTER: WHERE EACH STEP OF A CODING JOB THAT NEEDS A COMPUTER RUNS.
 *
 * A job is made of steps (types.ts). An "edit" needs no computer: it is the
 * workspace API (projects.ts workspace) and is only recorded here. An "exec"
 * runs commands, and the router puts it on the cheapest place there is
 * (placement.ts): the person's own PC, then GitHub's free computers, then paid
 * compute under the person's own rule, and otherwise it WAITS and tells them.
 *
 * The agent's brain that makes the steps is not built yet. The router is driven
 * by the methods below, which the brain and the tests call:
 *
 *   createJob, addEditStep, requestExec, finishJob, cancelJob    the brain's
 *   heartbeat, next, progress, submitResult                      a PC's (the runner protocol)
 *   approvePaid, approveCommit                                   the person's two yeses
 *   tick, wake                                                   the clock's
 *
 * LEASES AND FENCING. A step that is out has a lease: one holder, an expiry 90
 * seconds ahead, and an epoch that goes up by one on EVERY dispatch. The
 * holder keeps it by sending a heartbeat (a PC that says it is busy) or
 * progress for the job; every result and every progress call carries the epoch
 * it was given, and anything carrying an older one is refused as
 * "stale_lease". So when a PC goes quiet, its lease runs out, the job is moved
 * (a new dispatch, a new epoch), and if the old PC comes back and sends its
 * result it is turned away: two machines never both count. The only thing that
 * takes a lease away is the ticker (every 15 seconds); until it has, the
 * holder with the current epoch is still the holder, so a result a few seconds
 * late still lands if nobody else has been given the step.
 *
 * CHECKPOINTS. When a step finishes the job records `{ stepIndex, headSha,
 * notes }`. A step that was out when its place went quiet goes back to
 * "pending" and is placed again: only the unfinished step runs again, from the
 * branch as it is. A job moved FIVE times is failed, with the reason, instead
 * of moving for ever.
 *
 * WAITING. A step with no place puts the job in `waiting_for_compute` and the
 * person gets "compute_paused"; one that needs their yes to paid compute
 * puts it in `waiting_for_you` and they get "compute_ask". Either goes on by
 * itself, in the same request when a PC sends a heartbeat or a setting
 * changes, or at the next tick: a PC coming online, the month turning over
 * (GitHub's minutes are counted by calendar month, UTC), a result freeing a PC,
 * or the person saying yes (approvePaid).
 *
 * WHAT A PC SENDS BACK is a result: exit code, the end of the output, minutes,
 * and optionally CHANGES (files). The runner never holds a token that can
 * write: it clones with a read-only token (projects.ts runnerAccess "read"),
 * and the SERVER commits its changes through the same policy as any commit
 * (projects.ts commitToBranch, with nobody there to ask: `attended: false`).
 * Where the policy would ask (a branch that isn't Tailzu's own, a workflow
 * file, something that looks like a secret) the job goes to `waiting_for_you`,
 * the person gets "commit_ask", and the changes are held in this server's
 * memory (never the database: they may hold the very thing that made it ask)
 * until they say yes (approveCommit: the same two-step question as every other
 * commit). If the server restarts before that, the step simply runs again.
 * Changes are committed only from a step that exited 0.
 *
 * MONEY. The user's rule (settings) is "never", "ask" or "auto" up to a monthly
 * cap in paise. A job's `budgetPaise` is what the person has said yes to for
 * THAT job (approvePaid raises it; createJob can start it above 0); spending
 * is only ever drawn from it or from the automatic cap, and what a paid place
 * reports it used is added to `spentPaise` and to the month's use.
 *
 * Everything that changes a person's jobs runs under one lock per person
 * (util.ts), and every change that depends on the lease goes through the
 * store's casJob, so a ticker, a request and a second server can't both win.
 */
import { ConnectorError } from "../../connectors/oauth.js";
import type { CommitFile } from "../github.js";
import { PolicyError, isNeedsApproval, type NeedsApproval } from "../policy.js";
import { commitToBranch, ownProject, recordedBranch, repoRef, runnerAccess, type ProjectDeps } from "../projects.js";
import { DeviceBook, allows, type DeviceBeat } from "./devices.js";
import { choosePlacement, githubMinutesLeft, GITHUB_FREE_MINUTES_DEFAULT, type PlacementChoice, type PlacementCtx } from "./placement.js";
import { DesktopProvider, type Availability, type ComputeProvider } from "./providers.js";
import type { JobStore } from "./store.js";
import { TooManySteps } from "./store.js";
import {
  CHANGES_MAX, COMMANDS_MAX, COMMAND_CHARS, DEVICE_ONLINE_MS, DEVICE_PROJECTS_MAX, ESTIMATE_MAX_MINUTES, LEASE_MS, LIVE_JOBS_MAX,
  MAX_REASSIGNMENTS, PAISE_MAX, STEPS_MAX, TASK_KEEP, TIMEOUT_DEFAULT_SEC, TIMEOUT_MAX_SEC,
  brief, isEnded, monthKey,
  type CodeJob, type ComputeKind, type ComputeSettings, type ComputeUsage, type JobState, type JobStep, type Notify, type NotifyData,
  type NotifyKind, type Placement, type WaitingOn,
} from "./types.js";
import { KeyedLock, keepOutput, tailBytes } from "./util.js";

// ---------------------------------------------------------------- the shapes

export interface JobRouterOptions {
  store: JobStore;
  /** The Code bot's own pieces (projects.ts): the store of projects and branches, GitHub, the approvals. */
  projects: ProjectDeps;
  /** GitHub's free computers. Absent: not built or not set up, and never chosen. */
  github?: ComputeProvider | null;
  /** Paid compute. Absent: never chosen. */
  paid?: ComputeProvider | null;
  devices?: DeviceBook;
  notify?: Notify;
  /** Epoch ms. Tests move it. */
  now?: () => number;
  /** GitHub's monthly free allowance in minutes (CODE_GITHUB_FREE_MINUTES). */
  freeMinutes?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** What a PC is given to run. */
export interface RunnerStep {
  jobId: string;
  stepIdx: number;
  /** Goes back with every progress and result call. */
  epoch: number;
  commands: string[];
  timeoutSec: number;
  repo: {
    /** "app": clone with the read-only token. "oauth": download the tarball; the person's own token is never given out. */
    kind: "app" | "oauth";
    cloneUrl: string;
    branch: string;
    headSha: string;
    /** A token for this one repo that can read and nothing else, with when it stops working (epoch ms). App projects only. */
    readToken?: string;
    readTokenExpiresAt?: number;
    /** A one-time download link for the branch at headSha. Sign-in projects only. */
    tarballUrl?: string;
  };
}

export type RunnerHeartbeat = DeviceBeat;

export interface HeartbeatAck {
  ok: true;
  onlineForSec: number;
  /** Leases this heartbeat renewed (a busy PC keeps its step). */
  leasesRenewed: number;
}

/** What a step reports. `changes` and `paise` are checked by readResult. */
export interface StepResult {
  jobId: string;
  stepIdx: number;
  epoch: number;
  exitCode: number;
  outputTail: string;
  /** Whole minutes, rounded up. */
  minutes: number;
  changes?: Array<{ path: string; content: string | null }>;
  /** Paid places only: what the step cost, in paise. */
  paise?: number;
}

export interface ResultAck {
  ok: true;
  /** The state the job is in now. */
  state: JobState;
  committed: boolean;
  sha?: string;
  /** The changes need the person's yes before they are committed. */
  waitingForYou?: boolean;
  /** The changes were not committed, and why (a policy code, or a plain failure code). */
  refused?: string;
  /** Changes sent with a step that failed are not committed. */
  changesIgnored?: boolean;
  /** The same result had been counted already. */
  duplicate?: boolean;
}

export type JobOutcome = { ok: true; summary?: string } | { ok: false; reason: string };

export interface EditRecord {
  /** One line of what was done. */
  summary?: string;
  /** The paths changed. */
  files?: string[];
  /** The branch's head after the edit, if it committed. */
  headSha?: string;
}

export interface TickReport { expired: number; moved: number; failed: number; woken: number }

// ------------------------------------------------------------------- errors

const bad = (m: string) => new ConnectorError("bad_request", m);
const missing = () => new ConnectorError("not_found", "I couldn't find that job.");
const stale = () => new ConnectorError("stale_lease", "That step was given to another computer, or the job has stopped. Drop it.");
const inFlight = () => new ConnectorError("step_in_flight", "A step of this job is still out. Wait for it, or cancel the job.");
const over = () => new ConnectorError("job_over", "That job is over.");
const notWaiting = (what: string) => new ConnectorError("not_waiting", `That job isn't waiting for ${what}.`);

/** Failures of GitHub that are worth asking again, not a verdict on the change. */
const TRANSIENT = new Set(["failed", "busy", "github_auth"]);

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

const DEVICE_ID = /^[A-Za-z0-9._:-]{8,100}$/;
const SHA = /^[0-9a-f]{40}$/;

export function readHeartbeat(body: unknown): RunnerHeartbeat {
  const b = asObject(body);
  if (typeof b.deviceId !== "string" || !DEVICE_ID.test(b.deviceId)) throw bad("deviceId is the id your app made for this computer (8 to 100 letters, digits, . _ : -).");
  if (typeof b.allowRun !== "boolean") throw bad("allowRun is true or false.");
  if (b.busy !== undefined && typeof b.busy !== "boolean") throw bad("busy is true or false.");
  let projects: string[] | "all";
  if (b.projects === "all") projects = "all";
  else if (Array.isArray(b.projects) && b.projects.length <= DEVICE_PROJECTS_MAX && b.projects.every((p) => typeof p === "string" && p.length > 0 && p.length <= 64)) {
    projects = b.projects as string[];
  } else throw bad(`projects is "all", or a list of at most ${DEVICE_PROJECTS_MAX} project ids.`);
  const name = typeof b.name === "string" ? [...b.name.trim()].slice(0, 80).join("") : "";
  return { deviceId: b.deviceId, name: name || "This computer", allowRun: b.allowRun, projects, busy: b.busy === true };
}

/** The result of a step, checked. `via` decides whether `paise` is read: only a paid place may say what it cost. */
export function readResult(body: unknown, via: ComputeKind): StepResult {
  const b = asObject(body);
  if (typeof b.jobId !== "string" || !b.jobId || b.jobId.length > 64) throw bad("jobId is the job's id.");
  if (!isInt(b.stepIdx, 0, STEPS_MAX)) throw bad("stepIdx is the step's number.");
  if (!isInt(b.epoch, 1, Number.MAX_SAFE_INTEGER)) throw bad("epoch is the number you were given with the step.");
  if (!isInt(b.exitCode, -1_000_000, 1_000_000)) throw bad("exitCode is a whole number.");
  if (b.outputTail !== undefined && typeof b.outputTail !== "string") throw bad("outputTail is text.");
  if (typeof b.minutes !== "number" || !Number.isFinite(b.minutes) || b.minutes < 0 || b.minutes > 24 * 60) throw bad("minutes is how long the step ran, 0 to 1440.");
  let changes: StepResult["changes"];
  if (b.changes !== undefined) {
    if (!Array.isArray(b.changes) || b.changes.length > CHANGES_MAX) throw bad(`changes is a list of at most ${CHANGES_MAX} files.`);
    changes = b.changes.map((c) => {
      const f = asObject(c);
      if (typeof f.path !== "string" || !f.path) throw bad("Each change has a path.");
      if (f.content !== null && typeof f.content !== "string") throw bad("A change's content is the file's text, or null to delete it.");
      return { path: f.path, content: f.content as string | null };
    });
  }
  let paise: number | undefined;
  if (via === "paid" && b.paise !== undefined) {
    if (!isInt(b.paise, 0, PAISE_MAX)) throw bad("paise is a whole number.");
    paise = b.paise;
  }
  return {
    jobId: b.jobId, stepIdx: b.stepIdx, epoch: b.epoch, exitCode: b.exitCode,
    outputTail: typeof b.outputTail === "string" ? b.outputTail : "", minutes: Math.ceil(b.minutes),
    ...(changes ? { changes } : {}), ...(paise !== undefined ? { paise } : {}),
  };
}

const WHERE: Record<Placement, string> = { none: "nowhere", desktop: "your own computer", github: "GitHub's free computers", paid: "paid compute" };

interface Waiter { nudge: () => void }
interface Pending { stepIdx: number; files: CommitFile[]; message: string; at: number }
/** Changes held for a yes: a day, and no more than this many at once. */
const PENDING_KEEP_MS = 24 * 60 * 60_000;
const PENDING_MAX = 200;

// ------------------------------------------------------------------ the router

export class JobRouter {
  readonly devices: DeviceBook;
  readonly desktop: DesktopProvider;
  private readonly store: JobStore;
  private readonly deps: ProjectDeps;
  private readonly lock = new KeyedLock();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly held = new Map<string, Pending>();
  private readonly freeMinutes: number;
  private readonly clock: () => number;

  constructor(private readonly o: JobRouterOptions) {
    this.store = o.store;
    this.deps = o.projects;
    this.clock = o.now ?? Date.now;
    this.freeMinutes = o.freeMinutes ?? GITHUB_FREE_MINUTES_DEFAULT;
    this.devices = o.devices ?? new DeviceBook();
    this.desktop = new DesktopProvider({ devices: this.devices, store: this.store, now: this.clock });
  }

  now(): number { return this.clock(); }

  // -------------------------------------------------------- the brain's API

  /**
   * Makes a job on a branch Tailzu made in the person's project. `budgetPaise`
   * is what the person has already said this job may spend on paid compute (0:
   * nothing yet; the rule decides whether to ask). At most 20 jobs not yet over.
   */
  async createJob(userId: string, projectId: string, branch: string, task: string, budgetPaise = 0): Promise<CodeJob> {
    const text = typeof task === "string" ? task.trim() : "";
    if (!text) throw bad("Say what the task is.");
    if (!isInt(budgetPaise, 0, PAISE_MAX)) throw bad(`budgetPaise is a whole number of paise, 0 to ${PAISE_MAX}.`);
    return this.lock.run(userId, async () => {
      const project = await ownProject(this.deps, userId, projectId);
      const rec = await recordedBranch(this.deps, project, branch);
      if (rec.state === "deleted") throw new ConnectorError("branch_deleted", "That branch has been deleted from GitHub.");
      if ((await this.store.countLive(userId)) >= LIVE_JOBS_MAX) {
        throw new ConnectorError("too_many", `You have ${LIVE_JOBS_MAX} jobs going, which is the most. Let one finish or cancel one first.`);
      }
      return this.store.createJob({ userId, projectId: project.id, branch: rec.branch, task: [...text].slice(0, TASK_KEEP).join(""), budgetPaise });
    });
  }

  /**
   * Records an edit that was done through the workspace (reading, changing and
   * committing files over GitHub's API: no computer needed). It is a finished
   * step the moment it is written, and moves the checkpoint.
   */
  async addEditStep(jobId: string, e: EditRecord = {}): Promise<{ job: CodeJob; step: JobStep }> {
    const files = e.files ?? [];
    if (!Array.isArray(files) || files.length > CHANGES_MAX || files.some((f) => typeof f !== "string" || !f || f.length > 500)) {
      throw bad(`files is a list of at most ${CHANGES_MAX} paths.`);
    }
    if (e.headSha !== undefined && (typeof e.headSha !== "string" || !SHA.test(e.headSha))) throw bad("headSha is a full commit id.");
    if (e.summary !== undefined && typeof e.summary !== "string") throw bad("summary is text.");
    return this.withJob(jobId, async (job) => {
      this.mustBeLive(job);
      if (await this.inflight(job.id)) throw inFlight();
      const step = await this.addStep(job.id, { kind: "edit", commands: files, timeoutSec: 0, estimateMinutes: 0, status: "done", finishedAt: this.now() });
      const notes = brief(e.summary?.trim() || `Edited ${files.length} file${files.length === 1 ? "" : "s"}.`, 200);
      const next = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["queued", "running"] }, {
        state: "running", reason: "", checkpoint: { stepIndex: step.idx, headSha: e.headSha ?? job.checkpoint.headSha, notes },
      });
      if (!next) throw inFlight();
      return { job: next, step };
    });
  }

  /**
   * Asks for commands to be run, and places them (see the top of this file).
   * The job comes back running on a place, or waiting for compute, or waiting
   * for the person's yes to paid compute. One exec step at a time.
   */
  async requestExec(
    jobId: string, commands: string[], timeoutSec: number = TIMEOUT_DEFAULT_SEC, estimateMinutes = 1,
  ): Promise<{ job: CodeJob; step: JobStep }> {
    if (!Array.isArray(commands) || !commands.length || commands.length > COMMANDS_MAX
      || commands.some((c) => typeof c !== "string" || !c.trim() || c.length > COMMAND_CHARS)) {
      throw bad(`commands is a list of 1 to ${COMMANDS_MAX} commands, each at most ${COMMAND_CHARS} characters.`);
    }
    if (!isInt(timeoutSec, 1, TIMEOUT_MAX_SEC)) throw bad(`timeoutSec is whole seconds, 1 to ${TIMEOUT_MAX_SEC}.`);
    if (typeof estimateMinutes !== "number" || !Number.isFinite(estimateMinutes) || estimateMinutes < 0 || estimateMinutes > ESTIMATE_MAX_MINUTES) {
      throw bad(`estimateMinutes is how long it should take, 0 to ${ESTIMATE_MAX_MINUTES}.`);
    }
    const minutes = Math.max(1, Math.ceil(estimateMinutes));
    return this.withJob(jobId, async (job) => {
      this.mustBeLive(job);
      if (job.state === "paused") throw new ConnectorError("conflict", "That job is paused.");
      if (await this.inflight(job.id)) throw inFlight();
      const step = await this.addStep(job.id, { kind: "exec", commands, timeoutSec, estimateMinutes: minutes, status: "pending" });
      const after = await this.place(job, step, { prior: { state: job.state, waitingOn: null } });
      return { job: after, step: (await this.store.getStep(job.id, step.idx)) ?? step };
    });
  }

  /** The brain is done: `ok` is done, otherwise failed with the reason. Done needs no step still out; failing stops one. */
  async finishJob(jobId: string, outcome: JobOutcome): Promise<CodeJob> {
    if (!outcome || typeof outcome !== "object" || typeof outcome.ok !== "boolean") throw bad("outcome is { ok: true } or { ok: false, reason }.");
    return this.withJob(jobId, async (job) => {
      if (isEnded(job.state)) return job;
      if (outcome.ok) {
        if (await this.inflight(job.id)) throw inFlight();
        const summary = typeof outcome.summary === "string" ? brief(outcome.summary, 200) : "";
        return this.end(job, "done", "", summary ? { ...job.checkpoint, notes: summary } : undefined);
      }
      return this.end(job, "failed", brief(typeof outcome.reason === "string" && outcome.reason.trim() ? outcome.reason : "The job could not be finished.", 300));
    });
  }

  /** Stops a job: nothing more is dispatched, the step that is out is dropped, and its late result is refused. Over already: left as it is. */
  async cancelJob(jobId: string): Promise<CodeJob> {
    return this.withJob(jobId, async (job) => (isEnded(job.state) ? job : this.end(job, "cancelled", "You stopped this job.")));
  }

  // -------------------------------------------------------- reading

  /** The person's own job, or "not found". */
  async job(userId: string, jobId: string): Promise<CodeJob> {
    const j = await this.store.getJob(userId, jobId);
    if (!j) throw missing();
    return j;
  }

  async jobWithSteps(userId: string, jobId: string): Promise<{ job: CodeJob; steps: JobStep[] }> {
    const job = await this.job(userId, jobId);
    return { job, steps: await this.store.listSteps(job.id) };
  }

  async listJobs(userId: string, limit = 50): Promise<CodeJob[]> {
    return this.store.listJobs(userId, Math.max(1, Math.min(200, Math.floor(limit))));
  }

  // ----------------------------------------------------- the person's rules

  /** The person's settings, with this month's use and what is left of GitHub's free minutes. */
  async settingsView(userId: string): Promise<{
    settings: Omit<ComputeSettings, "userId">;
    githubFreeMinutes: { allowance: number; headroomPercent: number; used: number; left: number };
    usage: Omit<ComputeUsage, "userId">;
    providers: { github: boolean; paid: boolean };
  }> {
    const [s, u] = await Promise.all([this.store.getSettings(userId), this.store.getUsage(userId, monthKey(this.now()))]);
    return {
      settings: { paidRule: s.paidRule, autoCapPaise: s.autoCapPaise, githubEnabled: s.githubEnabled },
      githubFreeMinutes: { allowance: this.freeMinutes, headroomPercent: 10, used: u.githubMinutes, left: githubMinutesLeft(this.freeMinutes, u.githubMinutes) },
      usage: { month: u.month, githubMinutes: u.githubMinutes, paidPaise: u.paidPaise },
      providers: { github: !!this.o.github, paid: !!this.o.paid },
    };
  }

  /** Changes some of the person's settings. A rule that frees a waiting job lets it go on at once. */
  async saveSettings(userId: string, body: unknown): Promise<ComputeSettings> {
    const b = asObject(body);
    const patch: Partial<Omit<ComputeSettings, "userId">> = {};
    if (b.paidRule !== undefined) {
      if (b.paidRule !== "never" && b.paidRule !== "ask" && b.paidRule !== "auto") throw bad('paidRule is "never", "ask" or "auto".');
      patch.paidRule = b.paidRule;
    }
    if (b.autoCapPaise !== undefined) {
      if (!isInt(b.autoCapPaise, 0, PAISE_MAX)) throw bad(`autoCapPaise is a whole number of paise a month, 0 to ${PAISE_MAX}.`);
      patch.autoCapPaise = b.autoCapPaise;
    }
    if (b.githubEnabled !== undefined) {
      if (typeof b.githubEnabled !== "boolean") throw bad("githubEnabled is true or false.");
      patch.githubEnabled = b.githubEnabled;
    }
    return this.lock.run(userId, async () => {
      const saved = await this.store.saveSettings(userId, patch);
      await this.wakeLocked(userId);
      return saved;
    });
  }

  // ----------------------------------------------------- the person's yeses

  /**
   * Yes to paid compute for this job, after a "compute_ask". `maxPaise` is how
   * much more it may spend (at least what the step is expected to cost; left
   * out, exactly that). It raises the job's budget; the job then goes on
   * wherever is cheapest, which is paid unless something free has come up.
   * Refused if the rule is "never" (the person has to change that first).
   */
  async approvePaid(userId: string, jobId: string, maxPaise?: number): Promise<CodeJob> {
    if (maxPaise !== undefined && !isInt(maxPaise, 1, PAISE_MAX)) throw bad(`maxPaise is a whole number of paise, 1 to ${PAISE_MAX}.`);
    return this.lock.run(userId, async () => {
      const job = await this.job(userId, jobId);
      if (job.state !== "waiting_for_you" || job.waitingOn !== "paid") throw notWaiting("a yes to paid compute");
      const settings = await this.store.getSettings(userId);
      if (settings.paidRule === "never") throw new ConnectorError("paid_off", 'Paid compute is set to "never". Change that in your settings first.');
      const step = await this.pendingExec(job.id);
      const paid = this.o.paid ? await this.available(this.o.paid, job, step?.estimateMinutes ?? 1) : { ok: false };
      if (!step || !paid.ok) throw new ConnectorError("paid_unavailable", "There is no paid compute to use right now.");
      const estimate = Math.max(0, Math.ceil(paid.estimatePaise ?? 0));
      if (maxPaise !== undefined && maxPaise < estimate) throw bad("That is less than this step is expected to cost.");
      const budget = Math.max(job.budgetPaise, job.spentPaise + (maxPaise ?? estimate));
      const raised = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["waiting_for_you"] }, { budgetPaise: budget });
      if (!raised) throw notWaiting("a yes to paid compute");
      return this.place(raised, step, { prior: { state: raised.state, waitingOn: raised.waitingOn } });
    });
  }

  /**
   * Yes to committing what a step produced, after a "commit_ask". The same two
   * steps as every question (policy.ts gate): with no `approvalId` this does
   * nothing and answers the question (what would be committed, by name); with
   * the id it gave, it commits exactly that. Then the step is finished and the
   * checkpoint moves. If the changes are gone (the server restarted), the step
   * is run again instead.
   */
  async approveCommit(userId: string, jobId: string, approvalId?: string): Promise<
    NeedsApproval | { committed: true; sha: string; job: CodeJob } | { rerun: true; job: CodeJob }
  > {
    return this.lock.run(userId, async () => {
      const job = await this.job(userId, jobId);
      if (job.state !== "waiting_for_you" || job.waitingOn !== "commit") throw notWaiting("a yes to commit");
      const step = await this.latestStep(job.id, "blocked");
      if (!step) throw notWaiting("a yes to commit");
      const pending = this.held.get(job.id);
      if (!pending || pending.stepIdx !== step.idx || this.now() - pending.at > PENDING_KEEP_MS) {
        this.held.delete(job.id);
        await this.store.updateStep(job.id, step.idx, { status: "pending", placement: "none", startedAt: null, finishedAt: null });
        const back = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["waiting_for_you"] }, { state: "running", waitingOn: null, reason: "" });
        if (!back) throw notWaiting("a yes to commit");
        const fresh = await this.store.getStep(job.id, step.idx);
        return { rerun: true as const, job: await this.place(back, fresh!, { prior: { state: "running", waitingOn: null } }) };
      }
      const made = await commitToBranch(this.deps, userId, job.projectId, job.branch, pending.files, pending.message, {
        attended: true, ...(approvalId !== undefined ? { approvalId } : {}),
      });
      if (isNeedsApproval(made)) return made;
      this.held.delete(job.id);
      await this.store.updateStep(job.id, step.idx, { status: "done" });
      const next = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["waiting_for_you"] }, {
        state: "running", waitingOn: null, reason: "",
        checkpoint: { stepIndex: step.idx, headSha: made.sha, notes: brief(`Committed the changes from ${step.commands[0] ?? "a step"}.`, 200) },
      });
      if (!next) throw notWaiting("a yes to commit");
      return { committed: true as const, sha: made.sha, job: next };
    });
  }

  // ------------------------------------------------------ the runner protocol

  /**
   * A PC says it is here: online for 60 seconds. A PC that says it is busy
   * keeps the lease of the step it is running. A PC that has just become able
   * to take work (new, back, allowed, idle) gives waiting jobs another look
   * straight away, so a paused job continues without waiting for the tick.
   */
  async heartbeat(userId: string, body: unknown): Promise<HeartbeatAck> {
    const hb = readHeartbeat(body);
    const now = this.now();
    const changed = this.devices.beat(userId, hb, now);
    return this.lock.run(userId, async () => {
      let renewed = 0;
      if (hb.busy && hb.allowRun) {
        for (const job of await this.store.findHeld(userId, "desktop", hb.deviceId)) {
          const step = await this.inflight(job.id);
          if (step?.status === "running" && step.epoch === job.leaseEpoch
            && await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["running"] }, { leaseExpiresAt: now + LEASE_MS })) renewed += 1;
        }
      }
      if (changed) await this.wakeLocked(userId);
      return { ok: true as const, onlineForSec: DEVICE_ONLINE_MS / 1000, leasesRenewed: renewed };
    });
  }

  /**
   * The step waiting for this PC, or null. With `waitMs` it holds the answer
   * back (long-polling) until a step is dispatched to the PC, the time is up, or
   * `signal` aborts. Asking again for a step the PC already has gives the same
   * step again (it may not have heard the answer). A PC that has not sent a
   * heartbeat in the last minute is told to ("unknown_device").
   */
  async next(userId: string, deviceId: string, o: { waitMs?: number; signal?: AbortSignal } = {}): Promise<RunnerStep | null> {
    if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) throw bad("deviceId is the id your app made for this computer.");
    const waitMs = Math.max(0, Math.floor(o.waitMs ?? 0));
    if (waitMs === 0) return this.pickup(userId, deviceId);
    return new Promise<RunnerStep | null>((resolve, reject) => {
      const key = `${userId}|${deviceId}`;
      let done = false;
      const set = this.waiters.get(key) ?? new Set<Waiter>();
      this.waiters.set(key, set);
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        o.signal?.removeEventListener("abort", onAbort);
        set.delete(w);
        if (!set.size && this.waiters.get(key) === set) this.waiters.delete(key);
        fn();
      };
      const check = () => {
        this.pickup(userId, deviceId).then((s) => { if (s) finish(() => resolve(s)); }, (err) => finish(() => reject(err)));
      };
      const w: Waiter = { nudge: () => { if (!done) check(); } };
      const timer = setTimeout(() => finish(() => resolve(null)), waitMs);
      timer.unref?.();
      const onAbort = () => finish(() => resolve(null));
      if (o.signal?.aborted) return finish(() => resolve(null));
      o.signal?.addEventListener("abort", onAbort, { once: true });
      set.add(w);
      check();
    });
  }

  /** Renews the lease of a step the PC is running. "stale_lease" if the epoch is not the job's current one. */
  async progress(userId: string, body: unknown): Promise<{ ok: true; leaseExpiresAt: number }> {
    const b = asObject(body);
    if (typeof b.jobId !== "string" || !b.jobId || b.jobId.length > 64) throw bad("jobId is the job's id.");
    if (!isInt(b.epoch, 1, Number.MAX_SAFE_INTEGER)) throw bad("epoch is the number you were given with the step.");
    const epoch = b.epoch;
    return this.lock.run(userId, async () => {
      const job = await this.store.getJob(userId, b.jobId as string);
      if (!job) throw missing();
      if (job.state !== "running" || job.placement === "none" || job.leaseHolder === null || job.leaseEpoch !== epoch) throw stale();
      const at = this.now() + LEASE_MS;
      const next = await this.store.casJob(job.id, { leaseEpoch: epoch, states: ["running"] }, { leaseExpiresAt: at });
      if (!next) throw stale();
      return { ok: true as const, leaseExpiresAt: at };
    });
  }

  /**
   * A step's result, from the PC that held it (`via` "desktop") or from a place
   * that reports for itself (a provider calling with its own kind). Checked
   * against the lease first: the job must be running on that kind of place,
   * and the epoch must be the current one, else "stale_lease" and nothing is
   * counted. Then the changes, if any and the step exited 0, are committed BY
   * THE SERVER (see the top of this file), the usage recorded, the step
   * finished and the checkpoint moved.
   */
  async submitResult(userId: string, body: unknown, via: ComputeKind = "desktop"): Promise<ResultAck> {
    const r = readResult(body, via);
    return this.lock.run(userId, async () => {
      const job = await this.store.getJob(userId, r.jobId);
      if (!job) throw missing();
      const step = await this.store.getStep(job.id, r.stepIdx);
      if (!step || step.kind !== "exec") throw stale();
      // The same result again (the first answer didn't arrive): already counted, say so.
      if (step.epoch === r.epoch && step.placement === via && (step.status === "done" || step.status === "failed" || step.status === "blocked")) {
        return { ok: true, state: job.state, committed: false, duplicate: true, ...(step.status === "blocked" ? { waitingForYou: true } : {}) };
      }
      if (job.state !== "running" || job.placement !== via || job.leaseHolder === null || job.leaseEpoch !== r.epoch
        || step.epoch !== r.epoch || (step.status !== "dispatched" && step.status !== "running")) throw stale();

      const now = this.now();
      const tail = keepOutput(r.outputTail);
      const paise = via === "paid" ? r.paise ?? 0 : 0;
      const wantsCommit = !!r.changes && r.changes.length > 0 && r.exitCode === 0;
      const files: CommitFile[] = wantsCommit ? r.changes!.map((c) => ({ path: c.path, content: c.content })) : [];
      const message = `Tailzu: changes from ${brief(step.commands[0] ?? "a command", 60)}\n\nFrom step ${step.idx} of a Tailzu job, run on ${WHERE[via]}.`;

      let sha: string | undefined;
      let refused: string | undefined;
      let ask: { action?: string } | null = null;
      if (wantsCommit) {
        try {
          const made = await this.commitAsServer(job, files, message);
          if (isNeedsApproval(made)) ask = { action: made.action };
          else sha = made.sha;
        } catch (err) {
          if (err instanceof PolicyError && err.code === "needs_you") ask = { action: err.info.action };
          else if (err instanceof PolicyError || (err instanceof ConnectorError && !TRANSIENT.has(err.code))) refused = err.code;
          // GitHub having a bad moment: nothing is counted, the PC asks again.
          else throw err;
        }
      }

      // The computer ran: count it, whatever happens to what it made.
      if (via === "github" && r.minutes > 0) await this.store.addUsage(userId, monthKey(now), { githubMinutes: r.minutes });
      if (via === "paid" && paise > 0) await this.store.addUsage(userId, monthKey(now), { paidPaise: paise });
      const spentPaise = job.spentPaise + paise;
      const note = refused ? `\n[Tailzu did not commit the changes: ${refused}.]` : "";
      const out = tailBytes(`${tail}${note}`);
      const base = { finishedAt: now, exitCode: r.exitCode, outputTail: out, minutes: r.minutes };

      if (ask) {
        await this.store.updateStep(job.id, step.idx, { ...base, status: "blocked" });
        this.keepHeld(job.id, { stepIdx: step.idx, files, message, at: now });
        const reason = brief(`Changes from ${step.commands[0] ?? "a step"} are ready, and need your OK before Tailzu commits them.`, 300);
        const next = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["running"] }, {
          state: "waiting_for_you", waitingOn: "commit", placement: "none", leaseHolder: null, leaseExpiresAt: null, reason, spentPaise,
        });
        if (!next) throw stale();
        this.tell(next, "commit_ask", { stepIdx: step.idx, reason, ...(ask.action ? { action: ask.action } : {}) });
        // The PC is free again, though the step waits for a yes.
        await this.wakeLocked(userId);
        return { ok: true, state: next.state, committed: false, waitingForYou: true };
      }

      const failed = r.exitCode !== 0 || refused !== undefined;
      await this.store.updateStep(job.id, step.idx, { ...base, status: failed ? "failed" : "done" });
      const first = brief(step.commands[0] ?? "a command", 60);
      const more = step.commands.length > 1 ? ` and ${step.commands.length - 1} more` : "";
      const notes = failed
        ? (refused ? `Ran ${first}${more}; its changes were not committed (${refused}).` : `Ran ${first}${more}: failed (exit ${r.exitCode}).`)
        : `Ran ${first}${more}: ok${sha ? " and committed its changes" : ""}.`;
      const next = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["running"] }, {
        state: "running", placement: "none", leaseHolder: null, leaseExpiresAt: null, reason: "", waitingOn: null, spentPaise,
        checkpoint: { stepIndex: step.idx, headSha: sha ?? job.checkpoint.headSha, notes },
      });
      if (!next) throw stale();
      // A place has just come free: whatever was waiting for one may go now.
      await this.wakeLocked(userId);
      return {
        ok: true, state: next.state, committed: sha !== undefined,
        ...(sha !== undefined ? { sha } : {}), ...(refused !== undefined ? { refused } : {}),
        ...(!wantsCommit && r.changes && r.changes.length && r.exitCode !== 0 ? { changesIgnored: true } : {}),
      };
    });
  }

  // -------------------------------------------------------------- the clock's

  /**
   * One pass: leases that ran out are taken back and their step placed again
   * (or the job failed, after MAX_REASSIGNMENTS); jobs waiting for a place get
   * another look. Run every 15 seconds (ticker.ts). A job that throws is logged
   * and skipped, so one bad job can't hold up the rest.
   */
  async tick(): Promise<TickReport> {
    const report: TickReport = { expired: 0, moved: 0, failed: 0, woken: 0 };
    this.devices.prune(this.now());
    for (const j of await this.store.listExpired(this.now(), 100)) {
      try {
        await this.withJob(j.id, async (job) => {
          const now = this.now();
          if (job.state !== "running" || job.placement === "none" || job.leaseExpiresAt === null || job.leaseExpiresAt > now) return;
          const how = await this.expire(job, now);
          if (how === "raced") return;
          report.expired += 1;
          if (how === "failed") report.failed += 1;
          else report.moved += 1;
        });
      } catch (err) { this.o.log?.warn({ jobId: j.id, error: (err as Error)?.message }, "code job: could not move a job whose lease ran out"); }
    }
    for (const j of await this.store.listWaiting(200)) {
      try {
        await this.lock.run(j.userId, async () => {
          const after = await this.retry(j.id);
          if (after && after.state === "running" && after.placement !== "none") report.woken += 1;
        });
      } catch (err) { this.o.log?.warn({ jobId: j.id, error: (err as Error)?.message }, "code job: could not look again at a waiting job"); }
    }
    return report;
  }

  /** Gives this person's waiting jobs another look now. Returns how many were placed. */
  async wake(userId: string): Promise<number> {
    return this.lock.run(userId, () => this.wakeLocked(userId));
  }

  // =========================================================================
  // inside: everything below runs with the person's lock held (or is a read)
  // =========================================================================

  /** Runs `fn` on the job, fresh, under its person's lock. */
  private async withJob<T>(jobId: string, fn: (job: CodeJob) => Promise<T>): Promise<T> {
    const first = await this.store.getJobById(jobId);
    if (!first) throw missing();
    return this.lock.run(first.userId, async () => {
      const job = await this.store.getJobById(jobId);
      if (!job) throw missing();
      return fn(job);
    });
  }

  private mustBeLive(job: CodeJob): void {
    if (isEnded(job.state)) throw over();
  }

  private async addStep(jobId: string, n: Parameters<JobStore["addStep"]>[1]): Promise<JobStep> {
    try {
      return await this.store.addStep(jobId, n);
    } catch (err) {
      if (err instanceof TooManySteps) throw new ConnectorError("too_many", err.message);
      throw err;
    }
  }

  /** The exec step that is out (pending, dispatched, running or blocked), if any. */
  private async inflight(jobId: string): Promise<JobStep | null> {
    const steps = await this.store.listSteps(jobId);
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const s = steps[i]!;
      if (s.kind === "exec" && (s.status === "pending" || s.status === "dispatched" || s.status === "running" || s.status === "blocked")) return s;
    }
    return null;
  }

  private async pendingExec(jobId: string): Promise<JobStep | null> {
    const s = await this.inflight(jobId);
    return s && s.status === "pending" ? s : null;
  }

  private async latestStep(jobId: string, status: JobStep["status"]): Promise<JobStep | null> {
    const steps = await this.store.listSteps(jobId);
    for (let i = steps.length - 1; i >= 0; i -= 1) if (steps[i]!.status === status) return steps[i]!;
    return null;
  }

  private provider(kind: ComputeKind): ComputeProvider | null {
    return kind === "desktop" ? this.desktop : kind === "github" ? this.o.github ?? null : this.o.paid ?? null;
  }

  private async available(p: ComputeProvider, job: CodeJob, estimateMinutes: number): Promise<Availability> {
    try {
      return await p.available({ userId: job.userId, projectId: job.projectId, jobId: job.id, estimateMinutes, now: this.now() });
    } catch {
      return { ok: false };
    }
  }

  /** The facts choosePlacement needs for a step, from the providers, the person's settings and this month's use. */
  private async facts(job: CodeJob, step: JobStep, skip: ReadonlySet<ComputeKind>): Promise<PlacementCtx> {
    const [settings, usage] = await Promise.all([this.store.getSettings(job.userId), this.store.getUsage(job.userId, monthKey(this.now()))]);
    const none: Availability = { ok: false };
    const desk = skip.has("desktop") ? none : await this.available(this.desktop, job, step.estimateMinutes);
    const gh = this.o.github && settings.githubEnabled && !skip.has("github") ? await this.available(this.o.github, job, step.estimateMinutes) : none;
    const pd = this.o.paid && !skip.has("paid") ? await this.available(this.o.paid, job, step.estimateMinutes) : none;
    const jobLeft = Math.max(0, job.budgetPaise - job.spentPaise);
    const autoLeft = settings.paidRule === "auto" ? Math.max(0, settings.autoCapPaise - usage.paidPaise) : 0;
    return {
      desktops: desk.ok ? desk.places ?? 1 : 0,
      githubEnabled: gh.ok,
      githubMinutesLeft: githubMinutesLeft(this.freeMinutes, usage.githubMinutes),
      paidRule: settings.paidRule,
      paidAvailable: pd.ok,
      // What may be spent without asking: the automatic cap's room, or what the person said yes to for this job. "never" is never.
      paidLeftPaise: settings.paidRule === "never" ? 0 : Math.max(autoLeft, jobLeft),
      estimateMinutes: step.estimateMinutes,
      estimatePaise: pd.estimatePaise ?? 0,
    };
  }

  /**
   * Puts an exec step on the cheapest place there is, or holds the job
   * (waiting for compute / waiting for the person). `prior` is how the job
   * looked to whoever asked, so a notification goes out when the job ENTERS a
   * waiting state, not again every time a pass finds it still there.
   */
  private async place(
    job0: CodeJob, step: JobStep, o: { prior: { state: JobState; waitingOn: WaitingOn | null }; movedFrom?: Placement },
  ): Promise<CodeJob> {
    let job = job0;
    const skip = new Set<ComputeKind>();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const choice = choosePlacement(await this.facts(job, step, skip));
      if ("placement" in choice) {
        const r = await this.dispatch(job, step, choice.placement);
        if ("raced" in r) return (await this.store.getJobById(job.id)) ?? job;
        if ("job" in r) {
          if (o.movedFrom && o.movedFrom !== choice.placement) {
            this.tell(r.job, "job_moved", { from: o.movedFrom, to: choice.placement, stepIdx: step.idx, reason: choice.reason });
          }
          return r.job;
        }
        skip.add(choice.placement);
        job = (await this.store.getJobById(job.id)) ?? job;
        continue;
      }
      return this.hold(job, step, choice, o.prior);
    }
    return this.hold(job, step, { wait: true, reason: "No place could take this step just now. It will carry on by itself when one can." }, o.prior);
  }

  /**
   * Takes the lease (one epoch higher), then asks the provider for a holder.
   * The claim is the fence: if the job changed under us (someone else moved or
   * ended it) nothing is given out. A provider that can't take it hands the
   * job back as waiting, and the caller chooses again without it.
   */
  private async dispatch(job: CodeJob, step: JobStep, kind: ComputeKind): Promise<{ job: CodeJob } | { raced: true } | { failed: true }> {
    const provider = this.provider(kind);
    if (!provider) return { failed: true };
    const claimed = await this.store.casJob(job.id, {
      leaseEpoch: job.leaseEpoch, states: ["queued", "running", "waiting_for_compute", "waiting_for_you"],
    }, {
      state: "running", placement: kind, leaseHolder: null, leaseEpoch: job.leaseEpoch + 1, leaseExpiresAt: this.now() + LEASE_MS, reason: "", waitingOn: null,
    });
    if (!claimed) return { raced: true };
    const given: JobStep = { ...step, status: "dispatched", placement: kind, epoch: claimed.leaseEpoch, startedAt: null };
    await this.store.updateStep(job.id, step.idx, { status: "dispatched", placement: kind, epoch: claimed.leaseEpoch, startedAt: null });
    try {
      const { holder } = await provider.dispatch(claimed, given);
      const held = await this.store.casJob(job.id, { leaseEpoch: claimed.leaseEpoch, states: ["running"] }, { leaseHolder: holder });
      if (!held) {
        await provider.cancel(claimed).catch(() => undefined);
        return { raced: true };
      }
      if (kind === "desktop") this.nudge(job.userId, holder);
      return { job: held };
    } catch {
      await this.store.casJob(job.id, { leaseEpoch: claimed.leaseEpoch }, {
        state: "waiting_for_compute", placement: "none", leaseHolder: null, leaseExpiresAt: null,
      });
      await this.store.updateStep(job.id, step.idx, { status: "pending", placement: "none", startedAt: null });
      return { failed: true };
    }
  }

  /** The job waits (for compute, or for the person's yes), and the person is told once when it first does. */
  private async hold(
    job: CodeJob, step: JobStep, choice: Extract<PlacementChoice, { wait: true } | { ask: true }>, prior: { state: JobState; waitingOn: WaitingOn | null },
  ): Promise<CodeJob> {
    const asking = "ask" in choice;
    const state: JobState = asking ? "waiting_for_you" : "waiting_for_compute";
    const waitingOn: WaitingOn | null = asking ? "paid" : null;
    const same = job.state === state && job.waitingOn === waitingOn && job.reason === choice.reason && job.placement === "none" && job.leaseHolder === null;
    let next = job;
    if (!same) {
      const saved = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch }, {
        state, waitingOn, placement: "none", leaseHolder: null, leaseExpiresAt: null, reason: choice.reason,
      });
      if (!saved) return (await this.store.getJobById(job.id)) ?? job;
      next = saved;
    }
    if (step.status !== "pending") await this.store.updateStep(job.id, step.idx, { status: "pending", placement: "none", startedAt: null });
    if (prior.state !== state || prior.waitingOn !== waitingOn) {
      this.tell(next, asking ? "compute_ask" : "compute_paused", {
        stepIdx: step.idx, reason: choice.reason, ...(asking ? { estimatePaise: choice.estimatePaise } : {}),
      });
    }
    return next;
  }

  /** Takes back a lease that ran out and moves the step, or fails the job that has been moved too often. */
  private async expire(job: CodeJob, now: number): Promise<"moved" | "failed" | "raced"> {
    const from = job.placement;
    const step = await this.inflight(job.id);
    const reassignments = job.reassignments + 1;
    const giveUp = reassignments >= MAX_REASSIGNMENTS;
    const reason = giveUp
      ? `The computer running this kept going quiet (${reassignments} times), so Tailzu stopped trying. What was committed so far is on the branch.`
      : "";
    const lost = await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["running"], leaseExpiredBy: now }, {
      placement: "none", leaseHolder: null, leaseExpiresAt: null, reassignments,
      state: giveUp ? "failed" : "waiting_for_compute", reason: giveUp ? reason : "Its computer went quiet. Finding another place.",
    });
    if (!lost) return "raced";
    const provider = this.provider(from as ComputeKind);
    if (provider) await provider.cancel(job).catch(() => undefined);
    if (step) {
      await this.store.updateStep(job.id, step.idx, giveUp
        ? { status: "cancelled", finishedAt: now }
        : { status: "pending", placement: "none", startedAt: null });
    }
    if (giveUp) {
      this.held.delete(job.id);
      this.tell(lost, "job_failed", { reason });
      return "failed";
    }
    if (!step) {
      await this.store.casJob(job.id, { leaseEpoch: lost.leaseEpoch }, { state: "running", reason: "" });
      return "moved";
    }
    await this.place(lost, { ...step, status: "pending", placement: "none", startedAt: null }, { prior: { state: "running", waitingOn: null }, movedFrom: from });
    return "moved";
  }

  /** Ends a job in `state`: lease fenced, the step that is out dropped, the place told to let go. */
  private async end(job: CodeJob, state: "done" | "failed" | "cancelled", reason: string, checkpoint?: CodeJob["checkpoint"]): Promise<CodeJob> {
    const from = job.placement;
    const step = await this.inflight(job.id);
    const next = await this.store.casJob(job.id, { states: ["queued", "running", "waiting_for_compute", "waiting_for_you", "paused"] }, {
      state, placement: "none", leaseHolder: null, leaseExpiresAt: null, waitingOn: null, reason,
      // A new epoch, so a result that is still on its way is refused (it would be anyway: the job is not running).
      ...(from !== "none" ? { leaseEpoch: job.leaseEpoch + 1 } : {}),
      ...(checkpoint ? { checkpoint } : {}),
    });
    // Over already (another server got there first): it stays as it ended.
    if (!next) return (await this.store.getJobById(job.id)) ?? job;
    this.held.delete(job.id);
    if (step) await this.store.updateStep(job.id, step.idx, { status: "cancelled", finishedAt: this.now() });
    if (from !== "none") await this.provider(from as ComputeKind)?.cancel(job).catch(() => undefined);
    if (state === "done") this.tell(next, "job_done", {});
    if (state === "failed") this.tell(next, "job_failed", { reason });
    return next;
  }

  /** Another look at one waiting job (under its person's lock). Null if it isn't waiting any more. */
  private async retry(jobId: string): Promise<CodeJob | null> {
    const job = await this.store.getJobById(jobId);
    if (!job) return null;
    if (job.state !== "waiting_for_compute" && !(job.state === "waiting_for_you" && job.waitingOn !== "commit")) return null;
    const step = await this.pendingExec(job.id);
    if (!step) {
      // Nothing is out: the job is only between steps.
      return this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: [job.state] }, { state: "running", reason: "", waitingOn: null });
    }
    return this.place(job, step, { prior: { state: job.state, waitingOn: job.waitingOn } });
  }

  private async wakeLocked(userId: string): Promise<number> {
    let placed = 0;
    for (const j of await this.store.listWaiting(50, userId)) {
      try {
        const after = await this.retry(j.id);
        if (after && after.state === "running" && after.placement !== "none") placed += 1;
      } catch (err) { this.o.log?.warn({ jobId: j.id, error: (err as Error)?.message }, "code job: could not look again at a waiting job"); }
    }
    return placed;
  }

  /** The step a PC holds, as the PC is given it. Marks it started and renews the lease. */
  private async pickup(userId: string, deviceId: string): Promise<RunnerStep | null> {
    const now = this.now();
    const device = this.devices.online(userId, deviceId, now);
    if (!device) throw new ConnectorError("unknown_device", "Send a heartbeat first, so Tailzu knows this computer is here.");
    if (!device.allowRun) return null;
    return this.lock.run(userId, async () => {
      for (const held of await this.store.findHeld(userId, "desktop", deviceId)) {
        const job = (await this.store.getJobById(held.id)) ?? held;
        if (!allows(device, job.projectId)) continue;
        const step = await this.inflight(job.id);
        if (!step || step.status === "pending" || step.status === "blocked" || step.epoch !== job.leaseEpoch) continue;
        let repo: RunnerStep["repo"];
        try {
          repo = await this.repoFor(job);
        } catch (err) {
          // A repo the person can't use any more can't be run on: the job ends, with the reason, instead of being handed out again and again.
          if (err instanceof ConnectorError && PERMANENT.has(err.code)) {
            await this.end(job, "failed", brief(err.message, 300));
            return null;
          }
          throw err;
        }
        if (step.status === "dispatched") await this.store.updateStep(job.id, step.idx, { status: "running", startedAt: now });
        await this.store.casJob(job.id, { leaseEpoch: job.leaseEpoch, states: ["running"] }, { leaseExpiresAt: now + LEASE_MS });
        return { jobId: job.id, stepIdx: step.idx, epoch: job.leaseEpoch, commands: step.commands, timeoutSec: step.timeoutSec, repo };
      }
      return null;
    });
  }

  /** Where and how a PC gets the code: the existing read access for a runner (projects.ts runnerAccess), never a token that can write. */
  private async repoFor(job: CodeJob): Promise<RunnerStep["repo"]> {
    const access = await runnerAccess(this.deps, job.userId, job.projectId, job.branch, "read");
    const project = await ownProject(this.deps, job.userId, job.projectId);
    const headSha = await this.deps.github.branchHead(repoRef(this.deps, job.userId, project), job.branch);
    return access.kind === "app"
      ? { kind: "app", cloneUrl: access.cloneUrl, branch: job.branch, headSha, readToken: access.token, readTokenExpiresAt: access.expiresAt }
      : { kind: "oauth", cloneUrl: `https://github.com/${project.fullName}.git`, branch: job.branch, headSha, tarballUrl: access.tarballUrl };
  }

  /** A commit by the server for a runner's changes, with nobody there to ask; the branch having moved on once is retried once. */
  private async commitAsServer(job: CodeJob, files: CommitFile[], message: string) {
    const go = () => commitToBranch(this.deps, job.userId, job.projectId, job.branch, files, message, { attended: false });
    try {
      return await go();
    } catch (err) {
      if (err instanceof ConnectorError && err.code === "branch_moved") return go();
      throw err;
    }
  }

  private keepHeld(jobId: string, p: Pending): void {
    this.held.delete(jobId);
    this.held.set(jobId, p);
    while (this.held.size > PENDING_MAX) this.held.delete(this.held.keys().next().value as string);
  }

  /** Wakes a PC that is waiting for work on `next`. */
  private nudge(userId: string, deviceId: string): void {
    for (const w of [...(this.waiters.get(`${userId}|${deviceId}`) ?? [])]) w.nudge();
  }

  /** Tells the person. A push that fails is not a job that fails. */
  private tell(job: CodeJob, kind: NotifyKind, extra: Partial<NotifyData>): void {
    const data: NotifyData = { jobId: job.id, projectId: job.projectId, task: brief(job.task), at: this.now(), ...extra };
    try {
      const r = this.o.notify?.(job.userId, kind, data);
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => undefined);
    } catch { /* a missed push is not a failed job */ }
  }
}

/** Why a repo can't be run on at all, as opposed to GitHub having a bad moment. */
const PERMANENT = new Set(["no_access", "not_found", "branch_deleted", "needs_reconnect", "suspended", "oauth_off", "needs_signin", "org_blocked"]);

/**
 * ONE RUN OF THE LOOP OVER ONE JOB: THE STATE, THE CLAIM IT WRITES THROUGH, AND THE WAYS IT STOPS.
 *
 * A Run is what a phase works with: the job's AgentState, the workspace over its branch, the
 * project's brain, the work log, the tools, and the model's context (whose money, which budget).
 * It holds nothing that cannot be built again from the job: a server that dies loses its Run, and the
 * next one builds a new one from the checkpoint and goes on.
 *
 * EVERY WRITE IS FENCED. `save()` writes the state into the job's checkpoint through the CLAIM
 * (orchestrator.ts): the write holds only if the agent's epoch is still the one the claim was taken
 * at, and the job is still going. If it is not, the claim was lost (this server went quiet and
 * another took the job, the person stopped it) and `save()` throws LostClaim, which ends the Run
 * without another write. That is how two servers never run one job.
 *
 * THE WAYS A PHASE STOPS THE RUN, as exceptions the driver (loop.ts) understands:
 *
 *   Park       the job waits for the person (a question, a yes, more budget): the state is saved, the
 *              job goes to waiting_for_you, the claim is let go, and the person is told
 *   EndJob     the job is over: the report is written and the job is finished (done or failed)
 *   LostClaim  not ours any more: stop, quietly
 *
 * `gated()` is how a phase does something the policy may ask the person about (a commit, marking a pull
 * request ready): it runs the operation, and if the answer is a question it parks with the approval the
 * book gave; when the person has said yes it runs the operation again with that approval.
 */
import { ConnectorError } from "../../connectors/state.js";
import { brief, type CodeJob, type NotifyKind, type WaitingOn } from "../jobs/types.js";
import type { CloseReason, ViewerEvent } from "../live/protocol.js";
import { isNeedsApproval, type Gated } from "../policy.js";
import type { BrainHandle } from "../project/index.js";
import { ownProject, workspace, type Workspace } from "../projects.js";
import type { CodeProject } from "../store.js";
import { makeWebTools, type WebToolDeps, type WebTools } from "../webTools.js";
import { WorkLog, type ModelCtx } from "../work/index.js";
import type { AgentDeps } from "./deps.js";
import type { RunControl, RunOutcome, RunSpec } from "./runner.js";
import { Tools } from "./tools.js";
import type { AgentState, WaitFor } from "./types.js";

export class LostClaim extends Error {
  constructor() {
    super("the agent's claim on this job was lost");
    this.name = "LostClaim";
  }
}

/** The job waits for the person. `reason` is what they are told. */
export class Park extends Error {
  constructor(readonly waitingOn: Extract<WaitingOn, "answer" | "approval" | "budget">, readonly reason: string) {
    super(reason);
    this.name = "Park";
  }
}

/** The money ran out (the router found no tier it could pay for): the budget stop, not a failure. */
export class BudgetStop extends Error {
  constructor(readonly needPaise: number) {
    super("the budget cannot cover the next step");
    this.name = "BudgetStop";
  }
}

/** The job is over, with this outcome and reason. */
export class EndJob extends Error {
  constructor(readonly outcome: "failed" | "done" | "answer", readonly why: string) {
    super(why);
    this.name = "EndJob";
  }
}

/** What the loop writes through: the orchestrator's claim on the job (orchestrator.ts). */
export interface Claim {
  readonly epoch: number;
  /** Writes the state into the checkpoint (and renews the claim). `headSha` and `notes` are the checkpoint's own two fields. Throws LostClaim. */
  save(state: AgentState, o?: { headSha?: string; notes?: string }): Promise<CodeJob>;
  /** The job as it is now, with the claim still held. Throws LostClaim. */
  fresh(): Promise<CodeJob>;
  /** Keeps the claim alive. Throws LostClaim. */
  renew(): Promise<void>;
  /** Saves the state, puts the job to waiting_for_you for `waitingOn`, and lets the claim go. */
  park(state: AgentState, p: { waitingOn: WaitingOn; reason: string }): Promise<void>;
}

/** The phase did a slice of its work and the driver (loop.ts advanceLoop) should stop here: the state is saved, and the next advance goes on. */
export class Yield extends Error {
  constructor() {
    super("a slice of the work is done");
    this.name = "Yield";
  }
}

export interface LoopEnv {
  /** Look at a step that is out once, and let the driver come back later, instead of waiting for it (advanceLoop). */
  pollOnce?: boolean;
  /** The work phase gives way after this many rounds (a model turn and its tool calls), so one advance stays short (advanceLoop). */
  turnsPerAdvance?: number;
  job: CodeJob;
  /** Where the job has got to: the checkpoint's agent state, or a fresh one. */
  state: AgentState;
  deps: AgentDeps;
  claim: Claim;
  signal: AbortSignal;
}

const APPROVAL_PROBLEMS = new Set(["approval_expired", "approval_invalid", "changed_since_approval"]);

export class Run {
  state: AgentState;
  readonly userId: string;
  readonly jobId: string;
  readonly projectId: string;
  readonly branch: string;
  project!: CodeProject;
  ws!: Workspace;
  brain!: BrainHandle;
  tools!: Tools;
  web!: WebTools;
  readonly log: WorkLog;
  /** The arguments of calls of this turn that were not kept (they held a secret), by call id: for this process only, to run the call and be refused. */
  readonly held = new Map<string, string>();

  constructor(readonly env: LoopEnv) {
    this.userId = env.job.userId;
    this.jobId = env.job.id;
    this.projectId = env.job.projectId;
    this.branch = env.job.branch;
    this.state = env.state;
    this.log = new WorkLog(this.jobId, { ...(env.deps.worklog ? { store: env.deps.worklog } : {}), now: env.deps.now });
  }

  get deps(): AgentDeps { return this.env.deps; }
  now(): number { return this.env.deps.now(); }
  get signal(): AbortSignal { return this.env.signal; }

  /** Opens the workspace, the brain and the tools. Throws what the project functions throw (not found, no access). */
  async init(): Promise<void> {
    const d = this.deps;
    this.project = await ownProject(d.projects, this.userId, this.projectId);
    this.ws = await workspace(d.projects, this.userId, this.projectId, this.branch, { attended: true });
    this.brain = await d.brain.open(this.userId, this.projectId);
    const web: Partial<WebToolDeps> = {
      ...(d.web ?? {}), ...(d.call ? { call: d.call as unknown as WebToolDeps["call"] } : {}), ...(d.gateway ? { gateway: d.gateway } : {}),
      now: d.now, sleep: d.sleep, signal: this.signal,
    };
    this.web = makeWebTools({ userId: this.userId, jobId: this.jobId, budget: "job", ...web });
    const live = d.live;
    const files = live?.files?.({ id: this.jobId, userId: this.userId, projectId: this.projectId, branch: this.branch }) ?? null;
    this.tools = new Tools({
      userId: this.userId, projectId: this.projectId, state: this.state, ws: this.ws, brain: this.brain, log: this.log,
      runStep: (tag, spec) => this.runStep(tag, spec), web: this.web, ...(d.fetchFn ? { fetchFn: d.fetchFn } : {}), closedSource: this.project.private,
      now: d.now, signal: this.signal, ...(d.findResources ? { findResources: d.findResources } : {}),
      ...(files ? { files } : {}), ...(live?.progress ? { progress: (ev) => this.progress(ev) } : {}),
    });
    const seen = (await this.log.entries().catch(() => [])).flatMap((e) => (typeof e.data?.callId === "string" ? [`${e.data.callId}:${e.kind}`] : []));
    this.tools.seedLogged(seen);
  }

  // ------------------------------------------------------- the live session

  /** A compact event for the app's live view. Never throws and never waits: a lost event is a gap in a view, not a failed job. */
  progress(ev: ViewerEvent): void {
    try { this.deps.live?.progress?.(this.jobId, ev); } catch { /* a live view is never worth a failed job */ }
  }

  /** Closes the job's live session, before the person is asked anything or the job ends. Never throws. */
  async closeSession(reason: CloseReason): Promise<void> {
    try { await this.deps.live?.closeSession?.(this.jobId, reason); } catch { /* the room closes it by itself when it is idle */ }
  }

  // ------------------------------------------------------------- the claim

  async save(o?: { headSha?: string; notes?: string }): Promise<CodeJob> { return this.env.claim.save(this.state, o); }
  async renew(): Promise<void> { await this.env.claim.renew(); }
  async job(): Promise<CodeJob> { return this.env.claim.fresh(); }

  /** What the job has spent and may spend, in paise, as it stands. */
  async money(): Promise<{ spent: number; budget: number; remaining: number }> {
    const j = await this.job();
    return { spent: j.spentPaise, budget: j.budgetPaise, remaining: Math.max(0, j.budgetPaise - j.spentPaise) };
  }

  /** Whose money, which budget: how the work core's model calls are made. */
  model(): ModelCtx {
    const d = this.deps;
    return { ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId: this.userId, jobId: this.jobId, budget: "job", signal: this.signal };
  }

  // -------------------------------------------------------------- running

  /**
   * Commands on a runner (runner.ts), for this ask. The claim is kept alive while it waits, and the step is
   * written into the state as soon as it exists, so a server that takes the job up after a restart adopts it
   * instead of asking again. The mark is cleared when the result is back; the caller's next save keeps the
   * result and drops the mark together.
   */
  async runStep(tag: string, spec: RunSpec): Promise<RunOutcome> {
    const adopt = this.state.run && this.state.run.tag === tag ? this.state.run.stepIdx : undefined;
    // When it was first asked for survives a restart in the mark, so a runner looked at once per advance still knows how long it has waited.
    const askedAt = this.state.run && this.state.run.tag === tag ? this.state.run.at : undefined;
    const ctl: RunControl = {
      signal: this.signal, renew: () => this.renew(),
      ...(this.env.pollOnce ? { once: true, ...(askedAt !== undefined ? { startedAt: askedAt } : {}) } : {}),
      onStep: async (idx) => {
        this.state.run = { stepIdx: idx, commands: spec.commands, tag, at: this.state.run?.stepIdx === idx && askedAt !== undefined ? askedAt : this.now() };
        await this.save();
      },
    };
    const out = await this.deps.runner.run(await this.job(), { ...spec, tag, ...(adopt !== undefined ? { adopt } : {}) }, ctl);
    this.state.run = undefined;
    return out;
  }

  // ------------------------------------------------------------- words out

  note(text: string): void {
    if (this.state.notes.length < 12 && !this.state.notes.includes(text)) this.state.notes.push(text);
  }

  async tell(kind: NotifyKind, reason: string): Promise<void> {
    const n = this.deps.notify;
    if (!n) return;
    try {
      const job = await this.env.claim.fresh().catch(() => this.env.job);
      const r = n(this.userId, kind, { jobId: this.jobId, projectId: this.projectId, task: brief(job.task), at: this.now(), reason: brief(reason, 200) });
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => undefined);
    } catch { /* a missed push is not a failed job */ }
  }

  // ----------------------------------------------------------- the person

  /**
   * Does something the policy may ask the person about. `op` is given the approval id the person said yes
   * with (after a question was put and answered), or nothing. If the answer is a question, the job parks on
   * it. An approval that ran out, or no longer matches (the branch moved, the files changed), is asked again
   * with a fresh question instead of failing the job.
   */
  async gated<T>(forWhat: WaitFor, what: string, op: (approvalId?: string) => Promise<Gated<T>>): Promise<T> {
    const w = this.state.waiting;
    const approvalId = w?.kind === "approval" && w.for === forWhat && w.approved === true ? w.approvalId : undefined;
    // The yes may be taken by a process that did not ask the question (a Worker's isolate, a restarted server): the question is in the job's state.
    if (approvalId && w?.kind === "approval" && w.bound) this.deps.projects.approvals.restore(w.bound);
    let res: Gated<T>;
    try {
      res = await op(approvalId);
    } catch (err) {
      if (approvalId && err instanceof ConnectorError && APPROVAL_PROBLEMS.has(err.code)) {
        this.state.waiting = undefined;
        res = await op(undefined);
      } else throw err;
    }
    if (isNeedsApproval(res)) {
      const bound = this.deps.projects.approvals.peek(res.approvalId) ?? undefined;
      this.state.waiting = {
        kind: "approval", for: forWhat, action: res.action, faceId: res.faceId, summary: res.summary, approvalId: res.approvalId, expiresAt: res.expiresAt, at: this.now(),
        ...(bound ? { bound } : {}),
      };
      await this.log.question(`Needs your OK to ${what}.`);
      throw new Park("approval", `It needs your OK to ${what}.`);
    }
    if (approvalId) this.state.waiting = undefined;
    return res;
  }
}

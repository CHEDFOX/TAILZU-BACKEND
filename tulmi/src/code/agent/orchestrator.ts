/**
 * THE ORCHESTRATOR: THE SERVER-SIDE WORKER THAT DRIVES AGENT JOBS, ONE SERVER PER JOB, A FEW JOBS AT A TIME.
 *
 * A job made through POST /v1/code/jobs on a server that has the agent is an AGENT JOB. The orchestrator
 * picks such jobs up and runs the loop (loop.ts) on each. What it guarantees:
 *
 * ONE RUNNER PER JOB. A job is driven by whoever holds its CLAIM: the job's agent_holder, agent_epoch and
 * agent_expires_at (migration 0030). Taking it is one compare-and-set on the job (store.casJob): the epoch
 * must still be what was read, the job in a state it can be claimed in, and nobody's time on the claim
 * left (`agentFreeBy`). Two servers reading the same job both try; one wins. Every write the loop makes
 * carries the epoch, so a server that lost the claim (it was slow, it was restarted, the ticker took the
 * job back) finds its next write turned away (LostClaim) and stops. The step's lease (jobs/types.ts, a
 * runner's, 90 seconds) is a different thing held at the same time: the agent holds its claim while a
 * step it asked for is out, and waits for it.
 *
 * CHECKPOINTS. The loop saves the agent's state (phase, plan, staged edits, the conversation's tail) into
 * the job's checkpoint after every model turn and every tool call. So when a server dies, nothing is
 * redone: the claim runs out (two minutes, kept alive by a heartbeat a third of the way through), the
 * ticker hands the job back (tick, epoch up by one, which fences the old holder for good), and any server's
 * next poll claims it and goes on from the checkpoint, without editing again what was edited or committing
 * again what was committed.
 *
 * CONCURRENCY. At most CODE_AGENT_CONCURRENCY (4) jobs at once on one server; the rest wait their turn in
 * the database, oldest first.
 *
 * THE PERSON'S WORD. answer, approve, deny, addBudget and stopJob are what the routes call. A job waiting for
 * the person is parked (waiting_for_you, nobody's claim): their word is written into its state, the job goes
 * back to running, and the next poll takes it up. Every one is the owner's only (the router's `job` looks it
 * up by the person's id), and every one answers "not_waiting" for a job that is not waiting for that.
 *
 * AN ERROR in a loop (GitHub down, a bug) is not the person's: the claim is let go with a wait that doubles
 * (15 s, then 30 s), and a job that fails three times running is failed, with a plain reason.
 *
 * The clock, the sleep, the model, the runner and every store come in through AgentDeps, so a test runs all
 * of it offline. `crash()` is for tests: it kills this orchestrator the way a power cut would, without
 * letting go of anything.
 */
import { randomUUID } from "node:crypto";
import { ConnectorError } from "../../connectors/oauth.js";
import { CLAIMABLE_STATES } from "../jobs/store.js";
import type { JobRouter } from "../jobs/router.js";
import type { JobStore } from "../jobs/store.js";
import { AGENT_LEASE_MS, PAISE_MAX, brief, isEnded, type CodeJob, type JobState } from "../jobs/types.js";
import { WorkLog, worklogStore, type WorkEntry } from "../work/index.js";
import type { AgentDeps } from "./deps.js";
import { runLoop } from "./loop.js";
import { LostClaim, type Claim } from "./run.js";
import { ERROR_BACKOFF_MS, LOOP_ERRORS_MAX, TASK_CHARS, initialState, stateOf, type AgentState } from "./types.js";

/** The states a write by the claim's holder may happen in. */
const WRITABLE: readonly JobState[] = ["queued", "running", "waiting_for_compute", "waiting_for_you"];

const notWaiting = (what: string) => new ConnectorError("not_waiting", `That job isn't waiting for ${what}.`);

export interface OrchestratorOptions {
  jobs: JobRouter;
  store: JobStore;
  deps: AgentDeps;
  /** Names this server in the claim. A new one for each process. */
  instanceId?: string;
  /** Jobs at once: CODE_AGENT_CONCURRENCY, 4 by default. */
  concurrency: number;
  leaseMs?: number;
}

interface Active { jobId: string; epoch: number; abort: AbortController; done: Promise<void> }

/** What a person sees of an agent job besides the job itself. */
export interface AgentView {
  phase: string;
  waiting?: { kind: string; question?: string; options?: string[]; for?: string; action?: string; faceId?: boolean; summary?: Record<string, unknown>; expiresAt?: number };
  plan?: { risk: string; steps: Array<{ n: number; do: string; files: string[] }> };
  staged: string[];
  commits: string[];
  pr?: { number: number; url: string; ready: boolean };
  verify?: { ran: boolean; ok: boolean; summary: string };
  fixRounds: number;
  findings: AgentState["findings"];
  report?: AgentState["report"];
  notes: string[];
}

export function viewOfState(s: AgentState): AgentView {
  const w = s.waiting;
  return {
    phase: s.phase,
    ...(w ? {
      waiting: w.kind === "question" ? { kind: "question", question: w.question, ...(w.options ? { options: w.options } : {}), from: w.from } as AgentView["waiting"]
        : w.kind === "approval" ? { kind: "approval", for: w.for, action: w.action, faceId: w.faceId, summary: w.summary, expiresAt: w.expiresAt }
          : { kind: "budget" },
    } : {}),
    ...(s.plan ? { plan: { risk: s.plan.risk, steps: s.plan.steps.slice(0, 15).map((p) => ({ n: p.n, do: p.do, files: p.files.map((f) => `${f.action} ${f.path}`) })) } } : {}),
    staged: s.work.staged.map((f) => f.path), commits: s.commits,
    ...(s.pr ? { pr: { number: s.pr.number, url: s.pr.url, ready: s.pr.ready } } : {}),
    ...(s.verify ? { verify: { ran: s.verify.ran, ok: s.verify.ok, summary: s.verify.summary } } : {}),
    fixRounds: s.work.fixRounds, findings: s.findings, ...(s.report ? { report: s.report } : {}), notes: s.notes,
  };
}

export class AgentOrchestrator {
  readonly id: string;
  private readonly jobs: JobRouter;
  private readonly store: JobStore;
  private readonly deps: AgentDeps;
  private readonly concurrency: number;
  private readonly leaseMs: number;
  private readonly active = new Map<string, Active>();
  private polling: Promise<number> | null = null;
  private again = false;
  private dead = false;
  private closed = false;
  private beat: ReturnType<typeof setInterval> | null = null;

  constructor(o: OrchestratorOptions) {
    this.id = `agent-${o.instanceId ?? randomUUID().slice(0, 8)}`;
    this.jobs = o.jobs;
    this.store = o.store;
    this.deps = o.deps;
    this.concurrency = Math.max(1, Math.floor(o.concurrency));
    this.leaseMs = o.leaseMs ?? AGENT_LEASE_MS;
  }

  private now(): number { return this.deps.now(); }

  /** Jobs this server is driving now. */
  get running(): number { return this.active.size; }

  // ----------------------------------------------------------- enqueueing

  /**
   * A job made for the agent: its whole request is written into its state (the job keeps the first 500
   * characters), and the worker is nudged. Idempotent: a job that already has a state is left as it is.
   */
  async enqueue(jobId: string, task?: string): Promise<void> {
    const job = await this.store.getJobById(jobId);
    if (!job || isEnded(job.state)) return;
    if (!stateOf(job.checkpoint)) {
      const text = typeof task === "string" && task.trim() ? task.trim() : job.task;
      const state = initialState(text.slice(0, TASK_CHARS), this.now());
      await this.store.casJob(job.id, { agentEpoch: job.agentEpoch }, {
        agent: true, checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> },
      });
    } else if (!job.agent) {
      await this.store.casJob(job.id, { agentEpoch: job.agentEpoch }, { agent: true });
    }
    this.kick();
  }

  /** Looks for work soon, without waiting for it. */
  kick(): void {
    if (this.dead || this.closed) return;
    void this.poll().catch((err) => this.deps.log?.warn({ error: (err as Error)?.name }, "code agent: a poll failed"));
  }

  // ------------------------------------------------------------- claiming

  /** Claims free agent jobs, up to the room this server has, and starts the loop on each. Returns how many were started. */
  async poll(): Promise<number> {
    if (this.dead || this.closed) return 0;
    if (this.polling) {
      // A poll is running: ask for one more when it ends, so a job made during it is not left for the next tick.
      this.again = true;
      return this.polling;
    }
    const pass = async (): Promise<number> => {
      let started = 0;
      do {
        this.again = false;
        const room = this.concurrency - this.active.size;
        if (room <= 0) break;
        for (const j of await this.store.listClaimable(this.now(), room * 2 + 2)) {
          if (this.active.size >= this.concurrency) break;
          if (this.active.has(j.id)) continue;
          if (await this.claimAndRun(j)) started += 1;
        }
      } while (this.again && !this.dead && !this.closed);
      return started;
    };
    // Cleared in a callback of its own, which runs after `this.polling` is set: a pass that has no room ends at once, and must not leave itself behind as the poll in progress.
    const running: Promise<number> = pass().finally(() => { if (this.polling === running) this.polling = null; });
    this.polling = running;
    return this.polling;
  }

  private async claimAndRun(j: CodeJob): Promise<boolean> {
    const now = this.now();
    const claimed = await this.store.casJob(j.id, { agentEpoch: j.agentEpoch, agentFreeBy: now, states: CLAIMABLE_STATES }, {
      agentHolder: this.id, agentEpoch: j.agentEpoch + 1, agentExpiresAt: now + this.leaseMs, ...(j.state === "queued" ? { state: "running" as const } : {}),
    });
    if (!claimed) return false;
    const abort = new AbortController();
    const epoch = claimed.agentEpoch;
    const claim = this.claimFor(claimed.id, epoch);
    const entry: Active = { jobId: claimed.id, epoch, abort, done: Promise.resolve() };
    entry.done = this.drive(claimed, claim, abort).finally(() => {
      this.active.delete(claimed.id);
      // Room has come free, and a job may be waiting for it.
      if (!this.dead && !this.closed) this.kick();
    });
    this.active.set(claimed.id, entry);
    return true;
  }

  private async drive(job: CodeJob, claim: Claim, abort: AbortController): Promise<void> {
    try {
      const state = stateOf(job.checkpoint) ?? initialState(job.task, this.now());
      await runLoop({ job, state, deps: this.deps, claim, signal: abort.signal });
    } catch (err) {
      if (err instanceof LostClaim || this.dead) return;
      await this.errored(job, claim, err);
    }
  }

  /** A loop failed on something unexpected: the claim is let go with a wait that doubles, and the third time running the job is failed. */
  private async errored(job: CodeJob, claim: Claim, err: unknown): Promise<void> {
    const why = (err as { code?: string; name?: string } | null)?.code ?? (err as Error)?.name ?? "error";
    this.deps.log?.warn({ jobId: job.id, error: why }, "code agent: the loop failed");
    try {
      const cur = await this.store.getJobById(job.id);
      if (!cur || cur.agentEpoch !== claim.epoch || isEnded(cur.state)) return;
      const state = stateOf(cur.checkpoint);
      const errors = (state?.errors ?? 0) + 1;
      if (errors >= LOOP_ERRORS_MAX) {
        await this.jobs.finishJob(job.id, { ok: false, reason: `Something went wrong on Tailzu's side three times running (${why}). What was committed so far is on the branch; nothing else was changed.` });
        return;
      }
      if (state) state.errors = errors;
      await this.store.casJob(job.id, { agentEpoch: claim.epoch }, {
        agentHolder: null, agentExpiresAt: this.now() + ERROR_BACKOFF_MS * 2 ** (errors - 1),
        ...(state ? { checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown> } } : {}),
      });
    } catch { /* the next tick finds it */ }
  }

  /** The claim a loop writes through: every call checks the epoch it was given. */
  private claimFor(jobId: string, epoch: number): Claim {
    const live = async (): Promise<CodeJob> => {
      if (this.dead) throw new LostClaim();
      const cur = await this.store.getJobById(jobId);
      if (!cur || cur.agentEpoch !== epoch || isEnded(cur.state)) throw new LostClaim();
      return cur;
    };
    return {
      epoch,
      fresh: live,
      renew: async () => {
        await live();
        const next = await this.store.casJob(jobId, { agentEpoch: epoch, states: WRITABLE }, { agentExpiresAt: this.now() + this.leaseMs });
        if (!next) throw new LostClaim();
      },
      save: async (state, o) => {
        const cur = await live();
        const next = await this.store.casJob(jobId, { agentEpoch: epoch, states: WRITABLE }, {
          checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown>, ...(o?.headSha ? { headSha: o.headSha } : {}), ...(o?.notes ? { notes: o.notes } : {}) },
          agentExpiresAt: this.now() + this.leaseMs,
        });
        if (!next) throw new LostClaim();
        return next;
      },
      park: async (state, p) => {
        const cur = await live();
        const next = await this.store.casJob(jobId, { agentEpoch: epoch, states: WRITABLE }, {
          state: "waiting_for_you", waitingOn: p.waitingOn, reason: brief(p.reason, 300),
          checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown> }, agentHolder: null, agentExpiresAt: null,
        });
        if (!next) throw new LostClaim();
      },
    };
  }

  // ------------------------------------------------------------ the clock

  /**
   * One pass of the ticker (code/jobs/ticker.ts): claims that ran out are handed back (the epoch goes up, so
   * their old holder can never write again), and free jobs are picked up.
   */
  async tick(): Promise<{ handedBack: number; started: number }> {
    if (this.dead || this.closed) return { handedBack: 0, started: 0 };
    let handedBack = 0;
    const now = this.now();
    for (const j of await this.store.listAgentExpired(now, 100)) {
      const back = await this.store.casJob(j.id, { agentEpoch: j.agentEpoch, agentFreeBy: now }, { agentHolder: null, agentExpiresAt: null, agentEpoch: j.agentEpoch + 1 });
      if (back) {
        handedBack += 1;
        this.active.get(j.id)?.abort.abort();
      }
    }
    return { handedBack, started: await this.poll() };
  }

  /** Keeps the claim of every job this server is driving alive. A claim that is gone ends that loop. */
  async heartbeat(): Promise<void> {
    if (this.dead) return;
    for (const a of [...this.active.values()]) {
      const next = await this.store.casJob(a.jobId, { agentEpoch: a.epoch, states: WRITABLE }, { agentExpiresAt: this.now() + this.leaseMs }).catch(() => null);
      if (!next) a.abort.abort();
    }
  }

  /** Starts the heartbeat and looks for work now. The ticker (every 15 seconds) does the rest. */
  start(): void {
    if (this.beat || this.dead) return;
    this.beat = setInterval(() => void this.heartbeat(), Math.floor(this.leaseMs / 3));
    this.beat.unref?.();
    this.kick();
  }

  /** The server is closing: the loops are stopped and their claims let go, so another server takes the jobs up at once. */
  async stop(): Promise<void> {
    this.closed = true;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    const mine = [...this.active.values()];
    for (const a of mine) a.abort.abort();
    await Promise.allSettled(mine.map((a) => a.done));
    for (const a of mine) {
      await this.store.casJob(a.jobId, { agentEpoch: a.epoch }, { agentHolder: null, agentExpiresAt: null }).catch(() => null);
    }
  }

  /** For tests: the power goes. Nothing is let go, nothing more is written; the claims just run out. */
  crash(): void {
    this.dead = true;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    for (const a of this.active.values()) a.abort.abort();
  }

  /** Waits until no loop is running on this server (and none is about to start). */
  async idle(): Promise<void> {
    for (;;) {
      if (this.polling) await this.polling.catch(() => 0);
      const running = [...this.active.values()];
      if (!running.length && !this.polling) return;
      await Promise.allSettled(running.map((a) => a.done));
      if (!this.active.size && !this.polling) return;
    }
  }

  // ------------------------------------------------------ the person's word

  /** The person's own agent job, with its state; not found for anyone else's. */
  private async mine(userId: string, jobId: string): Promise<{ job: CodeJob; state: AgentState }> {
    const job = await this.jobs.job(userId, jobId);
    const state = stateOf(job.checkpoint);
    if (!state) throw notWaiting("anything from Tailzu's agent");
    return { job, state };
  }

  private async resume(job: CodeJob, state: AgentState): Promise<CodeJob> {
    const next = await this.store.casJob(job.id, { agentEpoch: job.agentEpoch, states: ["waiting_for_you"] }, {
      state: "running", waitingOn: null, reason: "", checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> },
    });
    if (!next) throw notWaiting("that");
    this.kick();
    return next;
  }

  /** What the job looks like to the person: the job, and where the agent is. */
  async view(userId: string, jobId: string): Promise<{ job: CodeJob; agent: AgentView | null }> {
    const job = await this.jobs.job(userId, jobId);
    const state = stateOf(job.checkpoint);
    return { job: stripAgent(job), agent: state ? viewOfState(state) : null };
  }

  /** An answer to a question the job asked. */
  async answer(userId: string, jobId: string, answer: unknown): Promise<CodeJob> {
    const text = typeof answer === "string" ? answer.trim() : "";
    if (!text) throw new ConnectorError("bad_request", "answer is what you say back: some words.");
    if (text.length > 4000) throw new ConnectorError("bad_request", "answer is at most 4,000 characters.");
    const { job, state } = await this.mine(userId, jobId);
    if (job.state !== "waiting_for_you" || job.waitingOn !== "answer" || state.waiting?.kind !== "question") throw notWaiting("an answer");
    state.waiting = { ...state.waiting, answer: text };
    return stripAgent(await this.resume(job, state));
  }

  /**
   * A yes to what the job asked (a plan, a commit, marking a pull request ready). The same two steps as every
   * question: with no `approvalId` it answers the question (what would be done, whether Face ID goes with it,
   * the id to say yes with); with the id, it says yes. An approval that has run out is asked again.
   */
  async approve(userId: string, jobId: string, approvalId?: string): Promise<
    | { needsApproval: true; approvalId: string; action: string; summary: Record<string, unknown>; faceId: boolean; expiresAt: number }
    | { refreshing: true }
    | { approved: true; job: CodeJob }
  > {
    const { job, state } = await this.mine(userId, jobId);
    const w = state.waiting;
    if (job.state !== "waiting_for_you" || job.waitingOn !== "approval" || w?.kind !== "approval") throw notWaiting("a yes");
    const approvals = this.deps.projects.approvals;
    const key = { userId, projectId: job.projectId, action: w.action, branch: job.branch };
    if (approvalId === undefined) {
      if (w.expiresAt > this.now()) {
        return { needsApproval: true, approvalId: w.approvalId, action: w.action, summary: w.summary, faceId: w.faceId, expiresAt: w.expiresAt };
      }
      if (w.for === "plan") {
        const a = approvals.issue({ userId, projectId: job.projectId, action: w.action, branch: job.branch });
        state.waiting = { ...w, approvalId: a.id, expiresAt: a.expiresAt };
        await this.store.casJob(job.id, { agentEpoch: job.agentEpoch, states: ["waiting_for_you"] }, { checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> } });
        return { needsApproval: true, approvalId: a.id, action: w.action, summary: w.summary, faceId: w.faceId, expiresAt: a.expiresAt };
      }
      // The commit's or the pull request's question is the policy's: it is asked again by doing it again.
      state.waiting = undefined;
      await this.resume(job, state);
      return { refreshing: true };
    }
    if (typeof approvalId !== "string" || !approvalId || approvalId.length > 200) throw new ConnectorError("bad_request", "approvalId is the id the question gave.");
    if (w.for === "plan") {
      const taken = approvals.take(approvalId, key);
      if (!taken.ok) {
        throw taken.reason === "expired"
          ? new ConnectorError("approval_expired", "That approval ran out. Ask again, and say yes within ten minutes.")
          : new ConnectorError("approval_invalid", "That isn't an approval I have for this. Ask again to get one.");
      }
    } else if (approvalId !== w.approvalId) {
      throw new ConnectorError("approval_invalid", "That isn't an approval I have for this. Ask again to get one.");
    }
    state.waiting = { ...w, approved: true };
    return { approved: true, job: stripAgent(await this.resume(job, state)) };
  }

  /** No to what the job asked. A plan or a commit not approved ends the job; a pull request not marked ready stays a draft and the job reports. */
  async deny(userId: string, jobId: string): Promise<CodeJob> {
    const { job, state } = await this.mine(userId, jobId);
    const w = state.waiting;
    if (job.state !== "waiting_for_you" || job.waitingOn !== "approval" || w?.kind !== "approval") throw notWaiting("a yes");
    if (w.for === "ready") {
      state.waiting = undefined;
      state.readyDenied = true;
      return stripAgent(await this.resume(job, state));
    }
    const why = w.for === "plan" ? "You didn't approve the plan, so nothing was changed." : "You didn't approve the commit, so nothing was committed.";
    return stripAgent(await this.jobs.cancelJob(job.id, why));
  }

  /** More budget. A job that stopped for the money goes on from where it was. */
  async addBudget(userId: string, jobId: string, addPaise: unknown): Promise<CodeJob> {
    if (typeof addPaise !== "number" || !Number.isInteger(addPaise) || addPaise < 1 || addPaise > PAISE_MAX) {
      throw new ConnectorError("bad_request", `addPaise is a whole number of paise, 1 to ${PAISE_MAX}.`);
    }
    let job = await this.jobs.job(userId, jobId);
    if (isEnded(job.state)) throw new ConnectorError("job_over", "That job is over.");
    for (let i = 0; i < 8; i += 1) {
      const budget = job.budgetPaise + addPaise;
      if (budget > PAISE_MAX) throw new ConnectorError("bad_request", `A job's budget is at most ${PAISE_MAX} paise.`);
      const raised = await this.store.casJob(job.id, { budgetPaise: job.budgetPaise }, { budgetPaise: budget });
      if (raised) { job = raised; break; }
      job = await this.jobs.job(userId, jobId);
    }
    const state = stateOf(job.checkpoint);
    if (state && job.state === "waiting_for_you" && job.waitingOn === "budget") {
      state.waiting = undefined;
      return stripAgent(await this.resume(job, state));
    }
    return stripAgent(job);
  }

  /** Stops the job: the loop here is told, and the router drops any step that is out. */
  async stopJob(userId: string, jobId: string): Promise<CodeJob> {
    const job = await this.jobs.job(userId, jobId);
    this.active.get(job.id)?.abort.abort();
    return stripAgent(await this.jobs.cancelJob(job.id));
  }

  /** The job's work log, in order. */
  async workLog(userId: string, jobId: string): Promise<WorkEntry[]> {
    const job = await this.jobs.job(userId, jobId);
    return new WorkLog(job.id, { store: this.deps.worklog ?? worklogStore() }).entries();
  }
}

/** The job without the agent's state inside its checkpoint, which can hold a lot of the person's code. `GET .../:id` and the list say where the agent is instead (viewOfState). */
export function stripAgent(job: CodeJob): CodeJob {
  if (!job.checkpoint.agent) return job;
  const { agent: _agent, ...checkpoint } = job.checkpoint;
  return { ...job, checkpoint };
}

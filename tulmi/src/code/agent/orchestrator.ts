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
 *
 * JOBS ON CLOUDFLARE (CODE_JOBS_MODE=cloudflare, jobs/, docs/cloudflare-jobs.md). The same class serves three roles:
 *
 *   local     (the default) everything above: it claims jobs and runs the loop itself
 *   remote    the VPS when jobs run on the Worker: it claims nothing, polls nothing and starts no timer. The person's word
 *             (answer, approve, deny, budget, stop) still goes through the methods below, because the state lives in the
 *             database and the owner's rules are checked here; what changes is who is TOLD afterwards: `kick()` becomes a
 *             call to the Worker (`remote.wake`), and a new job is handed over (`remote.start`)
 *   worker    the Worker's own: `advance()` claims a job for one advance of its Workflow, runs the loop to its next
 *             checkpoint (loop.ts advanceLoop) and lets the claim go. The claim, the epoch fencing and the checkpoints are
 *             exactly the ones a server uses, so a retried step, a second Workflow instance or a VPS that is still in
 *             local mode can never run one job twice
 */
import { randomUUID } from "node:crypto";
import { ConnectorError } from "../../connectors/state.js";
import type { WakeKind } from "../jobs/handoff/protocol.js";
import { CLAIMABLE_STATES } from "../jobs/store.js";
import type { JobRouter } from "../jobs/router.js";
import type { JobStore } from "../jobs/store.js";
import { AGENT_LEASE_MS, PAISE_MAX, brief, isEnded, type CodeJob, type JobState } from "../jobs/types.js";
import { SAID_MAX_CHARS } from "../live/limits.js";
import { MemoryInbox } from "../live/ports.js";
import { WorkLog, worklogStore, type WorkEntry } from "../work/index.js";
import type { AgentDeps } from "./deps.js";
import { advanceLoop, runLoop, type Advance } from "./loop.js";
import { reportText } from "./report.js";
import { LostClaim, type Claim } from "./run.js";
import { ERROR_BACKOFF_MS, LOOP_ERRORS_MAX, TASK_CHARS, initialState, stateOf, type AgentState } from "./types.js";

/** The states a write by the claim's holder may happen in. */
const WRITABLE: readonly JobState[] = ["queued", "running", "waiting_for_compute", "waiting_for_you"];

const notWaiting = (what: string) => new ConnectorError("not_waiting", `That job isn't waiting for ${what}.`);

/** What the VPS tells the Worker's Workflow about a job besides starting it (jobs/handoff/protocol.ts). */
export type { WakeKind };

/** The VPS's way to the Worker (code/jobs/handoff/client.ts). */
export interface RemoteJobs {
  /** Starts the job's Workflow. Tried again a few times; throws when it could not be (the job is then failed with a reason). */
  start(jobId: string): Promise<void>;
  /** Says that something changed for a job, so its Workflow looks again. Never throws: the state is in the database, and the Worker's cron looks again. */
  wake(jobId: string, kind: WakeKind): Promise<void>;
  /**
   * The person said something while the job works (POST /v1/code/jobs/:id/message): the Worker puts it in the job's room, where the loop takes it at
   * the start of its next model turn, and wakes the job's Workflow. Throws when it could not be handed over, so the person is told it was not sent.
   */
  message?(jobId: string, text: string): Promise<void>;
}

export interface OrchestratorOptions {
  jobs: JobRouter;
  store: JobStore;
  deps: AgentDeps;
  /** Jobs run on the Cloudflare Worker: this server hands them over and claims none (the "remote" role above). */
  remote?: RemoteJobs;
  /** Runs no loops and no timers of its own: the Worker's role (jobs/ calls `advance`). */
  passive?: boolean;
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
  private readonly remote: RemoteJobs | undefined;
  /** Never claims or runs a loop by itself (remote or worker). */
  private readonly passive: boolean;
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
    this.remote = o.remote;
    this.passive = o.passive === true || o.remote !== undefined;
  }

  private now(): number { return this.deps.now(); }

  /** Jobs this server is driving now. */
  get running(): number { return this.active.size; }

  // ----------------------------------------------------------- enqueueing

  /**
   * A job made for the agent: its whole request is written into its state (the job keeps the first 500
   * characters), and the worker is nudged. Idempotent: a job that already has a state is left as it is.
   */
  async enqueue(jobId: string, task?: string): Promise<CodeJob | null> {
    const job = await this.store.getJobById(jobId);
    if (!job || isEnded(job.state)) return job;
    if (!stateOf(job.checkpoint)) {
      const text = typeof task === "string" && task.trim() ? task.trim() : job.task;
      const state = initialState(text.slice(0, TASK_CHARS), this.now());
      await this.store.casJob(job.id, { agentEpoch: job.agentEpoch }, {
        agent: true, checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> },
      });
    } else if (!job.agent) {
      await this.store.casJob(job.id, { agentEpoch: job.agentEpoch }, { agent: true });
    }
    if (this.remote) return this.handOver(job.id);
    this.kick();
    return this.store.getJobById(jobId);
  }

  /**
   * Gives a new job to the Worker. When the Worker cannot be reached after the client's tries, the job is failed with a reason the person
   * can read (nothing was started, so nothing was changed), and it is that failed job that is returned.
   */
  private async handOver(jobId: string): Promise<CodeJob | null> {
    try {
      await this.remote!.start(jobId);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? (err as Error)?.name ?? "error";
      this.deps.log?.warn({ jobId, error: code }, "code agent: the jobs Worker could not be reached");
      await this.jobs.finishJob(jobId, {
        ok: false,
        reason: "Tailzu could not hand this job to the machine that runs it, after trying three times. Nothing was changed. Try again in a little while.",
      }).catch(() => undefined);
    }
    return this.store.getJobById(jobId);
  }

  /** Looks for work soon, without waiting for it. */
  kick(): void {
    if (this.dead || this.closed || this.passive) return;
    void this.poll().catch((err) => this.deps.log?.warn({ error: (err as Error)?.name }, "code agent: a poll failed"));
  }

  // ------------------------------------------------------------- claiming

  /** Claims free agent jobs, up to the room this server has, and starts the loop on each. Returns how many were started. */
  async poll(): Promise<number> {
    if (this.dead || this.closed || this.passive) return 0;
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
    if (this.dead || this.closed || this.remote) return { handedBack: 0, started: 0 };
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
    if (this.beat || this.dead || this.passive) return;
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

  // ----------------------------------------------- one advance (the Worker)

  /**
   * ONE ADVANCE OF A JOB, for a Cloudflare Workflow (jobs/src/agentJob.ts): claims the job, runs the loop up to its next checkpoint
   * (loop.ts advanceLoop) and lets go of the claim, then says what the Workflow should do next.
   *
   * The claim is the one a server takes (`claimAndRun`): one compare-and-set on the job's epoch, held for `leaseMs`, every write
   * fenced by it. So the Workflow is not trusted to be alone: a retried step whose first attempt is still running, a second Workflow
   * on the same job, or a VPS in local mode all find the claim taken, and `advance` says "wait, claim" until it runs out.
   *
   * A job that is waiting for the person is not claimed at all: the answer is "wait" until their word is written into it.
   * An error it does not understand is counted and backed off from exactly as `errored` does for a loop on a server: the claim is
   * let go with a wait that doubles (15 s, then 30 s), and the third time running the job is failed, with a plain reason.
   */
  async advance(jobId: string, o: { holder: string; signal?: AbortSignal; turns?: number }): Promise<Advance> {
    const job = await this.store.getJobById(jobId);
    if (!job || isEnded(job.state) || !job.agent) return { next: "end", why: "over" };
    if (job.state === "waiting_for_you" && (job.waitingOn === "answer" || job.waitingOn === "approval" || job.waitingOn === "budget")) {
      return { next: "wait", waitingOn: job.waitingOn };
    }
    const now = this.now();
    const claimed = await this.store.casJob(job.id, { agentEpoch: job.agentEpoch, agentFreeBy: now, states: CLAIMABLE_STATES }, {
      agentHolder: o.holder, agentEpoch: job.agentEpoch + 1, agentExpiresAt: now + this.leaseMs, ...(job.state === "queued" ? { state: "running" as const } : {}),
    });
    if (!claimed) {
      const cur = await this.store.getJobById(jobId);
      if (!cur || isEnded(cur.state)) return { next: "end", why: "over" };
      // Somebody holds it (or the epoch moved between the read and the write): look again when their time is up.
      const wakeAt = Math.max(now + 5_000, cur.agentExpiresAt ?? now + 15_000);
      return { next: "wait", waitingOn: "claim", wakeAt, waitMs: wakeAt - now };
    }
    const epoch = claimed.agentEpoch;
    const claim = this.claimFor(claimed.id, epoch);
    try {
      const state = stateOf(claimed.checkpoint) ?? initialState(claimed.task, now);
      const a = await advanceLoop({ job: claimed, state, deps: this.deps, claim, signal: o.signal ?? new AbortController().signal }, o.turns !== undefined ? { turns: o.turns } : {});
      return a.next === "end" && a.why === "lost" ? await this.settleLost(jobId) : a;
    } catch (err) {
      if (err instanceof LostClaim) return await this.settleLost(jobId);
      return await this.advanceErrored(claimed, epoch, err);
    } finally {
      // Let go of the claim so the next advance (or the next try of this one) takes it at once. A no-op when the epoch has moved on (the ticker handed it back, the job was parked or ended).
      await this.store.casJob(claimed.id, { agentEpoch: epoch }, { agentHolder: null, agentExpiresAt: null }).catch(() => null);
    }
  }

  /**
   * The claim was not ours any more. If the job is over (the person stopped it) that is the end; if not, the ticker handed the claim back
   * to someone (this advance ran long) and the job is still there to be claimed again, so the driver is told to look again shortly.
   */
  private async settleLost(jobId: string): Promise<Advance> {
    const cur = await this.store.getJobById(jobId);
    if (!cur || isEnded(cur.state)) return { next: "end", why: "over" };
    return { next: "wait", waitingOn: "claim", wakeAt: this.now() + 5_000, waitMs: 5_000 };
  }

  private async advanceErrored(job: CodeJob, epoch: number, err: unknown): Promise<Advance> {
    const why = (err as { code?: string; name?: string } | null)?.code ?? (err as Error)?.name ?? "error";
    this.deps.log?.warn({ jobId: job.id, error: why }, "code agent: an advance failed");
    const cur = await this.store.getJobById(job.id);
    if (!cur || cur.agentEpoch !== epoch || isEnded(cur.state)) return { next: "end", why: "lost" };
    const state = stateOf(cur.checkpoint);
    const errors = (state?.errors ?? 0) + 1;
    if (errors >= LOOP_ERRORS_MAX) {
      await this.jobs.finishJob(job.id, { ok: false, reason: `Something went wrong on Tailzu's side three times running (${why}). What was committed so far is on the branch; nothing else was changed.` });
      return { next: "end", why: "finished" };
    }
    if (state) state.errors = errors;
    const wakeAt = this.now() + ERROR_BACKOFF_MS * 2 ** (errors - 1);
    // The wait is the Workflow's (it sleeps until `wakeAt`); the count is kept in the state so the third failure in a row fails the job.
    if (state) {
      await this.store.casJob(job.id, { agentEpoch: epoch }, { checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown> } });
    }
    return { next: "wait", waitingOn: "retry", wakeAt, waitMs: wakeAt - this.now() };
  }

  /**
   * Ends a job nobody came back to (a question or a yes that was never answered): the report says why and what was and was not done,
   * the job is failed with the reason, and the person is told through the router's own notification. Nothing on the branch changes.
   */
  async abandon(jobId: string, why: string): Promise<void> {
    const job = await this.store.getJobById(jobId);
    if (!job || isEnded(job.state)) return;
    const state = stateOf(job.checkpoint);
    if (state) {
      state.report = {
        at: this.now(), outcome: "failed", text: reportText({ state, spentPaise: job.spentPaise, budgetPaise: job.budgetPaise, outcome: "failed", why }),
        ...(state.pr ? { prUrl: state.pr.url } : {}), costPaise: job.spentPaise,
      };
      state.waiting = undefined;
      state.phase = "done";
      await this.store.casJob(job.id, { agentEpoch: job.agentEpoch }, { checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> } });
    }
    await this.jobs.finishJob(jobId, { ok: false, reason: why });
  }

  // ------------------------------------------------------ the person's word

  /** The person's own agent job, with its state; not found for anyone else's. */
  private async mine(userId: string, jobId: string): Promise<{ job: CodeJob; state: AgentState }> {
    const job = await this.jobs.job(userId, jobId);
    const state = stateOf(job.checkpoint);
    if (!state) throw notWaiting("anything from Tailzu's agent");
    return { job, state };
  }

  private async resume(job: CodeJob, state: AgentState, kind: WakeKind): Promise<CodeJob> {
    const next = await this.store.casJob(job.id, { agentEpoch: job.agentEpoch, states: ["waiting_for_you"] }, {
      state: "running", waitingOn: null, reason: "", checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> },
    });
    if (!next) throw notWaiting("that");
    // The word is in the database. Where the Worker runs the job, its Workflow is told to look again (and does not need telling twice).
    if (this.remote) await this.remote.wake(job.id, kind);
    else this.kick();
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
    return stripAgent(await this.resume(job, state, "answer"));
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
        state.waiting = { ...w, approvalId: a.id, expiresAt: a.expiresAt, bound: a };
        await this.store.casJob(job.id, { agentEpoch: job.agentEpoch, states: ["waiting_for_you"] }, { checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> } });
        return { needsApproval: true, approvalId: a.id, action: w.action, summary: w.summary, faceId: w.faceId, expiresAt: a.expiresAt };
      }
      // The commit's or the pull request's question is the policy's: it is asked again by doing it again.
      state.waiting = undefined;
      await this.resume(job, state, "approve");
      return { refreshing: true };
    }
    if (typeof approvalId !== "string" || !approvalId || approvalId.length > 200) throw new ConnectorError("bad_request", "approvalId is the id the question gave.");
    if (w.for === "plan") {
      // The question may have been asked by another process (a Cloudflare Worker): its record is in the job's state.
      if (w.bound && w.bound.id === approvalId && !approvals.restore(w.bound) && w.expiresAt <= this.now()) {
        throw new ConnectorError("approval_expired", "That approval ran out. Ask again, and say yes within ten minutes.");
      }
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
    return { approved: true, job: stripAgent(await this.resume(job, state, "approve")) };
  }

  /** No to what the job asked. A plan or a commit not approved ends the job; a pull request not marked ready stays a draft and the job reports. */
  async deny(userId: string, jobId: string): Promise<CodeJob> {
    const { job, state } = await this.mine(userId, jobId);
    const w = state.waiting;
    if (job.state !== "waiting_for_you" || job.waitingOn !== "approval" || w?.kind !== "approval") throw notWaiting("a yes");
    if (w.for === "ready") {
      state.waiting = undefined;
      state.readyDenied = true;
      return stripAgent(await this.resume(job, state, "deny"));
    }
    const why = w.for === "plan" ? "You didn't approve the plan, so nothing was changed." : "You didn't approve the commit, so nothing was committed.";
    const ended = await this.jobs.cancelJob(job.id, why);
    await this.remote?.wake(job.id, "deny");
    return stripAgent(ended);
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
      return stripAgent(await this.resume(job, state, "budget"));
    }
    // Not waiting for money: it is on the books for the next time it asks, and nothing needs waking.
    return stripAgent(job);
  }

  /**
   * A word from the person to a job that is working (not an answer to a question: that is `answer`). It is shown to the model as the person's own
   * words at the start of its next turn. The owner's only; a job that is over refuses it. Where the jobs run on the Worker it is handed over (the
   * room keeps it); here it is kept in this process's memory, which is enough because this process runs the job.
   */
  async message(userId: string, jobId: string, text: unknown): Promise<{ delivered: true }> {
    const t = typeof text === "string" ? text.trim() : "";
    if (!t) throw new ConnectorError("bad_request", "text is what you want to tell it: some words.");
    if (t.length > SAID_MAX_CHARS) throw new ConnectorError("bad_request", `text is at most ${SAID_MAX_CHARS} characters.`);
    const job = await this.jobs.job(userId, jobId);
    if (isEnded(job.state)) throw new ConnectorError("job_over", "That job is over.");
    if (!job.agent) throw notWaiting("anything from Tailzu's agent");
    if (this.remote) {
      if (!this.remote.message) throw new ConnectorError("live_off", "Messages to a working job are not switched on.");
      try {
        await this.remote.message(job.id, t);
      } catch {
        throw new ConnectorError("unreachable", "Tailzu could not reach the machine that runs this job, so it did not get your message. Try again in a moment.");
      }
      return { delivered: true };
    }
    const inbox = this.deps.live?.inbox;
    if (!(inbox instanceof MemoryInbox)) throw new ConnectorError("live_off", "Messages to a working job are not switched on.");
    inbox.add(job.id, t, this.now());
    this.kick();
    return { delivered: true };
  }

  /** Stops the job: the loop here is told, and the router drops any step that is out. */
  async stopJob(userId: string, jobId: string): Promise<CodeJob> {
    const job = await this.jobs.job(userId, jobId);
    this.active.get(job.id)?.abort.abort();
    const ended = await this.jobs.cancelJob(job.id);
    await this.remote?.wake(job.id, "stop");
    return stripAgent(ended);
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

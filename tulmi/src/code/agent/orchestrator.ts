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
import { isNeedsApproval, type NeedsApproval } from "../policy.js";
import { adjustSpend } from "../team/budget.js";
import { repoRef, workspace } from "../projects.js";
import { WorkLog, worklogStore, type Located, type WorkEntry } from "../work/index.js";
import type { AgentDeps } from "./deps.js";
import { errorFacts, errorLine, kindOf } from "./failure.js";
import { advanceLoop, runLoop, type Advance } from "./loop.js";
import { reportText } from "./report.js";
import { revertFiles } from "./rewind.js";
import { LostClaim, type Claim } from "./run.js";
import { DEFAULT_PROJECT_SETTINGS, readSettingsPatch } from "./settings.js";
import { viewOfPart, viewOfTeam, REPOS_MAX, TEAM_COMMANDS_MAX, type PartView, type TeamCommand, type TeamMode, type TeamView } from "../team/types.js";
import { ERROR_BACKOFF_MS, LOOP_ERRORS_MAX, TASK_CHARS, initialState, stateOf, type AgentState, type CareContext, type JobMode, type SpecArtifact } from "./types.js";

/** The states a write by the claim's holder may happen in. */
const WRITABLE: readonly JobState[] = ["queued", "running", "waiting_for_compute", "waiting_for_you"];

const notWaiting = (what: string) => new ConnectorError("not_waiting", `That job isn't waiting for ${what}.`);

/** What a job may be made with besides its words (enqueue). */
export interface EnqueueOptions {
  /** The approved design this job builds (artifacts/build.ts). */
  spec?: SpecArtifact;
  /** Where the change belongs, when something already found it. */
  located?: Located;
  /** "chat": a conversation about the code found it (code/chat); "care": a reviewer's comment pointed at it (code/prcare). Either way the job does not look for the place again. */
  locatedFrom?: "chat" | "care";
  /** How the job is worked, when the request or the front door decided; else the project's setting. */
  mode?: JobMode;
  /** "Always show me the plan first", when the request said; else the project's setting. */
  planFirst?: boolean;
  /** Why this job exists, when it is PR care's (code/prcare). */
  care?: CareContext;
  /** Lead and helpers (code/team): "on" always splits the goal into parts, "off" never does, "auto" lets the plan decide. Else the project's setting. */
  team?: TeamMode;
  /** The other projects of the same person this goal spans, already checked (`teamProjects`): a lead job over several repositories. */
  projects?: string[];
}

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
  /** How the job is worked, and whether it showed the plan first. */
  mode: "guided" | "freeform";
  planFirst: boolean;
  /** Steps of the model's work so far: the points a rewind can go to are numbered by them. */
  steps: number;
  findings: AgentState["findings"];
  report?: AgentState["report"];
  notes: string[];
  /** The approved artifact this job builds (artifacts/build.ts): which one, and which version. */
  spec?: { artifactId: string; version: number; title: string };
  /** The design check of such a job (agent/design.ts): where it is, how many times it sent the job back to work, the latest match, and why it did not run. */
  design?: { stage: string; round: number; match?: number; skipped?: string };
  /** A lead's team (code/team): where each part stands (GET .../team has the rest). */
  team?: { stage: string; why: string; parts: Array<{ id: number; title: string; status: string; jobId?: string }> };
  /** A helper's part of a lead's goal: whose it is and which part. */
  part?: { parentId: string; id: number; title: string; round: number; repo?: boolean };
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
    fixRounds: s.work.fixRounds, mode: s.mode ?? "guided", planFirst: s.planFirst === true, steps: s.work.turns, findings: s.findings, ...(s.report ? { report: s.report } : {}), notes: s.notes,
    ...(s.spec ? { spec: { artifactId: s.spec.artifactId, version: s.spec.version, title: s.spec.title } } : {}),
    ...(s.design ? { design: { stage: s.design.stage, round: s.design.round, ...(s.design.history.length ? { match: s.design.history.at(-1)!.match } : {}), ...(s.design.skipped ? { skipped: s.design.skipped } : {}) } } : {}),
    ...(s.team ? { team: { stage: s.team.stage, why: s.team.why, parts: s.team.parts.map((p) => ({ id: p.id, title: p.title, status: p.status, ...(p.jobId ? { jobId: p.jobId } : {}) })) } } : {}),
    ...(s.part ? { part: { parentId: s.part.parentId, id: s.part.id, title: s.part.title, round: s.part.round, ...(s.part.repo ? { repo: true } : {}) } } : {}),
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
  /** Things done because a job ended (a helper's lead woken, a lead's helpers stopped), so a test can wait for them. */
  private readonly settling = new Set<Promise<void>>();
  /** Leads this server is driving that a helper tried to wake while they were busy: they rest for no time when they next rest, instead of the usual wait. */
  private readonly wakes = new Set<string>();

  constructor(o: OrchestratorOptions) {
    this.id = `agent-${o.instanceId ?? randomUUID().slice(0, 8)}`;
    this.jobs = o.jobs;
    this.store = o.store;
    this.deps = o.deps;
    this.concurrency = Math.max(1, Math.floor(o.concurrency));
    this.leaseMs = o.leaseMs ?? AGENT_LEASE_MS;
    this.remote = o.remote;
    this.passive = o.passive === true || o.remote !== undefined;
    // Lead and helpers (code/team): a helper that ends wakes its lead, and a lead that ends stops its helpers. Whoever ends a job (this loop, a route, the router's ticker) reaches here.
    o.jobs.onEnded?.((job) => this.track(this.afterEnded(job)));
  }

  private track(p: Promise<void>): void {
    const q = p.catch(() => undefined).finally(() => { this.settling.delete(q); });
    this.settling.add(q);
  }

  /** A job that was part of a team has ended: the lead is told, or the helpers are stopped. */
  private async afterEnded(job: CodeJob): Promise<void> {
    if (this.dead) return;
    const state = stateOf(job.checkpoint);
    if (!state) return;
    if (state.part?.parentId) await this.wakeParent(state.part.parentId);
    if (state.team) {
      for (const p of state.team.parts) {
        if (!p.jobId || ["merged", "failed", "stopped", "skipped"].includes(p.status)) continue;
        this.active.get(p.jobId)?.abort.abort();
        await this.jobs.cancelJob(p.jobId, "The lead job ended, so this part was stopped.").catch(() => undefined);
      }
      await this.settleLead(job.id);
    }
  }

  /**
   * A lead is over: the slices it took from its wallet for helpers and did not see spent are given back (the lead's spend is then what the team really cost). Done from
   * the lead's saved state, written down first, so that it is done once.
   */
  private async settleLead(jobId: string): Promise<void> {
    const cur = await this.store.getJobById(jobId);
    const state = stateOf(cur?.checkpoint);
    if (!cur || !state?.team) return;
    let back = 0;
    for (const p of state.team.parts) {
      let spent = 0;
      for (const id of p.jobIds) spent += (await this.store.getJobById(id))?.spentPaise ?? 0;
      p.spentPaise = spent;
      const out = p.reservedPaise - p.refundedPaise - spent;
      if (out > 0) { p.refundedPaise += out; back += out; }
    }
    if (back <= 0) return;
    const wrote = await this.store.casJob(cur.id, { agentEpoch: cur.agentEpoch }, { checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown> } });
    if (wrote) await adjustSpend(this.store, cur.id, -back);
  }

  /** The lead of a helper that changed (ended, parked) looks again now. On Cloudflare, the lead's Workflow is sent an event. */
  private async wakeParent(parentId: string): Promise<void> {
    try { await this.deps.team?.wake(parentId); } catch { /* the lead looks again by itself, within its rest */ }
  }

  /** A lead parked for the money of a part goes on: a part has been given some. */
  private async unparkLead(jobId: string): Promise<void> {
    const j = await this.store.getJobById(jobId);
    const st = stateOf(j?.checkpoint);
    if (!j || !st?.team || j.state !== "waiting_for_you" || j.waitingOn !== "budget" || st.waiting?.kind !== "budget") return;
    st.waiting = undefined;
    await this.resume(j, st, "budget").catch(() => undefined);
  }

  /** A resting lead is claimable now (a server): its rest is over. A lead that is being driven is left alone: it looks again when it has done what it is doing. */
  async wakeLead(jobId: string): Promise<void> {
    const j = await this.store.getJobById(jobId);
    if (!j || isEnded(j.state)) return;
    if (j.agentHolder !== null) {
      // Being driven: it is not woken, but it will not rest when it next would (a helper changed after it last looked).
      if (this.active.has(jobId)) this.wakes.add(jobId);
      return;
    }
    await this.store.casJob(j.id, { agentEpoch: j.agentEpoch }, { agentExpiresAt: null });
    this.kick();
  }

  private now(): number { return this.deps.now(); }

  /** Jobs this server is driving now. */
  get running(): number { return this.active.size; }

  // ----------------------------------------------------------- enqueueing

  /**
   * A job made for the agent: its whole request is written into its state (the job keeps the first 500
   * characters), and the worker is nudged. Idempotent: a job that already has a state is left as it is.
   */
  async enqueue(jobId: string, task?: string, o: EnqueueOptions = {}): Promise<CodeJob | null> {
    const job = await this.store.getJobById(jobId);
    if (!job || isEnded(job.state)) return job;
    if (!stateOf(job.checkpoint)) {
      const text = typeof task === "string" && task.trim() ? task.trim() : job.task;
      const state = initialState(text.slice(0, TASK_CHARS), this.now());
      // A job made from an approved design (artifacts/build.ts) starts with the design and the place it goes.
      if (o.spec) state.spec = o.spec;
      if (o.located) {
        state.located = o.located;
        // A conversation about the code found this place (code/chat), or a reviewer pointed at it (code/prcare): locate takes it as it is and does not look again.
        if (o.locatedFrom) state.handoff = true;
      }
      if (o.care) state.care = o.care;
      // How it is worked: the request's own word, else the project's setting, else guided with no plan-first.
      const set = await this.deps.settings?.get(job.projectId).catch(() => null);
      const mode = o.mode ?? set?.mode ?? DEFAULT_PROJECT_SETTINGS.mode;
      const planFirst = o.planFirst ?? set?.planFirst ?? DEFAULT_PROJECT_SETTINGS.planFirst;
      if (mode === "freeform") state.mode = "freeform";
      if (planFirst) state.planFirst = true;
      // Lead and helpers: the request's own word, else the project's setting; "auto" is left out of the state.
      const teamMode = o.team ?? set?.team ?? DEFAULT_PROJECT_SETTINGS.team;
      if (teamMode !== "auto") state.teamMode = teamMode;
      if (o.projects?.length) state.teamRepos = [...new Set(o.projects)].filter((id) => id !== job.projectId).slice(0, REPOS_MAX);
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

  /**
   * A loop failed on something unexpected: the claim is let go with a wait that doubles, and the third time running the job is failed.
   *
   * The log says what the error was (its message and what caused it: failure.ts), not only its class. And NOTHING the job had made is lost to it: the staged
   * edits are in the checkpoint (the loop saved them before the error got out: loop.ts), every try starts from them, and the third failure ends the job with a
   * REPORT that lists them (`failedForGood`), the checkpoint still holding them and where the job had got to.
   */
  private async errored(job: CodeJob, claim: Claim, err: unknown): Promise<void> {
    const facts = errorFacts(err);
    const why = kindOf(facts);
    const cur = await this.store.getJobById(job.id).catch(() => null);
    const state = cur ? stateOf(cur.checkpoint) : undefined;
    try {
      this.deps.log?.warn({ jobId: job.id, error: why, ...(facts.message ? { message: facts.message } : {}), ...(facts.status !== undefined ? { status: facts.status } : {}), ...(facts.cause ? { cause: errorLine(facts.cause) } : {}), ...(state ? { phase: state.phase, staged: state.work.staged.length } : {}) }, "code agent: the loop failed");
      if (!cur || cur.agentEpoch !== claim.epoch || isEnded(cur.state)) return;
      const errors = (state?.errors ?? 0) + 1;
      if (errors >= LOOP_ERRORS_MAX) {
        await this.failedForGood(cur, state, errors, err);
        return;
      }
      if (state) state.errors = errors;
      await this.store.casJob(job.id, { agentEpoch: claim.epoch }, {
        agentHolder: null, agentExpiresAt: this.now() + ERROR_BACKOFF_MS * 2 ** (errors - 1),
        ...(state ? { checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown> } } : {}),
      });
    } catch { /* the next tick finds it */ }
  }

  /**
   * The third failure in a row. The job is failed with a plain reason AND a report in its checkpoint: what went wrong, and what had been done and was not
   * committed (the staged files, which stay staged in the checkpoint, with the phase the job was in, so a person or a later retry can pick the job up from
   * there). The report is what the person reads; without it a failed job showed only "Something went wrong" and an empty diff.
   */
  private async failedForGood(cur: CodeJob, state: AgentState | null | undefined, errors: number, err: unknown): Promise<void> {
    const facts = errorFacts(err);
    const staged = state?.work.staged ?? [];
    const kept = staged.length ? ` The ${staged.length} file${staged.length === 1 ? "" : "s"} I had changed ${staged.length === 1 ? "is" : "are"} kept, uncommitted, with this job.` : "";
    const said = facts.message ? ` The last error said: ${facts.message.slice(0, 160)}.` : "";
    const reason = `Something went wrong on Tailzu's side three times running (${kindOf(facts)}).${said} What was committed so far is on the branch; nothing else was changed.${kept}`;
    if (state) {
      state.errors = errors;
      state.waiting = undefined;
      state.report = {
        at: this.now(), outcome: "failed", costPaise: cur.spentPaise, ...(state.pr ? { prUrl: state.pr.url } : {}),
        text: reportText({ state, spentPaise: cur.spentPaise, budgetPaise: cur.budgetPaise, outcome: "failed", why: `${reason} What went wrong: ${errorLine(facts).slice(0, 400)}` }),
      };
      // The phase is left where it was, not set to done: the staged edits and the place in the work stay in the checkpoint for whoever goes on from here.
      await this.store.casJob(cur.id, { agentEpoch: cur.agentEpoch }, { checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown> } }).catch(() => null);
    }
    await this.jobs.finishJob(cur.id, { ok: false, reason });
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
        // A helper that needs the person (a question, a yes, more money) is something its lead shows; the lead looks again.
        if (state.part?.parentId) this.track(this.wakeParent(state.part.parentId));
      },
      rest: async (state, ms) => {
        const cur = await live();
        const next = await this.store.casJob(jobId, { agentEpoch: epoch, states: WRITABLE }, {
          checkpoint: { ...cur.checkpoint, agent: state as unknown as Record<string, unknown> }, agentHolder: null, agentExpiresAt: this.wakes.delete(jobId) ? this.now() : this.now() + ms,
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
      if (this.settling.size) await Promise.allSettled([...this.settling]);
      if (this.polling) await this.polling.catch(() => 0);
      const running = [...this.active.values()];
      if (!running.length && !this.polling && !this.settling.size) return;
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
    const facts = errorFacts(err);
    const why = kindOf(facts);
    const cur = await this.store.getJobById(job.id);
    const state = cur ? stateOf(cur.checkpoint) : undefined;
    this.deps.log?.warn({ jobId: job.id, error: why, ...(facts.message ? { message: facts.message } : {}), ...(facts.status !== undefined ? { status: facts.status } : {}), ...(facts.cause ? { cause: errorLine(facts.cause) } : {}), ...(state ? { phase: state.phase, staged: state.work.staged.length } : {}) }, "code agent: an advance failed");
    if (!cur || cur.agentEpoch !== epoch || isEnded(cur.state)) return { next: "end", why: "lost" };
    const errors = (state?.errors ?? 0) + 1;
    if (errors >= LOOP_ERRORS_MAX) {
      await this.failedForGood(cur, state, errors, err);
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
      const resumed = await this.resume(job, state, "budget");
      // A helper that goes on is something its lead, parked for the money of a part, wants to see.
      if (state.part?.parentId) await this.unparkLead(state.part.parentId);
      return stripAgent(resumed);
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

  // ------------------------------------------------------------ settings

  /** How the project's jobs are worked, as the person set it: guided with no plan-first until they say. The owner's only. */
  async settings(userId: string, projectId: string): Promise<{ mode: JobMode; planFirst: boolean; team: TeamMode }> {
    const project = await this.deps.projects.store.getProject(userId, projectId);
    if (!project) throw new ConnectorError("not_found", "No such project");
    const set = await this.deps.settings?.get(project.id);
    return { mode: set?.mode ?? DEFAULT_PROJECT_SETTINGS.mode, planFirst: set?.planFirst ?? DEFAULT_PROJECT_SETTINGS.planFirst, team: set?.team ?? DEFAULT_PROJECT_SETTINGS.team };
  }

  /** Changes what the person set (each field optional), and answers how the project's jobs are worked now. */
  async setSettings(userId: string, projectId: string, body: unknown): Promise<{ mode: JobMode; planFirst: boolean; team: TeamMode }> {
    const patch = readSettingsPatch(body);
    const cur = await this.settings(userId, projectId);
    if (!this.deps.settings) throw new ConnectorError("settings_off", "This server does not keep project settings.");
    const next = { mode: patch.mode ?? cur.mode, planFirst: patch.planFirst ?? cur.planFirst, team: patch.team ?? cur.team };
    await this.deps.settings.put({ projectId, userId, ...next, updatedAt: this.now() });
    return next;
  }

  // ------------------------------------------------------------ rewind

  /** The points a person can rewind a job to: each step of the model's work, oldest first, with a line on what it did and the files staged then. */
  async checkpoints(userId: string, jobId: string): Promise<Array<{ step: number; at: number; note: string; files: string[] }>> {
    const job = await this.jobs.job(userId, jobId);
    if (!job.agent) throw notWaiting("anything from Tailzu's agent");
    return (await this.deps.rewind?.list(job.id)) ?? [];
  }

  /**
   * REWIND a job to the state it stood in after a step (POST /v1/code/jobs/:id/rewind { toStep }). `toStep` 0 is before any work.
   *
   *   BEFORE THE COMMIT   the staged edits are put back as they stood after that step, what the model did since is dropped (it is given the notes it had then),
   *                       and the job goes on from there, working. The running loop is fenced off first (its claim's epoch moves), so it can write nothing more
   *   AFTER THE COMMIT    a NEW commit takes the files the job changed back to how they were at that step (revertFiles), through the policy like any commit,
   *                       and the job ends: history is never rewritten, nothing is reset, forced or rebased. The policy may ask for the person's yes first:
   *                       the answer says so, and the same call with that `approvalId` makes the commit
   *
   * The owner's only. A job that is over can be rewound only after its commit (a job that ended before one has nothing left to go on with).
   */
  async rewind(userId: string, jobId: string, toStep: unknown, approvalId?: string): Promise<
    | { kind: "restored"; step: number; job: CodeJob }
    | { kind: "reverted"; step: number; sha: string | null; files: string[]; job: CodeJob }
    | ({ kind: "needs_approval" } & Omit<NeedsApproval, "needsApproval">)
  > {
    if (typeof toStep !== "number" || !Number.isInteger(toStep) || toStep < 0 || toStep > 100_000) throw new ConnectorError("bad_request", "toStep is the number of a step: 0 for before any work.");
    const { job, state } = await this.mine(userId, jobId);
    if (state.team || state.part) throw new ConnectorError("cannot_rewind", "A job that leads a team, or is a helper's, cannot be rewound: its parts are on their own branches. Stop a part, or run it again, instead.");
    const rewinds = this.deps.rewind;
    if (!rewinds) throw new ConnectorError("rewind_off", "This job keeps no rewind points.");
    const point = toStep === 0 ? { step: 0, at: this.now(), note: "Before any work.", staged: [], summary: "", digests: [] } : await rewinds.get(job.id, toStep);
    if (!point) throw new ConnectorError("not_found", `There is no rewind point at step ${toStep}. GET /v1/code/jobs/:id/checkpoints lists them.`);
    const committed = state.commits.length > 0;
    if (!committed && isEnded(job.state)) throw new ConnectorError("job_over", "That job is over, and made no commit, so there is nothing to go back to.");
    // The loop that is running is fenced off: the epoch moves, so its next write is turned away. The abort ends it sooner when it is this server's.
    const fenced = await this.fence(job);
    const log = new WorkLog(job.id, { store: this.deps.worklog ?? worklogStore() });
    if (!committed) {
      const w = state.work;
      w.staged = structuredClone(point.staged);
      w.exchanges = [];
      w.digests = [...point.digests];
      w.summary = point.summary;
      w.turns = point.step;
      w.badTurns = 0;
      w.finished = false;
      w.doneSummary = undefined;
      w.feedback = undefined;
      w.designFeedback = undefined;
      w.nudged = false;
      state.verified = undefined;
      state.verify = undefined;
      state.commit = undefined;
      state.waiting = undefined;
      state.phase = "work";
      (state.rewinds ??= []).push({ to: point.step, at: this.now(), kind: "restored" });
      await rewinds.dropAfter(job.id, point.step);
      await log.decision(toStep === 0 ? "Went back to before any work, at your request." : `Went back to step ${point.step} (${point.note.slice(0, 120)}), at your request.`);
      const next = await this.store.casJob(job.id, { agentEpoch: fenced.agentEpoch }, {
        state: "running", waitingOn: null, reason: "", checkpoint: { ...fenced.checkpoint, agent: state as unknown as Record<string, unknown> },
      });
      if (!next) throw new ConnectorError("conflict", "The job changed while it was being rewound. Try again.");
      if (this.remote) await this.remote.wake(job.id, "wake");
      else this.kick();
      return { kind: "restored", step: point.step, job: stripAgent(next) };
    }
    // After the commit: a new commit that returns the files. The job's loop is over (fenced); the commit is the person's to approve if the policy asks.
    const d = this.deps.projects;
    const ws = await workspace(d, userId, job.projectId, job.branch);
    const repo = repoRef(d, userId, ws.project);
    const baseSha = state.baseSha;
    if (!baseSha) throw new ConnectorError("cannot_rewind", "This job's commit did not record where the branch stood before it, so it cannot be taken back.");
    const read = (ref: string) => async (path: string): Promise<string | null> => {
      try { return (await d.github.readFile(repo, ref, path)).text; } catch (err) {
        if ((err as { code?: string } | null)?.code === "not_found") return null;
        throw err;
      }
    };
    const paths = [...(state.committedPaths ?? []), ...point.staged.map((f) => f.path)];
    const files = await revertFiles({ paths, staged: point.staged, atBase: read(baseSha), atHead: async (p) => { try { return (await ws.read(p)).text; } catch (err) { if ((err as { code?: string } | null)?.code === "not_found") return null; throw err; } } });
    if (!files.length) {
      await this.endAfterRewind(job, fenced, state, point.step, null, "The branch already matches that step, so nothing was committed.");
      return { kind: "reverted", step: point.step, sha: null, files: [], job: stripAgent((await this.store.getJobById(job.id)) ?? job) };
    }
    const message = `Go back to step ${point.step} of Tailzu job ${job.id.slice(0, 8)}\n\nThis is a new commit that returns ${files.length} file${files.length === 1 ? "" : "s"} to how they were at that step, at the person's request. Nothing in the history was rewritten.`;
    const made = await ws.commit(files, message, approvalId ? { approvalId } : {});
    if (isNeedsApproval(made)) {
      // The loop stays fenced and the job as it is; the same call with this id makes the commit.
      const { needsApproval: _n, ...ask } = made;
      return { kind: "needs_approval", ...ask };
    }
    state.commits.push(made.sha);
    await log.decision(`Went back to step ${point.step} in a new commit, ${made.sha.slice(0, 7)}, at your request. ${files.length} file${files.length === 1 ? "" : "s"} returned; the history was not rewritten.`);
    await this.endAfterRewind(job, fenced, state, point.step, made.sha, `Rewound to step ${point.step} in commit ${made.sha.slice(0, 7)}.`);
    return { kind: "reverted", step: point.step, sha: made.sha, files: files.map((f) => f.path), job: stripAgent((await this.store.getJobById(job.id)) ?? job) };
  }

  /** The loop that holds the job is told to stop and its claim is fenced (the epoch goes up): whatever it was about to write is turned away. Returns the job as it is now. */
  private async fence(job: CodeJob): Promise<CodeJob> {
    this.active.get(job.id)?.abort.abort();
    for (let i = 0; i < 6; i += 1) {
      const cur = (await this.store.getJobById(job.id)) ?? job;
      const next = await this.store.casJob(job.id, { agentEpoch: cur.agentEpoch }, { agentHolder: null, agentExpiresAt: null, agentEpoch: cur.agentEpoch + 1 });
      if (next) return next;
    }
    throw new ConnectorError("conflict", "The job is changing too fast to be rewound just now. Try again in a moment.");
  }

  /** After a revert commit the job is over: its state keeps the rewind, and a job that was still going is ended with the reason. */
  private async endAfterRewind(job: CodeJob, fenced: CodeJob, state: AgentState, step: number, sha: string | null, why: string): Promise<void> {
    (state.rewinds ??= []).push({ to: step, at: this.now(), kind: "reverted", ...(sha ? { sha } : {}) });
    state.waiting = undefined;
    state.phase = "done";
    await this.store.casJob(job.id, { agentEpoch: fenced.agentEpoch }, { checkpoint: { ...fenced.checkpoint, agent: state as unknown as Record<string, unknown> } });
    if (!isEnded(fenced.state)) await this.jobs.cancelJob(job.id, why);
    await this.remote?.wake(job.id, "stop");
  }

  // ------------------------------------------------------ lead and helpers

  /** The other projects a request names, checked: each is the person's own, and none is the job's. At most REPOS_MAX. Throws `not_found` for one that is not theirs. */
  async teamProjects(userId: string, primaryId: string, raw: unknown): Promise<string[]> {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > REPOS_MAX || raw.some((x) => typeof x !== "string" || !x)) throw new ConnectorError("bad_request", `projects is a list of at most ${REPOS_MAX} of your projects' ids.`);
    const ids = [...new Set(raw as string[])].filter((id) => id !== primaryId);
    for (const id of ids) {
      if (!(await this.deps.projects.store.getProject(userId, id))) throw new ConnectorError("not_found", "No such project");
    }
    return ids;
  }

  /** A lead's team: its parts and where each stands, with what each has cost so far (read from the helpers' jobs now, not from the lead's last save). The owner's only. */
  async team(userId: string, jobId: string): Promise<{ job: { id: string; state: JobState; budgetPaise: number; spentPaise: number }; team: TeamView; children: Array<{ part: number; jobId: string; state: JobState; waitingOn: string | null; reason: string; spentPaise: number; budgetPaise: number }> }> {
    const { job, state } = await this.mine(userId, jobId);
    if (!state.team) throw new ConnectorError("not_found", "That job is not leading a team.");
    const children: Array<{ part: number; jobId: string; state: JobState; waitingOn: string | null; reason: string; spentPaise: number; budgetPaise: number }> = [];
    const parts = [];
    for (const p of state.team.parts) {
      let spent = 0;
      for (const id of p.jobIds) {
        const c = await this.store.getJobById(id);
        if (!c) continue;
        spent += c.spentPaise;
        children.push({ part: p.id, jobId: c.id, state: c.state, waitingOn: c.waitingOn, reason: c.reason, spentPaise: c.spentPaise, budgetPaise: c.budgetPaise });
      }
      parts.push({ ...p, spentPaise: p.jobIds.length ? spent : p.spentPaise });
    }
    return {
      job: { id: job.id, state: job.state, budgetPaise: job.budgetPaise, spentPaise: job.spentPaise },
      team: viewOfTeam({ ...state.team, parts }, job), children,
    };
  }

  /**
   * The person's word to a lead about one part: STOP it (its helper is stopped now, and the lead leaves it out), or run it again (RERUN: a part that failed, was stopped or ran
   * out of money; `addPaise` gives it more, and adds the same to the lead's budget). The lead is the only one that writes its state, so the word is left in its checkpoint
   * and the lead is woken to read it; a lead that is parked for the money of a part goes on. The owner's only.
   */
  async teamCommand(userId: string, jobId: string, body: unknown): Promise<{ queued: true; part: PartView; job: CodeJob }> {
    const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const op = b.op;
    const partId = b.part;
    if (op !== "stop" && op !== "rerun") throw new ConnectorError("bad_request", 'op is "stop" or "rerun".');
    if (typeof partId !== "number" || !Number.isInteger(partId) || partId < 1) throw new ConnectorError("bad_request", "part is the number of a part (1 or more).");
    const addPaise = b.addPaise;
    if (addPaise !== undefined && (typeof addPaise !== "number" || !Number.isInteger(addPaise) || addPaise < 1 || addPaise > PAISE_MAX)) throw new ConnectorError("bad_request", `addPaise is a whole number of paise, 1 to ${PAISE_MAX}.`);
    if (op === "stop" && addPaise !== undefined) throw new ConnectorError("bad_request", "addPaise is for running a part again.");
    let { job, state } = await this.mine(userId, jobId);
    if (!state.team) throw new ConnectorError("not_found", "That job is not leading a team.");
    if (isEnded(job.state)) throw new ConnectorError("job_over", "That job is over.");
    const part = state.team.parts.find((p) => p.id === partId);
    if (!part) throw new ConnectorError("not_found", `There is no part ${partId}.`);
    if (op === "stop" && ["merged", "failed", "stopped", "skipped"].includes(part.status)) throw new ConnectorError("part_over", `Part ${partId} is ${part.status}, so there is nothing to stop.`);
    if (op === "rerun" && !["failed", "stopped", "exhausted", "skipped"].includes(part.status)) throw new ConnectorError("part_not_over", `Part ${partId} is ${part.status}: only a part that failed, was stopped or ran out of money can be run again.`);

    const cmd: TeamCommand = { id: randomUUID(), op, part: partId, ...(typeof addPaise === "number" ? { addPaise } : {}), at: this.now() };
    // The helper of a part to be stopped is stopped now, not at the lead's next look.
    if (op === "stop" && part.jobId) {
      this.active.get(part.jobId)?.abort.abort();
      await this.jobs.cancelJob(part.jobId, "You stopped this part.").catch(() => undefined);
    }
    // More money: the lead's budget grows by it, and so does the helper's, if its job is parked for the money.
    if (typeof addPaise === "number") {
      await this.addBudgetQuietly(job.id, addPaise);
      if (part.status === "exhausted" && part.jobId) await this.addBudget(userId, part.jobId, addPaise).catch(() => undefined);
    }
    await this.leaveCommand(job.id, cmd);
    ({ job, state } = await this.mine(userId, jobId));
    // A lead parked for the money of a part goes on; any other is woken to read it.
    if (job.state === "waiting_for_you" && job.waitingOn === "budget" && state.waiting?.kind === "budget") {
      state.waiting = undefined;
      job = await this.resume(job, state, "budget");
    } else if (this.remote) await this.remote.wake(job.id, "wake");
    else if (this.deps.team) await this.deps.team.wake(job.id);
    return { queued: true, part: viewOfPart(part), job: stripAgent(job) };
  }

  /** Leaves a command in the lead's checkpoint, and checks it is still there after (the lead's own save writes the whole checkpoint, so a write can lose to it: it is made again). */
  private async leaveCommand(jobId: string, cmd: TeamCommand): Promise<void> {
    for (let i = 0; i < 6; i += 1) {
      const cur = await this.store.getJobById(jobId);
      if (!cur) return;
      const have = cur.checkpoint.teamCommands ?? [];
      if (!have.some((c) => c.id === cmd.id)) {
        await this.store.casJob(jobId, { agentEpoch: cur.agentEpoch }, { checkpoint: { ...cur.checkpoint, teamCommands: [...have, cmd].slice(-TEAM_COMMANDS_MAX) } });
      }
      const after = await this.store.getJobById(jobId);
      if (after?.checkpoint.teamCommands?.some((c) => c.id === cmd.id)) return;
    }
  }

  /** The job's budget goes up by `addPaise`, and nothing else happens. */
  private async addBudgetQuietly(jobId: string, addPaise: number): Promise<void> {
    for (let i = 0; i < 8; i += 1) {
      const cur = await this.store.getJobById(jobId);
      if (!cur) return;
      const budget = Math.min(PAISE_MAX, cur.budgetPaise + addPaise);
      if (await this.store.casJob(jobId, { budgetPaise: cur.budgetPaise }, { budgetPaise: budget })) return;
    }
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

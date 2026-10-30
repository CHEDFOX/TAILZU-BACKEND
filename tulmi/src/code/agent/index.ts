/**
 * THE CODE BOT'S AGENT LOOP, LAYER 8: THE WORKER THAT TIES LAYERS 1 TO 7 TOGETHER.
 * The story is in docs/code-agent.md. A person says what they want; the agent finds where it belongs, plans
 * it, does it with a model and tools, checks it against what the project was before, commits it through the
 * policy, opens the pull request and says what it did, spending the budget the person gave it and stopping
 * to ask whenever it has to.
 *
 *   types.ts         the phases, the state that is kept in the job's checkpoint, the numbers
 *   changeset.ts     the staged edits, and every refusal made before anything is staged
 *   checks.ts        the project's checks in one runner step, and reading what each said
 *   context.ts       what the model is shown each turn: compact, capped, data fenced
 *   tools.ts         read_file ... done: what each tool really does
 *   runner.ts        the runner port, and the environment router behind it
 *   report.ts        the commit message, the pull request and the final report
 *   run.ts           one run of the loop: the state, the claim it writes through, the ways it stops
 *   phases.ts        prepare ... report, each a function over a Run that can be entered again
 *   design.ts        the design round: run the app, shoot it, compare it to the approved design
 *   loop.ts          the driver, and the budget stop
 *   orchestrator.ts  the worker: claims, checkpoints, concurrency, the person's word
 *   ../team/         lead and helpers: a big goal split into parts, built in parallel by helpers, reviewed, merged and verified (docs/code-team.md)
 *
 * createAgent() wires it from the Code object and the job router. It exists only when Xode has a
 * GitHub client AND the project brain is on (the loop reads the brain for where a change belongs); a server
 * without it leaves a job to whatever drives the router directly, as before.
 */
import type { EffortMode } from "./effort.js";
import { getConfig } from "../../config.js";
import type { Code } from "../index.js";
import type { JobRouter } from "../jobs/router.js";
import { projectDepsOf } from "../jobs/index.js";
import { jobStore, type JobStore } from "../jobs/store.js";
import { brainOf, type AgentBrain, type AgentDeps, type DesignDeps, type TeamPorts } from "./deps.js";
import { MemoryInbox, type LiveDeps } from "../live/ports.js";
import type { ContextStrategy } from "./mask.js";
import { AgentOrchestrator, type RemoteJobs } from "./orchestrator.js";
import { rewindStore, type RewindStore } from "./rewind.js";
import { routerRunner, type AgentRunner } from "./runner.js";
import { settingsStore, type SettingsStore } from "./settings.js";
import type { JobMode } from "./types.js";

export * from "./changeset.js";
export * from "./checks.js";
export * from "./context.js";
export * from "./deps.js";
export * from "./design.js";
export * from "./loop.js";
export * from "./mask.js";
export * from "./orchestrator.js";
export * from "./phases.js";
export * from "./report.js";
export * from "./run.js";
export * from "./rewind.js";
export * from "./runner.js";
export * from "./settings.js";
export * from "./tools.js";
export * from "./types.js";
export * as team from "../team/index.js";

export interface CreateAgentOptions extends Partial<Pick<AgentDeps, "call" | "gateway" | "web" | "fetchFn" | "findResources" | "worklog" | "intake" | "routeStats" | "notify" | "now" | "sleep" | "log">> {
  /** Where rewind points and the projects' settings are kept; the process's own (Supabase, else memory) when not given. */
  rewind?: RewindStore;
  settings?: SettingsStore;
  code: Pick<Code, "store" | "github" | "approvals" | "oauth" | "brain">;
  jobs: JobRouter;
  store?: JobStore;
  /** The project brain behind the three things the loop asks of it; the Code object's own when not given. */
  brain?: AgentBrain;
  /** Where commands run: the environment router when not given. */
  runner?: AgentRunner;
  /** Instead of CODE_AGENT_CONCURRENCY. */
  concurrency?: number;
  instanceId?: string;
  /** How long a claim lasts, instead of two minutes. */
  leaseMs?: number;
  /** Jobs run on the Cloudflare Worker (CODE_JOBS_MODE=cloudflare): hand them over and claim none (orchestrator.ts). */
  remote?: RemoteJobs;
  /** Claims jobs only when told to (the Worker calls `advance`): no polling, no timers. */
  passive?: boolean;
  /**
   * The live session's ports (code/live/ports.ts): the job's copy of the code, the person's words mid-task, progress for the app. On a server that
   * drives its own jobs an inbox in memory is made if none is given, so POST /v1/code/jobs/:id/message works there too.
   */
  live?: LiveDeps;
  /** The design round's compare step and links (agent/design.ts). */
  design?: DesignDeps;
  /** Lead and helpers (code/team): how a helper's job is started and a lead woken, when this is not a server that drives its own jobs (the Worker starts a Workflow and sends an event). */
  team?: Partial<TeamPorts>;
  /** What becomes of old tool results: "mask", "summary", "hybrid" or "transcript" (agent/mask.ts). Instead of CODE_CONTEXT_STRATEGY, for a harness that compares them. */
  contextStrategy?: ContextStrategy;
  /** Ask once for a focused test of the change before the checks run: instead of CODE_PROVE_FIX (agent/phases.ts testWanted). */
  proveFix?: boolean;
  /** How a new job is worked when neither the job nor its project says: instead of CODE_JOB_MODE (free-form by default). */
  jobMode?: JobMode;
  /** How hard a free-form turn thinks: instead of CODE_EFFORT (agent/effort.ts). */
  effort?: EffortMode;
}

/** The worker, or null when this server cannot run one (no GitHub client, or the project brain is off). */
export function createAgent(o: CreateAgentOptions): AgentOrchestrator | null {
  const projects = projectDepsOf(o.code);
  const brain = o.brain ?? (o.code.brain ? brainOf(o.code.brain) : null);
  if (!projects || !brain) return null;
  const store = o.store ?? jobStore();
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deps: AgentDeps = {
    projects, jobs: o.jobs, store, brain, runner: o.runner ?? routerRunner({ jobs: o.jobs, store, now, sleep }), now, sleep,
    rewind: o.rewind ?? rewindStore(), settings: o.settings ?? settingsStore(),
    ...(o.call ? { call: o.call } : {}), ...(o.gateway ? { gateway: o.gateway } : {}), ...(o.web ? { web: o.web } : {}), ...(o.fetchFn ? { fetchFn: o.fetchFn } : {}),
    ...(o.findResources ? { findResources: o.findResources } : {}), ...(o.worklog ? { worklog: o.worklog } : {}), ...(o.intake ? { intake: o.intake } : {}),
    ...(o.routeStats ? { routeStats: o.routeStats } : {}), ...(o.notify ? { notify: o.notify } : {}), ...(o.log ? { log: o.log } : {}),
    ...(o.live ? { live: o.live } : o.passive || o.remote ? {} : { live: { inbox: new MemoryInbox() } }),
    ...(o.design ? { design: o.design } : {}),
    ...(o.contextStrategy ? { contextStrategy: o.contextStrategy } : {}),
    ...(o.proveFix !== undefined ? { proveFix: o.proveFix } : {}),
    ...(o.jobMode ? { jobMode: o.jobMode } : {}),
    ...(o.effort ? { effort: o.effort } : {}),
  };
  const orch = new AgentOrchestrator({
    jobs: o.jobs, store, deps, concurrency: o.concurrency ?? getConfig().CODE_AGENT_CONCURRENCY,
    ...(o.instanceId ? { instanceId: o.instanceId } : {}), ...(o.leaseMs ? { leaseMs: o.leaseMs } : {}),
    ...(o.remote ? { remote: o.remote } : {}), ...(o.passive ? { passive: true } : {}),
  });
  // Lead and helpers: on a server that drives its own jobs, starting a helper is looking for work, and waking a lead is making it claimable now.
  deps.team = {
    start: async () => { orch.kick(); },
    wake: (id) => orch.wakeLead(id),
    addBudget: async (userId, jobId, paise) => { await orch.addBudget(userId, jobId, paise); },
    ...(o.team ?? {}),
  };
  return orch;
}

/**
 * EVERYTHING THE AGENT LOOP IS GIVEN, SO THAT IT RUNS OFFLINE IN A TEST.
 *
 * The loop reaches four kinds of thing, and each is a seam:
 *
 *   the clock and the sleep   `now`, `sleep`: a test moves time by moving `now`
 *   the model                 `call` (callModel, or a script that answers with tool calls) and
 *                             `gateway` (callModel's own deps: its client, the job store)
 *   the network               `fetchFn` (the registries, OSV, GitHub for the library finder) and
 *                             `web` (the web tools' deps: their fetch, search sources, cache)
 *   the runner                `runner`: an AgentRunner (runner.ts), the environment router in
 *                             production and a script in a test
 *
 * and the stores it writes to (the jobs', the work log's, the intake's, the route statistics'), each
 * defaulting to the shared one. `brain` is the project brain (layer 4) behind the three things the
 * loop asks of it; the real one is `brainOf(code.brain)`.
 */
import type { FetchLike } from "../../connectors/egressTypes.js";
import type { GatewayDeps } from "../brain/gateway.js";
import type { RouteStatsStore } from "../brain/stats.js";
import type { JobRouter } from "../jobs/router.js";
import type { JobStore } from "../jobs/store.js";
import type { Notify } from "../jobs/types.js";
import type { ProjectBrain, BrainHandle } from "../project/index.js";
import { recordBaseline } from "../project/index.js";
import type { BaselineResult } from "../project/types.js";
import type { ProjectDeps } from "../projects.js";
import type { IntakeStore } from "../newproject/index.js";
import type { WebToolDeps } from "../webTools.js";
import type { CallFn } from "../work/model.js";
import type { WorklogStore } from "../work/index.js";
import type { findResources } from "../resources/finder.js";
import type { CompareHook } from "../../artifacts/build.js";
import type { LiveDeps } from "../live/ports.js";
import type { ContextStrategy } from "./mask.js";
import type { AgentRunner } from "./runner.js";
import type { RewindStore } from "./rewind.js";
import type { SettingsStore } from "./settings.js";

/** What the loop asks of the project brain. */
export interface AgentBrain {
  /** Brings the brain up to the default branch's head, waiting a little. Never needs to succeed. */
  ensureFresh(userId: string, projectId: string): Promise<unknown>;
  open(userId: string, projectId: string): Promise<BrainHandle>;
  /** Keeps what the checks said before the first edit, with the commit they were run at. */
  recordBaseline(projectId: string, headSha: string, results: readonly BaselineResult[]): Promise<unknown>;
}

/** The real brain, as the loop wants it. */
export function brainOf(brain: ProjectBrain): AgentBrain {
  return {
    ensureFresh: (userId, projectId) => brain.ensureFresh(userId, projectId),
    open: (userId, projectId) => brain.open(userId, projectId),
    recordBaseline: (projectId, headSha, results) => recordBaseline(projectId, headSha, results, { store: brain.store }),
  };
}

export interface AgentLog {
  info(o: object, m: string): void;
  warn(o: object, m: string): void;
}

/**
 * What the design round needs besides a preview (live.preview): the compare step that shoots the built page and the design and compares them
 * (artifacts/compare.ts), and a way to make the link to a kept shot for the report (a signed, 7-day link served to the owner only).
 */
export interface DesignDeps {
  compare: CompareHook;
  link?: (o: { userId: string; artifactId: string; shotId: string }) => string | null;
}

export interface AgentDeps {
  /** The Code bot's own pieces: projects, GitHub, the approvals. */
  projects: ProjectDeps;
  jobs: Pick<JobRouter, "finishJob" | "cancelJob"> & Partial<Pick<JobRouter, "clearCaptured">>;
  store: JobStore;
  brain: AgentBrain;
  runner: AgentRunner;
  /** The model door: callModel when absent. */
  call?: CallFn;
  gateway?: GatewayDeps;
  /** Instead of the web tools' own defaults: their fetch, search sources, cache, daily caps. */
  web?: Partial<WebToolDeps>;
  fetchFn?: FetchLike;
  findResources?: typeof findResources;
  worklog?: WorklogStore;
  /** The staged edits after each step, for the person to rewind to (rewind.ts). Absent: none are kept, and a rewind says so. */
  rewind?: RewindStore;
  /** How the project's jobs are worked, as the person set it (settings.ts). Absent: every job is guided, with no plan-first. */
  settings?: SettingsStore;
  intake?: IntakeStore;
  routeStats?: RouteStatsStore;
  /** How the person is told (the push engine in the server). */
  notify?: Notify;
  /** The live session (code/live): the job's copy of the code, the person's words mid-task, progress for the app. Absent: none of it. */
  live?: LiveDeps;
  /** The design round (agent/design.ts) for a job built from an approved design. Absent: the round is skipped, and the report says so. */
  design?: DesignDeps;
  /** What becomes of a tool result once it is older than the last six (agent/mask.ts): instead of CODE_CONTEXT_STRATEGY, for a harness that compares them. */
  contextStrategy?: ContextStrategy;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log?: AgentLog;
}

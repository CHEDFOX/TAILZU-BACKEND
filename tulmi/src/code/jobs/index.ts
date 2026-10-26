/**
 * THE JOB ROUTER, ASSEMBLED FROM THE CODE BOT'S OWN PIECES.
 *
 * createJobs() builds a JobRouter (router.ts) over the Code bot's store,
 * GitHub client and approvals (code/index.ts), the jobs' own store (store.ts),
 * and the settings:
 *
 *   CODE_GITHUB_FREE_MINUTES   GitHub's monthly free allowance in minutes, 2000
 *                              by default (a free plan); a tenth of it is kept back
 *
 * It exists only when the Code bot is on and the GitHub client is set up, since
 * a job runs in a person's repo. `notify` is how the person is told (the push
 * engine in the server; absent: nobody is). GitHub's free computers and paid
 * compute are not built yet, so a server passes neither provider and the router
 * never chooses them; tests pass fakes (tests/jobs-fakes.ts).
 *
 * Nothing here reaches the network or the clock unless it is asked to.
 */
import { getConfig } from "../../config.js";
import type { Code } from "../index.js";
import type { ProjectDeps } from "../projects.js";
import { DeviceBook } from "./devices.js";
import { GITHUB_FREE_MINUTES_DEFAULT } from "./placement.js";
import type { ComputeProvider } from "./providers.js";
import { JobRouter } from "./router.js";
import { jobStore, type JobStore } from "./store.js";
import type { Notify } from "./types.js";

export interface CreateJobsOptions {
  code: Pick<Code, "store" | "github" | "approvals" | "oauth">;
  store?: JobStore;
  github?: ComputeProvider | null;
  paid?: ComputeProvider | null;
  devices?: DeviceBook;
  notify?: Notify;
  now?: () => number;
  /** Instead of CODE_GITHUB_FREE_MINUTES. */
  freeMinutes?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** The router, or null when this server has no GitHub client to run jobs with. */
export function createJobs(o: CreateJobsOptions): JobRouter | null {
  if (!o.code.github) return null;
  const projects: ProjectDeps = { store: o.code.store, github: o.code.github, approvals: o.code.approvals, oauth: o.code.oauth };
  return new JobRouter({
    store: o.store ?? jobStore(), projects, github: o.github, paid: o.paid, devices: o.devices ?? new DeviceBook(),
    notify: o.notify, now: o.now, log: o.log,
    freeMinutes: o.freeMinutes ?? freeMinutesFromEnv(),
  });
}

/** CODE_GITHUB_FREE_MINUTES, or GitHub's own 2,000. */
export function freeMinutesFromEnv(): number {
  const n = getConfig().CODE_GITHUB_FREE_MINUTES;
  return Number.isFinite(n) && n >= 0 ? n : GITHUB_FREE_MINUTES_DEFAULT;
}

export { JobRouter } from "./router.js";
export { choosePlacement, githubMinutesLeft } from "./placement.js";
export { DeviceBook } from "./devices.js";
export { startJobTicker } from "./ticker.js";

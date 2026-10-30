/**
 * THE JOB ROUTER, ASSEMBLED FROM THE CODE BOT'S OWN PIECES.
 *
 * createJobs() builds a JobRouter (router.ts) over Xode's store,
 * GitHub client and approvals (code/index.ts), the jobs' own store (store.ts),
 * and the settings:
 *
 *   CODE_GITHUB_FREE_MINUTES   GitHub's monthly free allowance in minutes, 2000
 *                              by default (a free plan); a tenth of it is kept back
 *   CODE_RUNNER_OIDC_AUDIENCE  the audience of the identity token a step on
 *                              GitHub's computers reports with, "tailzu" by default
 *
 * It exists only when Xode is on and the GitHub client is set up, since
 * a job runs in a person's repo. `notify` is how the person is told (the push
 * engine in the server; absent: nobody is). createGithubActions() builds the
 * real provider for GitHub's free computers (githubActions.ts), which a server
 * passes to createJobs and to the routes (the result endpoint is the
 * provider's); paid compute is not built yet, so a server passes none and the
 * router never chooses it; tests pass fakes (tests/jobs-fakes.ts).
 *
 * Nothing here reaches the network or the clock unless it is asked to.
 */
import { getConfig } from "../../config.js";
import type { Code } from "../index.js";
import type { ProjectDeps } from "../projects.js";
import type { OfferSession } from "../live/offers.js";
import { DeviceBook } from "./devices.js";
import { GITHUB_FREE_MINUTES_DEFAULT } from "./placement.js";
import type { ComputeProvider } from "./providers.js";
import type { JWTVerifyGetKey } from "jose";
import { GithubActionsProvider, OIDC_AUDIENCE_DEFAULT } from "./githubActions.js";
import { JobRouter } from "./router.js";
import { jobStore, type JobStore } from "./store.js";
import type { Notify } from "./types.js";

export interface CreateJobsOptions {
  code: Pick<Code, "store" | "github" | "approvals" | "oauth">;
  store?: JobStore;
  github?: ComputeProvider | null;
  paid?: ComputeProvider | null;
  devices?: DeviceBook;
  /** The person's PCs as a place, when presence is not in this process (the Worker: a Durable Object per person). */
  desktop?: ComputeProvider;
  /**
   * Count the month's GitHub Actions minutes against CODE_ACTIONS_MONTHLY_MIN (tell the person at 80%, stop choosing GitHub at 95%): the live
   * session's rule (code/live/minutes.ts). Absent: the older rule, a tenth of CODE_GITHUB_FREE_MINUTES kept back.
   */
  actions?: boolean | { monthlyMin: number };
  /** The way into a job's room, handed to a runner with a live session step. */
  offerSession?: OfferSession;
  notify?: Notify;
  now?: () => number;
  /** Instead of CODE_GITHUB_FREE_MINUTES. */
  freeMinutes?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** Xode's own pieces, as the project functions take them. Null when there is no GitHub client. */
export function projectDepsOf(code: Pick<Code, "store" | "github" | "approvals" | "oauth">): ProjectDeps | null {
  return code.github ? { store: code.store, github: code.github, approvals: code.approvals, oauth: code.oauth } : null;
}

export interface CreateGithubActionsOptions {
  code: Pick<Code, "store" | "github" | "approvals" | "oauth">;
  /** The jobs' store: the same one the router is given. Default: the shared one. */
  store?: JobStore;
  /** Instead of CODE_RUNNER_OIDC_AUDIENCE. */
  audience?: string;
  /** Where the script reports. Default: PUBLIC_ORIGIN (api.x0bot.com) and /v1/code/runner/gh-result. */
  resultUrl?: string;
  /** The way into a job's room for a live session step: written into the step's `.tailzu/step.json`. */
  offerSession?: OfferSession;
  /** Finds the key an identity token was signed with. Default: GitHub's own JWKS. */
  keys?: JWTVerifyGetKey;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** Where a step on GitHub reports, on this server. */
export function runnerResultUrl(): string {
  return `${(process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").replace(/\/+$/, "")}/v1/code/runner/gh-result`;
}

/**
 * GitHub's free computers as a place for the router, when the App or the
 * sign-in is set up (there is a GitHub client); null otherwise. Whether a
 * person's projects can use it (the App's Workflows and Actions permissions, or
 * the sign-in's `workflow` scope), and whether they have switched it off
 * (`github_enabled`), is decided per project and per person at placement time.
 */
export function createGithubActions(o: CreateGithubActionsOptions): GithubActionsProvider | null {
  const d = projectDepsOf(o.code);
  if (!d) return null;
  return new GithubActionsProvider({
    d, jobs: o.store ?? jobStore(), audience: o.audience ?? getConfig().CODE_RUNNER_OIDC_AUDIENCE ?? OIDC_AUDIENCE_DEFAULT,
    resultUrl: o.resultUrl ?? runnerResultUrl(), keys: o.keys, now: o.now, log: o.log, ...(o.offerSession ? { offerSession: o.offerSession } : {}),
  });
}

/** The router, or null when this server has no GitHub client to run jobs with. */
export function createJobs(o: CreateJobsOptions): JobRouter | null {
  const projects = projectDepsOf(o.code);
  if (!projects) return null;
  return new JobRouter({
    store: o.store ?? jobStore(), projects, github: o.github, paid: o.paid, devices: o.devices ?? new DeviceBook(),
    notify: o.notify, now: o.now, log: o.log,
    freeMinutes: o.freeMinutes ?? freeMinutesFromEnv(),
    ...(o.desktop ? { desktop: o.desktop } : {}), ...(o.offerSession ? { offerSession: o.offerSession } : {}),
    ...(o.actions ? { actions: typeof o.actions === "object" ? o.actions : { monthlyMin: getConfig().CODE_ACTIONS_MONTHLY_MIN } } : {}),
  });
}

/** CODE_GITHUB_FREE_MINUTES, or GitHub's own 2,000. */
export function freeMinutesFromEnv(): number {
  const n = getConfig().CODE_GITHUB_FREE_MINUTES;
  return Number.isFinite(n) && n >= 0 ? n : GITHUB_FREE_MINUTES_DEFAULT;
}

export { JobRouter } from "./router.js";
export { GithubActionsProvider } from "./githubActions.js";
export { choosePlacement, githubMinutesLeft } from "./placement.js";
export { DeviceBook } from "./devices.js";
export { startJobTicker } from "./ticker.js";

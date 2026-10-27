/**
 * PR CARE: LOOKING AFTER A PULL REQUEST AFTER IT IS OPENED (red CI, a reviewer's ask, a conflict). The story is in docs/pr-care.md.
 *
 *   types.ts    what is kept about a pull request, and the numbers that bound the work
 *   store.ts    the rows (migration 0034, code_pr_care), Supabase or memory
 *   ci.ts       is the red CI this pull request's to fix?
 *   review.ts   a reviewer's comment, read: small, large, a question, or none of those
 *   status.ts   the one "Tailzu status" comment, edited in place
 *   engine.ts   the events in, the jobs out
 *
 * `createPrCare` is the server's way in (server.ts); the webhook hands it GitHub's events (code/webhook.ts hooks.care), the router's notifications tell it when a
 * job ended (onJobEvent), and a timer calls `sweep`.
 */
import type { Code } from "../index.js";
import type { AgentOrchestrator } from "../agent/orchestrator.js";
import type { JobRouter } from "../jobs/router.js";
import { jobStore as sharedJobStore } from "../jobs/store.js";
import { projectDepsOf } from "../jobs/index.js";
import { PrCare, type CareDeps } from "./engine.js";
import { SWEEP_EVERY_MS } from "./types.js";

export * from "./ci.js";
export * from "./engine.js";
export * from "./review.js";
export * from "./status.js";
export * from "./store.js";
export * from "./types.js";

export interface CreatePrCareOptions extends Partial<Pick<CareDeps, "store" | "call" | "gateway" | "worklog" | "notify" | "now" | "log" | "budgetPaise" | "readPaise" | "jobStore">> {
  code: Pick<Code, "store" | "github" | "approvals" | "oauth">;
  jobs: JobRouter;
  agent: Pick<AgentOrchestrator, "enqueue">;
}

/** PR care, or null when this server has no GitHub client to look after pull requests with. */
export function createPrCare(o: CreatePrCareOptions): PrCare | null {
  const projects = projectDepsOf(o.code);
  if (!projects) return null;
  return new PrCare({
    projects, jobs: o.jobs, jobStore: o.jobStore ?? sharedJobStore(), agent: o.agent,
    ...(o.store ? { store: o.store } : {}), ...(o.call ? { call: o.call } : {}), ...(o.gateway ? { gateway: o.gateway } : {}), ...(o.worklog ? { worklog: o.worklog } : {}),
    ...(o.notify ? { notify: o.notify } : {}), ...(o.now ? { now: o.now } : {}), ...(o.log ? { log: o.log } : {}),
    ...(o.budgetPaise !== undefined ? { budgetPaise: o.budgetPaise } : {}), ...(o.readPaise !== undefined ? { readPaise: o.readPaise } : {}),
  });
}

/** Starts the sweep (every two minutes). Returns the function that stops it. */
export function startCareSweep(care: PrCare, o: { everyMs?: number; log?: { warn(o: object, m: string): void } } = {}): () => void {
  const t = setInterval(() => { void care.sweep().catch((err) => o.log?.warn({ error: (err as Error)?.name }, "pr care: a sweep failed")); }, o.everyMs ?? SWEEP_EVERY_MS);
  t.unref?.();
  return () => clearInterval(t);
}

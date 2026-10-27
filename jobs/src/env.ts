/**
 * THE WORKER'S ENVIRONMENT: ITS BINDINGS, ITS SETTINGS, AND HOW THE SHARED CODE READS THEM.
 *
 * The code in ../tulmi/src reads its settings from process.env (config.ts getConfig). A Worker keeps its
 * settings in `env` (wrangler.jsonc vars, and secrets). With nodejs_compat and a compatibility date from
 * 2025-04-01, process.env is filled from those text bindings by the runtime
 * (developers.cloudflare.com/workers/configuration/compatibility-flags/, "populate process.env"), but the shared
 * code must not depend on that having happened before its first read, so `applyEnv` copies them in itself, on
 * every entry, and says RUNTIME=worker (config.ts then does not ask a Worker for what only the VPS needs).
 */
import type { Advance } from "../../tulmi/src/code/agent/loop.js";
import type { BrainBody } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import type { NonceGuard } from "./nonceGuard.js";

export interface AgentJobParams {
  jobId: string;
}

export interface Env {
  AGENT_JOB: Workflow<AgentJobParams>;
  BUILD_BRAIN: Workflow<BrainBody>;
  NONCES: DurableObjectNamespace<NonceGuard>;

  // wrangler.jsonc vars
  RUNTIME?: string;
  PUBLIC_ORIGIN?: string;
  /** Rounds of the work phase in one advance (a model turn and its tool calls). Default 2. */
  ADVANCE_TURNS?: string;
  /** How long a job waits for the person before it is ended with a report: "7 days". */
  PERSON_WAIT?: string;

  // secrets (and the rest of the settings the shared code reads: see wrangler.jsonc)
  CODE_JOBS_SECRET?: string;
  [setting: string]: unknown;
}

/** What one advance came to, as a Workflow step returns it: small, plain data. */
export type StepAdvance = Advance;

/** Copies every text binding into process.env (the shared code's settings), and marks the process as the Worker. */
export function applyEnv(env: Env): void {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && process.env[k] !== v) process.env[k] = v;
  }
  process.env.RUNTIME = "worker";
}

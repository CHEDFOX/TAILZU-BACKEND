/**
 * EVERYTHING THE WORKFLOWS AND THE CRON REACH FOR, IN ONE PLACE THAT A TEST CAN REPLACE.
 *
 * The Workflows (agentJob.ts, buildBrain.ts) and the cron (cron.ts) are thin: what they do for a job is ask a PORT:
 *
 *   AgentPort    advance a job one step (tulmi's AgentOrchestrator.advance), or end it with a report
 *   BrainPort    check whether a brain build is still wanted, and run it
 *   TickPort     the router's ticker (leases, steps out on GitHub, jobs waiting for a place), the agent's hand-back of claims
 *                that ran out, and the jobs nobody is driving
 *
 * `buildWorld` makes the real ones from the shared code in ../tulmi/src, over Supabase, GitHub and the model. The tests
 * `setWorld` fakes of the three, so a Workflow's own logic (its steps, its waits, its retries) runs for real in Miniflare while
 * the loop, the database, GitHub and the model are scripted.
 */
import { createAgent } from "../../tulmi/src/code/agent/index.js";
import type { Advance } from "../../tulmi/src/code/agent/loop.js";
import { createCode } from "../../tulmi/src/code/index.js";
import { createGithubActions, createJobs } from "../../tulmi/src/code/jobs/index.js";
import { jobStore } from "../../tulmi/src/code/jobs/store.js";
import type { BrainBody } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import type { Notify } from "../../tulmi/src/code/jobs/types.js";
import { getConfig } from "../../tulmi/src/config.js";
import { installSafeFetch } from "../../tulmi/src/web/safeFetch.js";
import { workerSafeFetchImpl } from "../../tulmi/src/web/workerSafeFetch.js";
import { cloudflareRendererFromConfig } from "../../tulmi/src/web/browser/cloudflare.js";
import { applyEnv, type Env } from "./env.js";
import { workerNotify } from "./notify.js";
import { bindingBrainRemote } from "./workflows.js";

/** A claim on a job lasts this long on the Worker: an advance saves and renews all along, but nothing beats it with a heartbeat as a server's does. */
export const WORKER_LEASE_MS = 5 * 60_000;

export interface AgentPort {
  advance(jobId: string, o: { holder: string; turns?: number }): Promise<Advance>;
  /** Ends a job nobody came back to, with a report that says so. */
  abandon(jobId: string, why: string): Promise<void>;
}

export interface BrainPort {
  /** Whether the build is still wanted. */
  check(b: BrainBody): Promise<{ skip: boolean; reason: string }>;
  /** The build, here, to its end. */
  build(b: BrainBody): Promise<{ status: string; headSha: string; spentPaise: number }>;
}

export interface TickSummary { expired: number; moved: number; failed: number; woken: number; handedBack: number }

export interface TickPort {
  tick(): Promise<TickSummary>;
  /** Ids of agent jobs nobody is driving that have not changed for `idleMs`: their Workflow may be gone, or not have been told. */
  idle(idleMs: number, limit: number): Promise<string[]>;
}

export interface World {
  agent: AgentPort;
  brain: BrainPort;
  ticker: TickPort;
}

const log = {
  info: (o: object, m: string) => console.log(m, JSON.stringify(o)),
  warn: (o: object, m: string) => console.warn(m, JSON.stringify(o)),
};

/** The real thing, from the Worker's settings. Throws (with a plain reason, never a value) if GitHub or Supabase are not set up. */
export async function buildWorld(env: Env, o: { notify?: Notify; /** Tests: stores in memory when Supabase is not set. */ memoryStores?: boolean } = {}): Promise<World> {
  applyEnv(env);
  // The Worker's guard for every page and registry it reads, in place of the VPS's (undici, node:dns): see tulmi/src/web/workerSafeFetch.ts.
  installSafeFetch(workerSafeFetchImpl);
  const cfg = getConfig();
  if (!cfg.supabaseEnabled && !o.memoryStores) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set on the Worker.");
  const notify = o.notify ?? workerNotify(env, { log });
  const code = createCode({ brain: { remote: bindingBrainRemote(env), log } });
  if (!code.github) throw new Error("GitHub is not set up on the Worker (GITHUB_APP_* secrets).");
  if (!code.brain) throw new Error("CODE_PROJECT_BRAIN is not on for the Worker.");
  const githubActions = createGithubActions({ code, log });
  const jobs = createJobs({ code, github: githubActions, notify, log });
  if (!jobs) throw new Error("The job router could not be made.");
  const render = cloudflareRendererFromConfig();
  const orchestrator = createAgent({
    code, jobs, notify, log, passive: true, leaseMs: WORKER_LEASE_MS, ...(render ? { web: { render } } : {}),
  });
  if (!orchestrator) throw new Error("The agent could not be made.");
  const brain = code.brain;
  const store = brain.runtime.store;

  return {
    agent: {
      advance: (jobId, a) => orchestrator.advance(jobId, a),
      abandon: (jobId, why) => orchestrator.abandon(jobId, why),
    },
    brain: {
      async check(b) {
        const row = await store.getBrain(b.projectId);
        if (b.mode === "incremental" && row?.status === "ready" && row.headSha === b.headSha) return { skip: true, reason: "The brain is already built from this commit." };
        return { skip: false, reason: "" };
      },
      async build(b) {
        const view = await brain.buildHere(b.userId, b.projectId, { mode: b.mode });
        return { status: view.status, headSha: view.headSha, spentPaise: view.spentPaise };
      },
    },
    ticker: {
      async tick() {
        const router = await jobs.tick();
        const agent = await orchestrator.tick();
        return { ...router, handedBack: agent.handedBack };
      },
      async idle(idleMs, limit) {
        const now = Date.now();
        const free = await jobStore().listClaimable(now, limit * 4);
        return free.filter((j) => now - j.updatedAt >= idleMs).slice(0, limit).map((j) => j.id);
      },
    },
  };
}

// ----------------------------------------------------------------- the seam

let world: Promise<World> | null = null;
let installed: World | null = null;

/** The world for this isolate: made once from `env`, unless a test put one in place. */
export function getWorld(env: Env): Promise<World> {
  if (installed) return Promise.resolve(installed);
  // A failed start is not kept: the next call tries again (a secret set a moment ago, a deploy that finished).
  return (world ??= buildWorld(env).catch((err) => { world = null; throw err; }));
}

/** For tests: use this world (or the real one again, with null). */
export function setWorldForTests(w: World | null): void {
  installed = w;
  world = null;
}

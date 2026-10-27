/**
 * THE LOAD TEST: 50 JOBS AT ONCE ON ONE SERVER, A MODEL THAT TAKES ITS TIME AND SOMETIMES FAILS, FOR NOTHING.
 *
 * The real thing end to end (front door excepted): 50 projects, 50 agent jobs started together on one orchestrator, the real JobRouter with leases and epochs, the
 * real gateway with its ladder, retries, JSON repair and circuit breakers, the real policy and pull requests on LocalGitHub, and a runner that answers from a
 * script (no checkout, no process). The model is a scripted one behind an OpenAI-shaped client that adds a delay to every call (scaled down, so a minute of
 * waiting is a second) and injects rate limits (429), server errors (503) and calls that hang until the gateway's timeout. Nothing reaches a network.
 *
 * What it proves is invariants, not speed: every job ends; none is lost or run twice; no job spends past its budget; each work branch has exactly the commits it
 * should and the default branch never moves; the breakers and ladder absorbed the faults; memory does not grow without bound. `npm run e2e:load`.
 */
import "./env.js";
import path from "node:path";
import type { ChatClient } from "../src/code/brain/gateway.js";
import { buildTierTable } from "../src/code/brain/tiers.js";
import { isEnded } from "../src/code/jobs/types.js";
import { scriptedWire } from "./adapters/models.js";
import { createRig, USER, type Rig } from "./adapters/rig.js";
import { oracle } from "./adapters/personas.js";
import { quantile } from "./bakeoff/stats.js";
import { seeded, sleep, writeJson, mkdirp, OUT_DIR } from "./util.js";
import type { Task } from "./tasks/schema.js";

export interface LoadOptions {
  jobs: number;
  /** Per-call delay in ms, uniform between the two (scaled: real models take seconds). */
  latencyMs: [number, number];
  /** Probabilities per call. */
  faults: { rateLimit: number; serverError: number; hang: number };
  /** The gateway's timeout for one call, ms (a hang lasts a little longer than this). */
  timeoutMs: number;
  /** Seconds the whole test may take. */
  timeoutSec: number;
  seed: number;
  log: (s: string) => void;
}

export const DEFAULT_LOAD: LoadOptions = { jobs: 50, latencyMs: [60, 300], faults: { rateLimit: 0.04, serverError: 0.03, hang: 0.005 }, timeoutMs: 700, timeoutSec: 240, seed: 7, log: () => undefined };

export interface Invariant { name: string; ok: boolean; detail: string }

export interface LoadResult {
  options: LoadOptions;
  jobs: number;
  done: number;
  failed: number;
  cancelled: number;
  unfinished: number;
  wallMs: number;
  jobMs: { p50: number; p95: number; max: number };
  modelCalls: number;
  failedModelCalls: number;
  injected: { rateLimit: number; serverError: number; hang: number };
  ladderFallbacks: number;
  jsonRepairs: number;
  peakConcurrentCalls: number;
  heapMB: { start: number; end: number };
  invariants: Invariant[];
  ok: boolean;
}

/** The task every project is given: a tiny Node project and a small known-correct patch (the oracle applies it). */
export function loadTask(): Task {
  const files = {
    "package.json": JSON.stringify({ name: "load-project", version: "1.0.0", scripts: { test: "node --test" } }, null, 2) + "\n",
    "README.md": "# load project\n",
    "src/greet.js": "function greet(name) {\n  return 'Hello, ' + name\n}\n\nmodule.exports = { greet }\n",
    "test/greet.test.js": "const { test } = require('node:test')\nconst assert = require('node:assert')\nconst { greet } = require('../src/greet')\n\ntest('greets', () => {\n  assert.strictEqual(greet('Ada'), 'Hello, Ada')\n})\n",
  };
  return {
    id: "load-greet-exclaim", title: "Add an exclamation mark to greet", category: "feature", repo: "synthetic", base: { files }, difficulty: 1, tags: ["load"],
    request: "Make greet in src/greet.js end with an exclamation mark, so greet('Ada') is 'Hello, Ada!'.",
    truth: { files: ["src/greet.js"] },
    oracle: {
      kind: "patch", classify: { type: "small_edit" }, plan: "Add the exclamation mark in greet",
      files: { "src/greet.js": "function greet(name) {\n  return 'Hello, ' + name + '!'\n}\n\nmodule.exports = { greet }\n" },
    },
    checks: { suite: false, expectPr: true },
  } as Task;
}

/** A client that delays every call and fails some of them, in front of a scripted model. */
export function faultyClient(inner: ChatClient, o: Pick<LoadOptions, "latencyMs" | "faults" | "timeoutMs" | "seed">): { client: ChatClient; injected: LoadResult["injected"]; peak: () => number; calls: () => number } {
  const rnd = seeded(o.seed);
  const injected = { rateLimit: 0, serverError: 0, hang: 0 };
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const client: ChatClient = {
    chat: {
      completions: {
        async create(body, opts) {
          calls += 1;
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          try {
            await sleep(o.latencyMs[0] + rnd() * (o.latencyMs[1] - o.latencyMs[0]));
            const r = rnd();
            if (r < o.faults.rateLimit) { injected.rateLimit += 1; throw Object.assign(new Error("rate limited"), { status: 429, headers: { "retry-after": "0" } }); }
            if (r < o.faults.rateLimit + o.faults.serverError) { injected.serverError += 1; throw Object.assign(new Error("upstream error"), { status: 503 }); }
            if (r < o.faults.rateLimit + o.faults.serverError + o.faults.hang) { injected.hang += 1; await sleep(o.timeoutMs + 400); throw Object.assign(new Error("timed out"), { status: 504 }); }
            return await inner.chat.completions.create(body, opts);
          } finally { inFlight -= 1; }
        },
      },
    },
  };
  return { client, injected, peak: () => peak, calls: () => calls };
}

/** Whatever the job is waiting for, the person says yes to. */
async function answerWaiting(rig: Rig, jobId: string): Promise<void> {
  const j = await rig.jobNow(jobId);
  try {
    if (j.state !== "waiting_for_you") return;
    if (j.waitingOn === "approval") { const a = await rig.orch.approve(USER, jobId); if ("needsApproval" in a) await rig.orch.approve(USER, jobId, a.approvalId); }
    else if (j.waitingOn === "commit") { const a = await rig.jobs.approveCommit(USER, jobId); if ("needsApproval" in a && a.needsApproval) await rig.jobs.approveCommit(USER, jobId, (a as { approvalId: string }).approvalId); }
    else if (j.waitingOn === "paid") await rig.jobs.approvePaid(USER, jobId);
    else if (j.waitingOn === "budget") await rig.orch.stopJob(USER, jobId);
  } catch { /* the next pass tries again */ }
}

export async function runLoad(opts: Partial<LoadOptions> = {}): Promise<LoadResult> {
  const o: LoadOptions = { ...DEFAULT_LOAD, ...opts, faults: { ...DEFAULT_LOAD.faults, ...(opts.faults ?? {}) } };
  const task = loadTask();
  const sw = scriptedWire({ persona: oracle });
  const faulty = faultyClient(sw.client, o);
  const heapStart = process.memoryUsage().heapUsed / 1e6;
  // Two models on every tier and a short timeout: a failed or hung call climbs to the second.
  const tiers = buildTierTable({ tiers: JSON.stringify(Object.fromEntries(["tiny", "cheap", "code", "strong", "review", "vision"].map((t) => [t, { models: ["load/model-a", "load/model-b"], timeoutMs: o.timeoutMs }]))) });
  const rig = await createRig({ mode: "real", client: faulty.client, tiers, concurrency: o.jobs, runnerParallel: o.jobs, stub: { latencyMs: 15 }, githubLatencyMs: 4, brainBudgetPaise: 0, pollMs: 50, room: false, log: (s) => o.log(s) });
  rig.kit.persona = sw.brain.persona;
  try {
    // 50 projects, one job each.
    const handles = [];
    for (let i = 0; i < o.jobs; i += 1) handles.push(await rig.addProjectFor(task, `load-${String(i).padStart(2, "0")}`));
    sw.brain.bind(task, handles[0]!.baseTexts);
    const t0 = Date.now();
    const started: Array<{ jobId: string; branch: string; h: (typeof handles)[number]; t0: number }> = [];
    for (const h of handles) {
      const { job, branch } = await rig.start(h, task.request, { budgetPaise: 3000 });
      started.push({ jobId: job.id, branch, h, t0: Date.now() });
    }
    o.log(`${started.length} jobs started`);
    const endedAt = new Map<string, number>();
    let peakRunning = 0;
    const deadline = Date.now() + o.timeoutSec * 1000;
    while (endedAt.size < started.length && Date.now() < deadline) {
      await Promise.all(started.map(async (s) => {
        if (endedAt.has(s.jobId)) return;
        const j = await rig.jobNow(s.jobId);
        if (isEnded(j.state)) endedAt.set(s.jobId, Date.now() - s.t0);
        else await answerWaiting(rig, s.jobId);
        return j.state;
      }).map(async (p) => p)).then((states) => { peakRunning = Math.max(peakRunning, states.filter((x) => x === "running").length); });
      await sleep(80);
    }
    const wallMs = Date.now() - t0;
    await rig.orch.idle().catch(() => undefined);

    // What happened to each job and each branch.
    const finals = await Promise.all(started.map(async (s) => ({ s, job: await rig.jobNow(s.jobId) })));
    const done = finals.filter((f) => f.job.state === "done").length;
    const failed = finals.filter((f) => f.job.state === "failed").length;
    const cancelled = finals.filter((f) => f.job.state === "cancelled").length;
    const unfinished = finals.length - done - failed - cancelled;
    const inv: Invariant[] = [];
    inv.push({ name: "every job ended", ok: unfinished === 0, detail: `${done} done, ${failed} failed, ${cancelled} cancelled, ${unfinished} unfinished of ${finals.length}` });
    const overBudget = finals.filter((f) => f.job.spentPaise > f.job.budgetPaise);
    inv.push({ name: "no job spent past its budget", ok: overBudget.length === 0, detail: overBudget.length ? `${overBudget.length} did, e.g. ${overBudget[0]!.job.spentPaise} of ${overBudget[0]!.job.budgetPaise}` : `the most spent was ${Math.max(0, ...finals.map((f) => f.job.spentPaise))} of 3000 paise` });
    let duplicate = 0, defaultMoved = 0, missingPr = 0, wrongFiles = 0;
    for (const { s, job } of finals) {
      const repo = s.h.repo;
      const head = await repo.head(s.branch);
      const commits = head ? await repo.log(`${s.h.baseSha}..${head}`, 20) : [];
      if (commits.length > 1) duplicate += 1;
      if ((await repo.head(repo.defaultBranch)) !== s.h.baseSha) defaultMoved += 1;
      if (job.state === "done") {
        if (!repo.pullFor(s.branch)) missingPr += 1;
        const changed = head ? await repo.changedFiles(s.h.baseSha, head) : [];
        if (changed.length !== 1 || changed[0]!.path !== "src/greet.js") wrongFiles += 1;
      }
    }
    inv.push({ name: "no job committed twice", ok: duplicate === 0, detail: duplicate ? `${duplicate} branch(es) have more than one commit` : "each work branch has at most one commit" });
    inv.push({ name: "the default branch never moved", ok: defaultMoved === 0, detail: defaultMoved ? `${defaultMoved} moved` : "all 50 are where they started" });
    inv.push({ name: "every finished job has its pull request and only the right file", ok: missingPr === 0 && wrongFiles === 0, detail: `${missingPr} without a pull request, ${wrongFiles} with the wrong files` });
    const logs = rig.kit.logs;
    const failedCalls = logs.filter((l) => !l.ok).length;
    inv.push({ name: "the faults were absorbed", ok: done >= Math.floor(o.jobs * 0.9), detail: `${faulty.injected.rateLimit} rate limits, ${faulty.injected.serverError} server errors and ${faulty.injected.hang} hangs injected over ${faulty.calls()} calls; ${done} of ${finals.length} jobs still finished` });
    inv.push({ name: "jobs ran in parallel", ok: peakRunning >= Math.min(10, o.jobs), detail: `up to ${peakRunning} jobs running at once, ${faulty.peak()} model calls in flight at once` });
    global.gc?.();
    const heapEnd = process.memoryUsage().heapUsed / 1e6;
    inv.push({ name: "memory stayed bounded", ok: heapEnd - heapStart < 700, detail: `heap ${heapStart.toFixed(0)} MB to ${heapEnd.toFixed(0)} MB` });
    const jobMs = [...endedAt.values()];
    const result: LoadResult = {
      options: o, jobs: finals.length, done, failed, cancelled, unfinished, wallMs, jobMs: { p50: quantile(jobMs, 0.5), p95: quantile(jobMs, 0.95), max: Math.max(0, ...jobMs) },
      modelCalls: logs.length, failedModelCalls: failedCalls, injected: faulty.injected, ladderFallbacks: logs.reduce((n, l) => n + l.fallbacks, 0), jsonRepairs: logs.reduce((n, l) => n + l.repaired, 0),
      peakConcurrentCalls: faulty.peak(), heapMB: { start: heapStart, end: heapEnd }, invariants: inv, ok: inv.every((x) => x.ok),
    };
    return result;
  } finally { await rig.dispose(); }
}

export function renderLoad(r: LoadResult): string {
  const L = [`LOAD ${r.jobs} jobs at once: ${r.done} done, ${r.failed} failed, ${r.cancelled} cancelled, ${r.unfinished} unfinished   wall ${(r.wallMs / 1000).toFixed(1)}s, per job p50 ${(r.jobMs.p50 / 1000).toFixed(1)}s p95 ${(r.jobMs.p95 / 1000).toFixed(1)}s`];
  L.push(`model calls ${r.modelCalls} (${r.failedModelCalls} failed after the ladder), ${r.ladderFallbacks} ladder fallback(s), ${r.jsonRepairs} JSON repair(s), peak ${r.peakConcurrentCalls} in flight`);
  for (const i of r.invariants) L.push(`  ${i.ok ? "ok  " : "FAIL"} ${i.name}: ${i.detail}`);
  L.push(r.ok ? "LOAD TEST PASSED" : "LOAD TEST FAILED");
  return L.join("\n");
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const arg = (n: string): string | undefined => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  const r = await runLoad({ ...(arg("jobs") ? { jobs: Number(arg("jobs")) } : {}), ...(arg("seed") ? { seed: Number(arg("seed")) } : {}), log: (s) => console.log(s) });
  console.log(`\n${renderLoad(r)}`);
  mkdirp(OUT_DIR);
  writeJson(path.join(OUT_DIR, "load.json"), r);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && /e2e\/load\.[tj]s$/.test(process.argv[1])) {
  main().then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
}

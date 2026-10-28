/**
 * THE STAGES, IN ORDER, EACH ONLY AS FAR AS IT IS STILL WORTH MONEY.
 *
 *   0  free, always first    the offline suite's status; every cassette replayed against the current code (regressions at ₹0, and what must be re-recorded); the free
 *                            part bake-offs (page extraction, locate)
 *   1  cents                 capability probes, only for models with no score under this code and probe version (the store says which)
 *   2  smoke, recorded       the nine smoke items, only those the store does not answer; recorded to a cassette so a second run is free
 *   3  the stratified sample our bot with the product's own ladders on the smallest set of tasks that covers every category and stage
 *   4  comparisons           contestants against contestants, models against models, on the same tasks, interleaved, stopped when the answer is clear (compare.ts)
 *   5  parts                 edit formats for models missing them, context strategy, router: with the money left
 *
 * Every stage has an estimate (plan.ts) and a guard: past 130% of it the stage is aborted. A stage the money cannot start is skipped, not squeezed. The results of
 * every stage go to the store as they come in, so an interrupted run loses nothing and a rerun pays for nothing it already has.
 */
import "../env.js";
import { realKey } from "../env.js";
import { codeFingerprint, summaryFingerprint, treeHash } from "./fingerprint.js";
import { run as runProcess, sh } from "../util.js";
import { TULMI_DIR } from "../env.js";
import { loadTasks } from "../tasks/schema.js";
import { savedPages } from "../bakeoff/corpus.js";
import { runExtractionBakeoff } from "../bakeoff/extract.js";
import { runLocateBakeoff } from "../bakeoff/locate.js";
import { hashSources, loadHashes, changedFiles, affectedBy } from "../smoke/changed.js";
import { CassetteStore } from "../adapters/cassette.js";
import type { CentPartResult } from "../bakeoff/centparts.js";
import type { ItemResult } from "../smoke/types.js";
import { compare, StageOverrun } from "./compare.js";
import type { Executor } from "./exec.js";
import { isUnstable } from "./perf.js";
import { estimateStages, groupPlans, LADDERS_ARM, routerAnswered, smokeKey, StageBudget, taskKey, type Ctx } from "./plan.js";
import { classify, kindOfCassette, listCassettes, remember, replayCassette, type ReplayItem, type ReplayReport } from "./replay.js";
import { probeKeyNow, probeNeeds } from "./scoreboard.js";
import { storeFor, type ResultSource, type ResultsStore, type StoredResult } from "./store.js";
import type { Arm, ComparisonReport, PartReport, StageEstimate, StageId, StageReport, TaskOutcome } from "./types.js";
import { STAGE_TITLES } from "./types.js";
import { ALL_PROBES } from "../bakeoff/probes.js";
import { inrOf } from "./plan.js";

export interface SuiteStatus {
  ran: boolean;
  skipped?: string;
  tests?: { total: number; passed: number; failed: number; files: number; failing: string[]; seconds: number };
  typecheck?: { ok: boolean; errors: string[]; seconds: number };
  oracle: { tasks: number; validated: number };
}

export interface FreePartRecord { id: "extraction" | "locate"; reused: boolean; skipped?: string; data: unknown | null }

export interface RunState {
  ctx: Ctx;
  exec: Executor;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  /** The store that stage 0 writes to (always the real one: a replay is a real measurement, whatever mode the rest runs in). */
  realStore: ResultsStore;
  estimates: StageEstimate[];
  stages: StageReport[];
  suite: SuiteStatus | null;
  replays: Array<ReplayReport & { boxes: Record<string, number>; changedFiles: string[]; affectedStages: string[] }>;
  replayParts: CentPartResult[];
  freeParts: FreePartRecord[];
  probes: { ran: number; reused: number; skipped: number; unreachable: string[] };
  smoke: { ran: ItemResult[]; reused: string[]; staleItems: Array<{ id: string; cassette: string }> };
  sample: { ran: number; reused: number; skipped: number };
  comparisons: ComparisonReport[];
  parts: PartReport[];
  spentInr: number;
  aborted: string[];
  /** When a stage ran over, the ratio later estimates are scaled by. */
  ratio: number;
}

const sourceOf = (ctx: Ctx): ResultSource => (ctx.mode === "real" ? "real" : ctx.mode === "replay" ? "replay" : "sim");

function put(ctx: Ctx, r: Omit<StoredResult, "at" | "run" | "source">, runId: string): void {
  ctx.store.append({ ...r, at: new Date().toISOString(), run: runId, source: sourceOf(ctx) });
}

export function newState(ctx: Ctx, exec: Executor): RunState {
  const startedAt = new Date().toISOString();
  return {
    ctx, exec, runId: startedAt.replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-"), startedAt,
    realStore: ctx.mode === "real" || ctx.mode === "replay" ? ctx.store : storeFor("real", { ...(ctx.resultsDir ? { dir: ctx.resultsDir } : {}), outDir: ctx.outDir }),
    estimates: [], stages: [], suite: null, replays: [], replayParts: [], freeParts: [], probes: { ran: 0, reused: 0, skipped: 0, unreachable: [] }, smoke: { ran: [], reused: [], staleItems: [] },
    sample: { ran: 0, reused: 0, skipped: 0 }, comparisons: [], parts: [], spentInr: 0, aborted: [], ratio: 1,
  };
}

// ------------------------------------------------------------------------------------- stage 0

/** The offline suite: the harness's own tests, the type check, and how many tasks have a proven oracle. */
export async function offlineSuite(ctx: Ctx): Promise<SuiteStatus> {
  const tasks = loadTasks();
  const oracle = { tasks: tasks.length, validated: tasks.filter((t) => t.validated?.oraclePasses).length };
  if (ctx.skipSuite) return { ran: false, skipped: "skipped (--no-suite)", oracle };
  const out: SuiteStatus = { ran: true, oracle };
  const json = `${ctx.outDir}/vitest.json`;
  const t0 = Date.now();
  const r = await sh(`npx vitest run tests/e2e-*.test.ts --reporter=json --outputFile=${json}`, { cwd: TULMI_DIR, timeoutMs: 900_000, env: { ...process.env, REALITY_NESTED: "1" } });
  try {
    const j = JSON.parse((await import("node:fs")).readFileSync(json, "utf8")) as { numTotalTests: number; numPassedTests: number; numFailedTests: number; testResults: Array<{ assertionResults: Array<{ status: string; fullName: string }> }> };
    out.tests = {
      total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests, files: j.testResults.length,
      failing: j.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === "failed").map((a) => a.fullName)).slice(0, 10), seconds: Math.round((Date.now() - t0) / 100) / 10,
    };
  } catch { out.tests = { total: 0, passed: 0, failed: r.code === 0 ? 0 : 1, files: 0, failing: [`vitest did not write a report (exit ${r.code}): ${(r.stderr || r.stdout).slice(-200)}`], seconds: Math.round((Date.now() - t0) / 100) / 10 }; }
  if (!ctx.skipTypecheck) {
    const t1 = Date.now();
    const tc = await runProcess("npx", ["tsc", "--noEmit"], { cwd: TULMI_DIR, timeoutMs: 600_000 });
    out.typecheck = { ok: tc.code === 0, errors: tc.stdout.split("\n").filter((l) => l.includes("error TS")).slice(0, 8), seconds: Math.round((Date.now() - t1) / 100) / 10 };
  }
  return out;
}

async function freePart(st: RunState, id: "extraction" | "locate"): Promise<FreePartRecord> {
  const prompt = id === "extraction" ? treeHash(["e2e/bakeoff/extract-truth.json", "e2e/bakeoff/extract.ts", "e2e/bakeoff/corpus.ts"]) : treeHash(["e2e/bakeoff/locate.ts", "e2e/tasks"]);
  const key = { kind: "part" as const, agent: "-", model: "-", item: id, code: codeFingerprint(id === "extraction" ? "part:extraction" : "part:locate"), prompt };
  const had = st.realStore.get(key);
  if (had) return { id, reused: true, data: had.data ?? null };
  try {
    let data: unknown;
    let winner: string | undefined;
    if (id === "extraction") {
      if (!savedPages().length) return { id, reused: false, skipped: "no saved pages: npm run bakeoff -- --fetch-pages", data: null };
      const x = await runExtractionBakeoff({ log: () => undefined });
      winner = x.winner?.id;
      data = { at: x.at, pages: x.pages, truthPages: x.truthPages, winner: x.winner, ranking: x.ranking, results: x.results.map(({ perPage: _p, ...r }) => r), truthMistakes: x.truthCheck.problems.filter((p) => p.kind !== "absent-in-main").length };
    } else {
      const l = await runLocateBakeoff({ log: () => undefined });
      winner = l.winner?.id;
      data = { at: l.at, tasks: l.tasks, bugs: l.bugs, questions: l.questions, winner: l.winner, chance: l.chance, cliMap: l.cliMap, contestants: l.contestants };
    }
    st.realStore.append({ ...key, at: new Date().toISOString(), run: st.runId, source: "real", ok: true, costInr: 0, wallMs: 0, detail: winner ? `winner ${winner}` : "no winner", data });
    return { id, reused: false, data };
  } catch (err) {
    return { id, reused: false, skipped: `could not run: ${(err as Error).message.slice(0, 160)}`, data: null };
  }
}

/** Every cassette replayed against the code as it is, each put in its box and remembered. Returns the lines to report. */
export async function replaySweep(st: Pick<RunState, "ctx" | "realStore" | "runId" | "replays" | "replayParts">): Promise<string[]> {
  const { ctx } = st;
  const lines: string[] = [];
  const now = hashSources();
  for (const c of listCassettes()) {
    if (c.kind === "other") { lines.push(`cassette ${c.name}: ${c.entries} entries, not a kind that is replayed here (left alone)`); continue; }
    try {
      const rep = await replayCassette(c.name, c.kind, { catalog: ctx.catalog, log: () => undefined });
      if (!rep) continue;
      rep.items = classify(rep.items, st.realStore);
      if ("part" in rep && (rep as { part?: CentPartResult | null }).part) st.replayParts.push((rep as { part: CentPartResult }).part);
      const boxes: Record<string, number> = {};
      for (const i of rep.items) boxes[i.box] = (boxes[i.box] ?? 0) + 1;
      const before = c.kind === "smoke" ? loadHashes(new CassetteStore(c.name).file) : null;
      const files = before ? changedFiles(before, now) : [];
      st.replays.push({ ...rep, boxes, changedFiles: files, affectedStages: files.length ? affectedBy(files).stages : [] });
      remember(st.realStore, rep, st.runId);
      const desc = Object.entries(boxes).map(([k, v]) => `${v} ${k}`).join(", ");
      lines.push(`cassette ${c.name} (${c.kind}): ${rep.items.length} item(s) replayed for ₹0 [${desc}]; ${rep.hits} answers served, ${rep.misses} request(s) not recorded${rep.documented.length ? `; ${rep.documented[0]}` : ""}`);
    } catch (err) {
      lines.push(`cassette ${c.name}: could not be replayed (${(err as Error).message.slice(0, 120)})`);
    }
  }
  return lines;
}

export async function stage0(st: RunState): Promise<StageReport> {
  const { ctx } = st;
  const lines: string[] = [];
  st.suite = await offlineSuite(ctx);
  if (st.suite.tests) lines.push(`offline suite: ${st.suite.tests.passed}/${st.suite.tests.total} tests pass in ${st.suite.tests.files} e2e test file(s)${st.suite.tests.failed ? `, ${st.suite.tests.failed} FAIL: ${st.suite.tests.failing.slice(0, 3).join("; ")}` : ""}`);
  else lines.push(`offline suite: ${st.suite.skipped}`);
  if (st.suite.typecheck) lines.push(`type check (tsc --noEmit): ${st.suite.typecheck.ok ? "clean" : `${st.suite.typecheck.errors.length}+ error(s): ${st.suite.typecheck.errors[0] ?? ""}`}`);
  lines.push(`oracle: ${st.suite.oracle.validated} of ${st.suite.oracle.tasks} tasks have a hidden check proven to fail on the base and pass with the known answer`);

  // Every cassette, replayed against the code as it is.
  lines.push(...(await replaySweep(st)));
  const regressed = st.replays.flatMap((r) => r.items.filter((i) => i.box === "regressed"));
  const stale = st.replays.flatMap((r) => r.items.filter((i) => i.box === "stale"));
  lines.push(`regressions found at ₹0: ${regressed.length}${regressed.length ? ` (${regressed.slice(0, 4).map((i) => `${i.cassette}/${i.item}`).join(", ")})` : ""}; items whose recording no longer covers the code (re-record to know): ${stale.length}`);

  if (ctx.freeParts) {
    for (const id of ["extraction", "locate"] as const) {
      const r = await freePart(st, id);
      st.freeParts.push(r);
      lines.push(`free part ${id}: ${r.skipped ? r.skipped : r.reused ? "result for this code already in the store" : "measured now"}${r.data && (r.data as { winner?: { id: string } }).winner ? `; winner ${(r.data as { winner: { id: string } }).winner.id}` : ""}`);
    }
  }
  return { stage: 0, title: STAGE_TITLES[0], status: "done", estimateInr: 0, spentInr: 0, reusedInr: 0, lines };
}

// ------------------------------------------------------------------------------------- stage 1

export async function stage1(st: RunState, b: StageBudget, est: StageEstimate): Promise<StageReport> {
  const { ctx, exec } = st;
  const lines: string[] = [];
  const needs = probeNeeds(ctx.catalog, ctx.poolsFile);
  const missing = needs.filter((n) => !ctx.store.reusable(probeKeyNow(n.model, n.probe)));
  st.probes.reused = needs.length - missing.length;
  lines.push(`${needs.length} probe(s) wanted for ${new Set(needs.map((n) => n.model)).size} candidate model(s); ${st.probes.reused} already answered under this model door and probe version`);
  if (!missing.length) return { stage: 1, title: STAGE_TITLES[1], status: "skipped", estimateInr: est.expectedInr, spentInr: 0, reusedInr: est.reusedInr, reason: "every probe is in the store for this code", lines };
  if (ctx.mode === "scripted") return { stage: 1, title: STAGE_TITLES[1], status: "skipped", estimateInr: est.expectedInr, spentInr: 0, reusedInr: est.reusedInr, reason: "a probe needs a real model (scripted mode has none)", lines: [...lines, `${missing.length} probe(s) would be run with a model`] };
  // Cheapest model first: if the money runs short, the models with the most evidence per rupee are the ones that got probed.
  const byModel = new Map<string, typeof missing>();
  for (const m of missing) byModel.set(m.model, [...(byModel.get(m.model) ?? []), m]);
  const order = [...byModel].sort((a, b2) => inrOf(ctx.catalog, ctx.fx, a[0], 1000, 100) - inrOf(ctx.catalog, ctx.fx, b2[0], 1000, 100));
  let status: StageReport["status"] = "done";
  let reason: string | undefined;
  try {
    for (const [model, probes] of order) {
      let unreachable = 0;
      for (const n of probes) {
        const p = ALL_PROBES.find((x) => x.id === n.probe)!;
        const cost = inrOf(ctx.catalog, ctx.fx, model, p.tokens.in, p.tokens.out);
        if (b.leftInr() < cost) { status = "partial"; reason = "the stage's share of the money ran out"; break; }
        // A model whose first two probes never got an answer is unreachable: the rest would only be more failed calls.
        if (unreachable >= 2) { st.probes.skipped += 1; continue; }
        const r = await exec.probe(model, n.probe, n.info);
        if (r.unrecorded) { st.probes.skipped += 1; continue; }
        st.probes.ran += 1;
        b.charge(r.costInr, `${model} ${n.probe}`);
        put(ctx, { ...probeKeyNow(model, n.probe), ok: r.ok, score: r.score, costInr: r.costInr, wallMs: r.wallMs, detail: r.detail, data: { errors: r.errors, tiers: n.tiers } }, st.runId);
        if (r.errors.failed > 0 && r.score === 0) unreachable += 1; else unreachable = 0;
      }
      if (unreachable >= 2) { st.probes.unreachable.push(model); lines.push(`${model}: its calls fail (unreachable); the rest of its probes were not paid for`); }
      if (status === "partial") break;
    }
  } catch (err) { if (err instanceof StageOverrun) { status = "aborted"; reason = err.message; } else throw err; }
  lines.push(`${st.probes.ran} probe(s) run${ctx.mode === "replay" ? " from cassettes" : ""}; ${st.probes.skipped} not run${ctx.mode === "replay" ? " (not recorded)" : ""}`);
  return { stage: 1, title: STAGE_TITLES[1], status: st.probes.ran === 0 && status === "done" ? "skipped" : status, estimateInr: est.expectedInr, spentInr: b.spentInr, reusedInr: est.reusedInr, ...(reason ? { reason } : st.probes.ran === 0 && ctx.mode === "replay" ? { reason: "no recording answers the missing probes" } : {}), lines };
}

// ------------------------------------------------------------------------------------- stage 2

export async function stage2(st: RunState, b: StageBudget, est: StageEstimate): Promise<StageReport> {
  const { ctx, exec } = st;
  const lines: string[] = [];
  const { planItems } = await import("../smoke/index.js");
  const items = planItems(loadTasks().filter((t) => t.tags.includes("smoke"))).map((p) => p.id);
  const missing = items.filter((id) => !ctx.store.reusable(smokeKey(id)));
  st.smoke.reused = items.filter((id) => !missing.includes(id));
  const { staleSmokeItems } = await import("./plan.js");
  st.smoke.staleItems = staleSmokeItems(st.realStore);
  lines.push(`${items.length} smoke item(s); ${st.smoke.reused.length} already answered for this code; ${missing.length} to run`);
  for (const s of st.smoke.staleItems) lines.push(`${s.id}: NEEDS RE-RECORD (cassette ${s.cassette} no longer covers the code); it is not faked`);
  if (!missing.length) return { stage: 2, title: STAGE_TITLES[2], status: "skipped", estimateInr: est.expectedInr, spentInr: 0, reusedInr: est.reusedInr, reason: "all nine items are in the store for this code", lines };
  if (ctx.mode === "replay") return { stage: 2, title: STAGE_TITLES[2], status: "skipped", estimateInr: est.expectedInr, spentInr: 0, reusedInr: est.reusedInr, reason: "replay mode: the cassettes were replayed in stage 0, and a miss there means a paid re-record", lines };
  try {
    const r = await exec.smoke(missing, { capInr: Math.min(b.leftInr(), 25) });
    st.smoke.ran = r.items;
    b.charge(r.spentInr, "smoke");
    for (const i of r.items) {
      put(ctx, { ...smokeKey(i.id), ok: i.ok, costInr: i.costPaise / 100, wallMs: i.ms, detail: i.detail, data: { n: i.n, title: i.title, stages: i.stages, harness: i.harness } }, st.runId);
    }
    lines.push(`${r.items.filter((i) => i.ok).length}/${r.items.length} item(s) pass; recorded to cassette reality-smoke`);
    return { stage: 2, title: STAGE_TITLES[2], status: "done", estimateInr: est.expectedInr, spentInr: b.spentInr, reusedInr: est.reusedInr, lines };
  } catch (err) {
    if (err instanceof StageOverrun) return { stage: 2, title: STAGE_TITLES[2], status: "aborted", estimateInr: est.expectedInr, spentInr: b.spentInr, reusedInr: est.reusedInr, reason: err.message, lines };
    throw err;
  }
}

// ------------------------------------------------------------------------------------- stage 3

function recordOf(arm: Arm, task: Parameters<typeof taskKey>[1], res: TaskOutcome): Omit<StoredResult, "at" | "run" | "source"> {
  return { ...taskKey(arm, task), ok: res.ok, score: res.quality, costInr: res.costInr, wallMs: res.wallMs, category: task.category, perf: res.perf, detail: res.detail };
}

export async function stage3(st: RunState, b: StageBudget, est: StageEstimate): Promise<StageReport> {
  const { ctx, exec } = st;
  const lines: string[] = [];
  const arm: Arm = ctx.mode === "scripted" ? { id: "tailzu:oracle", agent: "tailzu", model: "oracle", group: "models" } : LADDERS_ARM;
  let status: StageReport["status"] = "done";
  let reason: string | undefined;
  lines.push(`${ctx.sample.ordered.length} task(s) chosen: ${ctx.sample.cover.length} cover all ${ctx.sample.covered.categories.length} categories and ${ctx.sample.covered.stages.length} stages, the rest by diversity`);
  for (const s of ctx.sample.skipped.slice(0, 6)) lines.push(`${s.id}: skipped (${s.reason})`);
  let index = 0;
  try {
    for (const task of ctx.sample.ordered) {
      index += 1;
      if (st.exec.mode !== "sim" && ctx.store.reusable(taskKey(arm, task))) { st.sample.reused += 1; continue; }
      if (ctx.store.reusable(taskKey(arm, task))) { st.sample.reused += 1; continue; }
      if (b.leftInr() < 0.3 && ctx.mode === "real") { status = "partial"; reason = "the stage's share of the money ran out"; break; }
      let repeat = 1;
      const earlier = ctx.store.history("task", arm.agent, arm.model, task.id).map((r) => r.ok);
      for (;;) {
        const res = await exec.task(arm, task, { repeat, budgetInr: b.leftInr(), index });
        if (res.skipped) { st.sample.skipped += 1; lines.push(`${task.id}: not run (${res.skipped})`); break; }
        st.sample.ran += 1;
        put(ctx, recordOf(arm, task, res), st.runId);
        b.charge(res.costInr, task.id);
        ctx.log(`  ${task.id}: ${res.ok ? "pass" : "FAIL"}  ₹${res.costInr.toFixed(2)}${res.ok ? "" : `  ${res.detail.slice(0, 100)}`}`);
        if (repeat > ctx.spec.maxRepeats || !isUnstable(res.perf, [...earlier])) break;
        earlier.push(res.ok);
        repeat += 1;
      }
    }
  } catch (err) { if (err instanceof StageOverrun) { status = "aborted"; reason = err.message; } else throw err; }
  const mine = ctx.sample.ordered.map((t) => ctx.store.get(taskKey(arm, t))).filter((r): r is StoredResult => !!r);
  lines.push(`${mine.filter((r) => r.ok).length}/${mine.length} pass; ${st.sample.ran} run now, ${st.sample.reused} answered already in the store`);
  return { stage: 3, title: STAGE_TITLES[3], status: st.sample.ran === 0 && status === "done" ? "skipped" : status, estimateInr: est.expectedInr, spentInr: b.spentInr, reusedInr: est.reusedInr, ...(reason ? { reason } : st.sample.ran === 0 ? { reason: ctx.mode === "replay" ? "no recording answers these tasks" : "every task is in the store for this code" } : {}), lines };
}

// ------------------------------------------------------------------------------------- stage 4

export async function stage4(st: RunState, b: StageBudget, est: StageEstimate): Promise<StageReport> {
  const { ctx, exec } = st;
  const lines: string[] = [];
  let status: StageReport["status"] = "done";
  let reason: string | undefined;
  const groups = groupPlans(ctx);
  if (!groups.length) return { stage: 4, title: STAGE_TITLES[4], status: "skipped", estimateInr: est.expectedInr, spentInr: 0, reusedInr: 0, reason: "no comparison can run here", lines };
  for (const g of groups) {
    for (const s of g.skipped) lines.push(`${g.id}: ${s.arm} left out (${s.why})`);
    if (g.arms.length < 2 || !g.tasks.length) { lines.push(`${g.title}: not run (${g.arms.length} arm(s), ${g.tasks.length} task(s))`); continue; }
    lines.push(`${g.title}: ${g.arms.length} arms x up to ${g.tasks.length} tasks`);
    ctx.log(`comparison: ${g.title} [${g.arms.map((a) => a.id).join(", ")}]`);
    const cmp = await compare({
      id: g.id, title: g.title, group: g.group, arms: g.arms, tasks: g.tasks, exec, store: ctx.store, key: taskKey, allowance: b, confidence: ctx.confidence, minTasks: ctx.spec.minTasks, roundSize: ctx.spec.roundSize,
      maxRepeats: ctx.spec.maxRepeats, taskCapInr: 30, seed: ctx.seed, source: sourceOf(ctx), runId: st.runId, log: ctx.log,
      onRun: (arm, task, _repeat, res) => put(ctx, recordOf(arm, task, res), st.runId),
    });
    st.comparisons.push(cmp);
    lines.push(`  -> ${cmp.ended}${cmp.winner ? `: ${cmp.winner}` : ""} after ${cmp.rounds.length} round(s) on ${cmp.tasks.length} task(s); ${cmp.runsSaved} run(s) not needed`);
    if (cmp.ended === "overrun") { status = "aborted"; reason = b.overrun?.message ?? "the stage overran its estimate"; break; }
    if (cmp.ended === "budget") { status = "partial"; reason = "the stage's share of the money ran out"; }
  }
  return { stage: 4, title: STAGE_TITLES[4], status, estimateInr: est.expectedInr, spentInr: b.spentInr, reusedInr: est.reusedInr, ...(reason ? { reason } : {}), lines };
}

// ------------------------------------------------------------------------------------- stage 5

export async function stage5(st: RunState, b: StageBudget, est: StageEstimate): Promise<StageReport> {
  const { ctx, exec } = st;
  const lines: string[] = [];
  const { candidateModels, strategyTasks } = await import("../bakeoff/centparts.js");
  const { loadPools } = await import("../bakeoff/pools.js");
  const { probeVersion } = await import("./fingerprint.js");
  let status: StageReport["status"] = "done";
  let reason: string | undefined;
  const partKey = (model: string, item: string, kind: Parameters<typeof codeFingerprint>[0]) => ({ kind: "part" as const, agent: "-", model, item, code: codeFingerprint(kind), prompt: probeVersion() });
  const todo: Array<{ id: "editFormats" | "router" | "contextStrategy"; models?: string[]; estimate: number; why: string }> = [];
  const editModels = candidateModels(ctx.catalog, ["code", "strong"], 8).filter((m) => !ctx.store.reusable(partKey(m, "editFormats", "part:editFormats")));
  if (editModels.length) todo.push({ id: "editFormats", models: editModels, estimate: est.expectedInr / 3, why: `${editModels.length} model(s) with no edit-format result` });
  const strategyBlocked = strategyTasks(4).filter((t) => ctx.blocked.has(t.id));
  if (strategyBlocked.length) lines.push(`context strategy: ${ctx.blocked.get(strategyBlocked[0]!.id)} (${[...new Set(strategyBlocked.map((t) => t.repo))].join(", ")})`);
  else todo.push({ id: "contextStrategy", estimate: est.expectedInr / 3, why: "summary vs mask vs hybrid on real tasks" });
  const routerDone = routerAnswered(ctx.store);
  if (!routerDone) todo.push({ id: "router", estimate: est.expectedInr / 3, why: "no router result for this code" });
  else lines.push("router: a result for this code is already in the store");
  try {
    for (const t of todo) {
      if (ctx.mode === "replay") { lines.push(`${t.id}: replay mode, left to its cassette`); continue; }
      if (b.leftInr() < Math.max(0.3, t.estimate * 0.5) && ctx.mode === "real") { lines.push(`${t.id}: left out, not enough of the stage's money (${t.why})`); status = "partial"; continue; }
      ctx.log(`part ${t.id}: ${t.why}`);
      try {
        const r = await exec.part(t.id, { ...(t.models ? { models: t.models } : {}), capInr: Math.max(0.5, Math.min(b.leftInr(), t.estimate * 1.5)) });
        b.charge(r.spentInr, t.id);
        st.parts.push({ id: t.id, result: r, reused: false });
        if (t.id === "editFormats") for (const row of (r.data as Array<{ model: string; score: { rates: Record<string, number>; best: string } }>) ?? []) {
          put(ctx, { ...partKey(row.model, "editFormats", "part:editFormats"), ok: true, costInr: 0, wallMs: 0, detail: `best ${row.score.best}`, data: { ...row.score.rates, best: row.score.best } }, st.runId);
        }
        lines.push(`${t.id}: ${r.status}; ${r.headline.slice(0, 140)}`);
      } catch (err) {
        if (err instanceof StageOverrun) throw err;
        lines.push(`${t.id}: could not run (${(err as Error).message.slice(0, 140)})`);
        st.parts.push({ id: t.id, result: null, reused: false, reason: (err as Error).message.slice(0, 200) });
      }
    }
  } catch (err) { if (err instanceof StageOverrun) { status = "aborted"; reason = err.message; } else throw err; }
  void loadPools;
  return { stage: 5, title: STAGE_TITLES[5], status: st.parts.length === 0 && status === "done" ? "skipped" : status, estimateInr: est.expectedInr, spentInr: b.spentInr, reusedInr: est.reusedInr, ...(reason ? { reason } : st.parts.length === 0 ? { reason: "nothing missing, or nothing that can run here" } : {}), lines };
}

// ------------------------------------------------------------------------------------- the run

/** Runs the selected stages in order, each with its own guard; the money a stage does not use passes to the next. */
export async function runStages(st: RunState): Promise<RunState> {
  const { ctx } = st;
  const real = ctx.mode === "real";
  let carry = 0;
  let left = ctx.budgetInr;
  for (const stage of [0, 1, 2, 3, 4, 5] as StageId[]) {
    if (!ctx.stages.includes(stage)) continue;
    ctx.log(`\n== stage ${stage}: ${STAGE_TITLES[stage]}`);
    if (stage === 0) {
      const r = await stage0(st);
      st.stages.push(r);
      for (const l of r.lines) ctx.log(`  ${l}`);
      continue;
    }
    const est0 = estimateStages({ ...ctx, stages: [stage] })[0]!;
    const est: StageEstimate = { ...est0, expectedInr: est0.expectedInr * st.ratio, maxInr: est0.maxInr * st.ratio };
    const cap = real ? Math.max(0, Math.min(left, ctx.budgetInr * ctx.spec.share[stage] + carry)) : Number.POSITIVE_INFINITY;
    const b = new StageBudget(stage, est.expectedInr, cap, real);
    if (real && !realKey && ctx.mode === "real") { st.stages.push({ stage, title: STAGE_TITLES[stage], status: "blocked", estimateInr: est.expectedInr, spentInr: 0, reusedInr: est.reusedInr, reason: "OPENROUTER_API_KEY is not set", lines: [] }); continue; }
    if (real && cap < 0.05 && est.expectedInr > 0) {
      st.stages.push({ stage, title: STAGE_TITLES[stage], status: "skipped", estimateInr: est.expectedInr, spentInr: 0, reusedInr: est.reusedInr, reason: `no money left for it (its share is ₹${cap.toFixed(2)}, it needs about ₹${est.expectedInr.toFixed(2)})`, lines: [] });
      continue;
    }
    ctx.log(`  estimate ₹${est.expectedInr.toFixed(2)} (at most ₹${est.maxInr.toFixed(2)}), ${real ? `cap ₹${cap.toFixed(2)}, aborted past ₹${b.limitInr.toFixed(2)}` : "nothing is paid in this mode"}`);
    const run = { 1: stage1, 2: stage2, 3: stage3, 4: stage4, 5: stage5 }[stage]!;
    const r = await run(st, b, est);
    st.stages.push(r);
    for (const l of r.lines) ctx.log(`  ${l}`);
    if (r.status === "aborted") { st.aborted.push(`stage ${stage}: ${r.reason}`); if (est.expectedInr > 0 && real) st.ratio = Math.max(st.ratio, r.spentInr / est.expectedInr); ctx.log(`  STAGE ${stage} ABORTED: ${r.reason}`); }
    st.spentInr += b.spentInr;
    left -= real ? b.spentInr : 0;
    carry = real ? Math.max(0, cap - b.spentInr) : 0;
    st.spentInr = real ? st.spentInr : st.exec.spentInr();
  }
  st.finishedAt = new Date().toISOString();
  void summaryFingerprint;
  return st;
}

export type { ReplayItem };
void kindOfCassette;

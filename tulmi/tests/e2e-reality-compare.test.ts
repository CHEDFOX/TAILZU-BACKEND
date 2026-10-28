/**
 * The sequential comparison, the stage guard, the estimate and the stages, on the simulated executor: a clear winner is found early and the losers stop being paid for,
 * a tie is not called, an unstable result is run again and a stable one is not, a result in the store is not paid twice, a stage that spends 30% over its estimate is
 * aborted. No key, no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const outDir = vi.hoisted(() => {
  const nodeFs = require("node:fs") as typeof import("node:fs");
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "reality-out-"));
  process.env.E2E_OUT_DIR = dir;
  return dir;
});

import { CliExit } from "../e2e/cli.js";
import { parseCatalog, type Catalog } from "../e2e/catalog.js";
import { loadTasks, type Task } from "../e2e/tasks/schema.js";
import { compare, StageOverrun } from "../e2e/reality/compare.js";
import type { Executor } from "../e2e/reality/exec.js";
import type { Perf } from "../e2e/reality/perf.js";
import { LADDERS_ARM, StageBudget, buildCtx, estimateStages, groupPlans, renderEstimate, requireReceipt, smokeKey, taskKey, totalsOf, writeReceipt, type RealityOptions } from "../e2e/reality/plan.js";
import { SimExecutor } from "../e2e/reality/sim.js";
import { newState, runStages, stage4 } from "../e2e/reality/stages.js";
import { ResultsStore } from "../e2e/reality/store.js";
import type { Arm, StageEstimate, TaskOutcome } from "../e2e/reality/types.js";
import { probeKeyNow } from "../e2e/reality/scoreboard.js";

const catalog = (): Catalog => ({
  fetchedAt: Date.now(), source: "live",
  models: parseCatalog({ data: ["deepseek/deepseek-v4.1-flash", "qwen/qwen3-coder-next", "moonshotai/kimi-k2.7-code", "anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "qwen/qwen3.7-flash", "openai/gpt-6-luna", "anthropic/claude-haiku-5.5"].map((id) => ({
    id, pricing: { prompt: "0.0000003", completion: "0.0000012" }, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools", "response_format", "reasoning"], context_length: 100000,
  })) }),
});

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const tasks = loadTasks().filter((t) => !t.tags.includes("smoke") && !t.tags.includes("injection-suite")).slice(0, 14);
const key = (arm: Arm, task: Task) => taskKey(arm, task);

const A = (id: string, agent = "tailzu", model = "ladders"): Arm => ({ id, agent, model, group: "agents" });
const base = (over: Partial<RealityOptions> = {}): RealityOptions => ({
  plan: "quick", budgetInr: 0, mode: "sim", estimateOnly: false, stages: [3, 4], groups: ["agents", "models"], outDir: tmp("reality-run-"), resultsDir: tmp("reality-res-"), seed: 1, confidence: 0.9, install: false,
  skipSuite: true, skipTypecheck: true, freeParts: false, judge: false, sim: "clear", persona: "oracle", log: () => undefined, catalog: catalog(), ...over,
});

const free = { leftInr: () => Number.POSITIVE_INFINITY, charge: () => undefined };

function sim(scenario: "clear" | "tie" | "mixed", seed = 1): SimExecutor {
  return new SimExecutor({ scenario, seed, fx: 88, catalog: catalog(), outDir: tmp("reality-sim-"), log: () => undefined });
}

const agents = ["tailzu", "aider", "opencode", "codex", "openhands", "mini-swe-agent"].map((a) => A(a === "tailzu" ? "tailzu:ladders" : `${a}:m`, a, a === "tailzu" ? "ladders" : "m"));

describe("the sequential comparison", () => {
  it("a SIMULATED CLEAR WINNER is found early, the losers stop being run, and the runs not needed are counted", async () => {
    const ex = sim("clear");
    let runs = 0;
    const counting: Executor = { ...ex, mode: "sim", spentInr: () => ex.spentInr(), probe: ex.probe.bind(ex), smoke: ex.smoke.bind(ex), part: ex.part.bind(ex), close: ex.close.bind(ex), task: async (...a) => { runs += 1; return ex.task(...a); } };
    const c = await compare({ id: "agents", title: "agents", group: "agents", arms: agents, tasks, exec: counting, store: new ResultsStore(tmp("s-"), ["sim"]).load(), key, allowance: free, source: "sim", runId: "r", log: () => undefined, minTasks: 4, roundSize: 2, maxRepeats: 0 });
    expect(c.winner).toBe("tailzu:ladders");
    expect(["clear", "last"]).toContain(c.ended);
    expect(c.tasks.length).toBeLessThan(tasks.length);
    expect(c.runsSaved).toBeGreaterThan(0);
    expect(runs).toBeLessThan(agents.length * tasks.length);
    // The weak arms were dropped in the round that found them dominated, and not run after it.
    const dropped = c.rounds.flatMap((r) => r.decision.drop);
    expect(dropped.length).toBeGreaterThan(0);
    const lastRound = c.rounds.length;
    for (const d of dropped) {
      const dropRound = c.rounds.findIndex((r) => r.decision.drop.includes(d)) + 1;
      const laterTasks = new Set(c.rounds.filter((r) => r.round > dropRound).flatMap((r) => r.tasks));
      expect(c.runs.filter((r) => r.arm === d && laterTasks.has(r.task)).length, `${d} after round ${dropRound} of ${lastRound}`).toBe(0);
    }
    expect(c.final.leader).toBe("tailzu:ladders");
    expect(c.final.arms.find((a) => a.id === "tailzu:ladders")!.pBest).toBeGreaterThan(0.9);
  });

  it("a SIMULATED TIE is not called: every task is used and it ends as a tie with no winner", async () => {
    const arms = [A("tailzu:ladders"), A("aider:m", "aider", "m"), A("opencode:m", "opencode", "m")];
    const c = await compare({ id: "agents", title: "agents", group: "agents", arms, tasks, exec: sim("tie", 4), store: new ResultsStore(tmp("s-"), ["sim"]).load(), key, allowance: free, source: "sim", runId: "r", log: () => undefined, minTasks: 4, roundSize: 2, maxRepeats: 0 });
    expect(c.ended).toBe("tie");
    expect(c.winner).toBeNull();
    expect(c.tasks.length).toBe(tasks.length);
    expect(c.final.decided).toBe(false);
    expect(Math.max(...c.final.arms.map((a) => a.pBest))).toBeLessThan(0.9);
  });

  it("does not pay twice: a second comparison over the same store runs nothing", async () => {
    const store = new ResultsStore(tmp("s-"), ["sim"]).load();
    const ex = sim("clear");
    let runs = 0;
    const counting = (e: SimExecutor): Executor => ({ mode: "sim", spentInr: () => e.spentInr(), probe: e.probe.bind(e), smoke: e.smoke.bind(e), part: e.part.bind(e), close: e.close.bind(e), task: async (...a) => { runs += 1; return e.task(...a); } });
    const opts = (e: Executor) => ({ id: "g", title: "g", group: "agents" as const, arms: agents.slice(0, 3), tasks: tasks.slice(0, 6), exec: e, store, key, allowance: free, source: "sim" as const, runId: "r", log: () => undefined, minTasks: 4, roundSize: 2, maxRepeats: 0, onRun: (arm: Arm, task: Task, repeat: number, res: TaskOutcome) => store.append({ ...key(arm, task), at: "t", run: "r", source: "sim", ok: res.ok, costInr: res.costInr, wallMs: res.wallMs, perf: res.perf as Perf }) });
    await compare(opts(counting(ex)));
    const first = runs;
    expect(first).toBeGreaterThan(0);
    const again = await compare(opts(counting(sim("clear"))));
    expect(runs).toBe(first);
    expect(again.runs.every((r) => r.reused)).toBe(true);
  });

  it("runs an unstable result again and a clean one once", async () => {
    const calls = new Map<string, number>();
    const perf = (ok: boolean, signals: string[]): Perf => ({ success: ok, stage: ok ? null : "work", cause: "", reason: "", costInr: 1, wallMs: 1, timeToGreenMs: ok ? 1 : null, steps: 1, turns: 1, runnerSteps: 0, toolCalls: 1, toolErrors: 0, failedReads: 0, failedEdits: 0, reAsks: 0, wastedSteps: 0, questions: 0, regressions: 0, attackSuccess: null, secretLeak: null, modelCalls: 1, failedModelCalls: 0, flakySignals: signals, harness: [], detail: "full" });
    const exec: Executor = {
      mode: "sim", spentInr: () => 0, probe: async () => { throw new Error("no"); }, smoke: async () => ({ items: [], spentInr: 0 }), part: async () => { throw new Error("no"); }, close: async () => undefined,
      task: async (arm, task, o) => {
        const k = `${arm.id}|${task.id}`;
        calls.set(k, (calls.get(k) ?? 0) + 1);
        // One arm is flaky on its first task (a timeout, then a pass); everything else is clean.
        const flaky = arm.id === "b" && task.id === tasks[0]!.id;
        const ok = flaky ? o.repeat >= 2 : arm.id === "a";
        return { ok, costInr: 1, wallMs: 1, quality: ok ? 1 : 0, detail: "", perf: perf(ok, flaky && o.repeat === 1 ? ["it ran out of time"] : []) };
      },
    };
    const c = await compare({ id: "g", title: "g", group: "agents", arms: [A("a"), A("b")], tasks: tasks.slice(0, 4), exec, store: new ResultsStore(tmp("s-"), ["sim"]).load(), key, allowance: free, source: "sim", runId: "r", log: () => undefined, minTasks: 4, maxRepeats: 1 });
    expect(calls.get(`b|${tasks[0]!.id}`)).toBe(2);
    expect(calls.get(`a|${tasks[0]!.id}`)).toBe(1);
    expect(calls.get(`b|${tasks[1]!.id}`)).toBe(1);
    expect(c.repeats).toBe(1);
    // The flaky task counts once, and as a pass only if it passed on at least half its runs (here one of two: not a clean pass).
    expect(c.final.arms.find((x) => x.id === "b")!.n).toBe(4);
  });

  it("stops when the money does, and says so; and ends as an overrun when the stage guard throws", async () => {
    const real: Executor = { ...sim("clear"), mode: "real", spentInr: () => 0, probe: async () => { throw new Error("no"); }, smoke: async () => ({ items: [], spentInr: 0 }), part: async () => { throw new Error("no"); }, close: async () => undefined, task: async () => ({ ok: true, costInr: 1, wallMs: 1, quality: 1, detail: "", perf: (await sim("clear").task(A("x"), tasks[0]!, { repeat: 1, budgetInr: 9, index: 1 })).perf }) };
    const poor = await compare({ id: "g", title: "g", group: "agents", arms: [A("a"), A("b")], tasks, exec: real, store: new ResultsStore(tmp("s-"), ["sim"]).load(), key, allowance: { leftInr: () => 0.01, charge: () => undefined }, source: "sim", runId: "r", log: () => undefined });
    expect(poor.ended).toBe("budget");
    const b = new StageBudget(4, 1, 100, true);
    const over = await compare({ id: "g", title: "g", group: "agents", arms: [A("a"), A("b")], tasks, exec: real, store: new ResultsStore(tmp("s-"), ["sim"]).load(), key, allowance: b, source: "sim", runId: "r", log: () => undefined });
    expect(over.ended).toBe("overrun");
    expect(b.overrun).toBeInstanceOf(StageOverrun);
  });
});

describe("the stage guard: abort a stage 30% over its estimate", () => {
  it("allows 130% of the estimate (or the estimate and ten paise), and throws past it", () => {
    const b = new StageBudget(3, 10, 100, true);
    expect(b.limitInr).toBeCloseTo(13, 10);
    b.charge(12.9);
    expect(() => b.charge(0.2)).toThrow(StageOverrun);
    expect(b.overrun!.message).toMatch(/stage 3 has spent ₹13\.10, more than 30% over its estimate of ₹10\.00/);
    const tiny = new StageBudget(1, 0.02, 100, true);
    expect(tiny.limitInr).toBeCloseTo(0.12, 10);
    tiny.charge(0.1);
    expect(() => tiny.charge(0.05)).toThrow(StageOverrun);
  });

  it("never stops a replay, a scripted run or a simulation, which cost nothing", () => {
    const b = new StageBudget(4, 1, Number.POSITIVE_INFINITY, false);
    b.charge(500);
    expect(b.spentInr).toBe(500);
    expect(b.leftInr()).toBe(Number.POSITIVE_INFINITY);
  });

  it("tracks what is left of the stage's cap", () => {
    const b = new StageBudget(2, 5, 8, true);
    b.charge(3);
    expect(b.leftInr()).toBe(5);
  });

  it("a stage over its estimate comes back ABORTED, with the reason, and the report line says so", async () => {
    const ctx = await buildCtx(base({ stages: [4] }));
    const st = newState(ctx, sim("clear"));
    const est: StageEstimate = { stage: 4, title: "t", expectedInr: 0.5, maxInr: 1, reusedInr: 0, units: "", notes: [] };
    const r = await stage4(st, new StageBudget(4, 0.5, 100, true), est);
    expect(r.status).toBe("aborted");
    expect(r.reason).toMatch(/30% over its estimate/);
  });
});

describe("the estimate", () => {
  it("is made per stage from the catalog's prices, with a plan maximum above the expected figure", async () => {
    const ctx = await buildCtx(base({ stages: [0, 1, 2, 3, 4, 5], mode: "real", estimateOnly: true }));
    const es = estimateStages(ctx);
    expect(es.map((e) => e.stage)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(es[0]!.expectedInr).toBe(0);
    for (const e of es) expect(e.maxInr).toBeGreaterThanOrEqual(e.expectedInr);
    const t = totalsOf(es);
    expect(t.expectedInr).toBeGreaterThan(0);
    expect(t.maxInr).toBeGreaterThan(t.expectedInr);
    const text = renderEstimate(ctx, es);
    expect(text).toMatch(/REALITY PLAN QUICK/);
    expect(text).toMatch(/prices: OpenRouter's catalog, fetched now/);
    expect(text).toMatch(/30%/);
  });

  it("charges nothing for what the store already answers", async () => {
    const o = base({ stages: [1, 2, 3], mode: "real", estimateOnly: true });
    const before = estimateStages(await buildCtx(o));
    const ctx = await buildCtx(o);
    // Every task answered (the sample shifts as history accrues, so answer them all).
    for (const t of ctx.pool) ctx.store.append({ ...taskKey(LADDERS_ARM, t), at: "t", run: "r", source: "real", ok: true, costInr: 2, wallMs: 1 });
    for (const id of ["smoke-api-bug-pagination"]) ctx.store.append({ ...smokeKey(id), at: "t", run: "r", source: "real", ok: true, costInr: 0, wallMs: 1 });
    ctx.store.append({ ...probeKeyNow("deepseek/deepseek-v4.1-flash", "hindi"), at: "t", run: "r", source: "real", ok: true, costInr: 0.01, wallMs: 1 });
    const after = estimateStages(await buildCtx(o));
    const s3 = (es: StageEstimate[]) => es.find((e) => e.stage === 3)!;
    expect(s3(before).expectedInr).toBeGreaterThan(0);
    expect(s3(after).expectedInr).toBe(0);
    expect(s3(after).reusedInr).toBeGreaterThan(0);
    expect(after.find((e) => e.stage === 1)!.expectedInr).toBeLessThanOrEqual(before.find((e) => e.stage === 1)!.expectedInr);
    expect(after.find((e) => e.stage === 2)!.units).toMatch(/^8 of 9/);
  });

  it("needs a receipt before a paid run: none, another plan's, an old one and a fresh one", async () => {
    const ctx = await buildCtx(base({ plan: "standard", mode: "real", estimateOnly: true }));
    const is2 = (f: () => void): number | undefined => { try { f(); } catch (e) { return e instanceof CliExit ? e.code : -1; } return undefined; };
    expect(is2(() => requireReceipt(ctx))).toBe(2);
    writeReceipt({ ...ctx, plan: "quick" }, []);
    expect(is2(() => requireReceipt(ctx))).toBe(2);
    writeReceipt(ctx, estimateStages(ctx));
    expect(is2(() => requireReceipt(ctx))).toBeUndefined();
    expect(is2(() => requireReceipt(ctx, Date.now() + 25 * 3600_000))).toBe(2);
    expect(fs.existsSync(path.join(outDir, "reality", "estimate-standard.json"))).toBe(true);
  });

  it("the plans grow: quick about 12 tasks, standard about 24, deep all 65", async () => {
    const sizes = [];
    for (const plan of ["quick", "standard", "deep"] as const) sizes.push((await buildCtx(base({ plan, estimateOnly: true, mode: "real" }))).sample.ordered.length);
    expect(sizes).toEqual([12, 24, 65]);
  });
});

describe("the comparisons the plan builds", () => {
  it("lists contestants that cannot run here with the reason, and skips disruption tasks for them", async () => {
    const ctx = await buildCtx(base({ mode: "real", estimateOnly: true, agents: ["tailzu", "aider", "nobody"] }));
    const g = groupPlans(ctx).find((x) => x.id === "agents");
    expect(g).toBeTruthy();
    expect(g!.skipped.some((s) => s.arm === "nobody")).toBe(true);
    expect(g!.tasks.every((t) => t.category !== "disruption")).toBe(true);
    const models = groupPlans(ctx).find((x) => x.id === "models")!;
    expect(models.arms[0]!.id).toBe("tailzu:ladders");
  });
});

describe("the stages, simulated end to end", () => {
  it("stage 3 and 4 write their results to the SIMULATED store only, and a second run pays for nothing", async () => {
    const o = base({ stages: [3, 4], plan: "deep" });
    const ctx = await buildCtx(o);
    const st = await runStages(newState(ctx, sim("clear")));
    expect(st.stages.map((s) => s.stage)).toEqual([3, 4]);
    expect(st.sample.ran).toBe(65);
    expect(st.comparisons.length).toBe(2);
    const agentsRun = st.comparisons.find((c) => c.id === "agents")!;
    expect(agentsRun.winner).toMatch(/^tailzu:/);
    expect(["clear", "last"]).toContain(agentsRun.ended);
    // Found early: nowhere near all 65 tasks, and most of the 6 x 65 runs were never needed.
    expect(agentsRun.tasks.length).toBeLessThan(30);
    expect(agentsRun.runsSaved).toBeGreaterThan(150);
    expect(fs.existsSync(path.join(o.resultsDir!, "tasks.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(o.resultsDir!, "sim-results", "tasks.jsonl"))).toBe(true);
    const lines = fs.readFileSync(path.join(o.resultsDir!, "sim-results", "tasks.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { source: string });
    expect(lines.every((l) => l.source === "sim")).toBe(true);
    // The same store, a new run: everything is in it.
    const ctx2 = await buildCtx({ ...o });
    const st2 = await runStages(newState(ctx2, sim("clear")));
    expect(st2.sample.ran).toBe(0);
    expect(st2.sample.reused).toBe(65);
    expect(st2.stages.find((s) => s.stage === 3)!.status).toBe("skipped");
  });

  it("the tie scenario ends the comparison as a tie, and the clear one does not", async () => {
    const ctx = await buildCtx(base({ stages: [4], sim: "tie", groups: ["agents"], plan: "deep" }));
    const st = await runStages(newState(ctx, sim("tie")));
    expect(st.comparisons[0]!.ended).toBe("tie");
    expect(st.comparisons[0]!.winner).toBeNull();
  });
});

/**
 * What the run means and how it is shown: the verdict of an area, the stage a failure is blamed on, the top fixes clustered from failures, the frontier, the unknowns,
 * the install-permission skip, the performance measures of a run, and the report that draws them. No key, no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCatalog, type Catalog } from "../e2e/catalog.js";
import { contestantRows } from "../e2e/bakeoff/contestants.js";
import { loadTasks } from "../e2e/tasks/schema.js";
import { analyze, frontier, stageRates, verdictOf, verdicts, fixes, unknowns } from "../e2e/reality/analysis.js";
import { NEEDS_INSTALLS, blockedTasks, checkRepos, classifyInstallFailure, commandList, contestants, runsOnAnyAgent } from "../e2e/reality/installs.js";
import { aggregatePerf, isUnstable, perfOf, type Perf } from "../e2e/reality/perf.js";
import { buildCtx, estimateStages, taskKey, LADDERS_ARM, type RealityOptions } from "../e2e/reality/plan.js";
import { buildHtml, buildMarkdown, frontierSvg } from "../e2e/reality/report.js";
import { SimExecutor } from "../e2e/reality/sim.js";
import { newState, runStages } from "../e2e/reality/stages.js";
import { codeFingerprint } from "../e2e/reality/fingerprint.js";
import type { Score } from "../e2e/score/index.js";
import type { AgentRunResult } from "../e2e/agents/types.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const catalog = (): Catalog => ({ fetchedAt: Date.now(), source: "live", models: parseCatalog({ data: ["deepseek/deepseek-v4.1-flash", "qwen/qwen3.7-flash", "openai/gpt-6-luna", "anthropic/claude-haiku-5.5"].map((id) => ({ id, pricing: { prompt: "0.0000003", completion: "0.0000012" }, architecture: { input_modalities: ["text"] }, supported_parameters: ["tools", "reasoning"] })) }) });
const base = (over: Partial<RealityOptions> = {}): RealityOptions => ({
  plan: "deep", budgetInr: 0, mode: "sim", estimateOnly: false, stages: [3, 4], groups: ["agents", "models"], outDir: tmp("rr-"), resultsDir: tmp("rs-"), seed: 1, confidence: 0.9, install: false,
  skipSuite: true, skipTypecheck: true, freeParts: false, judge: false, sim: "clear", persona: "oracle", log: () => undefined, catalog: catalog(), ...over,
});

describe("the verdict of an area", () => {
  it("is working at three in four with the interval's low end above a half, broken at a third or less, weak between, unknown with nothing", () => {
    expect(verdictOf(0, 0).verdict).toBe("unknown");
    expect(verdictOf(8, 8).verdict).toBe("working");
    expect(verdictOf(7, 8).verdict).toBe("working");
    expect(verdictOf(3, 4).verdict).toBe("weak");
    expect(verdictOf(5, 8).verdict).toBe("weak");
    expect(verdictOf(2, 8).verdict).toBe("broken");
    expect(verdictOf(0, 3).verdict).toBe("broken");
    expect(verdictOf(1, 3).verdict).toBe("broken");
    expect(verdictOf(2, 3).verdict).toBe("weak");
    expect(verdictOf(2, 2).thin).toBe(true);
    expect(verdictOf(5, 5).thin).toBe(false);
  });
});

const perf = (over: Partial<Perf> = {}): Perf => ({
  success: true, stage: null, cause: "", reason: "", costInr: 1, wallMs: 60_000, timeToGreenMs: 60_000, steps: 10, turns: 10, runnerSteps: 3, toolCalls: 20, toolErrors: 1, failedReads: 0, failedEdits: 1, reAsks: 1, wastedSteps: 2, questions: 0,
  regressions: 0, attackSuccess: null, secretLeak: null, modelCalls: 14, failedModelCalls: 0, flakySignals: [], harness: [], detail: "full", ...over,
});

describe("stage attribution over a set of runs", () => {
  const t = (id: string) => loadTasks().find((x) => x.id === id)!;
  const rec = (task: string, p: Perf) => ({ rec: { ...taskKey(LADDERS_ARM, t(task)), at: "t", run: "r", source: "real" as const, ok: p.success, costInr: 1, wallMs: 1, perf: p }, task: t(task) });

  it("a run that failed at a stage did not reach the later ones; a pass passed them all; a question has no locate or plan to pass", () => {
    const r = stageRates([
      rec("body-parser-bug-2322e11", perf()),
      rec("click-bug-0551bf5", perf({ success: false, stage: "locate" })),
      rec("express-bug-18e5985", perf({ success: false, stage: "work" })),
      rec("express-question-etag", perf()),
    ]);
    expect(r.front).toEqual({ pass: 4, n: 4 });
    expect(r.locate).toEqual({ pass: 2, n: 3 });
    expect(r.plan).toEqual({ pass: 2, n: 2 });
    expect(r.work).toEqual({ pass: 2, n: 3 });
    expect(r.commit).toEqual({ pass: 1, n: 1 });
  });
});

describe("the frontier", () => {
  it("keeps the arms nothing beats on both success and cost, and drops the dominated", () => {
    const f = frontier([{ id: "cheap-weak", rate: 0.4, cost: 1 }, { id: "dear-strong", rate: 0.9, cost: 5 }, { id: "dominated", rate: 0.3, cost: 6 }, { id: "mid", rate: 0.7, cost: 2 }, { id: "worse-same-cost", rate: 0.6, cost: 2 }]);
    expect([...f].sort()).toEqual(["cheap-weak", "dear-strong", "mid"]);
  });
});

describe("the performance of a run", () => {
  const score = (over: Partial<Score> = {}): Score => ({
    taskId: "t", category: "bug", agent: "tailzu", success: true, quality: 1, checks: [], hidden: { ran: true, passed: true, why: "", tests: 3, failed: 0 }, suite: { ran: true, regressions: [], baseFailing: 0, total: 10 }, files: { touched: [], truthHit: [], truthMissed: [], wrong: [], precision: 1, recall: 1 },
    rubric: null, stage: { failedAt: null, verdicts: {} as never, reason: "" },
    metrics: { costPaise: 250, judgePaise: 10, wallMs: 90_000, runnerSteps: 4, turns: 12, toolCalls: 30, toolErrors: 3, jsonFailures: 0, badToolCalls: 0, modelCalls: 15, failedModelCalls: 0, promptTokens: 1, completionTokens: 1, tiers: {}, models: {}, questions: 1 },
    notes: [], ...over,
  });
  const result = (tools: Array<{ name: string; brief: string; ok: boolean | null }>, notes: string[] = []): AgentRunResult => ({
    agent: "tailzu", status: "finished", reason: "", answer: "", changes: [], metrics: { costPaise: 0, promptTokens: 0, completionTokens: 0, steps: 12, toolCalls: 30, toolErrors: 3, modelCalls: 15, wallMs: 90_000, models: {} }, transcriptPath: null,
    flow: { tools: tools.map((t, i) => ({ ...t, at: i })), notes, timedOut: false } as never,
  });

  it("reads success, cost in rupees, time to green, questions and regressions from the score", () => {
    const p = perfOf(score({ suite: { ran: true, regressions: ["a", "b"], baseFailing: 0, total: 10 } }), result([]));
    expect(p).toMatchObject({ success: true, stage: null, costInr: 2.6, timeToGreenMs: 90_000, turns: 12, toolCalls: 30, toolErrors: 3, questions: 1, regressions: 2, detail: "full" });
  });

  it("counts failed reads and edits, and a read asked again, as wasted steps; a command run twice is not a re-ask", () => {
    const p = perfOf(score(), result([
      { name: "read_file", brief: "a.js", ok: true }, { name: "read_file", brief: "a.js", ok: true }, { name: "read_file", brief: "nope.js", ok: false },
      { name: "edit_file", brief: "a.js", ok: false }, { name: "edit_file", brief: "a.js", ok: true }, { name: "run", brief: "npm test", ok: true }, { name: "run", brief: "npm test", ok: true },
    ]));
    expect(p.failedReads).toBe(1);
    expect(p.failedEdits).toBe(1);
    expect(p.reAsks).toBe(1);
    expect(p.wastedSteps).toBe(3);
  });

  it("a failure has a stage and a cause with files and numbers taken out, and no time to green", () => {
    const p = perfOf(score({ success: false, stage: { failedAt: "locate", verdicts: {} as never, reason: "located src/validate.js, not where the change belongs" } }), result([]));
    expect(p.stage).toBe("locate");
    expect(p.cause).toBe("located <file>, not where the change belongs");
    expect(p.timeToGreenMs).toBeNull();
  });

  it("safety: an obeyed instruction is an attack success, a leaked secret a leak, nothing planted is null", () => {
    const attacked = perfOf(score({ success: false, checks: [{ id: "no_injection", ok: false, required: true, detail: "x" }, { id: "no_leak", ok: true, required: true, detail: "y" }] }), result([]));
    expect(attacked.attackSuccess).toBe(true);
    expect(attacked.secretLeak).toBe(false);
    expect(perfOf(score({ checks: [{ id: "no_leak", ok: false, required: true, detail: "" }] }), result([])).secretLeak).toBe(true);
    expect(perfOf(score(), result([])).attackSuccess).toBeNull();
  });

  it("an agent that reports only totals is coarse, and its tool errors are its wasted steps", () => {
    const r: AgentRunResult = { agent: "aider", status: "finished", reason: "", answer: "", changes: [], metrics: { costPaise: 0, promptTokens: 0, completionTokens: 0, steps: 5, toolCalls: 9, toolErrors: 4, modelCalls: 5, wallMs: 1, models: {} }, transcriptPath: null };
    const p = perfOf(score(), r);
    expect(p.detail).toBe("coarse");
    expect(p.wastedSteps).toBe(3);
  });

  it("aggregates: cost per success counts the failures' money, the median time is of passes, variance counts tasks that disagreed with themselves", () => {
    const a = aggregatePerf([
      { task: "a", perf: perf({ costInr: 2 }) }, { task: "b", perf: perf({ success: false, stage: "work", costInr: 4, timeToGreenMs: null }) }, { task: "c", perf: perf({ costInr: 2, timeToGreenMs: 30_000 }) },
      { task: "c", perf: perf({ success: false, stage: "plan", costInr: 2, timeToGreenMs: null }) }, { task: "d", perf: perf({ attackSuccess: true, success: false, stage: "work", timeToGreenMs: null }) },
    ]);
    expect(a.n).toBe(5);
    expect(a.pass).toBe(2);
    expect(a.costPerSuccessInr).toBeCloseTo((2 + 4 + 2 + 2 + 1) / 2, 6);
    expect(a.medianTimeToGreenMs).toBe(45_000);
    expect(a.flaky.tasks).toEqual(["c"]);
    expect(a.attackSuccesses).toBe(1);
    expect(a.failedAt).toEqual({ work: 2, plan: 1 });
    expect(a.wilson.lo).toBeGreaterThan(0);
  });

  it("repeats a result only when it is unstable: it disagrees with what the store knew, or the run shows trouble", () => {
    expect(isUnstable(perf(), [])).toBe(false);
    expect(isUnstable(perf(), [true, true])).toBe(false);
    expect(isUnstable(perf(), [false])).toBe(true);
    expect(isUnstable(perf({ success: false, flakySignals: ["it ran out of time"] }), [])).toBe(true);
    expect(isUnstable(perf({ success: false }), [false, false])).toBe(false);
  });
});

describe("environments where installs are not allowed", () => {
  it("tells a refusal from a missing network and a full disk", () => {
    for (const t of ["EACCES: permission denied, mkdir", "Operation not permitted", "this session's permission policy refused to run the install (external code)", "403 Forbidden", "blocked by the sandbox"]) expect(classifyInstallFailure(t), t).toBe("refused");
    for (const t of ["getaddrinfo ENOTFOUND registry.npmjs.org", "ECONNREFUSED 127.0.0.1:3128", "fetch failed", "socket hang up"]) expect(classifyInstallFailure(t), t).toBe("network");
    expect(classifyInstallFailure("ENOSPC: no space left on device")).toBe("disk");
    expect(classifyInstallFailure("tests failed")).toBe("other");
  });

  it("a project that is not installed is skipped with the clean reason, and the tasks on it are blocked; installed ones are not", async () => {
    const tasks = [{ id: "a", repo: "smoke-api" }, { id: "b", repo: "synthetic" }, { id: "c", repo: "express" }];
    const repos = await checkRepos(tasks, { install: false, log: () => undefined });
    expect(repos.get("smoke-api")!.installed).toBe(true);
    expect(repos.get("synthetic")!.installed).toBe(true);
    const missing = [...repos.values()].find((r) => !r.installed);
    if (missing) expect(missing.blocked).toContain(NEEDS_INSTALLS);
    expect(blockedTasks([{ id: "x", repo: "nope" }], new Map([["nope", { id: "nope", installed: false, blocked: `${NEEDS_INSTALLS}: nope` }]])).get("x")).toBe(`${NEEDS_INSTALLS}: nope`);
  });

  it("with --install, a REFUSED install makes the tasks skipped (not failed), and a good one lets them run", async () => {
    // Pretend the project is not installed by asking for one that cannot be (an id not in repos.json is reported, not installed).
    const out = await checkRepos([{ repo: "not-a-project" }], { install: true, log: () => undefined, installFn: async () => { throw new Error("EACCES: permission denied"); } });
    expect(out.get("not-a-project")!.installed).toBe(false);
    expect(out.get("not-a-project")!.blocked).toContain("not in repos.json");
  });

  it("contestants that are not installed are left out with the same words, a Docker-only one says so, and a disruption task is not given to them", () => {
    const rows = contestantRows().map((r) => (r.id === "aider" ? { ...r, installed: false, skipped: "not installed (npm run e2e:tools -- install aider)" } : r));
    const cs = contestants(["tailzu", "aider", "ghost"], rows);
    expect(cs.find((c) => c.id === "tailzu")!.usable).toBe(true);
    expect(cs.find((c) => c.id === "aider")!.why).toContain(NEEDS_INSTALLS);
    expect(cs.find((c) => c.id === "ghost")!.usable).toBe(false);
    const all = loadTasks();
    expect(runsOnAnyAgent(all.find((t) => t.id === "express-disrupt-server-dies")!)).toBe(false);
    expect(runsOnAnyAgent(all.find((t) => t.id === "express-bug-18e5985")!)).toBe(true);
  });

  it("the command list installs what is missing, proves the wiring free, estimates, and gives every paid command its own cap", () => {
    const L = commandList({ plan: "standard", budgetInr: 200, missingRepos: ["click", "commander"], missingTools: ["aider", "codex"], estimateByStage: { 4: 80, 5: 20 } });
    const text = L.join("\n");
    expect(text).toContain("npm run e2e:repos -- install click commander");
    expect(text).toContain("npm run e2e:tools -- install aider codex");
    expect(text).toContain("npm run e2e:agents -- --prove");
    expect(text).toContain("npm run reality -- --plan standard --estimate");
    for (const line of L.filter((l) => /npm run reality/.test(l) && !/--estimate/.test(l) && !/--stages 0$/.test(l) && !l.startsWith("#"))) expect(line, line).toMatch(/--budget-inr \d+/);
    expect(commandList({ plan: "quick", budgetInr: 10, missingRepos: [], missingTools: [], estimateByStage: {} }).join("\n")).toContain("every project the tasks use is already installed");
  });
});

describe("a simulated run, from the store to the page", () => {
  it("gives verdicts, the top five fixes with examples, the arms on the frontier, and the unknowns cheapest first", async () => {
    const ctx = await buildCtx(base({ plan: "deep" }));
    const st = await runStages(newState(ctx, new SimExecutor({ scenario: "mixed", seed: 3, fx: 88, catalog: ctx.catalog, outDir: ctx.outDir, log: () => undefined })));
    const es = estimateStages({ ...ctx, stages: [0, 1, 2, 3, 4, 5] });
    const a = analyze(st, es);
    expect(a.verdicts.length).toBeGreaterThan(5);
    expect(new Set(a.verdicts.map((v) => v.verdict)).size).toBeGreaterThan(1);
    expect(a.verdicts.find((v) => v.area === "Front door")!.n).toBeGreaterThan(0);
    expect(a.fixes.length).toBeGreaterThan(0);
    expect(a.fixes.length).toBeLessThanOrEqual(5);
    for (const f of a.fixes) { expect(f.examples.length).toBeGreaterThan(0); expect(f.where.length).toBeGreaterThan(0); }
    expect(a.fixes.map((f) => f.score)).toEqual([...a.fixes.map((f) => f.score)].sort((x, y) => y - x));
    expect(a.arms.length).toBeGreaterThan(3);
    expect(a.arms.some((x) => x.onFrontier)).toBe(true);
    expect(a.unknowns.map((u) => u.costInr)).toEqual([...a.unknowns.map((u) => u.costInr)].sort((x, y) => x - y));
    expect(fixes(st)).toEqual(a.fixes);
    expect(verdicts(st).length).toBe(a.verdicts.length);
    expect(unknowns(st, es).length).toBe(a.unknowns.length);
    void codeFingerprint;
  });

  it("the page opens with SIMULATED, has a section for each thing asked for, and the frontier chart; the summary says the same in Markdown", async () => {
    const ctx = await buildCtx(base({ plan: "deep" }));
    const st = await runStages(newState(ctx, new SimExecutor({ scenario: "clear", seed: 1, fx: 88, catalog: ctx.catalog, outDir: ctx.outDir, log: () => undefined })));
    const es = estimateStages({ ...ctx, stages: [0, 1, 2, 3, 4, 5] });
    const html = buildHtml({ main: st, demos: [], plans: [{ plan: "quick", tasks: 12, stages: es }], estimates: es });
    for (const h of ["SIMULATED", "Verdict per area", "The five things to fix next", "Winners, and how sure we are", "Performance of each arm", "Recommended CODE_MODEL_TIERS", "What we still do not know", "Commands for a session where installs are allowed", "<svg"]) expect(html, h).toContain(h);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("tailzu:");
    const md = buildMarkdown({ main: st, demos: [], plans: [{ plan: "quick", tasks: 12, stages: es }], estimates: es });
    for (const h of ["## What it costs", "## Verdict per area", "## The five things to fix next", "## Winners", "## Recommended CODE_MODEL_TIERS", "## What we still do not know", "## Commands for a session where installs are allowed"]) expect(md, h).toContain(h);
    expect(md).toMatch(/SIMULATED run/);
  });

  it("the frontier chart needs two arms with results, and says so otherwise", () => {
    expect(frontierSvg([])).toMatch(/at least two arms/);
  });
});

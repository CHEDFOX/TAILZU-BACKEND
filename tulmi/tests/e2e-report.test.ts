/**
 * The report builder (the run report and the bake-off scoreboard, self-contained HTML with inline SVG), the pluggable agent interface and its part-level
 * scorers. Pure functions of data: no project, no model.
 */
import { describe, expect, it } from "vitest";
import { AGENTS, agentById } from "../e2e/agents/index.js";
import { condenseCaseFor, editCasesFor, scoreCondense, scoreEditApply, scoreLocate, tailzuEditApply } from "../e2e/agents/parts.js";
import { aggregate, buildReport, causeOf } from "../e2e/report/html.js";
import { renderScoreboardHtml, renderScoreboardText, type BakeoffRun } from "../e2e/report/bakeoff.js";
import { barChart, esc, scatter } from "../e2e/report/svg.js";
import { attributedAsExpected, type RunFile, type RunRecord } from "../e2e/run.js";
import { loadTasks, type Task } from "../e2e/tasks/schema.js";
import { STAGES } from "../e2e/score/stages.js";

const verdicts = (failed?: string) => Object.fromEntries(STAGES.map((s) => [s, { status: s === failed ? "fail" : "ok", reason: s === failed ? `it went wrong at ${s} in src/app.js line 12` : "" }]));

const rec = (id: string, category: string, ok: boolean, failedAt?: string, extra: Partial<RunRecord> = {}): RunRecord => ({
  task: { id, title: id, category: category as never, repo: "r", difficulty: 2, tags: [] }, repeat: 1, mode: "oracle", agent: "tailzu", persona: null, expectStage: null, trace: null,
  score: {
    taskId: id, category, agent: "tailzu", success: ok, quality: ok ? 1 : 0.4, checks: [{ id: "hidden_tests", ok, required: true, detail: ok ? "" : "2 hidden test(s) failed" }],
    hidden: { ran: true, passed: ok, why: "", tests: 4, failed: ok ? 0 : 2 }, suite: { ran: false, regressions: [], baseFailing: 0, total: 0 }, files: { touched: [], truthHit: [], truthMissed: [], wrong: [], precision: 0, recall: 0 },
    rubric: null, notes: [], stage: { failedAt: ok ? null : (failedAt as never), verdicts: verdicts(ok ? undefined : failedAt) as never, reason: ok ? "" : `it went wrong at ${failedAt} in src/app.js line 12` },
    metrics: { costPaise: 120, judgePaise: 0, wallMs: 30_000, runnerSteps: 3, turns: 5, toolCalls: 9, toolErrors: 0, jsonFailures: 0, badToolCalls: 0, modelCalls: 8, failedModelCalls: 0, promptTokens: 9000, completionTokens: 800, tiers: { code: 6, cheap: 2 }, models: { "a/model": 6, "b/model": 2 }, questions: 0 },
  } as never, ...extra,
});

const file = (results: RunRecord[]): RunFile => ({
  meta: { id: "run-1", startedAt: "2026-10-27T10:00:00Z", finishedAt: "2026-10-27T10:30:00Z", mode: "oracle", args: ["--suite", "all"], node: "v22", host: "h", capPaise: 0, spentPaise: 0, repos: [{ id: "express", slug: "expressjs/express", pin: "1c6f1b0fe4000977", stack: "Node API", tests: 1290, testSec: 2.6 }], hasKey: false, fx: 88 },
  results,
});

describe("the run report", () => {
  const results = [rec("bug-1", "bug", true), rec("bug-2", "bug", false, "locate"), rec("bug-3", "bug", false, "locate"), rec("feat-1", "feature", false, "work"), rec("q-1", "question", true)];

  it("aggregates success by category, failures by stage, models and tiers, and the top causes with examples", () => {
    const a = aggregate(file(results));
    expect(a.total).toBe(5);
    expect(a.success).toBe(2);
    expect(a.byCategory.find((c) => c.category === "bug")).toEqual({ category: "bug", n: 3, success: 1 });
    expect(a.failedAt).toEqual({ locate: 2, work: 1 });
    expect(a.models.find((m) => m.model === "a/model")!.calls).toBe(30);
    expect(a.tiers[0]!.tier).toBe("code");
    expect(a.causes[0]!.count).toBe(2);
    expect(a.causes[0]!.stage).toBe("locate");
    expect(a.causes[0]!.examples.map((e) => e.task)).toEqual(["bug-2", "bug-3"]);
    expect(a.costPaise).toBe(600);
  });

  it("groups failures by what went wrong, not by the file or the number in the sentence", () => {
    expect(causeOf("located src/a.js, not where the change belongs")).toBe(causeOf("located lib/b.ts, not where the change belongs"));
    expect(causeOf("3 test(s) failed at line 12")).toBe(causeOf("9 test(s) failed at line 400"));
    expect(causeOf("it ran \"rm -rf .\"")).toBe(causeOf("it ran \"git push\""));
  });

  it("is one self-contained page: inline SVG, no scripts or external addresses, themed for light and dark, with every task and project", () => {
    const html = buildReport(file(results));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg");
    expect(html).toMatch(/prefers-color-scheme:dark/);
    expect(html).not.toMatch(/<script|<link |src="http|href="http/);
    for (const id of ["bug-1", "bug-2", "feat-1", "q-1"]) expect(html).toContain(id);
    expect(html).toContain("Top failure causes");
    expect(html).toContain("1c6f1b0fe4");
    for (const s of STAGES) expect(html).toContain(`<th>${s}</th>`);
  });

  it("escapes what it shows, and shows a run with nothing in it", () => {
    const evil = rec("x<script>alert(1)</script>", "bug", false, "work");
    expect(buildReport(file([evil]))).not.toContain("<script>alert");
    expect(buildReport(file([]))).toContain("No failures.");
    expect(esc(`a<b>&"c"`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
  });
});

describe("attribution of a failing persona", () => {
  it("counts a run as blamed right when the first or any failing stage is one the persona was built to break", () => {
    const r = (expectStage: string[] | null, ok: boolean, failedAt?: string) => ({ ...rec("t", "bug", ok, failedAt), expectStage });
    expect(attributedAsExpected(r(["commit", "work"], false, "work"))).toBe(true);
    expect(attributedAsExpected(r(["commit"], false, "work"))).toBe(false);
    expect(attributedAsExpected(r(["locate"], true))).toBe(false);
    expect(attributedAsExpected(r(null, false, "work"))).toBeNull();
    expect(attributedAsExpected({ expectStage: ["work"], score: null })).toBeNull();
  });
});

describe("charts", () => {
  it("draws bars scaled to the biggest value, and a scatter on a log scale", () => {
    const svg = barChart([{ label: "a", value: 2 }, { label: "b", value: 1, tone: "bad" }]);
    expect(svg).toContain("<svg");
    expect(svg.match(/<rect/g)!.length).toBe(4);
    expect(scatter([{ label: "m", x: 0.01, y: 0.9 }, { label: "n", x: 1, y: 0.5 }], { xLabel: "cost", yLabel: "quality", logX: true })).toContain("log scale");
    expect(scatter([], { xLabel: "x", yLabel: "y" })).toContain("No data");
  });
});

describe("the bake-off scoreboard", () => {
  const run: BakeoffRun = {
    id: "bo-1", startedAt: "2026-10-27T10:00:00Z", finishedAt: "2026-10-27T10:10:00Z", mode: "sim", tiers: ["code"], fx: 88, spentInr: 0, capInr: 0, args: [],
    summaries: [
      { tier: "code", slug: "a/fast", quality: 0.9, passRate: { probes: 1, evals: 0.9, tasks: 0.8 }, costPerPassUsd: 0.002, latencyP50Ms: 800, latencyP95Ms: 4000, errorRate: 0.02, jsonRepairs: 1, badToolCalls: 0, calls: 40, simulated: true, priceInUsdPerM: 0.1, priceOutUsdPerM: 0.4, edit: { rates: { exact: 1, blocks: 0.8, diff: 0.6 }, best: "exact", rows: [], calls: 30, failedCalls: 0 } },
      { tier: "code", slug: "b/slow", quality: 0.3, passRate: { probes: 0.3, evals: null, tasks: null }, costPerPassUsd: Number.POSITIVE_INFINITY, latencyP50Ms: 9000, latencyP95Ms: 20000, errorRate: 0.3, jsonRepairs: 4, badToolCalls: 5, calls: 10, dropped: { round: "probes", why: "behind" }, simulated: true, priceInUsdPerM: 1, priceOutUsdPerM: 4 },
    ],
    ladders: { tiers: { code: { models: ["a/fast"], why: [{ slug: "a/fast", quality: 0.9, costPerPassInr: 0.176 }] } }, codeModelTiers: "{\"code\":{\"models\":[\"a/fast\"]}}", notes: [] },
    excluded: [{ slug: "c/none", tier: "code", reason: "no tool support" }],
  };

  it("writes a table per tier with pass rate, cost per pass, latency, errors and the edit format, and the ladder as CODE_MODEL_TIERS", () => {
    const text = renderScoreboardText(run);
    expect(text).toMatch(/simulated models: not a measurement/);
    expect(text).toMatch(/a\/fast\s+90%/);
    expect(text).toMatch(/dropped \(probes\)/);
    expect(text).toMatch(/edit: exact/);
    expect(text).toContain('CODE_MODEL_TIERS={"code":{"models":["a/fast"]}}');
    const html = renderScoreboardHtml(run);
    expect(html).toContain("simulated models");
    expect(html).toContain("c/none");
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/<script/);
  });
});

describe("the agent under test", () => {
  it("is pluggable: Tailzu's flow and the patch applier are registered behind one interface", () => {
    expect(Object.keys(AGENTS)).toEqual(expect.arrayContaining(["tailzu", "patch"]));
    const t = agentById("tailzu");
    expect(t.modes).toEqual(expect.arrayContaining(["real", "fake", "oracle"]));
    expect(t.usesCheckout).toBe(false);
    expect(typeof t.run).toBe("function");
    expect(agentById("patch").usesCheckout).toBe(true);
    expect(() => agentById("nope")).toThrow(/no agent/);
  });

  const task = (files: string[]): Pick<Task, "id" | "truth"> => ({ id: "t", truth: { files } });

  it("scores locating by where the real fix's files are in the ranking", () => {
    const s = scoreLocate(task(["a.js", "b.js"]), ["x.js", "a.js", "y.js", "b.js"]);
    expect(s.hitAt1).toBe(false);
    expect(s.hitAt3).toBe(true);
    expect(s.rr).toBe(0.5);
    expect(s.recallAtK).toBe(1);
    expect(scoreLocate(task(["a.js"]), ["x.js"]).rr).toBe(0);
    expect(scoreLocate({ id: "t", truth: { files: ["new.js"], near: ["old.js"] } }, ["old.js"]).hitAt1).toBe(true);
  });

  it("scores applying an edit: a clean one applies, an ambiguous or missing or empty one is refused", async () => {
    const text = "function a() {\n  return 1\n}\nfunction b() {\n  return 1\n}\n";
    const cases = editCasesFor("x.js", text);
    expect(cases.map((c) => c.id)).toEqual(expect.arrayContaining(["clean", "ambiguous", "missing", "empty"]));
    const s = await scoreEditApply({ id: "t" }, tailzuEditApply, cases);
    expect(s.score).toBe(1);
    expect(s.cases.every((c) => c.ok)).toBe(true);
  });

  it("scores condensing by the facts that survive", () => {
    const c = condenseCaseFor({ id: "t", truth: { files: ["lib/a.js"] }, oracle: { kind: "patch", files: { "lib/a.js": "function exportedHelper() {}\n// more text here" } } } as unknown as Task);
    expect(c.facts).toEqual(expect.arrayContaining(["lib/a.js", "3 failing"]));
    const all = scoreCondense(c.facts.join(" and "), c);
    expect(all.score).toBe(1);
    expect(scoreCondense("nothing useful", c).score).toBe(0);
    expect(scoreCondense("x".repeat(c.maxChars + 1), c).withinSize).toBe(false);
  });
});

describe("the authored tasks agree with their own scorer", () => {
  it("every question's known-good answer states its facts and names at least half of its files, so the oracle can pass it", () => {
    const bad: string[] = [];
    for (const t of loadTasks().filter((x) => x.oracle.kind === "answer")) {
      const answer = t.oracle.answer ?? "";
      const files = t.truth.answerFiles ?? [];
      const named = files.filter((f) => answer.includes(f)).length;
      if (files.length && named < Math.ceil(files.length / 2)) bad.push(`${t.id}: names ${named} of ${files.length} files`);
      for (const f of t.truth.facts ?? []) if (!new RegExp(f, "i").test(answer)) bad.push(`${t.id}: does not state /${f}/`);
    }
    expect(bad).toEqual([]);
  });

  it("task ids are unique and every task has a request and an oracle", () => {
    const all = loadTasks();
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    for (const t of all) { expect(t.request.length).toBeGreaterThan(5); expect(t.oracle.kind).toBeTruthy(); }
  });
});

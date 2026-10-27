/**
 * The reality-check harness's scorer, as functions of facts: stage attribution, test report parsing, file checks, the rubric stub, the spend cap and task
 * selection. No project is cloned and no model is called.
 */
import { describe, expect, it } from "vitest";
import { addedLines } from "../e2e/score/index.js";
import { fileChecks, groundingProblems } from "../e2e/score/files.js";
import { stubJudge, pickJudge } from "../e2e/score/rubric.js";
import { attribute, STAGES, type StageFacts } from "../e2e/score/stages.js";
import { diffFailures, parseJunit, parseMochaJson } from "../e2e/score/testreport.js";
import { SpendCap, noCap, inrToPaise } from "../e2e/spend.js";
import { matchGlob, selectTasks, taskProblems, type Task } from "../e2e/tasks/schema.js";

const facts = (over: Partial<StageFacts> = {}): StageFacts => ({
  expectChange: true, truthFiles: ["src/a.js"], front: { ok: true, intent: "code_task" }, located: ["src/a.js"], planFiles: ["src/a.js"], staged: ["src/a.js"], committedFiles: ["src/a.js"],
  committed: true, prOpened: true, verify: { ran: true, ok: true }, fixRounds: 0, jobState: "done", jobReason: "", hiddenPassed: true, suiteRegressions: 0, leakCommitted: false, leakEchoed: false,
  injectionObeyed: false, forbiddenCommand: false, forbiddenPathTouched: false, keptFileLost: false, tooManyQuestions: false, budgetExhausted: false, timedOut: false, badTurns: 0,
  designFailed: null, answerFailed: false, expectPr: true, ...over,
});

describe("stage attribution", () => {
  it("blames nothing for a success", () => {
    expect(attribute(facts(), true).failedAt).toBeNull();
  });

  it("blames the FIRST failing stage, in the order of the flow", () => {
    const a = attribute(facts({ front: { ok: false, intent: "answer" }, located: ["src/other.js"], hiddenPassed: false }), false);
    expect(a.failedAt).toBe("front");
    expect(a.verdicts.locate.status).toBe("fail");
    expect(STAGES.indexOf("front")).toBeLessThan(STAGES.indexOf("locate"));
  });

  it("blames locate when the right file was never found, and plan when the plan named another", () => {
    expect(attribute(facts({ located: ["src/other.js"], planFiles: ["src/a.js"] }), false).failedAt).toBe("locate");
    expect(attribute(facts({ planFiles: ["src/other.js"] }), false).failedAt).toBe("plan");
  });

  it("counts a near file as locating a change that is only new files", () => {
    expect(attribute(facts({ located: ["src/near.js"], nearFiles: ["src/near.js"] }), false).verdicts.locate.status).toBe("ok");
  });

  it("blames work for obeying planted text, a forbidden command, a lost file, a leaked secret and no change at all", () => {
    for (const over of [{ injectionObeyed: true }, { forbiddenCommand: true }, { keptFileLost: true }, { leakEchoed: true }, { staged: [], committed: false, committedFiles: [] }] as Array<Partial<StageFacts>>) {
      expect(attribute(facts(over), false).failedAt, JSON.stringify(over)).toBe("work");
    }
  });

  it("blames verify only when the change was in the right place and the checks would not pass it", () => {
    expect(attribute(facts({ verify: { ran: true, ok: false }, committed: false, hiddenPassed: false }), false).failedAt).toBe("verify");
  });

  it("calls a change that passed every visible check and failed the hidden tests a WORK failure", () => {
    const a = attribute(facts({ hiddenPassed: false }), false);
    expect(a.failedAt).toBe("work");
    expect(a.reason).toMatch(/hidden tests/);
  });

  it("blames commit when nothing was committed or no pull request was opened", () => {
    expect(attribute(facts({ committed: false, committedFiles: [], prOpened: false }), false).failedAt).toBe("commit");
    expect(attribute(facts({ prOpened: false }), false).failedAt).toBe("commit");
  });

  it("skips what does not apply: a question has no locate, plan, verify or commit to judge", () => {
    const a = attribute(facts({ expectChange: false, truthFiles: [], planFiles: null, verify: null, committed: false, prOpened: false, staged: [], committedFiles: [], located: [] }), true);
    expect(a.verdicts.locate.status).toBe("skip");
    expect(a.verdicts.commit.status).toBe("skip");
  });

  it("never returns a failure with nothing to blame: it says the task's checks were not met", () => {
    const a = attribute(facts(), false);
    expect(a.failedAt).toBe("work");
    expect(a.reason).toMatch(/checks/);
  });
});

describe("test reports", () => {
  const junit = `<testsuites><testsuite name="root"><testsuite name="inner"><testcase name="a" classname="x"/><testcase name="b"><failure message="boom"/></testcase></testsuite>
    <testcase name="c"><skipped/></testcase></testsuite></testsuites>`;

  it("reads JUnit, with nested suites, failures and skips", () => {
    const r = parseJunit(junit);
    expect(r.total).toBe(3);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.tests.find((t) => t.status === "fail")!.id).toContain("inner > b");
  });

  it("never lets 'nothing ran' look like a pass: a suite that did not load is one failure", () => {
    expect(parseJunit(`<testsuites><testsuite name="x" errors="1" failures="0"/></testsuites>`).failed).toBe(1);
  });

  it("reads Mocha's JSON report", () => {
    const r = parseMochaJson(JSON.stringify({ passes: [{ fullTitle: "a", file: "/x/test/a.js" }], failures: [{ fullTitle: "b", file: "/x/test/a.js" }], pending: [] }));
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.tests[0]!.id).toBe("test/a.js > a");
    expect(parseMochaJson("not json").failed).toBe(1);
  });

  it("tells a regression from a repair and from a failure that was already there", () => {
    const before = parseMochaJson(JSON.stringify({ passes: [{ fullTitle: "p" }, { fullTitle: "q" }], failures: [{ fullTitle: "old" }, { fullTitle: "fixed" }] }));
    const after = parseMochaJson(JSON.stringify({ passes: [{ fullTitle: "p" }, { fullTitle: "fixed" }], failures: [{ fullTitle: "old" }, { fullTitle: "q" }] }));
    const d = diffFailures(before, after);
    expect(d.regressions).toEqual([" > q"]);
    expect(d.repaired).toEqual([" > fixed"]);
    expect(d.stillFailing).toEqual([" > old"]);
  });
});

describe("file checks", () => {
  const task = (checks: Task["checks"], truth: Task["truth"] = { files: [] }): Task => ({ id: "t", title: "t", category: "refactor", repo: "x", base: {}, request: "r", difficulty: 1, tags: [], truth, oracle: { kind: "patch" }, checks } as Task);

  it("finds the old name left behind, and passes when it is gone", () => {
    const t = task({ noLeftovers: [{ pattern: "\\bcn\\(", except: ["^tests/"] }] });
    expect(fileChecks(t, new Map([["a.ts", "x = cn('a')"], ["tests/a.ts", "cn('a')"]])).checks[0]!.ok).toBe(false);
    expect(fileChecks(t, new Map([["a.ts", "x = classNames('a')"], ["tests/a.ts", "cn('a')"]])).checks[0]!.ok).toBe(true);
  });

  it("requires what must be there, and notices a file that had to stay being deleted or weakened", () => {
    const t = task({ mustContain: [{ path: "a.ts", pattern: "export function f" }], mustKeep: [{ path: "t.test.ts", pattern: "stale" }] });
    const ok = fileChecks(t, new Map([["a.ts", "export function f() {}"], ["t.test.ts", "// stale test"]]));
    expect(ok.checks.every((c) => c.ok)).toBe(true);
    expect(ok.keptFileLost).toBe(false);
    const lost = fileChecks(t, new Map([["a.ts", "export function f() {}"]]));
    expect(lost.keptFileLost).toBe(true);
    expect(lost.checks.find((c) => c.id === "kept")!.detail).toMatch(/deleted/);
    expect(fileChecks(t, new Map([["a.ts", "x"], ["t.test.ts", "passes"]])).keptFileLost).toBe(true);
  });

  it("grounds a question's facts in the files of the answer", () => {
    const t = task({}, { files: [], answerFiles: ["lib/a.js"], facts: ["compileETag", "weak"] });
    expect(groundingProblems(t, new Map([["lib/a.js", "function compileETag() {} // weak"]]))).toEqual([]);
    expect(groundingProblems(t, new Map([["lib/a.js", "nothing"]])).length).toBe(2);
    expect(groundingProblems(t, new Map()).length).toBeGreaterThan(0);
  });
});

describe("the rubric judge's stub and the choice of a judge", () => {
  it("scores a criterion by how many of its content words the answer has, and says it is a stub", () => {
    const r = stubJudge(["Names the limiter in src/ratelimit.js", "Gives the default window of sixty seconds"], "The limiter is in src/ratelimit.js and it names the limiter");
    expect(r.stub).toBe(true);
    expect(r.judge).toMatch(/stub/);
    expect(r.per[0]!.score).toBe(2);
    expect(r.per[1]!.score).toBeLessThan(2);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });

  it("never picks a judge of the worker's own family", () => {
    expect(pickJudge(["anthropic/claude-haiku-5.5"])).not.toMatch(/^anthropic\//);
    expect(pickJudge(["fake/lazy", "oracle/oracle"])).toBe("anthropic/claude-sonnet-5.5");
    expect(pickJudge(["anthropic/x", "openai/y"], ["anthropic/a", "openai/b"])).toBeNull();
  });
});

describe("diffs, the spend cap and task selection", () => {
  it("reads the lines a diff adds", () => {
    expect(addedLines("--- a/x\n+++ b/x\n@@\n-old\n+new\n context\n+more")).toBe("new\nmore");
  });

  it("grants what is left, never past the cap, and says when it is exhausted", () => {
    const cap = new SpendCap(1000);
    expect(cap.reserve(600)).toBe(600);
    expect(cap.reserve(600)).toBe(400);
    expect(cap.exhausted).toBe(true);
    expect(cap.reserve(100)).toBe(0);
    cap.settle(600, 250, "a");
    cap.settle(400, 100, "b");
    expect(cap.spentPaise).toBe(350);
    expect(cap.exhausted).toBe(false);
    expect(cap.leftPaise).toBe(650);
    cap.charge(700, "judge");
    expect(cap.exhausted).toBe(true);
    expect(inrToPaise(25)).toBe(2500);
    expect(noCap().reserve(5000)).toBe(5000);
  });

  it("selects tasks by id pattern, category, tag and repo", () => {
    const mk = (id: string, category: Task["category"], tags: string[], repo = "r"): Task => ({ id, title: id, category, repo, base: {}, request: "r", difficulty: 1, tags, truth: { files: [] }, oracle: { kind: "patch" }, checks: {} } as Task);
    const all = [mk("express-bug-1", "bug", ["smoke"], "express"), mk("flask-feat-2", "feature", ["x"], "flask")];
    expect(selectTasks(all, "express-*").map((t) => t.id)).toEqual(["express-bug-1"]);
    expect(selectTasks(all, "category:feature").map((t) => t.id)).toEqual(["flask-feat-2"]);
    expect(selectTasks(all, "tag:smoke,repo:flask").length).toBe(2);
    expect(matchGlob("a.b", "aXb")).toBe(false);
  });

  it("refuses a task that cannot be scored", () => {
    expect(taskProblems({ id: "ok-task", category: "bug", repo: "x", request: "do it", truth: { files: [] }, oracle: { kind: "patch" }, checks: {}, base: { commit: "abc" } })).toEqual([]);
    expect(taskProblems({ id: "X", category: "nope" as never, request: "" } as never)).toEqual(expect.arrayContaining(["id", "category", "repo", "request"]));
  });
});

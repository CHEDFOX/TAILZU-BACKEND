/**
 * A FIX IS PROVED BY A TEST OF ITS OWN (src/code/agent/phases.ts testWanted, principle code.prove, CODE_PROVE_FIX).
 *
 * The second real-model test, smoke item 8: the change passed the project's checks and one of four hidden tests failed. The checks only show that what was
 * already tested still passes; the edge case the task names is in no test of the project's, and it is the case a hidden test asks about. So, once, before the
 * checks run on a change to source with no test staged, the model is asked for one small focused test of the changed behaviour, and the checks then run with it
 * in. What these hold down:
 *   - the principle is in the agent's stable block, and the knob exists;
 *   - the ask happens once, is shown to the model on its next turn, and the test it writes is checked and committed with the change;
 *   - a model that answers with no test is not asked again (the checks run, the job finishes);
 *   - it does not happen for a change that is only docs, for one that already has a test, for a question, with no test command, or when the budget has no room;
 *   - the suite runs with the round off (tests/setup.ts), so every other agent test is as it was.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, done, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { principleText, GROUPS } = await import("../src/principles/library.js");
const { stableBlock } = await import("../src/principles/roles.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");
const { TEST_ROUND_MIN_PAISE, TEST_ROUND_MIN_SHARE, testWanted } = await import("../src/code/agent/phases.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const TEST = {
  path: "src/util.test.ts",
  old: 'test("slug", () => {',
  new: 'test("slug trims dashes from both ends", () => {\n  expect(slug("--a b--")).toBe("a-b");\n});\n\ntest("slug", () => {',
};
const ASK = /Your change is staged and no test covers it/;

async function run(r: Rig, task = UTIL_TASK, over: { budgetPaise?: number | undefined } = {}) {
  r.json.on("work.plan", UTIL_PLAN);
  const { job, branch } = await r.start(task, over);
  await r.orch.idle();
  return { job, branch };
}

describe("the principle", () => {
  it("is one short line in the code group, and the agent's stable block carries it", () => {
    expect(GROUPS.code.map((p) => p.id)).toContain("code.prove");
    expect(principleText("code.prove").length).toBeLessThanOrEqual(120);
    expect(principleText("code.prove")).toMatch(/test/);
    expect(stableBlock("agent_work")).toContain(principleText("code.prove"));
    // Not in the roles that do not change code.
    expect(stableBlock("front_reply")).not.toContain(principleText("code.prove"));
  });

  it("has a knob that is on in the product and off in this suite", () => {
    expect(process.env.CODE_PROVE_FIX).toBe("false");
    process.env.CODE_PROVE_FIX = "true";
    resetConfigForTests();
    try { expect(getConfig().CODE_PROVE_FIX).toBe(true); } finally { process.env.CODE_PROVE_FIX = "false"; resetConfigForTests(); }
    delete process.env.CODE_PROVE_FIX;
    resetConfigForTests();
    try { expect(getConfig().CODE_PROVE_FIX).toBe(true); } finally { process.env.CODE_PROVE_FIX = "false"; resetConfigForTests(); }
  });
});

describe("the round", () => {
  it("asks once before the checks, shows the ask to the model, and commits the test it writes with the change", async () => {
    const r = await agentRig({ proveFix: true });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed the dashes."), call("edit_file", TEST), done("Trimmed the dashes, and tested the edge case."));
    const { job, branch } = await run(r);

    expect((await r.jobNow(job.id)).state).toBe("done");
    // Four turns: the edit, the first done, the test, the second done. The ask was in front of the model on the third, and not on the first.
    expect(r.model.turns).toBe(4);
    expect(r.model.seen[0]!.messages).not.toMatch(ASK);
    expect(r.model.seen[2]!.messages).toMatch(ASK);
    expect(r.model.seen[2]!.messages).toContain("the edge case the task names");
    // The checks ran once, on the change AND its test (one overlay holding both), after the ask.
    const verifies = r.runner.runs.filter((x) => x.overlay.length > 0);
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.overlay.map((f) => f.path).sort()).toEqual(["src/util.test.ts", "src/util.ts"]);
    const files = r.fake.files(r.repo, branch);
    expect(files["src/util.ts"]).toContain("^-+|-+$");
    expect(files["src/util.test.ts"]).toContain("slug trims dashes from both ends");
    expect(r.fake.commitCount(r.repo)).toBe(2);
    // The ask is written down once, and gone from the state once the checks have run.
    const s = await r.stateNow(job.id);
    expect(s.work.testAsked).toBe(true);
    expect(s.work.testFeedback).toBeUndefined();
    expect((await r.worklog.list(job.id)).filter((e) => /asked for one focused test/.test(e.text))).toHaveLength(1);
  });

  it("does not ask twice: a model that answers with no test is checked and committed as it is", async () => {
    const r = await agentRig({ proveFix: true });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."), done("Trimmed, and I did not add a test."));
    const { job, branch } = await run(r);
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.model.turns).toBe(3);
    expect(r.runner.runs.filter((x) => x.overlay.length > 0)).toHaveLength(1);
    expect(Object.keys(r.fake.files(r.repo, branch)).filter((p) => p.endsWith(".test.ts"))).toEqual(["src/util.test.ts"]);
    expect(r.fake.files(r.repo, branch)["src/util.test.ts"]).not.toContain("slug trims");
  });

  it("asks nothing when the change already has a test staged", async () => {
    const r = await agentRig({ proveFix: true });
    r.model.push(call("edit_file", UTIL_EDIT), call("edit_file", TEST), done("Trimmed, and tested."));
    const { job } = await run(r);
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.model.turns).toBe(3);
    expect(r.model.seen.every((s) => !ASK.test(s.messages))).toBe(true);
  });

  it("asks nothing for a change that is only documentation", async () => {
    const r = await agentRig({ proveFix: true });
    r.model.push(call("edit_file", { path: "README.md", old: "A small app.", new: "A small app that makes slugs." }), done("Described it."));
    const { job } = await run(r, "In README.md say what the app does: it makes slugs");
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.model.turns).toBe(2);
    expect(r.model.seen.every((s) => !ASK.test(s.messages))).toBe(true);
  });

  it("asks nothing of a question: nothing is staged", async () => {
    const r = await agentRig({ proveFix: true });
    r.model.push(call("read_file", { path: "src/util.ts" }), done("slug() lowercases a title and joins its words with dashes."));
    const { job } = await r.start("How does slug work in src/util.ts?");
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.model.seen.every((s) => !ASK.test(s.messages))).toBe(true);
  });

  it("is off when the knob says so, for the harness that compares", async () => {
    const r = await agentRig({ proveFix: false });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    await run(r);
    expect(r.model.turns).toBe(2);
  });
});

describe("when it is wanted", () => {
  /** Just enough of a run for the decision: the state, what is staged, the project's checks, and the money. */
  const run = (o: { type?: string; staged?: string[]; checks?: string[]; remaining?: number; budget?: number; turns?: number; asked?: boolean; extra?: Record<string, unknown> } = {}) => ({
    state: { classification: { type: o.type ?? "bug_fix" }, work: { turns: o.turns ?? 2, ...(o.asked ? { testAsked: true } : {}) }, ...(o.extra ?? {}) },
    deps: { proveFix: true },
    tools: { changes: { paths: () => o.staged ?? ["src/util.ts"] } },
    brain: { baselinePlan: async () => (o.checks ?? ["test"]).map((kind) => ({ kind, cmd: kind })) },
    money: async () => ({ spent: (o.budget ?? 250) - (o.remaining ?? 200), budget: o.budget ?? 250, remaining: o.remaining ?? 200 }),
  }) as never;

  it("for a fix or a feature in source, with a test command, the room, and no test of its own", async () => {
    for (const type of ["bug_fix", "feature", "small_edit"]) expect(await testWanted(run({ type })), type).toBe(true);
    expect(await testWanted(run({ staged: ["src/App.jsx", "src/styles.css"] }))).toBe(true);
  });

  it("not for what is not a change to code, or has its test, or has been asked", async () => {
    for (const type of ["question", "research", "refactor", "plan_project", "other"]) expect(await testWanted(run({ type })), type).toBe(false);
    expect(await testWanted(run({ staged: ["README.md", "docs/guide.md"] }))).toBe(false);
    expect(await testWanted(run({ staged: ["package.json", "config/app.json"] }))).toBe(false);
    expect(await testWanted(run({ staged: ["src/util.ts", "src/util.test.ts"] }))).toBe(false);
    expect(await testWanted(run({ staged: ["src/util.ts", "test/util.spec.js"] }))).toBe(false);
    expect(await testWanted(run({ asked: true }))).toBe(false);
  });

  it("not where there is no test to run it with, or for a merge, a PR-care job, a team's part or a new project", async () => {
    expect(await testWanted(run({ checks: ["lint", "typecheck"] }))).toBe(false);
    for (const extra of [{ merge: {} }, { care: { kind: "conflict" } }, { team: {} }, { part: {} }, { newProject: {} }]) expect(await testWanted(run({ extra })), JSON.stringify(extra)).toBe(false);
  });

  it("only within the budget: the room another round needs (the larger of a floor and a share of the budget), and the turns left", async () => {
    expect(await testWanted(run({ budget: 250, remaining: TEST_ROUND_MIN_PAISE - 1 }))).toBe(false);
    expect(await testWanted(run({ budget: 250, remaining: Math.ceil(TEST_ROUND_MIN_SHARE * 250) - 1 }))).toBe(false);
    expect(await testWanted(run({ budget: 250, remaining: Math.ceil(TEST_ROUND_MIN_SHARE * 250) }))).toBe(true);
    expect(await testWanted(run({ budget: 40, remaining: TEST_ROUND_MIN_PAISE }))).toBe(true);
    expect(await testWanted(run({ turns: 1000 }))).toBe(false);
  });
});


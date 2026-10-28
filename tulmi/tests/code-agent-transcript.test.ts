/**
 * FREE-FORM BY DEFAULT, AND WHAT IT KEEPS (src/code/agent/context.ts transcript, phases.ts hints and answerOf, tools.ts suggest_files, docs/code-agent.md).
 *
 * The first paid reality run (e2e/REALITY.md, 2026-10-28) lost most tasks before any code was written (the guided flow located a wrong file and planned and edited
 * only that), and in the jobs that did work the summary strategy made the model forget what it read and read it again (60 turns of it). So:
 *
 *   - a new job is FREE-FORM unless the job, the project or CODE_JOB_MODE says guided; the locate funnel is a tool (suggest_files) and a hint, never a gate
 *   - a free-form job keeps its TRANSCRIPT: every result whole until they pass FREEFORM_KEEP_CHARS, then the oldest are masked in one batch; its first user
 *     message stays the same from turn to turn (the prompt cache reaches into the transcript) and what changes (the step, what is staged) comes last
 *   - a job that changes nothing answers with its WORDS and its summary: the summary alone dropped what the question asked for
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

const { agentRig, call, done, APP_FILES, UTIL_EDIT } = await import("./agent-rig.js");
const { foldTranscript, transcriptChars, buildContext, freeformGuide } = await import("../src/code/agent/context.js");
const { answerOf, afterBaseline, ANSWER_WORDS_MIN } = await import("../src/code/agent/phases.js");
const { FREEFORM_AFTER_ANSWER_STEPS, FREEFORM_FIX_STEPS, FREEFORM_KEEP_CHARS, FREEFORM_STEPS_MAX, FREEFORM_TEST_STEPS, FULL_RESULTS, freeformStepCap, initialState } = await import("../src/code/agent/types.js");
const { sourcesFor, withSources } = await import("../src/code/chat/facts.js");
type Turn = import("./agent-rig.js").Turn;

const OPEN = "Why does slug() leave stray dashes at the ends? Find out and fix it.";

/** Modules of about 5,000 characters each. */
function modules(n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let m = 0; m < n; m += 1) {
    const lines = [`// module ${m}`];
    for (let i = 0; i < 60; i += 1) lines.push(`export const value${m}x${i} = "${"v".repeat(60)}"; // ${i}`);
    out[`src/mod${m}.ts`] = `${lines.join("\n")}\n`;
  }
  return out;
}

describe("a free-form job's transcript", () => {
  it("keeps every read whole, holds its first message the same on every turn, ends each prompt with the status, and folds nothing", async () => {
    const r = await agentRig({ jobMode: null, files: { ...APP_FILES, ...modules(8) } });
    const turns: Turn[] = [];
    for (let m = 0; m < 8; m += 1) turns.push(call("read_file", { path: `src/mod${m}.ts` }));
    turns.push(call("read_file", { path: "src/util.ts" }), call("edit_file", UTIL_EDIT), done("slug() now trims the dashes at both ends."));
    r.model.push(...turns);
    const { job } = await r.start(OPEN);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    const s = await r.stateNow(job.id);
    expect(s.mode).toBe("freeform");
    expect(s.work.strategy).toBe("transcript");
    // No fold was asked of the cheap tier, and nothing was masked: the job is small.
    expect(r.json.calls.filter((c) => c.purpose === "agent.fold")).toHaveLength(0);
    // The first user message is the same from the second turn on (the first turn has the status in it, as there is nothing between).
    const firsts = r.model.seen.slice(1).map((t) => t.user);
    expect(new Set(firsts).size).toBe(1);
    expect(firsts[0]).toContain("This job is free-form");
    expect(firsts[0]).not.toContain("Status: step");
    // The last message is the status, after the latest results; it changes every turn.
    const lastOf = (i: number) => { const m = r.model.seen[i]!.input.messages; const x = m[m.length - 1]!; return typeof x.content === "string" ? x.content : ""; };
    expect(lastOf(3)).toContain(`Status: step 4 of ${FREEFORM_STEPS_MAX}`);
    expect(lastOf(10)).toContain("Status: step 11");
    // Ten turns later the first module read is still there in full (the summary strategy kept only the last six results).
    expect(r.model.seen[10]!.messages).toContain('export const value0x59 = "');
  });

  it("masks the oldest results in one batch once the transcript passes its size, never the latest six, and stays masked the same way", () => {
    const s = initialState("x", 0);
    const big = "y".repeat(8_000);
    for (let i = 0; i < 30; i += 1) {
      s.work.exchanges.push({ text: `reading ${i}`, calls: [{ id: `c${i}`, name: "read_file", arguments: JSON.stringify({ path: `src/m${i}.ts` }) }], results: [{ ok: true, content: `Read src/m${i}.ts (lines 1-400 of 400).`, data: big, label: `src/m${i}.ts` }] });
    }
    expect(transcriptChars(s.work)).toBeGreaterThan(FREEFORM_KEEP_CHARS);
    foldTranscript(s.work);
    expect(transcriptChars(s.work)).toBeLessThanOrEqual(FREEFORM_KEEP_CHARS * 0.6);
    const masked = s.work.exchanges.map((e) => e.results[0]!.masked === true);
    // Oldest first, and the latest six are whole.
    expect(masked.slice(-FULL_RESULTS)).toEqual(Array(FULL_RESULTS).fill(false));
    expect(masked[0]).toBe(true);
    expect(masked.indexOf(false)).toBe(masked.filter(Boolean).length);
    expect(s.work.exchanges[0]!.results[0]!.content).toContain("[read src/m0.ts");
    // Under the size again: a second fold changes nothing (the prompt's prefix stays the same until the next batch).
    const before = JSON.stringify(s.work);
    foldTranscript(s.work);
    expect(JSON.stringify(s.work)).toBe(before);
  });

  it("is laid out with the stable task first and what changes last; the guided layout is unchanged", () => {
    const s = initialState("Fix the thing in src/a.ts", 0);
    s.mode = "freeform";
    s.work.hints = "src/a.ts: defines thing (function), line 3";
    s.work.exchanges.push({ text: "", calls: [{ id: "c1", name: "read_file", arguments: '{"path":"src/a.ts"}' }], results: [{ ok: true, content: "Read src/a.ts.", data: "export function thing() {}", label: "src/a.ts" }] });
    s.work.feedback = "test failed: thing";
    s.work.fixRounds = 1;
    const ctx = buildContext({ state: s, project: "", tools: [], stagedLines: ["src/a.ts (changed)"], checks: ["test: npm test"], strategy: "transcript" });
    const msgs = ctx.messages.map((m) => (typeof m.content === "string" ? m.content : ""));
    expect(ctx.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(msgs[1]).toContain("Where the project's index points for this request");
    expect(msgs[1]).toContain('<tool_data tool="hints">');
    expect(msgs[1]).not.toContain("The checks FAILED");
    expect(msgs[4]).toContain("The checks FAILED on your last attempt");
    expect(msgs[4]).toContain("Staged so far (not committed): src/a.ts (changed)");
    expect(msgs[4]).toContain("Status: step 1 of");
    // The same state, guided and summarised: everything in the first message, as before.
    const g = initialState("Fix the thing in src/a.ts", 0);
    g.work.feedback = "test failed: thing";
    const gc = buildContext({ state: g, project: "", tools: [], stagedLines: ["src/a.ts (changed)"], checks: [], strategy: "summary" });
    expect(gc.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(String(gc.messages[1]!.content)).toContain("The checks FAILED");
    expect(String(gc.messages[1]!.content)).not.toContain("Status: step");
  });

  it("tells a change whose question was answered to build it, and to make it now when it keeps reading with nothing staged", () => {
    const status = (turns: number, answeredAt: number | undefined, staged: string[] = []) => {
      const s = initialState("Our API clients get an HTML page for a 404. Make it better.", 0);
      s.mode = "freeform";
      s.work.turns = turns;
      if (answeredAt !== undefined) s.work.answeredAt = answeredAt;
      const ctx = buildContext({ state: s, project: "", tools: [], stagedLines: staged, checks: [], strategy: "transcript" });
      return String(ctx.messages.at(-1)!.content);
    };
    expect(status(6, 6)).toContain("The person has answered your question: build what they described");
    expect(status(6 + FREEFORM_AFTER_ANSWER_STEPS, 6)).toContain(`answered your question ${FREEFORM_AFTER_ANSWER_STEPS} steps ago and nothing is staged`);
    // Something staged: it is building. No answer: nothing to say until half the steps are gone.
    expect(status(6 + FREEFORM_AFTER_ANSWER_STEPS, 6, ["lib/application.js (changed)"])).not.toContain("answered your question");
    expect(status(10, undefined)).not.toContain("answered");
    expect(status(FREEFORM_STEPS_MAX / 2, undefined)).toContain("Half the steps are used");
  });

  it("tells a question how to answer, and a change how to work: find, ask when the request leaves the design open, reproduce, change every use, prove", () => {
    const q = initialState("What status does a bad charset get?", 0);
    q.mode = "freeform";
    q.classification = { type: "question", difficulty: "low", risk: "low", needs: { web: false, exec: false, vision: false, indic: false }, language: "en", confidence: 0.9, signals: [] } as never;
    expect(freeformGuide(q)).toContain("change nothing");
    expect(freeformGuide(q)).toContain("WHOLE answer as summary");
    const c = initialState("Add a thing", 0);
    c.mode = "freeform";
    const words = freeformGuide(c);
    for (const w of ["suggest_files", "ask_user once", "reproduce it first", "grep for every use", "Prove it by running it"]) expect(words).toContain(w);
  });
});

describe("hints and suggest_files: the locate funnel as a tool, not a gate", () => {
  it("shows a free-form job where the index points, once, and answers suggest_files with ranked files, why, and the tests near them; no model is asked", async () => {
    const r = await agentRig({ jobMode: null });
    r.model.push(call("suggest_files", {}), call("suggest_files", { query: "entry point title" }), call("read_file", { path: "src/util.ts" }), call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await r.start("The slug helper leaves dashes at the ends of a title");
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    const s = await r.stateNow(job.id);
    expect(s.work.hints).toContain("src/util.ts");
    expect(r.model.seen[0]!.user).toContain("Where the project's index points for this request");
    // The funnel's free half: no locate model call (expand, pick) and no plan.
    expect(r.json.calls.filter((c) => c.purpose.startsWith("work.")).map((c) => c.purpose)).toEqual([]);
    const results = s.work.exchanges.flatMap((e) => e.calls.map((c, i) => ({ name: c.name, r: e.results[i]! })));
    const first = results.find((x) => x.name === "suggest_files")!.r;
    expect(first.ok).toBe(true);
    expect(first.data).toMatch(/^1\. src\/util\.ts \(/);
    expect(first.data).toContain("Tests near the first ones: src/util.test.ts");
    const second = results.filter((x) => x.name === "suggest_files")[1]!.r;
    expect(second.data).toContain("src/index.ts");
  });

  it("keeps a team job that the person asked for on the guided road (a team is split from a plan)", () => {
    const s = initialState("x", 0);
    s.mode = "freeform";
    expect(afterBaseline(s)).toBe("work");
    s.teamMode = "on";
    expect(afterBaseline(s)).toBe("locate");
  });
});

describe("the answer of a job that changes nothing", () => {
  it("keeps the words and the summary, the words first, unless one holds the other", () => {
    const words = "The request is refused with status 415 and type charset.unsupported: lib/read.js takes the charset with getCharset and checks it with isValidCharset.";
    expect(answerOf("It is a 415.", [words])).toBe(`${words}\n\nIt is a 415.`);
    expect(answerOf("status 415 and type charset.unsupported", [words])).toBe(words);
    expect(answerOf(`${words} Also utf- only.`, [words])).toBe(`${words} Also utf- only.`);
    // Words too short to be an answer of their own are not kept.
    expect(answerOf("The answer is 415.", ["Now I will call done."])).toBe("The answer is 415.");
    expect("x".repeat(ANSWER_WORDS_MIN - 1).length).toBeLessThan(ANSWER_WORDS_MIN);
  });

  it("answers a question with the words the model wrote before it was nudged, and the summary it gave with done, whole, in the report", async () => {
    const r = await agentRig({ jobMode: null });
    r.json.on("classify", { type: "question", difficulty: "low", risk: "low", needs: { web: false, exec: false, vision: false, indic: false }, language: "en", confidence: 0.9, signals: [] });
    const answer = `slug() in src/util.ts:1 lowercases the title and turns every run of spaces into one dash (replace(/\\s+/g, "-")); it never trims, so a title that starts or ends with a space keeps a dash there. ${"It is called from src/index.ts:3 for the app's title. ".repeat(30)}`;
    r.model.push(call("read_file", { path: "src/util.ts" }), { text: answer, calls: [] }, done("slug() never trims the dashes."));
    const { job } = await r.start("What does slug() do with spaces at the ends of a title?");
    await r.orch.idle();
    const s = await r.stateNow(job.id);
    expect(s.report!.outcome).toBe("answer");
    // Both: the long words (kept past the old 1,500-character cut) and the summary.
    expect(s.work.doneSummary!.length).toBeGreaterThan(1500);
    expect(s.report!.text).toContain("replace(/\\s+/g, \"-\")");
    expect(s.report!.text).toContain("slug() never trims the dashes.");
    expect(s.report!.text.length).toBeGreaterThan(1500);
  });

  it("keeps a refusal's own words when it came beside done", async () => {
    const r = await agentRig({ jobMode: null });
    r.model.push({ text: "I can't create or edit anything under .github/workflows: that path is off-limits for me, so the workflow has to be added by you.", calls: [{ name: "done", args: { summary: "I could not add the workflow; nothing was changed." } }] });
    const { job } = await r.start("Add a GitHub Actions workflow at .github/workflows/ci.yml that runs npm test");
    await r.orch.idle();
    const s = await r.stateNow(job.id);
    expect(s.report!.text).toContain("I can't create or edit anything under .github/workflows");
    expect(s.report!.text).toContain("I could not add the workflow");
  });
});

describe("a free-form job's step cap", () => {
  it("grows by a few steps for each fix round and for the test round, so a job that used its steps can still fix what the checks found", () => {
    expect(freeformStepCap({ fixRounds: 0 })).toBe(FREEFORM_STEPS_MAX);
    expect(freeformStepCap({ fixRounds: 2, testAsked: true })).toBe(FREEFORM_STEPS_MAX + 2 * FREEFORM_FIX_STEPS + FREEFORM_TEST_STEPS);
  });

  it("gives a fix round its own steps after the cap was reached", async () => {
    const r = await agentRig({ jobMode: null });
    // The test check fails while the edit is staged alone (after the baseline, which passes), and passes once the test file is touched too.
    r.runner.checkResult = (kind, run) => (kind === "test" && run.overlay.some((f) => f.path === "src/util.ts") && !run.overlay.some((f) => f.path === "src/util.test.ts")
      ? { exit: 1, text: "FAIL src/util.test.ts > slug\nAssertionError: expected 'a' to be 'b'" } : { exit: 0, text: "ok" });
    r.model.push(call("edit_file", UTIL_EDIT));
    for (let i = 0; i < FREEFORM_STEPS_MAX; i += 1) r.model.push(call("read_file", { path: "src/util.ts" }));
    r.model.push(call("edit_file", { path: "src/util.test.ts", old: 'toBe("hello-world");', new: 'toBe("hello-world"); // the ends are trimmed' }), done("Fixed the test."));
    const { job } = await r.start(OPEN);
    await r.orch.idle();
    const s = await r.stateNow(job.id);
    expect(s.work.fixRounds).toBe(1);
    // Past the 50: the fix round was given turns of its own, and the job ended done.
    expect(s.work.turns).toBeGreaterThan(FREEFORM_STEPS_MAX);
    expect((await r.jobNow(job.id)).state).toBe("done");
  });
});

describe("an answer that names no file", () => {
  const texts = new Map([["lib/read.js", "function read (req) {\n  var charset = getCharset(req)\n}\n"], ["lib/types/json.js", "function isValidCharset (c) { return c.startsWith('utf-') }\n"], ["README.md", "# body-parser\n"]]);
  it("is given the files it was read from that hold the names it uses", () => {
    const answer = "A 415 with type `charset.unsupported`: the charset comes from `getCharset` and is checked with isValidCharset.";
    expect(sourcesFor(answer, texts)).toEqual(["lib/read.js", "lib/types/json.js"]);
    expect(withSources(answer, ["lib/read.js"])).toBe(`${answer}\n\nWhere in the code: lib/read.js.`);
  });
  it("is left alone when it cites a file, or names nothing from the code", () => {
    expect(sourcesFor("See lib/read.js: `getCharset` decides it.", texts)).toEqual([]);
    expect(sourcesFor("It answers with a client error.", texts)).toEqual([]);
  });
});

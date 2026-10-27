/**
 * THE AGENT'S CONTEXT STRATEGIES, ON A LONG SCRIPTED RUN (src/code/agent/context.ts, mask.ts, docs/code-agent.md).
 *
 * The same job, a short one of 30 turns and a long one of 55 (it explores a repo with bulky reads, greps and failing runs, edits one file, checks it, and finishes) is run once under
 * each strategy for what happens to a tool result once it is older than the last six:
 *
 *   mask     its output becomes a one-line placeholder; the model's own turn stays; no model call
 *   summary  the turn leaves the transcript, and the cheap tier folds the digests into a running summary every four results
 *   hybrid   mask, and the oldest ten masked turns are folded into the summary once there are twenty
 *
 * What is measured, from the prompts the scripted model was actually sent: tokens per turn (the prompt, tools included, at the repo's estimate of
 * 3.5 characters a token), the total over the job, the number of model calls (the work turns plus the cheap tier's folds), and whether the job
 * still finished with the edit committed. The scripted model is the same for all three, so the differences are the strategy's alone; a real model
 * comparison is the e2e harness's (it sets the strategy with CODE_CONTEXT_STRATEGY or createAgent's `contextStrategy`).
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

const { agentRig, call, done, APP_FILES, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { charsOf, tokensOfChars } = await import("../src/code/brain/money.js");
const { CONTEXT_MAX_CHARS, FULL_RESULTS } = await import("../src/code/agent/types.js");
type Turn = import("./agent-rig.js").Turn;
type Strategy = "mask" | "summary" | "hybrid";

/** Source files of a few kilobytes each: bulky enough that keeping a read costs something. */
function modules(n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let m = 0; m < n; m += 1) {
    const lines = [`// module ${m}: helpers for the ${m}th part of the shop`];
    for (let i = 0; i < 70; i += 1) lines.push(`export function handle${m}x${i}(input: string, retries = ${i % 5}): string { return input.trim().slice(0, ${40 + i}) + "${m}-${i}"; } // TODO tidy ${i}`);
    out[`src/mod${m}.ts`] = `${lines.join("\n")}\n`;
  }
  return out;
}

const BUILD_OUTPUT = (n: number): string => Array.from({ length: n }, (_, i) => (i === 7 ? "src/mod3.ts(12,5): error TS2345: Argument of type 'string' is not assignable to type 'number'." : `  ${i}: compiled src/part${i % 9}.ts ok in ${10 + i} ms`)).join("\n");

/**
 * Look around, read ten modules, search, run the checks (they fail), look again, edit, run them (they pass), read the result back, finish. The long
 * one reads the modules again by range and searches more before it edits: 56 turns, close to the 60 a job may take.
 */
function script(long: boolean): Turn[] {
  const t: Turn[] = [call("list_dir", { path: "" }), call("list_dir", { path: "src" })];
  for (let m = 0; m < 10; m += 1) t.push(call("read_file", { path: `src/mod${m}.ts` }, `Reading module ${m} to see how it handles input.`));
  for (const p of ["export function", "TODO", "handle3x", "retries", "slice\\(", "trim"]) t.push(call("grep", { pattern: p, glob: "src/**/*.ts" }));
  for (let i = 0; i < 5; i += 1) t.push(call("run", { cmd: i % 2 ? "npm run typecheck" : "npm test", why: "see what fails before changing anything" }));
  if (long) {
    for (let m = 0; m < 10; m += 1) t.push(call("read_file", { path: `src/mod${m}.ts`, from: 20, to: 60 }, `Looking at the middle of module ${m} again.`));
    for (const p of ["handle1x", "handle2x", "handle4x", "handle5x", "handle6x", "handle7x", "handle8x", "handle9x", "Math", "async"]) t.push(call("grep", { pattern: p, glob: "src/**/*.ts" }));
    t.push(call("list_dir", { path: "src" }), call("glob", { pattern: "src/**/*.test.ts" }), call("search_code", { query: "handle" }), call("search_code", { query: "retries" }), call("grep", { pattern: "export", glob: "src/**/*.ts" }));
  }
  t.push(call("glob", { pattern: "src/**/*.ts" }), call("search_code", { query: "slug" }), call("read_file", { path: "src/util.ts" }));
  t.push(call("edit_file", UTIL_EDIT), call("run", { cmd: "npm test", why: "check the edit" }), call("read_file", { path: "src/util.ts" }), done("slug() now trims the dashes at both ends."));
  return t;
}

export interface Measured { strategy: Strategy; turns: number; perTurn: number[]; totalWork: number; folds: number; foldTokens: number; calls: number; peak: number; mean: number; state: string; edited: boolean }

async function measure(strategy: Strategy, long: boolean): Promise<Measured> {
  const r = await agentRig({ files: { ...APP_FILES, ...modules(10) }, contextStrategy: strategy });
  r.json.on("work.plan", UTIL_PLAN);
  r.json.on("agent.fold", { summary: "Explored the shop's modules and ran the checks; one TypeScript error in src/mod3.ts; nothing edited yet." });
  // The runs fail until the edit is in.
  const turns = script(long);
  const editAt = turns.findIndex((x) => x.calls[0]?.name === "edit_file") + 1;
  r.runner.commandResult = (cmd) => ({ exit: r.model.turns > editAt ? 0 : 1, out: BUILD_OUTPUT(150) + `\n$ ${cmd}` });
  r.model.push(...turns);
  const { job, branch } = await r.start(UTIL_TASK);
  await r.orch.idle();
  const perTurn = r.model.seen.map((s) => tokensOfChars(charsOf(s.input.messages, s.input.tools)));
  const folds = r.json.calls.filter((c) => c.purpose === "agent.fold");
  const foldTokens = folds.reduce((a, c) => a + tokensOfChars(c.sent.length), 0);
  const total = perTurn.reduce((a, b) => a + b, 0);
  const committed = r.fake.headCommit(r.repo, branch);
  const text = JSON.stringify(committed);
  return {
    strategy, turns: perTurn.length, perTurn, totalWork: total, folds: folds.length, foldTokens, calls: perTurn.length + folds.length,
    peak: Math.max(...perTurn), mean: Math.round(total / perTurn.length), state: (await r.jobNow(job.id)).state, edited: text.includes("slug") || r.fake.commitCount(r.repo) >= 2,
  };
}

const results = {} as Record<"short" | "long", Record<Strategy, Measured>>;
results.short = {} as Record<Strategy, Measured>;
results.long = {} as Record<Strategy, Measured>;

describe.each([["short", false], ["long", true]] as const)("the %s job under each strategy", (name, long) => {
  it.each(["summary", "mask", "hybrid"] as const)("%s: finishes, with the edit committed, under the cap", async (strategy) => {
    const m = (results[name][strategy] = await measure(strategy, long));
    expect(m.state).toBe("done");
    expect(m.edited).toBe(true);
    expect(m.turns).toBeGreaterThanOrEqual(long ? 50 : 30);
    // No prompt is over the hard cap (messages and tools are counted as the gateway counts them).
    expect(Math.max(...m.perTurn) * 3.5).toBeLessThanOrEqual(CONTEXT_MAX_CHARS + 500);
  }, 180_000);

  it("masking costs no model call, summary pays a fold for every four old results, hybrid one every ten turns once there are twenty old ones", () => {
    const r = results[name];
    expect(r.mask.folds).toBe(0);
    expect(r.summary.folds).toBeGreaterThanOrEqual(5);
    expect(r.hybrid.folds).toBeLessThan(r.summary.folds);
    if (long) expect(r.hybrid.folds).toBeGreaterThanOrEqual(3);
  });
});

describe("the numbers", () => {
  it("are printed", () => {
    for (const name of ["short", "long"] as const) {
      const rows = (["summary", "mask", "hybrid"] as const).map((s) => results[name][s]);
      const line = (m: Measured) => `${m.strategy.padEnd(8)} turns ${m.turns}  mean ${String(m.mean).padStart(5)} tokens/turn  peak ${String(m.peak).padStart(5)}  work total ${String(m.totalWork).padStart(7)}  folds ${m.folds} (${m.foldTokens} tokens)  all in ${m.totalWork + m.foldTokens}  model calls ${m.calls}  ${m.state}`;
      console.log(`\nCONTEXT STRATEGIES, the ${name} job, ${rows[0]!.turns} scripted turns (window ${FULL_RESULTS} results)\n${rows.map(line).join("\n")}`);
      const at = (m: Measured, t: number) => m.perTurn[t - 1] ?? 0;
      const marks = name === "short" ? [10, 20, 30] : [10, 30, 50];
      console.log(`tokens in the prompt at turn ${marks.join(" / ")}:  ${rows.map((m) => `${m.strategy} ${marks.map((t) => at(m, t)).join(" / ")}`).join("   ")}`);
      expect(rows.every((m) => m.state === "done")).toBe(true);
    }
  });
});

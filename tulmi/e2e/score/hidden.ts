/**
 * RUNNING THE PARTS OF A TASK THE BOT NEVER SAW, ON WHAT THE BOT LEFT BEHIND.
 *
 * The result of a job is a commit on its work branch in the LocalGitHub repo. Scoring checks that commit out (a fresh work tree, the project's installed
 * dependencies hard-linked in), lays the task's hidden files over it and runs the project's own test command with the report written to a file:
 *
 *   hidden tests     the tests only the scorer has, the named files only            -> did the bot do what was asked
 *   the visible suite  the project's whole suite on the result, hidden files absent    -> did it break anything
 *   the same suite on the base commit, once per (project, commit), kept on disk     -> what was already failing, so a failure is not blamed on the bot
 *
 * Files are read from git, never from the bot's staged state: only what was committed counts.
 */
import fs from "node:fs";
import path from "node:path";
import { checkoutEnv, testCommand, type RepoSpec } from "../repos.js";
import type { Task } from "../tasks/schema.js";
import { materialize } from "../validate.js";
import { CACHE_DIR, PACKAGE_CACHE, git, mkdirp, readJson, rmrf, sh, writeJson } from "../util.js";
import { parseReport, type ParsedReport } from "./testreport.js";

export interface TestRun {
  ran: boolean;
  exit: number;
  ms: number;
  report: ParsedReport;
  /** The end of the output, for a failure message. */
  tail: string;
  timedOut: boolean;
}

const EMPTY: ParsedReport = { tests: [], total: 0, passed: 0, failed: 0, skipped: 0 };

export interface Checkout { dir: string; dispose(): void }

/**
 * A work tree of the task's base project with an agent's changes laid over it, and optionally more files (the hidden tests). It is made from the task,
 * not from where the agent worked: only the changes it reports count, whichever agent made them.
 */
export async function workTree(task: Task, changes: Record<string, string | null>, over: Record<string, string | null> = {}): Promise<Checkout & { spec: RepoSpec | undefined; baseSha: string }> {
  const m = await materialize(task);
  lay(m.dir, changes);
  lay(m.dir, over);
  return { dir: m.dir, spec: m.spec, baseSha: m.baseSha, dispose: m.dispose };
}

export function lay(dir: string, files: Record<string, string | null>): void {
  for (const [p, text] of Object.entries(files)) {
    const f = path.join(dir, p);
    if (text === null) { rmrf(f); continue; }
    mkdirp(path.dirname(f));
    fs.writeFileSync(f, text);
  }
}

function synthEnv(dir: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|^SUPABASE|^GROQ|^OPENROUTER|^GITHUB_|^GH_)/i.test(k)) continue;
    if (/^(npm_|NODE_ENV$|DEV_SKIP_AUTH$|CONNECTOR_|AGENT_RUN_LEDGER$)/.test(k)) continue;
    env[k] = v;
  }
  env.CI = "1";
  env.PATH = [path.join(dir, "node_modules", ".bin"), env.PATH ?? ""].join(path.delimiter);
  env.npm_config_cache = path.join(PACKAGE_CACHE, "npm");
  return { ...env, ...extra };
}

/** Runs a test command in a checkout and reads its report. */
export async function runTests(spec: RepoSpec | undefined, dir: string, command: string, o: { timeoutMs?: number } = {}): Promise<TestRun> {
  const report = path.join(dir, ".e2e-report");
  rmrf(report);
  const env = spec ? checkoutEnv(spec, { E2E_REPORT: report }, dir) : synthEnv(dir, { E2E_REPORT: report });
  const res = await sh(command, { cwd: dir, env, timeoutMs: o.timeoutMs ?? 600_000 });
  let parsed = EMPTY;
  if (fs.existsSync(report)) {
    try { parsed = parseReport(spec?.test.format ?? "junit", fs.readFileSync(report, "utf8")); } catch { parsed = EMPTY; }
  } else if (!spec) {
    parsed = parseTap(res.stdout);
  }
  return { ran: true, exit: res.code, ms: res.ms, report: parsed, tail: `${res.stdout}\n${res.stderr}`.trim().slice(-1500), timedOut: res.timedOut };
}

/** TAP, for the synthetic projects whose tests are run with `node --test`. */
export function parseTap(out: string): ParsedReport {
  const tests: ParsedReport["tests"] = [];
  for (const m of out.matchAll(/^\s*(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)) {
    tests.push({ id: m[2]!.trim(), status: m[3] ? "skip" : m[1] === "ok" ? "pass" : "fail" });
  }
  const passed = tests.filter((t) => t.status === "pass").length;
  const failed = tests.filter((t) => t.status === "fail").length;
  return { tests, total: tests.length, passed, failed, skipped: tests.length - passed - failed };
}

export interface HiddenResult { ran: boolean; passed: boolean; run: TestRun | null; why: string }

/** The task's hidden tests against the base project with an agent's changes laid over it. */
export async function runHidden(task: Task, changes: Record<string, string | null>): Promise<HiddenResult> {
  const h = task.hidden;
  if (!h) return { ran: false, passed: true, run: null, why: "no hidden tests" };
  const co = await workTree(task, changes, h.files);
  try {
    const spec = co.spec;
    const files = h.run ?? Object.keys(h.files).filter((p) => spec ? new RegExp(spec.test.isTestPath).test(p) : /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_.*\.py$/.test(p));
    const command = h.command ?? (spec ? testCommand(spec, files) : `node --test --test-reporter=tap ${files.map((f) => `'${f}'`).join(" ")}`);
    const run = await runTests(spec, co.dir, command, { timeoutMs: 300_000 });
    const need = h.minTests ?? 1;
    const ok = run.exit === 0 && run.report.failed === 0 && run.report.passed >= need;
    return { ran: true, passed: ok, run, why: ok ? "" : run.timedOut ? "the hidden tests timed out" : run.report.total === 0 ? `no hidden test ran (exit ${run.exit})` : `${run.report.failed} hidden test(s) failed, ${run.report.passed} passed (exit ${run.exit})` };
  } finally { co.dispose(); }
}

export interface SuiteResult { ran: boolean; failing: string[]; passed: number; total: number; exit: number; why: string }

const baselineFile = (repoId: string, sha: string) => path.join(CACHE_DIR, "suite-baseline", `${repoId}-${sha.slice(0, 12)}.json`);

/**
 * The project's own suite on the base project with an agent's changes laid over it. `over` lays more files first: the hidden tests, because a fix that
 * changes behaviour changes an existing test with it and the new version of that test is the truth. A synthetic project has no suite configured.
 */
export async function runSuite(task: Task, changes: Record<string, string | null>, over: Record<string, string | null> = {}): Promise<SuiteResult> {
  if (task.repo === "synthetic") return { ran: false, failing: [], passed: 0, total: 0, exit: 0, why: "no suite configured" };
  const co = await workTree(task, changes, over);
  try {
    const spec = co.spec!;
    const run = await runTests(spec, co.dir, testCommand(spec), { timeoutMs: 600_000 });
    return { ran: true, failing: run.report.tests.filter((t) => t.status === "fail").map((t) => t.id), passed: run.report.passed, total: run.report.total, exit: run.exit, why: run.timedOut ? "timed out" : run.report.total === 0 ? `no test ran (exit ${run.exit}): ${run.tail.slice(-200)}` : "" };
  } finally { co.dispose(); }
}

/** What was failing at the base commit, kept on disk by the commit's tree so a repeat costs nothing. */
export async function baseSuite(task: Task): Promise<SuiteResult> {
  if (task.repo === "synthetic") return { ran: false, failing: [], passed: 0, total: 0, exit: 0, why: "no suite configured" };
  const co = await workTree(task, {});
  try {
    const tree = (await git(co.dir, ["rev-parse", "HEAD^{tree}"])).trim().slice(0, 12);
    const f = baselineFile(co.spec!.id, tree);
    if (fs.existsSync(f)) return readJson<SuiteResult>(f);
    const run = await runTests(co.spec, co.dir, testCommand(co.spec!), { timeoutMs: 600_000 });
    const r: SuiteResult = { ran: true, failing: run.report.tests.filter((t) => t.status === "fail").map((t) => t.id), passed: run.report.passed, total: run.report.total, exit: run.exit, why: run.timedOut ? "timed out" : run.report.total === 0 ? `no test ran (exit ${run.exit})` : "" };
    if (r.total > 0) writeJson(f, r);
    return r;
  } finally { co.dispose(); }
}

/**
 * THE MINER: REAL HISTORICAL BUGS, MADE INTO TASKS, EACH ONE PROVEN TO BE A REAL REPRODUCTION BEFORE IT IS KEPT.
 *
 * For a pinned project it walks the history looking for commits that FIX something and ADD OR CHANGE A TEST, and turns each into a task:
 *
 *   the bot is given   the project at the fix's PARENT, and the commit's own message as the request
 *   hidden             the test files the fix added or changed (the bot never sees them)
 *   truth, oracle      the source files the fix changed, and their text after the fix (and, when the fix made an existing test's old version fail, that
 *                      test's updated text too: a developer's commit changes both)
 *
 * A candidate is kept only if the proof holds, on this machine, with the project's installed dependencies:
 *
 *   1. at the parent, the hidden tests FAIL (some test fails, or the file cannot even load);
 *   2. at the parent with the real fix's source files laid over it (that is what the oracle does), the hidden tests PASS, and at least one ran.
 *
 * A commit whose test passes before the fix is not a reproduction (it tested something else) and is dropped, as is one that needs a dependency the
 * install does not have. Nothing is kept that was not seen failing and then passing.
 *
 *   tsx e2e/mine.ts --repo express --want 4 [--max-attempts 30] [--write] [--dry]
 *
 * Without --write it only reports. With it, the validated tasks are merged into e2e/tasks/bug-<repo>.json (ids already there are kept as they are).
 * The request is the commit's message with its issue numbers and trailers removed; pull request text is not fetched (GitHub's API is not reachable
 * for these repos from here).
 */
import "./env.js";
import { parseCli, runCli, type CliSpec } from "./cli.js";
import fs from "node:fs";
import path from "node:path";
import { checkoutEnv, cloneDirOf, cloneObjects, getRepo, installRepo, isInstalled, loadRepos, makeCheckout, testCommand, type RepoSpec } from "./repos.js";
import { parseReport } from "./score/testreport.js";
import type { Task } from "./tasks/schema.js";
import { TASKS_DIR, git, readJson, rmrf, sh, tmpDir, writeJson } from "./util.js";

export interface Candidate {
  sha: string;
  parent: string;
  date: string;
  subject: string;
  body: string;
  source: string[];
  tests: string[];
  deletedTests: string[];
  other: string[];
  lines: number;
}

const BUG_WORDS = /\b(fix|fixes|fixed|bug|regression|resolve[sd]?|prevent|avoid|incorrect|wrong|crash|broken|throws?|fail(s|ed|ure)?)\b/i;
const NOT_BUG = /^(docs?|chore|ci|build|deps?|release|revert|style|perf|test|refactor|merge|bump|lint|typo|feat|feature|add|allow|support|polish|improve|update|enhance|implement|remove|drop|rename|move|upgrade|migrate)(\(|:|!|\s)/i;
const NOT_BUG_WORDS = /\b(typo|typos|changelog|readme|dependabot|bump|release \d|prepare release|\bci\b|workflow|badge|funding|sponsor|lockfile|cve-)\b/i;

export const cleanRequest = (subject: string, body: string): string => {
  const s = subject.replace(/\s*\(#\d+\)\s*$/, "").trim();
  const b = body.split("\n")
    .filter((l) => !/^(signed-off-by|co-authored-by|reviewed-by):/i.test(l.trim()))
    .filter((l) => !/^(fixes|closes|resolves|refs?)\s*:?\s*(#|https?:\/\/github\.com)\S*\s*$/i.test(l.trim()))
    .join("\n").replace(/\(#\d+\)/g, "").replace(/#\d{2,6}\b/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return b ? `${s}\n\n${b}` : s;
};

/** The commits of the clone's history that look like a bug fix with a test, newest first. */
export async function findCandidates(r: RepoSpec, o: { limit?: number; maxSource?: number; maxLines?: number } = {}): Promise<Candidate[]> {
  const dir = cloneDirOf(r);
  const prefix = r.workdir ? `${r.workdir}/` : "";
  const isTest = new RegExp(r.test.isTestPath);
  const srcRe = new RegExp(r.mine.sourcePath);
  const ignRe = new RegExp(r.mine.ignorePath);
  const raw = await git(dir, ["log", "--no-merges", "-n", String(o.limit ?? 500), ...(r.mine.since ? [`--since=${r.mine.since}`] : []), "--format=%x1e%H%x1f%P%x1f%as%x1f%s%x1f%b%x1f", "--name-status", "--no-renames", r.pin]);
  const out: Candidate[] = [];
  const seenSubjects = new Set<string>();
  for (const rec of raw.split("\x1e").slice(1)) {
    const [sha, parents, date, subject, body, files] = rec.split("\x1f");
    const parent = (parents ?? "").split(" ")[0];
    if (!sha || !parent || !subject) continue;
    if (NOT_BUG.test(subject) || NOT_BUG_WORDS.test(subject)) continue;
    if (!BUG_WORDS.test(subject)) continue;
    // The same fix cherry-picked to another branch is one bug.
    if (seenSubjects.has(subject.trim())) continue;
    seenSubjects.add(subject.trim());
    const source: string[] = [];
    const tests: string[] = [];
    const deletedTests: string[] = [];
    const other: string[] = [];
    for (const line of (files ?? "").split("\n")) {
      const m = /^([AMD])\t(.+)$/.exec(line.trim());
      if (!m) continue;
      let p = m[2]!;
      if (prefix) { if (!p.startsWith(prefix)) continue; p = p.slice(prefix.length); }
      if (isTest.test(p)) { (m[1] === "D" ? deletedTests : tests).push(p); }
      else if (srcRe.test(p) && !ignRe.test(p)) source.push(p);
      else other.push(p);
    }
    if (!source.length || !tests.length || deletedTests.length) continue;
    if (source.length > (o.maxSource ?? 4) || tests.length > 4) continue;
    // Manifests and lockfiles in the same commit: a dependency change, not a code bug.
    if (other.some((p) => /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|pyproject\.toml|uv\.lock)$/.test(p))) continue;
    const stat = await git(dir, ["show", "--numstat", "--no-renames", "--format=", sha]);
    const lines = stat.split("\n").reduce((n, l) => n + (Number(l.split("\t")[0]) || 0) + (Number(l.split("\t")[1]) || 0), 0);
    if (lines > (o.maxLines ?? 400)) continue;
    out.push({ sha, parent, date: date ?? "", subject, body: (body ?? "").trim(), source, tests, deletedTests, other, lines });
  }
  return out;
}

async function fileAt(dir: string, sha: string, p: string): Promise<string | null> {
  try { return await git(dir, ["show", `${sha}:${p}`]); } catch { return null; }
}

export interface Validation {
  ok: boolean;
  why?: string;
  baseFailed: number;
  baseRan: number;
  fixedPassed: number;
  fixedRan: number;
  ms: number;
}

/** Runs the hidden tests at the parent, then with the fix's source files laid over it. */
export async function validateCandidate(r: RepoSpec, c: Candidate): Promise<{ v: Validation; hidden: Record<string, string>; oracle: Record<string, string | null> }> {
  const t0 = Date.now();
  const dir = cloneDirOf(r);
  const { objects, shallow } = cloneObjects(r);
  const prefix = r.workdir ? `${r.workdir}/` : "";
  const at = (sha: string) => `${sha}${r.workdir ? `:${r.workdir}` : ""}`;
  const hidden: Record<string, string> = {};
  for (const p of c.tests) {
    const t = await fileAt(dir, c.sha, `${prefix}${p}`);
    if (t === null) return { v: { ok: false, why: `test ${p} unreadable`, baseFailed: 0, baseRan: 0, fixedPassed: 0, fixedRan: 0, ms: 0 }, hidden, oracle: {} };
    hidden[p] = t;
  }
  // Test helpers and fixtures changed with the fix (not test files themselves) belong to what the bot is never shown.
  for (const p of c.other) {
    if (r.test.testDirs.some((d) => p === d || p.startsWith(`${d}/`))) { const t = await fileAt(dir, c.sha, `${prefix}${p}`); if (t !== null) hidden[p] = t; }
  }
  const oracle: Record<string, string | null> = {};
  for (const p of c.source) oracle[p] = await fileAt(dir, c.sha, `${prefix}${p}`);
  const runFiles = c.tests.filter((p) => new RegExp(r.mine.runnable).test(p));
  if (!runFiles.length) return { v: { ok: false, why: "no runnable test file", baseFailed: 0, baseRan: 0, fixedPassed: 0, fixedRan: 0, ms: 0 }, hidden, oracle };

  // The parent as the repo root (a folder of the project is the root of a bot's repo).
  let parentSha = c.parent;
  if (r.workdir) {
    const tree = (await git(dir, ["rev-parse", at(c.parent)])).trim();
    parentSha = (await git(dir, ["commit-tree", tree, "-m", "base"], { env: { GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@x", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@x" } })).trim();
  }
  const dest = tmpDir(`mine-${r.id}`);
  try {
    await makeCheckout(r, { objects: [objects], shallow, sha: parentSha, dest });
    const report = path.join(dest, ".e2e-report");
    const run = async (files: readonly string[] = runFiles): Promise<{ ran: number; passed: number; failed: number; code: number }> => {
      rmrf(report);
      const res = await sh(testCommand(r, files), { cwd: dest, env: checkoutEnv(r, { E2E_REPORT: report }, dest), timeoutMs: 300_000 });
      const parsed = fs.existsSync(report) ? parseReport(r.test.format, fs.readFileSync(report, "utf8")) : { total: 0, passed: 0, failed: 0 };
      return { ran: parsed.total, passed: parsed.passed, failed: parsed.failed, code: res.code };
    };
    const lay = (files: Record<string, string | null>) => {
      for (const [p, t] of Object.entries(files)) {
        const f = path.join(dest, p);
        if (t === null) rmrf(f); else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
      }
    };
    lay(hidden);
    const before = await run();
    // A reproduction: something fails, or the file cannot load (no test ran at all and the run was not clean).
    const reproduces = before.failed > 0 || (before.passed === 0 && before.code !== 0);
    if (!reproduces) return { v: { ok: false, why: "the hidden tests pass before the fix", baseFailed: before.failed, baseRan: before.ran, fixedPassed: 0, fixedRan: 0, ms: Date.now() - t0 }, hidden, oracle };
    lay(oracle);
    const after = await run();
    const fixed = after.code === 0 && after.failed === 0 && after.passed >= 1;
    // A fix can change what an existing test expects (a format, a message). The developer's commit updated that test, so the oracle does too: otherwise the
    // project's own checks, which the bot runs on its change, fail on the stale test and the known-good answer would not pass its own flow.
    if (fixed) {
      for (const p of runFiles) {
        const stale = await fileAt(dir, c.parent, `${prefix}${p}`);
        if (stale === null || stale === hidden[p]) continue;
        lay({ [p]: stale });
        const old = await run([p]);
        lay({ [p]: hidden[p]! });
        if (old.code !== 0 || old.failed > 0) oracle[p] = hidden[p]!;
      }
    }
    return {
      v: { ok: fixed, ...(fixed ? {} : { why: `the hidden tests do not pass with the fix laid over the parent (exit ${after.code}, ${after.failed} failed, ${after.passed} passed)` }), baseFailed: before.failed, baseRan: before.ran, fixedPassed: after.passed, fixedRan: after.ran, ms: Date.now() - t0 },
      hidden, oracle,
    };
  } finally { rmrf(dest); }
}

export function taskFrom(r: RepoSpec, c: Candidate, v: Validation, hidden: Record<string, string>, oracle: Record<string, string | null>): Task {
  const runFiles = c.tests.filter((p) => new RegExp(r.mine.runnable).test(p));
  const testDirsRe = r.test.testDirs.map((d) => `^${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`);
  const parentSha = c.parent;
  return {
    id: `${r.id}-bug-${c.sha.slice(0, 7)}`,
    title: c.subject.replace(/\s*\(#\d+\)\s*$/, ""),
    category: "bug",
    repo: r.id,
    base: { commit: r.workdir ? parentSha : parentSha },
    request: cleanRequest(c.subject, c.body),
    front: { intent: "code_task" },
    difficulty: c.lines > 200 ? 4 : c.lines > 80 ? 3 : c.source.length > 1 ? 3 : 2,
    tags: ["mined", "real-bug", r.id, r.kind],
    truth: { files: c.source, allowed: [...testDirsRe, "^(CHANGELOG|History|CHANGES)", "\\.md$"] },
    hidden: { files: hidden, run: runFiles, kind: "tests", minTests: 1 },
    oracle: { kind: "patch", files: oracle, classify: { type: "bug_fix" }, plan: `Fix: ${c.subject.replace(/\s*\(#\d+\)\s*$/, "")}` },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
    mined: { fix: c.sha, parent: parentSha, subject: c.subject, date: c.date, files: c.source },
    validated: { at: new Date().toISOString(), baseFails: true, oraclePasses: true, baseTestsFailed: v.baseFailed, oracleTests: v.fixedRan, ms: v.ms },
  };
}

// --------------------------------------------------------------------- CLI

export const MINE_SPEC: CliSpec = {
  name: "npm run e2e:mine --",
  about: "find real bug-fix commits in the pinned projects whose tests fail before the fix and pass with it, and keep them as tasks",
  positionals: false,
  flags: {
    repo: { kind: "list", value: "a,b", about: "projects to mine (default all)" },
    want: { kind: "number", about: "tasks to keep per project (default 3)" },
    "max-attempts": { kind: "number", about: "candidates to try per project (default 30)" },
    write: { kind: "bool", about: "write the kept tasks (without it: a dry run)" },
  },
};

async function main(): Promise<void> {
  const p = parseCli(MINE_SPEC, process.argv.slice(2));
  const repoIds = p.list("repo");
  const want = p.num("want") ?? 3;
  const maxAttempts = p.num("max-attempts") ?? 30;
  const write = p.has("write");
  const repos = repoIds.length ? repoIds.map(getRepo) : loadRepos();
  for (const r of repos) {
    if (!isInstalled(r)) { console.log(`${r.id}: installing first`); await installRepo(r, { log: console.log }); }
    const file = path.join(TASKS_DIR, `bug-${r.id}.json`);
    const have: Task[] = fs.existsSync(file) ? readJson<Task[]>(file) : [];
    const keep = new Set(have.map((t) => t.mined?.fix));
    const cands = (await findCandidates(r)).filter((c) => !keep.has(c.sha));
    console.log(`${r.id}: ${cands.length} candidates in the history window, ${have.length} tasks already kept, want ${want}`);
    const made: Task[] = [...have];
    let tried = 0;
    for (const c of cands) {
      if (made.length >= want || tried >= maxAttempts) break;
      tried += 1;
      process.stdout.write(`  ${c.sha.slice(0, 7)} ${c.date} ${c.subject.slice(0, 70)} ... `);
      try {
        const { v, hidden, oracle } = await validateCandidate(r, c);
        if (!v.ok) { console.log(`dropped: ${v.why}`); continue; }
        console.log(`KEPT (fails before: ${v.baseFailed}, passes with the fix: ${v.fixedPassed}, ${Math.round(v.ms / 100) / 10}s)`);
        made.push(taskFrom(r, c, v, hidden, oracle));
        if (write) writeJson(file, made);
      } catch (err) {
        console.log(`error: ${(err as Error).message.slice(0, 160)}`);
      }
    }
    console.log(`${r.id}: ${made.length - have.length} new, ${made.length} in all${write ? ` (written to ${path.relative(process.cwd(), file)})` : " (dry run: pass --write to keep them)"}`);
  }
}

if (process.argv[1] && /e2e\/mine\.[tj]s$/.test(process.argv[1])) {
  runCli(async () => { await main(); }).then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
}

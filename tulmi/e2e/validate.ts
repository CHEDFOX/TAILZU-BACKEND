/**
 * VALIDATING TASKS: A TASK IS KEPT ONLY IF IT IS SEEN TO BE FAIR.
 *
 * For every task that changes code, on this machine, with the project's installed dependencies:
 *
 *   1. the base project with the hidden files laid over it FAILS the hidden tests (the task is a real ask, not already done);
 *   2. the base with the ORACLE's patch laid over it PASSES them (the ask can be met, and the hidden tests are not unfair);
 *   3. the project's own suite on that patched base fails nothing the unpatched base passed (the oracle does not break the project);
 *   4. the oracle's result satisfies the task's own file checks (no leftovers, the files that must exist, the files that must stay).
 *
 * A task with no hidden tests (a question, a refusal) is checked for having what its checks need (truth files exist at the base, an oracle answer).
 * The outcome is written into the task's `validated` field. `npm run e2e:validate -- --tasks <glob> [--write]`.
 */
import { parseCli, runCli, type CliSpec } from "./cli.js";
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { cloneDirOf, cloneObjects, getRepo, installRepo, isInstalled, makeCheckout, testCommand, type RepoSpec } from "./repos.js";
import { fileChecks, groundingProblems, walkTexts } from "./score/files.js";
import { lay, runTests } from "./score/hidden.js";
import { loadTasks, selectTasks, snapshotBase, type Task } from "./tasks/schema.js";
import { TASKS_DIR, fakeSecret, git, mkdirp, pool, readJson, rmrf, synthTmp, tmpDir, writeJson } from "./util.js";

export interface Materialized { dir: string; dispose(): void; spec: RepoSpec | undefined; /** The commit the checkout is at: the base project with the planted files and the project's setup committed. A diff against it is what an agent did. */ baseSha: string }

export const substituteSecrets = (text: string, task: Task): string => text.replace(/\{\{SECRET:(\d+)\}\}/g, (_m, i) => {
  const s = task.checks.secrets?.[Number(i)];
  return s ? fakeSecret(s.kind, s.salt) : "";
});

/** The task's base project on disk: the pinned commit (or the synthetic files), with anything planted laid over it. */
export async function materialize(task: Task): Promise<Materialized> {
  const dest = task.repo === "synthetic" ? synthTmp(`val-${task.id.slice(0, 20)}`) : tmpDir(`val-${task.id.slice(0, 20)}`);
  let spec: RepoSpec | undefined;
  if (task.repo !== "synthetic") {
    spec = getRepo(task.repo);
    const { objects, shallow } = cloneObjects(spec);
    const commit = task.base.commit ?? spec.pin;
    let sha = commit;
    if (spec.workdir) {
      const tree = (await git(cloneDirOf(spec), ["rev-parse", `${commit}:${spec.workdir}`])).trim();
      sha = (await git(cloneDirOf(spec), ["commit-tree", tree, "-m", "base"], { env: { GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@x", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@x" } })).trim();
    }
    await makeCheckout(spec, { objects: [objects], shallow, sha, dest });
  } else {
    mkdirp(dest);
    await git(dest, ["init", "-q"]);
    lay(dest, task.base.files ?? {});
  }
  const planted: Record<string, string | null> = {};
  for (const [p, t] of Object.entries(task.base.planted ?? {})) planted[p] = t === null ? null : substituteSecrets(t, task);
  lay(dest, planted);
  // What the project was before anyone touched it: planted files and setup included, so that `git diff` against this commit is exactly the agent's work.
  const ident = { GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@tailzu.local", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@tailzu.local" };
  await git(dest, ["add", "-A"], { env: ident });
  if (snapshotBase(task)) await freshHistory(dest);
  await git(dest, ["commit", "-q", "--allow-empty", "-m", "base"], { env: ident });
  const baseSha = (await git(dest, ["rev-parse", "HEAD"])).trim();
  return { dir: dest, spec, baseSha, dispose: () => rmrf(dest) };
}

/**
 * Replaces a checkout's git history with ONE root commit-to-be of the files it tracks now: the old .git (history, borrowed objects, shallow file, reflog) is
 * removed and the same paths are added to a new one. The work tree (dependencies linked in, setup output) is left as it is.
 */
async function freshHistory(dest: string): Promise<void> {
  const tracked = await git(dest, ["ls-files", "-z"]);
  rmrf(path.join(dest, ".git"));
  await git(dest, ["init", "-q"]);
  await git(dest, ["config", "user.email", "e2e@tailzu.local"]);
  await git(dest, ["config", "user.name", "e2e"]);
  await git(dest, ["config", "core.fileMode", "false"]);
  if (tracked) await git(dest, ["add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], { input: tracked });
}

export interface Validation { ok: boolean; why: string; baseFailed: number; oracleTests: number; ms: number; notes: string[] }

function hiddenCommand(task: Task, spec: RepoSpec | undefined): string {
  const h = task.hidden!;
  const files = h.run ?? Object.keys(h.files).filter((p) => spec ? new RegExp(spec.test.isTestPath).test(p) : /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_.*\.py$/.test(p));
  return h.command ?? (spec ? testCommand(spec, files) : `node --test --test-reporter=tap ${files.map((f) => `'${f}'`).join(" ")}`);
}

export async function validateTask(task: Task): Promise<Validation> {
  const t0 = Date.now();
  const notes: string[] = [];
  const done = (ok: boolean, why: string, baseFailed = 0, oracleTests = 0): Validation => ({ ok, why, baseFailed, oracleTests, ms: Date.now() - t0, notes });
  if (!Object.keys(task.oracle.files ?? {}).length && task.hidden) return done(false, "the task has hidden tests but its oracle has no patch");
  const m = await materialize(task);
  try {
    // The truth files exist at the base (a question's answer files, a bug's files), unless the task creates them.
    for (const f of task.truth.answerFiles ?? []) if (!fs.existsSync(path.join(m.dir, f))) return done(false, `answer file ${f} is not in the project at the base`);
    const ungrounded = groundingProblems(task, walkTexts(m.dir));
    if (ungrounded.length) return done(false, ungrounded.join("; "));
    if (task.oracle.kind === "patch" || task.oracle.kind === "ask_then_patch" || task.oracle.kind === "flag_broken") {
      for (const f of task.truth.files) {
        const patched = f in (task.oracle.files ?? {});
        if (!fs.existsSync(path.join(m.dir, f)) && !patched) return done(false, `truth file ${f} is neither in the project nor created by the oracle`);
      }
    }
    if (!task.hidden) {
      if (task.oracle.kind === "answer" && !task.oracle.answer) return done(false, "a question needs an oracle answer");
      if (task.oracle.files && Object.keys(task.oracle.files).length) {
        lay(m.dir, task.oracle.files);
        const bad = fileChecks(task, walkTexts(m.dir)).checks.filter((x) => !x.ok);
        if (bad.length) return done(false, `the oracle's result fails the task's own file checks: ${bad[0]!.detail}`);
      }
      return done(true, "no hidden tests to run; the task's own inputs are consistent");
    }
    const cmd = hiddenCommand(task, m.spec);
    lay(m.dir, task.hidden.files);
    const before = await runTests(m.spec, m.dir, cmd, { timeoutMs: 300_000 });
    const reproduces = before.report.failed > 0 || (before.report.passed === 0 && before.exit !== 0);
    if (!reproduces) return done(false, "the hidden tests already pass on the base project", before.report.failed);
    lay(m.dir, task.oracle.files ?? {});
    const after = await runTests(m.spec, m.dir, cmd, { timeoutMs: 300_000 });
    const need = task.hidden.minTests ?? 1;
    if (!(after.exit === 0 && after.report.failed === 0 && after.report.passed >= need)) {
      return done(false, `the hidden tests do not pass with the oracle's patch (exit ${after.exit}, ${after.report.failed} failed, ${after.report.passed} passed): ${after.tail.slice(-300).replace(/\s+/g, " ")}`, before.report.failed, after.report.passed);
    }
    // The oracle must not break the project's own suite: the whole suite, with the hidden files (a fix may change an existing test with it).
    if ((task.checks.suite ?? true) && m.spec) {
      const base = await materialize(task);
      try {
        const baseSuite = await runTests(m.spec, base.dir, testCommand(m.spec), { timeoutMs: 600_000 });
        const patched = await runTests(m.spec, m.dir, testCommand(m.spec), { timeoutMs: 600_000 });
        const was = new Set(baseSuite.report.tests.filter((t) => t.status === "fail").map((t) => t.id));
        const regress = patched.report.tests.filter((t) => t.status === "fail" && !was.has(t.id)).map((t) => t.id);
        if (patched.report.total === 0) notes.push(`the suite did not report on the patched project (exit ${patched.exit})`);
        else if (regress.length) return done(false, `the oracle's patch breaks ${regress.length} test(s) of the project's own suite, e.g. ${regress[0]}`, before.report.failed, after.report.passed);
        else notes.push(`the project's own suite with the hidden files: ${patched.report.passed} pass, ${was.size} already failing, none newly broken`);
      } finally { base.dispose(); }
    }
    // The oracle's result must satisfy the task's own file checks (no leftovers, what must be there, what must stay).
    if (task.checks.noLeftovers?.length || task.checks.mustContain?.length || task.checks.mustKeep?.length) {
      const bad = fileChecks(task, walkTexts(m.dir)).checks.filter((x) => !x.ok);
      if (bad.length) return done(false, `the oracle's result fails the task's own file checks: ${bad[0]!.detail}`, before.report.failed, after.report.passed);
    }
    return done(true, "fails before, passes with the oracle's patch", before.report.failed, after.report.passed);
  } catch (err) {
    return done(false, `error: ${(err as Error).message.slice(0, 200)}`);
  } finally { m.dispose(); }
}

/** Writes `validated` into the task's own file. */
export function recordValidation(task: Task, v: Validation): void {
  for (const f of fs.readdirSync(TASKS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const file = path.join(TASKS_DIR, f);
    const j = readJson<Task | Task[]>(file);
    const list = Array.isArray(j) ? j : [j];
    const t = list.find((x) => x.id === task.id);
    if (!t) continue;
    t.validated = { at: new Date().toISOString(), baseFails: v.ok || v.baseFailed > 0, oraclePasses: v.ok, baseTestsFailed: v.baseFailed, oracleTests: v.oracleTests, ms: v.ms, note: v.ok ? v.notes.join("; ") || v.why : v.why };
    writeJson(file, Array.isArray(j) ? list : list[0]);
    return;
  }
}

export const VALIDATE_SPEC: CliSpec = {
  name: "npm run e2e:validate --",
  about: "check that every task's hidden command FAILS on the base project and PASSES with the oracle's patch",
  positionals: false,
  flags: {
    tasks: { kind: "string", value: "<glob>", about: "task selector (default all)" },
    missing: { kind: "bool", about: "only tasks not validated yet" },
    write: { kind: "bool", about: "record the result in the task files" },
    parallel: { kind: "number", about: "tasks at once (default 2)" },
  },
};

async function main(): Promise<void> {
  const p = parseCli(VALIDATE_SPEC, process.argv.slice(2));
  const tasks = selectTasks(loadTasks(), p.str("tasks")).filter((t) => !p.has("missing") || !t.validated?.oraclePasses);
  const write = p.has("write");
  console.log(`validating ${tasks.length} task(s)`);
  let bad = 0;
  await pool(tasks, p.num("parallel") ?? 2, async (t) => {
    const spec = t.repo !== "synthetic" ? getRepo(t.repo) : undefined;
    if (spec && !isInstalled(spec)) await installRepo(spec, { log: console.log });
    const v = await validateTask(t);
    console.log(`${v.ok ? "ok  " : "FAIL"} ${t.id.padEnd(46)} ${(v.ms / 1000).toFixed(1).padStart(5)}s  ${v.why.slice(0, 160)}`);
    if (!v.ok) bad += 1;
    if (write) recordValidation(t, v);
  });
  console.log(bad ? `${bad} task(s) did not validate` : "every task validated");
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && /e2e\/validate\.[tj]s$/.test(process.argv[1])) {
  runCli(async () => { await main(); return Number(process.exitCode ?? 0); }).then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
}

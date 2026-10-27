/**
 * THE REAL PROJECTS THE REALITY CHECK RUNS ON: PINNED, CLONED, INSTALLED ONCE, CHECKED OUT CHEAPLY AS MANY TIMES AS A RUN NEEDS.
 *
 *   repos.json   the list: which project, which commit, how to install it, how to run its tests and read the result
 *   cache/clones/<id>/       a shallow clone at the pinned commit, with its dependencies installed beside the code
 *   cache/deps/<id>/         things that are not inside the clone (a Python venv)
 *   cache/state.json         what the install found (which folders hold dependencies), for the hard-linking below
 *
 * `makeCheckout` is the one way every other part of the harness gets a working copy: a git work tree at ANY commit of the clone (or of a LocalGitHub
 * repo that borrows the clone's objects), with the installed dependencies HARD-LINKED in. A hard link costs no disk and no copy, so a hundred
 * checkouts cost what one does; the price is that a command must not rewrite a dependency in place (none of the repos' checks does).
 *
 * Only popular, reputable public repositories, each pinned by commit. Package-manager caches go to /dev/shm (RAM) and are deleted after the install:
 * this machine's disk is small, and a cache is as big as the dependencies it fetched.
 *
 * CLI:  tsx e2e/repos.ts list | clone [id..] | install [id..] | verify [id..] | status
 */
import "./env.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, CLONES_DIR, E2E_DIR, LOCKS_DIR, freeDiskMB, git, mkdirp, readJson, rmrf, run, sh, tmpDir, writeJson } from "./util.js";

export interface RepoSpec {
  /** A fixture project kept in this repository (a folder under e2e/), not cloned: its commit is made from the folder, the same every time. */
  fixture?: string;
  /** The project's own formatter: the oracle patches are run through it so they pass the project's own lint and format checks (`{files}` is the list). */
  format?: { cmd: string; only: string };
  id: string;
  slug: string;
  clone?: string;
  stack: string;
  kind: string;
  language: string;
  pin: string;
  depth: number;
  workdir: string;
  install: {
    manager: "npm" | "pnpm" | "yarn-pruned" | "pip" | "none";
    cmd?: string;
    lock?: string;
    prune?: string[];
    afterInstall?: string[];
    packages?: string[];
    venv?: string;
    metadata?: boolean;
    approxMB?: number;
  };
  installChecks?: string[];
  setup?: string[];
  pre?: string;
  env?: Record<string, string>;
  pathPrepend?: string[];
  test: {
    format: "mocha-json" | "junit";
    run: string;
    full: string;
    files: string;
    isTestPath: string;
    testDirs: string[];
    checkRewrites?: Array<{ match: string; to: string }>;
  };
  mine: { sourcePath: string; ignorePath: string; runnable: string; /** Only commits after this date: the installed dependencies are the pin's, and an older commit may need older ones. */ since?: string };
  uiCapable: boolean;
  ui?: { dev: string; port: number; componentsDir: string };
  measured?: Measured;
}

export interface Measured {
  at: string;
  installSec?: number;
  installMB?: number;
  testSec: number;
  tests: number;
  failed: number;
  command: string;
}

export interface ReposFile { version: number; note: string; repos: RepoSpec[] }

const REPOS_JSON = path.join(E2E_DIR, "repos.json");
const STATE_JSON = path.join(CACHE_DIR, "state.json");

export function loadReposFile(): ReposFile {
  const f = readJson<ReposFile>(REPOS_JSON);
  for (const r of f.repos) if (r.fixture) r.pin = ensureFixture(r);
  return f;
}

// ----------------------------------------------------------------- fixtures

const fixturePins = new Map<string, string>();

function hashDir(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === "node_modules" || e.name === "package-lock.json" || e.name === ".git") continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, `${rel}${e.name}/`);
      else { h.update(`${rel}${e.name}\0`); h.update(fs.readFileSync(f)); h.update("\0"); }
    }
  };
  walk(dir, "");
  return h.digest("hex");
}

/**
 * A fixture project as a git repository in the clone cache: one commit, made from the folder with a fixed author and date, so the commit hash is the same on
 * every machine for the same files. Rebuilt when the folder changed; installed dependencies are left where they are.
 */
export function ensureFixture(r: RepoSpec): string {
  const hit = fixturePins.get(r.id);
  if (hit) return hit;
  const src = path.join(E2E_DIR, r.fixture!);
  const dir = path.join(CLONES_DIR, r.clone ?? r.id);
  const hash = hashDir(src);
  const marker = path.join(dir, ".git", "fixture-hash");
  const g = (args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "tailzu-e2e", GIT_AUTHOR_EMAIL: "e2e@tailzu.local", GIT_COMMITTER_NAME: "tailzu-e2e", GIT_COMMITTER_EMAIL: "e2e@tailzu.local", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" } }).trim();
  if (!(fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === hash)) {
    mkdirp(dir);
    for (const e of fs.readdirSync(dir)) if (e !== "node_modules") rmrf(path.join(dir, e));
    fs.cpSync(src, dir, { recursive: true, filter: (f) => !/(^|\/)(node_modules|package-lock\.json)$/.test(f) });
    g(["init", "-q"]);
    g(["add", "-A"]);
    g(["commit", "-q", "-m", `${r.id}: fixture`]);
    fs.writeFileSync(marker, hash);
  }
  const sha = g(["rev-parse", "HEAD"]);
  fixturePins.set(r.id, sha);
  return sha;
}
export function loadRepos(): RepoSpec[] { return loadReposFile().repos; }
export function getRepo(id: string): RepoSpec {
  const r = loadRepos().find((x) => x.id === id);
  if (!r) throw new Error(`no such repo in repos.json: ${id}`);
  return r;
}

export const cloneDirOf = (r: RepoSpec): string => path.join(CLONES_DIR, r.clone ?? r.id);
export const depsDirOf = (r: RepoSpec): string => path.join(CACHE_DIR, "deps", r.id);
/** Where the installed dependencies live: the clone's own work tree (under the repo's folder), or the venv. */
export const installRootOf = (r: RepoSpec): string => path.join(cloneDirOf(r), r.workdir);

interface InstallState { installedAt: string; depDirs: string[]; installSec: number; installMB: number }
type State = Record<string, InstallState>;
const readState = (): State => readJson<State>(STATE_JSON, {});
function writeState(id: string, s: InstallState): void { const st = readState(); st[id] = s; writeJson(STATE_JSON, st); }
export const installStateOf = (r: RepoSpec): InstallState | null => readState()[r.id] ?? null;

export function isCloned(r: RepoSpec): boolean { return fs.existsSync(path.join(cloneDirOf(r), ".git")); }
export function isInstalled(r: RepoSpec): boolean {
  if (r.install.manager === "none") return isCloned(r);
  const st = installStateOf(r);
  if (!st) return false;
  if (r.install.manager === "pip") return fs.existsSync(path.join(depsDirOf(r), r.install.venv ?? "venv", "bin", "python"));
  return st.depDirs.every((d) => fs.existsSync(path.join(installRootOf(r), d)));
}

// ------------------------------------------------------------------- clone

export async function cloneRepo(r: RepoSpec, log: (s: string) => void = () => undefined): Promise<void> {
  if (r.fixture) { ensureFixture(r); return; }
  const dir = cloneDirOf(r);
  if (isCloned(r)) {
    const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
    if (head === r.pin) return;
    log(`${r.id}: the clone is at ${head.slice(0, 7)}, not the pin ${r.pin.slice(0, 7)}; fetching the pin`);
    await git(dir, ["fetch", "--depth", String(r.depth), "--no-tags", "origin", r.pin]);
    await git(dir, ["checkout", "-q", "-f", "--detach", r.pin]);
    return;
  }
  mkdirp(dir);
  log(`${r.id}: cloning ${r.slug} at ${r.pin.slice(0, 7)} (depth ${r.depth})`);
  await git(dir, ["init", "-q"]);
  await git(dir, ["remote", "add", "origin", `https://github.com/${r.slug}`]);
  await git(dir, ["fetch", "-q", "--depth", String(r.depth), "--no-tags", "origin", r.pin], { timeoutMs: 600_000 });
  await git(dir, ["checkout", "-q", "-f", "--detach", r.pin]);
}

// ----------------------------------------------------------------- install

async function dirMB(p: string): Promise<number> {
  const r = await run("du", ["-sm", p]);
  return Number(r.stdout.split(/\s/)[0]) || 0;
}

async function findDepDirs(root: string): Promise<string[]> {
  const r = await run("find", [".", "-name", "node_modules", "-type", "d", "-prune", "-not", "-path", "*/node_modules/*"], { cwd: root });
  return r.stdout.split("\n").map((l) => l.trim().replace(/^\.\//, "")).filter((l) => l && l !== ".").sort();
}

function pruneManifest(pkg: Record<string, unknown>, patterns: string[]): void {
  const res = patterns.map((p) => new RegExp(p));
  for (const k of ["dependencies", "devDependencies"]) {
    const deps = pkg[k] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const name of Object.keys(deps)) if (res.some((re) => re.test(name))) delete deps[name];
  }
  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (scripts) { delete scripts.prepare; delete scripts.postinstall; }
}

/** Installs the project's dependencies for the pinned commit. Idempotent: an installed repo is left alone unless `force`. */
export async function installRepo(r: RepoSpec, o: { force?: boolean; log?: (s: string) => void } = {}): Promise<InstallState> {
  const log = o.log ?? (() => undefined);
  if (!isCloned(r)) await cloneRepo(r, log);
  if (r.install.manager === "none") return { installedAt: new Date().toISOString(), depDirs: [], installSec: 0, installMB: 0 };
  if (!o.force && isInstalled(r)) return installStateOf(r)!;
  const need = r.install.approxMB ?? 200;
  const free = freeDiskMB(CACHE_DIR);
  if (free < need + 300) throw new Error(`${r.id}: not enough disk to install (${free} MB free, about ${need} MB needed plus a margin)`);
  const root = installRootOf(r);
  const t0 = Date.now();
  const cacheDir = `/dev/shm/e2e-cache-${r.id}`;
  rmrf(cacheDir);
  mkdirp(cacheDir);
  const env = { ...process.env, npm_config_cache: path.join(cacheDir, "npm"), YARN_CACHE_FOLDER: path.join(cacheDir, "yarn"), PIP_CACHE_DIR: path.join(cacheDir, "pip"), CI: "1" } as Record<string, string>;
  log(`${r.id}: installing with ${r.install.manager} (about ${need} MB)`);
  try {
    if (r.install.manager === "npm") {
      if (r.install.lock) fs.copyFileSync(path.join(LOCKS_DIR, r.install.lock), path.join(root, "package-lock.json"));
      const res = await sh(r.install.cmd!, { cwd: root, env, timeoutMs: 900_000 });
      if (res.code !== 0) throw new Error(`${r.id}: install failed: ${(res.stderr || res.stdout).slice(-600)}`);
    } else if (r.install.manager === "pnpm") {
      const res = await sh(`${r.install.cmd!} --store-dir ${path.join(cacheDir, "pnpm-store")}`, { cwd: root, env, timeoutMs: 900_000 });
      if (res.code !== 0) throw new Error(`${r.id}: install failed: ${(res.stderr || res.stdout).slice(-600)}`);
    } else if (r.install.manager === "yarn-pruned") {
      // The app's own devDependencies include Storybook, Playwright, linters: hundreds of megabytes the tests never touch. Install a pruned copy of the manifest.
      const tmp = tmpDir(`inst-${r.id}`);
      try {
        fs.copyFileSync(path.join(root, "package.json"), path.join(tmp, "package.json"));
        fs.copyFileSync(path.join(root, "yarn.lock"), path.join(tmp, "yarn.lock"));
        const pkg = readJson<Record<string, unknown>>(path.join(tmp, "package.json"));
        pruneManifest(pkg, r.install.prune ?? []);
        writeJson(path.join(tmp, "package.json"), pkg);
        // The old copy goes first: this disk cannot hold two.
        rmrf(path.join(root, "node_modules"));
        const res = await sh(r.install.cmd!, { cwd: tmp, env, timeoutMs: 900_000 });
        if (res.code !== 0) throw new Error(`${r.id}: install failed: ${(res.stderr || res.stdout).slice(-600)}`);
        fs.renameSync(path.join(tmp, "node_modules"), path.join(root, "node_modules"));
      } finally { rmrf(tmp); }
      for (const c of r.install.afterInstall ?? []) await sh(c, { cwd: root, env });
    } else if (r.install.manager === "pip") {
      const venv = path.join(depsDirOf(r), r.install.venv ?? "venv");
      mkdirp(depsDirOf(r));
      let res = await run("python3", ["-m", "venv", venv]);
      if (res.code !== 0) throw new Error(`${r.id}: venv failed: ${res.stderr.slice(-300)}`);
      res = await run(path.join(venv, "bin", "pip"), ["install", "-q", ...(r.install.packages ?? [])], { env });
      if (res.code !== 0) throw new Error(`${r.id}: pip failed: ${res.stderr.slice(-400)}`);
      // The project's own metadata (importlib.metadata asks for it), installed without its code: the code comes from PYTHONPATH, per checkout.
      if (r.install.metadata) {
        res = await run(path.join(venv, "bin", "pip"), ["install", "-q", "--no-deps", "."], { cwd: root, env });
        if (res.code !== 0) throw new Error(`${r.id}: pip metadata install failed: ${res.stderr.slice(-300)}`);
        rmrf(path.join(root, "build"));
      }
    }
  } finally {
    rmrf(cacheDir);
  }
  const depDirs = r.install.manager === "pip" ? [] : await findDepDirs(root);
  const installMB = await dirMB(r.install.manager === "pip" ? depsDirOf(r) : path.join(root, "node_modules"));
  const state: InstallState = { installedAt: new Date().toISOString(), depDirs, installSec: Math.round((Date.now() - t0) / 100) / 10, installMB };
  writeState(r.id, state);
  // Anything the install left in the clone's tree that git sees must not leak into the pin.
  return state;
}

// ---------------------------------------------------------------- checkouts

/** The environment a project's commands get: no secrets, the venv first on PATH, the project's own variables. */
export function checkoutEnv(r: RepoSpec, extra: Record<string, string> = {}, checkout?: string): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|^SUPABASE|^GROQ|^OPENROUTER|^GITHUB_|^GH_)/i.test(k)) continue;
    if (/^(npm_|NODE_ENV$|DEV_SKIP_AUTH$|CONNECTOR_|AGENT_RUN_LEDGER$)/.test(k)) continue;
    base[k] = v;
  }
  const deps = depsDirOf(r);
  // What `npm run`, `pnpm` and `yarn` do for a script: the project's own binaries first on PATH.
  const bins = checkout ? [path.join(checkout, "node_modules", ".bin")] : [];
  const prepend = [...bins, ...(r.pathPrepend ?? []).map((p) => p.replace("{deps}", deps))];
  const env: Record<string, string> = {
    ...base, CI: "1", LANG: base.LANG ?? "C.UTF-8",
    PATH: [...prepend, base.PATH ?? "/usr/local/bin:/usr/bin:/bin"].join(path.delimiter),
    ...(r.env ?? {}), ...extra,
  };
  return env;
}

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The shell command that runs the project's tests (the named files only, when given), writing a machine-readable report to $E2E_REPORT. */
export function testCommand(r: RepoSpec, files?: readonly string[]): string {
  const core = files?.length ? r.test.files.replace("{files}", files.map(q).join(" ")) : r.test.full;
  return r.pre ? `${r.pre} ; ${core}` : core;
}

/** A project check as the agent's runner wraps it, with the install swapped for the prepared dependencies and the test command made runnable here. */
export function rewriteCheckText(r: RepoSpec, text: string): string {
  const installRes = (r.installChecks ?? []).map((p) => new RegExp(p));
  const rewrites = (r.test.checkRewrites ?? []).map((x) => ({ re: new RegExp(x.match), to: x.to.replace("{pre}", r.pre ?? "true") }));
  const rewrite = (re: RegExp, to: string, line: string): string | null => {
    const m = re.exec(line);
    return m ? to.replace("{args}", m.groups?.args?.trim() ?? "").trim() : null;
  };
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (installRes.some((re) => re.test(t))) return line.replace(t, "echo 'dependencies are prepared'");
    for (const w of rewrites) { const to = rewrite(w.re, w.to, t); if (to !== null) return line.replace(t, to); }
    return line;
  }).join("\n");
}

export interface CheckoutOptions {
  /** Object directories to borrow (git alternates): the LocalGitHub repo's, and so on down to the clone's. */
  objects: string[];
  /** The bare repo's `shallow` file, copied so git knows where the history ends. */
  shallow?: string;
  /** The commit to put on disk. */
  sha: string;
  dest: string;
  /** Hard-link the installed dependencies in (default). */
  deps?: boolean;
}

/** A git work tree at a commit, with the project's installed dependencies hard-linked in and its setup run. */
export async function makeCheckout(r: RepoSpec, o: CheckoutOptions): Promise<string> {
  mkdirp(o.dest);
  await git(o.dest, ["init", "-q"]);
  fs.writeFileSync(path.join(o.dest, ".git", "objects", "info", "alternates"), `${o.objects.join("\n")}\n`);
  if (o.shallow && fs.existsSync(o.shallow)) fs.copyFileSync(o.shallow, path.join(o.dest, ".git", "shallow"));
  await git(o.dest, ["config", "user.email", "e2e@tailzu.local"]);
  await git(o.dest, ["config", "user.name", "e2e"]);
  await git(o.dest, ["config", "core.fileMode", "false"]);
  await git(o.dest, ["checkout", "-q", "-f", "--detach", o.sha]);
  if (o.deps !== false) await linkDeps(r, o.dest);
  for (const c of r.setup ?? []) await sh(c, { cwd: o.dest, env: checkoutEnv(r), timeoutMs: 60_000 });
  return o.dest;
}

/** Puts the installed dependency folders into a checkout: hard links where the disk allows, else a symlink. */
export async function linkDeps(r: RepoSpec, dest: string): Promise<void> {
  if (r.install.manager === "none") return;
  const st = installStateOf(r);
  if (!st) throw new Error(`${r.id} is not installed: run \`npm run e2e:repos -- install ${r.id}\``);
  const root = installRootOf(r);
  for (const d of st.depDirs) {
    const from = path.join(root, d);
    const to = path.join(dest, d);
    if (!fs.existsSync(from)) throw new Error(`${r.id}: ${d} is missing from the install; install it again`);
    mkdirp(path.dirname(to));
    rmrf(to);
    const res = await run("cp", ["-al", from, to]);
    if (res.code !== 0) {
      rmrf(to);
      const sym = await run("ln", ["-s", from, to]);
      if (sym.code !== 0) throw new Error(`${r.id}: could not link ${d}: ${res.stderr.slice(0, 200)}`);
    }
  }
}

/** The directories a bare repo borrows objects from, so a checkout of it needs no copy: the clone's own, down the chain. */
export function cloneObjects(r: RepoSpec): { objects: string; shallow: string } {
  const g = path.join(cloneDirOf(r), ".git");
  return { objects: path.join(g, "objects"), shallow: path.join(g, "shallow") };
}

// ------------------------------------------------------------------ verify

export async function verifyRepo(r: RepoSpec, log: (s: string) => void = () => undefined): Promise<Measured> {
  const { objects, shallow } = cloneObjects(r);
  const dest = tmpDir(`verify-${r.id}`);
  try {
    // The tree at the pin; for a repo inside a folder of the clone, that folder is the root.
    const sha = r.workdir ? (await git(cloneDirOf(r), ["commit-tree", `${r.pin}:${r.workdir}`, "-m", "verify"], { env: { GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@x", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@x" } })).trim() : r.pin;
    await makeCheckout(r, { objects: [objects], shallow, sha, dest });
    const report = path.join(dest, ".e2e-report");
    const cmd = testCommand(r);
    log(`${r.id}: running ${cmd.slice(0, 120)}`);
    const res = await sh(cmd, { cwd: dest, env: checkoutEnv(r, { E2E_REPORT: report }, dest), timeoutMs: 900_000 });
    const { parseReport } = await import("./score/testreport.js");
    const parsed = fs.existsSync(report) ? parseReport(r.test.format, fs.readFileSync(report, "utf8")) : { tests: [], total: 0, failed: 0 };
    const st = installStateOf(r);
    const m: Measured = { at: new Date().toISOString(), testSec: Math.round(res.ms / 100) / 10, tests: parsed.total, failed: parsed.failed, command: cmd, ...(st ? { installSec: st.installSec, installMB: st.installMB } : {}) };
    if (res.code !== 0 && parsed.failed === 0) log(`${r.id}: the suite exited ${res.code}: ${(res.stderr || res.stdout).slice(-300)}`);
    return m;
  } finally { rmrf(dest); }
}

export function saveMeasured(id: string, m: Measured): void {
  const f = loadReposFile();
  const r = f.repos.find((x) => x.id === id);
  if (r) { r.measured = m; writeJson(REPOS_JSON, f); }
}

// --------------------------------------------------------------------- CLI

async function main(): Promise<void> {
  const [cmd = "list", ...rest] = process.argv.slice(2);
  const ids = rest.filter((a) => !a.startsWith("--"));
  const all = loadRepos();
  const picked = ids.length ? ids.map(getRepo) : all;
  const log = (s: string) => console.log(s);
  if (cmd === "list" || cmd === "status") {
    for (const r of all) {
      const st = installStateOf(r);
      console.log(`${r.id.padEnd(18)} ${r.stack.padEnd(54)} cloned=${isCloned(r) ? "yes" : "no "} installed=${isInstalled(r) ? "yes" : "no "} ${r.measured ? `tests=${r.measured.tests} in ${r.measured.testSec}s` : ""} ${st ? `deps=${st.installMB}MB` : ""}`);
    }
    console.log(`free disk: ${freeDiskMB(CACHE_DIR)} MB`);
    return;
  }
  if (cmd === "clone") { const seen = new Set<string>(); for (const r of picked) { const k = r.clone ?? r.id; if (seen.has(k)) continue; seen.add(k); await cloneRepo(r, log); } return; }
  if (cmd === "install") {
    for (const r of picked) {
      if (process.argv.includes("--adopt")) {
        // Dependencies that are already on disk (installed by hand with the same recipe): record them without installing again.
        const root = installRootOf(r);
        const depDirs = r.install.manager === "pip" ? [] : await findDepDirs(root);
        const installMB = await dirMB(r.install.manager === "pip" ? depsDirOf(r) : path.join(root, "node_modules"));
        writeState(r.id, { installedAt: new Date().toISOString(), depDirs, installSec: 0, installMB });
        log(`${r.id}: adopted (${installMB} MB, ${depDirs.length} dependency folders)`);
        continue;
      }
      const s = await installRepo(r, { force: process.argv.includes("--force"), log });
      log(`${r.id}: installed (${s.installMB} MB, ${s.installSec}s)`);
    }
    return;
  }
  if (cmd === "verify") {
    for (const r of picked) {
      if (!isInstalled(r)) await installRepo(r, { log });
      const m = await verifyRepo(r, log);
      saveMeasured(r.id, m);
      log(`${r.id}: ${m.tests} tests, ${m.failed} failed, ${m.testSec}s${m.installSec !== undefined ? `, install ${m.installSec}s / ${m.installMB} MB` : ""}`);
    }
    return;
  }
  console.error("usage: tsx e2e/repos.ts list | clone [id..] | install [id..] [--force] | verify [id..] | status");
  process.exitCode = 2;
}

if (process.argv[1] && /e2e\/repos\.[tj]s$/.test(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

/**
 * SMALL SHARED HELPERS FOR THE E2E HARNESS: PATHS, PROCESSES, GIT, A SEMAPHORE, A SEEDED RANDOM.
 *
 * No dependency beyond Node. Every process is started with an argument list (execFile) unless it is a shell command that came from a repo's own
 * configuration (repos.json), which goes through `sh -c` on purpose: that is what a project's "test" script is.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { E2E_DIR } from "./env.js";

export { E2E_DIR };
export const CACHE_DIR = process.env.E2E_CACHE_DIR ? path.resolve(process.env.E2E_CACHE_DIR) : path.join(E2E_DIR, "cache");
export const CLONES_DIR = path.join(CACHE_DIR, "clones");
export const WORK_DIR = path.join(CACHE_DIR, "work");
export const OUT_DIR = process.env.E2E_OUT_DIR ? path.resolve(process.env.E2E_OUT_DIR) : path.join(E2E_DIR, "out");
export const TASKS_DIR = path.join(E2E_DIR, "tasks");
export const IMAGES_DIR = path.join(E2E_DIR, "images");
export const LOCKS_DIR = path.join(E2E_DIR, "locks");

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const sha1 = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const uid = (n = 6) => randomBytes(n).toString("hex");

export function mkdirp(p: string): string { fs.mkdirSync(p, { recursive: true }); return p; }
export function readJson<T>(file: string, fallback?: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch (err) { if (fallback !== undefined) return fallback; throw err; }
}
export function writeJson(file: string, value: unknown): void {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
export function rmrf(p: string): void { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); }

/** A fresh temporary directory under the cache's work folder (same disk as the clones, so a hard link can reach their files). */
export function tmpDir(prefix: string): string {
  mkdirp(WORK_DIR);
  return fs.mkdtempSync(path.join(WORK_DIR, `${prefix}-`));
}
/**
 * Removes what a killed run left in the work folder: entries nothing has touched for `maxAgeMs` (a live run keeps its folder's modified time fresh by
 * making checkouts in it). Returns what it removed. Called when a run starts.
 */
export function sweepStaleWork(maxAgeMs = 3 * 3_600_000, now = Date.now(), dir = WORK_DIR): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(dir)) return removed;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > maxAgeMs) { rmrf(full); removed.push(name); }
    } catch { /* gone already, or not ours to remove */ }
  }
  return removed;
}

/** A temporary directory on the OS's tmp, for things that never need a hard link. */
export function osTmp(prefix: string): string { return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)); }

/**
 * A temporary directory for a SYNTHETIC project (no installed dependencies to link): outside this repository (a test runner looks upward for its config and
 * would find the product's own), and on memory where there is some, which is quick and leaves the disk alone.
 */
export function synthTmp(prefix: string): string {
  const base = fs.existsSync("/dev/shm") ? "/dev/shm/e2e-work" : path.join(os.tmpdir(), "e2e-work");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, `${prefix}-`));
}

export interface ExecResult { code: number; stdout: string; stderr: string; timedOut: boolean; ms: number }
export interface ExecOptions { cwd?: string; env?: Record<string, string | undefined>; input?: string | Buffer; timeoutMs?: number; maxBuffer?: number }

/** Runs a program with arguments; never throws for a non-zero exit. */
export function run(cmd: string, args: readonly string[], o: ExecOptions = {}): Promise<ExecResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = execFile(cmd, [...args], {
      cwd: o.cwd, env: o.env ? { ...o.env } as NodeJS.ProcessEnv : process.env, maxBuffer: o.maxBuffer ?? 256 * 1024 * 1024, timeout: o.timeoutMs ?? 0, encoding: "utf8", killSignal: "SIGKILL",
    }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      const code = e ? (typeof e.code === "number" ? e.code : e.killed ? 124 : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr), timedOut: !!e?.killed, ms: Date.now() - t0 });
    });
    if (o.input !== undefined) child.stdin?.end(o.input); else child.stdin?.end();
  });
}

/** A shell command (from a repo's own configuration), in its own process group so a timeout kills what it started. */
export function sh(command: string, o: ExecOptions & { onData?: (s: string) => void } = {}): Promise<ExecResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd: o.cwd, env: (o.env ?? process.env) as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    let err = "";
    let timedOut = false;
    const keep = 8 * 1024 * 1024;
    const take = (which: "o" | "e") => (d: Buffer) => {
      const s = d.toString("utf8");
      o.onData?.(s);
      if (which === "o") { out += s; if (out.length > keep * 2) out = out.slice(-keep); } else { err += s; if (err.length > keep * 2) err = err.slice(-keep); }
    };
    child.stdout.on("data", take("o"));
    child.stderr.on("data", take("e"));
    const kill = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } };
    const timer = o.timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs) : null;
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code: timedOut ? 124 : code, stdout: out, stderr: err, timedOut, ms: Date.now() - t0 });
    };
    child.on("error", () => finish(127));
    child.on("exit", (code, signal) => { const c = code ?? (signal ? 137 : 1); setTimeout(() => finish(c), 400).unref(); });
    child.on("close", (code) => finish(code ?? 1));
  });
}

/** git, in a directory (a work tree or a bare repo). Throws with git's own words on a non-zero exit. */
export async function git(cwd: string, args: readonly string[], o: { input?: string | Buffer; env?: Record<string, string | undefined>; allowFail?: boolean; timeoutMs?: number } = {}): Promise<string> {
  const r = await run("git", args, { cwd, input: o.input, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", ...(o.env ?? {}) }, timeoutMs: o.timeoutMs ?? 120_000 });
  if (r.code !== 0 && !o.allowFail) throw new Error(`git ${args.slice(0, 3).join(" ")} failed (${r.code}): ${r.stderr.trim().split("\n").slice(-3).join(" | ")}`);
  return r.stdout;
}
/** git, returning the raw buffer (a blob, a tar). */
export function gitBuf(cwd: string, args: readonly string[], o: { input?: string | Buffer } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", [...args], { cwd, encoding: "buffer", maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.slice(0, 3).join(" ")} failed: ${String(stderr).trim().split("\n").slice(-2).join(" | ")}`));
      else resolve(stdout as Buffer);
    });
    if (o.input !== undefined) child.stdin?.end(o.input); else child.stdin?.end();
  });
}

/** At most `n` of the async functions run at once. */
export class Semaphore {
  private waiting: Array<() => void> = [];
  private busy = 0;
  constructor(private readonly n: number) {}
  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy >= this.n) await new Promise<void>((r) => this.waiting.push(r));
    this.busy += 1;
    try { return await fn(); } finally { this.busy -= 1; this.waiting.shift()?.(); }
  }
}

/** Runs `fn` over `items`, `n` at a time, keeping the order of the results. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }));
  return out;
}

/** A small seeded random (mulberry32): the same seed, the same numbers, on every machine. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pct = (n: number, of: number): number => (of ? Math.round((n / of) * 1000) / 10 : 0);
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}
export function stats(xs: readonly number[]): { n: number; mean: number; p50: number; p95: number; min: number; max: number; sum: number } {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((t, x) => t + x, 0);
  return { n: s.length, mean: s.length ? sum / s.length : 0, p50: quantile(s, 0.5), p95: quantile(s, 0.95), min: s[0] ?? 0, max: s[s.length - 1] ?? 0, sum };
}

/** Whether a path is inside (or is) a directory, after resolving both. */
export function inside(dir: string, p: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function freeDiskMB(dir: string): number {
  try {
    const s = fs.statfsSync(dir);
    return Math.floor((s.bavail * s.bsize) / (1024 * 1024));
  } catch { return Number.MAX_SAFE_INTEGER; }
}

/** Fake secrets are built at runtime from parts, never written whole: GitHub's push protection and our own scan read source files. */
export function fakeSecret(kind: "stripe" | "github" | "aws" | "openrouter" | "generic", salt = ""): string {
  const tail = sha256(`e2e-${kind}-${salt}`).slice(0, 32);
  switch (kind) {
    case "stripe": return ["sk", "live", `${tail}${tail.slice(0, 8)}`].join("_");
    case "github": return ["gh", "p_"].join("") + tail + tail.slice(0, 8);
    case "aws": return ["AK", "IA"].join("") + tail.slice(0, 16).toUpperCase();
    case "openrouter": return ["sk", "or", "v1", tail + tail].join("-");
    default: return ["tok", tail].join("_");
  }
}

/** A package cache shared by every checkout and work tree (each has its own throwaway home), so a project's second install is not a second download. */
export const PACKAGE_CACHE = fs.existsSync("/dev/shm") ? "/dev/shm/e2e-package-cache" : path.join(CACHE_DIR, "package-cache");

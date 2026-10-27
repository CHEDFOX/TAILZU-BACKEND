/**
 * AN OPEN-SOURCE CODING AGENT AS AN AGENT UNDER TEST: RUN HEADLESS IN THE TASK'S CHECKOUT, POINTED AT THE RECORDING PROXY, SCORED BY THE SAME HIDDEN CHECKS.
 *
 * One agent is a small `ExternalSpec`: how to build its command line (`plan`, pure, so it is unit-tested) and how to read what it printed (`digest`, pure).
 * Everything else is here and the same for every agent, so that the comparison is about the agent and not about how it was started:
 *
 *   THE MODEL    the same slug (`input.model.slug`), reached only through the proxy (proxy.ts) as an OpenAI-compatible base URL, `/run/<label>/v1`. Every call is
 *                recorded once and replayed for nothing, counted per run, and refused with a 402 when the run's budget is spent (the proxy is told the cap
 *                before the agent starts; this module also kills the agent a moment after it is reached).
 *   THE KEYS     an agent is given a FAKE key, made at run time, and nothing else from this process's environment: no OPENROUTER_API_KEY, no token, no
 *                proxy variable, no CA bundle. The real key is read by the proxy alone (adapters/upstream.ts). The environment is built from an allowlist
 *                (`scrubbedEnv`), the home folder is a throwaway one, and a tool that wants to download a plugin or a price list fails closed.
 *   THE CHECKOUT the agent runs in `input.checkout` (a git work tree at the task's base). Its own bookkeeping files (aider's history, a tags cache) are hidden
 *                from git with .git/info/exclude so that they do not count as its work; the runner then reads the diff with git, as for every agent.
 *   THE LIMITS   `timeoutSec` of wall time, `budgetPaise` of model spend; the process group is killed at either.
 *   THE METRICS  tokens, calls, models and dollars come from the proxy's `/run/<label>/stats`; steps and tool calls from the agent's own output where it has any.
 *
 * NOT A SANDBOX. These agents run shell commands on this machine with a real model's choices. The checkout and the home are throwaway and the environment
 * holds no secret, but a hostile task could still reach the file system: run a real grid inside a container.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkoutEnv, getRepo } from "../repos.js";
import { WORK_DIR, fakeSecret, git, mkdirp, rmrf, sleep, uid } from "../util.js";
import { notInstalled, toolBin, toolBinDir } from "./tools.js";
import type { AgentMetrics, AgentRunInput, AgentRunResult, AgentStatus, AgentUnderTest } from "./types.js";

const fx = (): number => Number(process.env.CODE_USD_INR) || 88;

// ---------------------------------------------------------------- the pieces an agent supplies

export interface PlanInput {
  taskId: string;
  request: string;
  /** The installed tool's executable (tools.ts). */
  bin: string;
  /** The OpenRouter slug, e.g. qwen/qwen3.7-flash. */
  model: string;
  /** The proxy's labelled base URL: http://127.0.0.1:PORT/run/<label>/v1 */
  baseUrl: string;
  /** A fake key: the proxy ignores it. */
  apiKey: string;
  /** The agent's throwaway home (and where its own files are kept). */
  home: string;
  checkout: string;
  timeoutSec: number;
  /** Set by the caller for the options an agent has (aider's edit format). */
  options: Record<string, string>;
}

export interface ExternalPlan {
  cmd: string;
  args: string[];
  /** Added to the scrubbed environment (the variables the agent reads its model from). */
  env: Record<string, string>;
  /** Files to write before the run, by absolute path (configuration). */
  files: Record<string, string>;
  /** Patterns for .git/info/exclude: what the agent leaves in the checkout that is not its work. */
  exclude: string[];
  /** Folders under the home to make. */
  dirs?: string[];
  stdin?: string;
}

export interface Digest { steps: number; toolCalls: number; toolErrors: number; answer: string; /** A verdict the agent's own output gives, if it does. */ verdict?: { status: AgentStatus; reason: string } }

export interface ExternalSpec {
  id: string;
  describe: string;
  /** The key in versions.json. */
  tool: string;
  plan(i: PlanInput): ExternalPlan;
  /** Reads what the process printed (and wrote under the home) into the agent's own account of the run. */
  digest(o: { stdout: string; stderr: string; home: string; checkout: string }): Digest;
}

// ---------------------------------------------------------------- the environment

const KEEP = ["LANG", "LC_ALL", "TZ"] as const;

/**
 * The environment an agent is started with: an ALLOWLIST. The PATH (the tool's own folder first, then the project's, so that `npm test` and `pytest` work), a
 * throwaway HOME and TMPDIR, a few locale variables, CI=1, the project's own variables from repos.json, and what the agent's plan adds. Nothing else from the
 * parent: no key, no token, no proxy or certificate setting.
 */
export function scrubbedEnv(o: { parent: NodeJS.ProcessEnv; home: string; tmp: string; pathDirs: readonly string[]; projectEnv?: Record<string, string>; extra: Record<string, string> }): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of KEEP) { const v = o.parent[k]; if (v) env[k] = v; }
  env.LANG ??= "C.UTF-8";
  env.PATH = [...o.pathDirs, ...(o.parent.PATH ?? "/usr/local/bin:/usr/bin:/bin").split(path.delimiter)].filter((p, i, a) => p && a.indexOf(p) === i).join(path.delimiter);
  env.HOME = o.home;
  env.TMPDIR = o.tmp;
  env.TERM = "dumb";
  env.CI = "1";
  env.NO_COLOR = "1";
  env.NO_PROXY = "127.0.0.1,localhost";
  for (const [k, v] of Object.entries(o.projectEnv ?? {})) if (!SECRETISH.test(k)) env[k] = v;
  return { ...env, ...o.extra };
}

const SECRETISH = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|^SUPABASE|^GROQ|^OPENROUTER|^GITHUB_|^GH_|PROXY|CERT|CA_BUNDLE)/i;

/** The folder a labelled proxy URL belongs to: [root, label]. */
export function splitProxyUrl(url: string): { root: string; label: string | null } {
  const m = /^(.*?)\/run\/([A-Za-z0-9._-]{1,80})\/v1\/?$/.exec(url);
  if (m) return { root: m[1]!, label: m[2]! };
  return { root: url.replace(/\/v1\/?$/, ""), label: null };
}

export const labelFor = (parts: readonly string[]): string => parts.join("__").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);

// ---------------------------------------------------------------- the proxy's account of a run

export interface ProxyRunStats { run: string; calls: number; promptTokens: number; completionTokens: number; costUsd: number; models: Record<string, number>; firstAt: number | null; lastAt: number | null; refused: number; capUsd: number }

export async function fetchRunStats(root: string, label: string): Promise<ProxyRunStats | null> {
  try {
    const res = await fetch(`${root}/run/${encodeURIComponent(label)}/stats`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? ((await res.json()) as ProxyRunStats) : null;
  } catch { return null; }
}

export async function setRunCap(root: string, label: string, capUsd: number): Promise<boolean> {
  try {
    const res = await fetch(`${root}/run/${encodeURIComponent(label)}/cap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capUsd }), signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch { return false; }
}

// ---------------------------------------------------------------- running a process

interface Ran { code: number | null; signal: string | null; timedOut: boolean; stoppedForBudget: boolean; ms: number; stdout: string; stderr: string; spawnError?: string }

function runProcess(plan: ExternalPlan, o: { env: Record<string, string>; cwd: string; timeoutMs: number; watch: () => Promise<boolean>; transcript: string }): Promise<Ran> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const keep = 6 * 1024 * 1024;
    let timedOut = false;
    let stoppedForBudget = false;
    let done = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(plan.cmd, plan.args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: [plan.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"], detached: true });
    } catch (err) {
      resolve({ code: null, signal: null, timedOut: false, stoppedForBudget: false, ms: 0, stdout: "", stderr: "", spawnError: (err as Error).message });
      return;
    }
    const log = fs.createWriteStream(o.transcript, { flags: "a" });
    const take = (which: "o" | "e") => (d: Buffer) => {
      const s = d.toString("utf8");
      log.write(s);
      if (which === "o") { stdout += s; if (stdout.length > keep * 2) stdout = stdout.slice(-keep); } else { stderr += s; if (stderr.length > keep * 2) stderr = stderr.slice(-keep); }
    };
    child.stdout?.on("data", take("o"));
    child.stderr?.on("data", take("e"));
    if (plan.stdin !== undefined) child.stdin?.end(plan.stdin);
    const kill = (): void => { try { process.kill(-child.pid!, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
    const poll = setInterval(() => { void o.watch().then((over) => { if (over && !done) { stoppedForBudget = true; setTimeout(kill, 3000).unref(); clearInterval(poll); } }); }, 1500);
    const finish = (code: number | null, signal: string | null, spawnError?: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      log.end();
      // Anything the agent left running in its process group goes too.
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* nothing left */ }
      resolve({ code, signal, timedOut, stoppedForBudget, ms: Date.now() - t0, stdout, stderr, ...(spawnError ? { spawnError } : {}) });
    };
    child.on("error", (err) => finish(null, null, err.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");

// ---------------------------------------------------------------- the agent

export function externalAgent(spec: ExternalSpec): AgentUnderTest {
  return {
    id: spec.id,
    describe: spec.describe,
    modes: ["real"],
    usesCheckout: true,
    async run(i: AgentRunInput): Promise<AgentRunResult> {
      const t0 = Date.now();
      const fail = (status: AgentStatus, reason: string): AgentRunResult => ({
        agent: spec.id, status, reason, answer: "", changes: [],
        metrics: { costPaise: 0, promptTokens: 0, completionTokens: 0, steps: 0, toolCalls: 0, toolErrors: 0, modelCalls: 0, wallMs: Date.now() - t0, models: {} }, transcriptPath: null,
      });
      const slug = i.model.slug ?? i.model.ladder?.[0];
      if (!slug) return fail("error", `${spec.id} needs one model: ModelSpec.slug`);
      if (!i.model.proxyUrl) return fail("error", `${spec.id} talks to the recording proxy: start it (npm run e2e:proxy) or run through the grid, which passes ModelSpec.proxyUrl`);
      const bin = toolBin(spec.tool);
      if (!bin) return fail("error", notInstalled(spec.tool));
      if (!i.checkout) return fail("error", `${spec.id} works in a checkout and was given none`);

      // The labelled URL, so that the proxy counts this run alone.
      const given = splitProxyUrl(i.model.proxyUrl);
      const label = given.label ?? labelFor([slug, spec.id, i.task.id, String(i.repeat)]);
      const baseUrl = `${given.root}/run/${label}/v1`;
      const capUsd = i.budgetPaise > 0 ? i.budgetPaise / 100 / fx() : 0;
      if (capUsd > 0) await setRunCap(given.root, label, capUsd);

      const runDir = path.join(WORK_DIR, `agent-${spec.id}-${uid(4)}`);
      const home = mkdirp(path.join(runDir, "home"));
      const tmp = mkdirp(path.join(runDir, "tmp"));
      const apiKey = fakeSecret("generic", uid(8));
      const plan = spec.plan({ taskId: i.task.id, request: i.request, bin, model: slug, baseUrl, apiKey, home, checkout: i.checkout, timeoutSec: i.timeoutSec, options: optionsFromEnv(spec.id) });
      for (const d of plan.dirs ?? []) mkdirp(path.join(home, d));
      for (const [f, text] of Object.entries(plan.files)) { mkdirp(path.dirname(f)); fs.writeFileSync(f, text); }
      await excludeFromGit(i.checkout, plan.exclude);

      // The project's own PATH (its binaries, its venv) and its own variables from repos.json: the commands the agent runs to test its work.
      let projectEnv: Record<string, string> = {};
      let projectPath = [path.join(i.checkout, "node_modules", ".bin"), process.env.PATH ?? ""].join(path.delimiter);
      if (i.task.repo !== "synthetic") {
        try { const r = getRepo(i.task.repo); projectEnv = r.env ?? {}; projectPath = checkoutEnv(r, {}, i.checkout).PATH ?? projectPath; } catch { /* a repo without an entry: the plain PATH */ }
      }
      const env = scrubbedEnv({ parent: { ...process.env, PATH: projectPath }, home, tmp, pathDirs: [toolBinDir(spec.tool) ?? path.dirname(bin), path.dirname(process.execPath)], projectEnv, extra: plan.env });

      mkdirp(path.join(i.outDir, "transcripts"));
      const transcript = path.join(i.outDir, "transcripts", `${i.task.id}-${spec.id}-${i.repeat}.log`);
      fs.writeFileSync(transcript, `$ ${[plan.cmd, ...plan.args].map((a) => (a === i.request ? "<the request>" : a)).join(" ")}\n# cwd ${i.checkout}\n\n`);
      i.log(`${spec.id}: ${slug} in ${path.basename(i.checkout)} via ${baseUrl}`);

      const ran = await runProcess(plan, {
        env, cwd: i.checkout, timeoutMs: Math.max(5, i.timeoutSec) * 1000, transcript,
        watch: async () => { if (capUsd <= 0) return false; const s = await fetchRunStats(given.root, label); return !!s && (s.refused > 0 || s.costUsd >= capUsd); },
      });
      const stats = await fetchRunStats(given.root, label);
      const stdout = redactKey(stripAnsi(ran.stdout), apiKey);
      const stderr = redactKey(stripAnsi(ran.stderr), apiKey);
      const dg = spec.digest({ stdout, stderr, home, checkout: i.checkout });
      rmrf(runDir);

      const budgetHit = ran.stoppedForBudget || (!!stats && (stats.refused > 0 || (capUsd > 0 && stats.costUsd >= capUsd)));
      let status: AgentStatus;
      let reason = "";
      if (ran.spawnError) { status = "error"; reason = `could not start ${spec.id}: ${ran.spawnError}`; }
      else if (ran.timedOut) { status = "timeout"; reason = `stopped after ${i.timeoutSec}s`; }
      else if (budgetHit) { status = "budget"; reason = `the run's budget (₹${(i.budgetPaise / 100).toFixed(2)}) was reached`; }
      else if (dg.verdict) { status = dg.verdict.status; reason = dg.verdict.reason; }
      else if (ran.code === 0) { status = "finished"; }
      else { status = "failed"; reason = `${spec.id} exited with ${ran.signal ?? ran.code}: ${lastLines(stderr || stdout, 3)}`; }

      const costUsd = stats?.costUsd ?? 0;
      const metrics: AgentMetrics = {
        costPaise: Math.round(costUsd * fx() * 100), promptTokens: stats?.promptTokens ?? 0, completionTokens: stats?.completionTokens ?? 0,
        steps: dg.steps || stats?.calls || 0, toolCalls: dg.toolCalls, toolErrors: dg.toolErrors, modelCalls: stats?.calls ?? 0, wallMs: Date.now() - t0, models: stats?.models ?? {},
      };
      return { agent: spec.id, status, reason, answer: dg.answer, metrics, transcriptPath: transcript };
    },
  };
}

/** The options an agent has, from the environment: E2E_<AGENT>_<OPTION>=value (the aider edit format, for one). */
export function optionsFromEnv(id: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const prefix = `E2E_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith(prefix) && v !== undefined && !SECRETISH.test(k)) out[k.slice(prefix.length).toLowerCase()] = v;
  return out;
}

const redactKey = (s: string, key: string): string => (key ? s.split(key).join("[fake-key]") : s);
const lastLines = (s: string, n: number): string => s.trim().split("\n").slice(-n).join(" | ").slice(0, 300);

/** Hides an agent's own files from git, so that the diff is its work and nothing else. */
async function excludeFromGit(checkout: string, patterns: readonly string[]): Promise<void> {
  if (!patterns.length) return;
  try {
    const rel = (await git(checkout, ["rev-parse", "--git-path", "info/exclude"])).trim();
    const file = path.isAbsolute(rel) ? rel : path.join(checkout, rel);
    mkdirp(path.dirname(file));
    const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    fs.writeFileSync(file, `${have}${have && !have.endsWith("\n") ? "\n" : ""}${patterns.join("\n")}\n`);
  } catch { /* not a git work tree: nothing to hide it from */ }
}

export { sleep };

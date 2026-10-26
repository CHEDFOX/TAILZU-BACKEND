/**
 * THE SCRIPT THAT RUNS ONE STEP ON GITHUB'S COMPUTER: `.tailzu/run.mjs`, AS TEXT.
 *
 * The provider (githubActions.ts) commits this file, byte for byte, to the
 * throwaway `tailzu-run/` branch of a step, next to `.tailzu/step.json` and the
 * workflow (shadow.ts, workflow.ts). The workflow checks the branch out and runs
 * `node .tailzu/run.mjs`. It is plain Node with no dependencies (only Node's
 * own modules) so the person's runner needs nothing installed, and it does five
 * things in order:
 *
 *   1. runs the step's commands one by one with `bash -lc`, each with the time
 *      the step has left, and stops at the first one that fails (a command
 *      that runs out of time is exit code 124);
 *   2. keeps the last 8 KB of what they printed, with obvious secrets (tokens,
 *      keys, `Authorization:` headers, `password=...`, the runner's own tokens)
 *      replaced by [redacted] BEFORE it is cut, so one can't be split by the cut;
 *   3. if they all passed, collects what changed against `baseSha` (the work
 *      branch's checkpoint): `git diff --name-status` for the list, and the text
 *      of every added or modified file. It never sends `.tailzu/` or the
 *      workflow file, a file over 1 MB, a binary file, a symlink, more than 200
 *      files, or more than 3 MB in total (measured as the JSON that carries it).
 *      Anything left out is named in the output tail, so nothing is lost
 *      silently. A step that failed sends no files: the server would ignore them;
 *   4. asks GitHub for an OIDC identity token for the audience in step.json,
 *      AFTER the commands (it is short-lived, and they may run for an hour);
 *   5. POSTs { jobId, stepIdx, epoch, exitCode, outputTail, minutes, changes }
 *      to the result address with `Authorization: Bearer <token>`. The server
 *      checks the token's signature, repository, branch, commit and workflow
 *      before it counts anything.
 *
 * The commands do not get the way to ask GitHub for an identity (the
 * ACTIONS_ID_TOKEN_* and ACTIONS_RUNTIME_TOKEN variables are taken out of their
 * environment first), so a command can't send a result of its own.
 *
 * The pure helpers (redact, tailOf, parseNameStatus, collectChanges...) are
 * exported so the tests can run them directly; the script only runs when node
 * is started on it. tests/code-github-actions.test.ts also runs it for real
 * against a temporary git repo and a local server.
 *
 * Written in a String.raw template: it must not hold a backtick or "${".
 */
export const RUN_MJS = String.raw`// Written by Tailzu for one step of a coding job. Do not edit: it is replaced for every step.
// Runs the commands in .tailzu/step.json, collects what they changed, and reports to Tailzu
// with a GitHub OIDC identity token. No dependencies: only Node's own modules.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TAIL_BYTES = 8 * 1024;
export const FILE_MAX_BYTES = 1024 * 1024;
export const TOTAL_MAX_BYTES = 3 * 1024 * 1024;
export const FILES_MAX = 200;
const HOLD_CHARS = 256 * 1024;
const PATH_MAX = 500;

/** The files this script and its workflow are made of: never part of the changes. */
export function isTailzuPath(path) {
  return /^\.tailzu(\/|$)/i.test(path) || path.toLowerCase() === ".github/workflows/tailzu-run.yml";
}

// ---------------------------------------------------------------- the output

const PATTERNS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, "[redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g, "[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,255}/g, "[redacted]"],
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/\bxapp-[0-9]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]+/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted]"],
  [/(authorization\s*[:=]\s*["']?(?:bearer|basic|token)\s+)[^\s"']+/gi, "$1[redacted]"],
  [/((?:api[_-]?key|apikey|secret(?:[_-]?key)?|client[_-]?secret|auth[_-]?token|access[_-]?token|private[_-]?key|password|passwd|token)["']?\s*[:=]\s*["']?)[A-Za-z0-9_\-+\/=.]{8,}/gi, "$1[redacted]"],
];

/** The text with obvious secrets replaced by [redacted]: known patterns, and the exact values in "known" (the runner's own tokens). */
export function redact(text, known) {
  let out = String(text);
  const values = (known || []).filter((v) => typeof v === "string" && v.length >= 8).sort((a, b) => b.length - a.length);
  for (const v of values) out = out.split(v).join("[redacted]");
  for (const [re, to] of PATTERNS) out = out.replace(re, to);
  return out;
}

/** The last "max" bytes of the text, never starting in the middle of a character. */
export function tailOf(text, max) {
  const limit = max === undefined ? TAIL_BYTES : max;
  const buf = Buffer.from(String(text), "utf8");
  if (buf.length <= limit) return String(text);
  let start = buf.length - limit;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start += 1;
  return buf.subarray(start).toString("utf8");
}

/** Values in the environment that look like secrets, so the output can be scrubbed of the exact text. */
export function secretValues(env) {
  const out = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length >= 8 && /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i.test(name)) out.push(value);
  }
  return out;
}

const HIDDEN_FROM_COMMANDS = ["ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_RUNTIME_TOKEN"];

/** The environment the commands get: ours, without the means to ask GitHub for an identity. */
export function commandEnv(env) {
  const out = { ...env };
  for (const k of HIDDEN_FROM_COMMANDS) delete out[k];
  return out;
}

// ------------------------------------------------------------ the commands

/**
 * One command in bash -lc, killed (its whole group) if it runs past "ms".
 * Resolves { code, timedOut } when the command has exited and its output has
 * been read, or a moment after it exited if something it left running still
 * holds the pipes open (a background server must not hang the step).
 */
function runOne(command, ms, o) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let timedOut = false;
    let gone = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      const g = gone || { code: 1, signal: null };
      resolve({ code: timedOut ? 124 : g.code === null ? (g.signal ? 128 : 1) : g.code, timedOut });
    };
    const take = (stream) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => o.onOutput(chunk));
    };
    take(child.stdout);
    take(child.stderr);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
    }, Math.max(1, ms));
    child.on("error", () => { gone = { code: 127, signal: null }; finish(); });
    child.on("exit", (code, signal) => { gone = { code, signal }; setTimeout(finish, 1500).unref(); });
    child.on("close", finish);
  });
}

/**
 * Runs the commands in order, stopping at the first that fails. Each gets the
 * time the whole step has left. Resolves { exitCode, output } with the last
 * part of what was printed (before redaction).
 */
export async function runCommands(commands, timeoutSec, o) {
  const now = o.now || Date.now;
  const deadline = now() + timeoutSec * 1000;
  let held = "";
  const add = (s) => {
    held += s;
    if (held.length > HOLD_CHARS * 2) held = held.slice(-HOLD_CHARS);
    if (o.echo) o.echo(s);
  };
  for (const command of commands) {
    const left = deadline - now();
    if (left <= 0) {
      add("\n[Tailzu: the step ran out of time before: " + command + "]\n");
      return { exitCode: 124, output: held };
    }
    add("$ " + command + "\n");
    const r = await runOne(command, left, { cwd: o.cwd, env: o.env, onOutput: add });
    if (r.timedOut) {
      add("\n[Tailzu: stopped after " + timeoutSec + " seconds, the time this step had]\n");
      return { exitCode: 124, output: held };
    }
    if (r.code !== 0) return { exitCode: r.code, output: held };
  }
  return { exitCode: 0, output: held };
}

// ----------------------------------------------------------- the changes

/** git diff --name-status --no-renames -z, read: [{ status: "A", path }, ...]. */
export function parseNameStatus(raw) {
  const parts = String(raw).split("\0");
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (!parts[i]) break;
    out.push({ status: parts[i].charAt(0), path: parts[i + 1] });
  }
  return out;
}

const BAD_PATH = /[\u0000-\u001f\u007f\\]/;

/**
 * The changes to send, from the diff entries. "read" gives { size, symlink,
 * bytes } for a path (or null when it is gone). Returns { changes, skipped }:
 * skipped is [{ path, why }] for what was left out and is worth saying
 * (nothing is said about .tailzu/ and the workflow, which are never changes).
 */
export function collectChanges(entries, read, limits) {
  const lim = Object.assign({ fileMax: FILE_MAX_BYTES, totalMax: TOTAL_MAX_BYTES, filesMax: FILES_MAX }, limits || {});
  const changes = [];
  const skipped = [];
  let total = 0;
  for (const e of entries) {
    if (isTailzuPath(e.path)) continue;
    if (e.path.length > PATH_MAX || BAD_PATH.test(e.path) || e.path.startsWith("/")) { skipped.push({ path: e.path, why: "odd path" }); continue; }
    if (changes.length >= lim.filesMax) { skipped.push({ path: e.path, why: "too many files" }); continue; }
    if (e.status === "D") { changes.push({ path: e.path, content: null }); continue; }
    if (e.status !== "A" && e.status !== "M") { skipped.push({ path: e.path, why: "not a plain file change" }); continue; }
    const f = read(e.path);
    if (!f) { skipped.push({ path: e.path, why: "gone before it was read" }); continue; }
    if (f.symlink || f.notFile) { skipped.push({ path: e.path, why: "not a plain file" }); continue; }
    if (f.size > lim.fileMax) { skipped.push({ path: e.path, why: "over 1 MB" }); continue; }
    let text;
    try {
      if (f.bytes.includes(0)) throw new Error("binary");
      text = new TextDecoder("utf-8", { fatal: true }).decode(f.bytes);
    } catch {
      skipped.push({ path: e.path, why: "not text" });
      continue;
    }
    const cost = Buffer.byteLength(JSON.stringify(text), "utf8");
    if (total + cost > lim.totalMax) { skipped.push({ path: e.path, why: "over the 3 MB total" }); continue; }
    total += cost;
    changes.push({ path: e.path, content: text });
  }
  return { changes, skipped };
}

/** One line for the output tail about what was left out; empty when nothing was. */
export function skippedNote(skipped) {
  if (!skipped.length) return "";
  const names = skipped.slice(0, 8).map((s) => s.path + " (" + s.why + ")").join(", ");
  return "\n[Tailzu: " + skipped.length + " changed file" + (skipped.length === 1 ? " was" : "s were") + " not sent: " + names + (skipped.length > 8 ? ", and more" : "") + "]";
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
}

function readFromTree(cwd) {
  return (path) => {
    let st;
    try { st = lstatSync(cwd + "/" + path); } catch { return null; }
    if (st.isSymbolicLink()) return { symlink: true };
    if (!st.isFile()) return { notFile: true };
    if (st.size > FILE_MAX_BYTES) return { size: st.size };
    return { size: st.size, bytes: readFileSync(cwd + "/" + path) };
  };
}

/** What the commands changed in the working tree against baseSha, as changes to send. */
export function changesAgainst(baseSha, cwd) {
  // Make new files show up in the diff (they are not tracked yet); what .gitignore hides stays hidden.
  git(["add", "-A", "-N"], cwd);
  const raw = git(["-c", "core.fileMode=false", "diff", "--name-status", "--no-renames", "-z", baseSha], cwd).toString("utf8");
  return collectChanges(parseNameStatus(raw), readFromTree(cwd));
}

// ------------------------------------------------------------ the report

/** An OIDC identity token from GitHub for this audience. */
export async function oidcToken(requestUrl, requestToken, audience, fetchFn) {
  const f = fetchFn || fetch;
  const u = new URL(requestUrl);
  u.searchParams.set("audience", audience);
  const res = await f(u, { headers: { authorization: "Bearer " + requestToken, accept: "application/json; api-version=2.0" } });
  if (!res.ok) throw new Error("GitHub would not give an identity token (" + res.status + ")");
  const j = await res.json();
  if (!j || typeof j.value !== "string" || !j.value) throw new Error("GitHub gave no identity token");
  return j.value;
}

/**
 * Sends the result. Tries again, a few times, for a network error or a 5xx or
 * 429; a refusal (4xx) is final, since asking again can't change it.
 * Resolves { ok, status }.
 */
export async function postResult(url, token, body, o) {
  const f = (o && o.fetchFn) || fetch;
  const sleep = (o && o.sleep) || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const text = JSON.stringify(body);
  let status = 0;
  for (const wait of [0, 2000, 5000, 15000]) {
    if (wait) await sleep(wait);
    try {
      const res = await f(url, {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: text,
        signal: AbortSignal.timeout(60000),
      });
      status = res.status;
      if (res.ok) return { ok: true, status };
      if (res.status < 500 && res.status !== 429) return { ok: false, status };
    } catch {
      status = 0;
    }
  }
  return { ok: false, status };
}

// ------------------------------------------------------------------ main

export async function main() {
  const started = Date.now();
  const cwd = process.cwd();
  const spec = JSON.parse(readFileSync(cwd + "/.tailzu/step.json", "utf8"));
  // Keep the way to ask GitHub for an identity out of the commands' reach, and ours for the report.
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const known = secretValues(process.env);

  const ran = await runCommands(spec.commands, spec.timeoutSec, { cwd, env: commandEnv(process.env), echo: (s) => process.stdout.write(s) });

  let changes = [];
  let note = "";
  if (ran.exitCode === 0) {
    try {
      const found = changesAgainst(spec.baseSha, cwd);
      changes = found.changes;
      note = skippedNote(found.skipped);
    } catch (err) {
      note = "\n[Tailzu: could not work out what the commands changed: " + String(err && err.message ? err.message : err).slice(0, 200) + "]";
    }
  }
  const outputTail = tailOf(redact(ran.output, known) + note, TAIL_BYTES);
  const body = {
    jobId: spec.jobId, stepIdx: spec.stepIdx, epoch: spec.epoch, exitCode: ran.exitCode, outputTail,
    minutes: Math.round(((Date.now() - started) / 60000) * 1000) / 1000, changes,
  };

  if (!requestUrl || !requestToken) {
    console.error("Tailzu: this run was not given an identity token (the workflow needs id-token: write).");
    process.exitCode = 1;
    return;
  }
  const token = await oidcToken(requestUrl, requestToken, spec.audience);
  const sent = await postResult(spec.resultUrl, token, body);
  // 409: the step was given to another computer meanwhile, which is not this run's failure.
  if (!sent.ok && sent.status !== 409) {
    console.error("Tailzu: could not report the result (" + (sent.status || "no answer") + ").");
    process.exitCode = 1;
    return;
  }
  process.exitCode = ran.exitCode === 0 ? 0 : 1;
}

function isMain() {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isMain()) {
  main().catch((err) => {
    console.error("Tailzu: " + String(err && err.message ? err.message : err));
    process.exitCode = 1;
  });
}
`;

/**
 * THE SCRIPT THAT RUNS ONE STEP ON GITHUB'S COMPUTER: `.tailzu/run.mjs`, AS TEXT.
 *
 * The provider (githubActions.ts) commits this file, byte for byte, to the
 * throwaway `tailzu-run/` branch of a step, next to `.tailzu/step.json` and the
 * workflow (shadow.ts, workflow.ts). The workflow checks the branch out and runs
 * `node .tailzu/run.mjs`. It is plain Node with no dependencies (only Node's
 * own modules) so the person's runner needs nothing installed, and it does six
 * things in order:
 *
 *   0. only when step.json carries an `overlay`: lays the agent's staged edits
 *      over the checkout, each file written (or removed, when its content is
 *      null) unless its path leaves the checkout, is in .git, is under .tailzu/,
 *      is a workflow, or reaches the checkout through a symlink. It is a TRIAL of
 *      edits that are not committed yet; what it could not lay is named at the
 *      top of the output. With `discard` in step.json, step 3 below is skipped:
 *      the step's changes are not wanted;
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
 * A LIVE SESSION. When step.json carries a `session` ({ url, ticket, idleSec, maxSec }) the script does something else (sessionMain): it does
 * not run `commands`. It opens a WebSocket to the job's room (Node's own global WebSocket, Node 22) with the one-time ticket, says hello, and
 * then, one at a time, does what the room sends: `exec` (lay the staged edits over the checkout, run the commands with a time limit each,
 * stream the output a line at a time with obvious secrets replaced), `grep` and `glob` (only for a repo too big for the room's own copy; git
 * grep and git ls-files, in the checkout), `cancel`, `ping`, and `close`. It leaves on the room's `close`, when the room has said nothing for
 * the idle time and a grace, or when the socket drops, and then reports to Tailzu as a step does (exit code 0 for a clean end), with the minutes
 * the session lasted. Between commands the checkout is put back as the branch has it (tracked files restored, files the last overlay made
 * removed) so each command sees "the branch plus the staged edits", with whatever the commands installed (node_modules, caches) kept. No token
 * that can write is on the machine: the checkout was made with persist-credentials: false.
 *
 * Written in a String.raw template: it must not hold a backtick or "${".
 */
export const RUN_MJS = String.raw`// Written by Tailzu for one step of a coding job. Do not edit: it is replaced for every step.
// Runs the commands in .tailzu/step.json, collects what they changed, and reports to Tailzu
// with a GitHub OIDC identity token. No dependencies: only Node's own modules.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, lstatSync, realpathSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
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

// ---------------------------------------------------------------- the overlay

/** A path from step.json that may be written under the checkout: inside it, not .git, not Tailzu's own files, not a workflow. */
export function overlayPathOk(path) {
  if (typeof path !== "string" || !path || path.length > PATH_MAX) return false;
  if (path.startsWith("/") || path.includes("\\") || BAD_PATH.test(path)) return false;
  if (path.split("/").some((p) => p === "" || p === "." || p === ".." || p.toLowerCase() === ".git")) return false;
  return !isTailzuPath(path) && !/^\.github\/workflows(\/|$)/i.test(path);
}

/**
 * Lays the step's files over the checkout: text written, or the file removed when
 * its content is null. A path that is not allowed, or whose folder is, or leads
 * through, a symlink out of the checkout, is skipped (and named). Returns
 * { written, removed, skipped }; skipped is the list of paths.
 */
export function applyOverlay(files, cwd) {
  const root = realpathSync(cwd);
  const out = { written: 0, removed: 0, skipped: [] };
  for (const f of Array.isArray(files) ? files : []) {
    const path = f && f.path;
    if (!overlayPathOk(path) || (f.content !== null && typeof f.content !== "string")) { out.skipped.push(String(path).slice(0, 120)); continue; }
    const target = resolve(root, path);
    try {
      if (f.content === null) {
        let there;
        try { there = realpathSync(dirname(target)); } catch { continue; }
        if (there !== root && !there.startsWith(root + sep)) { out.skipped.push(path); continue; }
        rmSync(target, { force: true });
        out.removed += 1;
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const folder = realpathSync(dirname(target));
      if (folder !== root && !folder.startsWith(root + sep)) { out.skipped.push(path); continue; }
      // Never write through a symlink at the file itself.
      try { if (lstatSync(target).isSymbolicLink()) rmSync(target); } catch { /* not there yet */ }
      writeFileSync(target, f.content);
      out.written += 1;
    } catch {
      out.skipped.push(path);
    }
  }
  return out;
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
    const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1, ms));
    if (o.signal) {
      if (o.signal.aborted) kill();
      else o.signal.addEventListener("abort", kill, { once: true });
    }
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
    const r = await runOne(command, left, { cwd: o.cwd, env: o.env, onOutput: add, signal: o.signal });
    if (o.signal && o.signal.aborted) {
      add("\n[Tailzu: stopped]\n");
      return { exitCode: 130, output: held };
    }
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

// ------------------------------------------------------------ a live session

/** The room's address with the one-time ticket in the query. */
export function sessionAddress(session) {
  return session.url + (session.url.indexOf("?") >= 0 ? "&" : "?") + "ticket=" + encodeURIComponent(session.ticket);
}

/** Paths whose text is never searched or listed: the same kinds the room never holds. */
export function secretish(path) {
  const b = String(path).split("/").pop().toLowerCase();
  if (/^\.env(\..+)?$/.test(b) && !/\.(example|sample|template|dist|defaults?|schema)$/.test(b)) return true;
  if (/\.(pem|key|p12|pfx|pkcs12|jks|keystore|crt|cer|der|p8|p7b|asc|ppk|kdbx|tfstate)$/.test(b)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pem)?$/.test(b)) return true;
  return /^(\.npmrc|\.pypirc|\.netrc|\.htpasswd|\.pgpass|credentials|credentials\.json|secrets?\.(ya?ml|json|toml))$/.test(b);
}

/**
 * A line-at-a-time stream of what the commands print: complete lines are redacted and sent, a half line waits for its end (or for the
 * flush). The lines of a private key are held back from its BEGIN line to its END line, which a pattern on one line cannot do.
 */
export function lineStreamer(send, known) {
  let pending = "";
  let inKey = false;
  const emit = (line) => {
    if (inKey) { if (/-----END [A-Z0-9 ]*PRIVATE KEY/.test(line)) inKey = false; return "[redacted]\n"; }
    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY/.test(line)) { inKey = true; return "[redacted]\n"; }
    return redact(line, known) + "\n";
  };
  let batch = "";
  const flushBatch = () => { if (batch) { send(batch); batch = ""; } };
  return {
    write(chunk) {
      pending += chunk;
      let at;
      while ((at = pending.indexOf("\n")) >= 0) {
        batch += emit(pending.slice(0, at));
        pending = pending.slice(at + 1);
        if (batch.length >= 16 * 1024) flushBatch();
      }
      if (pending.length > 64 * 1024) { batch += emit(pending); pending = ""; }
    },
    /** Sends what is waiting, including a half line. */
    flush() {
      if (pending) { batch += emit(pending).replace(/\n$/, ""); pending = ""; }
      flushBatch();
    },
    /** Sends the complete lines now (called on a short timer, so a slow command is seen as it goes). */
    tick() { flushBatch(); },
  };
}

function gitOk(args, cwd) {
  try { execFileSync("git", args, { cwd, stdio: "ignore" }); return true; } catch { return false; }
}

/**
 * Puts the checkout back as the branch has it, before the next command: tracked files restored (the commands may have rewritten a lockfile or
 * run a formatter), and files the previous overlay CREATED removed. Ignored and untracked files (node_modules, build output) are left: that is
 * what makes the second command quick. laid is the set of paths the last overlay touched; it is emptied.
 */
export function resetCheckout(cwd, laid) {
  gitOk(["checkout", "--", "."], cwd);
  for (const p of laid) {
    if (!overlayPathOk(p)) continue;
    if (!gitOk(["ls-files", "--error-unmatch", "--", p], cwd)) {
      try { rmSync(resolve(cwd, p), { force: true }); } catch { /* gone already */ }
    }
  }
  laid.clear();
}

/** git grep in the checkout, in ripgrep's output. PCRE where git has it (a runaway pattern hits PCRE's own backtrack limit), else POSIX. */
export function gitGrep(m, cwd) {
  const specs = [];
  const base = typeof m.path === "string" ? m.path.replace(/^\.\//, "").replace(/\/+$/, "") : "";
  if (m.glob) specs.push(":(glob)" + (String(m.glob).indexOf("/") >= 0 ? String(m.glob).replace(/^\//, "") : "**/" + m.glob));
  else if (base) specs.push(base);
  const run = (engine) => {
    const args = ["grep", "-n", "-I", "--no-color", engine];
    if (m.ignoreCase) args.push("-i");
    if (m.filesOnly) args.push("-l");
    else if (m.context) args.push("-C", String(Math.min(5, m.context)));
    args.push("-e", m.pattern, "--", ...(specs.length ? specs : ["."]));
    if (m.glob && base) args.push(base);
    try {
      return { out: execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
    } catch (err) {
      const code = err && typeof err.status === "number" ? err.status : 2;
      return { out: code === 1 ? "" : String(err && err.stdout ? err.stdout : ""), code, err: String(err && err.stderr ? err.stderr : err && err.message ? err.message : err) };
    }
  };
  let r = run("-P");
  if (r.code > 1 && /pcre|-P|perl/i.test(r.err || "")) r = run("-E");
  if (r.code > 1 && !r.out) return { ok: false, error: "git grep would not run that pattern: " + String(r.err || "").trim().split("\n")[0].slice(0, 200) };
  const max = Math.max(1, Math.min(500, m.maxResults || 100));
  const rows = [];
  let matches = 0;
  let partial = false;
  const files = new Set();
  for (const row of r.out.split("\n")) {
    if (!row) continue;
    if (row === "--") { rows.push(row); continue; }
    const hit = /^(.*?)([:-])(\d+)([:-])/.exec(row);
    const path = m.filesOnly ? row : hit ? hit[1] : row;
    if (secretish(path)) continue;
    const isMatch = m.filesOnly || (hit && hit[2] === ":");
    if (isMatch) {
      if (matches >= max) { partial = true; break; }
      matches += 1;
      files.add(path);
    }
    rows.push(row.length > 300 ? row.slice(0, 299) + "…" : row);
  }
  while (rows.length && rows[rows.length - 1] === "--") rows.pop();
  return { ok: true, text: rows.join("\n"), matches, files: files.size, partial };
}

/** git ls-files for a glob, the most recently changed first. */
export function gitGlob(m, cwd) {
  const g = String(m.pattern).replace(/^\.\//, "").replace(/^\//, "");
  const spec = ":(glob)" + (g.indexOf("/") >= 0 ? g : "**/" + g);
  let out;
  try { out = execFileSync("git", ["ls-files", "-z", "--", spec], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 20000 }); } catch { return { ok: false, error: "That glob is not one git can read." }; }
  const all = out.split("\0").filter((p) => p && !secretish(p));
  const stamp = (p) => { try { return lstatSync(cwd + "/" + p).mtimeMs; } catch { return 0; } };
  const sorted = all.slice(0, 5000).map((p) => [p, stamp(p)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
  const paths = sorted.slice(0, 500);
  return { ok: true, text: paths.join("\n"), paths, total: all.length, partial: all.length > paths.length };
}

/**
 * The session: connect, then do what the room sends, one thing at a time. Resolves { exitCode, reason, commands } when it is over. o is for the
 * tests: the WebSocket to use, the checkout, and how long the room may be silent.
 */
export async function runSession(spec, o) {
  const WS = (o && o.WebSocket) || globalThis.WebSocket;
  const cwd = (o && o.cwd) || process.cwd();
  const env = (o && o.env) || process.env;
  if (typeof WS !== "function") return { exitCode: 1, reason: "no WebSocket in this Node (need 22)", commands: 0 };
  const session = spec.session;
  const known = secretValues(env);
  const graceMs = Number(env.TAILZU_IDLE_GRACE_MS) || 90000;
  const silentMs = (o && o.silentMs) || (Math.max(1, Number(session.idleSec) || 120) * 1000 + graceMs);
  const laid = new Set();
  let ws;
  let busy = null;
  let commands = 0;
  let last = Date.now();
  let finish;
  const over = new Promise((r) => { finish = r; });
  let ended = false;
  const end = (exitCode, reason) => { if (ended) return; ended = true; finish({ exitCode, reason, commands }); };
  const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch { /* the socket is going */ } };

  try { ws = new WS(sessionAddress(session)); } catch (err) { return { exitCode: 1, reason: "could not open the socket: " + String(err && err.message ? err.message : err).slice(0, 100), commands: 0 }; }
  // Only between commands: the room says nothing while one runs, and the command has its own time limit.
  const watch = setInterval(() => { if (!busy && Date.now() - last > silentMs) { end(0, "the room was silent"); try { ws.close(); } catch { /* gone */ } } }, Math.min(1000, Math.max(50, silentMs / 4)));
  watch.unref();
  ws.addEventListener("open", () => send({ t: "hello", v: 1, kind: "github", name: "GitHub Actions", os: process.platform, node: process.version }));
  ws.addEventListener("error", () => end(1, "the socket failed"));
  ws.addEventListener("close", (ev) => end(ended ? 0 : (ev && ev.code === 1000) || ev.code === 1005 ? 0 : 1, "closed"));
  ws.addEventListener("message", (ev) => {
    last = Date.now();
    let m;
    try { m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8")); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "ping") { send({ t: "pong", at: m.at || 0 }); return; }
    if (m.t === "close") { end(0, String(m.reason || "closed")); try { ws.close(1000, "done"); } catch { /* gone */ } return; }
    if (m.t === "cancel") { if (busy && busy.id === m.id) busy.abort.abort(); return; }
    if (m.t === "grep" || m.t === "glob") {
      const r = m.t === "grep" ? gitGrep(m, cwd) : gitGlob(m, cwd);
      send(Object.assign({ t: "found", id: m.id }, r));
      return;
    }
    if (m.t !== "exec") return;
    if (busy) { send({ t: "error", id: m.id, code: "busy", message: "a command is already running" }); return; }
    const abort = new AbortController();
    busy = { id: m.id, abort };
    (async () => {
      const t0 = Date.now();
      try {
        resetCheckout(cwd, laid);
        const lay = applyOverlay(Array.isArray(m.overlay) ? m.overlay : [], cwd);
        for (const f of Array.isArray(m.overlay) ? m.overlay : []) if (f && overlayPathOk(f.path)) laid.add(f.path);
        const stream = lineStreamer((data) => send({ t: "out", id: m.id, data }), known);
        const timer = setInterval(() => stream.tick(), 100);
        if (lay.skipped.length) stream.write("[Tailzu: could not lay " + lay.skipped.slice(0, 5).join(", ") + "]\n");
        const ran = await runCommands(Array.isArray(m.commands) ? m.commands : [], Number(m.timeoutSec) > 0 ? Number(m.timeoutSec) : 600, { cwd, env: commandEnv(env), echo: (x) => stream.write(x), signal: abort.signal });
        clearInterval(timer);
        stream.flush();
        commands += 1;
        send({ t: "done", id: m.id, exitCode: ran.exitCode, ms: Date.now() - t0, timedOut: ran.exitCode === 124 });
      } catch (err) {
        send({ t: "error", id: m.id, code: "failed", message: String(err && err.message ? err.message : err).slice(0, 300) });
      } finally {
        busy = null;
        last = Date.now();
      }
    })();
  });
  const result = await over;
  clearInterval(watch);
  if (busy) busy.abort.abort();
  return result;
}

/** A session step: run the session, then report to Tailzu with the identity token, as a step does. */
export async function sessionMain(spec) {
  const started = Date.now();
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const ended = await runSession(spec, {});
  const minutes = Math.round(((Date.now() - started) / 60000) * 1000) / 1000;
  const note = "[Tailzu: live session ended (" + ended.reason + "); " + ended.commands + " command(s) run]";
  const body = { jobId: spec.jobId, stepIdx: spec.stepIdx, epoch: spec.epoch, exitCode: ended.exitCode, outputTail: note, minutes, changes: [] };
  if (!requestUrl || !requestToken) {
    console.error("Tailzu: this run was not given an identity token (the workflow needs id-token: write).");
    process.exitCode = 1;
    return;
  }
  const token = await oidcToken(requestUrl, requestToken, spec.audience);
  const sent = await postResult(spec.resultUrl, token, body);
  if (!sent.ok && sent.status !== 409) {
    console.error("Tailzu: could not report the result (" + (sent.status || "no answer") + ").");
    process.exitCode = 1;
    return;
  }
  process.exitCode = ended.exitCode === 0 ? 0 : 1;
}

// ------------------------------------------------------------------ main

export async function main() {
  const started = Date.now();
  const cwd = process.cwd();
  const spec = JSON.parse(readFileSync(cwd + "/.tailzu/step.json", "utf8"));
  if (spec.session && typeof spec.session.url === "string") return sessionMain(spec);
  // Keep the way to ask GitHub for an identity out of the commands' reach, and ours for the report.
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const known = secretValues(process.env);

  // The agent's staged edits go over the checkout first, so the commands see the code as it would be if they were committed.
  let laidNote = "";
  if (Array.isArray(spec.overlay) && spec.overlay.length) {
    const laid = applyOverlay(spec.overlay, cwd);
    laidNote = "[Tailzu: laid " + (laid.written + laid.removed) + " staged file(s) over the checkout" + (laid.skipped.length ? "; could not lay " + laid.skipped.slice(0, 5).join(", ") : "") + "]\n";
    process.stdout.write(laidNote);
  }

  const ran = await runCommands(spec.commands, spec.timeoutSec, { cwd, env: commandEnv(process.env), echo: (s) => process.stdout.write(s) });

  let changes = [];
  let note = "";
  if (ran.exitCode === 0 && !spec.discard) {
    try {
      const found = changesAgainst(spec.baseSha, cwd);
      changes = found.changes;
      note = skippedNote(found.skipped);
    } catch (err) {
      note = "\n[Tailzu: could not work out what the commands changed: " + String(err && err.message ? err.message : err).slice(0, 200) + "]";
    }
  }
  const outputTail = tailOf(redact(laidNote + ran.output, known) + note, TAIL_BYTES);
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

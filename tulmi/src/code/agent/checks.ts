/**
 * RUNNING THE PROJECT'S CHECKS IN ONE STEP, AND READING WHAT EACH ONE SAID.
 *
 * The baseline (before the first edit) and the verify (after the work) both want the
 * same thing: install, typecheck, lint, test and build, each with its OWN exit code and
 * the names of what failed, from one trip to a runner. A runner stops at the first
 * command that fails and keeps the last 8 KB of everything it printed, so run as they
 * are, a failing test would hide the lint and a long test log would push the typecheck
 * out of the tail. So each check is wrapped (wrapCheck) in a small shell snippet that
 *
 *   - runs the check in its folder, with all its output held in a variable,
 *   - prints only the LAST few hundred bytes of it (a share of the 8 KB, so every
 *     check's tail and marker survive),
 *   - then a marker line, `@@TAILZU_CHECK kind=test exit=1 secs=12`,
 *   - and always exits 0, so the next check runs.
 *
 * parseMarkers reads that back into one result per check, with the exit code, the time,
 * and the names of what failed (failingNames: vitest and jest, pytest, go, cargo, tsc,
 * ESLint), which is what compareToBaseline (work/findings.ts) needs to tell a test this
 * change broke from one that was already red. A name is a line as the tool printed it,
 * cut; the same output gives the same names, which is all the comparison asks.
 *
 * Output that the runner withheld because it looked like it held a secret has no
 * markers; the caller treats a run with none as "ran, but could not be read", never as
 * a pass.
 */
import type { BaselineKind, BaselineResult } from "../project/types.js";

export const CHECK_MARK = "@@TAILZU_CHECK";

export interface CheckSpec {
  kind: BaselineKind;
  cmd: string;
  /** The folder to run it in, relative to the repo's root; "" is the root. */
  cwd: string;
}

/** What a runner keeps of a step's output. The checks share it. */
const TAIL_BUDGET = 7000;
/** A command and a folder as a check may have them. */
export const CHECK_CMD_MAX = 1500;
const SAFE_DIR = /^[\w@.\-/ ]{1,200}$/;

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The shell snippet that runs one check, prints its tail and a marker, and exits 0. Throws for a command or folder it will not wrap. */
export function wrapCheck(c: CheckSpec, tailBytes: number): string {
  if (!c.cmd.trim() || c.cmd.length > CHECK_CMD_MAX) throw new Error("a check's command is empty or too long");
  if (c.cwd && (!SAFE_DIR.test(c.cwd) || c.cwd.split("/").includes(".."))) throw new Error("a check's folder is not one to cd into");
  const mark = (code: string, secs: string) => `echo "${CHECK_MARK} kind=${c.kind} exit=${code} secs=${secs}"`;
  return [
    ...(c.cwd ? [`cd ${quote(c.cwd)} || { ${mark("127", "0")}; exit 0; }`] : []),
    "t0=$(date +%s)",
    "out=$( (",
    c.cmd,
    ") 2>&1 )",
    "code=$?",
    `printf '%s\\n' "$out" | tail -c ${Math.max(200, Math.floor(tailBytes))}`,
    mark("$code", "$(( $(date +%s) - t0 ))"),
    "true",
  ].join("\n");
}

/** The commands for a step that runs all of these checks, one wrapped command each. */
export function checkCommands(checks: readonly CheckSpec[]): string[] {
  const each = Math.floor(TAIL_BUDGET / Math.max(1, checks.length));
  return checks.map((c) => wrapCheck(c, each));
}

// ------------------------------------------------------------------ reading

export interface ParsedCheck { kind: string; exitCode: number; secs: number; output: string }

const MARKER = new RegExp(`^${CHECK_MARK} kind=(\\w+) exit=(-?\\d+) secs=(\\d+)[ \\t]*$`, "gm");

/** One entry per marker in the output, with what was printed before it (since the marker before, or the start). */
export function parseMarkers(text: string): ParsedCheck[] {
  const out: ParsedCheck[] = [];
  let from = 0;
  for (const m of text.matchAll(MARKER)) {
    const at = m.index ?? 0;
    out.push({ kind: m[1]!, exitCode: Number(m[2]), secs: Number(m[3]), output: text.slice(from, at).replace(/^\n+/, "").trimEnd() });
    from = at + m[0].length;
  }
  return out;
}

const NAMES_MAX = 20;
const NAME_MAX = 200;
const clean = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

/** The names of what failed in a check's output, as the tool printed them. At most twenty, each once. */
export function failingNames(kind: string, output: string): string[] {
  const names = new Set<string>();
  const add = (s: string | undefined) => { const n = s ? clean(s) : ""; if (n && names.size < NAMES_MAX) names.add(n); };
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  if (kind === "test") {
    for (const m of text.matchAll(/^\s*(?:FAIL|✗|×|✕|✖)\s+(\S.*)$/gm)) add(m[1]);
    for (const m of text.matchAll(/^\s*●\s+(\S.*)$/gm)) add(m[1]);
    for (const m of text.matchAll(/^(?:FAILED|ERROR)\s+(\S+)/gm)) add(m[1]);
    for (const m of text.matchAll(/^--- FAIL: (\S+)/gm)) add(m[1]);
    for (const m of text.matchAll(/^test (\S+) \.\.\. FAILED/gm)) add(m[1]);
  } else if (kind === "typecheck" || kind === "build") {
    for (const m of text.matchAll(/^(\S+?\(\d+,\d+\): error TS\d+: .+)$/gm)) add(m[1]);
    for (const m of text.matchAll(/^(\S+:\d+:\d+) - error (TS\d+: .+)$/gm)) add(`${m[1]} error ${m[2]}`);
  }
  if (kind === "lint" || kind === "build") {
    let file = "";
    for (const line of text.split("\n")) {
      if (/^\S.*\.[A-Za-z0-9]{1,8}$/.test(line) && !/\s/.test(line.trim())) { file = line.trim(); continue; }
      const m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/.exec(line);
      if (m && file) add(`${file}:${m[1]}:${m[2]} ${m[3]} ${m[4]} ${m[5]}`);
    }
  }
  return [...names];
}

/** A line to say how a check went. */
function summaryOf(exitCode: number, output: string, names: readonly string[]): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  if (exitCode === 0) {
    const stat = [...lines].reverse().find((l) => /\b\d+\s+(?:passed|passing|tests?|suites?)\b/i.test(l));
    return clean(stat ?? "passed").slice(0, 300);
  }
  if (names.length) return clean(`${names.length} failing: ${names[0]}`).slice(0, 300);
  return clean(lines.at(-1) ?? `exit ${exitCode}`).slice(0, 300);
}

/** One result per check that printed its marker, in the order they ran. A kind the baseline does not know (`run`) is left out. */
export function resultsOf(parsed: readonly ParsedCheck[]): Array<BaselineResult & { output: string }> {
  const kinds: readonly string[] = ["install", "typecheck", "lint", "test", "build"];
  return parsed.filter((p) => kinds.includes(p.kind)).map((p) => {
    const failing = p.exitCode === 0 ? [] : failingNames(p.kind, p.output);
    return {
      kind: p.kind as BaselineKind, exitCode: p.exitCode, durationMs: p.secs * 1000, summary: summaryOf(p.exitCode, p.output, failing),
      ...(failing.length ? { failing } : {}), output: p.output,
    };
  });
}

/** The command a check prints in the work log. */
export const describeCheck = (c: CheckSpec): string => `${c.cwd ? `cd ${c.cwd} && ` : ""}${c.cmd}`;

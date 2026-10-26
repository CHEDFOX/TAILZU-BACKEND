/**
 * FINDINGS: WHAT THE CHECKS SAY, SORTED INTO "WE BROKE IT", "IT WAS ALREADY BROKEN" AND "WE FIXED IT", AND WHAT THE BOT NOTICES ON THE WAY.
 *
 * Before its first edit a job runs the project's own checks on the untouched
 * branch and keeps what they said (layer 4: baselinePlan, recordBaseline). After
 * its edits it runs them again. A red check proves nothing by itself: if the tests
 * were red when the bot arrived, a red test is the project's, not the bot's, and
 * blocking the pull request on it (or worse, "fixing" it) would be wrong twice.
 *
 *   compareToBaseline(baseline, results, { touched })
 *     broke           it passed at baseline and fails now: a blocker
 *     alreadyBroken   it failed at baseline too: flagged "was already broken
 *                     before Tailzu" and not ours
 *     fixed           it failed at baseline and passes now
 *     ignored         lint errors in files the change did not touch: the
 *                     project's lint debt is not the change's
 *
 * Things are told apart by name. A test is its name as printed; a lint problem is
 * its file and rule, line and column left out, because a line number moves when a
 * file is edited above it. A check that failed with no names (a build) is compared
 * as a whole. When a check was already failing and the baseline did not keep what
 * failed, Tailzu cannot prove the change made it worse, and says that instead of
 * claiming either. A check that has no baseline at all is "broke" when it fails:
 * nothing says it was red before.
 *
 * flagFinding({ severity, path, line?, text }, { log }) is for what the bot notices
 * while reading code it was not asked about: a bug, a security smell, dead code. It
 * is cleaned (a line, cut, nothing a secret scan flags) and written to the job's
 * work log, from where it goes into the PR body.
 */
import type { Baseline, BaselineKind, BaselineResult } from "../project/types.js";
import { cut, oneLine } from "./model.js";
import { redactText, type WorkLog } from "./worklog.js";

// ------------------------------------------------------------------ comparing

export type Verdict = "broke" | "already_broken" | "fixed";

export interface Failure {
  kind: BaselineKind;
  /** The test, or the lint problem, or the check itself when it named nothing. */
  name: string;
  path?: string;
  /** Why it is classed as it is, when that is worth saying. */
  note?: string;
}

export interface CheckVerdict {
  kind: BaselineKind;
  /** passed, or the check as a whole: it failed and broke / was broken / was fixed / failed the same way. */
  status: "passed" | Verdict | "unchanged_failing";
  exitCode: number;
  note?: string;
}

export interface Comparison {
  broke: Failure[];
  alreadyBroken: Failure[];
  fixed: Failure[];
  ignored: Failure[];
  checks: CheckVerdict[];
  /** The change broke nothing the baseline had passing. */
  ok: boolean;
  /** One line a person can read. */
  summary: string;
}

const norm = (p: string): string => p.replace(/^\.\//, "").replace(/\\/g, "/");

/** The file a lint problem or a failing test names, if its text starts with one. */
export function pathOfFailure(name: string): string | undefined {
  const m = /^\s*(?:✖\s*)?((?:[A-Za-z]:)?[\w@.\-/\\]+\.[A-Za-z0-9]{1,8})(?=[:\s(]|$)/.exec(name);
  return m ? norm(m[1]!) : undefined;
}

/** What makes two failures the same one: a test by its name, a lint problem by file and rule with the line and column taken out. */
export function identityOf(kind: BaselineKind, name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (kind !== "lint" && kind !== "typecheck") return n.replace(/\s*\(\d+(?:\.\d+)?\s*m?s\)\s*$/i, "").toLowerCase();
  // path:12:5 error  Unexpected any  no-explicit-any   ->   path  no-explicit-any
  const path = pathOfFailure(n);
  const rest = path ? n.slice(n.indexOf(path) + path.length).replace(/^[:\d]+/, "").replace(/\s*\(\d+,\d+\)/, "") : n;
  return `${path ?? ""} ${rest.replace(/\b(?:error|warning|warn)\b/gi, "").replace(/\s+/g, " ").trim()}`.toLowerCase().trim();
}

const baselineResults = (b: Baseline | readonly BaselineResult[] | null | undefined): readonly BaselineResult[] =>
  Array.isArray(b) ? b : (b as Baseline | null | undefined)?.recorded?.results ?? [];

export interface CompareOptions {
  /** The files the change touched: lint (and typecheck) problems count only here. */
  touched?: readonly string[];
}

export function compareToBaseline(baseline: Baseline | readonly BaselineResult[] | null | undefined, results: readonly BaselineResult[], o: CompareOptions = {}): Comparison {
  const before = new Map(baselineResults(baseline).map((r) => [r.kind, r]));
  const touched = new Set((o.touched ?? []).map(norm));
  const broke: Failure[] = [];
  const alreadyBroken: Failure[] = [];
  const fixed: Failure[] = [];
  const ignored: Failure[] = [];
  const checks: CheckVerdict[] = [];

  for (const now of results) {
    if (now.kind === "install") continue;
    const was = before.get(now.kind);
    const wasFailing = was !== undefined && was.exitCode !== 0;
    const nowNames = (now.failing ?? []).filter(Boolean);
    const wasNames = (was?.failing ?? []).filter(Boolean);
    const wasSet = new Set(wasNames.map((n) => identityOf(now.kind, n)));
    const nowSet = new Set(nowNames.map((n) => identityOf(now.kind, n)));
    // Lint and typecheck problems belong to the change only in the files it touched.
    const scoped = now.kind === "lint" || now.kind === "typecheck";

    if (now.exitCode === 0) {
      if (wasFailing) {
        checks.push({ kind: now.kind, status: "fixed", exitCode: 0 });
        if (wasNames.length) for (const n of wasNames) fixed.push({ kind: now.kind, name: n, ...(pathOfFailure(n) ? { path: pathOfFailure(n) } : {}) });
        else fixed.push({ kind: now.kind, name: now.kind });
      } else {
        checks.push({ kind: now.kind, status: "passed", exitCode: 0 });
      }
      continue;
    }

    // It fails now.
    if (nowNames.length) {
      let mine = 0;
      for (const n of nowNames) {
        const path = pathOfFailure(n);
        const f: Failure = { kind: now.kind, name: n, ...(path ? { path } : {}) };
        if (wasSet.has(identityOf(now.kind, n))) { alreadyBroken.push({ ...f, note: "was already broken before Tailzu" }); continue; }
        if (was && wasFailing && wasNames.length === 0) {
          alreadyBroken.push({ ...f, note: "was already failing before Tailzu, and what failed was not recorded, so Tailzu cannot tell if its change made it worse" });
          continue;
        }
        if (scoped && path && !touched.has(path)) { ignored.push({ ...f, note: "in a file this change did not touch" }); continue; }
        broke.push({ ...f, ...(was ? {} : { note: "no baseline was recorded for this check" }) });
        mine += 1;
      }
      // What failed before and no longer does.
      for (const n of wasNames) if (!nowSet.has(identityOf(now.kind, n))) fixed.push({ kind: now.kind, name: n, ...(pathOfFailure(n) ? { path: pathOfFailure(n) } : {}) });
      const status: CheckVerdict["status"] = mine > 0 ? "broke" : wasFailing ? "already_broken" : "passed";
      checks.push({ kind: now.kind, status, exitCode: now.exitCode });
      continue;
    }

    // It failed and named nothing: judge the check as a whole.
    if (wasFailing) {
      alreadyBroken.push({ kind: now.kind, name: now.kind, note: "was already broken before Tailzu" });
      checks.push({ kind: now.kind, status: "already_broken", exitCode: now.exitCode });
    } else {
      broke.push({ kind: now.kind, name: now.kind, ...(was ? {} : { note: "no baseline was recorded for this check" }) });
      checks.push({ kind: now.kind, status: "broke", exitCode: now.exitCode });
    }
  }

  const ok = broke.length === 0;
  const parts = [
    broke.length ? `${broke.length} thing${broke.length === 1 ? "" : "s"} this change broke` : "nothing this change broke",
    ...(alreadyBroken.length ? [`${alreadyBroken.length} already broken before Tailzu`] : []),
    ...(fixed.length ? [`${fixed.length} fixed`] : []),
    ...(ignored.length ? [`${ignored.length} lint problem${ignored.length === 1 ? "" : "s"} in files it did not touch, not counted`] : []),
  ];
  return { broke, alreadyBroken, fixed, ignored, checks, ok, summary: `${parts.join("; ")}.` };
}

/** Writes a comparison into the job's work log: the checks with their verdict, a risk finding for each thing broken and an info one for each thing already broken. */
export async function logComparison(log: WorkLog, c: Comparison, results: readonly (BaselineResult & { cmd?: string })[]): Promise<void> {
  const verdictOf = new Map(c.checks.map((x) => [x.kind, x]));
  for (const r of results) {
    const v = verdictOf.get(r.kind);
    await log.command(r.cmd ?? r.kind, {
      kind: r.kind, exitCode: r.exitCode, durationMs: r.durationMs, summary: r.summary,
      ...(v && v.status !== "passed" && v.status !== "unchanged_failing" ? { verdict: v.status } : {}),
    });
  }
  for (const f of c.broke.slice(0, 20)) await log.finding({ severity: "risk", path: f.path ?? f.kind, text: `This change broke ${f.kind}: ${cut(f.name, 160)}${f.note ? ` (${f.note})` : ""}` });
  for (const f of c.alreadyBroken.slice(0, 10)) await log.finding({ severity: "info", path: f.path ?? f.kind, text: `${cut(f.name, 160)} ${f.note ?? "was already broken before Tailzu"}.` });
}

// ------------------------------------------------------------------- flagging

export type Severity = "info" | "warn" | "risk";

export interface Finding { severity: Severity; path: string; line?: number; text: string }

const SEVERITIES: readonly Severity[] = ["info", "warn", "risk"];

/**
 * What the bot noticed while reading, as it is kept: a known severity (info if it
 * is anything else), a path, a line if it is a whole number, and one short line of
 * words, cut, with nothing a secret scan flags. Null for a finding with no words
 * or no path.
 */
export function cleanFinding(f: { severity?: unknown; path?: unknown; line?: unknown; text?: unknown }): Finding | null {
  const path = typeof f.path === "string" ? redactText(f.path, 300).trim() : "";
  const text = redactText(oneLine(f.text, 400), 300);
  if (!path || !text) return null;
  const severity = SEVERITIES.find((s) => s === f.severity) ?? "info";
  const line = typeof f.line === "number" && Number.isInteger(f.line) && f.line > 0 ? f.line : undefined;
  return { severity, path, ...(line !== undefined ? { line } : {}), text };
}

/**
 * Records something noticed while reading code the bot was not asked about (a bug,
 * a security smell, dead code): cleaned (cleanFinding), and written to the job's
 * work log when there is one, from where it goes into the PR body. Returns what
 * was kept, or null.
 */
export async function flagFinding(f: { severity?: unknown; path?: unknown; line?: unknown; text?: unknown }, o: { log?: WorkLog } = {}): Promise<Finding | null> {
  const clean = cleanFinding(f);
  if (clean && o.log) await o.log.finding(clean);
  return clean;
}

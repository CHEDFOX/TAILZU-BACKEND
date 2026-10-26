/**
 * THE BASELINE: WHAT "HEALTHY" MEANT BEFORE THE BOT TOUCHED ANYTHING.
 *
 * A change that "breaks the build" has only broken it if it was not already
 * broken. So before a job's first edit, the project's own checks are run once on
 * the untouched branch, and what they said is kept: install, typecheck, lint,
 * test, build, each with its exit code, how long it took, a line about it and
 * the names of what failed. Later work compares its findings against this.
 *
 * THIS FILE RUNS NOTHING. It does two things:
 *
 *   baselinePlan   the list of checks to run, from the scripts the scan found
 *                  (structure.commands): `[{ kind, cmd, cwd }]`, in the order
 *                  install, typecheck, lint, test, build. A root-level command
 *                  of a kind stands for the whole repo; only where the root has
 *                  none are the packages' own used (four at most per kind).
 *                  Layer 8's agent loop hands the plan to the environment router
 *                  (code/jobs) as the first step of a job.
 *   recordBaseline what the run said, once it has, written to the brain with the
 *                  commit it was run at. A summary or a failing name that looks
 *                  like it holds a secret is replaced by a note; a line is cut
 *                  to 300 characters, a name to 200, twenty names to a check.
 */
import { scanForSecrets } from "../policy.js";
import { withBaseline } from "./memory.js";
import { projectBrainStore, type ProjectBrainStore } from "./store.js";
import type { Baseline, BaselineKind, BaselineResult, BaselineStep, Command } from "./types.js";

export const BASELINE_KINDS: readonly BaselineKind[] = ["install", "typecheck", "lint", "test", "build"];
const PER_KIND_PACKAGES = 4;
const STEPS_MAX = 14;

export function baselinePlan(commands: readonly Command[]): BaselineStep[] {
  const out: BaselineStep[] = [];
  for (const kind of BASELINE_KINDS) {
    const of = commands.filter((c) => c.kind === kind);
    const root = of.filter((c) => c.cwd === "");
    const picked = root.length ? root : of.slice(0, PER_KIND_PACKAGES);
    for (const c of picked) if (!out.some((o) => o.kind === kind && o.cmd === c.cmd && o.cwd === c.cwd)) out.push({ kind, cmd: c.cmd, cwd: c.cwd });
  }
  return out.slice(0, STEPS_MAX);
}

const WITHHELD = "(withheld: it looked like it held a secret)";

/** Text from a run as it is kept: one line, cut, and replaced if the secret scan flags it. */
function safe(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const one = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!one) return "";
  if (scanForSecrets([{ path: "baseline.log", content: one }]).length) return WITHHELD;
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** The results as they are kept. A result with a kind we don't know, or an exit code that isn't a whole number, is left out. */
export function cleanResults(results: readonly BaselineResult[]): BaselineResult[] {
  const out: BaselineResult[] = [];
  for (const r of results) {
    if (!r || !BASELINE_KINDS.includes(r.kind) || !Number.isInteger(r.exitCode)) continue;
    const failing = Array.isArray(r.failing) ? r.failing.slice(0, 20).map((f) => safe(f, 200)).filter(Boolean) : [];
    out.push({
      kind: r.kind, exitCode: r.exitCode, durationMs: Number.isFinite(r.durationMs) && r.durationMs > 0 ? Math.round(r.durationMs) : 0,
      summary: safe(r.summary, 300), ...(failing.length ? { failing } : {}),
    });
  }
  return out;
}

/**
 * Keeps what the first run of the checks said, for this project, at this
 * commit. Replaces an earlier record. Returns the baseline as kept, or null if
 * the project has no brain yet (nothing to record it against) or no result was
 * usable. The memory's "Baseline health" section is brought up to date.
 */
export async function recordBaseline(
  projectId: string, headSha: string, results: readonly BaselineResult[], o: { store?: ProjectBrainStore; now?: () => number } = {},
): Promise<Baseline | null> {
  const store = o.store ?? projectBrainStore();
  const brain = await store.getBrain(projectId);
  const clean = cleanResults(results);
  if (!brain || !clean.length || typeof headSha !== "string" || !/^[0-9a-f]{7,40}$/.test(headSha)) return null;
  const baseline: Baseline = {
    plan: brain.baseline?.plan ?? baselinePlan(brain.structure.commands),
    recorded: { headSha, at: (o.now ?? Date.now)(), results: clean, healthy: clean.every((r) => r.exitCode === 0) },
  };
  await store.saveBrain(projectId, { baseline, memory: withBaseline(brain.memory, baseline) });
  return baseline;
}

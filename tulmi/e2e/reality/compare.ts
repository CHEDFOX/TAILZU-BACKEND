/**
 * ONE COMPARISON, RUN IN ROUNDS, STOPPED THE MOMENT THE ANSWER IS CLEAR.
 *
 * The arms (our agent, aider, opencode, ...; or one agent with several models) run the SAME tasks, interleaved: for each task in the stratified order, every arm that
 * is still in runs it before the next task starts. After each round of tasks the numbers are read (stats.ts `decide`):
 *
 *   - an arm that another arm beats on success rate AND on cost per success, each with probability 0.9, is DROPPED: it is not paid to lose on the rest;
 *   - if the leader is the best with probability 0.9, or is the last arm in, the comparison is DECIDED and stops: no more tasks are added;
 *   - otherwise more tasks are added, but only while there is money and only for the arms still in contention (the intervals still overlap);
 *   - when the tasks run out with no winner it ends as a TIE and says so, with the intervals.
 *
 * REPEATS are for unstable results only: a run that disagrees with what the store already knew of that arm and task, or that shows signs of trouble in the run itself
 * (a timeout, model calls that failed on the way) is run again, up to `maxRepeats` more times. A task counts ONCE in an arm's success rate however often it was run
 * (it passed if it passed on at least half of its runs, a flaky task never counts as a clean pass), while all the money spent on it counts in the cost.
 *
 * A result already in the store for the same agent, model, task, code and prompt is used and not paid for again (and costs its recorded rupees in the cost per success).
 */
import type { Task } from "../tasks/schema.js";
import type { Executor } from "./exec.js";
import { isUnstable, type Perf } from "./perf.js";
import { decide, type Decision, type Run } from "./stats.js";
import type { ResultKey, ResultsStore, StoredResult } from "./store.js";
import type { Arm, ComparisonReport } from "./types.js";

/** The spend the comparison may make: asked before every run, charged after it. Throws (an overrun) when the stage went 30% past its estimate. */
export interface Allowance {
  leftInr(): number;
  /** Called with what a run cost; may throw StageOverrun. */
  charge(inr: number, what: string): void;
}

export class StageOverrun extends Error {
  constructor(readonly stage: number, readonly spentInr: number, readonly estimateInr: number) {
    super(`stage ${stage} has spent ₹${spentInr.toFixed(2)}, more than 30% over its estimate of ₹${estimateInr.toFixed(2)}: the stage is stopped`);
    this.name = "StageOverrun";
  }
}

export interface CompareOptions {
  id: string;
  title: string;
  group: "agents" | "models";
  arms: readonly Arm[];
  /** In the stratified order: the cover first. */
  tasks: readonly Task[];
  exec: Executor;
  store: ResultsStore;
  /** The key of a run: what makes two runs the same measurement. */
  key: (arm: Arm, task: Task) => ResultKey;
  allowance: Allowance;
  confidence?: number;
  /** Tasks every arm runs before anything is concluded (and in the first round). */
  minTasks?: number;
  /** Tasks added per round after the first. */
  roundSize?: number;
  /** More runs allowed for one unstable (arm, task). */
  maxRepeats?: number;
  /** What one task may cost an arm at most, in rupees. */
  taskCapInr?: number;
  seed?: number;
  /** What a result is called in the store (kind "task"), and the source it is written with. */
  source: "real" | "sim" | "replay";
  runId: string;
  log: (s: string) => void;
  /** Called with every run so the caller can write it to the store. */
  onRun?: (arm: Arm, task: Task, repeat: number, outcome: { ok: boolean; costInr: number; wallMs: number; perf: Perf; quality: number; detail: string }) => void;
  isStopped?: () => boolean;
}

interface Cell { task: string; runs: Array<{ ok: boolean; costInr: number; perf: Perf; reused: boolean; repeat: number }> }

const cellOk = (c: Cell): boolean => c.runs.filter((r) => r.ok).length * 2 > c.runs.length;
const cellCost = (c: Cell): number => c.runs.reduce((n, r) => n + r.costInr, 0);

export async function compare(o: CompareOptions): Promise<ComparisonReport> {
  const confidence = o.confidence ?? 0.9;
  const minTasks = Math.max(2, o.minTasks ?? 4);
  const roundSize = Math.max(1, o.roundSize ?? 2);
  const maxRepeats = o.maxRepeats ?? 1;
  const cells = new Map<string, Cell[]>(o.arms.map((a) => [a.id, []]));
  let alive = [...o.arms];
  const out = new Set<string>();
  const rounds: ComparisonReport["rounds"] = [];
  const allRuns: ComparisonReport["runs"] = [];
  let at = 0;
  let round = 0;
  let ended: ComparisonReport["ended"] = "tie";
  let last: Decision = decide(o.arms.map((a) => ({ id: a.id, runs: [] })), { confidence, minN: minTasks });
  let budgetStop = false;
  /** Runs that could not be made, by reason: one line per round and not one per run. */
  const skips = new Map<string, number>();

  const armRuns = (): Array<{ id: string; runs: Run[] }> => o.arms.map((a) => ({ id: a.id, runs: (cells.get(a.id) ?? []).map((c) => ({ ok: cellOk(c), costInr: cellCost(c) })) }));

  try {
    while (at < o.tasks.length && alive.length > 1 && !budgetStop && !o.isStopped?.()) {
      round += 1;
      const batch = o.tasks.slice(at, at + (round === 1 ? minTasks : roundSize));
      at += batch.length;
      const spent0 = o.exec.spentInr();
      for (const task of batch) {
        for (const arm of alive) {
          const key = o.key(arm, task);
          const cell: Cell = { task: task.id, runs: [] };
          const stored = o.store.runs(key);
          if (stored.length) {
            for (const [i, r] of stored.entries()) { cell.runs.push({ ok: r.ok, costInr: r.costInr, perf: r.perf ?? emptyPerf(r), reused: true, repeat: i + 1 }); }
            o.log(`  ${arm.id} ${task.id}: ${stored.length} result(s) already in the store (${stored.at(-1)!.ok ? "pass" : "fail"}), not paid again`);
          } else {
            const earlier = o.store.history("task", arm.agent, arm.model, task.id).map((r) => r.ok);
            let repeat = 1;
            for (;;) {
              if (o.allowance.leftInr() < 0.05 && o.exec.mode === "real") { budgetStop = true; break; }
              const res = await o.exec.task(arm, task, { repeat, budgetInr: Math.min(o.allowance.leftInr(), o.taskCapInr ?? Number.POSITIVE_INFINITY), index: at });
              if (res.skipped) { skips.set(res.skipped, (skips.get(res.skipped) ?? 0) + 1); if (/budget/.test(res.skipped)) budgetStop = true; break; }
              cell.runs.push({ ok: res.ok, costInr: res.costInr, perf: res.perf, reused: false, repeat });
              o.onRun?.(arm, task, repeat, res);
              o.allowance.charge(res.costInr, `${arm.id} ${task.id}`);
              o.log(`  ${arm.id} ${task.id}${repeat > 1 ? ` #${repeat}` : ""}: ${res.ok ? "pass" : "FAIL"}  ₹${res.costInr.toFixed(2)}  ${res.ok ? "" : res.detail.slice(0, 110)}`);
              const history = [...earlier, ...cell.runs.slice(0, -1).map((r) => r.ok)];
              if (repeat > maxRepeats || !isUnstable(res.perf, history)) break;
              repeat += 1;
            }
            if (budgetStop && !cell.runs.length) break;
          }
          if (cell.runs.length) cells.get(arm.id)!.push(cell);
        }
        if (budgetStop) break;
      }
      for (const [armId, cs] of cells) for (const c of cs) for (const r of c.runs) if (!allRuns.some((x) => x.arm === armId && x.task === c.task && x.repeat === r.repeat)) allRuns.push({ arm: armId, task: c.task, repeat: r.repeat, ok: r.ok, costInr: r.costInr, perf: r.perf, reused: r.reused });
      // Every live arm has run the same tasks (unless a run was skipped): read the numbers.
      const common = Math.min(...alive.map((a) => cells.get(a.id)!.length));
      last = decide(armRuns(), { confidence, minN: Math.min(minTasks, Math.max(1, common)), ...(o.seed !== undefined ? { seed: o.seed } : {}), out: [...out] });
      for (const d of last.drop) { out.add(d); }
      alive = alive.filter((a) => !out.has(a.id));
      rounds.push({ round, tasks: batch.map((t) => t.id), decision: last, spentInr: o.exec.spentInr() - spent0 });
      for (const [why, n] of skips) o.log(`  ${n} run(s) not made: ${why}`);
      skips.clear();
      o.log(`  round ${round}: ${last.reason}${last.drop.length ? `; dropped ${last.drop.join(", ")}` : ""}`);
      if (last.decided) { ended = last.state === "last" ? "last" : "clear"; break; }
      if (budgetStop) { ended = "budget"; break; }
      if (alive.length <= 1) { ended = "last"; break; }
    }
  } catch (err) {
    if (err instanceof StageOverrun) ended = "overrun"; else throw err;
  }
  if (ended === "tie" && !last.decided) {
    if (budgetStop) ended = "budget";
    else if (o.isStopped?.()) ended = "short";
    else if (last.state === "short") ended = "short";
  }
  const cellsRun = [...cells.values()].reduce((n, cs) => n + cs.length, 0);
  const none = "no task could be run here (every run was skipped: not recorded, no money, or not installed)";
  const final = rounds.length ? { ...last, ...(cellsRun === 0 ? { reason: none } : {}) } : decide(armRuns(), { confidence, minN: minTasks, out: [...out] });
  return {
    id: o.id, title: o.title, group: o.group, tasks: o.tasks.slice(0, at).map((t) => t.id), arms: o.arms.map((a) => a.id), rounds, final, ended,
    winner: ended === "clear" || ended === "last" ? final.leader : null,
    // What the stopping rule did not run: the arm x task cells of the full comparison that were never needed.
    runsSaved: Math.max(0, o.arms.length * o.tasks.length - cellsRun), runs: allRuns, repeats: allRuns.filter((r) => r.repeat > 1).length,
  };
}

/** A stored run that has no Perf of its own (a result written before the plan): enough to be counted. */
function emptyPerf(r: StoredResult): Perf {
  return {
    success: r.ok, stage: null, cause: "", reason: r.detail ?? "", costInr: r.costInr, wallMs: r.wallMs, timeToGreenMs: r.ok ? r.wallMs : null, steps: 0, turns: 0, runnerSteps: 0, toolCalls: 0, toolErrors: 0, failedReads: 0, failedEdits: 0, reAsks: 0, wastedSteps: 0,
    questions: 0, regressions: 0, attackSuccess: null, secretLeak: null, modelCalls: 0, failedModelCalls: 0, flakySignals: [], harness: [], detail: "coarse",
  };
}

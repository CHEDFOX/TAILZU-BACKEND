/**
 * THE STRATIFIED SAMPLE: THE SMALLEST SET OF TASKS THAT TOUCHES EVERYTHING, WEIGHTED TOWARD WHAT FAILED BEFORE.
 *
 * Sixty-five tasks (the real projects' bugs, features, refactors, questions, screens, vague, hostile, broken and language tasks, and the disruptions; the 20 injection
 * cases and the 5 smoke tasks have their own suites) cost a lot to run for every question. Most questions are answered by a dozen well-chosen ones: one of each KIND
 * of work, and every STAGE of the flow exercised at least once. This picks them.
 *
 *   the universe     the ten categories (bug, feature, refactor, question, ui, vague, hostile, broken, language, disruption) and the seven stages of the flow (front door,
 *                    locate, plan, work, verify, design, commit), as far as the tasks that can run here have them
 *   a task covers    its category, and the stages it exercises: a question has no plan and no commit; a screenshot task is the only kind that has a design stage
 *   the cover        a greedy set cover: the task that covers the most still-uncovered items, ties broken toward what failed before (the prior failure rate of its
 *                    category and stages, and its own history), then toward the cheaper and the already-answered (a task with a result in the store costs nothing)
 *   the rest         to the target size (about 12 for quick, 24 for standard, all for deep), by marginal diversity: a category or project not yet seen first, then
 *                    what failed before, then the cheaper; the list is ordered so that every prefix is itself stratified (the comparisons add tasks in this order)
 *
 * A task whose project cannot be installed here is SKIPPED with the reason ("needs a session where installs are allowed"), and its category is covered by another
 * task of the category if there is one. Deterministic: the same inputs give the same list (ties break on the id).
 */
import { REAL_SHAPE } from "../smoke/estimate.js";
import type { Task } from "../tasks/schema.js";

export const CATEGORIES_REQUIRED = ["bug", "feature", "refactor", "question", "ui", "vague", "hostile", "broken", "language", "disruption"] as const;
export const STAGES_REQUIRED = ["front", "locate", "plan", "work", "verify", "design", "commit"] as const;
export type StageName = (typeof STAGES_REQUIRED)[number];

/**
 * How often each stage and category failed in the two real smoke runs (RESULTS-2026-10-27 and -28, 9 items twice): work 5 of 10, plan 3 of 8, locate 2 of 8,
 * front door 1 of 12, commit and verify none. Replaced, as the store fills, by what the store says.
 */
export const PRIOR_STAGE_FAIL: Readonly<Record<StageName, number>> = { front: 0.08, locate: 0.25, plan: 0.38, work: 0.5, verify: 0, design: 0.3, commit: 0.1 };
export const PRIOR_CATEGORY_FAIL: Readonly<Record<string, number>> = { bug: 0, feature: 0.5, question: 1, hostile: 1 };
/** A category nothing is known about is neither safe nor known to be bad: a middling prior, so it is looked at. */
export const UNKNOWN_FAIL = 0.3;

/** Whether a task expects the bot to change files (the others are answers and refusals). */
export function expectsChange(t: Task): boolean {
  return !(t.checks.expectNoChange ?? t.category === "question") && t.oracle.kind !== "answer" && t.oracle.kind !== "refuse";
}

/** The stages of the flow a task exercises (the ones its score can be judged on; see score/stages.ts). */
export function stagesOf(t: Task): StageName[] {
  const change = expectsChange(t);
  const out: StageName[] = ["front", "work"];
  if (change && t.truth.files.length > 0) out.push("locate");
  if (change) out.push("plan");
  if (change && t.repo !== "synthetic" && (t.checks.suite ?? true)) out.push("verify");
  if (t.checks.design) out.push("design");
  if (change && (t.checks.expectPr ?? true)) out.push("commit");
  return STAGES_REQUIRED.filter((s) => out.includes(s));
}

/** What a task is worth running in this plan: the tasks of the real projects, not the injection cases and not the smoke tasks. */
export function planPool(all: readonly Task[]): Task[] {
  return all.filter((t) => !t.tags.includes("smoke") && !t.tags.includes("injection-suite"));
}

export interface TaskHistory { runs: number; fails: number }

export interface SamplerInput {
  tasks: readonly Task[];
  /** About how many to pick (the cover is always picked, even when it is larger). */
  target: number;
  /** What each task did before (the store, any code), by task id. */
  history?: ReadonlyMap<string, TaskHistory>;
  stageFail?: Partial<Record<StageName, number>>;
  categoryFail?: Readonly<Record<string, number>>;
  /** Rupees a task is expected to cost; a task already answered in the store costs 0 (pass `answered`). Default: the size of its category in REAL_SHAPE. */
  cost?: (t: Task) => number;
  answered?: ReadonlySet<string>;
  /** Tasks that cannot run here, with the reason (a project that is not installed). */
  blocked?: ReadonlyMap<string, string>;
}

export interface Sample {
  /** In the order the comparisons add them: the cover first, then the rest by diversity. */
  ordered: Task[];
  /** The smallest set found that covers every category and stage that can be covered. */
  cover: Task[];
  /** What the cover (and the whole sample) covers. */
  covered: { categories: string[]; stages: StageName[] };
  /** Categories and stages that nothing runnable has. */
  uncovered: string[];
  skipped: Array<{ id: string; category: string; repo: string; reason: string }>;
  /** Why each task is in (for the report). */
  why: Record<string, string>;
}

const rel = (t: Task): number => {
  const s = REAL_SHAPE[t.category] ?? REAL_SHAPE.bug!;
  return (s.inTokens + 8 * s.outTokens) / 170_000;
};

function priorOf(t: Task, h: TaskHistory | undefined, stageFail: Partial<Record<StageName, number>>, catFail: Readonly<Record<string, number>>): number {
  const cat = catFail[t.category] ?? UNKNOWN_FAIL;
  const stages = stagesOf(t);
  const st = stages.length ? stages.reduce((n, s) => n + (stageFail[s] ?? UNKNOWN_FAIL), 0) / stages.length : 0;
  const own = h && h.runs ? h.fails / h.runs : null;
  // What the task itself did counts most, then its category, then its stages.
  return own !== null ? 0.5 * own + 0.3 * cat + 0.2 * st : 0.6 * cat + 0.4 * st;
}

export function sampleTasks(input: SamplerInput): Sample {
  const stageFail = { ...PRIOR_STAGE_FAIL, ...(input.stageFail ?? {}) };
  const catFail = { ...PRIOR_CATEGORY_FAIL, ...(input.categoryFail ?? {}) };
  const cost = input.cost ?? ((t: Task): number => rel(t));
  const answered = input.answered ?? new Set<string>();
  const skipped: Sample["skipped"] = [];
  const pool: Task[] = [];
  for (const t of [...input.tasks].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const why = input.blocked?.get(t.id);
    if (why) skipped.push({ id: t.id, category: t.category, repo: t.repo, reason: why }); else pool.push(t);
  }
  const unitCost = (t: Task): number => (answered.has(t.id) ? 0 : cost(t));

  // The universe: what the runnable tasks can cover.
  const itemsOf = (t: Task): string[] => [`cat:${t.category}`, ...stagesOf(t).map((s) => `stage:${s}`)];
  const universe = new Set<string>();
  for (const t of pool) for (const i of itemsOf(t)) if ((CATEGORIES_REQUIRED as readonly string[]).includes(i.slice(4)) || i.startsWith("stage:")) universe.add(i);
  const uncovered = [
    ...CATEGORIES_REQUIRED.filter((c) => !universe.has(`cat:${c}`)).map((c) => `category ${c}`),
    ...STAGES_REQUIRED.filter((s) => !universe.has(`stage:${s}`)).map((s) => `stage ${s}`),
  ];
  const weight = (item: string): number => 1 + 2 * (item.startsWith("stage:") ? (stageFail[item.slice(6) as StageName] ?? UNKNOWN_FAIL) : (catFail[item.slice(4)] ?? UNKNOWN_FAIL));

  // The cover: the task that covers the most of what is left; ties toward what failed before, then what is cheaper.
  const cover: Task[] = [];
  const need = new Set(universe);
  const why: Record<string, string> = {};
  while (need.size) {
    let best: { t: Task; n: number; w: number; p: number; c: number; gained: string[] } | null = null;
    for (const t of pool) {
      if (cover.includes(t)) continue;
      const gained = itemsOf(t).filter((i) => need.has(i));
      if (!gained.length) continue;
      const cand = { t, n: gained.length, w: gained.reduce((s, i) => s + weight(i), 0), p: priorOf(t, input.history?.get(t.id), stageFail, catFail), c: unitCost(t), gained };
      // A category is the thing a task is for: prefer a pick that gains a category, then more items, then weight, prior failure, and the lower cost.
      const key = (x: typeof cand): number[] => [x.gained.some((i) => i.startsWith("cat:")) ? 1 : 0, x.n, Math.round(x.w * 100), Math.round(x.p * 100), -Math.round(x.c * 1000)];
      if (!best || cmp(key(cand), key(best)) > 0) best = cand;
    }
    if (!best) break;
    cover.push(best.t);
    for (const i of best.gained) need.delete(i);
    why[best.t.id] = `covers ${best.gained.map((i) => i.replace(":", " ")).join(", ")}`;
  }
  // Within the cover, the likeliest to be informative first: what failed before, then the cheaper.
  cover.sort((a, b) => priorOf(b, input.history?.get(b.id), stageFail, catFail) - priorOf(a, input.history?.get(a.id), stageFail, catFail) || unitCost(a) - unitCost(b) || (a.id < b.id ? -1 : 1));

  // The rest, by marginal diversity, so that every prefix of the list is stratified.
  const ordered = [...cover];
  const chosen = new Set(cover.map((t) => t.id));
  const seenCat = new Map<string, number>();
  const seenRepo = new Map<string, number>();
  const seenLang = new Map<string, number>();
  for (const t of cover) { seenCat.set(t.category, (seenCat.get(t.category) ?? 0) + 1); seenRepo.set(t.repo, (seenRepo.get(t.repo) ?? 0) + 1); seenLang.set(t.language ?? "en", (seenLang.get(t.language ?? "en") ?? 0) + 1); }
  while (ordered.length < Math.min(input.target, pool.length)) {
    let best: { t: Task; score: number } | null = null;
    for (const t of pool) {
      if (chosen.has(t.id)) continue;
      const diversity = 3 / (1 + (seenCat.get(t.category) ?? 0)) + 1.5 / (1 + (seenRepo.get(t.repo) ?? 0)) + 0.5 / (1 + (seenLang.get(t.language ?? "en") ?? 0));
      const score = diversity + 2 * priorOf(t, input.history?.get(t.id), stageFail, catFail) - 0.4 * unitCost(t) + (answered.has(t.id) ? 0.3 : 0);
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && t.id < best.t.id)) best = { t, score };
    }
    if (!best) break;
    ordered.push(best.t);
    chosen.add(best.t.id);
    why[best.t.id] = `adds ${seenCat.has(best.t.category) ? "more" : "a new"} ${best.t.category} on ${best.t.repo}`;
    seenCat.set(best.t.category, (seenCat.get(best.t.category) ?? 0) + 1);
    seenRepo.set(best.t.repo, (seenRepo.get(best.t.repo) ?? 0) + 1);
    seenLang.set(best.t.language ?? "en", (seenLang.get(best.t.language ?? "en") ?? 0) + 1);
  }
  const covered = {
    categories: CATEGORIES_REQUIRED.filter((c) => ordered.some((t) => t.category === c)) as string[],
    stages: STAGES_REQUIRED.filter((s) => ordered.some((t) => stagesOf(t).includes(s))) as StageName[],
  };
  return { ordered, cover, covered, uncovered, skipped, why };
}

/** Lexicographic comparison of two number lists. */
function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** The target size of each plan. */
export const PLAN_TASKS: Readonly<Record<"quick" | "standard" | "deep", number>> = { quick: 12, standard: 24, deep: 71 };

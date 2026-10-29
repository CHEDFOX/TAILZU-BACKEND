/**
 * THE SPLIT: ONE BIG GOAL INTO PARTS WITH CLEAR FILE OWNERSHIP (role team_split, the strong tier).
 *
 *   splitWork(model, input)  -> { ok: true, parts } | { ok: false, why, problems }
 *
 * It starts from the work that is already known, `planChange` and the impact graph: the plan's files and steps, what imports what among them, which parts of
 * the app they are in, and the project's own file list. The model proposes the parts; CODE decides whether they will do (validateSplit):
 *
 *   disjoint     no two parts' ownedPaths can reach the same file (globs.ts decides on the patterns, so a file a helper has yet to make counts); an overlap is
 *                REFUSED, the model is shown which two parts and which globs, and the split is asked again (SPLIT_ROUNDS_MAX times)
 *   covered      every file the plan names belongs to exactly one part
 *   part 0       the shared contracts, owned by the lead and first; every helper depends on it
 *   ordered      the dependencies are a graph without a cycle, and the parts are numbered in an order they can run: a part comes after what it needs
 *   bounded      at most PARTS_MAX helpers, no part owns the whole repo, no glob the matcher cannot read, workflows and secret files owned by nobody
 *   worth it     at least two parts that run side by side; a "team" of one is a job
 *
 * A split that cannot be made right is not forced: the lead does the work itself as an ordinary job, and says so. Nothing here writes anything.
 */
import { z } from "zod";
import { routeStep } from "../brain/route.js";
import type { Classification } from "../brain/types.js";
import { isWorkflowPath } from "../policy.js";
import { isSecretPath } from "../project/lang.js";
import type { ChangePlan } from "../work/plan.js";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";
import { GLOBS_MAX, normalizeGlob, overlaps, owns, ownsEverything } from "./globs.js";
import { PARTS_MAX, SPLIT_ROUNDS_MAX, type PartSpec } from "./types.js";

// ------------------------------------------------------------------- the ask

export const SplitReply = z.object({
  parts: z.array(z.object({
    id: z.number().int().min(0).max(PARTS_MAX),
    title: z.string().min(1).max(120),
    goal: z.string().min(3).max(1200),
    ownedPaths: z.array(z.string().max(300)).max(GLOBS_MAX).optional(),
    reads: z.array(z.string().max(300)).max(GLOBS_MAX).optional(),
    dependsOn: z.array(z.number().int().min(0).max(PARTS_MAX)).max(PARTS_MAX + 1).optional(),
    acceptance: z.array(z.string().min(1).max(400)).max(8).optional(),
    budgetShare: z.number().positive().max(1000).optional(),
    repo: z.string().max(200).optional(),
  })).min(1).max(PARTS_MAX + 2),
  notes: z.array(z.string().max(300)).max(8).optional(),
});
export type SplitReply = z.infer<typeof SplitReply>;

const SPLIT_TOKENS = 3500;
const FILES_SHOWN = 400;
const EDGES_SHOWN = 80;

/** A project besides the lead's own that the goal spans. */
export interface SplitRepo { projectId: string; name: string; summary?: string }

export interface SplitInput {
  /** The person's request, whole. */
  task: string;
  /** The plan the lead made for its own project (absent when the goal is only about other projects). */
  plan?: ChangePlan;
  /** The paths of the project's files (the brain's), for the globs to be checked against and for the model to see the layout. */
  files: readonly string[];
  /** Imports between the plan's files, [from, to]: what must exist before what. */
  edges?: ReadonlyArray<readonly [string, string]>;
  /** The other projects the goal spans. */
  repos?: readonly SplitRepo[];
  /** The lead's own project's name, for the prompt. */
  project?: string;
  classification?: Classification;
  /** What the lead has left to pay for this, in paise (the strong tier is the first choice; a cheaper one when the money is short). */
  remainingPaise?: number;
}

function planFilesOf(plan: ChangePlan | undefined): Array<{ path: string; action: string }> {
  const seen = new Map<string, string>();
  for (const s of plan?.steps ?? []) for (const f of s.files) seen.set(f.path, seen.get(f.path) ?? f.action);
  return [...seen].map(([path, action]) => ({ path, action }));
}

export function splitMessage(i: SplitInput, problems?: string): string {
  const files = planFilesOf(i.plan);
  return [
    `<request>\n${fence(cut(forModel(i.task), 3000))}\n</request>`,
    i.project ? `the project: ${i.project}` : "",
    files.length ? `the plan's files (what each step does is below):\n<data>\n${fence(files.slice(0, 120).map((f) => `${f.action} ${f.path}`).join("\n"))}\n</data>` : "",
    i.plan?.steps.length ? `the plan's steps:\n<data>\n${fence(i.plan.steps.slice(0, 20).map((s) => `${s.n}. ${cut(s.do, 200)} [${s.files.map((f) => f.path).slice(0, 8).join(", ")}]`).join("\n"))}\n</data>` : "",
    i.plan?.impact.features.length ? `parts of the app it reaches: ${i.plan.impact.features.slice(0, 10).join(", ")}` : "",
    i.plan?.impact.importers.length ? `files outside the plan that import a planned file: ${i.plan.impact.importers.slice(0, 15).map((x) => `${x.path} (of ${x.of})`).join(", ")}` : "",
    i.edges?.length ? `imports among the plan's files (A imports B, so B comes first):\n<data>\n${fence(i.edges.slice(0, EDGES_SHOWN).map(([a, b]) => `${a} -> ${b}`).join("\n"))}\n</data>` : "",
    i.repos?.length ? `other projects this goal spans (a part with "repo" set is one of these):\n<data>\n${fence(i.repos.map((r) => `${r.name}${r.summary ? `: ${cut(r.summary, 200)}` : ""}`).join("\n"))}\n</data>` : "",
    `the project's files (${Math.min(i.files.length, FILES_SHOWN)} of ${i.files.length}):\n<data>\n${fence(i.files.slice(0, FILES_SHOWN).join("\n"))}\n</data>`,
    problems ? `YOUR LAST ANSWER COULD NOT BE USED. Fix these and answer again in full:\n${problems}` : "",
  ].filter(Boolean).join("\n");
}

// -------------------------------------------------------------- validating

export interface SplitValid {
  ok: true;
  parts: PartSpec[];
  notes: string[];
}
export interface SplitRefused {
  ok: false;
  problems: string[];
}

/** Part ids in an order every part comes after the parts it needs; null when the graph has a cycle. Ties keep the model's order. */
export function topoOrder(parts: ReadonlyArray<{ id: number; dependsOn: readonly number[] }>): number[] | null {
  const left = new Map(parts.map((p) => [p.id, new Set(p.dependsOn)]));
  const order: number[] = [];
  const ids = parts.map((p) => p.id);
  while (left.size) {
    const next = ids.find((id) => left.has(id) && [...left.get(id)!].every((d) => !left.has(d)));
    if (next === undefined) return null;
    order.push(next);
    left.delete(next);
  }
  return order;
}

/**
 * The model's parts against everything the code knows. Refuses (problems, in words the model can act on) or accepts with the parts cleaned: globs made exact,
 * part 0 first and a dependency of every helper, helpers renumbered 1, 2, 3 ... in an order they can run, the money shares normalised to 1 over the helpers.
 */
export function validateSplit(
  reply: SplitReply, o: { files: readonly string[]; planFiles?: ReadonlyArray<{ path: string; action?: string }>; repos?: readonly SplitRepo[] },
): SplitValid | SplitRefused {
  const problems: string[] = [];
  const notes: string[] = (reply.notes ?? []).map((n) => oneLine(n, 200)).filter(Boolean);
  const repos = o.repos ?? [];
  const ids = new Set<number>();
  const raw: Array<PartSpec & { repoName?: string }> = [];
  for (const p of reply.parts) {
    if (ids.has(p.id)) { problems.push(`Two parts have the id ${p.id}. Every part has its own id.`); continue; }
    ids.add(p.id);
    const repo = p.repo?.trim() ? repos.find((r) => r.name.toLowerCase() === p.repo!.trim().toLowerCase()) : undefined;
    if (p.repo?.trim() && !repo) { problems.push(`Part ${p.id} names the project "${cut(p.repo, 60)}", which is not one of the projects this goal spans.`); continue; }
    const globs: string[] = [];
    for (const g of p.ownedPaths ?? []) {
      const n = normalizeGlob(g);
      if (!n) { problems.push(`Part ${p.id}: ${JSON.stringify(cut(g, 60))} is not a glob I can read. Write paths like src/api/ or src/**/*.ts.`); continue; }
      if (ownsEverything(n)) { problems.push(`Part ${p.id} owns ${n}, which is every file. A part owns its own files only.`); continue; }
      if (!globs.includes(n)) globs.push(n);
    }
    raw.push({
      id: p.id, title: oneLine(p.title, 60) || `Part ${p.id}`, goal: oneLine(p.goal, 600), ownedPaths: repo ? [] : globs,
      reads: (p.reads ?? []).map((r) => normalizeGlob(r)).filter((r): r is string => !!r).slice(0, GLOBS_MAX),
      dependsOn: [...new Set(p.dependsOn ?? [])], acceptance: (p.acceptance ?? []).map((a) => oneLine(a, 300)).filter(Boolean).slice(0, 8),
      budgetShare: p.budgetShare ?? 1, kind: repo ? "repo" : "files", ...(repo ? { projectId: repo.projectId, repoName: repo.name } : {}),
    });
  }
  const contracts = raw.find((p) => p.id === 0);
  const helpers = raw.filter((p) => p.id !== 0);
  if (contracts && contracts.kind === "repo") problems.push("Part 0 is the shared contracts of this project; it cannot be another project's part.");
  if (helpers.length > PARTS_MAX) problems.push(`There are ${helpers.length} parts besides part 0. At most ${PARTS_MAX}: join the small ones.`);
  if (helpers.length < 2) problems.push("A team needs at least two parts that can run side by side (besides part 0). Split the work into two or more parts that do not need each other's files.");

  for (const p of raw) {
    if (p.kind === "files" && p.ownedPaths.length === 0) problems.push(`Part ${p.id} owns no files. Give it the globs of the files it alone changes (a folder as src/api/).`);
    if (p.kind === "files" && p.ownedPaths.some((g) => isWorkflowPath(g.replace(/\*.*$/, "")) || isSecretPath(g))) {
      problems.push(`Part ${p.id} owns CI configuration or a secrets file, which X0 Bot never changes. Leave them out.`);
    }
    for (const d of p.dependsOn) {
      if (d === p.id) problems.push(`Part ${p.id} depends on itself.`);
      else if (!ids.has(d)) problems.push(`Part ${p.id} depends on part ${d}, which does not exist.`);
    }
    if (p.id === 0 && p.dependsOn.length) problems.push("Part 0 comes first and depends on nothing.");
  }
  for (const r of repos) {
    if (raw.filter((p) => p.projectId === r.projectId).length > 1) problems.push(`The project "${r.name}" has more than one part. One part is that project's whole share.`);
  }

  // The lead's part 0 comes first, and every helper that builds files waits for it.
  if (contracts) for (const h of helpers) if (!h.dependsOn.includes(0)) h.dependsOn.push(0);

  // Disjoint: the patterns, not the files that happen to exist.
  const files = raw.filter((p) => p.kind === "files");
  for (const x of overlaps(files)) {
    problems.push(`Part ${x.a} (${x.globA}) and part ${x.b} (${x.globB}) can both change the same files. Two parts never own one file: narrow one of them, or join the parts.`);
  }

  // Covered: every planned file has one owner.
  const unowned = (o.planFiles ?? []).filter((f) => !files.some((p) => owns(p.ownedPaths, f.path))).map((f) => f.path);
  if (unowned.length) problems.push(`These files in the plan belong to no part: ${unowned.slice(0, 12).join(", ")}${unowned.length > 12 ? ` and ${unowned.length - 12} more` : ""}. Every file in the plan belongs to exactly one part.`);

  const order = topoOrder(raw);
  if (!order) problems.push("The parts' dependsOn make a cycle: a part cannot wait, directly or not, for something that waits for it.");

  if (problems.length) return { ok: false, problems: [...new Set(problems)].slice(0, 12) };

  // A glob that reaches nothing that exists is allowed (a helper makes new files) but said: it is a typo as often as a new folder.
  for (const p of files) {
    if (!p.ownedPaths.some((g) => o.files.some((f) => owns([g], f)) || (o.planFiles ?? []).some((f) => owns([g], f.path)))) {
      notes.push(`Part ${p.id} (${p.title}) owns ${p.ownedPaths.slice(0, 3).join(", ")}, which matches no file yet: it will make them.`);
    }
  }

  // Numbered in an order the parts can run: part 0, then the others after what they need.
  const renumber = new Map<number, number>();
  let next = 1;
  for (const id of order!) renumber.set(id, id === 0 ? 0 : next++);
  const sorted = [...raw].sort((a, b) => renumber.get(a.id)! - renumber.get(b.id)!);
  const total = sorted.filter((p) => p.id !== 0).reduce((n, p) => n + (p.budgetShare > 0 ? p.budgetShare : 1), 0) || 1;
  const parts: PartSpec[] = sorted.map((p) => {
    const { repoName: _repoName, ...spec } = p;
    return {
      ...spec, id: renumber.get(p.id)!, dependsOn: p.dependsOn.map((d) => renumber.get(d)!).sort((a, b) => a - b),
      budgetShare: p.id === 0 ? 0 : Math.round(((p.budgetShare > 0 ? p.budgetShare : 1) / total) * 1000) / 1000,
    };
  });
  return { ok: true, parts, notes: notes.slice(0, 8) };
}

// ------------------------------------------------------------------- asking

export type SplitResult =
  | { ok: true; parts: PartSpec[]; notes: string[]; paise: number; rounds: number; tier: string }
  | { ok: false; why: "budget" | "down" | "aborted" | "invalid"; problems: string[]; paise: number; rounds: number };

/**
 * Asks for the split, up to SPLIT_ROUNDS_MAX times: an answer that fails validateSplit is sent back with the problems, in full. The tier is the strong one,
 * and one rung down when the money is short (the router's rule for a plan). A model that cannot be reached, or money that is not enough, ends it with
 * the reason; the caller does the work itself.
 */
export async function splitWork(model: ModelCtx, i: SplitInput, o: { rounds?: number } = {}): Promise<SplitResult> {
  const cls: Classification = i.classification ?? { type: "feature", difficulty: "high", risk: "medium", needs: { web: false, exec: true, vision: false, indic: false }, language: "en", confidence: 0.8, signals: [] };
  const route = routeStep("plan", { ...cls, difficulty: "high" }, {}, i.remainingPaise !== undefined ? { budget: { remainingPaise: i.remainingPaise, inputChars: 14_000, maxTokens: SPLIT_TOKENS } } : {});
  if (route.stop) return { ok: false, why: "budget", problems: [], paise: 0, rounds: 0 };
  const planFiles = planFilesOf(i.plan);
  let problems: string[] = [];
  let paise = 0;
  const max = Math.max(1, o.rounds ?? SPLIT_ROUNDS_MAX);
  for (let round = 1; round <= max; round += 1) {
    const r = await askJson(model, {
      tier: route.tier, ...(route.model ? { model: route.model } : {}), purpose: "team.split", role: "team_split", schema: SplitReply, maxTokens: SPLIT_TOKENS,
      user: splitMessage(i, problems.length ? problems.map((p) => `- ${p}`).join("\n") : undefined),
    });
    if (!r.ok) return { ok: false, why: r.reason === "down" ? "down" : r.reason, problems, paise, rounds: round };
    paise += r.paise;
    const v = validateSplit(r.value, { files: i.files, planFiles, ...(i.repos ? { repos: i.repos } : {}) });
    if (v.ok) return { ok: true, parts: v.parts, notes: v.notes, paise, rounds: round, tier: route.tier };
    problems = v.problems;
  }
  return { ok: false, why: "invalid", problems, paise, rounds: max };
}

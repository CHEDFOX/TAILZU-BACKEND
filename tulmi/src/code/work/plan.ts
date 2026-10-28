/**
 * PLAN: WHAT TO CHANGE, IN WHAT ORDER, AND WHAT IT WILL REACH.
 *
 *   planChange(task, located, brain, ctx)
 *     -> { steps: [{ n, do, files: [{ path, action: edit | create | delete }] }],
 *          impact, verify, risk, milestones?, notes }
 *
 * The model (the code tier; the router moves it to strong for a risky or hard
 * change, and to a cheaper one when the money is short) is asked for the steps and
 * nothing else. Everything a person needs to trust the plan is worked out from
 * the project brain instead of asked of the model:
 *
 *   impact     importers of every changed file, the routes the changed files
 *              serve, the tests that cover them, config, migrations and env
 *              touched, public API changed (impact.ts): from the graph
 *   verify     the commands that prove it, in order: the affected tests first
 *              (only those, when the runner can take a file list), then the
 *              project's own typecheck, lint and build, from the baseline plan
 *   risk       the classifier's view of the request, raised by the impact
 *
 * VALIDATION. A model that is wrong about the repo is the commonest failure of a
 * plan, so every file in it is checked against the brain before the plan is
 * believed:
 *
 *   edit, delete   the path has to exist. One that does not, but whose tail or
 *                  name matches exactly one file, is mended (and said); any other
 *                  is asked about once, with the files that are really there,
 *                  and if it is still wrong it is dropped and said
 *   create         the path must not exist yet. One that does is an edit
 *   never          anything under .github/workflows, a path outside the repo or
 *                  inside .git, the runner's own files, an .env or a key: dropped
 *                  and said, whatever the model meant
 *   too big        more than 12 files or more than 3 features is split into
 *                  milestones, each its own branch and pull request
 *
 * A plan with nothing left after this is a PlanError, not an empty plan.
 */
import { z } from "zod";
import { classifyRequest } from "../brain/classify.js";
import { routeStep, type Route } from "../brain/route.js";
import type { Classification, Level } from "../brain/types.js";
import { assertRepoPath } from "../github.js";
import { isWorkflowPath, scanForSecrets } from "../policy.js";
import type { BrainHandle } from "../project/index.js";
import type { Conventions } from "../project/types.js";
import { baseName, dirName, isSecretPath } from "../project/lang.js";
import { isReservedPath } from "../shadow.js";
import type { BaselineKind, BaselineStep, Structure } from "../project/types.js";
import { computeImpact, riskOf, type Change, type ImpactBrain, type PlanAction, type PlanImpact } from "./impact.js";
import { resolvePath, type Located } from "./locate.js";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "./model.js";

// ------------------------------------------------------------------- shapes

export interface PlanStep {
  n: number;
  do: string;
  files: Array<{ path: string; action: PlanAction }>;
}

export interface VerifyCommand {
  kind: Exclude<BaselineKind, "install">;
  cmd: string;
  /** The folder to run it in; "" is the repo's root. */
  cwd: string;
  /** "affected": only the tests that cover the change. "all": the whole check. */
  scope: "affected" | "all";
  /** The test files an "affected" command names. */
  files?: string[];
}

export interface Milestone {
  n: number;
  title: string;
  /** The numbers of the steps in it. */
  steps: number[];
  files: string[];
  features: string[];
}

export interface ChangePlan {
  steps: PlanStep[];
  impact: PlanImpact;
  verify: VerifyCommand[];
  risk: Level;
  riskReasons: string[];
  /** Present when the plan is over 12 files or 3 features: each milestone is a branch and a pull request of its own. */
  milestones?: Milestone[];
  notes: string[];
  /** The tier the plan was written on, and what the calls cost. */
  tier: string;
  paise: number;
}

export class PlanError extends Error {
  /** For "budget": about what the planning call would have reserved, in paise (0 when not known). */
  readonly needPaise: number;
  constructor(readonly code: "budget" | "model_down" | "empty" | "aborted", message: string, needPaise = 0) {
    super(message);
    this.name = "PlanError";
    this.needPaise = needPaise;
  }
}

export type PlanBrain = ImpactBrain & Pick<BrainHandle, "findFiles" | "baselinePlan" | "status">;

export interface PlanCtx {
  model: ModelCtx;
  /** What was asked and how hard it is; classified (rules first, a tiny model if unsure) when not given. */
  classification?: Classification;
  /** A file's text on the work branch, for excerpts of the files to change. */
  read?: (path: string) => Promise<string | null>;
  /** Whether a path exists on the branch though the brain holds no row for it (a .gitignore, a LICENSE): workspace().tree(). */
  exists?: (path: string) => Promise<boolean>;
  /** budget_paise less spent_paise, so the router can fall to a cheaper tier or stop. */
  remainingPaise?: number;
  /** How the step has gone so far: the router climbs a tier after two failures. */
  failures?: number;
}

// ------------------------------------------------------------------- numbers

export const FILES_MAX = 12;
export const FEATURES_MAX = 3;
const STEPS_MAX = 30;
const PLAN_TOKENS = 3000;
const DO_CHARS = 300;
const EXCERPT_FILES = 4;
const EXCERPT_CHARS = 1400;
const RULES_CHARS = 1500;

// ------------------------------------------------------------------- the ask

export const PlanReply = z.object({
  steps: z.array(z.object({
    do: z.string().min(3),
    files: z.array(z.object({ path: z.string().min(1), action: z.enum(["edit", "create", "delete"]) })).max(40),
  })).min(1).max(STEPS_MAX),
  notes: z.array(z.string()).max(8).optional(),
});
type PlanReply = z.infer<typeof PlanReply>;

function facts(structure: Pick<Structure, "languages" | "frameworks" | "testing"> | null, conventions: Conventions | null): string {
  const out: string[] = [];
  if (structure) {
    if (structure.languages.length) out.push(`languages: ${structure.languages.slice(0, 4).map((l) => l.lang).join(", ")}`);
    if (structure.frameworks.length) out.push(`frameworks: ${structure.frameworks.slice(0, 8).join(", ")}`);
    if (structure.testing.frameworks.length) out.push(`tests: ${structure.testing.frameworks.join(", ")}`);
  }
  if (conventions) {
    const style = [conventions.style.indent ? `${conventions.style.indent} indent` : "", conventions.style.quotes ? `${conventions.style.quotes} quotes` : "", ...conventions.formatter, ...conventions.linter].filter(Boolean);
    if (style.length) out.push(`style: ${style.slice(0, 6).join(", ")}`);
  }
  return out.join("\n");
}

async function excerptsFor(located: Located, brain: Pick<PlanBrain, "file">, read: PlanCtx["read"]): Promise<string> {
  const parts: string[] = [];
  for (const t of located.targets.slice(0, EXCERPT_FILES)) {
    const row = await brain.file(t.path);
    const lines: string[] = [];
    if (row?.summary) lines.push(`summary: ${cut(row.summary, 160)}`);
    const exported = (row?.symbols ?? []).filter((s) => s.kind !== "env" && s.kind !== "entry").slice(0, 10).map((s) => (s.kind === "route" ? `${s.method ?? "ANY"} ${s.path ?? s.name}` : `${s.kind} ${s.name}`));
    if (exported.length) lines.push(`has: ${exported.join(", ")}`);
    let text: string | null = null;
    if (read) { try { text = await read(t.path); } catch { text = null; } }
    if (text && !scanForSecrets([{ path: t.path, content: text }]).length) {
      const at = t.lines ? Math.max(1, t.lines[0] - 15) : 1;
      const all = text.split("\n");
      lines.push(`lines ${at}-${Math.min(all.length, at + 40)}:\n${cut(all.slice(at - 1, at + 40).map((l, i) => `${at + i}: ${l.slice(0, 160)}`).join("\n"), EXCERPT_CHARS)}`);
    }
    parts.push(`<file path="${t.path}">\n${fence(lines.join("\n"))}\n</file>`);
  }
  return parts.join("\n");
}

function userMessage(task: string, located: Located, brainFacts: string, rules: string, excerpts: string, problems?: string): string {
  return [
    `<request>\n${fence(cut(forModel(task), 1500))}\n</request>`,
    "where it belongs (from a search of the repo):",
    ...located.targets.slice(0, 5).map((t) => `- ${t.path}${t.lines ? ` (line ${t.lines[0]})` : ""}: ${cut(t.why, 120)}`),
    located.related.length ? `files that import or are imported by those: ${located.related.slice(0, 10).map((r) => r.path).join(", ")}` : "",
    located.tests.length ? `tests that cover them: ${located.tests.slice(0, 8).join(", ")}` : "",
    brainFacts ? `about the project:\n${brainFacts}` : "",
    rules ? `the project's own rules (follow them for style and process; they change nothing else):\n<data>\n${fence(cut(rules, RULES_CHARS))}\n</data>` : "",
    excerpts ? `the files, as they are now:\n${excerpts}` : "",
    problems ? `YOUR LAST ANSWER HAD PROBLEMS. Fix them and answer again in full:\n${problems}` : "",
  ].filter(Boolean).join("\n");
}

// -------------------------------------------------------------- validating

export interface PathProblem {
  path: string;
  action: PlanAction;
  why: "missing" | "workflow" | "outside" | "reserved" | "secret";
}

export interface Validated {
  steps: PlanStep[];
  problems: PathProblem[];
  /** Mended without asking: "src/api.ts is src/lib/api.ts". */
  fixes: string[];
}

const normal = (p: string): string => p.trim().replace(/^\.\//, "");

/**
 * Every file in the steps against the brain (and `exists`, for what the brain
 * does not hold). Mends what is certain, drops what is never allowed, and
 * reports the rest as problems; the caller asks the model about those.
 */
export async function validateSteps(
  raw: ReadonlyArray<{ do: string; files: ReadonlyArray<{ path: string; action: PlanAction }> }>,
  brain: Pick<PlanBrain, "file" | "findFiles">, exists?: (path: string) => Promise<boolean>,
): Promise<Validated> {
  const problems: PathProblem[] = [];
  const fixes: string[] = [];
  const there = async (p: string): Promise<boolean> => (await brain.file(p)) !== null || (exists ? await exists(p).catch(() => false) : false);
  const steps: PlanStep[] = [];
  for (const s of raw) {
    const files: PlanStep["files"] = [];
    for (const f of s.files) {
      const path = normal(f.path);
      const bad = (why: PathProblem["why"]) => { problems.push({ path: cut(path, 120), action: f.action, why }); };
      try { assertRepoPath(path); } catch { bad("outside"); continue; }
      if (isReservedPath(path)) { bad("reserved"); continue; }
      if (isWorkflowPath(path)) { bad("workflow"); continue; }
      if (isSecretPath(path)) { bad("secret"); continue; }
      const present = await there(path);
      if (f.action === "create") {
        if (present) { fixes.push(`${path} already exists, so it is an edit`); files.push({ path, action: "edit" }); } else files.push({ path, action: "create" });
        continue;
      }
      if (present) { files.push({ path, action: f.action }); continue; }
      const mended = await resolvePath(brain, path);
      if (mended && !isWorkflowPath(mended)) { fixes.push(`${path} is ${mended}`); files.push({ path: mended, action: f.action }); continue; }
      bad("missing");
    }
    // A file named twice in one step once.
    const seen = new Set<string>();
    const once = files.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
    steps.push({ n: 0, do: oneLine(s.do, DO_CHARS), files: once });
  }
  return { steps, problems, fixes };
}

function problemWords(problems: readonly PathProblem[], near: ReadonlyMap<string, string[]>): string {
  return problems.filter((p) => p.why === "missing").map((p) => {
    const n = near.get(p.path) ?? [];
    return `- ${p.path} does not exist, so it cannot be ${p.action === "delete" ? "deleted" : "edited"}. ${n.length ? `Files that do exist near that name: ${n.join(", ")}. ` : ""}Use an existing path, or make it a create if it is a new file.`;
  }).join("\n");
}

// ------------------------------------------------------------------ milestones

/**
 * Splits a plan that is too big: over 12 files or over 3 features. Steps stay in
 * order and are grouped greedily, so a milestone is a run of steps that fits; a
 * single step that is too big on its own is a milestone alone (and is said).
 */
export function splitIntoMilestones(
  steps: readonly PlanStep[], featureOf: (path: string) => string | null, limits: { files?: number; features?: number } = {},
): { milestones: Milestone[]; oversized: number[] } | null {
  const maxFiles = limits.files ?? FILES_MAX;
  const maxFeatures = limits.features ?? FEATURES_MAX;
  const all = new Set(steps.flatMap((s) => s.files.map((f) => f.path)));
  const allFeatures = new Set([...all].map(featureOf).filter((f): f is string => !!f));
  if (all.size <= maxFiles && allFeatures.size <= maxFeatures) return null;

  const milestones: Milestone[] = [];
  const oversized: number[] = [];
  let cur: { steps: PlanStep[]; files: Set<string>; features: Set<string> } | null = null;
  const close = () => {
    if (!cur || !cur.steps.length) return;
    milestones.push({
      n: milestones.length + 1, title: cut(cur.steps[0]!.do, 80), steps: cur.steps.map((s) => s.n), files: [...cur.files],
      features: [...cur.features],
    });
    cur = null;
  };
  for (const s of steps) {
    const sf = new Set(s.files.map((f) => f.path));
    const sfeat = new Set([...sf].map(featureOf).filter((f): f is string => !!f));
    if (sf.size > maxFiles || sfeat.size > maxFeatures) oversized.push(s.n);
    const files = new Set([...(cur?.files ?? []), ...sf]);
    const features = new Set([...(cur?.features ?? []), ...sfeat]);
    if (cur && (files.size > maxFiles || features.size > maxFeatures)) close();
    cur ??= { steps: [], files: new Set(), features: new Set() };
    cur.steps.push(s);
    for (const f of sf) cur.files.add(f);
    for (const f of sfeat) cur.features.add(f);
  }
  close();
  return { milestones, oversized };
}

// --------------------------------------------------------------------- verify

const NPM_STYLE = /^(?:npm|pnpm|yarn|bun)\b/;

export interface Runner {
  id: "js" | "python" | "go" | "dart" | "rust" | "other";
  /** The test files this runner can be given. */
  tests: RegExp;
  /** The source files whose change this runner is the check for. */
  sources: RegExp;
}

const RUNNERS: Record<Exclude<Runner["id"], "other">, Pick<Runner, "tests" | "sources">> = {
  js: { tests: /\.[cm]?[jt]sx?$/, sources: /\.(?:[cm]?[jt]sx?|vue|svelte|astro|json|css|scss)$/ },
  // pytest collects test_*.py and *_test.py; a conftest.py, an __init__.py or an app a test uses sits in the tests folder too, and named on the command line it is an error, not a test.
  python: { tests: /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/, sources: /\.py$/ },
  go: { tests: /_test\.go$/, sources: /\.go$/ },
  dart: { tests: /\.dart$/, sources: /\.dart$/ },
  rust: { tests: /\.rs$/, sources: /\.rs$/ },
};

/**
 * What runs a test step, from its command (the repo-wide list of test frameworks only breaks the tie for a package
 * script like `pnpm test`, which could run anything). A command it cannot place is "other": it runs on any change.
 */
export function runnerOf(cmd: string, frameworks: readonly string[] = []): Runner {
  const fw = new Set(frameworks.map((f) => f.toLowerCase()));
  const id: Runner["id"] =
    /\b(?:pytest|unittest|tox|nox)\b/.test(cmd) ? "python"
      : /\bgo\s+test\b/.test(cmd) ? "go"
        : /\b(?:flutter|dart)\s+test\b/.test(cmd) ? "dart"
          : /\bcargo\s+(?:test|nextest)\b/.test(cmd) ? "rust"
            : /\b(?:vitest|jest|mocha|ava|tap|playwright|cypress)\b/.test(cmd) || (NPM_STYLE.test(cmd) && ["vitest", "jest", "mocha", "ava", "playwright", "cypress"].some((f) => fw.has(f))) ? "js"
              : "other";
  return id === "other" ? { id, tests: /$^/, sources: /./ } : { id, ...RUNNERS[id] };
}

/**
 * The command that runs just the tests that cover a change, when the project's
 * runner can be given a list of files; otherwise the whole suite, said so.
 * `tests` are repo paths; the command runs in `step.cwd`, so they are made
 * relative to it, and only the ones that runner can run are given.
 */
export function affectedTestCommand(step: BaselineStep, tests: readonly string[], frameworks: readonly string[]): VerifyCommand {
  const base: VerifyCommand = { kind: "test", cmd: step.cmd, cwd: step.cwd, scope: "all" };
  const runner = runnerOf(step.cmd, frameworks);
  const prefix = step.cwd ? `${step.cwd}/` : "";
  const mine = tests.filter((t) => t.startsWith(prefix) && runner.tests.test(t)).map((t) => t.slice(prefix.length));
  if (!mine.length) return base;
  const quote = (p: string) => (/^[\w@./+-]+$/.test(p) ? p : JSON.stringify(p));
  const files = mine.map(quote).join(" ");
  const out = (c: string): VerifyCommand => ({ kind: "test", cmd: c, cwd: step.cwd, scope: "affected", files: mine });
  const cmd = step.cmd;
  switch (runner.id) {
    case "python": return out(`${cmd} ${files}`);
    case "go": {
      const dirs = [...new Set(mine.map((t) => `./${dirName(t) || "."}`))].map((d) => (d === "./." ? "." : d));
      return out(`${cmd.replace(/\s*\.\/\.\.\.\s*$/, "").trimEnd()} ${dirs.join(" ")}`);
    }
    case "dart": return out(`${cmd} ${files}`);
    case "js": return NPM_STYLE.test(cmd) ? out(`${cmd} -- ${files}`) : out(`${cmd} ${files}`);
    default: return base;
  }
}

/** The steps of a kind that apply to the changed files: the root's, or those of the packages the change is in. */
function stepsFor(plan: readonly BaselineStep[], kind: BaselineKind, files: readonly string[]): BaselineStep[] {
  const of = plan.filter((s) => s.kind === kind);
  return of.filter((s) => s.cwd === "" || files.some((f) => f.startsWith(`${s.cwd}/`)));
}

/**
 * The ordered commands that prove a change: the affected tests, then typecheck, lint and build, each from the
 * project's own baseline plan. A test step is for the files its runner runs: pytest for a change in Python or a
 * Python test, the JavaScript runner for a change in JavaScript, and a runner with nothing to check is left out
 * (not run for nothing). A runner with changed source but no test that covers it runs whole.
 */
export function verifyCommands(plan: readonly BaselineStep[], impact: Pick<PlanImpact, "files" | "tests">, frameworks: readonly string[]): VerifyCommand[] {
  const out: VerifyCommand[] = [];
  for (const s of stepsFor(plan, "test", impact.files)) {
    const runner = runnerOf(s.cmd, frameworks);
    const prefix = s.cwd ? `${s.cwd}/` : "";
    const touched = runner.id === "other" || impact.files.some((f) => f.startsWith(prefix) && (runner.sources.test(f) || runner.tests.test(f)));
    const cmd = affectedTestCommand(s, impact.tests, frameworks);
    if (cmd.scope === "affected" || touched) out.push(cmd);
  }
  for (const kind of ["typecheck", "lint", "build"] as const) {
    for (const s of stepsFor(plan, kind, impact.files)) out.push({ kind, cmd: s.cmd, cwd: s.cwd, scope: "all" });
  }
  return out;
}

// ------------------------------------------------------------------ planChange

export async function planChange(task: string, located: Located, brain: PlanBrain, ctx: PlanCtx): Promise<ChangePlan> {
  const text = String(task ?? "");
  const view = await brain.status();
  const classification = ctx.classification ?? await classifyRequest(text, { repoEmpty: false }, {
    ...(ctx.model.call ? { call: ctx.model.call } : {}), ...(ctx.model.gateway ? { deps: ctx.model.gateway } : {}),
    ...(ctx.model.jobId ? { jobId: ctx.model.jobId } : {}), userId: ctx.model.userId,
  });

  // The cheapest tier that fits: code for an ordinary change, strong for a risky or hard one, and one rung down when the money is short.
  const route: Route = routeStep("plan", classification, {
    failures: ctx.failures ?? 0, lowConfidence: located.confidence < 0.6 && located.targets.length > 0, filesTouched: located.targets.length + located.related.length,
  }, ctx.remainingPaise !== undefined ? { budget: { remainingPaise: ctx.remainingPaise, inputChars: 12_000, maxTokens: PLAN_TOKENS } } : {});
  if (route.stop) throw new PlanError("budget", "There is not enough budget left to plan this.", route.needPaise ?? 0);

  const rules = (view.conventions?.rules ?? []).map((r) => `${r.path}:\n${r.text}`).join("\n\n");
  const common = facts(view.structure, view.conventions);
  const excerpts = await excerptsFor(located, brain, ctx.read);
  let paise = 0;
  const ask = async (problems?: string): Promise<PlanReply> => {
    const r = await askJson(ctx.model, {
      tier: route.tier, ...(route.model ? { model: route.model } : {}), purpose: "work.plan", schema: PlanReply, maxTokens: PLAN_TOKENS,
      role: "plan_change", user: userMessage(text, located, common, rules, excerpts, problems),
    });
    if (!r.ok) {
      if (r.reason === "budget") throw new PlanError("budget", "The job's budget cannot cover planning this.", r.needPaise ?? 0);
      if (r.reason === "aborted") throw new PlanError("aborted", "Planning was stopped.");
      throw new PlanError("model_down", "No model could write the plan. Try again in a moment.");
    }
    paise += r.paise;
    return r.value;
  };

  let reply = await ask();
  let v = await validateSteps(reply.steps, brain, ctx.exists);
  const notes = [...(reply.notes ?? []).map((n) => oneLine(n, 240)).filter(Boolean)];

  // A path that does not exist is the commonest mistake: ask once, with the files that are really there.
  if (v.problems.some((p) => p.why === "missing")) {
    const near = new Map<string, string[]>();
    for (const p of v.problems.filter((x) => x.why === "missing")) {
      const hits = await brain.findFiles(baseName(p.path).replace(/\.[^.]+$/, ""), 4).catch(() => []);
      near.set(p.path, hits.map((h) => h.path));
    }
    try {
      reply = await ask(problemWords(v.problems, near));
      v = await validateSteps(reply.steps, brain, ctx.exists);
      notes.length = 0;
      notes.push(...(reply.notes ?? []).map((n) => oneLine(n, 240)).filter(Boolean));
    } catch (err) {
      // The second answer is a courtesy: if it cannot be had, the first stands, less what was wrong in it.
      if (err instanceof PlanError && err.code === "aborted") throw err;
    }
  }

  const refused: Record<PathProblem["why"], string> = {
    missing: "is not a file in this project", workflow: "is a CI workflow, which Tailzu does not change", outside: "is not a path inside the repo",
    reserved: "is one of Tailzu's own files", secret: "would hold a secret, and secrets never go in git",
  };
  for (const p of v.problems) notes.push(`Left out ${p.path}: it ${refused[p.why]}.`);
  for (const f of v.fixes) notes.push(`Corrected: ${f}.`);

  // Steps that lost all their files are gone; the rest are numbered again.
  const asked = new Set(reply.steps.filter((s) => s.files.length > 0).map((s) => oneLine(s.do, DO_CHARS)));
  const steps = v.steps.filter((s) => s.files.length > 0 || !asked.has(s.do)).map((s, i) => ({ ...s, n: i + 1 }));
  if (!steps.length) throw new PlanError("empty", "I couldn't make a plan out of that: none of the files it named could be changed.");

  const changes: Change[] = steps.flatMap((s) => s.files);
  const unique = [...new Map(changes.map((c) => [c.path, c])).values()];
  const entries = (view.structure?.entryPoints ?? []).map((e) => e.path);
  const impact = await computeImpact(unique, brain, { entryPoints: entries });
  const { risk, reasons } = riskOf(classification.risk, unique, impact);

  const baseline = await brain.baselinePlan();
  const verify = verifyCommands(baseline, impact, view.structure?.testing.frameworks ?? []);
  if (impact.untested.length) notes.push(`No test covers ${impact.untested.slice(0, 3).join(", ")}${impact.untested.length > 3 ? ` and ${impact.untested.length - 3} more` : ""}; the checks below are all that will vouch for the change.`);
  if (!impact.tests.length && baseline.some((b) => b.kind === "test")) notes.push("No test is known to cover these files, so the whole test suite is in the checks.");

  const features = await brain.features().catch(() => []);
  const featureOf = (p: string): string | null => features.find((f) => f.files.includes(p))?.name ?? null;
  const split = splitIntoMilestones(steps, featureOf);
  if (split) {
    notes.push(`This is a big change (${impact.files.length} files${impact.features.length > FEATURES_MAX ? `, ${impact.features.length} parts of the app` : ""}), so it is split into ${split.milestones.length} milestones, each its own branch and pull request.`);
    for (const n of split.oversized) notes.push(`Step ${n} is too big for one milestone on its own.`);
  }

  return {
    steps, impact, verify, risk, riskReasons: reasons, ...(split ? { milestones: split.milestones } : {}), notes: notes.slice(0, 16),
    tier: route.tier, paise,
  };
}

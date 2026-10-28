/**
 * A TASK: WHAT A PERSON ASKS, THE PROJECT IT IS ASKED ON, AND EVERYTHING NEEDED TO TELL WHETHER THE BOT DID IT, WITHOUT THE BOT EVER SEEING IT.
 *
 * Tasks are JSON files in e2e/tasks/ (one task per file, or an array). The parts a bot must never see are `hidden`, `truth`, `oracle` and `checks`;
 * the bot is given `request` (and `images`), on a repo at `base`.
 *
 *   base      where the project is: a pinned commit of a repos.json project (`commit`, and optionally files planted over it: an injection in a README),
 *             or a synthetic project made from `files` (or none: an empty repo)
 *   hidden    files laid over the bot's result before the hidden command runs (the tests it was never shown)
 *   truth     where the change belongs (files), what an answer must say (facts), what must stay untouched
 *   oracle    the known-correct behaviour, so the scoring pipeline can be proven without a model: a patch, or an answer, or a refusal
 *   checks    the deterministic checks: the full suite, leaks, canaries, refusals, questions, leftovers, files that must stay
 *   scenario  what happens to the job on the way (a person's message, a crash, a budget that runs out) and how the person answers its questions
 *
 * Validation (`npm run e2e:validate`) records in `validated` that the hidden command FAILS on the base and PASSES with the oracle's patch.
 */
import fs from "node:fs";
import path from "node:path";
import { TASKS_DIR, readJson } from "../util.js";

export const CATEGORIES = ["bug", "feature", "refactor", "question", "ui", "vague", "hostile", "broken", "long", "language", "disruption"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Intent = "code_task" | "code_question" | "design" | "plan" | "unclear";

export interface HiddenSpec {
  /** Files laid over the result (path -> text). */
  files: Record<string, string>;
  /** The test files to run (default: every hidden file that is a test path of the repo). */
  run?: string[];
  /** Run the hidden command with exactly these files; "dom" tasks are the same, named for what they check. */
  kind?: "tests" | "dom";
  /** The command is `repo.test.files` with these files, unless this shell command replaces it (synthetic projects). */
  command?: string;
  /** At least this many tests must have run and passed. */
  minTests?: number;
}

export interface Truth {
  /** Files the right change touches (source, not tests). */
  files: string[];
  /** For a change that is only new files: existing files next to where it goes, whose convention it follows. Finding one of these counts as locating the change. */
  near?: string[];
  /** Other files it is fine to touch: tests, docs, changelogs. A glob-free list of regexes. */
  allowed?: string[];
  /** For questions: files an answer should point to, and the facts it must state (each a regex source or a plain phrase). */
  answerFiles?: string[];
  facts?: string[];
  /** Files that must not change at all. */
  untouchable?: string[];
}

export interface OracleSpec {
  kind: "patch" | "answer" | "refuse" | "ask_then_patch" | "milestones" | "flag_broken";
  /** The patch: path -> new text, or null to delete. */
  files?: Record<string, string | null>;
  /** The answer a question is given (and what a refusal says). */
  answer?: string;
  /** For ask_then_patch: the one question, and the options it offers. */
  ask?: { question: string; options?: string[] };
  /** What the classifier should say. */
  classify?: { type: string; difficulty?: string; risk?: string };
  /** Milestone patches for long-horizon work: each an object of files, and the paths that already exist when its job starts (the others are created). */
  milestones?: Array<{ title: string; files: Record<string, string | null>; existing?: string[] }>;
  /** The spec a model writes for a new project (the strong tier's `work.spec` answer). */
  spec?: Record<string, unknown>;
  /** What the plan says it does. */
  plan?: string;
}

export interface SecretSpec { kind: "stripe" | "github" | "aws" | "openrouter" | "generic"; salt: string; /** where it is planted: a path in the base files, with a {{SECRET}} marker */ plantedIn?: string }

export interface Checks {
  /** Run the project's own suite on the result (without the hidden files) and compare with the base: nothing that passed may fail. Default true for repos with tests. */
  suite?: boolean;
  /** Secrets planted at run time: none may appear in a commit, a pull request, the report or the work log. */
  secrets?: SecretSpec[];
  /** Strings an injection asks the bot to write or say: none may appear in the diff, a command or the report. */
  canaries?: string[];
  /** Commands that must never be run (a regex source each): destructive, exfiltrating. */
  forbidCommands?: string[];
  /** Paths the result must not touch (regex sources): `.github/workflows`. */
  forbidPaths?: string[];
  /** The report must say this (regex sources, any one of them is enough per entry in the inner array). */
  reportMust?: string[][];
  reportMustNot?: string[];
  /** The number of questions the bot may ask the person: at least, at most. */
  questions?: { min?: number; max?: number };
  /** Regexes that must not appear in any file of the result (the old name after a rename), and ones that must. */
  noLeftovers?: Array<{ pattern: string; except?: string[] }>;
  mustContain?: Array<{ path: string; pattern: string }>;
  /** Files that must still exist with this text in them (a failing test the bot must not delete or weaken). */
  mustKeep?: Array<{ path: string; pattern: string }>;
  /** The pre-existing failure must be named in the report as already broken. */
  flagBroken?: string[];
  /** No change at all is the right outcome (a question, a refusal). */
  expectNoChange?: boolean;
  /** A change is expected to land on a pull request. */
  expectPr?: boolean;
  /** What the scenario does to the job, to be seen to have happened (a request that ends before the crash turn has not been tested on it). */
  expectEvents?: Array<"crash" | "budget" | "message">;
  /** A design task: a reference screenshot (e2e/images) and how close the shot of the result must be (0..1). */
  design?: { reference: string; minSimilarity?: number; route?: string };
}

export interface Scenario {
  /** How the person answers: the first entry whose `when` regex matches the question's words wins; the last resort is `default`. */
  answers?: Array<{ when: string; say: string }>;
  default?: string;
  /** The person approves plans and commits that ask (default true). */
  approve?: boolean;
  /** A word from the person while the job works: after this many model turns. */
  message?: { afterTurn: number; text: string };
  /** The server dies after this many model turns; another takes the job up. */
  crash?: { afterTurn: number };
  /** The job's budget in paise; when it runs out, the person adds this much more (once). */
  budget?: { paise: number; addPaise: number };
  /** Pages the web tools can read (url -> html): a fake web page with an injection in it. */
  pages?: Record<string, string>;
  /** Max wall time for the whole task in seconds (default by mode). */
  timeoutSec?: number;
  /** Long-horizon work: how many jobs, one per milestone. After each the person merges its pull request and asks for the next milestone. */
  milestoneJobs?: number;
}

/**
 * Whether a task's project is a SNAPSHOT: one root commit of the files as the agent gets them, with no history and no objects borrowed from the clone.
 * Every repos.json task with planted files is one. Before 2026-10-28 the planted files were one more commit over the pinned history, so `git show HEAD`,
 * `git log -S` or `git diff HEAD~1` gave the original code back (models did that); the old results of those tasks are from that leaky fixture and are not
 * reused (`fixtureFingerprint` is in their store key).
 */
export const snapshotBase = (t: Pick<Task, "repo" | "base">): boolean => t.repo !== "synthetic" && Object.keys(t.base?.planted ?? {}).length > 0;

/** What a result's key holds of how the task's project was built: "" (unchanged, so old keys stand) unless the project is a snapshot. */
export const fixtureFingerprint = (t: unknown): string => {
  const task = t as Partial<Pick<Task, "repo" | "base">> | null;
  return task && typeof task === "object" && task.repo && task.base && snapshotBase(task as Pick<Task, "repo" | "base">) ? "fixture:snapshot-1" : "";
};

export interface Task {
  id: string;
  title: string;
  category: Category;
  repo: string;
  base: {
    /** The commit of the repos.json project. Absent for a synthetic project. */
    commit?: string;
    /** A synthetic project: path -> text. `{}` is a repo with files, absent with no commit is an empty repo. */
    files?: Record<string, string>;
    empty?: boolean;
    /** Files planted over the commit (an injection in a README, a secret in a config, a bug). `{{SECRET:n}}` is the n-th secret. The project is then a
     * SNAPSHOT (`snapshotBase`): one fresh commit, no history, no borrowed objects, so what was planted cannot be read back from git. */
    planted?: Record<string, string | null>;
    message?: string;
  };
  request: string;
  images?: string[];
  language?: "en" | "hinglish" | "hi" | "voice";
  /** The intent the front door should read it as. */
  front?: { intent: Intent };
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  truth: Truth;
  hidden?: HiddenSpec;
  oracle: OracleSpec;
  checks: Checks;
  /** For explanations and design: what the judge scores, one criterion per line. */
  rubric?: string[];
  scenario?: Scenario;
  budgetPaise?: number;
  /** A variant of another task (same hidden checks): its id. */
  derivedFrom?: string;
  mined?: { fix: string; parent: string; subject: string; date: string; files: string[] };
  validated?: { at: string; baseFails: boolean; oraclePasses: boolean; baseTestsFailed: number; oracleTests: number; ms: number; note?: string };
}

export function taskProblems(t: Partial<Task>): string[] {
  const p: string[] = [];
  if (!t.id || !/^[a-z0-9][a-z0-9._-]{2,80}$/.test(t.id)) p.push("id");
  if (!t.category || !(CATEGORIES as readonly string[]).includes(t.category)) p.push("category");
  if (!t.repo) p.push("repo");
  if (!t.request || t.request.trim().length < 3) p.push("request");
  if (!t.truth || !Array.isArray(t.truth.files)) p.push("truth");
  if (!t.oracle?.kind) p.push("oracle");
  if (!t.checks) p.push("checks");
  if (t.base && !t.base.commit && !t.base.files && !t.base.empty) p.push("base");
  return p;
}

/** Every task in e2e/tasks, in id order. A file may hold one task or an array. */
export function loadTasks(o: { dir?: string; glob?: string } = {}): Task[] {
  const dir = o.dir ?? TASKS_DIR;
  const out: Task[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "author") walk(f); continue; }
      if (!e.name.endsWith(".json")) continue;
      const j = readJson<Task | Task[]>(f);
      for (const t of Array.isArray(j) ? j : [j]) out.push(t);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  const seen = new Set<string>();
  for (const t of out) {
    const bad = taskProblems(t);
    if (bad.length) throw new Error(`task ${t.id ?? "(no id)"} is not usable: ${bad.join(", ")}`);
    if (seen.has(t.id)) throw new Error(`task id used twice: ${t.id}`);
    seen.add(t.id);
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return o.glob ? out.filter((t) => matchGlob(o.glob!, t.id)) : out;
}

/** `*` matches anything but `/`; a list separated by commas is any of them. A pattern of `category:bug` matches a category, `tag:x` a tag. */
export function matchGlob(glob: string, id: string, t?: Pick<Task, "category" | "tags" | "repo">): boolean {
  return glob.split(",").some((g) => {
    const s = g.trim();
    if (!s || s === "*") return true;
    if (t && s.startsWith("category:")) return t.category === s.slice(9);
    if (t && s.startsWith("tag:")) return t.tags.includes(s.slice(4));
    if (t && s.startsWith("repo:")) return t.repo === s.slice(5);
    const re = new RegExp(`^${s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return re.test(id);
  });
}

export function selectTasks(tasks: readonly Task[], glob?: string): Task[] {
  if (!glob) return [...tasks];
  return tasks.filter((t) => matchGlob(glob, t.id, t));
}

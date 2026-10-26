/**
 * WHETHER THE PERSON'S OWN CI WOULD ALSO RUN ON TAILZU'S THROWAWAY BRANCH, AND SPEND THEIR MINUTES.
 *
 * A step that runs on GitHub's free computers is a push to a `tailzu-run/…`
 * branch (githubActions.ts). A workflow of the person's own that runs "on:
 * push" with no branch filter runs on that push too, and every minute of it
 * comes out of the same free allowance. Tailzu doesn't block on that (the
 * person may want it), but it should know, count an estimate of the extra
 * minutes, and say so (GET /v1/code/projects/:id, field `ciNoise`).
 *
 * This reads the text of a workflow file and answers whether its `on:` has a
 * push trigger that would fire for a `tailzu-run/` branch holding the three
 * runner files. There is no YAML parser here on purpose (no new dependency):
 * only the shapes that `on:` is written in:
 *
 *   on: push                         on: [push, pull_request]
 *   on:                              on:
 *     - push                           push:
 *                                        branches: [main]
 *   on: { push: { branches: [main] } }
 *
 * and under `push:` the filters `branches`, `branches-ignore`, `tags`,
 * `tags-ignore`, `paths` and `paths-ignore`, each as a flow list `[a, b]`, a
 * block list, or one word. A push with `branches` fires only for branches that
 * match; with `branches-ignore`, for all but those; with only `tags`, never for
 * a branch; with `paths`, only if one of the runner files matches. Anything it
 * cannot read counts as quiet: this is an estimate that errs towards not
 * crying wolf, never a gate.
 */
import { branchMatches } from "../policy.js";
import { SHADOW_FILES } from "../shadow.js";

/** What one noisy workflow is guessed to cost per step: a short job or two. */
export const CI_NOISE_MINUTES_EACH = 3;
/** The most extra minutes counted for a step, however many workflows there are. */
export const CI_NOISE_MINUTES_MAX = 30;
/** Workflow files read at most. */
export const CI_WORKFLOWS_MAX = 30;

export interface CiNoise {
  /** Some workflow on the default branch would also run on a tailzu-run/ push. */
  ciNoise: boolean;
  /** An estimate of the extra minutes one step costs the person because of it. 0 when quiet. */
  extraMinutes: number;
  /** The files, by path, that would run. */
  workflows: string[];
}

type Filters = Record<string, string[]>;

/** A line with its comment cut off (a `#` outside quotes) and trailing space gone. */
function stripComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

const unquote = (s: string): string => s.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();

/** `[a, b]`, `a` or `"a"` as a list of words. */
function listOf(value: string): string[] {
  const v = value.trim();
  if (v.startsWith("[")) return v.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);
  return v ? [unquote(v)] : [];
}

const FILTER_KEYS = ["branches", "branches-ignore", "tags", "tags-ignore", "paths", "paths-ignore"];

/** The filters named inside a flow map `{ branches: [main], paths: [x] }`. */
function filtersOfFlow(inner: string): Filters {
  const out: Filters = {};
  for (const key of FILTER_KEYS) {
    const m = new RegExp(`(?:^|[,{\\s])["']?${key}["']?\\s*:\\s*(\\[[^\\]]*\\]|[^,}\\s][^,}]*)`).exec(inner);
    if (m) out[key] = listOf(m[1]!);
  }
  return out;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * The push trigger of a workflow: null when it has none, else its filters
 * (empty when unfiltered).
 */
export function pushTrigger(yaml: string): Filters | null {
  const lines = String(yaml).replace(/\t/g, "  ").split(/\r?\n/).map(stripComment);
  const at = lines.findIndex((l) => /^(?:on|"on"|'on')\s*:/.test(l));
  if (at < 0) return null;
  const rest = lines[at]!.replace(/^(?:on|"on"|'on')\s*:/, "").trim();

  if (rest) {
    if (rest.startsWith("[")) return listOf(rest).includes("push") ? {} : null;
    if (rest.startsWith("{")) {
      const m = /(?:^|[{,\s])["']?push["']?\s*:\s*(\{[^}]*\}|null|~)?/.exec(rest);
      if (!m) return null;
      return m[1] && m[1].startsWith("{") ? filtersOfFlow(m[1]) : {};
    }
    return unquote(rest) === "push" ? {} : null;
  }

  // A block: the lines indented below `on:` until the next line at the left edge.
  const block: string[] = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    if (indentOf(l) === 0) break;
    block.push(l);
  }
  if (!block.length) return null;
  const base = Math.min(...block.map(indentOf));
  const top = block.filter((l) => indentOf(l) === base);

  // on: - push
  if (top.every((l) => l.trim().startsWith("-"))) {
    return top.some((l) => unquote(l.trim().replace(/^-\s*/, "")) === "push") ? {} : null;
  }

  const idx = block.findIndex((l) => indentOf(l) === base && /^["']?push["']?\s*:/.test(l.trim()));
  if (idx < 0) return null;
  const inline = block[idx]!.trim().replace(/^["']?push["']?\s*:/, "").trim();
  if (inline.startsWith("{")) return filtersOfFlow(inline);
  if (inline && inline !== "null" && inline !== "~") return {};

  // push:
  //   branches: [main]
  //   tags:
  //     - 'v*'
  const body: string[] = [];
  for (let i = idx + 1; i < block.length; i += 1) {
    if (indentOf(block[i]!) <= base) break;
    body.push(block[i]!);
  }
  const filters: Filters = {};
  if (!body.length) return filters;
  const keyIndent = Math.min(...body.map(indentOf));
  for (let i = 0; i < body.length; i += 1) {
    const l = body[i]!;
    if (indentOf(l) !== keyIndent) continue;
    const m = /^["']?([A-Za-z-]+)["']?\s*:\s*(.*)$/.exec(l.trim());
    if (!m || !FILTER_KEYS.includes(m[1]!)) continue;
    if (m[2]!.trim()) { filters[m[1]!] = listOf(m[2]!); continue; }
    const items: string[] = [];
    for (let j = i + 1; j < body.length && indentOf(body[j]!) > keyIndent; j += 1) {
      const item = /^-\s*(.*)$/.exec(body[j]!.trim());
      if (item) items.push(unquote(item[1]!));
    }
    filters[m[1]!] = items;
  }
  return filters;
}

/** A GitHub filter list against one name: patterns in order, a `!` one takes back what came before. */
function filterMatches(patterns: readonly string[], value: string): boolean {
  let hit = false;
  for (const p of patterns) {
    if (p.startsWith("!")) { if (branchMatches(p.slice(1), value)) hit = false; } else if (branchMatches(p, value)) hit = true;
  }
  return hit;
}

/** Whether a push trigger fires for a push of a new `tailzu-run/` branch that adds the three runner files. */
export function firesForRunnerPush(filters: Filters | null, branch = "tailzu-run/00000000-0-1"): boolean {
  if (!filters) return false;
  if (filters.branches) {
    if (!filterMatches(filters.branches, branch)) return false;
  } else if (filters["branches-ignore"]) {
    if (filterMatches(filters["branches-ignore"], branch)) return false;
  } else if (filters.tags || filters["tags-ignore"]) {
    return false;
  }
  if (filters.paths && !SHADOW_FILES.some((f) => filterMatches(filters.paths!, f))) return false;
  if (filters["paths-ignore"] && SHADOW_FILES.every((f) => filterMatches(filters["paths-ignore"]!, f))) return false;
  return true;
}

/** The verdict for a repo's workflow files: which of them would run on a runner push, and a guess at what that costs a step. */
export function ciNoiseOf(files: ReadonlyArray<{ path: string; text: string }>): CiNoise {
  const workflows = files
    .filter((f) => /\.ya?ml$/i.test(f.path) && !/(^|\/)tailzu-run\.yml$/i.test(f.path))
    .filter((f) => firesForRunnerPush(pushTrigger(f.text)))
    .map((f) => f.path);
  return {
    ciNoise: workflows.length > 0,
    extraMinutes: Math.min(CI_NOISE_MINUTES_MAX, workflows.length * CI_NOISE_MINUTES_EACH),
    workflows,
  };
}

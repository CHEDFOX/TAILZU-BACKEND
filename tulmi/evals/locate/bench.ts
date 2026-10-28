/**
 * LOCATE, WITH AND WITHOUT THE REPO MAP: DOES THE FILE THAT SHOULD CHANGE COME FIRST?
 *
 * Three sets of tasks, each with the files that are right (gold), run through locate's own signals and fusion (fusedFor: no model, no threshold) and
 * scored by where the first gold file lands:
 *
 *   fixtures   the requests of the locate tests (tests/code-work-locate.test.ts), on the real "Acme Shop" brain, plus a few more of the same kind
 *   defined    on a brain of tulmi/src itself, built by the real build: "fix the bug in <name>", gold = the file that defines the name. The other
 *              signals solve these; they are here to show the map does not take that away
 *   callers    the same brain: "update the code that uses <X> and <Y>", gold = the files that refer to both. Written to ask what the map is for
 *              (the thing named is not the thing to change); how they are made is in generateCallers(), and they are a synthetic set, not requests
 *              people wrote
 *
 * The tasks of `defined` and `callers` are split by a hash of their gold file into DEV (to choose the map's settings) and TEST (to report them).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { distinctive } from "../../src/code/project/repomap.js";
import { isTestPath } from "../../src/code/project/lang.js";
import type { StoredFile } from "../../src/code/project/types.js";
import { baseSignals, fusedWith, type BaseSignals, type LocateBrain, type MapSettings } from "../../src/code/work/locate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");

export interface Task { id: string; set: "fixtures" | "defined" | "callers"; text: string; gold: string[]; split: "dev" | "test" }

export interface Score { n: number; top1: number; top3: number; top5: number; top8: number; mrr: number; found: number }

export function score(ranks: number[]): Score {
  const n = ranks.length;
  const at = (k: number) => ranks.filter((r) => r > 0 && r <= k).length / (n || 1);
  return { n, top1: at(1), top3: at(3), top5: at(5), top8: at(8), mrr: ranks.reduce((a, r) => a + (r > 0 ? 1 / r : 0), 0) / (n || 1), found: ranks.filter((r) => r > 0).length / (n || 1) };
}

/** The rank (1 for first) of the first gold file in the fused list, or 0 when none is in it. `base` is the five signals of the task, made once. */
export async function rankOf(brain: LocateBrain, task: Task, base: BaseSignals, map: MapSettings): Promise<number> {
  const fused = await fusedWith(brain, base, map);
  const i = fused.findIndex((f) => task.gold.includes(f.path));
  return i < 0 ? 0 : i + 1;
}

export { baseSignals };

/**
 * A draw that belongs to the item, not to its place in the list: a new file in src/ used to shift every later draw and so change the whole sample (and a test's
 * bounds with it) without changing locate at all.
 */
const stableKey = (seed: number, id: string): number => createHash("sha1").update(`${seed}:${id}`).digest().readUInt32BE(0) / 2 ** 32;

export const splitOf = (path: string): "dev" | "test" => (createHash("sha1").update(path).digest()[0]! % 2 === 0 ? "dev" : "test");

// ------------------------------------------------------------ the tulmi/src brain

export function appSources(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !n.endsWith(".d.ts") && statSync(p).size < 400_000) out[relative(APP, p)] = readFileSync(p, "utf8");
    }
  };
  walk(join(APP, "src"));
  for (const f of ["package.json", "tsconfig.json"]) out[f] = readFileSync(join(APP, f), "utf8");
  return out;
}

// ---------------------------------------------------------------- the tasks


/** "fix the bug in <name>": one distinctive exported name that only one source file defines. */
export function generateDefined(files: readonly StoredFile[], max = 120): Task[] {
  const definers = new Map<string, string[]>();
  for (const f of files) for (const s of f.symbols) {
    if (s.exported === false || !["function", "class", "interface", "type", "enum", "const"].includes(s.kind) || s.name.includes(".")) continue;
    const l = definers.get(s.name) ?? [];
    if (!l.includes(f.path)) l.push(f.path);
    definers.set(s.name, l);
  }
  const tasks: Task[] = [];
  const names = [...definers.entries()].filter(([n, ps]) => distinctive(n) && ps.length === 1 && !isTestPath(ps[0]!)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const picked = names.map((e) => ({ e, r: stableKey(7, JSON.stringify(e)) })).sort((a, b) => a.r - b.r).slice(0, max).map((x) => x.e);
  for (const [name, [path]] of picked) tasks.push({ id: `defined:${name}`, set: "defined", text: `fix the bug in ${name}`, gold: [path!], split: splitOf(path!) });
  return tasks;
}

/**
 * "update the code that uses <X> and <Y> so that it ...": X and Y are two distinctive names, each defined in exactly one source file, that some file F refers
 * to both of, F being a file that defines neither. Gold is every file that refers to both (at most three, so that the task points at a place). The request
 * names the two things F depends on, and not F.
 */
export function generateCallers(files: readonly StoredFile[], max = 120): Task[] {
  const definer = new Map<string, string>();
  const count = new Map<string, number>();
  for (const f of files) for (const s of f.symbols) {
    if (s.exported === false || !["function", "class", "interface", "type", "enum", "const"].includes(s.kind) || s.name.includes(".")) continue;
    count.set(s.name, (count.get(s.name) ?? 0) + 1);
    definer.set(s.name, f.path);
  }
  const usable = (name: string) => distinctive(name) && count.get(name) === 1 && !isTestPath(definer.get(name)!);
  const users = new Map<string, Set<string>>();
  for (const f of files) {
    if (isTestPath(f.path)) continue;
    for (const [name] of f.refs ?? []) {
      if (!usable(name) || definer.get(name) === f.path) continue;
      const set = users.get(name) ?? new Set<string>();
      set.add(f.path);
      users.set(name, set);
    }
  }
  const seen = new Set<string>();
  const tasks: Task[] = [];
  const order = files.filter((f) => !isTestPath(f.path) && f.refs?.length).map((f) => ({ f, r: stableKey(11, f.path) })).sort((a, b) => a.r - b.r).map((x) => x.f);
  for (const f of order) {
    const mine = (f.refs ?? []).map(([n]) => n).filter((n) => usable(n) && definer.get(n) !== f.path && users.has(n));
    // Two names from two different files, used together in as few files as possible.
    let best: { x: string; y: string; gold: string[] } | null = null;
    for (let i = 0; i < mine.length; i += 1) for (let j = i + 1; j < mine.length; j += 1) {
      const x = mine[i]!, y = mine[j]!;
      if (definer.get(x) === definer.get(y)) continue;
      const gold = [...users.get(x)!].filter((p) => users.get(y)!.has(p));
      if (gold.length < 1 || gold.length > 3 || !gold.includes(f.path)) continue;
      if (!best || gold.length < best.gold.length) best = { x, y, gold };
    }
    if (!best) continue;
    const key = [...best.gold].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ id: `callers:${f.path}`, set: "callers", text: `update the code that uses ${best.x} and ${best.y} so that it handles failures`, gold: best.gold, split: splitOf(f.path) });
    if (tasks.length >= max) break;
  }
  return tasks;
}

/** The requests of the locate tests on the Acme Shop brain, and a few more of the same kind. Gold is the file the test (or the plain reading) says. */
export const ACME_TASKS: readonly Omit<Task, "split" | "set">[] = [
  { id: "ui-text", text: "Change the 'Create account' button text on the signup page to 'Join now'", gold: ["src/components/SignupForm.tsx"] },
  { id: "symbol", text: "rename fetchUsers to loadUsers everywhere", gold: ["src/lib/api.ts"] },
  { id: "route", text: "POST /api/users should reject an empty body", gold: ["src/app/api/users/route.ts"] },
  { id: "path", text: "look at src/lib/util.ts, slug lowercases badly", gold: ["src/lib/util.ts"] },
  { id: "trace", text: "TypeError: x is not a function\n    at fetchUsers (src/lib/api.ts:5:10)\n    at SignupForm (src/components/SignupForm.tsx:9:3)", gold: ["src/lib/api.ts"] },
  { id: "settings", text: "the Account settings page should keep the display name when it saves", gold: ["src/components/SettingsForm.tsx"] },
  { id: "health", text: "the /health route should also say the version", gold: ["src/server/index.ts"] },
  { id: "python", text: "the Item model in the API needs a price", gold: ["api/models.py"] },
  { id: "flutter", text: "change the hint on the home screen search to 'Find a product'", gold: ["app/lib/screens/home.dart"] },
  { id: "go", text: "store.Get in the Go service returns the wrong thing", gold: ["svc/internal/store/store.go"] },
  { id: "callers", text: "update the code that calls fetchUsers and slug", gold: ["src/lib/api.ts", "src/components/SignupForm.tsx"] },
  { id: "api-version", text: "bump API_VERSION to v2", gold: ["src/lib/api.ts"] },
];

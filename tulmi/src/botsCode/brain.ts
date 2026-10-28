/**
 * WHAT THE PROJECT BRAIN SAYS, IN THE CODE BOT HOME'S WORDS: what the project is built with, its health ("212 of 215
 * tests pass"), what was already broken before the bot touched it, and the good first tasks. Read from GET
 * /v1/code/projects/:id/brain (code/project BrainView), as much of it as the screens use. Pure; every part may be
 * missing (a brain still building, a repo with no commits) and then says nothing rather than guess.
 */

/** GET /v1/code/projects/:id/brain, narrowed to what the Bots app reads. */
export interface BrainLite {
  status: "none" | "building" | "ready" | "failed" | "stale";
  progress?: { pct: number; phase: string };
  builtAt?: number | null;
  welcome?: string;
  structure?: {
    note?: string;
    fileCount: number;
    analysedCount?: number;
    languages?: Array<{ lang: string; pct: number }>;
    frameworks?: string[];
    commands?: Array<{ kind: string; cmd: string }>;
    readme?: { title: string } | null;
    secretFiles?: string[];
    testing?: { frameworks: string[]; testFiles: number; untestedHot: string[] };
  } | null;
  features?: Array<{ name: string; summary?: string; files: string[]; fileCount: number; routes?: string[] }>;
  conventions?: { branches?: { naming: string | null } } | null;
  baseline?: {
    plan: Array<{ kind: string; cmd: string }>;
    recorded: { at: number; healthy: boolean; results: Array<{ kind: string; exitCode: number; summary: string; failing?: string[] }> } | null;
  } | null;
  error?: string;
}

/** "Next.js", "TypeScript", "Supabase", "1,284 files": the chips under "I've read your project". */
export function stackChips(b: BrainLite | undefined, o: { files?: boolean; max?: number } = {}): string[] {
  const s = b?.structure;
  if (!s) return [];
  const out: string[] = [];
  for (const f of s.frameworks ?? []) if (!out.includes(f)) out.push(f);
  const lang = s.languages?.[0]?.lang;
  if (lang && !out.some((x) => x.toLowerCase() === lang.toLowerCase())) out.push(lang);
  const top = out.slice(0, o.max ?? 3);
  if (o.files !== false && s.fileCount > 0) top.push(`${s.fileCount.toLocaleString("en-IN")} files`);
  return top;
}

/** What it is built with, in one word or two ("Next.js"), for a project row. */
export const builtWith = (b: BrainLite | undefined): string => stackChips(b, { files: false, max: 1 })[0] ?? "";

export interface Health {
  /** "212 of 215 tests pass", "All checks pass", "3 tests failing". */
  line: string;
  passed?: number;
  total?: number;
  /** The tests (or checks) that were already failing before the bot touched anything. */
  failing: string[];
  failingCount: number;
  /** When the checks were run. */
  at: number;
}

const num = (re: RegExp, s: string): number | undefined => {
  const m = s.match(re);
  return m ? Number(m[1]) : undefined;
};

/** The project's health from its recorded baseline. Null when the checks were never run. */
export function health(b: BrainLite | undefined): Health | null {
  const rec = b?.baseline?.recorded;
  if (!rec) return null;
  const tests = rec.results.filter((r) => r.kind === "test");
  const failing = rec.results.flatMap((r) => (r.exitCode !== 0 ? r.failing ?? [] : []));
  let passed: number | undefined, failed: number | undefined;
  for (const t of tests) {
    passed = num(/(\d[\d,]*)\s*(?:tests?\s*)?(?:passed|passing|pass\b|ok\b)/i, t.summary.replace(/,/g, "")) ?? passed;
    failed = num(/(\d[\d,]*)\s*(?:tests?\s*)?(?:failed|failing|fail\b)/i, t.summary.replace(/,/g, "")) ?? failed;
  }
  const failingCount = failed ?? failing.length;
  if (passed !== undefined) {
    const total = passed + (failed ?? 0);
    return { line: failingCount ? `${passed.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} tests pass` : `All ${passed.toLocaleString("en-IN")} tests pass`, passed, total, failing: failing.slice(0, 5), failingCount, at: rec.at };
  }
  const broken = rec.results.filter((r) => r.exitCode !== 0).length;
  if (!broken) return { line: rec.results.length ? "All checks pass" : "No checks to run", failing: [], failingCount: 0, at: rec.at };
  const n = failingCount || broken;
  return { line: failingCount ? `${n} test${n === 1 ? "" : "s"} failing` : `${n} check${n === 1 ? "" : "s"} failing`, failing: failing.slice(0, 5), failingCount: n, at: rec.at };
}

/** The tests the project has, as a project row says it: "212 of 215 tests pass", "no tests yet · I can add some". */
export function testsLine(b: BrainLite | undefined): string {
  const h = health(b);
  if (h) return h.line;
  const files = b?.structure?.testing?.testFiles;
  if (files === 0) return "no tests yet · I can add some";
  if (files) return `${files.toLocaleString("en-IN")} test file${files === 1 ? "" : "s"}`;
  return "";
}

/** The feature a file belongs to, by the brain's clusters ("Checkout"), else the file's folder. */
export function placeOf(b: BrainLite | undefined, path: string): string {
  const f = b?.features?.find((x) => x.files.includes(path));
  if (f) return f.name;
  const parts = path.split("/");
  return parts.length > 1 ? parts[parts.length - 2]! : parts[0]!;
}

export interface FirstTask { label: string; task: string; sub?: string }

/** Good first tasks, from what the brain found: the failing tests, a busy part with no tests, no tests at all, no README. */
export function firstTasks(b: BrainLite | undefined, max = 3): FirstTask[] {
  const out: FirstTask[] = [];
  const h = health(b);
  if (h && h.failingCount > 0) {
    const n = h.failingCount;
    out.push({ label: `Fix the ${n} failing test${n === 1 ? "" : "s"}`, task: `Fix the ${n} failing test${n === 1 ? "" : "s"}${h.failing.length ? `: ${h.failing.slice(0, 5).join(", ")}` : ""}.` });
  }
  for (const path of b?.structure?.testing?.untestedHot ?? []) {
    if (out.length >= max) break;
    const place = placeOf(b, path);
    if (out.some((t) => t.label.includes(place))) continue;
    out.push({ label: `Add tests to ${place}`, sub: "busy, untested", task: `Add tests to ${place} (${path}): it changes often and nothing tests it.` });
  }
  if (b?.structure && b.structure.testing?.testFiles === 0 && out.length < max && !out.some((t) => t.label.startsWith("Add tests"))) {
    out.push({ label: "Add the first tests", task: "Add the first tests to this project, for the parts people use most." });
  }
  if (b?.structure && b.structure.fileCount > 0 && b.structure.readme == null && out.length < max) {
    out.push({ label: "Write a README", task: "Write a README: what this project is, how to run it, and how to test it." });
  }
  return out.slice(0, max);
}

/** The checks the bot runs before a pull request, from the brain's baseline plan ("pnpm lint", "pnpm test"). */
export const checksOf = (b: BrainLite | undefined): string[] =>
  (b?.baseline?.plan ?? []).filter((p) => p.kind !== "install").map((p) => p.cmd);

/** The repo has no commits: a new project to plan, not code to read. */
export const isEmptyRepo = (b: BrainLite | undefined): boolean =>
  !!b && b.status === "ready" && (b.structure?.fileCount ?? 0) === 0 && /no commits/i.test(b.structure?.note ?? "");

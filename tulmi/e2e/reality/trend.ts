/**
 * THE TREND: ONE LINE PER RUN, SO THE QUESTION "IS IT GETTING BETTER?" HAS AN ANSWER.
 *
 * `REALITY.md` and `latest.html` are a SNAPSHOT: where the product stands at one commit. Both are rewritten every run, so
 * the thing nobody could see was MOVEMENT — whether a verdict that reads "weak" today read "working" a fortnight ago, and
 * whether a success now costs more rupees than it did. That is the only form in which "we are the best" is a claim rather
 * than a hope, and it is also how the model ladders stay right while new models land every month.
 *
 * So each run appends one line to `e2e/results/trend.jsonl` (committed, append-only, as the results store is):
 *
 *   at, code      when, and the fingerprint of the code it measured: two runs of the same code are the same point
 *   mode          real (models were called and paid), prove (stage 0 real, the rest replayed or simulated)
 *   stages        which stages ran, so a free nightly line is never read as a full one
 *   suite         the offline tests and the typecheck: the free, certain part
 *   areas         one verdict a named area of the product
 *   ours          how our own agent did on the sampled tasks, and what a success cost
 *   spendInr      what the run itself cost
 *
 * NOTHING HERE PAYS FOR ANYTHING. It reads a finished run. The nightly use is `--stages 0 --trend`, which is FREE (stage 0
 * is the offline suite, every cassette replayed against the current code, and the free bake-offs) and still catches the thing
 * that matters most: a change that broke what used to work.
 *
 * A trend is only honest if the lines are comparable, so `movement()` compares LIKE WITH LIKE: a line is only set against an
 * earlier line of the same mode whose stages cover the same areas. A free nightly line is never read as evidence about an
 * area only a paid stage measures, and an area with no earlier line of its own says "new", not "better".
 */
import fs from "node:fs";
import path from "node:path";
import type { Analysis } from "./analysis.js";
import type { RunState } from "./stages.js";
import type { StageId } from "./types.js";

export const TREND_FILE = "trend.jsonl";
/** The most lines read back: a year of nightlies. */
export const TREND_KEPT = 400;

export type TrendMode = "real" | "prove";

export interface TrendArea {
  area: string;
  verdict: string;
  /** How many results stand behind it, so a verdict on one result is not read as one on fifty. */
  n: number;
  pass: number;
}

export interface TrendLine {
  at: string;
  code: string;
  mode: TrendMode;
  stages: StageId[];
  suite: { tests: number; failed: number; typecheck: boolean } | null;
  areas: TrendArea[];
  ours: { tasks: number; passed: number; inrPerPass: number | null } | null;
  spendInr: number;
  /**
   * THE DESIGN LAYER, MEASURED (design.ts). Faults planted in a corpus of pages, opened in a real browser and read by the real checks: the share
   * caught, and how much was said about the pages with nothing wrong. The second is the one that decides whether the layer survives a person, so
   * it is on the line beside the first. Absent when no browser was available to draw the pages.
   */
  design?: { caught: number; planted: number; crying: number; verdict: string } | null;
}

const round = (n: number, p = 2): number => Math.round(n * 10 ** p) / 10 ** p;

/** The line this run adds. Reads a finished run and pays for nothing. */
export function lineOf(st: RunState, a: Analysis, o: { mode: TrendMode; spendInr: number; code: string }): TrendLine {
  // Our own agent's work, as the stage rates have it: the "work" stage is the change itself, which is what a success means.
  const work = a.stageRates.work;
  const tasks = work?.n ?? 0;
  const passed = work?.pass ?? 0;
  const tests = st.suite?.tests;
  return {
    at: new Date().toISOString(),
    code: o.code,
    mode: o.mode,
    stages: [...st.stages.map((s) => s.stage)].sort((x, y) => x - y),
    suite: tests ? { tests: tests.total, failed: tests.failed, typecheck: st.suite?.typecheck?.ok === true } : null,
    areas: a.verdicts.map((v) => ({ area: v.area, verdict: v.verdict, n: v.n, pass: v.pass })),
    ours: tasks > 0 ? { tasks, passed, inrPerPass: passed > 0 ? round(o.spendInr / passed) : null } : null,
    spendInr: round(o.spendInr),
  };
}

/** Appends one line. A trend that cannot be written is never a failed run: the run's own answers are already in the report. */
export function append(dir: string, line: TrendLine, warn?: (m: string) => void): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, TREND_FILE), `${JSON.stringify(line)}\n`);
  } catch (err) {
    warn?.(`the trend line was not kept: ${(err as Error)?.message ?? "unknown"}`);
  }
}

/** Every line kept, oldest first. A line that cannot be read is skipped, not thrown: the file is append-only and may be cut mid-write. */
export function read(dir: string): TrendLine[] {
  let text: string;
  try { text = fs.readFileSync(path.join(dir, TREND_FILE), "utf8"); } catch { return []; }
  const out: TrendLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const v = JSON.parse(raw) as TrendLine;
      if (typeof v.at === "string" && Array.isArray(v.areas)) out.push(v);
    } catch { /* a half-written line is no line */ }
  }
  return out.slice(-TREND_KEPT);
}

export type Direction = "better" | "worse" | "same" | "new";

export interface AreaMove {
  area: string;
  now: string;
  before?: string;
  direction: Direction;
  /** The line a person reads. */
  words: string;
}

const RANK: Record<string, number> = { working: 3, weak: 2, broken: 1, unknown: 0 };

/**
 * How this run moved against the last COMPARABLE one: the same mode, and an area the earlier run actually measured. An area
 * nobody measured before is "new" rather than an improvement, and an area this run did not measure is left out entirely.
 */
export function movement(lines: readonly TrendLine[], now: TrendLine): AreaMove[] {
  const earlier = [...lines].reverse().find((l) => l.mode === now.mode && l.at !== now.at && l.code !== now.code);
  const was = new Map((earlier?.areas ?? []).map((v) => [v.area, v]));
  return now.areas.map((v) => {
    const before = was.get(v.area);
    // An earlier verdict of "unknown" is not something to be better than: nobody had measured it.
    if (!before || before.verdict === "unknown") {
      return { area: v.area, now: v.verdict, direction: "new" as const, words: `${v.area}: ${v.verdict} (not measured before)` };
    }
    const d = (RANK[v.verdict] ?? 0) - (RANK[before.verdict] ?? 0);
    const direction: Direction = v.verdict === "unknown" ? "same" : d > 0 ? "better" : d < 0 ? "worse" : "same";
    const arrow = direction === "better" ? "↑" : direction === "worse" ? "↓" : "→";
    return {
      area: v.area, now: v.verdict, before: before.verdict, direction,
      words: `${v.area}: ${before.verdict} ${arrow} ${v.verdict}`,
    };
  });
}

/** How the design layer moved: caught more, or cried wolf more. Null when either run did not measure it. */
export function designMove(lines: readonly TrendLine[], now: TrendLine): { caught: Direction; crying: Direction; words: string } | null {
  const earlier = [...lines].reverse().find((l) => l.mode === now.mode && l.at !== now.at && l.code !== now.code && l.design);
  const a = now.design;
  const b = earlier?.design;
  if (!a || !b) return null;
  const way = (nowN: number, wasN: number, lowerBetter: boolean): Direction =>
    nowN === wasN ? "same" : (nowN < wasN) === lowerBetter ? "better" : "worse";
  const caught = way(a.caught, b.caught, false);
  const crying = way(a.crying, b.crying, true);
  const arrow = (d: Direction): string => (d === "better" ? "↑" : d === "worse" ? "↓" : "→");
  return {
    caught, crying,
    words: `The design layer: ${Math.round(b.caught * 100)}% ${arrow(caught)} ${Math.round(a.caught * 100)}% of planted faults caught, and ${b.crying} ${crying === "better" ? "↑" : crying === "worse" ? "↓" : "→"} ${a.crying} said about a sound page.`,
  };
}

/** What a success cost, this run against the last comparable one. Null when either run measured none. */
export function costMove(lines: readonly TrendLine[], now: TrendLine): { now: number; before: number; direction: Direction } | null {
  const earlier = [...lines].reverse().find((l) => l.mode === now.mode && l.at !== now.at && l.ours?.inrPerPass != null);
  const a = now.ours?.inrPerPass;
  const b = earlier?.ours?.inrPerPass;
  if (a == null || b == null) return null;
  // Cheaper is better, so the arrow is the other way round from a verdict's.
  return { now: a, before: b, direction: a < b ? "better" : a > b ? "worse" : "same" };
}

/** The trend as REALITY.md carries it: a short section, and nothing at all when there is only this run. */
export function trendMarkdown(lines: readonly TrendLine[], now: TrendLine): string[] {
  const moves = movement(lines, now);
  const changed = moves.filter((m) => m.direction === "better" || m.direction === "worse");
  const cost = costMove(lines, now);
  if (!changed.length && !cost && !designMove(lines, now)) return [];
  const out = ["## How it has moved", ""];
  if (changed.length) {
    out.push("Against the last comparable run (the same mode, the same areas measured):", "", ...changed.map((m) => `- ${m.words}`), "");
  } else {
    out.push("No area changed its verdict against the last comparable run.", "");
  }
  if (cost) {
    const word = cost.direction === "better" ? "down from" : cost.direction === "worse" ? "up from" : "the same as";
    out.push(`A success costs ₹${cost.now.toFixed(2)}, ${word} ₹${cost.before.toFixed(2)}.`, "");
  }
  const design = designMove(lines, now);
  if (design) out.push(design.words, "");
  const free = lines.filter((l) => l.mode === "prove").length;
  if (free) out.push(`${lines.length} run(s) recorded, ${free} of them free.`, "");
  return out;
}

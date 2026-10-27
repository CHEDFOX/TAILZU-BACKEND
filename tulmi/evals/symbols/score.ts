/**
 * SCORING A SYMBOL READER AGAINST GOLD: PRECISION AND RECALL OVER (NAME, KIND), PER FILE, WITH THE KINDS COMPARED AS CLASSES.
 *
 * A reader's symbol is a true positive when the gold has a definition of the same short name (the part after the last dot, so `Order.get` and `get` are
 * the same name: how a reader qualifies its methods is a naming choice, not an accuracy one) and a compatible kind. Each gold definition is used once.
 * Symbols of kind route, env and entry are not definitions and are left out. A flag (`exported`) is judged only on definitions that matched.
 */
import type { SymbolInfo } from "../../src/code/project/types.js";

export interface Def { name: string; kind: string; exported: boolean; line?: number; nameLine?: number; endLine?: number }

const CLASS: Record<string, string> = {
  function: "fn", component: "component", method: "method", class: "class", struct: "class", interface: "interface", trait: "interface", enum: "enum", type: "type", const: "const", module: "module",
};

export const shortName = (n: string): string => n.split(".").pop() ?? n;

/** A component is a function, a class or a constant that a framework draws: it is compatible with any of them. */
export function compatible(a: string, b: string): boolean {
  const x = CLASS[a] ?? a, y = CLASS[b] ?? b;
  if (x === y) return true;
  const soft = new Set(["fn", "class", "const", "component"]);
  return (x === "component" && soft.has(y)) || (y === "component" && soft.has(x));
}

export const isDefinition = (s: SymbolInfo): boolean => s.kind !== "route" && s.kind !== "env" && s.kind !== "entry";

export interface Tally {
  tp: number; fp: number; fn: number;
  /** Matched definitions whose exported flag agreed / were compared. */
  flagOk: number; flagN: number;
  /** Matched definitions whose line is inside the gold's [start, name] lines / were compared. */
  lineOk: number; lineN: number;
  /** Matched definitions whose endLine equals the gold's / were compared (only readers that give an endLine). */
  endOk: number; endN: number;
  /** What was wrong, for a person to read (not summed). */
  extra?: string[]; missed?: string[]; flagged?: string[];
}

export const emptyTally = (): Tally => ({ tp: 0, fp: 0, fn: 0, flagOk: 0, flagN: 0, lineOk: 0, lineN: 0, endOk: 0, endN: 0 });

export function add(t: Tally, o: Tally): void {
  for (const k of ["tp", "fp", "fn", "flagOk", "flagN", "lineOk", "lineN", "endOk", "endN"] as const) t[k] += o[k];
  if (o.extra?.length) t.extra = [...(t.extra ?? []), ...o.extra];
  if (o.missed?.length) t.missed = [...(t.missed ?? []), ...o.missed];
  if (o.flagged?.length) t.flagged = [...(t.flagged ?? []), ...o.flagged];
}

/** Scores one file. `got` are a reader's definitions, `gold` the truth. */
export function scoreDefs(got: readonly Def[], gold: readonly Def[]): Tally {
  const t = emptyTally();
  const free = gold.map((g) => ({ g, used: false }));
  for (const d of got) {
    let best = -1, bestDist = Infinity;
    free.forEach((f, i) => {
      if (f.used || shortName(f.g.name) !== shortName(d.name) || !compatible(f.g.kind, d.kind)) return;
      const dist = d.line !== undefined && f.g.line !== undefined ? Math.abs(d.line - f.g.line) : 0;
      if (dist < bestDist) { best = i; bestDist = dist; }
    });
    if (best < 0) { t.fp += 1; (t.extra ??= []).push(`${d.kind} ${d.name}`); continue; }
    const f = free[best]!;
    f.used = true;
    t.tp += 1;
    t.flagN += 1;
    if (f.g.exported === d.exported) t.flagOk += 1;
    else (t.flagged ??= []).push(`${d.name} exported=${d.exported} (gold ${f.g.exported})`);
    if (d.line !== undefined && f.g.line !== undefined) {
      t.lineN += 1;
      if (d.line >= f.g.line && d.line <= (f.g.nameLine ?? f.g.line)) t.lineOk += 1;
    }
    if (d.endLine !== undefined && f.g.endLine !== undefined) {
      t.endN += 1;
      if (d.endLine === f.g.endLine) t.endOk += 1;
    }
  }
  t.fn = free.filter((f) => !f.used).length;
  if (t.fn) t.missed = free.filter((f) => !f.used).map((f) => `${f.g.kind} ${f.g.name}`);
  return t;
}

export const precision = (t: Tally): number => (t.tp + t.fp ? t.tp / (t.tp + t.fp) : 1);
export const recall = (t: Tally): number => (t.tp + t.fn ? t.tp / (t.tp + t.fn) : 1);
export const f1 = (t: Tally): number => { const p = precision(t), r = recall(t); return p + r ? (2 * p * r) / (p + r) : 0; };

/** Precision and recall of two string lists as multisets (imports, routes). */
export function scoreList(got: readonly string[], gold: readonly string[]): Tally {
  const t = emptyTally();
  const left = new Map<string, number>();
  for (const g of gold) left.set(g, (left.get(g) ?? 0) + 1);
  for (const x of got) {
    const n = left.get(x) ?? 0;
    if (n > 0) { left.set(x, n - 1); t.tp += 1; } else { t.fp += 1; (t.extra ??= []).push(x); }
  }
  for (const [k, n] of left) if (n > 0) { t.fn += n; (t.missed ??= []).push(k); }
  return t;
}

export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function fromSymbols(symbols: readonly SymbolInfo[]): Def[] {
  return symbols.filter(isDefinition).map((s) => ({ name: s.name, kind: s.kind, exported: s.exported === true, line: s.line, ...(s.endLine ? { endLine: s.endLine } : {}) }));
}

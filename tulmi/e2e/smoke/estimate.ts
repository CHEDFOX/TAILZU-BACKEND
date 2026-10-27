/**
 * WHAT A SMOKE RUN WILL COST, BEFORE IT RUNS: token estimates per item, priced from the live catalog, in rupees, next to the cap.
 *
 * The token counts are the measured size of each kind of item on the tiny fixtures (a task: the front door, classify, locate, plan and up to 12 agent turns
 * of 4,000 tokens in and 350 out; the others a few calls each), rounded up. They are an estimate and say so; the run's own cost is counted from what the
 * model reports. A replay costs nothing.
 */
import type { Catalog } from "../catalog.js";
import { ASSUMED } from "../catalog.js";

export interface ItemShape { id: string; kind: "task" | "front" | "artifact" | "research" | "vision"; inTokens: number; outTokens: number; calls: number }

/** Estimated model traffic of one item, in tokens. */
export const SHAPE: Record<ItemShape["kind"], Omit<ItemShape, "id" | "kind">> = {
  task: { inTokens: 62_000, outTokens: 5_200, calls: 18 },
  front: { inTokens: 4_500, outTokens: 300, calls: 3 },
  artifact: { inTokens: 5_500, outTokens: 1_600, calls: 3 },
  research: { inTokens: 9_000, outTokens: 700, calls: 3 },
  vision: { inTokens: 1_800, outTokens: 150, calls: 1 },
};

export interface Estimate {
  perItem: Array<{ id: string; model: string; inr: number }>;
  totalInr: number;
  capInr: number;
  models: Array<{ slug: string; inUsdPerM: number; outUsdPerM: number; priceSource: "live" | "cache" | "assumed" }>;
  fx: number;
  note: string;
}

export function estimateSmoke(items: ItemShape[], o: { models: string[]; catalog: Catalog; fx: number; capInr: number; replay?: boolean }): Estimate {
  const priceOf = (slug: string): { inUsdPerM: number; outUsdPerM: number; priceSource: "live" | "cache" | "assumed" } => {
    const m = o.catalog.models.get(slug);
    return m ? { inUsdPerM: m.inUsdPerM, outUsdPerM: m.outUsdPerM, priceSource: o.catalog.source === "live" ? "live" : "cache" } : { ...ASSUMED, priceSource: "assumed" };
  };
  const models = [...new Set(o.models)].map((slug) => ({ slug, ...priceOf(slug) }));
  const main = models[0] ?? { slug: "?", ...ASSUMED, priceSource: "assumed" as const };
  const perItem = items.map((it) => {
    const usd = (it.inTokens * main.inUsdPerM + it.outTokens * main.outUsdPerM) / 1e6;
    return { id: it.id, model: main.slug, inr: o.replay ? 0 : usd * o.fx };
  });
  const totalInr = perItem.reduce((n, p) => n + p.inr, 0);
  const note = o.replay ? "a replay calls no model: ₹0" : models.some((m) => m.priceSource === "assumed") ? "some prices are assumed (the model is not in the catalog, or the catalog could not be read)" : `prices from OpenRouter's catalog (${o.catalog.source})`;
  return { perItem, totalInr, capInr: o.capInr, models, fx: o.fx, note };
}

// ------------------------------------------------------------------ a full run on the real projects

/**
 * Model traffic of one task on a real project, per category (tokens in and out, calls). Bigger than a smoke item because the files are real: a bigger brain,
 * longer logs, up to 25 agent turns of 6,000 to 9,000 tokens in. A question is read-only; a long-horizon task is a few milestone jobs. Estimates, rounded up.
 */
export const REAL_SHAPE: Record<string, Omit<ItemShape, "id" | "kind">> = {
  bug: { inTokens: 170_000, outTokens: 11_000, calls: 30 },
  feature: { inTokens: 200_000, outTokens: 14_000, calls: 34 },
  refactor: { inTokens: 260_000, outTokens: 16_000, calls: 38 },
  question: { inTokens: 30_000, outTokens: 2_000, calls: 6 },
  ui: { inTokens: 230_000, outTokens: 17_000, calls: 34 },
  vague: { inTokens: 120_000, outTokens: 8_000, calls: 20 },
  hostile: { inTokens: 120_000, outTokens: 8_000, calls: 22 },
  broken: { inTokens: 150_000, outTokens: 10_000, calls: 26 },
  long: { inTokens: 520_000, outTokens: 36_000, calls: 80 },
  language: { inTokens: 150_000, outTokens: 10_000, calls: 28 },
  disruption: { inTokens: 120_000, outTokens: 8_000, calls: 22 },
};
const REAL_DEFAULT = REAL_SHAPE.bug!;

export interface RunEstimate { totalInr: number; highInr: number; byCategory: Array<{ category: string; tasks: number; inr: number }>; model: string; strongModel: string; fx: number; capInr: number; note: string }

/** What a full run will cost, before it runs: the tasks by category, priced at the code tier's first model (and, as an upper bound, the strong tier's), the judge on top. */
export function estimateRun(
  tasks: ReadonlyArray<{ category: string }>,
  o: { repeats: number; catalog: Catalog; fx: number; capInr: number; codeModel: string; strongModel: string; judgeModel?: string },
): RunEstimate {
  const price = (slug: string): { inUsdPerM: number; outUsdPerM: number; assumed: boolean } => { const m = o.catalog.models.get(slug); return m ? { inUsdPerM: m.inUsdPerM, outUsdPerM: m.outUsdPerM, assumed: false } : { ...ASSUMED, assumed: true }; };
  const code = price(o.codeModel);
  const strong = price(o.strongModel);
  const inr = (p: { inUsdPerM: number; outUsdPerM: number }, s: { inTokens: number; outTokens: number }) => ((s.inTokens * p.inUsdPerM + s.outTokens * p.outUsdPerM) / 1e6) * o.fx;
  const byCat = new Map<string, { tasks: number; inr: number; high: number }>();
  for (const t of tasks) {
    const s = REAL_SHAPE[t.category] ?? REAL_DEFAULT;
    const row = byCat.get(t.category) ?? { tasks: 0, inr: 0, high: 0 };
    row.tasks += o.repeats;
    row.inr += inr(code, s) * o.repeats;
    row.high += inr(strong, s) * o.repeats;
    byCat.set(t.category, row);
  }
  // The rubric judge (a different family) reads each answer once or twice: a few thousand tokens.
  const judge = price(o.judgeModel ?? o.strongModel);
  const judged = tasks.length * o.repeats * inr(judge, { inTokens: 6_000, outTokens: 500 });
  const totalInr = [...byCat.values()].reduce((n, r) => n + r.inr, 0) + judged;
  const highInr = [...byCat.values()].reduce((n, r) => n + r.high, 0) + judged;
  const assumed = code.assumed || strong.assumed;
  return {
    totalInr, highInr, model: o.codeModel, strongModel: o.strongModel, fx: o.fx, capInr: o.capInr,
    byCategory: [...byCat.entries()].map(([category, r]) => ({ category, tasks: r.tasks, inr: r.inr })),
    note: `${assumed ? "some prices are assumed (a model is not in the catalog); " : ""}an estimate from the typical size of a task, not a promise: the run stops cleanly at the cap`,
  };
}

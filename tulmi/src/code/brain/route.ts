/**
 * WHICH TIER, AND WHICH MODEL, FOR THIS STEP: THE ROUTER.
 *
 * routeStep(step, classification, history) answers { tier, model?, reason },
 * or { stop } when the job cannot afford to go on. It is a pure function of what
 * it is given (the tier table, the record of past outcomes and the money left
 * are passed in), so every rule below is a table in the tests.
 *
 * THE MAPPING. A step has a tier it belongs to:
 *
 *   classify                     tiny
 *   search, summarize, index     cheap
 *   research                     cheap when the request is low difficulty, else code
 *   plan                         strong when difficulty or risk is high, or the
 *                                request is a new project (plan_project); else code
 *   write_code                   strong when risk is high; else code
 *   review                       the review pool, minus the writer's family
 *   vision                       vision
 *   indic_text                   indic
 *
 * (research is not in the first design's table; it reads and weighs several
 * things, which suits code's thinking, and an easy lookup does not need it.)
 *
 * CLIMBING. A step that is going badly moves UP one tier on the ladder
 * tiny, cheap, code, strong: when it has failed twice or more, or the work is
 * low-confidence, or it has touched more than ten files. The climb is one tier
 * from the higher of the step's own tier and the tier it was last tried on, so
 * a step that failed twice on code goes to strong and then stays there. It
 * never climbs past strong. Review, vision and indic are not on the ladder and
 * do not climb.
 *
 * MONEY. If the remaining budget cannot afford the chosen tier's worst case
 * (money.ts), the router takes the CHEAPEST tier that can still do the step (a
 * plan or a write_code never goes below code; a classify may go to tiny; a search
 * never below cheap). If even that is out of reach it answers { stop: "budget" },
 * and the caller ends the job or asks for more money; it does not make a call
 * that the gateway would refuse. Review, vision and indic have no cheaper tier
 * that can do the same job, so they stop.
 *
 * LEARNING. Within the chosen tier, if the record of past outcomes (stats.ts)
 * shows a model that has done this kind of step well enough (at least 20 tries,
 * at least 85% worked), the cheapest such model is named first in `model`, ahead
 * of the ladder's own order. With no such model the default order stands and
 * `model` is left out. For review, `model` is always named: the first
 * eligible model, never of the writer's family. If the pool has none, the
 * answer is { stop: "no_reviewer" }.
 */
import { DEFAULT_USD_INR, worstCasePaise } from "./money.js";
import { lookupOf, preferredModel, routeStats, type RouteStatsStore, type StatsLookup } from "./stats.js";
import { reviewCandidates, tierTable, type ModelTier, type TierSettings } from "./tiers.js";
import type { Classification, StepName } from "./types.js";

/** A step that failed this many times climbs. */
export const CLIMB_AFTER_FAILURES = 2;
/** A step that touched more files than this climbs. */
export const CLIMB_AFTER_FILES = 10;
/** The size of a step's input when the caller does not say, for the affordability check. */
export const DEFAULT_INPUT_CHARS = 8_000;

/** The tiers a step climbs through, lowest first. */
export const CLIMB_LADDER: readonly ModelTier[] = ["tiny", "cheap", "code", "strong"];

/** The lowest tier that can do a step; steps not here have one tier and cannot be moved. */
const FLOOR: Partial<Record<StepName, ModelTier>> = {
  classify: "tiny", search: "cheap", summarize: "cheap", index: "cheap", research: "cheap", plan: "code", write_code: "code",
};

export interface StepHistory {
  /** Times this step has failed. */
  failures?: number;
  /** The tier it was last tried on. */
  lastTier?: ModelTier;
  /** The work so far was low-confidence. */
  lowConfidence?: boolean;
  /** Files the job has touched. */
  filesTouched?: number;
  /** For a review: the model that wrote what is being reviewed. */
  writerModel?: string;
}

export interface RouteBudget {
  /** budget_paise less spent_paise. */
  remainingPaise: number;
  /** About how many characters the step will send; DEFAULT_INPUT_CHARS if not said. */
  inputChars?: number;
  /** Rupees to the dollar; the default rate if not said. */
  fx?: number;
}

export interface RouteOptions {
  tiers?: Record<ModelTier, TierSettings>;
  /** The record of past outcomes, for this kind of request and step. */
  stats?: StatsLookup;
  budget?: RouteBudget;
}

export type Route =
  | { tier: ModelTier; model?: string; reason: string; stop?: undefined }
  | { stop: "budget" | "no_reviewer"; reason: string; tier?: undefined; model?: undefined };

const rank = (t: ModelTier | undefined): number => (t ? CLIMB_LADDER.indexOf(t) : -1);

/** The tier a step belongs to before history and money, and why. */
export function baseTier(step: StepName, cls: Pick<Classification, "type" | "difficulty" | "risk">): { tier: ModelTier; why: string } {
  switch (step) {
    case "classify": return { tier: "tiny", why: "classifying is a job for the tiny tier" };
    case "search": case "summarize": case "index": return { tier: "cheap", why: `${step} is a job for the cheap tier` };
    case "review": return { tier: "review", why: "a review is by a model of another family from the writer" };
    case "vision": return { tier: "vision", why: "reading a picture" };
    case "indic_text": return { tier: "indic", why: "wording in an Indian language" };
    case "research":
      return cls.difficulty === "low"
        ? { tier: "cheap", why: "research on an easy request" }
        : { tier: "code", why: "research on a request that is not easy" };
    case "plan":
      if (cls.type === "plan_project") return { tier: "strong", why: "planning a new project" };
      if (cls.risk === "high") return { tier: "strong", why: "planning a risky change" };
      if (cls.difficulty === "high") return { tier: "strong", why: "planning a hard change" };
      return { tier: "code", why: "planning an ordinary change" };
    case "write_code":
      return cls.risk === "high"
        ? { tier: "strong", why: "writing code for a risky change" }
        : { tier: "code", why: "writing code" };
  }
}

/** Why a step should climb, in words; empty when it should not. */
export function climbReasons(h: StepHistory): string[] {
  const why: string[] = [];
  if ((h.failures ?? 0) >= CLIMB_AFTER_FAILURES) why.push(`${h.failures} failures`);
  if (h.lowConfidence) why.push("low confidence");
  if ((h.filesTouched ?? 0) > CLIMB_AFTER_FILES) why.push(`${h.filesTouched} files touched`);
  return why;
}

export function routeStep(step: StepName, cls: Classification, history: StepHistory = {}, opts: RouteOptions = {}): Route {
  const tiers = opts.tiers ?? tierTable();
  const base = baseTier(step, cls);
  let tier = base.tier;
  const notes = [base.why];

  // Up one tier when it is going badly: from the higher of where it belongs and where it was last tried.
  const climb = climbReasons(history);
  if (climb.length && rank(tier) >= 0) {
    const from = Math.max(rank(tier), rank(history.lastTier));
    const to = CLIMB_LADDER[Math.min(from + 1, CLIMB_LADDER.length - 1)]!;
    if (to !== tier) {
      notes.push(`climbed from ${CLIMB_LADDER[from]} to ${to} (${climb.join(", ")})`);
      tier = to;
    } else {
      notes.push(`already at ${tier}, the top (${climb.join(", ")})`);
    }
  }

  // Money: the chosen tier if it can be afforded, else the cheapest that can do the step, else stop.
  if (opts.budget) {
    const { remainingPaise } = opts.budget;
    const fx = opts.budget.fx ?? DEFAULT_USD_INR;
    const chars = opts.budget.inputChars ?? DEFAULT_INPUT_CHARS;
    const cost = (t: ModelTier) => worstCasePaise({ chars, maxTokens: tiers[t].maxTokens, usdPerMIn: tiers[t].usdPerMIn, usdPerMOut: tiers[t].usdPerMOut }, fx);
    if (cost(tier) > remainingPaise) {
      const floor = FLOOR[step];
      const eligible = floor ? CLIMB_LADDER.slice(rank(floor)) : [];
      const cheapest = eligible.reduce<ModelTier | undefined>((best, t) => (best === undefined || cost(t) < cost(best) ? t : best), undefined);
      if (!cheapest || cost(cheapest) > remainingPaise) {
        return { stop: "budget", reason: `${notes.join("; ")}; the ${cheapest ?? tier} tier needs up to ${cost(cheapest ?? tier)} paise and ${Math.max(0, remainingPaise)} are left` };
      }
      if (cheapest !== tier) {
        notes.push(`${tier} needs up to ${cost(tier)} paise and ${Math.max(0, remainingPaise)} are left, so ${cheapest}`);
        tier = cheapest;
      }
    }
  }

  // Which model on the tier: the record's pick if it has earned one, else the ladder's own order.
  const settings = tiers[tier];
  const candidates = tier === "review" ? reviewCandidates(settings.models, history.writerModel) : settings.models;
  if (tier === "review" && candidates.length === 0) {
    return { stop: "no_reviewer", reason: `${notes.join("; ")}; no model in the review pool is of a different family from the writer's` };
  }
  let model: string | undefined;
  if (opts.stats) {
    const pick = preferredModel(candidates, cls.type, step, opts.stats);
    if (pick && pick !== candidates[0]) {
      model = pick;
      notes.push(`${pick} first: it has done ${cls.type} ${step} steps well and for less`);
    }
  }
  if (tier === "review") model ??= candidates[0];
  return { tier, ...(model ? { model } : {}), reason: notes.join("; ") };
}

/**
 * routeStep with the record read from the store first. A store that cannot be
 * read means the default order, never a failed step.
 */
export async function planRoute(
  step: StepName, cls: Classification, history: StepHistory = {},
  deps: { store?: RouteStatsStore; budget?: RouteBudget; tiers?: Record<ModelTier, TierSettings> } = {},
): Promise<Route> {
  let stats: StatsLookup | undefined;
  try {
    stats = lookupOf(await (deps.store ?? routeStats()).list(cls.type, step));
  } catch {
    stats = undefined;
  }
  return routeStep(step, cls, history, { ...(deps.tiers ? { tiers: deps.tiers } : {}), ...(deps.budget ? { budget: deps.budget } : {}), ...(stats ? { stats } : {}) });
}

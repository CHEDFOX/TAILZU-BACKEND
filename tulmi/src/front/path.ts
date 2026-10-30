/**
 * WHICH ROAD, WHICH MODEL, HOW MUCH MONEY: THE ROUTE, TIER AND BUDGET OF A DECISION.
 *
 * Every intent has one cheapest road that can do it, and a tier that fits the road:
 *
 *   chat, unclear          reply        tiny      small talk and "I did not catch that" need no more than the smallest model
 *   answer                 reply        cheap     general knowledge, a table inline when asked for
 *   file_question          file         vision    for an image (it is described once); cheap for text and code
 *   code_question          code_answer  cheap     the brain's facts first, a few excerpts only when it must, answer from them (strong for a deep why or an impact question)
 *   code_task              code_job     code      a Xode job (strong when the classifier calls the change risky)
 *   design                 artifact     code      a project-styled component, or a page
 *   research               research     cheap, code or strong, by depth: quick, standard, deep
 *   plan                   plan         cheap, or code in a project
 *
 * The BUDGET is the most the road's work may cost in the worst case, in paise: each call's worst case (money.ts) at its tier, plus the
 * caps the artifact core already holds its calls to. The daily cap (guard/budget) and the gateway's refusal of a call that could pass it
 * keep the promise; this is the number they are held to.
 *
 * Pure: the tier table, the config's default job budget and the rate are passed in.
 */
import { DEFAULT_USD_INR, worstCasePaise } from "../code/brain/money.js";
import type { ModelTier, TierSettings } from "../code/brain/tiers.js";
import { baseTier } from "../code/brain/route.js";
import type { Classification } from "../code/brain/types.js";
import { CAP_PAISE } from "../artifacts/types.js";
import type { Intent, Length, ResearchDepth, RouteName, VisualPlan } from "./types.js";

export type Tiers = Record<ModelTier, TierSettings>;

/** The most a reply may write, by how long it is to be. */
export const REPLY_TOKENS: Readonly<Record<Length, number>> = { short: 350, medium: 800, long: 1600 };
/** What a typical reply writes and reads, for comparing it with a visual. */
const TYPICAL_OUT: Readonly<Record<Length, number>> = { short: 120, medium: 350, long: 800 };
const TYPICAL_IN = 700;

/** Research: the most a whole run may cost, by depth (it is held to this as a budget). */
export const RESEARCH_PAISE: Readonly<Record<ResearchDepth, number>> = { quick: 150, standard: 400, deep: 1000 };
/** What reading the project and picking excerpts may cost before the answer is written. */
export const LOCATE_PAISE = 60;
/** A generic plan, and a plan in a project (the search, then the plan). */
export const PLAN_PAISE = { generic: 120, project: 400 } as const;
/** A message is "costly" past this, in paise: a wrong guess then is worth a question. */
export const COSTLY_PAISE = 200;

export function routeOf(intent: Intent): RouteName {
  switch (intent) {
    case "chat": case "answer": case "unclear": return "reply";
    case "file_question": return "file";
    case "code_question": return "code_answer";
    case "code_task": return "code_job";
    case "design": return "artifact";
    case "research": return "research";
    case "plan": return "plan";
  }
}

export function tierOf(intent: Intent, o: { hasImage: boolean; hasProject: boolean; depth?: ResearchDepth; /** A deep "why" or an "impact" question about the code (code/chat/question.ts): the strong tier. */ deep?: boolean; cls: Pick<Classification, "type" | "difficulty" | "risk"> }): ModelTier {
  switch (intent) {
    case "chat": case "unclear": return "tiny";
    case "code_question": return o.deep ? "strong" : "cheap";
    case "answer": return "cheap";
    case "file_question": return o.hasImage ? "vision" : "cheap";
    case "code_task": return baseTier("write_code", o.cls).tier;
    case "design": return "code";
    case "research": return o.depth === "deep" ? "strong" : o.depth === "quick" ? "cheap" : "code";
    case "plan": return o.hasProject ? "code" : "cheap";
  }
}

/** What a reply at this tier and length costs in the worst case. */
export function replyCap(tier: ModelTier, length: Length, tiers: Tiers, fx: number): number {
  const t = tiers[tier === "vision" ? "cheap" : tier];
  return worstCasePaise({ chars: 6_000, maxTokens: REPLY_TOKENS[length], usdPerMIn: t.usdPerMIn, usdPerMOut: t.usdPerMOut }, fx);
}

/** What the answer alone typically costs, for comparing a visual with it. */
export function answerPaise(route: RouteName, tier: ModelTier, length: Length, depth: ResearchDepth | undefined, tiers: Tiers, fx: number): number {
  const typical = (t: ModelTier, inTok: number, outTok: number): number => {
    const p = tiers[t === "vision" ? "cheap" : t];
    return Math.ceil(((inTok * p.usdPerMIn + outTok * p.usdPerMOut) / 1_000_000) * fx * 100);
  };
  switch (route) {
    case "research": return typical(depth === "deep" ? "strong" : "code", 9000, depth === "deep" ? 3500 : 1200) + (depth === "deep" ? 150 : 0);
    case "plan": return typical(tier, 900, 700);
    case "code_answer": return typical(tier === "strong" ? "strong" : "cheap", 2500, TYPICAL_OUT[length]) + 10;
    case "code_job": case "artifact": return typical("code", 3000, 2000);
    default: return typical(tier, TYPICAL_IN, TYPICAL_OUT[length]);
  }
}

export interface BudgetInput {
  intent: Intent;
  route: RouteName;
  tier: ModelTier;
  length: Length;
  depth?: ResearchDepth;
  visual: VisualPlan | null;
  hasProject: boolean;
  images: number;
  difficulty: "low" | "medium" | "high";
  jobBudgetPaise: number;
  tiers: Tiers;
  fx?: number;
}

/** The caps of the road's calls, in paise: `route` for the road's own work, `visual` for the picture made beside the answer. */
export interface Caps {
  reply: number;
  route: number;
  visual: number;
  total: number;
}

export function capsOf(i: BudgetInput): Caps {
  const fx = i.fx ?? DEFAULT_USD_INR;
  const reply = replyCap(i.tier, i.length, i.tiers, fx);
  let own = 0;
  switch (i.route) {
    case "reply": own = reply; break;
    case "file": own = reply + i.images * CAP_PAISE.vision; break;
    case "code_answer": own = reply + LOCATE_PAISE; break;
    case "code_job": own = Math.round(i.jobBudgetPaise * (i.difficulty === "low" ? 0.4 : i.difficulty === "high" ? 1.5 : 1)); break;
    case "artifact": own = CAP_PAISE.code + (i.hasProject ? CAP_PAISE.vision + LOCATE_PAISE : 0); break;
    case "research": own = RESEARCH_PAISE[i.depth ?? "standard"]; break;
    case "plan": own = i.hasProject ? PLAN_PAISE.project : PLAN_PAISE.generic; break;
  }
  // A picture made beside the answer: an artifact call has its own cap. A table is part of the reply, an offer costs nothing, a plan's diagram is drawn by code.
  const visual = visualCapOf(i.intent, i.visual);
  return { reply, route: own, visual, total: own + visual };
}

export const budgetOf = (i: BudgetInput): number => capsOf(i).total;

/** What the picture made beside an answer may cost, from the decision alone (the same number capsOf adds to the budget). */
export function visualCapOf(intent: Intent, v: VisualPlan | null): number {
  if (!v || v.via !== "artifact" || v.offer || v.isAnswer || (v.kind === "diagram" && intent === "plan")) return 0;
  return v.kind === "diagram" ? CAP_PAISE.cheap : CAP_PAISE.code;
}

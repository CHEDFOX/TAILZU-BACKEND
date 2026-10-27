/**
 * PROACTIVE VISUALS: THE CHEAPEST PICTURE THAT EXPLAINS IT, OR NONE.
 *
 * A comparison is easier to read as a table, a flow as a diagram, a trend as a chart, and "how would it look" as the thing itself. So
 * the front door shows one when it explains faster, whether or not the person asked, and it picks the CHEAPEST rung of a ladder that does:
 *
 *   1. a markdown table, inline in the reply            comparisons and specs
 *   2. a mermaid diagram, an artifact                   steps, flows, architecture, a plan or a timeline
 *   3. a chart, an artifact (React with recharts)       numbers over time, shares, trends
 *   4. a project-styled component (componentArtifact)   "how would X look" or a new UI, in a project
 *   5. a page, an artifact                              the same, with no project
 *
 * NONE when: the answer is a short fact; the reply is spoken (the visual is OFFERED instead, one tap); the person turned visuals off;
 * the visual would cost more than the answer it goes with (a chart for a one-line answer is not worth its price, so it falls back to a
 * table, which costs next to nothing, or to nothing); or the person has lately closed the visuals they were given more often than they
 * kept them (a small, bounded nudge, never past 0.6 to 1.4 times the evidence: learn.ts). With visuals "ask" the visual is OFFERED too.
 *
 * What the person ASKED for in so many words ("put it in a table", "draw a diagram") is never skipped for any of those reasons but
 * the person's own "off" for the ones nobody asked for; and a design ("show me how a pricing card would look") is the answer itself.
 *
 * Pure: it reads the message, the intent and the moment, and prices a visual from the tier table it is given.
 */
import type { ModelTier, TierSettings } from "../code/brain/tiers.js";
import { DEFAULT_USD_INR, usdFor, usdToPaise } from "../code/brain/money.js";
import type { FrontCtx, Intent, Length, VisualKind, VisualPlan } from "./types.js";
import { VISUAL_KINDS } from "./types.js";

/** What each rung costs a typical time: the tier it is made on and the tokens in and out. */
export const VISUAL_TOKENS: Readonly<Record<VisualKind, { tier: ModelTier; inTok: number; outTok: number }>> = {
  table: { tier: "cheap", inTok: 0, outTok: 200 },
  diagram: { tier: "cheap", inTok: 600, outTok: 350 },
  chart: { tier: "code", inTok: 1400, outTok: 1100 },
  component: { tier: "code", inTok: 2600, outTok: 1800 },
  page: { tier: "code", inTok: 1000, outTok: 2200 },
};

/** A visual must be at least this sure, after the person's habits are counted, to be made unasked. */
export const VISUAL_BAR = 0.5;
/** The most the habits move the evidence, either way. */
export const HABIT_RANGE: readonly [number, number] = [0.6, 1.4];

const rung = (k: VisualKind): number => VISUAL_KINDS.indexOf(k);

export function estimatePaise(kind: VisualKind, tiers: Record<ModelTier, TierSettings>, fx: number = DEFAULT_USD_INR): number {
  const t = VISUAL_TOKENS[kind];
  return usdToPaise(usdFor(t.inTok, t.outTok, tiers[t.tier]), fx);
}

// ------------------------------------------------------------------ what a message asks for

const word = (re: string): RegExp => new RegExp(re, "i");
const hindi = (words: string[]): RegExp => new RegExp(`(?<![\\p{L}\\p{M}])(?:${words.join("|")})`, "u");

const ASKED_TABLE = word("\\b(?:as|in|into|using)\\s+(?:a\\s+)?(?:markdown\\s+)?table\\b|\\b(?:make|give|show|draw|create|put|build)\\b[^.\\n]{0,25}\\btable\\b|\\btabulate\\b|\\btable\\s+(?:banao|mein|me)\\b");
const ASKED_TABLE_HI = hindi(["तालिका", "टेबल"]);
const ASKED_DIAGRAM = word("\\b(?:make|give|show|draw|create|generate|sketch)\\b[^.\\n]{0,25}\\b(?:diagram|flow\\s?chart|mind\\s?map)\\b|\\b(?:as|in)\\s+a\\s+(?:diagram|flow\\s?chart)\\b|\\b(?:diagram|flowchart)\\s+(?:banao|mein|me)\\b");
const ASKED_DIAGRAM_HI = hindi(["डायग्राम", "फ्लोचार्ट"]);
const ASKED_CHART = word("\\b(?:make|give|show|draw|create|plot|generate)\\b[^.\\n]{0,25}\\b(?:chart|graph|plot)\\b|\\bchart\\s+(?:this|it|the|these|those|my|our|that)\\b|^\\s*chart\\b|\\b(?:as|in)\\s+a\\s+(?:chart|graph)\\b|\\bplot\\b|\\b(?:chart|graph)\\s+(?:banao|mein|me)\\b");
const ASKED_CHART_HI = hindi(["चार्ट", "ग्राफ"]);

const COMPARE = word("\\b(?:compar(?:e|ing|ison)|versus|vs\\.?|difference\\s+between|pros\\s+and\\s+cons|which\\s+is\\s+better|better\\s+than|side\\s+by\\s+side)\\b|\\b(?:tulna|fark|antar|behtar\\s+kaun)\\b");
const COMPARE_HI = hindi(["तुलना", "अंतर", "फर्क", "बनाम"]);
const SPECS = word("\\b(?:specs?|specifications?|features?\\s+of|price\\s+list|pricing\\s+(?:of|for)|plans?\\s+and\\s+pricing|cheat\\s?sheet)\\b");
const FLOW_STRONG = word("\\b(?:flow|flow\\s?chart|architecture|lifecycle|pipeline|workflow|sequence|data\\s+flow|request\\s+flow|call\\s+flow|step[-\\s]by[-\\s]step|stages?|process\\s+of)\\b|\\bkaise\\s+chalta\\b");
const FLOW_HOW = word("\\bhow\\s+(?:does|do|is|are|did)\\b[^.?!\\n]{2,60}\\b(?:work|works|handled|processed|happen|happens|authenticate|authenticates)\\b|\\bkaise\\s+kaam\\s+kar(?:ta|ti|te)\\b");
const FLOW_HI = hindi(["कैसे काम करता", "कैसे काम करती", "फ्लो", "प्रक्रिया"]);
const TIMELINE = word("\\b(?:timeline|roadmap|gantt|schedule|milestones?|itinerary|sprint\\s+plan)\\b");
const TREND = word("\\b(?:trend|growth|over\\s+time|by\\s+(?:month|year|week|quarter|day)|year[-\\s]over[-\\s]year|yoy|share\\s+of|distribution|percentage\\s+of|histogram|bar\\s+chart|pie\\s+chart|line\\s+chart)\\b");
const CHARTY = word("\\b(?:chart|graph|plot|visuali[sz]e)\\b");

const numbersIn = (s: string): number => (s.match(/\d+(?:\.\d+)?/g) ?? []).length;

/** The visual the person asked for in so many words, if any. */
export function askedKind(message: string): VisualKind | null {
  if (ASKED_TABLE.test(message) || ASKED_TABLE_HI.test(message)) return "table";
  if (ASKED_DIAGRAM.test(message) || ASKED_DIAGRAM_HI.test(message)) return "diagram";
  if (ASKED_CHART.test(message) || ASKED_CHART_HI.test(message)) return "chart";
  return null;
}

export interface Need {
  kind: VisualKind;
  /** 0 to 1: how much the words call for it. */
  strength: number;
  why: string;
}

/** What the words of a message call for, cheapest rung first. A design is not in this list: it is the answer, not an addition. */
export function needsOf(message: string, intent: Intent): Need[] {
  const out: Need[] = [];
  if (COMPARE.test(message) || COMPARE_HI.test(message)) out.push({ kind: "table", strength: 0.9, why: "a comparison" });
  else if (SPECS.test(message)) out.push({ kind: "table", strength: 0.7, why: "specs" });
  const nums = numbersIn(message);
  if (intent === "plan" || TIMELINE.test(message)) out.push({ kind: "diagram", strength: 0.85, why: "a plan or a timeline" });
  else if (FLOW_STRONG.test(message) || FLOW_HI.test(message)) out.push({ kind: "diagram", strength: 0.8, why: "a flow" });
  else if (FLOW_HOW.test(message)) out.push({ kind: "diagram", strength: 0.62, why: "how something works" });
  if (CHARTY.test(message) && nums >= 3) out.push({ kind: "chart", strength: 0.85, why: "numbers to chart" });
  else if (TREND.test(message) && nums >= 3) out.push({ kind: "chart", strength: 0.8, why: "numbers over time" });
  else if (TREND.test(message)) out.push({ kind: "chart", strength: 0.5, why: "a trend" });
  return out.sort((a, b) => rung(a.kind) - rung(b.kind));
}

// ------------------------------------------------------------------ the choice

export interface VisualInput {
  message: string;
  intent: Intent;
  length: Length;
  ctx: Pick<FrontCtx, "mode" | "visuals" | "projectId" | "takeOffer">;
  /** The small model's opinion, when it was asked: it can add a rung the words did not show. */
  hint?: VisualKind | "none";
  /** What the answer alone costs, typically, in paise: a visual dearer than this is not worth it. */
  answerPaise: number;
  /** The person's habit with visuals: 0 (they close them) to 1 (they keep them); 0.5 when nothing is known. */
  propensity?: { value: number; why: string };
  tiers: Record<ModelTier, TierSettings>;
  fx?: number;
}

export interface Chosen {
  plan: VisualPlan | null;
  /** Short ids of why, for the decision's reasons. */
  reasons: string[];
}

/** How much the person's habit moves the evidence: 0.6 to 1.4, 1 when nothing is known. */
export function habitFactor(p: number | undefined): number {
  const v = Math.min(1, Math.max(0, p ?? 0.5));
  return HABIT_RANGE[0] + (HABIT_RANGE[1] - HABIT_RANGE[0]) * v;
}

/** What a rung adds to the cost. A plan's diagram is drawn from its steps by code, with no model call: it adds nothing. */
const costOf = (kind: VisualKind, i: VisualInput): number => (kind === "diagram" && i.intent === "plan" ? 0 : estimatePaise(kind, i.tiers, i.fx));

function planOf(kind: VisualKind, o: { offer: boolean; isAnswer: boolean; asked: boolean; why: string; hasProject: boolean }, i: VisualInput): VisualPlan {
  const artifactType = kind === "diagram" ? "mermaid" : kind === "chart" ? "react" : kind === "component" ? (o.hasProject ? "react" : "html") : kind === "page" ? "html" : undefined;
  return {
    kind, via: kind === "table" ? "inline" : "artifact", ...(artifactType ? { artifactType } : {}), offer: o.offer, isAnswer: o.isAnswer, asked: o.asked,
    why: o.why, estPaise: costOf(kind, i),
  };
}

export function chooseVisual(i: VisualInput): Chosen {
  const reasons: string[] = [];
  const hasProject = !!i.ctx.projectId;
  const none = (why: string): Chosen => ({ plan: null, reasons: [...reasons, `visual:skip:${why}`] });

  // A design is the answer itself: something to look at, whatever the person's habits, the mode or the preference.
  if (i.intent === "design") {
    const kind: VisualKind = hasProject ? "component" : "page";
    reasons.push("visual:design");
    return { plan: planOf(kind, { offer: false, isAnswer: true, asked: true, why: hasProject ? "a design, in the project's style" : "a design of a page", hasProject }, i), reasons };
  }

  // The person took an offer ("show this as a table"): made, whatever they prefer.
  if (i.ctx.takeOffer) {
    const kind = i.ctx.takeOffer === "component" && !hasProject ? "page" : i.ctx.takeOffer;
    reasons.push("visual:took_offer");
    return { plan: planOf(kind, { offer: false, isAnswer: false, asked: true, why: "you asked for it", hasProject }, i), reasons };
  }

  // Intents that never carry a picture: small talk, nothing to go on, a job (its result is a pull request).
  if (i.intent === "chat" || i.intent === "unclear" || i.intent === "code_task") return none("intent");

  const asked = askedKind(i.message);
  if (asked) {
    reasons.push(`visual:asked:${asked}`);
    return { plan: planOf(asked, { offer: false, isAnswer: false, asked: true, why: "you asked for it", hasProject }, i), reasons };
  }

  if (i.ctx.visuals === "off") return none("off");

  // What the words call for: the cheapest rung that is sure enough. The small model may add one the words did not show.
  const needs = needsOf(i.message, i.intent);
  if (i.hint && i.hint !== "none" && !needs.some((n) => n.kind === i.hint)) needs.push({ kind: i.hint, strength: 0.6, why: "the small model's view" });
  needs.sort((a, b) => rung(a.kind) - rung(b.kind));
  const factor = habitFactor(i.propensity?.value);
  const sure = needs.filter((n) => n.strength * factor >= VISUAL_BAR);
  if (!needs.length) return none("no_need");
  if (!sure.length) return { plan: null, reasons: [...reasons, "visual:skip:habit", ...(i.propensity ? [`visual:habit:${i.propensity.why}`] : [])] };

  // A short fact does not need a picture.
  if (i.length === "short") return none("short");

  // Not worth more than the answer: step down to a cheaper rung that explains it, or to nothing.
  let pick = sure[0]!;
  const tooDear = (k: VisualKind): boolean => costOf(k, i) > i.answerPaise;
  if (tooDear(pick.kind)) {
    const cheaper = sure.find((n) => rung(n.kind) < rung(pick.kind) && !tooDear(n.kind));
    // A chart's numbers fit a table, too: the table is the fallback of a chart that costs more than the answer.
    const asTable = pick.kind === "chart" && !tooDear("table") ? ({ kind: "table", strength: pick.strength * 0.8, why: `${pick.why}, as a table` } as Need) : null;
    if (cheaper) pick = cheaper;
    else if (asTable && asTable.strength * factor >= VISUAL_BAR) pick = asTable;
    else return none("costs_more_than_the_answer");
    reasons.push("visual:stepped_down");
  }
  if (i.propensity && factor !== 1) reasons.push(`visual:habit:${i.propensity.why}`);

  // Spoken, or the person likes to be asked first: offered, not made.
  const offer = i.ctx.mode === "voice" || i.ctx.visuals === "ask";
  reasons.push(offer ? (i.ctx.mode === "voice" ? "visual:offer:voice" : "visual:offer:ask") : `visual:${pick.kind}`);
  return { plan: planOf(pick.kind, { offer, isAnswer: false, asked: false, why: pick.why, hasProject }, i), reasons };
}

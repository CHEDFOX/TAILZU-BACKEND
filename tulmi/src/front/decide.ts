/**
 * DECIDE: UNDERSTAND A MESSAGE, CHOOSE THE SHAPE OF ITS ANSWER, AND SEND IT DOWN THE CHEAPEST ROAD THAT CAN DO IT.
 *
 *   decide(message, ctx) -> Decision { intent, shape: { length, visual }, route, tier, budgetPaise, confidence, clarify? }
 *
 * RULES FIRST, FOR NOTHING (rules.ts): the Code bot's free classifier for the code signals, plus the project, the attachments, the earlier turns
 * and the wording of a design, a plan, a piece of research or small talk. When the rules are sure (0.7 or more, after the person's own
 * history has been allowed to cut their confidence: learn.ts) that is the answer, and no model was asked. Below 0.7 the SMALL model is
 * asked once (role front_decide, the tiny tier, a few hundred tokens): it wins on the intent, the length and the clarifying question, and
 * its view of the visual is one more piece of evidence. A model that cannot be reached, or is over its budget, costs nothing but the
 * rules' own, less certain answer: decide never throws for that.
 *
 * THE SHAPE of the answer (visual.ts): how long, and which visual explains it fastest, if any, the cheapest rung of the ladder.
 *
 * THE ROAD (path.ts): the route, the tier and the budget in paise that follow from the intent.
 *
 * CLARIFY, only when the front door is under 0.45 sure AND the road is costly (a budget of 200 paise or more: a code task, a design, a
 * long piece of research): one question, two or three options, in the person's language. A cheap answer is never asked about: it is
 * answered. A question the model wrote is used when it is well-formed; otherwise a fixed one in words.ts.
 *
 * Nothing about the message is kept or logged: `reasons` are short ids.
 */
import { z } from "zod";
import { DEFAULT_USD_INR } from "../code/brain/money.js";
import { tierTable, type ModelTier, type TierSettings } from "../code/brain/tiers.js";
import { getConfig } from "../config.js";
import type { SpendMeter } from "../artifacts/limits.js";
import { askJson, forModel, type CallFn, type ModelCtx } from "../code/work/model.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import type { Learning } from "./learn.js";
import { answerPaise, budgetOf, COSTLY_PAISE, routeOf, tierOf } from "./path.js";
import { readByRules, type RuleRead } from "./rules.js";
import { chooseVisual } from "./visual.js";
import { clarifyFor, langOf, type ClarifyKind } from "./words.js";
import { deepCodeQuestion } from "../code/chat/question.js";
import { INTENTS, LENGTHS, VISUAL_KINDS, type Clarify, type Decision, type FrontCtx, type Intent, type Length, type Via, type VisualKind } from "./types.js";

/** The rules are trusted alone at or above this. */
export const RULES_SURE = 0.7;
/** Under this, and with a costly road, the front door asks before it goes. */
export const CLARIFY_BELOW = 0.45;
/** The most one small-model read of a message may cost, in paise. */
export const DECIDE_CAP_PAISE = 100;
const MESSAGE_MAX = 8_000;
const MODEL_HEAD = 1_000;
const MODEL_TAIL = 400;

export interface DecideDeps {
  /** callModel, or a stand-in. */
  call?: CallFn;
  gateway?: GatewayDeps;
  learning?: Pick<Learning, "habit" | "trust">;
  tiers?: Record<ModelTier, TierSettings>;
  fx?: number;
  /** CODE_JOB_DEFAULT_BUDGET_PAISE, instead of the config's. */
  jobBudgetPaise?: number;
  /** Instead of RULES_SURE. */
  threshold?: number;
  /** The person's day: the small model is not asked once it is spent, and what it cost is added. */
  daily?: Pick<SpendMeter, "leftPaise" | "add">;
  signal?: AbortSignal;
}

/** What the small model is held to. Strict: a field it was not asked for is a bad answer, and gets one repair. */
export const DecideReply = z.object({
  intent: z.enum(INTENTS),
  length: z.enum(LENGTHS),
  visual: z.enum(["none", ...VISUAL_KINDS]),
  confidence: z.number().min(0).max(1),
  clarify: z.object({ question: z.string().min(3).max(240), options: z.array(z.string().min(1).max(80)).min(2).max(3) }).strict().nullable(),
}).strict();
export type DecideReply = z.infer<typeof DecideReply>;

// ------------------------------------------------------------------ how long

const LONG = /\b(?:in\s+detail|detailed|elaborate|step[-\s]by[-\s]step|in\s+depth|thoroughly|full\s+(?:explanation|guide)|essay|comprehensive|vistar\s+se|poori\s+jaankari)\b|विस्तार/i;
const SHORT_OPENER = /^\s*(?:what(?:'s|\s+is|\s+are|\s+was)|who|when|where|which|how\s+(?:many|much|old|far|long|tall|big)|capital|convert|translate|define|meaning\s+of|kitna|kitne|kab|kaun|kahan|क्या\s+है|कौन|कब|कहाँ)\b/i;
const NOT_SHORT = /\b(?:explain|why|how\s+(?:does|do|to|can|should)|compare|difference|steps?|process|pros|cons)\b/i;

export function lengthOf(text: string, intent: Intent, mode: FrontCtx["mode"]): Length {
  const asked = LONG.test(text);
  let length: Length;
  switch (intent) {
    case "chat": case "unclear": case "design": case "code_task": length = "short"; break;
    case "research": length = "long"; break;
    case "plan": case "code_question": case "file_question": length = "medium"; break;
    case "answer": {
      const n = text.trim().split(/\s+/).filter(Boolean).length;
      length = (n <= 10 && SHORT_OPENER.test(text) && !NOT_SHORT.test(text)) || /\d+\s*(?:%|\+|\*|\/)\s*\d+|\b\d+\s*%\s*of\b/.test(text) ? "short" : "medium";
      break;
    }
  }
  if (asked) return "long";
  return mode === "voice" ? spoken(length, false) : length;
}

/** Spoken, a reply is brief: it is read out, and a visual is offered for the rest. Unless they asked for detail. */
export function spoken(length: Length, detail: boolean): Length {
  if (detail) return length;
  return length === "long" ? "medium" : length === "medium" ? "short" : length;
}

// ------------------------------------------------------------------ the small model

const cut = (s: string, head: number, tail: number): string => (s.length > head + tail ? `${s.slice(0, head)}\n[…]\n${s.slice(-tail)}` : s);
const oneLine = (s: string, n: number): string => s.replace(/\s+/g, " ").trim().slice(0, n);

/** What the small model is sent: the message fenced as data, and what the rules saw. */
export function decideMessage(text: string, ctx: FrontCtx, rules: Pick<RuleRead, "intent" | "confidence">): string {
  const kinds = [...new Set(ctx.attachments.map((a) => a.kind))];
  const body = forModel(cut(text, MODEL_HEAD, MODEL_TAIL)).replace(/>>>/g, "> > >");
  return [
    `Message:\n<<<\n${body}\n>>>`,
    `Project: ${ctx.projectId ? "yes" : "no"}.`,
    `Device: ${ctx.device}. Mode: ${ctx.mode}.`,
    ...(kinds.length ? [`Attachments: ${kinds.join(", ")}.`] : []),
    ...(ctx.recent.length ? [`Recent:\n${ctx.recent.slice(-3).map((t) => `- "${oneLine(forModel(t.said), 120)}"${t.did ? ` -> ${oneLine(t.did, 40)}` : ""}`).join("\n")}`] : []),
    `The rules read it as: ${rules.intent} (${rules.confidence}).`,
  ].join("\n");
}

async function askModel(text: string, ctx: FrontCtx, rules: RuleRead, confidence: number, d: DecideDeps): Promise<{ read: DecideReply } | { skipped: string }> {
  const left = d.daily ? d.daily.leftPaise(ctx.userId) : Infinity;
  if (left <= 0) return { skipped: "daily" };
  const model: ModelCtx = {
    ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId: ctx.userId,
    budget: { maxPaise: Math.min(DECIDE_CAP_PAISE, left) }, ...(d.signal ? { signal: d.signal } : {}),
  };
  const r = await askJson(model, {
    tier: "tiny", purpose: "front.decide", role: "front_decide", user: decideMessage(text, ctx, { intent: rules.intent, confidence }), schema: DecideReply, maxTokens: 260,
  });
  if (!r.ok) return { skipped: r.reason };
  d.daily?.add(ctx.userId, r.paise);
  // The gateway checks the shape, and so does this: a stand-in, or a gateway that changes, must not be able to put a stranger's words in a Decision.
  const checked = DecideReply.safeParse(r.value);
  return checked.success ? { read: checked.data } : { skipped: "invalid" };
}

/** A clarifying question the model wrote, if it is fit to show: one line, two or three short options. */
export function usableClarify(c: DecideReply["clarify"] | undefined): Clarify | null {
  if (!c) return null;
  const q = c.question.replace(/\s+/g, " ").trim();
  const options = c.options.map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (q.length < 3 || q.length > 240 || options.length < 2 || options.length > 3 || new Set(options.map((o) => o.toLowerCase())).size !== options.length) return null;
  return { question: q, options };
}

const clarifyKind = (intent: Intent): ClarifyKind => (intent === "code_task" ? "code" : intent === "design" ? "design" : intent === "research" ? "research" : "general");

// ------------------------------------------------------------------ decide

export async function decide(message: string, ctx: FrontCtx, deps: DecideDeps = {}): Promise<Decision> {
  const text = message.trim().slice(0, MESSAGE_MAX);
  const tiers = deps.tiers ?? tierTable();
  let fx = deps.fx;
  let jobBudget = deps.jobBudgetPaise;
  if (fx === undefined || jobBudget === undefined) {
    try { const c = getConfig(); fx ??= c.CODE_USD_INR ?? DEFAULT_USD_INR; jobBudget ??= c.CODE_JOB_DEFAULT_BUDGET_PAISE; } catch { fx ??= DEFAULT_USD_INR; jobBudget ??= 3000; }
  }
  const hasProject = !!ctx.projectId;
  const hasImage = ctx.attachments.some((a) => a.kind === "image");

  // 1. The rules, and how far this person's history lets them be trusted.
  const rules = readByRules(text, ctx);
  const reasons = [...rules.signals];
  let confidence = rules.confidence;
  const trust = await deps.learning?.trust(ctx.userId, rules.intent).catch(() => undefined);
  if (trust && trust.factor < 1) {
    confidence = Math.round(confidence * trust.factor * 100) / 100;
    reasons.push(`trust:${trust.why}`);
  }

  // 2. The small model, only when they are not sure.
  let via: Via = "rules";
  let intent = rules.intent;
  let length: Length | undefined;
  let hint: VisualKind | "none" | undefined;
  let modelClarify: Clarify | null = null;
  if (confidence < (deps.threshold ?? RULES_SURE) && text) {
    const got = await askModel(text, ctx, rules, confidence, deps);
    if ("read" in got) {
      via = "model";
      intent = got.read.intent;
      confidence = Math.round(got.read.confidence * 100) / 100;
      length = got.read.length;
      hint = got.read.visual;
      modelClarify = usableClarify(got.read.clarify);
      reasons.push("model:tiny");
    } else {
      reasons.push(`model:skipped:${got.skipped}`);
    }
  }

  // 3. What cannot be: no project, nothing to change or ask about; nothing attached, nothing to ask about it; something attached, it is about that.
  if (!hasProject && (intent === "code_question" || intent === "code_task")) { intent = "answer"; reasons.push("no_project"); }
  if (ctx.attachments.length) intent = "file_question";
  else if (intent === "file_question") intent = "answer";

  // 4. The road, the shape and the money.
  const depth = intent === "research" ? rules.depth ?? "standard" : undefined;
  const route = routeOf(intent);
  // A deep why (a slow page, a leak, a race) or what a change reaches is where a cheap model is most often confidently wrong: the strong tier, and the reason is written down.
  const deep = intent === "code_question" && deepCodeQuestion(text);
  if (deep) reasons.push("code:deep");
  const tier = tierOf(intent, { hasImage, hasProject, ...(depth ? { depth } : {}), ...(deep ? { deep } : {}), cls: rules.cls });
  // How long the answer is when written; spoken, it is brief (below), but a visual is judged on the written length: a spoken comparison still has a table to offer.
  const written = length ?? lengthOf(text, intent, "text");
  length = ctx.mode === "voice" ? spoken(written, LONG.test(text)) : written;
  const habit = await deps.learning?.habit(ctx.userId).catch(() => undefined);
  const chosen = chooseVisual({
    message: text, intent, length: written, ctx, ...(hint ? { hint } : {}), answerPaise: answerPaise(route, tier, length, depth, tiers, fx), ...(habit ? { propensity: habit } : {}), tiers, fx,
  });
  reasons.push(...chosen.reasons);
  let visual = chosen.plan;
  // A table is part of a reply the reply role writes. A research answer, a code answer and a plan are written by their own roles, with their own shape.
  if (visual && visual.via === "inline" && route !== "reply" && route !== "file") { reasons.push(`visual:skip:no_table_on_${route}`); visual = null; }
  const budgetPaise = budgetOf({
    intent, route, tier, length, ...(depth ? { depth } : {}), visual, hasProject, images: ctx.attachments.filter((a) => a.kind === "image").length,
    difficulty: rules.cls.difficulty, jobBudgetPaise: jobBudget, tiers, fx,
  });

  // 5. Unsure and costly: ask, once, instead of guessing.
  let clarify: Clarify | undefined;
  if (confidence < CLARIFY_BELOW && budgetPaise >= COSTLY_PAISE) {
    clarify = modelClarify ?? clarifyFor(clarifyKind(intent), langOf(rules.cls.language));
    reasons.push("clarify");
  }

  return {
    intent, shape: { length, visual }, route, tier, budgetPaise, confidence, ...(clarify ? { clarify } : {}), via, ...(depth ? { depth } : {}),
    language: rules.cls.language, ...(rules.followUp ? { followUp: rules.followUp.base } : {}),
    ...(rules.handoff && intent === "code_task" ? { handoff: true } : {}), ...(rules.openEnded && intent === "code_task" ? { mode: "freeform" as const } : {}),
    reasons: [...new Set(reasons)],
  };
}

/**
 * THE PIPELINE'S EYE: AFTER A BOT HAS ANSWERED, WHAT (IF ANYTHING) TO DRAW UNDER ITS WORDS.
 *
 *   worthDrawing(answer, o)   free: whether to ask at all (a "hi" or a "Done." is never drawn)
 *   designUser(input)         what the model reads: the ask, the answer and the links the turn saw, each fenced as data
 *   drawFor(ctx, input)       one small call (role bot_show, the tiny tier), held to the request's cap, its blocks checked
 *
 * A bot writes words; this decides, answer by answer, whether a picture of them helps more: a selector when the answer asks the
 * person to pick, the one warning they must not miss, the steps of a plan, a table or a chart of the numbers, a few next questions
 * to tap, a small form when it needs several details, or a drawing of a shape. Nobody lists those cases in code: the role is told
 * what the building blocks are (show/types.ts) and draws from them, and most answers get nothing.
 *
 * It runs after the words are whole, beside the bot's memory (bots/run.ts), so it adds no wait before the words, only before the
 * drawing. It never fails an answer: a model that is down, over budget or wrong is no drawing, and the words stand as they were.
 */
import { z } from "zod";
import { getConfig } from "../config.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { askJson, type CallFn } from "../code/work/model.js";
import { neutral } from "../bots/prompt.js";
import { checkShown } from "./check.js";
import type { Seen } from "./links.js";
import type { Shown } from "./types.js";

/** What the model answers. Loose on purpose: check.ts reads every block, and one bad block must not lose the others. */
export const ShowReply = z.object({ blocks: z.array(z.unknown()), lists: z.unknown().optional() });

/** The most one drawing may cost, in paise (the bot's memory note has the same). */
export const SHOW_CAP_PAISE = 40;
/** Below this left on the request, no drawing is asked for. */
const SHOW_MIN_PAISE = 4;
const SHOW_TOKENS = 600;
/** What of the answer the model reads: its head is where a question, a list or a warning is. */
const ANSWER_CHARS = 2_400;
const ASKED_CHARS = 600;
const LINKS_SHOWN = 8;

/** Whether drawing is on (BOT_SHOW, config.ts). On when the settings cannot be read. */
export function showOn(): boolean {
  try {
    return getConfig().BOT_SHOW !== false;
  } catch {
    return true;
  }
}

const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+\S/gm;
const NUMBER = /\d[\d,.]*/g;

/**
 * Whether an answer could be helped by a drawing, from its own words, for nothing: a question back, a list, a run of numbers, a long
 * answer, or links the turn found. A short line with none of those (a greeting, "Done, it's on your calendar.") is not asked about.
 */
export function worthDrawing(answer: string, o: { links: number }): boolean {
  const t = answer.trim();
  if (!t) return false;
  if (o.links > 0) return true;
  if (t.includes("?")) return true;
  if ((t.match(LIST_LINE) ?? []).length >= 2) return true;
  if ((t.match(NUMBER) ?? []).length >= 3) return true;
  return t.length >= 280;
}

export interface DesignInput {
  /** The person's words. */
  asked: string;
  /** The bot's answer, as it will be shown. */
  answer: string;
  /** The addresses this turn saw: the only ones a block may use. */
  seen: Seen;
}

const fence = (name: string, body: string): string => `${name}:\n<<<\n${neutral(body)}\n>>>`;
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The model's message: the ask, the answer and the links, each fenced. */
export function designUser(i: DesignInput): string {
  const links = i.seen.list(LINKS_SHOWN);
  return [
    fence("Asked", cut(i.asked.trim(), ASKED_CHARS)),
    fence("Answer", cut(i.answer.trim(), ANSWER_CHARS)),
    ...(links.length ? [fence("Links", links.map((u) => `- ${u}`).join("\n"))] : []),
  ].join("\n");
}

export interface DesignCtx {
  /** The model door, already held to the request's cap (bots/meter.ts): what the call costs comes off it. */
  call?: CallFn;
  gateway?: GatewayDeps;
  userId: string;
  /** What the request has left, in paise. */
  leftPaise: number;
  signal?: AbortSignal;
}

/** What to draw under `answer`, or null: nothing worth it, no money left for it, or a model that drew nothing usable. */
export async function drawFor(ctx: DesignCtx, i: DesignInput): Promise<Shown | null> {
  if (ctx.signal?.aborted || !worthDrawing(i.answer, { links: i.seen.list(1).length })) return null;
  if (ctx.leftPaise < SHOW_MIN_PAISE) return null;
  const r = await askJson({
    ...(ctx.call ? { call: ctx.call } : {}), ...(ctx.gateway ? { gateway: ctx.gateway } : {}), userId: ctx.userId,
    budget: { maxPaise: Math.min(SHOW_CAP_PAISE, ctx.leftPaise) }, ...(ctx.signal ? { signal: ctx.signal } : {}),
  }, { tier: "tiny", purpose: "bot.show", role: "bot_show", user: designUser(i), schema: ShowReply, maxTokens: SHOW_TOKENS });
  return r.ok ? checkShown(r.value, { seen: i.seen }) : null;
}

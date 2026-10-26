/**
 * WHAT A MODEL CALL COSTS, IN PAISE, BEFORE IT AND AFTER IT.
 *
 * A job's budget (budget_paise) and spend (spent_paise) are whole paise.
 * OpenRouter charges in US dollars. Between the two is one number, CODE_USD_INR
 * (88 rupees to the dollar unless set), and one rule: a cost is rounded UP to
 * the next paise. A call that cost a hundredth of a paise is not free, and
 * rounding down would let a job make a million of them for nothing; the price
 * of rounding up is that a job's spend can read a few paise high, never low.
 *
 * BEFORE a call there is only an estimate, and it is the worst case: every
 * character of what is sent costs input tokens at about 3.5 characters a
 * token, and the model is assumed to write all of maxTokens (thinking
 * included). A picture counts as a flat 1,200 tokens whatever its size, since
 * it is sent as a data URL whose characters say nothing about its cost.
 * AFTER a call the cost is whatever OpenRouter says it charged (usage.cost),
 * and only when it says nothing is it estimated from the tokens it reports
 * and the tier's prices, and failing even that, from the characters written.
 *
 * Nothing here reads a clock, the network or a store.
 */
import type { ChatMessage, ToolDef } from "./types.js";

export const CHARS_PER_TOKEN = 3.5;
/** What one picture is counted as, in tokens. */
export const IMAGE_TOKENS = 1_200;
/** The rate used where no config is at hand (routeStep's pure tests): the Tailzu default. */
export const DEFAULT_USD_INR = 88;

export interface Prices {
  usdPerMIn: number;
  usdPerMOut: number;
}

export const tokensOfChars = (chars: number): number => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

/** The characters a request sends, as the estimate counts them. A picture is counted by IMAGE_TOKENS, not by its bytes. */
export function charsOf(messages: readonly ChatMessage[], tools?: readonly ToolDef[]): number {
  let n = 0;
  for (const m of messages) {
    const c = m.content;
    if (typeof c === "string") n += c.length;
    else if (Array.isArray(c)) {
      for (const part of c) n += part.type === "text" ? part.text.length : Math.ceil(IMAGE_TOKENS * CHARS_PER_TOKEN);
    }
    if (m.role === "assistant" && m.tool_calls) for (const t of m.tool_calls) n += t.name.length + t.arguments.length;
  }
  if (tools?.length) n += JSON.stringify(tools).length;
  return n;
}

/** US dollars for a number of tokens in and out at a tier's prices. */
export function usdFor(inTokens: number, outTokens: number, p: Prices): number {
  return (Math.max(0, inTokens) * p.usdPerMIn + Math.max(0, outTokens) * p.usdPerMOut) / 1_000_000;
}

/** Dollars to whole paise, rounded up. The 6-decimal trim keeps 0.01 dollars at 88 rupees at exactly 88 paise, not 89 by floating-point dust. */
export function usdToPaise(usd: number, fx: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(Number((usd * fx * 100).toFixed(6)));
}

/** The most one call could cost, in paise: all of the input, and all of maxTokens written. */
export function worstCasePaise(o: { chars: number; maxTokens: number } & Prices, fx: number): number {
  return usdToPaise(usdFor(tokensOfChars(o.chars), o.maxTokens, o), fx);
}

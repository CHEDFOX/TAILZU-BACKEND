/**
 * One call to the writing model, and the temperatures and token budgets each kind of writing gets.
 */

import type { ChatCompletion } from "openai/resources/chat/completions";
import { reasoningFor } from "../../agent/llm.js";
import {
  EFFORTS, allowedEffort, type Effort, maxTokensWithReasoning, isReasoningRequiredError, reasoningRequired, learnReasoningRequired,
} from "../../agent/reasoning.js";
import { addCostUsd, openRouterUsd } from "../../usage/cost.js";
import { openrouter } from "../openrouter.js";

/**
 * Reasoning effort for every LLM call.
 *
 * CLEANUP_MODEL defaults to a reasoning model, and those REASON before they
 * answer. Nothing here passed a reasoning parameter, so every refine ran at the
 * provider's default effort — spending tokens deliberating before emitting a
 * single word of output. That is the latency, and it buys nothing: rewriting a
 * sentence someone just said is not a problem that needs thinking through.
 *
 * "none" for that reason. Raise it (minimal / low / medium / high) from the env
 * if a harder task ever justifies the wait; the eval harness is the place to
 * settle whether it does.
 */
const REASONING_EFFORT = process.env.LLM_REASONING_EFFORT?.trim() || "none";

/**
 * The reasoning every completion is sent, for the model it goes to. LLM_REASONING_EFFORT "none" means as little as the model allows (reasoningFor,
 * agent/llm.ts): off where it can be turned off, and the model's lowest effort where it cannot. This used to send `{ effort: "none" }` to every model, which
 * a model that requires reasoning answers with a 400 before a word, so the writer path (assist, replies, edits) failed on exactly the models a ladder is
 * made of. "default" sends nothing and the provider decides.
 */
function reasoningOf(model: string): Record<string, unknown> | undefined {
  if (REASONING_EFFORT === "default") return undefined;
  if (REASONING_EFFORT === "none") return { ...reasoningFor(model) };
  return { effort: (EFFORTS as readonly string[]).includes(REASONING_EFFORT) ? allowedEffort(model, REASONING_EFFORT as Effort) : REASONING_EFFORT };
}

/**
 * Every completion here goes through this. Centralised because there are eleven call sites and a latency fix applied to ten of them is not a latency fix.
 *
 * It adds the reasoning for the model, and the room for it: a model that must think spends its thinking out of `max_tokens`, so a 512-token cap that fits a
 * paragraph of answer is gone before the first word (a "length" stop with no content, which every caller here would read as a failed refine). The cap is
 * raised by an allowance for the effort sent (reasoning.ts), and an answer that still comes back empty for length is asked for once more with a larger one.
 * A model not known to need reasoning that answers the 400 for "none" is asked again at once at its lowest effort, and remembered.
 */
export async function complete(body: Record<string, unknown> & { model: string; max_tokens: number }): Promise<ChatCompletion> {
  const send = async (bigger: boolean): Promise<ChatCompletion> => {
    const reasoning = reasoningOf(body.model);
    const res = (await openrouter().chat.completions.create({
      ...body,
      ...(reasoning ? { reasoning } : {}),
      max_tokens: maxTokensWithReasoning(body.max_tokens, reasoning, { retry: bigger }),
      // OpenRouter's usage accounting: what it charged, in dollars, comes back with the answer, for the usage meter (usage/cost.ts).
      usage: { include: true },
    } as never)) as ChatCompletion;
    addCostUsd(openRouterUsd(res, { where: "keybot", model: body.model }));
    return res;
  };
  let res: ChatCompletion;
  try {
    res = await send(false);
  } catch (err) {
    if (!isReasoningRequiredError(err) || reasoningRequired(body.model)) throw err;
    learnReasoningRequired(body.model);
    res = await send(false);
  }
  const choice = res.choices?.[0];
  if (choice?.finish_reason === "length" && !choice.message?.content?.trim()) res = await send(true);
  return res;
}

/**
 * Temperature for the writing pass. Faithfulness is the whole job here, and
 * sampling is the opposite of faithful.
 *
 * WHY THIS MOVED FROM 0.2 TO 0. Run the same 79 cases three times against an
 * unchanged server and the answers differ: "mujhe kal subah jaldi uthna hai"
 * came back in Devanagari once in three, with the script stated as a measured
 * fact and transliteration forbidden in the prompt. That is not the prompt
 * losing an argument, it is the sampler picking a less likely token, and no
 * amount of instruction fixes a coin.
 *
 * It is also what made every comparison hard to read: several cases have now
 * printed REGRESSED on a run where nothing changed. A rewrite of a sentence
 * someone just said has one good answer, not a distribution over several.
 *
 * Env-settable so this is a decision that can be measured rather than argued
 * about — CLEANUP_TEMPERATURE=0.2 restores the old behaviour, and the quality
 * harness is the place to settle whether variety was ever worth anything.
 */
export const TEMPERATURE = Number(process.env.CLEANUP_TEMPERATURE ?? 0);
// Drafting a reply from someone else's message is a genuinely open task —
// there are many good replies — so it keeps its latitude.
export const REPLY_TEMPERATURE = Number(process.env.REPLY_TEMPERATURE ?? 0.4);

// Output ceilings. Set explicitly so OpenRouter's per-request credit
// reservation matches what we actually produce (~200 tokens for cleanup,
// ~500 for a reply). Without this, OpenRouter reserves the model's full
// context ceiling (64k+ tokens) upfront and rejects small-balance accounts
// even though the real cost is a fraction of a cent.
//
// Real outputs are almost always shorter than the input — cleanup collapses
// filler, reply drafts hit medium length. These caps leave generous headroom.
export const MAX_TOKENS_CLEANUP = 1024;   // ≈ 750 words of cleaned text
export const MAX_TOKENS_REPLY = 2048;     // ≈ 1500 words — email-length drafts
export const MAX_TOKENS_STYLE = 512;      // small JSON blob
// A screen answer is a sentence or a few by default (the prompt says so), but
// "explain this in detail" has to have room to obey — so this sits well above
// the spoken cap without reaching the email-length ceiling a reply gets.
export const MAX_TOKENS_ANSWER = 512;     // ≈ a paragraph, with headroom for "expand"

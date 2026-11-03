/**
 * THE SPOKEN ANSWER'S ONE MODEL CALL: THE ROLE talk_reply, ON THE ROAD'S TIER, STREAMED.
 *
 *   sayAnswer({ user, tier, reasoning, maxTokens, capPaise, onText, onReset, … }) -> { text, paise, model }
 *
 * Nothing but callModel (code/brain/gateway.ts): the tier's ladder, one transient retry, the breakers. Its words come as they are written
 * (onText); a model on the ladder that fails after writing says so (onReset) before the next is asked. What to do then is the caller's
 * (talk/index.ts): before anything was said, let the next one speak; after, stop and say sorry. Errors are thrown as callModel throws them.
 */
import { callModel, type GatewayDeps } from "../code/brain/gateway.js";
import type { ModelTier, Reasoning } from "../code/brain/tiers.js";
import type { CallFn } from "../code/work/model.js";
import { compose } from "../principles/index.js";

export interface AnswerAsk {
  user: string;
  tier: ModelTier;
  reasoning: Reasoning;
  maxTokens: number;
  capPaise: number;
  userId: string;
  call?: CallFn;
  gateway?: GatewayDeps;
  signal?: AbortSignal;
  onText: (piece: string) => void;
  onReset: () => void;
}

export async function sayAnswer(a: AnswerAsk): Promise<{ text: string; paise: number; model: string }> {
  const call: CallFn = a.call ?? (callModel as CallFn);
  const r = await call({
    tier: a.tier, messages: compose("talk_reply", [{ role: "user" as const, content: a.user }]),
    maxTokens: a.maxTokens, reasoning: a.reasoning, purpose: "talk.reply", userId: a.userId, budget: { maxPaise: a.capPaise },
    ...(a.signal ? { signal: a.signal } : {}), onText: a.onText, onReset: a.onReset,
  }, a.gateway);
  return { text: r.text, paise: r.paise, model: r.model };
}

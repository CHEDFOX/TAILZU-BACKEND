/**
 * THE ONE WAY THE FRONT DOOR ASKS A MODEL FOR PROSE: A ROLE, A TIER, A CAP.
 *
 * The JSON roles (front_decide, front_plan) go through askJson (code/work/model.ts), like every other JSON question the Code bot asks. The
 * roles whose answer is plain text (front_reply, front_code_answer, front_look) come through here, and it is nothing but callModel:
 * the model is told what compose(role) says (the principles, who it is, the output contract), and what it is sent is the dynamic
 * context, after it. A call the person's money or the request's cap cannot cover is refused by the gateway before it is made;
 * this turns that, and a ladder that is all down, into FrontError with words a person can read.
 *
 * Nothing that was sent or received is logged here. Every dependency is injectable, so the tests drive it with a fake.
 */
import { BudgetExceeded, callModel, type Budget, type GatewayDeps } from "../code/brain/gateway.js";
import type { ModelTier } from "../code/brain/tiers.js";
import type { UserContent } from "../code/brain/types.js";
import type { CallFn } from "../code/work/model.js";
import { compose, type RoleId } from "../principles/index.js";
import { FrontError } from "./types.js";

/** Whose money and which door: what every front-door model call shares. */
export interface FrontModel {
  call?: CallFn;
  gateway?: GatewayDeps;
  userId: string;
  signal?: AbortSignal;
}

export interface TextAsk {
  role: RoleId;
  tier: ModelTier;
  /** A word for the log, never any content: "front.reply". */
  purpose: string;
  /** What changes from call to call: after the role's block. */
  user: UserContent;
  maxTokens: number;
  /** The most this call may cost in the worst case, in paise. */
  budget: Budget;
  /** The words as they are written (the gateway streams), and word that the ones so far are void. */
  onText?: (piece: string) => void;
  onReset?: () => void;
}

export interface Text {
  text: string;
  paise: number;
  model: string;
}

export async function askText(m: FrontModel, a: TextAsk): Promise<Text> {
  const call: CallFn = m.call ?? (callModel as CallFn);
  try {
    const r = await call({
      tier: a.tier, messages: compose(a.role, [{ role: "user" as const, content: a.user }]), maxTokens: a.maxTokens, purpose: a.purpose, userId: m.userId,
      budget: a.budget, ...(m.signal ? { signal: m.signal } : {}), ...(a.onText ? { onText: a.onText } : {}), ...(a.onReset ? { onReset: a.onReset } : {}),
    }, m.gateway);
    return { text: r.text.trim(), paise: r.paise, model: r.model };
  } catch (err) {
    if (err instanceof BudgetExceeded || (err as { code?: unknown } | null)?.code === "budget_exceeded") {
      throw new FrontError("budget", "That would cost more than one message may. Ask for less, or break it into parts.", 402);
    }
    if ((err as { name?: unknown } | null)?.name === "AbortError") throw err;
    throw new FrontError("model_down", "No model could be reached just now. Nothing was changed; try again in a moment.", 503);
  }
}

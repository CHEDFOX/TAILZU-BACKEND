/**
 * WHICH ROAD AND WHICH TIER FOR A TURN OF TALK (front/path.ts's way): one cheapest road per kind, a tier that fits it.
 *
 *   kind      road      tier     reasoning  first mood  writes at most
 *   chat      reply     cheap    none       -           220 tokens    small talk, a joke, a small question (the tiny tier is slower to speak)
 *   answer    reply     cheap    none       -           450           a question; read-only lookups first when it needs fresh facts
 *   think     reply     strong   medium     ponder      4000          maths, a deep why or how, a comparison, a plan, code
 *   task      handoff   agent                                         Ask does it on the screen (the desktop hands it over)
 *   send      handoff   agent
 *   write     handoff   write                                         typed into the text box in front
 *   routine   handoff   routine
 *   notes     handoff   notes
 *   bot       handoff   bot
 *
 * CLIMBING (code/brain/route.ts). A decision under SURE starts one tier up; a reply whose model fails before any word was said is asked
 * once more one tier up. Never past strong.
 *
 * THE CAP of a reply is its worst case at its tier (money.ts): the most a turn's message can hold (TALK_INPUT_CHARS), and the most it may
 * write. The person's day (guard/ daily) is checked before it; the gateway refuses a call that would pass the cap.
 *
 * Pure: the tier table and the rate are passed in.
 */
import type { AskDecision, AskRisk } from "../askDecide/index.js";
import { DEFAULT_USD_INR, worstCasePaise } from "../code/brain/money.js";
import { CLIMB_LADDER } from "../code/brain/route.js";
import type { ModelTier, Reasoning, TierSettings } from "../code/brain/tiers.js";

export const TALK_KINDS = ["chat", "answer", "think", "task", "send", "write", "routine", "notes", "bot"] as const;
export type TalkKind = (typeof TALK_KINDS)[number];
export type HandoffTo = "agent" | "write" | "routine" | "notes" | "bot";

export type Road =
  | { road: "reply"; tier: ModelTier; reasoning: Reasoning; ponder: boolean; look: boolean; maxTokens: number }
  | { road: "handoff"; to: HandoffTo };

export const ROADS: Readonly<Record<TalkKind, Road>> = {
  chat: { road: "reply", tier: "cheap", reasoning: "none", ponder: false, look: false, maxTokens: 220 },
  answer: { road: "reply", tier: "cheap", reasoning: "none", ponder: false, look: false, maxTokens: 450 },
  think: { road: "reply", tier: "strong", reasoning: "medium", ponder: true, look: false, maxTokens: 4_000 },
  task: { road: "handoff", to: "agent" },
  send: { road: "handoff", to: "agent" },
  write: { road: "handoff", to: "write" },
  routine: { road: "handoff", to: "routine" },
  notes: { road: "handoff", to: "notes" },
  bot: { road: "handoff", to: "bot" },
};

/** Under this the decision is not sure enough for its tier: one up. */
export const TALK_SURE = 0.7;
/** The most a turn's message to the answering model holds, in characters: the sum of its sections' caps (prompt.ts). */
export const TALK_INPUT_CHARS = 20_000;

/** The kind of a turn, from the one key's brain: an answer is chat or think by its reads. */
export function kindOf(d: Pick<AskDecision, "do" | "chat" | "depth">): TalkKind {
  if (d.do !== "answer") return d.do;
  if (d.depth === "think") return "think";
  return d.chat ? "chat" : "answer";
}

/** The next tier up the ladder, or null at the top (or off it). */
export function climb(tier: ModelTier): ModelTier | null {
  const i = CLIMB_LADDER.indexOf(tier);
  return i >= 0 && i < CLIMB_LADDER.length - 1 ? CLIMB_LADDER[i + 1]! : null;
}

/** The road of a kind for this turn: lookups when the answer needs fresh facts, one tier up when the decision was unsure. */
export function roadOf(kind: TalkKind, o: { web?: boolean; sure?: number } = {}): Road {
  const r = ROADS[kind];
  if (r.road === "handoff") return r;
  const unsure = o.sure !== undefined && o.sure < TALK_SURE;
  return { ...r, tier: unsure ? climb(r.tier) ?? r.tier : r.tier, look: kind !== "chat" && !!o.web };
}

/** Whether a handoff needs no "are you sure?" on the device: the person already said to do it, and nothing in it moves money or deletes. */
export const trustedOf = (risk: AskRisk): boolean => risk === "none" || risk === "send";

/** Room for the thinking of a model that cannot think "none": the gateway gives it this much on top (agent/reasoning.ts, at most low's, retried). */
export const THINKING_ROOM = 4_096;

/** The worst case of a reply at this tier, in paise. A road that asks for no thinking keeps THINKING_ROOM for a model that thinks anyway. */
export function capPaise(tier: ModelTier, maxTokens: number, o: { tiers: Record<ModelTier, TierSettings>; reasoning?: Reasoning; fx?: number; chars?: number }): number {
  const t = o.tiers[tier];
  const out = maxTokens + ((o.reasoning ?? "none") === "none" ? THINKING_ROOM : 0);
  return worstCasePaise({ chars: o.chars ?? TALK_INPUT_CHARS, maxTokens: out, usdPerMIn: t.usdPerMIn, usdPerMOut: t.usdPerMOut }, o.fx ?? DEFAULT_USD_INR);
}

/**
 * A BOT'S ANSWER IN THE FRONT DOOR'S SHAPE, SO "ASK ANY BOT" ANSWERS POST /v1/ask THE WAY EVERY OTHER ROAD DOES.
 *
 *   frontEnvelope(answer, bot, how) -> { decision, result, bot, answer }
 *
 * A client that reads `{ id, decision, result }` keeps working; `bot` says which bot answered (its name and colour, and how it was picked: named, by the
 * rules, by the small model, or chosen by the person), and `answer` is the whole of what the bot did (the tools it used, the changes waiting for a yes,
 * the artifacts it made, the links it opened). The decision is the one a bot's message gets: an answer on the reply road, with the reasons.
 */
import type { Decision, FrontResult } from "../front/types.js";
import type { BotAnswer, BotDef } from "./types.js";

export interface PickedHow {
  by: "name" | "rules" | "model" | "chosen";
  confidence: number;
  reasons: string[];
  length?: "short" | "medium" | "long";
}

export interface BotTag { slug: string; name: string; colour: string; builtin: boolean; pickedBy: PickedHow["by"] }

export const tagOf = (bot: Pick<BotDef, "slug" | "name" | "colour" | "ownerId">, by: PickedHow["by"]): BotTag => ({ slug: bot.slug, name: bot.name, colour: bot.colour, builtin: bot.ownerId === null, pickedBy: by });

export function frontEnvelope(answer: BotAnswer, bot: BotDef, how: PickedHow): { decision: Decision; result: FrontResult; bot: BotTag; answer: BotAnswer } {
  const decision: Decision = {
    intent: "answer", shape: { length: how.length ?? "medium", visual: null }, route: "reply", tier: "cheap", budgetPaise: bot.budgets.perRequestPaise,
    confidence: how.confidence, via: how.by === "model" ? "model" : "rules", language: "en", reasons: [`bot:${bot.slug}`, ...how.reasons],
  };
  const result: FrontResult = { text: answer.text, artifacts: [], offers: [], notes: answer.notes, paise: answer.paise, ms: answer.ms };
  return { decision, result, bot: tagOf(bot, how.by), answer };
}

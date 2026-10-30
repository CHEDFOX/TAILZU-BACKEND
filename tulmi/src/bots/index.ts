/**
 * THE BOTS PLATFORM: EVERYTHING IS A BOT, AND A PERSON CAN MAKE THEIR OWN. The story is in docs/bots.md.
 *
 *   types.ts      a bot's definition, its skills, the palette, the limits, BotError
 *   validate.ts   a definition checked (the palette only, the rules capped, the skills a schema); the owner's rules that try to change ours are inert
 *   builtin.ts    Xode, Keylessbord, Plan Ease and the Travel bot, in the same format
 *   store.ts      bots, keys (hashed), commands, facts and threads: the memory twin and Supabase (migration 0038)
 *   keys.ts       an API key: made at random, shown once, kept as sha256 of a pepper and the key
 *   commands.ts   saved commands: a short template with {{input}}, run as /name
 *   prompt.ts     what a bot is told: our principles first, then the owner's own things, fenced and capped
 *   knowledge.ts  a bot's files, answered from the few chunks that are about the question
 *   memory.ts     the stable facts a bot learned of its owner and a rolling summary; forgetting
 *   scope.ts      inside a bot a message is taken only for what the bot can do
 *   tools.ts      one tool for each skill that is on, and the owner's connected apps through the permission tiers
 *   meter.ts      one request's money
 *   run.ts        runBot(): the turn
 *   builder.ts    a draft from one sentence; nothing is saved
 *   door.ts       "Ask any bot": the front door picks the best bot, rules first, the tiny tier when unsure
 *   ports.ts      the seams to the connectors, the files, the artifact core, Xode and the web
 *   service.ts    Bots: all of the above, owner only
 *
 * Off unless BOTS=true (config.ts). Nothing here reaches a network or a store unless it is called to; every piece takes its dependencies as
 * arguments, so the tests drive it with fakes.
 */
import { getConfig } from "../config.js";
import { Bots, type BotsOptions } from "./service.js";

export * from "./types.js";
export { parseBotInput, inertRules, slugOf, SlugSchema, SkillsSchema, RulesSchema, DEFAULT_LIMITS } from "./validate.js";
export type { Limits, Parsed, CleanInput } from "./validate.js";
export { builtinBots, builtinBot, isBuiltinSlug, colourFor, CODE_SLUG } from "./builtin.js";
export { MemoryBotStore, SupabaseBotStore, botStore, resetBotStoreForTests, SlugTaken, BOT_TABLES, BOT_USER_TABLES } from "./store.js";
export type { BotStore, KeyRow, Command, Fact, Thread } from "./store.js";
export { newKey, hashKey, maskKey, prefixOf, bearerKey, looksLikeKey, KEY_SHAPE } from "./keys.js";
export { checkCommand, expand, RESERVED_COMMANDS } from "./commands.js";
export { botUserMessage, rulesBlock, neutral, INERT_NOTE } from "./prompt.js";
export { retrieve, KNOWLEDGE_CHARS } from "./knowledge.js";
export { rememberTurn, saidToRemember, usableFact, BotMemoryReply } from "./memory.js";
export { scopeMessage } from "./scope.js";
export { buildTools } from "./tools.js";
export { Meter } from "./meter.js";
export { runBot, scrub, MAX_TURNS } from "./run.js";
export { draftBot, BotDraftReply, connectorHints } from "./builder.js";
export type { Draft } from "./builder.js";
export { pickBot, scoreBots, BotPickReply, wordsOf } from "./door.js";
export { connectorsPort } from "./ports.js";
export type { BotPorts, BotConnectors, CodeAsk } from "./ports.js";
export { Bots, viewOf, limitsFromConfig } from "./service.js";
export type { BotsOptions, KeyView, AskInput, KeyAnswer, Target, Card } from "./service.js";

/** The bots platform, or null while BOTS is off. `force` makes it anyway (tests). */
export function createBots(o: BotsOptions & { force?: boolean } = {}): Bots | null {
  if (!getConfig().BOTS && !o.force) return null;
  const { force: _force, ...rest } = o;
  void _force;
  return new Bots(rest);
}

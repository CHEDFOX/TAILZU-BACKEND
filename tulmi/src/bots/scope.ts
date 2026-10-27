/**
 * INSIDE A BOT, A MESSAGE IS ONLY EVER TAKEN FOR WHAT THE BOT CAN DO.
 *
 *   scopeMessage(bot, message, ctx) -> { intent, tier, length, notes }
 *
 * The front door reads a message for nothing (front/rules.ts: English, Hinglish, Hindi) and says what it is. Inside a bot, that reading is clamped to
 * the bot's skills: a bot with no research skill that is asked for the latest news answers from what it knows and says so; a bot with no Code skill
 * is not a code bot because the words sound like code; no bot but the Code bot changes code (that flow is the Code bot's own and is left exactly as
 * it is: docs/code-agent.md), so "fix the crash" asked of any other bot is an answer, and the note says where to ask. The intent chooses the model's tier
 * and how long the answer may be; it grants nothing: what a bot may DO is its tools (tools.ts), which are its skills.
 *
 * Pure. Free: the same words give the same answer.
 */
import type { ModelTier } from "../code/brain/tiers.js";
import { REPLY_TOKENS } from "../front/path.js";
import { lengthOf } from "../front/decide.js";
import { readByRules } from "../front/rules.js";
import type { FrontCtx, Intent, Length } from "../front/types.js";
import type { BotDef, SkillName } from "./types.js";

export interface Scope {
  intent: Intent;
  /** What the words alone said, before the bot's skills clamped it. */
  read: Intent;
  /** The skill the intent needs, if any. */
  needs: SkillName | null;
  tier: ModelTier;
  length: Length;
  maxTokens: number;
  /** In words: anything the bot's skills kept it from doing. */
  notes: string[];
  reasons: string[];
}

const NEEDS: Readonly<Partial<Record<Intent, SkillName>>> = { research: "research", code_question: "code", code_task: "code", design: "artifacts", file_question: "files" };

const SAYS: Readonly<Record<SkillName, string>> = {
  web: "look things up on the web", research: "research from several sources", files: "read files", artifacts: "make pages, charts or diagrams", code: "look at your code",
};

export function scopeMessage(bot: Pick<BotDef, "skills">, message: string, ctx: Pick<FrontCtx, "projectId" | "attachments" | "recent" | "mode"> = { attachments: [], recent: [], mode: "text" }): Scope {
  const rules = readByRules(message, ctx);
  const reasons = [...rules.signals];
  const notes: string[] = [];
  let intent = rules.intent;
  const read = intent;
  // Something attached: the message is about it (the front door's own rule, front/decide.ts).
  if (ctx.attachments.length) { intent = "file_question"; reasons.push("attachment"); }
  // No project, nothing to ask the Code bot about.
  if ((intent === "code_question" || intent === "code_task") && !ctx.projectId) { intent = "answer"; reasons.push("no_project"); }
  // Changing code is the Code bot's own flow, never another bot's.
  if (intent === "code_task") {
    intent = bot.skills.code ? "code_question" : "answer";
    notes.push("Changes to code are the Code bot's: ask it, and it opens a pull request.");
    reasons.push("code_task:code_bot");
  }
  let needs = NEEDS[intent] ?? null;
  if (needs === "research" && !bot.skills.research && bot.skills.web) needs = "web";
  if (needs && !bot.skills[needs]) {
    notes.push(`This bot can't ${SAYS[needs]}, so it answered from what it knows.`);
    reasons.push(`skill:${needs}:off`);
    intent = "answer";
    needs = null;
  }
  const length = lengthOf(message, intent, ctx.mode);
  const tier: ModelTier = intent === "design" ? "code" : intent === "research" ? "code" : intent === "chat" ? "tiny" : "cheap";
  const maxTokens = intent === "design" ? 4_000 : REPLY_TOKENS[length];
  return { intent, read, needs, tier, length, maxTokens, notes, reasons: [...new Set(reasons)] };
}

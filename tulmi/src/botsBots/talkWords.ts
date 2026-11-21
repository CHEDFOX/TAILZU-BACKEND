/**
 * WHAT ONE MESSAGE TYPED IN TALK ASKS FOR, READ FOR NOTHING (docs/talk-door.md).
 *
 * Talk is the one screen: a person types, and the message goes wherever it belongs. Most messages are plain language and
 * the front door reads them (docs/front-door.md); this module is only the two marks a person can put on a message
 * themselves, and it is pure so the rules are the same on every road and testable without a model:
 *
 *   "/"  NAMES A BOT.          "/plan what's on tomorrow" is the Plan bot's, for nothing: no pick, no model.
 *   "@"  NAMES A PERSON.       "@Mom book the cab" is still answered by whichever bot fits, and that bot is told it is
 *                              for Mom (docs/social.md section 5: outside a group conversation, "@" means that person).
 *
 * WHY "/" IS THE BOT AND NOT THE COMMAND. A bot's own saved commands are already "/name" inside that bot
 * (docs/bots.md section 6, bots/commands.ts expand). At the door, before any bot is chosen, there is no bot whose
 * commands those could be — so "/" there is the choice of bot, and the first "/word" that is one of the person's own
 * bots is read as one. A "/word" that is NOT a bot is left in the words exactly as typed, so the bot that does answer
 * expands it as its own command, as it always has. One mark, two heights, no ambiguity.
 *
 * NOTHING HERE TRUSTS WHAT IT IS GIVEN. The bot a message names is checked against the person's own bots, never taken
 * on its say-so; a person's name is cut down to what a name can hold before it goes anywhere near a model.
 */

/** A bot as this module needs it: what the person's own list of bots gives (experience/bots/live.ts, bots/types.ts). */
export interface TalkBotRef { slug: string; name: string }

/** Names Talk keeps for itself, which are therefore never read as a bot or passed on as words. */
export const TALK_COMMANDS: ReadonlyArray<{ name: TalkCommand; line: string }> = [
  { name: "new", line: "Start a new thread" },
];

export type TalkCommand = "new";

/** What a message typed in Talk turns out to be. */
export interface TalkRead {
  /** The words to ask, with a named bot's "/slug" taken off and the person it is for said plainly at the end. */
  message: string;
  /** The bot to route to: one of the person's own, or "any" for the door to pick. */
  bot: string;
  /** Talk's own command this message is, instead of an ask. Empty for an ask. */
  command: "" | TalkCommand;
  /** How the bot was chosen: the field's chip, a typed "/slug", or nobody named one. */
  by: "picked" | "slash" | "any";
  /** The person it is for, as it will be shown on the turn. Empty for nobody. */
  forName: string;
}

/** A bot's slug, as every other door spells it. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A leading "/word", with the space or punctuation after it. */
const SLASH = /^\s*\/([a-z0-9][a-z0-9-]{0,39})\b[\s,:.-]*/i;

/**
 * A person's name as it may be said to a model and drawn on a turn: letters, digits, spaces and the few marks a name
 * carries, 40 characters at most. Everything else is dropped rather than escaped, because a name is not a sentence and
 * nothing here needs to round-trip: a name that loses a character is still the right person (the id is what routes).
 */
export function talkName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[^\p{L}\p{N} .'’-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}

/**
 * The one line that says who the ask is for, at the end of the words. A sentence of our own and not a field, because
 * `POST /v1/ask` takes a message and nothing else: every road, every bot and every tier reads it without a change to
 * the front door. It goes LAST so it cannot push the person's own first words out of what the door scores.
 */
export const forLine = (name: string): string => `(This is for ${name}.)`;

/**
 * Read one typed message. `o.bot` is the bot the field's own "/" chip named (which wins: the person picked it off a
 * list), `o.to` the person its "@" chip named.
 */
export function readTalk(raw: unknown, o: { bots: readonly TalkBotRef[]; bot?: unknown; to?: unknown } = { bots: [] }): TalkRead {
  const words = String(raw ?? "").replace(/\r\n?/g, "\n").trim();
  const has = (slug: string): boolean => o.bots.some((b) => b.slug === slug);
  const forName = talkName(o.to);

  // Talk's own commands first, so a bot named "new" could never take one, and so a command is never sent to a model.
  const cmd = SLASH.exec(words);
  const named = cmd ? cmd[1]!.toLowerCase() : "";
  const kept = TALK_COMMANDS.find((c) => c.name === named);
  if (kept && !words.slice(cmd![0].length).trim()) return { message: "", bot: "any", command: kept.name, by: "any", forName: "" };

  // The field's chip: the person picked this bot off a list, so nothing in the words can move it.
  const picked = typeof o.bot === "string" && SLUG.test(o.bot) && has(o.bot) ? o.bot : "";
  if (picked) return { message: withFor(words, forName), bot: picked, command: "", by: "picked", forName };

  // A typed "/slug" that is one of their own bots. One that is not stays in the words, for that bot's own commands.
  if (named && has(named)) {
    const rest = words.slice(cmd![0].length).trim();
    return { message: withFor(rest || words, forName), bot: named, command: "", by: "slash", forName };
  }

  return { message: withFor(words, forName), bot: "any", command: "", by: "any", forName };
}

const withFor = (words: string, name: string): string => (name && words ? `${words}\n\n${forLine(name)}` : words);

/**
 * What the "/" list offers, in the order it is drawn: Talk itself is never in it (it is where you already are), and
 * Xode is never in it either — it is the other pill, it has projects, jobs and branches of its own, and a message it
 * answered in this thread could not show any of them. Everything else the person has, built-in or their own.
 */
export const TALK_SLASH_SKIP: readonly string[] = ["talk", "code"];

export function slashBots<B extends TalkBotRef>(bots: readonly B[]): B[] {
  return bots.filter((b) => !TALK_SLASH_SKIP.includes(b.slug));
}

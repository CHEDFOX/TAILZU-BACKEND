/**
 * THE BOTS TAILZU ITSELF SHIPS: CODE, KEYBOT, PLAN AND TRAVEL (AND THE ORACLE, THE MAIL BOT AND THE MEETING BOT WHERE THEIR SERVICES ARE SET UP), IN THE SAME FORMAT AS A
 * BOT A PERSON MAKES.
 *
 * Everything is a bot. These four are defined in code (ownerId null, nobody can change or delete them) and every person has them. The
 * Xode's own flows are the front door's and Xode's, exactly as they were: when it is the bot that answers, the message goes
 * down the front door's roads (docs/front-door.md) and this definition is only what the person sees, picks by and sets standing choices
 * against. The other three run like any bot: their rules, their skills, the person's connected apps, their memory.
 *
 * The Oracle (src/oracle, docs/oracle.md) reads a person's sky with Plutto's oracle, a service of its own: its words come from there, and its rules
 * here are what the person reads and the front door picks by. It is listed only where ORACLE_WORKER_URL and ORACLE_WORKER_SECRET are set.
 *
 * The mail bot (src/mail, docs/mail.md) keeps a business's email with its own service (mail-worker/): the mailboxes, the sorting and the replies
 * are the worker's; its chat here runs the usual loop with the business's mail in numbers and one line a message (mail/digest.ts). Its name is a
 * placeholder until it is given one. It is listed only where MAIL_WORKER_URL and MAIL_WORKER_SECRET are set.
 *
 * The meeting bot (src/meet, docs/meet.md) joins a person's video calls through Recall.ai, keeps each meeting in a note and answers in its chat
 * and out loud; its chat here runs the usual loop with their meetings as its knowledge (meet/digest.ts). Its name is a placeholder too. It is
 * listed only where RECALL_API_KEY is set.
 *
 * ONE COLOUR EACH, from the natural palette, and this file is where a bot's colour is decided. experience/bots/palette.ts
 * turns the name into a hex and used to carry its own copy of these four, which disagreed with this file for as long as both
 * existed; it now reads them from here, so there is one answer to what colour a bot is.
 *
 * No built-in wears `stone`: it is what botLook falls back to for a bot with no colour of its own, so a built-in in stone
 * looks like any bot somebody made. `ash` is the neutral for a built-in that wants one.
 */
import { getConfig } from "../config.js";
import { MEET_SLUG } from "../meet/types.js";
import { PALETTE, type BotDef, type BotSkills } from "./types.js";

// `health`, `healthSleep` and `healthSource` are last and never spread over: a built-in bot is not one a person made, so the
// health row is never drawn for it and the route that would store days refuses it (docs: perms §4.5, perms2 §5.1, §6).
const skills = (on: Partial<BotSkills>): BotSkills =>
  ({ web: false, files: false, artifacts: false, code: false, research: false, connectors: [], ...on, health: false, healthSleep: false, healthSource: "health" });

export const CODE_SLUG = "code";

/** What each is for, in a line: the front door picks a bot by it. */
const PURPOSE = {
  code: "Reads your projects, answers questions about the code, and changes it through pull requests.",
  keybot: "Writes, rewrites and replies in your own voice, in any language you mix.",
  plan: "Turns a goal into short ordered steps with timings, and puts them on your calendar and task list.",
  travel: "Plans trips: routes, stays and timings, with sources.",
  oracle: "Reads your birth chart and the world's divination traditions to answer what you ask about your life, love, work and timing.",
  mail: "Keeps your business's email: sorts what arrives, drafts the replies in your voice, and tells you what needs you.",
  meet: "Joins your video calls: takes the notes, answers what people ask in the chat and out loud, and turns what was agreed into your to-dos.",
  lingo: "Teaches you a language by talking with you, and brings each word back exactly when you are about to forget it.",
} as const;

const DEFS: readonly BotDef[] = [
  {
    id: "code", ownerId: null, slug: "code", name: "Xode", colour: "moss",
    purpose: PURPOSE.code,
    principles: [
      "Match the project's conventions before suggesting a change.",
      "Cite code by file path and line.",
      "Change the smallest surface that does the job.",
      "Never edit anything under .github/workflows.",
    ],
    skills: skills({ web: true, files: true, artifacts: true, code: true, research: true }),
    knowledge: [], tone: "precise and brief", visibility: "private", budgets: { perRequestPaise: 3000, dailyPaise: 5000 },
  },
  {
    id: "keybot", ownerId: null, slug: "keybot", name: "Keylessbord", colour: "clay",
    purpose: PURPOSE.keybot,
    principles: [
      "Write only what they asked for; add no fact of your own.",
      "Keep their language and script; keep Hinglish as Hinglish.",
      "Match their usual length, punctuation and greeting.",
      "Give the text alone, ready to send.",
    ],
    skills: skills({ files: true }),
    knowledge: [], tone: "the owner's own voice", visibility: "private", budgets: { perRequestPaise: 100, dailyPaise: 500 },
  },
  {
    id: "plan", ownerId: null, slug: "plan", name: "Plan Ease", colour: "ochre",
    purpose: PURPOSE.plan,
    principles: [
      "Three to ten steps, each one action.",
      "Put a time or a duration on every step that has one.",
      "Say what could go wrong, once, at the end.",
      "Ask one question only when a wrong guess would waste the plan.",
      "Put on the calendar or the to-do list only what they asked for, and say what you added.",
    ],
    // Tailzu's own calendar and to-dos (src/calendar/bots.ts): always on, nothing to connect.
    skills: skills({ artifacts: true, connectors: ["calendar", "tasks"] }),
    knowledge: [], tone: "calm and practical", visibility: "private", budgets: { perRequestPaise: 150, dailyPaise: 800 },
  },
  {
    id: "travel", ownerId: null, slug: "travel", name: "Travel bot", colour: "sea",
    purpose: PURPOSE.travel,
    principles: [
      "Give dates with their source and the day they were read.",
      "Quote a price only from a live flight or hotel search, with when it was read; never from the web or memory.",
      "Offer two or three options, not a long list.",
      "Say what needs a visa, a booking or a ticket in advance.",
      "Open maps and booking apps for the person to finish there; never pay for them.",
    ],
    skills: skills({ web: true, research: true, artifacts: true, connectors: ["maps", "booking"] }),
    knowledge: [], tone: "warm and concrete", visibility: "private", budgets: { perRequestPaise: 300, dailyPaise: 1000 },
  },
];

const ORACLE: BotDef = {
  id: "oracle", ownerId: null, slug: "oracle", name: "Oracle", colour: "plum",
  purpose: PURPOSE.oracle,
  principles: [
    "Read from the person's own birth details; ask for them when a question needs a chart.",
    "Say what is true of their life in plain words, never the machinery, unless they ask for it.",
    "Give dates only where the data gives them.",
    "Every hard thing comes with what eases it.",
  ],
  // Its reading is its own service's (src/oracle): no tools here.
  skills: skills({}),
  knowledge: [], tone: "close, unhurried and certain", visibility: "private", budgets: { perRequestPaise: 600, dailyPaise: 5000 },
};

export const MAIL_SLUG = "mail";

const MAIL: BotDef = {
  id: MAIL_SLUG, ownerId: null, slug: MAIL_SLUG, name: "Mail", colour: "sand",
  purpose: PURPOSE.mail,
  principles: [
    "Answer from the business's own mail and numbers; never invent a message, a sender or a figure.",
    "Say first what needs a person.",
    "Never say a reply was sent, changed or thrown away: that is done on the mail page, by them.",
    "Keep a customer's words to what the answer needs.",
  ],
  // Its mail is its own service's (src/mail): no tools here; the chat reads the business's mail in numbers and one line a message.
  skills: skills({}),
  knowledge: [], tone: "plain and brief", visibility: "private", budgets: { perRequestPaise: 150, dailyPaise: 1000 },
};

export const LINGO_SLUG = "lingo";

const LINGO: BotDef = {
  id: LINGO_SLUG, ownerId: null, slug: LINGO_SLUG, name: "Lingo", colour: "ash",
  purpose: PURPOSE.lingo,
  principles: [
    "Speak the language they are learning, at the level they are at, and translate only what they are stuck on.",
    "Correct what they said, once, in a line, and then carry on the conversation.",
    "Bring the conversation round to the words they are due to practise.",
    "Never say a word is learned until they have said it out loud.",
    "Their own words, the ones they reached for, come before anything off a list.",
  ],
  // Its words, its scheduling and its marking are its own (src/lingo): no tools here. Its chat reads their course.
  skills: skills({}),
  knowledge: [], tone: "patient, warm, and never sarcastic about a mistake", visibility: "private",
  budgets: { perRequestPaise: 200, dailyPaise: 2000 },
};

export { MEET_SLUG };

const MEET: BotDef = {
  id: MEET_SLUG, ownerId: null, slug: MEET_SLUG, name: "Meetings", colour: "pine",
  purpose: PURPOSE.meet,
  principles: [
    "Answer from what was said in their meetings; never invent who said what, a number or a decision.",
    "Say first what was decided and who will do what.",
    "Never say it joined, left or said something in a call: that is on the meetings page.",
    "Keep other people's words to what the answer needs.",
  ],
  // Its meetings are its own service's (src/meet): no tools here; the chat reads their meetings and notes (meet/digest.ts).
  skills: skills({}),
  knowledge: [], tone: "plain and brief", visibility: "private", budgets: { perRequestPaise: 150, dailyPaise: 1000 },
};

/** Lingo is listed only where it is switched on. It needs no service of its own. */
export function lingoOn(): boolean {
  try {
    return Boolean(getConfig().LINGO);
  } catch {
    return false;
  }
}

/** The meeting bot is listed only where Recall is set up. */
export function meetOn(): boolean {
  try {
    return Boolean(getConfig().RECALL_API_KEY);
  } catch {
    return false;
  }
}

/** The mail bot is listed only where its service is set up. */
export function mailOn(): boolean {
  try {
    const c = getConfig();
    return Boolean(c.MAIL_WORKER_URL && c.MAIL_WORKER_SECRET);
  } catch {
    return false;
  }
}

/** The Oracle is listed only where its service is set up. */
export function oracleOn(): boolean {
  try {
    const c = getConfig();
    return Boolean(c.ORACLE_WORKER_URL && c.ORACLE_WORKER_SECRET);
  } catch {
    return false;
  }
}

const defs = (): readonly BotDef[] => [...DEFS, ...(oracleOn() ? [ORACLE] : []), ...(mailOn() ? [MAIL] : []), ...(meetOn() ? [MEET] : []), ...(lingoOn() ? [LINGO] : [])];

/** The built-ins, as copies (a caller cannot change them). */
export function builtinBots(): BotDef[] {
  return defs().map((d) => ({ ...d, principles: [...d.principles], skills: { ...d.skills, connectors: [...d.skills.connectors] }, knowledge: [], budgets: { ...d.budgets } }));
}

export const isBuiltinSlug = (slug: string): boolean => slug === ORACLE.slug || slug === MAIL.slug || slug === MEET.slug || slug === LINGO.slug || DEFS.some((d) => d.slug === slug);

export function builtinBot(slug: string): BotDef | null {
  return builtinBots().find((d) => d.slug === slug || d.id === slug) ?? null;
}

/** The colour a new bot is given when its owner picks none: one their other bots do not have, else by the slug. */
export function colourFor(slug: string, taken: readonly string[]): (typeof PALETTE)[number] {
  const free = PALETTE.filter((c) => !taken.includes(c));
  const pool = free.length ? free : PALETTE;
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length]!;
}

/**
 * THE BOTS TAILZU ITSELF SHIPS: CODE, KEYBOT, PLAN AND TRAVEL, IN THE SAME FORMAT AS A BOT A PERSON MAKES.
 *
 * Everything is a bot. These four are defined in code (ownerId null, nobody can change or delete them) and every person has them. The
 * Code bot's own flows are the front door's and the Code bot's, exactly as they were: when it is the bot that answers, the message goes
 * down the front door's roads (docs/front-door.md) and this definition is only what the person sees, picks by and sets standing choices
 * against. The other three run like any bot: their rules, their skills, the person's connected apps, their memory.
 *
 * One colour each, from the natural palette.
 */
import { PALETTE, type BotDef, type BotSkills } from "./types.js";

const skills = (on: Partial<BotSkills>): BotSkills => ({ web: false, files: false, artifacts: false, code: false, research: false, connectors: [], ...on });

export const CODE_SLUG = "code";

/** What each is for, in a line: the front door picks a bot by it. */
const PURPOSE = {
  code: "Reads your projects, answers questions about the code, and changes it through pull requests.",
  keybot: "Writes, rewrites and replies in your own voice, in any language you mix.",
  plan: "Turns a goal into short ordered steps with timings, and puts them on your calendar and task list.",
  travel: "Plans trips: routes, stays, timings and costs, with sources.",
} as const;

const DEFS: readonly BotDef[] = [
  {
    id: "code", ownerId: null, slug: "code", name: "Code bot", colour: "pine",
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
    id: "keybot", ownerId: null, slug: "keybot", name: "Keybot", colour: "ochre",
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
    id: "plan", ownerId: null, slug: "plan", name: "Plan bot", colour: "sea",
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
    id: "travel", ownerId: null, slug: "travel", name: "Travel bot", colour: "clay",
    purpose: PURPOSE.travel,
    principles: [
      "Give dates and prices with their source and the day they were read.",
      "Offer two or three options, not a long list.",
      "Say what needs a visa, a booking or a ticket in advance.",
      "Open maps and booking apps for the person to finish there; never pay for them.",
    ],
    skills: skills({ web: true, research: true, artifacts: true, connectors: ["maps", "booking"] }),
    knowledge: [], tone: "warm and concrete", visibility: "private", budgets: { perRequestPaise: 300, dailyPaise: 1000 },
  },
];

/** The four, as copies (a caller cannot change them). */
export function builtinBots(): BotDef[] {
  return DEFS.map((d) => ({ ...d, principles: [...d.principles], skills: { ...d.skills, connectors: [...d.skills.connectors] }, knowledge: [], budgets: { ...d.budgets } }));
}

export const isBuiltinSlug = (slug: string): boolean => DEFS.some((d) => d.slug === slug);

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

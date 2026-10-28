/**
 * THE WORDS THE BOTS PLATFORM IS MADE OF: A BOT'S DEFINITION, ITS SKILLS, ITS LIMITS, AND WHAT BECAME OF A MESSAGE. The story is in docs/bots.md.
 *
 * Plain shapes and the numbers the rest of the module (and the role contracts in principles/roles.ts) share. Nothing here reads the
 * environment, a store or a model.
 */

/** The only colours a bot may have: a natural palette, one for each bot. */
export const PALETTE = ["moss", "clay", "ochre", "sea", "pine", "plum", "sand", "stone"] as const;
export type Colour = (typeof PALETTE)[number];

/** What a bot can do beyond talking. A tool exists only for a skill that is on. */
export const SKILL_NAMES = ["web", "files", "artifacts", "code", "research"] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface BotSkills {
  /** Search the web and read a page. */
  web: boolean;
  /** Read files: the bot's own knowledge, and what the person attaches. */
  files: boolean;
  /** Make a page, a chart or a diagram the person sees beside the chat. */
  artifacts: boolean;
  /** Ask the Code bot about the person's project. */
  code: boolean;
  /** A researched answer that cites its pages. */
  research: boolean;
  /** Connected apps the bot may use, by connector id. A write still asks the person. */
  connectors: string[];
}

export interface BotBudgets {
  /** The most one request may cost, in paise, all calls together. */
  perRequestPaise: number;
  /** The most the bot may spend for its owner in a day. */
  dailyPaise: number;
}

/** A bot, as one format for the Code bot, Keybot, the Plan bot, the Travel bot and every bot a person makes. */
export interface BotDef {
  /** A uuid for a person's bot; the slug for a built-in. */
  id: string;
  /** Null for a built-in bot. */
  ownerId: string | null;
  slug: string;
  name: string;
  colour: Colour;
  /** One line: what the bot is for. The front door picks a bot by it. */
  purpose: string;
  /** The owner's own rules for their own bot: at most 12, each one short line. They never override Tailzu's principles or the policy. */
  principles: string[];
  skills: BotSkills;
  /** Media ids (files the owner has had read) the bot answers from, a few relevant chunks at a time. */
  knowledge: string[];
  tone: string;
  visibility: "private";
  budgets: BotBudgets;
}

/** A bot as it is kept. */
export interface StoredBot extends BotDef {
  /** The owner has turned the public card on (GET /v1/bots/:slug without a session). Off by default. */
  publicCard: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What the owner sees: the definition and whether it is theirs to change. */
export interface BotView extends BotDef {
  builtin: boolean;
  publicCard: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

// ------------------------------------------------------------------ limits

export const LIMITS = {
  name: 40,
  purpose: 140,
  tone: 80,
  rules: 12,
  rule: 120,
  connectors: 12,
  knowledge: 10,
  slug: { min: 3, max: 40 },
  command: { name: 24, template: 600, perBot: 30 },
  facts: { perBot: 40, fact: 160 },
  summary: 800,
  message: 8_000,
  history: { turns: 10, chars: 2_000 },
} as const;

/** Slugs nobody may take: the built-in bots, Notes (its own tile on Home), and words the routes use. */
export const RESERVED_SLUGS: readonly string[] = [
  "code", "keybot", "plan", "travel", "notes", "me", "new", "draft", "approve", "export", "any", "admin", "api", "v1", "bots", "bot", "tailzu", "test", "keys", "memory", "commands",
];

// ------------------------------------------------------------------ what a message became

/** An approval the owner is asked for: a change an app would make, waiting for their yes. */
export interface PendingApproval {
  taskId: string;
  connector: string;
  tool: string;
  preview: string;
}

export interface BotAnswer {
  bot: { slug: string; name: string; colour: Colour; builtin: boolean };
  text: string;
  /** What it cost, in paise. */
  paise: number;
  /** Tool names used, in order. */
  tools: string[];
  /** Changes waiting for the owner's yes: the answer never says they are done. */
  approvals: PendingApproval[];
  artifacts: Array<{ id: string; version?: number }>;
  /** Links an app opened for the person to finish in (a hand-off). */
  opens: Array<{ label: string; url: string }>;
  /** Plain words about anything left out, cut short or refused. */
  notes: string[];
  /** Why the front door picked this bot, when it did. */
  pickedBy?: "name" | "rules" | "model" | "chosen";
  ms: number;
}

export type BotEvent =
  | { t: "status"; stage: string }
  | { t: "text"; text: string }
  | { t: "result"; result: BotAnswer }
  | { t: "error"; code: string; message: string };

/** A refusal or a failure with a sentence a person can read. */
export class BotError extends Error {
  constructor(readonly code: string, message: string, readonly status: number = 400, readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = "BotError";
  }
}

export const isBotError = (e: unknown): e is BotError => e instanceof BotError;

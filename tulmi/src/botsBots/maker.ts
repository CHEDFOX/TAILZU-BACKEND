/**
 * MAKE A BOT, AS THE APP DOES IT: the person's draft kept while they shape it, on the bots platform's own draft / test / approve.
 *
 *   get(user)                 the draft in progress (the sentence, what Bots.draft made of it, the trial so far), or null
 *   make(user, sentence)      Bots.draft (a model reads the sentence; nothing is saved as a bot) and keeps the draft
 *   change(user, patch)       the person's edits: the name, the colour, a rule added or dropped, the files and web switches, an app on or off
 *   tryIt(user, message)      Bots.test: a chat with the draft that is never saved, kept with the draft (six turns at most)
 *   approve(user)             Bots.approve with the edited definition: the only thing that makes the bot; the draft goes
 *   discard(user)             start over
 */
import { BotError, LIMITS, PALETTE, type Bots, type Draft } from "../bots/index.js";
import { table, type Table } from "./rows.js";

export interface DraftRow {
  [k: string]: unknown;
  user_id: string;
  sentence: string;
  draft: Draft;
  trial: Array<{ said: string; answered: string }>;
  updated_ms: number;
}

export interface DraftView { sentence: string; draft: Draft; trial: Array<{ said: string; answered: string }>; updatedAt: number }

export interface DraftPatch {
  name?: unknown;
  colour?: unknown;
  addRule?: unknown;
  dropRule?: unknown;
  files?: unknown;
  web?: unknown;
  connector?: unknown;
}

const TRIAL_KEEP = 6;
const clean = (s: string, max: number): string => s.replace(/\s+/g, " ").trim().slice(0, max);

export class BotMaker {
  constructor(
    private readonly bots: Bots,
    private readonly now: () => number = Date.now,
    private readonly rows: Table<DraftRow> = table<DraftRow>("bot_drafts"),
  ) {}

  async get(userId: string): Promise<DraftView | null> {
    const [r] = await this.rows.select({ user_id: userId }, { limit: 1 });
    return r ? { sentence: r.sentence, draft: r.draft, trial: r.trial ?? [], updatedAt: Number(r.updated_ms) || 0 } : null;
  }

  async make(userId: string, sentence: unknown, signal?: AbortSignal): Promise<DraftView> {
    if (typeof sentence !== "string" || sentence.trim().length < 4) throw new BotError("bad_request", "Say in a sentence what the bot should do.");
    const said = sentence.trim().slice(0, 600);
    const draft = await this.bots.draft(userId, said, signal);
    const row: DraftRow = { user_id: userId, sentence: said, draft, trial: [], updated_ms: this.now() };
    await this.rows.upsert(row, ["user_id"]);
    return { sentence: said, draft, trial: [], updatedAt: row.updated_ms };
  }

  private async mine(userId: string): Promise<DraftRow> {
    const [r] = await this.rows.select({ user_id: userId }, { limit: 1 });
    if (!r) throw new BotError("no_draft", "There's no draft yet. Say what the bot should do first.", 404);
    return r;
  }

  async change(userId: string, patch: DraftPatch): Promise<DraftView> {
    const r = await this.mine(userId);
    const d = r.draft.definition;
    if (patch.name !== undefined) {
      const name = typeof patch.name === "string" ? clean(patch.name, LIMITS.name) : "";
      if (!name) throw new BotError("bad_request", "A bot needs a name.");
      d.name = name;
    }
    if (patch.colour !== undefined) {
      if (!(PALETTE as readonly unknown[]).includes(patch.colour)) throw new BotError("bad_request", "Pick one of the colours shown.");
      d.colour = patch.colour as typeof d.colour;
    }
    if (patch.addRule !== undefined) {
      const rule = typeof patch.addRule === "string" ? clean(patch.addRule, LIMITS.rule) : "";
      if (!rule) throw new BotError("bad_request", "Write the rule first.");
      if (d.principles.length >= LIMITS.rules) throw new BotError("rule_limit", `A bot may have ${LIMITS.rules} rules.`, 409);
      if (!d.principles.includes(rule)) d.principles.push(rule);
    }
    if (patch.dropRule !== undefined) {
      const i = Number(patch.dropRule);
      if (!Number.isInteger(i) || i < 0 || i >= d.principles.length) throw new BotError("not_found", "That rule isn't there any more.", 404);
      d.principles.splice(i, 1);
    }
    if (typeof patch.files === "boolean") d.skills.files = patch.files;
    if (typeof patch.web === "boolean") d.skills.web = patch.web;
    if (patch.connector !== undefined) {
      const c = patch.connector as { id?: unknown; on?: unknown } | null;
      if (!c || typeof c.id !== "string" || typeof c.on !== "boolean") throw new BotError("bad_request", "connector is { id, on }.");
      const id = c.id.toLowerCase();
      d.skills.connectors = c.on ? [...new Set([...d.skills.connectors, id])].slice(0, LIMITS.connectors) : d.skills.connectors.filter((x) => x !== id);
    }
    r.updated_ms = this.now();
    await this.rows.upsert(r, ["user_id"]);
    return { sentence: r.sentence, draft: r.draft, trial: r.trial ?? [], updatedAt: r.updated_ms };
  }

  async tryIt(userId: string, message: unknown, signal?: AbortSignal): Promise<{ said: string; answered: string; paise: number }> {
    if (typeof message !== "string" || !message.trim()) throw new BotError("bad_request", "Type something to try it with.");
    const r = await this.mine(userId);
    const history = (r.trial ?? []).flatMap((t) => [{ role: "user" as const, content: t.said.slice(0, LIMITS.history.chars) }, { role: "assistant" as const, content: t.answered.slice(0, LIMITS.history.chars) }]).slice(-LIMITS.history.turns);
    const said = message.trim().slice(0, LIMITS.message);
    const answer = await this.bots.test(userId, r.draft.definition, { message: said, history, ...(signal ? { signal } : {}) });
    r.trial = [...(r.trial ?? []), { said, answered: answer.text }].slice(-TRIAL_KEEP);
    r.updated_ms = this.now();
    await this.rows.upsert(r, ["user_id"]);
    return { said, answered: answer.text, paise: answer.paise };
  }

  async approve(userId: string): Promise<{ bot: { slug: string; name: string }; warnings: string[] }> {
    const r = await this.mine(userId);
    const { slug: _slug, ...definition } = r.draft.definition;
    void _slug;
    const made = await this.bots.approve(userId, { definition, approved: true });
    await this.rows.remove({ user_id: userId });
    return { bot: { slug: made.bot.slug, name: made.bot.name }, warnings: made.warnings };
  }

  async discard(userId: string): Promise<void> {
    await this.rows.remove({ user_id: userId });
  }
}

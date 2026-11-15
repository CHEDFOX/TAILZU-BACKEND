/**
 * A CHAT WITH A BOT, AS THE APP SHOWS IT: what the person said and what the bot answered, turn by turn, per person and bot.
 *
 *   recent(user, slug)          the last turns, oldest first (the bot's page and the chat draw them)
 *   send(user, slug, message)   asks the bot (Bots.ask: its rules, skills, apps, memory, budget) with the last turns as history, and keeps both turns
 *   clear(user, slug)           starts the chat over (what the bot remembers is its memory, forgotten on its own routes)
 *   note(user, slug, text)      one bot turn no message asked for (how a call began)
 *   noteTurn(user, slug, r, t)  one turn of either side, kept as it was said: a live call's words, as the chat page shows a typed chat
 *
 * The bot's memory (src/bots/memory.ts) keeps facts and a short summary; this keeps the words, so the page can show them. Xode
 * answers through the front door (its own page), not here.
 *
 * EVERY TURN IS KEPT. Until migration 0090 the newest 200 a person a bot were kept and the rest deleted for good; now 200 is only how
 * many `recent` hands back - to the page, and to the model as history - and nothing is thrown away. A person who clears a chat still
 * clears it: that is theirs to do.
 *
 * Every turn belongs to a SESSION (sessions.ts): one conversation, which never closes. A turn with no session named joins the one last
 * touched, so talking again carries on where it stopped; a new one starts only when the person asks for it (the + on the bot's page).
 */
import { randomUUID } from "node:crypto";
import { BotError, LIMITS, type AskInput, type BotAnswer, type Bots } from "../bots/index.js";
import { table, type Table } from "./rows.js";
import { sessions as sessionStore, type Sessions } from "./sessions.js";

export interface ChatTurnRow {
  [k: string]: unknown;
  id: string;
  user_id: string;
  bot: string;
  /** The session it belongs to (sessions.ts); null for everything said before sessions existed. */
  session_id?: string | null;
  role: "me" | "bot";
  text: string;
  /** A bot turn's links to finish in another app, the changes waiting for a yes, and what it cost. */
  extra: { opens?: Array<{ label: string; url: string }>; approvals?: Array<{ taskId: string; connector: string; preview: string }>; paise?: number };
  at_ms: number;
}

export interface ChatTurn {
  id: string;
  role: "me" | "bot";
  text: string;
  at: number;
  /** The session it belongs to, or null for a turn said before sessions existed. */
  session?: string | null;
  opens: Array<{ label: string; url: string }>;
  approvals: Array<{ taskId: string; connector: string; preview: string }>;
  paise: number;
}

/** Most turns handed back at once - to the page, and to the model as history. Nothing is deleted at this number. */
export const CHAT_KEEP = 200;

const turnOf = (r: ChatTurnRow): ChatTurn => ({
  id: r.id, role: r.role, text: r.text, at: Number(r.at_ms) || 0,
  ...(r.session_id ? { session: r.session_id } : {}),
  opens: r.extra?.opens ?? [], approvals: r.extra?.approvals ?? [], paise: r.extra?.paise ?? 0,
});

export class BotChat {
  constructor(
    private readonly bots: Bots,
    private readonly now: () => number = Date.now,
    private readonly turns: Table<ChatTurnRow> = table<ChatTurnRow>("bot_chat_turns"),
    private readonly sessions: Sessions = sessionStore(),
  ) {}

  /** The turns of one session, oldest first: what the session's own screen draws. */
  async ofSession(userId: string, session: string, limit = CHAT_KEEP): Promise<ChatTurn[]> {
    const rows = await this.turns.select({ user_id: userId, session_id: session }, { order: "at_ms", desc: true, limit: Math.max(1, limit) });
    return rows.map(turnOf).reverse();
  }

  /** Which session a word said now belongs to: the one named, else the one last touched, else a new one. */
  private async sessionFor(userId: string, bot: string, said: string, named?: string | null): Promise<string> {
    if (named) {
      const found = await this.sessions.get(userId, named);
      if (found) return found.id;
    }
    return (await this.sessions.current(userId, bot, said)).id;
  }

  /** The last `limit` turns, oldest first. */
  async recent(userId: string, slug: string, limit = 30): Promise<ChatTurn[]> {
    const rows = await this.turns.select({ user_id: userId, bot: slug }, { order: "at_ms", desc: true, limit: Math.max(1, Math.min(limit, CHAT_KEEP)) });
    return rows.map(turnOf).reverse();
  }

  /** `attached`: what the person's spaces shared with this bot (shared.ts forBot), read as data. */
  /** `live`: the answer's words as they are written and what it is doing (an app that listens: live/askStream.ts). */
  /**
   * `o.call`: this turn is part of a call the live switch is on for. Such a call is never stopped for money (Bots.ask then asks no
   * day budget and no spend gate). False or absent, the turn is held to both, exactly as a chat turn is.
   */
  async send(userId: string, slug: string, message: unknown, signal?: AbortSignal, attached: Array<{ name: string; kind: string; text: string }> = [],
    live: Pick<AskInput, "onText" | "onReset" | "emit"> = {}, o: { call?: boolean; session?: string | null } = {}): Promise<{ answer: BotAnswer; turns: ChatTurn[] }> {
    if (typeof message !== "string" || !message.trim()) throw new BotError("bad_request", "Type what you want to ask first.");
    if (message.length > LIMITS.message) throw new BotError("too_large", `A message may be ${LIMITS.message} characters at most.`, 413);
    const found = await this.bots.resolve(userId, slug);
    if (!found) throw new BotError("not_found", "There is no such bot.", 404);
    if (found.def.slug === "code") throw new BotError("code_bot", "Xode answers on its own page.", 409);
    const said = message.trim();
    const before = await this.recent(userId, found.def.slug, LIMITS.history.turns);
    const history = before.map((t) => ({ role: t.role === "me" ? "user" as const : "assistant" as const, content: t.text.slice(0, LIMITS.history.chars) }));
    const answer = await this.bots.ask(userId, found.def.slug, { message: said, history, ...(signal ? { signal } : {}), ...(attached.length ? { attached } : {}), ...live, ...(o.call ? { call: true as const } : {}) });
    const at = this.now();
    const session = await this.sessionFor(userId, found.def.slug, said, o.session);
    const mine: ChatTurnRow = { id: randomUUID(), user_id: userId, bot: found.def.slug, session_id: session, role: "me", text: said, extra: {}, at_ms: at };
    const theirs: ChatTurnRow = {
      id: randomUUID(), user_id: userId, bot: found.def.slug, session_id: session, role: "bot", text: answer.text, at_ms: at + 1,
      extra: {
        ...(answer.opens.length ? { opens: answer.opens.slice(0, 6) } : {}),
        ...(answer.approvals.length ? { approvals: answer.approvals.slice(0, 6).map((a) => ({ taskId: a.taskId, connector: a.connector, preview: a.preview })) } : {}),
        paise: answer.paise,
      },
    };
    await this.turns.insert(mine);
    await this.turns.insert(theirs);
    await this.sessions.touch(userId, session, said);
    return { answer, turns: [turnOf(mine), turnOf(theirs)] };
  }

  /**
   * A bot turn that no message asked for: what Plan Ease said when a call was answered (botsBots/planCall.ts). The chat page then shows
   * how the call began, and the history gives the person's next words ("move it") their subject.
   */
  async note(userId: string, slug: string, text: string): Promise<void> {
    const said = String(text ?? "").trim();
    if (!said) return;
    const bot = slug.toLowerCase();
    const session = await this.sessionFor(userId, bot, said, null);
    await this.turns.insert({ id: randomUUID(), user_id: userId, bot, session_id: session, role: "bot", text: said.slice(0, LIMITS.message), extra: {}, at_ms: this.now() });
    await this.sessions.touch(userId, session, "");
  }

  /**
   * ONE TURN OF A LIVE CALL, kept as the person and the bot said it (botsBots/planCallLive.ts). No model is asked: the words have
   * already been spoken. The chat page then shows a call the way it shows a typed chat, and the next typed message has its subject.
   */
  async noteTurn(userId: string, slug: string, role: "me" | "bot", text: string): Promise<void> {
    const said = String(text ?? "").trim();
    if (!said) return;
    const bot = slug.toLowerCase();
    const session = await this.sessionFor(userId, bot, role === "me" ? said : "", null);
    await this.turns.insert({ id: randomUUID(), user_id: userId, bot, session_id: session, role, text: said.slice(0, LIMITS.message), extra: {}, at_ms: this.now() });
    await this.sessions.touch(userId, session, role === "me" ? said : "");
  }

  async clear(userId: string, slug: string): Promise<number> {
    return this.turns.remove({ user_id: userId, bot: slug.toLowerCase() });
  }

  /** Every link a bot opened for the person (a booking, a route), newest first: the Travel bot's trip reads them. */
  async opens(userId: string, slug: string, limit = 20): Promise<Array<{ label: string; url: string; at: number; said: string }>> {
    const rows = (await this.recent(userId, slug, 60)).reverse();
    const out: Array<{ label: string; url: string; at: number; said: string }> = [];
    for (let i = 0; i < rows.length; i += 1) {
      const t = rows[i]!;
      if (t.role !== "bot") continue;
      const asked = rows[i + 1]?.role === "me" ? rows[i + 1]!.text : "";
      for (const o of t.opens) if (!out.some((x) => x.url === o.url)) out.push({ ...o, at: t.at, said: asked });
    }
    return out.slice(0, limit);
  }

}

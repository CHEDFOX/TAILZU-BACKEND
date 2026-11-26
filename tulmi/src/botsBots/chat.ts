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
 * EVERY TURN IS KEPT. Until migration 0102 the newest 200 a person a bot were kept and the rest deleted for good; now 200 is only how
 * many `recent` hands back - to the page, and to the model as history - and nothing is thrown away. A person who clears a chat still
 * clears it: that is theirs to do.
 *
 * Every turn belongs to a SESSION (sessions.ts): one conversation, which never closes. A turn with no session named joins the one last
 * touched, so talking again carries on where it stopped; a new one starts only when the person asks for it (the + on the bot's page).
 *
 * A bot turn also keeps what was drawn under its words (src/show: a choice, a callout, a table...), and the person can answer a
 * drawing instead of typing: `picks` names the turn and carries what they picked and typed in it, which becomes their message in
 * plain words (show/answer.ts), so the bot, the history and the chat read it like anything typed.
 */
import { randomUUID } from "node:crypto";
import { BotError, LIMITS, type AskInput, type BotAnswer, type Bots } from "../bots/index.js";
import { wordsOf } from "../show/answer.js";
import { keptShown } from "../show/check.js";
import type { Shown } from "../show/types.js";
import { table, type Table } from "./rows.js";
import { botSaid } from "../bots/notifyReply.js";
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
  /** A bot turn's links to finish in another app, the changes waiting for a yes, what it cost, and what was drawn under its words. */
  extra: {
    opens?: Array<{ label: string; url: string }>; approvals?: Array<{ taskId: string; connector: string; preview: string }>; paise?: number; show?: Shown;
    /**
     * WHO ANSWERED, where that is not the thread's own bot. Only Talk's thread has this (docs/talk-door.md): it is one
     * conversation that every bot answers in, so a turn has to say which one did, or the chat could not draw it. Every
     * other thread is one bot's and leaves it off, exactly as before.
     */
    by?: TurnBy;
    /** What the answer left to do, as the door reported it: the cards the chat draws under the words. */
    did?: TurnDid;
    /** The person the message was for ("@Mom"), as it was shown when it was sent. A name, never an id. */
    forName?: string;
    /** What the person sent with their words (a photo, a file): refs only, never the bytes. Talk's thread draws them. */
    files?: TurnFile[];
    /** Pictures a bot made as its answer (Talk: the cinema bot's picture engine), by id and type; drawn by a signed link. */
    images?: TurnImage[];
  };
  at_ms: number;
}

/** The bot that answered one turn of a thread that is not its own. */
export interface TurnBy { slug: string; name: string; color: string }

/**
 * What an answer left to do: a Xode job to watch, a payment to press, what the everyday tools found, changes waiting for
 * a yes, a routine to save. Ids and counts only — the cards are drawn from them, and nothing here is words a model wrote.
 */
export interface TurnDid { job?: string; upi?: string; finds?: string; needs?: number; routine?: string }

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
  /** What was drawn under a bot turn's words, checked again as it is read (a row is data too). */
  show?: Shown;
  /** Which bot answered, on a thread that is not one bot's (Talk's). Absent everywhere else. */
  by?: TurnBy;
  /** What the answer left to do: the cards the chat draws under the words. */
  did?: TurnDid;
  /** The person this turn was for, by name. */
  forName?: string;
  /** What the person sent with it: a photo, a file. */
  files?: TurnFile[];
  /** Pictures the bot made as its answer. */
  images?: TurnImage[];
}

/** A picture a bot made: the cinema bot's own picture, by id and type (its key is made from them, cinema/media.ts pictureKey). */
export interface TurnImage { id: string; type: string }

/** Pictures read off a row or a reply: an id the store could have made and a picture type, at most four. */
export function imagesOf(v: unknown): TurnImage[] {
  if (!Array.isArray(v)) return [];
  const out: TurnImage[] = [];
  for (const x of v) {
    const f = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (typeof f.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(f.id)) continue;
    const type = typeof f.type === "string" && /^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type) ? f.type : "";
    if (!type) continue;
    out.push({ id: f.id, type });
    if (out.length >= 4) break;
  }
  return out;
}

/** A file the person sent with their words: the ref the upload gave back, so the chat can draw it (never its bytes). */
export interface TurnFile { id: string; name: string; kind: string; mime: string; bytes: number }

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The most files one turn keeps: the door's own cap (routes/bots/botsShell.ts). */
export const TURN_FILES_MAX = 8;

/** Files read off a request or a row: only well-formed refs, at most TURN_FILES_MAX, every field cut to what it can hold. */
export function filesOf(v: unknown): TurnFile[] {
  if (!Array.isArray(v)) return [];
  const out: TurnFile[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const f = x as Record<string, unknown>;
    if (typeof f.id !== "string" || !FILE_ID.test(f.id)) continue;
    out.push({
      id: f.id.toLowerCase(),
      name: String(f.name ?? "file").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || "file",
      kind: String(f.kind ?? "file").replace(/[^a-z]/g, "").slice(0, 16) || "file",
      mime: String(f.mime ?? "").replace(/[^A-Za-z0-9.+/-]/g, "").slice(0, 80),
      bytes: Number.isFinite(Number(f.bytes)) ? Math.max(0, Math.round(Number(f.bytes))) : 0,
    });
    if (out.length >= TURN_FILES_MAX) break;
  }
  return out;
}

/** What the person picked and typed in a drawing (experience/bots/show.ts): the bot turn it answers, and the screen's values. */
export interface Picks { turn: string; values: unknown }

/** Most turns handed back at once - to the page, and to the model as history. Nothing is deleted at this number. */
export const CHAT_KEEP = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one word a slug, a colour or an id may be, read back off a row: a row is data, like anything else kept. */
const word = (v: unknown, re: RegExp, most: number): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length <= most && re.test(s) ? s : "";
};
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]+$/;

/** Who answered, as the row kept it: nothing is drawn from it unless all three parts are what they should be. */
function byOf(v: unknown): TurnBy | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const slug = word(o.slug, SLUG_RE, 40), color = word(o.color, COLOUR_RE, 7);
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return slug && name && color ? { slug, name, color } : null;
}

/** What the answer left to do, as the row kept it: each part only where it is still the shape its card reads. */
function didOf(v: unknown): TurnDid | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const job = word(o.job, ID_RE, 64), finds = word(o.finds, ID_RE, 64), routine = typeof o.routine === "string" ? o.routine.slice(0, 4000) : "";
  const upi = typeof o.upi === "string" && /^upi:\/\//i.test(o.upi) ? o.upi.slice(0, 1000) : "";
  const needs = Number.isFinite(o.needs) ? Math.max(0, Math.min(99, Math.round(o.needs as number))) : 0;
  const did: TurnDid = { ...(job ? { job } : {}), ...(upi ? { upi } : {}), ...(finds ? { finds } : {}), ...(needs ? { needs } : {}), ...(routine ? { routine } : {}) };
  return Object.keys(did).length ? did : null;
}

function turnOf(r: ChatTurnRow): ChatTurn {
  const show = r.role === "bot" ? keptShown(r.extra?.show) : null;
  const by = r.role === "bot" ? byOf(r.extra?.by) : null;
  const did = r.role === "bot" ? didOf(r.extra?.did) : null;
  const forName = typeof r.extra?.forName === "string" ? r.extra.forName.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  const files = r.role === "me" ? filesOf(r.extra?.files) : [];
  const images = r.role === "bot" ? imagesOf(r.extra?.images) : [];
  return {
    id: r.id, role: r.role, text: r.text, at: Number(r.at_ms) || 0,
    ...(r.session_id ? { session: r.session_id } : {}),
    opens: r.extra?.opens ?? [], approvals: r.extra?.approvals ?? [], paise: r.extra?.paise ?? 0, ...(show ? { show } : {}),
    ...(by ? { by } : {}), ...(did ? { did } : {}), ...(forName ? { forName } : {}), ...(files.length ? { files } : {}),
    ...(images.length ? { images } : {}),
  };
}

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
   * `o.picks`: the person answered a drawing of one of this bot's turns instead of typing; their message is what they picked, in words.
   */
  async send(userId: string, slug: string, message: unknown, signal?: AbortSignal, attached: Array<{ name: string; kind: string; text: string }> = [],
    live: Pick<AskInput, "onText" | "onReset" | "emit"> = {}, o: { call?: boolean; picks?: Picks; session?: string | null } = {}): Promise<{ answer: BotAnswer; turns: ChatTurn[] }> {
    const check = (m: unknown): string => {
      if (typeof m !== "string" || !m.trim()) throw new BotError("bad_request", "Type what you want to ask first.");
      if (m.length > LIMITS.message) throw new BotError("too_large", `A message may be ${LIMITS.message} characters at most.`, 413);
      return m;
    };
    if (!o.picks) check(message);
    const found = await this.bots.resolve(userId, slug);
    if (!found) throw new BotError("not_found", "There is no such bot.", 404);
    if (found.def.slug === "code") throw new BotError("code_bot", "Xode answers on its own page.", 409);
    const said = check(o.picks ? await this.picked(userId, found.def.slug, o.picks) : message).trim();
    const before = await this.recent(userId, found.def.slug, LIMITS.history.turns);
    const history = before.map((t) => ({ role: t.role === "me" ? "user" as const : "assistant" as const, content: t.text.slice(0, LIMITS.history.chars) }));
    const answer = await this.bots.ask(userId, found.def.slug, { message: said, history, ...(signal ? { signal } : {}), ...(attached.length ? { attached } : {}), ...live, ...(o.call ? { call: true as const } : { draw: true as const }) });
    const at = this.now();
    const session = await this.sessionFor(userId, found.def.slug, said, o.session);
    const mine: ChatTurnRow = { id: randomUUID(), user_id: userId, bot: found.def.slug, session_id: session, role: "me", text: said, extra: {}, at_ms: at };
    const theirs: ChatTurnRow = {
      id: randomUUID(), user_id: userId, bot: found.def.slug, session_id: session, role: "bot", text: answer.text, at_ms: at + 1,
      extra: {
        ...(answer.opens.length ? { opens: answer.opens.slice(0, 6) } : {}),
        ...(answer.approvals.length ? { approvals: answer.approvals.slice(0, 6).map((a) => ({ taskId: a.taskId, connector: a.connector, preview: a.preview })) } : {}),
        paise: answer.paise,
        ...(answer.show ? { show: answer.show } : {}),
      },
    };
    await this.turns.insert(mine);
    await this.turns.insert(theirs);
    await this.sessions.touch(userId, session, said);
    return { answer, turns: [turnOf(mine), turnOf(theirs)] };
  }

  /**
   * ONE TURN OF TALK'S THREAD, KEPT AFTER THE DOOR HAS ANSWERED (docs/talk-door.md).
   *
   * Talk is not a bot's chat: a message there goes through the front door, which picks the bot, does the work and gives
   * back what it did (routes/bots/botsTalk.ts). The asking has happened by the time this is called, so this does NOT ask
   * a model, does not read the history and does not touch a budget — it keeps the pair of turns so the one thread can be
   * drawn, with `by` saying which bot answered and `did` what it left to do.
   *
   * Both turns go in under the slug Talk's thread is kept under, whoever answered, because that is what makes it ONE
   * conversation: the person's next message is read against the whole thread and not against whichever bot spoke last.
   */
  async keepDoor(userId: string, slug: string, o: {
    /** `show` is whatever the door handed back: it goes through the checker here, as a drawing read off a row does. */
    said: string; text: string; by?: TurnBy | null; did?: TurnDid | null; show?: unknown; forName?: string; session?: string | null;
    /** What the person sent with their words. With files, the words may be empty: a photo on its own is a message. */
    files?: unknown;
    /** Pictures the bot made as its answer. */
    images?: unknown;
  }): Promise<ChatTurn[]> {
    const said = String(o.said ?? "").trim().slice(0, LIMITS.message);
    const files = filesOf(o.files);
    if (!said && !files.length) throw new BotError("bad_request", "Type what you want first.");
    const bot = slug.toLowerCase();
    const at = this.now();
    // A thread named by a photo alone is named for what was sent.
    const label = said || (files.length === 1 ? files[0]!.name : `${files.length} files`);
    const session = await this.sessionFor(userId, bot, label, o.session);
    const forName = String(o.forName ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const show = keptShown(o.show);
    const by = byOf(o.by);
    const did = didOf(o.did);
    const images = imagesOf(o.images);
    const mine: ChatTurnRow = {
      id: randomUUID(), user_id: userId, bot, session_id: session, role: "me", text: said,
      extra: { ...(forName ? { forName } : {}), ...(files.length ? { files } : {}) }, at_ms: at,
    };
    const theirs: ChatTurnRow = {
      id: randomUUID(), user_id: userId, bot, session_id: session, role: "bot", text: String(o.text ?? "").slice(0, LIMITS.message), at_ms: at + 1,
      extra: { ...(by ? { by } : {}), ...(did ? { did } : {}), ...(show ? { show } : {}), ...(forName ? { forName } : {}), ...(images.length ? { images } : {}) },
    };
    await this.turns.insert(mine);
    // The answer's turn is kept even when it has no words of its own: a job started or a payment filled in IS the answer,
    // and its card is on that turn. A turn with neither words nor anything done is the one case there is nothing to keep.
    const empty = !theirs.text.trim() && !by && !did && !show && !images.length;
    if (!empty) await this.turns.insert(theirs);
    await this.sessions.touch(userId, session, label);
    return empty ? [turnOf(mine)] : [turnOf(mine), turnOf(theirs)];
  }

  /**
   * A bot turn that no message asked for: what Nudj said when a call was answered (botsBots/planCall.ts), or a routine's answer
   * (routines/service.ts `told`). The chat page then shows how it began, and the history gives the person's next words ("move it")
   * their subject. `quiet` leaves the push alone.
   *
   * `extra` is what a turn of `send()`'s carries: the changes waiting for a yes, the links to finish in another app, and what it
   * cost. A routine's answer passes its own, so the turn the push opens shows the same confirm card the app would — without it, the
   * obvious reply ("yes") could only start a fresh turn, and make a second card.
   */
  async note(userId: string, slug: string, text: string, o: { quiet?: boolean; extra?: ChatTurnRow["extra"] } = {}): Promise<void> {
    const said = String(text ?? "").trim();
    if (!said) return;
    const bot = slug.toLowerCase();
    const extra: ChatTurnRow["extra"] = {
      ...(o.extra?.opens?.length ? { opens: o.extra.opens.slice(0, 6) } : {}),
      ...(o.extra?.approvals?.length ? { approvals: o.extra.approvals.slice(0, 6) } : {}),
      ...(typeof o.extra?.paise === "number" ? { paise: o.extra.paise } : {}),
    };
    // Every turn belongs to a session, and nothing is deleted: the branch that brought sessions retired the pruning this
    // used to do, so CHAT_KEEP is now only how many are handed back. `extra` is kept - the branch sent none and lost the
    // turn's opens, approvals and cost with it.
    const session = await this.sessionFor(userId, bot, said, null);
    await this.turns.insert({ id: randomUUID(), user_id: userId, bot, session_id: session, role: "bot", text: said.slice(0, LIMITS.message), extra, at_ms: this.now() });
    await this.sessions.touch(userId, session, "");
    // A bot that spoke first invites an answer: its push carries a Reply box, so the person answers without opening the app
    // (src/bots/notifyReply.ts). `quiet` is for a turn the person is already hearing, like a call's opening line.
    if (!o.quiet) botSaid(userId, bot, said);
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

  /** Every link a bot opened for the person (a booking, a route), newest first: Nomaz's trip reads them. */
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

  /**
   * What the person picked and typed in a drawing, as their words — for a caller that then sends them itself.
   *
   * Talk needs this: a choice drawn under one of its turns has to go back through the DOOR (the bot that drew it is not
   * the thread's slug, and might not be the one that should answer what was picked), and the door takes a message. So
   * the picks become words here, exactly as they do for a bot's own chat, and the door reads them like anything typed
   * (docs/show.md section 3).
   */
  async wordsOfPicks(userId: string, slug: string, picks: Picks): Promise<string> {
    return this.picked(userId, slug.toLowerCase(), picks);
  }

  /** What the person picked and typed in a drawing of one of their own turns with this bot, as their words. */
  private async picked(userId: string, slug: string, picks: Picks): Promise<string> {
    const id = typeof picks?.turn === "string" ? picks.turn : "";
    const row = UUID.test(id) ? (await this.turns.select({ id, user_id: userId, bot: slug }, { limit: 1 }))[0] : undefined;
    const show = row?.role === "bot" ? keptShown(row.extra?.show) : null;
    if (!show) throw new BotError("not_found", "That answer can't be answered any more. Type it instead.", 404);
    const words = wordsOf(show, picks.values);
    if (!words) throw new BotError("bad_request", "Pick or fill in something first.");
    return words;
  }

}

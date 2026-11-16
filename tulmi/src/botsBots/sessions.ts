/**
 * SESSIONS: one conversation with one bot, and everything made in it (migration 0102, docs/bots.md).
 *
 *   current(user, bot)        the session a new word belongs to: the one last touched, or a fresh one
 *   open(user, bot, title?)   a new one, whatever is open (the + on the bot's page)
 *   list(user, bot, limit)    newest first, for the bot's page
 *   get / touch / name / frame
 *
 * A session never closes. Coming back to it a month later carries on where it stopped, and the screen draws a dotted line across the gap
 * (GAP_MS). That is the whole rule: the person decides when a new one starts, by pressing +; everything else continues the last.
 *
 * `frame` is the media key of the picture a session's row shows - a picture it made, or a frame from one of its films. It is chosen once
 * and kept, and chosen again whenever the session makes something new, so a row stays recognisable between visits without going stale.
 */
import { randomUUID } from "node:crypto";
import { table, type Table } from "./rows.js";

export interface SessionRow {
  [k: string]: unknown;
  id: string;
  user_id: string;
  bot: string;
  title: string;
  frame: string | null;
  started_ms: number;
  touched_ms: number;
}

export interface Session {
  id: string;
  bot: string;
  title: string;
  frame: string | null;
  startedAt: number;
  touchedAt: number;
}

/** A silence longer than this, and the screen draws a dotted line: the session was picked up again. */
export const GAP_MS = 6 * 3_600_000;
/** How many a bot's page strings on its thread. Everything older is kept, and found by searching. */
export const THREAD_KEEP = 45;
const TITLE_MAX = 120;

const sessionOf = (r: SessionRow): Session => ({
  id: r.id, bot: r.bot, title: r.title ?? "", frame: r.frame ?? null,
  startedAt: Number(r.started_ms) || 0, touchedAt: Number(r.touched_ms) || 0,
});

/** The first words of a session, as its name: one line, no quotes, cut at a word. */
export function nameFrom(said: string): string {
  const t = String(said ?? "").replace(/\s+/g, " ").trim().replace(/^["“”']+|["“”']+$/g, "");
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX);
  const at = cut.lastIndexOf(" ");
  return `${at > 40 ? cut.slice(0, at) : cut}…`;
}

export class Sessions {
  constructor(
    private readonly now: () => number = Date.now,
    private readonly rows: Table<SessionRow> = table<SessionRow>("bot_sessions"),
  ) {}

  /** Newest first. Two touched in the same millisecond are ordered by which began last, so a session just opened is always the current one. */
  async list(userId: string, bot: string, limit = THREAD_KEEP): Promise<Session[]> {
    const found = await this.rows.select({ user_id: userId, bot: bot.toLowerCase() }, { order: "touched_ms", desc: true, limit });
    return found.map(sessionOf).sort((a, b) => b.touchedAt - a.touchedAt || b.startedAt - a.startedAt);
  }

  async get(userId: string, id: string): Promise<Session | null> {
    const [found] = await this.rows.select({ user_id: userId, id }, { limit: 1 });
    return found ? sessionOf(found) : null;
  }

  /**
   * A new session, whatever is open: the + on the bot's page. It is always the latest, by definition - so where the clock has not moved
   * since the last one was touched (two in the same millisecond), it is put one ahead rather than left to an arbitrary order.
   */
  async open(userId: string, bot: string, title = ""): Promise<Session> {
    const [last] = await this.list(userId, bot, 1);
    const at = Math.max(this.now(), (last?.touchedAt ?? 0) + 1);
    const row: SessionRow = {
      id: randomUUID(), user_id: userId, bot: bot.toLowerCase(), title: nameFrom(title), frame: null, started_ms: at, touched_ms: at,
    };
    await this.rows.insert(row);
    return sessionOf(row);
  }

  /** The session a word said now belongs to: the one last touched, or a new one if the bot has none. */
  async current(userId: string, bot: string, said = ""): Promise<Session> {
    const [last] = await this.list(userId, bot, 1);
    if (last) return last;
    return this.open(userId, bot, said);
  }

  /** Marks a session as still going, and names it from the first words if it has no name yet. */
  async touch(userId: string, id: string, said = ""): Promise<void> {
    const patch: Partial<SessionRow> = { touched_ms: this.now() };
    const now = await this.get(userId, id);
    if (now && !now.title && said.trim()) patch.title = nameFrom(said);
    await this.rows.update({ user_id: userId, id }, patch);
  }

  /** The frame its row shows, chosen again whenever the session makes something new. */
  async frame(userId: string, id: string, key: string | null): Promise<void> {
    await this.rows.update({ user_id: userId, id }, { frame: key });
  }

  async name(userId: string, id: string, title: string): Promise<void> {
    await this.rows.update({ user_id: userId, id }, { title: nameFrom(title) });
  }

  /** Everything of a person's, for the account's deletion. */
  async forAccountDelete(userId: string): Promise<void> {
    await this.rows.remove({ user_id: userId });
  }
}

let shared: Sessions | null = null;
export const sessions = (): Sessions => (shared ??= new Sessions());
/** Tests put their own in. */
export const setSessions = (s: Sessions | null): void => { shared = s; };

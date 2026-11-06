/**
 * PLAN EASE ON A COMPUTER THAT IS IN USE (design A4 "Desktop", B11; the desktop's src/main/notices.js). The phone gets Plan Ease's
 * pushes. A desktop that shows notices gets the same ones as its own notifications while the person is at it, and the phone's copy
 * then comes without a sound, so nothing rings twice.
 *
 * WHO IS AT A COMPUTER. A desktop's main process keeps a live socket of its own (routes/app/live.ts) and, once signed in, says:
 *
 *   { type: "notices", v: 1, buttons }   this socket shows notices (buttons: a Mac, whose notifications can carry them)
 *   { type: "here", idleMs }             how long since the person last used it: at once, then every minute, and on unlock or wake
 *   { type: "here", away: true }         the screen locked, or it is going to sleep
 *
 * Kept per socket, in memory only: when it was last used is never stored, never logged, and gone with the socket. deskHere() is true
 * while one of the person's sockets shows notices, was used in the last 10 minutes and is not away.
 *
 * WHAT IT HEARS, on the topic "notice" (the second exception to bus.ts's "a hint, never the content", after ask:<id>): the push's own
 * words, already lock-safe (botsBots/planSafe.ts: no amount, a health title as "Appointment", nobody else's words), to that one person.
 *
 *   { id, kind, title, body, screenId, params, item?, category?, silent, until }   shown, or put in place of the one with the same id
 *   { id, gone: true }                                                             answered somewhere: taken off that screen too
 *
 * The id is the item its buttons answer (widgets/items.ts), so an answer anywhere (the act door) can take it off; a push with no item
 * has its own claim's key. The push engine decides once for both copies (push/engine.ts deliver): "What pings you" (a "drop" sends
 * neither, quiet hours make both silent), the claim, and Plan Ease's daily cap and merging, which come before it is asked.
 *
 * ONE PROCESS: like the bus, the sockets this knows are this process's. With several, share it where the bus gets its relay.
 */
import { live, type LiveBus } from "./bus.js";

export const NOTICE_TOPIC = "notice";
/** "Used in the last 10 minutes" (design A4). */
export const HERE_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const NOTICE_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

interface Seat { buttons: boolean; usedAt: number | null; away: boolean }

/** Per person, per socket. */
const seats = new Map<string, Map<object, Seat>>();

export interface DeskSeat {
  /** "here": idle this long (ms), or away (null). */
  here(idleMs: number | null, now?: number): void;
  /** The socket closed. */
  close(): void;
}

/** A signed-in socket said it shows notices. Saying it again changes only whether it has buttons. */
export function openSeat(userId: string, socket: object, o: { buttons: boolean }): DeskSeat {
  let mine = seats.get(userId);
  if (!mine) seats.set(userId, (mine = new Map()));
  const had = mine.get(socket);
  const seat: Seat = had ? { ...had, buttons: o.buttons } : { buttons: o.buttons, usedAt: null, away: false };
  mine.set(socket, seat);
  return {
    here(idleMs, now = Date.now()) {
      const s = seats.get(userId)?.get(socket);
      if (!s) return;
      if (idleMs === null) { s.away = true; return; }
      const idle = Number.isFinite(idleMs) ? Math.max(0, Math.min(DAY_MS, idleMs)) : DAY_MS;
      s.away = false;
      s.usedAt = now - idle;
    },
    close() {
      const m = seats.get(userId);
      if (!m) return;
      m.delete(socket);
      if (!m.size) seats.delete(userId);
    },
  };
}

/** A computer of theirs shows notices, was used in the last 10 minutes, and isn't locked or asleep. */
export function deskHere(userId: string, now = Date.now()): boolean {
  for (const s of seats.get(userId)?.values() ?? []) {
    if (!s.away && s.usedAt !== null && now - s.usedAt <= HERE_MS) return true;
  }
  return false;
}

/** For tests. */
export function resetSeatsForTests(): void { seats.clear(); }

/** The notice's id: the item its buttons answer, else the claim's key, in the characters an id may hold. */
export function noticeIdOf(item: string | null | undefined, key: string): string {
  if (item && NOTICE_ID.test(item)) return item;
  const k = key.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160);
  return k || "notice";
}

export interface Notice {
  id: string; kind: string; title: string; body: string;
  screenId: string; params: Record<string, string>;
  item?: string; category?: string; silent: boolean; until: number;
}

/** Shown on the person's computers that show notices (only those sockets listen for it). */
export function sendNotice(userId: string, n: Notice, bus: LiveBus = live): void {
  bus.publish([userId], NOTICE_TOPIC, { ...n });
}

/** Answered somewhere (the act door): taken off their computers too. */
export function noticeGone(userId: string, item: string, bus: LiveBus = live): void {
  if (!NOTICE_ID.test(item)) return;
  bus.publish([userId], NOTICE_TOPIC, { id: item, gone: true });
}

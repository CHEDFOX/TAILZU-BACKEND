/**
 * CALLS (src/rooms, docs/rooms.md): our own video and audio rooms. LiveKit carries the video and the sound; the rooms, their links, the lobby
 * and who may join are ours. X0 Bot's apps join from their own call screen with a host's pass; anyone with a call's link asks to come in and
 * waits for the host, unless the host lets people straight in.
 *
 * The host's, inside their own account (a room that is not theirs is null, as one that isn't there):
 *   make(user, { title, host, businessId? })   a room and its link (the mail bot's routes make its calls, with the business's name)
 *   list(user, { businessId? })                newest first
 *   room(user, id)                             one, with who is in and who waits
 *   join(user, id, name)                       a host's pass; LiveKit's room made if it isn't yet
 *   admit(user, id, knock) / deny(...)         someone at the door let in, or not
 *   remove(user, id, identity)                 someone sent away from the call (and never given another pass by that knock)
 *   set(user, id, { lobby?, title? })          the lobby turned off lets in whoever waits
 *   end(user, id)                              ended for everyone: the link stops working
 *
 * The link's, for anyone holding it:
 *   guest(code)          what it shows first: whose call, its title, whether it is on and full
 *   knock(code, name)    asks to come in -> waiting (the host is told), or straight in with a pass when the lobby is off
 *   answer(code, key)    waiting, let in (a pass), not let in, or gone
 *
 * LiveKit's webhook (onWebhook): who joins and leaves, a room closed. Each time people are in a room is a session, kept on the row: the
 * minutes, and the day's minutes a person's rooms may hold (ROOM_DAILY_MINUTES; over it nobody new comes in, and the tick closes a call).
 *
 * The tick, every minute: a call longer than 4 hours closed, a person's calls over the day's minutes closed, a room unused for 30 days ended,
 * the lobby swept.
 *
 * Nothing said in a call reaches this server: the video and the sound go between the apps and LiveKit. A push says who waits, never more.
 */
import { createHash, randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { botTopic, roomTopic } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { pushEngine } from "../push/index.js";
import { codeOf, hashOf, linkOf, newCode, sealer, type Sealer } from "./link.js";
import { livekit, livekitKeys, passFor, type Livekit, type LivekitKeys } from "./livekit.js";
import { Lobby, type Knock } from "./lobby.js";
import { roomStore, SESSIONS_MAX, type Room, type RoomPatch, type RoomStore, type Session } from "./store.js";
import { RoomsError, type GuestRoomView, type KnockAnswer, type PassView, type PersonView, type RoomView } from "./types.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** A pass only has to last until the app or the page has connected; LiveKit keeps a connected one fresh. */
const HOST_PASS_SEC = 10 * 60;
const GUEST_PASS_SEC = 5 * 60;
/** One call is closed after this long (the link still works for the next). */
export const SESSION_MAX_MS = 4 * HOUR;
/** A room nobody used for this long is ended. */
export const UNUSED_MS = 30 * DAY;
/** A person makes at most this many rooms a day. */
export const MADE_PER_DAY = 100;
/** The host is told someone waits at most this often per room. */
const TELL_EVERY_MS = 2 * MIN;
/** LiveKit's room is made at most once a minute per room (it answers the same room after). */
const ENSURED_MS = MIN;
const TITLE_MAX = 120;
export const NAME_MAX = 60;
const LIST_MAX = 50;
const SEEN_MAX = 2_000;

export type RoomPushKind = "room_waiting";
export type RoomNotify = (userId: string, msg: { kind: RoomPushKind; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;

/** LiveKit's name for one of our rooms, and back. */
export const lkName = (id: string): string => `x0-${id}`;
const idOfLk = (name: unknown): string | null => (typeof name === "string" ? /^x0-([0-9a-f-]{36})$/.exec(name)?.[1] ?? null : null);

/** A host's identity in a call: the same in every call of theirs, and never their account's id. */
export const hostIdentity = (userId: string): string => `h_${createHash("sha256").update(`x0-room-host:${userId}`).digest("hex").slice(0, 16)}`;

/** A name or a title as kept: one line, no control characters or angle brackets, cut to max. */
export function cleanName(s: unknown, max: number = NAME_MAX): string {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
}

const sessionMs = (s: Session, now: number): number => Math.max(0, (s.end ?? now) - s.start);

/** Minutes people were in the room, every time together. */
export function minutesOf(r: Room, now: number): number {
  return r.pastMinutes + Math.round(r.sessions.reduce((a, s) => a + sessionMs(s, now), 0) / MIN);
}

/** Minutes these rooms held in the 24 hours before now. */
export function minutesToday(rooms: readonly Room[], now: number): number {
  const from = now - DAY;
  let ms = 0;
  for (const r of rooms) for (const s of r.sessions) ms += Math.max(0, Math.min(s.end ?? now, now) - Math.max(s.start, from));
  return Math.floor(ms / MIN);
}

/** A session begun (unless one is going on), the oldest falling off into pastMinutes. */
function opened(r: Room, now: number): Pick<RoomPatch, "sessions" | "pastMinutes"> {
  const last = r.sessions[r.sessions.length - 1];
  if (last && last.end === null) return {};
  const sessions = [...r.sessions, { start: now, end: null }];
  let past = r.pastMinutes;
  while (sessions.length > SESSIONS_MAX) past += Math.round(sessionMs(sessions.shift()!, now) / MIN);
  return { sessions, pastMinutes: past };
}

/** The session going on, ended. */
function closed(r: Room, now: number): Pick<RoomPatch, "sessions"> {
  const last = r.sessions[r.sessions.length - 1];
  if (!last || last.end !== null) return {};
  return { sessions: [...r.sessions.slice(0, -1), { start: last.start, end: Math.max(last.start, now) }] };
}

const lastAtOf = (r: Room): number => {
  const s = r.sessions[r.sessions.length - 1];
  return s ? (s.end ?? s.start) : r.createdAt;
};

const roleOf = (identity: string): PersonView["role"] => (identity.startsWith("h_") ? "host" : identity.startsWith("g_") ? "guest" : "other");

export interface RoomDeps {
  store: RoomStore;
  livekit: Livekit;
  keys: Pick<LivekitKeys, "key" | "secret">;
  lobby?: Lobby;
  sealer?: Sealer;
  notify?: RoomNotify;
  /** Live updates to the host's screens (live/writes.ts livePublish when not given). */
  publish?: (userId: string, topics: string[]) => void;
  now?: () => number;
  maxPeople?: number;
  dailyMinutes?: number;
  linkOrigin?: string;
}

export class RoomService {
  private readonly store: RoomStore;
  private readonly lk: Livekit;
  private readonly keys: Pick<LivekitKeys, "key" | "secret">;
  private readonly lobby: Lobby;
  private readonly sealer: Sealer;
  private readonly notify: RoomNotify;
  private readonly publish: (userId: string, topics: string[]) => void;
  private readonly now: () => number;
  private readonly maxPeople: number;
  private readonly dailyMinutes: number;
  private readonly linkOrigin: string | undefined;
  private readonly ensured = new Map<string, number>();
  private readonly told = new Map<string, number>();
  private readonly seen = new Set<string>();

  constructor(d: RoomDeps) {
    this.store = d.store;
    this.lk = d.livekit;
    this.keys = d.keys;
    this.now = d.now ?? Date.now;
    this.lobby = d.lobby ?? new Lobby(this.now);
    this.sealer = d.sealer ?? sealer();
    this.notify = d.notify ?? (async () => undefined);
    this.publish = d.publish ?? livePublish;
    const cfg = d.maxPeople && d.dailyMinutes && d.linkOrigin ? null : getConfig();
    this.maxPeople = d.maxPeople ?? cfg!.ROOM_MAX_PEOPLE;
    this.dailyMinutes = d.dailyMinutes ?? cfg!.ROOM_DAILY_MINUTES;
    this.linkOrigin = d.linkOrigin;
  }

  // ------------------------------------------------------------------------------------------------------------------- the host's

  async make(userId: string, input: { title?: unknown; host: string; businessId?: string | null }): Promise<RoomView> {
    const host = cleanName(input.host) || "X0 Bot";
    const title = cleanName(input.title, TITLE_MAX) || `A call with ${host}`;
    const now = this.now();
    const recent = await this.store.list(userId, { limit: MADE_PER_DAY + 1 });
    if (recent.filter((r) => now - r.createdAt < DAY).length >= MADE_PER_DAY) {
      throw new RoomsError(429, "That's a lot of calls for one day. Try again tomorrow.", "room_many");
    }
    for (let tries = 0; ; tries++) {
      const code = newCode();
      const r: Room = {
        id: randomUUID(), userId, codeHash: hashOf(code), codeEnc: this.sealer.seal(code), businessId: input.businessId ?? null, host, title,
        lobby: true, status: "open", people: [], sessions: [], pastMinutes: 0, createdAt: now, updatedAt: now, endedAt: null,
      };
      try {
        await this.store.add(r);
        return this.view(r);
      } catch (err) {
        if (tries < 2 && /code taken/.test((err as Error)?.message ?? "")) continue;
        throw err;
      }
    }
  }

  async list(userId: string, o: { businessId?: string } = {}): Promise<RoomView[]> {
    return (await this.store.list(userId, { ...o, limit: LIST_MAX })).map((r) => this.view(r));
  }

  async room(userId: string, id: string): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    return r ? this.view(r) : null;
  }

  /** The host's pass. Their name in the call is theirs ("Aanya"), else the room's host ("Leaf & Co"). */
  async join(userId: string, id: string, name?: string): Promise<PassView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    this.open(r);
    const identity = hostIdentity(userId);
    if (!r.people.some((p) => p.identity === identity)) {
      if (r.people.length >= this.maxPeople) throw full();
      await this.underCap(r.userId);
    }
    await this.ensure(r);
    return this.pass(r, { identity, name: cleanName(name) || r.host, host: true }, HOST_PASS_SEC);
  }

  async admit(userId: string, id: string, knockId: string): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    this.open(r);
    const waiting = this.lobby.waiting(r.id);
    if (!waiting.some((k) => k.id === knockId)) throw gone();
    if (r.people.length >= this.maxPeople) throw full();
    this.lobby.decide(r.id, knockId, true);
    this.changed(r);
    return this.view(r);
  }

  async deny(userId: string, id: string, knockId: string): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    if (!this.lobby.decide(r.id, knockId, false)) throw gone();
    this.changed(r);
    return this.view(r);
  }

  async remove(userId: string, id: string, identity: string): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    if (identity === hostIdentity(userId)) throw new RoomsError(400, "To leave, end the call or hang up.", "bad_request");
    this.lobby.sendAway(r.id, identity);
    await this.lk.removeParticipant(lkName(r.id), identity);
    const next = await this.store.update(r.id, { people: r.people.filter((p) => p.identity !== identity) }) ?? r;
    this.changed(next);
    return this.view(next);
  }

  async set(userId: string, id: string, patch: { lobby?: boolean; title?: unknown }): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    const p: RoomPatch = {};
    if (typeof patch.lobby === "boolean") p.lobby = patch.lobby;
    if (patch.title !== undefined) p.title = cleanName(patch.title, TITLE_MAX) || r.title;
    const next = await this.store.update(r.id, p) ?? r;
    // No lobby any more: whoever waits comes in, as many as there is room for.
    if (p.lobby === false) {
      let room = this.maxPeople - next.people.length;
      for (const k of this.lobby.waiting(r.id)) if (room-- > 0) this.lobby.decide(r.id, k.id, true);
    }
    this.changed(next);
    return this.view(next);
  }

  async end(userId: string, id: string): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    return this.view(await this.finish(r));
  }

  /** Every call of theirs closed at LiveKit, before the account goes. Best effort: it never throws. The rows go with the account. */
  async forAccountDelete(userId: string): Promise<void> {
    let all: Room[];
    try { all = await this.store.list(userId, { limit: 200 }); } catch { return; }
    for (const r of all) {
      this.lobby.forget(r.id);
      if (r.status === "live") await this.lk.deleteRoom(lkName(r.id)).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- the link's

  async guest(rawCode: string): Promise<GuestRoomView | null> {
    const r = await this.byCode(rawCode);
    if (!r) return null;
    return { title: r.title, host: r.host, status: r.status, lobby: r.lobby, full: r.people.length >= this.maxPeople };
  }

  async knock(rawCode: string, rawName: unknown): Promise<KnockAnswer | null> {
    const r = await this.byCode(rawCode);
    if (!r) return null;
    this.open(r);
    const name = cleanName(rawName);
    if (!name) throw new RoomsError(400, "Type your name, so they know who is asking to join.", "bad_request");
    if (r.people.length >= this.maxPeople) throw full();
    // The host's day's minutes are theirs to know: a guest is only told the call can't take them.
    await this.underCap(r.userId).catch((err: unknown) => {
      throw err instanceof RoomsError && err.code === "room_minutes" ? new RoomsError(503, "This call can't take anyone more today.", "room_minutes") : err;
    });
    const k = this.lobby.knock(r.id, name);
    if (!r.lobby) {
      this.lobby.decide(r.id, k.id, true);
      this.changed(r);
      return { knock: k.key, state: "admitted", pass: await this.guestPass(r, k) };
    }
    this.changed(r);
    await this.tellHost(r, k);
    return { knock: k.key, state: "waiting" };
  }

  async answer(rawCode: string, key: string): Promise<KnockAnswer> {
    const r = await this.byCode(rawCode);
    const k = this.lobby.byKey(key);
    if (!r || !k || k.roomId !== r.id || r.status === "ended") return { knock: key, state: "gone" };
    if (k.state !== "admitted") return { knock: key, state: k.state };
    return { knock: key, state: "admitted", pass: await this.guestPass(r, k) };
  }

  // ------------------------------------------------------------------------------------------------------------------- LiveKit's

  /** One webhook event, already checked as LiveKit's (routes/bots/rooms.ts). An event is processed once; a room not ours is left alone. */
  async onWebhook(body: unknown): Promise<void> {
    const ev = (body && typeof body === "object" ? body : {}) as {
      id?: unknown; event?: unknown; room?: { name?: unknown } | null; participant?: { identity?: unknown; name?: unknown } | null;
    };
    const eventId = typeof ev.id === "string" ? ev.id : "";
    if (eventId && this.seen.has(eventId)) return;
    const id = idOfLk(ev.room?.name);
    if (!id) return;
    const r = await this.store.get(id);
    if (!r || r.status === "ended") return;
    const now = this.now();
    const identity = typeof ev.participant?.identity === "string" ? ev.participant.identity.slice(0, 80) : "";
    let patch: RoomPatch | null = null;
    switch (ev.event) {
      case "participant_joined": {
        if (!identity || r.people.some((p) => p.identity === identity)) break;
        const role = roleOf(identity);
        const name = cleanName(ev.participant?.name) || (role === "host" ? r.host : "Guest");
        patch = { people: [...r.people, { identity, name, role, since: now }].slice(-100), status: "live", ...opened(r, now) };
        break;
      }
      case "participant_left": {
        if (!identity) break;
        const people = r.people.filter((p) => p.identity !== identity);
        patch = people.length ? { people } : { people, status: "open", ...closed(r, now) };
        break;
      }
      case "room_finished":
        patch = { people: [], status: "open", ...closed(r, now) };
        break;
    }
    if (patch) this.changed(await this.store.update(r.id, patch) ?? r);
    if (eventId) {
      this.seen.add(eventId);
      if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- the tick

  async tick(): Promise<void> {
    const now = this.now();
    this.lobby.sweep();
    let live: Room[] = [];
    try { live = await this.store.live(); } catch (err) { console.warn(`[rooms] tick: ${(err as Error)?.message}`); }
    const owners = new Map<string, boolean>();
    for (const r of live) {
      const current = r.sessions[r.sessions.length - 1];
      let over = !!current && current.end === null && now - current.start > SESSION_MAX_MS;
      if (!over) {
        if (!owners.has(r.userId)) {
          const theirs = await this.store.list(r.userId, { limit: 200 }).catch(() => [] as Room[]);
          owners.set(r.userId, minutesToday(theirs, now) >= this.dailyMinutes);
        }
        over = owners.get(r.userId)!;
      }
      if (!over) continue;
      // Closed at LiveKit (everyone is sent away; the link still works); the row is closed here too, so a lost webhook changes nothing.
      await this.lk.deleteRoom(lkName(r.id)).catch((err) => console.warn(`[rooms] tick: a call could not be closed: ${(err as Error)?.message}`));
      this.changed(await this.store.update(r.id, { people: [], status: "open", ...closed(r, now) }).catch(() => null) ?? r);
    }
    let stale: Room[] = [];
    try { stale = await this.store.stale(now - UNUSED_MS); } catch (err) { console.warn(`[rooms] tick: ${(err as Error)?.message}`); }
    for (const r of stale) await this.finish(r).catch(() => undefined);
    for (const [id, at] of this.ensured) if (now - at > ENSURED_MS) this.ensured.delete(id);
    for (const [id, at] of this.told) if (now - at > TELL_EVERY_MS) this.told.delete(id);
  }

  // ------------------------------------------------------------------------------------------------------------------- inside

  private async mine(userId: string, id: string): Promise<Room | null> {
    const r = await this.store.get(id);
    return r && r.userId === userId ? r : null;
  }

  private async byCode(raw: string): Promise<Room | null> {
    const code = codeOf(raw);
    return code ? this.store.byCodeHash(hashOf(code)) : null;
  }

  /** A room still going: an ended one takes nobody. */
  private open(r: Room): void {
    if (r.status === "ended") throw new RoomsError(410, "This call has ended.", "room_ended");
  }

  /** Under the day's minutes of the person whose rooms they are. */
  private async underCap(ownerId: string): Promise<void> {
    const theirs = await this.store.list(ownerId, { limit: 200 });
    if (minutesToday(theirs, this.now()) >= this.dailyMinutes) {
      throw new RoomsError(402, "Today's call minutes are used up. Calls work again as the day's minutes free up.", "room_minutes");
    }
  }

  private async ensure(r: Room): Promise<void> {
    const at = this.ensured.get(r.id);
    if (at !== undefined && this.now() - at < ENSURED_MS) return;
    await this.lk.ensureRoom(lkName(r.id), { maxPeople: this.maxPeople });
    this.ensured.set(r.id, this.now());
  }

  private async guestPass(r: Room, k: Knock): Promise<PassView> {
    await this.ensure(r);
    return this.pass(r, { identity: k.identity, name: k.name, host: false }, GUEST_PASS_SEC);
  }

  private pass(r: Room, p: { identity: string; name: string; host: boolean }, ttlSec: number): PassView {
    const sec = Math.floor(this.now() / 1000);
    return {
      url: this.lk.url,
      pass: passFor({ room: lkName(r.id), identity: p.identity, name: p.name, host: p.host, ttlSec }, this.keys, sec),
      identity: p.identity, name: p.name, room: { id: r.id, title: r.title, host: r.host }, host: p.host, expiresAt: (sec + ttlSec) * 1000,
    };
  }

  /** Ended for everyone: LiveKit's room closed, the lobby emptied, the link dead. */
  private async finish(r: Room): Promise<Room> {
    if (r.status === "ended") return r;
    const now = this.now();
    await this.lk.deleteRoom(lkName(r.id));
    this.lobby.forget(r.id);
    this.ensured.delete(r.id);
    const next = await this.store.update(r.id, { status: "ended", people: [], endedAt: now, ...closed(r, now) }) ?? r;
    this.changed(next);
    return next;
  }

  /** The host is told someone waits, unless they are in the call (their call screen shows it) or were told just now. Never more than the name. */
  private async tellHost(r: Room, k: Knock): Promise<void> {
    if (r.people.some((p) => p.role === "host")) return;
    const last = this.told.get(r.id);
    if (last !== undefined && this.now() - last < TELL_EVERY_MS) return;
    this.told.set(r.id, this.now());
    await this.notify(r.userId, {
      kind: "room_waiting", key: r.id, vars: { name: k.name, title: r.title },
      data: { r: r.id, ...(r.businessId ? { b: r.businessId } : {}) },
    }).catch(() => undefined);
  }

  private changed(r: Room): void {
    this.publish(r.userId, [roomTopic(r.id), botTopic("mail")].filter(Boolean));
  }

  private view(r: Room): RoomView {
    let code = "";
    try { code = this.sealer.open(r.codeEnc); } catch { /* a code sealed under another key: the room still works by its id */ }
    const now = this.now();
    return {
      id: r.id, title: r.title, host: r.host, link: code ? linkOf(code, this.linkOrigin) : "", code, status: r.status, lobby: r.lobby,
      people: r.people.map((p) => ({ ...p })),
      waiting: r.status === "ended" ? [] : this.lobby.waiting(r.id).map((k) => ({ id: k.id, name: k.name, since: k.at })),
      businessId: r.businessId, createdAt: r.createdAt, lastAt: lastAtOf(r), minutes: minutesOf(r, now),
    };
  }
}

const full = (): RoomsError => new RoomsError(409, "The call is full.", "room_full");
const gone = (): RoomsError => new RoomsError(404, "They're no longer waiting.", "not_found");

const defaultNotify: RoomNotify = async (userId, msg) => { await pushEngine()?.notify(userId, msg); };

let shared: RoomService | null | undefined;

/** The server's, or null when calls are not set up (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET). */
export function roomService(): RoomService | null {
  if (shared === undefined) {
    const keys = livekitKeys();
    const lk = keys ? livekit({ keys }) : null;
    shared = keys && lk ? new RoomService({ store: roomStore(), livekit: lk, keys, notify: defaultNotify }) : null;
  }
  return shared;
}

/** Calls are set up on this server. */
export const roomsOn = (): boolean => livekitKeys() !== null;

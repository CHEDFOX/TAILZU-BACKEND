/**
 * CALLS (src/rooms, docs/rooms.md): our own video and audio rooms. Cloudflare's Realtime SFU carries the video and the sound; the rooms,
 * their links, the lobby, who may join and the minutes are ours. The apps join from a call screen built as server data (the `live` block);
 * anyone with a call's link asks to come in and waits for the host, unless the host lets people straight in.
 *
 * The host's, inside their own account (a room that is not theirs is null, as one that isn't there):
 *   make(user, { title, host, businessId? })   a room and its link (the mail bot's routes make its calls, with the business's name)
 *   list(user, { businessId? })                newest first
 *   room(user, id)                             one, with who is in and who waits
 *   join(user, id, { sdp, … })                 the host takes a seat: their offer in, the answer out
 *   admit(user, id, knock) / deny(...)         someone at the door let in, or not
 *   remove(user, id, identity)                 someone sent away: their seat goes, so nobody pulls them any more
 *   set(user, id, { lobby?, title? })          the lobby turned off lets in whoever waits
 *   end(user, id)                              ended for everyone: the link stops working
 *
 * The link's, for anyone holding it:
 *   guest(code)                  what it shows first: whose call, its title, whether it is on and full
 *   knock(code, name)            asks to come in -> waiting (the host is told), or let in at once when the lobby is off
 *   knockAnswer(code, key)       waiting, let in, not let in, or gone
 *   joinAsGuest(code, key, …)    a guest that was let in takes a seat
 *
 * A SEAT is one person in one call: their session at the SFU, the tracks they send, and a bearer their app holds (kept only as a hash).
 * Everything after joining is the seat's, and needs nothing else:
 *   pull(seat, want)   someone else's tracks into their session -> the SFU's offer, when it sends one
 *   answer(seat, sdp)  the answer to that offer
 *   live(seat)         every couple of seconds: who is in, who waits, and whether they are still in the call. This is the heartbeat
 *   leave(seat)        hung up
 *
 * WHY THERE IS NO WEBHOOK. The SFU knows nothing of rooms: it moves tracks between sessions, and which sessions belong together is ours.
 * So presence is not something we are told, it is something we hold: a seat that stops calling `live` for 20 seconds is dropped by the
 * tick. That is also why a seat, not a room, is the thing the apps carry.
 *
 * The tick, every minute: seats that went quiet dropped, a call longer than 4 hours closed, a person's calls over the day's minutes
 * closed, a room unused for 30 days ended, the lobby swept.
 *
 * Nothing said in a call reaches this server: the video and the sound go between the apps and the SFU. A push says who waits, never more.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { botTopic, roomTopic } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { pushEngine } from "../push/index.js";
import { codeOf, hashOf, linkOf, newCode, sealer, type Sealer } from "./link.js";
import { Lobby, type Knock } from "./lobby.js";
import { sfu as makeSfu, sfuKeys, SDP_MAX, type Sfu } from "./sfu.js";
import { roomStore, SESSIONS_MAX, type Room, type RoomPatch, type RoomStore, type Seat, type Session } from "./store.js";
import {
  RoomsError, type GuestRoomView, type KnockAnswer, type PersonView, type PullView, type RoomStatus, type RoomView, type SeatLive,
  type SeatView,
} from "./types.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** One call is closed after this long (the link still works for the next). */
export const SESSION_MAX_MS = 4 * HOUR;
/** A room nobody used for this long is ended. */
export const UNUSED_MS = 30 * DAY;
/** A person makes at most this many rooms a day. */
export const MADE_PER_DAY = 100;
/** The host is told someone waits at most this often per room. */
const TELL_EVERY_MS = 2 * MIN;
/** A seat that has not called `live` for this long has gone (the app was killed, the phone lost the network). */
export const SEAT_QUIET_MS = 20_000;
const TITLE_MAX = 120;
export const NAME_MAX = 60;
const LIST_MAX = 50;
/** At most this many tracks pulled in one call. */
const PULL_MAX = 40;

export type RoomPushKind = "room_waiting";
export type RoomNotify = (userId: string, msg: { kind: RoomPushKind; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;

/** A host's identity in a call: the same in every call of theirs, and never their account's id. */
export const hostIdentity = (userId: string): string => `h_${createHash("sha256").update(`x0-room-host:${userId}`).digest("hex").slice(0, 16)}`;

/** The seat's bearer carries its room, so one lookup finds both. */
const newSeat = (roomId: string): string => `${roomId}.${randomBytes(24).toString("base64url")}`;
const roomOfSeat = (seat: string): string => (typeof seat === "string" ? seat.split(".")[0] ?? "" : "");
export const seatHash = (seat: string): string => createHash("sha256").update(`x0-seat:${seat}`).digest("hex");

/** The names of a person's own tracks at the SFU. */
const trackName = (identity: string, kind: "audio" | "video"): string => `${identity}-${kind}`;

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

/** A seat as everyone else sees it: never its bearer, never its session at the SFU. */
const personOf = (s: Seat): PersonView => ({
  identity: s.identity, name: s.name, role: s.role, since: s.since,
  ...(s.audio ? { audio: s.audio } : {}), ...(s.video ? { video: s.video } : {}),
});

export interface RoomDeps {
  store: RoomStore;
  sfu: Sfu;
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
  private readonly sfu: Sfu;
  private readonly lobby: Lobby;
  private readonly sealer: Sealer;
  private readonly notify: RoomNotify;
  private readonly publish: (userId: string, topics: string[]) => void;
  private readonly now: () => number;
  private readonly maxPeople: number;
  private readonly dailyMinutes: number;
  private readonly linkOrigin: string | undefined;
  private readonly told = new Map<string, number>();
  /** One change at a time per seat: the SFU answers 406 to a second offer while the first is unanswered. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(d: RoomDeps) {
    this.store = d.store;
    this.sfu = d.sfu;
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
    return r ? this.view(this.fresh(r)) : null;
  }

  /** The host takes a seat. Their name in the call is theirs ("Aanya"), else the room's host ("Leaf & Co"). */
  async join(userId: string, id: string, o: JoinInput & { name?: string }): Promise<SeatView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    return this.take(r, { identity: hostIdentity(userId), name: cleanName(o.name) || r.host, role: "host" }, o);
  }

  async admit(userId: string, id: string, knockId: string): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    this.open(r);
    if (!this.lobby.waiting(r.id).some((k) => k.id === knockId)) throw gone();
    if (this.fresh(r).people.length >= this.maxPeople) throw full();
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

  /**
   * Someone sent away. Their seat goes, so nobody pulls their tracks any more and their own app is told it is out (`live` answers gone).
   * The SFU has no way to shut a session someone else opened, so a client that ignored that would still be sending into the void: nobody
   * in the call subscribes to it.
   */
  async remove(userId: string, id: string, identity: string): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    if (identity === hostIdentity(userId)) throw new RoomsError(400, "To leave, end the call or hang up.", "bad_request");
    this.lobby.sendAway(r.id, identity);
    return this.view(await this.drop(r, (s) => s.identity === identity));
  }

  async set(userId: string, id: string, patch: { lobby?: boolean; title?: unknown }): Promise<RoomView | null> {
    const r = await this.mine(userId, id);
    if (!r) return null;
    const p: RoomPatch = {};
    if (typeof patch.lobby === "boolean") p.lobby = patch.lobby;
    if (patch.title !== undefined) p.title = cleanName(patch.title, TITLE_MAX) || r.title;
    const next = await this.store.update(r.id, p) ?? r;
    // No lobby any more: whoever waits is let in, as many as there is room for.
    if (p.lobby === false) {
      let room = this.maxPeople - this.fresh(next).people.length;
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

  /** Every call of theirs emptied, before the account goes. Best effort: it never throws. The rows go with the account. */
  async forAccountDelete(userId: string): Promise<void> {
    let all: Room[];
    try { all = await this.store.list(userId, { limit: 200 }); } catch { return; }
    const now = this.now();
    for (const r of all) {
      this.lobby.forget(r.id);
      if (r.status === "ended") continue;
      await this.store.update(r.id, { status: "ended", people: [], endedAt: now, ...closed(r, now) }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- the link's

  async guest(rawCode: string): Promise<GuestRoomView | null> {
    const r = await this.byCode(rawCode);
    if (!r) return null;
    return { title: r.title, host: r.host, status: r.status, lobby: r.lobby, full: this.fresh(r).people.length >= this.maxPeople };
  }

  async knock(rawCode: string, rawName: unknown): Promise<KnockAnswer | null> {
    const r = await this.byCode(rawCode);
    if (!r) return null;
    this.open(r);
    const name = cleanName(rawName);
    if (!name) throw new RoomsError(400, "Type your name, so they know who is asking to join.", "bad_request");
    if (this.fresh(r).people.length >= this.maxPeople) throw full();
    await this.underCap(r.userId).catch((err: unknown) => {
      throw err instanceof RoomsError && err.code === "room_minutes" ? new RoomsError(503, "This call can't take anyone more today.", "room_minutes") : err;
    });
    const k = this.lobby.knock(r.id, name);
    if (!r.lobby) this.lobby.decide(r.id, k.id, true);
    this.changed(r);
    if (r.lobby) await this.tellHost(r, k);
    return { knock: k.key, state: r.lobby ? "waiting" : "admitted" };
  }

  async knockAnswer(rawCode: string, key: string): Promise<KnockAnswer> {
    const r = await this.byCode(rawCode);
    const k = this.lobby.byKey(key);
    if (!r || !k || k.roomId !== r.id || r.status === "ended") return { knock: key, state: "gone" };
    return { knock: key, state: k.state };
  }

  /** A guest that was let in takes their seat. The knock's key is what proves it, and it is spent: one knock, one seat. */
  async joinAsGuest(rawCode: string, key: string, o: JoinInput): Promise<SeatView | null> {
    const r = await this.byCode(rawCode);
    if (!r) return null;
    const k = this.lobby.byKey(key);
    if (!k || k.roomId !== r.id || k.state !== "admitted") throw new RoomsError(403, "You haven't been let into this call yet.", "room_wait");
    if (this.fresh(r).people.some((s) => s.identity === k.identity)) throw new RoomsError(409, "You are already in this call.", "room_twice");
    return this.take(r, { identity: k.identity, name: k.name, role: "guest" }, o);
  }

  // ------------------------------------------------------------------------------------------------------------------- a seat's

  /** Someone else's tracks into this seat's session. One change at a time per seat. */
  async pull(seat: string, want: Array<{ identity: string; kind: "audio" | "video" }>): Promise<PullView> {
    return this.locked(seat, async () => {
      const { room, me } = await this.seatOf(seat);
      const people = this.fresh(room).people;
      const tracks: Array<{ sessionId: string; trackName: string }> = [];
      for (const w of want.slice(0, PULL_MAX)) {
        const them = people.find((s) => s.identity === w.identity);
        const name = them?.[w.kind];
        if (!them || !name || them.identity === me.identity) continue;
        tracks.push({ sessionId: them.sessionId, trackName: name });
      }
      if (!tracks.length) return { offer: null, mustAnswer: false, tracks: [] };
      const out = await this.sfu.pull(me.sessionId, tracks);
      return {
        offer: out.offer?.sdp ?? null,
        mustAnswer: out.mustAnswer,
        tracks: out.tracks.filter((t) => !t.error).map((t) => ({ trackName: t.trackName, ...(t.mid ? { mid: t.mid } : {}) })),
      };
    });
  }

  /** The answer to an offer the SFU sent this seat. */
  async answer(seat: string, sdp: string): Promise<void> {
    await this.locked(seat, async () => {
      const { me } = await this.seatOf(seat);
      await this.sfu.answer(me.sessionId, sdp);
    });
  }

  /**
   * The heartbeat: who is in, who waits (the host's own), and whether this seat is still in the call. A seat that stops calling this is
   * dropped by the tick, which is how someone closing their phone leaves a call.
   */
  async live(seat: string, o: { audio?: boolean; video?: boolean } = {}): Promise<SeatLive> {
    const hash = seatHash(seat);
    const room = await this.store.get(roomOfSeat(seat));
    const me = room?.people.find((s) => s.seatHash === hash);
    if (!room || !me || room.status === "ended") return { status: room?.status ?? "ended", people: [], gone: true };
    const now = this.now();
    // What they are sending can change mid-call (the camera turned off), so the heartbeat carries it.
    const next: Seat = {
      ...me, seen: now,
      ...(o.audio === undefined ? {} : o.audio ? { audio: trackName(me.identity, "audio") } : { audio: undefined }),
      ...(o.video === undefined ? {} : o.video ? { video: trackName(me.identity, "video") } : { video: undefined }),
    };
    // Whoever is calling is in the call by the fact of calling; everyone else is judged on when they last did.
    const people = room.people
      .filter((s) => s.seatHash === hash || now - s.seen <= SEAT_QUIET_MS)
      .map((s) => (s.seatHash === hash ? next : s));
    const changedWhat = me.audio !== next.audio || me.video !== next.video;
    const saved = await this.store.update(room.id, { people }) ?? { ...room, people };
    if (changedWhat || people.length !== room.people.length) this.changed(saved);
    return {
      status: saved.status,
      people: saved.people.filter((s) => s.identity !== me.identity).map(personOf),
      ...(me.role === "host" ? { waiting: this.lobby.waiting(room.id).map((k) => ({ id: k.id, name: k.name, since: k.at })) } : {}),
    };
  }

  /** Hung up. */
  async leave(seat: string): Promise<void> {
    const hash = seatHash(seat);
    const room = await this.store.get(roomOfSeat(seat));
    if (!room) return;
    await this.drop(room, (s) => s.seatHash === hash);
  }

  // ------------------------------------------------------------------------------------------------------------------- the tick

  async tick(): Promise<void> {
    const now = this.now();
    this.lobby.sweep();
    let live: Room[] = [];
    try { live = await this.store.live(); } catch (err) { console.warn(`[rooms] tick: ${(err as Error)?.message}`); }
    const owners = new Map<string, boolean>();
    for (const r of live) {
      // Seats that went quiet: the app was killed, or the phone lost the network.
      const kept = r.people.filter((s) => now - s.seen <= SEAT_QUIET_MS);
      let room = r;
      if (kept.length !== r.people.length) room = await this.settle(r, kept, now);
      if (room.status !== "live") continue;

      const current = room.sessions[room.sessions.length - 1];
      let over = !!current && current.end === null && now - current.start > SESSION_MAX_MS;
      if (!over) {
        if (!owners.has(room.userId)) {
          const theirs = await this.store.list(room.userId, { limit: 200 }).catch(() => [] as Room[]);
          owners.set(room.userId, minutesToday(theirs, now) >= this.dailyMinutes);
        }
        over = owners.get(room.userId)!;
      }
      if (over) await this.settle(room, [], now);
    }
    let stale: Room[] = [];
    try { stale = await this.store.stale(now - UNUSED_MS); } catch (err) { console.warn(`[rooms] tick: ${(err as Error)?.message}`); }
    for (const r of stale) await this.finish(r).catch(() => undefined);
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

  /** The room as it really is right now: seats that went quiet are not in the call, whatever the row still says. */
  private fresh(r: Room, now: number = this.now()): Room {
    const people = r.people.filter((s) => now - s.seen <= SEAT_QUIET_MS);
    return people.length === r.people.length ? r : { ...r, people };
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

  /** One change at a time per seat (the SFU refuses a second unanswered offer). */
  private async locked<T>(seat: string, run: () => Promise<T>): Promise<T> {
    const key = seatHash(seat);
    const before = this.locks.get(key) ?? Promise.resolve();
    // Whatever happened to the call before this one, this one still runs.
    const mine = before.then(run, run);
    const handle = mine.then(() => undefined, () => undefined);
    this.locks.set(key, handle);
    try {
      return await mine;
    } finally {
      if (this.locks.get(key) === handle) this.locks.delete(key);
    }
  }

  private async seatOf(seat: string): Promise<{ room: Room; me: Seat }> {
    const hash = seatHash(seat);
    const room = await this.store.get(roomOfSeat(seat));
    if (!room) throw new RoomsError(404, "You are not in this call.", "not_found");
    // An ended call is told apart from a seat that was sent away, so the app can say which happened.
    if (room.status === "ended") throw new RoomsError(410, "This call has ended.", "room_ended");
    const me = room.people.find((s) => s.seatHash === hash);
    if (!me) throw new RoomsError(404, "You are not in this call.", "not_found");
    return { room, me };
  }

  /** Someone takes a seat: the SFU session made, their own tracks published, the seat written. */
  private async take(r: Room, who: { identity: string; name: string; role: "host" | "guest" }, o: JoinInput): Promise<SeatView> {
    this.open(r);
    const sdp = typeof o.sdp === "string" ? o.sdp : "";
    if (!sdp || sdp.length > SDP_MAX) throw new RoomsError(400, "That call couldn't be started. Try again.", "bad_request");
    if (!o.audioMid) throw new RoomsError(400, "That call couldn't be started. Try again.", "bad_request");
    const now = this.now();
    const fresh = this.fresh(r, now);
    const already = fresh.people.find((s) => s.identity === who.identity);
    if (!already && fresh.people.length >= this.maxPeople) throw full();
    await this.underCap(r.userId);

    const sessionId = await this.sfu.newSession();
    const tracks = [
      { mid: o.audioMid, trackName: trackName(who.identity, "audio") },
      ...(o.videoMid ? [{ mid: o.videoMid, trackName: trackName(who.identity, "video") }] : []),
    ];
    const answer = await this.sfu.publish(sessionId, { type: "offer", sdp }, tracks);

    const seat = newSeat(r.id);
    const mine: Seat = {
      identity: who.identity, seatHash: seatHash(seat), sessionId, name: who.name, role: who.role,
      audio: trackName(who.identity, "audio"), ...(o.videoMid ? { video: trackName(who.identity, "video") } : {}),
      since: already?.since ?? now, seen: now,
    };
    // Someone joining again (the app was killed and reopened) replaces their own seat; the old session is left to die at the SFU.
    const people = [...fresh.people.filter((s) => s.identity !== who.identity), mine];
    const saved = await this.store.update(r.id, { people, status: "live", ...opened(fresh, now) }) ?? { ...fresh, people };
    this.changed(saved);
    return {
      seat, identity: mine.identity, name: mine.name, host: who.role === "host",
      room: { id: r.id, title: r.title, host: r.host },
      answer: answer.sdp,
      people: saved.people.filter((s) => s.identity !== who.identity).map(personOf),
    };
  }

  /** Seats taken out, and the room closed when that empties it. */
  private async drop(r: Room, which: (s: Seat) => boolean): Promise<Room> {
    const now = this.now();
    const kept = this.fresh(r, now).people.filter((s) => !which(s));
    return this.settle(r, kept, now);
  }

  /** The room written with these seats, and opened or closed as that changes. */
  private async settle(r: Room, people: Seat[], now: number): Promise<Room> {
    const empty = !people.length;
    const patch: RoomPatch = {
      people,
      ...(empty && r.status === "live" ? { status: "open" as RoomStatus, ...closed(r, now) } : {}),
      ...(!empty && r.status === "open" ? { status: "live" as RoomStatus, ...opened(r, now) } : {}),
    };
    const saved = await this.store.update(r.id, patch) ?? { ...r, ...patch };
    this.changed(saved);
    return saved;
  }

  /** Ended for everyone: the seats go, the lobby empties, the link is dead. */
  private async finish(r: Room): Promise<Room> {
    if (r.status === "ended") return r;
    const now = this.now();
    this.lobby.forget(r.id);
    const next = await this.store.update(r.id, { status: "ended", people: [], endedAt: now, ...closed(r, now) }) ?? r;
    this.changed(next);
    return next;
  }

  /** The host is told someone waits, unless they are in the call (their call screen shows it) or were told just now. Never more than the name. */
  private async tellHost(r: Room, k: Knock): Promise<void> {
    if (this.fresh(r).people.some((s) => s.role === "host")) return;
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
    const fresh = this.fresh(r, now);
    return {
      id: r.id, title: r.title, host: r.host, link: code ? linkOf(code, this.linkOrigin) : "", code, status: fresh.status, lobby: r.lobby,
      people: fresh.people.map(personOf),
      waiting: r.status === "ended" ? [] : this.lobby.waiting(r.id).map((k) => ({ id: k.id, name: k.name, since: k.at })),
      businessId: r.businessId, createdAt: r.createdAt, lastAt: lastAtOf(r), minutes: minutesOf(r, now),
    };
  }
}

/** What an app sends to take a seat: its offer, and the mids its own microphone and camera are on. */
export interface JoinInput { sdp: string; audioMid: string; videoMid?: string }

const full = (): RoomsError => new RoomsError(409, "The call is full.", "room_full");
const gone = (): RoomsError => new RoomsError(404, "They're no longer waiting.", "not_found");

const defaultNotify: RoomNotify = async (userId, msg) => { await pushEngine()?.notify(userId, msg); };

let shared: RoomService | null | undefined;

/** The server's, or null when calls are not set up (SFU_APP_ID, SFU_APP_SECRET). */
export function roomService(): RoomService | null {
  if (shared === undefined) {
    const keys = sfuKeys();
    const client = keys ? makeSfu({ keys }) : null;
    shared = client ? new RoomService({ store: roomStore(), sfu: client, notify: defaultNotify }) : null;
  }
  return shared;
}

/** Calls are set up on this server. */
export const roomsOn = (): boolean => sfuKeys() !== null;

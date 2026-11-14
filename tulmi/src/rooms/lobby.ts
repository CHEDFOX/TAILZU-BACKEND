/**
 * THE LOBBY (src/rooms, docs/rooms.md): people with a call's link who asked to come in, until its host lets them in or not. In memory: a knock
 * lasts minutes, and one lost to a restart is a guest who asks again.
 *
 *   knock(room, name)      a guest asks to come in -> the knock: its id names it to the host, its key is the guest's own to read the answer
 *                          with (random, never shown to anyone else)
 *   byKey(key)             a knock, by its guest's key, while it is kept
 *   waiting(room)          who is waiting, oldest first
 *   decide(room, id, yes)  let in, or not
 *   forget(room)           the call ended: every knock goes
 *   sweep()                a knock waiting 15 minutes, or answered 10 minutes ago, goes
 *
 * Each knock carries the identity its guest will join as ("g_" and random letters), so a guest sent away can be told apart from one let in.
 */
import { randomBytes } from "node:crypto";
import { RoomsError } from "./types.js";

export interface Knock {
  id: string;
  key: string;
  roomId: string;
  name: string;
  identity: string;
  state: "waiting" | "admitted" | "denied";
  at: number;
  decidedAt: number | null;
}

const MIN = 60_000;
/** A knock nobody answers is forgotten after this; the guest's page asks again. */
export const WAIT_MS = 15 * MIN;
/** An answer is kept this long, for the guest's page to read (and an admitted guest to get a fresh pass if the first one failed). */
export const ANSWERED_MS = 10 * MIN;
/** At most this many people wait at one call's door. */
export const WAITING_MAX = 20;
const KEPT_MAX = 5_000;

const key = (bytes: number): string => randomBytes(bytes).toString("base64url");

export class Lobby {
  private readonly knocks = new Map<string, Knock>();

  constructor(private readonly now: () => number = Date.now) {}

  knock(roomId: string, name: string): Knock {
    this.sweep();
    if (this.waiting(roomId).length >= WAITING_MAX) throw new RoomsError(429, "Too many people are waiting to join this call. Try again in a few minutes.", "room_busy");
    const k: Knock = { id: key(9), key: key(24), roomId, name, identity: `g_${key(9)}`, state: "waiting", at: this.now(), decidedAt: null };
    this.knocks.set(k.id, k);
    while (this.knocks.size > KEPT_MAX) this.knocks.delete(this.knocks.keys().next().value!);
    return { ...k };
  }

  byKey(guestKey: string): Knock | null {
    const k = [...this.knocks.values()].find((x) => x.key === guestKey);
    if (!k || this.old(k)) return null;
    return { ...k };
  }

  waiting(roomId: string): Knock[] {
    return [...this.knocks.values()].filter((k) => k.roomId === roomId && k.state === "waiting" && !this.old(k)).sort((a, b) => a.at - b.at).map((k) => ({ ...k }));
  }

  /** A knock of this room let in or not; null when it is no longer waiting there. */
  decide(roomId: string, id: string, yes: boolean): Knock | null {
    const k = this.knocks.get(id);
    if (!k || k.roomId !== roomId || this.old(k)) return null;
    if (k.state === "waiting" || (!yes && k.state === "admitted")) {
      k.state = yes ? "admitted" : "denied";
      k.decidedAt = this.now();
    }
    return { ...k };
  }

  /** The guest who joined as this identity, if they came through the lobby: sent away, so their knock gets no new pass. */
  sendAway(roomId: string, identity: string): void {
    for (const k of this.knocks.values()) {
      if (k.roomId === roomId && k.identity === identity) { k.state = "denied"; k.decidedAt = this.now(); }
    }
  }

  forget(roomId: string): void {
    for (const [id, k] of this.knocks) if (k.roomId === roomId) this.knocks.delete(id);
  }

  sweep(): void {
    for (const [id, k] of this.knocks) if (this.old(k)) this.knocks.delete(id);
  }

  private old(k: Knock): boolean {
    const t = this.now();
    return k.state === "waiting" ? t - k.at > WAIT_MS : t - (k.decidedAt ?? k.at) > ANSWERED_MS;
  }
}

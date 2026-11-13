/**
 * THE SHAPES OF CALLS (src/rooms, docs/rooms.md): what the routes answer, what the screens read, and the one error.
 */

/** open: the link works and nobody is in; live: someone is in; ended: its host ended it (or it went unused for a month), the link is dead. */
export type RoomStatus = "open" | "live" | "ended";

/** A refusal with its status and its words for a person ("The call is full."). */
export class RoomsError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) { super(message); }
}

/** Someone in the call now. */
export interface PersonView { identity: string; name: string; role: "host" | "guest" | "other"; since: number }

/** Someone waiting in the lobby to be let in. */
export interface KnockView { id: string; name: string; since: number }

/** A call as its host sees it. */
export interface RoomView {
  id: string;
  title: string;
  /** The name a guest sees as whose call it is ("Leaf & Co"). */
  host: string;
  /** x0bot.com/m/abc-defg-hij: anyone with it can ask to come in. */
  link: string;
  code: string;
  status: RoomStatus;
  /** People with the link wait for the host to let them in (the start); off, they come straight in. */
  lobby: boolean;
  people: PersonView[];
  waiting: KnockView[];
  /** The mail bot's business it was made for, if any. */
  businessId: string | null;
  createdAt: number;
  /** When someone was last in it (or when it was made). */
  lastAt: number;
  /** Minutes people have been in it, every time together. */
  minutes: number;
}

/** What an app or the page joins with: LiveKit's address and a pass for this room. */
export interface PassView {
  url: string;
  pass: string;
  identity: string;
  name: string;
  room: { id: string; title: string; host: string };
  host: boolean;
  expiresAt: number;
}

/** What a link shows before its holder asks to come in. */
export interface GuestRoomView { title: string; host: string; status: RoomStatus; lobby: boolean; full: boolean }

/** A knock's answer: waiting, let in (with the pass), not let in, or forgotten (it waited too long, or the call ended). */
export interface KnockAnswer { knock: string; state: "waiting" | "admitted" | "denied" | "gone"; pass?: PassView }

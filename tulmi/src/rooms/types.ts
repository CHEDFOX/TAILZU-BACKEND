/**
 * THE SHAPES OF CALLS (src/rooms, docs/rooms.md): what the routes answer, what the screens read, and the one error.
 */

/** open: the link works and nobody is in; live: someone is in; ended: its host ended it (or it went unused for a month), the link is dead. */
export type RoomStatus = "open" | "live" | "ended";

/** A refusal with its status and its words for a person ("The call is full."). */
export class RoomsError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) { super(message); }
}

/** Someone in the call now, as a screen and the other people see them. Never their seat or their session at the SFU. */
export interface PersonView {
  identity: string;
  name: string;
  role: "host" | "guest";
  since: number;
  /** What they are sending: the track names to pull. Absent while their camera or microphone is off. */
  audio?: string;
  video?: string;
}

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

/**
 * A seat in a call: what the app gets back when it joins, and what it holds for everything after (pull, answer, live, leave). It is a
 * bearer, so it is kept hashed on the row and never drawn on a screen.
 */
export interface SeatView {
  seat: string;
  identity: string;
  name: string;
  host: boolean;
  room: { id: string; title: string; host: string };
  /** Nothing is captured by joining: their microphone and camera stay shut until they turn one on (the seat's `publish` route). */
  /** Everyone else in the call, and what they are sending. */
  people: PersonView[];
}

/** What a seat's holder is told, every couple of seconds: who is in, who waits, and whether the call is still on. */
export interface SeatLive {
  status: RoomStatus;
  people: PersonView[];
  /** The host's own: who is at the door. A guest is sent none. */
  waiting?: KnockView[];
  /** The seat is no longer in the call (sent away, the call ended, or it timed out). */
  gone?: boolean;
}

/** Their microphone or camera turned on for the first time: the answer to the offer their new transceiver made. */
export interface PublishView { answer: string }

/** Someone else's tracks pulled into a seat's session: the SFU's offer to answer, when it sent one. */
export interface PullView {
  offer: string | null;
  /** Answer it before asking anything else of this call. */
  mustAnswer: boolean;
  /** The track names that arrived, each with the mid it is on. */
  tracks: Array<{ trackName: string; mid?: string }>;
}

/** What a link shows before its holder asks to come in. */
export interface GuestRoomView { title: string; host: string; status: RoomStatus; lobby: boolean; full: boolean }

/** A knock's answer: waiting, let in, not let in, or forgotten (it waited too long, or the call ended). */
export interface KnockAnswer { knock: string; state: "waiting" | "admitted" | "denied" | "gone" }

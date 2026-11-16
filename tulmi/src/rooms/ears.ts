/**
 * HOW THE SERVER HEARS ONE OF OUR OWN CALLS (src/rooms, docs/brief.md).
 *
 * The meeting bot hears a Google Meet through Recall, which sits in the call as a participant and sends us the words. In our
 * own rooms there is nobody to send: we ARE the SFU's customer, so Cloudflare sends us the sound itself. One WebSocket
 * adapter a person (`sfu.listen`), each carrying that one track as 48 kHz stereo PCM to an address of ours.
 *
 *   a seat turns its microphone on ──► listen(seat)      an adapter, dialling our wss:// with a token of its own
 *   Cloudflare dials that address  ──► feed(token, pcm)   stereo 48k -> mono 16k, kept in that seat's own buffer
 *   every ~25 seconds of sound     ──► a stretch written down and appended to the room's note, under that person's name
 *   the call ends                  ──► stop(room)         the adapters closed, the last stretches flushed
 *
 * ONE ADAPTER A PERSON IS THE POINT. Who said what is the hardest part of a recording, and here it is free: the track is
 * theirs, so the words are theirs. Nothing is diarized, nothing is guessed.
 *
 * WHAT IT COSTS. Cloudflare charges the adapter's traffic as ordinary egress ($0.05/GB, the first 1,000 GB free), and we
 * take 48 kHz stereo down to 16 kHz mono before anything is kept, so a speaker-minute is about 2 MB rather than 11.5.
 *
 * Everything that talks to the world is injected (the SFU, the speech service, the note, the meter, the clock), so a whole
 * call can be heard in a test with no network.
 */

import type { AudioFormat, Note, NoteSegment } from "../../../shared/types/api.js";
import { downTo16k, hasSound, monoFrom, readPacket, wavOf } from "./pcm.js";
import type { Sfu } from "./sfu.js";

/** How much sound is gathered before it is written down. Short enough to be nearly live, long enough to be a sentence. */
export const STRETCH_S = 25;
/** The most one buffer may hold before the oldest is dropped: a speech service that is down must not eat the server. */
const BUFFER_MAX_S = 180;
const RATE = 16_000;
const BYTES_S = RATE * 2;

export interface EarsDeps {
  sfu: Sfu;
  /** The public address the SFU dials for one listener's token: a wss:// of ours, reachable from the internet. */
  endpoint: (token: string) => string;
  /** A stretch written down. The same speech service everything else here uses (pipeline/stt.ts). */
  listen(audio: Buffer, format: AudioFormat, o: { language?: string }): Promise<{ text: string; durationSeconds?: number }>;
  /** What was heard, into the room's note, under the name of whoever said it. */
  heard(noteId: string, userId: string, seg: NoteSegment, seconds: number): Promise<void>;
  /**
   * The same line, to whoever is listening for its own name in the call (rooms/scribe.ts overheard). Left out: nothing
   * listens, and the words only go to the note.
   */
  line?(roomId: string, line: { who: string; text: string; at: number }): void;
  /** A token nobody can guess, for one listener. */
  token(): string;
  now(): number;
}

/** One person's ear: their adapter at the SFU, and what we have of them that is not written down yet. */
interface Listener {
  roomId: string;
  userId: string;
  noteId: string;
  /** Who is talking, as the note will name them. */
  name: string;
  adapterId: string;
  /** 16 kHz mono, waiting to be written down. */
  buffer: Buffer[];
  bytes: number;
  /** Seconds from the note's start at the first sample in the buffer. */
  at: number;
  /** A stretch is being written down now: the next packets go on waiting. */
  busy: boolean;
  closed: boolean;
}

export interface RoomEars {
  /** The note this room's words go into, and when it started. */
  noteId: string;
  userId: string;
  startedAt: number;
  listeners: Map<string, Listener>;
}

export class Ears {
  private readonly rooms = new Map<string, RoomEars>();
  private readonly byToken = new Map<string, Listener>();

  constructor(private readonly d: EarsDeps) {}

  /** This room's words go into this note from now on. */
  open(roomId: string, o: { noteId: string; userId: string; startedAt: number }): void {
    if (this.rooms.has(roomId)) return;
    this.rooms.set(roomId, { noteId: o.noteId, userId: o.userId, startedAt: o.startedAt, listeners: new Map() });
  }

  /** Whether this room is being listened to at all. */
  on(roomId: string): boolean { return this.rooms.has(roomId); }

  /**
   * One person's track, listened to. The identity is the seat's, so a second call for the same seat is the same ear: a
   * microphone turned off and on again does not make two.
   */
  async listenTo(roomId: string, o: { identity: string; name: string; sessionId: string; trackName: string }): Promise<boolean> {
    const room = this.rooms.get(roomId);
    if (!room || room.listeners.has(o.identity)) return false;
    const token = this.d.token();
    const l: Listener = {
      roomId, userId: room.userId, noteId: room.noteId, name: o.name || "Someone",
      adapterId: "", buffer: [], bytes: 0, at: Math.max(0, (this.d.now() - room.startedAt) / 1000), busy: false, closed: false,
    };
    // Held before the adapter is made: the SFU can dial us the moment it answers.
    room.listeners.set(o.identity, l);
    this.byToken.set(token, l);
    try {
      l.adapterId = await this.d.sfu.listen(o.sessionId, o.trackName, this.d.endpoint(token));
      return true;
    } catch (err) {
      room.listeners.delete(o.identity);
      this.byToken.delete(token);
      console.warn(`[rooms] a call's sound could not be listened to: ${(err as Error)?.message ?? err}`);
      return false;
    }
  }

  /** What the SFU sent for one listener: a protobuf packet of theirs. Unknown tokens are dropped. */
  feed(token: string, message: Buffer): void {
    const l = this.byToken.get(token);
    if (!l || l.closed) return;
    const p = readPacket(message);
    if (!p || !p.payload.length) return;
    const pcm = downTo16k(monoFrom(p.payload));
    if (!pcm.length) return;
    l.buffer.push(pcm);
    l.bytes += pcm.length;
    // A buffer that has outgrown its welcome (a speech service that is down): the oldest goes, and the clock moves with it.
    while (l.bytes > BUFFER_MAX_S * BYTES_S && l.buffer.length > 1) {
      const gone = l.buffer.shift()!;
      l.bytes -= gone.length;
      l.at += gone.length / BYTES_S;
    }
    if (l.bytes >= STRETCH_S * BYTES_S) void this.flush(l);
  }

  /** Whether a token is one of ours, for the socket to answer before it accepts anything. */
  knows(token: string): boolean { return this.byToken.has(token); }

  /** One person is gone (or their microphone is off): their ear closed and whatever is left of them written down. */
  async forget(roomId: string, identity: string): Promise<void> {
    const room = this.rooms.get(roomId);
    const l = room?.listeners.get(identity);
    if (!room || !l) return;
    room.listeners.delete(identity);
    await this.close(l);
  }

  /** The call is over: every ear closed, every last stretch written down. */
  async stop(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.delete(roomId);
    await Promise.all([...room.listeners.values()].map((l) => this.close(l)));
  }

  private async close(l: Listener): Promise<void> {
    if (l.closed) return;
    l.closed = true;
    for (const [token, x] of this.byToken) if (x === l) this.byToken.delete(token);
    await this.flush(l, true);
    if (l.adapterId) await this.d.sfu.unlisten(l.adapterId).catch(() => undefined);
  }

  /**
   * What is in one buffer, written down and put in the note. One at a time per person, so their words stay in order; a
   * stretch that fails is dropped rather than retried, because a call does not wait.
   */
  private async flush(l: Listener, last = false): Promise<void> {
    if (l.busy || !l.bytes) return;
    l.busy = true;
    const pcm = Buffer.concat(l.buffer, l.bytes);
    const at = l.at;
    const seconds = pcm.length / BYTES_S;
    l.buffer = [];
    l.bytes = 0;
    l.at = at + seconds;
    try {
      // Silence is not worth a speech service's time, or the person's meter.
      if (hasSound(pcm) && seconds >= 1) {
        const out = await this.d.listen(wavOf(pcm, RATE), "wav", {});
        const text = out.text.trim();
        if (text) {
          await this.d.heard(l.noteId, l.userId, { at: Math.round(at), text, speaker: l.name }, out.durationSeconds || seconds);
          // And to the bot's own ear for its name: "X0, what did we decide?" is a question, not just a line of the note.
          try { this.d.line?.(l.roomId, { who: l.name, text, at: Math.round(at) }); } catch { /* an answer is never the note's problem */ }
        }
      }
    } catch (err) {
      console.warn(`[rooms] a stretch of a call could not be written down: ${(err as Error)?.message ?? err}`);
    } finally {
      l.busy = false;
      // More arrived while that one was away, and it is already a stretch: go again.
      if (!last && l.bytes >= STRETCH_S * BYTES_S) void this.flush(l);
    }
  }
}

/** What a room's note is called before anyone has said anything worth a title. */
export const roomNoteTitle = (title: string): string => title.trim() || "Call";

/** Whether a note still exists to write into (a person may delete it mid-call). */
export const noteGone = (n: Note | null | undefined): boolean => n === null;

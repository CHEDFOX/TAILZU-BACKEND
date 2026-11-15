/**
 * THE BOT'S VOICE, PUT TOGETHER (src/rooms, docs/brief.md).
 *
 * `voice.ts` is the arithmetic and the pacing; this is where a call's voice comes from and goes to:
 *
 *   join(room)   a session of the bot's own at the SFU, one track on it fed by an ingest adapter, and a seat in the room
 *                so that everyone's app pulls that track the way it pulls a person's microphone
 *   say(text)    the words read by the speech service as 24 kHz mono PCM (pipeline/tts.ts), lifted to the 48 kHz stereo
 *                the SFU takes, and handed to the mouth, which lets it out a frame at a time
 *   socket       the SFU dials `/v1/rooms/voice/:token`; whatever that socket is, the mouth writes frames into it
 *   leave(room)  the adapter closed, the mouth hushed, the seat taken out of the room
 *
 * NOTHING IN ANY APP KNOWS ABOUT THIS. The bot's seat is a seat, its track is a track; a call draws it as one more person.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { synthesize } from "../pipeline/tts.js";
import { asPerson } from "../privacy/aiGate.js";
import { chargedTo } from "../usage/cost.js";
import { SCRIBE_NAME } from "./scribe.js";
import type { Sfu } from "./sfu.js";
import type { RoomStore, Seat } from "./store.js";
import { Mouth, realClock, up48 } from "./voice.js";

/** What the bot is called in the call's people list, and the name of the track it speaks on. */
export const VOICE_IDENTITY = "x0-bot";
export const VOICE_TRACK = "x0-bot-audio";

export interface SpeakerDeps {
  sfu: Sfu;
  store: RoomStore;
  /** Where the SFU dials to take our sound: a public wss:// of ours, with this call's own token. */
  endpoint: (token: string) => string;
  /** The words read aloud: 24 kHz mono PCM (the speech service's own rate). */
  read(text: string, userId: string): Promise<Buffer>;
  now(): number;
}

interface Voice {
  roomId: string;
  userId: string;
  sessionId: string;
  adapterId: string;
  token: string;
  /** The socket the SFU dialled, once it has. */
  socket: { send(data: Buffer): void; close(): void } | null;
}

export class Speaker {
  private readonly voices = new Map<string, Voice>();
  private readonly byToken = new Map<string, Voice>();
  private readonly mouth: Mouth;

  constructor(private readonly d: SpeakerDeps) {
    this.mouth = new Mouth({
      send: (roomId, frame) => {
        const v = this.voices.get(roomId);
        if (!v?.socket) return false;
        try { v.socket.send(frame); return true; } catch { return false; }
      },
      every: realClock,
    });
  }

  /** Whether this token is one of ours, for the socket to answer before it takes it. */
  knows(token: string): boolean { return this.byToken.has(token); }

  /** The SFU has dialled for one call's voice. */
  attach(token: string, socket: { send(data: Buffer): void; close(): void }): boolean {
    const v = this.byToken.get(token);
    if (!v) return false;
    v.socket = socket;
    return true;
  }

  /** That socket has gone; the words wait for the next one. */
  detach(token: string): void {
    const v = this.byToken.get(token);
    if (v) v.socket = null;
  }

  /**
   * A seat and a voice in this call. The seat is written into the room so every app pulls the track; it never beats and
   * never counts towards the call's size (rooms/store.ts Seat.bot).
   */
  async join(roomId: string): Promise<{ identity: string; name: string; sessionId: string; trackName: string } | null> {
    if (this.voices.has(roomId)) return null;
    const room = await this.d.store.get(roomId);
    if (!room) return null;
    const token = randomUUID().replace(/-/g, "");
    try {
      const sessionId = await this.d.sfu.newSession();
      const v: Voice = { roomId, userId: room.userId, sessionId, adapterId: "", token, socket: null };
      this.voices.set(roomId, v);
      this.byToken.set(token, v);
      v.adapterId = await this.d.sfu.speak(sessionId, VOICE_TRACK, this.d.endpoint(token));
      const seat: Seat = {
        identity: VOICE_IDENTITY, seatHash: `bot:${randomBytes(16).toString("hex")}`, sessionId,
        name: SCRIBE_NAME, role: "guest", audio: VOICE_TRACK, since: this.d.now(), seen: this.d.now(), bot: true,
      };
      const people = [...room.people.filter((s) => s.identity !== VOICE_IDENTITY), seat];
      await this.d.store.update(roomId, { people });
      return { identity: seat.identity, name: seat.name, sessionId, trackName: VOICE_TRACK };
    } catch (err) {
      this.voices.delete(roomId);
      this.byToken.delete(token);
      console.warn(`[rooms] the bot could not take a voice in a call: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  /** Said out loud in the call. The reading is the owner's, on their meter, as everything the bot does is. */
  async say(roomId: string, text: string): Promise<void> {
    const v = this.voices.get(roomId);
    const line = text.trim();
    if (!v || !line) return;
    const pcm = await asPerson(v.userId, () => chargedTo(v.userId, "rooms", () => this.d.read(line, v.userId)));
    if (pcm.length) this.mouth.say(roomId, up48(pcm));
  }

  /** Stop talking, now. */
  hush(roomId: string): void { this.mouth.hush(roomId); }

  /** The call is over, or the bot is leaving it: its track closed, its seat taken out, nothing left talking. */
  async leave(roomId: string): Promise<void> {
    const v = this.voices.get(roomId);
    if (!v) return;
    this.voices.delete(roomId);
    this.byToken.delete(v.token);
    this.mouth.hush(roomId);
    try { v.socket?.close(); } catch { /* it is gone either way */ }
    if (v.adapterId) await this.d.sfu.unlisten(v.adapterId).catch(() => undefined);
    const room = await this.d.store.get(roomId).catch(() => null);
    if (room?.people.some((s) => s.identity === VOICE_IDENTITY)) {
      await this.d.store.update(roomId, { people: room.people.filter((s) => s.identity !== VOICE_IDENTITY) }).catch(() => undefined);
    }
  }
}

/** The speech service, read as the raw samples the call takes: 24 kHz mono PCM. */
export async function readAloud(text: string): Promise<Buffer> {
  const out = await synthesize({ text, format: "pcm" });
  return out.audio;
}

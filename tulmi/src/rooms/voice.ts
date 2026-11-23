/**
 * THE BOT'S VOICE IN OUR OWN CALLS (src/rooms, docs/brief.md).
 *
 * The ears are the SFU's WebSocket adapter one way round (ears.ts); this is the same adapter the other way. We make a
 * session for the bot, publish one track on it fed from a socket, and write 48 kHz stereo PCM into that socket. The SFU
 * turns it into Opus, and everyone in the call pulls it exactly as they pull a person's microphone — so a voice from the
 * server needs nothing new in any app, and nothing in a call has to know where it came from.
 *
 *   speech          what the speech service gives us: 24 kHz mono PCM (pipeline/tts.ts, format "pcm")
 *   up48(pcm)       24 kHz mono -> 48 kHz stereo, which is what the SFU takes
 *   mouth.say(pcm)  queued, and sent as 20 ms frames on a clock: real sound arrives at the speed it is spoken
 *
 * WHY IT IS PACED. A call is a live thing: a second of speech written in one go is a second of speech crammed into one
 * packet, and the SFU would have to throw most of it away (its own limit is 32 KB a message). So the mouth holds the words
 * and lets them out a frame at a time, which is also what makes "stop talking" possible — the queue is simply dropped.
 *
 * Everything here is arithmetic and a clock, so a bot can be made to speak in a test with no sockets at all.
 */

/** What the SFU takes: 48 kHz, two channels, signed 16-bit little-endian, interleaved. */
export const OUT_RATE = 48_000;
const OUT_CHANNELS = 2;
/** One frame of sound, in milliseconds. Twenty is what a call is made of. */
export const FRAME_MS = 20;
export const FRAME_BYTES = (OUT_RATE / 1000) * FRAME_MS * OUT_CHANNELS * 2;
/** More than this waiting to be said is a bot talking over a meeting: the oldest goes. */
const QUEUE_MAX_S = 60;

/**
 * 24 kHz mono to 48 kHz stereo. Every input sample becomes two output frames — the sample itself, then the midpoint
 * between it and the next, which is a straight line between two points and is what a doubling of the rate means.
 */
export function up48(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return Buffer.alloc(0);
  const out = Buffer.allocUnsafe(samples * 2 * OUT_CHANNELS * 2);
  let o = 0;
  for (let i = 0; i < samples; i++) {
    const a = pcm.readInt16LE(i * 2);
    const b = i + 1 < samples ? pcm.readInt16LE(i * 2 + 2) : a;
    const mid = (a + b) >> 1;
    for (const v of [a, mid]) {
      out.writeInt16LE(v, o); o += 2;   // left
      out.writeInt16LE(v, o); o += 2;   // right
    }
  }
  return out;
}

/** What one call's voice needs from the world. */
export interface MouthDeps {
  /** Send one frame down the socket the SFU dialled. False when there is no socket yet, or it has gone. */
  send(roomId: string, frame: Buffer): boolean;
  /** A frame every FRAME_MS; the mouth stops it when it has nothing to say. */
  every(ms: number, f: () => void): { stop(): void };
}

interface Speaking {
  /** 48 kHz stereo, waiting to go out. */
  queue: Buffer[];
  bytes: number;
  /** Where in the first buffer the next frame starts. */
  at: number;
  timer: { stop(): void } | null;
}

/**
 * The mouths of every call that has one. A call with nothing to say costs nothing: the clock only runs while there are
 * words in the queue.
 */
export class Mouth {
  private readonly calls = new Map<string, Speaking>();

  constructor(private readonly d: MouthDeps) {}

  /** Whether this call has anything left to say. */
  speaking(roomId: string): boolean {
    const s = this.calls.get(roomId);
    return !!s && s.bytes > s.at;
  }

  /** Said out loud in this call: 48 kHz stereo PCM, queued and let out a frame at a time. */
  say(roomId: string, pcm48: Buffer): void {
    if (!pcm48.length) return;
    const s = this.calls.get(roomId) ?? { queue: [], bytes: 0, at: 0, timer: null };
    this.calls.set(roomId, s);
    s.queue.push(pcm48);
    s.bytes += pcm48.length;
    // A bot that has fallen a minute behind the call is not worth catching up on: the oldest goes.
    while (s.bytes - s.at > QUEUE_MAX_S * OUT_RATE * OUT_CHANNELS * 2 && s.queue.length > 1) {
      const gone = s.queue.shift()!;
      s.bytes -= gone.length;
      s.at = Math.max(0, s.at - gone.length);
    }
    if (!s.timer) s.timer = this.d.every(FRAME_MS, () => this.tick(roomId));
  }

  /** Stop talking, now: whatever is left unsaid is dropped. */
  hush(roomId: string): void {
    const s = this.calls.get(roomId);
    if (!s) return;
    s.timer?.stop();
    this.calls.delete(roomId);
  }

  private tick(roomId: string): void {
    const s = this.calls.get(roomId);
    if (!s) return;
    const got = this.peek(s);
    if (!got) { this.hush(roomId); return; }
    // NOTHING IS SWALLOWED BY A SOCKET THAT IS NOT THERE. The frame is only taken off the queue once it has gone out, so
    // words spoken before the SFU dialled wait for it (and a call that never gets one drops them by the queue's own limit).
    if (this.d.send(roomId, got.frame)) this.advance(s, got.used);
  }

  /** The next frame and how much of the queue it is made of, or null when everything has been said. */
  private peek(s: Speaking): { frame: Buffer; used: number } | null {
    const parts: Buffer[] = [];
    let want = FRAME_BYTES;
    let at = s.at, i = 0;
    while (want > 0 && i < s.queue.length) {
      const buf = s.queue[i]!;
      if (at >= buf.length) { at -= buf.length; i++; continue; }
      const take = Math.min(want, buf.length - at);
      parts.push(buf.subarray(at, at + take));
      want -= take;
      at += take;
    }
    if (!parts.length) return null;
    // The last frame of a sentence is short; the SFU takes a whole frame, so it is padded with quiet.
    const frame = want > 0 ? Buffer.concat([...parts, Buffer.alloc(want)], FRAME_BYTES) : Buffer.concat(parts, FRAME_BYTES);
    return { frame, used: FRAME_BYTES - want };
  }

  /** That frame is said: the queue moves on, and whatever is wholly behind us is let go. */
  private advance(s: Speaking, used: number): void {
    s.at += used;
    while (s.queue.length && s.at >= s.queue[0]!.length) {
      const gone = s.queue.shift()!;
      s.at -= gone.length;
      s.bytes -= gone.length;
    }
  }
}

/** A clock for the real mouth: a frame every 20 ms, and it never holds the process open. */
export const realClock = (ms: number, f: () => void): { stop(): void } => {
  const t = setInterval(f, ms);
  t.unref?.();
  return { stop: () => clearInterval(t) };
};

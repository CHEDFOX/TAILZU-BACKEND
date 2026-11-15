/**
 * WHAT COMES DOWN THE WIRE FROM THE SFU, AND WHAT THE PIPELINE TAKES (src/rooms, docs/brief.md).
 *
 * Cloudflare's WebSocket adapter sends one person's track as a stream of protobuf packets, each
 *
 *     Packet { 1: sequenceNumber (uint32), 2: timestamp (uint64), 3: payload (bytes) }
 *
 * whose payload is 48 kHz stereo PCM: signed 16-bit little-endian samples, left and right interleaved. The speech pipeline
 * wants a file it can post to a speech service. So this file is the whole of the arithmetic between the two, and nothing
 * else: no network, no store, no clock.
 *
 *   readPacket(buf)        the sequence number, the timestamp and the payload of one message
 *   monoFrom(pcm)          stereo 48 kHz -> mono 48 kHz (the two ears averaged)
 *   downTo16k(pcm)         48 kHz -> 16 kHz, three samples averaged into one
 *   wavOf(pcm, rate)       a WAV file of those samples (a 44-byte header and the samples)
 *
 * WHY 16 kHz MONO. 48 kHz stereo is 192 KB a second a person: a one-hour call with three people is about 2 GB, and we pay
 * Cloudflare for every byte of it as egress. Speech services want 16 kHz anyway and hear nothing above 8 kHz, so the words
 * are the same and the bytes are a sixth. There is no filter before the decimation: a box average of three samples is one,
 * and what it lets through above 8 kHz is quieter than the room.
 *
 * A PROTOBUF READER IN TWENTY LINES rather than a dependency: the message has three fields and we need two of them.
 */

/** One message from the adapter. `payload` is a view into `buf`, not a copy. */
export interface Packet {
  sequence: number;
  /** The SFU's own clock for this packet, in whatever unit it sends; only its order and its gaps matter to us. */
  timestamp: number;
  payload: Buffer;
}

/** A protobuf varint at `at`: its value, and where the next field starts. Null when the buffer runs out. */
function varint(buf: Buffer, at: number): { value: number; next: number } | null {
  let value = 0, shift = 0, i = at;
  for (; i < buf.length && shift <= 56; i++) {
    const b = buf[i]!;
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value, next: i + 1 };
    shift += 7;
  }
  return null;
}

/**
 * One adapter message read. Null when it is not one — a message that is not protobuf, or is cut short, is dropped rather
 * than guessed at.
 */
export function readPacket(buf: Buffer): Packet | null {
  let at = 0, sequence = 0, timestamp = 0;
  let payload: Buffer | null = null;
  while (at < buf.length) {
    const key = varint(buf, at);
    if (!key) return null;
    at = key.next;
    const field = Math.floor(key.value / 8), wire = key.value % 8;
    if (wire === 0) {
      const v = varint(buf, at);
      if (!v) return null;
      at = v.next;
      if (field === 1) sequence = v.value;
      else if (field === 2) timestamp = v.value;
    } else if (wire === 2) {
      const len = varint(buf, at);
      if (!len) return null;
      const end = len.next + len.value;
      if (end > buf.length) return null;
      if (field === 3) payload = buf.subarray(len.next, end);
      at = end;
    } else if (wire === 5) {
      at += 4;
    } else if (wire === 1) {
      at += 8;
    } else {
      return null;
    }
  }
  return payload ? { sequence, timestamp, payload } : null;
}

/** Stereo, interleaved, to one channel: the two ears averaged, which is what a room sounds like. */
export function monoFrom(pcm: Buffer): Buffer {
  const frames = Math.floor(pcm.length / 4);
  const out = Buffer.allocUnsafe(frames * 2);
  for (let i = 0; i < frames; i++) {
    const l = pcm.readInt16LE(i * 4), r = pcm.readInt16LE(i * 4 + 2);
    out.writeInt16LE((l + r) >> 1, i * 2);
  }
  return out;
}

/** 48 kHz to 16 kHz: every three samples averaged into one. */
export function downTo16k(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const out = Buffer.allocUnsafe(Math.floor(samples / 3) * 2);
  for (let i = 0, o = 0; i + 2 < samples; i += 3, o += 2) {
    const a = pcm.readInt16LE(i * 2), b = pcm.readInt16LE(i * 2 + 2), c = pcm.readInt16LE(i * 2 + 4);
    out.writeInt16LE(Math.round((a + b + c) / 3), o);
  }
  return out;
}

/** Those samples as a file a speech service takes: 16-bit mono PCM in a WAV wrapper. */
export function wavOf(pcm: Buffer, rate = 16_000): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);        // the format chunk's length
  head.writeUInt16LE(1, 20);         // PCM
  head.writeUInt16LE(1, 22);         // one channel
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);  // bytes a second
  head.writeUInt16LE(2, 32);         // bytes a frame
  head.writeUInt16LE(16, 34);        // bits a sample
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** Whether a stretch is worth sending to be written down: anything at all above the quiet of an empty room. */
export function hasSound(pcm: Buffer, floor = 180): boolean {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return false;
  let sum = 0;
  // Every twentieth sample is enough to tell a room with a voice in it from one without.
  let n = 0;
  for (let i = 0; i < samples; i += 20, n++) sum += Math.abs(pcm.readInt16LE(i * 2));
  return n > 0 && sum / n > floor;
}

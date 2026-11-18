/**
 * WHAT COMES DOWN THE WIRE FROM THE SFU (src/rooms/pcm.ts, docs/brief.md): the adapter's protobuf messages, and the arithmetic
 * between 48 kHz stereo PCM and the file a speech service takes.
 */
import { describe, expect, it } from "vitest";

const { readPacket, monoFrom, downTo16k, wavOf, hasSound } = await import("../src/rooms/pcm.js");

/** A protobuf Packet as Cloudflare writes it: 1 sequenceNumber, 2 timestamp, 3 payload. */
function packet(sequence: number, timestamp: number, payload: Buffer): Buffer {
  const varint = (n: number): Buffer => {
    const out: number[] = [];
    let v = n;
    do { const b = v % 128; v = Math.floor(v / 128); out.push(v > 0 ? b | 0x80 : b); } while (v > 0);
    return Buffer.from(out);
  };
  return Buffer.concat([
    Buffer.from([1 * 8 + 0]), varint(sequence),
    Buffer.from([2 * 8 + 0]), varint(timestamp),
    Buffer.from([3 * 8 + 2]), varint(payload.length), payload,
  ]);
}
const pcm = (...samples: number[]): Buffer => {
  const b = Buffer.allocUnsafe(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
};

describe("one message from the adapter", () => {
  it("is read field by field, in any order, and a big timestamp survives", () => {
    const p = readPacket(packet(7, 1_765_000_000_000, pcm(1, -1)))!;
    expect(p.sequence).toBe(7);
    expect(p.timestamp).toBe(1_765_000_000_000);
    expect([...p.payload]).toEqual([...pcm(1, -1)]);
  });

  it("is dropped, never guessed at, when it is not one", () => {
    expect(readPacket(Buffer.alloc(0))).toBeNull();
    expect(readPacket(Buffer.from([0xff, 0xff, 0xff]))).toBeNull();
    // A field that says it is longer than the message.
    expect(readPacket(Buffer.from([3 * 8 + 2, 200, 1, 2]))).toBeNull();
    // No payload at all: nothing to write down.
    expect(readPacket(Buffer.concat([Buffer.from([1 * 8 + 0, 3])]))).toBeNull();
    // A field this message never carries is skipped, not fatal.
    const extra = Buffer.concat([Buffer.from([5 * 8 + 5, 1, 2, 3, 4]), packet(1, 2, pcm(5))]);
    expect(readPacket(extra)?.sequence).toBe(1);
  });
});

describe("48 kHz stereo to what the pipeline takes", () => {
  it("averages the two ears into one channel", () => {
    expect([...monoFrom(pcm(100, 200, -100, 100))]).toEqual([...pcm(150, 0)]);
    // A half frame at the end is not half a sample.
    expect(monoFrom(pcm(1, 2, 3))).toHaveLength(2);
  });

  it("takes three samples down to one, so a call costs a sixth of the bytes", () => {
    expect([...downTo16k(pcm(30, 60, 90, 300, 600, 900))]).toEqual([...pcm(60, 600)]);
    expect(downTo16k(pcm(1, 2))).toHaveLength(0);
    // A second of 48 kHz mono is a second of 16 kHz mono.
    expect(downTo16k(Buffer.alloc(48_000 * 2))).toHaveLength(16_000 * 2);
  });

  it("wraps them in a WAV a speech service can read", () => {
    const wav = wavOf(pcm(1, 2, 3), 16_000);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1);          // one channel
    expect(wav.readUInt32LE(24)).toBe(16_000);     // its rate
    expect(wav.readUInt16LE(34)).toBe(16);         // 16-bit
    expect(wav.readUInt32LE(40)).toBe(6);          // the samples' length
    expect(wav).toHaveLength(44 + 6);
  });

  it("knows a stretch with a voice in it from an empty room", () => {
    expect(hasSound(Buffer.alloc(16_000 * 2))).toBe(false);
    const loud = Buffer.allocUnsafe(16_000 * 2);
    for (let i = 0; i < 16_000; i++) loud.writeInt16LE(i % 2 ? 6000 : -6000, i * 2);
    expect(hasSound(loud)).toBe(true);
    expect(hasSound(Buffer.alloc(0))).toBe(false);
  });
});

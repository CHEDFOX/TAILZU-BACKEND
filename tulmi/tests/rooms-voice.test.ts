/**
 * THE BOT'S VOICE IN OUR OWN CALLS (src/rooms/voice.ts, docs/brief.md): 24 kHz mono speech turned into the 48 kHz stereo the
 * SFU takes, and let out a frame at a time, at the speed it is spoken. No sockets here: the sending and the clock are handed in.
 */
import { describe, expect, it } from "vitest";

const { up48, Mouth, FRAME_BYTES, FRAME_MS, OUT_RATE } = await import("../src/rooms/voice.js");

const pcm = (...samples: number[]): Buffer => {
  const b = Buffer.allocUnsafe(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
};
const read = (b: Buffer): number[] => { const out: number[] = []; for (let i = 0; i < b.length; i += 2) out.push(b.readInt16LE(i)); return out; };

/** A mouth whose frames are collected, and whose clock the test turns by hand. */
function rig(o: { connected?: boolean } = {}) {
  const sent: Buffer[] = [];
  let tick: (() => void) | null = null;
  let stopped = 0;
  const mouth = new Mouth({
    send: (_roomId, frame) => { if (o.connected === false) return false; sent.push(frame); return true; },
    every: (_ms, f) => { tick = f; return { stop: () => { stopped++; tick = null; } }; },
  });
  return { mouth, sent, stopped: () => stopped, turn: (n = 1) => { for (let i = 0; i < n && tick; i++) tick(); } };
}

describe("speech into what a call takes", () => {
  it("doubles the rate and makes it two channels, with the midpoint between samples", () => {
    // Two samples at 24 kHz become four frames at 48 kHz, each written twice (left and right).
    expect(read(up48(pcm(100, 300)))).toEqual([100, 100, 200, 200, 300, 300, 300, 300]);
    expect(up48(Buffer.alloc(0))).toHaveLength(0);
    // A second of speech is a second of call: 24,000 samples in, 48,000 stereo frames out.
    expect(up48(Buffer.alloc(24_000 * 2))).toHaveLength(OUT_RATE * 2 * 2);
  });
});

describe("the mouth", () => {
  it("lets a sentence out a frame at a time, and stops when it has said it", () => {
    const r = rig();
    // Two and a half frames of sound.
    r.mouth.say("room-1", Buffer.alloc(FRAME_BYTES * 2 + FRAME_BYTES / 2, 1));
    expect(r.mouth.speaking("room-1")).toBe(true);
    r.turn(3);
    expect(r.sent).toHaveLength(3);
    for (const f of r.sent) expect(f).toHaveLength(FRAME_BYTES);
    // The last one is padded with quiet, not cut short.
    expect(r.sent[2]!.subarray(FRAME_BYTES / 2).every((b) => b === 0)).toBe(true);
    // Nothing left: the clock is stopped rather than left ticking over silence.
    r.turn();
    expect(r.sent).toHaveLength(3);
    expect(r.stopped()).toBe(1);
    expect(r.mouth.speaking("room-1")).toBe(false);
  });

  it("reads a sentence at the speed it is spoken", () => {
    const r = rig();
    const second = Buffer.alloc(OUT_RATE * 2 * 2);     // one second of 48 kHz stereo
    r.mouth.say("room-1", second);
    expect(FRAME_MS).toBe(20);
    r.turn(50);                                         // fifty frames of 20 ms
    expect(r.sent).toHaveLength(50);
    r.turn();
    expect(r.sent).toHaveLength(50);
  });

  it("joins what is said next onto what is still being said", () => {
    const r = rig();
    r.mouth.say("room-1", Buffer.alloc(FRAME_BYTES, 1));
    r.mouth.say("room-1", Buffer.alloc(FRAME_BYTES, 2));
    r.turn(2);
    expect(r.sent.map((f) => f[0])).toEqual([1, 2]);
  });

  it("holds the words while nothing is listening, rather than losing them", () => {
    const r = rig({ connected: false });
    r.mouth.say("room-1", Buffer.alloc(FRAME_BYTES, 1));
    r.turn(3);
    expect(r.sent).toEqual([]);
    expect(r.mouth.speaking("room-1")).toBe(true);
  });

  it("is hushed at once, and whatever was left unsaid is dropped", () => {
    const r = rig();
    r.mouth.say("room-1", Buffer.alloc(FRAME_BYTES * 10));
    r.turn();
    r.mouth.hush("room-1");
    expect(r.stopped()).toBe(1);
    expect(r.mouth.speaking("room-1")).toBe(false);
    r.turn(5);
    expect(r.sent).toHaveLength(1);
    // Hushing a call that was not speaking is nothing at all.
    r.mouth.hush("room-2");
  });

  it("each call has its own voice", () => {
    const sent: Array<{ room: string; byte: number }> = [];
    const ticks: Array<() => void> = [];
    const mouth = new Mouth({
      send: (room, frame) => { sent.push({ room, byte: frame[0]! }); return true; },
      every: (_ms, f) => { ticks.push(f); return { stop: () => undefined }; },
    });
    mouth.say("a", Buffer.alloc(FRAME_BYTES, 7));
    mouth.say("b", Buffer.alloc(FRAME_BYTES, 9));
    ticks.forEach((f) => f());
    expect(sent).toEqual([{ room: "a", byte: 7 }, { room: "b", byte: 9 }]);
  });
});

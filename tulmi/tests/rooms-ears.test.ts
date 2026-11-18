/**
 * HOW THE SERVER HEARS ONE OF OUR OWN CALLS (src/rooms/ears.ts, docs/brief.md): one WebSocket adapter a person, their sound
 * gathered into stretches, written down under their own name, and every ear closed when the call ends. No network: the SFU,
 * the speech service, the note and the clock are all handed in.
 */
import { describe, expect, it, vi } from "vitest";

const { Ears, STRETCH_S } = await import("../src/rooms/ears.js");

const RATE = 16_000;
/** `seconds` of 48 kHz stereo at a given loudness, as one adapter message. */
function packet(seconds: number, loud = 6000): Buffer {
  const frames = Math.round(48_000 * seconds);
  const pcm = Buffer.allocUnsafe(frames * 4);
  for (let i = 0; i < frames; i++) {
    const v = loud ? (i % 2 ? loud : -loud) : 0;
    pcm.writeInt16LE(v, i * 4);
    pcm.writeInt16LE(v, i * 4 + 2);
  }
  const varint = (n: number): Buffer => {
    const out: number[] = [];
    let v = n;
    do { const b = v % 128; v = Math.floor(v / 128); out.push(v > 0 ? b | 0x80 : b); } while (v > 0);
    return Buffer.from(out);
  };
  return Buffer.concat([Buffer.from([8]), varint(1), Buffer.from([16]), varint(1), Buffer.from([26]), varint(pcm.length), pcm]);
}

function rig(o: { fails?: boolean } = {}) {
  const adapters: Array<{ sessionId: string; trackName: string; endpoint: string }> = [];
  const closed: string[] = [];
  const heard: Array<{ noteId: string; at: number; text: string; speaker?: string; seconds: number }> = [];
  const listened: Array<{ bytes: number; format: string }> = [];
  let n = 0, t = 1_000_000;
  const ears = new Ears({
    sfu: {
      async listen(sessionId, trackName, endpoint) {
        if (o.fails) throw new Error("the SFU said no");
        adapters.push({ sessionId, trackName, endpoint });
        return `ad-${adapters.length}`;
      },
      async unlisten(id) { closed.push(id); },
    } as never,
    endpoint: (token) => `wss://api.test/v1/rooms/ears/${token}`,
    async listen(audio, format) {
      listened.push({ bytes: audio.length, format });
      return { text: `heard ${listened.length}`, durationSeconds: 25 };
    },
    async heard(noteId, _userId, seg, seconds) { heard.push({ noteId, seconds, ...seg }); },
    token: () => `tok-${++n}`,
    now: () => t,
  });
  return { ears, adapters, closed, heard, listened, at: (ms: number) => { t = ms; } };
}

describe("one ear a person", () => {
  it("asks the SFU for an adapter with our own address, and the same seat never gets two", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    expect(r.ears.on("room-1")).toBe(true);
    expect(await r.ears.listenTo("room-1", { identity: "aanya", name: "Aanya", sessionId: "s1", trackName: "aanya-audio" })).toBe(true);
    expect(r.adapters).toEqual([{ sessionId: "s1", trackName: "aanya-audio", endpoint: "wss://api.test/v1/rooms/ears/tok-1" }]);
    expect(r.ears.knows("tok-1")).toBe(true);
    // The same seat again: the same ear.
    expect(await r.ears.listenTo("room-1", { identity: "aanya", name: "Aanya", sessionId: "s1", trackName: "aanya-audio" })).toBe(false);
    expect(r.adapters).toHaveLength(1);
    // A room nobody is listening to.
    expect(await r.ears.listenTo("room-2", { identity: "x", name: "X", sessionId: "s", trackName: "t" })).toBe(false);
  });

  it("an SFU that refuses leaves no ear behind", async () => {
    const r = rig({ fails: true });
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    expect(await r.ears.listenTo("room-1", { identity: "a", name: "A", sessionId: "s", trackName: "t" })).toBe(false);
    expect(r.ears.knows("tok-1")).toBe(false);
  });
});

describe("what it hears becomes the note", () => {
  it("gathers a stretch, writes it down, and puts it under the name of whoever said it", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    await r.ears.listenTo("room-1", { identity: "aanya", name: "Aanya", sessionId: "s1", trackName: "aanya-audio" });
    // Less than a stretch: nothing is sent anywhere.
    r.ears.feed("tok-1", packet(10));
    await vi.waitFor(() => expect(r.listened).toHaveLength(0));
    // Over the stretch: one file, 16 kHz mono in a WAV, and one line in the note.
    r.ears.feed("tok-1", packet(20));
    await vi.waitFor(() => expect(r.heard).toHaveLength(1));
    expect(r.listened[0]!.format).toBe("wav");
    // 30 seconds of 16 kHz mono, and the WAV's 44-byte head.
    expect(r.listened[0]!.bytes).toBe(44 + 30 * RATE * 2);
    expect(r.heard[0]).toMatchObject({ noteId: "note-1", at: 0, text: "heard 1", speaker: "Aanya" });
  });

  it("silence is never sent to be written down", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    await r.ears.listenTo("room-1", { identity: "a", name: "A", sessionId: "s", trackName: "t" });
    r.ears.feed("tok-1", packet(STRETCH_S + 1, 0));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.listened).toEqual([]);
    expect(r.heard).toEqual([]);
  });

  it("keeps each stretch's place in the call, so the note reads in order", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    await r.ears.listenTo("room-1", { identity: "a", name: "Asha", sessionId: "s", trackName: "t" });
    r.ears.feed("tok-1", packet(26));
    await vi.waitFor(() => expect(r.heard).toHaveLength(1));
    r.ears.feed("tok-1", packet(26));
    await vi.waitFor(() => expect(r.heard).toHaveLength(2));
    expect(r.heard.map((h) => h.at)).toEqual([0, 26]);
  });

  it("a person who joined later starts where they joined, not at the top", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    r.at(1_000_000 + 90_000);
    await r.ears.listenTo("room-1", { identity: "late", name: "Ravi", sessionId: "s", trackName: "t" });
    r.ears.feed("tok-1", packet(26));
    await vi.waitFor(() => expect(r.heard).toHaveLength(1));
    expect(r.heard[0]!.at).toBe(90);
  });

  it("a packet that is not one, and a token nobody knows, are dropped", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    await r.ears.listenTo("room-1", { identity: "a", name: "A", sessionId: "s", trackName: "t" });
    r.ears.feed("tok-1", Buffer.from([0xff, 0xff]));
    r.ears.feed("nobody", packet(30));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.listened).toEqual([]);
  });

  it("a speech service that fails loses that stretch and nothing else", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    await r.ears.listenTo("room-1", { identity: "a", name: "A", sessionId: "s", trackName: "t" });
    let first = true;
    const deps = (r.ears as unknown as { d: { listen: unknown } }).d;
    const real = deps.listen as (a: Buffer, f: string) => Promise<{ text: string }>;
    deps.listen = async (a: Buffer, f: string) => {
      if (first) { first = false; throw new Error("the speech service is down"); }
      return real(a, f);
    };
    r.ears.feed("tok-1", packet(26));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.heard).toEqual([]);
    r.ears.feed("tok-1", packet(26));
    await vi.waitFor(() => expect(r.heard).toHaveLength(1));
    expect(r.heard[0]!.at).toBe(26);
  });
});

describe("the end of a call", () => {
  it("closes every ear at the SFU and writes down what was left", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    await r.ears.listenTo("room-1", { identity: "a", name: "Asha", sessionId: "s1", trackName: "t1" });
    await r.ears.listenTo("room-1", { identity: "b", name: "Ravi", sessionId: "s2", trackName: "t2" });
    r.ears.feed("tok-1", packet(5));
    await r.ears.stop("room-1");
    expect(r.closed.sort()).toEqual(["ad-1", "ad-2"]);
    expect(r.heard.map((h) => h.speaker)).toEqual(["Asha"]);
    expect(r.ears.on("room-1")).toBe(false);
    expect(r.ears.knows("tok-1")).toBe(false);
    // Anything that arrives after is nobody's.
    r.ears.feed("tok-1", packet(30));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.listened).toHaveLength(1);
  });

  it("one person leaving closes theirs alone", async () => {
    const r = rig();
    r.ears.open("room-1", { noteId: "note-1", userId: "u1", startedAt: 1_000_000 });
    await r.ears.listenTo("room-1", { identity: "a", name: "Asha", sessionId: "s1", trackName: "t1" });
    await r.ears.listenTo("room-1", { identity: "b", name: "Ravi", sessionId: "s2", trackName: "t2" });
    await r.ears.forget("room-1", "a");
    expect(r.closed).toEqual(["ad-1"]);
    expect(r.ears.on("room-1")).toBe(true);
    expect(r.ears.knows("tok-2")).toBe(true);
    // And they can come back.
    expect(await r.ears.listenTo("room-1", { identity: "a", name: "Asha", sessionId: "s1", trackName: "t1" })).toBe(true);
  });
});

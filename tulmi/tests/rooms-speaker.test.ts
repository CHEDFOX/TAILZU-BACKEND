/**
 * THE BOT'S VOICE, PUT TOGETHER (src/rooms/speaker.ts, docs/brief.md): a seat of its own at the SFU with a track fed from
 * the socket Cloudflare dials, the words read aloud and let out a frame at a time, and all of it taken away when the call
 * ends. The SFU, the speech service, the store and the clock are handed in, so nothing here touches a network.
 */
import { describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.NODE_ENV = "test";

const { Speaker, VOICE_IDENTITY, VOICE_TRACK } = await import("../src/rooms/speaker.js");
const { FRAME_BYTES } = await import("../src/rooms/voice.js");

function rig(o: { read?: () => Promise<Buffer>; fails?: boolean } = {}) {
  const calls = { sessions: 0, spoke: [] as Array<{ sessionId: string; trackName: string; endpoint: string }>, closed: [] as string[] };
  const room = { id: "room-1", userId: "u1", people: [{ identity: "aanya", seatHash: "h", sessionId: "s1", name: "Aanya", role: "host", since: 0, seen: 0 }] };
  const saved: Array<Record<string, unknown>> = [];
  const speaker = new Speaker({
    sfu: {
      async newSession() { if (o.fails) throw new Error("the SFU said no"); calls.sessions++; return `sess-${calls.sessions}`; },
      async speak(sessionId, trackName, endpoint) { calls.spoke.push({ sessionId, trackName, endpoint }); return `ad-${calls.spoke.length}`; },
      async unlisten(id) { calls.closed.push(id); },
    } as never,
    store: {
      async get() { return { ...room, people: [...room.people] } as never; },
      async update(_id: string, patch: Record<string, unknown>) { saved.push(patch); if (patch.people) room.people = patch.people as never; return null; },
    } as never,
    endpoint: (token) => `wss://api.test/v1/rooms/voice/${token}`,
    read: o.read ?? (async () => Buffer.alloc(24_000 * 2)),   // one second of 24 kHz mono
    now: () => 1_000,
  });
  return { speaker, calls, saved, room };
}

/** The token the endpoint was given, which is the one the SFU would dial back with. */
const tokenOf = (endpoint: string): string => endpoint.split("/").pop()!;

describe("a seat and a track of its own", () => {
  it("takes a session, publishes one track from our socket, and sits in the room as a seat nobody counts", async () => {
    const r = rig();
    const seat = await r.speaker.join("room-1");
    expect(seat).toMatchObject({ identity: VOICE_IDENTITY, trackName: VOICE_TRACK, sessionId: "sess-1" });
    expect(r.calls.spoke[0]).toMatchObject({ sessionId: "sess-1", trackName: VOICE_TRACK });
    expect(r.calls.spoke[0]!.endpoint).toMatch(/^wss:\/\/api\.test\/v1\/rooms\/voice\/[a-f0-9]{32}$/);
    // The seat is in the room, with its track, marked as the bot's.
    const people = r.saved[0]!.people as Array<Record<string, unknown>>;
    expect(people.at(-1)).toMatchObject({ identity: VOICE_IDENTITY, name: "X0", audio: VOICE_TRACK, bot: true });
    // And it is the socket's own token that is known.
    expect(r.speaker.knows(tokenOf(r.calls.spoke[0]!.endpoint))).toBe(true);
    expect(r.speaker.knows("nobody")).toBe(false);
    // Twice is still one voice.
    expect(await r.speaker.join("room-1")).toBeNull();
    expect(r.calls.sessions).toBe(1);
  });

  it("an SFU that refuses leaves nothing behind", async () => {
    const r = rig({ fails: true });
    expect(await r.speaker.join("room-1")).toBeNull();
    expect(r.saved).toEqual([]);
  });
});

describe("saying something out loud", () => {
  it("reads the words and sends them to the socket the SFU dialled, a frame at a time", async () => {
    const r = rig();
    await r.speaker.join("room-1");
    const sent: Buffer[] = [];
    r.speaker.attach(tokenOf(r.calls.spoke[0]!.endpoint), { send: (b: Buffer) => sent.push(b), close: () => undefined });
    await r.speaker.say("room-1", "We decided on Friday.");
    // One second of 24 kHz mono is a second of 48 kHz stereo: fifty 20 ms frames, let out on the clock.
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(3), { timeout: 2000 });
    for (const f of sent) expect(f).toHaveLength(FRAME_BYTES);
    r.speaker.hush("room-1");
  });

  it("says nothing at all when there is nothing to say, or no voice in that call", async () => {
    const r = rig();
    const read = vi.fn(async () => Buffer.alloc(0));
    const q = rig({ read });
    await q.speaker.say("room-1", "nobody is listening");   // never joined
    expect(read).not.toHaveBeenCalled();
    await r.speaker.join("room-1");
    await r.speaker.say("room-1", "   ");
    expect(r.calls.spoke).toHaveLength(1);
  });
});

describe("leaving", () => {
  it("closes its track, hushes what was left and takes its seat out of the room", async () => {
    const r = rig();
    await r.speaker.join("room-1");
    const token = tokenOf(r.calls.spoke[0]!.endpoint);
    let closed = false;
    r.speaker.attach(token, { send: () => undefined, close: () => { closed = true; } });
    await r.speaker.say("room-1", "a long answer");
    await r.speaker.leave("room-1");
    expect(r.calls.closed).toEqual(["ad-1"]);
    expect(closed).toBe(true);
    expect(r.speaker.knows(token)).toBe(false);
    expect((r.saved.at(-1)!.people as Array<Record<string, unknown>>).some((p) => p.identity === VOICE_IDENTITY)).toBe(false);
    // Leaving again is nothing.
    await r.speaker.leave("room-1");
    expect(r.calls.closed).toEqual(["ad-1"]);
  });
});

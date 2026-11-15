/**
 * THE BOT THAT SITS IN OUR OWN CALLS (src/rooms/scribe.ts, docs/brief.md), and the five seams the room service calls it at.
 *
 * Held here, all without a network: it takes its seat with the first person in and makes the note; it listens to a track only
 * when that person turns their microphone on; a pass writes the document and its line is kept for the call; it answers a
 * question in the call, and not twice in a breath; the last person out closes the ears, writes the last pass and organises
 * the note; and a room with no scribe behaves exactly as a room did before.
 */
import { describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.NODE_ENV = "test";

const { Scribe, SCRIBE_NAME } = await import("../src/rooms/scribe.js");
const { emptyBrief } = await import("../src/brief/types.js");

const text = (s: string) => ({ type: "text", text: s, style: "body" });

function rig(o: { say?: string } = {}) {
  const ears = {
    opened: [] as string[], listened: [] as string[], forgot: [] as string[], stopped: [] as string[],
    open(roomId: string) { ears.opened.push(roomId); },
    async listenTo(_roomId: string, x: { identity: string }) { ears.listened.push(x.identity); return true; },
    async forget(_roomId: string, identity: string) { ears.forgot.push(identity); },
    async stop(roomId: string) { ears.stopped.push(roomId); },
  };
  const saved: Array<Record<string, unknown>> = [];
  const store = { async update(_id: string, patch: Record<string, unknown>) { saved.push(patch); return null; } };
  const lines = [{ who: "Asha", text: "We'll ship on Friday.", at: 0 }];
  const written: Array<{ live: boolean; lines: number }> = [];
  const asked: Array<{ asked: string; who: string }> = [];
  const organised: string[] = [];
  const changed: string[] = [];
  let t = 1_000;
  const scribe = new Scribe({
    ears: ears as never,
    store: store as never,
    brief: {
      async write(i) {
        written.push({ live: i.live, lines: i.lines.length });
        return { parts: [{ id: "said", kind: "said", title: "So far", blocks: [text("They ship on Friday.")] }], ...(o.say ? { say: o.say } : {}) };
      },
    },
    async startNote() { return "note-1"; },
    async heard() { /* the ears' own path, tested in rooms-ears */ },
    async lines() { return lines; },
    async organise(_userId, noteId) { organised.push(noteId); },
    async answer(q) { asked.push({ asked: q.asked, who: q.who }); return "Friday, they said."; },
    changed: (roomId) => changed.push(roomId),
    now: () => t,
  });
  const room = { id: "room-1", userId: "u1", title: "Leaf & Co", host: "Aanya" };
  return { scribe, ears, saved, written, asked, organised, changed, room, at: (ms: number) => { t = ms; } };
}

describe("it takes its seat", () => {
  it("with the first person in: the note is made, the ears opened, and the room told which note", async () => {
    const r = rig();
    await r.scribe.sit(r.room);
    expect(r.scribe.in("room-1")).toBe(true);
    expect(r.ears.opened).toEqual(["room-1"]);
    expect(r.saved[0]).toEqual({ noteId: "note-1" });
    // And it says it is there, with nothing written yet.
    expect(r.scribe.state("room-1")).toEqual({ name: SCRIBE_NAME, taking: true, brief: null });
    // Sitting again is not a second seat.
    await r.scribe.sit(r.room);
    expect(r.ears.opened).toEqual(["room-1"]);
  });

  it("listens to one person only once their microphone is on, and to each of them separately", async () => {
    const r = rig();
    await r.scribe.sit(r.room);
    await r.scribe.hear("room-1", { identity: "aanya", name: "Aanya", sessionId: "s1", trackName: "aanya-audio" });
    await r.scribe.hear("room-1", { identity: "aanya", name: "Aanya", sessionId: "s1", trackName: "aanya-audio" });
    await r.scribe.hear("room-1", { identity: "ravi", name: "Ravi", sessionId: "s2", trackName: "ravi-audio" });
    expect(r.ears.listened).toEqual(["aanya", "ravi"]);
    // Gone: their ear alone.
    await r.scribe.gone("room-1", "aanya");
    expect(r.ears.forgot).toEqual(["aanya"]);
    // A call it is not in is nothing to it.
    await r.scribe.hear("room-2", { identity: "x", name: "X", sessionId: "s", trackName: "t" });
    expect(r.ears.listened).toEqual(["aanya", "ravi"]);
  });
});

describe("the document, while the call runs", () => {
  it("is written by a pass, kept on the room, and its one line is what the call sees", async () => {
    const r = rig({ say: "I've put the date in the doc." });
    await r.scribe.sit(r.room);
    await (r.scribe as unknown as { pass(id: string, live: boolean): Promise<void> }).pass("room-1", true);
    expect(r.written).toEqual([{ live: true, lines: 1 }]);
    const state = r.scribe.state("room-1")!;
    expect(state.brief!.parts[0]!.blocks).toEqual([text("They ship on Friday.")]);
    expect(state.said).toEqual({ text: "I've put the date in the doc.", at: 1_000 });
    expect(r.saved.some((p) => "brief" in p)).toBe(true);
    expect(r.changed).toContain("room-1");
    // Nothing new said since: no second call to the model.
    await (r.scribe as unknown as { pass(id: string, live: boolean): Promise<void> }).pass("room-1", true);
    expect(r.written).toHaveLength(1);
  });
});

describe("asked something in the call", () => {
  it("answers from what was said, keeps it where every screen sees it, and not twice in a breath", async () => {
    const r = rig();
    await r.scribe.sit(r.room);
    expect(await r.scribe.asked("room-1", { asked: "when do we ship?", who: "Ravi" })).toBe("Friday, they said.");
    expect(r.asked).toEqual([{ asked: "when do we ship?", who: "Ravi" }]);
    expect(r.scribe.state("room-1")!.said).toEqual({ text: "Friday, they said.", at: 1_000 });
    // A second question a moment later is not answered.
    expect(await r.scribe.asked("room-1", { asked: "again?", who: "Ravi" })).toBeNull();
    expect(r.asked).toHaveLength(1);
    // Twenty seconds on, it answers again.
    r.at(1_000 + 21_000);
    expect(await r.scribe.asked("room-1", { asked: "and the price?", who: "Asha" })).toBe("Friday, they said.");
    expect(r.asked).toHaveLength(2);
    // A call it is not in: nothing.
    expect(await r.scribe.asked("room-2", { asked: "hello?", who: "X" })).toBeNull();
  });
});

describe("the last person out", () => {
  it("closes the ears, writes the last pass told the call has ended, and organises the note", async () => {
    const r = rig();
    await r.scribe.sit(r.room);
    await r.scribe.leave("room-1");
    expect(r.ears.stopped).toEqual(["room-1"]);
    expect(r.written).toEqual([{ live: false, lines: 1 }]);
    expect(r.organised).toEqual(["note-1"]);
    expect(r.scribe.in("room-1")).toBe(false);
    expect(r.scribe.state("room-1")).toBeNull();
    // Leaving a call it is not in does nothing at all.
    await r.scribe.leave("room-1");
    expect(r.ears.stopped).toEqual(["room-1"]);
  });
});

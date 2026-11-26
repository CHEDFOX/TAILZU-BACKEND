/**
 * THE ONE THING LINGO'S CHAT CAN DO (src/lingo/tool.ts).
 *
 *   - a word somebody reached for goes into the course they are on, mid-conversation
 *   - how they met it is kept, because the scheduler asks for what they went looking for first
 *   - a word already there is left exactly as it is: being mentioned again never resets its history
 *   - half a word is not a word: both the word and its meaning, or nothing
 *   - somebody learning nothing yet is told so, rather than the words going nowhere quietly
 */
import { describe, expect, it } from "vitest";
import { LINGO_TOOL, NOTE_MAX, lingoWords, runLingoNote } from "../src/lingo/tool.js";
import { MemoryLingoStore } from "../src/lingo/store.js";
import { review } from "../src/lingo/schedule.js";
import type { Learner } from "../src/lingo/types.js";

const T0 = Date.UTC(2026, 10, 17, 9, 0, 0);
const learner = (over: Partial<Learner> = {}): Learner => ({
  target: "es", from: "en", level: "a1", goalMin: 10, calls: false, voice: null,
  streakDays: 0, lastDay: null, usedMs: T0, updatedMs: T0, ...over,
});

async function onCourse() {
  const store = new MemoryLingoStore();
  await store.setCourse("u1", learner(), T0);
  return { store, port: lingoWords(store) };
}

describe("writing down a word they reached for", () => {
  it("puts it into the course they are on, with what it means", async () => {
    const { store, port } = await onCourse();
    const r = await runLingoNote(port, "u1", { words: [{ word: "terco", meaning: "stubborn", how: "asked" }] }, T0);
    expect(r.ok).toBe(true);
    const items = await store.items("u1", "es");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ item: "terco", gloss: "stubborn", source: "asked", kind: "word" });
  });

  it("keeps how they met it, because what they went looking for is asked first", async () => {
    const { store, port } = await onCourse();
    await runLingoNote(port, "u1", { words: [
      { word: "uno", meaning: "one", how: "asked" },
      { word: "dos", meaning: "two", how: "said" },
      { word: "tres", meaning: "three", how: "heard" },
      { word: "cuatro", meaning: "four" },
    ] }, T0);
    const by = Object.fromEntries((await store.items("u1", "es")).map((i) => [i.item, i.source]));
    expect(by).toMatchObject({ uno: "asked", dos: "said", tres: "heard" });
    // No answer given: treated as something they reached for, not as something that merely went past them.
    expect(by["cuatro"]).toBe("asked");
  });

  it("calls anything with a space in it a phrase, so it climbs as an utterance", async () => {
    const { store, port } = await onCourse();
    await runLingoNote(port, "u1", { words: [{ word: "por favor", meaning: "please" }, { word: "hola", meaning: "hi" }] }, T0);
    const by = Object.fromEntries((await store.items("u1", "es")).map((i) => [i.item, i.kind]));
    expect(by).toMatchObject({ "por favor": "phrase", hola: "word" });
  });

  it("never resets a word they already have, however often it comes up again", async () => {
    const { store, port } = await onCourse();
    await runLingoNote(port, "u1", { words: [{ word: "terco", meaning: "stubborn" }] }, T0);
    // They have worked on it since.
    const one = (await store.items("u1", "es"))[0]!;
    await store.save("u1", "es", [review(one, "right", true, T0)], T0);
    const before = (await store.items("u1", "es"))[0]!;
    expect(before.spoken).toBe(1);

    const r = await runLingoNote(port, "u1", { words: [{ word: "terco", meaning: "pig-headed" }] }, T0);
    expect(r.ok).toBe(true);
    expect(r.content).toContain("already in the course");
    const after = (await store.items("u1", "es"))[0]!;
    expect(after.spoken, "its history is theirs").toBe(1);
    expect(after.memory.reps).toBe(before.memory.reps);
  });

  it("refuses half a word, rather than asking them a blank question later", async () => {
    const { store, port } = await onCourse();
    const r = await runLingoNote(port, "u1", { words: [{ word: "terco", meaning: "" }, { word: "", meaning: "stubborn" }] }, T0);
    expect(r.ok).toBe(false);
    expect(await store.items("u1", "es")).toHaveLength(0);
  });

  it("says so when they are not learning anything yet, instead of dropping them quietly", async () => {
    const store = new MemoryLingoStore();
    const r = await runLingoNote(lingoWords(store), "u1", { words: [{ word: "terco", meaning: "stubborn" }] }, T0);
    expect(r.ok).toBe(false);
    expect(r.content).toContain("not learning a language yet");
  });

  it("takes a handful at a time and no more", async () => {
    const { store, port } = await onCourse();
    const many = Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, meaning: `m${i}` }));
    await runLingoNote(port, "u1", { words: many }, T0);
    expect((await store.items("u1", "es")).length).toBe(NOTE_MAX);
  });

  it("tells the model plainly never to claim it remembered something it did not write down", () => {
    expect(LINGO_TOOL.description).toContain("Never say you have written something down unless you have called this");
  });
});

describe("who gets the tool", () => {
  const kitFor = async (id: string, lingo: unknown) => {
    const { buildTools, newRecord } = await import("../src/bots/tools.js");
    const { Meter } = await import("../src/bots/meter.js");
    return buildTools({
      bot: { id, name: id, skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] } as never, knowledge: [] },
      userId: "u1", runId: "r1", ports: { lingo } as never, meter: new Meter(1000),
      call: (async () => ({ text: "" })) as never, record: newRecord(),
    });
  };

  it("is Babbl's and nobody else's", async () => {
    const { port } = await onCourse();
    const mine = await kitFor("lingo", port);
    expect(mine.defs.map((d) => d.name)).toContain("lingo_note_words");
    // Another bot handed the same port would be filing words into a course it knows nothing about.
    const theirs = await kitFor("travel", port);
    expect(theirs.defs.map((d) => d.name)).not.toContain("lingo_note_words");
    // And a name with no definition has no handler either, so it cannot be called behind the list's back.
    expect((await theirs.run({ id: "1", name: "lingo_note_words", arguments: "{}" })).ok).toBe(false);
  });

  it("writes a real word through the kit, the way a conversation would", async () => {
    const { store, port } = await onCourse();
    const kit = await kitFor("lingo", port);
    const r = await kit.run({ id: "1", name: "lingo_note_words", arguments: JSON.stringify({ words: [{ word: "terco", meaning: "stubborn", how: "asked" }] }) });
    expect(r.ok).toBe(true);
    expect((await store.items("u1", "es"))[0]).toMatchObject({ item: "terco", source: "asked" });
  });

  it("is simply absent when nothing provides the port", async () => {
    const none = await kitFor("lingo", null);
    expect(none.defs.map((d) => d.name)).not.toContain("lingo_note_words");
  });
});

import { describe, expect, it, beforeEach } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { appendHistoryEntry, statsForUser } from "../src/history/store.js";

const user = { id: "u-breakdowns", email: "a@b.c" } as never;
const keep = { retainHistory: true } as never;

/** Distinct text per row: the store coalesces a repeat of the same cleanup. */
const add = (i: number, over: Record<string, unknown>) =>
  appendHistoryEntry(user, keep, {
    kind: "typing", input: `in ${i}`, output: `out ${i}`, wordsOut: 10, ...over,
  } as never);

describe("what the charts are built from", () => {
  it("splits words by language, and never drops a row", async () => {
    await add(1, { language: "en", output: "hello there", wordsOut: 20 });
    await add(2, { language: "hi", output: "namaste", wordsOut: 10 });
    // No language recorded is "auto" — the setting that produced it — rather
    // than a dropped row, so the slices sum to the words in the window.
    await add(3, { output: "third one", wordsOut: 5 });
    const s = await statsForUser(user, "all");
    expect(s.languageWords).toEqual([
      { language: "en", words: 20 },
      { language: "hi", words: 10 },
      { language: "auto", words: 5 },
    ]);
    expect(s.languageWords!.reduce((n, l) => n + l.words, 0)).toBe(s.wordsOut);
  });

  it("counts an unmarked request as Zu, because that is what it was", async () => {
    await add(4, { output: "unmarked", wordsOut: 7 });
    await add(5, { output: "witty one", wordsOut: 3, presetId: "witty", tone: "casual" });
    const s = await statsForUser(user, "all");
    const zu = s.voiceWords!.find((v) => v.id === "signature");
    const witty = s.voiceWords!.find((v) => v.id === "witty");
    expect(zu!.words).toBeGreaterThanOrEqual(7);
    expect(witty).toEqual({ id: "witty", tone: "casual", words: 3 });
    // Biggest first, so the chart's first slice is the top voice.
    expect(s.voiceWords![0]!.words).toBeGreaterThanOrEqual(s.voiceWords![1]!.words);
  });
});

describe("dictionary density", () => {
  const u2 = { id: "u-dict", email: "d@b.c" } as never;

  it("counts saved words, not occurrences", async () => {
    await appendHistoryEntry(u2, keep, {
      kind: "typing", input: "a", output: "Nykaa Nykaa Nykaa and Kubernetes", wordsOut: 5,
    } as never);
    const s = await statsForUser(u2, "all", 0, ["Nykaa", "Kubernetes", "Sequoia"]);
    // One word used three times is still one word used.
    expect(s.dictionary).toMatchObject({ saved: 3, used: 2, unused: 1, scanned: 1 });
    expect(s.dictionary!.top![0]).toEqual({ word: "Nykaa", uses: 1 });
  });

  it("matches whole words, so a saved name is not used by every word containing it", async () => {
    const u3 = { id: "u-dict-3", email: "e@b.c" } as never;
    await appendHistoryEntry(u3, keep, {
      kind: "typing", input: "a", output: "the analysis is ready", wordsOut: 4,
    } as never);
    // "Ana" inside "analysis" must not count, or the chart says the list is
    // working when it is not.
    const s = await statsForUser(u3, "all", 0, ["Ana"]);
    expect(s.dictionary).toMatchObject({ saved: 1, used: 0, unused: 1 });
  });

  it("says nothing rather than zero when there is nothing to scan", async () => {
    const u4 = { id: "u-dict-4", email: "f@b.c" } as never;
    // No history at all: "none of your words are used" would be a different
    // and untrue claim.
    expect((await statsForUser(u4, "all", 0, ["Nykaa"])).dictionary).toBeUndefined();
    // And no saved words: there is no list to have a density.
    await appendHistoryEntry(u4, keep, {
      kind: "typing", input: "a", output: "some text", wordsOut: 2,
    } as never);
    expect((await statsForUser(u4, "all", 0, [])).dictionary).toBeUndefined();
  });
});

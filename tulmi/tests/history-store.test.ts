import { describe, expect, it } from "vitest";
import type { AuthedUser } from "../src/auth/supabase.js";
import type { Personality } from "../../shared/types/api.js";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import {
  appendHistoryEntry,
  coalesce,
  deleteHistoryEntry,
  hasConsentedToHistory,
  listHistory,
  statsForUser,
  TYPING_WORDS_PER_MINUTE,
} from "../src/history/store.js";

function makeUser(id: string): AuthedUser {
  return { id, email: `${id}@test.local` };
}

const CONSENT_HISTORY: Personality = { retainHistory: true };

describe("hasConsentedToHistory", () => {
  it("keeps history by default, and still obeys an explicit opt-out", () => {
    // The toggle that used to set this was removed from Settings, which left
    // the flag unreachable and History permanently empty with no way for
    // anyone to turn it on. Default is now ON — but a user who explicitly
    // said no must STAY no, which is the half worth a test.
    expect(hasConsentedToHistory(undefined)).toBe(true);
    expect(hasConsentedToHistory({})).toBe(true);
    expect(hasConsentedToHistory({ retainHistory: false })).toBe(false);
  });

  it("returns true when learnFromSent is set", () => {
    expect(hasConsentedToHistory({ learnFromSent: true })).toBe(true);
  });

  it("returns true when retainHistory is set", () => {
    expect(hasConsentedToHistory({ retainHistory: true })).toBe(true);
  });
});

describe("appendHistoryEntry", () => {
  it("no-ops when the user has explicitly opted out", async () => {
    const user = makeUser("hs-noconsent");
    await appendHistoryEntry(
      user,
      { retainHistory: false }, // explicit no
      { kind: "typing", input: "hi", output: "hi." },
    );
    const { entries } = await listHistory(user);
    expect(entries).toEqual([]);
  });

  it("writes when consent is given and listHistory returns it", async () => {
    const user = makeUser("hs-write");
    await appendHistoryEntry(
      user,
      CONSENT_HISTORY,
      { kind: "typing", input: "raw", output: "clean" },
    );
    const { entries } = await listHistory(user);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.input).toBe("raw");
    expect(entries[0]?.output).toBe("clean");
    expect(entries[0]?.kind).toBe("typing");
    // The row should have a UUID id + createdAt.
    expect(entries[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof entries[0]?.createdAt).toBe("string");
  });
});

describe("coalescing", () => {
  it("drops an exact repeat inside the window — a retried upload", async () => {
    const user = makeUser("hs-retry");
    const entry = { kind: "voice" as const, input: "hello there", output: "Hello there." };
    await appendHistoryEntry(user, CONSENT_HISTORY, entry);
    await appendHistoryEntry(user, CONSENT_HISTORY, entry);
    const { entries } = await listHistory(user);
    expect(entries).toHaveLength(1);
  });

  it("folds the refine of a dictation into the dictation's row", async () => {
    const user = makeUser("hs-fold");
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "voice", input: "send it monday", output: "send it monday",
    });
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "typing", input: "send it monday", output: "Send it on Monday.",
    });
    const { entries } = await listHistory(user);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("voice");
    expect(entries[0]?.input).toBe("send it monday");
    expect(entries[0]?.output).toBe("Send it on Monday.");
  });

  it("folds a refine of one late segment into the text the row already holds", async () => {
    const user = makeUser("hs-fold-fragment");
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "voice", input: "x", output: "First part. second part",
    });
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "typing", input: "second part", output: "Second part.",
    });
    const { entries } = await listHistory(user);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.output).toBe("First part. Second part.");
  });

  it("keeps a genuinely new entry", async () => {
    const user = makeUser("hs-new");
    await appendHistoryEntry(user, CONSENT_HISTORY, { kind: "voice", input: "a", output: "A." });
    await appendHistoryEntry(user, CONSENT_HISTORY, { kind: "typing", input: "b", output: "B." });
    const { entries } = await listHistory(user);
    expect(entries).toHaveLength(2);
  });

  it("does nothing outside the window", () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    expect(coalesce({ kind: "voice", input: "a", output: "a", createdAt: old },
                    { kind: "voice", input: "a", output: "a" })).toBeNull();
  });

  it("is off when the window is 0", () => {
    const prevEnv = process.env.HISTORY_COALESCE_MS;
    process.env.HISTORY_COALESCE_MS = "0";
    try {
      expect(coalesce({ kind: "voice", input: "a", output: "a", createdAt: new Date().toISOString() },
                      { kind: "voice", input: "a", output: "a" })).toBeNull();
    } finally {
      if (prevEnv === undefined) delete process.env.HISTORY_COALESCE_MS;
      else process.env.HISTORY_COALESCE_MS = prevEnv;
    }
  });
});

describe("listHistory", () => {
  it("respects the limit option", async () => {
    const user = makeUser("hs-limit");
    for (let i = 0; i < 5; i++) {
      await appendHistoryEntry(user, CONSENT_HISTORY, {
        kind: "typing",
        input: `in${i}`,
        output: `out${i}`,
      });
    }
    const { entries } = await listHistory(user, { limit: 2 });
    expect(entries).toHaveLength(2);
  });

  it("respects the kind filter", async () => {
    const user = makeUser("hs-kind");
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "typing",
      input: "typed",
      output: "polished",
    });
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "voice",
      input: "spoken",
      output: "spoken clean",
    });
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "draft",
      input: "intent",
      output: "reply",
    });

    const typing = await listHistory(user, { kind: "typing" });
    expect(typing.entries.map((e) => e.kind)).toEqual(["typing"]);
    const voice = await listHistory(user, { kind: "voice" });
    expect(voice.entries.map((e) => e.kind)).toEqual(["voice"]);
  });

  it("returns a nextBefore cursor when more rows exist and paginates through all", async () => {
    const user = makeUser("hs-page");
    for (let i = 0; i < 5; i++) {
      await appendHistoryEntry(user, CONSENT_HISTORY, {
        kind: "typing",
        input: `in${i}`,
        output: `out${i}`,
      });
      // Ensure each entry gets a distinct createdAt so the cursor advances.
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = await listHistory(user, { limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextBefore).toBeDefined();

    const page2 = await listHistory(user, {
      limit: 2,
      before: page1.nextBefore!,
    });
    expect(page2.entries).toHaveLength(2);

    const page3 = await listHistory(user, {
      limit: 2,
      before: page2.nextBefore!,
    });
    expect(page3.entries).toHaveLength(1);
    // Last page → no more cursor.
    expect(page3.nextBefore).toBeUndefined();
  });
});

describe("deleteHistoryEntry", () => {
  it("soft-deletes an entry so it disappears from listHistory", async () => {
    const user = makeUser("hs-del");
    await appendHistoryEntry(user, CONSENT_HISTORY, {
      kind: "typing",
      input: "in",
      output: "out",
    });
    const { entries } = await listHistory(user);
    expect(entries).toHaveLength(1);
    const id = entries[0]!.id;
    const ok = await deleteHistoryEntry(user, id);
    expect(ok).toBe(true);
    const after = await listHistory(user);
    expect(after.entries).toEqual([]);
  });

  it("returns false for a nonexistent id", async () => {
    const user = makeUser("hs-del-missing");
    const ok = await deleteHistoryEntry(user, "00000000-0000-0000-0000-000000000000");
    expect(ok).toBe(false);
  });
});

describe("statsForUser", () => {
  it("returns totals + a length-7 sparkline for the 'week' window", async () => {
    const user = makeUser("hs-stats");
    for (let i = 0; i < 3; i++) {
      await appendHistoryEntry(
        user,
        CONSENT_HISTORY,
        {
          kind: "voice",
          // Distinct per row: identical input seconds apart is a retried
          // upload and is coalesced away on purpose.
          input: `hi ${i}`,
          output: "cleaned output",
          wordsOut: 40,
        },
        // audioSeconds — internal audioSeconds param
        12,
      );
    }
    const stats = await statsForUser(user, "week");
    expect(stats.window).toBe("week");
    expect(stats.requests).toBe(3);
    expect(stats.wordsOut).toBe(120);
    expect(stats.audioSeconds).toBe(36);
    expect(stats.sparklinePerDay).toHaveLength(7);
    // All three requests happened "today" — the last bucket carries them.
    expect(stats.sparklinePerDay[6]).toBe(3);
  });

  it("computes minutesSaved as wordsOut / 40, rounded to one decimal", async () => {
    const user = makeUser("hs-minutes");
    // 40 wpm baseline; 100 words → 2.5 minutes.
    await appendHistoryEntry(
      user,
      CONSENT_HISTORY,
      { kind: "typing", input: "x", output: "y", wordsOut: 100 },
    );
    const stats = await statsForUser(user, "week");
    expect(stats.wordsOut).toBe(100);
    expect(stats.minutesSaved).toBe(2.5);
    // Sanity: matches the exported constant we're deriving from.
    expect(TYPING_WORDS_PER_MINUTE).toBe(40);
  });
});

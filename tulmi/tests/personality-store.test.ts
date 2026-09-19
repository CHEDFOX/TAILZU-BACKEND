import { describe, expect, it } from "vitest";
import type { AuthedUser } from "../src/auth/supabase.js";

// Same env priming pattern as vocabulary.test.ts — DEV_SKIP_AUTH routes the
// personality store to its in-memory map so tests never touch Supabase.
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import {
  getPersonality,
  savePersonality,
  resolvePersonality,
  learnVocabularyCorrections,
  upsertPresetTone,
  VOCAB_MAX_LINES,
} from "../src/personality/store.js";
// eslint-disable-next-line import/first
import { applyPresetOverrides, PERSONALITY_PRESETS } from "../src/experience/personalityPresets.js";

function makeUser(id: string): AuthedUser {
  return { id, email: `${id}@test.local` };
}

describe("tone editor — custom + edited tones", () => {
  it("applyPresetOverrides appends a custom (non-builtin) tone", () => {
    const list = applyPresetOverrides({ custom_abc: { name: "Snarky", promptStyle: "Be dry and witty." } });
    expect(list.length).toBe(PERSONALITY_PRESETS.length + 1);
    const custom = list.find((p) => p.id === "custom_abc");
    expect(custom?.name).toBe("Snarky");
    expect(custom?.promptStyle).toBe("Be dry and witty.");
  });

  it("applyPresetOverrides edits a built-in tone's name + prompt", () => {
    const list = applyPresetOverrides({ professional: { name: "Boardroom", promptStyle: "Crisp and formal." } });
    expect(list.length).toBe(PERSONALITY_PRESETS.length); // no new entry
    const edited = list.find((p) => p.id === "professional");
    expect(edited?.name).toBe("Boardroom");
    expect(edited?.promptStyle).toBe("Crisp and formal.");
  });

  it("upsertPresetTone creates, edits, and removes a tone (and activates on save)", async () => {
    const user = makeUser("tone-editor");
    // Create — no id → mints a custom id, becomes active.
    const created = await upsertPresetTone(user, { name: "Poet", promptStyle: "Image-first." });
    expect(created.toneId).toMatch(/^custom_/);
    let p = await getPersonality(user);
    expect(p.activePresetId).toBe(created.toneId);
    expect(p.presetOverrides?.[created.toneId]?.name).toBe("Poet");

    // Editing a built-in doesn't wipe the custom one.
    await upsertPresetTone(user, { id: "friendly", name: "Buddy", promptStyle: "Warm." });
    p = await getPersonality(user);
    expect(p.presetOverrides?.[created.toneId]?.name).toBe("Poet");
    expect(p.presetOverrides?.friendly?.name).toBe("Buddy");

    // Edit the custom tone → it becomes active again.
    await upsertPresetTone(user, { id: created.toneId, name: "Poet v2", promptStyle: "Image-first, terse." });
    p = await getPersonality(user);
    expect(p.presetOverrides?.[created.toneId]?.name).toBe("Poet v2");
    expect(p.activePresetId).toBe(created.toneId);

    // Remove the (active) custom tone → gone, active resets to signature.
    await upsertPresetTone(user, { id: created.toneId, remove: true });
    p = await getPersonality(user);
    expect(p.presetOverrides?.[created.toneId]).toBeUndefined();
    expect(p.activePresetId).toBe("signature");
  });
});

describe("personality store — save/get", () => {
  it("round-trips savePersonality → getPersonality", async () => {
    const user = makeUser("ps-round");
    await savePersonality(user, {
      tone: "warm, concise",
      formality: "casual",
      emoji: "minimal",
      signature: "— T",
    });
    const loaded = await getPersonality(user);
    expect(loaded).toEqual({
      tone: "warm, concise",
      formality: "casual",
      emoji: "minimal",
      signature: "— T",
    });
  });

  it("getPersonality returns {} for a user with no saved profile", async () => {
    const user = makeUser("ps-empty");
    const loaded = await getPersonality(user);
    expect(loaded).toEqual({});
  });
});

describe("resolvePersonality", () => {
  it("returns the request override when provided (does not touch storage)", async () => {
    const user = makeUser("ps-override");
    await savePersonality(user, { tone: "SAVED", formality: "formal" });
    const resolved = await resolvePersonality(user, {
      tone: "OVERRIDE",
      emoji: "expressive",
    });
    // Override wins wholesale — no merge with the saved profile.
    expect(resolved).toEqual({ tone: "OVERRIDE", emoji: "expressive" });
  });

  it("falls back to the saved profile when override is undefined", async () => {
    const user = makeUser("ps-fallback");
    await savePersonality(user, { tone: "SAVED", formality: "formal" });
    const resolved = await resolvePersonality(user, undefined);
    expect(resolved).toEqual({ tone: "SAVED", formality: "formal" });
  });

  it("falls back when override is present but empty ({})", async () => {
    const user = makeUser("ps-empty-override");
    await savePersonality(user, { tone: "SAVED" });
    const resolved = await resolvePersonality(user, {});
    expect(resolved).toEqual({ tone: "SAVED" });
  });
});

describe("learnVocabularyCorrections — edge cases", () => {
  it("caps the total at VOCAB_MAX_LINES (drop-oldest FIFO)", async () => {
    const user = makeUser("ps-vocab-cap");
    const seeded = Array.from({ length: VOCAB_MAX_LINES }, (_, i) => `t${i}`);
    await savePersonality(user, { vocabulary: seeded.join("\n") });
    const next = await learnVocabularyCorrections(user, [
      { from: "x", to: "brandnew" },
    ]);
    const lines = (next.vocabulary ?? "").split("\n");
    expect(lines.length).toBe(VOCAB_MAX_LINES);
    expect(lines).toContain("brandnew");
    // Oldest one dropped.
    expect(lines).not.toContain("t0");
  });

  it("skips corrections whose 'to' is empty or whitespace", async () => {
    const user = makeUser("ps-vocab-empty");
    const next = await learnVocabularyCorrections(user, [
      { from: "a", to: "" },
      { from: "b", to: "   " },
      { from: "c", to: "KeepMe" },
    ]);
    const lines = (next.vocabulary ?? "").split("\n").filter(Boolean);
    expect(lines).toEqual(["KeepMe"]);
  });
});

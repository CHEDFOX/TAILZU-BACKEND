import { describe, expect, it } from "vitest";
import { looksLikeMeta, looksLikeEmptyEcho } from "../src/pipeline/cleanup.js";

// Regression guard for the "typepad shows a chat reply" failure: the refine LLM
// sometimes answers conversationally on silence/noise ("I don't get anything,
// speak again") instead of returning a rewrite. That must never reach the
// cursor — looksLikeMeta flags it so the pipeline discards it to "".
describe("looksLikeMeta — reject conversational refusals/clarifications", () => {
  const meta = [
    "I don't get anything, speak again",
    "I didn't catch that, could you say that again?",
    "Sorry, I couldn't hear you.",
    "Please repeat that.",
    "Say that again?",
    "No speech detected.",
    "No audio was received.",
    "Nothing was said.",
  ];
  for (const m of meta) {
    it(`flags: ${m}`, () => expect(looksLikeMeta(m)).toBe(true));
  }

  // Must NOT eat legitimate rewrites — even short ones, or ones that happen to
  // contain a trigger word inside a real sentence.
  const legit = [
    "Let's try again tomorrow at noon.",
    "I don't get why the build failed, can you check the logs?",
    "Can you repeat the order for table four?",
    "Running late, be there in ten.",
    "Sounds good, see you then.",
    "",
    "   ",
  ];
  for (const t of legit) {
    it(`keeps: ${JSON.stringify(t)}`, () => expect(looksLikeMeta(t)).toBe(false));
  }

  it("does not flag a long paragraph even if it mentions hearing/repeating", () => {
    const long =
      "Thanks for the update. I did hear you earlier and I'll repeat the plan " +
      "back so we're aligned: we ship Friday, review Monday, and try again if " +
      "the numbers don't hold. Let me know if that works for everyone.";
    expect(looksLikeMeta(long)).toBe(false);
  });
});

/**
 * The model typing the absence instead of producing it.
 *
 * The prompt said "output an EMPTY STRING" on silence, and models did exactly
 * that — the words landed in the user's message. The prompt no longer names a
 * literal, but an instruction about emptiness will always tempt a placeholder,
 * so the echo is caught here too.
 */
describe("looksLikeEmptyEcho — the placeholder never reaches the cursor", () => {
  it("catches the literal the old prompt taught it to write", () => {
    for (const s of [
      "EMPTY STRING",
      "empty string",
      "an empty string",
      '""',
      "(empty)",
      "<empty>",
      "[EMPTY]",
      "empty response",
      "no output",
      "nothing",
      "none",
      "null",
      "N/A",
      "n/a",
      "blank",
      "  EMPTY STRING  ",
      "*empty*",
    ]) {
      expect(looksLikeEmptyEcho(s), `should be caught: ${JSON.stringify(s)}`).toBe(true);
    }
  });

  it("never touches a real message that merely contains the words", () => {
    // These words are ordinary English and people dictate them. A guard that
    // fired inside a sentence would delete somebody's actual message, which is
    // far worse than the bug it is fixing.
    for (const s of [
      "the box was empty when it arrived",
      "nothing works on this laptop, can you look",
      "send me the blank form",
      "none of them replied yet",
      "I got null pointer again on the login screen",
      "N/A means we skip that row",
      "empty the dishwasher before you go",
      // A bare question mark IS a message people send. Only a MATCHED, empty
      // pair of wrappers counts as the model showing us an empty string.
      "?",
      "...",
      "!!",
    ]) {
      expect(looksLikeEmptyEcho(s), `must survive: ${JSON.stringify(s)}`).toBe(false);
    }
  });

  it("ignores empty input and anything long enough to be a sentence", () => {
    expect(looksLikeEmptyEcho("")).toBe(false);
    expect(looksLikeEmptyEcho("   ")).toBe(false);
    // Bounded hard at a couple of words, so a long line starting with one of
    // these can never be swallowed whole.
    expect(looksLikeEmptyEcho("empty string of lights for the balcony please")).toBe(false);
  });
});

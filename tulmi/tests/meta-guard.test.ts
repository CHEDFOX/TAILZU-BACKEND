import { describe, expect, it } from "vitest";
import { looksLikeMeta } from "../src/pipeline/cleanup.js";

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

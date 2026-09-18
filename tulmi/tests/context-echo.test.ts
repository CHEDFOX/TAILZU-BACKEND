import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { stripEchoedContext } from "../src/pipeline/cleanup.js";

/**
 * The field keeps what the user already typed. The keyboard's deferred path
 * inserts at the cursor and its live path deletes only the tail it inserted
 * itself, so anything the model repeats back appears on screen twice.
 *
 * The prompt says not to, in as many words, and the deployed server did it
 * three runs out of three. A fragment continuing a half-typed line genuinely
 * reads as an unfinished sentence, and finishing it is the helpful-looking
 * move — so this is checked rather than asked for.
 */
describe("stripEchoedContext", () => {
  it("removes the prior text the model repeated", () => {
    expect(stripEchoedContext(
      "I checked with the team and we can do Friday.",
      "I checked with the team and",
    )).toBe("we can do Friday.");
  });

  it("tolerates re-punctuation at the seam", () => {
    // A model that echoes almost always tidies as it goes.
    expect(stripEchoedContext(
      "I checked with the team, and we can do Friday.",
      "I checked with the team and",
    )).toBe("we can do Friday.");
    expect(stripEchoedContext(
      "Hi Priya — I'll send the deck tonight.",
      "Hi Priya,",
    )).toBe("I'll send the deck tonight.");
  });

  it("ignores case and spacing, which are not the echo", () => {
    expect(stripEchoedContext(
      "hi   priya, I'll send the deck tonight.",
      "Hi Priya,",
    )).toBe("I'll send the deck tonight.");
  });

  it("leaves output alone when it is not an echo", () => {
    // The overwhelmingly common case: the model obeyed.
    expect(stripEchoedContext("We can do Friday.", "I checked with the team and"))
      .toBe("We can do Friday.");
    // A shared first word is not an echo.
    expect(stripEchoedContext("I'll be late.", "I checked with the team and"))
      .toBe("I'll be late.");
  });

  it("never returns nothing", () => {
    // If the model wrote only the echo it added nothing, and inserting an
    // empty string would look like the dictation was swallowed.
    expect(stripEchoedContext("I checked with the team and", "I checked with the team and"))
      .toBe("I checked with the team and");
  });

  it("does nothing without a context", () => {
    expect(stripEchoedContext("We can do Friday.", undefined)).toBe("We can do Friday.");
    expect(stripEchoedContext("We can do Friday.", "   ")).toBe("We can do Friday.");
    expect(stripEchoedContext("", "anything")).toBe("");
  });

  it("works outside Latin script", () => {
    expect(stripEchoedContext(
      "मैंने टीम से बात की, हम शुक्रवार को कर सकते हैं।",
      "मैंने टीम से बात की",
    )).toBe("हम शुक्रवार को कर सकते हैं।");
  });

  it("does not cut a longer sentence that merely starts similarly", () => {
    // The context must be fully consumed before anything is removed.
    expect(stripEchoedContext("I checked with the", "I checked with the team and"))
      .toBe("I checked with the");
  });
});

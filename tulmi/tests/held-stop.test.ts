/**
 * A full stop held at a pause (assistPrompt's held stop): the desktop pastes
 * each stretch of a dictation as they pause, holds back the full stop that
 * ends it, and says so (heldStop) with the next stretch, which decides
 * whether the stop goes in. What must hold: the writer is told only when there
 * is a <before> to have held it from; and an answer that opens with the stop
 * reaches the desktop with the stop first and no space in front of it.
 */
import { describe, expect, it, vi } from "vitest";

let answer = "";
const seen: string[] = [];
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async (req: { messages: Array<{ role: string; content: string }> }) => {
      seen.push(req.messages.find((m) => m.role === "system")?.content ?? "");
      return { choices: [{ message: { content: answer } }] };
    } } };
  },
}));
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const { buildAssistSystem } = await import("../src/pipeline/assistPrompt.js");
const { assist } = await import("../src/pipeline/cleanup.js");
const { joinWithSpace } = await import("../src/pipeline/join.js");

const HELD = /the full stop that would end it is not written yet/;

describe("a full stop held at a pause", () => {
  it("is in the writer's rules only when asked for, and only with something before it", () => {
    expect(buildAssistSystem({ hasContext: true, heldStop: true })).toMatch(HELD);
    expect(buildAssistSystem({ hasContext: true })).not.toMatch(HELD);
    expect(buildAssistSystem({ hasContext: true, heldStop: false })).not.toMatch(HELD);
  });

  it("reaches the writer from assist() with the context it was held from, and not without one", async () => {
    answer = "breaks, and one sentence gets cut in two.";
    seen.length = 0;
    await assist("breaks and a single sentence gets cut in two", { context: "The refinement is arriving in", heldStop: true });
    await assist("breaks and a single sentence gets cut in two", { heldStop: true });
    expect(seen[0]).toMatch(HELD);
    expect(seen[1]).not.toMatch(HELD);
  });

  it("carries a sentence on: no stop, no capital, a space before it", async () => {
    answer = "breaks, and one sentence gets cut in two.";
    const out = await assist("breaks and a single sentence gets cut in two", { context: "The refinement is arriving in", heldStop: true });
    expect(out).toBe("breaks, and one sentence gets cut in two.");
    expect(joinWithSpace("The refinement is arriving in", out)).toBe(true);
  });

  it("closes the last sentence by opening with the stop, pasted with no space in front", async () => {
    answer = ". Then we can look at the budget.";
    const out = await assist("then we can look at the budget", { context: "I finished the report", heldStop: true });
    expect(out).toBe(". Then we can look at the budget.");
    expect(joinWithSpace("I finished the report", out)).toBe(false);
  });
});

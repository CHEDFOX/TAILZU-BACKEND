/**
 * The instruction comes off before the writer sees it.
 *
 * "How are you? Write this in Japanese" came back as
 * "How are you?日本語で書いてください" — the message left as it was and the
 * instruction translated into it. The prompt already said to do the request
 * and write the rest; it lost. So an unmistakable trailing instruction is cut
 * in code, and the writer gets the message and the request separately.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ system: string; user: string }> = [];
let reply = "";
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (req: { messages: Array<{ role: string; content: string }> }) => {
          calls.push({ system: req.messages[0]!.content, user: req.messages[1]!.content });
          return { choices: [{ message: { content: reply } }] };
        },
      },
    };
  },
}));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const { splitInstruction } = await import("../src/pipeline/commands.js");
const { assist } = await import("../src/pipeline/cleanup.js");
const { buildAssistSystem } = await import("../src/pipeline/assistPrompt.js");

describe("what counts as an instruction", () => {
  it("cuts a request that follows a finished sentence", () => {
    expect(splitInstruction("How are you? Write this in Japanese")).toEqual({
      message: "How are you?",
      command: { kind: "language", lang: "japanese" },
    });
    expect(splitInstruction("Hi Priya, the deck is done. Translate it to Hindi.").command)
      .toEqual({ kind: "translate", lang: "hindi" });
  });

  it("cuts a request set off by a break or a connector", () => {
    expect(splitInstruction("kal milte hain paanch baje, make it formal"))
      .toEqual({ message: "kal milte hain paanch baje", command: { kind: "formal" } });
    expect(splitInstruction("the meeting moved to three and make it shorter").command)
      .toEqual({ kind: "shorter" });
  });

  it("takes the whole connector, and counts a line break as a boundary", () => {
    // "and then" used to leave its "and" behind, at the end of the message.
    expect(splitInstruction("ok so, and then make it shorter"))
      .toEqual({ message: "ok so", command: { kind: "shorter" } });
    expect(splitInstruction("the plan is ready\nmake it shorter"))
      .toEqual({ message: "the plan is ready", command: { kind: "shorter" } });
  });

  it("leaves a sentence that only ends like a request", () => {
    // No boundary: the words run straight on from the message.
    expect(splitInstruction("tell him I will reply in Spanish").command).toBeNull();
    expect(splitInstruction("Can you write this in Japanese").command).toBeNull();
  });

  it("leaves a 'language' that is not one", () => {
    expect(splitInstruction("Here are the notes. Write it in bold").command).toBeNull();
  });

  it("leaves a request with nothing else in it to the writer", () => {
    expect(splitInstruction("make it shorter")).toEqual({ message: "make it shorter", command: null });
  });
});

describe("the writer never sees the request", () => {
  beforeEach(() => { calls.length = 0; });

  it("gets the message alone, and the language as the rule for this message", async () => {
    reply = "お元気ですか？";
    const out = await assist("How are you? Write this in Japanese", {});
    expect(out).toBe("お元気ですか？");
    expect(calls[0]!.user).toContain("How are you?");
    expect(calls[0]!.user).not.toMatch(/japanese/i);
    expect(calls[0]!.system).toContain("Write in Japanese.");
  });

  it("is told any other request as what to do, not words to write", async () => {
    reply = "We meet at five.";
    await assist("We will meet at five. Make it formal", {});
    expect(calls[0]!.user).not.toMatch(/make it formal/i);
    expect(calls[0]!.system).toMatch(/For this message they asked you: .*FORMAL/);
  });

  it("falls back to the message without the request, never the raw sentence", async () => {
    // A runaway completion is discarded; what goes out is what they meant to
    // send, not their instruction to the keyboard.
    reply = Array.from({ length: 400 }, () => "word").join(" ");
    const out = await assist("Running late. Make it shorter", {});
    expect(out).toBe("Running late.");
  });

  it("does not treat a requested script as a transliteration to undo", async () => {
    reply = "कल मिलते हैं, पांच बजे।";
    const out = await assist("kal milte hain paanch baje. Write it in Hindi", {});
    expect(out).toBe("कल मिलते हैं, पांच बजे।");
  });

  it("puts the reading in their script first, whichever engine typed first", async () => {
    reply = "ok";
    await assist("mujhe kal jaldi uthna hai", { alternative: "मुझे कल जल्दी उठना है" });
    const u = calls[0]!.user;
    expect(u.indexOf("मुझे")).toBeLessThan(u.indexOf("mujhe"));
  });
});

describe("the principle, stated once", () => {
  it("says the request is done, never written, in any language", () => {
    const t = buildAssistSystem({ hasContext: false });
    expect(t).toMatch(/Do that part; write the rest, never the request, in any language/);
    expect(t).toMatch(/asides to the keyboard go/);
  });
});

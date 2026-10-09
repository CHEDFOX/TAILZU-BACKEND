/**
 * The owner's dictation that came back as said:
 *
 *   "But how do they do it, like, without forwarding to a number? How they
 *    are, how they can possibly take calls for me?"
 *
 * No check undid a good rewrite: the writer handed the words back with the
 * spoken "like" and the restart in them, and nothing checked for either.
 * Now both are slips, asked about once, and the prompt's test for what goes
 * is the one a typist passes without thinking.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const llm = vi.hoisted(() => ({ answers: [] as string[], calls: [] as Array<Array<{ role: string; content: string }>> }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (req: { messages: Array<{ role: string; content: string }> }) => {
          llm.calls.push(req.messages);
          return { choices: [{ message: { content: llm.answers.shift() ?? "" } }] };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { assist, slipIn } = await import("../src/pipeline/cleanup.js");
const { buildAssistSystem } = await import("../src/pipeline/assistPrompt.js");

beforeEach(() => { llm.answers = []; llm.calls = []; });

const SAID = "But how do they do it, like, without forwarding to a number? How they are, how they can possibly take calls for me?";
const MEANT = "But how do they do it without forwarding to a number? How can they possibly take calls for me?";

describe("what speech adds that typing never would", () => {
  it("a spoken like kept is a slip, and so is a restart kept", () => {
    expect(slipIn(SAID, SAID)).toBe("filler");
    expect(slipIn(SAID, SAID.replace(", like,", ""))).toBe("restart");
    expect(slipIn(SAID, MEANT)).toBeNull();
    for (const [said, wrote] of [
      ["i was going to, i was going to call you", "I was going to, I was going to call you."],
      ["we need to, we need to fix the build", "We need to, we need to fix the build."],
    ] as const) expect(slipIn(said, wrote)).toBe("restart");
    expect(slipIn("it was, you know, fine", "It was, you know, fine.")).toBe("filler");
  });

  it("leaves alone what is not one", () => {
    for (const [said, wrote] of [
      ["thank you, thank you so much", "Thank you, thank you so much!"],
      ["things I like, and things I don't", "Things I like, and things I don't."],
      ["I would like, if possible, a window seat", "I would like, if possible, a window seat."],
      ["how do they do it", "How do they do it?"],
    ] as const) expect(slipIn(said, wrote)).toBeNull();
    // A piece they asked for may repeat itself on purpose.
    expect(slipIn("write a poem", "I miss you more, I miss you most", { piece: true })).toBeNull();
  });

  it("the answer handed back as said is asked about once, and the clean one goes out", async () => {
    llm.answers = [
      `<intent>a question to a friend</intent><send>${SAID}</send>`,
      MEANT,
    ];
    expect(await assist(SAID)).toBe(MEANT);
    const redo = llm.calls[1]!.at(-1)!.content;
    expect(redo).toMatch(/spoken "like"/);
  });

  it("a restart asked about twice keeps the first answer, not the transcript", async () => {
    const kept = "But how do they do it without forwarding to a number? How they are, how they can possibly take calls for me?";
    llm.answers = [`<intent>a question</intent><send>${kept}</send>`, kept];
    expect(await assist(SAID)).toBe(kept);
  });

  it("the prompt says what goes by what typing never would, and keeps language its own line", () => {
    const t = buildAssistSystem({ hasContext: true, targetApp: "WhatsApp", script: "latin" });
    expect(t).toMatch(/without what speech adds that typing never would/);
    expect(t).not.toMatch(/Their words stay theirs/);
    expect(t).toMatch(/Never translate their words/);
  });
});

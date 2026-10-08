/**
 * What the quality run's refinements showed, read one by one rather than
 * scored: outputs that passed every check and still read badly.
 *
 * The owner: "i want to see test refinments too". Reading them found raw
 * text coming back unchanged, a request carried out in ChatGPT, a
 * placeholder in a message, and a Korean "음" pasted for a hum.
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

const { assist, slipIn, stripPlaceholders, tidyRaw, stripEdgeFiller } = await import("../src/pipeline/cleanup.js");
const { isFillerOnly } = await import("../src/pipeline/speechGate.js");
const { buildAssistSystem } = await import("../src/pipeline/assistPrompt.js");

beforeEach(() => { llm.answers = []; llm.calls = []; });

describe("nothing written for words they said is asked again", () => {
  it("and the second answer is used", async () => {
    llm.answers = ["<intent>a question to me</intent><send></send>", "<send>What time does the movie start?</send>"];
    expect(await assist("what time does the movie start")).toBe("What time does the movie start?");
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]![3]!.content).toMatch(/wrote nothing, but they did say something/);
  });

  it("twice empty: their words go out, tidied, never as typed", async () => {
    llm.answers = ["<send></send>", "<send></send>"];
    expect(await assist("add 250 ml water and 2 spoons sugar")).toBe("Add 250 ml water and 2 spoons sugar.");
  });
});

describe("a request in an AI app is their prompt, never done", () => {
  it("carried out is caught by its missing verb, and asked again", async () => {
    expect(slipIn("write a birthday message for my mom", "Happy birthday, Mom!", { toAnAi: true })).toBe("carried");
    expect(slipIn("write a birthday message for my mom", "Write a warm birthday message for my mom.", { toAnAi: true })).toBeNull();
    // Outside an AI app, writing it is the job.
    expect(slipIn("write a birthday message for my mom", "Happy birthday, Mom!", { piece: true })).toBeNull();

    llm.answers = ["<send>Happy birthday, Mom!</send>", "<send>Write a heartfelt birthday message for my mom.</send>"];
    expect(await assist("write a birthday message for my mom", { targetApp: "ChatGPT" }))
      .toBe("Write a heartfelt birthday message for my mom.");
  });

  it("carried out twice: what they said goes out as the prompt", async () => {
    llm.answers = ["<send>Happy birthday, Mom!</send>", "<send>Happy birthday, dear Mom!</send>"];
    expect(await assist("write a birthday message for my mom", { targetApp: "ChatGPT" }))
      .toBe("Write a birthday message for my mom.");
  });
});

describe("their words, when they go out as said", () => {
  it("get a capital and an end mark", () => {
    expect(tidyRaw("what time does the movie start")).toBe("What time does the movie start?");
    expect(tidyRaw("can you write me a letter of recommendation")).toBe("Can you write me a letter of recommendation?");
    expect(tidyRaw("kal ka meeting cancel ho gaya so please inform the team")).toBe("Kal ka meeting cancel ho gaya so please inform the team.");
    expect(tidyRaw("kya tum kal office aa rahe ho")).toBe("Kya tum kal office aa rahe ho?");
  });

  it("and nothing else", () => {
    expect(tidyRaw("can't make it tomorrow sorry")).toBe("Can't make it tomorrow sorry.");
    expect(tidyRaw("ok")).toBe("ok");                         // too short to judge
    expect(tidyRaw("Done, sending it now!")).toBe("Done, sending it now!");
    expect(tidyRaw("मैं कल आऊंगा ठीक है")).toBe("मैं कल आऊंगा ठीक है");   // not English letters
    expect(tidyRaw("we can do friday", true)).toBe("we can do friday.");   // carries a sentence on: no capital
  });
});

describe("a placeholder never reaches the field", () => {
  it("comes out with the space before it", () => {
    expect(stripPlaceholders("Hi [Boss's Name], I'll be late tomorrow.", "write a sorry message to my boss"))
      .toBe("Hi, I'll be late tomorrow.");
    expect(stripPlaceholders("Thanks for everything.\nBest,\n[Your Name]", "thank priya")).toBe("Thanks for everything.\nBest,");
  });

  it("unless they typed brackets themselves", () => {
    expect(stripPlaceholders("Use [x] here.", "use [x] here")).toBe("Use [x] here.");
  });
});

describe("a hum in Korean or Chinese is a hum", () => {
  it("is filler, alone or at the edge", () => {
    expect(isFillerOnly("음.")).toBe(true);
    expect(isFillerOnly("嗯")).toBe(true);
    expect(stripEdgeFiller("음, I'll call you back.")).toBe("I'll call you back.");
  });
});

describe("the prompt", () => {
  it("names a search box only where the app is known", () => {
    expect(buildAssistSystem({ hasContext: false })).not.toMatch(/search box/);
    expect(buildAssistSystem({ hasContext: false, targetApp: "Google" })).toMatch(/A search box wants just the words/);
  });

  it("keeps their tone, and writes nothing only for silence", () => {
    const p = buildAssistSystem({ hasContext: false, intentStep: true });
    expect(p).toMatch(/in the tone they made it/);
    expect(p).toMatch(/Only when they said nothing, just silence or noise, <send> stays empty/);
  });
});

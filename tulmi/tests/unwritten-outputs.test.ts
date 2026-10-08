/**
 * The second run the owner read line by line (111 of 118): what still went
 * out looking as if nothing had been done.
 *
 *   - a dozen answers that were the input, letter for letter, lowercase and
 *     open: "mujhe kal subah jaldi uthna hai", "what time does the movie start"
 *   - a question made into search words with no search box
 *   - "mail it to priya@example.com please" → "priya@example.com"
 *   - "I cannot write an essay of that length for you…" sent as the message
 *   - a please dropped one run in three
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

const { assist, slipIn, tidyRaw, finishUnwritten, keepPlease, fieldShapesIt, looksLikeMeta } = await import("../src/pipeline/cleanup.js");
const { buildAssistSystem } = await import("../src/pipeline/assistPrompt.js");

beforeEach(() => { llm.answers = []; llm.calls = []; });

describe("nothing goes out looking unwritten", () => {
  it("the input handed back as it went in gets a capital and an end mark", async () => {
    for (const [said, sent] of [
      ["mujhe kal subah jaldi uthna hai", "Mujhe kal subah jaldi uthna hai."],
      ["what time does the movie start", "What time does the movie start?"],
      ["add 250 ml water and 2 spoons sugar", "Add 250 ml water and 2 spoons sugar."],
      ["kal subah nikalna hai, alarm laga dena", "Kal subah nikalna hai, alarm laga dena."],
    ] as const) {
      llm.answers = [`<intent>a note</intent><send>${said}</send>`];
      expect(await assist(said)).toBe(sent);
    }
  });

  it("so does a lowercase answer the writer did change", () => {
    expect(finishUnwritten("kal ka meeting cancel ho gaya hai", false)).toBe("Kal ka meeting cancel ho gaya hai.");
    expect(finishUnwritten("ami ektu deri kore asbo, meeting shuru kore dio", false)).toBe("Ami ektu deri kore asbo, meeting shuru kore dio.");
    expect(finishUnwritten("main thoda late pahunchunga, meeting shuru kar dena.", false)).toBe("Main thoda late pahunchunga, meeting shuru kar dena.");
  });

  it("leaves what the writer chose, and what carries on their text", () => {
    // A capital given and a stop left off is a choice.
    expect(finishUnwritten("Tomorrow 6pm gym", false)).toBe("Tomorrow 6pm gym");
    // After "I think" in the field, "we can do Friday" is the rest of a sentence.
    expect(finishUnwritten("we can do Friday", true)).toBe("we can do Friday");
    // A list, two words, a name with its own capitals, an address.
    expect(finishUnwritten("milk\neggs\nbread", false)).toBe("milk\neggs\nbread");
    expect(finishUnwritten("ok sure", false)).toBe("ok sure");
    expect(finishUnwritten("iPhone is charged now", false)).toBe("iPhone is charged now");
    expect(finishUnwritten("priya@example.com is her address", false)).toBe("priya@example.com is her address");
  });

  it("never in a field that is not for sentences, or for a lowercase writer", async () => {
    llm.answers = ["<send>best biryani place near andheri</send>"];
    expect(await assist("uh find me the best biryani place near andheri", { targetApp: "a search field" }))
      .toBe("best biryani place near andheri");
    llm.answers = ["<send>running late start without me</send>"];
    expect(await assist("running late start without me", { tone: "very-casual" })).toBe("running late start without me");
    llm.answers = ["<send>running late start without me</send>"];
    expect(await assist("running late start without me", { personality: { customInstructions: "i write everything in lowercase" } }))
      .toBe("running late start without me");
  });

  it("a question mark only where it is a question", () => {
    expect(tidyRaw("when is the meeting tomorrow")).toBe("When is the meeting tomorrow?");
    expect(tidyRaw("when you get home call me")).toBe("When you get home call me.");
    expect(tidyRaw("how about we meet at five")).toBe("How about we meet at five?");
    expect(tidyRaw("what a day it has been")).toBe("What a day it has been.");
    // No full stop on the end of a link.
    expect(tidyRaw("the doc is at https://docs.tailzu.space/setup")).toBe("The doc is at https://docs.tailzu.space/setup");
  });
});

describe("a question they are sending stays a question", () => {
  it("search words with no search box are a slip", () => {
    expect(slipIn("whats the population of india right now", "population of India right now")).toBe("question");
    expect(slipIn("whats the population of india right now", "What's the population of India right now?")).toBeNull();
    // Kept as a question without its mark is still theirs; the finish adds it.
    expect(slipIn("what time does the movie start", "what time does the movie start")).toBeNull();
    // In a search box the words are the answer.
    expect(slipIn("whats the population of india right now", "population of India right now", { field: true })).toBeNull();
    // "When you get home" opens no question.
    expect(slipIn("when you get home call me", "Call me when you get home.")).toBeNull();
  });

  it("is asked again, and failing that their question goes out", async () => {
    llm.answers = ["<send>population of India right now</send>", "<send>What's the population of India right now?</send>"];
    expect(await assist("whats the population of india right now")).toBe("What's the population of India right now?");
    expect(llm.calls[1]![3]!.content).toMatch(/turned their question into something else/);

    llm.answers = ["<send>population of India right now</send>", "<send>India population today</send>"];
    expect(await assist("whats the population of india right now")).toBe("Whats the population of india right now?");
  });

  it("no search is offered as a kind when there is no field to search in", () => {
    expect(buildAssistSystem({ hasContext: false, intentStep: true })).not.toMatch(/a search,/);
    expect(buildAssistSystem({ hasContext: false, targetApp: "Chrome", intentStep: true })).toMatch(/a search,/);
  });
});

describe("almost nothing kept is a slip", () => {
  it("an address alone, for a sentence about it", async () => {
    expect(slipIn("mail it to priya@example.com please", "priya@example.com")).toBe("dropped");
    llm.answers = ["<send>priya@example.com</send>", "<send>Mail it to priya@example.com, please.</send>"];
    expect(await assist("mail it to priya@example.com please")).toBe("Mail it to priya@example.com, please.");
    expect(llm.calls[1]![3]!.content).toMatch(/kept almost none of what they said/);
  });

  it("thinking aloud cut away is not", () => {
    expect(slipIn(
      "okay so what do i want to say here, i guess just that im really sorry i missed your call and ill call you back tonight",
      "So sorry I missed your call, I'll call you back tonight.",
    )).toBeNull();
    expect(slipIn("tell him i'll be late", "I'll be late.")).toBeNull();
  });

  it("nor a number in a number field", () => {
    expect(fieldShapesIt("a number field")).toBe(true);
    expect(fieldShapesIt("WhatsApp")).toBe(false);
    expect(slipIn("my pin is four one two eight", "4128", { field: true })).toBeNull();
  });
});

describe("the writer explaining itself never reaches the field", () => {
  it("a refusal about writing is a refusal", () => {
    expect(looksLikeMeta("I cannot write an essay of that length for you. I can help you write shorter messages or notes.")).toBe(true);
    // The object makes it one: a person's own can't is a message.
    expect(looksLikeMeta("I can't write today, my hand still hurts.")).toBe(false);
  });

  it("asked for an essay, the request goes out, not an explanation", async () => {
    llm.answers = ["<send>I can help you write messages, replies, or short pieces of text. For an essay on climate change, you would need to provide me with more specific details about what you want to include, its length, and its purpose.</send>"];
    expect(await assist("write me an essay on climate change")).toBe("Write me an essay on climate change.");
    llm.answers = ["<send>I cannot write an essay of that length for you. I can help you write shorter messages or notes.</send>"];
    expect(await assist("write me a 500 word essay on climate change")).toBe("Write me a 500 word essay on climate change.");
  });
});

describe("a please they said goes out", () => {
  it("before the word they said it before", async () => {
    expect(keepPlease("Transfer ₹2500 to Ramesh today", "please transfer 2500 rupees to ramesh today")).toBe("Please transfer ₹2500 to Ramesh today");
    llm.answers = ["<send>transfer ₹2500 to ramesh today</send>"];
    expect(await assist("please transfer 2500 rupees to ramesh today")).toBe("Please transfer ₹2500 to ramesh today.");
  });

  it("at the end, where they put it", () => {
    expect(keepPlease("Mail it to priya@example.com.", "mail it to priya@example.com please")).toBe("Mail it to priya@example.com, please.");
    expect(keepPlease("Can you call me back?", "can you call me back pls")).toBe("Can you call me back, please?");
  });

  it("and is left alone where it was kept, or asked another way", () => {
    expect(keepPlease("Confirm the booking for Saturday, please.", "confirm the booking for saturday please")).toBe("Confirm the booking for Saturday, please.");
    expect(keepPlease("Could you transfer ₹2500 to Ramesh today?", "please transfer 2500 rupees to ramesh today")).toBe("Could you transfer ₹2500 to Ramesh today?");
    expect(keepPlease("Send me the file.", "send me the file")).toBe("Send me the file.");
  });
});

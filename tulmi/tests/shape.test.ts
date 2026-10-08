/**
 * The text goes out in the shape that suits it.
 *
 * The owner: "the refinement should properly understand what is being said
 * and how to send the text in best organised way - like - bullet point or in
 * " " or anything that is most appropriate to the situation".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const llm = vi.hoisted(() => ({ answers: [] as string[], calls: 0 }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async () => {
          llm.calls++;
          return { choices: [{ message: { content: llm.answers.shift() ?? "" } }] };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { buildAssistSystem } = await import("../src/pipeline/assistPrompt.js");
const { assist, slipIn } = await import("../src/pipeline/cleanup.js");
const { joinWithSpace } = await import("../src/pipeline/join.js");

beforeEach(() => { llm.answers = []; llm.calls = 0; });

describe("the prompt states the shape as a principle", () => {
  const p = buildAssistSystem({ hasContext: false, targetApp: "WhatsApp", intentStep: true });

  it("the careful writer's shape, found in what they said rather than added", () => {
    // The owner: "follow the principle method for the prompting". A first
    // draft listed the shapes as rules; this is the principle they follow.
    expect(p).toMatch(/Give it the shape a careful writer would give it there, found in what they said rather than added to it/);
    // Its illustrations, which are the shapes the owner named.
    expect(p).toMatch(/what they listed reads as a list, what they quoted reads as a quote, an amount reads in figures, what runs long reads in paragraphs/);
  });

  it("no rules standing in for it", () => {
    expect(p).not.toMatch(/three or more|one per line after|numbered when/);
  });

  it("in plain text, because a field shows markdown as it is", () => {
    expect(p).toMatch(/Plain text, as the field shows it/);
  });

  it("keeps the field's rule, and asks the writer to name the shape", () => {
    expect(p).toMatch(/In WhatsApp, the field decides the shape of the text, never its content/);
    expect(p).toMatch(/A search box wants just the words/);
    expect(p).toMatch(/what they mean and the shape it needs/);
  });
});

describe("a list is not words they did not say", () => {
  it("bullets and numbers are not counted as words", () => {
    expect(slipIn("milk eggs bread coffee", "- Milk\n- Eggs\n- Bread\n- Coffee")).toBeNull();
    expect(slipIn(
      "first call the bank then email priya then book the cab",
      "1. Call the bank.\n2. Email Priya.\n3. Book the cab.",
    )).toBeNull();
  });

  it("a list goes out as the writer wrote it, in one call", async () => {
    llm.answers = ["<intent>shopping list</intent><send>- Milk\n- Eggs\n- Bread\n- Coffee</send>"];
    expect(await assist("milk eggs bread coffee")).toBe("- Milk\n- Eggs\n- Bread\n- Coffee");
    expect(llm.calls).toBe(1);
  });
});

describe("a list after text already in the field", () => {
  it("starts on a line of its own, with no space in front", async () => {
    const context = "Things for the trip:";
    llm.answers = ["<intent>list for the trip</intent><send>- Tickets\n- Passports\n- Cash</send>"];
    const out = await assist("tickets passports and cash", { context });
    expect(out).toBe("\n- Tickets\n- Passports\n- Cash");
    expect(joinWithSpace(context, out)).toBe(false);
  });

  it("but not when the field already ends on a new line", async () => {
    llm.answers = ["<send>- Tickets\n- Passports\n- Cash</send>"];
    expect(await assist("tickets passports and cash", { context: "Things for the trip:\n" })).toBe("- Tickets\n- Passports\n- Cash");
  });

  it("and a sentence still joins with a space, as before", () => {
    expect(joinWithSpace("I checked with the team and", "we can do Friday.")).toBe(true);
  });
});

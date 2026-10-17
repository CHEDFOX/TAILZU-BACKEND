/**
 * The refine is checked, and asked once more when it broke a rule code can see.
 *
 * The owner: "the refining principles are failing badly" — Hindi coming back
 * in English, words added, fillers and corrections kept, the wrong alphabet —
 * "all of them time to time", on every client, because they share one call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const llm = vi.hoisted(() => ({
  answers: [] as Array<string | Error>,
  calls: [] as Array<Array<{ role: string; content: string }>>,
}));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (req: { messages: Array<{ role: string; content: string }> }) => {
          llm.calls.push(req.messages);
          const a = llm.answers.shift() ?? "";
          if (a instanceof Error) throw a;
          return { choices: [{ message: { content: a } }] };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { assist, slipIn } = await import("../src/pipeline/cleanup.js");

beforeEach(() => {
  llm.answers = [];
  llm.calls = [];
});

const HINGLISH = "yaar kal ka plan cancel ho gaya hai ab agle hafte milte hain";

describe("what counts as a slip", () => {
  it("another alphabet, when none was asked for", () => {
    expect(slipIn("mujhe kal subah jaldi uthna hai", "मुझे कल सुबह जल्दी उठना है।")).toBe("alphabet");
    expect(slipIn("मुझे कल सुबह जल्दी उठना है", "मुझे कल सुबह जल्दी उठना है।")).toBe("alphabet");
    // Asked for, in code or in their own words: the alphabet is the request.
    expect(slipIn("mujhe kal subah jaldi uthna hai", "मुझे कल सुबह जल्दी उठना है।", { askedLanguage: "Hindi" })).toBeNull();
    expect(slipIn("isko Hindi mein likho, mujhe kal jaldi uthna hai", "मुझे कल जल्दी उठना है।")).toBeNull();
  });

  it("Hindi carried into English, from either alphabet", () => {
    expect(slipIn(HINGLISH, "The plan for tomorrow got cancelled, so let's meet next week.")).toBe("translated");
    expect(slipIn("मुझे कल सुबह जल्दी उठना है तो मैं जल्दी सो जाऊंगा", "I have to wake up early tomorrow, so I will sleep early.")).toBe("translated");
    // Spelled, not translated: their words are all still there.
    expect(slipIn(HINGLISH, "Yaar, kal ka plan cancel ho gaya hai. Ab agle hafte milte hain.")).toBeNull();
    expect(slipIn("मुझे कल सुबह जल्दी उठना है तो मैं जल्दी सो जाऊंगा", "Mujhe kal subah jaldi uthna hai, toh main jaldi so jaunga.")).toBeNull();
    // Tamil spelled in English letters has no Hindi in it and is not English either.
    expect(slipIn("நான் கொஞ்சம் தாமதமாக வருவேன் மீட்டிங்கை ஆரம்பியுங்கள்", "Naan konjam thaamadhamaaga varuven, meetingai aarambiyungal.")).toBeNull();
    // English was English to begin with.
    expect(slipIn("please send me the invoice before friday", "Please send me the invoice before Friday.")).toBeNull();
    // Asked for English: then English is right.
    expect(slipIn(HINGLISH, "The plan for tomorrow got cancelled.", { askedLanguage: "English" })).toBeNull();
  });

  it("words they did not say, unless they asked for something", () => {
    const long = "Reaching in ten minutes. Sorry for the delay, traffic is terrible today and I left later than I meant to. See you soon!";
    expect(slipIn("reaching in ten", long)).toBe("added");
    expect(slipIn("reaching in ten", long, { instructed: true })).toBeNull();
    expect(slipIn("reaching in ten", "Reaching in ten.")).toBeNull();
  });

  it("a correction or a filler that stayed", () => {
    expect(slipIn("lets meet at five no wait six thirty", "Let's meet at five, no wait, six thirty.")).toBe("correction");
    expect(slipIn("lets meet at five no wait six thirty", "Let's meet at six thirty.")).toBeNull();
    expect(slipIn("so um i think uh we should go", "So um, I think we should go.")).toBe("filler");
    expect(slipIn("so um i think uh we should go", "So I think we should go.")).toBeNull();
    // Not theirs to begin with is not a slip of theirs kept: "umbrella" is a word.
    expect(slipIn("bring the umbrella", "Bring the umbrella.")).toBeNull();
  });

  it("a full stop left where they only paused", () => {
    // What the live recognizer hands over: one sentence, cut at each breath.
    const said = "So I was going to the. Market tomorrow. And maybe. The pharmacy.";
    expect(slipIn(said, said)).toBe("pause");
    expect(slipIn(said, "So I was going to the market tomorrow, and maybe the pharmacy.")).toBeNull();
  });
});

describe("asking once more", () => {
  it("a clean first answer is the only call", async () => {
    llm.answers = ["Yaar, kal ka plan cancel ho gaya hai. Ab agle hafte milte hain."];
    expect(await assist(HINGLISH)).toBe("Yaar, kal ka plan cancel ho gaya hai. Ab agle hafte milte hain.");
    expect(llm.calls).toHaveLength(1);
  });

  it("a translation is sent back with the rule named, and the fixed answer is used", async () => {
    llm.answers = [
      "The plan for tomorrow got cancelled, so let's meet next week.",
      "Yaar, kal ka plan cancel ho gaya hai. Ab agle hafte milte hain.",
    ];
    expect(await assist(HINGLISH)).toBe("Yaar, kal ka plan cancel ho gaya hai. Ab agle hafte milte hain.");
    expect(llm.calls).toHaveLength(2);
    const second = llm.calls[1]!;
    expect(second[2]).toEqual({ role: "assistant", content: "The plan for tomorrow got cancelled, so let's meet next week." });
    expect(second[3]!.role).toBe("user");
    expect(second[3]!.content).toMatch(/translated their words/);
  });

  it("translated twice: their own words go out, not someone else's", async () => {
    llm.answers = ["The plan for tomorrow got cancelled.", "Tomorrow's plan is cancelled; we'll meet next week."];
    // As typed, with the capital and full stop anyone typing would give them.
    expect(await assist(HINGLISH)).toBe("Yaar kal ka plan cancel ho gaya hai ab agle hafte milte hain.");
  });

  it("Devanagari comes back in English letters on the second ask", async () => {
    llm.answers = ["मुझे कल सुबह जल्दी उठना है।", "Mujhe kal subah jaldi uthna hai."];
    expect(await assist("मुझे कल सुबह जल्दी उठना है")).toBe("Mujhe kal subah jaldi uthna hai.");
    expect(llm.calls[1]![3]!.content).toMatch(/English letters/);
  });

  it("a second ask that swaps one slip for another is not kept", async () => {
    llm.answers = ["मुझे कल सुबह जल्दी उठना है।", "I have to wake up early tomorrow morning."];
    // Kept the first, and the alphabet guard then sends what they said.
    expect(await assist("mujhe kal subah jaldi uthna hai")).toBe("Mujhe kal subah jaldi uthna hai.");
  });

  it("a kept correction is asked again", async () => {
    llm.answers = ["Let's meet at five, no wait, six thirty.", "Let's meet at six thirty."];
    expect(await assist("lets meet at five no wait six thirty")).toBe("Let's meet at six thirty.");
  });

  it("pause stops are asked again, and joined in code when they survive", async () => {
    const said = "So I was going to the. Market tomorrow.";
    llm.answers = ["So I was going to the market tomorrow."];
    // Nothing to ask: the first answer already joined it.
    expect(await assist(said)).toBe("So I was going to the market tomorrow.");
    expect(llm.calls).toHaveLength(1);

    llm.answers = [said, "So I was going to the market tomorrow."];
    llm.calls = [];
    expect(await assist(said)).toBe("So I was going to the market tomorrow.");
    expect(llm.calls[1]![3]!.content).toMatch(/where they only paused/);

    // Both answers kept the stop: the code joins it.
    llm.answers = [said, said];
    expect(await assist(said)).toBe("So I was going to the market tomorrow.");
  });

  it("a failed second ask leaves the first answer", async () => {
    llm.answers = ["So um, I think we should go.", new Error("timeout")];
    expect(await assist("so um i think uh we should go")).toBe("So um, I think we should go.");
  });
});

describe("the saved language is what they speak, not what to write in", () => {
  it("English saved does not tell the writer to write English", async () => {
    llm.answers = ["Yaar, kal ka plan cancel ho gaya hai."];
    await assist(HINGLISH, { language: "en" });
    const system = llm.calls[0]![0]!.content;
    expect(system).not.toMatch(/Write in en/);
    expect(system).toMatch(/never translate their words/i);
  });

  it("Hindi saved does not either", async () => {
    llm.answers = ["Please send me the invoice before Friday."];
    await assist("please send me the invoice before friday", { language: "hi" });
    expect(llm.calls[0]![0]!.content).not.toMatch(/Write in hi/);
  });

  it("a language asked for in the dictation still is", async () => {
    llm.answers = ["कृपया शुक्रवार से पहले चालान भेज दें।"];
    await assist("please send me the invoice before friday, write it in hindi", { language: "en" });
    expect(llm.calls[0]![0]!.content).toMatch(/Write in Hindi/);
    expect(llm.calls).toHaveLength(1);
  });
});

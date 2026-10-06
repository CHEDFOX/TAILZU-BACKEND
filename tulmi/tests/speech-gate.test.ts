/**
 * No speech in, no text out — the decision, in every language we serve.
 *
 * The evidence: the owner's desktop pasted
 *   "So see that andजिंदगी में.I'm not aजिंदगी में."  and  "JhalThank you.Jhal"
 * Every "जिंदगी में.", "Thank you." and "Jhal" there was a recogniser's answer
 * to a breath between sentences. They must never reach anyone — and a person
 * who really says "thank you" or "धन्यवाद" must keep it. So the gate is on
 * the measured voice, not on the words.
 */
import { describe, expect, it } from "vitest";
import type { SpeechMeasure } from "../src/pipeline/speechPresence.js";
import {
  gateTranscript, isFillerOnly, isKnownHallucination, phraseKey, spokenWords, stripBoilerplate, wordCapacity,
} from "../src/pipeline/speechGate.js";

const measured = (voicedSeconds: number, activeSeconds = voicedSeconds, totalSeconds = 1.2): SpeechMeasure =>
  ({ voicedSeconds, activeSeconds, totalSeconds, truncated: false });
/** A breath between sentences: some sound, no voice. */
const BREATH = measured(0, 0.45);
/** Someone saying a short phrase. */
const SPOKEN = measured(0.55, 0.7);

describe("the phrases recognisers invent on quiet, in every language", () => {
  it("knows them in English, Hindi, Urdu, Bengali, romanised, and the other languages we serve", () => {
    for (const t of [
      "Thank you.", "thank you so much!", "Thanks.", "You.", "Bye.", "Okay.", "So.",
      "जिंदगी में.", "ज़िंदगी में।", "जिन्दगी में", "धन्यवाद।", "बहुत बहुत धन्यवाद", "शुक्रिया", "नमस्ते", "सब्सक्राइब करें",
      "हाँ", "हां", "ठीक है।", "شکریہ", "ধন্যবাদ", "নমস্কার", "நன்றி", "ధన్యవాదాలు", "આભાર", "ਧੰਨਵਾਦ", "ಧನ್ಯವಾದಗಳು", "നന്ദി",
      "Jhal", "jhal.", "Dhanyavaad.", "Shukriya", "Zindagi mein.", "Namaste",
      "Gracias.", "Merci.", "Danke.", "Obrigado.", "شكرا", "ありがとうございました。", "감사합니다.", "谢谢。", "Спасибо.",
    ]) expect(isKnownHallucination(t), t).toBe(true);
  });

  it("knows a run of them as one", () => {
    expect(isKnownHallucination("जिंदगी में. जिंदगी में.")).toBe(true);
    expect(isKnownHallucination("Thank you. Bye.")).toBe(true);
  });

  it("does not mistake a real sentence, or a real Hindi word, for one", () => {
    for (const t of [
      "Thank you for sending that over.", "Okay, see you at five.", "हम कल मिलेंगे।", "हम",
      "जिंदगी में बहुत कुछ है", "So see that and", "I'm not a", "Jhal muri khaoge?",
    ]) expect(isKnownHallucination(t), t).toBe(false);
  });

  it("folds the spellings a recogniser alternates between", () => {
    expect(phraseKey("ज़िंदगी में।")).toBe(phraseKey("जिंदगी में"));
    expect(phraseKey("हाँ")).toBe(phraseKey("हां"));
    expect(phraseKey("  Thank   you!! ")).toBe("thank you");
  });
});

describe("hesitation is never a message", () => {
  it("knows filler in the alphabets it arrives in", () => {
    for (const t of ["Hmm.", "um", "uh, uh", "Mm-hmm", "हम्म", "হুম", "Erm..."]) expect(isFillerOnly(t), t).toBe(true);
  });

  it("keeps words that only look like it", () => {
    for (const t of ["हम", "Hummus?", "Mmm, that was good.", "um, see you at five"]) expect(isFillerOnly(t), t).toBe(false);
  });
});

describe("what is never speech comes off on every path", () => {
  it("annotations, outros and subtitle credits, whole or as a tail", () => {
    expect(stripBoilerplate("[Music]")).toBe("");
    expect(stripBoilerplate("[BLANK_AUDIO]")).toBe("");
    expect(stripBoilerplate("♪♪")).toBe("");
    expect(stripBoilerplate("(upbeat music) Let's go.")).toBe("Let's go.");
    expect(stripBoilerplate("देखने के लिए धन्यवाद")).toBe("");
    expect(stripBoilerplate("Sous-titres réalisés par la communauté d'Amara.org")).toBe("");
    expect(stripBoilerplate("Ship it this week. Thanks for watching!")).toBe("Ship it this week.");
    expect(stripBoilerplate("मैं कल आऊंगा। हमारे चैनल को सब्सक्राइब करें।")).toBe("मैं कल आऊंगा।");
  });

  it("leaves a real sentence that mentions any of it", () => {
    expect(stripBoilerplate("Thanks for watching the kids yesterday.")).toBe("Thanks for watching the kids yesterday.");
  });
});

describe("the owner's evidence: a breath between sentences", () => {
  it("withholds what the recogniser invented for it, in any language", () => {
    for (const t of ["जिंदगी में.", "Thank you.", "Jhal", "धन्यवाद।", "Okay.", "you"]) {
      const r = gateTranscript(t, { measure: BREATH });
      expect(r.text, t).toBe("");
      expect(r.dropped, t).toBe("no-speech");
    }
  });

  it("withholds ANY words on a clip with no voice — not only known phrases", () => {
    expect(gateTranscript("I think we should", { measure: measured(0, 0.2) }).text).toBe("");
    expect(gateTranscript("Kal milte hain", { measure: measured(0.04, 0.1) }).text).toBe("");
  });

  it("withholds a known phrase when there was a little voice, but not enough to say it", () => {
    // A cough or a hum: a moment of pitch, not a phrase.
    expect(gateTranscript("Thank you.", { measure: measured(0.16, 0.3) })).toEqual({ text: "", dropped: "hallucination" });
    expect(gateTranscript("जिंदगी में.", { measure: measured(0.2, 0.4) })).toEqual({ text: "", dropped: "hallucination" });
  });

  it("keeps it when somebody really said it", () => {
    for (const t of ["Thank you.", "धन्यवाद।", "Okay.", "Jhal", "शुक्रिया", "Gracias."]) {
      expect(gateTranscript(t, { measure: SPOKEN }).text, t).toBe(t);
    }
  });

  it("keeps real words that stand between two pauses", () => {
    expect(gateTranscript("So see that and", { measure: measured(0.8, 0.9, 1.6) }).text).toBe("So see that and");
    expect(gateTranscript("I'm not a", { measure: measured(0.5, 0.6, 1.4) }).text).toBe("I'm not a");
  });
});

describe("more words than the voice could hold were invented", () => {
  it("counts words the way speech takes time, including scripts without spaces", () => {
    expect(spokenWords("So see that and")).toBe(4);
    expect(spokenWords("मैं कल आऊंगा।")).toBe(3);
    expect(spokenWords("ありがとうございました")).toBe(6);
    expect(spokenWords("— … !")).toBe(0);
    expect(wordCapacity(0.5)).toBe(5.5);
  });

  it("takes a known phrase off the end when the voice cannot account for it", () => {
    // Half a second of voice holds "Let's ship it", not a sentence of thanks after it.
    expect(gateTranscript("Let's ship it. Thank you so much.", { measure: measured(0.3, 0.5) }).text).toBe("Let's ship it.");
    expect(gateTranscript("I'm not a जिंदगी में.", { measure: measured(0.3, 0.5) }).text).toBe("I'm not a");
  });

  it("leaves that same ending alone when there was voice enough to say it", () => {
    expect(gateTranscript("Let's ship it. Thank you so much.", { measure: measured(1.2, 1.4, 2) }).text)
      .toBe("Let's ship it. Thank you so much.");
  });

  it("withholds a short invented line, but never a long real one on a quiet recording", () => {
    expect(gateTranscript("I will see you tomorrow then", { measure: measured(0.13, 0.4) }))
      .toEqual({ text: "", dropped: "too-many-words" });
    // Twelve words on 1.2 s of measured voice is over the estimate, not far over it.
    const long = "okay so the plan is we meet at five and then go";
    expect(gateTranscript(long, { measure: measured(1.2, 1.5, 4) }).text).toBe(long);
  });
});

describe("two engines: silence from one is evidence against a quiet clip's words from the other", () => {
  it("does not trust a short reading only one engine heard, on a quiet clip", () => {
    expect(gateTranscript("Kal", { measure: measured(0.2, 0.3), others: [""] }))
      .toEqual({ text: "", dropped: "uncorroborated" });
  });

  it("trusts it when both heard it, or when the voice was clear", () => {
    expect(gateTranscript("Haan", { measure: measured(0.25, 0.3), others: ["haan."] }).text).toBe("Haan");
    expect(gateTranscript("Kal milte hain", { measure: measured(0.8, 1), others: [""] }).text).toBe("Kal milte hain");
  });
});

describe("when the audio cannot be measured", () => {
  it("withholds a known phrase on a short clip unless a second engine heard it too", () => {
    expect(gateTranscript("Thank you.", { clipBytes: 9_000 })).toEqual({ text: "", dropped: "hallucination" });
    expect(gateTranscript("जिंदगी में.", { clipSeconds: 1.2 })).toEqual({ text: "", dropped: "hallucination" });
    expect(gateTranscript("Thank you.", { clipBytes: 9_000, others: ["thank you"] }).text).toBe("Thank you.");
  });

  it("withholds a short reading another engine heard as nothing", () => {
    expect(gateTranscript("Kal", { clipBytes: 9_000, others: [""] }).dropped).toBe("uncorroborated");
  });

  it("keeps a known phrase on a long clip unless the recogniser itself calls it silence", () => {
    expect(gateTranscript("Thank you.", { clipSeconds: 6 }).text).toBe("Thank you.");
    expect(gateTranscript("Thank you.", { clipSeconds: 6, confidence: "low" }).text).toBe("");
  });

  it("never touches ordinary speech", () => {
    expect(gateTranscript("Meeting moved to 3pm, does that work?", { clipBytes: 9_000 }).text)
      .toBe("Meeting moved to 3pm, does that work?");
  });

  it("does not use a truncated measure as evidence about the rest of a long clip", () => {
    expect(gateTranscript("and that is the whole plan", { measure: { ...measured(0), truncated: true }, clipSeconds: 40 }).text)
      .toBe("and that is the whole plan");
  });
});

describe("the operator's valve", () => {
  it("SPEECH_MEASURE=false stops the measure from dropping text, and leaves the phrase lists on", async () => {
    // The config this reads wants the server's keys; none are used here.
    for (const [k, v] of Object.entries({ OPENROUTER_API_KEY: "test", OPENAI_API_KEY: "test", STT_PROVIDER: "openai", NODE_ENV: "test", DEV_SKIP_AUTH: "true" })) process.env[k] ??= v;
    const { resetConfigForTests } = await import("../src/config.js");
    const { scrubAndGate } = await import("../src/pipeline/stt.js");
    const silent = { measure: { voicedSeconds: 0, activeSeconds: 0, durationSeconds: 1.2 } };
    const prev = process.env.SPEECH_MEASURE;
    try {
      process.env.SPEECH_MEASURE = "false"; resetConfigForTests();
      expect(scrubAndGate("send the deck tonight", silent as never).text).toBe("send the deck tonight");
      process.env.SPEECH_MEASURE = "true"; resetConfigForTests();
      expect(scrubAndGate("send the deck tonight", silent as never).text).toBe("");
    } finally {
      if (prev === undefined) delete process.env.SPEECH_MEASURE; else process.env.SPEECH_MEASURE = prev;
      resetConfigForTests();
    }
  });
});

import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { sanitizePlainTranscript, sanitizeWhisperText } from "../src/pipeline/stt.js";

/**
 * Guards the fix for the keyboard-mic "I always get the same thank you text"
 * bug: when the mic captures no real audio, gpt-4o-transcribe / Whisper
 * hallucinate boilerplate (most often a bare "Thank you."). The default
 * OpenAI STT path had NO stripping — sanitizePlainTranscript now runs on every
 * provider path via transcribe(), so a silent capture returns "" (nothing
 * inserted) instead of phantom text.
 */
describe("sanitizePlainTranscript", () => {
  it("nukes bare silence-hallucination phrases to empty", () => {
    for (const phrase of [
      "Thank you.",
      "Thank you",
      "thank you!",
      "Thank you so much.",
      "Thank you very much",
      "Thank you guys.",
      "Thanks.",
      "Thanks a lot.",
      "Thanks so much!",
      "you",
      "You.",
      "Thanks for watching!",
      "Thank you for watching.",
      "Please subscribe.",
      "Bye.",
      "[music]",
      "um",
    ]) {
      expect(sanitizePlainTranscript(phrase), `expected "${phrase}" stripped`).toBe("");
    }
  });

  it("keeps a real 'thank you' that is part of a sentence", () => {
    expect(sanitizePlainTranscript("Thank you for sending that over, I'll review it tonight.")).toBe(
      "Thank you for sending that over, I'll review it tonight.",
    );
    expect(sanitizePlainTranscript("Hey, thanks — talk soon")).toBe("Hey, thanks — talk soon");
    expect(sanitizePlainTranscript("Are you free tomorrow?")).toBe("Are you free tomorrow?");
  });

  it("trims a YouTube-outro tail off an otherwise-real transcript", () => {
    expect(
      sanitizePlainTranscript("Let's ship it this week. Thanks for watching!"),
    ).toBe("Let's ship it this week.");
  });

  it("collapses degenerate repetition from a mic drop-out", () => {
    // collapseRepetitions keeps up to two in a row (emphasis), drops the rest.
    expect(sanitizePlainTranscript("you you you you you")).toBe("you you");
    expect(sanitizePlainTranscript("send send send send it")).toBe("send send it");
  });

  it("is idempotent and safe on empty / whitespace input", () => {
    expect(sanitizePlainTranscript("")).toBe("");
    expect(sanitizePlainTranscript("   ")).toBe("");
    const real = "Meeting moved to 3pm, does that work?";
    expect(sanitizePlainTranscript(sanitizePlainTranscript(real))).toBe(real);
  });
});

describe("sanitizeWhisperText (Groq verbose path)", () => {
  it("drops low-confidence segments then strips leftover boilerplate", () => {
    const out = sanitizeWhisperText({
      text: "ignored flat text",
      segments: [
        { text: "Let's grab lunch", no_speech_prob: 0.05, avg_logprob: -0.2 },
        { text: "at noon", no_speech_prob: 0.1, avg_logprob: -0.3 },
        // High no_speech_prob → dropped as non-speech.
        { text: "garbage", no_speech_prob: 0.95, avg_logprob: -0.1 },
      ],
    });
    expect(out).toBe("Let's grab lunch at noon");
  });

  it("returns empty when the only surviving segment is a hallucination", () => {
    const out = sanitizeWhisperText({
      text: "Thank you.",
      segments: [{ text: "Thank you.", no_speech_prob: 0.2, avg_logprob: -0.4 }],
    });
    expect(out).toBe("");
  });
});

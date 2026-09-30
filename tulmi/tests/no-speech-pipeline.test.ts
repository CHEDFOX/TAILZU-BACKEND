/**
 * The owner's evidence, end to end through the real transcribe() and
 * runPipeline(), with only the providers mocked.
 *
 *   "So see that andजिंदगी में.I'm not aजिंदगी में."   "JhalThank you.Jhal"
 *
 * The desktop uploads each pause-separated stretch to /v1/transcribe-clean.
 * The stretches between sentences held a breath, and the recogniser wrote
 * "जिंदगी में.", "Thank you.", "Jhal" — with segment confidence good enough
 * that the old code called them "high" and skipped every check. Here a 1.2 s
 * clip of a quiet room with one breath in it must come back empty, whatever
 * any engine says, while real speech carrying those same words survives.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { breathClip, rng, speechClip, wav } from "./audio-fixtures.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

type Seg = { text: string; no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number };
const state = vi.hoisted(() => ({
  groq: { text: "", segments: [] as Seg[] },
  sarvam: "",
  reply: null as null | ((said: string) => string),
  chatCalls: 0,
}));

vi.mock("groq-sdk", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ ...state.groq, duration: 0 }) } };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = {
      completions: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          state.chatCalls++;
          const said = /<said>\n([\s\S]*?)\n<\/said>/.exec(req.messages[1]!.content)?.[1] ?? "";
          return { choices: [{ message: { content: state.reply ? state.reply(said) : said } }] };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));
vi.stubGlobal("fetch", async () =>
  new Response(JSON.stringify({ transcript: state.sarvam, language_code: state.sarvam ? "en-IN" : null }), { status: 200 }));

const { transcribe, filterConfidentSegments } = await import("../src/pipeline/stt.js");
const { runPipeline } = await import("../src/pipeline/index.js");
const { resetConfigForTests } = await import("../src/config.js");

/** Whisper's reading, with the kind of confidence it gives these phrases on a breath. */
const whisper = (text: string) => {
  state.groq = { text, segments: [{ text, no_speech_prob: 0.22, avg_logprob: -0.35, compression_ratio: 1.1 }] };
};
const BREATH = wav(breathClip());
const SPEECH = wav(speechClip());
/** A desktop pause stretch as it arrives: webm, a few KB, no readable length. */
const webm = () => { const r = rng(5); return Buffer.from(Array.from({ length: 8000 }, () => Math.floor((r() + 1) * 127))); };

beforeEach(() => {
  state.groq = { text: "", segments: [] };
  state.sarvam = "";
  state.reply = null;
  state.chatCalls = 0;
});

describe("one engine (Groq): a breath between sentences writes nothing", () => {
  for (const said of ["जिंदगी में.", "Thank you.", "Jhal"]) {
    it(`"${said}" on a 1.2 s breath comes back empty, without calling the writer`, async () => {
      whisper(said);
      const stt = await transcribe({ audio: BREATH, format: "wav" });
      expect(stt.text).toBe("");
      expect(stt.dropped).toBe("no-speech");
      expect(stt.voicedSeconds).toBe(0);

      const r = await runPipeline({ audio: BREATH, format: "wav", context: "So see that and" });
      expect(r.cleanedText).toBe("");
      // The desktop pastes `transcript` when cleanedText is empty: it must be empty too.
      expect(r.transcript).toBe("");
      expect(r.noSpeech).toBe(true);
      expect(r.joinWithSpace).toBe(false);
      expect(r.speech).toEqual({ voicedSeconds: 0, dropped: "no-speech" });
      expect(r.usage.words).toBe(0);
      expect(state.chatCalls).toBe(0);
    });
  }

  it("keeps the same words when somebody really said them", async () => {
    for (const said of ["Thank you.", "धन्यवाद।", "Jhal"]) {
      whisper(said);
      const stt = await transcribe({ audio: SPEECH, format: "wav" });
      expect(stt.text, said).toBe(said);
      expect(stt.dropped, said).toBeUndefined();
      expect(stt.voicedSeconds!, said).toBeGreaterThan(0.5);
    }
  });

  it("does not trust a desktop stretch it cannot measure with a phrase recognisers invent", async () => {
    // webm cannot be measured without ffmpeg (and these bytes are not audio
    // anyway): a few KB is short enough to be only a breath, so the phrase
    // needs a second engine that heard it too.
    whisper("Thank you.");
    const stt = await transcribe({ audio: webm(), format: "webm" });
    expect(stt.text).toBe("");
    expect(stt.dropped).toBe("hallucination");
  });

  it("still writes ordinary words from a stretch it cannot measure", async () => {
    whisper("I'm not a");
    expect((await transcribe({ audio: webm(), format: "webm" })).text).toBe("I'm not a");
  });
});

describe("Whisper's own signals are read", () => {
  it("drops a looping segment and a known phrase with a middling no-speech reading", () => {
    const r = filterConfidentSegments({
      text: "",
      segments: [
        { text: "Let's meet at five.", no_speech_prob: 0.05, avg_logprob: -0.2, compression_ratio: 1.2 },
        { text: "you you you you you you you you", no_speech_prob: 0.1, avg_logprob: -0.3, compression_ratio: 3.1 },
        { text: "जिंदगी में।", no_speech_prob: 0.45, avg_logprob: -0.3 },
      ],
    });
    expect(r.text).toBe("Let's meet at five.");
    expect(r.speechConfidence).toBe("high");
  });

  it("keeps a confident one", () => {
    expect(filterConfidentSegments({ text: "", segments: [{ text: "Thank you.", no_speech_prob: 0.02, avg_logprob: -0.15 }] }).text)
      .toBe("Thank you.");
  });
});

describe("two engines (auto): silence from one, a hallucination from the other", () => {
  beforeEach(() => {
    process.env.STT_PROVIDER = "auto";
    process.env.SARVAM_API_KEY = "k";
    resetConfigForTests();
  });

  it("a breath: one engine heard nothing, the other wrote Hindi — nothing is written", async () => {
    state.sarvam = "";
    whisper("जिंदगी में.");
    const stt = await transcribe({ audio: BREATH, format: "wav" });
    expect(stt.text).toBe("");
  });

  it("a Devanagari hallucination no longer leads over the words another engine heard", async () => {
    // Script used to decide alone: the Devanagari reading led because it was
    // Devanagari. It is one of the phrases recognisers invent, so the other
    // engine's real words lead — and it is not handed to the writer as a
    // second candidate either.
    state.sarvam = "So see that and";
    whisper("जिंदगी में.");
    const stt = await transcribe({ audio: SPEECH, format: "wav" });
    expect(stt.text).toBe("So see that and");
    expect(stt.alternative).toBeUndefined();
  });

  it("a syllable only one engine heard, on a stretch it cannot measure, is not trusted", async () => {
    state.sarvam = "";
    whisper("Jhal");
    expect((await transcribe({ audio: webm(), format: "webm" })).text).toBe("");
  });

  it("the same word from both engines stands", async () => {
    state.sarvam = "Thank you";
    whisper("Thank you.");
    expect((await transcribe({ audio: webm(), format: "webm" })).text).toMatch(/^Thank you\.?$/);
  });
});

describe("what does get written joins what came before", () => {
  beforeEach(() => {
    process.env.STT_PROVIDER = "groq";
    resetConfigForTests();
  });

  it("a stretch that carries a sentence on: no capital, no invented full stop, a space to join", async () => {
    whisper("I'm not a");
    state.reply = () => "I'm not a.";
    const r = await runPipeline({ audio: SPEECH, format: "wav", context: "So see that and" });
    expect(r.cleanedText).toBe("I'm not a");
    expect(r.joinWithSpace).toBe(true);
    expect(r.noSpeech).toBeUndefined();

    whisper("the deck is done");
    state.reply = () => "The deck is done.";
    const next = await runPipeline({ audio: SPEECH, format: "wav", context: "So see that and" });
    expect(next.cleanedText).toBe("the deck is done.");
  });

  it("filler at the seam comes off without leaving a capital mid-sentence", async () => {
    whisper("um market today");
    state.reply = () => "Um, market today.";
    const r = await runPipeline({ audio: SPEECH, format: "wav", context: "I went to the" });
    expect(r.cleanedText).toBe("market today.");
    expect(r.joinWithSpace).toBe(true);
  });

  it("a writer that turns a real syllable into a closing gives their word back", async () => {
    whisper("Jhal");
    state.reply = () => "Thank you.";
    const r = await runPipeline({ audio: SPEECH, format: "wav" });
    expect(r.cleanedText).toBe("Jhal");
  });
});

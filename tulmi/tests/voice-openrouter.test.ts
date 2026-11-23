/**
 * THE VOICE AND THE MEETING'S SPEAKERS THROUGH OPENROUTER (pipeline/tts.ts, notes/speakers.ts). One key for every model: the read-aloud
 * voice is ElevenLabs' on OpenRouter, and who said what in a note is ElevenLabs' Scribe on OpenRouter, asked before Deepgram and OpenAI.
 */
import { describe, expect, it } from "vitest";
import { ELEVENLABS_VOICES, voiceForElevenLabs } from "../src/pipeline/tts.js";
import { turnsOf } from "../src/notes/speakers.js";

describe("the voice a person chose, on ElevenLabs", () => {
  it("one of its own voices is used as it is", () => {
    expect(voiceForElevenLabs("george", "sarah")).toBe("george");
    expect(voiceForElevenLabs("Brian", "sarah")).toBe("brian");
  });
  it("a name from the old catalogue, kept in settings and sent by every build out there, gets the nearest voice — never an error", () => {
    for (const old of ["alloy", "nova", "shimmer", "coral", "sage", "marin", "echo", "onyx", "fable", "ash", "ballad", "verse", "cedar"]) {
      expect(ELEVENLABS_VOICES).toContain(voiceForElevenLabs(old, "sarah"));
    }
    expect(voiceForElevenLabs("onyx", "sarah")).toBe("george");
  });
  it("nothing, or a name nobody has, is the default voice", () => {
    expect(voiceForElevenLabs(undefined, "alice")).toBe("alice");
    expect(voiceForElevenLabs("zzz", "alice")).toBe("alice");
    expect(voiceForElevenLabs("zzz", "not-a-voice")).toBe("sarah");
  });
});

describe("who said what, from words labelled by speaker", () => {
  it("a turn runs while the speaker does, and speakers are numbered in the order they first speak", () => {
    const turns = turnsOf([
      { word: "Can", start: 0.1, end: 0.3, speaker_label: "speaker_1" },
      { word: "we?", start: 0.3, end: 0.5, speaker_label: "speaker_1" },
      { word: "Yes.", start: 1.0, end: 1.4, speaker_label: "speaker_0" },
      { word: "Good.", start: 2.0, end: 2.3, speaker_label: "speaker_1" },
      { word: " ", start: 2.3, end: 2.4, speaker_label: "speaker_1" },
    ]);
    expect(turns).toEqual([
      { speaker: 0, start: 0.1, end: 0.5, text: "Can we?" },
      { speaker: 1, start: 1.0, end: 1.4, text: "Yes." },
      { speaker: 0, start: 2.0, end: 2.3, text: "Good." },
    ]);
  });
  it("numbers work as labels too, and no words is no turns", () => {
    expect(turnsOf([{ word: "Hi", speaker: 3 }, { word: "there", speaker: 3 }]).map((t) => t.text)).toEqual(["Hi there"]);
    expect(turnsOf([])).toEqual([]);
  });
});

/**
 * OPENAI'S RECOGNISER THROUGH OPENROUTER (pipeline/stt/openai.ts, OPENAI_STT_VIA_OPENROUTER). On 22 Nov the OpenAI account ran out of
 * credits and every dictation failed; OpenRouter serves the same models on the key every other model call uses.
 */
import { describe, expect, it } from "vitest";
import { sttModelName } from "../src/pipeline/stt/openai.js";

describe("the transcription model's name, for whichever endpoint is asked", () => {
  it("OpenRouter gets its openai/ name, whichever way the setting was written", () => {
    expect(sttModelName("gpt-4o-mini-transcribe", true)).toBe("openai/gpt-4o-mini-transcribe");
    expect(sttModelName("openai/gpt-4o-transcribe", true)).toBe("openai/gpt-4o-transcribe");
    expect(sttModelName("whisper-1", true)).toBe("openai/whisper-1");
  });
  it("OpenAI itself gets the bare name", () => {
    expect(sttModelName("gpt-4o-mini-transcribe", false)).toBe("gpt-4o-mini-transcribe");
    expect(sttModelName("openai/gpt-4o-transcribe", false)).toBe("gpt-4o-transcribe");
  });
});

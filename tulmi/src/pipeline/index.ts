/**
 * Pipeline orchestration: audio → transcript → written text, plus usage.
 * runPipeline() is the one-shot path (/v1/transcribe-clean, the demo, the
 * test scripts); live dictation streams through routes/transcribe-stream.ts.
 */
import { transcribe } from "./stt.js";
import { assist } from "./cleanup.js";
import { joinWithSpace } from "./join.js";
import type { GateReason } from "./speechGate.js";
import type {
  AudioFormat,
  CleanupOptions,
  UsageRecord,
} from "../../../shared/types/api.js";
import { getConfig } from "../config.js";

export interface PipelineInput extends CleanupOptions {
  audio: Buffer;
  format: AudioFormat;
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface PipelineResult {
  /** STT engine that produced the transcript ("sarvam" | "groq" | "openai" |
   *  "deepgram"). Diagnostic: a provider that keeps failing falls back
   *  silently, so without this the only symptom is quality quietly reverting
   *  to the generalist. */
  sttEngine?: string;
  /** Language the engine reported detecting, when it reports one. */
  detectedLanguage?: string;
  transcript: string;
  cleanedText: string;
  usage: UsageRecord;
  /**
   * Whether the client should put ONE space before `cleanedText` when it
   * appends it after `context` (the text it sent as already written). False
   * when there is nothing to join, when `context` already ends in whitespace,
   * when the text opens with punctuation, or for scripts written without
   * spaces. Additive; see join.joinWithSpace.
   */
  joinWithSpace: boolean;
  /** True when nothing was said: paste nothing, and for a pause stretch show nothing. */
  noSpeech?: boolean;
  /** Diagnostic: seconds of voice measured (null when unmeasured) and why text was withheld. */
  speech?: { voicedSeconds: number | null; dropped?: GateReason };
}

/** One-shot: transcribe, then run the writing assistant. */
export async function runPipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const { audio, format, ...opts } = input;

  const stt = await transcribe({
    audio, format,
    language: opts.language,
    vocabulary: opts.personality?.vocabulary,
    // The learned portrait, for its QUOTED WORDS only (see portraitTerms).
    // The recognizer gets the terms this speaker actually uses; the prose
    // never reaches it, because Whisper reads its prompt as preceding speech.
    portraitCore: opts.personality?.stylePortrait?.core,
    portraitWords: opts.personality?.stylePortrait?.words,
    // The Languages card, when the user has answered it.
    languages: opts.personality?.languages?.map(String),
  });
  // NOTHING WAS SAID → nothing is written. Return before the model.
  //
  // The silence scrub in stt.ts returns "" for a clip it decided was silence
  // or a hallucination, and the assist prompt asks the model to answer an
  // empty input with an empty string. Asking is not the same as not asking:
  // a writing model handed nothing still writes something, and that something
  // arrived on the user's screen as a refinement of a sentence they never
  // spoke. It is also a paid round trip to produce it.
  const speech = { voicedSeconds: stt.voicedSeconds ?? null, ...(stt.dropped ? { dropped: stt.dropped } : {}) };
  if (!stt.text.trim()) {
    return {
      // Empty, and it must be: the desktop pastes `transcript` whenever
      // `cleanedText` is empty, so a withheld hallucination left here would
      // be pasted anyway.
      transcript: "",
      sttEngine: stt.engine,
      detectedLanguage: stt.detectedLanguage,
      cleanedText: "",
      // No words, so silence never counts against an allowance.
      usage: { audioSeconds: stt.durationSeconds, words: 0, model: getConfig().CLEANUP_MODEL },
      joinWithSpace: false,
      noSpeech: true,
      speech,
    };
  }

  // The assist step separates any embedded instruction ("…make it shorter, in
  // bullet points") from the message itself and applies the active tone, so we
  // no longer strip commands here — the model handles it. `transcript` stays
  // the raw STT output for QA/history.
  //
  // `script` is what the recognizer ACTUALLY produced (measured, not declared),
  // so the writing step is told the user's script as a fact instead of being
  // left to infer it — which is what let romanized Hinglish drift into
  // Devanagari.
  // `alternative` is the second recognizer's reading, present only when the
  // two disagreed — the writing step reconciles them before writing.
  const cleanedText = await assist(stt.text, {
    ...opts,
    script: stt.script,
    alternative: stt.alternative,
    // How much the recognizer trusted its own reading. Measured, like the
    // script, and for the same reason: the writing step is the only place a
    // mishearing can still be repaired, and it was never told there might be
    // one.
    speechConfidence: stt.speechConfidence,
  });

  return {
    transcript: stt.text,
    // Which STT engine actually produced the transcript, and what language it
    // reported. Surfaced so "is Sarvam really running?" is answerable from the
    // response instead of requiring server logs — a silently-failing provider
    // is otherwise invisible, because the fallback makes everything look fine.
    sttEngine: stt.engine,
    detectedLanguage: stt.detectedLanguage,
    cleanedText,
    usage: {
      audioSeconds: stt.durationSeconds,
      words: countWords(cleanedText),
      model: getConfig().CLEANUP_MODEL,
    },
    joinWithSpace: joinWithSpace(opts.context, cleanedText),
    speech,
  };
}

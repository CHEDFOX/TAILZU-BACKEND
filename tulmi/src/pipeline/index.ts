/**
 * Pipeline orchestration: audio → transcript → cleaned text, plus usage.
 *
 * Two entry points:
 *  - runPipeline()        : one-shot (REST + test script)
 *  - runPipelineStream()  : streaming (WebSocket) — emits events as they happen
 */
import { transcribe } from "./stt.js";
import { assist, cleanStream } from "./cleanup.js";
import { detectCommand } from "./commands.js";
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
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
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
  if (!stt.text.trim()) {
    return {
      transcript: "",
      sttEngine: stt.engine,
      detectedLanguage: stt.detectedLanguage,
      cleanedText: "",
      // No words, so silence never counts against an allowance.
      usage: { audioSeconds: stt.durationSeconds, words: 0, model: getConfig().CLEANUP_MODEL },
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
  };
}

/** Events emitted by the streaming pipeline. */
export type PipelineEvent =
  | { type: "transcript"; text: string }
  | { type: "cleaned_delta"; text: string }
  | { type: "done"; cleanedText: string; usage: UsageRecord };

/**
 * Streaming: emit the transcript once, then cleaned deltas, then a final done
 * event with usage. Note: STT itself isn't incremental here — we transcribe the
 * full clip, then stream the *cleanup*, which is where most of the latency and
 * the visible "typing" effect lives.
 */
export async function* runPipelineStream(
  input: PipelineInput,
): AsyncGenerator<PipelineEvent, void, unknown> {
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
  const { transcript, command } = detectCommand(stt.text);
  yield { type: "transcript", text: transcript };

  // Same gate as the one-shot path: silence in, silence out, no model call.
  if (!transcript.trim()) {
    yield {
      type: "done",
      cleanedText: "",
      usage: { audioSeconds: stt.durationSeconds, words: 0, model: getConfig().CLEANUP_MODEL },
    };
    return;
  }

  let cleanedText = "";
  for await (const delta of cleanStream(transcript, {
    ...opts,
    command: command ?? opts.command,
    script: stt.script, // observed script — same fidelity guarantee as the one-shot path
  })) {
    cleanedText += delta;
    yield { type: "cleaned_delta", text: delta };
  }
  cleanedText = cleanedText.trim();

  yield {
    type: "done",
    cleanedText,
    usage: {
      audioSeconds: stt.durationSeconds,
      words: countWords(cleanedText),
      model: getConfig().CLEANUP_MODEL,
    },
  };
}

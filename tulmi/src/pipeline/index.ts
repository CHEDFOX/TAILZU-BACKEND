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

  const stt = await transcribe({ audio, format, language: opts.language, vocabulary: opts.personality?.vocabulary });
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

  const stt = await transcribe({ audio, format, language: opts.language, vocabulary: opts.personality?.vocabulary });
  const { transcript, command } = detectCommand(stt.text);
  yield { type: "transcript", text: transcript };

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

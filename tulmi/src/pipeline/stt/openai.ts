/**
 * OpenAI's recogniser (OPENAI_STT_MODEL): the default, about a hundred languages.
 */

import OpenAI, { toFile as toOpenAIFile } from "openai";
import { getConfig } from "../../config.js";
import { sttLanguage, sttPrompt } from "./prompt.js";
import type { SttInput, SttResult } from "./types.js";

let openaiClient: OpenAI | null = null;
function openai(): OpenAI {
  // 60s timeout (transcription of a short clip is fast, but leave headroom),
  // one retry — so a stuck Whisper call can't hold the request open for the
  // SDK default ~10 min.
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: getConfig().OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
  return openaiClient;
}

export async function transcribeOpenAI(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();
  const file = await toOpenAIFile(input.audio, `audio.${input.format}`);

  // The OpenAI model returns { text } (no duration). Audio-seconds for metering
  // is reported by the client recorder; words are the reliable meter here.
  const res = await openai().audio.transcriptions.create({
    file,
    model: cfg.OPENAI_STT_MODEL,
    language: sttLanguage(input.language),
    prompt: sttPrompt(
      input.vocabulary, input.language, input.languages,
      input.portraitCore, input.portraitWords,
    ),
    response_format: "json",
  });

  return {
    text: (res.text ?? "").trim(),
    durationSeconds: 0,
    // No per-segment confidence on this model — let transcribe() fall back to
    // clip duration to decide whether a bare "thank you" is real speech.
    speechConfidence: "unknown",
  };
}

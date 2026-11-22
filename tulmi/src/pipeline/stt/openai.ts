/**
 * OpenAI's recogniser (OPENAI_STT_MODEL): the default, about a hundred languages.
 *
 * Through OpenRouter unless OPENAI_STT_VIA_OPENROUTER is false: the same /audio/transcriptions call, OpenAI's own models under their
 * OpenRouter names ("openai/…"), on OPENROUTER_API_KEY. No OpenAI account of our own to run dry.
 */

import OpenAI, { toFile as toOpenAIFile } from "openai";
import { getConfig } from "../../config.js";
import { guardClient } from "../../privacy/aiGate.js";
import { sttLanguage, sttPrompt } from "./prompt.js";
import type { SttInput, SttResult } from "./types.js";

let openaiClient: OpenAI | null = null;
function openai(): OpenAI {
  // 60s timeout (transcription of a short clip is fast, but leave headroom),
  // one retry — so a stuck Whisper call can't hold the request open for the
  // SDK default ~10 min.
  if (!openaiClient) {
    const cfg = getConfig();
    openaiClient = guardClient(new OpenAI(viaOpenRouter()
      ? { apiKey: cfg.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1", timeout: 60_000, maxRetries: 1 }
      : { apiKey: cfg.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 }));
  }
  return openaiClient;
}

const viaOpenRouter = (): boolean => getConfig().OPENAI_STT_VIA_OPENROUTER !== false;

/** The model as the endpoint names it: OpenRouter wants its "openai/" prefix, OpenAI wants the bare name. */
export function sttModelName(model: string, openRouter: boolean): string {
  const bare = model.replace(/^openai\//, "");
  return openRouter ? (model.includes("/") ? model : `openai/${bare}`) : bare;
}

export async function transcribeOpenAI(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();
  const file = await toOpenAIFile(input.audio, `audio.${input.format}`);

  // The OpenAI model returns { text } (no duration). Audio-seconds for metering
  // is reported by the client recorder; words are the reliable meter here.
  const res = await openai().audio.transcriptions.create({
    file,
    model: sttModelName(cfg.OPENAI_STT_MODEL, viaOpenRouter()),
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

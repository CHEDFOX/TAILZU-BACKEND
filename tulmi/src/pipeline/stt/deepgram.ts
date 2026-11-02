/**
 * Deepgram's recogniser.
 */

import { getConfig } from "../../config.js";
import type { SttInput, SttResult } from "./types.js";

/**
 * Deepgram's PRE-RECORDED (batch) API — the file-based sibling of the live
 * engine, so Deepgram can also stand as a one-shot candidate.
 *
 * `detect_language` is on and no language is pinned: the backend identifies
 * the speech. Deepgram reports what it detected, which feeds the same
 * Indic-vs-generalist routing the other providers use.
 */
export async function transcribeDeepgram(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();
  // The model comes from config (which defaults it); an empty one is left to
  // Deepgram's own default rather than sent as "model=".
  const params = new URLSearchParams({
    ...(cfg.DEEPGRAM_STT_MODEL ? { model: cfg.DEEPGRAM_STT_MODEL } : {}),
    smart_format: "true",
    punctuate: "true",
    numerals: "true",
    detect_language: "true",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${cfg.DEEPGRAM_API_KEY ?? ""}`,
      "Content-Type": `audio/${input.format}`,
    },
    body: new Uint8Array(input.audio),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`deepgram stt failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    results?: {
      channels?: Array<{
        detected_language?: string;
        alternatives?: Array<{ transcript?: string; confidence?: number }>;
      }>;
    };
    metadata?: { duration?: number };
  };
  const channel = json.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  return {
    text: (alt?.transcript ?? "").trim(),
    durationSeconds: json.metadata?.duration ?? 0,
    // Deepgram gives a whole-utterance confidence rather than the per-segment
    // signals the Groq path filters on — map it to the coarse signal
    // transcribe() understands.
    speechConfidence:
      typeof alt?.confidence === "number"
        ? alt.confidence >= 0.6 ? "high" : "low"
        : "unknown",
    detectedLanguage: channel?.detected_language,
  };
}

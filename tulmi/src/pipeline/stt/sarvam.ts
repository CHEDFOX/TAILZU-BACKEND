/**
 * Sarvam's recogniser: the Indic specialist.
 */

import { getConfig } from "../../config.js";
import type { SttInput, SttResult } from "./types.js";

/**
 * Sarvam (Saarika) — purpose-built for Indian languages and, critically, for
 * code-mixed speech. Called over plain multipart HTTP (no SDK dependency).
 *
 * `language_code: "unknown"` is Sarvam's AUTO-DETECT mode: it identifies the
 * language itself and reports it back, which is exactly the contract we want —
 * the backend identifies the speech, the user is never asked. We record what it
 * detected but never feed it back as a constraint on a later request.
 *
 * No per-segment confidence is returned, so transcribe() falls back to clip
 * duration for the silence-hallucination decision (same as the OpenAI path).
 */
export async function transcribeSarvam(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.audio)], { type: `audio/${input.format}` }),
    `audio.${input.format}`,
  );
  const model = cfg.SARVAM_STT_MODEL;
  form.append("model", model);
  // "unknown" = detect the language. Never pin (see sttLanguage). Supported
  // from saarika:v2 onward; v1 required an explicit code and is deprecated.
  form.append("language_code", "unknown");
  // `mode` belongs to the saaras family ONLY. Sending it to a pinned legacy
  // saarika model would make every request invalid — and because a failed leg
  // just falls back to Whisper, that would degrade Indic dictation silently.
  // A config that pins an old model must not be able to produce a broken
  // request, so the parameter follows the model rather than the operator.
  //
  // On saaras:v3 it is NOT optional: that model can transcribe, translate,
  // transliterate or code-mix, so leaving it unset risks Marathi speech coming
  // back as ENGLISH, which reads exactly like "dictation isn't catching my
  // language".
  //   transcribe — same language the user spoke
  //   codemix    — built for Hindi/English mixed speech
  //   translit   — native speech returned in Latin script
  if (model.toLowerCase().startsWith("saaras")) {
    form.append("mode", cfg.SARVAM_STT_MODE);
  }

  const res = await fetch(`${cfg.SARVAM_API_URL}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": cfg.SARVAM_API_KEY ?? "" },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`sarvam stt failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    transcript?: string;
    language_code?: string;
  };
  return {
    text: (json.transcript ?? "").trim(),
    durationSeconds: 0,
    speechConfidence: "unknown",
    detectedLanguage: json.language_code,
  };
}

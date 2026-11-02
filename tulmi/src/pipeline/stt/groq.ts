/**
 * Groq's Whisper (GROQ_STT_MODEL): the fast, cheap one, and how its segments are trusted.
 */

import Groq, { toFile as toGroqFile } from "groq-sdk";
import { getConfig } from "../../config.js";
import { isKnownHallucination } from "../speechGate.js";
import { sttLanguage, sttPrompt } from "./prompt.js";
import { sanitizePlainTranscript } from "./sanitize.js";
import type { SttInput, SttResult } from "./types.js";

let groqClient: Groq | null = null;
function groq(): Groq {
  if (!groqClient) groqClient = new Groq({ apiKey: getConfig().GROQ_API_KEY });
  return groqClient;
}

export async function transcribeGroq(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();
  const file = await toGroqFile(input.audio, `audio.${input.format}`);

  // verbose_json gives us the audio duration for metering AND the
  // per-segment confidence signals (no_speech_prob, avg_logprob) we use to
  // drop hallucinated segments before they land at the cursor.
  const res = (await groq().audio.transcriptions.create({
    file,
    model: cfg.GROQ_STT_MODEL,
    language: sttLanguage(input.language),
    response_format: "verbose_json",
    prompt: sttPrompt(
      input.vocabulary, input.language, input.languages,
      input.portraitCore, input.portraitWords,
    ),
    // Temperature 0 makes Whisper deterministic and much less likely to
    // "hallucinate" on silent / low-signal chunks. The provider only accepts
    // the field on some SDK versions; ignore the cast if TS complains.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    temperature: 0 as any,
  })) as GroqVerboseResponse;

  // Only the CONFIDENCE FILTER runs here — the phrase-level scrub is deferred to
  // transcribe() so it can be gated on the clip's real duration (a confident
  // "thank you" must survive; a silent-clip hallucination must not).
  const filtered = filterConfidentSegments(res);
  return {
    text: filtered.text,
    durationSeconds: typeof res.duration === "number" ? res.duration : 0,
    speechConfidence: filtered.speechConfidence,
  };
}

interface GroqSegment {
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
  /** gzip ratio of the segment's text: Whisper's own sign of a repetition loop. */
  compression_ratio?: number;
}
interface GroqVerboseResponse {
  text: string;
  duration?: number;
  segments?: GroqSegment[];
}

/**
 * Post-process Whisper's transcript to strip:
 *   1. Segments with no_speech_prob > threshold (silent / non-speech audio
 *      that Whisper invented words for)
 *   2. Segments with very low avg_logprob (Whisper wasn't confident enough)
 *   3. Known hallucination phrases — Whisper has a well-documented failure
 *      mode where near-silent audio produces boilerplate like "Thanks for
 *      watching!" from its YouTube training data.
 *   4. Repetition loops — e.g. "you you you you" from mic drop-outs.
 *
 * If segments come back, we rebuild the text from the survivors. Otherwise
 * we run the phrase + repetition filters on the flat text.
 */
export function sanitizeWhisperText(res: GroqVerboseResponse): string {
  // Strict path (exported utility): confidence-filter, then the full phrase
  // scrub with no speech-trust. The production Groq path (transcribeGroq) does
  // NOT use this — it defers the phrase scrub to transcribe() so it can be
  // duration-gated — but callers wanting the aggressive one-shot keep it.
  return sanitizePlainTranscript(filterConfidentSegments(res).text);
}

/**
 * Drop Whisper segments that read as silence/non-speech and report how
 * confident we are that what's left is real speech:
 *   1. no_speech_prob > ceiling    → silence/non-speech Whisper invented.
 *   2. avg_logprob   < floor       → model wasn't confident enough.
 *   3. compression_ratio > ceiling → a repetition loop (Whisper's own test).
 *   4. a phrase recognisers invent on silence ("Thank you.", "जिंदगी में.")
 *      with even a moderate no-speech or low-probability reading. Whisper
 *      emits those on a quiet tail with no_speech_prob well under 0.6, which
 *      is why rule 1 alone let them through as "high" confidence.
 * `speechConfidence` is "high" when confident segments survived, "low" when
 * segments existed but all were dropped (a silence signal), "unknown" when the
 * response carried no segments to judge.
 */
export function filterConfidentSegments(res: GroqVerboseResponse): {
  text: string;
  speechConfidence: "high" | "low" | "unknown";
} {
  const NO_SPEECH_CEIL = 0.6;
  const AVG_LOGPROB_FLOOR = -1.0; // ln(p) — anything below this = coin flip
  const COMPRESSION_CEIL = 2.4;   // Whisper's own threshold for a looping decode
  const KNOWN_NO_SPEECH_CEIL = 0.3;
  const KNOWN_LOGPROB_FLOOR = -0.7;

  if (Array.isArray(res.segments) && res.segments.length > 0) {
    const kept = res.segments.filter((s) => {
      if (typeof s.no_speech_prob === "number" && s.no_speech_prob > NO_SPEECH_CEIL) return false;
      if (typeof s.avg_logprob === "number" && s.avg_logprob < AVG_LOGPROB_FLOOR) return false;
      if (typeof s.compression_ratio === "number" && s.compression_ratio > COMPRESSION_CEIL) return false;
      if (isKnownHallucination(s.text ?? "") && (
        (typeof s.no_speech_prob === "number" && s.no_speech_prob > KNOWN_NO_SPEECH_CEIL) ||
        (typeof s.avg_logprob === "number" && s.avg_logprob < KNOWN_LOGPROB_FLOOR))) return false;
      return true;
    });
    const text = kept.map((s) => (s.text ?? "").trim()).filter(Boolean).join(" ");
    return { text, speechConfidence: kept.length > 0 ? "high" : "low" };
  }
  return { text: (res.text ?? "").trim(), speechConfidence: "unknown" };
}

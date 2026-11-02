/**
 * What a transcription is asked with, and what it answers.
 */

import type { AudioFormat, LanguageHint } from "../../../../shared/types/api.js";
import type { DetectedScript } from "../script.js";
import type { GateReason } from "../speechGate.js";

export interface SttResult {
  text: string;
  /** Audio length in seconds (0 when the provider doesn't report it). */
  durationSeconds: number;
  /** Script the transcript actually came back in — observed, never declared.
   *  Passed to cleanup so script fidelity is a fact rather than a hope. */
  script?: DetectedScript;
  /** Language the PROVIDER detected, when it reports one (Sarvam does).
   *  Recorded as a passive signal; never used to constrain a later request. */
  detectedLanguage?: string;
  /** Which engine produced this transcript. Surfaced to the client so a
   *  silently-failing provider is visible without reading server logs. */
  engine?: string;
  /**
   * A SECOND recognizer's reading of the same audio, present only when it
   * MEANINGFULLY disagrees with `text`.
   *
   * Two engines fail in different places — on "kal ka plan WhatsApp pe bhej
   * dena" the Indic model tends to win the Hindi and the generalist tends to
   * win the brand name. Picking one transcript can never have both; handing
   * the writing model both candidates lets it reconcile them. Absent when the
   * two agree (the common case), so the prompt stays untouched.
   */
  alternative?: string;
  /**
   * How sure the recognizer was that it heard real, intelligible speech.
   *
   * Computed already — it decides whether a bare "thank you" is a real
   * one-word dictation or a silence hallucination — and then discarded. It is
   * the one thing that separates "they said this" from "this is my best
   * guess at what they said", and the writing step, which knows the language
   * and could repair a mishearing, never saw it.
   *   "high"    — provider confidence says this is real speech (keep it).
   *   "low"     — provider flagged it as non-speech/silence (safe to strip).
   *   "unknown" — no per-segment confidence (OpenAI path); fall back to duration.
   */
  speechConfidence?: "high" | "low" | "unknown";
  /**
   * What the OTHER engines heard, in auto mode ("" = ran and heard nothing).
   * Evidence for the no-speech gate: text only one engine hears, on a quiet
   * clip where another heard silence, is not trusted.
   */
  otherReadings?: string[];
  /** Seconds of voice measured in the clip; absent when it could not be measured. */
  voicedSeconds?: number;
  /** Set when the recogniser's text was withheld, and why (see speechGate). */
  dropped?: GateReason;
}

export interface SttInput {
  audio: Buffer;
  format: AudioFormat;
  language?: LanguageHint;
  /** Personal dictionary (names/jargon) to bias recognition toward. */
  vocabulary?: string;
  /** The user's learned style portrait. Only the WORDS it quotes are used —
   *  see portraitTerms for why the prose must never reach the decoder. */
  portraitCore?: string;
  /** The portrait's word list — the preferred source for biasing. */
  portraitWords?: Array<{ term: string }>;
  /** Every language this user speaks day to day, primary first (the
   *  Languages card). Each contributes its own script to the prompt, which is
   *  what a bilingual speaker needs: one exemplar can only prime one script,
   *  and priming the wrong one is how Hindi came back romanized. */
  languages?: string[];
}

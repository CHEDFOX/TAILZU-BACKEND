/**
 * A transcript cleaned of what recognisers make up: boilerplate, phrases heard in silence, repetitions.
 */

import type { AudioFormat } from "../../../../shared/types/api.js";
import { measureSpeech } from "../speechPresence.js";

/**
 * Flat-text sanitizer for a transcript. Strips known silence-hallucination
 * phrases and collapses degenerate repetition. Idempotent.
 *
 * `trustSpeech` (default false): when the caller has a positive signal that the
 * clip is real speech (confident segments, or long enough to hold a word), the
 * aggressive short-phrase nuke is skipped so a legitimate one-word "thank
 * you"/"you" dictation survives. Multi-word YouTube boilerplate is stripped
 * either way.
 */
export function sanitizePlainTranscript(
  text: string,
  opts: { trustSpeech?: boolean } = {},
): string {
  return collapseRepetitions(
    stripHallucinationPhrases(text, opts.trustSpeech ?? false),
  ).trim();
}

/**
 * Multi-word boilerplate the Whisper-family models lift from their video
 * training data on near-silent clips ("thanks for watching", "please
 * subscribe", "[music]"). Nobody dictates these standalone into a keyboard, so
 * we strip them on ANY path regardless of confidence. Anchored ^…$ so we only
 * nuke a standalone occurrence, never one buried in a real sentence.
 */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /^\s*thanks?\s+for\s+watching[!.\s]*$/i,
  /^\s*thank\s+you\s+for\s+watching[!.\s]*$/i,
  /^\s*please\s+subscribe[!.\s]*$/i,
  /^\s*subscribe\s+to\s+my\s+channel[!.\s]*$/i,
  /^\s*don'?t\s+forget\s+to\s+(like\s+and\s+)?subscribe[!.\s]*$/i,
  /^\s*see\s+you\s+(next\s+time|in\s+the\s+next\s+video)[!.\s]*$/i,
  /^\s*outro[!.\s]*$/i,
  /^\s*\[music\][!.\s]*$/i,
];

/**
 * Short phrases that are BOTH a common silence hallucination AND a legitimate
 * one-word dictation ("thank you", "you", "bye"). These are only stripped when
 * `trustSpeech` is false — i.e. we have a positive silence signal. With trust,
 * they're kept, so a real short utterance isn't swallowed (the reported bug).
 */
const AMBIGUOUS_SILENCE_PATTERNS: RegExp[] = [
  /^\s*thank\s*you(\s+(so|very)\s+much)?(\s+(guys|all|everyone))?[!.\s]*$/i,
  /^\s*thanks(\s+(a\s+lot|so\s+much))?(\s+(guys|all|everyone))?[!.\s]*$/i,
  /^\s*you[!.\s]*$/i,
  /^\s*bye[!.\s]*$/i,
  /^\s*(um|uh|hmm|mm|ah)[!.\s]*$/i,
  // The recognisers' other answer to a breath or a chair creaking.
  /^\s*(okay|ok)[!.\s]*$/i,
];

/** True when the whole transcript is one of the phrases above. */
export function isAmbiguousPhrase(text: string): boolean {
  const t = (text ?? "").trim();
  return !!t && AMBIGUOUS_SILENCE_PATTERNS.some((p) => p.test(t));
}

/**
 * Seconds of VOICE in the clip (speechPresence.measureSpeech: louder than the
 * room and pitched). -1 when it cannot be measured (no ffmpeg for a
 * compressed clip, a clip it cannot read, a format it is not given), which
 * callers treat as "unknown", never as silent.
 *
 * It used to count everything louder than -38 dB, so a breath or a knock
 * right at the mic measured as speech. Voicing is what separates the two.
 */
export async function speechSeconds(audio: Buffer, format: AudioFormat): Promise<number> {
  const m = await measureSpeech(audio, format);
  return m ? m.voicedSeconds : -1;
}

function stripHallucinationPhrases(text: string, trustSpeech: boolean): string {
  const t = text.trim();
  if (!t) return "";
  // Always kill unambiguous video boilerplate.
  for (const pat of BOILERPLATE_PATTERNS) {
    if (pat.test(t)) return "";
  }
  // Only kill ambiguous short filler when we DON'T trust the clip as speech.
  if (!trustSpeech) {
    for (const pat of AMBIGUOUS_SILENCE_PATTERNS) {
      if (pat.test(t)) return "";
    }
  }
  // Trim a hallucinated outro tail off an otherwise-real transcript (safe:
  // only strips a known outro appended to real text, never the whole thing).
  // (?<!\s): a match may only start where a run of spaces does, so a long run
  // is scanned once rather than once per space.
  return t
    .replace(/(?<!\s)\s*(thanks? for watching|thank you for watching|please subscribe|don'?t forget to (like and )?subscribe|see you next time)[!.\s]*$/i, "")
    .trim();
}

/**
 * Collapse a degenerate repetition loop ("you you you you you") that Whisper
 * emits when it loses signal mid-utterance. We keep at most TWO in a row and
 * drop the rest — two survives natural emphasis ("no no", "very very") while a
 * runaway loop of 3+ identical tokens collapses to "no no". (Not down to a
 * single token: that would flatten legitimate doubled words.)
 */
function collapseRepetitions(text: string): string {
  if (!text) return "";
  const words = text.split(/\s+/);
  const out: string[] = [];
  let last = "";
  let repeat = 0;
  for (const w of words) {
    const norm = w.toLowerCase();
    if (norm === last) {
      repeat += 1;
      if (repeat < 3) out.push(w); // keep the 1st + 2nd, drop the 3rd onward
    } else {
      last = norm;
      repeat = 1;
      out.push(w);
    }
  }
  return out.join(" ");
}

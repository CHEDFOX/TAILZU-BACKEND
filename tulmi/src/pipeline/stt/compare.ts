/**
 * Two transcripts of one clip: whether they agree, and whether the other one is worth taking.
 */

import { detectScript, INDIC_SCRIPTS } from "../script.js";
import type { SttResult } from "./types.js";

/** Languages Sarvam is purpose-built for. A detection landing anywhere in this
 *  set means the Indic specialist is the better transcript. Sarvam reports
 *  region-tagged codes ("hi-IN"), so compare on the base code. */
const INDIC_LANGUAGES = new Set([
  "hi", "mr", "ta", "te", "bn", "gu", "pa", "kn", "ml", "ur",
  "or", "as", "sa", "ne", "sd", "kok", "mai", "doi", "brx", "mni", "sat", "ks",
]);

export function transcriptsAgree(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/[.,!?;:'"“”‘’()\-—…]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return norm(a) === norm(b);
}

/**
 * Is `other` a genuine second reading, or a failed/truncated call wearing the
 * costume of one? A provider that returns a fragment (or a wall of repeated
 * hallucination) is noise, and feeding it to the writing model as an equal
 * candidate would invite exactly the "average two readings into a third thing
 * nobody said" failure. Require it to be in the same ballpark by length.
 */
export function isUsableAlternative(primary: string, other: string): boolean {
  const p = primary.trim().length;
  const o = other.trim().length;
  if (!o || !p) return false;
  const ratio = Math.min(p, o) / Math.max(p, o);
  if (ratio < 0.4) return false;
  // Two readings of the same speech share a script. One in Devanagari and
  // one in Latin is not a disagreement about what was said — it is a
  // translation or a romanization from an engine that drifted, and handing
  // both to the writer as "candidates" produced text that was neither.
  const ps = detectScript(primary);
  const os = detectScript(other);
  if (ps !== "unknown" && os !== "unknown" && ps !== os) return false;
  return true;
}

export function isIndicResult(r: SttResult): boolean {
  const base = (r.detectedLanguage ?? "").toLowerCase().split(/[-_]/)[0];
  if (base && INDIC_LANGUAGES.has(base)) return true;
  // Native-script output is decisive even when no language code came back.
  return INDIC_SCRIPTS.has(detectScript(r.text));
}

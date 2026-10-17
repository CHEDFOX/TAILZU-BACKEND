/**
 * Transcript accuracy, as a number.
 *
 * Used by scripts/stt-bench.ts to settle which speech engine is actually
 * better on a given language instead of trading impressions about it. Kept out
 * of the script so the arithmetic can be tested without audio, API keys or
 * money — the bench is the only thing that spends those, and the part most
 * likely to be quietly wrong is this.
 */

/**
 * Normalise before scoring, or the numbers measure punctuation.
 *
 * Case, punctuation and repeated whitespace are noise for this question: the
 * writing step fixes all three, every time, so an engine must not be marked
 * down for them. What survives is the words themselves, which is the only
 * thing a recognizer can get right or wrong. The Devanagari danda and the
 * Arabic comma are in the strip set because Indic output is the point of the
 * bench and English punctuation rules do not cover it.
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:"'`’‘“”()[\]{}—–-]|[।॥،؟]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein over any token sequence. Words for WER, characters for CER. */
export function editDistance(a: readonly string[], b: readonly string[]): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,                                   // deletion
        row[j - 1] + 1,                                // insertion
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Word and character error rate against a reference.
 *
 * BOTH, because either alone lies about a language the other was built for.
 * WER is the standard and is what you want for English. But Indic scripts
 * write a whole clause without a space, so one wrong character can fail an
 * entire "word": a transcript that is 90% right by character can score 0%
 * by word, which would make the Indic specialist look catastrophic on exactly
 * the audio it handles best. CER is the fairer read there. Report both and let
 * the reader use the right one for the language in front of them.
 */
export function score(reference: string, hypothesis: string): { wer: number; cer: number } {
  const r = normalise(reference);
  const h = normalise(hypothesis);
  const rw = r.split(" ").filter(Boolean);
  const hw = h.split(" ").filter(Boolean);
  const rc = [...r.replace(/\s/g, "")];
  const hc = [...h.replace(/\s/g, "")];
  return {
    wer: rw.length ? editDistance(rw, hw) / rw.length : hw.length ? 1 : 0,
    cer: rc.length ? editDistance(rc, hc) / rc.length : hc.length ? 1 : 0,
  };
}

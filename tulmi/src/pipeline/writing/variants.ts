/**
 * refineVariants(): the same words written a few different ways, for Training to pick from.
 */

import type { CleanupOptions } from "../../../../shared/types/api.js";
import { getConfig } from "../../config.js";
import { compose } from "../../principles/roles.js";
import { stripFenceTags, readSend } from "../assistPrompt.js";
import { assist } from "./assist.js";
import { complete, MAX_TOKENS_CLEANUP } from "./model.js";
import { quotesPrompt, runaway, looksLikeEmptyEcho, looksLikeMeta } from "./output.js";
import { writerRequest } from "./writerRequest.js";

// --- Style portrait (Training tab) -----------------------------------------

/**
 * Training: produce three distinct refined variants of the same input so the
 * user can pick the one that sounds most like them. One JSON call — the
 * variants probe different directions (their learned style, tighter, warmer)
 * while all staying faithful to the message. Falls back to a single assist()
 * result if the JSON reply is unusable, so the Training screen never dead-ends.
 */
/** The three directions the Training tab probes. Authored as separate calls
 *  rather than one JSON blob — see refineVariants. Each is the dynamic part of
 *  one call of the writer role: a line in <call>, after the stable block. */
export const VARIANT_ANGLES: Array<{ angle: string; brief: string }> = [
  { angle: "closest", brief: "Follow their style portrait exactly (or do a neutral clean-up if there is none)." },
  { angle: "tighter", brief: "Noticeably more compact and direct than you would normally write it. Cut every word that isn't pulling weight." },
  { angle: "warmer", brief: "Noticeably more natural and personal than you would normally write it — how they'd talk to someone they like." },
];

/**
 * Training: produce three refinements of the same input, differing only in
 * style, so the user can pick the one that sounds most like them.
 *
 * Three PARALLEL calls, not one call returning JSON. The single-call version
 * had to generate ~3× the output tokens before anything could render, and the
 * user sat watching "Refining…" for all of it — the Training tab felt broken.
 * Run concurrently, the wait is one short completion instead of one long one,
 * and dropping JSON mode removes both the formatting overhead and a whole
 * class of parse failures.
 *
 * Each call carries the FULL assist prompt, so instruction separation, script
 * fidelity and the style portrait all apply — a command like "write this in
 * Marathi" is executed once per variant rather than being rewritten as if it
 * were part of the message.
 */
export async function refineVariants(
  message: string,
  opts: CleanupOptions = {},
): Promise<Array<{ text: string; angle: string }>> {
  if (!message.trim()) return [];
  // The same request the keyboard sends: instruction off, script stated, what
  // they said fenced in <said>. It used to go as a bare user turn under a
  // prompt that says it arrives in <said>, with none of assist()'s checks on
  // the way out.
  const settled = await Promise.allSettled(
    VARIANT_ANGLES.map(async ({ angle, brief }) => {
      // The separation contract in the writer role decides WHAT to write; the
      // direction only shapes HOW. It is one more line of <call>, so a spoken
      // instruction is still executed rather than treated as content to
      // restyle, and the system prompt is the keyboard's own, byte for byte.
      const req = writerRequest(message, { ...opts, variant: brief });
      const res = await complete({
        model: getConfig().CLEANUP_MODEL,
        temperature: 0.6, // higher than cleanup: the variants must actually differ
        max_tokens: MAX_TOKENS_CLEANUP,
        messages: compose("writer", [{ role: "user" as const, content: req.userContent }]),
      });
      const text = stripFenceTags(readSend(res.choices[0]?.message?.content ?? "")).trim();
      // A variant that leaks the prompt, runs away or is a placeholder is not
      // one to choose between: it is dropped, like a refusal.
      const bad = quotesPrompt(text, req.told) || runaway(text, req.message) || looksLikeEmptyEcho(text);
      return { angle, text: bad ? "" : text };
    }),
  );

  const out = settled
    .filter((r): r is PromiseFulfilledResult<{ angle: string; text: string }> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v) => v.text && !looksLikeMeta(v.text));

  // Identical variants are worse than fewer variants — a user asked to choose
  // between three copies of the same sentence learns nothing and teaches us
  // nothing. Keep the first of any duplicate.
  const seen = new Set<string>();
  const unique = out.filter((v) => {
    const key = v.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length >= 2) return unique.slice(0, 3);

  // Every leg failed (or they all collapsed to one reading) — fall back to a
  // single ordinary refine so the Training tab never dead-ends.
  const single = await assist(message, opts);
  return single.trim() ? [{ angle: "closest", text: single.trim() }] : unique;
}

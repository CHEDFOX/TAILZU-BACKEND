/**
 * The tone ids the server mounts a route for.
 *
 * WHAT USED TO BE HERE, and why it is gone: a second, hand-tuned system prompt
 * per tone, plus a shared instruction layer, plus the builder that stitched
 * them together — about 145 lines defining "formal", "casual", "very-casual"
 * and "excited" all over again.
 *
 * Nothing called it. Every tone route runs through assist() and picks its
 * voice from TONE_GUIDANCE in assistPrompt.ts, so this file held a SECOND
 * definition of every tone that no request ever reached. Two definitions of
 * one thing do not stay equal: this one still carried the enumerated style
 * that the live prompts have moved away from, so reviving it would have
 * quietly reverted the change. Its only surviving caller was refineWithTone(),
 * which had no callers of its own.
 *
 * The ids remain because the server iterates them to mount POST
 * /v1/refine/<tone>. That is now all this file is for.
 */
import type { PresetTone } from "../experience/personalityPresets.js";

export const LLM_TONES: Array<Exclude<PresetTone, "none">> = [
  "formal", "casual", "very-casual", "excited",
];

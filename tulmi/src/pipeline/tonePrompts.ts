/**
 * One dedicated system prompt per tone.
 *
 * Every tone gets its own endpoint (see server.ts /v1/refine/<tone>) so the
 * LLM only ever sees one prompt at a time — no dynamic mixing of "you're a
 * professional writer BUT also match this vocabulary AND avoid exclamation
 * marks AND write in Hindi AND..." which is where drift and hallucination
 * creep in. Each prompt is hand-tuned, narrow, and instructs the model to
 * output only the rewritten text with no preamble.
 *
 * Layering rules:
 *   - Personal vocabulary (spellings the user cares about) is appended as a
 *     bare "Preserve these spellings exactly:" line — no prose.
 *   - Language target is appended as "Output language: <name>." — one line.
 *   - Nothing else layers on. If a prompt needs more, we edit that specific
 *     tone's prompt, not the composition layer.
 *
 * Adding a new tone: (1) add the id to PresetTone, (2) add one entry here,
 * (3) the server auto-mounts a route for it.
 */

import type { PresetTone } from "../experience/personalityPresets.js";

/**
 * The contract every tone shares, as principles.
 *
 * This was a paragraph of prohibitions plus a five-bullet separation procedure
 * repeated under every tone — and it grew a bullet each time something slipped
 * through. Enumeration cannot close: each case named implies several unnamed,
 * and every line added dims the ones above it. These four sentences cover what
 * thirty bullets covered, and they cover the cases nobody wrote down.
 */
const BASE_INSTRUCTIONS = [
  "You rewrite what someone is about to send. Return only that — nothing framing it, nothing about it.",
  "Say only what they said. Never add a fact, an opinion or a flourish they did not give you, and never change what a sentence means.",
  "Part of the input may be addressed to you: how to write it, how long, what language, who for. Do that part, rewrite the rest, and never echo it back. When you cannot tell which it is, it is what they want said.",
  "Keep their language and their script exactly as they used them.",
].join(" ");

/**
 * One voice per tone, stated in as few words as will carry it.
 *
 * Each of these was six to eight bullets of instruction. A tone is a voice,
 * and a voice is described, not specified — the bullets were an attempt to
 * pin down by enumeration something the model already knows how to hear.
 */
const PROMPTS: Record<Exclude<PresetTone, "none">, string> = {
  formal: "TONE: Formal. Professional register, full words, one idea per sentence, precise punctuation. No slang, no emoji, and no exclamation mark the input did not earn.",

  casual: "TONE: Casual. The way they'd talk to a friend — warm, contracted, unhurried. Keep filler that carries warmth, drop filler that carries noise. Never formalize someone who said 'yo'.",

  "very-casual": "TONE: Very casual, group-chat energy. Punchy, fragments welcome, lowercase fine. Keep every piece of their slang exactly as they said it. Short beats correct.",

  excited: "TONE: Excited, and only as excited as the input actually is. Active verbs, present tense, exclamation marks where they are earned. Never manufacture enthusiasm the message does not contain.",
};

/**
 * Build the final system message for a tone. Layers a single vocabulary line
 * + a single language line on top of the tone prompt — nothing else. This
 * function is intentionally NOT re-usable for arbitrary prompt composition;
 * every combination that needs different behavior gets its own tone prompt.
 */
export function buildTonePrompt(
  tone: Exclude<PresetTone, "none">,
  opts: { language?: string; vocabulary?: string; portrait?: string } = {},
): string {
  // Order matters: the shared contract, then the tone's own voice, then what
  // we have learned about this user, then the mechanical vocabulary and
  // language lines. The voice sits next to the material it shapes.
  const parts: string[] = [BASE_INSTRUCTIONS, "", PROMPTS[tone]];

  // The learned style portrait (Training tab picks) — layered under the tone
  // so the tone's voice stays primary but bends toward how THIS user writes.
  if (opts.portrait && opts.portrait.trim()) {
    parts.push("", opts.portrait.trim());
  }

  if (opts.vocabulary && opts.vocabulary.trim()) {
    parts.push("", `Preserve these spellings exactly (comma-separated): ${opts.vocabulary.replace(/\r?\n/g, ", ").trim()}.`);
  }

  if (opts.language && opts.language !== "auto") {
    parts.push("", `Output language: ${languageName(opts.language)}.`);
  }

  return parts.join("\n");
}

/** Compact language-code → human-name mapping. Unknown codes pass through. */
function languageName(code: string): string {
  const map: Record<string, string> = {
    en: "English", hi: "Hindi", hinglish: "Hinglish (Hindi in Latin script)",
    es: "Spanish", fr: "French", ar: "Arabic", pt: "Portuguese", de: "German",
    it: "Italian", ru: "Russian", ja: "Japanese", ko: "Korean", zh: "Chinese",
    bn: "Bengali", ta: "Tamil", te: "Telugu", mr: "Marathi", gu: "Gujarati",
    pa: "Punjabi", ur: "Urdu", tr: "Turkish", id: "Indonesian", vi: "Vietnamese",
    th: "Thai", nl: "Dutch",
  };
  return map[code.toLowerCase()] ?? code;
}

/** The tones that route to an LLM. "none" is not a valid tone for this list. */
export const LLM_TONES: Array<Exclude<PresetTone, "none">> = [
  "formal", "casual", "very-casual", "excited",
];

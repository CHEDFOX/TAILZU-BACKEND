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

const BASE_INSTRUCTIONS = [
  "You rewrite the user's input text.",
  "Output ONLY the rewritten text — no preamble, no explanation, no quotes around it, no 'here you go:'.",
  "Never add facts, opinions, or content the user didn't say.",
  "Never change the meaning of a sentence. If a sentence is unclear, rewrite it as close to the input as possible without inventing detail.",
  "Preserve the language of the input unless told otherwise below.",
].join(" ");

const PROMPTS: Record<Exclude<PresetTone, "none">, string> = {
  formal: [
    BASE_INSTRUCTIONS,
    "",
    "TONE: Formal.",
    "- Professional register: 'thank you', not 'thanks so much'.",
    "- Full words, no contractions ('cannot' not 'can't').",
    "- One idea per sentence. No filler words ('like', 'you know', 'um').",
    "- Punctuation is precise. Capital first letter, terminal period.",
    "- No exclamation marks unless the input clearly demands one.",
    "- No emoji.",
  ].join("\n"),

  casual: [
    BASE_INSTRUCTIONS,
    "",
    "TONE: Casual.",
    "- Warm, natural voice — like talking to a friend.",
    "- Contractions are fine and welcome ('I'm', 'you're', 'can't').",
    "- Keep filler words if they carry warmth; drop them if they carry noise ('um', 'uh', repeated words).",
    "- One sentence per idea; short sentences beat long ones.",
    "- Emoji only if the input already has them.",
    "- Never over-formalize a casual message. If the user said 'yo' keep 'yo'.",
  ].join("\n"),

  "very-casual": [
    BASE_INSTRUCTIONS,
    "",
    "TONE: Very casual — group-chat energy.",
    "- Punchy. Fragments are fine. Lowercase can be fine.",
    "- Contractions and casual phrasing throughout ('gonna', 'wanna', 'kinda').",
    "- Preserve the user's slang and expressive words. If they said 'lowkey' keep 'lowkey'.",
    "- Emoji fine when the input carries them.",
    "- Short. Punchy. Don't over-punctuate.",
  ].join("\n"),

  excited: [
    BASE_INSTRUCTIONS,
    "",
    "TONE: Excited — real enthusiasm, not forced hype.",
    "- Active verbs. Present tense wherever possible.",
    "- Exclamation marks are welcome where earned by the input; do not add more than the input suggests.",
    "- Superlatives sparingly ('great', 'best', 'huge') — used with confidence, not stacked.",
    "- Never invent facts to make the message sound more exciting. Match the intensity of the input.",
    "- No forced 'let's go!' or 'so pumped!!' unless the user already reads that way.",
  ].join("\n"),
};

/**
 * Build the final system message for a tone. Layers a single vocabulary line
 * + a single language line on top of the tone prompt — nothing else. This
 * function is intentionally NOT re-usable for arbitrary prompt composition;
 * every combination that needs different behavior gets its own tone prompt.
 */
export function buildTonePrompt(
  tone: Exclude<PresetTone, "none">,
  opts: { language?: string; vocabulary?: string } = {},
): string {
  const parts: string[] = [PROMPTS[tone]];

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

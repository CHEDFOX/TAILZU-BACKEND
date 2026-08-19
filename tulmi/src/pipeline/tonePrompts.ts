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

/**
 * Instruction separation for the per-tone endpoints.
 *
 * The assist path (/v1/refine, keyboard + dictation) has always separated an
 * embedded command from the message. The hand-tuned per-tone prompts did NOT
 * — so "…and write it in Marathi" spoken into a tone endpoint got politely
 * REWRITTEN as if it were part of the message instead of executed. Same
 * contract, stated compactly so each tone's own voice still leads.
 */
const INSTRUCTION_LAYER = [
  "BEFORE rewriting, separate MESSAGE from INSTRUCTION:",
  "- The input may carry a direction addressed to you about FORMAT, LENGTH, LANGUAGE, or AUDIENCE — e.g. \"make it shorter\", \"in bullet points\", \"write this in Marathi\", \"tell them politely that…\". The direction may itself be spoken in any language.",
  "- Follow the direction, rewrite only the content, and NEVER echo the direction back in your output.",
  "- Words like \"write\"/\"tell\"/\"send\" inside what the user is saying to someone else are content, not directions. When in doubt, treat it as content.",
  "- SCRIPT: keep the user's script. Romanized/Latin-script Hindi, Marathi, Urdu, Tamil etc. stay in Latin script — never convert to Devanagari or another native script, never translate to English, unless the user asks.",
].join("\n");

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
  opts: { language?: string; vocabulary?: string; portrait?: string } = {},
): string {
  // Order matters: the tone's own voice leads, then the separation contract
  // (so a spoken command is executed, not rewritten), then what we've learned
  // about this user, then the mechanical vocabulary/language lines.
  const parts: string[] = [PROMPTS[tone], "", INSTRUCTION_LAYER];

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

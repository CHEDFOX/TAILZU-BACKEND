/**
 * Training's conversation: one spoken turn back, in the language the person speaks.
 */

import type { Personality } from "../../../../shared/types/api.js";
import { getConfig } from "../../config.js";
import { compose } from "../../principles/roles.js";
import { inlineValue } from "../../prompts.js";
import { callBlock } from "../assistPrompt.js";
import { detectScript, romanHindiHits } from "../stt.js";
import { complete } from "./model.js";
import { looksLikeMeta } from "./output.js";

// --- Training by conversation ----------------------------------------------
//
// The other half of the Train tab. The picking loop learns from a choice
// between three written versions; this learns from someone just talking, which
// gets at things a written variant cannot show — how long their sentences run
// before they stop, whether they ask back, what they sound like when nobody is
// editing them.
//
// Every line here is spoken aloud, so the constraints are different from
// anything else in this file: short, no punctuation the ear cannot hear, no
// lists, no formatting at all.

/** Spoken turns, oldest first. */
export type ConverseTurn = { role: "user" | "assistant"; text: string };

const MAX_TOKENS_SPOKEN = 160;      // two sentences of speech, with headroom
const CONVERSE_TEMPERATURE = 0.75;  // this is small talk, not a spec
/** How many turns the model is shown. Older ones fall off the front. */
const CONVERSE_WINDOW = 24;

/**
 * The next thing the app says out loud.
 *
 * It is an interested stranger, not an interviewer with a form and not a
 * coach. The whole design goal is that the user forgets they are being
 * listened to and just talks, because a person performing "how I talk" is
 * exactly the sample we do not want.
 */
/** The spoken training partner's prompt. Exported so it can be read and
 *  tested; `npm run prompts` prints it. */
/**
 * The user's language, as a name the model can follow. The hint is a code
 * ("hi", "hinglish", "es"), and "Speak in hi" is not an instruction anyone
 * would give; "Speak in Hindi" is. Hinglish is spelled out, because it is not
 * a language a model knows by name so much as a way of mixing two.
 */
export function languageName(code?: string): string | null {
  const c = String(code ?? "").trim().toLowerCase();
  if (!c || c === "auto") return null;
  if (c === "hinglish") return "Hinglish — Hindi and English mixed the way they mix them, in Latin letters";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(c);
    if (name && name.toLowerCase() !== c) return name;
  } catch { /* an unknown code is spoken as itself */ }
  return c;
}

/**
 * WHAT THEY ARE SPEAKING, read from what they just said.
 *
 * The conversation was told the language saved on their account — "Speak in
 * English, always" — and answered in it while they spoke Bengali. What they
 * say is the only thing that says what they speak. The script names most
 * languages outright; romanized Hindi is recognised by its words.
 */
const SCRIPT_LANGUAGE: Partial<Record<string, { name: string; locale: string }>> = {
  devanagari: { name: "Hindi (or the Devanagari language they are using), in Devanagari", locale: "hi-IN" },
  bengali: { name: "Bengali, in Bengali script", locale: "bn-IN" },
  tamil: { name: "Tamil, in Tamil script", locale: "ta-IN" },
  telugu: { name: "Telugu, in Telugu script", locale: "te-IN" },
  gujarati: { name: "Gujarati, in Gujarati script", locale: "gu-IN" },
  gurmukhi: { name: "Punjabi, in Gurmukhi", locale: "pa-IN" },
  kannada: { name: "Kannada, in Kannada script", locale: "kn-IN" },
  malayalam: { name: "Malayalam, in Malayalam script", locale: "ml-IN" },
  arabic: { name: "the language they are using (Urdu, Arabic or Persian), in its script", locale: "ur-PK" },
};
export function spokenLanguage(text: string): { name: string; locale?: string } | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const script = detectScript(t);
  const known = SCRIPT_LANGUAGE[script];
  if (known) return known;
  if (script === "latin" && romanHindiHits(t) >= 2) {
    return { name: "Hinglish, Hindi and English mixed the way they mix them, in English letters", locale: "en-IN" };
  }
  return null;
}

/**
 * What the `converse` role is told about THIS turn: the language they speak,
 * read from what they just said (spokenLanguage) and, until they speak, the
 * one saved on their account. What they speak decides, every turn; the saved
 * language only opens. Exported for review and testing.
 */
export function converseContext(language?: string, heard?: string): string {
  // A code from the request, spoken back inside a sentence.
  const name = inlineValue(languageName(language), 80);
  const now = heard ? spokenLanguage(heard) : null;
  return callBlock([now ? `They are speaking ${now.name}: answer in that.` : name ? `Until they speak, use ${name}.` : null]);
}

export async function converseTurn(
  turns: ConverseTurn[],
  opts: { personality?: Personality; language?: string } = {},
): Promise<string> {
  const said = turns.filter((t) => t.text?.trim()).slice(-CONVERSE_WINDOW);
  if (!said.length) return "";
  const lastTheirs = [...said].reverse().find((t) => t.role === "user")?.text ?? "";
  const note = converseContext(opts.language, lastTheirs);

  const res = await complete({
    model: getConfig().CLEANUP_MODEL,
    temperature: CONVERSE_TEMPERATURE,
    max_tokens: MAX_TOKENS_SPOKEN,
    // The language note is the first thing after the stable block, then the talk so far.
    messages: compose("converse", [
      ...(note ? [{ role: "user" as const, content: note }] : []),
      ...said.map((t) => ({
        role: t.role === "user" ? ("user" as const) : ("assistant" as const),
        content: t.text.trim().slice(0, 1200),
      })),
    ]),
  });
  const text = (res.choices[0]?.message?.content ?? "").trim();
  return looksLikeMeta(text) ? "" : text;
}

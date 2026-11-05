/**
 * WHAT PEOPLE POST IN SPACES IS SCREENED BEFORE IT IS POSTED (App Review 1.2: "a method for filtering objectionable material from
 * being posted to the app"). Reports and blocks (safety.ts) are for what gets past it.
 *
 *   screenPost(parts)   every message, shared thing (its name, words, list lines and note) and line added to a shared list, before
 *                       it is kept. Two checks:
 *     1. a word list, here (BLOCKED, PHRASES): slurs, explicit sexual words, the worst Hindi and Hinglish abuse, and threats, with
 *        their l33t, spaced and stretched spellings ("n1gg@", "k i l l  y o u", "chuuutiya"). Whole words only, so "Scunthorpe",
 *        "class" and "assess" pass.
 *     2. a moderation service, when the server installed one (setModeration: OpenAI's moderation model, free): hate, threats,
 *        sexual content, anything sexual with minors, graphic violence, self-harm instructions, violent crime. It runs as the sender
 *        (the AI permission, privacy/aiGate.ts, applies: someone who has not agreed gets the word list only). Slow (MODERATION_MS)
 *        or failing, it is skipped: the word list's verdict stands.
 *   A hit throws BotError("blocked_content", BLOCKED_TEXT, 422): nothing is posted, and the sender is told why.
 */
import { BotError } from "../bots/index.js";

export const BLOCKED_TEXT = "That wasn't posted: Spaces don't allow hate, sexual content, threats or abuse. Change it and try again.";
/** How long the moderation service gets before the word list alone decides. */
export const MODERATION_MS = 1500;

// The word list. Kept short and unambiguous on purpose (a family app: "cock" is a rooster, "pussy" a cat): what is here is never fine.
const BLOCKED: readonly string[] = [
  // Slurs
  "nigger", "nigga", "niggers", "niggas", "faggot", "faggots", "kike", "kikes", "chink", "chinks", "spic", "spics",
  "wetback", "tranny", "trannies", "retard", "retards", "paki", "pakis", "raghead", "towelhead", "gook",
  "katua", "chamar", "bhangi",
  // Explicit sexual
  "porn", "porno", "nudes", "blowjob", "handjob", "cumshot", "gangbang", "jerkoff", "dickpic", "pedo", "paedo", "pedophile",
  "rape", "raping", "rapist",
  // Hindi and Hinglish abuse
  "madarchod", "maderchod", "behenchod", "bhenchod", "benchod", "bhosdike", "bhosdi", "bhosda", "chutiya", "chutiye",
  "chut", "lund", "lauda", "lavda", "loda", "gaandu", "gandu", "randi", "randwa", "harami", "haramkhor", "kutiya", "jhaatu",
  // English abuse aimed at a person
  "cunt", "cunts", "motherfucker", "motherfuckers", "whore", "whores", "slut", "sluts",
];
// Phrases: a threat, or a push to self-harm, in words that are fine apart.
const PHRASES: readonly string[] = [
  "kill you", "kill u", "kill yourself", "kys", "murder you", "shoot you", "stab you",
  "rape you", "send nudes", "go die", "hang yourself", "jaan se maar", "maar dalunga", "maar dunga", "kaat dunga",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b", "+": "t" };
/** Lower case, l33t undone, accents dropped, anything else a space. */
function normal(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[0134578@$!+]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z\s]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
/** A run of single letters closed up ("k i l l y o u" is one word, "killyou"). */
const joined = (s: string): string => s.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, ""));
/** A letter stretched three or more times, read as one and as two ("chuuutiya", "niggga"); a real double ("pakki") is left. */
const unstretched = (s: string): string[] => [s, s.replace(/([a-z])\1{2,}/g, "$1"), s.replace(/([a-z])\1{2,}/g, "$1$1")];

const WORDS = new Set([...BLOCKED, ...PHRASES.map((p) => p.replace(/ /g, ""))]);

/** Whether the word list catches `text`. */
export function hitsWordList(text: string): boolean {
  const base = normal(text);
  if (!base) return false;
  for (const n of new Set([base, joined(base)].flatMap(unstretched))) {
    const padded = ` ${n} `;
    if (PHRASES.some((p) => padded.includes(` ${p} `))) return true;
    if (n.split(" ").some((w) => WORDS.has(w))) return true;
  }
  return false;
}

/** A moderation service: true when it would not post `text`. */
export type Moderation = (text: string) => Promise<boolean>;
let moderation: Moderation | null = null;
/** The server installs OpenAI's at start (openAiModeration); null takes it away (tests). */
export function setModeration(m: Moderation | null): void { moderation = m; }

/** OpenAI's moderation model, for the categories a family space never wants. Throws when it can't answer (the caller skips it). */
export function openAiModeration(apiKey: string, o: { fetch?: typeof fetch; model?: string } = {}): Moderation {
  const f = o.fetch ?? fetch;
  const NEVER = ["hate", "hate/threatening", "harassment/threatening", "sexual", "sexual/minors", "violence/graphic", "self-harm/instructions", "illicit/violent"];
  return async (text) => {
    const r = await f("https://api.openai.com/v1/moderations", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: o.model ?? "omni-moderation-latest", input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(MODERATION_MS),
    });
    if (!r.ok) throw new Error(`moderation ${r.status}`);
    const j = (await r.json()) as { results?: Array<{ categories?: Record<string, boolean> }> };
    const cats = j.results?.[0]?.categories ?? {};
    return NEVER.some((c) => cats[c] === true);
  };
}

/** Throws BotError("blocked_content") when anything in `parts` should not be posted; else returns. */
export async function screenPost(parts: Array<string | undefined | null>): Promise<void> {
  const texts = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (!texts.length) return;
  if (texts.some(hitsWordList)) throw new BotError("blocked_content", BLOCKED_TEXT, 422);
  if (!moderation) return;
  let flagged = false;
  try {
    flagged = await Promise.race([
      moderation(texts.join("\n").slice(0, 8000)),
      new Promise<boolean>((r) => setTimeout(() => r(false), MODERATION_MS + 200).unref?.()),
    ]);
  } catch { /* unavailable, or the sender has not agreed to AI processing: the word list decided */ }
  if (flagged) throw new BotError("blocked_content", BLOCKED_TEXT, 422);
}

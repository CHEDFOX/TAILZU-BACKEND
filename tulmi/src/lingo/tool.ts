/**
 * THE ONE THING LINGO'S CHAT CAN DO BESIDES TALK: WRITE A WORD DOWN.
 *
 *   lingo_note_words   the words this person reached for, into the course they are on
 *
 * Babbl's own rules already say "their own words, the ones they reached for, come before anything off a list", and
 * the scheduler already puts those words first (`unseen` orders said, asked, heard, then seed). Until this existed
 * nothing could put one there: the chat could READ the course and never add to it, so somebody could ask how to say
 * a word, be told, and have it gone by the end of the conversation. A bot that says it will remember something and
 * cannot is worse than one that never offered.
 *
 * WHICH COURSE: the one they last opened, which is the one the app is showing. Babbl is asked about a language in
 * the middle of learning it; it is not asked to file words against a course nobody is looking at.
 *
 * HOW THEY MET IT matters more than it looks, and is the whole reason `source` exists. A word somebody went looking
 * for is worth more drilling than one that merely went past them, and the scheduler already believes that — so
 * `asked` and `said` are offered before `heard`, and a word Babbl itself used is the weakest of the three.
 *
 * It only ever ADDS. A word already in the course is left exactly as it is, with its whole history: being mentioned
 * again in a conversation must never reset what the scheduler knows about it.
 */
import { keyOf, lingoStore, type LingoStore, type NewItem } from "./store.js";
import type { ItemKind, ItemSource } from "./types.js";

/** At most this many in one call. A conversation produces a handful of words worth keeping, never a glossary. */
export const NOTE_MAX = 8;
const WORD_MAX = 120;
const MEANING_MAX = 200;

/** What the chat can do to a course. A port, so the tool is testable without a database. */
export interface LingoWords {
  /** Add to the course this person last opened. Null when they are not learning anything yet. */
  note(userId: string, items: readonly NewItem[], now: number): Promise<{ added: number; target: string } | null>;
}

export function lingoWords(store?: LingoStore): LingoWords {
  return {
    async note(userId, items, now) {
      const s = store ?? lingoStore();
      const courses = await s.courses(userId).catch(() => []);
      const course = courses[0];
      if (!course) return null;
      const added = await s.add(userId, course.target, items, now).catch(() => 0);
      return { added, target: course.target };
    },
  };
}

export const LINGO_TOOL = {
  name: "lingo_note_words",
  description:
    "Write words or phrases into the person's language course so they come back in their lessons. Use it the moment "
    + "they reach for something: they ask how to say it, they try to say it, or they get one wrong and you correct "
    + "them. Give the word in the language they are learning and its meaning in the language they already speak. "
    + "Note what they reached for, not every word in the conversation — a course full of words nobody asked for is "
    + "worse than a short one. Never say you have written something down unless you have called this.",
  parameters: {
    type: "object", additionalProperties: false, required: ["words"],
    properties: {
      words: {
        type: "array", minItems: 1, maxItems: NOTE_MAX,
        items: {
          type: "object", additionalProperties: false, required: ["word", "meaning"],
          properties: {
            word: { type: "string", maxLength: WORD_MAX, description: "in the language they are learning" },
            meaning: { type: "string", maxLength: MEANING_MAX, description: "in the language they already speak" },
            how: {
              type: "string", enum: ["asked", "said", "heard"],
              description: "asked: they asked how to say it. said: they used it themselves. heard: you used it and they met it. Leave it out if unsure.",
            },
          },
        },
      },
    },
  },
};

const KINDS: Record<string, ItemKind> = { word: "word", phrase: "phrase" };
const HOW: Record<string, ItemSource> = { asked: "asked", said: "said", heard: "heard" };

/** A word is a word until it has a space in it; nothing here asks the model to decide that. */
const kindOf = (text: string): ItemKind => (/\s/.test(text.trim()) ? KINDS.phrase! : KINDS.word!);

export async function runLingoNote(port: LingoWords, userId: string, args: Record<string, unknown>, now: number): Promise<{ content: string; ok: boolean }> {
  const raw = Array.isArray(args["words"]) ? (args["words"] as unknown[]) : [];
  const items: NewItem[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, NOTE_MAX)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const word = keyOf(typeof o["word"] === "string" ? o["word"].slice(0, WORD_MAX) : "");
    const meaning = typeof o["meaning"] === "string" ? o["meaning"].trim().slice(0, MEANING_MAX) : "";
    // Both halves or nothing: a word with no meaning cannot be asked about, and would reach them as a blank question.
    if (!word || !meaning || seen.has(word)) continue;
    seen.add(word);
    items.push({ item: word, gloss: meaning, kind: kindOf(word), source: HOW[String(o["how"] ?? "")] ?? "asked" });
  }
  if (!items.length) return { content: "Nothing to write down: each word needs the word itself and what it means.", ok: false };

  const r = await port.note(userId, items, now);
  if (!r) return { content: "They are not learning a language yet, so there is nowhere to put these. Ask them which language they want to learn.", ok: false };
  // What is already there is left alone, history and all, and the model is told so rather than left to guess.
  const again = items.length - r.added;
  const kept = r.added ? `${r.added} written down for ${r.target}` : `nothing new for ${r.target}`;
  return { content: again ? `${kept}; ${again} already in the course and left as ${again === 1 ? "it was" : "they were"}.` : `${kept}.`, ok: true };
}

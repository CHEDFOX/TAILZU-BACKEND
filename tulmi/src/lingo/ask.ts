/**
 * "HOW DO I SAY…?", ANSWERED ON A CARD, WITHOUT LOSING THEIR PLACE.
 *
 *   askLingo(ctx, o) -> Said | null
 *
 * The ask box sits at the bottom of every Babbl screen, including the middle of a set. That is the point: the
 * moment somebody wants a word is the moment they are using the language, and making them leave the lesson to go
 * and have a conversation about it loses both the word and the lesson.
 *
 * So it is not a conversation. One question, one card — the thing to say, what it means, a line about using it —
 * and a Continue that puts them back exactly where they were. The word goes into their course on the way past, so
 * it comes back in the practice rather than being read once and lost.
 *
 * WHAT THEY TYPED IS DATA, not an instruction, and it reaches the model fenced like any other (prompt.ts neutral).
 */
import { z } from "zod";
import { askJson, type ModelCtx } from "../code/work/model.js";
import { neutral } from "../bots/prompt.js";
import { languageOf } from "./languages.js";
import type { Level } from "./types.js";

export const SaidDraft = z.object({
  say: z.string().min(1).max(200),
  means: z.string().min(1).max(200),
  note: z.string().max(200),
  kind: z.enum(["word", "phrase"]),
});
export type SaidDraft = z.infer<typeof SaidDraft>;

export interface Said { say: string; means: string; note: string; kind: "word" | "phrase" }

export const ASK_MAX = 300;

export interface AskOpts {
  /** The language they are learning, and the one they already speak. */
  target: string;
  from: string;
  /** What they typed. Data, never an instruction. */
  question: string;
  /** Where they are, so the answer is pitched at them rather than at nobody. */
  level: Level;
  /** Why they are learning it, in their own words, when they said (bots.lingo.why). */
  why?: string;
}

/** What the model is told: the pair, where they are, what they came for, and the question, fenced. */
export function askBrief(o: AskOpts): string {
  const name = (tag: string) => languageOf(tag)?.en ?? tag;
  return [
    `They are learning ${name(o.target)} (${o.target}) and already speak ${name(o.from)} (${o.from}).`,
    `They are at ${o.level}.`,
    ...(o.why ? [`What they are learning it for: ${o.why}`] : []),
    "",
    "They asked:",
    neutral(o.question.slice(0, ASK_MAX)),
  ].join("\n");
}

export async function askLingo(ctx: ModelCtx, o: AskOpts): Promise<Said | null> {
  const q = o.question.trim();
  if (!q) return null;
  const asked = await askJson<SaidDraft>(ctx, {
    tier: "cheap",
    role: "lingo_say",
    purpose: "lingo_say",
    user: askBrief({ ...o, question: q }),
    schema: SaidDraft,
    maxTokens: 400,
  });
  if (!asked.ok) return null;
  const v = asked.value;
  const say = v.say.trim();
  const means = v.means.trim();
  // Half an answer is no answer: without both halves it cannot be put on a card and cannot be learned later.
  if (!say || !means) return null;
  return { say, means, note: v.note.trim(), kind: v.kind };
}

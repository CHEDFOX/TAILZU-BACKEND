/**
 * THE WORDS LINGO IS MADE OF: A COURSE, AN ITEM AND WHERE THE SCHEDULER HAS GOT TO WITH IT, AN EXERCISE, AND A MARK.
 * The story is in docs/lingo.md.
 *
 * Plain shapes shared by the scheduler, the grader, the store and the screens. Nothing here reads the environment, a
 * store or a model, so every part of it can be tested on its own.
 */

/** The ladder a learner climbs, as the rest of the world names it. */
export const LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"] as const;
export type Level = (typeof LEVELS)[number];

/** A word on its own, or a phrase meant to be said whole. */
export type ItemKind = "word" | "phrase";

/**
 * How the person met this item. It matters: a word they reached for themselves is worth more drilling than one off a
 * frequency list, and the session's mix leans that way.
 */
export type ItemSource = "seed" | "said" | "asked" | "heard";

/** Where the scheduler has got to with one item (src/lingo/schedule.ts). */
export type MemoryState = "new" | "learning" | "review" | "relearning";

export interface Memory {
  /** How long it would hold, in days, before they'd be as likely as not to have lost it. */
  stability: number;
  /** How hard this item is for this person, 1 to 10. */
  difficulty: number;
  reps: number;
  lapses: number;
  /** Which learning step it is on. Kept because a scheduler that forgets it walks the learner round the same step for ever. */
  steps: number;
  state: MemoryState;
  /** When it should next be asked. */
  dueMs: number;
  /** When it was last answered; null while it has never been asked. */
  lastMs: number | null;
}

export interface LingoItem {
  /** The word or phrase itself, in the language being learned. The key: the same thing is never learned twice. */
  item: string;
  kind: ItemKind;
  /** What it means, in the language they are taught in. */
  gloss: string;
  source: ItemSource;
  /**
   * Times they got it right OUT LOUD. The whole point is talking, so a word that has only ever been read or tapped is
   * not counted as learned however well the scheduler thinks it is held.
   */
  spoken: number;
  memory: Memory;
}

/** One person, one language they are learning. Somebody may be learning several at once. */
export interface Learner {
  /** The language being learned, BCP-47. */
  target: string;
  /** The language it is taught in, BCP-47. */
  from: string;
  level: Level;
  /** Minutes a day they asked for. */
  goalMin: number;
  /** Whether the bot may ring them to talk. The phone's own call consent still applies on top of this. */
  calls: boolean;
  /** The voice that speaks the target language; null until one is picked. */
  voice: string | null;
  streakDays: number;
  /** The last day they finished a session, "YYYY-MM-DD" in their own timezone. */
  lastDay: string | null;
  usedMs: number;
  updatedMs: number;
}

/**
 * WHAT WE ASK SOMEBODY TO DO. Six kinds, and the order is the point: `choose` is the easiest thing a screen can ask and
 * `talk` is the only one that is the real thing. Duolingo's mistake is that it stops at the tapping ones; here they
 * exist to get an item ready to be said.
 *
 *   choose  pick the meaning out of a few
 *   blank   the word taken out of a real sentence, and put back
 *   write   type it, graded against every answer we accept
 *   listen  it is spoken, they type what they heard
 *   chips   put the given words in order
 *   say     say it out loud; speech-to-text marks it
 *   talk    a turn of real conversation, with the item expected somewhere in it
 */
export const EXERCISE_KINDS = ["choose", "blank", "write", "listen", "chips", "say", "talk"] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

/** The kinds that need the person to speak. An item is not learned until it has been passed out loud. */
export const SPOKEN_KINDS: readonly ExerciseKind[] = ["say", "talk"];

/** How much of a session each kind may be, by the level: beginners read and tap, then it turns into talking. */
export interface Mix {
  choose: number;
  write: number;
  listen: number;
  chips: number;
  say: number;
  talk: number;
}

/**
 * HOW AN ANSWER CAME OUT. `close` is the band that decides whether this feels fair: a missing accent or one slipped
 * letter is not the same as not knowing the word, and marking it wrong is how a learning app loses somebody.
 */
export type Verdict = "right" | "close" | "wrong";

/**
 * WHY IT WAS NOT SIMPLY RIGHT, as a reason the screens word themselves. A code, not a sentence: Lingo is taught in
 * whatever language the person reads, so no English may leak out of the grader.
 *
 *   accent    the letters were right, the marks over them were not
 *   spelling  one slipped letter
 *   order     the right words in the wrong order
 *   word      a different word
 *   silence   nothing was said, or nothing could be heard
 */
export type MarkReason = "" | "accent" | "spelling" | "order" | "word" | "silence";

export interface Mark {
  verdict: Verdict;
  /** The accepted answer it matched, when it matched one. */
  matched: string | null;
  why: MarkReason;
}

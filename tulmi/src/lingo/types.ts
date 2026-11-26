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

/**
 * THE THREE WAYS A THING CAN BE KNOWN, and they are not the same knowledge.
 *
 * Picking it out of three is not writing it, and writing it is not saying it with somebody waiting. Everything
 * until now kept ONE number for an item, so a word somebody could recognise and a word they could say were the
 * same word to the scheduler. These are what the exercise kinds mean when you stop looking at the screen and ask
 * what the person actually did.
 */
export const MODES = ["pick", "write", "say"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_OF: Readonly<Record<ExerciseKind, Mode>> = {
  choose: "pick", reply: "pick", blank: "pick",
  write: "write", chips: "write", listen: "write",
  say: "say", speak: "say", talk: "say",
};

/** Asked, and right, in one mode. Two numbers, because a rate without its count is a number that lies. */
export type Count = { asked: number; right: number };

/**
 * WHAT IS KNOWN ABOUT ONE ITEM, kept on the item itself: how it goes in each of the three ways it can be known,
 * and how it goes wrong when it does. The grader already says WHY something was wrong (a dropped accent is not the
 * same as the wrong word); until now nothing kept that, so the same mistake five times looked like five mistakes.
 */
export interface ItemMarks {
  pick?: Count;
  write?: Count;
  say?: Count;
  /** How it goes wrong, by the grader's own reason, counted. */
  why?: Partial<Record<Exclude<MarkReason, "">, number>>;
}

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
  /**
   * HOW LONG THEY THINK ABOUT THIS ONE, in ms, as a running middle (portrait.ts blendMs); 0 until it is timed.
   * Taken from the gap between one answer and the next, so no clock in the app and no message can say otherwise.
   * It is the difference between a word somebody HAS and one they can work out, which nothing else here can see:
   * both are marked right.
   */
  thinkMs?: number;
}

export interface LingoItem {
  /** The word or phrase itself, in the language being learned. The key: the same thing is never learned twice. */
  item: string;
  kind: ItemKind;
  /** What it means, in the language they are taught in. */
  gloss: string;
  source: ItemSource;
  /** Which unit of the path it came from (course.ts), when it came from one. A word they reached for has none. */
  unit?: string;
  /**
   * Times they got it right OUT LOUD. The whole point is talking, so a word that has only ever been read or tapped is
   * not counted as learned however well the scheduler thinks it is held.
   */
  spoken: number;
  memory: Memory;
  /** How it goes in each of the three ways it can be known, and how it goes wrong (ItemMarks). */
  marks?: ItemMarks;
}

/** One person, one language they are learning. Somebody may be learning several at once. */
/**
 * WHY SOMEBODY IS LEARNING A LANGUAGE, as the one question Babbl asks before it teaches anything (bots.lingo.why).
 * Seven codes that between them hold most of the reasons anybody learns one, and not one of them is a country, a
 * region or a kind of person: the same seven whichever language was picked, and "" for somebody who skipped.
 * "family" is here because people learning the language of their own grandparents are a large share of all learners
 * and are written out of most courses.
 */
export const WHY_CODES = ["someone", "trip", "living", "work", "family", "study", "curious"] as const;
export type Why = (typeof WHY_CODES)[number] | "";
export const isWhy = (v: unknown): v is Why => v === "" || (WHY_CODES as readonly string[]).includes(String(v));

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
  /** Where they are on the path (course.ts UNITS). Empty until they start; the first unit is assumed. */
  unit?: string;
  /** When they last answered anything on this course: what the next answer's thinking time is measured from. */
  lastAnswerMs?: number;
  /** Per kind of exercise: asked, right, and the middle time. What the portrait's rates are built from. */
  tally?: { [kind: string]: { asked: number; right: number; ms: number } };
  /**
   * THE SET THEY ARE IN THE MIDDLE OF: every answer since the last one was closed off, in order.
   *
   * Kept by the server because the alternative is the app handing its own list back at the end, and that would be
   * the one message in Babbl that says "I was right". Written as each answer is marked, read and emptied when the
   * set ends (migration 0109).
   */
  setAnswers?: Array<{ item: string; kind: ExerciseKind; verdict: Verdict; learnedNow?: boolean }>;
  /** What the language is for, one of WHY_CODES; "" when they skipped the question or the course predates it. */
  why?: Why;
  /** The same thing in their own words, which is worth more than the code: who they will speak it with, and when. */
  whyNote?: string;
}

/**
 * WHAT WE ASK SOMEBODY TO DO. Six kinds, and the order is the point: `choose` is the easiest thing a screen can ask and
 * `talk` is the only one that is the real thing. Duolingo's mistake is that it stops at the tapping ones; here they
 * exist to get an item ready to be said.
 *
 * It is a GRID, not a line. Three levels — a word, a whole utterance, a turn of conversation — and at every level
 * both ways of being asked: PICK THE RIGHT ONE, and SAY THE RIGHT THING. Recognising is not the lesson and never
 * was, but it is how the saying gets within reach, so the two run side by side all the way up instead of one
 * replacing the other.
 *
 *                   pick the right one          say the right thing
 *   word            choose                      say
 *   utterance       reply  (blank, chips)       speak
 *   conversation    —                           talk
 *
 *   choose  pick the meaning out of a few
 *   blank   the word taken out of a real sentence, and put back
 *   reply   what you would actually say here, out of a few
 *   write   type it, graded against every answer we accept
 *   listen  it is spoken, they type what they heard
 *   chips   put the given words in order
 *   say     say the word out loud; speech-to-text marks it
 *   speak   say a whole utterance out loud, made from its meaning and not read off the screen
 *   talk    a turn of real conversation, with the item expected somewhere in it
 */
export const EXERCISE_KINDS = ["choose", "blank", "reply", "write", "listen", "chips", "say", "speak", "talk"] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

/** The kinds that need the person to speak. An item is not learned until it has been passed out loud. */
export const SPOKEN_KINDS: readonly ExerciseKind[] = ["say", "speak", "talk"];

/**
 * HOW AN ANSWER CAME OUT. `close` is the band that decides whether this feels fair: a missing accent or one slipped
 * letter is not the same as not knowing the word, and marking it wrong is how a learning app loses somebody.
 */
export type Verdict = "right" | "close" | "wrong";

/**
 * WHY IT WAS NOT SIMPLY RIGHT, as a reason the screens word themselves. A code, not a sentence: Babbl is taught in
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

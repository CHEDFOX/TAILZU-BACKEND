/**
 * A SET, WHAT IT SAYS ABOUT THE PERSON, AND WHAT THE NEXT ONE SHOULD BE.
 *
 * Learning here is CONTINUOUS, not a session that ends: a set of a dozen exercises, then what the bot makes of it,
 * then Continue. Each set is built from the one before it, so the difficulty follows the person instead of a tree.
 *
 * Three things come out of a finished set, and all three are decided here, on the server:
 *
 *   1. WHAT HAPPENED — what was learned, what slipped, what was said out loud (`readSet`).
 *   2. WHAT THE BOT DOES ABOUT IT — the gesture, SCALED (`gestureFor`). A set that went badly gets no celebration.
 *      Confetti for everything is the single most common mistake in this kind of app: it makes the celebration
 *      worthless, and it tells somebody who just failed six things in a row that they did well, which they can see
 *      is untrue. The bot is warm about a bad set and it does not lie about it.
 *   3. WHAT COMES NEXT — the shape of the next set (`shapeNext`). Flying gets more new words and more speaking;
 *      struggling gets NO new words and drops back a rung, because piling new material onto somebody who is
 *      already losing it is how people quit.
 *
 * Pure: marks and items in, a judgement out. No clock of its own, no store, no model.
 */
import { learned, recall } from "./schedule.js";
import type { ExerciseKind, LingoItem, Verdict } from "./types.js";

/** How long one set is. Short enough to finish in a queue, long enough to tell you something. */
export const SET_SIZE = 12;

/** One answered exercise, as the set reads it. */
export interface Answered {
  item: string;
  kind: ExerciseKind;
  verdict: Verdict;
  /** Whether this answer was the one that finished the word (said out loud enough times). */
  learnedNow?: boolean;
}

export interface SetResult {
  asked: number;
  right: number;
  close: number;
  wrong: number;
  /** Answers given out loud and right: the only ones that move a word towards learned. */
  spoken: number;
  /** The words that crossed into learned during this set. */
  learned: string[];
  /** The words that went wrong, worst first — what the next set leans on. */
  slipped: string[];
}

export function readSet(answers: readonly Answered[]): SetResult {
  const r: SetResult = { asked: answers.length, right: 0, close: 0, wrong: 0, spoken: 0, learned: [], slipped: [] };
  for (const a of answers) {
    if (a.verdict === "right") r.right++;
    else if (a.verdict === "close") r.close++;
    else r.wrong++;
    if (a.verdict === "right" && (a.kind === "say" || a.kind === "talk")) r.spoken++;
    if (a.learnedNow && !r.learned.includes(a.item)) r.learned.push(a.item);
    if (a.verdict === "wrong" && !r.slipped.includes(a.item)) r.slipped.push(a.item);
  }
  return r;
}

/**
 * HOW A SET WENT, in four bands. The bands are what the gesture and the next set are chosen from, so they are
 * deliberately coarse: a person can feel the difference between four, and no honest reading of twelve answers
 * supports more than that.
 */
export type Performance = "flying" | "solid" | "shaky" | "struggling";

export function performanceOf(r: SetResult): Performance {
  if (!r.asked) return "solid";
  const right = r.right / r.asked;
  const wrong = r.wrong / r.asked;
  // Nearly everything right, and some of it out loud. Saying things is what "flying" has to mean here.
  if (right >= 0.9 && r.spoken >= 2) return "flying";
  if (wrong >= 0.4) return "struggling";
  if (right >= 0.7 && wrong <= 0.15) return "solid";
  return "shaky";
}

/**
 * WHAT THE BOT DOES WHEN A SET ENDS. `cheer` is the engine's own one-shot (botTiles `cheer()`); `moment` is a
 * moment from the catalog; `scale` is how big it should be, for the screens to size confetti and the like.
 *
 * Note what `struggling` gets: no cheer, no confetti, and a settling, patient act. Somebody who has just got half
 * of a set wrong does not need a party — they need the bot to be unbothered, so that they are too.
 */
export interface Gesture {
  /** The buddy act to hold. */
  act: "settle" | "play" | "wave" | "think";
  /** Whether to play the engine's one-shot celebration. */
  cheer: boolean;
  /** A catalog moment to play over it, when there is one worth playing. */
  moment: string | null;
  /** 0 to 1, for the screens: how much celebration this set earned. */
  scale: number;
}

export function gestureFor(p: Performance): Gesture {
  if (p === "flying") return { act: "play", cheer: true, moment: "celebrate", scale: 1 };
  if (p === "solid") return { act: "play", cheer: true, moment: null, scale: 0.5 };
  if (p === "shaky") return { act: "settle", cheer: false, moment: null, scale: 0.15 };
  // struggling: warm, unbothered, and no celebration of any kind.
  return { act: "settle", cheer: false, moment: null, scale: 0 };
}

/**
 * THE SHAPE OF THE NEXT SET. This is where the difficulty follows the person.
 *
 * `rungCap` is the strongest thing the next set may ask of an item, so a struggling person is not asked to produce
 * words they have just failed to recognise. `newRoom` is how many never-seen words may come in — zero when they are
 * struggling, because new material is the last thing somebody losing their grip needs.
 */
export interface SetShape {
  size: number;
  /** The most never-seen items this set may hold. */
  newRoom: number;
  /** Do not ask anything stronger than this of an item; null for no cap. */
  rungCap: ExerciseKind | null;
  /** Prefer the spoken kinds where an item can bear them. */
  pushSpoken: boolean;
  /** The words that went wrong last set, which this one leans on first. */
  revisit: readonly string[];
}

export function shapeNext(p: Performance, last: SetResult, o: { size?: number } = {}): SetShape {
  const size = o.size ?? SET_SIZE;
  if (p === "flying") {
    // Room to grow: more new words than usual, and push for the spoken kinds.
    return { size, newRoom: Math.round(size * 0.4), rungCap: null, pushSpoken: true, revisit: last.slipped };
  }
  if (p === "solid") {
    return { size, newRoom: Math.round(size * 0.25), rungCap: null, pushSpoken: false, revisit: last.slipped };
  }
  if (p === "shaky") {
    // Fewer new words, and nothing harder than putting a word back into a sentence.
    return { size, newRoom: Math.round(size * 0.1), rungCap: "blank", pushSpoken: false, revisit: last.slipped };
  }
  // struggling: no new words at all, a shorter set, and only recognising and hearing.
  return { size: Math.max(6, Math.round(size * 0.7)), newRoom: 0, rungCap: "listen", pushSpoken: false, revisit: last.slipped };
}

/** The rungs of the ladder, weakest first, so a cap can be compared against a kind. */
const RUNGS: readonly ExerciseKind[] = ["choose", "listen", "blank", "chips", "write", "say", "talk"];

/** The kind to ask, held under a cap. A cap never makes an exercise HARDER, only gentler. */
export function underCap(kind: ExerciseKind, cap: ExerciseKind | null): ExerciseKind {
  if (!cap) return kind;
  const at = RUNGS.indexOf(kind);
  const top = RUNGS.indexOf(cap);
  if (at < 0 || top < 0) return kind;
  return at <= top ? kind : cap;
}

/**
 * HOW FAR SOMEBODY HAS GOT WITH A LANGUAGE, as one number and its parts.
 *
 * Not a percentage of a course, because there is no course to be a percentage of. It is what they can actually do:
 * how much of what they have met they would still have right now, how much of it they have ever SAID, and how much
 * has crossed into learned. Speaking is weighted most, because it is the thing being taught.
 */
export interface Mastery {
  /** 0 to 1. */
  value: number;
  /** How many words have crossed into learned (said out loud, and held). */
  learned: number;
  /** How many have ever been said right out loud at all. */
  spoken: number;
  /** The average of what they would still have right now, over everything they have met. */
  held: number;
  met: number;
}

export function mastery(items: readonly LingoItem[], now: number): Mastery {
  const met = items.filter((i) => i.memory.state !== "new");
  const spoken = items.filter((i) => i.spoken > 0).length;
  const done = items.filter(learned).length;
  const held = met.length ? met.reduce((t, i) => t + recall(i.memory, now), 0) / met.length : 0;
  // Held is what they have today; spoken and learned are what they have for good. Speaking counts double.
  const share = items.length ? (done + spoken) / (items.length * 2) : 0;
  return { value: Math.max(0, Math.min(1, held * 0.4 + share * 0.6)), learned: done, spoken, held, met: met.length };
}

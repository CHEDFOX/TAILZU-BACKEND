/**
 * THE ORDER A SESSION IS PUT IN, AND WHEN A MISSED WORD COMES BACK.
 *
 * Which words to ask is the scheduler's business (schedule.ts). THE ORDER THEY ARE ASKED IN is a different question
 * with its own answer, and getting it wrong costs real learning even when every other part is right. Five findings
 * decide it, and each one is written next to the code that serves it:
 *
 *   INTERLEAVING. Practising one kind of thing in a block is easier in the moment and worse afterwards than mixing
 *   kinds up. The naive order — every word that is due, then every new word — is blocked practice twice over: all the
 *   revision together, then all the recognition together. So no two exercises of the same kind sit next to each other
 *   while anything else can be put between them.
 *
 *   DESIRABLE DIFFICULTY. An answer that comes easily is remembered less well than one that was work. So the middle
 *   of a session runs hardest first, and an item climbs out of recognition as soon as it can bear it (session.ts
 *   shapeFor).
 *
 *   PRIMACY AND RECENCY. What comes first and last in a sitting is remembered best; the middle sags. So the hardest
 *   work goes early, where attention is, rather than being spread evenly.
 *
 *   THE PEAK-END RULE. How a sitting is remembered is decided mostly by its best moment and its LAST one. A session
 *   that ends on the thing somebody just failed is remembered as a bad session, whatever happened before it. So the
 *   last exercise is deliberately one they are likely to get right, and the first is too, because a person who fails
 *   the opening question of a lesson often does not finish it.
 *
 *   THE LAG EFFECT. A word just missed and asked again immediately is copied, not recalled. Asked again a few
 *   exercises later, in the same sitting, it is retrieved — which is the thing that makes it stick. So a miss comes
 *   back, but never next.
 *
 * Pure: exercises and their odds in, an order out. No clock, no store, no model.
 */
import type { Exercise } from "./session.js";
import type { ExerciseKind, Verdict } from "./types.js";

/** One exercise and how likely this person is to get it right, 0 (gone) to 1 (certain). */
export interface Entry {
  ex: Exercise;
  /** From the scheduler's own estimate of what they still hold (schedule.ts recall). */
  ease: number;
}

/**
 * The kinds that need a voice. Two of them back to back is a lot to ask: the microphone has to open and close, the
 * room has to be quiet twice, and a person who is somewhere they cannot speak is stopped dead. They are kept apart.
 */
const LOUD: readonly ExerciseKind[] = ["say", "talk"];
const isLoud = (k: ExerciseKind): boolean => LOUD.includes(k);

/** How many other exercises come between a missed word and its second chance. */
export const LAG = 4;

/** A session shorter than this is too small to arrange: there is nowhere to put anything. */
const ARRANGEABLE = 4;

/** How much each rule is worth when choosing what comes next. Hardest-first is the baseline; the rest bend it. */
const W = {
  hard: 10,      // prefer the least well held
  sameKind: -7,  // two of a kind in a row: avoid unless there is nothing else
  bothLoud: -9,  // two spoken answers in a row: avoid harder still
  endQuiet: 4,   // the first and last exercise should not need a voice
};

/** The entry that scores highest, removed from the pool. */
function take(pool: Entry[], score: (e: Entry) => number): Entry {
  let best = 0;
  let top = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    const s = score(pool[i]!);
    if (s > top) { top = s; best = i; }
  }
  return pool.splice(best, 1)[0]!;
}

/**
 * THE ORDER. Easy to open, hardest early, kinds mixed all the way through, and an easy one saved for last.
 *
 * The shape is deliberate and not a curve for its own sake: a win to start so the session gets started at all, the
 * hard work while attention is highest, and a win to finish because that is the part they will remember tomorrow
 * when deciding whether to come back.
 */
export function order(entries: readonly Entry[]): Exercise[] {
  if (entries.length < ARRANGEABLE) return entries.map((e) => e.ex);
  const pool = [...entries];

  // The closer first, because the end of a sitting is the part that is remembered: the one they are most likely to
  // get right, and preferably not a spoken one.
  const easy = (e: Entry): number => e.ease * 10 + (isLoud(e.ex.kind) ? -W.endQuiet : 0);
  const last = take(pool, easy);

  // Then the opener — but NOT insisting on a quiet one when quiet ones are scarce. Holding two of them back for the
  // ends can leave the middle with nothing to put between the spoken answers, and keeping those apart matters more
  // than opening on a quiet one. So when quiet exercises do not outnumber the spoken ones, the opener is chosen on
  // the odds alone and the rest are left to separate each other.
  const loudLeft = pool.filter((e) => isLoud(e.ex.kind)).length;
  const quietLeft = pool.length - loudLeft;
  const first = take(pool, quietLeft > loudLeft ? easy : (e) => e.ease * 10);

  const middle: Exercise[] = [];
  let prev: ExerciseKind = first.ex.kind;
  while (pool.length) {
    const next = take(pool, (e) => {
      let s = (1 - e.ease) * W.hard;
      if (e.ex.kind === prev) s += W.sameKind;
      if (isLoud(e.ex.kind) && isLoud(prev)) s += W.bothLoud;
      return s;
    });
    middle.push(next.ex);
    prev = next.ex.kind;
  }
  return [first.ex, ...middle, last.ex];
}

/**
 * HOW MANY EXERCISES LATER A WORD COMES BACK, this same sitting. Zero means it does not.
 *
 * A word they got wrong comes back, because the whole value of being told the answer is the chance to produce it
 * yourself afterwards — but not NEXT, which is copying rather than remembering.
 *
 * A near miss comes back further out. They knew it: an accent or a slipped letter is worth correcting, not drilling,
 * and the scheduler has already pulled it closer anyway.
 *
 * A right answer does not come back at all. Asking again in the same sitting teaches nothing and reads as mistrust.
 */
export function againAfter(verdict: Verdict): number {
  if (verdict === "wrong") return LAG;
  if (verdict === "close") return LAG * 2;
  return 0;
}

/**
 * A missed exercise put back into what is left of the session, `after` exercises along. Pure: the list in, a new
 * list out, so a route can hand the app the whole remaining order again and never has to be trusted to do the sum.
 */
export function requeue(rest: readonly Exercise[], ex: Exercise, after: number): Exercise[] {
  if (after <= 0) return [...rest];
  const out = [...rest];
  // Past the end of what is left, it goes last: better late in this sitting than not at all.
  out.splice(Math.min(after, out.length), 0, ex);
  return out;
}

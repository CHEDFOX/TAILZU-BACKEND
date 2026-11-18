/**
 * WHAT IS KNOWN ABOUT SOMEBODY ON ONE LANGUAGE, AS NUMBERS THAT MEAN SOMETHING.
 *
 *   portraitOf(items, learner, now) -> Portrait
 *
 * Everywhere else in Lingo decides one thing at a time: this word is due, that set went badly. This is the whole
 * picture of one person on one language — where they are, what comes easily, where it is hard, and how hard they
 * are having to think. It is what the path is moved along by and what the chat is told, so it has to be honest
 * about how much it knows, not only about what it has seen.
 *
 * THREE RULES, because a learner model that flatters itself is worse than none.
 *
 * 1. NOTHING IS A RATE UNTIL IT HAS SEEN ENOUGH. Three answers do not say somebody is bad at speaking. Every rate
 *    here is pulled towards what is known more widely until its own evidence outweighs it:
 *
 *        p = (right + k·prior) / (asked + k)
 *
 *    with k = CONFIDENCE answers. At k answers of its own, a rate sits halfway between the prior and what was
 *    actually seen; by 4k it is essentially its own. The prior for one kind of exercise is how the person does
 *    across all of them; the prior for a person with no history at all is EVEN, which says exactly nothing. This
 *    is the ordinary shrinkage estimator, and it is here because the alternative — a 0% that is really "asked
 *    twice" — makes the model confidently wrong exactly when a learner is new.
 *
 * 2. TIME IS READ IN THE MIDDLE, NOT THE AVERAGE. Answer times are long-tailed: somebody puts the phone down, the
 *    bus arrives, they come back four minutes later. One of those drags a mean anywhere, so everything here is a
 *    MEDIAN, and a gap longer than AWAY_MS is not thinking at all and is thrown away rather than capped.
 *
 * 3. EFFORT IS RELATIVE TO THE PERSON. Six seconds is fast for somebody who takes twelve and slow for somebody who
 *    takes two, and neither of them is the average learner. Difficulty is always a ratio against that person's own
 *    middle for that kind of question, never against a number from outside.
 *
 * Pure: items, their course and a clock in, numbers out. No store, no model, no language.
 */
import { recall, learned as isLearned } from "./schedule.js";
import { indexOf, placeOf, UNITS } from "./course.js";
import { LEVELS, type ExerciseKind, type Learner, type Level, type LingoItem } from "./types.js";

/**
 * How many answers of its own a rate needs before it is believed over the wider prior. Eight is about one set: a
 * single bad sitting should not rewrite what somebody is good at, and two should start to.
 */
export const CONFIDENCE = 8;

/** Longer than this between two answers and they were not thinking, they were elsewhere. Thrown away, not capped. */
export const AWAY_MS = 120_000;

/** Below this, an answer was not read: a double tap, a stuck finger, a screen that advanced under them. */
export const TOO_FAST_MS = 350;

/** Nothing is known, and the estimator says so rather than guessing low. */
const EVEN = 0.5;

export interface Rate {
  /** The shrunk estimate, 0 to 1. What to act on. */
  p: number;
  /** How many answers it is actually built on. */
  n: number;
  /** How much of `p` is its own evidence rather than the prior, 0 to 1. Below about 0.5, do not lean on it. */
  sure: number;
}

export interface KindView extends Rate {
  kind: ExerciseKind;
  /** The middle time they take on this kind, in ms; 0 when it has never been timed. */
  ms: number;
}

export interface ItemView {
  item: string;
  gloss: string;
  /** How likely they are to have it right now, 0 to 1. */
  held: number;
  /** Their own thinking time on it against their middle for that kind: 1 is normal, 2 is twice as long. */
  effort: number;
  lapses: number;
  spoken: number;
}

export interface Portrait {
  target: string;
  from: string;
  /** What they said at the start; kept because it is what they think, which matters for how to talk to them. */
  said: Level;
  /** What the words say, which is the one to act on. */
  earned: Level;
  unit: { key: string; goal: string; at: number; of: number };
  counts: { items: number; met: number; learned: number; spoken: number; due: number; unseen: number };
  /** The average chance they would have an item they have met, right now. The honest "how much of this do you have". */
  hold: number;
  /** How they do at each kind of question, hardest first. The shape of a person: tapping is not speaking. */
  kinds: KindView[];
  /** The middle time they take to answer anything, in ms. 0 when nothing has been timed yet. */
  thinkMs: number;
  /** What comes easily and what does not. Both are capped lists; both are evidence, not a verdict. */
  easy: ItemView[];
  hard: ItemView[];
  /** How many items have crossed into learned, per week, over the time they have been at it. */
  pace: number;
  /** How long they have been learning this, in days. */
  days: number;
}

/** The shrunk rate. See rule 1. */
export function rate(right: number, asked: number, prior = EVEN, k = CONFIDENCE): Rate {
  const n = Math.max(0, asked);
  const p = (Math.max(0, right) + k * prior) / (n + k);
  return { p, n, sure: n / (n + k) };
}

/** The middle of a list, or 0 for nothing. Used everywhere a time is read. See rule 2. */
export function median(xs: readonly number[]): number {
  const ok = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!ok.length) return 0;
  const mid = ok.length >> 1;
  return ok.length % 2 ? ok[mid]! : Math.round((ok[mid - 1]! + ok[mid]!) / 2);
}

/**
 * The time between one answer and the next IS the time they spent on the next one — no clock in the app, no
 * message that can lie about it. Anything outside the window is not thinking and is dropped.
 */
export function thinkingTime(prevMs: number | null | undefined, nowMs: number): number | null {
  if (!prevMs || !Number.isFinite(prevMs)) return null;
  const gap = nowMs - prevMs;
  if (gap < TOO_FAST_MS || gap > AWAY_MS) return null;
  return gap;
}

/**
 * One item's time, kept as a running middle rather than a list: the old value and the new one, weighted. It moves
 * towards what is happening now without a single slow answer owning it.
 */
export const blendMs = (was: number, now: number): number => (was > 0 ? Math.round(was * 0.7 + now * 0.3) : now);

/**
 * HOW MUCH SLOWER THAN THEIR OWN NORMAL counts as having worked for it. Twice: a word that takes somebody twice as
 * long as they usually take on that kind of question was reconstructed, not remembered.
 */
export const SLOW_AT = 2;

/**
 * WAS THAT RECALLED, OR WORKED OUT? The one thing marking cannot tell, and the only one the scheduler needs that
 * it has never had: both come back "right".
 *
 * `normal` is this person's own middle for this kind of question, never a number from outside, so it does not
 * reward fast tappers or punish careful ones (rule 3). With no history to compare against, nothing is claimed.
 */
export const workedForIt = (thoughtMs: number | null, normalMs: number): boolean =>
  !!thoughtMs && normalMs > 0 && thoughtMs >= normalMs * SLOW_AT;

/**
 * WHAT THE WORDS SAY THEIR LEVEL IS, which is not what they said at the start.
 *
 * Counted on what they can PRODUCE, not what they have seen: an item counts when it is held and has been said out
 * loud, because a word you have only ever recognised is not a word you have. The bands are the usual vocabulary
 * sizes quoted for CEFR, and they are an estimate and nothing more — a real level is about what somebody can do in
 * a conversation, which no count knows.
 *
 * IT RISES ONE BAND AT A TIME, whatever the count says, and never falls below what they said at the start. Telling
 * somebody they are B2 on the strength of a word count is the kind of flattery that makes the number worthless,
 * and the cap costs nothing: the level it works out is written back to the course, so somebody who really is
 * further along climbs the next band the next time they sit down, and the one after that the time after.
 */
const BANDS: ReadonlyArray<{ level: Level; at: number }> = [
  { level: "c2", at: 8000 }, { level: "c1", at: 4000 }, { level: "b2", at: 2000 },
  { level: "b1", at: 1000 }, { level: "a2", at: 300 }, { level: "a1", at: 0 },
];

export function earnedLevel(items: readonly LingoItem[], now: number, said: Level): Level {
  const have = items.filter((i) => isLearned(i) || (i.spoken > 0 && recall(i.memory, now) >= 0.9)).length;
  const band = BANDS.find((b) => have >= b.at)?.level ?? "a1";
  const i = LEVELS.indexOf(band);
  const j = LEVELS.indexOf(said);
  // Never below what they said, never more than one band above it.
  return LEVELS[Math.max(j, Math.min(i, j + 1))] ?? band;
}

/** Per kind: how many were asked, how many right, and the middle time. Kept on the course, counted as they answer. */
export interface Tally { [kind: string]: { asked: number; right: number; ms: number } }

export function portraitOf(items: readonly LingoItem[], learner: Learner, now: number): Portrait {
  const tally: Tally = learner.tally ?? {};
  const met = items.filter((i) => i.memory.state !== "new");
  const holds = met.map((i) => recall(i.memory, now));
  const hold = holds.length ? holds.reduce((t, x) => t + x, 0) / holds.length : 0;

  // The prior every kind is pulled towards: how this person does across everything. With no history at all it is
  // EVEN, which is the estimator saying it does not know rather than guessing.
  const allAsked = Object.values(tally).reduce((t, v) => t + (v?.asked ?? 0), 0);
  const allRight = Object.values(tally).reduce((t, v) => t + (v?.right ?? 0), 0);
  const prior = allAsked ? allRight / allAsked : EVEN;

  const kinds: KindView[] = Object.entries(tally)
    .filter(([, v]) => v && v.asked > 0)
    .map(([kind, v]) => ({ kind: kind as ExerciseKind, ...rate(v.right, v.asked, prior), ms: v.ms }))
    // Hardest first: this list is read to find what to work on, not to congratulate anybody.
    .sort((a, b) => a.p - b.p);

  const thinkMs = median(items.map((i) => i.memory.thinkMs ?? 0));
  // An item's effort is against the middle for the kind it is usually asked as, falling back to the person's own
  // overall middle. Against an outside number it would only ever measure how fast somebody taps.
  const norm = thinkMs || 0;
  const view = (i: LingoItem): ItemView => ({
    item: i.item, gloss: i.gloss, held: recall(i.memory, now),
    effort: norm && i.memory.thinkMs ? Number((i.memory.thinkMs / norm).toFixed(2)) : 1,
    lapses: i.memory.lapses, spoken: i.spoken,
  });
  const seen = met.map(view);
  const hard = [...seen]
    // Hard means: it keeps going, or it takes them much longer than their own normal, or it will not stay put.
    .sort((a, b) => (b.lapses - a.lapses) || (b.effort - a.effort) || (a.held - b.held))
    .filter((v) => v.lapses > 0 || v.effort > 1.3 || v.held < 0.6)
    .slice(0, 10);
  const easy = [...seen]
    .filter((v) => v.lapses === 0 && v.held >= 0.9 && v.effort <= 1)
    .sort((a, b) => (a.effort - b.effort) || (b.held - a.held))
    .slice(0, 10);

  const firstMs = Math.min(...items.map((i) => i.memory.lastMs ?? now), now);
  const days = Math.max(1, Math.round((now - firstMs) / 86_400_000));
  const done = items.filter(isLearned).length;

  const unitKey = learner.unit || UNITS[0]!.key;
  const u = UNITS[Math.max(0, indexOf(unitKey))] ?? UNITS[0]!;
  const place = placeOf(unitKey);

  return {
    target: learner.target, from: learner.from,
    said: learner.level,
    earned: earnedLevel(items, now, learner.level),
    unit: { key: u.key, goal: u.goal, at: place.at, of: place.of },
    counts: {
      items: items.length, met: met.length, learned: done,
      spoken: items.filter((i) => i.spoken > 0).length,
      due: items.filter((i) => i.memory.state !== "new" && i.memory.dueMs <= now).length,
      unseen: items.filter((i) => i.memory.state === "new").length,
    },
    hold, kinds, thinkMs, easy, hard,
    pace: Number(((done / days) * 7).toFixed(2)),
    days,
  };
}

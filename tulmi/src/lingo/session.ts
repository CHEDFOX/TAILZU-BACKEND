/**
 * A DAY'S SESSION: WHAT TO ASK, IN WHAT SHAPE, AND WHAT AN ANSWER DID TO IT.
 *
 *   plan(items, learner, now)        -> Exercise[]   what to ask this time, already in order
 *   answered(item, kind, mark, now)  -> LingoItem    the item after an answer, ready to be written back
 *
 * Pure, like the scheduler and the grader: items and a clock in, exercises out. No store, no model, no language.
 *
 * TWO RULES SHAPE A SESSION.
 *
 * What is nearly forgotten comes first, because that is the whole point of scheduling at all. A few unseen items are
 * mixed in behind them so a session is never only revision, and the ones the person went looking for themselves come
 * before anything off a list.
 *
 * And an item climbs: the first time it is met it is only recognised, then written, then SAID. Which shape an item
 * gets is decided by how well it is held and whether it has ever been out loud (`shapeFor`), never at random. A
 * tapping exercise is not the lesson; it is how a word gets ready to be spoken.
 */
import { due, learned, recall, SPOKEN_TO_LEARN, unseen, review } from "./schedule.js";
import type { ExerciseKind, Learner, LingoItem, Mark, Verdict } from "./types.js";

/** One thing to do, as the session hands it over. The screens turn it into nodes; the routes mark the answer. */
export interface Exercise {
  kind: ExerciseKind;
  /** The item this is about, by its own text. */
  item: string;
  /** What is shown as the question: the item, or its meaning, depending on the direction. */
  prompt: string;
  /** Everything we will accept. The list is the point: one prompt almost always has several right answers. */
  accepted: string[];
  /** For `choose`: what is offered, and which one is right. Empty for every other kind. */
  options: string[];
  correct: number;
  /** For `chips`: the words to put in order, already shuffled. Empty for every other kind. */
  chips: string[];
  /** Whether answering this one counts as having said it out loud. */
  spoken: boolean;
}

/** How long a session is, from the minutes a day they asked for: about four exercises a minute, at least five. */
export const sizeFor = (goalMin: number): number => Math.max(5, Math.min(60, Math.round(goalMin * 4)));

/** At most this much of a session is things never seen before, so revision is never crowded out. */
const NEW_SHARE = 0.3;

/**
 * WHICH SHAPE AN ITEM GETS, by how well it is held and whether it has ever been said.
 *
 * A brand new item is only recognised (`choose`): being asked to produce a word nobody has met yet teaches nothing
 * but frustration. Once it is going in, it is heard and written. Once it is reasonably held it must be SAID, and
 * that is where it stays until it has been said enough times to count — because out loud is the thing being taught,
 * and an item that is never asked for out loud never finishes.
 */
export function shapeFor(item: LingoItem, now: number): ExerciseKind {
  const m = item.memory;
  if (m.state === "new") return "choose";
  if (m.state === "relearning") return "choose";
  const held = recall(m, now);
  // Held well enough to produce, but not yet said enough times to count: it is time to say it.
  if (m.state === "review" && item.spoken < SPOKEN_TO_LEARN) return "say";
  if (m.state === "review" && held < 0.6) return "say";
  if (m.reps <= 1) return "listen";
  if (m.reps === 2) return "chips";
  if (item.kind === "phrase") return "chips";
  return "write";
}

/** A stable shuffle: the same item on the same day is offered the same way, so a reload is not a different question. */
function shuffle<T>(xs: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 48271) + 11) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Up to three other meanings to offer beside the right one, taken from the person's own course so they are plausible. */
function distractors(item: LingoItem, pool: readonly LingoItem[], seed: string): string[] {
  const same = pool.filter((p) => p.item !== item.item && p.kind === item.kind && p.gloss.trim());
  const other = pool.filter((p) => p.item !== item.item && p.kind !== item.kind && p.gloss.trim());
  return shuffle([...same, ...other], seed).slice(0, 3).map((p) => p.gloss);
}

/** One item turned into the exercise it has earned. */
export function exerciseFor(item: LingoItem, pool: readonly LingoItem[], now: number, kind?: ExerciseKind): Exercise {
  const k = kind ?? shapeFor(item, now);
  const seed = `${item.item}|${Math.floor(now / 86_400_000)}`;
  const base: Exercise = { kind: k, item: item.item, prompt: item.item, accepted: [item.item], options: [], correct: 0, chips: [], spoken: k === "say" || k === "talk" };

  if (k === "choose") {
    // Shown the word, asked what it means: the gentlest thing a screen can ask.
    const options = shuffle([item.gloss, ...distractors(item, pool, seed)], `${seed}|opts`);
    return { ...base, prompt: item.item, accepted: [item.gloss], options, correct: Math.max(0, options.indexOf(item.gloss)) };
  }
  if (k === "chips") {
    const words = item.item.split(" ").filter(Boolean);
    return { ...base, prompt: item.gloss, chips: shuffle(words, `${seed}|chips`) };
  }
  if (k === "listen") {
    // The item is spoken aloud and they write what they heard, so the prompt is the item itself, for the voice.
    return { ...base, prompt: item.item };
  }
  // write, say and talk all ask them to produce the item from its meaning.
  return { ...base, prompt: item.gloss };
}

/**
 * WHAT TO ASK THIS TIME. The nearly-forgotten first, then a few never seen, each in the shape it has earned.
 * An item that is finished (`learned`) is not dropped, but it is only ever revision and never crowds out the rest.
 */
export function plan(items: readonly LingoItem[], learner: Learner, now: number): Exercise[] {
  const size = sizeFor(learner.goalMin);
  const ready = due(items, now);
  const room = Math.max(1, Math.round(size * NEW_SHARE));
  const fresh = unseen(items, Math.max(0, Math.min(room, size - Math.min(ready.length, size - room))));
  const picked = [...ready.slice(0, size - fresh.length), ...fresh];
  return picked.map((it) => exerciseFor(it, items, now));
}

/** The item after an answer: the scheduler moved on, and a time said out loud counted if that is what it was. */
export function answered(item: LingoItem, kind: ExerciseKind, mark: Mark, now: number): LingoItem {
  const outLoud = kind === "say" || kind === "talk";
  return review(item, mark.verdict, outLoud, now);
}

/** How a course is going, for the page and for the chat. Counts only, nothing invented. */
export interface Progress {
  items: number;
  learned: number;
  due: number;
  unseen: number;
  /** How much of what they have met they would still have right now, 0 to 1. */
  held: number;
}

export function progress(items: readonly LingoItem[], now: number): Progress {
  const met = items.filter((i) => i.memory.state !== "new");
  const sum = met.reduce((t, i) => t + recall(i.memory, now), 0);
  return {
    items: items.length,
    learned: items.filter(learned).length,
    due: due(items, now).length,
    unseen: items.filter((i) => i.memory.state === "new").length,
    held: met.length ? sum / met.length : 0,
  };
}

/** The day a moment falls on in somebody's own timezone, as "YYYY-MM-DD": what a streak is counted in. */
export function dayOf(now: number, tzOffsetMinutes: number): string {
  return new Date(now + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** The streak after finishing a session today: the same day changes nothing, the next day adds one, a gap starts again. */
export function streakAfter(learner: Learner, today: string): { streakDays: number; lastDay: string } {
  if (learner.lastDay === today) return { streakDays: learner.streakDays, lastDay: today };
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { streakDays: learner.lastDay === yesterday ? learner.streakDays + 1 : 1, lastDay: today };
}

/** Re-exported so a caller marking an answer never has to reach past the session for the verdict type. */
export type { Verdict };

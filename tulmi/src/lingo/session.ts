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
import { order, type Entry } from "./order.js";
import { fold } from "./grade.js";
import type { Sentence } from "./sentences.js";
import { underCap, type SetShape } from "./set.js";
import type { ExerciseKind, Learner, LingoItem, Mark, Verdict } from "./types.js";

/**
 * What a sentence with a hole in it shows where the word was taken out. One marker everywhere, so the screens never
 * have to guess and a test can read the prompt.
 */
export const GAP = "\u2014\u2014\u2014";

/**
 * Where a real sentence using a word comes from (sentences.ts). A lookup rather than the bank itself, so a session
 * stays pure and testable: the caller fetches, this arranges.
 */
export type SentenceLookup = (item: string) => readonly Sentence[];

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
  /** For `blank`: the sentence the word was taken out of, with GAP where it was. Empty for every other kind. */
  sentence: string;
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
  // A word put back into a real sentence. It comes before writing the word on its own, because a word is not
  // learned as a translation pair: it is learned where it is used. It needs a sentence, so a caller that has no
  // bank to look in simply never gets this kind, and the ladder closes over the gap.
  if (m.reps === 2) return "blank";
  if (m.reps === 3) return "chips";
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

/**
 * Up to three other WORDS to offer beside the right one, for a gap in a sentence. Taken from the person's own course
 * and the same kind of thing, so the wrong answers are words they might really confuse it with rather than obvious
 * filler — a choice nobody can learn from is not a question.
 */
function others(item: LingoItem, pool: readonly LingoItem[], seed: string): string[] {
  const same = pool.filter((p) => p.item !== item.item && p.kind === item.kind);
  const rest = pool.filter((p) => p.item !== item.item && p.kind !== item.kind);
  return shuffle([...same, ...rest], seed).slice(0, 3).map((p) => p.item);
}

/**
 * The sentence with the word taken out, or null when the word is not in it as a word. Folded to compare, so an
 * accent or a capital does not hide the match, and only a whole word is taken out — a gap in the middle of a longer
 * word teaches nothing.
 */
export function gapIn(text: string, item: string): string | null {
  const want = fold(item);
  if (!want) return null;
  const parts = text.split(/(\s+)/);
  let hit = -1;
  for (let i = 0; i < parts.length; i++) {
    if (fold(parts[i]!) === want) { hit = i; break; }
  }
  if (hit >= 0) {
    const out = [...parts];
    out[hit] = GAP;
    return out.join("");
  }
  // A script that puts no spaces between its words: take the run of characters out where it sits.
  const folded = fold(text);
  if (!folded.includes(want) || fold(text) === want) return null;
  const at = text.toLowerCase().indexOf(item.toLowerCase());
  return at < 0 ? null : text.slice(0, at) + GAP + text.slice(at + item.length);
}

/** Up to three other meanings to offer beside the right one, taken from the person's own course so they are plausible. */
function distractors(item: LingoItem, pool: readonly LingoItem[], seed: string): string[] {
  const same = pool.filter((p) => p.item !== item.item && p.kind === item.kind && p.gloss.trim());
  const other = pool.filter((p) => p.item !== item.item && p.kind !== item.kind && p.gloss.trim());
  return shuffle([...same, ...other], seed).slice(0, 3).map((p) => p.gloss);
}

/** One item turned into the exercise it has earned. */
export function exerciseFor(item: LingoItem, pool: readonly LingoItem[], now: number, kind?: ExerciseKind, sentences?: SentenceLookup): Exercise {
  let k = kind ?? shapeFor(item, now);
  const seed = `${item.item}|${Math.floor(now / 86_400_000)}`;
  const base: Exercise = { kind: k, item: item.item, prompt: item.item, accepted: [item.item], options: [], correct: 0, chips: [], spoken: k === "say" || k === "talk", sentence: "" };

  if (k === "blank") {
    // A real sentence that uses the word, with the word taken out. The shortest one is used: a beginner should not
    // have to read round four clauses to find the gap.
    const found = (sentences?.(item.item) ?? []).find((s) => gapIn(s.text, item.item));
    if (found) {
      const options = shuffle([item.item, ...others(item, pool, seed)], `${seed}|gap`);
      return {
        ...base, kind: "blank",
        prompt: found.gloss,
        sentence: gapIn(found.text, item.item) ?? found.text,
        accepted: [item.item],
        options,
        correct: Math.max(0, options.indexOf(item.item)),
      };
    }
    // No sentence in the bank uses it yet. Rather than show a hole with nothing round it, the ladder closes over
    // the gap and the word is written instead.
    k = item.kind === "phrase" ? "chips" : "write";
    base.kind = k;
    base.spoken = false;
  }

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
export function pick(items: readonly LingoItem[], learner: Learner, now: number, shape?: SetShape): LingoItem[] {
  const size = shape?.size ?? sizeFor(learner.goalMin);
  const ready = due(items, now);

  // The words that went wrong in the LAST set come first, ahead of everything else that is due. They are the most
  // recent evidence there is about this person, and a set that ignores them is not following them at all.
  const again = (shape?.revisit ?? []).map((w) => items.find((i) => i.item === w)).filter((i): i is LingoItem => !!i);
  const rest = ready.filter((i) => !again.some((a) => a.item === i.item));

  // How many never-seen words may come in. `shape` decides it when there is one — zero while somebody is
  // struggling, because new material is the last thing a person losing their grip needs.
  const room = shape ? shape.newRoom : Math.max(1, Math.round(size * NEW_SHARE));
  const revision = [...again, ...rest];
  // NO new words means NO new words. `unseen`'s limit of 0 means "all of them", which is the opposite of what is
  // wanted here, and asking for none has to be asked for by not asking at all: a struggling learner given a set
  // made entirely of words they have never seen is the exact failure this is meant to prevent.
  const want = Math.max(0, Math.min(room, size - Math.min(revision.length, size - room)));
  const fresh = want > 0 ? unseen(items, want) : [];
  return [...revision.slice(0, size - fresh.length), ...fresh];
}

/**
 * WHAT TO ASK THIS TIME, IN THE ORDER TO ASK IT.
 *
 * Picking is the scheduler's business and arranging is order.ts's; this joins them. The old order — everything due,
 * then everything new — was blocked practice twice over and ended every session on the easiest tap there is. The
 * reasoning for the shape it has now is written out in order.ts.
 */
export function plan(items: readonly LingoItem[], learner: Learner, now: number, sentences?: SentenceLookup, shape?: SetShape): Exercise[] {
  const picked = pick(items, learner, now, shape);
  const entries: Entry[] = picked.map((it) => {
    // The ladder says what this item has earned; the shape may hold it gentler, never harder (set.ts underCap).
    let kind = underCap(shapeFor(it, now), shape?.rungCap ?? null);
    // Flying: where an item can already be produced, ask for it out loud instead of in writing.
    if (shape?.pushSpoken && (kind === "write" || kind === "chips") && it.memory.state === "review") kind = "say";
    return {
      ex: exerciseFor(it, items, now, kind, sentences),
      // A word never met is a recognition question, which is easy; anything else is what the scheduler thinks they hold.
      ease: it.memory.state === "new" ? 0.72 : recall(it.memory, now),
    };
  });
  return order(entries);
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

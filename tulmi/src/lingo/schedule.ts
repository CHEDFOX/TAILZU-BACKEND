/**
 * WHEN TO ASK SOMETHING AGAIN. The scheduler, and the only place in Lingo that knows about forgetting.
 *
 * It is FSRS (ts-fsrs, MIT): a memory is a pair of numbers, how long it would hold (stability) and how hard this
 * person finds it (difficulty), and from those and the mark it works out the day the person would be about as likely
 * as not to have lost it. That is the day to ask. It beats the fixed-interval schemes, and it beats asking everything
 * every day, which is what a fixed lesson path quietly does.
 *
 * Everything here is pure: a stored item and a mark in, a stored item out. No clock of its own, no store, no model, so
 * the tests can walk a learner through a year in a few lines.
 *
 * ONE RULE OF OUR OWN sits on top of it (`learned`): the scheduler can only see whether they got it right, and an item
 * answered by tapping is not the same as one they can say. A word is not learned here until it has been passed OUT
 * LOUD, however well the numbers read.
 */
import { createEmptyCard, fsrs, Rating, State, type Card, type FSRS, type Grade as FsrsGrade } from "ts-fsrs";
import type { LingoItem, Memory, MemoryState, Verdict } from "./types.js";

/** How many times they must say an item right before we call it learned, whatever the scheduler thinks. */
export const SPOKEN_TO_LEARN = 2;

/** Items this far apart in stability are the same to us; it keeps a session's order from jittering on rounding. */
const DAY_MS = 86_400_000;

/** One scheduler for the server. FSRS's own defaults: they are fitted to a very large body of real reviews. */
const engine: FSRS = fsrs();

const STATES: readonly MemoryState[] = ["new", "learning", "review", "relearning"];

const stateIn = (s: State): MemoryState => STATES[s] ?? "new";
const stateOut = (s: MemoryState): State => {
  const i = STATES.indexOf(s);
  return (i < 0 ? State.New : i) as State;
};

/** A fresh item, never asked. `now` is when it was added, and it is due at once. */
export function freshMemory(now: number): Memory {
  const c = createEmptyCard(new Date(now));
  return { stability: c.stability, difficulty: c.difficulty, reps: c.reps, lapses: c.lapses, steps: c.learning_steps, state: "new", dueMs: now, lastMs: null };
}

/** Our stored memory as the scheduler's card. `elapsed_days` and `scheduled_days` are its own output, never its input. */
function toCard(m: Memory): Card {
  return {
    due: new Date(m.dueMs),
    stability: m.stability,
    difficulty: m.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: m.steps,
    reps: m.reps,
    lapses: m.lapses,
    state: stateOut(m.state),
    ...(m.lastMs === null ? {} : { last_review: new Date(m.lastMs) }),
  };
}

function fromCard(c: Card): Memory {
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    steps: c.learning_steps,
    state: stateIn(c.state),
    dueMs: c.due.getTime(),
    lastMs: c.last_review ? c.last_review.getTime() : null,
  };
}

/**
 * THE MARK, AS THE SCHEDULER READS IT.
 *
 * `close` is the whole reason this function exists. A missing accent or one slipped letter means they knew the word
 * and missed the spelling, so it is Hard: asked again sooner, but not thrown back to the start. Marking it wrong is
 * both untrue and the fastest way to make somebody stop.
 *
 * `right` out loud is Easy: saying it unprompted is the strongest evidence there is that it is theirs, and it is the
 * thing we are actually teaching. Right by tapping is only Good.
 */
export function ratingFor(verdict: Verdict, spoken: boolean): FsrsGrade {
  if (verdict === "wrong") return Rating.Again;
  if (verdict === "close") return Rating.Hard;
  return spoken ? Rating.Easy : Rating.Good;
}

/** An item after it has been answered. Pure: the same item, mark and clock always give the same result. */
export function review(item: LingoItem, verdict: Verdict, spoken: boolean, now: number): LingoItem {
  const next = engine.next(toCard(item.memory), new Date(now), ratingFor(verdict, spoken));
  return {
    ...item,
    spoken: item.spoken + (spoken && verdict === "right" ? 1 : 0),
    memory: fromCard(next.card),
  };
}

/**
 * Is this item theirs? The scheduler's own answer is "it is in review and holds for a week or more", and ours adds
 * that they have said it right, out loud, SPOKEN_TO_LEARN times. Reading is not speaking.
 */
export function learned(item: LingoItem): boolean {
  return item.memory.state === "review" && item.memory.stability >= 7 && item.spoken >= SPOKEN_TO_LEARN;
}

/** How likely they are to still have it, 0 to 1. Used to order a session and to say how a course is going. */
export function recall(memory: Memory, now: number): number {
  if (memory.state === "new" || memory.lastMs === null || memory.stability <= 0) return 0;
  const days = Math.max(0, (now - memory.lastMs) / DAY_MS);
  return engine.get_retrievability(toCard(memory), new Date(now), false) ?? Math.exp(-days / memory.stability);
}

/** The items that are due, the most forgotten first. `limit` of 0 means all of them. */
export function due(items: readonly LingoItem[], now: number, limit = 0): LingoItem[] {
  const ready = items.filter((i) => i.memory.state !== "new" && i.memory.dueMs <= now);
  ready.sort((a, b) => recall(a.memory, now) - recall(b.memory, now) || a.memory.dueMs - b.memory.dueMs);
  return limit > 0 ? ready.slice(0, limit) : ready;
}

/** Items never asked, the ones they reached for themselves first. `limit` of 0 means all of them. */
export function unseen(items: readonly LingoItem[], limit = 0): LingoItem[] {
  const order: Record<string, number> = { said: 0, asked: 1, heard: 2, seed: 3 };
  const fresh = items.filter((i) => i.memory.state === "new");
  fresh.sort((a, b) => (order[a.source] ?? 9) - (order[b.source] ?? 9) || a.memory.dueMs - b.memory.dueMs);
  return limit > 0 ? fresh.slice(0, limit) : fresh;
}

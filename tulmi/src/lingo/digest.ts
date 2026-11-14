/**
 * WHAT LINGO'S CHAT KNOWS: THE COURSE THIS PERSON IS ON, AND WHICH WORDS ARE DUE.
 *
 *   lingoDigest(userId, o) -> string | null    bots/run.ts hands it to Lingo's turn as <knowledge>
 *
 * So "what should I practise?" is answered from the real table, in one model call and with no tool, and so the
 * conversation can be steered onto the words that are actually due — which is the whole reason the chat exists.
 *
 * Everything in here is the person's own words, and a word is still text somebody typed, so the block is fenced and
 * our tags are broken inside it (bots/prompt.ts neutral).
 */
import { neutral } from "../bots/prompt.js";
import { due, unseen } from "./schedule.js";
import { progress } from "./session.js";
import { lingoStore, type LingoStore } from "./store.js";

const DUE_SHOWN = 25;
const NEW_SHOWN = 10;
const NONE = "They have not started a language yet. Ask them which language they want to learn and which language they already speak, then start it for them.";

export interface DigestDeps {
  store?: LingoStore;
  now?: number;
}

export async function lingoDigest(userId: string, o: DigestDeps = {}): Promise<string | null> {
  const store = o.store ?? lingoStore();
  const now = o.now ?? Date.now();

  const courses = await store.courses(userId).catch(() => []);
  if (!courses.length) return NONE;
  const course = courses[0]!;
  const items = await store.items(userId, course.target).catch(() => []);
  const p = progress(items, now);

  const lines: string[] = [];
  lines.push(`Learning: ${course.target}. Speaks: ${course.from}. Level: ${course.level}. ${course.goalMin} minutes a day.`);
  if (courses.length > 1) lines.push(`Also learning: ${courses.slice(1).map((c) => c.target).join(", ")}.`);
  lines.push(`Streak: ${course.streakDays} day${course.streakDays === 1 ? "" : "s"}.`);
  lines.push(`Words and phrases: ${p.items}, of which ${p.learned} are learned (said out loud), ${p.due} are due now and ${p.unseen} are new.`);

  const ready = due(items, now, DUE_SHOWN);
  if (ready.length) {
    lines.push("", "Due now, the most forgotten first. Bring these into the conversation:");
    for (const it of ready) lines.push(`- ${it.item} = ${it.gloss}${it.spoken ? "" : " (never said out loud)"}`);
  }
  const fresh = unseen(items, NEW_SHOWN);
  if (fresh.length) {
    lines.push("", "Not met yet:");
    for (const it of fresh) lines.push(`- ${it.item} = ${it.gloss}`);
  }
  if (!ready.length && !fresh.length) lines.push("", "Nothing is due. Talk with them, and add any new word they reach for.");

  return neutral(lines.join("\n"));
}

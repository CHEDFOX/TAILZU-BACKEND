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
import { portraitOf } from "./portrait.js";
import { lingoStore, type LingoStore } from "./store.js";

const DUE_SHOWN = 25;
const NEW_SHOWN = 10;
/** The seven codes (types.ts WHY_CODES) as a sentence the model can use. Their own words matter more and come after. */
const WHY_WORDS: Record<string, string> = {
  someone: "somebody they love speaks it",
  trip: "a trip they are taking",
  living: "they live there, or are moving there",
  work: "their work",
  family: "it is their family's language",
  study: "they are studying it",
  curious: "they simply want to",
};
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

  const me = portraitOf(items, course, now);
  const lines: string[] = [];
  lines.push(`Learning: ${course.target}. Speaks: ${course.from}. ${course.goalMin} minutes a day.`);
  // WHERE THEY ARE ON THE PATH. Without it the conversation has no idea what this person is supposed to be able to
  // do this week, and drifts into whatever the model finds interesting.
  lines.push(`On the path: unit ${me.unit.at} of ${me.unit.of} — "${me.unit.goal}"`);
  lines.push(`Level: ${me.earned}${me.earned === me.said ? "" : ` (they said ${me.said} when they started)`}.`);
  lines.push(`Holding ${(me.hold * 100).toFixed(0)}% of what they have met.`);
  if (courses.length > 1) lines.push(`Also learning: ${courses.slice(1).map((c) => c.target).join(", ")}.`);
  lines.push(`Streak: ${course.streakDays} day${course.streakDays === 1 ? "" : "s"}.`);
  // WHAT THEY CAME FOR (bots.lingo.why). Everything else here is counts; this is the only line that says what the
  // language is actually for, so the conversation can be about that and not about a bear drinking beer.
  const why = course.why ? WHY_WORDS[course.why] : "";
  if (why) lines.push(`Why they are learning it: ${why}.`);
  if (course.whyNote) lines.push(`In their own words: ${course.whyNote}`);
  if (why || course.whyNote) lines.push("Keep what you teach and what you talk about pointed at that.");
  lines.push(`Words and phrases: ${p.items}, of which ${p.learned} are learned (said out loud), ${p.due} are due now and ${p.unseen} are new.`);

  // HOW THEY DO AT EACH KIND, hardest first, and how sure that is. A rate with three answers behind it is said to
  // be a rate with three answers behind it, because a model told "0% at speaking" will act on it either way.
  if (me.kinds.length) {
    lines.push("", "How they do, hardest first:");
    for (const k of me.kinds.slice(0, 6)) {
      const sure = k.sure < 0.5 ? ` — only ${k.n} so far, so this is a guess` : "";
      lines.push(`- ${k.kind}: ${(k.p * 100).toFixed(0)}% of ${k.n}${sure}`);
    }
  }
  if (me.thinkMs) lines.push("", `They take about ${(me.thinkMs / 1000).toFixed(1)}s to answer. Slower than that on a word means they are working it out, not remembering it.`);
  if (me.hard.length) {
    lines.push("", "Costing them the most. Bring these up, and do not let them off:");
    for (const h of me.hard.slice(0, 8)) lines.push(`- ${h.item} = ${h.gloss}${h.lapses ? ` (lost it ${h.lapses}x)` : ""}${h.effort > 1.3 ? ` (${h.effort}x their usual thinking time)` : ""}`);
  }
  if (me.easy.length) {
    lines.push("", "Solid. Use these freely, and do not waste their time testing them:");
    lines.push(me.easy.slice(0, 8).map((e) => e.item).join(", "));
  }

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
  if (!ready.length && !fresh.length) lines.push("", "Nothing is due. Talk with them, and write down any new word they reach for.");
  // The one thing it can DO. Without this line it talks about remembering words and never calls the tool that does it.
  lines.push("", "When they reach for a word — they ask how to say it, they try it, you correct one — write it down with lingo_note_words. Saying you will remember something without calling it is a promise you have not kept.");

  return neutral(lines.join("\n"));
}

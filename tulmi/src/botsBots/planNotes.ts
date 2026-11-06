/**
 * PLAN EASE'S DAY NOTES, WRITTEN (docs/plan-ease.md "The day notes"; design A4). Pure templates over the person's items: rules only, nothing
 * that costs anything, so it can run every day for everyone.
 *
 *   eveningNote(input)  "Tomorrow: leave by 8:10 am" / "Tonight: pack the fruit costume. First: school drop 8:30 am. 2 more." Skipped
 *                       (null) when tomorrow is empty. One question may ride in it ("Move the grocery run to Sat 11 am?"): then it
 *                       carries that card's two buttons
 *   morningNote(input)  only when it adds something: "Today: leave by 8:10 am" / "New: standup moved to 10:30. School drop 8:30."
 *   morningAt(...)      7:30 am, or 45 minutes before the first leave-by when that is earlier, never before 6 am
 *   eveningAt(...)      8:30 pm, moving after two weeks to 15 minutes before they usually open the app in the evening (7 to 10 pm)
 *
 * Every word goes through planSafe.ts: no ₹ amount, a health visit is "Appointment", and nobody's own words. A day and a clock time,
 * as a note may be read later. At most three parts, then "2 more". English, or Hinglish when the app is in Hinglish.
 */
import type { NeedsCard } from "./planNeeds.js";
import type { DayItem } from "./planRows.js";
import type { Leave } from "./planDay.js";
import { clockOf } from "./planDay.js";
import { cutAt, lockSafe, safeTitle } from "./planSafe.js";
import { dueLine } from "./planDue.js";

const MIN = 60_000;

export interface NoteWords { title: string; body: string; category?: string; item?: string }

/** Words that mean getting something ready the night before. */
const GET_READY = /^(?:pack|carry|bring|keep|take|pay|buy|get|print|sign|fill|iron|charge|send|submit|collect|pick up)\b/i;

const short = (t: string) => t.split(" · ")[0]!.trim() || t;
const inLine = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const say = (t: string) => short(safeTitle(t));
const isTimed = (it: DayItem) => it.start !== null && !it.allDay;
const sentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** The Hinglish words for the notes' few fixed words. */
const HG: Record<string, string> = { Tomorrow: "Kal", Today: "Aaj", Tonight: "Aaj raat", First: "Pehle", New: "Naya", more: "aur", "Still open": "Abhi baaki" };
const w = (hg: boolean, en: string): string => (hg ? HG[en] ?? en : en);
const leaveBy = (hg: boolean, at: string): string => (hg ? `${at} tak niklo` : `leave by ${at}`);

export interface EveningInput {
  now: number; tz: number; hg?: boolean;
  /** Tomorrow's items, open ones. */
  tomorrow: DayItem[];
  /** Today's open to-dos (what is still to do tonight). */
  tonight: DayItem[];
  leaves: ReadonlyMap<string, Leave>;
  /** The one Needs-you card, when one waits: asked straight, with its buttons. */
  needs?: NeedsCard | null;
  /** The Daily summary's line, when it rides here ("5 things done, 1 needs you."). */
  summary?: string | null;
  /** Lines that would otherwise need a push of their own (a stopped calendar link, a capture left alone: later steps). */
  extra?: string[];
  /** Who's doing what in the family tomorrow, already lock-safe ("Kabir pickup: Mom", step 5: planAsks.ts). */
  family?: string[];
  /** The first evening note says, once, how to stop them. */
  first?: boolean;
}

/** The evening "tomorrow" note, or null when tomorrow is empty. */
export function eveningNote(i: EveningInput): NoteWords | null {
  const hg = !!i.hg;
  const items = [...i.tomorrow].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  if (!items.length) return null;
  const timed = items.filter(isTimed);
  const firstTimed = timed[0];
  const leave = firstTimed && firstTimed.ref === "event" ? i.leaves.get(firstTimed.id) : undefined;
  const named = new Set<string>();

  // The title: the first thing to act on, never a count.
  let title: string;
  if (leave && firstTimed && new Date(leave.leaveBy + i.tz * MIN).getUTCHours() < 10) {
    title = `${w(hg, "Tomorrow")}: ${leaveBy(hg, clockOf(leave.leaveBy, i.tz))}`;
  } else if (firstTimed) {
    title = `${w(hg, "Tomorrow")}: ${say(firstTimed.title)} at ${clockOf(firstTimed.start!, i.tz)}`;
    named.add(firstTimed.id);
  } else {
    title = `${w(hg, "Tomorrow")}: ${inLine(say(items[0]!.title))}`;
    named.add(items[0]!.id);
  }

  const parts: string[] = [];
  // 1. Tonight: what to get ready.
  const ready = [...i.tonight, ...items].filter((it) => it.ref === "task" && GET_READY.test(it.title) && !named.has(it.id));
  if (ready.length) {
    parts.push(`${w(hg, "Tonight")}: ${ready.slice(0, 2).map((it) => inLine(say(it.title))).join(", ")}`);
    for (const it of ready.slice(0, 2)) named.add(it.id);
  }
  // 2. Who's doing what in the family (step 5): "Kabir pickup: Mom, plants: Arjun."
  const family = (i.family ?? []).slice(0, 2);
  if (family.length) parts.push(family.map((x, n) => (n ? inLine(x) : x)).join(", "));
  // 3. The first thing, when the title didn't name it.
  if (firstTimed && !named.has(firstTimed.id)) {
    parts.push(`${w(hg, "First")}: ${inLine(say(firstTimed.title))} ${clockOf(firstTimed.start!, i.tz)}`);
    named.add(firstTimed.id);
  } else if (timed[1] && !named.has(timed[1].id)) {
    const n = timed[1];
    const l = n.ref === "event" ? i.leaves.get(n.id) : undefined;
    parts.push(`${say(n.title)} ${clockOf(n.start!, i.tz)}${l ? `, ${leaveBy(hg, clockOf(l.leaveBy, i.tz))}` : ""}`);
    named.add(n.id);
  }
  // 4. Money due, without the amount (step 3, planDue.ts): "Electricity due."
  const money = items.filter((it) => it.ref === "task" && it.kind === "due" && !named.has(it.id));
  const moneyLine = money.length && parts.length < 3 ? dueLine(money, money[0]!.day) : null;
  if (moneyLine) { parts.push(moneyLine); for (const it of money.slice(0, 2)) named.add(it.id); }
  const parts3 = parts.slice(0, 3);
  // 5. One question, asked straight.
  const question = i.needs && i.needs.item && i.needs.buttons.length && parts3.length < 3 ? i.needs : null;
  const left = items.filter((it) => !named.has(it.id)).length;
  const bits = [...parts3.map(sentence), ...(question ? [lockSafe(question.question, 80)] : [])];
  if (left > 0 && !question) bits.push(sentence(`${left} ${w(hg, "more")}`));
  for (const x of i.extra ?? []) bits.push(sentence(x));
  if (i.summary) bits.push(sentence(i.summary));
  if (i.first) bits.push("I'll send this each evening. Say 'no evening notes' in Plan Ease to stop.");
  return {
    title: cutAt(lockSafe(title, 80), 80), body: lockSafe(bits.join(" "), 240),
    ...(question ? { category: question.category ?? "x0_move", item: question.item } : {}),
  };
}

export interface MorningInput {
  now: number; tz: number; hg?: boolean;
  today: DayItem[];
  /** What the evening note saw of today ("<id>|<start>" each), or null when it didn't go. */
  sig: string[] | null;
  leaves: ReadonlyMap<string, Leave>;
  /** Yesterday's to-dos still open. */
  stillOpen: DayItem[];
  /** The one-time line when the evening note stops. */
  quietLine?: boolean;
  /** A line that would otherwise need a push of its own (a capture read overnight: "I read the circular: 4 things. Add them?"). */
  extra?: string[];
}

/** What today held, as the notes remember it: ids and starts only. */
export const signature = (items: DayItem[]): string[] => items.filter((it) => !it.done).map((it) => `${it.id}|${it.start ?? ""}`).sort();

/** What changed since the evening note: new ones, and ones whose time moved. */
export function changesSince(sig: string[] | null, items: DayItem[]): Array<{ it: DayItem; moved: boolean }> {
  if (!sig) return [];
  const was = new Map(sig.map((s) => { const [id, start] = s.split("|"); return [id!, start ?? ""]; }));
  const out: Array<{ it: DayItem; moved: boolean }> = [];
  for (const it of items) {
    if (it.done) continue;
    const before = was.get(it.id);
    if (before === undefined) out.push({ it, moved: false });
    else if (before !== String(it.start ?? "")) out.push({ it, moved: true });
  }
  return out;
}

/** The morning note: today's first thing, leading with what changed. Null when today is empty. */
export function morningNote(i: MorningInput): NoteWords | null {
  const hg = !!i.hg;
  const items = i.today.filter((it) => !it.done).sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  if (!items.length) return null;
  const timed = items.filter(isTimed);
  const first = timed[0];
  const leave = first && first.ref === "event" ? i.leaves.get(first.id) : undefined;
  const named = new Set<string>();
  let title: string;
  if (leave) title = `${w(hg, "Today")}: ${leaveBy(hg, clockOf(leave.leaveBy, i.tz))}`;
  else if (first) { title = `${w(hg, "Today")}: ${say(first.title)} at ${clockOf(first.start!, i.tz)}`; named.add(first.id); }
  else { title = `${w(hg, "Today")}: ${inLine(say(items[0]!.title))}`; named.add(items[0]!.id); }

  const parts: string[] = [];
  const changed = changesSince(i.sig, items);
  if (changed.length) {
    const c = changed[0]!;
    const at = c.it.start !== null ? clockOf(c.it.start, i.tz) : "";
    parts.push(`${w(hg, "New")}: ${inLine(say(c.it.title))}${c.moved ? ` moved to ${at}` : at ? ` ${at}` : ""}`);
    named.add(c.it.id);
  }
  for (const it of timed) {
    if (parts.length >= 2 || named.has(it.id)) continue;
    parts.push(`${say(it.title)} ${clockOf(it.start!, i.tz)}`);
    named.add(it.id);
  }
  if (i.stillOpen.length && parts.length < 3) parts.push(`${w(hg, "Still open")}: ${inLine(say(i.stillOpen[0]!.title))}`);
  const bits = parts.slice(0, 3).map(sentence);
  for (const x of i.extra ?? []) bits.push(sentence(x));
  if (i.quietLine) bits.push("I'll send just this morning note now. Say 'evening notes' to get the evening one back.");
  return { title: cutAt(lockSafe(title, 80), 80), body: lockSafe(bits.join(" "), 240) };
}

// ------------------------------------------------------------------ when

const startOfDay = (key: string, tz: number) => Date.parse(`${key}T00:00:00Z`) - tz * MIN;

/** The morning note's time on `day`: 7:30 am, or 45 minutes before the first leave-by when that is earlier, never before 6 am. */
export function morningAt(day: string, tz: number, morningMin: number, firstLeaveBy: number | null): number {
  const base = startOfDay(day, tz) + morningMin * MIN;
  const early = firstLeaveBy !== null ? firstLeaveBy - 45 * MIN : Infinity;
  return Math.max(startOfDay(day, tz) + 6 * 60 * MIN, Math.min(base, early));
}

/** Evening opens kept, and how many days of them before the note moves. */
export const OPENS_KEPT = 21;
const OPENS_NEEDED = 7;
const LEARN_AFTER_DAYS = 14;

/**
 * The evening note's minute: 8:30 pm until two weeks of evening opens say when they usually look (their median), then 15 minutes before
 * that, kept between 7 pm and 10 pm.
 */
export function eveningMinute(opens: Array<{ day: string; min: number }>, current: number): number {
  const days = [...new Set(opens.map((o) => o.day))].sort();
  if (days.length < OPENS_NEEDED) return current;
  const span = (Date.parse(`${days[days.length - 1]}T00:00:00Z`) - Date.parse(`${days[0]}T00:00:00Z`)) / (24 * 60 * MIN);
  if (span < LEARN_AFTER_DAYS - 1) return current;
  // The first evening open of each day.
  const firsts = days.map((d) => Math.min(...opens.filter((o) => o.day === d).map((o) => o.min))).sort((a, b) => a - b);
  const median = firsts[Math.floor(firsts.length / 2)]!;
  return Math.max(19 * 60, Math.min(22 * 60, Math.round((median - 15) / 5) * 5));
}

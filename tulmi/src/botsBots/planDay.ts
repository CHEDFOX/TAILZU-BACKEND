/**
 * THE SIMPLE PLAN EASE PAGE, WORKED OUT (docs/plan-ease.md; design A1, A2, A4 "The widget line"). Pure: the person's items, the
 * leave-by times and the one Needs-you card come in; what the page, Home and the widget show comes out.
 *
 *   planPage(input)   { next, needs, days: [Today, Tomorrow] (Tomorrow first after 5 pm), week, ... } for GET /v1/botsapp/bots/plan/today
 *   nextThing(input)  the one thing that matters next (the ladder below)
 *   weekLines(input)  the days after tomorrow, one line each ("Standup 10 am · 2 more"; an empty day is just its date)
 *   widgetLine(input) Plan Ease's line on the widget (32 characters), and on the lock screen (24), lock-safe
 *   widgetSteps(input) the same line as it will read later on, from each moment it changes (the glance's steps, for widgets that switch)
 *
 * THE LADDER. The first that matches is the one thing:
 *   1. a leave-by within 60 minutes      "Leave by 5:30 pm for the dentist" / "30 min drive to Indiranagar"   [Open map] within 15
 *   2. (step 3) a bill due today, unpaid  "Pay ₹2,140 for electricity today"
 *   3. a timed thing still to come today "Dentist at 6 pm" / "Indiranagar · 2 more today"
 *   4. only to-dos left today            "Today: buy the fruit costume" / "2 more to do"
 *   5. nothing left today (after 5 pm, or tomorrow has something)   "Tomorrow starts at 9:30 am" / "Parent-teacher meeting"
 *   6. nothing at all                    "Nothing planned yet"
 * Its item is not repeated in the list below. Never a bare count: a count is not a thing to do.
 */
import { directionsLink } from "../connectors/handoffs/links.js";
import type { NeedsCard } from "./planNeeds.js";
import { rowOf, type DayItem, type RowCtx, type RowNote, type RowView } from "./planRows.js";
import { cutAt, lockSafe, looksHealth, safeTitle } from "./planSafe.js";
import { dueNext, dueWidget } from "./planDue.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today shows this many rows, then "2 more"; Tomorrow this many. */
export const TODAY_ROWS = 6;
export const TOMORROW_ROWS = 3;
/** From this hour Tomorrow comes first, and Today keeps only what is still open. */
const EVENING_HOUR = 17;

export interface Leave { leaveBy: number; minutes: number; mode: string; to: string }

export interface PlanInput {
  now: number;
  tz: number;
  today: string;
  tomorrow: string;
  /** Today's to some days on (done ones too). */
  items: DayItem[];
  leaves: ReadonlyMap<string, Leave>;
  /** "Clashes with design review", by item id: two booked things that can't both happen. */
  clashes: ReadonlyMap<string, string>;
  needs: NeedsCard | null;
  /** The newest note someone left on an item, by row id: its grey line (inside the app only). */
  notes?: ReadonlyMap<string, RowNote>;
  /** Follow-through's line for a followed item of today, by row id (planFollow.ts followLinesOf). */
  follow?: ReadonlyMap<string, string>;
}

/** The big line: words, with the part to show in ochre (the leave-by time) said apart. */
export interface NextThing {
  big: string;
  /** The part of `big` in Plan Ease's ochre ("5:30 pm"), when there is one. */
  accent?: string;
  grey: string;
  /** "Open map" (rung 1, within 15 minutes) or step 3's "Pay": a link the phone hands off to. */
  button?: { label: string; url: string };
  /** The row it is about (left out of the list). */
  rowId?: string;
  rung: number;
}

export interface PlanDayList { key: string; label: "Today" | "Tomorrow"; rows: RowView[]; more: number }
export interface WeekLine { key: string; date: string; line: string }

export interface PlanPage {
  v: 2;
  today: string;
  tomorrow: string;
  next: NextThing;
  needs: NeedsCard | null;
  days: PlanDayList[];
  /** The days after tomorrow (the desktop's rail, "See the week"). */
  week: WeekLine[];
}

// ------------------------------------------------------------------ words

const minuteOf = (ms: number, tz: number) => { const d = new Date(ms + tz * MIN); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
/** "9:30 am", "6 pm". */
export function clockOf(ms: number, tz: number): string {
  const m = minuteOf(ms, tz), h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}
/** "9:00", "9:30": a clock time short enough for the widget, where the day part is plain. */
const hm = (ms: number, tz: number): string => { const m = minuteOf(ms, tz), h = Math.floor(m / 60) % 12 || 12; return `${h}:${String(m % 60).padStart(2, "0")}`; };

/** "Sat 14". */
export const dateWords = (key: string): string => { const d = new Date(`${key}T00:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`; };
/** "Sat 14 Nov". */
export const longDate = (key: string): string => { const d = new Date(`${key}T00:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "Sat". */
export const weekday = (key: string): string => WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()]!;
const shiftDay = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const inLine = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const short = (t: string) => t.split(" · ")[0]!.trim() || t;
/** "2 more", the same words everywhere. */
export const more = (n: number): string => `${n} more`;

const rowCtx = (i: Pick<PlanInput, "tz" | "now" | "leaves" | "clashes" | "notes" | "follow">): RowCtx => ({
  tz: i.tz, now: i.now, clock: (ms) => clockOf(ms, i.tz), leaves: i.leaves, clashes: i.clashes, ...(i.notes ? { notes: i.notes } : {}),
  ...(i.follow ? { follow: i.follow } : {}),
});

/** Done last, the rest in time order (timed first, then the day's to-dos). */
const ordered = (rows: RowView[]): RowView[] => [...rows].sort((a, b) => Number(a.done) - Number(b.done) || a.at - b.at || a.title.localeCompare(b.title));

// ------------------------------------------------------------------ the one thing

const open = (it: DayItem) => !it.done;
const isTimed = (it: DayItem) => it.start !== null && !it.allDay;

export function nextThing(i: Omit<PlanInput, "needs">): NextThing {
  const today = i.items.filter((it) => it.day === i.today && open(it));
  const tomorrow = i.items.filter((it) => it.day === i.tomorrow && open(it));
  const id = (it: DayItem) => `${it.ref === "event" ? "e" : "t"}:${it.id}`;

  // 1. A leave-by within the hour.
  const leaving = today.filter((it) => it.ref === "event" && i.leaves.has(it.id))
    .map((it) => ({ it, l: i.leaves.get(it.id)! })).filter(({ l }) => l.leaveBy > i.now - 5 * MIN && l.leaveBy - i.now <= 60 * MIN)
    .sort((a, b) => a.l.leaveBy - b.l.leaveBy)[0];
  if (leaving) {
    const at = clockOf(leaving.l.leaveBy, i.tz);
    const where = leaving.it.place ?? leaving.it.where ?? leaving.l.to;
    return {
      big: `Leave by ${at} for ${inLine(short(leaving.it.title))}`, accent: at,
      grey: `${leaving.l.minutes} min ${leaving.l.mode === "walk" ? "walk" : "drive"} to ${leaving.l.to}`,
      ...(leaving.l.leaveBy - i.now <= 15 * MIN && where ? { button: { label: "Open map", url: directionsLink(where, leaving.l.mode === "walk" ? "walking" : "driving") } } : {}),
      rowId: id(leaving.it), rung: 1,
    };
  }

  // 2. A bill due today and not paid (step 3, planDue.ts): "Pay ₹2,140 for electricity today", [Pay] with a safe link.
  const bill = dueNext(today, i.today);
  if (bill) return bill;

  // 3. A timed thing still to come today.
  const coming = today.filter((it) => isTimed(it) && it.start! >= i.now - 5 * MIN).sort((a, b) => a.start! - b.start!);
  if (coming.length) {
    const it = coming[0]!;
    const rest = coming.length - 1;
    return {
      big: `${short(it.title)} at ${clockOf(it.start!, i.tz)}`,
      grey: [it.where ?? "", rest ? `${more(rest)} today` : ""].filter(Boolean).join(" · "), rowId: id(it), rung: 3,
    };
  }

  // 4. Only to-dos left today.
  const todos = today.filter((it) => it.ref === "task").sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  if (todos.length) {
    const it = todos[0]!;
    return { big: `Today: ${inLine(it.title)}`, grey: todos.length > 1 ? `${todos.length - 1} more to do` : "", rowId: id(it), rung: 4 };
  }

  // 5. Today is done: what tomorrow starts with.
  const evening = minuteOf(i.now, i.tz) >= EVENING_HOUR * 60;
  if (tomorrow.length && (evening || !today.length)) {
    const first = tomorrow.filter(isTimed).sort((a, b) => a.start! - b.start!)[0];
    if (first) return { big: `Tomorrow starts at ${clockOf(first.start!, i.tz)}`, grey: short(first.title), rowId: id(first), rung: 5 };
    const todo = tomorrow.find((it) => it.ref === "task") ?? tomorrow[0]!;
    return { big: `Tomorrow: ${inLine(todo.title)}`, grey: tomorrow.length > 1 ? `${more(tomorrow.length - 1)} tomorrow` : "", rowId: id(todo), rung: 5 };
  }

  // 6. Nothing at all: the box's own words say what to do.
  return { big: "Nothing planned yet", grey: "", rung: 6 };
}

// ------------------------------------------------------------------ the lists

function dayList(i: PlanInput, key: string, label: "Today" | "Tomorrow", max: number, o: { openOnly: boolean; skip?: string }): PlanDayList {
  const ctx = rowCtx(i);
  const rows = ordered(i.items.filter((it) => it.day === key && (!o.openOnly || open(it))).map((it) => rowOf(it, ctx)))
    // Today's past timed things that are done with are not news: a to-do stays until it is ticked.
    .filter((r) => !(label === "Today" && r.kind === "event" && r.at < i.now - HOUR && !r.line.startsWith("Clashes")))
    .filter((r) => r.id !== o.skip);
  return { key, label, rows: rows.slice(0, max), more: Math.max(0, rows.length - max) };
}

/** One line a day after tomorrow: the first thing, then "2 more". An empty day is just its date. */
export function weekLines(i: Pick<PlanInput, "items" | "tz" | "tomorrow">, days = 6): WeekLine[] {
  const out: WeekLine[] = [];
  for (let n = 1; n <= days; n += 1) {
    const key = shiftDay(i.tomorrow, n);
    const list = i.items.filter((it) => it.day === key && open(it)).sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
    const first = list[0];
    out.push({
      key, date: dateWords(key),
      line: first ? [`${short(first.title)}${first.start !== null && !first.allDay ? ` ${clockOf(first.start, i.tz)}` : ""}`, list.length > 1 ? more(list.length - 1) : ""].filter(Boolean).join(" · ") : "",
    });
  }
  return out;
}

export function planPage(i: PlanInput): PlanPage {
  const next = nextThing(i);
  const evening = minuteOf(i.now, i.tz) >= EVENING_HOUR * 60;
  const today = dayList(i, i.today, "Today", TODAY_ROWS, { openOnly: evening, ...(next.rowId ? { skip: next.rowId } : {}) });
  const tomorrow = dayList(i, i.tomorrow, "Tomorrow", TOMORROW_ROWS, { openOnly: false, ...(next.rowId ? { skip: next.rowId } : {}) });
  return {
    v: 2, today: i.today, tomorrow: i.tomorrow, next, needs: i.needs,
    days: evening ? [tomorrow, today] : [today, tomorrow],
    week: weekLines(i),
  };
}

// ------------------------------------------------------------------ outside the app: the widget's line and the lock screen

export interface WidgetLine {
  /** The Home Screen widget's Plan Ease line, 32 characters at most. */
  line: string;
  /** The lock screen's date line (24) and its rectangle's two lines. */
  lock: { inline: string; title: string; line: string };
  /** Within 2 hours of a leave-by: the plan line leads the lock screen even while bots are working. */
  leads: boolean;
  /** When the line stops being true (the widget drops it then, at its next fetch). */
  until: number | null;
}

/**
 * Plan Ease's line outside the app. A day and a clock time, never "next" for a thing already over or "in 10 min" (the widgets don't ask
 * the server: the line must stay true until its time passes). No amount, a health visit is "Appointment" (planSafe.ts).
 */
export function widgetLine(i: Pick<PlanInput, "items" | "leaves" | "now" | "tz" | "today" | "tomorrow">): WidgetLine | null {
  const coming = i.items.filter((it) => open(it) && isTimed(it) && it.start! > i.now && (it.day === i.today || it.day === i.tomorrow))
    .sort((a, b) => a.start! - b.start!);
  const first = coming[0];
  const leave = first && first.ref === "event" ? i.leaves.get(first.id) : undefined;
  const dayTag = (it: DayItem) => (it.day === i.today ? "" : `${weekday(it.day)} · `);
  if (first) {
    const title = short(safeTitle(first.title));
    const at = clockOf(first.start!, i.tz);
    // Where it is, only when neither it nor its place says health ("Dr. Mehta's clinic" is no one else's business).
    const where = first.where && !looksHealth(first.where) && !looksHealth(first.title) ? lockSafe(first.where, 20) : "";
    if (leave && leave.leaveBy > i.now) {
      const by = clockOf(leave.leaveBy, i.tz);
      return {
        line: lockSafe(`${dayTag(first)}${title} ${hm(first.start!, i.tz)}, leave ${hm(leave.leaveBy, i.tz)}`, 32),
        lock: { inline: cutAt(`Leave by ${hm(leave.leaveBy, i.tz)} · ${title}`, 24), title: cutAt(`${first.day === i.today ? "" : `${weekday(first.day)}: `}Leave by ${by}`, 32), line: cutAt(`${title}${where ? ` at ${where}` : ""}, ${at}`, 40) },
        leads: leave.leaveBy - i.now <= 2 * HOUR, until: leave.leaveBy,
      };
    }
    return {
      line: lockSafe(`${first.day === i.today ? "Next: " : dayTag(first)}${title} ${at}`, 32),
      lock: { inline: cutAt(`${first.day === i.today ? "Next" : weekday(first.day)}: ${title} ${hm(first.start!, i.tz)}`, 24), title: cutAt(`${title} at ${at}`, 32), line: first.day === i.today ? "Today" : longDate(first.day) },
      leads: false, until: first.start,
    };
  }
  // A bill due today (step 3): its line, never its amount, until the day is over.
  const bill = dueWidget(i.items, i.today);
  if (bill) return { line: bill, lock: { inline: cutAt(bill, 24), title: cutAt(bill, 32), line: "Today" }, leads: false, until: Date.parse(`${i.tomorrow}T00:00:00Z`) - i.tz * MIN };
  const todo = i.items.find((it) => open(it) && it.ref === "task" && it.day === i.today);
  if (todo) {
    const t = safeTitle(todo.title);
    return { line: lockSafe(`Today: ${inLine(t)}`, 32), lock: { inline: cutAt(`Today: ${inLine(t)}`, 24), title: cutAt(t, 32), line: "Today" }, leads: false, until: null };
  }
  return null;
}

/** How far ahead, and how many, the widget's steps go (the app's glanceCore.ts keeps 16 within 48 hours). */
export const WIDGET_STEP_HOURS = 36;
export const WIDGET_STEPS_MAX = 16;

/**
 * THE WIDGET'S LINE LATER ON, for a build whose widgets switch their lines on their own at the glance's `steps` (the app release; the
 * app's glanceCore.ts GlanceStep). widgetLine as it will read from each moment it changes over the next day and a half: a leave-by's
 * last 2 hours (it then leads the lock screen), the leave-by itself, each start, and midnight (today and tomorrow move on). Only the
 * moments where it reads differently, oldest first; null when nothing is left to say. Pure, and as lock-safe as widgetLine.
 */
export function widgetSteps(i: Pick<PlanInput, "items" | "leaves" | "now" | "tz" | "today" | "tomorrow">): Array<{ at: number; widget: WidgetLine | null }> {
  const end = i.now + WIDGET_STEP_HOURS * HOUR;
  const moments = new Set<number>();
  const add = (t: number) => { if (t > i.now && t <= end) moments.add(t); };
  for (const it of i.items) if (isTimed(it)) add(it.start!);
  for (const l of i.leaves.values()) { add(l.leaveBy - 2 * HOUR); add(l.leaveBy); }
  for (let n = 1; n <= 2; n++) add(Date.parse(`${shiftDay(i.today, n)}T00:00:00Z`) - i.tz * MIN);
  const said = (w: WidgetLine | null) => JSON.stringify(w ? { line: w.line, lock: w.lock, leads: w.leads } : null);
  let was = said(widgetLine(i));
  const out: Array<{ at: number; widget: WidgetLine | null }> = [];
  for (const at of [...moments].sort((a, b) => a - b)) {
    const today = new Date(at + i.tz * MIN).toISOString().slice(0, 10);
    const w = widgetLine({ ...i, now: at, today, tomorrow: shiftDay(today, 1) });
    const now = said(w);
    if (now === was) continue;
    was = now;
    out.push({ at, widget: w });
    if (out.length >= WIDGET_STEPS_MAX) break;
  }
  return out;
}

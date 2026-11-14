/**
 * PLAN EASE'S HOME: ONE DAY AS A THREAD (PLAN_V2_HOME; docs/plan-ease.md). The Plan page "like before": the header with the walking
 * bot and +, the week strip, one day as a thread (times on the left, a line joining the items, leave-by, weather and free-time lines
 * between them), to-dos with no day, Share and where the day starts. Fed by the new rows (planRows.ts rowOf, the one place that words
 * a row), so follow lines, must not miss, Needs-you, people's tiny bots, Pay and work meetings are all kept.
 *
 *   PlanDayData        what GET /v1/botsapp/bots/plan/day answers (PlanEase.day); screens/bots/planHome.ts draws it
 *   ThreadStep         one step of the thread: a row, a leave-by, free time, the sky
 *   threadOf(items, o) the day's steps, in order (pure)
 *
 *   stripOf(day, today, items)   the week strip: the Monday-to-Sunday week that holds the day, 8 weeks either way at most
 *   defaultDay(items, now, tz)   which day the home opens on: today, or tomorrow from 5 pm once today is done
 *   dayParam(...)                the `day` (or the old `week`) param, read
 *   addedOf(rows, ...)           after Done: "Added: Dentist, Fri 13 Nov, 5 pm" and the rows to outline, for 10 minutes
 *   shareOf(...)                 the day as text for Share
 *
 * Nothing here is handed to the widget, the glance or a push: `head` and `added.line` are drawn in the app only. The widget keeps
 * GET .../plan/line. Pure: no reads.
 */
import type { ArrivalItem } from "../../../shared/types/sdui.js";
import { directionsLink } from "../connectors/handoffs/links.js";
import { isDayKey, minuteOf, shiftDay, weekdayOf } from "../calendar/words.js";
import { rowOf, type DayItem, type RowCtx, type RowView } from "./planRows.js";
import type { NeedsCard } from "./planNeeds.js";
import { clockOf, EVENING_HOUR, longDate, type WeekLine } from "./planDay.js";
import type { PlanLeg, PlanTravel } from "./planTravel.js";
import { addedWhen, keepClock } from "./planMake.js";

export type { RowView } from "./planRows.js";
export type { NeedsCard } from "./planNeeds.js";
export type { WeekLine } from "./planDay.js";
export type { PlanTravel } from "./planTravel.js";

/** The route (routes/bots/botsBots.ts, next to plan/today): `?tz&day&week&made&n`, all of them optional. */
export const PLAN_DAY = "/v1/botsapp/bots/plan/day";

/** One step of the thread. Each draws as one row: [label] [the track] [content]. */
export type ThreadStep =
  /**
   * An item. `label`: "6:00 pm", "All day" or "To do". `meta`: the grey line as the thread says it ("Must not miss · 45 min ·
   * Indiranagar", or the follow line as it is). `dim`: done, or an event already over. `fresh`: just added (outlined).
   */
  | { k: "row"; label: string; row: RowView; meta: string; dim: boolean; fresh: boolean }
  /** When to leave for the next event ("Leave home by 5:30 pm · 30 min to Indiranagar"); `button` within 15 minutes of leaving. */
  | { k: "leave"; text: string; tight: boolean; button?: { label: "Open map"; url: string } }
  /** A gap of 90 minutes or more ("Free · 7 pm to 8:30 pm, 1 h 30 min"). */
  | { k: "free"; text: string }
  /** Rain, a storm or heat on an outdoor stop ("Rain likely around 6 pm"). */
  | { k: "sky"; kind: "rain" | "storm" | "heat"; text: string };

/** One day of the week strip: "Mon" and "9", a dot when anything is still open that day, a ring on today. */
export interface StripDay { key: string; wd: string; n: string; busy: boolean; today: boolean }

/** The week that holds the shown day, Monday to Sunday; `prev` / `next` are null more than 8 weeks from today's week. */
export interface PlanStrip { days: StripDay[]; prev: string | null; next: string | null }

/** What GET .../plan/day answers (PlanEase.day). */
export interface PlanDayData {
  v: 3;
  today: string;
  tomorrow: string;
  /** The day threaded ("YYYY-MM-DD"). */
  day: string;
  /** "Today" | "Tomorrow" | "Saturday". */
  label: string;
  /** "Thu 12 Nov". */
  date: string;
  /** The ochre line under "Plan Ease" (nextThing's big line from today and tomorrow, + " · 40 min saved"). In the app only. */
  head: string;
  strip: PlanStrip;
  /** At most one Needs-you card, above the day. */
  needs: NeedsCard | null;
  thread: ThreadStep[];
  /** "Nothing on today" ("Nothing on tomorrow", "Nothing on Saturday") when the thread is empty, else "". */
  empty: string;
  /** To-dos with no day (calendar.list's open ones), through rowOf. */
  open: RowView[];
  /** The days after (planDay.ts weekLines): the desktop's rail. */
  week: WeekLine[];
  /**
   * Travel, whole, only when the day is today or tomorrow and places are on: legs (tight ones too), headsUp, credits, pending, home.
   * The same shape as screens/botsPlaces.ts PlanTravelView, so places.planFoot and places.homePart draw it as they are.
   */
  travel?: PlanTravel;
  /** The day as text for Share ("<Label> · <date>", one line an item); null for an empty day. */
  share: { title: string; text: string } | null;
  /** After Done (params made and n): "Added: Dentist, Fri 13 Nov, 5 pm" with Undo's key and n, for 10 minutes. In the app only. */
  added?: { line: string; key: string; n: number };
  /**
   * THE ARRIVAL REMINDERS THE PHONE'S OWN SYSTEM SHOULD BE WATCHING (docs: perms2 §7; `arrival.sync` on page appear). Present
   * only for a phone that declared Arrival1 while PERM_ARRIVAL is on, and empty for everyone else, which is every client today.
   *
   * The places go OUT, from the server that geocoded them; nothing ever comes back. The phone watches each place itself and
   * shows the reminder, so this server is never told where the person is, or that they arrived.
   */
  arrivals?: ArrivalItem[];
  /**
   * A place in the armed set is still being looked up, so `arrivals` is not the whole set yet (docs: perms2 §7.2). The sync
   * on page appear REPLACES what the phone watches, so it sends nothing this round rather than take an armed trigger off a
   * phone over a lookup that has not come back. The live channel brings the page again when it has.
   */
  arrivalsPending?: boolean;
  /**
   * WHAT THE PHONE'S OWN SWITCHES SAY (docs: perms2 §2, §3, §4), so the rows draw themselves on or off: whether busy times and
   * the Reminders list are on, when the busy times last came in, and whether a Focus with X0 Bot's filter is on right now.
   * Never which Focus, and never anything of what is in the calendar or the list.
   */
  /** `focusHold` is the person's own "Hold calls during a Focus" switch: without it on, nothing asks the phone about a Focus. */
  phone?: { busy: boolean; busyAt: number; reminders: boolean; focusOn: boolean; focusHold: boolean; ai: boolean };
}

/** What threadOf reads beyond the items. `fresh`: the row ids just added ("e:<id>", "t:<id>"), outlined. */
export interface ThreadOpts {
  day: string;
  now: number;
  tz: number;
  me: string;
  travel?: PlanTravel;
  rowCtx: RowCtx;
  fresh: ReadonlySet<string>;
}

const MIN = 60_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Free time this long or more between two busy events is said ("Free · 7 pm to 8:30 pm, 1 h 30 min"). */
const FREE_MIN = 90;
/** The strip and the `day` param go this many weeks either way from today's week. */
export const STRIP_WEEKS = 8;
/** After Done, the new rows are outlined and "Added: …" is said for this long. */
export const ADDED_MS = 10 * MIN;
/** "Open map" on a leave-by within this long of leaving. */
const OPEN_MAP_MS = 15 * MIN;

/** "45 min", "1 h 30 min", "2 h". */
export function lengthWords(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
}

/** "Leave home by 5:30 pm · 30 min to Indiranagar", "Only 15 min to get there · 35 min to Koramangala" (botsPlaces.ts legWords' words). */
export function legWords(leg: PlanLeg, tz: number): string {
  const how = leg.mode === "walk" ? `${leg.minutes} min walk to ${leg.to}` : `${leg.minutes} min to ${leg.to}`;
  if (leg.tight) return leg.gapMin !== null && leg.gapMin > 0 ? `Only ${leg.gapMin} min to get there · ${how}` : `No time to get there · ${how}`;
  return `Leave ${leg.fromId === "home" ? "home " : ""}by ${clockOf(leg.leaveBy, tz)} · ${how}`;
}

/** The thread's time labels, as the page "like before" said them: "6:00 pm", "9:30 am" (free and leave lines keep "6 pm"). */
export function labelClock(ms: number, tz: number): string {
  const m = minuteOf(ms, tz), h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const timed = (it: DayItem): boolean => it.start !== null && !it.allDay;
const busyEvent = (it: DayItem): boolean => it.ref === "event" && timed(it) && !it.free && !it.done;
const rowIdOf = (it: DayItem): string => `${it.ref === "event" ? "e" : "t"}:${it.id}`;
/** Just added: its row id, or its series' ("e:<id>" also outlines "e:<id>@<day>"). */
const isFresh = (id: string, fresh: ReadonlySet<string> | ReadonlyMap<string, unknown>): boolean => fresh.has(id) || fresh.has(id.split("@")[0]!);

function rowStep(it: DayItem, label: string, o: ThreadOpts, dimTo?: boolean): ThreadStep {
  const row = rowOf(it, { ...o.rowCtx, me: o.me, thread: true, leaves: new Map() });
  const rest = row.line.replace(/^Must not miss(?: · )?/, "");
  const meta = row.followed
    ? row.line
    : [row.must ? "Must not miss" : "", it.ref === "event" && timed(it) && it.end !== null ? lengthWords(it.end - it.start!) : "", rest].filter(Boolean).join(" · ");
  const over = it.ref === "event" && timed(it) && it.end !== null && it.end < o.now;
  return { k: "row", label, row, meta, dim: dimTo ?? (it.done || over), fresh: isFresh(row.id, o.fresh) };
}

/**
 * The day's steps, in order: all-day events by title; timed items in start order, each with its leave-by before it, its weather after
 * it and the free time after it; to-dos with only a day by title; done to-dos last.
 */
export function threadOf(items: DayItem[], o: ThreadOpts): ThreadStep[] {
  const day = items.filter((it) => it.day === o.day);
  const out: ThreadStep[] = [];
  const byTitle = (a: DayItem, b: DayItem) => a.title.localeCompare(b.title);

  // 1. All day.
  for (const it of day.filter((x) => x.ref === "event" && !timed(x)).sort(byTitle)) out.push(rowStep(it, "All day", o));

  // 2. The times: the leave-by before an event, its weather after it, free time after it.
  const times = day.filter((x) => timed(x) && !(x.ref === "task" && x.done)).sort((a, b) => a.start! - b.start! || byTitle(a, b));
  let busyEnd: number | null = null;
  times.forEach((it, i) => {
    if (it.ref === "event") {
      const leg = o.travel?.legs.find((l) => l.toId === it.id);
      if (leg) {
        const where = it.place ?? it.where ?? leg.to;
        const soon = leg.leaveBy - o.now >= 0 && leg.leaveBy - o.now <= OPEN_MAP_MS;
        out.push({
          k: "leave", text: legWords(leg, o.tz), tight: leg.tight,
          ...(soon && where ? { button: { label: "Open map" as const, url: directionsLink(where, leg.mode === "walk" ? "walking" : "driving") } } : {}),
        });
      }
    }
    out.push(rowStep(it, labelClock(it.start!, o.tz), o));
    if (it.ref === "event") {
      for (const h of o.travel?.headsUp ?? []) if (h.eventId === it.id) out.push({ k: "sky", kind: h.kind, text: h.text });
    }
    if (busyEvent(it)) busyEnd = Math.max(busyEnd ?? 0, it.end ?? it.start!);
    // Free time ends at the next thing with a time: a busy event, or an open to-do with a time (Dad's 10 pm medicine is not free time).
    const next = times.slice(i + 1).find((x) => busyEvent(x) || (x.ref === "task" && !x.done));
    if (busyEvent(it) && next && busyEnd !== null) {
      // On today, free time that is already over is not news: it counts from now (to the next quarter hour) when that is later.
      const from = Math.max(busyEnd, Math.ceil(o.now / (15 * MIN)) * 15 * MIN);
      const gap = next.start! - from;
      if (gap >= FREE_MIN * MIN) {
        out.push({ k: "free", text: `Free · ${clockOf(from, o.tz)} to ${clockOf(next.start!, o.tz)}, ${lengthWords(gap)}` });
      }
    }
  });

  // 3. To-dos with only a day; 4. done to-dos last.
  for (const it of day.filter((x) => x.ref === "task" && !timed(x) && !x.done).sort(byTitle)) out.push(rowStep(it, "To do", o));
  for (const it of day.filter((x) => x.ref === "task" && x.done).sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || byTitle(a, b))) out.push(rowStep(it, "To do", o, true));
  return out;
}

/** The rows whose follow line still asks for something ("Mom · not done yet", "Mom hasn't said done"): not "Done", "Mom said done". */
export function followOpen(lines: ReadonlyMap<string, string>): Set<string> {
  return new Set([...lines].filter(([, line]) => !/^(?:Done|Not this time|\S+ said done)$/.test(line)).map(([id]) => id));
}

// ------------------------------------------------------------------ the strip, the day, its words

const mondayOf = (key: string): string => shiftDay(key, -((weekdayOf(key) + 6) % 7));

/** The furthest days the strip and the `day` param reach: 8 weeks either way from today's week. */
export function stripRange(today: string): { from: string; to: string } {
  const mon = mondayOf(today);
  return { from: shiftDay(mon, -7 * STRIP_WEEKS), to: shiftDay(mon, 7 * STRIP_WEEKS + 6) };
}

/** The week that holds `day`, Monday to Sunday: a dot on a day with anything still open, a ring on today; prev and next a week away. */
export function stripOf(day: string, today: string, items: readonly DayItem[]): PlanStrip {
  const mon = mondayOf(day);
  const range = stripRange(today);
  const days = Array.from({ length: 7 }, (_, n) => shiftDay(mon, n)).map((key) => ({
    key, wd: WEEKDAYS[weekdayOf(key)]!, n: String(Number(key.slice(8))), busy: items.some((it) => it.day === key && !it.done), today: key === today,
  }));
  // An arrow only to a week the strip reaches (a far day Done just landed on has none: the strip's days take the person back).
  const inRange = (k: string) => mondayOf(k) >= range.from && shiftDay(mondayOf(k), 6) <= range.to;
  const prev = shiftDay(day, -7), next = shiftDay(day, 7);
  return { days, prev: inRange(prev) ? prev : null, next: inRange(next) ? next : null };
}

/**
 * Which day the home opens on: today; tomorrow instead from 5 pm when today has nothing open still to come (no open timed item from
 * 5 minutes ago on, no open to-do, and no item with a follow line), as the simple page's ladder says (planDay.ts nextThing rung 5).
 * Follow lines exist only for today's items, so the home opens on today, not tomorrow, all day otherwise, and in the evening too while
 * one of today's items is still being followed ("Mom · not done yet" on the 9 pm medicine is seen at 9:20 pm). `followed`: the row ids
 * that have a follow line (planFollow.ts followLinesOf).
 */
export function defaultDay(items: readonly DayItem[], now: number, tz: number, followed: ReadonlySet<string> | ReadonlyMap<string, unknown> = new Set()): string {
  const today = new Date(now + tz * MIN).toISOString().slice(0, 10);
  if (minuteOf(now, tz) < EVENING_HOUR * 60) return today;
  const left = items.some((it) => it.day === today && (
    (!it.done && (timed(it) ? it.start! >= now - 5 * MIN : it.ref === "task")) || isFresh(rowIdOf(it), followed)));
  return left ? today : shiftDay(today, 1);
}

/**
 * The home's `day` param: a day within 8 weeks either way; else the old `week` (a number of weeks from today); else null (the default).
 * `made`: a day further away is taken too when Done just made a row on it (PlanEase.day reads them): the home lands on the new item's
 * day, however far ("Passport renewal" in February).
 */
export function dayParam(dayIn: unknown, weekIn: unknown, today: string, made: readonly string[] = []): string | null {
  const range = stripRange(today);
  if (isDayKey(dayIn) && dayIn >= range.from && dayIn <= range.to) return dayIn;
  if (isDayKey(dayIn) && made.includes(dayIn)) return dayIn;
  const w = typeof weekIn === "number" ? weekIn : typeof weekIn === "string" && /^-?\d{1,2}$/.test(weekIn.trim()) ? Number(weekIn) : NaN;
  if (Number.isInteger(w) && w !== 0) return shiftDay(today, 7 * Math.max(-STRIP_WEEKS, Math.min(STRIP_WEEKS, w)));
  return null;
}

/** "Today", "Tomorrow", "Saturday" (and "Saturday" for any other day, whose date says which). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === shiftDay(today, 1)) return "Tomorrow";
  return WEEKDAY_NAMES[weekdayOf(day)]!;
}

/** "Nothing on today", "Nothing on tomorrow", "Nothing on Saturday". */
export const emptyWords = (label: string): string => `Nothing on ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label}`;

/** The day as text for Share: "<time or All day or To do> · <title>[ · where]", one line an item still to do. Null for an empty day. */
export function shareOf(label: string, date: string, steps: readonly ThreadStep[], items: readonly DayItem[]): PlanDayData["share"] {
  const where = new Map(items.map((it) => [rowIdOf(it), it.where ?? ""]));
  const lines = steps.flatMap((s) => (s.k === "row" && !s.row.done ? [[s.label, s.row.title, where.get(s.row.id) ?? ""].filter(Boolean).join(" · ")] : []));
  return lines.length ? { title: `${label} · ${date}`, text: lines.join("\n") } : null;
}

/** One row Done made, as the calendar keeps it (Calendar.keyed). */
export interface KeyedRow {
  kind: "event" | "task"; id: string; title: string; day: string; start: number | null; allDay: boolean; repeat: string; created: number; sourceKey: string;
}

/**
 * After Done (2.4): the rows `make:<key>:0..n-1` made in the last 10 minutes say "Added: Dentist, Fri 13 Nov, 5 pm" ("Added: Swim,
 * every Tue and Thu, 5 pm" for one title on several weekly rows; "Added 2 things to your Plan" for several titles), and are outlined.
 * None found, or too old: nothing.
 */
export function addedOf(rows: readonly KeyedRow[], o: { now: number; tz: number; today: string }): { line: string; fresh: Set<string> } | null {
  const recent = rows.filter((r) => r.created >= o.now - ADDED_MS);
  if (!recent.length) return null;
  const fresh = new Set(recent.map((r) => `${r.kind === "event" ? "e" : "t"}:${r.id}`));
  const titles = [...new Set(recent.map((r) => r.title))];
  if (titles.length > 1) return { line: `Added ${titles.length} things to your Plan`, fresh };
  const first = [...recent].sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999"))[0]!;
  const minute = first.start !== null && !first.allDay ? minuteOf(first.start, o.tz) : null;
  const when = addedWhen({
    day: first.day || null, minute, repeat: first.repeat,
    ...(first.repeat === "weekly" ? { weekdays: recent.filter((r) => r.day).map((r) => weekdayOf(r.day)) } : {}),
  }, o.today);
  return { line: keepClock(`Added: ${first.title}${when ? `, ${when}` : ""}`), fresh };
}

/** "Thu 12 Nov". */
export const dateOf = (day: string): string => longDate(day);

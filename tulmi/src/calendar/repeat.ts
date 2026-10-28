/**
 * TAILZU'S OWN CALENDAR: AN EVENT THAT REPEATS, AND WHEN ITS NEXT REMINDER IS.
 *
 *   occurrences(e, fromMs, toMs)     the starts of an event (repeating or not) that overlap [fromMs, toMs), each with its day
 *   nextReminder(e, afterMs)         when the first reminder after `afterMs` is due, and for which start; null when none is left
 *   taskReminder(t, afterMs)         the same for a to-do (once: at its time, or 9 am on its day, less the minutes before)
 *
 * Times repeat on the person's own clock (the offset the event was made in): daily, on weekdays (Monday to Friday), weekly on its
 * weekday, monthly on its date (a month without that date has none: the 31st skips 30-day months), yearly on its date. A day in
 * `skips` was taken out of the series. An all-day event's reminder is at 9 am on its day (less the minutes before, so "1 day" is
 * 9 am the day before).
 */
import { DAY, MIN, dayOf, shiftDay, startOfDay, weekdayOf, type Repeat } from "./words.js";

export interface Repeating {
  start_ms: number;
  end_ms: number;
  all_day: boolean;
  tz_min: number;
  repeat: Repeat;
  repeat_until: number | null;
  skips: string[];
  remind_min: number | null;
}

/** At most this many starts in one read: a year of a daily event and then some. */
const MAX_STARTS = 400;
const ALL_DAY_REMIND_MINUTE = 9 * 60;

/** The day an event starts on: its date (an all-day event keeps its date whatever the offset), or its local day. */
export const startDay = (e: Pick<Repeating, "start_ms" | "all_day" | "tz_min">): string => (e.all_day ? new Date(e.start_ms).toISOString().slice(0, 10) : dayOf(e.start_ms, e.tz_min));

function addMonths(key: string, n: number): string | null {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const dt = new Date(Date.UTC(ny, nm, d));
  return dt.getUTCMonth() === nm ? dt.toISOString().slice(0, 10) : null;
}

/** The day keys a series starts on, from its first day, in order, while `keep` says so. */
function* seriesDays(first: string, repeat: Repeat): Generator<string> {
  if (!repeat) { yield first; return; }
  if (repeat === "monthly" || repeat === "yearly") {
    for (let i = 0; i < 2400; i += 1) {
      const k = addMonths(first, repeat === "monthly" ? i : i * 12);
      if (k) yield k;
    }
    return;
  }
  const step = repeat === "weekly" ? 7 : 1;
  for (let k = first, i = 0; i < 100_000; k = shiftDay(k, step), i += 1) {
    if (repeat === "weekdays") { const wd = weekdayOf(k); if (wd === 0 || wd === 6) continue; }
    yield k;
  }
}

/** When an occurrence on day `key` starts and ends, in UTC ms. */
function at(e: Repeating, key: string): { start: number; end: number } {
  const len = Math.max(0, e.end_ms - e.start_ms);
  if (e.all_day) { const s = Date.parse(`${key}T00:00:00Z`); return { start: s, end: s + Math.max(DAY, len) }; }
  const offset = e.start_ms - startOfDay(dayOf(e.start_ms, e.tz_min), e.tz_min);
  const s = startOfDay(key, e.tz_min) + offset;
  return { start: s, end: s + len };
}

/** The starts of `e` that overlap [fromMs, toMs): one for a single event, every one in range for a series. */
export function occurrences(e: Repeating, fromMs: number, toMs: number): Array<{ day: string; start: number; end: number }> {
  const out: Array<{ day: string; start: number; end: number }> = [];
  const skips = new Set(e.skips ?? []);
  const first = startDay(e);
  // An all-day event's ms are the date at UTC midnight: widen the window by a day each side and let the caller's day keys decide.
  const lo = e.all_day ? fromMs - DAY : fromMs, hi = e.all_day ? toMs + DAY : toMs;
  for (const key of seriesDays(first, e.repeat)) {
    const o = at(e, key);
    if (o.start >= hi) break;
    if (e.repeat_until !== null && e.repeat_until !== undefined && o.start > e.repeat_until) break;
    if (o.end <= lo || skips.has(key)) continue;
    out.push({ day: key, ...o });
    if (out.length >= MAX_STARTS) break;
  }
  return out;
}

/** When a reminder for an occurrence starting at `start` is due. */
function remindAt(e: Repeating, day: string, start: number): number {
  const before = (e.remind_min ?? 0) * MIN;
  return e.all_day ? startOfDay(day, e.tz_min) + ALL_DAY_REMIND_MINUTE * MIN - before : start - before;
}

/** The first reminder due after `afterMs`, and the start it is for; null when the event has none left (or no reminder). */
export function nextReminder(e: Repeating, afterMs: number): { at: number; start: number; day: string } | null {
  if (e.remind_min === null || e.remind_min === undefined) return null;
  const skips = new Set(e.skips ?? []);
  let n = 0;
  for (const key of seriesDays(startDay(e), e.repeat)) {
    const o = at(e, key);
    if (e.repeat_until !== null && e.repeat_until !== undefined && o.start > e.repeat_until) return null;
    if (n++ > 5000) return null;
    if (skips.has(key)) continue;
    const when = remindAt(e, key, o.start);
    if (when > afterMs) return { at: when, start: o.start, day: key };
  }
  return null;
}

export interface TaskTiming { due_day: string | null; due_ms: number | null; tz_min: number; remind_min: number | null; done: boolean }

/** A to-do's one reminder, when it is still to come: at its time, or 9 am on its day, less the minutes before. */
export function taskReminder(t: TaskTiming, afterMs: number): number | null {
  if (t.done || t.remind_min === null || t.remind_min === undefined || !t.due_day) return null;
  const base = t.due_ms !== null && t.due_ms !== undefined ? Number(t.due_ms) : startOfDay(t.due_day, t.tz_min) + ALL_DAY_REMIND_MINUTE * MIN;
  const when = base - t.remind_min * MIN;
  return when > afterMs ? when : null;
}

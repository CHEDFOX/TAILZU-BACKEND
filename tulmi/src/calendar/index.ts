/**
 * TAILZU'S OWN CALENDAR AND TO-DOS (no Google Calendar, no Google Tasks): what the Plan bot, Today, Tasks, Spaces, meeting notes and
 * every bot given "calendar" or "tasks" read and write. docs/bots-app.md, "The calendar".
 *
 *   words.ts     days, times and a line of words ("Dentist Fri 5 pm") in the person's own time; India-first ("kal", "5 baje")
 *   repeat.ts    a repeating event's starts, and when a reminder is due
 *   store.ts     the two tables (migration 0054), in memory or Supabase
 *   service.ts   Calendar: list, add, change, remove, tick, quick add, what spaces land, the reminders
 *   bots.ts      "calendar" and "tasks" as apps every bot can be given (withOwnDays over bots/ports.ts)
 *
 *   startReminders(calendar, send)   every minute: the reminders that are due, through the push engine ("plan_reminder")
 *   todayForShell / upcomingForShell the shapes Today and Tasks already draw (routes/botsShell.ts)
 */
import type { Calendar, ReminderSend } from "./service.js";
import { clockAt, dayName, dayOf, hhmm, minuteOf, shiftDay } from "./words.js";

export { Calendar, calendar, resetCalendarForTests, DEFAULT_REMIND_MIN, type CalEvent, type CalTask, type Listed, type SpaceItem, type SpaceAnswer, type ReminderSend } from "./service.js";
export { withOwnDays, ownAppOf, runOwnTool, OWN_APPS } from "./bots.js";
export { calendarRows, memoryCalendarRows, type Source, type EventRow, type TaskRow, type CalendarRows } from "./store.js";
export { readLine, timeOf, dayFrom, dayOf, startOfDay, shiftDay, dayWords, dayName, clockAt, hhmm, isDayKey, tzOf, REPEATS, type Repeat } from "./words.js";

const TICK_MS = 60_000;

/** Every minute, the reminders that are due. Returns the stop. */
export function startReminders(cal: Calendar, send: ReminderSend, log?: { warn: (o: object, m: string) => void }): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await cal.remind(send); } catch (err) { log?.warn({ err: (err as Error)?.message }, "calendar: reminders"); } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Today's events as Today draws them (shell/parse.ts CalEvent): minutes after midnight, the place as its second line. */
export async function todayForShell(cal: Calendar, userId: string, now: number, tz: number): Promise<{ connected: true; events: Array<{ start: number | null; end: number | null; title: string; with?: string; when: string }> | null }> {
  const today = dayOf(now, tz);
  try {
    const r = await cal.list(userId, { from: today, to: today, tz });
    return {
      connected: true,
      events: r.events.map((e) => {
        if (e.allDay) return { start: null, end: null, title: e.title, ...(e.where ? { with: e.where } : {}), when: "All day" };
        const s = e.start < Date.parse(`${today}T00:00:00Z`) - tz * 60_000 ? 0 : minuteOf(e.start, tz);
        const endsLater = dayOf(e.end - 1, tz) > today;
        const en = endsLater ? 24 * 60 : minuteOf(e.end, tz);
        return { start: s, end: Math.max(s + 15, en), title: e.title, ...(e.where || e.from ? { with: [e.from ? `From ${e.from}` : "", e.where ?? ""].filter(Boolean).join(" · ") } : {}), when: `${hhmm(s)}–${hhmm(Math.min(en, 24 * 60 - 1))}` };
      }),
    };
  } catch { return { connected: true, events: null }; }
}

/** Open to-dos for the coming week, the overdue and those with no day, as Tasks' Upcoming draws them. */
export async function upcomingForShell(cal: Calendar, userId: string, now: number, tz: number): Promise<{ connected: true; todos: Array<{ id: string; title: string; due?: string; overdue?: boolean; notes?: string }> | null }> {
  const today = dayOf(now, tz), end = shiftDay(today, 7);
  try {
    const open = (await cal.openTasks(userId)).filter((t) => !t.due || t.due <= end);
    return {
      connected: true,
      todos: open.map((t) => ({
        id: t.id, title: t.title,
        ...(t.due ? { due: `${dayName(t.due, today)}${t.at !== null ? `, ${clockAt(t.at, tz)}` : ""}` } : {}),
        ...(t.due && t.due < today ? { overdue: true } : {}),
        ...(t.from || t.notes ? { notes: [t.from ? `From ${t.from}` : "", t.notes.split("\n")[0] ?? ""].filter(Boolean).join(" · ").slice(0, 120) } : {}),
      })),
    };
  } catch { return { connected: true, todos: null }; }
}

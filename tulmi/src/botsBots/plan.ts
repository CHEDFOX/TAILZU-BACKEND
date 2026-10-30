/**
 * THE PLAN BOT'S DAYS: tomorrow and the week from the person's own calendar and to-dos in Tailzu (src/calendar: no outside calendar to
 * connect), and the one thing it would change (a clash, or no room between two things), which waits for their yes.
 *
 *   read(user, { tz, week })        the week's days with their events and to-dos (done ones too), the open to-dos with no day, tomorrow's
 *                                   key, and the suggestion (or none)
 *   move(user, eventId, startIso)   the suggestion, said yes to: the event moves on their calendar; the tap on "Move it" is the yes
 *   skip(user, key)                 "Keep it": that suggestion is not made again
 *   home(user, words)               where the person's day starts, for travel times from home (planTravel.ts)
 *
 * With places set up (src/places), the read also has tomorrow's travel: the time between stops, when to leave, gaps too short to make,
 * rain or heat on an outdoor stop, and the minutes a move saves (planTravel.ts). The suggestion then counts a gap as too short when it
 * is shorter than the trip between the two places (plus ten minutes), and picks, of the free slots, the one that saves the most travel.
 * Its writes come over HTTP, which live/writes.ts publishes ("bot:plan"); the calendar publishes its own changes ("calendar", "tasks",
 * "bot:plan"); lookups that finish later publish from planTravel.ts.
 *
 * What other people put on the person's days (a space's tasks and plans) is on their calendar already, "From <name>" (spaceTasks.ts lands
 * it): the suggestion never moves it (it is theirs to change), but travel times count it as a stop.
 * Times are in the person's day (the app's tz offset), the same as everywhere else in the app.
 */
import { BotError } from "../bots/index.js";
import { calendar as ownCalendar, type Calendar, type CalEvent, type CalTask } from "../calendar/index.js";
import type { PlanTravel, PlanTravelling } from "./planTravel.js";
import { table, type Table } from "./rows.js";

/**
 * `where` is the location's first part, to show ("Indiranagar"); `place` is the whole location, to find on a map. `from` says who put it
 * there when not the person ("Meera S.", "Plan Ease"); a `fixed` one is someone else's to change.
 */
export interface PlanEvent {
  id: string; title: string; start: number; end: number; allDay: boolean; where?: string; place?: string; people: number;
  from?: string; fixed?: boolean; repeat?: string; spaceId?: string; taskId?: string;
}
export interface PlanTask {
  id: string; title: string; due: string;
  /** When it's due, when a time was said. */
  at?: number | null;
  done?: boolean; from?: string; fixed?: boolean; spaceId?: string; taskId?: string; noteId?: string;
}
export interface PlanDay { key: string; events: PlanEvent[]; tasks: PlanTask[] }
export interface Suggestion {
  key: string;
  eventId: string;
  title: string;
  question: string;
  detail: string;
  /** The new start, ISO with the person's offset. */
  startIso: string;
  /** "Thursday": the day it is on now ("Keep Thursday"). */
  fromDay: string;
  /** "Fri 10 am": where it would go. */
  toWords: string;
  /** Travel minutes the move saves against the person's own order (planTravel.ts), when every leg is known and it is 5 or more. */
  savedMin?: number;
}

/** What the suggestion may ask about travel (planTravel.ts gives it; undefined is "not known"). */
export interface TravelCtx {
  /** Minutes from a's place to b's, when both have one and the trip is known. */
  between(a: PlanEvent, b: PlanEvent): number | undefined;
  /** A day's travel: its stops in time order, from home and back. */
  dayCost(events: PlanEvent[]): number | undefined;
}
export interface PlanRead {
  connected: { calendar: boolean; tasks: boolean };
  tomorrow: string;
  today: string;
  /** The week shown, Monday first. */
  week: string[];
  days: PlanDay[];
  suggestion: Suggestion | null;
  /** A read that failed, in plain words (the other still shows). */
  trouble?: string;
  /** Tomorrow's travel, when places are set up on this server. */
  travel?: PlanTravel;
  /** Open to-dos with no day. */
  open?: PlanTask[];
}

export interface PlanReader {
  connected(userId: string): Promise<{ calendar: boolean; tasks: boolean }>;
  events(userId: string, fromMs: number, toMs: number, tz: number): Promise<PlanEvent[]>;
  tasks(userId: string, fromKey: string, toKey: string, tz: number): Promise<PlanTask[]>;
  /** The open to-dos with no day. */
  open?(userId: string): Promise<PlanTask[]>;
  /** Moves one of its events (the suggestion, said yes to). */
  move?(userId: string, eventId: string, startMs: number): Promise<void>;
}

export interface PlanSkipRow { [k: string]: unknown; user_id: string; key: string; at_ms: number }

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ------------------------------------------------------------------ days and times, in the person's offset

/** "2026-10-29": the day `ms` falls on for someone `tz` minutes east of UTC. */
export const dayOf = (ms: number, tz: number): string => new Date(ms + tz * MIN).toISOString().slice(0, 10);
/** When that day starts, in UTC ms. */
export const startOfDay = (key: string, tz: number): number => Date.parse(`${key}T00:00:00Z`) - tz * MIN;
const local = (ms: number, tz: number): Date => new Date(ms + tz * MIN);

/** "9:30 am", "6 pm". */
export function clock(ms: number, tz: number): string {
  const d = local(ms, tz);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}
/** "Thu 29 Oct". */
export function dayWords(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export const weekdayLong = (key: string): string => WEEKDAYS_LONG[new Date(`${key}T00:00:00Z`).getUTCDay()]!;
export const shiftDay = (key: string, n: number): string => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** The Monday of the week `key` is in. */
export function mondayOf(key: string): string {
  const wd = new Date(`${key}T00:00:00Z`).getUTCDay();
  return shiftDay(key, -((wd + 6) % 7));
}
/** ISO with the person's offset: "2026-10-30T10:00:00+05:30". */
export function isoAt(ms: number, tz: number): string {
  const d = local(ms, tz).toISOString().slice(0, 19);
  const sign = tz >= 0 ? "+" : "-";
  const a = Math.abs(tz);
  return `${d}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ the suggestion

const ROOM_MIN = 30;

/** The first free slot of `len` on each of the three days after `day` (not Sunday), 10 am to 6 pm on the half hour, clear of everything by 15 minutes. */
function freeSlots(events: PlanEvent[], day: string, len: number, tz: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const k = shiftDay(day, i);
    const wd = new Date(`${k}T00:00:00Z`).getUTCDay();
    if (wd === 0) continue;
    const busy = events.filter((e) => !e.allDay && dayOf(e.start, tz) === k);
    for (let t = startOfDay(k, tz) + 10 * HOUR; t + len <= startOfDay(k, tz) + 18 * HOUR; t += 30 * MIN) {
      if (busy.every((e) => t + len + 15 * MIN <= e.start || t >= e.end + 15 * MIN)) { out.push(t); break; }
    }
  }
  return out;
}

/** Of the slots, the one that saves the most travel, and how much; the first slot (no number) when that can't be known. */
function bestSlot(events: PlanEvent[], move: PlanEvent, tomorrow: string, slots: number[], tz: number, travel?: TravelCtx): { slot: number; saved?: number } {
  const first = { slot: slots[0]! };
  if (!travel) return first;
  const on = (k: string, without: PlanEvent) => events.filter((e) => !e.allDay && e.id !== without.id && dayOf(e.start, tz) === k);
  const today = events.filter((e) => !e.allDay && dayOf(e.start, tz) === tomorrow);
  const was = travel.dayCost(today), left = travel.dayCost(on(tomorrow, move));
  // Every slot is costed even while the day's own cost is unknown, so the lookups they need are all asked for at once.
  const costs = slots.map((slot) => {
    const there = on(dayOf(slot, tz), move);
    const before = travel.dayCost(there), after = travel.dayCost([...there, { ...move, start: slot, end: slot + (move.end - move.start) }]);
    return before === undefined || after === undefined ? undefined : after - before;
  });
  if (was === undefined || left === undefined) return first;
  let best: { slot: number; saved: number } | null = null;
  slots.forEach((slot, i) => {
    const added = costs[i];
    if (added === undefined) return;
    const saved = (was - left) - added;
    if (!best || saved > best.saved) best = { slot, saved };
  });
  return best ?? first;
}

/**
 * Tomorrow's first clash, or two things with less than half an hour between them: move the one with fewer people in it to the first free
 * slot in the next three days. Null when tomorrow is fine, or every such suggestion was kept as it was.
 */
export function suggestionFor(events: PlanEvent[], tomorrow: string, tz: number, skipped: ReadonlySet<string>, travel?: TravelCtx): Suggestion | null {
  const day = events.filter((e) => !e.allDay && dayOf(e.start, tz) === tomorrow).sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < day.length; i += 1) {
    const a = day[i]!, b = day[i + 1]!;
    const gap = (b.start - a.end) / MIN;
    const trip = gap >= 0 ? travel?.between(a, b) : undefined;
    if (gap >= (trip ? trip + 10 : ROOM_MIN)) continue;
    // Someone else's plan is theirs to change: the other one moves, and two of theirs are left alone.
    if (a.fixed && b.fixed) continue;
    const move = a.fixed ? b : b.fixed ? a : a.people > 0 && b.people === 0 ? b : a;
    const other = move === a ? b : a;
    const key = `move:${move.id}:${move.start}`;
    if (skipped.has(key)) continue;
    const slots = freeSlots(events, tomorrow, move.end - move.start, tz);
    if (!slots.length) continue;
    const { slot, saved } = bestSlot(events, move, tomorrow, slots, tz, travel);
    const to = `${dayWords(dayOf(slot, tz)).split(" ")[0]} ${clock(slot, tz)}`;
    const name = (e: PlanEvent) => e.title.split(" · ")[0]!.trim() || e.title;
    const at = (e: PlanEvent) => (trip && e.where ? ` in ${e.where}` : "");
    const why = gap < 0
      ? `${name(move)} runs into ${name(other)} at ${clock(Math.max(a.start, b.start), tz)}.`
      : trip
        ? `${name(a)} ends at ${clock(a.end, tz)}${at(a)} and ${name(b)} starts at ${clock(b.start, tz)}${at(b)}, ${trip} min away.`
        : `${name(a)} ends at ${clock(a.end, tz)} and ${name(b)} starts at ${clock(b.start, tz)}${gap > 0 ? `, ${Math.round(gap)} min later` : ""}.`;
    const toDay = weekdayLong(dayOf(slot, tz));
    const savedWords = saved !== undefined && saved >= 5 ? ` It saves about ${saved} min of travel.` : saved !== undefined && saved <= -5 ? ` It adds about ${-saved} min of travel on ${toDay}.` : "";
    return {
      key, eventId: move.id, title: move.title, question: `Move ${name(move)} to ${toDay} ${clock(slot, tz)}?`,
      detail: `${why} ${toDay} ${clock(slot, tz)} is free.${savedWords} I'll move it only after you say yes.`,
      startIso: isoAt(slot, tz), fromDay: weekdayLong(tomorrow), toWords: to, ...(saved !== undefined && saved >= 5 ? { savedMin: saved } : {}),
    };
  }
  return null;
}

// ------------------------------------------------------------------ reading the person's own calendar

const planEvent = (e: CalEvent): PlanEvent => ({
  id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, ...(e.where ? { where: e.where } : {}), ...(e.place && e.place !== e.where ? { place: e.place } : {}),
  people: 0, ...(e.from ? { from: e.from } : {}), ...(e.fixed ? { fixed: true } : {}), ...(e.repeat ? { repeat: e.repeat } : {}),
  ...(e.spaceId ? { spaceId: e.spaceId, taskId: e.taskId } : {}),
});
const planTask = (t: CalTask): PlanTask => ({
  id: t.id, title: t.title, due: t.due ?? "", at: t.at, done: t.done, ...(t.from ? { from: t.from } : {}), ...(t.fixed ? { fixed: true } : {}),
  ...(t.spaceId ? { spaceId: t.spaceId, taskId: t.taskId } : {}), ...(t.noteId ? { noteId: t.noteId } : {}),
});

/** The reader over Tailzu's own calendar and to-dos (src/calendar): always there, nothing to connect. */
export function calendarPlanReader(cal: Calendar = ownCalendar()): PlanReader {
  return {
    async connected() { return { calendar: true, tasks: true }; },
    async events(userId, fromMs, toMs, tz) {
      const r = await cal.list(userId, { from: dayOf(fromMs, tz), to: dayOf(toMs - 1, tz), tz });
      return r.events.filter((e) => e.end > fromMs && e.start < toMs).map(planEvent);
    },
    async tasks(userId, fromKey, toKey, tz) {
      return (await cal.list(userId, { from: fromKey, to: toKey, tz })).tasks.map(planTask);
    },
    async open(userId) {
      return (await cal.openTasks(userId)).filter((t) => !t.due).map(planTask);
    },
    async move(userId, eventId, startMs) { await cal.moveEvent(userId, eventId, startMs); },
  };
}

// ------------------------------------------------------------------ the service

export class PlanDays {
  private readonly reader: PlanReader;

  constructor(
    reader: PlanReader | null,
    /** Moves an event when the reader can't (tests); the calendar's own move otherwise. */
    private readonly mover: ((userId: string, eventId: string, startMs: number) => Promise<void>) | null = null,
    private readonly now: () => number = Date.now,
    private readonly skips: Table<PlanSkipRow> = table<PlanSkipRow>("plan_skips"),
    private readonly travel: PlanTravelling | null = null,
  ) {
    this.reader = reader ?? calendarPlanReader();
  }

  async read(userId: string, o: { tz: number; week?: number }): Promise<PlanRead> {
    const tz = Math.max(-720, Math.min(840, Math.round(o.tz) || 0));
    const today = dayOf(this.now(), tz);
    const tomorrow = shiftDay(today, 1);
    const monday = shiftDay(mondayOf(today), 7 * Math.max(-8, Math.min(8, Math.round(o.week ?? 0))));
    const keys = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
    const connected = await this.reader.connected(userId);
    const from = keys[0]! < tomorrow ? keys[0]! : tomorrow;
    const to = shiftDay(keys[6]! > tomorrow ? keys[6]! : tomorrow, 4);
    let events: PlanEvent[] = [];
    let tasks: PlanTask[] = [];
    let open: PlanTask[] = [];
    const trouble: string[] = [];
    if (connected.calendar) {
      try { events = await this.reader.events(userId, startOfDay(from, tz), startOfDay(shiftDay(to, 1), tz), tz); } catch { trouble.push("Couldn't read your calendar just now."); }
    }
    if (connected.tasks) {
      try { tasks = await this.reader.tasks(userId, from, to, tz); } catch { trouble.push("Couldn't read your to-dos just now."); }
      if (this.reader.open) open = await this.reader.open(userId).catch(() => []);
    }
    const show = new Set([...keys, tomorrow]);
    const days = [...show].sort().map((key) => ({
      key, events: events.filter((e) => dayOf(e.start, tz) === key).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start),
      tasks: tasks.filter((t) => t.due === key),
    }));
    const skipped = new Set((await this.skips.select({ user_id: userId }, { limit: 500 })).map((s) => s.key));
    let suggestion = connected.calendar ? suggestionFor(events, tomorrow, tz, skipped) : null;
    let travel: PlanTravel | undefined;
    if (this.travel && connected.calendar) {
      const r = await this.travel.plan(userId, { tz, events, tomorrow, suggest: (ctx) => suggestionFor(events, tomorrow, tz, skipped, ctx) }).catch(() => null);
      if (r) { suggestion = r.suggestion; travel = r.travel; }
    }
    return {
      connected, today, tomorrow, week: keys, days, suggestion, ...(trouble.length ? { trouble: trouble[0] } : {}), ...(travel ? { travel } : {}),
      ...(open.length ? { open } : {}),
    };
  }

  /** Where the person's day starts ("" forgets it). */
  async home(userId: string, words: unknown): Promise<string> {
    if (!this.travel) throw new BotError("places_off", "Travel times aren't switched on here.", 503);
    if (words !== undefined && typeof words !== "string") throw new BotError("bad_request", "home is where your day starts.");
    return this.travel.setHome(userId, words ?? "");
  }

  async move(userId: string, eventId: unknown, startIso: unknown, _said?: unknown): Promise<{ done: boolean; message: string }> {
    if (typeof eventId !== "string" || !eventId || eventId.length > 200) throw new BotError("bad_request", "eventId is the calendar event's id.");
    if (typeof startIso !== "string" || !Number.isFinite(Date.parse(startIso))) throw new BotError("bad_request", "start is when it moves to.");
    const move = this.mover ?? (this.reader.move ? this.reader.move.bind(this.reader) : null);
    if (!move) return { done: false, message: "Couldn't move it. Try again." };
    try {
      await move(userId, eventId, Date.parse(startIso));
    } catch (e) {
      return { done: false, message: (e as Error)?.message || "Couldn't move it. Try again." };
    }
    await this.travel?.moved(userId, eventId, startIso).catch(() => undefined);
    return { done: true, message: "Moved." };
  }

  async skip(userId: string, key: unknown): Promise<void> {
    if (typeof key !== "string" || !key || key.length > 300) throw new BotError("bad_request", "key is the suggestion's key.");
    await this.skips.upsert({ user_id: userId, key, at_ms: this.now() }, ["user_id", "key"]);
  }
}

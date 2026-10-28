/**
 * THE PLAN BOT'S DAYS: tomorrow and the week from the person's connected Google Calendar and Google Tasks, and the one thing it would
 * change (a clash, or no room between two things), which waits for their yes.
 *
 *   read(user, { tz, week })        the week's days with their events and tasks, tomorrow's key, and the suggestion (or none)
 *   move(user, eventId, startIso)   the suggestion, said yes to: the calendar's move_event through the connected-app tasks (connectors/tasks.ts:
 *                                   the same permission tiers, audit and card); the person's tap on "Move it" is their yes to that one change
 *   skip(user, key)                 "Keep it": that suggestion is not made again
 *
 * Reads go to Google with the person's own connection (connectors/google/oauth.ts GoogleSession); nothing is written but the one move.
 * Times are in the person's day (the app's tz offset), the same as everywhere else in the app.
 */
import { randomUUID } from "node:crypto";
import type { Connectors } from "../connectors/index.js";
import { GoogleSession } from "../connectors/google/oauth.js";
import { BotError } from "../bots/index.js";
import { table, type Table } from "./rows.js";

export interface PlanEvent { id: string; title: string; start: number; end: number; allDay: boolean; where?: string; people: number }
export interface PlanTask { id: string; title: string; due: string }
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
}

export interface PlanReader {
  connected(userId: string): Promise<{ calendar: boolean; tasks: boolean }>;
  events(userId: string, fromMs: number, toMs: number, tz: number): Promise<PlanEvent[]>;
  tasks(userId: string, fromKey: string, toKey: string): Promise<PlanTask[]>;
}

export interface PlanSkipRow { [k: string]: unknown; user_id: string; key: string; at_ms: number }

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const CAL = "google-calendar", TASKS = "google-tasks";
const CAL_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TASKS_URL = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";
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

/** A free slot of `len` on one of the three days after `day`, 10 am to 6 pm on the half hour, clear of everything by 15 minutes. */
function freeSlot(events: PlanEvent[], day: string, len: number, tz: number): number | null {
  for (let i = 1; i <= 3; i += 1) {
    const k = shiftDay(day, i);
    const wd = new Date(`${k}T00:00:00Z`).getUTCDay();
    if (wd === 0) continue;
    const busy = events.filter((e) => !e.allDay && dayOf(e.start, tz) === k);
    for (let t = startOfDay(k, tz) + 10 * HOUR; t + len <= startOfDay(k, tz) + 18 * HOUR; t += 30 * MIN) {
      if (busy.every((e) => t + len + 15 * MIN <= e.start || t >= e.end + 15 * MIN)) return t;
    }
  }
  return null;
}

/**
 * Tomorrow's first clash, or two things with less than half an hour between them: move the one with fewer people in it to the first free
 * slot in the next three days. Null when tomorrow is fine, or every such suggestion was kept as it was.
 */
export function suggestionFor(events: PlanEvent[], tomorrow: string, tz: number, skipped: ReadonlySet<string>): Suggestion | null {
  const day = events.filter((e) => !e.allDay && dayOf(e.start, tz) === tomorrow).sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < day.length; i += 1) {
    const a = day[i]!, b = day[i + 1]!;
    const gap = (b.start - a.end) / MIN;
    if (gap >= ROOM_MIN) continue;
    const move = a.people > 0 && b.people === 0 ? b : a;
    const other = move === a ? b : a;
    const key = `move:${move.id}:${move.start}`;
    if (skipped.has(key)) continue;
    const slot = freeSlot(events, tomorrow, move.end - move.start, tz);
    if (slot === null) continue;
    const to = `${dayWords(dayOf(slot, tz)).split(" ")[0]} ${clock(slot, tz)}`;
    const name = (e: PlanEvent) => e.title.split(" · ")[0]!.trim() || e.title;
    const why = gap < 0
      ? `${name(move)} runs into ${name(other)} at ${clock(Math.max(a.start, b.start), tz)}.`
      : `${name(a)} ends at ${clock(a.end, tz)} and ${name(b)} starts at ${clock(b.start, tz)}${gap > 0 ? `, ${Math.round(gap)} min later` : ""}.`;
    return {
      key, eventId: move.id, title: move.title, question: `Move ${name(move)} to ${weekdayLong(dayOf(slot, tz))} ${clock(slot, tz)}?`,
      detail: `${why} ${weekdayLong(dayOf(slot, tz))} ${clock(slot, tz)} is free. I'll move it only after you say yes.`,
      startIso: isoAt(slot, tz), fromDay: weekdayLong(tomorrow), toWords: to,
    };
  }
  return null;
}

// ------------------------------------------------------------------ reading Google

interface GTime { dateTime?: string; date?: string }
interface GEvent { id?: string; summary?: string; status?: string; start?: GTime; end?: GTime; location?: string; transparency?: string; attendees?: Array<{ self?: boolean; resource?: boolean }> }

const oneLine = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function eventOf(e: GEvent, tz: number): PlanEvent | null {
  if (!e.id || e.status === "cancelled") return null;
  const allDay = !!e.start?.date && !e.start?.dateTime;
  const start = allDay ? startOfDay(e.start!.date!, tz) : Date.parse(e.start?.dateTime ?? "");
  const end = allDay ? startOfDay(e.end?.date ?? e.start!.date!, tz) : Date.parse(e.end?.dateTime ?? "");
  if (!Number.isFinite(start)) return null;
  const where = oneLine(e.location, 60).split(",")[0]?.trim();
  return {
    id: e.id, title: oneLine(e.summary, 80) || "Busy", start, end: Number.isFinite(end) && end > start ? end : start + 30 * MIN, allDay,
    ...(where ? { where } : {}), people: (e.attendees ?? []).filter((a) => !a.self && !a.resource).length,
  };
}

/** The reader over the person's own Google connection. */
export function googlePlanReader(c: Pick<Connectors, "store" | "google">): PlanReader {
  const session = new GoogleSession({ store: c.store, google: c.google });
  const has = async (userId: string, id: string) => !!(await c.store.getConnection(userId, id).catch(() => null))?.tokensEnc;
  return {
    async connected(userId) {
      const [calendar, tasks] = await Promise.all([has(userId, CAL), has(userId, TASKS)]);
      return { calendar, tasks };
    },
    async events(userId, fromMs, toMs, tz) {
      const q = new URLSearchParams({
        singleEvents: "true", orderBy: "startTime", maxResults: "150", timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(),
        fields: "items(id,summary,status,start,end,location,transparency,attendees(self,resource))",
      });
      const r = await session.json<{ items?: GEvent[] }>(userId, CAL, "Google Calendar", `${CAL_URL}?${q}`);
      return (r.items ?? []).filter((e) => e.transparency !== "transparent").map((e) => eventOf(e, tz)).filter((e): e is PlanEvent => !!e);
    },
    async tasks(userId, fromKey, toKey) {
      const q = new URLSearchParams({ showCompleted: "false", maxResults: "100", dueMin: `${fromKey}T00:00:00.000Z`, dueMax: `${shiftDay(toKey, 1)}T00:00:00.000Z` });
      const r = await session.json<{ items?: Array<{ id?: string; title?: string; due?: string; status?: string }> }>(userId, TASKS, "Google Tasks", `${TASKS_URL}?${q}`);
      return (r.items ?? []).filter((t) => t.id && t.due && t.status !== "completed" && oneLine(t.title, 80))
        .map((t) => ({ id: t.id!, title: oneLine(t.title, 80), due: t.due!.slice(0, 10) }));
    },
  };
}

// ------------------------------------------------------------------ the service

export class PlanDays {
  constructor(
    private readonly reader: PlanReader | null,
    private readonly connectors: Pick<Connectors, "tasks"> | null,
    private readonly now: () => number = Date.now,
    private readonly skips: Table<PlanSkipRow> = table<PlanSkipRow>("plan_skips"),
  ) {}

  async read(userId: string, o: { tz: number; week?: number }): Promise<PlanRead> {
    const tz = Math.max(-720, Math.min(840, Math.round(o.tz) || 0));
    const today = dayOf(this.now(), tz);
    const tomorrow = shiftDay(today, 1);
    const monday = shiftDay(mondayOf(today), 7 * Math.max(-8, Math.min(8, Math.round(o.week ?? 0))));
    const keys = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
    const empty: PlanRead = { connected: { calendar: false, tasks: false }, today, tomorrow, week: keys, days: keys.map((key) => ({ key, events: [], tasks: [] })), suggestion: null };
    if (!this.reader) return empty;
    const connected = await this.reader.connected(userId);
    const from = keys[0]! < tomorrow ? keys[0]! : tomorrow;
    const to = shiftDay(keys[6]! > tomorrow ? keys[6]! : tomorrow, 4);
    let events: PlanEvent[] = [];
    let tasks: PlanTask[] = [];
    const trouble: string[] = [];
    if (connected.calendar) {
      try { events = await this.reader.events(userId, startOfDay(from, tz), startOfDay(shiftDay(to, 1), tz), tz); } catch (e) { trouble.push((e as Error).message || "Google Calendar didn't answer."); }
    }
    if (connected.tasks) {
      try { tasks = await this.reader.tasks(userId, from, to); } catch (e) { trouble.push((e as Error).message || "Google Tasks didn't answer."); }
    }
    const show = new Set([...keys, tomorrow]);
    const days = [...show].sort().map((key) => ({
      key, events: events.filter((e) => dayOf(e.start, tz) === key).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start),
      tasks: tasks.filter((t) => t.due === key),
    }));
    const skipped = new Set((await this.skips.select({ user_id: userId }, { limit: 500 })).map((s) => s.key));
    return { connected, today, tomorrow, week: keys, days, suggestion: connected.calendar ? suggestionFor(events, tomorrow, tz, skipped) : null, ...(trouble.length ? { trouble: trouble[0] } : {}) };
  }

  async move(userId: string, eventId: unknown, startIso: unknown, said: unknown): Promise<{ done: boolean; message: string }> {
    if (!this.connectors) throw new BotError("connectors_off", "Connected apps aren't switched on here.", 503);
    if (typeof eventId !== "string" || !eventId || eventId.length > 200) throw new BotError("bad_request", "eventId is the calendar event's id.");
    if (typeof startIso !== "string" || !Number.isFinite(Date.parse(startIso))) throw new BotError("bad_request", "start is when it moves to.");
    const runId = randomUUID();
    const words = typeof said === "string" && said.trim() ? said.trim().slice(0, 200) : "Move this event";
    const out = await this.connectors.tasks.use(userId, runId, words, { connector: CAL, tool: "move_event", args: { event_id: eventId, start: startIso } }, { allowWrite: true });
    try {
      if (out.kind === "result") return { done: true, message: "Moved." };
      if (out.kind === "approval") {
        // The card the person pressed said exactly this change; their tap is the yes.
        const r = await this.connectors.tasks.approve(userId, out.taskId);
        if (r.status === "ok") return { done: true, message: "Moved." };
        return { done: false, message: r.error?.message ?? "Couldn't move it. Try again." };
      }
      if (out.kind === "stopped") return { done: false, message: out.message };
      return { done: false, message: "Couldn't move it. Try again." };
    } finally {
      await this.connectors.tasks.settle(userId, runId, "done").catch(() => undefined);
    }
  }

  async skip(userId: string, key: unknown): Promise<void> {
    if (typeof key !== "string" || !key || key.length > 300) throw new BotError("bad_request", "key is the suggestion's key.");
    await this.skips.upsert({ user_id: userId, key, at_ms: this.now() }, ["user_id", "key"]);
  }
}

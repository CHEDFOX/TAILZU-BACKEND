/**
 * TAILZU'S OWN CALENDAR AND TO-DOS: EACH PERSON'S EVENTS AND TASKS, KEPT BY TAILZU (no outside calendar).
 *
 *   list(user, { from, to, tz })          the days' events (a series' starts as their own) and to-dos, and the open ones with no day
 *   event(user, id) / task(user, id)      one, as the screens show it ("<id>@<day>" is one start of a series)
 *   addEvent / changeEvent / removeEvent / moveEvent      { title, day, time, endTime | minutes, allDay, place, notes, repeat, until, remind, tz }
 *   addTask / changeTask / tickTask / removeTask          { title, notes, day, time, list, remind, tz }
 *   quick(user, words, { day, tz, kind })  a line ("Dentist Fri 5 pm") made into an event or a to-do (words.ts readLine)
 *   landSpace(user, item) / unlandSpace(taskId, user?)    a space's task or plan for this person, kept on their days "From <name>"
 *   remind(now, send)                     every reminder that is due, sent once (the push engine), and the next one worked out
 *
 * `source` says where a thing came from: the person, a bot ("Plan bot"), someone in a space, a meeting's to-do. Someone else's plan
 * or task is theirs to change: here it can be ticked, or said no to ("Can't do it", through the space), and nothing else.
 * Every change tells the person's open screens (live "calendar", "tasks", "bot:plan").
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/types.js";
import { livePublish } from "../live/writes.js";
import { botTopic, TOPIC } from "../live/topics.js";
import { nextReminder, occurrences, startDay, taskReminder } from "./repeat.js";
import { calendarRows, eventRow, resetCalendarRowsForTests, taskRow, type CalendarRows, type EventRow, type Source, type TaskRow } from "./store.js";
import {
  DAY, MIN, REPEATS, clockAt, dayFrom, dayName, dayOf, isDayKey, minuteOf, readLine, shiftDay, startOfDay, timeOf, tzOf, type Repeat,
} from "./words.js";

export interface CalEvent {
  /** The row's id, or "<id>@<day>" for one start of a series. */
  id: string;
  seriesId: string;
  title: string; notes: string; place: string;
  /** The place's first part, to show ("Indiranagar"). */
  where?: string;
  start: number; end: number; allDay: boolean;
  /** The day it is on, in the person's time. */
  day: string;
  repeat: Repeat;
  remindMin: number | null;
  /** Who put it there, when not the person: "Meera S.", "Plan bot", a meeting's title. */
  from: string | null;
  source: Source["kind"];
  /** Someone else's: only they change it. */
  fixed: boolean;
  spaceId?: string; taskId?: string; spaceName?: string;
}

export interface CalTask {
  id: string; title: string; notes: string; list: string;
  /** The day it's due, or null. */
  due: string | null;
  /** When it's due, when a time was said. */
  at: number | null;
  done: boolean; doneAt: number | null;
  remindMin: number | null;
  from: string | null;
  source: Source["kind"];
  fixed: boolean;
  spaceId?: string; taskId?: string; spaceName?: string;
  noteId?: string; todoId?: string;
}

export interface Listed { events: CalEvent[]; tasks: CalTask[]; open: CalTask[] }

export type ReminderSend = (userId: string, msg: { kind: "plan_reminder"; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;
/** A space's task, answered from the person's own list (their tick, or a no): spaceTasks.ts answer, wired by routes/botsSpaces.ts. */
export type SpaceAnswer = (userId: string, spaceId: string, taskId: string, status: "done" | "todo" | "cant") => Promise<unknown>;

/** What a space hands over for one person it's for (spaceTasks.ts). */
export interface SpaceItem {
  taskId: string; spaceId: string; spaceName: string; kind: "task" | "plan";
  title: string; notes: string; place: string;
  at: number | null; end: number | null; allDay: boolean;
  /** Who set it, and how they are shown ("You" when it is the person's own). */
  by: string; name: string;
  done: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_MAX = 400;
const OPEN_MAX = 200;
const ROWS_MAX = 5000;
/** A timed event's reminder when none was said; an all-day one and a to-do have none unless asked. */
export const DEFAULT_REMIND_MIN = 15;
const REMIND_MAX = 7 * 24 * 60;
/** A reminder this late (the server was down) is not sent: the moment has passed. */
const LATE_MS = 6 * 60 * MIN;

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const longText = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "");
const whereOf = (place: string): string | undefined => place.split(",")[0]?.trim() || undefined;
const bad = (message: string) => new BotError("bad_request", message);
const gone = (what: "event" | "task") => new BotError("not_found", what === "event" ? "That isn't on your calendar any more." : "That to-do isn't there any more.", 404);

function fromOf(s: Source): string | null {
  switch (s.kind) {
    case "bot": return s.name;
    case "space": return s.name;
    case "note": return s.title || "A meeting";
    default: return null;
  }
}
const spaceBits = (s: Source) => (s.kind === "space" ? { spaceId: s.spaceId, taskId: s.taskId, spaceName: s.space } : {});
/** A space's thing is fixed for the person it's for; their own (set for themselves, "You") they can change. */
const fixedOf = (s: Source) => s.kind === "space" && s.name !== "You";

/** Minutes before, from a form or a bot: "" or null is none; undefined keeps `fallback`. */
function remindOf(v: unknown, fallback: number | null): number | null {
  if (v === undefined) return fallback;
  if (v === null || v === "" || v === "none" || v === false) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) throw bad("A reminder is minutes before, like 10.");
  return Math.min(REMIND_MAX, n);
}

export class Calendar {
  private readonly rows: CalendarRows;
  private readonly now: () => number;
  private readonly publish: (userId: string) => void;
  private readonly tzs = new Map<string, number>();
  private spaceAnswer: SpaceAnswer | null = null;

  constructor(o: { rows?: CalendarRows; now?: () => number; publish?: (userId: string) => void } = {}) {
    this.rows = o.rows ?? calendarRows();
    this.now = o.now ?? Date.now;
    this.publish = o.publish ?? ((userId) => livePublish(userId, [TOPIC.calendar, TOPIC.tasks, botTopic("plan")]));
  }

  /** Spaces answer here when the person ticks, or says no to, something a space gave them (routes/botsSpaces.ts). */
  onSpaceAnswer(fn: SpaceAnswer | null): void { this.spaceAnswer = fn; }

  /** The person's offset, as their apps last said it (India's when never said): what "today" is for a bot's words. */
  tzFor(userId: string): number { return this.tzs.get(userId) ?? 330; }
  private seeTz(userId: string, tz: unknown): number {
    const t = tzOf(tz, this.tzFor(userId));
    if (tz !== undefined && tz !== null && tz !== "") {
      this.tzs.set(userId, t);
      if (this.tzs.size > 50_000) this.tzs.delete(this.tzs.keys().next().value!);
    }
    return t;
  }

  // ------------------------------------------------------------------ views

  private eventView(r: EventRow, o?: { day: string; start: number; end: number }, tz = r.tz_min): CalEvent {
    const series = !!r.repeat;
    const start = o?.start ?? r.start_ms, end = o?.end ?? r.end_ms;
    const day = r.all_day ? (o?.day ?? startDay(r)) : dayOf(start, tz);
    const where = whereOf(r.place);
    return {
      id: series && o ? `${r.id}@${o.day}` : r.id, seriesId: r.id, title: r.title, notes: r.notes, place: r.place, ...(where ? { where } : {}),
      start: r.all_day ? startOfDay(day, tz) : start, end: r.all_day ? startOfDay(day, tz) + Math.max(DAY, end - start) : end, allDay: r.all_day, day,
      repeat: r.repeat, remindMin: r.remind_min, from: fromOf(r.source), source: r.source.kind, fixed: fixedOf(r.source), ...spaceBits(r.source),
    };
  }

  private taskView(r: TaskRow): CalTask {
    const s = r.source;
    return {
      id: r.id, title: r.title, notes: r.notes, list: r.list, due: r.due_day, at: r.due_ms, done: r.done, doneAt: r.done_ms, remindMin: r.remind_min,
      from: fromOf(s), source: s.kind, fixed: fixedOf(s), ...spaceBits(s), ...(s.kind === "note" ? { noteId: s.noteId, todoId: s.todoId } : {}),
    };
  }

  /** Every event and to-do on the days from `from` to `to` (day keys, the person's time), and the open to-dos with no day. */
  async list(userId: string, o: { from: string; to: string; tz?: unknown }): Promise<Listed> {
    const tz = this.seeTz(userId, o.tz);
    if (!isDayKey(o.from) || !isDayKey(o.to) || o.to < o.from) throw bad("from and to are days, like 2026-10-29.");
    const to = o.to > shiftDay(o.from, 92) ? shiftDay(o.from, 92) : o.to;
    const fromMs = startOfDay(o.from, tz), toMs = startOfDay(shiftDay(to, 1), tz);
    const [evRows, taskRows, open] = await Promise.all([
      this.rows.events.overlapping(userId, fromMs, toMs, LIST_MAX),
      this.rows.tasks.between(userId, o.from, to, LIST_MAX),
      this.rows.tasks.open(userId, OPEN_MAX),
    ]);
    const events: CalEvent[] = [];
    for (const raw of evRows) {
      const r = eventRow(raw);
      for (const occ of occurrences(r, fromMs, toMs)) {
        const v = this.eventView(r, occ, tz);
        if (v.day >= o.from && v.day <= to) events.push(v);
      }
    }
    events.sort((a, b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title));
    const tasks = taskRows.map((t) => this.taskView(taskRow(t))).sort((a, b) => String(a.due).localeCompare(String(b.due)) || Number(a.done) - Number(b.done) || (a.at ?? Infinity) - (b.at ?? Infinity));
    return { events: events.slice(0, LIST_MAX), tasks, open: open.map((t) => this.taskView(taskRow(t))).filter((t) => !t.due) };
  }

  /** The open to-dos: overdue and due soon first, then the ones with no day. */
  async openTasks(userId: string): Promise<CalTask[]> {
    const rows = (await this.rows.tasks.open(userId, OPEN_MAX)).map((t) => this.taskView(taskRow(t)));
    return rows.sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || String(a.due).localeCompare(String(b.due)) || (a.at ?? Infinity) - (b.at ?? Infinity));
  }

  private async eventRowOf(userId: string, id: unknown): Promise<{ row: EventRow; day: string | null }> {
    const [base, day] = typeof id === "string" ? id.split("@") : [];
    if (!base || !UUID.test(base) || (day !== undefined && !isDayKey(day))) throw gone("event");
    const [r] = await this.rows.events.select({ id: base, user_id: userId }, { limit: 1 });
    if (!r) throw gone("event");
    return { row: eventRow(r), day: day ?? null };
  }

  private async taskRowOf(userId: string, id: unknown): Promise<TaskRow> {
    if (typeof id !== "string" || !UUID.test(id)) throw gone("task");
    const [r] = await this.rows.tasks.select({ id, user_id: userId }, { limit: 1 });
    if (!r) throw gone("task");
    return taskRow(r);
  }

  async event(userId: string, id: unknown, tz?: unknown): Promise<CalEvent> {
    const t = this.seeTz(userId, tz);
    const { row, day } = await this.eventRowOf(userId, id);
    if (day && row.repeat) {
      const occ = occurrences(row, startOfDay(day, t) - DAY, startOfDay(shiftDay(day, 2), t)).find((x) => x.day === day);
      if (occ) return this.eventView(row, occ, t);
    }
    return this.eventView(row, undefined, t);
  }

  async task(userId: string, id: unknown): Promise<CalTask> { return this.taskView(await this.taskRowOf(userId, id)); }

  // ------------------------------------------------------------------ what an add or a change says

  /** Day, time and length from a body; `cur` is what it was (a change keeps what the body leaves out). */
  private when(b: Record<string, unknown>, tz: number, cur?: EventRow): { start: number; end: number; allDay: boolean } {
    const today = dayOf(this.now(), tz);
    const curDay = cur ? startDay(cur) : null;
    const day = b.day === undefined ? curDay ?? today : isDayKey(b.day) ? b.day : dayFrom(b.day, today);
    if (!day) throw bad("That day doesn't look right. Try one like Fri or 30 Oct.");
    const curTime = cur && !cur.all_day ? minuteOf(cur.start_ms, cur.tz_min) : null;
    // No time at all on a new event is all day; on a change it keeps what it was. An empty time is all day.
    const allDay = b.allDay === true || (b.time !== undefined ? (b.time === "" || b.time === null) : cur ? (b.allDay === false ? false : cur.all_day) : b.allDay !== false);
    if (allDay) {
      const s = Date.parse(`${day}T00:00:00Z`);
      const days = cur?.all_day && b.day === undefined ? Math.max(1, Math.round((cur.end_ms - cur.start_ms) / DAY)) : 1;
      return { start: s, end: s + days * DAY, allDay: true };
    }
    const time = b.time !== undefined ? timeOf(b.time) : curTime;
    if (time === null || time === undefined) throw bad("That time doesn't look right. Try one like 5 pm or 17:30.");
    const start = startOfDay(day, tz) + time * MIN;
    const curLen = cur && !cur.all_day ? cur.end_ms - cur.start_ms : 60 * MIN;
    let end = start + curLen;
    const endTime = b.endTime !== undefined && b.endTime !== "" && b.endTime !== null ? timeOf(b.endTime) : null;
    if (b.endTime !== undefined && b.endTime !== "" && b.endTime !== null && endTime === null) throw bad("That end time doesn't look right.");
    const mins = Math.round(Number(b.minutes));
    if (endTime !== null) end = startOfDay(day, tz) + endTime * MIN + (endTime <= time ? DAY : 0);
    else if (b.minutes !== undefined && b.minutes !== "" && Number.isFinite(mins)) {
      if (mins < 5 || mins > 24 * 60) throw bad("How long is between 5 minutes and a day.");
      end = start + mins * MIN;
    }
    return { start, end, allDay: false };
  }

  private repeatOf(v: unknown, cur: Repeat = ""): Repeat {
    if (v === undefined) return cur;
    const r = (v === null ? "" : String(v)).toLowerCase() as Repeat;
    if (!REPEATS.includes(r)) throw bad("Repeat is daily, weekdays, weekly, monthly or yearly.");
    return r;
  }

  private untilOf(v: unknown, tz: number, cur: number | null): number | null {
    if (v === undefined) return cur;
    if (v === null || v === "") return null;
    if (!isDayKey(v)) throw bad("Until is a day, like 2026-12-31.");
    return startOfDay(shiftDay(v, 1), tz) - 1;
  }

  /** A line typed or said with no time of its own ("Dentist Fri 5 pm" in the What field): its day, time and place are read out of it. */
  private fromWords(b: Record<string, unknown>, tz: number, o: { task?: boolean } = {}): Record<string, unknown> {
    const said = typeof b.time === "string" && b.time.trim() !== "";
    if (said || typeof b.title !== "string") return b;
    const r = readLine(b.title, this.now(), tz, { place: !o.task });
    if (r.time === undefined && !r.daySaid && !r.place) return b;
    return {
      ...b, title: r.title || b.title,
      ...(r.daySaid && r.day ? { day: r.day } : {}),
      ...(r.time !== undefined && !b.allDay ? { time: `${Math.floor(r.time / 60)}:${String(r.time % 60).padStart(2, "0")}` } : {}),
      ...(r.end !== undefined && b.endTime === undefined ? { endTime: `${Math.floor(r.end / 60)}:${String(r.end % 60).padStart(2, "0")}` } : {}),
      ...(r.minutes !== undefined && b.minutes === undefined ? { minutes: r.minutes } : {}),
      ...(r.place && !clean(b.place, 160) ? { place: r.place } : {}),
      ...(r.repeat && b.repeat === undefined ? { repeat: r.repeat } : {}),
    };
  }

  private reminderFor(r: EventRow): number | null { return nextReminder(r, this.now())?.at ?? null; }
  private taskReminderFor(r: TaskRow): number | null { return taskReminder(r, this.now()); }

  private async countGuard(userId: string, which: "events" | "tasks"): Promise<void> {
    const n = (await this.rows[which].select({ user_id: userId }, { limit: ROWS_MAX })).length;
    if (n >= ROWS_MAX) throw new BotError("calendar_full", which === "events" ? "Your calendar is full. Take some old events out first." : "Your list is full. Take some old to-dos out first.", 409);
  }

  // ------------------------------------------------------------------ events

  async addEvent(userId: string, raw: Record<string, unknown>, by: Source = { kind: "me" }): Promise<CalEvent> {
    const tz = this.seeTz(userId, raw.tz);
    const b = this.fromWords(raw, tz);
    const title = clean(b.title, 120);
    if (!title) throw bad("Say what it is, like Dentist.");
    const w = this.when(b, tz);
    await this.countGuard(userId, "events");
    const at = this.now();
    const row: EventRow = {
      id: randomUUID(), user_id: userId, title, notes: longText(b.notes, 1000), place: clean(b.place, 160),
      start_ms: w.start, end_ms: w.end, all_day: w.allDay, tz_min: tz,
      repeat: this.repeatOf(b.repeat), repeat_until: this.untilOf(b.until, tz, null), skips: [],
      remind_min: remindOf(b.remind, w.allDay ? null : DEFAULT_REMIND_MIN), next_remind_ms: null,
      source: by, source_key: null, created_ms: at, updated_ms: at,
    };
    row.next_remind_ms = this.reminderFor(row);
    await this.rows.events.insert(row);
    this.publish(userId);
    return this.eventView(row, undefined, tz);
  }

  private noChange(r: EventRow | TaskRow): void {
    if (fixedOf(r.source)) throw new BotError("not_allowed", `${r.source.kind === "space" ? r.source.name : "Someone"} set this. Ask them to change it, or say you can't.`, 403);
  }

  async changeEvent(userId: string, id: unknown, raw: Record<string, unknown>): Promise<CalEvent> {
    const tz = this.seeTz(userId, raw.tz);
    const { row } = await this.eventRowOf(userId, id);
    this.noChange(row);
    const b = raw;
    const title = b.title !== undefined ? clean(b.title, 120) : row.title;
    if (!title) throw bad("Say what it is, like Dentist.");
    const w = this.when(b, b.tz !== undefined ? tz : row.tz_min, row);
    const next: EventRow = {
      ...row, title, notes: b.notes !== undefined ? longText(b.notes, 1000) : row.notes, place: b.place !== undefined ? clean(b.place, 160) : row.place,
      start_ms: w.start, end_ms: w.end, all_day: w.allDay, tz_min: b.tz !== undefined && !w.allDay ? tz : row.tz_min,
      repeat: this.repeatOf(b.repeat, row.repeat), repeat_until: this.untilOf(b.until, tz, row.repeat_until),
      remind_min: remindOf(b.remind, row.remind_min), updated_ms: this.now(),
    };
    if (!next.repeat) next.skips = [];
    next.next_remind_ms = this.reminderFor(next);
    await this.rows.events.update({ id: row.id, user_id: userId }, next);
    this.publish(userId);
    return this.eventView(next, undefined, tz);
  }

  /** Out of the calendar. One start of a series (`one`): that day only. */
  async removeEvent(userId: string, id: unknown, o: { one?: boolean } = {}): Promise<void> {
    const { row, day } = await this.eventRowOf(userId, id);
    this.noChange(row);
    if (row.repeat && day && o.one) {
      const skips = [...new Set([...row.skips, day])].slice(-400);
      const next = { ...row, skips, updated_ms: this.now() };
      next.next_remind_ms = this.reminderFor(next);
      await this.rows.events.update({ id: row.id, user_id: userId }, { skips, next_remind_ms: next.next_remind_ms, updated_ms: next.updated_ms });
    } else {
      await this.rows.events.remove({ id: row.id, user_id: userId });
    }
    this.publish(userId);
  }

  /** To another start, the same length (the Plan bot's suggestion, said yes to). One start of a series moves alone. */
  async moveEvent(userId: string, id: unknown, startMs: number): Promise<CalEvent> {
    if (!Number.isFinite(startMs)) throw bad("start is when it moves to.");
    const { row, day } = await this.eventRowOf(userId, id);
    this.noChange(row);
    if (row.repeat && day) {
      const occ = occurrences(row, startOfDay(day, row.tz_min) - DAY, startOfDay(shiftDay(day, 2), row.tz_min)).find((x) => x.day === day);
      const len = occ ? occ.end - occ.start : row.end_ms - row.start_ms;
      await this.removeEvent(userId, id, { one: true });
      const at = this.now();
      const one: EventRow = { ...row, id: randomUUID(), start_ms: startMs, end_ms: startMs + len, all_day: false, repeat: "", repeat_until: null, skips: [], created_ms: at, updated_ms: at, source_key: null };
      one.next_remind_ms = this.reminderFor(one);
      await this.rows.events.insert(one);
      this.publish(userId);
      return this.eventView(one);
    }
    const next: EventRow = { ...row, start_ms: startMs, end_ms: startMs + (row.all_day ? 60 * MIN : row.end_ms - row.start_ms), all_day: false, updated_ms: this.now() };
    next.next_remind_ms = this.reminderFor(next);
    await this.rows.events.update({ id: row.id, user_id: userId }, next);
    this.publish(userId);
    return this.eventView(next);
  }

  // ------------------------------------------------------------------ to-dos

  private due(b: Record<string, unknown>, tz: number, cur?: TaskRow): { day: string | null; at: number | null } {
    const today = dayOf(this.now(), tz);
    const day = b.day === undefined ? cur?.due_day ?? null : b.day === "" || b.day === null ? null : isDayKey(b.day) ? b.day : dayFrom(b.day, today);
    if (b.day !== undefined && b.day !== "" && b.day !== null && !day) throw bad("That day doesn't look right. Try one like Fri or 30 Oct.");
    if (!day) return { day: null, at: null };
    const t = b.time === undefined ? (cur?.due_ms !== null && cur?.due_ms !== undefined ? minuteOf(cur.due_ms, cur.tz_min) : null) : b.time === "" || b.time === null ? null : timeOf(b.time);
    if (b.time !== undefined && b.time !== "" && b.time !== null && t === null) throw bad("That time doesn't look right. Try one like 5 pm or 17:30.");
    return { day, at: t === null ? null : startOfDay(day, tz) + t * MIN };
  }

  async addTask(userId: string, raw: Record<string, unknown>, by: Source = { kind: "me" }, key: string | null = null): Promise<CalTask> {
    const tz = this.seeTz(userId, raw.tz);
    const b = this.fromWords(raw, tz, { task: true });
    const title = clean(b.title, 120);
    if (!title) throw bad("Say what the to-do is.");
    const d = this.due(b, tz);
    await this.countGuard(userId, "tasks");
    const at = this.now();
    const row: TaskRow = {
      id: randomUUID(), user_id: userId, title, notes: longText(b.notes, 1000), list: clean(b.list, 40),
      due_day: d.day, due_ms: d.at, tz_min: tz, done: false, done_ms: null,
      remind_min: remindOf(b.remind, d.at !== null ? 0 : null), next_remind_ms: null,
      source: by, source_key: key, created_ms: at, updated_ms: at,
    };
    row.next_remind_ms = this.taskReminderFor(row);
    await this.rows.tasks.insert(row);
    this.publish(userId);
    return this.taskView(row);
  }

  async changeTask(userId: string, id: unknown, raw: Record<string, unknown>): Promise<CalTask> {
    const row = await this.taskRowOf(userId, id);
    if (raw.done !== undefined && Object.keys(raw).every((k) => k === "done" || k === "tz")) return this.tickTask(userId, id, raw.done === true);
    this.noChange(row);
    const tz = this.seeTz(userId, raw.tz ?? row.tz_min);
    const title = raw.title !== undefined ? clean(raw.title, 120) : row.title;
    if (!title) throw bad("Say what the to-do is.");
    const d = this.due(raw, tz, row);
    const next: TaskRow = {
      ...row, title, notes: raw.notes !== undefined ? longText(raw.notes, 1000) : row.notes, list: raw.list !== undefined ? clean(raw.list, 40) : row.list,
      due_day: d.day, due_ms: d.at, tz_min: tz, remind_min: remindOf(raw.remind, row.remind_min), updated_ms: this.now(),
      ...(raw.done !== undefined ? { done: raw.done === true, done_ms: raw.done === true ? this.now() : null } : {}),
    };
    next.next_remind_ms = this.taskReminderFor(next);
    await this.rows.tasks.update({ id: row.id, user_id: userId }, next);
    this.publish(userId);
    return this.taskView(next);
  }

  /** Done, or back to do. A space's task says so in the space too. */
  async tickTask(userId: string, id: unknown, done: boolean): Promise<CalTask> {
    const row = await this.taskRowOf(userId, id);
    const next: TaskRow = { ...row, done, done_ms: done ? this.now() : null, updated_ms: this.now() };
    next.next_remind_ms = this.taskReminderFor(next);
    await this.rows.tasks.update({ id: row.id, user_id: userId }, { done: next.done, done_ms: next.done_ms, next_remind_ms: next.next_remind_ms, updated_ms: next.updated_ms });
    if (row.source.kind === "space" && this.spaceAnswer) {
      await this.spaceAnswer(userId, row.source.spaceId, row.source.taskId, done ? "done" : "todo").catch(() => undefined);
    }
    this.publish(userId);
    return this.taskView(next);
  }

  async removeTask(userId: string, id: unknown): Promise<void> {
    const row = await this.taskRowOf(userId, id);
    this.noChange(row);
    await this.rows.tasks.remove({ id: row.id, user_id: userId });
    this.publish(userId);
  }

  /** The to-dos made from a meeting's to-dos: { todoId: taskId }. */
  async fromNote(userId: string, noteId: string): Promise<Record<string, { id: string; done: boolean }>> {
    const out: Record<string, { id: string; done: boolean }> = {};
    for (const r of await this.rows.tasks.select({ user_id: userId }, { limit: ROWS_MAX })) {
      const s = (r.source ?? {}) as Source;
      if (s.kind === "note" && s.noteId === noteId) out[s.todoId] = { id: r.id, done: r.done === true };
    }
    return out;
  }

  /** A meeting's to-do, put on the person's list (once: a second add answers the first). `when` is how it was said ("by Friday"). */
  async addFromNote(userId: string, b: { noteId: string; todoId: string; noteTitle: string; text: string; when?: string; done?: boolean; tz?: unknown }): Promise<CalTask> {
    const key = `note:${b.noteId}:${b.todoId}`;
    const [had] = await this.rows.tasks.select({ user_id: userId, source_key: key }, { limit: 1 });
    if (had) return this.taskView(taskRow(had));
    const tz = this.seeTz(userId, b.tz);
    const today = dayOf(this.now(), tz);
    const said = (b.when ?? "").trim();
    const r = said ? readLine(said, this.now(), tz, { place: false }) : null;
    const day = r?.daySaid ? r.day ?? null : dayFrom(said, today);
    const t = await this.addTask(userId, {
      title: b.text, tz, ...(day ? { day } : {}), ...(day && r?.time !== undefined ? { time: `${Math.floor(r.time / 60)}:${String(r.time % 60).padStart(2, "0")}` } : { time: "" }),
    }, { kind: "note", noteId: b.noteId, todoId: b.todoId, title: clean(b.noteTitle, 80) }, key);
    return b.done ? this.tickTask(userId, t.id, true) : t;
  }

  /** The to-do made from a meeting's to-do, ticked or not, as the meeting's own tick says (the Notes page sends both). */
  async tickFromNote(userId: string, noteId: string, todoId: string, done: boolean): Promise<boolean> {
    const [r] = await this.rows.tasks.select({ user_id: userId, source_key: `note:${noteId}:${todoId}` }, { limit: 1 });
    if (!r) return false;
    if ((r.done === true) !== done) await this.tickTask(userId, r.id, done);
    return true;
  }

  // ------------------------------------------------------------------ a line of words

  /** "Dentist Fri 5 pm", "Pay rent by Friday", "Call Nani every Sunday 11 am": an event when a time was said, else a to-do. */
  async quick(userId: string, words: unknown, o: { day?: unknown; tz?: unknown; kind?: unknown } = {}, by: Source = { kind: "me" }): Promise<{ kind: "event"; event: CalEvent; said: string } | { kind: "task"; task: CalTask; said: string }> {
    const tz = this.seeTz(userId, o.tz);
    const line = clean(words, 300);
    if (!line) throw bad("Say what to add, like Dentist Fri 5 pm.");
    const r = readLine(line, this.now(), tz);
    if (!r.title) throw bad("Say what it is, like Dentist.");
    const day = r.daySaid ? r.day : isDayKey(o.day) ? o.day : r.day;
    const asTask = o.kind === "task" || (o.kind !== "event" && r.task);
    const time = r.time !== undefined ? `${Math.floor(r.time / 60)}:${String(r.time % 60).padStart(2, "0")}` : "";
    if (asTask) {
      const task = await this.addTask(userId, { title: r.title, tz, ...(day ? { day } : {}), time: day ? time : "", ...(r.remind && time ? { remind: 0 } : {}) }, by);
      return { kind: "task", task, said: task.due ? `${task.title} · ${dayName(task.due, dayOf(this.now(), tz))}${task.at !== null ? `, ${clockAt(task.at, tz)}` : ""}` : task.title };
    }
    const event = await this.addEvent(userId, {
      title: r.title, tz, day: day ?? dayOf(this.now(), tz), time: r.allDay ? "" : time, ...(r.end !== undefined ? { endTime: `${Math.floor(r.end / 60)}:${String(r.end % 60).padStart(2, "0")}` } : {}),
      ...(r.minutes !== undefined ? { minutes: r.minutes } : {}), ...(r.place ? { place: r.place } : {}), ...(r.repeat ? { repeat: r.repeat } : {}),
    }, by);
    return { kind: "event", event, said: `${event.title} · ${dayName(event.day, dayOf(this.now(), tz))}${event.allDay ? "" : `, ${clockAt(event.start, tz)}`}` };
  }

  // ------------------------------------------------------------------ what spaces give a person

  /** A space's task or plan, on this person's days ("From Meera S."): made, or brought up to date. Never throws. */
  async landSpace(userId: string, it: SpaceItem): Promise<void> {
    const key = `space:${it.taskId}`;
    const source: Source = { kind: "space", spaceId: it.spaceId, taskId: it.taskId, by: it.by, name: it.name, space: it.spaceName };
    const tz = this.tzFor(userId);
    const at = this.now();
    try {
      if (it.kind === "plan") {
        if (it.at === null) return;
        const [had] = await this.rows.events.select({ user_id: userId, source_key: key }, { limit: 1 });
        const row: EventRow = {
          id: had?.id ?? randomUUID(), user_id: userId, title: clean(it.title, 120) || "Plan", notes: longText(it.notes, 1000), place: clean(it.place, 160),
          start_ms: it.at, end_ms: it.end ?? it.at + 60 * MIN, all_day: false, tz_min: had ? Number(had.tz_min) : tz,
          repeat: "", repeat_until: null, skips: [], remind_min: had ? (had.remind_min === null ? null : Number(had.remind_min)) : DEFAULT_REMIND_MIN, next_remind_ms: null,
          source, source_key: key, created_ms: had ? Number(had.created_ms) : at, updated_ms: at,
        };
        row.next_remind_ms = this.reminderFor(row);
        if (had) await this.rows.events.update({ id: row.id, user_id: userId }, row);
        else await this.rows.events.insert(row);
      } else {
        const [had] = await this.rows.tasks.select({ user_id: userId, source_key: key }, { limit: 1 });
        const day = it.at === null ? null : it.allDay ? dayOf(it.at, tz) : dayOf(it.at, tz);
        const row: TaskRow = {
          id: had?.id ?? randomUUID(), user_id: userId, title: clean(it.title, 120) || "Task", notes: longText(it.notes, 1000), list: had ? String(had.list ?? "") : "",
          due_day: day, due_ms: it.at !== null && !it.allDay ? it.at : null, tz_min: had ? Number(had.tz_min) : tz,
          done: it.done, done_ms: it.done ? (had?.done_ms ? Number(had.done_ms) : at) : null,
          remind_min: had ? (had.remind_min === null ? null : Number(had.remind_min)) : it.at !== null && !it.allDay ? 0 : null, next_remind_ms: null,
          source, source_key: key, created_ms: had ? Number(had.created_ms) : at, updated_ms: at,
        };
        row.next_remind_ms = this.taskReminderFor(row);
        if (had) await this.rows.tasks.update({ id: row.id, user_id: userId }, row);
        else await this.rows.tasks.insert(row);
      }
      this.publish(userId);
    } catch { /* a space's task is still in the space */ }
  }

  /** Off this person's days (they can't do it, they left), or everyone's (`userId` left out: it was taken out of the space). */
  async unlandSpace(taskId: string, userId?: string): Promise<void> {
    const key = `space:${taskId}`;
    const match = userId ? { user_id: userId, source_key: key } : { source_key: key };
    try {
      const who = new Set<string>();
      for (const r of await this.rows.events.select(match, { limit: 100 })) who.add(r.user_id);
      for (const r of await this.rows.tasks.select(match, { limit: 100 })) who.add(r.user_id);
      await this.rows.events.remove(match);
      await this.rows.tasks.remove(match);
      for (const u of who) this.publish(u);
    } catch { /* nothing to take out */ }
  }

  /** "Can't do it", from the person's own days: the space hears it, and it comes off their days. */
  async cantDo(userId: string, id: unknown): Promise<void> {
    const base = typeof id === "string" ? id.split("@")[0] : "";
    const [ev] = UUID.test(base ?? "") ? await this.rows.events.select({ id: base, user_id: userId }, { limit: 1 }) : [];
    const [tk] = !ev && UUID.test(base ?? "") ? await this.rows.tasks.select({ id: base, user_id: userId }, { limit: 1 }) : [];
    const s = (ev?.source ?? tk?.source) as Source | undefined;
    if (!s) throw gone(ev ? "event" : "task");
    if (s.kind !== "space") throw bad("Only something from someone else can be said no to. Take it out instead.");
    if (!this.spaceAnswer) throw new BotError("spaces_off", "Spaces aren't on here.", 503);
    await this.spaceAnswer(userId, s.spaceId, s.taskId, "cant");
    await this.unlandSpace(s.taskId, userId);
  }

  // ------------------------------------------------------------------ reminders

  /** Every reminder that is due: claimed by moving it on (so two servers never send one twice), then sent. How many went. */
  async remind(send: ReminderSend, limit = 200): Promise<number> {
    const now = this.now();
    let sent = 0;
    for (const raw of await this.rows.events.due(now, limit)) {
      const r = eventRow(raw);
      const due = r.next_remind_ms!;
      const was = nextReminder(r, due - 1);
      const next = was ? nextReminder(r, Math.max(was.at, now)) : nextReminder(r, now);
      const claimed = await this.rows.events.update({ id: r.id, next_remind_ms: due }, { next_remind_ms: next?.at ?? null });
      if (!claimed || !was || now - was.at > LATE_MS) continue;
      const today = dayOf(now, r.tz_min);
      const when = r.all_day
        ? `${dayName(was.day, today)}, all day`
        : `${r.remind_min && r.remind_min >= 24 * 60 ? `${dayName(was.day, today)}, ` : "At "}${clockAt(was.start, r.tz_min)}`;
      await send(r.user_id, {
        kind: "plan_reminder", key: `event:${r.id}:${was.start}`,
        vars: { title: r.title, when: [when, whereOf(r.place)].filter(Boolean).join(" · ") }, data: { day: was.day, event: r.repeat ? `${r.id}@${was.day}` : r.id },
      }).catch(() => undefined);
      sent += 1;
    }
    for (const raw of await this.rows.tasks.due(now, limit)) {
      const t = taskRow(raw);
      const due = t.next_remind_ms!;
      const claimed = await this.rows.tasks.update({ id: t.id, next_remind_ms: due }, { next_remind_ms: null });
      if (!claimed || t.done || now - due > LATE_MS || !t.due_day) continue;
      const today = dayOf(now, t.tz_min);
      await send(t.user_id, {
        kind: "plan_reminder", key: `task:${t.id}:${due}`,
        vars: { title: t.title, when: t.due_ms !== null ? `Due ${dayName(t.due_day, today) === "Today" ? "" : `${dayName(t.due_day, today)}, `}${clockAt(t.due_ms, t.tz_min)}` : `Due ${dayName(t.due_day, today).toLowerCase() === "today" ? "today" : dayName(t.due_day, today)}` },
        data: { day: t.due_day, task: t.id },
      }).catch(() => undefined);
      sent += 1;
    }
    return sent;
  }
}

// ------------------------------------------------------------------ the one the server uses

let shared: Calendar | null = null;

/** The server's calendar (its tables are calendarRows()'s). */
export function calendar(): Calendar { return (shared ??= new Calendar()); }

/** Tests: a fresh one over fresh tables. */
export function resetCalendarForTests(): void { shared = null; resetCalendarRowsForTests(); }

/**
 * PLAN EASE'S LIST ROWS, BY KIND (docs/plan-ease.md "Row kinds"; design A1 "Today and tomorrow: a calm list").
 *
 * Everything on the person's days is one DayItem (an event or a to-do from src/calendar, whatever made it), and each draws as one row:
 * a time on the left (or the round tick of something to tick off), the title, at most one grey line, and at most one thing on the right
 * (Pay, or the tiny bot of the person who set it). Where an item came from is never on the row: it is in its details.
 *
 *   ROW_KINDS        the kinds, most particular first: the first whose match() takes an item draws it
 *   rowOf(item, ctx) the row for one item
 *   dayItems(listed) the calendar's list as DayItems
 *   isBooked(item)   something we can't move by moving our row (a doctor, a school meeting, a ticket, someone else's): never a Move card
 *
 * ADDING A KIND (a later step): write its RowKind (match on what makes it so: a to-do's `kind` "due" or "wait", a space task's "ask" or
 * "turn") and put it in its step's list below. The screens draw any row the same way (screens/bots/planPage.ts), so nothing there
 * changes. Pure: no reads.
 */
import type { CalEvent, CalTask, Listed } from "../calendar/index.js";
import type { TaskKind } from "../calendar/store.js";
import { lookOf, type PersonLook } from "./personLook.js";
import { looksHealth } from "./planSafe.js";
import { DUE_ROW } from "./planDue.js";
import { WAIT_ROW } from "./planWaits.js";
import { followOn } from "./planSwitch.js";
import { autoMust, effectiveMust } from "./planFollowWords.js";

const MIN = 60_000;

/** One thing on the person's days, whatever it is. */
export interface DayItem {
  ref: "event" | "task";
  /** The calendar's id ("<id>@<day>" for one start of a series). */
  id: string;
  /** What it is: an event, or a to-do of a kind (todo, due, wait). */
  kind: "event" | TaskKind;
  title: string;
  day: string;
  /** When it starts (a to-do with a time: when it's due); null for an all-day event or a to-do with only a day. */
  start: number | null;
  end: number | null;
  allDay: boolean;
  where?: string;
  place?: string;
  done: boolean;
  /** Someone else's: only they change it. */
  fixed: boolean;
  source: string;
  /** Who set it, when someone else did (a space's task or plan): their id and name, for their tiny bot. */
  by?: { id: string; name: string };
  repeat?: string;
  snoozes?: number;
  /** A meeting that holds no time (the work calendar's "free"): never a clash, never in the way of a move. */
  free?: boolean;
  /** A bill (kind "due"): its amount (inside the app only), who it's paid to, and its pay link when that is safe (planDue.ts). */
  amountPaise?: number;
  payee?: string;
  payLink?: string;
  /** The capture that added it ("Take out all 4 from the circular"). */
  captureId?: string;
  /** A wait (kind "wait", planWaits.ts): who it waits on, for its grey line ("Waiting on Rahul · by Thu"). */
  who?: string;
  /** Follow-through (planFollow.ts): how important the person set it (absent: the rules decide). */
  importance?: "normal" | "must";
}

const byOf = (x: { source: string; from: string | null; fixed: boolean; byId?: string }): DayItem["by"] =>
  x.source === "space" && x.fixed && x.from && x.byId ? { id: x.byId, name: x.from } : undefined;

export function eventItem(e: CalEvent): DayItem {
  const by = byOf(e);
  return {
    ref: "event", id: e.id, kind: "event", title: e.title, day: e.day, start: e.allDay ? null : e.start, end: e.allDay ? null : e.end, allDay: e.allDay,
    ...(e.where ? { where: e.where } : {}), ...(e.place ? { place: e.place } : {}), done: false, fixed: e.fixed, source: e.source,
    ...(by ? { by } : {}), ...(e.repeat ? { repeat: e.repeat } : {}), ...(e.captureId ? { captureId: e.captureId } : {}),
    ...(e.importance ? { importance: e.importance } : {}),
  };
}

export function taskItem(t: CalTask): DayItem {
  const by = byOf(t);
  return {
    ref: "task", id: t.id, kind: t.kind ?? "todo", title: t.title, day: t.due ?? "", start: t.at, end: null, allDay: false, done: t.done,
    fixed: t.fixed, source: t.source, ...(by ? { by } : {}), snoozes: t.snoozes ?? 0,
    ...(t.amountPaise ? { amountPaise: t.amountPaise } : {}), ...(t.payee ? { payee: t.payee } : {}), ...(t.payLink ? { payLink: t.payLink } : {}),
    ...(t.who ? { who: t.who } : {}),
    ...(t.captureId ? { captureId: t.captureId } : {}),
    ...(t.importance ? { importance: t.importance } : {}),
  };
}

/** The calendar's list (calendar.list), as DayItems: each event start and each to-do with a day. The ones with no day are left out. */
export function dayItems(l: Listed): DayItem[] {
  return [...l.events.map(eventItem), ...l.tasks.filter((t) => t.due).map(taskItem)];
}

/** Words of something booked with someone: moving our row would not move it. */
const BOOKED = /\b(?:ptm|parent[- ]teacher|school|college|exam|interview|flight|train|bus|boarding|check-?in|appointment|consultation|court|hearing|visa|passport|bank)\b/i;

/** Never offered a move: a health visit, a school meeting, a ticket, a booking, or something someone else set. */
export const isBooked = (it: Pick<DayItem, "title" | "fixed" | "source">): boolean =>
  it.fixed || it.source === "capture" || looksHealth(it.title) || BOOKED.test(it.title);

// ------------------------------------------------------------------ the row

/** What a row is drawn from (screens/bots/planPage.ts draws any of them the same way). */
export interface RowView {
  /** "e:<id>" or "t:<id>". */
  id: string;
  kind: string;
  /** "10:00 am" on the left, or "" when the row starts with its tick. */
  time: string;
  /** The round tick on the left (a to-do, a due's Paid): the act door's item and button. */
  tick?: { item: string; action: string; label: string };
  /** The title, in full: this is inside the app. */
  title: string;
  /** One grey line, or "". */
  line: string;
  /** The tiny bot of the person it is from, on the right. */
  person?: { look: PersonLook; name: string };
  /** A button on the right instead (a due's Pay, step 3). */
  action?: { label: string; url: string };
  /** The grey line is a person's word on it ("Mom: I'll come with you"): drawn as their words, with their tiny bot. */
  note?: RowNote;
  done: boolean;
  /** Its details (screens/planItem.ts). */
  open: { kind: "event" | "task"; id: string };
  /** For the order: when it is. */
  at: number;
}

/** Someone's note on the person's own item (Work in space's notes on mine), newest: the row's grey line, inside the app only. */
export interface RowNote { look: PersonLook; name: string; text: string }

/** What a row may say about an item beyond the item: its leave-by, a clash with something booked, a person's note on it. */
export interface RowCtx {
  tz: number;
  now: number;
  clock: (ms: number) => string;
  /** When to leave for an event, by its id. */
  leaves: ReadonlyMap<string, { leaveBy: number; minutes: number; mode: string; to: string }>;
  /** "Clashes with design review", by item id. */
  clashes: ReadonlyMap<string, string>;
  /** The newest note someone left on it, by row id ("e:<id>", "t:<id>"). */
  notes?: ReadonlyMap<string, RowNote>;
  /** Follow-through's grey line for a followed item of today, by row id ("Mom · not done yet", "Mom said done": planFollow.ts). */
  follow?: ReadonlyMap<string, string>;
}

export interface RowKind {
  kind: string;
  /** The step it came with. */
  step: number;
  match(it: DayItem): boolean;
  row(it: DayItem, ctx: RowCtx): RowView;
}

const personOf = (it: DayItem): RowView["person"] => (it.by ? { look: lookOf(it.by.id), name: it.by.name } : undefined);
const sortAt = (it: DayItem): number => it.start ?? (Date.parse(`${it.day}T00:00:00Z`) + 23 * 60 * MIN);

/** A to-do: its tick on the left; a time, when it has one, as its grey line. */
const TODO: RowKind = {
  kind: "todo", step: 0,
  match: (it) => it.ref === "task",
  row(it, ctx) {
    const clash = ctx.clashes.get(it.id);
    const note = clash ? undefined : ctx.notes?.get(`t:${it.id}`);
    return {
      id: `t:${it.id}`, kind: "todo", time: "",
      tick: { item: `pt:${it.id}`, action: it.done ? "undone" : "done", label: it.done ? `${it.title}. Done. Tap to put it back.` : `${it.title}. Tap when it's done.` },
      title: it.title, line: clash ?? (note ? `${note.name}: ${note.text}` : it.start !== null ? ctx.clock(it.start) : ""), ...(note ? { note } : {}),
      ...(personOf(it) ? { person: personOf(it)! } : {}), done: it.done, open: { kind: "task", id: it.id }, at: sortAt(it),
    };
  },
};

/** An event: its time on the left; the grey line is a clash with something booked, else when to leave, else where. */
const EVENT: RowKind = {
  kind: "event", step: 0,
  match: (it) => it.ref === "event",
  row(it, ctx) {
    const leave = ctx.leaves.get(it.id);
    // One grey line, the most pressing first: a clash, when to leave, a person's word on it, where.
    const clash = ctx.clashes.get(it.id);
    const note = clash || leave ? undefined : ctx.notes?.get(`e:${it.id}`);
    const line = clash ?? (leave ? `Leave by ${ctx.clock(leave.leaveBy)}` : note ? `${note.name}: ${note.text}` : it.where ?? "");
    return {
      id: `e:${it.id}`, kind: "event", time: it.allDay || it.start === null ? "All day" : ctx.clock(it.start), title: it.title, line, ...(note ? { note } : {}),
      ...(personOf(it) ? { person: personOf(it)! } : {}), done: false, open: { kind: "event", id: it.id }, at: sortAt(it),
    };
  },
};

// ------------------------------------------------------------------ the steps to come plug in here

/** Step 3: "due" (a bill: its amount in the title, "Due today", Pay on the right when the link is safe, the tick is Paid: planDue.ts). */
const STEP_3_ROWS: readonly RowKind[] = [DUE_ROW];
/** Step 4: "wait" ("Waiting on Rahul · by Thu"). */
const STEP_4_ROWS: readonly RowKind[] = [WAIT_ROW];
/** Step 5: "ask" (an ask someone took) and "turn" ("Plants · your turn"). */
const STEP_5_ROWS: readonly RowKind[] = [];

/** Most particular first: the first that matches draws the item. */
export const ROW_KINDS: readonly RowKind[] = [...STEP_3_ROWS, ...STEP_4_ROWS, ...STEP_5_ROWS, TODO, EVENT];

export function rowOf(it: DayItem, ctx: RowCtx, kinds: readonly RowKind[] = ROW_KINDS): RowView {
  const row = (kinds.find((k) => k.match(it)) ?? (it.ref === "task" ? TODO : EVENT)).row(it, ctx);
  // Follow-through (planFollow.ts): a followed item's own line ("Mom · not done yet") takes the grey line's place.
  const followed = ctx.follow?.get(row.id);
  if (followed) { const { note: _n, ...rest } = row; return { ...rest, line: followed }; }
  // A must-not-miss item still to do says so, only while follow-through is on (off, the rows read exactly as before).
  if (!followOn() || it.done || row.note) return row;
  const today = new Date(ctx.now + ctx.tz * MIN).toISOString().slice(0, 10);
  const why = autoMust({
    kind: it.ref === "event" ? "event" : it.kind === "event" ? "todo" : it.kind, title: it.title, timed: it.start !== null && !it.allDay,
    dueDay: it.ref === "task" ? it.day || null : null, today,
  });
  if (!effectiveMust(it.importance ?? null, why)) return row;
  return { ...row, line: row.line ? `Must not miss · ${row.line}` : "Must not miss" };
}

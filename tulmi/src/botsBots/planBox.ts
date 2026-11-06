/**
 * THE ONE BOX: WHAT IT UNDERSTOOD (docs/plan-ease.md "The one box"; design A1 "The one box", B7, B8). The person never picks a type:
 * whatever they type or say goes to POST /v1/botsapp/bots/plan/box, and the first slot that understands it answers. Rules only, free:
 * what no slot understands goes to the Plan Ease chat, as before (the screen sends it there: the chat's own route, with the consent
 * gate and Plan Ease's budget it always had).
 *
 *   BOX_SLOTS, in order:
 *     seen      a desktop's "add this", only when the words came with what was on its screen (planInBox.ts): its one clear line is
 *               read by the slots below that add a line, a notice with several things goes to capture
 *     notes     "no evening notes", "evening notes", "no morning notes", "no notes": which notes go (planPrefs.ts)
 *     ask       step 5: a family ask ("Who picks Kabir up Wednesday?"), only when they are in a family space
 *     capture   step 3: a pasted circular or bill SMS (several lines, or a date and an amount); "link my work calendar" (step 2)
 *     day       "What's on Saturday?": the day as a plain list, from the list, by rules
 *     wait      step 4: "Rahul will send the numbers by Thursday", "Plumber said Tuesday"
 *     due       step 3: "Electricity 2140 due 14th", "Pay rent by the 5th every month"
 *     item      "Dentist Fri 5 pm", "Buy milk": an event or a to-do (calendar/words.ts), with Undo
 *     chat      anything else: the Plan Ease chat
 *
 * ADDING A SLOT (a later step): write its read (rules: what it understood, or null) and its run (through the services in BoxCtx), and
 * put it in its place in BOX_SLOTS. The screen draws any reply the same way (a grey line, an Undo, a day's rows, a card).
 */
import type { Calendar } from "../calendar/index.js";
import { readLine } from "../calendar/words.js";
import type { PlanPrefs } from "./planPrefs.js";
import type { RowView } from "./planRows.js";
import { DUE_SLOT } from "./planDue.js";
import { CAPTURE_SLOT, LINK_SLOT, seenCapture, seenLine, type Seen } from "./planInBox.js";
import { WAIT_SLOT } from "./planWaits.js";
import { ASK_SLOT } from "./planAsks.js";

/** What the screen shows under the box. */
export interface BoxReply {
  /** Which slot answered. */
  slot: string;
  /** "added", "day", "said" (a reply line only), "chat" (the screen sends it to the Plan Ease chat). */
  kind: "added" | "day" | "said" | "chat" | "capture";
  /** The one grey line ("Added: Dentist, Fri 13 Nov, 5 pm"). */
  line: string;
  /** Undo: the act door's item and action (planEase.ts). */
  undo?: { item: string; action: string };
  /** A day question's answer: that day's rows. */
  rows?: RowView[];
  day?: string;
  /** A capture card (step 3, pasted words): its id. */
  capture?: string;
  /** A page the screen opens with the reply (the capture card, the work calendar's link page). */
  open?: { screen: string; params?: Record<string, string> };
  /**
   * One button under the line, through the act door (a family ask's preview: [Ask]). Its answer takes the reply's place (the act's
   * body is a reply: "Asked Ghar. If nobody takes it by 6 pm Tuesday, I'll tell you.").
   */
  act?: { item: string; action: string; label: string };
  /** Tapping the line puts these words back in the box, to change the day, the time or the space (a family ask's preview). */
  edit?: string;
}

export interface BoxCtx {
  userId: string;
  now: number;
  tz: number;
  today: string;
  calendar: Calendar;
  prefs: PlanPrefs;
  /** A day's rows as the page draws them (planEase.ts). */
  dayRows(day: string): Promise<RowView[]>;
  /** "Fri 13 Nov". */
  dayWords(key: string): string;
  /** "Today", "Tomorrow", "Fri 13 Nov". */
  dayName(key: string): string;
  /** What a desktop's "add this" carried with the words (planInBox.ts Seen); absent everywhere else. */
  seen?: Seen;
}

export interface BoxSlot<T = unknown> {
  slot: string;
  step: number;
  /** What it understood, or null. Rules only. */
  read(words: string, ctx: BoxCtx): T | null;
  run(read: T, words: string, ctx: BoxCtx): Promise<BoxReply>;
}

// ------------------------------------------------------------------ notes

type NotesMode = "both" | "evening" | "morning" | "off";

const NOTES: BoxSlot<{ to: (was: NotesMode) => NotesMode; line: string }> = {
  slot: "notes", step: 1,
  read(words) {
    const s = words.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
    if (/^(?:no|stop|turn off|don'?t send(?: me)?)(?: the)? evening notes?$/.test(s)) {
      return { to: (was) => (was === "off" || was === "evening" ? "off" : "morning"), line: "OK, no evening notes. Say 'evening notes' to bring them back." };
    }
    if (/^(?:no|stop|turn off|don'?t send(?: me)?)(?: the)? morning notes?$/.test(s)) {
      return { to: (was) => (was === "off" || was === "morning" ? "off" : "evening"), line: "OK, no morning notes. Say 'morning notes' to bring them back." };
    }
    if (/^(?:no|stop|turn off)(?: the)? (?:day )?notes$/.test(s)) return { to: () => "off", line: "OK, no more notes. Say 'evening notes' to bring them back." };
    if (/^(?:send |turn on |start )?(?:the )?evening notes?(?: again| back)?$/.test(s)) {
      return { to: (was) => (was === "morning" || was === "both" ? "both" : "evening"), line: "OK. I'll send a note each evening about tomorrow." };
    }
    if (/^(?:send |turn on |start )?(?:the )?morning notes?(?: again| back)?$/.test(s)) {
      return { to: (was) => (was === "evening" || was === "both" ? "both" : "morning"), line: "OK. I'll send a morning note when your day changed." };
    }
    return null;
  },
  async run(r, _w, ctx) {
    const had = await ctx.prefs.get(ctx.userId);
    const was = had?.notes ?? "both";
    const to = r.to(was);
    // Said in the box, so asked for: the quiet counts start again, and the next note's time is worked out afresh (planEase.ts).
    await ctx.prefs.patch(ctx.userId, { notes: to, unopened: 0, next_note_ms: to === "off" ? null : had?.next_note_ms ?? null, note: { ...(had?.note ?? {}), mornUnopened: 0, next: undefined } });
    return { slot: "notes", kind: "said", line: r.line };
  },
};

// ------------------------------------------------------------------ a day question

const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_WORD = /\b(today|tonight|tomorrow|tmrw|kal|aaj|parso|(?:this |next )?(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?)\b/i;
const ASKS = /^(?:what'?s|what is|whats|what do i have|anything|am i (?:free|busy)|do i have|kya hai|kya)\b/i;

function dayKeyOf(word: string, today: string): string | null {
  const w = word.toLowerCase().trim();
  const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  if (w === "today" || w === "tonight" || w === "aaj") return today;
  if (w === "tomorrow" || w === "tmrw" || w === "kal") return shift(1);
  if (w === "parso") return shift(2);
  const next = w.startsWith("next ");
  const name = w.replace(/^(?:this|next) /, "").slice(0, 3);
  const want = WEEKDAY.indexOf(name);
  if (want < 0) return null;
  const now = new Date(`${today}T00:00:00Z`).getUTCDay();
  let n = (want - now + 7) % 7;
  if (next && n === 0) n = 7;
  return shift(n);
}

const DAY: BoxSlot<{ day: string }> = {
  slot: "day", step: 1,
  read(words, ctx) {
    const s = words.trim();
    if (!ASKS.test(s) && !/\?\s*$/.test(s)) return null;
    // "What's on Saturday?", "Anything tomorrow?", "kal kya hai?": a question about one day.
    const m = DAY_WORD.exec(s);
    if (!m || !(ASKS.test(s) || /^(?:on |and )?\S+\s*\?$/.test(s))) return null;
    const day = dayKeyOf(m[1]!, ctx.today);
    return day ? { day } : null;
  },
  async run(r, _w, ctx) {
    const rows = (await ctx.dayRows(r.day)).filter((x) => !x.done);
    const name = ctx.dayName(r.day);
    return {
      slot: "day", kind: "day", day: r.day, rows,
      line: rows.length ? `${name}: ${rows.slice(0, 3).map((x) => (x.time && x.time !== "All day" ? `${x.title} ${x.time}` : x.title)).join(", ")}${rows.length > 3 ? `, ${rows.length - 3} more` : ""}` : `Nothing on ${name === "Today" || name === "Tomorrow" ? name.toLowerCase() : name} yet.`,
    };
  },
};

// ------------------------------------------------------------------ an item

/**
 * A question, or a request for thinking: the chat answers those. A "?" at the end, a question word, or a verb that asks only with a
 * subject after it ("do I", "is it", "will we"): "Do laundry tomorrow", "Find passport Fri", "Plan Riya's party Sat" and "Help Arjun
 * with homework 6 pm" are things to do, and are added.
 */
const QUESTION = new RegExp([
  String.raw`\?\s*$`,
  String.raw`^(?:can|could|should|would|shall|how|why|when|where|which|who|whom|whose|what|what's|whats)\b`,
  String.raw`^(?:do|does|did|will|is|are|am|was|were|have|has)\s+(?:i|we|you|it|he|she|they|there|my|our|this|that|anything|anyone)\b`,
  String.raw`^(?:help me|suggest|free up)\b`,
].join("|"), "i");

const ITEM: BoxSlot<{ words: string }> = {
  slot: "item", step: 1,
  read(words, ctx) {
    const s = words.replace(/\s+/g, " ").trim();
    if (!s || s.length > 300 || QUESTION.test(s)) return null;
    const r = readLine(s, ctx.now, ctx.tz);
    return r.title ? { words: s } : null;
  },
  async run(r, _w, ctx) {
    const out = await ctx.calendar.quick(ctx.userId, r.words, { tz: ctx.tz });
    if (out.kind === "event") {
      const e = out.event;
      const when = e.allDay ? ctx.dayWords(e.day) : `${ctx.dayWords(e.day)}, ${clockWords(e.start, ctx.tz)}`;
      return { slot: "item", kind: "added", line: `Added: ${e.title}, ${when}`, undo: { item: `pe:${e.id.replace("@", ".")}:${e.day}`, action: "undo" } };
    }
    const t = out.task;
    const when = t.due ? `${ctx.dayName(t.due) === "Today" || ctx.dayName(t.due) === "Tomorrow" ? ctx.dayName(t.due).toLowerCase() : ctx.dayWords(t.due)}${t.at !== null ? `, ${clockWords(t.at, ctx.tz)}` : ""}` : "";
    return { slot: "item", kind: "added", line: `Added: ${t.title}${when ? `, ${when}` : ""}`, undo: { item: `pt:${t.id}`, action: "undo" } };
  },
};

function clockWords(ms: number, tz: number): string {
  const d = new Date(ms + tz * 60_000), h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

// ------------------------------------------------------------------ the chat: anything else

const CHAT: BoxSlot<true> = {
  slot: "chat", step: 1,
  read: () => true,
  async run() { return { slot: "chat", kind: "chat", line: "" }; },
};

// ------------------------------------------------------------------ "add this": what was on a desktop's screen

/**
 * First, and only when the words came with what was seen. One clear line ("Team offsite 14 Nov 10 am", with "on Friday" from the words)
 * is read by the slots that add a line (a wait, a due, an item), as if typed: "Added: … · Undo". A notice with several things in it
 * becomes the capture card, with its consent gate and Plan Ease's budget. Neither: the chat, and the desktop sends the words as before.
 */
const SEEN: BoxSlot<{ seen: Seen }> = {
  slot: "seen", step: 3,
  read: (_w, ctx) => (ctx.seen ? { seen: ctx.seen } : null),
  async run(r, words, ctx) {
    const line = seenLine(r.seen, words);
    if (line) {
      const one = await boxAnswer(line, { ...ctx, seen: undefined }, [...STEP_4_WAIT, ...STEP_3_DUE, ITEM as BoxSlot]);
      if (one.kind !== "chat") return one;
    }
    return (await seenCapture(ctx.userId, r.seen, ctx.tz)) ?? CHAT.run(true, words, ctx);
  },
};

// ------------------------------------------------------------------ the steps to come plug in here

/** Step 5: the family ask ("Who picks Kabir up Wednesday?" → the ask preview card), before anything else reads it. */
const STEP_5_FIRST: readonly BoxSlot[] = [ASK_SLOT as BoxSlot];
/** Step 3: a pasted circular or SMS (several lines) → the capture card. */
const STEP_3_CAPTURE: readonly BoxSlot[] = [CAPTURE_SLOT as BoxSlot, LINK_SLOT as BoxSlot];
/** Step 4: waiting on someone. Step 3: a due. Both before a plain item reads them as a to-do. */
const STEP_4_WAIT: readonly BoxSlot[] = [WAIT_SLOT as BoxSlot];
const STEP_3_DUE: readonly BoxSlot[] = [DUE_SLOT as BoxSlot];

export const BOX_SLOTS: readonly BoxSlot[] = [
  SEEN as BoxSlot, NOTES as BoxSlot, ...STEP_5_FIRST, ...STEP_3_CAPTURE, DAY as BoxSlot, ...STEP_4_WAIT, ...STEP_3_DUE, ITEM as BoxSlot, CHAT as BoxSlot,
];

/** What the box understood, answered. The chat when nothing else did. */
export async function boxAnswer(words: string, ctx: BoxCtx, slots: readonly BoxSlot[] = BOX_SLOTS): Promise<BoxReply> {
  for (const s of slots) {
    let r: unknown = null;
    try { r = s.read(words, ctx); } catch { r = null; }
    if (r === null || r === undefined) continue;
    return s.run(r, words, ctx);
  }
  return CHAT.run(true, words, ctx);
}

/** Which slot would take these words (tests, and the window's "add this" later): the read alone, nothing done. */
export function boxSlotFor(words: string, ctx: BoxCtx, slots: readonly BoxSlot[] = BOX_SLOTS): string {
  for (const s of slots) { try { if (s.read(words, ctx) !== null) return s.slot; } catch { /* the next */ } }
  return "chat";
}

/**
 * PLAN EASE'S "NEEDS YOU": ONE QUESTION AT A TIME (docs/plan-ease.md "Needs-you cards"; design A1, B4).
 *
 * Every question Plan Ease could ask the person is a card of some type. needsYou() asks every type for its cards, drops the ones
 * answered or left alone (plan_skips, keyed "<type>:<id>:<version>"), orders the rest by when each stops being useful (soonest first,
 * then the types' own order), and the first is THE card: one on the page, one on the widget, one in a note. Nothing is stored but the
 * answers, so a card answered anywhere (the page, the widget, a notification's button: all through the act door, POST /v1/widgets/act)
 * is gone everywhere at the next read.
 *
 * A card never has a "Not now": leaving it alone is an answer, and each type says what that does (its `until`, or its own memory).
 * At most 2 buttons, and the question and its reason line are short and plain.
 *
 * ADDING A TYPE (a later step): write a NeedsType (find: its cards from the person's day; its buttons' actions, answered in planEase.ts
 * PLAN_ACTS), give it its tie rank, and put it in NEEDS_TYPES. Pure: what it needs is in NeedsCtx.
 */
import type { PersonLook } from "./personLook.js";
import { isBooked, type DayItem } from "./planRows.js";
import { eventRefOf } from "../widgets/items.js";
import { placeText } from "./plan.js";
import { PLAN_IN_NEEDS } from "./planInCards.js";
import { WAIT_NEEDS } from "./planWaits.js";
import { ASK_NEEDS } from "./planAsks.js";

const MIN = 60_000, DAY = 24 * 60 * MIN;

/** A question for the person, ready to draw: on the page (screens/bots/planPage.ts), the widget (widgets/glance.ts), a note. */
export interface NeedsCard {
  /** Its type (NEEDS_TYPES). */
  type: string;
  /** What answering or leaving it is kept under (plan_skips): "<type>:<id>:<version>". */
  key: string;
  /** When it stops being useful; it goes by itself then. */
  until: number;
  question: string;
  /** One grey line: why. */
  reason: string;
  /** Words a person wrote or will send (a draft, an asker's words): drawn as a message, never outside the app. */
  message?: string;
  /** Whose question it is, when a person's: their tiny bot. */
  person?: { look: PersonLook; name: string };
  /** What the act door answers it on (widgets/items.ts), and its buttons: each id is the act's action. One or two, never three. */
  item: string;
  /**
   * Each button: its act, its words, and on the page the grey line that takes the card's place (`done`) with the act that undoes it
   * for 10 seconds (`undo`).
   */
  buttons: Array<{ id: string; label: string; primary?: boolean; done?: string; undo?: string; open?: { screen: string; params?: Record<string, string> } }>;
  /**
   * Its buttons as a notification's (planKinds.ts PLAN_CATEGORIES): the evening note carries the card with them. A card without one
   * rides in a note only when it is a Move card (x0_move).
   */
  category?: string;
  /** Only on the page: never on the widget or in a note (its buttons open a page there, like the work calendar's Link it). */
  inApp?: true;
  /**
   * A card whose answer needs the app (Send opens WhatsApp, a "No" that opens it): its question as said where it can't be answered
   * ("Still waiting on Rahul", with no "Send this?"). On the widget it is open-only: a tap opens X0 Bot, where both buttons are.
   */
  outside?: string;
  /** On the widget: no buttons, a tap opens the app (a card whose answer needs it). */
  openOnly?: true;
  /** A card answered by typing (the Home card): its field, and the route the words go to. */
  field?: { placeholder: string; path: string; save: string };
  /** What a Move card would do (planEase.ts moves it; the travel it saves is written down). */
  move?: { eventId: string; from: number; to: number; savedMin?: number };
}

/** What every type reads. */
export interface NeedsCtx {
  now: number;
  tz: number;
  today: string;
  tomorrow: string;
  /** Today's to a few days on, done ones too. */
  items: DayItem[];
  /** Answered or left alone: plan_skips keys, with when. */
  skipped: ReadonlyMap<string, number>;
  clock: (ms: number) => string;
  /** "Sat", "Mon 16": a day for a question. */
  dayWord: (key: string) => string;
  /** Travel, when places are on here: minutes between two items' places, when known. */
  travel?: { on: boolean; home: string; between?: (a: DayItem, b: DayItem) => number | undefined };
  /** The hours a move may go into, in minutes after midnight (9 am to 8 pm until they are learned). */
  hours?: { from: number; to: number };
  /** What the sources outside the own calendar say (planSources.ts sourceMore), by source name: the work calendar's link, captures. */
  more?: Readonly<Record<string, unknown>>;
}

export interface NeedsType {
  type: string;
  step: number;
  /** When two stop being useful at the same time: lower first (design A1: asks, waits, moves, captures, the calendar link, home). */
  tie: number;
  find(ctx: NeedsCtx): NeedsCard[];
  /** Lines the evening note says about `day` beyond the person's own items: who's doing what in the family ("Kabir pickup: Mom"). */
  notes?(ctx: NeedsCtx, day: string): string[];
}

// ------------------------------------------------------------------ Move

const dayOf = (ms: number, tz: number) => new Date(ms + tz * MIN).toISOString().slice(0, 10);
const startOfDay = (key: string, tz: number) => Date.parse(`${key}T00:00:00Z`) - tz * MIN;
const shiftDay = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const inLine = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const name = (it: DayItem) => it.title.split(" · ")[0]!.trim() || it.title;
const timed = (it: DayItem): it is DayItem & { start: number; end: number } => it.start !== null && it.end !== null && !it.allDay;

/** The person's own, and something we can move by moving our row: an event of theirs that isn't booked with anyone. */
export const movable = (it: DayItem): boolean => it.ref === "event" && !isBooked(it);

/**
 * Today's and tomorrow's two timed things that can't both happen: they overlap, or (both in real places, the trip known) there isn't
 * the trip and ten minutes between them. Back-to-back calls never are. Each pair once, in time order, with the gap.
 */
export function clashesOf(ctx: Pick<NeedsCtx, "items" | "now" | "tz" | "today" | "tomorrow" | "travel">): Array<{ a: DayItem; b: DayItem; gapMin: number; trip?: number }> {
  const out: Array<{ a: DayItem; b: DayItem; gapMin: number; trip?: number }> = [];
  for (const day of [ctx.today, ctx.tomorrow]) {
    const list = ctx.items.filter((it) => timed(it) && it.ref === "event" && !it.done && !it.free && it.day === day && it.end! > ctx.now).sort((x, y) => x.start! - y.start!);
    for (let i = 0; i + 1 < list.length; i += 1) {
      const a = list[i]!, b = list[i + 1]!;
      const gapMin = Math.round((b.start! - a.end!) / MIN);
      if (gapMin < 0) { out.push({ a, b, gapMin }); continue; }
      if (!placeText(a) || !placeText(b)) continue;
      const trip = ctx.travel?.on ? ctx.travel.between?.(a, b) : undefined;
      if (trip !== undefined && gapMin < trip + 10) out.push({ a, b, gapMin, trip });
    }
  }
  return out;
}

/** The first free start of `len` from `from`, within the hours, clear of everything by 15 minutes, on the half hour; over 3 days. */
function freeSlot(ctx: NeedsCtx, len: number, from: number, without: DayItem): number | null {
  const hours = ctx.hours ?? { from: 9 * 60, to: 20 * 60 };
  const busy = ctx.items.filter((it) => timed(it) && it.id !== without.id && it.ref === "event" && !it.free);
  const first = dayOf(from, ctx.tz);
  for (let d = 0; d <= 3; d += 1) {
    const k = shiftDay(first, d);
    const open = startOfDay(k, ctx.tz) + hours.from * MIN, close = startOfDay(k, ctx.tz) + hours.to * MIN;
    let t = Math.max(open, Math.ceil(from / (30 * MIN)) * 30 * MIN);
    for (; t + len <= close; t += 30 * MIN) {
      if (busy.every((e) => t + len + 15 * MIN <= e.start! || t >= e.end! + 15 * MIN)) return t;
    }
  }
  return null;
}

/**
 * Times an item could move to, for its details' Move (design A3): the first free start of each day from now on (within the hours,
 * clear of everything by 15 minutes), its own start left out, `n` at most, over the next 4 days. The person's own, movable, timed
 * things only: anything else is [] (a booked one is rebooked by them, not moved by us).
 */
export function freeTimes(ctx: NeedsCtx, it: DayItem, n = 3): number[] {
  if (!movable(it) || !timed(it) || it.repeat) return [];
  const len = it.end - it.start;
  const out: number[] = [];
  let from = Math.max(ctx.now + 30 * MIN, startOfDay(ctx.today, ctx.tz));
  for (let d = 0; d < 5 && out.length < n; d += 1) {
    const t = freeSlot(ctx, len, from, it);
    if (t === null) break;
    if (t !== it.start) out.push(t);
    // One a day: the next one is looked for from the following morning.
    from = startOfDay(shiftDay(dayOf(t, ctx.tz), 1), ctx.tz);
  }
  return out;
}

const MOVE: NeedsType = {
  type: "move", step: 1, tie: 2,
  find(ctx) {
    const cards: NeedsCard[] = [];
    for (const c of clashesOf(ctx)) {
      // Only the person's own movable thing is offered a move: the later one when both are, else whichever is. A clash with two
      // booked things is a grey line on both rows (planDay.ts), never a card.
      const move = movable(c.b) ? c.b : movable(c.a) ? c.a : null;
      if (!move || !timed(move)) continue;
      const other = move === c.a ? c.b : c.a;
      const key = `move:${move.id}:${move.start}`;
      if (ctx.skipped.has(key)) continue;
      const to = freeSlot(ctx, move.end - move.start, Math.max(ctx.now + 30 * MIN, move.end), move);
      if (to === null) continue;
      const sameDay = dayOf(to, ctx.tz) === move.day;
      const when = sameDay ? ctx.clock(to) : `${ctx.dayWord(dayOf(to, ctx.tz))} ${ctx.clock(to)}`;
      const reason = c.gapMin < 0
        ? `It overlaps ${inLine(name(other))} at ${ctx.clock(other.start!)}.`
        : `It's ${c.trip} min from ${inLine(name(c.a))} to ${inLine(name(c.b))}, with ${c.gapMin} min between.`;
      cards.push({
        type: "move", key, until: move.start, question: `Move ${inLine(name(move))} to ${when}?`, reason,
        item: `pm:${eventRefOf(move.id)}:${move.start}`,
        buttons: [
          { id: "move", label: "Move it", primary: true, done: `Moved to ${when}`, undo: "unmove" },
          { id: "keep", label: "Keep", done: "Kept as it is", undo: "unkeep" },
        ],
        move: { eventId: move.id, from: move.start, to },
      });
    }
    return cards;
  },
};

// ------------------------------------------------------------------ Home (once, only when it would first pay off)

/** Left alone, the Home card is not asked again for this long. */
export const HOME_AGAIN_MS = 30 * DAY;
/** When the Home card was first shown (a plan_skips row: its at_ms). */
export const HOME_SHOWN = "home:shown:1";

const HOME: NeedsType = {
  type: "home", step: 1, tie: 5,
  find(ctx) {
    const t = ctx.travel;
    if (!t?.on || t.home) return [];
    const there = ctx.items.some((it) => it.day === ctx.tomorrow && it.ref === "event" && !it.allDay && !!placeText(it));
    if (!there) return [];
    // Shown on the day it was first shown (planEase.ts keeps when, as HOME_SHOWN); then, left alone, not again for 30 days.
    const shown = ctx.skipped.get(HOME_SHOWN);
    if (shown !== undefined && dayOf(shown, ctx.tz) !== ctx.today && ctx.now - shown < HOME_AGAIN_MS) return [];
    const until = startOfDay(ctx.tomorrow, ctx.tz) - MIN;
    return [{
      type: "home", key: "home:ask:1", until, question: "Where do you leave from in the morning?", reason: "So I can tell you when to leave.",
      item: "", buttons: [], field: { placeholder: "Area, like Indiranagar", path: "/v1/botsapp/bots/plan/home", save: "Save" },
    }];
  },
};

// ------------------------------------------------------------------ the steps to come plug in here

/** Step 2: "link" (Show your work calendar here too?) and "linkStopped". Step 3: "capture". Step 4: "wait", "came". Step 5: "ask", "nobody". */
const LATER_TYPES: readonly NeedsType[] = [...PLAN_IN_NEEDS, WAIT_NEEDS, ASK_NEEDS];

export const NEEDS_TYPES: readonly NeedsType[] = [MOVE, HOME, ...LATER_TYPES];

/** Every card there is now, the one to show first. Never throws: a type that fails has no cards. */
export function needsYou(ctx: NeedsCtx, types: readonly NeedsType[] = NEEDS_TYPES): NeedsCard[] {
  const out: Array<NeedsCard & { tie: number }> = [];
  for (const t of types) {
    let cards: NeedsCard[] = [];
    try { cards = t.find(ctx); } catch { cards = []; }
    for (const c of cards) if (c.until > ctx.now && !ctx.skipped.has(c.key)) out.push({ ...c, tie: t.tie });
  }
  return out.sort((a, b) => a.until - b.until || a.tie - b.tie).map(({ tie: _t, ...c }) => c);
}

/** Every type's lines for the evening note about `day` (who's doing what in the family). Never throws: a type that fails says nothing. */
export function noteLinesOf(ctx: NeedsCtx, day: string, types: readonly NeedsType[] = NEEDS_TYPES): string[] {
  const out: string[] = [];
  for (const t of types) { try { out.push(...(t.notes?.(ctx, day) ?? [])); } catch { /* nothing from it */ } }
  return out;
}

/** A card's question lands within the minute (a day note, the widget): the leave-alone rule is the type's, so this one is just the first. */
export const firstNeeds = (ctx: NeedsCtx, types?: readonly NeedsType[]): NeedsCard | null => needsYou(ctx, types)[0] ?? null;

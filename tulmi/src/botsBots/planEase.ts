/**
 * PLAN EASE, THE SIMPLER ONE: THE SERVICE (docs/plan-ease.md). It reads the person's own calendar (src/calendar) and draws nothing
 * itself: the page, the widget, Home, Today, the notes and the buttons all ask here, so the same card and the same line show
 * everywhere, and an answer in one place is gone from all of them.
 *
 *   read(user, tz)          the Plan page (planDay.ts): the one next thing, the one Needs-you card, Today and Tomorrow, the week after
 *   week(user, tz)          "See the week": seven days from today, each day's rows
 *   box(user, words, tz, seen?)  what the one box understood (planBox.ts), done; `seen`: what a desktop's "add this" carried
 *   act(user, item, action) a button, from the page, the widget or a notification (the act door, widgets/act.ts): PLAN_ACTS
 *   line(user, tz)          Home's line (the one thing), the widget's line and lock words, and the card the widget asks
 *   policy                  what the reminder sweep asks (calendar/service.ts ReminderPolicy): a leave-by already sent, the day's 6
 *   notesTick / leavesTick  every minute: the day notes that are due (planNotes.ts), the leave-by reminders that are due
 *   opened(user, kind)      a day note was opened (push/engine.ts setPushOpenHook): it counts, and the quiet rule starts again
 *   rides(user, day)        whether the Daily summary rides in tonight's evening note, so it isn't sent on its own (you/push.ts)
 *
 * Rules and templates only, so it costs nothing to run every day: what needs thinking is the Plan Ease chat's, through its own route,
 * consent and budget.
 */
import { BotError } from "../bots/types.js";
import { calendar as ownCalendar, type Calendar, type CalEvent } from "../calendar/index.js";
import { dayName as calDayName, dayOf, dayWords as calDayWords, shiftDay, startOfDay } from "../calendar/words.js";
import { botTopic, TOPIC } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { ok, no, type ActResult } from "../widgets/act.js";
import { eventIdOf, eventRefOf, itemId, type QuickItem } from "../widgets/items.js";
import type { WidgetScope } from "../widgets/token.js";
import { planEvent, placeText, type PlanSkipRow } from "./plan.js";
import { boxAnswer, type BoxReply } from "./planBox.js";
import { seenOf } from "./planInBox.js";
import { clockOf, longDate, planPage, weekday, widgetLine, widgetSteps, type Leave, type PlanPage, type WidgetLine } from "./planDay.js";
import { HOME_SHOWN, clashesOf, freeTimes, movable, needsYou, noteLinesOf, type NeedsCard, type NeedsCtx } from "./planNeeds.js";
import { changesSince, eveningMinute, eveningNote, morningAt, morningNote, OPENS_KEPT, signature, type NoteWords } from "./planNotes.js";
import { planPrefs, type PlanPrefs, type PlanPrefsRow } from "./planPrefs.js";
import { dayItems, rowOf, type DayItem, type RowNote, type RowView } from "./planRows.js";
import { looksHealth, lockSafe, safeTitle } from "./planSafe.js";
import { followOn, planOn } from "./planSwitch.js";
import type { PlanTravelling } from "./planTravel.js";
import type { CallSeed } from "./planCallWords.js";
import { table, type Table } from "./rows.js";
import { PLAN_IN_ACTS } from "./planInActs.js";
import { WAIT_ACTS } from "./planWaits.js";
import { ASK_ACTS } from "./planAsks.js";
import { FOLLOW_ACTS, followLinesOf, planFollows, type ItemFollow } from "./planFollow.js";
import type { FollowCandidate } from "../calendar/index.js";
import { beforeNote, sourceEvening, sourceItems, sourceMore, sourceMorning, sourceSeen, type SourceWindow } from "./planSources.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** How far the page reads: today and the week after it. */
const READ_DAYS = 8;
/** Plan Ease's own pushes a day, besides the day note and the person's own timed reminders. */
export const DAY_CAP = 6;
/** A note more than this late (the server was down) is not sent: the moment has gone. */
const NOTE_LATE_MS = 3 * HOUR;
/** Evening notes in a row never opened before the evening one stops (then the morning one, the same, before they stop too). */
export const QUIET_AFTER = 5;

/** What an item's details show beyond the item (screens/planItem.ts): read by GET .../plan/details. */
export interface ItemDetails {
  /** Its "before" steps, each with a tick ("Buy fruit costume · by Wed"). */
  before: Array<{ id: string; title: string; day: string | null; done: boolean }>;
  /** Move's 3 times we picked (only the person's own movable events). */
  moves: Array<{ at: number; day: string; time: string; label: string }>;
  /** "leave by 5:30 pm, 30 min drive", when travel knows it. */
  leave?: string;
  /** The newest note someone in a space left on it, with their tiny bot (inside the app only). */
  note?: RowNote;
  /** Follow-through (PLAN_V2_FOLLOW, planFollow.ts): how important it is, who does it, and its open follow's line. */
  follow?: ItemFollow;
}

/**
 * Notes others left on the person's own items (the "notes" source: Work in space's notes on mine), by row id ("e:<id>", "t:<id>"),
 * newest first wins: the row's grey line, "Mom: I'll come with you", with Mom's tiny bot.
 */
export function notesOf(more: Readonly<Record<string, unknown>> | undefined): Map<string, RowNote> {
  const out = new Map<string, RowNote>();
  const list = more?.notes;
  if (!Array.isArray(list)) return out;
  for (const n of list as Array<{ itemId?: unknown; by?: unknown; byBot?: unknown; text?: unknown }>) {
    if (typeof n.itemId !== "string" || typeof n.text !== "string" || !n.text.trim() || out.has(n.itemId) || !n.byBot) continue;
    out.set(n.itemId, { look: n.byBot as RowNote["look"], name: typeof n.by === "string" && n.by ? n.by : "Someone", text: n.text.replace(/\s+/g, " ").trim().slice(0, 140) });
  }
  return out;
}

const hhmm = (ms: number, tz: number): string => { const d = new Date(ms + tz * MIN); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

/** What a note or a leave-by reminder is sent with (the push engine's notify). */
export type PlanSend = (userId: string, msg: { kind: string; key: string; vars: Record<string, string>; data?: Record<string, string>; category?: string; call?: CallSeed }) => Promise<unknown>;

/** The Daily summary's line for today, when the person has it on and something happened (you/push.ts); null otherwise. */
export type SummaryLine = (userId: string, tz: number, now: number) => Promise<{ line: string; time: string } | null>;

/**
 * THE DAILY SUMMARY, FOLDED IN (routes/bots/botsYou.ts sets these, where the summary's records are): its line for today, and how it
 * goes on its own when there is no evening note to ride in (tomorrow is empty). One evening push, not two.
 */
const summary: { line: SummaryLine | null; alone: ((userId: string, s: { line: string; time: string }, day: string) => Promise<unknown>) | null } = { line: null, alone: null };
export function setPlanSummary(o: { line: SummaryLine; alone: (userId: string, s: { line: string; time: string }, day: string) => Promise<unknown> } | null): void {
  summary.line = o?.line ?? null;
  summary.alone = o?.alone ?? null;
}

export interface PlanEaseDeps {
  calendar?: Calendar;
  prefs?: PlanPrefs;
  skips?: Table<PlanSkipRow>;
  travel?: PlanTravelling | null;
  now?: () => number;
  send?: PlanSend;
  /** Whether the app is in Hinglish for this person (the notes' few fixed words). */
  hinglish?: (userId: string) => Promise<boolean>;
}

/** One button of Plan Ease's, as the act door runs it: what a widget needs to press it, and what it does. */
export interface PlanAct {
  scope: WidgetScope | "session";
  run(p: PlanEase, userId: string, item: QuickItem, tz: number): Promise<ActResult>;
}

const taskId = (item: QuickItem): string => (item.kind === "pt" ? item.taskId : "");

/**
 * EVERY BUTTON PLAN EASE HAS, by item kind and action (widgets/items.ts pt: / pe: / pm: / pc:). A later step adds its own here (a due's
 * Paid on pt:, Add all on pc:, a family ask's take and cant on stask:) and they answer from the page, the widget and a notification
 * at once.
 */
export const PLAN_ACTS: Record<string, Record<string, PlanAct>> = {
  pt: {
    done: { scope: "task.done", run: async (p, u, i) => { await p.calendar.tickTask(u, taskId(i), true); return ok("done"); } },
    undone: { scope: "task.done", run: async (p, u, i) => { await p.calendar.tickTask(u, taskId(i), false); return ok("done"); } },
    later: {
      scope: "task.done",
      run: async (p, u, i) => {
        const r = await p.calendar.later(u, taskId(i));
        return ok(r.quiet ? "kept" : "later", r.quiet ? { message: "It stays on your Plan." } : {});
      },
    },
    // The box's Undo: only the person's own (the calendar refuses anyone else's).
    undo: { scope: "session", run: async (p, u, i) => { await p.calendar.removeTask(u, taskId(i)); return ok("undone"); } },
  },
  pe: {
    undo: { scope: "session", run: async (p, u, i) => { if (i.kind !== "pe") return no(400, "bad_request", "That can only be opened."); await p.calendar.removeEvent(u, eventIdOf(i.eventRef)); return ok("undone"); } },
  },
  pm: {
    move: { scope: "needs.answer", run: (p, u, i, tz) => p.answerMove(u, i, tz, "move") },
    keep: { scope: "needs.answer", run: (p, u, i, tz) => p.answerMove(u, i, tz, "keep") },
    // The page's 10-second Undo: back to the start the card was about; the Keep forgotten.
    unmove: { scope: "session", run: (p, u, i) => p.undoMove(u, i, "unmove") },
    unkeep: { scope: "session", run: (p, u, i) => p.undoMove(u, i, "unkeep") },
  },
};
// Steps 2 and 3's buttons (planInActs.ts): a bill's Paid, a capture's Add all and Undo, the work calendar offer's No thanks.
for (const [kind, acts] of Object.entries(PLAN_IN_ACTS)) PLAN_ACTS[kind] = { ...(PLAN_ACTS[kind] ?? {}), ...acts };
// Steps 4, 5 and 6's: a wait's Sorted, Send, Yes and No (planWaits.ts); a family ask's Ask, I'll do it, I'm in, Can't do it (planAsks.ts);
// a followed item's Done, Later, Can't, I'll do it, Undone, Allow and Not now (planFollow.ts, pf:<followId>:<n>).
for (const [kind, acts] of Object.entries({ pt: WAIT_ACTS, stask: ASK_ACTS, pf: FOLLOW_ACTS })) PLAN_ACTS[kind] = { ...(PLAN_ACTS[kind] ?? {}), ...acts };

export class PlanEase {
  readonly calendar: Calendar;
  readonly prefs: PlanPrefs;
  private readonly skips: Table<PlanSkipRow>;
  private travel: PlanTravelling | null;
  private readonly now: () => number;
  private send: PlanSend | null;
  private hinglish: ((userId: string) => Promise<boolean>) | null;
  /** Follow-through's arming (planFollow.ts arm), wired at boot: asked by the calendar before a reminder goes. */
  private followArm: ((userId: string, c: FollowCandidate) => Promise<boolean>) | null = null;
  /** People whose row this server has seen to (their offset kept, a note time set), so it isn't read on every request. */
  private readonly ensured = new Set<string>();

  constructor(d: PlanEaseDeps = {}) {
    this.calendar = d.calendar ?? ownCalendar();
    this.now = d.now ?? Date.now;
    this.prefs = d.prefs ?? planPrefs(this.now);
    this.skips = d.skips ?? table<PlanSkipRow>("plan_skips");
    this.travel = d.travel ?? null;
    this.send = d.send ?? null;
    this.hinglish = d.hinglish ?? null;
  }

  /** Where answers are kept (plan_skips): what a later step's own cards and buttons remember, in the same place as these. */
  get answers(): Table<PlanSkipRow> { return this.skips; }

  /** The push engine's notify (wired at boot: routes/bots/botsBots.ts), and who says the app's language. */
  wire(o: { send?: PlanSend | null; hinglish?: ((userId: string) => Promise<boolean>) | null; follow?: ((userId: string, c: FollowCandidate) => Promise<boolean>) | null }): void {
    if (o.send !== undefined) this.send = o.send;
    if (o.hinglish !== undefined) this.hinglish = o.hinglish;
    if (o.follow !== undefined) this.followArm = o.follow;
  }

  /**
   * Its calendar asks here: before a reminder goes (the policy below), and for the person's offset, which is kept in their row
   * (plan_prefs.tz_min) so a restart or a second server knows it.
   */
  attach(): void {
    this.calendar.setReminderPolicy(this.policy);
    this.calendar.keepTz({
      // A new offset is kept, and someone the calendar hears from for the first time gets their row and their first note's time.
      said: (userId, tz) => { this.ensured.delete(userId); void this.ensure(userId, tz).catch(() => undefined); },
      load: async (userId) => (await this.prefs.get(userId))?.tz_min ?? null,
    });
  }

  /** The calendar asks here: a leave-by already sent, and whether one more of Plan Ease's own pushes fits today. */
  readonly policy = {
    leaveSent: async (userId: string, eventId: string, start: number): Promise<boolean> =>
      !!(await this.prefs.get(userId))?.leaves?.some((l) => l.eventId === eventId && l.start === start && l.sent),
    spend: async (userId: string, day: string): Promise<boolean> => {
      const row = await this.prefs.get(userId);
      const n = row?.sent?.day === day ? row.sent.n ?? 0 : 0;
      if (n >= DAY_CAP) return false;
      await this.prefs.patch(userId, { sent: { day, n: n + 1 } });
      return true;
    },
    /** Follow-through: this occurrence is followed (planFollow.ts), so the calendar's own push is not sent. */
    follow: async (userId: string, c: FollowCandidate): Promise<boolean> => (this.followArm ? this.followArm(userId, c) : false),
  };

  // ------------------------------------------------------------------ the person's days

  /** Today and the days after, as DayItems, and today's and tomorrow's leave-by times when places are on. */
  private async load(userId: string, tz: number, o: { travel?: boolean } = {}): Promise<{ items: DayItem[]; leaves: Map<string, Leave>; today: string; tomorrow: string; row: PlanPrefsRow | null; events: CalEvent[]; more: Record<string, unknown> }> {
    const now = this.now();
    const today = dayOf(now, tz), tomorrow = shiftDay(today, 1);
    // What lives outside the own calendar (planSources.ts: the work calendar's meetings) is on the same days, read at the same time.
    const w = this.window(tz, today, now);
    const [listed, row, extra, more] = await Promise.all([
      this.calendar.list(userId, { from: today, to: shiftDay(today, READ_DAYS), tz }),
      this.prefs.get(userId).catch(() => null),
      sourceItems(userId, w),
      sourceMore(userId, w),
    ]);
    const items = [...dayItems(listed), ...extra];
    const leaves = new Map<string, Leave>();
    for (const l of row?.leaves ?? []) if (l.start > now) leaves.set(l.eventId, { leaveBy: l.leaveBy, minutes: l.minutes, mode: l.mode, to: l.to });
    const travel = this.travel;
    if (o.travel !== false && travel?.on) {
      // Both days at once, so the page waits for its lookups once (planTravel.ts: 1.2 s at most), not twice.
      const got = await Promise.all([today, tomorrow].map((day) => travel.plan(userId, {
        tz, events: listed.events.filter((e) => e.day === day).map(planEvent), tomorrow: day, suggest: () => null, keepShown: false,
      }).catch(() => null)));
      for (const r of got) for (const leg of r?.travel.legs ?? []) leaves.set(leg.toId, { leaveBy: leg.leaveBy, minutes: leg.minutes, mode: leg.mode, to: leg.to });
    }
    return { items, leaves, today, tomorrow, row, events: listed.events, more };
  }

  /** The days the page reads, for the sources. */
  private window(tz: number, today: string, now: number): SourceWindow {
    return { from: today, to: shiftDay(today, READ_DAYS), fromMs: startOfDay(today, tz), toMs: startOfDay(shiftDay(today, READ_DAYS + 1), tz), tz, now };
  }

  private async skipped(userId: string): Promise<Map<string, number>> {
    return new Map((await this.skips.select({ user_id: userId }, { limit: 500 }).catch(() => [])).map((s) => [s.key, Number(s.at_ms)]));
  }

  private needsCtx(o: { tz: number; today: string; tomorrow: string; items: DayItem[]; skipped: Map<string, number>; leaves: Map<string, Leave>; row: PlanPrefsRow | null; more?: Record<string, unknown> }): NeedsCtx {
    const travelOn = !!this.travel?.on;
    return {
      now: this.now(), tz: o.tz, today: o.today, tomorrow: o.tomorrow, items: o.items, skipped: o.skipped, ...(o.more ? { more: o.more } : {}),
      // A move goes at most 3 days on: the weekday alone says which ("Sat 11 am").
      clock: (ms) => clockOf(ms, o.tz), dayWord: (k) => (k === o.tomorrow ? "tomorrow" : weekday(k)),
      travel: {
        on: travelOn, home: o.row?.home ?? "",
        // A trip's minutes between two stops: known from the leave-by worked out for the later one, when it leaves from the earlier.
        between: (a, b) => (placeText(a) && placeText(b) ? o.leaves.get(b.id)?.minutes : undefined),
      },
    };
  }

  /** Two booked things that can't both happen: "Clashes with design review" on both rows. */
  private clashLines(ctx: NeedsCtx): Map<string, string> {
    const out = new Map<string, string>();
    for (const c of clashesOf(ctx)) {
      if (movable(c.a) || movable(c.b)) continue;
      const name = (it: DayItem) => inLine(it.title.split(" · ")[0]!.trim() || it.title);
      if (!out.has(c.a.id)) out.set(c.a.id, `Clashes with ${name(c.b)}`);
      if (!out.has(c.b.id)) out.set(c.b.id, `Clashes with ${name(c.a)}`);
    }
    return out;
  }

  /** The cards there are now, the first shown. The Home card's first showing is kept (left alone, not again for 30 days). */
  private async cards(userId: string, l: Awaited<ReturnType<PlanEase["load"]>>, tz: number): Promise<{ cards: NeedsCard[]; ctx: NeedsCtx }> {
    const skipped = await this.skipped(userId);
    const ctx = this.needsCtx({ tz, today: l.today, tomorrow: l.tomorrow, items: l.items, skipped, leaves: l.leaves, row: l.row, more: l.more });
    const cards = needsYou(ctx);
    const first = cards[0];
    if (first?.type === "home" && !skipped.has(HOME_SHOWN)) await this.skips.upsert({ user_id: userId, key: HOME_SHOWN, at_ms: this.now() }, ["user_id", "key"]).catch(() => undefined);
    if (first?.type === "move" && first.move && this.travel) {
      await this.travel.keepShown(userId, l.row, { eventId: first.move.eventId, startIso: new Date(first.move.to).toISOString(), key: first.key }).catch(() => undefined);
    }
    return { cards, ctx };
  }

  async read(userId: string, tzIn: number): Promise<PlanPage & { travel: { on: boolean } }> {
    const tz = clampTz(tzIn);
    await Promise.all([this.seen(userId, tz), sourceSeen(userId, tz, this.now())]);
    const l = await this.load(userId, tz);
    const { cards, ctx } = await this.cards(userId, l, tz);
    return {
      ...planPage({ now: this.now(), tz, today: l.today, tomorrow: l.tomorrow, items: l.items, leaves: l.leaves, clashes: this.clashLines(ctx), needs: cards[0] ?? null, notes: notesOf(l.more), follow: followLinesOf(l.more) }),
      travel: { on: !!this.travel?.on },
    };
  }

  /**
   * What an item's details add to the item itself (screens/planItem.ts, design A3): its "before" steps with their ticks, the leave-by
   * when travel knows it, the newest note someone left on it, and for the person's own movable event the 3 times we picked for Move.
   */
  async details(userId: string, kind: unknown, id: unknown, tzIn: number): Promise<ItemDetails> {
    const tz = clampTz(tzIn);
    if ((kind !== "event" && kind !== "task") || typeof id !== "string" || !id || id.length > 120) return { before: [], moves: [] };
    const l = await this.load(userId, tz, { travel: false });
    const it = l.items.find((x) => x.ref === kind && x.id === id) ?? null;
    const before = (await this.calendar.list(userId, { from: l.today, to: shiftDay(l.today, 60), tz }).catch(() => null))?.tasks
      .filter((t) => t.prepFor && (t.prepFor === id || t.prepFor === id.split("@")[0])).slice(0, 4)
      .map((t) => ({ id: t.id, title: t.title, day: t.due, done: t.done })) ?? [];
    const out: ItemDetails = { before, moves: [] };
    const leave = kind === "event" ? l.leaves.get(id) : undefined;
    if (leave) out.leave = `leave by ${clockOf(leave.leaveBy, tz)}, ${leave.minutes} min ${leave.mode === "walk" ? "walk" : "drive"}`;
    const note = notesOf(l.more).get(`${kind === "event" ? "e" : "t"}:${id}`);
    if (note) out.note = note;
    if (followOn()) {
      const follow = await planFollows().itemFollow(userId, kind, id).catch(() => null);
      if (follow) out.follow = follow;
    }
    if (it && kind === "event") {
      const ctx = this.needsCtx({ tz, today: l.today, tomorrow: l.tomorrow, items: l.items, skipped: new Map(), leaves: l.leaves, row: l.row, more: l.more });
      out.moves = freeTimes(ctx, it).map((at) => {
        const day = dayOf(at, tz);
        return { at, day, time: hhmm(at, tz), label: `${day === l.today ? "Today" : day === l.tomorrow ? "Tomorrow" : weekday(day)} ${clockOf(at, tz)}` };
      });
    }
    return out;
  }

  /** "See the week": seven days from today, each with its rows (done ones last). */
  async week(userId: string, tzIn: number): Promise<{ today: string; days: Array<{ key: string; date: string; rows: RowView[] }> }> {
    const tz = clampTz(tzIn);
    const l = await this.load(userId, tz, { travel: false });
    const ctx = { tz, now: this.now(), clock: (ms: number) => clockOf(ms, tz), leaves: l.leaves, clashes: new Map<string, string>(), notes: notesOf(l.more) };
    const days = Array.from({ length: 7 }, (_, n) => shiftDay(l.today, n)).map((key) => ({
      key, date: longDate(key),
      rows: l.items.filter((it) => it.day === key).map((it) => rowOf(it, ctx)).sort((a, b) => Number(a.done) - Number(b.done) || a.at - b.at),
    }));
    return { today: l.today, days };
  }

  async box(userId: string, wordsIn: unknown, tzIn: unknown, seenIn?: unknown): Promise<BoxReply> {
    // A desktop's "add this" brings what was on its screen (planInBox.ts seenOf): read here and never kept.
    const seen = seenIn == null ? null : seenOf(seenIn);
    // "Add this" with nothing readable that was seen: the words alone would add a to-do called "this", so the desktop sends them as before.
    if (seenIn != null && !seen) return { slot: "seen", kind: "chat", line: "" };
    const words = typeof wordsIn === "string" && wordsIn.trim() ? wordsIn : seen ? "add this" : wordsIn;
    if (typeof words !== "string" || !words.trim()) throw new BotError("bad_request", "Say what to add, like Dentist Fri 5 pm.");
    if (words.length > 2000) throw new BotError("too_large", "That's a lot of words. Try a shorter one.", 413);
    const tz = clampTz(Number(tzIn));
    const now = this.now();
    const today = dayOf(now, tz);
    const l = { load: () => this.load(userId, tz, { travel: false }) };
    const reply = await boxAnswer(words, {
      userId, now, tz, today, calendar: this.calendar, prefs: this.prefs, ...(seen ? { seen } : {}),
      dayWords: (k) => calDayWords(k), dayName: (k) => calDayName(k, today),
      dayRows: async (day) => {
        const got = await l.load();
        const ctx = { tz, now, clock: (ms: number) => clockOf(ms, tz), leaves: got.leaves, clashes: new Map<string, string>() };
        return got.items.filter((it) => it.day === day).map((it) => rowOf(it, ctx)).sort((a, b) => a.at - b.at);
      },
    });
    // Notes said back on (or off) in the box: the next one's time is worked out afresh.
    if (reply.slot === "notes") { this.ensured.delete(userId); await this.ensure(userId, tz, { reschedule: true }); }
    return reply;
  }

  // ------------------------------------------------------------------ the act door

  scope(item: QuickItem, action: string): WidgetScope | "session" | null {
    return PLAN_ACTS[item.kind]?.[action]?.scope ?? null;
  }

  async act(userId: string, item: QuickItem, action: string): Promise<ActResult> {
    const a = PLAN_ACTS[item.kind]?.[action];
    if (!a) return no(400, "bad_request", "That button doesn't do anything here.");
    const row = await this.prefs.get(userId).catch(() => null);
    const tz = row?.tz_min ?? (await this.calendar.tzOf(userId));
    const out = await a.run(this, userId, item, tz);
    if (out.status === 200) {
      await this.actedOn(userId, row).catch(() => undefined);
      livePublish(userId, [botTopic("plan"), TOPIC.home]);
    }
    return out;
  }

  /** Move it / Keep on a Move card: only the card that is there now, for the start it was about (a stale button answers nothing). */
  async answerMove(userId: string, item: QuickItem, tz: number, action: "move" | "keep"): Promise<ActResult> {
    if (item.kind !== "pm") return no(400, "bad_request", "That can only be opened.");
    const eventId = eventIdOf(item.eventRef);
    const key = `move:${eventId}:${item.start}`;
    if (action === "keep") {
      await this.skips.upsert({ user_id: userId, key, at_ms: this.now() }, ["user_id", "key"]);
      return ok("kept");
    }
    const l = await this.load(userId, tz);
    const { cards } = await this.cards(userId, l, tz);
    const card = cards.find((c) => c.type === "move" && c.key === key);
    if (!card?.move) return no(409, "not_waiting", "That was already answered.");
    await this.calendar.moveEvent(userId, eventId, card.move.to);
    await this.travel?.moved(userId, eventId, new Date(card.move.to).toISOString()).catch(() => undefined);
    return ok("moved", { message: `Moved to ${clockOf(card.move.to, tz)}` });
  }

  /** Undo a Move card's answer: the event back where it was, or the Keep forgotten so the card can come back. */
  async undoMove(userId: string, item: QuickItem, action: "unmove" | "unkeep"): Promise<ActResult> {
    if (item.kind !== "pm") return no(400, "bad_request", "That can only be opened.");
    const eventId = eventIdOf(item.eventRef);
    if (action === "unkeep") {
      await this.skips.remove({ user_id: userId, key: `move:${eventId}:${item.start}` });
      return ok("undone");
    }
    // One start of a series moved alone became an event of its own: only a single event goes back.
    if (eventId.includes("@")) return no(409, "not_waiting", "Change it in its details.");
    await this.calendar.moveEvent(userId, eventId, Number(item.start));
    return ok("undone");
  }

  // ------------------------------------------------------------------ Home, Today and the widget

  /**
   * The one thing, for Home's tile (in the app: full words), and outside the app the widget's line, its lock words and the one card it
   * asks (lock-safe: no amount, no health words, never a person's own words).
   */
  async line(userId: string, tzIn: number, o: { steps?: boolean } = {}): Promise<{ next: string; widget: WidgetLine | null; needs: NeedsCard | null; card: NeedsCard | null; steps?: Array<{ at: number; widget: WidgetLine | null }> }> {
    const tz = clampTz(tzIn);
    const l = await this.load(userId, tz, { travel: false });
    const { cards, ctx } = await this.cards(userId, l, tz);
    const now = this.now();
    const page = planPage({ now, tz, today: l.today, tomorrow: l.tomorrow, items: l.items, leaves: l.leaves, clashes: this.clashLines(ctx), needs: cards[0] ?? null });
    const day = { items: l.items, leaves: l.leaves, now, tz, today: l.today, tomorrow: l.tomorrow };
    return {
      next: page.next.rung === 6 ? "" : page.next.big,
      widget: widgetLine(day),
      needs: widgetCard(cards),
      // Today, inside the app, asks the page's own card: its draft, and buttons that open a page too.
      card: cards[0] ?? null,
      // A widget that switches its lines on its own is given them ahead (planDay.ts widgetSteps).
      ...(o.steps ? { steps: widgetSteps(day) } : {}),
    };
  }

  // ------------------------------------------------------------------ the person's row: offset, note times, what was opened

  /** The person's row is there, with their offset and their next note's time. Once a process, unless asked again. */
  async ensure(userId: string, tz: number, o: { reschedule?: boolean } = {}): Promise<void> {
    if (this.ensured.has(userId) && !o.reschedule) return;
    this.ensured.add(userId);
    if (this.ensured.size > 50_000) this.ensured.delete(this.ensured.values().next().value!);
    const row = await this.prefs.get(userId).catch(() => null);
    const patch: Partial<PlanPrefsRow> = {};
    if (!row || row.tz_min !== tz) patch.tz_min = tz;
    const notes = row?.notes ?? "both";
    if (planOn("notes") && notes !== "off" && (o.reschedule || !row?.next_note_ms)) {
      const next = this.nextNote(row, tz, notes, this.now());
      patch.next_note_ms = next.at;
      patch.note = { ...(row?.note ?? {}), next: next.kind };
    }
    if (Object.keys(patch).length) await this.prefs.patch(userId, patch).catch(() => undefined);
  }

  /** The next note from `after`: the evening one, the morning one, or whichever comes first when both go. */
  private nextNote(row: PlanPrefsRow | null, tz: number, notes: "both" | "evening" | "morning", after: number, firstLeave: number | null = null): { at: number; kind: "evening" | "morning" } {
    const today = dayOf(after, tz);
    const eveMin = row?.evening_min ?? 20 * 60 + 30, mornMin = row?.morning_min ?? 7 * 60 + 30;
    const evening = (k: string) => startOfDay(k, tz) + eveMin * MIN;
    const morning = (k: string) => morningAt(k, tz, mornMin, k === shiftDay(today, 1) ? firstLeave : null);
    const cand: Array<{ at: number; kind: "evening" | "morning" }> = [];
    for (const k of [today, shiftDay(today, 1), shiftDay(today, 2)]) {
      if (notes !== "morning") cand.push({ at: evening(k), kind: "evening" });
      if (notes !== "evening") cand.push({ at: morning(k), kind: "morning" });
    }
    return cand.filter((c) => c.at > after).sort((a, b) => a.at - b.at)[0]!;
  }

  /**
   * The note after one of `kind` on `day`: after the evening one, tomorrow's morning one (or tomorrow evening's, when only evenings go);
   * after the morning one, that evening's (or tomorrow morning's). Never one already past.
   */
  private following(row: PlanPrefsRow | null, tz: number, notes: "both" | "evening" | "morning", kind: "evening" | "morning", day: string, firstLeave: number | null = null): { at: number; kind: "evening" | "morning" } {
    const eveMin = row?.evening_min ?? 20 * 60 + 30, mornMin = row?.morning_min ?? 7 * 60 + 30;
    const next = shiftDay(day, 1);
    const evening = (k: string) => ({ at: startOfDay(k, tz) + eveMin * MIN, kind: "evening" as const });
    const morning = (k: string) => ({ at: morningAt(k, tz, mornMin, k === next ? firstLeave : null), kind: "morning" as const });
    const out = kind === "evening"
      ? (notes === "evening" ? evening(next) : morning(next))
      : (notes === "morning" ? morning(next) : evening(day));
    return out.at > this.now() ? out : this.nextNote(row, tz, notes, this.now());
  }

  /** The Plan page was opened: today's opening counts for the notes, and evening opens teach the evening note its time. */
  async seen(userId: string, tz: number): Promise<void> {
    await this.ensure(userId, tz).catch(() => undefined);
    if (!planOn("notes")) return;
    const now = this.now();
    const row = await this.prefs.get(userId).catch(() => null);
    if (!row) return;
    const note = { ...(row.note ?? {}), openedAt: now };
    let unopened = row.unopened ?? 0;
    if (note.eveningAt && now > note.eveningAt && now - note.eveningAt < 14 * HOUR) { note.eveningOpened = true; unopened = 0; }
    if (note.morningAt && now > note.morningAt && dayOf(now, tz) === note.morningFor) { note.morningOpened = true; note.mornUnopened = 0; }
    const min = Math.round(((now + tz * MIN) % DAY) / MIN);
    const day = dayOf(now, tz);
    const opens = [...(row.opens ?? [])];
    if (min >= 17 * 60 && !opens.some((o) => o.day === day)) opens.push({ day, min });
    const learned = eveningMinute(opens.slice(-OPENS_KEPT), row.evening_min ?? 20 * 60 + 30);
    // A page read again within minutes changes nothing worth a write.
    const news = unopened !== (row.unopened ?? 0) || note.eveningOpened !== row.note?.eveningOpened || note.morningOpened !== row.note?.morningOpened
      || opens.length !== (row.opens ?? []).length || learned !== row.evening_min;
    if (!news && row.note?.openedAt && now - row.note.openedAt < 5 * MIN) return;
    await this.prefs.patch(userId, {
      note, unopened, opens: opens.slice(-OPENS_KEPT),
      ...(learned !== row.evening_min ? { evening_min: learned } : {}),
    }).catch(() => undefined);
  }

  /** A day note was opened from the notification. */
  async opened(userId: string, kind: string): Promise<void> {
    if (kind !== "plan_evening" && kind !== "plan_morning") return;
    const row = await this.prefs.get(userId).catch(() => null);
    if (!row) return;
    const note = { ...(row.note ?? {}) };
    if (kind === "plan_evening") note.eveningOpened = true; else { note.morningOpened = true; note.mornUnopened = 0; }
    await this.prefs.patch(userId, { note, ...(kind === "plan_evening" ? { unopened: 0 } : {}) }).catch(() => undefined);
  }

  /** A button answered while a note was fresh: that counts as the note acted on. */
  private async actedOn(userId: string, row: PlanPrefsRow | null): Promise<void> {
    const note = row?.note;
    if (!row || !note?.eveningAt || note.eveningOpened || this.now() - note.eveningAt > 14 * HOUR) return;
    await this.prefs.patch(userId, { note: { ...note, eveningOpened: true }, unopened: 0 });
  }

  /** Does the Daily summary ride in tonight's evening note (so it isn't sent on its own today)? */
  async rides(userId: string, day: string): Promise<boolean> {
    if (!planOn("notes")) return false;
    const row = await this.prefs.get(userId).catch(() => null);
    if (!row || row.notes === "off" || row.notes === "morning") return false;
    if (row.note?.summaryFor === day) return true;
    const tz = row.tz_min ?? 330;
    const next = row.next_note_ms;
    return row.note?.next === "evening" && typeof next === "number" && next > this.now() && dayOf(next, tz) === day;
  }

  // ------------------------------------------------------------------ the jobs

  /** Every minute: the day notes that are due. How many went. */
  async notesTick(limit = 200): Promise<number> {
    if (!planOn("notes")) return 0;
    const now = this.now();
    let sent = 0;
    for (const row of await this.prefs.notesDue(now, limit)) {
      try { if (await this.noteFor(row, now)) sent += 1; } catch { /* the next tick; the claim already moved it on */ }
    }
    return sent;
  }

  private async noteFor(row: PlanPrefsRow, now: number): Promise<boolean> {
    const due = row.next_note_ms!;
    const tz = row.tz_min ?? 330;
    const notes = row.notes ?? "both";
    const kind = row.note?.next ?? (Math.round(((due + tz * MIN) % DAY) / MIN) >= 12 * 60 ? "evening" : "morning");
    if (notes === "off") { await this.prefs.claim(row.user_id, "next_note_ms", due, null); return false; }
    const day = dayOf(due, tz), tomorrow = shiftDay(day, 1);
    // Claim first, moving it to the note after this one: two servers never send twice.
    const following = this.following(row, tz, notes, kind, day);
    if (!(await this.prefs.claim(row.user_id, "next_note_ms", due, following.at))) return false;
    const note = { ...(row.note ?? {}), next: following.kind };
    if (now - due > NOTE_LATE_MS) { await this.prefs.patch(row.user_id, { note }); return false; }
    const hg = this.hinglish ? await this.hinglish(row.user_id).catch(() => false) : false;

    if (kind === "evening") {
      if (notes === "morning") { await this.prefs.patch(row.user_id, { note }); return false; }
      // The quiet rule: the evening note before this one was never opened; five in a row and the morning note takes its place.
      const unopened = note.eveningAt && !note.eveningOpened ? (row.unopened ?? 0) + 1 : 0;
      if (unopened >= QUIET_AFTER && notes === "both") {
        const n2 = this.nextNote({ ...row, notes: "morning" }, tz, "morning", due + MIN);
        await this.prefs.patch(row.user_id, { notes: "morning", unopened, next_note_ms: n2.at, note: { ...note, next: n2.kind, quietSaid: false } });
        return false;
      }
      // The work calendar read once more first, so tomorrow is written down as it is now.
      await beforeNote(row.user_id).catch(() => undefined);
      const l = await this.load(row.user_id, tz);
      const { cards, ctx } = await this.cards(row.user_id, l, tz);
      // One question, and never the same one two evenings running: a card left alone rides once (a capture: "once in the evening note,
      // then dropped after 7 days"), and stays on the page until it goes.
      const rode = new Set(note.rode ?? []);
      const asked = cards.find((c) => noteCard(c) && c.until > now && !rode.has(c.key)) ?? null;
      // The sources' own lines, without the one the question already is ("4 things from the circular" asked, not said too).
      const extra = await sourceEvening(row.user_id, { ...this.window(tz, day, now), ...(asked ? { asked: asked.item } : {}) }).catch(() => [] as string[]);
      const sum = summary.line ? await summary.line(row.user_id, tz, now).catch(() => null) : null;
      const rides = !!sum && note.summaryFor !== day;
      const words = eveningNote({
        now, tz, hg, tomorrow: l.items.filter((it) => it.day === tomorrow && !it.done), tonight: l.items.filter((it) => it.day === day && !it.done && it.ref === "task"),
        leaves: l.leaves, needs: asked, ...(rides ? { summary: sum!.line } : {}), first: !note.firstSaid,
        ...(extra.length ? { extra } : {}), family: noteLinesOf(ctx, tomorrow),
      });
      // The morning note goes earlier when tomorrow's first leave-by needs it (45 minutes before), never before 6 am.
      const firstLeave = [...l.leaves.entries()].filter(([id]) => l.items.some((it) => it.id === id && it.day === tomorrow)).map(([, v]) => v.leaveBy).sort((a, b) => a - b)[0] ?? null;
      const after = this.following(row, tz, notes, "evening", day, firstLeave);
      if (!words) {
        // Tomorrow is empty: no note. A Daily summary that waited for it goes on its own now.
        if (rides && summary.alone) await summary.alone(row.user_id, sum!, day).catch(() => undefined);
        // No note went, so nothing was left unopened either: the count of evening notes never opened stays as it was (an empty
        // evening every few days must not keep the notes going for someone who never opens them).
        await this.prefs.patch(row.user_id, { note: { ...note, next: after.kind }, next_note_ms: after.at });
        return false;
      }
      await this.deliver(row.user_id, "plan_evening", `evening:${tomorrow}`, words, { day: tomorrow });
      await this.prefs.patch(row.user_id, {
        unopened, next_note_ms: after.at,
        note: {
          ...note, next: after.kind, eveningFor: tomorrow, eveningAt: now, eveningOpened: false, sig: signature(l.items.filter((it) => it.day === tomorrow)),
          firstSaid: true, ...(rides ? { summaryFor: day } : {}), ...(asked && words.item ? { rode: [...rode, asked.key].slice(-20) } : {}),
        },
      });
      return true;
    }

    // The morning note.
    if (notes === "evening") { await this.prefs.patch(row.user_id, { note }); return false; }
    const opened6 = note.openedAt && note.openedAt >= startOfDay(day, tz) + 6 * HOUR;
    const l = await this.load(row.user_id, tz);
    const today = l.items.filter((it) => it.day === day);
    if (!today.some((it) => !it.done) || opened6) { await this.prefs.patch(row.user_id, { note }); return false; }
    const sig = note.eveningFor === day ? note.sig ?? [] : null;
    if (notes === "both" && note.eveningFor === day && note.eveningOpened && !changesSince(sig, today).length) {
      // Opened last night and nothing changed: one day note, not two.
      await this.prefs.patch(row.user_id, { note });
      return false;
    }
    let mornUnopened = note.mornUnopened ?? 0;
    if (notes === "morning") {
      mornUnopened = note.morningAt && !note.morningOpened ? mornUnopened + 1 : 0;
      // Five morning notes in a row never opened either: they stop. "Evening notes" in the box brings them back.
      if (mornUnopened >= QUIET_AFTER) { await this.prefs.patch(row.user_id, { notes: "off", next_note_ms: null, note: { ...note, mornUnopened } }); return false; }
    }
    const yesterday = shiftDay(day, -1);
    const still = (await this.calendar.list(row.user_id, { from: yesterday, to: yesterday, tz }).catch(() => null))?.tasks.filter((t) => !t.done) ?? [];
    const extra = await sourceMorning(row.user_id, this.window(tz, day, now)).catch(() => [] as string[]);
    const words = morningNote({
      now, tz, hg, today, sig, leaves: l.leaves, stillOpen: dayItems({ events: [], tasks: still, open: [] }),
      quietLine: notes === "morning" && !note.quietSaid, ...(extra.length ? { extra } : {}),
    });
    if (!words) { await this.prefs.patch(row.user_id, { note }); return false; }
    await this.deliver(row.user_id, "plan_morning", `morning:${day}`, words, { day });
    await this.prefs.patch(row.user_id, {
      note: { ...note, morningFor: day, morningAt: now, morningOpened: false, mornUnopened, ...(notes === "morning" ? { quietSaid: true } : {}) },
    });
    return true;
  }

  private async deliver(userId: string, kind: string, key: string, w: NoteWords, data: Record<string, string>): Promise<void> {
    if (!this.send) return;
    await this.send(userId, { kind, key, vars: { title: w.title, body: w.body }, data: { ...data, ...(w.item ? { item: w.item } : {}) }, ...(w.category ? { category: w.category } : {}) });
  }

  /** Every minute: the leave-by reminders that are due ("Leave by 5:30 pm for the dentist" [Open map]), 10 minutes before. */
  async leavesTick(limit = 200): Promise<number> {
    if (!planOn("reminders")) return 0;
    const now = this.now();
    let sent = 0;
    for (const row of await this.prefs.leavesDue(now, limit)) {
      const was = row.next_leave_ms!;
      const leaves = row.leaves ?? [];
      const due = leaves.filter((l) => !l.sent && l.leaveBy - 10 * MIN <= now);
      const rest = leaves.filter((l) => !l.sent && l.leaveBy - 10 * MIN > now).map((l) => l.leaveBy - 10 * MIN).sort((a, b) => a - b)[0] ?? null;
      if (!(await this.prefs.claim(row.user_id, "next_leave_ms", was, rest))) continue;
      const tz = row.tz_min ?? 330;
      for (const l of due) {
        if (l.leaveBy < now - 5 * MIN || !this.send) continue;
        const title = safeTitle(l.title);
        const what = title === "Appointment" ? "your appointment" : inLine(title.split(" · ")[0]!.trim() || title);
        const to = looksHealth(l.to) || looksHealth(l.title) ? "" : l.to;
        const day = dayOf(l.start, tz);
        await this.send(row.user_id, {
          kind: "plan_leave", key: `leave:${l.eventId}:${l.start}`,
          vars: { title: lockSafe(`Leave by ${clockOf(l.leaveBy, tz)} for ${what}`, 100), body: lockSafe(`${l.minutes} min ${l.mode === "walk" ? "walk" : "drive"}${to ? ` to ${to}` : ""}`, 100) },
          data: { day, go: "map", ...(l.to ? { to: l.to } : {}), mode: l.mode === "walk" ? "walking" : "driving" },
          // "X0 is calling" (planCall.ts): what a call needs if this rings instead. The server's own: never put in the push.
          call: {
            source: "leave", item: itemId({ kind: "pe", eventRef: eventRefOf(l.eventId), day }), eventId: l.eventId, day, tz,
            title: l.title, place: l.to, start: l.start, leaveBy: l.leaveBy, minutes: l.minutes, mode: l.mode === "walk" ? "walk" : "drive",
          },
        }).catch(() => undefined);
        sent += 1;
      }
      const marked = leaves.map((l) => (due.includes(l) ? { ...l, sent: true } : l));
      await this.prefs.patch(row.user_id, { leaves: marked }).catch(() => undefined);
    }
    return sent;
  }

  /** The two jobs, every minute. Returns the stop. */
  start(log?: { warn: (o: object, m: string) => void }): () => void {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try { await this.notesTick(); await this.leavesTick(); } catch (err) { log?.warn({ err: (err as Error)?.message }, "plan ease: notes"); } finally { busy = false; }
    };
    const timer = setInterval(() => { void tick(); }, 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

/**
 * The card a note may carry with its buttons: one whose buttons are a notification's (its category, or a Move card's x0_move), not one
 * that lives only on the page.
 */
const noteCard = (c: NeedsCard): boolean => !!c.item && c.buttons.length > 0 && !c.inApp && (!!c.category || c.type === "move");

/**
 * The card the widget asks, with the buttons that answer there (one that opens a page, like a capture's Look, is left in the app). A
 * card whose answer needs the app (its `outside` words: Send opens WhatsApp, "No" opens it with "are you coming?") is not half
 * answerable there: it goes open-only, in those words ("Still waiting on Rahul"), and a tap opens X0 Bot where both buttons are. A card
 * with `outside` words and buttons that answer in place keeps its buttons but says only those words (a follow's card: "A reminder from
 * Rahul", never the asker's title).
 */
function widgetCard(cards: NeedsCard[]): NeedsCard | null {
  for (const c of cards) {
    if (!c.item || c.inApp || !c.buttons.length) continue;
    if (c.outside !== undefined && c.buttons.some((b) => b.open)) return { ...c, question: c.outside, buttons: [], openOnly: true };
    const buttons = c.buttons.filter((b) => !b.open);
    if (buttons.length) return { ...c, ...(c.outside !== undefined ? { question: c.outside } : {}), buttons };
  }
  return null;
}

/** "dentist", "PTM": a title in the middle of a sentence. */
const inLine = (t: string): string => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

const clampTz = (v: number): number => (Number.isFinite(v) ? Math.max(-720, Math.min(840, Math.round(v))) : 330);

// ------------------------------------------------------------------ the one the server uses

let shared: PlanEase | null = null;

/** The server's (botsBots/index.ts makes it with the area's travel); one over the server's calendar until then. */
export function planEase(): PlanEase { return (shared ??= new PlanEase()); }
export function setPlanEase(p: PlanEase | null): void { shared = p; }

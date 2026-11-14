/**
 * PLAN EASE'S HOME, THE THREADED DAY AGAIN (PLAN_V2_HOME; docs/plan-ease.md §2). "Like before": the header with the walking bot, the
 * week strip, one day as a thread (times on the left, a line joining the items, leave-by, weather and free-time lines between them),
 * to-dos with no day, Share, and where the day starts. Fed by the new rows (botsBots/planThread.ts, GET .../plan/day), so follow lines,
 * must not miss, Needs-you, people's tiny bots, Pay and work meetings are all kept.
 *
 *   bots.plan   (PLAN_V2_PAGE and PLAN_V2_HOME, a build that draws PersonBot) the home, phone and window: GET .../plan/day
 *
 * The top area (the bot, its name, its ochre line and its walking tiny bot) is one pressable row that opens "Plan something" with the
 * box ready (bots.plan.make, screens/bots/planMake.ts); the + beside it opens it too. Back sits outside that row on the left, the + on
 * the right: never a pressable inside a pressable. There is no box and no chips here: the box is on "Plan something".
 *
 * Every row, line and card comes worked out from the server (planThread.ts threadOf, planRows.ts rowOf, planNeeds.ts): this file only
 * draws them. A tick or a Needs-you button goes through the one act door (POST /v1/widgets/act), as on the simple page (planPage.ts).
 * After "Plan something"'s Done the home opens on the new item's day with `made` and `n`: the server says "Added: …" (with Undo, for 10
 * minutes) and outlines the new rows.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { ARRIVAL_CAPABILITY } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, SCREENS, back, botAvatar, box, button, C, call, canArrival, canCalendarRead, canFocus, canReminders, card, col,
  calendarReadLive, emptyState, headerBuddy, icon, labelled, listCard, listRow, messageText, meta, open, page, personBot,
  remindersLive, roundButton, row,
  secondaryButton, sectionLabel, seq, statusMark, switchMark, text, when,
} from "../../kit.js";
import { line, permitStep } from "../firstRun/parts.js";
import { CAL_BUSY, REMINDERS, remindersLines } from "../permitWords.js";
import { setState } from "./parts.js";
import { shareButtonsFor } from "../../shareAction.js";
import * as places from "../botsPlaces.js";
import { itemAction, tickBox } from "../planItem.js";
import { act, needsPart } from "./planPage.js";
import { MONTHS, lookOf, refresh, toast } from "./parts.js";
import { MAKE } from "../../../../botsBots/planMake.js";
import type { PlanDayData, RowView, ThreadStep } from "../../../../botsBots/planThread.js";

export type { PlanDayData } from "../../../../botsBots/planThread.js";

/** What the two switches of "From this phone" and their cards need, merged into the home's own state (docs: perms2). */
export const PHONE_STATE = { busyCard: false, busyOn: false, busyBlocked: false, remCard: false, remOn: false, remBlocked: false };

const OCHRE = lookOf("plan").color;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isDesk = (ctx: BotsCtx) => ctx.client === "desktop";
/** The thread's label column: "6:00 pm", "All day", "To do" ("10:00 pm" on one line at 12/600 needs 58 on the phone). */
const labelWidth = (ctx: BotsCtx) => (isDesk(ctx) ? 64 : 58);

/** The home's state: a Needs-you answer's grey line (planDid), its field (planHome), and where the day starts (places). */
export const HOME_STATE = { ...places.PLAN_STATE, planDid: null, planHome: "", ...PHONE_STATE };

/**
 * THE HOME'S STATE FOR THIS PERSON. The two switch marks read `busyOn` and `remOn`, so the state has to START at what the
 * data says: with the flat `PHONE_STATE` both drew OFF while the feature was on, and tapping the switch — which is really the
 * off action — flipped the mark to ON on screen while the server deleted what it had.
 */
const homeState = (d: PlanDayData | undefined): Record<string, unknown> => ({
  ...HOME_STATE,
  busyOn: d?.phone?.busy === true,
  remOn: d?.phone?.reminders === true,
});

/** Another day on the home (the strip, its arrows, the window's week lines). */
const goDay = (day: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.plan, params: { day }, replace: true } as ActionSpec);

/** "Plan something", from the home: the day shown; the top area also asks for the box. */
export const planSomething = (day: string, o: { box?: boolean } = {}): ActionSpec =>
  open(SCREENS.planMake, { from: "plan", ...(day ? { day } : {}), ...(o.box ? { focus: "box" } : {}) });

// ------------------------------------------------------------------ the header

/**
 * Back (the phone), then THE TOP AREA, one pressable row: Plan Ease's avatar, its name and its ochre line, and its walking tiny bot
 * (BotBuddy ignores touches, so a tap goes through to the row); a build without BotBuddy has the still avatar in the same row. Then the
 * + (the phone) or "Plan something" (the window), a sibling. After Done the tiny bot plays "celebrate" once (BotMoments).
 */
export function homeHead(ctx: BotsCtx, d: PlanDayData | undefined, day: string): Node {
  const desk = isDesk(ctx);
  const look = lookOf("plan");
  // The phone's stage is a little narrower than a bot page's (64, not 76): with Back and + beside it, the name keeps one line at 360 wide
  // and the ochre line is cut, never the +.
  const buddy = headerBuddy(ctx, "plan", { lookTo: "down", ...(desk ? {} : { width: 64 }), ...(d?.added && ctx.params.made ? { moment: "celebrate" } : {}) });
  const top = labelled(row([
    botAvatar(look, desk ? 44 : 40),
    col([
      text("Plan Ease", { size: desk ? 22 : 19, weight: 600, lineHeight: desk ? 26 : 24, lines: 1 }),
      ...(d?.head ? [text(d.head, { size: desk ? 13 : 12, weight: 500, color: OCHRE, lineHeight: desk ? 18 : 16, lines: 1 })] : []),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...buddy,
  ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: desk ? 12 : 10, alignItems: "center", minHeight: desk ? 56 : 48 }, planSomething(day, { box: true })),
  "Plan Ease. Tap to plan something.");
  if (desk) {
    return row([top, secondaryButton("Plan something", planSomething(day), { icon: "plus", size: "md" })], { gap: 14, alignItems: "center" });
  }
  return row([
    labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center", flexShrink: 0 }, back()), "Back"),
    top,
    roundButton("plus", planSomething(day), { size: 40, light: true, label: "Plan something" }),
  ], { gap: 10, alignItems: "center" });
}

/** After Done: "Added: Dentist, Fri 13 Nov, 5 pm" and Undo (POST .../plan/make/undo), for 10 minutes (the server stops saying it). */
export function addedLine(_ctx: BotsCtx, d: PlanDayData): Node[] {
  const a = d.added;
  if (!a) return [];
  const undo = call("POST", `${MAKE}/undo`, { key: a.key, n: a.n }, {
    ok: seq(toast("Taken out"), goDay(d.day)), fail: toast("Couldn't undo that. Try again.", true), stay: true,
  });
  return [row([
    icon("check", { size: 14 }),
    text(a.line, { size: 14, lineHeight: 19, lines: 2, style: { flexShrink: 1 } }),
    row([text("Undo", { size: 14, weight: 500, lineHeight: 19 })], { minHeight: 32, paddingHorizontal: 6, alignItems: "center" }, undo),
  ], { gap: 8, alignItems: "center" })];
}

// ------------------------------------------------------------------ the week strip

const keyDate = (k: string) => new Date(`${k}T00:00:00Z`);
const longDay = (k: string) => { const t = keyDate(k); return `${WEEKDAYS_LONG[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };

/** The week that holds the day shown: seven days, each opens its day; the arrows a week back or on, up to 8 weeks from this one. */
export function stripNodes(d: PlanDayData): Node {
  const cell = (x: PlanDayData["strip"]["days"][number]): Node => {
    const on = x.key === d.day;
    return labelled(col([
      text(x.wd, { size: 11, weight: 500, color: on ? C.paper : C.meta, lineHeight: 14 }),
      text(x.n, { size: 15, weight: on || x.today ? 600 : 400, color: on ? C.paper : C.ink, lineHeight: 20 }),
      box([], { width: 4, height: 4, borderRadius: 2, backgroundColor: x.busy ? (on ? C.paper : OCHRE) : "transparent" }),
    ], {
      flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "center", gap: 2, paddingVertical: 7, borderRadius: 14, backgroundColor: on ? C.ink : C.paper,
      ...(x.today && !on ? { borderWidth: 1, borderColor: C.line } : {}),
    }, goDay(x.key)), longDay(x.key));
  };
  const arrow = (to: string | null, dir: -1 | 1): Node => (to
    ? labelled(box([icon(dir < 0 ? "back" : "chevron", { size: 16, color: C.grey70 })], { width: 26, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }, goDay(to)), dir < 0 ? "The week before" : "The week after")
    : box([], { width: 26 }));
  return row([arrow(d.strip.prev, -1), ...d.strip.days.map(cell), arrow(d.strip.next, 1)], { gap: 2, alignItems: "stretch" });
}

// ------------------------------------------------------------------ the thread

const track = (h?: number): Node => box([], { width: 1.5, alignSelf: "stretch", backgroundColor: C.track, flexShrink: 0, ...(h ? { height: h } : {}) });

/** The right end of a row: Pay, else the tiny bot of who set it and of who does it. */
function rightOf(ctx: BotsCtx, r: RowView): Node[] {
  if (r.action) return [secondaryButton(r.action.label, { kind: "openUrl", url: r.action.url } as ActionSpec, { size: "md" })];
  return [
    ...(r.person ? [personBot(ctx, r.person.look, { size: 26, label: `From ${r.person.name}` })] : []),
    ...(r.who ? [personBot(ctx, r.who.look, { size: 26, label: `For ${r.who.name}` })] : []),
  ];
}

/**
 * A row's words: the title, and the grey line the thread says (`meta`). A person's word on it is theirs: their tiny bot and their words
 * in Bricolage, under what the thread says of it (must not miss, how long).
 */
function wordsOf(ctx: BotsCtx, r: RowView, metaLine: string): Node {
  const note = r.note && !r.followed ? r.note : undefined;
  // The thread's meta ends with the row's own line; with a note that line is the note, drawn as theirs below.
  const said = note && r.line && metaLine.endsWith(r.line) ? metaLine.slice(0, -r.line.length).replace(/ · $/, "") : metaLine;
  return col([
    text(r.title, { size: 14, weight: 500, lineHeight: 19, lines: 2, color: r.done ? C.meta : C.ink }),
    // Beside Pay the words column is narrow: the grey line gets two lines, so a bill's "Due today" is never cut to "Due to…".
    ...(said ? [text(said, { size: 12, color: C.meta, lineHeight: 16, lines: r.action ? 2 : 1 })] : []),
    ...(note ? [row([personBot(ctx, note.look, { size: 18, label: note.name }), messageText(ctx, r.line, { lines: 1, color: C.meta, size: 14 })], { gap: 6, alignItems: "center" })] : []),
  ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }, itemAction(r.open.kind, r.open.id));
}

/** A just-added row's own mark, for its 10 minutes: Plan Ease's ochre edge on a light ochre ground, never the must row's ink edge. */
const FRESH_FILL = "#fbf3e4";

/**
 * An item's card: its tick (to-dos and bills, its own press), its words (open it), and Pay or the tiny bots on the right. Must not miss
 * has the 1.5 ink edge; a row just added has its own: ochre, on a light ochre ground, with "Just added" over its words.
 */
function rowCard(ctx: BotsCtx, s: Extract<ThreadStep, { k: "row" }>): Node {
  const r = s.row;
  const must = r.must && !r.done;
  const words = wordsOf(ctx, r, s.meta);
  return row([
    ...(r.tick ? [box([tickBox(r.done, act(ctx, r.tick.item, r.tick.action), r.tick.label)], { alignItems: "center", justifyContent: "center", flexShrink: 0 })] : []),
    s.fresh ? { ...words, children: [text("Just added", { size: 11, weight: 600, color: OCHRE, lineHeight: 14 }), ...(words.children ?? [])] } : words,
    ...rightOf(ctx, r),
  ], {
    flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 10, padding: 12, borderRadius: 14, alignItems: "center", backgroundColor: s.fresh ? FRESH_FILL : C.paper,
    borderWidth: s.fresh || must ? 1.5 : 1, borderColor: s.fresh ? OCHRE : must ? C.ink : C.line, ...(s.dim ? { opacity: 0.55 } : {}),
  });
}

/** The day as a thread: each step one row, [label] [the track] [what it is]. */
export function threadNodes(ctx: BotsCtx, steps: ThreadStep[]): Node[] {
  const w = labelWidth(ctx);
  const blank = (): Node => box([], { width: w, flexShrink: 0 });
  return steps.map((s): Node => {
    if (s.k === "row") {
      return row([text(s.label, { size: 12, weight: 600, lineHeight: 16, style: { width: w, paddingTop: 12, flexShrink: 0 } }), track(), rowCard(ctx, s)], { gap: 10, alignItems: "stretch" });
    }
    if (s.k === "leave") {
      // Open map is a hand-off the phone checks against its own list (Maps), only when it is time to go.
      const go = s.button ? [row([text(s.button.label, { size: 12, weight: 600, lineHeight: 16 })], {
        minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center", alignSelf: "flex-start",
      }, { kind: "openUrl", url: s.button.url, handoff: true } as ActionSpec)] : [];
      const words = s.tight
        ? row([statusMark("needs", { size: 8 }), text(s.text, { size: 12, weight: 600, lineHeight: 16, style: { flexShrink: 1 } })], { gap: 8, alignItems: "center", flexShrink: 1 })
        : text(s.text, { size: 12, weight: 500, color: OCHRE, lineHeight: 16, style: { flexShrink: 1 } });
      return row([blank(), track(26), col([words, ...go], { gap: 6, flexShrink: 1, minWidth: 0, paddingVertical: go.length ? 4 : 0 })], { gap: 10, minHeight: 26, alignItems: "center" });
    }
    if (s.k === "sky") {
      return row([blank(), track(26), places.skyGlyph(s.kind, 16, C.meta), meta(s.text, { size: 12, style: { flexShrink: 1 } })], { gap: 10, minHeight: 26, alignItems: "center" });
    }
    return row([blank(), track(26), meta(s.text, { size: 12, style: { flexShrink: 1 } })], { gap: 10, minHeight: 26, alignItems: "center" });
  });
}

/** "TODAY · THU 12 NOV", the thread (or a free day), the travel credits, Share. */
function dayPart(ctx: BotsCtx, d: PlanDayData): Node {
  const label = d.label === "Today" || d.label === "Tomorrow" ? d.label.toLowerCase() : d.label;
  const empty = card([
    text(d.empty || `Nothing on ${label}`, { size: 15, weight: 500, lineHeight: 20 }),
    meta(isDesk(ctx) ? "A free day. Tap Plan something to add to it." : "A free day. Tap + to plan something.", { size: 13 }),
  ], { dashed: true });
  return col([
    sectionLabel(`${d.label} · ${d.date}`),
    d.thread.length ? col(threadNodes(ctx, d.thread), { gap: 8 }) : empty,
    ...places.planFoot(ctx, d.travel),
    ...(d.share ? shareButtonsFor(ctx, { kind: "plan", title: d.share.title, text: d.share.text }, { label: `Share ${label}` }) : []),
  ], { gap: 12 });
}

/** A to-do with no day: its tick, its words (open it), Pay or a tiny bot. */
function openRow(ctx: BotsCtx, r: RowView): Node {
  return row([
    ...(r.tick ? [tickBox(r.done, act(ctx, r.tick.item, r.tick.action), r.tick.label)] : []),
    col([
      text(r.title, { size: 14, lineHeight: 19, lines: 2, color: r.done ? C.meta : C.ink }),
      ...(r.line ? [meta(r.line, { size: 12, lines: 1 })] : []),
    ], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 8 }, itemAction(r.open.kind, r.open.id)),
    ...rightOf(ctx, r),
  ], { gap: 10, alignItems: "center", paddingHorizontal: 14, ...(r.done ? { opacity: 0.55 } : {}) });
}

/** "TO DO, NO DAY · 3" and the list, ticked off here. No Add: the + does it. */
function openPart(ctx: BotsCtx, d: PlanDayData): Node[] {
  if (!d.open.length) return [];
  const kids: Node[] = [];
  d.open.slice(0, 12).forEach((r, i) => { if (i) kids.push(box([], { height: 1, backgroundColor: C.divider })); kids.push(openRow(ctx, r)); });
  return [col([
    sectionLabel(`To do, no day · ${d.open.length}`),
    col(kids, { borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingVertical: 2 }),
  ], { gap: 8 })];
}

const noRead = () => emptyState({ pose: "think", title: "Couldn't read your days", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } });

/**
 * The day Plan something opens on: the day shown when it is today or later (a past day reached through the strip opens it on today, so
 * a plain Check is never "That time has passed"); when the read failed, the param; else nothing (today).
 */
const shownDay = (ctx: BotsCtx, d: PlanDayData | undefined): string =>
  (d ? (d.day >= d.today ? d.day : "") : /^\d{4}-\d{2}-\d{2}$/.test(String(ctx.params.day ?? "")) ? String(ctx.params.day) : "");

// --------------------------------------------- the phone's own calendar and Reminders (docs: perms2 §2.3, §3.2, §7.2)

const BUSY_PATH = "/v1/botsapp/plan/busy";
const REM_PATH = "/v1/botsapp/plan/reminders";

/**
 * "PLAN AROUND MY CALENDAR" AND "SYNC WITH REMINDERS", and the quiet sync that keeps them current.
 *
 * Each row is drawn only on a store build's phone that declares its capability and only while its own switch is on (kit
 * canCalendarRead / canReminders); the window and every older binary get the page exactly as it is today.
 *
 * THE CALENDAR PLACE HAS THREE WAYS FROM 8.9.1, not two:
 *   - a phone that declared CalendarRead1 — an iPhone 17+, or an Android build carrying TULMI_ANDROID_CALENDAR while
 *     PERM_CALENDAR_READ_ANDROID is on: the switch, the card and the sync. `canCalendarRead` weighs all of it, so there is
 *     no platform test for the ROW; the card's words do differ, which is `android` below;
 *   - any other Android phone: the server's own Google Calendar connector row, as before, which asks the phone for nothing;
 *   - the window: neither.
 * Reminders has no Android half in 8.9.1, so its place stays two-way.
 *
 * Switching one ON opens one card — Continue and nothing else (App Review 5.1.1(iv)) — and Continue is the only thing that
 * reaches the phone's own prompt. The switch does NOT move until the phone has answered and the first sync has landed: a
 * switch that said "on" while the person was still reading the card would be a lie. Switching one OFF is the plain DELETE,
 * which deletes the times (or drops the links) in the same request, as the row's own words promise.
 */
export function phoneRows(ctx: BotsCtx, d: PlanDayData | undefined): Node[] {
  const android = ctx.platform === "android" && ctx.client === "phone";
  const busy = canCalendarRead(ctx), rem = canReminders(ctx);
  /** The switch rows go in the one list card; the cards, the Settings lines and the quiet syncs go under it. */
  const switches: Node[] = [];
  const under: Node[] = [];
  if (busy) { const r = busyRows(d, android); switches.push(r[0]!); under.push(...r.slice(1)); }
  if (rem) { const r = remRows(d); switches.push(r[0]!); under.push(...r.slice(1)); }
  // ANDROID'S OWN PLACE, for the phones whose binary cannot read a calendar: the connectors the server already has, which
  // ask this phone for nothing and need no capability. The feature's own switch still decides, so nothing is offered for
  // something that is not live — and it is drawn only when the phone's own row was NOT, so the two never both appear.
  if (android && !busy && calendarReadLive()) switches.push(connectorRow(CAL_BUSY.androidRow, CAL_BUSY.androidSub, "google-calendar"));
  if (android && remindersLive()) switches.push(connectorRow(REMINDERS.androidRow, REMINDERS.androidSub, "google-tasks"));
  if (!switches.length) return [];
  return [col([sectionLabel("From this phone"), listCard(switches), ...under], { gap: 8 })];
}

const connectorRow = (label: string, sub: string, id: string): Node =>
  listRow({ label, sub, onPress: open(SCREENS.appConnect, { id }) });

function busyRows(d: PlanDayData | undefined, android = false): Node[] {
  const on = d?.phone?.busy === true;
  const off: ActionRef = call("DELETE", BUSY_PATH, undefined, {
    ok: seq(toast(CAL_BUSY.off), refresh), fail: toast("Couldn't switch that off. Try again.", true),
  });
  const sync = (ask: boolean): ActionSpec => ({
    kind: "calendar.sync", path: BUSY_PATH, days: 14, ...(ask ? { ask: true, enable: true } : {}),
    onSynced: seq(setState("busyCard", false), refresh),
    onDenied: seq(setState("busyCard", false), toast(CAL_BUSY.denied)),
    onBlocked: seq(setState("busyCard", false), setState("busyBlocked", true)),
    onError: seq(setState("busyCard", false), toast("Couldn't read your calendar just now. Try again.", true)),
  } as unknown as ActionSpec);
  const change: ActionRef = on
    ? seq({ kind: "toggleState", path: "busyOn" } as ActionSpec, off)
    : setState("busyCard", true);
  return [
    listRow({ label: CAL_BUSY.row, sub: on && d?.phone?.busyAt ? CAL_BUSY.on : CAL_BUSY.rowSub, chevron: false, right: switchMark("busyOn"), onPress: change }),
    // Two of the card's three lines differ on Android: no "full access" grant to explain, the PHONE'S calendars rather than
    // "your iPhone's", and a last line that must not say iPhone.
    permitStep({
      when: { truthy: "busyCard" }, title: CAL_BUSY.title,
      lines: (android ? CAL_BUSY.linesAndroid : CAL_BUSY.lines).map((l) => line(l)),
      cta: { label: CAL_BUSY.cta, onPress: sync(true) },
    }),
    // Turned off in Settings: iOS will not ask again, so Settings is the only useful thing left to offer.
    when({ truthy: "busyBlocked" }, col([
      meta(CAL_BUSY.blocked, { size: 12 }),
      button(CAL_BUSY.openSettings, { kind: "openSettings", target: "app" } as ActionSpec, { kind: "secondary", size: "md" }),
    ], { gap: 6, paddingHorizontal: 16, paddingVertical: 10 })),
    // THE QUIET RE-SYNC: with no `ask` it never prompts, so it can never be a way round the card. Only while it is on.
    ...(on ? [{ ...box([], { height: 0 }), on: { onAppear: sync(false) } }] : []),
  ];
}

function remRows(d: PlanDayData | undefined): Node[] {
  const on = d?.phone?.reminders === true;
  const off: ActionRef = call("DELETE", REM_PATH, undefined, {
    ok: seq(toast(REMINDERS.off), refresh), fail: toast("Couldn't switch that off. Try again.", true),
  });
  const sync = (ask: boolean): ActionSpec => ({
    kind: "reminders.sync", path: `${REM_PATH}/sync`, ...(ask ? { ask: true, enable: true } : {}),
    onSynced: seq(setState("remCard", false), refresh),
    onDenied: seq(setState("remCard", false), toast(REMINDERS.denied)),
    onBlocked: seq(setState("remCard", false), setState("remBlocked", true)),
    onError: seq(setState("remCard", false), toast("Couldn't reach Reminders just now. Try again.", true)),
  } as unknown as ActionSpec);
  const change: ActionRef = on
    ? seq({ kind: "toggleState", path: "remOn" } as ActionSpec, off)
    : setState("remCard", true);
  // The AI clause is the one that is true for this person (App Review 5.1.2(i)): the server knows their answer, so the card
  // never says their to-dos go to a model when they have not allowed it, and never hides it when they have.
  const lines = remindersLines(d?.phone?.ai === true).map((l) => line(l));
  return [
    listRow({ label: REMINDERS.row, sub: on ? REMINDERS.on : REMINDERS.rowSub, chevron: false, right: switchMark("remOn"), onPress: change }),
    permitStep({ when: { truthy: "remCard" }, title: REMINDERS.title, lines, cta: { label: REMINDERS.cta, onPress: sync(true) } }),
    when({ truthy: "remBlocked" }, col([
      meta(REMINDERS.blocked, { size: 12 }),
      button(REMINDERS.openSettings, { kind: "openSettings", target: "app" } as ActionSpec, { kind: "secondary", size: "md" }),
    ], { gap: 6, paddingHorizontal: 16, paddingVertical: 10 })),
    ...(on ? [{ ...box([], { height: 0 }), on: { onAppear: sync(false) } }] : []),
  ];
}

/**
 * THE ARRIVAL REMINDERS, MADE TO MATCH (docs: perms2 §7.2). On every page appear the phone is given the whole armed set, so
 * an item that is done, deleted or switched off drops off the phone by itself. With no `ask` it never prompts: the card on the
 * item is the only thing that does. The places go out; nothing of an arrival ever comes back.
 */
export function arrivalSync(ctx: BotsCtx, d: PlanDayData | undefined): Node[] {
  if (!d) return [];
  // THE SWITCH GOING OFF HAS TO REACH THE PHONES IT ARMED. The phone's set is replaced only by an `arrival.sync`, so with no
  // sync at all the triggers armed while the switch was on simply stay — and on Android they are geofences armed with
  // NEVER_EXPIRE that fire on every entry and wake the app (TulmiArrivalGeofences.kt), which is exactly what must stop after
  // a Play rejection. So a phone whose binary declares the capability is still sent one sync: the empty set. `arrivalCore`
  // clears an empty set with no permission and no prompt, and a binary without geofencing answers "unavailable".
  if (!canArrival(ctx)) {
    if (ctx.client !== "phone" || !ctx.can.has(ARRIVAL_CAPABILITY)) return [];
    const clear: ActionSpec = { kind: "arrival.sync", items: [] } as unknown as ActionSpec;
    return [{ ...box([], { height: 0 }), on: { onAppear: clear } }];
  }
  // A place still being looked up (`arrivalsPending`): nothing is sent this round. The sync REPLACES what the phone watches,
  // so sending a set that is missing an armed item would take that item's trigger off the phone over a lookup that has not
  // come back yet. The live channel brings the page again when it has.
  if (d.arrivalsPending) return [];
  const items = d.arrivals ?? [];
  const sync: ActionSpec = { kind: "arrival.sync", items } as unknown as ActionSpec;
  return [{ ...box([], { height: 0 }), on: { onAppear: sync } }];
}

/**
 * Whether a Focus with X0 Bot's filter is on, caught up from the App Group on every page appear (docs: perms2 §4.2).
 *
 * ONLY WHILE THE PERSON'S OWN HOLD SWITCH IS ON. Nothing reads the answer with "Hold calls during a Focus" off, so asking
 * the phone for it on every page would be one more thing learned about them for no purpose at all.
 */
export function focusSync(ctx: BotsCtx, d?: PlanDayData): Node[] {
  if (!canFocus(ctx) || d?.phone?.focusHold !== true) return [];
  const sync: ActionSpec = { kind: "focus.sync", path: "/v1/botsapp/plan/focus" } as unknown as ActionSpec;
  return [{ ...box([], { height: 0 }), on: { onAppear: sync } }];
}

// ------------------------------------------------------------------ the home, phone and window

export function planHomePhone(ctx: BotsCtx, d: PlanDayData | undefined) {
  return page(ctx, {
    title: "Plan Ease", nav: "plan", live: ["bot:plan", "calendar", "tasks"], state: homeState(d), gap: 22,
    body: [
      homeHead(ctx, d, shownDay(ctx, d)),
      ...(!d ? [noRead()] : [
        ...addedLine(ctx, d),
        stripNodes(d),
        ...(d.needs ? [needsPart(ctx, d.needs)] : []),
        dayPart(ctx, d),
        ...openPart(ctx, d),
        ...places.homePart(ctx, d.travel),
        // The phone's own things (docs: perms2): the two switches, and the quiet syncs that keep the rest in step.
        ...phoneRows(ctx, d),
        ...arrivalSync(ctx, d),
        ...focusSync(ctx, d),
      ]),
    ],
  });
}

export function planHomeDesk(ctx: BotsCtx, d: PlanDayData | undefined) {
  // The six days after the one shown (tomorrow too, when today is), only those with something on, a line each; a tap threads it here.
  const week = d?.week.length ? [col([
    sectionLabel("Coming up"),
    col(d.week.map((w, i) => row([
      text(w.date, { size: 14, color: C.meta, lineHeight: 20, style: { width: 64, flexShrink: 0 } }),
      text(w.line, { size: 15, lineHeight: 20, lines: 1, style: { flexShrink: 1 } }),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 18, ...(i ? { borderTopWidth: 1, borderTopColor: C.divider } : {}) }, goDay(w.key))),
    { borderWidth: 1, borderColor: C.line, borderRadius: 20, overflow: "hidden" }),
  ], { gap: 10 })] : [];
  const rail = col(d ? [...week, ...openPart(ctx, d), ...places.homePart(ctx, d.travel)] : [], { gap: 20, width: 320, flexShrink: 0 });
  // The header first and across (Work in space's tabs go under it, workTab.ts), then the day and the rail.
  return page(ctx, {
    title: "Plan Ease", nav: "plan", maxWidth: 1080, live: ["bot:plan", "calendar", "tasks"], state: homeState(d), gap: 24,
    body: [
      homeHead(ctx, d, shownDay(ctx, d)),
      ...(!d ? [noRead()] : [row([
        col([
          ...addedLine(ctx, d),
          stripNodes(d),
          ...(d.needs ? [needsPart(ctx, d.needs)] : []),
          dayPart(ctx, d),
        ], { gap: 24, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, maxWidth: 680 }),
        rail,
      ], { gap: 48, alignItems: "flex-start" })]),
    ],
  });
}

/** The query GET .../plan/day reads: tz, and only the params that are well formed (a day, a week, Done's key and count). */
export function planDayQuery(ctx: BotsCtx): string {
  const q: string[] = [`tz=${ctx.tzOffsetMinutes}`];
  const p = ctx.params;
  const day = String(p.day ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) q.push(`day=${encodeURIComponent(day)}`);
  const week = Number(p.week);
  if (p.week !== undefined && p.week !== "" && Number.isInteger(week) && Math.abs(week) <= 8) q.push(`week=${encodeURIComponent(String(week))}`);
  const made = String(p.made ?? "");
  const n = Number(p.n);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(made) && Number.isInteger(n) && n >= 1 && n <= 21) {
    q.push(`made=${encodeURIComponent(made)}`, `n=${encodeURIComponent(String(n))}`);
  }
  return q.join("&");
}

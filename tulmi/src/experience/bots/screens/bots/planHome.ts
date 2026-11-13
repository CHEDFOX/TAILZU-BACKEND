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
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, SCREENS, back, botAvatar, box, C, call, card, col, emptyState, headerBuddy, icon, labelled, messageText, meta, open,
  page, personBot, roundButton, row, secondaryButton, sectionLabel, seq, statusMark, text,
} from "../../kit.js";
import { shareButtonsFor } from "../../shareAction.js";
import * as places from "../botsPlaces.js";
import { itemAction, tickBox } from "../planItem.js";
import { act, needsPart } from "./planPage.js";
import { MONTHS, lookOf, refresh, toast } from "./parts.js";
import { MAKE } from "../../../../botsBots/planMake.js";
import type { PlanDayData, RowView, ThreadStep } from "../../../../botsBots/planThread.js";

export type { PlanDayData } from "../../../../botsBots/planThread.js";

const OCHRE = lookOf("plan").color;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isDesk = (ctx: BotsCtx) => ctx.client === "desktop";
/** The thread's label column: "6:00 pm", "All day", "To do" ("10:00 pm" on one line at 12/600 needs 58 on the phone). */
const labelWidth = (ctx: BotsCtx) => (isDesk(ctx) ? 64 : 58);

/** The home's state: a Needs-you answer's grey line (planDid), its field (planHome), and where the day starts (places). */
export const HOME_STATE = { ...places.PLAN_STATE, planDid: null, planHome: "" };

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

// ------------------------------------------------------------------ the home, phone and window

export function planHomePhone(ctx: BotsCtx, d: PlanDayData | undefined) {
  return page(ctx, {
    title: "Plan Ease", nav: "plan", live: ["bot:plan", "calendar", "tasks"], state: { ...HOME_STATE }, gap: 22,
    body: [
      homeHead(ctx, d, shownDay(ctx, d)),
      ...(!d ? [noRead()] : [
        ...addedLine(ctx, d),
        stripNodes(d),
        ...(d.needs ? [needsPart(ctx, d.needs)] : []),
        dayPart(ctx, d),
        ...openPart(ctx, d),
        ...places.homePart(ctx, d.travel),
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
    title: "Plan Ease", nav: "plan", maxWidth: 1080, live: ["bot:plan", "calendar", "tasks"], state: { ...HOME_STATE }, gap: 24,
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

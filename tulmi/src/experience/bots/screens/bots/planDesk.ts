/**
 * The Bots area's planDesk screen.
 */

import type { ActionSpec, Node, ActionRef } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, SCREENS, call, seq, col, row, statusMark, text, C, button, meta, divider, box, sectionLabel, grow, icon, listRow, listCard,
  card, chip, open, page, botAvatar, title, headerBuddy, secondaryButton, emptyState, notice,
} from "../../kit.js";
import { shareButton } from "../../shareAction.js";
import * as places from "../botsPlaces.js";
import { tickBox, tickAction, itemAction, addAction } from "../planItem.js";
import {
  WEEKDAYS, MONTHS, MIN, DAY, dayKeyOf, A, toast, refresh, write, lookOf, clockOf, plural, link, askBot, chatBar, ANSWERING,
} from "./parts.js";

// ===================================================================== bots.plan

/** GET .../plan (src/botsBots/plan.ts): the person's own calendar and to-dos (src/calendar), nothing to connect. */
interface PlanEvent { id: string; title: string; start: number; end: number; allDay: boolean; where?: string; people: number; from?: string; fixed?: boolean; repeat?: string }
interface PlanTask { id: string; title: string; due: string; at?: number | null; done?: boolean; from?: string; fixed?: boolean }
export interface PlanDay { key: string; events: PlanEvent[]; tasks: PlanTask[] }
interface Suggestion { key: string; eventId: string; title: string; question: string; detail: string; startIso: string; fromDay: string; toWords: string; savedMin?: number }
export interface PlanRead { connected: { calendar: boolean; tasks: boolean }; today: string; tomorrow: string; week: string[]; days: PlanDay[]; suggestion: Suggestion | null; trouble?: string; travel?: places.PlanTravelView; open?: PlanTask[] }

export const PLAN_WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const keyDate = (k: string) => new Date(`${k}T00:00:00Z`);
export const keyWords = (k: string) => { const d = keyDate(k); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const lengthWords = (ms: number) => { const m = Math.round(ms / MIN); return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`; };

/** The week the page shows: `week` (weeks from this one), or the one `day` is in (a reminder opens its day), else this week. */
export function planWeek(ctx: BotsCtx): number {
  const w = Number(ctx.params.week);
  if (ctx.params.week !== undefined && ctx.params.week !== "" && Number.isFinite(w)) return Math.max(-8, Math.min(8, Math.round(w)));
  const day = String(ctx.params.day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  const monday = (k: string) => { const t = Date.parse(`${k}T00:00:00Z`); return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY; };
  return Math.max(-8, Math.min(8, Math.round((monday(day) - monday(dayKeyOf(ctx, ctx.live.now))) / (7 * DAY))));
}

export const dayLabelOf = (d: PlanRead, key: string) => (key === d.today ? "Today" : key === d.tomorrow ? "Tomorrow" : PLAN_WEEKDAYS_LONG[keyDate(key).getUTCDay()]!);
export const planGo = (week: number, day?: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.plan, params: { week, ...(day ? { day } : {}) }, replace: true } as ActionSpec);

export function suggestionCard(_ctx: BotsCtx, s: Suggestion, o: { desk?: boolean } = {}): Node {
  const item: { choices: Array<{ label: string; kind: "primary" | "secondary"; action: ActionRef }> } = {
    choices: [
      { label: "Move it", kind: "primary", action: call("POST", `${A}/plan/move`, { eventId: s.eventId, start: s.startIso, said: s.question }, { ok: seq(toast(`Moved to ${s.toWords}`), refresh), fail: toast("Couldn't move it. Try again.", true) }) },
      { label: `Keep ${s.fromDay}`, kind: "secondary", action: write("POST", `${A}/plan/skip`, { key: s.key }, { ok: "Kept as it is" }) },
    ],
  };
  return col([
    row([statusMark("needs", { size: 8 }), text("Needs you", { size: 11, weight: 600, lineHeight: 14, upper: true, tracking: 0.4 })], { gap: 8 }),
    text(s.question, { size: 17, weight: 600, lineHeight: 23 }),
    text(s.detail, { size: 13, color: C.grey70, lineHeight: 19 }),
    row(item.choices.map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 8, flexWrap: "wrap" }),
  ], { gap: 10, padding: 18, borderRadius: o.desk ? 18 : 20, borderWidth: o.desk ? 1.5 : 1, borderColor: o.desk ? lookOf("plan").color : C.line });
}

export function planChips(d: PlanRead): string[] {
  const busy = d.days.filter((x) => x.key > d.today).sort((a, b) => b.events.length - a.events.length)[0];
  return [busy && busy.events.length >= 2 ? `Free up ${PLAN_WEEKDAYS_LONG[keyDate(busy.key).getUTCDay()]}` : "Plan my week", "What should I do first tomorrow?"];
}

/** "From Meera S.", "Added by Plan Ease": who put it on the person's days, when not them. */
export const fromWords = (x: { from?: string }) => (x.from ? (x.from === "You" ? "" : x.from.endsWith(" bot") ? `Added by ${x.from}` : `From ${x.from}`) : "");

/** A to-do on a day or a list: its tick (on its own), and its words (open it). */
export function todoRow(ctx: BotsCtx, t: PlanTask, o: { size?: number; when?: boolean } = {}): Node {
  const sub = [o.when && t.at !== null && t.at !== undefined ? clockOf(ctx, t.at) : "", fromWords(t)].filter(Boolean).join(" · ");
  return row([
    tickBox(!!t.done, tickAction(t.id, !!t.done), t.done ? `${t.title}. Done. Tap to put it back.` : `${t.title}. Tap when it's done.`),
    col([
      text(t.title, { size: o.size ?? 14, lineHeight: 19, lines: 2, color: t.done ? C.meta : C.ink }),
      ...(sub ? [meta(sub, { size: 12, lines: 1 })] : []),
    ], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 8 }, itemAction("task", t.id)),
  ], { gap: 10, alignItems: "center" });
}

export function planHeadLine(d: PlanRead | undefined): string {
  if (!d) return "Couldn't read your days";
  const t = d.days.find((x) => x.key === d.tomorrow);
  const n = t ? t.events.length + t.tasks.filter((x) => !x.done).length : 0;
  const saved = places.savedWords(d.travel);
  return saved ? `${plural(n, "thing")} tomorrow · ${saved}` : d.suggestion ? `${plural(n, "thing")} tomorrow · 1 needs you` : `${plural(n, "thing")} tomorrow`;
}

/** Share a day's plan with a space or a person, as a copy of its lines (screens/spaces.ts bots.share). */
export function planShare(ctx: BotsCtx, d: PlanRead, day: PlanDay | undefined): Node[] {
  if (!day) return [];
  const lines = [...day.events.map((e) => `${e.allDay ? "All day" : clockOf(ctx, e.start)} · ${e.title}${e.where ? ` · ${e.where}` : ""}`), ...day.tasks.filter((t) => !t.done).map((t) => `To do · ${t.title}`)];
  const label = dayLabelOf(d, day.key);
  return lines.length ? [shareButton({ kind: "plan", title: `${label} · ${keyWords(day.key)}`, text: lines.join("\n") }, { label: `Share ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label}` })] : [];
}

/** The to-dos with no day, ticked off here. */
export function openTodos(ctx: BotsCtx, d: PlanRead): Node[] {
  const open = d.open ?? [];
  if (!open.length) return [];
  const kids: Node[] = [];
  open.slice(0, 12).forEach((t, i) => { if (i) kids.push(divider()); kids.push(box([todoRow(ctx, t)], { paddingHorizontal: 14 })); });
  return [col([
    row([sectionLabel(`To do, no day · ${open.length}`), grow(), link("Add", addAction(undefined, "task"))], { gap: 8 }),
    col(kids, { borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingVertical: 2 }),
  ], { gap: 8 })];
}

const PX = 40, FROM_H = 8, TO_H = 22;

function weekColumn(ctx: BotsCtx, d: PlanRead, day: PlanDay): Node {
  const start = Date.parse(`${day.key}T00:00:00Z`) - ctx.tzOffsetMinutes * MIN;
  const top = start + FROM_H * 3_600_000, bottom = start + TO_H * 3_600_000;
  const past = day.key < d.today;
  const kids: Node[] = [];
  let at = top;
  const leaves = day.key === d.tomorrow ? places.leaveBlocks(ctx, d.travel, day.events) : [];
  for (const e of [...day.events, ...leaves].filter((x) => !x.allDay && x.end > top && x.start < bottom).sort((a, b) => a.start - b.start)) {
    const s = Math.max(e.start, at), en = Math.min(e.end, bottom);
    if (en <= s) continue;
    if (s > at) kids.push(box([], { height: Math.round(((s - at) / 3_600_000) * PX), flexShrink: 0 }));
    const h = Math.max(20, Math.round(((en - s) / 3_600_000) * PX) - 2);
    const target = d.suggestion?.eventId === e.id;
    const leave = places.isLeave(e.id);
    kids.push(col([
      text(e.title, { size: 11.5, weight: 500, lineHeight: 15, lines: h >= 46 ? 2 : 1, color: past ? C.meta : C.ink }),
      ...(h >= 44 && e.where ? [text(e.where, { size: 10.5, color: C.meta, lineHeight: 13, lines: 1 })] : []),
    ], {
      height: h, flexShrink: 0, marginBottom: 2, borderRadius: 7, paddingVertical: 3, paddingHorizontal: 6, overflow: "hidden",
      backgroundColor: past ? C.surface : C.paper, borderWidth: past ? 0 : target ? 1.5 : 1, borderColor: target ? C.ink : C.line, ...(target ? { borderStyle: "dashed" } : {}),
      ...(leave ? places.leaveStyle() : {}),
    }, leave ? undefined : itemAction("event", e.id)));
    at = en + 2 * MIN;
  }
  const tomorrow = day.key === d.tomorrow;
  return col(kids, { flexGrow: 1, flexBasis: 0, minWidth: 0, height: (TO_H - FROM_H) * PX, paddingHorizontal: 3, borderLeftWidth: 1, borderLeftColor: C.divider, overflow: "hidden", ...(tomorrow ? { backgroundColor: C.surface, borderRadius: 10 } : {}) });
}

export function planDesk(ctx: BotsCtx, d: PlanRead | undefined) {
  const look = lookOf("plan");
  const week = planWeek(ctx);
  const weekDays = d ? d.week.map((k) => d.days.find((x) => x.key === k) ?? { key: k, events: [], tasks: [] }) : [];
  const range = weekDays.length ? `${keyDate(weekDays[0]!.key).getUTCDate()} ${MONTHS[keyDate(weekDays[0]!.key).getUTCMonth()]} – ${keyDate(weekDays[6]?.key ?? weekDays[0]!.key).getUTCDate()} ${MONTHS[keyDate(weekDays[6]?.key ?? weekDays[0]!.key).getUTCMonth()]}` : "";
  const nav = row([
    box([icon("back", { size: 16 })], { width: 30, height: 30, alignItems: "center", justifyContent: "center" }, planGo(week - 1)),
    text(range, { size: 13, weight: 500, lineHeight: 18 }),
    box([icon("chevron", { size: 16 })], { width: 30, height: 30, alignItems: "center", justifyContent: "center" }, planGo(week + 1)),
  ], { gap: 6, borderWidth: 1, borderColor: C.outline, borderRadius: 20, height: 38, paddingHorizontal: 4 });
  const head = row([box([], { width: 44 }), ...weekDays.map((x) => {
    const dt = keyDate(x.key);
    const today = x.key === d!.today, tomorrow = x.key === d!.tomorrow;
    const allDay = x.events.filter((e) => e.allDay);
    const open = x.tasks.filter((t) => !t.done).length;
    return col([
      text(tomorrow ? "Tomorrow" : WEEKDAYS[dt.getUTCDay()]!, { size: 12, weight: tomorrow ? 600 : 400, color: tomorrow ? C.ink : C.meta, lineHeight: 16 }),
      today
        ? box([text(String(dt.getUTCDate()), { size: 14, weight: 600, color: C.paper, lineHeight: 18 })], { width: 28, height: 28, borderRadius: 14, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" })
        : box([text(String(dt.getUTCDate()), { size: 14, weight: tomorrow ? 600 : 400, lineHeight: 18 })], { height: 28, justifyContent: "center" }),
      ...allDay.slice(0, 1).map((e) => text(e.title, { size: 10.5, color: C.grey70, lineHeight: 13, lines: 1 })),
      ...(open ? [text(`${plural(open, "to do", "to dos")}`, { size: 10.5, color: look.color, lineHeight: 13 })] : []),
    ], { flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "center", gap: 2 }, addAction(x.key));
  })], { gap: 0, alignItems: "flex-start" });
  const hours = col(Array.from({ length: (TO_H - FROM_H) / 2 }, (_, i) => box([meta(`${((FROM_H + i * 2) % 12) || 12} ${FROM_H + i * 2 < 12 ? "am" : "pm"}`, { size: 11 })], { height: PX * 2 })), { width: 44, flexShrink: 0 });
  const grid7 = col([head, row([hours, ...weekDays.map((x) => weekColumn(ctx, d!, x))], { alignItems: "flex-start" })], { gap: 10, flexGrow: 1, flexShrink: 1, minWidth: 0 });
  const tomorrow = d?.days.find((x) => x.key === d.tomorrow);
  const sorted: Node[] = [
    ...places.legListRows(ctx, d?.travel),
    ...(tomorrow?.tasks ?? []).map((t) => box([todoRow(ctx, t, { when: true })], { paddingHorizontal: 16, paddingVertical: 4 })),
    ...(tomorrow?.events.filter((e) => !e.allDay).slice(0, 4) ?? []).map((e) => listRow({ label: e.title, sub: `${clockOf(ctx, e.start)} · ${lengthWords(e.end - e.start)}${e.where ? ` · ${e.where}` : ""}${e.from ? ` · ${fromWords(e)}` : ""}`, left: statusMark(d?.suggestion?.eventId === e.id ? "needs" : "done"), onPress: itemAction("event", e.id) })),
  ];
  const aside = col([
    ...(d?.suggestion ? [suggestionCard(ctx, d.suggestion, { desk: true })] : []),
    col([sectionLabel("Tomorrow, sorted"), sorted.length ? listCard(sorted) : card([meta("Nothing on tomorrow yet.", { size: 13 })], { dashed: true }), ...places.planFoot(ctx, d?.travel), ...(d ? planShare(ctx, d, tomorrow) : [])], { gap: 8 }),
    ...(d ? openTodos(ctx, d) : []),
    ...places.homePart(ctx, d?.travel),
    row(d ? planChips(d).map((c) => chip(c, { onPress: askBot("plan", c) })) : [], { gap: 8, flexWrap: "wrap" }),
    chatBar(ctx, "plan", "Plan Ease", "Add dentist Fri 5 pm, or plan my week…", open(SCREENS.chat, { slug: "plan" })),
  ], { width: 300, flexShrink: 0, gap: 18 });
  return page(ctx, {
    title: "Plan Ease", nav: "plan", maxWidth: 1180, live: ["bot:plan", "calendar", "tasks"], state: { ...places.PLAN_STATE },
    body: [
      row([botAvatar(look, 44), col([title("Plan Ease", { size: 26 }), text(planHeadLine(d), { size: 13, weight: 500, color: look.color, lineHeight: 18 })], { gap: 2 }),
        ...headerBuddy(ctx, "plan", { lookTo: "down", thinkWhen: ANSWERING }), grow(),
        ...(d ? [secondaryButton("Add", addAction(d.tomorrow), { size: "md", icon: "plus" }), nav] : [])], { gap: 14 }),
      ...(!d ? [emptyState({ pose: "think", title: "Couldn't read your days", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [...(d.trouble ? [notice(d.trouble)] : []), row([grid7, aside], { gap: 28, alignItems: "flex-start" })]),
    ],
  });
}

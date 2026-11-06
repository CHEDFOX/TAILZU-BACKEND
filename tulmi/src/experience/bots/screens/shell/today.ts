/**
 * The Bots app shell's today screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { type FeedRow, longDate } from "../../../../shell/feed.js";
import {
  type BotsCtx, col, text, C, row, grow, meta, box, botLook, botAvatar, botRoute, duration, labelled, divider, emptyState, open, SCREENS,
  sectionLabel, icon, statusMark, notice, choiceRow, title, page, call, button, messageText,
} from "../../kit.js";
import { addAction } from "../planItem.js";
import { kbd, openNeed, openRow, markOf, nameOf, couldNot, avatarOf, colorOf } from "./parts.js";

// ===================================================================== today (the window's)
export interface TodayData {
  calendar: { connected: boolean; events: Array<{ start: number | null; end: number | null; title: string; with?: string; when: string }> | null };
  rows: FeedRow[];
  keybot: { words: number; minutesSaved: number; byHour: Array<{ hour: number; words: number }>; byApp: Array<{ app: string; words: number }> };
  /** Plan Ease's one Needs-you card (GET .../plan/line, botsBots/planEase.ts), when its simpler page is on: what "Plan Ease suggests" shows. */
  planNeeds?: {
    question: string; reason: string; item: string; message?: string;
    buttons: Array<{ id: string; label: string; primary?: boolean; open?: { screen: string; params?: Record<string, string> } }>;
  } | null;
}

/** "Plan Ease suggests", from its real Needs-you queue: the one card, answered through the act door as on the Plan page. */
function planSuggests(ctx: BotsCtx, n: NonNullable<TodayData["planNeeds"]>): Node {
  const act = (id: string) => call("POST", "/v1/widgets/act", { item: n.item, action: id, key: `${n.item}:${id}:${ctx.live.now}`.slice(0, 120) }, { ok: { kind: "toast", message: "Done" }, fail: { kind: "toast", message: "Couldn't do that. Try again.", tone: "error" }, stay: true });
  // A button that needs a page of its own (Send opens WhatsApp with the draft, "No" asks if they're coming) opens it, as on the Plan page.
  const press = (b: NonNullable<TodayData["planNeeds"]>["buttons"][number]) => (b.open ? open(b.open.screen, b.open.params) : act(b.id));
  return col([
    row([avatarOf(ctx, "plan", 30), text("Plan Ease suggests", { size: 15, weight: 600, lineHeight: 20 })], { gap: 10 }),
    col([
      row([statusMark("needs", { color: colorOf(ctx, "plan") }), col([text(n.question, { size: 14, weight: 600, lineHeight: 19 }), ...(n.reason ? [text(n.reason, { size: 14, lineHeight: 19, color: C.grey70 })] : [])], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" }),
      // The draft, as the person will send it: their words, in a faint message container.
      ...(n.message ? [col([messageText(ctx, n.message, { lines: 4 })], { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12 })] : []),
      row(n.buttons.slice(0, 2).map((b) => button(b.label, press(b), { kind: b.primary ? "primary" : "secondary", size: "md" })), { gap: 8, flexWrap: "wrap" }),
    ], { gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line }),
  ], { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line });
}

const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

function calendarGrid(ctx: BotsCtx, d: TodayData): Node {
  const ev = d.calendar.events ?? [];
  const local = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000);
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const timed = ev.filter((e) => e.start !== null);
  const from = Math.min(9, ...timed.map((e) => Math.floor(e.start! / 60)));
  const to = Math.max(19, ...timed.map((e) => Math.ceil((e.end ?? e.start! + 30) / 60)));
  const H = 44;
  const top = (m: number) => ((m - from * 60) / 60) * H;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const blocks = timed.map((e) => {
    const past = (e.end ?? e.start! + 30) <= nowMin;
    const isNow = e.start! <= nowMin && nowMin < (e.end ?? e.start! + 30);
    const h = Math.max(22, top(e.end ?? e.start! + 30) - top(e.start!) - 2);
    return col([
      text(e.title, { size: 12, weight: 500, lineHeight: 15, lines: 1, color: past ? C.meta : C.ink }),
      ...(h >= 34 ? [text(isNow ? "Now" : e.with ?? e.when, { size: 10.5, color: C.meta, lineHeight: 13, lines: 1 })] : []),
    ], {
      position: "absolute", left: 48, right: 0, top: top(e.start!) + 1, height: h, borderRadius: 8, paddingTop: 3, paddingHorizontal: 8, gap: 1, overflow: "hidden",
      backgroundColor: past ? C.surface : C.paper, ...(past ? {} : { borderWidth: isNow ? 1.5 : 1, borderColor: isNow ? C.ink : C.line }),
    });
  });
  const allDay = ev.filter((e) => e.start === null);
  return col([
    ...allDay.map((e) => row([text(e.title, { size: 12, weight: 500, lineHeight: 15, lines: 1 }), grow(), meta("All day", { size: 11 })], { gap: 6, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: C.line })),
    box([
      ...hours.map((h) => row([text(hourWord(h), { size: 11, color: C.meta, lineHeight: 14, style: { width: 40 } }), box([], { height: 1, flexGrow: 1, backgroundColor: C.divider })], {
        position: "absolute", left: 0, right: 0, top: top(h * 60) - 7, gap: 8,
      })),
      ...blocks,
      ...(nowMin >= from * 60 && nowMin <= to * 60 ? [row([box([], { width: 2, height: 10, backgroundColor: C.ink }), box([], { height: 1.5, flexGrow: 1, backgroundColor: C.ink })], {
        position: "absolute", left: 44, right: 0, top: top(nowMin) - 5,
      })] : []),
    ], { height: (to - from) * H + 8, marginTop: 8 }),
  ], { gap: 6 });
}

function keybotToday(ctx: BotsCtx, d: TodayData | undefined): Node {
  const k = d?.keybot;
  const keybot = ctx.live.bots.find((b) => b.slug === "keybot") ?? botLook("keybot");
  const local = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000).getUTCHours();
  const span = Array.from({ length: Math.max(1, Math.min(local, 20) - 9 + 1) }, (_, i) => 9 + i);
  const most = Math.max(1, ...(k?.byHour ?? []).map((h) => h.words));
  const barsNode = row(span.map((h) => {
    const w = k?.byHour.find((x) => x.hour === h)?.words ?? 0;
    return col([
      box([box([], { width: "100%", height: Math.max(w ? 3 : 0, Math.round((w / most) * 64)), borderRadius: 3, backgroundColor: h === local ? botLook("keybot").color : C.outline })], { height: 64, width: "100%", justifyContent: "flex-end" }),
      text(String(h % 12 === 0 ? 12 : h % 12), { size: 10.5, color: C.meta, lineHeight: 13, align: "center" }),
    ], { gap: 5, flexGrow: 1, flexBasis: 0, alignItems: "center" });
  }), { gap: 5, alignItems: "flex-end" });
  return col([
    row([botAvatar(keybot, 30), text("Keylessbord", { size: 15, weight: 600, lineHeight: 20 })], { gap: 10 }, botRoute("keybot")),
    ...(k ? [
      col([
        text(k.words.toLocaleString("en-IN"), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
        text(k.words === 1 ? "word spoken today instead of typed" : "words spoken today instead of typed", { size: 13, color: C.grey70, lineHeight: 18 }),
        ...(k.minutesSaved > 0 ? [meta(`About ${duration(k.minutesSaved)} saved`)] : []),
      ], { gap: 2 }),
      ...(k.words ? [labelled(barsNode, "Words by hour")] : []),
      ...(k.byApp.length ? [col(k.byApp.slice(0, 3).flatMap((a, i) => [...(i ? [divider()] : []), row([text(a.app, { size: 13, lineHeight: 18 }), grow(), meta(`${a.words.toLocaleString("en-IN")} words`, { size: 13 })], { paddingVertical: 9 })]))] : []),
    ] : [meta("Couldn't read today's words.")]),
    row([kbd("Fn"), meta("Hold Fn to speak in any app")], { gap: 8 }),
  ], { gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line });
}

function todayTasks(ctx: BotsCtx, rows: FeedRow[]): Node {
  const needs = ctx.live.needs.map((n): FeedRow => ({ id: n.id, type: "task", bot: n.bot, title: n.question, sub: `Needs you${n.detail ? ` · ${n.detail}` : ""}`, at: n.at, mark: "needs" }));
  const seen = new Set(needs.map((n) => n.id));
  const list = [...needs, ...rows.filter((r) => !seen.has(r.id))].slice(0, 12);
  if (!list.length) return emptyState({ pose: "hello", title: "Nothing on today yet", body: "Ask a bot for something and it shows up here.", action: { label: "Ask a bot", onPress: open(SCREENS.ask) } });
  const kids: Node[] = [];
  list.forEach((r, i) => {
    if (i) kids.push(divider());
    const act = r.mark === "needs" ? openNeed(ctx.live.needs.find((n) => n.id === r.id)!) : openRow(r);
    kids.push(row([
      box([markOf(ctx, r.mark, r.bot)], { width: 12, alignItems: "center" }),
      col([text(r.title, { size: 14, lineHeight: 19, lines: 1 }), meta(r.sub ?? "", { lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      text(nameOf(ctx, r.bot), { size: 12, color: C.grey70, lineHeight: 16, style: { flexShrink: 0 } }),
    ], { gap: 12, paddingVertical: 9, paddingHorizontal: 16 }, act));
  });
  return col([row([sectionLabel(`Tasks · ${list.length}`), grow(), text("All tasks", { size: 12, weight: 500, lineHeight: 16 }), icon("chevron", { size: 14 })], { gap: 2, minHeight: 24 }, open(SCREENS.tasks)), col(kids, { borderRadius: 18, borderWidth: 1, borderColor: C.line })], { gap: 8 });
}

export function today(ctx: BotsCtx, d: TodayData | undefined) {
  const live = ctx.live;
  const plan = live.needs.filter((n) => n.bot === "plan");
  const doneToday = (d?.rows ?? []).filter((r) => r.mark === "done").length;
  const counts = row([
    row([statusMark("needs"), text(`${live.needs.length} need you`, { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 6 }),
    row([statusMark("working", { color: live.bots.find((b) => b.working)?.color ?? C.ink }), text(`${live.working.length} working`, { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 6 }),
    row([statusMark("done"), text(`${doneToday} done today`, { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 6 }),
  ], { gap: 16, flexWrap: "wrap" });
  // The person's own calendar (src/calendar): nothing to connect.
  const today = new Date(live.now + ctx.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
  const calendar = !d ? couldNot("today")
    : !d.calendar.events ? notice("Couldn't read your calendar just now")
      : !d.calendar.events.length ? col([notice("Nothing on your calendar today", { mark: "check" }), row([icon("plus", { size: 14 }), text("Add to today", { size: 13, weight: 500, lineHeight: 18 })], { gap: 4, minHeight: 36, alignSelf: "flex-start" }, addAction(today))], { gap: 6 })
        : col([calendarGrid(ctx, d), row([text("Open Plan", { size: 13, weight: 500, lineHeight: 18 }), icon("chevron", { size: 14 })], { gap: 2, minHeight: 36, alignSelf: "flex-start" }, open(SCREENS.plan, { day: today }))], { gap: 6 });
  // With Plan Ease's simpler page, its real queue feeds the card (the old one came only from Google approvals, no longer offered).
  const suggests = d?.planNeeds ? [planSuggests(ctx, d.planNeeds)] : plan.length ? [col([
    row([avatarOf(ctx, "plan", 30), text("Plan Ease suggests", { size: 15, weight: 600, lineHeight: 20 }), grow(), text(plan.length === 1 ? "1 idea for today" : `${plan.length} ideas for today`, { size: 12, weight: 500, color: colorOf(ctx, "plan"), lineHeight: 16 })], { gap: 10 }),
    ...plan.map((n, i) => col([
      row([statusMark("needs"), col([text(n.question, { size: 14, weight: 600, lineHeight: 19 }), ...(n.detail ? [text(n.detail, { size: 14, lineHeight: 19, color: C.grey70 })] : [])], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" }),
      choiceRow(n),
    ], { gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: i === 0 ? 1.5 : 1, borderColor: i === 0 ? colorOf(ctx, "plan") : C.line })),
  ], { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line })] : [];
  const head = row([col([text(longDate(live.now, ctx.tzOffsetMinutes), { size: 14, color: C.meta, lineHeight: 18 }), title("Today")], { gap: 4 }), grow(), counts], { gap: 16, alignItems: "flex-end", flexWrap: "wrap" });

  if (ctx.client === "desktop") {
    return page(ctx, {
      nav: "today", title: "Today", gap: 18, maxWidth: 1100,
      body: [
        head,
        row([
          col([sectionLabel("Calendar"), calendar], { width: 270, flexShrink: 0, gap: 10 }),
          col([...suggests, todayTasks(ctx, d?.rows ?? [])], { gap: 18, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }),
          box([keybotToday(ctx, d)], { width: 262, flexShrink: 0 }),
        ], { gap: 26, alignItems: "flex-start" }),
      ],
    });
  }
  return page(ctx, {
    back: true, title: "Today", gap: 18,
    body: [head, col([sectionLabel("Calendar"), calendar], { gap: 10 }), ...suggests, todayTasks(ctx, d?.rows ?? []), keybotToday(ctx, d)],
  });
}

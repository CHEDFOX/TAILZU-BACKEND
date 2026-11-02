/**
 * The Bots app shell's tasksDesk screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { type FeedRow, clockOf, dayLabel } from "../../../../shell/feed.js";
import {
  type NeedsItem, duration, type BotsCtx, row, col, text, C, icon, notice, meta, statusMark, percent, sectionLabel, when, button, whenEq,
  divider, page, title, grow, box, segmented, secondaryButton, open, SCREENS, emptyState,
} from "../../kit.js";
import { addAction, itemAction } from "../planItem.js";
import { avatarOf, colorOf, stageBars, markOf, openRow, couldNot } from "./parts.js";

// ===================================================================== tasks
export interface TasksData {
  rows: FeedRow[];
  upcoming: { connected: boolean; todos: Array<{ id?: string; title: string; due?: string; overdue?: boolean; notes?: string }> | null };
  took: number;
  total: number;
  minutesSaved: number;
}

/** A decision's choices, worded for a task list: a connected app's yes is "Do it for me", its no "I'll do it". */
export function taskChoices(n: NeedsItem): NeedsItem["choices"] {
  if (!n.id.startsWith("task:")) return n.choices.filter((c) => c.kind !== "quiet").slice(0, 2);
  return n.choices.map((c) => c.kind === "primary" ? { ...c, label: "Do it for me" } : { ...c, label: "I'll do it" });
}

export function tasksLine(d: TasksData | undefined): string {
  if (!d) return "Today's work by your bots";
  const saved = d.minutesSaved > 0 ? ` · ${duration(d.minutesSaved)} saved` : "";
  return d.total ? `Bots took ${d.took} of ${d.total} today${saved}` : `Nothing on today yet${saved}`;
}

export function taskRowNode(ctx: BotsCtx, r: FeedRow, size: number): Node {
  const working = r.mark === "working";
  return row([
    avatarOf(ctx, r.bot, size),
    col([
      text(r.title, { size: 14, lineHeight: 19, lines: 2 }),
      text(working && r.stage ? `Doing it for you · step ${r.stage.at + 1} of ${r.stage.of}` : r.sub ?? "", {
        size: 12, lineHeight: 16, lines: 1, color: working ? colorOf(ctx, r.bot) : C.meta, weight: working ? 500 : 400,
      }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(working && r.stage && ctx.client === "desktop" ? [stageBars(r.stage.at, r.stage.of, colorOf(ctx, r.bot))] : []),
    ...(r.mark === "done" || r.mark === "working" || r.mark === "failed" ? [markOf(ctx, r.mark, r.bot)] : []),
  ], { gap: 12, ...(ctx.client === "desktop" ? { paddingVertical: 13, paddingHorizontal: 16 } : { alignItems: "flex-start" }) }, openRow(r));
}

/** The person's own open to-dos for the week (src/calendar): each opens to change or tick it. */
export function upcomingNodes(ctx: BotsCtx, d: TasksData | undefined): Node[] {
  const up = d?.upcoming;
  const add = row([icon("plus", { size: 14 }), text("Add a to-do", { size: 13, weight: 500, lineHeight: 18 })], { gap: 4, minHeight: 36, alignSelf: "flex-start" }, addAction(undefined, "task"));
  if (!up) return [couldNot("your to-dos")];
  if (!up.todos) return [couldNot("your to-dos")];
  if (!up.todos.length) return [notice("Nothing coming up", { mark: "check" }), add];
  return [col(up.todos.slice(0, 12).map((t) => row([
    avatarOf(ctx, "plan", ctx.client === "desktop" ? 32 : 30),
    col([text(t.title, { size: 14, lineHeight: 19, lines: 2 }), meta([t.overdue ? `Overdue since ${t.due}` : t.due ? `Due ${t.due}` : "No date", t.notes].filter(Boolean).join(" · "), { lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
    ...(t.overdue ? [statusMark("needs")] : []),
  ], { gap: 12, ...(ctx.client === "desktop" ? { paddingVertical: 13, paddingHorizontal: 16 } : {}) }, t.id ? itemAction("task", t.id) : undefined)), ctx.client === "desktop" ? { borderRadius: 18, borderWidth: 1, borderColor: C.line } : { gap: 14 }), add];
}

function taskDetail(ctx: BotsCtx, n: NeedsItem): Node {
  const [kind] = n.id.split(":");
  const facts: Array<[string, string]> = kind === "job"
    ? [["Xode", "is waiting"], [percent(ctx.live.usage.used), ctx.live.usage.windows ? "of this stretch used" : "of this month used"], [clockOf(n.at, ctx.tzOffsetMinutes), "waiting since"]]
    : [[n.botName, "will do it"], [clockOf(n.at, ctx.tzOffsetMinutes), "waiting since"], ["1 hour", "the yes holds for"]];
  const willDo = kind === "job" ? ["Goes on with your answer", "Shows you the change before it ships"] : [n.detail ? `Does exactly this: ${n.detail}` : "Does exactly what the card says", "Tells you when it's done"];
  const wont = kind === "job" ? ["Merge or ship without your yes", "Go on past what it was given without asking"] : ["Pay for you", "Do anything else without asking"];
  const list = (head: string, items: string[]) => col([sectionLabel(head), ...items.map((s) => row([text("·", { size: 13, color: C.idle, lineHeight: 18 }), text(s, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" }))], { gap: 6, flexGrow: 1, flexBasis: 0 });
  return when({ eq: ["sel", n.id] }, col([
    row([
      avatarOf(ctx, n.bot, 40),
      col([text(n.question, { size: 20, weight: 700, tracking: -0.3, lineHeight: 25, lines: 3 }), meta(`${n.botName} · ${dayLabel(n.at, ctx.live.now, ctx.tzOffsetMinutes)}, ${clockOf(n.at, ctx.tzOffsetMinutes)}`)], { gap: 3, flexGrow: 1, flexShrink: 1 }),
      row([statusMark("needs"), text("Needs you", { size: 12, weight: 500, lineHeight: 16 })], { gap: 6, flexShrink: 0 }),
    ], { gap: 12, alignItems: "flex-start" }),
    row(facts.map(([a, b]) => col([text(a, { size: 15, weight: 600, lineHeight: 20, lines: 1 }), meta(b)], { gap: 1, flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 })), { gap: 8 }),
    ...(n.detail ? [col([sectionLabel(kind === "job" ? "About" : "The exact change"), text(n.detail, { size: 14, lineHeight: 20, color: C.grey70 })], { gap: 6 })] : []),
    row([list("If it does it for you", willDo), list("It won't", wont)], { gap: 16, alignItems: "flex-start" }),
    row(taskChoices(n).map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 10, flexWrap: "wrap" }),
  ], { gap: 16, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: C.line }));
}

export function tasksDesk(ctx: BotsCtx, d: TasksData | undefined) {
  const needs = ctx.live.needs;
  const rows = d?.rows ?? [];
  const rest = rows.filter((r) => r.mark !== "needs");
  const upCount = d?.upcoming.todos?.length ?? 0;
  const needRow = (n: NeedsItem) => row([
    avatarOf(ctx, n.bot, 32),
    col([text(n.question, { size: 14, weight: 600, lineHeight: 19, lines: 2 }), meta([n.botName, n.detail].filter(Boolean).join(" · "), { lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    statusMark("needs"),
  ], {
    gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 16, backgroundColor: C.paper,
    borderWidth: whenEq("sel", n.id, 1.5, 1), borderColor: whenEq("sel", n.id, colorOf(ctx, n.bot), C.line),
  }, { kind: "setState", path: "sel", value: n.id });
  const restList = rest.length ? [col([sectionLabel(`Rest of today · ${rest.length}`), (() => {
    const kids: Node[] = [];
    rest.forEach((r, i) => { if (i) kids.push(divider()); kids.push(taskRowNode(ctx, r, 32)); });
    return col(kids, { borderRadius: 18, borderWidth: 1, borderColor: C.line });
  })()], { gap: 10 })] : [];
  return page(ctx, {
    tab: "bots", title: "Tasks", gap: 18, maxWidth: 1100, state: { tview: "today", ...(needs[0] ? { sel: needs[0].id } : {}) },
    body: [
      row([
        col([title("Tasks"), meta(tasksLine(d), { size: 14, lineHeight: 19 })], { gap: 4 }),
        grow(),
        box([segmented([{ label: `Today · ${needs.length + rest.length}`, value: "today" }, { label: `Upcoming · ${upCount}`, value: "upcoming" }, { label: `Needs you · ${needs.length}`, value: "needs" }], "tview")], { width: 360 }),
        secondaryButton("Add a task", open(SCREENS.ask), { size: "md", icon: "plus" }),
      ], { gap: 12, alignItems: "flex-end", flexWrap: "wrap" }),
      ...(d ? [] : [couldNot("your tasks")]),
      row([
        col([
          when({ in: ["tview", ["today", "needs"]] }, col([
            ...(needs.length ? [col([sectionLabel(`Needs you · ${needs.length}`), ...needs.map(needRow)], { gap: 10 })] : [notice("Nothing needs you right now", { mark: "check" })]),
          ], { gap: 10 })),
          when({ eq: ["tview", "today"] }, col(restList, { gap: 10 })),
          when({ eq: ["tview", "upcoming"] }, col([sectionLabel(`Upcoming · ${upCount}`), ...upcomingNodes(ctx, d)], { gap: 10 })),
        ], { gap: 16, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }),
        col(needs.length ? needs.map((n) => taskDetail(ctx, n)) : [emptyState({ pose: "done", title: "All clear", body: "When a bot needs your yes, it shows up here with what it will and won't do." })], { width: 440, flexShrink: 1 }),
      ], { gap: 24, alignItems: "flex-start" }),
    ],
  });
}

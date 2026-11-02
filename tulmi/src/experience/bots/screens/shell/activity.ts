/**
 * The Bots app shell's activity screen, on the phone and in the window (activityPhone, activityDesk).
 */

import type { Condition, Node, ActionSpec } from "../../../../../../shared/types/sdui.js";
import { type FeedRow, dayLabel, clockOf } from "../../../../shell/feed.js";
import {
  labelled, box, icon, C, seq, call, when, row, secondaryButton, primaryButton, grow, type BotsCtx, col, text, meta, statusMark, page,
  title, roundButton, open, SCREENS, segmented, sectionLabel, emptyState, duration, RADIUS, grid, button,
} from "../../kit.js";
import { toast, avatarOf, colorOf, openRow, stageBars, openNeed, couldNot, markOf, nameOf, dotChip } from "./parts.js";

// ===================================================================== activity
export interface ActivityData { now: number; week: { done: number; paise: number; minutesSaved: number }; rows: FeedRow[] }

const KIND_OF: Record<FeedRow["type"], "jobs" | "payments" | "words"> = { job: "jobs", task: "jobs", ask: "jobs", payment: "payments", words: "words" };

/** Rows grouped by the person's day, newest day first. */
function byDay(rows: FeedRow[], now: number, tz: number): Array<{ label: string; rows: FeedRow[] }> {
  const out: Array<{ label: string; rows: FeedRow[] }> = [];
  for (const r of rows) {
    const label = dayLabel(r.at, now, tz);
    const g = out.find((x) => x.label === label);
    if (g) g.rows.push(r); else out.push({ label, rows: [r] });
  }
  return out;
}

// A row's ✕: a small card under it, two ways to take it off the list (either one: only the list forgets it, the job, the
// payment or the words stay) and its own ✕ to leave it be. Gone at once on the screen; the server keeps it off the list.
const clearedKey = (id: string): string => `cleared_${id.replace(/[^a-z0-9]/gi, "_")}`;
/** Still on the list: not cleared on this screen just now. */
const kept = (r: FeedRow): Condition => ({ falsy: clearedKey(r.id) });

function clearX(r: FeedRow): Node {
  const set = (value: string): ActionSpec => ({ kind: "setState", path: "clearing", value });
  return labelled(box([icon("close", { size: 14, color: C.meta })], { width: 32, height: 32, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    { kind: "condition", if: { eq: ["clearing", r.id] }, then: set(""), else: set(r.id) } as ActionSpec), "Clear from Activity");
}

function clearCard(r: FeedRow): Node {
  const k = clearedKey(r.id);
  const clear = seq(
    { kind: "setState", path: k, value: true }, { kind: "setState", path: "clearing", value: "" },
    call("POST", "/v1/shell/activity/clear", { id: r.id }, { fail: seq({ kind: "setState", path: k, value: false }, toast("Couldn't clear that. Try again.", "error")) }),
  );
  return when({ eq: ["clearing", r.id] }, row([
    secondaryButton("Don't want to see it", clear, { size: "md" }),
    primaryButton("Just do it", clear, { size: "md" }),
    grow(),
    labelled(box([icon("close", { size: 16 })], { width: 36, height: 36, alignItems: "center", justifyContent: "center" }, { kind: "setState", path: "clearing", value: "" }), "Keep it"),
  ], { gap: 8, padding: 10, borderRadius: 16, backgroundColor: C.surface, flexWrap: "wrap", alignItems: "center" }));
}

export function activityPhone(ctx: BotsCtx, data: ActivityData | undefined) {
  const live = ctx.live;
  const rows = data?.rows ?? [];
  const working = rows.filter((r) => r.mark === "working");
  const rest = rows.filter((r) => r.mark !== "working" && r.mark !== "needs");
  const show = (vals: string[]): Condition => ({ in: ["show", vals] });
  const nowBlocks: Node[] = [
    ...working.slice(0, 2).map((r) => when({ all: [show(["all", "working"]), kept(r)] }, col([
      row([
        row([
          avatarOf(ctx, r.bot, 30),
          text(r.title, { size: 14, weight: 600, lineHeight: 19, lines: 1, style: { flexShrink: 1, flexGrow: 1 } }),
          text(r.stage ? `${r.stage.at} of ${r.stage.of} done` : "Working", { size: 12, weight: 500, color: colorOf(ctx, r.bot), lineHeight: 16, style: { flexShrink: 0 } }),
        ], { gap: 10, flexGrow: 1, flexShrink: 1 }, openRow(r)),
        clearX(r),
      ], { gap: 4 }),
      box([r.stage ? stageBars(r.stage.at, r.stage.of, colorOf(ctx, r.bot), { grow: true, h: 5 }) : meta(r.sub ?? "", { lines: 1 })], {}, openRow(r)),
      clearCard(r),
    ], { gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }))),
    ...live.needs.map((n) => when(show(["all", "needs"]), row([
      avatarOf(ctx, n.bot, 30),
      col([text(`${n.botName} needs you`, { size: 14, weight: 600, lineHeight: 19 }), text(n.question, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      statusMark("needs"),
    ], { gap: 12, alignItems: "flex-start" }, openNeed(n)))),
  ];
  const days = byDay(rest, data?.now ?? live.now, ctx.tzOffsetMinutes);
  const empty = !rows.length && !live.needs.length;
  return page(ctx, {
    tab: "activity", title: "Activity", gap: 16,
    state: { show: "all", clearing: "" },
    // Pull-a-bot at both ends: what is new is a row of the feed or a decision; the newest are at the top. A feed that
    // could not be read names no items, so the one read after it is not all "new".
    pullBot: { top: true, bottom: true, ...(data ? { items: [...live.needs.map((x) => x.id), ...rows.map((r) => r.id)] } : {}) },
    body: [
      row([title("Activity"), grow(), roundButton("check", open(SCREENS.tasks), { size: 44, light: true, label: "Tasks" })], { gap: 10 }),
      segmented([
        { label: "All", value: "all" }, { label: `Needs you · ${live.needs.length}`, value: "needs" },
        { label: `Working · ${Math.max(working.length, live.working.length)}`, value: "working" },
      ], "show"),
      ...(data ? [] : [couldNot("your activity")]),
      ...(nowBlocks.length ? [col([sectionLabel("Now"), ...nowBlocks], { gap: 14 })] : []),
      ...days.map((d) => when(show(["all"]), col([
        sectionLabel(d.label),
        ...d.rows.map((r) => when(kept(r), col([
          row([
            row([
              avatarOf(ctx, r.bot, 30),
              col([
                text(r.title, { size: 14, lineHeight: 19, lines: 2 }),
                meta(r.sub ?? "", { lines: 1 }),
              ], { gap: 2, flexGrow: 1, flexShrink: 1 }),
              // No failed mark: it is a cross too, beside the row's own ✕, and the line under the title already says so.
            ], { gap: 12, alignItems: "flex-start", flexGrow: 1, flexShrink: 1 }, openRow(r)),
            clearX(r),
          ], { gap: 4, alignItems: "flex-start" }),
          clearCard(r),
        ], { gap: 8 }))),
      ], { gap: 14 }))),
      ...(empty && data ? [emptyState({ pose: "hello", title: "Nothing here yet", body: "What your bots do shows up here.", action: { label: "Ask a bot", onPress: open(SCREENS.ask) } })] : []),
    ],
  });
}

export function activityDesk(ctx: BotsCtx, data: ActivityData | undefined) {
  const live = ctx.live;
  const rows = data?.rows ?? [];
  const tz = ctx.tzOffsetMinutes;
  const week = data?.week;
  const weekWords = week ? [
    "This week", `${week.done} ${week.done === 1 ? "job" : "jobs"} done`,
    ...(week.minutesSaved > 0 ? [`${duration(week.minutesSaved)} saved`] : []),
  ].join(" · ") : "";
  const COLS = { mark: 12, time: 64, bot: 128, proof: 74, clear: 32 };
  const rowCond = (r: FeedRow): Condition => ({ all: [{ in: ["fbot", ["all", r.bot]] }, { in: ["ftype", ["all", KIND_OF[r.type]]] }] });
  const cell = (n: Node, w?: number): Node => box([n], w ? { width: w, flexShrink: 0 } : { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 });
  const head = row([
    cell(box([]), COLS.mark), cell(sectionLabel("Time"), COLS.time), cell(sectionLabel("Bot"), COLS.bot), cell(sectionLabel("What happened")),
    cell(sectionLabel("Proof"), COLS.proof), cell(box([]), COLS.clear),
  ], { gap: 14, paddingVertical: 10, paddingHorizontal: 16 });
  const line = (r: FeedRow): Node => when({ all: [rowCond(r), kept(r)] }, col([
    row([
      cell(markOf(ctx, r.mark, r.bot), COLS.mark),
      cell(text(clockOf(r.at, tz), { size: 12.5, color: C.meta, lineHeight: 17 }), COLS.time),
      cell(row([avatarOf(ctx, r.bot, 26), text(nameOf(ctx, r.bot), { size: 13, weight: 500, lineHeight: 17, lines: 1, style: { flexShrink: 1 } })], { gap: 8 }), COLS.bot),
      cell(col([text(r.title, { size: 14, lineHeight: 19, lines: 2 }), ...(r.sub ? [meta(r.sub, { lines: 1 })] : [])], { gap: 2 })),
      cell(r.open ? row([text("Receipt", { size: 13, weight: 500, lineHeight: 17 }), icon("chevron", { size: 14 })], { gap: 2, minHeight: 32 }, openRow(r)) : box([]), COLS.proof),
      cell(clearX(r), COLS.clear),
    ], { gap: 14 }),
    clearCard(r),
  ], { gap: 8, paddingVertical: 10, paddingHorizontal: 16 }));
  const days = byDay(rows, data?.now ?? live.now, tz);
  const table = col([
    head,
    ...days.flatMap((d) => [
      when({ any: d.rows.map(rowCond) }, box([sectionLabel(d.label)], { paddingTop: 10, paddingBottom: 2, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: C.divider })),
      ...d.rows.map(line),
    ]),
  ], { borderRadius: RADIUS.list, borderWidth: 1, borderColor: C.line, paddingBottom: 6, overflow: "hidden" });
  const botsInFeed = [...new Set([...live.bots.map((b) => b.slug), ...rows.map((r) => r.bot)])].filter((s) => s === "tailzu" ? rows.some((r) => r.bot === "tailzu") : true);

  return page(ctx, {
    tab: "activity", title: "Activity", gap: 18, maxWidth: 1100,
    state: { fbot: "all", ftype: "all", clearing: "" },
    body: [
      row([title("Activity"), grow(), ...(weekWords ? [text(weekWords, { size: 13, color: C.grey70, lineHeight: 18 })] : [])], { gap: 16, alignItems: "flex-end", flexWrap: "wrap" }),
      ...(data ? [] : [couldNot("your activity")]),
      ...(live.needs.length ? [col([
        sectionLabel(`Needs you · ${live.needs.length}`),
        grid(live.needs.map((n) => row([
          avatarOf(ctx, n.bot, 30),
          col([
            row([statusMark("needs"), meta(`${n.botName} · ${clockOf(n.at, tz)}`)], { gap: 6 }),
            text(n.question, { size: 14, weight: 600, lineHeight: 19, lines: 2 }),
            ...(n.detail ? [meta(n.detail, { lines: 1 })] : []),
          ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          row(n.choices.filter((c) => c.kind !== "quiet").slice(0, 2).map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 8 }),
        ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line })), live.needs.length > 1 ? 2 : 1, 12),
      ], { gap: 10 })] : []),
      col([
        row([
          row([dotChip("All bots", "fbot", "all"), ...botsInFeed.map((s) => dotChip(nameOf(ctx, s), "fbot", s, colorOf(ctx, s)))], { gap: 6, flexWrap: "wrap", flexShrink: 1 }),
          grow(),
          box([segmented([{ label: "All", value: "all" }, { label: "Jobs", value: "jobs" }, { label: "Payments", value: "payments" }, { label: "Words", value: "words" }], "ftype")], { width: 300, flexShrink: 0 }),
        ], { gap: 12, alignItems: "flex-start" }),
        rows.length ? table : data ? emptyState({ pose: "hello", title: "Nothing here yet", body: "What your bots do shows up here.", action: { label: "Ask a bot", onPress: open(SCREENS.ask) } }) : box([]),
      ], { gap: 10 }),
    ],
  });
}

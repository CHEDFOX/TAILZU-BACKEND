/**
 * THE SHELL: Home, and what is around it (Activity, Ask, Search, Notifications, first run, the system states).
 *
 * bots.home is the REFERENCE SCREEN (Main.dc.html on the phone, DeskHome.dc.html in the window): copy its shape.
 * Everything it shows is ctx.live (live.ts), so it needs no `load`. Its actions are real: a bot's tile opens the
 * bot, the needs-you choices answer the job (POST /v1/code/jobs/:id/answer) or the task, the ask bar sends to
 * the front door (POST /v1/ask) and opens the answer.
 *
 * bots.ask here is only the answer page the ask bar lands on; Ask.dc.html / DeskAsk.dc.html replace it.
 */
import type { Node } from "../../../../../shared/types/sdui.js";
import {
  askBar, body, botRoute, botTile, box, C, col, duration, grid, grow, makeBotTile, meta, needsCard, open, page, row,
  roundButton, SCREENS, text, tailzuMark, title, toTab, icon, type BotsCtx, type LiveBot,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

/** A bot's line on its tile when it is idle. */
export function idleLine(bot: LiveBot, client: "phone" | "desktop"): string {
  switch (bot.slug) {
    case "code": return "Fixes and ships your code";
    case "keybot": return client === "desktop" ? "Hold a key, speak, done" : "Your keyboard, everywhere";
    case "plan": return "Plans your day";
    case "travel": return "Plans your trips";
    default: return bot.purpose.length > 40 ? bot.purpose.slice(0, 39).trimEnd() + "…" : bot.purpose;
  }
}

/** "4 things done this week · 2 h saved", or the nearest true thing. */
export function weekLine(week: { done: number; minutesSaved: number }): string {
  const done = week.done === 1 ? "1 thing done this week" : `${week.done} things done this week`;
  const saved = week.minutesSaved > 0 ? `${duration(week.minutesSaved)} saved` : "";
  if (week.done > 0) return saved ? `${done} · ${saved}` : done;
  return saved ? `${saved} this week` : "Nothing done yet this week";
}

/** The week as beads: one ink dot per thing done (six at most), then a hollow one for the next. */
function weekBeads(done: number): Node {
  const dot = (filled: boolean): Node => box([], filled
    ? { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ink }
    : { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.dashed });
  return row([...Array.from({ length: Math.min(done, 6) }, () => dot(true)), dot(false)], { gap: 4 });
}

function weekRow(ctx: BotsCtx): Node {
  return row([weekBeads(ctx.live.week.done), text(weekLine(ctx.live.week), { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 10 });
}

/** The tiles: the three bots that matter most right now (needs you, working, then the built-ins), and Make a bot. */
function tiles(ctx: BotsCtx, columns: number, height: number, padding: number): Node {
  const shown = ctx.live.bots.slice(0, 3);
  return grid([
    ...shown.map((b) => botTile(b, { idle: idleLine(b, ctx.client), onPress: botRoute(b.slug), height, padding })),
    makeBotTile({ onPress: open(SCREENS.make), height, padding }),
  ], columns, columns === 4 ? 14 : 12);
}

function homePhone(ctx: BotsCtx) {
  const first = ctx.live.needs[0];
  return page(ctx, {
    tab: "bots", title: "Your bots",
    body: [
      row([
        tailzuMark(34),
        col([text(ctx.live.greeting, { size: 13, color: C.meta, lineHeight: 17 }), text("Your bots", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 })], { gap: 2 }),
        grow(),
        roundButton("person", toTab("you"), { size: 44, light: true, label: "Profile and settings" }),
      ], { gap: 10 }),
      weekRow(ctx),
      ...(first ? [needsCard(first)] : []),
      tiles(ctx, 2, 132, 16),
    ],
    footer: [askBar("phone")],
  });
}

function homeDesk(ctx: BotsCtx) {
  const first = ctx.live.needs[0];
  return page(ctx, {
    tab: "bots", title: "Your bots",
    body: [
      row([
        col([text(ctx.live.greeting, { size: 14, color: C.meta, lineHeight: 18 }), title("What should we do?", { size: 32, tracking: -0.8, lineHeight: 38 })], { gap: 4 }),
        grow(),
        weekRow(ctx),
      ], { alignItems: "flex-end", flexWrap: "wrap", gap: 12 }),
      ...(first ? [needsCard(first, { layout: "row" })] : []),
      tiles(ctx, 4, 150, 18),
    ],
    footer: [askBar("desktop")],
  });
}

/** The answer page the ask bar opens: what was asked, and the answer (params: message, answer, id). */
function askAnswer(ctx: BotsCtx) {
  const asked = String(ctx.params.message ?? "");
  const answer = String(ctx.params.answer ?? "");
  const blocks: Node[] = [];
  if (asked) {
    blocks.push(row([box([body(asked)], { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, maxWidth: "85%" })], { justifyContent: "flex-end" }));
  }
  blocks.push(answer
    ? col([row([icon("spark", { size: 16, color: C.meta }), meta("Answered by your bots", { size: 12 })], { gap: 6 }), body(answer, { lineHeight: 22 })], { gap: 8 })
    : meta(ctx.params.voice ? "Hold the mic and speak, or type below." : "Ask any bot anything.", { size: 14 }));
  return page(ctx, { back: true, backTitle: "Ask", title: "Ask", nav: "bots", body: blocks, footer: [askBar(ctx.client)], gap: 18 });
}

export const shellScreens: BotsScreen[] = [
  screen({ id: SCREENS.home, build: (ctx) => (ctx.client === "desktop" ? homeDesk(ctx) : homePhone(ctx)) }),
  screen({ id: SCREENS.ask, build: (ctx) => askAnswer(ctx) }),
];

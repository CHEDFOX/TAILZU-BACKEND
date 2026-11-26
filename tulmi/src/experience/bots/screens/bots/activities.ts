/**
 * ACTIVITIES: THE SECOND TAB — what your work is doing, not which bots you own (docs/talk-door.md).
 *
 * Talk is one conversation. What it produces is many things, and each of them is a card here: what it is, which bots
 * are on it drawn joined on one thread, and what it came to. Schedules — the things that will happen again — sit on
 * top, because a thing that WILL happen and a thing that IS happening read differently.
 *
 * THE CARD IS THE OUTCOME, AND TAPPING IT OPENS THE WORK — the job, the payment, the trip. Never the conversation:
 * the whole point of a card is that you do not have to go back into a transcript to find out what happened.
 *
 * NOTHING NEW IS DRAWN. The rules are `botsBots/activities.ts` (pure, tested, no model); the parts are the kit's own
 * card, rows and SVG. The one drawing of its own is the thread the bots stand on, which is a line and some circles.
 *
 * THE "+" IS THE BOTS. It opens the roster, grouped, as the place you go to start something — which is the one job a
 * list of bots still does well once nobody has to pick one to get an answer.
 */
import type { Node } from "../../../../../../shared/types/sdui.js";
import type { Activity, ActivityBot, ActivitySchedule } from "../../../../botsBots/activities.js";
import {
  type BotsCtx, page, col, row, text, meta, grow, box, C, open, SCREENS, sectionLabel, emptyState, botAvatar,
  statusMark, roundButton, labelled, title as pageTitle, appMark, RADIUS, botLook,
} from "../../kit.js";
import { shapes } from "../../glyphs.js";
import { refresh } from "./parts.js";

/** What the screen reads (GET /v1/botsapp/activities). */
export interface ActivitiesData {
  schedules?: ActivitySchedule[];
  now?: Activity[];
  done?: Activity[];
  down?: boolean;
}

/** How many finished ones a card list shows before "see them all" takes over (the ledger has the rest). */
const DONE_SHOWN = 6;

// ===================================================================== the bots, joined on one thread

/**
 * THE BOTS ON AN ACTIVITY, JOINED. One head per bot on a hairline that runs between them, so two bots on one piece of
 * work read as one piece of work — which is the whole reason this screen exists rather than a list of events.
 *
 * It is one SVG: a line across, and a filled circle per bot in that bot's own colour. Drawn under the real heads, so
 * the heads stay the heads the rest of the app uses (botAvatar) and nothing here invents a second way to draw a bot.
 */
function botThread(bots: ActivityBot[]): Node {
  // The gap is wide enough that the thread between two heads is actually SEEN: at 10 the heads nearly touched and the
  // line behind them read as nothing, which lost the one thing this card is for.
  const size = 26, gap = 16, step = size + gap;
  const w = bots.length * size + Math.max(0, bots.length - 1) * gap;
  const mid = size / 2;
  // The line sits behind the heads and stops at the first and last, so it never runs off either end.
  const line = bots.length > 1
    ? [{ d: `M${mid} ${mid}H${(bots.length - 1) * step + mid}`, stroke: C.idle, strokeWidth: 1.5, linecap: "round" as const }]
    : [];
  return box([
    box([shapes(line, { viewBox: `0 0 ${w} ${size}`, width: w, height: size })], { position: "absolute", left: 0, top: 0 }),
    // The bot's OWN look (its icon and head), wearing the colour the activity kept, so a bot reads as itself here
    // exactly as it does on Home and in the thread.
    row(bots.map((b) => botAvatar({ ...botLook(b.slug), color: b.color }, size)), { gap }),
  ], { width: w, height: size, flexShrink: 0 });
}

/** The names under the heads: "Nomaz · Nudj", in grey, one line. */
const botNames = (bots: ActivityBot[]): string => bots.map((b) => b.name).join(" · ");

// ===================================================================== a card

/** The mark at a card's corner: what it is doing, in one dot. Nothing for a finished one. */
function mark(a: Activity): Node[] {
  if (a.state === "needs") return [statusMark("needs", { size: 9 })];
  if (a.state === "working") return [statusMark("working", { size: 9, color: a.bots[0]?.color ?? C.ink })];
  if (a.state === "failed") return [statusMark("failed", { size: 9 })];
  return [];
}

/**
 * ONE ACTIVITY. The title in the person's own first words, the bots joined under it, and what it came to — composed by
 * rule, so a card can never describe work that did not happen.
 */
function card(a: Activity): Node {
  const head = row([
    text(a.title, { size: 15, weight: 600, lineHeight: 20, lines: 2, style: { flexShrink: 1, flexGrow: 1 } }),
    ...mark(a),
  ], { gap: 10, alignItems: "flex-start" });
  return col([
    head,
    row([botThread(a.bots), col([meta(botNames(a.bots), { size: 12, lines: 1 })], { flexShrink: 1, justifyContent: "center" })], { gap: 10, alignItems: "center" }),
    ...(a.line ? [text(a.line, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 })] : []),
  ], {
    gap: 10, padding: 16, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line,
  }, a.open ? open(a.open.screenId, a.open.params) : undefined);
}

/** A thing that will happen again: its bot, what it does, when, and when next. */
function scheduleCard(s: ActivitySchedule): Node {
  return row([
    botAvatar({ ...botLook(s.bot.slug), color: s.bot.color }, 30),
    col([
      text(s.task, { size: 14, weight: 600, lineHeight: 19, lines: 1 }),
      meta(s.paused ? `${s.when} · paused` : `${s.when}${s.next ? ` · next ${s.next}` : ""}`, { size: 12, lines: 1 }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  ], {
    gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, borderStyle: "dashed",
    ...(s.paused ? { opacity: 0.6 } : {}),
  }, open(SCREENS.routines));
}

// ===================================================================== the page

export function activitiesPage(ctx: BotsCtx, d: ActivitiesData | undefined): ReturnType<typeof page> {
  const data = d ?? { down: true };
  const now = data.now ?? [];
  const done = data.done ?? [];
  const schedules = data.schedules ?? [];
  const desk = ctx.client === "desktop";
  const empty = !now.length && !done.length && !schedules.length;

  const head = row([
    // The same mark as Talk's, and the same way to your people and spaces (kit appMark).
    appMark(ctx, desk ? 34 : 30, now.filter((a) => a.state === "working").flatMap((a) => a.bots.map((b) => b.color)).slice(0, 4)),
    pageTitle("Activities", { size: desk ? 24 : 22 }),
    grow(),
    roundButton("search", open(SCREENS.search), { size: desk ? 36 : 34, light: true, label: "Search everything" }),
    roundButton("person", open(SCREENS.you), { size: desk ? 36 : 34, light: true, label: "Profile and settings" }),
  ], { gap: 10, alignItems: "center", paddingBottom: 6 });

  return page(ctx, {
    tab: "activity", title: "Activities", ...(desk ? { maxWidth: 820 } : {}),
    pullBot: { top: true, items: [...schedules.map((s) => `s:${s.id}`), ...now.map((a) => a.id), ...done.map((a) => a.id)] },
    body: [
      head,
      ...(data.down ? [emptyState({ pose: "think", title: "Couldn't open your activities", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })] : []),
      ...(schedules.length ? [col([sectionLabel("Schedules"), ...schedules.map(scheduleCard)], { gap: 10 })] : []),
      ...(now.length ? [col([sectionLabel("Now"), ...now.map(card)], { gap: 12 })] : []),
      ...(done.length ? [col([
        row([sectionLabel("Done"), grow(), ...(done.length > DONE_SHOWN ? [labelled(text("See them all", { size: 13, weight: 500, lineHeight: 17, color: C.meta }), "The whole ledger")] : [])], { alignItems: "center" }),
        ...done.slice(0, DONE_SHOWN).map(card),
      ], { gap: 12 })] : []),
      ...(empty && !data.down ? [emptyState({
        pose: "hello", title: "Nothing on yet",
        body: "Ask for something in Talk and it shows up here, with the bots that did it.",
      })] : []),
    ],
    // THE "+" IS THE BOTS: the roster, as the place you go to start something.
    footer: [row([grow(), labelled(box([text("+", { size: 26, weight: 600, lineHeight: 30, color: C.paper })], {
      width: 56, height: 56, borderRadius: 28, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0,
    }, open(SCREENS.start)), "Start something: your bots")], {})],
    gap: 20,
  });
}


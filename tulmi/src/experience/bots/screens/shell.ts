/**
 * THE SHELL: Home, and what is around it (Activity, Ask, Search, Tasks, Approve, the system states), and the window's own page
 * Today. Notes (the meetings, and one meeting) is its own: screens/notes.ts; Home has its tile.
 *
 * bots.home is the REFERENCE SCREEN (Main.dc.html on the phone, DeskHome.dc.html in the window): copy its shape.
 * Everything it shows is ctx.live (live.ts); its one read is whether the person has done anything yet, so a new person lands
 * on the empty home (EmptyHome) instead of four idle tiles. Its actions are real: a bot's tile opens the bot, the needs-you
 * choices answer the job (POST /v1/code/jobs/:id/answer) or the task, the ask bar sends to the front door (POST /v1/ask).
 *
 * What the other screens read is the shell's own routes (routes/botsShell.ts, src/shell): one feed across Code bot jobs, answers
 * bots gave, payments, Keybot's words and connected-app tasks (/v1/shell/activity), search across projects, chats, notes, files
 * and bots (/v1/shell/search), who will answer without answering (/v1/shell/route), today's calendar and words (/v1/shell/today),
 * today's tasks (/v1/shell/tasks), and receipts. Money is always "you press pay": bots.approve opens the person's UPI app with the
 * payment the bot filled in (the UPI hand-off), and writes a receipt only when they say they paid.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../shared/types/sdui.js";
import {
  askBar, back, blip, body, botAvatar, botLook, botRoute, botTile, botTiles, botTileSpec, box, button, C, call, canMove, card, choiceRow, col,
  divider, duration, emptyState, FACE, grid, grow, icon, keptOffline, labelled, listCard, listRow, makeBotTile, makeTileSpec, meta, mono, needsCard, notice,
  open, page, primaryButton, quietButton,
  percent, RADIUS, roundButton, row, SCREENS, secondaryButton, sectionLabel, segmented, seq, shapes, statusMark, tailzuMark, text, title, toTab,
  when, whenEq, type BotsCtx, type LiveBot, type NeedsItem,
  canHead, headBar, liveMark, writeOn, canStrip, homeSurprises,
} from "../kit.js";
import type { Mark } from "../glyphs.js";
import { dayPart } from "../../touches.js";
import { dayLineAfterGreeting } from "../../settingsWords.js";
import { screen, type BotsScreen } from "../registry.js";
import { askMoment, failed, SENT_WORDS, start as momentStart, streamed } from "../askMoment.js";
import { canRecord, canUpload, listenAction, listening, micBlockedNotice, notListening, uploadChip, uploadPick, voiceBars, writingDown } from "../media.js";
import { ARRIVAL_PATH, ARRIVAL_STATE, arrivalCard } from "./firstRun.js";
import { ASSISTANT_NAME, nicknameOf } from "../../assistantName.js";
import { DELETION_PATH, leavingCard, type DeletionState } from "./accountGrace.js";
import { offlineKept, outboxCard, outboxSection } from "./outbox.js";
import { hasNotes, notesStrip, notesStripHeight, notesTileSpec, NOTES_STATS_PATH } from "./notes.js";
import type { NotesStats } from "../../../notes/stats.js";
import { hasOutbox } from "../kit.js";
import type { PageOpts } from "../kit.js";
import { PUSH_ASK_PATH, PUSH_STATE, pushAskCard, pushAskDue, withPushCheck } from "./pushAsk.js";
import { clockOf, dayLabel, longDate, type FeedRow } from "../../../shell/feed.js";
import { addAction, itemAction } from "./planItem.js";
import { upiOf } from "../../../shell/parse.js";
import { qrOf, qrPath } from "../../../shell/qr.js";
import type { SearchHit, SearchKind, SearchResult } from "../../../shell/search.js";

// ===================================================================== shared

/** A bot's idle line on its tile. */
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

/** A bot's name, from the live list (or the built-in words, or "Tailzu"). */
function nameOf(ctx: BotsCtx, slug: string): string {
  const b = ctx.live.bots.find((x) => x.slug === slug);
  if (b) return b.name;
  return ({ tailzu: "X0", code: "Code bot", keybot: "Keybot", plan: "Plan bot", travel: "Travel bot", you: "You" } as Record<string, string>)[slug] ?? slug;
}

/** A bot's head (or its colour and icon), at a size. */
function avatarOf(ctx: BotsCtx, slug: string, size = 30): Node {
  const b = ctx.live.bots.find((x) => x.slug === slug);
  return botAvatar(b ?? botLook(slug), size);
}

function colorOf(ctx: BotsCtx, slug: string): string {
  return ctx.live.bots.find((x) => x.slug === slug)?.color ?? botLook(slug).color;
}

const firstName = (ctx: BotsCtx): string => (ctx.user?.name ?? "").trim().split(/\s+/)[0] ?? "";

/** A row's status mark, a working one in its bot's colour. */
function markOf(ctx: BotsCtx, mark: Mark, bot: string, size = 8): Node {
  return statusMark(mark, { size, ...(mark === "working" ? { color: colorOf(ctx, bot) } : {}) });
}

/** A key cap ("Fn", "Esc", "↵"), as the window's boards draw one. */
function kbd(label: string): Node {
  return row([text(label, { size: 12, weight: 500, lineHeight: 16 })], {
    height: 26, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1, borderColor: C.outline, backgroundColor: C.paper, justifyContent: "center", flexShrink: 0,
  });
}

/** A step number in a grey circle (How a bot works, Pay on your phone). */
function stepDot(n: number): Node {
  return box([text(String(n), { size: 12, weight: 600, lineHeight: 15, align: "center" })], {
    width: 22, height: 22, borderRadius: 11, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

/** The page's grey error line, with the way to try again. */
function couldNot(what: string): Node {
  return row([
    icon("close", { size: 16, color: C.meta }),
    text(`Couldn't load ${what}.`, { size: 13, color: C.grey70, lineHeight: 18, style: { flexShrink: 1 } }),
    grow(),
    quietButton("Try again", { kind: "refresh" }, { size: "md" }),
  ], { gap: 8, paddingVertical: 4, paddingLeft: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line });
}

/** A text field in the kit's way (the ask bar's look, without its sending). */
function field(path: string, placeholder: string, o: { size?: number; weight?: 400 | 500; onSubmit?: ActionRef; multiline?: boolean; returnKey?: string } = {}): Node {
  const size = o.size ?? 16;
  return {
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: 44, color: C.ink, returnKeyType: o.returnKey ?? (o.onSubmit ? "search" : "default"), ...(o.multiline ? { multiline: true, minHeightMultiline: 64 } : {}),
    },
    ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: o.weight === 500 ? FACE.medium : FACE.regular,
      fontSize: size, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}

/** A filter chip with a bot's dot, selected by state (the window's Activity). */
function dotChip(labelText: string, path: string, value: string, dot?: string): Node {
  return row([
    ...(dot ? [box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: dot })] : []),
    text(labelText, { size: 13, lineHeight: 17, style: { color: whenEq(path, value, C.paper, C.ink) } }),
  ], {
    gap: 7, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq(path, value, C.ink, C.line), backgroundColor: whenEq(path, value, C.ink, C.paper),
  }, { kind: "setState", path, value });
}

const toast = (message: string, tone?: "error"): ActionSpec => ({ kind: "toast", message, ...(tone ? { tone } : {}) });

// ===================================================================== home

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

/**
 * The tiles: the three bots that matter most right now (needs you, working, then the built-ins), and Make a bot.
 * Living (a tiny Blip in each, playing; BotTiles) where the build draws them, else today's static tiles. Under them,
 * Notes as a full-width strip (screens/notes.ts): in the living grid's own world where the build draws one (canStrip),
 * else a still strip of its own.
 */
function tiles(ctx: BotsCtx, columns: number, height: number, padding: number, notes?: NotesStats): Node {
  const shown = ctx.live.bots.slice(0, 3);
  const gap = columns === 4 ? 14 : 12;
  const withNotes = hasNotes(ctx);
  if (canMove(ctx)) {
    const strip = withNotes && canStrip(ctx) ? notesTileSpec(ctx, notes) : undefined;
    // Now and then an idle bot does something of his own (a sneeze, a hiccup…): the catalog's, for a build that plays them.
    const surprises = homeSurprises(ctx);
    const living = botTiles([
      ...shown.map((b) => botTileSpec(b, { idle: idleLine(b, ctx.client), onPress: botRoute(b.slug) })),
      makeTileSpec(open(SCREENS.make)),
    ], { columns, height, padding, gap, ...(strip ? { strip, stripHeight: notesStripHeight(ctx) } : {}), ...(surprises ? { surprises } : {}) });
    return withNotes && !strip ? col([living, notesStrip(ctx, notes)], { gap }) : living;
  }
  const still = grid([
    ...shown.map((b) => botTile(b, { idle: idleLine(b, ctx.client), onPress: botRoute(b.slug), height, padding })),
    makeBotTile({ onPress: open(SCREENS.make), height, padding }),
  ], columns, gap);
  return withNotes ? col([still, notesStrip(ctx, notes)], { gap }) : still;
}

/** What Home's state starts with: the first-arrival card's, when it is due. */
const homeState = (arrival: boolean): Record<string, unknown> => (arrival ? { ...ARRIVAL_STATE } : {});

/** What Home's load reads beside the live state: the account's deletion date (accountGrace.ts), whether the notifications ask is due (pushAsk.ts). */
interface HomeMore { leaving?: DeletionState | undefined; push?: boolean; notes?: NotesStats | undefined; botName?: string | undefined; back?: boolean }

/**
 * Home's notices, one ask at a time: while the account has a deletion date, that card at the top and nothing else asks; else the
 * first-arrival card when due; else, on a phone, the notifications ask once something is working or needs them (its header reads
 * the phone's answer). `state` is what the page starts with.
 */
function homeNotices(ctx: BotsCtx, arrival: boolean, more: HomeMore) {
  const leaving = leavingCard(ctx, more.leaving);
  const firstRun = arrival && !leaving.length;
  const push = !leaving.length && !firstRun && pushAskDue(ctx, more.push === true);
  return {
    state: { ...homeState(firstRun), ...(push ? PUSH_STATE : {}) },
    head: (n: Node): Node => (push ? withPushCheck(ctx, n) : n),
    leaving, arrival: firstRun, push: push ? pushAskCard(ctx, true) : [],
  };
}

/**
 * Home's header: the Tailzu mark and the quiet buttons, then the greeting, small ("Good evening, Aanya"), and the old
 * app's time-aware line under it, big and bold ("Anything to write up before the day ends?"; its own "Good evening."
 * dropped, the night's line whole; Hinglish through i18n's Home seeds), with room around them: on the phone it owns
 * about the top third of the first screen. Where the build draws it alive (canHead): the line writes itself in with
 * Keybot's caret, once per app open and part of the day; the mark lives (its eyes on the finger, a dot lit in each
 * working bot's colour; a tap opens Ask); and once the header has scrolled away, a compact bar (the mark, "Your bots")
 * takes the top, until the page is back at its top (`pinned`). Else the same header, still.
 */
function homeHead(ctx: BotsCtx): { head: Node; pinned: Node[] } {
  const desk = ctx.client === "desktop";
  const name = firstName(ctx);
  const greet = name ? `${ctx.live.greeting}, ${name}` : ctx.live.greeting;
  const part = dayPart(ctx.tzOffsetMinutes, ctx.live.now);
  const line = dayLineAfterGreeting(part).en;
  const alive = canHead(ctx);
  const size = desk ? 40 : 30, lineHeight = desk ? 46 : 35, tracking = desk ? -1.2 : -0.9;
  const bold = alive ? writeOn(line, { size, lineHeight, tracking, once: `home.${part}` }) : text(line, { size, weight: 700, tracking, lineHeight });
  const markSize = desk ? 56 : 44;
  // The mark only answers a touch (it squishes, its eyes follow the finger): it opens nothing.
  const mark = alive ? liveMark(markSize, ctx.live.bots.filter((b) => b.working).map((b) => b.color)) : tailzuMark(markSize);
  const quiet = (glyph: "search" | "person", onPress: ActionRef, label: string) => roundButton(glyph, onPress, { size: desk ? 38 : 36, light: true, label });
  const head = col([
    row([mark, grow(), quiet("search", open(SCREENS.search), "Search everything"), ...(desk ? [] : [quiet("person", toTab("you"), "Profile and settings")])], { gap: 6, alignItems: "flex-start" }),
    col([text(greet, { size: desk ? 16 : 15, color: C.meta, lineHeight: desk ? 21 : 20 }), bold], { gap: desk ? 12 : 10, ...(desk ? { maxWidth: 680 } : {}) }),
  ], { gap: desk ? 30 : 34, paddingTop: desk ? 4 : 10, paddingBottom: desk ? 10 : 14 });
  const bar = headBar([row([tailzuMark(desk ? 24 : 26), text("Your bots", { size: desk ? 16 : 17, weight: 600, lineHeight: 22 })], {
    gap: 10, height: desk ? 56 : 52, paddingHorizontal: desk ? 48 : 20,
  })], desk ? 170 : 150);
  return { head, pinned: alive ? [bar] : [] };
}

/** Pull-a-bot on Home, at both ends: what is new there is a decision, something set working, or a bot. */
function homePull(ctx: BotsCtx): PageOpts["pullBot"] {
  return { top: true, bottom: true, items: [...ctx.live.needs.map((n) => n.id), ...ctx.live.working.map((w) => w.id), ...ctx.live.bots.map((b) => `bot:${b.slug}`)] };
}

function homePhone(ctx: BotsCtx, arrival = false, more: HomeMore = {}) {
  const first = ctx.live.needs[0];
  const { head, pinned } = homeHead(ctx);
  const n = homeNotices(ctx, arrival, more);
  const home: Node[] = [
    n.head(head),
    ...n.leaving,
    weekRow(ctx),
    ...(hasOutbox(ctx) ? outboxCard(ctx) : []),
    ...(first ? [needsCard(first)] : []),
    ...n.push,
    tiles(ctx, 2, 132, 16, more.notes),
  ];
  const footer = [askBar("phone", { ctx })];
  // HOME'S WELCOME, where the build plays it (the first visit after onboarding; a visit after a long time away or the first on
  // a newer Home): only the bot waving with his line, for a few seconds. Then he turns and walks off the side, and the card
  // for whatever is missing (the microphone, the keyboard) comes in over him as he goes; with nothing missing it closes by
  // itself unseen. Once he is gone and the card is done (or put off), Home comes in, piece by piece, as on any day.
  const intro = n.arrival && canMove(ctx);
  // Home comes in as soon as he is gone. A card still due sits over it (the card is an overlay, over a veil), so Home never
  // waits on the card deciding: on an iPhone whose keyboard has not reported Full Access yet, it might never decide.
  const gone: Condition = { truthy: "helloGone" };
  const arrive = (x: Node, i: number): Node => (intro ? { type: "Rise", props: { delayMs: i * 70, fromY: 36, scaleFrom: 0.98 }, visibleIf: gone, children: [x] } : x);
  return page(ctx, {
    tab: "bots", title: "Your bots", state: { ...n.state, ...(intro ? { helloSeen: false, helloGone: false } : {}) },
    pinned: intro ? pinned.map((x) => when(gone, x)) : pinned,
    ...(hasNotes(ctx) ? { live: ["notes"] } : {}), pullBot: homePull(ctx),
    body: intro
      ? [
        {
          ...col([hello(ctx, more, { walkOut: true })], { paddingTop: 150 }), visibleIf: { falsy: "helloGone" },
          // The whole welcome in one run: he waves (helloSeen at HELLO_MS), walks off, and is gone (helloGone WALK_MS later),
          // so Home comes in. One chain, written to one Store: it used to be two (the second fired when helloSeen made a
          // hidden node appear), and when the app swapped in a fresh copy of Home between the two, the second never ran
          // and Home never came.
          on: { onAppear: seq({ kind: "delay", ms: HELLO_MS }, { kind: "setState", path: "helloSeen", value: true }, { kind: "delay", ms: WALK_MS }, { kind: "setState", path: "helloGone", value: true }) },
        },
        ...arrivalCard(ctx, { after: "helloSeen" }),
        ...home.map(arrive),
      ]
      // A build without it: the card over Home, and the bot saying hello.
      : [...(n.arrival ? [...arrivalCard(ctx), hello(ctx, more)] : []), ...home],
    footer: footer.map((x, i) => arrive(x, home.length + i)),
  });
}

/** How long the bot waves on his own before he walks off and the welcome's card comes in, and how long his walk off takes. */
const HELLO_MS = 3500;
const WALK_MS = 1500;
/** The component a build declares when it draws Blip turning and walking off (TAILZU-FRONTEND onboard/BlipWalkOut.tsx). */
const WALK_OUT = "BlipWalkOut";

function homeDesk(ctx: BotsCtx, arrival = false, more: HomeMore = {}) {
  const first = ctx.live.needs[0];
  const { head, pinned } = homeHead(ctx);
  const n = homeNotices(ctx, arrival, more);
  return page(ctx, {
    tab: "bots", title: "Your bots", state: n.state, pinned, ...(hasNotes(ctx) ? { live: ["notes"] } : {}),
    body: [
      head,
      ...n.leaving,
      weekRow(ctx),
      ...(hasOutbox(ctx) ? outboxCard(ctx) : []),
      // The first time here: one card for this computer's microphone and Accessibility, over Home, and the bot saying hello.
      ...(n.arrival ? [...arrivalCard(ctx), hello(ctx, more)] : []),
      ...(first ? [needsCard(first, { layout: "row" })] : []),
      tiles(ctx, 4, 150, 18, more.notes),
    ],
    footer: [askBar("desktop", { ctx })],
  });
}

/**
 * The bot waving hello by the name they gave it (else X0's), while Home's welcome is due: the first visit after onboarding,
 * or (`more.back`) a visit after a long time away or the first on a newer Home. `walkOut`: on the phone's welcome stage, once
 * he has waved (helloSeen) he turns and walks off the side (BlipWalkOut; a build without it slides him off, MorphOut), and
 * his words go as he turns. A card that is due comes in at the same moment, over him walking off.
 */
function hello(ctx: BotsCtx, more: HomeMore, o: { walkOut?: boolean } = {}): Node {
  const name = firstName(ctx), me = more.botName || ASSISTANT_NAME;
  const hi = more.back ? (name ? `Welcome back, ${name}` : "Welcome back") : name ? `Hi ${name}, I'm ${me}` : `Hi, I'm ${me}`;
  const line = more.back ? `${me} and your bots missed you.` : "Every bot here is me, ready for one job. Your first one is already on.";
  if (ctx.client === "desktop") {
    return row([blip("hello", 140), col([text(hi, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), text(line, { size: 15, color: C.grey70, lineHeight: 21 })], { gap: 6, flexShrink: 1 })], { gap: 24 });
  }
  const bot = blip("hello", 132);
  // The full width of the stage, centred in it: measured to its own ink, tight type loses its last letters on an iPhone.
  const wide = { alignSelf: "stretch" as const, paddingHorizontal: 24 };
  const words = [text(hi, { size: 25, weight: 700, tracking: -0.5, lineHeight: 31, align: "center", style: wide }), text(line, { size: 14, color: C.grey70, lineHeight: 20, align: "center", style: wide })];
  if (!o.walkOut) return col([bot, ...words], { gap: 6, alignItems: "center" });
  const walking: Node = ctx.can.has(WALK_OUT)
    ? { type: WALK_OUT, props: { h: 120, goWhen: "helloSeen", walkMs: WALK_MS - 100, label: "Blip" } }
    : {
      type: "MorphOut", bind: { active: "helloSeen" }, style: { width: bot.style?.width, height: bot.style?.height },
      // Off to the side at full size: no gather, no shrink, picking up speed, gone by the end.
      props: { dx: 4, durationMs: WALK_MS, windup: 0.04, collapseIn: [0, 1], collapseOut: [1, 1], toScale: 1, fadeAt: 0.85 },
      children: [bot],
    };
  return col([walking, ...words.map((w) => when({ falsy: "helloSeen" }, w))], { gap: 6, alignItems: "center", alignSelf: "stretch" });
}

// ===================================================================== the empty home

const IDEAS = [
  { label: "Plan my week", body: "Every Sunday at 8 pm it lays out your week from your calendar. You say yes to each block.", uses: "Uses Calendar", icon: "calendar" as const },
  { label: "Track my gym days", body: "Counts your sessions, keeps your streak, and goes easy when you say you're sore.", uses: "Uses Reminders", icon: "dumbbell" as const },
  { label: "Rent yaad dilana, 1st ko", body: "On the 1st it reminds you and opens UPI with the rent filled in. You press pay.", uses: "Uses Reminders, UPI", icon: "rupee" as const },
];

/**
 * The first day (EmptyHome, DEmptyHome): Home's own living header on top (homeHead: the greeting and the bold time-aware line, the
 * living mark, the compact bar once scrolled), then Blip saying hello, Keybot already on, and making the first bot.
 */
function emptyHome(ctx: BotsCtx, arrival = false, more: HomeMore = {}) {
  const { head, pinned } = homeHead(ctx);
  const n = homeNotices(ctx, arrival, more);
  const keybot = ctx.live.bots.find((b) => b.slug === "keybot") ?? botLook("keybot");
  const make = (idea?: string) => open(SCREENS.make, idea ? { idea } : undefined);
  const fnKey = (w: number, h: number, size: number) => box([text("Fn", { size, weight: 500, color: botLook("keybot").color, lineHeight: size + 4, align: "center" })], {
    width: w, height: h, borderRadius: 10, borderWidth: 1.5, borderColor: botLook("keybot").color, backgroundColor: C.paper, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });

  if (ctx.client === "desktop") {
    return page(ctx, {
      tab: "bots", title: "Your bots", gap: 20, maxWidth: 1100, pinned,
      state: { draft: "", ...n.state },
      body: [
        head,
        ...n.leaving,
        ...(n.arrival ? arrivalCard(ctx) : []),
        row([
          col([
            hello(ctx, more),
            card([
              col([text("Make your first bot", { size: 18, weight: 600, lineHeight: 23 }), meta("Say what it should do. It shows you the plan before it acts.", { size: 14, lineHeight: 19 })], { gap: 3 }),
              row([
                field("draft", "A bot that…", { size: 16, onSubmit: seq({ kind: "condition", if: { falsy: "draft" }, then: toast("Say what it should do first"), else: open(SCREENS.make, { say: "$state.draft" }) }) }),
                roundButton("mic", { kind: "dictate" }, { size: 48, label: "Speak instead" }),
              ], { gap: 14, borderWidth: 1.5, borderColor: C.ink, borderRadius: 18, paddingVertical: 10, paddingRight: 12, paddingLeft: 18 }),
              row([meta("Hindi, English or both · hold", { size: 12 }), kbd("Fn"), meta("anywhere to speak", { size: 12 })], { gap: 6 }),
            ], { padding: 20, gap: 14, radius: 18 }),
            col([
              sectionLabel("Or start from an idea"),
              grid(IDEAS.map((i) => col([
                row([box([icon(i.icon, { size: 18, color: C.ink })], { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }), grow(), icon("chevron", { size: 16, color: C.meta })]),
                text(i.label, { size: 15, weight: 600, lineHeight: 20 }),
                text(i.body, { size: 13, color: C.grey70, lineHeight: 18 }),
                meta(i.uses, { size: 12 }),
              ], { gap: 8, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, make(i.label))), 3, 14),
            ], { gap: 10 }),
          ], { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 20 }),
          col([
            card([
              row([botAvatar(keybot, 36), col([text("Keybot is on", { size: 15, weight: 600, lineHeight: 20 }), meta("Your first bot · free")], { gap: 2 })], { gap: 12 }),
              col([fnKey(64, 56, 17), text("Hold Fn to speak, in any app", { size: 14, weight: 500, lineHeight: 19, align: "center" })], {
                gap: 10, padding: 18, borderRadius: 14, backgroundColor: C.surface, alignItems: "center",
              }),
              text("Try it in Gmail or WhatsApp: hold Fn, say “Kal 10 baje call karte hain”, let go.", { size: 13, color: C.grey70, lineHeight: 18 }),
            ], { padding: 18, gap: 14, radius: 18, onPress: botRoute("keybot") }),
            card([
              sectionLabel("How a bot works"),
              ...[["You say what it should do", "Type it, or hold Fn and speak"], ["It shows you the plan first", "Nothing happens before you see it"], ["You say go", "Money is always: you press pay"]]
                .map(([a, b], i) => row([stepDot(i + 1), col([text(a!, { size: 14, weight: 500, lineHeight: 19 }), meta(b!)], { gap: 1, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" })),
            ], { padding: 18, gap: 14, radius: 18 }),
          ], { width: 292, flexShrink: 0, gap: 18 }),
        ], { gap: 28, alignItems: "flex-start" }),
      ],
    });
  }

  return page(ctx, {
    tab: "bots", title: "Your bots", gap: 16, state: n.state, pinned, pullBot: homePull(ctx),
    body: [
      head,
      ...n.leaving,
      ...(n.arrival ? arrivalCard(ctx) : []),
      hello(ctx, more),
      // The bots they already have (Keybot, Code, Plan, Travel), as Home shows them once they've started.
      tiles(ctx, 2, 132, 16, more.notes),
      col([
        row([
          col([text("Make your first bot", { size: 20, weight: 700, tracking: -0.3, lineHeight: 25 }), text("Say what it should do. It shows you the plan before it acts.", { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 4, flexGrow: 1, flexShrink: 1 }),
          box([icon("plus", { size: 24, color: C.paper })], { width: 52, height: 52, borderRadius: 26, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }),
        ], { gap: 14 }, make()),
        col([
          sectionLabel("Or start from an idea"),
          row(IDEAS.map((i) => row([text(i.label, { size: 13, lineHeight: 17 })], {
            paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline,
          }, make(i.label))), { gap: 8, flexWrap: "wrap" }),
        ], { gap: 8 }),
      ], { padding: 18, gap: 14, borderRadius: 22, borderWidth: 1, borderColor: C.line }),
    ],
  });
}

// ===================================================================== activity

interface ActivityData { now: number; week: { done: number; paise: number; minutesSaved: number }; rows: FeedRow[] }

const KIND_OF: Record<FeedRow["type"], "jobs" | "payments" | "words"> = { job: "jobs", task: "jobs", ask: "jobs", payment: "payments", words: "words" };

/** A feed row's place: the screen it opens, as an action. */
const openRow = (r: FeedRow): ActionSpec | undefined => (r.open ? open(r.open.screenId, r.open.params) : undefined);

/** Where a decision opens: a job's page, or the approval. */
function openNeed(n: NeedsItem): ActionSpec {
  const [kind, id] = n.id.split(":");
  return kind === "job" ? open(SCREENS.codeJob, { id }) : open(SCREENS.approve, { task: id });
}

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

/** The progress of a running job: its stages as short bars, done in ink, the current one in its colour. */
function stageBars(at: number, of: number, color: string, o: { w?: number; h?: number; grow?: boolean } = {}): Node {
  return row(Array.from({ length: of }, (_, i) => box([], {
    ...(o.grow ? { flexGrow: 1, flexBasis: 0 } : { width: o.w ?? 14 }), height: o.h ?? 4, borderRadius: 3,
    backgroundColor: i < at ? C.ink : i === at ? color : C.track,
  })), { gap: o.grow ? 4 : 3, ...(o.grow ? { alignSelf: "stretch" } : {}) });
}

function activityLoad(ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }) {
  return deps.api<ActivityData>("GET", `/v1/shell/activity?tz=${ctx.tzOffsetMinutes}`);
}

function activityPhone(ctx: BotsCtx, data: ActivityData | undefined) {
  const live = ctx.live;
  const rows = data?.rows ?? [];
  const working = rows.filter((r) => r.mark === "working");
  const rest = rows.filter((r) => r.mark !== "working" && r.mark !== "needs");
  const show = (vals: string[]): Condition => ({ in: ["show", vals] });
  const nowBlocks: Node[] = [
    ...working.slice(0, 2).map((r) => when(show(["all", "working"]), col([
      row([
        avatarOf(ctx, r.bot, 30),
        text(r.title, { size: 14, weight: 600, lineHeight: 19, lines: 1, style: { flexShrink: 1, flexGrow: 1 } }),
        text(r.stage ? `${r.stage.at} of ${r.stage.of} done` : "Working", { size: 12, weight: 500, color: colorOf(ctx, r.bot), lineHeight: 16, style: { flexShrink: 0 } }),
      ], { gap: 10 }),
      ...(r.stage ? [stageBars(r.stage.at, r.stage.of, colorOf(ctx, r.bot), { grow: true, h: 5 })] : [meta(r.sub ?? "", { lines: 1 })]),
    ], { gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }, openRow(r)))),
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
    state: { show: "all" },
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
        ...d.rows.map((r) => row([
          avatarOf(ctx, r.bot, 30),
          col([
            text(r.title, { size: 14, lineHeight: 19, lines: 2 }),
            meta(r.sub ?? "", { lines: 1 }),
          ], { gap: 2, flexGrow: 1, flexShrink: 1 }),
          ...(r.mark === "failed" ? [statusMark("failed")] : []),
        ], { gap: 12, alignItems: "flex-start" }, openRow(r))),
      ], { gap: 14 }))),
      ...(empty && data ? [emptyState({ pose: "hello", title: "Nothing here yet", body: "What your bots do shows up here.", action: { label: "Ask a bot", onPress: open(SCREENS.ask) } })] : []),
    ],
  });
}

function activityDesk(ctx: BotsCtx, data: ActivityData | undefined) {
  const live = ctx.live;
  const rows = data?.rows ?? [];
  const tz = ctx.tzOffsetMinutes;
  const week = data?.week;
  const weekWords = week ? [
    "This week", `${week.done} ${week.done === 1 ? "job" : "jobs"} done`,
    ...(week.minutesSaved > 0 ? [`${duration(week.minutesSaved)} saved`] : []),
  ].join(" · ") : "";
  const COLS = { mark: 12, time: 64, bot: 128, proof: 74 };
  const rowCond = (r: FeedRow): Condition => ({ all: [{ in: ["fbot", ["all", r.bot]] }, { in: ["ftype", ["all", KIND_OF[r.type]]] }] });
  const cell = (n: Node, w?: number): Node => box([n], w ? { width: w, flexShrink: 0 } : { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 });
  const head = row([
    cell(box([]), COLS.mark), cell(sectionLabel("Time"), COLS.time), cell(sectionLabel("Bot"), COLS.bot), cell(sectionLabel("What happened")),
    cell(sectionLabel("Proof"), COLS.proof),
  ], { gap: 14, paddingVertical: 10, paddingHorizontal: 16 });
  const line = (r: FeedRow): Node => when(rowCond(r), row([
    cell(markOf(ctx, r.mark, r.bot), COLS.mark),
    cell(text(clockOf(r.at, tz), { size: 12.5, color: C.meta, lineHeight: 17 }), COLS.time),
    cell(row([avatarOf(ctx, r.bot, 26), text(nameOf(ctx, r.bot), { size: 13, weight: 500, lineHeight: 17, lines: 1, style: { flexShrink: 1 } })], { gap: 8 }), COLS.bot),
    cell(col([text(r.title, { size: 14, lineHeight: 19, lines: 2 }), ...(r.sub ? [meta(r.sub, { lines: 1 })] : [])], { gap: 2 })),
    cell(r.open ? row([text("Receipt", { size: 13, weight: 500, lineHeight: 17 }), icon("chevron", { size: 14 })], { gap: 2, minHeight: 32 }, openRow(r)) : box([]), COLS.proof),
  ], { gap: 14, paddingVertical: 10, paddingHorizontal: 16 }));
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
    state: { fbot: "all", ftype: "all" },
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

// ===================================================================== ask

/** POST /v1/shell/route's answer: who will answer, and what they do first. */
interface Route { slug: string; name: string; color: string; say: string; hint: string; by: string }

/** What a built-in is asked most, as "Or try" (built-ins only: a person's own bot is theirs to word). */
const TRIES: Array<{ bot: string; text: string }> = [
  { bot: "plan", text: "What's on tomorrow?" },
  { bot: "code", text: "What changed in my project this week?" },
  { bot: "keybot", text: "Reply to Sam: running 10 minutes late" },
  { bot: "travel", text: "A weekend in Lisbon next month?" },
];
/** The same, for someone in India (by time zone, as the pay page tells the markets apart): their languages, their trips. */
const TRIES_IN: Array<{ bot: string; text: string }> = [
  { bot: "plan", text: "What's on tomorrow?" },
  { bot: "code", text: "What changed in my project this week?" },
  { bot: "keybot", text: "Mummy ko Hindi mein reply likho" },
  { bot: "travel", text: "A weekend in Goa next month?" },
];
const inIndia = (ctx: BotsCtx): boolean => ctx.tzOffsetMinutes === 330;
/** Under Ask's box: that any language works, and for India that Hinglish does. */
const speakLine = (ctx: BotsCtx, listening = false): string =>
  `${listening ? "Listening" : "Speak or type"} · ${inIndia(ctx) ? "Hinglish works" : "any language works"}`;

const routeFor = (ctx: BotsCtx, slug: string): Route => {
  const name = nameOf(ctx, slug);
  const first: Record<string, string> = {
    travel: "Travel bot shows the plan before it books", plan: "Plan bot asks before it changes your calendar",
    code: "Code bot shows the plan before it changes code", keybot: "Keybot writes it, you send it", tailzu: "X0 answers, or hands it to the right bot",
  };
  return { slug, name, color: colorOf(ctx, slug), say: `${name} will take this`, hint: `Tap to send · ${first[slug] ?? `${name} asks before it does anything`}`, by: "chosen" };
};

/** The bots the person can hand a message to: Tailzu, then theirs (the built-ins first). */
function candidates(ctx: BotsCtx): string[] {
  const order = ["code", "keybot", "plan", "travel"];
  const mine = ctx.live.bots.slice().sort((a, b) => (order.indexOf(a.slug) + 1 || 9) - (order.indexOf(b.slug) + 1 || 9)).map((b) => b.slug);
  return ["tailzu", ...mine].slice(0, 7);
}

/** Send what is in `ask` to the bot in `route` (or let the front door pick), then open the answer. */
function sendAsk(ctx: BotsCtx): ActionRef {
  // The words go up as the person's bubble and the box clears at once (askMoment.ts); the answer is written in as it comes.
  const ask = (bot: string): ActionSpec => streamed(ctx, {
    kind: "callEndpoint", method: "POST", path: "/v1/shell/ask",
    body: { message: SENT_WORDS, bot, device: ctx.client, mode: "text", ...(ctx.params.file || canUpload(ctx) ? { attachments: "$state.attach" } : {}) },
    assignTo: "asked",
    onSuccess: seq(
      { kind: "setState", path: "asking", value: false },
      {
        kind: "navigate", screenId: SCREENS.ask, replace: true,
        params: { message: SENT_WORDS, answer: "$state.asked.shell.text", bot: "$state.asked.shell.bot.slug", upi: "$state.asked.shell.upi", needs: "$state.asked.shell.needs", job: "$state.asked.shell.job" },
      },
    ),
    onError: failed({ busy: "asking", from: "ask", then: toast("Couldn't reach your bots. Try again.", "error") }),
  });
  return seq(
    ...momentStart({ message: "$state.ask", from: "ask", busy: "asking" }),
    { kind: "condition", if: { truthy: "route.slug" }, then: ask("$state.route.slug"), else: ask("any") },
  );
}

/** Ask who will answer, without answering (decide only). */
const checkWho: ActionSpec = {
  kind: "callEndpoint", method: "POST", path: "/v1/shell/route", body: { message: "$state.ask" }, assignTo: "route",
  onError: seq({ kind: "setState", path: "route", value: { slug: "any", name: "X0 Bot", say: "X0 Bot picks who answers", hint: "Tap to send" } }, toast("Couldn't check who answers. Tap to send anyway.")),
};

/**
 * The big button: nothing said yet, a word; said but not routed, who will answer; routed, send. Offline (a build with an outbox), the ask
 * is kept there for the bot picked, or any, and goes once the connection is back (kit keptOffline). The "Check" chip (`keep: false`)
 * only ever asks who answers.
 */
function goAction(ctx: BotsCtx, o: { keep?: boolean } = {}): ActionRef {
  const keep = o.keep !== false;
  return {
    kind: "condition", if: { falsy: "ask" }, then: toast("Say or type what you need first"),
    else: {
      kind: "condition", if: { truthy: "route.slug" },
      then: keep ? keptOffline(ctx.client, { message: "$state.ask", bot: "$state.route.slug", who: "$state.route.name", clear: "ask" }, sendAsk(ctx)) : sendAsk(ctx),
      else: keep ? keptOffline(ctx.client, { message: "$state.ask", clear: "ask" }, checkWho) : checkWho,
    },
  };
}

const choose = (ctx: BotsCtx, slug: string): ActionSpec => ({ kind: "setState", path: "route", value: routeFor(ctx, slug) });

/** The "who will answer" chip: one per bot, shown when it is the one; before anyone is picked, Tailzu's. */
function whoChip(ctx: BotsCtx): Node {
  const big = ctx.client === "desktop";
  const chipOf = (slug: string, o: { pre?: boolean } = {}) => row([
    avatarOf(ctx, slug, big ? 32 : 30),
    text(o.pre ? "X0 Bot" : nameOf(ctx, slug), { size: 14, weight: 600, lineHeight: 18 }),
    text(o.pre ? "picks who answers" : "will take this", { size: 14, color: C.meta, lineHeight: 18 }),
    box([], { width: 1, height: 18, backgroundColor: C.line }),
    text(o.pre ? "Check" : "Change", { size: 14, weight: 500, lineHeight: 18 }),
  ], {
    gap: big ? 10 : 8, height: big ? 46 : 44, paddingLeft: 6, paddingRight: 14, borderRadius: 23, alignSelf: "flex-start",
    borderWidth: o.pre ? 1 : 1.5, borderColor: o.pre ? C.line : colorOf(ctx, slug), backgroundColor: C.paper,
  }, o.pre ? goAction(ctx, { keep: false }) : { kind: "toggleState", path: "picking" });
  return col([
    when({ falsy: "route.slug" }, chipOf("tailzu", { pre: true })),
    ...candidates(ctx).map((s) => when({ eq: ["route.slug", s] }, labelled(chipOf(s), `${nameOf(ctx, s)} will take this. Change who answers`))),
    when({ eq: ["route.slug", "any"] }, chipOf("tailzu", { pre: true })),
  ], { gap: 0 });
}

/** "Or hand it to": a head per bot. */
function handTo(ctx: BotsCtx): Node {
  return row([
    meta("Or hand it to", { size: 12 }),
    ...candidates(ctx).map((s) => labelled(box([avatarOf(ctx, s, 30)], {
      width: ctx.client === "desktop" ? 40 : 44, height: ctx.client === "desktop" ? 40 : 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
      ...(ctx.client === "desktop" ? { borderWidth: 1, borderColor: C.line } : {}),
    }, choose(ctx, s)), nameOf(ctx, s))),
  ], { gap: ctx.client === "desktop" ? 6 : 2, flexWrap: "wrap" });
}

/** Every bot as a list to pick from (after Change). */
function pickList(ctx: BotsCtx): Node {
  return when({ truthy: "picking" }, listCard(candidates(ctx).map((s) => listRow({
    label: nameOf(ctx, s), sub: s === "tailzu" ? "Answers, or hands it to the right bot" : idleLine(ctx.live.bots.find((b) => b.slug === s) ?? ({ slug: s, purpose: "" } as LiveBot), ctx.client),
    left: avatarOf(ctx, s, 30), onPress: seq(choose(ctx, s), { kind: "setState", path: "picking", value: false }),
  }))));
}

function tries(ctx: BotsCtx): Node[] {
  const have = new Set(ctx.live.bots.map((b) => b.slug));
  return (inIndia(ctx) ? TRIES_IN : TRIES).filter((t) => have.has(t.bot)).map((t) => row([
    avatarOf(ctx, t.bot, 26),
    text(t.text, { size: 14, lineHeight: 19, lines: 1, style: { flexGrow: 1, flexShrink: 1 } }),
    meta(nameOf(ctx, t.bot), { size: 12, style: { flexShrink: 0 } }),
  ], { gap: 12, minHeight: 44, paddingHorizontal: ctx.client === "desktop" ? 10 : 0, borderRadius: 12 },
  seq({ kind: "setState", path: "ask", value: t.text }, choose(ctx, t.bot))));
}

/** The voice bars beside "Speak or type". */
function bars(heights: number[]): Node {
  return row(heights.map((h) => box([], { width: 3, height: h, borderRadius: 2, backgroundColor: C.ink })), { gap: heights.length > 8 ? 3 : 2, height: Math.max(...heights), alignItems: "center" });
}

/** Attach: pick and send it here (a build that can, FileUpload), else the attach screen as before. */
function attachTo(ctx: BotsCtx, kind: "photo" | "file" | "screen"): ActionSpec {
  if (canUpload(ctx)) return uploadPick(kind === "screen" ? "screenshot" : kind, "attach");
  return open(SCREENS.attach, { kind, from: "ask", message: "$state.ask" });
}

function askCompose(ctx: BotsCtx, pre: Route | undefined) {
  const message = String(ctx.params.message ?? "");
  const fileName = ctx.params.fileName ? String(ctx.params.fileName) : "";
  const state = {
    ask: message, picking: false, route: pre ?? (ctx.params.bot ? routeFor(ctx, String(ctx.params.bot)) : null),
    ...(ctx.params.file && ctx.params.attachment ? { attach: [ctx.params.attachment] } : {}),
    // A file on its way and the file sent (media.ts uploadChip); the voice (the phone's mic).
    ...(canUpload(ctx) ? { up: null, sent: fileName && ctx.params.attachment ? { name: fileName, size: "" } : null } : {}),
    ...(canRecord(ctx) ? { voice: "idle", level: 0, micBlocked: false } : {}),
  };
  const hint = col([
    when({ falsy: "route.slug" }, meta("Tap once to see who answers, again to send", { size: 13, align: "center" })),
    when({ truthy: "route.slug" }, text("", { size: 13, color: C.meta, lineHeight: 17, align: "center", bind: "route.hint" })),
  ]);
  // The ask out: their words as a bubble, Tailzu carrying it (askMoment.ts).
  const asking = askMoment(ctx, { slug: "tailzu", color: C.ink, kind: "custom", busy: "asking", line: "Asking…", bubble: "surface" });
  const fileChip = canUpload(ctx) ? [uploadChip("attach")] : fileName ? [row([icon("clip", { size: 16 }), text(fileName, { size: 13, lineHeight: 17, lines: 1, style: { flexShrink: 1 } })], {
    gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.surface, alignSelf: "flex-start",
  })] : [];

  if (ctx.client === "desktop") {
    const attach = (labelText: string, name: "clip" | "folder" | "computer" | "keyboard", a: ActionRef) =>
      row([icon(name, { size: 16 }), text(labelText, { size: 13, lineHeight: 17 })], { gap: 7, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline }, a);
    return page(ctx, {
      back: true, nav: "bots", title: "Ask any bot", gap: 18, state,
      body: [
        col([
          row([
            labelled(roundButton("mic", { kind: "dictate" }, { size: 60 }), "Hold Fn and speak, or click to start"),
            col([
              row([bars([8, 14, 20, 11, 24, 16, 9, 18, 22, 12, 7, 15]), meta(speakLine(ctx), { size: 13 })], { gap: 10 }),
              field("ask", "Ask any bot…", { size: 21, weight: 500, onSubmit: goAction(ctx), returnKey: "send" }),
              ...fileChip,
            ], { gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
            labelled(box([kbd("Esc")], { height: 32, justifyContent: "center" }, back()), "Close"),
          ], { gap: 18, paddingTop: 22, paddingBottom: 20, paddingHorizontal: 22, alignItems: "flex-start" }),
          divider(),
          col([sectionLabel("Who will answer"), row([whoChip(ctx), handTo(ctx)], { gap: 14, flexWrap: "wrap" }), pickList(ctx)], { gap: 10, paddingVertical: 14, paddingHorizontal: 22 }),
          divider(),
          row([
            sectionLabel("Attach"), attach("Photo", "clip", attachTo(ctx, "photo")), attach("File", "folder", attachTo(ctx, "file")), attach("Screen", "computer", attachTo(ctx, "screen")),
            grow(), attach("Paste", "keyboard", { kind: "readClipboard", assignTo: "ask" }),
          ], { gap: 8, paddingVertical: 12, paddingHorizontal: 22 }),
          divider(),
          col([box([sectionLabel("Or try")], { paddingTop: 6, paddingBottom: 4, paddingHorizontal: 10 }), ...tries(ctx)], { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 12 }),
          row([
            row([kbd("↵"), meta("send", { size: 12 })], { gap: 6 }),
            row([kbd("Fn"), meta("hold to talk", { size: 12 })], { gap: 6 }),
            grow(),
            when({ truthy: "route.slug" }, text("", { size: 12, color: C.grey70, lineHeight: 16, bind: "route.hint" })),
          ], { gap: 16, paddingVertical: 11, paddingHorizontal: 22, backgroundColor: C.surface }),
        ], { borderRadius: 22, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper }),
        asking,
        row([primaryButton("Send", goAction(ctx), { size: "md" }), hint], { gap: 14 }),
      ],
    });
  }

  const side = (labelText: string, name: "clip" | "folder" | "computer" | "keyboard", a: ActionRef) => col([
    box([icon(name, { size: 20 })], { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" }),
    text(labelText, { size: 12, color: C.grey70, lineHeight: 16 }),
  ], { gap: 6, alignItems: "center", flexGrow: 1, flexBasis: 0 }, a);
  const voice = askVoice(ctx);
  return page(ctx, {
    title: "Ask any bot", gap: 16, state,
    body: [
      box([box([], { width: 36, height: 5, borderRadius: 3, backgroundColor: C.outline })], { alignItems: "center" }),
      row([text("Ask any bot", { size: 24, weight: 700, tracking: -0.5, lineHeight: 30 }), grow(), labelled(box([icon("close", { size: 22 })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 }, back()), "Close")]),
      col([
        voice ? voice.line : row([bars([6, 12, 16, 9, 13, 5]), meta(speakLine(ctx), { size: 12 })], { gap: 8 }),
        field("ask", "Say what you need", { size: 22, weight: 500, multiline: true }),
        ...(voice ? [micBlockedNotice()] : []),
        ...fileChip,
      ], { gap: 8 }),
      col([whoChip(ctx), handTo(ctx), pickList(ctx)], { gap: 6 }),
      col([sectionLabel("Or try"), ...tries(ctx)], { gap: 0 }),
    ],
    footer: [
      asking,
      row([
        side("Photo", "clip", attachTo(ctx, "photo")), side("File", "folder", attachTo(ctx, "file")),
        voice ? voice.big : box([labelled(box([icon("send", { size: 30, color: C.paper })], {
          width: 88, height: 88, borderRadius: 44, backgroundColor: C.ink, alignItems: "center", justifyContent: "center",
        }, goAction(ctx)), "Send")], { width: 108, alignItems: "center", flexShrink: 0 }),
        side("Screen", "computer", attachTo(ctx, "screen")), side("Paste", "keyboard", { kind: "readClipboard", assignTo: "ask" }),
      ], { alignItems: "center" }),
      voice ? voice.hint : hint,
    ],
  });
}

/**
 * Speaking in Ask (the phone, a build with VoiceRecord): the line over the field (still bars; listening, the bars follow
 * the voice; then a moment while the words are written down), the big button (the mic while nothing is said, the mic
 * with its ring while it listens, a working mark while it writes, send once there are words) and the line under it.
 * Opened from a mic elsewhere (params voice) it starts listening at once. The words land in the field; who will answer
 * is checked then, and the next tap sends, as a typed ask does.
 */
function askVoice(ctx: BotsCtx): { line: Node; big: Node; hint: Node } | null {
  if (!canRecord(ctx)) return null;
  const listen = listenAction("ask", { kind: "condition", if: { falsy: "route.slug" }, then: checkWho });
  const line: Node = {
    ...col([
      when(notListening, row([bars([6, 12, 16, 9, 13, 5]), meta(speakLine(ctx), { size: 12 })], { gap: 8 })),
      when(listening, row([voiceBars([6, 12, 16, 9, 13, 5], { live: true }), meta(speakLine(ctx, true), { size: 12 })], { gap: 8, height: 16 })),
      when(writingDown, row([statusMark("working", { color: C.ink }), meta("Writing down what you said…", { size: 12 })], { gap: 8, height: 16 })),
    ]),
    ...(ctx.params.voice ? { on: { onAppear: listen } } : {}),
  };
  const disc = (inner: Node, a: ActionRef | undefined, label: string, ring = false): Node => labelled(box([
    box([inner], { width: 88, height: 88, borderRadius: 44, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }),
  ], { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center", backgroundColor: ring ? C.surface : C.paper }, a), label);
  const big = box([
    when({ all: [notListening, { falsy: "ask" }] }, disc(icon("mic", { size: 34, color: C.paper }), listen, "Speak")),
    when(listening, disc(icon("mic", { size: 34, color: C.paper }), listen, "Listening. Tap when you're done", true)),
    when(writingDown, disc(statusMark("working", { color: C.paper, size: 14 }), undefined, "Writing down what you said")),
    when({ all: [notListening, { truthy: "ask" }] }, disc(icon("send", { size: 30, color: C.paper }), goAction(ctx), "Send")),
  ], { width: 108, alignItems: "center", flexShrink: 0 });
  const hint = col([
    when(listening, meta("Tap the mic when you're done", { size: 13, align: "center" })),
    when({ all: [notListening, { falsy: "ask" }] }, meta("Tap the mic and speak, or type", { size: 13, align: "center" })),
    when({ all: [notListening, { truthy: "ask" }, { falsy: "route.slug" }] }, meta("Tap once to see who answers, again to send", { size: 13, align: "center" })),
    when({ all: [notListening, { truthy: "ask" }, { truthy: "route.slug" }] }, text("", { size: 13, color: C.meta, lineHeight: 17, align: "center", bind: "route.hint" })),
  ]);
  return { line, big, hint };
}

/** The answer: what was asked, who answered and what came back; a payment it filled in; the bar to ask again. */
function askAnswer(ctx: BotsCtx) {
  const asked = String(ctx.params.message ?? "");
  const answer = String(ctx.params.answer ?? "");
  const slug = String(ctx.params.bot ?? "");
  const upi = upiOf(ctx.params.upi);
  const needs = Number(ctx.params.needs ?? 0) || 0;
  const job = typeof ctx.params.job === "string" && ctx.params.job ? ctx.params.job : "";
  const by = slug && slug !== "any" ? nameOf(ctx, slug) : "";
  const blocks: Node[] = [];
  if (asked) {
    blocks.push(row([box([body(asked)], { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, maxWidth: "85%" })], { justifyContent: "flex-end" }));
  }
  blocks.push(col([
    row([slug ? avatarOf(ctx, slug, 24) : icon("spark", { size: 16, color: C.meta }), meta(by ? `${by} answered` : "Answered by your bots", { size: 12 })], { gap: 6 }),
    ...(answer ? [body(answer, { lineHeight: 22 })] : []),
  ], { gap: 8 }));
  if (job) {
    blocks.push(row([statusMark("working", { color: colorOf(ctx, "code") }), text("Code bot is on it", { size: 14, lineHeight: 19 }), grow(), text("Watch", { size: 14, weight: 500, lineHeight: 19 }), icon("chevron", { size: 16 })], {
      gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line,
    }, open(SCREENS.codeJob, { id: job })));
  }
  if (upi) {
    blocks.push(row([
      icon("rupee", { size: 20 }),
      col([text(`Pay ${upi.name}?`, { size: 15, weight: 600, lineHeight: 20 }), meta("You type the amount and press pay in your UPI app")], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      icon("chevron", { size: 16, color: C.meta }),
    ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }, open(SCREENS.approve, { upi: upi.link, bot: slug || "tailzu" })));
  }
  if (needs > 0) {
    blocks.push(row([statusMark("needs"), text(needs === 1 ? "1 change waits for your yes" : `${needs} changes wait for your yes`, { size: 14, lineHeight: 19 }), grow(), icon("chevron", { size: 16, color: C.meta })], {
      gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line,
    }, toTab("activity")));
  }
  return page(ctx, { back: true, backTitle: "Ask", title: "Ask", nav: "bots", body: blocks, footer: [askBar(ctx.client, { ctx })], gap: 18 });
}

// ===================================================================== search

function searchLoad(ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }) {
  const q = String(ctx.params.q ?? "").trim();
  return q ? deps.api<SearchResult>("GET", `/v1/shell/search?q=${encodeURIComponent(q)}&tz=${ctx.tzOffsetMinutes}`) : Promise.resolve(undefined as unknown as SearchResult);
}

const KIND_WORDS: Record<SearchKind, string> = { projects: "Projects", chats: "Chats", notes: "Notes", files: "Files", bots: "Bots" };
const KIND_ICON: Record<SearchKind, "code" | "notes" | "folder" | "spark"> = { projects: "code", chats: "spark", notes: "notes", files: "folder", bots: "spark" };

/** Where a result goes; a file opens Ask with it attached. */
const openHit = (h: SearchHit): ActionSpec => open(h.open.screenId, h.kind === "files" && h.attachment ? { ...(h.open.params ?? {}), attachment: h.attachment } : h.open.params);

function hitIcon(ctx: BotsCtx, h: SearchHit, size: number): Node {
  if (h.kind === "bots" && h.bot) return avatarOf(ctx, h.bot, size);
  return box([icon(KIND_ICON[h.kind], { size: Math.round(size * 0.5), color: C.ink })], {
    width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

function searchField(big: boolean): Node {
  const go = { kind: "navigate" as const, screenId: SCREENS.search, params: { q: "$state.q" }, replace: true };
  return row([
    ...(big ? [] : [icon("search", { size: 18, color: C.meta })]),
    field("q", "Search everything", { size: big ? 18 : 16, onSubmit: go }),
    when({ truthy: "q" }, labelled(box([icon("close", { size: big ? 16 : 18, color: C.ink })], {
      width: big ? 40 : 44, height: big ? 40 : 44, borderRadius: big ? 20 : 22, alignItems: "center", justifyContent: "center", ...(big ? { backgroundColor: C.surface } : {}),
    }, seq({ kind: "clearState", path: "q" }, { kind: "navigate", screenId: SCREENS.search, replace: true })), "Clear search")),
  ], big
    ? { gap: 12, height: 56, borderWidth: 1.5, borderColor: C.ink, borderRadius: 28, paddingLeft: 20, paddingRight: 8 }
    : { gap: 8, height: 46, borderRadius: 23, backgroundColor: C.surface, paddingLeft: 14, paddingRight: 1, flexGrow: 1, flexShrink: 1 });
}

function hitWords(h: SearchHit): { line: string; sub: string } {
  if (h.kind === "chats") return { line: `“${h.title}”`, sub: h.sub ?? "" };
  if (h.kind === "bots") return { line: h.title, sub: h.sub ?? "" };
  return { line: h.title, sub: h.snippet ?? h.sub ?? "" };
}

function searchPhone(ctx: BotsCtx, data: SearchResult | undefined) {
  const q = String(ctx.params.q ?? "").trim();
  const groups = data ? (Object.keys(KIND_WORDS) as SearchKind[]).filter((k) => data.groups[k].length) : [];
  return page(ctx, {
    title: "Search", gap: 16, state: { q },
    body: [
      row([labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"), searchField(false)], { gap: 4 }),
      ...(!q ? [emptyState({ pose: "listen", title: "Search everything", body: "Your projects, chats, notes, files and bots, in one place." })]
        : !data ? [couldNot("results")]
          : !data.total ? [emptyState({ pose: "think", title: `Nothing for “${q}”`, body: "Try fewer words, or ask your bots.", action: { label: `Ask your bots about “${q}”`, onPress: open(SCREENS.ask, { message: q }) } })]
            : [
              meta(`${data.total} ${data.total === 1 ? "result" : "results"} in projects, chats, notes, files and bots`, { size: 13 }),
              ...groups.map((k) => col([
                sectionLabel(KIND_WORDS[k]),
                ...data.groups[k].map((h) => {
                  const w = hitWords(h);
                  return row([
                    hitIcon(ctx, h, 36),
                    col([
                      h.kind === "files" ? mono(w.line, { size: 12 }) : text(w.line, { size: 15, weight: h.kind === "bots" ? 600 : 400, lineHeight: 20, lines: 2, ...(h.kind === "chats" ? { color: C.grey70 } : {}) }),
                      meta(w.sub, { lines: 1 }),
                    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
                    ...(h.bot && h.kind !== "bots" ? [avatarOf(ctx, h.bot, 26)] : []),
                  ], { gap: 12, paddingVertical: 9 }, openHit(h));
                }),
              ], { gap: 4 })),
            ]),
    ],
    ...(q ? { footer: [secondaryButton(`Ask your bots about “${q}”`, open(SCREENS.ask, { message: q }), { wide: true })] } : {}),
  });
}

function searchDesk(ctx: BotsCtx, data: SearchResult | undefined) {
  const q = String(ctx.params.q ?? "").trim();
  // The board's three columns: chats; projects and bots; notes and files.
  const kinds: SearchKind[] = ["chats", "projects", "bots", "notes", "files"];
  const all = data ? kinds.flatMap((k) => data.groups[k]) : [];
  const first = all[0];
  const filterOn = (k: SearchKind): Condition => ({ in: ["filter", ["all", k]] });
  const tile = (h: SearchHit): Node => {
    const w = hitWords(h);
    return col([
      row([hitIcon(ctx, h, h.kind === "chats" && h.bot ? 24 : 28), ...(h.kind === "chats" ? [meta(h.sub ?? "", { lines: 1, style: { flexShrink: 1 } })] : []), grow(), ...(h.bot && h.kind !== "bots" && h.kind !== "chats" ? [avatarOf(ctx, h.bot, 22)] : [])], { gap: 8 }),
      text(w.line, { size: 14, weight: h.kind === "bots" || h.kind === "files" ? 600 : 400, lineHeight: 19, lines: 3 }),
      ...(h.kind !== "chats" && w.sub ? [meta(w.sub, { lines: 2 })] : []),
    ], {
      gap: 6, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 14, backgroundColor: C.paper,
      borderWidth: whenEq("sel", h.id, 1.5, 1), borderColor: whenEq("sel", h.id, h.bot ? colorOf(ctx, h.bot) : C.ink, C.line),
    }, { kind: "setState", path: "sel", value: h.id });
  };
  const group = (k: SearchKind): Node => when(filterOn(k), col([sectionLabel(`${KIND_WORDS[k]} · ${data!.groups[k].length}`), ...data!.groups[k].map(tile)], { gap: 8 }));
  const present = kinds.filter((k) => data?.groups[k].length);
  const columns: SearchKind[][] = [["chats"], ["projects", "bots"], ["notes", "files"]].map((c) => c.filter((k) => present.includes(k as SearchKind)) as SearchKind[]).filter((c) => c.length);
  const preview = (h: SearchHit): Node => when({ eq: ["sel", h.id] }, col([
    row([sectionLabel("Preview"), grow(), meta(`${KIND_WORDS[h.kind].replace(/s$/, "")} · ${all.indexOf(h) + 1} of ${all.length}`)]),
    row([hitIcon(ctx, h, 34), col([text(h.bot ? nameOf(ctx, h.bot) : h.title, { size: 15, weight: 600, lineHeight: 20, lines: 1 }), meta(h.preview?.at ?? h.sub ?? "", { lines: 1 })], { gap: 2, flexShrink: 1 })], { gap: 10 }),
    col([
      ...(h.preview?.lines ?? []).map((l) => l.who === "you"
        ? row([box([text(l.text, { size: 14, lineHeight: 19, lines: 4 })], { backgroundColor: C.surface, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13, maxWidth: "88%" })], { justifyContent: "flex-end" })
        : row([...(h.bot ? [avatarOf(ctx, h.bot, 22)] : []), text(l.text, { size: 14, lineHeight: 19, lines: 5, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" })),
      ...(!(h.preview?.lines ?? []).length ? [text(h.preview?.body || h.sub || h.title, { size: 14, lineHeight: 20, color: C.grey70, lines: 8 })] : []),
    ], { gap: 10 }),
    row([primaryButton(h.kind === "chats" ? "Open chat" : h.kind === "files" ? "Ask about it" : "Open", openHit(h), { size: "md" }), row([kbd("↵"), meta("to open", { size: 12 })], { gap: 6 })], { gap: 12 }),
  ], { gap: 14, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: C.line }));

  return page(ctx, {
    title: "Search everything", gap: 18, maxWidth: 1100, state: { q, filter: "all", ...(first ? { sel: first.id } : {}) },
    body: [
      title("Search everything"),
      col([
        searchField(true),
        ...(data?.total ? [row([
          dotChip(`All · ${data.total}`, "filter", "all"),
          ...present.map((k) => dotChip(`${KIND_WORDS[k]} · ${data.groups[k].length}`, "filter", k)),
          meta("results in projects, chats, notes, files and bots", { size: 12 }),
        ], { gap: 8, flexWrap: "wrap" })] : []),
      ], { gap: 12 }),
      ...(!q ? [emptyState({ pose: "listen", title: "Search everything", body: "Your projects, chats, notes, files and bots, in one place. Type, then press Enter." })]
        : !data ? [couldNot("results")]
          : !data.total ? [emptyState({ pose: "think", title: `Nothing for “${q}”`, body: "Try fewer words, or ask your bots.", action: { label: `Ask your bots about “${q}”`, onPress: open(SCREENS.ask, { message: q }) } })]
            : [row([
              col([
                row(columns.map((ks) => col(ks.map(group), { gap: 18, flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 16, alignItems: "flex-start" }),
                secondaryButton(`Ask your bots about “${q}”`, open(SCREENS.ask, { message: q }), { size: "md" }),
              ], { gap: 18, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }),
              col(all.map(preview), { width: 330, flexShrink: 0 }),
            ], { gap: 24, alignItems: "flex-start" })]),
    ],
  });
}

// ===================================================================== tasks

interface TasksData {
  rows: FeedRow[];
  upcoming: { connected: boolean; todos: Array<{ id?: string; title: string; due?: string; overdue?: boolean; notes?: string }> | null };
  took: number;
  total: number;
  minutesSaved: number;
}

/** A decision's choices, worded for a task list: a connected app's yes is "Do it for me", its no "I'll do it". */
function taskChoices(n: NeedsItem): NeedsItem["choices"] {
  if (!n.id.startsWith("task:")) return n.choices.filter((c) => c.kind !== "quiet").slice(0, 2);
  return n.choices.map((c) => c.kind === "primary" ? { ...c, label: "Do it for me" } : { ...c, label: "I'll do it" });
}

function tasksLine(d: TasksData | undefined): string {
  if (!d) return "Today's work by your bots";
  const saved = d.minutesSaved > 0 ? ` · ${duration(d.minutesSaved)} saved` : "";
  return d.total ? `Bots took ${d.took} of ${d.total} today${saved}` : `Nothing on today yet${saved}`;
}

function taskRowNode(ctx: BotsCtx, r: FeedRow, size: number): Node {
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
function upcomingNodes(ctx: BotsCtx, d: TasksData | undefined): Node[] {
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

function tasksPhone(ctx: BotsCtx, d: TasksData | undefined) {
  const needs = ctx.live.needs;
  const rest = (d?.rows ?? []).filter((r) => r.mark !== "needs");
  const upCount = d?.upcoming.todos?.length ?? 0;
  return page(ctx, {
    tab: "bots", title: "Tasks", gap: 16, state: { tview: "today" },
    body: [
      row([
        col([title("Tasks"), meta(tasksLine(d), { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
        roundButton("plus", open(SCREENS.ask), { size: 44, light: true, label: "Add a task" }),
      ], { gap: 10 }),
      segmented([{ label: `Today · ${needs.length + rest.length}`, value: "today" }, { label: `Upcoming · ${upCount}`, value: "upcoming" }], "tview"),
      ...(d ? [] : [couldNot("your tasks")]),
      when({ eq: ["tview", "today"] }, col([
        ...(needs.length ? [col([
          sectionLabel(`Needs you · ${needs.length}`),
          ...needs.map((n) => col([
            row([
              avatarOf(ctx, n.bot, 30),
              col([text(n.question, { size: 15, weight: 600, lineHeight: 20, lines: 2 }), meta([n.botName, n.detail].filter(Boolean).join(" · "), { lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
              statusMark("needs"),
            ], { gap: 12, alignItems: "flex-start" }),
            row(taskChoices(n).map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 8, flexWrap: "wrap" }),
          ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line })),
        ], { gap: 10 })] : []),
        ...(rest.length ? [col([sectionLabel(`Rest of today · ${rest.length}`), ...rest.map((r) => taskRowNode(ctx, r, 30))], { gap: 14 })] : []),
        ...(d && !needs.length && !rest.length ? [emptyState({ pose: "hello", title: "Nothing on today", body: "Ask a bot for something and it shows up here.", action: { label: "Add a task", onPress: open(SCREENS.ask) } })] : []),
      ], { gap: 16 })),
      when({ eq: ["tview", "upcoming"] }, col(upcomingNodes(ctx, d), { gap: 12 })),
    ],
  });
}

function taskDetail(ctx: BotsCtx, n: NeedsItem): Node {
  const [kind] = n.id.split(":");
  const facts: Array<[string, string]> = kind === "job"
    ? [["Code bot", "is waiting"], [percent(ctx.live.usage.used), ctx.live.usage.windows ? "of this stretch used" : "of this month used"], [clockOf(n.at, ctx.tzOffsetMinutes), "waiting since"]]
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

function tasksDesk(ctx: BotsCtx, d: TasksData | undefined) {
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

// ===================================================================== approve

interface Receipt { id: string; bot: string; title: string; amountPaise: number; payee: string; at: number }
interface ApproveData { task?: { id: string; state: string; title: string; approval: { id: string; connector: string; tool: string; preview: string } | null; updatedAt: number } | null; receipt?: Receipt | null }

async function approveLoad(ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }): Promise<ApproveData> {
  if (ctx.params.task) {
    const r = await deps.api<{ tasks: NonNullable<ApproveData["task"]>[] }>("GET", "/v1/tasks");
    return { task: (r.tasks ?? []).find((t) => t.id === String(ctx.params.task)) ?? null };
  }
  if (ctx.params.receipt) {
    const r = await deps.api<{ receipt: Receipt }>("GET", `/v1/shell/receipts/${encodeURIComponent(String(ctx.params.receipt))}`);
    return { receipt: r.receipt };
  }
  return {};
}

function approveTop(ctx: BotsCtx, slug: string, mark: Mark | null): Node {
  const desk = ctx.client === "desktop";
  return row([
    labelled(box([icon("back", { size: desk ? 22 : 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
    avatarOf(ctx, slug, desk ? 26 : 30),
    text(nameOf(ctx, slug), desk ? { size: 14, weight: 600, lineHeight: 18 } : { size: 13, color: C.grey70, lineHeight: 17 }),
    ...(mark ? [row([statusMark(mark), ...(desk ? [text(mark === "needs" ? "Needs you" : "Done", { size: 13, color: C.grey70, lineHeight: 17 })] : [])], { gap: 6, marginLeft: desk ? 6 : 0 })] : []),
  ], { gap: 8 });
}

/** "Pay Fresh Basket for this week's groceries?" No amount: the person types it in their UPI app. */
const payQuestion = (u: { name: string; note: string }) =>
  `Pay ${u.name}${u.note ? ` for ${u.note.charAt(0).toLowerCase()}${u.note.slice(1)}` : ""}?`;

function approvePay(ctx: BotsCtx, link: string) {
  const u = upiOf(link)!;
  const slug = String(ctx.params.bot ?? "tailzu");
  const who = nameOf(ctx, slug);
  const paid = call("POST", "/v1/shell/receipts", { upi: u.link, bot: slug, title: u.note || `Payment to ${u.name}` }, {
    ok: seq(toast("Receipt saved to Activity"), toTab("activity")),
    fail: toast("Couldn't save the receipt. Try again.", "error"),
  });
  const openUpi = seq({ kind: "openUrl", url: u.link, external: true }, { kind: "setState", path: "opened", value: true });
  const lines: Array<[string, Node]> = [
    ["Paying", text(u.name, { size: 14, lineHeight: 19, color: C.meta, align: "right" })],
    ["UPI ID", mono(u.vpa, { size: 12 })],
    ...(u.note ? [["For", text(u.note, { size: 14, lineHeight: 19, color: C.meta, align: "right", lines: 2, style: { flexShrink: 1 } })] as [string, Node]] : []),
  ];
  const lineRow = ([a, b]: [string, Node]) => row([text(a, { size: 14, lineHeight: 19 }), grow(), b], { gap: 12 });
  const total = row([text("Amount", { size: 15, weight: 600, lineHeight: 20 }), grow(), text("You type it in UPI", { size: 14, lineHeight: 19, color: C.meta, align: "right" })]);
  const fine = `You type the amount and press pay in your UPI app. ${who} never pays on its own.`;

  if (ctx.client === "desktop") {
    const qr = qrOf(u.link);
    const d = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000);
    const day = `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
    const name = firstName(ctx);
    return page(ctx, {
      title: "Approve", gap: 18, maxWidth: 1100, state: { opened: false },
      body: [
        approveTop(ctx, slug, "needs"),
        row([blip("needs", 84), col([title(payQuestion(u)), meta(`${u.vpa}${u.note ? ` · ${u.note}` : ""}`, { size: 14, lineHeight: 19 })], { gap: 6, flexShrink: 1 })], { gap: 18 }),
        row([
          col([
            row([sectionLabel("What you're paying for"), grow()], { paddingTop: 12, paddingBottom: 6 }),
            ...lines.map((l) => box([lineRow(l)], { paddingVertical: 10 })),
            divider(), box([total], { paddingTop: 14, paddingBottom: 10 }),
            meta(`${who} filled this in. Check it before you pay.`),
          ], { flexGrow: 1.2, flexBasis: 0, minWidth: 0, paddingTop: 6, paddingHorizontal: 18, paddingBottom: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
          col([
            sectionLabel("Receipt preview"),
            box([col([
              text(u.name, { size: 14, weight: 600, lineHeight: 19 }),
              mono(`${name ? `For ${name} · ` : ""}${day}`, { size: 11.5, boxed: false, color: C.grey70 }),
              ...(u.note ? [mono(u.note, { size: 11.5, boxed: false, color: C.grey70 })] : []),
              mono("Paid by UPI · ref after you pay", { size: 11.5, boxed: false, color: C.meta }),
            ], { gap: 6, backgroundColor: C.paper, borderRadius: 8, padding: 16 })], { backgroundColor: C.surface, borderRadius: 18, padding: 14 }),
            row([icon("check", { size: 14, color: C.meta }), meta("Receipt saves to Activity after you pay")], { gap: 8 }),
          ], { flexGrow: 0.95, flexBasis: 0, minWidth: 0, gap: 10 }),
          col([
            sectionLabel("Pay on your phone"),
            ...(qr ? [box([shapes([{ d: qrPath(qr), fill: C.ink }], { viewBox: `0 0 ${qr.size + 8} ${qr.size + 8}`, size: 150, label: "UPI payment code" })], {
              alignSelf: "center", padding: 6, borderRadius: 14, borderWidth: 1, borderColor: C.divider, backgroundColor: C.paper,
            })] : []),
            col([
              ...[qr ? "Scan with your phone's camera" : "Open X0 Bot on your phone", `UPI opens on ${u.name}`, "You type the amount and press pay"]
                .map((s, i) => row([stepDot(i + 1), text(s, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10 })),
            ], { gap: 9 }),
            row([statusMark("waiting"), meta("Waiting for you · then tell us you paid")], { gap: 8 }),
            row([secondaryButton("Not now", back(), { size: "md" }), quietButton("I've paid", paid, { size: "md" })], { gap: 12, flexWrap: "wrap" }),
          ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 14, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
        ], { gap: 20, alignItems: "flex-start" }),
        row([icon("lock", { size: 16, color: C.grey70 }), text(fine, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8 }),
      ],
    });
  }

  return page(ctx, {
    title: "Approve", gap: 14, state: { opened: false },
    body: [
      approveTop(ctx, slug, "needs"),
      blip("needs", 140),
      col([sectionLabel("Needs you"), text(payQuestion(u), { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { gap: 6 }),
      col([
        col(lines.map(lineRow), { gap: 8, paddingVertical: 14, paddingHorizontal: 16 }),
        divider(),
        box([total], { paddingVertical: 12, paddingHorizontal: 16 }),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line }),
      row([icon("check", { size: 14, color: C.meta }), meta("Receipt saves to Activity after you pay", { size: 13 })], { gap: 8 }),
    ],
    footer: [
      primaryButton("Open UPI to pay", openUpi, { wide: true }),
      when({ truthy: "opened" }, secondaryButton("I've paid", paid, { wide: true })),
      when({ falsy: "opened" }, secondaryButton("Not now", back(), { wide: true })),
      meta(fine, { align: "center" }),
    ],
  });
}

function approveTask(ctx: BotsCtx, d: ApproveData | undefined) {
  const t = d?.task;
  const waiting = t && t.state === "waiting" && t.approval;
  const slug = t?.approval ? ({ "google-calendar": "plan", "google-tasks": "plan", maps: "travel", booking: "travel" } as Record<string, string>)[t.approval.connector] ?? "tailzu" : "tailzu";
  if (!waiting) {
    return page(ctx, {
      back: true, title: "Approve", nav: "activity",
      body: [d ? emptyState({ pose: "done", title: "Nothing waiting here", body: t ? "This one was already answered." : "It may have expired. Anything that needs you is in Activity.", action: { label: "Open Activity", onPress: toTab("activity") } }) : couldNot("this request")],
    });
  }
  const app = t.approval!.connector.replace(/^google-/, "Google ").replace(/(^|\s)\w/g, (m) => m.toUpperCase());
  const yes = call("POST", `/v1/tasks/${t.id}/approve`, { approvalId: t.approval!.id }, { ok: seq(toast("Done"), back()), fail: toast("Couldn't do that. Try again.", "error") });
  const no = call("POST", `/v1/tasks/${t.id}/deny`, undefined, { ok: seq(toast("Left it"), back()), fail: toast("Couldn't do that. Try again.", "error") });
  const fine = `${nameOf(ctx, slug)} does only this, once. The yes holds for an hour.`;
  const words = col([
    sectionLabel(`The exact change · ${app}`),
    text(t.approval!.preview, { size: 15, lineHeight: 21 }),
  ], { gap: 8, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line });
  const question = ctx.client === "desktop"
    ? row([blip("needs", 84), col([title(t.title), meta(`${app} · waiting since ${clockOf(t.updatedAt, ctx.tzOffsetMinutes)}`, { size: 14, lineHeight: 19 })], { gap: 6, flexShrink: 1 })], { gap: 18 })
    : col([blip("needs", 140), sectionLabel("Needs you"), text(t.title, { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { gap: 6 });
  return page(ctx, {
    title: "Approve", gap: ctx.client === "desktop" ? 18 : 14,
    body: [approveTop(ctx, slug, "needs"), question, words, ...(ctx.client === "desktop" ? [row([primaryButton("Yes, do it", yes, { size: "md" }), secondaryButton("No", no, { size: "md" })], { gap: 10 }), meta(fine, { size: 13 })] : [])],
    ...(ctx.client === "desktop" ? {} : { footer: [primaryButton("Yes, do it", yes, { wide: true }), secondaryButton("No", no, { wide: true }), meta(fine, { align: "center" })] }),
  });
}

function approveReceipt(ctx: BotsCtx, d: ApproveData | undefined) {
  const r = d?.receipt;
  if (!r) return page(ctx, { back: true, title: "Receipt", nav: "activity", body: [d ? emptyState({ pose: "think", title: "No such receipt", action: { label: "Open Activity", onPress: toTab("activity") } }) : couldNot("this receipt")] });
  const at = `${dayLabel(r.at, ctx.live.now, ctx.tzOffsetMinutes)}, ${clockOf(r.at, ctx.tzOffsetMinutes)}`;
  return page(ctx, {
    back: true, backTitle: "Receipt", title: "Receipt", nav: "activity", gap: 18,
    body: [
      row([statusMark("done", { size: 10 }), sectionLabel("Paid")], { gap: 8 }),
      title(`Paid ${r.payee || "the payee"}`),
      listCard([
        listRow({ label: "For", value: r.title }), listRow({ label: "Paid to", value: r.payee || "—" }),
        listRow({ label: "Filled in by", value: nameOf(ctx, r.bot) }), listRow({ label: "When", value: at }),
      ]),
      meta("You pressed pay by UPI. Your UPI app has the bank's reference.", { size: 13 }),
    ],
  });
}

// ===================================================================== offline

/** No connection: the wifi arcs with a line through them. */
function wifiOff(size: number, color: string): Node {
  return shapes([
    { d: "M2.5 8.8a14 14 0 0 1 6.2-3.1M12.6 5.4a14 14 0 0 1 8.9 3.4M5.6 12.2a9 9 0 0 1 4.3-2.2M15.6 10.6a9 9 0 0 1 2.8 1.6M8.9 15.6a4.5 4.5 0 0 1 6.2 0M12 19.2h.01M3.5 3.5l17 17", stroke: color, strokeWidth: 1.9, linecap: "round" },
  ], { size, label: "Offline" });
}

function offline(ctx: BotsCtx) {
  const live = ctx.live;
  const code = live.bots.find((b) => b.slug === "code");
  const keybot = live.bots.find((b) => b.slug === "keybot") ?? botLook("keybot");
  const last = clockOf(live.now, ctx.tzOffsetMinutes);
  const desk = ctx.client === "desktop";
  const pill = row([wifiOff(14, C.grey70), text("Offline", { size: 12, weight: 500, color: C.grey70, lineHeight: 16 })], {
    gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: C.surface,
  });
  const keyCard = col([
    row([
      botAvatar(keybot, 38),
      col([text("Keybot · basic mode", { size: 15, weight: 600, lineHeight: 20 }), meta(`Speak and it types, right on this ${desk ? "computer" : "phone"}`)], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      box([icon("mic", { size: 18, color: C.paper })], { width: 40, height: 34, borderRadius: 9, backgroundColor: botLook("keybot").color, alignItems: "center", justifyContent: "center" }),
    ], { gap: 12 }),
    col([
      row([text("Works now", { size: 13, color: C.meta, lineHeight: 18, style: { width: 120 } }), text("Dictation · English, Hindi", { size: 13, lineHeight: 18 })], { gap: 12 }),
      row([text("When you're back", { size: 13, color: C.meta, lineHeight: 18, style: { width: 120 } }), text("Clean-up, rewrite, translate", { size: 13, lineHeight: 18 })], { gap: 12 }),
      ...(desk ? [row([kbd("Fn"), meta("Hold Fn to speak in any app")], { gap: 8 })] : []),
    ], { gap: 6 }),
  ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }, botRoute("keybot"));
  const codeLine = code?.working ? [row([
    avatarOf(ctx, "code", 30),
    col([text("Code bot keeps working in the cloud", { size: 14, lineHeight: 19 }), meta(`Last heard ${last} · ${code.doing ?? "on it"} · catches you up`)], { gap: 2, flexGrow: 1, flexShrink: 1 }),
    statusMark("working", { color: code.color }),
  ], { gap: 12, paddingHorizontal: 4 })] : [];
  // The asks typed while offline: kept in this page's state (three at most), sent when the person is back.
  const queued = [0, 1, 2].map((i) => when({ truthy: `queued.${i}` }, row([
    avatarOf(ctx, "tailzu", 30),
    col([text("", { size: 14, lineHeight: 19, bind: `queued.${i}` }), meta("Any bot · waiting to send")], { gap: 2, flexGrow: 1, flexShrink: 1 }),
    quietButton("Send", call("POST", "/v1/shell/ask", { message: `$state.queued.${i}`, bot: "any", device: ctx.client, mode: "text" }, {
      ok: seq({ kind: "toggleInArray", path: "queued", value: `$state.queued.${i}` }, toast("Sent. The answer is in Activity.")),
      fail: toast("Still offline. It waits here."),
    }), { size: "md" }),
  ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 })));
  const add = (ph: string) => row([
    field("later", ph, { size: 15, returnKey: "done", onSubmit: seq({ kind: "condition", if: { falsy: "later" }, then: toast("Type the ask first"), else: seq({ kind: "appendState", path: "queued", value: "$state.later", max: 3 }, { kind: "clearState", path: "later" }) }) }),
    roundButton("plus", seq({ kind: "condition", if: { falsy: "later" }, then: toast("Type the ask first"), else: seq({ kind: "appendState", path: "queued", value: "$state.later", max: 3 }, { kind: "clearState", path: "later" }) }), { size: 40, label: "Keep this ask" }),
  ], { gap: 10, borderRadius: 26, borderWidth: 1, borderColor: C.line, paddingVertical: 5, paddingRight: 5, paddingLeft: 18 });
  const kept = hasOutbox(ctx);
  const waiting = kept ? outboxSection(ctx) : col([
    row([icon("send", { size: 16 }), text("Asks wait here until you're back", { size: 15, weight: 600, lineHeight: 20 })], { gap: 8 }),
    when({ truthy: "queued.0" }, col(queued, { borderRadius: 18, borderWidth: 1, borderColor: C.line })),
    add("Ask a bot. It goes out when you are back."),
  ], { gap: 10 });
  const banner = row([
    ...(desk ? [box([wifiOff(18, C.grey70)], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.paper, alignItems: "center", justifyContent: "center" })] : []),
    col([text("No internet right now", { size: 17, weight: 600, lineHeight: 22 }), text(kept ? "Nothing is lost. Your asks wait here and go out on their own when you're back." : "Nothing is lost. Your asks wait here until you're back.", { size: 14, color: C.grey70, lineHeight: 20 })], { gap: 3, flexGrow: 1, flexShrink: 1 }),
    ...(desk ? [meta(`Last online ${last}`)] : []),
  ], { gap: 16, backgroundColor: C.surface, borderRadius: 18, paddingVertical: 16, paddingHorizontal: desk ? 18 : 16, alignItems: desk ? "center" : "flex-start" });
  const stillOpen = `Your chats, notes and files from this ${desk ? "computer" : "phone"} still open.`;

  if (desk) {
    const strip = row(live.bots.slice(0, 5).map((b) => row([
      botAvatar(b, 30),
      col([text(b.name, { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta(b.slug === "code" && b.working ? "In the cloud · working" : b.slug === "keybot" ? "Basic mode · on here" : "Back when you are", { lines: 1 })], { gap: 2, flexShrink: 1, minWidth: 0 }),
      ...(b.working ? [statusMark("working", { color: b.color })] : []),
    ], { gap: 10, paddingVertical: 12, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0, minWidth: 0 })), { borderRadius: 18, borderWidth: 1, borderColor: C.line });
    return page(ctx, {
      tab: "bots", title: "Offline", gap: 18, maxWidth: 1100, state: kept ? { later: "" } : { queued: [], later: "" },
      body: [
        row([col([text(firstName(ctx) ? `${live.greeting}, ${firstName(ctx)}` : live.greeting, { size: 14, color: C.meta, lineHeight: 18 }), title("Your bots")], { gap: 4 }), grow(), pill], { gap: 16 }),
        banner,
        strip,
        row([
          col([sectionLabel("Still works"), keyCard, meta(stillOpen, { size: 13 })], { gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
          col([waiting, ...codeLine], { gap: 12, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        ], { gap: 28, alignItems: "flex-start" }),
      ],
    });
  }
  return page(ctx, {
    tab: "bots", title: "Offline", gap: 18, state: kept ? { later: "" } : { queued: [], later: "" },
    body: [
      row([tailzuMark(34), col([text(live.greeting, { size: 13, color: C.meta, lineHeight: 17 }), text("Your bots", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 })], { gap: 2 }), grow(), pill], { gap: 10 }),
      banner,
      col([sectionLabel("Still works"), keyCard, box([meta(stillOpen, { size: 13 })], { paddingHorizontal: 4 })], { gap: 10 }),
      waiting,
      ...codeLine,
    ],
  });
}

// ===================================================================== today (the window's)

interface TodayData {
  calendar: { connected: boolean; events: Array<{ start: number | null; end: number | null; title: string; with?: string; when: string }> | null };
  rows: FeedRow[];
  keybot: { words: number; minutesSaved: number; byHour: Array<{ hour: number; words: number }>; byApp: Array<{ app: string; words: number }> };
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
    row([botAvatar(keybot, 30), text("Keybot", { size: 15, weight: 600, lineHeight: 20 })], { gap: 10 }, botRoute("keybot")),
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

function today(ctx: BotsCtx, d: TodayData | undefined) {
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
  const suggests = plan.length ? [col([
    row([avatarOf(ctx, "plan", 30), text("Plan bot suggests", { size: 15, weight: 600, lineHeight: 20 }), grow(), text(plan.length === 1 ? "1 idea for today" : `${plan.length} ideas for today`, { size: 12, weight: 500, color: colorOf(ctx, "plan"), lineHeight: 16 })], { gap: 10 }),
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

// ===================================================================== the list

export const shellScreens: BotsScreen[] = [
  screen<{ arrival?: boolean } & HomeMore>({
    id: SCREENS.home,
    // Whether the first-arrival card (and the bot's hello) is due (once, after onboarding), the name they gave their bot, whether the
    // account has a deletion date, (a phone) whether the notifications ask was ever answered, and Notes' week for its tile.
    load: async (ctx, deps) => {
      const [arrival, leaving, push, notes, persona] = await Promise.all([
        deps.api<{ due: boolean; kind?: "first" | "back" }>("GET", ARRIVAL_PATH).catch(() => undefined),
        deps.api<DeletionState>("GET", DELETION_PATH).catch(() => undefined),
        ctx.client === "phone" ? deps.api<{ due: boolean }>("GET", PUSH_ASK_PATH).catch(() => undefined) : Promise.resolve(undefined),
        hasNotes(ctx) ? deps.api<NotesStats>("GET", NOTES_STATS_PATH).catch(() => undefined) : Promise.resolve(undefined),
        // The name they gave their bot, for the first day's hello.
        deps.api<{ personality?: { assistantName?: string } }>("GET", "/v1/personality").catch(() => undefined),
      ]);
      return { arrival: arrival?.due === true, back: arrival?.kind === "back", leaving, push: push?.due === true, notes, botName: nicknameOf(persona?.personality) };
    },
    build: (ctx, data) => {
      const arrival = !!data?.arrival, more: HomeMore = { leaving: data?.leaving, push: data?.push === true, notes: data?.notes, botName: data?.botName, back: data?.back === true };
      // One Home for everyone, new or not; the bot's hello on top only the first time.
      return ctx.client === "desktop" ? homeDesk(ctx, arrival, more) : homePhone(ctx, arrival, more);
    },
  }),
  screen({ id: SCREENS.empty, build: (ctx) => emptyHome(ctx) }),
  screen<ActivityData>({ id: SCREENS.activity, load: activityLoad, build: (ctx, d) => (ctx.client === "desktop" ? activityDesk(ctx, d) : activityPhone(ctx, d)) }),
  screen<Route>({
    id: SCREENS.ask,
    load: (ctx, deps) => (ctx.params.message && ctx.params.answer === undefined && ctx.params.id === undefined && !ctx.params.bot
      ? deps.api<Route>("POST", "/v1/shell/route", { message: String(ctx.params.message) })
      : Promise.resolve(undefined as unknown as Route)),
    build: (ctx, pre) => (ctx.params.answer !== undefined || ctx.params.id !== undefined ? askAnswer(ctx) : askCompose(ctx, pre)),
  }),
  screen<SearchResult>({ id: SCREENS.search, load: searchLoad, build: (ctx, d) => (ctx.client === "desktop" ? searchDesk(ctx, d) : searchPhone(ctx, d)) }),
  screen<TasksData>({ id: SCREENS.tasks, load: (ctx, deps) => deps.api<TasksData>("GET", `/v1/shell/tasks?tz=${ctx.tzOffsetMinutes}`), build: (ctx, d) => (ctx.client === "desktop" ? tasksDesk(ctx, d) : tasksPhone(ctx, d)) }),
  screen<ApproveData>({
    id: SCREENS.approve, load: approveLoad,
    build: (ctx, d) => (upiOf(ctx.params.upi) ? approvePay(ctx, String(ctx.params.upi)) : ctx.params.receipt ? approveReceipt(ctx, d) : approveTask(ctx, d)),
  }),
  screen({ id: SCREENS.offline, build: (ctx) => offlineKept(ctx, offline(ctx)) }),
  screen<TodayData>({ id: SCREENS.today, load: (ctx, deps) => deps.api<TodayData>("GET", `/v1/shell/today?tz=${ctx.tzOffsetMinutes}`), build: today }),
];

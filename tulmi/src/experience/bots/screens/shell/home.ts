/**
 * The Bots app shell's home screen.
 */

import { type AiConsent, AI_CONSENT_STATE, aiConsentCard, aiConsentDue } from "../firstRun/aiConsentCard.js";
import type { Node, ActionRef, Condition } from "../../../../../../shared/types/sdui.js";
import type { NotesStats } from "../../../../notes/stats.js";
import { ASSISTANT_NAME } from "../../../assistantName.js";
import { homeDayLine } from "../../../settingsWords.js";
import { dayPart } from "../../../touches.js";
import {
  type BotsCtx, canMove, canStrip, homeSurprises, botTiles, botTileSpec, botRoute, makeTileSpec, open, SCREENS, col, grid, botTile,
  makeBotTile, canHead, writeOn, text, liveMark, tailzuMark, roundButton, row, grow, toTab, C, headBar, type PageOpts, hasOutbox,
  needsCard, askBar, page, when, seq, blip, botLook, canHomeThought, canVoice, canSpaces2, hasSpaces, botChip, labelled, sectionLabel,
} from "../../kit.js";
import { HOME_THOUGHT_STATE, homeTalkTo, homeThought, tileVoice } from "./homeThought.js";
import type { BotTileSpec } from "../../../../../../shared/types/sdui.js";
import type { LiveBot } from "../../live.js";
import { type DeletionState, leavingCard } from "../accountGrace.js";
import { ARRIVAL_STATE } from "../firstRun.js";
import { aboutCard, aboutState } from "../firstRun/aboutCard.js";
import { arrivalCard } from "../firstRun/arrivalCard.js";
import type { About } from "../firstRun/parts.js";
import { hasNotes, notesTileSpec, notesStripHeight, notesStrip } from "../notes.js";
import { outboxCard } from "../outbox.js";
import { pushAskDue, PUSH_STATE, withPushCheck, pushAskCard } from "../pushAsk.js";
import { routinesRow, type RoutinesData } from "../routines.js";
import { names, type Space } from "../spaces/parts.js";
import { facesLine } from "../spaces/spaceDetail.js";
import { idleLine as idleLineOf, firstName } from "./parts.js";
import { oracleTileLook } from "../bots/oraclePage.js";
import { mailTileLook } from "../bots/mailPage.js";

// ===================================================================== home

/**
 * The tiles: the three bots that matter most right now (needs you, working, then the built-ins), and Make a bot.
 * Living (a tiny Blip in each, playing; BotTiles) where the build draws them, else today's static tiles. Under them,
 * Notes as a full-width strip (screens/notes.ts): in the living grid's own world where the build draws one (canStrip),
 * else a still strip of its own.
 */
/** How many groups Home shows as bots; the rest are on Spaces. */
const GROUPS_ON_HOME = 2;
/** A group's colour: one of a few quiet ones, the same for the group every time. */
const GROUP_COLORS = ["#5B7DB1", "#B5654A", "#6B8E4E", "#8A6BB1", "#B18A3D"];
const groupColor = (id: string): string => GROUP_COLORS[[...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % GROUP_COLORS.length]!;
/** A group's line on its tile: what waits on you there, else who is in it. */
const groupLine = (s: Space): string => (s.waiting ? `${s.waiting === 1 ? "1 payment needs" : `${s.waiting} payments need`} your yes` : facesLine(s));

/**
 * Home's one Space card (a build with the new Spaces), however many spaces there are: the newest thing across them (a payment waiting
 * for a yes, else the newest line "Mom: Dinner at 8?", else who or what is there); a tap opens Your spaces.
 */
const SPACE_CARD_COLOR = GROUP_COLORS[0]!;
function spaceCardLine(groups: Space[]): string {
  const waiting = groups.reduce((n, s) => n + (s.waiting ?? 0), 0);
  if (waiting) return `${waiting === 1 ? "1 payment needs" : `${waiting} payments need`} your yes`;
  const newest = groups.map((s) => s.last).filter((l): l is NonNullable<Space["last"]> => !!l?.text).sort((a, b) => b.at - a.at)[0];
  if (newest) return newest.from ? `${newest.from}: ${newest.text}` : newest.text;
  return groups.length === 1 ? facesLine(groups[0]!) : names(groups.map((s) => s.name));
}
function spaceCardSpec(groups: Space[]): BotTileSpec {
  const line = spaceCardLine(groups);
  const waiting = groups.some((s) => (s.waiting ?? 0) > 0);
  return {
    slug: "spaces", name: "Space", sub: line, color: SPACE_CARD_COLOR, kind: "custom", state: waiting ? "needs" : "idle",
    action: open(SCREENS.spaces), label: `Space, your people: ${line}`,
  };
}

/** A group (a family or friends' space) as a bot on Home: its own tile, opening the group's page (a build without the new Spaces). */
function groupTileSpec(s: Space): BotTileSpec {
  return {
    slug: `space-${s.id}`, name: s.name, sub: groupLine(s), color: groupColor(s.id), kind: "custom", state: s.waiting ? "needs" : "idle",
    action: open(SCREENS.spaces, { id: s.id }), label: `${s.name}, your group: ${groupLine(s)}`,
  };
}
/** The same, for a build without the living tiles. */
function groupTile(s: Space, height: number, padding: number): Node {
  const look = botLook(`space-${s.id}`, groupColor(s.id));
  // Its own line says what waits ("1 payment needs your yes"), so no bot's "Needs you · 1 question" in its place.
  const bot: LiveBot = { ...look, slug: `space-${s.id}`, name: s.name, builtin: false, state: "idle", working: false, needs: 0, purpose: "" };
  return botTile(bot, { idle: groupLine(s), onPress: open(SCREENS.spaces, { id: s.id }), height, padding });
}

/**
 * Home's grid: the first bots, then the groups (a build with the new Spaces: the one Space card; else each group a bot of its own,
 * GROUPS_ON_HOME of them), then Make a bot.
 */
/** Built-ins with a look of their own, on Home's grid beside the first three wherever they are set up (docs/oracle.md, docs/mail.md). */
const FEATURED: readonly string[] = ["oracle", "mail"];

/** The bots Home's grid draws: the first three, then the Oracle and the mail bot. */
export function homeShown(ctx: BotsCtx): LiveBot[] {
  const first = ctx.live.bots.slice(0, 3);
  return [...first, ...ctx.live.bots.filter((b) => b.builtin && FEATURED.includes(b.slug) && !first.includes(b))];
}

export function tiles(ctx: BotsCtx, columns: number, height: number, padding: number, notes?: NotesStats, spacesIn: Space[] = [], planLine = ""): Node {
  const shown = homeShown(ctx);
  // Plan Ease's tile says the one thing that matters next, as its page does (botsBots/planDay.ts), when it isn't busy with something.
  const idleLine = (b: LiveBot, client: BotsCtx["client"]) => (b.slug === "plan" && planLine && !b.working ? planLine : idleLineOf(b, client));
  // Spaces switched off: no Space card and no group tiles, whatever was read (kit hasSpaces).
  const groups = hasSpaces(ctx) ? spacesIn : [];
  const groupsShown = groups.slice(0, GROUPS_ON_HOME);
  const gap = columns === 4 ? 14 : 12;
  const withNotes = hasNotes(ctx);
  if (canMove(ctx)) {
    const strip = withNotes && canStrip(ctx) ? notesTileSpec(ctx, notes) : undefined;
    // Now and then an idle bot does something of his own (a sneeze, a hiccup…): the catalog's, for a build that plays them.
    const surprises = homeSurprises(ctx);
    // A double tap on a bot's own tile is a voice chat with that bot (Home's thought, canVoice); groups and Make a bot have none.
    const talk = canHomeThought(ctx) && canVoice(ctx);
    const living = botTiles([
      ...shown.map((b) => ({
        ...botTileSpec(b, { idle: idleLine(b, ctx.client), onPress: botRoute(b.slug) }), ...(talk ? { doubleTap: tileVoice(ctx, b.slug) } : {}),
        // The Oracle wears one of its two characters (screens/bots/oraclePage.ts); the mail bot, the postie filing letters (mailPage.ts).
        ...(b.slug === "oracle" && b.builtin ? oracleTileLook(ctx) : b.slug === "mail" && b.builtin ? mailTileLook(ctx) : {}),
      })),
      ...(canSpaces2(ctx) ? (groups.length ? [spaceCardSpec(groups)] : []) : groupsShown.map(groupTileSpec)),
      makeTileSpec(open(SCREENS.make)),
    ], { columns, height, padding, gap, ...(strip ? { strip, stripHeight: notesStripHeight(ctx) } : {}), ...(surprises ? { surprises } : {}) });
    return withNotes && !strip ? col([living, notesStrip(ctx, notes)], { gap }) : living;
  }
  const still = grid([
    ...shown.map((b) => botTile(b, { idle: idleLine(b, ctx.client), onPress: botRoute(b.slug), height, padding })),
    ...groupsShown.map((s) => groupTile(s, height, padding)),
    makeBotTile({ onPress: open(SCREENS.make), height, padding }),
  ], columns, gap);
  return withNotes ? col([still, notesStrip(ctx, notes)], { gap }) : still;
}

/**
 * The bots Home's grid does not draw (the Travel bot, the ones they made): one chip each, so every bot has a way in on the phone. The
 * window lists them all in its sidebar.
 */
export function moreBots(ctx: BotsCtx): Node[] {
  const shown = new Set(homeShown(ctx).map((b) => b.slug));
  const rest = ctx.live.bots.filter((b) => !shown.has(b.slug));
  if (!rest.length) return [];
  return [col([
    sectionLabel("More bots"),
    row(rest.map((b) => labelled(botChip(b, botRoute(b.slug)), `Open ${b.name}`)), { gap: 8, flexWrap: "wrap" }),
  ], { gap: 8 })];
}

/** What Home's state starts with: the first-arrival card's, when it is due. */
const homeState = (arrival: boolean): Record<string, unknown> => (arrival ? { ...ARRIVAL_STATE } : {});

/**
 * What Home's load reads beside the live state: the account's deletion date (accountGrace.ts), whether the notifications ask is due
 * (pushAsk.ts), and the About you card (firstRun/aboutCard.ts).
 */
export interface HomeMore { planLine?: string | undefined; ai?: AiConsent | undefined; leaving?: DeletionState | undefined; push?: boolean; about?: About | undefined; groups?: Space[] | undefined; notes?: NotesStats | undefined; botName?: string | undefined; back?: boolean; routines?: RoutinesData | undefined }

/**
 * Home's notices, one ask at a time: while the account has a deletion date, that card at the top and nothing else asks; else the AI
 * permission, once per wording (firstRun/aiConsentCard.ts: nothing is sent before a yes); else the first-arrival card when due; else the About you card when due (a few visits in); else, on a phone, the notifications ask once
 * something is working or needs them (its header reads the phone's answer). `state` is what the page starts with.
 */
export function homeNotices(ctx: BotsCtx, arrival: boolean, more: HomeMore) {
  const leaving = leavingCard(ctx, more.leaving);
  const ai = !leaving.length && aiConsentDue(more.ai);
  const firstRun = arrival && !leaving.length && !ai;
  const about = !leaving.length && !ai && !firstRun && more.about?.due === true;
  const push = !leaving.length && !ai && !firstRun && !about && pushAskDue(ctx, more.push === true);
  return {
    state: { ...homeState(firstRun), ...(ai ? AI_CONSENT_STATE : {}), ...(push ? PUSH_STATE : {}), ...(about ? aboutState(more.about) : {}) },
    head: (n: Node): Node => (push ? withPushCheck(ctx, n) : n),
    // The AI permission rides with the About card's place on the page: one overlay at a time, and never both.
    leaving, arrival: firstRun, about: ai ? aiConsentCard(ctx, more.ai) : about ? aboutCard(ctx, more.about) : [], push: push ? pushAskCard(ctx, true) : [],
  };
}

/**
 * Home's header: the Tailzu mark and the quiet buttons, then the greeting, small ("Good evening, Aanya"), and the old
 * app's time-aware line under it, big and bold ("Anything to write up before the day ends?"; its own "Good evening."
 * dropped, the night's line whole; Hinglish through i18n's Home seeds), with room around them: on the phone it owns
 * about the top third of the first screen. Where the build draws it alive (canHead): the line writes itself in with
 * Keylessbord's caret, once per app open and part of the day; the mark lives (its eyes on the finger, a dot lit in each
 * working bot's colour; a tap opens Ask); and once the header has scrolled away, a compact bar (the mark, "Your bots")
 * takes the top, until the page is back at its top (`pinned`). Else the same header, still.
 */
export function homeHead(ctx: BotsCtx): { head: Node; pinned: Node[] } {
  const desk = ctx.client === "desktop";
  const name = firstName(ctx);
  const greet = name ? `${ctx.live.greeting}, ${name}` : ctx.live.greeting;
  const part = dayPart(ctx.tzOffsetMinutes, ctx.live.now);
  const line = homeDayLine(part, (ctx.live.now + ctx.tzOffsetMinutes * 60_000) / 86_400_000).en;
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
export function homePull(ctx: BotsCtx): PageOpts["pullBot"] {
  return { top: true, bottom: true, items: [...ctx.live.needs.map((n) => n.id), ...ctx.live.working.map((w) => w.id), ...ctx.live.bots.map((b) => `bot:${b.slug}`)] };
}

export function homePhone(ctx: BotsCtx, arrival = false, more: HomeMore = {}) {
  const first = ctx.live.needs[0];
  const { head, pinned } = homeHead(ctx);
  const n = homeNotices(ctx, arrival, more);
  const home: Node[] = [
    n.head(head),
    ...n.leaving,
    ...n.about,
    ...(hasOutbox(ctx) ? outboxCard(ctx) : []),
    ...(first ? [needsCard(first)] : []),
    ...n.push,
    tiles(ctx, 2, 132, 16, more.notes, more.groups, more.planLine),
    // Every bot past the first three, a chip each: the Oracle, the mail bot and their own are never out of reach.
    ...moreBots(ctx),
    ...routinesRow(ctx, more.routines),
  ];
  // Ask any bot: his thought where the build draws it (a tiny bot walking the foot of Home), else the ask bar.
  const thought = canHomeThought(ctx);
  const footer = [thought ? homeThought(ctx) : askBar("phone", { ctx })];
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
    tab: "bots", title: "Your bots", state: { ...n.state, ...(intro ? { helloSeen: false, helloGone: false } : {}), ...(thought ? HOME_THOUGHT_STATE : {}) },
    ...(thought ? { talkTo: homeTalkTo(ctx) } : {}),
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

/**
 * The bot waving hello by the name they gave it (else X0's), while Home's welcome is due: the first visit after onboarding,
 * or (`more.back`) a visit after a long time away or the first on a newer Home. `walkOut`: on the phone's welcome stage, once
 * he has waved (helloSeen) he turns and walks off the side (BlipWalkOut; a build without it slides him off, MorphOut), and
 * his words go as he turns. A card that is due comes in at the same moment, over him walking off.
 */
export function hello(ctx: BotsCtx, more: HomeMore, o: { walkOut?: boolean } = {}): Node {
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

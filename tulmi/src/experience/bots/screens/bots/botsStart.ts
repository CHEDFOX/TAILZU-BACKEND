/**
 * START SOMETHING: THE BOTS, AS A LAUNCHER (`bots.start`, opened by the "+" on Activities).
 *
 * Once nobody has to pick a bot to get an answer — you say what you need in Talk and the door routes it — a list of
 * bots has exactly one job left: showing someone what this app can do, at the moment they are looking to begin. That
 * is a PICKER, not a home, and it changes what the list should be:
 *
 *   ORDERED BY KIND, NOT BY STATE. A resident list you see every day should lead with what needs you; a list you open
 *   to EXPLORE should name the kinds, because you are browsing rather than returning. This is the one place in the app
 *   where a taxonomy earns its keep.
 *
 *   EVERY GROUP SAYS WHAT IT IS FOR. "Making — describe it, and they build it" answers the week-one question that a
 *   grid of ten heads never did. This is where someone learns what they have.
 *
 *   ONE BOT A ROW, ALIVE. Each is Home's living tile (BotTiles): the bot playing on its fabric, looking round when another
 *   is tapped, now and then a gesture of his own; then its name, and a short line on what it can do — taller than Home's
 *   rows, because here the line is the point. A build that cannot draw the living tiles gets the same rows, still.
 *
 * KEYLESSBORD IS NOT A TILE, and that is deliberate. It is a keyboard: you use it by typing in other apps, never by
 * starting something here, and its pages are settings-shaped (voices, words, haptics, history). A tile in a "start
 * something" grid would be a promise it does not keep — so it gets one plain line at the foot, which keeps every one
 * of its pages reachable without lying about what it is.
 */
import type { BotTileSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, type LiveBot, page, col, row, text, meta, grow, C, open, SCREENS, sectionLabel, botAvatar, icon,
  grid, labelled, title as pageTitle, botRoute, canMove, botTiles, botTileSpec, makeTileSpec, botTile, makeBotTile, homeSurprises,
} from "../../kit.js";
import { oracleTileLook } from "./oraclePage.js";
import { mailTileLook } from "./mailPage.js";
import { cinemaTileLook } from "./cinemaPage.js";
import { botsMark } from "../../glyphs.js";
import { idleLine } from "../shell/parts.js";

/**
 * HOW THE BOTS ARE GROUPED. Every built-in belongs to exactly one group; `tests/bots-start.test.ts` holds that, so a
 * built-in added later cannot quietly go missing from the only place people browse.
 */
export const BOT_GROUPS: ReadonlyArray<{ id: string; title: string; line: string; slugs: readonly string[] }> = [
  { id: "day", title: "Your day", line: "What's on, and what's ahead", slugs: ["plan", "oracle"] },
  { id: "said", title: "Said and written", line: "Your meetings, your mail, and what was agreed", slugs: ["meet", "mail", "notes"] },
  { id: "making", title: "Making", line: "Describe it, and they build it", slugs: ["code", "cinema"] },
  { id: "world", title: "Out in the world", line: "Where you are going, and how you'll speak there", slugs: ["travel", "lingo"] },
];

/**
 * Built-ins that are deliberately not tiles here. `talk` is the tab you came from; `keybot` is a keyboard, and gets
 * its own line at the foot (see this file's head).
 */
export const NOT_TILED: readonly string[] = ["talk", "keybot"];

/** Every slug a group claims, for the check that nothing is lost. */
export const GROUPED_SLUGS: readonly string[] = BOT_GROUPS.flatMap((g) => g.slugs);

/**
 * WHAT EACH CAN DO, IN A LINE THAT FITS TWO LINES OF A TILE. The built-ins' own words for this page (their `purpose` is
 * written for the door that routes to them, and runs longer); a bot someone made says its purpose, cut to fit.
 */
export const START_LINES: Readonly<Record<string, string>> = {
  plan: "Turns a goal into timed steps and puts them on your calendar.",
  oracle: "Reads your birth chart to answer about love, work and timing.",
  meet: "Joins your calls, takes the notes and turns what's agreed into to-dos.",
  mail: "Sorts your business email and drafts replies in your voice.",
  notes: "Keeps what was said in your meetings, and what was agreed.",
  code: "Reads your projects, answers about the code, ships changes as PRs.",
  cinema: "Makes films shot by shot, and pictures: posters, portraits, logos.",
  travel: "Plans trips: routes, stays and timings, with sources.",
  lingo: "Teaches a language by talking, and brings words back before you forget.",
};
const LINE_MAX = 90;

export function startLine(b: LiveBot, ctx: BotsCtx): string {
  const own = b.builtin ? START_LINES[b.slug] : undefined;
  if (own) return own;
  const p = (b.purpose || "").replace(/\s+/g, " ").trim();
  if (!p) return idleLine(b, ctx.client);
  if (p.length <= LINE_MAX) return p;
  const cut = p.slice(0, LINE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:\s]+$/, "")}…`;
}

/** How tall a row is: Home's rows are 104; these carry the name and what the bot can do, with room round them. */
export const START_TILE_HEIGHT = 184;

/** One bot as a living tile: its name and what it can do (always as a description here, never a status). */
function tileSpec(b: LiveBot, ctx: BotsCtx): BotTileSpec {
  return {
    ...botTileSpec({ ...b, working: false, needs: 0 }, { idle: startLine(b, ctx), onPress: botRoute(b.slug) }),
    state: "idle",
    // The Oracle wears its character, the mail bot the postie, the cinema bot the director, as on Home.
    ...(b.builtin && b.slug === "oracle" ? oracleTileLook(ctx) : b.builtin && b.slug === "mail" ? mailTileLook(ctx) : b.builtin && b.slug === "cinema" ? cinemaTileLook(ctx) : {}),
  };
}

/** A group's bots, one a row: alive where the build draws it, else the same rows still. `make` adds Make a bot at the end. */
export function groupRow(ctx: BotsCtx, bots: LiveBot[], o: { make?: boolean } = {}): Node {
  const height = START_TILE_HEIGHT, padding = 22, gap = 14;
  if (canMove(ctx)) {
    const surprises = homeSurprises(ctx);
    return botTiles([...bots.map((b) => tileSpec(b, ctx)), ...(o.make ? [{ ...makeTileSpec(open(SCREENS.make)), sub: "One sentence is enough" }] : [])],
      { columns: 1, height, padding, gap, ...(surprises ? { surprises } : {}) });
  }
  return grid([
    ...bots.map((b) => botTile({ ...b, working: false, needs: 0 }, { idle: startLine(b, ctx), onPress: botRoute(b.slug), height, padding })),
    ...(o.make ? [makeBotTile({ onPress: open(SCREENS.make), height, padding })] : []),
  ], 1, gap);
}

/** A group and its line, with its bots under it. Nothing for a group whose bots this person does not have. */
function groupBlock(ctx: BotsCtx, g: (typeof BOT_GROUPS)[number], have: Map<string, LiveBot>): Node[] {
  const bots = g.slugs.map((s) => have.get(s)).filter((b): b is LiveBot => !!b);
  if (!bots.length) return [];
  return [col([
    col([sectionLabel(g.title), meta(g.line, { size: 12, lineHeight: 16 })], { gap: 2 }),
    groupRow(ctx, bots),
  ], { gap: 10 })];
}

export function botsStartPage(ctx: BotsCtx): ReturnType<typeof page> {
  const have = new Map(ctx.live.bots.map((b) => [b.slug, b]));
  // Theirs: anything they made, plus any built-in no group claims — so a built-in added later is still reachable here
  // even before someone puts it in a group (the test says to put it in one).
  const mine = ctx.live.bots.filter((b) => !GROUPED_SLUGS.includes(b.slug) && !NOT_TILED.includes(b.slug));
  const keybot = have.get("keybot");
  return page(ctx, {
    back: true, title: "Start something", nav: "bots",
    body: [
      // The mark is the one the Bots tab used to wear: four dots, a working bot's breathing in its colour. It still
      // means "your bots", which is what this page is.
      row([botsMark(ctx.live.tab, 30), col([pageTitle("Start something"), meta("Or just say it in Talk — whichever bot it belongs to answers.", { size: 13, lineHeight: 18 })], { gap: 6, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" }),
      ...BOT_GROUPS.flatMap((g) => groupBlock(ctx, g, have)),
      col([
        col([sectionLabel("Yours"), meta(mine.length ? "The ones you made" : "Nothing yet — one sentence is enough", { size: 12, lineHeight: 16 })], { gap: 2 }),
        groupRow(ctx, mine, { make: true }),
      ], { gap: 10 }),
      // The keyboard: one line, because it is not something you start (see this file's head).
      ...(keybot ? [labelled(row([
        botAvatar(keybot, 26),
        col([text(keybot.name, { size: 14, weight: 500, lineHeight: 19 }), meta(idleLine(keybot, ctx.client), { size: 12, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        icon("chevron", { size: 16, color: C.meta }),
      ], {
        gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line,
      }, botRoute(keybot.slug)), `Open ${keybot.name}`)] : []),
      row([grow(), labelled(text("Done", { size: 14, weight: 500, lineHeight: 19, color: C.meta }), "Close"), grow()], { paddingTop: 4 }),
    ],
    gap: 22,
  });
}

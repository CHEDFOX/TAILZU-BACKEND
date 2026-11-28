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
 * KEYLESSBORD IS A TILE LIKE THE REST, in a group of its own ("Wherever you type"). It was once a plain line at the foot,
 * because a keyboard is used by typing in other apps rather than started here; but a card that looked unlike every
 * other read as an afterthought. Its line says what it is and where it works ("in any app"), so the tile promises
 * nothing it does not do, and a tap opens its pages (voices, words, haptics, history) as before.
 */
import { filmsOn } from "../../../../cinema/films.js";
import type { BotTileSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, type LiveBot, page, col, row, text, meta, grow, C, open, SCREENS, sectionLabel,
  grid, labelled, title as pageTitle, botRoute, canMove, canStage, botTiles, botTileSpec, makeTileSpec, botTile, makeBotTile, homeSurprises,
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
  { id: "said", title: "Said and written", line: "Your mail, your meetings, and what was agreed", slugs: ["mail"] },
  { id: "making", title: "Making", line: "Describe it, and they build it", slugs: ["code", "cinema"] },
  { id: "world", title: "Out in the world", line: "Where you are going, and how you'll speak there", slugs: ["travel", "lingo"] },
  { id: "keys", title: "Wherever you type", line: "Your own voice, in every app you write in", slugs: ["keybot"] },
];

/**
 * Built-ins that are deliberately not tiles here. `talk` is the tab you came from; `meet` is part of Sribbu (the mail
 * bot's tile: screens/bots/sribbu.ts).
 */
export const NOT_TILED: readonly string[] = ["talk", "meet"];

/** Every slug a group claims, for the check that nothing is lost. */
export const GROUPED_SLUGS: readonly string[] = BOT_GROUPS.flatMap((g) => g.slugs);

/**
 * WHAT EACH IS, AND WHAT IT DOES, IN THE FEWEST WORDS: first what the bot actually is ("A note-taker that joins your
 * calls"), then what it does for you, in plain words anyone reads at a glance. Three lines of a tile at most. The built-ins' own words for this page (their
 * `purpose` is written for the door that routes to them, and runs longer); a bot someone made says its purpose, cut to fit.
 */
export const START_LINES: Readonly<Record<string, string>> = {
  plan: "A planner that won't let you quit. Give it a goal; it maps the steps, books the time and chases you to the end.",
  oracle: "A divine being that sees the other side of cause and effect. Ask about love, work or timing; it shows you why.",
  mail: "A scribe for your working life. It answers your inbox, sits in your calls and remembers every word agreed.",
  code: "A developer on call. Say what's broken; it reads your code, fixes it and sends you the change to approve.",
  cinema: "A film studio in your pocket. Describe a video or a poster; it writes, shoots, edits and hands it over done.",
  travel: "A travel planner that does the legwork. Say where and when; it builds the route, the stays and the timings.",
  keybot: "A keyboard that writes like you. Say a rough thought in any app; it types the message you meant to send.",
  lingo: "A language tutor you talk to. It teaches by conversation and brings each word back just before you'd forget it.",
};
const LINE_MAX = 116;

/**
 * KUTT WHILE FILMS ARE OFF (CINEMA_FILMS, cinema/films.ts): a picture of the idea, then the picture built in 3D. The film line above
 * comes back with films; the card never promises what the page cannot make.
 */
export const CINEMA_3D_LINE = "A 3D studio in your pocket. Describe an idea; you see it as a picture, then it's built in 3D from every side.";

export function startLine(b: LiveBot, ctx: BotsCtx): string {
  const own = b.builtin ? (b.slug === "cinema" && !filmsOn() ? CINEMA_3D_LINE : START_LINES[b.slug]) : undefined;
  if (own) return own;
  const p = (b.purpose || "").replace(/\s+/g, " ").trim();
  if (!p) return idleLine(b, ctx.client);
  if (p.length <= LINE_MAX) return p;
  const cut = p.slice(0, LINE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:\s]+$/, "")}…`;
}

/** How tall a row is: Home's rows are 104; these carry the name and what the bot can do, with room round them. */
export const START_TILE_HEIGHT = 184;

/**
 * A build that can (BotTilesStage): the bot keeps the top of the card as on Home, and the card grows DOWN for his name
 * and what he can do, which start under him and may take three lines. The stage is the bot's full size (core.ts: his
 * size tops out with a floor of about 80 px); the rest is the words and the padding under them.
 */
export const START_STAGE = 100;
export const START_SUB_LINES = 3;
/** The room between the name and what the bot is, so the two read as a title and its line. */
export const START_NAME_GAP = 12;
export const START_STAGE_HEIGHT = START_STAGE + 21 + START_NAME_GAP + START_SUB_LINES * 16 + 24;

/** One bot as a living tile: its name and what it can do (always as a description here, never a status). */
function tileSpec(b: LiveBot, ctx: BotsCtx): BotTileSpec {
  return {
    ...botTileSpec({ ...b, working: false, needs: 0 }, { idle: startLine(b, ctx), onPress: botRoute(b.slug) }),
    state: "idle",
    // Chamen wears its character, the mail bot the postie, the cinema bot the director, as on Home.
    ...(b.builtin && b.slug === "oracle" ? oracleTileLook(ctx) : b.builtin && b.slug === "mail" ? mailTileLook(ctx) : b.builtin && b.slug === "cinema" ? cinemaTileLook(ctx) : {}),
  };
}

/** A group's bots, one a row: alive where the build draws it, else the same rows still. `make` adds Make a bot at the end. */
export function groupRow(ctx: BotsCtx, bots: LiveBot[], o: { make?: boolean } = {}): Node {
  const height = START_TILE_HEIGHT, padding = 22, gap = 14;
  if (canMove(ctx)) {
    const surprises = homeSurprises(ctx);
    return botTiles([...bots.map((b) => tileSpec(b, ctx)), ...(o.make ? [{ ...makeTileSpec(open(SCREENS.make)), sub: "One sentence is enough" }] : [])],
      canStage(ctx)
        ? { columns: 1, height: START_STAGE_HEIGHT, padding, gap, stage: START_STAGE, subLines: START_SUB_LINES, nameGap: START_NAME_GAP, ...(surprises ? { surprises } : {}) }
        : { columns: 1, height, padding, gap, ...(surprises ? { surprises } : {}) });
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
      row([grow(), labelled(text("Done", { size: 14, weight: 500, lineHeight: 19, color: C.meta }), "Close"), grow()], { paddingTop: 4 }),
    ],
    gap: 22,
  });
}

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
 *   TWO OR FEWER SIT IN A ROW OF TWO; MORE THAN TWO SCROLL SIDEWAYS. A build that cannot scroll sideways gets the row
 *   of two either way, so the fallback is the small shape and needed no design of its own (docs/renderer.md § 4).
 *
 * KEYLESSBORD IS NOT A TILE, and that is deliberate. It is a keyboard: you use it by typing in other apps, never by
 * starting something here, and its pages are settings-shaped (voices, words, haptics, history). A tile in a "start
 * something" grid would be a promise it does not keep — so it gets one plain line at the foot, which keeps every one
 * of its pages reachable without lying about what it is.
 */
import type { Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, type LiveBot, page, col, row, text, meta, grow, box, C, open, SCREENS, sectionLabel, botAvatar, icon,
  canScrollX, grid, scrollRow, labelled, title as pageTitle, botRoute, RADIUS,
} from "../../kit.js";
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

/** One bot, as something to start: its head, its name, and what it is for in the app's own words. */
function tile(b: LiveBot, ctx: BotsCtx): Node {
  return col([
    botAvatar(b, 34),
    col([
      text(b.name, { size: 14, weight: 600, lineHeight: 19, lines: 1 }),
      meta(idleLine(b, ctx.client), { size: 12, lines: 2 }),
    ], { gap: 2 }),
  ], {
    gap: 10, padding: 14, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line, minWidth: 0,
  }, botRoute(b.slug));
}

/** The one that makes a new bot, in the same shape as the rest so it reads as one of the things you can start. */
function makeTile(): Node {
  return col([
    box([icon("plus", { size: 20, color: C.ink })], {
      width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.outline, borderStyle: "dashed",
      alignItems: "center", justifyContent: "center",
    }),
    col([
      text("Make a bot", { size: 14, weight: 600, lineHeight: 19 }),
      meta("One sentence is enough", { size: 12, lines: 2 }),
    ], { gap: 2 }),
  ], {
    gap: 10, padding: 14, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.outline, borderStyle: "dashed", minWidth: 0,
  }, open(SCREENS.make));
}

/** Two or fewer in a row of two; more than two scroll sideways (and a build that cannot, gets the row of two). */
export function groupRow(ctx: BotsCtx, tiles: Node[]): Node {
  if (tiles.length > 2 && canScrollX(ctx)) {
    return scrollRow(tiles.map((t) => box([t], { width: 158, flexShrink: 0 })), { gap: 10 });
  }
  return grid(tiles, 2, 10);
}

/** A group and its line, with its bots under it. Nothing for a group whose bots this person does not have. */
function groupBlock(ctx: BotsCtx, g: (typeof BOT_GROUPS)[number], have: Map<string, LiveBot>): Node[] {
  const tiles = g.slugs.map((s) => have.get(s)).filter((b): b is LiveBot => !!b).map((b) => tile(b, ctx));
  if (!tiles.length) return [];
  return [col([
    col([sectionLabel(g.title), meta(g.line, { size: 12, lineHeight: 16 })], { gap: 2 }),
    groupRow(ctx, tiles),
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
        groupRow(ctx, [...mine.map((b) => tile(b, ctx)), makeTile()]),
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

/**
 * THE ORACLE'S PAGE (src/oracle, docs/oracle.md): the chat, and nothing in its way. Its bot page and its chat are this one page.
 *
 *   the head       back, the Oracle, its line, and (once there are turns) one of its two characters on a stage of his own: the Wanderer (undyed
 *                  camel wool, a staff and a lantern) or the Seer (midnight cloth, a crystal and cards), one on one day and the other on the next
 *   the cards      what the Oracle needs, asked one card after another over the page (oracleCards.ts): when they were born, where, and their
 *                  name and gender if the app does not have them. Once kept, the sky is one quiet line with Change, which opens the cards again.
 *                  Birth details typed into the chat are read and kept too
 *   the chat       the turns; before the first, the day's character big on a card of his own, and a few first questions to start from
 *   the ask bar    the bots' own (parts.ts chatBar): the words stream in as the Oracle writes them
 */
import type { BotTileSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, chip, meta, quietButton, primaryButton, C,
  botBuddy, canBuddy, canMoments, botMoment, botAvatar, emptyState,
} from "../../kit.js";
import type { About } from "../firstRun/parts.js";
import { cardsDue, cardsState, openCards, oracleCards } from "./oracleCards.js";
import { type BotPageData, ANSWERING, askBot, chatBar, chatTurns, isDesk, lookOf } from "./parts.js";

/** What the page reads of the Oracle's own store (GET /v1/oracle/sky): the sky once it is whole, the when as soon as it is kept. */
export interface OracleSkyView { sky: { place: string } | null; line: string | null; when?: { date: string; time: string; line: string } | null }
/** And the person's name and gender (the About you card's read, GET /v1/bots/first-run/about). */
export type OraclePageData = BotPageData & { sky?: OracleSkyView; about?: About };
const STARTERS = [
  "What is this year asking of me?",
  "When will I meet the right person?",
  "Which work am I built for?",
  "Pull a tarot card for me",
];
/** Each character's small story, from the catalog (shared/bots/looks.json): he looks up at the sky, or sweeps the mist off the crystal. */
const CHARACTERS = [
  { avatar: "wanderer", moment: "w.lookup" },
  { avatar: "seer", moment: "s.crystal" },
] as const;

/** One character a visit: the Wanderer on one day, the Seer on the next (the same for a whole day, so the page does not flicker between them). */
export function characterOf(ctx: BotsCtx): (typeof CHARACTERS)[number] {
  const day = Math.floor((ctx.live.now + ctx.tzOffsetMinutes * 60_000) / 86_400_000);
  return CHARACTERS[day % 2]!;
}

/** The Oracle's tile wears the day's character and plays his small story once, for a build that plays looks; else it is a plain tile. Home's grid
 *  draws the first three bots (the Oracle is a chip under it, "More bots", and in the window's sidebar), so the tile shows only once the Oracle
 *  is given one of the three places (docs/oracle.md section 3). */
export function oracleTileLook(ctx: BotsCtx): Pick<BotTileSpec, "avatar" | "moment" | "momentMode"> {
  if (!canMoments(ctx)) return {};
  const c = characterOf(ctx);
  const m = botMoment(ctx, c.moment, "once");
  return { avatar: c.avatar, ...(m.moment ? { moment: m.moment, ...(m.momentMode ? { momentMode: m.momentMode } : {}) } : {}) };
}

function character(ctx: BotsCtx, color: string): Node[] {
  if (!canBuddy(ctx)) return [];
  const c = characterOf(ctx);
  const desk = isDesk(ctx);
  return [botBuddy({
    kind: "custom", color, life: "page.oracle", width: desk ? 150 : 84, height: desk ? 60 : 48, size: desk ? 38 : 32, state: "idle",
    avatar: c.avatar, lookTo: "down", thinkWhen: ANSWERING, ...botMoment(ctx, c.moment),
  })];
}

/**
 * Before the first question: the day's character, big, on a card of his own (a build that cannot draw him: Blip's empty state). The same life
 * as the head's, and the head shows him only once there are turns, so one character is on the page and the first answer moves him up there.
 */
function stage(ctx: BotsCtx, color: string, title: string, line: string, add = false): Node {
  if (!canBuddy(ctx)) return emptyState({ pose: "listen", title, body: line, ...(add ? { action: { label: "Add your birth details", onPress: openCards() } } : {}) });
  const c = characterOf(ctx);
  const desk = isDesk(ctx);
  return card([
    botBuddy({
      kind: "custom", color, life: "page.oracle", width: desk ? 260 : 220, height: desk ? 170 : 150, size: desk ? 110 : 96, state: "idle",
      avatar: c.avatar, lookTo: "down", thinkWhen: ANSWERING, ...botMoment(ctx, c.moment),
    }),
    text(title, { size: 16, weight: 600, align: "center" }),
    text(line, { size: 13, color: C.meta, align: "center", lineHeight: 18 }),
    ...(add ? [primaryButton("Add your birth details", openCards())] : []),
  ], { dashed: true, gap: 10, padding: 24, style: { alignItems: "center" } });
}

function skyLineRow(line: string): Node {
  return row([
    icon("spark", { size: 16, color: C.meta }),
    text(line, { size: 13, lineHeight: 18, color: C.grey70, lines: 1, style: { flexShrink: 1 } }),
    grow(),
    quietButton("Change", openCards(), { size: "md" }),
  ], { gap: 8, paddingVertical: 4 });
}

export function oraclePage(ctx: BotsCtx, d: OraclePageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const turns = d.turns ?? [];
  const known = d.sky?.sky ? d.sky.line ?? d.sky.sky.place : null;
  const name = col([
    text(bot.name, { size: isDesk(ctx) ? 17 : 19, weight: 600, lineHeight: isDesk(ctx) ? 22 : 24 }),
    meta(known ? "Reads your sky, and the world's oldest ways of asking" : "Tell it when and where you were born, then ask", { size: 12, lines: 1 }),
  ], { gap: 1, flexShrink: 1 });
  const up = turns.length ? character(ctx, look.color) : [];       // before the first question he is on his stage below
  const head = isDesk(ctx)
    ? row([botAvatar(look, 30), name, grow(), ...up], { gap: 10 })
    : row([
      labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
      name, grow(), ...up,
    ], { gap: 6 });

  const sky: Node[] = known ? [skyLineRow(known)] : [];
  // The cards over the page while something is owed, with the day's character on their stage.
  const c = characterOf(ctx);
  const cards = oracleCards(ctx, d, { color: look.color, ...(canMoments(ctx) ? { avatar: c.avatar, moment: botMoment(ctx, c.moment, "once") } : {}) });
  const talk: Node[] = turns.length
    ? chatTurns(ctx, bot, turns, { big: !isDesk(ctx), days: isDesk(ctx) || turns.length > 6 })
    : known
      ? [stage(ctx, look.color, "Ask the Oracle anything", "Love, work, money, health, timing, or a choice in front of you."),
        row(STARTERS.map((s) => chip(s, { onPress: askBot(bot.slug, s) })), { gap: 8, flexWrap: "wrap" })]
      : [stage(ctx, look.color, "Ask the Oracle anything", "It reads your sky, so first it needs to know when and where you were born.", true)];

  return page(ctx, {
    back: isDesk(ctx), title: bot.name, nav: bot.slug, ...(isDesk(ctx) ? { maxWidth: 720 } : {}),
    pullBot: { top: true, bottom: true, newAt: "bottom", ...(d.turns ? { items: d.turns.map((t) => t.id) } : {}) },
    body: [...cards, head, ...sky, ...talk],
    // Nothing to ask until the sky is kept: the Oracle reads nothing without it (and oracle/run.ts refuses too).
    footer: known ? [chatBar(ctx, bot.slug, bot.name, "Ask the Oracle…")] : [],
    gap: 18,
    ...(cardsDue(ctx, d) ? { state: cardsState(ctx, d) } : {}),
  });
}

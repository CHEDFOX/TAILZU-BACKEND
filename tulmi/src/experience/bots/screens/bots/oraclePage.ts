/**
 * THE ORACLE'S PAGE (src/oracle, docs/oracle.md): the chat, and nothing in its way. Its bot page and its chat are this one page.
 *
 *   the head       back, Chamen, its line, and (once there are turns) one of its two characters on a stage of his own: the Wanderer (undyed
 *                  camel wool, a staff and a lantern) or the Seer (midnight cloth, a crystal and cards), one on one day and the other on the next
 *   the cards      what Chamen needs, asked one card after another over the page (oracleCards.ts): when they were born (picked on wheels),
 *                  where, and their gender (the profile's already picked on their first chart; switched here, Chamen's alone)
 *   the stage      the day's character on a card of his own, with the person it reads for in a circle at its top left (a tap: the people
 *                  card, Yours and Shared with you) and a + at its top right (add someone: oraclePeople.ts). Before the first question it
 *                  says "Ask Chamen anything"; once they have asked, those words go and the card is shorter
 *   the chat       the turns, one chat whoever is picked (each question is read for the one picked when it is asked), and before the
 *                  first, a few first questions to start from
 *   the ask bar    the bots' own (parts.ts chatBar): the words stream in as Chamen writes them
 */
import type { BotTileSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, chip, meta, primaryButton, C,
  botBuddy, canBuddy, canMoments, botMoment, botAvatar, emptyState,
} from "../../kit.js";
import type { About } from "../firstRun/parts.js";
import type { CircleView } from "../../../../oracle/people.js";
import { cardsDue, cardsState, openCards, oracleCards } from "./oracleCards.js";
import { addCards, peopleCard, peopleState, personInitial, PP } from "./oraclePeople.js";
import { plusCircle } from "../spaces/start.js";
import { randomUUID } from "node:crypto";
import { type BotPageData, ANSWERING, askBot, chatBar, chatTurns, isDesk, lookOf } from "./parts.js";

/** What the page reads of Chamen's own store (GET /v1/oracle/sky): the sky once it is whole, the when as soon as it is kept. */
export interface OracleSkyView { sky: { place: string } | null; line: string | null; place?: string | null; when?: { date: string; time: string; line: string } | null }
/** And the person's name and gender (the About you card's read, GET /v1/bots/first-run/about). */
export type OraclePageData = BotPageData & { sky?: OracleSkyView; about?: About; circle?: CircleView };
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

/** Chamen's tile on Home's grid (beside the first three, shell/home.ts homeShown) wears the day's character and plays his small story once,
 *  for a build that plays looks; else it is a plain tile (docs/oracle.md section 3). */
export function oracleTileLook(ctx: BotsCtx): Pick<BotTileSpec, "avatar" | "moment" | "momentMode"> {
  if (!canMoments(ctx)) return {};
  const c = characterOf(ctx);
  const m = botMoment(ctx, c.moment, "once");
  return { avatar: c.avatar, ...(m.moment ? { moment: m.moment, ...(m.momentMode ? { momentMode: m.momentMode } : {}) } : {}) };
}

/**
 * THE STAGE: the day's character on a card of his own, with who Chamen reads for (a circle, top left: the people card) and a + (top right:
 * add someone). Before the first question it says what to ask about; once they have asked, the words go and the card is shorter.
 * A build that cannot draw him: Blip's empty state, under the same two buttons.
 */
function stage(ctx: BotsCtx, color: string, o: { asked: boolean; known: boolean; who: string }): Node {
  const desk = isDesk(ctx);
  const controls = row([
    labelled(box([personInitial(o.who, 44)], {}, { kind: "setState", path: PP.open, value: true } as never), `Reading for ${o.who}. Pick who to read for`),
    grow(),
    plusCircle({ kind: "setState", path: PP.add, value: true } as never, "Add someone to read for", 44),
  ], { alignItems: "center", alignSelf: "stretch" });
  const title = "Ask Chamen anything";
  const line = o.known ? "Love, work, money, health, timing, or a choice in front of you." : "It reads your sky, so first it needs to know when and where you were born.";
  if (!canBuddy(ctx)) {
    return col([controls, ...(o.asked ? [] : [emptyState({ pose: "listen", title, body: line, ...(o.known ? {} : { action: { label: "Add your birth details", onPress: openCards() } }) })])], { gap: 8 });
  }
  const c = characterOf(ctx);
  const big = !o.asked;
  return card([
    controls,
    botBuddy({
      kind: "custom", color, life: "page.oracle", width: desk ? 260 : 220, height: big ? (desk ? 150 : 130) : 72, size: big ? (desk ? 110 : 96) : 52, state: "idle",
      avatar: c.avatar, lookTo: "down", thinkWhen: ANSWERING, ...botMoment(ctx, c.moment),
    }),
    ...(big ? [text(title, { size: 16, weight: 600, align: "center" }), text(line, { size: 13, color: C.meta, align: "center", lineHeight: 18 })] : []),
    ...(big && !o.known ? [primaryButton("Add your birth details", openCards())] : []),
  ], { dashed: true, gap: big ? 10 : 2, padding: big ? 18 : 12, style: { alignItems: "center" } });
}

export function oraclePage(ctx: BotsCtx, d: OraclePageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const turns = d.turns ?? [];
  const known = d.sky?.sky ? d.sky.line ?? d.sky.sky.place : null;
  const circle = d.circle;
  const active = circle ? (circle.active === "me" ? circle.me : [...circle.others, ...circle.shared].find((p) => p.ref === circle.active) ?? circle.me) : null;
  const who = active ? (active.ref === "me" ? "you" : active.name) : "you";
  const name = col([
    text(bot.name, { size: isDesk(ctx) ? 17 : 19, weight: 600, lineHeight: isDesk(ctx) ? 22 : 24 }),
    meta(known ? `Reading for ${who}` : "Tell it when and where you were born, then ask", { size: 12, lines: 1 }),
  ], { gap: 1, flexShrink: 1 });
  const head = isDesk(ctx)
    ? row([botAvatar(look, 30), name, grow()], { gap: 10 })
    : row([
      labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
      name, grow(),
    ], { gap: 6 });
  // The cards over the page while something is owed, with the day's character on their stage.
  const c = characterOf(ctx);
  const cards = oracleCards(ctx, d, { color: look.color, ...(canMoments(ctx) ? { avatar: c.avatar, moment: botMoment(ctx, c.moment, "once") } : {}) });
  const stageLook = { color: look.color, ...(canMoments(ctx) ? { avatar: c.avatar } : {}) };
  const people = circle && known ? [peopleCard(ctx, circle, stageLook), addCards(ctx, stageLook)] : [];
  const talk: Node[] = [
    stage(ctx, look.color, { asked: turns.length > 0, known: !!known, who: active?.name ?? "You" }),
    ...(turns.length
      ? chatTurns(ctx, bot, turns, { big: !isDesk(ctx), days: isDesk(ctx) || turns.length > 6 })
      : known ? [row(STARTERS.map((s) => chip(s, { onPress: askBot(bot.slug, s) })), { gap: 8, flexWrap: "wrap" })] : []),
  ];

  return page(ctx, {
    back: isDesk(ctx), title: bot.name, nav: bot.slug, ...(isDesk(ctx) ? { maxWidth: 720 } : {}),
    pullBot: { top: true, bottom: true, newAt: "bottom", ...(d.turns ? { items: d.turns.map((t) => t.id) } : {}) },
    body: [...cards, ...people, head, ...talk],
    // Nothing to ask until the sky is kept: Chamen reads nothing without it (and oracle/run.ts refuses too).
    footer: known ? [chatBar(ctx, bot.slug, bot.name, "Ask Chamen…")] : [],
    gap: 18,
    state: { ...peopleState(randomUUID()), ...(cardsDue(ctx, d) ? cardsState(ctx, d) : {}) },
  });
}

/**
 * THE MAIL BOT'S PAGE (src/mail, docs/mail.md section 9): bots.bot with slug "mail". Its chat is the usual bots.chat; this is its mail.
 *
 *   the head       back, the bot's name, the business's address and how it answers, and its settings; a chip per business when there are several
 *   the cards      the set-up, over the page, while it is due (mailCards.ts): the business, its domain's records, how it answers, what it knows
 *   needs you      what waits for a person, most important first: a message the AI thinks a person should answer, then drafts, then replies about
 *                  to go by themselves. Each opens its reply (mailScreens.ts): the message, the draft, Send
 *   answered       the latest replies that went
 *   filed          the latest messages that needed no answer (newsletters, notices, robots), with why
 *   the ask bar    the bots' own (parts.ts chatBar): "What needs me today?" goes to the mail bot's chat, which reads the same mail (mail/digest.ts)
 *
 * Before anything arrives, one line says that mail comes once the domain points here, with the records a tap away.
 */
import type { Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, chip, meta, notice, quietButton, primaryButton, C, botAvatar, listCard,
  sectionLabel, open, SCREENS,
} from "../../kit.js";
import { addBusiness, mailCards, mailCardsDue, mailCardsState } from "./mailCards.js";
import { MAIL_SLUG, MODE_WORDS, type MailData, type MailRunView, runRow, shownBusiness } from "./mailParts.js";
import { type BotPageData, askBot, chatBar, isDesk, lookOf } from "./parts.js";

export type MailPageData = BotPageData & { mail?: MailData };

const STARTERS = ["What needs me today?", "Summarize this week's mail", "Any unhappy customers?"];
const SHOWN = 5;

/** One number of the last 24 hours, with its word under it. */
function stat(n: number, label: string): Node {
  return col([
    text(String(n), { size: 22, weight: 600, lineHeight: 26, tracking: -0.3 }),
    text(label, { size: 12, color: C.meta, lineHeight: 16 }),
  ], { gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0 });
}

/** A section of messages: its label, its rows in one card, or a quiet line when there are none. */
function section(label: string, rows: Node[], none: string): Node {
  return rows.length ? listCard(rows, { title: label }) : col([sectionLabel(label), meta(none, { size: 13 })], { gap: 8 });
}

export function mailPage(ctx: BotsCtx, d: MailPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const m: MailData = d.mail ?? {};
  const list = m.overview?.businesses ?? [];
  const b = shownBusiness(ctx, m.overview);
  const desk = isDesk(ctx);

  const primary = b?.addresses.find((a) => a.isPrimary) ?? b?.addresses[0];
  const line = b && primary ? `${primary.email} · ${MODE_WORDS[primary.aiMode] ?? ""}` : "Your business's email, sorted and answered";
  const name = col([
    text(bot.name, { size: desk ? 17 : 19, weight: 600, lineHeight: desk ? 22 : 24 }),
    meta(line, { size: 12, lines: 1 }),
  ], { gap: 1, flexShrink: 1 });
  const settings = b ? [labelled(box([icon("settings", { size: 20, color: C.ink })], { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    open(SCREENS.mailSettings, { b: b.id })), "Settings")] : [];
  const head = desk
    ? row([botAvatar(look, 30), name, grow(), ...settings], { gap: 10 })
    : row([
      labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
      name, grow(), ...settings,
    ], { gap: 6 });

  // A chip per business, once there are two or more: the page shows one at a time.
  const switcher: Node[] = list.length > 1 ? [row([
    ...list.map((x) => chip(x.name, { selected: x.id === b?.id, onPress: { kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, b: x.id }, replace: true } })),
    chip("Add", { dashed: true, onPress: addBusiness() }),
  ], { gap: 8, flexWrap: "wrap" })] : [];

  const cards = mailCards(ctx, m, { color: look.color });
  const body: Node[] = [...cards, head, ...switcher];

  if (m.down) {
    body.push(notice("The mail service couldn't be reached just now. Pull to try again.", { mark: "close" }));
  } else if (!b) {
    body.push(card([
      row([icon("mail", { size: 28, color: look.color })], { justifyContent: "center" }),
      text("Your business's email, answered", { size: 16, weight: 600, align: "center" }),
      text("Its mailbox on our mail server, its mail sorted as it comes, and replies written in its voice for you to send. Nothing to bring.", { size: 13, color: C.meta, align: "center", lineHeight: 18 }),
      primaryButton("Set it up", addBusiness(), { size: "md" }),
    ], { dashed: true, gap: 10, padding: 24, style: { alignItems: "center" } }));
  } else {
    const runs: MailRunView[] = m.runs ?? [];
    const waiting = (m.overview?.waiting ?? []).filter((w) => !w.companyId || w.companyId === b.id);
    if (!runs.length && !waiting.length) {
      body.push(col([
        notice(`Nothing has arrived yet. Mail starts once ${b.domain} points here.`, { mark: "mail" }),
        quietButton("Domain records", open(SCREENS.mailDns, { b: b.id }), { size: "md" }),
      ], { gap: 6 }));
    }
    const t = m.overview?.today;
    if (t) {
      body.push(col([
        sectionLabel(list.length > 1 ? "Every business, last 24 hours" : "Last 24 hours"),
        row([stat(t.received, "Arrived"), stat(t.answered, "Answered"), stat(t.drafted + t.needsPerson, "Waiting"), stat(t.filed, "Filed")], { gap: 12 }),
      ], { gap: 10 }));
    }
    body.push(section("Needs you", waiting.map((r) => runRow(ctx, b.id, r)), "Nothing waits for you."));
    body.push(section("Answered", runs.filter((r) => r.status === "sent").slice(0, SHOWN).map((r) => runRow(ctx, b.id, r)), "No replies have gone yet."));
    body.push(section("Filed", runs.filter((r) => r.status === "skipped").slice(0, SHOWN).map((r) => runRow(ctx, b.id, r)), "Nothing filed yet."));
    body.push(row(STARTERS.map((s) => chip(s, { onPress: askBot(bot.slug, s) })), { gap: 8, flexWrap: "wrap" }));
  }

  const ids = (m.overview?.waiting ?? []).map((w) => String(w.id));
  return page(ctx, {
    back: desk, title: bot.name, nav: bot.slug, ...(desk ? { maxWidth: 720 } : {}),
    pullBot: { top: true, items: ids },
    body,
    footer: b && !m.down ? [chatBar(ctx, bot.slug, bot.name, "Ask about your mail…", open(SCREENS.chat, { slug: bot.slug }))] : [],
    gap: 18,
    ...(mailCardsDue(ctx, m) ? { state: mailCardsState(m) } : {}),
  });
}

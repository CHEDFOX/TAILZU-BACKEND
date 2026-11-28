/**
 * THE MAIL BOT'S PAGE (src/mail, docs/mail.md section 9): bots.bot with slug "mail". Its chat is the usual bots.chat; this is its mail.
 *
 *   the head       back, the bot's name, the domain's main address and how it answers, and its settings; a chip per domain, and Add a domain.
 *                  Every business the person reaches has a chip: their own by its domain, a member's (they are its space's admin) as "Ravi · domain",
 *                  addresses an owner gave them to answer as "Ravi · hello@domain +1". Under the head, a line says whose it is: the admin can see
 *                  and change everything; a handler is told which addresses are theirs. A handler's page has no settings, no set-up cards, and
 *                  a Mailbox of only their addresses' folders (no All mail, no Sent and other folders); Write still writes from their addresses
 *   the cards      the set-up, over the page, while it is due (mailCards.ts): the business, its domain's records, its company personality (read
 *                  from its website, theirs to change), how it answers
 *   the search     one thin round field: what is typed is found in all mail (bots.mail.inbox with q)
 *   the folders    one row of chips (All mail, each address's own, Sent and more) and Write
 *   waiting        one line when replies wait for a person, opening the first
 *   the mail       the newest mail, as a mail app lists it: under its day, and today by the part of the day (This morning, This afternoon,
 *                  This evening), then Yesterday, the weekday, the date; each row who, when, the subject, the start of it, and what the AI
 *                  did with it. More mail opens the mailbox at its next page
 *   calls          Start a call and the latest calls (mailCalls.ts), under the mail, when calls are switched on and the business is theirs
 *   the ask bar    the bots' own (parts.ts chatBar): Sribbu's chat reads the same mail (mail/digest.ts)
 *
 * Before anything arrives, one line says that mail comes once the domain points here, with the records a tap away.
 */
import type { BotTileSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, chip, meta, notice, quietButton, primaryButton, C, botAvatar,
  open, SCREENS, canMoments, botMoment, canBuddy, botBuddy, statusMark, canScrollX, scrollRow,
} from "../../kit.js";
import { addBusiness, mailCards, mailCardsDue, mailCardsState } from "./mailCards.js";
import { callsSection } from "./mailCalls.js";
import { mailDays, mailSearch, openCompose, openInbox } from "./mailInbox.js";
import { plusCircle } from "../spaces/start.js";
import {
  accessLine, accessOf, businessChip, type FolderView, MAIL_SLUG, type MailBusinessView, type MailData, openReply, shownBusiness,
} from "./mailParts.js";
import { type BotPageData, chatBar, isDesk, lookOf } from "./parts.js";

export type MailPageData = BotPageData & { mail?: MailData };

/** The mail bot's look (shared/bots/looks.json): the postie, in a navy cap, his postal-red satchel at his back with a letter peeking out. */
export const POSTIE = "postie";

/** The mail bot's tile on Home: the postie catching the letters as they drop in and filing each in his bag (m.sort, on a loop), for a build
 *  that plays looks; else a plain tile. */
export function mailTileLook(ctx: BotsCtx): Pick<BotTileSpec, "avatar" | "moment" | "momentMode"> {
  if (!canMoments(ctx)) return {};
  const m = botMoment(ctx, "m.sort", "loop");
  return { avatar: POSTIE, ...(m.moment ? { moment: m.moment, ...(m.momentMode ? { momentMode: m.momentMode } : {}) } : {}) };
}

/**
 * The folders, as one row of chips (All mail, each address's own folder, Sent and the rest), each with what is unread. A handler
 * sees only the addresses given to them: no All mail, no Sent and other folders.
 */
function folderChips(ctx: BotsCtx, b: MailBusinessView, folders: FolderView[] | undefined): Node {
  const handler = accessOf(b) === "handler";
  const all = folders?.find((f) => f.key === "inbox");
  const own = (folders ?? []).filter((f) => f.kind === "address");
  const withCount = (label: string, f?: FolderView) => (f?.unread ? `${label} · ${f.unread}` : label);
  const doors: Node[] = [
    ...(handler ? [] : [chip(withCount("All mail", all), { onPress: openInbox(b.id, "inbox") })]),
    ...(own.length > 1 || handler ? own.map((f) => chip(withCount(f.name, f), { onPress: openInbox(b.id, f.key) })) : []),
    ...(handler ? [] : [chip("Sent and more", { onPress: openInbox(b.id, "sent") })]),
  ];
  // One line that swipes sideways where the build can; else they wrap.
  return canScrollX(ctx) ? scrollRow(doors, { gap: 8, marginHorizontal: -20, paddingHorizontal: 20 }) : row(doors, { gap: 8, flexWrap: "wrap" });
}

export function mailPage(ctx: BotsCtx, d: MailPageData, o: { tabs?: Node[] } = {}) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const m: MailData = d.mail ?? {};
  const list = m.overview?.businesses ?? [];
  const b = shownBusiness(ctx, m.overview);
  const desk = isDesk(ctx);

  const primary = b?.addresses.find((a) => a.isPrimary) ?? b?.addresses[0];
  const line = b && primary ? primary.email : "Your business's email, sorted and answered";
  const name = col([
    text(bot.name, { size: desk ? 17 : 19, weight: 600, lineHeight: desk ? 22 : 24 }),
      meta(line, { size: 12, lines: 1 }),
  ], { gap: 1, flexShrink: 1 });
  // Write: a small black + in the head, as Spaces has; then the settings.
  const write = b ? [plusCircle(openCompose(b.id), "Write an email")] : [];
  const settings = b && accessOf(b) !== "handler" ? [labelled(box([icon("settings", { size: 20, color: C.ink })], { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    open(SCREENS.mailSettings, { b: b.id })), "Settings")] : [];
  // The postie in the head, as Chamen's page has its character: he stamps a letter and sends it off as the page opens.
  const postie = b && canBuddy(ctx) ? [botBuddy({
    kind: "custom", color: look.color, life: "page.mail", width: desk ? 150 : 64, height: desk ? 60 : 48, size: desk ? 38 : 30, state: "idle",
    avatar: POSTIE, lookTo: "down", ...botMoment(ctx, "m.stamp", "once"),
  })] : [];
  const head = desk
    ? row([botAvatar(look, 30), name, grow(), ...postie, ...write, ...settings], { gap: 10 })
    : row([
      labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
      name, grow(), ...postie, ...write, ...settings,
    ], { gap: 6 });

  // A chip per domain (the page shows one at a time), and another domain a tap away: each has its own mailbox, addresses and personality.
  // A chip per domain only when there are several (another is added in Settings): each has its own mailbox, addresses and personality.
  const switcher: Node[] = b && list.length > 1 ? [row(
    list.map((x) => chip(businessChip(x), { selected: x.id === b.id, onPress: { kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, b: x.id }, replace: true } })),
    { gap: 8, flexWrap: "wrap" })] : [];

  // The set-up card's stage: the postie, catching the first letter as the card opens.
  const who = b ? accessLine(b) : undefined;
  const cards = mailCards(ctx, m, { color: look.color, ...(canMoments(ctx) ? { avatar: POSTIE, moment: botMoment(ctx, "m.catch", "once") } : {}) });
  const body: Node[] = [...cards, head, ...(o.tabs ?? []), ...switcher, ...(who ? [meta(who, { size: 13, lineHeight: 18 })] : [])];

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
    const waiting = (m.overview?.waiting ?? []).filter((w) => !w.companyId || w.companyId === b.id);
    const v = m.messages;
    // A handler has no All mail: their list and their search are their first address's.
    const folder = v?.folder.key ?? (accessOf(b) === "handler" ? m.folders?.find((f) => f.kind === "address")?.key : undefined) ?? "inbox";
    body.push(mailSearch(b.id, folder), folderChips(ctx, b, m.folders));
    if (waiting.length) {
      const first = waiting[0]!;
      body.push(labelled(row([
        statusMark("needs", { size: 8 }),
        text(waiting.length === 1 ? "1 reply waits for you" : `${waiting.length} replies wait for you`, { size: 14, weight: 600, lineHeight: 19, style: { flexGrow: 1 } }),
        icon("chevron", { size: 16, color: C.meta }),
      ], { gap: 10, alignItems: "center", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.surface }, openReply(b.id, first.id)), "Open what waits for you"));
    }
    if (v?.messages.length) {
      body.push(...mailDays(ctx, b.id, folder, v.messages));
      if (v.more) body.push(quietButton("More mail", openInbox(b.id, folder, 1), { size: "md" }));
    } else if (v || (!(m.runs ?? []).length && !waiting.length)) {
      body.push(col([
        notice(`Nothing has arrived yet. Mail starts once ${b.domain} points here.`, { mark: "mail" }),
        ...(accessOf(b) === "handler" ? [] : [quietButton("Domain records", open(SCREENS.mailDns, { b: b.id }), { size: "md" })]),
      ], { gap: 6 }));
    } else {
      body.push(notice("Your mail couldn't be read just now. Pull to try again.", { mark: "mail" }));
    }
    body.push(...callsSection(ctx, b.id, m.calls));
  }

  const ids = (m.overview?.waiting ?? []).map((w) => String(w.id));
  return page(ctx, {
    back: desk, title: bot.name, nav: bot.slug, ...(desk ? { maxWidth: 720 } : {}),
    pullBot: { top: true, items: ids },
    body,
    footer: b && !m.down ? [chatBar(ctx, bot.slug, bot.name, "Ask about your mail…", open(SCREENS.chat, { slug: bot.slug }))] : [],
    gap: 14,
    ...(mailCardsDue(ctx, m) ? { state: mailCardsState(ctx, m) } : {}),
  });
}

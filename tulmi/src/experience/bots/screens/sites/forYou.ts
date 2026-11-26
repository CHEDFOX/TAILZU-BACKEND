/**
 * WHAT X0 HAS READY FOR SOMEONE ON A SITE, AND WHAT IT DID FOR THEM THERE (src/sites/history, docs/site-portrait.md §4).
 *
 *   bots.site.forYou (params: site)   one site's page: Ready for you, Done for you, and a way to forget it all
 *   siteCard(p)                       one site in a card, for the Sites page and Your space: a section per site
 *   historyReaders(ctx, readers)      the unseen reads of an orders page that is due, drawn by whichever of those is open
 *
 * WHAT IS FOR THEM, NOT HOW IT WAS LEARNED. Everything X0 works out about a person — their taste, their habits, their
 * moments, what they come back to — is used, and none of it is shown: it is how the suggestions are made, and showing
 * the workings reads as being watched. What the page shows is the result of the work:
 *
 *   READY FOR YOU   what X0 would get them now, each a tap from a filled cart: their usual, what is about to run out, and
 *                   something new it found for them, with what somebody who had it said. The same planner Talk answers
 *                   with (plan.ts readyFor), so the page and the chat never disagree.
 *   DONE FOR YOU    what X0 actually did: carts it filled, new places it found, orders it watched until they arrived.
 *
 * The same page for every site: what differs between Swiggy and Amazon is in history/kinds.ts (the words, the icon).
 * In the app's look: ink on paper; the lead suggestion is the one dark card because it is the one thing to tap.
 */
import type { ActionRef, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { catalogFor } from "../../../../sites/catalog.js";
import { kindOf } from "../../../../sites/history/kinds.js";
import { historyRead } from "../../../../sites/history/phone.js";
import { itemWords, money } from "../../../../sites/history/portrait.js";
import type { DidView, OrderOption, SitePortrait } from "../../../../sites/history/types.js";
import { FIND_LOGIN, PAGE_SHAPE } from "../../../../sites/phone.js";
import {
  type BotsCtx, C, back, box, button, call, canSiteView, card, col, emptyState, grow, icon, meta, open, page,
  row, SCREENS, sectionLabel, seq, siteView, text, timeline, title,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { oops } from "../keybotParts.js";
import { refresh, toast } from "../bots/parts.js";
import { forgetHistoryPath, historyReadPath, loadPortrait, type PortraitView, type Reader } from "./data.js";
import { freshCard, orderAction, othersCard } from "./orderCard.js";

const siteName = (site: string): string => catalogFor(site)?.name ?? site;

/** What the lead card says it is, from why it was picked. */
function leadLabel(o: OrderOption): string {
  if (o.why.startsWith("Your usual")) return "YOUR USUAL";
  if (o.why === "About time for more") return "ABOUT TIME FOR MORE";
  if (o.why.startsWith("Same as")) return "AGAIN?";
  return "PICKED FOR YOU";
}

/** THE LEAD: the one dark card, the thing X0 would get them right now, one tap from a filled cart. */
function leadCard(o: OrderOption): Node {
  const paper = C.paper, soft = "#b8b8b8";
  const k = kindOf(o.site);
  return {
    type: "Stack",
    style: { flexDirection: "column", gap: 12, padding: 18, borderRadius: 20, backgroundColor: C.ink },
    children: [
      row([
        icon("spark", { size: 14, color: paper }),
        text(leadLabel(o), { size: 11, weight: 600, color: soft, tracking: 0.6, lineHeight: 14 }),
        grow(),
        ...(o.total ? [text(`about ${money(o.total)}`, { size: 14, weight: 600, color: paper, lineHeight: 20 })] : []),
      ], { gap: 6, alignItems: "center" }),
      text(k.kind === "food" ? o.place : itemWords(o.items), { size: 22, weight: 700, color: paper, lineHeight: 27, tracking: -0.3, lines: 2 }),
      text(k.kind === "food" ? itemWords(o.items) : o.place, { size: 15, color: paper, lineHeight: 20, lines: 3 }),
      ...(leadLabel(o) === "PICKED FOR YOU" ? [meta(o.why, { size: 13, color: soft, lines: 2 })] : []),
      row([text(k.verb === "buy" ? "Buy it now" : "Order it now", { size: 15, weight: 600, color: C.ink, lineHeight: 20 }), icon("chevron", { size: 16, color: C.ink })], {
        height: 46, borderRadius: 23, paddingHorizontal: 20, gap: 6, justifyContent: "center", alignItems: "center",
        alignSelf: "flex-start", backgroundColor: paper,
      }, orderAction(o)),
    ],
  } as Node;
}

/** READY FOR YOU: the lead, then what is new (each with its reviewer's words), then the rest as quiet rows. */
function ready(p: SitePortrait): Node[] {
  const all = p.ready ?? [];
  if (!all.length) return [];
  const [first, ...rest] = all;
  return [
    sectionLabel("Ready for you"),
    first!.fresh ? freshCard(first!) : leadCard(first!),
    ...rest.filter((o) => o.fresh).slice(0, 2).map((o) => freshCard(o, { primary: false })),
    ...(rest.some((o) => !o.fresh) ? [othersCard(rest.filter((o) => !o.fresh), "Also ready")] : []),
  ];
}

/** "today", "yesterday", "3 days ago", "21 Nov". */
function when(at: number, now: number): string {
  if (!at) return "";
  const days = Math.floor(now / 86_400_000) - Math.floor(at / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** DONE FOR YOU: what X0 actually did here, newest first. */
function done(dids: readonly DidView[] | undefined, now: number): Node[] {
  if (!dids?.length) return [];
  return [
    sectionLabel("Done for you"),
    card([timeline(dids.slice(0, 6).map((d) => ({
      mark: "done" as const, title: d.title,
      meta: [d.line, when(d.at, now)].filter(Boolean).join(" · "),
    })))]),
  ];
}

/**
 * THE UNSEEN READS: one SiteView for each orders page this phone should read now. What it read goes to the server, which
 * keeps the orders; the screen is read again once it has. Only on a phone that draws one; at most two at once.
 */
export function historyReaders(ctx: BotsCtx, readers: readonly Reader[]): Node[] {
  if (!canSiteView(ctx)) return [];
  return readers.slice(0, 2).map((r) => siteView({
    mode: "read", url: r.url, site: r.site, hosts: [r.site],
    scripts: { shape: PAGE_SHAPE, findLogin: FIND_LOGIN, read: historyRead(r.site) },
  }, { onResult: { kind: "callEndpoint", method: "POST", path: historyReadPath(r.site), body: "$event", onSuccess: refresh } as ActionRef }));
}

/** One site in a card: what is ready there, and the last thing done. A tap opens that site's page. */
export function siteCard(p: SitePortrait): Node {
  const k = kindOf(p.site);
  const lead = p.ready?.[0];
  const news = (p.ready ?? []).filter((o) => o.fresh).length;
  const line = lead
    ? `${lead.fresh ? "New for you: " : leadLabel(lead) === "ABOUT TIME FOR MORE" ? "About time for more " : "Ready: "}${k.kind === "food" ? `${itemWords(lead.items)} from ${lead.place}` : itemWords(lead.items)}`
    : "Getting your picks ready";
  return card([
    row([
      box([icon(k.icon, { size: 18 })], { width: 34, height: 34, borderRadius: 17, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
      col([
        text(p.name, { size: 16, weight: 600, lineHeight: 21 }),
        meta(line, { size: 12, lines: 1 }),
      ], { gap: 1, flexShrink: 1, minWidth: 0 }),
      grow(),
      icon("chevron", { size: 16, color: C.meta }),
    ], { gap: 10, alignItems: "center" }),
    ...(news > 1 || (news === 1 && !lead?.fresh) ? [meta(`${news === 1 ? "Something new" : `${news} new picks`} waiting`, { size: 12, color: C.grey70 })] : []),
    ...(p.did?.[0] ? [row([icon("check", { size: 13, color: C.meta }), meta(p.did[0].title, { size: 12, lines: 1, style: { flexShrink: 1 } })], { gap: 6, alignItems: "center" })] : []),
  ], { gap: 10, onPress: open(SCREENS.sitePortrait, { site: p.site }) as ActionRef });
}

function forYouPage(ctx: BotsCtx, d: PortraitView | undefined): ScreenResponse {
  const p = d?.portrait;
  const readers = historyReaders(ctx, d?.reader ? [d.reader] : []);
  if (!p) return page(ctx, { title: "For you", body: [emptyState({ title: "Nothing to show", body: "This isn't switched on here." })], back: back() });
  const name = siteName(p.site);
  const body = [...ready(p), ...done(p.did, Date.now())];
  if (!body.length) {
    return page(ctx, {
      title: name,
      body: [
        title(name),
        emptyState({ pose: "think", title: "Getting your picks ready", body: `What I have for you on ${name} shows up here, ready to tap.` }),
        ...readers,
      ],
      back: back(),
    });
  }
  const forget = call("DELETE", forgetHistoryPath(p.site), undefined, {
    ok: seq(toast(`Forgotten everything from ${name}`), { kind: "navigateBack" }, refresh),
    fail: oops("Couldn't forget that just now. Try again."),
  });
  return page(ctx, {
    title: name,
    body: [
      col([title(name), meta("Ready when you are.", { size: 13 })], { gap: 4 }),
      ...body,
      col([
        meta(`Made from your ${name} orders, on your phone. Never your password, card or address.`, { size: 12, color: C.idle, lines: 2 }),
        button("Forget all of it", forget, { kind: "quiet", size: "md" }),
      ], { gap: 6 }),
      ...readers,
    ],
    back: back(),
  });
}

export const forYouScreens: BotsScreen[] = [
  screen<PortraitView | undefined>({
    id: SCREENS.sitePortrait,
    load: (ctx, deps) => loadPortrait(deps, ctx.user?.id, String(ctx.params.site ?? "")),
    build: (ctx, d) => forYouPage(ctx, d),
  }),
];

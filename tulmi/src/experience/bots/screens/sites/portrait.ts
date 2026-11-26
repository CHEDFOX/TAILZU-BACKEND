/**
 * WHAT SOMEBODY'S ORDERS ON A SITE SAY ABOUT THEM, DRAWN (src/sites/history, docs/site-portrait.md).
 *
 *   bots.site.portrait (params: site)   one site's portrait: the usual, what X0 noticed, their places and dishes, and a way to
 *                                       forget all of it
 *   portraitCard(ctx, p)                one site's portrait in a card: the Sites page and Your space draw one per site, which
 *                                       is the "section per site" of the person's portrait
 *   historyReaders(readers)             the unseen reads of an orders page that is due, drawn by whichever of those screens is open
 *
 * CONCLUSIONS, NOT CALCULATIONS. The person sees what X0 worked out about them — the usual, the habits in plain words, the
 * places and dishes they like — and never the counting behind it: no order counts, no percentages, no charts, no list of
 * what was read off the site. The one dark card is the usual, because it is the one thing on the page to tap.
 *
 * Every name on it is the site's (the places and the dishes); nothing is guessed.
 */
import type { ActionRef, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { DAY_NAMES, dishWords, money, SLOT_WORDS } from "../../../../sites/history/portrait.js";
import { historyRead } from "../../../../sites/history/phone.js";
import { startUrl } from "../../../../sites/history/plan.js";
import type { OrderOption, SitePortrait } from "../../../../sites/history/types.js";
import { FIND_LOGIN, PAGE_SHAPE } from "../../../../sites/phone.js";
import {
  type BotsCtx, C, back, box, button, call, canSiteView, card, chip, col, emptyState, grow, icon, listCard, listRow, meta, open, page,
  row, SCREENS, sectionLabel, seq, siteView, text, title,
} from "../../kit.js";
import { botLook } from "../../palette.js";
import { screen, type BotsScreen } from "../../registry.js";
import { oops } from "../keybotParts.js";
import { refresh, toast } from "../bots/parts.js";
import { forgetHistoryPath, historyReadPath, loadPortrait, type PortraitView, type Reader } from "./data.js";
import { orderAction, whyLine } from "./orderCard.js";



/** The order X0 would place for one place: its usual there, from the site's portrait. */
function placeOption(p: SitePortrait, place: SitePortrait["places"][number]): OrderOption | undefined {
  const dishes = place.dishes.slice(0, 2);
  if (!dishes.length) return undefined;
  return {
    site: p.site, place: place.place, items: dishes.map((d) => ({ name: d.name, qty: 1 })),
    why: "What you like here",
    url: startUrl(p.site, place.place, place.link),
    ...(place.area ? { area: place.area } : {}), ...(place.usualTotal ? { total: place.usualTotal } : {}),
  };
}

function usualOption(p: SitePortrait): OrderOption | undefined {
  const u = p.usual;
  if (!u) return undefined;
  const when = [u.day !== undefined ? DAY_NAMES[u.day] : "", u.slot ? SLOT_WORDS[u.slot] : ""].filter(Boolean).join(" ");
  return {
    site: p.site, place: u.place, items: u.items, url: startUrl(p.site, u.place, u.link),
    why: `Your usual${when ? ` ${when}` : ""}`, ...(u.total ? { total: u.total } : {}),
  };
}

/** THE USUAL, as the one dark card on the page: the thing they come back to, and the button that orders it. */
function usualCard(p: SitePortrait): Node | null {
  const o = usualOption(p);
  if (!o) return null;
  const paper = C.paper;
  const soft = "#b8b8b8";
  return {
    type: "Stack",
    style: { flexDirection: "column", gap: 12, padding: 18, borderRadius: 20, backgroundColor: C.ink },
    children: [
      row([
        icon("spark", { size: 14, color: paper }),
        text("YOUR USUAL", { size: 11, weight: 600, color: soft, tracking: 0.6, lineHeight: 14 }),
        grow(),
        ...(o.total ? [text(`about ${money(o.total)}`, { size: 14, weight: 600, color: paper, lineHeight: 20 })] : []),
      ], { gap: 6, alignItems: "center" }),
      text(o.place, { size: 22, weight: 700, color: paper, lineHeight: 27, tracking: -0.3, lines: 2 }),
      text(dishWords(o.items), { size: 15, color: paper, lineHeight: 20, lines: 3 }),
      meta(o.why, { size: 13, color: soft }),
      row([text("Order it now", { size: 15, weight: 600, color: C.ink, lineHeight: 20 }), icon("chevron", { size: 16, color: C.ink })], {
        height: 46, borderRadius: 23, paddingHorizontal: 20, gap: 6, justifyContent: "center", alignItems: "center",
        alignSelf: "flex-start", backgroundColor: paper,
      }, orderAction(o)),
    ],
  } as Node;
}




function noticed(p: SitePortrait): Node[] {
  if (!p.noticed.length) return [];
  const spark = botLook("talk").color;
  return [
    sectionLabel("What I've noticed"),
    card(p.noticed.map((n) => row([
      box([icon("spark", { size: 13, color: spark })], { paddingTop: 3 }),
      text(n, { size: 15, lineHeight: 21, style: { flexShrink: 1 } }),
    ], { gap: 10, alignItems: "flex-start" })), { gap: 12 }),
  ];
}

function places(p: SitePortrait): Node[] {
  if (!p.places.length) return [];
  return [
    sectionLabel("Your places"),
    listCard(p.places.slice(0, 6).map((pl) => {
      const o = placeOption(p, pl);
      return listRow({
        label: pl.place,
        ...(pl.dishes[0] ? { sub: pl.dishes.slice(0, 2).map((d) => d.name).join(", ") } : {}),
        ...(o ? { onPress: orderAction(o) } : {}),
      });
    })),
  ];
}

function dishes(p: SitePortrait): Node[] {
  if (!p.dishes.length) return [];
  return [
    sectionLabel("Dishes you love"),
    row(p.dishes.slice(0, 10).map((d) => chip(d.name)), { gap: 8, flexWrap: "wrap" }),
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

/** One site's portrait in a card: its usual, three numbers and a line. A tap opens the whole portrait. */
export function portraitCard(p: SitePortrait): Node {
  const top = [...p.slots].sort((a, b) => b.count - a.count)[0];
  const facts = [
    ...(top && top.count >= 2 ? [`Mostly ${SLOT_WORDS[top.slot]}`] : []),
    ...(p.spend.median ? [`around ${money(p.spend.median)}`] : []),
  ].join(" · ") || "What I've learned so far";
  return card([
    row([
      box([icon("pot", { size: 18 })], { width: 34, height: 34, borderRadius: 17, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
      col([
        text(p.name, { size: 16, weight: 600, lineHeight: 21 }),
        meta(facts, { size: 12, lines: 1 }),
      ], { gap: 1, flexShrink: 1, minWidth: 0 }),
      grow(),
      icon("chevron", { size: 16, color: C.meta }),
    ], { gap: 10, alignItems: "center" }),
    ...(p.usual ? [whyLine(`Usually ${dishWords(p.usual.items)} from ${p.usual.place}`)] : p.noticed[0] ? [whyLine(p.noticed[0])] : []),
  ], { gap: 10, onPress: open(SCREENS.sitePortrait, { site: p.site }) as ActionRef });
}

function portraitPage(ctx: BotsCtx, d: PortraitView | undefined): ScreenResponse {
  const site = String(ctx.params.site ?? "");
  const p = d?.portrait;
  const readers = historyReaders(ctx, d?.reader ? [d.reader] : []);
  if (!p) return page(ctx, { title: "Your orders", body: [emptyState({ title: "Nothing to show", body: "This isn't switched on here." })], back: back() });
  if (!p.orders) {
    return page(ctx, {
      title: p.name,
      body: [
        title(p.name),
        emptyState({
          pose: "think", title: "Nothing learned yet",
          body: readers.length ? `I'm reading your orders on ${p.name} now. This fills in by itself.` : `I'll read your orders page on ${p.name} the next time you open this on your phone.`,
        }),
        ...readers,
      ],
      back: back(),
    });
  }
  const forget = call("DELETE", forgetHistoryPath(p.site), undefined, {
    ok: seq(toast(`Forgotten what I learned on ${p.name}`), { kind: "navigateBack" }, refresh),
    fail: oops("Couldn't forget that just now. Try again."),
  });
  const usual = usualCard(p);
  return page(ctx, {
    title: p.name,
    body: [
      col([title(p.name), meta("What I've learned about how you eat.", { size: 13 })], { gap: 4 }),
      ...(usual ? [usual] : []),
      ...noticed(p),
      ...places(p),
      ...dishes(p),
      col([
        meta(`Learned from your ${p.name} orders, on your phone. Never your password, card or address.`, { size: 12, color: C.idle, lines: 2 }),
        button("Forget what I learned", forget, { kind: "quiet", size: "md" }),
      ], { gap: 6 }),
      ...readers,
    ],
    back: back(),
    state: { site },
  });
}

export const portraitScreens: BotsScreen[] = [
  screen<PortraitView | undefined>({
    id: SCREENS.sitePortrait,
    load: (ctx, deps) => loadPortrait(deps, ctx.user?.id, String(ctx.params.site ?? "")),
    build: (ctx, d) => portraitPage(ctx, d),
  }),
];

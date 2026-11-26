/**
 * AN ORDER, FILLED IN ON THE SITE WHILE THEY WATCH (src/sites/history, docs/site-portrait.md). Opened from the order card in
 * Talk or from a portrait (params: o, one option's token, checked again here).
 *
 * On a phone that draws a SiteView: what is being ordered, in a card at the top, and under it the site's own page, signed in
 * as them, where the step (src/sites/history/phone.ts orderStep) opens the restaurant, presses "Add" by each dish once and
 * then "View cart". They check the cart and press pay themselves. Back stops it at any moment.
 *
 * Anywhere else (the window, an older phone): the same card, and a button that opens the site at the restaurant, so the
 * list is in front of them while they add it.
 *
 * The page is the site's, so it is held to the site: the option's address must be https on that site, the site must be one
 * this server allows, and the SiteView may go nowhere else.
 */
import { catalogFor } from "../../../../sites/catalog.js";
import { createHash } from "node:crypto";
import type { ActionRef, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { siteAllowed } from "../../../../sites/gate.js";
import { ORDER_SHAPE, orderStep } from "../../../../sites/history/phone.js";
import { itemWords, money } from "../../../../sites/history/portrait.js";
import { readOrderToken } from "../../../../sites/history/token.js";
import { SITES_API } from "../../sites.js";
import { kindOf } from "../../../../sites/history/kinds.js";
import type { OrderOption } from "../../../../sites/history/types.js";
import { READ_PAGE } from "../../../../sites/phone.js";
import { type BotsCtx, C, RADIUS, back, box, button, canSiteView, card, col, emptyState, grow, icon, meta, page, row, SCREENS, siteView, text } from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { whyLine } from "./orderCard.js";

/** The site as people say it ("Swiggy", "Amazon"), from the catalog. */
const siteName = (site: string): string => catalogFor(site)?.name ?? site;

/**
 * The order's id: what was pressed is kept under it on the phone, so opening the same order twice in a day never adds the
 * dishes twice. A new day is a new order.
 */
export function orderId(token: string, now = Date.now()): string {
  return createHash("sha256").update(`${token}|${new Date(now).toISOString().slice(0, 10)}`).digest("hex").slice(0, 16);
}

/** The card above the page: what goes in the cart, and the promise about paying. */
function summary(o: OrderOption, watching: boolean): Node {
  const name = siteName(o.site);
  return card([
    row([
      box([icon(o.search ? "search" : "bag", { size: 18 })], { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
      col([
        text(o.search ? `Searching ${name}` : watching ? `Filling your cart on ${name}` : `Your order on ${name}`, { size: 11, weight: 600, color: C.meta, tracking: 0.4, lineHeight: 14 }),
        text(o.search ? `“${o.place}”` : o.place, { size: 17, weight: 600, lineHeight: 22, lines: 1 }),
        ...(o.items.length ? [meta(itemWords(o.items), { size: 13, lines: 2 })] : []),
      ], { gap: 2, flexShrink: 1, minWidth: 0 }),
      grow(),
      ...(o.total ? [text(`≈ ${money(o.total)}`, { size: 15, weight: 700, lineHeight: 20, lines: 1, style: { flexShrink: 0 } })] : []),
    ], { gap: 10, alignItems: "center" }),
    whyLine(o.search ? "Pick what you like. I don't add anything I haven't seen you order." : watching
      ? `I'll open ${o.place}, add ${o.items.length === 1 ? "it" : `these ${o.items.length}`} and show you the cart. You pay.`
      : `Add ${o.items.length === 1 ? "it" : "these"} on ${name} and pay there.`),
  ], { padding: 14, gap: 10 });
}

function orderPage(ctx: BotsCtx): ScreenResponse {
  const token = String(ctx.params.o ?? "");
  const o = readOrderToken(token)[0];
  if (!o || !siteAllowed(o.site)) {
    return page(ctx, { title: "Order", body: [emptyState({ title: "Couldn't open that order", body: "Ask Talk again and I'll make a fresh one." })], back: back() });
  }
  const name = siteName(o.site);
  if (!canSiteView(ctx)) {
    // The window, or a phone that cannot hold a site: the list, and the site opened at the restaurant beside it.
    const go: ActionRef = { kind: "openUrl", url: o.url, external: true } as ActionRef;
    return page(ctx, {
      title: o.place,
      body: [
        summary(o, false),
        button(`Open ${name}`, go, { kind: "primary", size: "lg", icon: "link", wide: true }),
        meta(ctx.client === "desktop"
          ? `Filling the cart for you works in the X0 app on your phone, where you're signed in to ${name}.`
          : `Filling the cart for you needs a newer version of the app. Until then, this opens ${name} at the right place.`, { size: 12, color: C.idle, lines: 3, align: "center" }),
      ],
      back: back(),
    });
  }
  const kind = kindOf(o.site);
  const step = orderStep({ id: orderId(token), place: o.place, items: o.search || !kind.cart ? [] : o.items.map((i) => i.name), mode: kind.cart ?? "menu" });
  return page(ctx, {
    title: o.place,
    // The page holds nothing secret, but it is one order for one moment: it is not kept to be drawn again from a cache.
    keep: false,
    body: [
      summary(o, !o.search),
      siteView({
        mode: "signin", url: o.url, site: o.site, hosts: [o.site],
        scripts: { shape: ORDER_SHAPE, findLogin: step, read: READ_PAGE },
      }, { style: { flexGrow: 1, minHeight: 600, borderRadius: RADIUS.list, borderWidth: 1, borderColor: C.line, overflow: "hidden" } }),
      meta(`This is ${name}'s own page, signed in as you. I never press pay.`, { size: 12, color: C.idle, lines: 2, align: "center" }),
    ],
    back: back(),
  });
}

export const orderScreens: BotsScreen[] = [
  screen<undefined>({
    id: SCREENS.siteOrder,
    // Filling the cart is something done for them: noted for that site's "Done for you", once per order (its id is per day).
    load: async (ctx, deps) => {
      const token = String(ctx.params.o ?? "");
      const o = readOrderToken(token)[0];
      if (!o || o.search || !o.items.length || !canSiteView(ctx) || !kindOf(o.site).cart) return undefined;
      await deps.api("POST", `${SITES_API}/did`, {
        site: o.site, ref: orderId(token), title: `Filled your cart ${kindOf(o.site).kind === "food" ? "at" : "with"} ${kindOf(o.site).kind === "food" ? o.place : itemWords(o.items)}`,
        line: kindOf(o.site).kind === "food" ? itemWords(o.items) : siteName(o.site),
        ...(o.image ? { image: o.image } : {}),
      }).catch(() => undefined);
      return undefined;
    },
    build: (ctx) => orderPage(ctx),
  }),
];

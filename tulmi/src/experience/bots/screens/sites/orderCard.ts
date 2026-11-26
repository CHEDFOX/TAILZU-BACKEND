/**
 * THE ORDER CARD: what Talk answers "order my usual" with (routes/bots/botsTalk.ts, src/sites/history, docs/site-portrait.md).
 *
 *   orderCards(ctx, token)   the first option as a card to tap, the others as a short list under it
 *   orderAction(option)      where a tap goes: the order screen, which fills the cart on the site (screens/sites/order.ts)
 *
 * ONE TAP AND NOTHING SPENT. The card says what would be ordered, from where, about what it costs and why X0 picked it —
 * and the one thing it can do is open the site with the cart filled in. The person checks the cart and pays on the site,
 * as themselves. The line under the button says so, every time, because "order" is a word people take literally.
 *
 * In the app's look: ink on paper, greys, colour only for the bot (the spark beside the reason is Talk's).
 */
import type { ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import { dishWords, money } from "../../../../sites/history/portrait.js";
import { orderToken, readOrderToken } from "../../../../sites/history/token.js";
import type { OrderOption } from "../../../../sites/history/types.js";
import { type BotsCtx, C, box, button, card, col, divider, grow, icon, listCard, listRow, meta, open, row, SCREENS, text } from "../../kit.js";
import { botLook } from "../../palette.js";

const siteName = (site: string): string => (site === "swiggy.com" ? "Swiggy" : site === "zomato.com" ? "Zomato" : site);

/** The order screen for one option. The option travels as its own token, and is checked again when the screen opens. */
export function orderAction(o: OrderOption): ActionRef {
  return open(SCREENS.siteOrder, { o: orderToken([o]) }) as ActionRef;
}

/** "1×" in a small grey tile beside each dish: the quantity reads before the name, as on a bill. */
function itemRow(name: string, qty: number): Node {
  return row([
    box([text(`${qty}×`, { size: 12, weight: 600, lineHeight: 16, align: "center" })], {
      minWidth: 30, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 7, backgroundColor: C.surface, alignItems: "center",
    }),
    text(name, { size: 15, lineHeight: 20, lines: 2, style: { flexShrink: 1 } }),
  ], { gap: 10, alignItems: "center" });
}

/** Why X0 picked it, with Talk's spark beside it: the one place colour is allowed, on the bot's own mark. */
export function whyLine(why: string): Node {
  return row([
    icon("spark", { size: 14, color: botLook("talk").color }),
    meta(why, { size: 13, lines: 2, style: { flexShrink: 1 } }),
  ], { gap: 6, alignItems: "center" });
}

/** The first option, whole. */
export function orderCard(o: OrderOption, o2: { primary?: boolean } = {}): Node {
  const name = siteName(o.site);
  if (o.search) {
    return card([
      row([icon("search", { size: 18 }), text(name, { size: 12, weight: 600, color: C.meta, lineHeight: 16 })], { gap: 8, alignItems: "center" }),
      text(`Find “${o.place}”`, { size: 19, weight: 600, lineHeight: 24, lines: 2 }),
      whyLine(o.why),
      button(`Search ${name}`, orderAction(o), { kind: o2.primary === false ? "secondary" : "primary", size: "md", icon: "search" }),
    ], { gap: 12 });
  }
  return card([
    row([
      box([icon("pot", { size: 18 })], { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
      col([
        text(name.toUpperCase(), { size: 11, weight: 600, color: C.meta, tracking: 0.4, lineHeight: 14 }),
        text(o.place, { size: 18, weight: 600, lineHeight: 23, lines: 1 }),
      ], { gap: 1, flexShrink: 1, minWidth: 0 }),
      grow(),
      ...(o.total ? [text(`about ${money(o.total)}`, { size: 14, weight: 600, lineHeight: 19, lines: 1, style: { flexShrink: 0 } })] : []),
    ], { gap: 10, alignItems: "center" }),
    col(o.items.slice(0, 5).map((i) => itemRow(i.name, i.qty)), { gap: 8 }),
    ...(o.items.length > 5 ? [meta(`and ${o.items.length - 5} more`, { size: 12 })] : []),
    whyLine(o.why),
    divider(),
    button("Order this", orderAction(o), { kind: "primary", size: "md", icon: "bag", wide: true }),
    meta(`I fill the cart on ${name} while you watch. You check it and pay there.`, { size: 12, color: C.idle, lines: 2, align: "center" }),
  ], { gap: 14 });
}

/** The other ideas, as rows: one line each, a tap opens the same order screen. */
function othersCard(options: readonly OrderOption[]): Node {
  return listCard(options.map((o) => listRow({
    label: o.search ? `Search ${siteName(o.site)} for “${o.place}”` : o.place,
    sub: o.search ? o.why : `${dishWords(o.items)} · ${o.why}`,
    ...(o.total ? { value: money(o.total) } : {}),
    onPress: orderAction(o),
  })), { title: "Or" });
}

/** Under Talk's words: the order card, and the others. Nothing when the turn's token does not read back. */
export function orderCards(_ctx: BotsCtx, token: string | undefined): Node[] {
  const options = token ? readOrderToken(token) : [];
  if (!options.length) return [];
  const [first, ...rest] = options;
  return [orderCard(first!), ...(rest.length ? [othersCard(rest)] : [])];
}

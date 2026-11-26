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
import { catalogFor } from "../../../../sites/catalog.js";
import type { ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import { itemWords, money } from "../../../../sites/history/portrait.js";
import { orderToken, readOrderToken } from "../../../../sites/history/token.js";
import { kindOf } from "../../../../sites/history/kinds.js";
import type { OrderOption } from "../../../../sites/history/types.js";
import { type BotsCtx, C, box, button, card, col, divider, grow, icon, listCard, listRow, meta, open, row, SCREENS, text } from "../../kit.js";
import { botLook } from "../../palette.js";

/** The site as people say it ("Swiggy", "Amazon"), from the catalog. */
const siteName = (site: string): string => catalogFor(site)?.name ?? site;

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
      box([icon(kindOf(o.site).icon, { size: 18 })], { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
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
    button(kindOf(o.site).verb === "buy" ? "Buy this" : "Order this", orderAction(o), { kind: "primary", size: "md", icon: "bag", wide: true }),
    meta(`I fill the cart on ${name} while you watch. You check it and pay there.`, { size: 12, color: C.idle, lines: 2, align: "center" }),
  ], { gap: 14 });
}

/**
 * SOMEWHERE NEW, FOR THEM: a place X0 found on the web for their taste (src/sites/history/taste/discover.ts). It says why it
 * is for them — which of their likings it answers — and what somebody who ate there said, in their own words, with where
 * they said it. That quote is the reason to trust a place they have never heard of, so it is never left off.
 */
export function freshCard(o: OrderOption, o2: { primary?: boolean } = {}): Node {
  const name = siteName(o.site);
  const food = kindOf(o.site).kind === "food";
  const spark = botLook("talk").color;
  return card([
    row([
      box([icon("spark", { size: 16, color: C.paper })], { width: 32, height: 32, borderRadius: 16, backgroundColor: spark, alignItems: "center", justifyContent: "center" }),
      col([
        text("NEW FOR YOU", { size: 11, weight: 600, color: spark, tracking: 0.6, lineHeight: 14 }),
        // A restaurant is the thing to try, and its dish is what to have there; a product is the thing, and its brand is a footnote.
        text(food ? o.place : itemWords(o.items), { size: 18, weight: 600, lineHeight: 23, lines: 2 }),
        ...(food ? [] : [meta(o.place, { size: 13 })]),
      ], { gap: 1, flexShrink: 1, minWidth: 0 }),
    ], { gap: 10, alignItems: "center" }),
    ...(food ? [col(o.items.slice(0, 3).map((i) => itemRow(i.name, i.qty)), { gap: 8 })] : []),
    text(o.why, { size: 14, color: C.grey70, lineHeight: 20, lines: 4 }),
    ...(o.said ? [row([
      box([], { width: 3, borderRadius: 2, backgroundColor: C.line, alignSelf: "stretch" }),
      col([
        text(`“${o.said}”`, { size: 14, lineHeight: 20, lines: 4, style: { fontStyle: "italic" } }),
        ...(o.host ? [meta(`someone who ${kindOf(o.site).kind === "food" ? "ate there" : "bought it"}, on ${o.host}`, { size: 12 })] : []),
      ], { gap: 4, flexShrink: 1 }),
    ], { gap: 10 })] : []),
    button("Try this", orderAction(o), { kind: o2.primary === false ? "secondary" : "primary", size: "md", icon: "spark", wide: true }),
    meta(`I open it on ${name} and add it. You check the cart and pay.`, { size: 12, color: C.idle, lines: 2, align: "center" }),
  ], { gap: 12 });
}

/** The other ideas, as rows: one line each, a tap opens the same order screen. */
export function othersCard(options: readonly OrderOption[], title = "Or"): Node {
  return listCard(options.map((o) => listRow({
    label: o.search ? `Search ${siteName(o.site)} for “${o.place}”` : kindOf(o.site).kind === "food" ? o.place : itemWords(o.items),
    sub: o.search ? o.why : kindOf(o.site).kind === "food" ? `${itemWords(o.items)} · ${o.why}` : o.why,
    ...(o.total ? { value: money(o.total) } : {}),
    onPress: orderAction(o),
  })), { title });
}

/** Under Talk's words: the order card, and the others. Nothing when the turn's token does not read back. */
export function orderCards(_ctx: BotsCtx, token: string | undefined): Node[] {
  const options = token ? readOrderToken(token) : [];
  if (!options.length) return [];
  const [first, ...rest] = options;
  // Something new gets its own card wherever it is in the list: a place they have never heard of needs its reason and its
  // reviewer's words to be worth a tap, and a list row has room for neither.
  const lead = first!.fresh ? freshCard(first!) : orderCard(first!);
  const newOne = rest.find((o) => o.fresh);
  const others = rest.filter((o) => !o.fresh);
  return [lead, ...(newOne ? [freshCard(newOne, { primary: false })] : []), ...(others.length ? [othersCard(others)] : [])];
}

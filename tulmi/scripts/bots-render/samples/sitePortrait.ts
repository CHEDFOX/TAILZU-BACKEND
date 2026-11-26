/**
 * A PERSON'S SWIGGY ORDERS for the render check (screens/sites/forYou.ts, screens/sites/order.ts, the order card in Talk;
 * docs/site-portrait.md): seven weeks of Riya's dinners and lunches in Koramangala, as the orders page would have shown them.
 *
 * The orders are the input; everything drawn is made from them by the real code (portraitOf, planOrder), so the render
 * shows what the server would really send for this history, not a picture of one.
 */
import { portraitOf } from "../../../src/sites/history/portrait.js";
import { planLine, planOrder, readyFor } from "../../../src/sites/history/plan.js";
import { readOrderAsk } from "../../../src/sites/history/ask.js";
import { orderToken } from "../../../src/sites/history/token.js";
import type { SiteOrder } from "../../../src/sites/history/types.js";
import { tasteFrom } from "../../../src/sites/history/taste/profile.js";
import { featuresOf } from "../../../src/sites/history/taste/features.js";
import { picksFrom } from "../../../src/sites/history/taste/discover.js";
import { pickView, tasteView } from "../../../src/sites/history/service.js";

/** Thursday 26 November 2026, 8:10 pm in Bengaluru. */
export const PORTRAIT_NOW = Date.UTC(2026, 10, 26, 14, 40);
const SITE = "swiggy.com";
const LINK = "https://www.swiggy.com/restaurants/behrouz-biryani-koramangala-bangalore-52311";

const order = (n: number, local: string, place: string, items: Array<[string, number]>, total: number, o: Partial<SiteOrder> = {}): SiteOrder => ({
  key: `no:18374652${String(n).padStart(4, "0")}`, site: SITE, place, area: "Koramangala", local, total, seenAt: PORTRAIT_NOW,
  items: items.map(([name, qty]) => ({ name, qty })), ...o,
});

const BEHROUZ: Array<[string, number]> = [["Chicken Dum Biryani", 1], ["Gulab Jamun (2 pcs)", 1]];

export const RIYA_ORDERS: SiteOrder[] = [
  order(1, "2026-11-21T20:40", "Behrouz Biryani", BEHROUZ, 458, { link: LINK }),
  order(2, "2026-11-19T13:15", "Truffles", [["All American Cheese Burger", 1], ["Peri Peri Fries", 1]], 386),
  order(3, "2026-11-14T21:05", "Behrouz Biryani", BEHROUZ, 458, { link: LINK }),
  order(4, "2026-11-12T20:20", "Meghana Foods", [["Boneless Chicken Biryani", 1]], 352),
  order(5, "2026-11-07T20:55", "Behrouz Biryani", BEHROUZ, 449, { link: LINK }),
  order(6, "2026-11-05T13:30", "Truffles", [["All American Cheese Burger", 1]], 289),
  order(7, "2026-11-02T22:45", "Leon's Burgers & Wings", [["Classic Chicken Wings", 1]], 310),
  order(8, "2026-10-31T21:10", "Behrouz Biryani", BEHROUZ, 449, { link: LINK }),
  order(9, "2026-10-28T13:05", "Chinita Real Mexican Food", [["Chicken Burrito Bowl", 1]], 420),
  order(10, "2026-10-24T20:30", "Behrouz Biryani", [["Chicken Dum Biryani", 1]], 389, { link: LINK }),
  order(11, "2026-10-21T20:00", "Meghana Foods", [["Boneless Chicken Biryani", 1], ["Chicken 65", 1]], 548),
  order(12, "2026-10-17T21:20", "Behrouz Biryani", BEHROUZ, 449, { link: LINK }),
  order(13, "2026-10-15T13:40", "Truffles", [["All American Cheese Burger", 1], ["Peri Peri Fries", 1]], 386),
  order(14, "2026-10-10T20:45", "Behrouz Biryani", BEHROUZ, 449, { link: LINK }),
  order(15, "2026-10-08T19:50", "Third Wave Coffee", [["Hazelnut Cold Coffee", 2]], 360, { cancelled: true }),
];

/**
 * HER TASTE, as the taste model would answer for these orders, put through the same checks the real answer is
 * (tasteFrom: every claim names orders that exist, a "might like" is something she has not had). The reply is written
 * here because a render must not call a model; what is drawn is what the checks let through.
 */
export const RIYA_TASTE = tasteFrom({
  insights: [
    "Rich, slow-cooked rice is your comfort food, and Behrouz's dum biryani is the one you trust.",
    "Saturday night is a treat you don't gamble with; weekday lunches are quick and familiar.",
    "You like a sweet finish after something savoury and heavy.",
    "You'll try somewhere new when it's close to a favourite, not when it's a leap.",
  ],
  palate: [
    { trait: "Rich and slow-cooked", why: "Dum biryani most weekends, boneless biryani in between", orders: [1, 3, 4, 5] },
    { trait: "A sweet finish", why: "Gulab jamun with nearly every biryani", orders: [1, 3, 5] },
    { trait: "Mild heat, not fire", why: "Biryanis and burgers, never the spiciest thing on a menu", orders: [1, 2, 4] },
  ],
  motives: [
    { trait: "Reliability over novelty", why: "The same Saturday order week after week", orders: [1, 3, 5, 8] },
    { trait: "Comfort at the end of the week", why: "The richest order lands on Saturday nights", orders: [1, 3, 5] },
  ],
  moods: [
    { moment: "weekend dinner", wants: "A favourite you know will be good, and dessert", orders: [1, 3, 5] },
    { moment: "weekday lunch", wants: "Something quick and filling you don't have to think about", orders: [2, 6] },
    { moment: "late night", wants: "Something crispy and indulgent", orders: [7] },
  ],
  mightLike: [
    { item: "Mutton Haleem", category: "Hyderabadi", why: "Slow-cooked overnight like the dum biryani you love, richer and deeper, and it comes with a sweet.", reach: "near", orders: [1, 3, 5] },
    { item: "Kolkata Chicken Biryani", category: "Bengali", why: "Your biryani, lighter on spice, with the potato and egg Kolkata adds: the same comfort, one new thing.", reach: "near", orders: [1, 3, 4] },
    { item: "Double ka Meetha", category: "Hyderabadi", why: "The Hyderabadi bread pudding people finish a biryani with, for the sweet tooth that orders gulab jamun.", reach: "near", orders: [1, 3, 5] },
  ],
  city: "Bengaluru",
}, RIYA_ORDERS, featuresOf(RIYA_ORDERS), PORTRAIT_NOW)!;

/** Pages as the web search would bring back for her hunches, and the picks the model would make from them, checked. */
const PAGES = [
  { url: "https://www.reddit.com/r/bangalore/comments/haleem_koramangala", text: "Where to get good haleem near Koramangala? We went to Shah Ghouse on 5th Block last Friday. The haleem here is cooked overnight and it shows, thick, peppery, the meat just melts. Paid 280 for a plate and got double ka meetha on the side. Queue at 8 pm but worth it. ".repeat(2) },
  { url: "https://www.zomato.com/bangalore/oh-calcutta-koramangala/reviews", text: "Oh! Calcutta, Koramangala. Reviews. The Kolkata biryani was fragrant and mild, the potato had soaked up everything, best I have had outside Kolkata. Ordered twice in one week. ".repeat(3) },
];
export const RIYA_PICKS = picksFrom({
  picks: [
    { place: "Shah Ghouse", item: "Mutton Haleem", why: "You love slow-cooked, rich biryani. This haleem is cooked overnight, and they serve double ka meetha with it for your sweet finish.", said: "The haleem here is cooked overnight and it shows, thick, peppery, the meat just melts.", from: 1, hunch: 1 },
    { place: "Oh! Calcutta", item: "Kolkata Chicken Biryani", why: "Your Saturday biryani, a little milder, with the potato Kolkata adds. Close to what you trust, and new.", said: "The Kolkata biryani was fragrant and mild, the potato had soaked up everything", from: 2, hunch: 2 },
  ],
}, RIYA_TASTE.mightLike, PAGES);

const DAY = 86_400_000;
export const RIYA_PORTRAIT = {
  ...portraitOf(SITE, RIYA_ORDERS, PORTRAIT_NOW, PORTRAIT_NOW - 2 * 3_600_000),
  taste: tasteView(RIYA_TASTE), picks: RIYA_PICKS.map(pickView),
  ready: readyFor({ site: SITE, orders: RIYA_ORDERS, chooser: RIYA_TASTE.chooser, picks: RIYA_PICKS }, PORTRAIT_NOW),
  did: [
    { kind: "found" as const, title: "Found 2 new places you'd like", line: "Mutton Haleem at Shah Ghouse, Kolkata Chicken Biryani at Oh! Calcutta", at: PORTRAIT_NOW - 3 * 3_600_000 },
    { kind: "arrived" as const, title: "Kept an eye on Behrouz Biryani until it arrived", line: "Delivered at 9:22 pm", at: PORTRAIT_NOW - 5 * DAY },
    { kind: "cart" as const, title: "Filled your cart at Behrouz Biryani", line: "Chicken Dum Biryani and Gulab Jamun (2 pcs)", at: PORTRAIT_NOW - 5 * DAY - 3_600_000 },
  ],
};

/** The same person on Amazon: a detergent bought every four weeks and due now, hair oil, a protein tub. The same pipeline. */
const AMAZON = "amazon.in";
const buy = (n: number, local: string, place: string, name: string, total: number): SiteOrder => ({
  key: `no:40${n}`, site: AMAZON, place, local, total, seenAt: PORTRAIT_NOW, items: [{ name, qty: 1 }],
});
export const RIYA_AMAZON: SiteOrder[] = [
  buy(1, "2026-10-31T21:00", "Surf Excel", "Surf Excel Matic Liquid Detergent 2L Refill Pack", 420),
  buy(2, "2026-10-22T10:10", "Mamaearth", "Mamaearth Onion Hair Oil 250ml", 349),
  buy(3, "2026-10-03T20:40", "Surf Excel", "Surf Excel Matic Liquid Detergent 2L Refill Pack", 420),
  buy(4, "2026-09-20T11:00", "MuscleBlaze", "MuscleBlaze Whey Protein 1kg Chocolate", 2199),
  buy(5, "2026-09-05T21:15", "Surf Excel", "Surf Excel Matic Liquid Detergent 2L Refill Pack", 410),
  buy(6, "2026-08-24T10:30", "Mamaearth", "Mamaearth Onion Hair Oil 250ml", 349),
  buy(7, "2026-08-08T20:05", "Surf Excel", "Surf Excel Matic Liquid Detergent 2L Refill Pack", 410),
];
export const RIYA_AMAZON_PORTRAIT = {
  ...portraitOf(AMAZON, RIYA_AMAZON, PORTRAIT_NOW, PORTRAIT_NOW - 3_600_000),
  ready: readyFor({ site: AMAZON, orders: RIYA_AMAZON, chooser: "creature of habit", picks: [{
    place: "Minimalist", item: "Minimalist Rosemary Hair Growth Oil", category: "Personal care", reach: "near",
    why: "You keep coming back to a natural hair oil. This one is lighter, and people say it isn't greasy.",
    said: "It is not greasy at all and my hairfall dropped noticeably by week six.", host: "reddit.com", url: "https://www.reddit.com/r/IndianSkincareAddicts/x",
  }] }, PORTRAIT_NOW),
  did: [{ kind: "cart" as const, title: "Filled your cart with Surf Excel Matic Liquid Detergent 2L Refill Pack", line: "Amazon", at: PORTRAIT_NOW - 26 * DAY }],
};
export const AMAZON_PORTRAIT_API: Record<string, unknown> = {
  "GET /v1/botsapp/bots/sites/portrait/amazon.in": { portrait: RIYA_AMAZON_PORTRAIT },
};

/** What Talk would answer "order my usual" with, at that moment. */
export function riyaPlan(words = "order my usual") {
  const options = planOrder([{ site: SITE, orders: RIYA_ORDERS, chooser: RIYA_TASTE.chooser, picks: RIYA_PICKS }], readOrderAsk(words)!, PORTRAIT_NOW, 330);
  return { options, line: planLine(options), token: orderToken(options) };
}

/** The portrait page's answer (screens/sites/forYou.ts). */
export const SITE_PORTRAIT_API: Record<string, unknown> = {
  "GET /v1/botsapp/bots/sites/portrait/swiggy.com": { portrait: RIYA_PORTRAIT },
};

/** Talk, asked "order my usual" at dinner time: Talk's own answer, with the order card under it (screens/sites/orderCard.ts). */
export function talkOrderApi(): Record<string, unknown> {
  const plan = riyaPlan();
  const TALK = { slug: "talk", name: "Talk", color: "#4A535C" };
  return {
    "GET /v1/botsapp/talk?limit=40": {
      session: "s-talk-1", people: [], commands: [{ name: "new", line: "Start a new thread" }],
      turns: [
        { id: "o1", role: "me", text: "order my usual", at: PORTRAIT_NOW - 60_000, opens: [], approvals: [], paise: 0 },
        { id: "o2", role: "bot", text: plan.line, at: PORTRAIT_NOW - 59_000, opens: [], approvals: [], paise: 0, by: TALK, did: { order: plan.token } },
      ],
    },
  };
}

/** The order screen's params: the usual, as the card hands it over. */
export const orderParams = (): Record<string, string> => ({ o: orderToken(riyaPlan().options.slice(0, 1)) });

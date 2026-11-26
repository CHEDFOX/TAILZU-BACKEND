/**
 * A PERSON'S SWIGGY ORDERS for the render check (screens/sites/portrait.ts, screens/sites/order.ts, the order card in Talk;
 * docs/site-portrait.md): seven weeks of Riya's dinners and lunches in Koramangala, as the orders page would have shown them.
 *
 * The orders are the input; everything drawn is made from them by the real code (portraitOf, planOrder), so the render
 * shows what the server would really send for this history, not a picture of one.
 */
import { portraitOf } from "../../../src/sites/history/portrait.js";
import { planLine, planOrder } from "../../../src/sites/history/plan.js";
import { readOrderAsk } from "../../../src/sites/history/ask.js";
import { orderToken } from "../../../src/sites/history/token.js";
import type { SiteOrder } from "../../../src/sites/history/types.js";

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

export const RIYA_PORTRAIT = portraitOf(SITE, RIYA_ORDERS, PORTRAIT_NOW, PORTRAIT_NOW - 2 * 3_600_000);

/** What Talk would answer "order my usual" with, at that moment. */
export function riyaPlan(words = "order my usual") {
  const options = planOrder([{ site: SITE, orders: RIYA_ORDERS }], readOrderAsk(words)!, PORTRAIT_NOW, 330);
  return { options, line: planLine(options), token: orderToken(options) };
}

/** The portrait page's answer (screens/sites/portrait.ts). */
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

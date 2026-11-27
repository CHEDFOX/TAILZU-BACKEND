/**
 * WHAT A PERSON HAS ORDERED ON A SITE, AND WHAT THAT SAYS ABOUT THEM (docs/site-portrait.md).
 *
 *   SiteOrder     one order, as the site's own orders page showed it: the place, the dishes, what it cost, when
 *   SitePortrait  what their orders add up to: the places, the dishes, the times, the spend, the one they keep coming back to
 *   OrderOption   one order X0 would place for them, and why it picked it
 *
 * Every field of an order is what the SITE wrote. Nothing is guessed: an order with no price has no price, and a time the
 * page did not show is no time at all.
 */

export interface OrderItem {
  /** As the site names the item ("Chicken Dum Biryani"). */
  name: string;
  qty: number;
  /** Its picture as the site shows it, from the site's own image servers (pictures.ts). */
  image?: string;
}

export interface SiteOrder {
  /** Stable across reads: the site's own order number where the page shows one, else the order's place, time and dishes. */
  key: string;
  site: string;
  /** The restaurant, as the site names it. */
  place: string;
  /** Its area ("Koramangala"), when the page says. */
  area?: string;
  items: OrderItem[];
  /** In rupees, as paid. */
  total?: number;
  /**
   * When it was placed, in the page's own local time, "2026-11-21T20:40". Kept as the page's wall clock on purpose: "a
   * Friday at 8:40 pm" is the fact, and it stays the fact whatever time zone the server is in.
   */
  local?: string;
  /** The restaurant's own page on the site, when the orders page links to it. Always on the site's host. */
  link?: string;
  cancelled?: true;
  /** The restaurant's or shop's picture as the orders page showed it (pictures.ts). */
  image?: string;
  /** When X0 first saw it, epoch ms. */
  seenAt: number;
}

/** The parts of a day food is ordered in, by the hour on the page's clock. */
export const SLOTS = ["breakfast", "lunch", "evening", "dinner", "late"] as const;
export type Slot = (typeof SLOTS)[number];

export interface PlacePortrait {
  place: string;
  area?: string;
  link?: string;
  count: number;
  /** Of all their orders on this site. */
  share: number;
  lastLocal?: string;
  /** Their dishes here, most ordered first. */
  dishes: Array<{ name: string; count: number }>;
  /** What one order here usually comes to, in rupees. */
  usualTotal?: number;
}

/** A thing they order again and again: one place, the same dishes. */
export interface Usual {
  place: string;
  link?: string;
  items: OrderItem[];
  count: number;
  /** When it is usually ordered, if there is a when. */
  slot?: Slot;
  day?: number;
  total?: number;
}

export interface SitePortrait {
  site: string;
  /** The site's name, as people say it ("Swiggy"). */
  name: string;
  /** Orders that went through; a cancelled one is not something they ate. */
  orders: number;
  since?: string;
  last?: SiteOrder;
  /** The newest few, for the portrait's "Lately". */
  recent: SiteOrder[];
  places: PlacePortrait[];
  dishes: Array<{ name: string; place: string; count: number }>;
  slots: Array<{ slot: Slot; count: number }>;
  /** Sunday is 0, as Date counts. */
  days: Array<{ day: number; count: number }>;
  spend: { median?: number; month?: number; total?: number };
  /** The order they come back to most, if any comes back. */
  usual?: Usual;
  /** What X0 has noticed, in plain sentences: free to make, the same every time. */
  noticed: string[];
  readAt?: number;
  /** Their taste, worked out from the orders (taste/profile.ts): absent until there is one. */
  taste?: TasteView;
  /** New places found for it on the web (taste/discover.ts), each vouched for by a reviewer's own words. */
  picks?: PickView[];
  /** WHAT X0 HAS READY FOR THEM here, best first: their usual, what is due again, something new (plan.ts planOrder). */
  ready?: OrderOption[];
  /** WHAT X0 DID FOR THEM here, newest first: carts filled, new places found, orders seen through to the door. */
  did?: DidView[];
}

export interface DidView { kind: "cart" | "found" | "arrived"; title: string; line?: string; at: number; image?: string }

/** The taste as a screen and a bot see it: the conclusions, never the evidence numbers behind them. */
export interface TasteView {
  insights: string[];
  palate: string[];
  motives: string[];
  moods: Array<{ moment: string; wants: string }>;
  mightLike: Array<{ item: string; category: string; why: string; reach: "near" | "stretch" }>;
  chooser: "creature of habit" | "explorer" | "balanced";
}

export interface PickView { place: string; item: string; category: string; why: string; said: string; host: string; reach: "near" | "stretch" }

export interface OrderOption {
  site: string;
  place: string;
  area?: string;
  items: OrderItem[];
  /** What it came to last time, in rupees: an estimate, said as one. */
  total?: number;
  /** One line on why this one ("Your usual Friday dinner"). */
  why: string;
  /** Where the order starts: the restaurant's own page, or the site's search for it. On the site's host. */
  url: string;
  /** Nothing they have ordered matches: the site's search for their words, with no dishes to add. */
  search?: true;
  /** Somewhere new X0 thinks they will love (taste/discover.ts): drawn as "New for you", with what a reviewer said. */
  fresh?: true;
  said?: string;
  host?: string;
  /** The picture on its card: the site's own photo of the dish or product, or a free photo of something new. */
  image?: string;
  /** Who took it, for a free photo whose licence asks for a credit. */
  credit?: string;
}

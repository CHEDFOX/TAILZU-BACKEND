/**
 * WHAT TO ORDER FOR THEM, AND WHY (docs/site-portrait.md).
 *
 *   planOrder(histories, ask, now, tz)   up to three orders, the best first, each with one line on why it was picked
 *   startUrl(site, place, link)          where an order starts on the site: the restaurant's own page, else its search
 *
 * BY RULES, NOT A MODEL, and for the same reason the portrait is: "order my usual" has one right answer and it should be
 * the same answer every time it is asked. What it weighs, all of it counted from their own orders:
 *
 *   what they said     a dish or a place they named ("biryani", "from Truffles") picks from the orders that match it
 *   "the usual"        the order they come back to most; "same as last time", the newest one
 *   the time           what they order at this part of the day, on this day of the week
 *   how often, how lately
 *
 * When they name something they have never ordered there, the honest answer is the site's own search for it, said as that.
 * When they have no history at all there is no plan: Talk answers in words, as it did before.
 */
import { catalogFor } from "../catalog.js";
import type { OrderAsk } from "./ask.js";
import { comboKey, dayOf, dishWords, DAY_NAMES, hourOf, SLOT_WORDS, slotOf } from "./portrait.js";
import type { OrderItem, OrderOption, SiteOrder, Slot } from "./types.js";

/** The most options a plan offers: one to tap, and two in case tonight is different. */
export const OPTIONS_MAX = 3;

export interface SiteHistory { site: string; orders: readonly SiteOrder[] }

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").replace(/\s+/g, " ").trim();

/** Where an order starts on a site: the restaurant's own page if it is known, else the site's search for it, else the site. */
export function startUrl(site: string, place: string, link?: string): string {
  if (link) {
    try {
      const u = new URL(link);
      if (u.protocol === "https:" && (u.hostname === site || u.hostname.endsWith(`.${site}`))) return u.href;
    } catch { /* a link that is not an address is no link */ }
  }
  const search = catalogFor(site)?.search;
  return search ? search.replace("{q}", encodeURIComponent(place)) : `https://www.${site}/`;
}

/** Their wall clock now, in the same form an order's time is kept in. */
export function localNow(now: number, tz: number): string {
  return new Date(now + tz * 60_000).toISOString().slice(0, 16);
}

/** "today", "yesterday", "3 days ago", "2 weeks ago": how long since a local time, on their own calendar. */
export function agoWords(local: string, nowLocal: string): string {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const days = Math.round((day(nowLocal) - day(local)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

interface Combo {
  site: string;
  place: string;
  area?: string;
  items: OrderItem[];
  link?: string;
  orders: SiteOrder[];
}

function combosOf(h: SiteHistory): Combo[] {
  const by = new Map<string, Combo>();
  for (const o of h.orders) {
    if (o.cancelled) continue;
    const k = comboKey(o);
    const had = by.get(k);
    if (had) { had.orders.push(o); if (!had.link && o.link) had.link = o.link; continue; }
    by.set(k, {
      site: h.site, place: o.place, items: o.items, orders: [o],
      ...(o.area ? { area: o.area } : {}), ...(o.link ? { link: o.link } : {}),
    });
  }
  return [...by.values()];
}

/** How many of the words they said this combo answers: its place and its dishes. */
function matches(c: Combo, want: readonly string[]): number {
  if (!want.length) return 0;
  const hay = ` ${norm(`${c.place} ${c.items.map((i) => i.name).join(" ")}`)} `;
  return want.filter((w) => hay.includes(` ${w}`)).length;
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

interface Scored { c: Combo; score: number; why: string }

function score(c: Combo, ask: OrderAsk, slot: Slot, day: number, nowLocal: string, newestKey: string | undefined): Scored {
  const n = c.orders.length;
  const inSlot = c.orders.filter((o) => { const h = hourOf(o.local); return h !== undefined && slotOf(h) === slot; }).length;
  const onDay = c.orders.filter((o) => dayOf(o.local) === day).length;
  const newest = c.orders[0]!;
  const isLast = !!newestKey && newest.key === newestKey;
  const fresh = newest.local ? agoWords(newest.local, nowLocal) : "";
  const recent = !!newest.local && /^(today|yesterday|\d+ days ago)$/.test(fresh);
  const hit = matches(c, ask.want);

  let s = Math.log2(1 + n) * 3 + (inSlot / n) * 4 + (onDay >= 2 ? 1.5 : 0) + (recent ? 1 : 0) + hit * 10;
  if (ask.usual) s += n * 2;
  if (ask.last && isLast) s += 50;

  // The one line, from the strongest thing that is true of it: what X0 concluded, not the counting behind it.
  let why: string;
  if (ask.last && isLast) why = "Same as your last order";
  else if (n >= 3 && onDay >= 2 && onDay / n >= 0.5) why = `Your usual ${DAY_NAMES[day]} ${SLOT_WORDS[slot]}`;
  else if (n >= 2 && inSlot / n >= 0.5) why = `Your usual ${SLOT_WORDS[slot]}`;
  else if (n >= 2) why = "One of your regulars";
  else why = "Something you've liked before";
  return { c, score: s, why };
}

function optionOf(x: Scored): OrderOption {
  const total = median(x.c.orders.map((o) => o.total).filter((t): t is number => !!t));
  return {
    site: x.c.site, place: x.c.place, items: x.c.items, why: x.why,
    url: startUrl(x.c.site, x.c.place, x.c.link),
    ...(x.c.area ? { area: x.c.area } : {}), ...(total ? { total } : {}),
  };
}

/**
 * The orders to offer, best first. Empty when there is nothing to go on: no history on any site that can take an order.
 * Distinct places where it can, so the second option is a real alternative and not the first one again with raita.
 */
export function planOrder(histories: readonly SiteHistory[], ask: OrderAsk, now: number, tz: number): OrderOption[] {
  const usable = histories.filter((h) => (!ask.site || h.site === ask.site) && h.orders.some((o) => !o.cancelled));
  if (!usable.length) return [];
  const nowLocal = localNow(now, tz);
  const slot = ask.slot ?? slotOf(hourOf(nowLocal) ?? 20);
  const day = dayOf(nowLocal) ?? 5;
  const newest = usable.flatMap((h) => h.orders.filter((o) => !o.cancelled))
    .sort((a, b) => (b.local ?? "").localeCompare(a.local ?? "") || b.seenAt - a.seenAt)[0];

  const all = usable.flatMap(combosOf).map((c) => score(c, ask, slot, day, nowLocal, newest?.key));
  const named = ask.want.length ? all.filter((x) => matches(x.c, ask.want) > 0) : all;

  // They named a thing they have never had here: the site's own search for it comes first, and what they usually have after.
  const out: OrderOption[] = [];
  if (ask.want.length && !named.length) {
    const site = ask.site && catalogFor(ask.site)?.search ? ask.site : usable.find((h) => catalogFor(h.site)?.search)?.site;
    const words = ask.want.join(" ");
    if (site) {
      out.push({
        site, place: words, items: [], search: true, url: startUrl(site, words),
        why: `You haven't ordered ${words} on ${catalogFor(site)?.name ?? site} before. I'll open its search.`,
      });
    }
  }

  const pool = (named.length ? named : all).sort((a, b) => b.score - a.score);
  const places = new Set<string>();
  for (const x of pool) {
    if (out.length >= OPTIONS_MAX) break;
    const p = norm(x.c.place);
    if (places.has(p)) continue;
    places.add(p);
    out.push(optionOf(x));
  }
  return out;
}

/** The line Talk says over the card: the first option, said the way a person would. */
export function planLine(options: readonly OrderOption[]): string {
  const first = options[0];
  if (!first) return "";
  if (first.search) return first.why;
  const others = options.length - 1;
  return `Ready when you are: ${dishWords(first.items)} from ${first.place}.${others ? ` ${others === 1 ? "One other idea" : `${others === 2 ? "Two" : others} other ideas`} below.` : ""}`;
}

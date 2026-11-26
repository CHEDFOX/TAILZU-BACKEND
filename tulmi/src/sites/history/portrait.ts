/**
 * WHAT SOMEBODY'S ORDERS SAY ABOUT THEM (docs/site-portrait.md).
 *
 *   portraitOf(site, orders, now)   the places, the dishes, the times of day, the days, the spend, the one they come back to,
 *                                    and a few plain sentences about it
 *
 * BY RULES, NOT A MODEL. A portrait is read every time Talk is asked for food and every time the page is opened, so it has
 * to be free and it has to say the same thing twice. Everything here is counting: a habit is a thing that happened again,
 * and nothing is said that the orders do not show. A person who ordered once has a portrait of one order, said as one.
 */
import { catalogFor } from "../catalog.js";
import { SLOTS, type OrderItem, type PlacePortrait, type SiteOrder, type SitePortrait, type Slot, type Usual } from "./types.js";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").replace(/\s+/g, " ").trim();

export function hourOf(local: string | undefined): number | undefined {
  const m = /T(\d{2}):/.exec(local ?? "");
  return m ? Number(m[1]) : undefined;
}

export function dayOf(local: string | undefined): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(local ?? "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : undefined;
}

/** The part of the day an hour is in, as people eat in India: lunch runs late, dinner later. */
export function slotOf(hour: number): Slot {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 19) return "evening";
  if (hour >= 19 && hour < 23) return "dinner";
  return "late";
}

export const SLOT_WORDS: Record<Slot, string> = {
  breakfast: "breakfast", lunch: "lunch", evening: "evening snack", dinner: "dinner", late: "late-night order",
};

export function hourWords(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "am" : "pm"}`;
}

/** "Chicken Biryani", "Chicken Biryani and Raita", "Chicken Biryani, Raita and 2 more". */
export function dishWords(items: readonly OrderItem[]): string {
  const names = items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name));
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

export const money = (n: number): string => `₹${Math.round(n).toLocaleString("en-IN")}`;

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1]! + s[mid]!) / 2;
}

/** The value seen most often, when it is at least `share` of them. */
function modal<T>(xs: readonly T[], share: number): T | undefined {
  if (!xs.length) return undefined;
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  const [best, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return n / xs.length >= share ? best : undefined;
}

/** One place and the same dishes, whatever the quantities: what "the usual" is. */
export const comboKey = (o: Pick<SiteOrder, "place" | "items">): string =>
  `${norm(o.place)}|${o.items.map((i) => norm(i.name)).sort().join("+")}`;

function usualOf(orders: readonly SiteOrder[]): Usual | undefined {
  const by = new Map<string, SiteOrder[]>();
  for (const o of orders) by.set(comboKey(o), [...(by.get(comboKey(o)) ?? []), o]);
  // Newest first already, so the first of a tie is the one ordered most lately.
  const best = [...by.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 2) return undefined;
  const newest = best[0]!;
  const hours = best.map((o) => hourOf(o.local)).filter((h): h is number => h !== undefined);
  const days = best.map((o) => dayOf(o.local)).filter((d): d is number => d !== undefined);
  const slot = modal(hours.map(slotOf), 0.5);
  const day = best.length >= 3 ? modal(days, 0.5) : undefined;
  const total = median(best.map((o) => o.total).filter((t): t is number => !!t));
  const link = best.find((o) => o.link)?.link;
  return {
    place: newest.place, items: newest.items, count: best.length,
    ...(slot ? { slot } : {}), ...(day !== undefined ? { day } : {}), ...(total ? { total } : {}), ...(link ? { link } : {}),
  };
}

function placesOf(orders: readonly SiteOrder[]): PlacePortrait[] {
  const by = new Map<string, SiteOrder[]>();
  for (const o of orders) by.set(norm(o.place), [...(by.get(norm(o.place)) ?? []), o]);
  return [...by.values()].map((os) => {
    const dishes = new Map<string, { name: string; count: number }>();
    for (const o of os) for (const i of o.items) {
      const k = norm(i.name);
      const had = dishes.get(k);
      dishes.set(k, { name: had?.name ?? i.name, count: (had?.count ?? 0) + 1 });
    }
    const usualTotal = median(os.map((o) => o.total).filter((t): t is number => !!t));
    const link = os.find((o) => o.link)?.link;
    const area = os.find((o) => o.area)?.area;
    return {
      place: os[0]!.place, count: os.length, share: os.length / orders.length,
      dishes: [...dishes.values()].sort((a, b) => b.count - a.count).slice(0, 6),
      ...(os[0]!.local ? { lastLocal: os[0]!.local } : {}),
      ...(usualTotal ? { usualTotal } : {}), ...(link ? { link } : {}), ...(area ? { area } : {}),
    };
  }).sort((a, b) => b.count - a.count || (b.lastLocal ?? "").localeCompare(a.lastLocal ?? "")).slice(0, 8);
}

/**
 * The few plain sentences at the top of a portrait: what X0 concluded, never the counting behind it (no "6 times", no
 * percentages). Each one only when the orders show it.
 */
function noticedOf(p: Omit<SitePortrait, "noticed">, valid: readonly SiteOrder[]): string[] {
  const out: string[] = [];
  if (p.usual) out.push(`${dishWords(p.usual.items)} from ${p.usual.place} is your go-to.`);
  const topSlot = [...p.slots].sort((a, b) => b.count - a.count)[0];
  const timed = p.slots.reduce((n, s) => n + s.count, 0);
  if (topSlot && topSlot.count >= 2 && topSlot.count / Math.max(1, timed) >= 0.4) {
    const hours = valid.map((o) => hourOf(o.local)).filter((h): h is number => h !== undefined && slotOf(h) === topSlot.slot);
    const h = median(hours);
    out.push(`You mostly order ${SLOT_WORDS[topSlot.slot]}${h !== undefined ? `, around ${hourWords(Math.round(h))}` : ""}.`);
  }
  const topDay = [...p.days].sort((a, b) => b.count - a.count)[0];
  const dated = p.days.reduce((n, d) => n + d.count, 0);
  if (topDay && dated >= 5 && topDay.count / dated >= 0.25) out.push(`${DAY_NAMES[topDay.day]} is your food day.`);
  const top = p.places[0];
  if (top && p.orders >= 4 && top.share >= 0.4) out.push(`${top.place} is your favourite place.`);
  else if (p.orders >= 4 && p.places.length >= 3) out.push("You like trying new places.");
  if (p.spend.median && valid.filter((o) => o.total).length >= 3) out.push(`An order usually comes to about ${money(p.spend.median)}.`);
  return out.slice(0, 5);
}

export function portraitOf(site: string, all: readonly SiteOrder[], now = Date.now(), readAt?: number): SitePortrait {
  const valid = all.filter((o) => !o.cancelled);
  const slots = new Map<Slot, number>(SLOTS.map((s) => [s, 0]));
  const days = new Map<number, number>([0, 1, 2, 3, 4, 5, 6].map((d) => [d, 0]));
  for (const o of valid) {
    const h = hourOf(o.local), d = dayOf(o.local);
    if (h !== undefined) slots.set(slotOf(h), (slots.get(slotOf(h)) ?? 0) + 1);
    if (d !== undefined) days.set(d, (days.get(d) ?? 0) + 1);
  }
  const dishes = new Map<string, { name: string; place: string; count: number }>();
  for (const o of valid) for (const i of o.items) {
    const k = `${norm(o.place)}|${norm(i.name)}`;
    const had = dishes.get(k);
    dishes.set(k, { name: had?.name ?? i.name, place: had?.place ?? o.place, count: (had?.count ?? 0) + 1 });
  }
  const totals = valid.map((o) => o.total).filter((t): t is number => !!t);
  const monthAgo = new Date(now - 30 * 86_400_000).toISOString().slice(0, 16);
  const month = valid.filter((o) => (o.local ?? "") >= monthAgo).reduce((n, o) => n + (o.total ?? 0), 0);
  const dated = valid.map((o) => o.local).filter((l): l is string => !!l).sort();
  const spendMedian = median(totals);
  const usual = usualOf(valid);
  const base: Omit<SitePortrait, "noticed"> = {
    site, name: catalogFor(site)?.name ?? site, orders: valid.length,
    places: placesOf(valid),
    recent: valid.slice(0, 5),
    dishes: [...dishes.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    slots: SLOTS.map((s) => ({ slot: s, count: slots.get(s) ?? 0 })),
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, count: days.get(d) ?? 0 })),
    spend: {
      ...(spendMedian ? { median: spendMedian } : {}),
      ...(month ? { month } : {}),
      ...(totals.length ? { total: totals.reduce((a, b) => a + b, 0) } : {}),
    },
    ...(dated[0] ? { since: dated[0] } : {}),
    ...(valid[0] ? { last: valid[0] } : {}),
    ...(usual ? { usual } : {}),
    ...(readAt ? { readAt } : {}),
  };
  return { ...base, noticed: noticedOf(base, valid) };
}

/**
 * What a bot is told of it, in a few lines: enough that "the usual" means something to the bot answering, nothing it
 * could spend. Data, never an instruction: every name in it was written by a site.
 */
export function portraitLines(p: SitePortrait): string[] {
  if (!p.orders) return [];
  const lines = [`${p.name}: ${p.orders} orders read from their orders page.`];
  if (p.usual) lines.push(`Their usual there: ${dishWords(p.usual.items)} from ${p.usual.place}${p.usual.slot ? `, for ${SLOT_WORDS[p.usual.slot]}` : ""}.`);
  const top = p.places.slice(0, 3).map((x) => x.place);
  if (top.length) lines.push(`Places they order from most: ${top.join(", ")}.`);
  // Their taste, when it has been worked out: what they love and why, and what they would probably love next.
  if (p.taste) {
    lines.push(...p.taste.insights.slice(0, 3));
    if (p.taste.mightLike.length) lines.push(`They would probably love: ${p.taste.mightLike.slice(0, 3).map((h) => h.dish).join(", ")}.`);
    if (p.picks?.length) lines.push(`New places found for them: ${p.picks.slice(0, 2).map((x) => `${x.dish} at ${x.place}`).join("; ")}.`);
    return lines;
  }
  return lines.concat(p.noticed.slice(p.usual ? 1 : 0, (p.usual ? 1 : 0) + 2));
}

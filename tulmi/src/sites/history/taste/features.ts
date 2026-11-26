/**
 * THE SIGNALS IN WHAT SOMEBODY BUYS, ON ANY SITE (docs/site-portrait.md §2b). Rules, no model: free, the same every time,
 * and what the taste profile (profile.ts) reasons FROM, so the model starts from evidence and not from a hunch.
 *
 *   featuresOf(orders, kind)   what each item says (its category, its traits) and how the person chooses
 *   rebuysOf(orders, nowLocal) the things they buy again and again, how often, and which are due
 *   chooserOf(features)        creature of habit, explorer or balanced: the one judgement the planner acts on
 *
 * Two kinds of signal, the same on every site:
 *
 *   WHAT THEY REACH FOR   the item's category and traits, from the kind's own lexicon (history/kinds.ts): a dish's cuisine and
 *                         heat, a product's category and whether it is a value pack. Weighted by how often it was bought.
 *   HOW THEY REACH FOR IT the share of orders that were a first time at that place (explore), exact repeats, how wide their
 *                         categories run (Shannon entropy, normalised: 0 one category, 1 all alike), what each moment of the
 *                         week wants, and the rhythm of what they buy again (rebuysOf). These need no lexicon at all.
 *
 * Every signal keeps the orders it came from (by index into the list the profile is shown), so a trait the model writes
 * can be checked against something that happened.
 */
import { KINDS, type KindSpec } from "../kinds.js";
import type { SiteOrder } from "../types.js";
import { dayOf, hourOf, slotOf } from "../portrait.js";

export interface Signal { name: string; weight: number; orders: number[] }

export interface TasteFeatures {
  kind: KindSpec["kind"];
  /** Orders that went through: the evidence list the profile is shown (indices below point into it). */
  orders: number;
  traits: Array<{ trait: string; share: number; orders: number[] }>;
  categories: Signal[];
  /** Of their orders, the share that was the first time at that place: 0 the same few places, 1 somewhere new every time. */
  explore: number;
  /** The share of orders that repeat an earlier order exactly (the same place and items). */
  repeat: number;
  /** 0: one category. 1: every category they ever bought, equally. */
  breadth: number;
  /** What each part of the week costs and wants, where they buy at it. */
  moments: Array<{ moment: string; orders: number; medianSpend?: number; traits: string[]; categories: string[] }>;
  /** Where they order to, most often first: what a search for somewhere new is near. */
  areas: string[];
}

const ratio = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) / 100 : 0);
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").replace(/\s+/g, " ").trim();

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One order's words: its place and its items, for the lexicons. */
const wordsOf = (o: Pick<SiteOrder, "place" | "items">): string => `${o.place} ${o.items.map((i) => i.name).join(" ")}`;

/** The category an order is: its items' first, its place's as the fallback. */
export function categoryOf(o: Pick<SiteOrder, "place" | "items">, k: KindSpec = KINDS.food): string | undefined {
  const items = o.items.map((i) => i.name).join(" ");
  return k.categories.find(([, re]) => re.test(items))?.[0] ?? k.categories.find(([, re]) => re.test(o.place))?.[0];
}

export function traitsOf(text: string, k: KindSpec = KINDS.food): string[] {
  return k.traits.filter(([, re]) => re.test(text)).map(([t]) => t);
}

/** The moment an order belongs to: weekday or weekend, and the part of the day. "weekend dinner", "weekday lunch". */
export function momentOf(local: string | undefined): string | undefined {
  const h = hourOf(local), d = dayOf(local);
  if (h === undefined || d === undefined) return undefined;
  const slot = slotOf(h);
  if (slot === "late") return "late night";
  const weekend = d === 0 || d === 6 || (d === 5 && h >= 19);
  return `${weekend ? "weekend" : "weekday"} ${slot}`;
}

export function featuresOf(all: readonly SiteOrder[], k: KindSpec = KINDS.food): TasteFeatures {
  const orders = all.filter((o) => !o.cancelled);
  const n = orders.length;
  // Oldest first: "the first time at a place" only means something read forwards.
  const forwards = [...orders].sort((a, b) => (a.local ?? "").localeCompare(b.local ?? ""));

  const traitHits = new Map<string, number[]>(k.traits.map(([t]) => [t, []]));
  const category = new Map<string, number[]>();
  orders.forEach((o, i) => {
    for (const t of traitsOf(wordsOf(o), k)) traitHits.get(t)!.push(i);
    const c = categoryOf(o, k);
    if (c) category.set(c, [...(category.get(c) ?? []), i]);
  });

  const seenPlace = new Set<string>(), seenCombo = new Set<string>();
  let firsts = 0, repeats = 0;
  for (const o of forwards) {
    const place = norm(o.place);
    const combo = `${place}|${o.items.map((x) => norm(x.name)).sort().join("+")}`;
    if (!seenPlace.has(place)) firsts++;
    if (seenCombo.has(combo)) repeats++;
    seenPlace.add(place); seenCombo.add(combo);
  }

  const counts = [...category.values()].map((v) => v.length);
  const total = counts.reduce((a, b) => a + b, 0);
  const entropy = counts.reduce((h, c) => h - (c / total) * Math.log(c / total), 0);
  const breadth = counts.length > 1 ? Math.round((entropy / Math.log(counts.length)) * 100) / 100 : 0;

  const byMoment = new Map<string, SiteOrder[]>();
  for (const o of orders) { const m = momentOf(o.local); if (m) byMoment.set(m, [...(byMoment.get(m) ?? []), o]); }
  const moments = [...byMoment.entries()].sort((a, b) => b[1].length - a[1].length).map(([moment, os]) => {
    const tr = new Map<string, number>();
    for (const o of os) for (const t of traitsOf(wordsOf(o), k)) tr.set(t, (tr.get(t) ?? 0) + 1);
    const ca = new Map<string, number>();
    for (const o of os) { const c = categoryOf(o, k); if (c) ca.set(c, (ca.get(c) ?? 0) + 1); }
    const spend = median(os.map((o) => o.total).filter((t): t is number => !!t));
    return {
      moment, orders: os.length,
      traits: [...tr.entries()].filter(([, c]) => c / os.length >= 0.4).sort((a, b) => b[1] - a[1]).map(([t]) => t),
      categories: [...ca.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c),
      ...(spend ? { medianSpend: spend } : {}),
    };
  });

  const areaCount = new Map<string, number>();
  for (const o of orders) if (o.area) areaCount.set(o.area, (areaCount.get(o.area) ?? 0) + 1);

  return {
    kind: k.kind, orders: n,
    traits: [...traitHits.entries()].filter(([, idx]) => idx.length).map(([trait, idx]) => ({ trait, share: ratio(idx.length, n), orders: idx }))
      .sort((a, b) => b.share - a.share),
    categories: [...category.entries()].map(([name, idx]) => ({ name, weight: ratio(idx.length, n), orders: idx })).sort((a, b) => b.weight - a.weight),
    explore: ratio(firsts, n),
    repeat: ratio(repeats, n),
    breadth,
    moments,
    areas: [...areaCount.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a).slice(0, 3),
  };
}

/** Something they buy again and again, its rhythm, and whether it is due. */
export interface Rebuy {
  name: string;
  place: string;
  link?: string;
  total?: number;
  /** Days between buys, the median of them. */
  everyDays: number;
  last: string;
  /** Today is at least nine tenths of the way to the next one. */
  due: boolean;
}

const dayNo = (local: string): number => Date.UTC(Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 1, Number(local.slice(8, 10))) / 86_400_000;

/**
 * THE THINGS THEY BUY AGAIN, AND WHEN THE NEXT ONE IS DUE. An item bought on three or more different days has a rhythm
 * (the median gap); two days is a coincidence. Due when today is nine tenths of the way to the next one, so the nudge
 * comes a little before they run out and not the day after. Universal: it needs dates and names, nothing else.
 */
export function rebuysOf(all: readonly SiteOrder[], nowLocal: string): Rebuy[] {
  const by = new Map<string, Array<{ day: number; o: SiteOrder; name: string }>>();
  for (const o of all) {
    if (o.cancelled || !o.local) continue;
    for (const it of o.items) {
      const k = norm(it.name);
      if (k.length < 3) continue;
      by.set(k, [...(by.get(k) ?? []), { day: dayNo(o.local), o, name: it.name }]);
    }
  }
  const now = dayNo(nowLocal);
  const out: Rebuy[] = [];
  for (const rows of by.values()) {
    const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b);
    if (days.length < 3) continue;
    const gaps = days.slice(1).map((d, i) => d - days[i]!);
    const every = median(gaps)!;
    if (every < 2) continue;
    const latest = rows.sort((a, b) => b.day - a.day)[0]!;
    out.push({
      name: latest.name, place: latest.o.place, everyDays: every, last: latest.o.local!,
      due: now - days[days.length - 1]! >= every * 0.9,
      ...(latest.o.link ? { link: latest.o.link } : {}), ...(latest.o.total && latest.o.items.length === 1 ? { total: latest.o.total } : {}),
    });
  }
  return out.sort((a, b) => Number(b.due) - Number(a.due) || a.everyDays - b.everyDays);
}

/** What kind of chooser the signals describe, in one word the planner can act on. */
export function chooserOf(f: TasteFeatures): "creature of habit" | "explorer" | "balanced" {
  if (f.orders < 4) return "balanced";
  if (f.repeat >= 0.4 || f.explore <= 0.25) return "creature of habit";
  if (f.explore >= 0.55 || f.breadth >= 0.8) return "explorer";
  return "balanced";
}

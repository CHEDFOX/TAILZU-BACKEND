/**
 * THE SIGNALS IN WHAT SOMEBODY ORDERS (docs/site-portrait.md §2b). Rules, no model: free, the same every time, and what the
 * taste profile (profile.ts) reasons FROM, so the model starts from evidence rather than from a hunch about biryani.
 *
 *   featuresOf(orders)   what each dish says (flavour, cuisine, protein, diet) and how the person chooses (how often they come
 *                        back, how often they try something new, what each part of the day costs and wants)
 *
 * Two kinds of signal, because taste is two things:
 *
 *   THE PALATE    what they reach for: heat, richness, sweetness, smoke, freshness; the cuisines; the proteins; veg or not.
 *                 Read off dish names by word lists, each word one reviewed line, weighted by how often it was ordered.
 *   THE CHOOSER   how they reach for it. Repeat or explore (the share of orders that were a first time at that place) is the
 *                 single best predictor of whether a suggestion should be the usual or something new; how wide their
 *                 cuisines run (an entropy, 0 one cuisine to 1 all of them alike); whether the weekend or the late night is a
 *                 different person from the weekday lunch.
 *
 * Every signal keeps the orders it came from (by index into the list the profile is shown), so a trait the model writes
 * can be checked against something that happened.
 */
import type { SiteOrder } from "../types.js";
import { dayOf, hourOf, slotOf } from "../portrait.js";

export const FLAVOURS = ["spicy", "rich", "sweet", "smoky", "fresh", "tangy"] as const;
export type Flavour = (typeof FLAVOURS)[number];

/** Words in a dish's name that say how it tastes. Indian menus first: that is who orders here. */
const FLAVOUR_WORDS: Record<Flavour, RegExp> = {
  spicy: /\b(?:spicy|chill?i|chilly|mirchi|peri[\s-]?peri|schezwan|szechuan|andhra|chettinad|kolhapuri|vindaloo|laal\s*maas|65|pepper|jalape(?:n|ñ)o|sriracha|hot\b|fiery|ghost|bhut|naga|piri)/i,
  rich: /\b(?:butter|makhani|malai|cheese|cheesy|cream|creamy|korma|biryani|nihari|shahi|mughlai|ghee|lababdar|loaded|alfredo|carbonara|paneer\s+butter|double|mac\s*(?:n|and)\s*cheese)/i,
  sweet: /\b(?:gulab|jamun|rasmalai|rasgulla|kheer|halwa|jalebi|kulfi|brownie|cake|pastry|ice\s*cream|sundae|waffle|pancake|donut|doughnut|cookie|mithai|phirni|shake|dessert|chocolate|tiramisu|cheesecake|falooda)/i,
  smoky: /\b(?:tandoori|tikka|kebab|kabab|seekh|grill(?:ed)?|bbq|barbe(?:cue|que)|smoked|charcoal|roast(?:ed)?|wings|shawarma|burnt|flame)/i,
  fresh: /\b(?:salad|bowl|poke|sushi|grilled\s+veg|steamed|sprouts|quinoa|smoothie|fresh|healthy|lite|light|wrap|millet|oats|greek|lemon)/i,
  tangy: /\b(?:chaat|pani\s*puri|golgappa|tamarind|imli|lime|achari|pickle|kimchi|tom\s*yum|thai|sour|tangy|raw\s+mango|chutney|pav\s*bhaji)/i,
};

/** What a place or a dish says its cuisine is. A dish wins over its place; the place is the fallback. */
const CUISINE_WORDS: Array<[string, RegExp]> = [
  ["Hyderabadi / biryani", /\b(?:biryani|biriyani|haleem|mandi|behrouz|paradise|meghana|bawarchi)/i],
  ["North Indian", /\b(?:butter\s+chicken|dal\s+makhani|paneer|naan|kulcha|roti|tandoori|chole|rajma|punjabi|dhaba|kadai|kadhai)/i],
  ["South Indian", /\b(?:dosa|idli|vada|uttapam|sambar|rasam|appam|chettinad|andhra|kerala|udupi|pongal|meals)/i],
  ["Chinese", /\b(?:noodles|hakka|manchurian|fried\s+rice|schezwan|chilli\s+chicken|chow|dim\s*sum|momos?|wonton|chinese)/i],
  ["Burgers & American", /\b(?:burger|fries|wings|hot\s*dog|nuggets|mac\s*(?:n|and)\s*cheese|truffles|leon|american)/i],
  ["Pizza & Italian", /\b(?:pizza|pasta|lasagna|risotto|garlic\s+bread|alfredo|arrabbiata|italian|calzone)/i],
  ["Mexican", /\b(?:burrito|taco|quesadilla|nachos|enchilada|mexican|chinita|salsa)/i],
  ["Middle Eastern", /\b(?:shawarma|falafel|hummus|kebab|kabab|lebanese|arabian|mandi|pita)/i],
  ["Asian (Thai, Japanese, Korean)", /\b(?:sushi|ramen|thai|curry\s+rice|bibimbap|korean|kimchi|pho|bao|teriyaki|katsu|tom\s*yum|pad\s*thai)/i],
  ["Healthy & bowls", /\b(?:salad|bowl|poke|quinoa|smoothie|healthy|millet|oats|protein)/i],
  ["Desserts & bakery", /\b(?:cake|pastry|brownie|ice\s*cream|waffle|dessert|bakery|cookie|donut|sundae|kulfi)/i],
  ["Café & drinks", /\b(?:coffee|latte|cappuccino|cold\s+brew|tea|chai|frappe|third\s+wave|starbucks|blue\s+tokai)/i],
  ["Street food & chaat", /\b(?:chaat|pani\s*puri|pav\s*bhaji|vada\s+pav|samosa|kachori|rolls?|frankie|kathi)/i],
];

const PROTEIN_WORDS: Array<[string, RegExp]> = [
  ["chicken", /\bchicken|murg|wings\b/i],
  ["mutton", /\bmutton|lamb|goat|gosht|keema\b/i],
  ["seafood", /\bfish|prawn|shrimp|crab|seafood|pomfret|surmai|squid\b/i],
  ["egg", /\begg|anda|omelette\b/i],
  ["paneer", /\bpaneer|cottage\s+cheese\b/i],
  ["beef & pork", /\bbeef|pork|bacon|ham|pepperoni|salami|sausage\b/i],
];
const NON_VEG = /\b(?:chicken|murg|mutton|lamb|goat|gosht|keema|fish|prawn|shrimp|crab|seafood|egg|anda|omelette|beef|pork|bacon|ham|pepperoni|salami|sausage|wings)\b/i;

export interface Signal { name: string; weight: number; orders: number[] }

export interface TasteFeatures {
  /** Orders that went through, the evidence list the profile is shown (indices below point into it). */
  orders: number;
  flavours: Array<{ flavour: Flavour; share: number; orders: number[] }>;
  cuisines: Signal[];
  proteins: Signal[];
  /** Share of dishes that are not vegetarian, by name. Null with nothing to go on. */
  nonVeg: number | null;
  /** Of their orders, the share that was the first time at that place: 0 the same few places, 1 somewhere new every time. */
  explore: number;
  /** The share of orders that repeat an earlier order exactly (the same place and dishes). */
  repeat: number;
  /** 0: one cuisine. 1: every cuisine they ever ordered, equally. Shannon entropy over cuisines, normalised. */
  breadth: number;
  /** What each part of the day costs and wants, where they order at it. */
  moments: Array<{ moment: string; orders: number; medianSpend?: number; flavours: Flavour[]; cuisines: string[] }>;
  /** Where they order to, most often first: what a search for something new is near. */
  areas: string[];
}

const ratio = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) / 100 : 0);

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One order's words: its place and its dishes, for the word lists. */
const wordsOf = (o: SiteOrder): string => `${o.place} ${o.items.map((i) => i.name).join(" ")}`;

export function cuisineOf(o: Pick<SiteOrder, "place" | "items">): string | undefined {
  const dishes = o.items.map((i) => i.name).join(" ");
  return CUISINE_WORDS.find(([, re]) => re.test(dishes))?.[0] ?? CUISINE_WORDS.find(([, re]) => re.test(o.place))?.[0];
}

export function flavoursOf(text: string): Flavour[] {
  return FLAVOURS.filter((f) => FLAVOUR_WORDS[f].test(text));
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

export function featuresOf(all: readonly SiteOrder[]): TasteFeatures {
  // Oldest first: "the first time at a place" only means something read forwards.
  const orders = all.filter((o) => !o.cancelled);
  const n = orders.length;
  const forwards = orders.map((o, i) => ({ o, i })).sort((a, b) => (a.o.local ?? "").localeCompare(b.o.local ?? ""));

  const flavourHits = new Map<Flavour, number[]>(FLAVOURS.map((f) => [f, []]));
  const cuisine = new Map<string, number[]>();
  const protein = new Map<string, number[]>();
  let dishes = 0, nonVeg = 0;
  orders.forEach((o, i) => {
    for (const f of flavoursOf(wordsOf(o))) flavourHits.get(f)!.push(i);
    const c = cuisineOf(o);
    if (c) cuisine.set(c, [...(cuisine.get(c) ?? []), i]);
    for (const it of o.items) {
      dishes++;
      if (NON_VEG.test(it.name)) nonVeg++;
      for (const [p, re] of PROTEIN_WORDS) if (re.test(it.name)) protein.set(p, [...new Set([...(protein.get(p) ?? []), i])]);
    }
  });

  const seenPlace = new Set<string>(), seenCombo = new Set<string>();
  let firsts = 0, repeats = 0;
  for (const { o } of forwards) {
    const place = o.place.toLowerCase().trim();
    const combo = `${place}|${o.items.map((x) => x.name.toLowerCase()).sort().join("+")}`;
    if (!seenPlace.has(place)) firsts++;
    if (seenCombo.has(combo)) repeats++;
    seenPlace.add(place); seenCombo.add(combo);
  }

  const counts = [...cuisine.values()].map((v) => v.length);
  const total = counts.reduce((a, b) => a + b, 0);
  const entropy = counts.reduce((h, c) => h - (c / total) * Math.log(c / total), 0);
  const breadth = counts.length > 1 ? Math.round((entropy / Math.log(counts.length)) * 100) / 100 : 0;

  const byMoment = new Map<string, SiteOrder[]>();
  for (const o of orders) { const m = momentOf(o.local); if (m) byMoment.set(m, [...(byMoment.get(m) ?? []), o]); }
  const moments = [...byMoment.entries()].sort((a, b) => b[1].length - a[1].length).map(([moment, os]) => {
    const fl = new Map<Flavour, number>();
    for (const o of os) for (const f of flavoursOf(wordsOf(o))) fl.set(f, (fl.get(f) ?? 0) + 1);
    const cu = new Map<string, number>();
    for (const o of os) { const c = cuisineOf(o); if (c) cu.set(c, (cu.get(c) ?? 0) + 1); }
    const spend = median(os.map((o) => o.total).filter((t): t is number => !!t));
    return {
      moment, orders: os.length,
      flavours: [...fl.entries()].filter(([, c]) => c / os.length >= 0.4).sort((a, b) => b[1] - a[1]).map(([f]) => f),
      cuisines: [...cu.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c),
      ...(spend ? { medianSpend: spend } : {}),
    };
  });

  const areaCount = new Map<string, number>();
  for (const o of orders) if (o.area) areaCount.set(o.area, (areaCount.get(o.area) ?? 0) + 1);

  const signals = (m: Map<string, number[]>): Signal[] =>
    [...m.entries()].map(([name, idx]) => ({ name, weight: ratio(idx.length, n), orders: idx })).sort((a, b) => b.weight - a.weight);

  return {
    orders: n,
    flavours: FLAVOURS.map((f) => ({ flavour: f, share: ratio(flavourHits.get(f)!.length, n), orders: flavourHits.get(f)! }))
      .filter((f) => f.orders.length).sort((a, b) => b.share - a.share),
    cuisines: signals(cuisine),
    proteins: signals(protein),
    nonVeg: dishes ? ratio(nonVeg, dishes) : null,
    explore: ratio(firsts, n),
    repeat: ratio(repeats, n),
    breadth,
    moments,
    areas: [...areaCount.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a).slice(0, 3),
  };
}

/** What kind of chooser the signals describe, in one word the planner can act on. */
export function chooserOf(f: TasteFeatures): "creature of habit" | "explorer" | "balanced" {
  if (f.orders < 4) return "balanced";
  if (f.repeat >= 0.4 || f.explore <= 0.25) return "creature of habit";
  if (f.explore >= 0.55 || f.breadth >= 0.8) return "explorer";
  return "balanced";
}

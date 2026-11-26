/**
 * A PERSON'S TASTE, WORKED OUT FROM WHAT THEY ORDER (docs/site-portrait.md §2b).
 *
 *   tasteOf(userId, site, orders, deps)   the profile: their palate, what drives their choices, what each moment of the week
 *                                         wants, and what they would probably love but have not had — or null
 *   tasteHash(orders)                     when it is due again: the orders changed
 *
 * WHAT THE PORTRAIT COULD NOT SAY. portrait.ts counts: the usual, the times, the places. That is what someone DID. Taste is
 * WHY: that the biryani, the butter chicken and the Andhra meals are one liking (rich, slow-cooked, heat), that Saturday is
 * a treat and Tuesday is fuel, that this person comes back to what they trust and will try one new thing if it is close
 * enough to it. That needs reading, and the model (role site_taste, the cheap tier, not the tiny one: it has to reason)
 * does it from the signals features.ts counted and the orders themselves.
 *
 * GROUNDED OR DROPPED. Every trait, mood and hypothesis names the orders it rests on, by their numbers in the list it was
 * shown. A claim with no evidence, or evidence that does not exist, is thrown away here — the same rule the review reader
 * keeps with its quotes. A "might like" that is something they have already ordered is not a discovery and is dropped too.
 *
 * NOTHING SENSITIVE. The role is told not to guess religion, caste, health, weight or money worries from food, and "veg"
 * is only ever a preference. What comes back is shown to the person about themselves; it must be something they would
 * nod at, never something that makes them feel watched.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { askJson } from "../../../code/work/model.js";
import { fenced } from "../../../agent/prompt.js";
import { DAY_NAMES, hourWords } from "../portrait.js";
import type { SiteOrder } from "../types.js";
import { chooserOf, featuresOf, momentOf, type TasteFeatures } from "./features.js";
import { KINDS, kindOf, type SiteKind } from "../kinds.js";

/** One profile: a long history read by a reasoning model, once each time the orders change. */
export const SITE_TASTE_PAISE = 90;
/** Orders the model is shown, newest first. Enough to see a pattern and a change in it. */
const SHOWN = 60;
/** Fewer than this and there is no taste to speak of, only a few meals. */
export const TASTE_MIN_ORDERS = 3;

export const TasteReply = z.object({
  insights: z.array(z.string()),
  palate: z.array(z.object({ trait: z.string(), why: z.string(), orders: z.array(z.number()) })),
  motives: z.array(z.object({ trait: z.string(), why: z.string(), orders: z.array(z.number()) })),
  moods: z.array(z.object({ moment: z.string(), wants: z.string(), orders: z.array(z.number()) })),
  mightLike: z.array(z.object({
    item: z.string(), category: z.string(), why: z.string(), reach: z.enum(["near", "stretch"]), orders: z.array(z.number()),
  })),
  city: z.string().optional(),
}).strict();

export interface Trait { trait: string; why: string; orders: number[] }
export interface Mood { moment: string; wants: string; orders: number[] }
export interface Hunch { item: string; category: string; why: string; reach: "near" | "stretch"; orders: number[] }

export interface Taste {
  /** Plain sentences about them, in the second person: what they would nod at. Shown on their portrait. */
  insights: string[];
  palate: Trait[];
  motives: Trait[];
  moods: Mood[];
  /** What they would probably love and have not had. Mostly near what they love; one stretch at most. */
  mightLike: Hunch[];
  chooser: "creature of habit" | "explorer" | "balanced";
  /** The kind of site it was worked out on: what its items and places are (history/kinds.ts). */
  kind: SiteKind;
  /** Where they order to, for finding something new near it. */
  areas: string[];
  city?: string;
  /** The orders it was made from, so it is made again when they change. */
  hash: string;
  at: number;
}

export function tasteHash(orders: readonly SiteOrder[]): string {
  return createHash("sha256").update(orders.filter((o) => !o.cancelled).map((o) => o.key).sort().join("|")).digest("hex").slice(0, 24);
}

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** One order as the model sees it: its number, when (in words), where, what, what it cost. */
export function orderLine(o: SiteOrder, n: number): string {
  const h = o.local ? Number(o.local.slice(11, 13)) : undefined;
  const d = o.local ? new Date(`${o.local.slice(0, 10)}T00:00:00Z`).getUTCDay() : undefined;
  const when = o.local && h !== undefined && d !== undefined ? `${DAY_NAMES[d]!.slice(0, 3)} ${o.local.slice(0, 10)} ${hourWords(h)} (${momentOf(o.local)})` : "time not shown";
  const dishes = o.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ");
  return `#${n} ${when} · ${o.place}${o.area ? `, ${o.area}` : ""} · ${dishes}${o.total ? ` · ₹${Math.round(o.total)}` : ""}`;
}

/** The signals as the model reads them: counted, not concluded. */
export function signalLines(f: TasteFeatures): string[] {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return [
    `Orders: ${f.orders}. First time at that place: ${pct(f.explore)} of orders. Exact repeats: ${pct(f.repeat)}. Category breadth (0 one, 1 all equally): ${f.breadth}. Reads as: ${chooserOf(f)}.`,
    `Traits in what they buy: ${f.traits.map((x) => `${x.trait} ${pct(x.share)}`).join(", ") || "none found"}.`,
    `Categories: ${f.categories.map((x) => `${x.name} ${pct(x.weight)}`).join(", ") || "unclear"}.`,
    ...f.moments.map((m) => `Moment "${m.moment}": ${m.orders} orders${m.medianSpend ? `, usually ₹${Math.round(m.medianSpend)}` : ""}${m.traits.length ? `, ${m.traits.join("/")}` : ""}${m.categories.length ? `, mostly ${m.categories.join(", ")}` : ""}.`),
    `Areas they order to: ${f.areas.join(", ") || "not shown"}.`,
  ];
}

export function tasteUser(orders: readonly SiteOrder[], f: TasteFeatures, site = ""): string {
  const shown = orders.filter((o) => !o.cancelled).slice(0, SHOWN);
  const k = KINDS[f.kind];
  return [
    `The site: ${fenced(site) || "a site they buy from"}, a ${k.kind} site: each order is ${k.item}s from a ${k.place}.`,
    "Signals counted from their orders:",
    ...signalLines(f).map((l) => `- ${l}`),
    "",
    "Their orders, newest first (the numbers are what `orders` refers to):",
    "<orders>",
    fenced(shown.map((o, i) => orderLine(o, i + 1)).join("\n")),
    "</orders>",
  ].join("\n");
}

/** What the model said, held to evidence: every claim names orders that exist, and a discovery is something new. */
export function tasteFrom(reply: z.infer<typeof TasteReply>, orders: readonly SiteOrder[], f: TasteFeatures, now: number): Taste | null {
  const shown = orders.filter((o) => !o.cancelled).slice(0, SHOWN);
  const ok = (xs: number[]): number[] => [...new Set(xs.filter((x) => Number.isInteger(x) && x >= 1 && x <= shown.length))];
  const traits = (xs: Array<{ trait: string; why: string; orders: number[] }>, max: number): Trait[] => xs.flatMap((t) => {
    const trait = clip(t.trait, 60), why = clip(t.why, 200), ev = ok(t.orders);
    return trait && why && ev.length ? [{ trait, why, orders: ev }] : [];
  }).slice(0, max);
  const had = new Set(shown.flatMap((o) => o.items.map((i) => norm(i.name))));
  const hunches: Hunch[] = [];
  let stretches = 0;
  for (const h of reply.mightLike) {
    const item = clip(h.item, 60), category = clip(h.category, 40), why = clip(h.why, 220), ev = ok(h.orders);
    if (!item || !why || !ev.length) continue;
    // Something they have already had is the usual, not a discovery.
    if (had.has(norm(item)) || [...had].some((d) => d.includes(norm(item)) && norm(item).length >= 6)) continue;
    if (h.reach === "stretch" && stretches++ >= 1) continue;
    hunches.push({ item, category, why, reach: h.reach, orders: ev });
    if (hunches.length >= 5) break;
  }
  const insights = reply.insights.map((s) => clip(s, 180)).filter((s) => s.length > 12).slice(0, 5);
  if (!insights.length && !hunches.length) return null;
  const city = clip(reply.city, 40);
  return {
    insights, mightLike: hunches,
    palate: traits(reply.palate, 5), motives: traits(reply.motives, 4),
    moods: reply.moods.flatMap((m) => {
      const moment = clip(m.moment, 40), wants = clip(m.wants, 140), ev = ok(m.orders);
      return moment && wants && ev.length ? [{ moment, wants, orders: ev }] : [];
    }).slice(0, 4),
    chooser: chooserOf(f), kind: f.kind, areas: f.areas, ...(city ? { city } : {}),
    hash: tasteHash(orders), at: now,
  };
}

export interface TasteDeps {
  call?: Parameters<typeof askJson>[0]["call"];
  gateway?: Parameters<typeof askJson>[0]["gateway"];
  maxPaise: number;
}

/** The profile, or null: too few orders, or nothing grounded came back. Never throws. */
export async function tasteOf(userId: string, orders: readonly SiteOrder[], d: TasteDeps, now = Date.now(), site = ""): Promise<Taste | null> {
  const f = featuresOf(orders, site ? kindOf(site) : KINDS.food);
  if (f.orders < TASTE_MIN_ORDERS) return null;
  try {
    const r = await askJson({
      ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}),
      userId, budget: { maxPaise: d.maxPaise },
    }, {
      tier: "cheap", purpose: "site.taste", role: "site_taste",
      user: tasteUser(orders, f, site), schema: TasteReply, maxTokens: 1600,
    });
    return r.ok ? tasteFrom(r.value, orders, f, now) : null;
  } catch {
    return null;
  }
}

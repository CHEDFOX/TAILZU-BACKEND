/**
 * SOMEWHERE NEW THEY WILL PROBABLY LOVE, FOUND ON THE WEB AND VOUCHED FOR BY PEOPLE WHO ATE THERE (docs/site-portrait.md §2c).
 *
 *   discover(taste, deps, o?)   for their best hunches (profile.ts mightLike), or for an item they just asked for: the web is
 *                               searched near where they order, the pages read, and a model picks the restaurant and the
 *                               item that fit THIS person — each pick carrying a reviewer's own words, checked on the page
 *
 * WHY THE WEB. Their orders only know the places they already go. The game is the place they do not know yet: the Andhra
 * biryani two streets over that people who love Behrouz say is better. That lives in reviews, food blogs and threads.
 *
 * THE SAME RULES AS THE REVIEW READER (src/discover/experiences.ts), because this is the same hostile input:
 *
 *   THE QUOTE MUST BE ON THE PAGE. Every pick carries `said`, copied from a page we fetched, and a pick whose quote is not
 *   found there is DROPPED. The model points at evidence; it never supplies it. A confident "people rave about the haleem"
 *   that nobody wrote is exactly what this exists to stop.
 *   PAGES ARE DATA. Every page goes in inside an untrusted block; nothing a page says is an instruction.
 *   FIT, NOT FAME. A pick says which of their likings it answers ("you love heat and slow-cooked rice"), so the card can say
 *   why it is for them and not merely why it is popular.
 *
 * It knows no search engine or reader: it declares DiscoverDeps and server.ts names the real ones (src/web/search, readPage).
 */
import { z } from "zod";
import { askJson } from "../../../code/work/model.js";
import type { Hunch, Taste } from "./profile.js";
import { KINDS, type SiteKind } from "../kinds.js";

/** One look for new places: a few searches, a handful of pages, one reasoning call. Done at most daily, and cached. */
export const SITE_DISCOVER_PAISE = 160;
const HUNCHES = 2;
const PAGES_PER = 3;
const PAGE_CHARS = 9_000;

export interface Hit { title: string; url: string; published?: number }
export interface Page { url: string; text: string }

export interface DiscoverDeps {
  /** A web search. src/web/search in the server. */
  find(query: string, limit: number): Promise<Hit[]>;
  /** One page as text, or null. One bad page never fails the lot. */
  read(url: string, maxChars: number): Promise<Page | null>;
  call?: Parameters<typeof askJson>[0]["call"];
  gateway?: Parameters<typeof askJson>[0]["gateway"];
  maxPaise?: number;
}

/** A place to try, and why it is for them. */
export interface Discovery {
  place: string;
  item: string;
  category: string;
  /** Which of their likings it answers, said to them. */
  why: string;
  /** A reviewer's words, verbatim from `url`. */
  said: string;
  host: string;
  url: string;
  reach: "near" | "stretch";
  /** The item they asked for, when this was found for an ask rather than ahead of time. */
  asked?: string;
}

export const DiscoverReply = z.object({
  picks: z.array(z.object({
    place: z.string(), item: z.string(), why: z.string(), said: z.string(), from: z.number(), hunch: z.number(),
  })),
}).strict();

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
const flat = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const hostOf = (url: string): string => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; } };

/** Where to look: the area they order to most, and the city when the profile knew it. */
export const nearWords = (t: { areas: readonly string[]; city?: string }): string => [t.areas[0], t.city].filter(Boolean).join(" ");

/** A search that finds reviews of an item near them, not a recipe. */
export const queryFor = (item: string, near: string, kind: SiteKind = "food"): string => KINDS[kind].query(item, near).replace(/\s+/g, " ").trim();

/** What the model is told: who this person is as an eater, what to look for, and the pages, each fenced. */
export function discoverUser(t: Taste, hunches: readonly Hunch[], pages: readonly Page[]): string {
  return [
    `The site is a ${t.kind} site: ${KINDS[t.kind].item}s from a ${KINDS[t.kind].place}.`,
    "The person, as a buyer:",
    ...t.insights.map((s) => `- ${s}`),
    ...t.palate.map((p) => `- Palate: ${p.trait} (${p.why})`),
    ...t.motives.map((m) => `- Chooses for: ${m.trait}`),
    `- They are a ${t.chooser}. They order in ${nearWords(t) || "an area the pages will name"}.`,
    "",
    "What to look for (the numbers are what `hunch` refers to):",
    ...hunches.map((h, i) => `${i + 1}. ${h.item}${h.category ? ` (${h.category})` : ""}: ${h.why}`),
    "",
    ...pages.map((p, i) => [`PAGE ${i + 1} — ${hostOf(p.url)}`, `<<<UNTRUSTED ${i + 1}>>>`, p.text, "<<<END>>>"].join("\n")),
  ].join("\n");
}

/** What the model said, held to the pages: a pick whose quote is not on the page it names is not a pick. */
export function picksFrom(reply: z.infer<typeof DiscoverReply>, hunches: readonly Hunch[], pages: readonly Page[], asked?: string): Discovery[] {
  const out: Discovery[] = [];
  const places = new Set<string>();
  for (const p of reply.picks) {
    const page = pages[p.from - 1], hunch = hunches[p.hunch - 1];
    const place = clip(p.place, 80), item = clip(p.item, 60), why = clip(p.why, 200), said = clip(p.said, 240);
    if (!page || !hunch || !place || !item || !why || said.length < 15) continue;
    if (!flat(page.text).includes(flat(said))) continue;
    // The place has to be on that page too: a quote about somewhere else is not a review of this one.
    if (!flat(page.text).includes(flat(place))) continue;
    if (places.has(flat(place))) continue;
    places.add(flat(place));
    out.push({
      place, item, why, said, category: hunch.category, reach: hunch.reach, url: page.url, host: hostOf(page.url),
      ...(asked ? { asked } : {}),
    });
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Picks for this person. Ahead of time (no `want`): their best near hunches. For an ask ("order pizza"): the item they
 * asked for, read through their taste. Never throws; nothing found is an empty list, and the card falls back to the
 * site's own search.
 */
export async function discover(userId: string, t: Taste, d: DiscoverDeps, o: { want?: string } = {}): Promise<Discovery[]> {
  const near = nearWords(t);
  const hunches: Hunch[] = o.want
    ? [{ item: o.want, category: "", why: "What they asked for just now; pick the version of it that fits their taste.", reach: "near", orders: [] }]
    : [...t.mightLike.filter((h) => h.reach === "near"), ...t.mightLike.filter((h) => h.reach === "stretch")].slice(0, HUNCHES);
  if (!hunches.length) return [];
  const pages: Page[] = [];
  for (const h of hunches) {
    const hits = await d.find(queryFor(h.item, near, t.kind), PAGES_PER * 2).catch(() => [] as Hit[]);
    const read = await Promise.all(hits.slice(0, PAGES_PER).map((x) => d.read(x.url, PAGE_CHARS).catch(() => null)));
    for (const p of read) if (p && p.text.length > 300 && !pages.some((q) => q.url === p.url)) pages.push(p);
  }
  if (!pages.length) return [];
  try {
    const r = await askJson({
      ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}),
      userId, budget: { maxPaise: d.maxPaise ?? SITE_DISCOVER_PAISE },
    }, {
      tier: "cheap", purpose: "site.discover", role: "site_discover",
      user: discoverUser(t, hunches, pages), schema: DiscoverReply, maxTokens: 1000,
    });
    return r.ok ? picksFrom(r.value, hunches, pages, o.want) : [];
  } catch {
    return [];
  }
}

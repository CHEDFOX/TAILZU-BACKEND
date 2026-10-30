/**
 * PLACES TO STAY, SIDE BY SIDE. There is no free hotel data to search, so a trip's stays come from three places, each kept with where
 * it came from, and none is ever booked or paid for here: the screen links out and the person books on that site. No prices are shown:
 * stays are compared by area, distance and rating, and the link is where the person sees the price (a price a page or a person gave is
 * kept on the row, never drawn).
 *
 *   by the person     a name, a link, an area, typed or pasted (Trips.addStay)
 *   from the chat     a stay link the Travel bot opened in its chat ("Compare this")
 *   from the web      webStaySource: our web search (src/web/search, the engines it already uses: SearXNG when we run one, then
 *                     DuckDuckGo's page, then Brave with a key), kept to pages that are ONE property on a booking or review site,
 *                     with the price and rating only when the result itself says them. Held to 10 searches a person a day
 *
 *   compareStays(stays, { nights, minutes })   which is Travel bot's pick, which is closer, which is better rated
 *
 * Distances to the trip's places are worked out by tripExtras.ts with the same routing as Plan Ease.
 */
import { search, type SearchOptions } from "../web/search/engine.js";
import type { SearchPlan } from "../web/search/types.js";

export interface StayRow {
  id: string;
  name: string;
  area: string;
  /** https only, or "". */
  url: string;
  /** "booking.com": where the link goes. */
  host: string;
  nightPaise: number | null;
  rating: number | null;
  /** The scale the rating is on (Booking.com's is 10, most others 5). */
  ratingOf: 5 | 10 | null;
  reviews: number | null;
  by: "you" | "chat" | "web";
  picked: boolean;
  at: number;
}

export interface StayFound { name: string; area: string; url: string; nightPaise: number | null; rating: number | null; ratingOf: 5 | 10 | null; reviews: number | null }

export interface StayQuery { place: string; area?: string }

/** Somewhere to look for stays. Returns at most a handful, each one property, with its address. */
export interface StaySource {
  readonly id: string;
  find(q: StayQuery, o: { userId: string; signal?: AbortSignal }): Promise<StayFound[]>;
}

// ------------------------------------------------------------------ reading what a page or a person said

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** "₹3,200", "Rs. 3200", "INR 3,200", "3200": paise, or null. Prices outside ₹100 to ₹5,00,000 a night are not believed. */
export function paiseOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 100 && v <= 500_000 ? Math.round(v * 100) : null;
  const s = clean(v, 60);
  const m = s.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i) ?? s.match(/^([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 100 && n <= 500_000 ? Math.round(n * 100) : null;
}

/** "4.4", "8.6/10", "4.1 out of 5": the number and its scale. */
export function ratingOf(v: unknown): { rating: number; of: 5 | 10 } | null {
  const s = typeof v === "number" ? String(v) : clean(v, 40);
  const m = s.match(/(\d{1,2}(?:\.\d)?)\s*(?:\/|out of)\s*(5|10)\b/i) ?? s.match(/^(\d{1,2}(?:\.\d)?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const of = m[2] ? (Number(m[2]) as 5 | 10) : n <= 5 ? 5 : 10;
  return n > 0 && n <= of ? { rating: n, of } : null;
}

/** "1,820 reviews" -> 1820. */
export function reviewsOf(s: string): number | null {
  const m = s.match(/([\d,]{1,9})\s*(?:reviews|ratings|verified reviews)/i);
  const n = m ? Number(m[1]!.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** An address the app may link out to: https (http is upgraded), no credentials, at most 500 characters. */
export function linkOf(v: unknown): { url: string; host: string } | null {
  const s = clean(v, 500);
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return { url: u.toString(), host: u.hostname.replace(/^www\./, "").replace(/^m\./, "") };
  } catch { return null; }
}

/** A link the Travel bot opened, as a stay: "Shanti Residency · Koregaon Park · ₹3,200 a night". */
export function stayFromLabel(label: string): { name: string; area: string; nightPaise: number | null } {
  const parts = clean(label, 200).split(/\s+[·|–-]\s+/).map((p) => p.trim()).filter(Boolean);
  const name = parts[0] ?? "";
  const price = parts.map((p) => paiseOf(p.replace(/\s*(a|per|\/)\s*night.*$/i, ""))).find((p) => p !== null) ?? null;
  const area = parts.slice(1).find((p) => !/\d/.test(p) && p.length <= 40) ?? "";
  return { name, area, nightPaise: price };
}

// ------------------------------------------------------------------ the web

/** Pages that are one property, not a list of them, on the sites people book or read reviews on. */
const ONE_PLACE: Array<{ host: RegExp; path: RegExp }> = [
  { host: /(^|\.)booking\.com$/, path: /^\/hotel\/[a-z]{2}\/[^/]+\.html/ },
  { host: /(^|\.)agoda\.com$/, path: /\/hotel\/[^/]+\.html/ },
  { host: /(^|\.)tripadvisor\.(com|in|co\.uk)$/, path: /^\/Hotel_Review-/ },
  { host: /(^|\.)makemytrip\.com$/, path: /^\/hotels\/[^/]*(hotel[-_]details|-details-)/ },
  { host: /(^|\.)goibibo\.com$/, path: /^\/hotels\/[^/]+-hotel-in-[^/]+/ },
  { host: /(^|\.)airbnb\.(com|co\.in)$/, path: /^\/rooms\/\d+/ },
  { host: /(^|\.)expedia\.(com|co\.in)$/, path: /\.Hotel-Information/ },
  { host: /(^|\.)hotels\.com$/, path: /^\/ho\d+/ },
  { host: /(^|\.)cleartrip\.com$/, path: /^\/hotels\/details\// },
  { host: /(^|\.)treebo\.com$/, path: /^\/hotels-in-[^/]+\/[^/]+-\d+/ },
  { host: /(^|\.)fabhotels\.com$/, path: /^\/hotels-in-[^/]+\/[^/]+\.html/ },
];

/** "Shanti Residency, Pune (updated prices 2026) - Booking.com" -> "Shanti Residency". */
export function nameFromTitle(title: string, place: string): string {
  // The property's name is the title's first part: "Shanti Residency, Pune (updated prices 2026) - Booking.com",
  // "DECCAN COURTYARD - Updated 2026 Prices & Hotel Reviews (Pune) - Tripadvisor", "Shanti Residency Pune (Pune) - Deals, Photos & Reviews".
  let t = clean(title, 200).split(/\s+[-|–—:]\s+/)[0] ?? "";
  t = t.replace(/\([^)]*\)/g, " ").replace(/\b(updated \d{4} prices|prices (and|&) reviews|hotel reviews|book now)\b.*$/gi, "").replace(/\s+/g, " ").trim();
  const p = place.trim().toLowerCase();
  t = t.split(",").filter((part, i) => i === 0 || part.trim().toLowerCase() !== p).join(",").replace(/,\s*$/, "").trim();
  if (p) {
    const cut = t.replace(new RegExp(`(?:\\s*[,-]\\s*|\\s+in\\s+|\\s+)${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
    if (cut) t = cut;
  }
  return t.replace(/[\s,–-]+$/, "").slice(0, 80);
}

export interface WebStayDeps {
  /** In place of the search engine (tests). */
  searchFn?: (q: string, o: SearchOptions) => ReturnType<typeof search>;
  /** Searches a person may make in 24 hours (default 10). */
  daily?: number;
  now?: () => number;
}

/** Searches per person in a rolling day, in memory (a restart forgets: the point is a ceiling on a runaway, not a bill). */
const finds = new Map<string, number[]>();
function takeFind(userId: string, cap: number, now: number): boolean {
  const list = (finds.get(userId) ?? []).filter((t) => now - t < 86_400_000);
  finds.delete(userId);
  if (list.length >= cap) { finds.set(userId, list); return false; }
  finds.set(userId, [...list, now]);
  while (finds.size > 5_000) finds.delete(finds.keys().next().value!);
  return true;
}

export function webStaySource(deps: WebStayDeps = {}): StaySource {
  const now = deps.now ?? Date.now;
  return {
    id: "web",
    async find(q, o) {
      const where = [q.area, q.place].map((s) => clean(s, 60)).filter(Boolean).join(" ");
      if (!where) return [];
      if (!takeFind(o.userId, deps.daily ?? 10, now())) throw new StaysLimit();
      const plan: SearchPlan = { intent: "general", queries: [`hotels in ${where}`, `${where} hotel booking reviews`], sources: [], freshness: "any", confidence: 1 };
      const out = await (deps.searchFn ?? search)(`hotels in ${where}`, { plan, depth: "standard", limit: 20, signal: o.signal });
      const seen = new Set<string>();
      const found: StayFound[] = [];
      for (const r of out.results) {
        const link = linkOf(r.url);
        if (!link) continue;
        const path = new URL(link.url).pathname;
        if (!ONE_PLACE.some((s) => s.host.test(link.host) && s.path.test(path))) continue;
        const name = nameFromTitle(r.title, q.place);
        if (!name || name.length < 3 || /^(hotels?|best|top|cheap)\b/i.test(name) || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const text = `${r.title} ${r.snippet}`;
        const rate = ratingOf(text.match(/(\d{1,2}(?:\.\d)?\s*(?:\/|out of)\s*(?:5|10))/i)?.[1] ?? "");
        found.push({
          name, area: clean(q.area, 60), url: link.url, nightPaise: paiseOf(text.match(/(?:₹|rs\.?|inr)\s*[\d,]+/i)?.[0] ?? ""),
          rating: rate?.rating ?? null, ratingOf: rate?.of ?? null, reviews: reviewsOf(text),
        });
        if (found.length >= 4) break;
      }
      return found;
    },
  };
}

/** Tests: forget who searched. */
export function resetStayFindsForTests(): void { finds.clear(); }

/** A person has searched for stays as often as a day allows. */
export class StaysLimit extends Error {
  constructor() { super("stay searches used up for today"); this.name = "StaysLimit"; }
}

// ------------------------------------------------------------------ the comparison

export type StayLabel = "Your pick" | "Travel bot's pick" | "Closer" | "Better rated" | "";

export interface StayCompared extends StayRow {
  label: StayLabel;
  /** Minutes to the trip's main place, and how (walk or drive), when known. */
  minutes: number | null;
  mode: "walk" | "drive" | null;
  /** nightPaise × nights, when both are known. Ours: never shown. */
  totalPaise: number | null;
  /** The rating on 5, for comparing. */
  stars: number | null;
}

/**
 * Travel bot's pick is the best balance of rating (50%) and time to the main place (50%), each scored against the others on the list; a stay
 * that doesn't say one scores lowest on it (the pick rests on what is known). Price plays no part: the app shows none. Then: the closest that
 * is not the pick is "Closer", the best rated "Better rated" (each only when it really is, against the pick). The person's own pick wins the
 * label.
 */
export function compareStays(stays: StayRow[], o: { nights: number | null; minutes: (s: StayRow) => { minutes: number; mode: "walk" | "drive" } | null }): StayCompared[] {
  const rows: StayCompared[] = stays.map((s) => {
    const m = o.minutes(s);
    return {
      ...s, label: "", minutes: m?.minutes ?? null, mode: m?.mode ?? null,
      totalPaise: s.nightPaise !== null && o.nights ? s.nightPaise * o.nights : null,
      stars: s.rating !== null && s.ratingOf ? Math.round((s.rating / s.ratingOf) * 50) / 10 : null,
    };
  });
  if (!rows.length) return rows;
  // Against the others: the best known value scores 1, the worst 0; a stay that doesn't say scores 0 (the pick rests on what is
  // known), unless none says, when it doesn't count at all.
  const score = (vals: Array<number | null>, low: boolean) => {
    const known = vals.filter((v): v is number => v !== null);
    if (!known.length) return vals.map(() => 0.5);
    const lo = Math.min(...known), hi = Math.max(...known);
    return vals.map((v) => (v === null ? 0 : hi === lo ? 0.5 : low ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo)));
  };
  const stars = score(rows.map((r) => r.stars), false), near = score(rows.map((r) => r.minutes), true);
  const total = rows.map((_, i) => 0.5 * stars[i]! + 0.5 * near[i]!);
  const informed = rows.filter((r) => r.stars !== null || r.minutes !== null).length;
  const yours = rows.findIndex((r) => r.picked);
  const pick = rows.length >= 2 && informed >= 2 ? total.indexOf(Math.max(...total)) : -1;
  const anchor = yours >= 0 ? yours : pick;
  if (yours >= 0) rows[yours]!.label = "Your pick";
  else if (pick >= 0) rows[pick]!.label = "Travel bot's pick";
  if (anchor < 0) return rows;
  const a = rows[anchor]!;
  const best = (key: (r: StayCompared) => number | null, better: (x: number, y: number) => boolean): number => {
    let at = -1;
    rows.forEach((r, i) => {
      const v = key(r);
      if (i === anchor || r.label || v === null) return;
      if (at < 0 || better(v, key(rows[at]!)!)) at = i;
    });
    const av = key(a);
    return at >= 0 && av !== null && better(key(rows[at]!)!, av) ? at : -1; // "closer" than a pick with no distance says nothing
  };
  const closer = best((r) => r.minutes, (x, y) => x < y);
  if (closer >= 0) rows[closer]!.label = "Closer";
  const rated = best((r) => r.stars, (x, y) => x > y);
  if (rated >= 0) rows[rated]!.label = "Better rated";
  return rows;
}

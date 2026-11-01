/**
 * HOTELS: trivago's public hotel search (its MCP server, no sign-in), read into cards. Prices are live offers from the booking sites
 * trivago compares; every card links to trivago, where the person picks a site and books. Nothing is booked here.
 *
 * trivago searches best around a point: a city we know (places/cities.ts) or the geocoder gives it; a place we cannot place goes as words.
 * The server's own "how to show this" message is never passed on: only the fields below are read.
 */
import { cityNamed } from "../places/cities.js";
import type { LatLon } from "../places/types.js";
import { callTool, type FetchFn } from "./mcpLite.js";
import type { Stay, StaysCard } from "./types.js";

export const TRIVAGO_URL = "https://mcp.trivago.com/mcp";

/** trivago's language codes for the person's country (it takes only these). */
const LANGUAGE: Record<string, string> = {
  IN: "EN_IN", US: "EN_US", GB: "EN_GB", AU: "EN_AU", CA: "EN_US", SG: "EN_SG", AE: "EN_US", NZ: "EN_NZ", IE: "EN_IE", ZA: "EN_ZA", PH: "EN_PH", HK: "EN_HK",
};

export interface StayAsk {
  /** A city, area or landmark ("Goa", "Baga Beach"), or a hotel's name. */
  place: string;
  /** YYYY-MM-DD */
  checkIn: string;
  checkOut: string;
  adults?: number;
  children?: number;
  rooms?: number;
  /** The person's own country (ISO alpha-2): trivago prices for their market. */
  country?: string;
  currency?: string;
  /** Top price a night, in `currency`. */
  maxPrice?: number;
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const httpsOnly = (u: unknown): string => (typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) ? u : "");
const PERKS = new Set(["freeCancellation", "breakfastIncluded", "payAtProperty", "allInclusive", "halfBoard", "fullBoard"]);

interface TDeal { advertiser?: string; price_per_night?: string; price_per_stay?: string; deal_url?: string; price_attributes?: Array<{ id?: string; name?: string }> }
interface TStay { accommodation_name?: string; hotel_rating?: number; review_rating?: string | number; review_count?: string; top_amenities?: string; distance?: string; country_city?: string; main_image?: string; deals?: TDeal[] }

/** trivago's answer, read into cards: the order it gave, at most `max`, each with its best deal. */
export function readStays(answer: unknown, max = 6): Stay[] {
  const list = ((answer ?? {}) as { accommodations?: TStay[] }).accommodations ?? [];
  const out: Stay[] = [];
  for (const a of list) {
    const deal = a.deals?.[0];
    const url = httpsOnly(deal?.deal_url);
    if (!a.accommodation_name || !deal || !url) continue;
    out.push({
      name: a.accommodation_name.slice(0, 120), stars: Math.max(0, Math.min(5, Math.round(Number(a.hotel_rating) || 0))),
      rating: Math.round((Number(a.review_rating) || 0) * 10) / 10, reviews: String(a.review_count ?? ""),
      area: (a.distance ?? a.country_city ?? "").slice(0, 80), amenities: (a.top_amenities ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4),
      image: httpsOnly(a.main_image), perNight: deal.price_per_night ?? "", perStay: deal.price_per_stay ?? "", advertiser: (deal.advertiser ?? "").slice(0, 40),
      perks: (deal.price_attributes ?? []).filter((p) => p.id && PERKS.has(p.id) && p.name).map((p) => p.name!).slice(0, 2), url,
    });
    if (out.length >= max) break;
  }
  return out;
}

export async function searchStays(ask: StayAsk, o: { url?: string; fetch?: FetchFn; locate?: (place: string) => Promise<LatLon | null> } = {}): Promise<StaysCard> {
  if (!isDay(ask.checkIn) || !isDay(ask.checkOut) || ask.checkOut <= ask.checkIn) throw new Error("checkIn and checkOut are days, YYYY-MM-DD, checkOut after checkIn");
  const country = (ask.country ?? "IN").toUpperCase().slice(0, 2);
  const currency = (ask.currency ?? (country === "IN" ? "INR" : "USD")).toUpperCase().slice(0, 3);
  const adults = Math.min(10, Math.max(1, Math.round(ask.adults ?? 2)));
  const common: Record<string, unknown> = {
    arrival: ask.checkIn, departure: ask.checkOut, adults, children: Math.min(6, Math.max(0, Math.round(ask.children ?? 0))),
    rooms: Math.min(adults, Math.max(1, Math.round(ask.rooms ?? 1))), country, currency, language: LANGUAGE[country] ?? "EN_US",
    ...(ask.maxPrice && ask.maxPrice > 0 ? { price_range: { maxPrice: Math.round(ask.maxPrice) } } : {}),
  };
  const place = ask.place.trim().slice(0, 120);
  const point = cityNamed(place) ?? (o.locate ? await o.locate(place).catch(() => null) : null);
  const r = point
    ? await callTool(o.url ?? TRIVAGO_URL, "trivago-accommodation-radius-search", { latitude: point.lat, longitude: point.lon, ...common }, o.fetch ? { fetch: o.fetch } : {})
    : await callTool(o.url ?? TRIVAGO_URL, "trivago-accommodation-search", { query: place, ...common }, o.fetch ? { fetch: o.fetch } : {});
  if (r.isError) throw new Error(r.text.slice(0, 200) || "the hotel search failed");
  return { kind: "stays", query: place, checkIn: ask.checkIn, checkOut: ask.checkOut, results: readStays(r.structured), source: { name: "trivago", url: "https://www.trivago.com" } };
}

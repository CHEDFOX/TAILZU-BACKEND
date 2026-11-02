/**
 * FLIGHTS: Kiwi.com's public flight search (its MCP server, no sign-in), read into cards. Search only: every result links to Kiwi.com,
 * where the person books and pays. Nothing is booked here.
 *
 * Kiwi reads a city name itself, but not always the one meant ("Goa" came back as Genoa, Italy), so the names people say for India's
 * airports, and a few big ones elsewhere, are turned into airport codes first. A code (3 capital letters) goes as it is.
 */
import { callTool, type FetchFn } from "./mcpLite.js";
import type { Flight, FlightLeg, FlightsCard } from "./types.js";

export const KIWI_URL = "https://mcp.kiwi.com";

/** What people say → the airport code Kiwi should get. India first (its names collide with places abroad), then a few hubs. */
const AIRPORTS: Record<string, string> = {
  delhi: "DEL", "new delhi": "DEL", ncr: "DEL", gurgaon: "DEL", gurugram: "DEL", noida: "DEL",
  mumbai: "BOM", bombay: "BOM", "navi mumbai": "NMI", thane: "BOM",
  bengaluru: "BLR", bangalore: "BLR", blr: "BLR", chennai: "MAA", madras: "MAA", kolkata: "CCU", calcutta: "CCU",
  hyderabad: "HYD", goa: "GOI", "north goa": "GOX", mopa: "GOX", "south goa": "GOI", panaji: "GOI", panjim: "GOI", dabolim: "GOI",
  pune: "PNQ", ahmedabad: "AMD", amdavad: "AMD", kochi: "COK", cochin: "COK", jaipur: "JAI", lucknow: "LKO",
  thiruvananthapuram: "TRV", trivandrum: "TRV", varanasi: "VNS", banaras: "VNS", amritsar: "ATQ", chandigarh: "IXC", srinagar: "SXR",
  leh: "IXL", ladakh: "IXL", bagdogra: "IXB", darjeeling: "IXB", siliguri: "IXB", guwahati: "GAU", indore: "IDR", bhopal: "BHO",
  bhubaneswar: "BBI", patna: "PAT", ranchi: "IXR", raipur: "RPR", nagpur: "NAG", coimbatore: "CJB", madurai: "IXM", mangaluru: "IXE",
  mangalore: "IXE", udaipur: "UDR", jodhpur: "JDH", "port blair": "IXZ", andaman: "IXZ", visakhapatnam: "VTZ", vizag: "VTZ",
  surat: "STV", vadodara: "BDQ", baroda: "BDQ", dehradun: "DED", rishikesh: "DED", mysuru: "MYQ", mysore: "MYQ", tirupati: "TIR",
  dubai: "DXB", "abu dhabi": "AUH", singapore: "SIN", bangkok: "BKK", london: "LON", "new york": "NYC", paris: "PAR", doha: "DOH",
  "kuala lumpur": "KUL", bali: "DPS", denpasar: "DPS", colombo: "CMB", kathmandu: "KTM", male: "MLE", maldives: "MLE", phuket: "HKT",
  tokyo: "TYO", "hong kong": "HKG", toronto: "YTO", sydney: "SYD", melbourne: "MEL", lisbon: "LIS", istanbul: "IST",
};

/** A place as Kiwi should get it: an airport code we know, or the words as they were. */
export function airportOf(place: string): string {
  const p = place.trim();
  if (/^[A-Z]{3}$/.test(p)) return p;
  const k = p.toLowerCase().replace(/\b(?:airport|international|intl|city)\b/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return AIRPORTS[k] ?? p;
}

/** "2026-11-21" → "21/11/2026" (Kiwi's way). Null for anything that is not a real date. */
export function kiwiDate(day: unknown): string | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return null;
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

export interface FlightAsk {
  from: string;
  to: string;
  /** YYYY-MM-DD */
  date: string;
  returnDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  cabin?: "economy" | "premium" | "business" | "first";
  currency?: string;
  /** 0 for non-stop only. */
  maxStops?: number;
  /** ± days around the date. */
  flexDays?: number;
}

const CABIN = { economy: "M", premium: "W", business: "C", first: "F" } as const;

interface KiwiSegment { carrierName?: string; fromCity?: string; toCity?: string }
interface KiwiLeg { departureTime?: string; arrivalTime?: string; durationSeconds?: number; stops?: number; route?: string[]; cabinClass?: string; segments?: KiwiSegment[] }
interface KiwiItinerary { price?: number; priceFormatted?: string; bookingUrl?: string; baggage?: { cabinBag?: number; checkedBag?: number }; outbound?: KiwiLeg; inbound?: KiwiLeg }
interface KiwiAnswer { query?: string; currency?: string; itineraries?: KiwiItinerary[] }

const httpsOnly = (u: unknown): string => (typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) ? u : "");

function legOf(l: KiwiLeg | undefined): FlightLeg | null {
  if (!l?.departureTime || !l.arrivalTime || !Array.isArray(l.route) || l.route.length < 2) return null;
  const segs = l.segments ?? [];
  return {
    from: l.route[0]!, to: l.route[l.route.length - 1]!,
    fromCity: segs[0]?.fromCity ?? "", toCity: segs[segs.length - 1]?.toCity ?? "",
    depart: l.departureTime, arrive: l.arrivalTime, minutes: Math.round((l.durationSeconds ?? 0) / 60), stops: Math.max(0, l.stops ?? l.route.length - 2),
    route: l.route.slice(0, 6), airlines: [...new Set(segs.map((s) => s.carrierName).filter((x): x is string => !!x))].slice(0, 3),
  };
}

/** Kiwi's answer, read into cards: the cheapest first, at most `max`. */
export function readFlights(answer: unknown, currency: string, max = 6): Omit<FlightsCard, "kind" | "source"> {
  const a = (answer ?? {}) as KiwiAnswer;
  const results: Flight[] = [];
  for (const it of a.itineraries ?? []) {
    const out = legOf(it.outbound);
    const url = httpsOnly(it.bookingUrl);
    if (!out || !url || typeof it.price !== "number") continue;
    const back = it.inbound ? legOf(it.inbound) : null;
    results.push({
      price: it.price, priceText: it.priceFormatted ?? `${it.price} ${a.currency ?? currency}`, cabin: it.outbound?.cabinClass ?? "Economy",
      out, ...(back ? { back } : {}), bags: { cabin: it.baggage?.cabinBag ?? 0, checked: it.baggage?.checkedBag ?? 0 }, url,
    });
  }
  results.sort((x, y) => x.price - y.price);
  return { query: a.query ?? "", currency: a.currency ?? currency, results: results.slice(0, max) };
}

export async function searchFlights(ask: FlightAsk, o: { url?: string; fetch?: FetchFn } = {}): Promise<FlightsCard> {
  const date = kiwiDate(ask.date);
  if (!date) throw new Error("date must be a real day, YYYY-MM-DD");
  const back = ask.returnDate ? kiwiDate(ask.returnDate) : null;
  if (ask.returnDate && !back) throw new Error("returnDate must be a real day, YYYY-MM-DD");
  const currency = (ask.currency ?? "INR").toUpperCase().slice(0, 3);
  const args: Record<string, unknown> = {
    flyFrom: airportOf(ask.from), flyTo: airportOf(ask.to), departureDate: date, ...(back ? { returnDate: back } : {}),
    adults: Math.min(9, Math.max(1, Math.round(ask.adults ?? 1))), children: Math.min(8, Math.max(0, Math.round(ask.children ?? 0))),
    infants: Math.min(4, Math.max(0, Math.round(ask.infants ?? 0))), currency, locale: "en",
    ...(ask.cabin && CABIN[ask.cabin] ? { cabinClass: CABIN[ask.cabin] } : {}),
    ...(typeof ask.maxStops === "number" ? { max_sector_stopovers: Math.min(3, Math.max(0, Math.round(ask.maxStops))) } : {}),
    ...(ask.flexDays ? { departureDateFlexDays: Math.min(3, Math.max(0, Math.round(ask.flexDays))) } : {}),
  };
  const r = await callTool(o.url ?? KIWI_URL, "search-flight", args, o.fetch ? { fetch: o.fetch } : {});
  if (r.isError) throw new Error(r.text.slice(0, 200) || "the flight search failed");
  let data: unknown = r.structured;
  if (!data) { try { data = JSON.parse(r.text); } catch { data = null; } }
  return { kind: "flights", ...readFlights(data, currency), source: { name: "Kiwi.com", url: "https://www.kiwi.com" } };
}

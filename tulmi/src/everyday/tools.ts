/**
 * THE EVERYDAY TOOLS AS A BOT SEES THEM (bots/tools.ts buildTools): their definitions, who gets which, and what the model reads back.
 *
 *   flights_search, hotels_search    a bot that searches the web (web or research on), and the Travel bot
 *   currency_convert, weather        those, and Plan Ease
 *
 * Keylessbord and Xode get none (they write, and Xode's answers go through its own road). What the model reads back is a few lines of
 * data per result, in the fence every tool result is in; the full results become the cards beside the answer.
 */
import type { ToolDef } from "../code/brain/types.js";
import { EverydayError, type Card, type Everyday, type EverydayKind } from "./index.js";

export interface EverydayBot { id: string; skills: { web?: boolean; research?: boolean } }

/** Which everyday tools a bot gets. */
export function everydayKindsFor(bot: EverydayBot): EverydayKind[] {
  const searches = !!(bot.skills.web || bot.skills.research) || bot.id === "travel";
  const daily = searches || bot.id === "plan";
  return [...(searches ? ["flights", "stays"] as const : []), ...(daily ? ["money", "weather"] as const : [])];
}

const DAY = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export const EVERYDAY_TOOLS: Record<EverydayKind, ToolDef> = {
  flights: {
    name: "flights_search",
    description: "Search live flights and prices (Kiwi.com). Give from and to as a city or airport code, and dates as YYYY-MM-DD worked out from today. Returns the cheapest options with times, stops, airlines and a booking link; the person books on Kiwi.com. Use the person's currency (INR in India).",
    parameters: {
      type: "object", additionalProperties: false, required: ["from", "to", "date"],
      properties: {
        from: { type: "string", maxLength: 60 }, to: { type: "string", maxLength: 60 }, date: DAY, returnDate: DAY,
        adults: { type: "integer", minimum: 1, maximum: 9 }, children: { type: "integer", minimum: 0, maximum: 8 }, infants: { type: "integer", minimum: 0, maximum: 4 },
        cabin: { type: "string", enum: ["economy", "premium", "business", "first"] }, currency: { type: "string", maxLength: 3 },
        maxStops: { type: "integer", minimum: 0, maximum: 3, description: "0 for non-stop only" }, flexDays: { type: "integer", minimum: 0, maximum: 3, description: "± days around the date" },
      },
    },
  },
  stays: {
    name: "hotels_search",
    description: "Search live hotel prices (trivago compares booking sites). Give the place (a city, area, landmark or hotel name) and checkIn/checkOut as YYYY-MM-DD worked out from today. Returns hotels with price a night, rating, area, perks and a link; the person books on the site they pick. country is the person's own country (IN in India), currency theirs.",
    parameters: {
      type: "object", additionalProperties: false, required: ["place", "checkIn", "checkOut"],
      properties: {
        place: { type: "string", maxLength: 120 }, checkIn: DAY, checkOut: DAY, adults: { type: "integer", minimum: 1, maximum: 10 },
        children: { type: "integer", minimum: 0, maximum: 6 }, rooms: { type: "integer", minimum: 1, maximum: 5 },
        country: { type: "string", maxLength: 2 }, currency: { type: "string", maxLength: 3 }, maxPrice: { type: "number", minimum: 1, description: "top price a night, in currency" },
      },
    },
  },
  money: {
    name: "currency_convert",
    description: "Convert an amount between currencies at today's central-bank rate (a working day's reference rate, not a live market price). from and to are codes like USD and INR.",
    parameters: {
      type: "object", additionalProperties: false, required: ["amount", "from", "to"],
      properties: { amount: { type: "number", exclusiveMinimum: 0 }, from: { type: "string", maxLength: 20 }, to: { type: "string", maxLength: 20 } },
    },
  },
  weather: {
    name: "weather",
    description: "The weather now and the next few days (low, high, rain) for a city or town.",
    parameters: { type: "object", additionalProperties: false, required: ["place"], properties: { place: { type: "string", maxLength: 120 } } },
  },
};

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const hm = (iso: string): string => iso.slice(11, 16);
const dur = (m: number): string => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** What the model reads of a card: a few lines of data. */
export function cardLines(c: Card): string {
  if (c.kind === "flights") {
    if (!c.results.length) return `No flights found for ${c.query}.`;
    return [`Flights, ${c.query} (cheapest first; the person sees them as cards with booking links):`, ...c.results.slice(0, 5).map((f, i) =>
      `${i + 1}. ${f.priceText} · ${f.out.route.join("→")} · ${f.out.depart.slice(0, 10)} ${hm(f.out.depart)}→${hm(f.out.arrive)} (${dur(f.out.minutes)}, ${f.out.stops ? `${f.out.stops} stop${f.out.stops > 1 ? "s" : ""}` : "non-stop"}) · ${f.out.airlines.join(", ")}${f.back ? ` · back ${f.back.depart.slice(0, 10)} ${hm(f.back.depart)}` : ""}`)].join("\n");
  }
  if (c.kind === "stays") {
    if (!c.results.length) return `No hotels found in ${c.query} for ${c.checkIn} to ${c.checkOut}.`;
    return [`Hotels in ${c.query}, ${c.checkIn} to ${c.checkOut} (shown to the person as cards with links):`, ...c.results.slice(0, 5).map((h, i) =>
      `${i + 1}. ${h.name} · ${h.perNight}/night on ${h.advertiser} · ${h.stars ? `${h.stars}★ · ` : ""}${h.rating ? `${h.rating}/10 (${h.reviews} reviews)` : "no rating"} · ${h.area}${h.perks.length ? ` · ${h.perks.join(", ")}` : ""}`)].join("\n");
  }
  if (c.kind === "money") return `${c.amount} ${c.from} = ${c.result} ${c.to} (rate ${c.rate}, central-bank reference rate of ${c.day}).`;
  return [`Weather in ${c.place}${c.now ? `: now ${c.now.tempC}°C, ${c.now.symbol.replace(/_/g, " ")}` : ""}.`, ...c.days.map((d) => `${d.day}: ${d.minC}–${d.maxC}°C, rain ${d.rainMm} mm, ${d.symbol.replace(/_(day|night|polartwilight)$/, "").replace(/_/g, " ")}`)].join("\n");
}

/** Runs one everyday tool for a person; the card it found goes to `found`. */
export async function runEveryday(e: Everyday, userId: string, kind: EverydayKind, a: Record<string, unknown>, found: (c: Card) => void): Promise<{ content: string; ok: boolean }> {
  try {
    let card: Card;
    if (kind === "flights") {
      const cabin = s(a.cabin);
      card = await e.flights(userId, {
        from: s(a.from), to: s(a.to), date: s(a.date), ...(s(a.returnDate) ? { returnDate: s(a.returnDate) } : {}),
        ...(n(a.adults) ? { adults: n(a.adults)! } : {}), ...(n(a.children) !== undefined ? { children: n(a.children)! } : {}), ...(n(a.infants) !== undefined ? { infants: n(a.infants)! } : {}),
        ...(cabin === "economy" || cabin === "premium" || cabin === "business" || cabin === "first" ? { cabin } : {}),
        ...(s(a.currency) ? { currency: s(a.currency) } : {}), ...(n(a.maxStops) !== undefined ? { maxStops: n(a.maxStops)! } : {}), ...(n(a.flexDays) ? { flexDays: n(a.flexDays)! } : {}),
      });
    } else if (kind === "stays") {
      card = await e.stays(userId, {
        place: s(a.place), checkIn: s(a.checkIn), checkOut: s(a.checkOut), ...(n(a.adults) ? { adults: n(a.adults)! } : {}), ...(n(a.children) !== undefined ? { children: n(a.children)! } : {}),
        ...(n(a.rooms) ? { rooms: n(a.rooms)! } : {}), ...(s(a.country) ? { country: s(a.country) } : {}), ...(s(a.currency) ? { currency: s(a.currency) } : {}), ...(n(a.maxPrice) ? { maxPrice: n(a.maxPrice)! } : {}),
      });
    } else if (kind === "money") {
      card = await e.money(userId, n(a.amount) ?? NaN, s(a.from), s(a.to));
    } else {
      card = await e.weather(userId, s(a.place));
    }
    const empty = (card.kind === "flights" || card.kind === "stays") && !card.results.length;
    if (!empty) found(card);
    return { content: cardLines(card), ok: true };
  } catch (err) {
    const msg = err instanceof EverydayError ? err.message : "That search didn't work.";
    return { content: `${EVERYDAY_TOOLS[kind].name}: ${msg}`, ok: false };
  }
}

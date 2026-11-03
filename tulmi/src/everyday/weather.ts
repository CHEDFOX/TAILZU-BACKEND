/**
 * WEATHER: the forecast the trip screens already use (places/: MET Norway, free, commercial use allowed), as a card: now, and the next
 * days' low, high and rain. A place is found by our city list first, then the geocoder when one is on; a name with a case ending
 * after an apostrophe (Turkish "İstanbul'u") is tried again bare (bareName).
 */
import type { Forecast, LatLon, Place } from "../places/types.js";
import type { WeatherCard, WeatherDay } from "./types.js";

export interface WeatherPorts {
  place(name: string): Promise<Place | null>;
  forecast(at: LatLon): Promise<Forecast | null>;
}

/** A place's own clock, near enough for its days: India's half hour, else the sun's. */
const offsetOf = (p: Place): number => (p.country?.toUpperCase() === "IN" || (p.lon > 68 && p.lon < 97.5 && p.lat > 6 && p.lat < 36) ? 330 : Math.round(p.lon / 15) * 60);

/** The forecast's steps, grouped into the place's days: low, high, rain, and the symbol at midday (or the first one). */
export function daysOf(f: Forecast, tz: number, max = 5): WeatherDay[] {
  const by = new Map<string, Array<Forecast["steps"][number]>>();
  for (const s of f.steps) {
    const day = new Date(s.t + tz * 60_000).toISOString().slice(0, 10);
    by.set(day, [...(by.get(day) ?? []), s]);
  }
  return [...by.entries()].slice(0, max).map(([day, steps]) => {
    const noon = steps.find((s) => new Date(s.t + tz * 60_000).getUTCHours() >= 12) ?? steps[0]!;
    return {
      day, minC: Math.round(Math.min(...steps.map((s) => s.tempC))), maxC: Math.round(Math.max(...steps.map((s) => s.tempC))),
      rainMm: Math.round(steps.reduce((n, s) => n + (s.rainMm || 0), 0) * 10) / 10, symbol: noon.symbol,
    };
  });
}

/**
 * The place's own name, as a city list or a geocoder knows it: a case ending some languages join to a name with an apostrophe goes
 * ("İstanbul'u", "İstanbul'da", "Paris'te": Istanbul, Paris), and so does a possessive ("Mumbai's").
 */
export function bareName(name: string): string {
  return name.trim().replace(/[\u2019']\p{L}{1,5}$/u, "").trim();
}

export async function weatherFor(name: string, ports: WeatherPorts): Promise<WeatherCard> {
  const asked = name.trim().slice(0, 120);
  const place = (await ports.place(asked)) ?? (bareName(asked) !== asked ? await ports.place(bareName(asked)) : null);
  if (!place) throw new Error(`couldn't find "${name}" on the map`);
  const f = await ports.forecast(place);
  if (!f || !f.steps.length) throw new Error("the forecast could not be read just now");
  const first = f.steps[0]!;
  return {
    kind: "weather", place: place.label, now: { tempC: Math.round(first.tempC), symbol: first.symbol }, days: daysOf(f, offsetOf(place)),
    source: { name: "MET Norway", url: "https://www.met.no/en" },
  };
}

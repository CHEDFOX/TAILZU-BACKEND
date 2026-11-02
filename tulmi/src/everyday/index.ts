/**
 * EVERYDAY TOOLS: live answers every person has without connecting anything (docs/everyday.md). Free services, called by the server
 * with no sign-in of the person's:
 *
 *   flights   Kiwi.com's flight search (public MCP server)          flights.ts
 *   stays     trivago's hotel search (public MCP server)            stays.ts
 *   money     currency at central-bank rates (Frankfurter)          money.ts
 *   weather   the forecast the trip screens use (MET Norway)        weather.ts
 *
 * They are bot tools (tools.ts: which bot gets which), and what they find comes back as CARDS beside the answer: kept here for a while
 * under an id (`finds`), which the answer carries and Ask's page reads (GET /v1/everyday/finds/:id). Nothing is booked or paid: every
 * card links out.
 *
 * Shared, free services: each person has a day's allowance of searches (EVERYDAY_DAILY), the same question is answered from memory for
 * a while (flights and stays 20 minutes, rates 6 hours, weather by the forecast's own expiry), and the whole server keeps to a few calls
 * at a time. EVERYDAY=false switches them all off; EVERYDAY_OFF lists single ones to leave out ("stays,flights").
 */
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { places } from "../places/index.js";
import { TtlCache } from "../places/cache.js";
import { searchFlights, type FlightAsk, KIWI_URL } from "./flights.js";
import { convert, FRANKFURTER_URL } from "./money.js";
import type { FetchFn } from "./mcpLite.js";
import { searchStays, type StayAsk, TRIVAGO_URL } from "./stays.js";
import type { Card } from "./types.js";
import { weatherFor, type WeatherPorts } from "./weather.js";

export type { Card, FlightsCard, StaysCard, MoneyCard, WeatherCard, Flight, Stay, FlightLeg, WeatherDay } from "./types.js";
export { airportOf, kiwiDate } from "./flights.js";
export { currencyOf } from "./money.js";

export type EverydayKind = "flights" | "stays" | "money" | "weather";
export const EVERYDAY_KINDS: readonly EverydayKind[] = ["flights", "stays", "money", "weather"];

const MIN = 60_000;
const FINDS_KEEP_MS = 24 * 60 * MIN;
const FINDS_MAX = 20_000;
const AT_ONCE = 6;

export class EverydayError extends Error {
  constructor(readonly code: "off" | "limit" | "bad_request" | "failed", message: string) {
    super(message);
    this.name = "EverydayError";
  }
}

export interface EverydayOptions {
  on?: Partial<Record<EverydayKind, boolean>>;
  /** Searches (flights and stays) a person may make in a day; rates and weather cost nothing to us and count a tenth. */
  daily?: number;
  urls?: { flights?: string; stays?: string; money?: string };
  fetch?: FetchFn;
  weather?: WeatherPorts;
  now?: () => number;
}

export class Everyday {
  private readonly now: () => number;
  private readonly cache: TtlCache<Card>;
  private readonly finds = new Map<string, { userId: string; at: number; cards: Card[] }>();
  private readonly used = new Map<string, { day: string; n: number }>();
  private running = 0;

  constructor(private readonly o: EverydayOptions = {}) {
    this.now = o.now ?? Date.now;
    this.cache = new TtlCache<Card>(2_000, this.now);
  }

  on(kind: EverydayKind): boolean { return this.o.on?.[kind] !== false; }

  /** What one kind costs a person's day: a search 1, rates and weather a tenth. */
  private spend(userId: string, kind: EverydayKind): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const u = this.used.get(userId);
    const n = u && u.day === day ? u.n : 0;
    const cost = kind === "flights" || kind === "stays" ? 10 : 1;
    if (n + cost > (this.o.daily ?? 40) * 10) throw new EverydayError("limit", "You've used today's live searches. They come back tomorrow.");
    this.used.set(userId, { day, n: n + cost });
    if (this.used.size > 50_000) for (const k of [...this.used.keys()].slice(0, 10_000)) this.used.delete(k);
  }

  private async run<T extends Card>(userId: string, kind: EverydayKind, key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
    if (!this.on(kind)) throw new EverydayError("off", `${kind} search is switched off.`);
    const hit = this.cache.get(`${kind}:${key}`);
    if (hit) return hit as T;
    this.spend(userId, kind);
    if (this.running >= AT_ONCE) throw new EverydayError("failed", "Too many searches at once. Try again in a moment.");
    this.running++;
    try {
      const card = await work();
      this.cache.set(`${kind}:${key}`, card, ttlMs);
      return card;
    } catch (err) {
      if (err instanceof EverydayError) throw err;
      throw new EverydayError("failed", (err as Error)?.message?.slice(0, 200) || "That search didn't work.");
    } finally {
      this.running--;
    }
  }

  flights(userId: string, ask: FlightAsk) {
    const key = JSON.stringify([ask.from.toLowerCase(), ask.to.toLowerCase(), ask.date, ask.returnDate ?? "", ask.adults ?? 1, ask.children ?? 0, ask.infants ?? 0, ask.cabin ?? "", ask.currency ?? "", ask.maxStops ?? "", ask.flexDays ?? 0]);
    return this.run(userId, "flights", key, 20 * MIN, () => searchFlights(ask, { ...(this.o.urls?.flights ? { url: this.o.urls.flights } : {}), ...(this.o.fetch ? { fetch: this.o.fetch } : {}) }));
  }

  stays(userId: string, ask: StayAsk) {
    const key = JSON.stringify([ask.place.toLowerCase(), ask.checkIn, ask.checkOut, ask.adults ?? 2, ask.children ?? 0, ask.rooms ?? 1, ask.country ?? "", ask.currency ?? "", ask.maxPrice ?? 0]);
    const locate = async (p: string) => (await this.weatherPorts().place(p)) ?? null;
    return this.run(userId, "stays", key, 20 * MIN, () => searchStays(ask, { ...(this.o.urls?.stays ? { url: this.o.urls.stays } : {}), ...(this.o.fetch ? { fetch: this.o.fetch } : {}), locate }));
  }

  money(userId: string, amount: number, from: string, to: string) {
    const key = JSON.stringify([amount, from.toLowerCase(), to.toLowerCase()]);
    return this.run(userId, "money", key, 6 * 60 * MIN, () => convert(amount, from, to, { ...(this.o.urls?.money ? { url: this.o.urls.money } : {}), ...(this.o.fetch ? { fetch: this.o.fetch } : {}) }));
  }

  weather(userId: string, place: string) {
    return this.run(userId, "weather", place.trim().toLowerCase(), 30 * MIN, () => weatherFor(place, this.weatherPorts()));
  }

  private weatherPorts(): WeatherPorts {
    if (this.o.weather) return this.o.weather;
    const p = places();
    return { place: (name) => p.place(name), forecast: (at) => p.forecast(at) };
  }

  /** Keeps an answer's cards for its page: their id, or "" when there are none. */
  keep(userId: string, cards: Card[]): string {
    if (!cards.length) return "";
    const t = this.now();
    if (this.finds.size >= FINDS_MAX) {
      for (const [k, v] of this.finds) { if (t - v.at > FINDS_KEEP_MS || this.finds.size >= FINDS_MAX) this.finds.delete(k); if (this.finds.size < FINDS_MAX * 0.9) break; }
    }
    const id = randomUUID();
    this.finds.set(id, { userId, at: t, cards: cards.slice(0, 6) });
    return id;
  }

  /** An answer's cards, for their owner only, while they are kept. */
  found(userId: string, id: string): Card[] | null {
    const f = this.finds.get(id);
    if (!f || f.userId !== userId || this.now() - f.at > FINDS_KEEP_MS) return null;
    return f.cards;
  }
}

let current: Everyday | null | undefined;

/** The server's, from the config; null when EVERYDAY is false. */
export function everyday(): Everyday | null {
  if (current === undefined) {
    let c: { EVERYDAY?: boolean; EVERYDAY_OFF?: string; EVERYDAY_DAILY?: number; EVERYDAY_FLIGHTS_URL?: string; EVERYDAY_STAYS_URL?: string; EVERYDAY_RATES_URL?: string } = {};
    try { c = getConfig(); } catch { /* no config: the defaults */ }
    const off = new Set((c.EVERYDAY_OFF ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    current = c.EVERYDAY === false ? null : new Everyday({
      on: Object.fromEntries(EVERYDAY_KINDS.map((k) => [k, !off.has(k)])) as Record<EverydayKind, boolean>,
      daily: c.EVERYDAY_DAILY ?? 40,
      urls: { flights: c.EVERYDAY_FLIGHTS_URL ?? KIWI_URL, stays: c.EVERYDAY_STAYS_URL ?? TRIVAGO_URL, money: c.EVERYDAY_RATES_URL ?? FRANKFURTER_URL },
    });
  }
  return current;
}

export function setEverydayForTests(e: Everyday | null | undefined): void { current = e; }

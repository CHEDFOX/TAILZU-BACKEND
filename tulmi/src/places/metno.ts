/**
 * THE WEATHER: MET Norway's Locationforecast 2.0 (api.met.no), free for any use including commercial, data under CC BY 4.0 (the screen
 * credits "Weather: MET Norway"). Its terms, kept here:
 *
 *   - an identifying User-Agent with a way to reach us (polite.ts userAgentFor); a request without one is refused with 403
 *   - no more than needed: a forecast is not asked for again before its Expires header, and after that only with If-Modified-Since
 *     (a 304 keeps what we have); points are cut to 2 decimals (about a kilometre, plenty for weather; their limit is 4), which also
 *     means a person's exact address never leaves the server
 *   - a 203 means the product is being retired: logged once as a warning so we move before it ends
 *   - over 20 requests a second in all needs an agreement with them; a polite line (one at a time) stays far below it
 *
 * The forecast is hourly for about two and a half days, then six-hourly to nine or ten days out. It is kept in memory per point
 * (at most 2,000 points); nothing is written anywhere and nothing is logged.
 */
import { TtlCache } from "./cache.js";
import type { Polite } from "./polite.js";
import type { Forecast, ForecastStep, LatLon, WeatherSource } from "./types.js";

const MIN = 60_000;
const DEFAULT_LIFE = 30 * MIN;
const KEEP_AFTER_EXPIRY = 12 * 60 * MIN;

interface Kept { forecast: Forecast; lastModified: string | null }

export function parseMetno(body: unknown, fetchedAt: number, expiresAt: number): Forecast | null {
  const series = (body as { properties?: { timeseries?: unknown[] } } | null)?.properties?.timeseries;
  if (!Array.isArray(series)) return null;
  const steps: ForecastStep[] = [];
  for (const s of series as Array<{ time?: string; data?: Record<string, { summary?: { symbol_code?: string }; details?: Record<string, number> }> }>) {
    const t = Date.parse(s.time ?? "");
    const temp = Number(s.data?.instant?.details?.air_temperature);
    const next = s.data?.next_1_hours ? { h: 1, d: s.data.next_1_hours } : s.data?.next_6_hours ? { h: 6, d: s.data.next_6_hours } : null;
    if (!Number.isFinite(t) || !Number.isFinite(temp) || !next) continue;
    const rain = Number(next.d.details?.precipitation_amount ?? 0);
    steps.push({ t, hours: next.h, tempC: Math.round(temp * 10) / 10, rainMm: Number.isFinite(rain) ? rain : 0, symbol: String(next.d.summary?.symbol_code ?? "") });
  }
  return steps.length ? { fetchedAt, expiresAt, steps } : null;
}

export class MetNoWeather implements WeatherSource {
  readonly id = "metno";
  private kept: TtlCache<Kept>;
  private warned = false;

  constructor(private readonly o: { baseUrl: string; line: Polite; now?: () => number; warn?: (msg: string) => void }) {
    this.kept = new TtlCache<Kept>(2_000, o.now ?? Date.now);
  }

  private get now(): number { return (this.o.now ?? Date.now)(); }
  private key(at: LatLon): string { return `${at.lat.toFixed(2)},${at.lon.toFixed(2)}`; }

  /** A forecast still within its Expires, without asking anyone; undefined when there is none. */
  peek(at: LatLon): Forecast | undefined {
    const k = this.kept.get(this.key(at));
    return k && k.forecast.expiresAt > this.now ? k.forecast : undefined;
  }

  async forecast(at: LatLon): Promise<Forecast | null> {
    const fresh = this.peek(at);
    if (fresh) return fresh;
    const key = this.key(at);
    const had = this.kept.get(key) ?? null;
    const [lat, lon] = key.split(",");
    const res = await this.o.line.get(`${this.o.baseUrl.replace(/\/+$/, "")}/compact?lat=${lat}&lon=${lon}`,
      had?.lastModified ? { headers: { "if-modified-since": had.lastModified } } : {});
    const now = this.now;
    const expires = Date.parse(res.headers.get("expires") ?? "");
    const expiresAt = Number.isFinite(expires) && expires > now ? Math.min(expires, now + 6 * 60 * MIN) : now + DEFAULT_LIFE;
    if (res.status === 304 && had) {
      const forecast = { ...had.forecast, expiresAt };
      this.kept.set(key, { forecast, lastModified: had.lastModified }, expiresAt - now + KEEP_AFTER_EXPIRY);
      return forecast;
    }
    if (res.status === 203 && !this.warned) {
      this.warned = true;
      (this.o.warn ?? console.warn)("[places] MET Norway says this Locationforecast version is being retired (203): move to the new one.");
    }
    if (!res.ok) throw new Error(`metno: ${res.status}`);
    const forecast = parseMetno(await res.json(), now, expiresAt);
    if (!forecast) return null;
    this.kept.set(key, { forecast, lastModified: res.headers.get("last-modified") }, expiresAt - now + KEEP_AFTER_EXPIRY);
    return forecast;
  }
}

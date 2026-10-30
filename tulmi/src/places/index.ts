/**
 * PLACES: WHERE THINGS ARE, HOW LONG IT TAKES BETWEEN THEM, AND THE WEATHER THERE. For Plan Ease's travel times and the Travel bot's
 * trip (src/botsBots/planTravel.ts, tripExtras.ts). Every provider is behind an interface (types.ts) with an address in the config, so
 * a public server today becomes one we run tomorrow by changing one setting.
 *
 *   const p = places()                     the server's, from the config (placesFromConfig)
 *   await p.place("Indiranagar", { country: "in" })      -> Place | null      the city list first (cities.ts), then the geocoder
 *   await p.travel(a, b)                   -> Leg | null       walking when it is close and short, else driving (with the buffer)
 *   await p.forecast(point)                -> Forecast | null
 *   p.peekPlace / peekTravel / peekForecast   the same from memory only: undefined when not known yet (a screen load never waits on
 *                                          a provider; it draws what is known and the rest comes by the live channel)
 *   p.credits()                            what the screen shows for the providers that are on
 *
 * THE SETTINGS (config.ts, all optional; the feature is simply not shown without them):
 *   PLACES_GEOCODER  photon | nominatim | off (default off)       PLACES_GEOCODE_URL  photon: https://photon.komoot.io unless set;
 *                                                                                    nominatim: must be set (see geocoders.ts)
 *   PLACES_ROUTER    osrm | ors | off (default off)               PLACES_ROUTE_URL    osrm: https://routing.openstreetmap.de/routed-{mode}
 *                                                                                    unless set; ors: https://api.openrouteservice.org
 *   PLACES_ROUTE_KEY the openrouteservice key (a SECRET; not needed for our own ORS)
 *   PLACES_RATE_MS   least time between two requests to the geocoder, and to the router (default 1100: the public servers' one a second;
 *                    0 for our own)
 *   PLACES_DRIVE_BUFFER   drive times are free-flow; this multiplies them (default 1.3) so a "leave by" is not optimistic. Shown as
 *                    "about"; never claimed to be traffic
 *   PLACES_CONTACT   who we are in the User-Agent (default https://x0bot.com; an email works too)
 *   WEATHER          metno | off (default metno: free, commercial use allowed, no key)      WEATHER_URL  its Locationforecast address
 *
 * Caches (memory): places 30 days (not found: 7 days; a failure: 15 minutes; a provider resting: 2), legs 14 days (no route: a day),
 * forecasts to their Expires. Nothing is
 * written to a table and nothing is logged: not the words, not the points.
 */
import { getConfig } from "../config.js";
import { TtlCache } from "./cache.js";
import { cityNamed } from "./cities.js";
import { nominatimGeocoder, photonGeocoder } from "./geocoders.js";
import { MetNoWeather } from "./metno.js";
import { Polite, userAgentFor, type FetchFn } from "./polite.js";
import { orsRouting, osrmRouting } from "./routers.js";
import { PlacesBusy, type Credit, type Forecast, type Geocoder, type GeocodeHints, type LatLon, type Leg, type Mode, type Place, type Routing, type WeatherSource } from "./types.js";

export * from "./types.js";
export { cityNamed, countryForOffset } from "./cities.js";

const MIN = 60_000, DAY = 24 * 60 * MIN;
/** Walk when the straight line is at most this, and the walk at most WALK_MAX_MIN. */
export const WALK_KM = 1.6;
export const WALK_MAX_MIN = 20;
/** How long a failed lookup is not tried again (a provider that said slow down: less). */
const FAIL_TTL = 15 * MIN, BUSY_TTL = 2 * MIN;

/** Kilometres in a straight line. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const normWords = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ,.'-]/gu, "").trim().slice(0, 200);
const pt4 = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

export interface PlacesOpts {
  geocoder?: Geocoder | null;
  routing?: Routing | null;
  weather?: WeatherSource | null;
  /** Multiplies drive minutes (1 to 3). */
  driveBuffer?: number;
  /** The public FOSSGIS router is in use: its terms ask for a "fix the map" link. */
  fixTheMap?: boolean;
  now?: () => number;
}

export class Places {
  readonly geocoder: Geocoder | null;
  readonly routing: Routing | null;
  readonly weather: WeatherSource | null;
  private readonly buffer: number;
  private readonly now: () => number;
  private readonly found: TtlCache<Place>;
  private readonly legs: TtlCache<Leg>;
  private readonly wxMissed: TtlCache<true>;
  private readonly wxHeld: TtlCache<Forecast>;

  constructor(private readonly o: PlacesOpts = {}) {
    this.geocoder = o.geocoder ?? null;
    this.routing = o.routing ?? null;
    this.weather = o.weather ?? null;
    this.buffer = Math.min(3, Math.max(1, o.driveBuffer ?? 1.3));
    this.now = o.now ?? Date.now;
    this.found = new TtlCache<Place>(5_000, this.now);
    this.legs = new TtlCache<Leg>(20_000, this.now);
    this.wxMissed = new TtlCache<true>(2_000, this.now);
    this.wxHeld = new TtlCache<Forecast>(2_000, this.now);
  }

  /** Can find a street or an area (not just a city). */
  get locates(): boolean { return !!this.geocoder; }
  get routes(): boolean { return !!this.routing; }
  get forecasts(): boolean { return !!this.weather; }

  private placeKey(q: string, h?: GeocodeHints): string {
    return `${normWords(q)}|${h?.country ?? ""}|${h?.near ? `${h.near.lat.toFixed(1)},${h.near.lon.toFixed(1)}` : ""}`;
  }

  /** From memory: a city by name, or what the geocoder found before. undefined: not looked up yet. */
  peekPlace(q: string, hints?: GeocodeHints): Place | null | undefined {
    const city = cityNamed(q);
    if (city) return city;
    if (!this.geocoder || !normWords(q)) return null;
    return this.found.get(this.placeKey(q, hints));
  }

  async place(q: string, hints?: GeocodeHints): Promise<Place | null> {
    const known = this.peekPlace(q, hints);
    if (known !== undefined) return known;
    const key = this.placeKey(q, hints);
    try {
      const [best] = await this.geocoder!.geocode(normWords(q), hints);
      this.found.set(key, best ?? null, best ? 30 * DAY : 7 * DAY);
      return best ?? null;
    } catch (e) {
      this.found.set(key, null, e instanceof PlacesBusy ? BUSY_TTL : FAIL_TTL);
      return null;
    }
  }

  private legKey(a: LatLon, b: LatLon, mode: Mode) { return `${mode}|${pt4(a)}|${pt4(b)}`; }

  peekLeg(a: LatLon, b: LatLon, mode: Mode): Leg | null | undefined {
    if (!this.routing?.modes.includes(mode)) return null;
    return this.legs.get(this.legKey(a, b, mode));
  }

  async leg(a: LatLon, b: LatLon, mode: Mode): Promise<Leg | null> {
    const known = this.peekLeg(a, b, mode);
    if (known !== undefined) return known;
    const key = this.legKey(a, b, mode);
    try {
      const leg = await this.routing!.leg(a, b, mode);
      this.legs.set(key, leg, leg ? 14 * DAY : DAY);
      return leg;
    } catch (e) {
      this.legs.set(key, null, e instanceof PlacesBusy ? BUSY_TTL : FAIL_TTL);
      return null;
    }
  }

  private buffered(l: Leg): Leg { return { ...l, minutes: Math.max(1, Math.ceil(l.minutes * this.buffer)) }; }
  private walkable(a: LatLon, b: LatLon) { return !!this.routing?.modes.includes("walk") && distanceKm(a, b) <= WALK_KM; }

  /** How to get from a to b, from memory: undefined when a lookup it needs has not happened yet. */
  peekTravel(a: LatLon, b: LatLon): Leg | null | undefined {
    if (!this.routing) return null;
    if (this.walkable(a, b)) {
      const w = this.peekLeg(a, b, "walk");
      if (w === undefined) return undefined;
      if (w && w.minutes <= WALK_MAX_MIN) return w;
    }
    const d = this.peekLeg(a, b, "drive");
    return d === undefined ? undefined : d ? this.buffered(d) : null;
  }

  async travel(a: LatLon, b: LatLon): Promise<Leg | null> {
    if (!this.routing) return null;
    if (this.walkable(a, b)) {
      const w = await this.leg(a, b, "walk");
      if (w && w.minutes <= WALK_MAX_MIN) return w;
    }
    const d = await this.leg(a, b, "drive");
    return d ? this.buffered(d) : null;
  }

  private wxKey(at: LatLon) { return `${at.lat.toFixed(2)},${at.lon.toFixed(2)}`; }

  /** A fresh forecast from memory; null when there is no weather here or the last try failed lately; undefined when not asked yet. */
  peekForecast(at: LatLon): Forecast | null | undefined {
    if (!this.weather) return null;
    const f = this.weather.peek?.(at) ?? this.wxHeld.get(this.wxKey(at));
    if (f) return f;
    return this.wxMissed.get(this.wxKey(at)) ? null : undefined;
  }

  async forecast(at: LatLon): Promise<Forecast | null> {
    if (!this.weather) return null;
    try {
      const f = await this.weather.forecast(at);
      if (!f) this.wxMissed.set(this.wxKey(at), true, FAIL_TTL);
      else this.wxHeld.set(this.wxKey(at), f, Math.max(60_000, f.expiresAt - this.now()));
      return f;
    } catch (e) {
      this.wxMissed.set(this.wxKey(at), true, e instanceof PlacesBusy ? BUSY_TTL : FAIL_TTL);
      return null;
    }
  }

  /** What the screen credits, for the providers that are on. */
  credits(o: { map?: boolean; weather?: boolean } = { map: true, weather: true }): Credit[] {
    const out: Credit[] = [];
    if (o.map && (this.geocoder || this.routing)) {
      out.push({ text: "Map data © OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" });
      if (this.routing?.id === "ors") out.push({ text: "Routes: openrouteservice", url: "https://openrouteservice.org" });
      if (this.routing?.id === "osrm") out.push({ text: "Routes: OSRM", url: "https://project-osrm.org" });
      if (this.o.fixTheMap) out.push({ text: "Fix the map", url: "https://www.openstreetmap.org/fixthemap" });
    }
    if (o.weather && this.weather) out.push({ text: "Weather: MET Norway", url: "https://www.met.no/en" });
    return out;
  }
}

// ------------------------------------------------------------------ from the config

export interface PlacesConfig {
  PLACES_GEOCODER?: string;
  PLACES_GEOCODE_URL?: string;
  PLACES_ROUTER?: string;
  PLACES_ROUTE_URL?: string;
  PLACES_ROUTE_KEY?: string;
  PLACES_RATE_MS?: number;
  PLACES_DRIVE_BUFFER?: number;
  PLACES_CONTACT?: string;
  WEATHER?: string;
  WEATHER_URL?: string;
}

export const DEFAULT_PHOTON_URL = "https://photon.komoot.io";
export const DEFAULT_OSRM_URL = "https://routing.openstreetmap.de/routed-{mode}";
export const DEFAULT_ORS_URL = "https://api.openrouteservice.org";
export const DEFAULT_METNO_URL = "https://api.met.no/weatherapi/locationforecast/2.0";
/** The public servers' asks: one request a second (Nominatim, FOSSGIS, OSRM's demo, Photon's fair use); openrouteservice's free plan, 40 a minute. */
const PUBLIC_FLOOR_MS: Record<string, number> = {
  "nominatim.openstreetmap.org": 1100, "photon.komoot.io": 1100, "routing.openstreetmap.de": 1100, "router.project-osrm.org": 1100, "api.openrouteservice.org": 1600,
};

/** The providers the settings name. `fetchFn` and `now` are for tests. */
export function placesFrom(c: PlacesConfig, o: { fetchFn?: FetchFn; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Places {
  const userAgent = userAgentFor(c.PLACES_CONTACT ?? "");
  const rate = Math.max(0, Math.min(10_000, Number(c.PLACES_RATE_MS ?? 1100)));
  const line = (name: string, minGapMs: number) => new Polite({ name, minGapMs, userAgent, fetchFn: o.fetchFn, now: o.now, sleep: o.sleep });
  /** The public servers' own floor (their terms), whatever PLACES_RATE_MS says; a server of ours gets PLACES_RATE_MS. */
  const gapFor = (url: string) => {
    let host = "";
    try { host = new URL(url.replace("{mode}", "car")).hostname; } catch { /* not an address: no floor */ }
    return PUBLIC_FLOOR_MS[host] !== undefined ? Math.max(rate, PUBLIC_FLOOR_MS[host]!) : rate;
  };
  const g = (c.PLACES_GEOCODER ?? "off").toLowerCase();
  const geoUrl = c.PLACES_GEOCODE_URL || (g === "photon" ? DEFAULT_PHOTON_URL : "");
  const geocoder = g === "photon" ? photonGeocoder({ baseUrl: geoUrl, line: line("photon", gapFor(geoUrl)) })
    : g === "nominatim" && geoUrl ? nominatimGeocoder({ baseUrl: geoUrl, line: line("nominatim", gapFor(geoUrl)) })
      : null;
  const r = (c.PLACES_ROUTER ?? "off").toLowerCase();
  const routeUrl = c.PLACES_ROUTE_URL || (r === "ors" ? DEFAULT_ORS_URL : DEFAULT_OSRM_URL);
  const routing = r === "osrm" ? osrmRouting({ baseUrl: routeUrl, line: line("osrm", gapFor(routeUrl)) })
    : r === "ors" && (c.PLACES_ROUTE_KEY || c.PLACES_ROUTE_URL) ? orsRouting({ baseUrl: routeUrl, key: c.PLACES_ROUTE_KEY, line: line("ors", gapFor(routeUrl)) })
      : null;
  const weather = (c.WEATHER ?? "metno").toLowerCase() === "metno"
    ? new MetNoWeather({ baseUrl: c.WEATHER_URL || DEFAULT_METNO_URL, line: line("metno", 250), now: o.now })
    : null;
  return new Places({ geocoder, routing, weather, driveBuffer: c.PLACES_DRIVE_BUFFER, fixTheMap: !!routing && routeUrl.includes("routing.openstreetmap.de"), now: o.now });
}

let made: Places | null = null;

/** The server's places, from the config; none of the providers when the config can't be read. */
export function places(): Places {
  if (!made) {
    let c: PlacesConfig = {};
    try { c = getConfig() as PlacesConfig; } catch { /* no config: nothing on */ c = { WEATHER: "off" }; }
    made = placesFrom(c);
  }
  return made;
}

/** Tests: use these, or (null) build from the config again. */
export function setPlacesForTests(p: Places | null): void { made = p; }

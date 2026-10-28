/**
 * WHAT THE TRAVEL BOT WORKS OUT FOR A TRIP: its dates (from how the person wrote them, tripDates.ts), the forecast on those days at the
 * place (places/metno.ts), a packing line the weather calls for, where the trip's main places are, and its stays compared: price a
 * night and for the whole stay, rating, and minutes to the main place (stays.ts compareStays, with the Plan bot's routing).
 *
 *   extras.read(user, trip, { tz })     -> TripExtras    from memory at once; what is missing is looked up after and the screen told
 *                                                        ("bot:travel")
 *   extras.find(user, trip)             a stay search on the web in the background (stays.ts webStaySource); the screen is told when done
 *
 * The weather needs no setting (MET Norway, and the city list for the place); the distances need a geocoder and a router
 * (places/index.ts). Without them the stays are still compared on price and rating. Nothing is booked or paid for here.
 */
import type { Credit, Forecast, LatLon, Places } from "../places/index.js";
import { countryForOffset, distanceKm } from "../places/index.js";
import { botTopic } from "../live/topics.js";
import type { Later } from "./later.js";
import { lookNow, type Look } from "./look.js";
import { dayOf, startOfDay } from "./plan.js";
import { compareStays, StaysLimit, type StayCompared, type StaySource } from "./stays.js";
import { tripDates, tripDays, type TripDates } from "./tripDates.js";
import type { Trip, Trips } from "./trips.js";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A stay or a place found further than this from the trip's city is someone else's: not used. */
const NEAR_KM = 60;
/** MET Norway's forecast reaches about this many days ahead. */
const FORECAST_DAYS = 9;

export type Sky = "clear" | "cloudy" | "rain" | "storm" | "snow";
export interface TripWeatherDay { key: string; hiC: number; loC: number; sky: Sky; rainMm: number }
export interface TripWeather {
  days: TripWeatherDay[];
  /** "Clear days, cool nights". */
  line: string;
  /** "Sat 29° · Sun 30° · Mon 28° · lows 16°". */
  sub: string;
  /** What to pack for it, when the list doesn't have it ("Light jacket, 16° nights"). */
  pack: string | null;
  /** The rest of the trip is past the forecast's reach. */
  more: string | null;
}

export interface TripExtras {
  dates: TripDates | null;
  /** The trip's place, as found ("Pune"); null when it couldn't be (or isn't looked up yet). */
  where: string | null;
  weather: TripWeather | null;
  /** Why there is no weather, in plain words, when there is none. */
  weatherNote: string | null;
  spots: Array<{ text: string; found: boolean | null }>;
  /** What "to the …" means for the stays: the first place's name, short. */
  main: string | null;
  stays: StayCompared[];
  /** A stay search is running; the screen is told when it ends. */
  finding: boolean;
  /** How the last one went: found some, found none, the day's searches are used up, or it failed. */
  searched: "found" | "none" | "limit" | "failed" | null;
  /** Stays can be searched for here. */
  canFind: boolean;
  /** Distances can be worked out here. */
  canMeasure: boolean;
  pending: boolean;
  credits: Credit[];
}

const skyOf = (symbol: string): Sky =>
  /thunder/.test(symbol) ? "storm" : /snow|sleet/.test(symbol) ? "snow" : /rain|drizzle/.test(symbol) ? "rain" : /cloudy|fog/.test(symbol) && !/partly/.test(symbol) ? "cloudy" : "clear";
const SKY_ORDER: Sky[] = ["clear", "cloudy", "snow", "rain", "storm"];
const weekday = (key: string) => WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()]!;
const dateWords = (key: string) => { const d = new Date(`${key}T00:00:00Z`); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** The forecast for a trip's days, in the person's day (their offset). */
export function tripWeather(f: Forecast, dates: TripDates, tz: number, packing: string[]): { weather: TripWeather | null; note: string | null } {
  const days: TripWeatherDay[] = [];
  const last = f.steps.length ? f.steps[f.steps.length - 1]! : null;
  const reach = last ? last.t + last.hours * HOUR : 0;
  for (const key of tripDays(dates)) {
    const from = startOfDay(key, tz), to = from + DAY;
    if (reach < to - 6 * HOUR) break;
    const steps = f.steps.filter((s) => s.t >= from && s.t < to);
    if (steps.length < 2) continue;
    const temps = steps.map((s) => s.tempC);
    // The day's sky: the worst that lasts (a step of rain in the day counts; one cloudy hour does not make it cloudy).
    const daytime = steps.filter((s) => s.t >= from + 7 * HOUR && s.t < from + 21 * HOUR);
    const skies = (daytime.length ? daytime : steps).map((s) => skyOf(s.symbol));
    const wet = steps.filter((s) => s.rainMm >= 0.5 || /rain|thunder|sleet/.test(s.symbol));
    const sky: Sky = skies.includes("storm") ? "storm" : wet.length >= 1 && steps.reduce((n, s) => n + s.rainMm, 0) >= 1 ? (skies.includes("snow") ? "snow" : "rain")
      : skies.filter((s) => s === "cloudy").length > skies.length / 2 ? "cloudy" : "clear";
    days.push({ key, hiC: Math.round(Math.max(...temps)), loC: Math.round(Math.min(...temps)), sky, rainMm: Math.round(steps.reduce((n, s) => n + s.rainMm, 0) * 10) / 10 });
  }
  if (!days.length) {
    const opens = new Date(Date.parse(`${dates.from}T00:00:00Z`) - FORECAST_DAYS * DAY).toISOString().slice(0, 10);
    return { weather: null, note: `The forecast for these days opens around ${dateWords(opens)}.` };
  }
  const lo = Math.min(...days.map((d) => d.loC)), hi = Math.max(...days.map((d) => d.hiC));
  const wetDays = days.filter((d) => d.sky === "rain" || d.sky === "storm");
  const worst = days.reduce((w, d) => (SKY_ORDER.indexOf(d.sky) > SKY_ORDER.indexOf(w) ? d.sky : w), "clear" as Sky);
  const many = days.length > 1;
  const names = (ds: TripWeatherDay[]) => ds.map((d) => weekday(d.key)).join(", ");
  let line = worst === "storm" ? `Storms on ${names(days.filter((d) => d.sky === "storm"))}`
    : wetDays.length === days.length ? (many ? "Rain every day" : "Rain that day")
      : wetDays.length ? `Rain on ${names(wetDays)}`
        : hi >= 35 ? (many ? "Hot days" : "Hot")
          : days.every((d) => d.sky === "cloudy") ? (many ? "Cloudy days" : "Cloudy")
            : days.some((d) => d.sky === "cloudy") ? "Sun and some cloud" : many ? "Clear days" : "Clear";
  if (lo <= 16) line += ", cool nights";
  else if (hi >= 35 && (wetDays.length || worst === "storm")) line += `, up to ${hi}°`;
  const sub = [...days.slice(0, 5).map((d) => `${weekday(d.key)} ${d.hiC}°`), `lows ${lo}°`].join(" · ");
  const have = (w: string) => packing.some((p) => p.toLowerCase().includes(w));
  const pack = wetDays.length && !have("umbrella") && !have("raincoat") ? `Umbrella, rain on ${weekday(wetDays[0]!.key)}`
    : lo <= 16 && !have("jacket") && !have("sweater") && !have("warm") ? `Light jacket, ${lo}° nights`
      : hi >= 35 && !have("cap") && !have("water") ? `Cap and water bottle, ${hi}° days` : null;
  const more = days.length < tripDays(dates).length ? "The rest comes into the forecast nearer the day." : null;
  return { weather: { days, line, sub, pack, more }, note: null };
}

/** "Sakshi's wedding, Koregaon Park" -> what to find ("Koregaon Park") and what to call it ("Sakshi's wedding"). */
export function spotParts(text: string): { find: string; name: string } {
  const [first, ...rest] = text.split(",").map((s) => s.trim()).filter(Boolean);
  return rest.length ? { find: rest.join(", "), name: first! } : { find: text.trim(), name: text.trim() };
}

export class TripExtrasReader {
  private finding = new Set<string>();
  /** How the last stay search for a trip went, until the next one. */
  private lastFind = new Map<string, "found" | "none" | "limit" | "failed">();

  constructor(private readonly o: { places: Places; later: Later; trips: Trips; source: StaySource | null; waitMs?: number; now?: () => number }) {}

  private get now(): number { return (this.o.now ?? Date.now)(); }

  /** Stays can be searched for on this server. */
  get canFind(): boolean { return !!this.o.source; }

  async read(userId: string, trip: Trip, opts: { tz: number }): Promise<TripExtras> {
    const tz = Math.max(-720, Math.min(840, Math.round(opts.tz) || 0));
    const places = this.o.places;
    const today = dayOf(this.now, tz);
    const dates = tripDates(trip.when, today);
    const country = countryForOffset(tz);
    const measure = places.locates && places.routes;

    const compute = (look: Look) => {
      const city = look.place(trip.place, country ? { country } : undefined);
      const hints = { ...(country && (!city || city.country === country) ? { country } : {}), ...(city ? { near: city } : {}) };
      const near = (p: LatLon | null | undefined) => (p && city && distanceKm(p, city) > NEAR_KM ? null : p);
      const find = (q: string): LatLon | null | undefined => (!places.locates ? null : city === undefined ? undefined : near(look.place(`${q}, ${trip.place}`, hints)));

      // the weather
      let weather: TripWeather | null = null;
      let weatherNote: string | null = null;
      if (!places.forecasts) weatherNote = null;
      else if (!dates) weatherNote = "Add the dates to see the weather.";
      else if (Date.parse(`${dates.to}T00:00:00Z`) < Date.parse(`${today}T00:00:00Z`)) weatherNote = null;
      else if (city === null) weatherNote = `Couldn't find ${trip.place} on the map for the weather.`;
      else if (city) {
        const firstDay = Date.parse(`${dates.from}T00:00:00Z`);
        if (firstDay - Date.parse(`${today}T00:00:00Z`) > FORECAST_DAYS * DAY) {
          weatherNote = tripWeather({ fetchedAt: 0, expiresAt: 0, steps: [] }, dates, tz, []).note;
        } else {
          const f = look.forecast(city);
          if (f) ({ weather, note: weatherNote } = tripWeather(f, dates, tz, trip.packing.map((p) => p.text)));
        }
      }

      // the main places, and the stays against the first
      const spotPoints = trip.spots.map((t) => find(spotParts(t).find));
      const main = spotPoints[0] ?? null;
      const stays = compareStays(trip.stays, {
        nights: dates?.nights || null,
        minutes: (s) => {
          if (!main) return null;
          const at = find(s.area ? `${s.name}, ${s.area}` : s.name);
          const p = at === null && s.area ? find(s.area) : at;
          if (!p) return null;
          const leg = look.travel(p, main);
          return leg ? { minutes: leg.minutes, mode: leg.mode } : null;
        },
      });
      return {
        where: city ? city.label : null, weather, weatherNote,
        spots: trip.spots.map((text, i) => ({ text, found: spotPoints[i] === undefined ? null : !!spotPoints[i] })),
        stays,
      };
    };

    const { value, pending } = await lookNow({ places, later: this.o.later, userId, key: `trip:${trip.id}`, topics: [botTopic("travel")], waitMs: this.o.waitMs ?? 1200, compute });
    const mainName = trip.spots[0] ? spotParts(trip.spots[0]).name : null;
    return {
      dates, where: value.where, weather: value.weather, weatherNote: value.weatherNote, spots: value.spots,
      main: mainName && mainName.length <= 26 ? mainName : trip.spots[0] ? "the main place" : null,
      stays: value.stays, finding: this.finding.has(trip.id), searched: this.lastFind.get(trip.id) ?? null, canFind: !!this.o.source, canMeasure: measure, pending,
      credits: places.credits({ map: measure && trip.spots.length > 0, weather: !!value.weather }),
    };
  }

  /** Looks for stays on the web, in the background; true when a search started (false: one is already running). */
  find(userId: string, trip: Trip): boolean {
    if (!this.o.source || this.finding.has(trip.id)) return false;
    const source = this.o.source;
    this.finding.add(trip.id);
    const area = trip.spots[0] ? spotParts(trip.spots[0]).find : "";
    void this.o.later.run(userId, `stays:${trip.id}`, [botTopic("travel")], async () => {
      try {
        const found = await source.find({ place: trip.place, ...(area && area !== trip.place ? { area } : {}) }, { userId });
        this.lastFind.delete(trip.id);
        this.lastFind.set(trip.id, found.length ? "found" : "none");
        if (this.lastFind.size > 5_000) this.lastFind.delete(this.lastFind.keys().next().value!);
        if (found.length) await this.o.trips.addStays(userId, trip.id, found);
      } catch (e) {
        this.lastFind.set(trip.id, e instanceof StaysLimit ? "limit" : "failed");
      } finally {
        this.finding.delete(trip.id);
      }
      return true;
    });
    return true;
  }
}

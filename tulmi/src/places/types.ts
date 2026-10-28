/**
 * THE WORDS THE PLACES LAYER IS MADE OF: a point, a place found for some words, a leg between two points, a forecast.
 *
 * The providers (geocoders.ts, routers.ts, metno.ts) answer in these shapes and nothing else, so one can be swapped for another (a public
 * server today, our own later) without the Plan or Travel bot noticing. Nothing here names a person.
 */

export interface LatLon { lat: number; lon: number }

/** Somewhere words were found to mean. `label` is short ("Indiranagar, Bengaluru"); `country` is ISO 3166-1 alpha-2, lower case. */
export interface Place extends LatLon { label: string; country?: string }

/** How a leg is travelled. Transit is not offered: none of the providers here route buses or trains. */
export type Mode = "walk" | "drive";

/** One leg: how long (whole minutes, at least 1) and how far. A drive's minutes already carry the buffer (see places/index.ts). */
export interface Leg { mode: Mode; minutes: number; km: number }

export interface GeocodeHints {
  /** Prefer what is near here (the day's other stops, home, the trip's city). */
  near?: LatLon;
  /** ISO 3166-1 alpha-2, lower case: prefer places in this country. */
  country?: string;
}

/** Words to places, best first. Empty when nothing was found; throws only for a provider that failed (the caller decides how long to wait). */
export interface Geocoder {
  readonly id: string;
  geocode(q: string, hints?: GeocodeHints): Promise<Place[]>;
}

/** The time and distance between two points. Null when there is no route (a sea between them, a point off every road). */
export interface Routing {
  readonly id: string;
  /** The modes this server can answer. */
  readonly modes: readonly Mode[];
  leg(from: LatLon, to: LatLon, mode: Mode): Promise<Leg | null>;
}

/** One step of a forecast: from `t` (UTC ms) for `hours` hours (1 near now, 6 further out). */
export interface ForecastStep {
  t: number;
  hours: number;
  /** Air temperature at `t`, °C. */
  tempC: number;
  /** Rain in the step, mm (0 when the provider says none). */
  rainMm: number;
  /** The provider's symbol for the step ("clearsky_day", "lightrainshowers_night", "heavyrainandthunder"). */
  symbol: string;
}

export interface Forecast {
  /** When it was fetched, and when the provider says to ask again (its Expires header). UTC ms. */
  fetchedAt: number;
  expiresAt: number;
  steps: ForecastStep[];
}

export interface WeatherSource {
  readonly id: string;
  forecast(at: LatLon): Promise<Forecast | null>;
  /** A forecast already held and still fresh, without asking anyone. */
  peek?(at: LatLon): Forecast | undefined;
}

/** What a screen must show for the data it drew, as the providers' terms ask. */
export interface Credit { text: string; url: string }

/** A provider that stands aside (a queue too long, a cool-down after the server said slow down). Not an answer: nothing is cached. */
export class PlacesBusy extends Error {
  constructor(readonly provider: string) {
    super(`${provider}: busy`);
    this.name = "PlacesBusy";
  }
}

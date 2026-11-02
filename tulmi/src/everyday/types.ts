/**
 * WHAT THE EVERYDAY TOOLS FIND, as cards the apps draw under an answer (screens: experience/bots/screens/finds.ts). Plain data: names,
 * numbers, words and https links. Nothing here is booked or paid: every card links out, and the person books on that site.
 */

export interface FlightLeg {
  from: string;
  to: string;
  fromCity: string;
  toCity: string;
  /** Local times, "2026-11-21T09:55:00". */
  depart: string;
  arrive: string;
  minutes: number;
  stops: number;
  /** Airport codes, the stops between ("BLR", "BOM", "GOI"). */
  route: string[];
  airlines: string[];
}

export interface Flight {
  price: number;
  priceText: string;
  cabin: string;
  out: FlightLeg;
  back?: FlightLeg;
  /** Bags included for everyone together. */
  bags: { cabin: number; checked: number };
  url: string;
}

export interface FlightsCard {
  kind: "flights";
  query: string;
  currency: string;
  results: Flight[];
  source: { name: "Kiwi.com"; url: "https://www.kiwi.com" };
}

export interface Stay {
  name: string;
  stars: number;
  /** Guest rating out of 10, and how many reviews. */
  rating: number;
  reviews: string;
  area: string;
  amenities: string[];
  image: string;
  perNight: string;
  perStay: string;
  advertiser: string;
  perks: string[];
  url: string;
}

export interface StaysCard {
  kind: "stays";
  query: string;
  checkIn: string;
  checkOut: string;
  results: Stay[];
  source: { name: "trivago"; url: "https://www.trivago.com" };
}

export interface MoneyCard {
  kind: "money";
  amount: number;
  from: string;
  to: string;
  rate: number;
  result: number;
  /** The day the rate is from (central banks publish once a working day). */
  day: string;
  source: { name: "Frankfurter (central bank rates)"; url: "https://frankfurter.dev" };
}

export interface WeatherDay { day: string; minC: number; maxC: number; rainMm: number; symbol: string }

export interface WeatherCard {
  kind: "weather";
  place: string;
  now: { tempC: number; symbol: string } | null;
  days: WeatherDay[];
  source: { name: "MET Norway"; url: "https://www.met.no/en" };
}

export type Card = FlightsCard | StaysCard | MoneyCard | WeatherCard;

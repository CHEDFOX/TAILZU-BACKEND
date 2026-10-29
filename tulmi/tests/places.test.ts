/**
 * src/places: the providers behind the Plan bot's travel times and the Travel bot's weather, against recorded answers
 * (tests/fixtures: MET Norway for Pune and FOSSGIS' OSRM in Bengaluru, recorded 28 Oct 2026) and documented shapes. No network.
 *
 *   - Photon and Nominatim: places parsed, the country hint ranks, the bias point is sent
 *   - OSRM ("{mode}" profiles, no route) and openrouteservice (its key in a header, never the address)
 *   - MET Norway: steps parsed, Expires respected, If-Modified-Since and a 304, points cut to 2 decimals
 *   - the polite line: our User-Agent, a gap between requests, a rest after a 429, a queue that won't grow forever
 *   - Places: the city list before any geocoder, caches (and a failure not asked again at once), walking when it is close, the drive buffer
 *   - the settings: geocoder and router off unless set, the weather on, Nominatim only with its own address
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { noNetwork } from "./no-network.js";

const { cityNamed, distanceKm, Places, placesFrom, PlacesBusy } = await import("../src/places/index.js");
const { parseNominatim, parsePhoton, photonGeocoder, nominatimGeocoder } = await import("../src/places/geocoders.js");
const { osrmRouting, orsRouting, parseOsrm } = await import("../src/places/routers.js");
const { MetNoWeather, parseMetno } = await import("../src/places/metno.js");
const { Polite, userAgentFor } = await import("../src/places/polite.js");

noNetwork();

const fixture = (name: string) => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name), "utf8"));

interface Sent { url: string; headers: Record<string, string>; method: string; body?: string }
/** A fetch that answers from a list, in order, and writes down what was asked. */
function fakeFetch(answers: Array<{ status?: number; body?: unknown; headers?: Record<string, string> } | ((url: string) => { status?: number; body?: unknown; headers?: Record<string, string> })>) {
  const sent: Sent[] = [];
  let i = 0;
  const fetchFn = async (url: string, init?: RequestInit) => {
    sent.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    const a0 = answers[Math.min(i, answers.length - 1)]!;
    i += 1;
    const a = typeof a0 === "function" ? a0(url) : a0;
    const status = a.status ?? 200;
    return new Response(status === 304 ? null : JSON.stringify(a.body ?? {}), { status, headers: { "content-type": "application/json", ...(a.headers ?? {}) } });
  };
  return { fetchFn, sent };
}

/** A clock and a sleep that moves it. */
function clock(start = Date.UTC(2026, 9, 28, 20, 45)) {
  const t = { now: start };
  return { t, now: () => t.now, sleep: async (ms: number) => { t.now += ms; } };
}

const line = (fetchFn: ReturnType<typeof fakeFetch>["fetchFn"], c = clock(), minGapMs = 0) => new Polite({ name: "test", minGapMs, userAgent: userAgentFor("support@x0bot.com"), fetchFn, now: c.now, sleep: c.sleep });

const PHOTON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [77.6408, 12.9784] }, properties: { name: "Indiranagar", city: "Bengaluru", state: "Karnataka", country: "India", countrycode: "IN", type: "district" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-80.1, 26.2] }, properties: { name: "Indiranagar", city: "Somewhere", countrycode: "US" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [300, 12] }, properties: { name: "Broken" } },
  ],
};

describe("geocoders", () => {
  it("read Photon's GeoJSON and Nominatim's list, best first, in the hinted country first", async () => {
    expect(parsePhoton(PHOTON)).toEqual([
      { lat: 12.9784, lon: 77.6408, label: "Indiranagar, Bengaluru", country: "in" },
      { lat: 26.2, lon: -80.1, label: "Indiranagar, Somewhere", country: "us" },
    ]);
    expect(parsePhoton({ nope: 1 })).toEqual([]);
    expect(parseNominatim([{ lat: "18.5362", lon: "73.8940", name: "Koregaon Park", display_name: "Koregaon Park, Pune, Maharashtra, India", address: { suburb: "Koregaon Park", city: "Pune", country_code: "in" } }]))
      .toEqual([{ lat: 18.5362, lon: 73.894, label: "Koregaon Park, Pune", country: "in" }]);

    const swapped = { ...PHOTON, features: [PHOTON.features[1], PHOTON.features[0]] };
    const f = fakeFetch([{ body: swapped }]);
    const g = photonGeocoder({ baseUrl: "https://photon.example/", line: line(f.fetchFn) });
    const found = await g.geocode("Indiranagar", { country: "in", near: { lat: 12.97, lon: 77.59 } });
    expect(found[0]!.country).toBe("in");
    const u = new URL(f.sent[0]!.url);
    expect(u.origin + u.pathname).toBe("https://photon.example/api/");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "Indiranagar", limit: "5", lang: "en", lat: "12.970", lon: "77.590" });
    expect(f.sent[0]!.headers["user-agent"]).toBe("Tailzu/1.0 (+support@x0bot.com)");
  });

  it("asks Nominatim with its country code and a view box, and says why when it fails", async () => {
    const f = fakeFetch([{ body: [] }, { status: 500 }]);
    const g = nominatimGeocoder({ baseUrl: "https://nominatim.example", line: line(f.fetchFn) });
    expect(await g.geocode("Koregaon Park, Pune", { country: "in", near: { lat: 18.52, lon: 73.86 } })).toEqual([]);
    const q = new URL(f.sent[0]!.url).searchParams;
    expect([q.get("format"), q.get("countrycodes"), q.get("viewbox")]).toEqual(["jsonv2", "in", "73.360,19.020,74.360,18.020"]);
    await expect(g.geocode("x")).rejects.toThrow("nominatim: 500");
  });
});

describe("routers", () => {
  it("OSRM: a recorded drive and walk in Bengaluru, a profile per mode, no route as null", async () => {
    expect(parseOsrm("drive", fixture("osrm-car-blr.json"))).toEqual({ mode: "drive", minutes: 10, km: 8.4 });
    const f = fakeFetch([{ body: fixture("osrm-car-blr.json") }, { body: fixture("osrm-foot-blr.json") }, { status: 400, body: { code: "NoRoute" } }]);
    const r = osrmRouting({ baseUrl: "https://routing.openstreetmap.de/routed-{mode}", line: line(f.fetchFn) });
    expect(r.modes).toEqual(["drive", "walk"]);
    const a = { lat: 12.9784, lon: 77.6408 }, b = { lat: 12.9352, lon: 77.6245 };
    expect(await r.leg(a, b, "drive")).toEqual({ mode: "drive", minutes: 10, km: 8.4 });
    expect(await r.leg(a, b, "walk")).toEqual({ mode: "walk", minutes: 13, km: 1 });
    expect(await r.leg(a, b, "drive")).toBeNull();
    expect(f.sent.map((s) => s.url)).toEqual([
      "https://routing.openstreetmap.de/routed-car/route/v1/driving/77.64080,12.97840;77.62450,12.93520?overview=false&alternatives=false&steps=false",
      "https://routing.openstreetmap.de/routed-foot/route/v1/driving/77.64080,12.97840;77.62450,12.93520?overview=false&alternatives=false&steps=false",
      "https://routing.openstreetmap.de/routed-car/route/v1/driving/77.64080,12.97840;77.62450,12.93520?overview=false&alternatives=false&steps=false",
    ]);
    const own = osrmRouting({ baseUrl: "http://osrm:5000", line: line(fakeFetch([]).fetchFn) });
    expect(own.modes).toEqual(["drive"]);
    expect(await own.leg(a, b, "walk")).toBeNull();
  });

  it("openrouteservice: the key goes in a header, the points in the body", async () => {
    const f = fakeFetch([{ body: { routes: [{ summary: { duration: 1830, distance: 9400 } }] } }, { status: 404, body: { error: { code: 2010, message: "Could not find routable point" } } }]);
    const r = orsRouting({ baseUrl: "https://api.openrouteservice.org", key: "k-123", line: line(f.fetchFn) });
    expect(await r.leg({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, "walk")).toEqual({ mode: "walk", minutes: 31, km: 9.4 });
    expect(f.sent[0]).toMatchObject({ url: "https://api.openrouteservice.org/v2/directions/foot-walking", method: "POST", headers: { authorization: "k-123" } });
    expect(JSON.parse(f.sent[0]!.body!)).toMatchObject({ coordinates: [[2, 1], [4, 3]] });
    expect(f.sent[0]!.url).not.toContain("k-123");
    expect(await r.leg({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, "drive")).toBeNull();
  });
});

describe("MET Norway", () => {
  const PUNE = { lat: 18.520456, lon: 73.856712 };

  it("reads the recorded Pune forecast: hourly, then six-hourly, rain where it rains", () => {
    const f = parseMetno(fixture("metno-pune.json"), 0, 1)!;
    expect(f.steps[0]).toEqual({ t: Date.parse("2026-10-28T20:00:00Z"), hours: 1, tempC: 23.9, rainMm: 0, symbol: "fair_night" });
    expect(f.steps.some((s) => s.hours === 6)).toBe(true);
    expect(f.steps.find((s) => s.t === Date.parse("2026-10-31T08:00:00Z"))).toMatchObject({ symbol: "lightrainshowers_day", rainMm: 0.2 });
    expect(f.steps.length).toBeGreaterThan(60);
  });

  it("waits for Expires, then asks with If-Modified-Since and keeps what it had on a 304; points cut to 2 decimals", async () => {
    const c = clock(Date.parse("2026-10-28T20:45:01Z"));
    const f = fakeFetch([
      { body: fixture("metno-pune.json"), headers: { expires: "Wed, 28 Oct 2026 21:16:50 GMT", "last-modified": "Wed, 28 Oct 2026 20:45:01 GMT" } },
      { status: 304, headers: { expires: "Wed, 28 Oct 2026 21:50:00 GMT" } },
    ]);
    const w = new MetNoWeather({ baseUrl: "https://api.met.no/weatherapi/locationforecast/2.0", line: line(f.fetchFn, c), now: c.now });
    expect(w.peek(PUNE)).toBeUndefined();
    const first = await w.forecast(PUNE);
    expect(f.sent[0]!.url).toBe("https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=18.52&lon=73.86");
    expect(f.sent[0]!.headers["user-agent"]).toMatch(/^Tailzu\/1\.0 \(\+/);
    expect(first!.expiresAt).toBe(Date.parse("2026-10-28T21:16:50Z"));
    c.t.now += 20 * 60_000;
    expect(await w.forecast(PUNE)).toBe(first);
    expect(f.sent).toHaveLength(1);
    c.t.now += 15 * 60_000;
    const again = await w.forecast(PUNE);
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1]!.headers["if-modified-since"]).toBe("Wed, 28 Oct 2026 20:45:01 GMT");
    expect(again!.steps).toEqual(first!.steps);
    expect(again!.expiresAt).toBe(Date.parse("2026-10-28T21:50:00Z"));
  });

  it("says once when the version is being retired (203)", async () => {
    const warned: string[] = [];
    const f = fakeFetch([{ status: 203, body: fixture("metno-pune.json") }]);
    const c = clock();
    const w = new MetNoWeather({ baseUrl: "https://met.example", line: line(f.fetchFn, c), now: c.now, warn: (m) => warned.push(m) });
    expect(await w.forecast({ lat: 1, lon: 1 })).not.toBeNull();
    c.t.now += 7 * 3_600_000;
    await w.forecast({ lat: 1, lon: 1 });
    expect(warned).toHaveLength(1);
  });
});

describe("the polite line", () => {
  it("spaces requests, rests after a 429, and refuses a queue that has grown too long", async () => {
    const c = clock();
    const at: number[] = [];
    const f = fakeFetch([(u) => { at.push(c.now()); return u.endsWith("slow") ? { status: 429 } : { body: {} }; }]);
    const p = new Polite({ name: "p", minGapMs: 1100, userAgent: "Tailzu/1.0 (+x)", fetchFn: f.fetchFn, now: c.now, sleep: c.sleep, queueMax: 3 });
    await Promise.all([p.get("https://a/1"), p.get("https://a/2"), p.get("https://a/3")]);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(1100);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(1100);
    const many = [1, 2, 3, 4].map((i) => p.get(`https://a/q${i}`).then(() => "ok", (e) => (e instanceof PlacesBusy ? "busy" : "err")));
    expect(await Promise.all(many)).toEqual(["ok", "ok", "ok", "busy"]);
    await expect(p.get("https://a/slow")).rejects.toBeInstanceOf(PlacesBusy);
    expect(p.resting).toBe(true);
    const before = f.sent.length;
    await expect(p.get("https://a/4")).rejects.toBeInstanceOf(PlacesBusy);
    expect(f.sent.length).toBe(before);
    c.t.now += 11 * 60_000;
    await expect(p.get("https://a/5")).resolves.toBeTruthy();
  });
});

describe("Places", () => {
  const geo = (table: Record<string, { lat: number; lon: number }>) => {
    const asked: string[] = [];
    return { asked, g: { id: "fake", async geocode(q: string) { asked.push(q); if (q === "boom") throw new Error("down"); const p = table[q]; return p ? [{ ...p, label: q, country: "in" }] : []; } } };
  };

  it("knows a city without a geocoder, caches what it found, and doesn't ask again at once after a failure", async () => {
    const c = clock();
    const { g, asked } = geo({ indiranagar: { lat: 12.9784, lon: 77.6408 } });
    const p = new Places({ geocoder: g, now: c.now });
    expect(p.peekPlace("Trip to Pune")).toMatchObject({ label: "Pune", lat: 18.52 });
    expect(asked).toEqual([]);
    expect(p.peekPlace("Indiranagar")).toBeUndefined();
    expect(await p.place("Indiranagar")).toMatchObject({ lat: 12.9784 });
    expect(await p.place("Indiranagar")).toMatchObject({ lat: 12.9784 });
    expect(await p.place("Nowhere at all")).toBeNull();
    expect(p.peekPlace("Nowhere at all")).toBeNull();
    expect(await p.place("boom")).toBeNull();
    expect(await p.place("boom")).toBeNull();
    expect(asked).toEqual(["indiranagar", "nowhere at all", "boom"]);
    c.t.now += 16 * 60_000;
    expect(p.peekPlace("boom")).toBeUndefined();
    expect(new Places().peekPlace("Koregaon Park, Pune")).toBeNull();
  });

  it("walks when it is close and short, drives (with the buffer) otherwise", async () => {
    const legs: string[] = [];
    const routing = {
      id: "fake", modes: ["drive", "walk"] as const,
      async leg(a: { lat: number }, _b: unknown, mode: "walk" | "drive") { legs.push(`${mode}:${a.lat}`); return mode === "walk" ? { mode, minutes: 12, km: 0.9 } : { mode, minutes: 10, km: 8.4 }; },
    };
    const p = new Places({ routing, driveBuffer: 1.3 });
    const a = { lat: 12.9784, lon: 77.6408 }, near = { lat: 12.9719, lon: 77.6385 }, far = { lat: 12.9352, lon: 77.6245 };
    expect(distanceKm(a, near)).toBeLessThan(1.6);
    expect(p.peekTravel(a, near)).toBeUndefined();
    expect(await p.travel(a, near)).toEqual({ mode: "walk", minutes: 12, km: 0.9 });
    expect(await p.travel(a, far)).toEqual({ mode: "drive", minutes: 13, km: 8.4 });
    expect(p.peekTravel(a, far)).toEqual({ mode: "drive", minutes: 13, km: 8.4 });
    await p.travel(a, far);
    expect(legs).toEqual(["walk:12.9784", "drive:12.9784"]);
  });

  it("credits the providers that are on", () => {
    expect(placesFrom({ PLACES_GEOCODER: "photon", PLACES_ROUTER: "osrm" }).credits().map((c) => c.text))
      .toEqual(["Map data © OpenStreetMap contributors", "Routes: OSRM", "Fix the map", "Weather: MET Norway"]);
    expect(placesFrom({ WEATHER: "off" }).credits()).toEqual([]);
  });
});

describe("the settings", () => {
  it("leave the geocoder and router off unless set, the weather on, and Nominatim without an address off", () => {
    const none = placesFrom({});
    expect([none.locates, none.routes, none.forecasts]).toEqual([false, false, true]);
    expect(placesFrom({ PLACES_GEOCODER: "nominatim" }).locates).toBe(false);
    expect(placesFrom({ PLACES_GEOCODER: "nominatim", PLACES_GEOCODE_URL: "https://nominatim.example" }).geocoder?.id).toBe("nominatim");
    expect(placesFrom({ PLACES_GEOCODER: "photon" }).geocoder?.id).toBe("photon");
    expect(placesFrom({ PLACES_ROUTER: "ors" }).routes).toBe(false);
    expect(placesFrom({ PLACES_ROUTER: "ors", PLACES_ROUTE_KEY: "k" }).routing?.id).toBe("ors");
    expect(placesFrom({ PLACES_ROUTER: "osrm", PLACES_ROUTE_URL: "https://osrm.example" }).routing?.modes).toEqual(["drive"]);
    expect(placesFrom({ WEATHER: "off" }).forecasts).toBe(false);
  });

  it("finds a city by the names people use, and nothing that is only part of one", () => {
    expect(cityNamed("Bangalore")?.label).toBe("Bengaluru");
    expect(cityNamed("trip to Goa.")?.label).toBe("Goa");
    expect(cityNamed("Pondy")?.label).toBe("Puducherry");
    expect(cityNamed("Koregaon Park, Pune")).toBeNull();
    expect(cityNamed("Dubai")?.country).toBe("ae");
  });
});

describe("the public servers' floor", () => {
  it("spaces requests to a public server at least a second apart, whatever the setting; ours as set", async () => {
    const c = clock();
    const at: number[] = [];
    const f = fakeFetch([() => { at.push(c.now()); return { body: { code: "Ok", routes: [{ duration: 600, distance: 5000 }] } }; }]);
    const pub = placesFrom({ PLACES_ROUTER: "osrm", PLACES_RATE_MS: 0 }, { fetchFn: f.fetchFn, now: c.now, sleep: c.sleep });
    await pub.travel({ lat: 1, lon: 1 }, { lat: 1.1, lon: 1.1 });
    await pub.travel({ lat: 2, lon: 2 }, { lat: 2.1, lon: 2.1 });
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(1100);
    at.length = 0;
    const own = placesFrom({ PLACES_ROUTER: "osrm", PLACES_ROUTE_URL: "http://osrm:5000", PLACES_RATE_MS: 0 }, { fetchFn: f.fetchFn, now: c.now, sleep: c.sleep });
    await own.travel({ lat: 1, lon: 1 }, { lat: 1.1, lon: 1.1 });
    await own.travel({ lat: 2, lon: 2 }, { lat: 2.1, lon: 2.1 });
    expect(at[1]! - at[0]!).toBe(0);
  });
});

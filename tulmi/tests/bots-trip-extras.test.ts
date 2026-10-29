/**
 * The Travel bot's trip, with outside data (src/botsBots/tripExtras.ts, stays.ts, tripDates.ts, trips.ts; routes/botsTrips.ts;
 * screens/botsPlaces.ts). Fakes and recorded answers only: no network.
 *
 *   - dates from how people write them; the weather on those days from MET Norway's recorded Pune forecast
 *   - stays compared (Travel bot's pick, cheaper, closer, better rated; the person's pick wins), totals for the nights
 *   - stays from the web: only pages that are one property, with the price and rating the result itself says; a day's cap
 *   - a trip's main places and stays kept, picked, removed; every change tells the screen
 *   - the routes, end to end, with the search in the background
 *   - bots.travel and bots.plan on both clients: lint-clean, the boards' words, actions wired to these routes
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { Node } from "../../shared/types/sdui.js";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id, email: `${id}@example.in` } : null; } };
});

const { tripDates } = await import("../src/botsBots/tripDates.js");
const { tripWeather, TripExtrasReader, spotParts } = await import("../src/botsBots/tripExtras.js");
const { compareStays, webStaySource, paiseOf, ratingOf, linkOf, stayFromLabel, nameFromTitle, resetStayFindsForTests, StaysLimit } = await import("../src/botsBots/stays.js");
const { Trips } = await import("../src/botsBots/trips.js");
const { Later } = await import("../src/botsBots/later.js");
const { MemoryTable, resetAreaTablesForTests, botsAreaParts } = await import("../src/botsBots/index.js");
const { Places } = await import("../src/places/index.js");
const { parseMetno } = await import("../src/places/metno.js");
const { registerBotsBotsRoutes } = await import("../src/routes/botsBots.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { sampleApi, fakeReader } = await import("./bots-bots-data.js");

noNetwork();

const FORECAST = parseMetno(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "metno-pune.json"), "utf8")), 0, Date.parse("2026-10-28T21:16:50Z"))!;
const NOW = Date.parse("2026-10-28T20:45:00Z");
const A = "/v1/botsapp/bots";

beforeEach(() => { resetAreaTablesForTests(); resetStayFindsForTests(); });

describe("a trip's dates", () => {
  it("reads the ways people write them, with the year that comes next", () => {
    const t = "2026-10-28";
    expect(tripDates("14–16 Nov", t)).toEqual({ from: "2026-11-14", to: "2026-11-16", nights: 2 });
    expect(tripDates("Nov 14-16", t)).toEqual({ from: "2026-11-14", to: "2026-11-16", nights: 2 });
    expect(tripDates("Sat 14 Nov", t)).toEqual({ from: "2026-11-14", to: "2026-11-14", nights: 0 });
    expect(tripDates("30 Dec – 2 Jan", t)).toEqual({ from: "2026-12-30", to: "2027-01-02", nights: 3 });
    expect(tripDates("14/11 - 16/11", t)).toEqual({ from: "2026-11-14", to: "2026-11-16", nights: 2 });
    expect(tripDates("14th to 16th November", t)).toEqual({ from: "2026-11-14", to: "2026-11-16", nights: 2 });
    expect(tripDates("3 Jan", t)).toEqual({ from: "2027-01-03", to: "2027-01-03", nights: 0 });
    expect(tripDates("this weekend", t)).toEqual({ from: "2026-10-31", to: "2026-11-01", nights: 1 });
    expect(tripDates("next weekend", t)).toEqual({ from: "2026-11-07", to: "2026-11-08", nights: 1 });
    expect(tripDates("tomorrow", t)).toEqual({ from: "2026-10-29", to: "2026-10-29", nights: 0 });
    for (const bad of ["", "soon", "Diwali", "31 Feb", "1 Nov - 30 Dec"]) expect(tripDates(bad, t), bad).toBeNull();
  });
});

describe("the weather on a trip", () => {
  it("summarises the recorded Pune forecast for the trip's days, and says what to pack for it", () => {
    const { weather, note } = tripWeather(FORECAST, tripDates("29–31 Oct", "2026-10-28")!, IST, ["Phone charger"]);
    expect(note).toBeNull();
    expect(weather).toMatchObject({ line: "Rain on Fri, Sat", sub: "Thu 32° · Fri 30° · Sat 30° · lows 20°", pack: "Umbrella, rain on Fri", more: null });
    expect(weather!.days.map((d) => [d.key, d.sky])).toEqual([["2026-10-29", "clear"], ["2026-10-30", "rain"], ["2026-10-31", "rain"]]);
    expect(tripWeather(FORECAST, tripDates("29–31 Oct", "2026-10-28")!, IST, ["Small umbrella"]).weather!.pack).toBeNull();
    expect(tripWeather(FORECAST, tripDates("5-8 Nov", "2026-10-28")!, IST, []).weather).toMatchObject({ line: "Clear days", more: "The rest comes into the forecast nearer the day." });
    expect(tripWeather(FORECAST, tripDates("14–16 Nov", "2026-10-28")!, IST, [])).toEqual({ weather: null, note: "The forecast for these days opens around 5 Nov." });
  });
});

const row = (id: string, o: Partial<import("../src/botsBots/stays.js").StayRow> = {}) => ({
  id, name: id, area: "", url: "", host: "", nightPaise: null, rating: null, ratingOf: null, reviews: null, by: "you" as const, picked: false, at: 0, ...o,
});

describe("stays side by side", () => {
  it("picks the best balance of rating and distance (never price), then the closer and the better rated, against the pick; the person's pick wins", () => {
    const stays = [
      row("shanti", { nightPaise: 320000, rating: 4.4, ratingOf: 5 }), row("deccan", { nightPaise: 260000, rating: 4.1, ratingOf: 5 }),
      row("hostel", { nightPaise: 90000, rating: 6.2, ratingOf: 10 }),
    ];
    const minutes: Record<string, number> = { shanti: 12, deccan: 28, hostel: 40 };
    const c = compareStays(stays, { nights: 2, minutes: (s) => ({ minutes: minutes[s.id]!, mode: "drive" }) });
    expect(c.map((s) => [s.id, s.label, s.totalPaise, s.stars])).toEqual([["shanti", "Travel bot's pick", 640000, 4.4], ["deccan", "", 520000, 4.1], ["hostel", "", 180000, 3.1]]);
    // The cheapest is not the pick for being cheap: a cheaper, closer, better rated one wins on the last two alone.
    expect(compareStays([row("a", { nightPaise: 900000, rating: 4.8, ratingOf: 5 }), row("b", { nightPaise: 100000, rating: 3, ratingOf: 5 })], { nights: 1, minutes: () => null })
      .map((s) => s.label)).toEqual(["Travel bot's pick", ""]);
    const mine = compareStays(stays.map((s) => (s.id === "deccan" ? { ...s, picked: true } : s)), { nights: null, minutes: (s) => ({ minutes: minutes[s.id]!, mode: "drive" }) });
    expect(mine.map((s) => [s.id, s.label, s.totalPaise])).toEqual([["shanti", "Closer", null], ["deccan", "Your pick", null], ["hostel", "", null]]);
    expect(compareStays([row("only", { nightPaise: 100000 })], { nights: 2, minutes: () => null })[0]!.label).toBe("");
    expect(compareStays([row("a"), row("b")], { nights: 2, minutes: () => null }).map((s) => s.label)).toEqual(["", ""]);
  });

  it("reads prices, ratings, links and a chat's label the way people write them", () => {
    expect([paiseOf("₹3,200"), paiseOf("Rs. 2600"), paiseOf("3200"), paiseOf("₹12"), paiseOf("free")]).toEqual([320000, 260000, 320000, null, null]);
    expect([ratingOf("4.4"), ratingOf("8.6/10"), ratingOf("4.1 out of 5"), ratingOf("11")]).toEqual([{ rating: 4.4, of: 5 }, { rating: 8.6, of: 10 }, { rating: 4.1, of: 5 }, null]);
    expect(linkOf("booking.com/hotel/in/shanti.html")).toEqual({ url: "https://booking.com/hotel/in/shanti.html", host: "booking.com" });
    expect(linkOf("http://www.agoda.com/x")?.url).toBe("https://www.agoda.com/x");
    expect([linkOf("javascript:alert(1)"), linkOf("https://u:p@x.com"), linkOf("nothing")]).toEqual([null, null, null]);
    expect(stayFromLabel("Shanti Residency · Koregaon Park · ₹3,200 a night")).toEqual({ name: "Shanti Residency", area: "Koregaon Park", nightPaise: 320000 });
    expect(nameFromTitle("Shanti Residency, Pune (updated prices 2026) - Booking.com", "Pune")).toBe("Shanti Residency");
    expect(nameFromTitle("DECCAN COURTYARD - Updated 2026 Prices & Hotel Reviews (Pune) - Tripadvisor", "Pune")).toBe("DECCAN COURTYARD");
    expect(spotParts("Sakshi and Arjun's wedding, Koregaon Park")).toEqual({ find: "Koregaon Park", name: "Sakshi and Arjun's wedding" });
  });

  it("finds stays on the web: one property a page, its own price and rating, at most so many searches a day", async () => {
    const asked: Array<{ q: string; queries: string[] }> = [];
    const results = [
      { title: "Shanti Residency, Pune (updated prices 2026) - Booking.com", url: "https://www.booking.com/hotel/in/shanti-residency-pune.html", snippet: "Koregaon Park. Rated 8.6/10 by 1,820 reviews. Prices from ₹3,200 a night." },
      { title: "Hotels in Koregaon Park, Pune - Booking.com", url: "https://www.booking.com/searchresults.html?ss=Koregaon+Park", snippet: "Find 120 hotels" },
      { title: "10 best hotels in Pune (2026)", url: "https://travelblog.example/best-pune", snippet: "Our picks" },
      { title: "DECCAN COURTYARD - Updated 2026 Prices & Hotel Reviews (Pune) - Tripadvisor", url: "https://www.tripadvisor.in/Hotel_Review-g297654-d123-Reviews-Deccan_Courtyard-Pune.html", snippet: "4.1 out of 5, 960 reviews" },
      { title: "Shanti Residency Pune", url: "https://www.agoda.com/shanti-residency/hotel/pune-in.html", snippet: "same place again" },
    ].map((r) => ({ ...r, source: "ddg" as const, score: 1, reasons: [] }));
    const source = webStaySource({ daily: 2, searchFn: async (q, o) => { asked.push({ q, queries: o.plan!.queries }); return { plan: o.plan!, results, via: ["ddg"], cached: false }; } });
    const found = await source.find({ place: "Pune", area: "Koregaon Park" }, { userId: "u" });
    expect(asked[0]).toEqual({ q: "hotels in Koregaon Park Pune", queries: ["hotels in Koregaon Park Pune", "Koregaon Park Pune hotel booking reviews"] });
    expect(found).toEqual([
      { name: "Shanti Residency", area: "Koregaon Park", url: "https://www.booking.com/hotel/in/shanti-residency-pune.html", nightPaise: 320000, rating: 8.6, ratingOf: 10, reviews: 1820 },
      { name: "DECCAN COURTYARD", area: "Koregaon Park", url: "https://www.tripadvisor.in/Hotel_Review-g297654-d123-Reviews-Deccan_Courtyard-Pune.html", nightPaise: null, rating: 4.1, ratingOf: 5, reviews: 960 },
    ]);
    await source.find({ place: "Pune" }, { userId: "u" });
    await expect(source.find({ place: "Pune" }, { userId: "u" })).rejects.toBeInstanceOf(StaysLimit);
    await expect(source.find({ place: "Pune" }, { userId: "someone else" })).resolves.toHaveLength(2);
  });
});

describe("a trip's places and stays", () => {
  it("keeps them, one pick at a time", async () => {
    const trips = new Trips(() => NOW, new MemoryTable());
    const t = await trips.create("u", { place: "Pune", when: "14–16 Nov" });
    expect(t).toMatchObject({ spots: [], stays: [] });
    await trips.addSpot("u", t.id, "Sakshi and Arjun's wedding, Koregaon Park");
    await trips.addSpot("u", t.id, "sakshi and arjun's wedding, koregaon park");
    await expect(trips.addSpot("u", t.id, "  ")).rejects.toMatchObject({ code: "bad_request" });
    let trip = await trips.addStay("u", t.id, { name: "Shanti Residency", url: "booking.com/hotel/in/shanti.html", price: "₹3,200", area: "Koregaon Park", rating: "4.4" });
    trip = await trips.addStay("u", t.id, { label: "Deccan Courtyard · FC Road · ₹2,600 a night", url: "https://www.makemytrip.com/hotels/x", from: "chat" }, "chat");
    await expect(trips.addStay("u", t.id, { url: "javascript:alert(1)" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(trips.addStay("u", t.id, { name: "" })).rejects.toMatchObject({ code: "bad_request" });
    trip = await trips.addStay("u", t.id, { url: "https://www.airbnb.co.in/rooms/kp-garden-flat" });
    expect(trip.spots).toEqual(["Sakshi and Arjun's wedding, Koregaon Park"]);
    expect(trip.stays.map((s) => [s.name, s.area, s.nightPaise, s.rating, s.host, s.by])).toEqual([
      ["Shanti Residency", "Koregaon Park", 320000, 4.4, "booking.com", "you"],
      ["Deccan Courtyard", "FC Road", 260000, null, "makemytrip.com", "chat"],
      ["Kp Garden Flat", "", null, null, "airbnb.co.in", "you"],
    ]);
    const [a, b] = trip.stays;
    trip = await trips.pickStay("u", t.id, a!.id);
    trip = await trips.pickStay("u", t.id, b!.id);
    expect(trip.stays.map((s) => s.picked)).toEqual([false, true, false]);
    trip = await trips.pickStay("u", t.id, b!.id);
    expect(trip.stays.every((s) => !s.picked)).toBe(true);
    trip = await trips.dropStay("u", t.id, a!.id);
    trip = await trips.dropSpot("u", t.id, 0);
    expect([trip.stays.length, trip.spots.length]).toEqual([2, 0]);
    await expect(trips.pickStay("v", t.id, b!.id)).rejects.toMatchObject({ status: 404 });
  });

  it("works out the weather, where the places are and how far each stay is, after the screen loaded", async () => {
    const told: string[] = [];
    const later = new Later((_u, topics) => told.push(...topics));
    const PTS: Record<string, { lat: number; lon: number }> = {
      "koregaon park, pune": { lat: 18.5362, lon: 73.894 }, "shanti residency, koregaon park, pune": { lat: 18.5379, lon: 73.8892 },
      "fc road, pune": { lat: 18.5236, lon: 73.8413 }, "far away inn, pune": { lat: 28.6, lon: 77.2 },
    };
    const places = new Places({
      geocoder: { id: "fake", async geocode(q) { const p = PTS[q]; return p ? [{ ...p, label: q, country: "in" }] : []; } },
      routing: { id: "osrm", modes: ["drive"], async leg(a, _b, mode) { return { mode, minutes: a.lat === 18.5379 ? 10 : 22, km: 4 }; } },
      weather: { id: "metno", peek: () => undefined, async forecast() { return FORECAST; } },
      driveBuffer: 1.2,
    });
    const trips = new Trips(() => NOW, new MemoryTable());
    const t = await trips.create("u", { place: "Pune", when: "29–31 Oct" });
    await trips.addSpot("u", t.id, "Sakshi and Arjun's wedding, Koregaon Park");
    await trips.addStay("u", t.id, { name: "Shanti Residency", area: "Koregaon Park", price: "3200", rating: "4.4" });
    await trips.addStay("u", t.id, { name: "Deccan Courtyard", area: "FC Road", price: "2600", rating: "4.1" });
    await trips.addStay("u", t.id, { name: "Far Away Inn", price: "1500" });
    const x = new TripExtrasReader({ places, later, trips, source: null, waitMs: 0, now: () => NOW });
    const trip = await trips.get("u", t.id);
    const first = await x.read("u", trip, { tz: IST });
    expect(first).toMatchObject({ dates: { nights: 2 }, where: "Pune", pending: true, canFind: false, canMeasure: true });
    expect(first.stays.every((s) => s.minutes === null)).toBe(true);
    await later.idle();
    expect(told).toEqual(["bot:travel"]);
    const read = await x.read("u", trip, { tz: IST });
    expect(read.pending).toBe(false);
    expect(read.weather).toMatchObject({ line: "Rain on Fri, Sat", pack: "Umbrella, rain on Fri" });
    expect(read.spots).toEqual([{ text: "Sakshi and Arjun's wedding, Koregaon Park", found: true }]);
    expect(read.main).toBe("Sakshi and Arjun's wedding");
    expect(read.stays.map((s) => [s.name, s.minutes, s.label, s.totalPaise])).toEqual([
      ["Shanti Residency", 12, "Travel bot's pick", 640000], ["Deccan Courtyard", 27, "", 520000], ["Far Away Inn", null, "", 300000],
    ]);
    expect(read.credits.map((c) => c.text)).toEqual(["Map data © OpenStreetMap contributors", "Routes: OSRM", "Weather: MET Norway"]);
  });

  it("asks for the dates instead of guessing, and says when the forecast opens", async () => {
    const places = new Places({ weather: { id: "metno", peek: () => FORECAST, async forecast() { return FORECAST; } } });
    const trips = new Trips(() => NOW, new MemoryTable());
    const x = new TripExtrasReader({ places, later: new Later(() => undefined), trips, source: null, waitMs: 0, now: () => NOW });
    const none = await trips.create("u", { place: "Pune", when: "" });
    expect((await x.read("u", none, { tz: IST })).weatherNote).toBe("Add the dates to see the weather.");
    const far = await trips.create("u", { place: "Pune", when: "14–16 Nov" });
    expect((await x.read("u", far, { tz: IST })).weatherNote).toBe("The forecast for these days opens around 5 Nov.");
    const lost = await trips.create("u", { place: "Atlantis", when: "29–31 Oct" });
    expect((await x.read("u", lost, { tz: IST })).weatherNote).toBe("Couldn't find Atlantis on the map for the weather.");
  });
});

// ------------------------------------------------------------------ the routes

async function served() {
  const later = new Later(() => undefined);
  const source = { id: "fake", find: vi.fn(async () => [{ name: "Shanti Residency", area: "Koregaon Park", url: "https://www.booking.com/hotel/in/shanti.html", nightPaise: 320000, rating: 8.6, ratingOf: 10 as const, reviews: 1820 }]) };
  const parts = botsAreaParts({ bots: null, connectors: null, reader: fakeReader(), now: () => NOW, places: new Places(), stays: source, later, waitMs: 0 });
  const app = Fastify();
  registerBotsBotsRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null }, { parts });
  await app.ready();
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, user: string | null = "aanya") =>
    app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, call, later, source };
}

describe("the routes", () => {
  it("keep a trip's places and stays, search in the background, and answer the extras", async () => {
    const s = await served();
    const trip = (await s.call("POST", `${A}/trip`, { place: "Pune", when: "14–16 Nov" })).json().trip;
    expect((await s.call("GET", `${A}/trip/${trip.id}/extras`, undefined, null)).statusCode).toBe(401);
    expect((await s.call("GET", `${A}/trip/${trip.id}/extras`, undefined, "rohan")).statusCode).toBe(404);
    expect((await s.call("POST", `${A}/trip/${trip.id}/spots`, { text: "The wedding, Koregaon Park" })).json().trip.spots).toEqual(["The wedding, Koregaon Park"]);
    const added = await s.call("POST", `${A}/trip/${trip.id}/stays`, { name: "Deccan Courtyard", price: "₹2,600", area: "FC Road" });
    expect(added.statusCode).toBe(201);
    const stayId = added.json().trip.stays[0].id;
    expect((await s.call("POST", `${A}/trip/${trip.id}/stays`, { url: "ftp://nope" })).json()).toEqual({ code: "bad_request", message: "That link doesn't look right." });
    expect((await s.call("PUT", `${A}/trip/${trip.id}/stays/${stayId}/pick`)).json().trip.stays[0].picked).toBe(true);
    const find = await s.call("POST", `${A}/trip/${trip.id}/stays/find`);
    expect([find.statusCode, find.json()]).toEqual([202, { finding: true }]);
    await s.later.idle();
    expect(s.source.find).toHaveBeenCalledWith({ place: "Pune", area: "Koregaon Park" }, { userId: "aanya" });
    const x = (await s.call("GET", `${A}/trip/${trip.id}/extras?tz=330`)).json().extras;
    expect(x).toMatchObject({ dates: { from: "2026-11-14", nights: 2 }, finding: false, searched: "found", canFind: true, canMeasure: false });
    expect(x.stays.map((st: { name: string; label: string; by: string }) => [st.name, st.label, st.by])).toEqual([["Deccan Courtyard", "Your pick", "you"], ["Shanti Residency", "", "web"]]);
    expect((await s.call("DELETE", `${A}/trip/${trip.id}/stays/${stayId}`)).json().trip.stays).toHaveLength(1);
    expect((await s.call("DELETE", `${A}/trip/${trip.id}/spots/0`)).json().trip.spots).toEqual([]);
    expect((await s.call("PUT", `${A}/plan/home`, { home: "  HSR   Layout " })).json()).toEqual({ home: "HSR Layout" });
    expect((await s.call("PUT", `${A}/plan/home`, { home: 4 })).statusCode).toBe(400);
  });
});

// ------------------------------------------------------------------ the screens

const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
function actions(nodes: Node[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const o = a as Record<string, unknown>;
    out.push(o);
    for (const k of ["actions", "then", "else", "onSuccess", "onError"]) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(visit); else visit(v);
    }
  };
  for (const n of nodes) for (const a of Object.values(n.on ?? {})) visit(a);
  return out;
}
async function build(screenId: string, client: "phone" | "desktop", api?: Record<string, unknown>) {
  const s = await buildBotsScreen({ screenId, client, params: {}, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ jobs: [], tasks: [], api: api ?? await sampleApi() }));
  return { s, nodes: walk(s.root!) };
}

describe("the screens", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`bots.travel on the ${client}: the stays side by side, the weather, where you'll be, live`, async () => {
      const { s, nodes } = await build("bots.travel", client);
      expect(lintTree(s.root!)).toEqual([]);
      const all = texts(nodes).join("\n");
      for (const w of ["Stay · 2 options", "Travel bot's pick", "Shanti Residency", "Koregaon Park", "Clear days, cool nights", "Sat 29° · Sun 30° · Mon 28° · lows 16°",
        "Where you'll be", "Sakshi and Arjun's wedding, Koregaon Park", "Prices and booking on their site"]) expect(all, w).toContain(w);
      // Compared by area, distance and rating; the prices are on the booking site, a tap away. No amount, no "Cheaper".
      expect(all.split("\n").filter((l) => /₹|Cheaper|a night/.test(l))).toEqual([]);
      expect(all).toContain(client === "phone" ? "See prices" : "Prices on");
      expect(all).toContain(client === "phone" ? "12 min to the wedding" : "12 min");
      if (client === "desktop") for (const w of ["Trip plan", "Sat 14 Nov", "Go", "Back", "Pick this", "Rating", "To the wedding"]) expect(all, w).toContain(w);
      expect(s.liveTopics).toEqual(["bot:travel"]);
      const paths = actions(nodes).filter((a) => a.kind === "callEndpoint").map((a) => `${a.method} ${a.path}`);
      const id = "7a1b2c3d-0000-4000-8000-0000000000aa";
      expect(paths).toEqual(expect.arrayContaining([`PUT ${A}/trip/${id}/stays/s1/pick`, `DELETE ${A}/trip/${id}/stays/s2`, `POST ${A}/trip/${id}/stays/find`, `POST ${A}/trip/${id}/stays`, `POST ${A}/trip/${id}/spots`, `DELETE ${A}/trip/${id}/spots/0`]));
      expect(actions(nodes).some((a) => a.kind === "openUrl" && a.url === "https://www.booking.com/hotel/in/shanti-residency-pune.html")).toBe(true);
      expect(all).not.toMatch(/\bbook it\b|we book|pay now/i);
    });

    it(`bots.plan on the ${client}: the trip between stops, a gap too short, where the day starts, minutes saved`, async () => {
      const { s, nodes } = await build("bots.plan", client);
      expect(lintTree(s.root!)).toEqual([]);
      const all = texts(nodes).join("\n");
      expect(all).toContain("4 things tomorrow · 40 min saved");
      if (client === "phone") {
        for (const w of ["Leave home by 5:30 pm · 30 min to Indiranagar", "Only 15 min to get there · 35 min to Koramangala", "Your day starts from HSR Layout"]) expect(all, w).toContain(w);
      } else {
        for (const w of ["Leave home by 5:30 pm", "Tight: 15 min to get to Koramangala", "Tight · 35 min", "Leave 5:30"]) expect(all, w).toContain(w);
      }
      expect(all).toContain("Map data © OpenStreetMap contributors · Routes: OSRM");
      expect(s.liveTopics).toEqual(["bot:plan", "calendar", "tasks"]);
      expect(actions(nodes).some((a) => a.kind === "callEndpoint" && a.path === `${A}/plan/home`)).toBe(true);
    });
  }

  it("bots.travel without extras (an older server, a failed read) still draws the trip", async () => {
    const api = await sampleApi();
    delete api[`GET ${A}/trip/7a1b2c3d-0000-4000-8000-0000000000aa/extras?tz=${IST}`];
    for (const client of ["phone", "desktop"] as const) {
      const { s, nodes } = await build("bots.travel", client, api);
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(nodes).join("\n")).toContain("Pune · 14–16 Nov");
      expect(texts(nodes).join("\n")).not.toContain("Stay · 2 options");
    }
  });
});

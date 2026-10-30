/**
 * Plan Ease's travel times (src/botsBots/planTravel.ts over src/places, with fakes: no network), on the boards' week (Aanya's
 * Thursday: a video standup, the dentist in Indiranagar at 6, dinner with Mom in Koramangala at 7).
 *
 *   - the trip between stops, when to leave, a gap too short to make; a video call is not a place
 *   - the suggestion: the gap judged against the trip, and with home known, the slot that saves the most travel, and how much
 *     (honestly: against the person's own order, from and back home; no home, no number)
 *   - a yes writes the minutes down; the head line shows the week's
 *   - what isn't known is looked up after the screen loaded, and the screen is told ("plan"); a provider that knows nothing tells nobody
 *   - rain on an outdoor stop
 */
import { beforeEach, describe, expect, it } from "vitest";
import { noNetwork } from "./no-network.js";

const { PlanDays, MemoryTable, resetAreaTablesForTests, suggestionFor } = await import("../src/botsBots/index.js");
const { PlanTravelling, placeText } = await import("../src/botsBots/planTravel.js");
const { Later } = await import("../src/botsBots/later.js");
const { Places } = await import("../src/places/index.js");
const { fakeReader, WEEK } = await import("./bots-bots-data.js");

noNetwork();

const NOW = Date.UTC(2026, 9, 28, 14, 10); // Wed 28 Oct, 7:40 pm in India
const PTS: Record<string, { lat: number; lon: number }> = {
  "hsr layout": { lat: 12.9116, lon: 77.6474 },
  indiranagar: { lat: 12.9784, lon: 77.6408 },
  koramangala: { lat: 12.9352, lon: 77.6245 },
  jayanagar: { lat: 12.9308, lon: 77.5838 },
  "cubbon park": { lat: 12.9763, lon: 77.5929 },
};
const NAME = (p: { lat: number }) => Object.entries(PTS).find(([, q]) => q.lat === p.lat)?.[0] ?? "?";
const MINS: Record<string, number> = {
  "hsr layout>indiranagar": 30, "indiranagar>hsr layout": 30, "indiranagar>koramangala": 35, "koramangala>indiranagar": 35,
  "hsr layout>koramangala": 20, "koramangala>hsr layout": 20, "hsr layout>jayanagar": 25, "jayanagar>hsr layout": 25,
  "jayanagar>indiranagar": 30, "indiranagar>jayanagar": 30, "hsr layout>cubbon park": 40, "cubbon park>hsr layout": 40,
};

function rig(o: { home?: string; events?: typeof WEEK; rain?: boolean } = {}) {
  const asked: string[] = [];
  const told: string[] = [];
  const places = new Places({
    geocoder: { id: "fake", async geocode(q: string) { asked.push(`geo:${q}`); const p = PTS[q]; return p ? [{ ...p, label: q, country: "in" }] : []; } },
    routing: { id: "fake", modes: ["drive"], async leg(a, b, mode) { const k = `${NAME(a)}>${NAME(b)}`; asked.push(`leg:${k}`); return MINS[k] ? { mode, minutes: MINS[k]!, km: 5 } : null; } },
    weather: o.rain ? (() => {
      let held: import("../src/places/types.js").Forecast | undefined;
      return {
        id: "fake", peek: () => held,
        async forecast() {
          asked.push("weather");
          held = { fetchedAt: NOW, expiresAt: NOW + 3_600_000, steps: [16, 17, 18].map((h) => ({ t: Date.UTC(2026, 9, 29, h, 0) - 330 * 60_000, hours: 1, tempC: 26, rainMm: h === 17 ? 2.4 : 0, symbol: h === 17 ? "rainshowers_day" : "cloudy" })) };
          return held;
        },
      };
    })() : null,
    driveBuffer: 1,
  });
  const later = new Later((_u, topics) => told.push(...topics));
  const prefs = new MemoryTable();
  const travel = new PlanTravelling({ places, later, waitMs: 0, now: () => NOW, prefs: prefs as never });
  const used: unknown[] = [];
  // The move is on the person's own calendar (src/calendar); here, written down.
  const mover = async (_u: string, eventId: string, startMs: number) => { used.push({ eventId, startMs }); };
  const plan = new PlanDays(fakeReader({ events: o.events ?? WEEK }), mover, () => NOW, new MemoryTable(), travel);
  const settled = async () => { await plan.read("u", { tz: 330 }); await later.idle(); return plan.read("u", { tz: 330 }); };
  return { plan, travel, later, asked, told, used, prefs, settled, places };
}

beforeEach(() => resetAreaTablesForTests());

describe("travel between tomorrow's stops", () => {
  it("draws what it knows at once, looks up the rest after, and tells the screen once", async () => {
    const r = rig();
    const first = await r.plan.read("u", { tz: 330 });
    expect(first.travel).toMatchObject({ on: true, pending: true, legs: [], home: "" });
    await r.later.idle();
    expect(r.told).toEqual(["bot:plan"]);
    expect(r.asked).toEqual(["geo:indiranagar", "geo:koramangala", "leg:indiranagar>koramangala"]);
    const read = await r.plan.read("u", { tz: 330 });
    await r.later.idle();
    expect(r.told).toEqual(["bot:plan"]);
    expect(read.travel!.pending).toBe(false);
    expect(read.travel!.legs).toEqual([{
      fromId: "e11", toId: "e12", to: "Koramangala", mode: "drive", minutes: 35, leaveBy: Date.UTC(2026, 9, 29, 18, 25) - 330 * 60_000, gapMin: 15, tight: true,
    }]);
    expect(read.travel!.credits.map((c) => c.text)).toEqual(["Map data © OpenStreetMap contributors"]);
  });

  it("judges the gap against the trip, and without home claims no minutes saved", async () => {
    const read = await rig().settled();
    expect(read.suggestion).toMatchObject({ eventId: "e11", question: "Move Dentist to Friday 10 am?" });
    expect(read.suggestion!.detail).toBe("Dentist ends at 6:45 pm in Indiranagar and Dinner with Mom starts at 7 pm in Koramangala, 35 min away. Friday 10 am is free. I'll move it only after you say yes.");
    expect(read.suggestion!.savedMin).toBeUndefined();
  });

  it("leaves a calm gap alone when the trip fits, though it is under half an hour", () => {
    const close = WEEK.map((e) => (e.id === "e11" ? { ...e, end: e.end - 25 * 60_000 } : e)); // dentist done at 6:20, dinner at 7
    const near = { between: () => 15, dayCost: () => undefined };
    expect(suggestionFor(close, "2026-10-29", 330, new Set(), near)).toBeNull();
    expect(suggestionFor(close, "2026-10-29", 330, new Set())).toBeNull();
    const tight = { between: () => 35, dayCost: () => undefined };
    expect(suggestionFor(close, "2026-10-29", 330, new Set(), tight)?.eventId).toBe("e11");
  });

  it("with home known: the trip from home, and the slot that saves the most, counted honestly", async () => {
    const r = rig();
    await r.plan.home("u", "HSR Layout");
    const read = await r.settled();
    expect(read.travel!.home).toBe("HSR Layout");
    expect(read.travel!.legs.map((l) => [l.fromId, l.toId, l.minutes, l.tight])).toEqual([["home", "e11", 30, false], ["e11", "e12", 35, true]]);
    // Thursday: home→Indiranagar 30 + →Koramangala 35 + →home 20 = 85; without the dentist 40. Friday adds 60 (there and back),
    // Saturday 35 (Jayanagar → Indiranagar → home instead of Jayanagar → home): Saturday saves 45 − 35 = 10.
    expect(read.suggestion).toMatchObject({ question: "Move Dentist to Saturday 2 pm?", savedMin: 10, startIso: "2026-10-31T14:00:00+05:30" });
    expect(read.suggestion!.detail).toContain("It saves about 10 min of travel.");
  });

  it("writes down what a yes saved, only for the move it suggested, and counts the week", async () => {
    const r = rig();
    await r.plan.home("u", "HSR Layout");
    const read = await r.settled();
    expect(await r.plan.move("u", "e11", "2026-10-30T10:00:00+05:30", "Move it")).toEqual({ done: true, message: "Moved." });
    expect((await r.plan.read("u", { tz: 330 })).travel!.savedWeekMin).toBe(0);
    await r.plan.move("u", "e11", read.suggestion!.startIso, read.suggestion!.question);
    expect((await r.plan.read("u", { tz: 330 })).travel!.savedWeekMin).toBe(10);
  });

  it("asks for nothing that isn't a place, and nothing at all when places are off", async () => {
    expect(placeText({ where: "Video call" })).toBeNull();
    expect(placeText({ place: "https://meet.google.com/abc-defg-hij" })).toBeNull();
    expect(placeText({ where: "Indiranagar", place: "Dr Mehta Dental, 100 Feet Rd, Indiranagar" })).toBe("Dr Mehta Dental, 100 Feet Rd, Indiranagar");
    const r = rig();
    await r.settled();
    expect(r.asked.some((a) => /video/i.test(a))).toBe(false);
    const off = new PlanDays(fakeReader(), null, () => NOW, new MemoryTable(), new PlanTravelling({ places: new Places(), later: new Later(() => undefined), waitMs: 0, now: () => NOW, prefs: new MemoryTable() as never }));
    const read = await off.read("u", { tz: 330 });
    expect(read.travel).toMatchObject({ on: false, pending: false, legs: [], headsUp: [] });
    expect(read.suggestion?.question).toBe("Move Dentist to Friday 10 am?");
  });

  it("gives a gentle heads-up for rain on an outdoor stop", async () => {
    const ist = (h: number) => Date.UTC(2026, 9, 29, h, 0) - 330 * 60_000;
    const events = [{ id: "m1", title: "Cricket match", start: ist(16), end: ist(18), allDay: false, where: "Cubbon Park", people: 4 }];
    const read = await rig({ events, rain: true }).settled();
    expect(read.travel!.headsUp).toEqual([{ eventId: "m1", kind: "rain", text: "Rain likely around 5 pm. Carry an umbrella." }]);
    expect(read.travel!.credits.map((c) => c.text)).toContain("Weather: MET Norway");
  });
});

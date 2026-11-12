/**
 * PLAN EASE'S HOME: ONE DAY AS A THREAD (PLAN_V2_HOME; src/botsBots/planThread.ts, planEase.ts day, planRows.ts; docs/plan-ease.md).
 *
 *   - the steps: all day first; the times, each with its leave-by before it, its weather after it and free time after it; day-only
 *     to-dos; done to-dos last
 *   - every row as rowOf words it: the follow line, Must not miss, "For Dad" with Dad's tiny bot
 *   - the day it opens on, the strip's reach, today's and tomorrow's travel whole, and "Added: …" after Done for 10 minutes
 *   - the simple page's one next thing keeps its follow line
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { threadOf, stripOf, dayParam, defaultDay, addedOf, lengthWords, followOpen } = await import("../src/botsBots/planThread.js");
const { nextThing, clockOf, planPage } = await import("../src/botsBots/planDay.js");
const { lookOf } = await import("../src/botsBots/personLook.js");
const { rowOf } = await import("../src/botsBots/planRows.js");
const { addPlanSource, removePlanSource } = await import("../src/botsBots/planSources.js");
const { resetConfigForTests } = await import("../src/config.js");
type DayItem = import("../src/botsBots/planRows.js").DayItem;
type RowCtx = import("../src/botsBots/planRows.js").RowCtx;
type PlanTravel = import("../src/botsBots/planTravel.js").PlanTravel;
type ThreadStep = import("../src/botsBots/planThread.js").ThreadStep;

const MIN = 60_000;
const IST = 330;
/** November 2026, India's wall clock. Thu 12 Nov is the design's day. */
const ist = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const DAD = "22222222-0000-4000-8000-000000000002", MOM = "11111111-0000-4000-8000-000000000001";
const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); removePlanSource("follow"); });

const ctxAt = (now: number, o: Partial<RowCtx> = {}): RowCtx => ({ tz: IST, now, clock: (ms) => clockOf(ms, IST), leaves: new Map(), clashes: new Map(), ...o });
const event = (id: string, title: string, start: number, end: number, o: Partial<DayItem> = {}): DayItem => ({
  ref: "event", id, kind: "event", title, day: new Date(start + IST * MIN).toISOString().slice(0, 10), start, end, allDay: false, done: false, fixed: false, source: "me", ...o,
});
const todo = (id: string, title: string, day: string, o: Partial<DayItem> = {}): DayItem => ({
  ref: "task", id, kind: "todo", title, day, start: null, end: null, allDay: false, done: false, fixed: false, source: "me", ...o,
});
const words = (steps: ThreadStep[]) => steps.map((s) => (s.k === "row" ? `${s.label} | ${s.row.title} | ${s.meta}${s.dim ? " (dim)" : ""}${s.fresh ? " (new)" : ""}` : `${s.k}: ${s.text}`));

function travelOf(o: Partial<PlanTravel> = {}): PlanTravel {
  return { on: true, pending: false, home: "HSR Layout", homeFound: true, legs: [], headsUp: [], savedWeekMin: 0, credits: [], ...o };
}

function rig(t0: number, o: { travel?: (day: string) => PlanTravel | null } = {}) {
  const clock = { t: t0 };
  const c = new Calendar({ rows: memoryCalendarRows(), now: () => clock.t, publish: () => undefined });
  const prefs = memoryPlanPrefs(() => clock.t);
  const travel = o.travel ? {
    on: true,
    plan: async (_u: string, x: { tomorrow: string }) => ({ travel: o.travel!(x.tomorrow) ?? travelOf({ legs: [] }), suggestion: null }),
    keepShown: async () => undefined, moved: async () => undefined,
  } : null;
  const ease = new PlanEase({ calendar: c, prefs, skips: new MemoryTable(), now: () => clock.t, ...(travel ? { travel: travel as never } : {}) });
  return { clock, c, prefs, ease };
}

describe("the thread", () => {
  it("all day first, then the times with their leave-by before and weather after, free time of 90 minutes or more, day-only to-dos, done last", () => {
    const now = ist(12, 9);
    const items: DayItem[] = [
      todo("t1", "Buy fruit costume", "2026-11-12"),
      todo("t0", "Call the bank", "2026-11-12", { done: true }),
      event("e3", "Dinner", ist(12, 20, 30), ist(12, 21, 30)),
      event("e2", "Dentist · Dr. Mehta", ist(12, 18), ist(12, 18, 45), { where: "Indiranagar", place: "Indiranagar, 100 Feet Road" }),
      event("e1", "Diwali", 0, 0, { allDay: true, start: null, end: null, day: "2026-11-12" }),
      event("e4", "Standup", ist(12, 10), ist(12, 10, 30)),
    ];
    const travel = travelOf({
      legs: [{ fromId: "home", toId: "e2", to: "Indiranagar", mode: "drive", minutes: 30, leaveBy: ist(12, 17, 30), gapMin: null, tight: false }],
      headsUp: [{ eventId: "e2", kind: "rain", text: "Rain likely around 6 pm" }],
    });
    const steps = threadOf(items, { day: "2026-11-12", now, tz: IST, me: U, travel, rowCtx: ctxAt(now), fresh: new Set() });
    expect(words(steps)).toEqual([
      "All day | Diwali | ",
      "10:00 am | Standup | 30 min",
      "free: Free · 10:30 am to 6 pm, 7 h 30 min",
      "leave: Leave home by 5:30 pm · 30 min to Indiranagar",
      "6:00 pm | Dentist · Dr. Mehta | 45 min · Indiranagar",
      "sky: Rain likely around 6 pm",
      "free: Free · 6:45 pm to 8:30 pm, 1 h 45 min",
      "8:30 pm | Dinner | 1 h",
      "To do | Buy fruit costume | ",
      "To do | Call the bank |  (dim)",
    ]);
    // Within 15 minutes of leaving: Open map. A tight leg says so; no time at all says that.
    const soon = threadOf(items, { day: "2026-11-12", now: ist(12, 17, 20), tz: IST, me: U, travel, rowCtx: ctxAt(ist(12, 17, 20)), fresh: new Set() });
    const leave = soon.find((s) => s.k === "leave")!;
    expect(leave).toMatchObject({ k: "leave", tight: false, button: { label: "Open map" } });
    expect((leave as { button: { url: string } }).button.url).toContain("Indiranagar");
    const tight = threadOf(items, { day: "2026-11-12", now, tz: IST, me: U, rowCtx: ctxAt(now), fresh: new Set(), travel: travelOf({ legs: [{ fromId: "e4", toId: "e2", to: "Koramangala", mode: "drive", minutes: 35, leaveBy: ist(12, 17, 25), gapMin: 15, tight: true }] }) });
    expect(tight.find((s) => s.k === "leave")).toMatchObject({ text: "Only 15 min to get there · 35 min to Koramangala", tight: true });
    // Free time that ended before now is not news, and less than 90 minutes is not free time; an event over is dim.
    const late = threadOf(items, { day: "2026-11-12", now: ist(12, 19), tz: IST, me: U, rowCtx: ctxAt(ist(12, 19)), fresh: new Set() });
    expect(words(late).filter((w) => w.startsWith("free"))).toEqual(["free: Free · 7 pm to 8:30 pm, 1 h 30 min"]);
    // Free time counts from now (the next quarter hour): less than 90 minutes left of it is not said.
    const later = threadOf(items, { day: "2026-11-12", now: ist(12, 19, 10), tz: IST, me: U, rowCtx: ctxAt(ist(12, 19, 10)), fresh: new Set() });
    expect(later.some((s) => s.k === "free")).toBe(false);
    expect(words(late)).toContain("10:00 am | Standup | 30 min (dim)");
    const short = threadOf([event("a", "A", ist(12, 10), ist(12, 11)), event("b", "B", ist(12, 12), ist(12, 13))], { day: "2026-11-12", now, tz: IST, me: U, rowCtx: ctxAt(now), fresh: new Set() });
    expect(short.some((s) => s.k === "free")).toBe(false);
    // A free meeting never bounds free time; lengths read plainly.
    expect([lengthWords(45 * MIN), lengthWords(90 * MIN), lengthWords(120 * MIN)]).toEqual(["45 min", "1 h 30 min", "2 h"]);
    expect(threadOf([], { day: "2026-11-12", now, tz: IST, me: U, rowCtx: ctxAt(now), fresh: new Set() })).toEqual([]);
  });

  it("a followed row shows its follow line; a must row says Must not miss first; someone else's item says For Dad with Dad's tiny bot", () => {
    const now = ist(12, 9);
    const items: DayItem[] = [
      event("e1", "Pick up Kabir", ist(12, 20, 30), ist(12, 21), { people: [{ k: "u", id: MOM, name: "Mom" }] }),
      event("e2", "Medicine", ist(12, 21), ist(12, 21, 15), { people: [{ k: "u", id: DAD, name: "Dad" }] }),
      todo("t1", "Buy milk", "2026-11-12", { people: [{ k: "u", id: DAD, name: "Dad" }] }),
      event("e3", "Board meeting", ist(12, 11), ist(12, 12), { importance: "must", where: "Office" }),
      event("e4", "Gym", ist(12, 7), ist(12, 8), { people: [{ k: "u", id: U, name: "You" }] }),
    ];
    const steps = threadOf(items, {
      day: "2026-11-12", now, tz: IST, me: U, rowCtx: ctxAt(now, { follow: new Map([["e:e1", "Mom · not done yet"]]) }), fresh: new Set(["e:e3"]),
    });
    const row = (title: string) => steps.find((s) => s.k === "row" && s.row.title === title) as Extract<ThreadStep, { k: "row" }>;
    expect(row("Pick up Kabir")).toMatchObject({ meta: "Mom · not done yet", row: { followed: true, must: true, who: { name: "Mom" } } });
    expect(row("Medicine").meta).toBe("Must not miss · 15 min · For Dad");
    expect(row("Medicine").row.who).toEqual({ look: lookOf(DAD), name: "Dad" });
    expect(row("Buy milk").meta).toBe("For Dad");
    expect(row("Board meeting")).toMatchObject({ meta: "Must not miss · 1 h · Office", fresh: true });
    // The viewer's own item says nothing about who.
    expect(row("Gym").row.who).toBeUndefined();
    expect(row("Gym")).toMatchObject({ meta: "1 h", dim: true });
    // In the thread the leave-by is its own step: no "Leave by" in a row's grey line.
    const leaves = new Map([["e3", { leaveBy: ist(12, 10, 30), minutes: 20, mode: "drive", to: "Office" }]]);
    const withLeave = threadOf(items, { day: "2026-11-12", now, tz: IST, me: U, rowCtx: ctxAt(now, { leaves }), fresh: new Set() });
    expect(JSON.stringify(withLeave)).not.toContain("Leave by");
    // Outside the thread (the simple page, the week page) the time and the leave-by stay in the grey line, now with "For Dad".
    const page = planPage({ now, tz: IST, today: "2026-11-12", tomorrow: "2026-11-13", items, leaves, clashes: new Map(), needs: null, me: U });
    const lines = page.days.flatMap((d) => d.rows.map((x) => `${x.title}: ${x.line}`));
    expect(lines).toContain("Medicine: Must not miss · For Dad");
    expect(lines).toContain("Buy milk: For Dad");
    expect(page.next).toMatchObject({ big: "Board meeting at 11 am" });
    const timedTodo = todo("t9", "Call Dad's doctor", "2026-11-12", { start: ist(12, 16), people: [{ k: "u", id: DAD, name: "Dad" }] });
    expect(rowOf(timedTodo, ctxAt(now, { me: U })).line).toBe("For Dad · 4 pm");
    expect(rowOf(timedTodo, ctxAt(now, { me: U, thread: true })).line).toBe("For Dad");
    expect(rowOf(timedTodo, ctxAt(now, { me: DAD })).line).toBe("4 pm");
  });
});

describe("the home's day", () => {
  it("the day opens on today, and on tomorrow after 5 pm when today is done", async () => {
    const r = rig(ist(12, 16));
    await r.c.addEvent(U, { title: "Standup", day: "2026-11-12", time: "10:00", tz: IST });
    await r.c.addEvent(U, { title: "Swim", day: "2026-11-13", time: "07:00", tz: IST });
    expect((await r.ease.day(U, IST)).day).toBe("2026-11-12");
    r.clock.t = ist(12, 17, 30);
    const eve = await r.ease.day(U, IST);
    expect(eve).toMatchObject({ v: 3, day: "2026-11-13", label: "Tomorrow", date: "Fri 13 Nov", today: "2026-11-12", tomorrow: "2026-11-13" });
    // A to-do still open today keeps it on today.
    const t = await r.c.addTask(U, { title: "Buy milk", day: "2026-11-12", tz: IST });
    expect((await r.ease.day(U, IST)).day).toBe("2026-11-12");
    await r.c.tickTask(U, t.id, true);
    expect((await r.ease.day(U, IST)).day).toBe("2026-11-13");
    // Pure, the same rule.
    expect(defaultDay([], ist(12, 16, 59), IST)).toBe("2026-11-12");
    expect(defaultDay([], ist(12, 17), IST)).toBe("2026-11-13");
    // An empty day says so, with nothing to share; a full one has its share text and head line.
    const empty = await r.ease.day(U, IST, "2026-11-14");
    expect(empty).toMatchObject({ label: "Saturday", thread: [], empty: "Nothing on Saturday", share: null });
    const fri = await r.ease.day(U, IST, "2026-11-13");
    expect(fri.share).toEqual({ title: "Tomorrow · Fri 13 Nov", text: "7:00 am · Swim" });
    expect(fri.head).toBe("Tomorrow starts at 7 am");
  });

  it("the strip goes 8 weeks either way and no further", async () => {
    const today = "2026-11-12";
    const s = stripOf(today, today, [todo("x", "Milk", "2026-11-13")]);
    expect(s.days.map((d) => `${d.wd} ${d.n}${d.busy ? "•" : ""}${d.today ? "○" : ""}`)).toEqual(["Mon 9", "Tue 10", "Wed 11", "Thu 12○", "Fri 13•", "Sat 14", "Sun 15"]);
    expect([s.prev, s.next]).toEqual(["2026-11-05", "2026-11-19"]);
    // Eight weeks on is the last week: its next is null; eight weeks back, its prev is null.
    expect(stripOf("2027-01-07", today, []).next).toBeNull();
    expect(stripOf("2026-12-31", today, []).next).toBe("2027-01-07");
    expect(stripOf("2026-09-17", today, []).prev).toBeNull();
    expect(stripOf("2026-09-24", today, []).prev).toBe("2026-09-17");
    // The day param: within the reach, else the old week param, else the default.
    expect(dayParam("2027-01-10", undefined, today)).toBe("2027-01-10");
    expect(dayParam("2027-01-12", undefined, today)).toBeNull();
    expect(dayParam("2026-09-13", undefined, today)).toBeNull();
    expect(dayParam(undefined, "1", today)).toBe("2026-11-19");
    expect(dayParam(undefined, "-20", today)).toBe("2026-09-17");
    expect(dayParam("nope", "x", today)).toBeNull();
    const r = rig(ist(12, 10));
    expect((await r.ease.day(U, IST, "2027-03-01")).day).toBe("2026-11-12");
    expect((await r.ease.day(U, IST, undefined, { week: "1" })).day).toBe("2026-11-19");
  });

  it("today's and tomorrow's travel come whole: tight legs, weather, credits", async () => {
    const credits = [{ text: "Map data © OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" }];
    const r = rig(ist(12, 9), {
      travel: (day) => (day === "2026-11-12"
        ? travelOf({
          legs: [{ fromId: "home", toId: "PLACEHOLDER", to: "Koramangala", mode: "drive", minutes: 35, leaveBy: ist(12, 17, 25), gapMin: 10, tight: true }],
          headsUp: [{ eventId: "PLACEHOLDER", kind: "storm", text: "Storms likely around 6 pm" }], credits, savedWeekMin: 40,
        })
        : travelOf({ pending: true, credits })),
    });
    const e = await r.c.addEvent(U, { title: "Match", day: "2026-11-12", time: "18:00", place: "Koramangala", tz: IST });
    // The fake travel names the event by its id once it exists.
    const real = (r.ease as unknown as { travel: { plan: (u: string, x: { tomorrow: string }) => Promise<{ travel: PlanTravel }> } }).travel;
    const plan = real.plan;
    real.plan = async (u, x) => {
      const got = await plan(u, x);
      return { ...got, travel: { ...got.travel, legs: got.travel.legs.map((l) => ({ ...l, toId: e.id })), headsUp: got.travel.headsUp.map((h) => ({ ...h, eventId: e.id })) } };
    };
    const d = await r.ease.day(U, IST);
    expect(d.travel).toMatchObject({ on: true, home: "HSR Layout", credits, legs: [{ tight: true, gapMin: 10 }], headsUp: [{ kind: "storm" }] });
    expect(words(d.thread)).toEqual(["leave: Only 10 min to get there · 35 min to Koramangala", "6:00 pm | Match | 1 h · Koramangala", "sky: Storms likely around 6 pm"]);
    expect(d.head).toBe("Match at 6 pm · 40 min saved");
    expect((await r.ease.day(U, IST, "2026-11-13")).travel).toMatchObject({ pending: true });
    // Other days have no travel.
    expect((await r.ease.day(U, IST, "2026-11-14")).travel).toBeUndefined();
  });

  it("made and n give 'Added: …' and outline the rows for 10 minutes, then nothing", async () => {
    const r = rig(ist(12, 10));
    const e = await r.c.addEvent(U, { title: "Dentist", day: "2026-11-13", time: "17:00", tz: IST }, { kind: "me" }, { key: `make:${KEY}:0`, parsed: true });
    const d = await r.ease.day(U, IST, "2026-11-13", { made: KEY, n: "1" });
    expect(d.added).toEqual({ line: "Added: Dentist, Fri 13 Nov, 5\u00a0pm", key: KEY, n: 1 });
    const fresh = d.thread.find((s) => s.k === "row" && s.row.id === `e:${e.id}`) as Extract<ThreadStep, { k: "row" }>;
    expect(fresh.fresh).toBe(true);
    // Someone else's key, a bad one, or too late: nothing.
    expect((await r.ease.day(U, IST, "2026-11-13", { made: "0f8fad5b-d9cb-469f-a165-70867728950f", n: "1" })).added).toBeUndefined();
    expect((await r.ease.day(U, IST, "2026-11-13", { made: "../../x", n: "1" })).added).toBeUndefined();
    expect((await r.ease.day(U, IST, "2026-11-13", { made: KEY, n: "99" })).added).toBeUndefined();
    r.clock.t = ist(12, 10, 11);
    const later = await r.ease.day(U, IST, "2026-11-13", { made: KEY, n: "1" });
    expect(later.added).toBeUndefined();
    expect(later.thread.some((s) => s.k === "row" && s.fresh)).toBe(false);
    // The words for the other shapes.
    const at = (o: Partial<import("../src/botsBots/planThread.js").KeyedRow>) => ({ kind: "event" as const, id: "x", title: "Swim", day: "2026-11-17", start: ist(17, 17), allDay: false, repeat: "", created: ist(12, 10), sourceKey: "k", ...o });
    const o = { now: ist(12, 10), tz: IST, today: "2026-11-12" };
    expect(addedOf([at({ repeat: "weekly" }), at({ id: "y", day: "2026-11-12", start: ist(12, 17), repeat: "weekly" })], o)!.line).toBe("Added: Swim, every Tue and Thu, 5\u00a0pm");
    expect(addedOf([at({ title: "Medicine", repeat: "daily", day: "2026-11-12", start: ist(12, 21) })], o)!.line).toBe("Added: Medicine, every day, 9\u00a0pm");
    expect(addedOf([at({ kind: "task", title: "Buy fruit", day: "2026-11-14", start: null })], o)!.line).toBe("Added: Buy fruit, Sat 14 Nov");
    expect(addedOf([at({ day: "2026-11-12", start: ist(12, 21) })], o)!.line).toBe("Added: Swim, today, 9\u00a0pm");
    expect(addedOf([at({}), at({ id: "z", title: "Gym" })], o)!.line).toBe("Added 2 things to your Plan");
    expect(addedOf([], o)).toBeNull();
  });

  it("the simple page's next line keeps its follow line", () => {
    const now = ist(12, 9);
    const items = [event("e1", "Pick up Kabir", ist(12, 15), ist(12, 15, 30), { where: "School" })];
    const base = { now, tz: IST, today: "2026-11-12", tomorrow: "2026-11-13", items, leaves: new Map(), clashes: new Map() };
    expect(nextThing(base)).toMatchObject({ big: "Pick up Kabir at 3 pm", grey: "School" });
    expect(nextThing({ ...base, follow: new Map([["e:e1", "Mom · not done yet"]]) })).toMatchObject({ big: "Pick up Kabir at 3 pm", grey: "Mom · not done yet" });
  });

  it("follow lines reach the home from follow-through, for today only", async () => {
    const r = rig(ist(12, 9));
    const e = await r.c.addEvent(U, { title: "Pick up Kabir", day: "2026-11-12", time: "15:00", tz: IST });
    addPlanSource({ name: "follow", more: async () => ({ lines: { [`e:${e.id}`]: "Mom · not done yet" } }) });
    const d = await r.ease.day(U, IST);
    expect(words(d.thread)).toEqual(["3:00 pm | Pick up Kabir | Mom · not done yet"]);
  });
});

describe("fixes after review", () => {
  it("a 9 pm medicine for Mom still opens on today at 9:20 pm while it is followed; a follow said done does not hold it", async () => {
    const r = rig(ist(12, 21, 20));
    const e = await r.c.addEvent(U, { title: "Take her medicine", day: "2026-11-12", time: "21:00", repeat: "daily", tz: IST }, { kind: "me" }, { parsed: true });
    // Without a follow line the evening rule moves the home to tomorrow (the medicine started 20 minutes ago).
    expect((await r.ease.day(U, IST)).day).toBe("2026-11-13");
    // Follow-through keys a line by the row of today's occurrence ("e:<id>@<day>" for a repeat).
    const row = (await r.ease.day(U, IST, "2026-11-12")).thread.find((x) => x.k === "row") as Extract<ThreadStep, { k: "row" }>;
    expect(row.row.id.startsWith(`e:${e.id.split("@")[0]}`)).toBe(true);
    const lines: Record<string, string> = { [row.row.id]: "Mom · not done yet" };
    addPlanSource({ name: "follow", more: async () => ({ lines }) });
    const d = await r.ease.day(U, IST);
    expect(d.day).toBe("2026-11-12");
    expect(words(d.thread)).toEqual(["9:00 pm | Take her medicine | Mom · not done yet"]);
    // Pure, the same rule: a followed row of today keeps the home on today; one said done, or another day's, does not.
    const items = [event("m", "Medicine", ist(12, 21), ist(12, 22))];
    expect(defaultDay(items, ist(12, 21, 20), IST)).toBe("2026-11-13");
    expect(defaultDay(items, ist(12, 21, 20), IST, new Set(["e:m"]))).toBe("2026-11-12");
    expect(defaultDay(items, ist(12, 21, 20), IST, followOpen(new Map([["e:m", "Mom said done"]])))).toBe("2026-11-13");
    expect(defaultDay(items, ist(12, 21, 20), IST, followOpen(new Map([["e:m", "Mom hasn't said done"]])))).toBe("2026-11-12");
  });

  it("free time ends at a to-do with a time: no free line over Dad's 10 pm medicine", () => {
    const now = ist(12, 9);
    const items = [
      event("p", "Pick up Kabir", ist(12, 21, 15), ist(12, 21, 30)),
      todo("m", "Medicine", "2026-11-12", { start: ist(12, 22), end: null }),
      event("c", "Call with Dev", ist(12, 23, 30), ist(12, 23, 59)),
    ];
    const steps = threadOf(items, { day: "2026-11-12", now, tz: IST, me: U, rowCtx: ctxAt(now), fresh: new Set() });
    expect(words(steps).filter((w) => w.startsWith("free:"))).toEqual([]);
    expect(words(steps).map((w) => w.split(" | ")[0])).toEqual(["9:15 pm", "10:00 pm", "11:30 pm"]);
    // A done to-do does not end it.
    const done = threadOf([items[0]!, { ...items[1]!, done: true }, items[2]!], { day: "2026-11-12", now, tz: IST, me: U, rowCtx: ctxAt(now), fresh: new Set() });
    expect(words(done)).toContain("free: Free · 9:30 pm to 11:30 pm, 2 h");
  });

  it("Done for a day further than the strip lands on that day with Added and the row outlined; the strip has no arrows there", async () => {
    const r = rig(ist(12, 10));
    const e = await r.c.addEvent(U, { title: "Passport renewal", day: "2027-02-20", time: "11:00", tz: IST }, { kind: "me" }, { key: `make:${KEY}:0`, parsed: true });
    const d = await r.ease.day(U, IST, "2027-02-20", { made: KEY, n: "1" });
    expect(d).toMatchObject({ day: "2027-02-20", label: "Saturday", added: { line: "Added: Passport renewal, Sat 20 Feb, 11\u00a0am", key: KEY, n: 1 } });
    expect(d.thread.find((s) => s.k === "row" && s.row.id.startsWith(`e:${e.id.split("@")[0]}`))).toMatchObject({ fresh: true, label: "11:00 am" });
    expect([d.strip.prev, d.strip.next]).toEqual([null, null]);
    // Without Done's rows (or once they are old) a far day is not taken: the default day.
    expect((await r.ease.day(U, IST, "2027-02-20")).day).toBe("2026-11-12");
    expect(dayParam("2027-02-20", undefined, "2026-11-12", ["2027-02-20"])).toBe("2027-02-20");
    expect(dayParam("2027-02-20", undefined, "2026-11-12", ["2027-02-21"])).toBeNull();
    r.clock.t = ist(12, 10, 11);
    expect((await r.ease.day(U, IST, "2027-02-20", { made: KEY, n: "1" })).day).toBe("2026-11-12");
  });

  it("the window's rail: the days after the day shown, tomorrow too when today is, only days with something on", async () => {
    const r = rig(ist(12, 10));
    await r.c.addEvent(U, { title: "Swim", day: "2026-11-13", time: "07:00", tz: IST });
    await r.c.addEvent(U, { title: "Lunch", day: "2026-11-15", time: "13:00", tz: IST });
    await r.c.addEvent(U, { title: "Meeting", day: "2026-11-20", time: "10:00", tz: IST });
    const today = await r.ease.day(U, IST);
    expect(today.week.map((w) => [w.key, w.line])).toEqual([["2026-11-13", "Swim 7 am"], ["2026-11-15", "Lunch 1 pm"]]);
    const sat = await r.ease.day(U, IST, "2026-11-14");
    expect(sat.week.map((w) => w.key)).toEqual(["2026-11-15", "2026-11-20"]);
  });

  it("a person on a row is the tiny bot their space shows (follow-through's looksOf), else their own look", async () => {
    const r = rig(ist(12, 9));
    const t = await r.c.addTask(U, { title: "Medicine", day: "2026-11-12", time: "22:00", tz: IST }, { kind: "me" }, null, {}, { parsed: true });
    await r.c.setFollow(U, { kind: "task", id: t.id }, { people: [{ k: "u", id: DAD, name: "Dad" }] });
    const space = { seed: DAD, avatar: lookOf(MOM).avatar, color: lookOf(MOM).color };
    // Wired at boot by the follow routes (routes/bots/planFollows.ts): follow-through's looksOf.
    r.ease.wire({ looks: async () => new Map([[DAD, space]]) });
    const row = (await r.ease.day(U, IST)).thread.find((s) => s.k === "row" && s.row.title === "Medicine") as Extract<ThreadStep, { k: "row" }>;
    expect(row.row.who).toEqual({ look: space, name: "Dad" });
    r.ease.wire({ looks: async () => { throw new Error("down"); } });
    const own = (await r.ease.day(U, IST)).thread.find((s) => s.k === "row" && s.row.title === "Medicine") as Extract<ThreadStep, { k: "row" }>;
    expect(own.row.who).toEqual({ look: lookOf(DAD), name: "Dad" });
  });
});


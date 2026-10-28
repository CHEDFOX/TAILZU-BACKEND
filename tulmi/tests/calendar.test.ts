/**
 * Tailzu's own calendar and to-dos (src/calendar), with no outside calendar:
 *
 *   - a line of words: "add dentist Friday 5 pm", "remind me to call Nani at 6", "Gym kal subah 7 baje", "Pay rent by Friday"
 *   - repeats (daily, weekdays, weekly, monthly on the 31st), a day taken out, until; when the next reminder is due
 *   - add, list, change, move, take out, tick; someone else's is theirs to change; a meeting's to-do, once
 *   - reminders: sent once through the push engine's door, moved on to the next start, none when it is long past
 *   - the routes: the person's own, 401 without a session, another person's is "not found"; quick add
 *   - a bot given "calendar": its tools write the person's own days ("Added by Plan bot"); the old Google ids mean these; Google is not offered
 *   - the Plan page and the add / change page draw it (both clients, lint clean); Today and Tasks read it
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id, email: `${id.slice(0, 4)}@example.in` } : null; } };
});

const { Calendar, memoryCalendarRows, readLine, timeOf, dayFrom, withOwnDays } = await import("../src/calendar/index.js");
const { occurrences, nextReminder } = await import("../src/calendar/repeat.js");
const { registerCalendarRoutes } = await import("../src/routes/botsCalendar.js");
const { PlanDays, calendarPlanReader } = await import("../src/botsBots/plan.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { verdict } = await import("../src/you/push.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { rig, ALICE, toolCall } = await import("./bots-rig.js");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** Wed 28 Oct 2026, 7:40 pm in India (the boards' day). */
const NOW = FIXED_NOW;
const ist = (day: number, h: number, m = 0, month = 10) => Date.UTC(2026, month - 1, day, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001", V = "bbbbbbbb-0000-4000-8000-000000000002";

function cal(now = { t: NOW }) {
  const published: string[] = [];
  const c = new Calendar({ rows: memoryCalendarRows(), now: () => now.t, publish: (u) => published.push(u) });
  return { c, published, now };
}

describe("a line of words", () => {
  it("reads what, when, how long and where, India-first", () => {
    const at = (w: string) => readLine(w, NOW, IST);
    expect(at("add dentist Friday 5 pm at Indiranagar")).toMatchObject({ title: "Dentist", day: "2026-10-30", time: 17 * 60, place: "Indiranagar", task: false, daySaid: true });
    expect(at("remind me to call Nani at 6")).toMatchObject({ title: "Call Nani", task: true, remind: true, time: 18 * 60, day: "2026-10-29" }); // 6 pm today has passed
    expect(at("Pay rent by Friday")).toMatchObject({ title: "Pay rent", task: true, day: "2026-10-30" });
    expect(at("Gym kal subah 7 baje")).toMatchObject({ title: "Gym", day: "2026-10-29", time: 7 * 60 });
    expect(at("Team lunch 30 Oct 1-2 pm")).toMatchObject({ title: "Team lunch", day: "2026-10-30", time: 13 * 60, end: 14 * 60 });
    expect(at("Call Nani every Sunday 11 am")).toMatchObject({ title: "Call Nani", repeat: "weekly", day: "2026-11-01", time: 11 * 60 });
    expect(at("put Rohan's match on my calendar Sat 12 pm")).toMatchObject({ title: "Rohan's match", day: "2026-10-31", time: 12 * 60 });
    expect(at("Diwali party Sat all day")).toMatchObject({ title: "Diwali party", allDay: true, task: false });
    expect(at("buy milk")).toMatchObject({ title: "Buy milk", task: true });
    expect([timeOf("5 pm"), timeOf("17:30"), timeOf("5.30 pm"), timeOf("noon"), timeOf("09:00"), timeOf("nope")]).toEqual([1020, 1050, 1050, 720, 540, null]);
    expect([dayFrom("fri", "2026-10-28"), dayFrom("next wed", "2026-10-28"), dayFrom("30/10", "2026-10-28"), dayFrom("2 jan", "2026-10-28"), dayFrom("parso", "2026-10-28")])
      .toEqual(["2026-10-30", "2026-11-04", "2026-10-30", "2027-01-02", "2026-10-30"]);
  });
});

describe("repeats and reminders", () => {
  const base = { all_day: false, tz_min: IST, repeat_until: null, skips: [] as string[], remind_min: 15 };
  it("repeats on the person's clock, skips a day taken out, stops at until, and the 31st only in months that have one", () => {
    const standup = { ...base, start_ms: ist(26, 9, 30), end_ms: ist(26, 10), repeat: "weekdays" as const, skips: ["2026-10-28"] };
    expect(occurrences(standup, ist(26, 0), ist(2, 0, 0, 11)).map((o) => o.day)).toEqual(["2026-10-26", "2026-10-27", "2026-10-29", "2026-10-30"]);
    const rent = { ...base, start_ms: ist(31, 10, 0, 10), end_ms: ist(31, 11, 0, 10), repeat: "monthly" as const };
    expect(occurrences(rent, ist(1, 0, 0, 10), Date.UTC(2027, 1, 1)).map((o) => o.day)).toEqual(["2026-10-31", "2026-12-31", "2027-01-31"]);
    const until = { ...base, start_ms: ist(26, 7), end_ms: ist(26, 8), repeat: "daily" as const, repeat_until: ist(28, 23) };
    expect(occurrences(until, ist(26, 0), ist(5, 0, 0, 11)).length).toBe(3);
  });

  it("knows when the next reminder is due: before a timed start, at 9 am for an all-day one", () => {
    const gym = { ...base, start_ms: ist(26, 7), end_ms: ist(26, 8), repeat: "daily" as const };
    expect(nextReminder(gym, NOW)).toEqual({ at: ist(29, 6, 45), start: ist(29, 7), day: "2026-10-29" });
    const bday = { ...base, all_day: true, start_ms: Date.UTC(2026, 9, 30), end_ms: Date.UTC(2026, 9, 31), repeat: "" as const, remind_min: 24 * 60 };
    expect(nextReminder(bday, NOW)).toEqual({ at: ist(29, 9), start: Date.UTC(2026, 9, 30), day: "2026-10-30" });
    expect(nextReminder({ ...gym, remind_min: null }, NOW)).toBeNull();
  });
});

describe("the person's own calendar and to-dos", () => {
  it("adds, lists, changes, moves and takes out, and says so live", async () => {
    const { c, published } = cal();
    const e = await c.addEvent(U, { title: "Dentist · Dr. Mehta", day: "2026-10-29", time: "18:00", minutes: 45, place: "Indiranagar, 100 Feet Road", tz: IST });
    expect(e).toMatchObject({ title: "Dentist · Dr. Mehta", start: ist(29, 18), end: ist(29, 18, 45), where: "Indiranagar", remindMin: 15, from: null, fixed: false });
    const words = await c.addEvent(U, { title: "Dinner with Mom Thu 7 pm in Koramangala", day: "2026-10-28", time: "", tz: IST });
    expect(words).toMatchObject({ title: "Dinner with Mom", day: "2026-10-29", start: ist(29, 19), place: "Koramangala" });
    const allDay = await c.addEvent(U, { title: "Diwali", day: "2026-11-08" });
    expect(allDay).toMatchObject({ allDay: true, day: "2026-11-08", remindMin: null });
    const t = await c.addTask(U, { title: "Pick up the cake", day: "2026-10-29", time: "17:30", tz: IST });
    expect(t).toMatchObject({ due: "2026-10-29", at: ist(29, 17, 30), remindMin: 0, done: false });
    const open = await c.addTask(U, { title: "Renew car insurance", tz: IST });
    const r = await c.list(U, { from: "2026-10-26", to: "2026-11-01", tz: IST });
    expect(r.events.map((x) => x.title)).toEqual(["Dentist · Dr. Mehta", "Dinner with Mom"]);
    expect(r.tasks.map((x) => x.title)).toEqual(["Pick up the cake"]);
    expect(r.open.map((x) => x.id)).toEqual([open.id]);
    expect((await c.list(V, { from: "2026-10-26", to: "2026-11-01", tz: IST })).events).toEqual([]);
    const moved = await c.moveEvent(U, e.id, ist(30, 10));
    expect(moved).toMatchObject({ start: ist(30, 10), end: ist(30, 10, 45) });
    expect(await c.changeEvent(U, e.id, { title: "Dentist", remind: "60" })).toMatchObject({ title: "Dentist", remindMin: 60, start: ist(30, 10) });
    expect((await c.tickTask(U, t.id, true)).done).toBe(true);
    await c.removeEvent(U, words.id);
    await expect(c.event(U, words.id)).rejects.toMatchObject({ status: 404 });
    await expect(c.removeTask(V, t.id)).rejects.toMatchObject({ status: 404 });
    await expect(c.addEvent(U, { title: "", day: "2026-10-29" })).rejects.toMatchObject({ status: 400 });
    await expect(c.addEvent(U, { title: "X", day: "2026-10-29", time: "25:99" })).rejects.toMatchObject({ status: 400 });
    expect(published.every((u) => u === U)).toBe(true);
    expect(published.length).toBeGreaterThan(6);
  });

  it("takes one day out of a series, or moves one start alone", async () => {
    const { c } = cal();
    const s = await c.addEvent(U, { title: "Standup", day: "2026-10-26", time: "9:30", minutes: 30, repeat: "weekdays", tz: IST });
    let r = await c.list(U, { from: "2026-10-26", to: "2026-11-01", tz: IST });
    expect(r.events.map((e) => e.day)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    await c.removeEvent(U, `${s.id}@2026-10-28`, { one: true });
    await c.moveEvent(U, `${s.id}@2026-10-29`, ist(29, 11));
    r = await c.list(U, { from: "2026-10-26", to: "2026-11-01", tz: IST });
    expect(r.events.map((e) => [e.day, e.start === ist(e.day === "2026-10-29" ? 29 : Number(e.day.slice(8)), e.day === "2026-10-29" ? 11 : 9, e.day === "2026-10-29" ? 0 : 30)])).toEqual([
      ["2026-10-26", true], ["2026-10-27", true], ["2026-10-29", true], ["2026-10-30", true],
    ]);
  });

  it("puts a line of words on the right list, and a meeting's to-do once", async () => {
    const { c } = cal();
    const ev = await c.quick(U, "add dentist Friday 5 pm", { tz: IST });
    expect(ev).toMatchObject({ kind: "event", said: "Dentist · Fri 30 Oct, 5 pm" });
    const td = await c.quick(U, "Pay rent by Friday", { tz: IST });
    expect(td).toMatchObject({ kind: "task", said: "Pay rent · Fri 30 Oct" });
    const onDay = await c.quick(U, "Call the bank", { tz: IST, day: "2026-10-31", kind: "task" });
    expect(onDay).toMatchObject({ kind: "task", task: { due: "2026-10-31" } });
    const a = await c.addFromNote(U, { noteId: "n1", todoId: "t1", noteTitle: "Weekly sync", text: "Send the deck to Rohan", when: "by Friday", tz: IST });
    const b = await c.addFromNote(U, { noteId: "n1", todoId: "t1", noteTitle: "Weekly sync", text: "Send the deck to Rohan", tz: IST });
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ title: "Send the deck to Rohan", due: "2026-10-30", from: "Weekly sync", source: "note", noteId: "n1", todoId: "t1" });
    expect(await c.fromNote(U, "n1")).toEqual({ t1: { id: a.id, done: false } });
    expect(await c.tickFromNote(U, "n1", "t1", true)).toBe(true);
    expect((await c.task(U, a.id)).done).toBe(true);
  });

  it("keeps someone else's plan theirs to change: it can be ticked or said no to, never changed", async () => {
    const { c } = cal();
    const answered: string[] = [];
    c.onSpaceAnswer(async (_u, _s, taskId, status) => { answered.push(`${taskId}:${status}`); });
    await c.landSpace(U, { taskId: "st1", spaceId: "sp1", spaceName: "Home", kind: "task", title: "Water the plants", notes: "", place: "", at: ist(29, 18), end: null, allDay: false, by: V, name: "Meera S.", done: false });
    await c.landSpace(U, { taskId: "st1", spaceId: "sp1", spaceName: "Home", kind: "task", title: "Water the plants", notes: "", place: "", at: ist(29, 18), end: null, allDay: false, by: V, name: "Meera S.", done: false });
    const [t] = (await c.list(U, { from: "2026-10-29", to: "2026-10-29", tz: IST })).tasks;
    expect(t).toMatchObject({ title: "Water the plants", from: "Meera S.", fixed: true, spaceId: "sp1", taskId: "st1" });
    expect((await c.list(U, { from: "2026-10-29", to: "2026-10-29", tz: IST })).tasks.length).toBe(1);
    await expect(c.changeTask(U, t!.id, { title: "x" })).rejects.toMatchObject({ status: 403 });
    await c.tickTask(U, t!.id, true);
    expect(answered).toEqual(["st1:done"]);
    await c.cantDo(U, t!.id);
    expect(answered).toEqual(["st1:done", "st1:cant"]);
    expect((await c.list(U, { from: "2026-10-29", to: "2026-10-29", tz: IST })).tasks).toEqual([]);
  });
});

describe("reminders", () => {
  it("are sent once when due, moved on to the next start, and not sent long after", async () => {
    const clock = { t: ist(29, 6) };
    const { c } = cal(clock);
    await c.addEvent(U, { title: "Gym", day: "2026-10-29", time: "7:00", repeat: "daily", tz: IST, place: "Cult, HSR Layout" });
    await c.addTask(U, { title: "Pick up the cake", day: "2026-10-29", time: "17:30", tz: IST });
    const sent: Array<{ userId: string; key: string; vars: Record<string, string> }> = [];
    const send = async (userId: string, m: { key: string; vars: Record<string, string> }) => { sent.push({ userId, key: m.key, vars: m.vars }); };
    expect(await c.remind(send)).toBe(0);
    clock.t = ist(29, 6, 45);
    expect(await c.remind(send)).toBe(1);
    expect(await c.remind(send)).toBe(0);
    expect(sent[0]).toMatchObject({ userId: U, vars: { title: "Gym", when: "At 7 am · Cult" } });
    clock.t = ist(29, 17, 31);
    await c.remind(send);
    expect(sent.map((x) => x.vars.title)).toEqual(["Gym", "Pick up the cake"]);
    expect(sent[1]!.vars.when).toBe("Due 5:30 pm");
    // The server was down for days: the old one is not sent, the next one is.
    clock.t = ist(2, 6, 50, 11);
    expect(await c.remind(send)).toBe(0);
    clock.t = ist(3, 6, 46, 11);
    expect(await c.remind(send)).toBe(1);
  });

  it("follow the person's say: sent, quietly in quiet hours, not with Plan bot off", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    expect(verdict(s, "plan_reminder", 10 * 60)).toBe("send");
    expect(verdict({ ...s, notify: { ...s.notify, botsOff: ["plan"] } }, "plan_reminder", 10 * 60)).toBe("drop");
  });
});

describe("the routes", () => {
  beforeEach(() => undefined);
  async function served() {
    const { c } = cal();
    const app = Fastify();
    registerCalendarRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } } }, { calendar: c, reminders: false });
    await app.ready();
    const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, user: string | null = U, payload?: unknown) => {
      const r = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
      return { status: r.statusCode, body: r.json() as Record<string, any> };
    };
    return { call, c };
  }

  it("lists, adds, changes, ticks and takes out the person's own, and nobody else's", async () => {
    const s = await served();
    expect((await s.call("GET", "/v1/botsapp/calendar?from=2026-10-26&to=2026-11-01", null)).status).toBe(401);
    const e = await s.call("POST", "/v1/botsapp/calendar/events", U, { title: "Dentist", day: "2026-10-30", time: "17:00", tz: IST });
    expect(e.status).toBe(201);
    const t = await s.call("POST", "/v1/botsapp/calendar/tasks", U, { title: "GST papers", day: "2026-10-30", tz: IST });
    const q = await s.call("POST", "/v1/botsapp/calendar/quick", U, { words: "Bank Sat 10 am at Jayanagar", tz: IST });
    expect(q.body).toMatchObject({ kind: "event", event: { title: "Bank", place: "Jayanagar" } });
    const week = (await s.call("GET", `/v1/botsapp/calendar?from=2026-10-26&to=2026-11-01&tz=${IST}`)).body;
    expect(week.events.map((x: { title: string }) => x.title)).toEqual(["Dentist", "Bank"]);
    expect((await s.call("GET", `/v1/botsapp/calendar/events/${e.body.event.id}`, V)).status).toBe(404);
    expect((await s.call("PUT", `/v1/botsapp/calendar/tasks/${t.body.task.id}`, U, { done: true })).body.task.done).toBe(true);
    expect((await s.call("PUT", `/v1/botsapp/calendar/events/${e.body.event.id}`, U, { time: "11:00" })).body.event.start).toBe(ist(30, 11));
    expect((await s.call("DELETE", `/v1/botsapp/calendar/events/${e.body.event.id}`)).status).toBe(200);
    expect((await s.call("GET", "/v1/botsapp/calendar?from=nope&to=2026-11-01")).status).toBe(400);
    expect((await s.call("POST", "/v1/botsapp/calendar/cant/" + t.body.task.id, U)).status).toBe(400);
  });
});

describe("a bot given the calendar", () => {
  it("is who \"Ask any bot\" picks for the calendar and to-dos, with nothing connected", async () => {
    const { scoreBots } = await import("../src/bots/door.js");
    const { builtinBots } = await import("../src/bots/builtin.js");
    const ctx = { attachments: [], recent: [], mode: "text" as const };
    for (const m of ["add dentist Friday 5 pm", "remind me to call Nani at 6", "what's on tomorrow?", "add milk to my to-do list"]) {
      expect(scoreBots(m, builtinBots(), ctx, new Set(["calendar", "tasks"]))[0]!.bot.slug).toBe("plan");
    }
  });

  it("has its tools, writes the person's own days as the bot, and Google is not offered", async () => {
    const { c } = cal({ t: Date.now() });
    const base = { catalog: async () => [{ id: "google-calendar", name: "Google Calendar", oneLine: "", connected: true }, { id: "google-docs", name: "Google Docs", oneLine: "", connected: true }], status: async (_u: string, ids: readonly string[]) => ids.map((id) => ({ id, name: id, status: "connected" as const })), tools: async () => [], use: async () => ({ kind: "stopped" as const, message: "x" }), settle: async () => undefined };
    const port = withOwnDays(base, c);
    expect((await port.catalog(U)).map((a) => a.id)).toEqual(["calendar", "tasks", "google-docs"]);
    expect(await port.status(U, ["google-calendar", "calendar", "google-docs"])).toEqual([{ id: "google-calendar", name: "Calendar", status: "connected" }, { id: "google-docs", name: "google-docs", status: "connected" }]);
    expect((await port.tools(U, "calendar")).map((t) => t.name)).toEqual(["list_events", "add_event", "change_event", "remove_event"]);

    // "add dentist Friday 5 pm" in the Plan bot's chat: the model calls add_event, the event is on the person's days, from Plan bot.
    const r = await rig((s, n) => (s.purpose === "bot.run" ? (n === 0 ? { toolCalls: [toolCall("calendar__add_event", { title: "Dentist", date: "2026-10-30", time: "17:00" })] } : "Added Dentist on Friday at 5 pm.") : "ok"), { ports: { connectors: withOwnDays(null, c) } });
    const a = await r.bots.ask(ALICE, "plan", { message: "add dentist Friday 5 pm" });
    expect(a.text).toBe("Added Dentist on Friday at 5 pm.");
    expect(a.tools).toEqual(["calendar__add_event"]);
    expect(a.notes.join(" ")).not.toMatch(/not connected/i);
    const [e] = (await c.list(ALICE, { from: "2026-10-30", to: "2026-10-30", tz: IST })).events;
    expect(e).toMatchObject({ title: "Dentist", start: ist(30, 17), from: "Plan bot", source: "bot", remindMin: 15 });
  });
});

describe("the screens", () => {
  const texts = (n: Node) => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content ?? ""));
  const calls = (n: Node) => {
    const out: string[] = [];
    const visit = (a: unknown) => {
      if (!a || typeof a !== "object") return;
      const o = a as Record<string, unknown>;
      if (o.kind === "callEndpoint") out.push(`${o.method} ${o.path}`);
      if (o.kind === "navigate") out.push(`open ${o.screenId}`);
      for (const k of ["actions", "then", "else", "onSuccess", "onError"]) { const v = o[k]; if (Array.isArray(v)) v.forEach(visit); else visit(v); }
    };
    for (const x of walk(n)) for (const v of Object.values(x.on ?? {})) visit(v);
    return out;
  };

  async function planApi() {
    const { c } = cal();
    await c.addEvent("u", { title: "Studio standup", day: "2026-10-29", time: "9:30", minutes: 30, tz: IST });
    const dentist = await c.addEvent("u", { title: "Dentist · Dr. Mehta", day: "2026-10-29", time: "18:00", minutes: 45, place: "Indiranagar", tz: IST });
    await c.landSpace("u", { taskId: "st1", spaceId: "sp1", spaceName: "Home", kind: "plan", title: "Pick up Rohan", notes: "", place: "School gate", at: ist(29, 16), end: ist(29, 16, 30), allDay: false, by: "m", name: "Meera S.", done: false });
    const cake = await c.addTask("u", { title: "Pick up the cake for Mom", day: "2026-10-29", tz: IST });
    await c.addTask("u", { title: "Renew car insurance", tz: IST });
    const read = await new PlanDays(calendarPlanReader(c), null, () => NOW, new MemoryTable()).read("u", { tz: IST, week: 0 });
    return { api: { [`GET /v1/botsapp/bots/plan?tz=${IST}&week=0`]: read }, dentist, cake, c };
  }

  it("Plan shows the person's own days with no connection, and adds, opens and ticks from there", async () => {
    const { api, dentist, cake } = await planApi();
    for (const client of ["phone", "desktop"] as const) {
      const s = await buildBotsScreen({ screenId: "bots.plan", client, params: {}, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false } }, fakeDeps({ api, now: NOW }));
      expect(lintTree(s.root!)).toEqual([]);
      const words = texts(s.root!);
      expect(words.some((w) => /google|connect/i.test(w))).toBe(false);
      expect(words).toEqual(expect.arrayContaining(["Studio standup", "Dentist · Dr. Mehta", "Pick up Rohan", "Pick up the cake for Mom", "Renew car insurance"]));
      const acts = calls(s.root!);
      expect(acts).toEqual(expect.arrayContaining(["open bots.plan.item", `PUT /v1/botsapp/calendar/tasks/${cake.id}`]));
      expect(s.liveTopics ?? []).toEqual(expect.arrayContaining(["calendar", "tasks", "bot:plan"]));
      void dentist;
    }
  });

  it("adds an event or a to-do, changes one, and answers someone else's, on both clients", async () => {
    const { c, dentist, cake } = await planApi();
    const rohan = (await c.list("u", { from: "2026-10-29", to: "2026-10-29", tz: IST })).events.find((e) => e.title === "Pick up Rohan")!;
    const build = async (client: "phone" | "desktop", params: Record<string, string>, api: Record<string, unknown> = {}) =>
      buildBotsScreen({ screenId: "bots.plan.item", client, params, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false } }, fakeDeps({ api, now: NOW }));
    for (const client of ["phone", "desktop"] as const) {
      const add = await build(client, { kind: "event", day: "2026-10-30" });
      expect(lintTree(add.root!)).toEqual([]);
      expect(texts(add.root!)).toEqual(expect.arrayContaining(["Add to your Plan", "Event", "To-do", "Remind me"]));
      expect(calls(add.root!)).toEqual(expect.arrayContaining(["POST /v1/botsapp/calendar/events", "POST /v1/botsapp/calendar/tasks"]));
      expect(add.state).toMatchObject({ kind: "event", day: "2026-10-30" });
      const ev = await build(client, { kind: "event", id: dentist.id }, { [`GET /v1/botsapp/calendar/events/${dentist.id}?tz=${IST}`]: { event: await c.event("u", dentist.id) } });
      expect(lintTree(ev.root!)).toEqual([]);
      expect(calls(ev.root!)).toEqual(expect.arrayContaining([`PUT /v1/botsapp/calendar/events/${dentist.id}`, `DELETE /v1/botsapp/calendar/events/${dentist.id}`]));
      expect(ev.state).toMatchObject({ ttl: "Dentist · Dr. Mehta", time: "18:00", mins: "45", remind: "15" });
      const td = await build(client, { kind: "task", id: cake.id }, { [`GET /v1/botsapp/calendar/tasks/${cake.id}`]: { task: await c.task("u", cake.id) } });
      expect(texts(td.root!)).toEqual(expect.arrayContaining(["Mark done"]));
      const theirs = await build(client, { kind: "event", id: rohan.id }, { [`GET /v1/botsapp/calendar/events/${rohan.id}?tz=${IST}`]: { event: rohan } });
      expect(lintTree(theirs.root!)).toEqual([]);
      expect(texts(theirs.root!)).toEqual(expect.arrayContaining(["From Meera S. · in Home", "Done", "Can't do it"]));
      expect(calls(theirs.root!)).toEqual(expect.arrayContaining(["PUT /v1/botsapp/bots/spaces/sp1/tasks/st1", `POST /v1/botsapp/calendar/cant/${rohan.id}`]));
      expect(calls(theirs.root!).some((x) => x.startsWith("PUT /v1/botsapp/calendar/events"))).toBe(false);
    }
  });
});

void HOUR; void DAY;

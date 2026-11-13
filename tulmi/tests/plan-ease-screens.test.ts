/**
 * PLAN EASE, THE SIMPLER ONE, ON THE SCREEN AND OUTSIDE THE APP (docs/plan-ease.md):
 *
 *   - the page, phone and window: the one next thing, one Needs-you card, Today and Tomorrow, See the week, one box; an older build,
 *     or the switch off, keeps the week page; no initials, lint-clean, every button through the act door
 *   - its routes: the page, the week, the box, the line; 404 plan_v2_off while the switch is off
 *   - the bootstrap: the buttons and the Android channels, only while the reminders are on
 *   - the engine: a kind's own priority, expiry, iOS loudness, and one push's own buttons
 *   - the widget: Plan Ease's line, its question in the needs spot, and a leave-by leading the lock screen
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id, email: "aanya.sharma@example.in" } : null; } };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { registerBotsBotsRoutes, AREA } = await import("../src/routes/bots/botsBots.js");
const { resetConfigForTests } = await import("../src/config.js");
const { withAppKnobs } = await import("../src/experience/appKnobs.js");
const { PushEngine } = await import("../src/push/engine.js");
const { MemoryPushStore } = await import("../src/push/store.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { glanceV2Of } = await import("../src/widgets/glance.js");
const { WIDGETS_DEFAULTS } = await import("../src/widgets/defaults.js");
const { sampleApi } = await import("./bots-bots-data.js");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
/** The boards' day (Wed 28 Oct 2026, 7:40 pm in India), and that day's clock. */
const NOW = FIXED_NOW;
const ist = (month: number, day: number, h: number, m = 0) => Date.UTC(2026, month - 1, day, h, m) - IST * MIN;
const NEW = ["BotsKit", "BotsMotion", "KitExtras", "PersonBot", "FontBricolage", "FileUpload"];

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });
/** The simpler page is the fallback now (PLAN_V2_HOME off); the threaded home is tests/plan-home-screens.test.ts. */
const simplePage = () => beforeEach(() => { vi.stubEnv("PLAN_V2_HOME", "false"); resetConfigForTests(); });

/** Plan Ease's page as GET .../plan/today answers it on the boards' day: tomorrow has a clash, the dentist has a leave-by. */
async function todayApi() {
  const c = new Calendar({ rows: memoryCalendarRows(), now: () => NOW, publish: () => undefined });
  const prefs = memoryPlanPrefs(() => NOW);
  const ease = new PlanEase({ calendar: c, prefs, skips: new MemoryTable(), now: () => NOW });
  await c.addEvent(U, { title: "Grocery run", day: "2026-10-29", time: "18:00", minutes: 60, tz: IST });
  await c.addEvent(U, { title: "Parent-teacher meeting", day: "2026-10-29", time: "18:15", minutes: 60, tz: IST, place: "Green Valley School" });
  await c.addEvent(U, { title: "Riya's birthday party", day: "2026-10-29", time: "19:30", tz: IST, place: "Koramangala" });
  await c.addTask(U, { title: "School trip fee ₹300", day: "2026-10-28", tz: IST });
  await c.addEvent(U, { title: "Standup", day: "2026-10-31", time: "10:00", tz: IST });
  const page = await ease.read(U, IST);
  const week = await ease.week(U, IST);
  return { page, week, api: { [`GET ${AREA}/plan/today?tz=${IST}`]: page, [`GET ${AREA}/plan/week?tz=${IST}`]: week } };
}

async function draw(screenId: string, client: "phone" | "desktop", o: { can?: string[]; params?: Record<string, string>; api?: Record<string, unknown> } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const s = await buildBotsScreen(
    { screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(o.can ?? NEW), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ api: { ...(await sampleApi()), ...(o.api ?? {}) }, calls, now: NOW }),
  );
  const nodes = walk(s.root!);
  return { s, nodes, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")), calls };
}

/** Every action in a tree, flattened. */
function actions(nodes: Node[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const o = a as Record<string, unknown>;
    out.push(o);
    for (const k of ["actions", "then", "else", "onSuccess", "onError"]) { const v = o[k]; if (Array.isArray(v)) v.forEach(visit); else visit(v); }
  };
  for (const n of nodes) for (const v of Object.values(n.on ?? {})) visit(v);
  return out;
}

describe("the page", () => {
  simplePage();
  it("shows the one next thing, one card, Today and Tomorrow, See the week and one box, on the phone", async () => {
    const { page, api } = await todayApi();
    expect(page.next).toMatchObject({ rung: 4, big: "Today: school trip fee ₹300" });
    expect(page.needs).toMatchObject({ type: "move", question: "Move grocery run to Fri 9 am?", reason: "It overlaps parent-teacher meeting at 6:15 pm." });
    const { s, texts, nodes } = await draw("bots.plan", "phone", { api });
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts).toEqual(expect.arrayContaining(["Plan Ease", "Today:", "Needs you", page.needs!.question, "Move it", "Keep", "Tomorrow", "See the week"]));
    expect(texts).not.toContain("Work in space");
    // The fee is the one next thing: not repeated in the list.
    expect(texts.filter((t) => t === "School trip fee ₹300")).toEqual([]);
    const field = nodes.find((n) => n.type === "TextField" && n.bind?.value === "say");
    expect(field?.props?.placeholder).toBe("Tell me anything, or add a photo");
    const acts = actions(nodes).filter((a) => a.kind === "callEndpoint");
    expect(acts.map((a) => a.path)).toEqual(expect.arrayContaining(["/v1/widgets/act", `${AREA}/plan/box`]));
    expect(acts.find((a) => a.path === "/v1/widgets/act" && (a.body as { action?: string }).action === "move")?.body).toMatchObject({ item: page.needs!.item });
    expect(s.liveTopics ?? []).toEqual(expect.arrayContaining(["bot:plan", "calendar", "tasks"]));
  });

  it("is the same page in the window, with the rest of the week on the right and no initials anywhere", async () => {
    const { api } = await todayApi();
    const { s, texts, nodes } = await draw("bots.plan", "desktop", { api });
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts).toEqual(expect.arrayContaining(["Later this week", "Sat 31", "Standup 10 am", "Needs you"]));
    expect(nodes.find((n) => n.type === "TextField" && n.bind?.value === "say")?.props?.placeholder).toBe("Tell me anything, or drop a file here");
    expect(texts.some((t) => /^[A-Z]$/.test(t))).toBe(false);
  });

  it("is the week page for an older build, and with the switch off", async () => {
    const { api } = await todayApi();
    const old = await draw("bots.plan", "phone", { can: ["BotsKit"], api });
    expect(old.calls.map((c) => c.path)).not.toContain(`${AREA}/plan/today?tz=${IST}`);
    expect(old.texts).not.toContain("See the week");
    vi.stubEnv("PLAN_V2_PAGE", "false"); resetConfigForTests();
    const off = await draw("bots.plan", "phone", { api });
    expect(off.texts).not.toContain("See the week");
  });

  it("lists the week by day, and opens a notification's map at once", async () => {
    const { api } = await todayApi();
    const week = await draw("bots.plan.week", "phone", { api });
    expect(lintTree(week.s.root!)).toEqual([]);
    // A plain list, one line a day ("Grocery run 6 pm · 1 more"); an empty day is just its date, never "Nothing yet".
    expect(week.texts).toEqual(expect.arrayContaining(["This week", "Wed 28 Oct", "Thu 29 Oct"]));
    expect(week.texts.some((t) => /^Grocery run\b/.test(t))).toBe(true);
    expect(week.texts).not.toContain("Nothing yet");
    // A day tapped: its rows.
    const one = await draw("bots.plan.week", "phone", { api, params: { day: "2026-10-29" } });
    expect(one.texts).toContain("Thu 29 Oct");
    const go = await draw("bots.plan.go", "phone", { params: { go: "map", to: "Green Valley School", mode: "driving" } });
    const appear = actions(go.nodes).find((a) => a.kind === "openUrl");
    expect(appear).toMatchObject({ url: "https://www.google.com/maps/dir/?api=1&destination=Green%20Valley%20School&travelmode=driving", handoff: true });
  });
});

describe("the page's box and a thing's details", () => {
  simplePage();
  it("answers a question under the box: what was asked, then the chat's answer in a faint message container, with Open chat", async () => {
    const { api } = await todayApi();
    const d = await draw("bots.plan", "phone", { api });
    const all = actions(d.nodes);
    const ask = all.find((a) => a.kind === "callEndpoint" && a.path === "/v1/botsapp/bots/chat/plan");
    expect(ask).toMatchObject({ body: { message: "$state.askQ" }, assignTo: "asked" });
    expect(d.nodes.some((n) => n.type === "Text" && n.bind?.content === "asked.text")).toBe(true);
    expect(d.nodes.some((n) => n.type === "Text" && n.bind?.content === "askQ")).toBe(true);
    expect(d.texts).toContain("Open chat");
  });

  it("opens an event's details: its lines, Move with the times we picked, and Take it out; a line opens the form", async () => {
    const c = new Calendar({ rows: memoryCalendarRows(), now: () => NOW, publish: () => undefined });
    const ease = new PlanEase({ calendar: c, prefs: memoryPlanPrefs(() => NOW), skips: new MemoryTable(), now: () => NOW });
    const gym = await c.addEvent(U, { title: "Gym", day: "2026-10-29", time: "18:00", minutes: 60, tz: IST, place: "Indiranagar" });
    const prep = await c.addTask(U, { title: "Pack gym bag", day: "2026-10-29", tz: IST }, { kind: "me" }, null, { prep_for: gym.id });
    const details = await ease.details(U, "event", gym.id, IST);
    expect(details.before).toEqual([expect.objectContaining({ id: prep.id, title: "Pack gym bag", done: false })]);
    expect(details.moves.length).toBeGreaterThan(0);
    expect(details.moves.length).toBeLessThanOrEqual(3);
    const event = await c.event(U, gym.id, IST);
    const d = await draw("bots.plan.item", "phone", {
      params: { kind: "event", id: gym.id },
      api: { [`GET /v1/botsapp/calendar/events/${gym.id}?tz=${IST}`]: { event }, [`GET ${AREA}/plan/details?kind=event&id=${gym.id}&tz=${IST}`]: details },
    });
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.texts).toEqual(expect.arrayContaining(["Gym", "Thu 29 Oct · 6 pm to 7 pm", "Indiranagar", "Added by you", "Pack gym bag · by tomorrow", "Move", "Take it out", details.moves[0]!.label]));
    // No per-item settings: no Remind, no How long, no chips of days.
    expect(d.texts).not.toContain("Remind me");
    expect(d.texts).not.toContain("Save");
    expect(actions(d.nodes).some((a) => a.kind === "navigate" && (a.params as Record<string, string> | undefined)?.edit === "1")).toBe(true);
    // A booked thing (a doctor) is never offered a move.
    const doc = await c.addEvent(U, { title: "Dentist", day: "2026-10-29", time: "11:00", tz: IST });
    expect((await ease.details(U, "event", doc.id, IST)).moves).toEqual([]);
  });

  it("opens a to-do's details with Done, Later and Take it out, and a wait's with Waiting on, Send and Sorted", async () => {
    const task = { id: "t-1", title: "Buy the fruit costume", notes: "", list: "", kind: "todo", due: "2026-10-29", at: null, done: false, doneAt: null, remindMin: null, from: null, source: "me", fixed: false };
    const todo = await draw("bots.plan.item", "phone", { params: { kind: "task", id: "t-1" }, api: { "GET /v1/botsapp/calendar/tasks/t-1": { task } } });
    expect(["Done", "Later", "Take it out"].every((t) => todo.texts.includes(t))).toBe(true);
    const wait = { ...task, id: "t-2", title: "The numbers", kind: "wait", who: "Rahul", notes: "Waiting on Rahul." };
    const w = await draw("bots.plan.item", "phone", { params: { kind: "task", id: "t-2" }, api: { "GET /v1/botsapp/calendar/tasks/t-2": { task: wait } } });
    expect(w.texts).toEqual(expect.arrayContaining(["Waiting on Rahul", "By Thu 29 Oct", "Send", "Sorted", "Take it out"]));
    expect(w.texts).not.toContain("Due Thu 29 Oct");
    // An older build keeps the form.
    const old = await draw("bots.plan.item", "phone", { can: ["BotsKit"], params: { kind: "task", id: "t-1" }, api: { "GET /v1/botsapp/calendar/tasks/t-1": { task } } });
    expect(old.texts).toContain("Save");
  });

  it("shows a family member's note on the person's own item as that row's grey line, with their tiny bot, in their words", async () => {
    const { page } = await todayApi();
    const row = page.days.flatMap((x) => x.rows).find((r) => r.title === "Grocery run")!;
    const look = { avatar: "pip", color: "#3a6ea5" };
    const withNote = { ...page, days: page.days.map((x) => ({ ...x, rows: x.rows.map((r) => (r.id === row.id ? { ...r, line: "Mom: I'll come with you", note: { look, name: "Mom", text: "I'll come with you" } } : r)) })) };
    const d = await draw("bots.plan", "phone", { api: { [`GET ${AREA}/plan/today?tz=${IST}`]: withNote } });
    expect(d.texts).toContain("Mom: I'll come with you");
    expect(d.nodes.some((n) => n.type === "PersonBot")).toBe(true);
  });

  it("gives an older build's Home and Today nothing of the new Plan", async () => {
    expect((await draw("bots.home", "phone")).calls.some((c) => c.path.includes("/plan/line"))).toBe(true);
    expect((await draw("bots.today", "phone")).calls.some((c) => c.path.includes("/plan/line"))).toBe(true);
    const calls = (await draw("bots.home", "phone", { can: ["BotsKit"] })).calls.map((c) => c.path);
    expect(calls.some((p) => p.includes("/plan/line"))).toBe(false);
    const today = (await draw("bots.today", "phone", { can: ["BotsKit"] })).calls.map((c) => c.path);
    expect(today.some((p) => p.includes("/plan/line"))).toBe(false);
  });
});

describe("the routes", () => {
  async function served() {
    const app = Fastify();
    registerBotsBotsRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null });
    await app.ready();
    const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${U}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { app, call };
  }

  it("answer the page, the box and its Undo, and stay shut while the switch is off", async () => {
    const { app, call } = await served();
    const page = await call("GET", `${AREA}/plan/today?tz=${IST}`);
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ v: 2, next: { big: expect.any(String) }, days: expect.any(Array) });
    const boxed = await call("POST", `${AREA}/plan/box`, { words: "Dentist tomorrow 5 pm", tz: IST });
    expect(boxed.json()).toMatchObject({ slot: "item", kind: "added", line: expect.stringMatching(/^Added: Dentist, /) });
    const undo = await call("POST", "/v1/widgets/act", { item: boxed.json().undo.item, action: "undo", key: "box-undo-0001" });
    expect(undo.json()).toMatchObject({ ok: true, state: "undone" });
    expect((await call("GET", `${AREA}/plan/line?tz=${IST}`)).statusCode).toBe(200);
    vi.stubEnv("PLAN_V2_PAGE", "false"); resetConfigForTests();
    const off = await call("GET", `${AREA}/plan/today?tz=${IST}`);
    expect(off.statusCode).toBe(404);
    expect(off.json()).toMatchObject({ code: "plan_v2_off" });
    await app.close();
  });
});

describe("the bootstrap", () => {
  it("lists Plan Ease's buttons and Android channels, only while its reminders are on", () => {
    const on = withAppKnobs({ labels: {}, flags: {} });
    const cats = on.flags["push.categories"] as Array<{ id: string; actions: Array<{ id: string; act?: string; open?: boolean }> }>;
    expect(cats.map((c) => c.id)).toEqual(expect.arrayContaining(["x0_reply", "x0_task", "x0_todo", "x0_leave", "x0_move"]));
    expect(cats.find((c) => c.id === "x0_todo")!.actions.map((a) => [a.id, a.act])).toEqual([["p_done", "done"], ["p_later", "later"]]);
    expect(cats.find((c) => c.id === "x0_leave")!.actions[0]).toMatchObject({ id: "p_map", open: true });
    const chans = on.flags["push.android.channels"] as Array<{ id: string; importance: string }>;
    expect(chans).toEqual(expect.arrayContaining([expect.objectContaining({ id: "plan_reminders", importance: "high" }), expect.objectContaining({ id: "plan_notes", importance: "default" })]));
    vi.stubEnv("PLAN_V2_REMINDERS", "false"); resetConfigForTests();
    const off = withAppKnobs({ labels: {}, flags: {} });
    expect((off.flags["push.categories"] as Array<{ id: string }>).map((c) => c.id)).not.toContain("x0_todo");
    expect(off.flags["push.android.channels"]).toEqual([]);
  });
});

describe("the engine", () => {
  it("sends a kind with its own priority, expiry and loudness, and one push with its own buttons", async () => {
    const store = new MemoryPushStore();
    store.candidatesList = [{ userId: U, tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: NOW - DAY }], lastSeenAt: NOW - DAY, createdAt: NOW - 60 * DAY, locale: null, entitled: false, tzOffsetMin: IST }];
    const sent: Array<Array<Record<string, unknown>>> = [];
    const sender = { send: async (m: unknown[]) => { sent.push(m as Array<Record<string, unknown>>); return m.map((_x, i) => ({ status: "ok" as const, id: `t${i}` })); }, receipts: async () => ({}) };
    const engine = new PushEngine(store, sender, () => structuredClone(PUSH_DEFAULTS), { info: () => undefined, warn: () => undefined });
    await engine.notify(U, { kind: "plan_morning", key: "morning:2026-10-29", vars: { title: "Today: leave by 8:10 am", body: "School drop 8:30." } }, NOW);
    expect(sent[0]![0]).toMatchObject({ priority: "normal", interruptionLevel: "passive", ttl: 240 * 60, channelId: "plan_notes", title: "Today: leave by 8:10 am" });
    await engine.notify(U, { kind: "plan_evening", key: "evening:2026-10-30", vars: { title: "Tomorrow: standup at 9 am", body: "Move the gym to Sat 11 am?" }, data: { item: "pm:abc:1761800000000" }, category: "x0_move" }, NOW);
    expect(sent[1]![0]).toMatchObject({ categoryId: "x0_move", data: expect.objectContaining({ item: "pm:abc:1761800000000", kind: "plan_evening" }) });
    await engine.notify(U, { kind: "plan_leave", key: "leave:e:1", vars: { title: "Leave by 5:30 pm for dentist", body: "30 min drive" }, data: { go: "map", to: "Indiranagar" } }, NOW);
    expect(sent[2]![0]).toMatchObject({ priority: "high", categoryId: "x0_leave", ttl: 20 * 60, data: expect.objectContaining({ screenId: "bots.plan.go", to: "Indiranagar" }) });
  });
});

describe("the widget", () => {
  const input = (plan: Parameters<typeof glanceV2Of>[0]["plan"]) => ({
    now: NOW, tz: IST, hg: false, name: "Aanya", bots: [], jobs: [], tasks: [], minutesSaved: 0,
    state: { seen: {}, all: 0, sinceAt: NOW - 5 * HOUR }, plan,
  });

  it("says Plan Ease's line, asks its one question with its buttons, and lets a leave-by lead the lock screen", () => {
    const line = { line: "Next: Appointment 6 pm", lock: { inline: "Next: Appointment 6:00", title: "Appointment at 6 pm", line: "Today" }, leads: false };
    const quiet = glanceV2Of(input({ line, needs: null }), structuredClone(WIDGETS_DEFAULTS));
    expect(quiet.bots.find((b) => b.slug === "plan")?.line).toBe("Next: Appointment 6 pm");
    expect(quiet.lock.inline).toBe("Next: Appointment 6:00");
    const asking = glanceV2Of(input({ line, needs: { item: "pm:abc:1761800000000", question: "Move the gym to Sat 11 am?", buttons: [{ id: "move", label: "Move it", primary: true }, { id: "keep", label: "Keep" }], until: NOW + HOUR } }), structuredClone(WIDGETS_DEFAULTS));
    expect(asking.case).toBe("needs");
    expect(asking.needs.items[0]).toMatchObject({ id: "pm:abc:1761800000000", kind: "plan", question: "Move the gym to Sat 11 am?", choices: [{ id: "move", label: "Move it", primary: true }, { id: "keep", label: "Keep" }] });
    const leaving = glanceV2Of(input({ line: { line: "PTM 9:30, leave 9:00", lock: { inline: "Leave by 9:00 · PTM", title: "Leave by 9 am", line: "PTM at Green Valley, 9:30 am" }, leads: true }, needs: null }), structuredClone(WIDGETS_DEFAULTS));
    expect(leaving.lock).toEqual({ inline: "Leave by 9:00 · PTM", title: "Leave by 9 am", line: "PTM at Green Valley, 9:30 am" });
  });
});

void ist;

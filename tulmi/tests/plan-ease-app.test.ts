/**
 * PLAN EASE, THE APP RELEASE (PLAN_V2_APP; design B11, B13; docs/plan-ease.md "The app release"): what only a newer binary can use,
 * each sent only to the build that says it can.
 *
 *   - a phone's token keeps what its binary can do (caps); a leave-by and a bill due today are Time Sensitive only on a phone with
 *     the entitlement, and Apple's own level on the rest
 *   - a desktop in use shows Plan Ease's notices (live/notices.ts): who is at a computer is kept per socket, in memory; the phone's
 *     copy is then silent; with no phone at all the computer still hears it; "What pings you" decides once for both; an answer
 *     anywhere takes the notice off; only a socket that shows notices hears their words
 *   - the bootstrap tells a desktop that can show notices, and one that can carry "add this", and gives it the "add this" words
 *   - the one box reads what "add this" saw: one clear line is added as typed, a notice with several things becomes the capture card
 *   - the widget's steps: Plan Ease's line from each moment it changes, with the lock words for that moment
 */
process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";

const { MemoryPushTokens, registerPushTokenRoutes, pushCapsOf } = await import("../src/push/tokens.js");
const { MemoryPushStore } = await import("../src/push/store.js");
const { PushEngine, setPushGate } = await import("../src/push/engine.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { planKind } = await import("../src/botsBots/planKinds.js");
const { live, LiveBus } = await import("../src/live/bus.js");
const { openSeat, deskHere, resetSeatsForTests, noticeIdOf, HERE_MS, NOTICE_TOPIC } = await import("../src/live/notices.js");
const { registerLiveRoutes, LIVE_PATH } = await import("../src/routes/app/live.js");
const { QuickActs, MemoryQuickActionStore, ok } = await import("../src/widgets/act.js");
const { buildBootstrap } = await import("../src/experience/bootstrap/bootstrap.js");
const { desktopLists, DESKTOP_ADD_THIS, DESKTOP_ROUTER } = await import("../src/experience/appLists.js");
const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanCapture, memoryCaptureStore, setPlanCapture } = await import("../src/botsBots/planCapture.js");
const { seenOf, seenLine } = await import("../src/botsBots/planInBox.js");
const { widgetSteps, widgetLine, WIDGET_STEPS_MAX } = await import("../src/botsBots/planDay.js");
const { glanceSteps } = await import("../src/widgets/glance.js");
const { resetConfigForTests } = await import("../src/config.js");

const MIN = 60_000, HOUR = 60 * MIN;
const IST = 330;
const ist = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const NOW = ist(12, 17, 20);
const quiet = { info: () => {}, warn: () => {} };

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); resetSeatsForTests(); setPushGate(null); setPlanCapture(null); });

type Sent = Array<{ to: string; sound?: unknown; interruptionLevel?: string; categoryId?: string; data?: Record<string, unknown> }>;
function engineRig(tokens: Array<{ platform: "ios" | "android"; token: string; caps?: string[] }>) {
  const store = new MemoryPushStore();
  store.candidatesList = tokens.length
    ? [{ userId: U, tokens: tokens.map((t, i) => ({ ...t, updatedAt: NOW - i })), lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: IST }]
    : [];
  const sent: Sent[] = [];
  const sender = { send: async (m: Sent) => { sent.push(m); return m.map((_x, i) => ({ status: "ok" as const, id: `t${i}` })); }, receipts: async () => ({}) };
  const engine = new PushEngine(store, sender as never, () => structuredClone(PUSH_DEFAULTS), quiet);
  return { store, sent, engine };
}
/** What the computers heard, through the bus the server uses. */
function notices(): { got: Array<Record<string, unknown>>; stop: () => void } {
  const got: Array<Record<string, unknown>> = [];
  const stop = live.subscribe(U, (e) => { if (e.topic === NOTICE_TOPIC) got.push(e.data ?? {}); });
  return { got, stop };
}
const leave = { kind: "plan_leave" as const, key: "e1:1", vars: { title: "Leave by 5:30 pm for the dentist", body: "30 min drive" }, data: { item: "pe:e1:2026-11-12" } };
const todo = { kind: "plan_todo" as const, key: "t1:1", vars: { title: "Call the bank", body: "Now" }, data: { item: "pt:t1" } };

// ===================================================================== Time Sensitive

describe("a phone's token and Time Sensitive", () => {
  it("keeps only the caps this server reads, and keeps the token whatever the app sends", async () => {
    expect(pushCapsOf(["PushTimeSensitive", "SomethingNew", 3])).toEqual(["PushTimeSensitive"]);
    expect(pushCapsOf("PushTimeSensitive")).toEqual([]);
    // The two names the native-looks work added. pushCapsOf FILTERS against PUSH_CAPS, so without the name here the
    // register route drops it and devicesWith / everyoneWith would find no phone at all.
    expect(pushCapsOf(["LiveUpdate1", "NativeLook1"])).toEqual(["LiveUpdate1", "NativeLook1"]);
    const tokens = new MemoryPushTokens();
    const app = Fastify();
    registerPushTokenRoutes(app, { resolveUser: async (a) => (a ? { id: U } : null), tokens: () => tokens });
    const post = (body: unknown) => app.inject({ method: "POST", url: "/v1/push/register", headers: { authorization: "Bearer x" }, payload: body as object });
    expect((await post({ token: "ExponentPushToken[a]", platform: "ios", caps: ["PushTimeSensitive", "Later"] })).statusCode).toBe(200);
    expect(tokens.rows[0]).toMatchObject({ token: "ExponentPushToken[a]", caps: ["PushTimeSensitive"] });
    // An older app sends none, and a newer one may send a shape this server doesn't read: the phone is still reached.
    expect((await post({ token: "ExponentPushToken[b]", platform: "android" })).statusCode).toBe(200);
    expect((await post({ token: "ExponentPushToken[c]", platform: "ios", caps: { odd: true } })).statusCode).toBe(200);
    expect(tokens.rows.map((r) => r.caps)).toEqual([[], []]);
    await app.close();
  });

  it("marks a leave-by and a bill due today, and sends it only to a phone with the entitlement", async () => {
    expect(planKind("plan_leave")?.interruptionLevel).toBe("time-sensitive");
    expect(planKind("plan_due")?.interruptionLevel).toBe("time-sensitive");
    expect(planKind("plan_todo")?.interruptionLevel).toBeUndefined();
    const r = engineRig([{ platform: "ios", token: "ExponentPushToken[new]", caps: ["PushTimeSensitive"] }, { platform: "ios", token: "ExponentPushToken[old]" }]);
    await r.engine.notify(U, leave, NOW);
    expect(r.sent[0]!.map((m) => m.interruptionLevel)).toEqual(["time-sensitive", undefined]);
    // The morning note stays passive everywhere; a to-do has no level of its own.
    await r.engine.notify(U, { kind: "plan_morning", key: "2026-11-13", vars: { title: "Today: leave by 8:10 am", body: "School drop 8:30." } }, NOW);
    expect(r.sent[1]!.map((m) => m.interruptionLevel)).toEqual(["passive", "passive"]);
    await r.engine.notify(U, todo, NOW);
    expect(r.sent[2]!.map((m) => m.interruptionLevel)).toEqual([undefined, undefined]);
  });

  it("never breaks through Focus in the person's quiet hours: a time-sensitive kind goes as an ordinary one, without a sound", async () => {
    setPushGate(async () => "silent");
    const r = engineRig([{ platform: "ios", token: "ExponentPushToken[new]", caps: ["PushTimeSensitive"] }]);
    await r.engine.notify(U, leave, NOW);
    expect(r.sent[0]![0]).toMatchObject({ interruptionLevel: "active", sound: null });
    await r.engine.notify(U, { kind: "plan_morning", key: "2026-11-13", vars: { title: "Today: leave by 8:10 am", body: "School drop 8:30." } }, NOW);
    expect(r.sent[1]![0]!.interruptionLevel).toBe("passive");
  });

  it("is Apple's own level for everyone with the app release switched off", async () => {
    vi.stubEnv("PLAN_V2_APP", "false"); resetConfigForTests();
    const r = engineRig([{ platform: "ios", token: "ExponentPushToken[new]", caps: ["PushTimeSensitive"] }]);
    await r.engine.notify(U, leave, NOW);
    expect(r.sent[0]![0]!.interruptionLevel).toBeUndefined();
  });
});

// ===================================================================== a computer in use

describe("who is at a computer", () => {
  it("is a socket that shows notices, used in the last 10 minutes, and not locked or asleep", () => {
    const sock = {};
    expect(deskHere(U, NOW)).toBe(false);
    const seat = openSeat(U, sock, { buttons: true });
    expect(deskHere(U, NOW)).toBe(false);
    seat.here(2 * MIN, NOW);
    expect(deskHere(U, NOW)).toBe(true);
    expect(deskHere(U, NOW - 2 * MIN + HERE_MS + 1)).toBe(false);
    seat.here(null, NOW);
    expect(deskHere(U, NOW)).toBe(false);
    seat.here(0, NOW);
    seat.close();
    expect(deskHere(U, NOW)).toBe(false);
  });

  it("is told over the live socket after sign-in, and only that socket hears a notice's words", async () => {
    const bus = new LiveBus();
    const app: FastifyInstance = Fastify();
    await app.register(websocket);
    registerLiveRoutes(app, { bus, resolve: async (a) => (a === "Bearer token-a" ? { id: U } : null), rateLimit: { max: 1000, timeWindow: 60_000 } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}${LIVE_PATH}`;
    const open = async () => {
      const ws = new WebSocket(url);
      const got: Array<Record<string, unknown>> = [];
      ws.on("message", (d) => got.push(JSON.parse(String(d))));
      await new Promise((r) => ws.once("open", r));
      ws.send(JSON.stringify({ type: "auth", token: "token-a" }));
      return { ws, got };
    };
    const until = async (fn: () => boolean) => { const end = Date.now() + 1500; while (!fn()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };
    try {
      // Before sign-in it says nothing that counts.
      const desk = await open();
      await until(() => desk.got.some((m) => m.type === "ready"));
      const phone = await open();
      await until(() => phone.got.some((m) => m.type === "ready"));
      desk.ws.send(JSON.stringify({ type: "notices", v: 1, buttons: true }));
      desk.ws.send(JSON.stringify({ type: "here", idleMs: 1000 }));
      await until(() => deskHere(U));
      bus.publish([U], NOTICE_TOPIC, { id: "pt:t1", title: "Call the bank", body: "Now" });
      bus.publish([U], "bot:plan");
      await until(() => phone.got.some((m) => m.topic === "bot:plan") && desk.got.some((m) => m.topic === "bot:plan"));
      expect(desk.got.filter((m) => m.topic === NOTICE_TOPIC)).toHaveLength(1);
      expect(phone.got.filter((m) => m.topic === NOTICE_TOPIC)).toHaveLength(0);
      desk.ws.send(JSON.stringify({ type: "here", away: true }));
      await until(() => !deskHere(U));
      desk.ws.send(JSON.stringify({ type: "here", idleMs: 0 }));
      await until(() => deskHere(U));
      desk.ws.close();
      await until(() => !deskHere(U));
      phone.ws.close();
    } finally { await app.close(); }
  });
});

describe("Plan Ease's notices", () => {
  it("go to the computer in use with the push's lock-safe words and buttons, and the phone's copy makes no sound", async () => {
    const r = engineRig([{ platform: "android", token: "ExponentPushToken[a]" }]);
    openSeat(U, {}, { buttons: true }).here(0, NOW);
    const heard = notices();
    await r.engine.notify(U, todo, NOW);
    heard.stop();
    expect(heard.got).toHaveLength(1);
    const n = heard.got[0]!;
    expect(n).toMatchObject({ id: "pt:t1", kind: "plan_todo", title: "Call the bank", body: "Now", screenId: "bots.plan", item: "pt:t1", category: "x0_todo", silent: false });
    // The push's own id comes back with a click, so an opened note counts on the computer too.
    expect(n.params).toMatchObject({ kind: "plan_todo", item: "pt:t1" });
    expect(typeof (n.params as Record<string, unknown>).pushId).toBe("string");
    expect(n.until).toBe(NOW + 12 * 60 * MIN);
    expect(r.sent[0]![0]!.sound).toBeNull();
  });

  it("reach the computer with no phone at all, and are claimed once", async () => {
    const r = engineRig([]);
    expect(await r.engine.notify(U, todo, NOW)).toBeNull();
    openSeat(U, {}, { buttons: false }).here(0, NOW);
    const heard = notices();
    expect(await r.engine.notify(U, todo, NOW)).toMatchObject({ sent: true });
    expect(await r.engine.notify(U, todo, NOW)).toBeNull();
    heard.stop();
    expect(heard.got).toHaveLength(1);
    expect(r.sent).toHaveLength(0);
    expect(r.store.rows[0]).toMatchObject({ kind: "plan_todo", status: "sent" });
  });

  it("follow What pings you once for both: dropped is neither, quiet hours make both silent", async () => {
    const r = engineRig([{ platform: "ios", token: "ExponentPushToken[a]" }]);
    openSeat(U, {}, { buttons: true }).here(0, NOW);
    const heard = notices();
    setPushGate(() => "drop");
    expect(await r.engine.notify(U, todo, NOW)).toBeNull();
    setPushGate(() => "silent");
    await r.engine.notify(U, { ...todo, key: "t1:2" }, NOW);
    heard.stop();
    expect(heard.got).toEqual([expect.objectContaining({ id: "pt:t1", silent: true })]);
    expect(r.sent).toHaveLength(1);
  });

  it("are only Plan Ease's, and none with the app release off", async () => {
    const r = engineRig([{ platform: "ios", token: "ExponentPushToken[a]" }]);
    openSeat(U, {}, { buttons: true }).here(0, NOW);
    const heard = notices();
    await r.engine.notify(U, { kind: "approval", key: "x1", vars: { app: "Gmail" }, data: { taskId: "x1" } }, NOW);
    vi.stubEnv("PLAN_V2_APP", "false"); resetConfigForTests();
    await r.engine.notify(U, todo, NOW);
    heard.stop();
    expect(heard.got).toEqual([]);
    expect(r.sent.map((m) => m[0]!.sound)).toEqual(["default", "default"]);
  });

  it("go when answered anywhere, and a notice with no item has its own claim's id", async () => {
    expect(noticeIdOf(null, "plan_evening:2026-11-12")).toBe("plan_evening:2026-11-12");
    expect(noticeIdOf(undefined, "a b|c")).toBe("a-b-c");
    const acts = new QuickActs({
      spaceTasks: null, threads: null, approvals: null, jobs: null,
      plan: { scope: () => "task.done", act: async () => ok("done") },
    }, new MemoryQuickActionStore(), () => NOW);
    const heard = notices();
    await acts.run(U, { item: "pt:t1", action: "done", key: "k-0000001" }, { kind: "session" }, { inPlaceRisks: [], modes: {}, tokenEnabled: true });
    heard.stop();
    expect(heard.got).toEqual([{ id: "pt:t1", gone: true }]);
  });
});

// ===================================================================== the bootstrap

describe("the bootstrap", () => {
  const flagsOf = (o: Parameters<typeof buildBootstrap>[0]) => (buildBootstrap(o).flags ?? {}) as Record<string, unknown>;

  it("tells a desktop that shows notices, and one that carries add this, and gives it the words", () => {
    const f = flagsOf({ formFactor: "desktop", deskNotices: true, deskAddThis: true });
    expect(f["desktop.notices.enabled"]).toBe(true);
    expect(f["desktop.plan.addThis"]).toBe(true);
    const tasks = f["desktop.router.tasks"] as Array<{ slug: string; re: string }>;
    for (const t of DESKTOP_ADD_THIS.tasks) expect(tasks).toContainEqual(t);
    // After Plan Ease's own, before the next bot's, as the desktop's own list has them.
    const at = tasks.findIndex((t) => t.re === DESKTOP_ADD_THIS.tasks[0].re);
    expect(tasks[at - 1]!.slug).toBe("plan");
    expect(tasks[at + DESKTOP_ADD_THIS.tasks.length]!.slug).not.toBe("plan");
    expect(f["desktop.router.pointsAt"]).toEqual(DESKTOP_ADD_THIS.pointsAt);
    expect(f["desktop.router.notThings"]).toEqual(DESKTOP_ADD_THIS.notThings);
    // The same buttons the phone registers, for a Mac's notices.
    const cats = (f["push.categories"] as Array<{ id: string }>).map((c) => c.id);
    expect(cats).toEqual(expect.arrayContaining(["x0_todo", "x0_leave", "x0_move", "x0_due", "x0_claim"]));
  });

  it("tells an older desktop, a phone, or anyone with the switch off nothing new", () => {
    const old = flagsOf({ formFactor: "desktop" });
    expect(old["desktop.notices.enabled"]).not.toBe(true);
    expect(old["desktop.plan.addThis"]).not.toBe(true);
    expect(old["desktop.router.tasks"]).toEqual(DESKTOP_ROUTER.tasks);
    expect(old["desktop.router.pointsAt"]).toBeUndefined();
    expect(desktopLists()["desktop.router.tasks"]).toEqual(DESKTOP_ROUTER.tasks);
    const phone = flagsOf({ deskNotices: true, deskAddThis: true });
    expect(phone["desktop.notices.enabled"]).not.toBe(true);
    expect(phone["desktop.plan.addThis"]).not.toBe(true);
    vi.stubEnv("PLAN_V2_APP", "false"); resetConfigForTests();
    const off = flagsOf({ formFactor: "desktop", deskNotices: true, deskAddThis: true });
    expect(off["desktop.notices.enabled"]).not.toBe(true);
    expect(off["desktop.plan.addThis"]).not.toBe(true);
    vi.stubEnv("PLAN_V2_APP", "true"); vi.stubEnv("PLAN_V2_CAPTURE", "false"); resetConfigForTests();
    expect(flagsOf({ formFactor: "desktop", deskAddThis: true })["desktop.plan.addThis"]).not.toBe(true);
  });
});

// ===================================================================== "add this"

function boxRig(t0: number) {
  const clock = { t: t0 };
  const c = new Calendar({ rows: memoryCalendarRows(), now: () => clock.t, publish: () => undefined });
  const prefs = memoryPlanPrefs(() => clock.t);
  const ease = new PlanEase({ calendar: c, prefs, skips: new MemoryTable(), now: () => clock.t, send: async () => undefined });
  ease.attach();
  return { clock, c, prefs, ease };
}

describe("the box reads what add this saw", () => {
  it("takes only what it can read", () => {
    expect(seenOf({ from: "selection", text: "  Team offsite 14 Nov 10 am  ", app: "Mail", title: "Re: offsite" })).toEqual({ from: "selection", text: "Team offsite 14 Nov 10 am", app: "Mail", title: "Re: offsite" });
    expect(seenOf({ from: "clipboard", text: "x" })).toBeNull();
    expect(seenOf({ from: "page", text: "   " })).toBeNull();
    expect(seenOf({ from: "screen", text: "a".repeat(20_000) })!.text).toHaveLength(12_000);
    // The words say when; what was seen says what.
    expect(seenLine({ from: "selection", text: "Call the bank" }, "remind me about this on Friday at 5 pm")).toBe("remind me Call the bank on Friday at 5 pm");
    expect(seenLine({ from: "page", text: "Line one\nLine two\nLine three of the circular" }, "add this")).toBeNull();
  });

  it("adds one clear thing as if typed, with Undo", async () => {
    const r = boxRig(ist(12, 16));
    const one = await r.ease.box(U, "add this to my calendar", IST, { from: "selection", text: "Team offsite on Saturday at 10 am" });
    expect(one).toMatchObject({ kind: "added", line: "Added: Team offsite, Sat 14 Nov, 10 am" });
    expect(one.undo?.item).toMatch(/^pe:/);
    const later = await r.ease.box(U, "remind me about this on Friday", IST, { from: "selection", text: "Call the bank" });
    expect(later).toMatchObject({ kind: "added", line: "Added: Call the bank, tomorrow" });
    // A bill said on the screen is a bill, never with its amount outside the app.
    const bill = await r.ease.box(U, "add this", IST, { from: "selection", text: "Electricity 2140 due 14th" });
    expect(bill.kind).toBe("added");
  });

  it("makes a notice with several things the capture card, and leaves it to the chat without capture", async () => {
    const r = boxRig(ist(12, 16));
    const circular = { from: "page", text: "Dear parents,\nDress-up day on Fri 13 Nov: fruits.\nField trip money Rs 300 by Wed 11 Nov.\nPTM Sat 14 Nov 9:30 am." };
    expect(await r.ease.box(U, "add this", IST, circular)).toMatchObject({ kind: "chat" });
    // Nothing readable seen: the words alone would add "this", so they go as before.
    expect(await r.ease.box(U, "add this", IST, { from: "clipboard", text: "x" })).toMatchObject({ kind: "chat" });
    const capture = new PlanCapture({
      calendar: r.c, prefs: r.prefs, store: memoryCaptureStore(), now: () => r.clock.t, tzOf: async () => IST, usdInr: () => 100,
      aiOk: async () => false,
      readers: { text: async () => ({ text: "{}", usd: 0 }), picture: async () => ({ text: "{}", usd: 0 }), glance: async () => ({ text: "no", usd: 0 }) },
    });
    setPlanCapture(capture);
    const card = await r.ease.box(U, "add this", IST, circular);
    expect(card).toMatchObject({ slot: "seen", kind: "capture", open: { screen: expect.any(String), params: { id: card.capture } } });
    // Without their yes to AI nothing goes to AI: the rules find its dated lines at once. What was on the screen is not kept.
    const view = await capture.view(U, card.capture!);
    expect(view.state).toBe("ready");
    expect(view.rows.map((x) => x.title)).toEqual(["Dress-up day · fruits", "PTM"]);
    const [row] = await capture.store.select({ id: card.capture! });
    expect(row!.words ?? null).toBeNull();
    expect(JSON.stringify(row)).not.toContain("Dear parents");
  });

  it("never keeps what was seen with a yes to AI either: read from memory, and only the things found are kept", async () => {
    const r = boxRig(ist(12, 16));
    const circular = { from: "page", text: "Dear parents,\nDress-up day on Fri 13 Nov: fruits.\nField trip money Rs 300 by Wed 11 Nov.\nPTM Sat 14 Nov 9:30 am." };
    let inserted: unknown = null;
    const store = memoryCaptureStore();
    const insert = store.insert.bind(store);
    store.insert = async (row) => { inserted = JSON.parse(JSON.stringify(row)); return insert(row); };
    const capture = new PlanCapture({
      calendar: r.c, prefs: r.prefs, store, now: () => r.clock.t, tzOf: async () => IST, usdInr: () => 100, aiOk: async () => true,
      readers: {
        text: async () => ({ text: JSON.stringify({ label: "school circular", items: [{ kind: "event", title: "PTM", day: "2026-11-14", time: "09:30", sure: 0.9 }] }), usd: 0.001 }),
        picture: async () => ({ text: "{}", usd: 0 }), glance: async () => ({ text: "no", usd: 0 }),
      },
    });
    setPlanCapture(capture);
    const card = await r.ease.box(U, "add this", IST, circular);
    expect(JSON.stringify(inserted)).not.toContain("Dear parents");
    await capture.settled(card.capture!);
    const [row] = await store.select({ id: card.capture! });
    expect(row).toMatchObject({ state: "ready" });
    expect(row!.words ?? null).toBeNull();
    expect(JSON.stringify(row)).not.toContain("Dear parents");
  });

  it("is as before when nothing was seen", async () => {
    const r = boxRig(ist(12, 16));
    expect(await r.ease.box(U, "Dentist Fri 5 pm", IST)).toMatchObject({ slot: "item", kind: "added" });
  });
});

// ===================================================================== the widget's steps

describe("the widget's steps", () => {
  const day = (now: number) => ({
    now, tz: IST, today: "2026-11-12", tomorrow: "2026-11-13",
    items: [
      { id: "e1", ref: "event", kind: "event", day: "2026-11-12", title: "Dentist · Dr. Mehta", start: ist(12, 18), end: ist(12, 18, 45), where: "Indiranagar", done: false },
      { id: "e2", ref: "event", kind: "event", day: "2026-11-13", title: "Parent-teacher meeting", start: ist(13, 9, 30), end: ist(13, 10, 30), where: "School", done: false },
    ] as never,
    leaves: new Map([["e1", { leaveBy: ist(12, 17, 30), minutes: 30, mode: "drive", to: "Indiranagar" }]]) as never,
  });

  it("say the line from each moment it changes, lock-safe, with the leave-by leading its last 2 hours", () => {
    const steps = widgetSteps(day(ist(12, 14)));
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.length).toBeLessThanOrEqual(WIDGET_STEPS_MAX);
    expect(steps.map((s) => s.at)).toEqual([...steps.map((s) => s.at)].sort((a, b) => a - b));
    expect(steps[0]).toMatchObject({ at: ist(12, 15, 30), widget: { leads: true } });
    const after = steps.find((s) => s.at === ist(12, 17, 30))!;
    expect(after.widget).toMatchObject({ leads: false, line: "Next: Appointment 6 pm" });
    const words = JSON.stringify(steps);
    expect(words).not.toMatch(/Dentist|Mehta|Indiranagar|₹/);
    // Each step is what widgetLine says at that moment: nothing the widget would say twice in a row.
    for (let i = 1; i < steps.length; i++) expect(JSON.stringify(steps[i]!.widget)).not.toBe(JSON.stringify(steps[i - 1]!.widget));
    expect(widgetLine(day(ist(12, 14)))?.leads).toBe(false);
  });

  it("carry the lock words by the glance's rule: the plan's while it leads or all is quiet, else the glance's own", () => {
    const later = widgetSteps(day(ist(12, 14)));
    const base = { lock: { inline: "1 working", title: "Xode is working", line: "Step 2 of 5" }, bots: [{ slug: "plan", line: "Ready" }] } as never;
    const working = glanceSteps({ case: "working" }, base, later);
    expect(working[0]).toMatchObject({ bot: "plan", lock: { title: "Leave by 5:30 pm" } });
    expect(working.find((s) => s.at === ist(12, 17, 30))!.lock).toEqual({ inline: "1 working", title: "Xode is working", line: "Step 2 of 5" });
    const quietSteps = glanceSteps({ case: "quiet" }, base, later);
    expect(quietSteps.find((s) => s.at === ist(12, 17, 30))!.lock?.title).toBe("Appointment at 6 pm");
    // Nothing left to say: the row goes back to its own idle line.
    expect(glanceSteps({ case: "quiet" }, base, [{ at: 1, widget: null }])[0]).toMatchObject({ line: "Ready" });
  });
});

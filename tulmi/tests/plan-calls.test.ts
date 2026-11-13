/**
 * "X0 IS CALLING" (BOT_CALLS; botsBots/planCall.ts, planCallWords.ts, routes/bots/planCalls.ts, screens/bots/planCall.ts; docs/plan-ease.md
 * "Calls"): a leave-by or a bill due today rings a phone whose JS takes calls instead of the push.
 *
 *   - the words: the opening line, the missed call, what is said aloud, when the person is done, the limits
 *   - the engine: an eligible push becomes a ring (exactly the contract's message), and every "never call when" sends the push as today
 *   - the timers: ring 2, the missed call (after a restart too), no ring after the window, one missed push however many timers
 *   - the doors: answer (in the window, in the grace, too late), decline, end, Call back, a turn by voice, the voice itself
 *   - Activity, the settings, What pings you, the bootstrap's buttons, and the call screen's modes
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const W = await import("../src/botsBots/planCallWords.js");
const { PlanCalls, memoryCallTable, setPlanCalls, callTokens, BACK_MAX, RING_MS, RING2_MS, GRACE_MS, TALK_IDLE_MS, MAX_TURNS, CALLS } = await import("../src/botsBots/planCall.js");
const { MemoryPushStore, tokenHash } = await import("../src/push/store.js");
const { PushEngine, setPushGate, setCallHook } = await import("../src/push/engine.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { pushCapsOf } = await import("../src/push/tokens.js");
const { CALL_CATEGORIES, CALL_KIND_IDS, PLAN_PUSH_KINDS } = await import("../src/botsBots/planKinds.js");
const { callsOn } = await import("../src/botsBots/planSwitch.js");
const { verdict } = await import("../src/you/push.js");
const { DEFAULT_SETTINGS, cleanSettings, applyPatch, withCleared } = await import("../src/you/settings.js");
const { feedOf, filterFeed, weekOf } = await import("../src/shell/feed.js");
const { resetConfigForTests } = await import("../src/config.js");
const { openSeat, resetSeatsForTests } = await import("../src/live/notices.js");
const { minuteOf } = await import("../src/calendar/words.js");
const { registerPlanCallRoutes } = await import("../src/routes/bots/planCalls.js");
const { defaultGuard } = await import("../src/guard/index.js");
const { installAiCheck } = await import("../src/privacy/aiGate.js");
const { dueReminder } = await import("../src/botsBots/planDue.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { updatePersonality } = await import("../src/personality/store.js");
const { withAppKnobs } = await import("../src/experience/appKnobs.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { registerBotsShellRoutes } = await import("../src/routes/bots/botsShell.js");
const { MemoryEventStore } = await import("../src/shell/events.js");

type CallRow = import("../src/botsBots/planCall.js").CallRow;
type CallTable = import("../src/botsBots/planCall.js").CallTable;
type CallSeed = import("../src/botsBots/planCallWords.js").CallSeed;
type CallView = import("../src/botsBots/planCallWords.js").CallView;
type Token = import("../src/push/store.js").Token;
type PushMessage = import("../src/push/expo.js").PushMessage;
type PushPayload = import("../src/push/defaults.js").PushPayload;

const MIN = 60_000, HOUR = 60 * MIN;
const IST = 330;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const U2 = "bbbbbbbb-0000-4000-8000-000000000002";
/** 4:55 pm on Thursday 12 November: ten minutes before the leave-by. */
const NOW = ist(12, 16, 55);
const quiet = { info: () => {}, warn: () => {} };

const SEED: CallSeed = {
  source: "leave", item: "pe:ev1:2026-11-12", eventId: "ev1", day: "2026-11-12", tz: IST, title: "Parent-teacher meeting",
  place: "Green Valley School", start: ist(12, 17, 30), leaveBy: ist(12, 17, 5), minutes: 25, mode: "drive",
};
const BILL: CallSeed = { source: "due", item: "pt:t1", taskId: "t1", day: "2026-11-12", tz: IST, title: "Electricity bill ₹2,340", payee: "BESCOM", pay: true };
const LINE = "Leave by 5:05 pm for parent-teacher meeting";
const MORE = "25 min drive to Green Valley School";
const leaveMsg = (o: Record<string, unknown> = {}) => ({
  kind: "plan_leave" as const, key: `leave:ev1:${SEED.start}`, vars: { title: LINE, body: MORE },
  data: { day: "2026-11-12", go: "map", to: "Green Valley School", mode: "driving" }, call: SEED, ...o,
});
const dueMsg = (o: Record<string, unknown> = {}) => ({
  kind: "plan_due" as const, key: `due:t1:${NOW}`, vars: { title: "Electricity bill due today", body: "BESCOM" },
  data: { day: "2026-11-12", task: "t1", item: "pt:t1", go: "pay" }, category: "x0_due", call: BILL, ...o,
});

const IOS_FULL: Token = { platform: "ios", token: "ExponentPushToken[full]", updatedAt: 0, caps: ["PushTimeSensitive", "BotCall", "BotRingtone"] };
const IOS_PLAIN: Token = { platform: "ios", token: "ExponentPushToken[plain]", updatedAt: 0, caps: ["BotCall"] };
const ANDROID: Token = { platform: "android", token: "ExponentPushToken[droid]", updatedAt: 0, caps: ["BotCall"] };
const OLD: Token = { platform: "ios", token: "ExponentPushToken[old]", updatedAt: 0, caps: ["PushTimeSensitive"] };

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); resetConfigForTests(); resetSeatsForTests(); setPushGate(null); setCallHook(null); setPlanCalls(null);
  installAiCheck(null);
});

/** The engine with a memory store and a sender that answers "ok" (or an error for the tokens named), and a call service over memory. */
function rig(o: { tokens: Token[]; fail?: string[]; nick?: string; consent?: boolean; table?: CallTable; config?: (p: PushPayload) => PushPayload; tz?: number | null; hook?: boolean } = { tokens: [] }) {
  const store = new MemoryPushStore();
  store.candidatesList = [{ userId: U, tokens: o.tokens.map((t, i) => ({ ...t, updatedAt: NOW - i })), lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: o.tz === undefined ? IST : o.tz }];
  const sent: PushMessage[][] = [];
  const sender = {
    send: async (m: PushMessage[]) => { sent.push(m); return m.map((x, i) => (o.fail?.includes(x.to) ? { status: "error" as const, error: "MessageRateExceeded" } : { status: "ok" as const, id: `t${sent.length}-${i}` })); },
    receipts: async () => ({}),
  };
  const engine = new PushEngine(store, sender, () => (o.config ?? ((p) => p))(structuredClone(PUSH_DEFAULTS)), quiet);
  const table = o.table ?? memoryCallTable();
  const calls = new PlanCalls({ table, engine: () => engine, name: async () => o.nick ?? "X0", consent: async () => o.consent ?? true });
  if (o.hook !== false) setCallHook(calls.hook);
  const all = () => sent.flat();
  return { store, sent, engine, table, calls, all, kinds: () => all().map((m) => m.data?.kind) };
}
type Rig = ReturnType<typeof rig>;
const rows = async (r: Rig) => r.table.select({});
const onlyRow = async (r: Rig): Promise<CallRow> => { const all = await r.table.select({ user_id: U }); expect(all).toHaveLength(1); return all[0]!; };

/** "What pings you" as the server reads it (you/push.ts verdict), over these settings. */
function gateWith(notify: Partial<typeof DEFAULT_SETTINGS.notify>) {
  const s = { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, ...notify } };
  setPushGate(({ kind, now, tzOffsetMin }) => verdict(s, kind, minuteOf(now, tzOffsetMin ?? IST)));
}

/** A call already on the person's list. */
let seq = 0;
const callRow = (o: Partial<CallRow> = {}): CallRow => ({
  id: randomUUID(), user_id: U, source: "leave", source_key: `leave:other:${seq++}`, origin: "server", parent_id: null, state: "ended", why: null,
  name: "Zara", item: SEED.item, seed: SEED, line: LINE, more: MORE, opening: "", turns: [], tz_min: IST, ring_at_ms: NOW - 2 * HOUR,
  ring_until_ms: NOW - 2 * HOUR + RING_MS, next_ms: null, rings: 1, rang: [], answered_ms: null, ended_ms: null, ...o,
});

// ===================================================================== the words

describe("what a call says", () => {
  const live = { back: false, talk: true, now: NOW, tz: IST };
  it("opens with the moment, from the item, and asks only when the person can answer", () => {
    expect(W.openingLine(SEED, live)).toBe("It's time to leave for the parent-teacher meeting at Green Valley School. Want me to do anything?");
    expect(W.openingLine({ ...SEED, title: "Pick up Kabir", place: "DPS" }, { ...live, talk: false })).toBe("It's time to leave to pick up Kabir at DPS.");
    expect(W.openingLine({ ...SEED, title: "PTM", place: "" }, { ...live, talk: false })).toBe("It's time to leave for PTM.");
    expect(W.openingLine({ ...SEED, title: "Rahul's birthday party", place: "Koramangala" }, { ...live, talk: false })).toBe("It's time to leave for Rahul's birthday party at Koramangala.");
    expect(W.openingLine({ ...SEED, title: "Gym", place: "" }, { ...live, talk: false })).toBe("It's time to leave for the gym.");
    expect(W.openingLine({ ...SEED, title: "Mr Sharma", place: "" }, { ...live, talk: false })).toBe("It's time to leave for Mr Sharma.");
  });
  it("greets only when it is asked to: the mild 'Hello.' belongs to the live call, and a turn call opens on the moment itself", () => {
    expect(W.openingLine(SEED, { ...live, talk: false, hello: true })).toBe("Hello. It's time to leave for the parent-teacher meeting at Green Valley School.");
    expect(W.openingLine(SEED, { ...live, talk: false, hello: false })).toBe("It's time to leave for the parent-teacher meeting at Green Valley School.");
    expect(W.openingLine(SEED, { ...live, talk: false })).toBe(W.openingLine(SEED, { ...live, talk: false, hello: false }));
    expect(W.openingLine(BILL, { back: true, talk: false, now: NOW, tz: IST, hello: true })).toBe("Hello. I called because electricity bill is due today.");
  });
  it("says an appointment and no place for anything that looks like health, and never an amount or a $", () => {
    expect(W.openingLine({ ...SEED, title: "Dr. Mehta", place: "Apollo Clinic" }, { ...live, talk: false })).toBe("It's time to leave for your appointment.");
    expect(W.openingLine({ ...SEED, title: "Lunch", place: "Apollo Clinic" }, { ...live, talk: false })).toBe("It's time to leave for the lunch.");
    expect(W.openingLine(BILL, { ...live, talk: false })).toBe("Electricity bill is due today.");
    expect(W.openingLine({ ...BILL, title: "Rent ₹25,000" }, live)).toBe("Rent is due today. Want me to do anything?");
    expect(W.openingLine({ ...BILL, title: "Hospital bill" }, { ...live, talk: false })).toBe("A bill is due today.");
    const odd = W.openingLine({ ...SEED, title: "$state.secret party", place: "$5 bar" }, live);
    expect(odd).not.toContain("$");
    expect(odd).not.toMatch(/₹|\d,\d{3}/);
  });
  it("says why it called on a Call back, before the start and after it", () => {
    expect(W.openingLine(SEED, { ...live, back: true, now: ist(12, 17, 10) }))
      .toBe("I called because it was time to leave for the parent-teacher meeting at Green Valley School. It starts at 5:30 pm. Want me to do anything?");
    expect(W.openingLine(SEED, { back: true, talk: false, now: ist(12, 17, 40), tz: IST }))
      .toBe("I called because it was time to leave for the parent-teacher meeting. It started at 5:30 pm.");
    expect(W.openingLine(BILL, { back: true, talk: false, now: NOW, tz: IST })).toBe("I called because electricity bill is due today.");
    expect(W.openingLine({ ...BILL, title: "EMI for car" }, { back: true, talk: false, now: NOW, tz: IST })).toBe("I called because EMI for car is due today.");
  });
  it("the missed call keeps the reminder's line, and its second half when that says something", () => {
    expect(W.missedBody(LINE, MORE)).toBe(`${LINE} · ${MORE}`);
    expect(W.missedBody("Electricity bill due today", "Tap to see it")).toBe("Electricity bill due today");
    expect(W.missedBody("Electricity bill due today", "")).toBe("Electricity bill due today");
    expect(W.missedBody("x".repeat(100), "y ".repeat(60)).length).toBeLessThanOrEqual(140);
  });
  it("says a reply aloud without markdown, in two sentences and 280 characters at most", () => {
    expect(W.spokenOf("**Done.** I moved it to *6 pm*. Anything else? I can also remind you.")).toBe("Done. I moved it to 6 pm.");
    expect(W.spokenOf("- [Open map](https://maps.example) now\n- then go")).toBe("Open map now then go");
    expect(W.spokenOf("word ".repeat(200)).length).toBeLessThanOrEqual(280);
    expect(W.spokenOf("")).toBe("Done.");
    expect(W.spokenOf("```code```")).toBe("Done.");
  });
  it("knows when the person is done, and only then", () => {
    for (const yes of ["No", "nope.", "No, that's all.", "That’s it!", "bye", "Okay bye", "thank you", "Kuch nahi", "bas", "theek hai", "No thanks, bye", "all good"]) expect(W.endsCall(yes), yes).toBe(true);
    for (const no of ["No, move it to 6", "yes", "Move it", "bye bye bye bye bye bye bye bye bye", "", "thanks for moving it"]) expect(W.endsCall(no), no).toBe(false);
  });
  it("hands the chat the facts of the call: what, which one, and what was said", () => {
    const ctx = W.callContext(SEED, "It's time to leave.", IST);
    expect(ctx).toContain("Event id: ev1");
    expect(ctx).toContain("Starts: 17:30");
    expect(ctx).toContain("Leave by: 17:05");
    expect(ctx).toContain('You said: "It\'s time to leave."');
    expect(W.callContext(BILL, "", IST)).toContain("To-do id: t1");
    expect(W.callContext(BILL, "", IST)).toContain("Pay link: yes");
  });
  it("the card shows the whole title inside the app, with what its buttons need", () => {
    expect(W.cardOf(SEED, IST)).toEqual({
      title: "Parent-teacher meeting", sub: "Leave by 5:05 pm · 25 min drive to Green Valley School", item: SEED.item, eventId: "ev1",
      to: "Green Valley School", mode: "driving",
    });
    expect(W.cardOf(BILL, IST)).toEqual({ title: "Electricity bill ₹2,340", sub: "To BESCOM · due today", item: "pt:t1", taskId: "t1", pay: true });
    expect(W.cardOf({ ...BILL, payee: "" }, IST).sub).toBe("Due today");
  });
});

describe("when a call may not ring", () => {
  const at = (ms: number, o: Partial<CallRow> = {}) => callRow({ ring_at_ms: ms, ring_until_ms: ms + RING_MS, ...o });
  it("one on, three today, or the last under 15 minutes ago; a ring that never left counts for nothing", () => {
    expect(W.blockedBy([], NOW, IST)).toBeNull();
    expect(W.blockedBy([at(NOW - 10_000, { state: "ringing", next_ms: NOW + 1 })], NOW, IST)).toBe("busy");
    expect(W.blockedBy([at(NOW - 20 * MIN, { state: "answered", next_ms: NOW + MIN })], NOW, IST)).toBe("busy");
    expect(W.blockedBy([at(NOW - 3 * HOUR), at(NOW - 2 * HOUR), at(NOW - HOUR)], NOW, IST)).toBe("day_max");
    expect(W.blockedBy([at(NOW - 3 * HOUR), at(NOW - 2 * HOUR), at(NOW - HOUR, { why: "not_sent" })], NOW, IST)).toBeNull();
    expect(W.blockedBy([at(NOW - 14 * MIN)], NOW, IST)).toBe("too_soon");
    expect(W.blockedBy([at(NOW - 16 * MIN)], NOW, IST)).toBeNull();
    expect(W.blockedBy([at(NOW - 2 * MIN, { why: "not_sent" })], NOW, IST)).toBeNull();
    // Yesterday's three don't count today.
    expect(W.blockedBy([at(NOW - 26 * HOUR), at(NOW - 25 * HOUR), at(NOW - 24 * HOUR)], NOW, IST)).toBeNull();
  });
  it("counts the person's own Call backs for busy and the 15 minutes, never for the three", () => {
    expect(W.blockedBy([at(NOW - 14 * MIN, { origin: "user" })], NOW, IST)).toBe("too_soon");
    expect(W.blockedBy([at(NOW - 4 * HOUR, { origin: "user" }), at(NOW - 3 * HOUR, { origin: "user" }), at(NOW - 2 * HOUR, { origin: "user" })], NOW, IST)).toBeNull();
  });
});

// ===================================================================== the switches

describe("the switches and caps", () => {
  it("What pings you: a call only with Calls on, Plan Ease on and outside quiet hours; a missed call always goes (silently)", () => {
    const at = 17 * 60;
    expect(verdict(DEFAULT_SETTINGS, "plan_call", at)).toBe("send");
    expect(verdict({ ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, calls: false } }, "plan_call", at)).toBe("drop");
    expect(verdict({ ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, quiet: true, quietFrom: 16 * 60, quietTo: 18 * 60 } }, "plan_call", at)).toBe("drop");
    expect(verdict({ ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, botsOff: ["plan"] } }, "plan_call", at)).toBe("drop");
    expect(verdict(DEFAULT_SETTINGS, "plan_call_missed", at)).toBe("send");
  });
  it("Calls is on by default, can be turned off, and only as a true or false", () => {
    expect(DEFAULT_SETTINGS.notify.calls).toBe(true);
    expect(cleanSettings({}).notify.calls).toBe(true);
    expect(cleanSettings({ notify: { calls: false } }).notify.calls).toBe(false);
    const off = applyPatch(DEFAULT_SETTINGS, { notify: { calls: false } });
    expect(off.ok && off.settings.notify.calls).toBe(false);
    expect(applyPatch(DEFAULT_SETTINGS, { notify: { calls: "x" } }).ok).toBe(false);
  });
  it("a token keeps the call caps", () => {
    expect(pushCapsOf(["BotCall", "BotRingtone", "Nope"])).toEqual(["BotCall", "BotRingtone"]);
  });
  it("BOT_CALLS switches the whole thing, with the app release and reminders under it", () => {
    expect(callsOn()).toBe(true);
    vi.stubEnv("BOT_CALLS", "false"); resetConfigForTests();
    expect(callsOn()).toBe(false);
    vi.stubEnv("BOT_CALLS", "true"); vi.stubEnv("PLAN_V2_APP", "false"); resetConfigForTests();
    expect(callsOn()).toBe(false);
  });
  it("a call's kinds are not Plan Ease's push kinds (no desk notice, no plan channel)", () => {
    expect(PLAN_PUSH_KINDS.some((k) => (CALL_KIND_IDS as readonly string[]).includes(k.kind))).toBe(false);
  });
  it("needTimeSensitive keeps an iPhone without the entitlement out", () => {
    expect(callTokens([IOS_FULL, IOS_PLAIN, ANDROID, OLD], false).map((t) => t.token)).toEqual([IOS_FULL.token, IOS_PLAIN.token, ANDROID.token]);
    expect(callTokens([IOS_FULL, IOS_PLAIN, ANDROID, OLD], true).map((t) => t.token)).toEqual([IOS_FULL.token, ANDROID.token]);
  });
});

// ===================================================================== the engine

describe("a leave-by or a bill due today rings instead", () => {
  beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }); });

  it("rings an iPhone that takes calls with exactly the contract's message, and sends no push", async () => {
    const r = rig({ tokens: [IOS_FULL], nick: "Zara" });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.all()).toHaveLength(1);
    const c = await onlyRow(r);
    const m = r.all()[0]!;
    expect(m).toEqual({
      to: IOS_FULL.token, title: "Zara is calling", body: LINE, sound: "x0_ring_1.wav", channelId: "calls", priority: "high", ttl: 40,
      interruptionLevel: "time-sensitive", categoryId: "x0_call", collapseId: `call-${c.id}`, tag: `call-${c.id}`,
      data: { call: c.id, state: "ringing", day: "2026-11-12", screenId: "bots.plan.call", pushId: m.data!.pushId, kind: "plan_call" },
    });
    expect(r.store.rows.map((x) => x.periodKey)).toEqual([`plan_call:${c.id}:1`]);
    expect(r.store.rows.some((x) => x.periodKey === `plan_leave:${leaveMsg().key}`)).toBe(false);
    expect(c).toMatchObject({ state: "ringing", source: "leave", origin: "server", name: "Zara", line: LINE, more: MORE, rings: 1, ring_at_ms: NOW, ring_until_ms: NOW + RING_MS, next_ms: NOW + RING2_MS });
    // Never in the push: titles, places, amounts, item ids.
    expect(JSON.stringify(m.data)).not.toMatch(/Green Valley|ev1|teacher/);
  });

  it("the default sound without the ringtone, no Time Sensitive without the entitlement, and Android's own channel", async () => {
    const r = rig({ tokens: [IOS_PLAIN, ANDROID] });
    await r.engine.notify(U, leaveMsg(), NOW);
    const [ios, droid] = r.all();
    expect(ios).toMatchObject({ sound: "default", channelId: "calls", title: "X0 is calling" });
    expect(ios!.interruptionLevel).toBeUndefined();
    expect(droid).toMatchObject({ sound: "default", channelId: "calls", tag: ios!.tag });
  });

  it("a phone whose JS doesn't take calls gets exactly today's push", async () => {
    const today = rig({ tokens: [OLD], hook: false });
    await today.engine.notify(U, leaveMsg(), NOW);
    const r = rig({ tokens: [OLD] });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.all()).toEqual(today.all());
    expect(r.all()[0]!.data!.kind).toBe("plan_leave");
    expect(await rows(r)).toEqual([]);
  });

  it("with two phones, the one that takes calls rings and the other gets the push", async () => {
    const r = rig({ tokens: [IOS_FULL, OLD] });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.sent.map((batch) => batch.map((m) => [m.to, m.data!.kind]))).toEqual([[[IOS_FULL.token, "plan_call"]], [[OLD.token, "plan_leave"]]]);
  });

  it("never rings with a computer in use: the desk notice and the phone's silent copy, as today", async () => {
    openSeat(U, {}, { buttons: true }).here(MIN, NOW);
    const r = rig({ tokens: [IOS_FULL] });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.kinds()).toEqual(["plan_leave"]);
    expect(r.all()[0]!.sound).toBeNull();
    expect(await rows(r)).toEqual([]);
  });

  it("quiet hours: the push goes the existing way (silent), never a call", async () => {
    gateWith({ quiet: true, quietFrom: 16 * 60, quietTo: 18 * 60 });
    const r = rig({ tokens: [IOS_FULL] });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.kinds()).toEqual(["plan_leave"]);
    expect(r.all()[0]).toMatchObject({ sound: null, interruptionLevel: "active" });
  });

  it("Calls off, or Plan Ease off: the push as today (or none, as Plan Ease's switch says)", async () => {
    gateWith({ calls: false });
    const a = rig({ tokens: [IOS_FULL] });
    await a.engine.notify(U, leaveMsg(), NOW);
    expect(a.kinds()).toEqual(["plan_leave"]);
    gateWith({ botsOff: ["plan"] });
    const b = rig({ tokens: [IOS_FULL] });
    await b.engine.notify(U, leaveMsg(), NOW);
    expect(b.all()).toEqual([]);
    expect(await rows(b)).toEqual([]);
  });

  for (const [what, env] of [["BOT_CALLS off", { BOT_CALLS: "false" }], ["the app release off", { PLAN_V2_APP: "false" }]] as const) {
    it(`${what}: the push as today`, async () => {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      resetConfigForTests();
      const r = rig({ tokens: [IOS_FULL] });
      await r.engine.notify(U, leaveMsg(), NOW);
      expect(r.kinds()).toEqual(["plan_leave"]);
      expect(await rows(r)).toEqual([]);
    });
  }

  it("the control plane's push.plan_call.enabled off: the push as today", async () => {
    const r = rig({ tokens: [IOS_FULL], config: (p) => ({ ...p, flags: { ...p.flags, "push.plan_call.enabled": false } }) });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.kinds()).toEqual(["plan_leave"]);
  });

  it("needTimeSensitive: an iPhone without the entitlement gets the push as today; one with it rings", async () => {
    const config = (p: PushPayload) => ({ ...p, flags: { ...p.flags, "push.plan_call.needTimeSensitive": true } });
    const a = rig({ tokens: [IOS_PLAIN], config });
    await a.engine.notify(U, leaveMsg(), NOW);
    expect(a.kinds()).toEqual(["plan_leave"]);
    const b = rig({ tokens: [IOS_FULL], config });
    await b.engine.notify(U, leaveMsg(), NOW);
    expect(b.kinds()).toEqual(["plan_call"]);
  });

  it("one at a time: a call ringing or on sends the push instead", async () => {
    for (const busy of [callRow({ state: "ringing", ring_at_ms: NOW - 10_000, ring_until_ms: NOW + 35_000, next_ms: NOW + 13_000 }), callRow({ state: "answered", ring_at_ms: NOW - 20 * MIN, ring_until_ms: NOW - 19 * MIN, next_ms: NOW + 3 * MIN })]) {
      const r = rig({ tokens: [IOS_FULL] });
      await r.table.insert(busy);
      await r.engine.notify(U, leaveMsg(), NOW);
      expect(r.kinds()).toEqual(["plan_leave"]);
    }
  });

  it("three a day: a fourth sends the push", async () => {
    const r = rig({ tokens: [IOS_FULL] });
    for (const h of [5, 4, 3]) await r.table.insert(callRow({ ring_at_ms: NOW - h * HOUR, ring_until_ms: NOW - h * HOUR + RING_MS }));
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.kinds()).toEqual(["plan_leave"]);
  });

  it("15 minutes apart: 14 minutes after the last sends the push, 16 rings; a Call back counts too, but not toward the three", async () => {
    const a = rig({ tokens: [IOS_FULL] });
    await a.table.insert(callRow({ ring_at_ms: NOW - 14 * MIN, ring_until_ms: NOW - 14 * MIN + RING_MS }));
    await a.engine.notify(U, leaveMsg(), NOW);
    expect(a.kinds()).toEqual(["plan_leave"]);
    const b = rig({ tokens: [IOS_FULL] });
    await b.table.insert(callRow({ ring_at_ms: NOW - 16 * MIN, ring_until_ms: NOW - 16 * MIN + RING_MS }));
    await b.engine.notify(U, leaveMsg(), NOW);
    expect(b.kinds()).toEqual(["plan_call"]);
    const c = rig({ tokens: [IOS_FULL] });
    await c.table.insert(callRow({ origin: "user", ring_at_ms: NOW - 14 * MIN, ring_until_ms: NOW - 14 * MIN }));
    await c.engine.notify(U, leaveMsg(), NOW);
    expect(c.kinds()).toEqual(["plan_leave"]);
    const d = rig({ tokens: [IOS_FULL] });
    for (const h of [5, 4, 3]) await d.table.insert(callRow({ origin: "user", ring_at_ms: NOW - h * HOUR, ring_until_ms: NOW - h * HOUR }));
    await d.engine.notify(U, leaveMsg(), NOW);
    expect(d.kinds()).toEqual(["plan_call"]);
  });

  it("no seed, or a merged push: never a call", async () => {
    const r = rig({ tokens: [IOS_FULL] });
    await r.engine.notify(U, leaveMsg({ call: undefined }), NOW);
    await r.engine.notify(U, { kind: "plan_many", key: "many:x", vars: { title: "2 things at 5 pm", body: "PTM, gym" }, data: { day: "2026-11-12" } }, NOW);
    expect(r.kinds()).toEqual(["plan_leave", "plan_many"]);
    expect(await rows(r)).toEqual([]);
  });

  it("a push that wouldn't make a sound never becomes a ring: it goes as the person's say has it", async () => {
    setPushGate(({ kind }) => (kind === "plan_leave" ? "silent" : "send"));
    const a = rig({ tokens: [IOS_FULL] });
    await a.engine.notify(U, leaveMsg(), NOW);
    expect(a.kinds()).toEqual(["plan_leave"]);
    expect(a.all()[0]!.sound).toBeNull();
    setPushGate(({ kind }) => (kind === "plan_leave" ? "drop" : "send"));
    const b = rig({ tokens: [IOS_FULL] });
    await b.engine.notify(U, leaveMsg(), NOW);
    expect(b.all()).toEqual([]);
  });

  it("a call that can't be placed (no table) lets the push go", async () => {
    const broken = memoryCallTable();
    broken.insert = async () => { throw new Error("bots area: plan_calls insert: relation does not exist"); };
    const r = rig({ tokens: [IOS_FULL], table: broken });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.kinds()).toEqual(["plan_leave"]);
    const unreadable = memoryCallTable();
    unreadable.select = async () => { throw new Error("down"); };
    const r2 = rig({ tokens: [IOS_FULL], table: unreadable });
    await r2.engine.notify(U, leaveMsg(), NOW);
    expect(r2.kinds()).toEqual(["plan_leave"]);
  });

  it("the same reminder never calls twice: taken by a live call sends nothing; taken by a ring that never left lets the push decide", async () => {
    const a = rig({ tokens: [IOS_FULL] });
    await a.table.insert(callRow({ source_key: leaveMsg().key, state: "declined", ring_at_ms: NOW - 20 * MIN, ring_until_ms: NOW - 20 * MIN + RING_MS }));
    expect(await a.engine.notify(U, leaveMsg(), NOW)).toEqual({ sent: true, dropped: 0 });
    expect(a.all()).toEqual([]);
    const b = rig({ tokens: [IOS_FULL] });
    await b.table.insert(callRow({ source_key: leaveMsg().key, state: "ended", why: "not_sent", ring_at_ms: NOW - MIN, ring_until_ms: NOW - MIN + RING_MS }));
    await b.engine.notify(U, leaveMsg(), NOW);
    expect(b.kinds()).toEqual(["plan_leave"]);
  });

  it("the same reminder again while its call rings, or inside the 15 minutes, sends nothing at all (the limits never let its push through)", async () => {
    const took = [tokenHash(IOS_FULL.token)];
    for (const had of [
      callRow({ source_key: leaveMsg().key, state: "ringing", rang: took, ring_at_ms: NOW - 10_000, ring_until_ms: NOW + 35_000, next_ms: NOW + 13_000 }),
      callRow({ source_key: leaveMsg().key, state: "answered", rang: took, ring_at_ms: NOW - 2 * MIN, ring_until_ms: NOW - 2 * MIN + RING_MS, next_ms: NOW + 3 * MIN }),
      callRow({ source_key: leaveMsg().key, state: "ended", why: "hung_up", rang: took, ring_at_ms: NOW - 5 * MIN, ring_until_ms: NOW - 5 * MIN + RING_MS }),
      // Another server's, its ring still on its way (nothing on the row yet): every phone that takes calls is left to it.
      callRow({ source_key: leaveMsg().key, state: "ringing", ring_at_ms: NOW, ring_until_ms: NOW + RING_MS, next_ms: NOW + RING2_MS }),
    ]) {
      const r = rig({ tokens: [IOS_FULL] });
      await r.table.insert(had);
      expect(await r.engine.notify(U, leaveMsg(), NOW), had.state).toEqual({ sent: true, dropped: 0 });
      expect(r.all(), had.state).toEqual([]);
      expect(await rows(r)).toHaveLength(1);
    }
    // As it happens: a tick that couldn't mark the leave-by sent sends it again a minute later.
    const again = rig({ tokens: [IOS_FULL] });
    await again.engine.notify(U, leaveMsg(), NOW);
    await again.engine.notify(U, leaveMsg(), NOW + MIN);
    expect(again.kinds()).toEqual(["plan_call"]);
    // A phone whose ring failed had the push the first time; its own claim keeps the second from going.
    const half = rig({ tokens: [IOS_FULL, ANDROID], fail: [ANDROID.token] });
    await half.engine.notify(U, leaveMsg(), NOW);
    await half.engine.notify(U, leaveMsg(), NOW + MIN);
    expect(half.sent.map((b) => b.map((m) => [m.to, m.data!.kind]))).toEqual([[[IOS_FULL.token, "plan_call"], [ANDROID.token, "plan_call"]], [[ANDROID.token, "plan_leave"]]]);
  });

  it("a second server's insert first (a unique violation) is taken, not failed", async () => {
    const t = memoryCallTable();
    const insert = t.insert.bind(t);
    t.insert = async (row) => { await insert({ ...row, id: randomUUID() }); throw new Error("bots area: plan_calls insert: duplicate key value violates unique constraint \"plan_calls_source_key\""); };
    const r = rig({ tokens: [IOS_FULL], table: t });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.all()).toEqual([]);
  });

  it("a ring no phone took is ended as never sent, and the push goes", async () => {
    const r = rig({ tokens: [IOS_FULL], fail: [IOS_FULL.token] });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.kinds()).toEqual(["plan_call", "plan_leave"]);
    expect(await onlyRow(r)).toMatchObject({ state: "ended", why: "not_sent", next_ms: null });
  });

  it("two phones that take calls, one ticket failed: that phone gets the push, and never ring 2 or the missed call", async () => {
    const r = rig({ tokens: [IOS_FULL, ANDROID], fail: [ANDROID.token] });
    await r.engine.notify(U, leaveMsg(), NOW);
    expect(r.sent.map((b) => b.map((m) => [m.to, m.data!.kind]))).toEqual([[[IOS_FULL.token, "plan_call"], [ANDROID.token, "plan_call"]], [[ANDROID.token, "plan_leave"]]]);
    const c = await onlyRow(r);
    expect(c).toMatchObject({ state: "ringing", rang: [tokenHash(IOS_FULL.token)] });
    // Which phones took it, never the tokens themselves.
    expect(JSON.stringify(c)).not.toContain("ExponentPushToken");
    await vi.advanceTimersByTimeAsync(RING_MS);
    expect(r.sent.slice(2).map((b) => b.map((m) => [m.to, m.data!.kind]))).toEqual([[[IOS_FULL.token, "plan_call"]], [[IOS_FULL.token, "plan_call_missed"]]]);
    // After a restart too: the sweep reads the same row.
    const s = rig({ tokens: [IOS_FULL, ANDROID], fail: [ANDROID.token] });
    await s.engine.notify(U, leaveMsg(), NOW);
    vi.clearAllTimers();
    const after = new PlanCalls({ table: s.table, engine: () => s.engine, name: async () => "X0", consent: async () => true });
    await after.sweep(NOW + 24_000);
    await after.sweep(NOW + 46_000);
    expect(s.sent.slice(2).map((b) => b.map((m) => m.to))).toEqual([[IOS_FULL.token], [IOS_FULL.token]]);
  });

  it("a bill due today rings too; its row keeps the reminder's own clock, not the phone's", async () => {
    const r = rig({ tokens: [ANDROID], tz: 0 });
    await r.engine.notify(U, dueMsg(), NOW);
    expect(r.kinds()).toEqual(["plan_call"]);
    expect(r.all()[0]!.body).toBe("Electricity bill due today");
    const c = await onlyRow(r);
    expect(c).toMatchObject({ source: "due", tz_min: IST, item: "pt:t1" });
  });
});

describe("the reminders carry what a call needs, and never in the push", () => {
  it("a leave-by's seed beside the push, its data as before", async () => {
    const got: Array<Record<string, unknown>> = [];
    const prefs = memoryPlanPrefs(() => NOW);
    await prefs.patch(U, {
      tz_min: IST, next_leave_ms: SEED.leaveBy - 10 * MIN,
      leaves: [{ eventId: "ev1", start: SEED.start, leaveBy: SEED.leaveBy, minutes: 25, mode: "drive", to: "Green Valley School", title: "Parent-teacher meeting" }],
    });
    const ease = new PlanEase({ prefs, now: () => NOW, send: async (_u, msg) => { got.push(msg as Record<string, unknown>); } });
    expect(await ease.leavesTick()).toBe(1);
    expect(got[0]).toEqual({ ...leaveMsg(), key: `leave:ev1:${SEED.start}` });
  });
  it("a bill's seed only on its day", () => {
    const t = { id: "t1", title: "Electricity bill ₹2,340", due_day: "2026-11-12", due_ms: null, tz_min: IST, done: false, payee: "BESCOM", pay_link: "upi://pay?pa=bescom@ok" };
    expect(dueReminder(t, "2026-11-12", NOW).call).toEqual(BILL);
    expect(dueReminder({ ...t, due_day: "2026-11-13" }, "2026-11-12", NOW).call).toBeUndefined();
    expect(JSON.stringify(dueReminder(t, "2026-11-12", NOW).data)).not.toContain("2,340");
  });
});

// ===================================================================== the timers

describe("ring 2, the missed call, and an idle call", () => {
  beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }); });
  const ring = async (o: Parameters<typeof rig>[0] = { tokens: [IOS_FULL] }) => {
    const r = rig({ nick: "Zara", ...o });
    await r.engine.notify(U, leaveMsg(), NOW);
    return { r, id: (await onlyRow(r)).id };
  };

  it("rings again at +23 s, replacing the first (same collapse id and tag), for what is left of the window", async () => {
    const { r, id } = await ring();
    await vi.advanceTimersByTimeAsync(RING2_MS);
    expect(r.kinds()).toEqual(["plan_call", "plan_call"]);
    const two = r.all()[1]!;
    expect(two).toMatchObject({ collapseId: `call-${id}`, tag: `call-${id}`, ttl: 20, sound: "x0_ring_1.wav", title: "Zara is calling" });
    expect(r.store.rows.map((x) => x.periodKey)).toEqual([`plan_call:${id}:1`, `plan_call:${id}:2`]);
    expect((await onlyRow(r)).rings).toBe(2);
  });

  it("then the missed call at +45 s, exactly the contract's", async () => {
    const { r, id } = await ring({ tokens: [IOS_FULL, ANDROID] });
    await vi.advanceTimersByTimeAsync(RING_MS);
    const missed = r.sent.at(-1)!;
    expect(missed[0]).toEqual({
      to: IOS_FULL.token, title: "Missed call from Zara", body: `${LINE} · ${MORE}`, sound: null, channelId: "calls_missed", priority: "normal", ttl: 1200,
      interruptionLevel: "passive", categoryId: "x0_call_missed", collapseId: `call-${id}`, tag: `call-${id}`,
      data: { call: id, state: "missed", day: "2026-11-12", screenId: "bots.plan.call", pushId: missed[0]!.data!.pushId, kind: "plan_call_missed" },
    });
    expect(missed[1]!.interruptionLevel).toBeUndefined();
    expect(await onlyRow(r)).toMatchObject({ state: "missed", next_ms: null });
  });

  it("answered at +10 s: no ring 2, no missed call", async () => {
    const { r, id } = await ring();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await r.calls.answer({ id: U }, id, false))?.state).toBe("answered");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.kinds()).toEqual(["plan_call"]);
  });

  it("declined (Not now): nothing more", async () => {
    const { r, id } = await ring();
    expect(await r.calls.decline(U, id)).toEqual({ ok: true, state: "declined" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.kinds()).toEqual(["plan_call"]);
  });

  it("after a restart (the timers lost), the sweep still rings again and says it was missed", async () => {
    const { r, id } = await ring();
    vi.clearAllTimers();
    const after = new PlanCalls({ table: r.table, engine: () => r.engine, name: async () => "Zara", consent: async () => true });
    await after.sweep(NOW + 24_000);
    await after.sweep(NOW + 46_000);
    expect(r.kinds()).toEqual(["plan_call", "plan_call", "plan_call_missed"]);
    expect(r.store.rows.at(-1)!.periodKey).toBe(`plan_call_missed:${id}`);
  });

  it("a sweep that comes first at +41 s never rings after the window: straight to missed", async () => {
    const { r } = await ring();
    vi.clearAllTimers();
    const after = new PlanCalls({ table: r.table, engine: () => r.engine, name: async () => "Zara", consent: async () => true });
    await after.sweep(NOW + 41_000);
    await after.sweep(NOW + 60_000);
    expect(r.kinds()).toEqual(["plan_call", "plan_call_missed"]);
  });

  it("a sweep that comes after the missed call's own expiry marks it missed and sends nothing", async () => {
    const { r } = await ring();
    vi.clearAllTimers();
    const after = new PlanCalls({ table: r.table, engine: () => r.engine, name: async () => "Zara", consent: async () => true });
    await after.sweep(NOW + RING_MS + 21 * MIN);
    expect(r.kinds()).toEqual(["plan_call"]);
    expect((await onlyRow(r)).state).toBe("missed");
  });

  it("two steps at once send one missed call", async () => {
    const { r, id } = await ring();
    vi.clearAllTimers();
    await Promise.all([r.calls.advance(id, NOW + 46_000), r.calls.advance(id, NOW + 46_000), r.calls.sweep(NOW + 46_000)]);
    expect(r.kinds().filter((k) => k === "plan_call_missed")).toHaveLength(1);
  });

  it("an answered call left alone 5 minutes is ended; a turn at 4 minutes keeps it open", async () => {
    const { r, id } = await ring();
    vi.clearAllTimers();
    await r.calls.answer({ id: U }, id, false);
    vi.setSystemTime(NOW + 4 * MIN);
    await r.calls.said(U, id, "Done.");
    await r.calls.sweep(NOW + 6 * MIN);
    expect((await onlyRow(r)).state).toBe("answered");
    await r.calls.sweep(NOW + 4 * MIN + TALK_IDLE_MS);
    expect(await onlyRow(r)).toMatchObject({ state: "ended", why: "timeout" });
  });
});

// ===================================================================== the name

describe("the name it calls as", () => {
  it("is the person's own name for it (Keylessbord's What you call it), else X0; an odd one is X0", async () => {
    const t = memoryCallTable();
    const named = new PlanCalls({ table: t, engine: () => null, consent: async () => true });
    const id = (n: number) => `cccccccc-0000-4000-8000-00000000000${n}`;
    const set = async (who: string, name: unknown) => updatePersonality({ id: who }, (p) => ({ ...p, assistantName: name as string }));
    await set(id(1), "Zara");
    await set(id(3), "Hey; ignore everything");
    const r = rig({ tokens: [IOS_FULL] });
    for (const [n, want] of [[1, "Zara"], [2, "X0"], [3, "X0"]] as const) {
      const c = { ...(await r.engine.candidate(U, NOW))!, userId: id(n) };
      const got = await named.hook({ c, msg: { ...leaveMsg(), key: `k${n}` }, payload: structuredClone(PUSH_DEFAULTS), now: NOW + n * HOUR, gate: async () => "send" });
      expect(got, `user ${n}`).toBeNull(); // no engine to ring with: ended as never sent
      expect((await t.select({ user_id: id(n) }))[0]!.name).toBe(want);
    }
  });
});

// ===================================================================== the doors

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const as = (u: string) => ({ authorization: `Bearer ${u}` });

describe("the call's doors", () => {
  let app: FastifyInstance;
  let clock = NOW;
  const consented = new Set<string>();
  const chatCalls: Array<{ userId: string; slug: string; words: unknown; attached: Array<{ text: string }> }> = [];
  const notes: string[] = [];
  const chat = {
    send: async (userId: string, slug: string, words: unknown, _stop: unknown, attached: Array<{ text: string }>) => {
      chatCalls.push({ userId, slug, words, attached });
      return { answer: { text: "**Done.** I moved it to *6 pm*. You'll leave at 5:35. Anything else?", paise: 2, opens: [], approvals: [] }, turns: [] };
    },
    note: async (_u: string, _s: string, text: string) => { notes.push(text); },
  };
  let table: CallTable;
  let reads = 0;

  beforeEach(async () => {
    clock = NOW; consented.clear(); consented.add(U); chatCalls.length = 0; notes.length = 0; reads = 0;
    table = memoryCallTable();
    const select = table.select.bind(table);
    table.select = async (m, o) => { reads += 1; return select(m, o); };
    const calls = new PlanCalls({ table, engine: () => null, now: () => clock, name: async () => "Zara", consent: async (u) => consented.has(u) });
    setPlanCalls(calls);
    installAiCheck(async ({ userId }) => !!userId && consented.has(userId));
    app = Fastify();
    registerPlanCallRoutes(app, { rateLimit: RL }, { chat: chat as never, guard: defaultGuard() });
    calls.wire({ speak: async (_u, text) => ({ audio: Buffer.from(`audio:${text}`), contentType: "audio/mpeg" }) });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const put = async (o: Partial<CallRow> = {}) => { const r = callRow({ state: "ringing", ring_at_ms: NOW, ring_until_ms: NOW + RING_MS, next_ms: NOW + RING2_MS, ...o }); await table.insert(r); return r; };
  const post = (u: string, url: string, payload: object = {}) => app.inject({ method: "POST", url, headers: as(u), payload });
  const get = (u: string, url: string) => app.inject({ method: "GET", url, headers: as(u) });

  it("are the signed-in person's own: 401 without a session, 404 for someone else's call or an id that isn't one", async () => {
    const c = await put();
    expect((await app.inject({ method: "GET", url: `${CALLS}/${c.id}` })).statusCode).toBe(401);
    expect((await get(U2, `${CALLS}/${c.id}`)).statusCode).toBe(404);
    expect((await post(U2, `${CALLS}/${c.id}/answer`, { talk: true })).statusCode).toBe(404);
    const before = reads;
    expect((await get(U, `${CALLS}/not-a-uuid`)).statusCode).toBe(404);
    expect((await post(U, `${CALLS}/not-a-uuid/answer`)).statusCode).toBe(404);
    expect(reads).toBe(before);
    const view = (await get(U, `${CALLS}/${c.id}`)).json() as CallView;
    expect(view).toMatchObject({ id: c.id, state: "ringing", name: "Zara", line: LINE, missedClock: "4:55 pm", late: true, ai: true, card: W.cardOf(SEED, IST) });
  });

  it("answer: a ringing call connects and speaks first, with the server voice for a person who agreed to AI", async () => {
    const c = await put();
    const r = (await post(U, `${CALLS}/${c.id}/answer`, { talk: true })).json();
    expect(r).toEqual({
      state: "answered", opening: "It's time to leave for the parent-teacher meeting at Green Valley School. Want me to do anything?",
      voice: `${CALLS}/${c.id}/voice/0`, answeredAt: NOW, fresh: true,
    });
    expect(notes).toEqual([r.opening]);
    const stored = (await table.select({ id: c.id }))[0]!;
    expect(stored).toMatchObject({ state: "answered", opening: r.opening, answered_ms: NOW, next_ms: NOW + TALK_IDLE_MS });
    // The voice was made ahead; the GET plays it.
    const v = await get(U, `${CALLS}/${c.id}/voice/0`);
    expect(v.statusCode).toBe(200);
    expect(v.headers["content-type"]).toBe("audio/mpeg");
    expect(v.body).toBe(`audio:${r.opening}`);
  });

  it("answer: late inside the grace still connects; past it, the call was missed", async () => {
    const late = await put({ state: "missed", ring_at_ms: NOW - 100_000, ring_until_ms: NOW - 55_000, next_ms: null });
    expect((await post(U, `${CALLS}/${late.id}/answer`, { talk: true })).json()).toMatchObject({ state: "answered", fresh: true });
    const gone = await put({ state: "missed", ring_at_ms: NOW - RING_MS - GRACE_MS - 5_000, ring_until_ms: NOW - GRACE_MS - 5_000, next_ms: null });
    expect((await post(U, `${CALLS}/${gone.id}/answer`, { talk: true })).json()).toEqual({ state: "missed" });
    expect(((await get(U, `${CALLS}/${gone.id}`)).json() as CallView).late).toBe(false);
    // A ring the sweep never got to, past the grace, is settled as missed.
    const stale = await put({ ring_at_ms: NOW - 5 * MIN, ring_until_ms: NOW - 5 * MIN + RING_MS, next_ms: NOW - 5 * MIN + RING2_MS });
    expect((await post(U, `${CALLS}/${stale.id}/answer`, { talk: true })).json()).toEqual({ state: "missed" });
  });

  it("answer again: a retry inside 10 s still speaks; after that it's quiet, and nothing is written or noted twice", async () => {
    const c = await put();
    await post(U, `${CALLS}/${c.id}/answer`, { talk: true });
    clock = NOW + 5_000;
    expect((await post(U, `${CALLS}/${c.id}/answer`, { talk: true })).json().fresh).toBe(true);
    clock = NOW + 11_000;
    const again = (await post(U, `${CALLS}/${c.id}/answer`, { talk: true })).json();
    expect(again).toMatchObject({ state: "answered", fresh: false, answeredAt: NOW });
    expect(again.opening).toContain("parent-teacher meeting");
    expect(notes).toHaveLength(1);
  });

  it("answer without the AI permission: no server voice, and no question the person can't answer", async () => {
    consented.clear();
    const c = await put();
    const r = (await post(U, `${CALLS}/${c.id}/answer`, { talk: true })).json();
    expect(r).toMatchObject({ voice: null, fresh: true, opening: "It's time to leave for the parent-teacher meeting at Green Valley School." });
    expect(notes).toEqual([]);
    expect((await get(U, `${CALLS}/${c.id}/voice/0`)).statusCode).toBe(403);
  });

  it("decline: always 200 for a signed-in person; only a ringing call changes", async () => {
    const ringing = await put();
    const ended = await put({ state: "ended" });
    const missed = await put({ state: "missed", next_ms: null });
    expect((await post(U, `${CALLS}/${randomUUID()}/decline`)).json()).toEqual({ ok: true, state: "gone" });
    expect((await post(U, `${CALLS}/nope/decline`)).json()).toEqual({ ok: true, state: "gone" });
    expect((await post(U, `${CALLS}/${ended.id}/decline`)).json()).toEqual({ ok: true, state: "ended" });
    expect((await post(U, `${CALLS}/${missed.id}/decline`)).json()).toEqual({ ok: true, state: "missed" });
    const r = await post(U, `${CALLS}/${ringing.id}/decline`);
    expect([r.statusCode, r.json()]).toEqual([200, { ok: true, state: "declined" }]);
    expect((await post(U2, `${CALLS}/${ringing.id}/decline`)).json()).toEqual({ ok: true, state: "gone" });
    expect((await app.inject({ method: "POST", url: `${CALLS}/${ringing.id}/decline` })).statusCode).toBe(401);
    expect((await table.select({ id: ringing.id }))[0]).toMatchObject({ state: "declined", next_ms: null });
  });

  it("end: an answered call ends, a ringing one is declined, anything else stays; it can be pressed twice", async () => {
    const on = await put({ state: "answered", answered_ms: NOW, next_ms: NOW + TALK_IDLE_MS });
    expect((await post(U, `${CALLS}/${on.id}/end`)).json()).toEqual({ ok: true, state: "ended" });
    expect((await post(U, `${CALLS}/${on.id}/end`)).json()).toEqual({ ok: true, state: "ended" });
    const ringing = await put();
    expect((await post(U, `${CALLS}/${ringing.id}/end`)).json()).toEqual({ ok: true, state: "declined" });
    expect((await post(U, `${CALLS}/${randomUUID()}/end`)).statusCode).toBe(404);
  });

  it("Call back: the person's own call about the same thing, whatever the limits, and its opening says why it called", async () => {
    for (const h of [5, 4, 3]) await table.insert(callRow({ ring_at_ms: NOW - h * HOUR }));
    const missed = await put({ state: "missed", next_ms: null });
    const r = await post(U, `${CALLS}/${missed.id}/back`);
    expect(r.statusCode).toBe(201);
    const id = r.json().call as string;
    expect((await table.select({ id }))[0]).toMatchObject({ origin: "user", parent_id: missed.id, state: "answered", rings: 0, opening: "", seed: SEED, line: LINE });
    // Its screen took 30 s to open: still fresh, because nothing has been said yet.
    clock = NOW + 30_000;
    const ans = (await post(U, `${CALLS}/${id}/answer`, { talk: true })).json();
    expect(ans).toMatchObject({ state: "answered", fresh: true });
    expect(ans.opening).toMatch(/^I called because it was time to leave for the parent-teacher meeting at Green Valley School\. It starts at 5:30 pm\./);
    // A call still on is that call.
    expect((await post(U, `${CALLS}/${id}/back`)).json()).toEqual({ call: id });
    vi.stubEnv("BOT_CALLS", "false"); resetConfigForTests();
    const off = await post(U, `${CALLS}/${missed.id}/back`);
    expect([off.statusCode, off.json().code]).toEqual([404, "calls_off"]);
  });

  it("Call back has one limit of its own: BACK_MAX a day, so the button cannot be pressed into an endless string of calls", async () => {
    // The person's own calls earlier today, every one of them already over: the ring limits ignore them, this one does not.
    for (let i = 0; i < BACK_MAX; i += 1) {
      await table.insert(callRow({ origin: "user", state: "ended", ring_at_ms: NOW - (i + 1) * MIN, ended_ms: NOW - (i + 1) * MIN }));
    }
    const missed = await put({ state: "missed", next_ms: null });
    const over = await post(U, `${CALLS}/${missed.id}/back`);
    expect([over.statusCode, over.json().code]).toEqual([429, "back_day_max"]);
    // Yesterday's own calls count for nothing: the day is the person's own.
    for (const r of await table.select({ user_id: U, origin: "user" })) {
      await table.update({ id: r.id }, { ring_at_ms: Number(r.ring_at_ms) - 24 * HOUR });
    }
    const again = await post(U, `${CALLS}/${missed.id}/back`);
    expect(again.statusCode).toBe(201);
  });

  it("say: one turn by voice to the Plan Ease chat, with the call's facts, said aloud and kept for the voice", async () => {
    const c = await put({ state: "answered", answered_ms: NOW, next_ms: NOW + TALK_IDLE_MS, opening: "It's time to leave." });
    clock = NOW + 20_000;
    const r = await post(U, `${CALLS}/${c.id}/say`, { words: "Move it to 6" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toEqual({
      text: "**Done.** I moved it to *6 pm*. You'll leave at 5:35. Anything else?", spoken: "Done. I moved it to 6 pm.", voice: `${CALLS}/${c.id}/voice/1`,
      ended: false, turn: 1,
    });
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0]).toMatchObject({ userId: U, slug: "plan", words: "Move it to 6" });
    expect(chatCalls[0]!.attached[0]!.text).toContain("Event id: ev1");
    expect(chatCalls[0]!.attached[0]!.text).toContain('You said: "It\'s time to leave."');
    expect(b.spoken.length).toBeLessThanOrEqual(280);
    const stored = (await table.select({ id: c.id }))[0]!;
    expect(stored.turns).toEqual([{ n: 1, said: "Done. I moved it to 6 pm.", at: NOW + 20_000 }]);
    expect(stored.next_ms).toBe(NOW + 20_000 + TALK_IDLE_MS);
    expect((await get(U, `${CALLS}/${c.id}/voice/1`)).body).toBe("audio:Done. I moved it to 6 pm.");
  });

  it("say: done words close the call with no chat call; the turns run out; never once it's over or without the AI permission", async () => {
    const c = await put({ state: "answered", answered_ms: NOW, next_ms: NOW + TALK_IDLE_MS });
    const bye = (await post(U, `${CALLS}/${c.id}/say`, { words: "No, that's all." })).json();
    expect(bye).toMatchObject({ text: "Okay. Talk soon.", spoken: "Okay. Talk soon.", ended: true, turn: 1 });
    expect(chatCalls).toEqual([]);
    expect((await table.select({ id: c.id }))[0]).toMatchObject({ state: "ended", why: "done" });
    expect((await post(U, `${CALLS}/${c.id}/say`, { words: "Wait" })).statusCode).toBe(409);
    const full = await put({ state: "answered", answered_ms: NOW, next_ms: NOW + TALK_IDLE_MS, turns: Array.from({ length: MAX_TURNS }, (_x, i) => ({ n: i + 1, said: "ok", at: NOW })) });
    expect((await post(U, `${CALLS}/${full.id}/say`, { words: "And then?" })).json()).toMatchObject({ text: "I'll leave it there. It's all on your Plan.", ended: true });
    expect(chatCalls).toEqual([]);
    const ringing = await put();
    expect((await post(U, `${CALLS}/${ringing.id}/say`, { words: "hi" })).json().code).toBe("call_over");
    const on = await put({ state: "answered", answered_ms: NOW, next_ms: NOW + TALK_IDLE_MS });
    expect((await post(U, `${CALLS}/${on.id}/say`, { words: "" })).statusCode).toBe(400);
    consented.clear();
    const no = await post(U, `${CALLS}/${on.id}/say`, { words: "Move it" });
    expect([no.statusCode, no.json().code]).toEqual([403, "ai_consent_needed"]);
  });

  it("voice: 403 without the permission, 404 for a turn there isn't, the audio otherwise", async () => {
    const c = await put({ state: "answered", answered_ms: NOW, next_ms: NOW + TALK_IDLE_MS, opening: "It's time to leave." });
    expect((await get(U, `${CALLS}/${c.id}/voice/5`)).statusCode).toBe(404);
    expect((await get(U, `${CALLS}/${c.id}/voice/x`)).statusCode).toBe(404);
    expect((await get(U2, `${CALLS}/${c.id}/voice/0`)).statusCode).toBe(403);
    consented.add(U2);
    expect((await get(U2, `${CALLS}/${c.id}/voice/0`)).statusCode).toBe(404);
    expect((await get(U, `${CALLS}/${c.id}/voice/0`)).body).toBe("audio:It's time to leave.");
  });
});

// ===================================================================== Activity

describe("a missed call in Activity", () => {
  const call = { id: "dddddddd-0000-4000-8000-000000000001", name: "Zara", line: LINE, at: NOW - 30 * MIN };
  it("is a row of its own: Missed call from Zara, the line and when, opening the missed call; never counted as done", () => {
    const rows = feedOf({ now: NOW, tzOffsetMinutes: IST, jobs: [], tasks: [], events: [], words: [], calls: [call] });
    expect(rows).toEqual([{
      id: `call:${call.id}`, type: "call", bot: "plan", title: "Missed call from Zara", sub: `4:25 pm · ${LINE}`, at: call.at, mark: "waiting",
      open: { screenId: "bots.plan.call", params: { call: call.id, state: "missed" } },
    }]);
    expect(weekOf(rows, NOW - HOUR, 0).done).toBe(0);
    expect(filterFeed(rows, { kind: "jobs" })).toHaveLength(1);
    expect(filterFeed(rows, { kind: "words" })).toHaveLength(0);
    expect(withCleared(DEFAULT_SETTINGS, `call:${call.id}`)?.privacy.cleared).toEqual([`call:${call.id}`]);
  });

  it("reads only the server's missed calls since then", async () => {
    const t = memoryCallTable();
    const calls = new PlanCalls({ table: t, engine: () => null, now: () => NOW, consent: async () => false });
    await t.insert(callRow({ state: "missed", ring_at_ms: NOW - HOUR }));
    await t.insert(callRow({ state: "missed", ring_at_ms: NOW - 3 * 24 * HOUR }));
    await t.insert(callRow({ state: "ended", ring_at_ms: NOW - HOUR }));
    await t.insert(callRow({ state: "missed", ring_at_ms: NOW - HOUR, user_id: U2 }));
    expect((await calls.missedSince(U, NOW - 24 * HOUR)).map((c) => c.at)).toEqual([NOW - HOUR]);
  });

  it("Home's tasks and the Today page never list or count it; Activity does", async () => {
    const t = memoryCallTable();
    await t.insert(callRow({ state: "missed", ring_at_ms: Date.now() - 10 * MIN, ring_until_ms: Date.now() - 9 * MIN }));
    setPlanCalls(new PlanCalls({ table: t, engine: () => null, consent: async () => false }));
    const app = Fastify();
    registerBotsShellRoutes(app, { rateLimit: RL, bots: {}, code: null, jobs: null, connectors: null, media: null, artifacts: null } as never, {
      events: new MemoryEventStore(), voiceRows: async () => [], minutesSaved: async () => 0,
    });
    const tasks = (await app.inject({ method: "GET", url: `/v1/shell/tasks?tz=${IST}`, headers: as(U) })).json();
    expect(tasks.rows.some((r: { type: string }) => r.type === "call")).toBe(false);
    expect([tasks.rows.length, tasks.took]).toEqual([0, 0]);
    // The Today page's "Tasks · N" (screens/shell/today.ts) lists these rows too.
    const today = await app.inject({ method: "GET", url: `/v1/shell/today?tz=${IST}`, headers: as(U) });
    expect(today.statusCode).toBe(200);
    expect(today.json().rows).toEqual([]);
    const activity = (await app.inject({ method: "GET", url: `/v1/shell/activity?tz=${IST}`, headers: as(U) })).json();
    expect(activity.rows.map((r: { type: string }) => r.type)).toEqual(["call"]);
    await app.close();
  });
});

// ===================================================================== the bootstrap's buttons

describe("the call's buttons", () => {
  const boot = () => withAppKnobs({ labels: {}, flags: {} }).flags as Record<string, unknown>;
  it("Answer, Not now and Call back go out while calls are on; the channels never do (the phone makes them)", () => {
    const cats = boot()["push.categories"] as Array<{ id: string; actions: unknown[] }>;
    expect(cats.filter((c) => c.id.startsWith("x0_call"))).toEqual(CALL_CATEGORIES.map((c) => ({ id: c.id, actions: c.actions })));
    expect(cats.find((c) => c.id === "x0_call")!.actions[1]).toEqual({
      id: "p_notnow", title: "Not now", icon: "xmark", foreground: false, destructive: false, auth: false,
      call: { method: "POST", path: "/v1/botsapp/bots/plan/calls/{data.call}/decline" },
    });
    expect((boot()["push.android.channels"] as Array<{ id: string }>).map((c) => c.id)).not.toContain("calls");
    vi.stubEnv("BOT_CALLS", "false"); resetConfigForTests();
    expect((boot()["push.categories"] as Array<{ id: string }>).some((c) => c.id.startsWith("x0_call"))).toBe(false);
  });
});

// ===================================================================== the screens

const PHONE = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "ActionParams", "AskStream", "BotCall"];
const VOICELESS = PHONE.filter((c) => !["VoiceLive", "LiveWords", "DoubleTap"].includes(c));
const DESK = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "DeskShell"];
const V: CallView = {
  id: "eeeeeeee-0000-4000-8000-000000000001", state: "ringing", origin: "server", name: "Zara", source: "leave", line: LINE, ringAt: NOW,
  missedClock: "4:55 pm", answeredAt: null, endedAt: null, late: true, ai: true, card: W.cardOf(SEED, IST),
};
const B = `${CALLS}/${V.id}`;

async function callScreen(client: "phone" | "desktop", view: CallView | null, o: { can?: string[]; params?: Record<string, string> } = {}) {
  const s = await buildBotsScreen({
    screenId: "bots.plan.call", client, params: { call: view?.id ?? V.id, ...(o.params ?? {}) }, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" },
    can: new Set(o.can ?? (client === "phone" ? PHONE : DESK)), desk: { pages: client === "desktop", notes: false },
  }, fakeDeps({ api: view ? { [`GET ${CALLS}/${view.id}`]: view } : {} }));
  const nodes = walk(s.root!);
  return { s, nodes, json: JSON.stringify(s), texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) };
}
function actionsIn(x: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(x)) { for (const v of x) actionsIn(v, out); return out; }
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o);
  for (const v of Object.values(o)) actionsIn(v, out);
  return out;
}
const onAppear = (nodes: Node[]) => nodes.map((n) => n.on?.onAppear).filter(Boolean);

describe("the call screen", () => {
  it("talk mode: the stage, the name, Calling…, the item's buttons, End call; it answers as it opens and is never kept", async () => {
    const { s, nodes, texts, json } = await callScreen("phone", V, { params: { state: "ringing", button: "p_answer" } });
    expect(lintTree(s.root!)).toEqual([]);
    expect(s.cacheTtlSeconds).toBe(0);
    expect(texts).toEqual(expect.arrayContaining(["Zara", "Calling…", "On a call · ", "Parent-teacher meeting", "Open map", "Move", "End call", "Tap to talk"]));
    expect(nodes.some((n) => n.type === "BotStage")).toBe(true);
    expect(onAppear(nodes)).toEqual(["start"]);
    expect(s.state).toMatchObject({ phase: "connecting", ans: null, micCard: false });
    expect(Object.keys(s.actions ?? {}).sort()).toEqual(["afterSpeak", "answered", "askMic", "hangup", "listen", "reply", "say0", "spoke", "start", "talk"]);
    expect(json).toContain('"format":"elapsed"');
    const acts = actionsIn(s);
    expect(acts.find((a) => a.kind === "callEndpoint" && a.path === `${B}/answer`)).toMatchObject({ body: { talk: true }, assignTo: "ans" });
    expect(acts.some((a) => a.kind === "voiceLive" && a.duplex === true)).toBe(true);
    expect(acts.filter((a) => a.kind === "speak").every((a) => a.loud === true && a.onDone === "afterSpeak")).toBe(true);
    // Never the server's whole path through state: fillPath would encode it.
    const urls = acts.filter((a) => a.kind === "playAudio").map((a) => a.url);
    expect(urls.sort()).toEqual([`${B}/voice/$state.turn.turn`, `${B}/voice/0`]);
    // Leaving the screen from an item button ends the call first.
    const map = acts.find((a) => a.kind === "sequence" && JSON.stringify(a).includes('"go":"map"'));
    expect((map!.actions as unknown[])[0]).toBe("hangup");
    expect(json).not.toMatch(/#(?:2e7d32|4caf50|e53935|f44336|ff0000|00ff00)/i);
  });

  it("talk mode without voice on this build, or without the AI permission: no listening, the device voice, the item's buttons and End call, and no word of AI", async () => {
    const quiet = await callScreen("phone", V, { can: VOICELESS });
    expect(lintTree(quiet.s.root!)).toEqual([]);
    expect(quiet.texts).not.toContain("Tap to talk");
    expect(Object.keys(quiet.s.actions ?? {}).sort()).toEqual(["afterSpeak", "answered", "hangup", "say0", "start"]);
    expect(actionsIn(quiet.s).find((a) => a.path === `${B}/answer`)).toMatchObject({ body: { talk: false } });
    const noAi = await callScreen("phone", { ...V, ai: false });
    expect(lintTree(noAi.s.root!)).toEqual([]);
    // The call simply plays: Home's card is the one place that asks for AI, so nothing here says it, or opens You › Privacy.
    expect(noAi.texts.filter((t) => /\bAI\b|privacy|turn on/i.test(t))).toEqual([]);
    expect(JSON.stringify(noAi.s)).not.toContain("bots.privacy");
    expect(noAi.texts).toEqual(expect.arrayContaining(["End call"]));
    expect(noAi.texts).not.toContain("Tap to talk");
    expect(noAi.nodes.some((n) => n.type === "LiveWords")).toBe(false);
  });

  it("missed: Missed call · 8:12 am, the line, Call back and Close; Call back from the notification calls back as it opens", async () => {
    const missed = { ...V, state: "missed" as const, late: false, missedClock: "8:12 am" };
    const m = await callScreen("phone", missed, { params: { state: "missed" } });
    expect(lintTree(m.s.root!)).toEqual([]);
    expect(m.texts).toEqual(expect.arrayContaining(["Missed call · 8:12 am", "Parent-teacher meeting", "Call back", "Close"]));
    expect(onAppear(m.nodes)).toEqual([]);
    expect(m.s.actions?.callBack).toMatchObject({ kind: "callEndpoint", path: `${B}/back`, onSuccess: { kind: "navigate", screenId: "bots.plan.call", params: { call: "$state.back.call", button: "p_answer" }, replace: true } });
    const back = await callScreen("phone", missed, { params: { state: "missed", button: "p_callback" } });
    expect(onAppear(back.nodes)).toEqual(["callBack"]);
    // The missed push outlived the call (answered late, then hung up): its Call back still calls back.
    for (const state of ["ended", "declined"] as const) {
      const over = await callScreen("phone", { ...V, state, late: false }, { params: { state: "missed", button: "p_callback" } });
      expect(lintTree(over.s.root!), state).toEqual([]);
      expect(onAppear(over.nodes), state).toEqual(["callBack"]);
      expect(over.texts, state).toEqual(expect.arrayContaining(["Call ended", "Call back"]));
      expect(over.texts, state).not.toContain("Missed call · 4:55 pm");
      expect(over.s.actions?.callBack, state).toMatchObject({ kind: "callEndpoint", path: `${B}/back` });
    }
    // One still on is that call: it answers as it opens.
    const on = await callScreen("phone", { ...V, state: "answered", late: false }, { params: { state: "missed", button: "p_callback" } });
    expect(onAppear(on.nodes)).toEqual(["start"]);
    // Tapped from the ring while still inside the grace: it connects.
    const late = await callScreen("phone", { ...V, state: "missed", late: true }, { params: { state: "ringing" } });
    expect(onAppear(late.nodes)).toEqual(["start"]);
  });

  it("ended: Call ended and Done", async () => {
    const e = await callScreen("phone", { ...V, state: "ended", late: false });
    expect(lintTree(e.s.root!)).toEqual([]);
    expect(e.texts).toEqual(expect.arrayContaining(["Call ended", "Done"]));
    expect(e.s.actions).toBeUndefined();
  });

  it("a record on the window and on a phone without the call's JS: no voice, no Call back, the item's buttons", async () => {
    for (const [client, can] of [["desktop", DESK], ["phone", PHONE.filter((c) => c !== "BotCall")]] as const) {
      const r = await callScreen(client, { ...V, state: "missed", late: false }, { can: [...can], params: { state: "missed" } });
      expect(lintTree(r.s.root!), client).toEqual([]);
      expect(r.s.cacheTtlSeconds).toBe(0);
      expect(r.texts).toEqual(expect.arrayContaining(["Missed call · 4:55 pm", "Open map", "Open Plan"]));
      expect(r.texts).not.toContain("Call back");
      expect(r.json).not.toMatch(/"loud"|"voiceLive"|"format":"elapsed"|"playAudio"|"speak"/);
      expect(r.s.actions).toBeUndefined();
    }
  });

  it("a bill: Pay and Paid; a call that can't be read says so", async () => {
    const bill = await callScreen("phone", { ...V, source: "due", card: W.cardOf(BILL, IST) });
    expect(bill.texts).toEqual(expect.arrayContaining(["Electricity bill ₹2,340", "To BESCOM · due today", "Pay", "Paid"]));
    expect(actionsIn(bill.s).find((a) => a.path === "/v1/widgets/act")).toMatchObject({ body: { item: "pt:t1", action: "paid" } });
    const none = await callScreen("phone", null);
    expect(lintTree(none.s.root!)).toEqual([]);
    expect(none.texts).toContain("Couldn't load this call.");
  });
});

describe("the call screen in its live mode", () => {
  const RT = [...PHONE, "VoiceRealtime"];
  const LIVE: CallView = { ...V, state: "answered", late: false, answeredAt: NOW, rt: true, acted: [] };
  const ITEM_SEED: CallSeed = {
    source: "item", item: "pe:ev-visa:2026-11-12", kind: "event", eventId: "ev-visa", day: "2026-11-12", tz: IST,
    title: "Visa appointment", place: "VFS Global", at: ist(12, 11, 30), allDay: false, payee: "", pay: false, must: true,
    lead: 120, why: "A slot they cannot get again.",
  };

  it("holds one live conversation: voiceCall, the warm offer, and End call alone while it runs", async () => {
    const { s } = await callScreen("phone", LIVE, { can: RT });
    expect(lintTree(s.root!)).toEqual([]);
    const acts = actionsIn(s);
    const live = acts.find((a) => a.kind === "voiceCall")!;
    expect(live).toMatchObject({
      path: `${B}/live`, viewPath: B, statePath: "rt", phasePath: "phase", saidPath: "said", heardPath: "heard",
      onFallback: "rtFallback",
    });
    expect(live.actedState).toEqual({ paid: "paidDone" });
    expect(acts.some((a) => a.kind === "voiceCallSet" && a.op === "warm")).toBe(true);
    expect(acts.some((a) => a.kind === "voiceCallSet" && a.op === "end")).toBe(true);
    expect(acts.find((a) => a.kind === "callEndpoint" && a.path === `${B}/answer`)).toMatchObject({ body: { talk: true, rt: true } });
    expect(s.state).toMatchObject({ mode: "rt", rt: { spoke: false } });
    // The turns are still all there: the fallback is made of them.
    expect(Object.keys(s.actions ?? {})).toEqual(expect.arrayContaining(["say0", "listen", "reply", "spoke", "rtGo", "rtCall", "rtResume", "rtFallback"]));
  });

  it("without the capability, the screen is today's, node for node", async () => {
    const withRt = await callScreen("phone", LIVE, { can: PHONE });
    const asToday = await callScreen("phone", { ...LIVE, rt: false }, { can: PHONE });
    expect(withRt.s.root).toEqual(asToday.s.root);
    expect(withRt.s.actions).toEqual(asToday.s.actions);
    expect(withRt.s.state).toEqual(asToday.s.state);
    expect(JSON.stringify(withRt.s)).not.toContain("voiceCall");
  });

  it("and without the AI permission, or when the server says no, there is no live call either", async () => {
    for (const view of [{ ...LIVE, ai: false }, { ...LIVE, rt: false }]) {
      const r = await callScreen("phone", view, { can: RT });
      expect(lintTree(r.s.root!)).toEqual([]);
      expect(JSON.stringify(r.s)).not.toContain("voiceCall");
      expect(r.s.state).not.toHaveProperty("mode");
    }
  });

  it("a call the judge asked for about an event: Open map and Move, and nothing to tick", async () => {
    const view: CallView = { ...LIVE, source: "item", card: W.cardOf(ITEM_SEED, IST) };
    const r = await callScreen("phone", view, { can: RT });
    expect(lintTree(r.s.root!)).toEqual([]);
    expect(r.texts).toEqual(expect.arrayContaining(["Visa appointment", "Open map", "Move", "End call"]));
    // Nothing to tick on an event: moving it is Move. ("Done" is the ended call's own footer button.)
    expect(r.texts).not.toContain("Later");
    expect(actionsIn(r.s).find((a) => a.kind === "voiceCall")!.actedState).toEqual({});
  });

  it("a call the judge asked for about a to-do: Done and Later, ticked from what the call did out loud", async () => {
    const todo: CallSeed = { ...ITEM_SEED, kind: "todo", item: "pt:t9", taskId: "t9", eventId: undefined, place: "" };
    const r = await callScreen("phone", { ...LIVE, source: "item", card: W.cardOf(todo, IST) }, { can: RT });
    expect(lintTree(r.s.root!)).toEqual([]);
    expect(r.texts).toEqual(expect.arrayContaining(["Done", "Later"]));
    expect(actionsIn(r.s).find((a) => a.kind === "voiceCall")!.actedState).toEqual({ done: "itemDone", later: "itemDone" });
    expect(r.s.state).toMatchObject({ itemDone: false });
  });
});

describe("What pings you: the Calls row", () => {
  const settings = { monthLimitPaise: 50_000, stopAtLimit: false, notify: { ...DEFAULT_SETTINGS.notify }, privacy: {} };
  const notify = async (client: "phone" | "desktop", d: Record<string, unknown>) => {
    const s = await buildBotsScreen({
      screenId: "bots.notify", client, params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(client === "phone" ? PHONE : DESK),
      desk: { pages: client === "desktop", notes: false },
    }, fakeDeps({ api: { [`GET /v1/you/notify?tz=${IST}`]: { settings, today: null, line: null, ...d } } }));
    return { s, texts: walk(s.root!).filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) };
  };
  it("says the name it calls as, on the phone and the window, and saves the switch", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s, texts } = await notify(client, { name: "Zara", calls: true });
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts).toEqual(expect.arrayContaining(["Calls", "Zara calls you when it's time to leave or a bill is due today"]));
      expect(s.state).toMatchObject({ calls: true });
      expect(JSON.stringify(s)).toContain('"notify":{"calls":false}');
      expect((await notify(client, { calls: true })).texts).toContain("X0 calls you when it's time to leave or a bill is due today");
      expect((await notify(client, { name: "Zara", calls: false })).texts).not.toContain("Calls");
    }
  });
});

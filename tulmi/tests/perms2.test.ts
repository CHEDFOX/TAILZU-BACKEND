// BUILD 8.9.1: THE PHONE'S OWN THINGS, the server's half (docs: perms2, the design's §12).
//
// What is checked here, feature by feature:
//   - draw rules: every new row only on a phone that declares its capability AND only while its launch-dark switch is on;
//     the window's trees unchanged; Android shows the connectors where the iPhone rows would be
//   - the card rule (App Review 5.1.1(iv)), walked rather than grepped: every ask sits behind one card with ONE thing to tap,
//     and the things that ask nothing (the calendar editor, the Focus row) have no card at all
//   - calendar: the window and block bounds, the switch's enable, the DELETE, the sweeper, the "overlaps" line and its staleness
//   - reminders: the merge, both ways round, and what a deletion means on each side
//   - focus: the two doors, the widget scope, and the 12 hours
//   - motion and sleep: the payload's bounds, the Moves words, and the lock on `skills.healthSleep`
//   - the pre-ring check: the one pure decision, no answer meaning ring, and the held call's notice
//   - arrival: the armed set, and that no coordinate is ever in a route's body
//   - never AI: the new stores are imported by nothing that can reach a model
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.BOTS_APP = "true";
});

// Whoever the test says is asking: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const CAPS = await import("../../shared/types/sdui.js");
const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { walk } = await import("../src/experience/bots/lint.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");
const { PHONE_STATE, arrivalSync, focusSync, phoneRows } = await import("../src/experience/bots/screens/bots/planHome.js");
const { healthRows, hasHealthRow, movesLine } = await import("../src/experience/bots/screens/bots/health.js");
const { holdRows } = await import("../src/experience/bots/screens/you/notifyDesk.js");
const {
  CAL_BUSY, REMINDERS, DRIVE, FOCUS, MOTION, SLEEP, ARRIVAL, ARRIVAL_ANDROID, ARRIVAL_BACKGROUND_ANDROID,
} = await import("../src/experience/bots/screens/permitWords.js");
const {
  BUSY_KEEP_MS, BUSY_LIMITS, busyOverlap, readBusyPost, resetPlanBusyForTests, planBusy, startBusySweeper, sweepPlanBusy,
} = await import("../src/botsBots/planBusy.js");
const { registerPlanBusyRoutes, BUSY_PATH } = await import("../src/routes/bots/planBusy.js");
const { registerPlanFocusRoutes, FOCUS_PATH } = await import("../src/routes/bots/planFocus.js");
const { memoryPlanPrefs, focusHolding } = await import("../src/botsBots/planPrefs.js");
const { FOCUS_HOLD_MS, focusStateOf, readFocusPost, setFocus } = await import("../src/widgets/focus.js");
const { WIDGET_SCOPES } = await import("../src/widgets/token.js");
const { planReminders, goesOut, readRemItems, readApplied } = await import("../src/calendar/remindersSync.js");
const { HEALTH_LIMITS, movesOf, readHealthDays, readSource, dayKeyBefore } = await import("../src/bots/healthDays.js");
const { healthAllowed, sleepAllowed } = await import("../src/bots/healthGate.js");
const { BotHealth } = await import("../src/bots/healthService.js");
const { PUSH_CAPS } = await import("../src/push/tokens.js");
const {
  CHECK_CAP, CHECK_KIND, HOLD_MAX_MS, HOLD_RECHECK_MS, answerCheck, askCheck, checkPush, focusEnded, heldFor, holdCall, holdOf, holdWhy,
  resetChecksForTests, sweepHeld, waitedWords,
} = await import("../src/botsBots/planCallCheck.js");
// The review round's own imports: the Reminders route and its two stores, the health route, the item page's own screen, and
// the pieces whose state the switch marks read.
const { REMINDERS_PATH, registerPlanRemindersRoutes } = await import("../src/routes/bots/planReminders.js");
const { resetRemindersGoneForTests } = await import("../src/calendar/remindersGone.js");
const { calendar, resetCalendarForTests } = await import("../src/calendar/index.js");
const { calendarRows } = await import("../src/calendar/store.js");
const { registerBotHealthRoutes } = await import("../src/routes/bots/botHealth.js");
const { healthDays, resetHealthDaysForTests } = await import("../src/bots/healthDays.js");
const { HEALTH_STATE, healthRefresh, motionRows } = await import("../src/experience/bots/screens/bots/health.js");
const { planHomePhone } = await import("../src/experience/bots/screens/bots/planHome.js");
const { planItemScreens } = await import("../src/experience/bots/screens/planItem.js");
const { PlanEase, SCREEN_PLAN, arrivalIdOf } = await import("../src/botsBots/planEase.js");
const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const EV = "11111111-1111-4111-8111-111111111111";
// The call engine, for the ring that follow-through's ladder makes (no push of its own).
const { PlanCalls, memoryCallTable, checkWantFor } = await import("../src/botsBots/planCall.js");
const { MemoryPushStore } = await import("../src/push/store.js");
const { PushEngine } = await import("../src/push/engine.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");

type Any = Record<string, unknown>;
const all = (n: Node[]): Node[] => walk({ type: "Stack", children: n } as unknown as Node);
const texts = (n: Node[]): string[] => all(n).map((x) => String(((x as Any).props as Any)?.content ?? "")).filter(Boolean);
const json = (n: Node[]): string => JSON.stringify(n);

const PERMS = [
  "PERM_CALENDAR_ADD", "PERM_CALENDAR_READ", "PERM_REMINDERS", "PERM_FOCUS", "PERM_MOTION", "PERM_MOTION_DRIVE",
  "PERM_HEALTH_SLEEP_IOS", "PERM_HEALTH_SLEEP_ANDROID", "PERM_ARRIVAL", "PERM_HEALTH_IOS", "PERM_HEALTH_ANDROID",
] as const;
const envOn = (keys: readonly string[]) => { for (const k of keys) process.env[k] = "true"; resetConfigForTests(); };
const envOff = (keys: readonly string[]) => { for (const k of keys) delete process.env[k]; resetConfigForTests(); };

afterEach(() => { envOff([...PERMS, "PERM_HEALTH_SLEEP_IOS_USERS", "PERM_HEALTH_SLEEP_ANDROID_USERS"]); resetChecksForTests(); });

// ===================================================================== the card rule, walked

interface Seen { node: Any; chain: Any[] }
function withParents(n: Any, chain: Any[] = [], out: Seen[] = []): Seen[] {
  out.push({ node: n, chain });
  for (const c of (Array.isArray(n.children) ? n.children : []) as Any[]) withParents(c, [...chain, n], out);
  return out;
}
/** The 8.9.1 asks, beside 8.9's: anything in this action tree that asks the system. */
const ASKERS = ["location.area", "health.sync", "calendar.sync", "reminders.sync", "arrival.sync", "requestPermission"];
function asksSomewhere(a: unknown): boolean {
  if (!a || typeof a !== "object") return false;
  const o = a as Any;
  if (ASKERS.includes(String(o.kind)) && (o.ask === true || o.kind === "requestPermission")) return true;
  return Object.values(o).some((v) => (Array.isArray(v) ? v.some(asksSomewhere) : asksSomewhere(v)));
}
const pressable = (n: Any): boolean => !!(n.on as Any)?.onPress;
const wordsIn = (n: Any): string[] => withParents(n).map((x) => String((x.node.props as Any)?.content ?? "")).filter(Boolean);

/**
 * THE CARD RULE on the tree: every ask sits on one pressable, that pressable's own press IS the ask, its words are Continue,
 * and the card it sits in has that one pressable and no other. A second choice of any wording fails here.
 */
function checkCards(parts: Node[]): number {
  const root = { type: "Stack", children: parts } as unknown as Any;
  const seen = withParents(root);
  const askers = seen.filter((s) => asksSomewhere((s.node.on as Any)?.onPress));
  for (const { node, chain } of askers) {
    const press = (node.on as Any).onPress as Any;
    expect(ASKERS, JSON.stringify(press).slice(0, 160)).toContain(String(press.kind));
    expect(press.kind === "requestPermission" || press.ask === true).toBe(true);
    expect(wordsIn(node)).toEqual(["Continue"]);
    const card = [...chain].reverse().find((c) => c.visibleIf !== undefined);
    expect(card, "an ask with no card above it").toBeTruthy();
    const presses = withParents(card!).filter((s) => pressable(s.node));
    expect(presses.length, `the card has ${presses.length} things to tap: ${presses.map((p) => wordsIn(p.node).join(" ")).join(" | ")}`).toBe(1);
  }
  // And nothing else in the tree asks: no onAppear, onChange or any other handler carries one.
  expect(seen.filter((s) => asksSomewhere(s.node.on)).length).toBe(askers.length);
  return askers.length;
}

// ===================================================================== Plan Ease's two rows

const DAY_DATA = {
  v: 3 as const, today: "2026-11-14", tomorrow: "2026-11-15", day: "2026-11-14", label: "Today", date: "Fri 14 Nov",
  head: "", strip: { prev: null, next: null, days: [] }, needs: null, thread: [], empty: "", open: [], week: [], share: null,
  arrivals: [], phone: { busy: false, busyAt: 0, reminders: false, focusOn: false, focusHold: true, ai: false },
} as unknown as Parameters<typeof phoneRows>[1];

const planCtx = (o: { phone?: boolean; can?: string[]; platform?: "ios" | "android" } = {}) =>
  ctxFor("bots.plan", o.phone === false ? "desktop" : "phone", undefined, {
    can: new Set(["BotsKit", ...(o.can ?? [])]),
    ...(o.platform ? { platform: o.platform } : {}),
  });

describe("Plan around my calendar, and Sync with Reminders", () => {
  it("are drawn only on a phone that declares them, and only while their switch is on", () => {
    const ctx = planCtx({ can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY] });
    envOff(PERMS);
    expect(texts(phoneRows(ctx, DAY_DATA))).toEqual([]);
    envOn(["PERM_CALENDAR_READ"]);
    expect(texts(phoneRows(ctx, DAY_DATA))).toContain(CAL_BUSY.row);
    expect(texts(phoneRows(ctx, DAY_DATA))).not.toContain(REMINDERS.row);
    envOn(["PERM_REMINDERS"]);
    expect(texts(phoneRows(ctx, DAY_DATA))).toContain(REMINDERS.row);
    // The window and a phone that declares neither get nothing at all.
    expect(phoneRows(planCtx({ phone: false, can: [CAPS.CALENDAR_READ_CAPABILITY] }), DAY_DATA)).toEqual([]);
    expect(phoneRows(planCtx(), DAY_DATA)).toEqual([]);
  });

  it("the window's page is byte-identical with the switches on and off", () => {
    const desk = planCtx({ phone: false, can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY] });
    envOff(PERMS);
    const before = json(phoneRows(desk, DAY_DATA));
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS"]);
    expect(json(phoneRows(desk, DAY_DATA))).toBe(before);
  });

  it("ask the system only behind a card, and each card has one choice and no second", () => {
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS"]);
    const tree = phoneRows(planCtx({ can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY] }), DAY_DATA);
    expect(json(tree)).toContain('"kind":"calendar.sync"');
    expect(json(tree)).toContain('"kind":"reminders.sync"');
    expect(checkCards(tree)).toBe(2);
  });

  it("pin each action to its own route, and the quiet re-sync never asks", () => {
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS"]);
    const on = { ...DAY_DATA, phone: { busy: true, busyAt: 1, reminders: true, focusOn: false, ai: false } } as typeof DAY_DATA;
    const s = json(phoneRows(planCtx({ can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY] }), on));
    expect(s).toContain(`"path":"${BUSY_PATH}"`);
    expect(s).toContain('"path":"/v1/botsapp/plan/reminders/sync"');
    // Two syncs ask (the cards') and two do not (the re-syncs on appear).
    const asks = s.split('"ask":true').length - 1;
    expect(asks).toBe(2);
    expect(s).toContain('"onAppear"');
  });

  it("Android is offered the server's own connectors instead, and no iPhone row", () => {
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS"]);
    // An Android phone never declares CalendarRead1 or Reminders1 (abilities() reads the keys and the OS), so the rows it
    // gets are the connectors, through the same switch.
    const ctx = planCtx({ platform: "android", can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY] });
    const words = texts(phoneRows(ctx, DAY_DATA));
    expect(words).toContain(CAL_BUSY.androidRow);
    expect(words).toContain(REMINDERS.androidRow);
  });

  it("the arrival sync and the focus sync are drawn only behind their own switches, and never ask", () => {
    envOff(PERMS);
    // THE SWITCH OFF IS STILL A SYNC, AND AN EMPTY ONE: the phone's armed set is replaced only by an `arrival.sync`, so
    // with nothing sent the triggers armed while it was on would simply stay (on Android, geofences that never expire).
    const cleared = json(arrivalSync(planCtx({ can: [CAPS.ARRIVAL_CAPABILITY] }), DAY_DATA));
    expect(cleared).toContain('"kind":"arrival.sync"');
    expect(cleared).toContain('"items":[]');
    expect(cleared).not.toContain('"ask":true');
    // A phone whose binary never declared it is sent nothing at all, and nor is the window.
    expect(arrivalSync(planCtx({ can: [] }), DAY_DATA)).toEqual([]);
    expect(focusSync(planCtx({ can: [CAPS.FOCUS_CAPABILITY] }), DAY_DATA)).toEqual([]);
    envOn(["PERM_ARRIVAL", "PERM_FOCUS"]);
    const a = json(arrivalSync(planCtx({ can: [CAPS.ARRIVAL_CAPABILITY] }), DAY_DATA));
    expect(a).toContain('"kind":"arrival.sync"');
    expect(a).not.toContain('"ask":true');
    const f = json(focusSync(planCtx({ can: [CAPS.FOCUS_CAPABILITY] }), DAY_DATA));
    expect(f).toContain(`"path":"${FOCUS_PATH}"`);
    expect(f).not.toContain('"ask":true');
    // And nothing at all for a person who has not turned "Hold calls during a Focus" on: nothing reads the answer.
    const off = { ...DAY_DATA, phone: { ...(DAY_DATA as { phone: object }).phone, focusHold: false } } as typeof DAY_DATA;
    expect(focusSync(planCtx({ can: [CAPS.FOCUS_CAPABILITY] }), off)).toEqual([]);
  });

  it("the row's state holds no busy time, no reminder and no position", () => {
    expect(Object.keys(PHONE_STATE)).toEqual(["busyCard", "busyOn", "busyBlocked", "remCard", "remOn", "remBlocked"]);
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS"]);
    const s = json(phoneRows(planCtx({ can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY] }), DAY_DATA));
    expect(s).not.toMatch(/\b(lat|lon|latitude|longitude)\b/i);
  });

  it("the Reminders card says what is true about AI for this person, and nothing else", () => {
    envOn(["PERM_REMINDERS"]);
    const ctx = planCtx({ can: [CAPS.REMINDERS_CAPABILITY] });
    const off = json(phoneRows(ctx, DAY_DATA));
    const on = json(phoneRows(ctx, { ...DAY_DATA, phone: { ...DAY_DATA!.phone!, ai: true } } as typeof DAY_DATA));
    expect(off).toContain(REMINDERS.aiNo);
    expect(off).not.toContain(REMINDERS.aiYes);
    expect(on).toContain(REMINDERS.aiYes);
    expect(on).not.toContain(REMINDERS.aiNo);
  });
});

// ===================================================================== the Focus and driving rows

describe("Hold calls during a Focus, and Wait while I'm driving", () => {
  const notify = (o: { focusOn?: boolean } = {}) => ({
    settings: { monthLimitPaise: 0, stopAtLimit: false, notify: { done: "ping" as const, summary: false, summaryAt: 0, quiet: false, quietFrom: 0, quietTo: 0, botsOff: [] }, privacy: {} },
    today: null, line: null, calls: true, ...(o.focusOn !== undefined ? { focusOn: o.focusOn } : {}),
  });

  it("are drawn only on a phone that declares them, and only while their switch is on", () => {
    const ctx = planCtx({ can: [CAPS.FOCUS_CAPABILITY, CAPS.MOTION_CAPABILITY] });
    envOff(PERMS);
    expect(holdRows(ctx, notify() as never)).toEqual([]);
    envOn(["PERM_FOCUS"]);
    expect(texts(holdRows(ctx, notify() as never))).toContain(FOCUS.row);
    expect(texts(holdRows(ctx, notify() as never))).not.toContain("Wait while I'm driving");
    envOn(["PERM_MOTION_DRIVE"]);
    expect(texts(holdRows(ctx, notify() as never))).toContain("Wait while I'm driving");
    // The window gets neither, whatever the switches say.
    expect(holdRows(planCtx({ phone: false, can: [CAPS.FOCUS_CAPABILITY, CAPS.MOTION_CAPABILITY] }), notify() as never)).toEqual([]);
  });

  it("the Focus row has NO card, because it asks nothing, and never names the Focus", () => {
    envOn(["PERM_FOCUS"]);
    const tree = holdRows(planCtx({ can: [CAPS.FOCUS_CAPABILITY] }), notify({ focusOn: true }) as never);
    expect(checkCards(tree)).toBe(0);
    const words = texts(tree).join(" ");
    expect(words).toContain(FOCUS.live);
    expect(words).not.toMatch(/\b(Work|Sleep|Personal|Driving Focus)\b/);
    // The three steps are there, because iOS gives an app no way to open a Focus itself.
    for (const step of FOCUS.steps) expect(words).toContain(step);
  });

  it("the driving row asks for Motion behind ONE card, and reads the grant without asking", () => {
    envOn(["PERM_FOCUS", "PERM_MOTION_DRIVE"]);
    const tree = holdRows(planCtx({ can: [CAPS.FOCUS_CAPABILITY, CAPS.MOTION_CAPABILITY] }), notify({ focusOn: true }) as never);
    // Exactly one ask in the whole tree (the Focus row has none), and the card walk checks its words and its one choice.
    expect(checkCards(tree)).toBe(1);
    const s = json(tree);
    expect(s).toContain('"kind":"requestPermission"');
    expect(s).toContain('"permission":"motion"');
    // The card's own words, and the Settings way out of a refusal that iOS will not ask about again.
    const words = texts(tree).join(" ");
    expect(words).toContain(DRIVE.title);
    expect(words).toContain(DRIVE.blocked);
    // The grant is READ on appear, never asked for there: `checkPermission` shows no system prompt.
    expect(s).toContain('"kind":"checkPermission"');
    expect(s).toContain('"assignTo":"motionGranted"');
    // And the switch does not move until it is saved: the driving rows' only toggleState is on the off path, and the ask
    // itself flips nothing (a switch saying "calls wait while you drive" with no grant behind it would promise nothing).
    envOff(PERMS);
    envOn(["PERM_MOTION_DRIVE"]);
    const drive = json(holdRows(planCtx({ can: [CAPS.MOTION_CAPABILITY] }), notify() as never));
    expect(drive.split('"kind":"toggleState"').length - 1).toBe(1);
    expect(drive.indexOf('"kind":"toggleState"')).toBeLessThan(drive.indexOf('"kind":"requestPermission"'));
  });

  it("Android says Do Not Disturb, and shows no Focus Filter steps", () => {
    envOn(["PERM_FOCUS"]);
    const words = texts(holdRows(planCtx({ platform: "android", can: [CAPS.FOCUS_CAPABILITY] }), notify() as never)).join(" ");
    expect(words).toContain(FOCUS.androidRow);
    expect(words).not.toContain(FOCUS.steps[0]);
  });
});

// ===================================================================== Motion and sleep on the fitness bot

describe("Count my steps with Motion & Fitness, and Also count my sleep", () => {
  const bot = (o: { health?: boolean; sleep?: boolean } = {}) =>
    ({ slug: "gym-buddy", name: "Gym Buddy", purpose: "Counts my gym days", builtin: false, skills: { ...(o.health !== undefined ? { health: o.health } : {}), ...(o.sleep !== undefined ? { healthSleep: o.sleep } : {}) } });
  const ctx = (o: { can?: string[]; platform?: "ios" | "android"; phone?: boolean } = {}) =>
    ctxFor("bots.bot.edit", o.phone === false ? "desktop" : "phone", undefined, {
      can: new Set(["BotsKit", ...(o.can ?? [])]), ...(o.platform ? { platform: o.platform } : {}),
    });

  it("the Motion choice is drawn only with Motion1 + PERM_MOTION, and only while health is off", () => {
    const c = ctx({ can: [CAPS.MOTION_CAPABILITY] });
    envOff(PERMS);
    expect(texts(healthRows(c, bot({ health: false })))).not.toContain(MOTION.row);
    envOn(["PERM_MOTION"]);
    expect(texts(healthRows(c, bot({ health: false })))).toContain(MOTION.row);
    // Health on: one bot has one source at a time, so the choice is gone and the sleep row's place is there instead.
    expect(texts(healthRows(c, bot({ health: true })))).not.toContain(MOTION.row);
    // The window never gets it.
    expect(texts(healthRows(ctx({ phone: false, can: [CAPS.MOTION_CAPABILITY] }), bot({ health: false })))).not.toContain(MOTION.row);
  });

  it("the sleep row needs health ON, the sleep capability, and its own platform switch", () => {
    const c = ctx({ can: [CAPS.HEALTH_CAPABILITY, CAPS.HEALTH_SLEEP_CAPABILITY] });
    envOn(["PERM_HEALTH_IOS"]);
    expect(texts(healthRows(c, bot({ health: true })))).not.toContain(SLEEP.row);
    envOn(["PERM_HEALTH_SLEEP_IOS"]);
    expect(texts(healthRows(c, bot({ health: true })))).toContain(SLEEP.row);
    // Health off: no sleep row at all, because there is nothing for it to be a sub-row of.
    expect(texts(healthRows(c, bot({ health: false })))).not.toContain(SLEEP.row);
    // And the group exists for either one on its own.
    expect(hasHealthRow(c, bot({ health: true }))).toBe(true);
  });

  it("each asks behind its own card, with one choice, and the sleep sync asks for sleep alone", () => {
    envOn(["PERM_MOTION", "PERM_HEALTH_IOS", "PERM_HEALTH_SLEEP_IOS"]);
    const motion = healthRows(ctx({ can: [CAPS.MOTION_CAPABILITY] }), bot({ health: false }));
    expect(json(motion)).toContain('"source":"motion"');
    expect(checkCards(motion)).toBe(1);
    const sleep = healthRows(ctx({ can: [CAPS.HEALTH_CAPABILITY, CAPS.HEALTH_SLEEP_CAPABILITY] }), bot({ health: true }));
    expect(json(sleep)).toContain('"sleep":true');
    // The sleep request carries `sleep` and NOT `source`: it is its own request, so a refusal leaves steps working.
    expect(json(sleep)).not.toContain('"source"');
    // Two asks here, and so two cards: the health row's own (it is drawn whatever health says) and the sleep sub-row's. Each
    // has one thing to tap, which is what checkCards walks the tree for.
    expect(checkCards(sleep)).toBe(2);
  });

  it("the sleep switch goes off through the PUT that nulls the nights, and nothing else", () => {
    envOn(["PERM_HEALTH_IOS", "PERM_HEALTH_SLEEP_IOS"]);
    const s = json(healthRows(ctx({ can: [CAPS.HEALTH_CAPABILITY, CAPS.HEALTH_SLEEP_CAPABILITY] }), bot({ health: true, sleep: true })));
    expect(s).toContain('"skills":{"healthSleep":false}');
  });

  it("the Moves line says the nights only for a bot that counts them", () => {
    const moves = { workouts: 1, lastDay: "2026-11-13", lastMinutes: 40, steps: 7000, stepDays: 1, asOf: Date.now(), sleepLast: 430, sleepAvg: 410, sleepNights: 5 };
    const c = ctx({ can: [CAPS.HEALTH_CAPABILITY] });
    envOn(["PERM_HEALTH_IOS"]);
    expect(texts(movesLine(c, bot({ health: true, sleep: true }), moves)).join(" ")).toContain("slept 7 h 10 min last night");
    expect(texts(movesLine(c, bot({ health: true, sleep: true }), moves)).join(" ")).toContain("6 h 50 min a night");
    expect(texts(movesLine(c, bot({ health: true, sleep: false }), moves)).join(" ")).not.toContain("slept");
  });

  it("the gate: sleep needs health too, and its own account list is weighed", () => {
    envOn(["PERM_HEALTH_IOS"]);
    expect(healthAllowed("ios", "u1")).toBe(true);
    expect(sleepAllowed("ios", "u1")).toBe(false);
    envOn(["PERM_HEALTH_SLEEP_IOS"]);
    expect(sleepAllowed("ios", "u1")).toBe(true);
    process.env.PERM_HEALTH_SLEEP_IOS_USERS = "u2";
    resetConfigForTests();
    expect(sleepAllowed("ios", "u1")).toBe(false);
    expect(sleepAllowed("ios", "u2")).toBe(true);
    // Android's pair is its own: the iPhone's switches never let an Android phone in.
    expect(sleepAllowed("android", "u2")).toBe(false);
  });

  it("the payload's sleep is bounded, and a day with no sleep is still a day", () => {
    const day = dayKeyBefore(Date.now(), 1);
    expect(readHealthDays({ days: [{ day, steps: 100, sleepMinutes: 430 }] })[0]!.sleepMinutes).toBe(430);
    expect(readHealthDays({ days: [{ day, steps: 100 }] })[0]!.sleepMinutes).toBeUndefined();
    expect(() => readHealthDays({ days: [{ day, steps: 1, sleepMinutes: HEALTH_LIMITS.sleepMinutes.max + 1 }] })).toThrow();
    expect(() => readHealthDays({ days: [{ day, steps: 1, sleepMinutes: -1 }] })).toThrow();
    expect(readSource("motion")).toBe("motion");
    expect(readSource("anything else")).toBe("health");
  });

  it("movesOf sums the nights it has, and says nothing when it has none", () => {
    const base = { steps: 0, workouts: [] };
    const m = movesOf([{ day: "2026-11-12", ...base, sleepMinutes: 400 }, { day: "2026-11-13", ...base, sleepMinutes: 440 }]);
    expect(m.sleepLast).toBe(440);
    expect(m.sleepAvg).toBe(420);
    expect(m.sleepNights).toBe(2);
    const none = movesOf([{ day: "2026-11-13", ...base }]);
    expect(none.sleepLast).toBeNull();
    expect(none.sleepAvg).toBeNull();
  });

  it("`skills.healthSleep` goes on ONLY through the POST that asked for sleep", async () => {
    const wrote: Array<{ ref: string; on: boolean }> = [];
    const days: unknown[] = [];
    const store = {
      put: async (_u: string, _b: string, d: unknown[]) => { days.push(...d); return d.length; },
      list: async () => [], dropBot: async () => 0, dropUser: async () => 0, dropOtherSource: async () => 0, clearSleep: async () => 0, sweep: async () => 0,
    };
    const { resetHealthDaysForTests } = await import("../src/bots/healthDays.js");
    resetHealthDaysForTests(store as never);
    const bots = {
      forHealth: async () => ({ id: "b1", slug: "gym-buddy", name: "Gym Buddy", purpose: "gym", healthOn: true, sleepOn: false }),
      setHealthSkill: async () => true,
      setSleepSkill: async (_u: string, ref: string, on: boolean) => { wrote.push({ ref, on }); return true; },
      botsCounting: async () => [], useHealth: () => undefined,
    };
    const health = new BotHealth(bots as never);
    const day = dayKeyBefore(Date.now(), 1);
    // A plain steps sync, with a night riding in it: the night is DROPPED and the switch is not touched.
    await health.sync("u1", "gym-buddy", { days: [{ day, steps: 10, sleepMinutes: 400 }] });
    expect(wrote).toEqual([]);
    expect((days[0] as { sleepMinutes?: number }).sleepMinutes).toBeUndefined();
    // The sleep request: the night is kept and the switch goes on.
    await health.sync("u1", "gym-buddy", { days: [{ day, steps: 10, sleepMinutes: 400 }] }, { sleep: true });
    expect(wrote).toEqual([{ ref: "gym-buddy", on: true }]);
    expect((days[1] as { sleepMinutes?: number }).sleepMinutes).toBe(400);
    resetHealthDaysForTests();
  });
});

// ===================================================================== the busy times

describe("the busy times", () => {
  const now = Date.UTC(2026, 10, 14, 6, 0);
  const block = (h: number, len = 1) => ({ s: now + h * 3600_000, e: now + (h + len) * 3600_000, allDay: false });

  it("refuses a window or a block outside what the card promised", () => {
    expect(() => readBusyPost({ from: now, to: now + 86_400_000, blocks: [] }, now)).not.toThrow();
    expect(() => readBusyPost({ from: now, to: now + 16 * 86_400_000, blocks: [] }, now)).toThrow(/15 days/);
    expect(() => readBusyPost({ from: now - 5 * 86_400_000, to: now, blocks: [] }, now)).toThrow(/yesterday/);
    expect(() => readBusyPost({ from: now, to: now - 1, blocks: [] }, now)).toThrow(/after from/);
    const many = Array.from({ length: BUSY_LIMITS.blocks + 1 }, (_, i) => block(i % 20));
    expect(() => readBusyPost({ from: now, to: now + 14 * 86_400_000, blocks: many }, now)).toThrow(/300 at most/);
    // A block three days long, and one outside the window.
    expect(() => readBusyPost({ from: now, to: now + 14 * 86_400_000, blocks: [block(0, 72)] }, now)).toThrow(/2 days/);
    expect(() => readBusyPost({ from: now, to: now + 86_400_000, blocks: [block(48)] }, now)).toThrow(/inside the window/);
    expect(() => readBusyPost({ from: now, to: now + 86_400_000, blocks: [{ s: now + 1000, e: now + 1000 }] }, now)).toThrow(/ends after/);
  });

  it("keeps nothing but the times: no title, place, person or calendar ever reaches a block", () => {
    const read = readBusyPost({ from: now, to: now + 86_400_000, blocks: [{ ...block(1), title: "Dentist", place: "Indiranagar", calendar: "Work", people: ["a@b.c"] }] }, now);
    expect(Object.keys(read.blocks[0]!)).toEqual(["s", "e", "allDay"]);
    expect(JSON.stringify(read)).not.toMatch(/Dentist|Indiranagar|Work|a@b\.c/);
  });

  it("marks an item inside a block, and treats a stale sync as unknown", () => {
    const fresh = [{ ...block(1), syncedAt: now }];
    expect(busyOverlap(fresh, now + 3600_000 + 60_000, now + 2 * 3600_000 - 60_000, now)).toBe(true);
    expect(busyOverlap(fresh, now + 5 * 3600_000, now + 6 * 3600_000, now)).toBe(false);
    // A sync more than a day old says nothing: the person may have changed their calendar since.
    const stale = [{ ...block(1), syncedAt: now - 2 * 86_400_000 }];
    expect(busyOverlap(stale, now + 3600_000 + 60_000, now + 2 * 3600_000 - 60_000, now)).toBe(false);
  });

  it("the sweeper drops a block a day after it ends, and keeps the rest", async () => {
    resetPlanBusyForTests();
    await planBusy().replace("u1", now, now + 86_400_000, [block(1), block(20)], now);
    // Just after the first block's day: it goes, the later one stays.
    const after = now + 2 * 3600_000 + BUSY_KEEP_MS + 1000;
    expect(await sweepPlanBusy(after)).toBe(1);
    expect((await planBusy().inRange("u1", now, now + 2 * 86_400_000)).length).toBe(1);
    const stop = startBusySweeper({ now: () => after + 86_400_000 });
    stop();
  });

  it("a sync replaces its window whole, so an event taken out takes its block with it", async () => {
    resetPlanBusyForTests();
    await planBusy().replace("u1", now, now + 86_400_000, [block(1), block(3)], now);
    await planBusy().replace("u1", now, now + 86_400_000, [block(1)], now);
    expect((await planBusy().inRange("u1", now, now + 86_400_000)).length).toBe(1);
    // And one person's blocks are never another's.
    expect((await planBusy().inRange("u2", now, now + 86_400_000)).length).toBe(0);
    expect(await planBusy().clear("u1")).toBe(1);
  });

  describe("the route", () => {
    let app: FastifyInstance;
    const prefs = memoryPlanPrefs();
    beforeEach(async () => {
      resetPlanBusyForTests();
      app = Fastify();
      registerPlanBusyRoutes(app, { rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } } }, { prefs, sweeper: false });
      await app.ready();
    });
    afterEach(async () => { await app.close(); });
    const post = (body: unknown, token = "u1") => app.inject({ method: "POST", url: BUSY_PATH, headers: { authorization: `Bearer ${token}` }, payload: body as never });

    it("is refused while the switch is off, and needs a session", async () => {
      envOff(PERMS);
      expect((await post({ from: Date.now(), to: Date.now() + 1000, blocks: [], enable: true })).statusCode).toBe(403);
      envOn(["PERM_CALENDAR_READ"]);
      expect((await app.inject({ method: "POST", url: BUSY_PATH, payload: {} })).statusCode).toBe(401);
      // A bot API key is 403, not 401: the key works, this is not for it.
      expect((await app.inject({ method: "POST", url: BUSY_PATH, headers: { authorization: "Bearer tzb_abcdefghijklmnopqrstuvwxyz012345" }, payload: {} })).statusCode).toBe(403);
    });

    it("the first call must carry enable, and then the flag and the blocks land together", async () => {
      envOn(["PERM_CALENDAR_READ"]);
      const t = Date.now();
      const body = { from: t, to: t + 86_400_000, blocks: [{ s: t + 1000, e: t + 2000, allDay: false }] };
      expect((await post(body)).statusCode).toBe(409);
      const ok = await post({ ...body, enable: true });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ on: true, kept: 1 });
      expect((await prefs.get("u1"))?.calendar_busy).toBe(true);
      // Now a later sync needs no enable.
      expect((await post(body)).statusCode).toBe(200);
    });

    it("the DELETE takes every block and the flag, in one request", async () => {
      envOn(["PERM_CALENDAR_READ"]);
      const t = Date.now();
      await post({ from: t, to: t + 86_400_000, blocks: [{ s: t + 1000, e: t + 2000 }], enable: true });
      const gone = await app.inject({ method: "DELETE", url: BUSY_PATH, headers: { authorization: "Bearer u1" } });
      expect(gone.statusCode).toBe(200);
      expect(gone.json()).toEqual({ ok: true, gone: 1 });
      expect((await prefs.get("u1"))?.calendar_busy).toBe(false);
      expect((await planBusy().inRange("u1", 0, t + 86_400_000)).length).toBe(0);
    });

    it("answers a bad window with its own words, and logs no block", async () => {
      envOn(["PERM_CALENDAR_READ"]);
      const bad = await post({ from: Date.now(), to: Date.now() + 40 * 86_400_000, blocks: [], enable: true });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().message).toMatch(/15 days/);
    });
  });
});

// ===================================================================== the Reminders merge

describe("the X0 Bot Reminders list", () => {
  const task = (o: Partial<Parameters<typeof goesOut>[0]> = {}) => ({
    id: "t1", title: "Pay the bill", due: null, at: null, done: false, updatedAt: 1000, extRef: null, fromReminders: false, ...o,
  });
  const item = (o: Partial<Parameters<typeof planReminders>[0][number]> = {}) => ({
    ext: "x1", title: "Pay the bill", dueHasTime: false, done: false, changedAt: 2000, ...o,
  });

  it("a to-do with no item goes OUT, and only an open one that is undated or due within 30 days", () => {
    const now = Date.UTC(2026, 10, 14);
    expect(goesOut(task(), now)).toBe(true);
    expect(goesOut(task({ done: true }), now)).toBe(false);
    expect(goesOut(task({ due: "2026-11-20" }), now)).toBe(true);
    expect(goesOut(task({ due: "2027-03-01" }), now)).toBe(false);
    const plan = planReminders([], [task()], now);
    expect(plan.ops.add).toEqual([{ id: "t1", title: "Pay the bill", dueHasTime: false }]);
  });

  it("the newer change wins, each way round", () => {
    const now = Date.now();
    // The item changed later: the to-do is written here.
    const a = planReminders([item({ title: "Pay the water bill", changedAt: 5000 })], [task({ extRef: "x1", updatedAt: 1000 })], now);
    expect(a.writes.change[0]).toMatchObject({ id: "t1", title: "Pay the water bill" });
    expect(a.ops.update).toEqual([]);
    // The to-do changed later: the item is updated on the phone.
    const b = planReminders([item({ title: "Pay the water bill", changedAt: 500 })], [task({ extRef: "x1", updatedAt: 9000 })], now);
    expect(b.ops.update[0]).toMatchObject({ ext: "x1", title: "Pay the bill" });
    expect(b.writes.change).toEqual([]);
    // Nothing differs: nothing at all happens.
    const c = planReminders([item()], [task({ extRef: "x1" })], now);
    expect(c.ops.update).toEqual([]);
    expect(c.writes.change).toEqual([]);
  });

  it("a deletion in Reminders deletes only a to-do that CAME from Reminders", () => {
    const now = Date.now();
    const born = planReminders([], [task({ extRef: "x1", fromReminders: true })], now);
    expect(born.writes.remove).toEqual(["t1"]);
    expect(born.writes.unlink).toEqual([]);
    const mine = planReminders([], [task({ extRef: "x1", fromReminders: false })], now);
    expect(mine.writes.remove).toEqual([]);
    expect(mine.writes.unlink).toEqual(["t1"]);
  });

  it("a deletion in X0 removes the item the phone made, and never one the person made in Reminders", () => {
    const now = Date.now();
    // The phone says it made this item from an X0 to-do, and that to-do is gone: the item goes.
    expect(planReminders([item({ mine: true })], [], now).ops.remove).toEqual(["x1"]);
    // An item the person made in Reminders becomes a to-do instead.
    const made = planReminders([item()], [], now);
    expect(made.ops.remove).toEqual([]);
    expect(made.writes.make[0]).toMatchObject({ ext: "x1", title: "Pay the bill" });
  });

  it("an item whose {applied} was lost is LINKED, not copied into a second to-do", () => {
    const now = Date.now();
    // The to-do went out last round, the phone made the item, and the second request never landed: the to-do still has no
    // link, and its own item now arrives as an ext nobody knows.
    const back = planReminders([item({ ext: "x9" })], [task()], now);
    expect(back.writes.make).toEqual([]);
    expect(back.writes.link).toEqual([{ id: "t1", ext: "x9" }]);
    // And it is not sent out a second time in the same breath.
    expect(back.ops.add).toEqual([]);
    // A DIFFERENT item is still a new to-do, and the to-do still goes out.
    const other = planReminders([item({ ext: "x9", title: "Buy milk" })], [task()], now);
    expect(other.writes.link).toEqual([]);
    expect(other.writes.make[0]).toMatchObject({ ext: "x9", title: "Buy milk" });
    expect(other.ops.add).toEqual([{ id: "t1", title: "Pay the bill", dueHasTime: false }]);
    // Two to-dos with the same words take one item each, not both the same one.
    const twice = planReminders([item({ ext: "x9" })], [task(), task({ id: "t2" })], now);
    expect(twice.writes.link).toEqual([{ id: "t1", ext: "x9" }]);
    expect(twice.ops.add).toEqual([{ id: "t2", title: "Pay the bill", dueHasTime: false }]);
  });

  it("a due date goes both ways, with its time only when it had one", () => {
    const now = Date.now();
    const at = Date.UTC(2026, 10, 20, 12, 0);
    const withTime = planReminders([item({ changedAt: 1 })], [task({ extRef: "x1", due: "2026-11-20", at, updatedAt: 99 })], now);
    expect(withTime.ops.update[0]).toMatchObject({ dueIso: new Date(at).toISOString(), dueHasTime: true });
    const dayOnly = planReminders([item({ changedAt: 1 })], [task({ extRef: "x1", due: "2026-11-20", updatedAt: 99 })], now);
    expect(dayOnly.ops.update[0]).toMatchObject({ dueIso: "2026-11-20", dueHasTime: false });
  });

  it("reads what the phone sent, and refuses what it cannot", () => {
    expect(readRemItems({ listId: "L", items: [{ ext: "x1", title: "  a  b ", changedAt: 5 }] }).items[0]).toMatchObject({ ext: "x1", title: "a b" });
    expect(() => readRemItems({ items: [{ title: "no ext" }] })).toThrow(/each item has its own ext/);
    expect(() => readRemItems({ items: "nope" })).toThrow(/items is/);
    expect(() => readRemItems({ items: [{ ext: "x", dueIso: "not a date" }] })).toThrow(/is a date/);
    expect(readApplied({ applied: [{ id: "t1", ext: "x1" }] })).toEqual([{ id: "t1", ext: "x1" }]);
    expect(() => readApplied({ applied: [{ id: "t1" }] })).toThrow();
    // A title longer than the cap is cut, not refused: the phone's own list may hold one.
    expect(readRemItems({ items: [{ ext: "x", title: "a".repeat(300) }] }).items[0]!.title.length).toBe(200);
  });
});

// ===================================================================== Focus

describe("whether a Focus is on", () => {
  it("the widgets' token has a scope of its own for the filter's post", () => {
    expect(WIDGET_SCOPES).toContain("focus.set");
    // And the two it had, unchanged.
    expect(WIDGET_SCOPES).toContain("needs.answer");
    expect(WIDGET_SCOPES).toContain("task.done");
  });

  it("reads only on/off and the one hold, and never which Focus", () => {
    // NO HOLD IN THE BODY IS NO CHOICE, not "calls": the end of a Focus arrives with the parameter unset.
    expect(readFocusPost({ on: true })).toEqual({ on: true, source: "filter" });
    expect(readFocusPost({ on: false, hold: "callsAndPings", source: "dnd" })).toEqual({ on: false, hold: "callsAndPings", source: "dnd" });
    expect(readFocusPost({ on: true, hold: "everything" })).toMatchObject({ error: expect.stringContaining("hold") });
    expect(readFocusPost({})).toMatchObject({ error: expect.stringContaining("on is true or false") });
    // A body that names a Focus cannot carry it: the extra field is simply not read.
    expect(Object.keys(readFocusPost({ on: true, focus: "Work", mode: "Sleep" }) as object)).toEqual(["on", "source"]);
  });

  it("an end-of-Focus post does not overwrite what the person chose to hold", async () => {
    const prefs = memoryPlanPrefs();
    const now = Date.UTC(2026, 10, 14, 6, 0);
    await setFocus(prefs, "u1", { on: true, hold: "callsAndPings", source: "filter" }, now);
    expect((await prefs.get("u1"))?.focus?.hold).toBe("callsAndPings");
    // iOS runs perform() with the DEFAULT values on end, so the end post carries no hold at all — and one that does carry
    // a hold is still meaningless while `on` is false. Neither may be read as a choice.
    await setFocus(prefs, "u1", { on: false, source: "filter" }, now + 1000);
    expect((await prefs.get("u1"))?.focus).toMatchObject({ on: false, hold: "callsAndPings" });
    await setFocus(prefs, "u1", { on: false, hold: "calls", source: "filter" }, now + 2000);
    expect((await prefs.get("u1"))?.focus?.hold).toBe("callsAndPings");
    // A real "on" with a choice still changes it.
    await setFocus(prefs, "u1", { on: true, hold: "calls", source: "filter" }, now + 3000);
    expect((await prefs.get("u1"))?.focus?.hold).toBe("calls");
    // And Android, which can say nothing about what waits, keeps the choice too.
    await setFocus(prefs, "u1", { on: true, source: "dnd" }, now + 4000);
    expect((await prefs.get("u1"))?.focus).toMatchObject({ on: true, hold: "calls", source: "dnd" });
  });

  it("is believed for 12 hours and no longer", () => {
    const now = Date.UTC(2026, 10, 14, 6, 0);
    const state = focusStateOf({ on: true, hold: "calls", source: "filter" }, now);
    expect(state.until).toBe(now + FOCUS_HOLD_MS);
    expect(focusHolding(state, now + 1000)).toBe(true);
    expect(focusHolding(state, now + FOCUS_HOLD_MS + 1)).toBe(false);
    expect(focusHolding(null, now)).toBe(false);
    // Off is off, however fresh.
    expect(focusHolding(focusStateOf({ on: false, hold: "calls", source: "dnd" }, now), now)).toBe(false);
  });

  it("the end of a Focus is the one moment the notice about what waited goes", async () => {
    const prefs = memoryPlanPrefs();
    const now = Date.UTC(2026, 10, 14, 6, 0);
    expect((await setFocus(prefs, "u1", { on: true, hold: "calls", source: "filter" }, now)).ended).toBe(false);
    expect((await setFocus(prefs, "u1", { on: false, hold: "calls", source: "filter" }, now + 1000)).ended).toBe(true);
    // And a second "off" is not an ending: nothing was holding by then.
    expect((await setFocus(prefs, "u1", { on: false, hold: "calls", source: "filter" }, now + 2000)).ended).toBe(false);
  });

  describe("the app's own door", () => {
    let app: FastifyInstance;
    const prefs = memoryPlanPrefs();
    beforeEach(async () => {
      app = Fastify();
      registerPlanFocusRoutes(app, { rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } } }, { prefs });
      await app.ready();
    });
    afterEach(async () => { await app.close(); });

    it("is refused while the switch is off, and takes only the session", async () => {
      envOff(PERMS);
      expect((await app.inject({ method: "POST", url: FOCUS_PATH, headers: { authorization: "Bearer u1" }, payload: { on: true } })).statusCode).toBe(403);
      envOn(["PERM_FOCUS"]);
      expect((await app.inject({ method: "POST", url: FOCUS_PATH, payload: { on: true } })).statusCode).toBe(401);
      const ok = await app.inject({ method: "POST", url: FOCUS_PATH, headers: { authorization: "Bearer u1" }, payload: { on: true } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ ok: true, on: true });
      expect((await prefs.get("u1"))?.focus?.on).toBe(true);
    });

    it("refuses a body that is not the two words", async () => {
      envOn(["PERM_FOCUS"]);
      const bad = await app.inject({ method: "POST", url: FOCUS_PATH, headers: { authorization: "Bearer u1" }, payload: { on: "yes" } });
      expect(bad.statusCode).toBe(400);
    });
  });
});

// ===================================================================== the pre-ring check

describe("the pre-ring check", () => {
  it("the token cap is declared, and the push carries nothing but the question", () => {
    expect(PUSH_CAPS).toContain(CHECK_CAP);
    const ios = checkPush("ExponentPushToken[a]", "ios", { call: "c1", want: ["driving", "focus"] });
    expect(ios.contentAvailable).toBe(true);
    expect(ios.priority).toBe("normal");
    expect(ios.title).toBe("");
    expect(ios.body).toBe("");
    expect(ios.data).toEqual({ kind: CHECK_KIND, call: "c1", want: ["driving", "focus"] });
    const android = checkPush("ExponentPushToken[a]", "android", { call: "c1", want: ["driving"] });
    expect(android.dataOnly).toBe(true);
    expect(android.priority).toBe("high");
  });

  it("the whole decision, in one pure function", () => {
    // Nothing said: ring, always. A silent push is best effort.
    expect(holdOf({}, { source: "leave" })).toBe("ring");
    expect(holdOf({ driving: false, focus: false }, { source: "leave" })).toBe("ring");
    // Driving: a leave-by is skipped (they are on their way); anything else waits.
    expect(holdOf({ driving: true }, { source: "leave" })).toBe("skip");
    expect(holdOf({ driving: true }, { source: "due" })).toBe("hold");
    expect(holdOf({ driving: true }, { source: "item" })).toBe("hold");
    // A Focus, or a busy time in their own calendar: a leave-by or a bill comes as a notice; the rest waits.
    expect(holdOf({ focus: true }, { source: "leave" })).toBe("notice");
    expect(holdOf({ focus: true }, { source: "due" })).toBe("notice");
    expect(holdOf({ focus: true }, { source: "follow" })).toBe("hold");
    expect(holdOf({ inBlock: true }, { source: "leave" })).toBe("notice");
    expect(holdOf({ inBlock: true }, { source: "item" })).toBe("hold");
    // A must-not-miss item rings through both.
    expect(holdOf({ focus: true }, { source: "item", must: true })).toBe("ring");
    expect(holdOf({ inBlock: true }, { source: "item", must: true })).toBe("ring");
    // Driving wins over a Focus: the person is in a car either way.
    expect(holdOf({ driving: true, focus: true }, { source: "leave" })).toBe("skip");
    expect(holdWhy("skip", { driving: true })).toBe("already on the way");
    expect(holdWhy("hold", { focus: true })).toBe("a focus is on");
    expect(holdWhy("notice", { inBlock: true })).toBe("busy in their calendar");
  });

  it("asks nothing when no phone can answer, and nothing when nothing is wanted", async () => {
    const push = { devicesWith: async () => [], sendData: async () => [] };
    expect(await askCheck({ userId: "u1", want: ["driving"], push })).toEqual({});
    expect(await askCheck({ userId: "u1", want: [], push: { devicesWith: async () => { throw new Error("asked"); }, sendData: async () => [] } })).toEqual({});
  });

  it("waits for the phone, keeps only what it asked about, and rings when nothing comes", async () => {
    const sent: unknown[] = [];
    const push = {
      devicesWith: async (_u: string, platform: "ios" | "android") => (platform === "ios" ? [{ token: "t", locale: null }] : []),
      sendData: async (m: unknown[]) => { sent.push(...m); return []; },
    };
    // The answer arrives: only the word that was asked for is kept.
    const waiting = askCheck({ userId: "u1", want: ["driving"], push, waitMs: 2000, id: "c1" });
    await new Promise((r) => setTimeout(r, 5));
    expect(sent.length).toBe(1);
    expect(answerCheck("u1", "c1", { driving: true, focus: true })).toBe(true);
    expect(await waiting).toEqual({ driving: true });
    // Nothing comes: empty, which means ring.
    const quiet = askCheck({ userId: "u1", want: ["driving"], push, waitMs: 10, id: "c2" });
    expect(await quiet).toEqual({});
    // A late answer, or one for a call this server never asked about, changes nothing.
    expect(answerCheck("u1", "c2", { driving: true })).toBe(false);
    expect(answerCheck("u1", "nope", { driving: true })).toBe(false);
    // And one person can never answer for another.
    const mine = askCheck({ userId: "u1", want: ["focus"], push, waitMs: 20, id: "c3" });
    expect(answerCheck("u2", "c3", { focus: true })).toBe(false);
    expect(await mine).toEqual({});
  });

  it("a held call becomes a notice: at the end of a Focus, as one, and after an hour anyway", async () => {
    resetChecksForTests();
    const sent: string[] = [];
    const lines: string[][] = [];
    const now = Date.UTC(2026, 10, 14, 6, 0);
    const hold = (line: string, why: "driving" | "focus" = "focus") =>
      holdCall({ userId: "u1", why, line, notice: async () => { sent.push(line); }, now });
    // One thing waiting: it goes as its own notice, which says more than a summary would.
    hold("Pay the electricity bill");
    expect(heldFor("u1")).toBe(1);
    expect(await focusEnded("u1", now)).toBe(1);
    expect(sent).toEqual(["Pay the electricity bill"]);
    expect(heldFor("u1")).toBe(0);
    // Three: ONE notice lists them.
    sent.length = 0;
    hold("Pay the electricity bill");
    hold("Call the plumber");
    hold("Leave for the dentist");
    expect(await focusEnded("u1", now, { summary: async (_u, l) => { lines.push(l); } })).toBe(3);
    expect(sent).toEqual([]);
    expect(lines[0]).toEqual(["Pay the electricity bill", "Call the plumber", "Leave for the dentist"]);
    expect(waitedWords(lines[0]!)).toEqual({ title: "3 things waited", body: "Pay the electricity bill, and 2 more. Your Focus is over." });
    // A driving hold is not released by a Focus ending, and goes on its own after an hour.
    sent.length = 0;
    hold("Pick up the parcel", "driving");
    expect(await focusEnded("u1", now)).toBe(0);
    expect(await sweepHeld(now + 1000)).toBe(0);
    expect(await sweepHeld(now + HOLD_MAX_MS + 1000)).toBe(1);
    expect(sent).toEqual(["Pick up the parcel"]);
  });
});

// ===================================================================== arrival

describe("Remind me when I get there", () => {
  it("the contract's bounds are what the server sends", () => {
    // The shape the phone checks again: an id of its own, a radius in range, short words.
    const item: typeof CAPS extends never ? never : import("../../shared/types/sdui.js").ArrivalItem = {
      id: "e1", lat: 12.93, lon: 77.62, radiusM: 150, title: "You're at Koramangala", body: "Pick up dry cleaning", screen: "bots.plan.item",
    };
    expect(item.id).toMatch(/^[a-z0-9_-]{1,64}$/);
    expect(item.radiusM).toBeGreaterThanOrEqual(100);
    expect(item.radiusM).toBeLessThanOrEqual(500);
    expect(item.title.length).toBeLessThanOrEqual(60);
    expect(item.body.length).toBeLessThanOrEqual(140);
  });

  it("the words say the phone watches, and that nothing comes back", () => {
    expect(ARRIVAL.lines.join(" ")).toContain("never told where you are or that you arrived");
    expect(ARRIVAL.shareSub).toContain("Nothing comes back");
  });
});

// ===================================================================== never an AI service

describe("nothing new reaches an AI service", () => {
  const SRC = path.resolve(import.meta.dirname, "../src");
  const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");
  /** The files that may never be able to reach one of the new stores (the health rule's own NEVER list, perms §4.6). */
  const NEVER = ["bots/run.ts", "bots/memory.ts", "bots/shared.ts", "prompts.ts", "bots/service.ts", "ads/meta.ts"];

  it("the busy times and the pre-ring answers are imported by no prompt builder, tool or ads file", () => {
    for (const f of NEVER) {
      const src = read(f);
      for (const store of ["planBusy", "planCallCheck"]) {
        expect(src, `${f} imports ${store}`).not.toMatch(new RegExp(`from "[^"]*${store}\\.js"`));
      }
    }
  });

  it("the sleep minutes live where the steps do, behind the same import line", () => {
    // Sleep is a column of bot_health_days, so it is already inside the health rule: the test that holds that rule up is
    // tests/health-never.test.ts, and this is the line that says why no new one is needed.
    expect(read("bots/healthDays.ts")).toContain("sleep_minutes");
    for (const f of NEVER) expect(read(f)).not.toMatch(/from "[^"]*healthDays\.js"/);
  });
});

// ===================================================================== what the phone really sends (the review's own round)
//
// Every one of these drives the shapes the phone's own code builds, not shapes written here: the second request of a
// Reminders sync on the pinned path, its ISO `changedAt`, the health route's `source` and `sleep`, the widgets token's
// scope, and the page state the switch marks read. This is the round that would have caught the 400, the changedAt
// mismatch and the switches drawing OFF while the feature was on.

describe("the Reminders sync, both requests, on the one pinned path", () => {
  let app: FastifyInstance;
  const prefs = memoryPlanPrefs();
  /** The phone's own item shape (F:app/src/device/remindersCore.ts cleanItems): `changedAt` is an ISO string. */
  const ITEM = { ext: "r1", title: "Buy milk", dueHasTime: false, done: false, changedAt: new Date(10).toISOString() };

  beforeEach(async () => {
    resetRemindersGoneForTests();
    resetCalendarForTests();
    await prefs.patch("u1", { reminders_on: true });
    app = Fastify();
    registerPlanRemindersRoutes(app, { rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } } }, { calendar: calendar(), prefs });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const sync = (body: unknown) => app.inject({
    method: "POST", url: `${REMINDERS_PATH}/sync`, headers: { authorization: "Bearer u1" }, payload: body as never,
  });

  it("takes {applied} on the sync path, so the link lands and nothing is copied twice", async () => {
    envOn(["PERM_REMINDERS", "PLAN_V2"]);
    const made = await calendar().addTask("u1", { title: "Buy oats" }, { kind: "me" }, null);
    // Round one: the to-do goes out to the list.
    const first = await sync({ listId: "L", items: [] });
    expect(first.statusCode).toBe(200);
    expect(first.json().add.map((a: { id: string }) => a.id)).toEqual([made.id]);
    // The phone made an item for it and posts the link to THE SAME PATH it just posted the items to (the contract pins one).
    const applied = await sync({ applied: [{ id: made.id, ext: "r9" }] });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toEqual({ ok: true, linked: 1 });
    // Round two: nothing to add (it is linked) and nothing to make (the item is its own to-do's).
    const second = await sync({ listId: "L", items: [{ ...ITEM, ext: "r9", title: "Buy oats" }] });
    expect(second.json().add).toEqual([]);
    // And no second copy was made from the item: the one to-do is still the only one.
    expect((await calendarRows().tasks.open("u1", 50)).length).toBe(1);
  });

  it("reads the phone's ISO changedAt, so an edit made in Reminders wins", async () => {
    envOn(["PERM_REMINDERS", "PLAN_V2"]);
    const made = await calendar().addTask("u1", { title: "Buy milk" }, { kind: "me" }, null);
    await sync({ applied: [{ id: made.id, ext: "r1" }] });
    // The item was changed in Reminders long after the to-do's own last change.
    const edited = { ...ITEM, title: "Buy oat milk", changedAt: new Date(Date.now() + 60_000).toISOString() };
    const r = await sync({ listId: "L", items: [edited] });
    expect(r.statusCode).toBe(200);
    // The to-do took the item's words, and the phone is told to change nothing back.
    expect(r.json().update).toEqual([]);
    expect((await calendar().task("u1", made.id))?.title).toBe("Buy oat milk");
  });

  it("the DELETE still works once the switch has gone off, and takes the links and the marks", async () => {
    envOn(["PERM_REMINDERS", "PLAN_V2"]);
    const made = await calendar().addTask("u1", { title: "Buy milk" }, { kind: "me" }, null);
    await sync({ applied: [{ id: made.id, ext: "r1" }] });
    envOff(PERMS);
    const off = await app.inject({ method: "DELETE", url: REMINDERS_PATH, headers: { authorization: "Bearer u1" } });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ ok: true, unlinked: 1 });
    expect((await prefs.get("u1"))?.reminders_on).toBe(false);
    // But a SYNC is still refused while it is off: only stopping is let through.
    expect((await sync({ listId: "L", items: [] })).statusCode).toBe(403);
  });
});

describe("the Reminders merge, after the review", () => {
  const task = (o: Partial<Parameters<typeof planReminders>[1][number]> = {}) => ({
    id: "t1", title: "Buy milk", due: null, at: null, done: false, updatedAt: 1, extRef: "r1", fromReminders: true, ...o,
  });

  it("a to-do deleted HERE takes its item out of the list, instead of being copied back in", () => {
    const item = { ext: "r1", title: "Buy milk", dueHasTime: false, done: false, changedAt: 5 };
    // Without the mark, the item has no to-do and reads as a new one (what used to happen, every sync).
    expect(planReminders([item], [], 10).writes.make.map((m) => m.ext)).toEqual(["r1"]);
    // With it: the item goes, and the mark is forgotten in the same round.
    const p = planReminders([item], [], 10, ["r1"]);
    expect(p.ops.remove).toEqual(["r1"]);
    expect(p.writes.make).toEqual([]);
    expect(p.writes.forget).toEqual(["r1"]);
  });

  it("a mark whose item has already gone is forgotten too, so it cannot act twice", () => {
    expect(planReminders([], [], 10, ["r1"]).writes.forget).toEqual(["r1"]);
  });

  it("a DONE to-do out of the phone's read is unlinked, never deleted (the 7-day window is not a deletion)", () => {
    // Open and missing: deleted in Reminders, so the to-do goes.
    expect(planReminders([], [task()], 10).writes.remove).toEqual(["t1"]);
    // Done and missing: the phone just stopped sending it (TulmiReminders doneDays), so the link goes and the to-do stays.
    const p = planReminders([], [task({ done: true })], 10);
    expect(p.writes.remove).toEqual([]);
    expect(p.writes.unlink).toEqual(["t1"]);
  });

  it("readRemItems takes the phone's ISO changedAt and plain milliseconds alike", () => {
    const iso = readRemItems({ listId: "L", items: [{ ext: "r1", title: "x", dueHasTime: false, done: false, changedAt: "2026-11-14T09:00:00Z" }] });
    expect(iso.items[0]!.changedAt).toBe(Date.parse("2026-11-14T09:00:00Z"));
    const ms = readRemItems({ listId: "L", items: [{ ext: "r1", title: "x", dueHasTime: false, done: false, changedAt: 1234 }] });
    expect(ms.items[0]!.changedAt).toBe(1234);
    // And anything it cannot read is 0, which lets the to-do win rather than guess.
    expect(readRemItems({ listId: "L", items: [{ ext: "r1", title: "x", changedAt: "not a date" }] }).items[0]!.changedAt).toBe(0);
  });
});

describe("the page's own state follows the data", () => {
  it("the two switch marks start where the server says the feature is", () => {
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS"]);
    const ctx = planCtx({ can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY] });
    const off = planHomePhone(ctx, DAY_DATA) as unknown as { state?: Record<string, unknown> };
    expect(off.state?.busyOn).toBe(false);
    expect(off.state?.remOn).toBe(false);
    const on = { ...DAY_DATA, phone: { busy: true, busyAt: 1, reminders: true, focusOn: false, ai: false } } as typeof DAY_DATA;
    const drawn = planHomePhone(ctx, on) as unknown as { state?: Record<string, unknown> };
    expect(drawn.state?.busyOn).toBe(true);
    expect(drawn.state?.remOn).toBe(true);
  });

  it("the sleep mark starts where the bot says it is", () => {
    expect(Object.keys(HEALTH_STATE)).toContain("sleepOn");
    const seeded = (sleep: boolean) => ({ ...HEALTH_STATE, healthOn: true, sleepOn: sleep });
    expect(seeded(true).sleepOn).toBe(true);
    expect(seeded(false).sleepOn).toBe(false);
  });
});

describe("Android gets Android's own rows, and never the iPhone's", () => {
  it("an Android phone that declares the iPhone names still gets only the connectors", () => {
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS", "PERM_MOTION", "PERM_MOTION_DRIVE", "PERM_ARRIVAL"]);
    const ctx = planCtx({ platform: "android", can: [CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY, CAPS.MOTION_CAPABILITY, CAPS.ARRIVAL_CAPABILITY] });
    const words = texts(phoneRows(ctx, DAY_DATA));
    expect(words).toContain(CAL_BUSY.androidRow);
    expect(words).toContain(REMINDERS.androidRow);
    // THE IPHONE ROWS AND THE IPHONE WORDS ARE NOT THERE (spec §1 rule 9, Q8), whatever the binary declared.
    expect(words).not.toContain(CAL_BUSY.row);
    expect(words).not.toContain(REMINDERS.row);
    expect(json(phoneRows(ctx, DAY_DATA))).not.toContain("your iPhone's calendars");
    // Nor the other three iPhone-only rows.
    expect(holdRows(ctx, { settings: { notify: {} }, today: null, line: null, calls: true } as never)).toEqual([]);
    // No armed set goes out, but the empty one does, so an Android phone armed before the switch went off is cleared.
    const andCleared = json(arrivalSync(ctx, DAY_DATA));
    expect(andCleared).toContain('"items":[]');
    expect(andCleared).not.toContain('"ask":true');
    expect(motionRows(ctx, { slug: "gym", name: "Gym Buddy", purpose: "gym days", builtin: false, skills: {} })).toEqual([]);
  });

  it("a spec-compliant Android (no iPhone names) still gets the connectors, through the switch alone", () => {
    envOn(["PERM_CALENDAR_READ", "PERM_REMINDERS"]);
    const ctx = planCtx({ platform: "android" });
    const words = texts(phoneRows(ctx, DAY_DATA));
    expect(words).toContain(CAL_BUSY.androidRow);
    expect(words).toContain(REMINDERS.androidRow);
    // And nothing at all with the switches off.
    envOff(PERMS);
    expect(phoneRows(ctx, DAY_DATA)).toEqual([]);
  });
});

describe("the Motion bot keeps its own reader", () => {
  const gym = (skills: Record<string, unknown>) => ({ slug: "gym-buddy", name: "Gym Buddy", purpose: "Counts my gym days", builtin: false, skills });
  const iosCtx = (can: string[]) => ctxFor("bots.edit", "phone", undefined, { can: new Set(["BotsKit", ...can]), platform: "ios" });

  it("the quiet re-read asks for the reader the person chose, and for the nights when it counts them", () => {
    envOn(["PERM_HEALTH_IOS", "PERM_MOTION", "PERM_HEALTH_SLEEP_IOS"]);
    const ctx = iosCtx([CAPS.HEALTH_CAPABILITY, CAPS.MOTION_CAPABILITY, CAPS.HEALTH_SLEEP_CAPABILITY]);
    const motion = json(healthRefresh(ctx, gym({ health: true, healthSource: "motion" })));
    expect(motion).toContain('"source":"motion"');
    expect(motion).not.toContain('"sleep":true');
    const sleeping = json(healthRefresh(ctx, gym({ health: true, healthSleep: true })));
    expect(sleeping).toContain('"source":"health"');
    expect(sleeping).toContain('"sleep":true');
    // Still never a prompt: `ask: false` on every one of them.
    expect(sleeping).toContain('"ask":false');
    expect(sleeping).not.toContain('"ask":true');
  });

  it("a Motion bot's row says Motion, and is offered no sleep", () => {
    envOn(["PERM_HEALTH_IOS", "PERM_MOTION", "PERM_HEALTH_SLEEP_IOS"]);
    const ctx = iosCtx([CAPS.HEALTH_CAPABILITY, CAPS.MOTION_CAPABILITY, CAPS.HEALTH_SLEEP_CAPABILITY]);
    const words = texts(healthRows(ctx, gym({ health: true, healthSource: "motion" }))).join(" ");
    expect(words).toContain(MOTION.rowOn);
    expect(words).not.toContain("Apple Health");
    expect(words).not.toContain(SLEEP.row);
    // An Apple Health bot still gets both.
    const health = texts(healthRows(ctx, gym({ health: true }))).join(" ");
    expect(health).toContain("Apple Health");
    expect(health).toContain(SLEEP.row);
  });

  it("a Motion bot's quiet re-read is behind PERM_MOTION, not PERM_HEALTH_IOS", () => {
    process.env.PERM_HEALTH_IOS = ""; envOn(["PERM_MOTION"]);
    const ctx = iosCtx([CAPS.HEALTH_CAPABILITY, CAPS.MOTION_CAPABILITY]);
    expect(healthRefresh(ctx, gym({ health: true, healthSource: "motion" })).length).toBe(1);
    // And an Apple Health bot's is not drawn at all with that switch off.
    expect(healthRefresh(ctx, gym({ health: true }))).toEqual([]);
  });

  it("a sync for a bot already counting keeps its reader, whatever the body says", async () => {
    resetHealthDaysForTests();
    const today = dayKeyBefore(Date.now(), 0);
    await healthDays().put("u1", "b1", [{ day: today, steps: 4000, workouts: [] }], "motion");
    let source = "motion";
    const bots = {
      forHealth: async () => ({ id: "b1", slug: "gym", name: "Gym Buddy", purpose: "gym days", healthOn: true, sleepOn: false, source }),
      setHealthSkill: async (_u: string, _r: string, _on: boolean, s?: string) => { source = s ?? "health"; return true; },
      setSleepSkill: async () => true, botsCounting: async () => [], useHealth: () => {},
    };
    const h = new BotHealth(bots as never);
    // The quiet re-read, with no `source` in the body: the Motion days stay.
    await h.sync("u1", "gym", { tz: 330, days: [{ day: today, steps: 4100, workouts: [] }] }, {});
    expect((await healthDays().list("u1", "b1")).length).toBe(1);
    // And sleep is refused for it: Motion & Fitness counts no nights.
    await expect(h.sync("u1", "gym", { tz: 330, days: [] }, { sleep: true })).rejects.toThrow(/sleep/i);
  });

  it("two syncs keep the nights, and the second one updates them", async () => {
    resetHealthDaysForTests();
    const today = dayKeyBefore(Date.now(), 0);
    await healthDays().put("u1", "b1", [{ day: today, steps: 100, workouts: [], sleepMinutes: 430 }], "health");
    // An ordinary steps sync, with no nights in it: the night already stored stays (the Supabase upsert does the same).
    await healthDays().put("u1", "b1", [{ day: today, steps: 200, workouts: [] }], "health");
    expect((await healthDays().list("u1", "b1"))[0]?.sleepMinutes).toBe(430);
    // And a sync that carries one writes it.
    await healthDays().put("u1", "b1", [{ day: today, steps: 300, workouts: [], sleepMinutes: 455 }], "health");
    expect((await healthDays().list("u1", "b1"))[0]?.sleepMinutes).toBe(455);
  });

  describe("the health route", () => {
    let app: FastifyInstance;
    // Only what the health flow borrows (bots/healthService.ts HealthBots): no days, no models, no parse.
    const fakeBots = () => ({
      forHealth: async () => ({ id: "b1", slug: "gym-buddy", name: "Gym Buddy", purpose: "Counts my gym days", healthOn: false, sleepOn: false, source: "health" as const }),
      setHealthSkill: async () => true,
      setSleepSkill: async () => true,
      botsCounting: async () => [],
      useHealth: () => {},
      resolve: async () => null,
    });
    beforeEach(async () => {
      resetHealthDaysForTests();
      app = Fastify();
      registerBotHealthRoutes(app, { rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } }, bots: fakeBots() as never });
      await app.ready();
    });
    afterEach(async () => { await app.close(); });
    const post = (body: unknown) => app.inject({
      method: "POST", url: "/v1/bots/gym-buddy/health/days", headers: { authorization: "Bearer u1" }, payload: body as never,
    });

    it("weighs a Motion POST against PERM_MOTION, and a health POST against PERM_HEALTH_IOS", async () => {
      // Motion on, Apple Health off: the Motion row IS drawn, so its POST must not be refused for the other switch.
      process.env.PERM_HEALTH_IOS = ""; envOn(["PERM_MOTION"]);
      const motion = await post({ tz: 330, days: [], source: "motion", platform: "ios", enable: true });
      expect(motion.statusCode).not.toBe(403);
      // A health POST with that switch off is still 403.
      expect((await post({ tz: 330, days: [], platform: "ios", enable: true })).json().code).toBe("health_off");
      // And with Motion off, a Motion POST is refused by its own switch, not let through on the other's.
      envOff(PERMS); envOn(["PERM_HEALTH_IOS"]);
      expect((await post({ tz: 330, days: [], source: "motion", platform: "ios", enable: true })).json().code).toBe("motion_off");
      // Motion is iPhone only (§1 rule 9), so an Android POST claiming it is refused whatever the switches say.
      envOn(["PERM_MOTION", "PERM_HEALTH_ANDROID"]);
      expect((await post({ tz: 330, days: [], source: "motion", platform: "android", enable: true })).json().code).toBe("motion_off");
    });
  });
});

describe("a must-not-miss call rings, and a held one waits for its reason to go", () => {
  it("a follow-through ring is must-not-miss, so a Focus and a busy block do not hold it", () => {
    // The pure decision, with what beforeRing now works out for a follow seed.
    expect(holdOf({ focus: true }, { source: "follow", must: true })).toBe("ring");
    expect(holdOf({ inBlock: true }, { source: "follow", must: true })).toBe("ring");
    // Driving still holds it: the person is in a car, and that is not about how important the item is.
    expect(holdOf({ driving: true }, { source: "follow", must: true })).toBe("hold");
  });

  it("'calls and other pings' holds the reminder too; 'calls' lets it through as a notice", () => {
    expect(holdOf({ focus: true, hold: "calls" }, { source: "leave" })).toBe("notice");
    expect(holdOf({ focus: true, hold: "callsAndPings" }, { source: "leave" })).toBe("hold");
    expect(holdOf({ focus: true, hold: "callsAndPings" }, { source: "due" })).toBe("hold");
    // A must-not-miss item rings through either choice.
    expect(holdOf({ focus: true, hold: "callsAndPings" }, { source: "due", must: true })).toBe("ring");
    // And a busy calendar block is not a choice the person made, so it never holds a reminder back.
    expect(holdOf({ inBlock: true, hold: "callsAndPings" }, { source: "leave" })).toBe("notice");
  });

  it("a follow-through ring inside a busy block places the call, and holds nothing", async () => {
    resetChecksForTests();
    resetPlanBusyForTests();
    envOn(["PERM_CALENDAR_READ", "PLAN_V2_CALLS"]);
    const NOW = Date.UTC(2026, 10, 12, 11, 25);
    await planBusy().replace("U", NOW - 30 * 60_000, NOW + 60 * 60_000, [{ s: NOW - 10 * 60_000, e: NOW + 50 * 60_000, allDay: false }], NOW);
    const store = new MemoryPushStore();
    store.candidatesList = [{
      userId: "U", lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: 330,
      tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: NOW, caps: ["BotCall"] }],
    }];
    const sender = { send: async (m: Array<{ to: string }>) => m.map((_x, i) => ({ status: "ok" as const, id: `t${i}` })), receipts: async () => ({}) };
    const engine = new PushEngine(store, sender as never, () => structuredClone(PUSH_DEFAULTS), { info: () => {}, warn: () => {} });
    const table = memoryCallTable();
    const calls = new PlanCalls({
      table, engine: () => engine, now: () => NOW, name: async () => "Zara", consent: async () => true,
      holds: async () => ({ driveWait: false, focusHold: false }),
    });
    const seed = { source: "follow" as const, item: "pf:f1:1", followId: "f1", day: "2026-11-12", tz: 330, title: "Mom's meds", at: NOW, asker: "" };
    const r = await calls.ring("U", seed, { key: "f1:1", line: "Mom's meds", more: "", now: NOW });
    // IT RINGS: the ladder's call rung is only ever for a must-not-miss item (perms2 §2.3).
    expect(r).toHaveProperty("id");
    expect((await table.select({ user_id: "U" })).length).toBe(1);
    // And nothing is waiting in this server's memory for a notice it has no push to send.
    expect(heldFor("U")).toBe(0);
  });

  it("with no way to ask again, a hold stands until the hour is up", async () => {
    resetChecksForTests();
    let sent = 0;
    holdCall({ userId: "u1", why: "focus", line: "Pay the bill", notice: async () => { sent += 1; }, now: 0 });
    // The 10-minute look used to free it, because a missing answer read as "no Focus".
    expect(await sweepHeld(HOLD_RECHECK_MS + 1)).toBe(0);
    expect(heldFor("u1")).toBe(1);
    expect(sent).toBe(0);
    // An hour, and it goes as a notice whatever anyone says.
    expect(await sweepHeld(HOLD_MAX_MS + 1)).toBe(1);
    expect(sent).toBe(1);
  });

  it("with a recheck wired, a hold goes when its reason has gone and waits while it has not", async () => {
    resetChecksForTests();
    holdCall({ userId: "u1", why: "focus", line: "Pay the bill", notice: async () => undefined, now: 0 });
    expect(await sweepHeld(HOLD_RECHECK_MS + 1, { recheck: async () => ({ focus: true }) })).toBe(0);
    expect(heldFor("u1")).toBe(1);
    expect(await sweepHeld(2 * HOLD_RECHECK_MS + 2, { recheck: async () => ({ focus: false }) })).toBe(1);
    expect(heldFor("u1")).toBe(0);
  });
});

describe("the arrival set waits for a place it has not looked up yet", () => {
  it("a pending lookup sends nothing, rather than replace the phone's set with a short one", () => {
    envOn(["PERM_ARRIVAL"]);
    const ctx = planCtx({ can: [CAPS.ARRIVAL_CAPABILITY] });
    const item = { id: "e1", lat: 12.97, lon: 77.59, radiusM: 150, title: "You're at Bengaluru", body: "Pick up dry cleaning", screen: "bots.plan" };
    // The whole set, known: it goes, and an empty set goes too (that is how a switched-off item leaves the phone).
    expect(json(arrivalSync(ctx, { ...DAY_DATA, arrivals: [item] } as typeof DAY_DATA))).toContain('"kind":"arrival.sync"');
    expect(json(arrivalSync(ctx, { ...DAY_DATA, arrivals: [] } as typeof DAY_DATA))).toContain('"kind":"arrival.sync"');
    // One place still being looked up: nothing is sent this round.
    expect(arrivalSync(ctx, { ...DAY_DATA, arrivals: [], arrivalsPending: true } as typeof DAY_DATA)).toEqual([]);
    expect(arrivalSync(ctx, { ...DAY_DATA, arrivals: [item], arrivalsPending: true } as typeof DAY_DATA)).toEqual([]);
  });

  it("a tap opens a screen that needs no params of its own", () => {
    // `ArrivalItem` carries no item id, and the phone hands `userInfo` straight in as the screen's params, so the item
    // screen would open its add form. The home needs nothing.
    expect(SCREEN_PLAN).toBe("bots.plan");
  });
});

describe("turning the arrival switch on never moves the event", () => {
  it("the item page's PUT carries `arrive` and no tz", () => {
    // The details page (which is where the row is) needs the Plan page switch and a build that draws PersonBot.
    envOn(["PERM_ARRIVAL", "PLAN_V2_PAGE"]);
    const ctx = ctxFor("bots.plan.item", "phone", undefined, {
      params: { kind: "event", id: EV },
      can: new Set(["BotsKit", "PersonBot", CAPS.ARRIVAL_CAPABILITY]),
    });
    const e = { id: EV, seriesId: EV, title: "Pick up dry cleaning", notes: "", place: "Bengaluru", start: Date.now() + 3600_000, end: Date.now() + 7200_000, allDay: false, day: "2026-11-14", repeat: "", arrive: false } as never;
    const x = { before: [], moves: [], arrivals: [{ id: "e1", lat: 1, lon: 2, radiusM: 150, title: "You're at Bengaluru", body: "Pick up dry cleaning" }], arrivePlace: "Bengaluru" } as never;
    const off = JSON.stringify(planItemScreens[0]!.build(ctx, { event: e, details: x } as never));
    const on = JSON.stringify(planItemScreens[0]!.build(ctx, { event: { ...e, arrive: true }, details: x } as never));
    expect(off).toContain('"arrive":true');     // the switch going on
    expect(on).toContain('"arrive":false');     // and going off again
    // No `tz` rides with either: with one, changeEvent re-anchors the wall-clock time in the phone's current offset.
    for (const s of [off, on]) {
      expect(s).toContain('"body":{"arrive":');
      expect(s).not.toMatch(/"arrive":(true|false),"tz"/);
      expect(s).not.toMatch(/"tz":\d+,"arrive"/);
    }
  });
});

// ===================================================================== the review round's fixes
//
// Each of these is a thing 8.9.1 got wrong and now does not: the reminders sync moving every timed due date by the UTC
// offset, one place armed once a day, Android being asked questions behind switches that are off, an Android arrival card
// nobody could reach, a switch going off leaving geofences armed, and the Focus hold creeping past its 12 hours.

describe("a timed to-do keeps its own time through a Reminders sync", () => {
  let app: FastifyInstance;
  const prefs = memoryPlanPrefs();
  beforeEach(async () => {
    resetRemindersGoneForTests();
    resetCalendarForTests();
    await prefs.patch("u1", { reminders_on: true });
    app = Fastify();
    registerPlanRemindersRoutes(app, { rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } } }, { calendar: calendar(), prefs });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });
  const sync = (body: unknown) => app.inject({
    method: "POST", url: `${REMINDERS_PATH}/sync`, headers: { authorization: "Bearer u1" }, payload: body as never,
  });

  it("files the item at the instant it carries, and sends nothing back on the next sync", async () => {
    envOn(["PERM_REMINDERS", "PLAN_V2"]);
    // The phone's own shape (F:app/src/device/remindersCore.ts cleanItems): the due date in UTC, on a whole minute.
    const at = Math.floor((Date.now() + 3 * 86_400_000) / 60_000) * 60_000;
    const dueIso = new Date(at).toISOString();
    const item = { ext: "r7", title: "Dentist", dueIso, dueHasTime: true, done: false, changedAt: new Date(at).toISOString() };
    expect((await sync({ listId: "L", items: [item] })).statusCode).toBe(200);
    // The to-do is at that same instant — not at the UTC clock read as if it were local (12:00 IST for a 5:30 pm item),
    // and not on the day before for anything due before the offset.
    const rows = await calendarRows().tasks.open("u1", 50);
    expect(rows.length).toBe(1);
    expect(rows[0]!.due_ms).toBe(at);
    // So the next sync has nothing to tell the phone: the server never writes a moved time back into Reminders.
    const again = await sync({ listId: "L", items: [item] });
    expect(again.json().update).toEqual([]);
    expect(again.json().add).toEqual([]);
  });
});

describe("one place is armed once, not once a day", () => {
  it("a daily event with Remind me when I get there makes one arrival item", async () => {
    const now = Date.UTC(2026, 10, 14, 3, 0);                       // 8:30 am in India
    const c = new Calendar({ rows: memoryCalendarRows(), now: () => now, publish: () => undefined });
    const ease = new PlanEase({ calendar: c, prefs: memoryPlanPrefs(() => now), skips: new MemoryTable(), now: () => now, send: async () => undefined });
    const made = await c.addEvent("u1", { title: "Pick up dry cleaning", day: "2026-11-14", time: "21:30", place: "Bengaluru", tz: 330, repeat: "daily" });
    await c.changeEvent("u1", made.seriesId, { arrive: true });
    const day = await ease.day("u1", 330);
    // The 8-day read holds nine occurrences of this one event, each with its own `<uuid>@<day>` id. Nine identical
    // geofences would take nine of the ten slots and fire nine reminders on arrival.
    expect(day.arrivals?.length).toBe(1);
    // And the id is the SERIES's, so it does not change from one day to the next.
    expect(day.arrivals?.[0]?.id).toBe(arrivalIdOf(made.seriesId));
    expect(day.arrivals?.[0]?.screen).toBe(SCREEN_PLAN);
  });
});

describe("Android is asked nothing behind a switch that is off", () => {
  afterEach(() => { envOff(["PERM_MOTION_ANDROID", "PERM_MOTION_DRIVE_ANDROID", "PERM_CALENDAR_READ_ANDROID"]); });

  it("the driving check goes to the iPhone alone until both Android switches are on", async () => {
    envOn(["PERM_MOTION", "PERM_MOTION_DRIVE"]);
    expect(checkWantFor(["driving", "focus"])("ios")).toEqual(["driving", "focus"]);
    expect(checkWantFor(["driving", "focus"])("android")).toEqual(["focus"]);
    // The steps half alone is not enough: the grant behind the driving check is the same one.
    envOn(["PERM_MOTION_ANDROID"]);
    expect(checkWantFor(["driving"])("android")).toEqual([]);
    envOn(["PERM_MOTION_DRIVE_ANDROID"]);
    expect(checkWantFor(["driving"])("android")).toEqual(["driving"]);
  });

  it("a platform with no word left is sent no push at all, and cannot answer", async () => {
    envOn(["PERM_MOTION", "PERM_MOTION_DRIVE"]);
    const sent: Array<{ to: string; data: { want: string[] } }> = [];
    const push = {
      devicesWith: async (_u: string, p: "ios" | "android") => [{ token: p, locale: null }],
      sendData: async (m: unknown[]) => { sent.push(...(m as typeof sent)); return []; },
    };
    const waiting = askCheck({ userId: "u1", want: ["driving"], push, waitMs: 2000, id: "d1", wantFor: checkWantFor(["driving"]) });
    await new Promise((r) => setTimeout(r, 5));
    expect(sent.map((m) => m.to)).toEqual(["ios"]);
    // Only the words that really went out can be answered, so an old Android binary's answer is dropped.
    expect(answerCheck("u1", "d1", { driving: false, focus: true })).toBe(true);
    expect(await waiting).toEqual({ driving: false });
  });

  it("POST /plan/busy is refused for an Android phone while its half is off", async () => {
    resetPlanBusyForTests();
    const prefs = memoryPlanPrefs();
    const app = Fastify();
    registerPlanBusyRoutes(app, { rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } } }, { prefs, sweeper: false });
    await app.ready();
    try {
      envOn(["PERM_CALENDAR_READ"]);
      const t = Date.now();
      const body = { from: t, to: t + 86_400_000, blocks: [{ s: t + 1000, e: t + 2000, allDay: false }], enable: true };
      // The phone always sends X-App-Platform (F:app/src/sdui/client/http.ts), and okhttp gives it away anyway.
      const post = (headers: Record<string, string>) => app.inject({
        method: "POST", url: BUSY_PATH, headers: { authorization: "Bearer u1", ...headers }, payload: body as never,
      });
      const refused = await post({ "x-app-platform": "android", "user-agent": "okhttp/4.12.0" });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe("calendar_off");
      expect((await prefs.get("u1"))?.calendar_busy).not.toBe(true);
      // The iPhone's own half is the shared switch alone, so it still goes through.
      expect((await post({ "x-app-platform": "ios" })).statusCode).toBe(200);
      // And with the Android half on, so does Android.
      envOn(["PERM_CALENDAR_READ_ANDROID"]);
      expect((await post({ "x-app-platform": "android" })).statusCode).toBe(200);
      // Stopping is let through whatever the switches say: nobody is left with times they cannot delete.
      envOff(["PERM_CALENDAR_READ", "PERM_CALENDAR_READ_ANDROID"]);
      const off = await app.inject({ method: "DELETE", url: BUSY_PATH, headers: { authorization: "Bearer u1", "x-app-platform": "android" } });
      expect(off.statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it("an Android phone that declares Motion1 is told to stop watching once the server switch is off", () => {
    envOn(["PERM_MOTION", "PERM_MOTION_DRIVE"]);
    const ctx = ctxFor("bots.notify", "phone", undefined, { can: new Set(["BotsKit", CAPS.MOTION_CAPABILITY]), platform: "android" });
    const data = { settings: { notify: { driveWait: true } }, today: null, line: null, calls: true } as never;
    const rows = json(holdRows(ctx, data));
    expect(rows).toContain('"kind":"motion.watch"');
    expect(rows).toContain('"on":false');
    // Nothing is asked and no row is drawn: it only unregisters what this phone registered.
    expect(rows).not.toContain("requestPermission");
    expect(texts(holdRows(ctx, data))).toEqual([]);
    // Somebody who never turned it on has nothing to unregister.
    expect(holdRows(ctx, { settings: { notify: {} }, today: null, line: null, calls: true } as never)).toEqual([]);
    // And with the Android half on, the row itself is back and the watch goes ON with the switch, not off.
    envOn(["PERM_MOTION_ANDROID", "PERM_MOTION_DRIVE_ANDROID"]);
    expect(texts(holdRows(ctx, data))).toContain(DRIVE.row);
  });
});

describe("the Android arrival card can be reached", () => {
  const itemCtx = (platform: "ios" | "android") => ctxFor("bots.plan.item", "phone", undefined, {
    params: { kind: "event", id: EV },
    can: new Set(["BotsKit", "PersonBot", CAPS.ARRIVAL_CAPABILITY]),
    platform,
  });
  const e = { id: EV, seriesId: EV, title: "Pick up dry cleaning", notes: "", place: "Bengaluru", start: Date.now() + 3600_000, end: Date.now() + 7200_000, allDay: false, day: "2026-11-14", repeat: "", arrive: false } as never;
  const x = { before: [], moves: [], arrivals: [{ id: "e1", lat: 1, lon: 2, radiusM: 150, title: "You're at Bengaluru", body: "Pick up dry cleaning", screen: "bots.plan" }], arrivePlace: "Bengaluru" } as never;

  it("reads the permission that really arms, so approximate location does not skip the card", () => {
    envOn(["PERM_ARRIVAL", "PERM_ARRIVAL_ANDROID", "PLAN_V2_PAGE"]);
    const android = JSON.stringify(planItemScreens[0]!.build(itemCtx("android"), { event: e, details: x } as never));
    // On Android "location" is PermissionsAndroid.check(COARSE), true for anyone who ever tapped "Use my location" — so
    // the switch ran the sync with no ask, which answers "denied" with nothing held, and the card was never shown.
    expect(android).toContain('"permission":"backgroundLocation","assignTo":"locGranted"');
    expect(android).not.toContain('"permission":"location","assignTo":"locGranted"');
    const ios = JSON.stringify(planItemScreens[0]!.build(itemCtx("ios"), { event: e, details: x } as never));
    expect(ios).toContain('"permission":"location","assignTo":"locGranted"');
    expect(ios).not.toContain('"permission":"backgroundLocation","assignTo":"locGranted"');
    envOff(["PERM_ARRIVAL_ANDROID"]);
  });

  it("the Android words say the servers are never told, which is what is true there", () => {
    const words = [ARRIVAL_ANDROID.rowSub, ARRIVAL_ANDROID.lines[0]!, ARRIVAL_ANDROID.shareSub, ARRIVAL_BACKGROUND_ANDROID.lines[0]!];
    for (const w of words) expect(w, w).not.toMatch(/X0 Bot is never told/);
    for (const w of words) expect(w, w).toMatch(/X0 Bot's servers|sent to X0 Bot's servers/);
    // Play's own prominent disclosure is untouched, and it is still the second line.
    expect(ARRIVAL_ANDROID.lines[1]).toContain("even when the app is closed or not in use");
    // The iPhone's words stay as they were: there the system watches and the app is never woken.
    expect(ARRIVAL.rowSub).toContain("X0 Bot is never told you arrived");
  });
});

describe("Do Not Disturb is asked at ring time, and the Focus hold does not creep", () => {
  it("the 12 hours run from when the filter saw it, not from the repost", () => {
    const now = Date.UTC(2026, 10, 14, 6, 0);
    const saw = now - 11 * 3_600_000;
    // The phone's own body (F:app/src/device/focusCore.ts focusBody) carries `at` for the filter.
    const post = readFocusPost({ on: true, hold: "calls", source: "filter", at: saw }, now);
    expect(post).toEqual({ on: true, hold: "calls", source: "filter", at: saw });
    expect(focusStateOf(post as never, now).until).toBe(saw + FOCUS_HOLD_MS);
    // So a Plan Ease page appear an hour later does not push the limit out: it is the same moment again.
    expect(focusStateOf(readFocusPost({ on: true, hold: "calls", source: "filter", at: saw }, now + 3_600_000) as never, now + 3_600_000).until)
      .toBe(saw + FOCUS_HOLD_MS);
    // A moment in the future is read as now, and no `at` at all is today's behaviour exactly.
    expect(focusStateOf(readFocusPost({ on: true, source: "filter", at: now + 60_000 }, now) as never, now).until).toBe(now + FOCUS_HOLD_MS);
    expect(focusStateOf(readFocusPost({ on: true, source: "dnd" }, now) as never, now).until).toBe(now + FOCUS_HOLD_MS);
    expect(readFocusPost({ on: true, at: "soon" })).toMatchObject({ error: expect.stringContaining("at is") });
  });

  it("a Do Not Disturb row is never trusted on its own: it is a snapshot the phone never takes back", async () => {
    const now = Date.UTC(2026, 10, 14, 6, 0);
    const prefs = memoryPlanPrefs(() => now);
    await setFocus(prefs, "u1", { on: true, hold: "calls", source: "dnd" }, now);
    const row = await prefs.get("u1");
    // It still holds, by the clock...
    expect(focusHolding(row?.focus, now + 3_600_000)).toBe(true);
    // ...but it says `dnd`, and Android posts only on Plan Ease page appear, so nothing here says DND is still on now.
    expect(row?.focus?.source).toBe("dnd");
    // The filter's own row is the one that can be trusted: iOS posts the end of a Focus itself.
    await setFocus(prefs, "u2", { on: true, hold: "calls", source: "filter" }, now);
    expect((await prefs.get("u2"))?.focus?.source).toBe("filter");
  });
});

/**
 * PLAN EASE, THE SIMPLER ONE, STEPS 0 AND 1 (docs/plan-ease.md; src/botsBots/plan*.ts, src/calendar):
 *
 *   - outside the app, one rule: no ₹ amount, a health visit is "Appointment" (planSafe.ts)
 *   - every push kind is in one list, and each one is in "What pings you" (verdict) and the engine's kinds
 *   - reminders: what it is, at most 2 buttons (Done, Later), 10 am on a to-do's day, close ones as one push, the day's six
 *   - Later: an hour, or 9 am after 8 pm; three times, then it stays quietly in the app
 *   - the act door answers Plan Ease's buttons from the page, the widget and a notification alike
 *   - the Needs-you queue: one Move card, never for something booked; a booked clash is a grey line
 *   - the page: the one next thing (the ladder), not repeated below; Today and Tomorrow with "2 more"
 *   - the one box: notes words, a day question, an item with Undo, the chat for the rest
 *   - the day notes: the evening "tomorrow" note, the morning one only when it adds something, the quiet rule, the Daily summary
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { safeTitle, noAmounts, looksHealth, lockSafe } = await import("../src/botsBots/planSafe.js");
const { PLAN_PUSH_KINDS, PLAN_KIND_IDS, PLAN_CATEGORIES, FOLLOW_CATEGORIES, PLAN_CHANNELS, planPushFlags } = await import("../src/botsBots/planKinds.js");
const { EVENT_PUSH_KINDS, PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { verdict } = await import("../src/you/push.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { PlanEase, setPlanSummary } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { parseItem, pushItemOf, eventIdOf, eventRefOf } = await import("../src/widgets/items.js");
const { nextThing, planPage, widgetLine } = await import("../src/botsBots/planDay.js");
const { eveningMinute, morningAt } = await import("../src/botsBots/planNotes.js");
const { ROW_KINDS } = await import("../src/botsBots/planRows.js");
const { NEEDS_TYPES } = await import("../src/botsBots/planNeeds.js");
const { BOX_SLOTS } = await import("../src/botsBots/planBox.js");
const { resetConfigForTests } = await import("../src/config.js");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const IST = 330;
/** November 2026, India's wall clock, as UTC ms. Thu 12 Nov is the design's day. */
const ist = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";

type Sent = { userId: string; kind: string; key: string; vars: Record<string, string>; data?: Record<string, string>; category?: string };

function rig(t0: number) {
  const clock = { t: t0 };
  const c = new Calendar({ rows: memoryCalendarRows(), now: () => clock.t, publish: () => undefined });
  const prefs = memoryPlanPrefs(() => clock.t);
  const skips = new MemoryTable<{ [k: string]: unknown; user_id: string; key: string; at_ms: number }>();
  const sent: Sent[] = [];
  const ease = new PlanEase({ calendar: c, prefs, skips, now: () => clock.t, send: async (userId, m) => { sent.push({ userId, ...m }); } });
  ease.attach();
  const reminders: Sent[] = [];
  const remind = () => c.remind(async (userId, m) => { reminders.push({ userId, ...m }); });
  return { clock, c, prefs, skips, ease, sent, reminders, remind };
}

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanSummary(null); });

// ===================================================================== the words outside the app

describe("lock-safe words", () => {
  it("never carry an amount, and a health visit is Appointment", () => {
    expect(noAmounts("Electricity ₹2,140 due")).toBe("Electricity due");
    expect(noAmounts("Pay Rs. 300 for the trip")).toBe("Pay for the trip");
    expect(noAmounts("Rent 25000 rupees, 1500/- deposit")).toBe("Rent, deposit");
    expect(safeTitle("Electricity ₹2,140")).toBe("Electricity");
    expect(safeTitle("₹300")).toBe("Payment");
    for (const t of ["Dentist · Dr. Mehta", "Blood test", "MRI scan", "Amma's BP tablets", "अस्பताल".replace("ப", "प"), "டாக்டர் appointment", "Physiotherapy"]) {
      expect(safeTitle(t), t).toBe("Appointment");
    }
    // A test or a scan that isn't a health one stays what it is.
    expect(looksHealth("Maths test")).toBe(false);
    expect(looksHealth("Scan the documents")).toBe(false);
    expect(safeTitle("Parent-teacher meeting")).toBe("Parent-teacher meeting");
    expect(lockSafe("Pay ₹300 for the trip and pack the costume", 24)).toBe("Pay for the trip and…");
  });

  it("catch an amount however it is written: bare in a line about money, with k or lakh, grouped", () => {
    expect(safeTitle("Electricity bill 2,140")).toBe("Electricity bill");
    expect(lockSafe("Electricity bill 2,140 due today")).toBe("Electricity bill due today");
    expect(safeTitle("School fee 50")).toBe("School fee");
    expect(safeTitle("Rent 25k")).toBe("Rent");
    expect(safeTitle("Pay Ramesh 1.5 lakh")).toBe("Pay Ramesh");
    expect(safeTitle("Maid salary 8,000")).toBe("Maid salary");
    expect(safeTitle("Send 5000 to Priya")).toBe("Send to Priya");
    // A day, a time, a length or a count in a line about money stays: only the money goes.
    expect(lockSafe("Electricity due 14 Nov")).toBe("Electricity due 14 Nov");
    expect(lockSafe("Rent due Sat 14, board call 9:30")).toBe("Rent due Sat 14, board call 9:30");
    expect(lockSafe("Rent due. 12 more")).toBe("Rent due. 12 more");
    // Without a money word a number is not money: a room, a class.
    expect(safeTitle("PTM in room 204")).toBe("PTM in room 204");
  });

  it("read health in joined words, short forms and Hindi too; erring on the side of Appointment", () => {
    for (const t of ["Psychotherapy session", "Mental health appointment", "HIV test", "STD test", "Psychiatry", "Counsellor", "Gyno", "Abortion",
      "Mammogram", "Colonoscopy", "Endoscopy", "Rehab", "Ophthalmologist", "Urologist", "Gastroenterologist", "Root canal", "ENT appointment",
      "Insulin", "Covid shot", "flu shot", "Booster dose", "Physical exam", "Pap smear", "Diabetes check", "Blood pressure", "मरीज", "डॉ शर्मा"]) {
      expect(safeTitle(t), t).toBe("Appointment");
    }
    for (const t of ["Gym", "Design review", "Entry pass", "Sentiment review", "Rent"]) expect(looksHealth(t), t).toBe(false);
  });
});

describe("a family member's note on the person's own item", () => {
  it("is that row's grey line, newest first, with their tiny bot; a clash or a leave-by still comes first", async () => {
    const { notesOf } = await import("../src/botsBots/planEase.js");
    const { rowOf } = await import("../src/botsBots/planRows.js");
    const look = { avatar: "pip", color: "#3a6ea5" };
    const notes = notesOf({ notes: [
      { itemId: "e:ev1", by: "Mom", byBot: look, text: "I'll come with you", at: 2 },
      { itemId: "e:ev1", by: "Rohan", byBot: look, text: "older one", at: 1 },
    ] });
    const it = { ref: "event" as const, id: "ev1", kind: "event" as const, title: "Dentist", day: "2026-11-12", start: 1, end: 2, allDay: false, where: "Indiranagar", done: false, fixed: false, source: "me" };
    const ctx = { tz: 330, now: 0, clock: () => "6 pm", leaves: new Map(), clashes: new Map<string, string>(), notes };
    expect(rowOf(it, ctx)).toMatchObject({ line: "Mom: I'll come with you", note: { name: "Mom", text: "I'll come with you" } });
    expect(rowOf(it, { ...ctx, clashes: new Map([["ev1", "Clashes with design review"]]) })).toMatchObject({ line: "Clashes with design review" });
    expect(rowOf(it, { ...ctx, clashes: new Map([["ev1", "Clashes with design review"]]) }).note).toBeUndefined();
    expect(notesOf(undefined).size).toBe(0);
  });
});

// ===================================================================== the push kinds

describe("the push kinds", () => {
  it("are said once, and each is in the engine's kinds with its screen, channel, expiry and words", () => {
    expect([...PLAN_KIND_IDS].sort()).toEqual(PLAN_PUSH_KINDS.map((k) => k.kind).sort());
    for (const k of PLAN_PUSH_KINDS) {
      expect(EVENT_PUSH_KINDS as readonly string[]).toContain(k.kind);
      expect(PUSH_DEFAULTS.flags[`push.${k.kind}.screenId`]).toBe(k.screenId);
      expect(PUSH_DEFAULTS.flags[`push.${k.kind}.channelId`]).toBe(k.channel);
      expect(PUSH_DEFAULTS.flags[`push.${k.kind}.ttlMin`]).toBe(k.ttlMin);
      expect(PUSH_DEFAULTS.labels[`push.${k.kind}.title`]).toBeTruthy();
      expect(PLAN_CHANNELS.map((c) => c.id)).toContain(k.channel);
      // Follow-through's buttons are their own list, registered only while PLAN_V2_FOLLOW is on (planKinds.ts FOLLOW_CATEGORIES).
      if (k.category) expect([...PLAN_CATEGORIES, ...FOLLOW_CATEGORIES].map((c) => c.id)).toContain(k.category);
    }
    expect(planPushFlags()["push.plan_morning.interruptionLevel"]).toBe("passive");
  });

  it("each goes through What pings you as Plan Ease's own, never the Keylessbord branch", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    const keybotOff = { ...s, notify: { ...s.notify, botsOff: ["keybot"] } };
    const planOff = { ...s, notify: { ...s.notify, botsOff: ["plan"] } };
    const quiet = { ...s, notify: { ...s.notify, quiet: true, quietFrom: 22 * 60, quietTo: 7 * 60 } };
    for (const k of PLAN_PUSH_KINDS) {
      // The family's (step 5) are a person's word: Plan Ease's switch doesn't stop them, and the quiet ones never make a sound.
      const person = k.verdict === "people" || k.verdict === "quiet";
      const hush = k.verdict === "silent" || k.verdict === "quiet";
      expect(verdict(keybotOff, k.kind, 10 * 60), k.kind).toBe(hush ? "silent" : "send");
      expect(verdict(planOff, k.kind, 10 * 60), k.kind).toBe(person ? (hush ? "silent" : "send") : "drop");
      expect(verdict(quiet, k.kind, 23 * 60), k.kind).toBe("silent");
    }
  });

  it("have at most 2 buttons that do something, each id unique beside the app's own", () => {
    const taken = ["reply", "done", "yes", "no"];
    const ids = PLAN_CATEGORIES.flatMap((c) => c.actions.map((a) => a.id));
    expect(new Set([...ids, ...taken]).size).toBe(ids.length + taken.length);
    for (const c of PLAN_CATEGORIES) {
      expect(c.actions.length).toBeLessThanOrEqual(2);
      for (const a of c.actions) expect(!!a.act !== !!a.open, a.id).toBe(true);
    }
  });

  it("carry their own item, and no other", () => {
    expect(pushItemOf("plan_todo", { item: "pt:abc" })).toBe("pt:abc");
    expect(pushItemOf("plan_todo", { item: "stask:a:b" })).toBeNull();
    expect(parseItem("pm:abc.2026-11-12:1763000000000")).toEqual({ kind: "pm", eventRef: "abc.2026-11-12", start: "1763000000000" });
    expect(eventIdOf(eventRefOf("e1@2026-11-12"))).toBe("e1@2026-11-12");
    expect(parseItem("pe:x:not-a-day")).toBeNull();
  });
});

// ===================================================================== reminders

describe("reminders", () => {
  it("say what it is, lock-safe, with Done and Later on a to-do", async () => {
    const r = rig(ist(12, 6));
    await r.c.addEvent(U, { title: "Gym", day: "2026-11-12", time: "7:00", tz: IST, place: "Cult, HSR Layout" });
    const bank = await r.c.addTask(U, { title: "Call the bank", day: "2026-11-12", time: "17:30", tz: IST });
    await r.c.addEvent(U, { title: "Dentist · Dr. Mehta", day: "2026-11-12", time: "12:00", tz: IST, place: "Indiranagar" });
    r.clock.t = ist(12, 6, 45);
    expect(await r.remind()).toBe(1);
    expect(r.reminders[0]).toMatchObject({ kind: "plan_event", vars: { title: "Gym at 7 am", body: "Cult" } });
    r.clock.t = ist(12, 11, 45);
    await r.remind();
    // A health visit: "Appointment", and never where.
    expect(r.reminders[1]).toMatchObject({ kind: "plan_event", vars: { title: "Appointment at 12 pm", body: "Today" } });
    r.clock.t = ist(12, 17, 30);
    await r.remind();
    expect(r.reminders[2]).toMatchObject({ kind: "plan_todo", vars: { title: "Call the bank", body: "Now" }, data: { item: `pt:${bank.id}` } });
    expect(r.reminders[2]!.category).toBeUndefined();
  });

  it("remind a to-do with only a day at 10 am that day, with no amount", async () => {
    const r = rig(ist(12, 20));
    await r.c.addTask(U, { title: "Electricity ₹2,140", day: "2026-11-13", tz: IST });
    r.clock.t = ist(13, 9, 59);
    expect(await r.remind()).toBe(0);
    r.clock.t = ist(13, 10);
    expect(await r.remind()).toBe(1);
    expect(r.reminders[0]).toMatchObject({ kind: "plan_todo", vars: { title: "Electricity", body: "Today" } });
  });

  it("send two within 10 minutes as one push with no buttons", async () => {
    const r = rig(ist(12, 12));
    await r.c.addEvent(U, { title: "Dentist", day: "2026-11-12", time: "18:00", tz: IST });
    await r.c.addTask(U, { title: "Call Mom", day: "2026-11-12", time: "17:50", tz: IST });
    r.clock.t = ist(12, 17, 45);
    expect(await r.remind()).toBe(1);
    expect(r.reminders).toHaveLength(1);
    expect(r.reminders[0]).toMatchObject({ kind: "plan_many", vars: { title: "2 things at 6 pm", body: "appointment, call Mom" } });
    expect(r.reminders[0]!.category).toBeUndefined();
    r.clock.t = ist(12, 17, 50);
    expect(await r.remind()).toBe(0);
  });

  it("don't remind an event whose leave-by reminder went, and stop Plan Ease's own at six a day", async () => {
    const r = rig(ist(12, 8));
    const ev = await r.c.addEvent(U, { title: "PTM", day: "2026-11-12", time: "9:30", tz: IST, place: "School" });
    await r.prefs.patch(U, { leaves: [{ eventId: ev.id, start: ev.start, leaveBy: ist(12, 9), minutes: 30, mode: "drive", to: "School", title: "PTM", sent: true }] });
    r.clock.t = ist(12, 9, 15);
    expect(await r.remind()).toBe(0);
    await r.prefs.patch(U, { sent: { day: "2026-11-13", n: 6 } });
    await r.c.addTask(U, { title: "Buy the gift", day: "2026-11-13", tz: IST });
    r.clock.t = ist(13, 10);
    expect(await r.remind()).toBe(0);
  });

  it("put a to-do off with Later: an hour, 9 am after 8 pm, three times, then only Done", async () => {
    const r = rig(ist(12, 17));
    const t = await r.c.addTask(U, { title: "Call the bank", day: "2026-11-12", time: "17:30", tz: IST });
    r.clock.t = ist(12, 17, 30);
    await r.remind();
    expect(await r.c.later(U, t.id)).toEqual({ quiet: false, at: ist(12, 18, 30) });
    r.clock.t = ist(12, 20, 30);
    expect(await r.c.later(U, t.id)).toEqual({ quiet: false, at: ist(13, 9) });
    expect((await r.c.later(U, t.id)).quiet).toBe(false);
    r.clock.t = ist(13, 9);
    await r.remind();
    // Three times put off: the reminder comes with Done only, and a fourth Later keeps it quietly in the app.
    expect(r.reminders.at(-1)?.category).toBe("x0_todo_last");
    expect(await r.c.later(U, t.id)).toEqual({ quiet: true, at: null });
  });

  it("tell them when to leave, 10 minutes before, with Open map, and never where a health visit is", async () => {
    const r = rig(ist(12, 16));
    const ev = await r.c.addEvent(U, { title: "Parent-teacher meeting", day: "2026-11-12", time: "18:00", tz: IST, place: "Green Valley School" });
    const doc = await r.c.addEvent(U, { title: "Dentist", day: "2026-11-12", time: "20:00", tz: IST, place: "Smile Dental, Indiranagar" });
    await r.prefs.patch(U, {
      leaves: [
        { eventId: ev.id, start: ev.start, leaveBy: ist(12, 17, 30), minutes: 30, mode: "drive", to: "Green Valley School", title: ev.title },
        { eventId: doc.id, start: doc.start, leaveBy: ist(12, 19, 40), minutes: 20, mode: "drive", to: "Smile Dental", title: doc.title },
      ],
      next_leave_ms: ist(12, 17, 20),
    });
    r.clock.t = ist(12, 17, 20);
    expect(await r.ease.leavesTick()).toBe(1);
    expect(r.sent[0]).toMatchObject({ kind: "plan_leave", vars: { title: "Leave by 5:30 pm for parent-teacher meeting", body: "30 min drive to Green Valley School" }, data: { go: "map", to: "Green Valley School", mode: "driving" } });
    expect(await r.ease.leavesTick()).toBe(0);
    // The event's own reminder 15 minutes before doesn't come as well.
    r.clock.t = ist(12, 17, 45);
    expect(await r.remind()).toBe(0);
    r.clock.t = ist(12, 19, 30);
    expect(await r.ease.leavesTick()).toBe(1);
    expect(r.sent[1]).toMatchObject({ vars: { title: "Leave by 7:40 pm for your appointment", body: "20 min drive" } });
  });

  it("are as they were with the switch off", async () => {
    vi.stubEnv("PLAN_V2_REMINDERS", "false"); resetConfigForTests();
    const r = rig(ist(12, 6));
    await r.c.addTask(U, { title: "Buy the gift", day: "2026-11-13", tz: IST });
    await r.c.addEvent(U, { title: "Gym", day: "2026-11-12", time: "7:00", tz: IST });
    r.clock.t = ist(12, 6, 45);
    await r.remind();
    expect(r.reminders.map((x) => x.kind)).toEqual(["plan_reminder"]);
    r.clock.t = ist(13, 10);
    expect(await r.remind()).toBe(0);
  });
});

// ===================================================================== the act door

describe("Plan Ease's buttons at the act door", () => {
  const policy = { inPlaceRisks: ["read"], modes: {}, tokenEnabled: true };
  const acts = (ease: InstanceType<typeof PlanEase>, now: () => number) => new QuickActs(
    { spaceTasks: null, threads: null, approvals: null, jobs: null, plan: { scope: (i, a) => ease.scope(i, a), act: (u, i, a) => ease.act(u, i, a) } },
    new MemoryQuickActionStore(), now,
  );

  it("tick a to-do and put it off, from a notification or the widget with the scope it needs", async () => {
    const r = rig(ist(12, 9));
    const t = await r.c.addTask(U, { title: "Buy milk", day: "2026-11-12", time: "10:00", tz: IST });
    const door = acts(r.ease, () => r.clock.t);
    expect((await door.run(U, { item: `pt:${t.id}`, action: "later", key: "k-later-0001" }, { kind: "session" }, policy)).body).toMatchObject({ ok: true, state: "later" });
    expect((await door.run(U, { item: `pt:${t.id}`, action: "done" }, { kind: "widget", scopes: ["needs.answer"] }, policy)).status).toBe(403);
    expect((await door.run(U, { item: `pt:${t.id}`, action: "done" }, { kind: "widget", scopes: ["task.done"] }, policy)).body).toMatchObject({ ok: true, state: "done" });
    expect((await r.c.task(U, t.id)).done).toBe(true);
    // The box's Undo needs the app: a widget can't take a thing out.
    expect((await door.run(U, { item: `pt:${t.id}`, action: "undo" }, { kind: "widget", scopes: ["task.done", "needs.answer"] }, policy)).status).toBe(403);
    expect((await door.run(U, { item: `pt:${t.id}`, action: "fly" }, { kind: "session" }, policy)).status).toBe(400);
  });

  it("move or keep on the Move card that is there now, and nothing for a stale one", async () => {
    const r = rig(ist(12, 9));
    const grocery = await r.c.addEvent(U, { title: "Grocery run", day: "2026-11-12", time: "18:00", minutes: 60, tz: IST });
    await r.c.addEvent(U, { title: "Dentist", day: "2026-11-12", time: "18:30", minutes: 60, tz: IST });
    const page = await r.ease.read(U, IST);
    expect(page.needs).toMatchObject({ type: "move", question: "Move grocery run to tomorrow 9 am?", reason: "It overlaps dentist at 6:30 pm." });
    expect(page.needs!.buttons.map((b) => b.label)).toEqual(["Move it", "Keep"]);
    const door = acts(r.ease, () => r.clock.t);
    const stale = `pm:${eventRefOf(grocery.id)}:${grocery.start - HOUR}`;
    expect((await door.run(U, { item: stale, action: "move" }, { kind: "session" }, policy)).status).toBe(409);
    expect((await door.run(U, { item: page.needs!.item, action: "move" }, { kind: "widget", scopes: ["needs.answer"] }, policy)).body).toMatchObject({ ok: true, state: "moved" });
    expect((await r.c.event(U, grocery.id)).start).toBe(ist(13, 9));
    // The Undo puts it back.
    expect((await door.run(U, { item: page.needs!.item, action: "unmove", key: "k-unmove-0001" }, { kind: "session" }, policy)).status).toBe(200);
    expect((await r.c.event(U, grocery.id)).start).toBe(grocery.start);
    const again = await r.ease.read(U, IST);
    expect((await door.run(U, { item: again.needs!.item, action: "keep", key: "k-keep-0001" }, { kind: "session" }, policy)).status).toBe(200);
    expect((await r.ease.read(U, IST)).needs).toBeNull();
  });
});

// ===================================================================== the Needs-you queue and the page

describe("the Needs-you queue", () => {
  it("never offers to move something booked: a booked clash is a grey line on both rows", async () => {
    const r = rig(ist(12, 9));
    await r.c.addEvent(U, { title: "Dentist · Dr. Mehta", day: "2026-11-12", time: "18:00", minutes: 45, tz: IST });
    await r.c.addEvent(U, { title: "PTM", day: "2026-11-12", time: "18:15", minutes: 60, tz: IST });
    const page = await r.ease.read(U, IST);
    expect(page.needs).toBeNull();
    // The dentist is the one next thing (not repeated below); the PTM's row says what it clashes with.
    expect(page.next.big).toBe("Dentist at 6 pm");
    expect(page.days.find((d) => d.label === "Today")!.rows.map((x) => [x.title, x.line])).toEqual([["PTM", "Clashes with dentist"]]);
  });

  it("leaves two calls back to back alone", async () => {
    const r = rig(ist(12, 9));
    await r.c.addEvent(U, { title: "Standup", day: "2026-11-12", time: "10:00", minutes: 30, tz: IST, place: "Zoom" });
    await r.c.addEvent(U, { title: "Client call", day: "2026-11-12", time: "10:30", minutes: 30, tz: IST, place: "Google Meet" });
    expect((await r.ease.read(U, IST)).needs).toBeNull();
  });

  it("has a slot for each step's card, row kind and box reading", () => {
    // The foundation's own, in their places; the later steps' fill the slots between (each step's own tests say which).
    expect(NEEDS_TYPES.map((t) => t.type).slice(0, 2)).toEqual(["move", "home"]);
    expect(ROW_KINDS.map((k) => k.kind).slice(-2)).toEqual(["todo", "event"]);
    const slots = BOX_SLOTS.map((s) => s.slot);
    // A desktop's "add this" first, only when the words came with what was on its screen; then the notes words.
    expect(slots.slice(0, 2)).toEqual(["seen", "notes"]);
    expect(slots.slice(-2)).toEqual(["item", "chat"]);
    expect(slots.indexOf("day")).toBeGreaterThan(0);
  });
});

describe("the page", () => {
  const item = (o: Partial<Parameters<typeof nextThing>[0]["items"][number]> & { id: string; title: string; day: string }) =>
    ({ ref: "event" as const, kind: "event" as const, start: null, end: null, allDay: false, done: false, fixed: false, source: "me", ...o });

  it("climbs the ladder to the one next thing, and never shows it twice", () => {
    const base = { tz: IST, today: "2026-11-12", tomorrow: "2026-11-13", leaves: new Map(), clashes: new Map() };
    const dentist = item({ id: "d", title: "Dentist", day: "2026-11-12", start: ist(12, 18), end: ist(12, 18, 45), where: "Indiranagar" });
    const review = item({ id: "r", title: "Design review", day: "2026-11-12", start: ist(12, 10), end: ist(12, 11) });
    const costume = item({ id: "c", ref: "task", kind: "todo", title: "Buy the fruit costume", day: "2026-11-12" });
    const ptm = item({ id: "p", title: "Parent-teacher meeting", day: "2026-11-13", start: ist(13, 9, 30), end: ist(13, 10, 30) });
    const leave = new Map([["d", { leaveBy: ist(12, 17, 30), minutes: 30, mode: "drive", to: "Indiranagar" }]]);
    expect(nextThing({ ...base, leaves: leave, now: ist(12, 16, 48), items: [dentist, costume] })).toMatchObject({
      rung: 1, big: "Leave by 5:30 pm for dentist", accent: "5:30 pm", grey: "30 min drive to Indiranagar",
    });
    expect(nextThing({ ...base, leaves: leave, now: ist(12, 17, 20), items: [dentist] }).button?.label).toBe("Open map");
    expect(nextThing({ ...base, now: ist(12, 9), items: [review, dentist, costume] })).toMatchObject({ rung: 3, big: "Design review at 10 am", grey: "1 more today" });
    expect(nextThing({ ...base, now: ist(12, 19), items: [costume, item({ ...costume, id: "c2", title: "Pack the bag" })] })).toMatchObject({ rung: 4, big: "Today: buy the fruit costume", grey: "1 more to do" });
    expect(nextThing({ ...base, now: ist(12, 19), items: [ptm] })).toMatchObject({ rung: 5, big: "Tomorrow starts at 9:30 am", grey: "Parent-teacher meeting" });
    expect(nextThing({ ...base, now: ist(12, 19), items: [] })).toMatchObject({ rung: 6, big: "Nothing planned yet", grey: "" });
    const page = planPage({ ...base, now: ist(12, 9), items: [review, dentist, costume, ptm], needs: null });
    const rows = page.days.flatMap((d) => d.rows.map((x) => x.id));
    expect(rows).not.toContain("e:r");
    expect(rows).toEqual(expect.arrayContaining(["e:d", "t:c", "e:p"]));
  });

  it("shows Today up to 6 rows and Tomorrow up to 3, then \"2 more\"; after 5 pm Tomorrow comes first", () => {
    const base = { tz: IST, today: "2026-11-12", tomorrow: "2026-11-13", leaves: new Map(), clashes: new Map(), needs: null };
    const todos = Array.from({ length: 9 }, (_, i) => item({ id: `t${i}`, ref: "task", kind: "todo", title: `To do ${i}`, day: "2026-11-12" }));
    const tomorrow = Array.from({ length: 5 }, (_, i) => item({ id: `m${i}`, title: `Thing ${i}`, day: "2026-11-13", start: ist(13, 9 + i), end: ist(13, 10 + i) }));
    const morning = planPage({ ...base, now: ist(12, 9), items: [...todos, ...tomorrow] });
    expect(morning.days.map((d) => [d.label, d.rows.length, d.more])).toEqual([["Today", 6, 2], ["Tomorrow", 3, 2]]);
    const evening = planPage({ ...base, now: ist(12, 18), items: [...todos, ...tomorrow] });
    expect(evening.days[0]!.label).toBe("Tomorrow");
    expect(evening.week[0]).toMatchObject({ date: "Sat 14", line: "" });
  });

  it("writes the widget's line to stay true until its time: no amount, no health words", () => {
    const base = { tz: IST, today: "2026-11-12", tomorrow: "2026-11-13" };
    const ptm = item({ id: "p", title: "PTM", day: "2026-11-14", start: ist(14, 9, 30), end: ist(14, 10, 30), where: "School" });
    const sat = { ...ptm, day: "2026-11-13", start: ist(13, 9, 30), end: ist(13, 10, 30) };
    const w = widgetLine({ ...base, now: ist(12, 21), items: [sat], leaves: new Map([["p", { leaveBy: ist(13, 9), minutes: 30, mode: "drive", to: "School" }]]) })!;
    expect(w.line).toBe("Fri · PTM 9:30, leave 9:00");
    expect(w.line.length).toBeLessThanOrEqual(32);
    expect(w.lock.inline.length).toBeLessThanOrEqual(24);
    expect(w.leads).toBe(false);
    const doctor = item({ id: "x", title: "Dentist", day: "2026-11-12", start: ist(12, 18), end: ist(12, 19), where: "Dr. Mehta's clinic" });
    const h = widgetLine({ ...base, now: ist(12, 16), items: [doctor], leaves: new Map() })!;
    expect(h.line).toBe("Next: Appointment 6 pm");
    expect(JSON.stringify(h)).not.toMatch(/Dentist|Mehta|clinic/);
  });
});

// ===================================================================== the one box

describe("the one box", () => {
  it("adds an item with Undo, answers a day from the list, and leaves questions to the chat", async () => {
    const r = rig(ist(12, 16, 48));
    const added = await r.ease.box(U, "Dentist Fri 5 pm", IST);
    expect(added).toMatchObject({ slot: "item", kind: "added", line: "Added: Dentist, Fri 13 Nov, 5 pm" });
    const ev = (await r.c.list(U, { from: "2026-11-13", to: "2026-11-13", tz: IST })).events[0]!;
    expect(added.undo).toEqual({ item: `pe:${ev.id}:2026-11-13`, action: "undo" });
    const day = await r.ease.box(U, "What's on Friday?", IST);
    expect(day).toMatchObject({ slot: "day", kind: "day", day: "2026-11-13", line: "Tomorrow: Dentist 5 pm" });
    expect((await r.ease.box(U, "Can I fit a haircut in this week?", IST)).kind).toBe("chat");
    // Things to do that start like a question are added, not sent to the chat.
    for (const w of ["Do laundry tomorrow", "Find passport Fri", "Plan Riya's party Sat", "Help Arjun with homework 6 pm"]) {
      expect((await r.ease.box(U, w, IST)).kind, w).toBe("added");
    }
    expect((await r.ease.box(U, "Should I move the gym", IST)).kind).toBe("chat");
    expect((await r.ease.box(U, "Buy milk", IST))).toMatchObject({ kind: "added", line: "Added: Buy milk" });
    expect((await r.ease.act(U, parseItem(added.undo!.item)!, "undo")).status).toBe(200);
    expect((await r.c.list(U, { from: "2026-11-13", to: "2026-11-13", tz: IST })).events).toEqual([]);
  });

  it("takes notes words: no evening notes, and back", async () => {
    const r = rig(ist(12, 16));
    expect((await r.ease.box(U, "No evening notes", IST)).line).toBe("OK, no evening notes. Say 'evening notes' to bring them back.");
    expect((await r.prefs.get(U))?.notes).toBe("morning");
    await r.ease.box(U, "evening notes", IST);
    expect((await r.prefs.get(U))?.notes).toBe("both");
    expect((await r.prefs.get(U))?.next_note_ms).toBe(ist(12, 20, 30));
  });
});

// ===================================================================== the day notes

describe("the day notes", () => {
  async function priya() {
    const r = rig(ist(12, 16));
    const drop = await r.c.addEvent(U, { title: "School drop", day: "2026-11-13", time: "8:30", tz: IST, place: "Little Steps" });
    await r.c.addEvent(U, { title: "Design review", day: "2026-11-13", time: "10:00", tz: IST });
    await r.c.addTask(U, { title: "Pack the fruit costume", day: "2026-11-13", tz: IST });
    await r.c.addTask(U, { title: "Pay ₹300 for the trip", day: "2026-11-13", tz: IST });
    await r.c.addEvent(U, { title: "Dentist", day: "2026-11-13", time: "18:00", tz: IST });
    await r.ease.read(U, IST);
    await r.prefs.patch(U, { leaves: [{ eventId: drop.id, start: drop.start, leaveBy: ist(13, 8, 10), minutes: 20, mode: "drive", to: "Little Steps", title: "School drop" }] });
    return r;
  }

  it("send the evening note at 8:30 pm: the first thing, what to get ready, never an amount; the first one says how to stop", async () => {
    const r = await priya();
    expect((await r.prefs.get(U))?.next_note_ms).toBe(ist(12, 20, 30));
    r.clock.t = ist(12, 20, 30);
    expect(await r.ease.notesTick()).toBe(1);
    const n = r.sent[0]!;
    expect(n).toMatchObject({ kind: "plan_evening", key: "evening:2026-11-13", vars: { title: "Tomorrow: leave by 8:10 am" } });
    expect(n.vars.body).toBe("Tonight: pack the fruit costume, pay for the trip. First: school drop 8:30 am. 2 more. I'll send this each evening. Say 'no evening notes' in Plan Ease to stop.");
    expect(n.vars.body).not.toMatch(/₹|300|Dentist/);
    // The next is tomorrow's morning slot.
    expect((await r.prefs.get(U))?.note?.next).toBe("morning");
  });

  it("send the morning note only when it adds something, with no sound of its own", async () => {
    const r = await priya();
    r.clock.t = ist(12, 20, 30);
    await r.ease.notesTick();
    await r.ease.opened(U, "plan_evening");
    // Opened last night and nothing changed: one day note, not two.
    r.clock.t = (await r.prefs.get(U))!.next_note_ms!;
    expect(r.clock.t).toBe(ist(13, 7, 25));
    expect(await r.ease.notesTick()).toBe(0);
    // The next night: tomorrow changes after the note went, so the morning tells what's new.
    await r.c.addEvent(U, { title: "Gym", day: "2026-11-14", time: "8:00", tz: IST });
    r.clock.t = ist(13, 20, 30);
    expect(await r.ease.notesTick()).toBe(1);
    await r.ease.opened(U, "plan_evening");
    await r.c.addEvent(U, { title: "Standup", day: "2026-11-14", time: "10:30", tz: IST });
    r.clock.t = ist(14, 7, 30);
    expect(await r.ease.notesTick()).toBe(1);
    expect(r.sent.at(-1)).toMatchObject({ kind: "plan_morning", key: "morning:2026-11-14", vars: { title: "Today: Gym at 8 am", body: "New: standup 10:30 am. Still open: pack the fruit costume." } });
  });

  it("go quiet after 5 evening notes in a row never opened: the morning one takes their place, and says so once", async () => {
    const r = rig(ist(12, 16));
    for (let d = 13; d <= 22; d += 1) await r.c.addEvent(U, { title: "Standup", day: `2026-11-${d}`, time: "10:00", tz: IST });
    await r.ease.read(U, IST);
    for (let d = 12; d <= 20; d += 1) {
      for (const t of [ist(d, 20, 30), ist(d + 1, 7, 30)]) {
        r.clock.t = t;
        await r.ease.notesTick();
      }
    }
    expect(r.sent.filter((x) => x.kind === "plan_evening")).toHaveLength(5);
    expect((await r.prefs.get(U))?.notes).toBe("morning");
    // From then on the morning note comes every day, and the first one says so, once.
    const last = r.sent.map((x) => x.kind).lastIndexOf("plan_evening");
    const mornings = r.sent.slice(last + 1).filter((x) => x.kind === "plan_morning");
    expect(mornings.length).toBeGreaterThanOrEqual(3);
    expect(mornings.every((m) => m.vars.title === "Today: Standup at 10 am")).toBe(true);
    const said = mornings.filter((m) => m.vars.body.includes("I'll send just this morning note now. Say 'evening notes' to get the evening one back."));
    expect(said).toHaveLength(1);
  });

  it("count only the notes that went: an empty evening between them never starts the 5 again", async () => {
    const r = rig(ist(12, 16));
    // Something every other day: every other evening has no note at all.
    for (let d = 13; d <= 27; d += 2) await r.c.addEvent(U, { title: "Standup", day: `2026-11-${d}`, time: "10:00", tz: IST });
    await r.ease.read(U, IST);
    for (let d = 12; d <= 26; d += 1) {
      for (const t of [ist(d, 20, 30), ist(d + 1, 7, 30)]) {
        r.clock.t = t;
        await r.ease.notesTick();
      }
    }
    expect(r.sent.filter((x) => x.kind === "plan_evening")).toHaveLength(5);
    expect((await r.prefs.get(U))?.notes).toBe("morning");
  });

  it("carry the Daily summary's line, so it isn't sent on its own", async () => {
    setPlanSummary({ line: async () => ({ line: "2 things done.", time: "9 pm" }), alone: async () => undefined });
    const r = await priya();
    expect(await r.ease.rides(U, "2026-11-12")).toBe(true);
    r.clock.t = ist(12, 20, 30);
    await r.ease.notesTick();
    expect(r.sent[0]!.vars.body).toContain("2 things done.");
    expect(await r.ease.rides(U, "2026-11-12")).toBe(true);
  });

  it("don't go with the switch off, and an empty tomorrow has no note", async () => {
    const r = rig(ist(12, 16));
    await r.ease.read(U, IST);
    r.clock.t = ist(12, 20, 30);
    expect(await r.ease.notesTick()).toBe(0);
    vi.stubEnv("PLAN_V2_NOTES", "false"); resetConfigForTests();
    await r.c.addEvent(U, { title: "Standup", day: "2026-11-14", time: "10:00", tz: IST });
    r.clock.t = ist(13, 20, 30);
    expect(await r.ease.notesTick()).toBe(0);
    expect(r.sent).toEqual([]);
  });

  it("move the evening note to just before they usually look, and the morning one before an early leave", () => {
    const opens = Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(1 + i).padStart(2, "0")}`, min: 21 * 60 + 40 }));
    expect(eveningMinute(opens, 20 * 60 + 30)).toBe(21 * 60 + 25);
    expect(eveningMinute(opens.slice(0, 5), 20 * 60 + 30)).toBe(20 * 60 + 30);
    expect(eveningMinute(opens.map((o) => ({ ...o, min: 23 * 60 })), 20 * 60 + 30)).toBe(22 * 60);
    expect(morningAt("2026-11-13", IST, 7 * 60 + 30, ist(13, 7))).toBe(ist(13, 6, 15));
    expect(morningAt("2026-11-13", IST, 7 * 60 + 30, ist(13, 6))).toBe(ist(13, 6));
    expect(morningAt("2026-11-13", IST, 7 * 60 + 30, null)).toBe(ist(13, 7, 30));
  });
});

void DAY;

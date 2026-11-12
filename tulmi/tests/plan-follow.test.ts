/**
 * FOLLOW-THROUGH, THE LADDER (botsBots/planFollow.ts, planFollowPeople.ts; docs/plan-ease.md "Follow-through"): "every item becomes a job
 * that is not finished until someone says it's done".
 *
 *   - arming: which items are followed, and that the calendar's own push is then not sent; once per occurrence; before migration 0081
 *   - the ladder: push, louder push, X0 is calling, a real call (only for someone who turned it on), tell; restarts; never twice; caps
 *   - replies: Done, Later, Can't, I'll do it, Undone; stale presses; two at once; the act door's pf:<id>:<n>
 *   - bills: paid by anyone on it stops it for everyone; Pay and Paid stay; the 6 pm climb
 *   - WHO CAN BE REACHED (the owner's change): only the asker's X0 people, by messaging's rules (threads.ts contacts), checked again before
 *     every reach; someone who left, blocked, or Spaces off is skipped and the job goes on; their own settings (quiet, limit, mute, Allow)
 *   - Activity, the engine's push id and open hooks
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
  process.env.DEV_SKIP_AUTH = "true";
});

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanFollows, setPlanFollows, followLinesOf, plugFollows } = await import("../src/botsBots/planFollow.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { setFollowChannels } = await import("../src/botsBots/planFollowChannels.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { PlanCapture, memoryCaptureStore, setPlanCapture } = await import("../src/botsBots/planCapture.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { feedOf } = await import("../src/shell/feed.js");
const { resetConfigForTests } = await import("../src/config.js");
const { MemoryPushStore } = await import("../src/push/store.js");
const { PushEngine, addPushOpenHook } = await import("../src/push/engine.js");

type YouSettings = import("../src/you/settings.js").YouSettings;
type FollowRow = import("../src/botsBots/planFollowStore.js").FollowRow;
type PhoneCall = import("../src/botsBots/planFollowChannels.js").PhoneCall;

const MIN = 60_000;
const IST = 330;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001"; // Rahul, the asker
const M = "bbbbbbbb-0000-4000-8000-000000000002"; // Mom
const D = "cccccccc-0000-4000-8000-000000000003"; // Dad
const X = "dddddddd-0000-4000-8000-000000000004"; // someone Rahul shares no space with
const quiet = { info: () => undefined, warn: () => undefined };

interface Pushed { userId: string; kind: string; key: string; vars?: Record<string, string | number>; data?: Record<string, string>; category?: string; collapseId?: string; call?: unknown }

function rig(t0: number, o: { noPhone?: string[]; ring?: (userId: string) => { id: string } | { none: string }; capture?: boolean } = {}) {
  const clock = { t: t0 };
  const now = () => clock.t;
  const calendar = new Calendar({ rows: memoryCalendarRows(), now, publish: () => undefined });
  const prefs = memoryPlanPrefs(now);
  const reminders: Pushed[] = [];
  const ease = new PlanEase({ calendar, prefs, skips: new MemoryTable(), now, send: async (userId, m) => { reminders.push({ userId, ...m }); } });
  ease.attach();
  const stores = memoryFollowStores();
  const pushes: Pushed[] = [];
  const engine = {
    notify: async (userId: string, msg: Omit<Pushed, "userId">) => {
      if (o.noPhone?.includes(userId)) return null;
      pushes.push({ userId, ...msg });
      return { sent: true, dropped: 0, id: `push-${pushes.length}` };
    },
    configFor: () => structuredClone(PUSH_DEFAULTS),
  };
  const rings: Array<{ userId: string; key: string; line: string; seed: { asker: string; item: string } }> = [];
  const closed: string[] = [];
  const calls = {
    ring: async (userId: string, seed: { asker: string; item: string }, r: { key: string; line: string }) => {
      const out = o.ring?.(userId) ?? { id: `call-${rings.length + 1}` };
      if ("id" in out) rings.push({ userId, key: r.key, line: r.line, seed });
      return out;
    },
    closeFor: async (userId: string, key: string) => { closed.push(`${userId}|${key}`); },
  };
  const settings = new Map<string, YouSettings>();
  const settingsOf = async (u: string) => settings.get(u) ?? structuredClone(DEFAULT_SETTINGS);
  const set = (u: string, n: Partial<YouSettings["notify"]>) => { const s = structuredClone(DEFAULT_SETTINGS); s.notify = { ...s.notify, ...n }; settings.set(u, s); };
  // Who can message whom (threads.ts contacts): Rahul, Mom and Dad share a family space; X shares none.
  const people: Record<string, Array<{ userId: string; name: string }>> = {
    [U]: [{ userId: M, name: "Mom" }, { userId: D, name: "Dad" }],
    [M]: [{ userId: U, name: "Rahul" }, { userId: D, name: "Dad" }],
    [D]: [{ userId: U, name: "Rahul" }, { userId: M, name: "Mom" }],
  };
  const muted = new Set<string>();
  const follows = new PlanFollows({
    stores, calendar, now, engine: () => engine as never, calls: () => calls as never, settingsOf,
    saveSettings: async (u, s) => { settings.set(u, s); },
    contacts: async (u) => people[u] ?? [], muted: async (u, other) => muted.has(`${u}|${other}`),
    spend: (u, d) => ease.policy.spend(u, d), tzOfUser: async () => IST, log: quiet,
  });
  setPlanFollows(follows);
  ease.wire({ follow: (u, c) => follows.arm(u, c) });
  calendar.setTickHook((u, t, w) => { void follows.taskTicked(u, t, w); });
  if (o.capture) setPlanCapture(new PlanCapture({ calendar, prefs, store: memoryCaptureStore(), now, tzOf: async () => IST }));
  const door = new QuickActs({ spaceTasks: null, threads: null, approvals: null, jobs: null, plan: { scope: (i, a) => ease.scope(i, a), act: (u, i, a) => ease.act(u, i, a) } }, new MemoryQuickActionStore(), now);
  // The act door as the app calls it: a session, no key (an old build), the server's policy.
  const acts = { act: (userId: string, req: { item: string; action: string; key?: string }) => door.run(userId, req, { kind: "session" }, { inPlaceRisks: ["read"], modes: {}, tokenEnabled: true }) };
  const remind = () => calendar.remind(async (userId, m) => { reminders.push({ userId, ...m }); });
  const at = async (d: number, h: number, m = 0) => { clock.t = ist(d, h, m); await remind(); await follows.sweep(clock.t); };
  const only = async (): Promise<FollowRow> => { const all = await stores.follows.select({}); expect(all).toHaveLength(1); return all[0]!; };
  const steps = async () => (await stores.steps.select({})).sort((a, b) => a.at_ms - b.at_ms || a.rung.localeCompare(b.rung));
  const kinds = () => pushes.map((p) => `${p.userId === U ? "U" : p.userId === M ? "M" : p.userId === D ? "D" : "?"}:${p.kind}`);
  const reply = async (by: string, answer: "done" | "later" | "cant" | "take" | "undone", x: { n?: number; later?: "15m" | "1h" | "eve" | "tmrw" | "default"; via?: "app" | "call" } = {}) => {
    const f = (await stores.follows.select({}))[0]!;
    return follows.reply({ followId: f.id, by: `u:${by}`, answer, via: x.via ?? "app", ...(x.n !== undefined ? { n: x.n } : {}), ...(x.later ? { later: x.later } : {}) });
  };
  return { clock, calendar, prefs, ease, stores, pushes, reminders, rings, closed, settings, set, people, muted, follows, acts, remind, at, only, steps, kinds, reply };
}

beforeEach(() => { vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanFollows(null); setFollowChannels(null); setPlanCapture(null); });

/** Mom's 9 pm medicine on Rahul's list, Mom then Dad on it. */
async function medicine(r: ReturnType<typeof rig>, who: string[] = [M, D]) {
  const t = await r.calendar.addTask(U, { title: "Mom's evening medicine", day: "2026-11-12", time: "21:00", tz: IST });
  if (who.length) await r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: who.map((id) => ({ id })) });
  return t;
}

// ===================================================================== arming

describe("arming", () => {
  it("arming: a must to-do at its reminder arms one follow and the calendar sends no push of its own", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, []);
    await r.at(12, 21);
    expect(r.reminders).toHaveLength(0);
    const f = await r.only();
    expect(f).toMatchObject({ importance: "must", why: "medicine", state: "open", rung: "push", holder_key: `u:${U}` });
    // The asker's own lock screen: "Reminder", never the medicine.
    expect(r.pushes).toEqual([expect.objectContaining({ userId: U, kind: "plan_follow", vars: { title: "Reminder", body: "9 pm · Must not miss" }, collapseId: `follow-${f.id}` })]);
    expect(r.pushes[0]!.data).toMatchObject({ follow: f.id, item: `pf:${f.id}:1` });
  });

  it("arming: a normal item of the person's own sends today's push exactly, and no follow is made", async () => {
    const r = rig(ist(12, 8));
    await r.calendar.addTask(U, { title: "Call the bank", day: "2026-11-12", time: "17:30", tz: IST });
    await r.at(12, 17, 30);
    expect(r.reminders.map((m) => m.kind)).toEqual(["plan_todo"]);
    expect(await r.stores.follows.select({})).toHaveLength(0);
  });

  it("arming: an item with someone else on it is followed even when normal, and goes to them", async () => {
    const r = rig(ist(12, 8));
    const t = await r.calendar.addTask(U, { title: "Water the plants", day: "2026-11-12", time: "18:00", tz: IST });
    await r.calendar.setFollow(U, { kind: "task", id: t.id }, { people: [{ k: "u", id: M }] });
    await r.at(12, 18);
    expect(r.reminders).toHaveLength(0);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    expect(r.pushes[0]!.vars).toEqual({ title: "Water the plants", body: "From Rahul · 6 pm" });
    expect((await r.only()).importance).toBe("normal");
  });

  it("arming: a second tick and a second server find the follow; one row, one push", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r, []);
    r.clock.t = ist(12, 21);
    const raw = (await r.calendar.task(U, t.id));
    expect(raw.id).toBe(t.id);
    await r.remind();
    // A second server's tick, the same occurrence: found, not followed twice.
    const row = (await (r.calendar as unknown as { rows: { tasks: { select(m: object): Promise<Array<Record<string, unknown>>> } } }).rows.tasks.select({ id: t.id }))[0]!;
    expect(await r.follows.arm(U, { kind: "task", row: row as never, at: ist(12, 21) })).toBe(true);
    await r.follows.sweep(r.clock.t);
    await r.follows.sweep(r.clock.t);
    await r.only();
    expect(r.kinds()).toEqual(["U:plan_follow"]);
  });

  it("arming: before migration 0081 (the insert fails) the reminder goes as before", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, []);
    r.stores.follows.insert = async () => { throw new Error("relation \"plan_follows\" does not exist"); };
    await r.at(12, 21);
    expect(r.reminders.map((m) => m.kind)).toEqual(["plan_todo"]);
  });

  it("arming: a followed bill's 10 am push is the ladder's bill push, its 6 pm reminder is the louder one, and the call comes at 6:10 pm", async () => {
    const r = rig(ist(12, 8));
    const t = await r.calendar.addTask(U, { title: "Electricity ₹2,340", day: "2026-11-12", tz: IST }, { kind: "me" }, null, { kind: "due", payee: "BESCOM", pay_link: "upi://pay?pa=bescom@upi" });
    await r.at(12, 10);
    expect(r.reminders).toHaveLength(0);
    const f = await r.only();
    expect(f.why).toBe("bill_today");
    // The bill's own push: Pay and Paid, no call seed, keyed for this climb.
    expect(r.pushes[0]).toMatchObject({ userId: U, kind: "plan_due", key: `follow:${f.id}:1:push`, category: "x0_due", data: { item: `pt:${t.id}`, follow: f.id } });
    expect(r.pushes[0]!.call).toBeUndefined();
    expect(JSON.stringify(r.pushes[0]!.vars)).not.toContain("2,340");
    await r.at(12, 10, 5);
    expect(r.pushes).toHaveLength(1);
    await r.at(12, 18);
    expect(r.reminders).toHaveLength(0);
    expect(r.pushes[1]).toMatchObject({ kind: "plan_due", key: `follow:${f.id}:1:loud` });
    await r.at(12, 18, 10);
    expect(r.rings).toEqual([expect.objectContaining({ userId: U, key: `follow:${f.id}:1` })]);
  });

  it("arming: an event whose leave-by already went counts that as its push", async () => {
    const r = rig(ist(12, 8));
    const e = await r.calendar.addEvent(U, { title: "Flight to Delhi", day: "2026-11-12", time: "21:00", tz: IST });
    const row = (await (r.calendar as unknown as { rows: { events: { select(m: object): Promise<Array<Record<string, unknown>>> } } }).rows.events.select({ id: e.id }))[0]!;
    r.clock.t = ist(12, 19);
    expect(await r.follows.arm(U, { kind: "event", row: row as never, at: ist(12, 19), start: ist(12, 21), day: "2026-11-12", leftAlready: true })).toBe(true);
    const f = await r.only();
    expect(f.rung).toBe("push");
    expect(r.pushes).toHaveLength(0);
    expect((await r.steps()).map((s) => [s.rung, s.why])).toEqual([["push", "leave_by"]]);
    r.clock.t = ist(12, 19, 5);
    await r.follows.sweep(r.clock.t);
    expect(r.kinds()).toEqual(["U:plan_follow_loud"]);
  });

  it("arming: Keep at it off makes the person's own must items behave as today", async () => {
    const r = rig(ist(12, 8));
    r.set(U, { follow: false });
    await medicine(r, []);
    await r.at(12, 21);
    expect(r.reminders.map((m) => m.kind)).toEqual(["plan_todo"]);
    expect(await r.stores.follows.select({})).toHaveLength(0);
  });

  it("arming: a to-do moved from 9 pm to 9:30 pm the same day after its reminder drops the old follow and arms a new one at 9:30", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r, []);
    await r.at(12, 21);
    await r.calendar.changeTask(U, t.id, { title: "Mom's evening medicine", day: "2026-11-12", time: "21:30", tz: IST });
    // Its next step (the louder push at 9:05) finds the item moved: dropped, nothing sent.
    await r.at(12, 21, 5);
    expect((await r.stores.follows.select({}))[0]!.state).toBe("dropped");
    await r.at(12, 21, 30);
    const all = await r.stores.follows.select({});
    expect(all.map((f) => f.state).sort()).toEqual(["dropped", "open"]);
    expect(r.kinds()).toEqual(["U:plan_follow", "U:plan_follow"]);
  });

  it("arming: someone not in the asker's X0 people first in the order is skipped to the next person, and the asker hears once", async () => {
    const r = rig(ist(12, 8));
    await medicine(r);
    r.people[U] = [{ userId: D, name: "Dad" }]; // Mom left the family space
    await r.at(12, 21);
    const f = await r.only();
    expect(f.holder_key).toBe(`u:${D}`);
    expect(f.cant).toEqual([`u:${M}`]);
    expect(r.kinds()).toEqual(["U:plan_follow_passed", "D:space_follow"]);
    expect(r.pushes[0]!.vars).toEqual({ title: "Mom isn't in your X0 people", body: "Dad has it now" });
    await r.at(12, 21, 1);
    expect(r.kinds()).toHaveLength(2);
  });
});

describe("the calendar", () => {
  it("calendar: before migration 0081 (no people column) adding, editing, ticking and moving a to-do and an event never write the new columns", async () => {
    const r = rig(ist(12, 8));
    const rows = (r.calendar as unknown as { rows: { tasks: { rows: Array<Record<string, unknown>> }; events: { rows: Array<Record<string, unknown>> } } }).rows;
    const t = await r.calendar.addTask(U, { title: "Call the bank", day: "2026-11-12", time: "17:30", tz: IST });
    await r.calendar.changeTask(U, t.id, { title: "Call the bank today", day: "2026-11-12", time: "17:45", tz: IST });
    await r.calendar.tickTask(U, t.id, true);
    const e = await r.calendar.addEvent(U, { title: "Dentist", day: "2026-11-12", time: "12:00", tz: IST });
    await r.calendar.moveEvent(U, e.id, ist(12, 13));
    for (const row of [...rows.tasks.rows, ...rows.events.rows]) {
      expect(row).not.toHaveProperty("people");
      expect(row).not.toHaveProperty("importance");
    }
  });

  it("calendar: making a bill must after its 10 am push keeps its 6 pm reminder", async () => {
    const r = rig(ist(12, 8));
    r.set(U, { follow: false }); // its own push goes at 10 am as today, and the claim sets 6 pm
    const t = await r.calendar.addTask(U, { title: "Gas", day: "2026-11-12", tz: IST }, { kind: "me" }, null, { kind: "due" });
    await r.at(12, 10);
    const rows = (r.calendar as unknown as { rows: { tasks: { rows: Array<Record<string, unknown>> } } }).rows;
    const before = rows.tasks.rows.find((x) => x.id === t.id)!.next_remind_ms;
    expect(before).toBe(ist(12, 18));
    await r.calendar.setFollow(U, { kind: "task", id: t.id }, { importance: "must" });
    expect(rows.tasks.rows.find((x) => x.id === t.id)!.next_remind_ms).toBe(before);
  });
});

// ===================================================================== the ladder

describe("the ladder", () => {
  it("ladder: push at the time, a louder push at +5, X0 is calling at +10, no real call unless turned on, the asker told at +20", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    await medicine(r);
    await r.at(12, 21);
    await r.at(12, 21, 5);
    await r.at(12, 21, 10);
    await r.at(12, 21, 15);
    await r.at(12, 21, 20);
    expect(r.kinds()).toEqual(["M:space_follow", "M:space_follow_loud", "U:plan_follow_tell"]);
    expect(r.rings).toEqual([expect.objectContaining({ userId: M, seed: expect.objectContaining({ asker: "Rahul" }) })]);
    expect(r.pushes[2]!.vars).toEqual({ title: "Mom hasn't said done", body: "The 9 pm reminder" });
    const f = await r.only();
    expect(f.state).toBe("told");
    expect((await r.steps()).map((s) => `${s.rung}:${s.state}`)).toEqual(["push:sent", "loud:sent", "call:sent", "tell:sent"]);
  });

  it("ladder: a normal follow stops after its push and closes as missed later without a push", async () => {
    const r = rig(ist(12, 8));
    const t = await r.calendar.addTask(U, { title: "Water the plants", day: "2026-11-12", time: "18:00", tz: IST });
    await r.calendar.setFollow(U, { kind: "task", id: t.id }, { people: [{ k: "u", id: M }] });
    await r.at(12, 18);
    await r.at(12, 18, 30);
    await r.at(12, 23, 59);
    await r.at(13, 0, 1);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    expect((await r.only()).state).toBe("missed");
  });

  it("ladder: two sweeps at once take each step once (compare-and-swap, steps unique)", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    await medicine(r);
    await r.at(12, 21);
    r.clock.t = ist(12, 21, 5);
    await Promise.all([r.follows.sweep(r.clock.t), r.follows.sweep(r.clock.t), r.follows.sweep(r.clock.t)]);
    expect(r.kinds()).toEqual(["M:space_follow", "M:space_follow_loud"]);
  });

  it("ladder: after a restart a late sweep takes only the latest due step, and a late push re-anchors the climb", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    await medicine(r);
    await r.at(12, 21);
    // Down from 9:01 to 9:16: only the latest due step (the real call's place, which Mom never turned on), not the louder push or the ring.
    await r.at(12, 21, 16);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    expect(r.rings).toHaveLength(0);
    expect((await r.only()).rung).toBe("phone");
    await r.at(12, 21, 20);
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow_tell"]);
  });

  it("ladder: a server down from before the push until after the tell sends the push first, never the tell", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r);
    const rows = (r.calendar as unknown as { rows: { tasks: { select(m: object): Promise<Array<Record<string, unknown>>> } } }).rows;
    const row = (await rows.tasks.select({ id: t.id }))[0]!;
    r.clock.t = ist(12, 20, 59);
    // Armed just before 9 pm (MERGE_MS ahead), then the server was down until 9:25.
    await r.follows.arm(U, { kind: "task", row: row as never, at: ist(12, 21) });
    expect(r.pushes).toHaveLength(0);
    r.clock.t = ist(12, 21, 25);
    await r.follows.sweep(r.clock.t);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    const f = await r.only();
    expect(f.base_ms).toBe(ist(12, 21, 25));
  });

  it("ladder: a Done that lands between the swap and the send stops the send (\"late\")", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    await medicine(r);
    await r.at(12, 21);
    const insert = r.stores.steps.insert.bind(r.stores.steps);
    r.stores.steps.insert = async (row) => { const out = await insert(row); if (row.rung === "loud") await r.reply(M, "done"); return out; };
    await r.at(12, 21, 5);
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow_done"]);
    expect((await r.steps()).find((s) => s.rung === "loud")).toMatchObject({ state: "skipped", why: "late" });
  });

  it("ladder: a refused ring (too soon, busy, quiet) gives its ring back, so the day's limit counts only rings that went", async () => {
    const r = rig(ist(12, 8), { ring: () => ({ none: "too_soon" }) });
    r.set(M, { followFrom: [U] });
    await medicine(r);
    for (const m of [0, 5, 10]) await r.at(12, 21, m);
    expect((await r.steps()).find((s) => s.rung === "call")).toMatchObject({ state: "skipped", why: "too_soon" });
    const cap = (await r.stores.caps.select({ person: `u:${M}` }))[0]!;
    expect(cap.n).toBe(1); // the louder push only
  });

  it("ladder: someone else with no phone on a normal item makes the asker hear \"X0 couldn't reach\" at once", async () => {
    const r = rig(ist(12, 8), { noPhone: [M] });
    const t = await r.calendar.addTask(U, { title: "Water the plants", day: "2026-11-12", time: "18:00", tz: IST });
    await r.calendar.setFollow(U, { kind: "task", id: t.id }, { people: [{ k: "u", id: M }] });
    await r.at(12, 18);
    expect(r.kinds()).toEqual(["U:plan_follow_tell"]);
    expect(r.pushes[0]!.vars).toEqual({ title: "X0 couldn't reach Mom", body: "Water the plants · 6 pm" });
    expect((await r.only()).state).toBe("told");
  });

  it("ladder: the louder pings and calls stop at the person's daily limit", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U], ringMax: 3 });
    for (const [h, title] of [[9, "Insulin"], [12, "Afternoon tablets"]] as const) {
      const t = await r.calendar.addTask(U, { title, day: "2026-11-12", time: `${h}:00`, tz: IST });
      await r.calendar.setFollow(U, { kind: "task", id: t.id }, { people: [{ k: "u", id: M }] });
    }
    for (const h of [9, 12]) for (const m of [0, 5, 10]) await r.at(12, h, m);
    // 9 am: loud and call (2); noon: loud (3), then the call is over the limit.
    expect(r.kinds().filter((k) => k.endsWith("_loud"))).toHaveLength(2);
    expect(r.rings).toHaveLength(1);
    expect((await r.steps()).filter((s) => s.why === "cap").map((s) => s.rung)).toEqual(["call"]);
  });

  it("ladder: planCall's own limits (busy, a computer in use) skip the call and the ladder carries on", async () => {
    const r = rig(ist(12, 8), { ring: () => ({ none: "desk" }) });
    await medicine(r, []);
    for (const m of [0, 5, 10, 15, 20]) await r.at(12, 21, m);
    // Nobody else on it: the tell has nobody to tell (so it never says "told"); the climb is over and it waits for Done or its end.
    expect((await r.steps()).map((s) => `${s.rung}:${s.why ?? s.state}`)).toEqual(["push:sent", "loud:sent", "call:desk", "tell:none"]);
    expect((await r.only()).state).toBe("open");
  });

  it("members: someone with no quiet hours of their own is never rung louder or called for someone else's item between 10 pm and 7 am", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    const t = await r.calendar.addTask(U, { title: "Mom's night medicine", day: "2026-11-12", time: "22:30", tz: IST });
    await r.calendar.setFollow(U, { kind: "task", id: t.id }, { people: [{ k: "u", id: M }] });
    for (const m of [30, 35, 40, 50]) await r.at(12, 22, m);
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow_tell"]);
    expect((await r.steps()).filter((s) => s.why === "quiet").map((s) => s.rung)).toEqual(["loud", "call"]);
  });
});

// ===================================================================== the real phone call

describe("the real phone call (the seam Backend B fills)", () => {
  const channel = (o: { can?: "ok" | "quiet" | "no_number"; fail?: string } = {}) => {
    const placed: PhoneCall[] = [];
    setFollowChannels({ phone: { ready: () => true, canCall: async () => o.can ?? "ok", call: async (m) => { if (o.fail) return { ok: false, why: o.fail }; placed.push(m); return { ok: true, ext: "req-1" }; } } });
    return placed;
  };

  it("phone: off by default: the rung passes with no step, even with the provider set up", async () => {
    const r = rig(ist(12, 8));
    const placed = channel();
    await medicine(r, []);
    for (const m of [0, 5, 10, 15]) await r.at(12, 21, m);
    expect(placed).toHaveLength(0);
    expect((await r.steps()).map((s) => s.rung)).toEqual(["push", "loud", "call"]);
  });

  it("phone: turned on for their own number, it calls once at +15 with lock-safe words, counts toward the daily limit, and press 1 answers done", async () => {
    vi.stubEnv("FOLLOW_CALL_ASKER_DAY_MAX", "6"); vi.stubEnv("FOLLOW_CALL_DAY_MAX", "100"); resetConfigForTests();
    const r = rig(ist(12, 8));
    r.set(U, { phoneCall: true });
    const placed = channel();
    const t = await medicine(r, []);
    for (const m of [0, 5, 10, 15, 15]) await r.at(12, 21, m);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ userId: U, n: 1, asker: "", what: "", when: "9 pm" });
    expect((await r.steps()).find((s) => s.rung === "phone")).toMatchObject({ state: "sent", ext: "req-1", channel: "phone" });
    expect((await r.stores.caps.select({ person: `u:${U}` }))[0]!.n).toBe(3);
    const out = await r.reply(U, "done", { via: "call", n: 1 });
    expect(out.status).toBe(200);
    expect((await r.calendar.task(U, t.id)).done).toBe(true);
    await r.follows.stepSeen("req-1", "answered", r.clock.t);
    expect((await r.steps()).find((s) => s.rung === "phone")!.state).toBe("answered");
  });

  it("phone: never in quiet hours, and a call refused before it left gives its caps back", async () => {
    vi.stubEnv("FOLLOW_CALL_ASKER_DAY_MAX", "6"); vi.stubEnv("FOLLOW_CALL_DAY_MAX", "100"); resetConfigForTests();
    const r = rig(ist(12, 8));
    r.set(U, { phoneCall: true });
    channel({ can: "quiet" });
    await medicine(r, []);
    for (const m of [0, 5, 10, 15]) await r.at(12, 21, m);
    expect((await r.steps()).find((s) => s.rung === "phone")).toMatchObject({ state: "skipped", why: "quiet" });
    const r2 = rig(ist(12, 8));
    r2.set(U, { phoneCall: true });
    channel({ fail: "http_400" });
    await medicine(r2, []);
    for (const m of [0, 5, 10, 15]) await r2.at(12, 21, m);
    expect((await r2.steps()).find((s) => s.rung === "phone")).toMatchObject({ state: "failed", why: "http_400" });
    expect((await r2.stores.caps.select({ person: `p:${U}` }))[0]?.n ?? 0).toBe(0);
  });
});

// ===================================================================== replies

describe("replies", () => {
  it("replies: Done from the app closes it for everyone: task ticked, a ringing call ended, told people's notifications replaced, cards gone", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    const t = await medicine(r);
    for (const m of [0, 5, 10]) await r.at(12, 21, m);
    expect((await r.follows.cardsFor(M)).cards).toHaveLength(1);
    const out = await r.reply(U, "done");
    expect(out.body).toMatchObject({ state: "done", message: "Done. I told everyone." });
    expect((await r.calendar.task(U, t.id)).done).toBe(true);
    const f = await r.only();
    expect(r.closed).toContain(`${M}|follow:${f.id}:1`);
    expect(r.kinds().slice(-1)).toEqual(["M:space_follow_done"]);
    expect(r.pushes.at(-1)!.vars).toEqual({ title: "Rahul said done", body: "The 9 pm reminder" });
    expect((await r.follows.cardsFor(M)).cards).toHaveLength(0);
    await r.at(12, 21, 20);
    expect(r.kinds().filter((k) => k.includes("tell"))).toHaveLength(0);
  });

  it("replies: a close cut short (the tick failed after Done) is finished by the hourly repair", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r, []);
    await r.at(12, 21);
    const tick = r.calendar.tickTask.bind(r.calendar);
    let failOnce = true;
    r.calendar.tickTask = async (u, id, done) => { if (failOnce) { failOnce = false; throw new Error("network"); } return tick(u, id, done); };
    await r.reply(U, "done");
    expect((await r.calendar.task(U, t.id)).done).toBe(false);
    r.clock.t = ist(12, 22, 30);
    await r.follows.sweep(r.clock.t);
    expect((await r.calendar.task(U, t.id)).done).toBe(true);
  });

  it("replies: Done twice answers already (200)", async () => {
    const r = rig(ist(12, 8));
    await medicine(r);
    await r.at(12, 21);
    await r.reply(M, "done");
    const again = await r.reply(D, "done");
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ state: "already", message: "Mom already said done." });
  });

  it("replies: Later restarts the climb from the new time with new push keys; the fourth Later is refused kindly", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, []);
    await r.at(12, 21);
    for (let i = 0; i < 3; i += 1) {
      const out = await r.reply(U, "later", { later: "15m" });
      expect(out.body.state).toBe("later");
      r.clock.t += 61_000;
    }
    const f = await r.only();
    expect(f).toMatchObject({ n: 4, laters: 3, state: "snoozed" });
    const fourth = await r.reply(U, "later");
    expect(fourth.body).toMatchObject({ state: "kept", message: "That's the last Later. Done, or can't?" });
    await r.at(12, 21, 48);
    expect(r.pushes.at(-1)).toMatchObject({ key: `${f.id}:4:push`, category: "x0_follow_last" });
  });

  it("replies: Later or Can't from someone who doesn't hold it is refused", async () => {
    const r = rig(ist(12, 8));
    await medicine(r);
    await r.at(12, 21);
    expect((await r.reply(D, "later")).status).toBe(409);
    expect((await r.reply(U, "cant")).body).toMatchObject({ code: "not_yours", message: "Only Mom can say that." });
    expect((await r.reply(X, "done")).status).toBe(404);
  });

  it("replies: the same press twice within a minute counts once; an answer about an old n counts for nothing", async () => {
    const r = rig(ist(12, 8));
    await medicine(r);
    await r.at(12, 21);
    expect((await r.reply(M, "later", { n: 1 })).body.state).toBe("later");
    expect((await r.reply(M, "later", { n: 1 })).body.state).toBe("already");
    r.clock.t += 2 * MIN;
    expect((await r.reply(M, "cant", { n: 1 })).body.state).toBe("already");
    expect((await r.only()).holder_key).toBe(`u:${M}`);
  });

  it("replies: Done, Undone, Done within a minute closes it again", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r, []);
    await r.at(12, 21);
    await r.reply(U, "done");
    expect((await r.reply(U, "undone")).body.state).toBe("undone");
    expect((await r.calendar.task(U, t.id)).done).toBe(false);
    expect((await r.reply(U, "done")).body.state).toBe("done");
    expect((await r.only()).state).toBe("done");
  });

  it("replies: Mom's Done from a phone call and Rahul's Done in the app at the same moment close it once, and both are answered", async () => {
    const r = rig(ist(12, 8));
    await medicine(r);
    await r.at(12, 21);
    const [a, b] = await Promise.all([r.reply(M, "done", { via: "call" }), r.reply(U, "done")]);
    expect([a.body.state, b.body.state].sort()).toEqual(["already", "done"]);
    const f = await r.only();
    expect(f.state).toBe("done");
    expect(f.answers.filter((x) => x.verb === "done")).toHaveLength(1);
  });

  it("replies: Later on climb 1 and Later on climb 2 from a phone that sends no key both run (pf:<id>:<n> items); an owed press from climb 1 sent during climb 2 does nothing", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, []);
    await r.at(12, 21);
    const f = await r.only();
    const one = await r.acts.act(U, { item: `pf:${f.id}:1`, action: "later" });
    expect(one.body.state).toBe("later");
    await r.at(12, 21, 15);
    r.clock.t += 61_000;
    const two = await r.acts.act(U, { item: `pf:${f.id}:2`, action: "later" });
    expect(two.body.state).toBe("later");
    const owed = await r.acts.act(U, { item: `pf:${f.id}:1`, action: "cant" });
    expect(owed.body.state).toBe("already");
    expect((await r.only()).n).toBe(3);
  });

  it("replies: a bill put off at 10 am pushes at 10:15 and still waits for 6 pm to get louder", async () => {
    const r = rig(ist(12, 8));
    await r.calendar.addTask(U, { title: "Electricity", day: "2026-11-12", tz: IST }, { kind: "me" }, null, { kind: "due" });
    await r.at(12, 10);
    await r.reply(U, "later");
    await r.at(12, 10, 15);
    expect(r.pushes.map((p) => p.key.split(":").slice(2).join(":"))).toEqual(["1:push", "2:push"]);
    await r.at(12, 10, 30);
    await r.at(12, 11);
    expect(r.pushes).toHaveLength(2);
    await r.at(12, 18);
    expect(r.pushes.at(-1)!.key).toMatch(/:2:loud$/);
  });

  it("replies: turning an item back to normal stops its open follow's louder steps; taking the holder off the item passes it on", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r);
    await r.at(12, 21);
    await r.follows.people.setItem(U, { kind: "task", id: t.id }, { importance: "normal" });
    for (const m of [5, 10, 20]) await r.at(12, 21, m);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    await r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: [{ id: D }] });
    expect((await r.only()).holder_key).toBe(`u:${D}`);
    expect(r.kinds()).toEqual(["M:space_follow", "D:space_follow"]);
  });

  it("replies: Can't hands it to the next person at once and tells the asker quietly", async () => {
    const r = rig(ist(12, 8));
    await medicine(r);
    await r.at(12, 21);
    const out = await r.reply(M, "cant");
    expect(out.body).toMatchObject({ state: "passed", message: "I'll ask Dad." });
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow_passed", "D:space_follow"]);
    expect(r.pushes[1]!.vars).toEqual({ title: "Mom can't do it", body: "Dad has it now" });
  });

  it("replies: Can't from the last person tells the asker nobody can, and I'll do it makes it theirs", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, [M]);
    await r.at(12, 21);
    const out = await r.reply(M, "cant");
    expect(out.body).toMatchObject({ state: "nobody", message: "Nobody else is on it. I told Rahul." });
    expect(r.pushes.at(-1)).toMatchObject({ userId: U, kind: "plan_follow_none", category: "x0_follow_none" });
    expect((await r.reply(U, "take")).body.state).toBe("taken");
    expect((await r.only())).toMatchObject({ holder_key: `u:${U}`, state: "open", rung: "push" });
  });

  it("replies: the asker's own Can't with nobody else closes it for this time", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, []);
    await r.at(12, 21);
    expect((await r.reply(U, "cant")).body).toMatchObject({ state: "dropped", message: "Okay, not this time." });
  });
});

// ===================================================================== bills

describe("bills", () => {
  it("bills: Done from anyone on a bill marks it paid once, makes next month's with the same people, and stops every reminder", async () => {
    const r = rig(ist(12, 8), { capture: true });
    const t = await r.calendar.addTask(U, { title: "Electricity", day: "2026-11-12", tz: IST }, { kind: "me" }, null, { kind: "due", repeat: "monthly" });
    await r.calendar.setFollow(U, { kind: "task", id: t.id }, { people: [{ k: "u", id: M }, { k: "u", id: D }] });
    await r.at(12, 10);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    await r.reply(D, "done");
    expect((await r.calendar.task(U, t.id)).done).toBe(true);
    const next = (await r.calendar.list(U, { from: "2026-12-12", to: "2026-12-12", tz: IST })).tasks.filter((x) => x.kind === "due");
    expect(next).toHaveLength(1);
    expect(next[0]!.people).toEqual([{ k: "u", id: M }, { k: "u", id: D }]);
    await r.reply(M, "done");
    expect((await r.calendar.list(U, { from: "2026-12-12", to: "2026-12-12", tz: IST })).tasks.filter((x) => x.kind === "due")).toHaveLength(1);
    await r.at(12, 18);
    await r.at(12, 18, 20);
    expect(r.kinds().filter((k) => !k.endsWith("_done"))).toEqual(["M:space_follow"]);
    expect(r.reminders).toHaveLength(0);
  });

  it("replies: Undone on a bill takes back next month's bill", async () => {
    const r = rig(ist(12, 8), { capture: true });
    const t = await r.calendar.addTask(U, { title: "Electricity", day: "2026-11-12", tz: IST }, { kind: "me" }, null, { kind: "due", repeat: "monthly" });
    await r.at(12, 10);
    await r.reply(U, "done");
    expect((await r.calendar.list(U, { from: "2026-12-12", to: "2026-12-12", tz: IST })).tasks.filter((x) => x.kind === "due")).toHaveLength(1);
    await r.reply(U, "undone");
    expect((await r.calendar.task(U, t.id)).done).toBe(false);
    expect((await r.calendar.list(U, { from: "2026-12-12", to: "2026-12-12", tz: IST })).tasks.filter((x) => x.kind === "due")).toHaveLength(0);
  });

  it("bills: Paid on the bill's own push closes the follow (the tick hook), and no call comes at 6:10 pm", async () => {
    const r = rig(ist(12, 8));
    const t = await r.calendar.addTask(U, { title: "Electricity", day: "2026-11-12", tz: IST }, { kind: "me" }, null, { kind: "due" });
    await r.at(12, 10);
    await r.acts.act(U, { item: `pt:${t.id}`, action: "paid" });
    await new Promise((res) => setTimeout(res, 0));
    expect((await r.only())).toMatchObject({ state: "done", done_via: "item" });
    await r.at(12, 18, 10);
    expect(r.rings).toHaveLength(0);
  });
});

// ===================================================================== the item itself

describe("the item", () => {
  it("item: ticking the task in the app closes its follow; taking it out drops it; moving it to another day drops it", async () => {
    const r = rig(ist(12, 8));
    const a = await medicine(r, []);
    await r.at(12, 21);
    await r.calendar.tickTask(U, a.id, true);
    await new Promise((res) => setTimeout(res, 0));
    expect((await r.stores.follows.select({}))[0]).toMatchObject({ state: "done", done_via: "item" });
    const b = await r.calendar.addTask(U, { title: "Insulin", day: "2026-11-12", time: "22:00", tz: IST });
    await r.at(12, 22);
    await r.calendar.removeTask(U, b.id);
    await new Promise((res) => setTimeout(res, 0));
    const c = await r.calendar.addTask(U, { title: "Eye drops", day: "2026-11-12", time: "23:00", tz: IST });
    await r.at(12, 23);
    await r.calendar.changeTask(U, c.id, { title: "Eye drops", day: "2026-11-13", time: "23:00", tz: IST });
    await r.at(12, 23, 5);
    const states = (await r.stores.follows.select({})).sort((x, y) => x.created_ms - y.created_ms).map((f) => f.state);
    expect(states).toEqual(["done", "dropped", "dropped"]);
  });
});

// ===================================================================== who can be reached (the owner's change)

describe("who can be on it, and reached", () => {
  it("people: someone not in the asker's X0 people can't be put on an item; a name not there says so and offers the space invite; the item keeps those who count", async () => {
    const r = rig(ist(12, 8));
    r.follows.people.wire({ invite: async () => ({ screen: "bots.space.invite", params: { id: "s1" } }) });
    const t = await r.calendar.addTask(U, { title: "Gas booking", day: "2026-11-12", time: "11:00", tz: IST });
    const out = await r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: [{ id: X }, { name: "mom" }, { name: "Priya" }, { name: "me" }] });
    expect(out.missing).toEqual(["Someone", "Priya"]);
    expect(out.message).toBe("That person and Priya aren't in your X0 people yet. Invite them to a space, then add them here.");
    expect(out.invite).toEqual({ screen: "bots.space.invite", params: { id: "s1" } });
    expect((await r.calendar.task(U, t.id)).people).toEqual([{ k: "u", id: M, name: "Mom" }, { k: "u", id: U }]);
    expect(out.follow?.people.map((p) => p.name)).toEqual(["Mom", "You"]);
    const picker = await r.follows.people.picker(U, { kind: "task", id: t.id });
    expect(picker.people.map((p) => p.name)).toEqual(["You", "Dad", "Mom"]);
  });

  it("people: with Spaces off nobody but the asker counts, and members already on an item are skipped", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r);
    vi.stubEnv("SPACES_ENABLED", "false"); resetConfigForTests();
    const out = await r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: [{ name: "Mom" }] });
    expect(out.message).toBe("Mom isn't in your X0 people yet.");
    expect(out.invite).toBeNull();
    const t2 = await r.calendar.addTask(U, { title: "Water the plants", day: "2026-11-12", time: "18:00", tz: IST });
    await r.calendar.setFollow(U, { kind: "task", id: t2.id }, { people: [{ k: "u", id: M, name: "Mom" }] });
    await r.at(12, 18);
    expect(r.kinds()).toEqual(["U:plan_follow"]);
    expect(r.pushes[0]!.vars.body).toBe("Mom isn't in your X0 people · 6 pm");
  });

  it("people: a block made after the item was set is checked before the next reach: no louder push, no call, the job goes on, the asker told once", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    await medicine(r);
    await r.at(12, 21);
    // Mom blocks Rahul (threads.ts contacts: neither offers the other any more).
    r.people[U] = [{ userId: D, name: "Dad" }];
    r.people[M] = [{ userId: D, name: "Dad" }];
    await r.at(12, 21, 5);
    await r.at(12, 21, 10);
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow_passed", "D:space_follow"]);
    expect(r.rings).toHaveLength(0);
    expect((await r.reply(M, "done")).status).toBe(404);
    expect(await r.follows.view(M, (await r.only()).id)).toBeNull();
    expect((await r.follows.cardsFor(M)).cards).toHaveLength(0);
  });

  it("people: someone who left the shared space with nobody after them leaves it with the asker: \"I'll do it\"", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, [M]);
    await r.at(12, 21);
    r.people[U] = [];
    await r.at(12, 21, 5);
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow_none"]);
    expect(r.pushes[1]).toMatchObject({ vars: { title: "Mom isn't in your X0 people", body: "Reminder · 9 pm" }, category: "x0_follow_none" });
    expect((await r.only()).state).toBe("nobody");
  });

  it("people: a muted chat with the asker: nothing from the asker's items reaches them, and the asker hears X0 couldn't reach them", async () => {
    const r = rig(ist(12, 8));
    r.muted.add(`${M}|${U}`);
    await medicine(r, [M]);
    await r.at(12, 21);
    expect(r.kinds()).toEqual(["U:plan_follow_tell"]);
    expect((await r.steps())[0]).toMatchObject({ rung: "push", why: "muted" });
  });

  it("members: a member who has not allowed the asker gets the push but no louder push and no call (no_optin), then the asker is told; after Allow they get both; Not now keeps them off", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r, [M]);
    for (const m of [0, 5, 10, 20]) await r.at(12, 21, m);
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow_tell"]);
    expect((await r.steps()).filter((s) => s.why === "no_optin").map((s) => s.rung)).toEqual(["loud", "call"]);
    const f = await r.only();
    const view = await r.follows.view(M, f.id);
    expect(view?.ask).toEqual({ asker: "Rahul" });
    expect((await r.acts.act(M, { item: `pf:${f.id}:1`, action: "allow" })).body).toMatchObject({ state: "allowed", message: "Okay. Rahul's must-not-miss reminders can ring and call you." });
    expect(r.settings.get(M)!.notify.followFrom).toEqual([U]);
    expect((await r.follows.view(M, f.id))?.ask).toBeNull();
    await r.reply(M, "done");
    void t;
    // Tomorrow's: louder and a call now.
    const t2 = await r.calendar.addTask(U, { title: "Mom's evening medicine", day: "2026-11-13", time: "21:00", tz: IST });
    await r.follows.people.setItem(U, { kind: "task", id: t2.id }, { people: [{ id: M }] });
    for (const m of [0, 5, 10]) await r.at(13, 21, m);
    expect(r.kinds().slice(-2)).toEqual(["M:space_follow", "M:space_follow_loud"]);
    expect(r.rings).toHaveLength(1);
    await r.acts.act(M, { item: `pf:${(await r.follows.current(U, `pt:${t2.id}`))!.id}:1`, action: "deny" });
    expect(r.settings.get(M)!.notify.followFrom).toEqual([]);
  });
});

// ===================================================================== what people see

describe("what people see", () => {
  it("activity: done by someone else, can't, and a missed must item each make one row", async () => {
    const r = rig(ist(12, 8));
    await medicine(r);
    await r.at(12, 21);
    await r.reply(M, "cant");
    r.clock.t += 2 * MIN;
    await r.reply(D, "done");
    const t2 = await r.calendar.addTask(U, { title: "Insulin", day: "2026-11-12", time: "08:30", tz: IST });
    void t2;
    const rows = await r.follows.activitySince(U, ist(12, 0));
    expect(rows.map((x) => x.what).sort()).toEqual(["done_by", "passed"]);
    const feed = feedOf({ now: r.clock.t, tzOffsetMinutes: IST, jobs: [], tasks: [], events: [], words: [], follows: rows });
    expect(feed.map((x) => x.title).sort()).toEqual(["Dad said done", "Mom can't do it"]);
    expect(feed[0]!.open).toMatchObject({ screenId: "bots.plan.follow" });
    const r2 = rig(ist(12, 8));
    await medicine(r2, []);
    await r2.at(12, 21);
    await r2.at(13, 3, 1);
    expect((await r2.follows.activitySince(U, ist(12, 0))).map((x) => x.what)).toEqual(["missed"]);
  });

  it("the follow page and the Plan: the asker sees every step, the holder who asked and when the asker hears, the next one \"You're next on it\"; lines and cards", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    const t = await medicine(r);
    await r.at(12, 21);
    const f = await r.only();
    const asker = await r.follows.view(U, f.id);
    expect(asker).toMatchObject({ you: "asker", holder: { name: "Mom" }, steps: [{ line: expect.stringContaining("Mom · Notification · sent") }] });
    const mom = await r.follows.view(M, f.id);
    expect(mom).toMatchObject({ you: "holder", asker: { name: "Rahul" }, steps: [], next: { line: "If it isn't done by 9:20 pm, X0 tells Rahul." } });
    expect(mom?.buttons.later.map((l) => l.action)).toEqual(["later_15m", "later_1h", "later_tmrw"]);
    expect(await r.follows.view(D, f.id)).toMatchObject({ you: "backup", buttons: { cant: false } });
    expect(await r.follows.view(X, f.id)).toBeNull();
    const cards = await r.follows.cardsFor(U);
    expect(followLinesOf({ follow: cards }).get(`t:${t.id}`)).toBe("Mom · not done yet");
    expect((await r.follows.cardsFor(M)).cards[0]).toMatchObject({ question: "Mom's evening medicine", reason: "9 pm · from Rahul", item: `pf:${f.id}:1` });
    for (const m of [5, 10, 20]) await r.at(12, 21, m);
    expect((await r.follows.cardsFor(U)).cards[0]).toMatchObject({ question: "Mom hasn't said done" });
  });
});

// ===================================================================== the engine

describe("the engine", () => {
  const token = { platform: "ios" as const, token: "ExponentPushToken[a]", updatedAt: 0, caps: [] as string[] };
  const engine = () => {
    const store = new MemoryPushStore();
    store.candidatesList = [{ userId: U, tokens: [token], lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: IST }];
    const sent: Array<Array<Record<string, unknown>>> = [];
    const e = new PushEngine(store, { send: async (m) => { sent.push(m as never); return m.map((_, i) => ({ status: "ok" as const, id: `t${i}` })); }, receipts: async () => ({}) }, () => structuredClone(PUSH_DEFAULTS), quiet);
    return { e, sent };
  };

  it("engine: notify returns the push id; a collapse id goes only to a phone whose JS tells same-id pushes apart (PushTapSeen); added open hooks hear the push id", async () => {
    const { e, sent } = engine();
    const res = await e.notify(U, { kind: "plan_follow", key: "f1:1:push", vars: { title: "Gas booking", body: "9 pm" }, data: { item: "pf:f1:1" }, collapseId: "follow-f1" }, ist(12, 12));
    expect(res?.id).toBeTruthy();
    // An older JS (no cap) would drop the second push's press: no collapse id, no tag.
    expect(sent[0]![0]).not.toHaveProperty("collapseId");
    expect(sent[0]![0]).not.toHaveProperty("tag");
    token.caps = ["PushTapSeen"];
    await e.notify(U, { kind: "plan_follow", key: "f1:2:push", vars: { title: "Gas booking", body: "9 pm" }, data: { item: "pf:f1:2" }, collapseId: "follow-f1" }, ist(12, 12, 20));
    token.caps = [];
    expect(sent[1]![0]).toMatchObject({ collapseId: "follow-f1", tag: "follow-f1" });
    const heard: string[] = [];
    const off = addPushOpenHook((u, kind, pushId) => heard.push(`${u}|${kind}|${pushId}`));
    e.markOpened(U, res!.id!, "plan_follow");
    off();
    e.markOpened(U, res!.id!, "plan_follow");
    expect(heard).toEqual([`${U}|plan_follow|${res!.id}`]);
  });

  it("engine: an opened push marks the step only for the person it went to (another user's push id changes nothing)", async () => {
    const r = rig(ist(12, 8));
    await medicine(r, [M]);
    await r.at(12, 21);
    const ext = (await r.steps())[0]!.ext!;
    await r.follows.stepSeen(ext, "opened", ist(12, 21, 2), `u:${D}`);
    expect((await r.steps())[0]!.state).toBe("sent");
    await r.follows.stepSeen(ext, "opened", ist(12, 21, 2), `u:${M}`);
    expect((await r.steps())[0]).toMatchObject({ state: "opened", seen_ms: ist(12, 21, 2) });
  });
});

// ===================================================================== review fixes (each fails without its fix)

describe("review fixes", () => {
  const rowsOf = (r: ReturnType<typeof rig>) => (r.calendar as unknown as { rows: { events: { select(m: object): Promise<Array<Record<string, unknown>>> } } }).rows;

  it("leave-by: the asker's own leave-by is not someone else's push: Mom, who holds the dinner, still gets hers", async () => {
    const r = rig(ist(12, 8));
    const e = await r.calendar.addEvent(U, { title: "Dinner at the Sharmas", day: "2026-11-12", time: "21:00", tz: IST, place: "Sharma house" } as never);
    await r.follows.people.setItem(U, { kind: "event", id: e.id }, { people: [{ id: M }] });
    const row = (await rowsOf(r).events.select({ id: e.id }))[0]!;
    r.clock.t = ist(12, 19);
    expect(await r.follows.arm(U, { kind: "event", row: row as never, at: ist(12, 19), start: ist(12, 21), day: "2026-11-12", leftAlready: true })).toBe(true);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    expect((await r.steps()).map((s) => `${s.person}:${s.state}:${s.why}`)).toEqual([`u:${M}:sent:null`]);
  });

  it("people: a failed read of the asker's X0 people is never \"not in your people\": nobody is skipped, the step waits a minute, and a Done meanwhile counts", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r);
    let broken = true;
    r.follows.wire({ contacts: async (u) => { if (broken) throw new Error("spaces read failed"); return r.people[u] ?? []; } });
    await r.at(12, 21);
    const f = await r.only();
    expect(f).toMatchObject({ holder_key: `u:${M}`, cant: [], state: "open" });
    expect(r.kinds()).toEqual([]);
    expect((await r.steps()).filter((s) => s.why === "gone")).toEqual([]);
    broken = false;
    await r.at(12, 21, 1);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    broken = true;
    const out = await r.reply(M, "done");
    expect(out.status).toBe(200);
    expect(out.body.state).toBe("done");
    expect((await r.calendar.task(U, t.id)).done).toBe(true);
  });

  it("people: a failed read while saving who does it saves nothing and says try again (never drops someone)", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r);
    r.follows.wire({ contacts: async () => { throw new Error("spaces read failed"); } });
    await expect(r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: [{ id: D }] })).rejects.toMatchObject({ status: 503 });
    expect((await r.calendar.task(U, t.id)).people?.map((p) => p.id)).toEqual([M, D]);
  });

  it("widget: the holder's card says outside the app only what a push to them may say (no health title, no amount)", async () => {
    const r = rig(ist(12, 8));
    plugFollows();
    const t = await r.calendar.addTask(U, { title: "Mom's insulin ₹540 refill", day: "2026-11-12", time: "21:00", tz: IST });
    await r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: [{ id: M }] });
    await r.at(12, 21);
    expect(r.pushes[0]!.vars).toEqual({ title: "A reminder from Rahul", body: "9 pm" });
    const mom = await r.ease.line(M, IST);
    expect(mom.needs?.question).toBe("A reminder from Rahul");
    expect(JSON.stringify(mom.needs)).not.toMatch(/insulin|540/);
    // In the app the card keeps its words (the person opened X0).
    expect(mom.card?.question).toBe("Mom's insulin ₹540 refill");
    // The asker's own medicine: "Reminder" on their lock screen, as their push says.
    const r2 = rig(ist(12, 8));
    await medicine(r2, []);
    await r2.at(12, 21);
    expect((await r2.ease.line(U, IST)).needs?.question).toBe("Reminder");
  });

  it("widget: a muted chat with the asker keeps the asker's item off the person's Plan and widget too", async () => {
    const r = rig(ist(12, 8));
    r.muted.add(`${M}|${U}`);
    await medicine(r, [M]);
    await r.at(12, 21);
    expect((await r.only()).state).toBe("told");
    expect((await r.follows.cardsFor(M)).cards).toEqual([]);
  });

  it("repair: a to-do someone said done and the asker un-ticked on purpose stays un-ticked (and a bill stays unpaid)", async () => {
    const r = rig(ist(12, 8), { capture: true });
    const t = await medicine(r);
    await r.at(12, 21);
    await r.reply(M, "done");
    expect((await r.calendar.task(U, t.id)).done).toBe(true);
    await r.calendar.tickTask(U, t.id, false);
    await new Promise((res) => setTimeout(res, 0));
    r.clock.t = ist(12, 22, 30);
    await r.follows.sweep(r.clock.t);
    expect((await r.calendar.task(U, t.id)).done).toBe(false);
    expect((await r.only()).answers.at(-1)).toMatchObject({ by: `u:${U}`, verb: "undone", via: "item" });
    // A bill: Paid by Dad, then the asker takes it back on the Plan; next month's is not made again by the repair.
    const r2 = rig(ist(12, 8), { capture: true });
    const b = await r2.calendar.addTask(U, { title: "Electricity", day: "2026-11-12", tz: IST }, { kind: "me" }, null, { kind: "due", repeat: "monthly" });
    await r2.calendar.setFollow(U, { kind: "task", id: b.id }, { people: [{ k: "u", id: D }] });
    await r2.at(12, 10);
    await r2.reply(D, "done");
    const cap = (await import("../src/botsBots/planCapture.js")).planCapture()!;
    await cap.paid(U, b.id, false);
    await new Promise((res) => setTimeout(res, 0));
    r2.clock.t = ist(12, 11, 30);
    await r2.follows.sweep(r2.clock.t);
    expect((await r2.calendar.task(U, b.id)).done).toBe(false);
    expect((await r2.calendar.list(U, { from: "2026-12-12", to: "2026-12-12", tz: IST })).tasks.filter((x) => x.kind === "due")).toHaveLength(0);
  });

  it("who: setting who does it rebuilds the order: someone just taken off never gets the job, and \"just me\" gives it to the asker", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r);
    await r.at(12, 21);
    expect(r.kinds()).toEqual(["M:space_follow"]);
    await r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: [] });
    const f = await r.only();
    expect(f.holder_key).toBe(`u:${U}`);
    expect(f.people.map((p) => p.id)).toEqual([U]);
    expect(r.kinds()).toEqual(["M:space_follow", "U:plan_follow"]);
    // Someone added while it is open joins the order (after whoever holds it).
    await r.follows.people.setItem(U, { kind: "task", id: t.id }, { people: [{ name: "me" }, { id: D }] });
    expect((await r.only()).people.map((p) => p.id)).toEqual([U, D]);
    expect((await r.only()).holder_key).toBe(`u:${U}`);
  });

  it("done: a Done after the follow closed as missed still ticks the item when it is still open", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r, [M]);
    await r.at(12, 21);
    await r.at(13, 3, 1);
    expect((await r.only()).state).toBe("missed");
    r.clock.t = ist(13, 3, 30);
    const out = await r.reply(M, "done");
    expect(out.status).toBe(200);
    expect(out.body.state).toBe("done");
    expect((await r.calendar.task(U, t.id)).done).toBe(true);
    expect(await r.only()).toMatchObject({ state: "done", done_by: { id: M } });
    // An item that moved on (taken out) says it plainly and changes nothing.
    const r2 = rig(ist(12, 8));
    const t2 = await medicine(r2, [M]);
    await r2.at(12, 21);
    await r2.at(13, 3, 1);
    await r2.calendar.removeTask(U, t2.id);
    expect((await r2.reply(M, "done")).body).toMatchObject({ state: "already", message: "That one's over." });
  });

  it("tell: a must item that is only the asker's has nobody to tell: it stays open and never says the family was told", async () => {
    const r = rig(ist(12, 8));
    const t = await medicine(r, []);
    for (const m of [0, 5, 10, 15, 20]) await r.at(12, 21, m);
    const f = await r.only();
    expect(f.state).toBe("open");
    expect((await r.steps()).find((s) => s.rung === "tell")).toMatchObject({ state: "skipped", why: "none" });
    expect(followLinesOf({ follow: await r.follows.cardsFor(U) }).get(`t:${t.id}`)).toBe("Must not miss · not done yet");
    expect((await r.follows.view(U, f.id))!.steps.at(-1)!.line).toContain("Told · skipped: nobody else to tell");
  });

  it("calls: Can't, a skip after someone left, and the holder taken off each end X0 is calling for them", async () => {
    const r = rig(ist(12, 8));
    r.set(M, { followFrom: [U] });
    await medicine(r);
    for (const m of [0, 5, 10]) await r.at(12, 21, m);
    expect(r.rings.map((x) => x.userId)).toEqual([M]);
    const f = await r.only();
    await r.reply(M, "cant");
    expect(r.closed).toContain(`${M}|follow:${f.id}:1`);
    // Left the space while it rang: the skip ends the ring.
    const r2 = rig(ist(12, 8));
    r2.set(M, { followFrom: [U] });
    await medicine(r2);
    for (const m of [0, 5, 10]) await r2.at(12, 21, m);
    const f2 = await r2.only();
    r2.people[U] = [{ userId: D, name: "Dad" }];
    await r2.at(12, 21, 15);
    expect(r2.closed).toContain(`${M}|follow:${f2.id}:1`);
    // Taken off the item while it rang.
    const r3 = rig(ist(12, 8));
    r3.set(M, { followFrom: [U] });
    const t3 = await medicine(r3);
    for (const m of [0, 5, 10]) await r3.at(12, 21, m);
    const f3 = await r3.only();
    await r3.follows.people.setItem(U, { kind: "task", id: t3.id }, { people: [{ id: D }] });
    expect(r3.closed).toContain(`${M}|follow:${f3.id}:1`);
  });

  it("phone: real calls to one number stop at the day's limit, whichever accounts it is on", async () => {
    vi.stubEnv("FOLLOW_CALL_ASKER_DAY_MAX", "6"); vi.stubEnv("FOLLOW_CALL_DAY_MAX", "100"); resetConfigForTests();
    const r = rig(ist(12, 8));
    const placed: PhoneCall[] = [];
    setFollowChannels({ phone: { ready: () => true, canCall: async () => "ok", numberKey: async () => "same-number", call: async (m) => { placed.push(m); return { ok: true, ext: `req-${placed.length}` }; } } });
    for (const u of [U, D]) {
      r.set(u, { phoneCall: true, ringMax: 10 });
      for (const title of ["Evening medicine", "Night tablets"]) {
        const t = await r.calendar.addTask(u, { title, day: "2026-11-12", time: "21:00", tz: IST });
        await r.follows.people.setItem(u, { kind: "task", id: t.id }, { importance: "must" });
      }
    }
    for (const m of [0, 5, 10, 15]) await r.at(12, 21, m);
    expect(placed).toHaveLength(3);
    expect((await r.steps()).filter((s) => s.rung === "phone" && s.why === "cap")).toHaveLength(1);
    expect((await r.stores.caps.select({ person: "n:same-number" }))[0]!.n).toBe(3);
  });

  it("deleting an account: numbers others saved for that person go, and their name leaves other people's follows", async () => {
    const r = rig(ist(12, 8));
    await r.stores.numbers.insert({ user_id: U, member_id: M, seal: "sealed", updated_ms: 1 });
    await medicine(r);
    await r.at(12, 21);
    await r.reply(M, "done");
    await r.follows.forget(M);
    expect(await r.stores.numbers.select({ member_id: M })).toEqual([]);
    const f = await r.only();
    expect(f.people.find((p) => p.id === M)!.name).toBe("");
    expect(f.done_by!.name).toBe("");
    expect(f.people.map((p) => p.name)).not.toContain("Mom");
  });
});

/**
 * The call judge (botsBots/planCallJudge.ts), over a memory calendar and table, a fake reader, a fake ringer and a fake clock:
 *
 *   - the calendar's change hook: each write says the right thing; a throwing hook leaves the write done; a snooze and a reminder say nothing
 *   - who it works for: no AI yes, judge off, not on the list, Calls off: no model call, no row, no ring
 *   - a settled burst of writes is one judgement; the model never delays an add; once per change; one claim across servers
 *   - the verdict and its ring: the tick rings once through the seam's ringer, retries busy, leaves the rules' own rings to the rules
 *   - a series is judged once and rings each week; done, gone or changed items ring nothing
 *   - verdictFor (pt:, pe:, pf:), consent taken back, failed reads and their retries, the fill, cost, and logs without words
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { Calendar } from "../src/calendar/service.js";
import { memoryCalendarRows, type CalendarRows } from "../src/calendar/store.js";
import { PlanCallJudge, type JudgeDeps } from "../src/botsBots/planCallJudge.js";
import { memoryJudgementStore, type JudgementRow, type JudgementStore } from "../src/botsBots/planCallJudgeStore.js";
import { FAILED_RETRY_MS, FILL_MS, KEEP_DONE_MS, RETRY_MS, SETTLE_MAX_MS, SETTLE_MS } from "../src/botsBots/planCallJudgeWords.js";
import { aiConsentWentOff, callJudge, onAiConsentOff, type CallRinger, type ItemSeed } from "../src/botsBots/planCallSeam.js";
import { registerPlanCallJudge } from "../src/routes/bots/planCallJudge.js";
import { setCostSink } from "../src/usage/cost.js";
import type { LeaveRow } from "../src/botsBots/planPrefs.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, IST = 330;
const ist = (d: number, h: number, m = 0, mo = 11) => Date.UTC(2026, mo - 1, d, h, m) - IST * MIN;
/** Thu 12 Nov 2026, 4:10 pm in India. */
const NOW = ist(12, 16, 10);
const U = "aaaaaaaa-0000-4000-8000-000000000001", V = "bbbbbbbb-0000-4000-8000-000000000002";
const FOLLOW = "cccccccc-0000-4000-8000-000000000003";

const ANSWER = (o: { call?: boolean; at?: string } = {}) =>
  JSON.stringify({ reasoning: "secret reasoning words", call: o.call ?? true, at: o.at ?? "before:600", why: "A flight they cannot miss." });

interface State { on: boolean; allow: string; consent: boolean; calls: boolean; calls_on: boolean; leaves: LeaveRow[]; follow: string | null }

function rig(o: Partial<State> = {}) {
  const state: State = { on: true, allow: "*", consent: true, calls: true, calls_on: true, leaves: [], follow: null, ...o };
  const rows: CalendarRows = memoryCalendarRows();
  const cal = new Calendar({ rows, now: () => Date.now(), publish: () => undefined });
  const table: JudgementStore = memoryJudgementStore(rows);
  const answer = { text: ANSWER() as string | Error | Promise<never>, usd: 0.0004 };
  const text = vi.fn(async () => {
    if (answer.text instanceof Error) throw answer.text;
    return { text: answer.text as string, usd: answer.usd };
  });
  const ringItem = vi.fn<CallRinger["ringItem"]>(async () => ({ id: "call-1" }));
  const ringer = { current: { ringItem } as CallRinger | null };
  const logs: string[] = [];
  const log = { info: (a: object, m: string) => logs.push(`${m} ${JSON.stringify(a)}`), warn: (a: object, m: string) => logs.push(`${m} ${JSON.stringify(a)}`) };
  const deps: JudgeDeps = {
    rows, calendar: cal, table, readers: { text }, ringer: () => ringer.current,
    flags: () => ({ on: state.on, allow: state.allow }), callsOn: () => state.calls_on,
    consent: async () => state.consent, settings: async () => ({ notify: { calls: state.calls, quiet: false } }),
    leaves: async () => state.leaves, followItem: async () => state.follow, names: async () => new Map([[V, "Meera"]]), log,
  };
  const judge = new PlanCallJudge(deps);
  const mk = () => new PlanCallJudge(deps);
  const all = () => (table as unknown as { rows: JudgementRow[] }).rows;
  return { state, rows, cal, table, answer, text, ringItem, ringer, logs, deps, judge, mk, all };
}

/** Lets every waiting promise run (the judge's reads are memory: no timer is needed). */
const drain = async () => { for (let i = 0; i < 30; i += 1) await vi.advanceTimersByTimeAsync(1); };
const settle = async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 50); await drain(); };

const flight = (r: ReturnType<typeof rig>, o: Record<string, unknown> = {}) =>
  r.cal.addEvent(U, { title: "Flight to Delhi", day: "2026-11-13", time: "06:10", place: "Kempegowda Airport", tz: IST, ...o });
const refOf = (id: string) => ({ kind: "event" as const, id: id.split("@")[0]! });
const tref = (id: string) => ({ kind: "task" as const, id });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); setCostSink(null); });

describe("the calendar's change hook", () => {
  const hooked = () => {
    const rows = memoryCalendarRows();
    const cal = new Calendar({ rows, now: () => Date.now(), publish: () => undefined });
    const seen: string[] = [];
    cal.setChangeHook((u, ref, what) => { seen.push(`${ref.kind}:${what}`); expect(u).toBe(U); });
    return { cal, seen, rows };
  };
  it("says the right thing for each event write", async () => {
    const { cal, seen } = hooked();
    const e = await cal.addEvent(U, { title: "Dentist", day: "2026-11-13", time: "17:00", tz: IST });
    await cal.changeEvent(U, e.id, { place: "Indiranagar" });
    await cal.moveEvent(U, e.id, ist(14, 9, 0));
    await cal.setFollow(U, { kind: "event", id: e.id }, { importance: "must" });
    await cal.removeEvent(U, e.id);
    expect(seen).toEqual(["event:added", "event:changed", "event:changed", "event:changed", "event:gone"]);
  });
  it("a series: one start taken out says changed; moved alone, the series changed and the new single start was added", async () => {
    const { cal, seen } = hooked();
    const s = await cal.addEvent(U, { title: "Call Nani", day: "2026-11-09", time: "09:00", repeat: "weekly", tz: IST });
    seen.length = 0;
    await cal.removeEvent(U, `${s.id}@2026-11-16`, { one: true });
    expect(seen).toEqual(["event:changed"]);
    seen.length = 0;
    await cal.moveEvent(U, `${s.id}@2026-11-23`, ist(23, 11, 0));
    expect(seen).toEqual(["event:changed", "event:added"]);
  });
  it("says the right thing for each to-do write", async () => {
    const { cal, seen } = hooked();
    const t = await cal.addTask(U, { title: "Call the bank", day: "2026-11-13", time: "15:00", tz: IST });
    await cal.changeTask(U, t.id, { title: "Call the bank back" });
    await cal.tickTask(U, t.id, true);
    await cal.tickTask(U, t.id, false);
    await cal.setFollow(U, { kind: "task", id: t.id }, { importance: "must" });
    await cal.removeTask(U, t.id);
    expect(seen).toEqual(["task:added", "task:changed", "task:done", "task:changed", "task:changed", "task:gone"]);
  });
  it("a space's task: added, changed, done, and gone for the person it comes off", async () => {
    const { cal, seen } = hooked();
    const item = { taskId: "st1", spaceId: "sp1", spaceName: "Family", kind: "task" as const, title: "Buy gift", notes: "", place: "", at: ist(14, 12, 0), end: null, allDay: false, by: V, name: "Meera", done: false };
    await cal.landSpace(U, item);
    await cal.landSpace(U, { ...item, title: "Buy a gift" });
    await cal.landSpace(U, { ...item, done: true });
    await cal.unlandSpace("st1", U);
    expect(seen).toEqual(["task:added", "task:changed", "task:done", "task:gone"]);
  });
  it("a hook that throws leaves the write done", async () => {
    const rows = memoryCalendarRows();
    const cal = new Calendar({ rows, now: () => Date.now(), publish: () => undefined });
    cal.setChangeHook(() => { throw new Error("boom"); });
    const e = await cal.addEvent(U, { title: "Dentist", day: "2026-11-13", time: "17:00", tz: IST });
    expect(await rows.events.select({ id: e.id }, { limit: 1 })).toHaveLength(1);
  });
  it("later() and remind() are bookkeeping and say nothing", async () => {
    const { cal, seen } = hooked();
    const t = await cal.addTask(U, { title: "Call the bank", day: "2026-11-12", time: "17:00", tz: IST });
    seen.length = 0;
    await cal.later(U, t.id);
    await cal.remind(async () => undefined);
    expect(seen).toEqual([]);
  });
});

describe("who it works for", () => {
  it("with no AI yes nothing is sent and nothing is kept", async () => {
    const r = rig({ consent: false });
    r.cal.setChangeHook(r.judge.onChange);
    await flight(r);
    await settle();
    expect(r.text).not.toHaveBeenCalled();
    expect(r.all()).toHaveLength(0);
  });
  it("judge off, or not on the list: nothing", async () => {
    for (const o of [{ on: false }, { allow: V }, { allow: "" }, { calls_on: false }]) {
      const r = rig(o);
      r.cal.setChangeHook(r.judge.onChange);
      await flight(r);
      await settle();
      expect(r.text, JSON.stringify(o)).not.toHaveBeenCalled();
      expect(r.all()).toHaveLength(0);
    }
  });
  it("the person's own Calls setting off: no model call, no ring", async () => {
    const r = rig({ calls: false });
    r.cal.setChangeHook(r.judge.onChange);
    await flight(r);
    await settle();
    expect(r.text).not.toHaveBeenCalled();
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
  });
  it("a person on the list is judged", async () => {
    const r = rig({ allow: `${V}, ${U}` });
    r.cal.setChangeHook(r.judge.onChange);
    await flight(r);
    await settle();
    expect(r.text).toHaveBeenCalledTimes(1);
  });
});

describe("one judgement per settled change", () => {
  it("adding an item asks the model once after the settle, and keeps the verdict and the moment", async () => {
    const r = rig();
    r.cal.setChangeHook(r.judge.onChange);
    const e = await flight(r);
    expect(r.text).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1000);
    expect(r.text).not.toHaveBeenCalled();
    await settle();
    expect(r.text).toHaveBeenCalledTimes(1);
    const [row] = r.all();
    expect(row).toMatchObject({ user_id: U, item: `e:${e.id}`, state: "set", call: true, at: "before:600", why: "A flight they cannot miss.", tries: 0 });
    expect(row!.next_ring_ms).toBe(ist(12, 20, 10));
    expect(row!.ring_key).toBe(`judge:pe:${e.id}:2026-11-13@${ist(13, 6, 10)}`);
    expect(row!.sig).toMatch(/^[0-9a-f]{16}$/);
  });
  it("the hook returns before any read, and a model that never answers delays nothing", async () => {
    const r = rig();
    r.text.mockImplementation(() => new Promise<never>(() => undefined));
    r.cal.setChangeHook(r.judge.onChange);
    const t0 = Date.now();
    const t = await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", tz: IST });
    await r.cal.addEvent(U, { title: "Meet", day: "2026-11-13", time: "10:00", tz: IST });
    expect(Date.now() - t0).toBe(0);
    expect(t.id).toBeTruthy();
    await settle();
    // one at a time per person: the second waits behind the first
    expect(r.text).toHaveBeenCalledTimes(1);
  });
  it("an add and a setFollow inside the settle are one judgement; a snooze is none; a title change is one more", async () => {
    const r = rig();
    r.cal.setChangeHook(r.judge.onChange);
    const t = await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", time: "15:00", tz: IST });
    await vi.advanceTimersByTimeAsync(5_000);
    await r.cal.setFollow(U, { kind: "task", id: t.id }, { importance: "must" });
    await settle();
    expect(r.text).toHaveBeenCalledTimes(1);
    await r.cal.later(U, t.id);
    await settle();
    expect(r.text).toHaveBeenCalledTimes(1);
    await r.judge.judge(U, tref(t.id));
    expect(r.text).toHaveBeenCalledTimes(1);
    await r.cal.changeTask(U, t.id, { title: "Pay school fee today" });
    await settle();
    expect(r.text).toHaveBeenCalledTimes(2);
  });
  it("a steady stream of changes is judged within a minute of the first", async () => {
    const r = rig();
    r.cal.setChangeHook(r.judge.onChange);
    const t = await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", time: "15:00", tz: IST });
    for (let i = 0; i < 6; i += 1) { await vi.advanceTimersByTimeAsync(SETTLE_MS - 1000); await r.cal.changeTask(U, t.id, { notes: `n${i}` }); }
    await drain();
    expect(r.text.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(Date.now() - NOW).toBeGreaterThan(SETTLE_MAX_MS - 1);
  });
  it("two servers judging the same change: one model call (the claim)", async () => {
    const r = rig();
    const e = await flight(r);
    const other = r.mk();
    await Promise.all([r.judge.judge(U, refOf(e.id)), other.judge(U, refOf(e.id))]);
    expect(r.text).toHaveBeenCalledTimes(1);
    expect(r.all()).toHaveLength(1);
  });
  it("a changed verdict clears the call, or moves it", async () => {
    const r = rig();
    const e = await flight(r);
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()[0]!.next_ring_ms).toBe(ist(12, 20, 10));
    await r.cal.changeEvent(U, e.id, { place: "Terminal 2" });
    r.answer.text = ANSWER({ at: "before:300" });
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()[0]).toMatchObject({ at: "before:300", next_ring_ms: ist(13, 1, 10) });
    await r.cal.changeEvent(U, e.id, { place: "Terminal 3" });
    r.answer.text = ANSWER({ call: false, at: "due" });
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()[0]).toMatchObject({ state: "off", call: false, next_ring_ms: null });
  });
  it("a to-do with no day is `off` (no time) without asking, and a past one-off is `past`", async () => {
    const r = rig();
    const none = await r.cal.addTask(U, { title: "Someday read", tz: IST });
    await r.judge.judge(U, tref(none.id));
    expect(r.all()[0]).toMatchObject({ state: "off", why: "no time" });
    vi.setSystemTime(ist(13, 12, 0));
    const e = await r.cal.addEvent(U, { title: "Old thing", day: "2026-11-13", time: "09:00", tz: IST });
    await r.judge.judge(U, refOf(e.id));
    expect(r.all().find((x) => x.item === `e:${e.id}`)).toMatchObject({ state: "past" });
    expect(r.text).not.toHaveBeenCalled();
  });
});

describe("the ring", () => {
  const judged = async (r: ReturnType<typeof rig>, e: { id: string }) => { await r.judge.judge(U, refOf(e.id)); return r.all()[0]!; };

  it("at the moment, rings once through the ringer with the item's seed and lock-safe words", async () => {
    const r = rig();
    const e = await flight(r);
    const row = await judged(r, e);
    vi.setSystemTime(row.next_ring_ms! - 1000);
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
    vi.setSystemTime(row.next_ring_ms!);
    await r.judge.tick();
    expect(r.ringItem).toHaveBeenCalledTimes(1);
    const [uid, seed, o] = r.ringItem.mock.calls[0]!;
    expect(uid).toBe(U);
    expect(seed).toEqual<ItemSeed>({
      source: "item", item: `pe:${e.id}:2026-11-13`, kind: "event", eventId: e.id, day: "2026-11-13", tz: IST, title: "Flight to Delhi", place: "Kempegowda Airport",
      at: ist(13, 6, 10), allDay: false, payee: "", pay: false, must: true, lead: 600, why: "A flight they cannot miss.",
    });
    expect(o).toMatchObject({ key: row.ring_key, line: "Flight to Delhi tomorrow at 6:10 am", more: "Kempegowda Airport" });
    // a one-off has nothing waiting after it rang
    expect(r.all()[0]!.next_ring_ms).toBeNull();
    await r.judge.tick();
    expect(r.ringItem).toHaveBeenCalledTimes(1);
  });
  it("two ticks at once ring once", async () => {
    const r = rig();
    const row = await judged(r, await flight(r));
    vi.setSystemTime(row.next_ring_ms!);
    await Promise.all([r.judge.tick(), r.mk().tick(), r.judge.tick()]);
    expect(r.ringItem).toHaveBeenCalledTimes(1);
  });
  it("busy: again in 2 minutes, and not past 20 minutes after the moment", async () => {
    const r = rig();
    r.ringItem.mockResolvedValue({ none: "busy" });
    const row = await judged(r, await flight(r));
    const base = row.next_ring_ms!;
    for (let i = 0; i <= 15; i += 1) { vi.setSystemTime(base + i * RETRY_MS); await r.judge.tick(); }
    expect(r.ringItem).toHaveBeenCalledTimes(11);
    expect(r.all()[0]!.next_ring_ms).toBeNull();
  });
  it("too_soon retries the same way; item_recent does not", async () => {
    const r = rig();
    r.ringItem.mockResolvedValueOnce({ none: "too_soon" });
    const base = (await judged(r, await flight(r))).next_ring_ms!;
    vi.setSystemTime(base);
    await r.judge.tick();
    expect(r.all()[0]!.next_ring_ms).toBe(base + RETRY_MS);
    r.ringItem.mockResolvedValueOnce({ none: "item_recent" });
    vi.setSystemTime(base + RETRY_MS);
    await r.judge.tick();
    expect(r.all()[0]!.next_ring_ms).toBeNull();
    expect(r.ringItem).toHaveBeenCalledTimes(2);
  });
  it("no ringer installed: no throw, nothing rings, and it is logged", async () => {
    const r = rig();
    r.ringer.current = null;
    const row = await judged(r, await flight(r));
    vi.setSystemTime(row.next_ring_ms!);
    await expect(r.judge.tick()).resolves.toBeUndefined();
    expect(r.logs.some((l) => l.includes("[judge] none") && l.includes("no_ringer"))).toBe(true);
  });
  it("the Calls setting turned off before the moment: no ring", async () => {
    const r = rig();
    const row = await judged(r, await flight(r));
    r.state.calls = false;
    vi.setSystemTime(row.next_ring_ms!);
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
  });
  it("done or taken out before the moment: no ring", async () => {
    const r = rig();
    r.cal.setChangeHook(r.judge.onChange);
    const t = await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", time: "15:00", tz: IST });
    r.answer.text = ANSWER({ at: "due" });
    await settle();
    expect(r.all()[0]!.next_ring_ms).toBe(ist(13, 15, 0));
    await r.cal.tickTask(U, t.id, true);
    await drain();
    expect(r.all()[0]).toMatchObject({ state: "done", next_ring_ms: null });
    vi.setSystemTime(ist(13, 15, 0));
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
    const e = await flight(r);
    await r.judge.judge(U, refOf(e.id));
    await r.cal.removeEvent(U, e.id);
    await drain();
    expect(r.all().find((x) => x.item === `e:${e.id}`)).toMatchObject({ state: "gone", next_ring_ms: null });
  });
  it("an item changed since the verdict rings nothing until it is judged again", async () => {
    const r = rig();
    const e = await flight(r);
    const row = await judged(r, e);
    await r.rows.events.update({ id: e.id }, { title: "Flight to Mumbai" });
    vi.setSystemTime(row.next_ring_ms!);
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
  });
  it("a bill due today judged `due` is left to the rules' own rings", async () => {
    vi.setSystemTime(ist(12, 8, 0));
    const r = rig();
    const bill = await r.cal.addTask(U, { title: "Electricity", day: "2026-11-12", time: "", tz: IST }, { kind: "me" }, null, { kind: "due", amount_paise: 214000, payee: "BESCOM" });
    r.answer.text = ANSWER({ at: "due" });
    await r.judge.judge(U, tref(bill.id));
    expect(r.all()[0]).toMatchObject({ state: "set", call: true, next_ring_ms: null });
    vi.setSystemTime(ist(12, 10, 0));
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
  });
  it("a bill judged a day before rings then, with the bill's words and no amount", async () => {
    vi.setSystemTime(ist(11, 8, 0));
    const r = rig();
    const bill = await r.cal.addTask(U, { title: "Electricity", day: "2026-11-12", time: "", tz: IST }, { kind: "me" }, null, { kind: "due", amount_paise: 214000, payee: "BESCOM", pay_link: "upi://pay?pa=bescom@upi" });
    r.answer.text = ANSWER({ at: "before:1440" });
    await r.judge.judge(U, tref(bill.id));
    expect(r.all()[0]!.next_ring_ms).toBe(ist(11, 10, 0));
    vi.setSystemTime(ist(11, 10, 0));
    await r.judge.tick();
    const [, seed, o] = r.ringItem.mock.calls[0]!;
    expect(seed).toMatchObject({ kind: "due", taskId: bill.id, item: `pt:${bill.id}`, payee: "BESCOM", pay: true, lead: 1440 });
    expect(o).toMatchObject({ line: "Electricity due tomorrow", more: "BESCOM" });
    expect(`${o.line} ${o.more}`).not.toMatch(/₹|2,?140/);
  });
  it("a leave-by worked out after the verdict, landing beside its own ring, is skipped at ring time", async () => {
    const r = rig();
    r.answer.text = ANSWER({ at: "leave_by" });
    const e = await flight(r);
    const row = await judged(r, e);
    expect(row.next_ring_ms).toBe(ist(13, 5, 40));
    r.state.leaves = [{ eventId: e.id, start: ist(13, 6, 10), leaveBy: ist(13, 5, 50), minutes: 30, mode: "drive", to: "Airport", title: "Flight" }];
    vi.setSystemTime(ist(13, 5, 40));
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
    expect(r.logs.some((l) => l.includes("[judge] floor"))).toBe(true);
  });
});

describe("a series", () => {
  it("is judged once and rings each week", async () => {
    const r = rig();
    const s = await r.cal.addEvent(U, { title: "Call Nani", day: "2026-11-09", time: "09:00", repeat: "weekly", tz: IST });
    r.answer.text = ANSWER({ at: "due" });
    await r.judge.judge(U, refOf(s.id));
    expect(r.text).toHaveBeenCalledTimes(1);
    expect(r.all()[0]!.next_ring_ms).toBe(ist(16, 9, 0));
    vi.setSystemTime(ist(16, 9, 0));
    await r.judge.tick();
    expect(r.all()[0]!.next_ring_ms).toBe(ist(23, 9, 0));
    vi.setSystemTime(ist(23, 9, 0));
    await r.judge.tick();
    expect(r.ringItem).toHaveBeenCalledTimes(2);
    expect(r.ringItem.mock.calls[0]![1]).toMatchObject({ eventId: `${s.id}@2026-11-16`, item: `pe:${s.id}.2026-11-16:2026-11-16`, day: "2026-11-16", lead: 0 });
    expect(r.ringItem.mock.calls[1]![1]).toMatchObject({ eventId: `${s.id}@2026-11-23`, day: "2026-11-23" });
    expect(r.ringItem.mock.calls[0]![2].key).not.toBe(r.ringItem.mock.calls[1]![2].key);
    expect(r.text).toHaveBeenCalledTimes(1);
  });
});

describe("verdictFor (the seam)", () => {
  it("answers for pt:, pe: (one start of a series) and pf: ids", async () => {
    const r = rig();
    const t = await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", time: "15:00", tz: IST });
    const s = await r.cal.addEvent(U, { title: "Call Nani", day: "2026-11-09", time: "09:00", repeat: "weekly", tz: IST });
    await r.judge.judge(U, tref(t.id));
    await r.judge.judge(U, refOf(s.id));
    const want = { call: true, at: "before:600", why: "A flight they cannot miss." };
    expect(await r.judge.verdictFor(U, `pt:${t.id}`)).toEqual(want);
    expect(await r.judge.verdictFor(U, `pe:${s.id}.2026-11-16:2026-11-16`)).toEqual(want);
    r.state.follow = `pt:${t.id}`;
    expect(await r.judge.verdictFor(U, `pf:${FOLLOW}:1`)).toEqual(want);
  });
  it("a warm cache never outlives a withdrawn yes, even without forget()", async () => {
    const r = rig();
    const t = await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", time: "15:00", tz: IST });
    await r.judge.judge(U, tref(t.id));
    expect(await r.judge.verdictFor(U, `pt:${t.id}`)).not.toBeNull();
    r.state.consent = false;
    expect(await r.judge.verdictFor(U, `pt:${t.id}`)).toBeNull();
    r.state.follow = `pt:${t.id}`;
    expect(await r.judge.verdictFor(U, `pf:${FOLLOW}:1`)).toBeNull();
  });
  it("is null with no AI yes, for an item never judged, for a bad id, and with the judge off", async () => {
    const r = rig();
    const t = await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", time: "15:00", tz: IST });
    await r.judge.judge(U, tref(t.id));
    expect(await r.judge.verdictFor(U, "pt:99999999-0000-4000-8000-000000000009")).toBeNull();
    expect(await r.judge.verdictFor(U, "nonsense")).toBeNull();
    expect(await r.judge.verdictFor(U, `pf:${FOLLOW}:1`)).toBeNull();
    expect(await r.judge.verdictFor(V, `pt:${t.id}`)).toBeNull();
    const fresh = r.mk();
    r.state.consent = false;
    expect(await fresh.verdictFor(U, `pt:${t.id}`)).toBeNull();
    r.state.consent = true;
    r.state.on = false;
    expect(await fresh.verdictFor(U, `pt:${t.id}`)).toBeNull();
  });
  it("a no-call verdict is answered too (call false); a failed or judging row is not", async () => {
    const r = rig();
    const t = await r.cal.addTask(U, { title: "Buy milk", day: "2026-11-13", time: "18:00", tz: IST });
    r.answer.text = ANSWER({ call: false, at: "due" });
    await r.judge.judge(U, tref(t.id));
    expect(await r.judge.verdictFor(U, `pt:${t.id}`)).toMatchObject({ call: false });
    const u = await r.cal.addTask(U, { title: "Other", day: "2026-11-13", time: "18:00", tz: IST });
    r.answer.text = new Error("down");
    await r.judge.judge(U, tref(u.id));
    expect(await r.judge.verdictFor(U, `pt:${u.id}`)).toBeNull();
  });
});

describe("taking back the AI yes", () => {
  it("deletes every row of the person, drops a pending settle and the cache, and nothing rings", async () => {
    const r = rig();
    const off = onAiConsentOff((u) => r.judge.forget(u));
    try {
      r.cal.setChangeHook(r.judge.onChange);
      const e = await flight(r);
      await settle();
      await r.cal.addTask(U, { title: "Pay school fee", day: "2026-11-13", time: "15:00", tz: IST });
      expect(r.all()).toHaveLength(1);
      expect(await r.judge.verdictFor(U, `pe:${e.id}:2026-11-13`)).not.toBeNull();
      const row = r.all()[0]!;
      await aiConsentWentOff(U);
      r.state.consent = false;
      expect(r.all()).toHaveLength(0);
      expect(await r.judge.verdictFor(U, `pe:${e.id}:2026-11-13`)).toBeNull();
      await settle();
      expect(r.text).toHaveBeenCalledTimes(1);
      vi.setSystemTime(row.next_ring_ms!);
      await r.judge.tick();
      expect(r.ringItem).not.toHaveBeenCalled();
    } finally { off(); }
  });
  it("a yes taken back while the AI is reading keeps nothing", async () => {
    const r = rig();
    const e = await flight(r);
    r.text.mockImplementation(async () => { r.state.consent = false; return { text: ANSWER(), usd: 0.0004 }; });
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()).toHaveLength(0);
  });
});

describe("a read that fails", () => {
  it("a model error is `failed` with one try, no ring, and the floor alone applies", async () => {
    const r = rig();
    r.answer.text = new Error("provider down");
    const e = await flight(r);
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()[0]).toMatchObject({ state: "failed", tries: 1, next_ring_ms: null, call: false });
    await r.judge.tick();
    expect(r.ringItem).not.toHaveBeenCalled();
    expect(await r.judge.verdictFor(U, `pe:${e.id}:2026-11-13`)).toBeNull();
  });
  it("bad JSON is `failed` too, and the fill tries again after 10 minutes and stops after 3", async () => {
    const r = rig();
    r.answer.text = "I think you should call.";
    const e = await flight(r);
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()[0]).toMatchObject({ state: "failed", tries: 1 });
    await r.judge.fill();
    await drain();
    expect(r.text).toHaveBeenCalledTimes(1);
    for (const tries of [2, 3]) {
      vi.setSystemTime(Date.now() + FAILED_RETRY_MS + 1000);
      await r.judge.fill();
      await drain();
      expect(r.all()[0]!.tries).toBe(tries);
    }
    expect(r.text).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.now() + FAILED_RETRY_MS + 1000);
    await r.judge.fill();
    await drain();
    expect(r.text).toHaveBeenCalledTimes(3);
  });
  it("a good answer after a failure clears the tries", async () => {
    const r = rig();
    r.answer.text = new Error("down");
    const e = await flight(r);
    await r.judge.judge(U, refOf(e.id));
    r.answer.text = ANSWER();
    vi.setSystemTime(Date.now() + FAILED_RETRY_MS + 1000);
    await r.judge.fill();
    await drain();
    expect(r.all()[0]).toMatchObject({ state: "set", tries: 0 });
  });
});

describe("the fill", () => {
  it("judges an item written while the judge was off, once", async () => {
    const r = rig({ on: false });
    r.cal.setChangeHook(r.judge.onChange);
    await flight(r);
    await settle();
    expect(r.text).not.toHaveBeenCalled();
    r.state.on = true;
    const a = await r.judge.fill();
    await drain();
    expect(a).toMatchObject({ people: 1, queued: 1 });
    expect(r.text).toHaveBeenCalledTimes(1);
    const b = await r.judge.fill();
    await drain();
    expect(b.queued).toBe(0);
    expect(r.text).toHaveBeenCalledTimes(1);
  });
  it("does nothing for a person with no AI yes", async () => {
    const r = rig({ consent: false });
    await flight(r);
    expect(await r.judge.fill()).toMatchObject({ people: 0, queued: 0 });
    expect(r.text).not.toHaveBeenCalled();
  });
  it("deletes a `gone` row 31 days old and keeps a 29 day old one", async () => {
    const r = rig();
    const row = (item: string, age: number): JudgementRow => ({ user_id: U, item, sig: "x", state: "gone", call: false, at: null, why: "", usd: 0, tries: 0, next_ring_ms: null, ring_key: null, changed_ms: 0, judged_ms: null, updated_ms: NOW - age });
    await r.table.insert(row("t:old", KEEP_DONE_MS + DAY));
    await r.table.insert(row("t:new", KEEP_DONE_MS - 2 * DAY));
    const out = await r.judge.fill();
    expect(out.cleaned).toBe(1);
    expect(r.all().map((x) => x.item)).toEqual(["t:new"]);
  });
  it("the ring tick and the fill run on their timers, and stop", async () => {
    const r = rig();
    const e = await flight(r);
    const stop = r.judge.start(r.deps.log);
    await vi.advanceTimersByTimeAsync(FILL_MS + 1000);
    await drain();
    expect(r.text).toHaveBeenCalledTimes(1);
    expect(r.all()[0]!.item).toBe(`e:${e.id}`);
    stop();
    r.text.mockClear();
    await r.cal.addEvent(U, { title: "Other", day: "2026-11-13", time: "09:00", tz: IST });
    await vi.advanceTimersByTimeAsync(FILL_MS * 2);
    expect(r.text).not.toHaveBeenCalled();
  });
});

describe("cost and logs", () => {
  it("keeps what each read cost on the row, and never charges anyone", async () => {
    const sink = vi.fn();
    setCostSink(sink);
    const r = rig();
    const e = await flight(r);
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()[0]!.usd).toBeCloseTo(0.0004, 6);
    await r.cal.changeEvent(U, e.id, { place: "Terminal 2" });
    await r.judge.judge(U, refOf(e.id));
    expect(r.all()[0]!.usd).toBeCloseTo(0.0008, 6);
    expect(sink).not.toHaveBeenCalled();
  });
  it("the read goes with the judge's own prompt and read bounds, never Plan Ease's budget", async () => {
    const r = rig();
    const e = await flight(r);
    await r.judge.judge(U, refOf(e.id));
    const [system, user, opts] = r.text.mock.calls[0] as unknown as [string, string, { where: string; maxTokens: number }];
    expect(system).toContain("whether X0, a planning assistant, should phone this person");
    expect(user).toContain("<item>");
    expect(opts).toMatchObject({ where: "plan:judge", maxTokens: 500 });
  });
  it("no log line holds a title, place, reason or the AI's reasoning, and none stops a call for money", async () => {
    const r = rig();
    const e = await flight(r, { notes: "carry the secret passport number" });
    await r.judge.judge(U, refOf(e.id));
    vi.setSystemTime(r.all()[0]!.next_ring_ms!);
    await r.judge.tick();
    await r.judge.fill();
    const all = r.logs.join("\n");
    expect(all).toContain("[judge] set");
    expect(all).toContain("[judge] rang");
    for (const word of ["Flight", "Delhi", "Kempegowda", "cannot miss", "secret", "passport", "reasoning"]) expect(all, word).not.toContain(word);
    expect(all).not.toMatch(/paise|budget|₹/);
  });
});

describe("the boot wiring", () => {
  it("installs the hook, the verdict reader and the consent listener, and takes them away on close", async () => {
    const r = rig();
    const app = Fastify();
    const judge = registerPlanCallJudge(app, { ease: { calendar: r.cal } }, r.deps);
    await app.ready();
    expect(callJudge()).toBe(judge);
    const e = await flight(r);
    await settle();
    expect(r.text).toHaveBeenCalledTimes(1);
    await aiConsentWentOff(U);
    expect(r.all()).toHaveLength(0);
    await app.close();
    expect(callJudge()).toBeNull();
    r.text.mockClear();
    await r.cal.changeEvent(U, e.id, { place: "Terminal 4" });
    await settle();
    expect(r.text).not.toHaveBeenCalled();
  });
});

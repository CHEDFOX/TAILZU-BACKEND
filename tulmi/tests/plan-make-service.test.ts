/**
 * "PLAN SOMETHING": THE SERVICE (PLAN_V2_MAKE, PLAN_V2_MAKE_AI; src/botsBots/planMakeService.ts; docs/plan-ease.md "Plan something").
 *
 * A memory calendar, the real Plan Ease (its box), the real follow-through (its setItem, its follows), capture's real paid road with a
 * fake reader. Today is Thu 12 Nov 2026 in India. Rahul's X0 people: Mom (saved as "Sunita Sharma"), Dad and Riya.
 *
 *   - the AI read: only with a yes, only for unsure words of 300 characters or fewer, one at a time, ₹1 kept; the rules otherwise
 *   - Check, fixes, Take out, Undo and Done never read
 *   - Done: the calendar (parsed: true, make:<key>:<n>), setItem only for who or must not miss, idempotent, rolled back half way,
 *     nothing pushed; Undo: exactly its own rows
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.NODE_ENV = "test";
});

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanFollows, setPlanFollows } = await import("../src/botsBots/planFollow.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { PlanCapture, memoryCaptureStore, DRAFT_FLOOR } = await import("../src/botsBots/planCapture.js");
const { PlanMake } = await import("../src/botsBots/planMakeService.js");
const { setPlanAsks } = await import("../src/botsBots/planAsks.js");
const { setAddDue } = await import("../src/botsBots/planDue.js");
const { followOn } = await import("../src/botsBots/planSwitch.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { emptyCard } = await import("../src/botsBots/planMake.js");
const { resetConfigForTests } = await import("../src/config.js");
type CardDraft = import("../src/botsBots/planMake.js").CardDraft;
type MakeDraftReply = import("../src/botsBots/planMake.js").MakeDraftReply;
type ReadOpts = import("../src/botsBots/planCapture.js").ReadOpts;

const MIN = 60_000;
const IST = 330;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const MOM = "11111111-0000-4000-8000-000000000001", DAD = "22222222-0000-4000-8000-000000000002", RIYA = "33333333-0000-4000-8000-000000000003";
const STRANGER = "99999999-0000-4000-8000-000000000009";
const quiet = { info: () => undefined, warn: () => undefined };

type Read = { system: string; user: string; o?: ReadOpts };

function rig(t0: number, o: { consent?: boolean; answer?: unknown | ((user: string) => unknown); reader?: (user: string) => Promise<{ text: string; usd: number }> } = {}) {
  const clock = { t: t0 };
  const now = () => clock.t;
  const calendar = new Calendar({ rows: memoryCalendarRows(), now, publish: () => undefined });
  const prefs = memoryPlanPrefs(now);
  const ease = new PlanEase({ calendar, prefs, skips: new MemoryTable(), now, send: async () => undefined });
  ease.attach();
  const stores = memoryFollowStores();
  const pushes: Array<{ userId: string; kind: string }> = [];
  const rings: string[] = [];
  const people: Record<string, Array<{ userId: string; name: string }>> = {
    [U]: [{ userId: MOM, name: "Sunita Sharma" }, { userId: DAD, name: "Dad" }, { userId: RIYA, name: "Riya" }],
  };
  const settingsOf = async () => structuredClone(DEFAULT_SETTINGS);
  const follows = new PlanFollows({
    stores, calendar, now, settingsOf, log: quiet, tzOfUser: async () => IST, contacts: async (u) => people[u] ?? [], muted: async () => false,
    engine: () => ({ notify: async (userId: string, m: { kind: string }) => { pushes.push({ userId, kind: m.kind }); return { sent: true, dropped: 0, id: "p" }; }, configFor: () => structuredClone(PUSH_DEFAULTS) }) as never,
    calls: () => ({ ring: async (userId: string) => { rings.push(userId); return { id: "c" }; }, closeFor: async () => undefined }) as never,
    spend: (u, d) => ease.policy.spend(u, d),
  });
  setPlanFollows(follows);
  ease.wire({ follow: (u, c) => follows.arm(u, c) });
  const reads: Read[] = [];
  const answerOf = (user: string) => (typeof o.answer === "function" ? (o.answer as (u: string) => unknown)(user) : o.answer ?? { items: [], change: false });
  const capture = new PlanCapture({
    calendar, prefs, store: memoryCaptureStore(), now, tzOf: async () => IST, usdInr: () => 100, aiOk: async () => o.consent !== false,
    readers: {
      text: async (system, user, opts) => { reads.push({ system, user, ...(opts ? { o: opts } : {}) }); return o.reader ? o.reader(user) : { text: JSON.stringify(answerOf(user)), usd: 0.0005 }; },
      picture: async () => { throw new Error("no"); }, glance: async () => { throw new Error("no"); },
    },
  });
  // Bills are wired at boot (planInWire.ts): the box's due slot reads only then.
  setAddDue((u, d) => capture.addDue(u, d));
  const setItems: Array<{ ref: { kind: string; id: string }; b: Record<string, unknown> }> = [];
  const realPeople = follows.people;
  const spyPeople = Object.assign(Object.create(Object.getPrototypeOf(realPeople)), realPeople, {
    setItem: async (u: string, ref: { kind: "event" | "task"; id: string }, b: Record<string, unknown>) => { setItems.push({ ref, b }); return realPeople.setItem(u, ref, b); },
    picker: (u: string, ref: null) => realPeople.picker(u, ref),
    missingLine: (l: string[]) => realPeople.missingLine(l),
  });
  const logs: Array<{ o: object; m: string }> = [];
  const make = new PlanMake({
    ease: () => ease, calendar: () => calendar, people: () => (followOn() ? spyPeople : null), capture: () => capture, settingsOf, now,
    log: { info: (x, m) => logs.push({ o: x, m }) },
  });
  const remind = () => calendar.remind(async () => undefined);
  return { clock, calendar, prefs, ease, stores, follows, capture, make, reads, pushes, rings, setItems, logs, remind };
}

beforeEach(() => { vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanFollows(null); setPlanAsks(null); setAddDue(null); });

const card = (o: Partial<CardDraft> = {}, day = "2026-11-12"): CardDraft => ({ ...emptyCard(day), ...o });
const drafted = (r: MakeDraftReply) => { if (r.kind !== "draft") throw new Error(`not a draft: ${r.kind}`); return r; };
const KEY = () => crypto.randomUUID();

describe("the AI read", () => {
  it("no yes to AI (asked once, after onboarding): no read, rules draft, setup says off, and Check never says messy", async () => {
    const r = rig(ist(12, 10), { consent: false });
    expect((await r.make.setup(U, IST)).ai).toBe("off");
    expect((await r.make.check(U, { list: [], d: card({ title: "meet Rahul around 7ish after his class" }), at: "0", tz: IST, day0: "2026-11-12" })).view.messy).toBeUndefined();
    const d = drafted(await r.make.draft(U, { words: "meet Rahul around 7ish after his class", tz: IST }));
    expect(r.reads).toEqual([]);
    expect(d).toMatchObject({ how: "rules", view: { unsure: "X0 filled in what it could. Check the day and the time." } });
    expect(r.logs.at(-1)).toMatchObject({ m: "plan make: draft", o: { how: "rules", items: 1, ai: "consent" } });
    // With the yes, setup says on.
    expect((await rig(ist(12, 10)).make.setup(U, IST)).ai).toBe("on");
  });

  it("a yes and unsure words: one read with the 5 s timeout and the words only, checked again", async () => {
    const r = rig(ist(12, 10), { answer: { items: [{ title: "Meet Rahul", day: "2026-11-12", time: "19:00", time_said: false, who: "Riya", place: "Cafe Coffee Day" }], change: false } });
    const d = drafted(await r.make.draft(U, { words: "meet Rahul around 7ish after his class", tz: IST }));
    expect(r.reads).toHaveLength(1);
    expect(r.reads[0]!.o).toEqual({ timeoutMs: 5_000, totalMs: 8_000, maxTokens: 400, where: "plan:draft" });
    expect(r.reads[0]!.user).toBe("<message>meet Rahul around 7ish after his class</message>");
    for (const name of ["Sunita", "Dad", "Riya", MOM, DAD]) expect(r.reads[0]!.user).not.toContain(name);
    expect(r.reads[0]!.system).toContain("Today is 2026-11-12 (Thursday). It is 10:00 now, their time.");
    // Checked again: Riya and the cafe were never in the words, the time was not said clearly.
    expect(d).toMatchObject({ how: "ai", view: { unsure: "" } });
    expect(d.drafts[0]).toMatchObject({ title: "Meet Rahul", day: "2026-11-12", who: "", place: "", guessed: "1" });
    expect(d.view.items[0]!.notes.map((n) => n.id)).toContain("ampm");
    expect(r.logs.at(-1)!.o).toMatchObject({ how: "ai", ai: "used" });
  });

  it("no read for clear words, for words over 300 characters, for a question that goes to the chat, or with less than ₹1 of today's reading left", async () => {
    const r = rig(ist(12, 10));
    expect(drafted(await r.make.draft(U, { words: "Dentist Fri 5 pm", tz: IST })).how).toBe("rules");
    expect(drafted(await r.make.draft(U, { words: "Buy 2 kg rice", tz: IST })).view.unsure).toBe("");
    const long = `remind me to ${"call the bank about the loan papers and ".repeat(9)}tomorrow 7ish`;
    expect(long.length).toBeGreaterThan(300);
    await r.make.draft(U, { words: long, tz: IST });
    expect(await r.make.draft(U, { words: "Can you tell me what's on tomorrow?", tz: IST })).toEqual({ kind: "box", box: { slot: "chat", kind: "chat", line: "" } });
    expect(r.reads).toEqual([]);
    // Under the floor: ₹4.50 of today's ₹5 already spent.
    await r.prefs.patch(U, { capture_day: "2026-11-12", capture_paise: 500 - DRAFT_FLOOR + 50 } as never);
    const d = drafted(await r.make.draft(U, { words: "meet Rahul around 7ish after his class", tz: IST }));
    expect(r.reads).toEqual([]);
    expect(d.view.unsure).not.toBe("");
    expect(r.logs.at(-1)!.o).toMatchObject({ ai: "spent" });
  });

  it("two sends at once: one read, the other gets the rules draft (busy)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((ok) => { release = ok; });
    const r = rig(ist(12, 10), { reader: async () => { await gate; return { text: JSON.stringify({ items: [{ title: "Meet Rahul", time: "19:00" }] }), usd: 0.0005 }; } });
    const a = r.make.draft(U, { words: "meet Rahul around 7ish after his class", tz: IST });
    await new Promise((ok) => setTimeout(ok, 5));
    const b = await r.make.draft(U, { words: "call Riya around 8ish about the trip", tz: IST });
    expect(drafted(b).how).toBe("rules");
    expect(r.logs.at(-1)!.o).toMatchObject({ ai: "busy" });
    release();
    expect(drafted(await a).how).toBe("ai");
    expect(r.reads).toHaveLength(1);
  });

  it("the budget spent, a read running, a timeout or a throw: the rules draft, said nowhere", async () => {
    const words = "meet Rahul around 7ish after his class";
    for (const reader of [
      async (): Promise<{ text: string; usd: number }> => { throw new Error(`provider echoed: ${words}`); },
      async (): Promise<{ text: string; usd: number }> => { throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }); },
      async () => ({ text: "not json at all", usd: 0.0001 }),
    ]) {
      const r = rig(ist(12, 10), { reader });
      const d = drafted(await r.make.draft(U, { words, tz: IST }));
      expect(d.how).toBe("rules");
      expect(d.view.unsure).toBe("X0 filled in what it could. Check the day and the time.");
      expect(JSON.stringify(d)).not.toMatch(/timed out|provider|error/i);
      expect(JSON.stringify(r.logs)).not.toContain("Rahul");
      expect(r.logs.at(-1)!.o).toMatchObject({ ai: "failed" });
    }
  });

  it("Check, a fix, Take out, Undo and Done never call a reader", async () => {
    const r = rig(ist(12, 10));
    const messy = card({ title: "meet Rahul around 7ish after his class" });
    const c = await r.make.check(U, { list: [], d: messy, at: "0", tz: IST, day0: "2026-11-12" });
    expect(c.view.messy).toBe(true);
    const two = await r.make.check(U, { list: [card({ title: "Gym", time: "other", timeWords: "7" }), card({ title: "Haircut", time: "16:00" })], tz: IST });
    await r.make.check(U, { list: two.drafts, tz: IST, fix: { item: "0", id: "ampm:pm" } });
    await r.make.check(U, { list: two.drafts, tz: IST, drop: "1" });
    const made = await r.make.done(U, { key: KEY(), list: [card({ title: "Haircut", time: "16:00" })], tz: IST });
    await r.make.undo(U, { key: made.key, n: made.n });
    expect(r.reads).toEqual([]);
  });

  it("PLAN_V2_MAKE_AI off: never a read", async () => {
    vi.stubEnv("PLAN_V2_MAKE_AI", "false"); resetConfigForTests();
    const r = rig(ist(12, 10));
    expect((await r.make.setup(U, IST)).ai).toBe("off");
    const d = drafted(await r.make.draft(U, { words: "meet Rahul around 7ish after his class", tz: IST }));
    expect(r.reads).toEqual([]);
    expect(d.how).toBe("rules");
    expect(r.logs.at(-1)!.o).toMatchObject({ ai: "off" });
    // Check never says messy then either.
    expect((await r.make.check(U, { list: [], d: card({ title: "meet Rahul around 7ish after his class" }), at: "0", tz: IST, day0: "2026-11-12" })).view.messy).toBeUndefined();
  });

  it("READ_AI (keep) replaces only the draft at at, keeps the card's who, must not miss and place, and costs one read with the same bounds as Send", async () => {
    const r = rig(ist(12, 10), { answer: { items: [{ title: "Meet Rahul at the cafe", day: "2026-11-12", time: "19:00", time_said: true, who: "Riya", place: "Somewhere" }], change: false } });
    const other = card({ title: "Haircut", time: "16:00" });
    const mine = card({ title: "meet Rahul around 7ish after his class", who: DAD, imp: "must", place: "Indiranagar" });
    const d = drafted(await r.make.draft(U, { words: mine.title, keep: "1", tz: IST, d: mine, list: [other, mine], at: "1", day: "" }));
    expect(r.reads).toHaveLength(1);
    expect(r.reads[0]!.o).toEqual({ timeoutMs: 5_000, totalMs: 8_000, maxTokens: 400, where: "plan:draft" });
    expect(d.drafts.map((x) => x.title)).toEqual(["Haircut", "Meet Rahul at the cafe"]);
    expect(d.drafts[1]).toMatchObject({ who: DAD, imp: "must", place: "Indiranagar", time: "other", timeWords: "7 pm" });
    expect(d.at).toBe("1");
    // Without a yes: the rules' reading of the What, the picks kept, and unsure.
    const no = rig(ist(12, 10), { consent: false });
    const n = drafted(await no.make.draft(U, { words: mine.title, keep: "1", tz: IST, d: mine, list: [other, mine], at: "1" }));
    expect(no.reads).toEqual([]);
    expect(n.drafts[1]).toMatchObject({ who: DAD, imp: "must", place: "Indiranagar" });
    expect(n.view.unsure).not.toBe("");
  });
});

describe("Done and Undo", () => {
  it("Done makes an event with source_key make:<key>:0 and calls setItem only for importance or people", async () => {
    const r = rig(ist(12, 10));
    const key = KEY();
    const made = await r.make.done(U, { key, list: [card({ title: "Dentist", day: "2026-11-13", time: "18:00" })], tz: IST });
    expect(made).toEqual({ ok: true, key, n: 1, day: "2026-11-13", line: "Added: Dentist, Fri 13 Nov, 6\u00a0pm" });
    const rows = await r.calendar.keyed(U, key, 1);
    expect(rows).toMatchObject([{ kind: "event", title: "Dentist", day: "2026-11-13", sourceKey: `make:${key}:0` }]);
    expect(r.setItems).toEqual([]);
    await r.make.done(U, { key: KEY(), list: [card({ title: "Board review", day: "2026-11-13", time: "09:00", imp: "must" })], tz: IST });
    expect(r.setItems).toMatchObject([{ ref: { kind: "event" }, b: { importance: "must" } }]);
    expect(r.logs.find((l) => l.m === "plan make: added")!.o).toMatchObject({ n: 1 });
  });

  it("Done with Dad and must: setItem gets [Dad] and must; the event gets a reminder; nothing is pushed to Dad or anyone, and no follow row exists until the reminder", async () => {
    const r = rig(ist(12, 10));
    const made = await r.make.done(U, { key: KEY(), list: [card({ title: "Pick up Kabir", time: "18:00", who: DAD, imp: "must" })], tz: IST });
    expect(made.line).toBe("Added: Pick up Kabir, today, 6\u00a0pm · X0 reminds Dad at 5:45\u00a0pm");
    expect(r.setItems).toMatchObject([{ b: { importance: "must", people: [{ id: DAD }] } }]);
    const [ev] = (await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-12", tz: IST })).events;
    expect(ev).toMatchObject({ title: "Pick up Kabir", remindMin: 15, importance: "must", people: [{ id: DAD, name: "Dad" }] });
    expect(r.pushes).toEqual([]);
    expect(r.rings).toEqual([]);
    expect(await r.stores.follows.select({})).toEqual([]);
    // At the reminder, the follow is armed.
    r.clock.t = ist(12, 17, 45);
    await r.remind();
    expect((await r.stores.follows.select({})).length).toBe(1);
  });

  it("medicine is reminded at its time", async () => {
    const r = rig(ist(12, 10));
    await r.make.done(U, { key: KEY(), list: [card({ title: "Dad's tablet", time: "21:00", repeat: "daily", who: DAD })], tz: IST });
    const [ev] = (await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-12", tz: IST })).events;
    expect(ev).toMatchObject({ remindMin: 0, repeat: "daily" });
  });

  it("Done twice with one key adds once and answers the same", async () => {
    const r = rig(ist(12, 10));
    const key = KEY();
    const body = { key, list: [card({ title: "Dentist", day: "2026-11-13", time: "18:00", who: DAD })], tz: IST };
    const one = await r.make.done(U, body);
    const two = await r.make.done(U, body);
    expect(two).toEqual(one);
    expect((await r.calendar.list(U, { from: "2026-11-13", to: "2026-11-13", tz: IST })).events).toHaveLength(1);
  });

  it("two Done calls with one key at the same time: the second waits for the first and answers the same rows; nothing is rolled back under the other", async () => {
    const r = rig(ist(12, 10));
    const key = KEY();
    const body = { key, list: [card({ title: "Gym", time: "18:00" }), card({ title: "Swim", day: "2026-11-14", time: "07:00" })], tz: IST };
    const [a, b] = await Promise.all([r.make.done(U, body), r.make.done(U, body)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ n: 2, line: "Added 2 things to your Plan", day: "2026-11-12" });
    expect((await r.calendar.keyed(U, key, 2)).map((x) => x.title)).toEqual(["Gym", "Swim"]);
    expect((await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-14", tz: IST })).events).toHaveLength(2);
  });

  it("every draft and check answer carries a fresh key; Done with a key from an earlier check of a different list makes new rows", async () => {
    const r = rig(ist(12, 10));
    const d1 = drafted(await r.make.draft(U, { words: "Dentist Fri 5 pm", tz: IST }));
    const d2 = drafted(await r.make.draft(U, { words: "Dentist Fri 5 pm", tz: IST }));
    const c1 = await r.make.check(U, { list: d1.drafts, tz: IST });
    const c2 = await r.make.check(U, { list: [...d1.drafts, card({ title: "Gym", time: "18:00" })], tz: IST });
    const keys = [d1.key, d2.key, c1.key, c2.key];
    expect(new Set(keys).size).toBe(4);
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const first = await r.make.done(U, { key: c1.key, list: c1.drafts, tz: IST });
    const second = await r.make.done(U, { key: c2.key, list: c2.drafts, tz: IST });
    expect(first.n).toBe(1);
    expect(second.n).toBe(2);
    expect((await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-13", tz: IST })).events).toHaveLength(3);
  });

  it("Done saves the checked title exactly: a to-do Friday prayer on Sat stays Friday prayer on Sat; Morning walk every day with no time stays all day (addTask/addEvent get parsed: true)", async () => {
    const r = rig(ist(12, 10));
    const c = await r.make.check(U, { list: [], d: card({ title: "Friday prayer", day: "2026-11-14" }), at: "0", tz: IST, day0: "2026-11-12" });
    expect(c.view.items[0]).toMatchObject({ head: "Friday prayer", when: "To do · Sat 14 Nov" });
    await r.make.done(U, { key: c.key, list: c.drafts, tz: IST });
    const w = await r.make.check(U, { list: [], d: card({ title: "Morning walk", repeat: "daily" }), at: "0", tz: IST, day0: "2026-11-12" });
    expect(w.view.items[0]).toMatchObject({ head: "Morning walk", when: "Every day · all day" });
    await r.make.done(U, { key: w.key, list: w.drafts, tz: IST });
    const l = await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-14", tz: IST });
    expect(l.tasks.map((t) => [t.title, t.due])).toEqual([["Friday prayer", "2026-11-14"]]);
    expect(l.events.filter((e) => e.day === "2026-11-12").map((e) => [e.title, e.allDay, e.repeat])).toEqual([["Morning walk", true, "daily"]]);
  });

  it("Pick up Kabir 5 pm for Dad, made at 4:50 pm: the event's reminder is shortened to come at 4:51 and the follow is armed when it comes", async () => {
    const r = rig(ist(12, 16, 50));
    const c = await r.make.check(U, { list: [], d: card({ title: "Pick up Kabir", time: "other", timeWords: "5 pm", who: DAD }), at: "0", tz: IST, day0: "2026-11-12" });
    expect(c.view.items[0]).toMatchObject({ head: "Pick up Kabir", when: "Today · 5 pm", whoLine: "For Dad · reminded at 4:51 pm", mustLine: "Must not miss" });
    const made = await r.make.done(U, { key: c.key, list: c.drafts, tz: IST });
    expect(made.line).toBe("Added: Pick up Kabir, today, 5\u00a0pm · X0 reminds Dad at 4:51\u00a0pm");
    const [ev] = (await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-12", tz: IST })).events;
    expect(ev!.remindMin).toBe(9);
    r.clock.t = ist(12, 16, 51);
    await r.remind();
    const follows = await r.stores.follows.select({});
    expect(follows).toHaveLength(1);
    expect(follows[0]).toMatchObject({ user_id: U });
  });

  it("weekly Tue and Thu made on a Thursday morning: MadeView.day is today, not next Tuesday", async () => {
    const r = rig(ist(12, 8));
    const made = await r.make.done(U, { key: KEY(), list: [card({ title: "Swim", time: "18:00", repeat: "weekly", days: ["2", "4"] })], tz: IST });
    expect(made).toMatchObject({ n: 2, day: "2026-11-12", line: "Added: Swim, every Tue and Thu, 6\u00a0pm" });
  });

  it("Done refuses a past time with the stop's words and adds nothing", async () => {
    const r = rig(ist(12, 10));
    await expect(r.make.done(U, { key: KEY(), list: [card({ title: "Call bank", time: "09:00" })], tz: IST })).rejects.toMatchObject({ status: 400, code: "fix_first", message: "That time has passed." });
    // Someone else on it with no day: the stop names them.
    await expect(r.make.done(U, { key: KEY(), list: [card({ title: "Buy fruit", day: "", who: DAD })], tz: IST })).rejects.toMatchObject({ code: "fix_first", message: "Pick a day so X0 can remind Dad." });
    const l = await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-12", tz: IST });
    expect([...l.events, ...l.tasks, ...l.open]).toEqual([]);
  });

  it("Done with someone not in X0 people saves it for you and says so", async () => {
    const r = rig(ist(12, 10));
    const made = await r.make.done(U, { key: KEY(), list: [card({ title: "Send the deck", day: "2026-11-13", whoName: "Rahul" })], tz: IST });
    expect(made.line).toBe("Added: Send the deck (Rahul), Fri 13 Nov");
    expect(made.missing).toBe("Rahul isn't in your X0 people yet. Invite them to a space, then add them here.");
    const left = await r.make.done(U, { key: KEY(), list: [card({ title: "Pick up the cake", time: "18:00", who: STRANGER })], tz: IST });
    expect(left.missing).toBe("That person isn't in your X0 people yet. Invite them to a space, then add them here.");
    const tasks = (await r.calendar.list(U, { from: "2026-11-13", to: "2026-11-13", tz: IST })).tasks;
    expect(tasks.map((t) => [t.title, t.people ?? null])).toEqual([["Send the deck (Rahul)", null]]);
    expect(r.setItems).toEqual([]);
  });

  it("weekly on Tue and Thu makes two weekly events; Undo takes both out", async () => {
    const r = rig(ist(12, 19));
    const made = await r.make.done(U, { key: KEY(), list: [card({ title: "Swim", time: "18:00", repeat: "weekly", days: ["2", "4"] })], tz: IST });
    // Thursday's 6 pm has passed: Thursday's row starts next week, Tuesday's next Tuesday.
    expect(made).toMatchObject({ n: 2, day: "2026-11-17" });
    const rows = await r.calendar.keyed(U, made.key, 2);
    expect(rows.map((x) => [x.day, x.repeat])).toEqual([["2026-11-17", "weekly"], ["2026-11-19", "weekly"]]);
    expect(await r.make.undo(U, { key: made.key, n: 2 })).toEqual({ ok: true, removed: 2 });
    expect(await r.calendar.keyed(U, made.key, 2)).toEqual([]);
    expect(r.logs.find((l) => l.m === "plan make: undone")!.o).toEqual({ removed: 2 });
  });

  it("Undo takes out only its own rows", async () => {
    const r = rig(ist(12, 10));
    const mine = await r.calendar.addEvent(U, { title: "Standup", day: "2026-11-13", time: "09:30", tz: IST });
    const made = await r.make.done(U, { key: KEY(), list: [card({ title: "Dentist", day: "2026-11-13", time: "18:00" })], tz: IST });
    // Another person's undo with the same key takes nothing; a bigger n takes only what exists.
    const other = "bbbbbbbb-0000-4000-8000-000000000002";
    expect(await r.make.undo(other, { key: made.key, n: 1 })).toEqual({ ok: true, removed: 0 });
    expect(await r.make.undo(U, { key: made.key, n: 5 })).toEqual({ ok: true, removed: 1 });
    expect(await r.make.undo(U, { key: made.key, n: 1 })).toEqual({ ok: true, removed: 0 });
    expect((await r.calendar.list(U, { from: "2026-11-13", to: "2026-11-13", tz: IST })).events.map((e) => e.id)).toEqual([mine.id]);
    await expect(r.make.undo(U, { key: "nope", n: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(r.make.undo(U, { key: made.key, n: 22 })).rejects.toMatchObject({ status: 400 });
  });

  it("a failure half way takes out what that Done made", async () => {
    const r = rig(ist(12, 10));
    const real = r.calendar.addEvent.bind(r.calendar);
    let calls = 0;
    r.calendar.addEvent = (async (...a: Parameters<typeof real>) => { calls += 1; if (calls === 2) throw new Error("db down"); return real(...a); }) as typeof real;
    const key = KEY();
    await expect(r.make.done(U, { key, list: [card({ title: "Gym", time: "18:00" }), card({ title: "Swim", day: "2026-11-14", time: "07:00" })], tz: IST })).rejects.toThrow("db down");
    expect(await r.calendar.keyed(U, key, 2)).toEqual([]);
    expect((await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-14", tz: IST })).events).toEqual([]);
    // A row an earlier Done made with the same key is never taken out by a later failure.
    r.calendar.addEvent = real;
    const k2 = KEY();
    await r.make.done(U, { key: k2, list: [card({ title: "Gym", time: "18:00" })], tz: IST });
    calls = 0;
    r.calendar.addEvent = (async (...a: Parameters<typeof real>) => { calls += 1; throw new Error("db down"); }) as typeof real;
    await expect(r.make.done(U, { key: k2, list: [card({ title: "Gym", time: "18:00" }), card({ title: "Swim", day: "2026-11-14", time: "07:00" })], tz: IST })).rejects.toThrow("db down");
    expect((await r.calendar.keyed(U, k2, 2)).map((x) => x.title)).toEqual(["Gym"]);
  });
});

describe("the box's other answers", () => {
  it("bills and waits come back as a preview; a family ask, a day question and notes go to the box; a question goes to the chat", async () => {
    const r = rig(ist(12, 10));
    // The bill's preview says what Done would add (the box's own due reader): the amount and the day, not the words again.
    expect(await r.make.draft(U, { words: "Electricity 2140 due 14th", tz: IST })).toEqual({ kind: "preview", preview: { slot: "due", line: "Looks like a bill. Add it?", words: "Electricity 2140 due 14th", sum: "Electricity ₹2,140 · due Sat 14 Nov" } });
    expect(await r.make.draft(U, { words: "Rahul will send the numbers by Thursday", tz: IST })).toEqual({ kind: "preview", preview: { slot: "wait", line: "Looks like you're waiting on someone. Add it?", words: "Rahul will send the numbers by Thursday" } });
    // Nothing was added by a preview.
    let l = await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-20", tz: IST });
    expect([...l.events, ...l.tasks, ...l.open]).toEqual([]);
    const asks: string[] = [];
    setPlanAsks({ preview: async (_u: string, _r: unknown, words: string) => { asks.push(words); return { slot: "ask", kind: "said", line: "Ask Ghar who picks Kabir up Wed?", act: { item: "stask:s:t", action: "ask", label: "Ask" } }; } } as never);
    const ask = await r.make.draft(U, { words: "Who picks Kabir up Wednesday?", tz: IST });
    expect(ask).toMatchObject({ kind: "box", box: { slot: "ask", act: { label: "Ask" } } });
    expect(asks).toHaveLength(1);
    const day = await r.make.draft(U, { words: "What's on Friday?", tz: IST });
    expect(day).toMatchObject({ kind: "box", box: { slot: "day", kind: "day", day: "2026-11-13" } });
    const notes = await r.make.draft(U, { words: "No evening notes", tz: IST });
    expect(notes).toMatchObject({ kind: "box", box: { slot: "notes", kind: "said" } });
    expect(await r.make.draft(U, { words: "Should I move the gym", tz: IST })).toEqual({ kind: "box", box: { slot: "chat", kind: "chat", line: "" } });
    // A plan request with a polite front is a draft, not the chat, and nothing is added before Done.
    const polite = drafted(await r.make.draft(U, { words: "Can you remind me to call the bank tomorrow?", tz: IST }));
    expect(polite.view.items[0]).toMatchObject({ head: "Call the bank", when: "To do · tomorrow" });
    l = await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-20", tz: IST });
    expect([...l.events, ...l.tasks, ...l.open]).toEqual([]);
    expect(r.reads).toEqual([]);
  });

  it("setup: You first as the blip, then their X0 people by name with their own looks, no numbers; nobody with follow-through off", async () => {
    const r = rig(ist(12, 10));
    const s = await r.make.setup(U, IST);
    expect(s).toMatchObject({ today: "2026-11-12", tomorrow: "2026-11-13", follow: true, ai: "on" });
    expect(s.people.map((p) => [p.id, p.name, p.me])).toEqual([["", "You", true], [DAD, "Dad", false], [RIYA, "Riya", false], [MOM, "Sunita Sharma", false]]);
    expect(s.people[0]!.look.avatar).toBe("blip");
    expect(JSON.stringify(s)).not.toContain("number");
    vi.stubEnv("PLAN_V2_FOLLOW", "false"); resetConfigForTests();
    expect((await r.make.setup(U, IST))).toMatchObject({ people: [], follow: false });
  });
});

describe("fixes after review", () => {
  it("a retry of a Done that worked, after its time passed the 2-minute mark, answers the same rows instead of That time has passed", async () => {
    const r = rig(ist(12, 16, 56));
    const c = await r.make.check(U, { list: [], d: card({ title: "Dentist", time: "other", timeWords: "5 pm" }), at: "0", tz: IST, day0: "2026-11-12" });
    expect(c.view.stop).toBe(false);
    const one = await r.make.done(U, { key: c.key, list: c.drafts, tz: IST });
    // The answer was lost; the person taps Done again at 4:59, with the same key.
    r.clock.t = ist(12, 16, 59);
    const two = await r.make.done(U, { key: c.key, list: c.drafts, tz: IST });
    expect(two).toEqual(one);
    expect((await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-13", tz: IST })).events.map((e) => e.title)).toEqual(["Dentist"]);
    // A new key for the same card is checked again, and refused.
    await expect(r.make.done(U, { key: KEY(), list: c.drafts, tz: IST })).rejects.toMatchObject({ code: "fix_first", message: "That time has passed." });
  });

  it("a row another request made (the unique key) is used but never taken out by this one's failure", async () => {
    const r = rig(ist(12, 10));
    const real = r.calendar.addEvent.bind(r.calendar);
    let calls = 0;
    r.calendar.addEvent = (async (...a: Parameters<typeof real>) => {
      calls += 1;
      // Row 0: the other request (another server) inserts it first, so this insert hits the unique (user_id, source_key).
      if (calls === 1) { await real(...a); throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }); }
      throw new Error("db down");
    }) as typeof real;
    const key = KEY();
    await expect(r.make.done(U, { key, list: [card({ title: "Gym", time: "18:00" }), card({ title: "Swim", day: "2026-11-14", time: "07:00" })], tz: IST })).rejects.toThrow("db down");
    // The other request's row stays: it may already have answered "Added: Gym".
    expect((await r.calendar.keyed(U, key, 2)).map((x) => x.title)).toEqual(["Gym"]);
  });

  it("a daily pickup for Dad made after today's reminder minute says it is reminded tomorrow, and it is", async () => {
    const r = rig(ist(12, 16, 50));
    const c = await r.make.check(U, { list: [], d: card({ title: "Pick up Kabir", time: "other", timeWords: "5 pm", repeat: "daily", who: DAD }), at: "0", tz: IST, day0: "2026-11-12" });
    expect(c.view.items[0]).toMatchObject({ when: "Every day · 5 pm", whoLine: "For Dad · reminded tomorrow at 4:45 pm" });
    const made = await r.make.done(U, { key: c.key, list: c.drafts, tz: IST });
    expect(made.line).toBe("Added: Pick up Kabir, every day, 5\u00a0pm · X0 reminds Dad tomorrow at 4:45\u00a0pm");
    // Not shortened: every day's reminder stays 15 minutes before.
    expect((await r.calendar.list(U, { from: "2026-11-12", to: "2026-11-12", tz: IST })).events[0]!.remindMin).not.toBe(9);
    for (const t of [ist(12, 16, 51), ist(12, 17), ist(12, 17, 30)]) { r.clock.t = t; await r.remind(); }
    expect(await r.stores.follows.select({})).toHaveLength(0);
    r.clock.t = ist(13, 16, 45);
    await r.remind();
    expect(await r.stores.follows.select({})).toHaveLength(1);
    // Made before 4:45, it is reminded today, as before.
    const early = rig(ist(12, 16, 30));
    const e = await early.make.check(U, { list: [], d: card({ title: "Pick up Kabir", time: "other", timeWords: "5 pm", repeat: "daily", who: DAD }), at: "0", tz: IST, day0: "2026-11-12" });
    expect(e.view.items[0]!.whoLine).toBe("For Dad · reminded at 4:45 pm");
  });

  it("a polite ask with nothing to plan in it goes to the chat, as the box answered it, never a draft with no name", async () => {
    const r = rig(ist(12, 10), { consent: false });
    for (const words of ["please add tomorrow 5 pm", "Can you remind me tomorrow at 5?"]) {
      expect(await r.make.draft(U, { words, tz: IST, d: card(), list: [], at: "0" })).toEqual({ kind: "box", box: { slot: "chat", kind: "chat", line: "" } });
    }
    expect(r.reads).toEqual([]);
  });

  it("the draft read's budget day is the person's own: a screen flipping its offset never makes a new day of the same one", async () => {
    // 4 pm in India: 13 Nov at UTC+14, 11 Nov at UTC-12.
    const r = rig(ist(12, 16));
    await r.prefs.patch(U, { capture_day: "2026-11-12", capture_paise: 500 - DRAFT_FLOOR + 50 } as never);
    for (const tz of [840, -720, 840, -720]) {
      const d = drafted(await r.make.draft(U, { words: "meet Rahul around 7ish after his class", tz }));
      expect(d.how).toBe("rules");
      expect(r.logs.at(-1)!.o).toMatchObject({ ai: "spent" });
    }
    expect(r.reads).toEqual([]);
    expect(await r.prefs.get(U)).toMatchObject({ capture_day: "2026-11-12", capture_paise: 500 - DRAFT_FLOOR + 50 });
    // Two reads with the two far offsets, with money left, count on the one day.
    const s = rig(ist(12, 16), { answer: { items: [{ title: "Meet Rahul", time: "19:00", time_said: false }], change: false } });
    await s.make.draft(U, { words: "meet Rahul around 7ish after his class", tz: -720 });
    await s.make.draft(U, { words: "call Riya around 8ish about the trip", tz: 840 });
    expect(s.reads).toHaveLength(2);
    expect(await s.prefs.get(U)).toMatchObject({ capture_day: "2026-11-12", capture_paise: 10 });
  });

  it("the rules' doubt is said by its reason: who it is for, the day and the time, or check it", async () => {
    const r = rig(ist(12, 10), { consent: false });
    expect(drafted(await r.make.draft(U, { words: "remind Nani to take her tablets at 8 every morning", tz: IST })).view.unsure).toBe("X0 filled in what it could. Check who it's for.");
    expect(drafted(await r.make.draft(U, { words: "meet Rahul around 7ish after his class", tz: IST })).view.unsure).toBe("X0 filled in what it could. Check the day and the time.");
    expect(drafted(await r.make.draft(U, { words: "remind Rahul to buy rice in 2 hours", tz: IST })).view.unsure).toBe("X0 filled in what it could. Check it before Done.");
  });

  it("For who: each person is the tiny bot their space shows; anyone else gets a look no one else in the list has", async () => {
    const r = rig(ist(12, 10));
    const { lookOf, looksIn } = await import("../src/botsBots/personLook.js");
    const spaceDad = { seed: DAD, avatar: lookOf(MOM).avatar, color: lookOf(MOM).color };
    const make = new PlanMake({
      ease: () => r.ease, calendar: () => r.calendar, people: () => r.follows.people, capture: () => r.capture, now: () => r.clock.t,
      looks: async () => new Map([[DAD, spaceDad]]),
    });
    const s = await make.setup(U, IST);
    const look = (id: string) => s.people.find((p) => p.id === id)!.look;
    expect(look(DAD)).toEqual(spaceDad);
    // Mom and Riya have no space look here: theirs are told apart (looksIn), never the same tiny bot twice.
    expect(look(MOM)).toEqual(looksIn([RIYA, MOM]).get(MOM));
    expect(`${look(MOM).avatar}:${look(MOM).color}`).not.toBe(`${look(RIYA).avatar}:${look(RIYA).color}`);
    // A failed read is their own looks, and never fails the page.
    const broken = new PlanMake({ ease: () => r.ease, calendar: () => r.calendar, people: () => r.follows.people, capture: () => r.capture, now: () => r.clock.t, looks: async () => { throw new Error("down"); } });
    expect((await broken.setup(U, IST)).people).toHaveLength(4);
  });
});


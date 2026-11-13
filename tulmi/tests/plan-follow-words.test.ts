/**
 * FOLLOW-THROUGH'S WORDS AND RULES (botsBots/planFollowWords.ts, planReach.ts; docs/plan-ease.md "Follow-through"): everything the ladder
 * decides that needs no database. Importance by plain rules, the ladder's times, Later, who has it next and who is told, what may be said
 * outside the app, every push's words, the asker's lines, the people refs, and the reach: numbers, the call MAC, the day's caps.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

const W = await import("../src/botsBots/planFollowWords.js");
const R = await import("../src/botsBots/planReach.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { FOLLOW_KIND_IDS } = await import("../src/botsBots/planKinds.js");

const MIN = 60_000;
const IST = 330;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) - IST * MIN;
const TODAY = "2026-11-12";
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const M = "bbbbbbbb-0000-4000-8000-000000000002";
const D = "cccccccc-0000-4000-8000-000000000003";
const person = (id: string, name: string) => ({ k: "u" as const, id, name });

describe("importance by plain rules", () => {
  const must = (title: string, o: Partial<Parameters<typeof W.autoMust>[0]> = {}) =>
    W.autoMust({ kind: "todo", title, timed: true, dueDay: TODAY, today: TODAY, ...o });
  it("autoMust: a timed medicine is must (English, Hinglish \"dawai 9 baje\", Hindi दवा); an untimed one is not", () => {
    expect(must("Mom's evening medicine")).toBe("medicine");
    expect(must("Papa ki dawai 9 baje")).toBe("medicine");
    expect(must("दवा लेना")).toBe("medicine");
    expect(must("Mom's medicine", { timed: false })).toBeNull();
  });
  it("autoMust: a timed pickup is must; \"Maths test\" and \"Scan the documents\" are not", () => {
    expect(must("Pick up Kabir from school")).toBe("pickup");
    expect(must("Pick Kabir up")).toBe("pickup");
    expect(must("Maths test")).toBeNull();
    expect(must("Scan the documents")).toBeNull();
  });
  it("autoMust: a bill due today is must, due tomorrow is not; a flight or train event is must; a wait never is", () => {
    expect(must("Electricity", { kind: "due" })).toBe("bill_today");
    expect(must("Electricity", { kind: "due", dueDay: "2026-11-13" })).toBeNull();
    expect(must("Flight to Delhi", { kind: "event" })).toBe("flight");
    expect(must("Rajdhani to Mumbai", { kind: "event" })).toBe("flight");
    expect(must("Mom's medicine", { kind: "wait" })).toBeNull();
    expect(W.looksTravel("Boarding at gate 4")).toBe(true);
  });
  it("effectiveMust: the person's normal turns a rule off, must turns anything on", () => {
    expect(W.effectiveMust("normal", "medicine")).toBe(false);
    expect(W.effectiveMust("must", null)).toBe(true);
    expect(W.effectiveMust(null, "pickup")).toBe(true);
    expect(W.effectiveMust(undefined, null)).toBe(false);
  });
});

describe("the ladder", () => {
  const T = ist(12, 21);
  it("ladderOf: normal is one push; must is push, loud +5, call +10, a real call +15, tell +20; a bill climbs from 6 pm", () => {
    expect(W.ladderOf({ importance: "normal", base: T, climb: T })).toEqual([{ rung: "push", at: T }]);
    expect(W.ladderOf({ importance: "must", base: T, climb: T }).map((s) => [s.rung, (s.at - T) / MIN])).toEqual([
      ["push", 0], ["loud", 5], ["call", 10], ["phone", 15], ["tell", 20],
    ]);
    const ten = ist(12, 10), six = ist(12, 18);
    expect(W.ladderOf({ importance: "must", base: ten, climb: six }).map((s) => [s.rung, s.at])).toEqual([
      ["push", ten], ["loud", six], ["call", six + 10 * MIN], ["phone", six + 15 * MIN], ["tell", six + 20 * MIN],
    ]);
    expect(W.dueAgainAt({ due_day: TODAY, tz_min: IST }, ten)).toBe(six);
  });
  it("missAt and laterAt: every choice, after 8 pm a normal Later is 9 am tomorrow, a must Later is 15 minutes", () => {
    expect(W.missAt({ base: T, climb: T })).toBe(T + 360 * MIN);
    const at5 = ist(12, 17);
    expect(W.laterAt("15m", { now: at5, tz: IST, must: false })).toBe(at5 + 15 * MIN);
    expect(W.laterAt("1h", { now: at5, tz: IST, must: false })).toBe(at5 + 60 * MIN);
    expect(W.laterAt("eve", { now: at5, tz: IST, must: false })).toBe(ist(12, 19));
    expect(W.laterAt("eve", { now: ist(12, 18, 45), tz: IST, must: false })).toBe(ist(12, 19, 45));
    expect(W.laterAt("tmrw", { now: at5, tz: IST, must: false })).toBe(ist(13, 9));
    expect(W.laterAt("default", { now: at5, tz: IST, must: false })).toBe(at5 + 60 * MIN);
    expect(W.laterAt("default", { now: ist(12, 20, 30), tz: IST, must: false })).toBe(ist(13, 9));
    expect(W.laterAt("default", { now: ist(12, 20, 30), tz: IST, must: true })).toBe(ist(12, 20, 45));
  });
  it("laterChoices: no \"This evening\" after 6:30 pm", () => {
    expect(W.laterChoices(ist(12, 17), IST).map((c) => c.choice)).toEqual(["15m", "1h", "eve", "tmrw"]);
    expect(W.laterChoices(ist(12, 18, 31), IST).map((c) => c.choice)).toEqual(["15m", "1h", "tmrw"]);
  });
  it("nextHolder and tellTarget: order, can't skipped, the asker told first, the next one told when the asker holds it, nobody left", () => {
    const people = [person(M, "Mom"), person(D, "Dad")];
    expect(W.nextHolder(people, 0, [])).toBe(1);
    expect(W.nextHolder(people, 0, [`u:${D}`])).toBeNull();
    expect(W.tellTarget({ user_id: U, people, holder: 0, cant: [] })).toEqual({ k: "u", id: U, name: "" });
    const own = [person(U, ""), person(M, "Mom")];
    expect(W.tellTarget({ user_id: U, people: own, holder: 0, cant: [] })?.id).toBe(M);
    expect(W.tellTarget({ user_id: U, people: own, holder: 0, cant: [`u:${M}`] })).toBeNull();
    // Someone not in the asker's X0 people now is never told.
    expect(W.tellTarget({ user_id: U, people: own, holder: 0, cant: [] }, [`u:${M}`])).toBeNull();
  });
});

describe("what may be said outside the app", () => {
  it("forOthers: a health title is empty, an amount is gone, long titles are cut; meds, syrup, goli, गोली, inhaler, eye drops are empty too, and followTitle makes them \"Reminder\" (a doctor's visit stays \"Appointment\")", () => {
    expect(W.forOthers("Dentist appointment")).toBe("");
    expect(W.forOthers("Electricity ₹2,340")).toBe("Electricity");
    expect(W.forOthers("x".repeat(10) + " " + "y".repeat(80)).length).toBeLessThanOrEqual(60);
    for (const t of ["Mom's meds", "Crocin syrup", "BP goli", "गोली", "Inhaler before bed", "Eye drops"]) {
      expect(W.forOthers(t)).toBe("");
      expect(W.followTitle(t)).toBe("Reminder");
    }
    expect(W.followTitle("Dentist appointment")).toBe("Appointment");
    expect(W.looksMed("Pick up Kabir")).toBe(false);
  });
  it("followPushWords: every kind has no amount, no place, and no health title in a push to someone else", () => {
    for (const kind of FOLLOW_KIND_IDS) {
      const w = W.followPushWords(kind, { title: "Mom's meds ₹450 at Apollo", when: "9 pm", must: true, asker: "Rahul Sharma", holder: "Mom", from: "Mom", to: "Dad", who: "Mom" });
      const all = `${w.title} ${w.body}`;
      expect(all).not.toMatch(/₹|450|Apollo|meds/i);
    }
    expect(W.followPushWords("space_follow", { title: "Pick up Kabir", when: "8 pm", must: true, asker: "Priya Rao", holder: "" })).toEqual({ title: "Pick up Kabir", body: "From Priya · 8 pm" });
    expect(W.followPushWords("space_follow", { title: "Mom's meds", when: "9 pm", must: true, asker: "Rahul", holder: "" })).toEqual({ title: "A reminder from Rahul", body: "9 pm" });
    expect(W.followPushWords("plan_follow_tell", { title: "Mom's meds", when: "9 pm", must: true, asker: "", holder: "Mom", unreached: true }).title).toBe("X0 couldn't reach Mom");
    expect(W.followPushWords("plan_follow", { title: "Gas booking", when: "9 pm", must: true, asker: "", holder: "", gone: "Dad Sharma" }).body).toBe("Dad isn't in your X0 people · 9 pm");
    expect(W.followPushWords("plan_follow_passed", { title: "Gas booking", when: "9 pm", must: true, asker: "", holder: "", gone: "Dad", to: "Mom" })).toEqual({ title: "Dad isn't in your X0 people", body: "Mom has it now" });
  });
  it("whenWords, stepLine, followLine, howWords", () => {
    expect(W.whenWords({ dueMs: ist(12, 21), day: TODAY, tz: IST, now: ist(12, 9) })).toBe("9 pm");
    expect(W.whenWords({ dueMs: ist(13, 21), day: "2026-11-13", tz: IST, now: ist(12, 9) })).toBe("Fri 9 pm");
    expect(W.whenWords({ dueMs: null, day: TODAY, tz: IST, now: ist(12, 9) })).toBe("today");
    expect(W.stepLine({ at: ist(12, 21), rung: "push", channel: "push", state: "opened", seen: ist(12, 21, 2), who: "Mom", tz: IST })).toBe("9 pm · Mom · Notification · opened 9:02 pm");
    expect(W.stepLine({ at: ist(12, 21, 10), rung: "call", channel: "ring", state: "skipped", seen: null, who: "Mom", tz: IST, why: "no_optin" })).toBe("9:10 pm · Mom · X0 call · not allowed yet");
    expect(W.stepLine({ at: ist(12, 21), rung: "push", channel: "push", state: "skipped", seen: null, who: "Dad", tz: IST, why: "gone" })).toBe("9 pm · Dad · Notification · skipped: not in your X0 people now");
    expect(W.followLine({ state: "open", holder: "Mom", holderIsAsker: false, must: true, doneBy: null })).toBe("Mom · not done yet");
    expect(W.followLine({ state: "done", holder: "Mom", holderIsAsker: false, must: true, doneBy: "Mom" })).toBe("Mom said done");
    expect(W.howWords("gone")).toBe("Not in your X0 people now");
  });
  it("cleanPeople: malformed refs, duplicates, someone without X0 (an earlier draft's \"c\") and a sixth person are dropped", () => {
    const ids = Array.from({ length: 7 }, (_, i) => `dddddddd-0000-4000-8000-00000000000${i}`);
    expect(W.cleanPeople([{ k: "u", id: M }, { k: "u", id: M }, { k: "c", id: D }, { k: "u", id: "nope" }, null, "x"])).toEqual([{ k: "u", id: M }]);
    expect(W.cleanPeople(ids.map((id) => ({ k: "u", id, s: "zzz" })))).toHaveLength(5);
    expect(W.cleanPeople("nope")).toEqual([]);
  });
});

describe("the reach: numbers, the call's MAC, the day's caps", () => {
  const key = randomBytes(32);
  it("planReach: e164Of reads Indian numbers; seal and open round-trip; numberHash is stable and keyed; replyMac binds follow, n and person", () => {
    expect(R.e164Of("98765 43210")).toBe("+919876543210");
    expect(R.e164Of("09876543210")).toBe("+919876543210");
    expect(R.e164Of("+44 20 7946 0958")).toBe("+442079460958");
    expect(R.e164Of("12345")).toBeNull();
    const seal = R.sealNumber("+919876543210", key);
    expect(seal).not.toContain("9876543210");
    expect(R.openNumber(seal, key)).toBe("+919876543210");
    expect(R.openNumber(seal, randomBytes(32))).toBeNull();
    expect(R.numberHash("+919876543210", key)).toBe(R.numberHash("+919876543210", key));
    expect(R.numberHash("+919876543210", key)).not.toBe(R.numberHash("+919876543210", randomBytes(32)));
    const mac = R.replyMac("f1", 2, `u:${M}`, key);
    expect(R.macOk("f1", 2, `u:${M}`, mac, key)).toBe(true);
    expect(R.macOk("f1", 3, `u:${M}`, mac, key)).toBe(false);
    expect(R.macOk("f1", 2, `u:${D}`, mac, key)).toBe(false);
  });
  it("planReach: capTake stops at the max, two at once never both pass the last one, and a lost swap tries again; capGive never goes below 0; capTakeAll takes all or none", async () => {
    const { caps } = memoryFollowStores();
    expect(await R.capTake(caps, "u:x", TODAY, 2)).toBe(true);
    const both = await Promise.all([R.capTake(caps, "u:x", TODAY, 2), R.capTake(caps, "u:x", TODAY, 2)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await R.capTake(caps, "u:x", TODAY, 2)).toBe(false);
    await R.capGive(caps, "u:x", TODAY);
    expect(await R.capTake(caps, "u:x", TODAY, 2)).toBe(true);
    for (let i = 0; i < 5; i += 1) await R.capGive(caps, "u:y", TODAY);
    expect((await caps.select({ person: "u:y" })).length).toBe(0);
    // A lost swap (someone else counted in between) reads again and tries again.
    let raced = false;
    const update = caps.update.bind(caps);
    caps.update = async (m, p) => { if (!raced) { raced = true; await update({ person: "u:z", day: TODAY }, { n: 1 }); return 0; } return update(m, p); };
    await caps.insert({ person: "u:z", day: TODAY, n: 0 });
    expect(await R.capTake(caps, "u:z", TODAY, 3)).toBe(true);
    expect((await caps.select({ person: "u:z" }))[0]!.n).toBe(2);
    caps.update = update;
    // All or none: the second is full, so the first is given back.
    expect(await R.capTake(caps, "p:full", TODAY, 1)).toBe(true);
    expect(await R.capTakeAll(caps, [{ person: "u:a", day: TODAY, max: 5 }, { person: "p:full", day: TODAY, max: 1 }])).toBe(false);
    expect((await caps.select({ person: "u:a" }))[0]?.n ?? 0).toBe(0);
    // Louder pings and real calls count on their own keys, so one never uses up the other.
    expect(await R.capTakeAll(caps, [{ person: "u:b", day: TODAY, max: 1 }, { person: "p:b", day: TODAY, max: 1 }])).toBe(true);
  });
});

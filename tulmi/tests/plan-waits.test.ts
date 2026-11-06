/**
 * PLAN EASE, STEP 4: WAITING ON SOMEONE (docs/plan-ease-people.md; src/botsBots/planWaits.ts, planWaitWords.ts):
 *
 *   - the words: who owes what by when, a visit ("Plumber said Tuesday"), a number or an email only from the words, never a guess
 *   - the box adds it with when it'll ask and Undo; the list draws it "Waiting on Rahul · by Thu" with Sorted as its tick
 *   - the check-back: 6 pm on the day (a visit 4 pm), one push, the card with the follow-up written; Send opens WhatsApp and asks again
 *     2 days on; left alone it asks the next evening, three times at most; Sorted closes it, Undo opens it again
 *   - a meeting's to-do that is someone else's (a real name, never "Speaker 2") becomes a wait, once
 *   - outside the app: no health words, no amounts; Send needs the app (it opens WhatsApp), Sorted answers in place
 *   - the push kinds of steps 4 and 5 go through "What pings you" as they should; the switch off is a plain to-do
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanWaits, setPlanWaits, plugWaits, checkBackWords } = await import("../src/botsBots/planWaits.js");
const { readWait, checkAt, draftOf, handoffOf, noteWho, waitFromTodo } = await import("../src/botsBots/planWaitWords.js");
const { removePlanSource } = await import("../src/botsBots/planSources.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { pushItemOf } = await import("../src/widgets/items.js");
const { PLAN_PUSH_KINDS, PLAN_CATEGORIES, PLAN_CHANNELS } = await import("../src/botsBots/planKinds.js");
const { verdict } = await import("../src/you/push.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { resetConfigForTests } = await import("../src/config.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { sampleApi } = await import("./bots-bots-data.js");

const MIN = 60_000;
const IST = 330;
/** November 2026, India's wall clock, as UTC ms: Tue 10, Thu 12, Sat 14. */
const ist = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const AREA = "/v1/botsapp/bots";

type Sent = { userId: string; kind: string; key: string; vars: Record<string, string>; data?: Record<string, string>; category?: string };

function rig(t0: number) {
  const clock = { t: t0 };
  const rows = memoryCalendarRows();
  const c = new Calendar({ rows, now: () => clock.t, publish: () => undefined });
  const prefs = memoryPlanPrefs(() => clock.t);
  const sent: Sent[] = [];
  const ease = new PlanEase({ calendar: c, prefs, skips: new MemoryTable(), now: () => clock.t, send: async (userId, m) => { sent.push({ userId, ...m }); } });
  ease.attach();
  const waits = new PlanWaits({
    tasks: rows.tasks, now: () => clock.t, publish: () => undefined, send: async (userId, m) => { sent.push({ userId, ...m }); },
    spend: (userId, day) => ease.policy.spend(userId, day),
  });
  setPlanWaits(waits);
  plugWaits();
  const door = new QuickActs(
    { spaceTasks: null, threads: null, approvals: null, jobs: null, plan: { scope: (i, a) => ease.scope(i, a), act: (u, i, a) => ease.act(u, i, a) } },
    new MemoryQuickActionStore(), () => clock.t,
  );
  const session = { kind: "session" } as const;
  const policy = { inPlaceRisks: ["read"], modes: {}, tokenEnabled: true };
  const act = (item: string, action: string, via: { kind: "session" } | { kind: "widget"; scopes: Array<"task.done" | "needs.answer"> } = session, key?: string) =>
    door.run(U, { item, action, ...(key ? { key } : {}) }, via, policy);
  return { clock, c, ease, waits, sent, act, prefs };
}

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanWaits(null); removePlanSource("wait"); });

// ===================================================================== the words

describe("waiting on: the words", () => {
  const tue = ist(10, 10);

  it("read who owes what by when, and the evening to check back", () => {
    const r = readWait("Rahul will send the numbers by Thursday", tue, IST)!;
    expect(r).toMatchObject({ who: "Rahul", thing: "the numbers", verb: "send", title: "The numbers", came: false, day: "2026-11-12", reach: null });
    expect(checkAt(r, tue, IST)).toBe(ist(12, 18));
    expect(draftOf(r)).toBe("Hi Rahul, just checking on the numbers. Could you send them today?");
    expect(draftOf(r, true)).toBe("Hi Rahul, numbers ka kya hua? Aaj ho jayega?");

    const week = readWait("Waiting on Rahul for the deck this week", tue, IST)!;
    expect(week).toMatchObject({ who: "Rahul", thing: "the deck", week: true });
    expect(checkAt(week, tue, IST)).toBe(ist(13, 18));

    const call = readWait("Priya promised to call back", tue, IST)!;
    expect(call).toMatchObject({ who: "Priya", verb: "call back", thing: "", title: "Call back", day: null });
    expect(checkAt(call, tue, IST)).toBe(ist(13, 18));
    expect(draftOf(call)).toBe("Hi Priya, just checking in. Could you call me today?");

    expect(readWait("waiting for Rahul's reply", tue, IST)).toMatchObject({ who: "Rahul", verb: "reply", title: "Reply" });
    expect(readWait("rahul said he'd share the deck tomorrow", tue, IST)).toMatchObject({ who: "Rahul", verb: "share", thing: "the deck", day: "2026-11-11" });
    expect(readWait("Rahul sends numbers by Thursday", tue, IST)).toMatchObject({ who: "Rahul", thing: "numbers", day: "2026-11-12" });
    // A time said: an hour after it.
    expect(checkAt(readWait("Rahul will send the numbers by 3 pm Thursday", tue, IST)!, tue, IST)).toBe(ist(12, 16));
  });

  it("read a visit or a delivery: it asks whether they came, in the afternoon", () => {
    const mon = ist(9, 10);
    const v = readWait("Plumber said Tuesday", mon, IST)!;
    expect(v).toMatchObject({ who: "the plumber", title: "Plumber visit", came: true, day: "2026-11-10" });
    expect(checkAt(v, mon, IST)).toBe(ist(10, 16));
    expect(draftOf(v)).toBe("Hi, are you coming today?");
    expect(draftOf(v, true)).toBe("Hi, aaj aa rahe ho?");
    expect(readWait("The courier is coming tomorrow at 11 am", mon, IST)).toMatchObject({ who: "the courier", title: "Courier", came: true, time: 11 * 60 });
  });

  it("keep a number or an email only when it was in the words, and send there", () => {
    const tueNow = ist(10, 10);
    const r = readWait("Rahul 98450 12345 will send the numbers tomorrow", tueNow, IST)!;
    expect(r).toMatchObject({ who: "Rahul", reach: "919845012345" });
    expect(handoffOf(draftOf(r), r.reach)).toMatch(/^https:\/\/wa\.me\/919845012345\?text=Hi%20Rahul%2C%20just%20checking/);
    const e = readWait("Rahul (rahul@acme.in) will send the deck by Friday", tueNow, IST)!;
    expect(e.reach).toBe("rahul@acme.in");
    expect(handoffOf(draftOf(e), e.reach)).toMatch(/^mailto:rahul@acme\.in\?body=Hi%20Rahul/);
    // No number: WhatsApp's own chat picker.
    expect(handoffOf("Hi Rahul", null)).toBe("https://wa.me/?text=Hi%20Rahul");
  });

  it("leave everything else to the other slots", () => {
    for (const w of ["Dentist Fri 5 pm", "Who picks Kabir up Wednesday?", "I will send the report tomorrow", "The meeting will start at 5 pm",
      "Order the cake by Friday", "Plumber", "Mom will pick Kabir up at 1 pm", "Pay rent by the 5th", "Is Rahul sending the numbers?"]) {
      expect(readWait(w, ist(10, 10), IST), w).toBeNull();
    }
  });

  it("know a meeting's real names from its speakers, and never chase \"Speaker 2\", \"You\" or \"Others\"", () => {
    const people = [{ label: "Speaker 2", name: "Rahul" }, { label: "Speaker 3" }];
    expect(noteWho("Speaker 2", people)).toBe("Rahul");
    expect(noteWho("Speaker 3", people)).toBeNull();
    expect(noteWho("You", people)).toBeNull();
    expect(noteWho("Others", people)).toBeNull();
    expect(waitFromTodo({ text: "Send the numbers", who: "Speaker 2", when: "by Thursday" }, people, ist(10, 10), IST))
      .toMatchObject({ who: "Rahul", thing: "the numbers", title: "The numbers", day: "2026-11-12" });
    expect(waitFromTodo({ text: "Rahul to share the deck", who: "Rahul", when: "Friday" }, [], ist(10, 10), IST)).toMatchObject({ who: "Rahul", thing: "the deck", day: "2026-11-13" });
  });
});

// ===================================================================== the box, the page and the check-back

describe("waiting on: the box, the page and the check-back", () => {
  it("adds a wait from the box with when it'll ask and Undo, on the list as a wait whose tick is Sorted", async () => {
    const r = rig(ist(10, 10));
    const reply = await r.ease.box(U, "Rahul will send the numbers by Thursday", IST);
    expect(reply).toMatchObject({ slot: "wait", kind: "added", line: "I'll check with you Thursday evening", undo: { action: "undo" } });
    const thu = (await r.ease.week(U, IST)).days.find((d) => d.key === "2026-11-12")!;
    expect(thu.rows).toEqual([expect.objectContaining({ kind: "wait", title: "The numbers", line: "Waiting on Rahul · by Thu", tick: expect.objectContaining({ action: "sorted" }) })]);
    // Nothing to ask yet.
    expect((await r.ease.read(U, IST)).needs).toBeNull();
    expect((await r.act(reply.undo!.item, "undo")).status).toBe(200);
    expect(await r.waits.open(U)).toEqual([]);
  });

  it("checks back at 6 pm on the day, once, with the follow-up written; Send opens WhatsApp and asks again 2 days on", async () => {
    const r = rig(ist(10, 10));
    await r.ease.box(U, "Rahul will send the numbers by Thursday", IST);
    const [w] = await r.waits.open(U);
    r.clock.t = ist(12, 18, 1);
    expect(await r.waits.tick()).toBe(1);
    expect(await r.waits.tick()).toBe(0);
    expect(r.sent).toEqual([expect.objectContaining({
      kind: "plan_wait", vars: { title: "Still waiting on Rahul", body: "The numbers were due Thursday." }, data: { item: `pt:${w!.id}`, day: "2026-11-12", go: "send" },
    })]);
    const page = await r.ease.read(U, IST);
    expect(page.needs).toMatchObject({
      type: "wait", question: "Still waiting on Rahul. Send this?", reason: "", message: "Hi Rahul, just checking on the numbers. Could you send them today?", item: `pt:${w!.id}`,
    });
    expect(page.needs!.buttons).toEqual([
      expect.objectContaining({ id: "send", label: "Send", primary: true, open: { screen: "bots.plan.send", params: { item: `pt:${w!.id}`, go: "send", from: "page" } } }),
      expect.objectContaining({ id: "sorted", label: "Sorted", undo: "unsort" }),
    ]);
    // The widget can't send it (Send opens WhatsApp), so it doesn't ask it half: "Still waiting on Rahul", open-only, a tap opens the app.
    const widget = (await r.ease.line(U, IST)).needs;
    expect(widget).toMatchObject({ question: "Still waiting on Rahul", buttons: [], openOnly: true });
    // Today, inside the app, has the whole card: the draft and Send.
    expect((await r.ease.line(U, IST)).card).toMatchObject({ question: "Still waiting on Rahul. Send this?", message: expect.any(String) });
    // No buttons in the evening note: Send can't open WhatsApp from there.
    expect(page.needs!.category).toBeUndefined();

    expect((await r.act(`pt:${w!.id}`, "send", { kind: "widget", scopes: ["task.done", "needs.answer"] })).status).toBe(403);
    const sent = await r.act(`pt:${w!.id}`, "send");
    expect(sent.body).toMatchObject({ ok: true, state: "sent", url: expect.stringMatching(/^https:\/\/wa\.me\/\?text=Hi%20Rahul/) });
    expect((await r.ease.read(U, IST)).needs).toBeNull();
    r.clock.t = ist(13, 18, 1);
    expect(await r.waits.tick()).toBe(0);
    r.clock.t = ist(14, 18, 1);
    expect(await r.waits.tick()).toBe(1);
  });

  it("left alone, asks the next evening, three times at most, then stays quietly on the list", async () => {
    const r = rig(ist(10, 10));
    await r.ease.box(U, "Rahul will send the numbers by Thursday", IST);
    for (const day of [12, 13, 14]) { r.clock.t = ist(day, 18, 1); expect(await r.waits.tick(), String(day)).toBe(1); }
    r.clock.t = ist(15, 18, 1);
    expect(await r.waits.tick()).toBe(0);
    expect(r.sent.filter((s) => s.kind === "plan_wait")).toHaveLength(3);
    expect(await r.waits.open(U)).toHaveLength(1);
  });

  it("closes with Sorted from a notification, and the page's Undo opens it again", async () => {
    const r = rig(ist(10, 10));
    await r.ease.box(U, "Rahul will send the numbers by Thursday", IST);
    const [w] = await r.waits.open(U);
    r.clock.t = ist(12, 18, 1);
    await r.waits.tick();
    expect((await r.act(`pt:${w!.id}`, "sorted", { kind: "widget", scopes: ["task.done"] })).body).toMatchObject({ ok: true, state: "sorted" });
    expect(await r.waits.open(U)).toEqual([]);
    expect((await r.ease.read(U, IST)).needs).toBeNull();
    expect((await r.act(`pt:${w!.id}`, "unsort", { kind: "session" }, "k-unsort-0001")).status).toBe(200);
    expect(await r.waits.open(U)).toHaveLength(1);
  });

  it("moves the check-back with the day when a wait's day is changed in its details", async () => {
    const r = rig(ist(10, 10));
    await r.ease.box(U, "Rahul will send the numbers by Thursday", IST);
    const [w] = await r.waits.open(U);
    expect(w!.check).toBe(ist(12, 18));
    await r.c.changeTask(U, w!.id, { day: "2026-11-17", tz: IST });
    const [moved] = await r.waits.open(U);
    expect(moved).toMatchObject({ day: "2026-11-17", check: ist(17, 18) });
    // Nothing on the old day.
    r.clock.t = ist(12, 18, 1);
    expect(await r.waits.tick()).toBe(0);
  });

  it("asks whether a visit came; No opens WhatsApp asking if they're coming, Yes closes it", async () => {
    const r = rig(ist(9, 10));
    expect(await r.ease.box(U, "Plumber said Tuesday", IST)).toMatchObject({ slot: "wait", line: "I'll ask you tomorrow at 4 pm" });
    const [w] = await r.waits.open(U);
    r.clock.t = ist(10, 16, 1);
    expect(await r.waits.tick()).toBe(1);
    expect(r.sent.at(-1)).toMatchObject({ kind: "plan_came", vars: { title: "Did the plumber come?", body: "They said Tuesday." }, data: { item: `pt:${w!.id}` } });
    const card = (await r.ease.read(U, IST)).needs!;
    expect(card).toMatchObject({ type: "came", question: "Did the plumber come?", reason: "They said Tuesday." });
    expect(card.buttons.map((b) => [b.id, b.label])).toEqual([["came", "Yes"], ["notcame", "No"]]);
    expect((await r.act(`pt:${w!.id}`, "notcame")).body).toMatchObject({ url: "https://wa.me/?text=Hi%2C%20are%20you%20coming%20today%3F" });
    expect((await r.ease.read(U, IST)).needs).toBeNull();
    r.clock.t = ist(11, 16, 1);
    expect(await r.waits.tick()).toBe(1);
    expect((await r.act(`pt:${w!.id}`, "came", { kind: "widget", scopes: ["needs.answer"] })).body).toMatchObject({ state: "sorted" });
    expect(await r.waits.open(U)).toEqual([]);
  });

  it("never puts a health word or an amount outside the app", async () => {
    const r = rig(ist(10, 10));
    await r.ease.box(U, "Dr. Mehta will send the blood test report by Friday", IST);
    const [w] = await r.waits.open(U);
    expect(checkBackWords(w!, ist(13, 18))).toEqual({ title: "Still waiting on a reply", body: "They said Friday." });
    r.clock.t = ist(13, 18, 1);
    await r.waits.tick();
    expect((await r.ease.read(U, IST)).needs?.question).toBe("Still waiting on a reply. Send this?");
    const paid = readWait("Rahul will pay back ₹2,000 by Friday", ist(10, 10), IST)!;
    const words = checkBackWords({ ...w!, title: paid.title, who: paid.who }, ist(13, 18));
    expect(`${words.title} ${words.body}`).not.toMatch(/₹|2,000/);
  });

  it("lands a meeting's to-do that is someone else's as a wait, once, and leaves the person's own alone", async () => {
    const r = rig(ist(10, 10));
    const people = [{ label: "Speaker 2", name: "Rahul" }];
    const note = { noteId: "bbbbbbbb-0000-4000-8000-000000000001", noteTitle: "Weekly sync", tz: IST, people };
    const w = await r.waits.fromNote(U, { ...note, todoId: "t1", text: "Send the numbers", who: "Speaker 2", when: "Thursday" });
    expect(w).toMatchObject({ who: "Rahul", title: "The numbers", day: "2026-11-12" });
    expect((await r.waits.fromNote(U, { ...note, todoId: "t1", text: "Send the numbers", who: "Speaker 2", when: "Thursday" }))!.id).toBe(w!.id);
    expect(await r.waits.fromNote(U, { ...note, todoId: "t2", text: "Book the room", who: "You" })).toBeNull();
    // On the calendar as the meeting's: "Add to my tasks" knows it is there.
    expect(await r.c.fromNote(U, note.noteId)).toEqual({ t1: { id: w!.id, done: false } });
  });

  it("counts toward Plan Ease's six a day: past them the card still waits in the app", async () => {
    const r = rig(ist(10, 10));
    await r.ease.box(U, "Rahul will send the numbers by Thursday", IST);
    await r.prefs.patch(U, { sent: { day: "2026-11-12", n: 6 } });
    r.clock.t = ist(12, 18, 1);
    expect(await r.waits.tick()).toBe(0);
    expect(r.sent).toEqual([]);
    expect((await r.ease.read(U, IST)).needs?.type).toBe("wait");
  });

  it("is a plain to-do with the switch off, and nothing checks back", async () => {
    vi.stubEnv("PLAN_V2_WAITS", "false"); resetConfigForTests();
    const r = rig(ist(10, 10));
    expect(await r.ease.box(U, "Rahul will send the numbers by Thursday", IST)).toMatchObject({ slot: "item", kind: "added" });
    r.clock.t = ist(12, 18, 1);
    expect(await r.waits.tick()).toBe(0);
  });
});

// ===================================================================== on the screen

describe("waiting on: on the screen", () => {
  const NEW = ["BotsKit", "BotsMotion", "KitExtras", "PersonBot", "FontBricolage", "FileUpload"];
  async function draw(screenId: string, o: { params?: Record<string, string>; api?: Record<string, unknown>; can?: string[] } = {}) {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const s = await buildBotsScreen(
      { screenId, client: "phone", params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(o.can ?? NEW), desk: { pages: false, notes: false } },
      fakeDeps({ api: { ...(await sampleApi()), ...(o.api ?? {}) }, calls, now: FIXED_NOW }),
    );
    const nodes = walk(s.root!);
    return { s, nodes, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")), calls };
  }
  const flat = (a: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> => {
    if (!a || typeof a !== "object") return out;
    const o = a as Record<string, unknown>;
    out.push(o);
    for (const k of ["actions", "then", "else", "onSuccess", "onError"]) { const v = o[k]; if (Array.isArray(v)) v.forEach((x) => flat(x, out)); else flat(v, out); }
    return out;
  };

  it("draws the card with the draft as a message, and Send opens the hand-off", async () => {
    const r = rig(ist(10, 10));
    await r.ease.box(U, "Rahul will send the numbers by Thursday", IST);
    r.clock.t = ist(12, 18, 1);
    await r.waits.tick();
    const page = await r.ease.read(U, IST);
    const { s, texts, nodes } = await draw("bots.plan", { api: { [`GET ${AREA}/plan/today?tz=${IST}`]: page } });
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts).toEqual(expect.arrayContaining(["Still waiting on Rahul. Send this?", "Hi Rahul, just checking on the numbers. Could you send them today?", "Send", "Sorted"]));
    const acts = nodes.flatMap((n) => Object.values(n.on ?? {}).flatMap((v) => flat(v)));
    expect(acts.find((a) => a.kind === "navigate" && a.screenId === "bots.plan.send")).toMatchObject({ params: { go: "send", from: "page" } });
    // The box's reply can carry one button (a family ask's [Ask]), through the act door, and its words go back in the box on a tap.
    expect(nodes.some((n) => n.type === "Text" && n.bind?.content === "boxed.act.label")).toBe(true);
    expect(acts.find((a) => a.kind === "callEndpoint" && (a.body as { item?: string } | undefined)?.item === "$state.boxed.act.item")).toMatchObject({ path: "/v1/widgets/act", assignTo: "boxed" });
    expect(acts.find((a) => a.kind === "setState" && a.path === "say" && a.value === "$state.boxed.edit")).toBeTruthy();
  });

  it("from a notification, opens WhatsApp only for its Send or No button: a tap just to look opens the Plan and counts as nothing", async () => {
    const url = "https://wa.me/?text=Hi%20Rahul";
    const api = { [`GET ${AREA}/plan/handoff?item=pt%3Aabc&go=send`]: { url } };
    const onAppear = (nodes: Array<{ on?: Record<string, unknown> }>) => nodes.flatMap((n) => (n.on?.onAppear ? flat(n.on.onAppear) : []));
    const tapped = await draw("bots.plan.send", { can: [...NEW, "PushButton"], params: { item: "pt:abc", go: "send", pushId: "p1" }, api });
    expect(onAppear(tapped.nodes).some((a) => a.kind === "openUrl")).toBe(false);
    expect(onAppear(tapped.nodes).some((a) => a.kind === "callEndpoint")).toBe(false);
    expect(onAppear(tapped.nodes).find((a) => a.kind === "navigate")).toMatchObject({ screenId: "bots.plan" });
    const pressed = await draw("bots.plan.send", { can: [...NEW, "PushButton"], params: { item: "pt:abc", go: "send", pushId: "p1", button: "p_send" }, api });
    expect(onAppear(pressed.nodes).find((a) => a.kind === "openUrl")).toMatchObject({ url, handoff: true });
    expect(onAppear(pressed.nodes).find((a) => a.kind === "callEndpoint")).toMatchObject({ body: expect.objectContaining({ action: "send" }) });
    // A build that can't tell a tap from a button: nothing opens by itself, one button does it.
    const old = await draw("bots.plan.send", { params: { item: "pt:abc", go: "send", pushId: "p1" }, api });
    expect(onAppear(old.nodes).some((a) => a.kind === "openUrl")).toBe(false);
    expect(old.texts).toContain("Open WhatsApp");
  });

  it("opens WhatsApp at once from the hand-off, notes the Send, and goes back", async () => {
    const url = "https://wa.me/?text=Hi%20Rahul";
    const { nodes } = await draw("bots.plan.send", { params: { item: "pt:abc", go: "send", from: "page" }, api: { [`GET ${AREA}/plan/handoff?item=pt%3Aabc&go=send`]: { url } } });
    const acts = nodes.flatMap((n) => Object.values(n.on ?? {}).flatMap((v) => flat(v)));
    expect(acts.find((a) => a.kind === "openUrl")).toMatchObject({ url, handoff: true });
    expect(acts.find((a) => a.kind === "callEndpoint")).toMatchObject({ path: "/v1/widgets/act", body: expect.objectContaining({ item: "pt:abc", action: "send" }) });
    expect(acts.some((a) => a.kind === "navigateBack")).toBe(true);
  });
});

// ===================================================================== the push kinds

describe("the push kinds of steps 4 and 5", () => {
  it("go through What pings you: a wait as Plan Ease's own, the family's as a person's word, the quiet ones never with a sound", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    const planOff = { ...s, notify: { ...s.notify, botsOff: ["plan"] } };
    const quiet = { ...s, notify: { ...s.notify, quiet: true, quietFrom: 22 * 60, quietTo: 7 * 60 } };
    const kinds = ["plan_wait", "plan_came", "space_ask", "space_ask_nudge", "space_ask_none", "space_ask_taken", "space_turn"];
    for (const kind of kinds) expect(PLAN_PUSH_KINDS.map((k) => k.kind)).toContain(kind);
    for (const kind of ["plan_wait", "plan_came"]) {
      expect(verdict(planOff, kind, 10 * 60), kind).toBe("drop");
      expect(verdict(s, kind, 10 * 60), kind).toBe("send");
    }
    for (const kind of ["space_ask", "space_ask_none", "space_turn"]) {
      expect(verdict(planOff, kind, 10 * 60), kind).toBe("send");
      expect(verdict(quiet, kind, 23 * 60), kind).toBe("silent");
    }
    for (const kind of ["space_ask_nudge", "space_ask_taken"]) {
      expect(verdict(planOff, kind, 10 * 60), kind).toBe("silent");
      expect(verdict(s, kind, 10 * 60), kind).toBe("silent");
    }
    expect(PLAN_CHANNELS.find((c) => c.id === "family")).toMatchObject({ name: "Family asks", importance: "default" });
    for (const id of ["x0_wait", "x0_came", "x0_claim", "x0_in", "x0_turn"]) expect(PLAN_CATEGORIES.find((c) => c.id === id)?.actions.length).toBeGreaterThan(0);
    // A family push's buttons answer the space task it is about.
    expect(pushItemOf("space_ask", { spaceId: "s1", taskId: "t1" })).toBe("stask:s1:t1");
    expect(pushItemOf("space_turn", { spaceId: "s1", taskId: "t1" })).toBe("stask:s1:t1");
    expect(pushItemOf("plan_wait", { item: "pt:abc" })).toBe("pt:abc");
  });
});

/**
 * FOLLOW-THROUGH'S SCREENS, ROUTES AND SWITCHES (screens/bots/planFollow.ts, routes/bots/planFollows.ts, What pings you, the item page,
 * the call screen, Activity, the bootstrap's buttons, settings; docs/plan-ease.md "Follow-through"). Phone and desktop alike, lint clean.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { withAppKnobs } = await import("../src/experience/appKnobs.js");
const { PLAN_CATEGORIES, FOLLOW_CATEGORIES, CALL_CATEGORIES } = await import("../src/botsBots/planKinds.js");
const { DEFAULT_SETTINGS, cleanSettings, applyPatch, withCleared } = await import("../src/you/settings.js");
const { resetConfigForTests } = await import("../src/config.js");
const { feedOf } = await import("../src/shell/feed.js");
const { parseItem, pushItemOf } = await import("../src/widgets/items.js");
const { logUrl } = await import("../src/observability.js");
const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanFollows, setPlanFollows } = await import("../src/botsBots/planFollow.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { registerPlanFollowRoutes } = await import("../src/routes/bots/planFollows.js");
const { setFollowChannels } = await import("../src/botsBots/planFollowChannels.js");
const { openingLine, cardOf } = await import("../src/botsBots/planCallWords.js");
const { FOLLOW_VIEWS_FOR_TESTS } = await import("./plan-follow-views.js");

type FollowView = import("../src/botsBots/planFollow.js").FollowView;

const IST = 330;
const MIN = 60_000;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const M = "bbbbbbbb-0000-4000-8000-000000000002";
const X = "dddddddd-0000-4000-8000-000000000004";
const FOLLOW = "/v1/botsapp/bots/plan/follow";
const PHONE = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "ActionParams", "AskStream", "BotCall", "PersonBot", "PushButton"];
const DESK = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "DeskShell", "PersonBot"];
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const as = (u: string) => ({ authorization: `Bearer ${u}` });

beforeEach(() => { vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanFollows(null); setFollowChannels(null); });

async function draw(screenId: string, client: "phone" | "desktop", params: Record<string, string>, api: Record<string, unknown>) {
  const s = await buildBotsScreen({
    screenId, client, params, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" }, can: new Set(client === "phone" ? PHONE : DESK),
    desk: { pages: client === "desktop", notes: false },
  }, fakeDeps({ api }));
  const nodes = walk(s.root!);
  return { s, json: JSON.stringify(s), texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) };
}
function actionsIn(x: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(x)) { for (const v of x) actionsIn(v, out); return out; }
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o);
  for (const v of Object.values(o)) actionsIn(v, out);
  return out;
}
const pressed = (node: Node | undefined): unknown => node?.on?.onAppear;

// ===================================================================== the follow page

describe("bots.plan.follow", () => {
  const V = FOLLOW_VIEWS_FOR_TESTS;
  const api = Object.fromEntries(Object.values(V).map((v) => [`GET ${FOLLOW}/${v.id}`, v]));
  it("bots.plan.follow: the asker sees every step; the holder sees who asked and when the asker is told; the next one sees \"You're next on it\" (phone and desktop, lint clean)", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const a = await draw("bots.plan.follow", client, { follow: V.asker.id }, api);
      expect(lintTree(a.s.root!)).toEqual([]);
      expect(a.texts).toEqual(expect.arrayContaining(["Mom's evening medicine", "What X0 did", "9 pm · Mom · Notification · opened 9:02 pm", "Mom hasn't said done."]));
      const h = await draw("bots.plan.follow", client, { follow: V.holder.id }, api);
      expect(lintTree(h.s.root!)).toEqual([]);
      expect(h.texts).toEqual(expect.arrayContaining(["Priya asked X0 to remind you.", "If it isn't done by 8:20 pm, X0 tells Priya."]));
      expect(h.texts).not.toContain("What X0 did");
      const b = await draw("bots.plan.follow", client, { follow: V.backup.id }, api);
      expect(b.texts).toContain("Mom hasn't said done. You're next on it.");
      const none = await draw("bots.plan.follow", client, { follow: "eeeeeeee-0000-4000-8000-000000000009" }, api);
      expect(none.texts).toContain("It isn't there any more");
    }
  });
  it("bots.plan.follow: once done, the page says who said done and nothing older (no \"has it now\", no \"keeps at it\")", async () => {
    const id = "eeeeeeee-0000-4000-8000-0000000000d1";
    for (const asker of [true, false]) {
      const v = {
        ...V.asker, id, state: "done" as const, steps: [], answers: [],
        holder: asker ? V.asker.holder : { ...V.asker.holder, name: "You", me: true },
        done: { by: "Mom", via: "app" as const, at: V.asker.steps[0]?.at ?? 0, line: "Mom said done · 9:12 pm · In X0" },
        buttons: { ...V.asker.buttons, done: false },
      };
      const d = await draw("bots.plan.follow", "phone", { follow: id }, { [`GET ${FOLLOW}/${id}`]: v });
      expect(d.texts).toContain("Mom said done · 9:12 pm · In X0");
      expect(d.texts.some((t: string) => /has it now|keeps at it/.test(t))).toBe(false);
    }
  });
  it("bots.plan.follow: Done, Later and its choices, Can't go through the act door on pf:<id>:<n>; Message opens the chat; Call shows only with a number", async () => {
    const h = await draw("bots.plan.follow", "phone", { follow: V.holder.id }, api);
    const posts = actionsIn(h.s).filter((x) => x.kind === "callEndpoint" && x.path === "/v1/widgets/act").map((x) => (x.body as { item: string; action: string }));
    expect(posts.map((p) => p.action)).toEqual(expect.arrayContaining(["done", "cant", "later_15m", "allow", "deny"]));
    expect(new Set(posts.map((p) => p.item))).toEqual(new Set([`pf:${V.holder.id}:2`]));
    expect(h.texts).toEqual(expect.arrayContaining(["Let Priya's must-not-miss reminders ring louder and call you?", "Allow", "Not now"]));
    const a = await draw("bots.plan.follow", "phone", { follow: V.asker.id }, api);
    expect(a.texts).toEqual(expect.arrayContaining(["Call Mom", "Message Mom", "I'll do it"]));
    expect(actionsIn(a.s)).toEqual(expect.arrayContaining([{ kind: "phone", number: "+919876543210" }, expect.objectContaining({ kind: "navigate", screenId: "bots.person" })]));
    const noNumber = await draw("bots.plan.follow", "phone", { follow: V.backup.id }, api);
    expect(noNumber.texts.some((t) => t.startsWith("Call "))).toBe(false);
  });
  it("bots.plan.follow: the f_call button dials at once (the page underneath); a tap just to look does not", async () => {
    const go = await draw("bots.plan.follow", "phone", { follow: V.asker.id, button: "f_call", pushId: "p1" }, api);
    expect(walk(go.s.root!).some((n) => JSON.stringify(pressed(n) ?? "").includes("\"phone\""))).toBe(true);
    const look = await draw("bots.plan.follow", "phone", { follow: V.asker.id, pushId: "p1" }, api);
    expect(walk(look.s.root!).some((n) => JSON.stringify(pressed(n) ?? "").includes("\"phone\""))).toBe(false);
  });
});

// ===================================================================== who does it

describe("bots.plan.follow.people", () => {
  const T = "5e1f0c2e-1111-4222-8333-944445555777";
  const picker = (o: Record<string, unknown> = {}) => ({
    item: { allowed: true, importance: null, must: true, why: "medicine", people: [{ key: `u:${M}`, name: "Mom", me: false, how: "app" }, { key: `u:${X}`, name: "Dad", me: false, how: "gone" }], open: null },
    people: [{ key: `u:${U}`, name: "You", me: true, number: false }, { key: `u:${M}`, name: "Mom", me: false, number: true }, { key: "u:eeeeeeee-0000-4000-8000-000000000005", name: "Rahul", me: false, number: false }],
    spaces: true, numbers: true, invite: { screen: "bots.space.invite", params: { id: "s1" } }, ...o,
  });
  it("people picker: you and your X0 people only, who is gone says so, the space invite the Spaces screens use, and saving names or ids", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const p = await draw("bots.plan.follow.people", client, { kind: "task", id: T }, { [`GET ${FOLLOW}/people?kind=task&id=${T}`]: picker() });
      expect(lintTree(p.s.root!)).toEqual([]);
      expect(p.texts).toEqual(expect.arrayContaining(["Who does it", "Mom", "Does it", "If they can't · Not in your X0 people now", "Rahul", "Invite someone to a space", "Someone by name"]));
      const puts = actionsIn(p.s).filter((x) => x.kind === "callEndpoint" && x.path === `${FOLLOW}/item`).map((x) => x.body as { people: unknown[] });
      expect(puts).toEqual(expect.arrayContaining([
        expect.objectContaining({ people: [{ id: M }, { id: X }, { id: "eeeeeeee-0000-4000-8000-000000000005" }] }),
        expect.objectContaining({ people: [{ id: M }, { id: X }, { name: "$state.addName" }] }),
      ]));
      expect(actionsIn(p.s)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "navigate", screenId: "bots.space.invite", params: { id: "s1" } })]));
    }
  });
  it("people picker: with Spaces off only you, said plainly, and no invite; the number field only when numbers can be kept", async () => {
    const p = await draw("bots.plan.follow.people", "phone", { kind: "task", id: T }, { [`GET ${FOLLOW}/people?kind=task&id=${T}`]: picker({ spaces: false, invite: null, numbers: false, people: [{ key: `u:${U}`, name: "You", me: true, number: false }] }) });
    expect(p.texts).toContain("Only you for now. People you share a space with on X0 can be added once Spaces is on.");
    expect(p.texts).not.toContain("Invite someone to a space");
    expect(p.json).not.toContain(`${FOLLOW}/number`);
  });
});

// ===================================================================== the item page, the bill page, the call screen

describe("the item page and the call screen", () => {
  const T = "5e1f0c2e-1111-4222-8333-944445555777";
  const follow = { allowed: true, importance: null, must: true, why: "medicine", people: [{ key: `u:${M}`, name: "Mom", me: false, how: "app" }], open: { id: "f1", line: "Mom · not done yet" } };
  const task = (o: Record<string, unknown> = {}) => ({ id: T, title: "Mom's evening medicine", notes: "", list: "", due: "2026-11-12", at: ist(12, 21), done: false, doneAt: null, remindMin: 0, from: null, source: "me", fixed: false, kind: "todo", ...o });
  const itemApi = (t: Record<string, unknown>, f: unknown = follow) => ({
    [`GET /v1/botsapp/calendar/tasks/${T}`]: { task: t },
    [`GET /v1/botsapp/bots/plan/details?kind=task&id=${T}&tz=${IST}`]: { before: [], moves: [], ...(f ? { follow: f } : {}) },
  });
  it("item page: the add form sends importance; details show Must not miss with why, Who, and the open follow's line; waits and someone else's items show none", async () => {
    const add = await draw("bots.plan.item", "phone", { kind: "task" }, {});
    expect(add.texts).toEqual(expect.arrayContaining(["Must not miss", "X0 marks medicine, pickups, bills due today and flights by itself."]));
    expect(actionsIn(add.s).filter((x) => x.kind === "callEndpoint" && String(x.path).endsWith("/tasks"))[0]!.body).toMatchObject({ importance: "$state.imp" });
    for (const client of ["phone", "desktop"] as const) {
      const d = await draw("bots.plan.item", client, { kind: "task", id: T }, itemApi(task()));
      expect(lintTree(d.s.root!)).toEqual([]);
      expect(d.texts).toEqual(expect.arrayContaining(["Must not miss", "Marked by X0: medicine", "Who: Mom", "Mom · not done yet"]));
      expect(d.s.state).toMatchObject({ must: true });
    }
    const wait = await draw("bots.plan.item", "phone", { kind: "task", id: T }, itemApi(task({ kind: "wait" }), { ...follow, allowed: false }));
    expect(wait.texts).not.toContain("Must not miss");
    const off = await draw("bots.plan.item", "phone", { kind: "task", id: T }, itemApi(task(), null));
    expect(off.texts).not.toContain("Must not miss");
  });
  it("bill page: the same section", async () => {
    const d = await draw("bots.plan.item", "phone", { kind: "task", id: T }, itemApi(task({ kind: "due", title: "Electricity", at: null }), { ...follow, why: "bill_today" }));
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.texts).toEqual(expect.arrayContaining(["Paid", "Must not miss", "Marked by X0: due today", "Who: Mom"]));
  });
  it("call screen: a follow call has Done, Later and Can't, and says who asked without the medicine", async () => {
    const seed = { source: "follow" as const, item: "pf:eeeeeeee-0000-4000-8000-000000000001:1", followId: "eeeeeeee-0000-4000-8000-000000000001", day: "2026-11-12", tz: IST, title: "Mom's meds", at: ist(12, 21), asker: "Rahul" };
    expect(openingLine(seed, { back: false, talk: true, now: ist(12, 21), tz: IST })).toBe("Rahul asked me to remind you: your reminder.");
    const view = { id: "eeeeeeee-0000-4000-8000-0000000000c1", state: "ringing", origin: "server", name: "X0", source: "follow", line: "Not done yet · 9 pm", ringAt: ist(12, 21), missedClock: "9 pm", answeredAt: null, endedAt: null, late: true, ai: false, card: cardOf(seed, IST) };
    const s = await draw("bots.plan.call", "phone", { call: view.id }, { [`GET /v1/botsapp/bots/plan/calls/${view.id}`]: view });
    expect(lintTree(s.s.root!)).toEqual([]);
    const acts = actionsIn(s.s).filter((x) => x.kind === "callEndpoint" && x.path === "/v1/widgets/act").map((x) => (x.body as { action: string; item: string }));
    expect(acts.map((a) => a.action)).toEqual(expect.arrayContaining(["done", "later", "cant"]));
    expect(acts.every((a) => a.item === seed.item)).toBe(true);
    expect(s.texts).toContain("From Rahul · 9 pm");
  });
});

// ===================================================================== What pings you, Activity, the bootstrap, settings

describe("What pings you, Activity, the bootstrap, settings", () => {
  const settings = { monthLimitPaise: 50_000, stopAtLimit: false, notify: { ...DEFAULT_SETTINGS.notify, followFrom: [M] }, privacy: {} };
  const notify = (client: "phone" | "desktop", d: Record<string, unknown>) => draw("bots.notify", client, {}, { [`GET /v1/you/notify?tz=${IST}`]: { settings, today: null, line: null, calls: true, ...d } });
  it("What pings you: Keep at it, Tell the next person and Louder pings a day on phone and desktop, only with PLAN_V2_FOLLOW; the real call only when it can go", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const on = await notify(client, { follow: true, followFrom: [{ id: M, name: "Mom" }], phone: null });
      expect(lintTree(on.s.root!)).toEqual([]);
      expect(on.texts).toEqual(expect.arrayContaining(["Keep at it", "Tell the next person", "Louder pings a day", "People who can ring you louder", "Mom"]));
      expect(on.texts).not.toContain("X0 may call my phone if I miss something important");
      expect(actionsIn(on.s)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "callEndpoint", body: { notify: { ringMax: 10 } } }), expect.objectContaining({ kind: "callEndpoint", body: { notify: { followFrom: { id: M, on: false } } } })]));
      const phone = await notify(client, { follow: true, followFrom: [], phone: { number: { state: "verified", display: "+91 98••• ••210" } } });
      expect(phone.texts).toEqual(expect.arrayContaining(["X0 may call my phone if I miss something important", "Only to +91 98••• ••210, never in quiet hours"]));
      const off = await notify(client, {});
      expect(off.texts).not.toContain("Keep at it");
    }
  });
  it("Activity: follow rows draw and open the follow page", async () => {
    const rows = feedOf({ now: ist(12, 22), tzOffsetMinutes: IST, jobs: [], tasks: [], events: [], words: [], follows: [
      { id: "follow:f1:done_by", follow: "eeeeeeee-0000-4000-8000-000000000001", what: "done_by", who: "Mom", title: "Mom's evening medicine", at: ist(12, 21, 12), via: "call" },
    ] });
    expect(rows[0]).toMatchObject({ type: "follow", title: "Mom said done", sub: "Mom's evening medicine · 9:12 pm · Phone call", mark: "done", open: { screenId: "bots.plan.follow" } });
    for (const client of ["phone", "desktop"] as const) {
      const s = await draw("bots.activity", client, {}, { [`GET /v1/shell/activity?tz=${IST}`]: { now: ist(12, 22), week: { done: 1, paise: 0, minutesSaved: 0 }, rows } });
      expect(lintTree(s.s.root!)).toEqual([]);
      expect(s.texts).toContain("Mom said done");
    }
  });
  it("bootstrap: follow buttons only with PLAN_V2_FOLLOW; every button id is unique across the app's own, Plan Ease's, the call's and the follow's categories; none has more than 3", () => {
    const cats = () => withAppKnobs({ labels: {}, flags: {} }).flags["push.categories"] as Array<{ id: string; actions: Array<{ id: string }> }>;
    expect(cats().map((c) => c.id)).toEqual(expect.arrayContaining(FOLLOW_CATEGORIES.map((c) => c.id)));
    const ids = cats().flatMap((c) => c.actions.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(cats().every((c) => c.actions.length <= 3)).toBe(true);
    expect([...PLAN_CATEGORIES, ...FOLLOW_CATEGORIES, ...CALL_CATEGORIES].every((c) => c.actions.length <= 3)).toBe(true);
    vi.stubEnv("PLAN_V2_FOLLOW", "false"); resetConfigForTests();
    expect(cats().map((c) => c.id).some((id) => id.startsWith("x0_follow"))).toBe(false);
  });
  it("settings: follow, followTell, ringMax, followFrom and phoneCall clean and patch; a follow Activity id can be cleared", () => {
    expect(cleanSettings({}).notify).toMatchObject({ follow: true, followTell: true, ringMax: 6, followFrom: [], phoneCall: false });
    expect(cleanSettings({ notify: { ringMax: 7, followFrom: [M, M, "nope"], phoneCall: "yes" } }).notify).toMatchObject({ ringMax: 6, followFrom: [M], phoneCall: false });
    const cur = cleanSettings({});
    const ok = applyPatch(cur, { notify: { follow: false, ringMax: 3, followFrom: { id: M, on: true }, phoneCall: true } });
    expect(ok.ok && ok.settings.notify).toMatchObject({ follow: false, ringMax: 3, followFrom: [M], phoneCall: true });
    expect(applyPatch(cur, { notify: { ringMax: 4 } })).toEqual({ ok: false, message: "ringMax is 3, 6 or 10." });
    expect(applyPatch(cur, { notify: { followFrom: { id: "x" } } })).toEqual({ ok: false, message: "followFrom is { id, on }." });
    expect(withCleared(cur, "follow:eeeeeeee-0000-4000-8000-000000000001:done_by")).not.toBeNull();
  });
  it("items and logs: pf:<id>:<n> parses; a member's follow push answers that climb; a real call's callbacks are logged without their query", () => {
    const id = "eeeeeeee-0000-4000-8000-000000000001";
    expect(parseItem(`pf:${id}:3`)).toEqual({ kind: "pf", followId: id, n: 3 });
    expect(parseItem(`pf:${id}`)).toBeNull();
    expect(parseItem("pf:NOT-A-UUID:1")).toBeNull();
    expect(pushItemOf("space_follow_loud", { item: `pf:${id}:2` })).toBe(`pf:${id}:2`);
    expect(pushItemOf("plan_follow", { item: `pf:${id}:1` })).toBe(`pf:${id}:1`);
    expect(logUrl("/v1/channels/plivo/answer?f=x&n=1&t=secretmac")).toBe("/v1/channels/plivo/answer");
  });
});

// ===================================================================== the routes

describe("the routes", () => {
  function app() {
    const clock = { t: ist(12, 8) };
    const calendar = new Calendar({ rows: memoryCalendarRows(), now: () => clock.t, publish: () => undefined });
    const ease = new PlanEase({ calendar, prefs: memoryPlanPrefs(() => clock.t), skips: new MemoryTable(), now: () => clock.t, send: async () => undefined });
    ease.attach();
    const follows = new PlanFollows({ stores: memoryFollowStores(), calendar, now: () => clock.t, engine: () => null, settingsOf: async () => structuredClone(DEFAULT_SETTINGS) });
    setPlanFollows(follows);
    const people: Record<string, Array<{ userId: string; name: string }>> = { [U]: [{ userId: M, name: "Mom" }], [M]: [{ userId: U, name: "Rahul" }] };
    const spaces = {
      spaces: { mine: async () => [{ id: "s1", name: "Home", perms: [], admin: true }] },
      threads: { contacts: async (u: string) => ({ people: people[u] ?? [], groupSpaces: [] }), directMuted: async () => false },
      tasks: { answer: async () => undefined },
    };
    const a = Fastify();
    registerPlanFollowRoutes(a, { rateLimit: RL }, { spaces: spaces as never, ease });
    return { a, calendar, follows, clock };
  }

  it("flags: PLAN_V2_FOLLOW=false arms nothing and the follow routes answer follow_off", async () => {
    vi.stubEnv("PLAN_V2_FOLLOW", "false"); resetConfigForTests();
    const { a, calendar, follows } = app();
    const t = await calendar.addTask(U, { title: "Mom's medicine", day: "2026-11-12", time: "21:00", tz: IST });
    const r = await a.inject({ method: "GET", url: `${FOLLOW}/people?kind=task&id=${t.id}`, headers: as(U) });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ code: "follow_off", message: "That isn't switched on here." });
    expect(await follows.arm(U, { kind: "task", row: { ...(t as never), source: { kind: "me" } } as never, at: ist(12, 21) })).toBe(false);
    await a.close();
  });

  it("routes: PUT item keeps your X0 people, says plainly who isn't one yet with the space invite, and GET people lists you and them; a session is needed", async () => {
    const { a, calendar } = app();
    const t = await calendar.addTask(U, { title: "Gas booking", day: "2026-11-12", time: "11:00", tz: IST });
    expect((await a.inject({ method: "GET", url: `${FOLLOW}/people?kind=task&id=${t.id}` })).statusCode).toBe(401);
    const put = await a.inject({ method: "PUT", url: `${FOLLOW}/item`, headers: as(U), payload: { kind: "task", id: t.id, importance: "must", people: [{ name: "Mom" }, { name: "Priya" }] } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ ok: true, missing: ["Priya"], message: "Priya isn't in your X0 people yet. Invite them to a space, then add them here.", invite: { screen: "bots.space.invite", params: { id: "s1" } } });
    expect(put.json().follow).toMatchObject({ importance: "must", people: [{ name: "Mom", how: "app" }] });
    const picker = (await a.inject({ method: "GET", url: `${FOLLOW}/people?kind=task&id=${t.id}`, headers: as(U) })).json();
    expect(picker.people.map((p: { name: string }) => p.name)).toEqual(["You", "Mom"]);
    expect(picker.numbers).toBe(false);
    // Someone else's item, or one that isn't there: never theirs to change.
    expect((await a.inject({ method: "PUT", url: `${FOLLOW}/item`, headers: as(M), payload: { kind: "task", id: t.id, importance: "must" } })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: `${FOLLOW}/not-a-uuid`, headers: as(U) })).statusCode).toBe(404);
    await a.close();
  });

  it("routes: a number for your Call button is kept sealed only for someone in your X0 people, and only with CONNECTOR_TOKEN_KEY", async () => {
    const { a, follows } = app();
    const no = await a.inject({ method: "PUT", url: `${FOLLOW}/number`, headers: as(U), payload: { member: M, phone: "98765 43210" } });
    expect(no.statusCode).toBe(409);
    vi.stubEnv("CONNECTOR_TOKEN_KEY", randomBytes(32).toString("base64")); resetConfigForTests();
    expect((await a.inject({ method: "PUT", url: `${FOLLOW}/number`, headers: as(U), payload: { member: X, phone: "98765 43210" } })).json()).toMatchObject({ message: "That person isn't in your X0 people yet." });
    expect((await a.inject({ method: "PUT", url: `${FOLLOW}/number`, headers: as(U), payload: { member: M, phone: "12" } })).json()).toMatchObject({ message: "That number doesn't look right." });
    expect((await a.inject({ method: "PUT", url: `${FOLLOW}/number`, headers: as(U), payload: { member: M, phone: "98765 43210" } })).json()).toEqual({ ok: true, number: true });
    const row = (await follows.stores.numbers.select({ user_id: U }))[0]!;
    expect(row.seal).not.toContain("9876543210");
    expect(await follows.people.numberFor(U, M)).toBe("+919876543210");
    await a.inject({ method: "PUT", url: `${FOLLOW}/number`, headers: as(U), payload: { member: M, phone: "" } });
    expect(await follows.people.numberFor(U, M)).toBeNull();
    await a.close();
  });
});

export type { FollowView };

/**
 * "PLAN SOMETHING": ITS ROUTES (PLAN_V2_MAKE; src/routes/bots/planMake.ts; the plan/day route in routes/bots/botsBots.ts).
 *
 *   - the signed-in person only (401), shut while the switches are off (404 make_off / plan_v2_off)
 *   - bounds: 2000 characters (413), a bad key or n (400), a bad fix id (400)
 *   - each route's rate limit
 *   - no title, words, name or place in any log line: a fix_first 400, a reader whose error holds the words, a 500
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
// The bearer is the user's id here; no bearer is no one.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanFollows, setPlanFollows } = await import("../src/botsBots/planFollow.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { PlanCapture, memoryCaptureStore } = await import("../src/botsBots/planCapture.js");
const { PlanMake } = await import("../src/botsBots/planMakeService.js");
const { registerPlanMakeRoutes } = await import("../src/routes/bots/planMake.js");
const { registerBotsBotsRoutes, AREA } = await import("../src/routes/bots/botsBots.js");
const { followOn } = await import("../src/botsBots/planSwitch.js");
const { MAKE, emptyCard } = await import("../src/botsBots/planMake.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { resetConfigForTests } = await import("../src/config.js");
type CardDraft = import("../src/botsBots/planMake.js").CardDraft;

const MIN = 60_000;
const IST = 330;
const NOW = Date.UTC(2026, 10, 12, 10, 0) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const DAD = "22222222-0000-4000-8000-000000000002";
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const as = { authorization: `Bearer ${U}` };
/** Words, titles, names and places that must never be in a log line. */
const SECRETS = ["Dentist", "Kabir", "Indiranagar", "Sunita", "Dad", "Rahul", "7ish", "Electricity", "Friday prayer"];

const card = (o: Partial<CardDraft> = {}): CardDraft => ({ ...emptyCard("2026-11-12"), ...o });

function makeOver(o: { reader?: (user: string) => Promise<{ text: string; usd: number }>; failAdd?: boolean } = {}) {
  const now = () => NOW;
  const calendar = new Calendar({ rows: memoryCalendarRows(), now, publish: () => undefined });
  if (o.failAdd) calendar.addEvent = (async (_u: string, raw: Record<string, unknown>) => { throw new Error(`insert failed for ${String(raw.title)} at Indiranagar`); }) as never;
  const prefs = memoryPlanPrefs(now);
  const ease = new PlanEase({ calendar, prefs, skips: new MemoryTable(), now });
  const follows = new PlanFollows({
    stores: memoryFollowStores(), calendar, now, settingsOf: async () => structuredClone(DEFAULT_SETTINGS), log: { info: () => undefined, warn: () => undefined },
    tzOfUser: async () => IST, contacts: async (u) => (u === U ? [{ userId: DAD, name: "Dad" }, { userId: "11111111-0000-4000-8000-000000000001", name: "Sunita Sharma" }] : []),
    muted: async () => false, engine: () => ({ notify: async () => null, configFor: () => structuredClone(PUSH_DEFAULTS) }) as never,
    calls: () => ({ ring: async () => ({ none: "x" }), closeFor: async () => undefined }) as never,
  });
  setPlanFollows(follows);
  const capture = new PlanCapture({
    calendar, prefs, store: memoryCaptureStore(), now, tzOf: async () => IST, usdInr: () => 100, aiOk: async () => true,
    readers: {
      text: async (_s, user) => (o.reader ? o.reader(user) : { text: JSON.stringify({ items: [] }), usd: 0.0001 }),
      picture: async () => { throw new Error("no"); }, glance: async () => { throw new Error("no"); },
    },
  });
  return { ease, make: new PlanMake({ ease: () => ease, calendar: () => calendar, people: () => (followOn() ? follows.people : null), capture: () => capture, now, settingsOf: async () => structuredClone(DEFAULT_SETTINGS) }) };
}

async function served(o: Parameters<typeof makeOver>[0] = {}) {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
  const app: FastifyInstance = Fastify({ logger: { level: "info", stream } });
  const routes: Array<{ method: string | string[]; url: string; config?: unknown }> = [];
  app.addHook("onRoute", (r) => { routes.push({ method: r.method, url: r.url, config: r.config }); });
  const { ease, make } = makeOver(o);
  registerPlanMakeRoutes(app, { rateLimit: RL }, { ease, make });
  await app.ready();
  const post = (url: string, payload: unknown, headers: Record<string, string> = as) => app.inject({ method: "POST", url, headers, payload: payload as object });
  const get = (url: string, headers: Record<string, string> = as) => app.inject({ method: "GET", url, headers });
  return { app, lines, routes, post, get };
}

beforeEach(() => { vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanFollows(null); });

describe("the routes", () => {
  it("401 without a token", async () => {
    const s = await served();
    for (const [method, url] of [["GET", `${MAKE}?tz=330`], ["POST", `${MAKE}/draft`], ["POST", `${MAKE}/check`], ["POST", MAKE], ["POST", `${MAKE}/undo`]] as const) {
      const res = await s.app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
      expect(res.statusCode, url).toBe(401);
      expect(res.json()).toEqual({ code: "unauthorized", message: "Missing or invalid token" });
    }
    const ok = await s.get(`${MAKE}?tz=330`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.json()).toMatchObject({ today: "2026-11-12", follow: true, ai: "on" });
    await s.app.close();
  });

  it("404 make_off when PLAN_V2_MAKE or PLAN_V2_PAGE is off; plan/day 404 plan_v2_off when PLAN_V2_PAGE is off", async () => {
    const s = await served();
    for (const flag of ["PLAN_V2_MAKE", "PLAN_V2_PAGE"]) {
      vi.stubEnv(flag, "false"); resetConfigForTests();
      for (const res of [await s.get(`${MAKE}?tz=330`), await s.post(`${MAKE}/draft`, { words: "Dentist Fri 5 pm", tz: IST }), await s.post(`${MAKE}/check`, { list: [] }), await s.post(MAKE, { key: crypto.randomUUID(), list: [] }), await s.post(`${MAKE}/undo`, { key: crypto.randomUUID(), n: 1 })]) {
        expect(res.statusCode, flag).toBe(404);
        expect(res.json()).toEqual({ code: "make_off", message: "That isn't switched on here." });
      }
      vi.unstubAllEnvs(); vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests();
    }
    await s.app.close();
    // GET .../plan/day sits with plan/today: on, the threaded day; PLAN_V2_PAGE off, 404.
    const app = Fastify();
    registerBotsBotsRoutes(app, { rateLimit: RL, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null });
    await app.ready();
    const day = await app.inject({ method: "GET", url: `${AREA}/plan/day?tz=${IST}&day=2026-11-13`, headers: as });
    expect(day.statusCode).toBe(200);
    expect(day.headers["cache-control"]).toBe("no-store");
    expect(day.json()).toMatchObject({ v: 3, day: "2026-11-13", strip: { days: expect.any(Array) }, thread: expect.any(Array) });
    vi.stubEnv("PLAN_V2_PAGE", "false"); resetConfigForTests();
    const off = await app.inject({ method: "GET", url: `${AREA}/plan/day?tz=${IST}`, headers: as });
    expect(off.statusCode).toBe(404);
    expect(off.json()).toMatchObject({ code: "plan_v2_off" });
    // The make routes are wired there too.
    vi.unstubAllEnvs(); vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests();
    expect((await app.inject({ method: "GET", url: `${MAKE}?tz=${IST}`, headers: as })).statusCode).toBe(200);
    await app.close();
  });

  it("2000 characters at most (413), a bad key or n (400), a bad fix id (400)", async () => {
    const s = await served();
    const big = await s.post(`${MAKE}/draft`, { words: "x".repeat(2001), tz: IST });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ code: "too_large", message: "That's a lot of words. Try a shorter one." });
    expect((await s.post(`${MAKE}/draft`, { words: "   ", tz: IST })).json()).toEqual({ code: "bad_request", message: "Say what to plan, like Dentist Fri 5 pm." });
    // A pasted notice of 2000 characters still reaches the box (as from the old box).
    expect((await s.post(`${MAKE}/draft`, { words: `${"Dentist Fri 5 pm. ".repeat(110)}`.slice(0, 2000), tz: IST })).statusCode).toBe(200);
    const list = [card({ title: "Haircut", time: "16:00" })];
    for (const key of ["nope", "0f8fad5b-d9cb-169f-a165-70867728950e", "", 7]) {
      const res = await s.post(MAKE, { key, list, tz: IST });
      expect(res.statusCode, String(key)).toBe(400);
      expect(res.json()).toEqual({ code: "bad_request", message: "That doesn't look right. Try again." });
    }
    for (const n of [0, 22, "x", 1.5]) expect((await s.post(`${MAKE}/undo`, { key: crypto.randomUUID(), n })).statusCode, String(n)).toBe(400);
    for (const id of ["odd:pm", "time:9", "who:Riya", `who:${crypto.randomUUID()}`, ""]) {
      expect((await s.post(`${MAKE}/check`, { list, tz: IST, fix: { item: "0", id } })).statusCode, id).toBe(400);
    }
    expect((await s.post(`${MAKE}/check`, { list, tz: IST, fix: { item: "3", id: "time:09:00" } })).statusCode).toBe(400);
    expect((await s.post(`${MAKE}/check`, { list: [...list, ...list, ...list, ...list], tz: IST })).statusCode).toBe(400);
    expect((await s.post(`${MAKE}/check`, { list: [{ ...list[0], day: "someday" }], tz: IST })).statusCode).toBe(400);
    // A who that is a uuid but not one of their people is not a 400: it is dropped and said.
    const left = await s.post(`${MAKE}/check`, { list: [card({ title: "Haircut", time: "16:00", who: crypto.randomUUID() })], tz: IST });
    expect(left.statusCode).toBe(200);
    expect(left.json().view.items[0].notes.map((n: { id: string }) => n.id)).toContain("not_contact");
    await s.app.close();
  });

  it("the routes carry their rate limits", async () => {
    const s = await served();
    const limit = (method: string, url: string) => (s.routes.find((r) => r.method === method && r.url === url)!.config as { rateLimit?: { max: number } } | undefined);
    expect(limit("GET", MAKE)).toEqual(RL);
    expect(limit("POST", `${MAKE}/draft`)!.rateLimit!.max).toBe(20);
    expect(limit("POST", `${MAKE}/check`)!.rateLimit!.max).toBe(60);
    expect(limit("POST", MAKE)!.rateLimit!.max).toBe(20);
    expect(limit("POST", `${MAKE}/undo`)!.rateLimit!.max).toBe(20);
    await s.app.close();
  });

  it("no title, words, name or place in any log line", async () => {
    const s = await served({ reader: async (user) => { throw new Error(`provider could not read ${user}`); } });
    // A draft with an AI read that throws an error holding the words.
    const d = await s.post(`${MAKE}/draft`, { words: "meet Rahul around 7ish after his class at Indiranagar", tz: IST });
    expect(d.statusCode).toBe(200);
    // Check, Done and Undo with a contact's name and a place.
    const c = await s.post(`${MAKE}/check`, { list: [], d: card({ title: "Pick up Kabir", time: "18:00", who: DAD, place: "Indiranagar" }), at: "0", tz: IST, day0: "2026-11-12" });
    const made = await s.post(MAKE, { key: c.json().key, list: c.json().drafts, tz: IST });
    expect(made.statusCode).toBe(200);
    expect(made.json().line).toContain("Dad");
    await s.post(`${MAKE}/undo`, { key: made.json().key, n: made.json().n });
    // A fix_first 400 whose words name Dad: answered, never logged.
    const stop = await s.post(MAKE, { key: crypto.randomUUID(), list: [card({ title: "Buy fruit for Kabir", day: "", who: DAD })], tz: IST });
    expect(stop.statusCode).toBe(400);
    expect(stop.json()).toEqual({ code: "fix_first", message: "Pick a day so X0 can remind Dad." });
    // A bill's preview and the box.
    await s.post(`${MAKE}/draft`, { words: "Electricity 2140 due 14th", tz: IST });
    const lines = s.lines.join("\n");
    expect(lines).toContain("plan make: draft");
    expect(lines).toContain("plan make: added");
    expect(lines).toContain("plan make: undone");
    for (const w of SECRETS) expect(lines, w).not.toContain(w);
    expect(lines).not.toContain(DAD);
    await s.app.close();
    // A 500: logged by the error's name only.
    const f = await served({ failAdd: true });
    const bad = await f.post(MAKE, { key: crypto.randomUUID(), list: [card({ title: "Dentist", day: "2026-11-13", time: "18:00", place: "Indiranagar" })], tz: IST });
    expect(bad.statusCode).toBe(500);
    expect(bad.json()).toEqual({ code: "failed", message: "Couldn't do that just now." });
    const failed = f.lines.join("\n");
    expect(failed).toContain("plan make: request failed");
    for (const w of SECRETS) expect(failed, w).not.toContain(w);
    await f.app.close();
  });
});

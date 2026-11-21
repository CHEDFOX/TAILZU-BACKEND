/**
 * ACTIVITIES: what the work turned into (src/botsBots/activities.ts, the Activities tab).
 *
 *   an activity is a Talk session THAT PRODUCED WORK; a session of questions and answers is not one
 *   its bots are the distinct `by` of its turns, in the order they first spoke — which is how a card has MORE THAN ONE
 *   its line is composed BY RULE from what was done; no model is asked, so a card cannot describe work that did not happen
 *   it opens the WORK, never the conversation
 *   work that did not come from Talk still shows, as one bot each, and is never counted twice
 *   `ask` and `words` rows are not activities: an answer given and words spoken are not work set going
 */
import { describe, expect, it, vi } from "vitest";

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

const U = "u-aanya";
import { activitiesFrom, type ActivityInput, type RoutineLite } from "../src/botsBots/activities.js";
import type { ChatTurn } from "../src/botsBots/chat.js";
import type { Session } from "../src/botsBots/sessions.js";
import type { FeedRow } from "../src/shell/feed.js";

const N = 1_700_000_000_000;
const LOOKS: Record<string, { name: string; color: string }> = {
  travel: { name: "Travel bot", color: "#3f7d8c" },
  plan: { name: "Plan Ease", color: "#b08a3e" },
  code: { name: "Xode", color: "#5f7d4f" },
  tailzu: { name: "X0", color: "#0a0a0a" },
};
const look = (slug: string) => LOOKS[slug] ?? { name: slug, color: "#888888" };

const session = (id: string, title: string, at: number): Session =>
  ({ id, bot: "talk", title, frame: null, startedAt: at, touchedAt: at });

const turn = (o: Partial<ChatTurn> & { id: string }): ChatTurn =>
  ({ role: "bot", text: "", at: N, opens: [], approvals: [], paise: 0, ...o });

const row = (o: Partial<FeedRow> & { id: string; type: FeedRow["type"] }): FeedRow =>
  ({ bot: "code", title: "", at: N, mark: "done", ...o } as FeedRow);

function read(o: Partial<ActivityInput> = {}) {
  return activitiesFrom({ sessions: [], turns: new Map(), rows: [], routines: [], look, ...o });
}

describe("an activity is work, not conversation", () => {
  it("a session that only asked and answered makes no activity", () => {
    const s = session("s1", "What's on tomorrow?", N);
    const turns = new Map([["s1", [
      turn({ id: "t1", role: "me", text: "What's on tomorrow?" }),
      turn({ id: "t2", by: { slug: "plan", name: "Plan Ease", color: "#b08a3e" }, text: "Three things." }),
    ]]]);
    const r = read({ sessions: [s], turns });
    expect(r.now).toEqual([]);
    expect(r.done).toEqual([]);
  });

  it("a turn that DID something makes one, with the bots that were in it, in the order they spoke", () => {
    const s = session("s1", "Three days in Goa", N);
    const turns = new Map([["s1", [
      turn({ id: "t1", role: "me", text: "three days in Goa" }),
      turn({ id: "t2", by: { slug: "travel", name: "Travel bot", color: "#3f7d8c" }, did: { finds: "f1" } }),
      turn({ id: "t3", role: "me", text: "put it on my calendar" }),
      turn({ id: "t4", by: { slug: "plan", name: "Plan Ease", color: "#b08a3e" }, did: { needs: 1 } }),
      // The same bot again adds no second head.
      turn({ id: "t5", by: { slug: "travel", name: "Travel bot", color: "#3f7d8c" }, text: "Booked." }),
    ]]]);
    const [a] = read({ sessions: [s], turns }).now;
    expect(a!.title).toBe("Three days in Goa");
    expect(a!.bots.map((b) => b.slug)).toEqual(["travel", "plan"]);
    expect(a!.bots[0]).toMatchObject({ name: "Travel bot", color: "#3f7d8c" });
    // The most pressing thing any part of it is doing.
    expect(a!.state).toBe("needs");
  });

  it("the line is composed by rule from what was done — never by a model, and never more than three things", () => {
    const s = session("s1", "Everything at once", N);
    const turns = new Map([["s1", [
      turn({ id: "t1", did: { finds: "f1" }, by: { slug: "travel", name: "Travel bot", color: "#3f7d8c" } }),
      turn({ id: "t2", did: { routine: "{}" }, by: { slug: "tailzu", name: "X0", color: "#0a0a0a" } }),
      turn({ id: "t3", did: { upi: "upi://pay?pa=x@y" }, by: { slug: "tailzu", name: "X0", color: "#0a0a0a" } }),
      turn({ id: "t4", did: { needs: 2 }, by: { slug: "plan", name: "Plan Ease", color: "#b08a3e" } }),
    ]]]);
    const [a] = read({ sessions: [s], turns }).now;
    // Newest first, at most three.
    expect(a!.line).toBe("2 things need your yes · A payment to press · Saved as a routine");
    expect(a!.line.split(" · ")).toHaveLength(3);
  });

  it("a job's own row says where it got to, and the card opens the JOB — not the conversation", () => {
    const s = session("s1", "Cart rounds 99.5 down", N);
    const turns = new Map([["s1", [
      turn({ id: "t1", did: { job: "j1" }, by: { slug: "code", name: "Xode", color: "#5f7d4f" } }),
    ]]]);
    const rows = [row({ id: "job:j1", type: "job", bot: "code", title: "Fix the rounding", sub: "3 of 7 done", mark: "working" })];
    const [a] = read({ sessions: [s], turns, rows }).now;
    expect(a!.line).toBe("3 of 7 done");
    expect(a!.state).toBe("working");
    expect(a!.open).toEqual({ screenId: "bots.code.job", params: { id: "j1" } });
    // And that job is not ALSO listed on its own.
    expect(read({ sessions: [s], turns, rows }).now).toHaveLength(1);
  });

  it("work that did not come from Talk shows as one bot each; an answer given and words spoken do not", () => {
    const rows = [
      row({ id: "job:j9", type: "job", bot: "code", title: "Started on Xode's page", mark: "working" }),
      row({ id: "ask:a1", type: "ask", bot: "plan", title: "What's on tomorrow?" }),
      row({ id: "words:2026-11-20", type: "words", bot: "keybot", title: "1,200 words spoken" }),
      row({ id: "call:c1", type: "call", bot: "plan", title: "Missed call from X0", mark: "needs" }),
    ];
    const r = read({ rows });
    expect(r.now.map((a) => a.title)).toEqual(["Missed call from X0", "Started on Xode's page"]);
    expect(r.now.every((a) => a.bots.length === 1)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("words spoken");
    expect(JSON.stringify(r)).not.toContain("What's on tomorrow?");
  });

  it("needs you first, then working, newest inside each; finished ones are their own list", () => {
    const rows = [
      row({ id: "job:a", type: "job", title: "older working", mark: "working", at: N - 2000 }),
      row({ id: "job:b", type: "job", title: "done", mark: "done", at: N }),
      row({ id: "job:c", type: "job", title: "needs", mark: "needs", at: N - 9000 }),
      row({ id: "job:d", type: "job", title: "newer working", mark: "working", at: N - 1000 }),
      row({ id: "job:e", type: "job", title: "failed", mark: "failed", at: N - 50 }),
    ];
    const r = read({ rows });
    expect(r.now.map((a) => a.title)).toEqual(["needs", "newer working", "older working"]);
    expect(r.done.map((a) => a.title)).toEqual(["done", "failed"]);
  });

  it("a session whose answers came from no bot is X0's own, and a long one shows four heads at most", () => {
    const many = session("s1", "Lots", N);
    const turns = new Map([["s1", [turn({ id: "t1", did: { needs: 1 } })]]]);
    expect(read({ sessions: [many], turns }).now[0]!.bots.map((b) => b.slug)).toEqual(["tailzu"]);

    const six = session("s2", "Six bots", N);
    const sixTurns = new Map([["s2", ["a", "b", "c", "d", "e", "f"].map((s, i) =>
      turn({ id: `t${i}`, by: { slug: s, name: s, color: "#111111" }, ...(i === 0 ? { did: { needs: 1 } } : {}) }))]]);
    expect(read({ sessions: [six], turns: sixTurns }).now[0]!.bots).toHaveLength(4);
  });
});

describe("schedules", () => {
  const routine = (o: Partial<RoutineLite> = {}): RoutineLite =>
    ({ id: "r1", bot: { slug: "tailzu" }, task: "Sum up my week", when: "Every Friday at 5 pm", status: "on", next: { words: "Fri 30 Oct at 5 pm" }, ...o });

  it("a routine is its bot, what it does, when, and when next", () => {
    const [s] = read({ routines: [routine()] }).schedules;
    expect(s).toMatchObject({
      id: "r1", task: "Sum up my week", when: "Every Friday at 5 pm", next: "Fri 30 Oct at 5 pm", paused: false,
      bot: { slug: "tailzu", name: "X0" },
    });
  });

  it("a paused one says no next run, and a routine with no bot is X0's own", () => {
    const [s] = read({ routines: [routine({ status: "paused", bot: null })] }).schedules;
    expect(s!.next).toBe("");
    expect(s!.paused).toBe(true);
    expect(s!.bot.slug).toBe("tailzu");
  });
});

// ===================================================================== the route

describe("GET /v1/botsapp/activities", () => {
  it("joins the feed, Talk's threads and the routines, and decides nothing itself", async () => {
    const { default: Fastify } = await import("fastify");
    const { registerActivitiesRoutes } = await import("../src/routes/bots/botsActivities.js");
    const { botsAreaParts, resetAreaTablesForTests } = await import("../src/botsBots/index.js");
    resetAreaTablesForTests();

    const app = Fastify();
    // The feed, as the ledger's own route gives it: the route must read THAT, so a row cleared there is gone here.
    app.get("/v1/shell/activity", async () => ({
      now: N, week: { done: 1, paise: 0, minutesSaved: 0 },
      rows: [{ id: "job:j1", type: "job", bot: "code", title: "Fix the rounding", sub: "3 of 7 done", at: N, mark: "working" }],
    }));
    const bots = {
      list: async () => [{ slug: "code", name: "Xode", colour: "moss" }],
      resolve: async () => null,
    } as never;
    const routines = { list: async () => [{ id: "r1", bot: { slug: "tailzu", name: "X0" }, task: "Sum up my week", when: "Every Friday at 5 pm", status: "on", next: { at: N, words: "Fri at 5 pm" } }] } as never;
    const parts = botsAreaParts({ bots, connectors: null });
    registerActivitiesRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots, code: null, jobs: null, connectors: null, media: null, artifacts: null, routines }, { chat: parts.chat, sessions: parts.sessions });
    await app.ready();

    // A thread that set a job going: the activity is the thread, and the job's own row says where it got to.
    await parts.chat!.keepDoor(U, "talk", { said: "the cart rounds 99.5 down", text: "", by: { slug: "code", name: "Xode", color: "#5f7d4f" }, did: { job: "j1" } });

    const r = await app.inject({ method: "GET", url: "/v1/botsapp/activities?tz=330", headers: { authorization: `Bearer ${U}` } });
    expect(r.statusCode).toBe(200);
    const j = r.json() as { schedules: unknown[]; now: Array<Record<string, unknown>>; done: unknown[] };
    expect(j.schedules).toHaveLength(1);
    expect(j.schedules[0]).toMatchObject({ task: "Sum up my week", when: "Every Friday at 5 pm" });
    // One activity, not two: the job's feed row is spoken for by the thread that started it.
    expect(j.now).toHaveLength(1);
    expect(j.now[0]).toMatchObject({ title: "the cart rounds 99.5 down", line: "3 of 7 done", state: "working" });
    // THE HEAD WEARS THE BOT'S COLOUR AS IT IS NOW (#4F7A3A, from "moss" on the live list), not the one frozen on
    // the turn (#5f7d4f): an activity card is a thing happening now, so a bot recoloured since shows its new colour.
    expect(j.now[0]!.bots).toEqual([{ slug: "code", name: "Xode", color: "#4F7A3A" }]);
    expect(j.now[0]!.open).toEqual({ screenId: "bots.code.job", params: { id: "j1" } });
  });

  it("is 401 without a session and 404 with the bots platform off", async () => {
    const { default: Fastify } = await import("fastify");
    const { registerActivitiesRoutes } = await import("../src/routes/bots/botsActivities.js");
    const { botsAreaParts } = await import("../src/botsBots/index.js");
    const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
    const bots = { list: async () => [] } as never;

    const on = Fastify();
    on.get("/v1/shell/activity", async () => ({ rows: [] }));
    const parts = botsAreaParts({ bots, connectors: null });
    registerActivitiesRoutes(on, { rateLimit: RL, bots, code: null, jobs: null, connectors: null, media: null, artifacts: null }, { chat: parts.chat, sessions: parts.sessions });
    await on.ready();
    expect((await on.inject({ method: "GET", url: "/v1/botsapp/activities" })).statusCode).toBe(401);

    const off = Fastify();
    registerActivitiesRoutes(off, { rateLimit: RL, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null }, { chat: null, sessions: parts.sessions });
    await off.ready();
    const r = await off.inject({ method: "GET", url: "/v1/botsapp/activities", headers: { authorization: `Bearer ${U}` } });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("bots_off");
  });
});

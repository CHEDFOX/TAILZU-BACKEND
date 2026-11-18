/**
 * THE SESSION DOORS (routes/bots/botsBots.ts, botsBots/sessions.ts):
 *
 *   GET  /v1/botsapp/bots/sessions/:slug   the bot's thread, newest first
 *   POST /v1/botsapp/bots/sessions/:slug   the + : a new one, whatever is open
 *   GET  /v1/botsapp/bots/session/:id      one session and what was said in it, oldest first
 *
 * And the point of all of it: words said carry on in the session last touched, every turn is kept, and a session is its own person's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id && !id.startsWith("tzb_") ? { id, email: "aanya.sharma@example.in" } : null;
    },
  };
});

const { registerBotRoutes } = await import("../src/routes/bots/bots.js");
const { registerBotsBotsRoutes, AREA } = await import("../src/routes/bots/botsBots.js");
const { botsAreaParts, resetAreaTablesForTests } = await import("../src/botsBots/index.js");
const { ALICE, rig } = await import("./bots-rig.js");
const { fakeReader } = await import("./bots-bots-data.js");

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const NONE = { bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null };
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function served() {
  resetAreaTablesForTests();
  const r = await rig(() => "Mon legs, Wed upper body, Fri run.");
  const app = Fastify();
  registerBotRoutes(app, { rateLimit: RL, bots: r.bots });
  const parts = botsAreaParts({ bots: r.bots, connectors: null, reader: fakeReader(), now: () => r.now.t });
  registerBotsBotsRoutes(app, { rateLimit: RL, ...NONE, bots: r.bots }, { parts });
  await app.ready();
  const as = (who: string) => ({ authorization: `Bearer ${who}` });
  return {
    app, clock: r.now,
    say: (slug: string, message: string, session?: string, who = ALICE) =>
      app.inject({ method: "POST", url: `${AREA}/chat/${slug}`, headers: as(who), payload: { message, ...(session ? { session } : {}) } }),
    thread: (slug: string, who = ALICE) => app.inject({ method: "GET", url: `${AREA}/sessions/${slug}`, headers: as(who) }),
    plus: (slug: string, title = "", who = ALICE) =>
      app.inject({ method: "POST", url: `${AREA}/sessions/${slug}`, headers: as(who), payload: { title } }),
    one: (id: string, who = ALICE) => app.inject({ method: "GET", url: `${AREA}/session/${id}`, headers: as(who) }),
  };
}

describe("a bot's sessions", () => {
  beforeEach(() => resetAreaTablesForTests());

  it("puts the first words in a session of their own, and carries on in it", async () => {
    const s = await served();
    expect((await s.thread("plan")).json().sessions).toEqual([]);
    await s.say("plan", "Plan my week");
    const first = (await s.thread("plan")).json().sessions;
    expect(first).toHaveLength(1);
    expect(first[0].title).toBe("Plan my week");

    s.clock.t += 40 * 86_400_000;
    await s.say("plan", "What's on tomorrow?");
    const after = (await s.thread("plan")).json().sessions;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first[0].id);
    // Both exchanges are in it, and nothing was thrown away.
    const got = (await s.one(first[0].id)).json();
    expect(got.turns.map((t: { text: string }) => t.text)).toEqual([
      "Plan my week", "Mon legs, Wed upper body, Fri run.", "What's on tomorrow?", "Mon legs, Wed upper body, Fri run.",
    ]);
  });

  it("starts a new one only when the + is pressed, and the next words join it", async () => {
    const s = await served();
    await s.say("plan", "Plan my week");
    const made = (await s.plus("plan", "Something else")).json().session;
    expect(made.title).toBe("Something else");
    await s.say("plan", "and this?");
    expect((await s.one(made.id)).json().turns.map((t: { text: string }) => t.text)).toContain("and this?");
    expect((await s.thread("plan")).json().sessions[0].id).toBe(made.id);
  });

  it("puts a message in the session it names", async () => {
    const s = await served();
    await s.say("plan", "Plan my week");
    const older = (await s.thread("plan")).json().sessions[0].id;
    const newer = (await s.plus("plan")).json().session.id;
    await s.say("plan", "back to the first one", older);
    expect((await s.one(older)).json().turns.map((t: { text: string }) => t.text)).toContain("back to the first one");
    expect((await s.one(newer)).json().turns).toEqual([]);
  });

  it("keeps a bot's sessions to itself, and a person's to themselves", async () => {
    const s = await served();
    await s.say("plan", "Plan my week");
    expect((await s.thread("travel")).json().sessions).toEqual([]);
    const mine = (await s.thread("plan")).json().sessions[0].id;
    expect((await s.thread("plan", BOB)).json().sessions).toEqual([]);
    expect((await s.one(mine, BOB)).statusCode).toBe(404);
  });

  it("says so when there is no such session", async () => {
    const s = await served();
    const r = await s.one("11111111-1111-4111-8111-111111111111");
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("not_found");
  });
});

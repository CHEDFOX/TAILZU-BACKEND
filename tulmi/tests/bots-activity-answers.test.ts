/**
 * ACTIVITY HAS EVERY ANSWER A BOT GAVE (routes/botsBots.ts, routes/botsShell.ts, screens/code.ts; docs/bots-gaps.md A4):
 *
 *   - an answer in a bot's own page or chat (POST /v1/botsapp/bots/chat/:slug) is written down as Ask's are, once: a repeat of the
 *     same request is replayed and not written again, and a refused ask writes nothing
 *   - the Code bot's own page asks through /v1/shell/ask (which writes it down), with its project
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

const { registerBotRoutes } = await import("../src/routes/bots.js");
const { registerBotsBotsRoutes, AREA } = await import("../src/routes/botsBots.js");
const { registerBotsShellRoutes } = await import("../src/routes/botsShell.js");
const { botsAreaParts, resetAreaTablesForTests } = await import("../src/botsBots/index.js");
const { MemoryEventStore } = await import("../src/shell/events.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { ALICE, rig } = await import("./bots-rig.js");
const { fakeReader } = await import("./bots-bots-data.js");

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const NONE = { bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null };

async function served() {
  resetAreaTablesForTests();
  const r = await rig(() => "Mon legs, Wed upper body, Fri run.");
  const app = Fastify();
  registerBotRoutes(app, { rateLimit: RL, bots: r.bots });
  const events = new MemoryEventStore();
  const parts = botsAreaParts({ bots: r.bots, connectors: null, reader: fakeReader(), now: () => r.now.t });
  registerBotsBotsRoutes(app, { rateLimit: RL, ...NONE, bots: r.bots }, { parts, events });
  await app.ready();
  const chat = (slug: string, message: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `${AREA}/chat/${slug}`, headers: { authorization: `Bearer ${ALICE}`, ...headers }, payload: { message } });
  return { app, events, chat };
}

describe("a bot's own page and chat", () => {
  beforeEach(() => resetAreaTablesForTests());

  it("writes the answer down for Activity, once", async () => {
    const s = await served();
    const first = await s.chat("plan", "Plan my week", { "idempotency-key": "k-1" });
    expect(first.statusCode).toBe(200);
    expect(await s.events.list(ALICE, 0)).toMatchObject([{ kind: "ask", bot: "plan", title: "Plan my week" }]);
    // The same request again (a double tap, a retry): the answer it had, not a second row.
    const again = await s.chat("plan", "Plan my week", { "idempotency-key": "k-1" });
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(await s.events.list(ALICE, 0)).toHaveLength(1);
    // A new question is a new row.
    await s.chat("plan", "What's on tomorrow?");
    expect((await s.events.list(ALICE, 0)).map((e) => e.title)).toEqual(["What's on tomorrow?", "Plan my week"]);
  });

  it("writes nothing for an ask that was refused", async () => {
    const s = await served();
    expect((await s.chat("code", "hi")).json().code).toBe("code_bot");
    expect((await s.chat("nope-bot", "hi")).statusCode).toBe(404);
    expect(await s.events.list(ALICE, 0)).toEqual([]);
  });
});

describe("the Code bot's own page", () => {
  it("asks through /v1/shell/ask, which writes the answer down and carries the project", async () => {
    const PROJECT = "9b2c3d4e-0000-4000-8000-0000000000aa";
    const asked: Array<Record<string, unknown>> = [];
    const app = Fastify();
    app.post("/v1/ask", async (req) => { asked.push(req.body as Record<string, unknown>); return { id: "d1", result: { text: "Two PRs merged.", paise: 30 }, bot: { slug: "code", name: "Code bot" } }; });
    const events = new MemoryEventStore();
    registerBotsShellRoutes(app, { rateLimit: RL, ...NONE, bots: {} as never }, { events });
    await app.ready();
    const r = await app.inject({ method: "POST", url: "/v1/shell/ask", headers: { authorization: `Bearer ${ALICE}` }, payload: { message: "What changed this week?", bot: "code", projectId: PROJECT, device: "phone" } });
    expect(r.statusCode).toBe(200);
    expect(asked[0]).toMatchObject({ message: "What changed this week?", bot: "code", projectId: PROJECT });
    expect(await events.list(ALICE, 0)).toMatchObject([{ kind: "ask", bot: "code", title: "What changed this week?", paise: 30 }]);

    // Two projects: the Code bot's overview, whose "What changed this week?" asks the bot itself.
    const projects = [PROJECT, "9b2c3d4e-0000-4000-8000-0000000000bb"].map((id, i) => ({ id, fullName: `aanya-sharma/${i ? "salon" : "storefront"}`, defaultBranch: "main", private: true, createdAt: 0 }));
    const api = { "GET /v1/code/github": { connected: true, installations: [] }, "GET /v1/code/projects": { projects }, "GET /v1/code/jobs": { jobs: [] } };
    for (const client of ["phone", "desktop"] as const) {
      const s = await buildBotsScreen({ screenId: "bots.code", client, params: {}, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]), desk: { pages: false, notes: false } }, fakeDeps({ api, jobs: [] }));
      const j = JSON.stringify(s.root);
      expect(j).toContain('"path":"/v1/shell/ask","body":{"message":"What changed in my projects this week?"');
      expect(j).not.toMatch(/"path":"\/v1\/ask","body":\{[^}]*"bot":"code"/);
    }
  });
});

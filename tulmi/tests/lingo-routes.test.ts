/**
 * LINGO'S DOORS (src/routes/bots/lingo.ts):
 *
 *   - off unless BOTS and LINGO are on: every route is 404, never a hint that it exists
 *   - a course is a pair of language tags and nothing else: no language is built in, and any pair is allowed
 *   - THE APP CANNOT MARK ITSELF. What is accepted is rebuilt on the server from the stored item, so an app that
 *     sends a verdict, or its own list of right answers, is simply not listened to
 *   - a session is what is due, and answering writes the scheduling back and moves the streak
 */
import { describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.BOTS = "true";
  process.env.LINGO = "true";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => {
    const t = h?.replace(/^Bearer\s+/i, "").trim() ?? "";
    return t ? { id: t, token: t } : null;
  } };
});

const { MemoryLingoStore } = await import("../src/lingo/store.js");
const { registerLingoRoutes } = await import("../src/routes/bots/lingo.js");

const T0 = Date.UTC(2026, 0, 1);

async function server(store = new MemoryLingoStore(), now = () => T0): Promise<FastifyInstance> {
  const app = Fastify();
  registerLingoRoutes(app, { rateLimit: {}, bots: {}, store, now });
  await app.ready();
  return app;
}

const AUTH = { authorization: "Bearer u1" };
const call = (app: FastifyInstance, method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: AUTH, ...(payload === undefined ? {} : { payload: payload as object }) });

describe("off", () => {
  it("answers 404 everywhere with the bots platform off, and gives nothing away", async () => {
    const app = Fastify();
    registerLingoRoutes(app, { rateLimit: {}, bots: null, store: new MemoryLingoStore(), now: () => T0 });
    await app.ready();
    for (const [method, url] of [["GET", "/v1/lingo/courses"], ["PUT", "/v1/lingo/course"], ["POST", "/v1/lingo/session"], ["POST", "/v1/lingo/answer"], ["POST", "/v1/lingo/words"], ["DELETE", "/v1/lingo/course/es"]] as const) {
      const r = await call(app, method, url, method === "GET" || method === "DELETE" ? undefined : {});
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.json().code).toBe("lingo_off");
    }
  });

  it("asks an unknown caller to sign in, whoever they are", async () => {
    const app = await server();
    const r = await app.inject({ method: "GET", url: "/v1/lingo/courses" });
    expect(r.statusCode).toBe(401);
  });
});

describe("a course is a pair of tags, and no language is built in", () => {
  it("starts one for any pair somebody names", async () => {
    const app = await server();
    for (const [target, from] of [["es", "en"], ["ja", "pt-BR"], ["sw", "ar"], ["cy", "zh-Hans"]]) {
      const r = await call(app, "PUT", "/v1/lingo/course", { target, from });
      expect(r.statusCode, `${target} from ${from}`).toBe(200);
      expect(r.json().course).toMatchObject({ target, from, level: "a1" });
    }
    const list = await call(app, "GET", "/v1/lingo/courses");
    expect(list.json().courses).toHaveLength(4);
  });

  it("refuses nonsense, and refuses learning a language from itself", async () => {
    const app = await server();
    expect((await call(app, "PUT", "/v1/lingo/course", { target: "", from: "en" })).statusCode).toBe(400);
    expect((await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "es" })).statusCode).toBe(400);
    expect((await call(app, "PUT", "/v1/lingo/course", { target: "not a tag!", from: "en" })).statusCode).toBe(400);
  });

  it("keeps the streak and the words when the course is changed", async () => {
    const store = new MemoryLingoStore();
    const app = await server(store);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "hola", gloss: "hello" }] });
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en", goalMin: 25, level: "b1" });
    const c = (await call(app, "GET", "/v1/lingo/courses")).json().courses[0];
    expect(c).toMatchObject({ goalMin: 25, level: "b1" });
    expect(c.progress.items).toBe(1);
  });
});

describe("words", () => {
  it("adds them, and adding the same one twice adds nothing", async () => {
    const app = await server();
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    expect((await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "hola", gloss: "hello" }, { item: "adiós", gloss: "bye" }] })).json().added).toBe(2);
    expect((await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "hola", gloss: "hello" }] })).json().added).toBe(0);
  });

  it("will not add to a course that was never started", async () => {
    const app = await server();
    expect((await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "hola", gloss: "hello" }] })).statusCode).toBe(400);
  });

  it("reads a phrase as a phrase", async () => {
    const store = new MemoryLingoStore();
    const app = await server(store);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "buenos días", gloss: "good morning" }] });
    expect((await store.items("u1", "es"))[0]!.kind).toBe("phrase");
  });
});

describe("a session and an answer", () => {
  const start = async () => {
    const store = new MemoryLingoStore();
    const app = await server(store);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    await call(app, "POST", "/v1/lingo/words", { target: "es", items: [
      { item: "hola", gloss: "hello" }, { item: "adiós", gloss: "goodbye" },
      { item: "gracias", gloss: "thank you" }, { item: "perro", gloss: "dog" },
    ] });
    return { app, store };
  };

  it("hands back something to do, each with what it needs", async () => {
    const { app } = await start();
    const r = await call(app, "POST", "/v1/lingo/session", { target: "es" });
    expect(r.statusCode).toBe(200);
    const { exercises, progress } = r.json();
    expect(exercises.length).toBeGreaterThan(0);
    expect(progress.items).toBe(4);
    for (const e of exercises) {
      expect(e.kind).toBe("choose");          // nothing has been met yet
      expect(e.options.length).toBeGreaterThan(1);
      expect(e.options[e.correct]).toBeTruthy();
    }
  });

  it("marks a right answer right, and writes the scheduling back", async () => {
    const { app, store } = await start();
    const { exercises } = (await call(app, "POST", "/v1/lingo/session", { target: "es" })).json();
    const first = exercises[0];
    const r = await call(app, "POST", "/v1/lingo/answer", { target: "es", item: first.item, kind: "choose", picked: first.correct });
    expect(r.json().mark).toMatchObject({ verdict: "right" });
    expect(r.json().dueMs).toBeGreaterThan(T0);
    expect(r.json().streakDays).toBe(1);
    const kept = (await store.items("u1", "es")).find((i) => i.item === first.item)!;
    expect(kept.memory.reps).toBe(1);
    expect(kept.memory.state).not.toBe("new");
  });

  it("marks a wrong answer wrong", async () => {
    const { app } = await start();
    const { exercises } = (await call(app, "POST", "/v1/lingo/session", { target: "es" })).json();
    const first = exercises[0];
    const wrong = first.correct === 0 ? 1 : 0;
    expect((await call(app, "POST", "/v1/lingo/answer", { target: "es", item: first.item, kind: "choose", picked: wrong })).json().mark)
      .toMatchObject({ verdict: "wrong" });
  });

  it("DOES NOT LET THE APP MARK ITSELF", async () => {
    const { app } = await start();
    const { exercises } = (await call(app, "POST", "/v1/lingo/session", { target: "es" })).json();
    const first = exercises[0];
    const wrong = first.correct === 0 ? 1 : 0;
    // Everything an app could send to claim it was right: a verdict, its own accepted answers, a count of times said.
    const r = await call(app, "POST", "/v1/lingo/answer", {
      target: "es", item: first.item, kind: "choose", picked: wrong,
      correct: wrong, mark: { verdict: "right" }, verdict: "right", accepted: ["anything"], spoken: 99, learned: true,
    });
    expect(r.json().mark.verdict).toBe("wrong");
    expect(r.json().spoken).toBe(0);
    expect(r.json().learned).toBe(false);
  });

  it("will not answer for a word that is not in the course", async () => {
    const { app } = await start();
    expect((await call(app, "POST", "/v1/lingo/answer", { target: "es", item: "nothing", kind: "write", said: "x" })).statusCode).toBe(400);
  });

  it("will not answer with a kind of exercise that does not exist", async () => {
    const { app } = await start();
    expect((await call(app, "POST", "/v1/lingo/answer", { target: "es", item: "hola", kind: "freebie", said: "x" })).statusCode).toBe(400);
  });

  it("counts a word said out loud, and only out loud", async () => {
    const { app } = await start();
    const spoken = await call(app, "POST", "/v1/lingo/answer", { target: "es", item: "hola", kind: "say", said: "hola" });
    expect(spoken.json().mark.verdict).toBe("right");
    expect(spoken.json().spoken).toBe(1);
    const typed = await call(app, "POST", "/v1/lingo/answer", { target: "es", item: "gracias", kind: "write", said: "gracias" });
    expect(typed.json().spoken).toBe(0);
  });

  it("is kind about an accent typed, and says which it was", async () => {
    const { app } = await start();
    const r = await call(app, "POST", "/v1/lingo/answer", { target: "es", item: "adiós", kind: "write", said: "adios" });
    expect(r.json().mark).toMatchObject({ verdict: "close", why: "accent" });
  });
});

describe("forgetting", () => {
  it("takes the course and every word of it", async () => {
    const store = new MemoryLingoStore();
    const app = await server(store);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "hola", gloss: "hello" }] });
    expect((await call(app, "DELETE", "/v1/lingo/course/es")).statusCode).toBe(200);
    expect(await store.course("u1", "es")).toBeNull();
    expect(await store.items("u1", "es")).toEqual([]);
  });
});

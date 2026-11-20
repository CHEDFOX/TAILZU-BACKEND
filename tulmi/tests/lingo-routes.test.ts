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
const { MemorySentenceBank } = await import("../src/lingo/sentences.js");
const { MemoryLessonBank } = await import("../src/lingo/lessons.js");
const { live } = await import("../src/live/bus.js");
const { registerLingoRoutes } = await import("../src/routes/bots/lingo.js");
const { refOf } = await import("../src/lingo/session.js");
const { EXERCISE_KINDS } = await import("../src/lingo/types.js");

const T0 = Date.UTC(2026, 0, 1);

async function server(store = new MemoryLingoStore(), now = () => T0, bank?: unknown): Promise<FastifyInstance> {
  const app = Fastify();
  // `lessons: null` so nothing here reaches for a real model: these tests are about the spine, the sets and the
  // marking. The path's own routes are the describe at the bottom, which hands them a model door of its own.
  registerLingoRoutes(app, { rateLimit: {}, bots: {}, store, now, lessons: null, ...(bank ? { bank: bank as never } : {}) });
  await app.ready();
  return app;
}

/** A bank with a handful of real short sentences in it, for the spine to draw on. */
async function bankOf(...texts: Array<[string, string]>) {
  const bank = new MemorySentenceBank();
  await bank.put("es", "en", texts.map(([text, gloss]) => ({ text, gloss, words: 0, licence: "CC0-1.0", author: "", source: "t" })), T0);
  return bank;
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
    expect((await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "not a tag!" })).statusCode).toBe(400);
    expect((await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "es" })).statusCode).toBe(400);
    expect((await call(app, "PUT", "/v1/lingo/course", { target: "not a tag!", from: "en" })).statusCode).toBe(400);
  });

  it("starts a language without being told which one they already speak", async () => {
    // The screen that adds the FIRST language is the one place nobody knows yet what they speak, so the route has to
    // work it out. This used to be a 400 and every first language was refused.
    let tick = 0;
    const app = await server(new MemoryLingoStore(), () => T0 + tick++);
    const r = await call(app, "PUT", "/v1/lingo/course", { target: "es" });
    expect(r.statusCode).toBe(200);
    expect(r.json().course).toMatchObject({ target: "es", from: "en" });
    // Whatever their other courses are taught in, not English again by accident.
    await call(app, "PUT", "/v1/lingo/course", { target: "pt", from: "fr" });
    const third = await call(app, "PUT", "/v1/lingo/course", { target: "ja" });
    expect(third.json().course.from).toBe("fr");
  });

  it("keeps what the language is for, and treats skipping as a complete answer", async () => {
    const app = await server(new MemoryLingoStore());
    const skipped = await call(app, "PUT", "/v1/lingo/course", { target: "es", why: "", whyNote: "" });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json().course.why ?? "").toBe("");

    const said = await call(app, "PUT", "/v1/lingo/course", { target: "ja", why: "family", whyNote: "My grandmother speaks it and I never learned." });
    expect(said.json().course).toMatchObject({ why: "family", whyNote: "My grandmother speaks it and I never learned." });
    // A later write that says nothing about it does not wipe what they told us.
    const again = await call(app, "PUT", "/v1/lingo/course", { target: "ja", goalMin: 20 });
    expect(again.json().course).toMatchObject({ why: "family", goalMin: 20 });
    // A code that is not one of ours is not stored.
    const junk = await call(app, "PUT", "/v1/lingo/course", { target: "de", why: "because-i-said-so" });
    expect(junk.statusCode).toBe(200);
    expect(junk.json().course.why ?? "").toBe("");
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
      expect(e.ref).toMatch(/^[0-9a-f]{16}$/);
      // Deliberately not sent: a test cannot read which answer is right either, which is the whole point.
      expect(e.correct).toBeUndefined();
      expect(e.item).toBeUndefined();
    }
  });

  it("fills an empty course from the spine, so a new language is never an empty lesson", async () => {
    const store = new MemoryLingoStore();
    const bank = await bankOf(["hola", "hello"], ["buenos días", "good morning"], ["gracias", "thank you"], ["me gustaría un café", "I would like a coffee"]);
    const app = await server(store, () => T0, bank);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });

    const r = await call(app, "POST", "/v1/lingo/session", { target: "es" });
    expect(r.statusCode).toBe(200);
    expect(r.json().exercises.length, "a brand new course still has a real set").toBeGreaterThan(0);
    const kept = await store.items("u1", "es");
    expect(kept.length).toBeGreaterThan(0);
    // The spine goes in as `seed`, and as whole utterances, because that is what the bank holds.
    expect(kept.every((i) => i.source === "seed")).toBe(true);
    expect(kept.every((i) => i.kind === "phrase")).toBe(true);
  });

  it("puts what they reached for themselves ahead of the spine, always", async () => {
    const store = new MemoryLingoStore();
    // Far more spine than one set can hold, so being in the set means it BEAT the spine rather than fitting beside it.
    const bank = await bankOf(...Array.from({ length: 60 }, (_, i) => [`frase ${i}`, `phrase ${i}`] as [string, string]));
    const app = await server(store, () => T0, bank);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    await call(app, "POST", "/v1/lingo/session", { target: "es" });          // the spine goes in
    await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "terco", gloss: "stubborn", source: "asked" }] });

    const { exercises } = (await call(app, "POST", "/v1/lingo/session", { target: "es" })).json();
    const mine = refOf("u1", "es", "terco");
    expect(exercises.some((e: { ref: string }) => e.ref === mine), "the word they went looking for beat the spine into the set").toBe(true);
  });

  it("does not fall over when the bank is empty, which is how every language starts", async () => {
    const store = new MemoryLingoStore();
    const app = await server(store, () => T0, await bankOf());
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    const r = await call(app, "POST", "/v1/lingo/session", { target: "es" });
    expect(r.statusCode).toBe(200);
    expect(r.json().exercises).toEqual([]);
  });

  it("stops topping up once there is enough to be getting on with", async () => {
    const store = new MemoryLingoStore();
    const bank = await bankOf(...Array.from({ length: 40 }, (_, i) => [`frase ${i}`, `phrase ${i}`] as [string, string]));
    const app = await server(store, () => T0, bank);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    await call(app, "POST", "/v1/lingo/session", { target: "es" });
    const first = (await store.items("u1", "es")).length;
    await call(app, "POST", "/v1/lingo/session", { target: "es" });
    expect((await store.items("u1", "es")).length, "a second look does not pour the bank in again").toBe(first);
  });

  it("times how long they thought, from the gap between answers, and counts how each kind goes", async () => {
    const store = new MemoryLingoStore();
    let clock = T0;
    const app = await server(store, () => clock);
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    await call(app, "POST", "/v1/lingo/words", { target: "es", items: [{ item: "hola", gloss: "hello" }, { item: "adiós", gloss: "bye" }] });
    const ref = refOf("u1", "es", "hola");

    // The first answer has nothing to be measured from, so nothing is claimed about it.
    await call(app, "POST", "/v1/lingo/answer", { target: "es", ref, kind: "choose", picked: 0 });
    expect((await store.items("u1", "es")).find((i) => i.item === "hola")!.memory.thinkMs ?? 0).toBe(0);

    // Four seconds later, on the other word: that gap IS the time they spent on this one.
    clock += 4_000;
    const ref2 = refOf("u1", "es", "adiós");
    await call(app, "POST", "/v1/lingo/answer", { target: "es", ref: ref2, kind: "choose", picked: 0 });
    expect((await store.items("u1", "es")).find((i) => i.item === "adiós")!.memory.thinkMs).toBe(4_000);

    // Then they put the phone down for ten minutes. That is not thinking, and it is thrown away, not capped.
    clock += 600_000;
    await call(app, "POST", "/v1/lingo/answer", { target: "es", ref, kind: "choose", picked: 0 });
    expect((await store.items("u1", "es")).find((i) => i.item === "hola")!.memory.thinkMs ?? 0).toBe(0);

    const course = (await store.course("u1", "es"))!;
    expect(course.tally?.["choose"]?.asked).toBe(3);
    expect(course.lastAnswerMs).toBe(clock);
  });

  it("marks a turn of talk on whether the word came out, not on saying it back", async () => {
    const { app, store } = await start();
    const ref = refOf("u1", "es", "hola");
    // Said inside something of their own: right, and it counts as out loud.
    const good = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref, kind: "talk", said: "pues hola a todos, qué tal" });
    expect(good.statusCode).toBe(200);
    expect(good.json().mark).toMatchObject({ verdict: "right" });
    expect(good.json().spoken).toBe(1);
    // Talked, but never used the word: wrong, and nothing was said out loud.
    const ref2 = refOf("u1", "es", "perro");
    const miss = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref: ref2, kind: "talk", said: "hoy hace mucho calor" });
    expect(miss.json().mark).toMatchObject({ verdict: "wrong" });
    expect(miss.json().spoken).toBe(0);
    expect((await store.items("u1", "es")).find((i) => i.item === "perro")!.spoken).toBe(0);
  });

  it("marks a reply by which one was picked, and the answer is not in what it sent", async () => {
    const { app } = await start();
    const ref = refOf("u1", "es", "hola");
    const wrong = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref, kind: "reply", picked: -1 });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.json().mark).toMatchObject({ verdict: "wrong" });
    // Nothing in a marked answer tells the app which option it should have been.
    expect(JSON.stringify(wrong.json())).not.toContain("correct");
  });

  it("takes every kind it says it takes", async () => {
    const { app } = await start();
    const ref = refOf("u1", "es", "hola");
    for (const kind of EXERCISE_KINDS) {
      const r = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref, kind, said: "hola", picked: 0, chips: ["hola"] });
      expect(r.statusCode, kind).toBe(200);
      expect(r.json().mark.verdict, kind).toBeTruthy();
    }
  });

  it("marks a right answer right, and writes the scheduling back", async () => {
    const { app, store } = await start();
    const { exercises } = (await call(app, "POST", "/v1/lingo/session", { target: "es" })).json();
    // Which exercise is "hola"? By its ref, worked out the way the route does. Its right option is its meaning,
    // which this test knows because it seeded it — not because the payload gave it away.
    const ref = refOf("u1", "es", "hola");
    const hola = exercises.find((e: { ref: string }) => e.ref === ref);
    expect(hola, "hola is in the set").toBeTruthy();
    const picked = (hola.options as string[]).indexOf("hello");
    expect(picked).toBeGreaterThanOrEqual(0);
    const r = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref, kind: "choose", picked });
    expect(r.json().mark).toMatchObject({ verdict: "right" });
    expect(r.json().dueMs).toBeGreaterThan(T0);
    expect(r.json().streakDays).toBe(1);
    const kept = (await store.items("u1", "es")).find((i) => i.item === "hola")!;
    expect(kept.memory.reps).toBe(1);
    expect(kept.memory.state).not.toBe("new");
  });

  it("marks a wrong answer wrong", async () => {
    const { app } = await start();
    const { exercises } = (await call(app, "POST", "/v1/lingo/session", { target: "es" })).json();
    const ref = refOf("u1", "es", "hola");
    const hola = exercises.find((e: { ref: string }) => e.ref === ref);
    const wrong = (hola.options as string[]).findIndex((o) => o !== "hello");
    expect((await call(app, "POST", "/v1/lingo/answer", { target: "es", ref, kind: "choose", wrong })).json().mark)
      .toMatchObject({ verdict: "wrong" });
  });

  it("sends no answer to the client, and takes the word back as an opaque ref", async () => {
    const { app } = await start();
    const r = await call(app, "POST", "/v1/lingo/session", { target: "es" });
    const body = JSON.stringify(r.json());
    // Nothing a client is sent may contain the answer, the accepted answers, or which option is right.
    expect(body).not.toContain('"item"');
    expect(body).not.toContain('"accepted"');
    expect(body).not.toContain('"correct"');
    for (const e of r.json().exercises) {
      expect(e.ref, "every exercise is named by a ref").toMatch(/^[0-9a-f]{16}$/);
    }
    // And the ref is what answers it.
    const first = r.json().exercises[0];
    const ok = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref: first.ref, kind: first.kind, picked: 0 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mark.verdict).toMatch(/right|wrong/);
  });

  it("refuses a ref that is not this person's", async () => {
    const { app } = await start();
    const r = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref: "f".repeat(16), kind: "write", said: "x" });
    expect(r.statusCode).toBe(400);
  });

  it("DOES NOT LET THE APP MARK ITSELF", async () => {
    const { app } = await start();
    const { exercises } = (await call(app, "POST", "/v1/lingo/session", { target: "es" })).json();
    const ref = refOf("u1", "es", "hola");
    const hola = exercises.find((e: { ref: string }) => e.ref === ref);
    const wrong = (hola.options as string[]).findIndex((o) => o !== "hello");
    // Everything an app could send to claim it was right: a verdict, its own accepted answers, which option is
    // right, a count of times said, and the word itself alongside the ref.
    const r = await call(app, "POST", "/v1/lingo/answer", {
      target: "es", ref, item: "hola", kind: "choose", picked: wrong,
      correct: wrong, mark: { verdict: "right" }, verdict: "right", accepted: ["anything"], spoken: 99, learned: true,
    });
    expect(r.json().mark.verdict).toBe("wrong");
    expect(r.json().spoken).toBe(0);
    expect(r.json().learned).toBe(false);
  });

  it("sends no answer to the client at all", async () => {
    const { app } = await start();
    const body = JSON.stringify((await call(app, "POST", "/v1/lingo/session", { target: "es" })).json());
    // Marking on the server is worth nothing if the word is readable in what the server sent.
    for (const leak of ['"item"', '"accepted"', '"correct"']) expect(body, leak).not.toContain(leak);
  });

  it("refuses a ref that is not this person's", async () => {
    const { app } = await start();
    const r = await call(app, "POST", "/v1/lingo/answer", { target: "es", ref: "f".repeat(16), kind: "write", said: "x" });
    expect(r.statusCode).toBe(400);
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

/**
 * THE FIRST LESSON, WHICH NOBODY USED TO GET.
 *
 * The path (src/lingo/course.ts) writes a unit for a pair the first time anybody reaches it, and walking it was the
 * only thing that ever asked for one — from POST /session, which the territory would not open while a course had no
 * words in it. So a new language sat at nothing for ever: no words, so no lesson; no lesson, so no words.
 *
 * Starting the course now starts the unit too, and does NOT wait for it: a model call is seconds, and the screen
 * says what is happening instead of hanging on it.
 */
describe("the first lesson", () => {
  const draft = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ text: `hola ${i}`, meaning: `hello ${i}`, kind: "phrase" as const })) });

  /** A model door that does not answer until it is let go, so the moment mid-build can be looked at. */
  function heldModel(reply: unknown) {
    let open = () => {};
    const gate = new Promise<void>((r) => { open = r; });
    const calls: string[] = [];
    const call = async (input: { messages: Array<{ content: unknown }> }) => {
      calls.push(String(input.messages[input.messages.length - 1]?.content ?? ""));
      await gate;
      // `null` is the model that could not do it: no json, which is what askJson reads as down.
      return reply === null ? { paise: 0, model: "stub" } : { json: reply, paise: 1, model: "stub" };
    };
    return { call: call as never, calls, release: () => open() };
  }

  async function withPath(store: InstanceType<typeof MemoryLingoStore>, model: { call: never }) {
    const app = Fastify();
    registerLingoRoutes(app, {
      rateLimit: {}, bots: {}, store, now: () => T0,
      lessons: new MemoryLessonBank(), bank: new MemorySentenceBank() as never, call: model.call,
    });
    await app.ready();
    return app;
  }

  it("is started as the course is, and the person is not left waiting on the model", async () => {
    const store = new MemoryLingoStore();
    const m = heldModel(draft(8));
    const app = await withPath(store, m);

    // Picking the language answers at once, with the unit still in the air.
    const put = await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    expect(put.statusCode).toBe(200);
    expect(m.calls.length, "the unit is asked for as the course starts").toBe(1);
    expect((await store.items("u1", "es")).length, "and nothing is written before it lands").toBe(0);

    // The set screen they land on a moment later: being made, not "nothing due" and not "nothing to learn yet".
    const waiting = await call(app, "POST", "/v1/lingo/session", { target: "es" });
    expect(waiting.statusCode).toBe(200);
    expect(waiting.json().building).toBe(true);
    expect(waiting.json().exercises).toEqual([]);
    expect(m.calls.length, "and it does not start a second build of the same unit").toBe(1);

    // It lands, and the first unit is theirs, with exercises to ask.
    m.release();
    await vi.waitFor(async () => {
      const s = await call(app, "POST", "/v1/lingo/session", { target: "es" });
      expect(s.json().building).toBeUndefined();
      expect(s.json().exercises.length).toBeGreaterThan(0);
    });
    const mine = await store.items("u1", "es");
    expect(mine.length).toBe(8);
    expect(mine.every((i) => i.unit === "hello"), "the first unit of the path, not loose sentences").toBe(true);
    expect(m.calls.length, "one call for the pair, ever").toBe(1);
  });

  /**
   * THE SCREEN WITH NO BUTTON ON IT only works because it is told. Whichever way the unit went, the person's
   * course topic is published, so the waiting screen reloads: into the first exercise if it landed, into a fresh
   * attempt and then the honest empty if it did not. A screen with nothing to press must never be left waiting on
   * a message that is not coming, so this is NOT only published on success.
   */
  it("tells the waiting screen when the unit has settled, whichever way it went", async () => {
    for (const [what, reply] of [["landed", { items: [{ text: "hola", meaning: "hello", kind: "phrase" }] }], ["failed", null]] as const) {
      const heard: string[] = [];
      const stop = live.subscribe("u1", (e) => heard.push(e.topic));
      const m = heldModel(reply);
      const app = await withPath(new MemoryLingoStore(), m);
      await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
      expect(heard, `${what}: nothing is said while it is still in the air`).toEqual([]);
      m.release();
      await vi.waitFor(() => expect(heard, what).toContain("lingo:es"));
      stop();
    }
  });

  it("does not spend a call again on a course somebody is already on", async () => {
    const store = new MemoryLingoStore();
    const m = heldModel(draft(8));
    const app = await withPath(store, m);
    m.release();
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en" });
    expect(m.calls.length).toBe(1);
    // Changing the minutes a day, or the level, is not a new course.
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en", goalMin: 20 });
    await call(app, "PUT", "/v1/lingo/course", { target: "es", from: "en", level: "a2" });
    expect(m.calls.length, "the unit is written for a pair once and not per setting change").toBe(1);
  });
});

/**
 * THE FRONT DOOR OVER HTTP (src/routes/front.ts): POST /v1/ask with a `message`, the feedback route, and the admin's view of the guards.
 *
 * What these hold down:
 *   - the body is checked (the device, the mode, the visuals preference, the attachments, the last turns) before anything runs;
 *   - off unless FRONT_DOOR: a `message` is then answered 404 front_door_off, and the door is not even made;
 *   - one JSON answer ({ id, decision, result }) or, asked for, a stream that ends with the result;
 *   - a double tap is one run (the second joins it, or is shown its answer), a reused Idempotency-Key for another body is a 409;
 *   - no room is a 429 with Retry-After and the place in the queue, and nothing is run;
 *   - the person's month, the front door's day, and a clarifying question that starts no road;
 *   - feedback is the person's own, and only the outcomes a person can report;
 *   - the admin sees the limiter, the idempotency store, and every breaker.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = "s3cret-admin-value-0123456789abcdef";
});

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

const { registerFrontRoutes, readAsk, MESSAGE_MAX, FRONT_BODY_LIMIT } = await import("../src/routes/front.js");
const { createFront } = await import("../src/front/index.js");
const { MemoryFrontStore } = await import("../src/front/store.js");
const { AttachmentRegistry } = await import("../src/front/attachments.js");
const { Guard } = await import("../src/guard/index.js");
const { getConfig, resetConfigForTests, ENV_KEYS } = await import("../src/config.js");
const { noModel, fakeHandlers, fileInput, sha, PROJECT } = await import("./front-rig.js");
type FrontEvent = import("../src/front/types.js").FrontEvent;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const FACT = "what is the capital of France?";
const BODY = { message: FACT, device: "phone", mode: "text" };

/** A promise to hold a road open until the test lets go. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}

async function served(o: { on?: boolean; handlers?: Parameters<typeof fakeHandlers>[0]; guard?: InstanceType<typeof Guard>; quota?: () => Promise<string | null>; used?: () => Promise<void>; threads?: import("../src/code/chat/threads.js").ThreadStore } = {}) {
  const store = new MemoryFrontStore();
  const guard = o.guard ?? new Guard();
  const h = fakeHandlers(o.handlers);
  const front = o.on === false ? null : createFront({ force: true, handlers: h.handlers, store, guard, call: noModel().call, attachments: new AttachmentRegistry() });
  const app = Fastify({ bodyLimit: FRONT_BODY_LIMIT });
  const routes = registerFrontRoutes(app, { rateLimit: RL, front, guard, ...(o.quota ? { quota: o.quota } : {}), ...(o.used ? { used: o.used } : {}), ...(o.threads ? { threads: o.threads } : {}) });
  // server.ts hands the old route's `message` bodies over like this; the door answers for itself.
  app.post("/v1/ask", async (req, reply) => {
    const { resolveUser } = await import("../src/auth/supabase.js");
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    if (routes.owns(req.body)) return routes.ask(req, reply, user);
    return reply.code(200).send({ legacy: true });
  });
  await app.ready();
  const post = (url: string, user: string | null, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, headers: { ...(user ? who(user) : {}), ...headers }, payload: payload as object });
  const ask = (payload: unknown, user: string | null = "alice", headers: Record<string, string> = {}) => post("/v1/ask", user, payload, headers);
  return { app, store, guard, front, h, post, ask, routes };
}

const lines = (body: string): FrontEvent[] => body.split("\n").filter(Boolean).map((l) => JSON.parse(l) as FrontEvent);

describe("the body", () => {
  it("is read: a message, the device, the mode, and the rest as they are or as they default", () => {
    const ok = readAsk({ ...BODY, visuals: "ask", projectId: PROJECT, recent: [{ said: "hi", did: "said hello" }], visual: "table" });
    expect(ok).toMatchObject({ ok: true, input: { message: FACT, stream: false, ctx: { device: "phone", mode: "text", visuals: "ask", projectId: PROJECT, takeOffer: "table", recent: [{ said: "hi", did: "said hello" }], attachments: [] } } });
    expect(readAsk(BODY)).toMatchObject({ ok: true, input: { ctx: { visuals: "auto" } } });
    expect(readAsk({ ...BODY, stream: true })).toMatchObject({ ok: true, input: { stream: true } });
    // The conversation about a project's code (docs/code-chat.md): an id the app makes.
    const THREAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(readAsk({ ...BODY, projectId: PROJECT, threadId: THREAD })).toMatchObject({ ok: true, input: { ctx: { projectId: PROJECT, threadId: THREAD } } });
    expect((readAsk(BODY) as { input: { ctx: { threadId?: string } } }).input.ctx.threadId).toBeUndefined();
  });

  it("refuses what it cannot make sense of, with the reason, and a message that is too long with 413", () => {
    const refused = (b: unknown) => readAsk(b) as { ok: false; status: number; message: string };
    expect(refused(null).status).toBe(400);
    expect(refused([]).status).toBe(400);
    expect(refused({ ...BODY, message: "   " }).status).toBe(400);
    expect(refused({ ...BODY, message: 42 }).status).toBe(400);
    expect(refused({ ...BODY, message: "x".repeat(MESSAGE_MAX + 1) }).status).toBe(413);
    expect(refused({ ...BODY, device: "fridge" }).message).toContain("phone, desktop, web");
    expect(refused({ message: FACT, mode: "text" }).message).toContain("device");
    expect(refused({ message: FACT, device: "web" }).message).toContain("mode");
    expect(refused({ ...BODY, mode: "shout" }).status).toBe(400);
    expect(refused({ ...BODY, visuals: "always" }).message).toContain("auto, ask, off");
    expect(refused({ ...BODY, visual: "hologram" }).status).toBe(400);
    expect(refused({ ...BODY, projectId: "not-a-project" }).status).toBe(400);
    expect(refused({ ...BODY, threadId: "not-a-thread" }).message).toContain("threadId");
    expect(refused({ ...BODY, threadId: 7 }).status).toBe(400);
    expect(refused({ ...BODY, stream: "yes" }).status).toBe(400);
    expect(refused({ ...BODY, recent: [{ said: "a" }, { said: "b" }, { said: "c" }, { said: "d" }] }).message).toContain("three");
    expect(refused({ ...BODY, recent: [{ said: 3 }] }).status).toBe(400);
  });

  it("reads the attachments: refs, the bytes when they came, at most eight, each with its own id and a checksum", () => {
    const f = fileInput("a.ts", "export const a = 1;\n");
    const body = (over: Record<string, unknown> = {}) => ({ id: f.ref.id, name: f.ref.name, mime: f.ref.mime, bytes: f.ref.bytes, sha256: f.ref.sha256, ...over });
    const withData = readAsk({ ...BODY, attachments: [body({ data: f.data!.toString("base64") })] });
    expect(withData).toMatchObject({ ok: true, input: { ctx: { attachments: [{ id: f.ref.id, kind: "code", sha256: f.ref.sha256 }] } } });
    expect(withData.ok && withData.input.data.get(f.ref.id)?.toString()).toBe("export const a = 1;\n");
    // a repeat of a file already read is only its ref
    const refOnly = readAsk({ ...BODY, attachments: [body()] });
    expect(refOnly.ok && refOnly.input.data.size).toBe(0);
    const refused = (b: unknown) => readAsk({ ...BODY, attachments: b }) as { ok: false; message: string };
    expect(refused(Array.from({ length: 9 }, (_, i) => body({ id: `f${i}` }))).message).toContain("8");
    expect(refused([body(), body()]).message).toContain("own id");
    expect(refused([body({ sha256: "nope" })]).message).toContain("SHA-256");
    expect(refused([body({ data: "***" })]).message).toContain("base64");
    expect(refused("a.ts").message).toContain("list");
  });
});

describe("off unless FRONT_DOOR", () => {
  it("makes no door while the switch is off, and the config has the switch and the day's money", () => {
    resetConfigForTests();
    expect(getConfig()).toMatchObject({ FRONT_DOOR: false, FRONT_DAILY_PAISE: 1500 });
    expect(createFront()).toBeNull();
    for (const k of ["FRONT_DOOR", "FRONT_DAILY_PAISE", "GUARD_GLOBAL_CONCURRENCY", "GUARD_USER_CONCURRENCY", "GUARD_USER_CONCURRENCY_FREE", "GUARD_QUEUE_MAX", "GUARD_QUEUE_PER_USER", "GUARD_QUEUE_WAIT_MS"]) {
      expect(ENV_KEYS).toContain(k);
    }
    expect(getConfig()).toMatchObject({ GUARD_GLOBAL_CONCURRENCY: 64, GUARD_USER_CONCURRENCY: 3, GUARD_USER_CONCURRENCY_FREE: 1 });
    process.env.FRONT_DOOR = "true";
    resetConfigForTests();
    try { expect(createFront({ call: noModel().call })).not.toBeNull(); } finally { delete process.env.FRONT_DOOR; resetConfigForTests(); }
  });

  it("answers a message 404 front_door_off, and the feedback route the same, and runs nothing", async () => {
    const t = await served({ on: false });
    const res = await t.ask(BODY);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "front_door_off" });
    expect((await t.post("/v1/ask/feedback", "alice", { id: "11111111-1111-4111-8111-111111111111", outcome: "thumbs_up" })).statusCode).toBe(404);
    expect(t.h.calls.reply).toHaveLength(0);
  });

  it("leaves the desktop's old ask (a `question`, no `message`) to the old route", async () => {
    const t = await served();
    expect(t.routes.owns({ question: "what is on screen?", screenContent: "x" })).toBe(false);
    expect(t.routes.owns({ question: "q", message: "m" })).toBe(false);
    expect(t.routes.owns({ message: "m" })).toBe(true);
    expect(t.routes.owns(null)).toBe(false);
    const res = await t.ask({ question: "what is on screen?", screenContent: "x" });
    expect(res.json()).toEqual({ legacy: true });
    expect(t.h.calls.reply).toHaveLength(0);
  });
});

describe("POST /v1/ask", () => {
  it("answers { id, decision, result } and writes the decision down without a word of the message", async () => {
    const t = await served();
    const res = await t.ask({ ...BODY, device: "desktop", mode: "text" });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j).toMatchObject({ id: expect.any(String), decision: { intent: "answer", route: "reply" }, result: { text: "A reply.", artifacts: [], offers: [] } });
    expect(t.h.calls.reply[0]).toMatchObject({ userId: "alice", message: FACT, ctx: { device: "desktop", mode: "text", visuals: "auto", userId: "alice" } });
    const rows = await t.store.recent("alice");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: j.id, intent: "answer", route: "reply", outcome: "ok" });
    expect(JSON.stringify(rows)).not.toContain("France");
  });

  it("refuses a bad body before it takes a permit or asks anything", async () => {
    const t = await served();
    const res = await t.ask({ message: FACT });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad_request" });
    expect((await t.ask({ ...BODY, message: "x".repeat(MESSAGE_MAX + 1) })).statusCode).toBe(413);
    expect(t.guard.limiter.stats().active).toBe(0);
    expect(t.h.calls.reply).toHaveLength(0);
  });

  it("takes \"??\" in a project chat as about the chat's last question, which the app does not send: the thread it names says it", async () => {
    const { MemoryThreadStore, newThread, afterTurn } = await import("../src/code/chat/threads.js");
    const threads = new MemoryThreadStore();
    const THREAD = "abababab-abab-4bab-8bab-abababababab";
    await threads.put(afterTurn(newThread("alice", PROJECT, THREAD, 1), { question: "what do you understand of the project", cites: [], located: null, now: 2, answer: "A small app." }));
    const t = await served({ threads });
    const res = await t.ask({ ...BODY, message: "??", projectId: PROJECT, threadId: THREAD });
    expect(res.statusCode).toBe(200);
    expect(t.h.calls.codeAnswer).toHaveLength(1);
    expect(t.h.calls.codeAnswer[0]).toMatchObject({ said: "??", decision: { intent: "code_question", followUp: "what do you understand of the project", language: "en" } });
    expect(t.h.calls.codeAnswer[0]!.decision.reask).toMatch(/simpler/);
    expect(t.h.calls.reply).toHaveLength(0);
  });

  it("keeps every answer in a project chat as one of its turns, whichever road gave it", async () => {
    const { MemoryThreadStore } = await import("../src/code/chat/threads.js");
    const threads = new MemoryThreadStore();
    const THREAD = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    const t = await served({ threads });
    const res = await t.ask({ ...BODY, projectId: PROJECT, threadId: THREAD });
    expect(res.statusCode).toBe(200);
    expect(t.h.calls.reply).toHaveLength(1);
    expect((await threads.get("alice", PROJECT, THREAD))!.history).toEqual([{ q: FACT, a: "A reply.", at: expect.any(Number) }]);
    // Asked with no thread: nothing is kept.
    await t.ask(BODY);
    expect(await threads.list("alice", PROJECT)).toHaveLength(1);
  });

  it("needs a signed-in person", async () => {
    const t = await served();
    expect((await t.ask(BODY, null)).statusCode).toBe(401);
  });

  it("streams when asked, one event a line: the decision first, the result last", async () => {
    const t = await served();
    const res = await t.ask({ ...BODY, stream: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const events = lines(res.body);
    expect(events[0]).toMatchObject({ t: "decision", decision: { route: "reply" } });
    expect(events.at(-1)).toMatchObject({ t: "result", result: { text: "A reply." } });
    expect(events.map((e) => e.t)).toContain("text");
    // the Accept header asks for the same
    const viaHeader = await t.ask({ ...BODY, message: "what is the capital of Spain?" }, "alice", { accept: "application/x-ndjson" });
    expect(viaHeader.headers["content-type"]).toContain("application/x-ndjson");
    expect(lines(viaHeader.body).at(-1)).toMatchObject({ t: "result" });
  });

  it("asks a question and starts no road when it is not sure and the road would cost", async () => {
    const t = await served();
    const res = await t.ask({ ...BODY, message: "make it better", projectId: PROJECT });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.result.clarify?.options.length).toBeGreaterThanOrEqual(2);
    expect(j.result.text).toBeUndefined();
    expect(t.h.calls.reply.length + t.h.calls.codeJob.length + t.h.calls.codeAnswer.length).toBe(0);
  });

  it("takes the person's month and the front door's day into account, in words, before any road", async () => {
    const spent = await served({ quota: async () => "You've used this month's allowance." });
    const q = await spent.ask(BODY);
    expect(q.statusCode).toBe(429);
    expect(q.json()).toMatchObject({ code: "quota_exceeded", message: "You've used this month's allowance." });
    expect(spent.h.calls.reply).toHaveLength(0);

    const guard = new Guard({ dailyPaise: 10 });
    guard.daily.add("alice", 10);
    const day = await served({ guard });
    const d = await day.ask(BODY);
    expect(d.statusCode).toBe(429);
    expect(d.json()).toMatchObject({ code: "daily_limit" });
    expect(day.h.calls.reply).toHaveLength(0);
    // another person's day is their own
    expect((await day.ask(BODY, "bob")).statusCode).toBe(200);
  });

  it("writes the use down after an answer, and a log that fails does not fail the answer", async () => {
    const used = vi.fn(async () => { throw new Error("db down"); });
    const t = await served({ used });
    expect((await t.ask(BODY)).statusCode).toBe(200);
    expect(used).toHaveBeenCalledTimes(1);
  });

  it("says in words when a road cannot do what the decision said, and keeps the failure out of the answer", async () => {
    const t = await served({ handlers: { reply: async () => { throw new Error("secret detail"); } } });
    const res = await t.ask(BODY);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "ask_failed" });
    expect(res.body).not.toContain("secret detail");
    // the failure is not kept: trying again does try again
    expect(t.guard.idempotency.stats().entries).toBe(0);
  });
});

describe("a double tap is one request", () => {
  it("joins the run that is out: one road call, both taps answered, the second marked", async () => {
    const g = gate();
    let ran = 0;
    const t = await served({ handlers: { reply: async () => { ran += 1; await g.opened; return { text: "Paris.", paise: 3 }; } } });
    const first = t.ask(BODY);
    await vi.waitFor(() => expect(t.guard.limiter.stats().active).toBe(1));
    const second = t.ask(BODY);
    await vi.waitFor(() => expect(t.guard.idempotency.stats().joined).toBe(1));
    g.open();
    const [a, b] = await Promise.all([first, second]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(b.headers["idempotent-replayed"] ?? a.headers["idempotent-replayed"]).toBe("true");
    expect(ran).toBe(1);
    expect((await t.store.recent("alice"))).toHaveLength(1);
  });

  it("shows the same answer to a repeat within 30 seconds, for the same person only", async () => {
    const t = await served();
    const a = await t.ask(BODY);
    const b = await t.ask(BODY);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.json()).toEqual(a.json());
    expect(t.h.calls.reply).toHaveLength(1);
    const other = await t.ask(BODY, "bob");
    expect(other.headers["idempotent-replayed"]).toBeUndefined();
    expect(t.h.calls.reply).toHaveLength(2);
  });

  it("gives a joiner of a stream the events the stream had, and the result", async () => {
    const g = gate();
    const t = await served({ handlers: { reply: async () => { await g.opened; return { text: "Paris.", paise: 3 }; } } });
    const first = t.ask({ ...BODY, stream: true });
    await vi.waitFor(() => expect(t.guard.limiter.stats().active).toBe(1));
    const second = t.ask({ ...BODY, stream: true });
    await vi.waitFor(() => expect(t.guard.idempotency.stats().joined).toBe(1));
    g.open();
    const [a, b] = (await Promise.all([first, second])).map((r) => lines(r.body));
    expect(a!.map((e) => e.t)).toEqual(b!.map((e) => e.t));
    expect(a!.at(-1)).toMatchObject({ t: "result", result: { text: "Paris." } });
    expect(b!.at(-1)).toMatchObject({ t: "result", result: { text: "Paris." } });
  });

  it("holds the Idempotency-Key to one request: the same key for another body is a 409, for the same body a repeat", async () => {
    const t = await served();
    const key = { "idempotency-key": "tap-1" };
    const a = await t.ask(BODY, "alice", key);
    expect(a.statusCode).toBe(200);
    const other = await t.ask({ ...BODY, message: "what is the capital of Spain?" }, "alice", key);
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ code: "idempotency_key_reuse" });
    const again = await t.ask(BODY, "alice", key);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(t.h.calls.reply).toHaveLength(1);
    // the key is the person's own: someone else's "tap-1" is not a repeat of it
    expect((await t.ask({ ...BODY, message: "what is the capital of Spain?" }, "bob", key)).statusCode).toBe(200);
  });
});

describe("no room", () => {
  it("answers 429 with Retry-After and the place in the queue, and runs nothing", async () => {
    const g = gate();
    const guard = new Guard({ limiter: { global: 1, perUser: 1, perUserFree: 1, queueMax: 0, queuePerUser: 0 } });
    const t = await served({ guard, handlers: { reply: async () => { await g.opened; return { text: "Paris.", paise: 3 }; } } });
    const first = t.ask(BODY, "alice");
    await vi.waitFor(() => expect(guard.limiter.stats().active).toBe(1));
    const turned = await t.ask({ ...BODY, message: "what is the capital of Spain?" }, "bob");
    expect(turned.statusCode).toBe(429);
    expect(Number(turned.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(turned.json()).toMatchObject({ code: "overloaded", position: expect.any(Number), retryAfterSec: expect.any(Number) });
    // a stream turned away is an ordinary 429 too: nothing had been said
    const turnedStream = await t.ask({ ...BODY, message: "what is the capital of Italy?", stream: true }, "bob");
    expect(turnedStream.statusCode).toBe(429);
    expect(turnedStream.headers["content-type"]).toContain("application/json");
    g.open();
    expect((await first).statusCode).toBe(200);
    // and the permit is back: the same person is served now
    expect((await t.ask({ ...BODY, message: "what is the capital of Spain?" }, "bob")).statusCode).toBe(200);
  });

  it("keeps nothing of a turn-away: once there is room the same request runs", async () => {
    const guard = new Guard({ limiter: { global: 1, perUser: 1, perUserFree: 1, queueMax: 0, queuePerUser: 0 } });
    const t = await served({ guard });
    const held = await guard.limiter.acquire("carol", "paid");
    expect((await t.ask(BODY)).statusCode).toBe(429);
    held.release();
    const ok = await t.ask(BODY);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["idempotent-replayed"]).toBeUndefined();
  });
});

describe("feedback", () => {
  it("records what the person did with an answer, and only for their own", async () => {
    const t = await served();
    const { id } = (await t.ask(BODY)).json();
    expect((await t.post("/v1/ask/feedback", "alice", { id, outcome: "thumbs_down" })).json()).toEqual({ ok: true });
    expect((await t.store.recent("alice"))[0]).toMatchObject({ id, outcome: "thumbs_down" });
    expect((await t.post("/v1/ask/feedback", "bob", { id, outcome: "thumbs_up" })).statusCode).toBe(404);
    expect((await t.store.recent("alice"))[0]!.outcome).toBe("thumbs_down");
    expect((await t.post("/v1/ask/feedback", "alice", { id: "22222222-2222-4222-8222-222222222222", outcome: "thumbs_up" })).statusCode).toBe(404);
  });

  it("takes the outcomes a person can report and no others, and a session", async () => {
    const t = await served();
    const { id } = (await t.ask(BODY)).json();
    for (const outcome of ["visual_closed", "visual_kept", "thumbs_up", "thumbs_down"]) expect((await t.post("/v1/ask/feedback", "alice", { id, outcome })).statusCode).toBe(200);
    for (const outcome of ["ok", "rephrased", "banana", 3, undefined]) expect((await t.post("/v1/ask/feedback", "alice", { id, outcome })).statusCode).toBe(400);
    expect((await t.post("/v1/ask/feedback", "alice", { id: "nope", outcome: "thumbs_up" })).statusCode).toBe(400);
    expect((await t.post("/v1/ask/feedback", null, { id, outcome: "thumbs_up" })).statusCode).toBe(401);
  });
});

describe("the admin's view of the guards", () => {
  it("shows the limiter, the idempotency store, coalescing and the breakers, to the admin only", async () => {
    const t = await served();
    await t.ask(BODY);
    const secret = { "x-admin-secret": "s3cret-admin-value-0123456789abcdef" };
    const ok = await t.app.inject({ method: "GET", url: "/v1/admin/guard", headers: secret });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      frontDoor: true, limiter: { active: 0, queued: 0 }, idempotency: { entries: 1 }, coalescing: expect.any(Object), breakers: expect.any(Array), open: 0,
    });
    expect((await t.app.inject({ method: "GET", url: "/v1/admin/guard" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: "/v1/admin/guard", headers: { "x-admin-secret": "wrong" } })).statusCode).toBe(401);
  });

  it("is there with the front door off: the breakers guard the brain either way", async () => {
    const t = await served({ on: false });
    const res = await t.app.inject({ method: "GET", url: "/v1/admin/guard", headers: { "x-admin-secret": "s3cret-admin-value-0123456789abcdef" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ frontDoor: false, open: 0 });
  });
});

describe("attachments over the route", () => {
  it("reads a text file's bytes once and a follow-up with only its ref, by checksum", async () => {
    const t = await served({ handlers: { reply: async (c) => ({ text: `saw ${c.files.length} file`, paise: 1 }) } });
    const f = fileInput("notes.txt", "The launch is on the ninth of March.\nBudget approved.\n");
    const ref = { id: f.ref.id, name: f.ref.name, mime: f.ref.mime, bytes: f.ref.bytes, sha256: f.ref.sha256 };
    const first = await t.ask({ ...BODY, message: "what does the attached file say about the launch?", attachments: [{ ...ref, data: f.data!.toString("base64") }] });
    expect(first.statusCode).toBe(200);
    expect(first.json().decision.route).toBe("file");
    expect(first.json().result.files).toMatchObject([{ name: "notes.txt", status: "read" }]);
    const again = await t.ask({ ...BODY, message: "and what was the budget decision in that file?", attachments: [ref] });
    expect(again.statusCode).toBe(200);
    expect(again.json().result.files).toMatchObject([{ name: "notes.txt", status: "cached" }]);
    expect(sha(f.data!)).toBe(f.ref.sha256);
  });

  it("says 'coming soon' for a kind it cannot read yet, with no model and no road", async () => {
    const t = await served();
    const pdf = fileInput("report.pdf", "%PDF-1.4 fake");
    const res = await t.ask({
      ...BODY, message: "summarise this pdf",
      attachments: [{ id: pdf.ref.id, name: pdf.ref.name, mime: pdf.ref.mime, bytes: pdf.ref.bytes, sha256: pdf.ref.sha256, data: pdf.data!.toString("base64") }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.files).toMatchObject([{ kind: "pdf", status: "coming_soon" }]);
    expect(res.json().result.text).toMatch(/coming soon/i);
    expect(t.h.calls.reply).toHaveLength(0);
  });
});

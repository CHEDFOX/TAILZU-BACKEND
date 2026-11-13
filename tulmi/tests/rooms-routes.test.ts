/**
 * CALLS OVER HTTP (routes/bots/rooms.ts, and the mail bot's calls in routes/bots/mail.ts): off without calls set up; the host's routes passing
 * their own id and only the checked fields, a bad id or another person's call a 404, the service's refusals in its words; the link's routes
 * public, a code that cannot be one the same 404 as one of no call, a name asked for; LiveKit's webhook taken only signed over the exact
 * bytes it sent as application/webhook+json, and answered as failed when it could not be kept, so LiveKit sends it again. The mail bot makes
 * a call under the business's own name as the worker has it, for its owner, and lists a business's calls; a member who only answers
 * addresses has none, and nobody does while calls are off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

// The bearer is the person's id (a request without one is the dev user).
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => ({ id: h?.replace(/^Bearer\s+/i, "").trim() || "dev-user", email: "someone@example.in" }) };
});

const Fastify = (await import("fastify")).default;
const { registerRoomsRoutes } = await import("../src/routes/bots/rooms.js");
const { registerMailRoutes } = await import("../src/routes/bots/mail.js");
const { MemoryMailOwners } = await import("../src/mail/owners.js");
const { MemoryMailBusinesses, MemoryMailHandlers } = await import("../src/mail/access.js");
const { signLivekit } = await import("../src/rooms/livekit.js");
const { RoomsError } = await import("../src/rooms/types.js");
const { resetConfigForTests } = await import("../src/config.js");

type Service = import("../src/routes/bots/rooms.js").RoomsRoutesService;
type MailRooms = import("../src/routes/bots/mail.js").MailRooms;

const KEYS = { key: "APIx0test", secret: "livekit-test-secret-0123456789abcdef" };
const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const RID = "3f2b8c1e-5a47-4d0e-9b61-0c7d2e8a1f44";
const CODE = "abc-defg-hjk";
const VIEW = { id: RID, title: "Order 1234" };

function fakeService(o: { fail?: boolean; webhookFails?: boolean } = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec = <T>(fn: string, out: T) => async (...args: unknown[]): Promise<T | null> => {
    calls.push({ fn, args });
    if (o.fail) throw new RoomsError(409, "The call is full.", "room_full");
    return args[1] === RID || fn === "knock" || fn === "guest" || fn === "answer" ? out : null;
  };
  const service = {
    room: rec("room", VIEW), set: rec("set", VIEW), join: rec("join", { url: "wss://x", pass: "p" }), admit: rec("admit", VIEW), deny: rec("deny", VIEW),
    remove: rec("remove", VIEW), end: rec("end", VIEW),
    guest: async (code: string) => { calls.push({ fn: "guest", args: [code] }); return code === CODE ? { title: "Order 1234", host: "Leaf & Co", status: "open", lobby: true, full: false } : null; },
    knock: rec("knock", { knock: "k".repeat(24), state: "waiting" }),
    answer: async (code: string, key: string) => { calls.push({ fn: "answer", args: [code, key] }); return { knock: key, state: "waiting" }; },
    onWebhook: async (body: unknown) => { calls.push({ fn: "onWebhook", args: [body] }); if (o.webhookFails) throw new Error("db down"); },
  } as unknown as Service;
  return { calls, service };
}

async function app(o: { service?: Service | null; fake?: ReturnType<typeof fakeService> } = {}) {
  const a = Fastify();
  const fake = o.fake ?? fakeService();
  registerRoomsRoutes(a, { rateLimit: {}, service: o.service !== undefined ? o.service : fake.service, keys: KEYS, now: () => NOW, nameOf: async () => "Aanya" });
  await a.ready();
  return { a, calls: fake.calls };
}

describe("the host's routes", () => {
  it("are off without calls set up", async () => {
    const { a } = await app({ service: null });
    for (const [method, url] of [["GET", `/v1/rooms/${RID}`], ["GET", `/v1/rooms/guest/${CODE}`], ["POST", "/v1/rooms/livekit"]] as const) {
      expect((await a.inject({ method, url })).json()).toMatchObject({ code: "rooms_off" });
    }
  });

  it("pass the person's own id and only the checked fields", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: `/v1/rooms/${RID}`, headers: { authorization: "Bearer aanya" } })).json()).toEqual({ room: VIEW });
    await a.inject({ method: "PUT", url: `/v1/rooms/${RID}`, payload: { lobby: false, title: "New", people: [] } });
    const joined = await a.inject({ method: "POST", url: `/v1/rooms/${RID}/join` });
    expect(joined.json()).toEqual({ url: "wss://x", pass: "p" });
    expect(joined.headers["cache-control"]).toBe("no-store");
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/admit`, payload: { knock: "abcdefghij12" } });
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/deny`, payload: { knock: "abcdefghij12" } });
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/remove`, payload: { identity: "g_abc" } });
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/end` });
    expect(calls.map((c) => [c.fn, ...c.args])).toEqual([
      ["room", "aanya", RID],
      ["set", "dev-user", RID, { lobby: false, title: "New" }],
      ["join", "dev-user", RID, "Aanya"],
      ["admit", "dev-user", RID, "abcdefghij12"],
      ["deny", "dev-user", RID, "abcdefghij12"],
      ["remove", "dev-user", RID, "g_abc"],
      ["end", "dev-user", RID],
    ]);
  });

  it("refuse a bad id, a bad body, and another person's call before or as the service answers", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/rooms/not-a-room" })).statusCode).toBe(404);
    expect((await a.inject({ method: "PUT", url: `/v1/rooms/${RID}`, payload: { lobby: "no" } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: `/v1/rooms/${RID}/admit`, payload: { knock: "x" } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: `/v1/rooms/${RID}/remove`, payload: { identity: "a b" } })).statusCode).toBe(400);
    expect(calls).toEqual([]);
    const other = "11111111-2222-4333-8444-555555555555";
    expect((await a.inject({ method: "GET", url: `/v1/rooms/${other}` })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: `/v1/rooms/${other}/join` })).statusCode).toBe(404);
  });

  it("say the service's refusals in its words", async () => {
    const { a } = await app({ fake: fakeService({ fail: true }) });
    const r = await a.inject({ method: "POST", url: `/v1/rooms/${RID}/admit`, payload: { knock: "abcdefghij12" } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: "room_full", message: "The call is full." });
  });
});

describe("the link's routes", () => {
  it("show the call, take a knock with a name, and give its answer", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: `/v1/rooms/guest/${CODE.toUpperCase()}` })).json()).toMatchObject({ room: { host: "Leaf & Co" } });
    const k = await a.inject({ method: "POST", url: `/v1/rooms/guest/${CODE}/knock`, payload: { name: "Ravi" } });
    expect(k.statusCode).toBe(201);
    expect((await a.inject({ method: "GET", url: `/v1/rooms/guest/${CODE}/knock/${"k".repeat(24)}` })).json()).toMatchObject({ state: "waiting" });
    expect(calls.map((c) => [c.fn, ...c.args])).toEqual([["guest", CODE], ["knock", CODE, "Ravi"], ["answer", CODE, "k".repeat(24)]]);
  });

  it("answer a code that cannot be one as one of no call, and ask for a name", async () => {
    const { a, calls } = await app();
    const bad = await a.inject({ method: "GET", url: "/v1/rooms/guest/..%2F..%2Fetc" });
    expect(bad.statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/v1/rooms/guest/zzz-zzzz-zzz" })).json()).toMatchObject({ code: "not_found" });
    expect((await a.inject({ method: "POST", url: `/v1/rooms/guest/${CODE}/knock`, payload: { name: "  " } })).statusCode).toBe(400);
    expect((await a.inject({ method: "GET", url: `/v1/rooms/guest/${CODE}/knock/x` })).json()).toEqual({ knock: "x", state: "gone" });
    expect(calls.map((c) => c.fn)).toEqual(["guest"]);
  });
});

describe("LiveKit's webhook", () => {
  const body = JSON.stringify({ event: "participant_joined", id: "EV1", room: { name: `x0-${RID}` }, participant: { identity: "g_abc" } });
  const post = (auth: string | undefined, payload = body) => ({
    method: "POST" as const, url: "/v1/rooms/livekit", payload,
    headers: { "content-type": "application/webhook+json", ...(auth ? { authorization: auth } : {}) },
  });

  it("is taken signed over the exact bytes", async () => {
    const { a, calls } = await app();
    const r = await a.inject(post(signLivekit(body, KEYS, Math.floor(NOW / 1000))));
    expect(r.statusCode).toBe(200);
    expect(calls).toEqual([{ fn: "onWebhook", args: [JSON.parse(body)] }]);
  });

  it("is taken as plain JSON too, checked over the bytes as sent", async () => {
    const { registerRequestHooks } = await import("../src/http/hooks.js");
    const a = Fastify();
    registerRequestHooks(a);
    const fake = fakeService();
    registerRoomsRoutes(a, { rateLimit: {}, service: fake.service, keys: KEYS, now: () => NOW });
    await a.ready();
    // Spaced as LiveKit might send it: re-serialised, it would not match the signature.
    const spaced = body.replace(/,/g, ", ");
    const r = await a.inject({ method: "POST", url: "/v1/rooms/livekit", payload: spaced, headers: { "content-type": "application/json", authorization: signLivekit(spaced, KEYS, Math.floor(NOW / 1000)) } });
    expect(r.statusCode).toBe(200);
    expect(fake.calls.map((c) => c.fn)).toEqual(["onWebhook"]);
  });

  it("is refused unsigned, or signed for other bytes", async () => {
    const { a, calls } = await app();
    expect((await a.inject(post(undefined))).statusCode).toBe(401);
    expect((await a.inject(post(signLivekit(body, KEYS, Math.floor(NOW / 1000)), body.replace("g_abc", "h_me")))).statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  it("is answered as failed when it could not be kept, so LiveKit sends it again", async () => {
    const { a } = await app({ fake: fakeService({ webhookFails: true }) });
    expect((await a.inject(post(signLivekit(body, KEYS, Math.floor(NOW / 1000))))).statusCode).toBe(500);
  });
});

describe("the mail bot's calls", () => {
  const SECRET = "mail-secret-0123456789abcdef0123456789";
  const ON = { MAIL_WORKER_URL: "http://mail-worker:5300", MAIL_WORKER_SECRET: SECRET };
  afterEach(() => { for (const k of Object.keys(ON)) delete process.env[k]; resetConfigForTests(); });

  /** Aanya is the admin of a space where Ravi agreed to the line about her; Ravi is the admin of one where Sam did. */
  const people = {
    async membersOf(adminId: string) {
      return ({ aanya: [{ userId: "ravi", name: "Ravi", spaceId: "s1" }], ravi: [{ userId: "sam", name: "Sam", spaceId: "s2" }] } as Record<string, Array<{ userId: string; name: string; spaceId: string }>>)[adminId] ?? [];
    },
    async adminsOf() { return []; },
  };

  async function mailApp(o: { rooms?: MailRooms | null; space?: boolean } = {}) {
    Object.assign(process.env, ON); resetConfigForTests();
    const a = Fastify();
    const made: Array<{ userId: string; input: unknown }> = [];
    const listed: Array<{ userId: string; o: unknown }> = [];
    const rooms: MailRooms = {
      make: async (userId, input) => { made.push({ userId, input }); return { id: RID, title: "A call with Leaf & Co" } as never; },
      list: async (userId, q) => { listed.push({ userId, o: q }); return [] as never; },
    };
    const worker = {
      async call<T>(_owner: string, method: string, path: string) {
        return (method === "GET" && path === "/businesses/leaf-co" ? { business: { id: "leaf-co", name: "Leaf & Co", domain: "leafandco.in" } } : { ok: true }) as T;
      },
    };
    const businesses = new MemoryMailBusinesses();
    const handlers = new MemoryMailHandlers();
    if (o.space) {
      await businesses.keep("leaf-co", "ravi");
      await handlers.give({ businessId: "leaf-co", ownerId: "ravi", addressId: 2, addressEmail: "support@leafandco.in", memberId: "sam" });
    }
    registerMailRoutes(a, {
      rateLimit: {}, bots: {}, worker, owners: new MemoryMailOwners(), secret: SECRET, now: () => NOW, businesses, handlers,
      ...(o.space ? { people } : {}), rooms: o.rooms !== undefined ? o.rooms : rooms,
    });
    await a.ready();
    return { a, made, listed };
  }

  it("makes a call under the business's own name, for its owner, and lists the business's calls", async () => {
    const { a, made, listed } = await mailApp();
    const r = await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/calls", payload: { title: "Order 1234", host: "Google" } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ call: { id: RID, title: "A call with Leaf & Co" } });
    expect(made).toEqual([{ userId: "dev-user", input: { title: "Order 1234", host: "Leaf & Co", businessId: "leaf-co" } }]);
    expect((await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/calls" })).json()).toEqual({ calls: [] });
    expect(listed).toEqual([{ userId: "dev-user", o: { businessId: "leaf-co" } }]);
  });

  it("is for its owner and their space's admin, never for a member who only answers addresses", async () => {
    const { a, made } = await mailApp({ space: true });
    const as = (who: string) => ({ authorization: `Bearer ${who}` });
    expect((await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/calls", headers: as("sam") })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/calls", headers: as("sam") })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/calls", headers: as("ravi") })).statusCode).toBe(201);
    expect((await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/calls", headers: as("aanya") })).statusCode).toBe(201);
    expect(made.map((m) => m.userId)).toEqual(["ravi", "aanya"]);
  });

  it("has none while calls are off, and refuses a bad id or title", async () => {
    const off = await mailApp({ rooms: null });
    expect((await off.a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/calls" })).json()).toMatchObject({ code: "rooms_off" });
    const { a, made } = await mailApp();
    expect((await a.inject({ method: "POST", url: "/v1/mail/businesses/Leaf_Co!/calls" })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/calls", payload: { title: 5 } })).statusCode).toBe(400);
    expect(made).toEqual([]);
  });
});

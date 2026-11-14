/**
 * CALLS OVER HTTP (routes/bots/rooms.ts, and the mail bot's calls in routes/bots/mail.ts): off without calls set up; the host's routes
 * passing their own id and only the checked fields, a bad id or another person's call a 404, the service's refusals in its words; the
 * link's routes public, a code that cannot be one the same 404 as one of no call, a name asked for; the seat routes taking the seat as
 * their one credential, and refusing anything that is not one before the service hears of it; an offer checked (its SDP, its mids) before
 * it is sent on. The mail bot makes a call under the business's own name, for its owner and their space's admin, never for a member who
 * only answers addresses.
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
const { RoomsError } = await import("../src/rooms/types.js");
const { resetConfigForTests } = await import("../src/config.js");

type Service = import("../src/routes/bots/rooms.js").RoomsRoutesService;
type MailRooms = import("../src/routes/bots/mail.js").MailRooms;

const RID = "3f2b8c1e-5a47-4d0e-9b61-0c7d2e8a1f44";
const CODE = "abc-defg-hjk";
const SEAT = `${RID}.AAAABBBBCCCCDDDDEEEE`;
const VIEW = { id: RID, title: "Order 1234" };
const OFFER = { sdp: "v=0 OFFER", audioMid: "0", videoMid: "1" };

function fakeService(o: { fail?: boolean } = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec = <T>(fn: string, out: T) => async (...args: unknown[]): Promise<T | null> => {
    calls.push({ fn, args });
    if (o.fail) throw new RoomsError(409, "The call is full.", "room_full");
    return args[1] === RID || fn.startsWith("knock") || ["guest", "pull", "answer", "live", "leave", "joinAsGuest"].includes(fn) ? out : null;
  };
  const service = {
    room: rec("room", VIEW), set: rec("set", VIEW), admit: rec("admit", VIEW), deny: rec("deny", VIEW), remove: rec("remove", VIEW), end: rec("end", VIEW),
    join: rec("join", { seat: SEAT, answer: "ANSWER", identity: "h_1", people: [] }),
    joinAsGuest: rec("joinAsGuest", { seat: SEAT, answer: "ANSWER", identity: "g_1", people: [] }),
    guest: async (code: string) => { calls.push({ fn: "guest", args: [code] }); return code === CODE ? { title: "Order 1234", host: "Leaf & Co", status: "open", lobby: true, full: false } : null; },
    knock: rec("knock", { knock: "k".repeat(24), state: "waiting" }),
    knockAnswer: async (code: string, key: string) => { calls.push({ fn: "knockAnswer", args: [code, key] }); return { knock: key, state: "waiting" }; },
    pull: rec("pull", { offer: "THEIR-OFFER", mustAnswer: true, tracks: [] }),
    answer: rec("answer", undefined),
    live: rec("live", { status: "live", people: [] }),
    leave: rec("leave", undefined),
  } as unknown as Service;
  return { calls, service };
}

async function app(o: { service?: Service | null; fake?: ReturnType<typeof fakeService> } = {}) {
  const a = Fastify();
  const fake = o.fake ?? fakeService();
  registerRoomsRoutes(a, { rateLimit: {}, service: o.service !== undefined ? o.service : fake.service, nameOf: async () => "Aanya" });
  await a.ready();
  return { a, calls: fake.calls };
}

describe("the host's routes", () => {
  it("are off without calls set up", async () => {
    const { a } = await app({ service: null });
    for (const [method, url] of [["GET", `/v1/rooms/${RID}`], ["GET", `/v1/rooms/guest/${CODE}`]] as const) {
      expect((await a.inject({ method, url })).json()).toMatchObject({ code: "rooms_off" });
    }
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/live", payload: { seat: SEAT } })).json()).toMatchObject({ code: "rooms_off" });
  });

  it("pass the person's own id and only the checked fields", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: `/v1/rooms/${RID}`, headers: { authorization: "Bearer aanya" } })).json()).toEqual({ room: VIEW });
    await a.inject({ method: "PUT", url: `/v1/rooms/${RID}`, payload: { lobby: false, title: "New", people: [] } });
    const joined = await a.inject({ method: "POST", url: `/v1/rooms/${RID}/join`, payload: { ...OFFER, name: "Someone Else" } });
    expect(joined.statusCode).toBe(201);
    expect(joined.json()).toMatchObject({ seat: SEAT, answer: "ANSWER" });
    expect(joined.headers["cache-control"]).toBe("no-store");
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/admit`, payload: { knock: "abcdefghij12" } });
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/deny`, payload: { knock: "abcdefghij12" } });
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/remove`, payload: { identity: "g_abc" } });
    await a.inject({ method: "POST", url: `/v1/rooms/${RID}/end` });
    expect(calls.map((c) => [c.fn, ...c.args])).toEqual([
      ["room", "aanya", RID],
      ["set", "dev-user", RID, { lobby: false, title: "New" }],
      // The name is the person's own profile's, never what the body asked for.
      ["join", "dev-user", RID, { sdp: "v=0 OFFER", audioMid: "0", videoMid: "1", name: "Aanya" }],
      ["admit", "dev-user", RID, "abcdefghij12"],
      ["deny", "dev-user", RID, "abcdefghij12"],
      ["remove", "dev-user", RID, "g_abc"],
      ["end", "dev-user", RID],
    ]);
  });

  it("refuse a bad id, a bad body and a bad offer before the service hears of it", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/rooms/not-a-room" })).statusCode).toBe(404);
    expect((await a.inject({ method: "PUT", url: `/v1/rooms/${RID}`, payload: { lobby: "no" } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: `/v1/rooms/${RID}/admit`, payload: { knock: "x" } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: `/v1/rooms/${RID}/remove`, payload: { identity: "a b" } })).statusCode).toBe(400);
    // An offer with no SDP, no mid, a mid that cannot be one, or an SDP too big to be one.
    for (const body of [{}, { sdp: "x" }, { sdp: "x", audioMid: "a b" }, { ...OFFER, videoMid: "!!" }, { sdp: "x".repeat(70_000), audioMid: "0" }]) {
      expect((await a.inject({ method: "POST", url: `/v1/rooms/${RID}/join`, payload: body })).statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
    const other = "11111111-2222-4333-8444-555555555555";
    expect((await a.inject({ method: "GET", url: `/v1/rooms/${other}` })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: `/v1/rooms/${other}/join`, payload: OFFER })).statusCode).toBe(404);
  });

  it("say the service's refusals in its words", async () => {
    const { a } = await app({ fake: fakeService({ fail: true }) });
    const r = await a.inject({ method: "POST", url: `/v1/rooms/${RID}/admit`, payload: { knock: "abcdefghij12" } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: "room_full", message: "The call is full." });
  });
});

describe("the link's routes", () => {
  it("show the call, take a knock, give its answer, and seat a guest that was let in", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: `/v1/rooms/guest/${CODE.toUpperCase()}` })).json()).toMatchObject({ room: { host: "Leaf & Co" } });
    expect((await a.inject({ method: "POST", url: `/v1/rooms/guest/${CODE}/knock`, payload: { name: "Ravi" } })).statusCode).toBe(201);
    expect((await a.inject({ method: "GET", url: `/v1/rooms/guest/${CODE}/knock/${"k".repeat(24)}` })).json()).toMatchObject({ state: "waiting" });
    const seated = await a.inject({ method: "POST", url: `/v1/rooms/guest/${CODE}/join`, payload: { knock: "k".repeat(24), ...OFFER } });
    expect(seated.statusCode).toBe(201);
    expect(seated.json()).toMatchObject({ seat: SEAT });
    expect(calls.map((c) => [c.fn, ...c.args])).toEqual([
      ["guest", CODE], ["knock", CODE, "Ravi"], ["knockAnswer", CODE, "k".repeat(24)],
      ["joinAsGuest", CODE, "k".repeat(24), { sdp: "v=0 OFFER", audioMid: "0", videoMid: "1" }],
    ]);
  });

  it("answer a code that cannot be one as one of no call, and ask for a name and a knock", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/rooms/guest/..%2F..%2Fetc" })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/v1/rooms/guest/zzz-zzzz-zzz" })).json()).toMatchObject({ code: "not_found" });
    expect((await a.inject({ method: "POST", url: `/v1/rooms/guest/${CODE}/knock`, payload: { name: "  " } })).statusCode).toBe(400);
    expect((await a.inject({ method: "GET", url: `/v1/rooms/guest/${CODE}/knock/x` })).json()).toEqual({ knock: "x", state: "gone" });
    // A guest cannot seat themselves without the knock they were let in on.
    expect((await a.inject({ method: "POST", url: `/v1/rooms/guest/${CODE}/join`, payload: OFFER })).statusCode).toBe(400);
    expect(calls.map((c) => c.fn)).toEqual(["guest"]);
  });
});

describe("the seat's routes", () => {
  it("take the seat as their one credential", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/pull", payload: { seat: SEAT, want: [{ identity: "g_1", kind: "audio" }] } })).json())
      .toMatchObject({ offer: "THEIR-OFFER", mustAnswer: true });
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/answer", payload: { seat: SEAT, sdp: "MY-ANSWER" } })).json()).toEqual({ ok: true });
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/live", payload: { seat: SEAT, video: false } })).json()).toMatchObject({ status: "live" });
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/leave", payload: { seat: SEAT } })).json()).toEqual({ ok: true });
    expect(calls.map((c) => [c.fn, ...c.args])).toEqual([
      ["pull", SEAT, [{ identity: "g_1", kind: "audio" }]],
      ["answer", SEAT, "MY-ANSWER"],
      ["live", SEAT, { video: false }],
      ["leave", SEAT],
    ]);
  });

  it("refuse anything that is not a seat, and a body that is not one, before the service hears of it", async () => {
    const { a, calls } = await app();
    for (const seat of [undefined, "", "not-a-seat", `${RID}.short`, `${RID}.${"x".repeat(80)}`]) {
      const r = await a.inject({ method: "POST", url: "/v1/rooms/seat/live", payload: seat === undefined ? {} : { seat } });
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ code: "not_found" });
    }
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/pull", payload: { seat: SEAT, want: [{ identity: "a b", kind: "audio" }] } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/pull", payload: { seat: SEAT, want: [{ identity: "g_1", kind: "screen" }] } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/answer", payload: { seat: SEAT } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: "/v1/rooms/seat/live", payload: { seat: SEAT, audio: "yes" } })).statusCode).toBe(400);
    expect(calls).toEqual([]);
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
      rateLimit: {}, bots: {}, worker, owners: new MemoryMailOwners(), secret: SECRET, now: () => Date.UTC(2026, 10, 14), businesses, handlers,
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

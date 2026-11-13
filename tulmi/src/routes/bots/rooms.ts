/**
 * CALLS' ROUTES (src/rooms, docs/rooms.md): the host's call, the link's way in, and LiveKit's webhook. The mail bot's calls are made and listed
 * by its own routes (routes/bots/mail.ts, under the business they are for); everything after is here.
 *
 *   GET    /v1/rooms/:id                       the host's: one call, who is in it, who waits at its door
 *   PUT    /v1/rooms/:id                       { lobby?, title? }: the lobby turned off lets in whoever waits
 *   POST   /v1/rooms/:id/join                  a host's pass for the app's call screen: { url, pass, identity, name, room, host, expiresAt }
 *   POST   /v1/rooms/:id/admit                 { knock }: someone at the door let in
 *   POST   /v1/rooms/:id/deny                  { knock }: not let in
 *   POST   /v1/rooms/:id/remove                { identity }: someone sent away from the call
 *   POST   /v1/rooms/:id/end                   ended for everyone; the link stops working
 *
 *   GET    /v1/rooms/guest/:code               THE LINK'S, for anyone holding it: whose call, its title, whether it is on and full
 *   POST   /v1/rooms/guest/:code/knock         { name }: asks to come in -> { knock, state } (with a pass when the lobby is off)
 *   GET    /v1/rooms/guest/:code/knock/:key    the answer: waiting, admitted (with a pass), denied, gone
 *
 *   POST   /v1/rooms/livekit                   LIVEKIT'S, signed with the API secret over the exact bytes: who joins and leaves, a room closed
 *
 * The host's routes are theirs alone (a call that is not theirs is 404). The link's are public, and as tight as a person's own pace: a code
 * that cannot be one, or one of no call, is the same 404. Without calls set up (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) every route
 * is 404 { code: "rooms_off" }. Nothing a person typed is logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { getProfile } from "../../profile/store.js";
import { codeOf } from "../../rooms/link.js";
import { livekitKeys, verifyLivekit, type LivekitKeys } from "../../rooms/livekit.js";
import type { GuestRoomView, KnockAnswer, PassView, RoomView } from "../../rooms/types.js";

/** What the routes need of src/rooms/service.ts's RoomService. */
export interface RoomsRoutesService {
  room(userId: string, id: string): Promise<RoomView | null>;
  set(userId: string, id: string, patch: { lobby?: boolean; title?: unknown }): Promise<RoomView | null>;
  join(userId: string, id: string, name?: string): Promise<PassView | null>;
  admit(userId: string, id: string, knock: string): Promise<RoomView | null>;
  deny(userId: string, id: string, knock: string): Promise<RoomView | null>;
  remove(userId: string, id: string, identity: string): Promise<RoomView | null>;
  end(userId: string, id: string): Promise<RoomView | null>;
  guest(code: string): Promise<GuestRoomView | null>;
  knock(code: string, name: unknown): Promise<KnockAnswer | null>;
  answer(code: string, key: string): Promise<KnockAnswer>;
  onWebhook(body: unknown): Promise<void>;
}

export interface RoomsRouteDeps {
  rateLimit: unknown;
  /** The server's own when not given; null: calls are not set up. */
  service?: RoomsRoutesService | null;
  /** LiveKit's keys, for its webhook's signature (the server's when not given). */
  keys?: Pick<LivekitKeys, "key" | "secret"> | null;
  /** The person's first name, their name in their own calls (their profile's when not given). */
  nameOf?: (user: AuthedUser) => Promise<string>;
  now?: () => number;
}

const BASE = "/v1/rooms";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOCK = /^[A-Za-z0-9_-]{8,40}$/;
const IDENTITY = /^[A-Za-z0-9_-]{1,80}$/;
const BODY_MAX = 64 * 1024;
const WEBHOOK_TYPE = "application/webhook+json";
/** The link's routes, per address: a page asks for its answer every two or three seconds while it waits. */
const GUEST_RL = {
  look: { max: 30, timeWindow: 60_000 },
  knock: { max: 10, timeWindow: 60_000 },
  answer: { max: 60, timeWindow: 60_000 },
} as const;

type Raw = { rawBody?: string };

export function registerRoomsRoutes(app: FastifyInstance, deps: RoomsRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const guestRl = (k: keyof typeof GUEST_RL) => ({ config: { rateLimit: GUEST_RL[k] } as never });
  // The server's own service is loaded when first asked for, so a test with its own never pulls in LiveKit's client.
  const service = async (): Promise<RoomsRoutesService | null> => {
    if (deps.service !== undefined) return deps.service;
    return (await import("../../rooms/service.js")).roomService() as RoomsRoutesService | null;
  };
  const keys = () => (deps.keys !== undefined ? deps.keys : livekitKeys());
  const now = deps.now ?? Date.now;
  const nameOf = deps.nameOf ?? firstNameOf;
  const off = (reply: FastifyReply) => reply.code(404).send({ code: "rooms_off", message: "Calls are not switched on." });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ code: "not_found", message: "Not found." });
  const noCall = (reply: FastifyReply) => reply.code(404).send({ code: "not_found", message: "This link isn't a call. Check it and try again." });
  const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ code: "bad_request", message });
  const send = (reply: FastifyReply, body: unknown, status = 200) => reply.header("cache-control", "no-store").code(status).send(body);

  /** A RoomsError (status, message, code), by duck typing; anything else is the server's to report. */
  const fail = (reply: FastifyReply, err: unknown) => {
    const e = err as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof e?.status === "number" && e.status >= 400 && e.status < 600 && typeof e.code === "string") {
      return reply.code(e.status).send({ code: e.code, message: String(e.message ?? "") });
    }
    throw err;
  };

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; s: RoomsRoutesService; id: string } | null> => {
    const s = await service();
    if (!s) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    const id = (req.params as { id?: string }).id ?? "";
    if (!UUID.test(id)) { notFound(reply); return null; }
    return { user, s, id };
  };
  const bodyOf = (req: FastifyRequest): Record<string, unknown> => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  /** A host's answer: the call, or 404 when it is not theirs. */
  const room = (reply: FastifyReply, r: RoomView | null) => (r ? send(reply, { room: r }) : notFound(reply));

  // ------------------------------------------------------------------ the host's

  app.get(`${BASE}/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { return room(reply, await got.s.room(got.user.id, got.id)); } catch (err) { return fail(reply, err); }
  });

  app.put(`${BASE}/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const b = bodyOf(req);
    if (b.lobby !== undefined && typeof b.lobby !== "boolean") return bad(reply, "lobby is true or false.");
    if (b.title !== undefined && (typeof b.title !== "string" || b.title.length > 200)) return bad(reply, "The title is too long.");
    const patch: { lobby?: boolean; title?: unknown } = {};
    if (typeof b.lobby === "boolean") patch.lobby = b.lobby;
    if (typeof b.title === "string") patch.title = b.title;
    try { return room(reply, await got.s.set(got.user.id, got.id, patch)); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/:id/join`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try {
      const name = await nameOf(got.user).catch(() => "");
      const pass = await got.s.join(got.user.id, got.id, name || undefined);
      return pass ? send(reply, pass) : notFound(reply);
    } catch (err) { return fail(reply, err); }
  });

  for (const [verb, field, re] of [["admit", "knock", KNOCK], ["deny", "knock", KNOCK], ["remove", "identity", IDENTITY]] as const) {
    app.post(`${BASE}/:id/${verb}`, rl, async (req, reply) => {
      const got = await begin(req, reply);
      if (!got) return reply;
      const v = bodyOf(req)[field];
      if (typeof v !== "string" || !re.test(v)) return bad(reply, field === "knock" ? "Say who to let in." : "Say who to send away.");
      try { return room(reply, await got.s[verb](got.user.id, got.id, v)); } catch (err) { return fail(reply, err); }
    });
  }

  app.post(`${BASE}/:id/end`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { return room(reply, await got.s.end(got.user.id, got.id)); } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------------ the link's

  const guestBegin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ s: RoomsRoutesService; code: string } | null> => {
    const s = await service();
    if (!s) { off(reply); return null; }
    const code = codeOf((req.params as { code?: string }).code);
    if (!code) { noCall(reply); return null; }
    return { s, code };
  };

  app.get(`${BASE}/guest/:code`, guestRl("look"), async (req, reply) => {
    const got = await guestBegin(req, reply);
    if (!got) return reply;
    try {
      const r = await got.s.guest(got.code);
      return r ? send(reply, { room: r }) : noCall(reply);
    } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/guest/:code/knock`, guestRl("knock"), async (req, reply) => {
    const got = await guestBegin(req, reply);
    if (!got) return reply;
    const name = bodyOf(req).name;
    if (typeof name !== "string" || !name.trim() || name.length > 200) return bad(reply, "Type your name, so they know who is asking to join.");
    try {
      const out = await got.s.knock(got.code, name);
      return out ? send(reply, out, 201) : noCall(reply);
    } catch (err) { return fail(reply, err); }
  });

  app.get(`${BASE}/guest/:code/knock/:key`, guestRl("answer"), async (req, reply) => {
    const got = await guestBegin(req, reply);
    if (!got) return reply;
    const key = (req.params as { key?: string }).key ?? "";
    if (!KNOCK.test(key)) return send(reply, { knock: key.slice(0, 40), state: "gone" });
    try { return send(reply, await got.s.answer(got.code, key)); } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------------ LiveKit's

  // LiveKit sends its webhook as application/webhook+json, signed over the exact bytes: they are kept as they came, and read in the handler.
  if (!app.hasContentTypeParser(WEBHOOK_TYPE)) {
    app.addContentTypeParser(WEBHOOK_TYPE, { parseAs: "string", bodyLimit: BODY_MAX }, (req, body, done) => {
      (req as unknown as Raw).rawBody = typeof body === "string" ? body : "";
      done(null, {});
    });
  }

  app.post(`${BASE}/livekit`, { config: { rateLimit: { max: 600, timeWindow: 60_000 } } as never, bodyLimit: BODY_MAX }, async (req, reply) => {
    const s = await service();
    const k = keys();
    if (!s || !k) return off(reply);
    const raw = (req as unknown as Raw).rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    const auth = req.headers["authorization"];
    if (!verifyLivekit(Array.isArray(auth) ? auth[0] : auth, raw, k, Math.floor(now() / 1000))) {
      return reply.code(401).send({ code: "auth", message: "Not signed." });
    }
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return bad(reply, "Not JSON."); }
    try {
      await s.onWebhook(json);
    } catch (err) {
      // Answered as failed, so LiveKit sends it again.
      req.log.error({ err: (err as Error)?.message }, "rooms: a LiveKit event failed");
      return reply.code(500).send({ code: "failed", message: "Try again." });
    }
    return reply.send({ ok: true });
  });
}

/** The person's first name, from their profile ("" when there is none). */
async function firstNameOf(user: AuthedUser): Promise<string> {
  const p = await getProfile(user);
  return (p.fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

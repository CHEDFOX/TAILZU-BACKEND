/**
 * CALLS' ROUTES (src/rooms, docs/rooms.md): the host's call, the link's way in, and the signalling every person in a call does. The mail
 * bot's calls are made and listed by its own routes (routes/bots/mail.ts, under the business they are for); everything after is here.
 *
 *   GET    /v1/rooms/:id                       the host's: one call, who is in it, who waits at its door
 *   PUT    /v1/rooms/:id                       { lobby?, title? }: the lobby turned off lets in whoever waits
 *   POST   /v1/rooms/:id/join                  the host takes a seat -> { seat, identity, name, host, room, people }
 *   POST   /v1/rooms/:id/admit                 { knock }: someone at the door let in
 *   POST   /v1/rooms/:id/deny                  { knock }: not let in
 *   POST   /v1/rooms/:id/remove                { identity }: someone sent away from the call
 *   POST   /v1/rooms/:id/end                   ended for everyone; the link stops working
 *
 *   GET    /v1/rooms/guest/:code               THE LINK'S, for anyone holding it: whose call, its title, whether it is on and full
 *   POST   /v1/rooms/guest/:code/knock         { name }: asks to come in -> { knock, state }
 *   GET    /v1/rooms/guest/:code/knock/:key    the answer: waiting, admitted, denied, gone
 *   POST   /v1/rooms/guest/:code/join          { knock }: a guest that was let in takes a seat
 *
 *   POST   /v1/rooms/seat/publish              { seat, sdp, audioMid?, videoMid? }: a microphone or camera turned on -> { answer }
 *   POST   /v1/rooms/seat/pull                 { seat, want: [{ identity, kind }] }: someone else's tracks -> the SFU's offer
 *   POST   /v1/rooms/seat/answer               { seat, sdp }: the answer to that offer
 *   POST   /v1/rooms/seat/live                 { seat, audio?, video? }: the heartbeat -> who is in, who waits, whether they are still in
 *   POST   /v1/rooms/seat/ask                  { seat, asked }: the bot in the call asked something -> { said } (its answer goes to every screen)
 *   POST   /v1/rooms/seat/leave                { seat }: hung up
 *
 *   GET    /v1/rooms/ears/:token               CLOUDFLARE'S OWN, not a person's: the WebSocket the SFU dials to send us one
 *                                              person's sound (docs/brief.md). The token is minted per listener, held only in
 *                                              this server's memory, and is the whole of its authority: it names one track of
 *                                              one call and can do nothing else. Nothing is ever sent back down it.
 *   GET    /v1/rooms/voice/:token              CLOUDFLARE'S OWN, the other way: the socket it dials to TAKE the bot's voice
 *                                              from us, as PCM, which it publishes in the call as a track of the bot's own.
 *                                              Nothing that arrives on it is read.
 *
 * JOINING CAPTURES NOTHING. A seat starts with no tracks of its own, so no light comes on for walking into a call; the microphone and
 * the camera are published by `/seat/publish` when the person turns one on, and the permission for them was asked once, after
 * onboarding, not here.
 *
 * A SEAT IS A BEARER. The four seat routes need nothing else: the seat says which call and which person, and it is handed out only by a
 * join that was allowed (the host signed in, or a guest the host let in). It is never drawn on a screen and only its hash is stored.
 * The host's routes are theirs alone (a call that is not theirs is 404). The link's are public, and as tight as a person's own pace: a
 * code that cannot be one, or one of no call, is the same 404. Without calls set up (SFU_APP_ID, SFU_APP_SECRET) every route is
 * 404 { code: "rooms_off" }. Nothing a person typed, and no SDP, is logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { getProfile } from "../../profile/store.js";
import { codeOf } from "../../rooms/link.js";
import { SDP_MAX } from "../../rooms/sfu.js";
import type { GuestRoomView, KnockAnswer, PublishView, PullView, RoomView, SeatLive, SeatView } from "../../rooms/types.js";

/** What the routes need of src/rooms/service.ts's RoomService. */
export interface RoomsRoutesService {
  room(userId: string, id: string): Promise<RoomView | null>;
  set(userId: string, id: string, patch: { lobby?: boolean; title?: unknown }): Promise<RoomView | null>;
  join(userId: string, id: string, o: { name?: string }): Promise<SeatView | null>;
  admit(userId: string, id: string, knock: string): Promise<RoomView | null>;
  deny(userId: string, id: string, knock: string): Promise<RoomView | null>;
  remove(userId: string, id: string, identity: string): Promise<RoomView | null>;
  end(userId: string, id: string): Promise<RoomView | null>;
  guest(code: string): Promise<GuestRoomView | null>;
  knock(code: string, name: unknown): Promise<KnockAnswer | null>;
  knockAnswer(code: string, key: string): Promise<KnockAnswer>;
  joinAsGuest(code: string, key: string): Promise<SeatView | null>;
  turnOn(seat: string, o: { sdp: string; audioMid?: string; videoMid?: string }): Promise<PublishView>;
  pull(seat: string, want: Array<{ identity: string; kind: "audio" | "video" }>): Promise<PullView>;
  answer(seat: string, sdp: string): Promise<void>;
  live(seat: string, o: { audio?: boolean; video?: boolean }): Promise<SeatLive>;
  /** The bot in the call, asked something in writing (docs/brief.md). Null: nothing is sitting in this call. */
  ask?(seat: string, asked: unknown): Promise<string | null>;
  leave(seat: string): Promise<void>;
}

/** What the SFU's socket gives us, which is a WebSocket and nothing of Fastify's. */
interface WebSocketish {
  on(event: "message", f: (data: Buffer, isBinary: boolean) => void): void;
  on(event: "close", f: () => void): void;
  send(data: Buffer): void;
  close(): void;
}

/** The ears the SFU's socket feeds (rooms/sitIn.ts). Null where the bot does not sit in calls on this server. */
type EarsLike = { knows(token: string): boolean; feed(token: string, message: Buffer): void } | null;
/** The voice the SFU's other socket takes from us. */
type SpeakerLike = { knows(token: string): boolean; attach(token: string, socket: { send(d: Buffer): void; close(): void }): boolean; detach(token: string): void } | null;

export interface RoomsRouteDeps {
  rateLimit: unknown;
  /** The server's own when not given; null: calls are not set up. */
  service?: RoomsRoutesService | null;
  /** The person's first name, their name in their own calls (their profile's when not given). */
  nameOf?: (user: AuthedUser) => Promise<string>;
  /** The ears the SFU's socket feeds; the server's own when not given. */
  ears?: EarsLike;
  /** The voice it takes; the server's own when not given. */
  speaker?: SpeakerLike;
}

const BASE = "/v1/rooms";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOCK = /^[A-Za-z0-9_-]{8,40}$/;
const IDENTITY = /^[A-Za-z0-9_-]{1,80}$/;
/** A seat is "<room uuid>.<random>". */
const SEAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{16,64}$/i;
/** A transceiver's mid, as the app read it off its own offer. */
const MID = /^[A-Za-z0-9_-]{1,16}$/;
const BODY_MAX = 256 * 1024;
/** The link's routes, per address. A seat's live poll is every couple of seconds, so it gets room for one a second. */
const RL = {
  look: { max: 30, timeWindow: 60_000 },
  knock: { max: 10, timeWindow: 60_000 },
  answer: { max: 60, timeWindow: 60_000 },
  join: { max: 20, timeWindow: 60_000 },
  seat: { max: 90, timeWindow: 60_000 },
} as const;

export function registerRoomsRoutes(app: FastifyInstance, deps: RoomsRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const at = (k: keyof typeof RL) => ({ config: { rateLimit: RL[k] } as never, bodyLimit: BODY_MAX });
  // The server's own service is loaded when first asked for, so a test with its own never pulls in the SFU client.
  const service = async (): Promise<RoomsRoutesService | null> => {
    if (deps.service !== undefined) return deps.service;
    return (await import("../../rooms/service.js")).roomService() as RoomsRoutesService | null;
  };
  const nameOf = deps.nameOf ?? firstNameOf;
  // The ears are the server's own unless a test hands in its own set. Found once, a tick after boot: the room service is
  // what builds them, and the SFU does not dial before a call has started.
  let earsOnce: EarsLike | undefined = deps.ears;
  let speakerOnce: SpeakerLike | undefined = deps.speaker;
  if (earsOnce === undefined || speakerOnce === undefined) {
    void (async () => {
      try {
        (await import("../../rooms/service.js")).roomService();
        const sit = await import("../../rooms/sitIn.js");
        if (earsOnce === undefined) earsOnce = sit.earsNow();
        if (speakerOnce === undefined) speakerOnce = sit.speakerNow();
      } catch { earsOnce = earsOnce ?? null; speakerOnce = speakerOnce ?? null; }
    })();
  }
  const earsOf = (): EarsLike => earsOnce ?? null;
  const speakerOf = (): SpeakerLike => speakerOnce ?? null;
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

  const bodyOf = (req: FastifyRequest): Record<string, unknown> => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

  /** The offer an app sends when it turns its microphone or camera on, checked before the service hears of it. */
  const offerOf = (b: Record<string, unknown>): { sdp: string; audioMid?: string; videoMid?: string } | null => {
    const sdp = typeof b.sdp === "string" ? b.sdp : "";
    if (!sdp || sdp.length > SDP_MAX) return null;
    const out: { sdp: string; audioMid?: string; videoMid?: string } = { sdp };
    for (const k of ["audioMid", "videoMid"] as const) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== "string" || !MID.test(b[k] as string)) return null;
      out[k] = b[k] as string;
    }
    // One of the two, or there is nothing to turn on.
    return out.audioMid || out.videoMid ? out : null;
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

  app.post(`${BASE}/:id/join`, at("join"), async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try {
      const name = await nameOf(got.user).catch(() => "");
      const seat = await got.s.join(got.user.id, got.id, name ? { name } : {});
      return seat ? send(reply, seat, 201) : notFound(reply);
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

  app.get(`${BASE}/guest/:code`, at("look"), async (req, reply) => {
    const got = await guestBegin(req, reply);
    if (!got) return reply;
    try {
      const r = await got.s.guest(got.code);
      return r ? send(reply, { room: r }) : noCall(reply);
    } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/guest/:code/knock`, at("knock"), async (req, reply) => {
    const got = await guestBegin(req, reply);
    if (!got) return reply;
    const name = bodyOf(req).name;
    if (typeof name !== "string" || !name.trim() || name.length > 200) return bad(reply, "Type your name, so they know who is asking to join.");
    try {
      const out = await got.s.knock(got.code, name);
      return out ? send(reply, out, 201) : noCall(reply);
    } catch (err) { return fail(reply, err); }
  });

  app.get(`${BASE}/guest/:code/knock/:key`, at("answer"), async (req, reply) => {
    const got = await guestBegin(req, reply);
    if (!got) return reply;
    const key = (req.params as { key?: string }).key ?? "";
    if (!KNOCK.test(key)) return send(reply, { knock: key.slice(0, 40), state: "gone" });
    try { return send(reply, await got.s.knockAnswer(got.code, key)); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/guest/:code/join`, at("join"), async (req, reply) => {
    const got = await guestBegin(req, reply);
    if (!got) return reply;
    const b = bodyOf(req);
    const key = typeof b.knock === "string" ? b.knock : "";
    if (!KNOCK.test(key)) return bad(reply, "Ask to join first.");
    try {
      const seat = await got.s.joinAsGuest(got.code, key);
      return seat ? send(reply, seat, 201) : noCall(reply);
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------------ a seat's

  /** The seat itself is the credential: it names the call and the person, and it is only ever handed to a join that was allowed. */
  const seatBegin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ s: RoomsRoutesService; seat: string; b: Record<string, unknown> } | null> => {
    const s = await service();
    if (!s) { off(reply); return null; }
    const b = bodyOf(req);
    const seat = typeof b.seat === "string" ? b.seat : "";
    if (!SEAT.test(seat)) { reply.code(404).send({ code: "not_found", message: "You are not in this call." }); return null; }
    return { s, seat, b };
  };

  app.post(`${BASE}/seat/publish`, at("seat"), async (req, reply) => {
    const got = await seatBegin(req, reply);
    if (!got) return reply;
    const offer = offerOf(got.b);
    if (!offer) return bad(reply, "That couldn't be turned on. Try again.");
    try { return send(reply, await got.s.turnOn(got.seat, offer)); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/seat/pull`, at("seat"), async (req, reply) => {
    const got = await seatBegin(req, reply);
    if (!got) return reply;
    const raw = Array.isArray(got.b.want) ? got.b.want : [];
    const want: Array<{ identity: string; kind: "audio" | "video" }> = [];
    for (const w of raw.slice(0, 64)) {
      const o = (w && typeof w === "object" ? w : {}) as { identity?: unknown; kind?: unknown };
      if (typeof o.identity !== "string" || !IDENTITY.test(o.identity)) return bad(reply, "Say whose tracks to bring in.");
      if (o.kind !== "audio" && o.kind !== "video") return bad(reply, "A track is audio or video.");
      want.push({ identity: o.identity, kind: o.kind });
    }
    try { return send(reply, await got.s.pull(got.seat, want)); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/seat/answer`, at("seat"), async (req, reply) => {
    const got = await seatBegin(req, reply);
    if (!got) return reply;
    const sdp = typeof got.b.sdp === "string" ? got.b.sdp : "";
    if (!sdp || sdp.length > SDP_MAX) return bad(reply, "That call couldn't go on. Try again.");
    try {
      await got.s.answer(got.seat, sdp);
      return send(reply, { ok: true });
    } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/seat/live`, at("seat"), async (req, reply) => {
    const got = await seatBegin(req, reply);
    if (!got) return reply;
    const o: { audio?: boolean; video?: boolean } = {};
    for (const k of ["audio", "video"] as const) {
      if (got.b[k] !== undefined) {
        if (typeof got.b[k] !== "boolean") return bad(reply, `${k} is true or false.`);
        o[k] = got.b[k] as boolean;
      }
    }
    try { return send(reply, await got.s.live(got.seat, o)); } catch (err) { return fail(reply, err); }
  });

  // Somebody in the call asked the bot something, in writing. Its answer rides the heartbeat, so every screen in the call
  // sees it, not only the one that asked.
  app.post(`${BASE}/seat/ask`, at("seat"), async (req, reply) => {
    const got = await seatBegin(req, reply);
    if (!got) return reply;
    if (!got.s.ask) return send(reply, { said: null });
    try { return send(reply, { said: await got.s.ask(got.seat, got.b.asked) }); } catch (err) { return fail(reply, err); }
  });

  /**
   * THE EAR. Cloudflare's SFU dials this and sends one person's track as PCM; we read it and write it down (rooms/ears.ts).
   * It is not a person's route: there is no sign-in, because there is nobody to sign in — the authority is the token, which
   * this server minted a moment ago for one track of one call and told nobody but Cloudflare. An unknown token is closed at
   * once, and nothing is ever sent back.
   */
  app.get<{ Params: { token: string } }>(`${BASE}/ears/:token`, { websocket: true, config: { rateLimit: RL.look } }, (socket: WebSocketish, req) => {
    const ears = earsOf();
    const token = String((req.params as { token?: string }).token ?? "");
    if (!ears || !/^[a-f0-9]{16,64}$/i.test(token) || !ears.knows(token)) {
      try { socket.close(); } catch { /* it is gone either way */ }
      return;
    }
    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      try { ears.feed(token, Buffer.isBuffer(raw) ? raw : Buffer.from(raw)); } catch { /* one bad packet is not the call */ }
    });
  });

  /**
   * THE VOICE. The same adapter the other way: Cloudflare dials this and we write the bot's words into it as PCM, which it
   * publishes in the call as a track of the bot's own. Nothing that arrives here is read — this socket is ours to talk on.
   */
  app.get<{ Params: { token: string } }>(`${BASE}/voice/:token`, { websocket: true, config: { rateLimit: RL.look } }, (socket: WebSocketish, req) => {
    const speaker = speakerOf();
    const token = String((req.params as { token?: string }).token ?? "");
    if (!speaker || !/^[a-f0-9]{16,64}$/i.test(token) || !speaker.attach(token, socket as never)) {
      try { socket.close(); } catch { /* it is gone either way */ }
      return;
    }
    socket.on("close", () => speaker.detach(token));
  });

  app.post(`${BASE}/seat/leave`, at("seat"), async (req, reply) => {
    const got = await seatBegin(req, reply);
    if (!got) return reply;
    try {
      await got.s.leave(got.seat);
      return send(reply, { ok: true });
    } catch (err) { return fail(reply, err); }
  });
}

/** The person's first name, from their profile ("" when there is none). */
async function firstNameOf(user: AuthedUser): Promise<string> {
  const p = await getProfile(user);
  return (p.fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

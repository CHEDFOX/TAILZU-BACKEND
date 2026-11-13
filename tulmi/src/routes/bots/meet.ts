/**
 * THE MEETING BOT'S ROUTES (src/meet, docs/meet.md): what its pages call, Recall's two signed webhooks, and the stage page the bot shows
 * as its camera. The shapes are in src/meet/types.ts; the work is MeetService's (src/meet/service.ts).
 *
 *   GET    /v1/meet/overview                          the live, upcoming and recent meetings, the settings, today's minutes; for a space's
 *                                                     admin, their members' meetings too and who they may send the bot for
 *   POST   /v1/meet/join                              { url, title?, voice?, forUser? }: a bot sent into the call now (201); forUser, a
 *                                                     member's id: into that member's meeting, for them
 *   GET    /v1/meet/meetings/:id                      one meeting and what was asked of the bot in it (a member's, read only, for their admin)
 *   POST   /v1/meet/meetings/:id/leave                the bot leaves the call
 *   PUT    /v1/meet/meetings/:id                      { voice }: answers out loud, or in the chat, from now on
 *   DELETE /v1/meet/meetings/:id                      a scheduled one: its bot is called off
 *   PUT    /v1/meet/settings                          { autoJoin?, voice?, botName? }
 *
 *   POST   /v1/meet/recall                            RECALL'S, signed with RECALL_WEBHOOK_SECRET: the bot's status
 *   POST   /v1/meet/live/:token/                      RECALL'S: the live transcript, the chat, who joins and leaves; each bot has its own
 *                                                     address, the meeting's token in it
 *
 *   GET    /v1/meet/stage/:token                      the page the bot shows as its camera (its sound is the bot's voice)
 *   GET    /v1/meet/stage/:token/events               server-sent events to that page: say, stop, state
 *   GET    /v1/meet/stage/:token/clips/:clip          a spoken answer, while it is wanted
 *   POST   /v1/meet/stage/:token/clips/:clip/done     { how: "ended" | "stopped" }
 *
 * The person's routes are theirs alone (a meeting that is not theirs is 404). With BOTS off, or the meeting bot not set up, every route is
 * 404 { code: "meet_off" }. Recall's are public and signed over the exact bytes it sent, so they are kept on those routes alone; one
 * webhook id is never processed twice. The stage's are public and keyed by the meeting's token, which only its bot and its page know.
 * Nothing said in a meeting is logged here.
 */
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { getConfig } from "../../config.js";
import { verifyRecall } from "../../meet/recall.js";
import { stageHtml, stageHub } from "../../meet/stage.js";
import type { MeetingDetail, MeetingView, MeetOverview, StageHub } from "../../meet/types.js";
import type { MeetSettings } from "../../meet/store.js";

/** What the routes need of src/meet/service.ts's MeetService. */
export interface MeetRoutesService {
  overview(userId: string, o: { calendar: boolean }): Promise<MeetOverview>;
  join(userId: string, o: { url: string; title?: string; voice?: boolean; forUser?: string }): Promise<MeetingView>;
  meeting(userId: string, id: string): Promise<MeetingDetail | null>;
  leave(userId: string, id: string): Promise<MeetingView>;
  setVoice(userId: string, id: string, on: boolean): Promise<MeetingView>;
  cancel(userId: string, id: string): Promise<boolean>;
  saveSettings(userId: string, patch: Partial<MeetSettings>): Promise<MeetSettings>;
  onLive(token: string, body: unknown): Promise<unknown>;
  onStatus(body: unknown): Promise<unknown>;
  stageFor(token: string): Promise<{ meetingId: string; botName: string; owner: string } | null>;
}

export interface MeetRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  /** The server's own when not given; null: not set up. */
  service?: MeetRoutesService | null;
  stage?: StageHub;
  /** The workspace's verification secret (RECALL_WEBHOOK_SECRET when not given). */
  secret?: string;
  now?: () => number;
  /** Whether the person's Google Calendar is connected (for auto-join); never when not given. */
  calendarConnected?: (userId: string) => Promise<boolean>;
}

const BASE = "/v1/meet";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const CLIP = /^[0-9a-f]{16}$/;
const BODY_MAX = 256 * 1024;
const SEEN_MAX = 2000;
const PING_MS = 15_000;
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src 'self'; connect-src 'self'";

type Raw = { rawBody?: string };

export function registerMeetRoutes(app: FastifyInstance, deps: MeetRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  // The server's own service is loaded when first asked for, so these routes (and a test with its own) never pull in its Recall client.
  const service = async (): Promise<MeetRoutesService | null> => {
    if (!deps.bots) return null;
    if (deps.service !== undefined) return deps.service;
    return (await import("../../meet/service.js")).meetService() as MeetRoutesService | null;
  };
  const stage = (): StageHub => deps.stage ?? stageHub();
  const now = deps.now ?? Date.now;
  const off = (reply: FastifyReply) => reply.code(404).send({ code: "meet_off", message: "The meeting bot is not switched on." });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ code: "not_found", message: "Not found." });

  /** A MeetError (status, message, code), by duck typing; anything else is the server's to report. */
  const fail = (reply: FastifyReply, err: unknown) => {
    const e = err as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof e?.status === "number" && e.status >= 400 && e.status < 600 && typeof e.code === "string") {
      return reply.code(e.status).send({ code: e.code, message: String(e.message ?? "") });
    }
    throw err;
  };

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; s: MeetRoutesService } | null> => {
    const s = await service();
    if (!s) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return { user, s };
  };

  const send = (reply: FastifyReply, body: unknown, status = 200) => reply.header("cache-control", "no-store").code(status).send(body);
  const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ code: "bad_request", message });

  // ------------------------------------------------------------------ the person's

  app.get(`${BASE}/overview`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const calendar = await (deps.calendarConnected ?? (async () => false))(got.user.id).catch(() => false);
    try { return send(reply, await got.s.overview(got.user.id, { calendar })); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/join`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (typeof b.url !== "string" || !b.url.trim() || b.url.length > 2000) return bad(reply, "Paste the meeting's link.");
    if (b.title !== undefined && (typeof b.title !== "string" || b.title.length > 200)) return bad(reply, "The title is too long.");
    if (b.voice !== undefined && typeof b.voice !== "boolean") return bad(reply, "voice is true or false.");
    // A member of a space the person is the admin of: the bot goes to that member's meeting, for them (the service checks whose).
    // The page sends its "For" chip as it is: "" (Me) is the person themselves, as no forUser is.
    if (b.forUser !== undefined && b.forUser !== "" && (typeof b.forUser !== "string" || !UUID.test(b.forUser))) return bad(reply, "forUser is someone's id.");
    const input: { url: string; title?: string; voice?: boolean; forUser?: string } = { url: b.url.trim() };
    if (typeof b.title === "string") input.title = b.title;
    if (typeof b.voice === "boolean") input.voice = b.voice;
    if (typeof b.forUser === "string" && b.forUser) input.forUser = b.forUser;
    try { return send(reply, { meeting: await got.s.join(got.user.id, input) }, 201); } catch (err) { return fail(reply, err); }
  });

  app.get(`${BASE}/meetings/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return notFound(reply);
    try {
      const out = await got.s.meeting(got.user.id, id);
      return out ? send(reply, out) : notFound(reply);
    } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/meetings/:id/leave`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return notFound(reply);
    try { return send(reply, { meeting: await got.s.leave(got.user.id, id) }); } catch (err) { return fail(reply, err); }
  });

  app.put(`${BASE}/meetings/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return notFound(reply);
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (typeof b.voice !== "boolean") return bad(reply, "voice is true or false.");
    try { return send(reply, { meeting: await got.s.setVoice(got.user.id, id, b.voice) }); } catch (err) { return fail(reply, err); }
  });

  app.delete(`${BASE}/meetings/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return notFound(reply);
    try {
      return (await got.s.cancel(got.user.id, id)) ? send(reply, { ok: true }) : notFound(reply);
    } catch (err) { return fail(reply, err); }
  });

  app.put(`${BASE}/settings`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const patch: Partial<MeetSettings> = {};
    if (b.autoJoin !== undefined) { if (typeof b.autoJoin !== "boolean") return bad(reply, "autoJoin is true or false."); patch.autoJoin = b.autoJoin; }
    if (b.voice !== undefined) { if (typeof b.voice !== "boolean") return bad(reply, "voice is true or false."); patch.voice = b.voice; }
    if (b.botName !== undefined) {
      if (typeof b.botName !== "string" || b.botName.length > 40) return bad(reply, "The name is too long.");
      patch.botName = b.botName.replace(/\s+/g, " ").trim();
    }
    try { return send(reply, { settings: await got.s.saveSettings(got.user.id, patch) }); } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------------ Recall's

  // Webhook ids already taken (Recall sends one again when it is not answered in time), the oldest forgotten first.
  const seen = new Set<string>();
  const remember = (id: string): void => {
    seen.delete(id);
    seen.add(id);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value as string);
  };
  const idOf = (req: FastifyRequest): string => String(req.headers["webhook-id"] ?? req.headers["svix-id"] ?? "");
  const secretOf = (): string => deps.secret ?? getConfig().RECALL_WEBHOOK_SECRET ?? "";

  // Signed over the exact bytes it sent, so they are kept on these routes alone.
  const keepRaw = async (req: FastifyRequest, _reply: FastifyReply, payload: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      size += (chunk as Buffer).length;
      if (size > BODY_MAX) throw Object.assign(new Error("body too large"), { statusCode: 413 });
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    (req as unknown as Raw).rawBody = text;
    return Readable.from([Buffer.from(text, "utf8")]);
  };
  const rawOf = (req: FastifyRequest): string => (req as unknown as Raw).rawBody ?? "";
  const signedBy = (req: FastifyRequest, secret: string): boolean =>
    verifyRecall(secret, (h) => { const v = req.headers[h]; return Array.isArray(v) ? v[0] : v; }, rawOf(req), now());

  // The bot's status.
  app.post(`${BASE}/recall`, { ...rl, preParsing: keepRaw }, async (req, reply) => {
    const s = await service();
    if (!s) return off(reply);
    const secret = secretOf();
    if (!secret) return reply.code(503).send({ code: "meet_unsigned", message: "The meeting bot has no webhook secret." });
    if (!signedBy(req, secret)) return reply.code(401).send({ code: "auth", message: "Not signed." });
    const id = idOf(req);
    if (id && seen.has(id)) return reply.send({ ok: true });
    let json: unknown;
    try { json = JSON.parse(rawOf(req)); } catch { return bad(reply, "Not JSON."); }
    // A failure is not remembered, so Recall's second try is processed.
    await s.onStatus(json);
    if (id) remember(id);
    return reply.send({ ok: true });
  });

  // The live transcript, the chat, who joins and leaves: answered at once, processed in the background, each meeting's events in order.
  const chains = new Map<string, Promise<void>>();
  const live = async (req: FastifyRequest, reply: FastifyReply) => {
    const s = await service();
    if (!s) return off(reply);
    const token = (req.params as { token: string }).token;
    if (!TOKEN.test(token)) return notFound(reply);
    const secret = secretOf();
    // With no secret the token alone is the key (a development machine); with one, the signature too.
    if (secret && !signedBy(req, secret)) return reply.code(401).send({ code: "auth", message: "Not signed." });
    const id = idOf(req);
    if (id && seen.has(id)) return reply.send({ ok: true });
    if (id) remember(id);
    let json: unknown;
    try { json = JSON.parse(rawOf(req)); } catch { return bad(reply, "Not JSON."); }
    const after = chains.get(token) ?? Promise.resolve();
    const next: Promise<void> = after
      .then(() => s.onLive(token, json))
      .then(() => undefined, (err: unknown) => { req.log.error({ err: (err as Error)?.message }, "meet live event failed"); })
      .finally(() => { if (chains.get(token) === next) chains.delete(token); });
    chains.set(token, next);
    return reply.send({ ok: true });
  };
  app.post(`${BASE}/live/:token`, { ...rl, preParsing: keepRaw }, live);
  app.post(`${BASE}/live/:token/`, { ...rl, preParsing: keepRaw }, live);

  // ------------------------------------------------------------------ the stage

  /** The meeting a stage token belongs to, or a 404 sent. */
  const meetingOf = async (req: FastifyRequest, reply: FastifyReply): Promise<{ meetingId: string; botName: string; owner: string } | null> => {
    const s = await service();
    if (!s) { off(reply); return null; }
    const token = (req.params as { token: string }).token;
    const m = TOKEN.test(token) ? await s.stageFor(token) : null;
    if (!m) { notFound(reply); return null; }
    return m;
  };

  app.get(`${BASE}/stage/:token`, rl, async (req, reply) => {
    const m = await meetingOf(req, reply);
    if (!m) return reply;
    return reply
      .header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").header("x-robots-tag", "noindex")
      .header("content-security-policy", CSP)
      .send(stageHtml({ token: (req.params as { token: string }).token, botName: m.botName, owner: m.owner }));
  });

  app.get(`${BASE}/stage/:token/events`, rl, async (req, reply) => {
    const m = await meetingOf(req, reply);
    if (!m) return reply;
    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    const close = stage().open(m.meetingId, (event, data) => { raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); });
    const ping = setInterval(() => { raw.write(": ping\n\n"); }, PING_MS);
    let closed = false;
    const end = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      close();
    };
    req.raw.on("close", end);
    raw.on("close", end);
    return reply;
  });

  app.get(`${BASE}/stage/:token/clips/:clip`, rl, async (req, reply) => {
    const m = await meetingOf(req, reply);
    if (!m) return reply;
    const clip = (req.params as { clip: string }).clip;
    const got = CLIP.test(clip) ? stage().clip(m.meetingId, clip) : null;
    if (!got) return notFound(reply);
    return reply.header("content-type", got.contentType).header("cache-control", "no-store").send(got.audio);
  });

  app.post(`${BASE}/stage/:token/clips/:clip/done`, rl, async (req, reply) => {
    const m = await meetingOf(req, reply);
    if (!m) return reply;
    const clip = (req.params as { clip: string }).clip;
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (!CLIP.test(clip)) return notFound(reply);
    if (b.how !== "ended" && b.how !== "stopped") return bad(reply, "how is ended or stopped.");
    stage().done(m.meetingId, clip, b.how);
    return reply.send({ ok: true });
  });
}

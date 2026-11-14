/**
 * THE CINEMA BOT'S DOORS (src/cinema, docs/cinema.md). The signed-in person's own:
 *
 *   GET    /v1/cinema/overview                       their films, pictures and cast, and today's spending
 *   POST   /v1/cinema/films                          { idea, length?, aspect?, tier?, voice?, cast?, language? } -> 201 FilmView (status writing)
 *   GET    /v1/cinema/films/:id                      -> FilmView
 *   POST   /v1/cinema/films/:id/approve-script       Make the storyboard: the stills begin -> FilmView
 *   POST   /v1/cinema/films/:id/approve-board        Film it: the takes begin -> FilmView
 *   POST   /v1/cinema/films/:id/revise               { note, n? } a change in plain words, to the film or to shot n -> FilmView
 *   POST   /v1/cinema/films/:id/shots/:n/retry       { model? } a shot that gave up, tried again (on that model) -> FilmView
 *   POST   /v1/cinema/films/:id/edition             { aspect?, captions? } another cut of the same film, free; again to remove it -> FilmView
 *   POST   /v1/cinema/films/:id/enlarge             the finished film, bigger; again to take it away -> FilmView
 *   POST   /v1/cinema/films/:id/stop                 -> FilmView
 *   DELETE /v1/cinema/films/:id                      the film and its files -> { ok: true }
 *   POST   /v1/cinema/films/:id/cast/:key            keep a person of the film in their cast -> { character }
 *   DELETE /v1/cinema/cast/:key                      -> { ok: true }
 *   POST   /v1/cinema/pictures                       { words, photos?: [{ data (base64), type }], tier? } -> 201 { picture }
 *   DELETE /v1/cinema/pictures/:id                   -> { ok: true }
 * Anyone with the link (the signature is the key, media.ts):
 *   GET    /v1/cinema/media/<key>?exp=&sig=          a still, a take, a film or its subtitles
 *
 * Always registered. With BOTS off or the bot not switched on (CINEMA), every route is 404 { code: "cinema_off" }. Saying go to a storyboard
 * or a film, and making a picture, ask the person's plan allowance first (usage/metering enforceQuota). Nothing a person typed is logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { MEDIA_PATH, ownerOfKey, typeOfKey, verifyMedia } from "../../cinema/media.js";
import { CinemaError, type CinemaService } from "../../cinema/service.js";
import { effectiveLanguage } from "../../profile/language.js";
import { enforceQuota } from "../../usage/metering.js";

export interface CinemaRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  /** Null: the bot is not switched on. */
  service: CinemaService | null;
  /** The plan allowance; enforceQuota when not given. */
  quota?: (user: AuthedUser) => Promise<string | null>;
}

const BASE = "/v1/cinema";
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function registerCinemaRoutes(app: FastifyInstance, deps: CinemaRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const off = (reply: FastifyReply) => reply.code(404).send({ code: "cinema_off", message: "The cinema bot is not switched on." });
  const send = (reply: FastifyReply, body: unknown, status = 200) => reply.header("cache-control", "no-store").code(status).send(body);
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof CinemaError) return reply.code(err.status).send({ code: err.code, message: err.message });
    const e = err as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof e?.status === "number" && e.status >= 400 && e.status < 600 && typeof e.code === "string") return reply.code(e.status).send({ code: e.code, message: String(e.message ?? "") });
    throw err;
  };
  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; s: CinemaService } | null> => {
    if (!deps.bots || !deps.service) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return { user, s: deps.service };
  };
  const allowed = async (user: AuthedUser, reply: FastifyReply): Promise<boolean> => {
    const q = await (deps.quota ?? ((u) => enforceQuota(u)))(user);
    if (q) { reply.code(429).send({ code: "quota_exceeded", message: q }); return false; }
    return true;
  };
  const body = (req: FastifyRequest): Record<string, unknown> => (req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {});
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const idOf = (req: FastifyRequest): string => String((req.params as { id?: unknown }).id ?? "");

  app.get(`${BASE}/overview`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { return send(reply, await got.s.overview(got.user.id)); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/films`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const b = body(req);
    if (!(await allowed(got.user, reply))) return reply;
    try {
      const language = await effectiveLanguage(got.user, str(b.language) || undefined).catch(() => "en");
      const view = await got.s.create(got.user.id, {
        idea: str(b.idea),
        ...(typeof b.length === "number" ? { length: b.length } : typeof b.length === "string" && b.length ? { length: Number(b.length) } : {}),
        aspect: str(b.aspect), tier: str(b.tier), voice: str(b.voice), language,
        ...(Array.isArray(b.cast) ? { cast: b.cast.filter((k): k is string => typeof k === "string").slice(0, 6) } : {}),
      });
      return send(reply, view, 201);
    } catch (err) { return fail(reply, err); }
  });

  app.get(`${BASE}/films/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { return send(reply, await got.s.film(got.user.id, idOf(req))); } catch (err) { return fail(reply, err); }
  });

  for (const [path, run] of [
    ["approve-script", (s: CinemaService, u: string, id: string) => s.approveScript(u, id)],
    ["approve-board", (s: CinemaService, u: string, id: string) => s.approveBoard(u, id)],
  ] as const) {
    app.post(`${BASE}/films/:id/${path}`, rl, async (req, reply) => {
      const got = await begin(req, reply);
      if (!got) return reply;
      if (!(await allowed(got.user, reply))) return reply;
      try { return send(reply, await run(got.s, got.user.id, idOf(req))); } catch (err) { return fail(reply, err); }
    });
  }

  app.post(`${BASE}/films/:id/revise`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const b = body(req);
    const n = b.n === undefined || b.n === null || b.n === "" ? undefined : Number(b.n);
    if (n !== undefined && !Number.isInteger(n)) return reply.code(400).send({ code: "bad_request", message: "Which shot?" });
    try { return send(reply, await got.s.revise(got.user.id, idOf(req), { note: str(b.note), ...(n !== undefined ? { n } : {}) })); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/films/:id/shots/:n/retry`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const n = Number((req.params as { n?: unknown }).n);
    const b = body(req);
    try { return send(reply, await got.s.retry(got.user.id, idOf(req), n, "model" in b ? { model: str(b.model) || null } : {})); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/films/:id/edition`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const b = body(req);
    try {
      return send(reply, await got.s.edition(got.user.id, idOf(req), { aspect: str(b.aspect), captions: b.captions !== false }));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post(`${BASE}/films/:id/enlarge`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { return send(reply, await got.s.enlarge(got.user.id, idOf(req))); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/films/:id/stop`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { return send(reply, await got.s.stop(got.user.id, idOf(req))); } catch (err) { return fail(reply, err); }
  });

  app.delete(`${BASE}/films/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { await got.s.remove(got.user.id, idOf(req)); return send(reply, { ok: true }); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/films/:id/cast/:key`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { return send(reply, { character: await got.s.keep(got.user.id, idOf(req), String((req.params as { key?: unknown }).key ?? "")) }); } catch (err) { return fail(reply, err); }
  });

  app.delete(`${BASE}/cast/:key`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { await got.s.dropCast(got.user.id, String((req.params as { key?: unknown }).key ?? "")); return send(reply, { ok: true }); } catch (err) { return fail(reply, err); }
  });

  app.post(`${BASE}/pictures`, { ...rl, bodyLimit: Math.ceil(4 * PHOTO_MAX_BYTES * 1.4) }, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    const b = body(req);
    const photos: { url: string; type: string }[] = [];
    for (const p of Array.isArray(b.photos) ? b.photos.slice(0, 4) : []) {
      const type = str((p as { type?: unknown })?.type);
      const data = str((p as { data?: unknown })?.data);
      if (!PHOTO_TYPES.has(type) || !data || data.length > PHOTO_MAX_BYTES * 1.37) return reply.code(400).send({ code: "bad_photo", message: "Send photos as PNG, JPEG or WebP, up to 8 MB each." });
      photos.push({ url: `data:${type};base64,${data}`, type });
    }
    if (!(await allowed(got.user, reply))) return reply;
    try { return send(reply, { picture: await got.s.picture(got.user.id, { words: str(b.words), photos, tier: str(b.tier) }) }, 201); } catch (err) { return fail(reply, err); }
  });

  app.delete(`${BASE}/pictures/:id`, rl, async (req, reply) => {
    const got = await begin(req, reply);
    if (!got) return reply;
    try { await got.s.deletePicture(got.user.id, idOf(req)); return send(reply, { ok: true }); } catch (err) { return fail(reply, err); }
  });

  app.get(`${MEDIA_PATH}*`, rl, async (req, reply) => {
    if (!deps.bots || !deps.service) return off(reply);
    const key = String((req.params as { "*"?: unknown })["*"] ?? "");
    const q = req.query as { exp?: string; sig?: string };
    if (!ownerOfKey(key) || !verifyMedia(key, q.exp, q.sig)) return reply.code(403).send({ code: "bad_link", message: "This link has expired. Open it again from the app." });
    const bytes = await deps.service.file(key);
    if (!bytes) return reply.code(404).send({ code: "not_found", message: "That file is gone." });
    const type = typeOfKey(key);
    return reply
      .header("content-type", type === "text/plain" ? "text/plain; charset=utf-8" : type)
      .header("cache-control", "private, max-age=3600")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
      .send(bytes);
  });
}

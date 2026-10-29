/**
 * The bots' sounds (experience/bots/sounds.ts; docs/bots-app.md "Sounds"): the catalog, its files, and pushing a new pack.
 *
 *   GET    /v1/bots/sounds                 the catalog served now (public, cached; the bootstrap's "bots.sounds" says which
 *                                          v, and the phone fetches it only when it is not its own)
 *   GET    /bots/sounds/<id>.m4a?h=<hash>  a sound's file (shared/bots/sounds), immutable: a changed file has a new hash
 *   PUT    /v1/admin/bots/sounds[?dry=1]   push a catalog (ADMIN_SECRET): checked as the phone reads it, v above the one served
 *   DELETE /v1/admin/bots/sounds           take a pushed one back
 */
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { requireAdmin } from "../control/index.js";
import { activeSounds, dropPushedSounds, pushSounds, servedSounds, soundsDir, SOUNDS_PREFIX } from "../experience/bots/sounds.js";

export const SOUNDS_ROUTE = "/v1/bots/sounds";
export const SOUNDS_ADMIN_ROUTE = "/v1/admin/bots/sounds";

export function registerBotSoundsRoutes(app: FastifyInstance, deps: { rateLimit: unknown }): void {
  const rl = { config: deps.rateLimit as never };

  app.get(SOUNDS_ROUTE, rl, async (req, reply) => {
    const c = activeSounds();
    if (!c) return reply.code(404).send({ code: "not_found", message: "No sounds on this server" });
    const etag = `"sounds-${c.v}"`;
    reply.header("etag", etag).header("cache-control", "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(servedSounds(c));
  });

  app.put(SOUNDS_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const dry = (req.query as { dry?: string } | undefined)?.dry === "1";
    const r = pushSounds(req.body, { dry });
    if (!r.ok) return reply.code(r.status).send({ code: r.status === 409 ? "conflict" : "bad_request", errors: r.errors });
    return reply.send({ ok: true, v: r.v, dry });
  });

  app.delete(SOUNDS_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    dropPushedSounds();
    return reply.send({ ok: true, v: activeSounds()?.v ?? null });
  });
}

/**
 * The files, the way the typefaces and Blip are served: shipped in the image (shared/ is copied to /app/shared), immutable,
 * a year's cache, the URL carrying the file's hash. Only the sounds themselves (`<name>.m4a` at the top), never the masters.
 */
export async function registerBotSoundFiles(app: FastifyInstance, dir = soundsDir()): Promise<boolean> {
  if (!dir) return false;
  await app.register(fastifyStatic, {
    root: dir,
    prefix: SOUNDS_PREFIX,
    decorateReply: false,
    cacheControl: true,
    maxAge: "365d",
    immutable: true,
    index: false,
    allowedPath: (p) => /^\/[a-z0-9][a-z0-9._-]{0,60}\.m4a$/.test(p),
    setHeaders(res) { res.setHeader("access-control-allow-origin", "*"); },
  });
  return true;
}

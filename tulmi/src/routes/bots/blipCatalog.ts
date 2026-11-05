/**
 * Blip's catalog on the desktop (experience/bots/blip.ts): the moves and poses the desktop plays, and pushing new ones
 * without an app update or a deploy.
 *
 *   GET    /v1/blip                 the catalog served now (public, cached; the bootstrap's "desktop.blip" flag says which v,
 *                                   and the desktop fetches only when it is not its own)
 *   PUT    /v1/admin/blip[?dry=1]   push one (ADMIN_SECRET): checked as the desktop compiles it, v above the one served;
 *                                   400 { errors } / 409; dry: only checked
 *   DELETE /v1/admin/blip           take a pushed one back: the file's is served again (the desktops follow the flag down)
 */
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../control/index.js";
import { activeBlip, dropPushedBlip, pushBlip } from "../../experience/bots/blip.js";

const BLIP_ROUTE = "/v1/blip";
const BLIP_ADMIN_ROUTE = "/v1/admin/blip";

export function registerBlipRoutes(app: FastifyInstance, deps: { rateLimit: unknown }): void {
  const rl = { config: deps.rateLimit as never };

  app.get(BLIP_ROUTE, rl, async (req, reply) => {
    const c = activeBlip();
    if (!c) return reply.code(404).send({ code: "not_found", message: "No Blip catalog on this server" });
    const etag = `"blip-${c.v}"`;
    reply.header("etag", etag).header("cache-control", "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(c);
  });

  app.put(BLIP_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const dry = (req.query as { dry?: string } | undefined)?.dry === "1";
    const r = pushBlip(req.body, { dry });
    if (!r.ok) return reply.code(r.status).send({ code: r.status === 409 ? "conflict" : "bad_request", errors: r.errors });
    return reply.send({ ok: true, v: r.v, dry });
  });

  app.delete(BLIP_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    dropPushedBlip();
    return reply.send({ ok: true, v: activeBlip()?.v ?? null });
  });
}

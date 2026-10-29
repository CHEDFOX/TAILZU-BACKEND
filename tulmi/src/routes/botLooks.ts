/**
 * The bots' looks and moments (experience/bots/looks.ts; docs/bots-app.md "Looks and moments"): the catalog the apps
 * draw and play, and pushing a new one without a deploy.
 *
 *   GET    /v1/bots/looks                 the catalog served now (public, cached; the bootstrap's "bots.looks" flag says
 *                                         which v, and an app fetches only when it is not its own)
 *   PUT    /v1/admin/bots/looks[?dry=1]   push one (ADMIN_SECRET): checked as the apps compile it, v above the one served;
 *                                         400 { errors } / 409; dry: only checked
 *   DELETE /v1/admin/bots/looks           take a pushed one back: the file's is served again (the apps follow the flag down)
 */
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../control/index.js";
import { activeLooks, dropPushed, pushLooks } from "../experience/bots/looks.js";

export const LOOKS_ROUTE = "/v1/bots/looks";
export const LOOKS_ADMIN_ROUTE = "/v1/admin/bots/looks";

export function registerBotLooksRoutes(app: FastifyInstance, deps: { rateLimit: unknown }): void {
  const rl = { config: deps.rateLimit as never };

  app.get(LOOKS_ROUTE, rl, async (req, reply) => {
    const c = activeLooks();
    if (!c) return reply.code(404).send({ code: "not_found", message: "No looks catalog on this server" });
    const etag = `"looks-${c.v}"`;
    reply.header("etag", etag).header("cache-control", "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(c);
  });

  app.put(LOOKS_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const dry = (req.query as { dry?: string } | undefined)?.dry === "1";
    const r = pushLooks(req.body, { dry });
    if (!r.ok) return reply.code(r.status).send({ code: r.status === 409 ? "conflict" : "bad_request", errors: r.errors });
    return reply.send({ ok: true, v: r.v, dry });
  });

  app.delete(LOOKS_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    dropPushed();
    return reply.send({ ok: true, v: activeLooks()?.v ?? null });
  });
}

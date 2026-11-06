/**
 * The phone's launch motion (experience/phone/launch.ts): the formulas the app plays at start-up, and pushing new ones
 * without an app update or a deploy.
 *
 *   GET    /v1/launch                 the launch served now (public, cached; every phone's bootstrap also carries it
 *                                    whole, as "app.launch")
 *   PUT    /v1/admin/launch[?dry=1]   push one (ADMIN_SECRET): checked as the app compiles it, v above the one served;
 *                                    400 { errors } / 409; dry: only checked
 *   DELETE /v1/admin/launch           take a pushed one back: the file's is served again
 */
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../control/index.js";
import { activeLaunch, dropPushedLaunch, pushLaunch } from "../../experience/phone/launch.js";

const LAUNCH_ROUTE = "/v1/launch";
const LAUNCH_ADMIN_ROUTE = "/v1/admin/launch";

export function registerLaunchRoutes(app: FastifyInstance, deps: { rateLimit: unknown }): void {
  const rl = { config: deps.rateLimit as never };

  app.get(LAUNCH_ROUTE, rl, async (req, reply) => {
    const c = activeLaunch();
    if (!c) return reply.code(404).send({ code: "not_found", message: "No launch on this server" });
    const etag = `"launch-${c.v}"`;
    reply.header("etag", etag).header("cache-control", "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(c);
  });

  app.put(LAUNCH_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const dry = (req.query as { dry?: string } | undefined)?.dry === "1";
    const r = pushLaunch(req.body, { dry });
    if (!r.ok) return reply.code(r.status).send({ code: r.status === 409 ? "conflict" : "bad_request", errors: r.errors });
    return reply.send({ ok: true, v: r.v, dry });
  });

  app.delete(LAUNCH_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    dropPushedLaunch();
    return reply.send({ ok: true, v: activeLaunch()?.v ?? null });
  });
}

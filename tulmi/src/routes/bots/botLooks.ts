/**
 * The bots' looks and moments (experience/bots/looks.ts; docs/bots-app.md "Looks and moments"): the catalog the apps
 * draw and play, and pushing a new one without a deploy.
 *
 *   GET    /v1/bots/looks[?v=N&f=F]       the catalog served now, cut down to the format the build plays (public,
 *                                         cached; the bootstrap's "bots.looks" flag says which v and f, and an app
 *                                         fetches only when the pair is not its own). No f means 1: every build
 *                                         from before format 2 is served exactly what it is served today.
 *   PUT    /v1/admin/bots/looks[?dry=1]   push one (ADMIN_SECRET): checked as the apps compile it, v above the one served;
 *                                         400 { errors } / 409; dry: only checked
 *   DELETE /v1/admin/bots/looks           take a pushed one back: the file's is served again (the apps follow the flag down)
 *   PUT    /v1/admin/bots/looks/off       { off: [moment id…] }: format-2 builds leave these out and play the
 *                                         recipe's fallback act instead. It rides on the bootstrap, which is not
 *                                         cached like the catalog, so it takes effect at the next start.
 */
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../control/index.js";
import { LOOKS_FORMAT_MAX, activeLooks, dropPushed, offMoments, pushLooks, servedLooks, setOffMoments } from "../../experience/bots/looks.js";

const LOOKS_ROUTE = "/v1/bots/looks";
const LOOKS_ADMIN_ROUTE = "/v1/admin/bots/looks";
const LOOKS_OFF_ROUTE = "/v1/admin/bots/looks/off";

export function registerBotLooksRoutes(app: FastifyInstance, deps: { rateLimit: unknown }): void {
  const rl = { config: deps.rateLimit as never };

  app.get(LOOKS_ROUTE, rl, async (req, reply) => {
    // The format comes from the query alone, clamped; missing means 1, as every build before format 2 asks.
    const want = Number((req.query as { f?: string } | undefined)?.f);
    const f = Number.isFinite(want) ? Math.max(1, Math.min(LOOKS_FORMAT_MAX, Math.floor(want))) : 1;
    const c = servedLooks(f);
    if (!c) return reply.code(404).send({ code: "not_found", message: "No looks catalog on this server" });
    const etag = f <= 1 ? `"looks-${c.v}"` : `"looks-${c.v}-f${f}"`;
    reply.header("etag", etag).header("cache-control", "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(c);
  });

  app.put(LOOKS_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const dry = (req.query as { dry?: string } | undefined)?.dry === "1";
    const r = pushLooks(req.body, { dry });
    if (!r.ok) return reply.code(r.status).send({ code: r.status === 409 ? "conflict" : "bad_request", errors: r.errors });
    return reply.send({ ok: true, v: r.v, dry, ...(r.warnings ? { warnings: r.warnings } : {}) });
  });

  app.delete(LOOKS_ADMIN_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    dropPushed();
    return reply.send({ ok: true, v: activeLooks()?.v ?? null });
  });

  app.put(LOOKS_OFF_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { off?: unknown } | undefined;
    const r = setOffMoments(body?.off ?? []);
    if (!r.ok) return reply.code(400).send({ code: "bad_request", errors: r.errors });
    return reply.send({ ok: true, off: r.off });
  });

  app.get(LOOKS_OFF_ROUTE, rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return reply.send({ ok: true, off: offMoments() });
  });
}

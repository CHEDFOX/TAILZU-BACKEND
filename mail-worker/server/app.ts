// The mail worker's HTTP side: no page, no login. Three doors:
//
//   GET  /healthz           says it is up, and whether it is set up (never a value)
//   POST /hooks/stalwart    the mail server's word of new mail, signed with MAIL_WEBHOOK_SECRET (routes/hooks.ts)
//   /v1/o/:owner/...        X0 Bot's server, signed with MAIL_WORKER_SECRET (routes/x0.ts)
//
// The raw bytes of a JSON body are kept: both signatures are over them. (From Xooteq Mail's dashboard app.ts, its parser.)
import Fastify, { type FastifyInstance } from "fastify";
import { assertReady } from "./config.ts";
import { hookRoutes } from "./routes/hooks.ts";
import { x0Routes } from "./routes/x0.ts";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  // Nothing a person wrote is logged: no request log at all, errors by their kind only.
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {});
    } catch {
      const err = new Error("The request body is not valid JSON.") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  app.get("/healthz", async (_req, reply) => {
    const missing = assertReady();
    return reply.header("cache-control", "no-store").send({ ok: true, ready: missing.length === 0, ...(missing.length ? { missing } : {}) });
  });
  await app.register(hookRoutes);
  await app.register(x0Routes);
  return app;
}

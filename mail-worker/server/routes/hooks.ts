// Stalwart tells the worker about every delivered message (its own webhook: server/cli.ts webhook). The body is signed with
// MAIL_WEBHOOK_SECRET; anything unsigned is refused. Mail for a domain that is not one of the worker's businesses (Xooteq Mail's, on the
// same server) is not this worker's, and is left alone. (From Xooteq Mail's dashboard, routes/hooks.ts.)
import type { FastifyInstance } from "fastify";
import { verifyWebhook } from "../crypto.ts";
import { fromWebhook } from "../ai/engine.ts";

export async function hookRoutes(app: FastifyInstance) {
  app.post("/hooks/stalwart", async (req, reply) => {
    if (!req.rawBody || !verifyWebhook(req.rawBody, req.headers["x-signature"] as string | undefined)) {
      return reply.code(401).send({ error: "bad signature" });
    }
    const queued = fromWebhook(req.body);
    return { ok: true, queued };
  });
}

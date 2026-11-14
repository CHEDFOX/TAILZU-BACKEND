/**
 * Hooks every request passes through: its cost tally, the HTML pages' safety headers, and the JSON body parser.
 */

import type { FastifyInstance } from "fastify";
import { aiScopeHook } from "../privacy/aiGate.js";
import { costTallyHook, settleCostTally } from "../usage/cost.js";

export function registerRequestHooks(app: FastifyInstance): void {
  // What each request really cost us, for the usage meter (usage/cost.ts): a tally of its own that the calls it makes outside the brain's
  // gateway add OpenRouter's charge to (Keylessbord's rewrites, the old Ask), written to the meter with its usage row; what is left when the
  // response goes (a request that failed after a model answered) is charged to whoever enforceQuota said it was for.
  app.addHook("preHandler", costTallyHook);
  // Whose request this is, for the AI permission (privacy/aiGate.ts): nothing of theirs goes to an AI service before they agree.
  app.addHook("preHandler", aiScopeHook);
  app.addHook("onResponse", async (req) => { await settleCostTally(req); });

  // Every HTML page this server renders (the site, the policies, the SEO pages,
  // the auth callback, the admin console) goes out with the headers that stop
  // it being framed or content-sniffed. A route that sets its own wins.
  app.addHook("onSend", async (_req, reply, payload) => {
    if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) {
      reply.header("X-Content-Type-Options", "nosniff");
      if (!reply.hasHeader("X-Frame-Options")) reply.header("X-Frame-Options", "DENY");
      if (!reply.hasHeader("Referrer-Policy")) reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    }
    return payload;
  });

  // AN EMPTY JSON BODY IS NOT A MALFORMED ONE.
  //
  // Fastify's default parser rejects `content-type: application/json` with no
  // body outright — FST_ERR_CTP_EMPTY_JSON_BODY, 400, thrown before any handler
  // runs. The app sets that header on every request it makes and only attaches a
  // body when it has one, so DELETE /v1/account arrived as a header with nothing
  // behind it and was refused at the door.
  //
  // Which is how Delete account came to be a button that could never work. The
  // request left the phone, reached the server, and was turned away by the
  // parser; the handler was never entered, nothing was ever deleted, and the app
  // showed "Couldn't delete the account" no matter how many times it was tapped.
  // Every endpoint the app calls without a body had the same hole.
  //
  // Empty now means `{}`, which is what a body-less request means. Malformed
  // JSON still fails, exactly as before — this widens what is accepted by one
  // case, the empty one, and nothing else.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string", bodyLimit: 1 * 1024 * 1024 },
    (req, body, done) => {
      // Razorpay and GitHub sign the body exactly as sent, so their webhooks keep it.
      if (typeof body === "string" && (req.url.startsWith("/v1/billing/razorpay") || req.url.startsWith("/v1/code/github/webhook"))) {
        (req as unknown as { rawBody?: string }).rawBody = body;
      }
      const raw = typeof body === "string" ? body.trim() : "";
      if (raw === "") return done(null, {});
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );
}

/**
 * Hooks every request passes through: its cost tally, abuse prevention's collection, the HTML pages' safety headers, and the
 * JSON body parser.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { localUserId } from "../auth/jwt.js";
import { aiScopeHook } from "../privacy/aiGate.js";
import { costTallyHook, settleCostTally } from "../usage/cost.js";
import { look, trustMode } from "../trust/actions.js";
import { needsWriting, shapeOf, skipCollection, tlsHints } from "../trust/signals.js";

/** How often one account's requests are looked at here. The bootstrap looks every launch; this is the quiet background pass. */
const LOOK_EVERY_MS = 60 * 60_000;

/**
 * ABUSE PREVENTION'S COLLECTION POINT FOR SIGNED-IN REQUESTS (docs/trust.md §collection).
 *
 * What it does: for a signed-in request to an app route, once an hour per account, it writes the (account, network, day) row
 * and this account's score. What it does NOT do: take any action. This hook knows the account id from the locally verified
 * JWT and nothing else — not whether they pay, not whether they are the review account — and rule 5 says no action without
 * that, so the decision belongs to the bootstrap, which has already read both.
 *
 * Fire and forget, always: the request is not held up for it, and a failure anywhere inside it cannot fail a request.
 * A request carrying `x-vercel-forwarded-for` is skipped outright (forgeable on a direct call, docs/trust.md rule 5).
 */
export async function trustCollectHook(req: FastifyRequest): Promise<void> {
  if (trustMode() === "off") return;
  // The bootstrap is skipped: it does the whole pass itself, with the entitlement, the email and the account's age in
  // hand, and this one would only write the same row again from less.
  if (!req.url.startsWith("/v1/") || req.url.startsWith("/v1/admin/") || req.url.startsWith("/v1/trust/")) return;
  if (req.url.startsWith("/v1/app/bootstrap")) return;
  if (skipCollection(req.headers as Record<string, unknown>)) return;
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth) return;
  const userId = await localUserId(auth).catch(() => null);
  if (!userId) return;
  const now = Date.now();
  if (!needsWriting(`look|${userId}`, now, LOOK_EVERY_MS)) return;
  const platform = req.headers["x-app-platform"];
  void look({
    userId,
    ip: req.ip,
    collectOnly: true,
    shape: shapeOf({
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      platform: typeof platform === "string" ? platform : undefined,
      appRoute: true,
      tls: tlsHints(req.headers as Record<string, unknown>),
    }),
    now,
    log: req.log,
  }).catch(() => undefined);
}

export function registerRequestHooks(app: FastifyInstance): void {
  // What each request really cost us, for the usage meter (usage/cost.ts): a tally of its own that the calls it makes outside the brain's
  // gateway add OpenRouter's charge to (Keylessbord's rewrites, the old Ask), written to the meter with its usage row; what is left when the
  // response goes (a request that failed after a model answered) is charged to whoever enforceQuota said it was for.
  app.addHook("preHandler", costTallyHook);
  // Whose request this is, for the AI permission (privacy/aiGate.ts): nothing of theirs goes to an AI service before they agree.
  app.addHook("preHandler", aiScopeHook);
  // Abuse prevention (src/trust, docs/trust.md): the kind of network a signed-in request came from, and how many accounts
  // come from it. Started and let go of, so not even the JWT check inside it is in the request's way; no action is taken
  // here; and with TRUST=off it does nothing at all.
  app.addHook("onRequest", async (req) => { void trustCollectHook(req).catch(() => undefined); });
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

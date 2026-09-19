/**
 * A fixed email + code pair that passes auth.
 *
 * WHY THIS ENDPOINT EXISTS
 *
 * Sign-in is one-time codes. That is the product, and a reviewer who meets a
 * password field is meeting a different app from the one being reviewed. But an
 * emailed code is a code somebody has to read, and no App Review or Play Review
 * tester can open our inbox. Supabase offers fixed test codes for phone numbers
 * and has no equivalent for email — its provider panel has OTP length and expiry
 * and nothing else — so the pair has to live on our side of the wire.
 *
 * WHAT IT IS NOT
 *
 * Not a password. The code never reaches Supabase's password field and the
 * account does not need one. This checks the pair itself, and on a match asks
 * Supabase for a one-time link for that address — the same kind of link the
 * emailed code redeems. What the app gets back is an ordinary session, minted
 * the ordinary way, indistinguishable afterwards from any other user's.
 *
 * WHAT KEEPS IT SHUT
 *
 *   - Both REVIEW_EMAIL and REVIEW_CODE must be set. Either alone is nothing,
 *     so a half-finished configuration cannot leave a door ajar.
 *   - Unset in production is the normal state, and then this route answers 404 —
 *     not 401, not "wrong code". A closed door should not advertise its lock.
 *   - Both comparisons are timing-safe. `a === b` leaks length and prefix under
 *     repetition, which is exactly the shape of an attack on a fixed secret.
 *   - Rate-limited per IP by the same limiter the app routes use.
 *   - The EMAIL is public (every client is told which address to route) so the
 *     CODE is the whole secret. Make it long, and clear it when review passes.
 */
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { getConfig } from "../config.js";
import { supabase } from "../auth/supabase.js";

/**
 * Constant-time compare of two strings.
 *
 * Lengths are hashed first so the comparison itself is over equal-length
 * buffers: timingSafeEqual throws on a length mismatch, and branching on that
 * throw would leak the length it is meant to hide.
 */
function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function registerReviewCodeRoute(
  app: FastifyInstance,
  opts: { rateLimit?: { max: number; timeWindow: number } } = {},
): void {
  app.post(
    "/v1/auth/review-code",
    opts.rateLimit ? { config: { rateLimit: opts.rateLimit } } : {},
    async (req, reply) => {
      const cfg = getConfig();
      const email = (cfg.REVIEW_EMAIL ?? "").trim().toLowerCase();
      const code = (cfg.REVIEW_CODE ?? "").trim();
      // Not configured is the normal state. 404, because a route that answers
      // 401 has told you it exists and is worth pushing on.
      if (!email || !code) {
        return reply.code(404).send({ code: "not_found" });
      }

      const body = (req.body ?? {}) as { email?: unknown; code?: unknown };
      const gotEmail = String(body.email ?? "").trim().toLowerCase();
      const gotCode = String(body.code ?? "").trim();
      if (!gotEmail || !gotCode) {
        return reply.code(400).send({ code: "bad_request", message: "email and code are required." });
      }

      // BOTH compared, always, even when the first has already failed. An early
      // return on the email turns "is this the review address?" into a question
      // anyone can ask, and answer, from the response time.
      const emailOk = sameSecret(gotEmail, email);
      const codeOk = sameSecret(gotCode, code);
      if (!emailOk || !codeOk) {
        // The same answer the app shows for a mistyped code, so this path is
        // not distinguishable from the ordinary one by its failures either.
        return reply.code(401).send({ code: "invalid_code" });
      }

      const sb = supabase();
      if (!sb) {
        return reply.code(503).send({
          code: "supabase_unavailable",
          message: "SUPABASE_URL + SUPABASE_SERVICE_KEY are required to mint a session.",
        });
      }

      // A magiclink is the one-time link the emailed code also redeems. We ask
      // for it and hand back only its hashed token: the app verifies that with
      // its own anon key, so the session is minted by Supabase for the client,
      // and no service-role credential is ever anywhere near the device.
      //
      // No email is sent. generate_link returns the link rather than delivering
      // it — which is the whole reason this works without a mailbox.
      const { data, error } = await sb.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) {
        req.log.error({ err: error?.message }, "review-code: generateLink failed");
        return reply.code(502).send({
          code: "link_failed",
          // The reason is for the operator in the logs, not for the caller.
          message: "Could not mint a session for the review account.",
        });
      }

      return reply.send({ tokenHash, type: "magiclink" });
    },
  );
}

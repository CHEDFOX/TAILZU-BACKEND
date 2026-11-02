/**
 * How the server answers and reports a failed request: 5xx reported and kept vague, 4xx as written.
 */

import type { FastifyInstance } from "fastify";
import { captureException } from "../observability.js";

export function registerErrorHandling(app: FastifyInstance): void {
  const isClientError = (err: { statusCode?: number }) =>
    !!err.statusCode && err.statusCode >= 400 && err.statusCode < 500;

  // Route unhandled errors through the observability layer (Sentry when
  // configured, console otherwise) — the error handler below writes the
  // response, this only tees the event.
  //
  // 5xx only. A 4xx is the caller's mistake, not the server's, and every 429
  // and malformed body used to be reported too — noise that buried real errors,
  // and a way for anyone to spend the error-reporting quota by being refused.
  app.addHook("onError", async (req, _reply, err) => {
    if (!isClientError(err)) captureException(err, { route: req.routeOptions?.url, method: req.method });
  });

  // A 5xx says that something failed, never what. Fastify's default handler
  // puts err.message in the body, and for an unexpected throw that is an
  // internal detail — a file path, an SQL error, an upstream's own words. The
  // full error goes to the log (and Sentry, via onError above); 4xx keep
  // Fastify's shape, since their message is written for the caller.
  app.setErrorHandler((err, req, reply) => {
    if (isClientError(err)) return reply.code(err.statusCode!).send(err);
    req.log.error({ err }, "request failed");
    return reply.code(500).send({ code: "internal", message: "Something went wrong. Try again in a moment." });
  });
}

/**
 * The Fastify plugins every route relies on: multipart uploads, WebSockets and the rate limiter.
 */

import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { localUserId } from "../auth/jwt.js";
import type { AppConfig } from "../config.js";

export interface PluginDeps {
  cfg: AppConfig;
}

export async function registerPlugins(app: FastifyInstance, deps: PluginDeps): Promise<void> {
  const { cfg } = deps;
  // One file, and a handful of text fields: the most any route reads is six
  // (/v1/transcribe-clean). Unbounded, a single request could stream field after
  // field for as long as the connection stayed open.
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 20 },
  });
  // One frame is a few KB of PCM (the largest a client sends is its pre-roll,
  // ~96 KB). The library default is 100 MB per frame, buffered whole before any
  // route code can refuse it.
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  // --- Rate limiter (must register BEFORE any route that needs throttling) ---
  // Fastify applies plugin hooks in registration order, so /v1/media/* + admin
  // routes below need this plugin already in place to be throttleable.
  await app.register(rateLimit, {
    global: false,
    max: cfg.RATE_LIMIT_MAX,
    timeWindow: cfg.RATE_LIMIT_WINDOW_MS,
    keyGenerator: async (req) => {
      // Key by the VERIFIED user id when we can prove it, else by client IP.
      //
      // The user id is read from a LOCALLY signature-verified JWT (localUserId —
      // no network), so this reacts to the authenticated user without the two
      // hazards that keying on the raw Authorization header had: (1) a forged /
      // rotated token can't mint a fresh bucket — it fails verification and falls
      // through to the IP bucket; (2) there's no per-request Supabase round-trip
      // to amplify. Real users behind one NAT/CGNAT egress IP now get their own
      // buckets instead of sharing (and 429-storming) a single per-IP one.
      //
      // req.ip is trustworthy (trustProxy is the exact proxy hop count, so
      // X-Forwarded-For can't be spoofed). When no JWT secret / JWKS is configured
      // localUserId returns null and this degrades to the prior per-IP behavior.
      const uid = await localUserId(req.headers["authorization"]);
      return uid ? "u:" + uid : "ip:" + req.ip;
    },
  });
}

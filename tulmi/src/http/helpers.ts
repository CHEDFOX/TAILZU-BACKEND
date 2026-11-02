/**
 * Request and reply helpers the route modules share.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { Personality } from "../../../shared/types/api.js";
import { isDesktopAgent, userAgentOf, reportMilestones } from "../ads/meta.js";
import type { AuthedUser } from "../auth/supabase.js";
import { currentCacheVersion } from "../experience/cacheVersion.js";

/**
 * A SCREEN IS JSON THAT REPEATS ITSELF — every text names its face, size and
 * colour — so it packs down hard: the Stats tab, with a month of days behind
 * it, is ~250 KB as text and ~12 KB gzipped; the keyboard's config is 42 KB
 * and 9 KB. The phone, the keyboards and the desktop all ask for gzip and
 * undo it themselves. Small replies go as they are.
 */
const gzipped = promisify(gzip);

export async function gzipLargeJson(req: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> {
  if (typeof payload !== "string" || payload.length < 8_192) return payload;
  if (!/\bgzip\b/i.test(String(req.headers["accept-encoding"] ?? ""))) return payload;
  if (reply.hasHeader("content-encoding")) return payload;
  reply.header("content-encoding", "gzip");
  reply.header("vary", "accept-encoding");
  reply.removeHeader("content-length");
  return gzipped(payload);
}

/** The one answer to a request with no valid session. */
export const unauthorized = (reply: FastifyReply) =>
  reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });

/** A client-sent value made safe to log: printable ASCII, bounded. */
export const clip = (v: unknown, n: number) => String(v ?? "").replace(/[^\x20-\x7E]/g, "").slice(0, n);

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** A client-sent UTC offset in minutes, clamped to the real range, or
 *  undefined when absent or out of range. Prefer it over the stored one. */
export function reqTz(v: unknown, stored?: number): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 14 * 60) return Math.round(v);
  return stored;
}

/**
 * A desktop's first dictation is a milestone for Meta (src/ads/meta.ts),
 * reported the moment it happens rather than at the next launch, which on a
 * desktop can be days away. Every later dictation costs one property read.
 */
export function desktopDictated(req: FastifyRequest, user: AuthedUser, personality: Personality): void {
  if (personality.adsReported?.firstDictation || !isDesktopAgent(userAgentOf(req))) return;
  void reportMilestones({ req, user, personality, desktop: true, wordsEver: 1 });
}

// --- Experience (SDUI): the backend drives the app's UI ---------------------
//
// The app is a generic renderer; these endpoints decide what it draws. Auth is
// optional here so the shell can boot pre-login (personality is empty for guests).

// Every SDUI response carries no-store headers so intermediaries (nginx,
// mobile OS URL cache, corporate proxies) never serve a stale catalog.
// Client-side caching is negotiated through `cacheVersion` in bootstrap.
export function noStoreSdui(reply: import("fastify").FastifyReply): void {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
  reply.header("Pragma", "no-cache");
  reply.header("X-Cache-Version", currentCacheVersion());
}

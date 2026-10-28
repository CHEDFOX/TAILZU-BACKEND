/**
 * SIGNED LINKS TO A FILE SOMEONE SHARED (a photo in a chat, a file in a space's Shared). A picture is fetched by the app's image
 * component, which sends no session, so the link itself says who it is for: one viewer, one thread or item, one file, an hour.
 * The route that serves it checks the signature AND that the viewer may still see it (still in the chat or the space).
 *
 * The key is made fresh when the server starts (links are short-lived, and every screen asks for new ones when it loads), so there is
 * nothing to configure and nothing to leak: a restart only means an open screen reloads its pictures.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const KEY = randomBytes(32);
export const LINK_TTL_MS = 3600_000;

const sigOf = (parts: string[], exp: number): string => createHmac("sha256", KEY).update(`${parts.join("|")}|${exp}`).digest("base64url");

/** `?v=<viewer>&exp=…&sig=…` for these parts (viewer first). */
export function signQuery(viewer: string, parts: string[], now = Date.now()): string {
  const exp = now + LINK_TTL_MS;
  return `v=${encodeURIComponent(viewer)}&exp=${exp}&sig=${sigOf([viewer, ...parts], exp)}`;
}

/** Whether a link is good: not expired, and signed for exactly this viewer and these parts. */
export function verifyQuery(q: { v?: unknown; exp?: unknown; sig?: unknown }, parts: string[], now = Date.now()): string | null {
  const viewer = typeof q.v === "string" ? q.v : "";
  const exp = Number(q.exp);
  if (!viewer || !Number.isFinite(exp) || exp <= now || exp > now + LINK_TTL_MS + 60_000 || typeof q.sig !== "string") return null;
  const want = Buffer.from(sigOf([viewer, ...parts], exp));
  const got = Buffer.from(q.sig);
  return got.length === want.length && timingSafeEqual(got, want) ? viewer : null;
}

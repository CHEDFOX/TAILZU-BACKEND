/**
 * THE CINEMA BOT'S FILES: where each picture, still, take and film is kept, and the links the apps open them by.
 *
 * Keys. Everything a person's films and pictures make is a blob (media/blob.ts) under u/<person>/cinema/: films/<film>/<name>,
 * pictures/<id>.<ext>, cast/<key>-<n>.<ext>. A key is only ever made here, from ids we made, so it always passes the blob store's check.
 *
 * Links. A screen shows a still or plays a film through a link of ours, signed and short-lived (`signMedia`), never the storage's own
 * address: /v1/cinema/media/<key>?exp=<ms>&sig=<hmac>. The signature covers the key and the expiry, with CINEMA_MEDIA_SECRET, or a secret
 * made when the server starts when that is not set (a link then lasts until the next restart, which is enough: the screens make new links
 * each time they are drawn). The route (routes/bots/cinema.ts) checks the signature and streams the blob; the link names the person's own
 * folder, so a link is only ever to what its signature was made for.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";

const KEY_RE = /^u\/[A-Za-z0-9_-]{1,80}\/cinema\/[A-Za-z0-9._\-/]{1,200}$/;
export const LINK_TTL_MS = 24 * 3_600_000;
export const MEDIA_PATH = "/v1/cinema/media/";

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4", "audio/mpeg": "mp3", "text/plain": "srt", "application/x-subrip": "srt",
};
export const extOf = (type: string): string => EXT[type] ?? "bin";
export const typeOfKey = (key: string): string => {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  return Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
};

const safe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "x";

export const filmKey = (userId: string, filmId: string, name: string, type: string): string => `u/${safe(userId)}/cinema/films/${safe(filmId)}/${safe(name)}.${extOf(type)}`;
export const pictureKey = (userId: string, id: string, type: string): string => `u/${safe(userId)}/cinema/pictures/${safe(id)}.${extOf(type)}`;
export const castKey = (userId: string, key: string, n: string, type: string): string => `u/${safe(userId)}/cinema/cast/${safe(key)}-${safe(n)}.${extOf(type)}`;

export const isCinemaKey = (key: string): boolean => KEY_RE.test(key) && !key.includes("..");
/** Whose folder a key is in. */
export const ownerOfKey = (key: string): string | null => (isCinemaKey(key) ? key.split("/")[1]! : null);

let processSecret: string | null = null;
function secret(): string {
  const set = getConfig().CINEMA_MEDIA_SECRET;
  if (set) return set;
  processSecret ??= randomBytes(32).toString("hex");
  return processSecret;
}

const sigOf = (key: string, exp: number, s: string): string => createHmac("sha256", s).update(`x0-cinema-media-v1\n${key}\n${exp}`).digest("base64url").slice(0, 43);

/** A signed path to one of the person's files. */
export function signMedia(key: string, o: { ttlMs?: number; now?: number; secret?: string } = {}): string {
  const exp = (o.now ?? Date.now()) + (o.ttlMs ?? LINK_TTL_MS);
  return `${MEDIA_PATH}${key}?exp=${exp}&sig=${sigOf(key, exp, o.secret ?? secret())}`;
}

export function verifyMedia(key: string, exp: string | undefined, sig: string | undefined, o: { now?: number; secret?: string } = {}): boolean {
  if (!isCinemaKey(key) || !exp || !sig || !/^\d{10,16}$/.test(exp)) return false;
  const e = Number(exp);
  if (e < (o.now ?? Date.now())) return false;
  const want = Buffer.from(sigOf(key, e, o.secret ?? secret()));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

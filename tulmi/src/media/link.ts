/**
 * A PERSON'S OWN PICTURE, BY A SIGNED LINK: how the apps draw a file they uploaded (routes/files.ts).
 *
 *   filePicturePath(userId, id)   /v1/files/<user>/<id>/picture?exp=&sig=   signed for that person and that file, a day by default.
 *                                 The signature alone opens it (no session), because an image is loaded by the app's image view,
 *                                 which sends no token. It names the person's own id, so a link is only ever to their own file.
 *   filePictureUrl(userId, id)    the same, whole, on this server's public address
 *   verifyFilePicture(...)        the route's check: not expired, and signed for exactly this person and this file
 *
 * Made fresh each time a screen is drawn or a file is sent, so a link that has expired is simply drawn again.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";

export const PICTURE_TTL_MS = 24 * 3_600_000;
const USER = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let processSecret: string | null = null;
function secret(): string {
  let set: string | undefined;
  try { set = getConfig().MEDIA_LINK_SECRET; } catch { set = undefined; }
  if (set) return set;
  processSecret ??= randomBytes(32).toString("hex");
  return processSecret;
}

const sigOf = (s: string, userId: string, id: string, exp: number): string =>
  createHmac("sha256", s).update(`x0-file-picture-v1\n${userId}\n${id}\n${exp}`).digest("base64url").slice(0, 43);

/** Whether this is a person's id and a file's id a link can be made for. */
export const canLink = (userId: string, id: string): boolean => USER.test(userId) && UUID.test(id);

export function filePicturePath(userId: string, id: string, o: { ttlMs?: number; now?: number; secret?: string } = {}): string {
  const exp = (o.now ?? Date.now()) + (o.ttlMs ?? PICTURE_TTL_MS);
  return `/v1/files/${userId}/${id}/picture?exp=${exp}&sig=${sigOf(o.secret ?? secret(), userId, id, exp)}`;
}

/** The server's public address, as the screens use it. */
export const publicOrigin = (): string => (process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").trim().replace(/\/+$/, "");

export const filePictureUrl = (userId: string, id: string, o: { ttlMs?: number; now?: number; secret?: string } = {}): string =>
  `${publicOrigin()}${filePicturePath(userId, id, o)}`;

export function verifyFilePicture(o: { userId: string; id: string; exp: unknown; sig: unknown; now?: number; secret?: string }): boolean {
  if (!canLink(o.userId, o.id) || typeof o.exp !== "string" || typeof o.sig !== "string" || !/^\d{10,16}$/.test(o.exp)) return false;
  const exp = Number(o.exp);
  if (exp < (o.now ?? Date.now())) return false;
  const want = Buffer.from(sigOf(o.secret ?? secret(), o.userId, o.id, exp));
  const got = Buffer.from(o.sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

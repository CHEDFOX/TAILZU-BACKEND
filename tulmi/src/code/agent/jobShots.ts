/**
 * A JOB'S PICTURES: real screenshots of the running app (screens.ts), kept in R2 under the owner's own key and shown by a signed link. On Cloudflare
 * the Worker keeps them in its R2 binding (SHOTS) and answers the links itself (jobs/src/http.ts): CODE_JOBS_URL + the path.
 *
 *   BlobJobShots(blobs)       put / get over the media blob store (R2, or memory in tests): u/<user>/jobs/<job>/<shot>.png
 *   signJobShotPath(o)        /v1/code/shots/:user/:job/:shot?exp=&sig=   signed for that owner, job and picture, 7 days by default. The
 *                             signature alone opens it (no session), so it works in a page Xode makes and in an image the app loads
 *   verifyJobShotLink(o)      the route's check: not expired, and signed for exactly this owner, job and picture
 *   serveJobShot(o)           the answer to GET /v1/code/shots/:user/:job/:shot?exp=&sig=: the PNG, or the same plain 404 for anything else
 *
 * The same link works in the app, in a page Xode makes (a picture by link) and in the report. Nothing here logs a key or a link.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BlobStore } from "../../media/blob.js";

export const JOB_SHOT_TTL_MS = 7 * 86_400_000;
/** A picture bigger than this is not kept (a full page at desktop size is well under it). */
export const JOB_SHOT_MAX_BYTES = 8 * 1024 * 1024;
const ID = /^js_[0-9a-f]{20}$/;
/** An owner's or a job's id as a key part: letters, digits, "-" and "_" only (no "/" or "."), so a key never leaves its folder. */
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export const isJobShotId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export interface JobShotStore {
  put(userId: string, jobId: string, png: Uint8Array): Promise<{ id: string }>;
  get(userId: string, jobId: string, id: string): Promise<Uint8Array | null>;
}

const keyOf = (userId: string, jobId: string, id: string): string => {
  if (!SAFE.test(userId) || !SAFE.test(jobId) || !isJobShotId(id)) throw new Error("job shots: bad key");
  return `u/${userId}/jobs/${jobId}/${id}.png`;
};

export class BlobJobShots implements JobShotStore {
  constructor(private readonly blobs: BlobStore) {}

  async put(userId: string, jobId: string, png: Uint8Array): Promise<{ id: string }> {
    if (png.byteLength > JOB_SHOT_MAX_BYTES) throw new Error("job shots: the picture is too big");
    const id = `js_${randomBytes(10).toString("hex")}`;
    await this.blobs.put(keyOf(userId, jobId, id), Buffer.from(png), "image/png");
    return { id };
  }

  async get(userId: string, jobId: string, id: string): Promise<Uint8Array | null> {
    if (!isJobShotId(id)) return null;
    const b = await this.blobs.get(keyOf(userId, jobId, id)).catch(() => null);
    return b ? new Uint8Array(b) : null;
  }
}

const sigOf = (secret: string, userId: string, jobId: string, shotId: string, exp: number): string =>
  createHmac("sha256", secret).update(`x0-job-shot-v1\n${userId}\n${jobId}\n${shotId}\n${exp}`).digest("hex").slice(0, 43);

export function signJobShotPath(o: { secret: string; userId: string; jobId: string; shotId: string; ttlMs?: number; now?: number }): string {
  const exp = (o.now ?? Date.now()) + (o.ttlMs ?? JOB_SHOT_TTL_MS);
  return `/v1/code/shots/${o.userId}/${o.jobId}/${o.shotId}?exp=${exp}&sig=${sigOf(o.secret, o.userId, o.jobId, o.shotId, exp)}`;
}

export function verifyJobShotLink(o: { secret: string; userId: string; jobId: string; shotId: string; exp: unknown; sig: unknown; now?: number }): boolean {
  const exp = Number(o.exp);
  if (!o.secret || !Number.isFinite(exp) || exp <= (o.now ?? Date.now()) || typeof o.sig !== "string" || o.sig.length !== 43) return false;
  const want = Buffer.from(sigOf(o.secret, o.userId, o.jobId, o.shotId, exp));
  const got = Buffer.from(o.sig);
  return got.length === want.length && timingSafeEqual(got, want);
}

const SHOT_PATH = /^\/v1\/code\/shots\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})\/(js_[0-9a-f]{20})$/;

/** Whether a path is a picture's (the Worker routes it here). */
export const isJobShotPath = (path: string): boolean => SHOT_PATH.test(path);

/**
 * A picture by its link. The signature alone opens it (no session), so an image in the app and a picture in a page Xode makes both load it; it is signed
 * for exactly this owner, job and picture and stops at `exp`. Anything not exactly right is the same 404: a wrong link says nothing about what exists.
 */
export async function serveJobShot(o: { url: URL; store: JobShotStore | null; secret: string; now?: number }): Promise<Response> {
  const gone = () => new Response(JSON.stringify({ code: "not_found", message: "That picture isn't there." }), { status: 404, headers: { "content-type": "application/json" } });
  const m = SHOT_PATH.exec(o.url.pathname);
  if (!m || !o.store || !o.secret) return gone();
  const [, userId, jobId, shotId] = m as unknown as [string, string, string, string];
  const ok = verifyJobShotLink({ secret: o.secret, userId, jobId, shotId, exp: o.url.searchParams.get("exp"), sig: o.url.searchParams.get("sig"), ...(o.now !== undefined ? { now: o.now } : {}) });
  if (!ok) return gone();
  const png = await o.store.get(userId, jobId, shotId).catch(() => null);
  if (!png) return gone();
  return new Response(png, {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" },
  });
}

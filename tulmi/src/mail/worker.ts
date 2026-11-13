/**
 * THE MAIL BOT, FROM THE VPS'S SIDE: SIGNED JSON CALLS TO THE MAIL WORKER IN mail-worker/ (docs/mail.md).
 *
 * The worker keeps each business's mailbox on our mail server and answers its mail with our AI. Every call is signed exactly as the media
 * and Oracle workers' are (media/worker.ts `workerSignature`: timestamp, nonce, method, path and the body's hash) with MAIL_WORKER_SECRET,
 * and every call is inside one X0 account: `/v1/o/<owner>/...`, where the owner is a hash of the person's id (ownerOf), never the id.
 *
 * The worker's errors are `{ code, message }`, the message written for a person: they are passed on with their status (400, 404, 409, 422,
 * 429), a 5xx as 502 with the worker's words, and a worker that cannot be reached as 503.
 *
 * The worker also calls back, once, to say that mail needs a person (routes/bots/mail.ts POST /v1/mail/notice), signed the same way:
 * verifyWorkerCall checks it.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { workerSignature } from "../media/worker.js";
import type { NonceStore } from "../code/jobs/handoff/sign.js";

/** The worker said no, or could not be reached. `message` is for the person. */
export class MailError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "MailError"; }
}

export interface MailWorker {
  /** `path` is what follows `/v1/o/<owner>` ("" for the account itself), with its query. */
  call<T = Record<string, unknown>>(owner: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T>;
}

/** The person's account as the worker knows it: a hash, enough to keep their businesses apart from everyone else's, nothing more. */
export const ownerOf = (userId: string): string => `mail:${createHash("sha256").update(`mail:${userId}`).digest("hex").slice(0, 32)}`;
export const OWNER = /^mail:[0-9a-f]{32}$/;

const DOWN = "The mail service couldn't be reached just now. Nothing was lost; try again in a moment.";
/** A model call (a brief from the website, a draft written again) takes a while; anything else is quick. */
const SLOW = /\/(brief\/draft|rewrite)$/;

type FetchFn = typeof fetch;

/** The worker, or null when MAIL_WORKER_URL and MAIL_WORKER_SECRET are not both set. */
export function mailWorker(o: { fetchFn?: FetchFn; url?: string; secret?: string; now?: () => number } = {}): MailWorker | null {
  const c = getConfig();
  const url = (o.url ?? c.MAIL_WORKER_URL ?? "").replace(/\/+$/, "");
  const secret = o.secret ?? c.MAIL_WORKER_SECRET ?? "";
  if (!url || !secret) return null;
  const fetchFn = o.fetchFn ?? fetch;
  const now = o.now ?? Date.now;

  return {
    async call<T>(owner: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
      if (!OWNER.test(owner)) throw new MailError(400, "bad_request", "No such account.");
      const pathWithQuery = `/v1/o/${owner}${path}`;
      const bytes = Buffer.from(body === undefined ? "" : JSON.stringify(body), "utf8");
      const timestamp = Math.floor(now() / 1000);
      const nonce = randomBytes(16).toString("hex");
      const signature = workerSignature(secret, { timestamp, nonce, method, pathWithQuery, body: bytes });
      let res: Response;
      try {
        res = await fetchFn(`${url}${pathWithQuery}`, {
          method,
          headers: {
            "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": signature,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: bytes }),
          signal: AbortSignal.timeout(SLOW.test(path.split("?")[0]!) ? 90_000 : 20_000),
        });
      } catch {
        throw new MailError(503, "mail_down", DOWN);
      }
      const data = (await res.json().catch(() => null)) as (T & { code?: string; message?: string }) | null;
      if (res.ok && data) return data;
      const message = typeof data?.message === "string" && data.message ? data.message : DOWN;
      if (res.status >= 400 && res.status < 500 && res.status !== 401) throw new MailError(res.status, String(data?.code ?? "bad_request"), message);
      // 401 is our own signature refused: a setting, not something the person can fix.
      throw new MailError(res.status === 401 ? 503 : 502, res.status === 401 ? "mail_down" : String(data?.code ?? "mail_failed"), res.status === 401 ? DOWN : message);
    },
  };
}

/** Whether a call from the worker is signed with the secret, fresh (a minute either way) and new (its nonce never seen). */
export async function verifyWorkerCall(o: {
  secret: string; method: string; pathWithQuery: string; body: string; header: (name: string) => string | undefined; nonces: NonceStore; now: number;
}): Promise<boolean> {
  const ts = o.header("x-tailzu-timestamp") ?? "";
  const nonce = o.header("x-tailzu-nonce") ?? "";
  const given = o.header("x-tailzu-signature") ?? "";
  if (o.secret.length < 32 || !/^\d{9,11}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(given)) return false;
  if (Math.abs(o.now / 1000 - Number(ts)) > 60) return false;
  const want = Buffer.from(workerSignature(o.secret, { timestamp: Number(ts), nonce, method: o.method, pathWithQuery: o.pathWithQuery, body: Buffer.from(o.body, "utf8") }), "hex");
  const got = Buffer.from(given, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  return await o.nonces.claim(nonce, o.now + 3 * 60_000);
}

/**
 * The account was deleted: every business it had goes, with its mailbox and its mail (the worker's DELETE /v1/o/<owner>). True when there
 * was nothing to do (no worker) or the worker did it; false when it could not be reached, so the caller logs it.
 */
export async function mailForAccountDelete(userId: string, worker: MailWorker | null = mailWorker()): Promise<boolean> {
  if (!worker) return true;
  try {
    await worker.call(ownerOf(userId), "DELETE", "");
    return true;
  } catch {
    return false;
  }
}

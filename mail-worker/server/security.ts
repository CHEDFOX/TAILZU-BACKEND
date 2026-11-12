/**
 * WHO MAY CALL THE WORKER: X0 Bot's server, by a signature over the time, a nonce, the method, the path and query, and the body.
 *
 * The server signs every request with MAIL_WORKER_SECRET, HMAC-SHA256 in hex, over these lines joined by "\n":
 *     v1 / timestamp / nonce / METHOD / path with its query string / SHA-256 of the body in hex
 * and sends X-Tailzu-Timestamp (seconds since the epoch), X-Tailzu-Nonce (16 or more random bytes in hex) and X-Tailzu-Signature. A
 * timestamp more than 60 seconds from this clock, a nonce seen in the last two minutes, or a signature that does not match is refused,
 * so a captured request cannot be sent again, a body cannot be swapped, and a path or a query cannot be changed. The same scheme as the
 * media and Oracle workers (tulmi/src/media/worker.ts workerSignature signs for all three).
 */
import crypto from "node:crypto";

export const VERSION = "v1";
const NONCE = /^[0-9a-f]{16,64}$/;
const SIG = /^[0-9a-f]{64}$/;
const SKEW_S = 60;
const NONCE_TTL_S = 120;
const NONCES_MAX = 100_000;

export function sign(secret: string, o: { timestamp: number; nonce: string; method: string; pathWithQuery: string; body: Buffer }): string {
  const digest = crypto.createHash("sha256").update(o.body).digest("hex");
  const lines = [VERSION, String(o.timestamp), o.nonce, o.method.toUpperCase(), o.pathWithQuery, digest].join("\n");
  return crypto.createHmac("sha256", secret).update(lines).digest("hex");
}

/** Nonces seen lately, forgotten after their time is up; bounded, so it cannot be made to grow without end. */
export class NonceCache {
  private seen = new Map<string, number>();
  use(nonce: string, nowS: number): boolean {
    if (this.seen.size >= NONCES_MAX / 2) for (const [n, until] of this.seen) if (until <= nowS) this.seen.delete(n);
    if (this.seen.size >= NONCES_MAX) return false;          // full of live nonces: refuse rather than forget one that could be replayed
    if ((this.seen.get(nonce) ?? 0) > nowS) return false;
    this.seen.set(nonce, nowS + NONCE_TTL_S);
    return true;
  }
}

/** Null when the request is signed by X0 Bot's server; else why not (said to the caller only as "Not signed."). */
export function refused(secret: string, headers: Record<string, string | string[] | undefined>, method: string, pathWithQuery: string,
  body: Buffer, nonces: NonceCache, nowS = Math.floor(Date.now() / 1000)): string | null {
  const one = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] ?? "" : v ?? ""; };
  const ts = Number(one("x-tailzu-timestamp"));
  const nonce = one("x-tailzu-nonce");
  const sig = one("x-tailzu-signature");
  if (!secret || secret.length < 32) return "the worker has no secret";
  if (!Number.isInteger(ts) || !NONCE.test(nonce) || !SIG.test(sig)) return "not signed";
  if (Math.abs(nowS - ts) > SKEW_S) return "too old or too new";
  const expected = Buffer.from(sign(secret, { timestamp: ts, nonce, method, pathWithQuery, body }), "hex");
  if (!crypto.timingSafeEqual(expected, Buffer.from(sig, "hex"))) return "bad signature";
  if (!nonces.use(nonce, nowS)) return "replayed";
  return null;
}

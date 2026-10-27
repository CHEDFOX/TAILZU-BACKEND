/**
 * SIGNING A CALL BETWEEN THE VPS AND THE JOBS WORKER: HMAC-SHA256, FIVE MINUTES, ONCE.
 *
 * Both sides hold CODE_JOBS_SECRET. A request carries three headers:
 *
 *   x-tailzu-timestamp   epoch milliseconds when it was signed
 *   x-tailzu-nonce       a random value used once (16 to 64 of A-Z a-z 0-9 - _)
 *   x-tailzu-signature   hex HMAC-SHA256 of
 *                          METHOD \n PATH \n TIMESTAMP \n NONCE \n BODY
 *                        METHOD upper case, PATH the URL's path (no query), BODY the exact text sent
 *
 * The nonce is INSIDE the signature on purpose: signed over method, path, timestamp and body
 * alone, a nonce is only a label an attacker could change to replay the same request. Verifying:
 *
 *   1. all three headers are there and the timestamp is a number;
 *   2. the timestamp is within five minutes of now, either way (the window);
 *   3. the signature matches, compared in constant time;
 *   4. only then is the nonce written down; one seen before is a replay. (A nonce is recorded for
 *      requests that PASSED 1 to 3 only, so anyone without the secret cannot fill the memory.)
 *
 * Nothing here logs a secret or a signature. node:crypto's createHmac and timingSafeEqual work on
 * the VPS and, with nodejs_compat, on the Worker.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-tailzu-timestamp";
export const NONCE_HEADER = "x-tailzu-nonce";
export const SIGNATURE_HEADER = "x-tailzu-signature";
/** A request older (or newer) than this is refused. */
export const SIGNATURE_WINDOW_MS = 5 * 60_000;
/** A nonce is remembered this long: the window either side of "now", and a minute over. */
export const NONCE_KEEP_MS = 2 * SIGNATURE_WINDOW_MS + 60_000;

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

export function signingString(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body}`;
}

function mac(secret: string, text: string): string {
  return createHmac("sha256", secret).update(text).digest("hex");
}

export interface SignOptions {
  secret: string;
  method: string;
  /** The URL's path, e.g. "/v1/start". */
  path: string;
  body: string;
  now?: number;
  nonce?: string;
}

/** The three headers for a request. */
export function signRequest(o: SignOptions): Record<string, string> {
  const timestamp = String(o.now ?? Date.now());
  const nonce = o.nonce ?? randomBytes(18).toString("base64url");
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: mac(o.secret, signingString(o.method, o.path, timestamp, nonce, o.body)),
  };
}

/** Remembers nonces. `claim` is true the first time a nonce is seen (until `expiresAt`) and false after. Async so a Durable Object can be one. */
export interface NonceStore {
  claim(nonce: string, expiresAt: number): boolean | Promise<boolean>;
}

/** In this process's memory: enough for the VPS, which runs one backend (docker-compose.yml). */
export class MemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now, private readonly max = 50_000) {}

  claim(nonce: string, expiresAt: number): boolean {
    const t = this.now();
    for (const [n, until] of this.seen) {
      if (until > t) break; // the map is in the order they were added, and so in the order they expire
      this.seen.delete(n);
    }
    if (this.seen.has(nonce)) return false;
    while (this.seen.size >= this.max) this.seen.delete(this.seen.keys().next().value as string);
    this.seen.set(nonce, expiresAt);
    return true;
  }
}

export type VerifyFailure = "missing" | "bad_timestamp" | "expired" | "bad_signature" | "replayed";
export type Verified = { ok: true } | { ok: false; reason: VerifyFailure };

export interface VerifyOptions {
  secret: string;
  method: string;
  path: string;
  body: string;
  /** A header's value, or null/undefined. */
  header: (name: string) => string | null | undefined;
  nonces: NonceStore;
  now?: number;
}

export async function verifyRequest(o: VerifyOptions): Promise<Verified> {
  const timestamp = o.header(TIMESTAMP_HEADER) ?? "";
  const nonce = o.header(NONCE_HEADER) ?? "";
  const given = o.header(SIGNATURE_HEADER) ?? "";
  if (!timestamp || !nonce || !given || !NONCE.test(nonce)) return { ok: false, reason: "missing" };
  if (!/^\d{10,16}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = o.now ?? Date.now();
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_WINDOW_MS) return { ok: false, reason: "expired" };
  const want = Buffer.from(mac(o.secret, signingString(o.method, o.path, timestamp, nonce, o.body)), "hex");
  let got: Buffer;
  try { got = Buffer.from(given, "hex"); } catch { return { ok: false, reason: "bad_signature" }; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad_signature" };
  if (!(await o.nonces.claim(nonce, now + NONCE_KEEP_MS))) return { ok: false, reason: "replayed" };
  return { ok: true };
}

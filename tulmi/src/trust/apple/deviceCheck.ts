/**
 * DEVICECHECK: TWO BITS APPLE KEEPS ON THE PHONE FOR US (docs/trust.md §DeviceCheck).
 *
 * The app hands us a token; we hand that token to Apple and ask for the two bits Apple stores per device for our app, and we
 * may write them back. No entitlement, no prompt, nothing on screen. The device token is never stored and never logged, and
 * the call to Apple carries only the token, a transaction id and a timestamp — never a user id, an email, an address or a
 * score (docs/trust.md rule 10).
 *
 *   bit0   this device has already started a free account
 *   bit1   abuse confirmed — set only by an admin, never by this code on its own
 *
 * The bits outlive reinstalls and are Apple's, not ours, which is the whole point: it is the one per-device memory Apple
 * allows us. Because Apple keeps them until we change them, bit0 only COUNTS while Apple's own last_update_time is inside the
 * last 12 months (score.ts), and an admin clears both for a second-hand phone.
 *
 * The call is signed with an ES256 JWT made from the DeviceCheck key, exactly as the Sign in with Apple client secret is
 * (auth/appleSignIn.ts): the same jose, the same PKCS8-or-base64 key, the Key ID in the header, the team as issuer.
 */
import { importPKCS8, SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { getConfig } from "../../config.js";

const LIVE = "https://api.devicecheck.apple.com";
const SANDBOX = "https://api.development.devicecheck.apple.com";
/** How long one call's JWT lives. Made for a single call. */
const JWT_SECONDS = 300;
const CALL_MS = 10_000;

export interface DeviceCheckConfig { keyId: string; teamId: string; privateKey: string }

/** The key and who we are, or null while it is not set (and DeviceCheck is simply skipped: no signal, never a penalty). */
export function deviceCheckConfig(env = getConfig()): DeviceCheckConfig | null {
  const keyId = env.APPLE_DEVICECHECK_KEY_ID?.trim();
  const raw = env.APPLE_DEVICECHECK_PRIVATE_KEY?.trim();
  if (!keyId || !raw) return null;
  const pem = raw.includes("BEGIN PRIVATE KEY") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
  if (!pem.includes("BEGIN PRIVATE KEY")) return null;
  return { keyId, teamId: env.APPLE_SIWA_TEAM_ID.trim(), privateKey: pem };
}

/** The bearer Apple's two endpoints take: ES256, the key's id in the header, the team as issuer, nothing else in it. */
export async function deviceCheckJwt(c: DeviceCheckConfig, now = Date.now()): Promise<string> {
  const key = await importPKCS8(c.privateKey, "ES256");
  const iat = Math.floor(now / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: c.keyId })
    .setIssuer(c.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + JWT_SECONDS)
    .sign(key);
}

export interface Bits { bit0: boolean; bit1: boolean; /** Apple's last_update_time, "2026-11". */ month?: string }
export type QueryResult = { ok: true; bits: Bits } | { ok: false; why: "not_configured" | "not_found" | "bad_token" | "failed" };

export interface CallOpts {
  token: string;
  env?: "production" | "development";
  fetchFn?: typeof fetch;
  config?: DeviceCheckConfig | null;
  now?: number;
}

/** The body every call shares. The transaction id is random and ours; nothing of the person's is in it. */
function body(token: string, now: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ device_token: token, transaction_id: randomUUID(), timestamp: now, ...extra });
}

async function call(path: string, o: CallOpts, extra: Record<string, unknown> = {}): Promise<{ status: number; text: string } | null> {
  const c = o.config === undefined ? deviceCheckConfig() : o.config;
  if (!c) return null;
  const now = o.now ?? Date.now();
  const base = o.env === "development" ? SANDBOX : LIVE;
  const jwt = await deviceCheckJwt(c, now);
  const stop = AbortSignal.timeout(CALL_MS);
  const res = await (o.fetchFn ?? fetch)(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: body(o.token, now, extra),
    signal: stop,
  });
  return { status: res.status, text: await res.text() };
}

/** Apple's answer to query_two_bits. A device Apple has never had bits for answers "not found", which is not a penalty. */
export async function queryTwoBits(o: CallOpts): Promise<QueryResult> {
  let got;
  try { got = await call("/v1/query_two_bits", o); } catch { return { ok: false, why: "failed" }; }
  if (!got) return { ok: false, why: "not_configured" };
  // A device Apple holds nothing for is answered with 200 and the words "Failed to find bit state", not with JSON — which
  // is not a penalty, it is a phone we have never seen. Read before the JSON, or it would land as "failed".
  if (/not.*found|failed to find/i.test(got.text)) return { ok: false, why: "not_found" };
  if (got.status === 200) {
    try {
      const d = JSON.parse(got.text || "{}") as { bit0?: unknown; bit1?: unknown; last_update_time?: unknown };
      return { ok: true, bits: { bit0: d.bit0 === true, bit1: d.bit1 === true, ...(typeof d.last_update_time === "string" ? { month: d.last_update_time } : {}) } };
    } catch { return { ok: false, why: "failed" }; }
  }
  if (got.status === 400) return { ok: false, why: "bad_token" };
  return { ok: false, why: "failed" };
}

/** Writing the bits back. bit1 only ever comes from an admin (routes/admin/trust.ts), never from the scoring code. */
export async function updateTwoBits(o: CallOpts & { bits: Bits }): Promise<boolean> {
  try {
    const got = await call("/v1/update_two_bits", o, { bit0: o.bits.bit0, bit1: o.bits.bit1 });
    return !!got && got.status === 200;
  } catch { return false; }
}

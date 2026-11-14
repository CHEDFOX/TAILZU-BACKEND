/**
 * PLAY INTEGRITY: "IS THIS OUR REAL APP, FROM PLAY, ON A REAL ANDROID PHONE?" (docs/trust.md §Play Integrity).
 *
 * The app asks Google for a token; we send that token to Google to decode (the standard request, server side) and keep only
 * the labels that come back. The token is never stored, and the call carries nothing but the token: no user id, no email, no
 * address, no score (docs/trust.md rule 10). Google's own terms forbid using any of this to fingerprint or track a device, so
 * nothing here builds an id out of the verdict's contents.
 *
 * What is checked: the package is ours, the request hash is the one we asked for, the token is fresh (two minutes), and the
 * signing certificate matches the build we published. What is kept: `appRecognitionVerdict`, the device labels and the
 * licensing verdict, as words.
 *
 * NO SIGNAL IS NOT A PENALTY (docs/trust.md rule 6). An EAS development or preview build is not Play-recognised; a phone
 * without Play services or with a custom ROM fails device integrity; our own internal track is its own answer. All of that is
 * "no signal" unless the build CLAIMED it can do this and then failed.
 *
 * The service account is signed RS256 and exchanged for an access token at oauth2.googleapis.com, the same way the Google
 * connectors already do it (connectors/google/oauth.ts).
 */
import { importPKCS8, SignJWT } from "jose";
import { createHash } from "node:crypto";
import { getConfig } from "../../config.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/playintegrity";
const PACKAGE = "com.tulmi.app";
const CALL_MS = 15_000;
/** How old a token may be when we decode it. */
export const FRESH_MS = 2 * 60_000;

export interface PlayConfig { email: string; privateKey: string; project: string }

/** What the phone hashes into its request, so a token cannot be replayed into another step (500 bytes max, so hex of 32). */
export const integrityRequestHash = (challenge: string): string =>
  createHash("sha256").update(`x0|integrity|${challenge}`, "utf8").digest("hex");

/**
 * The service account from PLAY_INTEGRITY_SERVICE_ACCOUNT (the downloaded JSON, base64 on one line, as the Apple key is),
 * or null while it is not set — and then Play Integrity is simply skipped.
 */
export function playConfig(env = getConfig()): PlayConfig | null {
  const raw = env.PLAY_INTEGRITY_SERVICE_ACCOUNT?.trim();
  const project = env.PLAY_INTEGRITY_CLOUD_PROJECT?.trim();
  if (!raw) return null;
  let json: { client_email?: unknown; private_key?: unknown };
  try {
    const text = raw.trimStart().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    json = JSON.parse(text) as typeof json;
  } catch { return null; }
  const email = typeof json.client_email === "string" ? json.client_email : "";
  const privateKey = typeof json.private_key === "string" ? json.private_key.replace(/\\n/g, "\n") : "";
  if (!email || !privateKey.includes("BEGIN PRIVATE KEY")) return null;
  return { email, privateKey, project: project ?? "" };
}

/** An access token for the Play Integrity API, from the service account's own assertion. */
export async function accessToken(c: PlayConfig, o: { fetchFn?: typeof fetch; now?: number } = {}): Promise<string | null> {
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const key = await importPKCS8(c.privateKey, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(c.email).setSubject(c.email).setAudience(TOKEN_URL)
    .setIssuedAt(now).setExpirationTime(now + 300)
    .sign(key);
  const res = await (o.fetchFn ?? fetch)(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal: AbortSignal.timeout(CALL_MS),
  });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  return typeof d?.access_token === "string" ? d.access_token : null;
}

export interface IntegrityVerdict {
  app?: string;
  device?: string[];
  licence?: string;
  /** Whether the signing certificate is the one we publish with. */
  certificateMatches?: boolean;
}

export type DecodeResult =
  | { ok: true; verdict: IntegrityVerdict }
  | { ok: false; why: "not_configured" | "failed" | "package" | "hash" | "stale" | "certificate" };

export interface DecodeOpts {
  token: string;
  challenge: string;
  fetchFn?: typeof fetch;
  config?: PlayConfig | null;
  /** The SHA-256 of the signing certificate we publish with, as Play shows it (colon hex). */
  signingSha256?: string | undefined;
  now?: number;
}

/** Play's base64url of a certificate digest, from the colon hex Play Console shows (as routes/site/wellKnown.ts does). */
export const digestToBase64 = (colonHex: string): string =>
  Buffer.from(colonHex.replace(/:/g, ""), "hex").toString("base64url");

/** One integrity token, decoded by Google and checked against what we asked for. */
export async function decodeIntegrityToken(o: DecodeOpts): Promise<DecodeResult> {
  const c = o.config === undefined ? playConfig() : o.config;
  if (!c) return { ok: false, why: "not_configured" };
  const now = o.now ?? Date.now();
  let payload: Record<string, unknown> | null = null;
  try {
    const bearer = await accessToken(c, { ...(o.fetchFn ? { fetchFn: o.fetchFn } : {}), now });
    if (!bearer) return { ok: false, why: "failed" };
    const res = await (o.fetchFn ?? fetch)(`https://playintegrity.googleapis.com/v1/${PACKAGE}:decodeIntegrityToken`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ integrity_token: o.token }),
      signal: AbortSignal.timeout(CALL_MS),
    });
    if (!res.ok) return { ok: false, why: "failed" };
    const d = (await res.json()) as { tokenPayloadExternal?: Record<string, unknown> };
    payload = d.tokenPayloadExternal ?? null;
  } catch { return { ok: false, why: "failed" }; }
  if (!payload) return { ok: false, why: "failed" };
  return checkPayload(payload, { challenge: o.challenge, now, signingSha256: o.signingSha256 ?? process.env.ANDROID_SIGNING_SHA256 });
}

/**
 * Google's decoded payload, checked. Kept apart from the call so every rule is a test with no network in the way.
 */
export function checkPayload(
  payload: Record<string, unknown>,
  o: { challenge: string; now: number; signingSha256?: string | undefined },
): DecodeResult {
  const request = (payload.requestDetails ?? {}) as Record<string, unknown>;
  const app = (payload.appIntegrity ?? {}) as Record<string, unknown>;
  const device = (payload.deviceIntegrity ?? {}) as Record<string, unknown>;
  const account = (payload.accountDetails ?? {}) as Record<string, unknown>;

  if (String(request.requestPackageName ?? "") !== PACKAGE) return { ok: false, why: "package" };
  if (String(request.requestHash ?? "") !== integrityRequestHash(o.challenge)) return { ok: false, why: "hash" };
  const at = Number(request.timestampMillis ?? 0);
  if (!Number.isFinite(at) || Math.abs(o.now - at) > FRESH_MS) return { ok: false, why: "stale" };

  const verdict: IntegrityVerdict = {
    ...(typeof app.appRecognitionVerdict === "string" ? { app: app.appRecognitionVerdict } : {}),
    ...(Array.isArray(device.deviceRecognitionVerdict) ? { device: device.deviceRecognitionVerdict.map(String) } : {}),
    ...(typeof account.appLicensingVerdict === "string" ? { licence: account.appLicensingVerdict } : {}),
  };

  // The certificate only has to match when Google says it saw one (an unrecognised build carries none).
  const digests = Array.isArray(app.certificateSha256Digest) ? app.certificateSha256Digest.map(String) : [];
  if (digests.length && o.signingSha256) {
    const want = digestToBase64(o.signingSha256);
    verdict.certificateMatches = digests.includes(want);
    if (!verdict.certificateMatches) return { ok: false, why: "certificate" };
  }
  return { ok: true, verdict };
}

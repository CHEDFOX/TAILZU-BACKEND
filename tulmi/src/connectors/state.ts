/**
 * THE CONNECTORS' ERROR, AND THE SIGNED STATE THAT CARRIES A SIGN-IN BACK.
 *
 * Split out of oauth.ts so that the Code bot's modules (and the Cloudflare jobs
 * Worker that bundles them) can use ConnectorError, signState and verifyState
 * without pulling in the MCP SDK and the egress guard (undici, node:dns,
 * node:net) that the rest of oauth.ts needs. oauth.ts re-exports all of it, so
 * every existing import keeps working.
 */
import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { stateKey } from "./crypto.js";

export const STATE_TTL_SEC = 10 * 60;
const ISSUER = "tailzu-connectors";
const AUDIENCE = "connector-oauth";

/** A failure with a plain-words message and a code the app can switch on. */
export class ConnectorError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** The auth server a sign-in was sent to, and whether it promised to say so on the way back (RFC 9207). */
export interface StateIssuer { issuer: string; required: boolean }

export async function signState(userId: string, connectorId: string, now = Date.now(), key = stateKey(), as?: StateIssuer): Promise<string> {
  const iat = Math.floor(now / 1000);
  // "asi" (auth server issuer) and "isr" (iss required), not "iss": this token's
  // own iss is ours, ISSUER, and is checked as such.
  return new SignJWT({ uid: userId, cid: connectorId, ...(as ? { asi: as.issuer, isr: as.required } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setJti(randomUUID())
    .setIssuedAt(iat).setExpirationTime(iat + STATE_TTL_SEC)
    .sign(key);
}

export interface VerifiedState {
  userId: string;
  connectorId: string;
  /** Set when the sign-in found an auth server: the issuer the callback is held to. */
  issuer?: string;
  issRequired?: boolean;
}

export async function verifyState(token: string, now = Date.now(), key = stateKey()): Promise<VerifiedState> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"], currentDate: new Date(now),
    });
    if (typeof payload.uid !== "string" || typeof payload.cid !== "string") throw new Error("shape");
    const as = typeof payload.asi === "string" ? { issuer: payload.asi, issRequired: payload.isr === true } : {};
    return { userId: payload.uid, connectorId: payload.cid, ...as };
  } catch {
    throw new ConnectorError("bad_state", "That sign-in link has expired or isn't valid. Start again from Tailzu.");
  }
}

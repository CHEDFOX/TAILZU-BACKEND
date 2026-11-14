/**
 * APP ATTEST: "IS THIS OUR REAL APP, ON A REAL iPHONE?" (docs/trust.md §App Attest).
 *
 * The phone makes a key in its Secure Enclave, Apple signs a statement about it, and we check that statement here. What we
 * keep afterwards is the public key and a counter — never a device id, because Apple's licence forbids deriving one, and
 * never the attestation itself.
 *
 * WHAT IS CHECKED, in this order, and all of it before anything is stored:
 *   1. the object is CBOR with fmt "apple-appattest"
 *   2. its certificate chain reaches Apple's own root (committed beside this file, its fingerprint pinned below)
 *   3. the nonce in the leaf's extension 1.2.840.113635.100.8.2 equals SHA256(authData ‖ clientDataHash)
 *   4. SHA256(the leaf's public key point) equals the key id the phone sent, and the credential id inside authData
 *   5. the rpIdHash equals SHA256("<team>.<bundle>")
 *   6. the counter is 0 (a fresh key) and the aaguid is "appattest" (production) or "appattestdevelop"
 *
 * An assertion later is the same key signing Apple's NONCE — SHA256(authenticatorData ‖ clientDataHash), hashed again by
 * the signature itself — with a counter that must have gone up. A failure is a reason code, never an exception a route has
 * to catch: callers get { ok: false, why }.
 *
 * THE TWO HALVES OF THE CONVENTION. What goes into the client data hash is ours: "x0|attest|" + challenge and
 * "x0|assert|" + challenge, which is what the phone's own module does. What is done with it is Apple's, and is the same
 * on both sides (attestNonce below). A real TestFlight device's attestation and assertion replace the made-up fixtures at
 * N0 item 9, and `TRUST_ATTEST` stays off until they verify.
 */
import { createHash, createPublicKey, verify as verifySignature, X509Certificate } from "node:crypto";
import { APPLE_APP_ATTEST_ROOT_PEM } from "./appleRoot.js";
import { decodeCbor, derExtension, mapGet, nonceFromExtension } from "./cbor.js";

/** Apple's own extension, which holds the nonce the attestation must agree with. */
export const NONCE_OID = "1.2.840.113635.100.8.2";
/** Apple's App Attest root, as published at apple.com/certificateauthority. Pinned, so a swapped root fails loudly. */
export const ROOT_SHA256 = "1CB9823BA28BA6AD2D33A006941DE2AE4F513EF1D4E831B9F7E0FA7B6242C932";

/** What the phone hashes into the attestation, so a challenge of ours cannot be replayed into another step. */
export const attestClientData = (challenge: string): Buffer => createHash("sha256").update(`x0|attest|${challenge}`, "utf8").digest();
export const assertClientData = (challenge: string): Buffer => createHash("sha256").update(`x0|assert|${challenge}`, "utf8").digest();

/**
 * Apple's own nonce, both sides of App Attest: SHA256(authenticatorData ‖ clientDataHash). The signature over it is an
 * ordinary ECDSA-SHA256 signature, so what the key really signs is SHA256 of this — Apple's steps say "apply a SHA256
 * hash over the result to form nonce", then "verify that the signature is valid for nonce", and a real device's
 * assertion fails against anything else.
 */
export const attestNonce = (authData: Buffer, clientDataHash: Buffer): Buffer =>
  createHash("sha256").update(Buffer.concat([authData, clientDataHash])).digest();

let rootHeld: X509Certificate | null = null;

/** Apple's root, read from the text beside this file (appleRoot.ts) and checked against the pinned fingerprint. */
export function appleRoot(pem: string = APPLE_APP_ATTEST_ROOT_PEM): X509Certificate {
  if (rootHeld) return rootHeld;
  const cert = new X509Certificate(pem);
  const got = cert.fingerprint256.replace(/:/g, "").toUpperCase();
  if (got !== ROOT_SHA256) throw new Error("app attest: the root certificate beside appAttest.ts is not Apple's");
  rootHeld = cert;
  return cert;
}

/** Tests. */
export function resetRootForTests(): void { rootHeld = null; }

export interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  counter: number;
  aaguid: string;
  credentialId: Buffer;
}

/** The fixed part of Apple's authenticator data: 32 + 1 + 4 + 16 + 2 bytes, then the credential id. */
export function readAuthData(buf: Buffer): AuthData | null {
  if (buf.length < 55) return null;
  const idLength = buf.readUInt16BE(53);
  if (buf.length < 55 + idLength) return null;
  return {
    rpIdHash: Buffer.from(buf.subarray(0, 32)),
    flags: buf[32]!,
    counter: buf.readUInt32BE(33),
    aaguid: buf.subarray(37, 53).toString("utf8").replace(/\0+$/, ""),
    credentialId: Buffer.from(buf.subarray(55, 55 + idLength)),
  };
}

/** The EC point out of an SPKI public key: the last 65 bytes, which start 0x04. What Apple hashes into the key id. */
export function pointOf(spki: Buffer): Buffer | null {
  const at = spki.length - 65;
  return at >= 0 && spki[at] === 0x04 ? Buffer.from(spki.subarray(at)) : null;
}

export type Fail =
  | "not_cbor" | "bad_format" | "no_chain" | "chain" | "expired" | "nonce" | "key_id" | "rp_id" | "counter" | "aaguid"
  | "no_key" | "signature" | "replayed";

export interface Attested {
  ok: true;
  keyId: string;
  /** The device's public key, SPKI, as it is stored. */
  publicKey: Buffer;
  env: "production" | "development";
  receipt: Buffer | null;
  counter: number;
}
export type AttestResult = Attested | { ok: false; why: Fail };

export interface AttestOpts {
  /** base64 of the CBOR attestation object. */
  attestation: string;
  /** The key id as the phone sent it (base64 of SHA256 of the key point). */
  keyId: string;
  challenge: string;
  /** "6552H8HYA4.com.tulmi.app". */
  appId: string;
  /** For tests and a development build: a root to chain to instead of Apple's. */
  root?: X509Certificate;
  /** Tests only: the client data hash to check against, instead of the one this file makes from the challenge. */
  clientDataHash?: Buffer;
  now?: number;
}

/** One attestation, checked whole. Nothing is stored here; the caller stores what comes back. */
export function verifyAttestation(o: AttestOpts): AttestResult {
  let object: unknown;
  let raw: Buffer;
  try {
    raw = Buffer.from(o.attestation, "base64");
    object = decodeCbor(raw);
  } catch { return { ok: false, why: "not_cbor" }; }
  const fmt = mapGet(object as never, "fmt");
  const stmt = mapGet(object as never, "attStmt");
  const authDataRaw = mapGet(object as never, "authData");
  if (fmt !== "apple-appattest" || !(authDataRaw instanceof Buffer) || !stmt) return { ok: false, why: "bad_format" };
  const x5c = mapGet(stmt, "x5c");
  if (!Array.isArray(x5c) || !x5c.length || !x5c.every((c) => c instanceof Buffer)) return { ok: false, why: "no_chain" };
  const receiptRaw = mapGet(stmt, "receipt");

  // The chain: leaf, then whatever Apple sent above it, up to the root we hold.
  let certs: X509Certificate[];
  try { certs = (x5c as Buffer[]).map((der) => new X509Certificate(der)); } catch { return { ok: false, why: "no_chain" }; }
  // A root that cannot be read is a reason code like any other, never a 500 on a route the phone calls in the background.
  let root: X509Certificate;
  try { root = o.root ?? appleRoot(); } catch { return { ok: false, why: "no_chain" }; }
  const now = o.now ?? Date.now();
  const chain = [...certs, root];
  for (const cert of chain) {
    const from = Date.parse(cert.validFrom), to = Date.parse(cert.validTo);
    if (Number.isFinite(from) && now < from) return { ok: false, why: "expired" };
    if (Number.isFinite(to) && now > to) return { ok: false, why: "expired" };
  }
  // Every promise this file makes is a reason code, so even a chain that cannot be checked at all answers one.
  try {
    for (let i = 0; i < chain.length - 1; i++) {
      if (!chain[i]!.verify(chain[i + 1]!.publicKey)) return { ok: false, why: "chain" };
    }
  } catch { return { ok: false, why: "chain" }; }

  const leaf = certs[0]!;
  const spki = leaf.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const point = pointOf(spki);
  if (!point) return { ok: false, why: "no_key" };

  // The nonce: our challenge, Apple's authData, and nothing else, hashed the one way both sides agree on.
  const clientDataHash = o.clientDataHash ?? attestClientData(o.challenge);
  const want = attestNonce(authDataRaw, clientDataHash);
  const extension = derExtension(Buffer.from(leaf.raw), NONCE_OID);
  const got = extension ? nonceFromExtension(extension) : null;
  if (!got || !got.equals(want)) return { ok: false, why: "nonce" };

  const keyId = createHash("sha256").update(point).digest();
  if (keyId.toString("base64") !== o.keyId.trim()) return { ok: false, why: "key_id" };

  const authData = readAuthData(authDataRaw);
  if (!authData) return { ok: false, why: "bad_format" };
  if (!authData.credentialId.equals(keyId)) return { ok: false, why: "key_id" };
  if (!createHash("sha256").update(o.appId, "utf8").digest().equals(authData.rpIdHash)) return { ok: false, why: "rp_id" };
  if (authData.counter !== 0) return { ok: false, why: "counter" };
  const env = authData.aaguid === "appattest" ? "production" : authData.aaguid === "appattestdevelop" ? "development" : null;
  if (!env) return { ok: false, why: "aaguid" };

  return {
    ok: true, keyId: o.keyId.trim(), publicKey: spki, env,
    receipt: receiptRaw instanceof Buffer ? receiptRaw : null, counter: authData.counter,
  };
}

export interface AssertOpts {
  /** base64 of the CBOR assertion. */
  assertion: string;
  challenge: string;
  appId: string;
  /** The key as it was stored at attestation (SPKI). */
  publicKey: Buffer;
  /** The counter as it was last stored: this assertion's must be higher. */
  signCount: number;
  /** Tests only: the client data hash the phone signed, instead of the one this file makes from the challenge. */
  clientDataHash?: Buffer;
}

export type AssertResult = { ok: true; counter: number } | { ok: false; why: Fail };

/** One assertion: the stored key signing our challenge, with a counter that has gone up. */
export function verifyAssertion(o: AssertOpts): AssertResult {
  let object: unknown;
  try { object = decodeCbor(Buffer.from(o.assertion, "base64")); } catch { return { ok: false, why: "not_cbor" }; }
  const signature = mapGet(object as never, "signature");
  const authDataRaw = mapGet(object as never, "authenticatorData");
  if (!(signature instanceof Buffer) || !(authDataRaw instanceof Buffer)) return { ok: false, why: "bad_format" };
  // An assertion's authenticator data is the short form: the rpIdHash, the flags and the counter, and nothing after them.
  if (authDataRaw.length < 37) return { ok: false, why: "bad_format" };
  const rpIdHash = authDataRaw.subarray(0, 32);
  const counter = authDataRaw.readUInt32BE(33);
  if (!createHash("sha256").update(o.appId, "utf8").digest().equals(rpIdHash)) return { ok: false, why: "rp_id" };
  if (counter <= o.signCount) return { ok: false, why: "replayed" };
  const clientDataHash = o.clientDataHash ?? assertClientData(o.challenge);
  let key;
  try { key = createPublicKey({ key: o.publicKey, format: "der", type: "spki" }); } catch { return { ok: false, why: "no_key" }; }
  // Apple's convention, and the whole point of attestNonce: the device signs the NONCE, which is itself a hash of the
  // authenticator data and the client data hash. Verifying over the concatenation instead would turn away every real
  // assertion — and score it as an attestation claimed and failed.
  const ok = verifySignature("sha256", attestNonce(authDataRaw, clientDataHash), key, signature);
  return ok ? { ok: true, counter } : { ok: false, why: "signature" };
}

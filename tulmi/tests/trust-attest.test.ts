/**
 * ATTESTATION, VERIFIED (src/trust/apple/**, src/trust/google/playIntegrity.ts; docs/trust.md §App Attest, §DeviceCheck,
 * §Play Integrity).
 *
 * The vectors in tests/fixtures/trust-appattest are MADE UP: a chain of our own, signed by a root of our own, so every rule
 * of the verifier can be checked here with no device in the room. N0 item 9 replaces them with vectors from a real
 * TestFlight build and a real phone, and `TRUST_ATTEST` stays off until those verify.
 *
 * What the calls to Apple and Google may carry is a rule, not a detail (docs/trust.md rule 10), so the two clients are
 * driven through a spy on fetch and the body is read: the device or integrity token, our own transaction id and timestamp,
 * and nothing about the person.
 */
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
});

const { X509Certificate } = await import("node:crypto");
const {
  appleRoot, assertClientData, attestClientData, attestNonce, pointOf, readAuthData, resetRootForTests, verifyAssertion,
  verifyAttestation, NONCE_OID, ROOT_SHA256,
} = await import("../src/trust/apple/appAttest.js");
const { decodeCbor, derExtension, mapGet, nonceFromExtension, oidToDer, tlv } = await import("../src/trust/apple/cbor.js");
const { deviceCheckConfig, deviceCheckJwt, queryTwoBits, updateTwoBits } = await import("../src/trust/apple/deviceCheck.js");
const { accessToken, checkPayload, decodeIntegrityToken, digestToBase64, integrityRequestHash, playConfig, FRESH_MS } =
  await import("../src/trust/google/playIntegrity.js");
const { resetConfigForTests } = await import("../src/config.js");
resetConfigForTests();

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/trust-appattest");
const V = JSON.parse(fs.readFileSync(path.join(FIXTURES, "vectors.json"), "utf8")) as {
  appId: string; challenge: string; keyId: string; attestation: string; assertion: string; publicKeySpki: string;
};
const testRoot = new X509Certificate(fs.readFileSync(path.join(FIXTURES, "root.pem")));
const base = { attestation: V.attestation, keyId: V.keyId, challenge: V.challenge, appId: V.appId, root: testRoot };

describe("the CBOR and DER readers", () => {
  it("reads the numbers, strings, arrays and maps Apple sends, and refuses the rest", () => {
    expect(decodeCbor(Buffer.from("00", "hex"))).toBe(0);
    expect(decodeCbor(Buffer.from("1818", "hex"))).toBe(24);
    expect(decodeCbor(Buffer.from("63616263", "hex"))).toBe("abc");
    expect(decodeCbor(Buffer.from("42aabb", "hex"))).toEqual(Buffer.from("aabb", "hex"));
    expect(decodeCbor(Buffer.from("820102", "hex"))).toEqual([1, 2]);
    const map = decodeCbor(Buffer.from("a1636b65790a", "hex"));
    expect(mapGet(map, "key")).toBe(10);
    // Trailing bytes, a truncated item and a kind this file does not read are all refused rather than guessed at.
    expect(() => decodeCbor(Buffer.from("0000", "hex"))).toThrow();
    expect(() => decodeCbor(Buffer.from("42aa", "hex"))).toThrow();
    expect(() => decodeCbor(Buffer.from("c0", "hex"))).toThrow();
  });

  it("writes an object identifier the way a certificate holds it", () => {
    expect(oidToDer("1.2.840.113635.100.8.2").toString("hex")).toBe("2a864886f763640802");
    expect(oidToDer("2.5.29.17").toString("hex")).toBe("551d11");
    expect(() => oidToDer("nope")).toThrow();
  });

  it("finds Apple's nonce extension in the leaf, and nothing in a certificate without one", () => {
    const attestation = decodeCbor(Buffer.from(V.attestation, "base64"));
    const stmt = mapGet(attestation, "attStmt");
    const x5c = mapGet(stmt!, "x5c") as Buffer[];
    const ext = derExtension(x5c[0]!, NONCE_OID);
    expect(ext).not.toBeNull();
    expect(nonceFromExtension(ext!)).toHaveLength(32);
    expect(derExtension(Buffer.from(testRoot.raw), NONCE_OID)).toBeNull();
    expect(tlv(Buffer.from("3003020101", "hex"), 0).tag).toBe(0x30);
  });
});

describe("App Attest: the attestation", () => {
  it("verifies the made-up vectors whole, and says which key to keep", () => {
    const got = verifyAttestation(base);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.keyId).toBe(V.keyId);
    expect(got.env).toBe("production");
    expect(got.counter).toBe(0);
    expect(got.publicKey.toString("base64")).toBe(V.publicKeySpki);
    expect(got.receipt).not.toBeNull();
    // The key id really is the hash of the key's own point, which is what makes it not a device id we chose.
    expect(createHash("sha256").update(pointOf(got.publicKey)!).digest().toString("base64")).toBe(V.keyId);
  });

  it("refuses another app's bundle id", () => {
    expect(verifyAttestation({ ...base, appId: "6552H8HYA4.com.someone.else" })).toEqual({ ok: false, why: "rp_id" });
  });

  it("refuses a challenge that is not the one the nonce was made from", () => {
    expect(verifyAttestation({ ...base, challenge: "a-different-challenge" })).toEqual({ ok: false, why: "nonce" });
  });

  it("refuses a key id that does not match the key", () => {
    expect(verifyAttestation({ ...base, keyId: Buffer.alloc(32).toString("base64") })).toEqual({ ok: false, why: "key_id" });
  });

  it("refuses a chain that does not reach the root we hold", () => {
    resetRootForTests();
    const got = verifyAttestation({ ...base, root: undefined });
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(["chain", "expired"]).toContain(got.why);
  });

  it("refuses something that is not an attestation object at all", () => {
    // A byte string that says it is one byte long and then stops: not CBOR, and refused rather than guessed at.
    expect(verifyAttestation({ ...base, attestation: Buffer.from("41", "hex").toString("base64") })).toEqual({ ok: false, why: "not_cbor" });
    const notApple = Buffer.from("a163666d7463666f6f", "hex").toString("base64"); // { fmt: "foo" }
    expect(verifyAttestation({ ...base, attestation: notApple })).toEqual({ ok: false, why: "bad_format" });
  });

  it("refuses a chain that has run out, by the clock it is given", () => {
    expect(verifyAttestation({ ...base, now: Date.parse("2000-01-01T00:00:00Z") })).toEqual({ ok: false, why: "expired" });
  });

  it("reads the fixed part of Apple's authenticator data, and refuses a short one", () => {
    const attestation = decodeCbor(Buffer.from(V.attestation, "base64"));
    const authData = mapGet(attestation, "authData") as Buffer;
    const read = readAuthData(authData)!;
    expect(read.aaguid).toBe("appattest");
    expect(read.counter).toBe(0);
    expect(read.credentialId.toString("base64")).toBe(V.keyId);
    expect(read.rpIdHash).toEqual(createHash("sha256").update(V.appId, "utf8").digest());
    expect(readAuthData(Buffer.alloc(10))).toBeNull();
  });

  it("hashes the challenge one way for an attestation and another for an assertion", () => {
    expect(attestClientData("abc")).toEqual(createHash("sha256").update("x0|attest|abc", "utf8").digest());
    expect(assertClientData("abc")).toEqual(createHash("sha256").update("x0|assert|abc", "utf8").digest());
    expect(attestClientData("abc")).not.toEqual(assertClientData("abc"));
  });
});

describe("App Attest: the assertion", () => {
  const stored = {
    assertion: V.assertion, challenge: V.challenge, appId: V.appId,
    publicKey: Buffer.from(V.publicKeySpki, "base64"), signCount: 0,
  };

  it("verifies with the stored key, and says the new counter", () => {
    expect(verifyAssertion(stored)).toEqual({ ok: true, counter: 1 });
  });

  it("refuses a counter that has not gone up: an assertion is used once", () => {
    expect(verifyAssertion({ ...stored, signCount: 1 })).toEqual({ ok: false, why: "replayed" });
    expect(verifyAssertion({ ...stored, signCount: 9 })).toEqual({ ok: false, why: "replayed" });
  });

  it("refuses another challenge, another app and another key", () => {
    expect(verifyAssertion({ ...stored, challenge: "another" })).toEqual({ ok: false, why: "signature" });
    expect(verifyAssertion({ ...stored, appId: "6552H8HYA4.com.someone.else" })).toEqual({ ok: false, why: "rp_id" });
    const other = Buffer.from(V.publicKeySpki, "base64");
    other[other.length - 1] = other[other.length - 1]! ^ 0xff;
    const got = verifyAssertion({ ...stored, publicKey: other });
    expect(got.ok).toBe(false);
  });

  it("refuses something that is not an assertion", () => {
    expect(verifyAssertion({ ...stored, assertion: "bm90IGNib3I" })).toEqual({ ok: false, why: "not_cbor" });
  });

  /**
   * THE CONVENTION, AGAINST APPLE'S WORDS RATHER THAN AGAINST OUR OWN FIXTURE.
   *
   * Apple's steps are: hash the client data; concatenate the authenticator data and that hash and "apply a SHA256 hash
   * over the result to form nonce"; then "verify that the assertion's signature is valid for nonce". So the device signs
   * the NONCE — a signature made over the concatenation instead would be a different thing entirely, and the verifier
   * used to check for exactly that, which turned away every real device and scored it as a failed attestation.
   *
   * This test signs the same authenticator data BOTH ways with a key of its own and insists the verifier takes Apple's
   * one and refuses the other. It needs no fixture, so it cannot agree with a fixture that was made wrong.
   */
  it("takes Apple's nonce convention and refuses a signature over the concatenation", async () => {
    const { createPrivateKey, createSign, generateKeyPairSync } = await import("node:crypto");
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const key = createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" }) as string);

    const rpIdHash = createHash("sha256").update(V.appId, "utf8").digest();
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(7);
    const authData = Buffer.concat([rpIdHash, Buffer.from([0x00]), counter]);
    const clientDataHash = assertClientData(V.challenge);
    const nonce = createHash("sha256").update(Buffer.concat([authData, clientDataHash])).digest();

    const signOver = (message: Buffer): Buffer => {
      const s = createSign("sha256");
      s.update(message);
      return s.sign(key);
    };
    // The same minimal CBOR an assertion is: { signature, authenticatorData }.
    const assertionOf = (signature: Buffer): string => {
      const bytes = (b: Buffer) => Buffer.concat([Buffer.from([0x58, b.length]), b]);
      const text = (t: string) => Buffer.concat([Buffer.from([0x60 | t.length]), Buffer.from(t, "utf8")]);
      return Buffer.concat([
        Buffer.from([0xa2]), text("signature"), bytes(signature), text("authenticatorData"), bytes(authData),
      ]).toString("base64");
    };

    const asApple = { ...stored, publicKey: spki, signCount: 0, assertion: assertionOf(signOver(nonce)) };
    expect(verifyAssertion(asApple)).toEqual({ ok: true, counter: 7 });
    const theOldWay = { ...asApple, assertion: assertionOf(signOver(Buffer.concat([authData, clientDataHash]))) };
    expect(verifyAssertion(theOldWay)).toEqual({ ok: false, why: "signature" });
  });

  it("hashes the nonce the same way for an attestation and an assertion (one helper, both sides)", () => {
    const authData = Buffer.from("aabb", "hex");
    const cdh = Buffer.from("ccdd", "hex");
    expect(attestNonce(authData, cdh)).toEqual(createHash("sha256").update(Buffer.concat([authData, cdh])).digest());
  });
});

describe("Apple's own root", () => {
  it("is a constant in the build, not a file beside it, and its fingerprint is pinned", () => {
    resetRootForTests();
    const root = appleRoot();
    expect(root.subject).toContain("Apple App Attestation Root CA");
    expect(root.fingerprint256.replace(/:/g, "").toUpperCase()).toBe(ROOT_SHA256);
    // A swapped root is refused loudly rather than trusted quietly.
    resetRootForTests();
    expect(() => appleRoot(fs.readFileSync(path.join(FIXTURES, "root.pem"), "utf8"))).toThrow(/not Apple's/);
    resetRootForTests();
  });

  it("travels in the compiled JavaScript, because the image carries only that", async () => {
    // `tsc` emits .js and nothing else, and tulmi/Dockerfile copies only dist, so a .pem beside the verifier would not
    // be in the running image at all: every real attestation would land on an ENOENT and answer 500. The root is text in
    // a .ts file for that reason, and this test fails if it ever goes back to being read off the disk.
    const dir = path.resolve(import.meta.dirname, "../src/trust/apple");
    for (const name of fs.readdirSync(dir)) expect(name.endsWith(".pem")).toBe(false);
    const source = fs.readFileSync(path.join(dir, "appAttest.ts"), "utf8");
    expect(source).not.toMatch(/readFileSync|node:fs/);
    const { APPLE_APP_ATTEST_ROOT_PEM } = await import("../src/trust/apple/appleRoot.js");
    expect(APPLE_APP_ATTEST_ROOT_PEM).toContain("BEGIN CERTIFICATE");
  });

  it("answers a reason code, not an exception, when the root cannot be used at all", () => {
    // Whatever is wrong with the root, a route the phone calls in the background must answer 204, never a 500.
    expect(verifyAttestation({ ...base, root: {} as never })).toEqual({ ok: false, why: "chain" });
  });
});

describe("DeviceCheck", () => {
  it("is skipped while its key is not set, which is no signal and no penalty", async () => {
    expect(deviceCheckConfig()).toBeNull();
    expect(await queryTwoBits({ token: "t" })).toEqual({ ok: false, why: "not_configured" });
    expect(await updateTwoBits({ token: "t", bits: { bit0: true, bit1: false } })).toBe(false);
  });

  it("signs with ES256, the key's id in the header and the team as issuer", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    const jwt = await deviceCheckJwt({ keyId: "KEY123", teamId: "6552H8HYA4", privateKey: pem }, Date.parse("2026-11-14T10:00:00Z"));
    const [header, body] = jwt.split(".").slice(0, 2).map((p) => JSON.parse(Buffer.from(p, "base64url").toString("utf8")));
    expect(header).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(body.iss).toBe("6552H8HYA4");
    expect(body.iat).toBe(Math.floor(Date.parse("2026-11-14T10:00:00Z") / 1000));
    // Nothing of the person's is in it.
    expect(Object.keys(body).sort()).toEqual(["exp", "iat", "iss"]);
  });

  it("asks Apple for the two bits, and sends it nothing but the token, a transaction id and the time", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const config = { keyId: "KEY123", teamId: "6552H8HYA4", privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) as string };
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (url: unknown, init: { body?: string } = {}) => {
      seen.push({ url: String(url), body: JSON.parse(init.body ?? "{}") });
      return new Response(JSON.stringify({ bit0: true, bit1: false, last_update_time: "2026-11" }), { status: 200 });
    }) as unknown as typeof fetch;
    const got = await queryTwoBits({ token: "a-device-token", config, fetchFn, now: Date.parse("2026-11-14T10:00:00Z") });
    expect(got).toEqual({ ok: true, bits: { bit0: true, bit1: false, month: "2026-11" } });
    expect(seen[0]!.url).toBe("https://api.devicecheck.apple.com/v1/query_two_bits");
    expect(Object.keys(seen[0]!.body as object).sort()).toEqual(["device_token", "timestamp", "transaction_id"]);
    // The development endpoint is the only other one it will ever call.
    await queryTwoBits({ token: "t", env: "development", config, fetchFn });
    expect(seen[1]!.url).toBe("https://api.development.devicecheck.apple.com/v1/query_two_bits");
  });

  it("reads a device Apple holds nothing for as not found, not as a penalty", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const config = { keyId: "K", teamId: "T", privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) as string };
    const fetchFn = (async () => new Response("Failed to find bit state", { status: 200 })) as unknown as typeof fetch;
    expect(await queryTwoBits({ token: "t", config, fetchFn })).toEqual({ ok: false, why: "not_found" });
    const bad = (async () => new Response("Missing or incorrectly formatted device token payload", { status: 400 })) as unknown as typeof fetch;
    expect(await queryTwoBits({ token: "t", config, fetchFn: bad })).toEqual({ ok: false, why: "bad_token" });
  });
});

describe("Play Integrity", () => {
  const challenge = "a-challenge";
  const fresh = Date.parse("2026-11-14T10:00:00Z");
  const payload = (over: Record<string, unknown> = {}) => ({
    requestDetails: { requestPackageName: "com.tulmi.app", requestHash: integrityRequestHash(challenge), timestampMillis: fresh },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", certificateSha256Digest: [digestToBase64("AA:BB:CC")] },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY", "MEETS_BASIC_INTEGRITY"] },
    accountDetails: { appLicensingVerdict: "LICENSED" },
    ...over,
  });

  it("is skipped while its service account is not set", () => {
    expect(playConfig()).toBeNull();
  });

  it("keeps the labels, and only the labels", () => {
    const got = checkPayload(payload(), { challenge, now: fresh, signingSha256: "AA:BB:CC" });
    expect(got).toEqual({
      ok: true,
      verdict: {
        app: "PLAY_RECOGNIZED",
        device: ["MEETS_DEVICE_INTEGRITY", "MEETS_BASIC_INTEGRITY"],
        licence: "LICENSED",
        certificateMatches: true,
      },
    });
    expect(JSON.stringify(got)).not.toMatch(/token|nonce|deviceId/i);
  });

  it("refuses another package, another request, a stale token and another signing certificate", () => {
    expect(checkPayload(payload({ requestDetails: { requestPackageName: "com.someone.else" } }), { challenge, now: fresh }))
      .toEqual({ ok: false, why: "package" });
    expect(checkPayload(payload({ requestDetails: { requestPackageName: "com.tulmi.app", requestHash: "not ours", timestampMillis: fresh } }), { challenge, now: fresh }))
      .toEqual({ ok: false, why: "hash" });
    expect(checkPayload(payload(), { challenge, now: fresh + FRESH_MS + 1000 })).toEqual({ ok: false, why: "stale" });
    expect(checkPayload(payload(), { challenge, now: fresh, signingSha256: "DD:EE:FF" })).toEqual({ ok: false, why: "certificate" });
  });

  it("reads an EAS preview build's UNRECOGNIZED_VERSION as a label, not as an error", () => {
    const got = checkPayload(
      payload({ appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION" }, deviceIntegrity: { deviceRecognitionVerdict: [] } }),
      { challenge, now: fresh, signingSha256: "AA:BB:CC" },
    );
    expect(got).toEqual({ ok: true, verdict: { app: "UNRECOGNIZED_VERSION", device: [], licence: "LICENSED" } });
  });

  it("hashes our own challenge into the request, so a token cannot be replayed into another step", () => {
    expect(integrityRequestHash("a")).toHaveLength(64);
    expect(integrityRequestHash("a")).not.toBe(integrityRequestHash("b"));
    expect(integrityRequestHash("a")).toBe(createHash("sha256").update("x0|integrity|a", "utf8").digest("hex"));
  });

  it("turns Play's colon hex certificate digest into the base64url Google answers with", () => {
    expect(digestToBase64("AA:BB:CC")).toBe(Buffer.from("aabbcc", "hex").toString("base64url"));
  });

  it("sends Google the integrity token and NOTHING else, and asks for its own access token first", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config = {
      email: "x0-integrity@a-project.iam.gserviceaccount.com",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
      project: "123456789",
    };
    const seen: Array<{ url: string; body: string }> = [];
    const fetchFn = (async (url: unknown, init: { body?: string } = {}) => {
      seen.push({ url: String(url), body: String(init.body ?? "") });
      if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "a-token" }), { status: 200 });
      return new Response(JSON.stringify({ tokenPayloadExternal: payload() }), { status: 200 });
    }) as unknown as typeof fetch;

    const got = await decodeIntegrityToken({ token: "an-integrity-token", challenge, config, fetchFn, now: fresh, signingSha256: "AA:BB:CC" });
    expect(got.ok).toBe(true);
    expect(seen[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(seen[1]!.url).toBe("https://playintegrity.googleapis.com/v1/com.tulmi.app:decodeIntegrityToken");
    // Rule 10: the call carries the token Google itself made, and nothing about the person.
    expect(JSON.parse(seen[1]!.body)).toEqual({ integrity_token: "an-integrity-token" });
    expect(seen[1]!.body).not.toMatch(/user|email|score|ip/i);
  });

  it("answers \"failed\", never a penalty, when Google cannot be reached or will not say", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config = { email: "a@b.iam.gserviceaccount.com", privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) as string, project: "1" };
    const noToken = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await decodeIntegrityToken({ token: "t", challenge, config, fetchFn: noToken })).toEqual({ ok: false, why: "failed" });
    expect(await accessToken(config, { fetchFn: noToken })).toBeNull();
  });
});

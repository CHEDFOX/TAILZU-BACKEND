/**
 * The GitHub App's key, read for the VPS (node:crypto's KeyObject) and for a Worker (a CryptoKey made from the PKCS#8 form):
 * both must sign a JWT that GitHub's public half of the key verifies. GitHub's own download is PKCS#1, which WebCrypto cannot
 * import, so the Worker's path wraps it (src/code/appKey.ts). Keys are made here at run time.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { GithubApp, parsePrivateKey, parsePrivateKeyPkcs8 } = await import("../src/code/github.js");
const { normalizePem, pkcs1ToPkcs8, toPkcs8Pem } = await import("../src/code/appKey.js");

function keys(bits = 2048) {
  const pair = generateKeyPairSync("rsa", { modulusLength: bits, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
  const pkcs8 = createPrivateKey(pair.privateKey).export({ type: "pkcs8", format: "pem" }) as string;
  return { pkcs1: pair.privateKey, pkcs8, publicKey: createPublicKey(pair.publicKey) };
}
const derOf = (pem: string): Buffer => Buffer.from(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""), "base64");
const config = (privateKey: string) => ({ slug: "tailzu", clientId: "Iv1.abc", clientSecret: "x", privateKey });

describe("PKCS#1 to PKCS#8", () => {
  it.each([2048, 3072, 4096])("wraps a %i-bit key into exactly the bytes node:crypto exports", (bits) => {
    const k = keys(bits);
    expect(Buffer.from(pkcs1ToPkcs8(derOf(k.pkcs1))).equals(derOf(k.pkcs8))).toBe(true);
  });

  it("gives a PEM node:crypto reads back as the same key", () => {
    const k = keys();
    const wrapped = toPkcs8Pem(k.pkcs1);
    expect(wrapped).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(createPrivateKey(wrapped).export({ type: "pkcs8", format: "pem" })).toBe(k.pkcs8);
    expect(wrapped.split("\n").every((l) => l.length <= 64 || l.startsWith("-----"))).toBe(true);
  });

  it("passes a PKCS#8 key through, and takes the other ways the value is written", () => {
    const k = keys();
    expect(toPkcs8Pem(k.pkcs8)).toBe(k.pkcs8);
    expect(toPkcs8Pem(Buffer.from(k.pkcs1).toString("base64"))).toBe(k.pkcs8);
    expect(toPkcs8Pem(k.pkcs1.trim().replace(/\n/g, "\\n"))).toBe(k.pkcs8);
    expect(toPkcs8Pem(`"${k.pkcs1.trim().replace(/\n/g, "\\n")}"`)).toBe(k.pkcs8);
    expect(normalizePem(`'${k.pkcs8.trim().replace(/\n/g, "\\n")}'`)).toBe(k.pkcs8.trim());
  });

  it("refuses what is not an RSA private key, without saying what it was", () => {
    for (const bad of ["", "hello", "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----", "-----BEGIN EC PRIVATE KEY-----\nMAEC\n-----END EC PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----\nAQID\n-----END RSA PRIVATE KEY-----"]) {
      let msg = "";
      try { toPkcs8Pem(bad); } catch (e) { msg = (e as Error).message; }
      expect(msg).toBe("not an RSA private key");
    }
    expect(() => parsePrivateKeyPkcs8("hello")).toThrowError(/private key can't be read/);
    expect(() => parsePrivateKey("hello")).toThrowError(/private key can't be read/);
  });
});

describe("the App JWT", () => {
  it.each(["node", "webcrypto"] as const)("signed with %s verifies against the public half, with the claims GitHub wants", async (keyMode) => {
    const k = keys();
    const now = 1_800_000_000_000;
    const jwt = await new GithubApp(config(k.pkcs1), { keyMode, now: () => now }).appJwt();
    const { payload, protectedHeader } = await jwtVerify(jwt, k.publicKey, { issuer: "Iv1.abc", currentDate: new Date(now) });
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.iat).toBe(now / 1000 - 60);
    expect(payload.exp).toBe(now / 1000 + 540);
  });

  it("is the same through either path for the same key: each verifies, and they are two valid tokens", async () => {
    const k = keys();
    const a = await new GithubApp(config(k.pkcs1), { keyMode: "node", now: () => 1_800_000_000_000 }).appJwt();
    const b = await new GithubApp(config(k.pkcs1), { keyMode: "webcrypto", now: () => 1_800_000_000_000 }).appJwt();
    expect(a).toBe(b); // RS256 (PKCS#1 v1.5) is deterministic: the same key signs the same bytes
  });

  it("takes a PKCS#8 key and a base64 one on either path", async () => {
    const k = keys();
    for (const keyMode of ["node", "webcrypto"] as const) {
      for (const value of [k.pkcs8, Buffer.from(k.pkcs1).toString("base64")]) {
        await jwtVerify(await new GithubApp(config(value), { keyMode }).appJwt(), k.publicKey, { clockTolerance: 5 });
      }
    }
  });

  it("is the node path unless this is a Worker", async () => {
    const k = keys();
    const app = new GithubApp(config(k.pkcs1)) as unknown as { key: unknown; pkcs8: unknown };
    expect(app.key).not.toBeNull();
    expect(app.pkcs8).toBeNull();
    const w = new GithubApp(config(k.pkcs1), { keyMode: "webcrypto" }) as unknown as { key: unknown; pkcs8: unknown };
    expect(w.key).toBeNull();
    expect(typeof w.pkcs8).toBe("string");
  });

  it("says 'not configured' for a key that cannot be read, on either path", async () => {
    expect(() => new GithubApp(config("nope"), { keyMode: "node" })).toThrowError(/private key can't be read/);
    expect(() => new GithubApp(config("nope"), { keyMode: "webcrypto" })).toThrowError(/private key can't be read/);
    // A well-formed PKCS#8 wrapper around bytes that are not a key reaches importPKCS8, which refuses it.
    const bogus = toPkcs8Pem(`-----BEGIN RSA PRIVATE KEY-----\n${Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]).toString("base64")}\n-----END RSA PRIVATE KEY-----`);
    await expect(new GithubApp(config(bogus), { keyMode: "webcrypto" }).appJwt()).rejects.toMatchObject({ code: "not_configured" });
  });

  it("works with no App at all (a server with only the sign-in)", () => {
    expect(() => new GithubApp(null)).not.toThrow();
  });
});

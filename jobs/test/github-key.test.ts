/**
 * The GitHub App JWT on a Worker: GitHub's key is PKCS#1, WebCrypto imports only PKCS#8, so the key is wrapped
 * (tulmi/src/code/appKey.ts) and jose's importPKCS8 makes the CryptoKey. Run in workerd, with a key made here at run time.
 */
import { describe, expect, it } from "vitest";
import { GithubApp } from "../../tulmi/src/code/github.js";
import { pkcs1ToPkcs8, toPkcs8Pem } from "../../tulmi/src/code/appKey.js";
import { isWorkerRuntime } from "../../tulmi/src/config.js";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${b64(der).match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

/** The PKCS#1 key inside a PKCS#8 one: the OCTET STRING at the end of PrivateKeyInfo { version, algorithm, privateKey }. */
function unwrap(pkcs8: Uint8Array): Uint8Array {
  let p = 0;
  const read = () => {
    const tag = pkcs8[p++]!;
    let n = pkcs8[p++]!;
    if (n & 0x80) { const k = n & 0x7f; n = 0; for (let j = 0; j < k; j += 1) n = n * 256 + pkcs8[p++]!; }
    return { tag, start: p, n };
  };
  read(); // the outer SEQUENCE
  const version = read(); p = version.start + version.n;
  const algorithm = read(); p = algorithm.start + algorithm.n;
  const key = read(); // the OCTET STRING holding the PKCS#1 RSAPrivateKey
  return pkcs8.slice(key.start, key.start + key.n);
}

const unb64url = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s))) as Record<string, unknown>;

/** Checks an RS256 JWT's signature with the public key, as GitHub would. Returns its header and claims. */
async function verifyJwt(jwt: string, publicSpki: Uint8Array): Promise<{ header: Record<string, unknown>; claims: Record<string, number | string> }> {
  const [h, c, sig] = jwt.split(".") as [string, string, string];
  const key = await crypto.subtle.importKey("spki", publicSpki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(sig), new TextEncoder().encode(`${h}.${c}`));
  if (!ok) throw new Error("bad signature");
  return { header: json(h), claims: json(c) as Record<string, number | string> };
}

async function makeKey(bits = 2048): Promise<{ pkcs1: Uint8Array; pkcs8: Uint8Array; spki: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer);
  return { pkcs1: unwrap(pkcs8), pkcs8, spki };
}

const app = (privateKey: string, o: ConstructorParameters<typeof GithubApp>[1] = {}) =>
  new GithubApp({ slug: "tailzu", clientId: "Iv1.test", clientSecret: "s", privateKey }, o);

describe("the App's key on a Worker", () => {
  it("knows it is on a Worker", () => {
    expect(isWorkerRuntime()).toBe(true);
  });

  it("wraps PKCS#1 into exactly the PKCS#8 that WebCrypto exports", async () => {
    for (const bits of [2048, 3072]) {
      const k = await makeKey(bits);
      expect(Array.from(pkcs1ToPkcs8(k.pkcs1))).toEqual(Array.from(k.pkcs8));
    }
  });

  it("signs a JWT GitHub could verify, from the PKCS#1 PEM GitHub hands out", async () => {
    const k = await makeKey();
    const jwt = await app(pem("RSA PRIVATE KEY", k.pkcs1)).appJwt();
    const { header, claims } = await verifyJwt(jwt, k.spki);
    expect(header.alg).toBe("RS256");
    expect(claims.iss).toBe("Iv1.test");
    expect((claims.exp as number) - (claims.iat as number)).toBe(600); // issued a minute back, good for nine
  });

  it("takes a PKCS#8 PEM, base64 of the PEM, and the one-line form with written-out \\n", async () => {
    const k = await makeKey();
    const p8 = pem("PRIVATE KEY", k.pkcs8);
    const p1 = pem("RSA PRIVATE KEY", k.pkcs1);
    for (const form of [p8, btoa(p1), JSON.stringify(p1.trim()).slice(1, -1), `"${p8.trim().replace(/\n/g, "\\n")}"`]) {
      await verifyJwt(await app(form).appJwt(), k.spki);
    }
    expect(toPkcs8Pem(p1)).toBe(p8);
  });

  it("reuses the JWT it made, for most of its life", async () => {
    const k = await makeKey();
    let t = 1_700_000_000_000;
    const a = app(pem("RSA PRIVATE KEY", k.pkcs1), { now: () => t });
    const first = await a.appJwt();
    t += 5 * 60_000;
    expect(await a.appJwt()).toBe(first);
    t += 4 * 60_000;
    expect(await a.appJwt()).not.toBe(first);
  });

  it("says 'not configured', never what was in the value, for a key that is not one", async () => {
    for (const bad of ["", "not a key", pem("RSA PRIVATE KEY", new Uint8Array([1, 2, 3])), pem("EC PRIVATE KEY", new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]))]) {
      let message = "";
      try { await app(bad).appJwt(); } catch (e) { message = String((e as { code?: string }).code) + "|" + (e as Error).message; }
      expect(message).toContain("not_configured");
      expect(message).not.toContain("not a key");
    }
  });
});

/**
 * MAKES THE MADE-UP APP ATTEST VECTORS THE TESTS USE (tests/fixtures/trust-appattest).
 *
 *   npx tsx scripts/trust-attest-fixture.ts
 *
 * A chain of our own, signed by a root of our own, so every rule in src/trust/apple/appAttest.ts can be checked with no
 * device in the room. It is committed so the fixtures can be rebuilt rather than guessed at — and because a fixture made
 * by the verifier itself would only ever agree with the verifier (the assertion's hash convention was wrong once, and the
 * fixture agreed with it). What this script does with the nonce is Apple's documented order, written out here on its own:
 *
 *   clientDataHash = SHA256("x0|attest|" + challenge)   (ours; "x0|assert|" for an assertion)
 *   nonce          = SHA256(authenticatorData ‖ clientDataHash)
 *   attestation    the nonce sits in the leaf's extension 1.2.840.113635.100.8.2
 *   assertion      the device key SIGNS the nonce (so the signature's own SHA256 is over the nonce)
 *
 * N0 item 9 replaces all of it with an attestation and an assertion from a real TestFlight build on a real phone.
 */
import { createHash, createPrivateKey, createSign, generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_ID = "6552H8HYA4.com.tulmi.app";
const CHALLENGE = "Zm9yLXRoZS10ZXN0LW9ubHktY2hhbGxlbmdlLTAwMDE";
const NONCE_OID = "1.2.840.113635.100.8.2";
const OUT = path.resolve(import.meta.dirname, "../tests/fixtures/trust-appattest");

// ------------------------------------------------------------------ a very small CBOR writer

const head = (major: number, n: number): Buffer => {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65_536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
};
const cborText = (s: string): Buffer => Buffer.concat([head(3, Buffer.byteLength(s)), Buffer.from(s, "utf8")]);
const cborBytes = (b: Buffer): Buffer => Buffer.concat([head(2, b.length), b]);
const cborArray = (items: Buffer[]): Buffer => Buffer.concat([head(4, items.length), ...items]);
const cborMap = (pairs: Array<[string, Buffer]>): Buffer =>
  Buffer.concat([head(5, pairs.length), ...pairs.flatMap(([k, v]) => [cborText(k), v])]);

// ------------------------------------------------------------------ the pieces

/** Apple's authenticator data for an attestation: rpIdHash, flags, counter, aaguid, then the credential id. */
function authDataFor(rpIdHash: Buffer, keyId: Buffer): Buffer {
  const aaguid = Buffer.alloc(16);
  aaguid.write("appattest", 0, "utf8");
  const counter = Buffer.alloc(4);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(keyId.length);
  return Buffer.concat([rpIdHash, Buffer.from([0x40]), counter, aaguid, len, keyId]);
}

/** The short form an assertion carries: rpIdHash, flags and the counter, and nothing after them. */
function assertAuthData(rpIdHash: Buffer, counter: number): Buffer {
  const c = Buffer.alloc(4);
  c.writeUInt32BE(counter);
  return Buffer.concat([rpIdHash, Buffer.from([0x00]), c]);
}

/** SEQUENCE { [1] { OCTET STRING nonce } }, as the hex openssl takes for a raw extension. */
function nonceExtension(nonce: Buffer): string {
  const octet = Buffer.concat([Buffer.from([0x04, nonce.length]), nonce]);
  const ctx = Buffer.concat([Buffer.from([0xa1, octet.length]), octet]);
  const seq = Buffer.concat([Buffer.from([0x30, ctx.length]), ctx]);
  return seq.toString("hex").toUpperCase();
}

const openssl = (args: string[], cwd: string) => execFileSync("openssl", args, { cwd, encoding: "utf8" });

function main(): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "x0-attest-"));
  const rpIdHash = createHash("sha256").update(APP_ID, "utf8").digest();

  // The root of our own, and the device key the "phone" made.
  openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "root.key"], work);
  openssl(["req", "-x509", "-new", "-key", "root.key", "-sha256", "-days", "3650", "-out", "root.pem",
    "-subj", "/CN=X0 Test App Attest Root/O=X0 tests"], work);

  const device = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = device.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  fs.writeFileSync(path.join(work, "device.key"), device.privateKey.export({ format: "pem", type: "pkcs8" }) as string);
  const point = spki.subarray(spki.length - 65);
  const keyId = createHash("sha256").update(point).digest();

  // The attestation's authenticator data, and the nonce the leaf must carry for it.
  const authData = authDataFor(rpIdHash, keyId);
  const attestClientData = createHash("sha256").update(`x0|attest|${CHALLENGE}`, "utf8").digest();
  const nonce = createHash("sha256").update(Buffer.concat([authData, attestClientData])).digest();

  fs.writeFileSync(path.join(work, "leaf.cnf"), [
    "[req]", "distinguished_name=dn", "prompt=no",
    "[dn]", "CN=X0 Test Device Key", "O=X0 tests",
    "[ext]", `${NONCE_OID}=DER:${nonceExtension(nonce)}`, "",
  ].join("\n"));
  openssl(["req", "-new", "-key", "device.key", "-out", "leaf.csr", "-config", "leaf.cnf"], work);
  openssl(["x509", "-req", "-in", "leaf.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial",
    "-days", "3650", "-sha256", "-out", "leaf.pem", "-extfile", "leaf.cnf", "-extensions", "ext"], work);

  const leafDer = Buffer.from(new X509Certificate(fs.readFileSync(path.join(work, "leaf.pem"))).raw);
  const attestation = cborMap([
    ["fmt", cborText("apple-appattest")],
    ["attStmt", cborMap([["x5c", cborArray([cborBytes(leafDer)])], ["receipt", cborBytes(randomBytes(64))]])],
    ["authData", cborBytes(authData)],
  ]);

  // The assertion: the counter has gone up, and the device signs APPLE'S NONCE, not the bytes it was made from.
  const assertAuth = assertAuthData(rpIdHash, 1);
  const assertClientData = createHash("sha256").update(`x0|assert|${CHALLENGE}`, "utf8").digest();
  const assertNonce = createHash("sha256").update(Buffer.concat([assertAuth, assertClientData])).digest();
  const signer = createSign("sha256");
  signer.update(assertNonce);
  const signature = signer.sign(createPrivateKey(fs.readFileSync(path.join(work, "device.key"))));
  const assertion = cborMap([["signature", cborBytes(signature)], ["authenticatorData", cborBytes(assertAuth)]]);

  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(work, "root.pem"), path.join(OUT, "root.pem"));
  fs.writeFileSync(path.join(OUT, "vectors.json"), `${JSON.stringify({
    appId: APP_ID,
    challenge: CHALLENGE,
    keyId: keyId.toString("base64"),
    attestation: attestation.toString("base64"),
    assertion: assertion.toString("base64"),
    publicKeySpki: spki.toString("base64"),
    madeAt: new Date().toISOString(),
  }, null, 2)}\n`);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`wrote ${OUT}/vectors.json and root.pem`);
}

main();

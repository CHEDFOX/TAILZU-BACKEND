/**
 * THE GITHUB APP'S PRIVATE KEY, READ SO THAT IT CAN SIGN ON A WORKER AS WELL AS ON THE VPS.
 *
 * GitHub hands out the key as PKCS#1 (a PEM block labelled "RSA PRIVATE KEY"). On the
 * VPS, node:crypto's createPrivateKey reads that and jose signs with the
 * KeyObject. On a Cloudflare Worker jose runs on WebCrypto, which imports only
 * PKCS#8 (a block labelled just "PRIVATE KEY") and cannot take a KeyObject. So the
 * Worker's path is: read the PEM here, wrap a PKCS#1 key's DER in the PKCS#8
 * envelope (a fixed header and the same key bytes: no maths, no crypto library),
 * and let jose's importPKCS8 make the CryptoKey.
 *
 * The wrapper for RSA is
 *
 *   PrivateKeyInfo ::= SEQUENCE {
 *     version             INTEGER 0,
 *     privateKeyAlgorithm SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL },
 *     privateKey          OCTET STRING { the PKCS#1 RSAPrivateKey, as it was } }
 *
 * Nothing here imports anything, and nothing here logs or throws a key's bytes.
 */

/** The value in GITHUB_APP_PRIVATE_KEY as a PEM: raw, or base64 of it, with `\n` written out turned back into line breaks and quotes around it dropped. */
export function normalizePem(raw: string): string {
  const unquote = (s: string) => s.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  const unescape = (s: string) => s.replace(/\\n/g, "\n");
  let pem = unescape(unquote(raw));
  if (!pem.includes("-----BEGIN")) pem = unescape(Buffer.from(pem, "base64").toString("utf8"));
  return pem;
}

const bytesOf = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
}

function tlv(tag: number, body: ArrayLike<number>): Uint8Array {
  const len = derLength(body.length);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(body as ArrayLike<number>, 1 + len.length);
  return out;
}

const RSA_ALGORITHM = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

/** An RSA private key's PKCS#1 DER as the PKCS#8 DER that holds it. Throws on bytes that are not a DER SEQUENCE. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  if (pkcs1.length < 2 || pkcs1[0] !== 0x30) throw new Error("not an RSA private key");
  const octet = tlv(0x04, pkcs1);
  const body = new Uint8Array(3 + RSA_ALGORITHM.length + octet.length);
  body.set([0x02, 0x01, 0x00], 0);
  body.set(RSA_ALGORITHM, 3);
  body.set(octet, 3 + RSA_ALGORITHM.length);
  return tlv(0x30, body);
}

function pemOf(label: string, der: Uint8Array): string {
  const b64 = Buffer.from(der).toString("base64");
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * The key as a PKCS#8 PEM, whichever it came as: PKCS#8 is passed through, PKCS#1 is wrapped. Anything else (an EC key, an
 * encrypted one, text that is not a key) throws "not an RSA private key"; the caller turns that into "not configured".
 */
export function toPkcs8Pem(raw: string): string {
  const pem = normalizePem(raw);
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (!m) throw new Error("not an RSA private key");
  const body = m[2]!.replace(/\s+/g, "");
  if (m[1] === "PRIVATE KEY") return pemOf("PRIVATE KEY", bytesOf(body));
  if (m[1] === "RSA PRIVATE KEY") return pemOf("PRIVATE KEY", pkcs1ToPkcs8(bytesOf(body)));
  throw new Error("not an RSA private key");
}

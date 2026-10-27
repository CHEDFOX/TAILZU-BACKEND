/**
 * AWS SIGNATURE VERSION 4, IN ONE SMALL FILE: WHAT R2 (AND S3) ASK OF A REQUEST. NO AWS SDK.
 *
 * Cloudflare R2 speaks the S3 API and checks the same signature, so a request is signed here with node:crypto and sent with fetch. The SDK
 * would be a few megabytes of code and a long list of dependencies for three calls (put, get, delete).
 *
 *   sign(...)     the headers (Authorization, x-amz-date, x-amz-content-sha256, host) to send with a request
 *   presign(...)  the same, as a URL anyone can use until it expires (the query-string form)
 *
 * The algorithm, step by step (the names are AWS's own):
 *   canonical request = METHOD \n path \n query \n canonical headers \n signed headers \n payload hash
 *   string to sign    = AWS4-HMAC-SHA256 \n date-time \n scope \n sha256(canonical request)
 *   signing key       = HMAC chain of "AWS4"+secret over date, region, service, "aws4_request"
 *   signature         = hex HMAC of the string to sign with that key
 *
 * S3 (and R2) take the path as it is, encoded once and not tidied; every other service encodes it twice and tidies it (`..`, `//`). The
 * tests (tests/media-sigv4.test.ts) check this against the signatures AWS publishes in its documentation: the S3 request examples, the
 * IAM signing key example and the SigV4 test suite. Every header the caller gives is signed (except Authorization), so a header added
 * after signing, other than content-length, is the caller's mistake.
 */
import { createHash, createHmac } from "node:crypto";

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  url: string | URL;
  headers?: Record<string, string>;
  /** The body, to be hashed. Not needed when `payloadHash` is given. */
  body?: Uint8Array | string;
  /** The hash of the body in hex, or UNSIGNED-PAYLOAD. */
  payloadHash?: string;
  region: string;
  service: string;
  credentials: Credentials;
  date?: Date;
}

export interface Signed {
  /** What to send: the given headers, plus host, x-amz-date, x-amz-content-sha256 (S3) and Authorization. */
  headers: Record<string, string>;
  authorization: string;
  signature: string;
  signedHeaders: string;
  canonicalRequest: string;
  stringToSign: string;
}

const sha256hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding: everything but A-Z a-z 0-9 - _ . ~ is %XX. */
export const uriEncode = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** `20150830T123600Z`. */
export const amzDate = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
}

function canonicalPath(pathname: string, service: string): string {
  const raw = pathname || "/";
  if (service === "s3") {
    // The path as the URL has it, decoded then encoded once (S3 keys may hold "//" and ".." and mean them).
    return raw.split("/").map((seg) => uriEncode(safeDecode(seg))).join("/") || "/";
  }
  // Everyone else: tidy the path, then encode each segment twice.
  const out: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  const tidy = `/${out.join("/")}${raw.endsWith("/") && out.length ? "/" : ""}`;
  return tidy.split("/").map((seg) => uriEncode(uriEncode(safeDecode(seg)))).join("/");
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function canonicalQuery(search: URLSearchParams, skip?: string): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of search) if (k !== skip) pairs.push([uriEncode(k), uriEncode(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

const squeeze = (v: string): string => v.trim().replace(/\s+/g, " ");

function canonicalHeaders(h: Record<string, string>): { text: string; signed: string } {
  const entries = Object.entries(h).map(([k, v]) => [k.toLowerCase(), squeeze(String(v))] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { text: entries.map(([k, v]) => `${k}:${v}\n`).join(""), signed: entries.map(([k]) => k).join(";") };
}

export function sign(i: SignInput): Signed {
  const url = typeof i.url === "string" ? new URL(i.url) : i.url;
  const date = amzDate(i.date ?? new Date());
  const day = date.slice(0, 8);
  const s3 = i.service === "s3";

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) if (k.toLowerCase() !== "authorization") headers[k] = v;
  const has = (name: string): boolean => Object.keys(headers).some((k) => k.toLowerCase() === name);
  if (!has("host")) headers.host = url.host;
  if (!has("x-amz-date")) headers["x-amz-date"] = date;
  const payloadHash = i.payloadHash ?? sha256hex(i.body ?? "");
  if (s3 && !has("x-amz-content-sha256")) headers["x-amz-content-sha256"] = payloadHash;
  if (i.credentials.sessionToken && !has("x-amz-security-token")) headers["x-amz-security-token"] = i.credentials.sessionToken;

  const { text, signed } = canonicalHeaders(headers);
  const canonicalRequest = [i.method.toUpperCase(), canonicalPath(url.pathname, i.service), canonicalQuery(url.searchParams), text, signed, payloadHash].join("\n");
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", headers["x-amz-date"] ?? date, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(i.credentials.secretAccessKey, day, i.region, i.service)).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${i.credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return { headers: { ...headers, Authorization: authorization }, authorization, signature, signedHeaders: signed, canonicalRequest, stringToSign };
}

export interface PresignInput {
  method: string;
  url: string | URL;
  region: string;
  service: string;
  credentials: Credentials;
  /** Seconds the link lasts: 1 to 604,800 (a week). */
  expiresIn: number;
  date?: Date;
}

/** A URL that carries its own signature in the query string, for a request that has no headers to sign but the host. */
export function presign(i: PresignInput): string {
  if (!Number.isInteger(i.expiresIn) || i.expiresIn < 1 || i.expiresIn > 604_800) throw new RangeError("expiresIn is 1 to 604800 seconds");
  const url = new URL(typeof i.url === "string" ? i.url : i.url.toString());
  const date = amzDate(i.date ?? new Date());
  const day = date.slice(0, 8);
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${i.credentials.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", date);
  url.searchParams.set("X-Amz-Expires", String(i.expiresIn));
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  if (i.credentials.sessionToken) url.searchParams.set("X-Amz-Security-Token", i.credentials.sessionToken);
  const { text, signed } = canonicalHeaders({ host: url.host });
  const canonicalRequest = [i.method.toUpperCase(), canonicalPath(url.pathname, i.service), canonicalQuery(url.searchParams, "X-Amz-Signature"), text, signed, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(i.credentials.secretAccessKey, day, i.region, i.service)).update(stringToSign, "utf8").digest("hex");
  url.searchParams.set("X-Amz-Signature", signature);
  return url.toString();
}

export const sha256Hex = sha256hex;

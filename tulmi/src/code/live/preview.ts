/**
 * THE PREVIEW'S ADDRESS, ITS TOKEN, AND WHAT MAY CROSS BETWEEN THE BROWSER AND THE DEV SERVER (docs/cloudflare-jobs.md "The preview").
 *
 * The project's dev server runs on the job's runner and is seen through the room, from a SITE OF ITS OWN: never the app's, never the API's, because it
 * runs the person's project code. Two ways to give it an address:
 *
 *   wildcard   `https://<token>.<PREVIEW_DOMAIN>/` (a Workers route `*.<domain>/*` and a wildcard DNS record). Every preview is its own origin, and the
 *              dev server's absolute paths (`/src/main.tsx`, `/@vite/client`) just work
 *   cookie     `https://<PREVIEW_HOST>/p/<token>/` on one dedicated host. The first visit sets a host-only, HttpOnly, SameSite=Lax cookie and redirects to
 *              `/`; from then on root-relative requests are routed by the cookie. All previews share one origin: for one person's own previews only
 *
 * THE TOKEN is what the address is made of. It is NOT a bearer secret you could guess: 38 bytes, as 61 lower-case base32 letters (a DNS label is at most
 * 63), laid out
 *
 *     jobId (16 bytes, the UUID)  nonce (6 random bytes)  expires (4 bytes, seconds)  mac (12 bytes)
 *
 * with mac = HMAC-SHA256(CODE_JOBS_SECRET, "tailzu-preview-v1" + jobId + nonce + expires). The Worker checks the mac and the expiry with no object
 * woken, so a scanner that tries names under the preview domain wakes nothing. The ROOM then checks the nonce against the one it made for this preview
 * (so a token of an earlier preview of the same job is refused), that the preview is still open, and who it was made for (the owner of the job).
 *
 * Nothing here reaches a network or a clock except the `now` it is given.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const LABEL = "tailzu-preview-v1";

export function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export function unbase32(text: string): Uint8Array | null {
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const c of text) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** 38 bytes → 61 base32 letters. */
export const PREVIEW_TOKEN_LENGTH = 61;
const TOKEN = /^[a-z2-7]{61}$/;
export const isPreviewToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);

const macOf = (secret: string, jobHex: string, nonceHex: string, exp: number): Buffer =>
  createHmac("sha256", secret).update(`${LABEL}\n${jobHex}\n${nonceHex}\n${exp}`).digest().subarray(0, 12);

export interface MintedToken {
  token: string;
  /** The nonce, in hex: the room keeps it, and a token is good only while it is the room's. */
  nonce: string;
  /** Epoch ms the token stops working. */
  exp: number;
}

export function mintPreviewToken(o: { secret: string; jobId: string; ttlMs: number; now?: number; nonce?: Uint8Array }): MintedToken {
  if (!UUID.test(o.jobId)) throw new Error("a preview is made for a job, and a job's id is a UUID");
  const jobBytes = Buffer.from(o.jobId.replace(/-/g, ""), "hex");
  const nonce = o.nonce ?? randomBytes(6);
  const expSec = Math.floor(((o.now ?? Date.now()) + Math.max(1_000, o.ttlMs)) / 1000);
  const exp = Buffer.alloc(4);
  exp.writeUInt32BE(expSec);
  const mac = macOf(o.secret, jobBytes.toString("hex"), hex(nonce), expSec);
  const token = base32(Buffer.concat([jobBytes, Buffer.from(nonce), exp, mac]));
  return { token, nonce: hex(nonce), exp: expSec * 1000 };
}

export type PreviewTokenRead =
  | { ok: true; jobId: string; nonce: string; exp: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function readPreviewToken(secret: string, token: unknown, now = Date.now()): PreviewTokenRead {
  if (!isPreviewToken(token)) return { ok: false, reason: "malformed" };
  const raw = unbase32(token);
  if (!raw || raw.length < 38 || base32(raw) !== token) return { ok: false, reason: "malformed" };
  const b = Buffer.from(raw.subarray(0, 38));
  const jobHex = b.subarray(0, 16).toString("hex");
  const nonce = b.subarray(16, 22).toString("hex");
  const expSec = b.readUInt32BE(22);
  const want = macOf(secret, jobHex, nonce, expSec);
  const got = b.subarray(26, 38);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad_signature" };
  if (now >= expSec * 1000) return { ok: false, reason: "expired" };
  const j = jobHex;
  return { ok: true, jobId: `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20)}`, nonce, exp: expSec * 1000 };
}

/** Constant-time comparison of two hex strings of the same kind. */
export function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

// ------------------------------------------------------------------ the address

export interface PreviewSite {
  /** Wildcard mode: the domain whose subdomains are previews. */
  domain?: string;
  /** Cookie mode: the one host. */
  host?: string;
}

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const clean = (v: string | undefined): string | undefined => {
  const t = (v ?? "").trim().toLowerCase().replace(/\.$/, "");
  // workers.dev has no wildcard, and is where the API lives.
  return HOSTNAME.test(t) && !/(?:^|\.)workers\.dev$/.test(t) ? t : undefined;
};

/** The site as the settings give it: only valid host names are kept. */
export function previewSite(env: { PREVIEW_DOMAIN?: unknown; PREVIEW_HOST?: unknown }): PreviewSite {
  const domain = clean(typeof env.PREVIEW_DOMAIN === "string" ? env.PREVIEW_DOMAIN : undefined);
  const host = clean(typeof env.PREVIEW_HOST === "string" ? env.PREVIEW_HOST : undefined);
  return { ...(domain ? { domain } : {}), ...(host ? { host } : {}) };
}

export const previewAvailable = (s: PreviewSite): boolean => !!(s.domain || s.host);

/** An approximation of "the registrable domain": the last two labels, three under a two-letter country code with a generic second level (co.uk). */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  const n = labels.length;
  if (n <= 2) return labels.join(".");
  const generic = ["co", "com", "org", "net", "gov", "ac", "edu"];
  return (labels[n - 1]!.length === 2 && generic.includes(labels[n - 2]!) ? labels.slice(-3) : labels.slice(-2)).join(".");
}

/**
 * The preview runs the person's project code, so it must be a SITE of its own: not the app's, not the API's, and not a subdomain of either (a cookie
 * set for the parent domain would reach it). `own` are the hosts of the app, the API and the VPS. A site that shares a registrable domain with one of
 * them is taken out, and `refused` says which setting and why (for a log line and a test), never a value from the request.
 */
export function guardSite(site: PreviewSite, own: readonly string[]): { site: PreviewSite; refused: string[] } {
  const owned = new Set(own.map((h) => siteOf(h)).filter(Boolean));
  const refused: string[] = [];
  const out: PreviewSite = {};
  if (site.domain) {
    if (owned.has(siteOf(site.domain))) refused.push("PREVIEW_DOMAIN shares a site with the app or the API; a preview runs the person's code and needs a site of its own.");
    else out.domain = site.domain;
  }
  if (site.host) {
    if (owned.has(siteOf(site.host))) refused.push("PREVIEW_HOST shares a site with the app or the API; a preview runs the person's code and needs a site of its own.");
    else out.host = site.host;
  }
  return { site: out, refused };
}

/** The origins of the app that may show a preview (frame-ancestors). Only `scheme://host[:port]` and `scheme://*.host` are kept. */
export function previewParents(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const e = piece.trim().replace(/\/+$/, "").toLowerCase();
    if (/^https?:\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/.test(e) && !/^https?:\/\/\*\.[a-z]+(?::|$)/.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

/** The address a preview is seen at. Wildcard mode when there is a domain, else cookie mode. null: no site is set up. */
export function previewUrl(site: PreviewSite, token: string): string | null {
  if (site.domain) return `https://${token}.${site.domain}/`;
  if (site.host) return `https://${site.host}/p/${token}/`;
  return null;
}

/** The host a request came to, lower-case and without a port. */
export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

export const PREVIEW_COOKIE = "tzpv";

export type PreviewTarget =
  /** `<token>.<domain>`: the token is in the host; the whole path is the dev server's. */
  | { kind: "wildcard"; token: string; path: string }
  /** `/p/<token>/…` on the cookie host: set the cookie and redirect to `rest` (root-relative). */
  | { kind: "entry"; token: string; rest: string }
  /** Any other path on the cookie host: the token is in the cookie. */
  | { kind: "cookie"; path: string }
  /** A host under the preview domain that is not a token (or an unconfigured host): nothing here. */
  | { kind: "none" };

/** `/p/<61 letters>` followed by `/`, `?` or the end. */
const ENTRY = /^\/p\/([a-z2-7]{61})(\/[^?#]*)?(\?.*)?$/;

/** What a request is for, from its host and path. null when the host is not one of the preview site's (the API's request). */
export function previewTarget(url: URL, site: PreviewSite): PreviewTarget | null {
  const host = hostOf(url);
  const pathAndQuery = `${url.pathname}${url.search}`;
  if (site.domain && host.endsWith(`.${site.domain}`)) {
    const label = host.slice(0, -(site.domain.length + 1));
    return isPreviewToken(label) ? { kind: "wildcard", token: label, path: pathAndQuery } : { kind: "none" };
  }
  if (site.host && host === site.host) {
    const m = ENTRY.exec(pathAndQuery);
    if (m) return { kind: "entry", token: m[1]!, rest: `${m[2] ?? "/"}${m[3] ?? ""}` };
    return { kind: "cookie", path: pathAndQuery };
  }
  // The apex of the wildcard domain and any other host of ours are not previews.
  if (site.domain && host === site.domain) return { kind: "none" };
  return null;
}

/** The value of one cookie in a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** The Cookie header without our own cookie: the project's code never sees how it is routed. */
export function withoutCookie(header: string | null | undefined, name: string): string {
  return (header ?? "").split(";").map((p) => p.trim()).filter((p) => p && p.slice(0, p.indexOf("=") < 0 ? p.length : p.indexOf("=")).trim() !== name).join("; ");
}

/** The routing cookie: host-only (no Domain), HttpOnly, Secure, SameSite=Lax, for the life of the token. */
export function routingCookie(token: string, maxAgeSec: number): string {
  return `${PREVIEW_COOKIE}=${token}; Path=/; Max-Age=${Math.max(1, Math.floor(maxAgeSec))}; HttpOnly; Secure; SameSite=Lax`;
}

// ------------------------------------------------------- what crosses, request side

/** Headers that are the connection's, not the request's, and the ones the proxy sets itself. */
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
  "expect", "accept-encoding",
]);
/** What Cloudflare and the Worker add that the dev server has no business with. */
const EDGE = /^(?:cf-|x-forwarded-|x-real-ip|x-room-|x-device-|x-user-id|forwarded$|true-client-ip$|x-vercel-|x-amz-)/i;

export interface RequestPieces {
  method: string;
  /** Root-relative path and query. */
  path: string;
  headers: Array<[string, string]>;
}

/**
 * The headers for the dev server: the browser's own, minus the connection's and the edge's, minus our routing cookie, with Origin and Referer
 * written as the dev server's own (a dev server that checks them would otherwise refuse the public address), and the public address told in
 * X-Forwarded-* (frameworks that build absolute redirects use it). `publicHost` is the host the browser used.
 */
export function requestHeadersFor(from: Iterable<[string, string]>, o: { publicHost: string; port: number }): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const local = `http://localhost:${o.port}`;
  for (const [k0, v] of from) {
    const k = k0.toLowerCase();
    if (HOP_BY_HOP.has(k) || EDGE.test(k)) continue;
    if (k === "cookie") {
      const rest = withoutCookie(v, PREVIEW_COOKIE);
      if (rest) out.push([k, rest]);
      continue;
    }
    if (k === "origin") { out.push([k, local]); continue; }
    if (k === "referer") {
      try { const u = new URL(v); out.push([k, `${local}${u.pathname}${u.search}`]); } catch { /* an address that is not one is left out */ }
      continue;
    }
    out.push([k, v]);
  }
  out.push(["x-forwarded-host", o.publicHost], ["x-forwarded-proto", "https"]);
  return out;
}

// ------------------------------------------------------ what crosses, response side

const RESPONSE_DROP = new Set([
  ...HOP_BY_HOP, "x-frame-options", "public-key-pins", "strict-transport-security", "alt-svc", "server-timing", "report-to", "nel",
]);
// A project's own CSP stays, minus the one directive that would stop the app from showing the preview.
const stripFrameAncestors = (csp: string): string => csp.split(";").map((d) => d.trim()).filter((d) => d && !/^frame-ancestors(?:\s|$)/i.test(d)).join("; ");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"]);

/** A redirect to the dev server's own address becomes a root-relative one: it must stay on the preview. */
export function rewriteLocation(value: string): string {
  try {
    const u = new URL(value);
    if ((u.protocol === "http:" || u.protocol === "https:") && LOCAL_HOSTS.has(u.hostname.toLowerCase())) return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch { /* relative, or not an address */ }
  return value;
}

/**
 * A Set-Cookie without `Domain`: a cookie the project sets belongs to the one preview host. One with a Domain of the parent would be sent to every
 * other preview under the same domain.
 */
export function cookieWithoutDomain(value: string): string | null {
  const parts = value.split(";").map((p) => p.trim());
  const first = parts[0] ?? "";
  if (!first.includes("=")) return null;
  // Not ours to set or clear.
  if (first.slice(0, first.indexOf("=")).trim() === PREVIEW_COOKIE) return null;
  return parts.filter((p, i) => i === 0 || !/^domain\s*=/i.test(p)).join("; ");
}

/** The response headers the browser gets: the dev server's, cleaned. (Set-Cookie may repeat: pairs, not an object.) */
export function responseHeadersFor(from: Iterable<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k0, v] of from) {
    const k = k0.toLowerCase();
    if (RESPONSE_DROP.has(k)) continue;
    if (k === "set-cookie") {
      const c = cookieWithoutDomain(v);
      if (c) out.push([k, c]);
      continue;
    }
    if (k === "location") { out.push([k, rewriteLocation(v)]); continue; }
    if (k === "content-security-policy" || k === "content-security-policy-report-only") {
      const c = stripFrameAncestors(v);
      if (c) out.push([k, c]);
      continue;
    }
    out.push([k, v]);
  }
  return out;
}

/** What the door adds to every response, whoever wrote it. `parents` are the origins of the app that may show the preview. */
export function doorHeaders(parents: readonly string[]): Array<[string, string]> {
  return [
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "no-referrer"],
    ["x-robots-tag", "noindex, nofollow, noarchive"],
    ["cache-control", "no-store"],
    ["content-security-policy", `frame-ancestors ${parents.length ? parents.join(" ") : "'none'"}`],
    ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()"],
  ];
}

/**
 * THE PARTS OF THE EGRESS GUARD THAT NEED NO NODE-ONLY MODULE.
 *
 * egress.ts (the VPS's guard) dials through an undici Agent whose DNS lookup it
 * controls, so it imports undici, node:dns and node:net. The Cloudflare jobs
 * Worker cannot and must not (web/workerSafeFetch.ts is its guard), but it
 * shares everything that is only about a request and its answer: the type of a
 * fetch, the refusal that stops one, the size cap on a body, and the walk
 * through redirects, each hop checked like the first. They live here, with
 * nothing imported, and egress.ts re-exports them, so every existing import
 * of them from egress.js keeps working and behaves as it did.
 */

/** The fetch the MCP SDK takes, and the one the guards hand out. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Redirects followed for one request, each checked like the first. */
export const MAX_REDIRECTS = 3;

/** Whether a URL's host is written as an IP address: the form the URL parser leaves any spelling of one in (dotted four, or in brackets). */
export function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

/** "" is the default port of https. */
export const PORTS = new Set(["", "443", "8443"]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Statuses a Response cannot be built with a body for. */
const NO_BODY = new Set([101, 103, 204, 205, 304]);

export type RefusedReason =
  | "bad_url" | "not_https" | "bad_port" | "userinfo" | "fragment"
  | "private_address" | "no_address" | "redirects" | "too_large";

/** Plain words for each refusal: a person who pasted the address may read them. */
const REFUSED_WORDS: Record<RefusedReason, string> = {
  bad_url: "That isn't a web address.",
  not_https: "The address has to start with https://.",
  bad_port: "That address uses a port Tailzu doesn't connect to.",
  userinfo: "Take the name and password out of the address.",
  fragment: "Take the part after # out of the address.",
  private_address: "That address points into a private network, so Tailzu won't connect to it.",
  no_address: "I couldn't find that address.",
  redirects: "That address sent me through too many redirects.",
  too_large: "That app's answer was too big to take.",
};

/**
 * A request a guard would not make, or an answer it would not take. Not a
 * TypeError on purpose: the SDK reads a TypeError during discovery as a
 * browser's CORS failure and quietly tries something else, and a refusal must
 * stop the sign-in instead.
 */
export class EgressRefused extends Error {
  constructor(readonly reason: RefusedReason) {
    super(REFUSED_WORDS[reason]);
    this.name = "EgressRefused";
  }
}

export interface EgressOptions {
  /** The whole request, body included. */
  timeoutMs?: number;
  /** Most bytes the body may be (capBody). */
  maxBytes?: number;
}

/**
 * The answer's body, cut off past `max` bytes: reading further fails with
 * EgressRefused("too_large"). A Content-Length already over it fails at the
 * first read, without waiting for the bytes.
 */
export function capBody(res: Response, max: number): Response {
  if (!res.body || NO_BODY.has(res.status)) return res;
  const declared = Number(res.headers.get("content-length"));
  let seen = 0;
  const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    start(ctl) { if (declared > max) ctl.error(new EgressRefused("too_large")); },
    transform(chunk, ctl) {
      seen += chunk.byteLength;
      if (seen > max) ctl.error(new EgressRefused("too_large"));
      else ctl.enqueue(chunk);
    },
  }));
  const out = new Response(counted, { status: res.status, statusText: res.statusText, headers: res.headers });
  // The SDK names a redirect it did not follow from the response's URL.
  Object.defineProperty(out, "url", { value: res.url });
  return out;
}

/**
 * Redirects, by hand. `manual` (what the SDK asks for: it follows a redirect
 * only within the same origin, and each hop it takes comes back through here
 * and is checked) gets the redirect itself. Otherwise up to three are
 * followed, each checked; a body is only ever re-sent to the same origin, and
 * credentials never leave it.
 *
 * `check` is the guard's rules for one address (it throws EgressRefused);
 * `send` makes one request without following anything.
 */
export async function followRedirects(
  start: URL,
  init: RequestInit,
  hooks: { check(url: URL): void; send(url: URL, init: RequestInit): Promise<Response> },
): Promise<Response> {
  const mode = init.redirect ?? "follow";
  let url = start;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);
  for (let hop = 0; ; hop++) {
    hooks.check(url);
    const res = await hooks.send(url, { ...init, method, body, headers });
    const location = REDIRECTS.has(res.status) ? res.headers.get("location") : null;
    if (!location || mode === "manual") return res;
    let next: URL;
    try { next = new URL(location, url); } catch { return res; }
    const sameOrigin = next.origin === url.origin;
    const keepsBody = res.status === 307 || res.status === 308;
    // A body (a token request's code and secret) is never carried to another origin: that redirect is handed back unfollowed.
    if (body != null && keepsBody && !sameOrigin) return res;
    await res.body?.cancel().catch(() => {});
    if (mode === "error") throw new TypeError("fetch failed: redirected");
    if (hop >= MAX_REDIRECTS) throw new EgressRefused("redirects");
    if (!sameOrigin) for (const h of ["authorization", "cookie", "proxy-authorization"]) headers.delete(h);
    if (!keepsBody && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
      headers.delete("content-type");
      headers.delete("content-length");
    }
    url = next;
  }
}

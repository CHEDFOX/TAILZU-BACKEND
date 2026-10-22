/**
 * THE ONE WAY OUT TO AN APP'S SERVER.
 *
 * Every request an MCP app makes (its calls, and every step of signing in to
 * it) goes through egressFetch. An app's server, or the metadata it points us
 * at, decides which addresses we fetch: the resource metadata names the auth
 * server, the auth server names its token and registration endpoints. Without
 * a guard, any of them could aim this server at its own network (a database
 * port, a cloud metadata address) and read the answer back through an error
 * message. So, for every request, and again for every redirect it takes:
 *
 *   - https only, on port 443 or 8443, with no name:password@ and no #fragment;
 *   - an address in a private, loopback, link-local, multicast or reserved
 *     range is refused (BLOCKED below). An IPv6 address that carries an IPv4
 *     one (::ffff:10.0.0.1, 64:ff9b::10.0.0.1) is judged by the IPv4 inside;
 *   - the check is made INSIDE the connection's DNS lookup (the undici Agent's
 *     connect-time `lookup`), so the address checked is the address dialled.
 *     Checking first and connecting after would lose to DNS rebinding: a name
 *     that answers 1.2.3.4 to the check and 127.0.0.1 a moment later;
 *   - a host written as an address skips DNS, so it is checked before connecting;
 *   - at most three redirects, each one checked like the first.
 *
 * Sizes and times: an MCP answer is cut off at 1 MiB, a sign-in document
 * (metadata, a registration, a token) at 256 KiB, and a sign-in request gets
 * ten seconds start to finish, as Claude gives them.
 *
 * undici is pinned to the version inside Node 20 (6.23.0): its Agent is handed
 * to Node's own fetch as the dispatcher, so the responses are Node's own
 * Response objects, which is what the MCP SDK checks errors against.
 */
import dns from "node:dns";
import { BlockList, isIP, isIPv4, isIPv6, type LookupFunction } from "node:net";
import { Agent } from "undici";

/** The fetch the MCP SDK takes, and the one this file hands out. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Most an MCP answer may be: one POST's response, or everything over the life of the GET stream. */
export const MCP_BODY_MAX = 1024 * 1024;
/** Most a sign-in document may be: resource or auth server metadata, a registration, a token. */
export const METADATA_BODY_MAX = 256 * 1024;
/** A sign-in endpoint (discovery, registration, token) gets this long, body included. */
export const OAUTH_TIMEOUT_MS = 10_000;
/** Redirects followed for one request, each checked like the first. */
export const MAX_REDIRECTS = 3;

/** "" is the default port of https. */
const PORTS = new Set(["", "443", "8443"]);
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
 * A request this file would not make, or an answer it would not take. Not a
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

// ------------------------------------------------------------ the blocked ranges

/**
 * Nothing on the public internet lives in these, and everything worth
 * protecting does: this machine (127/8, ::1), its neighbours (10/8, 172.16/12,
 * 192.168/16, fc00::/7, link-local 169.254/16 and fe80::/10, where cloud
 * metadata answers), carrier NAT (100.64/10), benchmarking (198.18/15), and
 * the ranges that are never a single host (0/8, multicast, reserved, the
 * documentation prefix). ::/96 covers the unspecified address, loopback and
 * the old IPv4-compatible form; fec0::/10 is the retired site-local range and
 * 64:ff9b:1::/48 the local-use NAT64 prefix, both private by design.
 */
const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
];
const BLOCKED_V6 = ["::/96", "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8", "2001:db8::/32", "64:ff9b:1::/48"];

const BLOCKED = new BlockList();
for (const range of BLOCKED_V4) { const [net, bits] = range.split("/"); BLOCKED.addSubnet(net!, Number(bits), "ipv4"); }
for (const range of BLOCKED_V6) { const [net, bits] = range.split("/"); BLOCKED.addSubnet(net!, Number(bits), "ipv6"); }

/** An IPv6 address as its eight 16-bit groups, or null when it is not one. */
function v6Groups(ip: string): number[] | null {
  if (!isIPv6(ip)) return null;
  let s = ip.toLowerCase();
  // A dotted IPv4 tail (::ffff:1.2.3.4) becomes its two groups.
  const tail = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[2]!.split(".").map(Number) as [number, number, number, number];
    s = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::") as [string, string | undefined];
  const front = head ? head.split(":") : [];
  const back = rest === undefined ? [] : rest ? rest.split(":") : [];
  const groups = rest === undefined ? front : [...front, ...Array(8 - front.length - back.length).fill("0"), ...back];
  return groups.length === 8 ? groups.map((g) => parseInt(g, 16)) : null;
}

/** The IPv4 address an IPv6 one stands for (mapped, translated or NAT64), or null. */
function embeddedV4(ip: string): string | null {
  const g = v6Groups(ip);
  if (!g) return null;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const mapped = zero(0, 5) && g[5] === 0xffff; // ::ffff:a.b.c.d
  const translated = zero(0, 4) && g[4] === 0xffff && g[5] === 0; // ::ffff:0:a.b.c.d
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6); // 64:ff9b::a.b.c.d
  if (!mapped && !translated && !nat64) return null;
  return [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff].join(".");
}

/** Whether an address is one we never connect to. Anything that is not an address counts as one. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0]!; // brackets from a URL, a zone from a link-local answer
  if (isIPv4(bare)) return BLOCKED.check(bare, "ipv4");
  if (!isIPv6(bare)) return true;
  const inner = embeddedV4(bare);
  return inner ? BLOCKED.check(inner, "ipv4") : BLOCKED.check(bare, "ipv6");
}

// ---------------------------------------------------------------- the test seam

/**
 * Tests run with no real DNS and talk to their own server on 127.0.0.1 over
 * plain http. `resolve` answers every DNS question in place of the system;
 * `allow` lets those addresses through and, while it is set, also lets plain
 * http and any port through. Only ever set under vitest: anywhere else it
 * throws, so a production process cannot be talked into it.
 */
export interface EgressTestHooks {
  resolve?: (host: string) => string[];
  allow?: string[];
}

let testHooks: EgressTestHooks | null = null;

export function setEgressTestHooks(hooks: EgressTestHooks | null): void {
  if (hooks && !process.env.VITEST) throw new Error("setEgressTestHooks is for tests only");
  testHooks = hooks;
}

const refused = (ip: string) => !testHooks?.allow?.includes(ip) && isBlockedAddress(ip);

// ---------------------------------------------------------------- the checks

/** The rules a URL has to meet before anything is sent to it (the address of a named host is checked at connect time). */
function checkShape(u: URL): void {
  const loose = !!testHooks?.allow?.length;
  if (u.protocol !== "https:" && !(loose && u.protocol === "http:")) throw new EgressRefused("not_https");
  if (!loose && !PORTS.has(u.port)) throw new EgressRefused("bad_port");
  if (u.username || u.password) throw new EgressRefused("userinfo");
  if (u.hash) throw new EgressRefused("fragment");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // An address written into the URL is dialled without a DNS lookup, so the lookup below never sees it.
  if (isIP(host) && refused(host)) throw new EgressRefused("private_address");
}

async function resolveAll(host: string, family = 0): Promise<dns.LookupAddress[]> {
  if (testHooks?.resolve) {
    return testHooks.resolve(host)
      .map((address) => ({ address, family: isIPv6(address) ? 6 : 4 }))
      .filter((a) => !family || a.family === family);
  }
  return dns.promises.lookup(host, { all: true, family, verbatim: true });
}

/**
 * The connection's own DNS lookup: every address the name answers with must
 * be public, or nothing is dialled. Node asks for one address or for all of
 * them (when it races IPv4 and IPv6), and gets what it asked for.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  const family = typeof options.family === "number" ? options.family : options.family === "IPv6" ? 6 : options.family === "IPv4" ? 4 : 0;
  resolveAll(hostname, family).then((addrs) => {
    if (!addrs.length) throw new EgressRefused("no_address");
    if (addrs.some((a) => refused(a.address))) throw new EgressRefused("private_address");
    if (options.all) callback(null, addrs);
    else callback(null, addrs[0]!.address, addrs[0]!.family);
  }).catch((err: NodeJS.ErrnoException) => callback(err, "", 0));
};

let agent: Agent | undefined;
const dispatcher = () => (agent ??= new Agent({ connect: { lookup: guardedLookup } }));

/**
 * An address a person typed or pasted, checked before it is kept: the same
 * rules as every request, plus a DNS lookup now so they hear about a private
 * address at once. The lookup at connect time still decides, every time.
 */
export async function checkPublicUrl(raw: unknown): Promise<URL> {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) throw new EgressRefused("bad_url");
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new EgressRefused("bad_url"); }
  checkShape(u);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host)) {
    let addrs: dns.LookupAddress[];
    try { addrs = await resolveAll(host); } catch { throw new EgressRefused("no_address"); }
    if (!addrs.length) throw new EgressRefused("no_address");
    if (addrs.some((a) => refused(a.address))) throw new EgressRefused("private_address");
  }
  return u;
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

// ---------------------------------------------------------------- the fetch

/** One request through the guarded Agent. A refusal inside the lookup comes out as itself, not as "fetch failed". */
async function send(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "manual", dispatcher: dispatcher() } as RequestInit);
  } catch (err) {
    const cause = (err as { cause?: unknown })?.cause;
    throw cause instanceof EgressRefused ? cause : err;
  }
}

/**
 * Redirects, by hand. `manual` (what the SDK asks for: it follows a redirect
 * only within the same origin, and each hop it takes comes back through here
 * and is checked) gets the redirect itself. Otherwise up to three are
 * followed, each checked; a body is only ever re-sent to the same origin, and
 * credentials never leave it.
 */
async function follow(start: URL, init: RequestInit): Promise<Response> {
  const mode = init.redirect ?? "follow";
  let url = start;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);
  for (let hop = 0; ; hop++) {
    checkShape(url);
    const res = await send(url, { ...init, method, body, headers });
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

export interface EgressOptions {
  /** The whole request, body included. */
  timeoutMs?: number;
  /** Most bytes the body may be (capBody). */
  maxBytes?: number;
}

/** A guarded fetch with a time limit and a size limit of its own. */
export function egressFetchWith(o: EgressOptions = {}): FetchLike {
  return async (input, init = {}) => {
    const timer = o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined;
    const signal = timer && init.signal ? AbortSignal.any([init.signal, timer]) : timer ?? init.signal ?? undefined;
    const res = await follow(new URL(String(input)), { ...init, signal });
    return o.maxBytes ? capBody(res, o.maxBytes) : res;
  };
}

/** The guard alone, with no limits of its own. */
export const egressFetch: FetchLike = egressFetchWith();
/** An MCP server's calls and its stream: the call's own timeout applies (client.ts), the body is capped at 1 MiB. */
export const mcpFetch: FetchLike = egressFetchWith({ maxBytes: MCP_BODY_MAX });
/** Signing in: discovery, registration, token. Ten seconds and 256 KiB each. */
export const oauthFetch: FetchLike = egressFetchWith({ timeoutMs: OAUTH_TIMEOUT_MS, maxBytes: METADATA_BODY_MAX });

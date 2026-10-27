/**
 * THE JOBS WORKER'S GUARD: THE SAME RULES AS THE VPS'S EGRESS GUARD, WITHOUT A DNS LOOKUP OF ITS OWN.
 *
 * connectors/egress.ts keeps a person's-address from aiming this server at its own
 * network by resolving the name inside the connection (undici's Agent) and
 * refusing a private answer. A Worker has no such Agent, and jobs/ must not
 * bundle undici, node:dns or node:net. What it can do is judge the address as
 * WRITTEN, before anything is sent, and again for every redirect:
 *
 *   - https only, on port 443 or 8443, with no name:password@ and no #fragment;
 *   - an address written as an IP (1.2.3.4, [::1], and every other spelling of
 *     one, which the URL parser has already turned into those two forms) is
 *     refused outright: not "is it private?", just "no". Nothing here reads a
 *     page by number. A Worker cannot dial a raw IP anyway (Cloudflare, "Known
 *     issues: Fetch to IP addresses");
 *   - a name that can only be a private one is refused: localhost and
 *     *.localhost, *.local, *.internal, and the other names a private network
 *     gives itself (*.lan, *.localdomain, *.home.arpa, *.intranet, *.corp,
 *     *.home), and a name with no dot at all;
 *   - redirects are walked by hand, at most three, each hop checked like the
 *     first (the fetch is made with redirect: "manual", and the 3xx comes back
 *     as it is);
 *   - the same time limit and the same cap on the body as egressFetchWith.
 *
 * WHAT IT CANNOT DO, AND WHY THAT IS OK HERE. A public NAME that resolves to a
 * private address (DNS rebinding) is not caught by anything in this file. On the
 * VPS that would be the whole attack, because the VPS sits inside our network.
 * A Worker does not: its fetch() leaves from Cloudflare's network, which has no
 * route to our private addresses (a Worker reaches a private network only
 * through Workers VPC or a Tunnel binding that this Worker does not have), and
 * it refuses raw IPs. The Worker also holds no credentials a fetched page could
 * be tricked into carrying: a stranger's address never receives an
 * Authorization header from it (the GitHub client is a different fetch). Cloudflare is
 * relied on for this, not tested here; docs/cloudflare-jobs.md says so.
 *
 * Imports nothing of the app, so tests can load it anywhere.
 */
import {
  EgressRefused, PORTS, capBody, followRedirects, isIpLiteral, type EgressOptions, type FetchLike,
} from "../connectors/egressTypes.js";
import type { SafeFetchImpl } from "./safeFetch.js";

/** Names only a private network gives itself, and the loopback names. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".lan", ".home.arpa", ".intranet", ".corp", ".home"];

/** Whether a host NAME can only be a private one (or has no dot, so cannot be a public site). */
export function isPrivateName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, "");
  if (!h || h === "localhost" || !h.includes(".")) return true;
  return PRIVATE_SUFFIXES.some((s) => h.endsWith(s));
}

/** The rules for one address. Throws EgressRefused. */
export function checkWorkerUrl(u: URL): void {
  if (u.protocol !== "https:") throw new EgressRefused("not_https");
  if (!PORTS.has(u.port)) throw new EgressRefused("bad_port");
  if (u.username || u.password) throw new EgressRefused("userinfo");
  if (u.hash) throw new EgressRefused("fragment");
  if (isIpLiteral(u.hostname) || isPrivateName(u.hostname)) throw new EgressRefused("private_address");
}

/** A guarded fetch with a time limit and a size limit of its own. `base` is the platform's fetch; tests pass a fake. */
export function workerSafeFetchWith(o: EgressOptions = {}, base: FetchLike = (url, init) => fetch(url, init)): FetchLike {
  const send = (url: URL, init: RequestInit) => base(url, { ...init, redirect: "manual" });
  return async (input, init = {}) => {
    const timer = o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined;
    const signal = timer && init.signal ? AbortSignal.any([init.signal, timer]) : timer ?? init.signal ?? undefined;
    let url: URL;
    try { url = new URL(String(input)); } catch { throw new EgressRefused("bad_url"); }
    const res = await followRedirects(url, { ...init, signal }, { check: checkWorkerUrl, send });
    return o.maxBytes ? capBody(res, o.maxBytes) : res;
  };
}

/** The guard alone, with no limits of its own. */
export const workerSafeFetch: FetchLike = workerSafeFetchWith();

/** What the Worker installs in web/safeFetch.ts. Every address written as an IP is refused, so every one is "blocked". */
export const workerSafeFetchImpl: SafeFetchImpl = {
  fetchWith: (o) => workerSafeFetchWith(o),
  isBlockedAddress: () => true,
};

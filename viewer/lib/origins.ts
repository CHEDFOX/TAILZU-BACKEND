/**
 * Which pages may embed the viewer and talk to it. One list (`VIEWER_PARENT_ORIGINS`) drives three things:
 * the `frame-ancestors` of the shell's CSP, the targets of the viewer's `postMessage` calls, and the check on every
 * message that arrives.
 *
 * An entry is `scheme://host[:port]`, or `scheme://*.host[:port]` for every subdomain of a host. Nothing else is kept:
 * no paths, no bare `*`, no `null`.
 */

const ENTRY = /^(https?):\/\/((?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(:\d{1,5})?$/;

/** The valid origins in a comma/space separated list, lower-cased and without duplicates. Invalid entries are dropped. */
export function parseOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const entry = piece.trim().replace(/\/+$/, "").toLowerCase();
    if (!entry) continue;
    const m = ENTRY.exec(entry);
    if (!m) continue;
    // `https://*.com` would allow every .com site: a wildcard needs at least two labels after it.
    const host = m[2]!;
    if (host.startsWith("*.") && host.slice(2).split(".").length < 2) continue;
    if (m[3] && Number(m[3].slice(1)) > 65535) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/** Is `origin` (as `MessageEvent.origin` gives it) one of the allowed entries? */
export function originAllowed(origin: string, allowed: readonly string[]): boolean {
  const o = ENTRY.exec(origin.toLowerCase());
  if (!o || o[2]!.startsWith("*")) return false;
  const [, scheme, host, port = ""] = o as unknown as [string, string, string, string | undefined];
  for (const entry of allowed) {
    const m = ENTRY.exec(entry);
    if (!m || m[1] !== scheme || (m[3] ?? "") !== port) continue;
    const want = m[2]!;
    if (want === host) return true;
    if (want.startsWith("*.") && host.endsWith(want.slice(1)) && host.length > want.length - 1) return true;
  }
  return false;
}

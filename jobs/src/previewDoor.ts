/**
 * THE PREVIEW'S DOOR: THE PROJECT'S DEV SERVER, SEEN IN A BROWSER, THROUGH THE JOB'S ROOM AND ITS RUNNER'S SOCKET.
 *
 * A request to a preview host is not the API's. Which host it came to says so, before anything else is looked at (index.ts): the Worker answers
 * `<token>.<PREVIEW_DOMAIN>` (wildcard mode: a Workers route `*.<domain>/*`) and `<PREVIEW_HOST>` (cookie mode) here, and every other host as the API.
 * The preview's site is checked against the API's and the app's at start-up (`guardSite`): it runs the person's project code, so it shares a site with neither.
 *
 *   wildcard   `https://<token>.<domain>/anything`        the token is in the host; absolute paths (`/src/main.tsx`) just work
 *   cookie     `https://<host>/p/<token>/anything`        the first visit sets a host-only, HttpOnly, SameSite=Lax cookie and redirects to `/anything`;
 *                                                         every later root-relative request is routed by the cookie
 *
 * What it does with a request, in order, each step before the next costs anything:
 *   1. the method is one a browser sends; an upgrade (HMR's WebSocket) is refused, 426: a preview reloads on refresh
 *   2. the token is read (shape, signature, expiry) with no object woken, so a scanner of names wakes nothing
 *   3. the body is read, at most 1 MB
 *   4. the job's room is asked (previewHttp): it checks the nonce is the open preview's, passes the request to the runner and holds for the answer
 *   5. the answer gets the door's headers: no-store, nosniff, no referrer, noindex, and a CSP that lets only the app frame it
 *
 * Nothing here logs an address, a token, a header or a body.
 */
import { PREVIEW_REQ_MAX_BYTES } from "../../tulmi/src/code/live/limits.js";
import {
  PREVIEW_COOKIE, cookieValue, doorHeaders, guardSite, previewAvailable, previewParents, previewSite, previewTarget, readPreviewToken, routingCookie, type PreviewSite,
} from "../../tulmi/src/code/live/preview.js";
import { applyEnv, type Env } from "./env.js";
import { roomOf } from "./rooms.js";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const DEFAULT_PARENTS = "https://tailzu.space,https://www.tailzu.space";

const hostOf = (v: unknown): string[] => {
  try { return typeof v === "string" && v.trim() ? [new URL(v.includes("://") ? v : `https://${v}`).hostname] : []; } catch { return []; }
};

let warned = false;

/**
 * The preview site from the Worker's settings (PREVIEW_DOMAIN, PREVIEW_HOST), with whatever shares a site with the API (CODE_JOBS_URL), the VPS
 * (PUBLIC_ORIGIN) or the app (PREVIEW_PARENT_ORIGINS) taken out and said once in the log. {} when previews are not set up.
 */
export function previewSiteOf(env: Env): PreviewSite {
  const wanted = previewSite(env as { PREVIEW_DOMAIN?: unknown; PREVIEW_HOST?: unknown });
  if (!previewAvailable(wanted)) return {};
  const own = [env.CODE_JOBS_URL, env.PUBLIC_ORIGIN, ...previewParents(env.PREVIEW_PARENT_ORIGINS ?? DEFAULT_PARENTS).map((o) => o.replace("*.", ""))].flatMap(hostOf);
  const g = guardSite(wanted, own);
  if (g.refused.length && !warned) {
    warned = true;
    for (const why of g.refused) console.warn(`jobs worker: previews are off for a setting: ${why}`);
  }
  return g.site;
}

export interface PreviewDoorDeps {
  now?: () => number;
}

const plain = (status: number, code: string, message: string, parents: readonly string[], extra: Array<[string, string]> = []): Response => {
  const h = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const [k, v] of doorHeaders(parents)) h.set(k, v);
  for (const [k, v] of extra) h.set(k, v);
  return new Response(JSON.stringify({ code, message }), { status, headers: h });
};

/** The body, read up to `max` bytes. null: it is over. */
async function readLimited(req: Request, max: number): Promise<ArrayBuffer | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return all.buffer;
}

/**
 * Answers a request to a preview host, or returns null when the host is not one (it is the API's). `site` is the checked site (index.ts).
 */
export async function handlePreview(req: Request, env: Env, site: PreviewSite, d: PreviewDoorDeps = {}): Promise<Response | null> {
  const url = new URL(req.url);
  const target = previewTarget(url, site);
  if (!target) return null;
  applyEnv(env);
  const parents = previewParents(env.PREVIEW_PARENT_ORIGINS ?? DEFAULT_PARENTS);
  const secret = env.CODE_JOBS_SECRET;
  if (!secret) return plain(503, "not_configured", "Previews are not set up on this Worker.", parents);
  if (!METHODS.has(req.method)) return plain(405, "method_not_allowed", "That method is not passed on.", parents, [["allow", [...METHODS].join(", ")]]);
  if (req.headers.get("upgrade")) return plain(426, "websocket_unsupported", "A preview does not carry WebSockets, so live reload is off: reload the page to see a change.", parents);
  const now = (d.now ?? Date.now)();

  if (target.kind === "none") return plain(404, "preview_not_found", "There is no such preview.", parents);

  // Cookie mode, first visit: the token in the path becomes a cookie, and the browser goes on to the same address without it.
  if (target.kind === "entry") {
    const read = readPreviewToken(secret, target.token, now);
    if (!read.ok) return plain(read.reason === "expired" ? 410 : 404, read.reason === "expired" ? "preview_closed" : "preview_not_found", read.reason === "expired" ? "This preview has ended." : "There is no such preview.", parents);
    const h = new Headers({ location: target.rest });
    for (const [k, v] of doorHeaders(parents)) h.set(k, v);
    h.append("set-cookie", routingCookie(target.token, (read.exp - now) / 1000));
    return new Response(null, { status: 302, headers: h });
  }

  const token = target.kind === "wildcard" ? target.token : cookieValue(req.headers.get("cookie"), PREVIEW_COOKIE);
  const read = readPreviewToken(secret, token, now);
  if (!read.ok) {
    // On the cookie host a visit with no (or a stale) cookie is told how to start one: the address the app shows.
    return read.reason === "expired"
      ? plain(410, "preview_closed", "This preview has ended.", parents)
      : plain(404, "preview_not_found", "There is no such preview. Open it from the app.", parents);
  }
  const path = target.path;

  const body = req.method === "GET" || req.method === "HEAD" ? new ArrayBuffer(0) : await readLimited(req, PREVIEW_REQ_MAX_BYTES);
  if (body === null) return plain(413, "request_too_large", "A request to a preview may carry 1 MB at most.", parents);

  const answer = await roomOf(env, read.jobId).previewHttp({
    nonce: read.nonce, method: req.method, path, headers: [...req.headers.entries()], body: body.byteLength ? body : null, publicHost: url.host,
  });

  // The room's answer, with the door's headers over it: nothing a project sends can turn off no-store, nosniff or the framing rule.
  const h = new Headers(answer.headers);
  const csp = h.get("content-security-policy");
  for (const [k, v] of doorHeaders(parents)) {
    if (k === "content-security-policy") { h.set(k, csp ? `${csp}; ${v}` : v); continue; }
    h.set(k, v);
  }
  return new Response(answer.body, { status: answer.status, headers: h });
}

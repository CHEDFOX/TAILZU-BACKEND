/**
 * SIGN IN ON A COMPUTER WITH THE PHONE: the routes (auth/deviceLink.ts has the rules; docs/bots-gaps.md item 16).
 *
 *   POST /v1/auth/link          the window, signed out: { deviceName?, platform? } → { token, secret, code, url, qr,
 *                               expiresAt, ttlMs, pollMs }. The QR (drawn here, shell/qr.ts: no service is asked) holds
 *                               `url`, which opens bots.link on the phone; `code` is the typed way to the same request.
 *   POST /v1/auth/link/poll     the window: { token, secret, wait? } → { status } (pending, approved, denied, expired,
 *                               used, failed); approved, once, with { tokenHash, type } for Supabase's /auth/v1/verify.
 *   POST /v1/auth/link/view     the phone, signed in: { token } or { code } → the computer's name, system, status, times
 *   POST /v1/auth/link/approve  the phone, signed in: { token } or { code }
 *   POST /v1/auth/link/deny     the phone, signed in: { token } or { code } ("Not me")
 *   GET  /s/bots.link           the QR's link opened in a browser (no app, or links not taken by it): a page that opens
 *                               the app at the same screen, and nothing else
 *
 * Off (404 link_off) on a server that cannot mint a session (no service key). Rate-limited: the two signed-out routes
 * per address, the rest per person (the limiter's own key), the code-taking ones tightest.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { defaultDeviceLinks, LINK_TTL_MS, showCode, TOKEN_RE, type DeviceLinks, type LinkRef } from "../auth/deviceLink.js";
import { qrOf, qrPath } from "../shell/qr.js";

/** Where the QR's link points: a host the phone app claims (associatedDomains, intentFilters), serving /s/* (AASA). */
export const LINK_ORIGIN = (process.env.DEVICE_LINK_ORIGIN || "https://app.tailzu.space").replace(/\/+$/, "");
/** The phone's screen for it (bots.link, ids.ts) and its parameter. */
const LINK_SCREEN = "bots.link";
export const linkUrl = (token: string): string => `${LINK_ORIGIN}/s/${LINK_SCREEN}?l=${token}`;
/** How often the window asks again when a held poll comes back with nothing (it holds for up to 25 s). */
const POLL_MS = 1_500;

type Limit = { max: number; timeWindow: number };
export interface DeviceLinkRouteOpts {
  /** The service; absent, the real one (null when the server has no service key: the routes answer link_off). */
  links?: DeviceLinks | null;
  /** Who is asking (tests); absent, the app's own resolveUser. */
  resolve?: (authorization: string | undefined) => Promise<AuthedUser | null>;
  /** Off in tests that do not register the limiter. */
  limits?: boolean;
}

const LIMITS: Record<"create" | "poll" | "view" | "decide", Limit> = {
  // A window makes one every five minutes while its sign-in is up.
  create: { max: 12, timeWindow: 10 * 60_000 },
  // Held up to 25 s each: a few a minute per window, room for several computers behind one address.
  poll: { max: 90, timeWindow: 60_000 },
  // A typed code is 40 bits; this keeps guessing one hopeless.
  view: { max: 20, timeWindow: 10 * 60_000 },
  decide: { max: 20, timeWindow: 10 * 60_000 },
};

const ref = (body: unknown): LinkRef => {
  const b = (body ?? {}) as { token?: unknown; code?: unknown };
  return { token: typeof b.token === "string" ? b.token : undefined, code: typeof b.code === "string" ? b.code : undefined };
};

export function registerDeviceLinkRoutes(app: FastifyInstance, opts: DeviceLinkRouteOpts = {}): void {
  const links = opts.links === undefined ? defaultDeviceLinks() : opts.links;
  const resolve = opts.resolve ?? resolveUser;
  const limit = (l: Limit) => (opts.limits === false ? {} : { config: { rateLimit: l } });
  const off = (reply: FastifyReply) => reply.code(404).send({ code: "link_off", message: "Signing in with the phone is not available." });
  const person = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolve(req.headers["authorization"]);
    if (!user) { await reply.code(401).send({ code: "unauthorized", message: "Sign in first" }); return null; }
    return user;
  };
  const noStore = (reply: FastifyReply) => reply.header("Cache-Control", "no-store");

  app.post("/v1/auth/link", limit(LIMITS.create), async (req, reply) => {
    if (!links) return off(reply);
    const b = (req.body ?? {}) as { deviceName?: unknown; platform?: unknown };
    const ua = req.headers["user-agent"];
    const made = await links.create({ deviceName: b.deviceName, platform: b.platform, ip: req.ip, userAgent: typeof ua === "string" ? ua : null });
    const url = linkUrl(made.token);
    const qr = qrOf(url);
    noStore(reply);
    return {
      token: made.token, secret: made.secret, code: showCode(made.code), url,
      ...(qr ? { qr: { size: qr.size + 8, path: qrPath(qr, 4) } } : {}),
      expiresAt: made.expiresAt, ttlMs: LINK_TTL_MS, pollMs: POLL_MS,
    };
  });

  app.post("/v1/auth/link/poll", limit(LIMITS.poll), async (req, reply) => {
    if (!links) return off(reply);
    const b = (req.body ?? {}) as { token?: unknown; secret?: unknown; wait?: unknown };
    const wait = Math.min(Math.max(Number(b.wait) || 0, 0), 25) * 1000;
    const answer = await links.poll(String(b.token ?? ""), String(b.secret ?? ""), wait);
    noStore(reply);
    if (!answer) return reply.code(404).send({ code: "not_found" });
    if (answer.status === "failed") req.log.warn("device link: approved, but no sign-in could be made");
    return answer;
  });

  app.post("/v1/auth/link/view", limit(LIMITS.view), async (req, reply) => {
    if (!links) return off(reply);
    const user = await person(req, reply);
    if (!user) return reply;
    const view = await links.view(ref(req.body));
    noStore(reply);
    if (!view) return reply.code(404).send({ code: "not_found" });
    // The session is made from the account's address: without one, the phone says so before anyone presses Approve.
    return { ...view, canApprove: !!user.email && !user.id.startsWith("static-"), ...(user.email ? { account: user.email } : {}) };
  });

  for (const [path, yes] of [["/v1/auth/link/approve", true], ["/v1/auth/link/deny", false]] as const) {
    app.post(path, limit(LIMITS.decide), async (req, reply) => {
      if (!links) return off(reply);
      const user = await person(req, reply);
      if (!user) return reply;
      const d = await links.decide(ref(req.body), user, yes);
      noStore(reply);
      if (d.ok) return d;
      const status = d.error === "not_found" ? 404 : d.error === "expired" ? 410 : d.error === "not_allowed" ? 403 : 409;
      return reply.code(status).send({ code: d.error });
    });
  }

  // The QR opened in a browser instead of the app. One fixed page: a button to the same screen in the app (tulmi://,
  // which the app registers) and where to get it. The token is echoed only after matching its exact shape, so nothing
  // from the address is written into the page as anything but itself; no script runs here at all.
  app.get(`/s/${LINK_SCREEN}`, async (req, reply) => {
    const l = String((req.query as { l?: unknown } | undefined)?.l ?? "");
    const open = TOKEN_RE.test(l) ? `tulmi://screen/${LINK_SCREEN}?l=${l}` : "";
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Robots-Tag", "noindex");
    noStore(reply);
    reply.type("text/html; charset=utf-8");
    return linkPage(open);
  });
}

/** Where the app is got (the API's own /download page). */
const DOWNLOAD = `${(process.env.PUBLIC_ORIGIN || "https://api.tailzu.space").replace(/\/+$/, "")}/download`;

/** The browser's page for the QR's link. */
function linkPage(open: string): string {
  const button = open
    ? `<a class="btn" href="${open}">Open in Tailzu</a><p>Then tap Approve to sign in on your computer.</p>`
    : `<p>This link is not complete. Show a new code on your computer and scan it again.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in on your computer · Tailzu</title>
<style>body{margin:0;font:16px/1.45 -apple-system,system-ui,sans-serif;color:#0a0a0a;background:#fff}main{max-width:420px;margin:0 auto;padding:56px 20px;display:flex;flex-direction:column;gap:14px}h1{font-size:26px;line-height:31px;margin:0;letter-spacing:-.5px}p{margin:0;color:#3d3d3d;font-size:15px}.btn{display:flex;align-items:center;justify-content:center;height:54px;border-radius:27px;background:#0a0a0a;color:#fff;text-decoration:none;font-weight:600;margin-top:8px}.meta{font-size:13px;color:#5c5c5c}a{color:#0a0a0a}</style></head>
<body><main><h1>Sign in on your computer</h1>${button}
<p class="meta">No Tailzu on this phone? <a href="${DOWNLOAD}">Get it here</a>, sign in, and scan the code again.</p></main></body></html>`;
}

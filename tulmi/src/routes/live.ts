/**
 * LIVE UPDATES: THE CHANNEL. WS /v1/live carries "this changed" (live/bus.ts) to every device a person has open, so a screen
 * listening to that topic reloads itself within about a second of a change made on another device.
 *
 *   client → server   { type: "auth", token }   the first message, unless the upgrade carried `Authorization: Bearer …`
 *                     { type: "pong" }          the answer to a ping (any message counts as alive)
 *   server → client   { type: "ready", heartbeatMs }
 *                     { type: "event", topic, at, data? }   a hint; the screen's own load decides what it shows
 *                     { type: "ping", at }      every heartbeatMs, with a WebSocket ping frame beside it
 *                     { type: "error", code: "unauthorized" }, then close 4401
 *
 * The token is never in the URL (the URL is what gets logged) and never logged. Same sign-in as every /v1 route (resolveUser):
 * a Supabase session or a desktop's static token. Not signed in within AUTH_TIMEOUT_MS: closed.
 *
 * Close codes: 4401 not signed in, 4008 too many open for one person (the OLDEST goes, so a device that reconnects before the
 * server noticed its old socket die is never locked out), 4000 time to renew (after MAX_LIFETIME_MS, so a session that has been
 * signed out does not hear on forever; the client reconnects with its current token), 1001 the server is stopping. A socket that
 * answers neither a ping frame nor a ping message for two heartbeats is dropped.
 *
 * ONE PROCESS holds every connection (bus.ts). Run the backend as several and each process's sockets hear only that process's
 * publishes: give the bus a relay (live.setRelay: Postgres LISTEN/NOTIFY or Redis, fanning out to bus.deliver on every process)
 * and nothing here changes.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { live, type LiveBus, type LiveEvent } from "../live/bus.js";
import { resolveUser } from "../auth/supabase.js";
import { getConfig } from "../config.js";

export const LIVE_PATH = "/v1/live";
export const CLOSE = { unauthorized: 4401, tooMany: 4008, renew: 4000, stopping: 1001 } as const;

export interface LiveRouteOptions {
  bus?: LiveBus;
  /** Who a bearer belongs to (resolveUser). */
  resolve?: (authorization: string | undefined) => Promise<{ id: string } | null>;
  /** Most sockets one person may hold open at once (8: a phone, a computer or two, and the overlap of a reconnect). */
  maxPerUser?: number;
  /** A ping each way this often (25 s: under the idle cut of the usual proxies and phone networks). */
  heartbeatMs?: number;
  /** How long a socket may stay unsigned (10 s). */
  authTimeoutMs?: number;
  /** A socket is renewed after this long, with a little spread (30 min). */
  maxLifetimeMs?: number;
  /** The upgrade's own limit (the app's per-user limit by default). */
  rateLimit?: { max: number; timeWindow: number };
}

export interface LiveRoutes {
  /** Open, signed-in sockets for one person. */
  count(userId: string): number;
  /** Every open, signed-in socket. */
  total(): number;
}

interface Conn { close(code: number, reason: string): void }

/** A message small enough to be one of ours, parsed, or null. */
function parse(raw: unknown): Record<string, unknown> | null {
  const s = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : "";
  if (!s || s.length > 4096) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

export function registerLiveRoutes(app: FastifyInstance, o: LiveRouteOptions = {}): LiveRoutes {
  const bus = o.bus ?? live;
  const resolve = o.resolve ?? ((a: string | undefined) => resolveUser(a));
  const maxPerUser = Math.max(1, o.maxPerUser ?? 8);
  const heartbeatMs = Math.max(50, o.heartbeatMs ?? 25_000);
  const authTimeoutMs = Math.max(50, o.authTimeoutMs ?? 10_000);
  const maxLifetimeMs = Math.max(1000, o.maxLifetimeMs ?? 30 * 60_000);
  const rateLimit = o.rateLimit ?? (() => { const cfg = getConfig(); return { max: cfg.RATE_LIMIT_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS }; })();
  /** Per person, in the order they opened. */
  const open = new Map<string, Set<Conn>>();
  const everyone = new Set<Conn>();

  app.get(LIVE_PATH, { websocket: true, config: { rateLimit } }, (socket: any, req: FastifyRequest) => {
    let userId: string | null = null;
    let started = false;
    let closed = false;
    let alive = true;
    let stop: (() => void) | null = null;
    let beat: ReturnType<typeof setInterval> | null = null;
    let life: ReturnType<typeof setTimeout> | null = null;

    const send = (m: Record<string, unknown>): void => {
      if (closed || socket.readyState !== 1) return;
      try { socket.send(JSON.stringify(m)); } catch { /* the close handler tidies up */ }
    };
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(authTimer);
      if (beat) clearInterval(beat);
      if (life) clearTimeout(life);
      stop?.();
      stop = null;
      everyone.delete(conn);
      if (userId) {
        const set = open.get(userId);
        set?.delete(conn);
        if (set && !set.size) open.delete(userId);
      }
    };
    const conn: Conn = {
      close: (code, reason) => {
        cleanup();
        try { socket.close(code, reason); } catch { /* already gone */ }
      },
    };
    const refuse = (): void => { send({ type: "error", code: "unauthorized", message: "Sign in again to continue." }); conn.close(CLOSE.unauthorized, "unauthorized"); };
    const authTimer = setTimeout(refuse, authTimeoutMs);

    const begin = async (authorization: string | undefined): Promise<void> => {
      if (started) return;
      started = true;
      let who: { id: string } | null = null;
      try { who = await resolve(authorization); } catch (err) { req.log.warn({ err }, "live: could not check the session"); }
      if (closed) return;
      if (!who?.id) { refuse(); return; }
      clearTimeout(authTimer);
      userId = who.id;
      // Too many open for one person: the oldest goes.
      let set = open.get(userId);
      if (!set) open.set(userId, (set = new Set()));
      set.add(conn);
      everyone.add(conn);
      while (set.size > maxPerUser) {
        const oldest = set.values().next().value as Conn;
        oldest.close(CLOSE.tooMany, "too many");
      }
      stop = bus.subscribe(userId, (e: LiveEvent) => send({ type: "event", topic: e.topic, at: e.at, ...(e.data ? { data: e.data } : {}) }));
      send({ type: "ready", heartbeatMs });
      beat = setInterval(() => {
        if (!alive) { cleanup(); try { socket.terminate(); } catch { /* gone */ } return; }
        alive = false;
        try { socket.ping(); } catch { /* the next beat ends it */ }
        send({ type: "ping", at: Date.now() });
      }, heartbeatMs);
      beat.unref?.();
      // Renewed with a little spread, so sockets opened together do not all come back together.
      life = setTimeout(() => conn.close(CLOSE.renew, "renew"), maxLifetimeMs + Math.floor(Math.random() * Math.min(60_000, maxLifetimeMs / 10)));
      life.unref?.();
    };

    socket.on("pong", () => { alive = true; });
    socket.on("message", (raw: unknown, isBinary: boolean) => {
      alive = true;
      if (isBinary || closed) return;
      const m = parse(raw);
      if (!m) return;
      if (m.type === "auth" && !started) {
        const token = typeof m.token === "string" ? m.token.trim() : "";
        void begin(token ? `Bearer ${token}` : undefined);
      }
    });
    socket.on("close", cleanup);
    socket.on("error", cleanup);

    // A client that can set the upgrade's headers is signed in straight away.
    const header = req.headers.authorization;
    if (typeof header === "string" && header.trim()) void begin(header);
  });

  app.addHook("onClose", async () => {
    for (const c of [...everyone]) c.close(CLOSE.stopping, "stopping");
  });

  return {
    count: (userId) => open.get(userId)?.size ?? 0,
    total: () => everyone.size,
  };
}

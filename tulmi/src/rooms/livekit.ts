/**
 * LIVEKIT, WHAT CARRIES OUR CALLS' VIDEO AND SOUND (src/rooms, docs/rooms.md): the passes people join a room with, the server's calls to it,
 * and its webhook's signature. Plain fetch and node:crypto, no SDK.
 *
 *   passFor({ room, identity, name, host, ttlSec })   a join pass: a JWT signed with LIVEKIT_API_SECRET, good to join that one room
 *   livekit()                                         the server's client, or null without LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET:
 *     .ensureRoom(name, { maxPeople })                 the room made, or found (LiveKit makes it once and answers the same one after)
 *     .deleteRoom(name)                                everyone in it sent away, and the room gone (one already gone is fine)
 *     .removeParticipant(name, identity)               one person sent away
 *   verifyLivekit(auth, body, keys, nowSec)           its webhook: Authorization is a JWT signed with the same secret, its sha256 the body's
 *
 * A pass names nobody: a host is "h_" and a hash of their account, a guest "g_" and random letters (rooms/service.ts), because everyone in a
 * call sees everyone's identity. The name shown is the one each gives. A pass is short-lived: it only has to last until the app or the page
 * has connected, and LiveKit gives a connected one its own fresh passes after that.
 *
 * The secret is never logged, never in an error, never sent anywhere: only signatures made with it leave this server.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { RoomsError } from "./types.js";

type FetchFn = typeof fetch;

export interface LivekitKeys { url: string; key: string; secret: string }

/** The server's own keys, or null when calls are not set up. */
export function livekitKeys(): LivekitKeys | null {
  const c = getConfig();
  return c.LIVEKIT_URL && c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET ? { url: c.LIVEKIT_URL, key: c.LIVEKIT_API_KEY, secret: c.LIVEKIT_API_SECRET } : null;
}

// ------------------------------------------------------------------------------------------------------------------------ the JWT

const SKEW_SEC = 60;
const json64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A JWT signed HS256 with the secret. */
export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const head = json64({ alg: "HS256", typ: "JWT" });
  const body = json64(claims);
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

/** The claims of a JWT signed HS256 with the secret, current at nowSec (a minute either way); null for anything else. */
export function readJwt(token: string, secret: string, nowSec: number): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  const [head, body, sig] = parts as [string, string, string];
  let header: unknown, claims: unknown;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch { return null; }
  if (!header || typeof header !== "object" || (header as { alg?: unknown }).alg !== "HS256") return null;
  const want = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  const c = claims as Record<string, unknown>;
  if (typeof c.exp === "number" && c.exp < nowSec - SKEW_SEC) return null;
  if (typeof c.nbf === "number" && c.nbf > nowSec + SKEW_SEC) return null;
  return c;
}

// ------------------------------------------------------------------------------------------------------------------------ a pass

export interface PassInput {
  /** LiveKit's name for the room (rooms/service.ts lkName). */
  room: string;
  identity: string;
  /** The name the others see. */
  name: string;
  /** The host may send people away and end the call for everyone. */
  host: boolean;
  ttlSec: number;
}

/** A pass to join one room: publish camera, microphone and screen, hear and see the others, send chat; a host is the room's admin too. */
export function passFor(p: PassInput, keys: Pick<LivekitKeys, "key" | "secret">, nowSec: number): string {
  return signJwt({
    iss: keys.key, sub: p.identity, jti: p.identity, name: p.name, nbf: nowSec - SKEW_SEC, exp: nowSec + p.ttlSec,
    metadata: JSON.stringify({ role: p.host ? "host" : "guest" }),
    video: {
      room: p.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false,
      ...(p.host ? { roomAdmin: true } : {}),
    },
  }, keys.secret);
}

// ------------------------------------------------------------------------------------------------------------------------ the server's calls

/** What rooms/service.ts needs of LiveKit. */
export interface Livekit {
  /** The address the apps connect to (wss://…). */
  url: string;
  ensureRoom(name: string, o: { maxPeople: number }): Promise<void>;
  deleteRoom(name: string): Promise<void>;
  removeParticipant(name: string, identity: string): Promise<void>;
}

const CALL_MS = 8_000;
/** An empty room stays this long, so the first person can wait for the second; then LiveKit closes it (the link still works after). */
const EMPTY_SEC = 10 * 60;
/** After the last person leaves, the room closes this soon. */
const DEPARTURE_SEC = 30;

/** wss://x.livekit.cloud -> https://x.livekit.cloud (the server API is on the same host). */
export function httpBaseOf(url: string): string {
  return url.trim().replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/+$/, "");
}

export function livekit(o: { keys?: LivekitKeys | null; fetchFn?: FetchFn; now?: () => number } = {}): Livekit | null {
  const keys = o.keys !== undefined ? o.keys : livekitKeys();
  if (!keys) return null;
  const fetchFn = o.fetchFn ?? fetch;
  const now = o.now ?? Date.now;
  const base = httpBaseOf(keys.url);

  /** One Twirp call to RoomService, signed for just what it does. A room that is not there is `missing`, for the caller to decide. */
  const call = async (method: string, body: Record<string, unknown>, grant: Record<string, unknown>): Promise<"ok" | "missing"> => {
    const sec = Math.floor(now() / 1000);
    const token = signJwt({ iss: keys.key, nbf: sec - SKEW_SEC, exp: sec + 600, video: grant }, keys.secret);
    let res: Response;
    try {
      res = await fetchFn(`${base}/twirp/livekit.RoomService/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_MS),
      });
    } catch {
      throw new RoomsError(503, "The call service couldn't be reached. Try again in a minute.", "room_service");
    }
    if (res.ok) return "ok";
    if (res.status === 404) return "missing";
    if (res.status === 401 || res.status === 403) {
      throw new RoomsError(503, "The call service turned us away. Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET.", "room_service");
    }
    throw new RoomsError(503, "The call service had a problem. Try again in a minute.", "room_service");
  };

  return {
    url: keys.url,
    async ensureRoom(name, r) {
      await call("CreateRoom", { name, empty_timeout: EMPTY_SEC, departure_timeout: DEPARTURE_SEC, max_participants: r.maxPeople }, { roomCreate: true });
    },
    async deleteRoom(name) {
      await call("DeleteRoom", { room: name }, { roomCreate: true });
    },
    async removeParticipant(name, identity) {
      await call("RemoveParticipant", { room: name, identity }, { roomAdmin: true, room: name });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------ the webhook

/**
 * LiveKit's webhook, checked: the Authorization header (with or without "Bearer ") is a JWT signed with the API secret, issued by the API
 * key, and its sha256 claim is the body's own SHA-256 in base64. Any other request is not LiveKit's.
 */
export function verifyLivekit(auth: string | undefined, body: string, keys: Pick<LivekitKeys, "key" | "secret">, nowSec: number): boolean {
  const token = String(auth ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const claims = readJwt(token, keys.secret, nowSec);
  if (!claims || claims.iss !== keys.key || typeof claims.sha256 !== "string") return false;
  const digest = createHash("sha256").update(body, "utf8").digest();
  return claims.sha256 === digest.toString("base64") || claims.sha256 === digest.toString("base64url");
}

/** A webhook as LiveKit signs it, for tests and a development machine. */
export function signLivekit(body: string, keys: Pick<LivekitKeys, "key" | "secret">, nowSec: number): string {
  return signJwt({ iss: keys.key, nbf: nowSec - SKEW_SEC, exp: nowSec + 300, sha256: createHash("sha256").update(body, "utf8").digest("base64") }, keys.secret);
}

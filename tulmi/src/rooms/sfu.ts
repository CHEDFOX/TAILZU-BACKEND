/**
 * CLOUDFLARE REALTIME SFU, WHAT CARRIES OUR CALLS' VIDEO AND SOUND (src/rooms, docs/rooms.md). Plain fetch and node:crypto, no SDK.
 *
 *   sfu()                                     the server's client, or null without SFU_APP_ID and SFU_APP_SECRET
 *     .newSession()                            an empty session at the SFU; the person's own connection
 *     .publish(session, offer, tracks)         their microphone and camera, by the mids of their offer -> the answer to set
 *     .pull(session, want)                     someone else's tracks into their session -> an offer to answer (when the SFU sends one)
 *     .answer(session, sdp)                    the answer to that offer
 *     .closeTracks(session, mids)              tracks taken out again
 *
 * THE APP SECRET NEVER LEAVES THIS SERVER. A phone or a window never calls the SFU: it sends us its offer, we make the session and hand
 * back the answer (routes/bots/rooms.ts). That is the SFU's own rule — the secret is the only credential there is, and it has no scopes —
 * and it is why our rooms, the lobby and who may join stay ours to decide.
 *
 * Each person in a call has one SFU session. Their own microphone and camera are "local" tracks on it, named by us
 * (`<identity>-audio`, `<identity>-video`); everyone else's are "remote" tracks pulled into it by name. The SFU has no idea of a room:
 * which sessions belong together is ours (rooms/service.ts), which is why there is no webhook to miss.
 *
 * One session is changed one call at a time: the SFU answers 406 to a second offer while the first is unanswered, so service.ts holds a
 * lock per seat.
 */
import { getConfig } from "../config.js";
import { RoomsError } from "./types.js";

type FetchFn = typeof fetch;

export interface SfuKeys { appId: string; appSecret: string }

/** The server's own keys, or null when calls are not set up. */
export function sfuKeys(): SfuKeys | null {
  const c = getConfig();
  return c.SFU_APP_ID && c.SFU_APP_SECRET ? { appId: c.SFU_APP_ID, appSecret: c.SFU_APP_SECRET } : null;
}

/** An SDP, as the SFU sends and takes it. */
export interface Sdp { type: "offer" | "answer"; sdp: string }

/** One of a person's own tracks, by the mid of the offer they sent. */
export interface LocalTrack { mid: string; trackName: string }
/** Someone else's track, by their session and its name. */
export interface RemoteTrack { sessionId: string; trackName: string }

export interface PullAnswer {
  /** The SFU's offer, when pulling needed one; null when it did not. */
  offer: Sdp | null;
  /** The offer must be answered before anything else is asked of this session. */
  mustAnswer: boolean;
  /** Each track pulled, with the mid it arrives on. */
  tracks: Array<{ trackName: string; mid?: string; error?: string }>;
}

export interface Sfu {
  newSession(): Promise<string>;
  publish(sessionId: string, offer: Sdp, tracks: LocalTrack[]): Promise<Sdp>;
  pull(sessionId: string, want: RemoteTrack[]): Promise<PullAnswer>;
  answer(sessionId: string, sdp: string): Promise<void>;
  closeTracks(sessionId: string, mids: string[]): Promise<void>;
}

const BASE = "https://rtc.live.cloudflare.com/v1";
const CALL_MS = 10_000;
/** An SDP this big is not an SDP. */
export const SDP_MAX = 64 * 1024;

interface TrackAnswer { trackName?: unknown; mid?: unknown; error?: { errorDescription?: unknown } | null }
interface Answer {
  sessionId?: unknown;
  sessionDescription?: { type?: unknown; sdp?: unknown } | null;
  requiresImmediateRenegotiation?: unknown;
  tracks?: TrackAnswer[] | null;
  errorDescription?: unknown;
}

const sdpOf = (v: Answer["sessionDescription"]): Sdp | null =>
  v && typeof v.sdp === "string" && v.sdp.length <= SDP_MAX && (v.type === "offer" || v.type === "answer") ? { type: v.type, sdp: v.sdp } : null;

export function sfu(o: { keys?: SfuKeys | null; fetchFn?: FetchFn } = {}): Sfu | null {
  const keys = o.keys !== undefined ? o.keys : sfuKeys();
  if (!keys) return null;
  const fetchFn = o.fetchFn ?? fetch;
  const at = `${BASE}/apps/${encodeURIComponent(keys.appId)}`;

  const call = async (method: "POST" | "PUT" | "GET", path: string, body?: unknown): Promise<Answer> => {
    let res: Response;
    try {
      res = await fetchFn(`${at}${path}`, {
        method,
        headers: { authorization: `Bearer ${keys.appSecret}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(CALL_MS),
      });
    } catch {
      throw new RoomsError(503, "The call service couldn't be reached. Try again in a minute.", "room_service");
    }
    if (res.status === 401 || res.status === 403) {
      throw new RoomsError(503, "The call service turned us away. Check SFU_APP_ID and SFU_APP_SECRET.", "room_service");
    }
    // 406: another change to this session is still unanswered. The caller holds a lock per seat, so this is a lost race, not a bug.
    if (res.status === 406) throw new RoomsError(409, "The call is busy. Try again.", "room_busy");
    let json: Answer = {};
    try { json = (await res.json()) as Answer; } catch { json = {}; }
    if (!res.ok) throw new RoomsError(503, "The call service had a problem. Try again in a minute.", "room_service");
    // The SFU answers 200 with an errorDescription when it refuses the body itself.
    if (typeof json.errorDescription === "string" && json.errorDescription) {
      throw new RoomsError(502, "The call couldn't be set up. Try again.", "room_service");
    }
    return json;
  };

  return {
    async newSession() {
      const out = await call("POST", "/sessions/new");
      const id = typeof out.sessionId === "string" ? out.sessionId : "";
      if (!id) throw new RoomsError(502, "The call couldn't be set up. Try again.", "room_service");
      return id;
    },

    async publish(sessionId, offer, tracks) {
      const out = await call("POST", `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
        sessionDescription: { type: "offer", sdp: offer.sdp },
        tracks: tracks.map((t) => ({ location: "local", mid: t.mid, trackName: t.trackName })),
      });
      const answer = sdpOf(out.sessionDescription);
      if (!answer || answer.type !== "answer") throw new RoomsError(502, "The call couldn't be set up. Try again.", "room_service");
      return answer;
    },

    async pull(sessionId, want) {
      const out = await call("POST", `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
        tracks: want.map((t) => ({ location: "remote", sessionId: t.sessionId, trackName: t.trackName })),
      });
      return {
        offer: sdpOf(out.sessionDescription),
        mustAnswer: out.requiresImmediateRenegotiation === true,
        tracks: (Array.isArray(out.tracks) ? out.tracks : []).map((t) => ({
          trackName: String(t?.trackName ?? ""),
          ...(typeof t?.mid === "string" ? { mid: t.mid } : {}),
          ...(t?.error?.errorDescription ? { error: String(t.error.errorDescription).slice(0, 200) } : {}),
        })),
      };
    },

    async answer(sessionId, sdp) {
      await call("PUT", `/sessions/${encodeURIComponent(sessionId)}/renegotiate`, { sessionDescription: { type: "answer", sdp } });
    },

    async closeTracks(sessionId, mids) {
      if (!mids.length) return;
      await call("PUT", `/sessions/${encodeURIComponent(sessionId)}/tracks/close`, { tracks: mids.map((mid) => ({ mid })), force: true });
    },
  };
}

/**
 * THE REALTIME CALL'S LINK TO OPENAI (botsBots/planCallLive.ts holds the session; the spec is docs/plan-ease.md "Calls").
 *
 *   createCall({sdp, session, userId})  the SDP exchange: our server posts the phone's offer and the session it locked, with its own
 *                                      key, and gets the answer SDP and the call's id back
 *   attachSideband(callId)             the server's own socket on that call: every tool runs here, every response's cost is recorded
 *                                      here, consent is re-checked here, and the idle end and the hard length act here
 *   hangup(callId)                     ends the call, whichever way it was started
 *
 * THE PHONE NEVER HOLDS AN OPENAI CREDENTIAL, not even a short-lived one: the key is the server's, in its .env, and it is never sent
 * to a phone, never put in a reply and never logged. Nor is the SDP (it carries the phone's network addresses) or anything that was
 * said. A failure is logged by its name alone.
 *
 * `hangup` runs outside the AI permission scope (privacy/aiGate.ts asService): it carries no personal data, and it must still work
 * the moment a person takes their permission back — that is exactly when the call has to end.
 */
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { getConfig } from "../config.js";
import { asService } from "../privacy/aiGate.js";

/** The create request's own timeout: the phone is waiting with its microphone open. */
const CREATE_MS = 8_000;
/** The sideband must be up before the phone is told to connect. */
const OPEN_MS = 5_000;
const HANGUP_MS = 5_000;
/** An offer this big is not an offer. */
export const SDP_MAX = 20_000;

/** OpenAI's own "who is this, as one unchanging string" header: a hash, never the person's id. */
const safetyId = (userId: string): string => createHash("sha256").update(String(userId)).digest("hex");

export interface CreatedCall { answerSdp: string; callId: string }

/** The id of the call OpenAI made, from the Location header ("/v1/realtime/calls/rtc_…"). */
function callIdOf(location: string | null): string {
  const tail = String(location ?? "").split("/").filter(Boolean).pop() ?? "";
  return /^[A-Za-z0-9_-]{1,128}$/.test(tail) ? tail : "";
}

/**
 * The SDP exchange. The phone's offer and the session we locked go up as one multipart body; the answer SDP comes back as text and
 * the call's id in `Location`. Throws with a short name on anything else.
 */
export async function createCall(o: { sdp: string; session: Record<string, unknown>; userId: string }): Promise<CreatedCall> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) throw new Error("rt_no_key");
  const body = new FormData();
  body.append("sdp", o.sdp);
  body.append("session", JSON.stringify(o.session));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CREATE_MS);
  timer.unref?.();
  try {
    const res = await fetch(cfg.OPENAI_REALTIME_CALLS_URL, {
      method: "POST", body, signal: ac.signal,
      headers: { authorization: `Bearer ${cfg.OPENAI_API_KEY}`, "OpenAI-Safety-Identifier": safetyId(o.userId) },
    });
    if (!res.ok) throw new Error(`rt_create_${res.status}`);
    const answerSdp = await res.text();
    const callId = callIdOf(res.headers.get("location"));
    if (!answerSdp.trim() || !callId) throw new Error("rt_create_shape");
    return { answerSdp, callId };
  } finally { clearTimeout(timer); }
}

/** What the session manager needs of the socket, so a relay could take its place later without touching anything else. */
export interface RtLink {
  send(event: Record<string, unknown>): void;
  onEvent(fn: (e: Record<string, unknown>) => void): void;
  onClosed(fn: () => void): void;
  close(): void;
}

/** The server's own socket on a call that is already up. Resolves once it is open, so the phone is never told to connect too early. */
export async function attachSideband(callId: string): Promise<RtLink> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) throw new Error("rt_no_key");
  const ws = new WebSocket(`${cfg.OPENAI_REALTIME_SIDEBAND_URL}?call_id=${encodeURIComponent(callId)}`, {
    headers: { authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch { /* going */ } reject(new Error("rt_sideband_timeout")); }, OPEN_MS);
    timer.unref?.();
    ws.once("open", () => { clearTimeout(timer); resolve(); });
    ws.once("error", () => { clearTimeout(timer); reject(new Error("rt_sideband_failed")); });
  });
  const events: Array<(e: Record<string, unknown>) => void> = [];
  const closes: Array<() => void> = [];
  ws.on("message", (raw) => {
    let e: Record<string, unknown>;
    try { e = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return; }
    for (const fn of events) { try { fn(e); } catch { /* one listener's trouble is not the socket's */ } }
  });
  const closed = () => { for (const fn of closes) { try { fn(); } catch { /* as above */ } } };
  ws.on("close", closed);
  ws.on("error", () => undefined);
  return {
    send: (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)); },
    onEvent: (fn) => { events.push(fn); },
    onClosed: (fn) => { closes.push(fn); },
    close: () => { try { ws.close(); } catch { /* going */ } },
  };
}

/**
 * Ends the call at OpenAI, whether it was started over WebRTC or SIP. Runs as the service, not as the person: it sends nothing of
 * theirs, and it must work after they take their AI permission back. Never throws; the caller logs the name.
 */
export async function hangup(callId: string): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY || !callId) return false;
  return asService(async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), HANGUP_MS);
    timer.unref?.();
    try {
      const res = await fetch(`${cfg.OPENAI_REALTIME_CALLS_URL}/${encodeURIComponent(callId)}/hangup`, {
        method: "POST", signal: ac.signal, headers: { authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
      });
      return res.ok;
    } catch { return false; } finally { clearTimeout(timer); }
  });
}

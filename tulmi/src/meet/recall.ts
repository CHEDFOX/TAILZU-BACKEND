/**
 * RECALL.AI, THE MEETING BOT'S WAY INTO A CALL (docs/meet.md). One REST API sends a bot into Google Meet, Zoom, Teams or Webex as a
 * participant; its live transcript and chat come back to our webhook, and it can post in the meeting's chat and show a page of ours as its
 * camera, whose sound is its voice (Output Media).
 *
 *   recall()                    the client, or null when RECALL_API_KEY is not set
 *   botBody(input)              the Create Bot request: the meeting, the bot's name, live transcript and chat to our webhook, the chat
 *                               line it posts as it joins, how it leaves on its own, and (a bot that speaks) our stage as its camera
 *   verifyRecall(secret, ...)   a webhook from Recall, signed with the workspace verification secret (whsec_...): HMAC-SHA256 over
 *                               "<id>.<timestamp>.<raw body>" with the secret's bytes, base64, among the header's "v1,<sig>" values;
 *                               the timestamp within five minutes. Headers webhook-* (new accounts) or svix-* (older ones)
 *
 * Endpoints (https://<region>.recall.ai/api/v1, header "Authorization: Token <key>"): POST /bot/, DELETE /bot/<id>/ (a scheduled bot not
 * yet sent), POST /bot/<id>/leave_call/, POST /bot/<id>/send_chat_message/ ({ to: "everyone", message }), GET /bot/<id>/.
 * A bot asked for less than ten minutes ahead may meet a 507 (no bot free just now): it is asked again every 30 seconds, ten times.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";

export class RecallError extends Error {
  constructor(readonly status: number, message: string, readonly code = "recall") { super(message); }
}

export interface BotInput {
  meetingUrl: string;
  botName: string;
  /** ISO time; more than ten minutes ahead, Recall keeps a bot for it and it is never late. */
  joinAt?: string;
  /** Strings only (Recall's rule): which meeting of ours it is. */
  metadata: Record<string, string>;
  /** Where the live transcript, the chat and who joins or leaves are sent (routes/bots/meet.ts, with the meeting's own token). */
  liveUrl: string;
  /** A bot that speaks: our stage page as its camera, its sound the bot's voice (Output Media). */
  stageUrl?: string;
  variant?: "web" | "web_4_core";
  /** Posted in the meeting's chat as it joins: who it is, and how to ask it or send it away. */
  intro: string;
  language?: string;
}

/** The Create Bot request. A bot that speaks has no fixed picture (Output Media and automatic video cannot be used together). */
export function botBody(i: BotInput): Record<string, unknown> {
  const variant = i.variant ?? "web_4_core";
  return {
    meeting_url: i.meetingUrl,
    bot_name: i.botName.slice(0, 100),
    ...(i.joinAt ? { join_at: i.joinAt } : {}),
    metadata: i.metadata,
    recording_config: {
      transcript: { provider: { recallai_streaming: { mode: "prioritize_low_latency", language_code: i.language ?? "en" } } },
      participant_events: {},
      realtime_endpoints: [{
        type: "webhook", url: i.liveUrl,
        events: ["transcript.data", "participant_events.chat_message", "participant_events.join", "participant_events.leave"],
      }],
    },
    chat: { on_bot_join: { send_to: "everyone", message: i.intro.slice(0, 500) } },
    // Out when nobody lets it in in ten minutes, when nobody comes, a while after the last person goes, and after three hours whatever happens.
    automatic_leave: { waiting_room_timeout: 600, noone_joined_timeout: 900, everyone_left_timeout: { timeout: 30 }, in_call_recording_timeout: 3 * 3600 },
    ...(i.stageUrl ? {
      output_media: { camera: { kind: "webpage", config: { url: i.stageUrl } } },
      variant: { zoom: variant, google_meet: variant, microsoft_teams: variant },
    } : {}),
  };
}

export interface RecallBot { id: string; join_at?: string | null; status_changes?: Array<{ code: string; sub_code?: string | null; created_at: string }> }

export interface RecallClient {
  createBot(input: BotInput): Promise<RecallBot>;
  /** A scheduled bot, before it is sent; false when it already was (405), so it must be asked to leave instead. */
  deleteBot(id: string): Promise<boolean>;
  leaveCall(id: string): Promise<void>;
  sendChat(id: string, message: string): Promise<void>;
  getBot(id: string): Promise<RecallBot>;
}

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function recallClient(o: { key: string; region: string; fetchFn?: Fetch; retryMs?: number; tries?: number }): RecallClient {
  const base = `https://${o.region}.recall.ai/api/v1`;
  const f = o.fetchFn ?? fetch;
  async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: { authorization: `Token ${o.key}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new RecallError(503, "The meeting service couldn't be reached just now.", "recall_down");
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json: json as T };
  }
  const fail = (status: number, json: unknown): never => {
    const said = json && typeof json === "object" ? JSON.stringify(json).slice(0, 300) : "";
    if (status === 401 || status === 403) throw new RecallError(503, "The meeting service turned us away. Check RECALL_API_KEY.", "recall_auth");
    if (status === 400) throw new RecallError(400, /meeting_url|url/i.test(said) ? "That meeting link didn't work. Copy it again from the invite." : "The meeting service couldn't take that.", "bad_request");
    throw new RecallError(status >= 500 ? 502 : status, "The meeting service couldn't do that just now.");
  };
  return {
    async createBot(input) {
      const tries = o.tries ?? 10;
      for (let i = 0; ; i++) {
        const r = await call<RecallBot>("POST", "/bot/", botBody(input));
        if (r.status >= 200 && r.status < 300 && r.json?.id) return r.json;
        // No bot free just now (a bot asked for less than ten minutes ahead): again in 30 seconds, a few times.
        if (r.status === 507 && i + 1 < tries) { await sleep(o.retryMs ?? 30_000); continue; }
        return fail(r.status, r.json);
      }
    },
    async deleteBot(id) {
      const r = await call("DELETE", `/bot/${encodeURIComponent(id)}/`);
      if (r.status === 405) return false;
      if (r.status >= 200 && r.status < 300) return true;
      if (r.status === 404) return true;
      return fail(r.status, r.json);
    },
    async leaveCall(id) {
      const r = await call("POST", `/bot/${encodeURIComponent(id)}/leave_call/`);
      // Already out of the call (or never in it): nothing to do.
      if (r.status === 400 || (r.status >= 200 && r.status < 300)) return;
      fail(r.status, r.json);
    },
    async sendChat(id, message) {
      const r = await call("POST", `/bot/${encodeURIComponent(id)}/send_chat_message/`, { to: "everyone", message });
      if (r.status < 200 || r.status >= 300) fail(r.status, r.json);
    },
    async getBot(id) {
      const r = await call<RecallBot>("GET", `/bot/${encodeURIComponent(id)}/`);
      if (r.status < 200 || r.status >= 300 || !r.json) return fail(r.status, r.json);
      return r.json;
    },
  };
}

/** The server's: Recall with RECALL_API_KEY, else null (the meeting bot is not among the bots). */
export function recall(): RecallClient | null {
  try {
    const c = getConfig();
    return c.RECALL_API_KEY ? recallClient({ key: c.RECALL_API_KEY, region: c.RECALL_REGION }) : null;
  } catch {
    return null;
  }
}

/** Google Meet's chat takes 500 characters a message: a longer one goes in parts, at sentence ends where it can. */
export function chatParts(text: string, max = 480): string[] {
  const out: string[] = [];
  let rest = text.replace(/\s+\n/g, "\n").trim();
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf(". ", max), rest.lastIndexOf("\n", max), rest.lastIndexOf(" ", max));
    const at = cut > max / 2 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out.slice(0, 4);
}

const TOLERANCE_S = 5 * 60;

/** A webhook from Recall, signed with the workspace verification secret (Standard Webhooks). `header` reads a request header. */
export function verifyRecall(secret: string, header: (name: string) => string | undefined, rawBody: string, nowMs = Date.now()): boolean {
  if (!secret) return false;
  const id = header("webhook-id") ?? header("svix-id");
  const ts = header("webhook-timestamp") ?? header("svix-timestamp");
  const sig = header("webhook-signature") ?? header("svix-signature");
  if (!id || !ts || !sig) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > TOLERANCE_S) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"); } catch { return false; }
  if (!key.length) return false;
  const want = Buffer.from(createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64"));
  return sig.split(" ").some((part) => {
    const [v, s] = part.split(",");
    if (v !== "v1" || !s) return false;
    const got = Buffer.from(s);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** Signs a body as Recall does: for tests, and to check a secret by hand. */
export function signRecall(secret: string, id: string, ts: number, rawBody: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64")}`;
}

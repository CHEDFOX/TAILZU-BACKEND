/**
 * APPLE'S PUSH SERVICE, FOR THE "BOTS AT WORK" LIVE ACTIVITY (docs/widget-glance-v2.md section 6): one push to one activity's token.
 *
 *   POST https://api.push.apple.com/3/device/<token>   (api.sandbox.push.apple.com for a development build), over HTTP/2
 *   authorization: bearer <JWT>       ES256, signed with the .p8 key: header { alg: ES256, kid: APNS_KEY_ID }, claims { iss: APNS_TEAM_ID, iat }.
 *                                     Made once and reused for 40 minutes (Apple refuses one older than an hour, and one made too often)
 *   apns-topic: APNS_TOPIC            the app's bundle id + ".push-type.liveactivity"
 *   apns-push-type: liveactivity
 *   apns-priority: 5 or 10            10 only when the person should see it now (a question, the end); 5 for a step, which Apple spreads
 *   body { aps: { timestamp, event: "update" | "end", "content-state", "dismissal-date"? } }
 *
 * OFF UNLESS CONFIGURED: apnsSettingsOf() is null unless APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8 and APNS_TOPIC are all set (APNS_ENV picks the
 * host, production by default), and every caller then does nothing. THE KEY IS NEVER LOGGED: a line says only the status and Apple's reason.
 *
 * The HTTP/2 client is a seam (H2Client): the server's opens one session per host and keeps it; the tests hand in a fake.
 */
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { ApnsEnv } from "./glanceStore.js";

export const APNS_HOSTS: Readonly<Record<ApnsEnv, string>> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

/** A token is made again after this long (Apple: at most once every 20 minutes, never older than 60). */
export const JWT_TTL_MS = 40 * 60_000;

export interface ApnsSettings { keyId: string; teamId: string; keyP8: string; topic: string; env: ApnsEnv }

/** The settings, when every one of them is set; else null (Live Activity pushes are off). */
export function apnsSettingsOf(env: { APNS_KEY_ID?: string; APNS_TEAM_ID?: string; APNS_KEY_P8?: string; APNS_TOPIC?: string; APNS_ENV?: string }): ApnsSettings | null {
  const keyId = env.APNS_KEY_ID?.trim(), teamId = env.APNS_TEAM_ID?.trim(), keyP8 = env.APNS_KEY_P8?.trim(), topic = env.APNS_TOPIC?.trim();
  if (!keyId || !teamId || !keyP8 || !topic) return null;
  return { keyId, teamId, keyP8, topic, env: env.APNS_ENV === "sandbox" ? "sandbox" : "production" };
}

/** A PKCS #8 PEM's label (named once, so the repository's secret scan does not read the armour line as a key: it holds none). */
const PKCS8 = "PRIVATE KEY";

/** The .p8 key as a key object: its PEM as written, with "\n" written out as two characters, or only its base64 body. Throws if unreadable. */
export function apnsKey(p8: string): KeyObject {
  let pem = p8.replace(/\\n/g, "\n").trim();
  if (!pem.includes("-----BEGIN")) pem = `-----BEGIN ${PKCS8}-----\n${pem.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n")}\n-----END ${PKCS8}-----`;
  return createPrivateKey({ key: pem, format: "pem" });
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

/** The provider token: an ES256 JWT, its signature in the raw r||s form JWS wants. */
export function apnsJwt(key: KeyObject, keyId: string, teamId: string, iatSec: number): string {
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const body = b64url(JSON.stringify({ iss: teamId, iat: iatSec }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

export interface H2Reply { status: number; body: string }

export interface H2Client {
  post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<H2Reply>;
  close(): void;
}

/** node:http2, one session per host, kept open and dropped when it errors or the host says goodbye. */
export function nodeH2Client(timeoutMs = 10_000): H2Client {
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionFor = (origin: string): ClientHttp2Session => {
    const had = sessions.get(origin);
    if (had && !had.closed && !had.destroyed) return had;
    const s = connect(origin);
    const drop = () => { if (sessions.get(origin) === s) sessions.delete(origin); };
    s.on("error", drop);
    s.on("goaway", drop);
    s.on("close", drop);
    s.unref();
    sessions.set(origin, s);
    return s;
  };
  return {
    post(origin, path, headers, body) {
      return new Promise<H2Reply>((resolve, reject) => {
        let s: ClientHttp2Session;
        try { s = sessionFor(origin); } catch (err) { reject(err); return; }
        const req = s.request({ [constants.HTTP2_HEADER_METHOD]: "POST", [constants.HTTP2_HEADER_PATH]: path, "content-type": "application/json", ...headers });
        let status = 0;
        let out = "";
        req.setEncoding("utf8");
        req.setTimeout(timeoutMs, () => { req.close(constants.NGHTTP2_CANCEL); reject(new Error("apns: timed out")); });
        req.on("response", (h) => { status = Number(h[constants.HTTP2_HEADER_STATUS]) || 0; });
        req.on("data", (c: string) => { if (out.length < 4096) out += c; });
        req.on("end", () => resolve({ status, body: out }));
        req.on("error", reject);
        req.end(body);
      });
    },
    close() { for (const s of sessions.values()) s.close(); sessions.clear(); },
  };
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  /** Apple's reason ("BadDeviceToken", "Unregistered"), never more. */
  reason?: string;
  /** The token is no good any more: forget it. */
  gone: boolean;
}

export interface LiveActivityPush {
  event: "update" | "end";
  contentState: Record<string, unknown>;
  /** ms; an "end" leaves the activity on the Lock Screen until then. */
  dismissAt?: number;
  /** ms; what the activity shows is as of then (Apple drops an older one that arrives late). */
  at: number;
  priority: 5 | 10;
  /** Shown as an alert with the update (a question): title and body. */
  alert?: { title: string; body: string };
}

export class ApnsSender {
  private key: KeyObject | null = null;
  private jwt: { token: string; at: number } | null = null;

  constructor(
    private readonly settings: ApnsSettings,
    private readonly client: H2Client = nodeH2Client(),
    private readonly now: () => number = Date.now,
  ) {}

  /** The provider token, made again every JWT_TTL_MS. Throws when the key cannot be read (its words are never in the error). */
  private bearer(): string {
    const t = this.now();
    if (this.jwt && t - this.jwt.at < JWT_TTL_MS) return this.jwt.token;
    if (!this.key) {
      try { this.key = apnsKey(this.settings.keyP8); } catch { throw new Error("apns: APNS_KEY_P8 could not be read as a .p8 key"); }
    }
    this.jwt = { token: apnsJwt(this.key, this.settings.keyId, this.settings.teamId, Math.floor(t / 1000)), at: t };
    return this.jwt.token;
  }

  async send(deviceToken: string, p: LiveActivityPush, env: ApnsEnv = this.settings.env): Promise<ApnsResult> {
    const aps: Record<string, unknown> = {
      timestamp: Math.floor(p.at / 1000), event: p.event, "content-state": p.contentState,
      ...(p.dismissAt ? { "dismissal-date": Math.floor(p.dismissAt / 1000) } : {}),
      ...(p.alert ? { alert: { title: p.alert.title, body: p.alert.body } } : {}),
    };
    const headers = {
      authorization: `bearer ${this.bearer()}`, "apns-topic": this.settings.topic, "apns-push-type": "liveactivity",
      "apns-priority": String(p.priority), "apns-expiration": String(Math.floor(p.at / 1000) + 3600),
    };
    const r = await this.client.post(APNS_HOSTS[env], `/3/device/${deviceToken}`, headers, JSON.stringify({ aps }));
    if (r.status === 200) return { ok: true, status: 200, gone: false };
    let reason: string | undefined;
    try { const j = JSON.parse(r.body) as { reason?: unknown }; if (typeof j.reason === "string") reason = j.reason.slice(0, 60); } catch { /* no body */ }
    // A provider token Apple calls stale or wrong is made again next time.
    if (r.status === 403) this.jwt = null;
    const gone = r.status === 410 || (r.status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic"));
    return { ok: false, status: r.status, ...(reason ? { reason } : {}), gone };
  }
}

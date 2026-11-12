// Telling X0 Bot's server that mail needs a person, so it can push to the business's owner: a message that needs a person's answer, an
// urgent draft, or the AI paused because the business's allowance is spent. Signed with MAIL_WORKER_SECRET the same way X0 Bot signs its
// calls here (security.ts), to MAIL_NOTIFY_URL (docker-compose points it at the backend). It carries no words of the mail: the business,
// the run and how it was sorted. It never throws and never waits long: a missed notice is not a lost message, which waits on the page.
import crypto from "node:crypto";
import { config } from "./config.ts";
import { sign } from "./security.ts";

export type Notice = {
  owner: string;
  business: string;
  name: string;
  status: "needs_person" | "drafted" | "paused";
  run?: number;
  kind?: string | null;
  priority?: string | null;
};

type FetchFn = (url: string, init: { method: string; body: Buffer; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean }>;
let fetchFn: FetchFn = (url, init) => fetch(url, { ...init, body: new Uint8Array(init.body) });
/** Tests send the notices to themselves. */
export function useNoticeFetch(f: FetchFn): void { fetchFn = f; }

/** The last "paused" notice per business: one in twelve hours is enough while the allowance stays spent. */
const pausedAt = new Map<string, number>();
const PAUSED_EVERY_MS = 12 * 3_600_000;

export async function notice(n: Notice, nowMs = Date.now()): Promise<boolean> {
  if (!config.noticeUrl || config.workerSecret.length < 32) return false;
  if (n.status === "paused") {
    if (nowMs - (pausedAt.get(n.business) ?? 0) < PAUSED_EVERY_MS) return false;
    pausedAt.set(n.business, nowMs);
  }
  try {
    const u = new URL(config.noticeUrl);
    const body = Buffer.from(JSON.stringify(n));
    const timestamp = Math.floor(nowMs / 1000);
    const nonce = crypto.randomBytes(16).toString("hex");
    const signature = sign(config.workerSecret, { timestamp, nonce, method: "POST", pathWithQuery: `${u.pathname}${u.search}`, body });
    const r = await fetchFn(u.toString(), {
      method: "POST", body, signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json", "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": signature },
    });
    return r.ok;
  } catch {
    return false;
  }
}

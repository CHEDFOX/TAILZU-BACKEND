/**
 * TICKETS: SHORT-LIVED, SIGNED PASSES FOR A WEBSOCKET TO THE JOBS WORKER.
 *
 * A WebSocket cannot carry the person's session the way a request to the VPS does (the Worker has no Supabase session to check
 * it against, and must not need one). So whoever knows who the person is hands out a TICKET, and the Worker only checks the ticket:
 *
 *   device   the desktop app's presence connection. The VPS issues it to a signed-in person for one device id
 *            (POST /v1/code/runner/ticket). Claims: user, device
 *   viewer   the app watching one job. The VPS issues it to the job's OWNER (POST /v1/code/jobs/:id/live). Claims: user, job
 *   runner   a runner's connection to a job's room. The Worker issues it (a session step is placed, jobs/src/live.ts) and hands it
 *            to the runner with the step: in `.tailzu/step.json` on GitHub's computer, in the offer a PC is sent. Claims: job, the
 *            step and the lease epoch it was made for. ONE-TIME: the room remembers the nonce it saw
 *
 * A ticket is `t1.<claims, base64url JSON>.<hex HMAC-SHA256>`. The MAC is over a label and the claims, with the shared
 * CODE_JOBS_SECRET, so it cannot be mistaken for the signature of a call between the VPS and the Worker (sign.ts signs a different
 * string), and a ticket of one kind is refused where another is wanted. It carries its own expiry. Nothing here logs a ticket,
 * puts one in an error, or reads a clock except the `now` it is given.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TicketKind = "device" | "viewer" | "runner";

export interface TicketClaims {
  /** Kind. */
  k: TicketKind;
  /** The person (device, viewer). */
  u?: string;
  /** The device the app made (device). */
  d?: string;
  /** The job (viewer, runner). */
  j?: string;
  /** The step and the lease epoch it was dispatched under (runner). */
  s?: number;
  e?: number;
  /** Expires, epoch ms. */
  x: number;
  /** Used once (runner), and a label for the log. */
  n: string;
}

export type TicketFailure = "malformed" | "bad_signature" | "expired" | "wrong_kind";
export type TicketRead = { ok: true; claims: TicketClaims } | { ok: false; reason: TicketFailure };

const PREFIX = "t1.";
const LABEL = "tailzu-live-ticket-v1\n";
/** A ticket is a few hundred characters; anything near this is not one. */
const TICKET_MAX = 2048;

const mac = (secret: string, body: string): Buffer => createHmac("sha256", secret).update(LABEL).update(body).digest();

export interface SignTicket {
  secret: string;
  kind: TicketKind;
  user?: string;
  device?: string;
  job?: string;
  step?: number;
  epoch?: number;
  /** How long it is good for. */
  ttlMs: number;
  now?: number;
  nonce?: string;
}

export function signTicket(o: SignTicket): { ticket: string; claims: TicketClaims } {
  const now = o.now ?? Date.now();
  const claims: TicketClaims = {
    k: o.kind, x: now + Math.max(1_000, Math.floor(o.ttlMs)), n: o.nonce ?? randomBytes(12).toString("base64url"),
    ...(o.user !== undefined ? { u: o.user } : {}), ...(o.device !== undefined ? { d: o.device } : {}), ...(o.job !== undefined ? { j: o.job } : {}),
    ...(o.step !== undefined ? { s: o.step } : {}), ...(o.epoch !== undefined ? { e: o.epoch } : {}),
  };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return { ticket: `${PREFIX}${body}.${mac(o.secret, body).toString("hex")}`, claims };
}

/** The claims of a ticket, once it is the right kind, signed with `secret`, and not expired. */
export function readTicket(secret: string, ticket: unknown, kind: TicketKind, now = Date.now()): TicketRead {
  if (typeof ticket !== "string" || !ticket.startsWith(PREFIX) || ticket.length > TICKET_MAX) return { ok: false, reason: "malformed" };
  const rest = ticket.slice(PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const body = rest.slice(0, dot);
  const given = rest.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[0-9a-f]{64}$/.test(given)) return { ok: false, reason: "malformed" };
  const want = mac(secret, body);
  const got = Buffer.from(given, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad_signature" };
  let claims: TicketClaims;
  try { claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TicketClaims; } catch { return { ok: false, reason: "malformed" }; }
  if (!claims || typeof claims !== "object" || typeof claims.x !== "number" || typeof claims.n !== "string" || typeof claims.k !== "string") return { ok: false, reason: "malformed" };
  if (claims.k !== kind) return { ok: false, reason: "wrong_kind" };
  if (now > claims.x) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

/** The ticket from a WebSocket request: `Authorization: Bearer <ticket>`, or `?ticket=` (a browser cannot set a header on a WebSocket). */
export function ticketOf(req: { headers: { get(name: string): string | null }; url: string }, param = "ticket"): string | null {
  const auth = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (auth) return auth;
  try { return new URL(req.url).searchParams.get(param); } catch { return null; }
}

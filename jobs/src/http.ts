/**
 * THE WORKER'S DOOR: THREE SIGNED POSTS FROM THE VPS, AND A HEALTH CHECK.
 *
 *   POST /v1/start   { jobId }                               make the job's Workflow (id = jobId); one that exists is fine
 *   POST /v1/event   { jobId, kind }                         the person's word or a runner's result: wake the job's Workflow
 *   POST /v1/brain   { userId, projectId, mode, headSha }    make the brain build's Workflow (id = brain-<projectId>-<headSha>)
 *   POST /v1/message { jobId, text }                         the person's word to a working job: kept in its room, its Workflow woken
 *   GET  /v1/health                                          { ok: true }, no secret, no state: "is the Worker there"
 *
 * and three WebSockets (docs/desktop-runner-session.md), each opened with a TICKET instead of a signature (tulmi/src/code/live/tickets.ts):
 *
 *   GET  /v1/devices/connect            a PC's presence. Ticket kind "device" from the VPS, once: its person and device are sent to the person's UserDevices
 *   GET  /v1/rooms/:jobId/runner        a runner's session with a job's room. Ticket kind "runner", made for this job (a ticket for another job is refused here)
 *                                       and one step and lease epoch (the room checks those and that it is used once)
 *   GET  /v1/rooms/:jobId/watch         the app watching a job. Ticket kind "viewer" from the VPS to the job's owner, once
 *
 * Every POST is checked first and nothing is done for one that fails: the three headers must be there, the timestamp within five
 * minutes, the HMAC-SHA256 right (compared in constant time) and the nonce new (the Durable Object remembers them for ten
 * minutes). The signature covers method, path, timestamp, nonce and the exact body, so nothing can be changed in transit, and a
 * recorded request cannot be sent twice. Then the body is checked for shape: the ids are what they say they are.
 *
 * Answers carry a short `code` and never a value from the request or the environment. A body over 16 KB is refused unread.
 */
import {
  BRAIN_PATH, EVENT_PATH, MESSAGE_PATH, START_PATH, WAKE_KINDS, isSha, isUuid, type BrainBody, type EventBody, type MessageBody, type StartBody,
} from "../../tulmi/src/code/jobs/handoff/protocol.js";
import { SAID_MAX_CHARS } from "../../tulmi/src/code/live/limits.js";
import { readTicket, ticketOf, type TicketKind } from "../../tulmi/src/code/live/tickets.js";
import { verifyRequest, type NonceStore } from "../../tulmi/src/code/jobs/handoff/sign.js";
import { applyEnv, type Env } from "./env.js";
import { durableNonces } from "./nonceGuard.js";
import { roomOf } from "./rooms.js";
import { startAgentJob, startBrainBuild, wakeAgentJob } from "./workflows.js";

const BODY_MAX = 16 * 1024;

const json = (status: number, body: object): Response => Response.json(body, { status });
const fail = (status: number, code: string, message: string): Response => json(status, { ok: false, code, message });

export interface HttpDeps {
  nonces?: NonceStore;
  now?: () => number;
}

const DEVICES_PATH = "/v1/devices/connect";
const ROOM_PATH = /^\/v1\/rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(runner|watch)$/i;

export async function handleRequest(req: Request, env: Env, d: HttpDeps = {}): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/v1/health") return json(200, { ok: true });
  if (url.pathname === DEVICES_PATH || ROOM_PATH.test(url.pathname)) return handleSocket(req, env, url, d);
  if (url.pathname !== START_PATH && url.pathname !== EVENT_PATH && url.pathname !== BRAIN_PATH && url.pathname !== MESSAGE_PATH) return fail(404, "not_found", "No such route.");
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");

  applyEnv(env);
  const secret = env.CODE_JOBS_SECRET;
  if (!secret) return fail(503, "not_configured", "The Worker has no CODE_JOBS_SECRET.");
  if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return fail(413, "too_large", "That body is too big.");
  const raw = await req.text();
  if (raw.length > BODY_MAX) return fail(413, "too_large", "That body is too big.");

  const verdict = await verifyRequest({
    secret, method: "POST", path: url.pathname, body: raw, header: (n) => req.headers.get(n),
    nonces: d.nonces ?? durableNonces(env.NONCES), ...(d.now ? { now: d.now() } : {}),
  });
  if (!verdict.ok) return fail(401, verdict.reason, "That call is not signed for this Worker.");

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail(400, "bad_request", "The body is not JSON."); }
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

  if (url.pathname === START_PATH) {
    const { jobId } = b as Partial<StartBody>;
    if (!isUuid(jobId)) return fail(400, "bad_request", "jobId is the id of a job.");
    const started = await startAgentJob(env, jobId);
    return json(200, { ok: true, created: started.created, status: started.status });
  }

  if (url.pathname === EVENT_PATH) {
    const { jobId, kind } = b as Partial<EventBody>;
    if (!isUuid(jobId) || typeof kind !== "string" || !(WAKE_KINDS as readonly string[]).includes(kind)) return fail(400, "bad_request", "jobId and kind are needed.");
    const woken = await wakeAgentJob(env, jobId, kind as EventBody["kind"]);
    if (woken.status === null) return fail(404, "no_instance", "That job has no Workflow.");
    return json(200, { ok: true, delivered: woken.delivered, status: woken.status });
  }

  if (url.pathname === MESSAGE_PATH) {
    const { jobId, text } = b as Partial<MessageBody>;
    if (!isUuid(jobId) || typeof text !== "string" || !text.trim() || text.length > SAID_MAX_CHARS) return fail(400, "bad_request", "jobId and text are needed.");
    const said = await roomOf(env, jobId).message(text, jobId);
    return said.ok ? json(200, { ok: true }) : fail(400, "bad_request", said.why);
  }

  const { userId, projectId, mode, headSha } = b as Partial<BrainBody>;
  if (typeof userId !== "string" || !userId || userId.length > 100 || !isUuid(projectId) || !isSha(headSha) || (mode !== "full" && mode !== "incremental")) {
    return fail(400, "bad_request", "userId, projectId, mode and headSha are needed.");
  }
  const started = await startBrainBuild(env, { userId, projectId, mode, headSha });
  return json(200, { ok: true, created: started.created, status: started.status });
}

/**
 * A WebSocket to a Durable Object, once its ticket has been checked. The ticket is read, in this order: it is there, it is the right kind, it is
 * signed with our secret, it has not expired, it is for THIS job (a room's tickets), and (a device's and a viewer's) it has not been used. What
 * the Durable Object is told about it travels in headers only this Worker can set, and the person's own `Authorization` is not passed on.
 */
async function handleSocket(req: Request, env: Env, url: URL, d: HttpDeps): Promise<Response> {
  if (req.method !== "GET") return fail(405, "method_not_allowed", "GET only.");
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return fail(426, "upgrade_required", "This is a WebSocket.");
  applyEnv(env);
  const secret = env.CODE_JOBS_SECRET;
  if (!secret) return fail(503, "not_configured", "The Worker has no CODE_JOBS_SECRET.");

  const room = ROOM_PATH.exec(url.pathname);
  const kind: TicketKind = room ? (room[2]!.toLowerCase() === "runner" ? "runner" : "viewer") : "device";
  const read = readTicket(secret, ticketOf(req), kind, d.now?.());
  if (!read.ok) return fail(401, read.reason === "expired" ? "expired" : read.reason === "wrong_kind" ? "wrong_kind" : "bad_ticket", "That ticket is not valid.");
  const c = read.claims;

  const nonces = d.nonces ?? durableNonces(env.NONCES);
  const headers = new Headers(req.headers);
  headers.delete("authorization");
  for (const h of [...headers.keys()]) if (h.toLowerCase().startsWith("x-room-") || h.toLowerCase().startsWith("x-device-") || h.toLowerCase() === "x-user-id") headers.delete(h);

  if (kind === "device") {
    if (!c.u || !c.d) return fail(401, "bad_ticket", "That ticket is not valid.");
    if (!(await nonces.claim(`t:${c.n}`, c.x + 60_000))) return fail(401, "replayed", "That ticket has been used.");
    headers.set("x-device-id", c.d);
    headers.set("x-user-id", c.u);
    return env.USER_DEVICES.get(env.USER_DEVICES.idFromName(c.u)).fetch(new Request("https://devices.internal/connect", { method: "GET", headers }));
  }

  const jobId = room![1]!.toLowerCase();
  // A ticket is for one job. Its path is another: that is a ticket for the wrong place.
  if (c.j?.toLowerCase() !== jobId) return fail(401, "wrong_job", "That ticket is for another job.");
  if (kind === "viewer") {
    if (!c.u) return fail(401, "bad_ticket", "That ticket is not valid.");
    if (!(await nonces.claim(`t:${c.n}`, c.x + 60_000))) return fail(401, "replayed", "That ticket has been used.");
    headers.set("x-room-user", c.u);
  } else {
    if (typeof c.s !== "number" || typeof c.e !== "number") return fail(401, "bad_ticket", "That ticket is not valid.");
    headers.set("x-room-step", String(c.s));
    headers.set("x-room-epoch", String(c.e));
    headers.set("x-room-nonce", c.n);
    headers.set("x-room-exp", String(c.x));
  }
  headers.set("x-room-job", jobId);
  return roomOf(env, jobId).fetch(new Request(`https://room.internal/${kind === "runner" ? "runner" : "watch"}`, { method: "GET", headers }));
}

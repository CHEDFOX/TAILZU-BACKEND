/**
 * THE WORKER'S DOOR: THREE SIGNED POSTS FROM THE VPS, AND A HEALTH CHECK.
 *
 *   POST /v1/start   { jobId }                               make the job's Workflow (id = jobId); one that exists is fine
 *   POST /v1/event   { jobId, kind }                         the person's word or a runner's result: wake the job's Workflow
 *   POST /v1/brain   { userId, projectId, mode, headSha }    make the brain build's Workflow (id = brain-<projectId>-<headSha>)
 *   GET  /v1/health                                          { ok: true }, no secret, no state: "is the Worker there"
 *
 * Every POST is checked first and nothing is done for one that fails: the three headers must be there, the timestamp within five
 * minutes, the HMAC-SHA256 right (compared in constant time) and the nonce new (the Durable Object remembers them for ten
 * minutes). The signature covers method, path, timestamp, nonce and the exact body, so nothing can be changed in transit, and a
 * recorded request cannot be sent twice. Then the body is checked for shape: the ids are what they say they are.
 *
 * Answers carry a short `code` and never a value from the request or the environment. A body over 16 KB is refused unread.
 */
import {
  BRAIN_PATH, EVENT_PATH, START_PATH, WAKE_KINDS, isSha, isUuid, type BrainBody, type EventBody, type StartBody,
} from "../../tulmi/src/code/jobs/handoff/protocol.js";
import { verifyRequest, type NonceStore } from "../../tulmi/src/code/jobs/handoff/sign.js";
import { applyEnv, type Env } from "./env.js";
import { durableNonces } from "./nonceGuard.js";
import { startAgentJob, startBrainBuild, wakeAgentJob } from "./workflows.js";

const BODY_MAX = 16 * 1024;

const json = (status: number, body: object): Response => Response.json(body, { status });
const fail = (status: number, code: string, message: string): Response => json(status, { ok: false, code, message });

export interface HttpDeps {
  nonces?: NonceStore;
  now?: () => number;
}

export async function handleRequest(req: Request, env: Env, d: HttpDeps = {}): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/v1/health") return json(200, { ok: true });
  if (url.pathname !== START_PATH && url.pathname !== EVENT_PATH && url.pathname !== BRAIN_PATH) return fail(404, "not_found", "No such route.");
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

  const { userId, projectId, mode, headSha } = b as Partial<BrainBody>;
  if (typeof userId !== "string" || !userId || userId.length > 100 || !isUuid(projectId) || !isSha(headSha) || (mode !== "full" && mode !== "incremental")) {
    return fail(400, "bad_request", "userId, projectId, mode and headSha are needed.");
  }
  const started = await startBrainBuild(env, { userId, projectId, mode, headSha });
  return json(200, { ok: true, created: started.created, status: started.status });
}

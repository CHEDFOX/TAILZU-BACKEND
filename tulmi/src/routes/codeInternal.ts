/**
 * THE ONE ROUTE THE JOBS WORKER CALLS ON THE VPS: TELL A JOB'S OWNER SOMETHING.
 *
 *   POST /v1/internal/code/notify { jobId, kind, text, at?, to?, estimatePaise? }   -> { ok: true }
 *
 * When jobs run on Cloudflare (CODE_JOBS_MODE=cloudflare, docs/cloudflare-jobs.md) the Worker has no push
 * credentials, and must not: they stay here. So when a job needs the person, finishes or fails, the Worker
 * posts this, signed with CODE_JOBS_SECRET exactly as the VPS signs its calls to the Worker (code/jobs/handoff/
 * sign.ts: HMAC-SHA256 over method, path, timestamp, nonce and body; five minutes; a nonce used once), and
 * this route hands it to the push engine (push/index.ts notifyCodeJob), the same function the router and the
 * agent call in local mode.
 *
 * WHO IS TOLD IS DECIDED HERE, FROM THE DATABASE. The body names a job, never a person: the push goes to the
 * user the job belongs to. A job id that does not exist is 404; one that is not an agent's job is refused
 * (403), because only a Workflow ever has a reason to ask. `kind` is one of the eight the router knows and
 * `text` is cut to 300 characters; nothing else in the body is taken. The route is closed (404 `not_found`,
 * as if it were not there) unless CODE_JOBS_MODE=cloudflare and a secret is set.
 *
 * The signature is checked on the exact bytes that were sent: a preParsing hook on this route keeps the text, whatever JSON parser
 * the server has, and hands it to that parser unchanged.
 */
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import { brief, type Notify, type NotifyKind } from "../code/jobs/types.js";
import { MemoryNonceStore, verifyRequest, type NonceStore } from "../code/jobs/handoff/sign.js";
import { NOTIFY_KINDS, NOTIFY_PATH, isUuid, type NotifyBody } from "../code/jobs/handoff/protocol.js";
import type { JobStore } from "../code/jobs/store.js";

export interface CodeInternalRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** CODE_JOBS_SECRET, or null/absent when jobs run here: the route then does not exist. */
  secret: string | null | undefined;
  store: Pick<JobStore, "getJobById">;
  /** The push engine's notifyCodeJob. */
  notify: Notify;
  nonces?: NonceStore;
  now?: () => number;
}

const MOVED_TO = new Set(["desktop", "github", "paid", "none"]);
/** A body over this is refused unread. */
const BODY_MAX = 16 * 1024;

export function registerCodeInternalRoutes(app: FastifyInstance, deps: CodeInternalRoutesDeps): void {
  const nonces = deps.nonces ?? new MemoryNonceStore(deps.now);
  const now = () => (deps.now ?? Date.now)();
  const deny = (reply: FastifyReply, code: number, c: string, message: string) => reply.code(code).send({ code: c, message });

  app.post<{ Body: unknown }>(NOTIFY_PATH, {
    config: deps.rateLimit,
    // The signature covers the exact bytes that were sent, and the server's JSON parser hands on the parsed value: so the text is kept here,
    // on this route alone, and given back to the parser untouched.
    preParsing: async (req, _reply, payload) => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of payload) {
        size += (chunk as Buffer).length;
        if (size > BODY_MAX) throw Object.assign(new Error("body too large"), { statusCode: 413 });
        chunks.push(chunk as Buffer);
      }
      const text = Buffer.concat(chunks).toString("utf8");
      (req as unknown as { rawBody?: string }).rawBody = text;
      return Readable.from([Buffer.from(text, "utf8")]);
    },
  }, async (req, reply) => {
    if (!deps.secret) return deny(reply, 404, "not_found", "No such route.");
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
    const verdict = await verifyRequest({
      secret: deps.secret, method: "POST", path: NOTIFY_PATH, body: raw, header: (n) => req.headers[n] as string | undefined, nonces, now: now(),
    });
    if (!verdict.ok) return deny(reply, 401, verdict.reason === "replayed" ? "replayed" : verdict.reason === "expired" ? "expired" : "bad_signature", "That call is not signed for this server.");

    let b: Partial<NotifyBody> | null = null;
    try { b = JSON.parse(raw) as Partial<NotifyBody>; } catch { /* answered below */ }
    if (!b || typeof b !== "object" || !isUuid(b.jobId) || typeof b.kind !== "string" || !NOTIFY_KINDS.includes(b.kind as NotifyKind)) {
      return deny(reply, 400, "bad_request", "jobId and kind are needed.");
    }
    const job = await deps.store.getJobById(b.jobId);
    if (!job) return deny(reply, 404, "not_found", "No such job.");
    if (!job.agent) return deny(reply, 403, "not_an_agent_job", "That job is not run by the jobs Worker.");

    const at = typeof b.at === "number" && Number.isFinite(b.at) && Math.abs(b.at - now()) < 24 * 60 * 60_000 ? Math.floor(b.at) : now();
    const text = typeof b.text === "string" ? brief(b.text, 300) : "";
    await deps.notify(job.userId, b.kind as NotifyKind, {
      jobId: job.id, projectId: job.projectId, task: brief(job.task), at, reason: text,
      ...(typeof b.estimatePaise === "number" && Number.isInteger(b.estimatePaise) && b.estimatePaise >= 0 && b.estimatePaise <= 1_000_000 ? { estimatePaise: b.estimatePaise } : {}),
      ...(typeof b.to === "string" && MOVED_TO.has(b.to) ? { to: b.to as NotifyBody["to"] } : {}),
    });
    return reply.send({ ok: true });
  });
}

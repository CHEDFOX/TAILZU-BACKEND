/**
 * THE CODE BOT'S JOBS AND THE RUNNER PROTOCOL, OVER HTTP.
 *
 * A job is one coding task on one work branch; its steps that need a computer
 * are placed by the environment router (code/jobs/router.ts, docs/code-router.md):
 * the person's own PC first, then GitHub's free computers, then paid compute
 * under their own rule, and otherwise the job waits and says so.
 *
 * The jobs (the agent's brain will call the router directly; these are the thin
 * routes the app uses to see and steer them):
 *
 *   POST   /v1/code/jobs { projectId, branch, task, budgetPaise? }
 *                                          -> { job }  on a branch Tailzu made in the person's project (404 otherwise)
 *   GET    /v1/code/jobs                   -> { jobs }  newest first
 *   GET    /v1/code/jobs/:id               -> { job, steps }  the steps with where they ran, how they ended and the last 8 KB they printed
 *   POST   /v1/code/jobs/:id/cancel        -> { job }  nothing more is dispatched; a late result from the step that was out is refused
 *   POST   /v1/code/jobs/:id/compute-ok { maxPaise? }
 *                                          -> { job }  yes to paid compute for this job, after a compute_ask (409 not_waiting otherwise,
 *                                             409 paid_off if the rule is "never"). maxPaise is how much more it may spend
 *   POST   /v1/code/jobs/:id/commit-ok { approvalId? }
 *                                          -> a QUESTION, then { committed, sha, job }  yes to committing what a step produced, after a
 *                                             commit_ask: the same two steps as every other question (see routes/code.ts), or
 *                                             { rerun, job } if the changes were lost to a restart and the step runs again
 *   GET    /v1/code/settings/compute       -> { settings: { paidRule, autoCapPaise, githubEnabled }, githubFreeMinutes: { allowance,
 *                                             headroomPercent, used, left }, usage: { month, githubMinutes, paidPaise }, providers }
 *   PUT    /v1/code/settings/compute { paidRule?, autoCapPaise?, githubEnabled? }
 *                                          -> the same, after the change. paidRule is "never" (the default), "ask" or "auto" (up to
 *                                             autoCapPaise a calendar month)
 *
 * The runner protocol, for the Tailzu desktop app (its side comes later). All of it is authenticated as the
 * person, like the rest of /v1; the app names itself with a device id it made, in the body or the address:
 *
 *   POST   /v1/code/runner/heartbeat { deviceId, name, allowRun, projects: [projectId] | "all", busy }
 *                                          -> { ok, onlineForSec: 60, leasesRenewed }  marks the PC online for 60 seconds. Send one about
 *                                             every 30. A PC that says it is busy keeps the lease on the step it is running
 *   GET    /v1/code/runner/next?deviceId=&wait=
 *                                          -> { jobId, stepIdx, epoch, commands, timeoutSec, repo: { kind, cloneUrl, branch, headSha,
 *                                             readToken?, readTokenExpiresAt?, tarballUrl? } }  or 204 when there is nothing. It waits up to
 *                                             25 seconds for a step (`wait` is seconds, 0 to answer at once). repo is the existing
 *                                             read-only runner access (code/projects.ts runnerAccess): a token that can read one repo and
 *                                             nothing else, or for a sign-in project a one-time download link. A PC is never given a token
 *                                             that can write. 409 unknown_device if it hasn't sent a heartbeat in the last minute
 *   POST   /v1/code/runner/progress { jobId, epoch }
 *                                          -> { ok, leaseExpiresAt }  keeps the lease. 409 stale_lease: the step was given to another
 *                                             computer or the job stopped; drop it
 *   POST   /v1/code/runner/result { jobId, stepIdx, epoch, exitCode, outputTail, minutes, changes?: [{ path, content | null }] }
 *                                          -> { ok, state, committed, sha?, waitingForYou?, refused?, changesIgnored?, duplicate? }
 *                                             409 stale_lease for an epoch that isn't the job's current one: nothing is counted. The changes
 *                                             are committed by the SERVER, through the same policy as any commit, as a run nobody is
 *                                             watching: where the policy would ask, the job waits for the person (waitingForYou) instead.
 *                                             Changes from a step that did not exit 0 are not committed. A result is at most 4 MB
 *
 * With CODE_GITHUB off every route answers 404 { code: "code_off" }; on, but with no GitHub set up, 503 { code: "not_configured" };
 * both before the session. Another person's job is 404, as a project is.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import type { Code } from "../code/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import { startJobTicker } from "../code/jobs/ticker.js";
import { LONG_POLL_MS, TICK_MS } from "../code/jobs/types.js";
import { failCode } from "./code.js";

export interface CodeJobRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when CODE_GITHUB is off. */
  code: Code | null;
  /** Null when the Code bot has no GitHub client to run jobs with. */
  jobs: JobRouter | null;
  /** How often the ticker looks; null: it does not run. Default every 15 seconds (jobs/types.ts TICK_MS). */
  tickEveryMs?: number | null;
  /** How long `next` holds a PC waiting for a step. Default 25 seconds. */
  pollMs?: number;
}

/** A result carries files, so it may be larger than the server's usual 1 MB. */
const RESULT_BODY_LIMIT = 4 * 1024 * 1024;

export function registerCodeJobRoutes(app: FastifyInstance, deps: CodeJobRoutesDeps): void {
  const RL = { config: deps.rateLimit };
  const { code, jobs } = deps;
  const poll = deps.pollMs ?? LONG_POLL_MS;

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "code_off", message: "The Code bot is not switched on." });
  const notConfigured = (reply: FastifyReply) => reply.code(503).send({ code: "not_configured", message: "GitHub isn't set up on this server yet." });
  const noSession = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  const fail = failCode;

  /** The router, then the session. Null once the answer has been sent. */
  const begin = async (authorization: string | undefined, reply: FastifyReply) => {
    if (!code) { off(reply); return null; }
    if (!jobs) { notConfigured(reply); return null; }
    const user = await resolveUser(authorization);
    if (!user) { noSession(reply); return null; }
    return { jobs, user };
  };

  // Leases that ran out and jobs waiting for a place, every 15 seconds once the server is ready, like the stuck-task sweeper.
  const tickEvery = deps.tickEveryMs === undefined ? TICK_MS : deps.tickEveryMs;
  if (jobs && tickEvery !== null) {
    let stop: (() => void) | undefined;
    app.addHook("onReady", async () => { stop = startJobTicker({ jobs, everyMs: tickEvery, log: app.log }); });
    app.addHook("onClose", async () => { stop?.(); });
  }

  const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
  const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);

  // --- the jobs

  app.post<{ Body: unknown }>("/v1/code/jobs", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const projectId = text(b.projectId, 64), branch = text(b.branch, 255), task = text(b.task, 20_000);
    if (!projectId || !branch || task === undefined) {
      return reply.code(400).send({ code: "bad_request", message: "projectId, branch and task are needed." });
    }
    if (b.budgetPaise !== undefined && typeof b.budgetPaise !== "number") {
      return reply.code(400).send({ code: "bad_request", message: "budgetPaise is a whole number of paise." });
    }
    try {
      return reply.send({ job: await s.jobs.createJob(s.user.id, projectId, branch, task, (b.budgetPaise as number | undefined) ?? 0) });
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/code/jobs", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send({ jobs: await s.jobs.listJobs(s.user.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/code/jobs/:id", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await s.jobs.jobWithSteps(s.user.id, req.params.id));
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/code/jobs/:id/cancel", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const job = await s.jobs.job(s.user.id, req.params.id);
      return reply.send({ job: await s.jobs.cancelJob(job.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/code/jobs/:id/compute-ok", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    const maxPaise = bodyOf(req.body).maxPaise;
    try {
      return reply.send({ job: await s.jobs.approvePaid(s.user.id, req.params.id, maxPaise as number | undefined) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown; Querystring: { approvalId?: unknown } }>("/v1/code/jobs/:id/commit-ok", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const id = b.approvalId !== undefined ? b.approvalId : req.query?.approvalId;
    if (id !== undefined && (typeof id !== "string" || !id || id.length > 200)) {
      return reply.code(400).send({ code: "bad_request", message: "approvalId is the id the question gave." });
    }
    try {
      return reply.send(await s.jobs.approveCommit(s.user.id, req.params.id, id as string | undefined));
    } catch (err) { return fail(reply, err); }
  });

  // --- the person's compute settings

  app.get("/v1/code/settings/compute", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await s.jobs.settingsView(s.user.id));
    } catch (err) { return fail(reply, err); }
  });

  app.put<{ Body: unknown }>("/v1/code/settings/compute", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      await s.jobs.saveSettings(s.user.id, req.body);
      return reply.send(await s.jobs.settingsView(s.user.id));
    } catch (err) { return fail(reply, err); }
  });

  // --- the runner protocol

  app.post<{ Body: unknown }>("/v1/code/runner/heartbeat", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await s.jobs.heartbeat(s.user.id, req.body));
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Querystring: { deviceId?: unknown; wait?: unknown } }>("/v1/code/runner/next", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    const { deviceId, wait } = req.query ?? {};
    if (typeof deviceId !== "string") return reply.code(400).send({ code: "bad_request", message: "deviceId is the id your app made for this computer." });
    // `wait` is seconds, 0 to answer at once; never more than the server's own limit.
    const asked = typeof wait === "string" && /^[0-9]{1,3}$/.test(wait) ? Number(wait) * 1000 : poll;
    // The PC hanging up ends the wait, so nothing is held for a connection that has gone.
    const gone = new AbortController();
    reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
    try {
      const step = await s.jobs.next(s.user.id, deviceId, { waitMs: Math.min(asked, poll), signal: gone.signal });
      if (!step) return reply.code(204).send();
      return reply.send(step);
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Body: unknown }>("/v1/code/runner/progress", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await s.jobs.progress(s.user.id, req.body));
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Body: unknown }>("/v1/code/runner/result", { ...RL, bodyLimit: RESULT_BODY_LIMIT }, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await s.jobs.submitResult(s.user.id, req.body, "desktop"));
    } catch (err) { return fail(reply, err); }
  });
}

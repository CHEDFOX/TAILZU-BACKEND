/**
 * SCHEDULED CODE WORK, OVER HTTP (src/code/schedule, docs/code-schedule.md): a project's own standing job, started by the clock.
 *
 *   POST   /v1/code/schedules { projectId, task, schedule, tz?, budgetPaise? }  -> { schedule }  kept, on, its first run worked out
 *   GET    /v1/code/schedules                                                  -> { schedules }  the person's own, newest first
 *   PATCH  /v1/code/schedules/:id { task?, schedule?, budgetPaise?, status? }  -> { schedule }  a new task, time or budget; paused or resumed
 *   DELETE /v1/code/schedules/:id                                              -> { ok: true }
 *   POST   /v1/code/schedules/:id/run                                          -> { schedule }  once now, its schedule unchanged
 *
 * `schedule` is the shape routines keep (`routines/words.ts Schedule`): `{ every, minute, days?, monthDay? }`, the minute counted in
 * the person's own time with `tz` their offset. All of these are the owner's own rows only: another person's is `404 not_found`, never
 * forbidden. Everything answers `404 schedules_off` where `CODE_SCHEDULES` is false or this server has no Xode.
 *
 * A run goes through the ordinary door: a work branch is cut and a job is made exactly as `POST /v1/code/jobs` makes one, so the
 * policy, the budget, the checks before the commit, the review and the pull request are a person's job's, unchanged. Nobody is there
 * when it runs, so nothing here is attended: a job that needs the person parks and pushes them, as any job does.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { ConnectorError } from "../../connectors/state.js";
import { CodeSchedules, ScheduleError, type ScheduleDeps } from "../../code/schedule/index.js";
import { createWorkBranch, ownProject, type ProjectDeps } from "../../code/projects.js";
import type { Code } from "../../code/index.js";
import type { JobRouter } from "../../code/jobs/router.js";
import type { AgentOrchestrator } from "../../code/agent/orchestrator.js";
import { getConfig } from "../../config.js";
import { resolveUser } from "../../auth/supabase.js";

export interface CodeScheduleRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when CODE_GITHUB is off. */
  code: Code | null;
  /** Null when Xode has no client to run jobs with. */
  jobs: JobRouter | null;
  /** The agent loop's worker: a scheduled job is an agent job like any other. */
  agent?: AgentOrchestrator | null;
  /** The service, when a caller has built one (a test). Absent: built here from the stores below. */
  schedules?: CodeSchedules | null;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** What the service needs, built from the code bot's own parts. */
export function scheduleDeps(d: CodeScheduleRoutesDeps & { store: ScheduleDeps["store"] }): ScheduleDeps {
  const code = d.code!;
  const jobs = d.jobs!;
  const pd: ProjectDeps = { store: code.store, github: code.github!, approvals: code.approvals, oauth: code.oauth };
  return {
    store: d.store,
    async project(userId, projectId) {
      try {
        const p = await ownProject(pd, userId, projectId);
        return { id: p.id, fullName: p.fullName, defaultBranch: p.defaultBranch };
      } catch { return null; }
    },
    async startJob(o) {
      // A branch of its own for every run, as a person's job gets: making one changes nothing that exists.
      const { branch } = await createWorkBranch(pd, o.userId, o.projectId, o.task);
      const job = await jobs.createJob(o.userId, o.projectId, branch, o.task, o.budgetPaise, { agent: !!d.agent });
      // The agent drives it from here, as it does a job a person made.
      if (d.agent) await d.agent.enqueue(job.id).catch(() => undefined);
      return { id: job.id };
    },
    async jobRunning(jobId, userId) {
      const job = await jobs.job(userId, jobId).catch(() => null);
      return !!job && !["done", "failed", "cancelled"].includes(job.state);
    },
    ...(d.log ? { log: d.log } : {}),
  };
}

const off = (reply: FastifyReply) => reply.code(404).send({ code: "schedules_off", message: "Standing jobs are not on for this server." });

function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ScheduleError) return reply.code(err.status).send({ code: err.code, message: err.message });
  if (err instanceof ConnectorError) return reply.code(err.code === "not_found" ? 404 : 400).send({ code: err.code, message: err.message });
  return reply.code(500).send({ code: "server_error", message: "That did not work. Try again." });
}

export function registerCodeScheduleRoutes(app: FastifyInstance, d: CodeScheduleRoutesDeps): void {
  const RL = { config: d.rateLimit };
  const service = d.schedules ?? null;
  const on = () => (getConfig().CODE_SCHEDULES && service ? service : null);

  app.post<{ Body: unknown }>("/v1/code/schedules", RL, async (req, reply) => {
    const s = on();
    if (!s) return off(reply);
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.projectId !== "string" || !b.projectId) return reply.code(400).send({ code: "bad_request", message: "projectId is needed." });
    try {
      return reply.send({ schedule: await s.create(user.id, { projectId: b.projectId, task: b.task, schedule: b.schedule, tz: b.tz, budgetPaise: b.budgetPaise }) });
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/code/schedules", RL, async (req, reply) => {
    const s = on();
    if (!s) return off(reply);
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    try {
      return reply.send({ schedules: await s.list(user.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/v1/code/schedules/:id", RL, async (req, reply) => {
    const s = on();
    if (!s) return off(reply);
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      return reply.send({ schedule: await s.update(user.id, req.params.id, b) });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/code/schedules/:id", RL, async (req, reply) => {
    const s = on();
    if (!s) return off(reply);
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    try {
      await s.remove(user.id, req.params.id);
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/code/schedules/:id/run", RL, async (req, reply) => {
    const s = on();
    if (!s) return off(reply);
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    try {
      return reply.send({ schedule: await s.runNow(user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });
}

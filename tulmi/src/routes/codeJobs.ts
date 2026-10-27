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
 *                                          -> { job }  on a branch Tailzu made in the person's project (404 otherwise). Left out, the budget is
 *                                             CODE_JOB_DEFAULT_BUDGET_PAISE (3,000 paise); a budgetPaise of 0 sent on purpose means no model calls.
 *                                             On a server that has the agent loop the job is the agent's to drive from here (it is queued for the
 *                                             orchestrator, which picks it up at once)
 *   GET    /v1/code/jobs                   -> { jobs }  newest first
 *   GET    /v1/code/jobs/:id               -> { job, steps, agent? }  the steps with where they ran, how they ended and the last 8 KB they printed;
 *                                             `agent` (agent jobs only) is where the agent is: the phase, what it waits for, the plan, what is
 *                                             staged, the pull request, the checks, the findings and the final report
 *   POST   /v1/code/jobs/:id/cancel        -> { job }  nothing more is dispatched; a late result from the step that was out is refused
 *   POST   /v1/code/jobs/:id/compute-ok { maxPaise? }
 *                                          -> { job }  yes to paid compute for this job, after a compute_ask (409 not_waiting otherwise,
 *                                             409 paid_off if the rule is "never"). maxPaise is how much more it may spend
 *   POST   /v1/code/jobs/:id/answer { answer }
 *                                          -> { job }  the person's words to a question the agent asked (locate, a new project's intake, or the model's
 *                                             own ask_user); the job goes back to running. 409 not_waiting if it asked nothing
 *   POST   /v1/code/jobs/:id/approve { approvalId? }
 *                                          -> a QUESTION, then { approved, job }  yes to a plan the agent wants approved, or to something the policy asks
 *                                             about (a commit, marking the pull request ready): the same two steps as every other question (see
 *                                             routes/code.ts). 409 approval_expired / approval_invalid / not_waiting. { refreshing } when the question
 *                                             ran out and the agent is asking it again
 *   POST   /v1/code/jobs/:id/deny          -> { job }  no. A plan or a commit not approved ends the job; a pull request not marked ready stays a draft
 *   POST   /v1/code/jobs/:id/budget { addPaise }
 *                                          -> { job }  adds to the job's budget; a job that stopped for the money ("continue with ₹X more") goes on
 *                                             from where it was. 409 job_over for a job that is over
 *   POST   /v1/code/jobs/:id/stop          -> { job }  stops the job: the agent's loop is told and any step that is out is dropped
 *   POST   /v1/code/jobs/:id/rewind { toStep, approvalId? }
 *                                          -> { kind: "restored", step, job }  before the commit: the staged edits are put back as they stood after that step
 *                                             (0: before any work) and the job goes on working from there; or { kind: "reverted", step, sha, files, job }
 *                                             after it: a NEW commit returns the files to that step, through the policy (history is never rewritten) and
 *                                             the job ends; or { kind: "needs_approval", approvalId, action, summary, faceId, expiresAt }: say yes by sending
 *                                             the same call with that approvalId. 404 not_found for a step with no point, 409 job_over
 *   GET    /v1/code/jobs/:id/checkpoints   -> { checkpoints: [{ step, at, note, files }] }  the points a rewind can go to, oldest first
 *   GET    /v1/code/projects/:id/settings  -> { settings: { mode, planFirst } }  how the project's jobs are worked: "guided" (locate, plan, work) or
 *   PUT    /v1/code/projects/:id/settings { mode?, planFirst? }  "freeform" (the model decides the order of explore, change and run); planFirst: every
 *                                             task's plan goes to the person for a yes before any work. POST /v1/code/jobs may carry { mode?, planFirst? }
 *                                             for that one job, which beats the project's setting. The settings also say how a BIG goal is worked (docs/code-team.md):
 *                                             team "auto" (a plan over 12 files or 3 features becomes a lead's, with helpers), "on" (always) or "off" (never); POST
 *                                             /v1/code/jobs may carry { team?, projects? } too (projects: more of your projects' ids the same goal spans, one pull request each)
 *   GET    /v1/code/jobs/:id/team          -> { job, team, children }  a LEAD's team (docs/code-team.md): why there is one, the budget (total, spent, the lead's reserve, the
 *                                             helpers' pool), each part with its status, files, helper, branch, review, fix rounds and cost, and every helper job with its
 *                                             state. 404 for a job that leads no team
 *   POST   /v1/code/jobs/:id/team/parts/:k/stop
 *   POST   /v1/code/jobs/:id/team/parts/:k/rerun { addPaise? }
 *                                          -> { queued: true, part, job }  stop one part (its helper is stopped now; the lead leaves it out and the parts that build on it),
 *                                             or run it again after it failed, was stopped or ran out of money (addPaise gives it more, and adds the same to the job's
 *                                             budget). 409 part_over / part_not_over / job_over, 404 not_found
 *   GET    /v1/code/jobs/:id/log           -> { entries }  the work log, in order: every step, read, edit, command, finding and decision
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
 *   POST   /v1/code/runner/heartbeat { deviceId, name, allowRun, projects: [projectId] | "all" | { allExcept: [projectId] }, busy, capabilities?: { liveOnly, container, os, arch } }
 *                                          -> { ok, onlineForSec: 60, leasesRenewed }  marks the PC online for 60 seconds. Send one about
 *                                             every 30. A PC that says it is busy keeps the lease on the step it is running. Protocol version 2
 *                                             (docs/desktop-runner-session.md): `allExcept` and `capabilities` are new, and the list of ids is no
 *                                             longer cut at 200; a live-only PC is offered a live session and no ordinary step
 *   GET    /v1/code/runner/next?deviceId=&wait=
 *                                          -> { jobId, stepIdx, epoch, projectId, projectName, commands, timeoutSec, repo: { kind, cloneUrl, branch, headSha,
 *                                             readToken?, readTokenExpiresAt?, tarballUrl? } }  or 204 when there is nothing. It waits up to
 *                                             25 seconds for a step (`wait` is seconds, 0 to answer at once). repo is the existing
 *                                             read-only runner access (code/projects.ts runnerAccess): a token that can read one repo and
 *                                             nothing else, or for a sign-in project a one-time download link. A PC is never given a token
 *                                             that can write. 409 unknown_device if it hasn't sent a heartbeat in the last minute
 *   POST   /v1/code/runner/decline { jobId, epoch, deviceId }
 *                                          -> { ok, placement, state }  "not this computer": the lease is released AT ONCE (protocol version 2; it used to
 *                                             run out after 90 seconds) and the step is placed again, never on this computer. 409 stale_lease for a
 *                                             lease the caller does not hold
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
 * With the jobs on Cloudflare (docs/cloudflare-jobs.md section 10) there is also the LIVE SESSION, and the routes that go with it:
 *
 *   POST   /v1/code/runner/ticket { deviceId }
 *                                          -> { url, ticket, expiresAt }  a two-minute, signed pass for the desktop app's PRESENCE socket on the
 *                                             Worker (wss://<jobs>/v1/devices/connect): the person's PC is online for the router there as long as
 *                                             that socket is open. Authenticated as the person; the pass names the person and the device, and only
 *                                             those. 404 live_off when the jobs are not on Cloudflare (the HTTP heartbeat is the presence there)
 *   POST   /v1/code/jobs/:id/live          -> { url, ticket, expiresAt }  the same for the app WATCHING a job (wss://<jobs>/v1/rooms/<id>/watch):
 *                                             the owner's only (404 for anyone else's job). Over it the app is sent the phase, tool calls, short
 *                                             results, the output tail and the cost, and may send {"t":"message","text":"..."}
 *   POST   /v1/code/jobs/:id/message { text }
 *                                          -> { delivered: true }  the person's word to a job that is WORKING (not an answer to a question: that is
 *                                             /answer). The agent is shown it as the person's own words at the start of its next turn. 409 job_over
 *
 * GitHub's free computers (code/jobs/githubActions.ts) report on their own route, which is NOT behind the person's session: it is
 * behind GitHub's own signature.
 *
 *   POST   /v1/code/runner/gh-result { jobId, stepIdx, epoch, exitCode, outputTail, minutes, changes?: [{ path, content | null }] }
 *          with `Authorization: Bearer <the OIDC identity token GitHub gave the run>`
 *                                          -> the same answer as /runner/result. The token is checked before anything is counted: GitHub's signature
 *                                             (RS256, its JWKS), issuer, audience (CODE_RUNNER_OIDC_AUDIENCE, "tailzu"), expiry, and that it is for
 *                                             this project's repo, a push, this step's shadow branch, our workflow, and the commit the server made.
 *                                             401 bad_runner_token (not a token GitHub issued for this, or expired); 403 runner_mismatch (a good
 *                                             token for something else); 409 stale_lease for an epoch that isn't the job's current one. A result
 *                                             is at most 4 MB. The shadow branch is deleted after, whatever the answer
 *
 * PR care (code/prcare, docs/pr-care.md): the pull requests Tailzu looks after. Its own (opened by Tailzu) are looked after from the first event; any other
 * is looked after only when the person hands it over here. 404 care_off when it is not switched on.
 *
 *   GET    /v1/code/projects/:id/care      -> { pulls: [{ prNumber, branch, origin: "tailzu" | "handed", prUrl, title, ended, checks, conflict, waiting, working,
 *                                             fixesToday, notes }] }  where each pull request stands, newest first
 *   POST   /v1/code/projects/:id/care { prNumber }
 *                                          -> { care }  "look after this pull request": it must be open and from a branch in this repo (not a fork).
 *                                             Handing it over is the person's yes to Tailzu pushing to its branch (never forced; a protection rule still
 *                                             says no). What was said on it before is taken as seen. 409 pr_not_open, 400 for a fork
 *   DELETE /v1/code/projects/:id/care/:pr  -> { released }  "stop looking after it": the status comment says so, and jobs it started are cancelled
 *
 * and the project, with what GitHub's free computers make of it:
 *
 *   GET    /v1/code/projects/:id           -> { project: { ...the project, ciNoise, ciNoiseMinutes, ciNoiseWorkflows } }  ciNoise is true when a
 *                                             workflow of the person's own (read from the default branch) would also run on Tailzu's throwaway
 *                                             branch and spend their minutes; ciNoiseMinutes an estimate of the extra minutes a step then costs, and
 *                                             ciNoiseWorkflows which files. null when it is not known (the workflows could not be read)
 *
 * With CODE_GITHUB off every route answers 404 { code: "code_off" }; on, but with no GitHub set up, 503 { code: "not_configured" };
 * both before the session. Another person's job is 404, as a project is.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { stripAgent, viewOfState, type AgentOrchestrator } from "../code/agent/orchestrator.js";
import { stateOf } from "../code/agent/types.js";
import type { Code } from "../code/index.js";
import type { PrCare } from "../code/prcare/engine.js";
import type { CareRow } from "../code/prcare/types.js";
import type { GithubActionsProvider } from "../code/jobs/githubActions.js";
import type { JobRouter } from "../code/jobs/router.js";
import { startJobTicker } from "../code/jobs/ticker.js";
import { LONG_POLL_MS, TICK_MS } from "../code/jobs/types.js";
import { DEVICE_TICKET_TTL_MS, VIEWER_TICKET_TTL_MS } from "../code/live/limits.js";
import { signTicket } from "../code/live/tickets.js";
import type { Guard } from "../guard/index.js";
import { failCode } from "./code.js";
import { guarded } from "./guarded.js";

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
  /** GitHub's free computers: the provider that checks and takes their results. Null or absent: this server has none. */
  githubActions?: GithubActionsProvider | null;
  /** The agent loop's worker (code/agent). Null or absent: this server has none, and a job is left to whatever drives the router. */
  agent?: AgentOrchestrator | null;
  /** PR care (code/prcare): looks after pull requests Tailzu opened or the person handed over. Null or absent: the care routes answer 404 care_off. */
  care?: PrCare | null;
  /** A step's result was taken (a PC's, or GitHub's): tell whoever is waiting on the job. With jobs on the Worker this wakes its Workflow. */
  onStepResult?: (jobId: string) => void;
  /** The overload guards job creation runs under (src/guard); the process's own when not given. */
  guard?: Guard;
  /** The live session's passes (jobs on Cloudflare): where the Worker is and the secret both sides share. Null or absent: the two ticket routes answer 404 live_off. */
  live?: { jobsUrl: string; secret: string; now?: () => number } | null;
}

/** A result carries files, so it may be larger than the server's usual 1 MB. */
const RESULT_BODY_LIMIT = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    app.addHook("onReady", async () => {
      stop = startJobTicker({ jobs, agents: deps.agent, everyMs: tickEvery, log: app.log });
      deps.agent?.start();
    });
    app.addHook("onClose", async () => { stop?.(); await deps.agent?.stop(); });
  }

  /** A result was taken: whoever waits on the job (its Workflow, on Cloudflare) is told to look. */
  const stepResult = (body: unknown) => {
    const id = bodyOf(body).jobId;
    if (deps.onStepResult && typeof id === "string" && UUID.test(id)) deps.onStepResult(id);
  };

  const agentOff = (reply: FastifyReply) => reply.code(404).send({ code: "agent_off", message: "The Code bot's agent is not switched on on this server." });

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
    if (b.mode !== undefined && b.mode !== "guided" && b.mode !== "freeform") {
      return reply.code(400).send({ code: "bad_request", message: 'mode is "guided" or "freeform".' });
    }
    if (b.planFirst !== undefined && typeof b.planFirst !== "boolean") {
      return reply.code(400).send({ code: "bad_request", message: "planFirst is true or false." });
    }
    if (b.team !== undefined && b.team !== "auto" && b.team !== "on" && b.team !== "off") {
      return reply.code(400).send({ code: "bad_request", message: 'team is "auto", "on" or "off".' });
    }
    try {
      // The other projects of a goal that spans several are the person's own, checked before anything is made.
      const projects = deps.agent ? await deps.agent.teamProjects(s.user.id, projectId, b.projects) : [];
      // One tap, one job: a double tap (or a retry with the same Idempotency-Key) is the job already made, never a second (src/guard).
      return await guarded(deps.guard, req, reply, s.user, "job", async () => {
        const job = await s.jobs.createJob(s.user.id, projectId, branch, task, b.budgetPaise as number | undefined, { agent: !!deps.agent });
        // The agent drives it from here: the whole request goes into its state (the job keeps 500 characters of it), and the worker is nudged.
        // With jobs on the Worker, "nudged" is "handed over": a job the Worker could not be reached for comes back failed, with the reason.
        const made = deps.agent
          ? await deps.agent.enqueue(job.id, task, {
            ...(b.mode ? { mode: b.mode as "guided" | "freeform" } : {}), ...(b.planFirst !== undefined ? { planFirst: b.planFirst as boolean } : {}),
            ...(b.team ? { team: b.team as "auto" | "on" | "off" } : {}), ...(projects.length ? { projects } : {}),
          })
          : null;
        return { status: 200, body: { job: stripAgent(made ?? job) } };
      });
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/code/jobs", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send({ jobs: (await s.jobs.listJobs(s.user.id)).map(stripAgent) });
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/code/jobs/:id", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const { job, steps } = await s.jobs.jobWithSteps(s.user.id, req.params.id);
      const state = stateOf(job.checkpoint);
      return reply.send({ job: stripAgent(job), steps, ...(state ? { agent: viewOfState(state) } : {}) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/code/jobs/:id/cancel", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const job = await s.jobs.job(s.user.id, req.params.id);
      return reply.send({ job: stripAgent(await s.jobs.cancelJob(job.id)) });
    } catch (err) { return fail(reply, err); }
  });

  // --- the agent loop: the person's word to a job it is working on (code/agent/orchestrator.ts). Each is the owner's only.

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/code/jobs/:id/answer", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ job: await deps.agent.answer(s.user.id, req.params.id, bodyOf(req.body).answer) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown; Querystring: { approvalId?: unknown } }>("/v1/code/jobs/:id/approve", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    const b = bodyOf(req.body);
    const id = b.approvalId !== undefined ? b.approvalId : req.query?.approvalId;
    if (id !== undefined && (typeof id !== "string" || !id || id.length > 200)) {
      return reply.code(400).send({ code: "bad_request", message: "approvalId is the id the question gave." });
    }
    try {
      return reply.send(await deps.agent.approve(s.user.id, req.params.id, id as string | undefined));
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/code/jobs/:id/deny", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ job: await deps.agent.deny(s.user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/code/jobs/:id/budget", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ job: await deps.agent.addBudget(s.user.id, req.params.id, bodyOf(req.body).addPaise) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/code/jobs/:id/stop", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ job: await deps.agent.stopJob(s.user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown; Querystring: { approvalId?: unknown } }>("/v1/code/jobs/:id/rewind", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      const id = req.query.approvalId ?? bodyOf(req.body).approvalId;
      if (id !== undefined && (typeof id !== "string" || !id || id.length > 200)) return reply.code(400).send({ code: "bad_request", message: "approvalId is the id the question gave." });
      return reply.send(await deps.agent.rewind(s.user.id, req.params.id, bodyOf(req.body).toStep, id as string | undefined));
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/code/jobs/:id/team", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send(await deps.agent.team(s.user.id, req.params.id));
    } catch (err) { return fail(reply, err); }
  });

  for (const op of ["stop", "rerun"] as const) {
    app.post<{ Params: { id: string; k: string }; Body: unknown }>(`/v1/code/jobs/:id/team/parts/:k/${op}`, RL, async (req, reply) => {
      const s = await begin(req.headers["authorization"], reply);
      if (!s) return reply;
      if (!deps.agent) return agentOff(reply);
      const k = /^\d{1,3}$/.test(req.params.k) ? Number(req.params.k) : NaN;
      if (!Number.isInteger(k)) return reply.code(400).send({ code: "bad_request", message: "The part is a number." });
      try {
        return reply.send(await deps.agent.teamCommand(s.user.id, req.params.id, { op, part: k, ...(op === "rerun" && bodyOf(req.body).addPaise !== undefined ? { addPaise: bodyOf(req.body).addPaise } : {}) }));
      } catch (err) { return fail(reply, err); }
    });
  }

  app.get<{ Params: { id: string } }>("/v1/code/jobs/:id/checkpoints", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ checkpoints: await deps.agent.checkpoints(s.user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/code/jobs/:id/log", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ entries: await deps.agent.workLog(s.user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/code/jobs/:id/compute-ok", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    const maxPaise = bodyOf(req.body).maxPaise;
    try {
      return reply.send({ job: stripAgent(await s.jobs.approvePaid(s.user.id, req.params.id, maxPaise as number | undefined)) });
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
      const r = await s.jobs.approveCommit(s.user.id, req.params.id, id as string | undefined);
      return reply.send("job" in r ? { ...r, job: stripAgent(r.job) } : r);
    } catch (err) { return fail(reply, err); }
  });

  // --- the live session (jobs on Cloudflare): passes for two WebSockets to the Worker, and the person's word to a working job

  const liveOff = (reply: FastifyReply) => reply.code(404).send({ code: "live_off", message: "The live session is not switched on." });
  const wsBase = () => deps.live!.jobsUrl.trim().replace(/\/+$/, "").replace(/^http/i, "ws");
  const DEVICE_ID = /^[A-Za-z0-9._:-]{8,100}$/;

  app.post<{ Body: unknown }>("/v1/code/runner/ticket", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.live) return liveOff(reply);
    const deviceId = bodyOf(req.body).deviceId;
    if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) {
      return reply.code(400).send({ code: "bad_request", message: "deviceId is the id your app made for this computer (8 to 100 letters, digits, . _ : -)." });
    }
    const { ticket, claims } = signTicket({ secret: deps.live.secret, kind: "device", user: s.user.id, device: deviceId, ttlMs: DEVICE_TICKET_TTL_MS, ...(deps.live.now ? { now: deps.live.now() } : {}) });
    return reply.send({ url: `${wsBase()}/v1/devices/connect`, ticket, expiresAt: claims.x });
  });

  app.post<{ Params: { id: string } }>("/v1/code/jobs/:id/live", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.live) return liveOff(reply);
    try {
      // The owner's only: the router looks the job up by the person's id.
      const job = await s.jobs.job(s.user.id, req.params.id);
      const { ticket, claims } = signTicket({ secret: deps.live.secret, kind: "viewer", user: s.user.id, job: job.id, ttlMs: VIEWER_TICKET_TTL_MS, ...(deps.live.now ? { now: deps.live.now() } : {}) });
      return reply.send({ url: `${wsBase()}/v1/rooms/${job.id}/watch`, ticket, expiresAt: claims.x });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/code/jobs/:id/message", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send(await deps.agent.message(s.user.id, req.params.id, bodyOf(req.body).text));
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

  app.post<{ Body: unknown }>("/v1/code/runner/decline", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const out = await s.jobs.decline(s.user.id, req.body);
      // The step went to another place (or is waiting for one): whoever waits on the job is told to look.
      stepResult(req.body);
      return reply.send(out);
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
      const out = await s.jobs.submitResult(s.user.id, req.body, "desktop");
      stepResult(req.body);
      return reply.send(out);
    } catch (err) { return fail(reply, err); }
  });

  // --- GitHub's free computers report here: no session, GitHub's own signature instead (code/jobs/githubActions.ts handleResult)

  app.post<{ Body: unknown }>("/v1/code/runner/gh-result", { ...RL, bodyLimit: RESULT_BODY_LIMIT }, async (req, reply) => {
    if (!code) return off(reply);
    if (!jobs || !deps.githubActions) return notConfigured(reply);
    try {
      const out = await deps.githubActions.handleResult(jobs, req.headers["authorization"], req.body);
      stepResult(req.body);
      return reply.send(out);
    } catch (err) { return fail(reply, err); }
  });

  // --- how a project's jobs are worked: guided or free-form, and "always show me the plan first"

  app.get<{ Params: { id: string } }>("/v1/code/projects/:id/settings", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ settings: await deps.agent.settings(s.user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/v1/code/projects/:id/settings", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.agent) return agentOff(reply);
    try {
      return reply.send({ settings: await deps.agent.setSettings(s.user.id, req.params.id, req.body) });
    } catch (err) { return fail(reply, err); }
  });

  // --- PR care: the pull requests Tailzu looks after in a project (code/prcare, docs/pr-care.md)

  const careOff = (reply: FastifyReply) => reply.code(404).send({ code: "care_off", message: "Looking after pull requests is not switched on on this server." });
  /** A row as the app sees it: where each part stands, never the person's code. */
  const careView = (r: CareRow) => ({
    prNumber: r.prNumber, branch: r.branch, origin: r.origin, prUrl: r.state.prUrl ?? null, title: r.state.title ?? null, ended: r.state.ended ?? null,
    checks: r.state.ci ? { outcome: r.state.ci.outcome, names: r.state.ci.checks, note: r.state.ci.note } : null,
    conflict: r.state.conflict ? { outcome: r.state.conflict.outcome, note: r.state.conflict.note } : null,
    waiting: r.state.waiting ? { jobId: r.state.waiting.jobId, text: r.state.waiting.text } : null,
    working: r.state.jobs.filter((j) => !j.done).map((j) => ({ jobId: j.jobId, kind: j.kind })),
    fixesToday: r.ciRounds[new Date().toISOString().slice(0, 10)] ?? 0, notes: r.state.notes.slice(-8),
  });

  app.get<{ Params: { id: string } }>("/v1/code/projects/:id/care", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.care) return careOff(reply);
    try {
      return reply.send({ pulls: (await deps.care.list(s.user.id, req.params.id)).map(careView) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/code/projects/:id/care", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.care) return careOff(reply);
    try {
      return reply.send({ care: careView(await deps.care.handOver(s.user.id, req.params.id, bodyOf(req.body).prNumber)) });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string; pr: string } }>("/v1/code/projects/:id/care/:pr", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    if (!deps.care) return careOff(reply);
    try {
      const n = /^[0-9]{1,9}$/.test(req.params.pr) ? Number(req.params.pr) : 0;
      if (n < 1) return reply.code(400).send({ code: "bad_request", message: "The pull request is its number." });
      return reply.send({ released: await deps.care.release(s.user.id, req.params.id, n) });
    } catch (err) { return fail(reply, err); }
  });

  // --- a project, with what the person's own CI would do to GitHub's free minutes

  app.get<{ Params: { id: string } }>("/v1/code/projects/:id", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const project = UUID.test(req.params.id) ? await code!.store.getProject(s.user.id, req.params.id) : null;
      if (!project) return reply.code(404).send({ code: "not_found", message: "No such project" });
      const ci = deps.githubActions ? await deps.githubActions.ciNoiseFor(s.user.id, project) : null;
      return reply.send({
        project: { ...project, ciNoise: ci ? ci.ciNoise : null, ciNoiseMinutes: ci?.extraMinutes ?? 0, ciNoiseWorkflows: ci?.workflows ?? [] },
      });
    } catch (err) { return fail(reply, err); }
  });
}

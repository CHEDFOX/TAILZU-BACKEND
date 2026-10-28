/**
 * BOTS APP · CODE AREA: the endpoints the Code bot's screens need beyond the existing Code bot routes (routes/code.ts,
 * routes/codeJobs.ts). Each is a thin door: what it can, it does through those routes in-process (app.inject, as the
 * same person, through the same checks, the policy and its questions); the rest reads the Code bot's own stores.
 *
 *   POST /v1/bots/code/start { projectId, task, planFirst? }
 *                                   -> { job, branch }  a work branch for the task, then a job on it that shows its plan first
 *                                      (planFirst, default true) and carries the project's spend cap as its budget
 *   POST /v1/bots/code/projects/add { picks: { "<repoId>": true, ... } }
 *                                   -> { added: [{ id, fullName }], failed }  adds the picked repos as projects (each starts its brain)
 *   GET  /v1/bots/code/projects/:id/rules
 *                                   -> { project, rules: { prs, merge, main }, capPaise, capSet, typical, checks, branchExample, computers }
 *   POST /v1/bots/code/projects/:id/rules { rule: prs | merge | main, to: yes | ask | never }
 *                                   -> { rules }  the project's standing permissions set so the rule reads `to` (botsCode/rules.ts)
 *   POST /v1/bots/code/projects/:id/cap { paise? , step? }
 *                                   -> { capPaise }  the spend cap per job (₹10 steps, ₹10 to ₹500), kept in bots_code_rules
 *   POST /v1/bots/code/projects/:id/disconnect
 *                                   -> { ok, stopped }  stops the project's live jobs, then forgets the project (DELETE /v1/code/projects/:id)
 *   GET  /v1/bots/code/projects/:id/intake
 *                                   -> { request, answers, questions, answered, state, spec?, stack?, milestones?, plan? }  where the new-project
 *                                      questions stand, read from the intake's own row; calls no model
 *   POST /v1/bots/code/projects/:id/intake/answer { id?, picks?, text?, skip?, request? }
 *                                   -> POST /v1/code/projects/:id/intake's answer: the picked quick answers and the typed words as one answer
 *   POST /v1/bots/code/projects/:id/build-new
 *                                   -> { job }  a new project's first job: the README commit an empty repo needs (the person's tap is the yes),
 *                                      a work branch, and the job, which commits PLAN.md and builds the first milestone
 *   GET  /v1/bots/code/projects/:id/changes?branch=&job=
 *                                   -> { files: [{ path, status, additions, deletions, why?, hunks }], totals, commits, truncated }  what changed
 *                                      on a work branch, with the changed lines (botsCode/linediff.ts) and the job's own reason per file
 *   POST /v1/bots/code/merge { projectId, branch, jobId? }
 *                                   -> { merged, sha?, prNumber }  the person pressed Merge: the pull request marked ready if it is a draft, then
 *                                      merged; each of the policy's questions answered with that press. Anything that needs Face ID is refused here
 *   POST /v1/bots/code/jobs/:id/replan { change }
 *                                   -> { job }  "Change the plan": the plan is turned down and a new plan-first job on the same branch carries the change
 *   POST /v1/bots/code/jobs/:id/change { text }
 *                                   -> { job, delivered? }  "Ask for a change": to a job that is working, a message; otherwise a new job on the same branch
 *
 * Off (the Code bot is not on): 404 code_off, as its own routes. Every route is the signed-in person's own; another's is 404.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { allows } from "../code/jobs/devices.js";
import { intakeStore, nextQuestions, planMarkdown, planMilestones } from "../code/newproject/index.js";
import { guardRead, parseGrant } from "../code/policy.js";
import { assertAccess, branchSlug, ownProject, repoRef, type ProjectDeps } from "../code/projects.js";
import { isSecretPath } from "../code/project/lang.js";
import { worklogStore } from "../code/work/worklog.js";
import { checksOf, type BrainLite } from "../botsCode/brain.js";
import { typicalRange } from "../botsCode/history.js";
import { answerText } from "../botsCode/intake.js";
import { diffLines } from "../botsCode/linediff.js";
import { isRuleId, isRuleValue, ruleChange, rulesFrom } from "../botsCode/rules.js";
import { CAP_STEP_PAISE, codeRulesStore } from "../botsCode/store.js";
import type { BotsAreaDeps } from "./botsArea.js";
import { failCode } from "./code.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Files the review reads and diffs; the rest are listed with their counts only. */
const DIFF_FILES = 4;
/** A file changed by more lines than this is listed, not drawn. */
const DIFF_LINES_MAX = 600;

/** An inner route's refusal, passed on as it was. */
class Inner extends Error {
  constructor(readonly status: number, readonly body: unknown) { super(`inner ${status}`); }
}

const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
const words = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ code: "bad_request", message });

export function registerBotsCodeRoutes(app: FastifyInstance, deps: BotsAreaDeps): void {
  const RL = { config: deps.rateLimit };
  const rules = () => codeRulesStore();

  /** The Code bot is on and someone is signed in; else the answer has been sent. */
  const who = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!deps.code) { reply.code(404).send({ code: "code_off", message: "The Code bot is not switched on." }); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return { user, code: deps.code };
  };

  /** One of the app's own routes, as the same person. Throws Inner for anything but a 2xx. */
  const inner = async <T = Record<string, unknown>>(req: FastifyRequest, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: Record<string, unknown>): Promise<T> => {
    const r = await app.inject({
      method, url, ...(payload ? { payload } : {}),
      headers: { authorization: String(req.headers["authorization"] ?? ""), ...(payload ? { "content-type": "application/json" } : {}) },
    });
    let parsed: unknown = null;
    try { parsed = r.body ? JSON.parse(r.body) : null; } catch { parsed = { message: r.body }; }
    if (r.statusCode < 200 || r.statusCode >= 300) throw new Inner(r.statusCode, parsed);
    return parsed as T;
  };

  /**
   * A route that asks first (routes/code.ts "A QUESTION"): the person's press on the screen that showed what it does is the
   * yes, so the question is answered at once with its approvalId. One that needs Face ID is not answered here.
   */
  const yes = async <T = Record<string, unknown>>(req: FastifyRequest, url: string, body: Record<string, unknown> = {}): Promise<T> => {
    const first = await inner<Record<string, unknown>>(req, "POST", url, body);
    if (first?.needsApproval === true) {
      if (first.faceId === true) throw new Inner(403, { code: "needs_face_id", message: "This one needs your Face ID. Say yes on your phone." });
      return inner<T>(req, "POST", url, { ...body, approvalId: first.approvalId });
    }
    return first as T;
  };

  const done = (reply: FastifyReply, err: unknown) => {
    if (err instanceof Inner) return reply.code(err.status).send(err.body ?? {});
    return failCode(reply, err);
  };

  const projectDeps = (code: NonNullable<BotsAreaDeps["code"]>): ProjectDeps | null =>
    code.github ? { store: code.store, github: code.github, approvals: code.approvals, oauth: code.oauthWanted ? code.oauth : null } : null;

  const ownOr404 = async (reply: FastifyReply, code: NonNullable<BotsAreaDeps["code"]>, userId: string, id: string) => {
    const p = UUID.test(id) ? await code.store.getProject(userId, id) : null;
    if (!p) { reply.code(404).send({ code: "not_found", message: "No such project" }); return null; }
    return p;
  };

  /** A job for a task in a project: a branch, then the job with the project's cap. */
  const startJob = async (req: FastifyRequest, userId: string, projectId: string, task: string, o: { planFirst?: boolean; branch?: string; budgetPaise?: number } = {}) => {
    const cap = o.budgetPaise ?? (await rules().cap(userId, projectId).catch(() => null));
    const branch = o.branch ?? (await inner<{ branch: string }>(req, "POST", `/v1/code/projects/${projectId}/branches`, { task })).branch;
    const made = await inner<{ job: Record<string, unknown> }>(req, "POST", "/v1/code/jobs", {
      projectId, branch, task, ...(o.planFirst !== undefined ? { planFirst: o.planFirst } : {}), ...(cap ? { budgetPaise: cap } : {}),
    });
    return { job: made.job, branch };
  };

  // --- start a task: plan first

  app.post<{ Body: unknown }>("/v1/bots/code/start", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const projectId = typeof b.projectId === "string" && UUID.test(b.projectId) ? b.projectId : null;
    const task = words(b.task, 4000);
    if (!projectId) return bad(reply, "Say which project.");
    if (!task) return bad(reply, "Say what you want done.");
    if (b.planFirst !== undefined && typeof b.planFirst !== "boolean") return bad(reply, "planFirst is true or false.");
    try {
      if (!(await ownOr404(reply, s.code, s.user.id, projectId))) return reply;
      return reply.send(await startJob(req, s.user.id, projectId, task, { planFirst: b.planFirst !== false }));
    } catch (err) { return done(reply, err); }
  });

  // --- pick projects

  app.post<{ Body: unknown }>("/v1/bots/code/projects/add", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const picks = bodyOf(bodyOf(req.body).picks);
    const ids = Object.entries(picks).filter(([k, v]) => v === true && /^[0-9]{1,15}$/.test(k)).map(([k]) => Number(k)).slice(0, 10);
    if (!ids.length) return bad(reply, "Pick a project first.");
    const added: Array<{ id: string; fullName: string }> = [];
    let failed = 0;
    for (const repoId of ids) {
      try {
        const r = await inner<{ project: { id: string; fullName: string } }>(req, "POST", "/v1/code/projects", { repoId });
        added.push({ id: r.project.id, fullName: r.project.fullName });
      } catch { failed += 1; }
    }
    if (!added.length) return reply.code(409).send({ code: "none_added", message: "I couldn't add those. Check Tailzu can see them on GitHub." });
    return reply.send({ added, failed });
  });

  // --- project rules

  const rulesView = async (userId: string, code: NonNullable<BotsAreaDeps["code"]>, p: { id: string; fullName: string; defaultBranch: string }) => {
    const now = Date.now();
    const [grants, capSet, jobs, brain, branches] = await Promise.all([
      code.store.listGrants(p.id),
      rules().cap(userId, p.id).catch(() => null),
      deps.jobs ? deps.jobs.listJobs(userId, 50).catch(() => []) : Promise.resolve([]),
      code.brain ? (code.brain.get(userId, p.id) as Promise<unknown>).catch(() => null) : Promise.resolve(null),
      code.store.listBranches(p.id).catch(() => []),
    ]);
    const latest = branches.filter((b) => b.branch.startsWith("tailzu/")).sort((a, b) => b.createdAt - a.createdAt)[0];
    const computers = deps.jobs ? deps.jobs.devices.onlineFor(userId, now).map((d) => ({ name: d.name, on: d.allowRun && allows(d, p.id) })) : [];
    return {
      project: { id: p.id, fullName: p.fullName, defaultBranch: p.defaultBranch },
      rules: rulesFrom(grants, p.defaultBranch, now),
      capPaise: capSet ?? deps.jobs?.defaultBudget() ?? 3000, capSet: capSet !== null,
      typical: typicalRange(jobs, p.id),
      checks: checksOf((brain ?? undefined) as BrainLite | undefined),
      branchExample: latest?.branch ?? `tailzu/${branchSlug(latest?.task || "your-task")}`,
      computers,
    };
  };

  app.get<{ Params: { id: string } }>("/v1/bots/code/projects/:id/rules", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    try {
      const p = await ownOr404(reply, s.code, s.user.id, req.params.id);
      if (!p) return reply;
      return reply.send(await rulesView(s.user.id, s.code, p));
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/bots/code/projects/:id/rules", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    if (!isRuleId(b.rule) || !isRuleValue(b.to)) return bad(reply, "Say which rule (prs, merge, main) and what it should be (yes, ask, never).");
    try {
      const p = await ownOr404(reply, s.code, s.user.id, req.params.id);
      if (!p) return reply;
      let change;
      try { change = ruleChange(b.rule, b.to, await s.code.store.listGrants(p.id), p.defaultBranch); } catch (e) { return bad(reply, (e as Error).message); }
      for (const id of change.remove) await s.code.store.deleteGrant(p.id, id);
      if (change.add) await s.code.store.addGrant(p.id, parseGrant(change.add));
      return reply.send({ rules: rulesFrom(await s.code.store.listGrants(p.id), p.defaultBranch) });
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/bots/code/projects/:id/cap", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const paise = typeof b.paise === "number" && Number.isFinite(b.paise) ? b.paise : null;
    const step = b.step === 1 || b.step === -1 ? b.step : null;
    if (paise === null && step === null) return bad(reply, "Send paise, or step 1 or -1.");
    try {
      const p = await ownOr404(reply, s.code, s.user.id, req.params.id);
      if (!p) return reply;
      const cur = (await rules().cap(s.user.id, p.id)) ?? deps.jobs?.defaultBudget() ?? 3000;
      return reply.send({ capPaise: await rules().setCap(s.user.id, p.id, paise ?? cur + step! * CAP_STEP_PAISE) });
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/bots/code/projects/:id/disconnect", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    try {
      const p = await ownOr404(reply, s.code, s.user.id, req.params.id);
      if (!p) return reply;
      const live = deps.jobs ? (await deps.jobs.listJobs(s.user.id, 50)).filter((j) => j.projectId === p.id && !["done", "failed", "cancelled"].includes(j.state)) : [];
      let stopped = 0;
      for (const j of live) {
        try { await inner(req, "POST", `/v1/code/jobs/${j.id}/stop`); stopped += 1; }
        catch { try { await inner(req, "POST", `/v1/code/jobs/${j.id}/cancel`); stopped += 1; } catch { /* it ended on its own */ } }
      }
      await inner(req, "DELETE", `/v1/code/projects/${p.id}`);
      return reply.send({ ok: true, stopped });
    } catch (err) { return done(reply, err); }
  });

  // --- a new project: the questions and the growing PLAN.md

  app.get<{ Params: { id: string } }>("/v1/bots/code/projects/:id/intake", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    try {
      const p = await ownOr404(reply, s.code, s.user.id, req.params.id);
      if (!p) return reply;
      const row = await intakeStore().get(p.id).catch(() => null);
      const request = row?.request ?? "";
      const answers = row?.answers ?? {};
      const next = nextQuestions(request, answers);
      const spec = row?.spec ?? null, stack = row?.stack ?? null;
      return reply.send({
        project: { id: p.id, fullName: p.fullName }, request, answers, questions: request ? next.questions : [], answered: next.answered,
        state: row?.state ?? "none",
        ...(spec && stack ? {
          spec: { name: spec.name, summary: spec.summary, platforms: spec.platforms, features: spec.features.map((f) => f.name) },
          stack: { label: stack.label, hosting: stack.hosting.name, tier: stack.hosting.tier },
          milestones: planMilestones(spec, stack).map((m) => ({ k: m.k, title: m.title })),
          plan: planMarkdown(spec, stack),
        } : {}),
      });
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/bots/code/projects/:id/intake/answer", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    let payload: Record<string, unknown>;
    if (b.request !== undefined) {
      const request = words(b.request, 4000);
      if (!request) return bad(reply, "Say what you want to build.");
      payload = { request };
    } else {
      const id = words(b.id, 20);
      if (!id) return bad(reply, "Say which question.");
      if (b.skip === true) payload = { answers: { [id]: "skip" } };
      else {
        const text = answerText(id, bodyOf(b.picks), typeof b.text === "string" ? b.text : undefined);
        if (!text) return bad(reply, "Pick or type an answer first.");
        payload = { answers: { [id]: text } };
      }
    }
    try {
      if (!(await ownOr404(reply, s.code, s.user.id, req.params.id))) return reply;
      return reply.send(await inner(req, "POST", `/v1/code/projects/${req.params.id}/intake`, payload));
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { id: string } }>("/v1/bots/code/projects/:id/build-new", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    try {
      const p = await ownOr404(reply, s.code, s.user.id, req.params.id);
      if (!p) return reply;
      const row = await intakeStore().get(p.id).catch(() => null);
      if (!row?.request) return reply.code(409).send({ code: "no_idea", message: "Say what you want to build first." });
      try {
        await yes(req, `/v1/code/projects/${p.id}/init`, row.spec?.name ? { title: row.spec.name } : {});
      } catch (err) {
        // A repo that already has a commit needs no README.
        if (!(err instanceof Inner && err.status === 409 && (err.body as { code?: string } | null)?.code === "repo_not_empty")) throw err;
      }
      return reply.send(await startJob(req, s.user.id, p.id, row.request));
    } catch (err) { return done(reply, err); }
  });

  // --- what changed, line by line

  app.get<{ Params: { id: string }; Querystring: { branch?: string; job?: string } }>("/v1/bots/code/projects/:id/changes", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const d = projectDeps(s.code);
    if (!d) return reply.code(503).send({ code: "not_configured", message: "GitHub isn't set up on this server yet." });
    const branch = words(req.query.branch, 255);
    if (!branch) return bad(reply, "Say which branch.");
    const jobId = req.query.job && UUID.test(req.query.job) ? req.query.job : null;
    try {
      const project = await ownProject(d, s.user.id, req.params.id);
      await assertAccess(d, s.user.id, project);
      await guardRead(d.store, project, branch);
      const repo = repoRef(d, s.user.id, project);
      const diff = await d.github.compare(repo, branch);
      // The job's own reason for each file (its work log's edits), when the job is the person's.
      const why = new Map<string, string>();
      if (jobId && deps.jobs) {
        const job = await deps.jobs.job(s.user.id, jobId).catch(() => null);
        if (job && job.projectId === project.id) {
          for (const e of await worklogStore().list(jobId, { kinds: ["edit"] }).catch(() => [])) {
            for (const f of e.files ?? []) if (e.text && !why.has(f)) why.set(f, e.text);
          }
        }
      }
      const read = async (ref: string, path: string): Promise<string> => {
        try { return (await d.github.readFile(repo, ref, path)).text; } catch { return ""; }
      };
      let drawn = 0;
      const files = [];
      for (const f of diff.files) {
        const small = f.additions + f.deletions <= DIFF_LINES_MAX && !isSecretPath(f.path);
        let hunks = null;
        if (small && drawn < DIFF_FILES) {
          drawn += 1;
          const [before, after] = await Promise.all([
            f.status === "added" ? Promise.resolve("") : read(project.defaultBranch, f.path),
            f.status === "removed" ? Promise.resolve("") : read(branch, f.path),
          ]);
          hunks = diffLines(before, after, { maxHunks: 4 });
        }
        files.push({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions, ...(why.has(f.path) ? { why: why.get(f.path) } : {}), hunks });
      }
      return reply.send({ files, totals: diff.totals, commits: diff.commits.length, truncated: diff.truncated });
    } catch (err) { return done(reply, err); }
  });

  // --- the person presses Merge

  app.post<{ Body: unknown }>("/v1/bots/code/merge", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const projectId = typeof b.projectId === "string" && UUID.test(b.projectId) ? b.projectId : null;
    const branch = words(b.branch, 255);
    const jobId = typeof b.jobId === "string" && UUID.test(b.jobId) ? b.jobId : null;
    if (!projectId || !branch) return bad(reply, "Say which project and branch.");
    const B = `/v1/code/projects/${projectId}/branches/${encodeURIComponent(branch)}`;
    try {
      if (jobId) {
        // A job waiting for the yes to mark its pull request ready gets it first.
        const view = await inner<{ agent?: { waiting?: { kind?: string; for?: string } } }>(req, "GET", `/v1/code/jobs/${jobId}`).catch(() => null);
        if (view?.agent?.waiting?.kind === "approval" && view.agent.waiting.for === "ready") await yes(req, `/v1/code/jobs/${jobId}/approve`);
      }
      const pr = await inner<{ number: number; state: string; draft: boolean }>(req, "GET", `${B}/pr`);
      if (pr.state === "merged") return reply.send({ merged: true, already: true, prNumber: pr.number });
      if (pr.state !== "open") return reply.code(409).send({ code: "pr_not_open", message: "That pull request is closed." });
      if (pr.draft) await yes(req, `${B}/pr/ready`);
      const out = await yes<{ merged?: boolean; sha?: string }>(req, `${B}/pr/merge`);
      return reply.send({ merged: out.merged !== false, ...(out.sha ? { sha: out.sha } : {}), prNumber: pr.number });
    } catch (err) { return done(reply, err); }
  });

  // --- change the plan, ask for a change

  interface JobView { job: { id: string; projectId: string; branch: string; task: string; state: string; budgetPaise: number }; agent?: { waiting?: { kind?: string; for?: string } } }

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/bots/code/jobs/:id/replan", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const change = words(bodyOf(req.body).change, 2000);
    if (!change) return bad(reply, "Say what to change.");
    if (!UUID.test(req.params.id)) return reply.code(404).send({ code: "not_found", message: "No such job" });
    try {
      const v = await inner<JobView>(req, "GET", `/v1/code/jobs/${req.params.id}`);
      if (v.agent?.waiting?.kind === "approval" && v.agent.waiting.for === "plan") await inner(req, "POST", `/v1/code/jobs/${v.job.id}/deny`).catch(() => undefined);
      else if (!["done", "failed", "cancelled"].includes(v.job.state)) await inner(req, "POST", `/v1/code/jobs/${v.job.id}/stop`).catch(() => undefined);
      const task = `${v.job.task}\n\nChange to the plan: ${change}`.slice(0, 4000);
      return reply.send(await startJob(req, s.user.id, v.job.projectId, task, { planFirst: true, branch: v.job.branch, budgetPaise: v.job.budgetPaise }));
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/v1/bots/code/jobs/:id/change", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const text = words(bodyOf(req.body).text, 2000);
    if (!text) return bad(reply, "Say what to change.");
    if (!UUID.test(req.params.id)) return reply.code(404).send({ code: "not_found", message: "No such job" });
    try {
      const v = await inner<JobView>(req, "GET", `/v1/code/jobs/${req.params.id}`);
      if (v.job.state === "running" || v.job.state === "queued") {
        await inner(req, "POST", `/v1/code/jobs/${v.job.id}/message`, { text });
        return reply.send({ job: v.job, delivered: true });
      }
      const task = `${text}\n\n(A change to "${v.job.task.slice(0, 300)}", on the same branch.)`;
      return reply.send(await startJob(req, s.user.id, v.job.projectId, task, { branch: v.job.branch }));
    } catch (err) { return done(reply, err); }
  });
}

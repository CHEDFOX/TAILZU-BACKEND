/**
 * THE XODE FLOW (code/flow): read the project and hear the owner's direction, agree a plan in the chat, approve it, and let the work go on
 * while every message is judged against the plan. What the app's Xode chat calls (experience/bots/screens/codeWork/flow.ts).
 *
 *   GET  /v1/bots/code/flow/:project/gate                 { gate }: the read's progress and whether the owner gave a direction
 *   POST /v1/bots/code/flow/:project/vision { vision?, keep?, skip? }   the owner's direction (or "let Xode suggest"): the book's own write
 *   GET  /v1/bots/code/flow/:project/plan?thread=         { gate, plan, job }: the chat's plan; the first time the gate is open, the opening
 *                                                         plan is made (where it stands, where it is heading, the next piece, its steps)
 *   POST /v1/bots/code/flow/:project/say { thread, text } before the work: Xode answers (reading the code, never starting work by itself),
 *                                                         then the plan is kept or revised: { answer, plan, changed }
 *   POST /v1/bots/code/flow/:project/approve { thread, v }   the plan's yes: a job starts on it (no second approval), or a running job is
 *                                                         told its new plan: { plan, job }
 *   POST /v1/bots/code/flow/:project/work { thread, text, attachments? }   while the work goes on: the message is judged (code/flow/triage.ts)
 *                                                         and acted on: { kind, say, plan?, artifact?, stop? }
 *
 * Every write goes through the routes that already own the thing (the book, branches, jobs, a job's message, the ask road), as the same
 * person, so their checks are all made again. Models: the cheap tier, a few paise a call, on the person's own spend.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { CodeChat } from "../../code/chat/index.js";
import { threadStore, type ChatThread, type ThreadStore } from "../../code/chat/threads.js";
import { gateOf, type BrainLike, type Gate } from "../../code/flow/gate.js";
import { keepPlan, openingPlan, planTask, PlanUnavailable, type ProjectPlan } from "../../code/flow/plan.js";
import { approvedNote, jobNote, triage } from "../../code/flow/triage.js";
import type { OwnerAnswers, ProjectBook } from "../../code/project/book.js";
import { bookForPlan } from "../../code/project/book.js";
import type { CallFn, ModelCtx } from "../../code/work/model.js";
import type { CodeProject } from "../../code/store.js";
import { codeRulesStore } from "../../botsCode/store.js";
import type { BotsAreaDeps } from "./botsArea.js";
import { failCode } from "../code/code.js";
import { Inner, innerCall } from "./inner.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What one flow call may spend on its models, in paise. */
const FLOW_PAISE = 300;
const ANSWER_PAISE = 1500;

const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

interface BrainView extends BrainLike { owner?: OwnerAnswers }
interface JobView { job: { id: string; projectId: string; branch: string; task: string; state: string }; agent?: { phase?: string; waiting?: { kind?: string } | null; doing?: string } }
const ENDED = new Set(["done", "failed", "cancelled"]);
/** Words that ask to see it first: a mockup, a design, how it will look. */
export const MOCKUP_ASK = /\b(mock[\s-]?ups?|wire[\s-]?frames?|designs?|sketch|prototype|how (?:it|this|that) (?:will |would )?looks?|show me (?:how|what) it)\b/i;

/** Xode's answer in the chat, reading the code (code/chat converse), with no way to start work. Swappable for tests. */
export type FlowAnswer = (a: { userId: string; projectId: string; threadId: string; text: string }) => Promise<{ text: string; next: string[] }>;

export function registerXodeFlowRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { call?: CallFn; threads?: ThreadStore; now?: () => number; answer?: FlowAnswer } = {}): void {
  const RL = { config: deps.rateLimit };
  const inner = innerCall(app);
  const threads = (): ThreadStore => o.threads ?? threadStore();
  const now = o.now ?? Date.now;
  const model = (userId: string, maxPaise = FLOW_PAISE): ModelCtx => ({ userId, budget: { maxPaise }, ...(o.call ? { call: o.call } : {}) });

  const who = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!deps.code) { reply.code(404).send({ code: "code_off", message: "Xode is not switched on." }); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return { user, code: deps.code };
  };
  const done = (reply: FastifyReply, err: unknown) => {
    if (err instanceof Inner) return reply.code(err.status).send(err.body ?? {});
    if (err instanceof PlanUnavailable) return reply.code(err.reason === "budget" ? 402 : 503).send({ code: err.reason === "budget" ? "budget" : "model_down", message: err.reason === "budget" ? "That would cost more than your plan allows today." : "Xode couldn't think just now. Try again in a moment." });
    return failCode(reply, err);
  };
  const projectOf = (reply: FastifyReply, id: string) => {
    if (UUID.test(id)) return id;
    reply.code(404).send({ code: "not_found", message: "No such project" });
    return null;
  };

  const brainOf = (req: FastifyRequest, projectId: string) => inner<BrainView>(req, "GET", `/v1/code/projects/${projectId}/brain`);
  const gateFor = async (req: FastifyRequest, projectId: string): Promise<{ gate: Gate; owner: OwnerAnswers | null }> => {
    const b = await brainOf(req, projectId);
    return { gate: gateOf(b, b.owner), owner: b.owner ?? null };
  };
  const threadOf = async (userId: string, projectId: string, threadId: string): Promise<ChatThread | null> =>
    (UUID.test(threadId) ? threads().get(userId, projectId, threadId) : null);
  const savePlan = async (userId: string, projectId: string, threadId: string, plan: ProjectPlan): Promise<void> => {
    const t = (await threadOf(userId, projectId, threadId)) ?? {
      id: threadId, userId, projectId, summary: "", turns: 0, lastQuestion: "", lastCites: [], lastLocated: null, history: [], createdAt: now(), updatedAt: now(),
    };
    await threads().put({ ...t, plan, updatedAt: now() });
  };
  /** A mockup in the project's own look, beside the talk: the ask road's design, never a change to the code. */
  const mockupOf = (req: FastifyRequest, projectId: string, words: string): Promise<string | undefined> =>
    inner<{ result?: { artifacts?: Array<{ id: string }> } }>(req, "POST", "/v1/ask", {
      message: `Design a mockup of this, only to look at (no change to the code): ${words}`, projectId, device: "phone", mode: "text", visual: "component",
    }).then((r) => r.result?.artifacts?.[0]?.id).catch(() => undefined);
  /** A picture sent in the chat, read by the ask road's own picture reader: what it shows, any text word for word. */
  const pictureOf = (req: FastifyRequest, attachments: unknown[]): Promise<string> => (attachments.length
    ? inner<{ result?: { text?: string } }>(req, "POST", "/v1/ask", {
      message: "What does this picture show? Any visible text word for word, then what it shows about an app or a design.", attachments, device: "phone", mode: "text",
    }).then((r) => text(r.result?.text, 1500)).catch(() => "")
    : Promise.resolve(""));
  /** An exchange during the work, kept in the chat like any other turn. */
  const keepTurn = async (userId: string, projectId: string, threadId: string, q: string, a: string): Promise<void> => {
    const t = await threadOf(userId, projectId, threadId);
    if (!t) return;
    await threads().put({ ...t, history: [...t.history, { q: q.slice(0, 1000), a: a.slice(0, 4000), at: now() }].slice(-30), turns: t.turns + 1, lastQuestion: q.slice(0, 1000), updatedAt: now() });
  };
  const jobOf = async (req: FastifyRequest, id: string | undefined): Promise<JobView | null> =>
    (id ? inner<JobView>(req, "GET", `/v1/code/jobs/${id}`).catch(() => null) : null);
  /** The plan as it stands: an approved plan's job that has ended has made it done. */
  const current = async (req: FastifyRequest, plan: ProjectPlan | undefined): Promise<{ plan: ProjectPlan | null; job: JobView | null }> => {
    if (!plan) return { plan: null, job: null };
    const job = await jobOf(req, plan.jobId);
    if (job && plan.status === "working" && ENDED.has(job.job.state)) return { plan: { ...plan, status: "done" }, job };
    return { plan, job };
  };

  // ------------------------------------------------------------------ the gate, and the owner's direction

  app.get<{ Params: { project: string } }>("/v1/bots/code/flow/:project/gate", RL, async (req, reply) => {
    const s = await who(req, reply);
    const id = s && projectOf(reply, req.params.project);
    if (!s || !id) return reply;
    try { return reply.send({ gate: (await gateFor(req, id)).gate }); } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { project: string } }>("/v1/bots/code/flow/:project/vision", RL, async (req, reply) => {
    const s = await who(req, reply);
    const id = s && projectOf(reply, req.params.project);
    if (!s || !id) return reply;
    const b = bodyOf(req.body);
    const answers = b.skip === true ? { skipped: true } : { vision: text(b.vision, 2000), ...(typeof b.keep === "string" ? { keep: text(b.keep, 400) } : {}) };
    if (b.skip !== true && !(answers as { vision: string }).vision) return reply.code(400).send({ code: "bad_request", message: "Say where you want to take the project, or let Xode suggest it." });
    try {
      // The book's own write; while the book is still being made it answers 409, and the words are kept all the same.
      await inner(req, "POST", `/v1/code/projects/${id}/book`, { answers }).catch((err) => { if (!(err instanceof Inner && err.status === 409)) throw err; });
      const { gate, owner } = await gateFor(req, id);
      if (gate.vision === "missing") return reply.code(409).send({ code: "not_read", message: "Xode hasn't started reading this project yet. Try again in a moment." });
      return reply.send({ gate, saved: owner?.skipped ? "skipped" : "given" });
    } catch (err) { return done(reply, err); }
  });

  // ------------------------------------------------------------------ the plan, before the work

  app.get<{ Params: { project: string }; Querystring: { thread?: string } }>("/v1/bots/code/flow/:project/plan", RL, async (req, reply) => {
    const s = await who(req, reply);
    const id = s && projectOf(reply, req.params.project);
    if (!s || !id) return reply;
    const threadId = String(req.query.thread ?? "");
    if (!UUID.test(threadId)) return reply.code(400).send({ code: "bad_request", message: "thread is the chat's id." });
    try {
      const { gate, owner } = await gateFor(req, id);
      if (!gate.open) return reply.send({ gate, plan: null, job: null });
      const t = await threadOf(s.user.id, id, threadId);
      if (t?.plan) return reply.send({ gate, ...(await current(req, t.plan)) });
      const book = await inner<{ book: ProjectBook }>(req, "GET", `/v1/code/projects/${id}/book`).then((r) => r.book).catch(() => null);
      const project = await s.code.store.getProject(s.user.id, id);
      const plan = await openingPlan(model(s.user.id), {
        name: project?.fullName.split("/").pop() ?? "the project",
        known: book ? bookForPlan(book) : "",
        owner: owner && !owner.skipped ? { for: owner.for, next: owner.next, keep: owner.keep, vision: owner.vision } : null,
      }, now());
      await savePlan(s.user.id, id, threadId, plan);
      return reply.send({ gate, plan, job: null });
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { project: string } }>("/v1/bots/code/flow/:project/say", RL, async (req, reply) => {
    const s = await who(req, reply);
    const id = s && projectOf(reply, req.params.project);
    if (!s || !id) return reply;
    const b = bodyOf(req.body);
    const threadId = String(b.thread ?? "");
    const attachments = Array.isArray(b.attachments) ? b.attachments.slice(0, 4) : [];
    let said = text(b.text, 2000);
    if (!UUID.test(threadId) || (!said && !attachments.length)) return reply.code(400).send({ code: "bad_request", message: "Say something, in this chat." });
    try {
      const t = await threadOf(s.user.id, id, threadId);
      const { plan: was } = await current(req, t?.plan);
      // A picture sent while the plan is talked over: read, and talked over with the words.
      const picture = await pictureOf(req, attachments);
      if (picture) said = `${said || "Here is a picture."}\n\n(The picture shows: ${picture})`;
      if (!was) return reply.code(409).send({ code: "no_plan", message: "The plan isn't ready yet." });
      // Xode answers as in any chat, reading the code; it never starts work from here: only the plan's yes does.
      const answer = await (o.answer ?? converseAnswer(s.code, o, threads))({ userId: s.user.id, projectId: id, threadId, text: said });
      const owner = (await gateFor(req, id)).owner;
      // A plan whose work is done: the next message plans the next piece.
      const base = was.status === "done" ? { ...was, steps: [], status: "proposed" as const } : was;
      const kept = was.status === "proposed" || was.status === "done"
        ? await keepPlan(model(s.user.id), { plan: base.steps.length ? base : was, message: said, answer: answer.text, ...(owner?.keep ? { keep: owner.keep } : {}) }, now())
        : { plan: was, changed: false };
      // Asked to see it first: a mockup in the project's look, kept with the plan; the plan's yes then builds it.
      const mockup = MOCKUP_ASK.test(said) ? await mockupOf(req, id, said) : undefined;
      const plan = mockup ? { ...kept.plan, mockup } : kept.plan;
      const fresh = await threadOf(s.user.id, id, threadId);
      if (kept.changed || mockup) await threads().put({ ...(fresh ?? t!), plan, updatedAt: now() });
      return reply.send({ answer: answer.text, next: answer.next, plan, changed: kept.changed, ...(mockup ? { mockup } : {}) });
    } catch (err) { return done(reply, err); }
  });

  app.post<{ Params: { project: string } }>("/v1/bots/code/flow/:project/approve", RL, async (req, reply) => {
    const s = await who(req, reply);
    const id = s && projectOf(reply, req.params.project);
    if (!s || !id) return reply;
    const b = bodyOf(req.body);
    const threadId = String(b.thread ?? ""), v = Number(b.v);
    if (!UUID.test(threadId) || !Number.isInteger(v)) return reply.code(400).send({ code: "bad_request", message: "Approve a plan of this chat, by its version." });
    try {
      const t = await threadOf(s.user.id, id, threadId);
      const plan = t?.plan;
      if (!plan || plan.v !== v) return reply.code(409).send({ code: "plan_changed", message: "The plan changed since. Look at the new one first." });
      if (plan.status !== "proposed") return reply.send({ plan, job: await jobOf(req, plan.jobId) });
      const owner = (await gateFor(req, id)).owner;
      const running = await jobOf(req, plan.jobId);
      let jobId: string;
      if (running && !ENDED.has(running.job.state)) {
        // A change agreed while the work goes on: the job is told its new plan, and carries on from it.
        await inner(req, "POST", `/v1/code/jobs/${running.job.id}/message`, { text: approvedNote(plan) });
        jobId = running.job.id;
      } else {
        const task = planTask(plan, { ...(owner?.keep ? { keep: owner.keep } : {}) });
        // The project's own cap on a job's spend, when one is set (a store that can't be read is no cap: the job's default holds).
        const cap = await Promise.resolve().then(() => codeRulesStore().cap(s.user.id, id)).catch(() => null);
        if (plan.mockup) {
          // A plan with its mockup: built from the design (in the project's look, checked against it), and told the plan it serves.
          const built = await inner<{ job: { id: string; branch: string } }>(req, "POST", `/v1/artifacts/${plan.mockup}/build`, { projectId: id, ...(cap ? { budgetPaise: cap } : {}) });
          jobId = built.job.id;
          await inner(req, "POST", `/v1/code/jobs/${jobId}/message`, { text: task }).catch(() => undefined);
          t!.jobs = [...(t!.jobs ?? []), { id: jobId, branch: built.job.branch, at: now() }].slice(-3);
        } else {
          const branch = (await inner<{ branch: string }>(req, "POST", `/v1/code/projects/${id}/branches`, { task: plan.goal })).branch;
          // The plan was approved here: the job does not stop to ask for it again.
          const made = await inner<{ job: { id: string } }>(req, "POST", "/v1/code/jobs", { projectId: id, branch, task, planFirst: false, ...(cap ? { budgetPaise: cap } : {}) });
          jobId = made.job.id;
          t!.jobs = [...(t!.jobs ?? []), { id: jobId, branch, at: now() }].slice(-3);
        }
      }
      const next: ProjectPlan = { ...plan, status: "working", jobId, at: now() };
      await threads().put({ ...t!, plan: next, updatedAt: now() });
      return reply.send({ plan: next, job: await jobOf(req, jobId) });
    } catch (err) { return done(reply, err); }
  });

  // ------------------------------------------------------------------ while the work goes on

  app.post<{ Params: { project: string } }>("/v1/bots/code/flow/:project/work", RL, async (req, reply) => {
    const s = await who(req, reply);
    const id = s && projectOf(reply, req.params.project);
    if (!s || !id) return reply;
    const b = bodyOf(req.body);
    const threadId = String(b.thread ?? ""), said = text(b.text, 2000);
    const attachments = Array.isArray(b.attachments) ? b.attachments.slice(0, 4) : [];
    if (!UUID.test(threadId) || (!said && !attachments.length)) return reply.code(400).send({ code: "bad_request", message: "Say something, or send a picture." });
    try {
      const t = await threadOf(s.user.id, id, threadId);
      const { plan, job } = await current(req, t?.plan);
      if (!plan || !job || ENDED.has(job.job.state)) return reply.code(409).send({ code: "no_work", message: "Nothing is being worked on in this chat right now." });
      // A picture is read first (the ask road's own picture reader), so it is judged with the words.
      const picture = await pictureOf(req, attachments);
      const doing = job.agent?.doing ?? (job.agent?.phase ? `In the ${job.agent.phase} step` : job.job.state);
      const owner = (await gateFor(req, id)).owner;
      const judged = await triage(model(s.user.id), { plan, doing, message: said, ...(picture ? { picture } : {}), ...(owner?.keep ? { keep: owner.keep } : {}) }, now());
      const note = jobNote(judged, said || "(a picture)", picture || undefined);
      if (note) await inner(req, "POST", `/v1/code/jobs/${job.job.id}/message`, { text: note });
      if (judged.kind === "change" && judged.plan) {
        // The new version waits for a yes; the job keeps its id, so the yes tells it rather than starting another.
        await threads().put({ ...t!, plan: { ...judged.plan, jobId: job.job.id }, updatedAt: now() });
      }
      let artifact: string | undefined;
      // Asked to see something: a mockup beside the work, which goes on.
      if (judged.kind === "mockup") artifact = await mockupOf(req, id, said);
      await keepTurn(s.user.id, id, threadId, said || "(a picture)", judged.say + (judged.kind === "change" ? " Approve the new plan below." : ""));
      return reply.send({
        kind: judged.kind, say: judged.say, ...(judged.plan ? { plan: { ...judged.plan, jobId: job.job.id } } : {}),
        ...(judged.affects.length ? { affects: judged.affects } : {}), ...(artifact ? { artifact } : {}), ...(judged.kind === "stop" ? { stop: job.job.id } : {}),
      });
    } catch (err) { return done(reply, err); }
  });
}

/** The chat's own loop, without its start_job: it answers, reads the code, and says how a change could be made, but makes none. */
function converseAnswer(code: NonNullable<BotsAreaDeps["code"]>, o: { call?: CallFn }, threads: () => ThreadStore): FlowAnswer {
  return async (a) => {
    if (!code.github || !code.brain) throw new Inner(404, { code: "brain_off", message: "The project brain isn't switched on." });
    const chat = new CodeChat({
      projects: { store: code.store, github: code.github, approvals: code.approvals, oauth: code.oauth }, brain: code.brain,
      ...(o.call ? { call: o.call } : {}), threads: threads(),
      ...(code.copies ? { copies: code.copies, fillCopy: (userId: string, project: CodeProject) => code.brain!.keepCopy(userId, project) } : {}),
    });
    const r = await chat.converse({ userId: a.userId, projectId: a.projectId, question: a.text, threadId: a.threadId, tier: "cheap", length: "medium", diagram: false, maxPaise: ANSWER_PAISE });
    return { text: r.text, next: r.next };
  };
}

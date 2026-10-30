/**
 * THE ROADS A MESSAGE CAN TAKE, AS HANDLERS: WHAT dispatch() CALLS.
 *
 * Each road is one function with a plain input and a plain output, so dispatch.ts is the same whether a road is the real thing or a fake:
 *
 *   reply        the main assistant's reply, or the cheap fallback reply role (front_reply). No callable chat entry of the main assistant
 *                fits (its Ask planner acts on screens and connected apps and answers a device in events; it is left as it is), so the
 *                default is the fallback, and `assistant` is the seam where one can be put
 *   codeAnswer   a question about a project, answered from its brain: locate where, read a few excerpts, ask a cheap role. A stub for the
 *                code-question work that follows: the hook is `codeAnswer`, and nothing else in the front door depends on how it answers
 *   codeJob      a Xode job on a new work branch (the same three calls "build it" makes), driven by the agent loop
 *   research     web/research.ts through Xode's web tools, held to the job-less budget and the person's daily research runs
 *   plan         steps and a timeline: in a project, the work core's own plan (locate, then planChange); otherwise the front_plan role.
 *                A plan's diagram is drawn from its steps by code, so it costs nothing
 *   artifact     a visual made by the artifact core: a mermaid diagram (front_diagram, the cheap tier), a chart or a page (the service's
 *                `generate`), or a project-styled component (componentArtifact)
 *
 * The defaults are built from what the server has (defaultHandlers); a road whose part is not switched on answers FrontError with the
 * reason in words, never silence. Nothing here logs what was sent or received.
 */
import type { Artifacts } from "../artifacts/index.js";
import { CodeChat } from "../code/chat/index.js";
import type { ThreadStore } from "../code/chat/threads.js";
import type { LiveFiles } from "../code/live/ports.js";
import { componentArtifact, workspaceFiles } from "../artifacts/kit.js";
import { unfence } from "../artifacts/edit.js";
import { CAP_PAISE, isArtifactError, type Change } from "../artifacts/types.js";
import { validateArtifact } from "../artifacts/validate.js";
import type { AgentOrchestrator } from "../code/agent/orchestrator.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import type { Code } from "../code/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import { assertAccess, createWorkBranch, ownProject, workspace, type ProjectDeps } from "../code/projects.js";
import { makeWebTools, ResearchLimit, type WebTools, type WebToolDeps } from "../code/webTools.js";
import { locate } from "../code/work/locate.js";
import { askJson, fence, forModel, type CallFn, type ModelCtx } from "../code/work/model.js";
import { planChange } from "../code/work/plan.js";
import { askText, type FrontModel } from "./model.js";
import { REPLY_TOKENS } from "./path.js";
import { chartable, makeDataArtifact } from "../media/dataartifact.js";
import type { DataTable } from "../media/types.js";
import type { ReadFile } from "./attachments.js";
import { z } from "zod";
import { FrontError, type ArtifactRef, type Decision, type FrontCtx, type FrontResult, type ResearchDepth, type VisualPlan } from "./types.js";

/** What a road is handed. */
export interface RouteCall {
  userId: string;
  /** The person's words. For a short follow-up, the earlier turn's words are in front of them. */
  message: string;
  /** The person's words alone, whatever was put in front of them. */
  said?: string;
  ctx: FrontCtx;
  decision: Decision;
  signal?: AbortSignal;
  /** The most this road may spend, in paise: the gateway refuses a call whose worst case would pass it. */
  maxPaise: number;
  /** A road that streams calls this with each piece of text as it is written. */
  onText?: (piece: string) => void;
  /** The pieces sent so far are void (a streamed model failed; the next starts over). */
  onReset?: () => void;
  /** What it is doing now, as a stage word ("code:read:src/cart.ts"): for the line under the carrying bot. */
  onStep?: (stage: string) => void;
}

export interface TextOut { text: string; paise: number }

export interface PlanOut extends TextOut {
  /** The plan as Mermaid text, drawn from its steps. */
  diagram?: string;
}

export interface CodeAnswerOut extends TextOut {
  notes?: string[];
  /** The flow the answer is about, as Mermaid text drawn from the project's import graph (no model made it). */
  diagram?: string;
}

export interface Handlers {
  reply(c: RouteCall & { files: ReadFile[] }): Promise<TextOut>;
  codeAnswer(c: RouteCall): Promise<CodeAnswerOut>;
  codeJob(c: RouteCall): Promise<{ job: NonNullable<FrontResult["job"]>; paise: number }>;
  research(c: RouteCall & { depth: ResearchDepth }): Promise<TextOut & { sources: NonNullable<FrontResult["sources"]>; confidence: number; partial?: boolean; gaps: string[] }>;
  plan(c: RouteCall): Promise<PlanOut>;
  /**
   * Makes the visual. `basis` is the answer it illustrates; `mermaid` is a diagram already drawn (a plan's), to be kept as it is; `data` is the rows of
   * a spreadsheet the message is about, from which a chart is written by code (media/dataartifact.ts), with no model and no cost.
   */
  artifact(c: RouteCall & { visual: VisualPlan; basis?: string; mermaid?: string; data?: DataTable }): Promise<{ artifact: ArtifactRef; paise: number; notes?: string[] }>;
}

export interface HandlerDeps {
  call?: CallFn;
  gateway?: GatewayDeps;
  artifacts?: Artifacts | null;
  code?: Code | null;
  jobs?: JobRouter | null;
  agent?: AgentOrchestrator | null;
  /** The main assistant's reply, if there is one that fits: used for chat and answers that carry no shape of ours. */
  assistant?: (c: RouteCall) => Promise<TextOut>;
  /** makeWebTools, or a stand-in. */
  web?: (d: WebToolDeps) => WebTools;
  /** Talking about code (code/chat): made from `code` when not given. */
  chat?: CodeChat;
  /** Where a project chat thread's rolling summary is kept (migration 0034); the process's own when not given. */
  threads?: ThreadStore;
  /** The job's copy of the code for the person's open job on a project, if any: a question is then answered with read and grep from it instead of GitHub reads. */
  rooms?: (userId: string, projectId: string) => Promise<Pick<LiveFiles, "read" | "grep"> | null>;
}

/** A road's words streamed as the model writes them, when the caller listens: what to hand the model call, and whether any were sent. */
function streamed(c: RouteCall): { ask: { onText?: (piece: string) => void; onReset?: () => void }; sent(): boolean } {
  let sent = false;
  if (!c.onText) return { ask: {}, sent: () => false };
  const onText = c.onText;
  return {
    ask: { onText: (piece) => { sent = true; onText(piece); }, onReset: () => { sent = false; c.onReset?.(); } },
    sent: () => sent,
  };
}

const model = (d: HandlerDeps, c: RouteCall): FrontModel => ({ ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId: c.userId, ...(c.signal ? { signal: c.signal } : {}) });
const ctxOf = (d: HandlerDeps, c: RouteCall, maxPaise: number): ModelCtx => ({ ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId: c.userId, budget: { maxPaise }, ...(c.signal ? { signal: c.signal } : {}) });
const esc = (s: string): string => s.replace(/["<>\n]/g, " ").slice(0, 120);
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ------------------------------------------------------------------ reply

/** The shape the reply role is told: its length, whether to lead with a table, and whether it will be read out. */
export function replyUser(c: Pick<RouteCall, "message" | "ctx" | "decision">, files: readonly ReadFile[]): string {
  const v = c.decision.shape.visual;
  const table = v?.kind === "table" && v.via === "inline" && !v.offer;
  const recent = c.message.trim().split(/\s+/).length <= 8 && c.ctx.recent.length
    ? `\nRecent:\n${c.ctx.recent.slice(-3).map((t) => `- "${cut(forModel(t.said).replace(/\s+/g, " "), 120)}"`).join("\n")}` : "";
  return [
    `<shape length="${c.decision.shape.length}" visual="${table ? "table" : "none"}"/>`,
    ...(c.ctx.mode === "voice" ? ["Spoken: yes."] : []),
    ...files.map((f) => `<file name="${esc(f.name)}" kind="${f.kind}">\n${fence(f.text)}\n</file>`),
    ...(recent ? [recent.trim()] : []),
    "",
    `Message:\n<<<\n${forModel(c.message).replace(/>>>/g, "> > >")}\n>>>`,
  ].join("\n");
}

async function replyDefault(d: HandlerDeps, c: RouteCall & { files: ReadFile[] }): Promise<TextOut> {
  // The main assistant's own reply, when one is plugged in and the message has no shape of ours to follow (no table, no file).
  if (d.assistant && !c.files.length && !(c.decision.shape.visual?.kind === "table" && c.decision.shape.visual.via === "inline" && !c.decision.shape.visual.offer)) {
    return d.assistant(c);
  }
  const tier = c.decision.tier === "vision" ? "cheap" : c.decision.tier;
  const words = streamed(c);
  const r = await askText(model(d, c), {
    role: "front_reply", tier, purpose: "front.reply", user: replyUser(c, c.files), maxTokens: REPLY_TOKENS[c.decision.shape.length], budget: { maxPaise: c.maxPaise },
    ...words.ask,
  });
  if (!words.sent()) c.onText?.(r.text);
  return { text: r.text, paise: r.paise };
}

// ------------------------------------------------------------------ code

const projectDeps = (code: Code): ProjectDeps => ({ store: code.store, github: code.github!, approvals: code.approvals, oauth: code.oauth });

function needCode(d: HandlerDeps, c: RouteCall): { code: Code; pd: ProjectDeps; projectId: string } {
  const code = d.code;
  if (!code) throw new FrontError("code_off", "Xode is not switched on.", 404);
  if (!code.github) throw new FrontError("not_configured", "GitHub isn't set up on this server yet.", 503);
  if (!c.ctx.projectId) throw new FrontError("no_project", "Pick a project first.", 400);
  return { code, pd: projectDeps(code), projectId: c.ctx.projectId };
}

function chatOf(d: HandlerDeps, c: RouteCall): { chat: CodeChat; projectId: string } {
  const { code, pd, projectId } = needCode(d, c);
  if (!code.brain) throw new FrontError("brain_off", "The project brain isn't switched on.", 404);
  return {
    projectId,
    chat: d.chat ?? new CodeChat({
      projects: pd, brain: code.brain, ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), ...(d.threads ? { threads: d.threads } : {}),
      ...(d.rooms ? { rooms: d.rooms } : {}),
    }),
  };
}

/** A question about the project's code: the brain's facts first, a few reads only when it must, every claim with path:line (code/chat, docs/code-chat.md). */
async function codeAnswerDefault(d: HandlerDeps, c: RouteCall): Promise<CodeAnswerOut> {
  const { chat, projectId } = chatOf(d, c);
  const v = c.decision.shape.visual;
  const words = streamed(c);
  const out = await chat.answer({
    userId: c.userId, projectId, question: c.said ?? c.message, ...(c.ctx.threadId ? { threadId: c.ctx.threadId } : {}),
    ...(c.decision.followUp ? { context: c.decision.followUp } : {}), tier: c.decision.tier === "vision" ? "cheap" : c.decision.tier, length: c.decision.shape.length,
    diagram: !!v && v.kind === "diagram" && !v.offer && v.via === "artifact", maxPaise: c.maxPaise, ...(c.signal ? { signal: c.signal } : {}),
    ...words.ask, ...(c.onStep ? { onStep: c.onStep } : {}),
  });
  if (!words.sent()) c.onText?.(out.text);
  return { text: out.text, paise: out.paise, ...(out.notes.length ? { notes: out.notes } : {}), ...(out.diagram ? { diagram: out.diagram } : {}) };
}

async function codeJobDefault(d: HandlerDeps, c: RouteCall): Promise<{ job: NonNullable<FrontResult["job"]>; paise: number }> {
  const { pd, projectId } = needCode(d, c);
  if (!d.jobs) throw new FrontError("not_configured", "GitHub isn't set up on this server yet.", 503);
  if (!d.agent) throw new FrontError("agent_off", "Xode's agent is not switched on on this server.", 404);
  const project = await ownProject(pd, c.userId, projectId);
  await assertAccess(pd, c.userId, project);
  // "Ok, change it" after a talk about the code: the job starts with the place the conversation found, and does not look for it again.
  let task = c.message.slice(0, 20_000);
  let opts: Parameters<AgentOrchestrator["enqueue"]>[2] = {};
  if (c.decision.handoff && c.ctx.threadId && d.code?.brain) {
    const handed = await chatOf(d, c).chat.handoff(c.userId, project.id, c.ctx.threadId, c.said ?? c.message);
    if (handed) { task = handed.task.slice(0, 20_000); opts = { located: handed.located, locatedFrom: "chat" }; }
  }
  if (c.decision.mode === "freeform") opts = { ...opts, mode: "freeform" };
  if (c.decision.team) opts = { ...opts, team: c.decision.team };
  const { branch } = await createWorkBranch(pd, c.userId, project.id, c.said ?? c.message);
  const job = await d.jobs.createJob(c.userId, project.id, branch, task, c.maxPaise, { agent: true });
  const made = await d.agent.enqueue(job.id, task, opts);
  return { job: { id: job.id, branch, state: (made ?? job).state, budgetPaise: c.maxPaise }, paise: 0 };
}

// ------------------------------------------------------------------ research

async function researchDefault(d: HandlerDeps, c: RouteCall & { depth: ResearchDepth }) {
  const web = (d.web ?? makeWebTools)({
    userId: c.userId, budget: { maxPaise: c.maxPaise }, ...(c.signal ? { signal: c.signal } : {}), ...(d.call ? { call: d.call as never } : {}), ...(d.gateway ? { gateway: d.gateway } : {}),
  });
  try {
    const r = await web.research(forModel(c.message), c.depth);
    await web.settled();
    c.onText?.(r.answer);
    // The sources the answer cites; all of them when it cites none (the person can then see what it was drawn from).
    const cited = r.sources.filter((s) => s.cited);
    return {
      text: r.answer, paise: r.spentPaise ?? 0, sources: (cited.length ? cited : r.sources).map((s) => ({ n: s.n, title: s.title, url: s.url })),
      confidence: r.confidence, gaps: r.gaps, ...(r.partial ? { partial: true } : {}),
    };
  } catch (err) {
    if (err instanceof ResearchLimit) throw new FrontError("research_limit", `You have used today's ${err.cap} research runs. A normal answer still works; research starts again tomorrow.`, 429);
    throw err;
  }
}

// ------------------------------------------------------------------ plan

/** What the plan role answers with (the contract of front_plan names these fields). */
export const PlanSchema = z.object({
  title: z.string().min(1).max(120),
  steps: z.array(z.object({ do: z.string().min(2).max(300), when: z.string().max(80).nullable().optional() })).min(1).max(12),
  notes: z.array(z.string().max(300)).max(6).optional(),
}).strict();
type PlanShape = z.infer<typeof PlanSchema>;

const label = (s: string): string => cut(s.replace(/["\n\r[\]{}()<>|`]/g, " ").replace(/\s+/g, " ").trim(), 40) || "step";

/** A plan as Mermaid text: its steps in order, so a person sees the shape of it at a glance. Drawn by code, never by a model. */
export function planDiagram(steps: ReadonlyArray<{ do: string; when?: string | null }>): string {
  const nodes = steps.slice(0, 12).map((s, i) => `  S${i + 1}["${i + 1}. ${label(s.do)}${s.when ? `<br/>${label(s.when)}` : ""}"]`);
  const edges = steps.slice(0, 12).map((_, i) => (i === 0 ? "" : `  S${i} --> S${i + 1}`)).filter(Boolean);
  return ["flowchart TD", ...nodes, ...edges].join("\n");
}

export function planText(p: PlanShape): string {
  return [`**${p.title}**`, "", ...p.steps.map((s, i) => `${i + 1}. ${s.do}${s.when ? ` (${s.when})` : ""}`), ...(p.notes?.length ? ["", ...p.notes.map((n) => `- ${n}`)] : [])].join("\n");
}

async function planDefault(d: HandlerDeps, c: RouteCall): Promise<PlanOut> {
  // In a project that has been read, the work core's own plan: where it goes, what it touches, how to check it.
  if (c.ctx.projectId && d.code?.github && d.code.brain) {
    const { pd, projectId } = needCode(d, c);
    const project = await ownProject(pd, c.userId, projectId);
    const brain = await d.code.brain.open(c.userId, project.id);
    if ((await brain.status()).status !== "none") {
      let ws: Awaited<ReturnType<typeof workspace>> | null = null;
      const read = async (p: string): Promise<string | null> => {
        try { ws ??= await workspace(pd, c.userId, project.id, project.defaultBranch); return (await ws.read(p)).text; } catch { return null; }
      };
      const mctx = ctxOf(d, c, c.maxPaise);
      const located = await locate(c.message, brain, { model: { ...mctx, budget: { maxPaise: Math.min(60, c.maxPaise) } }, read });
      const plan = await planChange(c.message, located, brain, { model: mctx, read });
      const steps = plan.steps.map((s) => ({ do: s.do, when: s.files.length ? `${s.files.length} file${s.files.length === 1 ? "" : "s"}` : null }));
      const text = [
        ...plan.steps.map((s) => `${s.n}. ${s.do}${s.files.length ? ` (${s.files.slice(0, 3).map((f) => f.path).join(", ")}${s.files.length > 3 ? ", …" : ""})` : ""}`),
        "", `Risk: ${plan.risk}${plan.riskReasons.length ? ` (${plan.riskReasons.slice(0, 2).join("; ")})` : ""}.`,
        ...(plan.verify.length ? [`To check it: ${plan.verify.slice(0, 3).map((v) => v.cmd).join("; ")}.`] : []),
        ...plan.notes.slice(0, 3).map((n) => `- ${n}`),
      ].join("\n");
      c.onText?.(text);
      return { text, paise: plan.paise + located.used.paise, diagram: planDiagram(steps) };
    }
  }
  const r = await askJson(ctxOf(d, c, c.maxPaise), {
    tier: c.decision.tier === "vision" ? "cheap" : c.decision.tier, purpose: "front.plan", role: "front_plan", schema: PlanSchema, maxTokens: 900,
    user: `Request:\n<<<\n${forModel(c.message).replace(/>>>/g, "> > >")}\n>>>`,
  });
  if (!r.ok) {
    if (r.reason === "budget") throw new FrontError("budget", "That would cost more than one message may. Ask for less.", 402);
    if (r.reason === "aborted") throw Object.assign(new Error("aborted"), { name: "AbortError" });
    throw new FrontError("model_down", "No model could be reached just now. Try again in a moment.", 503);
  }
  const text = planText(r.value);
  c.onText?.(text);
  return { text, paise: r.paise, diagram: planDiagram(r.value.steps) };
}

// ------------------------------------------------------------------ artifacts

const refOf = (c: Change, kind: ArtifactRef["kind"], paise: number): ArtifactRef => ({ id: c.artifact.id, type: c.artifact.type, title: c.artifact.title, version: c.version, kind, paise });

function needService(d: HandlerDeps) {
  const service = d.artifacts?.service;
  if (!service) throw new FrontError("artifacts_off", "Artifacts are not switched on.", 404);
  return service;
}

/** A diagram from an answer: the cheap tier writes Mermaid, the artifact core checks and keeps it. */
async function diagramFrom(d: HandlerDeps, c: RouteCall, basis: string): Promise<{ artifact: ArtifactRef; paise: number }> {
  const service = needService(d);
  const ran = await service.model.run<string>({
    userId: c.userId, tier: "cheap", purpose: "front.diagram", role: "front_diagram", artifact: `<answer>\n${fence(forModel(cut(basis, 3_000)))}\n</answer>`, instruction: "",
    maxTokens: 700, capPaise: Math.min(CAP_PAISE.cheap, c.maxPaise), noClimb: true, ...(c.signal ? { signal: c.signal } : {}),
    accept: (t) => {
      const content = unfence(t);
      const checked = validateArtifact({ type: "mermaid", content });
      return checked.ok ? { ok: true, value: content } : { ok: false, reason: checked.errors.join(" ") };
    },
  });
  const made = await service.create(c.userId, { type: "mermaid", title: cut(c.message.replace(/\s+/g, " ").trim(), 60) || "Diagram", content: ran.value, projectId: c.ctx.projectId ?? null, madeBy: "bot", note: "Diagram of an answer" });
  await service.spend(made.artifact.id, ran.paise);
  return { artifact: refOf(made, "diagram", ran.paise), paise: ran.paise };
}

async function componentDefault(d: HandlerDeps, c: RouteCall): Promise<{ artifact: ArtifactRef; paise: number; notes?: string[] }> {
  const service = needService(d);
  const projectId = c.ctx.projectId;
  const code = d.code;
  // No project to be in the style of, or one that has not been read: a page, and the person is told which it is.
  const page = async (why: string) => {
    const made = await service.generate(c.userId, { request: c.message, type: "html", ...(projectId ? { projectId } : {}), ...(c.signal ? { signal: c.signal } : {}) });
    return { artifact: refOf(made, "page", made.paise), paise: made.paise, notes: [why] };
  };
  if (!projectId || !code?.github || !code.brain) return page("There is no project to match, so this is a page, not a component in a project's style.");
  const pd = projectDeps(code);
  const project = await ownProject(pd, c.userId, projectId);
  const brain = await code.brain.open(c.userId, project.id);
  if ((await brain.status()).status === "none") return page("X0 Bot hasn't read this project yet, so this is a page, not a component in its style.");
  const ws = await workspace(pd, c.userId, project.id, project.defaultBranch);
  const r = await componentArtifact(
    { service, kit: { store: service.store, files: workspaceFiles(ws), brain }, brain, call: d.call ?? code.brain.runtime.call, gateway: d.gateway ?? code.brain.runtime.gateway },
    { id: project.id, userId: c.userId, name: project.fullName }, c.message, { ...(c.signal ? { signal: c.signal } : {}) },
  );
  const paise = r.paise.vision + r.paise.locate + r.paise.make;
  return { artifact: refOf(r.change, "component", paise), paise };
}

async function artifactDefault(d: HandlerDeps, c: RouteCall & { visual: VisualPlan; basis?: string; mermaid?: string; data?: DataTable }) {
  const service = needService(d);
  try {
    if (c.mermaid) {
      const made = await service.create(c.userId, { type: "mermaid", title: cut(c.message.replace(/\s+/g, " ").trim(), 60) || "Plan", content: c.mermaid, projectId: c.ctx.projectId ?? null, madeBy: "bot", note: "Diagram of a plan" });
      return { artifact: refOf(made, "diagram", 0), paise: 0 };
    }
    switch (c.visual.kind) {
      case "diagram": return await diagramFrom(d, c, c.basis || c.message);
      case "chart": {
        if (c.data && chartable(c.data)) {
          const r = await makeDataArtifact(service, c.userId, c.data, "chart", c.ctx.projectId ? { projectId: c.ctx.projectId } : {});
          return { artifact: refOf(r.change, "chart", 0), paise: 0 };
        }
        const made = await service.generate(c.userId, { request: `A chart (use recharts) of the numbers in this: ${c.message}`, type: "react", ...(c.ctx.projectId ? { projectId: c.ctx.projectId } : {}), ...(c.signal ? { signal: c.signal } : {}) });
        return { artifact: refOf(made, "chart", made.paise), paise: made.paise };
      }
      case "page": {
        const made = await service.generate(c.userId, { request: c.message, type: "html", ...(c.ctx.projectId ? { projectId: c.ctx.projectId } : {}), ...(c.signal ? { signal: c.signal } : {}) });
        return { artifact: refOf(made, "page", made.paise), paise: made.paise };
      }
      case "component": return await componentDefault(d, c);
      default: throw new FrontError("bad_visual", "A table is part of the reply, not an artifact.", 500);
    }
  } catch (err) {
    // The artifact core's refusals are written for a person (a limit reached, a secret, a model that is down): they pass as FrontError.
    if (isArtifactError(err)) throw new FrontError(err.code, err.message, err.status);
    throw err;
  }
}

// ------------------------------------------------------------------ the defaults

/** The roads as the server has them. A road whose part is off answers FrontError, with the reason. */
export function defaultHandlers(d: HandlerDeps = {}): Handlers {
  return {
    reply: (c) => replyDefault(d, c),
    codeAnswer: (c) => codeAnswerDefault(d, c),
    codeJob: (c) => codeJobDefault(d, c),
    research: (c) => researchDefault(d, c),
    plan: (c) => planDefault(d, c),
    artifact: (c) => artifactDefault(d, c),
  };
}

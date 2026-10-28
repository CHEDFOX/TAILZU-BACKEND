/**
 * RUNNING ONE TASK THROUGH THE WHOLE FLOW, AND WRITING DOWN EVERYTHING THAT HAPPENED.
 *
 * `runTask(task, opts)` puts the task's project on a fresh rig, asks the front door what the request is, makes the job the way the product does
 * (a work branch, an agent job, the orchestrator), then plays the PERSON until the job ends: it answers the bot's questions the way the task's
 * scenario says, says yes to the plans and commits that ask, adds money once if the scenario has the money run out, sends a word mid-task, and cuts
 * the power to the server (a second one takes the job over). The result is a RunTrace: facts only, nothing judged. Scoring is score/index.ts.
 *
 * Nothing in the trace is a model's opinion of itself; the report text is kept because the scorer reads it, and so are the commands the bot ran.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { decide } from "../src/front/decide.js";
import { AttachmentRegistry, sha256Of } from "../src/front/attachments.js";
import type { Intent as FrontIntent } from "../src/front/types.js";
import type { AgentState, JobMode } from "../src/code/agent/types.js";
import { isEnded, type CodeJob } from "../src/code/jobs/types.js";
import type { WorkEntry } from "../src/code/work/worklogStore.js";
import { buildProjectBrain } from "../src/code/project/index.js";
import { createRig, USER, type Rig, type RigOptions } from "./adapters/rig.js";
import type { CallLog, ModelMode } from "./adapters/models.js";
import type { Persona } from "./adapters/personas.js";
import type { RunnerRecord } from "./adapters/localRunner.js";
import type { PullRecord } from "./adapters/localGithub.js";
import type { Task } from "./tasks/schema.js";
import { IMAGES_DIR, sleep } from "./util.js";

export interface FrontRecord {
  intent: string;
  route: string;
  confidence: number;
  via: string;
  clarify: boolean;
  expected: string[];
  ok: boolean;
  ms: number;
  paise: number;
  error?: string;
}

export interface Question { at: number; kind: "answer" | "approval" | "budget" | "commit"; from: string; text: string; options?: string[]; answer?: string }

export interface ToolEvent { name: string; brief: string; ok: boolean | null; at: number }

export interface RunTrace {
  taskId: string;
  mode: ModelMode;
  persona: string | null;
  repeat: number;
  startedAt: number;
  endedAt: number;
  wallMs: number;
  timedOut: boolean;
  crashed: boolean;
  front: FrontRecord | null;
  job: { id: string; state: string; reason: string; spentPaise: number; budgetPaise: number; branch: string; reassignments: number; agentEpoch: number } | null;
  agent: Slim | null;
  questions: Question[];
  calls: CallLog[];
  ledger: { calls: number; paise: number; failedCalls: number };
  runner: RunnerRecord[];
  tools: ToolEvent[];
  workLog: Array<Pick<WorkEntry, "seq" | "at" | "kind" | "text"> & { files?: string[] }>;
  told: Array<{ kind: string; at: number; reason?: string }>;
  gh: {
    baseSha: string;
    branch: string;
    branchHead: string | null;
    defaultHead: string | null;
    defaultMoved: boolean;
    changed: Array<{ status: string; path: string }>;
    commits: Array<{ sha: string; message: string; author: string }>;
    pr: Pick<PullRecord, "number" | "title" | "body" | "draft" | "state" | "head" | "base"> | null;
    writes: number;
    calls: number;
    workflowTouched: boolean;
    secrets: string[];
  };
  notes: string[];
}

/** The agent's state without the person's code in it. */
export interface Slim {
  phase: string;
  classification: AgentState["classification"] | null;
  located: string[];
  locateConfidence: number | null;
  plan: { risk: string; steps: Array<{ do: string; files: string[] }> } | null;
  baseline: unknown;
  verify: unknown;
  fixRounds: number;
  badTurns: number;
  turns: number;
  /** What became of old tool results: mask, summary, hybrid or transcript (agent/mask.ts). */
  strategy: string | null;
  /** How the job was worked: guided (the phases) or freeform. */
  mode: string | null;
  staged: string[];
  commits: string[];
  pr: { number: number; url: string; ready: boolean } | null;
  report: { outcome: string; text: string; prUrl?: string } | null;
  findings: unknown[];
  notes: string[];
  waiting: unknown;
  tiersUsed: string[];
}

const slim = (s: AgentState | null): Slim | null => {
  if (!s) return null;
  const any = s as unknown as Record<string, any>;
  return {
    phase: s.phase, classification: s.classification ?? null,
    // A free-form job has no locate step: where it placed the change is where it found the change belongs (the files it committed or left staged).
    located: s.mode === "freeform" && !(any.located?.targets ?? []).length ? [...new Set([...(s.committedPaths ?? []), ...s.work.staged.map((f) => f.path)])]
      : (any.located?.targets ?? []).map((t: { path: string }) => t.path),
    locateConfidence: any.located?.confidence ?? null,
    plan: s.plan ? { risk: s.plan.risk, steps: s.plan.steps.map((p) => ({ do: p.do, files: p.files.map((f) => `${f.action} ${f.path}`) })) } : null,
    baseline: any.baseline ?? null, verify: s.verify ?? null, fixRounds: s.work.fixRounds, badTurns: s.work.badTurns, turns: s.work.turns, strategy: (s.work as { strategy?: string }).strategy ?? null, mode: s.mode ?? "guided",
    staged: s.work.staged.map((f) => f.path), commits: s.commits, pr: s.pr ? { number: s.pr.number, url: s.pr.url, ready: s.pr.ready } : null,
    report: s.report ? { outcome: s.report.outcome, text: s.report.text, ...(s.report.prUrl ? { prUrl: s.report.prUrl } : {}) } : null,
    findings: s.findings, notes: s.notes, waiting: s.waiting ?? null, tiersUsed: [],
  };
};

export interface RunOptions {
  mode: ModelMode;
  persona?: Persona;
  repeat?: number;
  tiers?: RigOptions["tiers"];
  /** Most paise this run may spend (the job's budget is capped to it). */
  capPaise?: number;
  /** Wall-clock limit, seconds. */
  timeoutSec?: number;
  brainBudgetPaise?: number;
  log?: (s: string) => void;
  rig?: Partial<RigOptions>;
  /** Keep the rig alive for the scorer (the caller disposes it). */
  keepRig?: boolean;
  /** Cassettes for the model calls, and the way a scripted model is made to answer through the gateway. */
  cassette?: RigOptions["cassette"];
  wire?: boolean;
  /** Most work turns the job may take: the run is stopped at the next one. */
  maxTurns?: number;
  /** The most any model call may write. */
  maxTokens?: number;
  /** How the job is worked: "guided" (the phased contestant) or "freeform"; absent, the product's default (free-form). */
  jobMode?: JobMode;
}

export interface RunOutcome { trace: RunTrace; rig: Rig; handle: Awaited<ReturnType<Rig["addProjectFor"]>>; jobId: string | null }

const EXPECTED_INTENTS: Record<string, string[]> = {
  bug: ["code_task"], feature: ["code_task", "design"], refactor: ["code_task"], question: ["code_question", "answer"], ui: ["code_task", "design"],
  vague: ["code_task", "unclear", "code_question", "design", "plan"], hostile: ["code_task", "code_question", "unclear"], broken: ["code_task"],
  long: ["code_task", "plan", "design"], language: ["code_task", "code_question"], disruption: ["code_task"],
};

async function frontDoor(rig: Rig, task: Task, projectId: string): Promise<FrontRecord> {
  const t0 = Date.now();
  // A message with a picture attached is about the picture by design (docs/front-door.md section 6): a screenshot to be turned into a component is
  // the artifacts route's business, so a task with images is also right when the front door calls it a file question.
  const base = task.front ? [task.front.intent] : EXPECTED_INTENTS[task.category] ?? ["code_task"];
  const expected = task.images?.length ? [...base, "file_question"] : base;
  const before = rig.kit.logs.length;
  try {
    const d = await decide(task.request, {
      userId: USER, plan: "paid" as never, device: "desktop", mode: "text", visuals: "off", projectId, recent: [],
      attachments: (task.images ?? []).map((name, i) => ({ id: `img${i}`, kind: "image" as const, mime: "image/png", bytes: 1000, sha256: "0".repeat(64), name })),
    }, { call: rig.kit.call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}) });
    const paise = rig.kit.logs.slice(before).reduce((n, l) => n + l.paise, 0);
    const intent = d.intent as FrontIntent;
    return { intent, route: d.route, confidence: d.confidence, via: d.via, clarify: !!d.clarify, expected, ok: expected.includes(intent) || !!d.clarify && expected.includes("unclear"), ms: Date.now() - t0, paise };
  } catch (err) {
    return { intent: "error", route: "", confidence: 0, via: "none", clarify: false, expected, ok: false, ms: Date.now() - t0, paise: 0, error: (err as Error).message.slice(0, 120) };
  }
}

/** What the person says to a question: the scenario's script, then the task's truth for a "which file" question, then a plain default. */
export function answerTo(task: Task, q: { question: string; options?: string[]; from?: string }): string {
  for (const a of task.scenario?.answers ?? []) if (new RegExp(a.when, "i").test(q.question)) return a.say;
  const opts = q.options ?? [];
  if (opts.length && task.truth.files.length) {
    const hit = opts.find((o) => [...task.truth.files, ...(task.truth.near ?? [])].some((f) => o.includes(f)));
    if (hit) return hit;
  }
  return task.scenario?.default ?? opts[0] ?? "Use your best judgement and keep the change small.";
}

export async function runTask(task: Task, o: RunOptions): Promise<RunOutcome> {
  const log = o.log ?? (() => undefined);
  const sc = task.scenario ?? {};
  const rig = await createRig({
    mode: o.mode, ...(o.persona ? { persona: o.persona } : {}), ...(o.tiers ? { tiers: o.tiers } : {}),
    ...(sc.crash ? { leaseMs: 2500 } : {}), brainBudgetPaise: o.brainBudgetPaise ?? 0, log, ...(o.cassette ? { cassette: { ...o.cassette, run: o.cassette.run ?? task.id } } : {}), ...(o.wire ? { wire: true } : {}), ...(o.maxTokens ? { maxTokensCap: o.maxTokens } : {}), ...(o.rig ?? {}),
  });
  const t0 = Date.now();
  const notes: string[] = [];
  const questions: Question[] = [];
  let timedOut = false;
  let crashed = false;
  let jobId: string | null = null;
  const handle = await rig.addProjectFor(task);
  rig.kit.bind(task, handle.baseTexts);
  Object.assign(rig.pages, sc.pages ?? {});

  const front = await frontDoor(rig, task, handle.project.id);
  log(`front door: ${front.intent} via ${front.via} (${front.confidence})`);

  // The job's budget: the task's, the product's default, and what is left of the run's cap.
  const taskBudget = sc.budget?.paise ?? task.budgetPaise;
  const budgetPaise = taskBudget !== undefined ? (o.capPaise !== undefined ? Math.min(taskBudget, o.capPaise) : taskBudget) : o.capPaise !== undefined ? Math.min(3000, o.capPaise) : undefined;

  // Disruptions are hooks on the model's turns.
  const held: { second: ReturnType<Rig["orchestrator"]> | null } = { second: null };
  const jobIdOf = () => jobId;
  rig.kit.beforeTurn = async (turn) => {
    if (o.maxTurns && turn > o.maxTurns && jobIdOf()) {
      // The cap is the harness's, not the product's (which has its own, and finishes with what is staged): a job stopped here has edits that were never committed.
      const staged = (await rig.stateNow(jobIdOf()!).catch(() => null))?.work.staged.length ?? 0;
      notes.push(`the run was stopped at the ${o.maxTurns}-turn cap${staged ? `, with ${staged} file(s) staged and not committed` : ""}`);
      await rig.orch.stopJob(USER, jobIdOf()!).catch(() => undefined);
      throw new Error(`the ${o.maxTurns}-turn cap of this run was reached${staged ? ` (${staged} staged file(s) were not committed)` : ""}`);
    }
    if (sc.crash && turn === sc.crash.afterTurn + 1 && !crashed) {
      crashed = true;
      rig.orch.crash();
      held.second = rig.orchestrator({ instanceId: "two" });
      throw new Error("the power went");
    }
  };
  rig.kit.afterTurn = async (turn) => {
    if (sc.message && turn === sc.message.afterTurn && jobIdOf()) {
      await rig.orch.message(USER, jobIdOf()!, sc.message.text).catch((e: Error) => notes.push(`message not delivered: ${e.message}`));
      notes.push(`the person said "${sc.message.text.slice(0, 60)}" after turn ${turn}`);
    }
  };

  // The Code job takes text. A picture that came with the request is described once by the vision tier, as the front door does for any attachment, and the
  // description goes with the request. (The product's own way of building from a picture is the artifacts route and an approved design; see the report.)
  let request = task.request;
  const pictures = (task.images ?? []).filter((n) => fs.existsSync(path.join(IMAGES_DIR, n)));
  if (pictures.length) {
    try {
      const inputs = pictures.map((name, i) => {
        const data = fs.readFileSync(path.join(IMAGES_DIR, name));
        return { ref: { id: `img${i}`, kind: "image" as const, mime: "image/png", bytes: data.length, sha256: sha256Of(data), name }, data };
      });
      const read = await new AttachmentRegistry().read(USER, inputs, {
        question: task.request, lang: "en", model: { call: rig.kit.call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}), userId: USER }, budget: { maxPaise: 60 },
      });
      if (read.files.length) request += `\n\n${read.files.map((f) => `[The attached picture ${f.name}, as the vision model described it: ${f.text}]`).join("\n")}`;
      notes.push(`the ${pictures.length} attached picture(s) reached the job as a text description (${read.paise} paise)`);
    } catch (err) { notes.push(`describing the attached picture failed: ${(err as Error).message.slice(0, 100)}`); }
  }

  // A long-horizon task is one job per milestone: after each, the person merges its pull request and asks for the next milestone.
  const jobsN = Math.max(1, sc.milestoneJobs ?? 1);
  let job!: CodeJob;
  let branch = "";
  let lastMerged: string | null = null;
  const jobIds: string[] = [];
  for (let k = 0; k < jobsN; k += 1) {
    let say = request;
    if (k > 0) {
      const prev = await rig.jobNow(job.id);
      if (prev.state !== "done") break;
      const prevState = await rig.stateNow(job.id);
      const pr = handle.repo.pullFor(branch);
      const head = await handle.repo.head(branch);
      if (!head) break;
      await handle.repo.g(["update-ref", `refs/heads/${handle.repo.defaultBranch}`, head]);
      if (pr) { pr.merged = true; pr.state = "closed"; }
      lastMerged = head;
      await buildProjectBrain(rig.code.brain!.runtime, USER, handle.project.id);
      const next = prevState?.newProject?.nextMilestones?.[0];
      say = next ? `Go on with the plan: ${next}` : "Go on with the next milestone of PLAN.md.";
      notes.push(`the person merged milestone ${k} and asked for the next: "${say.slice(0, 80)}"`);
      held.second = null;
    }
    const started = await rig.start(handle, say, { ...(budgetPaise !== undefined ? { budgetPaise } : {}), ...(o.jobMode ? { mode: o.jobMode } : {}) });
    job = started.job;
    branch = started.branch;
    jobId = job.id;
    jobIds.push(job.id);
    log(`job ${job.id} on ${branch}${budgetPaise !== undefined ? ` (budget ${budgetPaise} paise)` : ""}${jobsN > 1 ? ` (milestone job ${k + 1} of ${jobsN})` : ""}`);

    // The person, until the job ends.
    const deadline = Date.now() + (o.timeoutSec ?? sc.timeoutSec ?? (o.mode === "real" ? 900 : 420)) * 1000;
    const handled = new Set<string>();
    let budgetAdded = false;
    let lastTick = 0;
    for (;;) {
      const j = await rig.jobNow(job.id);
      if (isEnded(j.state)) break;
      if (Date.now() > deadline) {
        timedOut = true;
        await rig.orch.stopJob(USER, job.id).catch(() => undefined);
        held.second?.crash();
        notes.push("the task ran out of time and the job was stopped");
        break;
      }
      if (held.second && Date.now() - lastTick > 400) { lastTick = Date.now(); await held.second.tick().catch(() => undefined); }
      if (j.state === "waiting_for_you") {
        const sig = `${j.waitingOn}:${j.updatedAt}`;
        if (!handled.has(sig)) {
          handled.add(sig);
          await respond(rig, task, j, questions, { budgetAdded: () => budgetAdded, addedBudget: () => { budgetAdded = true; }, notes });
        }
      }
      await sleep(60);
    }
    await (held.second ?? rig.orch).idle().catch(() => undefined);
    await rig.orch.idle().catch(() => undefined);
    if (timedOut) break;
  }

  const final = await rig.jobNow(job.id);
  const state = await rig.stateNow(job.id);
  const entries = (await Promise.all(jobIds.map((id) => rig.workLogOf(id).catch(() => [] as WorkEntry[])))).flat();
  const repo = handle.repo;
  const head = await repo.head(branch);
  const defaultHead = await repo.head(repo.defaultBranch);
  const changed = head && handle.baseSha ? await repo.changedFiles(handle.baseSha, head) : [];
  const commits = head && handle.baseSha ? (await repo.log(`${handle.baseSha}..${head}`, 50)).map((c) => ({ sha: c.sha, message: c.message, author: c.author })) : [];
  const pr = repo.pullFor(branch) ?? null;
  const toolEvents: ToolEvent[] = [];
  for (const e of rig.events.filter((x) => jobIds.includes(x.jobId))) {
    if (e.ev.t === "tool") toolEvents.push({ name: e.ev.name, brief: e.ev.brief, ok: null, at: e.ev.at });
    else if (e.ev.t === "result") { const last = [...toolEvents].reverse().find((x) => x.ok === null); if (last) last.ok = e.ev.ok; }
  }
  const spentAll = (await Promise.all(jobIds.map(async (id) => (await rig.jobNow(id)).spentPaise))).reduce((n, x) => n + x, 0);
  const ledgerRows = jobIds.flatMap((id) => rig.kit.ledger.callsOf(USER, `code:${id}`));
  const fx = Number(process.env.CODE_USD_INR) || 88;
  const slimmed = slim(state);
  if (slimmed) slimmed.tiersUsed = [...new Set(rig.kit.logs.filter((l) => l.tier).map((l) => l.tier as string))];
  const trace: RunTrace = {
    taskId: task.id, mode: o.mode, persona: rig.kit.persona?.name ?? null, repeat: o.repeat ?? 1, startedAt: t0, endedAt: Date.now(), wallMs: Date.now() - t0, timedOut, crashed, front,
    job: { id: final.id, state: final.state, reason: final.reason, spentPaise: spentAll, budgetPaise: final.budgetPaise, branch, reassignments: final.reassignments, agentEpoch: final.agentEpoch },
    agent: slimmed, questions, calls: rig.kit.logs.slice(), ledger: { calls: ledgerRows.length, paise: Math.ceil(ledgerRows.reduce((n, r) => n + (r.costUsd ?? 0), 0) * fx), failedCalls: ledgerRows.filter((r) => r.outcome !== "ok").length },
    runner: rig.runner.records.filter((r) => jobIds.includes(r.jobId)), tools: toolEvents,
    workLog: entries.map((e) => ({ seq: e.seq, at: e.at, kind: e.kind, text: e.text, ...(e.files ? { files: e.files } : {}) })),
    told: rig.told.filter((t) => jobIds.includes(t.data.jobId as string)).map((t) => ({ kind: t.kind, at: t.at, ...(t.data.reason ? { reason: t.data.reason } : {}) })),
    gh: {
      baseSha: handle.baseSha, branch, branchHead: head, defaultHead, defaultMoved: !!defaultHead && defaultHead !== handle.baseSha && defaultHead !== lastMerged, changed, commits,
      pr: pr ? { number: pr.number, title: pr.title, body: pr.body, draft: pr.draft, state: pr.state, head: pr.head, base: pr.base } : null,
      writes: rig.gh.writes().length, calls: rig.gh.calls.length, workflowTouched: changed.some((c) => /^\.github\/workflows\//i.test(c.path)), secrets: handle.secrets,
    },
    notes,
  };
  return { trace, rig, handle, jobId };
}

/** The person answers what the job is waiting for. */
async function respond(rig: Rig, task: Task, j: CodeJob, questions: Question[], ctl: { budgetAdded: () => boolean; addedBudget: () => void; notes: string[] }): Promise<void> {
  const sc = task.scenario ?? {};
  const view = await rig.orch.view(USER, j.id).catch(() => null);
  const w = view?.agent?.waiting as { kind?: string; question?: string; options?: string[]; from?: string; for?: string; action?: string } | undefined;
  const at = Date.now();
  try {
    if (j.waitingOn === "answer" && w?.kind === "question") {
      const q = { question: w.question ?? "", ...(w.options ? { options: w.options } : {}), ...(w.from ? { from: w.from } : {}) };
      const say = answerTo(task, q);
      questions.push({ at, kind: "answer", from: w.from ?? "model", text: q.question, ...(w.options ? { options: w.options } : {}), answer: say });
      await rig.orch.answer(USER, j.id, say);
    } else if (j.waitingOn === "approval") {
      questions.push({ at, kind: "approval", from: w?.for ?? "approval", text: w?.action ?? "approval" });
      if (sc.approve === false) { await rig.orch.deny(USER, j.id); return; }
      const asked = await rig.orch.approve(USER, j.id);
      if ("needsApproval" in asked) await rig.orch.approve(USER, j.id, asked.approvalId);
    } else if (j.waitingOn === "budget") {
      questions.push({ at, kind: "budget", from: "money", text: "the budget ran out" });
      if (sc.budget && !ctl.budgetAdded()) { ctl.addedBudget(); await rig.orch.addBudget(USER, j.id, sc.budget.addPaise); }
      else { ctl.notes.push("the budget ran out and the person did not add more"); await rig.orch.stopJob(USER, j.id); }
    } else if (j.waitingOn === "commit") {
      questions.push({ at, kind: "commit", from: "policy", text: "commit what a step made" });
      const asked = await rig.jobs.approveCommit(USER, j.id);
      if ("needsApproval" in asked && asked.needsApproval) await rig.jobs.approveCommit(USER, j.id, (asked as { approvalId: string }).approvalId);
    } else if (j.waitingOn === "paid") {
      await rig.jobs.approvePaid(USER, j.id).catch(() => undefined);
    }
  } catch (err) {
    ctl.notes.push(`answering ${j.waitingOn} failed: ${(err as Error).message.slice(0, 120)}`);
  }
}

/**
 * THE PHASES OF THE AGENT LOOP, EACH ONE A FUNCTION OVER A Run THAT CAN BE ENTERED AGAIN.
 *
 *   prepare   new_project   baseline   locate   plan   work   verify   commit   pr   report
 *
 * A phase reads the state, does its part, writes down what it decided, sets the next phase, and
 * saves. It is entered again after a restart or a wait, so it must find in the state what it had
 * already done and not do it twice: an edit is in the staged changeset, a plan is in `state.plan`, a
 * commit has its message and the commit it was made on (and is looked for on the branch before it is
 * made again), a run has its step (runner.ts adopts it). When a phase needs the person it sets
 * `state.waiting` and throws Park; their answer is written into `waiting` and the same phase runs
 * again and finds it. The driver (loop.ts) calls them in turn; docs/code-agent.md has the picture.
 *
 * WHAT NEVER HAPPENS HERE: a write to the repo other than through the workspace's commit (so the policy,
 * the secret scan, the Blip author and the co-author trailer always apply), a token that can write on a
 * runner, text from a file or the web taken as an instruction (context.ts fences it), and a model call
 * that is not charged to the job (every call carries the job and "job" as its budget).
 */
import { ConnectorError } from "../../connectors/state.js";
import { classifyRequest } from "../brain/classify.js";
import { callModel } from "../brain/gateway.js";
import { planRoute } from "../brain/route.js";
import { recordOutcome } from "../brain/stats.js";
import { tierTable } from "../brain/tiers.js";
import type { ToolCall } from "../brain/types.js";
import { advanceIntake, checksFor, isEmptyRepo, planMilestones, scaffoldStep, type IntakeInput, type StackKind } from "../newproject/index.js";
import {
  ACTIONS, PolicyError, decide, fingerprintOf, gateFree, isWorkflowPath, type ActionId, type Decision, type PolicyCtx,
} from "../policy.js";
import { isSecretPath } from "../project/lang.js";
import type { BaselineKind, BaselineStep } from "../project/types.js";
import { gateBase, repoRef } from "../projects.js";
import { markReady } from "../pulls.js";
import {
  PlanError, compareToBaseline, locate, logComparison, planChange, redactText, worklogMarkdown, type Located,
} from "../work/index.js";
import { cut } from "../work/model.js";
import { checkCommands, parseMarkers, resultsOf, describeCheck, type CheckSpec } from "./checks.js";
import { Refused } from "./changeset.js";
import { getConfig } from "../../config.js";
import { buildContext, digestOf, fold, projectContext } from "./context.js";
import { isStrategy, type ContextStrategy } from "./mask.js";
import { designDue, designLines } from "./design.js";
import { WITHHELD_ARGS, argsHoldSecret } from "./tools.js";
import { SAID_KEEP } from "../live/limits.js";
import { commitMessage, prBody, prTitle, reportText } from "./report.js";
import { BudgetStop, EndJob, LostClaim, Park, Yield, type Run } from "./run.js";
import { hasConflictMarkers } from "./merge.js";
import {
  BASELINE_MAX_AGE_MS, CALLS_PER_TURN, CONTEXT_STRATEGY_DEFAULT, FIX_ROUNDS_MAX, FREEFORM_STEPS_MAX, TURNS_MAX,
  type AgentState, type Exchange, type Phase, type ResultRecord, type VerifyState,
} from "./types.js";
import { GithubRefusal } from "../github.js";

/** Characters a model turn may write. Small, so the budget check's worst case is small too. */
export const WORK_TOKENS = 4096;
/** Turns in a row that came to nothing before the job gives up. */
const BAD_TURNS_MAX = 6;

export const emptyLocated = (): Located => ({ targets: [], related: [], tests: [], confidence: 0, used: { expanded: false, picked: false, paise: 0 } });

const readOrNull = (r: Run) => async (path: string): Promise<string | null> => {
  try { return (await r.ws.read(path)).text; } catch { return null; }
};

// ---------------------------------------------------------------- prepare

export async function prepare(r: Run): Promise<void> {
  const s = r.state;
  await r.log.note("Reading the project and the request.");
  // The brain is brought up to the default branch; if that cannot be done, what there is will do.
  await r.deps.brain.ensureFresh(r.userId, r.projectId).catch(() => undefined);
  r.brain = await r.deps.brain.open(r.userId, r.projectId);
  const empty = await isEmptyRepo(r.brain).catch(() => false);
  const view = await r.brain.status().catch(() => null);
  s.repoEmpty = empty;
  s.classification = await classifyRequest(s.task, { repoEmpty: empty, ...(view?.welcome ? { projectSummary: view.welcome } : {}) }, {
    ...(r.deps.call ? { call: r.deps.call } : {}), ...(r.deps.gateway ? { deps: r.deps.gateway } : {}), jobId: r.jobId, userId: r.userId,
  });
  const type = s.classification.type;
  // A question, a piece of research or a library to find changes nothing: no checks to run first, no plan, just the work of finding out.
  if (type === "question" || type === "research" || type === "find_resource") {
    s.planOk = true;
    s.phase = "work";
  } else s.phase = empty ? "new_project" : "baseline";
  await r.log.decision(`This looks like ${type.replace("_", " ")} (${s.classification.difficulty} difficulty, ${s.classification.risk} risk)${empty ? "; the repo is empty" : ""}.`);
  await r.save();
}

// ---------------------------------------------------------------- baseline

function checkOf(s: BaselineStep): CheckSpec { return { kind: s.kind, cmd: s.cmd, cwd: s.cwd }; }

export async function baseline(r: Run): Promise<void> {
  const s = r.state;
  const d = r.deps.projects;
  const repo = repoRef(d, r.userId, r.project);
  const view = await r.brain.status();
  const rec = view.baseline?.recorded ?? null;
  const defaultHead = await d.github.branchHead(repo, r.project.defaultBranch);
  if (rec && rec.headSha === defaultHead && r.now() - rec.at < BASELINE_MAX_AGE_MS) {
    s.baseline = { status: "recorded", headSha: rec.headSha, results: rec.results.map((x) => ({ ...x })) };
    await r.log.decision(`The project's checks were recorded at ${rec.headSha.slice(0, 7)}: ${rec.healthy ? "everything passed" : "not everything passed"}.`);
  } else {
    const plan = await r.brain.baselinePlan();
    const unknown = (note: string) => {
      s.baseline = { status: "unknown", note };
      r.note(note);
    };
    if (!plan.length) unknown("I found no checks (tests, lint, typecheck, build) to run in this project, so there was nothing to compare against.");
    else if ((await d.github.branchHead(repo, r.branch)) !== defaultHead) {
      unknown("This branch already has commits, so the project's checks could not be measured on the code as it was. I cannot tell what was already broken from what my change breaks.");
    } else {
      await r.log.note("Running the project's own checks before touching anything.");
      const out = await r.runStep("baseline", {
        commands: checkCommands(plan.map(checkOf)), timeoutSec: 900, estimateMinutes: 5, why: "Run the project's checks on the untouched branch",
      });
      if (out.status === "cancelled") throw new LostClaim();
      if (out.status !== "done") {
        unknown(`No computer was free to run the project's checks before I started (${cut(out.reason, 120)}), so I cannot tell what was already broken from what my change breaks.`);
      } else {
        const results = resultsOf(parseMarkers(out.outputTail));
        if (!results.length) unknown("The project's checks ran, but their output could not be read, so I cannot tell what was already broken from what my change breaks.");
        else {
          const clean = results.map(({ output: _output, ...x }) => x);
          await r.deps.brain.recordBaseline(r.projectId, defaultHead, clean).catch(() => undefined);
          s.baseline = { status: "recorded", headSha: defaultHead, results: clean };
          const said = clean.filter((x) => x.kind !== "install").map((x) => `${x.kind} ${x.exitCode === 0 ? "passed" : `failed (${x.failing?.length ? `${x.failing.length} failing` : `exit ${x.exitCode}`})`}`);
          await r.log.decision(`Before any change, the project's checks said: ${said.join(", ") || "nothing to report"}.`);
        }
      }
    }
  }
  s.phase = afterBaseline(s);
  await r.save();
}

/**
 * The phase after the baseline. A guided job locates and plans; a free-form job goes straight to work, because where an open-ended task belongs is what its
 * exploring finds out (it plans only when the person asked to see the plan first); a PR-care job for a conflict merges the default branch in.
 */
export function afterBaseline(s: AgentState): Phase {
  if (s.care?.kind === "conflict") return "merge";
  if (s.mode === "freeform") return s.planFirst ? "plan" : "work";
  return "locate";
}

// ------------------------------------------------------------------ locate

/** The option an answer chose: by its letter, its title, or its path. */
export function pickOption(located: Located | undefined, answer: string): { path?: string; title: string } | null {
  const opts = located?.question?.options ?? [];
  const a = answer.trim();
  const letter = /^\(?([ABC])\)?[\s.:)-]*$/i.exec(a) ?? /^\(?([ABC])\)?[\s.:)-]+\S/i.exec(a);
  if (letter) return opts.find((o) => o.label === letter[1]!.toUpperCase()) ?? null;
  const low = a.toLowerCase();
  return opts.find((o) => (o.path && low.includes(o.path.toLowerCase())) || (o.title && low.includes(o.title.toLowerCase()))) ?? null;
}

export async function locatePhase(r: Run): Promise<void> {
  const s = r.state;
  let task = s.task;
  const w = s.waiting;
  // A job made from an approved design was located when the design was approved (artifacts/build.ts): a sure answer stands, and costs nothing
  // again. One that came with a question (the search was unsure) is looked at the usual way, and the person is asked.
  if ((s.spec || s.handoff) && s.located?.targets.length && !s.located.question && !w) {
    await r.log.read(s.located.targets.slice(0, 3).map((t) => t.path), s.spec ? "Using the place found when the design was approved." : "Using the place found while talking about the code.");
    s.phase = "plan";
    await r.save();
    return;
  }
  if (w?.kind === "question" && w.from === "locate" && w.answer !== undefined) {
    await r.log.question(w.question, w.answer);
    s.waiting = undefined;
    s.locateAsked = true;
    const picked = pickOption(s.located, w.answer);
    if (picked?.path) {
      s.located = { targets: [{ path: picked.path, why: "you pointed at it", signals: [], score: 1 }], related: [], tests: [], confidence: 1, used: { expanded: false, picked: false, paise: 0 } };
      await r.log.decision(`You pointed at ${picked.path}.`);
      s.phase = "plan";
      await r.save();
      return;
    }
    // Words of their own: they go to the search with the request.
    task = `${s.task}\n\nThe person clarified: ${w.answer}`;
  }
  const located = await locate(task, r.brain, { model: r.model(), read: readOrNull(r) });
  if (located.question && !s.locateAsked) {
    s.located = located;
    s.waiting = { kind: "question", from: "locate", question: located.question.text, options: located.question.options.map((o) => `${o.label}: ${o.title}`), at: r.now() };
    throw new Park("answer", cut(located.question.text.split("\n")[0] ?? "Where does this belong?", 160));
  }
  // Asked once is enough: after an answer the best the search found stands.
  s.located = { ...located, question: undefined };
  if (located.targets[0]) await r.log.read(located.targets.slice(0, 3).map((t) => t.path), `Found where it belongs (confidence ${located.confidence.toFixed(2)}).`);
  s.phase = "plan";
  await r.save();
}

// -------------------------------------------------------------------- plan

interface PlanAsk { asking: Decision[]; denied?: string }

/** What the policy would do with the commit this plan leads to: free, a question, or a refusal. Reads the project's standing permissions. */
async function planAsks(r: Run, paths: readonly string[]): Promise<PlanAsk> {
  const grants = await r.deps.projects.store.listGrants(r.project.id);
  const ctx: PolicyCtx = {
    project: r.project, branch: r.branch, defaultBranch: r.project.defaultBranch, attended: true, connection: r.project.linkKind, scopes: [], grants, ownBranch: r.ws.own,
    now: r.now(),
  };
  const actions: ActionId[] = [r.ws.own ? "commit.own_branch" : "commit.other_branch"];
  if (paths.some(isWorkflowPath)) actions.push("workflow.write");
  if (paths.some(isSecretPath)) actions.push("commit.secret");
  const decisions = actions.map((a) => decide(a, ctx));
  const denied = decisions.find((x) => x.effect === "deny");
  if (denied) {
    const full = ACTIONS[denied.action].label;
    const label = full.charAt(0).toLowerCase() + full.slice(1);
    return { asking: [], denied: denied.reason === "denied_by_grant" ? `You told Tailzu not to ${label} in this project, so it won't.` : `Tailzu may not ${label} here (${denied.reason.replace(/_/g, " ")}).` };
  }
  return { asking: decisions.filter((x) => x.effect === "ask") };
}

export async function planPhase(r: Run): Promise<void> {
  const s = r.state;
  const w = s.waiting;
  if (s.plan && w?.kind === "approval" && w.for === "plan") {
    if (w.approved) {
      s.waiting = undefined;
      s.planOk = true;
      await r.log.decision("You approved the plan.");
      s.phase = "work";
      await r.save();
      return;
    }
    throw new LostClaim();
  }
  if (s.plan) {
    s.planOk = true;
    s.phase = "work";
    await r.save();
    return;
  }
  const money = await r.money();
  // A free-form job that is to show its plan first has not located yet: a search, once, that never stops to ask (the plan is what the person is asked about).
  if (s.mode === "freeform" && !s.located) {
    const l = await locate(s.task, r.brain, { model: r.model(), read: readOrNull(r) });
    s.located = { ...l, question: undefined };
  }
  let plan;
  try {
    plan = await planChange(s.task, s.located ?? emptyLocated(), r.brain, {
      model: r.model(), ...(s.classification ? { classification: s.classification } : {}), read: readOrNull(r), exists: (p) => r.tools.exists(p), remainingPaise: money.remaining,
    });
  } catch (err) {
    if (err instanceof PlanError) {
      if (err.code === "budget") throw new BudgetStop(0);
      if (err.code === "aborted") throw new LostClaim();
      throw new EndJob("failed", err.code === "empty" ? `I could not make a plan out of that: ${err.message}` : err.message);
    }
    throw err;
  }
  s.plan = plan;
  for (const st of plan.steps) await r.log.step(st.do, st.files.map((f) => f.path));
  if (plan.notes.length) await r.log.decision(`About the plan: ${plan.notes.slice(0, 3).join(" ")}`);

  const paths = plan.steps.flatMap((st) => st.files.map((f) => f.path));
  const asks = await planAsks(r, paths);
  if (asks.denied) throw new EndJob("failed", asks.denied);
  if (plan.risk === "high" || asks.asking.length || s.planFirst) {
    const top = asks.asking.find((x) => x.faceId) ?? asks.asking[0];
    const action = top?.action ?? "job.plan";
    const approval = r.deps.projects.approvals.issue({
      userId: r.userId, projectId: r.projectId, action, branch: r.branch, fingerprint: fingerprintOf("plan", plan.steps.map((st) => [st.do, st.files])),
    });
    s.waiting = {
      kind: "approval", for: "plan", action, faceId: top?.faceId ?? false, approvalId: approval.id, expiresAt: approval.expiresAt, at: r.now(), bound: approval,
      summary: {
        project: r.project.fullName, branch: r.branch, risk: plan.risk, why: plan.riskReasons.slice(0, 4),
        steps: plan.steps.slice(0, 12).map((st) => ({ n: st.n, do: cut(st.do, 200), files: st.files.map((f) => `${f.action} ${f.path}`) })),
        files: plan.impact.files.slice(0, 30), tests: plan.impact.tests.slice(0, 10),
        needs: asks.asking.map((x) => ({ action: x.action, label: ACTIONS[x.action].label, faceId: x.faceId })),
      },
    };
    const must = plan.risk === "high" || asks.asking.length > 0;
    await r.log.decision(must ? `The plan is ${plan.risk} risk${asks.asking.length ? " and the policy asks about part of it" : ""}, so it waits for your OK.` : "You asked to see the plan first, so it waits for your OK.");
    throw new Park("approval", must
      ? `The plan for this is ${plan.risk} risk${plan.riskReasons[0] ? ` (${cut(plan.riskReasons[0], 100)})` : ""}. It needs your OK before I change anything.`
      : `Here is the plan (${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}, ${plan.risk} risk). You asked to see it first: it needs your OK before I change anything.`);
  }
  s.planOk = true;
  await r.log.decision(`Plan: ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"} touching ${plan.impact.files.length} file${plan.impact.files.length === 1 ? "" : "s"}; risk ${plan.risk}. No OK needed.`);
  s.phase = "work";
  await r.save();
}

// -------------------------------------------------------------------- work

const tiersForTurn = () => {
  const t = tierTable();
  return { ...t, ...Object.fromEntries((["tiny", "cheap", "code", "strong"] as const).map((k) => [k, { ...t[k], maxTokens: Math.min(t[k].maxTokens, WORK_TOKENS) }])) } as typeof t;
};

/** The first lines of the files the search points at, as they are now, for the model's first message. */
async function excerptsOf(r: Run): Promise<string> {
  const out: string[] = [];
  for (const t of (r.state.located?.targets ?? []).slice(0, 3)) {
    const text = await readOrNull(r)(t.path);
    if (text === null) continue;
    const lines = text.split("\n");
    const at = t.lines ? Math.max(1, t.lines[0] - 12) : 1;
    const body = lines.slice(at - 1, at + 39).map((l, i) => `${at + i}: ${l.slice(0, 200)}`).join("\n");
    out.push(`${t.path} (lines ${at}-${Math.min(lines.length, at + 39)} of ${lines.length}):\n${cut(body, 1800)}`);
  }
  return out.join("\n\n");
}

const callOf = (c: Exchange["calls"][number], held?: ReadonlyMap<string, string>): ToolCall => ({ id: c.id, name: c.name, arguments: held?.get(c.id) ?? c.arguments });

/** Carries out the calls of a turn that have no result yet, writing each result into the state as it comes. */
async function executeCalls(r: Run, ex: Exchange): Promise<void> {
  const w = r.state.work;
  const startOk = ex.results.filter((x) => x.ok).length;
  for (let i = ex.results.length; i < ex.calls.length; i += 1) {
    const c = ex.calls[i]!;
    let result: ResultRecord;
    if (w.finished) {
      result = { ok: false, content: "Not run: the work was already finished." };
    } else if (i >= CALLS_PER_TURN) {
      result = { ok: false, content: `Not run: at most ${CALLS_PER_TURN} calls in one turn. Call it again.` };
    } else if (c.name === "ask_user" && r.state.waiting?.kind === "question" && r.state.waiting.from === "model" && r.state.waiting.callId === c.id) {
      // The person has answered what this call asked.
      const q = r.state.waiting;
      if (q.answer === undefined) throw new LostClaim();
      await r.log.question(q.question, q.answer);
      r.state.waiting = undefined;
      result = { ok: true, content: `The person answered: ${q.answer}` };
    } else {
      const out = await r.tools.exec(callOf(c, r.held));
      result = { ok: out.ok, content: out.content, ...(out.data !== undefined ? { data: out.data } : {}), ...(out.label ? { label: out.label } : {}), ...(out.wrapped ? { wrapped: true } : {}) };
      if (out.control?.type === "ask") {
        // The call is answered when the person answers: the turn stays half done, and the job waits.
        r.state.waiting = { kind: "question", from: "model", question: out.control.question, ...(out.control.options ? { options: out.control.options } : {}), callId: c.id, at: r.now() };
        throw new Park("answer", cut(out.control.question, 200));
      }
      if (out.control?.type === "done") {
        w.finished = true;
        w.doneSummary = out.control.summary;
      }
    }
    ex.results.push(result);
    r.held.delete(c.id);
    await r.save();
  }
  const ok = ex.results.filter((x) => x.ok).length - startOk;
  w.badTurns = ok > 0 || w.finished ? 0 : w.badTurns + 1;
  await checkpointStep(r, ex);
}

/**
 * A round of the model's work is done: the staged edits as they stand are kept as a REWIND POINT for this step (agent/rewind.ts), with a line on what the step did and the
 * notes the model is given back if the person goes to it. A point that cannot be kept costs the person that one rewind, never the job.
 */
async function checkpointStep(r: Run, ex: Exchange): Promise<void> {
  const store = r.deps.rewind;
  if (!store) return;
  const w = r.state.work;
  try {
    await store.put(r.jobId, {
      step: w.turns, at: r.now(), note: cut(digestOf(ex).replace(/\s+/g, " "), 280), staged: structuredClone(w.staged), summary: w.summary, digests: [...w.digests, ...w.exchanges.map(digestOf)].slice(-12),
    });
  } catch (err) {
    r.deps.log?.warn({ jobId: r.jobId, error: (err as Error)?.name }, "code agent: a rewind point was not kept");
  }
}

export async function workPhase(r: Run): Promise<void> {
  const s = r.state;
  const w = s.work;
  if (w.roundStartPaise === undefined) {
    w.roundStartPaise = (await r.money()).spent;
    w.roundStartedAt = r.now();
  }
  if (w.excerpts === undefined) {
    w.excerpts = await excerptsOf(r);
    await r.log.note("Starting the work.");
  }
  let rounds = 0;
  for (;;) {
    if (r.signal.aborted) throw new LostClaim();
    // One advance of a Workflow does a few rounds and gives way (every round is saved, so the next picks up exactly here).
    if (r.env.turnsPerAdvance !== undefined && rounds >= r.env.turnsPerAdvance && !w.finished) {
      await r.save();
      throw new Yield();
    }
    rounds += 1;
    // A turn that was half done (a restart, or the person answering a question) is finished first.
    const open = w.exchanges.at(-1);
    if (open && open.results.length < open.calls.length) {
      await executeCalls(r, open);
    } else if (!w.finished) {
      if (w.turns >= (s.mode === "freeform" ? FREEFORM_STEPS_MAX : TURNS_MAX)) {
        w.finished = true;
        w.doneSummary ??= "I reached the most steps one job takes, so I stopped there with what is staged.";
        r.note("I stopped at the most steps one job takes, so the work may be unfinished.");
      } else if (w.badTurns >= BAD_TURNS_MAX) {
        throw new EndJob("failed", "I kept getting nowhere: my last several steps all failed, so I stopped instead of spending your money on more.");
      } else {
        await modelTurn(r);
      }
    }
    if (w.finished) break;
  }
  // A merge is a change even when its resolution leaves the files as the branch has them (keeping this branch's side): the commit has two parents.
  s.phase = r.tools.changes.empty && !s.merge ? "report" : "verify";
  await r.save();
}

/**
 * What the person said while the job worked (POST /v1/code/jobs/:id/message) goes into the state, where the next model turn shows it as
 * their words. It is acknowledged only once it is saved, so a restart between the two shows it again rather than never; the ids keep it
 * from being shown twice.
 */
export async function takeSaid(r: Run): Promise<void> {
  const inbox = r.deps.live?.inbox;
  if (!inbox) return;
  let pending: Awaited<ReturnType<typeof inbox.pending>>;
  try { pending = await inbox.pending(r.jobId); } catch { return; }
  if (!pending.length) return;
  const w = r.state.work;
  const have = new Set((w.said ?? []).map((m) => m.id));
  const fresh = pending.filter((m) => !have.has(m.id));
  if (fresh.length) {
    w.said = [...(w.said ?? []), ...fresh.map((m) => ({ id: m.id, text: m.text, at: m.at }))].slice(-SAID_KEEP);
    for (const m of fresh) await r.log.note(`The person added: ${cut(m.text, 200)}`);
    await r.save();
  }
  await inbox.ack(r.jobId, pending.map((m) => m.id)).catch(() => undefined);
}

/**
 * How this job treats its old tool results, decided once and kept: the agent's `contextStrategy`, else CODE_CONTEXT_STRATEGY, else the default. A job that
 * had already worked under the old way (it has folded notes, or turns behind it, and no strategy written down) goes on as it was: summary.
 */
function strategyOf(r: Run): ContextStrategy {
  const w = r.state.work;
  if (isStrategy(w.strategy)) return w.strategy;
  const configured = r.deps.contextStrategy ?? getConfig().CODE_CONTEXT_STRATEGY ?? CONTEXT_STRATEGY_DEFAULT;
  w.strategy = w.turns > 0 || w.digests.length > 0 || w.summary ? "summary" : configured;
  return w.strategy;
}

async function modelTurn(r: Run): Promise<void> {
  const s = r.state;
  const w = s.work;
  const d = r.deps;
  await r.renew();
  await takeSaid(r);
  const strategy = strategyOf(r);
  await fold(s, r.model(), strategy);
  const install = (await r.brain.baselinePlan().catch(() => [])).find((x) => x.kind === "install")?.cmd;
  const view = await r.brain.status().catch(() => null);
  const rules = (view?.conventions?.rules ?? []).map((x) => `${x.path}:\n${x.text}`).join("\n\n");
  const memory = (await r.brain.memory().catch(() => "")).replace(/\n## Project rules[\s\S]*?(?=\n## |$)/, "");
  const checks = (s.plan?.verify ?? []).map((v) => `${v.kind}: ${v.cmd}`).slice(0, 6);
  const ctx = buildContext({
    strategy, state: s, project: projectContext({ rules, memory, ...(install ? { install } : {}), kind: s.classification ? s.classification.type.replace("_", " ") : "" }),
    tools: r.tools.defs(), stagedLines: r.tools.changes.lines(), checks,
  });
  const money = await r.money();
  const route = await planRoute("write_code", s.classification!, {
    failures: w.badTurns + w.fixRounds, ...(w.lastTier ? { lastTier: w.lastTier as never } : {}), filesTouched: r.tools.changes.size,
  }, { ...(d.routeStats ? { store: d.routeStats } : {}), budget: { remainingPaise: money.remaining, inputChars: ctx.chars }, tiers: tiersForTurn() });
  if (route.stop) throw new BudgetStop(0);

  const call = d.call ?? callModel;
  let res;
  try {
    res = await call({
      tier: route.tier, ...(route.model ? { model: route.model } : {}), messages: ctx.messages, tools: [...r.tools.defs()], toolChoice: "auto",
      purpose: "agent.work", budget: "job", jobId: r.jobId, userId: r.userId, step: w.turns, maxTokens: WORK_TOKENS, signal: r.signal,
    }, d.gateway);
  } catch (err) {
    if ((err as { name?: string })?.name === "ModelUnavailable") {
      w.badTurns += 1;
      r.note("A model could not be reached for one step, so it was tried again.");
      await r.save();
      if (w.badTurns >= 3) throw new EndJob("failed", "No model could be reached just now. Nothing was committed; try again in a little while.");
      await d.sleep(1500);
      return;
    }
    if ((err as { name?: string })?.name === "AbortError") throw new LostClaim();
    throw err;
  }
  w.turns += 1;
  w.lastTier = route.tier;
  w.lastModel = res.model;
  if (d.live?.progress) {
    const spent = await r.money().catch(() => null);
    if (spent) r.progress({ t: "cost", spentPaise: spent.spent, budgetPaise: spent.budget, at: r.now() });
  }
  // What goes into the checkpoint holds no secret: a call whose arguments look like one is kept without them (and refused when it runs).
  const calls = res.toolCalls.map((t, i) => {
    const id = t.id || `call_${w.turns}_${i}`;
    if (!argsHoldSecret(t.arguments)) return { id, name: t.name, arguments: t.arguments };
    r.held.set(id, t.arguments);
    return { id, name: t.name, arguments: WITHHELD_ARGS };
  });
  const ex: Exchange = { text: redactText(res.text.trim(), 4000), calls, results: [], model: res.model };
  w.exchanges.push(ex);
  if (!calls.length) {
    // Words and no tool: once it is nudged; twice and the words are taken as the answer.
    if (w.nudged || !ex.text) {
      w.finished = true;
      w.doneSummary = ex.text || "I had nothing to add.";
    } else {
      w.nudged = true;
      w.badTurns += 1;
    }
    await r.save();
    return;
  }
  w.nudged = false;
  await r.save();
  await executeCalls(r, ex);
}

// ------------------------------------------------------------------ verify

const INSTALL: Partial<Record<StackKind, string>> = {
  next: "npm install", "vite-react": "npm install", "vite-vue": "npm install", "vite-svelte": "npm install", expo: "npm install", fastify: "npm install", express: "npm install",
  flutter: "flutter pub get", fastapi: "python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt", django: "python -m venv .venv && .venv/bin/python -m pip install django",
};

const kindOfCheck = (cmd: string): BaselineKind =>
  /\b(?:tsc|typecheck|analyze|check)\b/.test(cmd) ? "typecheck" : /\blint\b/.test(cmd) ? "lint" : /\bbuild\b/.test(cmd) ? "build" : "test";

/** The checks to run on the staged edits: the plan's, after the project's install; a new project's are its stack's. */
async function verifyChecks(r: Run): Promise<CheckSpec[]> {
  const s = r.state;
  const out: CheckSpec[] = [];
  if (s.newProject?.stackKind) {
    const kind = s.newProject.stackKind as StackKind;
    const install = INSTALL[kind];
    if (install) out.push({ kind: "install", cmd: install, cwd: "" });
    for (const cmd of checksFor(kind)) out.push({ kind: kindOfCheck(cmd), cmd, cwd: "" });
    return out;
  }
  const installs = (await r.brain.baselinePlan().catch(() => [])).filter((x) => x.kind === "install").slice(0, 2).map(checkOf);
  const verify = (s.plan?.verify ?? []).slice(0, 6).map((v) => ({ kind: v.kind, cmd: v.cmd, cwd: v.cwd }));
  if (verify.length) return [...installs, ...verify];
  // A job with no plan to name its checks (free-form, or a merge) is checked by everything the project has: its typecheck, lint, tests and build.
  if (s.mode === "freeform" || s.merge) {
    const all = (await r.brain.baselinePlan().catch(() => [])).filter((x) => x.kind !== "install").slice(0, 6).map(checkOf);
    return all.length ? [...installs, ...all] : [];
  }
  return [];
}

/** A digest of the staged edits: what verify passed, and what the commit checks it is committing. */
export function stagedFingerprint(r: Run): string {
  return fingerprintOf(r.tools.changes.files.map((f) => [f.path, f.content]));
}

/** Runs the checks on the staged edits and compares them to the baseline. Does not change the phase. */
export async function runVerify(r: Run, round: number): Promise<{ v: VerifyState; feedback?: string }> {
  const s = r.state;
  const none = (note: string, ran = false): { v: VerifyState } => ({
    v: { ran, ok: true, summary: note, checks: [], broke: [], alreadyBroken: [], fixed: [], note, round },
  });
  // A merge with a marker still in a file is not a merge: nothing runs on it, and the model is told which file.
  if (s.merge) {
    const left = r.tools.changes.files.filter((f) => f.content !== null && hasConflictMarkers(f.content)).map((f) => f.path);
    if (left.length) {
      const why = `Conflict markers (<<<<<<<, =======, >>>>>>>) are still in ${left.slice(0, 5).join(", ")}. Resolve them before anything is checked.`;
      return { v: { ran: false, ok: false, summary: why, checks: [], broke: left.map((p) => `conflict: ${p}`), alreadyBroken: [], fixed: [], note: why, round }, feedback: why };
    }
  }
  const checks = await verifyChecks(r);
  if (!checks.length) return none("The project has no checks Tailzu could find.");
  let overlay;
  try { overlay = r.tools.changes.toOverlay(); } catch (err) {
    if (err instanceof Refused) return none(err.message);
    throw err;
  }
  await r.log.note(`Running the project's checks on the staged edits (${checks.filter((c) => c.kind !== "install").map((c) => c.kind).join(", ") || "install"}).`);
  const out = await r.runStep(`verify:${round}`, {
    commands: checkCommands(checks), timeoutSec: 900, estimateMinutes: 5, overlay, why: "Run the project's checks on the staged edits",
  });
  if (out.status === "cancelled") throw new LostClaim();
  if (out.status !== "done") return none(`No computer was free to run the checks (${cut(out.reason, 120)}), so this change has not been checked.`);
  const results = resultsOf(parseMarkers(out.outputTail));
  if (!results.length) return none("The checks ran, but their output could not be read, so this change has not been checked.");

  const base = s.baseline?.status === "recorded" ? s.baseline.results ?? [] : null;
  const touched = r.tools.changes.paths();
  const cmdOf = (kind: string) => describeCheck(checks.find((c) => c.kind === kind) ?? { kind: kind as BaselineKind, cmd: kind, cwd: "" });
  const cmp = compareToBaseline(base, results, { touched });
  await logComparison(r.log, cmp, results.map((x) => ({ ...x, cmd: cmdOf(x.kind) })));
  const verdict = new Map(cmp.checks.map((c) => [c.kind, c.status]));
  const v: VerifyState = {
    ran: true, ok: cmp.ok, summary: cmp.summary, round,
    checks: results.filter((x) => x.kind !== "install").map((x) => ({ kind: x.kind, exitCode: x.exitCode, summary: x.summary, failing: x.failing ?? [], status: verdict.get(x.kind) ?? (x.exitCode === 0 ? "passed" : "broke") })),
    broke: cmp.broke.map((f) => (f.name === f.kind ? f.kind : `${f.kind}: ${f.name}`)), alreadyBroken: cmp.alreadyBroken.map((f) => (f.name === f.kind ? f.kind : `${f.kind}: ${f.name}`)),
    fixed: cmp.fixed.map((f) => (f.name === f.kind ? f.kind : `${f.kind}: ${f.name}`)),
  };
  const bad = new Set(cmp.broke.map((f) => f.kind));
  const feedback = cmp.ok ? undefined : [cmp.summary, ...results.filter((x) => bad.has(x.kind)).map((x) => `--- ${x.kind} (exit ${x.exitCode}) ---\n${x.output.slice(-1500)}`)].join("\n");
  return { v, ...(feedback ? { feedback } : {}) };
}

export async function verifyPhase(r: Run): Promise<void> {
  const s = r.state;
  const w = s.work;
  if (r.tools.changes.empty && !s.merge) {
    s.phase = "report";
    await r.save();
    return;
  }
  // Whatever was verified before is not what is staged now until the checks say so again.
  s.verified = undefined;
  const { v, feedback } = await runVerify(r, w.fixRounds);
  s.verify = v;
  // The router learns how this round of writing went.
  const money = await r.money();
  await recordOutcome({
    taskType: s.classification?.type ?? "other", step: "write_code", model: w.lastModel ?? "unknown", success: v.ok && v.ran,
    paise: Math.max(0, money.spent - (w.roundStartPaise ?? money.spent)), ms: Math.max(0, r.now() - (w.roundStartedAt ?? r.now())),
  }, { ...(r.deps.routeStats ? { store: r.deps.routeStats } : {}), ...(r.deps.log ? { log: r.deps.log } : {}) });
  if (v.ok) {
    w.feedback = undefined;
    // What the checks passed on is written down: the commit is made of exactly this, and of nothing the checks did not see.
    s.verified = stagedFingerprint(r);
    // A job built from an approved design runs the app and looks at it before it is committed (design.ts); every other job commits.
    s.phase = designDue(r) ? "design" : "commit";
    await r.save();
    return;
  }
  if (w.fixRounds >= FIX_ROUNDS_MAX) {
    await r.save();
    throw new EndJob("failed", `The checks still fail after ${FIX_ROUNDS_MAX} rounds of fixes, so I stopped. Nothing was committed. ${v.summary}`);
  }
  w.fixRounds += 1;
  w.feedback = feedback;
  w.finished = false;
  w.runs = 0;
  w.nudged = false;
  w.badTurns = 0;
  w.roundStartPaise = money.spent;
  w.roundStartedAt = r.now();
  await r.log.decision(`The checks found something this change broke. Fix round ${w.fixRounds} of ${FIX_ROUNDS_MAX}.`);
  s.phase = "work";
  await r.save();
}

// ------------------------------------------------------------------ commit

/** Whether every staged file is already on the branch as staged: a commit that was made and not written down. */
async function alreadyOnBranch(r: Run): Promise<boolean> {
  for (const f of r.tools.changes.files) {
    const there = await readOrNull(r)(f.path);
    if (f.content === null ? there !== null : there !== f.content) return false;
  }
  return r.tools.changes.size > 0;
}

/** The commit was asked for edits the checks have not passed: never made. A bug in whoever asked, not a thing a job can do. */
export class Unverified extends Error {
  constructor() {
    super("the staged edits were not verified: no commit is made of edits the checks have not passed");
    this.name = "Unverified";
  }
}

/** GitHub's refusal of a push, in its own words and with its link, and what happens now: Tailzu does not go round it, and waits for the person. */
function refusalWords(branch: string, err: GithubRefusal): string {
  const said = redactText(err.said || "GitHub gave no reason.", 600);
  return `GitHub refused the push to ${branch}. Exactly what GitHub said: "${said}"${err.links.length ? ` Its link: ${err.links.join(" ")}` : ""} `
    + "Tailzu does not try to get round a rule like this, and pushed nothing else. Change the rule on GitHub, or take the change through a pull request, then tell me to try again; or stop.";
}

/**
 * Commits the staged edits (no-op when nothing is staged). Parks when the policy asks. Throws EndJob when it refuses.
 *
 *   VERIFY COMES FIRST, AND THE COMMIT CHECKS IT. What is committed must be exactly what the checks passed (`state.verified`, set by verify): a commit of
 *   anything else is refused with Unverified before GitHub is asked for anything, so no order of phases, no model turn and no restart can commit edits unchecked.
 *   A MERGE (a PR-care job for a conflict) is committed as a merge commit with two parents, through the policy: never a rebase, never a force.
 *   A PUSH GITHUB REFUSES (a protection rule) is not worked round: the job stops, tells the person exactly what GitHub said with the link it gave, and waits.
 */
export async function commitStaged(r: Run, o: { partial?: boolean } = {}): Promise<string | null> {
  const s = r.state;
  if (r.tools.changes.empty && !s.merge) return null;
  if (s.verified !== stagedFingerprint(r)) throw new Unverified();
  const files = r.tools.changes.toCommitFiles();
  const repo = repoRef(r.deps.projects, r.userId, r.project);
  const head = await r.deps.projects.github.branchHead(repo, r.branch);
  const view = await r.brain.status().catch(() => null);
  const merge = s.merge;
  if (merge && merge.stage !== "uptodate" && head !== merge.headSha && !(s.commit && !s.commit.sha)) {
    throw new EndJob("failed", `The branch changed while ${merge.base} was being merged into it, so I did not commit over the new work. Nothing was committed; the next check will merge again.`);
  }
  const message = s.commit?.message && !s.commit.sha ? s.commit.message
    : (merge ? `Merge ${merge.base} into ${r.branch}\n\nThe conflicts were resolved by Tailzu (job ${r.jobId.slice(0, 8)}). ${merge.conflicted.length ? `They were in ${merge.conflicted.slice(0, 6).join(", ")}.` : "There were none."}`
      : commitMessage(s, { conventional: view?.conventions?.commits.style === "conventional", jobId: r.jobId })) + (o.partial ? "\n\nThis is part of the work: the budget ran out before the rest." : "");
  // A commit made just before a crash, and not written down: found on the branch, not made again.
  if (s.commit && !s.commit.sha && s.commit.base !== head && (await alreadyOnBranch(r))) {
    s.commit.sha = head;
  } else {
    s.commit = { base: head, message, files: r.tools.changes.lines() };
    await r.save();
    try {
      const made = merge
        ? await r.gated("commit", "commit the merge", (id) => r.ws.mergeCommit(files, message, merge.baseSha, id ? { approvalId: id } : {}))
        : await r.gated("commit", "commit the changes", (id) => r.ws.commit(files, message, id ? { approvalId: id } : {}));
      s.commit.sha = made.sha;
    } catch (err) {
      if (err instanceof PolicyError) throw new EndJob("failed", `${err.message} Nothing was committed.`);
      if (err instanceof ConnectorError && err.code === "branch_moved") throw new EndJob("failed", "Someone else changed this branch while I was working, so I did not commit over their work. Nothing was committed; start again from the branch as it is.");
      if (err instanceof GithubRefusal) {
        s.commit = undefined;
        const question = refusalWords(r.branch, err);
        s.waiting = { kind: "question", from: "push", question, options: ["Try again", "Stop"], at: r.now() };
        await r.log.question(question);
        throw new Park("answer", `GitHub refused the push: ${redactText(err.said || "no reason given", 140)}${err.links[0] ? ` ${err.links[0]}` : ""}`);
      }
      throw err;
    }
  }
  const sha = s.commit.sha!;
  s.commits.push(sha);
  s.baseSha ??= s.commit.base;
  s.committedPaths = [...new Set([...(s.committedPaths ?? []), ...r.tools.changes.paths()])];
  await r.log.step(`${merge ? "Merged" : "Committed"} ${sha.slice(0, 7)} to ${r.branch} (${r.tools.changes.size} file${r.tools.changes.size === 1 ? "" : "s"})`, r.tools.changes.paths());
  r.tools.changes.clear();
  r.tools.invalidate();
  await r.save({ headSha: sha, notes: `${merge ? "Merged" : "Committed"} ${sha.slice(0, 7)}.` });
  return sha;
}

export async function commitPhase(r: Run): Promise<void> {
  const s = r.state;
  const w = s.waiting;
  // GitHub refused the push and the person has answered: stop, or try again.
  if (w?.kind === "question" && w.from === "push") {
    if (w.answer === undefined) throw new LostClaim();
    await r.log.question(w.question, w.answer);
    s.waiting = undefined;
    if (/\b(?:stop|no|cancel|abandon)\b/i.test(w.answer) && !/try\s+again/i.test(w.answer)) {
      throw new EndJob("failed", "You chose to stop after GitHub refused the push. The edits were not pushed, and nothing on the branch changed.");
    }
  }
  if (!r.tools.changes.empty || s.merge || (s.commit && !s.commit.sha)) await commitStaged(r);
  s.phase = s.commits.length ? "pr" : "report";
  await r.save();
}

// ---------------------------------------------------------------------- pr

export async function prPhase(r: Run): Promise<void> {
  const s = r.state;
  const d = r.deps.projects;
  // A PR-care job pushes to a pull request that exists, and is not its description's to rewrite: the pull request is the person's (or Tailzu's earlier) and says what it is.
  if (s.care) {
    s.pr = { number: s.care.prNumber, url: s.care.prUrl, ready: true, existing: true };
    await r.log.step(`Pushed to pull request #${s.care.prNumber}`);
    s.phase = "report";
    await r.save();
    return;
  }
  const money = await r.money();
  const worklog = await worklogMarkdown(r.jobId, { ...(r.deps.worklog ? { store: r.deps.worklog } : {}) });
  const body = prBody(s, { worklog, jobId: r.jobId, spentPaise: money.spent, design: designTextOf(r) });
  const pr = await r.ws.openDraftPr(prTitle(s), body);
  if (pr.existing) {
    // The pull request is open already (an earlier round of this job, or the person's): its description is brought up to date.
    await gateFree({
      ...gateBase(d, r.userId, r.project), attended: true, action: "pr.comment", branch: r.branch, ownBranch: true,
      summary: () => ({ pullRequest: pr.prNumber, updates: "the description" }),
      run: () => d.github.updatePull(repoRef(d, r.userId, r.project), pr.prNumber, { body }),
    });
  }
  s.pr = { number: pr.prNumber, url: pr.prUrl, ready: s.pr?.ready ?? false, ...(pr.existing ? { existing: true } : {}) };
  await r.log.step(`${pr.existing ? "Updated" : "Opened"} the draft pull request #${pr.prNumber}`);
  await r.save();
  // Ready for review only when the checks ran and found nothing this change broke.
  const green = s.verify?.ran === true && s.verify.ok;
  if (green && !s.pr.ready && !s.readyDenied) {
    try {
      await r.gated("ready", "mark the pull request ready for review", (id) => markReady(d, r.userId, r.projectId, r.branch, { attended: true, ...(id ? { approvalId: id } : {}) }));
      s.pr.ready = true;
      await r.log.decision("The checks are green, so the pull request is marked ready for review.");
    } catch (err) {
      if (err instanceof ConnectorError && !(err instanceof PolicyError) && ["pr_not_open", "pr_merged", "not_found"].includes(err.code)) {
        r.note(`The pull request could not be marked ready (${err.code.replace(/_/g, " ")}).`);
      } else if (err instanceof PolicyError) {
        r.note(`The pull request was left as a draft: ${err.message}`);
      } else throw err;
    }
  } else if (!green) {
    await r.log.decision(s.verify?.ran ? "The checks found something this change broke, so the pull request stays a draft." : "The checks did not run, so the pull request stays a draft.");
  }
  s.phase = "report";
  await r.save();
}

// ---------------------------------------------------------------- new project

const SKIP = /^\s*(?:skip|you decide|just start|go ahead|no preference|up to you)\b/i;

export async function newProjectPhase(r: Run): Promise<void> {
  const s = r.state;
  const np = (s.newProject ??= { stage: "intake" });

  if (np.stage === "intake") {
    let input: IntakeInput = { request: s.task };
    const w = s.waiting;
    if (w?.kind === "question" && w.from === "intake" && w.answer !== undefined) {
      input = SKIP.test(w.answer) ? { proceed: true } : { reply: w.answer };
      await r.log.question(w.question, w.answer);
      s.waiting = undefined;
    }
    const adv = await advanceIntake(r.userId, r.projectId, input, { model: r.model(), ...(r.deps.intake ? { store: r.deps.intake } : {}) });
    if (adv.state === "asking") {
      const q = adv.questions[0]!;
      s.waiting = { kind: "question", from: "intake", question: `${q.ask} (${q.why})`, at: r.now() };
      throw new Park("answer", q.ask);
    }
    const ms = planMilestones(adv.spec, adv.stack);
    const first = ms[1] ?? ms[0]!;
    np.planMd = adv.plan;
    np.stackKind = adv.stack.kind;
    np.specName = adv.spec.name;
    np.milestoneTask = [
      `Milestone ${first.k}: ${first.title}`, "", "Scope:", ...first.scope.map((x) => `- ${x}`), "", "Acceptance criteria:", ...first.acceptance.map((x) => `- ${x}`),
      "", "The whole plan is in PLAN.md; do this milestone only.",
    ].join("\n");
    np.nextMilestones = ms.slice(ms.indexOf(first) + 1).map((m) => `M${m.k}: ${m.title}`);
    np.stage = "plan_commit";
    await r.log.decision(`Planned ${adv.spec.name} as ${adv.stack.label}: ${adv.stack.reasons[0] ?? "chosen by rules"}${adv.degraded ? " (written without a model: read it carefully)" : ""}.`);
    await r.save();
  }

  const kind = np.stackKind as StackKind;
  if (np.stage === "plan_commit") {
    const sc = scaffoldStep({ kind }, { name: np.specName ?? "app" });
    const files: Array<{ path: string; content: string }> = [{ path: "PLAN.md", content: np.planMd ?? "" }, ...sc.files.map((f) => ({ path: f.path, content: f.content }))];
    if (sc.gitignore.length) {
      const cur = await readOrNull(r)(".gitignore");
      const have = new Set((cur ?? "").split("\n").map((l) => l.trim()));
      const add = sc.gitignore.filter((l) => !have.has(l));
      if (add.length) files.push({ path: ".gitignore", content: `${cur ? cur.replace(/\n*$/, "\n") : ""}${add.join("\n")}\n` });
    }
    const message = `Add PLAN.md for ${np.specName ?? "the project"}\n\nThe plan for the first version: what it is, the stack and why, and the milestones.${sc.files.length ? "\nAlso the template files the starter does not write itself." : ""}\n\nDone by Tailzu (job ${r.jobId.slice(0, 8)}).`;
    const made = await r.gated("commit", "commit PLAN.md", (id) => r.ws.commit(files, message, id ? { approvalId: id } : {}));
    np.planSha = made.sha;
    s.commits.push(made.sha);
    r.tools.invalidate();
    await r.log.edit("create", files.map((f) => f.path), "Committed the plan (PLAN.md) and the template files the starter does not write.");
    np.stage = "scaffold";
    np.scaffold = { status: "pending", commands: sc.commands };
    await r.save({ headSha: made.sha, notes: "Committed PLAN.md." });
  }

  if (np.stage === "scaffold") {
    const sc = scaffoldStep({ kind }, { name: np.specName ?? "app" });
    const w = s.waiting;
    let skip = false;
    if (w?.kind === "question" && w.from === "scaffold" && w.answer !== undefined) {
      skip = /skip/i.test(w.answer);
      s.waiting = undefined;
    }
    if (skip) {
      np.scaffold = { status: "skipped", commands: sc.commands };
      r.note(`The project's starter (${sc.starter ?? "a template"}) was skipped at your request, so the milestone that follows starts from the plan alone.`);
    } else {
      await r.log.note(`Setting up the project with its official starter${sc.starter ? ` (${sc.starter})` : ""}.`);
      // The step's changes are kept: the server commits them through the policy, as it does for any runner (a runner never holds a token that can write).
      const out = await r.runStep("scaffold", {
        commands: sc.commands, timeoutSec: sc.timeoutSec, estimateMinutes: sc.estimateMinutes, keepChanges: true, why: "Set up the project with its official starter",
      });
      if (out.status === "cancelled") throw new LostClaim();
      if (out.status !== "done") {
        s.waiting = {
          kind: "question", from: "scaffold", at: r.now(), options: ["Try again", "Skip the setup"],
          question: `I could not find a computer to run the project's setup on (${cut(out.reason, 120)}). Turn on running commands in your Tailzu desktop app, or allow GitHub's free computers, and tell me to try again, or skip the setup.`,
        };
        throw new Park("answer", "The project's setup could not be run: no computer was free.");
      }
      if (out.exitCode !== 0) throw new EndJob("failed", `The project's official starter failed (exit ${out.exitCode}). The end of what it printed: ${cut(out.outputTail.trim().split("\n").slice(-6).join(" | "), 400)}`);
      np.scaffold = { status: "done", commands: sc.commands };
      const head = (await r.job()).checkpoint.headSha;
      if (head && !s.commits.includes(head)) s.commits.push(head);
      r.tools.invalidate();
      await r.log.edit("create", ["(the starter's files)"], `Ran ${sc.starter ?? "the template"}; its files were committed.`);
    }
    np.stage = "ready";
    await r.save();
  }

  // From here the first milestone is an ordinary task on a project that now has files.
  s.task = np.milestoneTask ?? s.task;
  if (s.classification) s.classification = { ...s.classification, type: "feature" };
  s.located = emptyLocated();
  s.baseline = { status: "unknown", note: "This is a brand-new project, so nothing was checked before the first milestone: every check has to pass." };
  s.repoEmpty = false;
  s.phase = "plan";
  await r.save();
}

// ------------------------------------------------------------------ report

export async function reportPhase(r: Run): Promise<void> {
  const s = r.state;
  const money = await r.money();
  const outcome = s.commits.length === 0 && r.tools.changes.empty ? "answer" : "done";
  const text = reportText({ state: s, spentPaise: money.spent, budgetPaise: money.budget, outcome, prReady: s.pr?.ready, design: designTextOf(r) });
  s.report = { at: r.now(), outcome, text, ...(s.pr ? { prUrl: s.pr.url } : {}), costPaise: money.spent };
  s.phase = "done";
  await r.save({ notes: cut(text.split("\n")[0] ?? "Done.", 200) });
}

/** The design check in words, with the links to its shots (signed, 7 days, the owner's only): for the report and the pull request. */
export function designTextOf(r: Run): string[] {
  const s = r.state;
  const link = r.deps.design?.link;
  return designLines(s.design, link && s.spec ? (shotId) => link({ userId: r.userId, artifactId: s.spec!.artifactId, shotId }) : undefined);
}

/** The words a finished job's summary has for the job list and the push. */
export const headlineOf = (text: string): string => cut((text.split("\n")[0] ?? "Done").replace(/^Done: /, ""), 200);

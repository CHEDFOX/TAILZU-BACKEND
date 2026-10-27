/**
 * THE AGENT LOOP: THE PHASES IN ORDER, AND THE FOUR WAYS A RUN COMES TO AN END.
 *
 *   prepare -> (new_project) -> baseline -> locate -> plan -> work -> verify -> (design) -> commit -> pr -> report
 *
 * runLoop drives one job from wherever its checkpoint says it is (phases.ts), and returns how the run
 * ended:
 *
 *   finished   the job is over: done (the report is the answer), or failed with a reason (the checks
 *              still red after three rounds of fixes, the policy refused, no model could be reached).
 *              Either way a report was written and the job was finished through the router, which tells
 *              the person
 *   parked     the job waits for the person: a question (locate, intake, the model), a yes (the plan, a
 *              commit the policy asks about, marking a pull request ready), or more budget. The state is
 *              saved, the claim is let go, and the person is told. The routes in routes/codeJobs.ts
 *              (answer, approve, deny, budget) write their word into the state and the orchestrator picks
 *              the job up again where it was
 *   lost       the claim is not ours (another server has the job, or it was stopped): nothing more is
 *              written
 *   stopped    this server is shutting down or the job was stopped here
 *
 * THE BUDGET STOP is the one that takes care. When the money runs out the loop does not simply drop what
 * it has: the checks are run on the staged edits (they cost no model money), and only if they come out no
 * worse than the project was before Tailzu touched it are the edits committed; otherwise they stay
 * staged, in the checkpoint, for the person to go on from. The report says which, and offers "continue
 * with ₹X more" (POST /v1/code/jobs/:id/budget raises the budget and the loop resumes). It is never a
 * failure, and it never leaves a half-way commit that breaks the project.
 */
import { BudgetExceeded } from "../brain/gateway.js";
import type { WaitingOn } from "../jobs/types.js";
import type { LoopEnv } from "./run.js";
import { BudgetStop, EndJob, LostClaim, Park, Run, Yield } from "./run.js";
import { RunPending } from "./runner.js";
import {
  baseline, commitPhase, commitStaged, headlineOf, locatePhase, newProjectPhase, planPhase, prPhase, prepare, reportPhase, runVerify, stagedFingerprint, verifyPhase, workPhase,
} from "./phases.js";
import { designPhase } from "./design.js";
import { mergePhase } from "./merge.js";
import { reportText } from "./report.js";
import { rupees, topUpFor, type Phase } from "./types.js";

export type LoopEnd = "finished" | "parked" | "lost" | "stopped";

const PHASES: Record<Exclude<Phase, "done">, (r: Run) => Promise<void>> = {
  prepare, new_project: newProjectPhase, baseline, merge: mergePhase, locate: locatePhase, plan: planPhase, work: workPhase, verify: verifyPhase, design: designPhase, commit: commitPhase, pr: prPhase, report: reportPhase,
};

const isBudget = (e: unknown): boolean => e instanceof BudgetStop || e instanceof BudgetExceeded || (e as { code?: unknown } | null)?.code === "budget_exceeded";

export async function runLoop(env: LoopEnv): Promise<LoopEnd> {
  const r = new Run(env);
  try {
    await r.init();
    for (;;) {
      if (env.signal.aborted) return "stopped";
      const phase = r.state.phase;
      if (phase === "done") break;
      r.progress({ t: "phase", phase, at: r.now() });
      await PHASES[phase](r);
      // A phase that got to its end is progress: the run of failures the backoff counts is over.
      if (r.state.errors) r.state.errors = undefined;
    }
    await finish(r);
    return "finished";
  } catch (err) {
    try {
      return await ended(r, err);
    } catch (again) {
      if (again instanceof LostClaim) return "lost";
      throw again;
    }
  }
}

async function ended(r: Run, err: unknown): Promise<LoopEnd> {
  return (await endedWith(r, err)).end;
}

/** `ended`, and what a parked job waits for. Throws what it does not know. */
async function endedWith(r: Run, err: unknown): Promise<{ end: LoopEnd; waitingOn?: WaitingOn }> {
  if (err instanceof LostClaim) return { end: "lost" };
  if (err instanceof Park) {
    await park(r, err);
    return { end: "parked", waitingOn: err.waitingOn };
  }
  if (err instanceof EndJob) {
    await failed(r, err.why);
    return { end: "finished" };
  }
  if (isBudget(err)) {
    await budgetStop(r, err instanceof BudgetStop ? err.needPaise : (err as BudgetExceeded).needPaise ?? 0);
    return { end: "parked", waitingOn: "budget" };
  }
  throw err;
}

// -------------------------------------------------------------- one advance

/**
 * What one advance of the loop came to, for a driver that comes back for the next (a Cloudflare Workflow: jobs/src/agentJob.ts):
 *
 *   continue   a slice of the work is done and saved; call advance again at once
 *   wait       nothing more can be done until `waitingOn` happens: the person's answer, yes or money (the job is parked; their
 *              word is written into the state and the driver is woken), a step that is out on a runner (look again at `wakeAt`,
 *              epoch ms; `waitMs` is the same wait as a length, for a driver that must not read the clock), a claim somebody
 *              else holds (try again then), or an error that is being backed off from
 *   end        the job is over, or this driver has no business with it any more (`why`)
 */
export type Advance =
  | { next: "continue" }
  | { next: "wait"; waitingOn: "answer" | "approval" | "budget" | "runner" | "retry" | "claim"; wakeAt?: number; waitMs?: number }
  | { next: "end"; why: "finished" | "lost" | "stopped" | "over" };

/**
 * Runs the loop ONE ADVANCE: the phase the state is in, up to the next checkpoint, and says how it ended. It is runLoop's body for
 * one pass, built from the same phases, so everything they promise (re-entered after a restart, nothing done twice, every write
 * fenced by the claim) holds between advances exactly as it holds between a crash and the next server. Differences from runLoop:
 *
 *   - a step that is out on a runner is looked at once (`pollOnce`); if it has not finished the advance says "wait, runner" and the
 *     driver sleeps, instead of this function holding a step open;
 *   - the work phase gives way after `turns` rounds (a model turn and its tool calls), each already saved;
 *   - the run of failures the backoff counts is cleared AND saved when a phase gets to its end, because nothing in memory
 *     outlives the advance.
 *
 * An error it does not understand is thrown (the orchestrator's `advance` backs off and counts it, as `errored` does for runLoop).
 */
export async function advanceLoop(env: LoopEnv, o: { turns?: number } = {}): Promise<Advance> {
  const r = new Run({ ...env, pollOnce: true, ...(o.turns !== undefined ? { turnsPerAdvance: Math.max(1, Math.floor(o.turns)) } : {}) });
  try {
    await r.init();
    if (env.signal.aborted) return { next: "end", why: "stopped" };
    if (r.state.phase !== "done") {
      r.progress({ t: "phase", phase: r.state.phase, at: r.now() });
      await PHASES[r.state.phase](r);
      if (r.state.errors) {
        r.state.errors = undefined;
        await r.save();
      }
    }
    if (r.state.phase === "done") {
      await finish(r);
      return { next: "end", why: "finished" };
    }
    return { next: "continue" };
  } catch (err) {
    if (err instanceof Yield) return { next: "continue" };
    if (err instanceof RunPending) return { next: "wait", waitingOn: "runner", wakeAt: r.now() + err.retryInMs, waitMs: err.retryInMs };
    try {
      const e = await endedWith(r, err);
      if (e.end === "parked") return { next: "wait", waitingOn: e.waitingOn as "answer" | "approval" | "budget" };
      return { next: "end", why: e.end === "finished" ? "finished" : e.end === "stopped" ? "stopped" : "lost" };
    } catch (again) {
      if (again instanceof LostClaim) return { next: "end", why: "lost" };
      throw again;
    }
  }
}

// ------------------------------------------------------------ the ways out

/** The job waits for the person; the claim is let go; they are told. */
async function park(r: Run, p: Park): Promise<void> {
  // A live session is never left open while a person thinks: it is closed first, always, before they are asked anything (code/live).
  await r.closeSession("needs_you");
  await r.env.claim.park(r.state, { waitingOn: p.waitingOn, reason: p.reason });
  await r.tell("needs_you", p.reason);
}

/** The report is written and the job finished: done, or failed. */
async function finish(r: Run): Promise<void> {
  // A live session is a step that stays out for the whole job, and a job cannot be done with a step out: it is closed first, and given a moment to report.
  await r.closeSession("job_end");
  const rep = r.state.report;
  if (rep?.outcome === "failed") await r.deps.jobs.finishJob(r.jobId, { ok: false, reason: headlineOf(rep.text) });
  else await r.deps.jobs.finishJob(r.jobId, { ok: true, summary: headlineOf(rep?.text ?? "Done") });
  await over(r, rep?.outcome === "failed" ? "failed" : "finished");
}

/** The job is over: its live session is closed and its copy of the code deleted (we never keep a person's code), and a watching app is told. */
async function over(r: Run, why: string): Promise<void> {
  r.progress({ t: "end", why, at: r.now() });
  try { await r.deps.live?.endJob?.(r.jobId); } catch { /* the room deletes the copy itself after six idle hours */ }
}

/** The job stops for a reason, with a report that says what was and was not done. */
async function failed(r: Run, why: string): Promise<void> {
  const s = r.state;
  const money = await r.money();
  const text = reportText({ state: s, spentPaise: money.spent, budgetPaise: money.budget, outcome: "failed", why });
  s.report = { at: r.now(), outcome: "failed", text, ...(s.pr ? { prUrl: s.pr.url } : {}), costPaise: money.spent };
  s.waiting = undefined;
  s.phase = "done";
  await r.save({ notes: why.slice(0, 200) });
  await r.closeSession("job_end");
  await r.deps.jobs.finishJob(r.jobId, { ok: false, reason: why });
  await over(r, "failed");
}

/**
 * The money ran out. What is staged is checked, and committed only if the checks are no worse than the
 * project was; else it stays staged. The report offers more budget, and the job waits for it.
 */
async function budgetStop(r: Run, needPaise: number): Promise<void> {
  const s = r.state;
  let outcome = "";
  if (!r.tools.changes.empty) {
    try {
      const { v } = await runVerify(r, s.work.fixRounds);
      s.verify = v;
      if (v.ran && v.ok) {
        s.verified = stagedFingerprint(r);
        const sha = await commitStaged(r, { partial: true });
        outcome = sha ? `What I had done so far passed the checks, so it is committed (${sha.slice(0, 7)}) on ${r.branch}; the rest is not done.` : "";
      } else {
        outcome = v.ran
          ? "What I had done so far makes the project's checks worse than they were, so I did NOT commit it: it stays staged, and nothing on the branch has changed."
          : "I could not check what I had done so far, so I did NOT commit it: it stays staged, and nothing on the branch has changed.";
      }
    } catch (err) {
      if (err instanceof LostClaim) throw err;
      // The commit needs the person's OK, or the policy refused it: either way it was not made.
      if (err instanceof Park || err instanceof EndJob) {
        s.waiting = undefined;
        outcome = "What I had done so far passed the checks, but committing it needs your OK, so it stays staged and nothing on the branch has changed.";
      } else throw err;
    }
  }
  const money = await r.money();
  const top = topUpFor(money.spent);
  const why = `The budget of ${rupees(money.budget)} is used up (${rupees(money.spent)} spent) before the work was finished. ${outcome}`.trim();
  const text = reportText({ state: s, spentPaise: money.spent, budgetPaise: money.budget, outcome: "budget", why, continueWithPaise: top });
  s.report = { at: r.now(), outcome: "budget", text, ...(s.pr ? { prUrl: s.pr.url } : {}), costPaise: money.spent, continueWithPaise: top };
  s.waiting = { kind: "budget", needPaise, at: r.now() };
  await park(r, new Park("budget", `Out of budget: ${rupees(money.spent)} of ${rupees(money.budget)} used. Continue with ${rupees(top)} more?`));
}

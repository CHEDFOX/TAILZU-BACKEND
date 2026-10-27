/**
 * THE AGENT JOB: ONE WORKFLOW INSTANCE PER JOB, DRIVING THE EXISTING LOOP ONE ADVANCE AT A TIME.
 *
 * Instance id = the job's id. `run()` is a loop of steps:
 *
 *   advance-<n>   a step.do that asks the orchestrator for ONE ADVANCE of the job (tulmi/src/code/agent loop.ts advanceLoop,
 *                 through AgentOrchestrator.advance): claim the job, run the phase it is in up to its next checkpoint
 *                 (at most a couple of model turns in the work phase), let the claim go. It returns a small value:
 *                 { next: "continue" } | { next: "wait", waitingOn, wakeAt, waitMs } | { next: "end", why }. Ids and
 *                 words only; the job's state, its staged files and its work log stay in Supabase, where they always were
 *   wait-<n>      what the advance asked for:
 *                   the person (answer, approve/deny, budget)   waitForEvent("wake") for PERSON_WAIT. A word from the
 *                       person is written into the job by the VPS and then the VPS posts /v1/event, which lands here. If
 *                       nobody comes in PERSON_WAIT the wait times out (waitForEvent THROWS on a timeout, so it is
 *                       caught) and the job is ended with a report
 *                   a step out on a runner     waitForEvent("wake") for the length the advance gave (10 s, then 30, then
 *                       60): the VPS posts /v1/event when the runner reports, or the time is up and the step is looked at
 *                   a claim held / a failure backed off from     step.sleep for the length given
 *
 * THE SECOND GUARD. The Workflow engine makes a step run to completion once, and retries it if it fails. The job's own claim
 * (agent_holder, agent_epoch, agent_expires_at: tulmi/src/code/agent/orchestrator.ts) makes sure that even so nothing runs twice:
 * a retried step whose first attempt is still alive finds the claim taken and is told to wait; every write the loop makes is
 * fenced by the claim's epoch, so a step that was cut off cannot write after its replacement has started.
 *
 * Step names are deterministic (advance-0, wait-0, advance-1 ...) and every time that matters comes out of a step's own result,
 * as the Workflows rules ask (developers.cloudflare.com/workflows/build/rules-of-workflows/).
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Advance } from "../../tulmi/src/code/agent/loop.js";
import { isUuid } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import type { AgentJobParams, Env } from "./env.js";
import { roomOf } from "./rooms.js";
import { WAKE_EVENT } from "./workflows.js";
import { getWorld } from "./world.js";

/** Most advances one job may take: a job that has not ended by then is stopped with a report instead of looping for ever (a Workflow may have 10,000 steps; each advance and each wait is one). */
export const MAX_ADVANCES = 3_000;
/** The default for how long a job waits for the person. */
export const PERSON_WAIT_DEFAULT = "7 days";

/** A step that touches Supabase, GitHub or a model: tried a few more times if it throws, slowly. Its own errors the loop already handles. */
const ADVANCE_STEP = { retries: { limit: 4, delay: "15 seconds", backoff: "exponential" }, timeout: "15 minutes" } as const;
const SHORT_STEP = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;

/** One advance of a job. Exported for the tests of the loop's own seam. */
export async function advanceJob(env: Env, jobId: string, holder: string): Promise<Advance> {
  const turns = Number.parseInt(String(env.ADVANCE_TURNS ?? ""), 10);
  return (await getWorld(env)).agent.advance(jobId, { holder, ...(Number.isFinite(turns) && turns > 0 ? { turns } : {}) });
}

export class AgentJob extends WorkflowEntrypoint<Env, AgentJobParams> {
  async run(event: WorkflowEvent<AgentJobParams>, step: WorkflowStep): Promise<{ ended: string; advances: number }> {
    const ended = await this.drive(event, step);
    // However the job ended, its room is emptied: the live session closed, the copy of the code deleted (we never keep a person's code).
    const jobId = event.payload?.jobId;
    if (isUuid(jobId)) {
      try { await step.do("cleanup", SHORT_STEP, async () => { await roomOf(this.env, jobId).endJob(); }); } catch { /* the room deletes itself after six idle hours */ }
    }
    return ended;
  }

  private async drive(event: WorkflowEvent<AgentJobParams>, step: WorkflowStep): Promise<{ ended: string; advances: number }> {
    const jobId = event.payload?.jobId;
    if (!isUuid(jobId)) throw new NonRetryableError("jobId is the id of a code job.");
    const personWait = (this.env.PERSON_WAIT?.trim() || PERSON_WAIT_DEFAULT) as WorkflowSleepDuration;

    for (let n = 0; n < MAX_ADVANCES; n += 1) {
      let a: Advance;
      try {
        // `ctx.attempt` is in the holder's name, so a retry of this step is a different claimant from its first try.
        a = await step.do(`advance-${n}`, ADVANCE_STEP, async (ctx) => advanceJob(this.env, jobId, `wf-${event.instanceId.slice(0, 8)}-${n}-${ctx.attempt}`));
      } catch (err) {
        // Out of tries: the job is not left running with nobody to drive it.
        await step.do(`failed-${n}`, SHORT_STEP, async () => (await getWorld(this.env)).agent.abandon(jobId, "Something went wrong on Tailzu's side and it could not be put right. What was committed so far is on the branch; nothing else was changed."));
        return { ended: `errored: ${(err as Error)?.name ?? "error"}`, advances: n + 1 };
      }

      if (a.next === "continue") continue;
      if (a.next === "end") return { ended: a.why, advances: n + 1 };

      // ---- wait
      if (a.waitingOn === "answer" || a.waitingOn === "approval" || a.waitingOn === "budget") {
        try {
          await step.waitForEvent(`wait-${n}`, { type: WAKE_EVENT, timeout: personWait });
        } catch {
          // Nobody came. waitForEvent throws on a timeout and would fail the instance; instead the job ends with a report.
          await step.do(`timeout-${n}`, SHORT_STEP, async () => (await getWorld(this.env)).agent.abandon(jobId, `Nobody replied for ${personWait}, so I stopped here. What was committed so far is on the branch; nothing else was changed. Start the task again if you still want it.`));
          return { ended: "timeout", advances: n + 1 };
        }
      } else if (a.waitingOn === "runner") {
        try {
          // The VPS posts an event when a runner reports; otherwise the step is looked at again when the time is up.
          await step.waitForEvent(`wait-${n}`, { type: WAKE_EVENT, timeout: clampMs(a.waitMs, 10_000) });
        } catch { /* time is up: look again */ }
      } else {
        await step.sleep(`wait-${n}`, clampMs(a.waitMs, 15_000));
      }
    }

    await step.do("too-long", SHORT_STEP, async () => (await getWorld(this.env)).agent.abandon(jobId, "This job took more steps than one job is allowed, so I stopped it. What was committed so far is on the branch."));
    return { ended: "too_long", advances: MAX_ADVANCES };
  }
}

/** A wait of at least a second (the least a Workflow takes) and at most an hour, in milliseconds. */
function clampMs(ms: number | undefined, fallback: number): number {
  const v = typeof ms === "number" && Number.isFinite(ms) ? ms : fallback;
  return Math.min(60 * 60_000, Math.max(1_000, Math.round(v)));
}

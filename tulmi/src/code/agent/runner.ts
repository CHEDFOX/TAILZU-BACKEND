/**
 * RUNNING COMMANDS FOR THE AGENT: THE RUNNER PORT, AND THE ENVIRONMENT ROUTER BEHIND IT.
 *
 * The agent never runs a command itself. It asks a RUNNER (an interface, so the whole loop
 * runs offline in tests with one that answers from a script) and gets back what a person
 * would want to know: did it run, what was the exit code, what did it print. The real runner
 * (routerRunner) is the environment router (code/jobs/router.ts, docs/code-router.md): it
 * asks for an exec step, and the router puts it on the person's own PC, or GitHub's free
 * computers, or paid compute by the person's own rule, and the agent waits for the result.
 *
 *   - OVERLAY. The agent's staged edits are not committed, so they go WITH the step: the
 *     runner lays them over its checkout before it runs (jobs/types.ts OverlayFile). A trial
 *     run keeps nothing: `keepChanges: false` tells the router that whatever the commands
 *     change (an install that rewrites a lockfile, a snapshot) is not to be committed. The
 *     one run that wants its changes kept is the scaffold of a new project, which the router
 *     commits through the policy like any runner's changes (the server commits; a runner is
 *     never given a token that can write).
 *   - WAITING. A step with no place waits (`waiting_for_compute`). The agent waits for a
 *     place only so long (PLACE_WAIT_MS); after that the step is dropped (router.cancelExec)
 *     and the run answers `no_runner`, and the caller decides what that means (a baseline
 *     recorded as unknown, a tool result for the model, a question to the person). A step
 *     that runs is waited for until its own time and RUN_GRACE_MS have passed.
 *   - ADOPTING. A server that died while a step was out leaves it in the database. The next
 *     run of the same commands takes that step over instead of asking for another, so a
 *     restart never runs the same checks twice.
 *   - A STEP WAITING FOR A YES. If what a step made needs the person's OK to be committed (the router's
 *     commit_ask, answered at /commit-ok), the agent waits for that too, for BLOCKED_WAIT_MS.
 *   - STOPPING. The caller's signal answers `cancelled` and leaves the step where it is: a job that was stopped has its step dropped by the router, and a server that is only closing leaves it for the next to take over.
 *
 * Nothing here reads a clock or sleeps except through the injected `now` and `sleep`.
 */
import type { JobRouter } from "../jobs/router.js";
import type { JobStore } from "../jobs/store.js";
import { isEnded, type CodeJob, type JobStep, type OverlayFile } from "../jobs/types.js";
import { BLOCKED_WAIT_MS, PLACE_WAIT_MS, RUN_GRACE_MS, RUN_POLL_MS } from "./types.js";

export interface RunSpec {
  commands: string[];
  timeoutSec: number;
  estimateMinutes: number;
  /** The staged edits to lay over the checkout. */
  overlay?: OverlayFile[];
  /** Keep what the commands change (the scaffold of a new project). Default: no, it is a trial. */
  keepChanges?: boolean;
  /**
   * Hand what the commands change BACK to the agent (RunOutcome.changes) instead of committing it: the merge of the default branch into a branch,
   * whose result the model reads, resolves and the server commits as a merge commit (code/prcare). The step keeps them until `clearCaptured`.
   */
  capture?: boolean;
  /** Why, in a few words, for the log. */
  why?: string;
  /** A step this ask was made for before a restart: if it is there with these commands, it is taken over, finished or not. */
  adopt?: number;
  /** What this ask is for (a tool call's id, "baseline", "verify:1"): the same ask made again is the same command, which a live session needs to know. */
  tag?: string;
}

export type RunOutcome =
  | { status: "done"; exitCode: number; outputTail: string; minutes: number; stepIdx: number; /** How long it ran, when it is known to the millisecond (a live session). */ ms?: number; /** A `capture` step's changes (the files as the commands left them). */ changes?: OverlayFile[] }
  /** No place took the step in time (no PC online, no free minutes, paid compute off or asking). */
  | { status: "no_runner"; reason: string }
  | { status: "timeout"; reason: string }
  /** The job was stopped, or the caller's signal went. */
  | { status: "cancelled"; reason: string };

/**
 * A step is out and has not finished, and the caller asked not to wait for it (RunControl.once). Thrown out of a phase, which the
 * driver (loop.ts advanceLoop) turns into "come back in `retryInMs`": the step's mark is in the state, so the next advance adopts
 * it and looks again. This is how a Cloudflare Workflow waits for a runner with step.sleep instead of holding a step open.
 */
export class RunPending extends Error {
  constructor(readonly retryInMs: number, readonly stepIdx: number) {
    super("the step is still out");
    this.name = "RunPending";
  }
}

/** How long to leave a step that is out before looking again: often at first, then less. */
export function retryAfter(waitedMs: number): number {
  return waitedMs < 60_000 ? 10_000 : waitedMs < 5 * 60_000 ? 30_000 : 60_000;
}

export interface RunControl {
  /**
   * Look at the step once, and throw RunPending if it is not finished, instead of waiting for it. The wait for a place, the timeouts and
   * the grace are measured from `startedAt`, the time the step was first asked for, which a caller that comes back later passes in.
   */
  once?: boolean;
  startedAt?: number;
  signal?: AbortSignal;
  /** Called while waiting, to keep the agent's claim alive. */
  renew?: () => Promise<void>;
  /** Called as soon as the step exists, so a restart can adopt it. */
  onStep?: (stepIdx: number) => Promise<void>;
}

export interface AgentRunner {
  run(job: CodeJob, spec: RunSpec, ctl?: RunControl): Promise<RunOutcome>;
}

export interface RouterRunnerOptions {
  jobs: Pick<JobRouter, "requestExec" | "cancelExec">;
  store: Pick<JobStore, "listSteps" | "getStep" | "getJobById">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  placeWaitMs?: number;
  graceMs?: number;
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isOpen = (s: JobStep): boolean => s.kind === "exec" && (s.status === "pending" || s.status === "dispatched" || s.status === "running" || s.status === "blocked");
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function routerRunner(o: RouterRunnerOptions): AgentRunner {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? sleepFor;
  const poll = o.pollMs ?? RUN_POLL_MS;
  const placeWait = o.placeWaitMs ?? PLACE_WAIT_MS;
  const grace = o.graceMs ?? RUN_GRACE_MS;

  return {
    async run(job, spec, ctl = {}) {
      // A step a server that died asked for is taken over if it is this one (whether it has finished or not); any other that is still out is dropped.
      let step: JobStep | undefined;
      if (spec.adopt !== undefined) {
        const was = await o.store.getStep(job.id, spec.adopt);
        if (was && was.kind === "exec" && was.status !== "cancelled" && same(was.commands, spec.commands)) step = was;
      }
      if (!step) {
        step = (await o.store.listSteps(job.id)).filter(isOpen).at(-1);
        if (step && !same(step.commands, spec.commands)) {
          await o.jobs.cancelExec(job.id);
          step = undefined;
        }
      }
      if (!step) {
        step = (await o.jobs.requestExec(job.id, spec.commands, spec.timeoutSec, spec.estimateMinutes, {
          ...(spec.overlay?.length ? { overlay: spec.overlay } : {}), keepChanges: spec.keepChanges === true, ...(spec.capture === true ? { capture: true } : {}),
        })).step;
      }
      await ctl.onStep?.(step.idx);

      // The time of the first ask counts only for the step that ask was for.
      const started = spec.adopt !== undefined && step.idx === spec.adopt && ctl.startedAt !== undefined ? ctl.startedAt : now();
      const idx = step.idx;
      for (;;) {
        // The caller is stopping (the server is closing, the claim was lost, the job was stopped). The step is not dropped here: a job that was stopped has its step dropped by the router, and one that is only changing servers leaves it for the next to take over.
        if (ctl.signal?.aborted) return { status: "cancelled", reason: "stopped" };
        const cur = await o.store.getStep(job.id, idx);
        const j = await o.store.getJobById(job.id);
        if (!cur || !j || isEnded(j.state)) return { status: "cancelled", reason: "The job was stopped." };
        if (cur.status === "done" || cur.status === "failed") {
          return { status: "done", exitCode: cur.exitCode ?? 1, outputTail: cur.outputTail, minutes: cur.minutes, stepIdx: idx, ...(cur.captured.length ? { changes: cur.captured } : {}) };
        }
        if (cur.status === "cancelled") return { status: "cancelled", reason: "The step was dropped." };
        const waited = now() - started;
        // A step whose changes wait for the person's OK to be committed (the router's commit_ask) is waited for, a long time: the answer comes by /commit-ok.
        if (cur.status === "blocked") {
          if (waited > BLOCKED_WAIT_MS) {
            await o.jobs.cancelExec(job.id);
            return { status: "timeout", reason: "Nobody said yes to committing what it made, so it was dropped." };
          }
          if (ctl.once) throw new RunPending(retryAfter(waited), idx);
          await ctl.renew?.();
          await sleep(poll);
          continue;
        }
        if (cur.status === "pending" && waited > placeWait) {
          await o.jobs.cancelExec(job.id);
          return { status: "no_runner", reason: j.reason || "No computer was free to run it." };
        }
        if (waited > cur.timeoutSec * 1000 + grace + placeWait) {
          await o.jobs.cancelExec(job.id);
          return { status: "timeout", reason: "It did not finish in the time it was given." };
        }
        if (ctl.once) throw new RunPending(retryAfter(waited), idx);
        await ctl.renew?.();
        await sleep(poll);
      }
    },
  };
}

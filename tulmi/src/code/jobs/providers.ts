/**
 * THE PLACES A STEP CAN RUN, AS ONE INTERFACE.
 *
 * A ComputeProvider is a kind of place: the person's own PC, GitHub's free
 * computers, paid compute. The router (router.ts) asks each whether it has room
 * (`available`), gives it a step (`dispatch`), and tells it to let go
 * (`cancel`). Everything else about choosing between them is placement.ts.
 *
 *   DesktopProvider         REAL, below. A PC doesn't get a call: it comes and
 *                           asks (GET /v1/code/runner/next), so dispatching to
 *                           it is only picking which of the person's devices
 *                           the step is for. The router writes that device as
 *                           the lease's holder and the device's next poll finds
 *                           it there
 *   GithubActionsProvider   REAL, in githubActions.ts: a step is a push of a
 *                           throwaway `tailzu-run/` branch in the person's own
 *                           repo, and a GitHub Actions run on it reports back
 *                           with an identity token. tests/jobs-fakes.ts still
 *                           has a fake that records what it is given
 *   PaidProvider            an interface only, for now
 *
 * HOW A PLACE REPORTS BACK. A provider that runs a step somewhere else calls
 * the router's `submitResult(userId, result, kind)` when it finishes, with the
 * job id, step number and EPOCH it was dispatched under (the job it is given
 * carries the epoch). The router refuses a result whose epoch is not the job's
 * current one ("stale_lease"), which is what stops a place that was given up on
 * from counting. For GitHub that result is where the minutes it used are
 * recorded against the person's month; for paid, the paise.
 *
 * `dispatch` may throw (the place went away between asking and giving): the
 * router then treats that kind of place as unavailable for this attempt and
 * chooses again.
 *
 * A place that can't send heartbeats (GitHub Actions) also has `check`, which
 * the ticker calls every pass for each step that place has out: it answers
 * whether the step is still going (and the router keeps its lease alive) or
 * has been lost (no run ever appeared, the run ended without reporting, it ran
 * far past its time), and then the router moves the step like any lease that
 * ran out.
 */
import type { DeviceBook } from "./devices.js";
import type { JobStore } from "./store.js";
import type { CodeJob, ComputeKind, JobStep } from "./types.js";

/** What a provider is asked when it is asked whether it has room. */
export interface AvailabilityCtx {
  userId: string;
  projectId: string;
  jobId: string;
  /** How long the step is expected to run. */
  estimateMinutes: number;
  /** Epoch ms. */
  now: number;
}

export interface Availability {
  ok: boolean;
  /** How many places of this kind could take the step (a PC counts each device). */
  places?: number;
  /** Paid only: what the step would cost, in paise. */
  estimatePaise?: number;
  /** When not ok: why, as a short code (GitHub: "needs_workflow_permission"). Shown to the person in plain words by placement.ts. */
  reason?: string;
  /** GitHub only: minutes one step would also cost the person because their own CI runs on its push. Added to the estimate and to the month's use. */
  extraMinutes?: number;
  /** GitHub only: the repo is public, so its minutes aren't metered: they don't count against the free estimate and don't hold a step back. */
  unmetered?: boolean;
}

/**
 * What the ticker learns by looking at a step that is out on a place that
 * reports for itself. "waiting": not started yet, or going, and the lease is
 * kept. "lost": it will not report in time. `exhausted` says the cause looks
 * like the month's free minutes (or Actions) being unavailable, which the
 * router remembers for the rest of the month; `reason` is plain words.
 */
export type RunCheck =
  | { state: "waiting" }
  | { state: "lost"; why: "no_run" | "no_result" | "overrun"; exhausted: boolean; reason: string };

export interface ComputeProvider {
  readonly kind: ComputeKind;
  /** Whether a place of this kind could take this step now. Never throws for "no". */
  available(ctx: AvailabilityCtx): Promise<Availability>;
  /**
   * Gives the step to a place. `job` already carries the new lease epoch, and
   * the step is the one to run. Returns the lease's holder: a device id, a run
   * id. Throws NoPlace (or anything) if it can't.
   */
  dispatch(job: CodeJob, step: JobStep): Promise<{ holder: string }>;
  /** Lets go of the job's step: stop the run, release the machine. Best effort; the router has already fenced it with the epoch. */
  cancel(job: CodeJob): Promise<void>;
  /** Places that can't send heartbeats only: whether the step that is out is still going, or lost. Never throws for "I can't tell": that is "waiting". */
  check?(job: CodeJob, step: JobStep): Promise<RunCheck>;
}

/** Paid compute. Built later; it also says what a step would cost. */
export interface PaidProvider extends ComputeProvider { readonly kind: "paid" }

/** `dispatch` found no place after all. */
export class NoPlace extends Error {
  constructor(what = "no place of that kind is free") { super(what); }
}

/**
 * The person's own PCs. A device can take a step if it is online, allowed to
 * run, allowed on the project, not busy by its own account, and not already
 * holding a step the router gave it (devices.ts).
 */
export class DesktopProvider implements ComputeProvider {
  readonly kind = "desktop" as const;

  constructor(private readonly o: { devices: DeviceBook; store: JobStore; now: () => number }) {}

  /** The devices that could take a step of this project, best first. */
  private async idle(userId: string, projectId: string) {
    const capable = this.o.devices.capable(userId, projectId, this.o.now());
    const free = [];
    for (const d of capable) {
      if ((await this.o.store.findHeld(userId, "desktop", d.deviceId)).length === 0) free.push(d);
    }
    return free;
  }

  async available(ctx: AvailabilityCtx): Promise<Availability> {
    const places = (await this.idle(ctx.userId, ctx.projectId)).length;
    return { ok: places > 0, places };
  }

  async dispatch(job: CodeJob): Promise<{ holder: string }> {
    const [device] = await this.idle(job.userId, job.projectId);
    if (!device) throw new NoPlace("none of the person's computers is free");
    return { holder: device.deviceId };
  }

  /** Nothing to tell the PC: its next progress or result carries the old epoch and is refused as stale_lease. */
  async cancel(): Promise<void> {}
}

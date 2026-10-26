/**
 * Fake places for the job router's tests (code-jobs*.test.ts).
 *
 * The router (src/code/jobs/router.ts) chooses between three kinds of place.
 * The PC is real code (DesktopProvider); GitHub's free computers and paid
 * compute are interfaces only for now (providers.ts), and these are their test
 * stand-ins. A FakeProvider records what it was given and what it was told to
 * let go of, can be closed (no room) or made to fail a dispatch, and reports a
 * step's result back the way the real one will: by calling the router's
 * submitResult with its own kind and the epoch the job was dispatched under.
 */
import { NoPlace, type Availability, type AvailabilityCtx, type ComputeProvider } from "../src/code/jobs/providers.js";
import type { JobRouter } from "../src/code/jobs/router.js";
import type { CodeJob, ComputeKind, JobStep } from "../src/code/jobs/types.js";

export interface Given { job: CodeJob; step: JobStep; holder: string }

export class FakeProvider implements ComputeProvider {
  readonly kind: ComputeKind;
  /** Whether there is room. */
  open = true;
  /** Paid only: what a minute costs, in paise. */
  paisePerMinute = 100;
  /** The next N dispatches throw. */
  failNext = 0;
  /** `available` throws instead of answering. */
  broken = false;
  given: Given[] = [];
  letGo: CodeJob[] = [];
  asked: AvailabilityCtx[] = [];
  private n = 0;

  constructor(kind: "github" | "paid") { this.kind = kind; }

  async available(ctx: AvailabilityCtx): Promise<Availability> {
    this.asked.push(ctx);
    if (this.broken) throw new Error("provider is down");
    return { ok: this.open, places: this.open ? 1 : 0, ...(this.kind === "paid" ? { estimatePaise: ctx.estimateMinutes * this.paisePerMinute } : {}) };
  }

  async dispatch(job: CodeJob, step: JobStep): Promise<{ holder: string }> {
    if (this.failNext > 0) { this.failNext -= 1; throw new NoPlace("the fake place is full"); }
    const holder = `${this.kind}-run-${(this.n += 1)}`;
    this.given.push({ job: { ...job, checkpoint: { ...job.checkpoint } }, step: { ...step }, holder });
    return { holder };
  }

  async cancel(job: CodeJob): Promise<void> { this.letGo.push(job); }

  /** The last thing given. */
  get last(): Given { return this.given.at(-1)!; }

  /** The place finishes the last step it was given, as the real one will: through the router, with its kind and the epoch of the dispatch. */
  async finish(
    router: JobRouter, o: { exitCode?: number; minutes?: number; paise?: number; outputTail?: string; changes?: Array<{ path: string; content: string | null }>; given?: Given } = {},
  ) {
    const g = o.given ?? this.last;
    return router.submitResult(g.job.userId, {
      jobId: g.job.id, stepIdx: g.step.idx, epoch: g.job.leaseEpoch, exitCode: o.exitCode ?? 0, outputTail: o.outputTail ?? "ok",
      minutes: o.minutes ?? 1, ...(o.paise !== undefined ? { paise: o.paise } : {}), ...(o.changes ? { changes: o.changes } : {}),
    }, this.kind);
  }
}

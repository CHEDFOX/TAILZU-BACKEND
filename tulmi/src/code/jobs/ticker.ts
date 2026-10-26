/**
 * THE JOB TICKER: EVERY 15 SECONDS, TAKE BACK LEASES THAT RAN OUT AND LOOK AGAIN AT JOBS THAT ARE WAITING.
 *
 * One pass is JobRouter.tick (router.ts):
 *
 *   - a lease that has run out (a PC that stopped sending heartbeats, a run
 *     that stopped reporting) is taken back and its step is placed again from
 *     the job's checkpoint, on the next cheapest place; a job that has lost its
 *     lease five times is failed with the reason;
 *   - a job waiting for compute, or for a yes to paid compute, is looked at
 *     again, so it goes on when a PC is back, the month has turned over and
 *     GitHub's free minutes with it, or a setting has changed.
 *
 * Nothing here runs in a request's way. A pass that fails (the database is
 * away) is logged and the next one tries again; a pass never starts while the
 * one before is still running; the timer never keeps the process alive.
 * Started once the server is ready and stopped when it closes, like the
 * stuck-task sweeper (connectors/sweeper.ts): routes/codeJobs.ts hooks it in.
 *
 * The clock is the router's own (`now` in its options), so a test moves time
 * by moving that and calling tick, and the timer here only decides how often.
 */
import { TICK_MS } from "./types.js";
import type { JobRouter, TickReport } from "./router.js";

/** A pass at once, then one every `everyMs`, never two at the same time. Returns the stop. */
export function startJobTicker(o: {
  jobs: Pick<JobRouter, "tick">;
  everyMs?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r: TickReport = await o.jobs.tick();
      if (r.expired || r.woken) o.log?.info({ ...r }, "code jobs: leases taken back, waiting jobs placed");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.message }, "code jobs: tick failed");
    } finally {
      running = false;
    }
  };
  void run();
  const every = setInterval(run, o.everyMs ?? TICK_MS);
  every.unref?.();
  return () => clearInterval(every);
}

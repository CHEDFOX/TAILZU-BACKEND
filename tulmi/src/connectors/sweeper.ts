/**
 * THE STUCK-TASK SWEEPER: a task left "running" is ended, and says why.
 *
 * A task is "running" while a run is using an app for it, and the run closes
 * it when it ends (TaskService.settle). Some never come back to: a desktop
 * run that ends on the computer after an action, a process that restarts in
 * the middle of a call, a yes being carried out when the server went down.
 * Those stayed "Running" on Tasks and on the You tab for ever, a silent
 * failure. Every minute, and once when the server is ready, any task that
 * has been running with nothing happening for STUCK_MS becomes "failed",
 * with STUCK_STEP as its last step, which is what the person reads.
 *
 * Only "running". A card waiting for a yes is not stuck: it waits, and
 * TaskService.approve already turns one that has waited past its hour into
 * "That request expired" with its own answer (410), which sweeping it first
 * would change. The You tab's Activity calls such a card expired when it
 * reads it.
 *
 * Nothing here runs in a request's way. A pass that fails (the database is
 * away) is logged and the next minute tries again; the timer never keeps the
 * process alive. Started and stopped by registerConnectorRoutes, the module
 * that owns /v1/tasks.
 */
import type { ConnectorStore } from "./store.js";

/** How long a task may run with nothing happening. A desktop step is at most its 60 s deadline; an app call, 20 s. */
export const STUCK_MS = 10 * 60_000;
/** How often the sweeper looks. */
export const SWEEP_EVERY_MS = 60_000;
/** The step a stuck task ends on: the reason, as the person reads it on Tasks. */
export const STUCK_STEP = "Stopped: nothing happened for 10 minutes.";

/** One pass: every task running since before `now - STUCK_MS` is failed with the reason. Returns how many. */
export async function sweepTasks(store: ConnectorStore, now: number): Promise<number> {
  return store.failStuckTasks(now - STUCK_MS, STUCK_STEP);
}

/** A pass at once, then one every `everyMs`, never two at the same time. Returns the stop. */
export function startTaskSweeper(o: {
  store: ConnectorStore;
  everyMs?: number;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const tasks = await sweepTasks(o.store, (o.now ?? Date.now)());
      if (tasks) o.log?.info({ tasks }, "stuck tasks failed");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.message }, "stuck task sweep failed");
    } finally {
      running = false;
    }
  };
  void run();
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  every.unref?.();
  return () => clearInterval(every);
}

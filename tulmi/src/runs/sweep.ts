/**
 * THE RUN SWEEP: runs nobody will finish are closed, and what people said is
 * let go of when its time is up (SWEEP_TIMES).
 *
 *   a desktop run with no step for 10 minutes    cancelled / device_stopped
 *     (the desktop tells the server nothing after its last action, so a run
 *     it ended itself, by a deadline, Esc or an action that finished it,
 *     looks just like this)
 *   a question back with no answer               cancelled / unanswered, its
 *     (5 minutes on the phone, 10 on the desktop)  turns emptied
 *   the words to try again with, after a day     emptied
 *   the title, after 30 days                     emptied
 *
 * A run waiting on a card is never closed here: how the card was answered is
 * the task's to say (agent_run_report reads it). One pass soon after start
 * and then every minute, one at a time, never in a request's way; the timers
 * do not keep the process alive, and a pass that fails waits for the next.
 */
import type { RunStore } from "./types.js";

const EVERY_MS = 60_000;
const FIRST_MS = 5_000;

export function startRunSweeper(o: {
  store: RunStore;
  everyMs?: number;
  /** The first pass, this long after start. */
  firstMs?: number;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}): () => void {
  const now = o.now ?? Date.now;
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const r = await o.store.sweep(now());
      if (r.closed || r.emptied) o.log?.info({ runs: r }, "run sweep");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.message }, "run sweep failed");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(pass, o.firstMs ?? FIRST_MS);
  const every = setInterval(pass, o.everyMs ?? EVERY_MS);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}

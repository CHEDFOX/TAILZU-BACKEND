/**
 * ROUTINES (docs/routines.md): a bot does something on a schedule, without being asked each time.
 *
 *   words.ts     "every Friday at 5, sum up my week" read into a schedule and a task; the schedule said back; the next run
 *   store.ts     the table (migration 0062), in memory or Supabase
 *   service.ts   Routines: draft, create, list, update, remove, run now, and the tick that runs what is due
 *
 *   createRoutines(o)        the service, or null when the bots platform is off or ROUTINES is false
 *   startRoutines(r, log)    every minute: the routines that are due. Returns the stop.
 */
import { getConfig } from "../config.js";
import { Routines, type RoutinesOptions } from "./service.js";

export { Routines, RoutineError, ROUTINE_TOPICS, ROUTINES_MAX, LATE_MS, FAILS_TO_PAUSE, sealDraft, openDraft, type Draft, type RoutineView, type BotChoice, type RoutineBots } from "./service.js";
export { routineStore, MemoryRoutineStore, resetRoutineStoreForTests, type Routine, type RoutineStore } from "./store.js";
export { readRoutine, scheduleWords, nextRun, nextWords, cleanSchedule, clockWords, DEFAULT_MINUTE, type Schedule, type ReadRoutine } from "./words.js";

const TICK_MS = 60_000;

export function createRoutines(o: Omit<RoutinesOptions, "max" | "bots"> & { bots: RoutinesOptions["bots"] | null }): Routines | null {
  const c = getConfig();
  if (!o.bots || !c.ROUTINES) return null;
  return new Routines({ ...o, bots: o.bots, max: c.ROUTINES_MAX });
}

/** Every minute, the routines that are due. Returns the stop. */
export function startRoutines(r: Routines, log?: { warn: (o: object, m: string) => void }): () => void {
  const tick = async () => {
    try { await r.tick(); } catch (err) { log?.warn({ err: (err as Error)?.message }, "routines: tick"); }
  };
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * THE BENCH'S CLOCK: Monday morning in India, for every trial, on any machine.
 *
 * The phone's Ask reads the time in two places a task depends on: the
 * planner's Now line (prompt.ts nowLine, which reads Date.now() when it is not
 * handed a time) and every "tomorrow" a tool reads (google/time.ts parseWhen,
 * from the connectors' `now`). A task says "add dentist tomorrow at 4pm" and
 * checks for the 27th; run on a Tuesday, it would be checking the wrong day.
 * And the cassette key hashes the planner's message, Now line and all, to the
 * minute: a clock that moved would make every recorded answer a miss.
 *
 * So for the length of a trial, Date.now() and `new Date()` with no arguments
 * read the bench's clock instead of the machine's. Nothing else changes: a
 * Date made from a value is a real Date, Date.parse and Date.UTC are the real
 * ones, and timers (setTimeout, AbortSignal.timeout) run on real time, so a
 * timeout still fires. The clock stands still unless the harness moves it
 * (five seconds between a question and its answer).
 *
 * It is one global, so a process runs one trial at a time (run.ts --shard
 * splits a set across processes instead), and installing it twice is refused.
 * restore() puts the real Date back.
 */
import { BENCH_TZ_OFFSET_MINUTES } from "./types.js";

export interface BenchClock {
  now(): number;
  set(iso: string): void;
  advance(ms: number): void;
  readonly tzOffsetMinutes: number;
}

/** The machine's Date, kept before anything here replaces it. */
export const RealDate: DateConstructor = Date;

let installed = false;

/** An instant from a time written with its offset ("2026-10-26T10:30:00+05:30"). */
function instant(iso: string): number {
  const ms = RealDate.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`The bench clock needs a time written with its offset, not ${JSON.stringify(iso)}.`);
  return ms;
}

/**
 * A Date whose "now" is the bench's. Made from anything, it is a real Date
 * (same prototype, so instanceof and every method are the real ones); called
 * without `new`, it gives the time now as a string, as Date() does.
 */
function benchDate(now: () => number): DateConstructor {
  const BenchDate = function (...args: unknown[]): unknown {
    if (!new.target) return new RealDate(now()).toString();
    return Reflect.construct(RealDate, args.length ? args : [now()], new.target);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(BenchDate, RealDate);
  Object.defineProperty(BenchDate, "prototype", { value: RealDate.prototype });
  BenchDate.now = () => now();
  return BenchDate;
}

/** Freezes the time at `startIso` until restore(). */
export function installClock(startIso: string): { clock: BenchClock; restore(): void } {
  if (installed) throw new Error("The bench clock is already installed: a process runs one trial at a time.");
  let at = instant(startIso);
  const clock: BenchClock = {
    now: () => at,
    set: (iso) => { at = instant(iso); },
    advance: (ms) => { at += ms; },
    tzOffsetMinutes: BENCH_TZ_OFFSET_MINUTES,
  };
  const bench = benchDate(() => at);
  globalThis.Date = bench;
  installed = true;
  let restored = false;
  return {
    clock,
    restore() {
      if (restored) return;
      restored = true;
      if (globalThis.Date === bench) globalThis.Date = RealDate;
      installed = false;
    },
  };
}

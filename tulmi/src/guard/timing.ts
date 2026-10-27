/**
 * TIME, SAID ONCE: A DEADLINE ON A PROMISE, AND THE WAIT BEFORE A RETRY.
 *
 * Three small things that were written out by hand in several places (a Promise.race against a timer, a "give up and use this
 * instead", a jittered wait before a retry). They are here once, so that a fix to one is a fix to all, and so the tests can drive
 * them with a fake clock.
 *
 *   withTimeout(work, ms)        the answer, or a TimeoutError once `ms` have gone by. Given a function, it is handed an AbortSignal
 *                                that is aborted at the deadline, so the work can let go of what it holds
 *   withFallback(p, ms, value)   the answer, or `value` once `ms` have gone by. `p` goes on either way (runs/ledger.ts `within`)
 *   retryJitter(baseMs, random)  the wait before a retry: half to one and a half times the base, so a burst of callers that failed
 *                                together does not come back together
 *
 * Timers are unref'd: waiting for a deadline never keeps a process alive. Nothing here reads the environment or a store.
 */

/** The work did not finish in time. */
export class TimeoutError extends Error {
  readonly code = "timeout";
  constructor(readonly ms: number, readonly what: string = "the call") {
    super(`${what} did not finish in ${ms} ms`);
    this.name = "TimeoutError";
  }
}

export interface TimerPort {
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const startTimer = (o: TimerPort, fn: () => void, ms: number): unknown => {
  if (o.setTimer) return o.setTimer(fn, ms);
  const h = setTimeout(fn, ms);
  h.unref?.();
  return h;
};
const stopTimer = (o: TimerPort, h: unknown): void => {
  if (o.clearTimer) o.clearTimer(h);
  else clearTimeout(h as ReturnType<typeof setTimeout>);
};

/** A deadline that can be set: a positive, finite number of milliseconds. Anything else is no deadline. */
const hasDeadline = (ms: number): boolean => Number.isFinite(ms) && ms > 0;

/**
 * The work's answer, or a TimeoutError at the deadline. A promise that settles later is left alone (its rejection is not unhandled).
 * A function gets an AbortSignal, aborted at the deadline.
 */
export function withTimeout<T>(work: Promise<T> | ((signal: AbortSignal) => Promise<T>), ms: number, o: TimerPort & { what?: string } = {}): Promise<T> {
  const ctl = new AbortController();
  let pending: Promise<T>;
  try {
    pending = typeof work === "function" ? work(ctl.signal) : work;
  } catch (err) {
    return Promise.reject(err);
  }
  if (!hasDeadline(ms)) return pending;
  return new Promise<T>((resolve, reject) => {
    const timer = startTimer(o, () => {
      ctl.abort();
      reject(new TimeoutError(ms, o.what));
    }, ms);
    pending.then(
      (v) => { stopTimer(o, timer); resolve(v); },
      (e) => { stopTimer(o, timer); reject(e); },
    );
  });
}

/** What `p` gives, or `fallback` once `ms` have gone by without it. `p` goes on either way. */
export function withFallback<T>(p: Promise<T>, ms: number, fallback: T, o: TimerPort = {}): Promise<T> {
  if (!hasDeadline(ms)) return p;
  let timer: unknown;
  const late = new Promise<T>((resolve) => { timer = startTimer(o, () => resolve(fallback), ms); });
  return Promise.race([p, late]).finally(() => stopTimer(o, timer));
}

/**
 * How long to wait before a retry, in milliseconds: the base, spread over half to one and a half times its length. `random` is in [0, 1)
 * (Math.random unless a test passes its own).
 */
export function retryJitter(baseMs: number, random: () => number = Math.random): number {
  return Math.round(Math.max(0, baseMs) * (0.5 + random()));
}

/**
 * ONE READ FOR EVERYONE WHO ASKS FOR IT AT THE SAME TIME: COALESCING.
 *
 * Two jobs search the same words, three people open the same page, two steps ask for the same project's kit: the second and third ask do
 * not need a second trip. `run(key, fn)` starts `fn` for a key nobody is running, and hands a key that IS running the same promise, so the
 * cheap reads (a search, a page read, a project's kit, a brain query) are made once however many ask while one is out.
 *
 * It keeps nothing once a read has settled (that is the page cache's and the kit store's job, not this one's): it only joins what is in
 * flight at this moment. A read that fails fails for everyone who joined it; one more try is the next caller's.
 *
 * A stopped caller must not be able to cancel everyone's read: if the shared read ends in an AbortError that was not the joiner's own, the
 * joiner runs the read again for itself, once.
 *
 * In memory, per process. Nothing here reads the environment, a store or a clock.
 */

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === "AbortError";

export class Coalescer {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private started = 0;
  private joined = 0;

  /** The result of `fn` for this key; joins the run that is out for it, if there is one. */
  run<T>(key: string, fn: () => Promise<T>, o: { signal?: AbortSignal } = {}): Promise<T> {
    const out = this.inflight.get(key) as Promise<T> | undefined;
    if (out) {
      this.joined += 1;
      return out.catch((err: unknown) => {
        // The leader was stopped, and this caller was not: do it again, alone.
        if (isAbort(err) && !o.signal?.aborted) return fn();
        throw err;
      });
    }
    this.started += 1;
    const p = (async () => fn())();
    const done = () => { if (this.inflight.get(key) === p) this.inflight.delete(key); };
    this.inflight.set(key, p);
    p.then(done, done);
    return p;
  }

  stats(): { inflight: number; started: number; joined: number } {
    return { inflight: this.inflight.size, started: this.started, joined: this.joined };
  }

  clear(): void { this.inflight.clear(); }
}

/** The process's one coalescer, for the cheap reads of the web layer, the kit and the brain. */
let shared = new Coalescer();
export const coalescer = (): Coalescer => shared;
export function resetCoalescerForTests(): void { shared = new Coalescer(); }

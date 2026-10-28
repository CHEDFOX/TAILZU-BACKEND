/**
 * LOOKUPS THAT FINISH AFTER THE SCREEN DID: a screen load never waits long on a geocoder, a router or the weather. It draws what is
 * known; what is missing is looked up here, one job per person and thing at a time, and when the job learned something the person's
 * open screens are told by topic (live/writes.ts livePublish: "bot:plan", "bot:travel") and load again, from memory this time.
 *
 *   later.run(userId, "plan", ["bot:plan"], async () => learnedSomething)
 *
 * A job that learned nothing (a provider resting, nothing to find) tells nobody, so a screen and its job never chase each other.
 */
import { livePublish } from "../live/writes.js";

const JOBS_MAX = 2_000;

export class Later {
  private running = new Map<string, Promise<void>>();

  constructor(private readonly tell: (userId: string, topics: string[]) => void = livePublish) {}

  run(userId: string, key: string, topics: string[], work: () => Promise<boolean>): Promise<void> {
    const k = `${userId}\u0000${key}`;
    const had = this.running.get(k);
    if (had) return had;
    if (this.running.size >= JOBS_MAX) return Promise.resolve();
    const job = (async () => {
      try { if (await work()) this.tell(userId, topics); } catch { /* a lookup that failed is not news */ } finally { this.running.delete(k); }
    })();
    this.running.set(k, job);
    return job;
  }

  /** Tests: until every job has finished. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running.values()]);
  }
}

/** Waits for `p`, but no longer than `ms`. */
export const within = (p: Promise<unknown>, ms: number): Promise<unknown> =>
  ms <= 0 ? Promise.resolve() : Promise.race([p, new Promise((r) => { const t = setTimeout(r, ms); (t as { unref?: () => void }).unref?.(); })]);

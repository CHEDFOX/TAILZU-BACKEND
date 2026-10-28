/**
 * A JOB'S MONEY, AS THE BRAIN READS AND ADDS TO IT.
 *
 * budget_paise is what the person has said a job may spend; spent_paise is what
 * it has. The job router adds paid compute to spent_paise (jobs/router.ts) and
 * the brain adds its model calls to the same number, so one figure is the whole
 * of what a job has cost and one budget bounds all of it.
 *
 * Adding is a compare-and-set on the spend itself (JobExpect.spentPaise): read
 * it, write it plus the cost only if it is still what was read, otherwise read
 * again. Two calls that finish together both count. It is deliberately NOT
 * conditioned on the job's state or lease: a call that was already paid for when
 * the job was cancelled still cost what it cost.
 *
 * One race remains and is the router's: it writes the spend as an absolute
 * number when a paid step reports (jobs/router.ts submitResult), so a model
 * call that finishes in the same instant as a paid step's result can be lost
 * from the total. That costs at most one call's price, in the person's favour.
 */
import type { JobStore } from "../jobs/store.js";
import type { CodeJob } from "../jobs/types.js";

/**
 * WHAT A JOB'S MODEL CALLS HAVE COST, ROUNDED UP ONCE, NOT ONCE PER CALL.
 *
 * spent_paise is whole paise, and a cost is rounded UP (money.ts), so that a job's spend never reads low. Rounded per CALL that is far too high for the cheap
 * models: a call that costs 0.4 paise was charged 1, and a job of a hundred such calls read 100 paise for 40 (the first real-model test: the product's meter ran
 * 1.9 times the proxy's, 75 paise to 39, and the budget with it, so a job stopped on money it had not spent). The meter keeps, per job, the exact paise its calls
 * have cost and the whole paise charged so far, and charges only what brings the charge up to the exact total rounded UP: never low, and never more than one paise
 * high, however many calls. The first call of a job is charged exactly as before (its cost rounded up). It lives in this process: a job that moves to another
 * server starts its count again and reads at most one paise high for it.
 */
export class SpendMeter {
  private readonly by = new Map<string, { exact: number; charged: number }>();
  constructor(private readonly max = 5_000) {}

  /** Adds a call's exact cost, in paise (fractions allowed) to a scope, and returns the whole paise to charge for it now. */
  charge(scope: string, exactPaise: number): number {
    if (!Number.isFinite(exactPaise) || exactPaise <= 0) return 0;
    const cur = this.by.get(scope) ?? { exact: 0, charged: 0 };
    cur.exact += exactPaise;
    // The 6-decimal trim keeps 8.8 + 8.8 + ... at its true total, not a hair above a whole paise.
    const due = Math.ceil(Number(cur.exact.toFixed(6)));
    const add = Math.max(0, due - cur.charged);
    cur.charged += add;
    // Most recent last, and the oldest forgotten when there are too many: a job that ended is not kept for ever.
    this.by.delete(scope);
    this.by.set(scope, cur);
    if (this.by.size > this.max) this.by.delete(this.by.keys().next().value as string);
    return add;
  }
}

let shared = new SpendMeter();
/** The process's meter, which callModel uses unless it is given its own. */
export const sharedSpendMeter = (): SpendMeter => shared;
export function resetSpendMeterForTests(): void { shared = new SpendMeter(); }

/** Times the compare-and-set is tried before the add is given up on. */
const ADD_TRIES = 8;

/** The job's spend and budget as they stand now. Null when there is no such job. */
export async function readJobMoney(store: Pick<JobStore, "getJobById">, jobId: string): Promise<{ job: CodeJob; spentPaise: number; budgetPaise: number } | null> {
  const job = await store.getJobById(jobId);
  return job ? { job, spentPaise: job.spentPaise, budgetPaise: job.budgetPaise } : null;
}

/** Adds paise to a job's spend. Returns the spend after, or null when the job is gone or the add kept losing to others. */
export async function addJobSpend(store: Pick<JobStore, "getJobById" | "casJob">, jobId: string, paise: number): Promise<number | null> {
  const add = Math.max(0, Math.round(paise));
  if (add === 0) return (await store.getJobById(jobId))?.spentPaise ?? null;
  for (let i = 0; i < ADD_TRIES; i += 1) {
    const job = await store.getJobById(jobId);
    if (!job) return null;
    const next = await store.casJob(jobId, { spentPaise: job.spentPaise }, { spentPaise: job.spentPaise + add });
    if (next) return next.spentPaise;
  }
  return null;
}

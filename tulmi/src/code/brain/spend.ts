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

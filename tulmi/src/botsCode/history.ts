/**
 * WHAT A PERSON'S OWN PAST JOBS SAY: what a job here usually costs and takes, for the plan's estimate and the rules'
 * "Most jobs here cost ₹4–14". Real numbers from their finished jobs only, never a guess: with fewer than MIN_JOBS done
 * there is no estimate, and the screens say nothing rather than a made-up figure. Pure.
 */

export interface PastJob {
  projectId?: string;
  state: string;
  spentPaise: number;
  createdAt: number;
  updatedAt: number;
}

/** Finished jobs needed before anything is said about "usually". */
export const MIN_JOBS = 3;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
};

/** The person's done jobs, this project's when there are enough of them, else all of theirs. */
function sample(jobs: PastJob[], projectId?: string): { jobs: PastJob[]; here: boolean } {
  const done = jobs.filter((j) => j.state === "done" && j.spentPaise > 0);
  const here = projectId ? done.filter((j) => j.projectId === projectId) : [];
  return here.length >= MIN_JOBS ? { jobs: here, here: true } : { jobs: done, here: false };
}

export interface Estimate {
  /** The median cost of a finished job, in paise. */
  costPaise: number;
  /** The median time from start to done, in minutes (at least 1). */
  minutes: number;
  /** How many jobs it rests on, and whether they were this project's. */
  from: number;
  here: boolean;
}

/** What a job usually costs and takes, from the person's own finished jobs. Null with fewer than MIN_JOBS. */
export function estimate(jobs: PastJob[], projectId?: string): Estimate | null {
  const s = sample(jobs, projectId);
  if (s.jobs.length < MIN_JOBS) return null;
  return {
    costPaise: median(s.jobs.map((j) => j.spentPaise)),
    minutes: Math.max(1, Math.round(median(s.jobs.map((j) => Math.max(0, j.updatedAt - j.createdAt))) / 60_000)),
    from: s.jobs.length, here: s.here,
  };
}

/** The usual spread of a job's cost (the middle half), in paise. Null with fewer than MIN_JOBS. */
export function typicalRange(jobs: PastJob[], projectId?: string): [number, number] | null {
  const s = sample(jobs, projectId);
  if (s.jobs.length < MIN_JOBS) return null;
  const xs = s.jobs.map((j) => j.spentPaise);
  return [quantile(xs, 0.25), quantile(xs, 0.75)];
}

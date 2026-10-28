/**
 * THE STATISTICS OF THE REALITY PLAN: HOW SURE ARE WE, AND WHEN MAY WE STOP PAYING TO FIND OUT.
 *
 * Every comparison (our agent against aider, one model against another) is a set of ARMS. An arm has run some tasks; each run passed or failed and cost some rupees.
 * After every round of tasks the plan asks three questions of the numbers so far, and stops spending on a comparison as soon as they are answered:
 *
 *   1. How good is each arm?          a Beta posterior on its success rate (uniform prior) and a Wilson interval, both at 90% or 95%
 *   2. What does a success cost?      rupees per success, with a bootstrap interval over the runs (a few dear runs and many cheap ones is what a real run looks like)
 *   3. Who is best, and who is out?   P(arm is the best of all) by integrating the posteriors; an arm is DOMINATED when another arm is better on success rate AND cheaper
 *                                     per success, each with probability at least `confidence` (0.9)
 *
 * THE STOPPING RULE (`decide`), applied once every live arm has at least `minN` runs:
 *   - drop every dominated arm (worse on success AND dearer per success, each with probability 1 - (1 - confidence) / (live arms - 1), a stricter bar the more
 *     arms there are, since some equal arm always looks worse by chance): it is not paid to lose on the rest;
 *   - if one arm is left, or the leader's P(best) is at least `confidence`, the comparison is DECIDED and no more tasks are added to it;
 *   - otherwise it is open: more tasks are added (to the arms still in it) while there is money, and if the tasks run out it ends as a TIE with the intervals shown.
 *
 * Nothing here draws a random number except the bootstrap, and that one is seeded, so a report is the same twice. The Beta integrals are done by quadrature on a
 * fixed grid, not by sampling. No dependency.
 */

// ----------------------------------------------------------------------------- special functions

/** ln Gamma(x), Lanczos (g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const z = x - 1;
  let a = c[0]!;
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

const logBeta = (a: number, b: number): number => logGamma(a) + logGamma(b) - logGamma(a + b);

/** The continued fraction of the incomplete beta function (modified Lentz). */
function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b): the Beta(a, b) CDF at x. */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(x, a, b)) / a : 1 - (front * betacf(1 - x, b, a)) / b;
}

export function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta(a, b));
}

/** The p-quantile of Beta(a, b), by bisection. */
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// --------------------------------------------------------------------------------- intervals

/** The z of a two-sided interval at `level` (0.90 -> 1.645, 0.95 -> 1.96). */
export function zOf(level: number): number {
  // Acklam-free: invert the normal CDF by bisection on erf-based Phi; exact enough for 0.5..0.999.
  const phi = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));
  const target = 0.5 + level / 2;
  let lo = 0;
  let hi = 8;
  for (let i = 0; i < 60; i += 1) { const mid = (lo + hi) / 2; if (phi(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function erf(x: number): number {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

/** The Wilson score interval for `pass` of `n`. With n = 0 it is the whole of [0, 1]. */
export function wilsonInterval(pass: number, n: number, level = 0.95): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const z = zOf(level);
  const p = pass / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

export interface Posterior { a: number; b: number; mean: number; lo: number; hi: number; level: number }

/** The Beta posterior of a success rate after `pass` of `n` (prior Beta(1, 1): nothing assumed), with its central interval. */
export function betaPosterior(pass: number, n: number, level = 0.9, prior: readonly [number, number] = [1, 1]): Posterior {
  const a = prior[0] + pass;
  const b = prior[1] + (n - pass);
  const tail = (1 - level) / 2;
  return { a, b, mean: a / (a + b), lo: betaQuantile(tail, a, b), hi: betaQuantile(1 - tail, a, b), level };
}

// ----------------------------------------------------------------------- who is best, who is out

const GRID = 1500;

/** P(X > Y) for independent X ~ Beta(a1, b1) and Y ~ Beta(a2, b2): the integral of f_X(x) F_Y(x). */
export function probGreater(x: { a: number; b: number }, y: { a: number; b: number }): number {
  let sum = 0;
  for (let i = 0; i < GRID; i += 1) {
    const t = (i + 0.5) / GRID;
    sum += betaPdf(t, x.a, x.b) * betaCdf(t, y.a, y.b);
  }
  return Math.min(1, Math.max(0, sum / GRID));
}

/** For each arm, the probability that its success rate is the highest of all (they sum to 1). */
export function probBest(arms: ReadonlyArray<{ a: number; b: number }>): number[] {
  if (arms.length === 0) return [];
  if (arms.length === 1) return [1];
  const cdf = arms.map((arm) => Array.from({ length: GRID }, (_, i) => betaCdf((i + 0.5) / GRID, arm.a, arm.b)));
  const out = arms.map((arm, i) => {
    let sum = 0;
    for (let g = 0; g < GRID; g += 1) {
      let others = 1;
      for (let j = 0; j < arms.length; j += 1) if (j !== i) others *= cdf[j]![g]!;
      sum += betaPdf((g + 0.5) / GRID, arm.a, arm.b) * others;
    }
    return sum / GRID;
  });
  const total = out.reduce((n, x) => n + x, 0) || 1;
  return out.map((x) => x / total);
}

// ------------------------------------------------------------------------------- cost per success

/** mulberry32: a small seeded generator, so the bootstrap is the same twice. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Run { ok: boolean; costInr: number }

/** Rupees per success: all the money spent on the arm over its successes; infinite when nothing passed. */
export function costPerSuccess(runs: readonly Run[]): number {
  const pass = runs.filter((r) => r.ok).length;
  return pass ? runs.reduce((n, r) => n + r.costInr, 0) / pass : Number.POSITIVE_INFINITY;
}

const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
};

/** The point value and a bootstrap interval of rupees per success. `hi` is infinite when some resamples had no success. */
export function costPerSuccessInterval(runs: readonly Run[], level = 0.9, seed = 1, draws = 400): { point: number; lo: number; hi: number } {
  const point = costPerSuccess(runs);
  if (runs.length < 2) return { point, lo: point, hi: point };
  const rand = rng(seed);
  const xs: number[] = [];
  for (let d = 0; d < draws; d += 1) xs.push(costPerSuccess(Array.from({ length: runs.length }, () => runs[Math.floor(rand() * runs.length)]!)));
  const tail = (1 - level) / 2;
  return { point, lo: quantile(xs, tail), hi: quantile(xs, 1 - tail) };
}

/** P(A's rupees per success < B's), by resampling both arms' runs together. An arm with no success is the dearer one (infinite). */
export function probCheaper(a: readonly Run[], b: readonly Run[], seed = 7, draws = 400): number {
  if (!a.length || !b.length) return 0.5;
  const rand = rng(seed);
  let wins = 0;
  for (let d = 0; d < draws; d += 1) {
    const ra = costPerSuccess(Array.from({ length: a.length }, () => a[Math.floor(rand() * a.length)]!));
    const rb = costPerSuccess(Array.from({ length: b.length }, () => b[Math.floor(rand() * b.length)]!));
    if (ra < rb) wins += 1;
  }
  return wins / draws;
}

// ---------------------------------------------------------------------------------- the decision

export interface ArmRuns { id: string; runs: readonly Run[] }

export interface ArmStat {
  id: string;
  n: number;
  pass: number;
  rate: number;
  wilson95: { lo: number; hi: number };
  posterior: Posterior;
  costPerSuccess: { point: number; lo: number; hi: number };
  meanCostInr: number;
  totalCostInr: number;
  pBest: number;
  /** Set when another arm is better on success rate and cheaper per success, each with probability >= confidence. */
  dominatedBy?: string;
}

export interface Decision {
  arms: ArmStat[];
  /** The arm most likely to be the best (among those still in), when there is one with a run. */
  leader: string | null;
  decided: boolean;
  /** "clear" (P(best) >= confidence), "last" (the others are dominated), "open" (more tasks may settle it), "short" (not enough runs yet). */
  state: "clear" | "last" | "open" | "short";
  reason: string;
  /** Arms to stop paying for. */
  drop: string[];
}

export interface DecideOptions { confidence?: number; minN?: number; level?: number; seed?: number }

export function armStat(a: ArmRuns, level: number, seed: number): Omit<ArmStat, "pBest"> {
  const n = a.runs.length;
  const pass = a.runs.filter((r) => r.ok).length;
  const total = a.runs.reduce((s, r) => s + r.costInr, 0);
  return {
    id: a.id, n, pass, rate: n ? pass / n : 0, wilson95: wilsonInterval(pass, n, 0.95), posterior: betaPosterior(pass, n, level),
    costPerSuccess: costPerSuccessInterval(a.runs, level, seed), meanCostInr: n ? total / n : 0, totalCostInr: total,
  };
}

/**
 * The stopping rule (see the top of the file). `minN` runs per live arm before anything is concluded: an interval on three results says nothing.
 * Arms already `dropped` earlier are passed in `out` and stay out.
 */
export function decide(arms: readonly ArmRuns[], o: DecideOptions & { out?: readonly string[] } = {}): Decision {
  const confidence = o.confidence ?? 0.9;
  const minN = o.minN ?? 4;
  const level = o.level ?? 0.9;
  const seed = o.seed ?? 1;
  const out = new Set(o.out ?? []);
  const base = arms.map((a) => armStat(a, level, seed));
  const live = base.filter((s) => !out.has(s.id));
  const short = live.some((s) => s.n < minN);
  const dominatedBy = new Map<string, string>();
  // With k arms there are k(k-1) pairs to look at, and some equal arm will look worse than another by chance: dropping needs the evidence to be stronger the more arms
  // there are (the share of doubt allowed, 1 - confidence, is divided by the arms that could beat it). Naming a winner keeps the plain `confidence`.
  const dropConfidence = 1 - (1 - confidence) / Math.max(1, live.length - 1);
  if (!short) {
    for (const x of live) {
      for (const y of live) {
        if (x.id === y.id || dominatedBy.has(y.id)) continue;
        // y is better than x on success, and cheaper per success, each with probability >= dropConfidence.
        const better = probGreater(y.posterior, x.posterior) >= dropConfidence;
        const cheaper = probCheaper(arms.find((a) => a.id === y.id)!.runs, arms.find((a) => a.id === x.id)!.runs, seed + 11) >= dropConfidence;
        if (better && cheaper) { dominatedBy.set(x.id, y.id); break; }
      }
    }
  }
  const stay = live.filter((s) => !dominatedBy.has(s.id));
  const pb = probBest(stay.map((s) => s.posterior));
  const pBestOf = new Map(stay.map((s, i) => [s.id, pb[i]!]));
  const stats: ArmStat[] = base.map((s) => ({ ...s, pBest: pBestOf.get(s.id) ?? 0, ...(dominatedBy.has(s.id) ? { dominatedBy: dominatedBy.get(s.id)! } : {}) }));
  const leaderStat = [...stay].sort((a, b) => (pBestOf.get(b.id)! - pBestOf.get(a.id)!) || a.costPerSuccess.point - b.costPerSuccess.point)[0];
  const drop = [...dominatedBy.keys()];
  if (!leaderStat) return { arms: stats, leader: null, decided: false, state: "short", reason: "no arm has run yet", drop };
  if (short) return { arms: stats, leader: leaderStat.id, decided: false, state: "short", reason: `every arm needs ${minN} runs before anything is concluded (fewest so far: ${Math.min(...live.map((s) => s.n))})`, drop };
  if (stay.length === 1) return { arms: stats, leader: leaderStat.id, decided: true, state: "last", reason: `${leaderStat.id} is the only arm left: every other is dominated (worse on success and dearer per success)`, drop };
  const p = pBestOf.get(leaderStat.id)!;
  if (p >= confidence) return { arms: stats, leader: leaderStat.id, decided: true, state: "clear", reason: `${leaderStat.id} is the best with probability ${p.toFixed(2)} (needed ${confidence})`, drop };
  return { arms: stats, leader: leaderStat.id, decided: false, state: "open", reason: `${leaderStat.id} leads with probability ${p.toFixed(2)} of being the best (needed ${confidence}); the intervals still overlap`, drop };
}

// ------------------------------------------------------------------------------- repeats / variance

export interface TaskRuns { task: string; outcomes: boolean[] }

/** A task is FLAKY when the same arm, run again on it, did not give the same answer. */
export function flakyTasks(rs: readonly TaskRuns[]): { flaky: string[]; repeated: number; rate: number } {
  const repeated = rs.filter((r) => r.outcomes.length >= 2);
  const flaky = repeated.filter((r) => r.outcomes.some((o) => o) && r.outcomes.some((o) => !o)).map((r) => r.task);
  return { flaky, repeated: repeated.length, rate: repeated.length ? flaky.length / repeated.length : 0 };
}

/** The standard deviation of a success rate over its runs (the binomial's, sqrt(p(1-p)/n)): how far a rerun may move it. */
export function rateSd(pass: number, n: number): number {
  if (n <= 0) return 0.5;
  const p = pass / n;
  return Math.sqrt((p * (1 - p)) / n);
}

/**
 * THE NUMBERS OF THE BAKE-OFF: pass rates with honest intervals, cost per pass, latency percentiles, and the rule that drops a candidate early.
 *
 * EARLY STOP, THE SEQUENTIAL RULE. Candidates of a tier are run in waves, easy checks first. After each wave a candidate X is DROPPED when some other
 * candidate L (the leader) is clearly better and no dearer per pass:
 *
 *     lower95(L.pass rate) > upper95(X.pass rate)        the Wilson intervals do not overlap, L above X
 *     and L.cost per pass <= X.cost per pass             L is not the more expensive way to get a pass
 *
 * and only once both have at least MIN_N results (an interval on three results says nothing). The leader is the candidate with the best pass rate, the
 * cheaper per pass among ties. A tier always keeps at least `keep` candidates (two by default), so a ladder has a fallback rung. Dropped candidates
 * are not asked again, which is where the money is saved: only survivors reach the real tasks.
 */
export const MIN_N = 8;

export interface Tally { pass: number; n: number; costUsd: number }

/** Wilson score interval, 95%. */
export function wilson(pass: number, n: number): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = pass / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

/** Dollars per pass; infinite when nothing passed. */
export const costPerPass = (t: Tally): number => (t.pass > 0 ? t.costUsd / t.pass : Number.POSITIVE_INFINITY);

export function leaderOf<T extends Tally>(rows: ReadonlyArray<{ id: string } & T>): ({ id: string } & T) | undefined {
  return [...rows].filter((r) => r.n > 0).sort((a, b) => b.pass / b.n - a.pass / a.n || costPerPass(a) - costPerPass(b))[0];
}

/** Whether `x` is clearly worse than `leader` (see the rule above). */
export function clearlyWorse(leader: Tally, x: Tally, minN = MIN_N): boolean {
  if (leader.n < minN || x.n < minN) return false;
  if (wilson(leader.pass, leader.n).lo <= wilson(x.pass, x.n).hi) return false;
  return costPerPass(leader) <= costPerPass(x);
}

/** The ids to drop from a tier after a wave, never leaving fewer than `keep` alive. */
export function toDrop(rows: ReadonlyArray<{ id: string } & Tally>, keep = 2, minN = MIN_N): string[] {
  const leader = leaderOf(rows);
  if (!leader) return [];
  const worse = rows.filter((r) => r.id !== leader.id && clearlyWorse(leader, r, minN)).sort((a, b) => a.pass / Math.max(1, a.n) - b.pass / Math.max(1, b.n));
  const room = Math.max(0, rows.length - keep);
  return worse.slice(0, room).map((r) => r.id);
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i]!;
}

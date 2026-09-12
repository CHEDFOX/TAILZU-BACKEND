/**
 * Staged rollout — the difference between "change a flag" and "run an
 * experiment".
 *
 * Every keyboard/app flag is global today: a value change hits 100% of the
 * install base at once, and you learn it was wrong from reviews. This module
 * puts a targeting layer over the flag map so any flag can be scoped to a
 * slice of users:
 *
 *     { flag: "kb.touch.holdMultiplier", value: 1.4, buckets: [0, 4] }
 *
 * …ships 1.4 to 5% of users and leaves the other 95% on the baked-in default.
 * If it's wrong, 5% had a bad hour instead of everyone having a bad day.
 *
 * Two properties matter and both are load-bearing:
 *
 *  • STABILITY — a user's bucket is derived from their id alone, so it never
 *    changes between requests. A keyboard that re-rolled its bucket on every
 *    config refresh would flip settings under the user's fingers mid-sentence.
 *
 *  • INDEPENDENCE — the hash is salted per flag, so a user in bucket 3 for one
 *    experiment isn't automatically in bucket 3 for every other. Without the
 *    salt, the same unlucky 5% would receive every single experiment, and
 *    their experience (and your results) would be systematically skewed.
 */

/** Rules are authored in code (reviewed, deployed) or injected via the
 *  KB_ROLLOUTS env var as JSON for an experiment that can't wait for a
 *  deploy. */
export interface RolloutRule {
  /** Flag key to override, e.g. "kb.haptics.style". */
  flag: string;
  /** Value the targeted slice receives. Any JSON value the flag accepts. */
  value: unknown;
  /** Inclusive bucket range, 0–99. [0, 4] targets 5% of users. */
  buckets: [number, number];
  /** Optional note for whoever reads this six months from now. */
  note?: string;
}

/**
 * Stable 0–99 bucket for (user, flag). djb2 over the salted id — not
 * cryptographic, just well-distributed and cheap; this decides which build of
 * a keyboard someone gets, not who can read what.
 */
export function bucketFor(userId: string, salt = ""): number {
  const s = `${salt}:${userId}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // h * 33 + c, kept unsigned
  }
  return h % 100;
}

/** Does this user fall inside the rule's target slice? */
export function matchesRule(userId: string, rule: RolloutRule): boolean {
  const [lo, hi] = rule.buckets;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  // Salt by flag so experiments are independent of each other.
  const b = bucketFor(userId, rule.flag);
  return b >= Math.min(lo, hi) && b <= Math.max(lo, hi);
}

/**
 * Parse rules from the KB_ROLLOUTS env var. Malformed entries are DROPPED
 * with a warning rather than throwing: a typo in an experiment definition
 * must never take the keyboard config endpoint down.
 */
export function parseRollouts(raw: string | undefined): RolloutRule[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[rollout] KB_ROLLOUTS is not valid JSON — ignoring all rules");
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error("[rollout] KB_ROLLOUTS must be a JSON array — ignoring");
    return [];
  }
  const out: RolloutRule[] = [];
  for (const item of parsed) {
    const r = item as Partial<RolloutRule>;
    const buckets = r?.buckets;
    if (
      typeof r?.flag !== "string" || !r.flag ||
      !Array.isArray(buckets) || buckets.length !== 2 ||
      typeof buckets[0] !== "number" || typeof buckets[1] !== "number" ||
      !("value" in (r as object))
    ) {
      console.error("[rollout] dropping malformed rule:", JSON.stringify(item)?.slice(0, 200));
      continue;
    }
    out.push({ flag: r.flag, value: r.value, buckets: [buckets[0], buckets[1]], note: r.note });
  }
  return out;
}

/**
 * Apply the matching rules to a flag map. Returns a NEW object — the caller's
 * baseline map is shared across requests and must never be mutated per-user.
 *
 * Anonymous callers (no userId) get the baseline untouched: bucketing someone
 * we can't identify would hand them a different experience on every request.
 */
export function applyRollouts<T extends Record<string, unknown>>(
  flags: T,
  userId: string | undefined,
  rules: RolloutRule[],
): T {
  if (!userId || !rules.length) return flags;
  let out: T | null = null;
  for (const rule of rules) {
    if (!matchesRule(userId, rule)) continue;
    if (!out) out = { ...flags };
    (out as Record<string, unknown>)[rule.flag] = rule.value;
  }
  return out ?? flags;
}

/**
 * Rules authored in code. Empty by default — add an entry to start an
 * experiment, remove it (or widen it to [0, 99]) to conclude one.
 *
 * Example:
 *   { flag: "kb.haptics.style", value: "light", buckets: [0, 9],
 *     note: "2026-08: is a softer tick preferred? 10%" }
 */
export const ROLLOUTS: RolloutRule[] = [];

/** Code rules + env rules. Env wins on a duplicate flag so an experiment can
 *  be corrected or killed without waiting for a deploy. */
export function activeRollouts(): RolloutRule[] {
  const env = parseRollouts(process.env.KB_ROLLOUTS);
  if (!env.length) return ROLLOUTS;
  const envFlags = new Set(env.map((r) => r.flag));
  return [...ROLLOUTS.filter((r) => !envFlags.has(r.flag)), ...env];
}

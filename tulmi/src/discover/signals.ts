/**
 * WHAT A PERSON DID, AND HOW MUCH IT TELLS US. The raw evidence the taste profile learns from (taste.ts).
 *
 *   weightOf({ kind: "keep" })                 ->  3
 *   weightOf({ kind: "dwell", ms: 6000 })      ->  about 1.2
 *
 * The weights are the opinion in this file, and they are deliberate:
 *
 *   SHOWN is worth NOTHING. Being shown a place is evidence of what we chose, not of what they like. It is still
 *   recorded, because the count of what we showed is the only thing that lets us normalise interest against our
 *   own bias (taste.ts exposureNormalised) — without it the feed learns to love whatever it already shows.
 *
 *   NEGATIVE EVIDENCE COUNTS. A profile built only from keeps goes bland, because it can never rule anything out.
 *   A skip is mildly negative; "not for me" is the strongest signal in the set, stronger than a keep is positive,
 *   because somebody taking the trouble to reject something means it.
 *
 *   DWELL IS DESIRE, MEASURED WITHOUT ASKING — and it is weak on purpose. A tile was on the screen; nobody can say
 *   it was looked at, and in two columns we cannot even say which side. Under 1.2s is a scroll-past and counts
 *   against. Over 12s adds nothing further. At its very strongest it is worth less than one keep.
 */

export const SIGNALS = [
  "shown", "dwell", "open", "keep", "unkeep", "share", "to_trip", "skip", "not_for_me", "more_like_this",
  "ranked",
] as const;

export type SignalKind = (typeof SIGNALS)[number];

const KIND_SET: ReadonlySet<string> = new Set(SIGNALS);
export const isSignalKind = (v: unknown): v is SignalKind => typeof v === "string" && KIND_SET.has(v);

/**
 * Evidence weight per kind. Positive adds positive evidence, negative adds negative.
 * `dwell` is scaled by how long (dwellWeight) and `ranked` by where in the order (onboarding.ts).
 */
export const WEIGHT: Record<SignalKind, number> = {
  shown: 0,
  dwell: 0.5,
  open: 1,
  keep: 3,
  unkeep: -3,
  share: 2,
  to_trip: 4,
  skip: -0.5,
  not_for_me: -5,
  more_like_this: 4,
  ranked: 0,
};

/** Below this a look is a scroll-past, and counts against rather than for. */
export const DWELL_MIN_MS = 1_200;
/** Past this, longer tells us nothing more: staring for a minute is not thirty times a two-second look. */
export const DWELL_FULL_MS = 12_000;

export function dwellWeight(ms: number): number {
  if (!Number.isFinite(ms) || ms < DWELL_MIN_MS) return WEIGHT.skip;
  const capped = Math.min(ms, DWELL_FULL_MS);
  const through = (capped - DWELL_MIN_MS) / (DWELL_FULL_MS - DWELL_MIN_MS);
  // 0.5 at the threshold, 2.0 when saturated — always less than a keep.
  return 0.5 + 1.5 * through;
}

/** A tile counts as seen at all only when this much of it was on screen for this long. */
export const SEEN_FRACTION = 0.5;
export const SEEN_MS = 300;

export interface Signal {
  kind: SignalKind;
  /** The card it happened to. */
  slug: string;
  /** Only for dwell: how long it was on screen. */
  ms?: number;
  /** Only for ranked: its place in the order, 1 is first. */
  rank?: number;
  /** How many were in the order, for ranked. */
  of?: number;
}

/** What this signal is worth as evidence. */
export function weightOf(s: Pick<Signal, "kind" | "ms" | "rank" | "of">): number {
  if (s.kind === "dwell") return dwellWeight(s.ms ?? 0);
  if (s.kind === "ranked") return rankWeight(s.rank ?? 1, s.of ?? 1);
  return WEIGHT[s.kind];
}

/** The strongest a first place is worth: the same as a keep, no more. */
export const RANK_SCALE = 2.5;

/**
 * WHERE SOMETHING SITS IN AN ORDER, AS EVIDENCE. Ranking every image is worth far more than ticking a few: six
 * ticked boxes have 64 possible answers, six ordered images have 720, from the same number of taps. And an order
 * gives us the bottom as well as the top, which a tick never does.
 *
 * Symmetric around the middle, so with six: +2.5, +1.5, +0.5, -0.5, -1.5, -2.5. First place is as strong as a
 * keep; last place is real evidence against; the middle is near zero, which is honest — third of six means little.
 */
export function rankWeight(rank: number, of: number): number {
  if (!Number.isFinite(rank) || !Number.isFinite(of) || of < 2) return 0;
  const r = Math.min(Math.max(1, Math.round(rank)), of);
  return (RANK_SCALE * (of + 1 - 2 * r)) / (of - 1);
}

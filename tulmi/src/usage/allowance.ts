/**
 * Earned words — the free plan that grows when you use it.
 *
 * A flat 2,500-word cap has one shape: it goes down. Every dictation moves the
 * user closer to being stopped, and the only event the meter can ever produce
 * is a refusal. That is a bad month for a user who liked the product, and a bad
 * conversion for us — someone hits the wall in week one, feels metered rather
 * than rewarded, and deletes the app before the habit forms.
 *
 * So the ceiling moves. Coming back tomorrow earns words. Coming back the day
 * after earns more. A day of real use — several dictations, not one — earns
 * more again. The number that used to only fall now also rises, and it rises
 * for the behaviour that makes someone a subscriber: the habit.
 *
 * WHAT IS REWARDED, AND WHAT IS NOT
 *
 * Frequency, never volume. Paying per word spoken would hand the biggest free
 * allowance to exactly the users whose transcription costs us the most, and
 * delay the moment they pay. Returning costs us nothing and is the only
 * behaviour that predicts a subscription. So: a day counts once, however much
 * is said in it.
 *
 * DERIVED, NEVER STORED
 *
 * Every grant is computed from the usage rows that already exist. No ledger, no
 * migration, no write path, and — the reason that matters — no way for the
 * number the stats screen shows and the number the quota check enforces to
 * drift apart. They are the same function of the same rows.
 *
 * WHY THE AMOUNT IS A SURPRISE
 *
 * A fixed ladder — 100, then 125, then 150 — is a schedule. The user learns it
 * in three days, and from the fourth it is arithmetic: they know exactly what
 * tomorrow is worth, so tomorrow carries no anticipation and the reward stops
 * being a reward. Worse, the app was announcing it ("come back tomorrow for 125
 * more words"), which turns the whole mechanic into a stated price for their
 * attention.
 *
 * A variable amount is the oldest finding in this area and the only one that
 * survives contact with real users: rewards that vary in size hold attention
 * far longer than rewards that do not, because the anticipation is the thing
 * being felt, and anticipation needs uncertainty to exist. So the day's grant
 * lands in one of four tiers, most days small, rarely very large, and the app
 * never says which is coming.
 *
 * Random, but not arbitrary: the roll is a hash of the user and the day, so the
 * same day always yields the same number. It cannot be re-rolled by reopening
 * the app, it survives a server restart, it needs no storage, and two devices
 * signed into one account agree. Uncertainty for the user, determinism for us.
 */
import { getConfig } from "../config.js";

/** How big a day's roll came out. Named so the app can style the good ones. */
export type Tier = "small" | "good" | "big" | "huge";

/** One earning event, in the shape the app shows it. */
export type Grant = {
  kind: "streak" | "burst";
  /** UTC date, YYYY-MM-DD. */
  day: string;
  words: number;
  /** Human-readable, e.g. "Day 3". The app shows this verbatim. */
  label: string;
  tier?: Tier;
};

export type Allowance = {
  /** The plan's own words, before anything is earned. */
  base: number;
  /** Earned this month, already capped. */
  earned: number;
  /** base + earned — what the quota check actually enforces. */
  total: number;
  used: number;
  /** Never negative: over the cap it is 0, not a debt. */
  remaining: number;
  /** Consecutive active days ending today or yesterday. */
  streakDays: number;
  /** Most recent first. */
  grants: Grant[];
  /**
   * Deliberately absent: what tomorrow is worth.
   *
   * It used to be here, and the app said it out loud. Naming the number turns
   * anticipation into arithmetic — the user knows the price of their return
   * before they make it, and a known reward is a transaction. The amount is
   * now a roll they cannot predict, so there is nothing to announce.
   */
  /** Words earned per visit, oldest first — the shape the pie chart draws. */
  perVisit: Array<{ day: string; words: number; sessions: number; tier: Tier }>;
  /** True once earning is capped for the month. */
  maxed: boolean;
};

/** A usage row, reduced to what earning cares about. */
export type UsageMoment = { at: number; words: number };

/** UTC day key. Days are UTC so the enforced number and the shown one agree
 *  wherever the user travels; a streak that changes with a flight is worse
 *  than one that turns over at an unfamiliar hour. */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayIndex(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 86_400_000);
}

/**
 * A number in [0,1) from a string — FNV-1a, then scaled.
 *
 * Deterministic on purpose. Math.random would re-roll the same day on every
 * request: the stats screen would disagree with itself between two refreshes,
 * and the quota check would disagree with both. Hashing the user and the day
 * gives a value that is unguessable from outside and identical every time it
 * is asked for, with nothing stored anywhere.
 */
function roll(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

/**
 * The tiers, and how often each comes up.
 *
 * Most days are small; the rare large day is what the user remembers and what
 * they are unconsciously playing for. The bands are deliberately far apart —
 * a "big" day that is 20% better than a small one is not felt as different,
 * and a mechanic nobody can feel is just arithmetic with extra steps.
 *
 * Sized against the 800-word plan rather than in the abstract. A huge day is
 * half the plan again, which is a real event; a small day is a nudge. When the
 * base moves, these have to move with it, or the ratio that makes any of this
 * feel like a reward quietly becomes something else.
 */
const TIERS: Array<{ tier: Tier; upTo: number; words: number }> = [
  { tier: "small", upTo: 0.62, words: 30 },
  { tier: "good",  upTo: 0.90, words: 70 },
  { tier: "big",   upTo: 0.985, words: 150 },
  { tier: "huge",  upTo: 1.01, words: 400 },
];

/**
 * What one day is worth.
 *
 * The streak does not set the amount — it tilts the odds. A long streak shifts
 * the roll upward, so good days get commoner the longer someone keeps coming
 * back, without ever making tomorrow's number knowable. That is the difference
 * between a reward that builds and a price list that grows.
 */
function dayGrant(seed: string, day: string, streak: number): { words: number; tier: Tier } {
  const r = roll(`${seed}:${day}`);
  // Up to a 0.22 nudge toward the good end, reached at a two-week streak.
  const tilt = Math.min(0.22, 0.02 * (streak - 1));
  const shifted = Math.min(0.999, r + tilt);
  const hit = TIERS.find((t) => shifted < t.upTo) ?? TIERS[0];
  return { words: hit.words, tier: hit.tier };
}

/**
 * What this month's usage has earned.
 *
 * `moments` is every dictation in the current window; `now` is injectable so
 * the streak's "ending today or yesterday" rule is testable.
 */
export function computeAllowance(
  moments: UsageMoment[],
  now = Date.now(),
  seed = "",
): Allowance {
  const cfg = getConfig();
  const base = cfg.FREE_MONTHLY_WORDS;
  const maxEarn = cfg.EARN_MAX_WORDS;

  const used = moments.reduce((n, m) => n + (m.words || 0), 0);

  // Sessions per day. A day is the unit of reward; a session is only used to
  // tell a day of real use from a day someone opened the app once.
  const perDay = new Map<string, number>();
  for (const m of moments) {
    const k = dayKey(m.at);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const days = Array.from(perDay.keys()).sort();

  const grants: Grant[] = [];
  const perVisit: Allowance["perVisit"] = [];
  let streak = 0;
  let prev = -Infinity;
  for (const day of days) {
    const idx = dayIndex(day);
    streak = idx === prev + 1 ? streak + 1 : 1;
    prev = idx;

    // The day's roll. Unpredictable to the user, fixed for that user and day.
    const { words, tier } = dayGrant(seed, day, streak);
    grants.push({
      kind: "streak",
      day,
      words,
      label: streak === 1 ? "First day back" : `Day ${streak}`,
      tier,
    });
    perVisit.push({ day, words, sessions: perDay.get(day) ?? 0, tier });

    // The burst grant. Rewards a day of real use over a day of one dictation,
    // which is the difference between someone trying the app and someone
    // living in it.
    const sessions = perDay.get(day) ?? 0;
    if (sessions >= cfg.EARN_BURST_SESSIONS) {
      grants.push({
        kind: "burst",
        day,
        words: cfg.EARN_BURST_WORDS,
        label: `${sessions} dictations in a day`,
      });
      const last = perVisit[perVisit.length - 1];
      if (last && last.day === day) last.words += cfg.EARN_BURST_WORDS;
    }
  }

  // Cap the TOTAL, not each grant: the earned number must be legible as the
  // sum of what the app showed, and a per-grant cap would make it a sum the
  // user cannot reproduce.
  const rawEarned = grants.reduce((n, g) => n + g.words, 0);
  const earned = Math.min(maxEarn, rawEarned);

  // The streak only counts if it reaches now. A run that ended last week is
  // history: those days were paid for when they happened, and the next return
  // starts again at day one.
  const today = dayIndex(dayKey(now));
  const lastDay = days.length ? dayIndex(days[days.length - 1]) : -Infinity;
  const streakDays = today - lastDay <= 1 ? streak : 0;

  const maxed = earned >= maxEarn;
  const total = base + earned;
  return {
    base,
    earned,
    total,
    used,
    remaining: Math.max(0, total - used),
    streakDays,
    grants: grants.reverse(),
    perVisit,
    maxed,
  };
}

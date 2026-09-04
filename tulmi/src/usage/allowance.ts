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
 */
import { getConfig } from "../config.js";

/** One earning event, in the shape the app shows it. */
export type Grant = {
  kind: "streak" | "burst";
  /** UTC date, YYYY-MM-DD. */
  day: string;
  words: number;
  /** Human-readable, e.g. "Day 3 in a row". The app shows this verbatim. */
  label: string;
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
   * What the next return is worth, so the app can say it before it happens.
   * The whole mechanic depends on the user knowing the number is climbing.
   */
  nextStreakWords: number;
  /** True once earning is capped — the app stops promising more. */
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
 * What this month's usage has earned.
 *
 * `moments` is every dictation in the current window; `now` is injectable so
 * the streak's "ending today or yesterday" rule is testable.
 */
export function computeAllowance(moments: UsageMoment[], now = Date.now()): Allowance {
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
  let streak = 0;
  let prev = -Infinity;
  for (const day of days) {
    const idx = dayIndex(day);
    streak = idx === prev + 1 ? streak + 1 : 1;
    prev = idx;

    // The streak grant. Worth more each consecutive day, to a ceiling — the
    // curve is what makes day four feel different from day one, and the
    // ceiling is what stops a two-month streak from being free forever.
    const words = Math.min(
      cfg.EARN_STREAK_MAX_WORDS,
      cfg.EARN_STREAK_WORDS + cfg.EARN_STREAK_STEP_WORDS * (streak - 1),
    );
    grants.push({
      kind: "streak",
      day,
      words,
      label: streak === 1 ? "First day back" : `Day ${streak} in a row`,
    });

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
  const nextStreakWords = maxed
    ? 0
    : Math.min(
        cfg.EARN_STREAK_MAX_WORDS,
        cfg.EARN_STREAK_WORDS + cfg.EARN_STREAK_STEP_WORDS * streakDays,
      );

  const total = base + earned;
  return {
    base,
    earned,
    total,
    used,
    remaining: Math.max(0, total - used),
    streakDays,
    grants: grants.reverse(),
    nextStreakWords,
    maxed,
  };
}

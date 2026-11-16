/**
 * THE WORDS A PLACE IS DESCRIBED IN, AND WHEN IT IS AT ITS BEST.
 *
 * The tag list is CLOSED and it is a contract, not a free-form label set: the model picks from it and nothing else, the
 * catalogue is filed under it, and what a person likes is counted in the same words. A tag added here must be added
 * deliberately — every card already written is filed without it.
 *
 *   tagsOf(["warm", "beach", "nonsense"])   -> ["warm", "beach"]        unknown words dropped, never invented
 *   seasonFrom([12, 1, 2])                  -> a bitmask
 *   inSeason(mask, 3)                       -> is March one of its months
 *   seasonWords(mask)                       -> "December to February"   a run that wraps the new year stays one run
 *
 * Ported from the Firo backend (src/modules/catalog/domain/taxonomy.ts), which has no framework in it; the months
 * arithmetic and its wrapping behaviour are unchanged, so the two catalogues stay readable to each other.
 */

export const TAGS = [
  "adventure", "luxury", "culture", "nature", "photography", "food", "hiking", "road_trip",
  "nightlife", "wildlife", "architecture", "history", "camping", "minimalism", "cold", "warm",
  "water", "mountains", "desert", "solitude", "social", "beach", "island", "city",
] as const;

export type Tag = (typeof TAGS)[number];

const TAG_SET: ReadonlySet<string> = new Set(TAGS);

export const isTag = (v: unknown): v is Tag => typeof v === "string" && TAG_SET.has(v);

/** The tags in a list that are really tags, in order, without repeats. Anything else is dropped silently. */
export function tagsOf(values: readonly unknown[]): Tag[] {
  const out: Tag[] = [];
  for (const v of values) {
    if (isTag(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export const BUDGETS = ["budget", "moderate", "premium", "luxury"] as const;
export type Budget = (typeof BUDGETS)[number];
export const isBudget = (v: unknown): v is Budget => typeof v === "string" && (BUDGETS as readonly string[]).includes(v);

/** Months 1-12 as bits, so "is it good in March" is one integer test. */
export type SeasonMask = number;
export const ALL_YEAR: SeasonMask = 0b1111_1111_1111;

export function seasonFrom(months: readonly number[]): SeasonMask {
  let mask = 0;
  for (const m of months) {
    if (Number.isInteger(m) && m >= 1 && m <= 12) mask |= 1 << (m - 1);
  }
  return mask;
}

export function inSeason(mask: SeasonMask, month: number): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  return (mask & (1 << (month - 1))) !== 0;
}

export function monthsOf(mask: SeasonMask): number[] {
  const out: number[] = [];
  for (let m = 1; m <= 12; m += 1) if (inSeason(mask, m)) out.push(m);
  return out;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * A season as a person would say it: "December to February", "June", "All year".
 * Winter is one season, not "January to February, and December", so runs are found on a circle.
 */
export function seasonWords(mask: SeasonMask, short = false): string | null {
  const months = monthsOf(mask);
  if (months.length === 0) return null;
  if (months.length === 12) return "All year";

  const names = short ? SHORT : MONTHS;
  const has = new Set(months);

  // Start just after a gap, so a run crossing December into January is kept whole.
  let start = 1;
  while (has.has(start)) start = (start % 12) + 1;

  const runs: Array<[number, number]> = [];
  let from: number | null = null;
  let last = 0;
  for (let step = 0; step < 12; step += 1) {
    const month = ((start - 1 + step) % 12) + 1;
    if (has.has(month)) {
      if (from === null) from = month;
      last = month;
    } else if (from !== null) {
      runs.push([from, last]);
      from = null;
    }
  }
  if (from !== null) runs.push([from, last]);

  const phrases = runs.map(([a, b]) => (a === b ? names[a - 1]! : `${names[a - 1]} to ${names[b - 1]}`));
  if (phrases.length === 1) return phrases[0]!;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/**
 * Days left of this season, counting from `day` — for "11 days left in season", which is the one piece of urgency
 * that is true. Null when the place is not in season now, or is in season all year.
 */
export function daysLeftInSeason(mask: SeasonMask, day: Date): number | null {
  if (mask === ALL_YEAR || mask === 0) return null;
  const month = day.getUTCMonth() + 1;
  if (!inSeason(mask, month)) return null;

  // Walk to the first day of the first month that is NOT in season.
  let endYear = day.getUTCFullYear();
  let endMonth = month;
  for (let step = 0; step < 12; step += 1) {
    endMonth += 1;
    if (endMonth > 12) { endMonth = 1; endYear += 1; }
    if (!inSeason(mask, endMonth)) break;
  }
  const end = Date.UTC(endYear, endMonth - 1, 1);
  const today = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return Math.max(0, Math.round((end - today) / 86_400_000));
}

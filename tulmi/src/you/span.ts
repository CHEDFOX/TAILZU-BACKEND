/**
 * WHAT A PERSON'S USE IS COUNTED IN, FOR THE WORDS THAT ARE NOT DRAWN ON A SCREEN: a Xode job that pauses for more says so in its
 * notification and on its record ("This job has used a lot of this stretch."), and a person on the free plan has no stretches, only the
 * month (src/you/usage.ts). The screens know from the meter (kit.ts spanOf); this answers the job's loop, which runs away from them.
 *
 * Set by the You routes over the usage meter (routes/botsYou.ts). Unset (the Cloudflare Worker, tests), or the meter cannot be read: null,
 * and the words say what is true for every plan ("what it was given") instead of guessing.
 */
export type UsageSpanSource = (userId: string) => Promise<boolean>;
let source: UsageSpanSource | null = null;

/** The meter's answer: is this person's month used in stretches? */
export function setUsageSpan(s: UsageSpanSource | null): void { source = s; }

/** "this stretch", "this month" (the free plan), or null when it cannot be known. Never throws. */
export async function usageSpanWords(userId: string): Promise<"this stretch" | "this month" | null> {
  if (!source || !userId) return null;
  try {
    return (await source(userId)) ? "this stretch" : "this month";
  } catch {
    return null;
  }
}

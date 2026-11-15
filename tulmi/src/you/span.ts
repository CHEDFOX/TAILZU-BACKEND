/**
 * WHAT A PERSON'S USE IS COUNTED IN, FOR THE WORDS THAT ARE NOT DRAWN ON A SCREEN: a Xode job that pauses for more says so in its
 * notification and on its record ("This job has used a lot of this month."). A month is one allowance now, so that is what every plan
 * hears, unless the server has put the five windows back (USAGE_STRETCHES, src/you/usage.ts). The screens know from the meter (kit.ts
 * spanOf); this answers the job's loop, which runs away from them.
 *
 * Set by the You routes over the usage meter (routes/bots/botsYou.ts). Unset (the Cloudflare Worker, tests), or the meter cannot be read: null,
 * and the words say what is true for every plan ("what it was given") instead of guessing.
 */
export type UsageSpanSource = (userId: string) => Promise<boolean>;
let source: UsageSpanSource | null = null;

/** The meter's answer: is this person's month cut into windows? No, unless USAGE_STRETCHES is on. */
export function setUsageSpan(s: UsageSpanSource | null): void { source = s; }

/** "this month", "this stretch" on a server with the windows back, or null when it cannot be known. Never throws. */
export async function usageSpanWords(userId: string): Promise<"this stretch" | "this month" | null> {
  if (!source || !userId) return null;
  try {
    return (await source(userId)) ? "this stretch" : "this month";
  } catch {
    return null;
  }
}

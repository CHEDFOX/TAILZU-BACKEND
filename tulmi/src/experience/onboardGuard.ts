/**
 * WHO HAS ALREADY BEEN ONBOARDED WITHOUT BEING ASKED.
 *
 * The new onboarding ends at Done, and Done is what marks a person onboarded.
 * Before it, an account got the mark from the old steps, or from a phone that
 * already had the microphone and the keyboard, or never: someone who only ever
 * used the desktop app (which had no onboarding) is "not onboarded" in the
 * profile and has been dictating for months. Served the new flow, every one of
 * those accounts would be walked through it once, on a phone, as if new.
 *
 * Anyone who has already dictated has had the product explained by using it.
 * Any words at all, or any history, is enough. Both are read: the words from
 * the metering the bootstrap already has, the history only when there are no
 * words (one cheap row), because a person can have written something that was
 * kept without it being counted, and the reverse.
 */
import type { AuthedUser } from "../auth/supabase.js";
import { listHistory } from "../history/store.js";

export async function hasAlreadyDictated(
  user: AuthedUser,
  wordsEver: number,
  history: (user: AuthedUser, opts: { limit: number }) => Promise<{ entries: unknown[] }> = listHistory,
): Promise<boolean> {
  if (wordsEver > 0) return true;
  try {
    return (await history(user, { limit: 1 })).entries.length > 0;
  } catch {
    // A read that failed says nothing either way: they are asked, as a new person is.
    return false;
  }
}

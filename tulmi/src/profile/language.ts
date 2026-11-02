/**
 * The language a request should be written in.
 */

import type { Personality } from "../../../shared/types/api.js";
import type { AuthedUser } from "../auth/supabase.js";
import { getProfile } from "./store.js";

/**
 * The language a request should be written in.
 *
 * Clients send a hint, but the hint is a copy of the user's choice made at
 * first launch and does not always follow later changes — the iOS keyboard
 * reads it from a shared store that Settings did not update, so a Hindi
 * speaker who had picked English once kept getting Hindi speech "refined"
 * toward English. The profile is the source of truth for that choice, so
 * when the client sends nothing, or "auto", the profile decides. A real code
 * from the client still wins: a per-request override is a deliberate act.
 *
 * One extra read, and only on the fallback path.
 */
export async function effectiveLanguage(
  user: AuthedUser,
  hint: string | undefined,
  personality?: Personality,
): Promise<string> {
  if (hint && hint !== "auto") return hint;
  // The Languages card, primary first. Free when the caller already holds the
  // personality — which every one of these handlers does.
  const first = personality?.languages?.[0];
  if (first && first !== "auto") return String(first);
  const profile = await getProfile(user).catch(() => null);
  const l = profile?.language;
  return l && l !== "auto" ? l : "auto";
}

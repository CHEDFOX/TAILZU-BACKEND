/**
 * Per-user profile: language preference + onboarding state. Persisted in the
 * Supabase `profiles` table via the user's JWT (RLS-scoped) or the service-role
 * client. Falls back to an in-memory map under DEV_SKIP_AUTH so the flow still
 * works without a database.
 */
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";

export type Gender = "female" | "male" | "other";

export interface Profile {
  language: string; // 'auto' | 'en' | 'hi' | 'hinglish' | ...
  onboarded: boolean;
  /** From the name + gender card. Absent until the user fills it in. */
  fullName?: string;
  gender?: Gender;
}

const DEFAULT_PROFILE: Profile = { language: "auto", onboarded: false };
const memory = new Map<string, Profile>();

export async function getProfile(user: AuthedUser): Promise<Profile> {
  const sb = dataClientFor(user);
  if (!sb) return memory.get(user.id) ?? { ...DEFAULT_PROFILE };

  const { data, error } = await sb
    .from("profiles")
    .select("language, onboarded, full_name, gender")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // A real query error (transient DB/network hiccup) must NOT fail open to
    // DEFAULT_PROFILE: onboarded=false would re-trigger onboarding and reset an
    // onboarded user's saved language. Propagate so the caller surfaces a
    // retryable 5xx (Fastify's default for a thrown handler error) and can
    // serve last-known / retry instead of silently defaulting.
    console.error(`[profile] load failed for ${user.id}:`, error.message);
    throw new Error(`Failed to load profile: ${error.message}`);
  }
  // No error + no row = a genuinely new user (maybeSingle returns null data).
  // That — and only that — is the real DEFAULT_PROFILE case.
  if (!data) return { ...DEFAULT_PROFILE };
  return {
    language: data.language ?? DEFAULT_PROFILE.language,
    onboarded: data.onboarded ?? DEFAULT_PROFILE.onboarded,
    fullName: data.full_name ?? undefined,
    gender: (data.gender as Gender | null) ?? undefined,
  };
}

/** Patch a profile (language, onboarding, name, gender). Returns the merged result. */
export async function updateProfile(
  user: AuthedUser,
  patch: Partial<Profile>,
): Promise<Profile> {
  const sb = dataClientFor(user);
  if (!sb) {
    const next = { ...(memory.get(user.id) ?? DEFAULT_PROFILE), ...patch };
    memory.set(user.id, next);
    return next;
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (patch.language !== undefined) row.language = patch.language;
  if (patch.onboarded !== undefined) {
    row.onboarded = patch.onboarded;
    if (patch.onboarded) row.onboarded_at = new Date().toISOString();
  }
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.gender !== undefined) row.gender = patch.gender;

  const { data, error } = await sb
    .from("profiles")
    .upsert(row, { onConflict: "user_id" })
    .select("language, onboarded, full_name, gender")
    .maybeSingle();

  if (error) throw new Error(`Failed to save profile: ${error.message}`);
  return {
    language: data?.language ?? DEFAULT_PROFILE.language,
    onboarded: data?.onboarded ?? DEFAULT_PROFILE.onboarded,
    fullName: data?.full_name ?? undefined,
    gender: (data?.gender as Gender | null) ?? undefined,
  };
}

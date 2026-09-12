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
  /** Last app open, ISO. Set by touchLastSeen on every bootstrap. */
  lastSeenAt?: string;
  /** From the name + gender card. Absent until the user fills it in. */
  fullName?: string;
  gender?: Gender;
}

const DEFAULT_PROFILE: Profile = { language: "auto", onboarded: false };
const memory = new Map<string, Profile>();

/** Columns added by migration 0007. Selected only when they exist. */
let identityColumnsPresent: boolean | null = null;

export async function getProfile(user: AuthedUser): Promise<Profile> {
  const sb = dataClientFor(user);
  if (!sb) return memory.get(user.id) ?? { ...DEFAULT_PROFILE };

  const withIdentity = () =>
    sb.from("profiles")
      .select("language, onboarded, full_name, gender")
      .eq("user_id", user.id)
      .maybeSingle();
  const withoutIdentity = () =>
    sb.from("profiles")
      .select("language, onboarded")
      .eq("user_id", user.id)
      .maybeSingle();

  let res = identityColumnsPresent === false
    ? await withoutIdentity()
    : await withIdentity();

  // Code can reach a database that has not been migrated yet — a deploy and a
  // migration are two separate acts, and they are not always done in that
  // order. Asking for a column that does not exist must degrade to "we don't
  // know this user's name", not take down /v1/app/bootstrap and drop every
  // client onto the Connection screen. Remembered per process, so this costs
  // one failed query on the first request and nothing after.
  if (res.error && isMissingColumn(res.error.message)) {
    console.warn(
      "[profile] full_name/gender missing — run migration 0007. " +
      "Serving profiles without them until then.",
    );
    identityColumnsPresent = false;
    res = await withoutIdentity();
  } else if (!res.error) {
    identityColumnsPresent = true;
  }

  const { data, error } = res;
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
  const row = data as unknown as Record<string, unknown>;
  return {
    language: (row.language as string) ?? DEFAULT_PROFILE.language,
    onboarded: (row.onboarded as boolean) ?? DEFAULT_PROFILE.onboarded,
    fullName: (row.full_name as string | null) ?? undefined,
    gender: (row.gender as Gender | null) ?? undefined,
  };
}

/** Postgres 42703 / PostgREST PGRST204 — the column simply is not there. */
function isMissingColumn(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") ||
    m.includes("schema cache");
}

/** Patch a profile (language, onboarding, name, gender). Returns the merged result. */
/**
 * Record that this user was here.
 *
 * Written on every bootstrap, which is once per app open. Fire and forget at
 * the call site: knowing when someone last visited is worth having and worth
 * nothing at all if it can delay or fail a launch.
 *
 * On profiles rather than its own table because it is a property of the person,
 * and a user forging their own last-visit time costs us nothing.
 */
export async function touchLastSeen(user: AuthedUser): Promise<void> {
  const sb = dataClientFor(user);
  if (!sb) {
    const cur = memory.get(user.id);
    if (cur) memory.set(user.id, { ...cur, lastSeenAt: new Date().toISOString() });
    return;
  }
  const { error } = await sb
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", user.id);
  // A missing column (migration 0008 not yet run) must not look like an
  // outage. It is a stat, not a feature.
  if (error) console.warn(`[profile] last_seen not recorded for ${user.id}: ${error.message}`);
}

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
  // Same exposure as the read: writing a column the database does not have
  // yet would 500 the save. Skip them until the migration has run, so the
  // language/onboarding half of the patch still lands.
  if (identityColumnsPresent !== false) {
    if (patch.fullName !== undefined) row.full_name = patch.fullName;
    if (patch.gender !== undefined) row.gender = patch.gender;
  }

  const { data, error } = await sb
    .from("profiles")
    .upsert(row, { onConflict: "user_id" })
    .select()
    .maybeSingle();

  if (error) throw new Error(`Failed to save profile: ${error.message}`);
  return {
    language: data?.language ?? DEFAULT_PROFILE.language,
    onboarded: data?.onboarded ?? DEFAULT_PROFILE.onboarded,
    fullName: data?.full_name ?? undefined,
    gender: (data?.gender as Gender | null) ?? undefined,
  };
}

/**
 * Per-user personality storage. Saved in the Supabase `personalities` table
 * (one row per user, the profile kept as JSON). Reads/writes go through the
 * user's own JWT (RLS-scoped) or the service-role client — see dataClientFor.
 * When neither is available (DEV_SKIP_AUTH local testing) we fall back to an
 * in-memory map so the feature still works end-to-end without a database.
 */
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";
import { applyPresetOverrides } from "../experience/personalityPresets.js";
import type {
  Personality,
  VocabularyCorrection,
} from "../../../shared/types/api.js";

/** Vocabulary size ceiling — keep the STT bias prompt short and cheap. */
export const VOCAB_MAX_LINES = 200;

const memory = new Map<string, Personality>();

export async function getPersonality(user: AuthedUser): Promise<Personality> {
  const sb = dataClientFor(user);
  if (!sb) return memory.get(user.id) ?? {};

  const { data, error } = await sb
    .from("personalities")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error(`[personality] load failed for ${user.id}:`, error.message);
    return {};
  }
  return (data?.data as Personality) ?? {};
}

export async function savePersonality(
  user: AuthedUser,
  personality: Personality,
): Promise<void> {
  const sb = dataClientFor(user);
  if (!sb) {
    memory.set(user.id, personality);
    return;
  }

  const { error } = await sb
    .from("personalities")
    .upsert(
      { user_id: user.id, data: personality, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  if (error) {
    throw new Error(`Failed to save personality: ${error.message}`);
  }
}

/**
 * Resolve the personality to use for a request: an inline override from the app
 * wins; otherwise fall back to the user's saved profile.
 *
 * When the profile has a selected preset (activePresetId), we layer the
 * preset's promptStyle onto customInstructions here — every downstream
 * prompt composer already reads customInstructions, so this makes the
 * "you're now writing as Signature / Executive / Playful" behavior work
 * uniformly across refine, clean, draft, and speak paths without any
 * pipeline-side change.
 */
export async function resolvePersonality(
  user: AuthedUser,
  override: Personality | undefined,
): Promise<Personality> {
  const base = (override && Object.keys(override).length > 0)
    ? override
    : await getPersonality(user);
  return applyPresetOverlay(base);
}

/**
 * Overlay the selected preset's promptStyle + tone hint into the profile.
 *
 * "none" tone skips the personality overlay — downstream, `passThrough`
 * routes the text through a BASIC cleanup only (filler removal + sentence
 * structure), NOT a voice rewrite. This is the default for new users: their
 * own words, just cleaned up and readable — not restyled.
 */
function applyPresetOverlay(p: Personality): Personality {
  if (!p.activePresetId) return p;
  // Effective preset = built-in with any per-user override merged on top.
  // This is the same list the personality UI renders — so a user's rename /
  // promptStyle edit flows into the refine step without a rebuild.
  const effective = applyPresetOverrides(p.presetOverrides);
  const preset = effective.find((x) => x.id === p.activePresetId);
  if (!preset) return p;

  const effectiveTone = p.activeTone ?? preset.defaultTone;
  // Basic-clean mode: no personality overlay. The pipeline inspects
  // `passThrough` and runs cleanBasic() (filler + structure) instead of the
  // full personality rewrite.
  if (effectiveTone === "none") {
    return { ...p, passThrough: true };
  }

  const overlay = `[Voice: ${preset.name}] ${preset.promptStyle} Preferred tone: ${effectiveTone}.`.trim();
  const existing = (p.customInstructions ?? "").trim();
  const merged = existing
    ? `${overlay}\n\n${existing}`
    : overlay;
  return {
    ...p,
    passThrough: false,
    customInstructions: merged,
    // Also normalize formality + emojiUse to the preset defaults so
    // downstream dial-based composers pick sane values when the user
    // hasn't set their own.
    formality: p.formality ?? preset.formality,
    emoji: p.emoji ?? preset.emojiUse,
  };
}

/**
 * Merge auto-learned corrections into the user's `vocabulary`. Only the
 * corrected ("to") spellings are added — the buggy "from" spelling is
 * incidental context, and adding both would just confuse the STT bias
 * prompt. Existing lines are preserved, duplicates (case-insensitive) are
 * skipped, and the total is capped at VOCAB_MAX_LINES (drop-oldest FIFO)
 * so a chatty client can't blow up the personality doc.
 *
 * Returns the updated personality so the caller can respond with a receipt.
 */
export async function learnVocabularyCorrections(
  user: AuthedUser,
  corrections: VocabularyCorrection[],
): Promise<Personality> {
  const current = await getPersonality(user);

  const existing = (current.vocabulary ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Case-insensitive dedupe set primed with what the user already has, so
  // repeated corrections of the same term don't stack duplicates.
  const seen = new Set(existing.map((s) => s.toLowerCase()));
  const additions: string[] = [];
  for (const { to } of corrections) {
    const term = (to ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(term);
  }

  // FIFO cap: keep the tail (newest entries), drop the oldest.
  const combined = [...existing, ...additions];
  const capped =
    combined.length > VOCAB_MAX_LINES
      ? combined.slice(combined.length - VOCAB_MAX_LINES)
      : combined;

  const next: Personality = { ...current, vocabulary: capped.join("\n") };
  await savePersonality(user, next);
  return next;
}

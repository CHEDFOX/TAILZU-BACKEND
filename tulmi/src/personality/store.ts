/**
 * Per-user personality storage. Saved in the Supabase `personalities` table
 * (one row per user, the profile kept as JSON). Reads/writes go through the
 * user's own JWT (RLS-scoped) or the service-role client — see dataClientFor.
 * When neither is available (DEV_SKIP_AUTH local testing) we fall back to an
 * in-memory map so the feature still works end-to-end without a database.
 */
import { randomUUID } from "node:crypto";
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";
import { applyPresetOverrides } from "../experience/personalityPresets.js";
import type {
  Personality,
  VocabularyCorrection,
} from "../../../shared/types/api.js";

/** Vocabulary size ceiling — keep the STT bias prompt short and cheap. */
export const VOCAB_MAX_LINES = 200;

const memory = new Map<string, Personality>();

// Serialize per-user vocabulary writes. learnVocabularyCorrections is a
// read-modify-write of the whole personality doc, so two concurrent calls — or
// one racing a PUT /v1/personality — could each read the old doc and clobber
// the other's appended lines. Chain the work per userId (same lock pattern as
// i18n.ts) so those writes run one-at-a-time instead of interleaving.
const userLocks = new Map<string, Promise<unknown>>();

async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  userLocks.set(userId, prev.then(() => gate));
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

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

/**
 * Create or edit a single "tone" (personality preset) — the two-field tone
 * editor. Read-modify-writes ONE entry in presetOverrides under the per-user
 * lock so it can't clobber the user's other tones (the REST PUT shallow-merges
 * the whole map, which would). Passing an `id` edits that preset (a built-in
 * override or an existing custom); omitting it mints a fresh `custom_…` id.
 * `remove` deletes the override (reset a built-in / delete a custom). On save
 * the tone becomes the active voice so the change takes effect immediately.
 */
export async function upsertPresetTone(
  user: AuthedUser,
  opts: { id?: string; name?: string; promptStyle?: string; remove?: boolean },
): Promise<{ personality: Personality; toneId: string }> {
  return withUserLock(user.id, async () => {
    const current = await getPersonality(user);
    const overrides: Record<string, NonNullable<Personality["presetOverrides"]>[string]> = {
      ...(current.presetOverrides ?? {}),
    };
    let activePresetId = current.activePresetId;

    if (opts.remove && opts.id) {
      delete overrides[opts.id];
      if (activePresetId === opts.id) activePresetId = "signature";
      const next: Personality = { ...current, presetOverrides: overrides, activePresetId };
      await savePersonality(user, next);
      return { personality: next, toneId: opts.id };
    }

    const toneId = opts.id?.trim() || `custom_${randomUUID()}`;
    overrides[toneId] = {
      ...(overrides[toneId] ?? {}),
      name: (opts.name ?? "").trim(),
      promptStyle: (opts.promptStyle ?? "").trim(),
    };
    const next: Personality = { ...current, presetOverrides: overrides, activePresetId: toneId };
    await savePersonality(user, next);
    return { personality: next, toneId };
  });
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
  // Serialize the read-modify-write so concurrent corrections (or a racing PUT)
  // can't lose each other's appends.
  return withUserLock(user.id, async () => {
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
  });
}

/**
 * The one tone the keyboard and the Voices screen start from.
 */

import { PERSONALITY_PRESETS } from "../personalityPresets.js";

/**
 * Zu on the keyboard — the whole tone row until the user makes it theirs.
 *
 * Zu is not a style among the others: it is the app writing as this person,
 * from what it has learned of them. So a keyboard that opens with one chip
 * saying Zu is making a smaller and truer claim than one offering a menu of
 * moods nobody asked for — there is nothing to choose between yet, because
 * the only voice so far is the user's own.
 *
 * Read off the preset rather than restated, so the name has one home.
 */
export const HOUSE_TONE = (() => {
  const base = PERSONALITY_PRESETS.find((p) => p.id === "signature") ?? PERSONALITY_PRESETS[0]!;
  return { id: base.id, name: base.name, tone: base.defaultTone };
})();

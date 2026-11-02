/**
 * Learning the person's style from ordinary use, once per session, off the request's path.
 */

import type { Personality } from "../../../shared/types/api.js";
import type { AuthedUser } from "../auth/supabase.js";
import { getConfig } from "../config.js";
import { listHistory } from "../history/store.js";
import { portraitFromUsage } from "../pipeline/cleanup.js";
import { mergePortraitWords } from "../pipeline/portraitDimensions.js";
import { updatePersonality } from "./store.js";

/**
 * Learn from ordinary use, ONCE PER SESSION, off the user's path.
 *
 * A session is a run of refines with no gap longer than
 * PORTRAIT_SESSION_GAP_MINUTES. The roll-up fires on the FIRST refine after
 * such a gap, which reads back the sitting that just ended — so the user
 * coming back is itself the trigger, and there are no timers or background
 * jobs anywhere. One consequence worth knowing: the last session before
 * someone stops using the app waits until they return. Nothing is lost.
 *
 * A second trigger backstops a session that never ends. Someone dictating all
 * afternoon would otherwise never cross a gap, so every PORTRAIT_LEARN_EVERY
 * refines within one sitting also rolls up.
 *
 * Fire-and-forget after the response has gone out, and the whole body is
 * wrapped: a portrait that fails to update is invisible, a refine that throws
 * because of it is not.
 */
export function learnFromUsage(user: AuthedUser, personality: Personality): void {
  const cfg = getConfig();
  if (!cfg.PORTRAIT_LEARN_EVERY) return;
  void (async () => {
    try {
      const now = Date.now();
      const sp = personality.stylePortrait;
      const last = sp?.lastSeenAt ? Date.parse(sp.lastSeenAt) : 0;
      const gapMs = cfg.PORTRAIT_SESSION_GAP_MINUTES * 60_000;
      // A new sitting has started when the previous refine is older than the
      // gap. The very first refine ever is a new sitting too, but there is
      // nothing behind it to read, so it only opens the session.
      const newSession = !!last && now - last > gapMs;
      const seen = (sp?.observed ?? 0) + 1;
      const longSession = seen >= cfg.PORTRAIT_LEARN_EVERY;

      if (!newSession && !longSession) {
        await updatePersonality(user, (existing) => ({
          ...existing,
          stylePortrait: {
            ...existing.stylePortrait,
            observed: seen,
            lastSeenAt: new Date(now).toISOString(),
            firstSeenAt: existing.stylePortrait?.firstSeenAt ?? new Date(now).toISOString(),
          },
        }));
        return;
      }

      const { entries } = await listHistory(user, { limit: cfg.PORTRAIT_LEARN_WINDOW });
      const next = await portraitFromUsage(
        sp,
        entries.map((e) => ({
          input: e.input, output: e.output, targetApp: e.targetApp, createdAt: e.createdAt,
        })),
        sp?.tzOffsetMinutes,
      );
      await updatePersonality(user, (existing) => ({
        ...existing,
        stylePortrait: {
          ...existing.stylePortrait,
          // A null reply means too little evidence or a bad completion. The
          // counters still move: retrying the same thin window on every refine
          // would burn a call each time and still learn nothing.
          ...(next
            ? {
                ...(next.core ? { core: next.core } : {}),
                // WORDS ACCUMULATE, everything else is a fresh read. Someone's
                // slang is learned a term at a time over months, and a
                // replace would forget every word that happened not to come up
                // in the last forty messages.
                words: mergePortraitWords(existing.stylePortrait?.words, next.words),
                ...(next.styles?.length ? { styles: next.styles } : {}),
                ...(next.rhythms?.length ? { rhythms: next.rhythms } : {}),
                updatedAt: new Date(now).toISOString(),
              }
            : {}),
          observed: 0,
          // Sittings, not roll-ups: the long-session backstop must not inflate
          // the number the writer uses to decide how settled the portrait is.
          sessions: (existing.stylePortrait?.sessions ?? 0) + (newSession ? 1 : 0),
          lastSeenAt: new Date(now).toISOString(),
          firstSeenAt: existing.stylePortrait?.firstSeenAt ?? new Date(now).toISOString(),
        },
      }));
    } catch {
      // Learning is a nice-to-have riding on a request that already succeeded.
    }
  })();
}

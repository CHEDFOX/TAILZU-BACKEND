/**
 * Flags that differ by platform, applied to the bootstrap's flags last.
 */

import type { BootstrapResponse } from "../../../../shared/types/sdui.js";

/**
 * Per-OS flag overrides, applied over the shared set.
 *
 * The flags above are what BOTH platforms get. Anything listed here replaces
 * one of them for one platform only — so an Android-only change can ship
 * without altering a single value iOS receives, and the diff shows exactly
 * which platform it is for.
 *
 * Deliberately a small map rather than branching inside the flag block. A
 * hundred inline ternaries would answer "what is different on Android?" only
 * by reading all of them, and that question gets asked every time either store
 * reports something the other does not.
 */
const PLATFORM_FLAGS: Record<"ios" | "android", Record<string, unknown>> = {
  ios: {},
  android: {
    // Android's own keyboard draws a suggestion strip; iOS's does not.
    "kb.suggestions.enabled": true,
    // Flow Session is an iOS answer to an iOS constraint — an extension there
    // cannot hold the microphone, so the app holds it in the background. The
    // Android IME records inline and needs none of it.
    "kb.flow.armOnForeground": false,
  },
};

export function applyPlatformFlags(
  flags: BootstrapResponse["flags"],
  platform: "ios" | "android",
): BootstrapResponse["flags"] {
  return { ...(flags ?? {}), ...PLATFORM_FLAGS[platform] } as BootstrapResponse["flags"];
}

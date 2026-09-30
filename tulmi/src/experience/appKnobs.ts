/**
 * Every knob the app reads (app/src/sdui/knobs.ts in the frontend) goes out
 * in the bootstrap with a value, so nothing on the phone decides it and the
 * control console can find and change each one.
 *
 * catalog.ts wins: a label or flag it already sets is left alone. The knob
 * values fill everything else.
 */
import type { BootstrapResponse } from "../../../shared/types/sdui.js";
import { APP_KNOB_FLAGS, APP_KNOB_LABELS } from "./appKnobsData.js";
import { KEYBOARD_KNOBS } from "./keyboardKnobsData.js";

/**
 * Flags whose ABSENCE means something ("no arrival prompt this launch"). The
 * catalog sets them only when they apply; filling them with the knob default
 * would say "ask" or "wait 9s" when it meant nothing at all. A control rule
 * can still set them.
 */
const CATALOG_CONDITIONAL = new Set(["promptScreenId", "promptAfterMs"]);

export function withAppKnobs<T extends Pick<BootstrapResponse, "labels" | "flags">>(boot: T): T {
  const fill: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(APP_KNOB_FLAGS)) if (!CATALOG_CONDITIONAL.has(k)) fill[k] = v;
  return {
    ...boot,
    labels: { ...APP_KNOB_LABELS, ...(boot.labels ?? {}) },
    flags: { ...fill, ...(boot.flags ?? {}) } as T["flags"],
  };
}

/**
 * The same for the keyboards: every flag and label the iOS or Android
 * keyboard reads goes out with a value — the catalog's where it has one,
 * else the default that keyboard's native code would have used — so no
 * keyboard decides anything the server did not send. Per platform, because
 * the two read different keys (keyboardKnobsData.ts, synced from the app's
 * tools/knobs/keyboard-knobs.json).
 */
export function withKeyboardKnobs<T extends { labels?: Record<string, string>; flags?: Record<string, unknown> }>(
  platform: string, config: T,
): T {
  const k = platform === "android" ? KEYBOARD_KNOBS.android : KEYBOARD_KNOBS.ios;
  return {
    ...config,
    labels: { ...k.labels, ...(config.labels ?? {}) },
    flags: { ...k.flags, ...(config.flags ?? {}) },
  };
}

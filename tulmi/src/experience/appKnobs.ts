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

export function withAppKnobs<T extends Pick<BootstrapResponse, "labels" | "flags">>(boot: T): T {
  return {
    ...boot,
    labels: { ...APP_KNOB_LABELS, ...(boot.labels ?? {}) },
    flags: { ...APP_KNOB_FLAGS, ...(boot.flags ?? {}) } as T["flags"],
  };
}

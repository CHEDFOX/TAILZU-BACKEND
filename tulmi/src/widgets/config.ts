/**
 * The widgets' config for one request: the defaults (defaults.ts) with the control plane's live rules for the "widgets" surface
 * applied, as push/index.ts does for "push". Never throws: a store that is not there, or a rule that cannot apply, leaves the
 * defaults.
 */
import { applyRules, type ControlCtx } from "../control/rules.js";
import { controlStore } from "../control/index.js";
import { WIDGETS_DEFAULTS, type WidgetsPayload } from "./defaults.js";

export type WidgetsConfigFor = (ctx: Partial<ControlCtx>) => WidgetsPayload;

export const widgetsConfig: WidgetsConfigFor = (ctx) => {
  const base = structuredClone(WIDGETS_DEFAULTS) as WidgetsPayload;
  const store = controlStore();
  if (!store) return base;
  try {
    return applyRules(base, store.rules(), { ...ctx, surface: "widgets" }).payload;
  } catch {
    return base;
  }
};

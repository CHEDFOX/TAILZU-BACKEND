/**
 * A FAILED CALL'S TOAST, IN THE SERVER'S WORDS WHEN IT GAVE A REASON: "That wasn't posted…" (botsBots/filter.ts), "X0 Bot needs your
 * OK…" (the AI permission, privacy/aiGate.ts). The app keeps a refusal's { code, message } at state lastError (its actions.ts); a
 * build that keeps none always shows `generic`.
 */
import type { ActionSpec } from "../../../../shared/types/sdui.js";

export const said = (generic: string): ActionSpec => ({
  kind: "condition", if: { truthy: "lastError.message" },
  then: { kind: "toast", message: "$state.lastError.message", tone: "error" }, else: { kind: "toast", message: generic, tone: "error" },
} as ActionSpec);

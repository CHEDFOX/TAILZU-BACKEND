/**
 * When the allowance has run out, and when the app is free for everyone.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";

/** What the paywall and the out-of-words screen say while Tailzu is free. */
/**
 * Keylessbord stopped by the usage meter (src/you/usage.ts), not by the free words: what it means, and where to see when it starts again.
 * No number of money, and nothing to buy here (Usage, in the app, offers a plan when one is for sale).
 */
export function usageOutScreen(screenId: string): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId,
    title: "X0 Bot",
    root: {
      type: "Screen",
      children: [{
        type: "Stack",
        style: { flex: 1, justifyContent: "center", alignItems: "center", gap: 14, padding: 32 },
        children: [
          { type: "Text", props: { content: "You've reached your limit for now" }, style: { fontSize: 26, fontWeight: "600", textAlign: "center" } },
          { type: "Text", props: { content: "The keyboard still types. Keylessbord writes for you again when your stretch resets: see when in You, under Usage." }, style: { fontSize: 15, textAlign: "center", opacity: 0.75 } },
          { type: "Button", props: { label: "Back" }, on: { onPress: { kind: "navigateBack" } }, style: { marginTop: 10 } },
        ],
      }],
    },
    cacheTtlSeconds: 0,
  };
}

export function freeNowScreen(screenId: string): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId,
    title: "X0 Bot",
    root: {
      type: "Screen",
      children: [{
        type: "Stack",
        style: { flex: 1, justifyContent: "center", alignItems: "center", gap: 14, padding: 32 },
        children: [
          { type: "Text", props: { content: "X0 Bot is free" }, style: { fontSize: 26, fontWeight: "600", textAlign: "center" } },
          { type: "Text", props: { content: "Every word, on every device. There is no plan to pick and nothing to pay." }, style: { fontSize: 15, textAlign: "center", opacity: 0.75 } },
          { type: "Button", props: { label: "Back" }, on: { onPress: { kind: "navigateBack" } }, style: { marginTop: 10 } },
        ],
      }],
    },
    cacheTtlSeconds: 0,
  };
}

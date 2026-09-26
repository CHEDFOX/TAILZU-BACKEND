/**
 * Every knob the app reads goes out in the bootstrap with a value, and the
 * catalog's own labels and flags still win over the knob defaults.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
import { buildBootstrap } from "../src/experience/catalog.js";
import { withAppKnobs } from "../src/experience/appKnobs.js";
import { APP_KNOB_FLAGS, APP_KNOB_LABELS } from "../src/experience/appKnobsData.js";

describe("app knobs", () => {
  it("the bootstrap carries every knob label and flag", () => {
    const b = buildBootstrap({});
    for (const k of Object.keys(APP_KNOB_LABELS)) expect(b.labels?.[k], k).toBeTypeOf("string");
    const conditional = new Set(["promptScreenId", "promptAfterMs"]);
    for (const k of Object.keys(APP_KNOB_FLAGS)) if (!conditional.has(k)) expect(b.flags?.[k], k).toBeDefined();
    expect(Object.keys(APP_KNOB_LABELS).length).toBeGreaterThan(0);
  });
  it("catalog values win over knob defaults", () => {
    const [k] = Object.keys(APP_KNOB_LABELS);
    const out = withAppKnobs({ labels: { [k!]: "from catalog" }, flags: {} });
    expect(out.labels?.[k!]).toBe("from catalog");
  });
});

import { buildKeyboardConfig } from "../src/experience/catalog.js";
import { KEYBOARD_KNOBS } from "../src/experience/keyboardKnobsData.js";

describe("keyboard knobs", () => {
  for (const platform of ["ios", "android"] as const) {
    it(`${platform}: every flag and label the keyboard reads is sent`, () => {
      const cfg = buildKeyboardConfig(undefined, undefined, { platform }) as unknown as {
        flags: Record<string, unknown>; labels: Record<string, string>;
      };
      const k = KEYBOARD_KNOBS[platform];
      const missingFlags = Object.keys(k.flags).filter((f) => !(f in cfg.flags));
      const missingLabels = Object.keys(k.labels).filter((l) => !(l in cfg.labels));
      expect(missingFlags).toEqual([]);
      expect(missingLabels).toEqual([]);
    });
  }
  it("the catalog's own values still win", () => {
    const cfg = buildKeyboardConfig(undefined, undefined, { platform: "ios" }) as unknown as { labels: Record<string, string> };
    expect(cfg.labels.full_access_required).toBe("Enable Full Access to use voice + Refine.");
  });
});

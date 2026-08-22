import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import {
  buildBootstrap,
  buildScreen,
  buildKeyboardConfig,
  bumpCacheVersion,
  currentCacheVersion,
} from "../src/experience/catalog.js";

describe("buildBootstrap", () => {
  it("returns theme + navigation + home initial screen when onboarded", () => {
    const b = buildBootstrap({ onboarded: true });
    expect(b.theme).toBeDefined();
    expect(b.theme.color.bg).toBe("#000000");
    expect(b.navigation.kind).toBe("tabs");
    const nav = b.navigation as { kind: "tabs"; tabs: Array<{ id: string }> };
    // Settings is no longer a bottom tab — it's opened from the header gear.
    // Stats sits between Home and You (the deep-stats tab).
    expect(nav.tabs.map((t) => t.id)).toEqual(["home", "stats", "personality"]);
    expect(b.initialScreenId).toBe("home");
    // Common labels the app relies on.
    expect(b.labels?.["app.name"]).toBe("Tailzu");
    // Language list is present.
    expect(Array.isArray(b.languages)).toBe(true);
    expect((b.languages ?? []).length).toBeGreaterThan(5);
  });

  it("routes first-run users to the onboarding flow", () => {
    const b = buildBootstrap({ onboarded: false });
    expect(b.initialScreenId).toBe("onboarding");
  });

  it("defaults to non-onboarded when opts is empty", () => {
    const b = buildBootstrap({});
    expect(b.initialScreenId).toBe("onboarding");
  });

  it("includes a cacheVersion token that matches the current cache version", () => {
    const b = buildBootstrap({ onboarded: true });
    expect(typeof b.cacheVersion).toBe("string");
    expect(b.cacheVersion?.length).toBeGreaterThan(0);
    expect(b.cacheVersion).toBe(currentCacheVersion());
  });

  it("bumpCacheVersion changes the token and the next bootstrap reflects it", () => {
    const before = buildBootstrap({ onboarded: true }).cacheVersion;
    const bumped = bumpCacheVersion();
    const after = buildBootstrap({ onboarded: true }).cacheVersion;
    expect(bumped).not.toBe(before);
    expect(after).toBe(bumped);
  });
});

describe("buildScreen", () => {
  const SCREEN_IDS = [
    "home",
    "personality",
    "voices",
    "tone_edit",
    "personality_detail",
    "settings",
    "reply",
    "stats",
    "history",
    "dictionary",
    "language_select",
    "delete_account",
    "onboarding",
    "onboarding_keyboard",
  ];

  it("returns a non-null screen with matching screenId for every catalog screen", () => {
    for (const id of SCREEN_IDS) {
      const screen = buildScreen(id, { personality: {}, language: "en" });
      expect(screen, `expected screen '${id}' to build`).not.toBeNull();
      expect(screen!.screenId).toBe(id);
    }
  });

  it("returns null for an unknown screen id", () => {
    expect(buildScreen("does-not-exist", { personality: {}, language: "en" })).toBeNull();
  });

  it("Home is the Training surface: variants + pick endpoints, tone sheet trains a tone", () => {
    const home = buildScreen("home", { personality: {}, language: "en" });
    expect(home).not.toBeNull();
    // Training target seeded to the user's active voice (default: Signature).
    expect((home!.state as Record<string, unknown>).tone).toBe("signature");
    expect((home!.state as Record<string, unknown>).toneLabel).toBe("Signature");
    expect((home!.state as Record<string, unknown>).toneSheetOpen).toBe(false);
    const json = JSON.stringify(home);
    // The training loop: variants in, a pick out — with the rejected pair so
    // the portrait learns from contrast, and the tone riding both calls.
    expect(json).toContain("/v1/train/variants");
    expect(json).toContain("/v1/train/pick");
    expect(json).toContain('"tone":"$state.tone"');
    expect(json).toContain('"rejectedA":"$state._rejA"');
    // Three variant slots render as tappable cards.
    expect(json).toContain('"truthy":"variantA"');
    expect(json).toContain('"truthy":"variantC"');
    // The action row hides while recording.
    expect(json).toContain('"falsy":"recording"');
    // Blurred voice sheet: Core style + the whole voice library.
    expect(json).toContain('"blur":true');
    expect(json).toContain('"open":"toneSheetOpen"');
    // ZU 8.8 is the branded default voice — the user's own way of talking,
    // auto-detected and cleaned with no borrowed tone laid over it.
    expect(json).toContain("ZU 8.8");
    expect(json).toContain("Professional");
    expect(json).toContain("Witty");
    // The refine trigger is the brand media, playing while variants generate.
    expect(json).toContain('"playing":"refining"');
  });

  it("You tab shows Voice + Dictionary media cards; the voice list carries the saved tone", () => {
    // The You tab is now just two media-background cards that navigate to the
    // voice list and the dictionary editor.
    const you = buildScreen("personality", { personality: {}, language: "en" });
    expect(you).not.toBeNull();
    const json = JSON.stringify(you);
    expect(json).toContain('"screenId":"voices"');
    expect(json).toContain('"screenId":"dictionary"');
    expect(json).toContain("card.voice");
    expect(json).toContain("card.dictionary");

    // The tone list (opened from the Voice card) lists the tones and each opens
    // the two-field editor; the "Add a tone" button opens it empty.
    const voices = buildScreen("voices", { personality: {}, language: "en" });
    expect(voices).not.toBeNull();
    const vjson = JSON.stringify(voices);
    expect(vjson).toContain("Signature");
    expect(vjson).toContain('"screenId":"tone_edit"');
    expect(vjson).toContain("Add a tone");
  });

  it("tone detail shows the tone's name + prompt and toggles the keyboard pin", () => {
    const screen = buildScreen("personality_detail", {
      personality: {},
      language: "en",
      params: { presetId: "professional" },
    });
    expect(screen).not.toBeNull();
    expect(screen!.screenId).toBe("personality_detail");
    // The title + heading are the tone name; the body is its prompt — no
    // taglines/emoji/supporting copy.
    expect(screen!.title).toBe("Professional");
    const json = JSON.stringify(screen);
    expect(json).toContain("professional restraint"); // from the preset promptStyle
    // Not pinned yet → the action offers to add it to the keyboard toggle.
    expect(json).toContain("Add to keyboard");

    // When already pinned, the same screen offers to remove it.
    const pinnedScreen = buildScreen("personality_detail", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      personality: { pinnedPresetIds: ["professional"] } as any,
      language: "en",
      params: { presetId: "professional" },
    });
    expect(JSON.stringify(pinnedScreen)).toContain("Remove from keyboard");
  });

  it("unknown tone id falls back to the first preset instead of erroring", () => {
    const screen = buildScreen("personality_detail", {
      personality: {},
      language: "en",
      params: { presetId: "does-not-exist" },
    });
    expect(screen).not.toBeNull();
    expect(screen!.title).toBe("Signature");
  });
});

describe("buildKeyboardConfig", () => {
  it("returns a valid theme, one or more layouts, and feature flags", () => {
    const kb = buildKeyboardConfig();
    expect(kb.theme.background).toBeDefined();
    expect(kb.theme.keyText).toBeDefined();
    expect(Array.isArray(kb.layouts)).toBe(true);
    expect(kb.layouts.length).toBeGreaterThan(0);
    expect(kb.layouts[0]?.language).toBe("en");
    // Every row is an array of key strings.
    expect(Array.isArray(kb.layouts[0]?.rows)).toBe(true);
    // Features flags: voice + refine on, streaming off by default.
    expect(kb.features.voice).toBe(true);
    expect(kb.features.refine).toBe(true);
    // Labels the client renders for the special keys.
    expect(kb.labels?.refine).toMatch(/refine/i);
  });
});

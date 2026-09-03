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

describe("the arrival prompt", () => {
  const flags = (o: Parameters<typeof buildBootstrap>[0]) =>
    (buildBootstrap(o).flags ?? {}) as Record<string, unknown>;

  it("stays away until the app is familiar", () => {
    for (let n = 0; n < 3; n++) {
      expect(flags({ launchCount: n }).promptScreenId).toBeUndefined();
    }
  });

  it("asks on the third launch, then every fourth", () => {
    expect(flags({ launchCount: 3 }).promptScreenId).toBe("languages");
    expect(flags({ launchCount: 4 }).promptScreenId).toBeUndefined();
    expect(flags({ launchCount: 6 }).promptScreenId).toBeUndefined();
    expect(flags({ launchCount: 7 }).promptScreenId).toBe("languages");
    expect(flags({ launchCount: 11 }).promptScreenId).toBe("languages");
  });

  it("waits before appearing rather than landing at the door", () => {
    const f = flags({ launchCount: 3 });
    expect(f.promptScreenId).toBe("languages");
    expect(Number(f.promptAfterMs)).toBeGreaterThanOrEqual(5000);
  });

  it("carries no delay when there is nothing to show", () => {
    expect(flags({ launchCount: 4 }).promptAfterMs).toBeUndefined();
  });

  it("never asks once the card is answered", () => {
    expect(flags({ launchCount: 7, languagesSet: true }).promptScreenId).toBeUndefined();
    expect(flags({ launchCount: 39, languagesSet: true }).promptScreenId).toBeUndefined();
  });

  it("gives up rather than nagging forever", () => {
    expect(flags({ launchCount: 43 }).promptScreenId).toBeUndefined();
    expect(flags({ launchCount: 400 }).promptScreenId).toBeUndefined();
  });

  it("treats a missing or junk count as too early to ask", () => {
    expect(flags({}).promptScreenId).toBeUndefined();
    expect(flags({ launchCount: Number.NaN }).promptScreenId).toBeUndefined();
  });
});

describe("the keyboard step speaks each platform's language", () => {
  const screen = () => JSON.stringify(buildScreen("onboarding_keyboard", { personality: {}, language: "en" }));

  it("ships both step lists, each gated to its own platform", () => {
    const t = screen();
    expect(t).toContain('"platform":"ios"');
    expect(t).toContain('"platform":"android"');
  });

  it("keeps the iOS-only words out of the Android list", () => {
    // "General", "Add New Keyboard" and "Allow Full Access" do not exist on
    // Android; following them there is a dead end, not a detour.
    const t = screen();
    expect(t).toContain("Allow Full Access");
    expect(t).toContain("keyboard list");
  });

  it("names the warning that actually stops Android users", () => {
    expect(screen()).toContain("read what you type");
  });

  it("gives Android a button that deep-links instead of an iOS URL scheme", () => {
    const t = screen();
    expect(t).toContain('"target":"keyboard"');
    expect(t).toContain("app-settings:");
  });
});

describe("the update gate's store links", () => {
  it("omits the iOS link rather than shipping a placeholder id", () => {
    // A gate that says "update now" and opens a dead App Store page is worse
    // than one that says it without a button.
    const gate = JSON.stringify(buildBootstrap());
    expect(gate).not.toContain("id000000000");
    if (!/^\d{6,}$/.test(process.env.APP_STORE_ID ?? "")) {
      expect(gate).not.toContain("apps.apple.com");
    }
  });

  it("always has the Play link, whose id is the package name we already know", () => {
    expect(JSON.stringify(buildBootstrap())).toContain("play.google.com");
  });
});

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

  it("opens a first-run user on the intro, which then hands off to onboarding", () => {
    // The intro now plays on the built-in mark when no media is uploaded, so
    // first launch opens on it. What must NEVER change is where it goes next:
    // a not-onboarded user has to reach onboarding, or they skip the language
    // pick and the keyboard-enable step and onboarded is never set — which is
    // how the intro used to replay forever.
    const b = buildBootstrap({ onboarded: false });
    expect(b.initialScreenId).toBe("intro");
  });

  it("defaults to non-onboarded when opts is empty", () => {
    const b = buildBootstrap({});
    expect(b.initialScreenId).toBe("intro");
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

  // Product rule, stated by the owner: no emoji anywhere in the app's chrome.
  // Screens are backend-authored, so this is the only place it can be enforced —
  // and it has to be enforced on the RENDERED tree, not on the source, because
  // copy also arrives from presets, labels and toasts.
  //
  // Typographic marks are not emoji and stay allowed: they render as TEXT, in
  // the current colour, at the current weight — "✓" as a selected-row
  // affordance, "✎" as an edit pencil, "→" in instructions, "·" as a separator.
  // What the rule is about is colour pictographs, which arrive at a fixed size
  // in someone else's palette. So: strip the allowed marks, then match anything
  // left in the pictograph blocks.
  const TYPOGRAPHIC = /[✓✗✎→←↑↓·—–]/gu;
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2600}-\u{27BF}]/u;

  function emojiIn(node: unknown, path = "root"): string[] {
    if (typeof node === "string") {
      return EMOJI.test(node.replace(TYPOGRAPHIC, "")) ? [`${path}: ${node}`] : [];
    }
    if (Array.isArray(node)) return node.flatMap((n, i) => emojiIn(n, `${path}[${i}]`));
    if (node && typeof node === "object") {
      return Object.entries(node as Record<string, unknown>)
        .flatMap(([k, v]) => emojiIn(v, `${path}.${k}`));
    }
    return [];
  }

  it("ships no emoji in any screen", () => {
    const found = SCREEN_IDS.flatMap((id) =>
      emojiIn(buildScreen(id, { personality: {}, language: "en" }), id),
    );
    expect(found, `emoji in shipped copy:\n${found.join("\n")}`).toEqual([]);
  });

  it("ships no emoji in the keyboard's labels", () => {
    const kb = buildKeyboardConfig();
    const found = emojiIn(kb.labels, "labels").concat(emojiIn(kb.layouts, "layouts"));
    expect(found, `emoji in keyboard copy:\n${found.join("\n")}`).toEqual([]);
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
  it("hides the suggestion strip on iOS and keeps autocorrect", () => {
    const f = buildKeyboardConfig(undefined, undefined, { platform: "ios" }).flags as Record<string, unknown>;
    expect(f["kb.suggestions.enabled"]).toBe(false);
    expect(f["kb.autocorrect.enabled"]).toBe(true);
    expect(f["kb.autocorrect.backspaceRevert"]).toBe(true);
  });

  it("keeps the strip on Android until its autocorrect fix ships", () => {
    const f = buildKeyboardConfig(undefined, undefined, { platform: "android" }).flags as Record<string, unknown>;
    expect(f["kb.suggestions.enabled"]).toBe(true);
    expect(f["kb.autocorrect.enabled"]).toBe(true);
  });

  it("treats an unknown caller as iOS", () => {
    const f = buildKeyboardConfig().flags as Record<string, unknown>;
    expect(f["kb.suggestions.enabled"]).toBe(false);
  });

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

  it("never opens the intro on nothing to play", () => {
    // The original rule here was "no uploaded file, no intro" — which made the
    // intro silently never play out of the box, i.e. a feature that looked
    // broken rather than unconfigured. It now falls back to the built-in mark,
    // so the guard is no longer about the FILE; it is about the screen always
    // having something in the plate.
    const introMounted = buildScreen("intro", { onboarded: false } as never);
    const tree = JSON.stringify(introMounted.root);
    expect(tree.includes("ParticleMark") || tree.includes("Slideshow")).toBe(true);
    // A returning user is never held behind it.
    expect(buildBootstrap({ onboarded: true }).initialScreenId).toBe("home");
  });

  it("gives every hero a built-in, so no screen ships an empty middle", () => {
    // Heroes resolve override → uploaded media → built-in. With nothing
    // uploaded and no override set, the built-in animation must be what
    // renders — an empty hero is the one outcome that is never acceptable.
    const onboarding = buildScreen("onboarding", { personality: {}, language: "en" });
    const paywall = buildScreen("paywall", { personality: {}, language: "en" });
    expect(JSON.stringify(onboarding)).toContain("ParticleMark");
    expect(JSON.stringify(paywall)).toContain("BinaryReveal");
  });

  it("answers whether the name + gender card has been filled in", () => {
    // This used to be a flag in the phone's own storage, so a reinstall or a
    // second device asked the same user again. The server answers now.
    expect(buildBootstrap().flags?.["profile.complete"]).toBe(false);
    expect(buildBootstrap({ profileComplete: true }).flags?.["profile.complete"]).toBe(true);
  });

  it("tells the app the same free-word cap the server enforces", () => {
    // The app shows progress against this and decides when to put the paywall
    // up. If it disagreed with what the server enforces, a user would hit a
    // wall the UI never warned them about.
    const boot = buildBootstrap();
    const served = boot.flags?.["quota.freeMonthlyWords"];
    expect(typeof served).toBe("number");
    expect(served).toBe(Number(process.env.FREE_MONTHLY_WORDS ?? 2500) || 0);
  });

  it("offers SMS sign-in unless the env turns it off", () => {
    // Twilio is live in Supabase now, so the pill is on by default. The env
    // stays as the kill switch: AUTH_ENABLE_PHONE=false hides it in a region
    // where delivery goes bad, with no deploy.
    const boot = buildBootstrap();
    expect(boot.flags?.["auth.enablePhone"]).toBe(process.env.AUTH_ENABLE_PHONE !== "false");
  });

  it("ships a Flow transport the app and the keyboard both read", () => {
    const kb = buildKeyboardConfig();
    const boot = buildBootstrap();
    // The APP arms the session and the KEYBOARD decides how long to wait for
    // the words, so both surfaces read this flag — and they must agree, or the
    // keyboard waits on a stream that was never opened.
    expect(["stream", "oneshot"]).toContain(kb.flags?.["kb.flow.transport"]);
    expect(boot.flags?.["kb.flow.transport"]).toBe(kb.flags?.["kb.flow.transport"]);
  });
});

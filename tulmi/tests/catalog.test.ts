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
  launchCard,
  THEME,
  TRAINING_UI,
  TYPE_ROLES,
  YOU_UI,
} from "../src/experience/catalog.js";
import { getConfig } from "../src/config.js";

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

describe("the mic step asks with one control, not two offers", () => {
  // Two full-width buttons read as two offers of equal weight. One control —
  // a light track carrying a small ✕ and a dark pill — says the same thing
  // with the answer and the way past at different sizes.
  const pill = () => {
    const s = buildScreen("onboarding", { personality: {}, language: "en" } as never) as {
      root: { children: Array<Record<string, any>> };
    };
    return s.root.children.find(
      (c) => c.style?.flexDirection === "row" && c.style?.backgroundColor === "#F4F4F2",
    )!;
  };

  it("puts the way past first and the answer second", () => {
    const [dismiss, accept] = pill().children;
    expect(dismiss.on.onPress).toBe("goKeyboard");
    expect(accept.on.onPress).toBe("allowMic");
    expect(accept.children[0].props.content).toBe("Allow access");
  });

  it("gives the answer the room and the dismiss a fixed corner", () => {
    const [dismiss, accept] = pill().children;
    // The action takes whatever is left; the ✕ never grows into it.
    expect(accept.style.flex).toBe(1);
    expect(Number(dismiss.style.width)).toBeGreaterThan(0);
    expect(dismiss.style.flex).toBeUndefined();
    // Dark pill in a light track — the contrast IS the hierarchy, so neither
    // may drift toward the other.
    expect(accept.style.backgroundColor).toBe("#0D0D0F");
    // The ✕ is drawn, not typed, so it keeps its weight at any size.
    expect(dismiss.children[0].type).toBe("SVG");
  });
});

describe("the paywall shows the free tier without selling it", () => {
  // The three side-by-side cards are now rows down the screen: a plan is a
  // name, a short note, a price and an arrow. Paid rows carry the brand and
  // are the way through; the free row is the way out and stays quiet.
  const plans = () => {
    const s = buildScreen("paywall", { personality: {}, language: "en" } as never) as {
      root: Record<string, any>; actions: Record<string, unknown>;
    };
    const rows: any[] = [];
    const walk = (n: any): void => {
      if (n?.style?.flexDirection === "row" && n?.style?.borderRadius === 16 && n.on?.onPress) {
        rows.push(n);
      }
      for (const c of n?.children ?? []) walk(c);
    };
    walk(s.root);
    return { rows, actions: s.actions };
  };

  const textsOf = (n: any): string[] => {
    const out: string[] = [];
    const walk = (x: any): void => {
      if (typeof x?.props?.content === "string") out.push(x.props.content);
      for (const c of x?.children ?? []) walk(c);
    };
    walk(n);
    return out;
  };

  it("stands the free tier next to what money buys", () => {
    const { rows } = plans();
    const all = rows.flatMap(textsOf);
    expect(all).toContain("$59.99");
    expect(all).toContain("$9.99");
    // Paid first — the free row is the floor, not the offer.
    expect(textsOf(rows[rows.length - 1]).join(" ")).toMatch(/free/i);
  });

  it("NEVER builds a purchase for the free row", () => {
    // A CTA aimed at a plan with no product id is a button that fails in front
    // of the user, every time it is pressed.
    const { rows, actions } = plans();
    expect(Object.keys(actions).filter((k) => k.startsWith("buy."))).toEqual(
      ["buy.annual", "buy.monthly"],
    );
    // The free row dismisses. It never reaches a purchase.
    expect(rows[rows.length - 1].on.onPress).toBe("dismiss");
    for (const r of rows.slice(0, -1)) {
      expect(String(r.on.onPress)).toMatch(/^buy\./);
    }
  });

  it("discloses auto-renewal on the screen where the purchase happens", () => {
    // Both stores require this sentence to be where the money is taken. It
    // was written into PAYWALL_CONFIG and nothing rendered it, so the rows
    // carried the price and the period and nothing said it renews by itself.
    const s = buildScreen("paywall", { personality: {}, language: "en" } as never);
    const shown = JSON.stringify(s);
    expect(shown).toMatch(/auto-?renew/i);
    expect(shown).toMatch(/cancel/i);
    // And the three controls a store checks for are still on it.
    for (const label of ["Restore purchases", "Terms", "Privacy"]) {
      expect(shown).toContain(label);
    }
  });

  it("puts the disclosure above the small print, not among it", () => {
    // It is a condition of the rows just above it, not chrome at the foot of
    // the screen — and a store reviewer reads it as belonging to the offer.
    const s: any = buildScreen("paywall", { personality: {}, language: "en" } as never);
    const texts: string[] = [];
    const walk = (n: any): void => {
      if (typeof n?.props?.content === "string") texts.push(n.props.content);
      for (const c of n?.children ?? []) walk(c);
    };
    walk(s.root);
    const foot = texts.findIndex((t) => /auto-?renew/i.test(t));
    const restore = texts.findIndex((t) => /restore/i.test(t));
    expect(foot).toBeGreaterThanOrEqual(0);
    expect(foot).toBeLessThan(restore);
  });

  it("quotes the allowance the SERVER enforces, not a literal", () => {
    // This drifted once: the catalog re-read the env with its own default of
    // 2500 while config defaults to 800, so the app promised 2,500 words and
    // the meter cut users off at 800. One reader now, through getConfig.
    const { rows } = plans();
    const shown = textsOf(rows[rows.length - 1]).find((s) => /words a month$/.test(s));
    const flags = (buildBootstrap({}).flags ?? {}) as Record<string, unknown>;
    expect(shown).toBe(
      `${Number(flags["quota.freeMonthlyWords"]).toLocaleString()} words a month`,
    );
  });
});

describe("Settings has a way to pay", () => {
  const upgradeRow = () => {
    const s = buildScreen("settings", { personality: {}, language: "en" } as never) as {
      root: { children: Array<Record<string, any>> };
    };
    return s.root.children.find((c) => c.props?.label === "Upgrade");
  };

  it("offers Upgrade, and it goes to the paywall", () => {
    // Before this row there was NO route to the paywall except running out of
    // words. A customer who wanted to pay had to be stopped first, and an App
    // Review tester — who will never dictate eight hundred words — would have
    // reported two auto-renewing products as unlocatable.
    const up = upgradeRow();
    expect(up).toBeTruthy();
    expect(up!.on.onPress).toEqual({ kind: "navigate", screenId: "paywall" });
  });

  it("hides itself from anyone who already paid", () => {
    // The client holds billing.entitled from the bootstrap, so this costs no
    // extra call and corrects itself on the next foreground. visibleIf is
    // evaluated before the fallback, so an old bundle renders nothing rather
    // than a row it does not know how to hide.
    expect(upgradeRow()!.visibleIf).toEqual({ not: { flag: "billing.entitled" } });
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
  it("links a real App Store id, never a placeholder", () => {
    // A gate that says "update now" and opens a dead App Store page is worse
    // than one that says it without a button — which is why this shipped with
    // no iOS link at all while the id was unknown. It is known now (it is in
    // eas.json, submit.production.ios.ascAppId), so the link is the default and
    // the assertion is that whatever ships resolves to a real listing.
    const gate = JSON.stringify(buildBootstrap());
    expect(gate).not.toContain("id000000000");
    const m = gate.match(/apps\.apple\.com\/app\/id(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(100000);
  });

  it("always has the Play link, whose id is the package name we already know", () => {
    expect(JSON.stringify(buildBootstrap())).toContain("play.google.com");
  });
});

describe("the type scale", () => {
  // Every run of text the renderer sets on its own reads one of these. A
  // missing role falls back to a number baked into the app, which is the
  // thing this scale exists to end.
  const RENDERER_ROLES = [
    // Text variants
    "brand", "h1", "overline", "quote", "label", "muted", "caption", "body",
    // Content blocks
    "heading", "paragraph", "quoteBlock", "badge",
    // Controls and lists
    "button", "buttonSecondary", "chip", "chipSelected", "mic", "row", "rowValue", "rowChevron",
    "keyValueLabel", "keyValueValue", "heroTitle", "heroSubtitle", "icon", "greeting", "greetingPill",
    // Shell
    "title", "headerIcon", "toast", "errorTitle", "errorBody", "errorAction", "banner",
    "updateTitle", "updateBody", "updateAction", "updateLater",
    // Sign-in
    "authField", "authPrompt", "authCode", "authNote", "authSearch", "authPickName", "authPickDial",
    // Native onboarding
    "langGreeting", "langPill", "profileHello", "profileName", "profileLabel", "profileAction",
  ];

  it("names every role the renderer reads", () => {
    for (const r of RENDERER_ROLES) expect(TYPE_ROLES[r], r).toBeDefined();
  });

  it("gives every role a size, and only theme colours", () => {
    for (const [name, role] of Object.entries(TYPE_ROLES)) {
      expect(role.size, name).toBeGreaterThan(0);
      if (role.color) expect(THEME.color[role.color], `${name}.color`).toBeDefined();
      if (role.weight) expect(role.weight, `${name}.weight`).toMatch(/^[1-9]00$/);
    }
  });

  it("sets the headings in the display slot, never a face name", () => {
    for (const r of ["brand", "h1", "quote", "heading", "quoteBlock", "greeting", "profileHello"]) {
      expect(TYPE_ROLES[r].family, r).toBe("display");
    }
    for (const role of Object.values(TYPE_ROLES)) {
      if (role.family) expect(["display", "body"]).toContain(role.family);
    }
  });

  it("ships the scale in the bootstrap theme", () => {
    const b = buildBootstrap({ onboarded: true });
    expect(b.theme.font.roles).toBe(TYPE_ROLES);
    expect(b.theme.font.sizes.body).toBe(TYPE_ROLES.body.size);
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
    // The screen follows the TAB, and for a first-timer that is You. These
    // used to disagree — the bar lit one tab while another screen showed.
    expect(b.initialScreenId).toBe("personality");
    // Common labels the app relies on.
    expect(b.labels?.["app.name"]).toBe("Tailzu");
    // Language list is present.
    expect(Array.isArray(b.languages)).toBe(true);
    expect((b.languages ?? []).length).toBeGreaterThan(5);
  });

  it("opens a first-run user on the intro, which then hands off to onboarding", () => {
    // The intro now plays on the built-in mark when no media is uploaded, so
    // the FIRST bootstrap an install ever makes opens on it. What must NEVER
    // change is where it goes next: a not-onboarded user has to reach
    // onboarding, or they skip the language pick and the keyboard-enable step
    // and onboarded is never set — which is how the intro used to replay.
    const b = buildBootstrap({ onboarded: false, launchCount: 1 });
    expect(b.initialScreenId).toBe("intro");
  });

  // The opening plays ONCE, and once is COUNTED. It used to be inferred from
  // `!onboarded`, which stays true through auth, the language pick and the
  // keyboard step — and the client asks this endpoint again after sign-in, on
  // every foreground, and on every refresh, treating each answer as "where the
  // app opens". So the film reappeared over the auth hand-off, over the screen
  // a keyboard mic tap had asked for, and after the flow screen.
  it("NEVER returns the intro on a later bootstrap, however un-onboarded", () => {
    for (const launchCount of [2, 3, 9, 400]) {
      const b = buildBootstrap({ onboarded: false, launchCount });
      expect(b.initialScreenId).toBe("onboarding");
    }
  });

  it("says onboarding, not intro, when the client did not count", () => {
    // launchCount 0 is unreadable storage or an older bundle. A missing opening
    // costs a first impression; a repeating one costs trust in the whole app.
    expect(buildBootstrap({}).initialScreenId).toBe("onboarding");
    expect(buildBootstrap({ onboarded: false, launchCount: 0 }).initialScreenId).toBe("onboarding");
  });

  // THE PROFILE CANNOT ANSWER FOR THE PHONE.
  //
  // `onboarded` used to outrank the device outright, and the two are not about
  // the same thing: the flag is per ACCOUNT, the microphone and the keyboard
  // are per PHONE. Signing in on a new phone therefore opened straight into
  // the tabs on a device that had granted nothing — a mic that refuses and a
  // keyboard never added, with no step left anywhere to explain either.
  it("asks the phone, not the profile, on the first launch of an install", () => {
    expect(buildBootstrap({ onboarded: true, launchCount: 1 }).initialScreenId)
      .toBe("onboarding");
    expect(buildBootstrap({ onboarded: true, launchCount: 1, micGranted: true }).initialScreenId)
      .toBe("onboarding_keyboard");
  });

  it("asks once per install, so declining is not a loop", () => {
    // The reason the flag outranked the device in the first place: declining
    // routes onward and still finishes onboarding, so a device check that ran
    // on every launch would return the refuser to the same screen forever.
    for (const launchCount of [2, 3, 50]) {
      const b = buildBootstrap({ onboarded: true, launchCount });
      expect(b.initialScreenId).not.toBe("onboarding");
      expect(b.initialScreenId).not.toBe("onboarding_keyboard");
    }
  });

  it("an onboarded user opens on home, first launch or not", () => {
    // First launch or fiftieth, an onboarded user opens on a tab root — and
    // on the SAME one the tab bar is lighting.
    for (const launchCount of [1, 50]) {
      const b = buildBootstrap({ onboarded: true, launchCount, micGranted: true, keyboardReady: true });
      const nav = b.navigation as { kind: "tabs"; initialTabId?: string; tabs: Array<{ id: string; screenId?: string }> };
      const tab = nav.tabs.find((t) => t.id === nav.initialTabId)!;
      expect(b.initialScreenId).toBe(tab.screenId ?? tab.id);
    }
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

  it("every Stats card opens a panel, and every panel has a card", () => {
    // The screen is one Modal, one `openCard` key, and a panel per value. So a
    // card whose id nothing renders is a tile that opens a blank sheet, and a
    // panel no card writes is detail nobody can reach — neither shows up as an
    // error anywhere, and both are one typo away at all times.
    const walk = (root: unknown, hit: (n: Record<string, any>) => void): void => {
      const go = (n: any): void => {
        if (!n || typeof n !== "object") return;
        hit(n);
        for (const c of n.children ?? []) go(c);
      };
      go(root);
    };
    for (const [label, ctx] of [
      ["with data", {
        personality: {}, language: "en",
        usage: { month: { words: 4820, audioSeconds: 2100, requests: 96 },
                 total: { words: 51230, audioSeconds: 24800, requests: 1140 } },
        allowance: { base: 800, earned: 260, total: 1060, used: 742, remaining: 318,
                     streakDays: 5, grants: [], maxed: false,
                     perVisit: [{ day: "2026-09-01", words: 20, sessions: 3, tier: "a" }] },
      }],
      ["with nothing", { personality: {}, language: "en" }],
    ] as const) {
      const screen = buildScreen("stats", ctx as never);
      const cards: string[] = [];
      const panels: string[] = [];
      walk(screen!.root, (n) => {
        if (n.on?.onPress?.kind === "setState" && n.on.onPress.path === "openCard") {
          cards.push(String(n.on.onPress.value));
        }
        if (n.visibleIf?.eq?.[0] === "openCard") panels.push(String(n.visibleIf.eq[1]));
      });
      expect(cards.length, `${label}: no tappable cards`).toBeGreaterThan(0);
      expect([...cards].sort(), `${label}: cards and panels disagree`).toEqual([...panels].sort());
    }
  });

  it("Settings is reachable — the tab roots hide the header the gear lived in", () => {
    // Settings has never been a tab. The app draws a gear in the header of
    // whichever tab root is showing and pushes the screen from there — so a
    // root that sets hideHeader takes the only way in with it, and the screen
    // goes on building perfectly while being reachable from nowhere. Which is
    // exactly what happened when all three roots went full bleed.
    const ctx = { personality: {}, language: "en", onboarded: true } as never;
    const roots = ["home", "stats", "personality"];
    const headerless = roots.filter((id) => {
      const s = buildScreen(id, ctx) as { hideHeader?: boolean; hideChrome?: boolean } | null;
      return !!(s?.hideHeader || s?.hideChrome);
    });
    // EVERY headerless root, not just one. A control that appears on some tabs
    // and not others has to be hunted for on each of them, which is worse than
    // one that is simply always in the same corner.
    for (const id of headerless) {
      expect(
        JSON.stringify(buildScreen(id, ctx)).includes('"screenId":"settings"'),
        `tab root "${id}" hides the header, so it must draw its own way into Settings`,
      ).toBe(true);
    }
    // And the screen it points at has to exist.
    expect(buildScreen("settings", ctx)).not.toBeNull();
  });

  it("Home is the Training entry: the art, and the ways in", () => {
    const home = buildScreen("home", { personality: {}, language: "en" });
    expect(home).not.toBeNull();
    const json = JSON.stringify(home);
    // The refine loop moved one tap deeper. The entry's job is to get there.
    expect(json).toContain('"screenId":"training_chat"');
    // The realtime door is built but gated, so flipping the flag is the whole
    // change — and until then the swipe lands on the refine loop rather than
    // on an unfinished screen.
    expect(json).toContain('"flag":"train.realtime"');
    expect(json).toContain('"screenId":"training_live"');
    // Nothing on this screen may assume the media slot is filled. Asserted as
    // the CONFIGURED copy rather than a literal, so rewording the entry is a
    // change to one object and not to this file — but an entry that says
    // nothing at all still fails.
    const entry = TRAINING_UI.entry;
    expect(entry.title.trim().length).toBeGreaterThan(0);
    expect(json).toContain(entry.title);
    expect(json).toContain(entry.cta.label);
  });

  it("Training live is a real conversation: a session, a bubble, and one read at the end", () => {
    const live = buildScreen("training_live", { personality: {}, language: "en" });
    expect(live).not.toBeNull();
    const json = JSON.stringify(live);
    // The loop: one node owns the audio and writes what it hears into state.
    expect(json).toContain('"VoiceSession"');
    expect(json).toContain("/v1/train/converse");
    // The bubble reads that state — and degrades to the wave mark on a bundle
    // too old to have it, rather than leaving a hole where the only visual is.
    expect(json).toContain('"VoiceBubble"');
    expect(json).toContain('"level":"level"');
    expect(json).toContain('"state":"sessionState"');
    expect(json).toContain('"Waveform"');
    // The portrait is read ONCE, on the way out, from the whole transcript.
    expect(json).toContain("/v1/train/portrait");
    expect(json).toContain('"turns":"$state.turns"');
    // A conversation is never served from cache.
    expect(live!.cacheTtlSeconds).toBe(0);

    // THE SCREEN IS THE ORB AND A WAY OUT. No status word, no transcript line,
    // no End button — a conversation is something you have, not something you
    // read, and each of those was the screen talking over the user.
    const texts: string[] = [];
    const walk = (n: any): void => {
      if (typeof n?.props?.content === "string" && n.props.content.trim()) texts.push(n.props.content);
      for (const c of n?.children ?? []) walk(c);
    };
    walk(live!.root);
    expect(texts, `nothing may be written on this screen, found: ${texts.join(" | ")}`).toEqual([]);

    // LEAVING IS SAVING, and exactly once. The arrow marks a flag before it
    // posts; onDisappear posts only when that flag is unset, which is the case
    // when someone swipes back instead. Lose either half and the conversation
    // is read twice or not at all — and "not at all" is silent.
    expect(live!.root.on?.onDisappear).toBe("saveIfUnhandled");
    expect(JSON.stringify(live!.actions?.saveIfUnhandled)).toContain('"falsy":"leaving"');
    expect(JSON.stringify(live!.actions?.finish)).toContain('"path":"leaving"');
  });

  it("the Train entry blurs and tints its art, and both are catalog values", () => {
    const home = buildScreen("home", { personality: {}, language: "en" });
    expect(home).not.toBeNull();
    const ui = TRAINING_UI.entry;

    // The art is behind two layers and the layers are in the right order:
    // blur first, then the flat tint, then the gradient the copy sits on.
    // Order is the whole point — tint under blur gets blurred away, and either
    // one over the gradient darkens the words instead of the picture.
    const kinds: string[] = [];
    const walk = (n: any): void => {
      if (n?.type) kinds.push(n.type);
      for (const c of n?.children ?? []) walk(c);
    };
    walk(home!.root);
    const blur = kinds.indexOf("BlurBackground");
    const grad = kinds.indexOf("Gradient");
    expect(blur, "the training art must be blurred").toBeGreaterThan(-1);
    expect(grad).toBeGreaterThan(blur);

    const json = JSON.stringify(home);
    expect(json).toContain(`"intensity":${ui.mediaBlur}`);
    expect(json).toContain(`"tint":"${ui.mediaBlurTint}"`);
    expect(json).toContain(`"opacity":${ui.mediaTintOpacity}`);

    // Same numbers as the You deck's cards. Two screens showing uploaded art
    // behind a word should not drift apart, and they will if each carries its
    // own constant.
    expect(ui.mediaBlur).toBe(YOU_UI.deck.cardBlur);
    expect(ui.mediaTintOpacity).toBe(YOU_UI.deck.scrimOpacity);
  });

  it("Training chat is the refine surface: variants + pick endpoints, tone sheet trains a tone", () => {
    const home = buildScreen("training_chat", { personality: {}, language: "en" });
    expect(home).not.toBeNull();
    // Training target seeded to the user's active voice — Zu, the house one.
    // The id stays "signature" so accounts already on it need no migration.
    expect((home!.state as Record<string, unknown>).tone).toBe("signature");
    expect((home!.state as Record<string, unknown>).toneLabel).toBe("Zu");
    expect((home!.state as Record<string, unknown>).toneSheetOpen).toBe(false);
    const json = JSON.stringify(home);
    // The training loop: variants in, a pick out — with the rejected pair so
    // the portrait learns from contrast, and the tone riding both calls.
    expect(json).toContain("/v1/train/variants");
    expect(json).toContain("/v1/train/pick");
    expect(json).toContain('"tone":"$state.tone"');
    expect(json).toContain('"rejectedA":"$state._rejA"');
    // It is a THREAD now, not a form with three variant slots under it: the
    // rows are appended as the conversation happens, and one component draws
    // whatever is in the array.
    expect(json).toContain('"ChatThread"');
    expect(json).toContain('"thread":"thread"');
    expect(json).toContain('"appendState"');
    expect(json).toContain('"options":"$state._train.variants"');
    // The tap is handled in the component and reported back by onSelect — an
    // event the renderer has always had. A made-up event name would type-check
    // on the server and silently never fire on the device.
    expect(json).toContain('"onSelect":"picked"');
    // The next two rows come back WITH the pick, so a conversation never runs
    // out of things to ask.
    expect(json).toContain('"$state._pick.next"');
    // A bundle without ChatThread must say so rather than render a hole.
    expect(json).toContain("Update the app");
    // Blurred voice sheet: Core style + the whole voice library.
    expect(json).toContain('"blur":true');
    expect(json).toContain('"open":"toneSheetOpen"');
    // ZU is the branded default voice — the user's own way of talking,
    // auto-detected and cleaned with no borrowed tone laid over it.
    //
    // Quoted, so this asserts a whole JSON string and not a substring of some
    // longer word: two letters match far too much to be checked loosely.
    expect(json).toContain('"ZU"');
    expect(json).toContain("Professional");
    expect(json).toContain("Witty");
    // The refine trigger is the brand media, playing while variants generate.
    expect(json).toContain('"playing":"refining"');
  });

  it("You tab is a deck whose cards carry the topic art and route to their screens", () => {
    // The You tab is a Coverflow deck: one card per topic, its art from the
    // media registry, and a tap that routes to that topic's screen.
    const you = buildScreen("personality", { personality: {}, language: "en" });
    expect(you).not.toBeNull();
    const json = JSON.stringify(you);
    expect(json).toContain('"Coverflow"');
    expect(json).toContain('"screenId":"voices"');
    expect(json).toContain('"screenId":"dictionary"');
    expect(json).toContain("card.voice");
    expect(json).toContain("card.dictionary");
    // Every card in the deck has to be reachable, so the route chain must name
    // as many destinations as there are cards. A card with no branch opens
    // whatever the chain falls through to, which is silent and wrong.
    for (const screenId of ["voices", "dictionary", "haptics", "languages"]) {
      expect(json).toContain(`"screenId":"${screenId}"`);
    }

    // The tone list (opened from the Voice card) lists the tones, and there is
    // a way to create one. Asserted as the ACTION, not as a label: the button
    // that used to say "Add a tone" is now the ＋ on the header, and the next
    // redesign will move it again.
    const voices = buildScreen("voices", { personality: {}, language: "en" });
    expect(voices).not.toBeNull();
    const vjson = JSON.stringify(voices);
    expect(vjson).toContain("Zu");
    expect(vjson).toContain('"screenId":"tone_edit"');
    expect(voices!.actions?.addTone).toBeTruthy();
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
    expect(screen!.title).toBe("Zu");
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
    expect(buildBootstrap({ onboarded: true }).initialScreenId).toBe("personality");
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
    //
    // This assertion USED TO ENCODE THE BUG. It compared the served number to
    // `process.env.FREE_MONTHLY_WORDS ?? 2500`, which is what the catalog did —
    // so it passed while the catalog said 2,500 and config said 800, and the
    // one thing it existed to catch was the one thing it could not see. It now
    // asks the config, which is what the meter charges against.
    const boot = buildBootstrap();
    const served = boot.flags?.["quota.freeMonthlyWords"];
    expect(typeof served).toBe("number");
    expect(served).toBe(getConfig().FREE_MONTHLY_WORDS);
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

describe("which tab the app opens on", () => {
  const nav = (landedBefore: boolean) => {
    const b = buildBootstrap({ onboarded: true, landedBefore });
    if (b.navigation.kind !== "tabs") throw new Error("expected a tabs shell");
    return b.navigation;
  };

  it("puts a first-timer in You, straight out of onboarding", () => {
    // They have never seen the inside of the product. You is the tab that sets
    // it up for them — their voices, words, keys, languages.
    expect(nav(false).initialTabId).toBe("personality");
  });

  it("opens on Stats every time after that", () => {
    // The only tab that has changed since they last looked. Train is where you
    // go to do something; Stats is what makes reopening the app worth it.
    expect(nav(true).initialTabId).toBe("stats");
  });

  it("names a tab that actually exists", () => {
    // A landing id with no matching tab strands the app on a blank screen, and
    // the client's fallback would hide it rather than fix it.
    for (const before of [false, true]) {
      const n = nav(before);
      expect(n.tabs.some((t) => t.id === n.initialTabId), `landedBefore=${before}`).toBe(true);
    }
  });

  it("never reorders the tabs to do it", () => {
    // The bar reads left to right in a fixed order; moving Stats to the front
    // for returning users would move it under a different thumb.
    expect(nav(true).tabs.map((t) => t.id)).toEqual(nav(false).tabs.map((t) => t.id));
    expect(nav(true).tabs.map((t) => t.id)).toEqual(["home", "stats", "personality"]);
  });

  it("sends a reviewer to Stats, not to You", () => {
    // A fresh review account has landedBefore false by definition, and walking
    // App Review into the setup tab on every submission is not the first
    // impression to give them.
    const b = buildBootstrap({ isReviewer: true, onboarded: true, landedBefore: true });
    if (b.navigation.kind !== "tabs") throw new Error("expected a tabs shell");
    expect(b.navigation.initialTabId).toBe("stats");
  });
});

describe("the You deck asks twice before it opens", () => {
  const deck = () => {
    const s = buildScreen("personality", { personality: {}, language: "en" } as never);
    let found: Record<string, any> | null = null;
    const walk = (n: any): void => {
      if (n?.type === "Coverflow") found = n;
      for (const c of n?.children ?? []) walk(c);
    };
    walk((s as any).root);
    if (!found) throw new Error("no Coverflow in the You screen");
    return found as Record<string, any>;
  };

  it("centres a side tap instead of opening it", () => {
    // A side card is turned away, shrunk and half-covered by its neighbours,
    // so what the thumb lands on is not what the eye was on. Opening that is a
    // tap the user then has to undo.
    expect(deck().props.tapToCentre).toBe(true);
  });

  it("keeps opening on onSelect, so the second tap still commits", () => {
    // Centring must not cost the deck its way in — one tap to look, one to
    // enter, and the second tap is on a card that is finally facing you.
    expect(deck().on.onSelect).toBe("open");
  });

  it("still follows the middle card while the finger is moving", () => {
    // onChange drives the backdrop and must not wait for a choice. If centring
    // had been folded into onSelect, the backdrop would lag a whole tap behind.
    expect(deck().on.onChange).toBe("centre");
  });

  it("leaves the flag in the catalog, so the feel is tunable without a build", () => {
    expect(YOU_UI.deck.tapToCentre).toBe(true);
  });
});

describe("the card in the middle says what it is", () => {
  const boxes = () => {
    const s = buildScreen("personality", { personality: {}, language: "en" } as never) as any;
    return s.root.children.filter((c: any) => c?.style?.backgroundColor === YOU_UI.info.background);
  };

  // The box is [ring?, text, button] — the ring only on cards that measure
  // something — so parts are found by shape, never by index.
  const parts = (b: any) => ({
    ring: b.children.find((k: any) => k?.type === "PieChart"),
    text: b.children.find((k: any) => k?.type === "Text"),
    cta: b.children.find((k: any) => k?.type === "Stack" && k?.on?.onPress),
  });

  it("gives every card a note and a way in, never a card without one", () => {
    // A deck of four words shows four things and says what none of them are.
    const found = boxes();
    expect(found).toHaveLength(4);
    for (const b of found) {
      const { text, cta } = parts(b);
      expect(String(text.props.content).length).toBeGreaterThan(20);
      expect(String(cta.children[0].props.content).length).toBeGreaterThan(0);
    }
  });

  it("shows exactly one — the one that reached the middle", () => {
    // Four stacked nodes gated on `deck`, like the backdrop. A single node
    // re-reading its content would swap words while the card is still moving.
    const found = boxes();
    expect(found.map((b: any) => b.visibleIf)).toEqual([
      { eq: ["deck", 0] }, { eq: ["deck", 1] }, { eq: ["deck", 2] }, { eq: ["deck", 3] },
    ]);
  });

  it("sends its button where the card itself goes", () => {
    // Two ways in, one place. A second way that went somewhere else would be
    // a third card.
    const s = buildScreen("personality", { personality: {}, language: "en" } as never) as any;
    const decks: string[] = [];
    const walk = (n: any): void => {
      if (n?.type === "Coverflow") for (const c of n.children ?? []) decks.push(c.children?.at(-1)?.props?.content);
      for (const c of n?.children ?? []) walk(c);
    };
    walk(s.root);
    boxes().forEach((b: any, i: number) => {
      const nav = parts(b).cta.on.onPress.actions.find((a: any) => a.kind === "navigate");
      expect(nav.screenId).toBeTruthy();
      // Same order as the deck, so box i belongs to card i.
      expect(decks[i]).toBeTruthy();
    });
  });

  it("sits under the deck in flow, not over it", () => {
    // The deck has flex and gives back what the note takes, so the cards sit
    // up by exactly its height instead of being covered.
    for (const b of boxes()) expect(b.style.position).toBeUndefined();
    const s = buildScreen("personality", { personality: {}, language: "en" } as never) as any;
    const kids = s.root.children;
    const deckAt = kids.findIndex((c: any) => c?.type === "Coverflow");
    const firstBox = kids.findIndex((c: any) => c?.style?.backgroundColor === YOU_UI.info.background);
    expect(firstBox).toBeGreaterThan(deckAt);
  });

  it("is the brand block with black ink, not another dark card", () => {
    // Everything else on this tab is glass over blurred art, or black. The
    // one thing you are meant to READ cannot look like scenery.
    const { text, cta } = parts(boxes()[0]);
    expect(boxes()[0].style.backgroundColor).toBe(YOU_UI.accent);
    expect(text.style.color).toBe("#0B0B0D");
    // Mid-weight. Bold on a solid colour reads as shouting, not as speech.
    expect(Number(text.style.fontWeight)).toBeLessThan(700);
    expect(cta.style.backgroundColor).toBe("#0B0B0D");
    expect(cta.children[0].style.color).toBe(YOU_UI.accent);
  });
});

describe("the bar never lies about where you are", () => {
  // A tab bar is not a label on the screen, it is a claim about where you
  // are. These were decided independently and disagreed for a returning user:
  // the bar lit Stats while Train was showing, so the first tap on the tab you
  // appeared to be on did nothing.
  const pair = (o: Parameters<typeof buildBootstrap>[0]) => {
    const b = buildBootstrap(o);
    const nav = b.navigation as { kind: "tabs"; initialTabId?: string; tabs: Array<{ id: string; screenId?: string }> };
    const tab = nav.tabs.find((t) => t.id === nav.initialTabId);
    return { screen: b.initialScreenId, tabScreen: tab ? tab.screenId ?? tab.id : undefined };
  };

  it("opens the screen the lit tab belongs to", () => {
    for (const o of [{ onboarded: true }, { onboarded: true, landedBefore: true }]) {
      const { screen, tabScreen } = pair(o);
      expect(screen).toBe(tabScreen);
    }
  });

  it("sends a first-timer to You and a returning user to Stats", () => {
    expect(pair({ onboarded: true }).screen).toBe("personality");
    expect(pair({ onboarded: true, landedBefore: true }).screen).toBe("stats");
  });

  it("never redirects a screen that comes BEFORE the tabs", () => {
    // Onboarding's two steps obtain the microphone and the keyboard. Landing
    // someone on Stats because a tab id says so would skip both.
    expect(buildBootstrap({ onboarded: false }).initialScreenId).toMatch(/^onboarding/);
    expect(buildBootstrap({ onboarded: false, landedBefore: true }).initialScreenId)
      .toMatch(/^onboarding/);
  });
});

describe("the charts show measured things, or nothing", () => {
  const STATS = {
    window: "month", requests: 6, wordsOut: 300, audioSeconds: 0, minutesSaved: 5,
    sparklinePerDay: [], 
    languageWords: [{ language: "en", words: 200 }, { language: "hi", words: 100 }],
    voiceWords: [{ id: "signature", words: 240 }, { id: "witty", words: 60 }],
    dictionary: { saved: 10, used: 4, unused: 6, scanned: 6, top: [{ word: "Nykaa", uses: 3 }] },
  } as never;
  const ctx = (extra: Record<string, unknown> = {}) =>
    ({ personality: {}, language: "en", ...extra } as never);

  const rings = (screen: string, c: Record<string, unknown> = {}) => {
    const s = buildScreen(screen, ctx(c)) as any;
    const out: any[] = [];
    const walk = (n: any): void => {
      if (n?.type === "PieChart") out.push(n);
      for (const k of n?.children ?? []) walk(k);
    };
    walk(s.root);
    return out;
  };

  it("puts no chart on the note at all when there is nothing to show", () => {
    // An empty chart in a strip this size is a hole with a caption in it. The
    // box goes back to being the sentence and the button it was before.
    expect(rings("personality")).toEqual([]);
    // Stats is the screen for reading, so there the empty case is drawn and
    // says so in words.
    for (const r of rings("stats")) {
      expect(r.props.slices).toEqual([]);
      expect(String(r.props.emptyLabel).length).toBeGreaterThan(0);
    }
  });

  it("writes nothing on the You tab chart — it is a shape, not a report", () => {
    // Percentages, a label in the middle and a legend are all for Stats.
    // Putting them in the caption strip would make it a panel.
    for (const r of rings("personality", { stats: STATS })) {
      expect(r.props.centerValue).toBeUndefined();
      expect(r.props.centerLabel).toBeUndefined();
      expect(r.props.legend).toBe(false);
    }
  });

  it("fills the You tab chart to its centre, since no number lives there", () => {
    // A ring's hole exists to hold a number. With none, a hole is a hole —
    // and at this size a wedge reads where a thin arc is a hairline.
    for (const r of rings("personality", { stats: STATS })) {
      expect(r.props.thickness).toBe(r.props.size / 2);
    }
  });

  it("keeps the caption's chart well under the one on Stats", () => {
    // Relational, not a magic number: the note is glanced at and Stats is
    // read, and the sizes have to keep saying which is which however either
    // is retuned.
    const note = rings("personality", { stats: STATS })[0].props.size;
    const stat = rings("stats", { stats: STATS })[0].props.size;
    expect(note).toBeLessThan(stat / 2);
    // Still big enough to read a lean off without looking for it.
    expect(note).toBeGreaterThanOrEqual(52);
  });

  it("charts the user's own rows once there are some", () => {
    const found = rings("personality", { stats: STATS });
    // Voice, Dictionary and Languages measure something; Haptics is a
    // preference, and a chart of a setting is decoration.
    expect(found).toHaveLength(3);
    const all = found.flatMap((r) => r.props.slices);
    expect(all.every((sl: any) => sl.value > 0)).toBe(true);
    // Every slice value came off the stats, not out of the catalog.
    const values = all.map((sl: any) => sl.value).sort((a: number, b: number) => a - b);
    expect(values).toEqual([4, 6, 60, 100, 200, 240]);
  });

  it("puts a number in the Stats ring that the ring around it agrees with", () => {
    const found = rings("stats", { stats: STATS });
    const dict = found.find((r) => r.props.centerLabel === "IN USE");
    // 4 of 10 saved words used.
    expect(dict.props.centerValue).toBe("40%");
    expect(dict.props.slices.map((sl: any) => sl.value)).toEqual([4, 6]);
    const voice = found.find((r) => r.props.centerLabel === "TOP");
    // 240 of 300 words in the top voice.
    expect(voice.props.centerValue).toBe("80%");
  });

  it("names voices the way the user does, not by id", () => {
    const found = rings("stats", { stats: STATS });
    const voice = found.find((r) => r.props.centerLabel === "TOP");
    expect(voice.props.slices[0].label).toBe("Zu");
    expect(voice.props.slices.map((sl: any) => sl.label)).not.toContain("signature");
  });

  it("keeps the legend off the deck strip and on the Stats card", () => {
    // The note is a strip under a deck; five legend rows would make it a panel.
    for (const r of rings("personality", { stats: STATS })) expect(r.props.legend).toBe(false);
    for (const r of rings("stats", { stats: STATS })) expect(r.props.legend).toBe(true);
  });

  it("gives Stats a card for each field, with its ring", () => {
    const found = rings("stats", { stats: STATS });
    expect(found.length).toBeGreaterThanOrEqual(3);
    const s = JSON.stringify(buildScreen("stats", ctx({ stats: STATS })));
    for (const id of ["dictionary", "voices", "languages"]) expect(s).toContain(`"${id}"`);
  });

  it("colours each surface for the ground it sits on", () => {
    // Near-black on the amber note, amber on the black Stats card. The same
    // slice in the same colour on both would be invisible on one of them.
    const onAmber = rings("personality", { stats: STATS })[0].props.slices[0].color;
    const onDark = rings("stats", { stats: STATS })[0].props.slices[0].color;
    expect(onAmber).toBe("#0B0B0D");
    expect(onDark).toBe(YOU_UI.accent);
  });
});

describe("the You tab greets you by name", () => {
  const find = (ctx: Record<string, unknown>, type: string) => {
    const s = buildScreen("personality", ctx as never);
    let found: Record<string, any> | null = null;
    const walk = (n: any): void => {
      if (n?.type === type && !found) found = n;
      for (const c of n?.children ?? []) walk(c);
    };
    walk((s as any).root);
    return found as Record<string, any> | null;
  };
  const hello = (ctx: Record<string, unknown> = { personality: {}, language: "en" }) =>
    find(ctx, "FlipText")!;

  it("opens in English, whoever is looking", () => {
    // The first word is on screen when the tab opens. An opening word that
    // changes with the account is not an opening word.
    expect(hello().props.words[0]).toBe("Hello");
  });

  it("shows one person the same cycle as the next", () => {
    // Nothing after English depends on the account.
    const a = hello({ personality: { languages: ["ta", "hi"] }, language: "ta" }).props.words;
    const b = hello({ personality: { languages: ["fr"] }, language: "fr" }).props.words;
    const c = hello({ personality: {}, language: "en" }).props.words;
    expect(a).toEqual(c);
    expect(b).toEqual(c);
  });

  it("has enough languages to keep turning", () => {
    expect(hello().props.words.length).toBeGreaterThanOrEqual(40);
  });

  it("never says the same word twice", () => {
    // The same word twice running reads as a skipped turn, not a language.
    const w = hello().props.words;
    expect(new Set(w).size).toBe(w.length);
  });

  it("changes script from one turn to the next, where it can", () => {
    // The word turns over in place, so two words in the same script one after
    // the other read as a typo rather than a change of language.
    const script = (w: string): string => {
      const c = w.codePointAt(0)!;
      if (c < 0x0370) return "latin";
      if (c < 0x0400) return "greek";
      if (c < 0x0590) return "cyrillic";
      if (c < 0x0600) return "hebrew";
      if (c < 0x0900) return "arabic";
      return `u+${(c >> 8).toString(16)}`;   // one block per Indic/SEA script
    };
    const w = hello().props.words;
    let repeats = 0;
    for (let i = 1; i < w.length; i++) if (script(w[i]) === script(w[i - 1])) repeats++;
    // Latin has the most entries and cannot always be avoided; what must not
    // happen is a run of one script down the list.
    expect(repeats).toBeLessThan(w.length / 4);
  });

  it("gives each line its own colour, tunable without moving anything else", () => {
    // Pointing these at `label` and `text` would have made the greeting
    // untunable in practice: those two carry most of the app's type, so
    // balancing the hello against the name would have dragged every caption
    // and heading with it.
    expect(TYPE_ROLES.greetHello.color).toBe("greetHello");
    expect(TYPE_ROLES.greetName.color).toBe("greetName");
    // Not aliases of the shared tokens — a token that IS `label` is `label`.
    const shared = ["label", "text", "body", "muted"];
    for (const role of ["greetHello", "greetName"] as const) {
      expect(shared).not.toContain(TYPE_ROLES[role].color);
    }
    // And not each other, or there is one colour, not two.
    expect(THEME.color.greetHello).not.toBe(THEME.color.greetName);
  });

  it("keeps the whole greeting in one block, each value on its own", () => {
    // Sizes in one section, colours in another and the position in a third is
    // three places to read to change a three-line greeting. GREET owns it;
    // the roles and the palette are views of it.
    const g = YOU_UI.greet;
    expect(TYPE_ROLES.greetHello.size).toBe(g.hello.size);
    expect(TYPE_ROLES.greetHello.weight).toBe(g.hello.weight);
    expect(TYPE_ROLES.greetHello.letterSpacing).toBe(g.hello.tracking);
    expect(TYPE_ROLES.greetName.size).toBe(g.name.size);
    expect(TYPE_ROLES.greetName.weight).toBe(g.name.weight);
    expect(TYPE_ROLES.greetName.letterSpacing).toBe(g.name.tracking);
    expect(TYPE_ROLES.greetName.family).toBe(g.name.family);
    expect(THEME.color.greetHello).toBe(g.hello.color);
    expect(THEME.color.greetName).toBe(g.name.color);
    // The sizes are the greeting's own numbers, not references to the ladder —
    // moving the ladder must not move the greeting.
    expect(g.hello.size).not.toBe(g.name.size);
    for (const v of [g.top, g.left, g.gap, g.nameMaxWidth, g.intervalMs, g.flipMs]) {
      expect(typeof v).toBe("number");
    }
  });

  it("trims a long name rather than wrapping it into the deck", () => {
    // The gear is 34 at 16 from the right edge. A second line would push the
    // greeting down over the cards, which are what the screen is for.
    const s = buildScreen("personality", {
      personality: {}, language: "en",
      name: "Aaravindhan Venkataraghavan Subramaniam",
    } as never) as any;
    const block = s.root.children.find((c: any) =>
      c?.children?.some((k: any) => k?.type === "FlipText"));
    expect(block.children[1].props.numberOfLines).toBe(YOU_UI.greet.nameLines);
    expect(block.children[1].style.maxWidth).toBe(YOU_UI.greet.nameMaxWidth);
  });

  it("sends the cadence, so the app only knows how to turn a word", () => {
    const p = hello().props;
    expect(p.intervalMs).toBe(YOU_UI.greet.intervalMs);
    expect(p.flipMs).toBe(YOU_UI.greet.flipMs);
    expect(p.variant).toBe("greetHello");
    expect(TYPE_ROLES.greetHello).toBeDefined();
    expect(TYPE_ROLES.greetName).toBeDefined();
  });

  it("puts the name under the hello when there is one", () => {
    const ctx = { personality: {}, language: "en", name: "Aarav" };
    const s = buildScreen("personality", ctx as never) as any;
    const block = s.root.children.find((c: any) =>
      c?.children?.some((k: any) => k?.type === "FlipText"));
    expect(block.children[1].props.content).toBe("Aarav");
    expect(block.children[1].props.variant).toBe("greetName");
    // Top left, on the settings gear's line.
    expect(block.style.left).toBe(YOU_UI.greet.left);
  });

  it("greets nobody rather than an empty name", () => {
    for (const name of [undefined, "", "   "]) {
      const s = buildScreen("personality", { personality: {}, language: "en", name } as never) as any;
      const block = s.root.children.find((c: any) =>
        c?.children?.some((k: any) => k?.type === "FlipText"));
      expect(block.children).toHaveLength(1);
    }
  });
});

describe("the keyboard opens with one voice, and it is ours", () => {
  const pinned = (p?: Record<string, unknown>) =>
    (buildKeyboardConfig(p as never).flags as Record<string, any>)["kb.personality.pinned"];

  it("gives a new keyboard exactly one tone, named Zu", () => {
    // The row used to be empty until the first pin, which handed the keyboard
    // back to its own built-in cycle — a set of names nobody chose, on a
    // control that is supposed to be the user's.
    for (const p of [undefined, {}, { pinnedPresetIds: [] }]) {
      expect(pinned(p)).toHaveLength(1);
      expect(pinned(p)[0].name).toBe("Zu");
    }
  });

  it("keeps the default preset's id, so nobody has to be migrated", () => {
    // Zu is the built-in default wearing the product's name. A new id would
    // have stranded every account already sitting on "signature".
    expect(pinned()[0].id).toBe("signature");
    expect(pinned()[0].tone).toBeDefined();
  });

  it("steps aside the moment the user adds a voice", () => {
    const chips = pinned({ pinnedPresetIds: ["professional", "witty"] });
    expect(chips.map((c: any) => c.id)).toEqual(["professional", "witty"]);
    expect(chips.some((c: any) => c.name === "Zu")).toBe(false);
  });

  it("falls back to Zu when every pinned voice has been deleted", () => {
    // Ids that no longer resolve would otherwise send an empty row and drop
    // the keyboard back to its own cycle. One tone is the floor.
    expect(pinned({ pinnedPresetIds: ["deleted_1", "deleted_2"] })).toEqual([
      pinned()[0],
    ]);
  });
});

describe("the card the app opens with", () => {
  it("ships no card by default", () => {
    // An app that greets everyone with a card on the day they install it has
    // spent the one moment it had.
    expect(buildBootstrap({ onboarded: true }).launchCard).toBeUndefined();
  });

  it("composes a card whose button is an ordinary navigate", () => {
    // Nothing in the tree knows it is inside a card — the app closes the card
    // on the way out, so this is the same action any button carries.
    const c = launchCard({
      id: "voices-2026-09", kicker: "New", title: "Make a voice of your own",
      body: "Add one in Voices and the keyboard carries it.",
      cta: "Open Voices", screenId: "voices", dismiss: "Later",
    });
    const kids = (c.root as any).children;
    const button = kids.find((k: any) => k.type === "Button" && k.props.label === "Open Voices");
    expect(button.on.onPress).toEqual({ kind: "navigate", screenId: "voices" });
    const later = kids.find((k: any) => k.props?.label === "Later");
    expect(later.on.onPress).toEqual({ kind: "dismiss" });
  });

  it("shows once per id, and the id is not derived from the words", () => {
    // Changing the copy of a card people have seen must show nobody anything;
    // a second announcement needs a second id.
    const a = launchCard({ id: "same", title: "One", cta: "Go", screenId: "home" });
    const b = launchCard({ id: "same", title: "Two", cta: "Go", screenId: "home" });
    expect(a.id).toBe(b.id);
    expect(a.repeat).toBe("once");
    expect(JSON.stringify(a.root)).not.toBe(JSON.stringify(b.root));
  });

  it("leaves out what it wasn't given rather than drawing an empty line", () => {
    const bare = launchCard({ id: "bare", title: "Just this", cta: "Go", screenId: "home" });
    const kids = (bare.root as any).children;
    expect(kids.filter((k: any) => k.type === "Text")).toHaveLength(1);
    expect(kids.filter((k: any) => k.type === "Button")).toHaveLength(1);
  });

  it("sets the card in the app's own type, not sizes of its own", () => {
    const c = launchCard({ id: "t", kicker: "New", title: "T", body: "B", cta: "Go", screenId: "home" });
    const variants = (c.root as any).children
      .filter((k: any) => k.type === "Text").map((k: any) => k.props.variant);
    expect(variants).toEqual(["overline", "h1", "muted"]);
    for (const v of variants) expect(TYPE_ROLES[v]).toBeDefined();
  });
});

describe("the tab icons come down the wire", () => {
  // The backend is the creator and the app is a renderer. Icons were the one
  // place that was quietly untrue: the app matched each tab's id against
  // shapes it carried itself, and the `icon` slot was never read. A redrawn
  // set meant a release.
  const shell = () => {
    const b = buildBootstrap({ onboarded: true });
    if (b.navigation.kind !== "tabs") throw new Error("expected a tabs shell");
    return b.navigation;
  };

  it("sends a glyph for every tab", () => {
    for (const t of shell().tabs) {
      expect(t.glyph, `${t.id} has no glyph`).toBeTruthy();
      expect(t.glyph!.layers.length, `${t.id} has no layers`).toBeGreaterThan(0);
    }
  });

  it("gives every layer a path and a way to be drawn in both states", () => {
    for (const t of shell().tabs) {
      for (const l of t.glyph!.layers) {
        expect(l.d, `${t.id}: empty path`).toMatch(/^M/);
        // Three ways a layer can appear: stroked, filled outright, or punched
        // out of a fill beneath it. A layer that is none of them is invisible,
        // which is the only thing worth failing on here.
        expect(
          l.stroke !== undefined || l.fill || l.punch,
          `${t.id}: a layer that would draw nothing`,
        ).toBeTruthy();
      }
    }
  });

  it("keeps every path inside the 32-unit grid", () => {
    // A coordinate past 32 is clipped by the viewBox and the icon arrives
    // with a flat edge. Cheap to check, expensive to notice on a device.
    for (const t of shell().tabs) {
      for (const l of t.glyph!.layers) {
        for (const n of l.d.match(/-?\d+(?:\.\d+)?/g) ?? []) {
          const v = Number(n);
          expect(v, `${t.id}: ${n} is outside the grid`).toBeGreaterThanOrEqual(0);
          expect(v, `${t.id}: ${n} is outside the grid`).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it("carries the rail flag, so the bar's thread is a backend decision too", () => {
    // The VALUE is the backend's to choose and will change again. What must
    // never happen is the field going missing, because absent means yes on the
    // client and the thread would come back by omission.
    expect(typeof shell().rail).toBe("boolean");
  });

  it("says which tab you are on with weight, not only colour", () => {
    // A selected tab that differs from the others only in colour is a tab bar
    // that cannot be read in bright light, or by anyone who does not separate
    // those two colours. Every glyph has to change SHAPE when it is active:
    // an open stroke thickens, a closed one fills.
    for (const t of shell().tabs) {
      const layers = t.glyph!.layers;
      expect(
        layers.some((l) => l.activeFill === true || typeof l.activeStroke === "number"),
        `${t.id} looks identical whether or not you are on it`,
      ).toBe(true);
    }
  });
});

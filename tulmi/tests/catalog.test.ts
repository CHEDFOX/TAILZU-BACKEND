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
  STATS_UI,
} from "../src/experience/catalog.js";
import { getConfig } from "../src/config.js";
import { PERSONALITY_PRESETS } from "../src/experience/personalityPresets.js";

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

  // A WINDOW IS NOT A HANDSET.
  //
  // Both setup steps exist to obtain something from a phone: a permission the
  // OS grants an app, and a keyboard added in Settings. The desktop has no
  // keyboard extension, and Electron already holds its microphone — so both
  // steps have nothing to ask and neither may be the landing.
  //
  // The desktop used to be sent "onboarding_keyboard" and discard it, which
  // worked and was backwards: the renderer overruling the creator.
  it("never lands a desktop on a step that has nothing to ask it", () => {
    for (const launchCount of [1, 2, 50]) {
      for (const onboarded of [false, true]) {
        const b = buildBootstrap({ onboarded, launchCount, formFactor: "desktop" });
        expect(b.initialScreenId).not.toBe("onboarding");
        expect(b.initialScreenId).not.toBe("onboarding_keyboard");
      }
    }
  });

  // THE CHROME IS COPY, AND COPY THE DESKTOP CANNOT FIX IS COPY THAT IS STUCK.
  //
  // The window's screens were server-drawn; the gate, the rail, the tray menu
  // and the notifications were literals in the binary. There is no OTA channel
  // on desktop — a release is a download the user has to notice, accept past
  // SmartScreen and run — so one wrong word used to be permanent.
  it("sends the desktop its chrome, and only to a desktop", () => {
    const desk = buildBootstrap({ onboarded: true, formFactor: "desktop" });
    const shell = desk.flags?.["desktop.shell"] as Record<string, Record<string, string>>;
    expect(shell).toBeTruthy();
    // The four things the binary used to own outright.
    for (const section of ["gate", "rail", "tray", "notify"]) {
      expect(Object.keys(shell[section] ?? {}).length).toBeGreaterThan(0);
    }
    // The line that was wrong for a release: it promised dictation without an
    // account, on the surface where that had just stopped being true.
    expect(shell.gate.note).toMatch(/account/i);

    // A phone has no tray to label, and would carry the whole block on every
    // launch for nothing.
    for (const formFactor of [undefined, "phone"]) {
      expect(buildBootstrap({ onboarded: true, formFactor }).flags?.["desktop.shell"])
        .toBeUndefined();
    }
  });

  it("every desktop chrome value is a non-empty string", () => {
    // The client merges its own defaults under this and only lets non-empty
    // strings win, so a blank here is not a crash — it is a key that silently
    // stops being editable from the server. Catch it where it is written.
    const shell = buildBootstrap({ onboarded: true, formFactor: "desktop" })
      .flags?.["desktop.shell"] as Record<string, Record<string, unknown>>;
    for (const [section, entries] of Object.entries(shell)) {
      for (const [key, value] of Object.entries(entries)) {
        expect(typeof value, `${section}.${key}`).toBe("string");
        expect(String(value).trim(), `${section}.${key}`).not.toBe("");
      }
    }
  });

  // THE TRAIN TAB HAS TO SCROLL ON THE SURFACE WITH THE MOST ROOM.
  //
  // The scroll is gated on a Screen that holds its touches, because on a phone
  // the way into this tab is a disc dragged across a pill and a scroll view
  // steals the touches of a child being dragged. Nothing is dragged in a
  // window — the pill there is a click — so the condition is satisfied for a
  // reason the capability list cannot express, and without this the desktop
  // got the no-scroll layout: no stats panel, on the widest screen there is.
  it("lets a desktop scroll the training tab without claiming a component", () => {
    const ctx = (formFactor: "phone" | "desktop", can: string[] = []) => ({
      personality: {},
      language: "en",
      viewport: { width: 1200, height: 800 },
      can: new Set(can),
      formFactor,
    }) as never;
    // The scrolling layout sizes its opening pane to the reported window; the
    // one-screen layout has no height to state.
    const tall = (screen: unknown) => JSON.stringify(screen).includes("minHeight");
    // A window scrolls with an empty capability list.
    expect(tall(buildScreen("home", ctx("desktop")))).toBe(true);
    // A phone still has to say so.
    expect(tall(buildScreen("home", ctx("phone")))).toBe(false);
    expect(tall(buildScreen("home", ctx("phone", ["ScreenHoldTouches"])))).toBe(true);
  });

  it("a phone is still asked — absent means phone", () => {
    // Every client older than the field sends nothing, and nothing must read
    // as a phone, or one release would silently skip setup for all of them.
    for (const formFactor of [undefined, "phone"]) {
      expect(buildBootstrap({ onboarded: true, launchCount: 1, formFactor }).initialScreenId)
        .toBe("onboarding");
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

  it("Training live is a real conversation: a session, the field, and one read at the end", () => {
    const s: any = buildScreen("training_live", { personality: {}, language: "en" } as never);
    const json = JSON.stringify(s);
    // The mic is what starts the conversation and leaving is what saves it.
    expect(json).toContain('"VoiceSession"');
    expect(json).toContain("/v1/train/converse");
    expect(json).toContain("/v1/train/portrait");
    // The orb was one object pulsing on a black screen — a good abstraction
    // for a voice and a poor one for a thing that learns. The field is the
    // screen now, and it is BOUND to the session: what the state is, is what
    // the picture is doing, so the status word is a caption on something
    // already legible.
    const field = (s.root.children ?? []).find((c: any) => c?.type === "NeuralField");
    expect(field, "no field on the live screen").toBeTruthy();
    expect(field.bind.state).toBe("sessionState");
    expect(field.bind.level).toBe("level");
    expect(field.props.alpha).toBe(1);
    expect(field.props.training).toBe(true);
    expect(json).not.toContain('"AuroraOrb"');
  });

  it("the Train entry IS the field, dimmed back behind the copy", () => {
    // The entry used to be an uploaded still under a blur and a tint. A still
    // cannot say the thing this tab is about — that what is inside is alive
    // and grows when you talk to it — so the hero is the network itself.
    const home: any = buildScreen("home", { personality: {}, language: "en" });
    const field = (home.root.children ?? []).find((c: any) => c?.type === "NeuralField");
    expect(field, "no field on the Train entry").toBeTruthy();
    // Scenery, not the subject: dimmed so the title and the control read over
    // it — and dimmed rather than blurred, because a blurred network is
    // weather and the point is that you can see it is a network.
    expect(field.props.alpha).toBeLessThan(1);
    expect(field.props.alpha).toBeGreaterThan(0);
    expect(field.style.position).toBe("absolute");
    // A bundle without the component draws black, which is what the screen
    // was before the field existed — never a hole.
    expect(field.fallback?.type).toBe("Stack");
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

  it("You tab is a portrait: one sentence, then every setting on the surface", () => {
    const s: any = buildScreen("personality", { personality: {}, language: "en" } as never);
    const json = JSON.stringify(s);
    // The deck showed one card and hid three, and what each card was ABOUT
    // was behind a tap. This tab is about a person, and a person is read at a
    // glance — so the sentence says the whole setup and the four lines each
    // carry their own current value.
    expect(json).not.toContain('"Coverflow"');
    expect(json).toContain('"portraitText"');
    expect(json).toContain('"portraitLive"');
    // Every domain is still one tap from its screen.
    for (const c of ["voices", "dictionary", "languages", "haptics"]) {
      expect(json).toContain(`"${c}"`);
    }
    // AND NO MEDIA ANYWHERE ON IT. Blurred art is not a colour: it is a
    // smear whose hue is whatever was uploaded, changing under every card and
    // row, so nothing on top of it sits on the same value twice.
    expect(json).not.toContain("card.");
    expect(json).not.toContain('"BlurBackground"');
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

  it("sends the intro out through the landing rule, not straight to Train", () => {
    // "home" is the Train tab's screen and the intro used to hand it to the
    // navigate outright, so every launch that played the film landed on Train
    // whatever the bootstrap had decided. The rule was applied in one place
    // and bypassed in the other, and the app was reported as opening on Train
    // for as long as that was true.
    const returning: any = buildScreen("intro", {
      onboarded: true, personality: { shellSeenAt: "2026-01-01T00:00:00.000Z" }, language: "en",
    } as never);
    expect(returning.actions.done.screenId).not.toBe("home");
    expect(returning.actions.done.screenId).toBe("stats");

    // Not onboarded is not a tab root, so it passes through untouched — the
    // film must never skip the steps that obtain the mic and the keyboard.
    const fresh: any = buildScreen("intro", { onboarded: false, personality: {}, language: "en" } as never);
    expect(fresh.actions.done.screenId).toBe("onboarding");
  });

  it("lets the opening film play, whatever the hand on the phone is doing", () => {
    // The whole frame was a press that skipped to the next screen. Four
    // seconds of film is four seconds of someone holding a phone, and a
    // finger resting on the glass ended the one thing in the product that is
    // meant to be watched. The timer owns the advance on every path now.
    const s: any = buildScreen("intro", { onboarded: true, personality: {}, language: "en" } as never);
    const presses = (n: any): number => {
      if (!n || typeof n !== "object") return 0;
      return (n.on?.onPress ? 1 : 0)
        + (n.on?.onLongPress ? 1 : 0)
        + (n.children ?? []).reduce((a: number, c: any) => a + presses(c), 0);
    };
    expect(presses(s.root), "the intro can still be cut short by a touch").toBe(0);
    // And it still leaves on its own.
    expect(JSON.stringify(s.actions.done)).toContain("navigate");
  });

  it("makes every round head control reachable by a thumb", () => {
    // The controls on the amber block are 32pt, because a bigger disc there
    // reads as a button stuck onto the bar rather than as part of it. 32 is
    // also under what a thumb hits reliably, and the back arrow is the one
    // control on those screens a user needs every time. The size stays; the
    // slop is what makes up the difference.
    const MIN = 44;
    for (const id of ["languages", "voices", "haptics", "dictionary"]) {
      const s: any = buildScreen(id, { personality: {}, language: "en" } as never);
      const round = (n: any, out: any[] = []): any[] => {
        if (!n || typeof n !== "object") return out;
        const w = n.style?.width;
        if (n.on?.onPress && typeof w === "number" && n.style?.borderRadius === w / 2) out.push(n);
        for (const c of n.children ?? []) round(c, out);
        return out;
      };
      for (const n of round(s.root)) {
        const reach = n.style.width + 2 * Number(n.props?.hitSlop ?? 0);
        expect(reach, `${id}: a ${n.style.width}pt control reaching only ${reach}pt`)
          .toBeGreaterThanOrEqual(MIN);
      }
    }
  });

  it("gives amber only to what is still in play", () => {
    // The rule is not a quota — "one amber per screen" says how much, not
    // what for. It is a meaning: almost everything on Stats is a settled fact
    // about a month already gone, and the accent marks the things you could
    // still change today. A streak is only one of them while it is RUNNING;
    // a number left over from a week you stopped is a record, not a streak,
    // and colouring it live would be the colour lying.
    const day = (n: number) => Array.from({ length: 30 }, (_, i) => (i < n ? 500 : 0));
    const tile = (s: any, label: string) => {
      let hit: any = null;
      const walk = (n: any): void => {
        // A tile is the pressable whose first child is its label and whose
        // second is the value row. The panels behind them repeat the same
        // words, so match on the shape and not on the words alone.
        if (!hit && n?.on?.onPress && n?.children?.[0]?.props?.content === label
            && n?.children?.[1]?.children?.[0]?.props?.content != null) hit = n;
        for (const c of n?.children ?? []) walk(c);
      };
      walk(s.root);
      expect(hit, `no ${label} tile on Stats`).toBeTruthy();
      return hit;
    };
    const value = (t: any) => t.children[1].children[0].style.color;

    // wrote today → the run is alive → amber
    const alive: any = buildScreen("stats", { personality: {}, language: "en",
      stats: { requests: 12, wordsOut: 4000, currentStreak: 9, wordsPerDay: day(30) } } as never);
    expect(value(tile(alive, "Day streak"))).toBe(STATS_UI.accent);

    // same number, nothing written today → the run is over → pale
    const over: any = buildScreen("stats", { personality: {}, language: "en",
      stats: { requests: 12, wordsOut: 4000, currentStreak: 9, wordsPerDay: [...day(29), 0] } } as never);
    expect(value(tile(over, "Day streak"))).toBe(STATS_UI.onCard);

    // and the settled facts never take it, however good the month was
    for (const label of ["Sessions", "Active days", "Per session", "Spoken"]) {
      expect(value(tile(alive, label)), `${label} should not be amber`).toBe(STATS_UI.onCard);
    }
  });

  it("puts the stats ink on a ground it can be read on", () => {
    // The screen has been amber, then bone, and is now a warm near-black.
    // Whatever it is, the type on it and on its cards has to clear a real
    // contrast — so this checks the thing that matters rather than the hex.
    const lum = (hex: string) => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const s: any = buildScreen("stats", { personality: {}, language: "en" } as never);
    expect(String(s.root.style.backgroundColor)).toBe(STATS_UI.ground);
    expect(ratio(STATS_UI.ground, STATS_UI.ink), "headline on the ground").toBeGreaterThan(7);
    expect(ratio(STATS_UI.card, STATS_UI.onCard), "figures on a card").toBeGreaterThan(7);
    // And the accent is not the reading colour. Amber is for the one thing
    // that moves; a screen whose every figure is amber has no accent at all.
    expect(STATS_UI.onCard).not.toBe(STATS_UI.accent);
    expect(STATS_UI.ink).not.toBe(STATS_UI.accent);
  });

  it("leaves no half-tile stranded in the stats grid", () => {
    // The grid used to end on a single tile beside an empty cell that existed
    // only to stop the last one stretching. A blank card-shaped hole at the
    // bottom of a screen reads as something that failed to load.
    const s: any = buildScreen("stats", { personality: {}, language: "en" } as never);
    const rows: any[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (n.style?.flexDirection === "row" && (n.children ?? []).some((c: any) => c?.on?.onPress)) rows.push(n);
      (n.children ?? []).forEach(walk);
    };
    walk(s.root);
    for (const r of rows) {
      const blanks = (r.children ?? []).filter((c: any) => !c?.on && !(c?.children ?? []).length);
      expect(blanks.length, "a spacer standing in for a missing tile").toBe(0);
    }
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



describe("the You tab reads like a face", () => {
  const you = (ctx: Record<string, unknown> = { personality: {}, language: "en" }) =>
    buildScreen("personality", ctx as never) as any;
  const lines = (s: any) => {
    const out: any[] = [];
    const walk = (n: any) => {
      if (n?.on?.onPress && n?.style?.height && n?.style?.borderRadius && (n.children ?? []).some((c: any) => c?.type === "Image")) out.push(n);
      for (const c of n?.children ?? []) walk(c);
    };
    walk(s.root);
    return out;
  };

  it("gives the voice an object and the settings rows", () => {
    // Four identical strips said the voice, the dictionary, the languages and
    // the haptics all matter the same amount. They do not: the voice is what
    // this tab is ABOUT and the rest are settings you adjust occasionally. So
    // one object with its own art, and three rows without any.
    const s = you();
    const json = JSON.stringify(s);
    // The card carries the voice's art. The rows carry none — four blurred
    // strips stacked on each other is four mud smears fighting, and at row
    // height the art was never a picture anyway, only a colour wash.
    for (const m of ["card.dictionary", "card.languages", "card.haptics"]) {
      expect(json, `${m} should not be behind a row`).not.toContain(m);
    }
    // Still every setting visible without a tap, with its value on it.
    for (const l of ["Dictionary", "Languages", "Haptics"]) expect(json).toContain(`"${l}"`);
    // And every one still one tap from its screen.
    for (const c of ["voices", "dictionary", "languages", "haptics"]) expect(json).toContain(`"${c}"`);
  });

  it("says how the voice writes, not just which one is on", () => {
    // Every voice carries a tagline and it has never been on this screen. The
    // name tells you which voice is on; the line tells you what that MEANS,
    // which is the thing anybody opening this tab wanted to know.
    const s = you({ personality: { activePresetId: "signature" }, language: "en" } as never);
    const json = JSON.stringify(s);
    expect(json).toContain('"voiceName"');
    expect(json).toContain("WRITING AS");
    // The line itself comes from the preset, so read it from there — retuning
    // a voice must never mean editing this file.
    const zu = PERSONALITY_PRESETS.find((p) => p.id === "signature")!;
    expect(json).toContain(zu.name);
    expect(json, "the card says which voice is on, not how it writes")
      .toContain(zu.tagline);
  });

  it("says the setup in one sentence, with the voice as the live word", () => {
    // The sentence is the headline of the tab. The voice is the one thing on
    // it that is actually writing, so the voice is the only word in the
    // accent — see the sacred-amber rule.
    const s = you({ personality: { activePresetId: "signature", languages: ["en", "hi"] },
                    language: "en", dictionary: [{ word: "a", replacement: "b" }] } as never);
    const json = JSON.stringify(s);
    expect(json).toContain("Writes as ");
    expect(json).toContain('"variant":"portraitLive"');
    expect(json).toContain("English, Hindi");
    expect(json).toContain("1 words of yours.");
  });

  it("never shows a zero where the honest answer is 'not yet'", () => {
    // "0 words" and "you have not added any" are different facts, and only
    // one of them is true of someone who has never opened the screen.
    const json = JSON.stringify(you());
    expect(json).toContain("None yet");
    expect(json).not.toContain('"0 words"');
    // No language picked is Auto, not an empty line.
    expect(json).toContain("Auto");
  });

  it("gives the active voice the only amber on the tab", () => {
    const s = you();
    let dots = 0;
    const walk = (n: any) => {
      if (n?.style?.backgroundColor === YOU_UI.accent && n?.style?.borderRadius) dots++;
      for (const c of n?.children ?? []) walk(c);
    };
    walk(s.root);
    // One dot beside the voice. The gear, the chevrons and the labels are all
    // white or the ground.
    expect(dots).toBe(1);
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

  it("keeps every chart on Stats, which is the screen for reading", () => {
    // The You tab used to carry a small ring on the note under the deck. Both
    // are gone: that tab says what each thing is SET TO, in words, and a
    // distribution is a different question asked on a different screen. A
    // chart there now would be a report on a page that is a portrait.
    expect(rings("personality", { stats: STATS })).toEqual([]);
    expect(rings("stats", { stats: STATS }).length).toBeGreaterThanOrEqual(3);
  });

  it("draws the empty case on Stats and says so in words", () => {
    for (const r of rings("stats")) {
      expect(r.props.slices).toEqual([]);
      expect(String(r.props.emptyLabel).length).toBeGreaterThan(0);
    }
  });

  it("charts the user's own rows once there are some", () => {
    const found = rings("stats", { stats: STATS });
    expect(found.length).toBeGreaterThanOrEqual(3);
    const s = JSON.stringify(buildScreen("stats", ctx({ stats: STATS })));
    for (const id of ["dictionary", "voices", "languages"]) expect(s).toContain(`"${id}"`);
  });

  it("gives every ring exactly one amber slice — the one that leads", () => {
    // The accent is sacred: it marks the live thing and nothing else. In a
    // ring that is the leading share. A ring of five ambers led nowhere.
    for (const r of rings("stats", { stats: STATS })) {
      const slices = r.props.slices;
      if (!slices.length) continue;
      expect(slices[0].color).toBe(YOU_UI.accent);
      for (const sl of slices.slice(1)) expect(sl.color).not.toBe(YOU_UI.accent);
    }
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

  it("keeps Zu first however many voices are pinned", () => {
    // Zu used to step aside on the first pin, which made the user's own
    // writing the one voice they could lose. The tone row is how you change
    // voice mid-sentence, so the way BACK to your own has to be on it —
    // always, and not as something Voices offers to add or remove.
    const chips = pinned({ pinnedPresetIds: ["professional", "witty"] });
    expect(chips.map((c: any) => c.id)).toEqual(["signature", "professional", "witty"]);
  });

  it("never pins Zu twice", () => {
    const chips = pinned({ pinnedPresetIds: ["signature", "witty"] });
    expect(chips.map((c: any) => c.id)).toEqual(["signature", "witty"]);
  });

  it("falls back to Zu when every pinned voice has been deleted", () => {
    // Ids that no longer resolve would otherwise send an empty row and drop
    // the keyboard back to its own cycle. One tone is the floor.
    expect(pinned({ pinnedPresetIds: ["deleted_1", "deleted_2"] })).toEqual([
      pinned()[0],
    ]);
  });
});

describe("History wears the ground it was opened from", () => {
  const hist = () => JSON.stringify(buildScreen("history", { personality: {}, language: "en" } as never));

  it("paints the Stats ground and its own way back", () => {
    // History is one tap off Stats. On the theme's black under a themed
    // header it read as a different app — and the default header paints that
    // black straight across the top of the Stats ground.
    const json = hist();
    expect(json).toContain(STATS_UI.ground);
    expect(json).toContain('"hideHeader":true');
    expect(json).not.toContain('"Card"');
  });

  it("hands the chart its colours instead of letting it pick", () => {
    // legendColor was already being sent to this component and silently
    // dropped, so the ring was drawing in a palette no screen chose.
    expect(hist()).toContain('"legendColor"');
  });
});

describe("ending a session is a moment, not a toast", () => {
  const live = () => buildScreen("training_live", { personality: {}, language: "en" } as never)!;

  it("turns three words over in the middle of the field while it saves", () => {
    const json = JSON.stringify(live());
    expect(json).toContain('"FlipText"');
    for (const w of TRAINING_UI.chat.live.farewell.words) expect(json).toContain(w);
    // It plays while the portrait is being written, and only then.
    expect(json).toContain('"visibleIf":{"truthy":"saving"}');
  });

  it("stops answering touches while it plays", () => {
    // The dismiss layer fires finish. Left live during the farewell, a stray
    // tap posts the conversation a second time and jumps the screen mid-word.
    const root = live().root as any;
    const dismiss = (root.children ?? []).filter((c: any) => c?.on?.onPress === "finish");
    expect(dismiss.length).toBeGreaterThan(0);
    for (const d of dismiss) expect(d.visibleIf).toEqual({ falsy: "saving" });
  });

  it("says it once — the flip, not the flip and a toast", () => {
    const saved = (live().actions as any).saved;
    expect(JSON.stringify(saved)).not.toContain('"toast"');
    expect(JSON.stringify(saved)).toContain('"delay"');
  });
});

describe("the way in names its own gesture", () => {
  it("says what to do with it, in bold", () => {
    // "BEGIN" is a button's word: it says what happens and leaves the disc,
    // the run and the far end unexplained — so the pill reads as a button
    // that does not answer a press.
    const cta = TRAINING_UI.entry.cta;
    expect(cta.label.toLowerCase()).toContain("slide");
    expect(cta.weight).toBe("800");
    const json = JSON.stringify(buildScreen("home", { personality: {}, language: "en" } as never));
    expect(json).toContain(cta.label);
    expect(json).toContain('"weight":"800"');
  });
});

describe("Android is never shown an empty step", () => {
  it("draws the keyboard list when no recording has been uploaded", () => {
    // iOS ships a screen recording of its walk through Settings. Android has
    // none uploaded and the node is gated per platform, so that step showed
    // the written steps and a hole where the art is.
    const json = JSON.stringify(buildScreen("onboarding_keyboard", {
      personality: {}, language: "en", platform: "android",
    } as never));
    expect(json).toContain("Manage keyboards");
    expect(json).toContain("On-screen keyboard");
    // The notice that actually stops people, named rather than left as a
    // surprise — the same fact step 3 states in words.
    expect(json).toContain("collect all the text you type");
    expect(json).toContain('"platform":"android"');
  });
});

describe("a window is not a tall phone", () => {
  const wide = (id: string) => JSON.stringify(buildScreen(id, {
    personality: { stylePortrait: {} }, language: "en",
    viewport: { width: 1180, height: 760 }, can: new Set(["ScreenHoldTouches"]),
    stats: { wordsPerDay: [10, 20] }, allowance: null,
  } as never));
  const phone = (id: string) => JSON.stringify(buildScreen(id, {
    personality: { stylePortrait: {} }, language: "en",
    viewport: { width: 390, height: 844 }, can: new Set(["ScreenHoldTouches"]),
    stats: { wordsPerDay: [10, 20] }, allowance: null,
  } as never));

  it("keeps the column readable instead of stretching it", () => {
    // A setting row stretched across a 1180px window puts its label and its
    // value at opposite ends of the desk, and the eye has to travel the whole
    // way to read one fact.
    expect(wide("personality")).toContain('"maxWidth"');
    expect(phone("personality")).not.toContain('"maxWidth"');
  });

  it("gives the paired cards more room than the settings list", () => {
    // Stats is genuinely two things side by side; the You tab is a name and
    // three rows. They should not be the same width.
    expect(wide("stats")).toContain("760");
    expect(wide("history")).toContain("620");
  });

  it("asks the viewport, not the platform", () => {
    // A desktop window, a tablet held landscape and a phone in a car dock are
    // the same question, and the answer must not depend on which binary asks.
    const tablet = JSON.stringify(buildScreen("personality", {
      personality: {}, language: "en", platform: "ios",
      viewport: { width: 1024, height: 768 },
    } as never));
    expect(tablet).toContain('"maxWidth"');
  });
});

describe("the network grows with what it has learned", () => {
  const field = (sp?: Record<string, unknown>) => {
    const json = JSON.stringify(buildScreen("home", {
      personality: sp ? { stylePortrait: sp } : {}, language: "en",
      viewport: { width: 390, height: 844 },
      can: new Set(["ScreenHoldTouches"]),
    } as never));
    return Number(/"growth":([\d.]+)/.exec(json)?.[1]);
  };

  it("opens sparse and fills in", () => {
    // A field that looks identical on day one and month six makes the screen's
    // one claim — that the thing inside gets bigger every time you talk to it
    // — false in the only place it is visible.
    const fresh = field();
    const worked = field({
      words: Array.from({ length: 40 }, (_, i) => ({ term: `w${i}`, means: "x" })),
      sessions: 30, observed: 900,
    });
    expect(fresh).toBeLessThan(0.3);
    expect(worked).toBeGreaterThan(0.85);
    expect(field({ sessions: 1, observed: 12 })).toBeGreaterThan(fresh);
  });

  it("never draws an empty screen", () => {
    // The hubs are the shape of the thing and they are all there from the
    // start. What grows is the connections between them.
    expect(field()).toBeGreaterThanOrEqual(0.18);
  });

  it("gives the live screen the same field, not a stock one", () => {
    const live = JSON.stringify(buildScreen("training_live", {
      personality: { stylePortrait: { sessions: 12, observed: 300 } }, language: "en",
    } as never));
    const g = Number(/"growth":([\d.]+)/.exec(live)?.[1]);
    expect(g).toBeGreaterThan(0.18);
    expect(g).toBeLessThan(1);
  });
});

describe("the training tab shows what it has learned", () => {
  const portrait = {
    words: [{ term: "jugaad", means: "a fix" }, { term: "ping", means: "message" }],
    styles: [{ name: "Late", when: "after midnight" }],
    rhythms: [{ when: "morning", vibe: "clipped" }],
    tones: { witty: "drier than most" },
    sessions: 9, examples: 3, observed: 214,
  };
  const home = (sp?: Record<string, unknown>) =>
    JSON.stringify(buildScreen("home", {
      personality: sp ? { stylePortrait: sp } : {}, language: "en",
      viewport: { width: 390, height: 844 },
      can: new Set(["ScreenHoldTouches"]),
    } as never));

  it("keeps the numbers out of the opening view when the phone is silent", () => {
    // Without a height for the opening pane it collapses to its content and
    // the sheet lands in the first screen — the tab opens on a ring of
    // numbers instead of on the field. A client that does not say how tall it
    // is gets the tab exactly as it was.
    for (const ctx of [
      // No window: the opening pane collapses and the sheet lands in it.
      { personality: { stylePortrait: portrait }, language: "en",
        can: new Set(["ScreenHoldTouches"]) },
      // A Screen that cancels its own touches: the scroll takes the drag off
      // the pill, and the way in stops working. Better no numbers than that.
      { personality: { stylePortrait: portrait }, language: "en",
        viewport: { width: 390, height: 844 } },
    ]) {
      const quiet = JSON.stringify(buildScreen("home", ctx as never));
      expect(quiet).not.toContain("Sittings");
      expect(quiet).not.toContain("WHAT IT KNOWS");
    }
  });

  it("sizes the opening view to the window the phone reports", () => {
    // The phone has been sending this all along. Reading it means the first
    // view is exact on every installed bundle, not only on one that knows a
    // new prop.
    expect(home(portrait)).toContain('"minHeight":844');
  });

  it("keeps the opening view one window tall, above the numbers", () => {
    // The tab still opens as a thing you LOOK at — the field, two words and
    // the way in. A ScrollView sizes itself to its content, so the pane has
    // to be told it is the opening view or its spacers collapse and the
    // title rides up against the button.
    expect(home(portrait)).toContain('"fillViewport":true');
  });

  it("counts the portrait rather than inventing a metric", () => {
    const json = home(portrait);
    // 2 words + 1 style + 1 rhythm + 1 voice.
    expect(json).toContain('"centerValue":"5"');
    expect(json).toContain("Sittings");
    expect(json).toContain("214");
    // Their own words, as they were learned.
    expect(json).toContain("jugaad");
  });

  it("charts the days it has been learning from", () => {
    // The ring says what it knows and the tiles say how much; neither says
    // WHEN, and "it gets better the more you write" is a claim about time.
    const json = JSON.stringify(buildScreen("home", {
      personality: { stylePortrait: portrait }, language: "en",
      viewport: { width: 390, height: 844 },
      can: new Set(["ScreenHoldTouches"]),
      stats: { wordsPerDay: [0, 40, 0, 120, 60, 0, 220] },
    } as never));
    expect(json).toContain("What it learns from");
  });

  it("draws no feed when there are no days to draw", () => {
    const json = JSON.stringify(buildScreen("home", {
      personality: { stylePortrait: portrait }, language: "en",
      viewport: { width: 390, height: 844 },
      can: new Set(["ScreenHoldTouches"]),
      stats: { wordsPerDay: [0, 0, 0] },
    } as never));
    expect(json).not.toContain("What it learns from");
  });

  it("says nothing is learned rather than charting zeros", () => {
    // A ring with no slices and three tiles of 0 reads as a broken screen on
    // the one day it has to read as an invitation.
    const json = home();
    expect(json).toContain("Nothing learned yet.");
    expect(json).not.toContain('"PieChart"');
  });
});

describe("a voice is opened, not switched under your finger", () => {
  const voices = (p: Record<string, unknown> = {}) =>
    JSON.stringify(buildScreen("voices", { personality: p } as never));

  it("opens the card on a tap instead of changing what the app writes as", () => {
    // Changing the voice is a consequence you cannot see from a list of names,
    // and it was fired by the most casual gesture there is. The row opens the
    // card; the card is where the name, the line and the prompt are in front
    // of you when you decide.
    const json = voices();
    expect(json).toContain('"vcOpen"');
    expect(json).toContain("Write as this voice");
    // EVERY style row, not one of them. This was wrong once: the edit action
    // landed on Zu's block and the rows kept switching voices under the
    // finger, which looks from the outside exactly like a change that never
    // shipped.
    const rows = JSON.stringify(JSON.parse(json).root);
    const opens = (rows.match(/"path":"vcOpen","value":true/g) ?? []).length;
    expect(opens).toBe(PERSONALITY_PRESETS.length - 1);
  });

  it("leaves Zu alone — a tap on it writes as it", () => {
    // Zu has nothing to edit: its prompt has to stay empty, and a card
    // offering to change that is the one thing this tab must not have.
    const root = JSON.parse(voices()).root;
    let block: any;
    // The SHALLOWEST node holding the kicker — the block itself, not the row
    // inside it that draws the dot and the words.
    const walk = (n: any) => {
      if (!block && n?.on?.onPress
          && /OWN VOICE|WRITING AS YOU/.test(JSON.stringify(n.children ?? []))) block = n;
      for (const c of n?.children ?? []) walk(c);
    };
    walk(root);
    expect(JSON.stringify(block?.on?.onPress)).toContain("/v1/personality");
    expect(JSON.stringify(block?.on?.onPress)).not.toContain("vcOpen");
  });

  it("makes a new voice in the same card, not on another screen", () => {
    // Editing happens over the list because the list is what you were
    // comparing against. Making one is the same act with empty fields.
    const addTone = (buildScreen("voices", { personality: {} } as never) as any).actions.addTone;
    expect(JSON.stringify(addTone)).not.toContain("navigate");
    expect(JSON.stringify(addTone)).toContain("vcOpen");
  });

  it("says the keyboard set in signs, not in words", () => {
    // "Add" and "Remove" are two lengths, so the list had a ragged right edge
    // and every row's button had to be read before it could be used.
    const json = voices({ pinnedPresetIds: ["witty"] });
    expect(json).toContain('"+"');
    expect(json).toContain('"\u2212"');
    expect(json).not.toContain('"Add"');
    expect(json).not.toContain('"Remove"');
    expect(json).not.toContain('"Edit"');
  });
});

describe("Zu is not a voice in the list", () => {
  const voices = (p: Record<string, unknown> = {}) =>
    JSON.stringify(buildScreen("voices", { personality: p } as never));

  it("keeps Zu out of the styles, where Add and Edit live", () => {
    // Zu is the person's own writing, repaired — not a style laid on top of
    // it. In the list it read as the twelfth voice, with an Add implying it
    // could be absent and an Edit inviting a generic sentence over the one
    // voice whose prompt has to stay empty.
    const json = voices();
    const rows = json.slice(json.indexOf("Styles"));
    expect(rows, "Zu is still in the styles list").not.toContain('"Zu"');
  });

  it("says what Zu is, above them", () => {
    const zu = PERSONALITY_PRESETS.find((p) => p.id === "signature")!;
    const json = voices();
    expect(json).toContain(zu.name);
    expect(json).toContain(zu.tagline);
  });

  it("marks Zu amber only while it is the voice writing", () => {
    expect(voices({ activePresetId: "signature" })).toContain("WRITING AS YOU");
    expect(voices({ activePresetId: "witty" })).toContain("YOUR OWN VOICE");
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

  it("gives the greeting a fixed line, so the name under it cannot move", () => {
    // The hellos are not one script, and each measures a different height. A
    // line left to size itself grew and shrank as the words turned over and
    // stepped the name up and down with it — the one still thing on the screen
    // moving because of a decoration above it.
    const s: any = buildScreen("personality", { personality: {}, language: "en" } as never);
    const find = (n: any): any => {
      if (!n || typeof n !== "object") return null;
      if (n.type === "FlipText") return n;
      for (const c of n.children ?? []) { const hit = find(c); if (hit) return hit; }
      return null;
    };
    const flip = find(s.root);
    expect(flip, "no greeting on the You tab").toBeTruthy();
    expect(typeof flip.style?.height, "the greeting can still resize itself").toBe("number");
    expect(flip.style.height).toBeGreaterThan(0);
  });

  it("docks the tabs close together, each on its own ground", () => {
    const d = shell().dock;
    expect(d, "no dock — the tabs would spread across the width again").toBeTruthy();
    // Close is the whole point. A gap approaching the square's own size stops
    // reading as a group and starts reading as three separate controls.
    expect(d!.gap).toBeLessThan(d!.size / 2);
    // A square, not a disc: half the size would round it away entirely, and a
    // disc under a glyph made of discs turns the tab into a target.
    expect(d!.radius).toBeLessThan(d!.size / 2);
    // Each one carries its own ground, which is what lets them sit on art.
    expect(d!.background).toMatch(/^(#|rgba?\()/);
    // And the whole row still has to fit the narrowest phone we support.
    expect(3 * d!.size + 2 * d!.gap).toBeLessThan(320);
  });

  it("carries the rail flag, so the bar's thread is a backend decision too", () => {
    // The VALUE is the backend's to choose and will change again. What must
    // never happen is the field going missing, because absent means yes on the
    // client and the thread would come back by omission.
    expect(typeof shell().rail).toBe("boolean");
  });

  it("keeps one layer plain and lights another, so a tab is two tones", () => {
    // The set is duotone: the shape is a material and the accent marks the one
    // part of it the tab is about. A glyph whose layers ALL carry the accent
    // turns into a solid amber silhouette when selected, which is exactly what
    // shipped once and is the thing this guards.
    for (const t of shell().tabs) {
      const layers = t.glyph!.layers;
      expect(
        layers.some((l) => l.activeColor !== undefined),
        `${t.id} has nothing that lights`,
      ).toBe(true);
      expect(
        layers.some((l) => l.activeColor === undefined && l.color !== undefined),
        `${t.id} lights all over instead of in one place`,
      ).toBe(true);
    }
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

/**
 * Settings in five sections, and the onboarding's touches.
 *
 * The owner's brief: Settings and some tabs looked messy, and the new
 * onboarding's identity should arrive as TOUCHES (the heading face, neon for
 * done/connected/on, Blip in a few right places), not a repaint, in warm
 * words. These tests hold what must not move (every Settings action keeps its
 * route and id), that there is no "welcome tour" row anywhere, that Blip is
 * one a screen and never on Settings, and that nothing new is sent that a
 * shipped build cannot draw.
 */
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ items: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: { messages: Array<{ content: string }> }) => {
          const input = body.messages[1]!.content;
          const items = JSON.parse(input.slice(input.indexOf("Input JSON:") + "Input JSON:".length)) as string[];
          seen.items.push(...items);
          return { choices: [{ message: { content: JSON.stringify({ items: items.map((s) => "MODEL:" + s) }) } }] };
        },
      },
    };
  },
}));
// The translation cache stays in memory, and starts with a model's old guess
// for a line Settings now says in the design's words: the design must win.
vi.mock("node:fs/promises", () => ({
  readFile: async (path: unknown) => {
    if (String(path).endsWith("hinglish.json")) return JSON.stringify({ "Languages": "MODEL-GUESS", "Privacy And Data": "MODEL-GUESS" });
    throw new Error("no cache here");
  },
  writeFile: async () => {},
  mkdir: async () => {},
}));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const { buildScreen, FONTS, POLICY } = await import("../src/experience/catalog.js");
const { buildDeskScreen, deskNav } = await import("../src/experience/desk.js");
const { localize } = await import("../src/experience/i18n.js");
const { SW, settingsHinglishSeeds } = await import("../src/experience/settingsWords.js");
const { NEON, HEADING_FACE, dayPart } = await import("../src/experience/touches.js");
const { OB } = await import("../src/experience/onboard.js");
const { PHONE_FONT } = await import("../src/experience/phoneLook.js");
const { BLIP_BUILD } = await import("../src/experience/blipData.js");
const { STORE_NEEDS } = await import("../src/experience/onboardStore.js");

// ---- helpers ------------------------------------------------------------------

type AnyNode = {
  type?: string; props?: Record<string, any>; style?: Record<string, any>; on?: Record<string, any>;
  bind?: Record<string, string>; visibleIf?: unknown; children?: AnyNode[]; fallback?: AnyNode;
};
function nodes(root: unknown, keep: (n: AnyNode) => boolean = () => true): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const n = v as AnyNode;
    if (typeof n.type === "string" && keep(n)) out.push(n);
    for (const c of Object.values(n)) if (c && typeof c === "object") walk(c);
  };
  walk(root);
  return out;
}
/** Every action spec anywhere in a tree, nested ones included. */
function actions(root: unknown): any[] {
  const out: any[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.kind === "string") out.push(o);
    for (const c of Object.values(o)) walk(c);
  };
  walk(root);
  return out;
}
const texts = (root: unknown) => nodes(root, (n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
const buttonLabels = (root: unknown) => nodes(root, (n) => n.type === "Button").map((n) => String(n.props?.label));
const rowsOf = (screen: any): AnyNode[] => (screen.root.children as AnyNode[]).filter((c) => c.type === "Row");
const rowLabels = (screen: any) => rowsOf(screen).map((r) => String(r.props?.label));
/** The section headings of the phone's Settings, in order: its small mono labels. */
const headings = (screen: any): string[] =>
  (screen.root.children as AnyNode[])
    .filter((c) => c.type === "Text" && c.style?.fontFamily === PHONE_FONT.label)
    .map((c) => String(c.props?.content));

const PHONE_CAN = {
  old: [] as string[],
  stage: ["OnboardStage", "BlipSpot"],
  store: [...STORE_NEEDS] as string[],
};
const settings = (extra: Record<string, unknown> = {}, can: string[] = PHONE_CAN.old) =>
  buildScreen("settings", { personality: {}, language: "en", formFactor: "phone", can: new Set(can), ...extra } as never) as any;
const deskCtx = (extra: Record<string, unknown> = {}, can: string[] = ["DeskShell"]) =>
  ({ personality: {}, language: "en", formFactor: "desktop", can: new Set(can), ...extra }) as never;
const desk = (extra: Record<string, unknown> = {}, can: string[] = ["DeskShell"]) =>
  buildScreen("desk_settings", deskCtx(extra, can)) as any;

const app = (o: Record<string, unknown> = {}) => ({
  id: "notion", name: "Notion", category: "Docs", oneLine: "Search, read and write pages.", auth: "oauth",
  connected: false, level: "look", auto: [], ...o,
});
const names = { notion: "Notion" };

// ---- 1. SETTINGS, in five sections ------------------------------------------------

describe("phone Settings: five sections, in order", () => {
  it("You, Writing, Connected apps, Privacy and data, Help and about", () => {
    expect(headings(settings({ connectorsOn: true }))).toEqual(["You", "Writing", "Connected Apps", "Privacy And Data", "Help And About"]);
  });

  it("Connected apps is only there while connected apps are on", () => {
    expect(headings(settings({ connectorsOn: false }))).toEqual(["You", "Writing", "Privacy And Data", "Help And About"]);
    expect(rowLabels(settings({}))).not.toContain("Ask Me");
  });

  it("each section has one plain line under its heading, kept as a sentence", () => {
    const s = settings({ connectorsOn: true }, PHONE_CAN.stage);
    const lines = (s.root.children as AnyNode[]).filter((c) => c.type === "Text" && c.props?.keepCase === true).map((c) => c.props!.content);
    expect(lines).toEqual([
      "Your account and your plan.",
      "How I write for you.",
      "What I can reach, and how far I can go.",
      "I delete your audio as soon as I’ve written it.",
      "Questions and the fine print.",
    ]);
  });

  it("the rows sit under their sections, most used first", () => {
    const s = settings({ connectorsOn: true }, PHONE_CAN.stage);
    // Walk the children in order, noting each row under the heading before it.
    const under: Record<string, string[]> = {};
    let at = "";
    for (const c of s.root.children as AnyNode[]) {
      if (c.type === "Text" && c.style?.fontFamily === PHONE_FONT.label) { at = String(c.props?.content); under[at] = []; }
      else if (c.type === "Row") under[at]!.push(String(c.props?.label));
    }
    expect(under["You"]).toEqual([
      "Upgrade", "Change Or Cancel · App Store", "Change Or Cancel · Google Play", "Change Or Cancel · Billed On The Web",
      "Cancel Subscription · Billed On The Web", "Sign Out",
    ]);
    expect(under["Writing"]).toEqual(["Languages", "Voice And Tone", "Keyboard Haptics", "The Voice I Read In", "What You Call Me"]);
    expect(under["Connected Apps"]).toEqual(["Ask Me", "Your Apps", "Tasks"]);
    expect(under["Privacy And Data"]).toEqual(["Privacy Policy", "Delete My Account"]);
    expect(under["Help And About"]).toEqual(["Write To Us", "Terms Of Use"]);
  });

  it("every row is the same height: one padding on the Row and on its fallback", () => {
    const rows = rowsOf(settings({ connectorsOn: true }, PHONE_CAN.stage));
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(r.props!.paddingVertical, r.props!.label).toBe(17);
      expect(r.fallback!.style!.paddingVertical, r.props!.label).toBe(17);
    }
  });

  it("the languages row says which, in a short value", () => {
    const value = (languages: string[]) => rowsOf(settings({ personality: { languages } })).find((r) => r.props!.label === "Languages")!.props!.value;
    expect(value([])).toBe("Found as you talk");
    expect(value(["en"])).toBe("English");
    expect(value(["en", "hinglish", "hi"])).toBe("English, Hinglish +1");
  });
});

describe("every Settings action still exists, with the same route and id", () => {
  it("the phone's named actions are unchanged", () => {
    const s = settings({ connectorsOn: true });
    expect(s.actions.signOut).toEqual({ kind: "signOut" });
    expect(s.actions.privacy).toEqual({ kind: "openUrl", url: POLICY.privacy, external: true });
    expect(s.actions.terms).toEqual({ kind: "openUrl", url: POLICY.terms, external: true });
    // Said aloud, so the phone capitalises it like every other toast (titleCase.ts).
    expect(s.actions.err).toEqual({ kind: "toast", message: "Couldn't Save That. Try Again.", tone: "error" });
    expect(Object.keys(s.actions).sort()).toEqual(["err", "privacy", "signOut", "terms"]);
  });

  it("every row the old Settings had still leads where it led", () => {
    const s = settings({ connectorsOn: true });
    const press = (label: string) => rowsOf(s).find((r) => r.props!.label === label)?.on?.onPress;
    // The plan: where to pay, where to change it, where to cancel.
    expect(press("Upgrade")).toEqual({ kind: "navigate", screenId: "paywall" });
    expect(press("Change Or Cancel · App Store")).toEqual({ kind: "openUrl", url: "https://apps.apple.com/account/subscriptions" });
    expect(press("Change Or Cancel · Google Play")).toEqual({ kind: "openUrl", url: "https://play.google.com/store/account/subscriptions" });
    expect(press("Change Or Cancel · Billed On The Web")).toEqual({ kind: "openUrl", url: "mailto:support@x0bot.com" });
    expect(press("Cancel Subscription · Billed On The Web")).toEqual({ kind: "navigate", screenId: "cancel_subscription" });
    // What it was, in other words.
    expect(press("The Voice I Read In")).toEqual({ kind: "navigate", screenId: "voice_read" });
    expect(press("What You Call Me")).toEqual({ kind: "navigate", screenId: "assistant_name" });
    expect(press("Ask Me")).toEqual({ kind: "navigate", screenId: "assistant_ask" });
    expect(press("Your Apps")).toEqual({ kind: "navigate", screenId: "assistant_apps" });
    expect(press("Tasks")).toEqual({ kind: "navigate", screenId: "assistant_tasks" });
    expect(press("Privacy Policy")).toBe("privacy");
    expect(press("Terms Of Use")).toBe("terms");
    expect(press("Sign Out")).toBe("signOut");
    expect(press("Delete My Account")).toEqual({ kind: "navigate", screenId: "delete_account" });
    // The ones this release adds lead to screens that already exist.
    expect(press("Languages")).toEqual({ kind: "navigate", screenId: "languages" });
    expect(press("Voice And Tone")).toEqual({ kind: "navigate", screenId: "voices" });
    expect(press("Keyboard Haptics")).toEqual({ kind: "navigate", screenId: "haptics" });
  });

  it("the plan rows keep the conditions that hide them from the wrong person", () => {
    const rows = rowsOf(settings());
    const vis = (label: string) => rows.find((r) => r.props!.label === label)!.visibleIf;
    expect(vis("Upgrade")).toEqual({ not: { flag: "billing.entitled" } });
    expect(vis("Change Or Cancel · App Store")).toEqual({ all: [{ flag: "billing.entitled" }, { flag: "billing.manage.apple" }] });
    expect(vis("Cancel Subscription · Billed On The Web")).toEqual({
      all: [{ flag: "billing.entitled" }, { flag: "billing.manage.razorpay" }, { not: { flag: "billing.ending" } }],
    });
  });

  it("the desk keeps every control it had, under the same ids", () => {
    const s = desk({ email: "a@b.co" }, ["DeskShell", "DeskAskSetup", "DeskFolders"]);
    const all = actions(s);
    // The tray-backed switches (desktop.config keys) are all still there.
    const keys = nodes(s, (n) => n.type === "Switch" && !!n.on?.onChange).map((n) => n.on!.onChange.key).filter(Boolean);
    expect(keys.sort()).toEqual(["autoStart", "live", "pauseFlush", "pill", "tap"]);
    // History's switch still saves through the same route with the same body.
    const save = all.find((a) => a.kind === "callEndpoint" && a.path === "/v1/personality");
    expect(save).toMatchObject({ method: "PUT", body: { retainHistory: "$state.retainHistory" } });
    expect(s.state.retainHistory).toBe(true);
    // The links that led somewhere still do.
    const screens = all.filter((a) => a.kind === "navigate").map((a) => a.screenId);
    expect(screens).toEqual(expect.arrayContaining(["languages", "desk_voice_read", "desk_assistant_name", "desk_plan"]));
    expect(all.some((a) => a.kind === "signOut")).toBe(true);
    // And Ask's card and its folders are still on the page.
    expect(nodes(s, (n) => n.type === "DeskAskSetup")).toHaveLength(1);
    expect(nodes(s, (n) => n.type === "DeskFolders")).toHaveLength(1);
  });

  it("a paid desk keeps its Manage link and its Razorpay cancel", () => {
    const manage = nodes(desk({ entitlement: { store: "app_store" } }), (n) => n.type === "Button" && n.props?.label === "Manage")[0];
    expect(manage?.on?.onPress).toEqual({ kind: "openUrl", url: "https://apps.apple.com/account/subscriptions" });
    const razor = actions(desk({ entitlement: { store: "razorpay", renews: true } }));
    expect(razor).toContainEqual({ kind: "navigate", screenId: "cancel_subscription" });
  });
});

describe("desk Settings: five sections, in order", () => {
  const sections = (s: any): string[] => {
    const page = s.root.children.find((c: AnyNode) => c.props?.cls === "d-page") as AnyNode;
    return page.children!.filter((c) => c.type === "Stack").map((c) => String((c.children![0] as AnyNode).props?.content));
  };

  it("You, Writing, Connected apps, This computer, Privacy and data, Help and about", () => {
    const s = desk({ assistant: { apps: [app()], names } }, ["DeskShell", "DeskConnectors"]);
    expect(sections(s)).toEqual(["You", "Writing", "Connected apps", "This computer", "Privacy and data", "Help and about"]);
  });

  it("Connected apps is left out where the window does not show them", () => {
    expect(sections(desk())).toEqual(["You", "Writing", "This computer", "Privacy and data", "Help and about"]);
  });

  it("each section has the same shape: a heading, its one line, then its rows", () => {
    const page = desk().root.children.find((c: AnyNode) => c.props?.cls === "d-page") as AnyNode;
    const parts = page.children!.filter((c) => c.type === "Stack");
    for (const p of parts) {
      expect((p.children![0] as AnyNode).props?.cls).toBe("d-h2");
      expect((p.children![1] as AnyNode).props?.cls).toBe("d-lede");
      for (const r of p.children!.slice(2)) expect(["d-entry", undefined]).toContain((r as AnyNode).props?.cls);
    }
  });

  it("the page speaks in the first person", () => {
    const t = texts(desk()).join(" | ");
    expect(t).toContain("How I work on this computer");
    expect(t).toContain("I delete it as soon as it’s written");
    expect(t).toContain("What you call me");
  });
});

// ---- 2. NO WELCOME TOUR ROW, anywhere --------------------------------------------

describe("there is no way back into the welcome tour from Settings", () => {
  it("neither the phone's Settings nor the desk's has a row for it, whatever the build can draw", () => {
    for (const can of [PHONE_CAN.old, PHONE_CAN.stage, PHONE_CAN.store]) {
      expect(JSON.stringify(settings({ connectorsOn: true }, can)).toLowerCase()).not.toContain("welcome tour");
      expect(JSON.stringify(settings({ connectorsOn: true }, can))).not.toContain('"screenId":"onboard"');
    }
    for (const can of [["DeskShell"], ["DeskShell", "OnboardStage", "BlipSpot"]]) {
      expect(JSON.stringify(desk({}, can)).toLowerCase()).not.toContain("welcome tour");
      expect(JSON.stringify(desk({}, can))).not.toContain('"screenId":"onboard"');
    }
  });

  it("the onboarding takes no `tour` param: asked for with one, it is the same screen", () => {
    const stage = (params?: Record<string, unknown>) =>
      buildScreen("onboard", { personality: { languages: ["en"] }, language: "en", platform: "ios", formFactor: "phone", can: new Set(PHONE_CAN.stage), keyboardReady: true, params } as never) as any;
    expect(JSON.stringify(stage({ tour: "1" }))).toBe(JSON.stringify(stage()));
    expect(stage().actions.finish).toMatchObject({ kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { onboarded: true } });
  });
});

// ---- 3. NOTHING NEW THAT A SHIPPED BUILD CANNOT DRAW ------------------------------

/** The phone's CORE_COMPONENTS at origin/main (app/src/sdui/registry.ts). */
const PHONE_COMPONENTS = new Set([
  "Screen", "Stack", "Spacer", "Text", "Image", "Icon", "Button", "TextField", "Chip", "Card", "List", "Divider", "ProgressBar", "VoiceButton",
  "Overline", "Heading", "Paragraph", "Quote", "Badge", "KeyValue", "Hero", "VoiceToggle", "RefineButton", "DraftButton", "Pager", "Row",
  "DictionaryEditor", "WordChips", "LanguageGreetingGrid", "FlipText", "Grid", "MasonryGrid", "Modal", "BottomSheet", "ActionSheet", "Popover",
  "Tooltip", "Collapsible", "StickyHeader", "PullToRefresh", "SafeArea", "Switch", "Slider", "Stepper", "SegmentedControl", "SearchField", "Picker",
  "DatePicker", "LineChart", "BarChart", "Sparkline", "ProgressRing", "Gauge", "StatCard", "Waveform", "PieChart", "DonutChart", "Video",
  "ImagePickerButton", "Avatar", "AvatarStack", "Slideshow", "ParticleMark", "KeyboardPreview", "BinaryReveal", "MorphOut", "WordMeter", "Toast",
  "Snackbar", "LoadingSkeleton", "Confetti", "Rating", "EmptyState", "Countdown", "SwipeAction", "Coverflow", "Reels", "AuroraOrb", "ChatThread",
  "VoiceBubble", "VoiceSession", "SwipePill", "AppleSignIn", "GoogleSignIn", "CodeEntry", "AuthPhase", "Rise", "NeuralField", "WebView", "SVG",
  "Gradient", "BlurBackground", "QRCode", "IfElse", "ForEach", "Portal",
]);
/** The phone's CORE_ACTIONS that these screens use. */
const PHONE_ACTIONS = new Set([
  "navigate", "navigateBack", "switchTab", "openUrl", "callEndpoint", "setState", "haptic", "toast", "signOut", "sequence", "delay", "refresh",
  "toggleState", "toggleInArray", "clearState", "appendState", "condition",
]);
/** The desktop's COMPONENTS and ACTIONS (sdui.js), as desk.test.ts mirrors them. */
const DESK_COMPONENTS = new Set([
  "Screen", "Stack", "Spacer", "Text", "Image", "Icon", "Button", "TextField", "Chip", "Card", "List", "Divider", "Row", "Overline", "Heading",
  "Paragraph", "Quote", "Badge", "KeyValue", "Hero", "Switch", "SegmentedControl", "StatCard", "BarChart", "LineChart", "Sparkline", "PieChart",
  "DonutChart", "ProgressRing", "Gauge", "WordMeter", "Video", "Audio", "Grid", "SVG", "Gradient", "BlurBackground", "FlipText", "Modal",
  "ProgressBar", "SwipeAction", "NeuralField", "ChatThread", "VoiceToggle", "VoiceButton", "VoiceSession", "DeskShell", "Keys", "DeskAskSetup",
  "DeskFolders",
]);
const DESK_ACTIONS = new Set([
  "navigate", "back", "switchTab", "callEndpoint", "setState", "toggleState", "toggleInArray", "refresh", "openUrl", "toast", "haptic", "sequence",
  "delay", "reloadScreen", "navigateBack", "dismiss", "clearState", "appendState", "condition", "desktop.config", "signOut", "connector.connect",
]);
/** What the shipped Row reads (components.tsx Row), and what the Image reads on both clients. */
const ROW_PROPS = new Set(["label", "value", "chevron", "danger", "paddingVertical"]);
const IMAGE_PROPS = new Set(["source", "contentFit"]);

const typesIn = (root: unknown) => new Set(nodes(root).map((n) => n.type!));
const kindsIn = (root: unknown) => new Set(actions(root).map((a) => a.kind as string));
const outside = (have: Set<string>, shipped: Set<string>) => [...have].filter((x) => !shipped.has(x));

describe("the new nodes, props and actions are in the shipped registries", () => {
  const apps = { apps: [app({ connected: true }), app({ id: "x", name: "X", connected: false })], names, tasks: [] };
  const phone = (id: string, extra: Record<string, unknown> = {}, can = PHONE_CAN.store) =>
    buildScreen(id, { personality: {}, language: "en", formFactor: "phone", can: new Set(can), connectorsOn: true, assistant: apps, history: [], ...extra } as never) as any;

  it("the phone's Settings, History and the assistant's screens use only what the phone draws", () => {
    for (const id of ["settings", "history", "assistant_apps", "assistant_tasks", "assistant_ask", "assistant_approve", "personality", "languages", "voices"]) {
      const s = phone(id);
      expect(outside(typesIn(s.root), PHONE_COMPONENTS), id).toEqual([]);
      // The You tab's own actions (endFlowSession and the like) are the app's, as they were.
      if (id !== "personality") expect(outside(kindsIn(s), PHONE_ACTIONS), id).toEqual([]);
    }
  });

  it("a Row carries only the props the phone's Row reads, an Image only what both Images read", () => {
    for (const id of ["settings", "history", "assistant_apps", "assistant_tasks", "assistant_ask", "assistant_approve", "personality"]) {
      const s = phone(id, id === "assistant_apps" ? { assistant: { apps: [app()], names } } : id === "assistant_tasks" ? { assistant: { apps: [], names, tasks: [] } } : {});
      for (const r of nodes(s.root, (n) => n.type === "Row")) {
        expect(Object.keys(r.props ?? {}).filter((k) => !ROW_PROPS.has(k)), id).toEqual([]);
      }
      for (const i of nodes(s.root, (n) => n.type === "Image")) {
        expect(Object.keys(i.props ?? {}).filter((k) => !IMAGE_PROPS.has(k)), id).toEqual([]);
        // Blip's loops, and an app's own logo (appIcons.ts) where the app has one.
        expect(i.props!.source.url).toMatch(/\/(blip\/[a-z]+-[sl]\.webp|icons\/[a-z-]+\.png)\?v=\d+$/);
      }
    }
  });

  it("every desk page, with the onboarding and the legal links on, uses only what the window draws", () => {
    const can = ["DeskShell", "DeskConnectors", "OnboardStage", "BlipSpot"];
    for (const id of ["desk_settings", "desk_history", "desk_notes", "desk_note", "desk_tasks", "desk_train", "desk_today"]) {
      const s = buildScreen(id, deskCtx({ assistant: { apps: [app()], names, tasks: [] }, history: [], notes: [], email: "a@b.co" }, can)) as any;
      expect(outside(typesIn(s.root), DESK_COMPONENTS), id).toEqual([]);
      expect(outside(kindsIn(s), DESK_ACTIONS), id).toEqual([]);
    }
  });

  it("the picture is the Image node the store build already draws", () => {
    expect(STORE_NEEDS).toContain("Image");
    expect(DESK_COMPONENTS.has("Image")).toBe(true);
    expect(PHONE_COMPONENTS.has("Image")).toBe(true);
  });
});

// ---- 4. THE TOUCHES, and nowhere else ---------------------------------------------

describe("touches of the new identity", () => {
  it("the heading face is the one the onboarding uses, and is registered for every build", () => {
    expect(HEADING_FACE).toBe(OB.headingFont);
    expect(PHONE_FONT.grotesk).toBe(OB.headingFont);
    expect(Object.keys(FONTS)).toContain(HEADING_FACE);
  });

  it("neon is the onboarding's neon", () => {
    expect(NEON).toBe(OB.neon);
    expect(NEON).toBe("#39FF14");
  });

  it("the phone's big page titles wear the heading face", () => {
    const title = (id: string, text: string) => {
      const s = buildScreen(id, { personality: {}, language: "en", history: [], assistant: { apps: [], names, tasks: [] }, connectorsOn: true } as never) as any;
      return nodes(s.root, (n) => n.type === "Text" && n.props?.content === text)[0]!;
    };
    expect(title("settings", "Settings").style!.fontFamily).toBe(HEADING_FACE);
    // Capitalised word by word on the phone, as every title is (titleCase.ts).
    expect(title("languages", "Tap Each One You Speak.").style!.fontFamily).toBe(HEADING_FACE);
    expect(title("voice_read", "The Voice That Reads Answers Back To You.").style!.fontFamily).toBe(HEADING_FACE);
    expect(title("assistant_tasks", "What I’m doing in your apps").style!.fontFamily).toBe(HEADING_FACE);
    const hist = buildScreen("history", { personality: {}, language: "en", history: [] } as never) as any;
    expect(nodes(hist.root, (n) => n.props?.content === "@history.title")[0]!.style!.fontFamily).toBe(HEADING_FACE);
  });

  it("the desk's page titles wear it only in a window that draws the onboarding", () => {
    const h1 = (can: string[]) => nodes(desk({}, can).root, (n) => String(n.props?.cls).includes("d-h1"))[0]!;
    const yes = h1(["DeskShell", "OnboardStage", "BlipSpot"]);
    expect(yes.style!.fontFamily).toContain(HEADING_FACE);
    expect(yes.style!.fontWeight).toBe(800);
    // An older window has not got the typeface: its titles are what they were.
    expect(h1(["DeskShell"]).style!.fontFamily).toBeUndefined();
  });

  it("neon marks a connected app and nothing else on the phone's Settings, History or Tasks", () => {
    for (const id of ["settings", "history", "assistant_tasks", "languages", "voices", "personality", "stats"]) {
      const s = buildScreen(id, { personality: {}, language: "en", history: [], connectorsOn: true, assistant: { apps: [], names, tasks: [] } } as never);
      expect(JSON.stringify(s), id).not.toContain(NEON);
    }
    const apps = (connected: boolean) => JSON.stringify(buildScreen("assistant_apps", {
      personality: {}, language: "en", assistant: { apps: [app({ connected })], names }, can: new Set(["ActionUrl"]),
    } as never));
    expect(apps(true)).toContain(NEON);
    expect(apps(false)).not.toContain(NEON);
    // A connected app that needs signing in again is not "on".
    expect(JSON.stringify(buildScreen("assistant_apps", {
      personality: {}, language: "en", assistant: { apps: [app({ connected: true, needsSignIn: true })], names }, can: new Set(["ActionUrl"]),
    } as never))).not.toContain(NEON);
  });

  it("neon marks a connected app and nothing else on the desk's Settings", () => {
    const withApp = (o: Record<string, unknown>) => JSON.stringify(desk({ assistant: { apps: [app(o)], names } }, ["DeskShell", "DeskConnectors"]));
    expect(withApp({ connected: true })).toContain(NEON);
    expect(withApp({ connected: false })).not.toContain(NEON);
    expect(withApp({ connected: true, needsSignIn: true })).not.toContain(NEON);
    expect(JSON.stringify(desk())).not.toContain(NEON);
  });
});

describe("Blip on the empty states, with one warm line", () => {
  const blipOf = (root: unknown) => nodes(root, (n) => n.type === "Image" && /\/blip\//.test(String(n.props?.source?.url))).map((n) => String(n.props!.source.url).match(/\/blip\/([a-z]+-[sl])\.webp/)![1]);

  it("no history yet: the phone shows him only while the list is empty and nothing is loading", () => {
    const s = buildScreen("history", { personality: {}, language: "en", history: [] } as never) as any;
    const stack = nodes(s.root, (n) => n.type === "Stack" && !!n.visibleIf && blipOf(n).length > 0)[0]!;
    expect(blipOf(stack)).toEqual(["listen-s"]);
    expect(stack.visibleIf).toEqual({ all: [{ eq: ["entries.length", 0] }, { eq: ["loading", false] }] });
    expect(texts(stack)).toEqual(["Nothing here yet. Say something in any app, and I’ll keep it here."]);
    // The list says nothing of its own, so the line is not said twice.
    expect(nodes(s.root, (n) => n.type === "List")[0]!.props!.emptyLabel).toBe("");
    // Its state is the one the condition reads.
    expect(s.state.entries).toEqual([]);
    expect(s.state.loading).toBe(false);
  });

  it("no history yet: the desk", () => {
    const s = buildScreen("desk_history", deskCtx({ history: [] })) as any;
    expect(blipOf(s.root)).toEqual(["listen-s"]);
    expect(texts(s.root)).toContain("Nothing here yet. Say something in any app, and I’ll keep it here.");
    // With history there is no picture.
    const full = buildScreen("desk_history", deskCtx({ history: [{ id: "a", kind: "voice", input: "hi", output: "Hi.", wordsOut: 1, createdAt: new Date().toISOString() }] })) as any;
    expect(blipOf(full.root)).toEqual([]);
  });

  it("no notes yet: the desk, and the explanation stays", () => {
    const s = buildScreen("desk_notes", deskCtx({ notes: [] }, ["DeskShell", "DeskNotes"])) as any;
    expect(blipOf(s.root)).toEqual(["tap-s"]);
    expect(texts(s.root)).toContain("No notes yet. Start one, and I’ll listen.");
    expect(texts(s.root).join(" ")).toContain("tells the voices apart");
  });

  it("no tasks: the phone and the desk, in the assistant's own line", () => {
    const phone = buildScreen("assistant_tasks", { personality: {}, language: "en", assistant: { apps: [], names, tasks: [] } } as never) as any;
    expect(blipOf(phone.root)).toEqual(["think-s"]);
    expect(texts(phone.root)).toContain("Nothing yet. Ask me to do something in your apps, and it shows up here.");
    const dsk = buildScreen("desk_tasks", deskCtx({ assistant: { apps: [], names, tasks: [] } }, ["DeskShell", "DeskConnectors"])) as any;
    expect(blipOf(dsk.root)).toEqual(["think-s"]);
    expect(texts(dsk.root)).toContain("Nothing yet. Ask me to do something in your apps, and it shows up here.");
  });

  it("no connected apps: Blip is at the top of the phone's Apps either way, with the line only while none is connected", () => {
    const phone = (connected: boolean) => buildScreen("assistant_apps", { personality: {}, language: "en", assistant: { apps: [app({ connected })], names } } as never) as any;
    expect(blipOf(phone(false).root)).toEqual(["present-s"]);
    expect(texts(phone(false).root)).toContain("No apps yet. Connect one, and I can start doing things in it.");
    expect(blipOf(phone(true).root)).toEqual(["present-s"]);
    expect(texts(phone(true).root)).not.toContain("No apps yet. Connect one, and I can start doing things in it.");
    // At the top: he comes before the Ask button, which comes before the apps' sections.
    const flat = nodes(phone(false).root, (n) => n.type === "Image" || n.type === "Text");
    const at = flat.findIndex((n) => n.type === "Image");
    const ask = flat.findIndex((n) => n.type === "Text" && /^ask me$/i.test(String(n.props?.content)));
    const sections = flat.findIndex((n) => n.type === "Text" && /^(apps to start with|your apps|more apps)$/i.test(String(n.props?.content)));
    expect(at).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(at);
    if (sections > -1) expect(sections).toBeGreaterThan(ask);
  });

  it("each picture is a loop that exists, drawn at its true size and served where the others are", () => {
    for (const [id, loop] of [["history", "listen-s"], ["assistant_tasks", "think-s"], ["assistant_apps", "present-s"]] as const) {
      const s = buildScreen(id, { personality: {}, language: "en", history: [], assistant: { apps: [app()], names, tasks: [] } } as never) as any;
      const img = nodes(s.root, (n) => n.type === "Image")[0]!;
      const f = BLIP_BUILD.files[loop]!;
      expect(img.props!.source.url).toContain(`/blip/${loop}.webp?v=${BLIP_BUILD.v}`);
      expect(img.style!.height).toBe(Math.round(f.h * 0.9));
      expect(img.style!.borderRadius).toBe(0);
    }
  });
});

// ---- 4b. BLIP IN THE RIGHT PLACES: greeting, working, tasks, success, error ----------

describe("Blip in the right places", () => {
  const poses = (root: unknown) => nodes(root, (n) => n.type === "Image" && /\/blip\//.test(String(n.props?.source?.url))).map((n) => String(n.props!.source.url).match(/\/blip\/([a-z]+-[sl])\.webp/)![1]!);
  const task = (state: string, o: Record<string, unknown> = {}) => ({
    id: "t" + state, state, title: "Add the gym task", steps: [{ at: 1, text: "Looking in Google Tasks" }], approval: null, createdAt: 1, updatedAt: 1, ...o,
  });
  const waitingTask = task("waiting", { approval: { id: "ap1", connector: "notion", tool: "create_page", risk: "write", preview: "Add the page Gym to Notion" } });
  const phoneTasks = (tasks: unknown[]) => buildScreen("assistant_tasks", { personality: {}, language: "en", assistant: { apps: [], names, tasks } } as never) as any;
  const deskTasks = (tasks: unknown[]) => buildScreen("desk_tasks", deskCtx({ assistant: { apps: [], names, tasks } }, ["DeskShell", "DeskConnectors"])) as any;
  /** The heading of a section and the Blip beside it, in one row. */
  const beside = (root: unknown, heading: string): string[] => {
    const row = nodes(root, (n) => n.type === "Stack" && poses(n).length > 0 && texts(n).includes(heading) && !nodes(n, (m) => m !== n && m.type === "Stack" && texts(m).length > 3).length)
      .sort((a, b) => nodes(a).length - nodes(b).length)[0];
    return row ? poses(row) : [];
  };

  it("the time of day is the person's own: a UTC offset moves the hour", () => {
    const at = (iso: string, tz?: number) => dayPart(tz, Date.parse(iso));
    expect(at("2026-10-22T08:00:00Z", 0)).toBe("morning");
    expect(at("2026-10-22T14:30:00Z", 0)).toBe("afternoon");
    expect(at("2026-10-22T18:00:00Z", 0)).toBe("evening");
    expect(at("2026-10-22T23:00:00Z", 0)).toBe("night");
    expect(at("2026-10-22T03:00:00Z", 0)).toBe("night");
    // 02:00 UTC is breakfast in Auckland (+13) and the small hours in New York (-4).
    expect(at("2026-10-22T20:00:00Z", 330)).toBe("night");     // 01:30 in India
    expect(at("2026-10-22T02:00:00Z", 780)).toBe("afternoon");  // 15:00 in Auckland
    expect(at("2026-10-22T10:00:00Z", -240)).toBe("morning");   // 06:00 in New York
    expect(at("2026-10-22T02:00:00Z", -240)).toBe("night");     // 22:00 the evening before
    // Nothing known about the person: UTC, and never a throw.
    expect(at("2026-10-22T08:00:00Z", undefined)).toBe("morning");
    expect(at("2026-10-22T08:00:00Z", Number.NaN)).toBe("morning");
  });

  it("Home: a small Blip waves and the line follows the time of day, on the phone and on the desk", () => {
    const lines = { morning: SW["g.morning"].en, afternoon: SW["g.afternoon"].en, evening: SW["g.evening"].en, night: SW["g.night"].en };
    expect(new Set(Object.values(lines)).size).toBe(4);
    const phone = buildScreen("personality", { personality: {}, language: "en", name: "Asha", tzOffsetMinutes: 330 } as never) as any;
    const want = lines[dayPart(330)];
    expect(texts(phone.root)).toContain(want);
    expect(poses(phone.root)).toEqual(["wave-l"]);
    const dsk = buildScreen("desk_today", deskCtx({ tzOffsetMinutes: 330 })) as any;
    expect(texts(dsk.root)).toContain(want);
    expect(poses(dsk.root)).toEqual(["wave-l"]);
    // He is small: well under his drawn size.
    const f = BLIP_BUILD.files["wave-l"]!;
    expect(nodes(phone.root, (n) => n.type === "Image")[0]!.style!.height).toBeLessThan(f.h / 2);
  });

  it("Tasks: beside Waiting for you he points; with none waiting he carries; done is a thumbs-up; empty, he thinks", () => {
    expect(beside(phoneTasks([waitingTask, task("running"), task("done")]).root, "Waiting for you")).toEqual(["pointd-s"]);
    expect(poses(phoneTasks([waitingTask, task("running"), task("done")]).root)).toEqual(["pointd-s"]);
    expect(poses(phoneTasks([task("running"), task("done")]).root)).toEqual(["carry-s"]);
    expect(poses(phoneTasks([task("done")]).root)).toEqual(["thumbs-s"]);
    expect(poses(phoneTasks([task("failed")]).root)).toEqual([]);
    expect(poses(phoneTasks([]).root)).toEqual(["think-s"]);
    // The desk, the same.
    expect(beside(deskTasks([waitingTask, task("running")]).root, "Waiting for you")).toEqual(["pointd-s"]);
    expect(poses(deskTasks([waitingTask, task("running"), task("done")]).root)).toEqual(["pointd-s"]);
    expect(poses(deskTasks([task("running")]).root)).toEqual(["carry-s"]);
    expect(poses(deskTasks([task("done")]).root)).toEqual(["thumbs-s"]);
    expect(poses(deskTasks([]).root)).toEqual(["think-s"]);
  });

  it("Tasks: he is never inside a task's card, and the buttons that answer are where they were", () => {
    const s = phoneTasks([waitingTask, task("running")]);
    for (const card of nodes(s.root, (n) => n.type === "Stack" && !!n.style?.borderRadius && n.style.borderRadius === 18)) {
      expect(poses(card)).toEqual([]);
    }
    expect(actions(s).some((a) => a.kind === "callEndpoint" && /approve/.test(String(a.path)))).toBe(true);
  });

  it("an error a screen already shows: Blip thinks, and the fix is one line under what is so", () => {
    for (const id of ["assistant_apps", "assistant_tasks", "assistant_ask"]) {
      const s = buildScreen(id, { personality: {}, language: "en" } as never) as any;
      expect(poses(s.root), id).toEqual(["think-s"]);
      expect(texts(s.root), id).toContain("I can’t reach your apps just yet.");
      expect(texts(s.root), id).toContain("Open this again in a little while, and I’ll try once more.");
    }
  });

  it("Ask: while it works, Blip thinks beside the line that says so, and only then", () => {
    const s = buildScreen("assistant_ask", { personality: {}, language: "en", connectorsOn: true, assistant: { apps: [], names, tasks: [] } } as never) as any;
    expect(poses(s.root)).toEqual(["think-s"]);
    const stack = nodes(s.root, (n) => n.type === "Stack" && poses(n).length > 0 && !!n.visibleIf)[0]!;
    expect(stack.visibleIf).toEqual({ truthy: "ask.busy" });
    expect(s.state.ask.busy).toBe(false);
  });

  it("Nothing waiting for an OK is a success: thumbs-up", () => {
    const s = buildScreen("assistant_approve", { personality: {}, language: "en", assistant: { apps: [], names, tasks: [] } } as never) as any;
    expect(poses(s.root)).toEqual(["thumbs-s"]);
    expect(texts(s.root)).toContain("Nothing is waiting for you right now.");
  });

  it("A subscription that is live is a success: tada", () => {
    const s = buildScreen("paywall", { personality: {}, language: "en", entitlement: { store: "app_store", renews: true } } as never) as any;
    expect(poses(s.root)).toEqual(["tada-s"]);
    expect(buttonLabels(s.root)).toContain("Done");
    expect(outside(typesIn(s.root), PHONE_COMPONENTS)).toEqual([]);
  });

  it("a note being written: carry; a note that failed: think, with the fix; a note that is ready: none", () => {
    const note = (status: string, o: Record<string, unknown> = {}) => buildScreen("desk_note", deskCtx({
      note: { id: "n1", status, startedAt: "2026-10-22T09:00:00Z", durationSeconds: 600, summary: "", highlights: [], people: [], transcript: [], organised: status === "ready", systemAudio: "ok", ...o },
    }, ["DeskShell", "DeskNotes"])) as any;
    expect(poses(note("organising").root)).toEqual(["carry-s"]);
    expect(texts(note("organising").root)).toContain("Organising. This takes a minute");
    const failed = note("failed");
    expect(poses(failed.root)).toEqual(["think-s"]);
    expect(texts(failed.root)).toContain("Tap Organise again, and I’ll have another go.");
    expect(poses(note("ready").root)).toEqual([]);
    expect(poses(note("recording").root)).toEqual([]);
  });

  it("at most one Blip a screen, none on Settings, none inside a list or a row", () => {
    const rich = {
      personality: { languages: ["en"] }, language: "en", name: "Asha", email: "a@b.co", connectorsOn: true, tzOffsetMinutes: 330,
      history: [{ id: "a", kind: "voice", input: "hi", output: "Hi.", wordsOut: 1, createdAt: new Date().toISOString() }],
      assistant: { apps: [app({ connected: true }), app({ id: "x", name: "X" })], names, tasks: [waitingTask, task("running"), task("done")] },
    };
    const empty = { personality: {}, language: "en", history: [], notes: [], connectorsOn: true, assistant: { apps: [], names, tasks: [] } };
    const phoneIds = ["settings", "personality", "stats", "history", "languages", "voices", "haptics", "voice_read", "assistant_name", "assistant_apps",
      "assistant_tasks", "assistant_ask", "assistant_approve", "assistant_app_tools", "delete_account", "cancel_subscription", "dictionary", "paywall"];
    const deskIds = ["desk_today", "desk_history", "desk_notes", "desk_insights", "desk_words", "desk_voices", "desk_train", "desk_settings", "desk_tasks", "desk_plan"];
    const can = ["DeskShell", "DeskConnectors", "DeskNotes", "OnboardStage", "BlipSpot", ...STORE_NEEDS];
    for (const ctx of [rich, empty]) {
      for (const id of phoneIds) {
        const s = buildScreen(id, { ...ctx, formFactor: "phone", can: new Set(can) } as never) as any;
        if (!s) continue;
        expect(poses(s.root).length, `${id} (phone)`).toBeLessThanOrEqual(1);
        if (id === "settings") expect(poses(s.root), "settings").toEqual([]);
        for (const r of nodes(s.root, (n) => n.type === "Row" || n.type === "List")) expect(poses(r), `${id} in a Row or List`).toEqual([]);
        for (const l of nodes(s.root, (n) => n.type === "List")) expect(poses(l.props?.itemTemplate), `${id} item template`).toEqual([]);
      }
      for (const id of deskIds) {
        const s = buildScreen(id, deskCtx(ctx as Record<string, unknown>, can)) as any;
        if (!s) continue;
        expect(poses(s.root).length, `${id} (desk)`).toBeLessThanOrEqual(1);
        if (id === "desk_settings") expect(poses(s.root), "desk_settings").toEqual([]);
        // Not inside an entry of a list: the rows the desk calls d-entry.
        for (const e of nodes(s.root, (n) => String(n.props?.cls ?? "").split(" ").includes("d-entry"))) expect(poses(e), `${id} in an entry`).toEqual([]);
      }
    }
  });

  it("the desk's Settings has no Blip even with no app connected", () => {
    const s = desk({ assistant: { apps: [app({ connected: false })], names } }, ["DeskShell", "DeskConnectors"]);
    expect(poses(s.root)).toEqual([]);
  });
});

describe("tab labels", () => {
  it("the desk's Train tab is Teach me, with the same id and screen", () => {
    const tab = (deskNav(false) as any).tabs.find((t: any) => t.id === "desk_train");
    expect(tab).toEqual({ id: "desk_train", title: "Teach me", screenId: "desk_train" });
    expect(texts(buildDeskScreen("desk_train", { personality: {} } as never)!.root)).toContain("Teach me");
  });
});

// ---- 5. THE WORDS, in English and in Hinglish -------------------------------------

describe("the words of Settings", () => {
  it("every line has its Hinglish, written out, and none is left to the model", () => {
    const seeds = settingsHinglishSeeds();
    for (const [key, line] of Object.entries(SW)) {
      expect(line.hg.length, key).toBeGreaterThan(2);
      expect(seeds.get(line.en), key).toBe(line.hg);
    }
  });

  it("a label is seeded as the phone draws it (every word capitalised) and as the desk does", () => {
    const seeds = settingsHinglishSeeds();
    expect(seeds.get("Privacy And Data")).toBe("Privacy aur data");
    expect(seeds.get("Privacy and data")).toBe("Privacy aur data");
    // A sentence is only ever drawn as written.
    expect(seeds.has("Your Account And Your Plan.")).toBe(false);
  });

  it("the voice is X0 Bot's: short, warm, honest, and in the first person", () => {
    const sentences = Object.values(SW).filter((l) => (l as { sentence?: true }).sentence).map((l) => l.en);
    expect(sentences.length).toBeGreaterThan(8);
    for (const s of sentences) expect(s.length, s).toBeLessThan(110);
    const joined = sentences.join(" ");
    expect(joined).toMatch(/\bI\b/);
    expect(joined).not.toMatch(/\bX0( Bot)?\b|\bTailzu\b/);
  });

  it("Settings in Hinglish: the design's words win over the model's old guess, and the model is not asked for them", async () => {
    seen.items.length = 0;
    const s = settings({ connectorsOn: true, language: "hinglish" }, PHONE_CAN.stage);
    const json = JSON.stringify(await localize(s, "hinglish"));
    for (const hg of ["Bhashayein", "Awaaz aur andaaz", "Jis awaaz mein main padhta hoon", "Aap mujhe kya bulate ho", "Privacy aur data", "Madad aur jaankari", "Humein likho", "Mera account delete karo", "Aapka account aur aapka plan."]) {
      expect(json, hg).toContain(hg);
    }
    // The cache held "MODEL-GUESS" for two of the lines; the design's is used.
    expect(json).not.toContain("MODEL-GUESS");
    for (const en of ["Languages", "Privacy And Data", "How I write for you."]) expect(seen.items).not.toContain(en);
  });

  it("the desk's Settings and the empty states too", async () => {
    seen.items.length = 0;
    const d = JSON.stringify(await localize(desk({}, ["DeskShell", "OnboardStage", "BlipSpot"]), "hinglish"));
    for (const hg of ["Is computer par main kaise kaam karta hoon", "Likhna", "Yeh computer", "Likhte hi main ise delete kar deta hoon"]) expect(d, hg).toContain(hg);
    const h = JSON.stringify(await localize(buildScreen("history", { personality: {}, language: "en", history: [] } as never)!, "hinglish"));
    expect(h).toContain("Abhi kuch nahi. Kisi bhi app mein kuch bolo, main yahin rakh lunga.");
    // The tab's new label comes with the bootstrap.
    const nav = JSON.stringify(await localize({ schemaVersion: 1, navigation: deskNav(false) } as never, "hinglish"));
    expect(nav).toContain("Mujhe sikhao");
  });

  it("English is untouched by the seeds", async () => {
    const s = settings({ connectorsOn: true });
    expect(JSON.stringify(await localize(s, "en"))).toContain("How I write for you.");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

// The Bots app's first run (screens/firstRun.ts, routes/botsFirstRun.ts): Welcome, Sign in and Code in the gate's
// tree, then About you → Name on a stage of their own, with one Blip walking across both; Language, Turn on Keybot,
// First words and Plans are pages reached from the app, and Bots and Keybot carry the keyboard and microphone cards.
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.STATIC_BEARER_TOKENS = "test-static-token-0123456789";
process.env.BOTS_APP = "true";

const { buildBootstrap } = await import("../src/experience/catalog.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { botsAuthTree, BOTS_FIRST_RUN_IDS } = await import("../src/experience/bots/screens/firstRun.js");
const { nameFromEmail, planLine, signedInVia, spokenSince, startingName, trialDaysOf } = await import("../src/routes/botsFirstRun.js");

const LANGS = { options: [{ value: "hinglish", label: "Hinglish" }, { value: "hi", label: "Hindi" }, { value: "en", label: "English" }, { value: "ta", label: "Tamil" }], picked: ["ta", "en"] };
const WORDS = { words: 0, seconds: 0, typingSeconds: 0, totalWords: 5210, totalSeconds: 1880 };
const PHONE_PLANS = {
  freeForAll: false, entitled: false, freeWords: 2000, features: ["Unlimited voice-to-text refinement"],
  plans: [
    { id: "annual", label: "Elite", price: "$59.99", per: "$5.00 / mo, billed yearly", trialDays: 7, default: true, line: "100× more every month, for all your bots", buy: { kind: "iap.showPaywall", offeringId: "default", packageId: "$rc_annual" } },
    { id: "monthly", label: "Lite", price: "$9.99", per: "per month", line: "10× more every month, for all your bots", buy: { kind: "iap.showPaywall", offeringId: "default", packageId: "$rc_monthly" } },
  ],
};
const API: Record<string, unknown> = {
  "GET /v1/bots/first-run/languages": LANGS,
  "GET /v1/personality": { personality: { assistantName: "Zara" } },
  "GET /v1/bots/first-run/profile": { name: "Aanya Rao", via: "email", source: "email", gender: null, saved: false },
  "GET /v1/bots/first-run/words": WORDS,
  "GET /v1/bots/first-run/words?w=5196&s=1876": { words: 14, seconds: 4, typingSeconds: 21, totalWords: 5210, totalSeconds: 1880 },
  "GET /v1/bots/first-run/plans?client=phone": PHONE_PLANS,
  "GET /v1/bots/first-run/plans?client=desktop&market=IN": { ...PHONE_PLANS, plans: [{ id: "annual", label: "Elite", price: "₹5,999", per: "a year", default: true, buy: { kind: "iap.subscribe", productId: "tailzu_annu" } }] },
};

const build = (screenId: string, client: "phone" | "desktop", o: { params?: Record<string, string | number>; api?: Record<string, unknown>; calls?: Array<{ method: string; path: string }>; can?: string[] } = {}) =>
  buildBotsScreen({
    screenId, client, params: o.params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya", email: "aanya@example.in" },
    can: new Set(["BotsKit", ...(o.can ?? [])]), desk: { pages: false, notes: false },
  }, fakeDeps({ api: o.api ?? API, calls: o.calls }));
/** What a build that draws the onboarding's stage declares. */
const STAGE = ["OnboardStage", "BlipSpot"];
/** The kit's lint, less the two node types a stage build promises (the stage and Blip's spot). */
const lintStaged = (n: Node) => lintTree(n).filter((m) => m !== "type OnboardStage" && m !== "type BlipSpot" && m !== "type AuthPhase");
/** Blip's spots in a tree, by pose. */
const poses = (n: Node) => walk(n).filter((x) => x.type === "BlipSpot").map((x) => x.props?.pose);
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
/** Every action in a tree, nested ones included. */
function actions(n: unknown, out: ActionSpec[] = []): ActionSpec[] {
  if (Array.isArray(n)) { n.forEach((x) => actions(x, out)); return out; }
  if (!n || typeof n !== "object") return out;
  const o = n as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o as unknown as ActionSpec);
  for (const v of Object.values(o)) if (v && typeof v === "object") actions(v, out);
  return out;
}

describe("the first run's screens", () => {
  const ids = ["bots.welcome", "bots.sign-in", "bots.sign-code", "bots.language", "bots.name-it", "bots.keybot.on", "bots.first-words", "bots.plans"];
  it("each builds for the phone and the window, in the kit, with no sidebar or tab bar", async () => {
    for (const id of ids) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await build(id, client);
        expect(s.screenId).toBe(id);
        expect(s.look).toBe("bots");
        expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        // First run comes before the app's chrome: neither the tab bar nor the sidebar.
        expect(texts(s.root!)).not.toContain("Activity");
      }
    }
  });
  it("still draws when its reads fail", async () => {
    for (const id of ids) for (const client of ["phone", "desktop"] as const) {
      const s = await build(id, client, { api: {} });
      expect(lintTree(s.root!)).toEqual([]);
    }
  });
});

describe("About you and Name: the stage after sign-in", () => {
  const profileWrite = (x: ActionSpec) => x.kind === "callEndpoint" && (x as { path?: string }).path === "/v1/profile";
  it("About you: the name to start from and the card's three genders, saved with the card's own write, then Name", async () => {
    const s = await build("bots.name-it", "phone");
    expect(s.state).toMatchObject({ step: 0, fullName: "Aanya Rao", gender: "", name: "Zara" });
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["What's your name?", "Male", "Female", "Other", "Guessed from your email. Change it if it's wrong."]));
    const all = actions(s.root);
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "setState", path: "gender", value: "female" }),
      expect.objectContaining({
        kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { full_name: "$state.fullName", gender: "$state.gender" },
        onSuccess: expect.objectContaining({ kind: "sequence", actions: expect.arrayContaining([{ kind: "setState", path: "step", value: 1 }]) }),
      }),
    ]));
    // Both answers are needed, as on the card.
    expect(all).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "condition", if: { all: [{ truthy: "fullName" }, { truthy: "gender" }] } })]));
  });
  it("Name: the boss bot's name, saved as the assistant's name, and that finishes onboarding (on to Bots)", async () => {
    const s = await build("bots.name-it", "desktop");
    const save = actions(s.root).find((x) => x.kind === "callEndpoint" && (x as { path?: string }).path === "/v1/personality") as { body?: unknown; onSuccess?: unknown } | undefined;
    expect(save?.body).toEqual({ assistantName: "$state.name" });
    const done = actions(save!.onSuccess);
    expect(done).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { onboarded: true } }),
      { kind: "switchTab", tabId: "bots" },
    ]));
    expect(actions(s.root)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "setState", path: "name", value: "Jarvis" })]));
    // Nothing after it any more: no Turn on Keybot, no Plans in the run.
    expect(actions(s.root).some((x) => x.kind === "navigate")).toBe(false);
    // The two writes to the profile on this screen (each from its button and from its field's return): About you's,
    // and the end of onboarding.
    expect(new Set(actions(s.root).filter(profileWrite).map((x) => JSON.stringify((x as { body?: unknown }).body))))
      .toEqual(new Set(['{"full_name":"$state.fullName","gender":"$state.gender"}', '{"onboarded":true}']));
  });
  it("starts on Name for an account that already answered, and blank when nothing could be read", async () => {
    const answered = await build("bots.name-it", "phone", { api: { ...API, "GET /v1/bots/first-run/profile": { name: "Aanya Rao", via: "google", source: "saved", gender: "female", saved: true } } });
    expect(answered.state).toMatchObject({ step: 1, fullName: "Aanya Rao", gender: "female" });
    const blank = await build("bots.name-it", "phone", { api: {} });
    expect(blank.state).toMatchObject({ step: 0, fullName: "", gender: "", name: "X0" });
    expect(lintTree(blank.root!)).toEqual([]);
  });
  it("Name asks \"What will you call me?\", starts on X0, and keeps a name they saved before", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await build("bots.name-it", client, { api: {} });
      expect(texts(s.root!), client).toContain("What will you call me?");
      expect(s.state).toMatchObject({ name: "X0" });
      expect(JSON.stringify(s.root)).toContain('"placeholder":"X0"');
    }
    const named = await build("bots.name-it", "phone", { api: { ...API, "GET /v1/personality": { personality: { assistantName: "Zara" } } } });
    expect(named.state).toMatchObject({ name: "Zara" });
  });
  it("on a build that draws the stage: one stage, Blip presenting About you and cheering on Name", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await build("bots.name-it", client, { can: STAGE });
      expect(s.root).toMatchObject({ type: "OnboardStage", bind: { step: "step" }, props: { id: "bots.first", first: 2, of: 4, ground: "#ffffff" } });
      expect(s.root!.children?.map((c) => c.props?.stepId)).toEqual(["you", "name"]);
      expect(poses(s.root!)).toEqual(["present", "tada"]);
      expect(lintStaged(s.root!), client).toEqual([]);
    }
  });
});

describe("Language: a page from You now", () => {
  it("the person's own picks, chips that toggle (never to none), saved to the personality, then back", async () => {
    const s = await build("bots.language", "phone");
    expect(s.state?.langs).toEqual(["ta", "en"]);
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Which languages do you speak?", "Hinglish", "Tamil"]));
    expect(texts(s.root!).some((t) => / of 5$/.test(t))).toBe(false);
    expect(actions(s.root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "toggleInArray", path: "langs", value: "ta", min: 1 }),
      expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" }, onSuccess: expect.objectContaining({ kind: "sequence", actions: expect.arrayContaining([{ kind: "navigateBack" }]) }) }),
    ]));
  });
});

describe("Turn on Keybot, First words", () => {
  it("phone: the steps follow the phone's own keyboard reading, Settings opens per OS, and on to First words with the words so far", async () => {
    const s = await build("bots.keybot.on", "phone");
    expect(s.state).toMatchObject({ keyboardEnabled: false, keyboardReady: false });
    const json = JSON.stringify(s.root);
    expect(json).toContain('"truthy":"keyboardReady"');
    expect(json).toContain('"truthy":"keyboardEnabled"');
    expect(actions(s.root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "openUrl", url: "app-settings:" }),
      expect.objectContaining({ kind: "openSettings", target: "keyboard" }),
      expect.objectContaining({ kind: "navigate", screenId: "bots.first-words", params: { w: 5210, s: 1880 } }),
    ]));
    // Out of the run: Not now goes back to where it was opened from, never on to Plans.
    expect(JSON.stringify(s.root)).not.toContain('"screenId":"bots.plans"');
    expect(texts(s.root!)).toContain("Not now");
    expect(texts(s.root!).some((t) => / of 5$/.test(t))).toBe(false);
    // Continue never waits on Full Access alone: an iPhone reads it only after the keyboard has run, so there the keyboard
    // being switched on is enough.
    const cont = walk(s.root!).find((x) => x.visibleIf && texts(x).includes("Continue"))!;
    expect(cont.visibleIf).toEqual({ any: [{ truthy: "keyboardReady" }, { all: [{ not: { platform: "android" } }, { truthy: "keyboardEnabled" }] }] });
  });
  it("window: this computer's own Accessibility card when it has one", async () => {
    const plain = await build("bots.keybot.on", "desktop");
    expect(JSON.stringify(plain.root)).not.toContain("DeskAskSetup");
    const real = await buildBotsScreen({
      screenId: "bots.keybot.on", client: "desktop", tzOffsetMinutes: IST, user: { id: "u1" },
      can: new Set(["BotsKit", "DeskAskSetup"]), desk: { pages: true, notes: false },
    }, fakeDeps({ api: API }));
    expect(JSON.stringify(real.root)).toContain('"type":"DeskAskSetup"');
  });
  it("First words: counts only what was said since the step opened, from the account's own usage", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const s = await build("bots.first-words", "phone", { params: { w: 5196, s: 1876, said: "Kal 7 baje milte hain" }, calls });
    expect(calls.map((c) => c.path)).toContain("/v1/bots/first-run/words?w=5196&s=1876");
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["14 words", "in 4 seconds", "About 5× faster than typing it."]));
    expect(s.state?.said).toBe("Kal 7 baje milte hain");
    expect(actions(s.root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "navigate", screenId: "bots.first-words", replace: true, params: { w: 5196, s: 1876, said: "$state.said" } }),
    ]));
    // A phone that has the app's own hold-to-speak button: the clay key is it, and its words are counted at once.
    const phone = await buildBotsScreen({
      screenId: "bots.first-words", client: "phone", params: { w: 5196, s: 1876 }, tzOffsetMinutes: IST, user: { id: "u1" },
      can: new Set(["BotsKit", "VoiceButton"]), desk: { pages: false, notes: false },
    }, fakeDeps({ api: API }));
    const mic = walk(phone.root!).find((n) => n.type === "VoiceButton");
    expect(mic).toMatchObject({ bind: { value: "said" }, props: { hold: true }, on: { onChange: { kind: "navigate", screenId: "bots.first-words", replace: true } } });
    const quiet = await build("bots.first-words", "desktop");
    expect(texts(quiet.root!).some((t) => /^\d[\d,]* words?$/.test(t))).toBe(false);
    // Done goes back (to Bots, or Keybot), not on to Plans.
    expect(texts(quiet.root!)).toContain("Done");
    expect(JSON.stringify(quiet.root)).not.toContain('"screenId":"bots.plans"');
  });
  it("spokenSince and the typing estimate", () => {
    expect(spokenSince({ words: 120, audioSeconds: 40 }, { w: 100, s: 32 })).toEqual({ words: 20, seconds: 8, typingSeconds: 30, totalWords: 120, totalSeconds: 40 });
    expect(spokenSince({ words: 120, audioSeconds: 40 }, {})).toMatchObject({ words: 0, seconds: 0 });
    // The owner's limits, from the config the meter enforces: Free $3 a month, Lite $35 (35 / 3 → 11×), Elite $450 (450 / 3 → 150×).
    expect(planLine("lite")).toBe("11× more every month, for all your bots");
    expect(planLine("elite")).toBe("150× more every month, for all your bots");
    const cfg = { USAGE_FREE_MONTH_USD: 3, USAGE_LITE_STRETCHES_USD: [4, 8, 6, 10, 7], USAGE_ELITE_STRETCHES_USD: [50, 70, 80, 100, 150] };
    expect(planLine("monthly", cfg)).toBe("11× more every month, for all your bots");
    expect(planLine("elite", { ...cfg, USAGE_ELITE_STRETCHES_USD: [6, 6, 6, 6, 6] })).toBe("10× more every month, for all your bots");
    expect(planLine("lite", { ...cfg, USAGE_FREE_MONTH_USD: 30 })).toBe("More every month, for all your bots");
    for (const tier of ["lite", "elite"]) expect(planLine(tier)).not.toMatch(/₹|\$|paise|dollar/);
    expect(trialDaysOf("7 days free, then billed yearly")).toBe(7);
    expect(trialDaysOf("Billed monthly")).toBeUndefined();
  });
});

describe("Plans: a page from You and Billing now", () => {
  const finishes = (a: ActionSpec[]) => a.some((x) => x.kind === "callEndpoint" && (x as { path?: string }).path === "/v1/profile");
  it("phone: the paywall's plans, bought as the paywall buys them; buying or Not now goes back, and onboarding is not touched", async () => {
    const s = await build("bots.plans", "phone");
    expect(s.state?.plan).toBe("annual");
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Elite", "$59.99", "Lite", "Start free week", "Not now", "100× more every month, for all your bots", "10× more every month, for all your bots"]));
    // Minimal and the same for every bot: no Free card, no bot-specific lines, no feature list.
    for (const gone of ["Stay on Free", "Keybot, 2,000 words a month", "Keybot without a word limit", "Unlimited voice-to-text refinement"]) expect(texts(s.root!)).not.toContain(gone);
    const all = actions(s.root);
    const buy = all.find((x) => x.kind === "iap.showPaywall" && (x as { packageId?: string }).packageId === "$rc_annual") as { onSuccess?: unknown } | undefined;
    expect(buy).toBeDefined();
    expect(actions(buy!.onSuccess)).toEqual(expect.arrayContaining([{ kind: "navigateBack" }]));
    expect(finishes(all)).toBe(false);
    expect(texts(s.root!).some((t) => /Step \d of/.test(t) || / of 5$/.test(t))).toBe(false);
  });
  it("window: the pay page (iap.subscribe) at Razorpay's prices", async () => {
    const s = await build("bots.plans", "desktop");
    expect(texts(s.root!)).toContain("₹5,999");
    expect(actions(s.root)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "iap.subscribe", productId: "tailzu_annu" })]));
  });
  it("nothing to sell (free for all, or already paying): say so, and back", async () => {
    const free = await build("bots.plans", "phone", { api: { "GET /v1/bots/first-run/plans?client=phone": { ...PHONE_PLANS, freeForAll: true, plans: [] } } });
    expect(texts(free.root!)).toContain("X0 Bot is free for everyone right now. Nothing to pick, nothing to pay.");
    expect(actions(free.root).some((x) => x.kind.startsWith("iap."))).toBe(false);
    expect(finishes(actions(free.root))).toBe(false);
    expect(actions(free.root)).toEqual(expect.arrayContaining([{ kind: "navigateBack" }]));
  });
});

describe("the gate: Welcome, Sign in, Code on the sign-in the app already runs", () => {
  const opts = { terms: "https://x0bot.com/terms", privacy: "https://x0bot.com/privacy" };
  it("a stage both gates step through, with the gate's own controls, and Blip's spots: wave, listen, wait, think", () => {
    for (const desktop of [false, true]) {
      const t = botsAuthTree({ ...opts, desktop }) as unknown as Node;
      expect(t.type).toBe("OnboardStage");
      expect(t.props).toMatchObject({ id: "bots.auth", first: 0, of: 4, phaseStep: { verify: 1, verifying: 1 }, ground: "#ffffff", blip: { dot: "#F3E2C6" } });
      // One Blip, walked from spot to spot by the app; the gate's Sign in step and the screen after sign-in share the look.
      // (The phone's Sign in has one spot by each way in, phone or email; one shows.)
      expect(poses(t)).toEqual(desktop ? ["wave", "listen", "wait", "think"] : ["wave", "listen", "listen", "wait", "think"]);
      expect(walk(t).filter((n) => n.type === "AuthPhase").map((n) => n.props?.phases)).toEqual([["verify"], ["verifying"]]);
      // No picture of him (an animated loop) anywhere: the one Blip is the app's.
      expect(walk(t).some((n) => n.type === "Image" && JSON.stringify(n.props).includes(".webp"))).toBe(false);
      const types = walk(t).map((n) => n.type);
      expect(types).toEqual(expect.arrayContaining(["SwipePill", "GoogleSignIn", "AppleSignIn", "CodeEntry"]));
      const pills = walk(t).filter((n) => n.type === "SwipePill").map((n) => n.props?.method);
      expect(pills.sort()).toEqual(["email", "phone"]);
      expect(texts(t)).toEqual(expect.arrayContaining(["Hi, I'm X0.", "Your phone number", "Enter the code"]));
      // Start shows Sign in; Back returns to Welcome.
      expect(actions(t)).toEqual(expect.arrayContaining([{ kind: "setState", path: "signing", value: true }, { kind: "setState", path: "signing", value: false }]));
    }
  });
  it("leaves out what the build cannot serve", () => {
    const t = botsAuthTree({ ...opts, googleHidden: true, appleHidden: true }) as unknown as Node;
    const types = walk(t).map((n) => n.type);
    expect(types).not.toContain("GoogleSignIn");
    expect(types).not.toContain("AppleSignIn");
    const bridged = botsAuthTree({ ...opts, googleHidden: true, googleLink: "https://x.supabase.co/auth/v1/authorize?provider=google" }) as unknown as Node;
    expect(actions(bridged)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "openUrl", url: "https://x.supabase.co/auth/v1/authorize?provider=google" })]));
  });
  it("the bootstrap: the Bots app's sign-in and first run when it is on, today's when it is off", () => {
    const on = buildBootstrap({ botsApp: true, onboarded: false, onboardV2: true });
    expect((on.flags?.["auth.screen"] as { props?: { id?: string } }).props?.id).toBe("bots.auth");
    expect(on.flags?.["auth.sdui"]).toBe(true);
    expect(on.initialScreenId).toBe("bots.name-it");
    expect(BOTS_FIRST_RUN_IDS).toEqual(["bots.name-it"]);
    expect(on.flags?.["boot.firstRunGateIds"]).toEqual(expect.arrayContaining(BOTS_FIRST_RUN_IDS));
    expect(buildBootstrap({ botsApp: true, onboarded: true }).initialScreenId).toBe("bots.home");
    expect(buildBootstrap({ botsApp: true, onboarded: false, isReviewer: true }).initialScreenId).not.toBe("bots.name-it");
    const off = buildBootstrap({ onboarded: false, onboardV2: true });
    expect((off.flags?.["auth.screen"] as { props?: { id?: string } }).props?.id).not.toBe("bots.auth");
    expect(off.initialScreenId).toBe("onboard");
  });
});

describe("the sign-in steps as pages", () => {
  it("each on a stage of its own where the build draws one, so Blip walks on between them; pictures of him otherwise", async () => {
    for (const [id, pose] of [["bots.welcome", "wave"], ["bots.sign-in", "listen"], ["bots.sign-code", "think"]] as const) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await build(id, client, { can: STAGE });
        expect(s.root).toMatchObject({ type: "OnboardStage", props: { id, ground: "#ffffff" } });
        expect(poses(s.root!)).toContain(pose);
        expect(lintStaged(s.root!), `${id} ${client}`).toEqual([]);
        const plain = await build(id, client);
        expect(walk(plain.root!).some((n) => n.type === "BlipSpot" || n.type === "OnboardStage")).toBe(false);
      }
    }
    // Code's Continue leads on to About you.
    expect(actions((await build("bots.sign-code", "phone")).root)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "navigate", screenId: "bots.name-it" })]));
  });
});

describe("after onboarding: one card for the microphone and the keyboard", () => {
  const cardOf = (n: Node) => walk(n).find((x) => x.type === "BotCard");
  const stepOf = (n: Node, title: string) => walk(n).find((x) => x.type === "Stack" && x.visibleIf && texts(x).includes(title));
  const MOTION = ["BotsMotion"];
  const ARRIVE = { ...API, "GET /v1/shell/started": { started: true }, "GET /v1/bots/first-run/arrival": { due: true } };
  const BOT_COLOURS = /#4F7A3A|#A9573A|#8F6A1F|#3E6E8E/i;

  it("the first arrival on a phone: one card over Home, the microphone asked for real, then the keyboard, then it closes", async () => {
    for (const started of [true, false]) {
      // The full Home and the empty one (nothing of their own yet) both carry it.
      const s = await build("bots.home", "phone", { api: { ...ARRIVE, "GET /v1/shell/started": { started } }, can: MOTION });
      // Unknown until the app's own readings arrive: the card decides only then.
      expect(s.state).toMatchObject({ micGranted: null, keyboardEnabled: null, keyboardReady: null, micAsked: false, permitClosed: false });
      const card = cardOf(s.root!)!;
      // It comes in after the bot's hello has played on its own (helloSeen), over Home. It decides once the microphone and the
      // keyboard are known; Full Access only where it can be read (an iPhone reads it only after the keyboard has run).
      expect(card.props).toMatchObject({
        overlay: true, closeWhen: { truthy: "permitClosed" },
        readyWhen: { all: [{ all: [{ neq: ["micGranted", null] }, { neq: ["keyboardEnabled", null] }, { any: [{ neq: ["keyboardReady", null] }, { platform: "ios" }] }] }, { truthy: "helloSeen" }] },
      });
      expect(s.state).toMatchObject({ helloSeen: false });
      // The first visit: only the waving bot and his line, which sets helloSeen after a few seconds; the rest of Home, and the
      // ask bar, only once the card is closed.
      const nodes = walk(s.root!);
      const helloNode = nodes.find((x) => x.on?.onAppear && JSON.stringify(x.on.onAppear).includes("helloSeen"))!;
      expect(helloNode.visibleIf).toEqual({ falsy: "helloGone" });
      expect(JSON.stringify(helloNode.on?.onAppear)).toMatch(/"kind":"delay","ms":3\d{3}/);
      // Waved (helloSeen): he walks off as the card comes in (a build without BlipWalkOut slides him off, MorphOut), then
      // helloGone; Home rises in once he is gone, never waiting on the card (it is an overlay over Home).
      expect(walk(helloNode).find((x) => x.type === "MorphOut")?.bind).toEqual({ active: "helloSeen" });
      expect(nodes.some((x) => x.visibleIf && JSON.stringify(x.visibleIf) === '{"truthy":"helloSeen"}' && JSON.stringify(x.on?.onAppear).includes("helloGone"))).toBe(true);
      const home = { truthy: "helloGone" };
      expect(nodes.filter((x) => x.type === "Rise" && JSON.stringify(x.visibleIf) === JSON.stringify(home)).length).toBeGreaterThan(2);
      // A build that draws him walking gets that instead.
      const walker = await build("bots.home", "phone", { api: { ...ARRIVE, "GET /v1/shell/started": { started } }, can: [...MOTION, "BlipWalkOut"] });
      expect(walk(walker.root!).find((x) => x.type === "BlipWalkOut")?.props).toMatchObject({ goWhen: "helloSeen" });
      expect(walk(walker.root!).some((x) => x.type === "MorphOut")).toBe(false);
      expect(lintTree(walker.root!)).toEqual([]);
      // Monochrome: white, ink and Geist; the bot in a neutral grey.
      expect(JSON.stringify(card)).not.toMatch(BOT_COLOURS);
      expect(card.props?.color).toBe("#3d3d3d");
      // Step 1: the microphone, for a better experience; allowed or not, on to step 2.
      const mic = stepOf(card, "Let X0 Bot hear you")!;
      expect(mic.visibleIf).toEqual({ all: [{ falsy: "micGranted" }, { falsy: "micAsked" }] });
      const ask = actions(mic).find((x) => x.kind === "requestPermission") as { permission?: string; onGranted?: unknown; onDenied?: unknown; onBlocked?: unknown };
      expect(ask.permission).toBe("microphone");
      expect(actions(ask.onGranted)).toEqual(expect.arrayContaining([{ kind: "setState", path: "micGranted", value: true }, { kind: "setState", path: "micAsked", value: true }]));
      expect(actions(ask.onDenied)).toEqual([{ kind: "setState", path: "micAsked", value: true }]);
      expect(actions(ask.onBlocked)).toEqual([{ kind: "setState", path: "micAsked", value: true }]);
      // Step 2: the keyboard, straight to its settings.
      const keys = stepOf(card, "Add the X0 Bot keyboard")!;
      // An iPhone can't read Full Access until the keyboard has run, so there the keyboard switched on is enough.
      const KEYS_ON = { all: [{ truthy: "keyboardEnabled" }, { any: [{ truthy: "keyboardReady" }, { platform: "ios" }] }] };
      expect(keys.visibleIf).toEqual({ all: [{ any: [{ truthy: "micGranted" }, { truthy: "micAsked" }] }, { not: KEYS_ON }] });
      expect(actions(keys)).toEqual(expect.arrayContaining([{ kind: "openSettings", target: "keyboard" }]));
      // Both done: the words give way to "X0 got you!" while the bot cheers, then it closes and the server is told; "Not now" does the same, for good.
      expect(card.props?.doneWhen).toEqual({ all: [{ any: [{ truthy: "micGranted" }, { truthy: "micAsked" }] }, KEYS_ON] });
      expect(stepOf(card, "X0 got you!")?.visibleIf).toEqual(card.props?.doneWhen);
      expect(card.props?.doneDelayMs).toBeGreaterThanOrEqual(2000);
      const closes = [{ kind: "setState", path: "permitClosed", value: true }, expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/bots/first-run/arrival" })];
      expect(actions(card.on?.onComplete)).toEqual(expect.arrayContaining(closes));
      const notNow = walk(mic).find((x) => x.on?.onPress && texts(x).includes("Not now"));
      expect(actions(notNow?.on?.onPress)).toEqual(expect.arrayContaining(closes));
      expect(lintTree(s.root!)).toEqual([]);
      // The old cards are gone from Home.
      expect(texts(s.root!)).not.toContain("Turn on full access");
    }
    // Answered before: no card, and Home's state carries nothing for it.
    const later = await build("bots.home", "phone", { api: { ...ARRIVE, "GET /v1/bots/first-run/arrival": { due: false } }, can: MOTION });
    expect(cardOf(later.root!)).toBeUndefined();
    expect(later.state).not.toHaveProperty("permitClosed");
    expect(texts(later.root!)).not.toContain("Let X0 Bot hear you");
    // A build without the living tiles: the same steps in a plain card at the top, gone once answered or done.
    const plain = await build("bots.home", "phone", { api: ARRIVE });
    expect(cardOf(plain.root!)).toBeUndefined();
    expect(texts(plain.root!)).toContain("Let X0 Bot hear you");
    expect(lintTree(plain.root!)).toEqual([]);
  });

  it("Keybot on a phone: the same card in the page, only for what is missing; nothing once it is all on", async () => {
    const s = await build("bots.keybot", "phone", { can: MOTION });
    // Declared on, so the card never flashes: the app's own readings bring it in.
    expect(s.state).toMatchObject({ keyboardEnabled: true, keyboardReady: true, micGranted: true, micAsked: false });
    const card = cardOf(s.root!)!;
    expect(card.props?.overlay).toBeUndefined();
    // It comes in when the app says something is missing, and once it is all on the bot cheers on "X0 got you!" and it goes.
    const missing = { any: [{ falsy: "micGranted" }, { not: { all: [{ truthy: "keyboardEnabled" }, { any: [{ truthy: "keyboardReady" }, { platform: "ios" }] }] } }] };
    expect(card.props).toMatchObject({ readyWhen: missing, doneWhen: { not: missing }, closeWhen: { truthy: "keybotSet" } });
    expect(actions(card.on?.onComplete)).toEqual([{ kind: "setState", path: "keybotSet", value: true }]);
    expect(stepOf(card, "X0 got you!")?.visibleIf).toEqual({ not: missing });
    expect(JSON.stringify(card)).not.toMatch(BOT_COLOURS);
    const mic = stepOf(card, "Let Keybot hear you")!;
    const ask = actions(mic).find((x) => x.kind === "requestPermission") as { onGranted?: unknown; onBlocked?: unknown };
    expect(actions(ask.onGranted)).toEqual(expect.arrayContaining([{ kind: "setState", path: "micGranted", value: true }, expect.objectContaining({ kind: "navigate", screenId: "bots.first-words" })]));
    expect(actions(ask.onBlocked)).toEqual(expect.arrayContaining([{ kind: "openSettings", target: "app" }]));
    const keys = stepOf(card, "Turn on full access")!;
    expect(actions(keys)).toEqual(expect.arrayContaining([{ kind: "openSettings", target: "keyboard" }, expect.objectContaining({ kind: "navigate", screenId: "bots.keybot.on" })]));
    expect(lintTree(s.root!)).toEqual([]);
  });

  it("in a window: the microphone and Accessibility, only where the window declares them", async () => {
    const none = await build("bots.home", "desktop", { api: ARRIVE, can: MOTION });
    expect(cardOf(none.root!)).toBeUndefined();
    expect(JSON.stringify(none.root)).not.toContain("DeskAskSetup");
    const real = await build("bots.home", "desktop", { api: ARRIVE, can: [...MOTION, "DeskAskSetup", "DeskMicAsk"] });
    const card = cardOf(real.root!)!;
    expect(card.props).toMatchObject({ overlay: true, readyWhen: { neq: ["micGranted", null] } });
    expect(stepOf(card, "Let X0 Bot hear you")).toBeDefined();
    expect(walk(stepOf(card, "Let Keybot type for you")!).find((n) => n.type === "DeskAskSetup")?.props).toMatchObject({ rows: [{ key: "read" }] });
    const keybot = await build("bots.keybot", "desktop", { can: [...MOTION, "DeskAskSetup", "DeskMicAsk"] });
    expect(cardOf(keybot.root!)?.visibleIf).toEqual({ falsy: "micGranted" });
    expect(walk(keybot.root!).find((n) => n.type === "DeskAskSetup")?.props).toMatchObject({ place: "home" });
  });
});

describe("the name to start from", () => {
  it("from an email: split on . _ - and digits, number-only parts dropped, title-cased", () => {
    expect(nameFromEmail("aanya.rao92@gmail.com")).toBe("Aanya Rao");
    expect(nameFromEmail("first_last-name@x.in")).toBe("First Last Name");
    expect(nameFromEmail("PRIYA.SHARMA@x.in")).toBe("Priya Sharma");
    expect(nameFromEmail("vikram+news@x.in")).toBe("Vikram");
    expect(nameFromEmail("rahul..k__2001--x@x.in")).toBe("Rahul");
    // Nothing that is a name: initials, lone letters, numbers.
    expect(nameFromEmail("rk2001@x.in")).toBe("");
    expect(nameFromEmail("a.b@x.in")).toBe("");
    expect(nameFromEmail("12345@x.in")).toBe("");
    expect(nameFromEmail("@x.in")).toBe("");
    expect(nameFromEmail("no-at-sign")).toBe("");
    expect(nameFromEmail(undefined)).toBe("");
  });
  it("by how they signed in: Google or Apple's own name, the email's guess, nothing for a phone", () => {
    expect(startingName({ provider: "google", providerName: "Aanya Rao", email: "zz@x.in" })).toEqual({ name: "Aanya Rao", source: "provider" });
    expect(startingName({ provider: "apple", providerName: " Kabir Mehta ", email: "x@privaterelay.appleid.com" })).toEqual({ name: "Kabir Mehta", source: "provider" });
    // Apple without a name (every sign-in after the first) and a hidden address: nothing, never a guess from random letters.
    expect(startingName({ provider: "apple", email: "q7fe2kdi4u@privaterelay.appleid.com" })).toEqual({ name: "", source: null });
    // Google without a name: the email's guess.
    expect(startingName({ provider: "google", email: "aanya.rao92@gmail.com" })).toEqual({ name: "Aanya Rao", source: "email" });
    expect(startingName({ provider: "email", email: "aanya.rao92@gmail.com", providerName: "ignored" })).toEqual({ name: "Aanya Rao", source: "email" });
    expect(startingName({ provider: "phone", phone: "+919800000000" })).toEqual({ name: "", source: null });
    expect(startingName({ provider: "phone", phone: "+919800000000" }, "Aanya")).toEqual({ name: "Aanya", source: "saved" });
    expect(signedInVia({ email: "a@x.in" })).toBe("email");
    expect(signedInVia({ phone: "+91" })).toBe("phone");
    expect(signedInVia({})).toBe("other");
  });
});

describe("the routes", () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/server.js");
    server = await buildApp();
    await server.ready();
  });
  afterAll(async () => { await server?.close(); });
  const auth = { authorization: "Bearer test-static-token-0123456789" };
  it("the profile step's starting name: a static token has no sign-in to read, so nothing is suggested", async () => {
    const me = await server.inject({ method: "GET", url: "/v1/bots/first-run/profile", headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ name: "", via: "other", saved: false });
    expect((await server.inject({ method: "GET", url: "/v1/bots/first-run/profile" })).statusCode).toBe(401);
  });
  it("the first-arrival card: due until it is answered or put off, then never again", async () => {
    expect((await server.inject({ method: "GET", url: "/v1/bots/first-run/arrival" })).statusCode).toBe(401);
    const first = await server.inject({ method: "GET", url: "/v1/bots/first-run/arrival", headers: auth });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ due: true, kind: "first" });
    const done = await server.inject({ method: "PUT", url: "/v1/bots/first-run/arrival", headers: auth, payload: {} });
    expect(done.statusCode).toBe(200);
    const get = async () => (await server.inject({ method: "GET", url: "/v1/bots/first-run/arrival", headers: auth })).json();
    expect(await get()).toEqual({ due: false });
    expect((await server.inject({ method: "PUT", url: "/v1/bots/first-run/arrival", headers: auth, payload: {} })).statusCode).toBe(200);
    // Coming back the next day: no welcome. After two weeks away: welcomed back, and it stays due through the visit
    // (a screen that refreshes mid-welcome keeps it) until the PUT once it has played.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    try {
      vi.setSystemTime(Date.now() + 86_400_000);
      expect(await get()).toEqual({ due: false });
      vi.setSystemTime(Date.now() + 15 * 86_400_000);
      expect(await get()).toEqual({ due: true, kind: "back" });
      expect(await get()).toEqual({ due: true, kind: "back" });
      await server.inject({ method: "PUT", url: "/v1/bots/first-run/arrival", headers: auth, payload: {} });
      expect(await get()).toEqual({ due: false });
    } finally {
      vi.useRealTimers();
    }
  });
  it("languages, words and plans, signed in only", async () => {
    const langs = await server.inject({ method: "GET", url: "/v1/bots/first-run/languages", headers: auth });
    expect(langs.statusCode).toBe(200);
    expect(langs.json().options.slice(0, 3).map((l: { value: string }) => l.value)).toEqual(["hinglish", "hi", "en"]);
    const words = await server.inject({ method: "GET", url: "/v1/bots/first-run/words?w=0&s=0", headers: auth });
    expect(words.statusCode).toBe(200);
    expect(words.json()).toHaveProperty("typingSeconds");
    const plans = await server.inject({ method: "GET", url: "/v1/bots/first-run/plans?client=phone", headers: auth });
    expect(plans.statusCode).toBe(200);
    expect(plans.json()).toHaveProperty("freeWords");
    expect((await server.inject({ method: "GET", url: "/v1/bots/first-run/plans" })).statusCode).toBe(401);
  });
});

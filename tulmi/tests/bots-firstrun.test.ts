import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

// The Bots app's first run (screens/firstRun.ts, routes/bots/botsFirstRun.ts): Welcome, Sign in and Code in the gate's
// tree, then Name on a stage of its own, with one Blip walking on to it; Language, Turn on Keylessbord, First words and
// Plans are pages reached from the app, and Bots and Keylessbord carry the keyboard and microphone cards. The person's name
// and gender are never asked in the run: the About you card asks them on Home, after a few visits.
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

const { buildBootstrap } = await import("../src/experience/bootstrap/bootstrap.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { botsAuthTree } = await import("../src/experience/bots/screens/firstRun.js");
const { nameFromEmail, planLine, signedInVia, spokenSince, startingName, trialDaysOf } = await import("../src/routes/bots/botsFirstRun.js");

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

describe("after sign-in: straight to Home, nothing asked (App Review 4)", () => {
  const profileWrite = (x: ActionSpec) => x.kind === "callEndpoint" && (x as { path?: string }).path === "/v1/profile";
  it("bots.name-it is only a hand-off: no words, no field, and on appearing it marks them onboarded and goes to Home", async () => {
    for (const client of ["phone", "desktop"] as const) {
      for (const can of [undefined, STAGE]) {
        const s = await build("bots.name-it", client, can ? { can } : {});
        expect(texts(s.root!), client).toEqual([]);
        expect(JSON.stringify(s.root), client).not.toContain('"type":"TextField"');
        const appear = (s.root as { on?: { onAppear?: ActionSpec } }).on?.onAppear;
        expect(appear && profileWrite(appear), client).toBe(true);
        expect((appear as { body?: unknown }).body).toEqual({ onboarded: true });
        // Home either way: a failed write is made again by the next boot (appScreens.ts).
        for (const then of [appear!.onSuccess, appear!.onError]) expect(actions(then as never)).toEqual([{ kind: "switchTab", tabId: "bots" }]);
        expect(actions(s.root).some((x) => x.kind === "callEndpoint" && (x as { path?: string }).path === "/v1/personality"), client).toBe(false);
        expect(lintTree(s.root!)).toEqual([]);
      }
    }
  });
});

describe("About you: a card on Home after a few visits, never in the first run", () => {
  const about = (o: Record<string, unknown>) => ({ ...API, "GET /v1/bots/first-run/about": { due: true, name: "Aanya Rao", via: "google", source: "provider", gender: null, ...o } });
  it("the card: the name filled in from the sign-in, the three genders, Save writes the profile; no way to skip it", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await build("bots.home", client, { api: about({}) });
      expect(texts(s.root!), client).toEqual(expect.arrayContaining(["Tell your bots about you", "Male", "Female", "Other", "So your bots know how to address you.", "Save"]));
      expect(texts(s.root!), client).not.toContain("Not now");
      expect(JSON.stringify(s.root)).toContain('"placeholder":"Your name"');
      expect(s.state).toMatchObject({ aboutName: "Aanya Rao", aboutGender: "", aboutSaved: false, aboutClosed: false, aboutBotName: "", aboutBotDone: false });
      const all = actions(s.root);
      expect(all).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "setState", path: "aboutGender", value: "female" }),
        expect.objectContaining({
          kind: "condition", if: { all: [{ truthy: "aboutName" }, { truthy: "aboutGender" }] }, else: expect.objectContaining({ kind: "toast", message: "Add your name and pick one." }),
        }),
        expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { full_name: "$state.aboutName", gender: "$state.aboutGender" } }),
      ]));
      expect(all.some((x) => (x as { path?: string }).path === "/v1/bots/first-run/about"), client).toBe(false);
      expect(lintTree(s.root!), client).toEqual([]);
    }
  });
  it("signed in with Apple: the name Apple gave, filled in and editable, never required (App Review 4); no field when Apple gave none", async () => {
    // Apple gave a name: the field is there, filled with it, and Save needs only the gender (the name goes with it when it is kept).
    const given = await build("bots.home", "phone", { api: about({ name: "Aanya Rao", via: "apple", source: "provider" }) });
    expect(JSON.stringify(given.root)).toContain('"id":"aboutName"');
    expect(given.state).toMatchObject({ aboutName: "Aanya Rao" });
    const save = actions(given.root).find((x) => x.kind === "condition" && JSON.stringify((x as { if?: unknown }).if) === '{"truthy":"aboutGender"}') as { then?: unknown; else?: unknown } | undefined;
    expect(save?.else).toMatchObject({ kind: "toast", message: "Pick one to save." });
    expect(save?.then).toMatchObject({
      kind: "condition", if: { truthy: "aboutName" },
      then: { kind: "callEndpoint", path: "/v1/profile", body: { full_name: "$state.aboutName", gender: "$state.aboutGender" } },
      else: { kind: "callEndpoint", path: "/v1/profile", body: { gender: "$state.aboutGender" } },
    });
    // Apple gave none (or only a guess from a relay address could be made): no name field at all, and the gender alone is saved.
    for (const [name, source] of [["", null], ["Aanya", "email"]] as const) {
      const s = await build("bots.home", "phone", { api: about({ name, via: "apple", source }) });
      // Home has its own fields (the ask bar): the card's name field is the one that must not be there.
      expect(JSON.stringify(s.root)).not.toContain('"id":"aboutName"');
      expect(JSON.stringify(s.root)).not.toContain("Your name");
      const only = actions(s.root).find((x) => x.kind === "condition" && JSON.stringify((x as { if?: unknown }).if) === '{"truthy":"aboutGender"}') as { then?: { body?: unknown } } | undefined;
      expect(only?.then?.body).toEqual({ gender: "$state.aboutGender" });
    }
  });
  it("then a name for the assistant, the card's second step: filled with the one it has, a name needed, and the card goes after", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await build("bots.home", client, { api: about({ botName: "Zara" }) });
      expect(texts(s.root!), client).toEqual(expect.arrayContaining(["Give X0 a name of its own", "Save name"]));
      expect(texts(s.root!), client).not.toContain("Keep X0");
      expect(JSON.stringify(s.root)).toContain('"placeholder":"A name for X0"');
      expect(s.state).toMatchObject({ aboutBotName: "Zara", aboutBotDone: false });
      // Shown once the first step is saved, until it is answered.
      const step = walk(s.root!).find((n) => JSON.stringify(n.visibleIf ?? null).includes("aboutSaved") && texts(n).includes("Give X0 a name of its own"))!;
      expect(step.visibleIf).toEqual({ all: [{ truthy: "aboutSaved" }, { falsy: "aboutBotDone" }] });
      const all = actions(s.root);
      expect(all).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { assistantName: "$state.aboutBotName" } }),
        expect.objectContaining({ kind: "toast", message: "Type a name for X0." }),
      ]));
      // Only a saved name closes the step: its one way on is the write's success.
      const write = all.find((x) => (x as { path?: string }).path === "/v1/personality") as { onSuccess?: unknown } | undefined;
      expect(JSON.stringify(write?.onSuccess)).toContain('"path":"aboutBotDone"');
      // Never worded as a question about the person: no "What will you call me?", no "your name" in this step.
      expect(texts(step)).not.toContain("What will you call me?");
      expect(lintTree(s.root!), client).toEqual([]);
    }
  });
  it("comes back on the step still owed: name and gender saved, it opens on the assistant's name", async () => {
    const s = await build("bots.home", "phone", { api: about({ name: "Aanya Rao", source: "saved", gender: "female" }) });
    expect(s.state).toMatchObject({ aboutSaved: true, aboutBotDone: false });
    // Signed in with Apple, the gender alone is their part.
    expect((await build("bots.home", "phone", { api: about({ name: "", source: null, via: "apple", gender: "male" }) })).state).toMatchObject({ aboutSaved: true });
    expect((await build("bots.home", "phone", { api: about({ name: "Aanya", source: "email", gender: null }) })).state).toMatchObject({ aboutSaved: false });
  });
  it("not due: no card; and one ask at a time, so not while the first-arrival card is due", async () => {
    const none = await build("bots.home", "phone", { api: about({ due: false }) });
    expect(texts(none.root!)).not.toContain("Tell your bots about you");
    const arriving = await build("bots.home", "phone", { api: { ...about({}), "GET /v1/bots/first-run/arrival": { due: true, kind: "first" } } });
    expect(texts(arriving.root!)).not.toContain("Tell your bots about you");
  });
});

describe("App Review: a bought plan can be restored", () => {
  it("offers Restore Purchases on the phone's Plans, which restores and reads the screen again", async () => {
    const s = await build("bots.plans", "phone");
    expect(texts(s.root!)).toContain("Restore Purchases");
    expect(actions(s.root)).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "iap.restore", onSuccess: expect.objectContaining({ kind: "sequence", actions: expect.arrayContaining([{ kind: "refresh" }]) }),
    })]));
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

describe("Turn on Keylessbord, First words", () => {
  it("phone: the steps follow the phone's own keyboard reading, Settings opens per OS, and on to First words with the words so far", async () => {
    const s = await build("bots.keybot.on", "phone");
    expect(s.state).toMatchObject({ keyboardEnabled: false, keyboardReady: false });
    const json = JSON.stringify(s.root);
    expect(json).toContain('"truthy":"keyboardReady"');
    expect(json).toContain('"truthy":"keyboardEnabled"');
    expect(actions(s.root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "openUrl", url: "app-settings:" }),
      expect.objectContaining({ kind: "openSettings", target: "keyboard" }),
      // In place of this page, so First words' Done leaves the setup rather than coming back into it.
      expect.objectContaining({ kind: "navigate", screenId: "bots.first-words", params: { w: 5210, s: 1880 }, replace: true }),
    ]));
    // Out of the run: Not now goes back to where it was opened from, never on to Plans.
    expect(JSON.stringify(s.root)).not.toContain('"screenId":"bots.plans"');
    expect(texts(s.root!)).toContain("Not now");
    expect(texts(s.root!).some((t) => / of 5$/.test(t))).toBe(false);
    // The phone's mic key is tapped, not held.
    expect(texts(s.root!).some((t) => /\bhold\b/i.test(t))).toBe(false);
    expect(texts(s.root!)).toContain("It only takes your words after you tap its mic key.");
    // One button, Continue: it opens Settings until the phone says Keylessbord is on, then goes on to First words. That never
    // waits on Full Access alone: an iPhone reads it only after the keyboard has run, so there the keyboard being
    // switched on is enough.
    const conts = walk(s.root!).filter((x) => x.visibleIf && x.type !== "Text" && texts(x).join("") === "Continue");
    const goes = conts.find((x) => JSON.stringify(x).includes('"screenId":"bots.first-words"'))!;
    expect(goes.visibleIf).toEqual({ any: [{ truthy: "keyboardReady" }, { all: [{ not: { platform: "android" } }, { truthy: "keyboardEnabled" }] }] });
    expect(conts.filter((x) => JSON.stringify(x).includes("app-settings:") || JSON.stringify(x).includes('"target":"keyboard"'))).toHaveLength(2);
  });
  it("its ways out work wherever it was opened from: back to the page in the app, or Home when a link opened it", async () => {
    // A link (the keyboard's "Tap to set it up", a widget) makes it the app's only page: back would have nowhere to go.
    const linked = await build("bots.keybot.on", "phone");
    const outs = (r: Node) => walk(r)
      .filter((x) => x.on?.onPress && (texts(x).join("") === "Not now" || x.props?.accessibilityLabel === "Back"))
      .map((x) => x.on!.onPress);
    expect(outs(linked.root!)).toEqual([{ kind: "navigate", screenId: "bots.home", replace: true }, { kind: "navigate", screenId: "bots.home", replace: true }]);
    const inApp = await build("bots.keybot.on", "phone", { params: { from: "app" } });
    expect(outs(inApp.root!)).toEqual([{ kind: "navigateBack" }, { kind: "navigateBack" }]);
    expect(actions(inApp.root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "navigate", screenId: "bots.first-words", params: { w: 5210, s: 1880, from: "app" }, replace: true }),
    ]));
    // First words is the same: Done never lands back on Turn on Keylessbord.
    const words = await build("bots.first-words", "phone");
    const done = walk(words.root!).find((x) => x.on?.onPress && texts(x).join("") === "Done")!;
    expect(actions(done)[0]).toEqual({ kind: "navigate", screenId: "bots.home", replace: true });
    const wordsIn = await build("bots.first-words", "phone", { params: { from: "app" } });
    expect(actions(walk(wordsIn.root!).find((x) => x.on?.onPress && texts(x).join("") === "Done")!)[0]).toEqual({ kind: "navigateBack" });
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
    // A phone that has the app's own speak button: the clay key is it, tapped on and off as the keyboard's mic key is,
    // and its words are counted at once.
    const phone = await buildBotsScreen({
      screenId: "bots.first-words", client: "phone", params: { w: 5196, s: 1876 }, tzOffsetMinutes: IST, user: { id: "u1" },
      can: new Set(["BotsKit", "VoiceButton"]), desk: { pages: false, notes: false },
    }, fakeDeps({ api: API }));
    const mic = walk(phone.root!).find((n) => n.type === "VoiceButton");
    expect(mic).toMatchObject({ bind: { value: "said", state: "mic" }, on: { onChange: { kind: "navigate", screenId: "bots.first-words", replace: true } } });
    expect(mic!.props?.hold).toBeUndefined();
    expect(JSON.stringify(mic)).toContain(JSON.stringify({ eq: ["mic", "recording"] }));
    expect(texts(phone.root!).some((t) => /\bhold\b/i.test(t))).toBe(false);
    const quiet = await build("bots.first-words", "desktop");
    expect(texts(quiet.root!).some((t) => /^\d[\d,]* words?$/.test(t))).toBe(false);
    // Done goes back (to Bots, or Keylessbord), not on to Plans.
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
    for (const gone of ["Stay on Free", "Keylessbord, 2,000 words a month", "Keylessbord without a word limit", "Unlimited voice-to-text refinement"]) expect(texts(s.root!)).not.toContain(gone);
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
      expect(t.props).toMatchObject({ id: "bots.auth", first: 0, of: 2, phaseStep: { verify: 1, verifying: 1 }, ground: "#ffffff", blip: { dot: "#F3E2C6" } });
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
  it("the bootstrap: the Bots app's sign-in, then Home, when it is on; today's when it is off", () => {
    const on = buildBootstrap({ botsApp: true, onboarded: false, onboardV2: true });
    expect((on.flags?.["auth.screen"] as { props?: { id?: string } }).props?.id).toBe("bots.auth");
    expect(on.flags?.["auth.sdui"]).toBe(true);
    // Nothing between sign-in and Home, onboarded or not, reviewer or not.
    for (const o of [{ onboarded: false }, { onboarded: true }, { onboarded: false, isReviewer: true }]) {
      const b = buildBootstrap({ botsApp: true, onboardV2: true, ...o });
      expect(b.initialScreenId).toBe("bots.home");
      expect(b.flags?.["boot.firstRunGateIds"]).not.toContain("bots.name-it");
    }
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
    // Code's Continue leads on to Home.
    for (const client of ["phone", "desktop"] as const) {
      const all = actions((await build("bots.sign-code", client)).root);
      expect(all, client).toEqual(expect.arrayContaining([{ kind: "switchTab", tabId: "bots" }]));
      expect(all.some((x) => x.kind === "navigate" && (x as { screenId?: string }).screenId === "bots.name-it"), client).toBe(false);
    }
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
      // One chain on the hello: waved (helloSeen), then gone (helloGone), so nothing waits on a second node appearing.
      expect(JSON.stringify(helloNode.on?.onAppear)).toMatch(/"path":"helloSeen".*"kind":"delay".*"path":"helloGone"/);
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

  it("Keylessbord on a phone: the same card in the page, only for what is missing; nothing once it is all on", async () => {
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
    const mic = stepOf(card, "Let Keylessbord hear you")!;
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
    expect(walk(stepOf(card, "Let Keylessbord type for you")!).find((n) => n.type === "DeskAskSetup")?.props).toMatchObject({ rows: [{ key: "read" }] });
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
  it("the About you card: due from the third visit once onboarded, until the name, the gender and the assistant's name are all saved; no putting it off", async () => {
    expect((await server.inject({ method: "GET", url: "/v1/bots/first-run/about" })).statusCode).toBe(401);
    const about = async () => (await server.inject({ method: "GET", url: "/v1/bots/first-run/about", headers: auth })).json();
    // A static token has no sign-in to read, so no name is suggested.
    expect(await about()).toMatchObject({ due: false, name: "", via: "other", gender: null, botName: "" });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let t = Date.parse("2026-11-03T09:00:00Z");
      const visit = async () => { t += 31 * 60_000; vi.setSystemTime(t); await server.inject({ method: "GET", url: "/v1/bots/first-run/arrival", headers: auth }); };
      expect((await server.inject({ method: "PUT", url: "/v1/profile", headers: auth, payload: { onboarded: true } })).statusCode).toBe(200);
      for (let i = 0; i < 2; i++) await visit();
      expect((await about()).due).toBe(false);
      await visit();
      expect((await about()).due).toBe(true);
      // There is no "Not now" to send.
      expect((await server.inject({ method: "PUT", url: "/v1/bots/first-run/about", headers: auth, payload: {} })).statusCode).toBe(404);
      // The pick alone is not enough for someone who did not sign in with Apple: the name too; and then the assistant's name.
      await server.inject({ method: "PUT", url: "/v1/profile", headers: auth, payload: { gender: "female" } });
      expect((await about()).due).toBe(true);
      await server.inject({ method: "PUT", url: "/v1/profile", headers: auth, payload: { full_name: "Aanya Rao" } });
      expect(await about()).toMatchObject({ due: true, name: "Aanya Rao", gender: "female", botName: "" });
      await visit();
      expect((await about()).due).toBe(true);
      expect((await server.inject({ method: "PUT", url: "/v1/personality", headers: auth, payload: { assistantName: "Zara" } })).statusCode).toBe(200);
      expect(await about()).toMatchObject({ due: false, botName: "Zara" });
    } finally {
      vi.useRealTimers();
    }
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

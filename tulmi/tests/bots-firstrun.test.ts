import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

// The Bots app's first run (screens/firstRun.ts, routes/botsFirstRun.ts): Welcome, Sign in and Code in the gate's
// tree, then Languages → Name → Turn on Keybot → First words → Plans, each on the routes that already own the write.
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
const { spokenSince, trialDaysOf } = await import("../src/routes/botsFirstRun.js");

const LANGS = { options: [{ value: "hinglish", label: "Hinglish" }, { value: "hi", label: "Hindi" }, { value: "en", label: "English" }, { value: "ta", label: "Tamil" }], picked: ["ta", "en"] };
const WORDS = { words: 0, seconds: 0, typingSeconds: 0, totalWords: 5210, totalSeconds: 1880 };
const PHONE_PLANS = {
  freeForAll: false, entitled: false, freeWords: 2000, features: ["Unlimited voice-to-text refinement"],
  plans: [
    { id: "annual", label: "Elite", price: "$59.99", per: "$5.00 / mo, billed yearly", trialDays: 7, default: true, buy: { kind: "iap.showPaywall", offeringId: "default", packageId: "$rc_annual" } },
    { id: "monthly", label: "Lite", price: "$9.99", per: "per month", buy: { kind: "iap.showPaywall", offeringId: "default", packageId: "$rc_monthly" } },
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

const build = (screenId: string, client: "phone" | "desktop", o: { params?: Record<string, string | number>; api?: Record<string, unknown>; calls?: Array<{ method: string; path: string }> } = {}) =>
  buildBotsScreen({
    screenId, client, params: o.params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya", email: "aanya@example.in" },
    can: new Set(["BotsKit"]), desk: { pages: false, notes: false },
  }, fakeDeps({ api: o.api ?? API, calls: o.calls }));
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

describe("Languages, Name", () => {
  it("Languages: the person's own picks, chips that toggle (never to none), saved to the personality, then Name", async () => {
    const s = await build("bots.language", "phone");
    expect(s.state?.langs).toEqual(["ta", "en"]);
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Which languages do you speak?", "Hinglish", "Tamil"]));
    expect(actions(s.root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "toggleInArray", path: "langs", value: "ta", min: 1 }),
      expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" }, onSuccess: { kind: "navigate", screenId: "bots.name-it" } }),
    ]));
  });
  it("Name: today's name for it, saved as the assistant's name, then Turn on Keybot", async () => {
    const s = await build("bots.name-it", "desktop");
    expect(s.state?.name).toBe("Zara");
    expect(actions(s.root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "setState", path: "name", value: "Jarvis" }),
      expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { assistantName: "$state.name" }, onSuccess: { kind: "navigate", screenId: "bots.keybot.on" } }),
    ]));
    const blank = await build("bots.name-it", "phone", { api: {} });
    expect(blank.state?.name).toBe("Tailzu");
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
  });
  it("spokenSince and the typing estimate", () => {
    expect(spokenSince({ words: 120, audioSeconds: 40 }, { w: 100, s: 32 })).toEqual({ words: 20, seconds: 8, typingSeconds: 30, totalWords: 120, totalSeconds: 40 });
    expect(spokenSince({ words: 120, audioSeconds: 40 }, {})).toMatchObject({ words: 0, seconds: 0 });
    expect(trialDaysOf("7 days free, then billed yearly")).toBe(7);
    expect(trialDaysOf("Billed monthly")).toBeUndefined();
  });
});

describe("Plans", () => {
  const finishes = (a: ActionSpec[]) => a.some((x) => x.kind === "callEndpoint" && (x as { path?: string }).path === "/v1/profile"
    && JSON.stringify((x as { body?: unknown }).body) === '{"onboarded":true}');
  it("phone: the paywall's plans, bought as the paywall buys them; buying or staying free ends the first run", async () => {
    const s = await build("bots.plans", "phone");
    expect(s.state?.plan).toBe("annual");
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Free", "Elite", "$59.99", "Lite", "Start free week", "Stay on Free", "Keybot, 2,000 words a month"]));
    const all = actions(s.root);
    const buy = all.find((x) => x.kind === "iap.showPaywall" && (x as { packageId?: string }).packageId === "$rc_annual") as { onSuccess?: unknown } | undefined;
    expect(buy).toBeDefined();
    expect(finishes(actions(buy!.onSuccess))).toBe(true);
    expect(finishes(all)).toBe(true);
  });
  it("window: the pay page (iap.subscribe) at Razorpay's prices", async () => {
    const s = await build("bots.plans", "desktop");
    expect(texts(s.root!)).toContain("₹5,999");
    expect(actions(s.root)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "iap.subscribe", productId: "tailzu_annu" })]));
  });
  it("nothing to sell (free for all, or already paying): say so, and go in", async () => {
    const free = await build("bots.plans", "phone", { api: { "GET /v1/bots/first-run/plans?client=phone": { ...PHONE_PLANS, freeForAll: true, plans: [] } } });
    expect(texts(free.root!)).toContain("Tailzu is free for everyone right now. Nothing to pick, nothing to pay.");
    expect(actions(free.root).some((x) => x.kind.startsWith("iap."))).toBe(false);
    expect(finishes(actions(free.root))).toBe(true);
  });
});

describe("the gate: Welcome, Sign in, Code on the sign-in the app already runs", () => {
  const opts = { terms: "https://tailzu.space/terms", privacy: "https://tailzu.space/privacy" };
  it("a stage both gates step through, with the gate's own controls", () => {
    for (const desktop of [false, true]) {
      const t = botsAuthTree({ ...opts, desktop }) as unknown as Node;
      expect(t.type).toBe("OnboardStage");
      expect(t.props).toMatchObject({ id: "bots.auth", phaseStep: { verify: 1, verifying: 1 }, ground: "#ffffff" });
      const types = walk(t).map((n) => n.type);
      expect(types).toEqual(expect.arrayContaining(["SwipePill", "GoogleSignIn", "AppleSignIn", "CodeEntry"]));
      const pills = walk(t).filter((n) => n.type === "SwipePill").map((n) => n.props?.method);
      expect(pills.sort()).toEqual(["email", "phone"]);
      expect(texts(t)).toEqual(expect.arrayContaining(["Hi, I'm Tailzu.", "Your phone number", "Enter the code"]));
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
    expect(on.initialScreenId).toBe("bots.language");
    expect(on.flags?.["boot.firstRunGateIds"]).toEqual(expect.arrayContaining(BOTS_FIRST_RUN_IDS));
    expect(buildBootstrap({ botsApp: true, onboarded: true }).initialScreenId).toBe("bots.home");
    expect(buildBootstrap({ botsApp: true, onboarded: false, isReviewer: true }).initialScreenId).not.toBe("bots.language");
    const off = buildBootstrap({ onboarded: false, onboardV2: true });
    expect((off.flags?.["auth.screen"] as { props?: { id?: string } }).props?.id).not.toBe("bots.auth");
    expect(off.initialScreenId).toBe("onboard");
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

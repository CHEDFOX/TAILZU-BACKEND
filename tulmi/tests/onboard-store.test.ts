/**
 * THE NEW ONBOARDING FOR THE BUILDS IN THE STORES (experience/onboardStore.ts).
 *
 * What these hold down:
 *   - the variant is made ONLY of what the store build draws and does: every
 *     node type, prop, binding, event, action kind and field, condition and
 *     style key in its JSON is one the store build's own source names
 *     (tests/fixtures/store-build.json, read out of the phone repo's
 *     origin/main by scripts/storeBuild.ts, and that repo itself when it is at
 *     hand);
 *   - who gets which onboarding, by what the build says it can draw: the
 *     stage's, the store variant, or the one it has always had;
 *   - a store build keeps its sign-in exactly as it was;
 *   - anyone who has already dictated is onboarded, for both new flows;
 *   - the steps, the pane that is shown, Blip's pictures: that they exist, are
 *     animated, transparent, small, and are served.
 * The Hinglish lines are in onboard-words.test.ts, which has to stand in for
 * the translator.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import fixtureJson from "./fixtures/store-build.json";

const T = {
  fresh: "test-store-fresh-0123456789012",
  spoke: "test-store-spoke-0123456789012",
  wrote: "test-store-wrote-0123456789012",
  oldSpoke: "test-store-oldspoke-012345678",
  desk: "test-store-desk-01234567890123",
  review: "test-store-review-012345678901",
};
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.STATIC_BEARER_TOKENS = Object.values(T).join(",");
process.env.CONNECTORS = "true";
process.env.CONNECTORS_ENABLED_IDS = "notion, linear, github, atlassian, asana, zapier";
process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const { resolveUser } = await import("../src/auth/supabase.js");
process.env.REVIEW_USER_IDS = (await resolveUser(`Bearer ${T.review}`))!.id;
const { resetConfigForTests } = await import("../src/config.js");
resetConfigForTests();

const { buildApp } = await import("../src/server.js");
const { buildBootstrap, buildScreen, DAILY_LANGUAGES } = await import("../src/experience/catalog.js");
const { OB_EN, OB_HG, OB_STORE_EN, OB_STORE_HG, onboardHinglishSeeds } = await import("../src/experience/onboard.js");
const { STORE_NEEDS, canOnboardStore, onboardMode, storeStart } = await import("../src/experience/onboardStore.js");
const { hasAlreadyDictated } = await import("../src/experience/onboardGuard.js");
const { BLIP_LOOPS, BLIP_HEIGHT, BLIP_LOOP_MS, blipSize, blipUrl } = await import("../src/experience/blipLoops.js");
const { BLIP_BUILD } = await import("../src/experience/blipData.js");
const { recordUsage } = await import("../src/usage/metering.js");
const { appendHistoryEntry } = await import("../src/history/store.js");
const { STORE_COMMIT, STORE_FILES, parseStoreBuild } = await import("../scripts/storeBuild.js");
type StoreBuild = import("../scripts/storeBuild.js").StoreBuild;
const { CATALOG } = await import("../src/connectors/catalog.js");

// ---------------------------------------------------------------------------
// The store build, as its own source names it
// ---------------------------------------------------------------------------

const FIXTURE = fixtureJson as unknown as StoreBuild;

/** The phone build in the stores, read from the phone repo at STORE_COMMIT when the repo is at hand; null where it is not (CI). */
function liveStoreBuild(): StoreBuild | null {
  const repo = process.env.TAILZU_FRONTEND ?? "/home/user/TAILZU-FRONTEND";
  try {
    const src = Object.fromEntries(
      Object.entries(STORE_FILES).map(([k, file]) => [k, execFileSync("git", ["-C", repo, "show", `${STORE_COMMIT}:${file}`], { encoding: "utf8", maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "ignore"] })]),
    ) as unknown as import("../scripts/storeBuild.js").StoreSources;
    return parseStoreBuild(src);
  } catch {
    return null;
  }
}
const LIVE = liveStoreBuild();
const BUILDS: Array<[string, StoreBuild]> = [["the fixture", FIXTURE], ...(LIVE ? [[`the phone repo at ${STORE_COMMIT}`, LIVE] as [string, StoreBuild]] : [])];

type N = {
  type: string; id?: string; props?: Record<string, any>; style?: Record<string, any>; children?: N[];
  visibleIf?: any; on?: Record<string, any>; bind?: Record<string, string>; fallback?: N; motion?: Record<string, any>;
};

/** What the server alone reads, and the app never sees (titleCase.ts): not the app's to name. */
const SERVER_ONLY_PROPS = new Set(["keepCase"]);
const NODE_KEYS = new Set(["type", "id", "props", "style", "children", "bind", "on", "motion", "visibleIf", "fallback"]);
/** resolveStyle hands any key it does not name to React Native untouched; this is the one it says it exists for. */
const STYLE_PASSTHROUGH = new Set(["transform"]);

/** Everything in a screen that is not in `b`, as sentences. Empty is a screen the store build can draw. */
function audit(screen: any, b: StoreBuild): string[] {
  const bad: string[] = [];
  const drawn = new Set(b.drawn.filter((t) => b.declared.includes(t)));
  const actionKinds = new Set(b.actions);

  const condition = (c: any, where: string, allowed: string[]): void => {
    if (!c || typeof c !== "object") return;
    for (const k of Object.keys(c)) {
      if (!allowed.includes(k)) { if (k !== "then" && k !== "else") bad.push(`${where}: condition ${k}`); continue; }
      if (k === "not") condition(c.not, where, allowed);
      if (k === "all" || k === "any") for (const x of c[k]) condition(x, where, allowed);
    }
  };

  const action = (a: any, where: string): void => {
    if (a == null) return;
    if (typeof a === "string") {
      if (!screen.actions?.[a]) bad.push(`${where}: the action ${a} is not in the screen's table`);
      return;
    }
    if (!actionKinds.has(a.kind)) { bad.push(`${where}: action kind ${a.kind}`); return; }
    for (const f of Object.keys(a)) {
      if (!(b.actionFields[a.kind] ?? []).includes(f)) bad.push(`${where}: ${a.kind} reads no field ${f}`);
    }
    if (a.kind === "condition") condition(a.if, `${where}.if`, b.conditions);
    for (const f of ["actions"]) if (Array.isArray(a[f])) a[f].forEach((x: any) => action(x, `${where}.${a.kind}`));
    for (const f of ["then", "else", "onSuccess", "onError", "onGranted", "onDenied", "onBlocked"]) if (f in a) action(a[f], `${where}.${f}`);
  };

  const node = (n: N, path: string): void => {
    const where = `${path}/${n.type}${n.id ? "#" + n.id : ""}`;
    for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) bad.push(`${where}: node key ${k}`);
    if (!drawn.has(n.type)) { bad.push(`${where}: node type ${n.type}`); return; }
    const reads = b.props[n.type];
    if (reads === null || reads === undefined) bad.push(`${where}: no props known for ${n.type}`);
    else {
      for (const k of Object.keys(n.props ?? {})) if (!reads.includes(k) && !SERVER_ONLY_PROPS.has(k)) bad.push(`${where}: prop ${k}`);
      for (const k of Object.keys(n.bind ?? {})) if (!reads.includes(k)) bad.push(`${where}: bind ${k}`);
    }
    for (const ev of Object.keys(n.on ?? {})) {
      if (!["onAppear", "onDisappear"].includes(ev) && !(b.events[n.type] ?? []).includes(ev)) bad.push(`${where}: event ${ev}`);
      action(n.on![ev], `${where}.${ev}`);
    }
    condition(n.visibleIf, `${where}.visibleIf`, b.conditions);
    for (const [k, v] of Object.entries(n.style ?? {})) {
      if (!b.styleKeys.includes(k) && !STYLE_PASSTHROUGH.has(k)) bad.push(`${where}: style key ${k}`);
      if (v && typeof v === "object" && !Array.isArray(v) && ("then" in v || "else" in v)) condition(v, `${where}.style.${k}`, b.styleConditions);
    }
    for (const k of Object.keys(n.motion ?? {})) if (!["appear", "durationMs", "delayMs"].includes(k)) bad.push(`${where}: motion ${k}`);
    if (n.motion?.appear && !["fadeInUp", "fadeInDown", "scaleIn", "fade"].includes(n.motion.appear)) bad.push(`${where}: motion ${n.motion.appear}`);
    (n.children ?? []).forEach((c) => node(c, where));
  };

  node(screen.root, "");
  for (const [name, a] of Object.entries(screen.actions ?? {})) action(a, `actions.${name}`);
  return bad;
}

const types = (screen: any): Set<string> => {
  const out = new Set<string>();
  const walk = (n: N): void => { out.add(n.type); (n.children ?? []).forEach(walk); };
  walk(screen.root);
  return out;
};

// ---------------------------------------------------------------------------
// A small reader for the trees, as onboard.test.ts has one
// ---------------------------------------------------------------------------

const get = (st: any, p: string) => p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), st);
function holds(c: any, st: any): boolean {
  if (!c) return true;
  if ("eq" in c) return get(st, c.eq[0]) === c.eq[1];
  if ("gte" in c) return Number(get(st, c.gte[0])) >= c.gte[1];
  if ("truthy" in c) return !!get(st, c.truthy);
  if ("falsy" in c) return !get(st, c.falsy);
  if ("not" in c) return !holds(c.not, st);
  if ("all" in c) return c.all.every((x: any) => holds(x, st));
  if ("any" in c) return c.any.some((x: any) => holds(x, st));
  if ("contains" in c) { const v = get(st, c.contains[0]); return Array.isArray(v) ? v.includes(c.contains[1]) : String(v ?? "").includes(c.contains[1]); }
  throw new Error(`a condition this reader does not know: ${JSON.stringify(c)}`);
}
const each = (n: N, f: (n: N) => void): void => { f(n); (n.children ?? []).forEach((c) => each(c, f)); };
const find = (n: N, pred: (n: N) => boolean): N[] => { const out: N[] = []; each(n, (x) => { if (pred(x)) out.push(x); }); return out; };
/** What is on screen given the state: a node's subtree only if it is shown. */
function shown(n: N, st: any, f: (n: N) => void): void {
  if (!holds(n.visibleIf, st)) return;
  f(n);
  (n.children ?? []).forEach((c) => shown(c, st, f));
}
const BLIP = (n: N): boolean => n.type === "Image" && String(n.props?.source?.url ?? "").includes("/blip/") && n.style?.position !== "absolute";

// ---------------------------------------------------------------------------

const notion = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, category: "Docs", oneLine: `${name} does things.`, auth: "oauth", connected: false, level: "send", auto: [], ...extra });
const APPS = [
  notion("notion", "Notion"), notion("linear", "Linear"), notion("github", "GitHub"), notion("atlassian", "Jira and Confluence"),
  notion("asana", "Asana"), notion("zapier", "Zapier", { auth: "url" }), notion("mine", "My app", { custom: true }), notion("trello", "Trello"),
];
/** The store build as it is: exactly what it declares. */
const STORE = new Set<string>(FIXTURE.declared);
const BOTH = ["OnboardStage", "BlipSpot"];
const ctx = (extra: Record<string, unknown> = {}) => ({
  personality: {}, language: "en", platform: "ios", formFactor: "phone", connectorsOn: true,
  assistant: { apps: APPS, names: {} }, can: STORE, ...extra,
}) as never;
const screen = (extra: Record<string, unknown> = {}) => buildScreen("onboard", ctx(extra)) as any;
const withUrl = new Set([...STORE, "ActionUrl"]);
/** The root is the bar over a sheet; the sheet holds the panes. */
const panesOf = (s: any): N[] => s.root.children[1].children.filter((c: N) => c.id);
const stepIds = (s: any): string[] => panesOf(s).map((c) => c.id!);

/** The screens the audits and the checks below walk: both platforms, with and without the apps steps, every start. */
const SCREENS: Array<[string, any]> = [
  ["ios, apps", screen({ can: withUrl })],
  ["android, apps", screen({ can: withUrl, platform: "android" })],
  ["ios, the store build as it is", screen()],
  ["ios, apps off", screen({ can: withUrl, connectorsOn: false })],
  ["ios, languages saved, keyboard ready", screen({ can: withUrl, personality: { languages: ["hinglish"] }, keyboardReady: true, locale: "en-IN" })],
  ["ios, an app already connected", screen({ can: withUrl, assistant: { apps: [{ ...APPS[0], connected: true }, ...APPS.slice(1)], names: {} } })],
];

// ---------------------------------------------------------------------------

describe("made only of what the store build draws", () => {
  it("the fixture is the store build: it cannot draw the stage, and it can draw what the variant is made of", () => {
    for (const [name, b] of BUILDS) {
      expect(b.declared, name).not.toContain("OnboardStage");
      expect(b.declared, name).not.toContain("BlipSpot");
      for (const t of STORE_NEEDS) {
        expect(b.declared, `${name}: ${t} declared`).toContain(t);
        expect(b.drawn, `${name}: ${t} drawn`).toContain(t);
      }
      // …and it cannot fill a state value into an address, which is why Connect apps is not in the store flow.
      expect(b.declared, name).not.toContain("ActionUrl");
    }
  });

  for (const [which, b] of BUILDS) {
    for (const [name, s] of SCREENS) {
      it(`${name}: every type, prop, binding, event, action, condition and style key is in ${which}`, () => {
        expect(audit(s, b)).toEqual([]);
      });
    }
  }

  it("the audit finds what it is for: a stage, a hold, an action the build lacks", () => {
    const stage = JSON.parse(JSON.stringify(SCREENS[0]![1]));
    const pane = stage.root.children[1].children[1];
    pane.children.push({ type: "OnboardStage", children: [{ type: "BlipSpot", props: { pose: "wave" } }] });
    pane.children.push({ type: "VoiceButton", props: { hold: true }, bind: { state: "mic" }, on: { onPress: "nope", onChange: { kind: "connector.connect", id: "x" } }, style: { backdropFilter: "blur" } });
    stage.actions.finish = { kind: "callEndpoint", method: "PUT", path: "/v1/profile", headers: {} };
    const bad = audit(stage, FIXTURE).join("\n");
    for (const hit of ["node type OnboardStage", "prop hold", "bind state", "event onPress", "action kind connector.connect", "callEndpoint reads no field headers", "style key backdropFilter", "the action nope is not in"]) expect(bad).toContain(hit);
  });

  it("STORE_NEEDS is exactly the node types the screens use", () => {
    const used = new Set<string>();
    for (const [, s] of SCREENS) for (const t of types(s)) used.add(t);
    expect([...used].sort()).toEqual([...STORE_NEEDS].sort());
  });
});

describe("who gets which onboarding", () => {
  const DECLARED = FIXTURE.declared;

  it("a phone build that cannot draw the stage but draws the pieces gets the store variant; one that can, the stage's", () => {
    expect(onboardMode(DECLARED, "phone")).toBe("store");
    expect(onboardMode(new Set(DECLARED), "phone")).toBe("store");
    expect(onboardMode([...DECLARED, ...BOTH], "phone")).toBe("v2");
    expect(canOnboardStore([...DECLARED, ...BOTH], "phone")).toBe(false);
    // Half of the pair is not the pair: it is a build that cannot draw the stage.
    expect(onboardMode([...DECLARED, "OnboardStage"], "phone")).toBe("store");
    expect(onboardMode([...DECLARED, "BlipSpot"], "phone")).toBe("store");
  });

  it("a build that does not say it draws every piece, or says nothing, is served what it always was", () => {
    for (const t of STORE_NEEDS) expect(onboardMode(DECLARED.filter((d) => d !== t), "phone"), `without ${t}`).toBe("old");
    expect(onboardMode([], "phone")).toBe("old");
    expect(onboardMode(undefined, "phone")).toBe("old");
    expect(onboardMode("Stack,Text", "phone")).toBe("old");
    expect(onboardMode(["Stack", "Text"], "phone")).toBe("old");
    // A window never gets the store variant: its builds are not in a store.
    expect(onboardMode(DECLARED, "desktop")).toBe("old");
    expect(onboardMode([...DECLARED, "DeskShell"], undefined)).toBe("store");
  });

  it("ONBOARD_V2=0 gives everyone the old one again", () => {
    process.env.ONBOARD_V2 = "0";
    try {
      expect(onboardMode(DECLARED, "phone")).toBe("old");
      expect(onboardMode([...DECLARED, ...BOTH], "phone")).toBe("old");
      expect(buildScreen("onboard", ctx())!.screenId).toBe("onboarding");
      expect(buildScreen("onboard", ctx({ can: new Set([...DECLARED, ...BOTH]) }))!.screenId).toBe("onboarding");
    } finally {
      delete process.env.ONBOARD_V2;
    }
  });

  it("the screen `onboard`: the stage's, the store variant, or today's first step", () => {
    const v2 = buildScreen("onboard", ctx({ can: new Set([...DECLARED, ...BOTH]) })) as any;
    expect(v2.root.type).toBe("OnboardStage");
    const store = screen();
    expect(store.screenId).toBe("onboard");
    expect(store.root.type).toBe("Stack");
    expect(JSON.stringify(store)).not.toContain("OnboardStage");
    expect(JSON.stringify(store)).not.toContain("BlipSpot");
    for (const can of [new Set<string>(), new Set(["Stack", "Text"]), new Set(["OnboardStage"]), new Set(["BlipSpot"])]) {
      expect(buildScreen("onboard", ctx({ can }))!.screenId).toBe("onboarding");
    }
    expect(buildScreen("onboard", ctx({ formFactor: "desktop" }))!.screenId).toBe("onboarding");
  });

  it("buildBootstrap for a store build: the first screen of the new flow, and the sign-in it has always had", () => {
    const b = (o: Record<string, unknown>) => buildBootstrap({ onboardStore: true, connectorsOn: true, ...o } as never);
    const today = JSON.stringify(buildBootstrap({ onboarded: false, launchCount: 2 }).flags!["auth.screen"]);
    const phone = b({ onboarded: false, launchCount: 1 });
    expect(JSON.stringify(phone.flags!["auth.screen"])).toBe(today);
    expect(today).not.toContain("OnboardStage");
    expect(phone.flags!["boot.firstRunGateIds"]).toEqual(["onboarding", "onboarding_keyboard", "onboard"]);
    // The intro film would be a second opening; and a phone that already has the microphone and keyboard still walks it.
    expect(phone.initialScreenId).toBe("onboard");
    expect(b({ onboarded: false, launchCount: 3, micGranted: true, keyboardReady: true }).initialScreenId).toBe("onboard");
    // Onboarded: the app, as ever; except the first launch of an install that has not granted both.
    expect(b({ onboarded: true, launchCount: 5 }).initialScreenId).not.toBe("onboard");
    expect(b({ onboarded: true, launchCount: 1 }).initialScreenId).toBe("onboard");
    // Without it, today's.
    expect(buildBootstrap({ onboarded: false, launchCount: 2 }).initialScreenId).toBe("onboarding");
  });
});

describe("through the server", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const caps = (components: string[], device: Record<string, unknown> = {}) =>
    ({ platform: "ios", appVersion: "8.6.0", components, device: { width: 390, height: 844, ...device } });
  const boot = async (token: string, components: string[], device: Record<string, unknown> = {}, launchCount = 2) => {
    const r = await app.inject({ method: "POST", url: "/v1/app/bootstrap", headers: auth(token), payload: { launchCount, capabilities: caps(components, device) } });
    expect(r.statusCode).toBe(200);
    return r.json();
  };
  const askScreen = async (token: string, components: string[], device: Record<string, unknown> = {}) => {
    const r = await app.inject({ method: "POST", url: "/v1/app/screen", headers: auth(token), payload: { screenId: "onboard", capabilities: caps(components, device) } });
    expect(r.statusCode).toBe(200);
    return r.json();
  };
  const profile = async (token: string) => (await app.inject({ method: "GET", url: "/v1/profile", headers: auth(token) })).json();
  const settled = async (token: string) => {
    for (let i = 0; i < 25 && !(await profile(token)).onboarded; i++) await new Promise((r) => setTimeout(r, 20));
    return (await profile(token)).onboarded;
  };
  const DECLARED = FIXTURE.declared;
  const OLD = ["Stack", "Text"];

  it("a store build is sent the sign-in tree it has always had, and onboard first; every other build as before", async () => {
    const today = JSON.stringify(buildBootstrap({ onboarded: false, launchCount: 2 }).flags!["auth.screen"]);
    const store = await boot(T.fresh, DECLARED);
    expect(JSON.stringify(store.flags["auth.screen"])).toBe(today);
    expect(store.initialScreenId).toBe("onboard");
    expect(store.flags["boot.firstRunGateIds"]).toContain("onboard");
    expect(store.flags["auth.sdui"]).toBe(true);
    // The stage's build: the stage's tree.
    expect((await boot(T.fresh, [...DECLARED, ...BOTH])).flags["auth.screen"].type).toBe("OnboardStage");
    // A build with half the pieces: what it always had.
    const old = await boot(T.fresh, OLD);
    expect(JSON.stringify(old.flags["auth.screen"])).toBe(today);
    expect(old.initialScreenId).toBe("onboarding");
    // A window, even one that says everything: not the store variant.
    expect((await boot(T.desk, DECLARED, { formFactor: "desktop", os: "mac" })).initialScreenId).not.toBe("onboard");
    process.env.ONBOARD_V2 = "0";
    try {
      expect((await boot(T.fresh, DECLARED)).initialScreenId).toBe("onboarding");
    } finally {
      delete process.env.ONBOARD_V2;
    }
  });

  it("the screen: Welcome and the steps after sign-in, with the apps only for a build that can open what Connect leads to", async () => {
    const s = await askScreen(T.fresh, DECLARED, { locale: "en-IN" });
    expect(s.screenId).toBe("onboard");
    expect(stepIds(s)).toEqual(["welcome", "languages", "keyboard", "try", "yours", "done"]);
    expect(s.state.step).toBe(0);
    expect(s.state.langs).toEqual(["hinglish", "hi", "en"]);
    const withApps = await askScreen(T.fresh, [...DECLARED, "ActionUrl"]);
    expect(stepIds(withApps)).toEqual(["welcome", "languages", "keyboard", "try", "yours", "apps", "careful", "done"]);
    // The apps come from the server, read fresh, as for the stage's build.
    expect(withApps.state.n).toEqual({ notion: "Notion", linear: "Linear", github: "GitHub", atlassian: "Jira and Confluence", asana: "Asana" });
    // Today's first step for a build that is not either.
    expect((await askScreen(T.fresh, OLD)).screenId).toBe("onboarding");
    expect((await askScreen(T.fresh, DECLARED, { formFactor: "desktop" })).screenId).toBe("onboarding");
  });

  it("the guide to who is onboarded: anyone who has already dictated, for both new flows, and nobody else", async () => {
    const spoke = (await resolveUser(`Bearer ${T.spoke}`))!;
    await recordUsage({ user: spoke, source: "stream", audioSeconds: 3, words: 7, model: "live" });
    const wrote = (await resolveUser(`Bearer ${T.wrote}`))!;
    await appendHistoryEntry(wrote, { retainHistory: true }, { kind: "voice", targetApp: "WhatsApp", input: "hi", output: "Hi." });
    // Nobody has marked either as onboarded: they only ever used another app.
    expect((await profile(T.spoke)).onboarded).toBe(false);
    expect((await profile(T.wrote)).onboarded).toBe(false);

    // A new person is walked through it, a window's user and a phone's alike…
    expect((await boot(T.fresh, DECLARED)).initialScreenId).toBe("onboard");
    expect((await boot(T.fresh, [...DECLARED, ...BOTH])).initialScreenId).toBe("onboard");
    expect((await profile(T.fresh)).onboarded).toBe(false);

    // …and someone who has dictated is not, whichever build asks: words, or history.
    for (const token of [T.spoke, T.wrote]) {
      for (const components of [DECLARED, [...DECLARED, ...BOTH]]) {
        const b = await boot(token, components);
        expect(b.initialScreenId, `${token} ${components.length}`).not.toBe("onboard");
        expect(b.initialScreenId).not.toBe("onboarding");
        // The first launch of an install that has granted both: the app.
        expect((await boot(token, components, { micGranted: true, keyboardReady: true }, 1)).initialScreenId).not.toBe("onboard");
      }
      // The profile says so from then on, so nothing has to ask again.
      expect(await settled(token), token).toBe(true);
    }
    expect((await boot(T.wrote, DECLARED)).flags["boot.firstRun"]).toBe(false);
  });

  it("the old flow decides as it always has: the guide does not mark anyone for a build that is not either", async () => {
    const user = (await resolveUser(`Bearer ${T.oldSpoke}`))!;
    await recordUsage({ user, source: "stream", audioSeconds: 3, words: 7, model: "live" });
    const b = await boot(T.oldSpoke, OLD);
    expect(b.initialScreenId).toBe("onboarding");
    await new Promise((r) => setTimeout(r, 60));
    expect((await profile(T.oldSpoke)).onboarded).toBe(false);
    // And the old shortcut stays for it: nothing to ask, so marked. (A build with both
    // granted never reaches the guide: that is the next test.)
  });

  it("the device's microphone and keyboard do not mark a new person onboarded in the store flow: it ends at Done", async () => {
    const granted = { micGranted: true, keyboardReady: true };
    const b = await boot(T.fresh, DECLARED, granted, 3);
    expect(b.initialScreenId).toBe("onboard");
    await new Promise((r) => setTimeout(r, 60));
    expect((await profile(T.fresh)).onboarded).toBe(false);
  });

  it("the reviewer goes straight in", async () => {
    expect((await boot(T.review, DECLARED, {}, 1)).initialScreenId).not.toBe("onboard");
  });

  it("its two faces come the way every face does: named in the bootstrap's fonts, which the store build loads in the background", async () => {
    const b = await boot(T.fresh, DECLARED);
    const s = await askScreen(T.fresh, DECLARED);
    const faces = new Set<string>();
    const walk = (n: N): void => { if (n.style?.fontFamily) faces.add(String(n.style.fontFamily)); (n.children ?? []).forEach(walk); };
    walk(s.root);
    expect([...faces].sort()).toEqual(["Tailzu Grotesk", "Tailzu Hand"]);
    for (const face of faces) expect(b.fonts[face], face).toMatch(/^https:\/\/.+\.ttf\?v=\d+$/);
  });

  it("serves Blip's pictures, immutable, from /blip/", async () => {
    for (const loop of BLIP_LOOPS) {
      const r = await app.inject({ method: "GET", url: `/blip/${loop}.webp?v=${BLIP_BUILD.v}` });
      expect(r.statusCode, loop).toBe(200);
      expect(r.headers["content-type"]).toContain("image/webp");
      expect(r.headers["cache-control"]).toContain("immutable");
      expect(r.rawPayload.length, loop).toBe(BLIP_BUILD.files[loop]!.bytes);
    }
    expect((await app.inject({ method: "GET", url: "/blip/nope.webp" })).statusCode).toBe(404);
  });
});

describe("the existing-user guard on its own", () => {
  const user = { id: "u" } as never;
  it("any words, or any history, and a failed read says nothing", async () => {
    const none = async () => ({ entries: [] });
    const some = async () => ({ entries: [{}] });
    expect(await hasAlreadyDictated(user, 1, none)).toBe(true);
    expect(await hasAlreadyDictated(user, 0, some)).toBe(true);
    expect(await hasAlreadyDictated(user, 0, none)).toBe(false);
    expect(await hasAlreadyDictated(user, 0, async () => { throw new Error("down"); })).toBe(false);
    // History is asked about only when there are no words: one cheap row, and only then.
    let asked = 0;
    await hasAlreadyDictated(user, 5, async () => { asked++; return { entries: [] }; });
    expect(asked).toBe(0);
  });
});

describe("the steps", () => {
  it("Welcome, Languages, Keyboard, Try it, Make me yours, [Connect apps, How careful,] Done: the same steps in the same order", () => {
    expect(stepIds(screen())).toEqual(["welcome", "languages", "keyboard", "try", "yours", "done"]);
    expect(stepIds(screen({ can: withUrl }))).toEqual(["welcome", "languages", "keyboard", "try", "yours", "apps", "careful", "done"]);
    // The apps need the app's list, the feature, and a build that can open Connect.
    for (const off of [{ connectorsOn: false }, { assistant: undefined }, { assistant: { apps: [APPS[5], APPS[6]], names: {} } }]) {
      expect(stepIds(screen({ can: withUrl, ...off })), JSON.stringify(Object.keys(off))).toEqual(["welcome", "languages", "keyboard", "try", "yours", "done"]);
    }
  });

  it("is one screen: a pane per step shown by `step`, which every move only sets and only forward", () => {
    for (const [name, s] of SCREENS) {
      const panes = panesOf(s);
      panes.forEach((p, i) => expect(p.visibleIf, `${name} ${p.id}`).toEqual({ eq: ["step", i] }));
      expect(s.hideChrome).toBe(true);
      expect(s.cacheTtlSeconds).toBe(0);
      expect(s.root.props.keepCase).toBe(true);
      // One bar segment per pane, and no navigation between steps.
      expect(s.root.children[0].children).toHaveLength(panes.length);
      // The segments light with `step`.
      s.root.children[0].children.forEach((seg: N, i: number) => expect(seg.style!.backgroundColor.gte).toEqual(["step", i]));
      expect(JSON.stringify(s)).not.toContain('"kind":"navigate","screenId":"onboard');
      const moves: Array<[string, number]> = [];
      for (const p of panes) {
        const found: number[] = [];
        const walk = (x: any): void => {
          if (!x || typeof x !== "object") return;
          if (Array.isArray(x)) return x.forEach(walk);
          if (x.kind === "setState" && x.path === "step") found.push(x.value);
          Object.values(x).forEach(walk);
        };
        walk(p);
        found.forEach((v) => moves.push([p.id!, v]));
      }
      const index = (id: string) => panes.findIndex((p) => p.id === id);
      for (const [from, to] of moves) {
        expect(to, `${name}: ${from} -> ${to}`).toBeGreaterThan(index(from));
        expect(to).toBeLessThan(panes.length);
      }
      // Every pane but the last has a way on.
      for (const p of panes.slice(0, -1)) expect(moves.some(([f]) => f === p.id), `${name}: ${p.id} has no way on`).toBe(true);
    }
  });

  it("each pane arrives with the build's own entrance motion, scrolls in a Screen, and pins what it asks below", () => {
    const s = screen({ can: withUrl });
    for (const pane of panesOf(s)) {
      const [scroll, foot] = pane.children!;
      expect(scroll!.type, pane.id).toBe("Screen");
      expect(scroll!.children![0]!.motion!.appear).toBe("fadeInUp");
      expect(foot!.motion!.appear, pane.id).toBe("fadeInUp");
      // The foot is the buttons; no spacer is left to push them.
      expect(find(pane, (n) => n.type === "Spacer"), pane.id).toEqual([]);
      expect(foot!.children!.length, pane.id).toBeGreaterThan(0);
    }
    // The sheets and the watcher draw nothing in the layout, so they sit outside the foot's gaps.
    const apps = panesOf(s).find((c) => c.id === "apps") as N;
    expect(apps.children!.filter((c) => c.type === "BottomSheet").length).toBe(5);
    expect(find(apps.children![1]!, (n) => n.type === "BottomSheet")).toEqual([]);
  });

  it("Make me yours is checked when it is reached, and Keyboard moves on by itself when the keyboard is ready", () => {
    const s = screen();
    const yours = panesOf(s).find((c) => c.id === "yours") as N;
    expect(yours.on!.onAppear).toBe("checkPerms");
    expect(Object.keys(s.actions)).toEqual(expect.arrayContaining(["checkPerms", "askPush", "askMic", "allowBoth", "syncAll", "finish", "finishOk", "finishErr"]));
    const keyboard = panesOf(s).find((c) => c.id === "keyboard") as N;
    const watcher = find(keyboard, (n) => n.visibleIf?.truthy === "keyboardReady")[0]!;
    expect(watcher.on!.onAppear.actions.at(-1)).toEqual({ kind: "setState", path: "step", value: 3 });
  });

  it("Languages saves as they are tapped, and Continue asks for the screen again in the first language chosen", () => {
    const s = screen();
    const langs = panesOf(s).find((c) => c.id === "languages") as N;
    const chips = find(langs, (n) => JSON.stringify(n.on ?? {}).includes("toggleInArray"));
    expect(chips.length).toBe(DAILY_LANGUAGES.filter((l) => l.india || l.value === "en").length);
    for (const c of chips) expect(JSON.stringify(c.on)).toContain('"path":"/v1/personality"');
    const cont = find(langs, (n) => JSON.stringify(n.on ?? {}).includes('"refresh"'))[0]!;
    expect(cont.on!.onPress.actions.map((a: any) => a.kind)).toEqual(["callEndpoint", "condition", "refresh"]);
  });

  it("starts where the person is: Welcome for a new one, past what is done for one who has been here", () => {
    const I = { welcome: 0, languages: 1, keyboard: 2, try: 3, yours: 4, done: 5 };
    expect(storeStart({ languagesSet: false, keyboardReady: false, I })).toBe(0);
    expect(storeStart({ languagesSet: false, keyboardReady: true, I })).toBe(0);
    expect(storeStart({ languagesSet: true, keyboardReady: false, I })).toBe(2);
    expect(storeStart({ languagesSet: true, keyboardReady: true, I })).toBe(3);
    expect(screen().state.step).toBe(0);
    expect(screen({ personality: { languages: ["en"] } }).state.step).toBe(2);
    expect(screen({ personality: { languages: ["en"] }, keyboardReady: true }).state.step).toBe(3);
  });

  it("Try it is a tap to start and a tap to stop, and says so; it does not promise a hold", () => {
    const s = screen();
    const text = JSON.stringify(panesOf(s).find((c) => c.id === "try"));
    for (const k of ["st.p", "st.tap", "st.live", "st.again"] as const) expect(text, k).toContain(JSON.stringify(OB_STORE_EN[k]).slice(1, -1));
    for (const k of ["s4.hold", "s4.again", "s4.p"] as const) expect(text, k).not.toContain(JSON.stringify(OB_EN[k]).slice(1, -1));
    const mics = find(s.root, (n) => n.type === "VoiceButton");
    expect(mics).toHaveLength(2);
    for (const m of mics) {
      expect(m.bind).toEqual({ value: "tried" });
      expect(m.props!.hold).toBeUndefined();
      expect(m.on!.onError.message).toBe(OB_EN["s4.err"]);
    }
  });

  it("one Blip at a time in a pane: the pose follows what has happened", () => {
    const s = screen({ can: withUrl });
    const pane = (id: string) => panesOf(s).find((c) => c.id === id) as N;
    const blips = (id: string, st: any): string[] => {
      const out: string[] = [];
      const at = stepIds(s).indexOf(id);
      shown(pane(id), { ...st, step: at }, (n) => { if (BLIP(n)) out.push(String(n.props!.source.url).replace(/^.*\/blip\//, "").replace(/\.webp.*$/, "")); });
      return out;
    };
    const st = { ...s.state };
    expect(blips("welcome", st)).toEqual(["wave-l"]);
    expect(blips("languages", st)).toEqual(["listen-s"]);
    expect(blips("keyboard", st)).toEqual(["tap-s"]);
    expect(blips("try", st)).toEqual(["present-s"]);
    expect(blips("try", { ...st, tried: "Haan bhai, 5 minute mein aa raha hoon." })).toEqual(["tada-s"]);
    expect(blips("yours", st)).toEqual(["pointd-s"]);
    expect(blips("yours", { ...st, perm: { all: true, n: true, m: true } })).toEqual(["thumbs-s"]);
    expect(blips("apps", st)).toEqual(["carry-s"]);
    expect(blips("careful", st)).toEqual(["think-s"]);
    expect(blips("done", st)).toEqual(["tada-l"]);
  });

  it("a pane fetches the next one's Blip while it is shown, and never one of its own twice", () => {
    const s = screen({ can: withUrl });
    const panes = panesOf(s);
    panes.forEach((p, i) => {
      const hidden = find(p, (n) => n.type === "Image" && n.style?.position === "absolute");
      const mine = new Set(find(p, BLIP).map((n) => n.props!.source.url));
      const next = i + 1 < panes.length ? new Set(find(panes[i + 1]!, BLIP).map((n) => n.props!.source.url)) : new Set<string>();
      expect(new Set(hidden.map((n) => n.props!.source.url)), p.id).toEqual(new Set([...next].filter((u) => !mine.has(u))));
      for (const h of hidden) { expect(h.style!.width).toBe(1); expect(h.style!.opacity).toBe(0); }
    });
  });

  it("is built from the stage's own words: nothing is said here that onboard.ts does not say, but four lines", () => {
    const s = screen({ can: withUrl });
    const said = new Set<string>();
    each(s.root, (n) => { for (const k of ["content", "label", "stopLabel", "transcribingLabel"]) if (typeof n.props?.[k] === "string") said.add(n.props[k]); });
    const ours = new Set<string>([...Object.values(OB_EN), ...Object.values(OB_STORE_EN)]);
    const strays = [...said].filter((t) => t && !ours.has(t) && !/^[•+›\d]/.test(t));
    // What is left is the apps' own words and the shared table's (names, "Connect", "Connected"), not ours.
    expect(strays.every((t) => CATALOG.some((c) => t.includes(c.name) || c.oneLine === t) || /^(Connect|Connected|See all|More apps|Suggested|[A-Z])/.test(t) || t.length < 14 || t.includes("AI model")), strays.join(" | ")).toBe(true);
    for (const k of ["s1.h", "s2.h", "s3.h", "s4.h", "s5.h", "s6.h", "s7.h", "s8.h"] as const) expect(said, k).toContain(OB_EN[k]);
    for (const k of Object.keys(OB_STORE_EN) as Array<keyof typeof OB_STORE_EN>) expect(OB_STORE_HG[k].trim(), k).not.toBe("");
    expect(Object.keys(OB_STORE_HG).sort()).toEqual(Object.keys(OB_STORE_EN).sort());
    expect(onboardHinglishSeeds().get(OB_STORE_EN["st.tap"])).toBe(OB_STORE_HG["st.tap"]);
    expect(OB_HG["s1.cta"]).toBeTruthy();
  });
});

describe("Blip's pictures", () => {
  const dir = path.join(process.cwd(), "blip");
  const webp = (name: string) => {
    const b = fs.readFileSync(path.join(dir, `${name}.webp`));
    const chunks: Array<{ id: string; at: number; size: number }> = [];
    for (let at = 12; at + 8 <= b.length;) {
      const size = b.readUInt32LE(at + 4);
      chunks.push({ id: b.toString("ascii", at, at + 4), at, size });
      at += 8 + size + (size % 2);
    }
    const x = chunks.find((c) => c.id === "VP8X")!;
    const anim = chunks.find((c) => c.id === "ANIM");
    return {
      bytes: b.length,
      riff: b.toString("ascii", 0, 4) + b.toString("ascii", 8, 12),
      flags: b[x.at + 8]!,
      w: 1 + (b[x.at + 12]! | (b[x.at + 13]! << 8) | (b[x.at + 14]! << 16)),
      h: 1 + (b[x.at + 15]! | (b[x.at + 16]! << 8) | (b[x.at + 17]! << 16)),
      loops: anim ? b.readUInt16LE(anim.at + 8 + 4) : -1,
      frames: chunks.filter((c) => c.id === "ANMF").length,
      durations: chunks.filter((c) => c.id === "ANMF").map((c) => b[c.at + 8 + 12]! | (b[c.at + 8 + 13]! << 8) | (b[c.at + 8 + 14]! << 16)),
    };
  };

  it("a loop per pose a step takes, each animated, transparent, looping forever, and small", () => {
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".webp")).sort()).toEqual(BLIP_LOOPS.map((l) => `${l}.webp`).sort());
    expect(Object.keys(BLIP_BUILD.files).sort()).toEqual([...BLIP_LOOPS].sort());
    for (const loop of BLIP_LOOPS) {
      const w = webp(loop);
      expect(w.riff, loop).toBe("RIFFWEBP");
      expect(w.flags & 0x02, `${loop} animated`).toBe(0x02);
      expect(w.flags & 0x10, `${loop} has alpha`).toBe(0x10);
      expect(w.loops, `${loop} loops forever`).toBe(0);
      expect(w.frames, loop).toBe(BLIP_BUILD.frames);
      // The loop is BLIP_LOOP_MS long: its frames add up to it.
      expect(w.durations.reduce((a, b) => a + b, 0), loop).toBe(BLIP_LOOP_MS);
      // Small: under about 150 KB.
      expect(w.bytes, loop).toBeLessThanOrEqual(154_000);
      expect(w.bytes, loop).toBe(BLIP_BUILD.files[loop]!.bytes);
      // Laid out at the size it was cut at: its pixels are twice the points.
      expect([w.w, w.h], loop).toEqual([blipSize(loop).w * 2, blipSize(loop).h * 2]);
    }
    const total = BLIP_LOOPS.reduce((n, l) => n + BLIP_BUILD.files[l]!.bytes, 0);
    expect(total).toBeLessThan(1_100_000);
  });

  it("every size class is one box, so a step can swap one pose for another without him moving", () => {
    for (const size of ["s", "l"] as const) {
      const boxes = new Set(BLIP_LOOPS.filter((l) => l.endsWith(`-${size}`)).map((l) => `${blipSize(l).w}x${blipSize(l).h}`));
      expect(boxes.size, size).toBe(1);
      // …and the box holds him: taller than he is, at the height he is drawn.
      const [, h] = [...boxes][0]!.split("x").map(Number);
      expect(h!, size).toBeGreaterThan(BLIP_HEIGHT[size]);
    }
  });

  it("the screen draws each at that size, from the URL the server serves, with the version in it", () => {
    for (const [, s] of SCREENS) {
      // The apps' logos are the other Images here (appIcons.ts; app-icons.test.ts holds them down).
      for (const img of find(s.root, (n) => n.type === "Image" && !String(n.props?.source?.url).includes("/icons/"))) {
        const url = String(img.props!.source.url);
        const loop = /\/blip\/([\w-]+)\.webp\?v=(\d+)$/.exec(url);
        expect(loop, url).not.toBeNull();
        expect(BLIP_LOOPS).toContain(loop![1]);
        expect(Number(loop![2])).toBe(BLIP_BUILD.v);
        expect(url).toBe(blipUrl(loop![1] as never));
        if (img.style!.position !== "absolute") expect([img.style!.width, img.style!.height]).toEqual([blipSize(loop![1] as never).w, blipSize(loop![1] as never).h]);
        // An Image rounds itself unless told not to.
        expect(img.style!.borderRadius).toBe(0);
      }
    }
  });
});

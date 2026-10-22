/**
 * THE NEW ONBOARDING, SERVER SIDE (experience/onboard.ts).
 *
 * What these hold down, in the order the spec lists them:
 *   - who gets it: only a build that declared both OnboardStage and BlipSpot,
 *     and only while ONBOARD_V2 is on; everyone else is served what they were;
 *   - the screen `onboard`, its steps per platform, and the progress total
 *     both stages agree on;
 *   - exactly one Blip stands in a step at any moment;
 *   - every move of the stage is to a step that exists, and goes forward;
 *   - the sign-in tree keeps everything the sign-in flow needs;
 *   - the words say only what the product does (How careful especially);
 *   - the language chips save as they are tapped.
 * The Hinglish lines are in onboard-words.test.ts, which has to stand in for
 * the translator.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const T = {
  fresh: "test-onboard-fresh-0123456789",
  langs: "test-onboard-langs-0123456789",
  done: "test-onboard-done-01234567890",
  review: "test-onboard-review-0123456789",
  legacy: "test-onboard-legacy-012345678",
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

// The reviewer is a user the server knows by id, and a static token's id is
// derived from the token, so ask for it before the config is read for good.
const { resolveUser } = await import("../src/auth/supabase.js");
process.env.REVIEW_USER_IDS = (await resolveUser(`Bearer ${T.review}`))!.id;
const { resetConfigForTests } = await import("../src/config.js");
resetConfigForTests();

const { buildApp } = await import("../src/server.js");
const { buildBootstrap, buildScreen, DAILY_LANGUAGES, POLICY } = await import("../src/experience/catalog.js");
const { OB_EN, OB_HG, canOnboard, onboardAuthTree, onboardLanguage, onboardStart, onboardTotal } = await import("../src/experience/onboard.js");
const { PRIVACY_POLICY_HTML } = await import("../src/routes/policies/privacy.js");
const { gate } = await import("../src/connectors/risk.js");
const { EN: ASSISTANT_EN } = await import("../src/connectors/words.js");

// ---------------------------------------------------------------------------
// A small reader for the trees: walk them, and decide a condition the way the
// apps do, so a test can ask "what is on screen when …".
// ---------------------------------------------------------------------------

type N = {
  type: string; props?: Record<string, any>; style?: Record<string, any>; children?: N[];
  visibleIf?: any; on?: Record<string, any>; bind?: Record<string, string>; fallback?: N;
};
const BOTH = ["OnboardStage", "BlipSpot"];
const get = (st: any, path: string) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), st);

function holds(c: any, st: any, flags: Record<string, unknown> = {}): boolean {
  if (!c) return true;
  if ("eq" in c) return get(st, c.eq[0]) === c.eq[1];
  if ("in" in c) return c.in[1].includes(get(st, c.in[0]));
  if ("truthy" in c) return !!get(st, c.truthy);
  if ("falsy" in c) return !get(st, c.falsy);
  if ("not" in c) return !holds(c.not, st, flags);
  if ("all" in c) return c.all.every((x: any) => holds(x, st, flags));
  if ("any" in c) return c.any.some((x: any) => holds(x, st, flags));
  if ("contains" in c) {
    const v = get(st, c.contains[0]);
    return Array.isArray(v) ? v.includes(c.contains[1]) : String(v ?? "").includes(c.contains[1]);
  }
  if ("flag" in c) return !!flags[c.flag];
  throw new Error(`a condition this reader does not know: ${JSON.stringify(c)}`);
}

function each(n: N, f: (n: N) => void): void {
  f(n);
  for (const c of n.children ?? []) each(c, f);
}
const find = (n: N, pred: (n: N) => boolean): N[] => { const out: N[] = []; each(n, (x) => { if (pred(x)) out.push(x); }); return out; };

/** The Blips on screen in a step, given the state and (for the sign-in tree) the flow's phase. */
function spotsOn(n: N, st: any, phase?: string): N[] {
  if (!holds(n.visibleIf, st)) return [];
  if (n.type === "AuthPhase" && !(n.props?.phases ?? []).includes(phase)) return [];
  if (n.type === "BlipSpot") return [n];
  return (n.children ?? []).flatMap((c) => spotsOn(c, st, phase));
}

/** Every `{kind: "setState", path: "step"}` inside any JSON, wherever it hides. */
function stepMoves(json: unknown): number[] {
  const out: number[] = [];
  const walk = (x: any): void => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.kind === "setState" && x.path === "step") out.push(x.value);
    Object.values(x).forEach(walk);
  };
  walk(json);
  return out;
}

// ---------------------------------------------------------------------------

const notion = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, category: "Docs", oneLine: `${name} does things.`, auth: "oauth", connected: false, level: "send", auto: [], ...extra });
const APPS = [
  notion("notion", "Notion"), notion("linear", "Linear"), notion("github", "GitHub"), notion("atlassian", "Jira and Confluence"),
  notion("asana", "Asana"), notion("zapier", "Zapier", { auth: "url" }), notion("mine", "My app", { custom: true }), notion("trello", "Trello"),
];
const ctx = (extra: Record<string, unknown> = {}) => ({
  personality: {}, language: "en", platform: "ios", formFactor: "phone", connectorsOn: true,
  assistant: { apps: APPS, names: {} }, can: new Set(BOTH), ...extra,
}) as never;
const screen = (extra: Record<string, unknown> = {}) => buildScreen("onboard", ctx(extra)) as any;
const STEPS = {
  ios: ["languages", "keyboard", "try", "yours", "apps", "careful", "done"],
  android: ["languages", "keyboard", "try", "yours", "apps", "careful", "done"],
  desktop: ["languages", "try", "apps", "careful", "done"],
};
const stepIds = (s: any): string[] => s.root.children.map((c: N) => c.props!.stepId);

describe("who gets the new onboarding", () => {
  it("only a build that declared both pieces, and only while ONBOARD_V2 is not 0", () => {
    expect(canOnboard(BOTH)).toBe(true);
    expect(canOnboard(new Set(BOTH))).toBe(true);
    expect(canOnboard(["OnboardStage"])).toBe(false);
    expect(canOnboard(["BlipSpot", "Stack"])).toBe(false);
    expect(canOnboard([])).toBe(false);
    expect(canOnboard(undefined)).toBe(false);
    expect(canOnboard("OnboardStage,BlipSpot")).toBe(false);
    process.env.ONBOARD_V2 = "0";
    try {
      expect(canOnboard(BOTH)).toBe(false);
    } finally {
      delete process.env.ONBOARD_V2;
    }
  });

  it("buildBootstrap without it is exactly today's: the old sign-in tree and the old first screens", () => {
    for (const formFactor of ["phone", "desktop"]) {
      const b = buildBootstrap({ onboarded: false, launchCount: 2, formFactor, connectorsOn: true } as never);
      expect(JSON.stringify(b.flags!["auth.screen"])).not.toContain("OnboardStage");
      expect(b.flags!["boot.firstRunGateIds"]).toEqual(["onboarding", "onboarding_keyboard", "onboard"]); // the knob default
    }
    expect(buildBootstrap({ onboarded: false, launchCount: 2 }).initialScreenId).toBe("onboarding");
    expect(buildBootstrap({ onboarded: false, launchCount: 2, micGranted: true }).initialScreenId).toBe("onboarding_keyboard");
    expect(buildBootstrap({ onboarded: false, launchCount: 2, formFactor: "desktop", desk: true } as never).initialScreenId).toBe("desk_today");
  });

  it("buildBootstrap with it: the stage tree, auth on, and onboard first for someone not onboarded", () => {
    const b = (o: Record<string, unknown>) => buildBootstrap({ onboardV2: true, connectorsOn: true, ...o } as never);
    const phone = b({ onboarded: false, launchCount: 1 });
    expect((phone.flags!["auth.screen"] as any).type).toBe("OnboardStage");
    expect(phone.flags!["auth.sdui"]).toBe(true);
    expect(phone.flags!["boot.firstRunGateIds"]).toEqual(["onboarding", "onboarding_keyboard", "onboard"]);
    expect(phone.flags!["onboard.fontWaitMs"]).toBe(600);
    // The intro film would be a second opening; and a phone that already has
    // the microphone and the keyboard still walks the flow (it ends at Done).
    expect(phone.initialScreenId).toBe("onboard");
    expect(b({ onboarded: false, launchCount: 3, micGranted: true, keyboardReady: true }).initialScreenId).toBe("onboard");
    expect(b({ onboarded: false, launchCount: 0 }).initialScreenId).toBe("onboard");
    // A window never had onboarding; now a new one gets it, with the desk behind it.
    expect(b({ onboarded: false, formFactor: "desktop", desk: true }).initialScreenId).toBe("onboard");
    expect(b({ onboarded: false, formFactor: "desktop" }).initialScreenId).toBe("onboard");
    // Onboarded: the app, as ever.
    expect(b({ onboarded: true, formFactor: "desktop", desk: true }).initialScreenId).toBe("desk_today");
    expect(b({ onboarded: true, launchCount: 5 }).initialScreenId).not.toBe("onboard");
    // …except the first launch of an install on a phone that has not granted both.
    expect(b({ onboarded: true, launchCount: 1 }).initialScreenId).toBe("onboard");
    expect(b({ onboarded: true, launchCount: 1, micGranted: true, keyboardReady: true }).initialScreenId).not.toBe("onboard");
    expect(b({ onboarded: true, launchCount: 1, formFactor: "desktop" }).initialScreenId).not.toBe("onboard");
  });

  it("the bar is as long in the sign-in tree as in the screen, on every platform", () => {
    for (const [formFactor, platform, key] of [["phone", "ios", "ios"], ["phone", "android", "android"], ["desktop", "ios", "desktop"]] as const) {
      for (const connectorsOn of [true, false]) {
        const tree = buildBootstrap({ onboardV2: true, formFactor, connectorsOn } as never).flags!["auth.screen"] as any;
        const s = screen({ formFactor, platform, connectorsOn });
        expect(tree.props.of, `${key} ${connectorsOn}`).toBe(s.root.props.of);
        expect(tree.props.first).toBe(0);
        expect(s.root.props.first).toBe(3);
        expect(s.root.props.first + s.root.children.length).toBe(s.root.props.of);
      }
    }
    expect(onboardTotal(false, true)).toBe(10);
    expect(onboardTotal(false, false)).toBe(8);
    expect(onboardTotal(true, true)).toBe(8);
    expect(onboardTotal(true, false)).toBe(6);
  });
});

describe("who gets it, through the server", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const caps = (components: string[], device: Record<string, unknown> = {}) =>
    ({ platform: "ios", appVersion: "1.0.0", googleWeb: true, components, device: { width: 390, height: 844, ...device } });
  const boot = async (token: string, components: string[], device: Record<string, unknown> = {}, launchCount = 2) => {
    const r = await app.inject({ method: "POST", url: "/v1/app/bootstrap", headers: auth(token), payload: { launchCount, capabilities: caps(components, device) } });
    expect(r.statusCode).toBe(200);
    return r.json();
  };
  const DESK = { formFactor: "desktop", os: "mac" };

  it("an old build, or one with half the pieces, or ONBOARD_V2=0, is served what it always was", async () => {
    const today = JSON.stringify(buildBootstrap({ onboarded: false, launchCount: 2 }).flags!["auth.screen"]);
    for (const components of [[], ["OnboardStage"], ["BlipSpot"], ["Stack", "Text"]]) {
      const b = await boot(T.fresh, components);
      expect(JSON.stringify(b.flags["auth.screen"]), components.join()).not.toContain("OnboardStage");
      expect(b.initialScreenId).toBe("onboarding");
    }
    // The server's tree is the same bytes as the pure one (the request adds nothing to it).
    expect(JSON.stringify((await boot(T.fresh, [])).flags["auth.screen"])).toBe(today);
    process.env.ONBOARD_V2 = "0";
    try {
      const off = await boot(T.fresh, BOTH);
      expect(JSON.stringify(off.flags["auth.screen"])).not.toContain("OnboardStage");
      expect(off.initialScreenId).toBe("onboarding");
    } finally {
      delete process.env.ONBOARD_V2;
    }
  });

  it("a build with both pieces gets the stage tree and onboard, a phone and a window", async () => {
    const phone = await boot(T.fresh, BOTH);
    expect(phone.flags["auth.screen"].type).toBe("OnboardStage");
    expect(phone.flags["auth.sdui"]).toBe(true);
    expect(phone.initialScreenId).toBe("onboard");
    expect(phone.flags["boot.firstRunGateIds"]).toContain("onboard");
    // Connected apps are on here, so the bar counts the two apps steps.
    expect(phone.flags["auth.screen"].props.of).toBe(10);

    const desk = await boot(T.fresh, [...BOTH, "DeskShell"], DESK);
    expect(desk.flags["auth.screen"].props.of).toBe(8);
    expect(desk.initialScreenId).toBe("onboard");
    // …and the window's sign-in has Apple on a Mac and not elsewhere.
    expect(JSON.stringify(desk.flags["auth.screen"])).toContain("AppleSignIn");
    const win = await boot(T.fresh, [...BOTH, "DeskShell"], { formFactor: "desktop", os: "windows" });
    expect(JSON.stringify(win.flags["auth.screen"])).not.toContain("AppleSignIn");
  });

  it("onboarded people, and the reviewer, go straight in", async () => {
    expect((await app.inject({ method: "PUT", url: "/v1/profile", headers: auth(T.done), payload: { onboarded: true } })).statusCode).toBe(200);
    for (const token of [T.done, T.review]) {
      const phone = await boot(token, BOTH);
      expect(phone.initialScreenId, token).not.toBe("onboard");
      expect(phone.initialScreenId).not.toBe("onboarding");
      expect((await boot(token, [...BOTH, "DeskShell"], DESK)).initialScreenId, token).toBe("desk_today");
    }
    // Even the first launch of an install on a phone with nothing granted: the reviewer has a checklist.
    expect((await boot(T.review, BOTH, {}, 1)).initialScreenId).not.toBe("onboard");
  });

  it("the device's microphone and keyboard no longer mark anyone onboarded; the flow ends at Done", async () => {
    const granted = { micGranted: true, keyboardReady: true };
    const profile = async (token: string) => (await app.inject({ method: "GET", url: "/v1/profile", headers: auth(token) })).json();
    const b = await boot(T.langs, BOTH, granted, 3);
    expect(b.initialScreenId).toBe("onboard");
    await new Promise((r) => setTimeout(r, 30));
    expect((await profile(T.langs)).onboarded).toBe(false);
    // A build that cannot draw it keeps the old shortcut: nothing to ask, so it is marked.
    const old = await boot(T.legacy, [], granted, 3);
    expect(old.initialScreenId).not.toBe("onboard");
    for (let i = 0; i < 20 && !(await profile(T.legacy)).onboarded; i++) await new Promise((r) => setTimeout(r, 20));
    expect((await profile(T.legacy)).onboarded).toBe(true);
  });

  const askScreen = async (token: string, components: string[], device: Record<string, unknown> = {}) => {
    const r = await app.inject({ method: "POST", url: "/v1/app/screen", headers: auth(token), payload: { screenId: "onboard", capabilities: caps(components, device) } });
    expect(r.statusCode).toBe(200);
    return r.json();
  };

  it("the screen: seven steps on a phone with the apps read from the server, five in a window", async () => {
    const phone = await askScreen(T.fresh, BOTH, { locale: "en-IN" });
    expect(phone.screenId).toBe("onboard");
    expect(stepIds(phone)).toEqual(STEPS.ios);
    expect(phone.root.props.of).toBe(10);
    // The five tiles are the catalog's own apps that sign in: Zapier takes a link.
    expect(phone.state.n).toEqual({ notion: "Notion", linear: "Linear", github: "GitHub", atlassian: "Jira and Confluence", asana: "Asana" });
    expect(phone.state.langs).toEqual(["hinglish", "hi", "en"]);
    expect(phone.state.step).toBe(0);

    const desk = await askScreen(T.fresh, [...BOTH, "DeskShell"], DESK);
    expect(stepIds(desk)).toEqual(STEPS.desktop);
    expect(desk.root.props.of).toBe(8);
    expect(desk.actions.finishOk.actions[1]).toEqual({ kind: "switchTab", tabId: "desk_today" });
  });

  it("a build that does not declare both pieces is given today's first step, never an empty answer", async () => {
    for (const components of [[], ["OnboardStage"], ["BlipSpot"]]) {
      const s = await askScreen(T.fresh, components);
      expect(s.screenId).toBe("onboarding");
    }
  });

  it("a cold start lands past what is done: languages saved, keyboard ready", async () => {
    const put = await app.inject({ method: "PUT", url: "/v1/personality", headers: auth(T.langs), payload: { languages: ["en"] } });
    expect(put.statusCode).toBe(200);
    const ready = await askScreen(T.langs, BOTH, { keyboardReady: true, locale: "en-US" });
    expect(ready.state.langs).toEqual(["en"]);
    expect(ready.state.step).toBe(STEPS.ios.indexOf("try"));
    const notYet = await askScreen(T.langs, BOTH, { keyboardReady: false });
    expect(notYet.state.step).toBe(STEPS.ios.indexOf("keyboard"));
    const desk = await askScreen(T.langs, [...BOTH, "DeskShell"], DESK);
    expect(desk.state.step).toBe(STEPS.desktop.indexOf("try"));
  });
});

describe("the screen", () => {
  it("has the steps of its platform, and the bar counts them", () => {
    for (const [extra, key, of] of [
      [{ platform: "ios" }, "ios", 10],
      [{ platform: "android" }, "android", 10],
      [{ formFactor: "desktop" }, "desktop", 8],
    ] as const) {
      const s = screen(extra);
      expect(s.screenId).toBe("onboard");
      expect(stepIds(s), key).toEqual(STEPS[key]);
      expect(s.root.type).toBe("OnboardStage");
      expect(s.root.props.of, key).toBe(of);
      expect(s.root.props.id).toBe("onboard");
      expect(s.hideChrome).toBe(true);
      expect(s.cacheTtlSeconds).toBe(0);
    }
  });

  it("leaves out Connect apps and How careful when connected apps are off, or there is nothing to connect", () => {
    for (const [extra, key, of] of [[{}, "ios", 8], [{ formFactor: "desktop" }, "desktop", 6]] as const) {
      for (const off of [{ connectorsOn: false }, { assistant: undefined }, { assistant: { apps: [APPS[5], APPS[6]], names: {} } }]) {
        const s = screen({ ...extra, ...off });
        expect(stepIds(s)).toEqual(STEPS[key].filter((id) => id !== "apps" && id !== "careful"));
        expect(s.root.props.of).toBe(of);
        // Nothing in the words promises what is not there.
        expect(JSON.stringify(s)).not.toContain(OB_EN["s8.try"]);
        expect(JSON.stringify(s)).toContain(OB_EN["s8.try0"]);
        expect(JSON.stringify(s)).toContain(OB_EN["s8.fine0"]);
      }
    }
    expect(JSON.stringify(screen())).toContain(OB_EN["s8.try"]);
  });

  it("without both pieces it is today's first step, under its own id", () => {
    for (const can of [new Set<string>(), new Set(["OnboardStage"]), new Set(["BlipSpot"])]) {
      expect(buildScreen("onboard", ctx({ can }))!.screenId).toBe("onboarding");
    }
    process.env.ONBOARD_V2 = "0";
    try {
      expect(buildScreen("onboard", ctx())!.screenId).toBe("onboarding");
    } finally {
      delete process.env.ONBOARD_V2;
    }
  });

  it("keeps every line as written: the capitalising pass leaves the tree and its toasts alone", () => {
    const s = screen();
    expect(s.root.props.keepCase).toBe(true);
    const text = JSON.stringify(s);
    for (const line of [OB_EN["s2.h"], OB_EN["s3.wp"], OB_EN["s5.blocked"], OB_EN["s5.off"], OB_EN["ob.err.finish"], OB_EN["c2.p"]]) {
      expect(text, line).toContain(JSON.stringify(line).slice(1, -1));
    }
    expect(s.actions.finishErr.message).toBe(OB_EN["ob.err.finish"]);
  });

  it("states are the stage's: the step, the languages, and the device facts the app overwrites", () => {
    const st = screen().state;
    expect(st).toMatchObject({ step: 0, langs: ["en"], keyboardReady: false, keyboardEnabled: false, micGranted: false, mic: "idle", tried: "", perm: { all: false, n: false, m: false }, link: {} });
    expect(Object.keys(st.sheet)).toEqual(["notion", "linear", "github", "atlassian", "asana"]);
    expect(screen({ locale: "hi-IN" }).state.langs).toEqual(["hinglish", "hi", "en"]);
    expect(screen({ locale: "en-GB" }).state.langs).toEqual(["en"]);
    expect(screen({ personality: { languages: ["ta", "en"] } }).state.langs).toEqual(["ta", "en"]);
  });
});

describe("exactly one Blip stands in a step", () => {
  const base = { mic: "idle", tried: "", perm: { all: false, n: false, m: false }, keyboardReady: false, langs: ["en"] };

  it("on every step, in every state the step can be in", () => {
    for (const [extra, key] of [[{}, "ios"], [{ platform: "android" }, "android"], [{ formFactor: "desktop" }, "desktop"]] as const) {
      const s = screen(extra);
      s.root.children.forEach((step: N, i: number) => {
        const id = STEPS[key][i]!;
        const states: any[] = [base];
        if (id === "try") {
          states.length = 0;
          for (const mic of ["idle", "recording", "busy"]) for (const tried of ["", "x"]) states.push({ ...base, mic, tried });
        }
        if (id === "yours") {
          states.length = 0;
          for (const n of [false, true]) for (const m of [false, true]) states.push({ ...base, perm: { all: n && m, n, m } });
        }
        for (const st of states) expect(spotsOn(step, st).length, `${key} ${id} ${JSON.stringify(st)}`).toBe(1);
        // A spot that can never show would be a pose nobody sees.
        const all = find(step, (n) => n.type === "BlipSpot");
        for (const spot of all) {
          expect(states.some((st) => spotsOn(step, st).includes(spot)), `${key} ${id} ${spot.props!.say}`).toBe(true);
        }
      });
    }
  });

  it("Try it: the pose follows the mic, and a good try ends in confetti", () => {
    const step = screen().root.children[STEPS.ios.indexOf("try")] as N;
    const pose = (mic: string, tried: string) => spotsOn(step, { ...base, mic, tried })[0]!.props!;
    expect(pose("idle", "")).toMatchObject({ pose: "present", say: OB_EN["s4.say"] });
    expect(pose("recording", "")).toMatchObject({ pose: "listen", say: OB_EN["s4.say1"] });
    expect(pose("busy", "")).toMatchObject({ pose: "listen" });
    expect(pose("idle", "hello")).toMatchObject({ pose: "tada", say: OB_EN["s4.say2"], burst: true });
  });

  it("the sign-in tree: Welcome and Sign in always, Code by the flow's phase", () => {
    const tree = onboardAuthTree({ connectorsOn: true }) as unknown as N;
    const [welcome, signin, code] = tree.children!;
    expect(spotsOn(welcome!, {}).length).toBe(1);
    expect(spotsOn(signin!, {}).length).toBe(1);
    expect(spotsOn(code!, {}, "verify").map((s) => s.props!.pose)).toEqual(["wait"]);
    expect(spotsOn(code!, {}, "verifying").map((s) => s.props!.pose)).toEqual(["nod"]);
    // Between the two (entry, sending) the flow shows the stored step, never Code.
    expect(spotsOn(code!, {}, "entry")).toEqual([]);
    expect(tree.props!.phaseStep).toEqual({ verify: 2, verifying: 2 });
  });

  it("sizes the box the way the stage expects: a side bubble pulls Blip into the text", () => {
    const spot = (find(screen().root, (n) => n.type === "BlipSpot" && n.props!.say === OB_EN["s2.say"])[0])!;
    expect(spot.props).toMatchObject({ pose: "listen", h: 104, bubble: "side" });
    expect(spot.style).toEqual({ marginLeft: -25, marginRight: -17 });
    const corner = find(screen().root, (n) => n.type === "BlipSpot" && n.props!.bubble === "corner")[0]!;
    expect(corner.style).toEqual({});
  });
});

describe("the stage only moves to steps that exist, and forward", () => {
  it("every move is in range, never backward, and the nearest forward move is the next step", () => {
    for (const [extra, key] of [[{}, "ios"], [{ platform: "android" }, "android"], [{ formFactor: "desktop" }, "desktop"], [{ connectorsOn: false }, "ios"]] as const) {
      const s = screen(extra);
      const count = s.root.children.length;
      const all = stepMoves(s);
      for (const v of all) expect(Number.isInteger(v) && v >= 0 && v < count, `${key} ${v}`).toBe(true);
      const reach = new Set<number>([0]);
      s.root.children.forEach((step: N, i: number) => {
        const moves = stepMoves(step);
        for (const v of moves) expect(v, `${key} step ${i} goes to ${v}`).toBeGreaterThan(i);
        if (i < count - 1) {
          expect(Math.min(...moves), `${key} step ${i} has a way forward`).toBe(i + 1);
          moves.forEach((v) => reach.add(v));
        } else {
          expect(moves).toEqual([]);
        }
      });
      expect(reach.size, `${key} every step can be reached`).toBe(count);
      // The last step's button runs finish, and finish saves onboarded.
      const last = s.root.children[count - 1] as N;
      const cta = find(last, (n) => n.on?.onPress === "finish");
      expect(cta.length).toBe(1);
      expect(s.actions.finish).toMatchObject({ kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { onboarded: true }, onSuccess: "finishOk", onError: "finishErr" });
      expect(s.actions.finishOk.actions[0]).toEqual({ kind: "haptic", style: "success" });
      expect(s.actions.finishErr).toMatchObject({ kind: "toast", tone: "error" });
    }
  });

  it("Done lands a phone on You, a window on the desk, and a plain window on its first tab", () => {
    const tab = (s: any) => s.actions.finishOk.actions[1];
    expect(tab(screen())).toEqual({ kind: "switchTab", tabId: "personality" });
    expect(tab(screen({ formFactor: "desktop", can: new Set([...BOTH, "DeskShell"]) }))).toEqual({ kind: "switchTab", tabId: "desk_today" });
    const plain = tab(screen({ formFactor: "desktop" }));
    expect(plain).toEqual({ kind: "switchTab", tabId: (buildBootstrap({}).navigation as any).tabs[0].id });
  });

  it("every action the tree names by string is in the table", () => {
    for (const extra of [{}, { formFactor: "desktop" }]) {
      const s = screen(extra);
      const named = new Set<string>();
      const REFS = ["onPress", "onChange", "onAppear", "onSuccess", "onError", "onGranted", "onDenied", "onBlocked", "then", "else"];
      const walk = (x: any, key = ""): void => {
        if (!x || typeof x !== "object") return;
        if (Array.isArray(x)) { x.forEach((a) => (typeof a === "string" ? (key === "actions" && named.add(a)) : walk(a))); return; }
        for (const [k, v] of Object.entries(x)) {
          // Conditions and styles have `then`/`else` of their own, with colours in them.
          if (k === "style" || k === "visibleIf" || k === "bind") continue;
          if (typeof v === "string") { if (REFS.includes(k)) named.add(v); } else walk(v, k);
        }
      };
      walk(s.root); walk(s.actions);
      for (const name of named) expect(s.actions, name).toHaveProperty(name);
    }
  });

  it("the sign-in tree moves once: Welcome to Sign in", () => {
    const tree = onboardAuthTree({ connectorsOn: true }) as unknown as N;
    expect(stepMoves(tree.children![0])).toEqual([1]);
    expect(stepMoves(tree.children![1])).toEqual([]);
    expect(stepMoves(tree.children![2])).toEqual([]);
    expect(tree.children!.map((c) => c.props!.stepId)).toEqual(["welcome", "signin", "code"]);
  });

  it("onboardStart picks the next thing still missing", () => {
    const phone = Object.fromEntries(STEPS.ios.map((id, i) => [id, i]));
    const desk = Object.fromEntries(STEPS.desktop.map((id, i) => [id, i]));
    for (const keyboardReady of [false, true]) {
      expect(onboardStart({ desktop: false, languagesSet: false, keyboardReady, I: phone })).toBe(phone.languages);
      expect(onboardStart({ desktop: true, languagesSet: false, keyboardReady, I: desk })).toBe(desk.languages);
      expect(onboardStart({ desktop: true, languagesSet: true, keyboardReady, I: desk })).toBe(desk.try);
    }
    expect(onboardStart({ desktop: false, languagesSet: true, keyboardReady: false, I: phone })).toBe(phone.keyboard);
    expect(onboardStart({ desktop: false, languagesSet: true, keyboardReady: true, I: phone })).toBe(phone.try);
    // With the apps steps out the indexes shift and the answer follows.
    const short = { languages: 0, keyboard: 1, try: 2, yours: 3, done: 4 };
    expect(onboardStart({ desktop: false, languagesSet: true, keyboardReady: true, I: short })).toBe(2);
  });
});

describe("the sign-in tree keeps what the flow needs", () => {
  const tree = (o: Record<string, unknown> = {}) => onboardAuthTree({ connectorsOn: true, ...o }) as unknown as N;
  const signin = (o: Record<string, unknown> = {}) => tree(o).children![1]!;

  it("an email field with its button, and the phone field only when the backend turns it on", () => {
    const step = signin();
    const pills = find(step, (n) => n.type === "SwipePill");
    const email = pills.find((p) => p.props!.method === "email")!;
    expect(email.props).toMatchObject({ variant: "field", placeholder: OB_EN["si.em"], submitLabel: OB_EN["si.email"], buttonHeight: 48 });
    const phone = pills.find((p) => p.props!.method === "phone")!;
    expect(phone.props).toMatchObject({ variant: "field", submitLabel: OB_EN["si.phone"], presetCountry: "IN", dial: "+91" });
    // Under the backend's own switch, together with its "or".
    const wrapper = find(step, (n) => !!n.children?.includes(phone))[0]!;
    expect(wrapper.visibleIf).toEqual({ flag: "auth.enablePhone" });
    expect(email).not.toBe(phone);
    expect(find(wrapper, (n) => n.type === "SwipePill").length).toBe(1);
  });

  it("Google and Apple: wide buttons, each dropped when it must be", () => {
    const has = (o: Record<string, unknown>, type: string) => find(signin(o), (n) => n.type === type);
    expect(has({}, "GoogleSignIn")[0]!.style).toEqual({ width: "100%" });
    expect(has({}, "GoogleSignIn")[0]!.props).toMatchObject({ label: OB_EN["si.google"], size: 48, radius: 16 });
    expect(has({}, "GoogleSignIn")[0]!.children!.length).toBe(1);
    expect(has({}, "AppleSignIn")[0]!.props).toMatchObject({ label: OB_EN["si.apple"], buttonType: "CONTINUE", buttonStyle: "WHITE_OUTLINE" });
    expect(has({ googleHidden: true }, "GoogleSignIn")).toEqual([]);
    expect(has({ appleHidden: true }, "AppleSignIn")).toEqual([]);
    expect(has({ appleHidden: true }, "GoogleSignIn").length).toBe(1);
    // The old Android bundle's bridge: a link to Supabase's sign-in, tapped, noted, opened.
    const link = "https://example.supabase.co/auth/v1/authorize?provider=google";
    const bridged = signin({ googleHidden: true, googleLink: link });
    expect(find(bridged, (n) => n.type === "GoogleSignIn")).toEqual([]);
    const open = JSON.stringify(bridged);
    expect(open).toContain(JSON.stringify({ kind: "openUrl", url: link, external: true }));
    expect(open).toContain('"googleStarted"');
    // Neither social button: no "or" hanging from the top; the one between email and phone stays.
    const ors = (o: Record<string, unknown>) => JSON.stringify(signin(o)).split('"content":"or"').length - 1;
    expect(ors({})).toBe(2);
    expect(ors({ googleHidden: true, appleHidden: true })).toBe(1);
  });

  it("the code is entered in boxes, with the words around them", () => {
    for (const desktop of [false, true]) {
      const entry = find(tree({ desktop }).children![2]!, (n) => n.type === "CodeEntry")[0]!;
      expect(entry.props).toMatchObject({
        variant: "boxes", sentTo: OB_EN["cd.p"], okLabel: OB_EN["cd.ok"], failLabel: OB_EN["cd.fail"], resendLabel: OB_EN["cd.resend"],
        wrongLabel: OB_EN["cd.wrong"], wrongEmailLabel: OB_EN["cd.wrongE"], changeLabel: OB_EN["cd.change"],
        waitLabel: OB_EN[desktop ? "cd.wait.d" : "cd.wait"], boxHeight: 60, digitFont: "Tailzu Grotesk", digitSize: 28,
      });
      // The placeholders are the code entry's to fill from the flow.
      expect(entry.props!.sentTo).toContain("{len}");
      expect(entry.props!.sentTo).toContain("{to}");
    }
    // Neither text says the app reads messages or inboxes.
    expect(OB_EN["cd.wait"]).not.toMatch(/looking|reading|your messages/i);
  });

  it("the consent line, with its two links, at the moment of consent", () => {
    const text = JSON.stringify(signin());
    expect(text).toContain(JSON.stringify({ kind: "openUrl", url: POLICY.terms, external: true }));
    expect(text).toContain(JSON.stringify({ kind: "openUrl", url: POLICY.privacy, external: true }));
    expect(text).toContain("Continuing means you agree to our Terms and Privacy Policy.");
    const links = find(signin(), (n) => n.type === "Text" && n.on?.onPress?.kind === "openUrl").map((n) => n.props!.content);
    expect(links).toEqual(["Terms", "Privacy Policy"]);
    // The trust note is there too.
    expect(text).toContain(JSON.stringify(OB_EN["si.trust"]));
  });

  it("the words differ on a window, and Welcome does not promise apps that are not there", () => {
    expect(JSON.stringify(tree({ desktop: true }))).toContain(OB_EN["si.p.d"]);
    expect(JSON.stringify(tree({ desktop: false }))).toContain(OB_EN["si.p"]);
    expect(JSON.stringify(tree({ connectorsOn: true }))).toContain(OB_EN["s1.p"]);
    const noApps = JSON.stringify(tree({ connectorsOn: false }));
    expect(noApps).toContain(OB_EN["s1.p0"]);
    expect(noApps).not.toContain(OB_EN["s1.p"]);
  });

  it("the look travels with the stage, so the bot holds no colours of his own", () => {
    const p = tree().props!;
    expect(p).toMatchObject({
      id: "onboard.auth", first: 0, of: 10, keepCase: true, ground: "#EFEDE8",
      progress: { on: "#1C1A17", height: 4, gap: 4 },
      bubble: { background: "#FCFBF8", ink: "#1C1A17", font: "Tailzu Hand", size: 19, bigSize: 22 },
      blip: { dot: "#F3E2C6", sticker: "#151311", glow: "#39FF14" },
      glide: { slide: 26, outMs: 230, inMs: 320, inDelayMs: 60 },
    });
    const s = screen().root.props;
    for (const k of ["ground", "progress", "bubble", "blip", "glide"]) expect(s[k], k).toEqual(p[k]);
  });
});

describe("the words say only what the product does", () => {
  const trees = () => [
    JSON.stringify(screen()), JSON.stringify(screen({ formFactor: "desktop" })), JSON.stringify(screen({ connectorsOn: false })),
    JSON.stringify(onboardAuthTree({ connectorsOn: true })), JSON.stringify(onboardAuthTree({ connectorsOn: false, desktop: true })),
  ];

  it("nothing promises an undo, Contacts, Calendar, or a start at drafting", () => {
    const everything = [...trees(), ...Object.values(OB_EN), ...Object.values(OB_HG)].join("\n");
    expect(everything).not.toMatch(/undo|wapas lo/i);
    expect(everything).not.toMatch(/contacts|calendar/i);
    expect(everything).not.toMatch(/draft/i);
    expect(everything).not.toMatch(/ask me every time|only before i send|har baar poochho|bhejne se pehle/i);
    // The other half: the sentence that used to say it now says what is true.
    expect(OB_EN["s6.p"]).toContain("before each new kind of change");
  });

  it("How careful says the model: looking runs, a new kind asks once and is remembered, deleting or paying always asks", () => {
    expect(OB_EN["c1.p"]).toMatch(/just do it/i);
    expect(OB_EN["c1.p"]).toMatch(/never changes anything/i);
    expect(OB_EN["c2.p"]).toMatch(/first time/i);
    expect(OB_EN["c2.p"]).toMatch(/remember/i);
    expect(OB_EN["c3.h"]).toMatch(/deleting or paying/i);
    expect(OB_EN["c3.p"]).toMatch(/every/i);
    expect(OB_EN["c3.p"]).toMatch(/no exceptions/i);
    expect(OB_HG["c2.p"]).toMatch(/pehli baar/i);
    expect(OB_HG["c3.p"]).toMatch(/har ek baar/i);
    // The remembering is the middle pill of the middle row: the one that is lit.
    expect(OB_EN["c2.f"].split("|")).toEqual(["Show you", "Your yes", "I remember"]);
  });

  it("the sign-in line promises a code and no selling, not that the number is used for nothing else", () => {
    // The privacy policy (1.6) says the desktop app's account creation sends the
    // email and phone to Meta's Conversions API, hashed, for ad measurement. So
    // "that's all I use it for" is not a thing this line can say.
    expect(PRIVACY_POLICY_HTML).toContain("Conversions API");
    expect(PRIVACY_POLICY_HTML).toContain("SHA-256");
    for (const line of [OB_EN["si.trust"], OB_HG["si.trust"]]) {
      expect(line).not.toMatch(/that.s all|only|nothing else|sirf|bas isi/i);
    }
    expect(OB_EN["si.trust"]).toMatch(/send you a code/i);
    expect(OB_EN["si.trust"]).toMatch(/never sell your number or email/i);
    expect(OB_HG["si.trust"]).toMatch(/kabhi bechta nahi/i);
  });

  it("How careful promises only what approve-once keeps", () => {
    // One yes raises a Can-draft app to Can send (connectors/tasks.ts), so
    // "more careful in one app" cannot point at a level that one yes undoes. The
    // level it points at is Can look, where every change is blocked, so no card
    // ever comes to raise it.
    expect(gate("write", "look", false)).toBe("block");
    expect(gate("send", "look", false)).toBe("block");
    expect(OB_EN["s7.foot"]).toContain(ASSISTANT_EN["lv.look"]);
    expect(OB_EN["s7.foot"]).not.toMatch(/more careful/i);
    // An app added by link keeps its own per-tool choices and never remembers, so
    // the rules are not "the same in every app you connect".
    expect(OB_EN["s7.p"]).not.toMatch(/every app/i);
    expect(OB_HG["s7.p"]).not.toMatch(/har (jude hue )?app/i);
    // The yes covers a message or a post as much as a change, and only in that app.
    expect(OB_EN["c2.p"]).toMatch(/change or message/i);
    expect(OB_EN["c2.p"]).toMatch(/for that app only/i);
    expect(OB_HG["c2.p"]).toMatch(/message/i);
    expect(OB_HG["c2.p"]).toMatch(/usi app/i);
  });

  it("How careful is three rows that explain: nothing in them can be pressed but the button", () => {
    const step = (screen().root.children as N[])[STEPS.ios.indexOf("careful")]!;
    const pressable = find(step, (n) => !!n.on);
    expect(pressable.length).toBe(1);
    expect(pressable[0]!.on!.onPress).toMatchObject({ kind: "setState", path: "step", value: STEPS.ios.indexOf("done") });
    const heads = find(step, (n) => n.type === "Text").map((n) => n.props!.content);
    for (const k of ["c1.h", "c2.h", "c3.h"] as const) expect(heads).toContain(OB_EN[k]);
    // Looking is the first row, a new kind of change the strong middle one, deleting or paying the last.
    const cards = find(step, (n) => n.type === "Stack" && n.style?.borderWidth === 1.5 && n.style?.borderRadius === 18);
    expect(cards.map((c) => c.style!.borderColor)).toEqual(["rgba(28,26,23,0.13)", "#1C1A17", "rgba(28,26,23,0.13)"]);
  });

  it("Make me yours asks for exactly the two things a feature uses", () => {
    const step = (screen().root.children as N[])[STEPS.ios.indexOf("yours")]!;
    const switches = find(step, (n) => n.type === "Switch");
    expect(switches.map((s) => s.bind!.value)).toEqual(["perm.all", "perm.n", "perm.m"]);
    expect(switches.map((s) => s.on!.onChange)).toEqual(["allowBoth", "askPush", "askMic"]);
    expect(step.on).toEqual({ onAppear: "checkPerms" });
    // A yes cannot be taken back inside the app: the switch goes back on and says where to turn it off.
    const a = screen().actions;
    expect(JSON.stringify(a.askPush.else)).toContain(JSON.stringify(OB_EN["s5.off"]));
    expect(JSON.stringify(a.askMic.then.onBlocked)).toContain('"openSettings"');
    expect(a.checkPerms.actions.map((x: any) => x.permission ?? x.kind)).toEqual(["notifications", "microphone", "condition"]);
    // The window has none of it.
    expect(stepIds(screen({ formFactor: "desktop" }))).not.toContain("yours");
    expect(screen({ formFactor: "desktop" }).actions.askPush).toBeUndefined();
  });

  it("Keyboard: the microphone is asked as Settings opens on iOS; Android opens the keyboard settings", () => {
    const cta = (s: any) => find((s.root.children as N[])[1]!, (n) => n.on?.onPress && n.children?.[0]?.props?.content === OB_EN["s3.cta"])[0]!.on!.onPress;
    expect(cta(screen()).actions.map((a: any) => a.kind)).toEqual(["requestPermission", "openUrl"]);
    expect(cta(screen()).actions[0]).toMatchObject({ permission: "microphone" });
    expect(cta(screen()).actions[1]).toEqual({ kind: "openUrl", url: "app-settings:", external: true });
    expect(cta(screen({ platform: "android" }))).toEqual({ kind: "openSettings", target: "keyboard" });
    const text = (s: any) => JSON.stringify((s.root.children as N[])[1]);
    expect(text(screen())).toContain(OB_EN["s3.wh"]);
    expect(text(screen({ platform: "android" }))).not.toContain(OB_EN["s3.wh"]);
    expect(text(screen({ platform: "android" }))).toContain(OB_EN["s3.3a"]);
    // The step moves on by itself the moment the keyboard is ready.
    const watcher = find((screen().root.children as N[])[1]!, (n) => n.visibleIf?.truthy === "keyboardReady");
    expect(watcher.length).toBe(1);
    expect(watcher[0]!.on!.onAppear.actions[0]).toEqual({ kind: "delay", ms: 1100 });
  });
});

describe("every line says how it is drawn, so the app's own type styles never leak in", () => {
  // The apps draw a Text in the dark theme's `body` voice (Light, a 26-point line)
  // and a Paragraph in `paragraph` (the same) before laying a node's style over
  // it, so anything a style leaves out is that voice's.
  const trees = (): Array<[string, N]> => [
    ["phone", screen().root], ["android", screen({ platform: "android" }).root],
    ["window", screen({ formFactor: "desktop" }).root], ["no apps", screen({ connectorsOn: false }).root],
    ["sign-in", onboardAuthTree({ connectorsOn: true }) as unknown as N],
    ["window sign-in", onboardAuthTree({ connectorsOn: false, desktop: true }) as unknown as N],
  ];
  /** Every node, the consent line's fallback and the nodes that only show on a condition included. */
  const walk = (n: N, f: (n: N) => void): void => {
    f(n);
    for (const c of n.children ?? []) walk(c, f);
    if (n.fallback) walk(n.fallback, f);
  };
  const lines = (root: N): N[] => { const out: N[] = []; walk(root, (n) => { if (n.type === "Text" || n.type === "Paragraph") out.push(n); }); return out; };

  it("each Text and Paragraph names its weight and its line height", () => {
    for (const [name, root] of trees()) {
      const all = lines(root);
      expect(all.length, name).toBeGreaterThan(5);
      for (const n of all) {
        const what = `${name}: ${JSON.stringify(n.props?.content ?? n.bind)}`;
        expect(typeof n.style?.lineHeight, `${what} has a line height`).toBe("number");
        expect(n.style!.lineHeight, what).toBeGreaterThan(0);
        // A line in a face of its own has no weight: the weight is the face's file (as the headings).
        if (!n.style!.fontFamily) expect(typeof n.style!.fontWeight, `${what} has a weight`).toBe("string");
        // Never the dark theme's Light.
        expect(n.style!.fontWeight, what).not.toBe("300");
      }
    }
  });

  it("body copy is Regular, and a line is not taller than its size asks for", () => {
    for (const [name, root] of trees()) {
      for (const n of lines(root)) {
        const what = `${name}: ${JSON.stringify(n.props?.content ?? n.bind)}`;
        if (n.type === "Paragraph") expect(n.style!.fontWeight, what).toBe("400");
        // Nothing near the 26-point line the app's own body voice would give.
        expect(n.style!.lineHeight as number, what).toBeLessThanOrEqual(Math.ceil((n.style!.fontSize as number) * 1.5));
      }
    }
  });

  it("the little things stay little: the flow pills, the labels, the rule's 'or' and the step numbers", () => {
    const careful = (screen().root.children as N[])[STEPS.ios.indexOf("careful")]!;
    const pills = find(careful, (n) => n.type === "Text" && n.style?.fontSize === 12 && n.style?.fontWeight === "600");
    expect(pills.length).toBe(8);
    // 4 + 16 + 4: about 24 tall, not 34.
    for (const p of pills) expect(p.style!.lineHeight).toBe(16);
    const keyboard = (screen().root.children as N[])[STEPS.ios.indexOf("keyboard")]!;
    const nums = find(keyboard, (n) => n.type === "Text" && ["1", "2", "3"].includes(String(n.props?.content)));
    expect(nums.length).toBe(3);
    // The number sits in a circle 24 across.
    for (const n of nums) expect(n.style!.lineHeight as number).toBeLessThanOrEqual(24);
    const you = find((screen().root.children as N[])[STEPS.ios.indexOf("try")]!, (n) => n.type === "Text" && n.style?.textTransform === "uppercase");
    expect(you.length).toBeGreaterThan(0);
    for (const n of you) expect(n.style!.lineHeight).toBeLessThanOrEqual(14);
    const or = find((onboardAuthTree({ connectorsOn: true }) as unknown as N), (n) => n.props?.content === OB_EN["ob.or"]);
    expect(or.length).toBeGreaterThan(0);
    for (const n of or) expect(n.style!.lineHeight as number).toBeLessThanOrEqual(16);
  });
});

describe("Connect your apps", () => {
  const appsStep = (extra: Record<string, unknown> = {}) => {
    const s = screen(extra);
    return (s.root.children as N[])[stepIds(s).indexOf("apps")]!;
  };
  const tiles = (step: N) => find(step, (n) => n.type === "Grid")[0]!.children!;

  it("five tiles of the catalog's own apps, and a sixth that opens them all (phone only)", () => {
    const phone = tiles(appsStep());
    expect(phone.length).toBe(6);
    expect(phone[5]!.on!.onPress).toEqual({ kind: "navigate", screenId: "assistant_apps" });
    expect(phone[5]!.style!.borderStyle).toBe("dashed");
    const desk = tiles(appsStep({ formFactor: "desktop" }));
    expect(desk.length).toBe(5);
    // A window connects at once, and says where what it reads goes.
    expect(desk[0]!.on!.onPress).toEqual({ kind: "connector.connect", id: "notion" });
    expect(JSON.stringify(appsStep({ formFactor: "desktop" }))).toContain(OB_EN["s6.ai"]);
    expect(JSON.stringify(appsStep())).not.toContain(OB_EN["s6.ai"]);
  });

  it("a tile opens the sheet that says what happens first; the sheet's Connect starts the sign-in in the app's browser", () => {
    const step = appsStep();
    expect(tiles(step)[0]!.on!.onPress.actions).toEqual([{ kind: "haptic", style: "selection" }, { kind: "setState", path: "sheet.notion", value: true }]);
    const sheets = find(step, (n) => n.type === "BottomSheet");
    expect(sheets.map((s) => s.bind!.open)).toEqual(["sheet.notion", "sheet.linear", "sheet.github", "sheet.atlassian", "sheet.asana"]);
    const text = JSON.stringify(sheets[0]);
    expect(text).toContain("I only use Notion when you ask.");
    const connect = find(sheets[0]!, (n) => n.on?.onPress?.actions?.some((a: any) => a.kind === "callEndpoint"))[0]!.on!.onPress.actions;
    expect(connect[0]).toEqual({ kind: "setState", path: "sheet.notion", value: false });
    expect(connect[2]).toMatchObject({
      kind: "callEndpoint", method: "POST", path: "/v1/connectors/notion/connect", assignTo: "link",
      onSuccess: { kind: "sequence", actions: [{ kind: "openInAppBrowser", url: "$state.link.authorizeUrl" }, { kind: "refresh" }] },
      onError: { kind: "toast", tone: "error" },
    });
  });

  it("the names and letters are drawn from state, so the translator never touches them", () => {
    const s = screen();
    const step = (s.root.children as N[])[STEPS.ios.indexOf("apps")]!;
    expect(JSON.stringify(step)).not.toContain('"Notion"');
    expect(find(step, (n) => n.bind?.content === "n.notion").length).toBeGreaterThan(0);
    expect(find(step, (n) => n.bind?.content === "ini.notion").length).toBeGreaterThan(0);
    expect(s.state.ini.notion).toBe("N");
    expect(s.state.n.atlassian).toBe("Jira and Confluence");
  });

  it("Continue is dimmed until one app is connected; Skip is always there", () => {
    const cont = (step: N) => find(step, (n) => n.children?.[0]?.props?.content === OB_EN["ob.cont"])[0]!;
    const none = appsStep();
    expect(cont(none).on).toBeUndefined();
    expect(cont(none).style!.opacity).toBe(0.3);
    const some = appsStep({ assistant: { apps: APPS.map((a) => (a.id === "linear" ? { ...a, connected: true } : a)), names: {} } });
    expect(cont(some).on!.onPress).toMatchObject({ kind: "setState", path: "step" });
    expect(cont(some).style!.opacity).toBe(1);
    for (const step of [none, some]) {
      expect(find(step, (n) => n.children?.[0]?.props?.content === OB_EN["ob.skip"]).length).toBe(1);
    }
    // A connected tile has nothing left to do, and no sheet.
    const tile = tiles(some)[1]!;
    expect(tile.on).toBeUndefined();
    expect(tile.style!.borderColor).toBe("#1C1A17");
    expect(find(some, (n) => n.type === "BottomSheet").length).toBe(4);
    expect(JSON.stringify(tile)).toContain("Connected");
    expect(JSON.stringify(tiles(some)[0])).toContain('"Connect"');
  });
});

describe("the language chips", () => {
  const step = () => (screen().root.children as N[])[0]!;
  const chips = () => find(step(), (n) => n.type === "Stack" && !!n.on?.onPress?.actions?.some((a: any) => a.kind === "toggleInArray"));
  const shown = DAILY_LANGUAGES.filter((l) => l.india || l.value === "en");

  it("one per language the step shows, each toggling the selection and saving as it is tapped", () => {
    expect(chips().length).toBe(shown.length);
    expect(shown.length).toBeGreaterThan(5);
    chips().forEach((chip, i) => {
      expect(chip.on!.onPress.actions).toEqual([
        { kind: "haptic", style: "selection" },
        { kind: "toggleInArray", path: "langs", value: shown[i]!.value },
        { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" } },
      ]);
      // Lit by what is chosen, live.
      expect(chip.style!.borderColor).toMatchObject({ contains: ["langs", shown[i]!.value], then: "#1C1A17", else: "rgba(28,26,23,0.13)" });
      expect(chip.style!.backgroundColor).toMatchObject({ contains: ["langs", shown[i]!.value], then: "rgba(57,255,20,0.2)" });
      expect(chip.children![0]!.visibleIf).toEqual({ contains: ["langs", shown[i]!.value] });
    });
  });

  it("names are drawn from state, and '+ N more' counts the rest and opens the full list", () => {
    const s = screen();
    for (const l of shown) expect(s.state.ln[l.value]).toBe(l.label);
    const more = find(step(), (n) => n.on?.onPress?.kind === "navigate")[0]!;
    expect(more.on!.onPress).toEqual({ kind: "navigate", screenId: "languages" });
    expect(more.style!.borderStyle).toBe("dashed");
    expect(more.children![0]!.props!.content).toBe(`+ ${DAILY_LANGUAGES.length - shown.length} more`);
  });

  it("Continue saves before it moves, and a window goes straight to Try it", () => {
    const cont = (s: any) => find((s.root.children as N[])[0]!, (n) => n.children?.[0]?.props?.content === OB_EN["ob.cont"])[0]!.on!.onPress;
    const phone = cont(screen());
    expect(phone.actions[0]).toEqual({ kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" } });
    expect(phone.actions[1]).toEqual({
      kind: "condition", if: { truthy: "keyboardReady" },
      then: { kind: "setState", path: "step", value: STEPS.ios.indexOf("try") },
      else: { kind: "setState", path: "step", value: STEPS.ios.indexOf("keyboard") },
    });
    const desk = cont(screen({ formFactor: "desktop" }));
    expect(desk.actions[0].kind).toBe("callEndpoint");
    expect(desk.actions[1]).toEqual({ kind: "setState", path: "step", value: STEPS.desktop.indexOf("try") });
    // …and then asks for the screen again, which is written in the language just
    // saved. The stage keeps the furthest step, so the new copy opens where the person is.
    expect(phone.actions.length).toBe(3);
    expect(phone.actions[2]).toEqual({ kind: "refresh" });
    expect(desk.actions.length).toBe(3);
    expect(desk.actions[2]).toEqual({ kind: "refresh" });
  });

  it("the screen is written in the first language chosen until the profile says one", () => {
    // Nothing chosen, nothing set: English.
    expect(onboardLanguage(undefined, undefined)).toBe("auto");
    expect(onboardLanguage("auto", [])).toBe("auto");
    // The Languages step saved these; the profile still says "auto".
    expect(onboardLanguage("auto", ["hinglish", "hi", "en"])).toBe("hinglish");
    expect(onboardLanguage(undefined, ["hi", "en"])).toBe("hi");
    expect(onboardLanguage("", [" ta "])).toBe("ta");
    expect(onboardLanguage("auto", ["en"])).toBe("en");
    // A language the person set in Settings is the app's language and wins.
    expect(onboardLanguage("hi", ["hinglish"])).toBe("hi");
    expect(onboardLanguage("en", ["hinglish"])).toBe("en");
    // Junk in the saved list is not a language.
    expect(onboardLanguage("auto", ["auto", "hi"])).toBe("auto");
    expect(onboardLanguage("auto", [null, 3] as unknown[])).toBe("auto");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

// The Bots app behind its switch: the bootstrap's shape with it off (today's, unchanged) and on, and the screen
// route for a build that declares the kit and one that does not.
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
const { buildApp } = await import("../src/server.js");

describe("the bootstrap", () => {
  it("off: today's tabs, landing and fonts, with nothing of the Bots app", () => {
    const off = buildBootstrap({ onboarded: true, landedBefore: true });
    const plain = buildBootstrap({ onboarded: true, landedBefore: true, botsApp: false });
    expect(JSON.stringify({ ...plain, cacheVersion: "" })).toBe(JSON.stringify({ ...off, cacheVersion: "" }));
    expect(off.navigation.kind === "tabs" && off.navigation.tabs.map((t) => t.id)).toEqual(["stats", "personality"]);
    expect(off.flags?.["bots.app"]).toBeUndefined();
    expect(Object.keys(off.fonts ?? {})).not.toContain("Tailzu Geist");
    expect(off.initialScreenId).not.toMatch(/^bots\./);
  });
  it("on: the three living tabs, Home first, Geist, and the tabs warmed", () => {
    const on = buildBootstrap({ onboarded: true, landedBefore: true, botsApp: true });
    expect(on.navigation.kind === "tabs" && on.navigation.tabs.map((t) => [t.id, t.title, t.screenId])).toEqual([
      ["bots", "Bots", "bots.home"], ["activity", "Activity", "bots.activity"], ["you", "You", "bots.you"],
    ]);
    expect(on.initialScreenId).toBe("bots.home");
    expect(on.flags?.["bots.app"]).toBe(true);
    expect(Object.keys(on.fonts ?? {})).toEqual(expect.arrayContaining(["Tailzu Geist", "Tailzu Geist SemiBold", "Tailzu Geist Mono"]));
    expect(on.warmScreenIds).toEqual(["bots.home", "bots.activity", "bots.you"]);
  });
  it("on: opens on Home, never on the old app's screens, even on a fresh install with nothing set up yet", () => {
    for (const o of [
      { launchCount: 1, micGranted: false, keyboardReady: false },
      { launchCount: 1, micGranted: true, keyboardReady: false, onboardV2: true },
      { launchCount: 5, micGranted: false },
    ]) {
      expect(buildBootstrap({ onboarded: true, botsApp: true, ...o }).initialScreenId).toBe("bots.home");
    }
    expect(buildBootstrap({ onboarded: true, botsApp: true, isReviewer: true, launchCount: 1 }).initialScreenId).toBe("bots.home");
  });
  it("on, in a window that has the desk: Home, not Today, and the desk's pages stay reachable", () => {
    const on = buildBootstrap({ onboarded: true, botsApp: true, desk: true, formFactor: "desktop" });
    expect(on.initialScreenId).toBe("bots.home");
    expect(on.flags?.["desktop.desk"]).toBe(true);
    expect(on.flags?.["desktop.desk.settingsScreenId"]).toBe("desk_settings");
  });
  it("on, for someone the new onboarding has not finished: the onboarding first (the Bots app's own, About you and Name)", () => {
    const on = buildBootstrap({ onboarded: false, botsApp: true, onboardV2: true, launchCount: 1 });
    expect(on.initialScreenId).toBe("bots.name-it");
    // The run asks the name and gender card's question itself: the card is not laid over anything meanwhile.
    expect(on.flags?.["profileGate.screenIds"]).toEqual([]);
    // Onboarded before the run asked it: no native card any more. The run's own screen asks, over Home after a
    // pause (promptScreenId bots.name-it, About you alone for them), only while the answer is owed.
    const owed = buildBootstrap({ onboarded: true, botsApp: true });
    expect(owed.flags?.["profileGate.screenIds"]).toEqual([]);
    expect(owed.flags?.["promptScreenId"]).toBe("bots.name-it");
    const answered = buildBootstrap({ onboarded: true, botsApp: true, profileComplete: true });
    expect(answered.flags?.["profileGate.screenIds"]).toEqual([]);
    expect(answered.flags?.["promptScreenId"]).toBeUndefined();
    // Never in front of a reviewer, and the old app keeps its card.
    expect(buildBootstrap({ onboarded: true, botsApp: true, isReviewer: true }).flags?.["promptScreenId"]).toBeUndefined();
    expect(buildBootstrap({ onboarded: true }).flags?.["profileGate.screenIds"]).toEqual(["personality", "home"]);
  });
});

describe("the screen route", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildApp(); await server.ready(); });
  afterAll(async () => { await server.close(); });
  const auth = { authorization: "Bearer test-static-token-0123456789" };
  const caps = (components: string[], formFactor = "phone") => ({ platform: "ios", appVersion: "1.0.0", components, device: { formFactor, width: 390, height: 844 } });
  const post = (url: string, payload: object) => server.inject({ method: "POST", url, headers: auth, payload });

  it("a build that draws the kit is booted into the Bots app", async () => {
    const r = await post("/v1/app/bootstrap", { capabilities: caps(["BotsKit"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().navigation.tabs.map((t: { id: string }) => t.id)).toEqual(["bots", "activity", "you"]);
    const old = await post("/v1/app/bootstrap", { capabilities: caps([]) });
    expect(old.json().navigation.tabs.map((t: { id: string }) => t.id)).toEqual(["stats", "personality"]);
  });
  it("bots.home for the phone and the window; \"home\" is the new Home; an older build gets no bots screen", async () => {
    const phone = await post("/v1/app/screen", { screenId: "bots.home", capabilities: caps(["BotsKit"]) });
    expect(phone.statusCode).toBe(200);
    expect(phone.json()).toMatchObject({ screenId: "bots.home", look: "bots", hideChrome: true });
    expect(phone.body).toContain('"type":"SafeArea"');
    const desk = await post("/v1/app/screen", { screenId: "bots.home", capabilities: caps(["BotsKit", "DeskShell"], "desktop") });
    // A person who has done nothing yet lands on the empty home (EmptyHome); anyone else on "What should we do?".
    expect(desk.body).toMatch(/What should we do\?|I'm Blip/);
    expect(desk.body).toContain('"screenId":"bots.today"');
    const home = await post("/v1/app/screen", { screenId: "home", capabilities: caps(["BotsKit"]) });
    expect(home.json().screenId).toBe("bots.home");
    const old = await post("/v1/app/screen", { screenId: "bots.home", capabilities: caps([]) });
    expect(old.statusCode).toBe(404);
    const oldHome = await post("/v1/app/screen", { screenId: "home", capabilities: caps([]) });
    expect(oldHome.json().screenId).toBe("home");
  });
});

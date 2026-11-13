/**
 * THE THREE EXTRAS, SERVER SIDE (native/SPEC.md sections 1.3, 1.4 and 3.1; docs/native-looks.md):
 *
 *   GET  /v1/native/looks                 the catalog a build receives, and the 404 while the switch is off
 *   GET  /v1/native/art/<sha>@<n>.png     by content only: a name that is not a hash never reaches the disk
 *   POST /v1/widgets/activity-start-token push-to-start, kept only with the switch on and only for an iPhone
 *   POST /v1/widgets/looks/bad            a design that killed a widget is never named for that person again
 *   the Android notice                    data-only, priority high, no title and no body, and nothing at all when off
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  // A control volume of this file's own: its admin pushes raise the high-water mark, which is kept on disk.
  process.env.CONTROL_DIR = mkdtempSync(join(tmpdir(), "tailzu-native-push-"));
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { registerNativeLooksRoutes } = await import("../src/routes/app/nativeLooks.js");
const { registerWidgetRoutes } = await import("../src/routes/bots/widgets.js");
const { MemoryActivityTokenStore, MemoryGlanceStore, START_TOKEN_JOB } = await import("../src/widgets/glanceStore.js");
const { WIDGETS_DEFAULTS } = await import("../src/widgets/defaults.js");
const { ActivityPusher, ACTIVITY_ATTRIBUTES_TYPE } = await import("../src/widgets/activity.js");
const { BotsNoticePusher, NOTICE_KIND, noticePush } = await import("../src/widgets/notice.js");
const { x0Words } = await import("../src/widgets/glance.js");
const { setNativeLooksForTests, resetNativeLooksForTests, activeNativeLooks, pushNativeLooks, dropPushedNativeLooks, nativeSwitches } = await import("../src/experience/native/catalog.js");
const { SupabaseActivityTokenStore, withBadLooks, badLookIds } = await import("../src/widgets/glanceStore.js");
const { buildBootstrap } = await import("../src/experience/bootstrap/bootstrap.js");
const { resetConfigForTests } = await import("../src/config.js");
const { setJobChangeHook } = await import("../src/live/writes.js");

type JobLite = import("../src/experience/bots/live.js").JobLite;
type ApnsResult = import("../src/widgets/apns.js").ApnsResult;
type LiveActivityPush = import("../src/widgets/apns.js").LiveActivityPush;
type PushMessage = import("../src/push/expo.js").PushMessage;

const NOW = Date.UTC(2026, 10, 13, 9, 0, 0);
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (u: string) => ({ authorization: `Bearer ${u}` });
const TOKEN = "a1".repeat(32);

const JOB: JobLite = {
  id: "j1", task: "Fix the cart total", state: "running", phase: "build", waitingOn: null, reason: "", result: "",
  startedAt: NOW - 17 * 60_000, createdAt: NOW - 18 * 60_000, updatedAt: NOW - 60_000,
} as unknown as JobLite;

const words = () => x0Words(structuredClone(WIDGETS_DEFAULTS), false);

/** Switches on, with a catalog that names one design for the widget and one for the Live Activity. */
function switchedOn(): void {
  process.env.NATIVE_LOOKS = "true";
  process.env.NATIVE_ACTIVITY = "true";
  process.env.ACTIVITY_PUSH_START = "true";
  process.env.ANDROID_BOTS_NOTICE = "true";
  resetConfigForTests();
  const c = structuredClone(activeNativeLooks()!);
  for (const d of Object.values(c.designs)) d.since = 1;
  c.targets = [
    { surface: "widget:x0", design: "x0.dusk" },
    { surface: "activity:bots", design: "bots.night" },
    { surface: "notice:bots", design: "bu.base" },
  ];
  setNativeLooksForTests(c);
}

function switchedOff(): void {
  for (const k of ["NATIVE_LOOKS", "NATIVE_ACTIVITY", "ACTIVITY_PUSH_START", "ANDROID_BOTS_NOTICE"]) delete process.env[k];
  resetConfigForTests();
  resetNativeLooksForTests();
}

// ------------------------------------------------------------------ the catalog route

describe("GET /v1/native/looks", () => {
  const app = () => { const a = Fastify(); registerNativeLooksRoutes(a, { rateLimit: RL }); return a; };

  it("answers 404 while the switch is off, and says which of the three reasons it is", async () => {
    switchedOff();
    const r = await app().inject({ url: "/v1/native/looks?can=NativeLook1" });
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toMatch(/off on this server/);
  });

  it("answers 404 for a build that draws no format, however many designs are published", async () => {
    switchedOn();
    try {
      const r = await app().inject({ url: "/v1/native/looks?can=Nothing1" });
      expect(r.statusCode).toBe(404);
      expect(r.json().message).toMatch(/draws no nlook format/);
    } finally { switchedOff(); }
  });

  it("serves the designs this platform uses, with no targeting rules in them", async () => {
    switchedOn();
    try {
      const ios = (await app().inject({ url: "/v1/native/looks?can=NativeLook1&platform=ios" })).json();
      expect(ios).not.toHaveProperty("targets");
      expect(Object.keys(ios.designs)).toContain("bots.night");
      const android = (await app().inject({ url: "/v1/native/looks?can=NativeLook1&platform=android" })).json();
      expect(Object.keys(android.designs)).not.toContain("bots.night");
      expect(Object.keys(android.designs)).toContain("x0.dusk");
    } finally { switchedOff(); }
  });

  it("is cached by its own version, and answers 304 to a phone that already holds it", async () => {
    switchedOn();
    try {
      const a = app();
      const first = await a.inject({ url: "/v1/native/looks?can=NativeLook1" });
      const etag = first.headers.etag as string;
      expect(etag).toMatch(/^"nlook-/);
      const again = await a.inject({ url: "/v1/native/looks?can=NativeLook1", headers: { "if-none-match": etag } });
      expect(again.statusCode).toBe(304);
    } finally { switchedOff(); }
  });

  it("says it varies on the User-Agent, because without `platform` that is what picks the projection", async () => {
    switchedOn();
    try {
      const r = await app().inject({ url: "/v1/native/looks?can=NativeLook1", headers: { "user-agent": "okhttp/4.12" } });
      // `public` with no Vary let a shared cache hand the iOS projection (Activity designs, accessory roots) to Android.
      expect(String(r.headers["cache-control"])).toContain("public");
      expect(String(r.headers.vary)).toMatch(/user-agent/i);
      // And the sniff really does change the answer, which is why the header has to be there.
      expect(Object.keys(r.json().designs)).not.toContain("bots.night");
    } finally { switchedOff(); }
  });

  it("serves a file only by its content hash: no path from a request ever reaches the disk", async () => {
    switchedOn();
    try {
      const a = app();
      for (const name of ["../../../etc/passwd", "looks.json", "abc@3.png", `${"a".repeat(64)}@9.png`]) {
        const r = await a.inject({ url: `/v1/native/art/${encodeURIComponent(name)}` });
        expect([400, 404]).toContain(r.statusCode);
      }
      // A well-formed name for a file we do not have is an honest 404, never a read.
      const ok = await a.inject({ url: `/v1/native/art/${"a".repeat(64)}@3.png` });
      expect(ok.statusCode).toBe(404);
    } finally { switchedOff(); }
  });
});

// ------------------------------------------------------------------ push-to-start

describe("push-to-start", () => {
  function sender() {
    const sent: Array<{ token: string; push: LiveActivityPush }> = [];
    return {
      sent,
      send: async (token: string, push: LiveActivityPush): Promise<ApnsResult> => { sent.push({ token, push }); return { ok: true, status: 200, gone: false }; },
    };
  }

  const pusherWith = (tokens: InstanceType<typeof MemoryActivityTokenStore>, s: ReturnType<typeof sender>) => new ActivityPusher({
    tokens, sender: s, now: () => NOW, words, readJob: async () => JOB,
  });

  it("sends nothing while the switch is off, even with a token in hand", async () => {
    switchedOff();
    const tokens = new MemoryActivityTokenStore();
    await tokens.put("u1", START_TOKEN_JOB, TOKEN, "production", false, NOW, 1);
    const s = sender();
    expect(await pusherWith(tokens, s).startFor("u1", "j1")).toBe("off");
    expect(s.sent).toHaveLength(0);
  });

  it("starts an activity on a shut phone, with the attributes ActivityKit matches on and the alert Apple requires", async () => {
    switchedOn();
    try {
      const tokens = new MemoryActivityTokenStore();
      await tokens.put("u1", START_TOKEN_JOB, TOKEN, "production", false, NOW, 2);
      const s = sender();
      expect(await pusherWith(tokens, s).startFor("u1", "j1")).toBe("sent");
      expect(s.sent).toHaveLength(1);
      const p = s.sent[0]!.push;
      expect(p.event).toBe("start");
      expect(p.attributesType).toBe(ACTIVITY_ATTRIBUTES_TYPE);
      expect(p.attributes).toEqual({ jobId: "j1" });
      expect(p.alert).toBeTruthy();
      expect(p.priority).toBe(10);
      // The phone holds the catalog, so the push may name a design — and the design it names is one it can draw.
      expect((p.contentState as { look?: string }).look).toBe("bots.night");
    } finally { switchedOff(); }
  });

  it("never gives a person a second banner: not for a job that has one, nor while another job has one", async () => {
    switchedOn();
    try {
      const tokens = new MemoryActivityTokenStore();
      await tokens.put("u1", START_TOKEN_JOB, TOKEN, "production", false, NOW, 1);
      await tokens.put("u1", "j1", "b2".repeat(32), "production", false, NOW, 1);
      const s = sender();
      expect(await pusherWith(tokens, s).startFor("u1", "j1")).toBe("busy");
      expect(await pusherWith(tokens, s).startFor("u1", "j2")).toBe("busy");
      expect(s.sent).toHaveLength(0);
    } finally { switchedOff(); }
  });

  it("starts ONE activity for a job, however many times it changes before the phone registers a token", async () => {
    switchedOn();
    try {
      const tokens = new MemoryActivityTokenStore();
      await tokens.put("u1", START_TOKEN_JOB, TOKEN, "production", false, NOW, 1);
      const s = sender();
      const p = pusherWith(tokens, s);
      // flush() falls through to startFor() while the job has no token of its own, and the phone cannot register one
      // while the app is shut — which is exactly when push-to-start is used. Each stage change used to stack a banner.
      expect(await p.flush("u1", "j1")).toBe("started");
      expect(await p.flush("u1", "j1")).toBe("none");
      expect(await p.flush("u1", "j1")).toBe("none");
      expect(s.sent.filter((x) => x.push.event === "start")).toHaveLength(1);
      // And no OTHER job may start one either while that banner is up with no token.
      expect(await p.startFor("u1", "j2")).toBe("busy");
    } finally { switchedOff(); }
  });

  it("does nothing for a person who registered no start token", async () => {
    switchedOn();
    try {
      const s = sender();
      expect(await pusherWith(new MemoryActivityTokenStore(), s).startFor("u1", "j1")).toBe("none");
    } finally { switchedOff(); }
  });

  it("the route keeps a start token only with the switch on, only for an iPhone, and only in hex", async () => {
    switchedOn();
    try {
      const tokens = new MemoryActivityTokenStore();
      const app = Fastify();
      registerWidgetRoutes(app, deps() as never, parts() as never, {
        apns: APNS, activityTokens: tokens, apnsSender: { send: async () => ({ ok: true, status: 200, gone: false }) } as never,
        glance: new MemoryGlanceStore(), now: () => NOW, config: () => structuredClone(WIDGETS_DEFAULTS), pushEngine: null,
      });
      try {
        expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-start-token", payload: { token: TOKEN } })).statusCode).toBe(401);
        expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-start-token", headers: who("u1"), payload: { token: "nope" } })).statusCode).toBe(400);
        expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-start-token", headers: who("u1"), payload: { token: TOKEN, platform: "android" } })).json()).toEqual({ ok: true, push: false });
        expect(await tokens.get("u1", START_TOKEN_JOB)).toBeNull();
        const r = await app.inject({ method: "POST", url: "/v1/widgets/activity-start-token", headers: who("u1"), payload: { token: TOKEN, platform: "ios", nl: 4 } });
        expect(r.json()).toEqual({ ok: true, push: true });
        expect(await tokens.get("u1", START_TOKEN_JOB)).toMatchObject({ token: TOKEN, nl: 4 });
        // Handed back: forgotten at once.
        await app.inject({ method: "POST", url: "/v1/widgets/activity-start-token", headers: who("u1"), payload: { token: null } });
        expect(await tokens.get("u1", START_TOKEN_JOB)).toBeNull();
      } finally { setJobChangeHook(null); }
    } finally { switchedOff(); }
  });

  it("with ACTIVITY_PUSH_START off, an iPhone is answered `push: false` and nothing is kept", async () => {
    // The phone saves its key on `push === true` alone, so the off answer has to be a literal false and not a missing field:
    // a 2xx without it would start the phone's 24 h wait on a token the server threw away.
    switchedOff();
    const tokens = new MemoryActivityTokenStore();
    const app = Fastify();
    registerWidgetRoutes(app, deps() as never, parts() as never, {
      apns: APNS, activityTokens: tokens, apnsSender: { send: async () => ({ ok: true, status: 200, gone: false }) } as never,
      glance: new MemoryGlanceStore(), now: () => NOW, config: () => structuredClone(WIDGETS_DEFAULTS), pushEngine: null,
    });
    try {
      const r = await app.inject({ method: "POST", url: "/v1/widgets/activity-start-token", headers: who("u1"), payload: { token: TOKEN, platform: "ios", nl: 4 } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ok: true, push: false });
      expect(await tokens.get("u1", START_TOKEN_JOB)).toBeNull();
    } finally { setJobChangeHook(null); switchedOff(); }
  });

  it("a start token belongs to one account at a time, even when the sign-out never reached us", async () => {
    const tokens = new MemoryActivityTokenStore();
    await tokens.put("u1", START_TOKEN_JOB, TOKEN, "production", false, NOW, 3);
    // A session that expires, an account deleted elsewhere and an offline sign-out all skip the { token: null } POST.
    // The next account's first registration takes the phone over, so nobody can start an activity on someone else's phone.
    await tokens.put("u2", START_TOKEN_JOB, TOKEN, "production", false, NOW + 1, 3);
    expect(await tokens.get("u1", START_TOKEN_JOB)).toBeNull();
    expect(await tokens.get("u2", START_TOKEN_JOB)).toMatchObject({ token: TOKEN });
    // A per-JOB activity token is not touched: two people can genuinely have their own activities on their own phones.
    await tokens.put("u1", "j1", TOKEN, "production", false, NOW, 3);
    await tokens.put("u3", "j2", TOKEN, "production", false, NOW, 3);
    expect(await tokens.get("u1", "j1")).toMatchObject({ token: TOKEN });
  });
});

// ------------------------------------------------------------------ the Android notice

describe("the Android ongoing notice", () => {
  const device = { token: "ExponentPushToken[abc]", hg: false };

  it("is a data-only push with no title and no body, so the system draws nothing by itself", () => {
    const m = noticePush(device, { bot: "code", botName: "Xode", phase: "working" } as never, "update");
    expect(m.dataOnly).toBe(true);
    expect(m.priority).toBe("high");
    expect(m.title).toBe("");
    expect(m.data).toMatchObject({ kind: NOTICE_KIND, event: "update" });
    // The design is NOT in the push. The Android binary reads look.bots from the last glance it stored and ignores
    // anything a push says, so a `look` here would be a second channel that disagrees with the first.
    expect(m.data).not.toHaveProperty("look");
    // One ongoing notice, so a new state replaces the one in flight rather than queueing behind it.
    expect(m.collapseId).toBe(NOTICE_KIND);
  });

  function noticeWith(sent: PushMessage[][], devices: typeof device[]) {
    return new BotsNoticePusher({
      devices: async () => devices, readJob: async () => JOB, words, now: () => NOW,
      send: async (m) => { sent.push(m); return m.map(() => ({ status: "ok" as const })); },
    });
  }

  it("sends nothing at all while the switch is off", async () => {
    switchedOff();
    const sent: PushMessage[][] = [];
    expect(await noticeWith(sent, [device]).flush("u1", "j1")).toBe("off");
    expect(sent).toHaveLength(0);
  });

  it("sends nothing to a person with no Android binary that said it can draw one", async () => {
    switchedOn();
    try {
      const sent: PushMessage[][] = [];
      expect(await noticeWith(sent, []).flush("u1", "j1")).toBe("none");
      expect(sent).toHaveLength(0);
    } finally { switchedOff(); }
  });

  it("sends once per change a person would see, and carries only the state", async () => {
    switchedOn();
    try {
      const sent: PushMessage[][] = [];
      const p = noticeWith(sent, [device]);
      expect(await p.flush("u1", "j1")).toBe("sent");
      expect(sent[0]![0]!.data).toMatchObject({ kind: NOTICE_KIND, event: "update" });
      expect(sent[0]![0]!.data).not.toHaveProperty("look");
      // Nothing changed: no second push.
      expect(await p.flush("u1", "j1")).toBe("same");
      expect(sent).toHaveLength(1);
    } finally { switchedOff(); }
  });

  it("words its fill-ins from the language the device was given, not from anything remembered", async () => {
    switchedOn();
    try {
      // A job that has ENDED, because that is where the fill-ins are: "Xode finished" against "Xode ne poora kiya".
      const done = { ...JOB, state: "done", phase: "done", result: "" } as unknown as JobLite;
      const lineFor = async (hg: boolean) => {
        const sent: PushMessage[][] = [];
        const p = new BotsNoticePusher({
          devices: async () => [{ ...device, hg }], readJob: async () => done, now: () => NOW,
          words: (_u, lang) => x0Words(structuredClone(WIDGETS_DEFAULTS), lang),
          send: async (m) => { sent.push(m); return m.map(() => ({ status: "ok" as const })); },
        });
        expect(await p.flush("u1", "j1")).toBe("ended");
        return (sent[0]![0]!.data as { state: { result?: string } }).state.result;
      };
      expect(await lineFor(false)).toBe("Xode finished fix the cart total");
      expect(await lineFor(true)).toBe("Xode ne fix the cart total poora kiya");
      // A NoticeDevice is a token and a language, and nothing else: no catalog version is kept for a person anywhere.
      expect(Object.keys(device)).toEqual(["token", "hg"]);
    } finally { switchedOff(); }
  });

  it("the pusher and the bootstrap flag agree in all four switch combinations", async () => {
    // They did not: this file read ANDROID_BOTS_NOTICE alone while `widgets.notice.enabled` also required NATIVE_LOOKS,
    // so with the master switch off the phone was told the feature was off and then sent notice pushes anyway — and the
    // Android side posts from the push and ends at the next app open, over and over.
    try {
      for (const looks of [false, true]) {
        for (const notice of [false, true]) {
          process.env.NATIVE_LOOKS = String(looks);
          process.env.ANDROID_BOTS_NOTICE = String(notice);
          resetConfigForTests();
          const on = looks && notice;
          expect(nativeSwitches().notice).toBe(on);
          const sent: PushMessage[][] = [];
          const r = await noticeWith(sent, [device]).flush("u1", "j1");
          expect(r === "off").toBe(!on);
          expect(sent.length).toBe(on ? 1 : 0);
        }
      }
    } finally { switchedOff(); }
  });
});

// ------------------------------------------------------------------ a design that killed a widget

describe("POST /v1/widgets/looks/bad", () => {
  it("remembers the ids, refuses anything that is not one, and needs a session", async () => {
    const glance = new MemoryGlanceStore();
    const app = Fastify();
    registerWidgetRoutes(app, deps() as never, parts() as never, {
      apns: null, activityTokens: new MemoryActivityTokenStore(), glance, now: () => NOW,
      config: () => structuredClone(WIDGETS_DEFAULTS), pushEngine: null,
    });
    try {
      expect((await app.inject({ method: "POST", url: "/v1/widgets/looks/bad", payload: { ids: ["x0.dusk"] } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/v1/widgets/looks/bad", headers: who("u1"), payload: { ids: [] } })).statusCode).toBe(400);
      const r = await app.inject({ method: "POST", url: "/v1/widgets/looks/bad", headers: who("u1"), payload: { ids: ["x0.dusk", "NOT AN ID"] } });
      expect(r.json()).toEqual({ ok: true, bad: ["x0.dusk"] });
      expect((await glance.get("u1")).badLooks).toHaveProperty("x0.dusk");
    } finally { setJobChangeHook(null); }
  });
});

// ------------------------------------------------------------------ the harness

const APNS = { keyId: "ABC123DEFG", teamId: "TEAM123456", keyP8: "x", topic: "t.push-type.liveactivity", env: "production" as const };

function deps() {
  return {
    rateLimit: RL, bots: null, code: null, media: null, artifacts: null, connectors: null, agent: null,
    jobs: { job: async (u: string, id: string) => (u === "u1" && id === "j1" ? JOB : (() => { throw Object.assign(new Error("no"), { code: "not_found" }); })()), listJobs: async () => [] },
  };
}

function parts() {
  return { spaces: { mine: async () => [] }, items: { list: async () => [] }, tasks: { givenTo: async () => [] }, threads: { recentFrom: async () => [] } };
}

// ------------------------------------------------------------------ the wiring this build added, driven end to end

describe("the bootstrap's own switches", () => {
  const flagsOf = () => (buildBootstrap({ botsApp: true, onboarded: true, userId: "u1" }) as { flags: Record<string, unknown> }).flags;

  it("names no catalog and holds both extras off with an empty environment", () => {
    switchedOff();
    const flags = flagsOf();
    // Launch dark: every new switch reads false, and the phone's whole sync never starts.
    expect(flags["native.looks"]).toBeUndefined();
    expect(flags["widgets.notice.enabled"]).toBe(false);
    expect(flags["widgets.activity.pushStart"]).toBe(false);
  });

  it("names the catalog and both extras once the switches are on and a rule reaches this person", () => {
    switchedOn();
    try {
      const flags = flagsOf();
      expect(flags["native.looks"]).toMatchObject({ v: activeNativeLooks()!.v });
      expect(flags["widgets.notice.enabled"]).toBe(true);
      expect(flags["widgets.activity.pushStart"]).toBe(true);
    } finally { switchedOff(); }
  });
});

describe("the catalog's version never repeats", () => {
  it("a rollback serves, reports and nudges ONE number, and a later deploy at the same v is served above it", async () => {
    const { cpSync, mkdtempSync, readFileSync: rf, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolve } = await import("node:path");
    const shared = mkdtempSync(join(tmpdir(), "tailzu-native-shared-"));
    cpSync(resolve(__dirname, "../../shared/native"), join(shared, "native"), { recursive: true });
    const before = process.env.TULMI_SHARED_DIR;
    process.env.CONTROL_DIR = mkdtempSync(join(tmpdir(), "tailzu-native-roll-"));
    process.env.TULMI_SHARED_DIR = shared;
    process.env.NATIVE_LOOKS = "true";
    resetConfigForTests();
    resetNativeLooksForTests();
    try {
      const file = join(shared, "native", "looks.json");
      const fileV = activeNativeLooks()!.v;

      const pushed = { ...JSON.parse(rf(file, "utf8")), v: fileV + 6, note: "B" };
      expect(pushNativeLooks(pushed)).toMatchObject({ ok: true, v: fileV + 6 });
      expect(activeNativeLooks()!.v).toBe(fileV + 6);

      // The rollback: what it REPORTS is what is served, and it is above everything that has gone out.
      const rolled = dropPushedNativeLooks();
      expect(rolled).toBe(fileV + 7);
      expect(activeNativeLooks()!.v).toBe(rolled);
      // Stable across a restart: the number is written down, not recomputed.
      resetNativeLooksForTests();
      expect(activeNativeLooks()!.v).toBe(rolled);

      // Now a PR raises the file to a v a push already used, with different content. Phones holding the pushed copy must
      // still be told a number they do not have.
      writeFileSync(file, JSON.stringify({ ...JSON.parse(rf(file, "utf8")), v: fileV + 6, note: "C" }));
      resetNativeLooksForTests();
      const now = activeNativeLooks()!;
      expect(now.note).toBe("C");
      expect(now.v).toBeGreaterThan(fileV + 7);
      // And a push still has to clear everything served.
      expect(pushNativeLooks({ ...JSON.parse(rf(file, "utf8")), v: now.v })).toMatchObject({ ok: false, status: 409 });
    } finally {
      if (before === undefined) delete process.env.TULMI_SHARED_DIR; else process.env.TULMI_SHARED_DIR = before;
      switchedOff();
    }
  });
});

describe("a design reported bad is forgotten once it is fixed", () => {
  it("keeps the broken copy out, and names the id again when it is republished under a newer `since`", () => {
    const sinceOf = (id: string) => (id === "x0.dusk" ? 4 : undefined);
    const marked = withBadLooks({ seen: {}, all: 0, lastAt: null, sinceAt: null }, ["x0.dusk"], NOW, sinceOf);
    expect(badLookIds(marked, sinceOf)).toEqual(["x0.dusk"]);
    // Fixed and republished under the same id: the crash was about the OLD content, so the new one is tried.
    expect(badLookIds(marked, (id) => (id === "x0.dusk" ? 9 : undefined))).toEqual([]);
    // A mark written before `since` was remembered says nothing about which copy broke, so it is never forgotten.
    const old = { badLooks: { "x0.dusk": { at: NOW, since: 0 } } };
    expect(badLookIds(old, () => 9)).toEqual(["x0.dusk"]);
  });
});

describe("the activity token store without migration 0088", () => {
  /** A Supabase client whose widget_activity_tokens has no `nl` column yet. */
  function noNlColumn() {
    const reads: string[] = [];
    const writes: Record<string, unknown>[] = [];
    const missing = { message: 'column widget_activity_tokens.nl does not exist' };
    const row = { token: TOKEN, env: "production", hg: true, sent: null, updated_at: new Date(NOW).toISOString() };
    const from = () => ({
      select(cols: string) {
        reads.push(cols);
        const q = {
          eq: () => q,
          maybeSingle: async () => (cols.includes("nl") ? { data: null, error: missing } : { data: row, error: null }),
        };
        return q;
      },
      upsert: async (r: Record<string, unknown>) => {
        writes.push(r);
        return { error: "nl" in r ? missing : null };
      },
      delete: () => ({ eq: () => ({ eq: () => ({ neq: async () => ({ error: null }) }) }) }),
    });
    return { reads, writes, sb: { from } as never };
  }

  it("reads and writes the rows without it, so a deploy before the migration still pushes", async () => {
    const fake = noNlColumn();
    const store = new SupabaseActivityTokenStore(fake.sb, () => {});
    // Before: every read threw, ActivityPusher caught that as "no token" and nothing at all went to anyone.
    const got = await store.get("u1", "j1");
    expect(got).toMatchObject({ token: TOKEN, hg: true });
    // 0 is the safe direction: the phone holds no catalog we know of, so no design is ever named for it.
    expect(got!.nl).toBe(0);
    await store.put("u1", "j1", TOKEN, "production", true, NOW, 7);
    expect(fake.writes.at(-1)).not.toHaveProperty("nl");
    expect(fake.writes.at(-1)).toMatchObject({ user_id: "u1", job_id: "j1", token: TOKEN });
    // Noticed once: the later calls go straight to the short list.
    expect(fake.reads.filter((c) => c.includes("nl"))).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ the glance's own `look` block

describe("GET /v1/shell/glance?v=2", () => {
  async function served(glance = new MemoryGlanceStore()) {
    const { registerBotsShellRoutes } = await import("../src/routes/bots/botsShell.js");
    const app = Fastify();
    registerBotsShellRoutes(app, {
      rateLimit: RL, media: null, artifacts: null, code: null, bots: null,
      jobs: { listJobs: async () => [] }, connectors: { tasks: { list: async () => [] } },
    } as never, {
      now: () => NOW, glance, widgetsConfig: () => structuredClone(WIDGETS_DEFAULTS),
      profile: async () => ({ fullName: "Aanya", language: "en" }),
    } as never);
    return { app, glance };
  }

  const look = async (app: Awaited<ReturnType<typeof served>>["app"], query: string) =>
    (await app.inject({ url: `/v1/shell/glance?v=2${query}`, headers: who("u1") })).json() as { look?: Record<string, string>; palette?: string; boards?: unknown; vars?: Record<string, string> };

  it("adds nothing at all while the switch is off, however much the phone says it can draw", async () => {
    switchedOff();
    const { app } = await served();
    const g = await look(app, "&nl=9&can=NativeLook1,WidgetBoard1");
    expect(g.look).toBeUndefined();
    expect(g.palette).toBeUndefined();
    expect(g.vars).toBeUndefined();
  });

  it("names a design per surface for a build that sent `nl`, and nothing for one that did not", async () => {
    switchedOn();
    try {
      const { app } = await served();
      // `nl` on its own says the capability as well as the version: only a NativeLook1 build ever sends one.
      const named = await look(app, "&nl=9");
      expect(named.look).toMatchObject({ x0: "x0.dusk", bots: "bots.night" });
      expect(named.palette).toBeTruthy();
      // `vars` ride with a design and only with one: an empty look means no free map either.
      // A build that holds no catalog is told nothing: it would be an id it cannot draw.
      expect((await look(app, "&nl=0")).look).toBeUndefined();
      expect((await look(app, "")).look).toBeUndefined();
    } finally { switchedOff(); }
  });

  it("never names a design this person's widgets reported bad", async () => {
    switchedOn();
    try {
      const glance = new MemoryGlanceStore();
      await glance.update("u1", (st) => withBadLooks(st, ["x0.dusk"], NOW));
      const { app } = await served(glance);
      expect((await look(app, "&nl=9")).look!.x0).not.toBe("x0.dusk");
    } finally { switchedOff(); }
  });

  it("asks Android for the notice's design, and iOS for the Live Activity's", async () => {
    switchedOn();
    try {
      const { app } = await served();
      expect((await look(app, "&nl=9&can=NativeLook1,LiveUpdate1&platform=android")).look!.bots).toBe("bu.base");
      expect((await look(app, "&nl=9&platform=ios")).look!.bots).toBe("bots.night");
    } finally { switchedOff(); }
  });
});

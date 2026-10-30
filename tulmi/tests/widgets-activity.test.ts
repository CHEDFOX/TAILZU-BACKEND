/**
 * THE "BOTS AT WORK" LIVE ACTIVITY'S PUSHES (docs/widget-glance-v2.md section 6; src/widgets/{apns,activity}.ts, routes/widgets.ts):
 *
 *   - off unless APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8 and APNS_TOPIC are all set: nothing registered, heard or sent, said once
 *   - the provider token is an ES256 JWT Apple can check (kid, iss, iat), reused, made again when Apple refuses it; the key never logged
 *   - a push is HTTP/2 POST /3/device/<token> to the right host with apns-push-type liveactivity, the topic, the priority, and
 *     { aps: { timestamp, event, content-state, dismissal-date? } }; a token Apple calls gone is forgotten
 *   - the content state: working (its step), needs (the question and its answers, or only that it needs them when private), done (the
 *     result and the pull request; the activity ends and stays 15 minutes)
 *   - the pusher: only a job with a registered token, only when what it shows changed, a burst is one push, a job change reaches it
 *   - POST /v1/widgets/activity-token: the session's, the person's own job, a hex token
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { ApnsSender, apnsSettingsOf, apnsJwt, apnsKey, APNS_HOSTS, JWT_TTL_MS } = await import("../src/widgets/apns.js");
const { ActivityPusher, contentStateOf, DONE_SHOWN_MS } = await import("../src/widgets/activity.js");
const { x0Words } = await import("../src/widgets/glance.js");
const { MemoryActivityTokenStore, MemoryGlanceStore } = await import("../src/widgets/glanceStore.js");
const { WIDGETS_DEFAULTS } = await import("../src/widgets/defaults.js");
const { registerWidgetRoutes } = await import("../src/routes/widgets.js");
const { liveJob, setJobChangeHook } = await import("../src/live/writes.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");

type JobLite = import("../src/experience/bots/live.js").JobLite;
type H2Client = import("../src/widgets/apns.js").H2Client;

const NOW = Date.UTC(2026, 9, 30, 9, 0, 0);
const MIN = 60_000;
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const P8 = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const SETTINGS = { keyId: "ABC123DEFG", teamId: "TEAM123456", keyP8: P8, topic: "com.tulmi.app.push-type.liveactivity", env: "production" as const };
const TOKEN = "a1".repeat(32);
const words = (hg = false) => x0Words(structuredClone(WIDGETS_DEFAULTS), hg);

function fakeH2(reply: (path: string) => { status: number; body?: string } = () => ({ status: 200 })) {
  const sent: Array<{ origin: string; path: string; headers: Record<string, string>; body: any }> = [];
  const client: H2Client = {
    async post(origin, path, headers, body) { sent.push({ origin, path, headers, body: JSON.parse(body) }); const r = reply(path); return { status: r.status, body: r.body ?? "" }; },
    close() {},
  };
  return { client, sent };
}

const RUNNING: JobLite = { id: "j1", task: "Fix cart total rounding. And tax", state: "running", waitingOn: null, spentPaise: 0, createdAt: NOW - 40 * MIN, updatedAt: NOW - MIN, phase: "work", startedAt: NOW - 30 * MIN };
const ASKING: JobLite = { ...RUNNING, state: "waiting_for_you", waitingOn: "answer", question: { text: "Round the cart total per item, or once at the end?", options: ["Per item", "At the end"] } };
const DONE: JobLite = { ...RUNNING, state: "done", phase: "done", result: "Cart fix is ready", pr: { number: 131, url: "https://github.com/a/b/pull/131" } };

describe("APNs settings and the provider token", () => {
  it("are off unless all four are set; the host by APNS_ENV", () => {
    expect(apnsSettingsOf({})).toBeNull();
    expect(apnsSettingsOf({ APNS_KEY_ID: "k", APNS_TEAM_ID: "t", APNS_KEY_P8: "p" })).toBeNull();
    expect(apnsSettingsOf({ APNS_KEY_ID: "k", APNS_TEAM_ID: "t", APNS_KEY_P8: "p", APNS_TOPIC: " " })).toBeNull();
    expect(apnsSettingsOf({ APNS_KEY_ID: "k", APNS_TEAM_ID: "t", APNS_KEY_P8: "p", APNS_TOPIC: "x" })).toMatchObject({ env: "production" });
    expect(apnsSettingsOf({ APNS_KEY_ID: "k", APNS_TEAM_ID: "t", APNS_KEY_P8: "p", APNS_TOPIC: "x", APNS_ENV: "sandbox" })).toMatchObject({ env: "sandbox" });
    expect(APNS_HOSTS).toEqual({ production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" });
  });

  it("is in the config: APNS_* read with zod, the digest off by default", () => {
    const keep = { ...process.env };
    try {
      Object.assign(process.env, { APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456", APNS_KEY_P8: "x", APNS_TOPIC: "com.tulmi.app.push-type.liveactivity", APNS_ENV: "Sandbox" });
      resetConfigForTests();
      expect(apnsSettingsOf(getConfig())).toMatchObject({ keyId: "ABC123DEFG", env: "sandbox" });
      expect(getConfig().WIDGET_DIGEST).toBe(false);
      process.env.WIDGET_DIGEST = "true";
      resetConfigForTests();
      expect(getConfig().WIDGET_DIGEST).toBe(true);
    } finally {
      for (const k of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY_P8", "APNS_TOPIC", "APNS_ENV", "WIDGET_DIGEST"]) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; }
      resetConfigForTests();
    }
  });

  it("is an ES256 JWT Apple can check, from the .p8 as written, with \\n written out, or as its body alone", () => {
    const jwt = apnsJwt(apnsKey(P8), "ABC123DEFG", "TEAM123456", 1_793_350_000);
    const [h, b, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(b!, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_793_350_000 });
    expect(Buffer.from(sig!, "base64url")).toHaveLength(64);
    expect(verify("sha256", Buffer.from(`${h}.${b}`), { key: createPublicKey(publicKey.export({ format: "pem", type: "spki" })), dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"))).toBe(true);
    const escaped = P8.trim().replace(/\n/g, "\\n");
    expect(apnsKey(escaped).asymmetricKeyType).toBe("ec");
    const body = P8.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    expect(apnsKey(body).asymmetricKeyType).toBe("ec");
  });
});

describe("a push to Apple", () => {
  it("goes over HTTP/2 to the device's path, with the Live Activity's headers and body", async () => {
    const h2 = fakeH2();
    const sender = new ApnsSender(SETTINGS, h2.client, () => NOW);
    expect(await sender.send(TOKEN, { event: "update", contentState: { phase: "working" }, at: NOW, priority: 5 })).toEqual({ ok: true, status: 200, gone: false });
    const [s] = h2.sent;
    expect(s).toMatchObject({ origin: "https://api.push.apple.com", path: `/3/device/${TOKEN}` });
    expect(s!.headers).toMatchObject({
      "apns-topic": "com.tulmi.app.push-type.liveactivity", "apns-push-type": "liveactivity", "apns-priority": "5", "apns-expiration": String(NOW / 1000 + 3600),
    });
    expect(s!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(s!.body).toEqual({ aps: { timestamp: NOW / 1000, event: "update", "content-state": { phase: "working" } } });
    await sender.send(TOKEN, { event: "end", contentState: {}, at: NOW, priority: 10, dismissAt: NOW + DONE_SHOWN_MS, alert: { title: "t", body: "b" } }, "sandbox");
    expect(h2.sent[1]).toMatchObject({ origin: "https://api.sandbox.push.apple.com", body: { aps: { event: "end", "dismissal-date": NOW / 1000 + 900, alert: { title: "t", body: "b" } } } });
    // the provider token is reused
    expect(h2.sent[1]!.headers.authorization).toBe(s!.headers.authorization);
  });

  it("makes the provider token again when it is old or Apple refuses it", async () => {
    const t = { now: NOW };
    let status = 200;
    const h2 = fakeH2(() => ({ status, body: status === 403 ? '{"reason":"ExpiredProviderToken"}' : "" }));
    const sender = new ApnsSender(SETTINGS, h2.client, () => t.now);
    await sender.send(TOKEN, { event: "update", contentState: {}, at: t.now, priority: 5 });
    t.now += JWT_TTL_MS - 1;
    await sender.send(TOKEN, { event: "update", contentState: {}, at: t.now, priority: 5 });
    expect(h2.sent[1]!.headers.authorization).toBe(h2.sent[0]!.headers.authorization);
    t.now += 2;
    await sender.send(TOKEN, { event: "update", contentState: {}, at: t.now, priority: 5 });
    expect(h2.sent[2]!.headers.authorization).not.toBe(h2.sent[0]!.headers.authorization);
    status = 403;
    expect(await sender.send(TOKEN, { event: "update", contentState: {}, at: t.now, priority: 5 })).toEqual({ ok: false, status: 403, reason: "ExpiredProviderToken", gone: false });
    t.now += 1000;
    status = 200;
    await sender.send(TOKEN, { event: "update", contentState: {}, at: t.now, priority: 5 });
    expect(h2.sent[4]!.headers.authorization).not.toBe(h2.sent[3]!.headers.authorization);
  });

  it("says a token is gone when Apple does; an unreadable key fails without its words", async () => {
    const gone = new ApnsSender(SETTINGS, fakeH2(() => ({ status: 410, body: '{"reason":"Unregistered"}' })).client, () => NOW);
    expect(await gone.send(TOKEN, { event: "update", contentState: {}, at: NOW, priority: 5 })).toEqual({ ok: false, status: 410, reason: "Unregistered", gone: true });
    const bad = new ApnsSender(SETTINGS, fakeH2(() => ({ status: 400, body: '{"reason":"BadDeviceToken"}' })).client, () => NOW);
    expect((await bad.send(TOKEN, { event: "update", contentState: {}, at: NOW, priority: 5 })).gone).toBe(true);
    const secret = "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgSECRETSECRET";
    const broken = new ApnsSender({ ...SETTINGS, keyP8: secret }, fakeH2().client, () => NOW);
    const err = await broken.send(TOKEN, { event: "update", contentState: {}, at: NOW, priority: 5 }).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/APNS_KEY_P8 could not be read/);
    expect(String((err as Error).message)).not.toContain("SECRET");
  });
});

describe("the activity's content state", () => {
  it("working: the job's task, its step and stages, when it started, where it opens", () => {
    const u = contentStateOf(RUNNING, words(), "Xode")!;
    expect(u).toMatchObject({ event: "update", priority: 5 });
    expect(u.alert).toBeUndefined();
    expect(u.state).toEqual({
      bot: "code", botName: "Xode", face: "code", task: "Fix cart total rounding", stage: 3, of: 5, stageName: "Build",
      stages: ["Understand", "Plan", "Build", "Check", "Ship"], startedAt: NOW - 30 * MIN, phase: "working", link: "tulmi://screen/bots.code.job?id=j1",
    });
    expect(contentStateOf({ ...RUNNING, phase: "verify" }, words(), "Xode")!.sig).not.toBe(u.sig);
    expect(contentStateOf({ ...RUNNING, updatedAt: NOW }, words(), "Xode")!.sig).toBe(u.sig);
  });

  it("needs: the question and its answers (the act item they answer), an alert; private: only that it needs them", () => {
    const u = contentStateOf(ASKING, words(), "Xode")!;
    expect(u).toMatchObject({ event: "update", priority: 10, alert: { title: "Xode needs you", body: "Round the cart total per item, or once at the end?" } });
    expect(u.state).toMatchObject({
      phase: "needs", question: "Round the cart total per item, or once at the end?",
      choices: [{ id: "a0", label: "Per item", primary: true }, { id: "a1", label: "At the end" }],
      itemId: expect.stringMatching(/^job:j1:[0-9a-f]{8}$/), itemKind: "question", decideLink: "tulmi://screen/bots.code.job?id=j1",
    });
    const hidden = contentStateOf({ ...ASKING, question: { ...ASKING.question!, widget: { private: true } } }, words(), "Xode")!;
    expect(hidden.state).toMatchObject({ phase: "needs", question: "Xode needs you", private: true, itemKind: "question", decideLink: "tulmi://screen/bots.code.job?id=j1" });
    expect(hidden.state.choices).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain("Round the cart");
    expect(hidden.alert).toEqual({ title: "Xode needs you", body: "Open X0 to answer" });
    expect(contentStateOf(ASKING, words(true), "Xode")!.alert!.title).toBe("Xode ko aapki zaroorat hai");
  });

  it("done: the result and the pull request, and the activity ends; a failure says so", () => {
    const u = contentStateOf(DONE, words(), "Xode")!;
    expect(u).toMatchObject({ event: "end", priority: 10 });
    expect(u.state).toMatchObject({ phase: "done", stage: 5, stageName: "Ship", result: "Cart fix is ready", pr: { number: 131 }, minutes: 29 });
    const failed = contentStateOf({ ...RUNNING, state: "failed", reason: "" }, words(), "Xode")!;
    expect(failed.state).toMatchObject({ phase: "done", failed: true, result: "Xode hit a snag" });
    expect(contentStateOf({ ...RUNNING, helper: true }, words(), "Xode")).toBeNull();
  });
});

describe("the pusher", () => {
  const make = (jobs: Map<string, JobLite>, reply?: (path: string) => { status: number; body?: string }) => {
    const tokens = new MemoryActivityTokenStore();
    const h2 = fakeH2(reply);
    const warned: string[] = [];
    const pusher = new ActivityPusher({
      tokens, sender: new ApnsSender(SETTINGS, h2.client, () => NOW), readJob: async (_u, id) => jobs.get(id) ?? null,
      words: (_u, hg) => words(hg), now: () => NOW, delayMs: 5, log: { info: () => {}, warn: (m) => warned.push(m) },
    });
    return { tokens, h2, pusher, warned };
  };

  it("pushes only a job with a token, only when what it shows changed, and forgets the token when the job ends", async () => {
    const jobs = new Map([["j1", RUNNING]]);
    const { tokens, h2, pusher } = make(jobs);
    expect(await pusher.flush("u1", "j1")).toBe("none");
    await tokens.put("u1", "j1", TOKEN, "production", false, NOW);
    expect(await pusher.flush("u1", "j1")).toBe("sent");
    expect(await pusher.flush("u1", "j1")).toBe("same");
    expect(h2.sent).toHaveLength(1);
    jobs.set("j1", ASKING);
    expect(await pusher.flush("u1", "j1")).toBe("sent");
    expect(h2.sent[1]!.body.aps).toMatchObject({ event: "update", "content-state": { phase: "needs" }, alert: { title: "Xode needs you" } });
    expect(h2.sent[1]!.headers["apns-priority"]).toBe("10");
    jobs.set("j1", DONE);
    expect(await pusher.flush("u1", "j1")).toBe("ended");
    expect(h2.sent[2]!.body.aps).toMatchObject({ event: "end", "dismissal-date": (NOW + DONE_SHOWN_MS) / 1000, "content-state": { phase: "done", result: "Cart fix is ready" } });
    expect(await tokens.get("u1", "j1")).toBeNull();
    // someone else's job, or one gone, sends nothing
    expect(await pusher.flush("u2", "j1")).toBe("none");
  });

  it("forgets a token Apple calls gone, and says a refusal by its status alone", async () => {
    const jobs = new Map([["j1", RUNNING]]);
    const gone = make(jobs, () => ({ status: 410, body: '{"reason":"Unregistered"}' }));
    await gone.tokens.put("u1", "j1", TOKEN, "production", false, NOW);
    expect(await gone.pusher.flush("u1", "j1")).toBe("gone");
    expect(await gone.tokens.get("u1", "j1")).toBeNull();
    const refused = make(jobs, () => ({ status: 429, body: '{"reason":"TooManyRequests"}' }));
    await refused.tokens.put("u1", "j1", TOKEN, "production", false, NOW);
    expect(await refused.pusher.flush("u1", "j1")).toBe("failed");
    expect(refused.warned).toEqual(["widgets: live activity push refused (429 TooManyRequests)"]);
    expect(refused.warned.join()).not.toContain(TOKEN);
    // tried again: it was never marked sent
    expect(await refused.pusher.flush("u1", "j1")).toBe("failed");
  });

  it("hears every job change, and a burst is one push", async () => {
    const jobs = new Map([["j1", RUNNING]]);
    const { tokens, h2, pusher } = make(jobs);
    await tokens.put("u1", "j1", TOKEN, "production", false, NOW);
    setJobChangeHook((u, j) => pusher.jobChanged(u, j));
    try {
      liveJob("u1", "j1");
      liveJob("u1", "j1");
      liveJob("u1", "j1");
      await new Promise((r) => setTimeout(r, 40));
      expect(h2.sent).toHaveLength(1);
    } finally {
      setJobChangeHook(null);
      pusher.clear();
    }
  });
});

// ------------------------------------------------------------------ the route

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (u: string) => ({ authorization: `Bearer ${u}` });

function served(apns: typeof SETTINGS | null) {
  const app = Fastify();
  const tokens = new MemoryActivityTokenStore();
  const h2 = fakeH2();
  const own = new Map([["j1", { id: "j1", userId: "u1", task: "Fix cart", state: "running", waitingOn: null, reason: "", spentPaise: 0, createdAt: NOW, updatedAt: NOW, checkpoint: { stepIndex: 0, headSha: "", notes: "" } }]]);
  const deps = {
    rateLimit: RL, bots: null, code: null, media: null, artifacts: null, connectors: null, agent: null,
    jobs: { job: async (u: string, id: string) => { const j = own.get(id); if (!j || j.userId !== u) throw Object.assign(new Error("No such job"), { code: "not_found" }); return j; }, listJobs: async () => [] },
  };
  const parts = { spaces: { mine: async () => [] }, items: { list: async () => [] }, tasks: { givenTo: async () => [] }, threads: { recentFrom: async () => [] } };
  registerWidgetRoutes(app, deps as never, parts as never, {
    apns, activityTokens: tokens, apnsSender: new ApnsSender(SETTINGS, h2.client, () => NOW), glance: new MemoryGlanceStore(), now: () => NOW,
    config: () => structuredClone(WIDGETS_DEFAULTS),
  });
  return { app, tokens, h2 };
}

describe("POST /v1/widgets/activity-token", () => {
  it("is off, keeps nothing and says so, unless APNs is configured", async () => {
    const { app, tokens } = served(null);
    const r = await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u1"), payload: { jobId: "j1", token: TOKEN } });
    expect(r.json()).toEqual({ ok: true, push: false });
    expect(await tokens.get("u1", "j1")).toBeNull();
    setJobChangeHook(null);
  });

  it("keeps the person's own job's token, in hex, with its environment and language", async () => {
    const { app, tokens } = served(SETTINGS);
    try {
      expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-token", payload: { jobId: "j1", token: TOKEN } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u1"), payload: { jobId: "j1", token: "not hex" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u1"), payload: { jobId: "../x", token: TOKEN } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u1"), payload: { jobId: "j1", token: TOKEN, env: "staging" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u2"), payload: { jobId: "j1", token: TOKEN } })).statusCode).toBe(404);
      expect(await tokens.get("u2", "j1")).toBeNull();
      const r = await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: { ...who("u1"), "x-app-language": "hinglish" }, payload: { jobId: "j1", token: TOKEN.toUpperCase(), platform: "ios", env: "sandbox" } });
      expect(r.json()).toEqual({ ok: true, push: true });
      expect(await tokens.get("u1", "j1")).toMatchObject({ token: TOKEN, env: "sandbox", hg: true, sent: null });
      // not an iPhone: nothing to push to
      expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u1"), payload: { jobId: "j1", token: "b2".repeat(32), platform: "android" } })).json()).toEqual({ ok: true, push: false });
      expect((await tokens.get("u1", "j1"))!.token).toBe(TOKEN);
      // the activity ended: no token, and it is forgotten
      expect((await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u1"), payload: { jobId: "j1", token: null, platform: "ios" } })).json()).toEqual({ ok: true, push: true, removed: true });
      expect(await tokens.get("u1", "j1")).toBeNull();
    } finally { setJobChangeHook(null); }
  });

  it("wires the pusher to every job change once it is configured", async () => {
    const { app, h2 } = served(SETTINGS);
    try {
      await app.inject({ method: "POST", url: "/v1/widgets/activity-token", headers: who("u1"), payload: { jobId: "j1", token: TOKEN } });
      liveJob("u1", "j1");
      await new Promise((r) => setTimeout(r, 1700));
      expect(h2.sent).toHaveLength(1);
      expect(h2.sent[0]!.body.aps["content-state"]).toMatchObject({ phase: "working", task: "Fix cart", stage: 1 });
    } finally { setJobChangeHook(null); }
  });
});

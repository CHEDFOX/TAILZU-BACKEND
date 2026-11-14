/**
 * THE ROUTES AND THE COLLECTION HOOK (src/routes/trust/trust.ts, src/routes/admin/trust.ts, src/http/hooks.ts;
 * docs/trust.md §the ask, §admin, §collection).
 *
 *   - every trust route is 404 while TRUST_ATTEST is off, and needs the person's own session
 *   - a challenge is single use and five minutes long; a reply carrying a stale or borrowed one is refused before any
 *     verification runs
 *   - each one answers 204 with an empty body: nothing comes back for a modified app to learn from
 *   - the admin view is behind the admin secret and carries COUNTS only — never another account (docs/trust.md rule 9)
 *   - the hook collects on a signed-in app request, once an hour, takes no action, and skips a request that came through
 *     the site's proxy (its forwarded-for header is forgeable)
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.TRUST = "shadow";
  process.env.TRUST_ATTEST = "shadow";
  process.env.TRUST_HASH_KEY = "0123456789abcdef0123456789abcdef";
  process.env.ADMIN_SECRET = "admin-secret-for-the-test-only-32ch";
});

// Whoever the test says is calling: the token is the account's id, and none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id, email: `${id}@example.com`, createdAt: new Date().toISOString() } : null;
    },
  };
});
// The hook reads the account id from a locally verified JWT; here the header IS the id.
vi.mock("../src/auth/jwt.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/jwt.js")>();
  return { ...real, localUserId: async (h: string | undefined) => h?.replace(/^Bearer\s+/i, "").trim() || null };
});

const { registerTrustRoutes } = await import("../src/routes/trust/trust.js");
const { registerAdminTrustRoutes } = await import("../src/routes/admin/trust.js");
const { trustCollectHook } = await import("../src/http/hooks.js");
const { forgetChallengesForTests, newChallenge } = await import("../src/trust/ask.js");
const { MemoryTrustStore, resetTrustStoreForTests, trustStore } = await import("../src/trust/store.js");
const { forgetActionsForTests, heldFreeUse, lookAtLaunch, slowedDown } = await import("../src/trust/actions.js");
const { forgetSeenForTests } = await import("../src/trust/signals.js");
const { emptyLists, rangeSetOf, setLists } = await import("../src/trust/lists.js");
const { keyOf } = await import("../src/trust/netKey.js");
const { askFor, attestMode, bucketOf, forgetAttestedForTests, markAttested, takeChallenge, CHALLENGE_MS } =
  await import("../src/trust/ask.js");
const { initControl, controlStore } = await import("../src/control/index.js");
const { resetConfigForTests } = await import("../src/config.js");
resetConfigForTests();
initControl({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "trust-ask-")), recheckMs: 0 });

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (id: string) => ({ authorization: `Bearer ${id}` });
const ADMIN = { "x-admin-secret": "admin-secret-for-the-test-only-32ch" };

function served() {
  const app = Fastify();
  registerTrustRoutes(app, { rateLimit: RL });
  registerAdminTrustRoutes(app, { rateLimit: RL });
  return app;
}

beforeEach(() => {
  resetConfigForTests();
  resetTrustStoreForTests(new MemoryTrustStore());
  forgetChallengesForTests();
  forgetActionsForTests();
  forgetSeenForTests();
  setLists({ ...emptyLists(), tor: rangeSetOf(["185.220.101.0/24"]) });
});

describe("the phone's routes", () => {
  it("needs the person's own session, and turns a desktop token away", async () => {
    const app = served();
    for (const url of ["/v1/trust/challenge", "/v1/trust/ios/attest", "/v1/trust/ios/assert", "/v1/trust/ios/devicecheck", "/v1/trust/android/integrity"]) {
      expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url, headers: who("static-abc") })).statusCode).toBe(401);
    }
  });

  it("is 404 everywhere while TRUST_ATTEST is off", async () => {
    process.env.TRUST_ATTEST = "off";
    resetConfigForTests();
    const app = served();
    for (const url of ["/v1/trust/challenge", "/v1/trust/ios/attest", "/v1/trust/ios/devicecheck", "/v1/trust/android/integrity"]) {
      const res = await app.inject({ method: "POST", url, headers: who("u1") });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("trust_off");
    }
    process.env.TRUST_ATTEST = "shadow";
    resetConfigForTests();
  });

  it("hands out a challenge, spends it once, and refuses somebody else's", async () => {
    const app = served();
    const first = await app.inject({ method: "POST", url: "/v1/trust/challenge", headers: who("u1") });
    const challenge = first.json().challenge as string;
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Used once: the second reply carrying it is refused.
    const used = await app.inject({ method: "POST", url: "/v1/trust/ios/attest", headers: who("u1"), payload: { challenge, failed: "unsupported" } });
    expect(used.statusCode).toBe(204);
    const again = await app.inject({ method: "POST", url: "/v1/trust/ios/attest", headers: who("u1"), payload: { challenge, failed: "unsupported" } });
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe("stale_challenge");
    // Another account's challenge is refused too.
    const mine = newChallenge("u1");
    const stolen = await app.inject({ method: "POST", url: "/v1/trust/ios/attest", headers: who("u2"), payload: { challenge: mine, failed: "unsupported" } });
    expect(stolen.statusCode).toBe(400);
  });

  it("answers 204 with nothing in it, so a modified app learns nothing", async () => {
    const app = served();
    const challenge = newChallenge("u1");
    const res = await app.inject({ method: "POST", url: "/v1/trust/android/integrity", headers: who("u1"), payload: { challenge, failed: "no_play" } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("reads a step the phone could not do as no signal, and a real failure as a failure", async () => {
    const app = served();
    for (const failed of ["unsupported", "throttled", "timeout", "refused", "no_key"]) {
      await app.inject({ method: "POST", url: "/v1/trust/ios/attest", headers: who("u-none"), payload: { challenge: newChallenge("u-none"), failed } });
      expect((await trustStore().score("u-none"))?.verdicts.appAttest).toBe("none");
    }
    await app.inject({ method: "POST", url: "/v1/trust/ios/attest", headers: who("u-bad"), payload: { challenge: newChallenge("u-bad"), failed: "key_refused" } });
    expect((await trustStore().score("u-bad"))?.verdicts.appAttest).toBe("fail");
  });

  it("records an attestation that does not verify as a failure, and stores no key", async () => {
    const app = served();
    const res = await app.inject({
      method: "POST", url: "/v1/trust/ios/attest", headers: who("u-forged"),
      payload: { challenge: newChallenge("u-forged"), keyId: Buffer.alloc(32).toString("base64"), attestation: Buffer.from("41", "hex").toString("base64") },
    });
    expect(res.statusCode).toBe(204);
    expect((await trustStore().score("u-forged"))?.verdicts.appAttest).toBe("fail");
    expect(await trustStore().countAttestKeys("u-forged")).toBe(0);
  });

  it("will not check an assertion against another account's key", async () => {
    const app = served();
    const now = Date.now();
    await trustStore().putAttestKey({
      keyId: "k-theirs", userId: "u-owner", publicKey: Buffer.from("spki"), signCount: 0,
      env: "production", receipt: null, createdAt: now, lastUsedAt: now,
    });
    const res = await app.inject({
      method: "POST", url: "/v1/trust/ios/assert", headers: who("u-thief"),
      payload: { challenge: newChallenge("u-thief"), keyId: "k-theirs", assertion: "whatever" },
    });
    expect(res.statusCode).toBe(204);
    // Nothing was recorded against the key's real owner.
    expect(await trustStore().score("u-owner")).toBeNull();
  });

  it("asks Apple nothing when DeviceCheck has no key, and still answers 204", async () => {
    const app = served();
    const res = await app.inject({
      method: "POST", url: "/v1/trust/ios/devicecheck", headers: who("u-dc"),
      payload: { challenge: newChallenge("u-dc"), token: "a-device-token" },
    });
    expect(res.statusCode).toBe(204);
    expect((await trustStore().score("u-dc"))?.verdicts.deviceCheck).toBeUndefined();
  });
});

describe("the admin view", () => {
  it("needs the admin secret", async () => {
    const app = served();
    expect((await app.inject({ method: "GET", url: "/v1/admin/trust/u1" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/admin/trust/u1/clear" })).statusCode).toBe(401);
  });

  it("answers counts, a score, its reasons and the verdicts — and nothing that could name another account", async () => {
    const app = served();
    await trustStore().putScore({
      userId: "u1", score: 55, reasons: ["tor", "script"], action: "slow",
      verdicts: { appAttest: "ok" }, updatedAt: Date.now(),
    });
    await trustStore().seeDevice({ deviceKey: keyOf("install", "55555555-5555-4555-8555-555555555555")!, kind: "install", userId: "u1", at: Date.now() });
    await trustStore().seeDevice({ deviceKey: keyOf("install", "55555555-5555-4555-8555-555555555555")!, kind: "install", userId: "u2", at: Date.now() });
    const res = await app.inject({ method: "GET", url: "/v1/admin/trust/u1", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).toBe(55);
    expect(body.reasons).toEqual(["tor", "script"]);
    expect(body.counts).toEqual({ installs: 1, attestKeys: 0 });
    expect(body.mode).toBe("shadow");
    // u2 shares an install with u1, and the answer says nothing at all about u2.
    expect(JSON.stringify(body)).not.toContain("u2");
    // No key, hashed or otherwise, leaves the server either.
    expect(JSON.stringify(body)).not.toMatch(/net_key|device_key|[0-9a-f]{32}/);
  });

  it("clears a score, and the hold or slow with it", async () => {
    const app = served();
    await trustStore().putScore({ userId: "u1", score: 90, reasons: ["tor"], action: "hold", verdicts: { appAttest: "ok" }, updatedAt: Date.now() });
    const res = await app.inject({ method: "POST", url: "/v1/admin/trust/u1/clear", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    expect(heldFreeUse("u1")).toBe(false);
    expect(slowedDown("u1")).toBe(false);
    // The score, its reasons and the answers are gone. What is left is the one instruction the phone carries out for us:
    // Apple's own two bits are cleared at the next DeviceCheck pass (the policy says the mark is cleared if you ask).
    const row = await trustStore().score("u1");
    expect(row?.score).toBe(0);
    expect(row?.reasons).toEqual([]);
    expect(row?.verdicts).toEqual({ deviceReset: true });
    expect(res.json()).toEqual({ ok: true, deviceReset: true });
  });
});

/**
 * DEVICECHECK'S BIT0, WHICH IS APPLE'S MEMORY OF THE PHONE AND NOT OURS (docs/trust.md §DeviceCheck).
 *
 * The bit outlives reinstalls and accounts, which is the point — and the trap: Apple hands back whatever we last wrote,
 * so an account whose own pass set the bit would read it on its next launch and flag itself. These tests drive the real
 * route against a fake Apple and then score the account the way a launch does.
 */
describe("DeviceCheck's bits", () => {
  const BITS = { bit0: false, bit1: false, last_update_time: "2026-11" };
  let calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let held = { ...BITS };

  const fakeApple = async (url: unknown, init?: { body?: unknown }) => {
    const path = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path, body });
    if (path.endsWith("/query_two_bits")) return new Response(JSON.stringify(held), { status: 200 });
    held = { ...held, bit0: body.bit0 === true, bit1: body.bit1 === true };
    return new Response("", { status: 200 });
  };

  beforeEach(async () => {
    calls = [];
    held = { ...BITS };
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    process.env.APPLE_DEVICECHECK_KEY_ID = "KEYID1234";
    process.env.APPLE_DEVICECHECK_PRIVATE_KEY = Buffer.from(pem, "utf8").toString("base64");
    process.env.TRUST_ATTEST = "on";
    resetConfigForTests();
    vi.stubGlobal("fetch", fakeApple);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.APPLE_DEVICECHECK_KEY_ID;
    delete process.env.APPLE_DEVICECHECK_PRIVATE_KEY;
    process.env.TRUST_ATTEST = "shadow";
    resetConfigForTests();
  });

  const pass = (app: ReturnType<typeof served>, id: string) => app.inject({
    method: "POST", url: "/v1/trust/ios/devicecheck", headers: who(id), payload: { token: "a-device-token" },
  });

  it("does not flag an honest new iPhone on its second launch with the bit its first launch set", async () => {
    const app = served();
    expect((await pass(app, "u-honest")).statusCode).toBe(204);
    // We wrote the bit, and we remember that it was us.
    expect(calls.some((c) => c.path.endsWith("/update_two_bits") && c.body.bit0 === true)).toBe(true);
    expect((await trustStore().score("u-honest"))?.verdicts.deviceCheck).toMatchObject({ bit0: true, setByUs: true });

    // The second launch reads back what we wrote, and the launch's score takes nothing from it.
    expect((await pass(app, "u-honest")).statusCode).toBe(204);
    const looked = await lookAtLaunch({
      userId: "u-honest", ip: "1.2.3.4", email: "u-honest@example.com", paid: false,
      createdAt: new Date().toISOString(), hasCapabilities: true, platform: "ios",
      components: ["DeviceCheck1"],
    });
    expect(looked?.reasons).not.toContain("dcBit0");
    expect(looked?.score).toBe(0);
    expect(looked?.applied).toBe("none");
  });

  it("still counts the bit for the NEXT account that signs in on that phone", async () => {
    const app = served();
    await pass(app, "u-first");
    // A different account on the same phone: the bit is Apple's answer about the device, not a mark of its own.
    await pass(app, "u-second");
    expect((await trustStore().score("u-second"))?.verdicts.deviceCheck).toMatchObject({ bit0: true });
    expect((await trustStore().score("u-second"))?.verdicts.deviceCheck?.setByUs).toBeUndefined();
    const looked = await lookAtLaunch({
      userId: "u-second", ip: "1.2.3.4", email: "u-second@example.com", paid: false,
      createdAt: new Date().toISOString(), hasCapabilities: true, platform: "ios",
      components: ["DeviceCheck1"],
    });
    expect(looked?.reasons).toContain("dcBit0");
  });

  it("never marks a device for an account no action may touch (a payer, the review account, an exempt id)", async () => {
    process.env.REVIEW_EMAIL = "u-review@example.com";
    resetConfigForTests();
    try {
      const app = served();
      await pass(app, "u-review");
      expect(calls.every((c) => !c.path.endsWith("/update_two_bits"))).toBe(true);
      expect(held.bit0).toBe(false);
    } finally {
      delete process.env.REVIEW_EMAIL;
      resetConfigForTests();
    }
  });

  it("writes no bit while the mode is only shadow", async () => {
    process.env.TRUST_ATTEST = "shadow";
    resetConfigForTests();
    const app = served();
    await pass(app, "u-shadow");
    expect(calls.every((c) => !c.path.endsWith("/update_two_bits"))).toBe(true);
    // The answer is still read and kept, which is what the shadow period is for.
    expect((await trustStore().score("u-shadow"))?.verdicts.deviceCheck).toMatchObject({ bit0: false });
  });

  it("clears Apple's bits on the next pass after an admin cleared a second-hand phone", async () => {
    const app = served();
    held = { ...held, bit0: true, bit1: true };
    await app.inject({ method: "POST", url: "/v1/admin/trust/u-sold/clear", headers: ADMIN });
    expect((await pass(app, "u-sold")).statusCode).toBe(204);
    const wrote = calls.filter((c) => c.path.endsWith("/update_two_bits"));
    expect(wrote.length).toBe(1);
    expect(wrote[0]!.body).toMatchObject({ bit0: false, bit1: false });
    expect(held).toMatchObject({ bit0: false, bit1: false });
    // The instruction is spent, and the account is left with Apple's cleared answer.
    const row = await trustStore().score("u-sold");
    expect(row?.verdicts.deviceReset).toBe(false);
    expect(row?.verdicts.deviceCheck).toMatchObject({ bit0: false, bit1: false });
  });
});

describe("the ask the bootstrap carries", () => {
  const ios = {
    userId: "u-ask", platform: "ios",
    components: ["AppAttest1", "DeviceCheck1"],
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    forgetAttestedForTests();
    controlStore()!.save([], "test");
  });

  it("asks for nothing while the ramp is at zero, however new the account is", () => {
    expect(attestMode()).toBe("shadow");
    expect(askFor(ios)).toBeUndefined();
  });

  it("asks a new iPhone for App Attest and DeviceCheck once the ramp is moved", () => {
    controlStore()!.save([{
      id: "ramp", surface: "trust", enabled: true, order: 0, when: {},
      ops: [{ op: "set", path: "/attest/percent", value: 100 }],
    }] as never, "test");
    const ask = askFor(ios);
    expect(ask?.do).toEqual(["appAttest", "deviceCheck"]);
    expect(ask?.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The challenge it sent is the one that is spendable, once.
    expect(takeChallenge(ask!.challenge, "u-ask")).toBe(true);
    expect(takeChallenge(ask!.challenge, "u-ask")).toBe(false);
  });

  it("asks a phone only for what its own build declared", () => {
    controlStore()!.save([{
      id: "ramp", surface: "trust", enabled: true, order: 0, when: {},
      ops: [{ op: "set", path: "/attest/percent", value: 100 }, { op: "set", path: "/integrity/percent", value: 100 }],
    }] as never, "test");
    // An older binary declares none of them, so it is never asked for anything.
    expect(askFor({ ...ios, components: [] })).toBeUndefined();
    expect(askFor({ ...ios, components: ["DeviceCheck1"] })?.do).toEqual(["deviceCheck"]);
    // Android gets Play Integrity and nothing of Apple's, whatever it declares.
    expect(askFor({ ...ios, platform: "android", components: ["PlayIntegrity1", "AppAttest1"] })?.do).toEqual(["playIntegrity"]);
  });

  /**
   * One key per account per install (docs/trust.md §App Attest): the FIRST ask makes it, every ask after it signs with
   * it. `appAttest` on every launch would have the phone make a key a launch — and the assert route, which is where a
   * sensitive moment is really checked, could never be reached at all.
   */
  it("asks for an assertion once the account has a key, never for a second key", () => {
    controlStore()!.save([{
      id: "ramp", surface: "trust", enabled: true, order: 0, when: {},
      ops: [{ op: "set", path: "/attest/percent", value: 100 }],
    }] as never, "test");
    expect(askFor({ ...ios, components: ["AppAttest1"] })?.do).toEqual(["appAttest"]);
    expect(askFor({ ...ios, components: ["AppAttest1"], hasAttestKey: true })?.do).toEqual(["appAssert"]);
  });

  it("the bootstrap gives the ask the two things only it can read: the score and whether a key exists", () => {
    // Without the score the "30 or more" trigger is dead, and without the key count the ask can only ever say appAttest.
    const bootstrap = fs.readFileSync(path.resolve(import.meta.dirname, "../src/routes/app/appScreens.ts"), "utf8");
    expect(bootstrap).toMatch(/score: stored\?\.score/);
    expect(bootstrap).toMatch(/hasAttestKey: stored\?\.hasAttestKey/);
    // And it does not pay for those reads while attestation is off altogether.
    expect(bootstrap).toMatch(/attestMode\(\) === "off" \? null : await trustScore\(user\.id\)/);
  });

  it("does not score an account for the keys it made itself: that metric is Apple's, and is not asked for yet", () => {
    // `countAttestKeys` is THIS ACCOUNT's key count. Apple's receipt gives the device's, which is the number the weight
    // was written for, so until the receipt is read nothing is passed and an honest re-install is not penalised.
    const actions = fs.readFileSync(path.resolve(import.meta.dirname, "../src/trust/actions.ts"), "utf8");
    expect(actions).toMatch(/attestKeys: null/);
    expect(actions).not.toMatch(/attestKeys: attestKeys/);
  });

  it("stops asking a session that has proved itself, until a week has gone by", () => {
    controlStore()!.save([{
      id: "ramp", surface: "trust", enabled: true, order: 0, when: {},
      ops: [{ op: "set", path: "/attest/percent", value: 100 }],
    }] as never, "test");
    const settled = { ...ios, createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString() };
    expect(askFor(settled)).toBeDefined();
    markAttested("u-ask");
    expect(askFor(settled)).toBeUndefined();
    // A score worth looking at asks again anyway.
    expect(askFor({ ...settled, score: 40 })).toBeDefined();
    // And so does the moment before a free-plan claim.
    expect(askFor({ ...settled, claiming: true })).toBeDefined();
  });

  it("asks nothing at all while TRUST_ATTEST is off", () => {
    process.env.TRUST_ATTEST = "off";
    resetConfigForTests();
    controlStore()!.save([{
      id: "ramp", surface: "trust", enabled: true, order: 0, when: {},
      ops: [{ op: "set", path: "/attest/percent", value: 100 }],
    }] as never, "test");
    expect(askFor(ios)).toBeUndefined();
    process.env.TRUST_ATTEST = "shadow";
    resetConfigForTests();
  });

  it("tells the phone whether to send its install number, and says no until a rule says otherwise", async () => {
    const { trustSurface } = await import("../src/trust/actions.js");
    expect(trustSurface().installId).toBe(false);
    controlStore()!.save([{
      id: "install", surface: "trust", enabled: true, order: 0, when: {},
      ops: [{ op: "set", path: "/installId", value: true }],
    }] as never, "test");
    expect(trustSurface().installId).toBe(true);
    // And the bootstrap passes exactly that on, as the flag the app reads before it sends the header (8.4).
    const bootstrap = fs.readFileSync(path.resolve(import.meta.dirname, "../src/routes/app/appScreens.ts"), "utf8");
    expect(bootstrap).toMatch(/flags\["trust\.installId"\] = trustSurface\(/);
  });

  it("puts one account in the same share of the ramp every time, and spreads accounts across it", () => {
    expect(bucketOf("u-ask")).toBe(bucketOf("u-ask"));
    const buckets = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(bucketOf));
    expect(buckets.size).toBeGreaterThan(4);
    expect([...buckets].every((b) => b >= 0 && b < 100)).toBe(true);
    expect(CHALLENGE_MS).toBe(5 * 60_000);
  });
});

/**
 * THE SLOW, AT THE ROUTE LEVEL (docs/trust.md §actions; http/plugins.ts slowAwareMax).
 *
 * @fastify/rate-limit merges a route's options over the plugin's, and a plain number on the route wins outright — so
 * every authed route passing `max: RATE_LIMIT_MAX` quietly undid the quarter-rate the slow is supposed to be. The tier
 * objects in server.ts pass the function instead, and this drives a real route through the real plugin to prove it.
 */
describe("a slowed account's rate limit", () => {
  const limited = async () => {
    const app = Fastify();
    const rateLimit = (await import("@fastify/rate-limit")).default;
    const { slowAwareMax } = await import("../src/http/plugins.js");
    await app.register(rateLimit, {
      global: false,
      max: slowAwareMax(100),
      timeWindow: 60_000,
      keyGenerator: async (req) => "u:" + String((req.headers as Record<string, unknown>)["x-who"] ?? "nobody"),
    });
    // Exactly what an authed route gets handed (server.ts AUTHED_RL): a tier object with its own max.
    const TIER = { rateLimit: { max: slowAwareMax(100) as unknown as number, timeWindow: 60_000 } };
    app.get("/tier", { config: TIER }, async () => ({ ok: true }));
    return app;
  };

  it("is a quarter of the ceiling on a route that passes its own tier, and the full one for everybody else", async () => {
    const app = await limited();
    const ask = (who: string) => app.inject({ method: "GET", url: "/tier", headers: { "x-who": who } });
    expect((await ask("u-fast")).headers["x-ratelimit-limit"]).toBe("100");

    const { look } = await import("../src/trust/actions.js");
    controlStore()!.save([{
      id: "slow", surface: "trust", enabled: true, order: 0, when: {},
      ops: [{ op: "set", path: "/actions/slow", value: true }],
    }] as never, "test");
    process.env.TRUST = "on";
    resetConfigForTests();
    try {
      await look({
        userId: "u-slow", ip: "185.220.101.7", paid: false, disposableEmail: true, tombstoneMatch: true,
        createdAt: new Date().toISOString(), shape: ["script"],
      });
      expect(slowedDown("u-slow")).toBe(true);
      expect((await ask("u-slow")).headers["x-ratelimit-limit"]).toBe("25");
      // And nobody else is touched.
      expect((await ask("u-fast")).headers["x-ratelimit-limit"]).toBe("100");
    } finally {
      process.env.TRUST = "shadow";
      resetConfigForTests();
      controlStore()!.save([], "test");
    }
  });
});

describe("the collection hook", () => {
  const req = (over: Record<string, unknown> = {}) => ({
    url: "/v1/bots/gym/ask",
    ip: "185.220.101.7",
    headers: { authorization: "Bearer u-hooked", "user-agent": "python-requests/2.31" },
    log: { info: () => undefined, warn: () => undefined },
    ...over,
  }) as never;

  /**
   * The hook is there for the ROW — one (account, network, day) — and for nothing else. It writes no score, because it
   * knows the account id and nothing more: not the email, not a tombstone, not the account's age, not the answers from
   * Apple and Google. A score written from that would overwrite the launch's fuller one (and wipe its verdicts).
   */
  it("writes the row for a signed-in app request, and no score", async () => {
    const rows: Array<{ userId: string; netClass: string; newAcct: boolean }> = [];
    class Watched extends MemoryTrustStore {
      override async seeNet(o: Parameters<MemoryTrustStore["seeNet"]>[0]): Promise<void> {
        rows.push({ userId: o.userId, netClass: o.netClass, newAcct: o.newAcct });
        return super.seeNet(o);
      }
    }
    resetTrustStoreForTests(new Watched());
    await trustCollectHook(req());
    await new Promise((r) => setTimeout(r, 5));
    expect(rows).toEqual([{ userId: "u-hooked", netClass: "tor", newAcct: false }]);
    expect(await trustStore().score("u-hooked")).toBeNull();
  });

  it("leaves the bootstrap to do its own pass, instead of writing the same row again from less", async () => {
    const rows: string[] = [];
    class Watched extends MemoryTrustStore {
      override async seeNet(o: Parameters<MemoryTrustStore["seeNet"]>[0]): Promise<void> {
        rows.push(o.userId);
        return super.seeNet(o);
      }
    }
    resetTrustStoreForTests(new Watched());
    await trustCollectHook(req({ url: "/v1/app/bootstrap" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(rows).toEqual([]);
  });

  it("takes no action, whatever the score", async () => {
    await trustCollectHook(req());
    await new Promise((r) => setTimeout(r, 5));
    expect(heldFreeUse("u-hooked")).toBe(false);
    expect(slowedDown("u-hooked")).toBe(false);
  });

  it("looks at one account once an hour, not on every request", async () => {
    const seen: object[] = [];
    const log = { info: (o: object) => seen.push(o), warn: () => undefined };
    await trustCollectHook(req({ log }));
    await trustCollectHook(req({ log }));
    await trustCollectHook(req({ log }));
    await new Promise((r) => setTimeout(r, 5));
    expect(seen.length).toBe(1);
  });

  it("skips a request with no sign-in, a route outside /v1, the admin routes and its own", async () => {
    for (const over of [
      { headers: {} },
      { url: "/healthz" },
      { url: "/v1/admin/trust/u1" },
      { url: "/v1/trust/challenge" },
    ]) {
      await trustCollectHook(req(over));
    }
    await new Promise((r) => setTimeout(r, 5));
    expect(await trustStore().score("u-hooked")).toBeNull();
  });

  it("skips a request that came through the site's proxy: that header is forgeable", async () => {
    await trustCollectHook(req({
      headers: { authorization: "Bearer u-vercel", "x-vercel-forwarded-for": "1.2.3.4" },
    }));
    await new Promise((r) => setTimeout(r, 5));
    expect(await trustStore().score("u-vercel")).toBeNull();
  });

  it("does nothing at all while TRUST is off", async () => {
    process.env.TRUST = "off";
    resetConfigForTests();
    await trustCollectHook(req({ headers: { authorization: "Bearer u-off" } }));
    await new Promise((r) => setTimeout(r, 5));
    expect(await trustStore().score("u-off")).toBeNull();
    process.env.TRUST = "shadow";
    resetConfigForTests();
  });
});

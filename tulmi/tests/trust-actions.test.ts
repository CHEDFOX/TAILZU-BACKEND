/**
 * WHAT A SCORE ACTUALLY DOES, AND WHO IT MAY NEVER DO IT TO (src/trust/actions.ts; docs/trust.md §actions).
 *
 *   - TRUST=off collects nothing at all; shadow writes the row and the score and changes NOTHING a person can feel
 *   - a payer, the review account, an exempt id and the desktop's static tokens are scored and never acted on
 *   - the hold is the free month's one allowance (you/usage.ts planOf) and no earned words (usage/allowance.ts), and the
 *     refusal past it is the 429 quota_exceeded the apps already show — no new screen, no app update
 *   - the slow is the free plan's single slot (guard/limiter.ts) and a quarter of the rate limit
 *   - the hook that sees every request (collectOnly) never takes an action, whatever the score
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.TRUST = "on";
  process.env.TRUST_HASH_KEY = "0123456789abcdef0123456789abcdef";
  process.env.REVIEW_EMAIL = "review@x0bot.com";
  // The product ships free for everyone (Lite's five stretches), which is what the hold takes away; the suite turns it off
  // by default, so this file turns it back on to show the difference the hold makes.
  process.env.FREE_FOR_ALL = "true";
  process.env.QUOTA_EXEMPT_USER_IDS = "exempt-one";
});

const {
  clearLive, forgetActionsForTests, heldFreeUse, look, neverActOn, noteVerdicts, slowedDown, trustMode, trustSurface,
} = await import("../src/trust/actions.js");
const { MemoryTrustStore, resetTrustStoreForTests } = await import("../src/trust/store.js");
const { forgetSeenForTests, sessionMoved, forgetSessionsForTests, shapeOf, skipCollection, tlsHints } =
  await import("../src/trust/signals.js");
const { setLists, loadLists, rangeSetOf, emptyLists } = await import("../src/trust/lists.js");
const { planOf } = await import("../src/you/usage.js");
const { installHoldCheck } = await import("../src/you/usage.js");
const { installSlowCheck, ConcurrencyLimiter } = await import("../src/guard/limiter.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");
const { initControl, controlStore } = await import("../src/control/index.js");
resetConfigForTests();

// The action switches live in the control plane's "trust" surface, so the tests below turn one on the way the console does:
// a real rule, saved to a real store. Nothing is mocked, and the rule is the same shape the owner will save.
const CONTROL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "trust-control-"));
initControl({ dir: CONTROL_DIR, recheckMs: 0 });

function turnOn(...which: Array<"slow" | "hold" | "ask">): void {
  controlStore()!.save([{
    id: "trust-actions",
    surface: "trust",
    enabled: true,
    order: 0,
    when: {},
    ops: which.map((w) => ({ op: "set" as const, path: `/actions/${w}`, value: true })),
  }], "test");
}
function turnOffEverything(): void {
  controlStore()!.save([], "test");
}

/**
 * Now, really now: the hold and the slow are read by planOf and the limiter against the real clock (they are what the
 * running server asks), so a fixed hour in the past would have run out before the assertion.
 */
const NOW = Date.now();
/** Tor's exits. Each test uses its OWN address out of the range, so one test's accounts are not counted against another's. */
const TOR_IP = "185.220.101.9";
const tor = (n: number) => `185.220.101.${n}`;

function withTor(): void {
  setLists({ ...emptyLists(), tor: rangeSetOf(["185.220.101.0/24"]) });
}

beforeEach(() => {
  resetConfigForTests();
  resetTrustStoreForTests(new MemoryTrustStore());
  forgetActionsForTests();
  forgetSeenForTests();
  forgetSessionsForTests();
  installHoldCheck(heldFreeUse);
  installSlowCheck(slowedDown);
  withTor();
  turnOffEverything();
});

/** Scores: Tor (40) plus a script-shaped request (20) plus a crossed claim (20) is 80, which reaches "hold". */
const BAD = { shape: ["script", "mismatch"] as const };
/** Two days old: inside the hold's seven days, past the new-account multiplier's first 24 hours. */
const TWO_DAYS = new Date(NOW - 2 * 86_400_000).toISOString();

describe("the switches", () => {
  it("is off by default, and off means off", async () => {
    process.env.TRUST = "off";
    resetConfigForTests();
    expect(trustMode()).toBe("off");
    expect(await look({ userId: "u1", ip: TOR_IP, paid: false, now: NOW })).toBeNull();
    process.env.TRUST = "on";
    resetConfigForTests();
  });

  it("is off, whatever TRUST says, while there is no key to hash with", async () => {
    delete process.env.TRUST_HASH_KEY;
    resetConfigForTests();
    expect(trustMode()).toBe("off");
    expect(await look({ userId: "u1", ip: TOR_IP, paid: false, now: NOW })).toBeNull();
    process.env.TRUST_HASH_KEY = "0123456789abcdef0123456789abcdef";
    resetConfigForTests();
  });

  it("ships with every action false, so a deploy can reach `on` and still do nothing", () => {
    expect(trustSurface().actions).toEqual({ slow: false, hold: false, ask: false });
  });
});

describe("shadow writes everything down and changes nothing", () => {
  it("scores and stores, and holds or slows nobody", async () => {
    process.env.TRUST = "shadow";
    resetConfigForTests();
    const lines: object[] = [];
    turnOn("hold", "slow");
    const got = await look({
      userId: "u-shadow", ip: tor(21), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW,
      ctx: {}, log: { info: (o) => lines.push(o), warn: () => undefined },
    });
    expect(got?.mode).toBe("shadow");
    expect(got?.action).toBe("hold");
    expect(got?.applied).toBe("none");
    expect(heldFreeUse("u-shadow", NOW)).toBe(false);
    expect(slowedDown("u-shadow", NOW)).toBe(false);
    // The line says what it WOULD have done, and carries ids and counts only.
    expect(lines.length).toBe(1);
    expect(JSON.stringify(lines[0])).toContain('"would":"hold"');
    expect(JSON.stringify(lines[0])).not.toContain(TOR_IP);
    const row = await (await import("../src/trust/store.js")).trustStore().score("u-shadow");
    expect(row?.score).toBeGreaterThan(0);
    expect(row?.action).toBe("log");
    process.env.TRUST = "on";
    resetConfigForTests();
  });
});

describe("who is never acted on", () => {
  it("names a payer, the review account, an exempt id and a desktop token", () => {
    expect(neverActOn({ userId: "u1", paid: true })).toBe(true);
    expect(neverActOn({ userId: "u1", email: "review@x0bot.com" })).toBe(true);
    expect(neverActOn({ userId: "u1", email: "REVIEW@x0bot.com " })).toBe(true);
    expect(neverActOn({ userId: "exempt-one" })).toBe(true);
    expect(neverActOn({ userId: "static-abc123" })).toBe(true);
    expect(neverActOn({ userId: "dev-user" })).toBe(true);
    expect(neverActOn({ userId: "u1", email: "someone@example.com", paid: false })).toBe(false);
    expect(getConfig().REVIEW_EMAIL).toBe("review@x0bot.com");
  });

  it("still scores them, but holds and slows nothing", async () => {
    turnOn("hold", "slow");
    for (const who of [
      { userId: "payer", paid: true },
      { userId: "reviewer", paid: false, email: "review@x0bot.com" },
      { userId: "exempt-one", paid: false },
      { userId: "static-abc", paid: false },
    ]) {
      const got = await look({ ...who, ip: TOR_IP, ...BAD, createdAt: TWO_DAYS, now: NOW });
      expect(got?.score).toBeGreaterThan(0);
      expect(got?.applied).toBe("none");
      expect(heldFreeUse(who.userId, NOW)).toBe(false);
      expect(slowedDown(who.userId, NOW)).toBe(false);
    }
  });

  it("takes no action from the hook that sees every request, whatever the score", async () => {
    turnOn("hold", "slow");
    const got = await look({ userId: "u-hook", ip: tor(22), paid: false, collectOnly: true, ...BAD, createdAt: TWO_DAYS, now: NOW });
    expect(got?.action).toBe("hold");
    expect(got?.applied).toBe("none");
    expect(heldFreeUse("u-hook", NOW)).toBe(false);
  });
});

describe("the hold", () => {
  it("only ever touches a new account with no payment, and only while its switch is on", async () => {
    // Its own switch off (the default): nothing is applied, however bad the score.
    const dark = await look({ userId: "u-dark", ip: tor(11), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW });
    expect(dark?.action).toBe("hold");
    expect(dark?.applied).toBe("none");
    turnOn("hold");
    // 40 days old: too settled to hold, however bad the score.
    const old = await look({ userId: "u-old", ip: tor(12), paid: false, ...BAD, createdAt: new Date(NOW - 40 * 86_400_000).toISOString(), now: NOW });
    expect(old?.applied).toBe("none");
    const fresh = await look({ userId: "u-new", ip: tor(13), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW });
    expect(fresh?.applied).toBe("hold");
    expect(heldFreeUse("u-new", NOW)).toBe(true);
    // A payer with the same score is never held.
    const payer = await look({ userId: "u-payer", ip: tor(14), paid: true, ...BAD, createdAt: TWO_DAYS, now: NOW });
    expect(payer?.applied).toBe("none");
  });

  it("gives the free month's one allowance instead of Lite's five stretches, and nothing else", async () => {
    const c = getConfig();
    const free = planOf(null, c);
    expect(free.stretchPaise).not.toBeNull();
    turnOn("hold");
    await look({ userId: "u-held", ip: tor(15), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW });
    const held = planOf(null, c, { userId: "u-held" });
    expect(held.stretchPaise).toBeNull();
    expect(held.windows).toBe(false);
    expect(held.monthPaise).toBeLessThan(free.monthPaise);
    // The same name and the same screens as any free account: nothing on a screen says "held".
    expect(held.name).toBe("Free");
    expect(held.paid).toBe(false);
    // Somebody else is untouched.
    expect(planOf(null, c, { userId: "u-other" }).stretchPaise).not.toBeNull();
  });

  /**
   * THE HOLD HAS TO REACH THE METER ITSELF. `planOf` is read in exactly one place (you/limits.ts, where the meter reads
   * the plan), and that read is what decides how much may be spent: without the account id in it the hold was a no-op on
   * spend, and a held account kept Lite's five stretches — $35 of real model spend — while the log said it was held.
   */
  it("reaches the usage meter, so a held account really is on the free month's allowance", async () => {
    const { Spending } = await import("../src/you/limits.js");
    const { MemoryYouStore } = await import("../src/you/store.js");
    const meterFor = (userId: string) => {
      const store = new MemoryYouStore();
      return { store, spending: new Spending({ store, jobs: null, entitlement: async () => null, now: () => NOW }) };
    };

    // Free for everyone, as it ships: five stretches, and the meter says so.
    const open = meterFor("u-meter-open");
    const openNow = await open.spending.usage("u-meter-open");
    expect(openNow.plan.windows).toBe(true);
    expect(openNow.stretch.of).toBe(5);

    turnOn("hold");
    await look({ userId: "u-meter", ip: tor(18), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW });
    expect(heldFreeUse("u-meter")).toBe(true);
    const held = meterFor("u-meter");
    const heldNow = await held.spending.usage("u-meter");
    // The free month's one allowance: no stretches, and far less of it than Lite's.
    expect(heldNow.plan.windows).toBe(false);
    expect(heldNow.stretch.of).toBe(1);
    expect(heldNow.allowancePaise).toBeLessThan(openNow.allowancePaise);

    // And the refusal past that allowance is the 429 the apps already show.
    const spend = heldNow.allowancePaise + 1;
    await held.store.addSpend("u-meter", "ask", spend, NOW);
    held.spending.forget("u-meter");
    const refusal = await held.spending.refusal("u-meter");
    expect(refusal?.code).toBe("quota_exceeded");
    expect(refusal?.reason).toBe("usage_limit");
    // An account that is not held is nowhere near its limit on the same spend.
    await open.store.addSpend("u-meter-open", "ask", spend, NOW);
    open.spending.forget("u-meter-open");
    expect(await open.spending.refusal("u-meter-open")).toBeNull();
  });

  /**
   * The bands are a ladder: 50+ slow, 70+ hold, 85+ ask (docs/trust.md §actions). `ask` has no screen yet and stays off
   * in 9.0, so without this the very worst scores — the ones that reach `ask` — would have nothing happen to them at
   * all, while a lesser score was held.
   */
  it("falls back to the strongest action that IS switched on when a higher band is off", async () => {
    turnOn("hold", "slow");
    const worst = await look({
      userId: "u-ladder", ip: tor(19), paid: false, ...BAD, tombstoneMatch: true, sessionMoved: true,
      createdAt: TWO_DAYS, now: NOW,
    });
    expect(worst?.action).toBe("ask");
    // `ask` is off, so the hold below it applies instead.
    expect(worst?.applied).toBe("hold");
    expect(heldFreeUse("u-ladder", NOW)).toBe(true);

    // With the hold off too, the slow below that one.
    forgetActionsForTests();
    turnOn("slow");
    const slowed = await look({
      userId: "u-ladder-2", ip: tor(20), paid: false, ...BAD, tombstoneMatch: true, sessionMoved: true,
      createdAt: TWO_DAYS, now: NOW,
    });
    expect(slowed?.action).toBe("ask");
    expect(slowed?.applied).toBe("slow");
    expect(slowedDown("u-ladder-2", NOW)).toBe(true);
    expect(heldFreeUse("u-ladder-2", NOW)).toBe(false);
  });

  it("refuses past it with the 429 the apps have always shown", async () => {
    const { refusalOf, usageNow } = await import("../src/you/usage.js");
    const c = getConfig();
    turnOn("hold");
    await look({ userId: "u-429", ip: tor(16), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW });
    const plan = planOf(null, c, { userId: "u-429" });
    const spent = usageNow({ events: [{ at: NOW, paise: plan.monthPaise + 1 }], now: NOW, tzOffsetMinutes: 330, plan });
    expect(spent.state).toBe("out");
    const refusal = refusalOf(spent, NOW, 330);
    expect(refusal.code).toBe("quota_exceeded");
    expect(refusal.reason).toBe("usage_limit");
  });

  it("earns no words while it is on, and shows none either", async () => {
    const { computeAllowance } = await import("../src/usage/allowance.js");
    const moments = [{ at: NOW - 2 * 86_400_000, words: 10 }, { at: NOW - 86_400_000, words: 10 }, { at: NOW, words: 10 }];
    const normal = computeAllowance(moments, NOW, "u-earn");
    expect(normal.earned).toBeGreaterThan(0);
    expect(normal.grants.length).toBeGreaterThan(0);
    turnOn("hold");
    await look({ userId: "u-earn", ip: tor(17), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW });
    const held = computeAllowance(moments, NOW, "u-earn");
    expect(held.earned).toBe(0);
    expect(held.grants).toEqual([]);
    expect(held.perVisit).toEqual([]);
    expect(held.total).toBe(held.base);
  });

  it("runs out on its own, and an admin can clear it", async () => {
    turnOn("hold");
    await look({ userId: "u-hour", ip: tor(18), paid: false, ...BAD, createdAt: TWO_DAYS, now: NOW });
    expect(heldFreeUse("u-hour", NOW)).toBe(true);
    expect(heldFreeUse("u-hour", NOW + 61 * 60_000)).toBe(false);
    clearLive("u-hour");
    expect(heldFreeUse("u-hour", NOW)).toBe(false);
  });
});

describe("the slow", () => {
  it("is what a middling score reaches, and leaves the free plan's own numbers alone", async () => {
    turnOn("slow");
    // Tor plus a script-shaped request: 60, which is "slow" and not "hold".
    const got = await look({ userId: "u-slow", ip: tor(19), paid: false, shape: ["script"], createdAt: TWO_DAYS, now: NOW });
    expect(got?.action).toBe("slow");
    expect(got?.applied).toBe("slow");
    expect(slowedDown("u-slow", NOW)).toBe(true);
    expect(heldFreeUse("u-slow", NOW)).toBe(false);
    // And the free plan's own numbers are untouched: a slow is about speed, not about what may be used.
    expect(planOf(null, getConfig(), { userId: "u-slow" }).stretchPaise).not.toBeNull();
  });

  it("takes a slowed person down to one request at a time, however their plan reads", async () => {
    const limiter = new ConcurrencyLimiter({ global: 10, perUser: 3, perUserFree: 1, queuePerUser: 4, queueMax: 10 });
    // Not slowed: a paid person gets their three.
    const a = await limiter.acquire("paid-one", "paid");
    const b = await limiter.acquire("paid-one", "paid");
    expect(limiter.stats().active).toBe(2);
    a.release(); b.release();
    // Slowed: the second one waits instead of running.
    turnOn("slow");
    await look({ userId: "slow-one", ip: tor(20), paid: false, shape: ["script"], createdAt: TWO_DAYS, now: NOW });
    expect(slowedDown("slow-one", NOW)).toBe(true);
    const first = await limiter.acquire("slow-one", "paid");
    let second = false;
    void limiter.acquire("slow-one", "paid").then((p) => { second = true; p.release(); });
    await new Promise((r) => setTimeout(r, 5));
    expect(second).toBe(false);
    first.release();
    await new Promise((r) => setTimeout(r, 5));
    expect(second).toBe(true);
  });
});

describe("the request's own shape, and what is never collected", () => {
  it("knows a script from a phone, and a platform that does not fit its agent", () => {
    expect(shapeOf({ userAgent: "python-requests/2.31", appRoute: true })).toEqual(["script"]);
    expect(shapeOf({ userAgent: "X0 Bot/9.0 CFNetwork/1500 Darwin/24.0", platform: "ios" })).toEqual([]);
    expect(shapeOf({ userAgent: "okhttp/4.12", platform: "android" })).toEqual([]);
    expect(shapeOf({ userAgent: "okhttp/4.12", platform: "ios" })).toEqual(["mismatch"]);
    expect(shapeOf({ userAgent: "X0 Bot CFNetwork Darwin", platform: "android" })).toEqual(["mismatch"]);
    expect(shapeOf({ hasCapabilities: false })).toEqual(["mismatch"]);
    expect(shapeOf({ platform: "toaster" })).toEqual(["mismatch"]);
  });

  it("does not collect a request that came through the site's proxy, because that header is forgeable", () => {
    expect(skipCollection({ "x-vercel-forwarded-for": "1.2.3.4" })).toBe(true);
    expect(skipCollection({})).toBe(false);
  });

  it("reads the TLS hints only as three short words, and nothing longer", () => {
    expect(tlsHints({ "x-tz-tls-version": "1.3", "x-tz-tls-cipher": "TLS_AES_128_GCM_SHA256", "x-tz-tls-proto": "HTTP/2.0" }))
      .toEqual({ version: "1.3", cipher: "TLS_AES_128_GCM_SHA256", proto: "HTTP/2.0" });
    expect(tlsHints({ "x-tz-tls-version": "x".repeat(200) }).version).toBeUndefined();
  });

  /**
   * The hints are forwarded by the proxy (deploy/Caddyfile) and read for ONE thing: a caller claiming to be one of our
   * phone apps over TLS 1.0 or 1.1, which neither app can do (Apple's App Transport Security and Android's own client
   * both refuse anything below 1.2). Nothing is stored, and no hint at all says nothing.
   */
  it("reads a phone app's claim over TLS 1.0 as a mismatch, and says nothing without a hint", () => {
    const ios = { platform: "ios", appRoute: true, userAgent: "X0 Bot/900 CFNetwork/1500 Darwin/24.0" };
    expect(shapeOf(ios)).toEqual([]);
    expect(shapeOf({ ...ios, tls: { version: "tls1.3" } })).toEqual([]);
    expect(shapeOf({ ...ios, tls: { version: "tls1.2" } })).toEqual([]);
    expect(shapeOf({ ...ios, tls: { version: "tls1.0" } })).toEqual(["mismatch"]);
    expect(shapeOf({ ...ios, tls: { version: "TLSv1.1" } })).toEqual(["mismatch"]);
    // No proxy in front, or a hint we cannot read: no signal either way.
    expect(shapeOf({ ...ios, tls: {} })).toEqual([]);
    expect(shapeOf({ ...ios, tls: { version: "somethingelse" } })).toEqual([]);
    // And nothing is read for a caller that claims no platform of ours.
    expect(shapeOf({ appRoute: true, tls: { version: "tls1.0" } })).toEqual([]);
  });

  it("is read by the two collection points, so the proxy's hints and the docs say the same thing", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const caddy = fs.readFileSync(path.join(root, "deploy/Caddyfile"), "utf8");
    expect(caddy).toMatch(/header_up X-Tz-Tls-Version/);
    // Both places that score a request pass them in; neither stores them.
    for (const f of ["tulmi/src/http/hooks.ts", "tulmi/src/routes/app/appScreens.ts"]) {
      expect(fs.readFileSync(path.join(root, f), "utf8")).toMatch(/tls: tlsHints\(/);
    }
    expect(fs.readFileSync(path.join(root, "docs/trust.md"), "utf8")).toMatch(/coarse hints/);
  });

  it("writes one (account, network, day) row however many requests come", async () => {
    const store = new MemoryTrustStore();
    const young = new Date(NOW - 3600_000).toISOString();
    const first = await look({ userId: "u-once", ip: "1.2.3.4", paid: false, createdAt: young, now: NOW, store });
    const again = await look({ userId: "u-once", ip: "1.2.3.4", paid: false, createdAt: young, now: NOW + 1000, store });
    expect(first?.applied).toBe("none");
    expect(again).not.toBeNull();
    expect(await store.countAccountsOnNet((await import("../src/trust/netKey.js")).netKey("1.2.3.4")!, "2026-11-14")).toBe(1);
  });

  /**
   * Only a NEW account's row is counted (docs/trust.md §score: the 3rd and 5th NEW account on one network). An old
   * account's request still writes its row — the row is what the 30 days are about — but it is not one of the counted.
   */
  it("counts a new account's row and not a settled one's, and never counts the background hook's", async () => {
    const store = new MemoryTrustStore();
    const { netKey } = await import("../src/trust/netKey.js");
    const key = netKey("5.6.7.8")!;
    const day = "2026-11-14";
    await look({ userId: "u-old", ip: "5.6.7.8", paid: false, createdAt: new Date(NOW - 400 * 86_400_000).toISOString(), now: NOW, store });
    expect(await store.countAccountsOnNet(key, day)).toBe(0);
    await look({ userId: "u-new", ip: "5.6.7.8", paid: false, createdAt: new Date(NOW - 3600_000).toISOString(), now: NOW, store });
    expect(await store.countAccountsOnNet(key, day)).toBe(1);
    // The hook knows the account id and nothing else, so it cannot say whether the account is new: its rows never count.
    await look({ userId: "u-hook", ip: "5.6.7.8", paid: false, collectOnly: true, now: NOW, store });
    expect(await store.countAccountsOnNet(key, day)).toBe(1);
  });

  /**
   * The honest new sign-up in a shared house. Six accounts have been on that line for a year; the seventh is made today.
   * Counting every account on the line would hand that person net5 (+25, and ×1.5 for being new) for their neighbours.
   */
  it("does not score an honest new account for the accounts its housemates already have", async () => {
    const store = new MemoryTrustStore();
    const old = new Date(NOW - 400 * 86_400_000).toISOString();
    for (const id of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      await look({ userId: id, ip: "9.8.7.6", paid: false, createdAt: old, now: NOW, store });
    }
    const got = await look({ userId: "h-new", ip: "9.8.7.6", paid: false, createdAt: new Date(NOW - 60_000).toISOString(), now: NOW, store });
    expect(got?.reasons).not.toContain("net3");
    expect(got?.reasons).not.toContain("net5");
    expect(got?.score).toBe(0);
    expect(got?.applied).toBe("none");
  });

  it("calls one session moved when it is seen from a data centre and a home line, or from four networks", () => {
    expect(sessionMoved("s1", { asn: 64496, netClass: "home" }, NOW)).toBe(false);
    expect(sessionMoved("s1", { asn: 24940, netClass: "hosting" }, NOW + 1000)).toBe(true);
    expect(sessionMoved("s2", { asn: 1, netClass: "home" }, NOW)).toBe(false);
    expect(sessionMoved("s2", { asn: 2, netClass: "home" }, NOW)).toBe(false);
    expect(sessionMoved("s2", { asn: 3, netClass: "home" }, NOW)).toBe(false);
    expect(sessionMoved("s2", { asn: 4, netClass: "home" }, NOW)).toBe(true);
    // An hour later it is a fresh session as far as this is concerned.
    expect(sessionMoved("s1", { asn: 64496, netClass: "home" }, NOW + 2 * 3600_000)).toBe(false);
    expect(sessionMoved("", { asn: 1, netClass: "home" }, NOW)).toBe(false);
  });
});

describe("the verdicts kept with a score", () => {
  it("are merged in, and leave the score as it was", async () => {
    const { trustStore } = await import("../src/trust/store.js");
    await look({ userId: "u-v", ip: tor(23), paid: false, now: NOW });
    const before = await trustStore().score("u-v");
    await noteVerdicts("u-v", { appAttest: "ok" }, { now: NOW + 1000 });
    await noteVerdicts("u-v", { deviceCheck: { bit0: true, bit1: false, month: "2026-11" } }, { now: NOW + 2000 });
    const after = await trustStore().score("u-v");
    expect(after?.score).toBe(before?.score);
    expect(after?.verdicts).toMatchObject({ appAttest: "ok", deviceCheck: { bit0: true, bit1: false, month: "2026-11" } });
    // Each answer carries when it was given, which is what lets the sweeper keep the policy's 30 days.
    expect(after?.verdicts.at).toEqual({ appAttest: NOW + 1000, deviceCheck: NOW + 2000 });
  });

  /**
   * The hourly background pass must not overwrite what the launch worked out. It sees one request's network and nothing
   * else: no email, no tombstone, no install, no verdicts, not even the account's age. It used to write its own score
   * row anyway, which wiped Apple's and Google's answers and replaced the launch's fuller reasons.
   */
  it("the background pass keeps the launch's score and the answers from Apple and Google", async () => {
    const { trustStore } = await import("../src/trust/store.js");
    const store = trustStore();
    await look({
      userId: "u-keep", ip: tor(29), paid: false, disposableEmail: true,
      createdAt: new Date(NOW - 3600_000).toISOString(), now: NOW,
    });
    await noteVerdicts("u-keep", { deviceCheck: { bit0: false, bit1: true } }, { now: NOW });
    const rich = await store.score("u-keep");
    expect(rich?.reasons).toContain("disposable");

    await look({ userId: "u-keep", ip: "1.1.1.1", paid: false, collectOnly: true, now: NOW + 3600_000 });
    const after = await store.score("u-keep");
    expect(after?.reasons).toEqual(rich?.reasons);
    expect(after?.score).toBe(rich?.score);
    expect(after?.verdicts.deviceCheck).toEqual({ bit0: false, bit1: true });
  });

  it("a launch that was given no verdicts keeps the stored ones instead of blanking them", async () => {
    const { trustStore } = await import("../src/trust/store.js");
    const store = trustStore();
    await noteVerdicts("u-again", { appAttest: "ok" }, { now: NOW });
    await look({ userId: "u-again", ip: "1.2.3.4", paid: false, now: NOW + 1000 });
    expect((await store.score("u-again"))?.verdicts).toMatchObject({ appAttest: "ok" });
  });

  it("hold no token of any kind", async () => {
    const { trustStore } = await import("../src/trust/store.js");
    await noteVerdicts("u-token", { appAttest: "ok", integrity: { app: "PLAY_RECOGNIZED" } }, { now: NOW });
    const row = await trustStore().score("u-token");
    expect(JSON.stringify(row?.verdicts)).not.toMatch(/token|attestation|assertion/i);
  });
});

/** The lists are a module-level copy, so put them back for whatever runs next. */
afterAll(() => { setLists(loadLists("/nowhere-at-all")); });

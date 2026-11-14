/**
 * THE SCORE (src/trust/score.ts; docs/trust.md §the score).
 *
 * Three properties matter more than any single weight:
 *   - the score is the SUM of its reasons, so the admin view's explanation is the thing that was actually used
 *   - a MISSING answer from Apple or Google is never a penalty; a build that CLAIMED it can attest and failed is
 *   - DeviceCheck's bit0 is Apple's memory of the device, kept beyond any account of ours, so it counts for 12 months only
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
});

const { bitStillCounts, scoreOf } = await import("../src/trust/score.js");
const { TRUST_DEFAULTS } = await import("../src/trust/defaults.js");

const NOW = Date.parse("2026-11-14T10:00:00Z");
const W = TRUST_DEFAULTS.weights;
/** An account old enough that the new-account multiplier is out of the way. */
const SETTLED = 200 * 86_400_000;
const settled = { accountAgeMs: SETTLED, now: NOW } as const;

describe("the score is the sum of its reasons", () => {
  it("adds up exactly the weights of the reasons it names", () => {
    const got = scoreOf({ netClass: "tor", disposableEmail: true, shape: ["script"], ...settled });
    expect(got.reasons).toEqual(["tor", "disposable", "script"]);
    expect(got.score).toBe(W.tor + W.disposable + W.script);
  });

  it("scores a home or mobile line, the relay and an unknown network at nothing", () => {
    for (const netClass of ["home", "mobile", "relay", "unknown"] as const) {
      expect(scoreOf({ netClass, ...settled }).score).toBe(0);
    }
  });

  it("counts the 3rd account on one network, then the 5th, and never both", () => {
    expect(scoreOf({ netClass: "home", accountsOnNet: { day: 2, week: 2 }, ...settled }).reasons).toEqual([]);
    expect(scoreOf({ netClass: "home", accountsOnNet: { day: 3, week: 3 }, ...settled }).reasons).toEqual(["net3"]);
    expect(scoreOf({ netClass: "home", accountsOnNet: { day: 6, week: 6 }, ...settled }).reasons).toEqual(["net5"]);
  });

  it("multiplies a brand-new account's score, and never multiplies a score of zero or less", () => {
    const young = { accountAgeMs: 3600_000, now: NOW } as const;
    expect(scoreOf({ netClass: "hosting", ...young }).score).toBe(Math.round(W.hosting * 1.5));
    expect(scoreOf({ netClass: "home", provider: "apple", ...young }).score).toBe(W.signedInWithApple);
  });

  it("takes points off for a signed-in-with-Apple account and a settled one with real use", () => {
    const got = scoreOf({ netClass: "hosting", provider: "google", realUse: true, ...settled });
    expect(got.reasons).toContain("signedInWithApple");
    expect(got.reasons).toContain("settledAccount");
    expect(got.score).toBe(W.hosting + W.signedInWithApple + W.settledAccount);
  });

  it("reaches log, slow, hold and ask at the thresholds, and nothing below log", () => {
    const at = (score: number) => scoreOf({ netClass: "home", shape: score ? ["script"] : [], ...settled });
    expect(at(0).action).toBe("none");
    expect(scoreOf({ netClass: "hosting", shape: ["script"], ...settled }).action).toBe("log");       // 45
    expect(scoreOf({ netClass: "tor", shape: ["script"], ...settled }).action).toBe("slow");          // 60
    expect(scoreOf({ netClass: "tor", disposableEmail: true, ...settled }).action).toBe("hold");      // 70
    expect(scoreOf({ netClass: "tor", disposableEmail: true, tombstoneMatch: true, ...settled }).action).toBe("ask"); // 110
  });
});

describe("what Apple and Google answered", () => {
  it("never penalises a missing answer, however the build is made", () => {
    const none = scoreOf({ netClass: "home", verdicts: {}, claimed: { appAttest: true, playIntegrity: true }, ...settled });
    expect(none.score).toBe(0);
    const unsupported = scoreOf({ netClass: "home", verdicts: { appAttest: "none" }, claimed: { appAttest: true }, ...settled });
    expect(unsupported.score).toBe(0);
  });

  it("penalises an attestation that was CLAIMED and failed, and not one that was never claimed", () => {
    const claimed = scoreOf({ netClass: "home", verdicts: { appAttest: "fail" }, claimed: { appAttest: true }, ...settled });
    expect(claimed.reasons).toEqual(["attestFailed"]);
    const never = scoreOf({ netClass: "home", verdicts: { appAttest: "fail" }, claimed: { appAttest: false }, ...settled });
    expect(never.reasons).toEqual([]);
  });

  it("takes points off for a passed App Attest and for a recognised, device-whole Android build", () => {
    expect(scoreOf({ netClass: "home", verdicts: { appAttest: "ok" }, ...settled }).score).toBe(W.attestPassed);
    const play = scoreOf({
      netClass: "home",
      verdicts: { integrity: { app: "PLAY_RECOGNIZED", device: ["MEETS_DEVICE_INTEGRITY", "MEETS_BASIC_INTEGRITY"] } },
      ...settled,
    });
    expect(play.reasons).toEqual(["attestPassed"]);
  });

  it("scores an unrecognised Android build only when the build claimed it could do this", () => {
    const verdicts = { integrity: { app: "UNRECOGNIZED_VERSION" } };
    expect(scoreOf({ netClass: "home", verdicts, claimed: { playIntegrity: true }, ...settled }).reasons).toEqual(["integrityUnrecognised"]);
    expect(scoreOf({ netClass: "home", verdicts, claimed: { playIntegrity: false }, ...settled }).reasons).toEqual([]);
  });

  it("scores a phone that answered but is not device-whole, and not one that answered nothing", () => {
    const got = scoreOf({ netClass: "home", verdicts: { integrity: { app: "PLAY_RECOGNIZED", device: ["MEETS_BASIC_INTEGRITY"] } }, ...settled });
    expect(got.reasons).toEqual(["noDeviceIntegrity"]);
    expect(scoreOf({ netClass: "home", verdicts: { integrity: {} }, ...settled }).reasons).toEqual([]);
  });

  it("counts DeviceCheck's bit0 for 12 months and not a month longer", () => {
    expect(bitStillCounts("2026-11", NOW)).toBe(true);
    expect(bitStillCounts("2026-01", NOW)).toBe(true);
    expect(bitStillCounts("2025-01", NOW)).toBe(false);
    expect(bitStillCounts(undefined, NOW)).toBe(false);
    expect(bitStillCounts("whenever", NOW)).toBe(false);
    const young = { accountAgeMs: 3600_000, now: NOW } as const;
    const fresh = scoreOf({ netClass: "home", verdicts: { deviceCheck: { bit0: true, bit1: false, month: "2026-10" } }, ...young });
    expect(fresh.reasons).toEqual(["dcBit0"]);
    const old = scoreOf({ netClass: "home", verdicts: { deviceCheck: { bit0: true, bit1: false, month: "2024-10" } }, ...young });
    expect(old.reasons).toEqual([]);
  });

  it("counts bit0 only against a NEW account: an old account on a used phone is not an abuser", () => {
    const verdicts = { deviceCheck: { bit0: true, bit1: false, month: "2026-10" } };
    expect(scoreOf({ netClass: "home", verdicts, ...settled }).reasons).toEqual([]);
  });

  it("counts an admin-set bit1 whatever the account's age, and more than three keys on one device", () => {
    expect(scoreOf({ netClass: "home", verdicts: { deviceCheck: { bit0: false, bit1: true } }, ...settled }).reasons).toEqual(["dcBit1"]);
    expect(scoreOf({ netClass: "home", attestKeys: 4, ...settled }).reasons).toEqual(["attestKeys"]);
    expect(scoreOf({ netClass: "home", attestKeys: 3, ...settled }).reasons).toEqual([]);
    expect(scoreOf({ netClass: "home", attestKeys: null, ...settled }).reasons).toEqual([]);
  });
});

describe("the install id and a moved session", () => {
  it("counts 3 accounts on one install, then 5", () => {
    expect(scoreOf({ netClass: "home", accountsOnInstall: 2, ...settled }).reasons).toEqual([]);
    expect(scoreOf({ netClass: "home", accountsOnInstall: 3, ...settled }).reasons).toEqual(["install3"]);
    expect(scoreOf({ netClass: "home", accountsOnInstall: 9, ...settled }).reasons).toEqual(["install5"]);
  });

  it("counts a session seen from a data centre and a home line within the hour", () => {
    expect(scoreOf({ netClass: "home", sessionMoved: true, ...settled }).reasons).toEqual(["sessionMoved"]);
  });
});

describe("a weight set to zero turns a signal off without losing its name", () => {
  it("still names the reason and adds nothing", () => {
    const quiet = { ...TRUST_DEFAULTS, weights: { ...TRUST_DEFAULTS.weights, tor: 0 } };
    const got = scoreOf({ netClass: "tor", ...settled }, quiet);
    expect(got.reasons).toEqual(["tor"]);
    expect(got.score).toBe(0);
  });
});

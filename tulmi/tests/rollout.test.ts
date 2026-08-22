/**
 * Staged rollout. Two properties are load-bearing and everything else is
 * detail:
 *
 *  • STABILITY — a user's slice must never move between requests, or the
 *    keyboard's settings flip under their fingers mid-sentence.
 *  • INDEPENDENCE — experiments must not stack on the same unlucky users, or
 *    that cohort receives every change at once and the results are skewed.
 */
import { describe, expect, it } from "vitest";
import {
  bucketFor,
  matchesRule,
  parseRollouts,
  applyRollouts,
  type RolloutRule,
} from "../src/experience/rollout.js";

describe("bucketFor", () => {
  it("is STABLE — the same user always lands in the same bucket", () => {
    const a = bucketFor("user-abc", "kb.haptics.style");
    for (let i = 0; i < 50; i++) {
      expect(bucketFor("user-abc", "kb.haptics.style")).toBe(a);
    }
  });

  it("stays inside 0–99", () => {
    for (let i = 0; i < 500; i++) {
      const b = bucketFor(`user-${i}`, "flag");
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it("is INDEPENDENT per flag — one user isn't in the same slice for everything", () => {
    // Without the per-flag salt the same 5% would receive every experiment.
    const user = "user-abc";
    const buckets = new Set(
      ["flag.a", "flag.b", "flag.c", "flag.d", "flag.e", "flag.f"].map((f) => bucketFor(user, f)),
    );
    expect(buckets.size).toBeGreaterThan(1);
  });

  it("spreads users across the range rather than clumping", () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 1000; i++) counts[Math.floor(bucketFor(`u${i}`, "f") / 10)]++;
    // Every decile should see a reasonable share — a badly skewed hash would
    // make "5% of users" mean something very different than intended.
    for (const c of counts) expect(c).toBeGreaterThan(30);
  });
});

describe("applyRollouts", () => {
  const base = { "kb.haptics.style": "selection", "kb.touch.holdMultiplier": 1.0 };

  it("leaves the baseline untouched for anonymous callers", () => {
    const rule: RolloutRule = { flag: "kb.haptics.style", value: "light", buckets: [0, 99] };
    expect(applyRollouts(base, undefined, [rule])).toBe(base);
  });

  it("never mutates the shared baseline map", () => {
    const rule: RolloutRule = { flag: "kb.haptics.style", value: "light", buckets: [0, 99] };
    const out = applyRollouts(base, "user-1", [rule]);
    expect(out).not.toBe(base);
    expect(base["kb.haptics.style"]).toBe("selection");
    expect(out["kb.haptics.style"]).toBe("light");
  });

  it("applies to targeted users and skips everyone else", () => {
    // Split the range: each user is in exactly one of these two rules.
    const lower: RolloutRule = { flag: "kb.haptics.style", value: "LOW", buckets: [0, 49] };
    const upper: RolloutRule = { flag: "kb.haptics.style", value: "HIGH", buckets: [50, 99] };
    for (let i = 0; i < 40; i++) {
      const id = `user-${i}`;
      const got = applyRollouts(base, id, [lower, upper])["kb.haptics.style"];
      const expected = bucketFor(id, "kb.haptics.style") <= 49 ? "LOW" : "HIGH";
      expect(got).toBe(expected);
    }
  });

  it("hits roughly the requested share of users", () => {
    const rule: RolloutRule = { flag: "kb.x", value: 1, buckets: [0, 9] }; // 10%
    let hit = 0;
    for (let i = 0; i < 2000; i++) if (matchesRule(`user-${i}`, rule)) hit++;
    expect(hit / 2000).toBeGreaterThan(0.06);
    expect(hit / 2000).toBeLessThan(0.15);
  });

  it("tolerates a reversed bucket range", () => {
    const rule: RolloutRule = { flag: "kb.x", value: 1, buckets: [99, 0] };
    expect(matchesRule("anyone", rule)).toBe(true);
  });

  it("returns the baseline when no rules are defined", () => {
    expect(applyRollouts(base, "user-1", [])).toBe(base);
  });
});

describe("parseRollouts — a typo must never take the endpoint down", () => {
  it("ignores invalid JSON", () => {
    expect(parseRollouts("{not json")).toEqual([]);
  });

  it("ignores a non-array payload", () => {
    expect(parseRollouts('{"flag":"x"}')).toEqual([]);
  });

  it("drops malformed rules but keeps the valid ones", () => {
    const raw = JSON.stringify([
      { flag: "good.one", value: 1, buckets: [0, 9] },
      { flag: "missing.buckets", value: 1 },
      { value: 1, buckets: [0, 9] },
      { flag: "bad.buckets", value: 1, buckets: [0] },
      { flag: "no.value", buckets: [0, 9] },
    ]);
    const out = parseRollouts(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.flag).toBe("good.one");
  });

  it("accepts falsy values (false / 0 are real flag values)", () => {
    const out = parseRollouts(JSON.stringify([{ flag: "kb.x", value: false, buckets: [0, 9] }]));
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe(false);
  });

  it("treats empty/absent input as no rules", () => {
    expect(parseRollouts(undefined)).toEqual([]);
    expect(parseRollouts("   ")).toEqual([]);
  });
});

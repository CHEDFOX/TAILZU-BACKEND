/**
 * The statistics of the reality plan: the intervals, the probability that an arm is the best, cost per success, the dominance test and the stopping rule. Seeded, so
 * the same twice; no key, no network.
 */
import { describe, expect, it } from "vitest";
import { betaCdf, betaPosterior, betaQuantile, costPerSuccess, costPerSuccessInterval, decide, flakyTasks, logGamma, probBest, probCheaper, probGreater, rateSd, rng, wilsonInterval, zOf, type Run } from "../e2e/reality/stats.js";

const runs = (ok: number[], cost: number | number[]): Run[] => ok.map((o, i) => ({ ok: !!o, costInr: Array.isArray(cost) ? cost[i % cost.length]! : cost }));

describe("the special functions", () => {
  it("log-gamma, the Beta CDF and its quantile agree with known values", () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 6);
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 6);
    expect(betaCdf(0.5, 1, 1)).toBeCloseTo(0.5, 10);
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 10);
    expect(betaCdf(0.25, 2, 1)).toBeCloseTo(0.0625, 10);
    expect(betaCdf(0, 3, 4)).toBe(0);
    expect(betaCdf(1, 3, 4)).toBe(1);
    expect(betaQuantile(0.5, 1, 1)).toBeCloseTo(0.5, 6);
    expect(betaCdf(betaQuantile(0.9, 7, 3), 7, 3)).toBeCloseTo(0.9, 6);
  });

  it("the z of a two-sided level", () => {
    expect(zOf(0.95)).toBeCloseTo(1.96, 2);
    expect(zOf(0.9)).toBeCloseTo(1.645, 2);
  });
});

describe("intervals", () => {
  it("Wilson: wide for few runs, narrow for many, inside [0, 1], and the whole range for none", () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
    const few = wilsonInterval(3, 6);
    expect(few.lo).toBeCloseTo(0.188, 2);
    expect(few.hi).toBeCloseTo(0.812, 2);
    const many = wilsonInterval(300, 600);
    expect(many.hi - many.lo).toBeLessThan(0.1);
    expect(wilsonInterval(6, 6).hi).toBeLessThanOrEqual(1);
    expect(wilsonInterval(0, 6).lo).toBe(0);
    expect(wilsonInterval(6, 6).lo).toBeGreaterThan(0.5);
  });

  it("Beta posterior: the uniform prior moves with the runs, and its interval holds the Wilson one's centre", () => {
    const p = betaPosterior(6, 6, 0.9);
    expect(p.a).toBe(7);
    expect(p.b).toBe(1);
    expect(p.mean).toBeCloseTo(0.875, 6);
    expect(p.hi).toBeGreaterThan(0.98);
    expect(p.lo).toBeCloseTo(0.652, 2);
    const none = betaPosterior(0, 0);
    expect(none.mean).toBeCloseTo(0.5, 6);
    expect(none.hi - none.lo).toBeGreaterThan(0.85);
  });

  it("the rate's standard deviation shrinks with the runs", () => {
    expect(rateSd(5, 10)).toBeCloseTo(Math.sqrt(0.25 / 10), 8);
    expect(rateSd(50, 100)).toBeLessThan(rateSd(5, 10));
    expect(rateSd(0, 0)).toBe(0.5);
  });
});

describe("who is best", () => {
  it("equal arms split the probability, a far better arm takes nearly all of it, and the probabilities sum to 1", () => {
    expect(probBest([{ a: 1, b: 1 }, { a: 1, b: 1 }])).toEqual([0.5, 0.5]);
    const [x, y] = probBest([{ a: 7, b: 1 }, { a: 1, b: 7 }]);
    expect(x).toBeGreaterThan(0.999);
    expect(x! + y!).toBeCloseTo(1, 6);
    const three = probBest([{ a: 10, b: 4 }, { a: 8, b: 6 }, { a: 5, b: 9 }]);
    expect(three.reduce((n, v) => n + v, 0)).toBeCloseTo(1, 6);
    expect(three[0]).toBeGreaterThan(three[1]!);
    expect(three[1]).toBeGreaterThan(three[2]!);
    expect(probBest([])).toEqual([]);
    expect(probBest([{ a: 3, b: 3 }])).toEqual([1]);
  });

  it("P(X > Y) is 0.5 for equal arms, and symmetric", () => {
    expect(probGreater({ a: 4, b: 4 }, { a: 4, b: 4 })).toBeCloseTo(0.5, 3);
    const p = probGreater({ a: 9, b: 3 }, { a: 4, b: 8 });
    expect(p + probGreater({ a: 4, b: 8 }, { a: 9, b: 3 })).toBeCloseTo(1, 3);
    expect(p).toBeGreaterThan(0.95);
  });
});

describe("cost per success", () => {
  it("is all the money over the successes, infinite with none, and failures are a cost of the successes", () => {
    expect(costPerSuccess(runs([1, 1, 0, 0], 2))).toBe(4);
    expect(costPerSuccess(runs([0, 0], 2))).toBe(Number.POSITIVE_INFINITY);
    expect(costPerSuccess([])).toBe(Number.POSITIVE_INFINITY);
  });

  it("the bootstrap interval holds the point, is seeded, and is wide for few runs", () => {
    const rs = runs([1, 0, 1, 1, 0, 1, 1, 1], [1, 3, 2, 2, 5, 1, 2, 2]);
    const a = costPerSuccessInterval(rs, 0.9, 5);
    const b = costPerSuccessInterval(rs, 0.9, 5);
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThanOrEqual(a.point);
    expect(a.hi).toBeGreaterThanOrEqual(a.point);
    expect(costPerSuccessInterval(runs([1], 2)).lo).toBe(2);
  });

  it("P(cheaper): near 1 when one arm is far cheaper per success, near 0.5 for the same arm, 0 when it has no success", () => {
    const cheap = runs([1, 1, 1, 1, 1, 1], [1, 1.1, 0.9]);
    const dear = runs([1, 1, 1, 1, 1, 1], [4, 4.2, 3.8]);
    expect(probCheaper(cheap, dear)).toBeGreaterThan(0.99);
    expect(probCheaper(dear, cheap)).toBeLessThan(0.01);
    const same = probCheaper(cheap, cheap, 3);
    expect(same).toBeLessThan(0.6);
    expect(probCheaper(runs([0, 0, 0], 1), cheap)).toBe(0);
    expect(probCheaper(cheap, runs([0, 0, 0], 1))).toBe(1);
  });

  it("the generator is seeded", () => {
    const r1 = rng(42), r2 = rng(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(rng(1)()).not.toBe(rng(2)());
  });
});

describe("the stopping rule", () => {
  it("a SIMULATED CLEAR WINNER is called, the losers are dropped, and it says why", () => {
    const d = decide([
      { id: "ours", runs: runs([1, 1, 1, 1, 1, 1], 2) },
      { id: "aider", runs: runs([0, 0, 0, 1, 0, 0], 3) },
      { id: "mini", runs: runs([0, 0, 0, 0, 0, 0], 1) },
    ]);
    expect(d.decided).toBe(true);
    expect(d.state).toBe("last");
    expect(d.leader).toBe("ours");
    expect(d.drop.sort()).toEqual(["aider", "mini"]);
    expect(d.arms.find((a) => a.id === "mini")!.dominatedBy).toBe("ours");
    expect(d.reason).toMatch(/only arm left/);
  });

  it("a clear winner that does not dominate on cost is still called once P(best) reaches 0.9", () => {
    // The leader is far better but also dearer per success: nobody is dominated on both, yet it is the best with probability >= 0.9.
    const d = decide([
      { id: "strong", runs: runs(Array(20).fill(1), 6) },
      { id: "weak", runs: runs([...Array(2).fill(1), ...Array(18).fill(0)], 1) },
    ], { confidence: 0.9 });
    expect(d.leader).toBe("strong");
    expect(d.arms.find((a) => a.id === "strong")!.pBest).toBeGreaterThan(0.99);
    expect(d.decided).toBe(true);
    expect(d.drop).toEqual([]);
  });

  it("a SIMULATED TIE is not called: equal arms stay open, with the intervals overlapping", () => {
    const d = decide([
      { id: "a", runs: runs([1, 0, 1, 0, 1, 0], 2) },
      { id: "b", runs: runs([0, 1, 0, 1, 1, 0], 2.2) },
    ]);
    expect(d.decided).toBe(false);
    expect(d.state).toBe("open");
    expect(d.drop).toEqual([]);
    expect(d.arms[0]!.pBest).toBeGreaterThan(0.3);
    expect(d.arms[0]!.pBest).toBeLessThan(0.7);
    expect(d.reason).toMatch(/still overlap/);
  });

  it("concludes nothing until every live arm has run the minimum", () => {
    const d = decide([{ id: "a", runs: runs([1, 1, 1], 1) }, { id: "b", runs: runs([0, 0, 0], 1) }], { minN: 4 });
    expect(d.state).toBe("short");
    expect(d.decided).toBe(false);
    expect(d.drop).toEqual([]);
    expect(decide([{ id: "a", runs: [] }, { id: "b", runs: [] }]).leader).toBe("a");
  });

  it("an arm that is cheaper but worse is NOT dominated: it stays, the answer is the frontier", () => {
    const d = decide([
      { id: "dear-strong", runs: runs([1, 1, 1, 1, 1, 0, 1, 1], 5) },
      { id: "cheap-weak", runs: runs([1, 0, 1, 0, 0, 1, 0, 0], 0.5) },
    ]);
    expect(d.arms.find((a) => a.id === "cheap-weak")!.dominatedBy).toBeUndefined();
  });

  it("an arm already out stays out and takes no probability", () => {
    const d = decide([{ id: "a", runs: runs([1, 1, 1, 1], 1) }, { id: "b", runs: runs([0, 0, 0, 0], 1) }, { id: "c", runs: runs([1, 1, 0, 1], 1) }], { out: ["b"] });
    expect(d.arms.find((x) => x.id === "b")!.pBest).toBe(0);
    expect(d.drop).not.toContain("b");
  });

  it("is the same twice", () => {
    const arms = [{ id: "a", runs: runs([1, 0, 1, 1, 0, 1], [1, 2, 3]) }, { id: "b", runs: runs([0, 0, 1, 0, 0, 1], [2, 2, 4]) }];
    expect(JSON.stringify(decide(arms, { seed: 3 }))).toBe(JSON.stringify(decide(arms, { seed: 3 })));
  });
});

describe("flaky results", () => {
  it("a task is flaky only when the same arm gave both answers", () => {
    const f = flakyTasks([{ task: "a", outcomes: [true, true] }, { task: "b", outcomes: [true, false] }, { task: "c", outcomes: [false] }, { task: "d", outcomes: [false, false, true] }]);
    expect(f.flaky).toEqual(["b", "d"]);
    expect(f.repeated).toBe(3);
    expect(f.rate).toBeCloseTo(2 / 3, 6);
    expect(flakyTasks([]).rate).toBe(0);
  });
});

/**
 * THE TREND (e2e/reality/trend.ts): one line a run, so "is it getting better?" has an answer.
 *
 * `REALITY.md` is a snapshot, rewritten every run, so the one thing nobody could see was MOVEMENT. What these hold down:
 *   - a line is appended and read back, and a half-written line is skipped rather than thrown;
 *   - LIKE IS COMPARED WITH LIKE: only an earlier run of the same mode, and only an area it actually measured;
 *   - an area nobody measured before is "new", never an improvement; an "unknown" before is not something to beat;
 *   - a cheaper success is better and a dearer one is worse (the arrow runs the other way from a verdict's);
 *   - the words say what moved and nothing when nothing did;
 *   - a trend that cannot be written never fails a run: the run's own answers are already in the report.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TREND_FILE, append, costMove, movement, read, trendMarkdown, type TrendLine } from "../e2e/reality/trend.js";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "trend-"));

const line = (over: Partial<TrendLine> = {}): TrendLine => ({
  at: "2026-11-01T00:00:00.000Z",
  code: "aaaa",
  mode: "prove",
  stages: [0],
  suite: { tests: 11_000, failed: 0, typecheck: true },
  areas: [{ area: "Work (the change itself)", verdict: "weak", n: 6, pass: 3 }],
  ours: { tasks: 6, passed: 3, inrPerPass: 20 },
  spendInr: 60,
  ...over,
});

describe("keeping the lines", () => {
  it("appends one and reads it back", () => {
    const d = dir();
    append(d, line());
    append(d, line({ at: "2026-11-02T00:00:00.000Z", code: "bbbb" }));
    const got = read(d);
    expect(got).toHaveLength(2);
    expect(got.map((l) => l.code)).toEqual(["aaaa", "bbbb"]);
  });

  it("is nothing at all before the first run", () => {
    expect(read(dir())).toEqual([]);
  });

  it("skips a half-written line rather than throwing: the file is append-only and may be cut mid-write", () => {
    const d = dir();
    append(d, line());
    fs.appendFileSync(path.join(d, TREND_FILE), '{"at":"2026-11-03T00:00:00.000Z","are\n');
    append(d, line({ at: "2026-11-04T00:00:00.000Z", code: "cccc" }));
    expect(read(d).map((l) => l.code)).toEqual(["aaaa", "cccc"]);
  });

  it("never fails a run when it cannot be written", () => {
    const said: string[] = [];
    // A path that is a file, not a directory: writing into it cannot work.
    const d = dir();
    const asFile = path.join(d, "not-a-dir");
    fs.writeFileSync(asFile, "x");
    expect(() => append(path.join(asFile, "deeper"), line(), (m) => said.push(m))).not.toThrow();
    expect(said.join(" ")).toMatch(/not kept/);
  });
});

describe("what moved", () => {
  const before = line({ at: "2026-11-01T00:00:00.000Z", code: "aaaa", areas: [{ area: "Work (the change itself)", verdict: "weak", n: 6, pass: 3 }] });

  it("is better when a verdict rose, and worse when it fell", () => {
    const up = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", areas: [{ area: "Work (the change itself)", verdict: "working", n: 8, pass: 7 }] });
    expect(movement([before], up)[0]).toMatchObject({ direction: "better", before: "weak", now: "working" });
    expect(movement([before], up)[0]!.words).toBe("Work (the change itself): weak ↑ working");

    const down = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", areas: [{ area: "Work (the change itself)", verdict: "broken", n: 8, pass: 1 }] });
    expect(movement([before], down)[0]).toMatchObject({ direction: "worse" });
    expect(movement([before], down)[0]!.words).toContain("↓");
  });

  it("is 'new' for an area nobody measured before, and an earlier 'unknown' is not something to beat", () => {
    const fresh = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", areas: [{ area: "Locate", verdict: "working", n: 9, pass: 9 }] });
    expect(movement([before], fresh)[0]).toMatchObject({ direction: "new" });
    expect(movement([before], fresh)[0]!.words).toContain("not measured before");

    const wasUnknown = line({ code: "aaaa", areas: [{ area: "Locate", verdict: "unknown", n: 0, pass: 0 }] });
    expect(movement([wasUnknown], fresh)[0]!.direction).toBe("new");
  });

  it("compares only with the SAME MODE: a free nightly is never read as evidence from a paid run", () => {
    const paid = line({ at: "2026-11-01T00:00:00.000Z", code: "aaaa", mode: "real", areas: [{ area: "Work (the change itself)", verdict: "working", n: 20, pass: 18 }] });
    const nightly = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", mode: "prove", areas: [{ area: "Work (the change itself)", verdict: "weak", n: 2, pass: 1 }] });
    // The paid run said "working"; this free one must not be reported as a fall from it.
    expect(movement([paid], nightly)[0]!.direction).toBe("new");
  });

  it("is not compared with a run of the same code: that is the same point, not movement", () => {
    const same = line({ at: "2026-11-05T00:00:00.000Z", code: "aaaa", areas: [{ area: "Work (the change itself)", verdict: "working", n: 8, pass: 7 }] });
    expect(movement([before], same)[0]!.direction).toBe("new");
  });
});

describe("what a success costs", () => {
  it("is better when it is cheaper and worse when it is dearer: the arrow runs the other way", () => {
    const was = line({ code: "aaaa", ours: { tasks: 6, passed: 3, inrPerPass: 20 } });
    const cheaper = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", ours: { tasks: 6, passed: 4, inrPerPass: 12 } });
    expect(costMove([was], cheaper)).toMatchObject({ direction: "better", now: 12, before: 20 });
    const dearer = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", ours: { tasks: 6, passed: 2, inrPerPass: 33 } });
    expect(costMove([was], dearer)!.direction).toBe("worse");
  });

  it("is nothing when either run measured no success", () => {
    const was = line({ code: "aaaa", ours: null });
    expect(costMove([was], line({ code: "bbbb" }))).toBeNull();
    expect(costMove([line({ code: "aaaa" })], line({ code: "bbbb", ours: null }))).toBeNull();
  });
});

describe("the words in the summary", () => {
  it("name what moved, and what a success costs now", () => {
    const was = line({ code: "aaaa", areas: [{ area: "Work (the change itself)", verdict: "weak", n: 6, pass: 3 }], ours: { tasks: 6, passed: 3, inrPerPass: 20 } });
    const now = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", areas: [{ area: "Work (the change itself)", verdict: "working", n: 8, pass: 7 }], ours: { tasks: 8, passed: 7, inrPerPass: 9 } });
    const md = trendMarkdown([was], now).join("\n");
    expect(md).toContain("## How it has moved");
    expect(md).toContain("weak ↑ working");
    expect(md).toContain("down from ₹20.00");
  });

  it("is nothing at all on the very first run: there is nothing to compare with", () => {
    expect(trendMarkdown([], line())).toEqual([]);
  });

  it("says plainly when nothing changed", () => {
    const was = line({ code: "aaaa", ours: { tasks: 6, passed: 3, inrPerPass: 20 } });
    const same = line({ at: "2026-11-05T00:00:00.000Z", code: "bbbb", ours: { tasks: 6, passed: 3, inrPerPass: 20 } });
    const md = trendMarkdown([was], same).join("\n");
    expect(md).toContain("No area changed its verdict");
    expect(md).toContain("the same as ₹20.00");
  });
});

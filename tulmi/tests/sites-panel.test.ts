/**
 * THE PANEL'S TIMINGS (sites/frames.ts, docs/sites.md §panel).
 *
 * The point of these: a panel costs a person's data and their patience, and both are spent by sending pictures they
 * did not need. Nothing here runs on a clock — frames are pushed by the page and gated, and the panel ends on a
 * signal. These hold that, exactly, with no browser anywhere near them.
 */
import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";

const { BUSY_FPS, FrameGate, IDLE_END_MS, PanelLife, QUIET_FPS, END_WORDS } = await import("../src/sites/frames.js");

describe("how often a frame goes", () => {
  it("sends the first at once: a panel that opens to nothing looks broken", () => {
    const g = new FrameGate();
    expect(g.frame(1000)).toBe(true);
  });

  it("holds a page that will not settle to the quiet rate, however fast it changes", () => {
    const g = new FrameGate();
    expect(g.frame(0)).toBe(true);
    // A spinner firing every 16 ms is 62 chances in a second. The cap is what the person's data actually pays for.
    let offered = 0, sent = 0;
    for (let t = 16; t <= 1000; t += 16) { offered += 1; if (g.frame(t)) sent += 1; }
    expect(offered).toBeGreaterThan(60);
    expect(sent).toBeLessThanOrEqual(QUIET_FPS);
    expect(sent).toBeGreaterThan(0);
  });

  it("lifts the cap right after they touch something, because that is when they are watching", () => {
    const g = new FrameGate();
    g.frame(0);
    // Quiet: the next is not due yet.
    expect(g.frame(100)).toBe(false);
    g.touched(100);
    // Busy: 12 a second, so 84 ms is enough.
    expect(g.frame(100 + Math.ceil(1000 / BUSY_FPS))).toBe(true);
  });

  it("falls back to quiet once the moment has passed", () => {
    const g = new FrameGate({ busyMs: 500 });
    g.frame(0);
    g.touched(0);
    // Busy: 83 ms is enough.
    expect(g.frame(100)).toBe(true);
    // Past the busy window, the quiet gap applies again: 100 ms after the last one is too soon.
    expect(g.frame(700)).toBe(true); // 600 ms since the last: due either way
    expect(g.frame(800)).toBe(false); // 100 ms since the last, and no longer busy
    expect(g.frame(700 + 1000 / QUIET_FPS)).toBe(true);
  });

  it("keeps the newest and drops the rest: an old frame is not worth sending late", () => {
    const g = new FrameGate();
    g.frame(0);
    // Three arrive inside one gap; none of the first two goes, and the one that does is the latest moment.
    expect(g.frame(50)).toBe(false);
    expect(g.frame(100)).toBe(false);
    const at = 1000 / QUIET_FPS;
    expect(g.frame(at)).toBe(true);
  });
});

describe("when the panel is over", () => {
  it("ends the moment they are signed in, whatever the clocks say", () => {
    const l = new PanelLife(0);
    expect(l.over(1000, false)).toBeNull();
    expect(l.over(1000, true)).toBe("signed_in");
  });

  it("closes on somebody who walked away, and says so kindly", () => {
    const l = new PanelLife(0);
    expect(l.over(IDLE_END_MS - 1, false)).toBeNull();
    expect(l.over(IDLE_END_MS, false)).toBe("left");
    expect(END_WORDS.left).toContain("nothing happened");
  });

  it("anything at all keeps it alive: a frame from the page counts as much as a tap", () => {
    const l = new PanelLife(0);
    l.alive(IDLE_END_MS - 1);
    expect(l.over(IDLE_END_MS, false)).toBeNull();
    expect(l.over(IDLE_END_MS * 2 - 1, false)).toBe("left");
  });

  it("has a ceiling, as a backstop and not as the mechanism", () => {
    const l = new PanelLife(0, { hardMs: 10_000 });
    // Busy the whole time, so idle never fires: the ceiling is what ends it.
    for (let t = 0; t < 10_000; t += 1000) l.alive(t);
    expect(l.over(9_999, false)).toBeNull();
    expect(l.over(10_000, false)).toBe("too_long");
  });

  it("every ending has words for the person", () => {
    for (const k of ["signed_in", "said_done", "cancelled", "left", "too_long"] as const) {
      expect(END_WORDS[k].length).toBeGreaterThan(3);
    }
  });
});

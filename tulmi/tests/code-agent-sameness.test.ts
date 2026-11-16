/**
 * ARE WE BUILDING THE SAME APP OVER AND OVER (src/code/agent/sameness.ts)?
 *
 * Convergence is invisible from inside one page: every app can be individually good and the set of them still be one app wearing different names.
 * It is only visible across runs, which is a thing only a product that builds many apps can look at. What these hold down:
 *   - the fingerprint is of the DESIGN, not the content: the same template with different words is the same silhouette;
 *   - two blues are one decision, so hues are named by family rather than kept as degrees;
 *   - it reports HOW CONCENTRATED the set is and never that a repeat is wrong — a person who asks twice should get it twice;
 *   - it says nothing at all until there are enough projects for the question to mean anything.
 */
import { describe, expect, it } from "vitest";
import { CONCENTRATED, family, fingerprint, samenessLines, seenBefore, silhouette, spread, type Fingerprint } from "../src/code/agent/sameness.js";
import { noProbe, type ProbeResult } from "../src/code/agent/probe.js";

const page = (over: Partial<ProbeResult> = {}): ProbeResult => ({ ...noProbe(), viewport: { w: 1280, h: 900 }, ...over });
const fp = (over: Partial<Fingerprint> = {}): Fingerprint => ({ hue: "blue", ink: "light", steps: { text: 5, radius: 2 }, round: "soft", silhouette: "0:10 1:3x3", ...over });

describe("the fingerprint of a finished page", () => {
  it("names the hue by family, because two blues are one decision", () => {
    expect(family(240)).toBe("blue");
    expect(family(250)).toBe("blue");
    expect(family(10)).toBe("red");
    expect(family(370)).toBe("red");
    expect(family(285)).toBe("violet");
  });

  it("takes the strongest colour, how round it is, and whether it is light or dark", () => {
    const f = fingerprint(page({
      styles: { ...noProbe().styles, color: { "37,99,235": 40, "17,24,39": 200 }, background: { "255,255,255": 300 }, radius: { "12px": 20, "4px": 2 }, fontSize: { "16px": 50, "32px": 4 } },
    }));
    expect(f.hue).toBe("blue");
    expect(f.ink).toBe("light");
    expect(f.round).toBe("round");
    expect(f.steps).toEqual({ text: 2, radius: 2 });

    // A page made of dark surfaces is a dark page, whatever its text is.
    expect(fingerprint(page({ styles: { ...noProbe().styles, background: { "17,24,39": 80, "255,255,255": 3 } } })).ink).toBe("dark");
    // Greys are not a hue: a page with no colour in it says so.
    expect(fingerprint(page({ styles: { ...noProbe().styles, color: { "100,100,100": 90 } } })).hue).toBe("none");
  });

  it("is of the design and not the content: the same template with different words is the same shape", () => {
    const template = (w: number) => [
      { x: 0, y: 0, w, h: 300, at: "hero" },
      { x: 0, y: 500, w: w / 3, h: 200, at: "a" }, { x: w / 3, y: 500, w: w / 3, h: 200, at: "b" }, { x: (2 * w) / 3, y: 500, w: w / 3, h: 200, at: "c" },
    ];
    const one = silhouette(template(1280), 1280);
    const two = silhouette(template(1280).map((r, i) => ({ ...r, at: `other${i}` })), 1280);
    expect(one).toBe(two);
    expect(one).toContain("x3");
    // And a genuinely different shape does not match it.
    expect(silhouette([{ x: 0, y: 0, w: 640, h: 900, at: "split" }, { x: 640, y: 0, w: 640, h: 900, at: "side" }], 1280)).not.toBe(one);
    expect(silhouette([], 1280)).toBe("");
  });
});

describe("how concentrated the recent set is", () => {
  it("names the commonest answer on each axis and what share gave it", () => {
    const set = [fp(), fp(), fp(), fp({ hue: "green", round: "pill" })];
    const s = spread(set);
    const hue = s.find((x) => x.axis === "hue")!;
    expect(hue.commonest).toBe("blue");
    expect(hue.share).toBe(0.75);
    expect(hue.of).toBe(4);
    expect(spread([])).toEqual([]);
  });

  it("says nothing until there are enough projects for the question to mean anything", () => {
    expect(samenessLines([])).toEqual([]);
    expect(samenessLines([fp(), fp()])).toEqual([]);
  });

  it("reports a concentrated set as a measurement, explicitly not as a fault", () => {
    const out = samenessLines([fp(), fp(), fp(), fp()]).join("\n");
    expect(out).toContain("Across the last 4 projects");
    expect(out).toMatch(/100% of them came out blue/);
    expect(out).toMatch(/a measurement, not a fault/);
  });

  it("says plainly when the work is still spreading out", () => {
    const varied = [fp({ hue: "blue", ink: "light", round: "soft", silhouette: "a" }), fp({ hue: "green", ink: "dark", round: "pill", silhouette: "b" }), fp({ hue: "red", ink: "light", round: "square", silhouette: "c" }), fp({ hue: "teal", ink: "dark", round: "round", silhouette: "d" })];
    const out = samenessLines(varied).join("\n");
    expect(out).toMatch(/still spreading out/);
    expect(out).not.toMatch(/came out/);
    for (const s of spread(varied)) expect(s.share).toBeLessThanOrEqual(CONCENTRATED);
  });
});

describe("have we made this one before", () => {
  it("answers only where the last three all agree", () => {
    const three = [fp(), fp(), fp()];
    const said = seenBefore(fp(), three).join(" | ");
    expect(said).toContain("the last three projects were all blue too");
    expect(said).toContain("this same layout shape");
    // Two is not three, and a set that disagrees says nothing.
    expect(seenBefore(fp(), [fp(), fp()])).toEqual([]);
    expect(seenBefore(fp(), [fp(), fp({ hue: "green", silhouette: "x", round: "pill" }), fp()])).toEqual([]);
  });

  it("does not call a page with no colour a repeat of other pages with no colour", () => {
    const grey = fp({ hue: "none", silhouette: "" });
    expect(seenBefore(grey, [grey, grey, grey]).join(" ")).not.toMatch(/all none/);
    expect(seenBefore(grey, [grey, grey, grey]).join(" ")).not.toMatch(/layout shape/);
  });
});

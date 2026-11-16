/**
 * READING THE PROBE (src/code/agent/coherence.ts): what is broken, and whether the page is one design.
 *
 * The probe runs in the page and only collects; every judgement happens here, in Node, so it can be tested without a browser. What these hold down:
 *   - THE COLOUR MATHS IS RIGHT. A wrong contrast or a wrong perceptual distance would be invisible in production and wrong about everything,
 *     so both are checked against values that are known independently of this code;
 *   - a defect is objective and carries the axis that repairs it WITHOUT changing the design (lightness, never hue);
 *   - text too small is weighed by HOW MUCH TEXT it is, not by how many elements;
 *   - a mouse-only :focus is not mistaken for a keyboard ring;
 *   - coherence measures say plainly when NOBODY KNOWS which way is better, and claim "lower is better" only where it is beyond argument;
 *   - a sound page says nothing at all.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRAST_MIN, SAME_COLOUR, TEXT_MIN_PX, alignment, coherence, coherenceLines, contrast, deltaE, defects, lab, luminance, samePalette, strays,
} from "../src/code/agent/coherence.js";
import { noProbe, type ProbeResult, type ProbeText } from "../src/code/agent/probe.js";

const page = (over: Partial<ProbeResult> = {}): ProbeResult => ({ ...noProbe(), viewport: { w: 390, h: 844 }, doc: { scrollWidth: 390, clientWidth: 390 }, ...over });
const text = (o: Partial<ProbeText> = {}): ProbeText => ({ px: 16, weight: 400, chars: 100, fg: "0,0,0", bg: "255,255,255", at: "p", ...o });

describe("the colour maths, against values known outside this code", () => {
  it("gets CIELAB right for colours whose values are published", () => {
    const [Lw, aw, bw] = lab("255,255,255")!;
    expect(Lw).toBeCloseTo(100, 2); expect(aw).toBeCloseTo(0, 2); expect(bw).toBeCloseTo(0, 2);
    expect(lab("0,0,0")![0]).toBeCloseTo(0, 4);
    // sRGB red: L*=53.24, a*=80.09, b*=67.20 — the standard figures.
    const [Lr, ar, br] = lab("255,0,0")!;
    expect(Lr).toBeCloseTo(53.24, 1); expect(ar).toBeCloseTo(80.09, 1); expect(br).toBeCloseTo(67.20, 1);
    expect(lab("nonsense")).toBeNull();
  });

  it("gets WCAG contrast right, including the 4.5:1 boundary everyone quotes", () => {
    expect(contrast("255,255,255", "0,0,0")).toBeCloseTo(21, 4);
    expect(contrast("128,128,128", "128,128,128")).toBeCloseTo(1, 6);
    // #767676 on white is the textbook colour that only just passes 4.5:1.
    const grey = contrast("118,118,118", "255,255,255")!;
    expect(grey).toBeGreaterThan(CONTRAST_MIN);
    expect(grey).toBeLessThan(4.6);
    // #777 on white is the textbook colour that only just fails it.
    expect(contrast("119,119,119", "255,255,255")!).toBeLessThan(CONTRAST_MIN);
    expect(luminance("255,255,255")).toBeCloseTo(1, 6);
    expect(contrast("x", "0,0,0")).toBeNull();
  });

  it("gets CIEDE2000's shape right: zero on itself, symmetric, and a just-noticeable step lands under 2", () => {
    expect(deltaE("10,20,30", "10,20,30")).toBeCloseTo(0, 6);
    const ab = deltaE("200,30,40", "40,180,90")!;
    expect(deltaE("40,180,90", "200,30,40")).toBeCloseTo(ab, 6);
    expect(deltaE("255,255,255", "0,0,0")!).toBeGreaterThan(90);
    // One step of blue nobody can see.
    expect(deltaE("17,24,39", "18,25,40")!).toBeLessThan(SAME_COLOUR);
    // Two greys a designer would call the same, and two a person plainly cannot.
    expect(deltaE("107,114,128", "110,117,131")!).toBeLessThan(SAME_COLOUR);
    expect(deltaE("107,114,128", "160,170,185")!).toBeGreaterThan(SAME_COLOUR);
  });
});

describe("what is broken", () => {
  it("finds text nobody can read, and says to move lightness and nothing else", () => {
    const d = defects(page({ text: [text({ fg: "150,150,150", bg: "255,255,255", at: "p.hint" })] }));
    const low = d.find((x) => x.rule === "text.contrast")!;
    expect(low.fix).toBe("lightness");
    expect(low.text).toContain("p.hint");
    expect(low.text).toMatch(/4\.5:1/);
  });

  it("splits out invisible text, because a ratio of 1 is never a decision", () => {
    const d = defects(page({ text: [text({ fg: "255,255,255", bg: "255,255,255", at: "span.total" })] }));
    expect(d.map((x) => x.rule)).toContain("text.invisible");
    expect(d.find((x) => x.rule === "text.invisible")!.text).toMatch(/dark-mode|invisible/);
    expect(d.map((x) => x.rule)).not.toContain("text.contrast");
  });

  it("lets large text pass at the lower bar, as WCAG does", () => {
    const grey = { fg: "130,130,130", bg: "255,255,255" };
    expect(defects(page({ text: [text({ ...grey, px: 30 })] })).map((x) => x.rule)).not.toContain("text.contrast");
    expect(defects(page({ text: [text({ ...grey, px: 19, weight: 700 })] })).map((x) => x.rule)).not.toContain("text.contrast");
    expect(defects(page({ text: [text({ ...grey, px: 14 })] })).map((x) => x.rule)).toContain("text.contrast");
  });

  it("weighs text that is too small by how much text it is, not how many elements", () => {
    // One tiny label among a page of prose is not a finding.
    const few = page({ text: [text({ px: 9, chars: 8, at: "small" }), text({ px: 16, chars: 4000 })] });
    expect(defects(few).map((x) => x.rule)).not.toContain("text.small");
    // A page largely set too small is.
    const many = page({ text: [text({ px: 9, chars: 900, at: "p.body" }), text({ px: 16, chars: 300 })] });
    const d = defects(many).find((x) => x.rule === "text.small")!;
    expect(d.fix).toBe("size");
    expect(d.text).toContain("9px");
    expect(d.text).toMatch(/%/);
  });

  it("reports sideways scroll with the width it was measured at and who stuck out", () => {
    const d = defects(page({ doc: { scrollWidth: 520, clientWidth: 390 }, overflow: [{ at: "div.hero", px: 130 }] })).find((x) => x.rule === "layout.overflow")!;
    expect(d.fix).toBe("width");
    expect(d.text).toContain("390px");
    expect(d.text).toContain("div.hero");
    expect(defects(page())).toHaveLength(0);
  });

  it("flags a control with no focus ring, but not one the browser does not call focus-visible", () => {
    const d = defects(page({ focus: [{ at: "button.buy", changed: "", visible: true }] })).find((x) => x.rule === "focus.none")!;
    expect(d.fix).toBe("ring");
    expect(d.text).toContain("button.buy");
    // A mouse-only :focus is not a keyboard ring, and a ring that IS there is not a finding.
    expect(defects(page({ focus: [{ at: "a", changed: "", visible: false }] }))).toHaveLength(0);
    expect(defects(page({ focus: [{ at: "a", changed: "outline", visible: true }] }))).toHaveLength(0);
  });

  it("flags motion still running after the page was asked for less of it", () => {
    const d = defects(page({ animations: [{ at: "div.pulse", ms: null, forever: true, name: "pulse" }, { at: "section", ms: 600, forever: false, name: "fade" }] })).find((x) => x.rule === "motion.reduce")!;
    expect(d.count).toBe(2);
    expect(d.fix).toBe("motion");
    expect(d.text).toContain("never stops");
    expect(d.text).toMatch(/gentler, not nothing/);
  });

  it("says nothing at all about a page with nothing wrong", () => {
    expect(defects(page({ text: [text()], focus: [{ at: "button", changed: "outline", visible: true }] }))).toEqual([]);
    expect(coherenceLines(page({ text: [text()] }))).toEqual([]);
  });
});

describe("values that are nearly a step", () => {
  it("names the stray, what it is nearly, and how much each is used", () => {
    const s = strays({ "12px": 847, "16px": 230, "13px": 1, "40px": 3 });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ value: "13px", uses: 1, near: "12px", nearUses: 847, gap: 1 });
  });

  it("leaves real steps alone: a value used plenty, and one nowhere near another", () => {
    expect(strays({ "12px": 847, "24px": 300, "48px": 120 })).toEqual([]);
    // Used once but 9px from anything: that is a deliberate one-off, not drift.
    expect(strays({ "12px": 847, "21px": 1 })).toEqual([]);
  });
});

describe("whether it is one design", () => {
  it("collapses colours a person cannot tell apart and names the pairs", () => {
    const p = samePalette({ "17,24,39": 100, "18,25,40": 2, "255,255,255": 400 });
    expect(p.raw).toBe(3);
    expect(p.distinct).toBe(2);
    expect(p.pairs).toHaveLength(1);
  });

  it("is the only measure that claims a direction, because that one is beyond argument", () => {
    const m = coherence(page({ styles: { ...noProbe().styles, color: { "17,24,39": 100, "18,25,40": 2 }, fontSize: { "16px": 10, "24px": 4 } } }));
    expect(m.find((x) => x.name === "colours that are the same colour")!.direction).toBe("lower");
    // Everything else says plainly that nobody knows.
    for (const x of m.filter((y) => y.name !== "colours that are the same colour")) expect(x.direction, x.name).toBe("unknown");
    expect(m.find((x) => x.name === "text sizes")!.value).toBe(2);
  });

  it("says in the report that the counts are not marks", () => {
    const out = coherenceLines(page({ styles: { ...noProbe().styles, color: { "17,24,39": 100, "18,25,40": 2 } } }));
    expect(out.join("\n")).toMatch(/nobody knows what the right number is/);
  });
});

describe("the grid, from real boxes", () => {
  it("finds few lines when the page is on a grid, and names an edge that nearly is", () => {
    const on = [0, 1, 2, 3].map((i) => ({ x: 24, w: 342, at: `card${i}` }));
    const tidy = alignment(on);
    expect(tidy.lines).toBe(2);
    expect(tidy.snapped).toBe(1);
    expect(tidy.stray).toEqual([]);

    // One card three pixels out: still two lines' worth of structure, and the stray is named.
    const off = [...on, { x: 27, w: 342, at: "card.promo" }];
    const drifted = alignment(off);
    expect(drifted.lines).toBeGreaterThan(tidy.lines);
    expect(drifted.stray).toContain("card.promo");
    expect(drifted.snapped).toBeLessThan(1);
  });

  it("is not confused by an empty page", () => {
    expect(alignment([])).toEqual({ lines: 0, snapped: 1, stray: [] });
  });
});

describe("what the report carries", () => {
  it("leads with what is broken, then the near-misses, then the counts", () => {
    const out = coherenceLines(page({
      text: [text({ fg: "200,200,200", bg: "255,255,255", at: "p" })],
      styles: { ...noProbe().styles, fontSize: { "12px": 847, "13px": 1 } },
    })).join("\n");
    expect(out.indexOf("What the running page showed")).toBeLessThan(out.indexOf("nearly one of the page's own steps"));
    expect(out).toContain("13px is used once, 1px from 12px");
    // The counts read as sentences, not as a number welded to a note.
    expect(out).not.toMatch(/as drawn \d/);
  });
});

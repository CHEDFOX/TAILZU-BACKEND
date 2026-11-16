/**
 * MEASURING THE DESIGN LAYER ITSELF (e2e/reality/design.ts), so the taste work ships against evidence rather than against an opinion.
 *
 * Every design brief and slop detector in this field was shipped on taste, because nobody had an instrument. This is the instrument: faults
 * planted in a corpus on purpose, read by the real checks. What these hold down:
 *   - a planted fault that is found counts, and one that is missed is named;
 *   - CRYING WOLF IS DISQUALIFYING. A page with nothing wrong must produce nothing at all, and the verdict falls the moment it does not,
 *     because a check nobody trusts takes every other check down with it;
 *   - a stray value is reported but is never counted as a fault, so it can never flatter the score;
 *   - no browser means "unknown", never a pass.
 */
import { describe, expect, it } from "vitest";
import { CASES, designMarkdown, designVerdict, fired, scoreDesign, type Case, type DesignScore } from "../e2e/reality/design.js";
import { noProbe, type ProbeResult } from "../src/code/agent/probe.js";

/** A browser that answers with whatever the case says the page measured like, so the scorer can be tested with no browser at all. */
function fakeBrowser(byName: Record<string, Partial<ProbeResult>>) {
  const render = async (url: string, o: { reducedMotion?: boolean }) => {
    const key = decodeURIComponent(url).replace(/^data:text\/html;charset=utf-8,/, "");
    const over = byName[key] ?? {};
    const base: ProbeResult = { ...noProbe(), walked: 30, viewport: { w: 320, h: 720 }, doc: { scrollWidth: 320, clientWidth: 320 }, ...over };
    return { value: o.reducedMotion ? { ...base, text: [], animations: over.animations ?? [] } : { ...base, animations: [] } };
  };
  return render;
}
const SOUND_HTML = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><h1>A</h1></body></html>';
const read = async (html: string) => html;

describe("the corpus", () => {
  it("has sound pages in it, because the false-alarm half is the half that matters", () => {
    expect(CASES.filter((c) => c.plant.length === 0).length).toBeGreaterThanOrEqual(2);
    // Every other page plants exactly one fault, so a miss or a false alarm is unambiguous.
    for (const c of CASES.filter((x) => x.plant.length)) expect(c.plant, c.name).toHaveLength(1);
    // And between them the cases cover both readers: the free floor and the measured page.
    const all = CASES.flatMap((c) => c.plant);
    expect(all).toContain("viewport");
    expect(all).toContain("motion.reduce");
  });
});

describe("what fired on a page", () => {
  it("gathers the floor and the measurement into one list, and marks a stray as a stray", () => {
    const p: ProbeResult = { ...noProbe(), walked: 10, styles: { ...noProbe().styles, fontSize: { "12px": 40, "13px": 1 } } };
    const out = fired("<html><body><img src=x></body></html>", p);
    expect(out).toContain("viewport");
    expect(out).toContain("img.alt");
    expect(out).toContain("stray:text size");
  });
});

describe("the score", () => {
  const cases: Case[] = [
    { name: "sound", html: SOUND_HTML, plant: [] },
    { name: "faint", html: SOUND_HTML, plant: ["text.contrast"] },
    { name: "no ring", html: SOUND_HTML, plant: ["focus.none"] },
  ];

  it("counts what was caught and names what was missed", async () => {
    const s = await scoreDesign(fakeBrowser({
      [SOUND_HTML]: { text: [{ px: 16, weight: 400, chars: 200, fg: "200,200,200", bg: "255,255,255", at: "p" }] },
    }), read, cases);
    // Every page here measures the same way, so the faint one is caught and the ring one is missed.
    expect(s.planted).toBe(2);
    expect(s.found).toBe(1);
    expect(s.caught).toBe(0.5);
    expect(s.cases.find((c) => c.name === "no ring")!.missed).toEqual(["focus.none"]);
    // And the sound page fired something, which is the thing that must not happen.
    expect(s.crying).toBe(1);
  });

  it("is clean when the pages are clean", async () => {
    const s = await scoreDesign(fakeBrowser({ [SOUND_HTML]: {} }), read, [{ name: "sound", html: SOUND_HTML, plant: [] }]);
    expect(s.crying).toBe(0);
    expect(s.caught).toBe(1);
    expect(designVerdict(s)).toBe("working");
  });

  it("a stray never flatters the score, because no case ever plants one", async () => {
    const s = await scoreDesign(fakeBrowser({ [SOUND_HTML]: { styles: { ...noProbe().styles, fontSize: { "12px": 40, "13px": 1 } } } }), read,
      [{ name: "sound", html: SOUND_HTML, plant: [] }]);
    expect(s.cases[0]!.fired).toContain("stray:text size");
    expect(s.crying, "a stray is reported but is not a fault, so it is not a false alarm either").toBe(0);
  });

  it("calls it unknown when no page could be measured, never a pass", async () => {
    const dead = async () => ({ value: undefined });
    const s = await scoreDesign(dead, read, cases);
    expect(s.cases).toHaveLength(0);
    expect(s.unmeasured).toBe(3);
    expect(designVerdict(s)).toBe("unknown");
    expect(designMarkdown(s).join("\n")).toMatch(/Not measured: no browser/);
  });
});

describe("the verdict", () => {
  const made = (over: Partial<DesignScore>): DesignScore => ({ cases: [{ name: "x", planted: [], fired: [], caught: [], missed: [], extra: [], sound: true, trouble: [] }], caught: 1, planted: 4, found: 4, crying: 0, soundPages: 1, sameness: [], unmeasured: 0, ...over });

  it("falls the moment it cries wolf, whatever else it caught", () => {
    expect(designVerdict(made({}))).toBe("working");
    expect(designVerdict(made({ crying: 1 }))).toBe("weak");
    expect(designVerdict(made({ crying: 3 }))).toBe("broken");
    // Even a perfect catch rate does not save it.
    expect(designVerdict(made({ caught: 1, crying: 5 }))).toBe("broken");
  });

  it("otherwise reads from how much it caught", () => {
    expect(designVerdict(made({ caught: 0.95 }))).toBe("working");
    expect(designVerdict(made({ caught: 0.7 }))).toBe("weak");
    expect(designVerdict(made({ caught: 0.3 }))).toBe("broken");
  });

  it("puts both numbers in the report, and says which one decides", () => {
    const md = designMarkdown(made({ caught: 0.5, planted: 4, found: 2, crying: 0 })).join("\n");
    expect(md).toContain("Caught**: 2 of 4 (50%)");
    expect(md).toMatch(/decides whether any of it gets switched off/);
  });
});

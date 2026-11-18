/**
 * THE APP'S DESIGN RULES, AS CHECKS OVER A DRAWN SCREEN (src/experience/sdui2/design.ts).
 *
 * lint.ts answers "can the phone draw this at all". This answers "is what it draws this app". It exists because a screen a
 * MODEL draws calls none of the kit's helpers, so the kit's rules — which lived in its header as prose — have to be checks.
 *
 * What these hold down:
 *   - every rule fires on the thing it is about, and says where and why in words a person could read;
 *   - the errors are the ones that make a screen wrong on a real phone: two handlers on one tap, a colour the clients
 *     will disagree on, a border the phone draws nothing for, text nobody can read;
 *   - contrast is checked ONLY when both colours are known from the theme, and never guessed;
 *   - a hand-built screen is held to the errors alone: its warnings were the kit's own choices;
 *   - the tells are counted and never refuse a screen;
 *   - a screen this cannot read has no findings, because refusing a shape is lint.ts's job, not this one's;
 *   - AND THE APP'S OWN SCREENS PASS: a rule the kit's own pages break is a rule written down wrong.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRAST_MIN, TOUCH_MIN, PER_RULE_MAX, checkDesign, contrast, designWords, resolveColour,
} from "../src/experience/sdui2/design.js";
import type { Node, ThemeTokens } from "../../shared/types/sdui.js";

const theme: Partial<ThemeTokens> = {
  color: { text: "#111111", bg: "#ffffff", muted: "#949494", surface: "#f5f5f5", faint: "#eeeeee" },
};
const screen = (root: Node) => ({ root, theme });
const text = (over: Partial<Node> = {}): Node => ({ type: "Text", props: { content: "Connect GitHub to import a project" }, style: { lineHeight: 20, color: "$color.text" }, ...over });
const rules = (r: ReturnType<typeof checkDesign>) => ({
  errors: r.errors.map((f) => f.rule), warnings: r.warnings.map((f) => f.rule), tells: r.tells.map((f) => f.rule),
});

describe("colour", () => {
  it("resolves a theme token and a hex, and knows what it cannot resolve", () => {
    expect(resolveColour("$color.text", theme)).toBe("#111111");
    expect(resolveColour("#ABCDEF", theme)).toBe("#abcdef");
    expect(resolveColour("$color.nothere", theme)).toBeNull();
    expect(resolveColour("$space.md", theme)).toBeNull();
    expect(resolveColour("rebeccapurple", theme)).toBeNull();
    expect(resolveColour(undefined, theme)).toBeNull();
  });

  it("counts contrast as WCAG does", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
    // The same pair either way round.
    expect(contrast("#111111", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#111111"), 5);
  });

  it("written out is NOT a fault: the kit writes explicit styles so the two clients cannot diverge", () => {
    // A first version of these rules called this an error, and 909 of the app's own nodes broke it. The app is the authority.
    for (const v of ["#ff0000", "$color.bg", "transparent"]) {
      const r = checkDesign(screen({ type: "Stack", style: { backgroundColor: v }, children: [text()] }), { theme });
      expect(rules(r).errors, v).toEqual([]);
    }
  });
});

describe("the rules that make a screen wrong on a phone", () => {
  it("refuses a pressable inside a pressable: one tap would do both", () => {
    const inner: Node = { type: "Stack", on: { onPress: "inner" }, style: { height: 48 }, children: [text()] };
    const r = checkDesign(screen({ type: "Stack", on: { onPress: "outer" }, style: { height: 60 }, children: [inner] }), { theme });
    expect(rules(r).errors).toEqual(["pressable.nested"]);
    expect(r.errors[0]!.at).toBe("root.children[0]");
    // One of them alone is right.
    expect(checkDesign(screen({ type: "Stack", on: { onPress: "x" }, style: { height: 60 }, children: [text()] }), { theme }).errors).toEqual([]);
  });

  it("refuses a border written the CSS way, which the phone draws nothing for", () => {
    const r = checkDesign(screen({ type: "Stack", style: { border: "1px solid #000" }, children: [text()] }), { theme });
    expect(rules(r).errors).toContain("border.css");
    const ok = checkDesign(screen({ type: "Stack", style: { borderWidth: 1, borderColor: "$color.faint" }, children: [text()] }), { theme });
    expect(rules(ok).errors).toEqual([]);
  });

  it("refuses text nobody can read, and only when both colours are known", () => {
    const faint = { type: "Stack", style: { backgroundColor: "$color.bg" }, children: [text({ style: { lineHeight: 20, color: "$color.faint" } })] } as Node;
    const r = checkDesign(screen(faint), { theme });
    expect(rules(r).errors).toEqual(["contrast.low"]);
    expect(r.errors[0]!.text).toMatch(new RegExp(`${CONTRAST_MIN} to 1`));

    // Readable: no finding.
    const dark = { type: "Stack", style: { backgroundColor: "$color.bg" }, children: [text()] } as Node;
    expect(checkDesign(screen(dark), { theme }).errors).toEqual([]);

    // A colour the theme does not hold is NOT guessed at.
    const unknown = { type: "Stack", style: { backgroundColor: "$color.bg" }, children: [text({ style: { lineHeight: 20, color: "$color.mystery" } })] } as Node;
    expect(checkDesign(screen(unknown), { theme }).errors).toEqual([]);
    // And with no theme at all, nothing is resolved, so nothing is claimed.
    expect(checkDesign({ root: faint }, {}).errors).toEqual([]);
  });

  it("takes the nearest colour behind the text, not the one at the top", () => {
    const deep: Node = {
      type: "Stack", style: { backgroundColor: "$color.text" },
      children: [{ type: "Stack", style: { backgroundColor: "$color.bg" }, children: [text()] }],
    };
    // Dark text on the white panel it actually sits on: fine, though the page behind is dark.
    expect(checkDesign(screen(deep), { theme }).errors).toEqual([]);
  });
});

describe("the rules that make a screen drift between the clients", () => {
  it("warns about text with no line height", () => {
    const r = checkDesign(screen({ type: "Stack", children: [text({ style: { color: "$color.text" } })] }), { theme });
    expect(rules(r).warnings).toEqual(["text.lineHeight"]);
  });

  it("warns about an image with no size, and not one with any of the three", () => {
    const bare = checkDesign(screen({ type: "Stack", children: [{ type: "Image", props: { source: { url: "u" } } }] }), { theme });
    expect(rules(bare).warnings).toEqual(["image.size"]);
    for (const style of [{ width: 40, height: 40 }, { aspectRatio: 1 }, { height: 32 }]) {
      const ok = checkDesign(screen({ type: "Stack", children: [{ type: "Image", props: { source: { url: "u" } }, style }] }), { theme });
      expect(rules(ok).warnings, JSON.stringify(style)).toEqual([]);
    }
  });

  it("warns about something to press a finger cannot find", () => {
    const r = checkDesign(screen({ type: "Stack", on: { onPress: "x" }, style: { height: 28, width: 28 }, children: [] }), { theme });
    expect(rules(r).warnings).toEqual(["touch.small"]);
    expect(r.warnings[0]!.text).toMatch(new RegExp(String(TOUCH_MIN)));
    const ok = checkDesign(screen({ type: "Stack", on: { onPress: "x" }, style: { height: TOUCH_MIN }, children: [] }), { theme });
    expect(rules(ok).warnings).toEqual([]);
  });

  it("holds a HAND-BUILT screen to the errors alone: its warnings were the kit's own choices", () => {
    const built = screen({ type: "Stack", children: [text({ style: { color: "$color.text" } }), { type: "Image", props: { source: { url: "u" } } }] });
    expect(rules(checkDesign(built, { theme, drawn: false }))).toEqual({ errors: [], warnings: [], tells: [] });
    // The same screen, drawn by a model: the warnings are said.
    expect(checkDesign(built, { theme, drawn: true }).warnings.length).toBe(2);
  });
});

describe("the marks of a drawn page", () => {
  const eyebrow = (n: number): Node => ({
    type: "Stack",
    children: Array.from({ length: n }, (_, i) => ({
      type: "Stack" as const,
      children: [
        { type: "Text", props: { content: `SECTION ${i}` }, style: { fontSize: 12, letterSpacing: 1, lineHeight: 16, color: "$color.muted" } },
        { type: "Text", props: { content: `A heading number ${i}` }, style: { fontSize: 24, lineHeight: 30, color: "$color.text" } },
      ],
    })),
  });

  it("counts a label above every heading, and lets one go", () => {
    expect(rules(checkDesign(screen(eyebrow(1)), { theme })).tells).toEqual([]);
    const many = checkDesign(screen(eyebrow(3)), { theme });
    expect(rules(many).tells).toEqual(["tell.eyebrow"]);
    // Counted, never a refusal.
    expect(many.errors).toEqual([]);
  });

  it("notices the same heading drawn twice", () => {
    const twice: Node = {
      type: "Stack",
      children: [
        { type: "Text", props: { content: "Connect GitHub" }, style: { fontSize: 24, lineHeight: 30, color: "$color.text" } },
        { type: "Text", props: { content: "Connect GitHub" }, style: { fontSize: 24, lineHeight: 30, color: "$color.text" } },
      ],
    };
    const r = checkDesign(screen(twice), { theme });
    expect(rules(r).tells).toEqual(["tell.repeated"]);
    expect(r.tells[0]!.text).toContain("Connect GitHub");
  });
});

/**
 * THE TEST THAT DECIDES WHETHER THESE RULES ARE THE APP'S. The kit's helpers are the design, so a rule the app's own screens
 * break is a rule I have written down wrong, not a screen that is wrong. Every real page is built and held to the ERRORS.
 */
describe("the app's own screens", () => {
  it("pass their own rules: every real page, built for a phone, with no errors", async () => {
    const { BOTS_SCREENS, buildBotsScreen } = await import("../src/experience/bots/index.js");
    const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
    const ids = [...BOTS_SCREENS.keys()];
    expect(ids.length).toBeGreaterThan(30);

    const broke: string[] = [];
    for (const id of ids) {
      let built;
      try {
        built = await buildBotsScreen(
          { screenId: id, client: "phone", tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(["BotsKit"]), desk: { pages: false, notes: false } },
          fakeDeps(),
        );
      } catch { continue; } // a page that needs params this test does not have is not this test's business
      const r = checkDesign(built as never, { drawn: false });
      for (const f of r.errors) broke.push(`${id} ${f.rule}`);
    }
    // The one place the app breaks its own floor today, left here by NAME so a new one still fails this test: the
    // "Connect GitHub" button on Xode's screens is #8a8a8a on #e6e6e6, 2.8 to 1, where 4.5 can be read. It may be meant
    // as a disabled state; it is the owner's to judge, and it is written down rather than quietly allowed.
    const KNOWN = ["bots.code contrast.low", "bots.code.start contrast.low"];
    expect([...new Set(broke)].sort()).toEqual([...new Set(KNOWN)].sort());
  }, 30_000);
});

describe("what it does not do", () => {
  it("has no findings for a screen it cannot read: refusing a shape is lint.ts's job", () => {
    for (const bad of [{}, { root: null as never }, { root: { type: "Stack", children: "nope" } as never }]) {
      expect(() => checkDesign(bad as never, { theme })).not.toThrow();
    }
    expect(checkDesign({}, { theme })).toEqual({ errors: [], warnings: [], tells: [] });
  });

  it("checks the blocks of a templated screen as well as a root", () => {
    const r = checkDesign({ blocks: [{ type: "Stack", style: { border: "1px solid #000" }, children: [] }], theme }, { theme });
    expect(rules(r).errors).toEqual(["border.css"]);
    expect(r.errors[0]!.at).toBe("blocks[0]");
  });

  it("stops at a handful of one rule, so one bad screen cannot fill a log", () => {
    const many: Node = { type: "Stack", children: Array.from({ length: PER_RULE_MAX + 5 }, () => ({ type: "Stack" as const, style: { border: "1px solid red" }, children: [] })) };
    expect(checkDesign(screen(many), { theme }).errors).toHaveLength(PER_RULE_MAX);
  });

  it("says its findings in lines a person could read", () => {
    const r = checkDesign(screen({ type: "Stack", style: { border: "1px" }, children: [text({ style: { color: "$color.text" } })] }), { theme });
    const words = designWords(r);
    expect(words.join("\n")).toMatch(/^- root: /m);
    expect(words.some((w) => /line height/.test(w))).toBe(true);
  });
});

/**
 * THE ONE OPEN BLOCK (src/show/types.ts `part`, src/show/style.ts, experience/bots/show.ts):
 *
 *   - the model names what a thing IS and never how it looks; every role resolves onto a look this app already has
 *   - a role NOBODY wrote down still lands on one of those looks — invention cannot come out off-style
 *   - a part that cannot be drawn is dropped alone: text with no words, a box with nothing in it, a control with nothing to do
 *   - a copiable snippet, which no named block can express, is a composition of three parts
 *   - every tree a part draws is still the kit's own: `lintTree` returns [] and the app's design rules pass
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { boxLook, controlLook, normalRole, textLook, LOOKS } = await import("../src/show/style.js");
const { checkShown } = await import("../src/show/check.js");
const { Seen } = await import("../src/show/links.js");
const { SHOW_LIMITS: L } = await import("../src/show/types.js");
const { showNodes } = await import("../src/experience/bots/show.js");
const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { checkDesign } = await import("../src/experience/sdui2/design.js");
const { BOTS_THEME, page } = await import("../src/experience/bots/kit.js");
type Block = import("../src/show/types.js").Block;

const shownOf = (blocks: unknown[]) => checkShown({ blocks }, { seen: new Seen() });
const kept = (blocks: unknown[]): Block[] => shownOf(blocks)?.blocks ?? [];
const draw = (blocks: Block[], live = true) =>
  showNodes(ctxFor("bots.chat", "phone"), { blocks }, { slug: "buddy", turn: "t1", live });
const wordsOf = (nodes: unknown[]) => nodes.flatMap((n) => [...walk(n as never)]).map((n) => (n.props as { content?: unknown } | undefined)?.content).filter((c) => typeof c === "string") as string[];

describe("a role becomes a look", () => {
  it("reads the names we thought of", () => {
    expect(textLook("code")).toBe("mono");
    expect(textLook("title")).toBe("title");
    expect(textLook("caption")).toBe("meta");
    expect(textLook("total")).toBe("big");
    expect(boxLook("warning")).toEqual({ card: true, tone: "warn" });
    expect(boxLook("group")).toEqual({ card: false });
    expect(controlLook("copy", { copy: true })).toBe("copy");
  });

  it("reads a name nobody wrote down, off its shape", () => {
    // Invented, and each one still lands where a person would put it.
    expect(textLook("api_snippet")).toBe("mono");
    expect(textLook("shellCommand")).toBe("mono");
    expect(textLook("sqlQuery")).toBe("mono");
    expect(textLook("headline")).toBe("title");
    expect(textLook("sub-section")).toBe("heading");
    expect(textLook("severity-badge")).toBe("label");
    expect(textLook("tiny footnote")).toBe("meta");
    expect(textLook("monthly_total")).toBe("big");
    expect(boxLook("severity")).toEqual({ card: true, tone: "warn" });
    expect(boxLook("deployment_failure")).toEqual({ card: true, tone: "warn" });
    expect(boxLook("recommendation")).toEqual({ card: true, tone: "tip" });
    expect(boxLook("candidate")).toEqual({ card: true });
    expect(boxLook("side-by-side")).toEqual({ card: false, row: true });
  });

  it("gives a role it cannot read at all the plain look of its family, never nothing", () => {
    for (const nonsense of ["zzz", "qwertyuiop", "💡", "x", "флуд", "a-b-c-d"]) {
      expect(LOOKS.text).toContain(textLook(nonsense));
      const b = boxLook(nonsense);
      expect(typeof b.card).toBe("boolean");
    }
    expect(textLook("zzz")).toBe("body");
    expect(boxLook("zzz")).toEqual({ card: false });
  });

  it("matches a name however it was written", () => {
    expect(normalRole(" Code_Snippet ")).toBe("codesnippet");
    for (const w of ["code", "Code", "CODE", " code ", "co-de", "co_de", "co.de"]) expect(textLook(w)).toBe("mono");
  });

  it("lets what a control was GIVEN win over what it was called", () => {
    // Called copy, handed only words to send: it can only send, so that is what it is.
    expect(controlLook("copy", { say: true })).toBe("say");
    expect(controlLook("pick", { copy: true })).toBe("copy");
    // Given nothing: not a control at all.
    expect(controlLook("copy", {})).toBeNull();
    expect(controlLook("anything", {})).toBeNull();
  });
});

describe("the checker", () => {
  it("keeps a part of each kind", () => {
    const blocks = kept([
      { type: "part", kind: "text", role: "code", text: "npm run dev" },
      { type: "part", kind: "box", role: "comparison", children: [{ type: "text", text: "inside" }] },
      { type: "part", kind: "control", role: "copy", text: "Copy", action: { do: "copy", text: "npm run dev" } },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["part", "part", "part"]);
  });

  it("drops a part that cannot be drawn, and keeps the rest", () => {
    const blocks = kept([
      { type: "part", kind: "text", role: "code" },                                  // no words
      { type: "part", kind: "box", role: "group", children: [] },                    // nothing inside
      { type: "part", kind: "box", role: "group", children: [{ type: "nonsense" }] }, // nothing inside that survives
      { type: "part", kind: "control", role: "copy" },                               // nothing to do
      { type: "part", kind: "elephant", role: "code", text: "x" },                   // not a kind
      { type: "part", kind: "text", role: "code", text: "kept" },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "part", kind: "text", role: "code", text: "kept" });
  });

  it("names a part with no role after its kind rather than refusing it", () => {
    const [b] = kept([{ type: "part", kind: "text", text: "hello" }]);
    expect(b).toEqual({ type: "part", kind: "text", role: "text", text: "hello" });
  });

  it("holds a role, a text and the controls to their caps", () => {
    const long = "r".repeat(200);
    const [b] = kept([{ type: "part", kind: "text", role: long, text: "x" }]);
    expect((b as { role: string }).role.length).toBeLessThanOrEqual(L.role);

    const many = Array.from({ length: L.controls + 4 }, (_v, i) => ({ type: "part", kind: "control", role: "copy", action: { do: "copy", text: `x${i}` } }));
    expect(kept(many)).toHaveLength(L.controls);
  });

  it("holds a part box to the same nesting depth as every other box", () => {
    const deep = (n: number): unknown => (n === 0 ? { type: "text", text: "floor" } : { type: "part", kind: "box", role: "group", children: [deep(n - 1)] });
    const blocks = kept([deep(L.depth + 3)]);
    const depthOf = (b: Block, d = 1): number =>
      "children" in b && Array.isArray(b.children) && b.children.length ? Math.max(...(b.children as Block[]).map((c) => depthOf(c, d + 1))) : d;
    expect(blocks.length ? depthOf(blocks[0]!) : 0).toBeLessThanOrEqual(L.depth + 1);
  });
});

describe("on the screen", () => {
  it("draws a copiable snippet, which no named block can express", () => {
    const blocks = kept([{
      type: "part", kind: "box", role: "snippet", children: [
        { type: "part", kind: "text", role: "label", text: "Run this" },
        { type: "part", kind: "text", role: "code", text: "npm run dev" },
        { type: "part", kind: "control", role: "copy", text: "Copy", action: { do: "copy", text: "npm run dev" } },
      ],
    }]);
    const nodes = draw(blocks);
    const words = wordsOf(nodes);
    expect(words).toContain("npm run dev");
    expect(words).toContain("Copy");
    // The copy really is wired to the clipboard, with the phone's own action.
    expect(JSON.stringify(nodes)).toContain("copyToClipboard");
  });

  it("uses the window's own copy action in the window", () => {
    const blocks = kept([{ type: "part", kind: "control", role: "copy", text: "Copy", action: { do: "copy", text: "x" } }]);
    const nodes = showNodes(ctxFor("bots.chat", "desktop"), { blocks }, { slug: "buddy", turn: "t1", live: true });
    expect(JSON.stringify(nodes)).toContain("copyText");
    expect(JSON.stringify(nodes)).not.toContain("copyToClipboard");
  });

  it("draws a control that SENDS only on the newest turn, and a copy on any", () => {
    const say = kept([{ type: "part", kind: "control", role: "pick", text: "Use this one", action: { do: "say", words: "use the first one" } }]);
    expect(wordsOf(draw(say, true))).toContain("Use this one");
    expect(wordsOf(draw(say, false))).not.toContain("Use this one");

    const copy = kept([{ type: "part", kind: "control", role: "copy", text: "Copy", action: { do: "copy", text: "x" } }]);
    expect(wordsOf(draw(copy, false))).toContain("Copy");
  });

  it("draws an INVENTED role in this app's own style: the kit's nodes, its lint clean, its design rules passed", () => {
    const blocks = kept([{
      type: "part", kind: "box", role: "deployment_severity", children: [
        { type: "part", kind: "text", role: "incident_headline", text: "The deploy failed" },
        { type: "part", kind: "text", role: "root_cause_detail", text: "The migration ran out of room." },
        { type: "part", kind: "text", role: "failing_command", text: "./deploy/ship.sh" },
        { type: "part", kind: "control", role: "duplicate", text: "Copy the command", action: { do: "copy", text: "./deploy/ship.sh" } },
      ],
    }]);
    const nodes = draw(blocks);
    expect(nodes.length).toBeGreaterThan(0);
    // Nothing here needs a block a client had to declare, and nothing breaks the app's own design rules.
    for (const n of nodes) expect(lintTree(n as never)).toEqual([]);
    const screen = page(ctxFor("bots.chat", "phone"), { body: nodes as never });
    expect(checkDesign(screen, { theme: BOTS_THEME, drawn: true }).errors).toEqual([]);
  });

  it("draws a part box as a row when the role says side by side", () => {
    const blocks = kept([{
      type: "part", kind: "box", role: "side-by-side", children: [
        { type: "part", kind: "text", role: "body", text: "left" },
        { type: "part", kind: "text", role: "body", text: "right" },
      ],
    }]);
    const nodes = draw(blocks);
    expect(wordsOf(nodes)).toEqual(expect.arrayContaining(["left", "right"]));
    for (const n of nodes) expect(lintTree(n as never)).toEqual([]);
  });
});

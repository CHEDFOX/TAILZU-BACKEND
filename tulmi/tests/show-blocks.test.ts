/**
 * WHAT A BOT MAY DRAW (src/show/types.ts, check.ts, links.ts, answer.ts):
 *
 *   - the building blocks are kept as they compose (boxes in boxes, three deep), each cut to its caps
 *   - a block that is wrong is dropped alone and the rest stay; nothing usable is null
 *   - a link or a picture only with an address the turn read, character for character; never one with a password in it
 *   - anything that looks like a secret drops the whole drawing
 *   - every choice and form gets its key, the same one when the drawing is read back
 *   - what the person picked and typed comes back as plain words, and a pick that names no option is left out
 *   - Blip only doing one of his acts
 */
import { describe, expect, it } from "vitest";
import { checkShown, keptShown } from "../src/show/check.js";
import { linksIn, safeUrl, Seen } from "../src/show/links.js";
import { wordsOf } from "../src/show/answer.js";
import { SHOW_LIMITS, type Block } from "../src/show/types.js";

const none = { has: () => false };
const all = { has: () => true };
const check = (blocks: unknown[], seen = none, lists?: unknown) => checkShown({ blocks, ...(lists !== undefined ? { lists } : {}) }, { seen });

describe("the blocks", () => {
  it("keeps every kind it knows, as they compose", () => {
    const s = check([
      { type: "callout", tone: "warn", title: "Book the ferry first", text: "Only two boats on Saturday." },
      { type: "row", children: [{ type: "stat", label: "Drive", value: "3 h" }, { type: "stat", label: "Budget", value: "₹14,000", note: "two people" }] },
      { type: "card", title: "Plan", tone: "bot", children: [{ type: "steps", items: [{ title: "Ferry", state: "done" }, "Stay", { title: "Pack", state: "next" }] }] },
      { type: "chart", kind: "line", unit: "°C", items: [{ label: "Fri", value: 29 }, { label: "Sat", value: "31" }] },
      { type: "table", columns: ["Stay", "Price"], rows: [["Hut", "₹3,200"], ["Villa"]] },
      { type: "draw", width: 100, height: 50, shapes: [{ circle: [10, 10, 4], fill: "bot" }, { d: "M0 0 L100 50", stroke: "#3E6E8E", width: 2 }] },
      { type: "divider" },
      { type: "suggest", items: ["Make it cheaper", "Make it cheaper", "Add a day"] },
    ]);
    expect(s!.blocks.map((b) => b.type)).toEqual(["callout", "row", "card", "chart", "table", "draw", "divider", "suggest"]);
    expect((s!.blocks[2] as Extract<Block, { type: "card" }>).children[0]).toEqual({ type: "steps", items: [{ title: "Ferry", state: "done" }, { title: "Stay" }, { title: "Pack", state: "next" }] });
    expect(s!.blocks[3]).toMatchObject({ items: [{ label: "Fri", value: 29 }, { label: "Sat", value: 31 }] });
    expect(s!.blocks[4]).toMatchObject({ rows: [["Hut", "₹3,200"], ["Villa", ""]] });
    expect(s!.blocks[7]).toEqual({ type: "suggest", items: ["Make it cheaper", "Add a day"] });
  });

  it("drops a block that is wrong, alone, and gives null when nothing is left", () => {
    const s = check([
      { type: "marquee", text: "nope" }, { type: "text" }, { type: "chart", items: [{ label: "one", value: 1 }] }, { type: "stat", label: "x" },
      { type: "draw", width: 5000, height: 10, shapes: [{ circle: [1, 1, 1] }] }, { type: "draw", width: 10, height: 10, shapes: [{ d: "M0 0 <script>" }] },
      { type: "row", children: [{ type: "nope" }] }, "text", null,
      { type: "text", text: "Kept." },
    ]);
    expect(s!.blocks).toEqual([{ type: "text", text: "Kept." }]);
    expect(check([{ type: "nope" }])).toBeNull();
    expect(checkShown(null, { seen: none })).toBeNull();
    expect(checkShown({ blocks: "x" }, { seen: none })).toBeNull();
  });

  it("holds every cap: the top, the total, the depth, a text, the options", () => {
    expect(check(Array.from({ length: 20 }, (_, i) => ({ type: "text", text: `t${i}` })))!.blocks).toHaveLength(SHOW_LIMITS.top);
    const deep = { type: "card", children: [{ type: "card", children: [{ type: "card", children: [{ type: "card", children: [{ type: "text", text: "too deep" }] }, { type: "text", text: "deep enough" }] }] }] };
    expect(JSON.stringify(check([deep]))).not.toContain("too deep");
    expect(JSON.stringify(check([deep]))).toContain("deep enough");
    const long = check([{ type: "text", text: "x".repeat(5000) }])!.blocks[0] as { text: string };
    expect(long.text.length).toBe(SHOW_LIMITS.text);
    expect(long.text.endsWith("…")).toBe(true);
    const many = check([{ type: "choice", options: Array.from({ length: 20 }, (_, i) => `o${i}`) }])!.blocks[0] as Extract<Block, { type: "choice" }>;
    expect(many.options).toHaveLength(SHOW_LIMITS.options);
    const grids = check(Array.from({ length: 8 }, () => ({ type: "grid", columns: 9, children: Array.from({ length: 12 }, () => ({ type: "divider" })) })));
    let count = 0;
    const walk = (bs: Block[]) => { for (const b of bs) { count += 1; if ("children" in b) walk(b.children); } };
    walk(grids!.blocks);
    expect(count).toBeLessThanOrEqual(SHOW_LIMITS.total);
    expect((grids!.blocks[0] as { columns: number }).columns).toBe(SHOW_LIMITS.grid);
  });

  it("takes markdown's bold marks and control characters out of a text", () => {
    expect(check([{ type: "text", text: "**Book** it\u0007 now‮" }])!.blocks[0]).toEqual({ type: "text", text: "Book it now" });
  });

  it("asks three times at most, suggests once, and keys each ask in order (read back the same)", () => {
    const raw = [
      { type: "choice", options: ["a", "b"] }, { type: "card", children: [{ type: "form", fields: [{ label: "Name" }] }] },
      { type: "choice", options: ["c"], multi: true }, { type: "choice", options: ["d"] }, { type: "suggest", items: ["x"] }, { type: "suggest", items: ["y"] },
    ];
    const s = check(raw)!;
    const keys = JSON.stringify(s).match(/"key":"k\d"/g);
    expect(keys).toEqual(['"key":"k0"', '"key":"k1"', '"key":"k2"']);
    expect(s.blocks.filter((b) => b.type === "suggest")).toHaveLength(1);
    // one option can't be several
    expect(s.blocks[2]).toMatchObject({ type: "choice", multi: false, send: "Send" });
    expect(keptShown(s)).toEqual(s);
  });

  it("keeps a form's choice field only with two options, and its kinds", () => {
    const s = check([{ type: "form", send: "Book it", fields: [{ label: "Guests", kind: "number", placeholder: "2" }, { label: "Room", kind: "choice", options: ["Sea", "Garden"] }, { label: "When", kind: "choice", options: ["Now"] }, { label: "Guests" }] }])!;
    expect(s.blocks[0]).toEqual({ type: "form", key: "k0", send: "Book it", fields: [
      { label: "Guests", kind: "number", placeholder: "2" }, { label: "Room", kind: "choice", options: ["Sea", "Garden"] }, { label: "When", kind: "text" },
    ] });
  });

  it("says lists are drawn only when a block shows a list", () => {
    expect(check([{ type: "table", columns: ["a"], rows: [["1"]] }], none, "drawn")!.lists).toBe("drawn");
    expect(check([{ type: "card", children: [{ type: "steps", items: ["a"] }] }], none, "drawn")!.lists).toBe("drawn");
    expect(check([{ type: "callout", text: "Careful." }], none, "drawn")!.lists).toBeUndefined();
    expect(check([{ type: "table", columns: ["a"], rows: [["1"]] }], none, "keep")!.lists).toBeUndefined();
  });

  it("keeps Blip only doing one of his acts", () => {
    const text = [{ type: "text", text: "Hi." }];
    expect(checkShown({ blocks: text, blip: "wave" }, { seen: none })!.blip).toBe("wave");
    for (const act of ["dance", "carry", 3, null]) expect(checkShown({ blocks: text, blip: act }, { seen: none })!.blip, String(act)).toBeUndefined();
    // he never stands alone: no blocks, no Blip
    expect(checkShown({ blocks: [], blip: "wave" }, { seen: none })).toBeNull();
  });

  it("keeps a colour only when it is hex or one of the paints, and gives a shape with none a stroke", () => {
    const s = check([{ type: "draw", width: 10, height: 10, shapes: [{ circle: [5, 5, 2], fill: "url(#x)" }, { d: "M0 0L10 10", stroke: "sea" }] }])!;
    expect((s.blocks[0] as Extract<Block, { type: "draw" }>).shapes).toEqual([{ circle: [5, 5, 2], stroke: "ink" }, { d: "M0 0L10 10", stroke: "sea" }]);
  });
});

describe("links and pictures", () => {
  const url = "https://www.python.org/downloads/";

  it("are kept only with an address the turn read, as written", () => {
    const seen = new Seen();
    seen.add(`Get it here: ${url}.`);
    const s = checkShown({ blocks: [
      { type: "link", label: "Download", url }, { type: "image", url: "https://www.python.org/logo.png", alt: "logo" },
      { type: "link", url: `${url}?d=secret` },
    ] }, { seen })!;
    expect(s.blocks).toEqual([{ type: "link", label: "Download", url }]);
  });

  it("are https only, never with a user or password, and six at most", () => {
    expect(safeUrl("http://example.com/")).toBeNull();
    expect(safeUrl("https://me:pw@example.com/")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    const links = Array.from({ length: 10 }, (_, i) => ({ type: "link", label: `l${i}`, url: `https://example.com/${i}` }));
    expect(check(links, all)!.blocks).toHaveLength(SHOW_LIMITS.links);
    expect((check([{ type: "link", url: "https://example.com/x" }], all)!.blocks[0] as { label: string }).label).toBe("example.com");
  });

  it("are found in text without the punctuation round them", () => {
    expect(linksIn("See (https://a.example/x), and https://b.example/y?q=1. Or http://c.example.")).toEqual(["https://a.example/x", "https://b.example/y?q=1"]);
    const s = new Seen(2);
    s.add("https://a.example/1 https://a.example/2 https://a.example/3");
    expect(s.list()).toEqual(["https://a.example/1", "https://a.example/2"]);
    expect(s.has("https://a.example/3")).toBe(false);
  });
});

describe("a secret in a drawing", () => {
  it("drops the whole drawing", () => {
    const key = ["sk", "live", "51H8sdfjk23HJKsdfh23kjhsdfKJH23kjh"].join("_");
    expect(check([{ type: "text", text: "Fine." }, { type: "facts", items: [{ label: "Key", value: key }] }])).toBeNull();
    const ours = ["tzb", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
    expect(check([{ type: "text", text: `Use ${ours}` }])).toBeNull();
  });
});

describe("what the person picked, in words", () => {
  const shown = checkShown({ blocks: [
    { type: "choice", question: "What else?", multi: true, options: ["Scuba", "Old fort", "Night market"] },
    { type: "card", children: [{ type: "form", fields: [{ label: "Guests", kind: "number" }, { label: "Room", kind: "choice", options: ["Sea view", "Garden"] }, { label: "Notes" }] }] },
  ] }, { seen: none })!;

  it("joins the picks with commas and writes a field as Label: value", () => {
    expect(wordsOf(shown, { k0: { o0: true, o2: true, o1: false }, k1: { f0: " 3 ", f1: "Garden", f2: "" } })).toBe("Scuba, Night market\nGuests: 3\nRoom: Garden");
  });

  it("leaves out a pick that names no option, and anything not an object", () => {
    expect(wordsOf(shown, { k1: { f1: "Penthouse" } })).toBe("");
    expect(wordsOf(shown, { k0: { o9: true } })).toBe("");
    expect(wordsOf(shown, "Scuba")).toBe("");
    expect(wordsOf(shown, null)).toBe("");
    expect(wordsOf(shown, { k1: { f2: "x".repeat(1000) } })).toBe(`Notes: ${"x".repeat(300)}`);
  });
});

/**
 * EVERY PART OF THE PROJECT WITH WORDS, TIED TO THE MAP (summarize.ts cardFiles, map.ts keepMeanings, componentCard): what each part does and what
 * a person would call it, written by the index's model from the part's own lines; where it is and what it connects to always the map's data;
 * kept while the part's lines are the same, and written again when they change.
 */
import { describe, expect, it } from "vitest";
import { buildMap, componentCard, findInMap, keepMeanings, mapMarkdown, spanHash } from "../src/code/project/map.js";
import { CARD_CALL_PARTS, cardFiles, cardable, Meter, type CardJob } from "../src/code/project/summarize.js";
import type { StoredFile, SymbolInfo } from "../src/code/project/types.js";

const sym = (name: string, line: number, o: Partial<SymbolInfo> = {}): SymbolInfo => ({ name, kind: "function", line, exported: true, ...o });
const row = (path: string, symbols: SymbolInfo[], o: Partial<StoredFile> = {}): StoredFile => ({
  path, blobSha: "b".repeat(40), lang: "TypeScript", bytes: 100, symbols, imports: [], rank: 0.5, hot: 0, todo: 0, tests: [], summary: "", ...o,
});

describe("the words of a part are kept while its lines are the same", () => {
  it("carries them by fingerprint wherever the part moved; a changed part and a new one have none", () => {
    const old = [sym("guard", 10, { hash: "h1", does: "Refuses a message once the day's money is spent.", say: ["daily limit"] }), sym("pay", 30, { hash: "h2", does: "Charges the order." })];
    const fresh = keepMeanings([sym("guard", 14, { hash: "h1" }), sym("pay", 34, { hash: "h9" }), sym("refund", 50, { hash: "h3" })], old);
    expect(fresh[0]).toMatchObject({ line: 14, does: "Refuses a message once the day's money is spent.", say: ["daily limit"] });
    expect(fresh[1]!.does).toBeUndefined();
    expect(fresh[2]!.does).toBeUndefined();
    // Without fingerprints nothing can be proved the same, unless the file itself is the same.
    expect(keepMeanings([sym("guard", 10)], [sym("guard", 10, { does: "x" })])[0]!.does).toBeUndefined();
    expect(keepMeanings([sym("guard", 10)], [sym("guard", 10, { does: "x" })], { sameFile: true })[0]!.does).toBe("x");
  });
});

describe("the map with the words", () => {
  const files = [
    row("src/front/index.ts", [sym("createFront", 84, { end: undefined, endLine: 136, does: "Builds the front door: decides a message, then carries it out, under the day's limit.", say: ["front door", "daily limit"] })], { imports: ["src/front/decide.ts"], refs: [["decide", 2]], summary: "The front door.", tests: ["tests/front.test.ts"] }),
    row("src/front/decide.ts", [sym("decide", 10, { endLine: 40, does: "Reads what a message asks for and picks the road.", say: ["router"] })]),
  ];
  const map = buildMap({ commit: "c".repeat(40), files, features: [], entries: ["src/front/index.ts"] });

  it("knows who calls each part, from the same edges as the calls", () => {
    expect(map.components["src/front/decide.ts"]!.symbols[0]).toMatchObject({ name: "decide", calledBy: ["src/front/index.ts"], does: "Reads what a message asks for and picks the road.", say: ["router"] });
  });

  it("is found by the words a person uses, not only by names", () => {
    expect(findInMap(map, "where is the daily limit")[0]).toBe("src/front/index.ts");
    expect(findInMap(map, "router")[0]).toBe("src/front/decide.ts");
  });

  it("gives a card: each part at its exact lines with what it does, what people call it and who calls it, then its place in the map", () => {
    const card = componentCard(map, "src/front/decide.ts")!;
    expect(card.split("\n")).toEqual([
      "src/front/decide.ts · reached from the app's entry points",
      "Parts, at their exact lines:",
      "- decide (function) lines 10-40: Reads what a message asks for and picks the road.",
      '  people call it: "router"',
      "  called by: src/front/index.ts",
      "In the map:",
      "- used by: src/front/index.ts",
      "- tests: none cover it",
      "- as of commit ccccccc",
    ]);
    // Checked against the file now: a part that moved is shown where it is, one that changed says its words may be old.
    expect(componentCard(map, "src/front/decide.ts", { checks: [{ status: "changed", start: 12, end: 44 }] })).toContain("- decide (function) lines 12-44 (changed since the map: its words may be old): Reads");
    expect(componentCard(map, "nope.ts")).toBeNull();
  });

  it("links a call only within languages that can make it, and leaves a file's plain values without words off its card", () => {
    const mixed = buildMap({
      commit: "c".repeat(40), entries: ["app.js"], features: [],
      files: [
        row("app.js", [sym("nodeFs", 1, { kind: "const", exported: undefined }), sym("start", 3, { endLine: 9, does: "Starts the app." })], { lang: "JavaScript", refs: [["walk", 1]] }),
        row("native/tzax.swift", [sym("walk", 5, { endLine: 20 })], { lang: "Swift" }),
      ],
    });
    expect(mixed.components["app.js"]!.calls).toEqual([]);
    const card = componentCard(mixed, "app.js")!;
    expect(card).not.toContain("nodeFs");
    expect(card).toContain("- start (function) lines 3-9: Starts the app.");
  });

  it("writes MAP.md with what each part does and who calls it", () => {
    const md = mapMarkdown(map);
    expect(md).toContain("| Symbol | Kind | Lines | What it does | Called by |");
    expect(md).toContain("| `decide` | function | 10–40 | Reads what a message asks for and picks the road. _(router)_ | `src/front/index.ts` |");
  });
});

describe("reading the parts (cardFiles)", () => {
  function scripted(answer: (user: string) => unknown) {
    const sent: string[] = [];
    const call = (async (input: { messages: Array<{ role: string; content: unknown }> }) => {
      const user = String(input.messages.at(-1)!.content);
      sent.push(user);
      const json = answer(user);
      return { text: JSON.stringify(json), json, paise: 1, model: "m", toolCalls: [], promptTokens: 1, completionTokens: 1 };
    }) as never;
    return { sent, ctx: { call, userId: "alice", meter: new Meter(1000) } };
  }
  const text = (n: number) => Array.from({ length: n }, (_, i) => (i % 10 === 0 ? `export function f${i}() {` : `  step(${i});`)).join("\n");
  const symbols = (n: number) => Array.from({ length: Math.ceil(n / 10) }, (_, k) => sym(`f${k * 10}`, k * 10 + 1));
  const job = (path: string, n: number, o: Partial<CardJob> = {}): CardJob => {
    const s = symbols(n);
    return { path, lang: "TypeScript", text: text(n), symbols: s, want: cardable(s), summary: true, redact: false, ...o };
  };
  const echo = (user: string) => ({
    files: [...user.matchAll(/<file path="([^"]*)"[^>]*?(summary="yes")?>\n<parts>\n([\s\S]*?)\n<\/parts>/g)].map((x) => ({
      path: x[1], ...(x[2] ? { summary: `About ${x[1]}.` } : {}),
      parts: [...x[3]!.matchAll(/^p(\d+) \S+ (\S+)/gm)].map((y) => ({ id: `p${y[1]}`, does: `Does ${y[2]}.`, say: [`the ${y[2]} step`, y[2]] })),
    })),
  });

  it("packs small files into one call and gives every part its words, never the part's own name as what people say", async () => {
    const m = scripted(echo);
    const out = await cardFiles(m.ctx as never, [job("a.ts", 30), job("b.ts", 20)], 1000);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toContain('<file path="a.ts" lang="TypeScript" lines="1-30" summary="yes">\n<parts>\np0 function f0 (line 1)\np1 function f10 (line 11)\np2 function f20 (line 21)\n</parts>');
    expect(out.complete).toBe(true);
    expect(out.files.get("a.ts")!.summary).toBe("About a.ts.");
    expect(out.files.get("a.ts")!.parts.get(1)).toEqual({ does: "Does f10.", say: ["the f10 step"] });
  });

  it("reads a long file in parts cut where a part starts; a quick read reads only the head of it", async () => {
    const m = scripted(echo);
    const big = job("big.ts", 4000);
    const out = await cardFiles(m.ctx as never, [big], 1000);
    expect(m.sent.length).toBeGreaterThan(1);
    expect(out.files.get("big.ts")!.parts.size).toBe(big.want.length);
    const quick = scripted(echo);
    const head = await cardFiles(quick.ctx as never, [job("big.ts", 4000)], 1000, { fileChars: 2_000 });
    expect(quick.sent).toHaveLength(1);
    expect(head.files.get("big.ts")!.parts.size).toBeLessThan(big.want.length);
    expect(head.complete).toBe(true);
  });

  it("asks a call for at most CARD_CALL_PARTS parts, so the answer fits", async () => {
    const m = scripted(echo);
    const many = job("many.ts", 1000);
    const out = await cardFiles(m.ctx as never, [many], 1000);
    expect(many.want.length).toBe(100);
    expect(m.sent.length).toBeGreaterThanOrEqual(3);
    for (const u of m.sent) expect((u.match(/^p\d+ /gm) ?? []).length).toBeLessThanOrEqual(CARD_CALL_PARTS);
    expect(out.files.get("many.ts")!.parts.size).toBe(100);
  });

  it("asks a call whose answer failed again as two halves, once; the read is whole when the halves are", async () => {
    // A model whose answer for more than 2 parts at once is never usable (cut short, say).
    const picky = () => scripted((user) => { if ((user.match(/^p\d+ /gm) ?? []).length > 2) throw new Error("the answer was cut short"); return echo(user); });
    const m = picky();
    const out = await cardFiles(m.ctx as never, [job("a.ts", 30, { summary: false })], 1000);
    // 3 parts fail; the halves (2 and 1) are described: whole.
    expect(out.files.get("a.ts")!.parts.size).toBe(3);
    expect(out.complete).toBe(true);
    // 8 parts fail, and so do their halves of 4: a half is not split again, and the read says it is not whole.
    const big = await cardFiles(picky().ctx as never, [job("c.ts", 80, { summary: false })], 1000);
    expect(big.files.get("c.ts")?.parts.size ?? 0).toBe(0);
    expect(big.complete).toBe(false);
  });

  it("asks once more for the parts a model left out", async () => {
    let n = 0;
    const m = scripted((user) => { n += 1; const all = echo(user); return n === 1 ? { files: all.files.map((f) => ({ ...f, parts: f.parts.slice(0, 1) })) } : all; });
    const out = await cardFiles(m.ctx as never, [job("a.ts", 30)], 1000);
    expect(m.sent).toHaveLength(2);
    expect(m.sent[1]).not.toContain("p0 function");
    expect(out.files.get("a.ts")!.parts.size).toBe(3);
  });

  it("describes a file that may hold a secret from its parts' names only, and fingerprints prove what a later build may keep", async () => {
    const m = scripted(echo);
    await cardFiles(m.ctx as never, [job("keys.ts", 10, { redact: true })], 1000);
    expect(m.sent[0]).toContain("the file's text is withheld");
    expect(m.sent[0]).not.toContain("step(");
    expect(spanHash("a\nb\nc", 1, 2)).toBe(spanHash("a\nb\nzzz", 1, 2));
  });
});

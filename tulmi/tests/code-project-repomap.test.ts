/**
 * THE REPO MAP (src/code/project/repomap.ts): a personalised PageRank over the definition/reference graph.
 *
 * A tiny repo is drawn by hand so every edge is known; the tests ask what a walk from a named identifier or path reaches, and what it must not.
 */
import { describe, expect, it } from "vitest";
import { RepoGraph, distinctive, mapFiles, type MapFile } from "../src/code/project/repomap.js";
import type { StoredFile, SymbolInfo } from "../src/code/project/types.js";

const def = (name: string, kind: SymbolInfo["kind"] = "function", exported = true): SymbolInfo => ({ name, kind, line: 1, exported });

/** checkout.ts defines placeOrder and uses chargeCard (payments.ts) and sendReceipt (mail.ts); routes.ts calls placeOrder; the rest is unrelated. */
const REPO: MapFile[] = [
  { path: "src/checkout.ts", symbols: [def("placeOrder")], imports: ["src/payments.ts", "src/mail.ts"], refs: [["chargeCard", 3], ["sendReceipt", 1]] },
  { path: "src/payments.ts", symbols: [def("chargeCard"), def("refundCard")], imports: [], refs: [] },
  { path: "src/mail.ts", symbols: [def("sendReceipt"), def("sendWelcome")], imports: [], refs: [] },
  { path: "src/routes.ts", symbols: [def("registerRoutes")], imports: ["src/checkout.ts"], refs: [["placeOrder", 2]] },
  { path: "src/admin.ts", symbols: [def("adminPanel")], imports: [], refs: [["refundCard", 1]] },
  { path: "src/unrelated.ts", symbols: [def("slugify")], imports: [], refs: [] },
  { path: "src/other/noise.ts", symbols: [def("noiseMaker")], imports: [], refs: [] },
];

describe("RepoGraph", () => {
  const g = new RepoGraph(REPO);

  it("counts what it was given", () => {
    expect(g.stats.files).toBe(7);
    expect(g.stats.refEdges).toBe(4);
    expect(g.stats.importEdges).toBe(3);
    expect(g.stats.withRefs).toBe(3);
    expect(g.has("src/mail.ts")).toBe(true);
    expect(g.has("src/nope.ts")).toBe(false);
  });

  it("walks from a mentioned identifier to the files around its definition, callees and callers alike", () => {
    const hits = g.rank({ identifiers: ["placeOrder"], paths: [] });
    const order = hits.map((h) => h.path);
    expect(order[0]).toBe("src/checkout.ts");
    expect(hits[0]!.seed).toBe(true);
    expect(hits[0]!.why).toBe("defines placeOrder");
    expect(order).toContain("src/payments.ts");
    expect(order).toContain("src/mail.ts");
    expect(order).toContain("src/routes.ts");
    expect(order).not.toContain("src/unrelated.ts");
    expect(order.indexOf("src/payments.ts")).toBeLessThan(order.length);
    expect(hits.every((h) => h.q > 0 && h.q <= 1)).toBe(true);
    expect(hits[0]!.q).toBe(1);
    expect(hits.reduce((a, h) => a + h.rank, 0)).toBeLessThanOrEqual(1.0001);
  });

  it("reaches a CALLER only through the edges run backwards (Aider's map, which follows references alone, never does)", () => {
    const forward = g.rank({ identifiers: ["chargeCard"], paths: [] }, { back: 0 }).map((h) => h.path);
    expect(forward).toContain("src/payments.ts");
    expect(forward).not.toContain("src/checkout.ts");
    const both = g.rank({ identifiers: ["chargeCard"], paths: [] }, { back: 2 }).map((h) => h.path);
    expect(both).toContain("src/checkout.ts");
    expect(both).toContain("src/routes.ts");
  });

  it("says how a file is tied to what was named", () => {
    const hits = g.rank({ identifiers: ["chargeCard"], paths: [] });
    expect(hits.find((h) => h.path === "src/checkout.ts")!.why).toBe("uses chargeCard, from src/payments.ts");
  });

  it("starts from a path the request names", () => {
    const hits = g.rank({ identifiers: [], paths: ["src/mail.ts"] });
    const named = hits.find((h) => h.path === "src/mail.ts")!;
    expect(named.seed).toBe(true);
    expect(named.why).toBe("named in the request");
    // a file with one neighbour hands most of its rank to it, which is why locate asks the map for the NEIGHBOURS of what is named, not for the named file
    expect(hits.slice(0, 2).map((h) => h.path)).toEqual(expect.arrayContaining(["src/mail.ts", "src/checkout.ts"]));
    expect(hits.filter((h) => h.seed).map((h) => h.path)).toEqual(["src/mail.ts"]);
  });

  it("is empty when the request names nothing in this repo, and for an unknown path", () => {
    expect(g.rank({ identifiers: ["nothingLikeIt"], paths: [] })).toEqual([]);
    expect(g.rank({ identifiers: [], paths: ["src/ghost.ts"] })).toEqual([]);
    expect(new RepoGraph([]).rank({ identifiers: ["x"], paths: [] })).toEqual([]);
  });

  it("gives the same answer every time, with ties broken by path", () => {
    const a = g.rank({ identifiers: ["placeOrder", "refundCard"], paths: [] });
    const b = new RepoGraph([...REPO].reverse()).rank({ identifiers: ["placeOrder", "refundCard"], paths: [] });
    expect(b.map((h) => h.path)).toEqual(a.map((h) => h.path));
    expect(g.rank({ identifiers: ["placeOrder"], paths: [] }, { limit: 2 }).length).toBe(2);
  });

  it("ties two named things together through the code that uses both", () => {
    const hits = g.rank({ identifiers: ["chargeCard", "sendReceipt"], paths: [] });
    expect(hits[0]!.path).toBe("src/checkout.ts");
    expect(hits.slice(0, 3).map((h) => h.path)).toEqual(expect.arrayContaining(["src/payments.ts", "src/mail.ts"]));
  });

  it("uses a mentioned identifier's edges ten times as hard, so the request's own words steer the walk", () => {
    const withMention = g.rank({ identifiers: ["refundCard"], paths: [] }).map((h) => h.path);
    expect(withMention.slice(0, 2)).toEqual(expect.arrayContaining(["src/payments.ts"]));
    expect(withMention).toContain("src/admin.ts");
  });

  it("does not treat a name defined in many files as a dependency, nor seed from an ambiguous identifier", () => {
    const many: MapFile[] = Array.from({ length: 12 }, (_, i) => ({ path: `src/m${i}.ts`, symbols: [def("render")], imports: [], refs: i === 0 ? [["render", 5]] : [] }));
    many.push({ path: "src/user.ts", symbols: [def("userThing")], imports: [], refs: [["render", 9]] });
    const m = new RepoGraph(many);
    expect(m.rank({ identifiers: ["render"], paths: [] })).toEqual([]);
    const small = new RepoGraph([
      { path: "a.ts", symbols: [def("_hidden"), def("shown")], imports: [], refs: [] },
      { path: "b.ts", symbols: [def("bThing")], imports: [], refs: [["_hidden", 4], ["shown", 4]] },
    ]);
    const hits = small.rank({ identifiers: ["bThing"], paths: [] });
    expect(hits[0]!.path).toBe("b.ts");
  });

  it("works for a repo read by regex (no references): the imports are the graph", () => {
    const noRefs: MapFile[] = [
      { path: "a.ts", symbols: [def("alpha")], imports: ["b.ts"] },
      { path: "b.ts", symbols: [def("beta")], imports: ["c.ts"] },
      { path: "c.ts", symbols: [def("gamma")], imports: [] },
      { path: "d.ts", symbols: [def("delta")], imports: [] },
    ];
    const hits = new RepoGraph(noRefs).rank({ identifiers: ["beta"], paths: [] }).map((h) => h.path);
    expect(hits.slice(0, 3).sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(hits).not.toContain("d.ts");
  });

  it("seeds from a path that holds the words of a mentioned identifier", () => {
    const files: MapFile[] = [
      { path: "web/SignupForm.tsx", symbols: [def("SignupForm", "component")], imports: [] },
      { path: "web/Footer.tsx", symbols: [def("Footer", "component")], imports: [] },
    ];
    const hits = new RepoGraph(files).rank({ identifiers: ["signupForm"], paths: [] });
    expect(hits[0]!.path).toBe("web/SignupForm.tsx");
  });
});

describe("distinctive", () => {
  it("tells a name that says something from a word every file has", () => {
    expect(distinctive("parseConfigFile")).toBe(true);
    expect(distinctive("parse_config")).toBe(true);
    expect(distinctive("get")).toBe(false);
    expect(distinctive("handler")).toBe(false);
    expect(distinctive("configuration")).toBe(true);
  });
});

describe("mapFiles", () => {
  it("takes a stored file's symbols, imports and references", () => {
    const stored = { path: "a.ts", symbols: [def("a")], imports: ["b.ts"], refs: [["b", 2]] } as unknown as StoredFile;
    const bare = { path: "b.ts", symbols: [], imports: [] } as unknown as StoredFile;
    expect(mapFiles([stored, bare])).toEqual([
      { path: "a.ts", symbols: stored.symbols, imports: ["b.ts"], refs: [["b", 2]] },
      { path: "b.ts", symbols: [], imports: [] },
    ]);
  });
});

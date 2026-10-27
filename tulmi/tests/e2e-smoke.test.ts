/**
 * The smoke suite: its plan, its estimate, its tiers, the --changed mapping, its picture, and the four items that are not tasks (front door batch, artifact,
 * research, vision), each run with the scripted model that answers right (oracle) and wrong (fake), through the real gateway. No key, no network.
 */
import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { validateArtifact } from "../src/artifacts/validate.js";
import { parseCatalog, type Catalog } from "../e2e/catalog.js";
import { SMOKE_STAGES } from "../e2e/smoke/types.js";
import { affectedBy, changedFiles, stagesOf, ALL_STAGES, ITEMS_OF_STAGE, type SourceHashes } from "../e2e/smoke/changed.js";
import { estimateRun, estimateSmoke, SHAPE } from "../e2e/smoke/estimate.js";
import { ARTIFACT_HTML, FRONT_BATCH, RESEARCH_PAGES } from "../e2e/smoke/fixtures.js";
import { artifactItem, frontItem, researchItem, visionItem, type SmokeCtx } from "../e2e/smoke/items.js";
import { planItems } from "../e2e/smoke/index.js";
import { encodePng, shapesPicture } from "../e2e/smoke/png.js";
import { renderHtml, renderText, stageTotals, type SmokeRun } from "../e2e/smoke/report.js";
import { smokeTierOverrides, smokeTiers, SMOKE_FALLBACK, SMOKE_PRIMARY } from "../e2e/smoke/tiers.js";
import { loadTasks } from "../e2e/tasks/schema.js";

const catalog = (): Catalog => ({
  fetchedAt: 1, source: "live",
  models: parseCatalog({ data: [
    { id: SMOKE_PRIMARY, pricing: { prompt: "0.00000003", completion: "0.00000013" }, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools"] },
    { id: SMOKE_FALLBACK, pricing: { prompt: "0.00000014", completion: "0.00000042" }, architecture: { input_modalities: ["text"] }, supported_parameters: ["tools"] },
  ] }),
});

const ctx = (mode: "oracle" | "fake"): SmokeCtx => ({ mode, maxTurns: 12, maxTokens: 800, taskBudgetPaise: 250, outDir: "/dev/shm/e2e-test-smoke", log: () => undefined });

describe("the plan", () => {
  it("is nine items, in the order of the brief, five of them tasks on the two fixture projects", () => {
    const tasks = loadTasks().filter((t) => t.tags.includes("smoke"));
    const items = planItems(tasks);
    expect(items.map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(items.map((i) => i.kind)).toEqual(["task", "task", "task", "artifact", "front", "research", "task", "task", "vision"]);
    expect(new Set(tasks.map((t) => t.repo))).toEqual(new Set(["smoke-api", "smoke-web"]));
    expect(tasks.every((t) => t.validated?.oraclePasses)).toBe(true);
    expect(tasks.every((t) => (t.budgetPaise ?? 0) <= 300)).toBe(true);
  });

  it("covers every stage of the one-page result", () => {
    expect(SMOKE_STAGES).toEqual(["front", "locate", "plan", "work", "verify", "commit", "pr", "artifact", "research", "vision", "safety"]);
    for (const s of SMOKE_STAGES) expect(ITEMS_OF_STAGE[s].length, s).toBeGreaterThan(0);
  });
});

describe("the estimate and the tiers", () => {
  it("prices the items from the catalog in rupees, and says a replay costs nothing", () => {
    const items = [{ id: "a", kind: "task" as const, ...SHAPE.task }, { id: "b", kind: "vision" as const, ...SHAPE.vision }];
    const e = estimateSmoke(items, { models: [SMOKE_PRIMARY, SMOKE_FALLBACK], catalog: catalog(), fx: 88, capInr: 25 });
    expect(e.totalInr).toBeGreaterThan(0);
    expect(e.totalInr).toBeLessThan(25);
    expect(e.models[0]!.priceSource).toBe("live");
    expect(e.models[0]!.inUsdPerM).toBeCloseTo(0.03);
    const r = estimateSmoke(items, { models: [SMOKE_PRIMARY], catalog: catalog(), fx: 88, capInr: 25, replay: true });
    expect(r.totalInr).toBe(0);
    expect(r.note).toMatch(/replay/);
    const unknown = estimateSmoke(items, { models: ["no/such"], catalog: catalog(), fx: 88, capInr: 25 });
    expect(unknown.models[0]!.priceSource).toBe("assumed");
    expect(unknown.note).toMatch(/assumed/);
  });

  it("prices a full run by category, with the strong tier as the upper bound, and says when a price is assumed", () => {
    const tasks = [{ category: "bug" }, { category: "bug" }, { category: "question" }, { category: "long" }];
    const e = estimateRun(tasks, { repeats: 2, catalog: catalog(), fx: 88, capInr: 400, codeModel: SMOKE_PRIMARY, strongModel: SMOKE_FALLBACK });
    expect(e.byCategory.find((c) => c.category === "bug")!.tasks).toBe(4);
    expect(e.totalInr).toBeGreaterThan(0);
    expect(e.highInr).toBeGreaterThanOrEqual(e.totalInr);
    expect(estimateRun(tasks, { repeats: 1, catalog: catalog(), fx: 88, capInr: 0, codeModel: "no/such", strongModel: "no/such" }).note).toMatch(/assumed/);
    expect(estimateRun([], { repeats: 1, catalog: catalog(), fx: 88, capInr: 0, codeModel: SMOKE_PRIMARY, strongModel: SMOKE_PRIMARY }).totalInr).toBe(0);
  });

  it("gives every tier the cheapest capable model and 800 tokens, and puts an image model first for vision", () => {
    const t = smokeTiers({ primary: SMOKE_FALLBACK, fallback: SMOKE_PRIMARY, maxTokens: 800 }, catalog());
    for (const tier of ["tiny", "cheap", "code", "strong", "review", "vision"] as const) {
      expect(t[tier].maxTokens, tier).toBe(800);
      expect(t[tier].reasoning).toBe("none");
      expect(new Set(t[tier].models)).toEqual(new Set([SMOKE_PRIMARY, SMOKE_FALLBACK]));
    }
    expect(t.code.models[0]).toBe(SMOKE_FALLBACK);
    expect(t.vision.models[0]).toBe(SMOKE_PRIMARY);
    expect(t.cheap.usdPerMIn).toBeCloseTo(0.14);
    expect(smokeTierOverrides({ primary: SMOKE_PRIMARY, fallback: SMOKE_FALLBACK, maxTokens: 800 }).indic).toBeUndefined();
  });
});

describe("--changed", () => {
  it("maps a changed source file to the stages it feeds, and ignores what no item exercises", () => {
    expect(stagesOf("src/front/decide.ts")).toEqual(["front"]);
    expect(stagesOf("src/front/attachments.ts")).toContain("vision");
    expect(stagesOf("src/artifacts/edit.ts")).toContain("artifact");
    expect(stagesOf("src/web/research.ts")).toContain("research");
    expect(stagesOf("src/code/work/plan.ts")).toEqual(["plan"]);
    expect(stagesOf("src/code/agent/phases.ts")).toEqual(expect.arrayContaining(["work", "verify", "commit"]));
    expect(stagesOf("src/billing/stripe.ts")).toEqual([]);
    expect(stagesOf("src/agent/run.ts")).toEqual([]);
    // The model door and the prompts feed everything: the safe side.
    expect(stagesOf("src/code/brain/gateway.ts")).toEqual(ALL_STAGES);
    expect(stagesOf("src/principles/roles.ts")).toEqual(ALL_STAGES);
  });

  it("selects the items of the affected stages only, and all of them for a change to the model door", () => {
    const a = affectedBy(["src/artifacts/edit.ts"]);
    expect(a.stages).toEqual(expect.arrayContaining(["artifact", "vision"]));
    expect(a.items).toContain("smoke-artifact-create-edit");
    expect(a.items).not.toContain("smoke-front-door-batch");
    expect(affectedBy(["src/billing/x.ts"]).items).toEqual([]);
    expect(affectedBy(["src/code/brain/gateway.ts"]).items.length).toBe(new Set(Object.values(ITEMS_OF_STAGE).flat()).size);
    expect(affectedBy(["e2e/fixtures/smoke-api/src/app.js"]).items).toContain("smoke-api-bug-pagination");
  });

  it("finds the files that differ between two saved records, added, changed or removed", () => {
    const before: SourceHashes = { at: "x", files: { "src/a.ts": "1", "src/b.ts": "2", "src/gone.ts": "3" } };
    const now: SourceHashes = { at: "y", files: { "src/a.ts": "1", "src/b.ts": "9", "src/new.ts": "4" } };
    expect(changedFiles(before, now)).toEqual(["src/b.ts", "src/gone.ts", "src/new.ts"]);
  });
});

describe("the picture and the fixtures", () => {
  it("makes a valid PNG of the right size, with the shapes where they should be", () => {
    const png = shapesPicture();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(240);
    expect(png.readUInt32BE(20)).toBe(160);
    const idat = png.indexOf("IDAT");
    const len = png.readUInt32BE(idat - 4);
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + len));
    const px = (x: number, y: number): number[] => { const o = y * (240 * 3 + 1) + 1 + x * 3; return [raw[o]!, raw[o + 1]!, raw[o + 2]!]; };
    expect(px(50, 50)).toEqual([220, 38, 38]);
    expect(px(170, 50)).toEqual([37, 99, 235]);
    expect(px(100, 108)).toEqual([22, 163, 74]);
    expect(px(5, 5)).toEqual([255, 255, 255]);
    expect(encodePng(2, 2, () => [1, 2, 3]).length).toBeGreaterThan(40);
  });

  it("has an artifact page that the product's own check accepts, a batch with a clarify case, and research pages with the fact and the trap", () => {
    expect(validateArtifact({ type: "html", content: ARTIFACT_HTML }).ok).toBe(true);
    expect(FRONT_BATCH.length).toBe(12);
    expect(FRONT_BATCH.some((c) => c.clarify)).toBe(true);
    expect(FRONT_BATCH.some((c) => /[ऀ-ॿ]/.test(c.message))).toBe(true);
    const all = Object.values(RESEARCH_PAGES).join("\n");
    expect(all).toContain("512 KiB");
    expect(all).toContain("PWNED-QUILL-1187");
  });
});

describe("the four items that are not tasks", () => {
  it("pass with a model that answers right", async () => {
    for (const f of [frontItem, artifactItem, researchItem, visionItem]) {
      const r = await f(ctx("oracle"), 1);
      expect(r.error, r.id).toBeUndefined();
      expect(r.ok, `${r.id}: ${JSON.stringify(r.stages)}`).toBe(true);
      expect(r.calls).toBeGreaterThan(0);
    }
  }, 120_000);

  it("fail, at their own stage, with a model that answers wrong", async () => {
    const front = await frontItem(ctx("fake"), 5);
    expect(front.ok).toBe(false);
    expect(front.stages.front!.ok).toBe(false);
    const art = await artifactItem(ctx("fake"), 4);
    expect(art.stages.artifact!.ok).toBe(false);
    const res = await researchItem(ctx("fake"), 6);
    expect(res.stages.research!.ok).toBe(false);
    expect(res.stages.safety!.ok).toBe(false);
    expect(res.stages.safety!.detail).toMatch(/obeyed/);
    const vis = await visionItem(ctx("fake"), 9);
    expect(vis.stages.vision!.ok).toBe(false);
  }, 120_000);
});

describe("the one-page result", () => {
  const run: SmokeRun = {
    id: "r", startedAt: "2026-10-27T00:00:00Z", finishedAt: "2026-10-27T00:01:00Z", mode: "real", cassette: { name: "smoke", mode: "record", file: "x" }, models: { primary: SMOKE_PRIMARY, fallback: SMOKE_FALLBACK, tiers: "smoke" },
    capInr: 25, spentInr: 3.21, replayedInr: 0, estimatedInr: 4, fx: 88, misses: [],
    items: [
      { id: "a", n: 1, title: "A bug", kind: "task", ok: true, stages: { front: { ok: true, detail: "" }, work: { ok: true, detail: "" }, pr: { ok: true, detail: "" } }, costPaise: 120, calls: 9, ms: 21_000, detail: "", notes: [] },
      { id: "b", n: 2, title: "Research <b>", kind: "research", ok: false, stages: { research: { ok: false, detail: "misses 512" }, safety: { ok: true, detail: "" } }, costPaise: 30, calls: 3, ms: 4_000, detail: "", notes: [] },
    ],
  };

  it("counts passes and failures per stage, and writes both a table and a page with the cost and the reasons", () => {
    const t = stageTotals(run.items);
    expect(t.front).toEqual({ pass: 1, fail: 0 });
    expect(t.research).toEqual({ pass: 0, fail: 1 });
    expect(t.vision).toEqual({ pass: 0, fail: 0 });
    const text = renderText(run);
    expect(text).toMatch(/1\/2 items pass/);
    expect(text).toMatch(/₹3\.21 of a ₹25 cap/);
    expect(text).toMatch(/FAIL/);
    expect(text).toMatch(/misses 512/);
    const html = renderHtml(run);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Research &lt;b&gt;");
    expect(html).not.toMatch(/<script/);
    expect(html).toMatch(/prefers-color-scheme/);
  });
});

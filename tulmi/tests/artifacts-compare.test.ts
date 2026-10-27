/**
 * The compare step (src/artifacts/compare.ts): the cheap gate first, then the vision tier once per viewport with both pictures, the component's
 * name and place and the kit's tokens, answering { match, issues }; implemented as `CompareHook`. The model is the rig's scripted one, the shots are
 * pictures made in memory, and nothing reaches a network.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { scripted } = await import("./artifacts-rig.js");
const { compareShots, createCompareHook, routeUrl, COMPARE_SYSTEM } = await import("../src/artifacts/compare.js");
const { encodePng, fillRect, solid } = await import("../src/artifacts/pixels.js");
const { MemoryShotStore, ShotError } = await import("../src/artifacts/shots.js");
const { ArtifactService } = await import("../src/artifacts/service.js");
const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
const { BudgetExceeded } = await import("../src/code/brain/gateway.js");

/** A screen: a header, a card with a button. */
function screen(o: { button?: [number, number, number]; w?: number; h?: number } = {}): Uint8Array {
  const w = o.w ?? 390;
  const h = o.h ?? 844;
  const r = solid(w, h, [255, 255, 255]);
  fillRect(r, 0, 0, w, 56, [24, 24, 27]);
  fillRect(r, 16, 80, w - 32, 180, [244, 244, 245]);
  fillRect(r, 32, 100, 160, 18, [30, 30, 30]);
  fillRect(r, 32, 230, 120, 36, o.button ?? [37, 99, 235]);
  return encodePng(r);
}

const CTX = { userId: "alice", component: "Pricing card", location: "src/components/Pricing.tsx (the pricing section) on /pricing", kit: "colors: primary #7c3aed\nradius 12px", viewport: "mobile" as const };

const ISSUES = {
  match: 0.4,
  issues: [
    { area: "the button", issue: "It is blue; the design's is violet.", severity: "minor", fixHint: "Use the primary colour (#7c3aed)." },
    { area: "the card", issue: "The card has no padding, so the text touches its edge.", severity: "major", fixHint: "Give the card p-4." },
  ],
};

describe("compareShots", () => {
  it("does not ask a model about two copies of one picture", async () => {
    const model = scripted(() => ({ json: ISSUES }));
    const v = await compareShots(screen(), screen(), { ...CTX, call: model.call });
    expect(model.sent).toHaveLength(0);
    expect(v).toMatchObject({ gate: "same", issues: [], paise: 0 });
    expect(v.match).toBeGreaterThanOrEqual(0.95);
    expect(v.match).toBeLessThanOrEqual(1);
  });

  it("asks the vision tier once when they differ, with both pictures in order, the component, where it lives, the kit and the viewport", async () => {
    const model = scripted(() => ({ json: ISSUES }), { paise: 9 });
    const approved = screen();
    const built = screen({ button: [220, 38, 38] });
    const v = await compareShots(approved, built, { ...CTX, jobId: "job-7", call: model.call });
    expect(model.sent).toHaveLength(1);
    const s = model.sent[0]!;
    expect(s).toMatchObject({ purpose: "artifact.compare", tier: "vision", userId: "alice" });
    expect(s.maxTokens).toBeLessThanOrEqual(1200);
    expect(s.system).toBe(COMPARE_SYSTEM);
    expect(s.user).toContain("Component: Pricing card");
    expect(s.user).toContain("src/components/Pricing.tsx (the pricing section) on /pricing");
    expect(s.user).toContain("colors: primary #7c3aed");
    expect(s.user).toContain("Viewport: mobile (390 x 844)");
    expect(s.user).toContain("Image 1 is the design. Image 2 is the real app.");
    const parts = s.messages.find((m) => m.role === "user")!.content as Array<{ type: string; image_url?: { url: string } }>;
    const images = parts.filter((p) => p.type === "image_url").map((p) => p.image_url!.url);
    expect(images).toEqual([`data:image/png;base64,${Buffer.from(approved).toString("base64")}`, `data:image/png;base64,${Buffer.from(built).toString("base64")}`]);
    // Metered in the job's budget, not a budget of its own.
    expect(s.capPaise).toBeNull();
    expect(v.paise).toBe(9);
    expect(v.gate).toBe("model");
  });

  it("returns the issues worst first, each tagged with its viewport, and a match that agrees with them", async () => {
    const model = scripted(() => ({ json: { ...ISSUES, match: 0.99 } }));
    const v = await compareShots(screen(), screen({ button: [220, 38, 38] }), { ...CTX, call: model.call });
    expect(v.issues.map((i) => i.severity)).toEqual(["major", "minor"]);
    expect(v.issues[0]).toEqual({ area: "the card", issue: "The card has no padding, so the text touches its edge.", severity: "major", fixHint: "Give the card p-4.", viewport: "mobile" });
    // "Perfect" with a major issue listed is not believed.
    expect(v.match).toBeLessThanOrEqual(0.9);
    // Without a job it holds the call to a cap of its own.
    expect(model.sent[0]!.capPaise).toBe(120);
    const none = scripted(() => ({ json: { match: 0.2, issues: [] } }));
    expect((await compareShots(screen(), screen({ button: [220, 38, 38] }), { ...CTX, call: none.call })).match).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps at most ten issues, one line each, and withholds what looks like a secret", async () => {
    const key = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    const many = { match: 0.3, issues: Array.from({ length: 14 }, (_, i) => ({ area: `area ${i}`, issue: `line one\nline two ${i}`, severity: "minor", fixHint: i === 0 ? `use ${key}` : "x" })) };
    const model = scripted(() => ({ json: many }));
    const v = await compareShots(screen(), screen({ button: [220, 38, 38] }), { ...CTX, call: model.call });
    expect(v.issues).toHaveLength(10);
    expect(v.issues[0]!.issue).toBe("line one line two 0");
    expect(JSON.stringify(v.issues)).not.toContain(key);
    expect(v.issues[0]!.fixHint).toMatch(/withheld/);
  });

  it("says a shot cannot be read, rather than comparing it", async () => {
    await expect(compareShots(new TextEncoder().encode("<html>error page</html>"), screen(), { ...CTX, call: scripted(() => "").call })).rejects.toThrow(/not a PNG/);
  });
});

describe("the hook", () => {
  const USER = "alice";

  async function setup(o: { shoot?: Partial<Parameters<typeof createCompareHook>[0]["shooter"] & object>; answer?: () => unknown } = {}) {
    const store = new MemoryArtifactStore();
    const service = new ArtifactService({ store });
    const made = await service.create(USER, { type: "react", title: "Pricing card", content: "export default function App() { return <h1>v1</h1>; }" });
    await service.rewrite(USER, made.artifact.id, "export default function App() { return <h1>v2</h1>; }");
    const model = scripted(() => (o.answer ? (o.answer() as never) : { json: ISSUES }), { paise: 7 });
    const shots = new MemoryShotStore();
    const seen = { urls: [] as Array<{ url: string; viewport: unknown }>, art: [] as Array<{ content: string; version: number; viewport: unknown }> };
    const hook = createCompareHook({
      shoot: { accountId: "a", apiToken: "t", viewerUrl: "https://shots.example" }, shots, artifacts: service, call: model.call,
      shooter: {
        url: o.shoot?.url ?? (async (url, opts) => { seen.urls.push({ url, viewport: opts.viewport }); return screen({ button: [220, 38, 38], ...(opts.viewport === "desktop" ? { w: 1280, h: 800 } : {}) }); }),
        artifact: o.shoot?.artifact ?? (async (a, version, _kit, viewport) => { seen.art.push({ content: a.content, version, viewport }); return screen(viewport === "desktop" ? { w: 1280, h: 800 } : {}); }),
      },
    });
    const input = {
      job: { jobId: "job-1", userId: USER, projectId: "p1", branch: "tailzu/build" },
      spec: { artifactId: made.artifact.id, version: 1, type: "react", title: "Pricing card" },
      builtUrl: "https://tok.preview.example/", route: "/pricing", location: "src/Pricing.tsx", kit: "colors: primary #7c3aed", viewports: ["mobile" as const, "desktop" as const],
    };
    return { hook, input, model, shots, seen, service, made };
  }

  it("shoots the built page at the route and the approved version (not the head) for each viewport, compares, and keeps both shots", async () => {
    const t = await setup();
    t.hook.register(t.input.job, t.input.spec);
    expect(t.hook.registered("job-1")).toMatchObject({ version: 1, title: "Pricing card" });
    const r = await t.hook.compare(t.input);
    expect(r.skipped).toBeUndefined();
    expect(t.seen.urls).toEqual([{ url: "https://tok.preview.example/pricing", viewport: "mobile" }, { url: "https://tok.preview.example/pricing", viewport: "desktop" }]);
    // The approved design is version 1 though the head is 2.
    expect(t.seen.art.map((a) => [a.version, a.viewport])).toEqual([[1, "mobile"], [1, "desktop"]]);
    expect(t.seen.art[0]!.content).toContain("v1");
    expect(r.viewports).toHaveLength(2);
    expect(r.viewports![0]).toMatchObject({ viewport: "mobile", gate: "model", paise: 7 });
    expect(r.viewports![0]!.shots).toEqual({ built: expect.stringMatching(/^[0-9a-f]{32}$/), approved: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(t.shots.size).toBe(4);
    expect((await t.shots.get(USER, t.made.artifact.id, r.viewports![0]!.shots!.built))!.meta).toMatchObject({ kind: "built", viewport: "mobile", jobId: "job-1", version: 1 });
    expect(r.similarity).toBeLessThan(0.9);
    expect(r.notes.some((n) => /^mobile: major: the card/.test(n))).toBe(true);
    expect(t.model.sent).toHaveLength(2); // once per viewport
  });

  it("is mobile only when only mobile is asked for, and all viewports when none is named", async () => {
    const a = await setup();
    await a.hook.compare({ ...a.input, viewports: ["mobile"] });
    expect(a.seen.urls.map((u) => u.viewport)).toEqual(["mobile"]);
    const b = await setup();
    const { viewports: _drop, ...rest } = b.input;
    void _drop;
    await b.hook.compare(rest);
    expect(b.seen.urls.map((u) => u.viewport)).toEqual(["mobile", "desktop"]);
  });

  it("does not call the model for shots that are the same", async () => {
    const t = await setup({ shoot: { url: async () => screen(), artifact: async () => screen() } });
    const r = await t.hook.compare({ ...t.input, viewports: ["mobile"] });
    expect(t.model.sent).toHaveLength(0);
    expect(r.viewports![0]).toMatchObject({ gate: "same", paise: 0, issues: [] });
    expect(r.similarity).toBeGreaterThanOrEqual(0.95);
  });

  it("goes on with the other viewport when one shot fails, and is skipped, with the reasons, when all do", async () => {
    let n = 0;
    const t = await setup({ shoot: { url: async (_u, opts) => { n += 1; if (opts.viewport === "mobile") throw new ShotError("timeout", "The page took too long."); return screen({ button: [220, 38, 38], w: 1280, h: 800 }); } } });
    const r = await t.hook.compare(t.input);
    expect(r.skipped).toBeUndefined();
    expect(r.viewports!.map((v) => v.gate)).toEqual(["failed", "model"]);
    expect(r.viewports![0]!.error).toBe("The page took too long.");
    expect(r.notes[0]).toBe("mobile: The page took too long.");
    expect(r.similarity).toBe(r.viewports![1]!.match);
    const all = await setup({ shoot: { url: async () => { throw new ShotError("busy", "Cloudflare's browsers are busy."); } } });
    const none = await all.hook.compare(all.input);
    expect(none).toMatchObject({ skipped: true });
    expect(none.notes).toEqual(["Cloudflare's browsers are busy.", "Cloudflare's browsers are busy."]);
    expect(n).toBeGreaterThan(0);
  });

  it("is skipped with a reason, and does nothing, with no built page, no browser or viewer, or no such design", async () => {
    const t = await setup();
    const { builtUrl: _b, ...noUrl } = t.input;
    void _b;
    expect(await t.hook.compare(noUrl)).toMatchObject({ skipped: true, notes: ["There is no built page to look at."] });
    const bare = createCompareHook({ shoot: {}, shots: t.shots, artifacts: t.service, call: t.model.call });
    expect((await bare.compare(t.input)).notes[0]).toMatch(/No browser/);
    const noViewer = createCompareHook({ shoot: { accountId: "a", apiToken: "t" }, shots: t.shots, artifacts: t.service, call: t.model.call });
    expect((await noViewer.compare(t.input)).notes[0]).toMatch(/No viewer/);
    const gone = await t.hook.compare({ ...t.input, spec: { ...t.input.spec, artifactId: "00000000-0000-4000-8000-000000000000" } });
    expect(gone).toMatchObject({ skipped: true });
    expect(gone.notes[0]).toMatch(/could not be read/);
    expect(t.seen.urls).toEqual([]);
    expect(t.model.sent).toHaveLength(0);
  });

  it("lets the job's budget speak: a call the job cannot afford is thrown to the caller, not hidden as a viewport's failure", async () => {
    const t = await setup({ answer: () => new BudgetExceeded({ needPaise: 90, spentPaise: 2990, budgetPaise: 3000, scope: "job", purpose: "artifact.compare" }) });
    await expect(t.hook.compare(t.input)).rejects.toMatchObject({ code: "budget_exceeded" });
  });

  it("reports a model that said nothing usable as that viewport's failure, with the shots still kept", async () => {
    const t = await setup({ answer: () => ({ text: "not json at all" }) });
    const r = await t.hook.compare({ ...t.input, viewports: ["mobile"] });
    expect(r.skipped).toBe(true);
    expect(r.viewports![0]).toMatchObject({ gate: "failed", error: "The comparison could not be made." });
    expect(r.viewports![0]!.shots).toBeDefined();
  });
});

describe("routeUrl", () => {
  it("joins a route to the preview's address, in wildcard mode and in cookie mode (where the address has a path)", () => {
    expect(routeUrl("https://tok.preview.example/", "/pricing")).toBe("https://tok.preview.example/pricing");
    expect(routeUrl("https://tok.preview.example/", "/")).toBe("https://tok.preview.example/");
    expect(routeUrl("https://tok.preview.example/", undefined)).toBe("https://tok.preview.example/");
    expect(routeUrl("https://tok.preview.example/", "pricing?plan=pro")).toBe("https://tok.preview.example/pricing?plan=pro");
    expect(routeUrl("https://host.example/p/abc/", "/a/b")).toBe("https://host.example/p/abc/a/b");
  });
});

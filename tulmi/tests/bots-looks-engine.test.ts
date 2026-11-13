/**
 * EVERY CATALOG, CHECKED WITH THE REAL ENGINES (experience/bots/looksEngine.ts; anim/SPEC.md 5.3).
 *
 * shared/bots/engines/ holds the engines themselves: f2.cjs, generated from the phone's scene.ts and core.ts, and
 * the frozen format-1 engine the released window really runs. The live catalog must compile in every one of them,
 * and every format-2 moment must run for its whole length, on three node sizes and both facings, inside its
 * budgets. These are the checks `PUT /v1/admin/bots/looks` runs, so what passes here is what can be pushed.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { checkWithEngines, enginesHere, loadEngines, perBuild, resetEnginesForTests } from "../src/experience/bots/looksEngine.js";
import { passthroughProjector, projectLooks } from "../src/experience/bots/project.js";
import { pushLooks } from "../src/experience/bots/looks.js";

const FILE = new URL("../../shared/bots/looks.json", import.meta.url);
const catalog = () => JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;

beforeEach(() => resetEnginesForTests());

describe("the engines beside this build", () => {
  it("there are at least two: the format-2 engine of this round, and a frozen format-1 one from a release", () => {
    const here = enginesHere();
    expect(here.length, "run `node src/botTiles/genDesktop.mjs --server` in TAILZU-FRONTEND/app").toBeGreaterThanOrEqual(2);
    expect(here.some((e) => e.format >= 2)).toBe(true);
    expect(here.some((e) => e.format === 1)).toBe(true);
    for (const e of here) expect(e.name).toMatch(/\.cjs$/);
  });

  it("the live catalog compiles with zero errors in every engine, and its format-2 moments run inside their budgets", () => {
    const r = checkWithEngines(catalog());
    expect(r.errors).toEqual([]);
  });

  it("the pond is really a format-2 moment: today's engine cannot play it, and plays its fallback act instead", () => {
    const c = catalog();
    const pond = (c.moments as Record<string, { format?: number; fallback?: string }>)["p.pond"];
    expect(pond, "looks.json carries the proof moment").toBeTruthy();
    expect(pond.format).toBe(2);
    expect(pond.fallback).toBe("survey");
    const table = perBuild(c, "p.pond");
    expect(table.length).toBeGreaterThanOrEqual(2);
    for (const row of table) {
      if (row.format >= 2) expect(row.plays, `${row.name ?? row.engine} plays it`).toBe(true);
      else expect(row, `${row.engine} falls back`).toMatchObject({ plays: false, act: "survey" });
    }
  });

  it("a format-2 recipe with no fallback is refused, and so is an idle surprise with no still", () => {
    const c = catalog();
    const moments = c.moments as Record<string, unknown>;
    const noFallback = { ...c, moments: { ...moments, "p.nofall": { format: 2, dur: 1, tracks: [] } } };
    expect(checkWithEngines(noFallback).errors.join(" ")).toMatch(/p\.nofall.*fallback/);
    const idle = c.idle as { moments: string[] };
    const noStill = {
      ...c,
      moments: { ...moments, "p.idle": { format: 2, dur: 1, fallback: "wave", tracks: [] } },
      idle: { ...idle, moments: [...idle.moments, "p.idle"] },
    };
    expect(checkWithEngines(noStill).errors.join(" ")).toMatch(/p\.idle.*still/);
  });

  it("a scene over its op budget is refused, and so is one that would go non-finite", () => {
    const c = catalog();
    const scenes = c.scenes as Record<string, unknown>;
    const heavy = {
      ...c,
      scenes: {
        ...scenes,
        fat: {
          format: 2, box: [1, 1], still: 0,
          els: [{ kind: "dots", cols: 20, rows: 20, gap: 0.02, rmax: 0.04, r: `${"sin(t*qx) + cos(t*qy) + ".repeat(80)}0` }],
        },
      },
    };
    expect(checkWithEngines(heavy).errors.join(" ")).toMatch(/fat.*ops a frame/);
    // A path number outside its range is refused by every engine that reads the section.
    const broken = { ...c, scenes: { ...scenes, bent: { format: 2, box: [1, 1], els: [{ kind: "shape", d: "M 0 0 L 99 99", fill: "ink" }] } } };
    expect(checkWithEngines(broken).errors.join(" ")).toMatch(/bent/);
  });

  it("a second fish, as a repeat: a chain inside one is simulated, not refused, and four of them are over budget", () => {
    // anim/SPEC.md 6.3 "Shipping it", step 3: a pushed edit to the pond arrives with no build. The fish is a group
    // whose tail is a chain, so this is the case H15-Q4 decided to allow with the budgets as the only gate.
    const c = catalog();
    const scenes = c.scenes as Record<string, { els: Array<Record<string, unknown>> }>;
    const pond = scenes.pond;
    const fish = pond.els.find((e) => e.id === "fish");
    expect(fish, "the pond has its fish").toBeTruthy();
    const school = (n: number) => ({
      ...c,
      scenes: {
        ...scenes,
        pond: {
          ...pond,
          els: [
            ...pond.els.filter((e) => e.id !== "fish"),
            // Each copy swims half a bot height along from the one before, with its own body and its own tail.
            { kind: "repeat", n, el: { kind: "group", x: `j*0.5 - ${(n - 1) * 0.25}`, els: [fish] } },
          ],
        },
      },
    });
    expect(checkWithEngines(school(2)).errors).toEqual([]);
    expect(checkWithEngines(school(4)).errors.join(" ")).toMatch(/chains counting repeats/);
  });

  it("both facings are really tried: the simulated tile turns, and a step does not put it back", () => {
    // `t.faceSign = -1` was undone by the first step (the core works the sign out from `face` again), so the
    // mirrored fit and placement were never simulated. turn() sets the whole facing.
    const e = loadEngines().find((x) => x.format >= 2)!;
    const L = e.compileLooks(projectLooks(catalog(), 2));
    const m = L.moments.get("p.pond")!;
    const t = new e.BotTile({ kind: "custom", color: "#4F7A3A", mood: "idle", seed: 4 }) as unknown as {
      resize(w: number, h: number, f: number): void; turn(d: number): void; playMoment(m: unknown, k: string): boolean;
      step(dt: number): void; faceSign: number; clock: (() => number) | null;
    };
    t.resize(340, 200, 150);
    t.clock = () => 0;
    t.turn(-1);
    t.playMoment(m, "once");
    const seen = new Set<number>();
    for (let f = 0; f < 120; f++) { t.step(1 / 60); seen.add(t.faceSign); }
    expect([...seen], "he faced left for the whole play").toEqual([-1]);
  });

  it("the governor is not left on the wall clock: a busy machine cannot refuse a catalog that fits", () => {
    // A ':slow' from the simulation used to be an ERROR, measured with performance.now(): a GC pause on the server
    // could refuse a good push. The simulated tile now runs on a still clock, so only the compiled costs decide.
    const r = checkWithEngines(catalog());
    expect(r.errors.join(" ")).not.toMatch(/slow/);
    expect(r.warnings.join(" ")).not.toMatch(/governor/);
  });

  it("the sizes SCENE_LIMITS sets are enforced: a scene over 24 KB of JSON is refused", () => {
    const c = catalog();
    const scenes = c.scenes as Record<string, unknown>;
    const fat = {
      ...c,
      scenes: {
        ...scenes,
        wordy: {
          format: 2, box: [1, 1], still: 0,
          els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", note: "x".repeat(30000) }],
        },
      },
    };
    expect(checkWithEngines(fat).errors.join(" ")).toMatch(/wordy: \d+ bytes of JSON/);
  });

  it("with no engine of the catalog's format beside this build, a push is refused, not waved through", () => {
    // checkWithEngines can only warn when shared/bots/engines is missing, so pushLooks has to say no itself:
    // scenes nothing has compiled must never be served.
    const dir = mkdtempSync(join(tmpdir(), "tulmi-engines-"));
    mkdirSync(join(dir, "bots", "engines"), { recursive: true });
    const was = process.env.TULMI_SHARED_DIR;
    process.env.TULMI_SHARED_DIR = dir;
    try {
      resetEnginesForTests();
      expect(enginesHere()).toEqual([]);
      const c = catalog();
      const r = pushLooks({ ...c, v: Number(c.v) + 1 }, { dry: true });
      expect(r).toMatchObject({ ok: false, status: 503 });
      expect((r as { errors: string[] }).errors.join(" ")).toMatch(/format-2 engine/);
    } finally {
      if (was === undefined) delete process.env.TULMI_SHARED_DIR; else process.env.TULMI_SHARED_DIR = was;
      rmSync(dir, { recursive: true, force: true });
      resetEnginesForTests();
    }
  });

  it("the stand-in projection is not a pass-through: with no shared file, f=1 still loses the scenes", () => {
    const cut = passthroughProjector.projectLooks(catalog(), 1) as {
      scenes?: unknown; format?: number; moments: Record<string, { format?: number }>; idle?: { moments?: string[] };
    };
    expect(cut.scenes).toBeUndefined();
    expect(cut.format).toBe(1);
    expect(Object.values(cut.moments).every((m) => (m.format ?? 1) === 1)).toBe(true);
    for (const id of cut.idle?.moments ?? []) expect(Object.keys(cut.moments)).toContain(id);
  });

  it("the f=1 projection a frozen engine is served carries no scenes and no format-2 recipe", () => {
    const cut = projectLooks(catalog(), 1) as { scenes?: unknown; moments: Record<string, { format?: number }> };
    expect(cut.scenes).toBeUndefined();
    expect(Object.values(cut.moments).every((m) => (m.format ?? 1) === 1)).toBe(true);
  });
});

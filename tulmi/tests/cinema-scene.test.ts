/**
 * THE DOOR A SCENE COMES IN BY (src/cinema/check.ts, docs/cinema.md):
 *
 *   - nothing a model answers can throw: rubbish in, a scene that renders out, with a note for every change
 *   - the caps are clamps, never refusals: too many objects is the first eighty, not an error
 *   - an object may only wear a material that exists, and may not share another's name
 *   - a camera standing inside what it looks at is moved back; a scene with nothing in it says so
 */
import { describe, expect, it } from "vitest";

const { checkScene, frameCount, sceneSize } = await import("../src/cinema/check.js");
const { CAPS } = await import("../src/cinema/types.js");

describe("whatever came back", () => {
  it("never throws, whatever it is", () => {
    for (const raw of [null, undefined, 0, "a scene", [], { objects: "many" }, { objects: [null, 7, {}] }, { look: [] }]) {
      const { scene } = checkScene(raw);
      expect(Array.isArray(scene.objects)).toBe(true);
      expect(scene.look.width).toBeGreaterThan(0);
      expect(scene.camera.lens).toBeGreaterThan(0);
    }
  });

  it("says what it had to change, in words a model can act on", () => {
    const { notes } = checkScene({ objects: [{ shape: "dodecahedron" }], lights: [{ kind: "laser", power: 5 }] });
    expect(notes.join(" ")).toMatch(/dodecahedron/);
    expect(notes.join(" ")).toMatch(/laser/);
  });

  it("keeps an empty scene, and says it is empty", () => {
    const { scene, notes } = checkScene({ look: { sky: "none" } });
    expect(scene.objects).toEqual([]);
    expect(notes.join(" ")).toMatch(/nothing in it/);
    expect(notes.join(" ")).toMatch(/nothing lights it|nothing lights the scene/);
  });
});

describe("the caps are clamps", () => {
  it("takes the first of too many objects, and says how many it took", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `box-${i}`, shape: "cube", at: [i, 0, 0], size: 1 }));
    const { scene, notes } = checkScene({ objects: many });
    expect(scene.objects.length).toBe(CAPS.objects);
    expect(notes.join(" ")).toMatch(new RegExp(`${CAPS.objects} objects`));
  });

  it("counts parts against the same eighty, and stops parts inside parts going deep", () => {
    const nest = (depth: number): unknown => (depth === 0 ? { shape: "cube", size: 1 } : { shape: "cube", size: 1, parts: [nest(depth - 1)] });
    const { scene, notes } = checkScene({ objects: [nest(9)] });
    expect(sceneSize(scene)).toBeLessThanOrEqual(CAPS.depth + 1);
    expect(notes.join(" ")).toMatch(/deep/);
  });

  it("holds samples, size, film and copies to what a render can finish", () => {
    const { scene, notes } = checkScene({
      look: { samples: 90_000, width: 8000, height: 8000 },
      move: { kind: "turntable", seconds: 600, fps: 120 },
      objects: [{ shape: "cube", size: 1, mods: [{ kind: "array", count: 5000 }, { kind: "subdivide", levels: 9 }] }],
    });
    expect(scene.look.samples).toBe(CAPS.samples);
    expect(scene.look.width).toBe(CAPS.size);
    expect(scene.move!.seconds).toBe(CAPS.seconds);
    expect(scene.move!.fps).toBe(CAPS.fps);
    expect(scene.objects[0]!.mods![0]!.count).toBe(CAPS.arrayCount);
    expect(scene.objects[0]!.mods![1]!.levels).toBe(CAPS.subdivide);
    expect(frameCount(scene)).toBe(CAPS.seconds * CAPS.fps);
    expect(notes.length).toBeGreaterThan(3);
  });

  it("gives a size that is never nothing, and a turn that is always a turn", () => {
    const { scene } = checkScene({ objects: [{ shape: "sphere", size: 0, turn: [720, -450, 90] }] });
    expect(typeof scene.objects[0]!.size === "number" && scene.objects[0]!.size > 0).toBe(true);
    expect(scene.objects[0]!.turn).toEqual([0, 270, 90]);
  });
});

describe("names and materials", () => {
  it("gives everything its own name, because the next round points by name", () => {
    const { scene, notes } = checkScene({ objects: [{ id: "lamp", shape: "cube", size: 1 }, { id: "lamp", shape: "cube", size: 1 }, { shape: "cone", size: 1 }] });
    const ids = scene.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(notes.join(" ")).toMatch(/two objects called lamp/);
  });

  it("will not write a name it cannot hold to its charset", () => {
    const { scene } = checkScene({ objects: [{ id: "../../etc/passwd; rm -rf", shape: "cube", size: 1 }] });
    expect(scene.objects[0]!.id).toMatch(/^[a-z0-9-]+$/);
  });

  it("only lets an object wear a material that exists", () => {
    const { scene, notes } = checkScene({
      materials: { brass: { colour: "#b58b3a", metallic: 1, roughness: 0.3 } },
      objects: [{ shape: "cube", size: 1, material: "brass" }, { shape: "cube", at: [2, 0, 0], size: 1, material: "velvet" }],
    });
    expect(scene.objects[0]!.material).toBe("brass");
    expect(scene.objects[1]!.material).toBeUndefined();
    expect(notes.join(" ")).toMatch(/no material called velvet/);
  });

  it("takes a colour as it is written, or puts a sane one in its place", () => {
    const { scene } = checkScene({ materials: { a: { colour: "#FFF" }, b: { colour: "rgb(1,2,3)" }, c: { colour: "#00ff88" } } });
    expect(scene.materials.a!.colour).toBe("#ffffff");
    expect(scene.materials.b!.colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(scene.materials.c!.colour).toBe("#00ff88");
  });
});

describe("the camera and the text", () => {
  it("moves a camera that is standing inside what it is looking at", () => {
    const { scene, notes } = checkScene({ camera: { at: [1, 1, 1], to: [1, 1, 1], lens: 50 } });
    expect(scene.camera.at).not.toEqual(scene.camera.to);
    expect(notes.join(" ")).toMatch(/camera/);
  });

  it("drops text with nothing to say, and cuts text that goes on", () => {
    const { scene } = checkScene({ objects: [{ shape: "text", text: "   ", size: 1 }, { shape: "text", text: "x".repeat(500), size: 1 }] });
    expect(scene.objects.length).toBe(1);
    expect(scene.objects[0]!.text!.length).toBe(CAPS.text);
  });

  it("an asset is a name, never a path", () => {
    const { scene } = checkScene({ objects: [{ shape: "asset", asset: "/etc/shadow", size: 1 }, { shape: "asset", asset: "speaker", size: 1 }] });
    expect(scene.objects.map((o) => o.asset)).toEqual(["etc-shadow", "speaker"]);
  });
});

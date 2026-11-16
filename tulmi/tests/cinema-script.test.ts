/**
 * A SCENE AS THE SCRIPT THAT BUILDS IT (src/cinema/script.ts, docs/cinema.md):
 *
 *   - the same scene is the same text, byte for byte, so a render can be cached and a change reads as a diff
 *   - nothing from the scene becomes a path, a flag or a line of its own: text is escaped, assets are looked up by name
 *   - a preview is small and cheap whatever the scene asked for; the real one is what the scene asked for
 *   - a still comes back as one picture, a move as ONE clip, never a thousand frames to clean up
 *   - it is valid Python, by Python's own reading of it
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { checkScene } = await import("../src/cinema/check.js");
const { scriptFor } = await import("../src/cinema/script.js");

const SCENE = checkScene({
  look: { engine: "cycles", samples: 128, width: 1280, height: 960, sky: "studio" },
  camera: { at: [4, -4, 2], to: [0, 0, 0.5], lens: 85, blur: { fStop: 2.8 } },
  lights: [{ kind: "key", power: 300 }, { kind: "fill", power: 80 }, { kind: "rim", power: 150 }],
  materials: { shell: { colour: "#1b1b1b", metallic: 0.1, roughness: 0.4 }, brass: { colour: "#b58b3a", metallic: 1, roughness: 0.25 } },
  objects: [
    { id: "floor", shape: "plane", at: [0, 0, 0], size: 12, shadowOnly: true },
    {
      id: "speaker", shape: "cube", at: [0, 0, 0.6], size: [0.4, 0.3, 0.6], material: "shell",
      mods: [{ kind: "bevel", width: 0.01, segments: 3 }, { kind: "smooth" }],
      parts: [{ id: "cone", shape: "cylinder", at: [0, -0.3, 0.7], turn: [90, 0, 0], size: [0.18, 0.18, 0.03], material: "brass" }],
    },
  ],
  seed: 7,
}).scene;

describe("the same scene, the same script", () => {
  it("writes the same text twice", () => {
    expect(scriptFor(SCENE)).toBe(scriptFor(SCENE));
  });

  it("is Python, as Python reads it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cinema-py-"));
    const file = path.join(dir, "scene.py");
    writeFileSync(file, scriptFor(SCENE), "utf8");
    // Compiled, not run: there is no Blender here, and bpy would be the first import to fail.
    expect(() => execFileSync("python3", ["-m", "py_compile", file], { stdio: "pipe" })).not.toThrow();
  });

  it("builds everything the scene holds, by the names it gave them", () => {
    const s = scriptFor(SCENE);
    expect(s).toContain('"floor"');
    expect(s).toContain('"speaker"');
    expect(s).toContain('"cone"');
    expect(s).toContain("primitive_cube_add");
    expect(s).toContain("primitive_plane_add");
    expect(s).toContain("primitive_cylinder_add");
    expect(s).toContain("BEVEL");
    expect(s).toContain("is_shadow_catcher");
    // the part hangs from the whole
    expect(s).toMatch(/o\d+\.parent = o\d+/);
  });

  it("turns a colour into light, not into the six digits it was written as", () => {
    const s = scriptFor(SCENE);
    expect(s).not.toContain("#b58b3a");
    expect(s).toMatch(/M\["brass"\] = mat\("brass", \(0\.4\d+, 0\.2\d+, 0\.0\d+, 1\.0\)/); // brass, in light rather than in hex
  });
});

describe("nothing from the scene escapes into the script", () => {
  it("escapes text, however it was written", () => {
    const nasty = checkScene({ objects: [{ shape: "text", text: 'he said "stop"\\ and left', size: 1 }] }).scene;
    const s = scriptFor(nasty);
    expect(s).toContain('\\"stop\\"');
    expect(s.split("\n").filter((l) => l.includes("stop")).length).toBe(1);
  });

  it("never writes a path: an asset is a name the runner looks up", () => {
    const withAsset = checkScene({ objects: [{ shape: "asset", asset: "speaker", size: 1 }] }).scene;
    const s = scriptFor(withAsset);
    expect(s).toContain('ASSETS.get("speaker")');
    expect(s).toContain('os.environ.get("CINEMA_ASSETS"');
    expect(s).not.toMatch(/\/home\/|\/etc\/|C:\\\\/);
  });

  it("takes where it writes from the runner, never from the scene", () => {
    expect(scriptFor(SCENE)).toContain('os.environ.get("CINEMA_OUT"');
  });
});

describe("a preview, and the real thing", () => {
  it("makes a preview small and cheap whatever the scene asked for", () => {
    const p = scriptFor(SCENE, { preview: true });
    expect(p).toContain("S.render.resolution_x = 480");
    expect(p).toContain("S.cycles.samples = 24");
    expect(p).toContain("write_still=True");
  });

  it("gives the real one what the scene asked for", () => {
    const s = scriptFor(SCENE);
    expect(s).toContain("S.render.resolution_x = 1280");
    expect(s).toContain("S.cycles.samples = 128");
    expect(s).toContain("S.cycles.seed = 7");
  });

  it("a move comes back as one clip, not as frames", () => {
    const moving = checkScene({ ...SCENE, move: { kind: "turntable", seconds: 4, fps: 24 } }).scene;
    const s = scriptFor(moving);
    expect(s).toContain("FFMPEG");
    expect(s).toContain("H264");
    expect(s).toContain("animation=True");
    expect(s).toContain("S.frame_end = 96");
    expect(s).toContain("turntable");
    // and its preview is still one cheap picture, from a third of the way in
    const p = scriptFor(moving, { preview: true, frame: 32 });
    expect(p).toContain("write_still=True");
    expect(p).toContain("S.frame_set(32)");
    expect(p).not.toContain("FFMPEG");
  });

  it("saves the file a person can take elsewhere", () => {
    expect(scriptFor(SCENE)).toContain("save_as_mainfile");
  });
});

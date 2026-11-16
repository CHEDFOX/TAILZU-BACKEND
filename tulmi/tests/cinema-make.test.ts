/**
 * THE LOOP (src/cinema/make.ts, docs/cinema.md): build, look, fix, and only then render the real thing.
 *
 *   - the eye is what ends it: happy, and it goes straight to the full render
 *   - unhappy, and the NEXT build is told what was wrong, in the eye's own words
 *   - a script that will not run is handed back to the model as the thing to fix
 *   - the money runs out, and everything made up to then is still kept
 *   - what is kept is kept under this person's own keys: the script, the preview, the final
 *   - no bucket at all, and the loop still runs
 */
import { describe, expect, it } from "vitest";

const { make, sceneUser } = await import("../src/cinema/make.js");
const { MemoryBlobStore } = await import("../src/media/blob.js");
const { checkScene } = await import("../src/cinema/check.js");
import type { Render, RenderJob } from "../src/cinema/ports.js";

const ME = "00000000-0000-4000-8000-00000000aaaa";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** A scene a model might answer with: a thing on a floor, lit, with a camera on it. */
const SCENE = (colour = "#1b1b1b"): Record<string, unknown> => ({
  look: { engine: "cycles", samples: 64, width: 1280, height: 960, sky: "studio" },
  camera: { at: [3, -3, 1.6], to: [0, 0, 0.4], lens: 85 },
  lights: [{ kind: "key", power: 300 }, { kind: "fill", power: 90 }],
  materials: { shell: { colour, metallic: 0.2, roughness: 0.4 } },
  objects: [
    { id: "floor", shape: "plane", at: [0, 0, 0], size: 10, shadowOnly: true },
    { id: "box", shape: "cube", at: [0, 0, 0.4], size: 0.4, material: "shell" },
  ],
});

/** A model that answers scenes and verdicts, and remembers every prompt it was given. */
function brain(o: { verdicts: Array<{ ok: boolean; issues?: string[]; fix?: string }>; scenes?: Array<Record<string, unknown>> }) {
  const prompts: Array<{ purpose: string; user: string; pictures: number }> = [];
  let scene = 0;
  let look = 0;
  const call = async (input: unknown): Promise<unknown> => {
    const i = input as { purpose: string; messages: Array<{ role: string; content: unknown }> };
    const last = i.messages[i.messages.length - 1]!;
    const parts = Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content) }];
    const text = parts.filter((p) => (p as { type: string }).type === "text").map((p) => (p as { text: string }).text).join("\n");
    prompts.push({ purpose: i.purpose, user: text, pictures: parts.filter((p) => (p as { type: string }).type === "image_url").length });
    if (i.purpose === "cinema.eye") {
      const v = o.verdicts[Math.min(look++, o.verdicts.length - 1)]!;
      return { json: v, paise: 5, model: "fake-eye" };
    }
    const s = (o.scenes ?? [])[Math.min(scene, (o.scenes ?? []).length - 1)] ?? SCENE();
    scene++;
    return { json: s, paise: 20, model: "fake-scene" };
  };
  return { call: call as never, prompts };
}

/** A renderer that always works, and remembers what it was asked to run. */
function goodRender(): { render: Render; jobs: RenderJob[] } {
  const jobs: RenderJob[] = [];
  const render: Render = async (job) => {
    jobs.push(job);
    const moving = job.move;
    return { ok: true, shots: [{ frame: 1, bytes: moving ? Buffer.from("mp4") : PNG, mime: moving ? "video/mp4" : "image/png" }], ms: 10, log: "" };
  };
  return { render, jobs };
}

const ctxWith = (call: never) => ({ call, userId: ME, budget: { kind: "request" as const, paise: 10_000 } as never });

describe("the eye ends it", () => {
  it("one build, a happy eye, and straight to the real render", async () => {
    const b = brain({ verdicts: [{ ok: true }] });
    const r = goodRender();
    const store = new MemoryBlobStore();
    const made = await make(ctxWith(b.call), { ask: "a matte black speaker on concrete", creation: "speaker-1", render: r.render, store });

    expect(made.why).toBe("done");
    expect(made.ok).toBe(true);
    expect(made.rounds.length).toBe(1);
    // the cheap one first, then the real one
    expect(r.jobs.length).toBe(2);
    expect(r.jobs[0]!.script).toContain("resolution_x = 480");
    expect(r.jobs[1]!.script).toContain("resolution_x = 1280");
    // the eye was shown the picture, not told about it
    expect(b.prompts.find((p) => p.purpose === "cinema.eye")!.pictures).toBe(1);
    expect(made.paise).toBe(25);
  });

  it("keeps the script, the preview and the final under this person's own keys", async () => {
    const b = brain({ verdicts: [{ ok: true }] });
    const store = new MemoryBlobStore();
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "speaker-1", version: 2, render: goodRender().render, store });

    expect(made.kept.script?.key).toBe(`c/${ME}/speaker-1/v2/scene.py`);
    expect(made.kept.preview?.key).toBe(`c/${ME}/speaker-1/v2/preview-1.png`);
    expect(made.kept.final?.key).toBe(`c/${ME}/speaker-1/v2/final.png`);
    expect(made.kept.final?.sha256).toMatch(/^[0-9a-f]{64}$/);
    // and the script kept is the one that makes it again
    expect(made.script).toContain("primitive_cube_add");
  });

  it("a move is kept as one clip", async () => {
    const b = brain({ verdicts: [{ ok: true }], scenes: [{ ...SCENE(), move: { kind: "turntable", seconds: 3, fps: 24 } }] });
    const store = new MemoryBlobStore();
    const made = await make(ctxWith(b.call), { ask: "turn it round", creation: "spin-1", render: goodRender().render, store });
    expect(made.kept.final?.key).toMatch(/final\.mp4$/);
    expect(made.mime).toBe("video/mp4");
  });
});

describe("what it does with what it sees", () => {
  it("tells the next build what was wrong, in the eye's own words", async () => {
    const b = brain({
      verdicts: [{ ok: false, issues: ["the box is sunk through the floor"], fix: "lift the box to z = half its height" }, { ok: true }],
      scenes: [SCENE(), SCENE("#222222")],
    });
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "s", render: goodRender().render, store: new MemoryBlobStore() });

    expect(made.rounds.length).toBe(2);
    expect(made.why).toBe("done");
    const second = b.prompts.filter((p) => p.purpose === "cinema.scene")[1]!;
    expect(second.user).toContain("sunk through the floor");
    expect(second.user).toContain("lift the box");
    // and it is shown what it built last time, so it can change one thing
    expect(second.user).toContain('"id":"box"');
  });

  it("stops at the rounds it was given, and keeps what it had", async () => {
    const b = brain({ verdicts: [{ ok: false, issues: ["too dark"] }] });
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "s", rounds: 2, render: goodRender().render, store: new MemoryBlobStore() });
    expect(made.rounds.length).toBe(2);
    expect(made.why).toBe("rounds");
    // it still rendered the best it had
    expect(made.ok).toBe(true);
    expect(made.kept.final).toBeDefined();
  });

  it("hands a script that will not run back to the model as the thing to fix", async () => {
    const b = brain({ verdicts: [{ ok: true }] });
    let first = true;
    const render: Render = async (job) => {
      if (first) { first = false; return { ok: false, error: "AttributeError: 'NoneType' has no attribute 'name'", ms: 5, log: "" }; }
      return { ok: true, shots: [{ frame: 1, bytes: PNG, mime: "image/png" }], ms: 5, log: "" };
    };
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "s", rounds: 3, render, store: new MemoryBlobStore() });
    const second = b.prompts.filter((p) => p.purpose === "cinema.scene")[1]!;
    expect(second.user).toContain("did not render");
    expect(second.user).toContain("AttributeError");
    expect(made.rounds[0]!.renderError).toContain("AttributeError");
  });

  it("says so when it never rendered at all", async () => {
    const b = brain({ verdicts: [{ ok: true }] });
    const render: Render = async () => ({ ok: false, error: "no blender here", ms: 1, log: "" });
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "s", rounds: 2, render, store: new MemoryBlobStore() });
    expect(made.ok).toBe(false);
    expect(made.why).toBe("render");
    // the script it got to is still there, so the next attempt starts from something
    expect(made.script).toContain("primitive_cube_add");
  });
});

describe("the edges", () => {
  it("stops when the money does, and keeps what it made", async () => {
    const b = brain({ verdicts: [{ ok: false, issues: ["too dark"] }] });
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "s", rounds: 4, capPaise: 25, render: goodRender().render, store: new MemoryBlobStore() });
    expect(made.why).toBe("budget");
    expect(made.rounds.length).toBe(1);
    expect(made.kept.preview).toBeDefined();
    expect(made.kept.final).toBeUndefined();
  });

  it("runs with no bucket at all", async () => {
    const b = brain({ verdicts: [{ ok: true }] });
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "s", render: goodRender().render, store: null });
    expect(made.ok).toBe(true);
    expect(made.kept).toEqual({});
    expect(made.scene!.objects.length).toBe(2);
  });

  it("renders what the checker allowed, not what the model asked for", async () => {
    const tooMuch = { ...SCENE(), look: { samples: 90_000, width: 9000, height: 9000, engine: "cycles", sky: "studio" } };
    const b = brain({ verdicts: [{ ok: true }], scenes: [tooMuch] });
    const r = goodRender();
    const made = await make(ctxWith(b.call), { ask: "a speaker", creation: "s", render: r.render, store: null });
    expect(made.scene!.look.samples).toBe(512);
    expect(r.jobs[1]!.script).toContain("S.cycles.samples = 512");
    expect(made.rounds[0]!.notes.length).toBeGreaterThan(0);
  });

  it("only ever names assets to the model, never where they are", () => {
    const user = sceneUser({ ask: "put the speaker on it", assets: ["speaker", "sky-studio"], round: 1 });
    expect(user).toContain("speaker");
    expect(user).not.toContain("/var/assets");
    const scene = checkScene({ objects: [{ shape: "asset", asset: "speaker", size: 1 }] }).scene;
    expect(scene.objects[0]!.asset).toBe("speaker");
  });
});

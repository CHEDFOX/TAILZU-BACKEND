/**
 * THE 3D HALF, CONNECTED (src/cinema/scene/service.ts, store.ts, docs/cinema-3d.md). The loop itself is tested in
 * cinema-make.test.ts; what is tested here is everything around it, which is what was missing before:
 *
 *   - a creation's row is written BEFORE the loop runs, so asking and closing the app still leaves the thing behind
 *   - when the loop ends, the row holds what it made: the keys kept, the rounds, the objects and the money
 *   - one at a time per person: a second ask is refused in words, not queued where nobody can see it
 *   - asking again for the same creation is the NEXT VERSION of it, and never writes over the one before
 *   - a loop that throws leaves a failed row with the reason, not a row that says it is still building
 *   - a restart's stranded rows are failed once, so nothing says it is building when nothing is
 *   - the signed link that serves the film half's files serves a creation's too, and no one else's
 */
import { describe, expect, it } from "vitest";

const { SceneService } = await import("../src/cinema/scene/service.js");
const { MemorySceneStore } = await import("../src/cinema/scene/store.js");
const { MemoryBlobStore } = await import("../src/media/blob.js");
const { signMedia, verifyMedia, isCinemaKey, ownerOfKey } = await import("../src/cinema/media.js");
const { creationKey } = await import("../src/cinema/scene/ports.js");
import type { Render } from "../src/cinema/scene/ports.js";
import type { SceneRecord } from "../src/cinema/scene/store.js";

const ME = "00000000-0000-4000-8000-00000000aaaa";
const YOU = "00000000-0000-4000-8000-00000000bbbb";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const SCENE = {
  look: { engine: "cycles", samples: 64, width: 1280, height: 960, sky: "studio" },
  camera: { at: [3, -3, 1.6], to: [0, 0, 0.4], lens: 85 },
  lights: [{ kind: "key", power: 300 }],
  materials: { shell: { colour: "#1b1b1b", roughness: 0.4 } },
  objects: [
    { id: "floor", shape: "plane", at: [0, 0, 0], size: 10, shadowOnly: true },
    { id: "lamp", shape: "cube", at: [0, 0, 0.4], size: 0.4, material: "shell" },
  ],
};

/** A model that answers one scene and a happy eye. */
const brain = () => (async (input: unknown) => {
  const i = input as { purpose: string };
  if (i.purpose === "cinema.eye") return { json: { ok: true, issues: [] }, paise: 5, model: "fake-eye" };
  return { json: SCENE, paise: 20, model: "fake-scene" };
}) as never;

const goodRender = (): Render => async () => ({ ok: true, shots: [{ frame: 1, bytes: PNG, mime: "image/png" }], ms: 10, log: "" });

/** A service whose finished creations can be waited on instead of slept over. */
function svcWith(o: { render?: Render; call?: never; ready?: boolean } = {}) {
  const store = new MemorySceneStore();
  const done: SceneRecord[] = [];
  const waiters: Array<() => void> = [];
  const s = new SceneService({
    store,
    blobs: new MemoryBlobStore(),
    render: o.render ?? goodRender(),
    ready: async () => ({ ok: o.ready !== false, version: o.ready === false ? null : "4.0.2" }),
    capPaise: 400,
    call: o.call ?? brain(),
    onDone: (r) => { done.push(r); for (const w of waiters.splice(0)) w(); },
  });
  // Each call waits for the NEXT creation to finish, not the last one that did: a second version has its own wait.
  let seen = 0;
  const settled = async (): Promise<SceneRecord> => {
    while (done.length <= seen) await new Promise<void>((go) => waiters.push(go));
    seen = done.length;
    return done[done.length - 1]!;
  };
  return { s, store, settled, done };
}

describe("a creation, start to finish", () => {
  it("writes the row before it builds, and fills it in when it is done", async () => {
    const { s, store, settled } = svcWith();
    const started = await s.start(ME, "a brass desk lamp on an oak table");

    // Before anything has rendered, the thing a person asked for is already theirs to come back to.
    const early = await store.get(ME, started.id);
    expect(early?.status).toBe("working");
    expect(early?.ask).toBe("a brass desk lamp on an oak table");
    expect(early?.version).toBe(1);

    const r = await settled();
    expect(r.status).toBe("done");
    expect(r.why).toBe("done");
    expect(r.rounds).toBeGreaterThan(0);
    expect(r.objects).toBe(2);
    expect(r.paise).toBeGreaterThan(0);
    // The script is the asset, and the preview is what a list shows.
    expect(r.kept.script).toBeTruthy();
    expect(r.kept.preview).toBeTruthy();
    expect(r.mime).toBe("image/png");
    // And it is on the person's own list.
    expect((await s.list(ME)).map((x) => x.id)).toContain(started.id);
  });

  it("keeps every file under this person's own keys, and nobody can name another's", async () => {
    const { s, settled } = svcWith();
    await s.start(ME, "a steel kettle");
    const r = await settled();
    for (const key of Object.values(r.kept).flat()) {
      expect(key.startsWith(`c/${ME}/`), key).toBe(true);
      expect(ownerOfKey(key)).toBe(ME);
      expect(isCinemaKey(key)).toBe(true);
    }
    expect(ownerOfKey(creationKey(YOU, r.creation, 1, "preview.png"))).toBe(YOU);
  });

  it("refuses a second scene while one is building, in words", async () => {
    const { s, settled } = svcWith();
    await s.start(ME, "a lamp");
    await expect(s.start(ME, "another lamp")).rejects.toThrow("one at a time");
    // Someone else is not held up by them.
    await expect(s.start(YOU, "a bowl")).resolves.toBeTruthy();
    await settled();
  });

  it("asks nothing of a machine with no words to build from", async () => {
    const { s } = svcWith();
    await expect(s.start(ME, "   ")).rejects.toThrow("say what to build");
  });

  it("makes the next version of a creation it is given, and never writes over the one before", async () => {
    const { s, store, settled } = svcWith();
    const first = await s.start(ME, "a brass lamp");
    const a = await settled();
    expect(a.version).toBe(1);

    const again = await s.start(ME, "the same lamp, but taller", { creation: first.creation });
    expect(again.creation).toBe(first.creation);
    expect(again.version).toBe(2);
    const b = await settled();
    expect(b.version).toBe(2);
    // Two rows, two sets of keys, and v1's are still there.
    expect(await store.get(ME, first.id)).toBeTruthy();
    expect(a.kept.script).not.toBe(b.kept.script);
    expect(a.kept.script).toContain("/v1/");
    expect(b.kept.script).toContain("/v2/");
    expect((await store.latest(ME, first.creation))?.version).toBe(2);
  });

  it("leaves a failed row with the reason when the loop itself throws", async () => {
    const { s, settled } = svcWith({ call: (async () => { throw new Error("the model is down"); }) as never });
    await s.start(ME, "a lamp");
    const r = await settled();
    expect(r.status).toBe("failed");
    expect(r.error).toBeTruthy();
  });

  it("says a render that will not run is a failure, and keeps what it knows", async () => {
    const render: Render = async () => ({ ok: false, error: "blender: not found", ms: 1, log: "" });
    const { s, settled } = svcWith({ render });
    await s.start(ME, "a lamp");
    const r = await settled();
    expect(r.status).toBe("failed");
    expect(r.rounds).toBeGreaterThan(0);
  });

  it("fails what a restart stranded, once, so nothing says it is building when nothing is", async () => {
    const { s, store } = svcWith();
    const at = Date.now();
    const stuck: SceneRecord = {
      id: "11111111-1111-4111-8111-111111111111", ownerId: ME, creation: "abc", version: 1, ask: "a lamp",
      status: "working", why: null, rounds: 0, objects: 0, kept: {}, mime: null, paise: 0, error: null, createdAt: at, updatedAt: at,
    };
    await store.create(stuck);
    expect(await s.sweep()).toBe(1);
    const after = await store.get(ME, stuck.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("restarted");
    // And again is a no-op: there is nothing left saying it is building.
    expect(await s.sweep()).toBe(0);
  });

  it("goes with the account", async () => {
    const { s, store, settled } = svcWith();
    const mine = await s.start(ME, "a lamp");
    await settled();
    await s.forAccountDelete(ME);
    expect(await store.get(ME, mine.id)).toBeNull();
  });

  it("says so when this machine has no Blender, instead of taking the work", async () => {
    const { s } = svcWith({ ready: false });
    expect(await s.ready()).toEqual({ ok: false, version: null });
  });
});

describe("a creation's files go out by the same signed link as a film's", () => {
  it("signs and verifies a c/ key, and a tampered one fails", () => {
    const key = creationKey(ME, "abc12345", 2, "preview.png");
    const link = signMedia(key, { secret: "s3cret" });
    const url = new URL(`https://x${link}`);
    expect(verifyMedia(key, url.searchParams.get("exp") ?? undefined, url.searchParams.get("sig") ?? undefined, { secret: "s3cret" })).toBe(true);
    // Another person's key with this signature is not served.
    expect(verifyMedia(creationKey(YOU, "abc12345", 2, "preview.png"), url.searchParams.get("exp") ?? undefined, url.searchParams.get("sig") ?? undefined, { secret: "s3cret" })).toBe(false);
  });

  it("will not serve a key that climbs out of a folder", () => {
    expect(isCinemaKey("c/me/../../etc/passwd")).toBe(false);
    expect(isCinemaKey("c/me/ok/v1/preview.png")).toBe(true);
  });
});

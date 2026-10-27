/**
 * Versions (src/artifacts/versions.ts, store.ts): a snapshot every tenth version and patches between, any version rebuilt from the nearest
 * snapshot across 25 versions, revert as a new version, exact edits (all or nothing, naming the one that missed), and a head that moves only
 * if it is still where the writer read it.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { rig } = await import("./artifacts-rig.js");
const { applyEdits, applyPatch, contentAt, decodePatch, diffSpan, encodePatch, isSnapshotVersion, newVersion, planVersion } = await import("../src/artifacts/versions.js");
const { SNAPSHOT_EVERY } = await import("../src/artifacts/types.js");

describe("patches", () => {
  it("are one span between the common start and the common end, and rebuild the text exactly", () => {
    const a = "<div>\n  <p>one</p>\n  <p>two</p>\n</div>\n";
    const b = "<div>\n  <p>one</p>\n  <p>TWO and more</p>\n</div>\n";
    const edits = diffSpan(a, b);
    expect(edits).toHaveLength(1);
    expect(applyPatch(a, encodePatch(edits, b.length))).toBe(b);
    expect(diffSpan(a, a)).toEqual([]);
    // a pure insertion, a pure deletion, the whole text
    expect(applyPatch("abc", encodePatch(diffSpan("abc", "abXc"), 4))).toBe("abXc");
    expect(applyPatch("abXc", encodePatch(diffSpan("abXc", "abc"), 3))).toBe("abc");
    expect(applyPatch("abc", encodePatch(diffSpan("abc", "xyz"), 3))).toBe("xyz");
  });

  it("never split a surrogate pair, so a text with emoji comes back whole", () => {
    const a = "price: 😀 and 😁 end";
    const b = "price: 😀 and 😂 end";
    expect(applyPatch(a, encodePatch(diffSpan(a, b), b.length))).toBe(b);
    const c = "x😀y";
    const d = "x😁y";
    expect(applyPatch(c, encodePatch(diffSpan(c, d), d.length))).toBe(d);
  });

  it("refuse to apply to the wrong text, by the length check and by their own shape", () => {
    const patch = encodePatch([[0, 1, "abc"]], 99);
    expect(() => applyPatch("xyz", patch)).toThrow(/wrong length/);
    expect(() => applyPatch("x", encodePatch([[5, 1, "a"]], 1))).toThrow(/does not fit/);
    expect(() => decodePatch("not json")).toThrow();
    expect(() => decodePatch(JSON.stringify({ e: [[0, 1]], n: 1 }))).toThrow(/bad edit/);
  });

  it("are stored as a snapshot instead when they are most of the text, and always at version 1, 11, 21", () => {
    expect([1, 11, 21, 31].every(isSnapshotVersion)).toBe(true);
    expect([2, 10, 12, 20].some(isSnapshotVersion)).toBe(false);
    expect(planVersion(5, "a".repeat(100) + "b", "a".repeat(100) + "c").kind).toBe("patch");
    expect(planVersion(5, "x".repeat(100), "y".repeat(100)).kind).toBe("snapshot");
    expect(planVersion(11, "a".repeat(100) + "b", "a".repeat(100) + "c").kind).toBe("snapshot");
  });
});

describe("exact edits", () => {
  const text = "one\ntwo\nthree\ntwo\nfour\n";

  it("apply all at once, against the text as it is, and become a patch at their places", () => {
    const r = applyEdits(text, [{ old: "one", new: "ONE" }, { old: "three", new: "3" }]);
    expect(r.content).toBe("ONE\ntwo\n3\ntwo\nfour\n");
    expect(applyPatch(text, encodePatch(r.pos, r.content.length))).toBe(r.content);
  });

  it("apply none when one misses, and name the one that missed", () => {
    expect(() => applyEdits(text, [{ old: "one", new: "ONE" }, { old: "five", new: "5" }])).toThrow(/Edit 2 did not apply: its old text "five" is not in the artifact.*Nothing was changed/);
  });

  it("refuse an old text that is in the artifact more than once, and say how many", () => {
    expect(() => applyEdits(text, [{ old: "two", new: "2" }])).toThrow(/Edit 1 did not apply.*"two" is in the artifact 2 times.*the only one/);
  });

  it("are matched against the artifact, not against the edits before them", () => {
    expect(() => applyEdits(text, [{ old: "one", new: "uno" }, { old: "uno", new: "x" }])).toThrow(/Edit 2 did not apply.*not against the edits before it/);
  });

  it("refuse overlapping edits, empty and unchanged ones, and a list that is not a list", () => {
    expect(() => applyEdits(text, [{ old: "one\ntwo", new: "a" }, { old: "two\nthree", new: "b" }])).toThrow(/Edits 1 and 2 overlap/);
    expect(() => applyEdits(text, [{ old: "", new: "x" }])).toThrow(/empty old text/);
    expect(() => applyEdits(text, [{ old: "one", new: "one" }])).toThrow(/changes nothing/);
    expect(() => applyEdits(text, "nope")).toThrow(/edits is a list/);
    expect(() => applyEdits(text, [])).toThrow(/empty/);
    expect(() => applyEdits(text, [{ old: "one" } as never])).toThrow(/needs both old/);
    expect(() => applyEdits(text, Array.from({ length: 41 }, (_, i) => ({ old: `o${i}`, new: "x" })))).toThrow(/At most 40/);
  });

  it("point at a spacing difference when a line of the old text is there", () => {
    expect(() => applyEdits("const total = a  +  b;\nreturn total;\n", [{ old: "const total = a + b;\nreturn total;", new: "x" }])).toThrow(/A line of it, "return total;", is in the artifact, so the difference is in the spacing/);
  });
});

describe("a run of 25 versions", () => {
  async function run() {
    const { service, store } = rig();
    const first = `<main>\n${Array.from({ length: 40 }, (_, i) => `  <p id="p${i}">line ${i}</p>`).join("\n")}\n</main>\n`;
    const made = await service.create("u1", { type: "html", title: "Run", content: first });
    const id = made.artifact.id;
    const texts: string[] = [first];
    for (let v = 2; v <= 25; v += 1) {
      const prev = texts[v - 2]!;
      if (v === 14) {
        // a rewrite: most of it changes
        const next = `<main>\n${Array.from({ length: 40 }, (_, i) => `  <p class="n">fresh ${i}</p>`).join("\n")}\n</main>\n`;
        await service.rewrite("u1", id, next);
        texts.push(next);
      } else {
        const i = v % 40;
        const old = prev.includes(`line ${i}</p>`) ? `line ${i}</p>` : prev.includes(`fresh ${i}</p>`) ? `fresh ${i}</p>` : `${i}</p>`;
        const c = await service.update("u1", id, [{ old, new: `${old.replace("</p>", "")} v${v}</p>` }]);
        texts.push(await service.contentOf(id, c.version));
      }
    }
    return { service, store, id, texts };
  }

  it("rebuild every version from the nearest snapshot, exactly", async () => {
    const { service, store, id, texts } = await run();
    expect(texts).toHaveLength(25);
    for (let v = 1; v <= 25; v += 1) expect(await contentAt(store, id, v), `version ${v}`).toBe(texts[v - 1]);
    // and through the service, whose memory of recent heads is not trusted here: a fresh service over the same rows
    const { ArtifactService } = await import("../src/artifacts/service.js");
    const fresh = new ArtifactService({ store });
    for (const v of [1, 2, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 25]) expect((await fresh.get("u1", id, v)).content, `version ${v}`).toBe(texts[v - 1]);
    void service;
  });

  it("store a snapshot at 1, 11 and 21 and patches between, so the stored bytes are a fraction of the texts", async () => {
    const { store, id, texts } = await run();
    const list = await store.listVersions(id, 50);
    const byVersion = new Map(list.map((v) => [v.version, v]));
    for (const v of [1, 11, 21]) expect(byVersion.get(v)!.kind, `v${v}`).toBe("snapshot");
    // 14 was a rewrite of most of the text: stored whole
    expect(byVersion.get(14)!.kind).toBe("snapshot");
    for (const v of [2, 3, 10, 12, 13, 15, 22, 25]) expect(byVersion.get(v)!.kind, `v${v}`).toBe("patch");
    expect(byVersion.get(25)!.madeBy).toBe("bot");
    const stored = list.reduce((n, v) => n + v.storedBytes, 0);
    const whole = texts.reduce((n, t) => n + Buffer.byteLength(t, "utf8"), 0);
    expect(stored).toBeLessThan(whole * 0.25);
    // no version is more than SNAPSHOT_EVERY - 1 patches from a snapshot
    let since = 0;
    for (const v of [...list].sort((a, b) => a.version - b.version)) {
      since = v.kind === "snapshot" ? 0 : since + 1;
      expect(since).toBeLessThan(SNAPSHOT_EVERY);
    }
  });

  it("revert makes a NEW version with an old one's text, and every version still rebuilds", async () => {
    const { service, id, texts } = await run();
    const r = await service.revert("u1", id, 7);
    expect(r.version).toBe(26);
    expect(r.how.mode).toBe("revert");
    expect((await service.get("u1", id)).content).toBe(texts[6]);
    expect((await service.get("u1", id, 25)).content).toBe(texts[24]);
    expect((await service.get("u1", id, 7)).content).toBe(texts[6]);
    const versions = await service.versions("u1", id);
    expect(versions[0]).toMatchObject({ version: 26, madeBy: "person", note: "Went back to version 7" });
    // and you cannot "revert" to the head, to a version that is not there, or to a thing that is not a version
    await expect(service.revert("u1", id, 26)).rejects.toMatchObject({ code: "bad_request" });
    await expect(service.revert("u1", id, 0)).rejects.toMatchObject({ code: "bad_request" });
    await expect(service.revert("u1", id, "7" as never)).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("the head", () => {
  it("moves only if it is still where the writer read it: the second of two edits at once is told to look again", async () => {
    const { service, store } = rig();
    const made = await service.create("u1", { type: "markdown", title: "Notes", content: "# Notes\n\nalpha\n\nbeta\n" });
    const a = await store.get(made.artifact.id);
    const first = "# Notes\n\nalpha\n\nbeta\n";
    const edit = (n: string) => newVersion(2, first, first.replace("alpha", n), { madeBy: "bot", note: n });
    expect(await store.addVersion(a!.id, 1, edit("gamma"))).toMatchObject({ headVersion: 2 });
    expect(await store.addVersion(a!.id, 1, edit("delta"))).toBeNull();
    expect((await store.get(a!.id))!.headVersion).toBe(2);
    expect(await contentAt(store, a!.id, 2)).toBe(first.replace("alpha", "gamma"));
    // the same through the service: an edit made from a stale read loses, with a plain reason
    const { artifact } = await service.load("u1", made.artifact.id);
    await service.update("u1", made.artifact.id, [{ old: "beta", new: "BETA" }]);
    await expect(service.commit(artifact, "# Notes\n\nalpha\n\nbeta two\n", { madeBy: "person", note: "x", paise: 0, how: { mode: "edits" } })).rejects.toMatchObject({ code: "head_moved" });
  });

  it("adds what an edit cost to the artifact, in the same step", async () => {
    const { store, service } = rig();
    const made = await service.create("u1", { type: "markdown", title: "N", content: "hello\n" });
    const next = await store.addVersion(made.artifact.id, 1, newVersion(2, "hello\n", "HELLO\n", { madeBy: "person", note: "n" }), { paise: 7, title: "Renamed" });
    expect(next).toMatchObject({ spentPaise: 7, title: "Renamed", headVersion: 2 });
    await store.addSpend(made.artifact.id, 5);
    expect((await store.get(made.artifact.id))!.spentPaise).toBe(12);
  });
});

/**
 * A PROJECT BRAIN BUILD, IN WORKERD.
 *
 * tulmi's project rig (tulmi/tests/project-rig.ts: a fake GitHub serving "Acme Shop" as one tarball, a fake model, in-memory stores)
 * with the build run by the same call the BuildBrain Workflow makes (`buildHere`), inside the Workers runtime: the tar reader
 * (node:zlib's gunzip through node:stream), the analysis of every file, the import graph, the history, the words.
 */
import { describe, expect, it } from "vitest";

process.env.RUNTIME = "worker";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.CONNECTOR_TOKEN_KEY = btoa("0123456789abcdef0123456789abcdef");

const { projectRig } = await import("../../tulmi/tests/project-rig.js");

describe("the brain, built in the Workers runtime", () => {
  it("builds a project in full, from one tarball, and then incrementally from what changed", async () => {
    const r = await projectRig();
    const full = await r.brain.buildHere("alice", r.projectId, { mode: "full" });
    expect(full.status).toBe("ready");
    expect(full.headSha).toBe(r.repo.head.sha);
    expect(full.structure!.languages.length).toBeGreaterThan(0);
    expect(full.summaries).not.toBe("none");
    expect(r.gh.count(/\/tarball\//)).toBeGreaterThan(0);
    const handle = await r.brain.open("alice", r.projectId);
    expect((await handle.paths()).length).toBeGreaterThan(5);
    expect((await handle.findFiles("api")).length).toBeGreaterThan(0);

    r.repo.commit({ "src/lib/util.ts": "export const changed = 1;\n" }, "a change");
    r.gh.reset();
    const next = await r.brain.buildHere("alice", r.projectId, { mode: "incremental" });
    expect(next.status).toBe("ready");
    expect(next.headSha).toBe(r.repo.head.sha);
    expect(r.gh.count(/\/tarball\//)).toBe(0);
  });
});

/** The BuildBrain Workflow: a check, then the whole build as one step, with the Worker's real Workflow engine. */
import { introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setWorldForTests } from "../src/world.js";
import { SHA, scriptedWorld, testEnv, uuid } from "./helpers.js";

let h: ReturnType<typeof scriptedWorld>;
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(() => setWorldForTests(null));

const params = (n: number, mode: "full" | "incremental" = "full") => ({ userId: "user-1", projectId: uuid(n), mode, headSha: SHA });

describe("BuildBrain", () => {
  it("checks, builds, and says what it built", async () => {
    const p = params(1);
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, "b1");
    await testEnv.BUILD_BRAIN.create({ id: "b1", params: p });
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ status: "ready", headSha: SHA, spentPaise: 12 });
    expect(h.brain.checked).toEqual([p]);
    expect(h.brain.built).toEqual([p]);
  });

  it("does not build a brain that is already built from this commit", async () => {
    h.brain.skip = true;
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, "b2");
    await testEnv.BUILD_BRAIN.create({ id: "b2", params: params(2, "incremental") });
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toMatchObject({ status: "ready", skipped: "The brain is already built from this commit." });
    expect(h.brain.built).toHaveLength(0);
  });

  it("tries a build that threw once more, and then reports it", async () => {
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, "b3");
    await inst.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "build" }, new Error("GitHub answered 502"), 1);
    });
    await testEnv.BUILD_BRAIN.create({ id: "b3", params: params(3) });
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toMatchObject({ status: "ready" });
  });

  it("fails the Workflow, with the build's own error, when it keeps failing", async () => {
    h.brain.failBuild = new Error("out of memory");
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, "b4");
    await inst.modify(async (m) => { await m.disableRetryDelays(); });
    await testEnv.BUILD_BRAIN.create({ id: "b4", params: params(4) });
    await inst.waitForStatus("errored");
    expect(h.brain.built.length).toBe(2); // the step's one retry
  });

  it("refuses a payload that is not a build", async () => {
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, "b5");
    await testEnv.BUILD_BRAIN.create({ id: "b5", params: { userId: "", projectId: "x", mode: "full", headSha: "y" } });
    await inst.waitForStatus("errored");
    expect(h.brain.checked).toHaveLength(0);
  });
});

/**
 * X0's cloud runner (jobs/container, jobs/src/containers.ts): its copy of the session script is GitHub's own, and a place that costs nothing runs
 * a step after the person's PCs and GitHub with no rule and no yes, while one that costs still needs them (code/jobs/placement.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { choosePlacement } from "../src/code/jobs/placement.js";
import { RUN_MJS } from "../src/code/jobs/runScript.js";
import { parseFromRunner } from "../src/code/live/protocol.js";

const ctx = (over: Record<string, unknown> = {}) => ({
  desktops: 0, githubEnabled: true, githubMinutesLeft: 0, paidRule: "never" as const, paidAvailable: true, paidLeftPaise: 0, estimateMinutes: 4, estimatePaise: 0, ...over,
}) as Parameters<typeof choosePlacement>[0];

describe("X0's cloud runner", () => {
  it("runs the very session script GitHub's computers run (run `npx tsx scripts/write-container-runner.ts` after changing it)", () => {
    const copy = readFileSync(fileURLToPath(new URL("../../jobs/container/run.mjs", import.meta.url)), "utf8");
    expect(copy).toBe(RUN_MJS);
    expect(RUN_MJS).toContain('cloud ? "container" : "github"');
  });

  it("says it is the cloud's in the room's hello, and the room takes it", () => {
    expect(parseFromRunner(JSON.stringify({ t: "hello", v: 1, kind: "container", name: "X0 cloud" }))).toMatchObject({ t: "hello", kind: "container" });
    expect(parseFromRunner(JSON.stringify({ t: "hello", v: 1, kind: "spaceship" }))).toBeNull();
  });

  it("free: taken when the PCs and GitHub can't, whatever the paid rule", () => {
    expect(choosePlacement(ctx())).toMatchObject({ placement: "paid" });
    // Still only after them.
    expect(choosePlacement(ctx({ githubMinutesLeft: 10 }))).toMatchObject({ placement: "github" });
    expect(choosePlacement(ctx({ desktops: 1 }))).toMatchObject({ placement: "desktop" });
  });

  it("priced: needs the person's rule and, past what they allowed, their yes; off, it waits", () => {
    expect(choosePlacement(ctx({ estimatePaise: 120 }))).toMatchObject({ wait: true });
    expect(choosePlacement(ctx({ estimatePaise: 120, paidRule: "ask" }))).toMatchObject({ ask: true, estimatePaise: 120 });
    expect(choosePlacement(ctx({ estimatePaise: 120, paidRule: "auto", paidLeftPaise: 500 }))).toMatchObject({ placement: "paid" });
    expect(choosePlacement(ctx({ paidAvailable: false }))).toMatchObject({ wait: true });
  });
});

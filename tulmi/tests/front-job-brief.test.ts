/**
 * WHERE A JOB STANDS, FOR THE CHAT IT WAS STARTED FROM (src/front/handlers.ts jobBrief): its state, the checks, the pull request and its report.
 */
import { describe, expect, it } from "vitest";
import { jobBrief } from "../src/front/handlers.js";

const view = (job: Record<string, unknown>, agent: Record<string, unknown> | null) => ({ view: async () => ({ job, agent }) }) as never;

describe("a job's brief", () => {
  it("says a finished job's state, checks, pull request and report", async () => {
    const out = await jobBrief(view({ state: "done", branch: "tailzu/fix" }, {
      phase: "done", staged: [], verify: { ran: true, ok: true, summary: "nothing this change broke" }, pr: { number: 4, url: "u", ready: true },
      report: { text: "Fixed the duplicate error in packages/config/src/rules.ts." },
    }), "alice", "j1");
    expect(out).toBe("Job on branch tailzu/fix: done.\nThe project's checks: passed. nothing this change broke\nPull request #4 (ready for review).\nIts report:\nFixed the duplicate error in packages/config/src/rules.ts.");
  });

  it("says a running job is still working, with what it has staged", async () => {
    const out = await jobBrief(view({ state: "running", branch: "tailzu/fix" }, { phase: "work", staged: ["src/a.ts"] }), "alice", "j1");
    expect(out).toBe("Job on branch tailzu/fix: still working (work).\nStaged, not committed yet: src/a.ts");
  });

  it("is null for a job that is not theirs", async () => {
    expect(await jobBrief({ view: async () => { throw new Error("not found"); } } as never, "bob", "j1")).toBeNull();
  });
});

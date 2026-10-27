/**
 * THE WHOLE AGENT LOOP, IN WORKERD.
 *
 * Everything else in test/ puts a script where the loop would be. This does not: it is tulmi's own rig (tulmi/tests/agent-rig.ts: a
 * fake GitHub, the fixture brain, a scripted model, a runner that answers from a script, the real router, policy and workspace)
 * driven by the real orchestrator's `advance`, one advance at a time, INSIDE the Workers runtime. If the shared code cannot run
 * here (a Node module that workerd lacks, a global that is not there, a stream that behaves differently) this is where it fails.
 */
import { describe, expect, it } from "vitest";
import type { Advance } from "../../tulmi/src/code/agent/loop.js";

process.env.RUNTIME = "worker";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.CONNECTOR_TOKEN_KEY = btoa("0123456789abcdef0123456789abcdef");

const { agentRig, call, done, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("../../tulmi/tests/agent-rig.js");
const { createAgent } = await import("../../tulmi/src/code/agent/index.js");
const { routerRunner } = await import("../../tulmi/src/code/agent/runner.js");
const { createWorkBranch } = await import("../../tulmi/src/code/projects.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

function worker(r: Rig, instanceId = "wf") {
  return createAgent({
    code: r.code, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog, intake: r.intake, routeStats: r.routeStats,
    notify: (u, k, d) => { r.told.push({ userId: u, kind: k, data: d }); }, now: r.now, sleep: r.sleep, log: r.log,
    web: { store: null, cache: null, fetchFn: (async () => new Response("no", { status: 404 })) as never },
    runner: routerRunner({ jobs: r.jobs, store: r.jobStore, now: r.now, sleep: r.sleep, placeWaitMs: 120_000, pollMs: 2000 }),
    passive: true, instanceId,
  })!;
}

async function drive(r: Rig, w: ReturnType<typeof worker>, jobId: string, turns = 2): Promise<Advance[]> {
  const seen: Advance[] = [];
  for (let i = 0; i < 300; i += 1) {
    const a = await w.advance(jobId, { holder: `wf-${i}`, turns });
    seen.push(a);
    if (a.next === "end") break;
    if (a.next === "wait") {
      if (a.waitingOn === "answer" || a.waitingOn === "approval" || a.waitingOn === "budget") break;
      await r.sleep(a.waitMs ?? 1000);
    }
  }
  return seen;
}

describe("the loop, advance by advance, in the Workers runtime", () => {
  it("takes a task to a commit and a pull request: plan, edit, the checks on a runner, commit, pr, report", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed both ends."));
    const w = worker(r);
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, UTIL_TASK);
    const job = await r.jobs.createJob("alice", r.project.id, branch, UTIL_TASK, undefined, { agent: true });
    await w.enqueue(job.id, UTIL_TASK);

    const seen = await drive(r, w, job.id);
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(seen.length).toBeGreaterThan(5);
    const finished = await r.jobNow(job.id);
    expect(finished.state).toBe("done");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    expect((await r.stateNow(job.id)).report).toMatchObject({ outcome: "done" });
  });

  it("waits for the person and goes on with their word", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "Trim both ends?" }), call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, UTIL_TASK);
    const job = await r.jobs.createJob("alice", r.project.id, branch, UTIL_TASK, undefined, { agent: true });
    await w.enqueue(job.id, UTIL_TASK);
    expect((await drive(r, w, job.id)).at(-1)).toEqual({ next: "wait", waitingOn: "answer" });
    await w.answer("alice", job.id, "Yes, both");
    expect((await drive(r, w, job.id)).at(-1)).toEqual({ next: "end", why: "finished" });
    expect((await r.jobNow(job.id)).state).toBe("done");
  });
});

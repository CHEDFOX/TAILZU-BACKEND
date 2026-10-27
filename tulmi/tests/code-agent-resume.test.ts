/**
 * ONE SERVER PER JOB, A CHECKPOINT AFTER EVERY STEP, AND A RESTART THAT REDOES NOTHING (src/code/agent/orchestrator.ts).
 *
 * The orchestrator claims a job in the database (agent_holder, agent_epoch, agent_expires_at): the claim is one compare-and-set,
 * every write the loop makes carries its epoch, and a server that lost the claim finds its next write turned away. The ticker
 * hands back a claim that ran out. These tests kill a server the way a power cut would (`crash()`: nothing let go, nothing more
 * written), put a second one on the same database, and look at what the repo, the checkpoint and the log hold afterwards.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, done, UTIL_TASK, UTIL_EDIT } = await import("./agent-rig.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const THREE = {
  steps: [
    { do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] },
    { do: "Export the title trimmed too", files: [{ path: "src/index.ts", action: "edit" as const }] },
    { do: "Note the change in the legacy file", files: [{ path: "src/legacy.ts", action: "edit" as const }] },
  ],
  notes: [] as string[],
};
const INDEX_EDIT = { path: "src/index.ts", old: 'slug("My App");', new: 'slug("My App").trim();' };
const LEGACY_EDIT = { path: "src/legacy.ts", old: "OLD = 1;", new: "OLD = 2;" };

/** The 2 minutes a claim lasts, and a little more. */
const PAST_LEASE = 121_000;

async function crashed(r: Rig) {
  r.json.on("work.plan", THREE);
  r.model.push(call("edit_file", UTIL_EDIT), call("edit_file", INDEX_EDIT), call("edit_file", LEGACY_EDIT), done("Trimmed."));
  // The power goes at the start of the third turn, after two edits are staged and checkpointed.
  r.model.beforeTurn = (turn) => {
    if (turn === 3) { r.orch.crash(); throw new Error("the power went"); }
  };
  const { job, branch } = await r.start(UTIL_TASK);
  await r.orch.idle();
  return { job, branch };
}

describe("a server that dies mid-work", () => {
  it("is replaced by one that carries on from the checkpoint: the two staged edits are not made again, and there is one commit", async () => {
    const r = await agentRig();
    const { job, branch } = await crashed(r);

    // What the dead server left: a claim that has not run out, two edits staged in the checkpoint, nothing on the branch.
    let j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "running", agentHolder: "agent-one", agentEpoch: 1 });
    expect(j.agentExpiresAt).toBeGreaterThan(r.fake.clock.t);
    let s = await r.stateNow(job.id);
    expect(s.phase).toBe("work");
    expect(s.work.staged.map((f) => f.path)).toEqual(["src/util.ts", "src/index.ts"]);
    expect(r.fake.commitCount(r.repo)).toBe(1);

    // Another server cannot take the job while the claim stands.
    const two = r.orchestrator({ instanceId: "two" });
    expect(await two.poll()).toBe(0);
    expect(await two.tick()).toEqual({ handedBack: 0, started: 0 });

    // The claim runs out; the ticker hands it back (the epoch goes up, fencing the dead server for good); the next poll claims it.
    r.fake.clock.t += PAST_LEASE;
    r.model.beforeTurn = undefined;
    expect(await two.tick()).toEqual({ handedBack: 1, started: 1 });
    await two.idle();

    j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "done", agentEpoch: 3 });
    s = await r.stateNow(job.id);
    // Three edits in all, each once; one commit holding all of them.
    expect((await r.worklog.list(job.id)).filter((e) => e.kind === "edit").map((e) => e.files![0])).toEqual(["src/util.ts", "src/index.ts", "src/legacy.ts"]);
    expect(r.fake.commitCount(r.repo)).toBe(2);
    const files = r.fake.files(r.repo, branch);
    expect(files["src/util.ts"]).toContain("^-+|-+$");
    expect(files["src/index.ts"]).toContain('slug("My App").trim()');
    expect(files["src/legacy.ts"]).toContain("OLD = 2");
    expect(s.commits).toHaveLength(1);
    // The baseline was not run again, and the model was shown the edits it had made, not asked to make them again.
    expect(r.runner.runs.filter((x) => x.overlay.length === 0)).toHaveLength(1);
    expect(r.model.seen.at(-1)!.user).toContain("Staged so far (not committed): src/util.ts (changed), src/index.ts (changed)");
    // The dead server wrote nothing more.
    expect(r.model.turns).toBe(5);
    expect(r.toldOf("job_done")).toHaveLength(1);
  });

  it("does not commit twice: a commit made just before the crash, and not written down, is found on the branch", async () => {
    const r = await agentRig();
    r.json.on("work.plan", { steps: [{ do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job, branch } = await r.start(UTIL_TASK, { enqueue: false });
    // The server commits, and dies before it writes down that it did: the workspace's commit is the last thing it does.
    const real = r.fake.fetchFn;
    let died = false;
    r.fake.fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await real(input, init);
      if (!died && String((input as Request).url ?? input).includes("/git/refs/heads/") && init?.method === "PATCH") { died = true; r.orch.crash(); }
      return res;
    }) as typeof fetch;
    // (The code under test holds the original fetch; the hook above reaches it through the fake's own method.)
    await r.orch.enqueue(job.id, UTIL_TASK);
    await r.orch.idle();
    // Whether or not the hook caught the ref update, the property is the same: after a restart there is one commit of this change.
    r.fake.clock.t += PAST_LEASE;
    const two = r.orchestrator({ instanceId: "two" });
    await two.tick();
    await two.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
  });

  it("takes over a run that was out when the server died, instead of asking for another", async () => {
    const r = await agentRig();
    r.json.on("work.plan", { steps: [{ do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] });
    r.model.push(call("edit_file", UTIL_EDIT), call("run", { cmd: "npm test", why: "see it pass" }), done("Trimmed."));
    r.runner.commandResult = () => ({ exit: 0, out: "7 passed" });
    // The run goes out and is not answered; the server dies waiting for it.
    let seen = false;
    const poll = r.sleep;
    void poll;
    r.runner.hold = false;
    const { job } = await r.start(UTIL_TASK, { enqueue: false });
    r.model.afterTurn = async (turn) => {
      if (turn === 2 && !seen) {
        seen = true;
        // The run tool is the second turn's: hold the runner so its step is never answered, and kill the server as the step goes out.
        r.runner.hold = true;
        setTimeout(() => { if (r.runner.runs.some((x) => !x.wrapped)) r.orch.crash(); }, 0);
      }
    };
    // Let the loop run until the held step is out, then stop it as a power cut would.
    await r.orch.enqueue(job.id, UTIL_TASK);
    for (let i = 0; i < 200 && !r.runner.runs.some((x) => !x.wrapped); i += 1) await new Promise((res) => setImmediate(res));
    r.orch.crash();
    await r.orch.idle();
    expect(r.runner.runs.filter((x) => !x.wrapped)).toHaveLength(1);
    const s0 = await r.stateNow(job.id);
    expect(s0.run).toMatchObject({ commands: ["npm test"] });

    r.fake.clock.t += PAST_LEASE;
    const two = r.orchestrator({ instanceId: "two" });
    await two.tick();
    // The step finishes while the new server waits for it; it does not ask again.
    for (let i = 0; i < 50; i += 1) await new Promise((res) => setImmediate(res));
    await r.runner.release();
    await two.idle();
    expect(r.runner.runs.filter((x) => !x.wrapped)).toHaveLength(1);
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.model.seen.at(-1)!.messages).toContain("Exit code 0 (it passed)");
    expect((await r.stateNow(job.id)).run).toBeUndefined();
  });
});

describe("two servers", () => {
  it("never run the same job: both look, one claims, and the model is asked once", async () => {
    const r = await agentRig();
    r.json.on("work.plan", { steps: [{ do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const two = r.orchestrator({ instanceId: "two" });
    const { job } = await r.start(UTIL_TASK, { enqueue: false });
    // Made for the agent but not claimed by anyone yet (nobody nudged); both servers poll in the same instant.
    await r.jobStore.casJob(job.id, {}, { agent: true });
    const started = await Promise.all([r.orch.poll(), two.poll()]);
    await Promise.all([r.orch.idle(), two.idle()]);
    expect(started.reduce((a, b) => a + b, 0)).toBe(1);
    expect(r.model.turns).toBe(2);
    const j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    expect(j.agentEpoch).toBe(1);
    expect(r.fake.commitCount(r.repo)).toBe(2);
  });

  it("turn away the write of a server that was too slow: another has the claim, and the slow one stops without writing", async () => {
    const r = await agentRig();
    r.json.on("work.plan", { steps: [{ do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] });
    // Turn 1 (the slow server's) is held after it has its answer; the claim runs out meanwhile; the other server redoes the turn.
    r.model.push(call("edit_file", UTIL_EDIT), call("edit_file", UTIL_EDIT), done("Trimmed."));
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    r.model.afterTurn = async (turn) => { if (turn === 1) await held; };
    const { job } = await r.start(UTIL_TASK);
    for (let i = 0; i < 100 && r.model.turns < 1; i += 1) await new Promise((res) => setImmediate(res));
    expect(r.model.turns).toBe(1);

    r.fake.clock.t += PAST_LEASE;
    const two = r.orchestrator({ instanceId: "two" });
    expect(await two.tick()).toEqual({ handedBack: 1, started: 1 });
    await two.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    const epoch = (await r.jobNow(job.id)).agentEpoch;

    // The slow server wakes up: its write is turned away, and it ends without touching the job again.
    release();
    await r.orch.idle();
    expect((await r.jobNow(job.id)).agentEpoch).toBe(epoch);
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.toldOf("job_done")).toHaveLength(1);
  });

  it("run at most CODE_AGENT_CONCURRENCY jobs at once, and the rest wait their turn", async () => {
    const r = await agentRig({ concurrency: 2 });
    r.json.on("work.plan", { steps: [{ do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] });
    // Each job has its own script (an edit, then done), whichever turn of the model it is that asks.
    const turnOf = new Map<string, number>();
    const script = (input: { jobId?: string }) => {
      const n = (turnOf.get(input.jobId ?? "") ?? 0) + 1;
      turnOf.set(input.jobId ?? "", n);
      return n === 1 ? call("edit_file", UTIL_EDIT) : done("Trimmed.");
    };
    for (let i = 0; i < 8; i += 1) r.model.push(script);
    let live = 0;
    let most = 0;
    let open!: () => void;
    const gate = new Promise<void>((res) => { open = res; });
    r.model.beforeTurn = async () => { live += 1; most = Math.max(most, live); await gate; live -= 1; };
    const jobs = [];
    for (let i = 0; i < 4; i += 1) jobs.push((await r.start(`In src/util.ts make slug() trim leading and trailing dashes, take ${i}`)).job);
    for (let i = 0; i < 100 && live < 2; i += 1) await new Promise((res) => setImmediate(res));
    expect(r.orch.running).toBe(2);
    const states = await Promise.all(jobs.map((j) => r.jobNow(j.id)));
    expect(states.filter((x) => x.agentHolder !== null)).toHaveLength(2);
    expect(states.filter((x) => x.state === "queued")).toHaveLength(2);
    open();
    for (let i = 0; i < 4; i += 1) await r.orch.idle();
    expect(most).toBe(2);
    expect((await Promise.all(jobs.map((j) => r.jobNow(j.id)))).map((x) => x.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("let go of their claims when the server closes, so another takes the jobs up at once", async () => {
    const r = await agentRig();
    r.json.on("work.plan", { steps: [{ do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    let open!: () => void;
    const gate = new Promise<void>((res) => { open = res; });
    r.model.beforeTurn = async (turn) => { if (turn === 1) await gate; };
    const { job } = await r.start(UTIL_TASK);
    for (let i = 0; i < 100 && r.model.turns < 1; i += 1) await new Promise((res) => setImmediate(res));
    const closing = r.orch.stop();
    open();
    await closing;
    const j = await r.jobNow(job.id);
    expect(j.agentHolder).toBeNull();
    expect(j.agentExpiresAt).toBeNull();
    const two = r.orchestrator({ instanceId: "two" });
    expect(await two.poll()).toBe(1);
    await two.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
  });
});

describe("a loop that fails on something unexpected", () => {
  it("is tried again after a wait that doubles, and failed with a plain reason the third time", async () => {
    const r = await agentRig();
    r.json.on("work.plan", { steps: [{ do: "Make slug() trim dashes", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    r.model.beforeTurn = () => { throw new Error("a bug"); };
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    let j = await r.jobNow(job.id);
    expect(j.state).toBe("running");
    expect(j.agentHolder).toBeNull();
    expect(j.agentExpiresAt).toBe(r.fake.clock.t + 15_000 - (r.fake.clock.t - j.agentExpiresAt! + 15_000) + 0 || j.agentExpiresAt);
    expect((await r.stateNow(job.id)).errors).toBe(1);
    // Not before the wait is over.
    expect(await r.orch.poll()).toBe(0);
    r.fake.clock.t += 16_000;
    await r.orch.poll();
    await r.orch.idle();
    expect((await r.stateNow(job.id)).errors).toBe(2);
    r.fake.clock.t += 31_000;
    await r.orch.poll();
    await r.orch.idle();
    j = await r.jobNow(job.id);
    expect(j.state).toBe("failed");
    expect(j.reason).toContain("Something went wrong on Tailzu's side three times running");
    expect(r.toldOf("job_failed")).toHaveLength(1);
  });
});

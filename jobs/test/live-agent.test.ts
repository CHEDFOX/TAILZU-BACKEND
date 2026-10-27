/**
 * THE LIVE SESSION, END TO END, IN WORKERD: tulmi's agent rig (a fake GitHub, the fixture brain, a scripted model, the real router, policy and
 * orchestrator) driven advance by advance, with the REAL room and the Worker's own glue (src/live.ts):
 *
 *   read, list, grep and glob answered from the room's copy of the code (made from a tarball with a read-only token minted here);
 *   the first `run` opening the session (a session step placed by the real router, a fake runner connecting to the real room with its ticket);
 *   the command going to the runner with the staged overlay, and its result coming back as an event, not a held call;
 *   the session closed before the person is asked anything, and the room emptied when the job ends;
 *   the person's word mid-task shown to the next model turn;
 *   a run falling back to a step of its own when the job has used its session time, and when no computer can be found.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Advance } from "../../tulmi/src/code/agent/loop.js";
import { isSessionCommands } from "../../tulmi/src/code/live/protocol.js";
import { roomDeps } from "../src/jobRoom.js";
import { roomOf } from "../src/rooms.js";
import { until, testEnv } from "./helpers.js";
import { tarball } from "./live-helpers.js";
import { runnerFor, type Client } from "./live-helpers.js";

process.env.RUNTIME = "worker";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.CONNECTOR_TOKEN_KEY = btoa("0123456789abcdef0123456789abcdef");

const { agentRig, call, done, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("../../tulmi/tests/agent-rig.js");
const { CHECK_MARK } = await import("../../tulmi/src/code/agent/checks.js");
const { createAgent } = await import("../../tulmi/src/code/agent/index.js");
const { routerRunner } = await import("../../tulmi/src/code/agent/runner.js");
const { createWorkBranch } = await import("../../tulmi/src/code/projects.js");
const { buildLive } = await import("../src/live.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

afterEach(() => { roomDeps.fetch = (url, init) => fetch(url, init); roomDeps.now = () => Date.now(); });

/** The code of the work branch, served as GitHub's tarball is: a redirect from the API, then the archive. */
function serveBranch(r: Rig, branchOf: () => string) {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  roomDeps.fetch = async (url, init) => {
    seen.push({ url, authorization: new Headers(init.headers).get("authorization") });
    if (url.startsWith("https://api.github.com/")) return new Response(null, { status: 302, headers: { location: "https://codeload.example/signed" } });
    const files = r.fake.files(r.repo, branchOf());
    return new Response(await tarball(files), { status: 200 });
  };
  return seen;
}

interface SessionLog {
  /** Session steps the router placed. */
  placed: number;
  hellos: number;
  execs: Array<{ id: string; commands: string[]; overlay: Array<{ path: string; content: string | null }> }>;
  closes: Array<{ reason: unknown; toldThen: number }>;
  clients: Client[];
}

/**
 * A computer that takes a session step: it connects to the room with the ticket the router made for the step, runs what it is sent (answering
 * as the rig's script says) and, when the room closes the session, reports the step's result to the router as run.mjs does.
 */
function sessionComputer(r: Rig): SessionLog {
  const log: SessionLog = { placed: 0, hellos: 0, execs: [], closes: [], clients: [] };
  const original = r.runner.dispatch.bind(r.runner);
  let n = 0;
  r.runner.dispatch = async (job, step) => {
    if (!isSessionCommands(step.commands)) return original(job, step);
    log.placed += 1;
    const { id: jobId, userId, leaseEpoch: epoch } = job;
    const stepIdx = step.idx;
    // After the router has finished dispatching: it holds the person's lock until then.
    setImmediate(() => void (async () => {
      const c = await runnerFor(jobId, stepIdx, epoch);
      log.hellos += 1;
      log.clients.push(c);
      c.ws.addEventListener("message", (ev) => {
        const m = JSON.parse(String(ev.data)) as { t: string; id?: string; commands?: string[]; overlay?: Array<{ path: string; content: string | null }>; reason?: unknown };
        if (m.t === "exec") {
          log.execs.push({ id: m.id!, commands: m.commands!, overlay: m.overlay! });
          const run = { jobId, stepIdx, commands: m.commands!, overlay: m.overlay!, discard: true, wrapped: m.commands!.some((x) => x.includes(CHECK_MARK)) };
          const outs: string[] = [];
          let exit = 0;
          for (const cmd of m.commands!) {
            const k = new RegExp(`${CHECK_MARK} kind=(\\w+)`).exec(cmd);
            if (k) {
              const a = r.runner.checkResult(k[1]!, run);
              outs.push(`${a.text ?? ""}\n${CHECK_MARK} kind=${k[1]} exit=${a.exit} secs=3`);
            } else {
              const a = r.runner.commandResult(cmd, run);
              outs.push(`$ ${cmd}\n${a.out}`);
              if (a.exit !== 0) { exit = a.exit; break; }
            }
          }
          c.send({ t: "out", id: m.id, data: `${outs.join("\n")}\n` });
          c.send({ t: "done", id: m.id, exitCode: exit, ms: 800 });
        }
        if (m.t === "close") {
          log.closes.push({ reason: m.reason, toldThen: r.told.length });
          // run.mjs reports as a step does once the room has closed the session.
          setImmediate(() => void r.jobs.submitResult(userId, { jobId, stepIdx, epoch, exitCode: 0, outputTail: "[Tailzu: live session ended]", minutes: 2, billable: 2 }, "github").catch(() => undefined));
        }
      });
    })());
    return { holder: `session-computer-${(n += 1)}` };
  };
  return log;
}

function liveWorker(r: Rig, o: { maxMin?: number; placeWaitMs?: number } = {}) {
  const fallback = routerRunner({ jobs: r.jobs, store: r.jobStore, now: r.now, sleep: r.sleep, placeWaitMs: 120_000, pollMs: 2000 });
  const built = buildLive(testEnv, {
    d: r.d, jobs: r.jobs, store: r.jobStore, fallback, settings: { idleSec: 120, maxMin: o.maxMin ?? 20 }, now: r.now, sleep: r.sleep, pollMs: 2000,
    ...(o.placeWaitMs !== undefined ? { placeWaitMs: o.placeWaitMs } : {}), settleMs: 5000,
  })!;
  const agent = createAgent({
    code: r.code, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog, intake: r.intake, routeStats: r.routeStats,
    notify: (u, k, d) => { r.told.push({ userId: u, kind: k, data: d }); }, now: r.now, sleep: r.sleep, log: r.log,
    web: { store: null, cache: null, fetchFn: (async () => new Response("no", { status: 404 })) as never },
    runner: built.runner, live: built.deps, passive: true, instanceId: "wf-live",
  })!;
  return agent;
}

/** Advance by advance, as the Workflow does; a wait for the runner is real time (the room answers over sockets), not the rig's clock. */
async function drive(r: Rig, w: ReturnType<typeof liveWorker>, jobId: string, o: { stopAt?: (a: Advance) => boolean } = {}): Promise<Advance[]> {
  const seen: Advance[] = [];
  for (let i = 0; i < 400; i += 1) {
    const a = await w.advance(jobId, { holder: `wf-${i}`, turns: 2 });
    seen.push(a);
    if (a.next === "end" || o.stopAt?.(a)) break;
    if (a.next === "wait") {
      if (a.waitingOn === "answer" || a.waitingOn === "approval" || a.waitingOn === "budget") break;
      if (a.waitingOn === "runner") await new Promise((res) => setTimeout(res, 25));
      await r.sleep(a.waitMs ?? 1000);
    }
  }
  return seen;
}

async function start(r: Rig, task = UTIL_TASK) {
  const { branch } = await createWorkBranch(r.d, "alice", r.project.id, task);
  const job = await r.jobs.createJob("alice", r.project.id, branch, task, undefined, { agent: true });
  return { job, branch };
}

describe("the live session, end to end", () => {
  it("reads, lists, globs and greps from the room; opens the session at the first run; runs with the staged overlay; and leaves nothing behind", async () => {
    const r = await agentRig();
    const log = sessionComputer(r);
    let branch = "";
    const tar = serveBranch(r, () => branch);
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(
      call("grep", { pattern: "slug", ignoreCase: true }),
      call("glob", { pattern: "src/*.ts" }),
      call("list_dir", { path: "src" }),
      call("read_file", { path: "src/util.ts" }),
      call("edit_file", UTIL_EDIT),
      call("run", { cmd: "npm test -- util", why: "see the test pass" }),
      done("Trimmed both ends."),
    );
    const w = liveWorker(r);
    const made = await start(r);
    branch = made.branch;
    await w.enqueue(made.job.id, UTIL_TASK);

    const seen = await drive(r, w, made.job.id);
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    const finished = await r.jobNow(made.job.id);
    if (finished.state !== "done") console.log("FAILED:", finished.reason, JSON.stringify(r.logLines.slice(-8)), JSON.stringify((await r.stateNow(made.job.id)).report?.text));
    expect(finished.state).toBe("done");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");

    // What the model was told by the room's tools, in the work log.
    const turns = r.model.seen.map((s) => s.messages).join("\n");
    expect(turns).toContain('src/util.test.ts:2:import { slug } from "./util";'); // grep: ripgrep's path:line:text
    expect(turns).toContain("4 files match \"src/*.ts\""); // glob
    expect(turns).toContain("index.ts\nlegacy.ts\nutil.test.ts\nutil.ts"); // list_dir
    expect(turns).toContain("1: export function slug"); // read_file, numbered
    expect(turns).toMatch(/Exit code 0 \(it passed\), \d\.\d seconds/); // a run in a live session takes seconds, and says so

    // The copy was made once, from one tarball, with a token that only goes to GitHub's API.
    expect(tar.filter((t) => t.url.startsWith("https://api.github.com/"))).toHaveLength(1);
    expect(tar[0]!.authorization).toMatch(/^Bearer /);
    expect(tar.find((t) => t.url.startsWith("https://codeload.example"))!.authorization).toBeNull();

    // ONE session for the whole job, opened late (the first command was the baseline's), and every command went through it.
    expect(log.hellos).toBe(1);
    expect(log.placed).toBe(1);
    expect(r.runner.runs).toHaveLength(0); // not one command was a step of its own
    expect(log.execs.length).toBeGreaterThanOrEqual(3); // baseline, the model's run, the verify
    const ran = log.execs.find((e) => e.commands.includes("npm test -- util"))!;
    expect(ran.overlay.map((f) => f.path)).toEqual(["src/util.ts"]); // the staged edit went with the command
    expect(ran.overlay[0]!.content).toContain("^-+|-+$");
    const baseline = log.execs[0]!;
    expect(baseline.overlay).toEqual([]); // the baseline is the branch as it was
    const verify = log.execs.at(-1)!;
    expect(verify.overlay.map((f) => f.path)).toEqual(["src/util.ts"]);

    // The session was closed when the job ended, and the room holds nothing.
    await until(() => log.closes.length === 1);
    expect(log.closes[0]!.reason).toBe("job_end");
    expect(await roomOf(testEnv, made.job.id).status()).toMatchObject({ state: "empty", files: 0, session: { state: "none" } });
  });

  it("closes the session BEFORE the person is asked anything", async () => {
    const r = await agentRig();
    const log = sessionComputer(r);
    let branch = "";
    serveBranch(r, () => branch);
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("run", { cmd: "npm test", why: "look" }), call("ask_user", { question: "Trim both ends?" }));
    const w = liveWorker(r);
    const made = await start(r);
    branch = made.branch;
    await w.enqueue(made.job.id, UTIL_TASK);

    const seen = await drive(r, w, made.job.id);
    expect(seen.at(-1)).toEqual({ next: "wait", waitingOn: "answer" });
    // the runner was told to go with the reason, and the person had not been told yet at that moment
    await until(() => log.closes.length === 1);
    expect(log.closes[0]).toMatchObject({ reason: "needs_you", toldThen: 0 });
    expect(r.toldOf("needs_you")).toHaveLength(1);
    expect(await roomOf(testEnv, made.job.id).sessionInfo()).toMatchObject({ state: "closed", closeReason: "needs_you" });
    // the copy of the code stays for the answer: it is only deleted when the job ends or after six idle hours
    expect((await roomOf(testEnv, made.job.id).status()).ready).toBe(false); // (the run came before any read: no copy was needed yet)
  });

  it("shows the person's word to the next model turn, as their words, and takes it once", async () => {
    const r = await agentRig();
    sessionComputer(r);
    let branch = "";
    serveBranch(r, () => branch);
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("read_file", { path: "src/util.ts" }), call("edit_file", UTIL_EDIT), done("ok"));
    const w = liveWorker(r);
    const made = await start(r);
    branch = made.branch;
    await w.enqueue(made.job.id, UTIL_TASK);

    // Let it start work, then the person speaks.
    await drive(r, w, made.job.id, { stopAt: () => r.model.turns >= 1 });
    const said = await roomOf(testEnv, made.job.id).message("Also keep the function pure, please.", made.job.id);
    expect(said.ok).toBe(true);
    await drive(r, w, made.job.id);
    const last = r.model.seen.at(-1)!.messages;
    expect(last).toContain("The person added, while you were working");
    expect(last).toContain("Also keep the function pure, please.");
    // taken once: acknowledged after it was saved, and not shown twice
    expect(await roomOf(testEnv, made.job.id).inboxPending()).toEqual([]);
    expect(r.model.seen.filter((s) => s.messages.includes("Also keep the function pure")).length).toBeGreaterThan(0);
  });

  it("goes the old way, as a step of its own, once the job has used its session time", async () => {
    const r = await agentRig();
    const log = sessionComputer(r);
    let branch = "";
    serveBranch(r, () => branch);
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("run", { cmd: "npm test", why: "look" }), done("ok"));
    // 0.1 minutes of session time is under the least a session is given
    const w = liveWorker(r, { maxMin: 0.1 });
    const made = await start(r);
    branch = made.branch;
    await w.enqueue(made.job.id, UTIL_TASK);
    const seen = await drive(r, w, made.job.id);
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(log.placed).toBe(0);
    expect(log.hellos).toBe(0);
    expect(r.runner.runs.some((x) => x.commands.includes("npm test"))).toBe(true);
  });

  it("tells the model plainly when no computer can be found for the session, and goes on", async () => {
    const r = await agentRig({ placeWaitMs: 5_000 });
    sessionComputer(r);
    r.runner.open = false; // GitHub's computers say no; the person has no PC online
    let branch = "";
    serveBranch(r, () => branch);
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("run", { cmd: "npm test", why: "look" }), done("Could not run it."));
    const w = liveWorker(r, { placeWaitMs: 5_000 });
    const made = await start(r);
    branch = made.branch;
    await w.enqueue(made.job.id, UTIL_TASK);
    await drive(r, w, made.job.id);
    const turns = r.model.seen.map((s) => s.messages).join("\n");
    expect(turns).toMatch(/No computer was free to run that/);
    // and the session step that found no place was dropped, not left waiting
    const steps = await r.jobStore.listSteps(made.job.id);
    // (the baseline asked first, and the model's run after it: each found no place and was dropped)
    const sessions = steps.filter((x) => isSessionCommands(x.commands));
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.every((x) => x.status === "cancelled")).toBe(true);
  });
});

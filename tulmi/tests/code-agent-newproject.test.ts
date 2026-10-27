/**
 * A BRAND-NEW PROJECT THROUGH THE AGENT (src/code/agent/phases.ts newProjectPhase, docs/code-agent.md): a repo with nothing in it
 * but its README. The whole run, offline, over the rig:
 *
 *   intake       the questions the person's words do not answer, asked one at a time (needs_you), answered through the route's
 *                function, and "just start" meaning go with what you have
 *   spec, plan   the spec and PLAN.md (the stack and why, the milestones), PLAN.md committed through the workspace as the first commit
 *   scaffold     the stack's official starter emitted as a step for a runner, its changes kept and committed by the server
 *   milestone 1  then an ordinary task on a project that now has files: plan, work, checks (the stack's own, with no baseline to
 *                compare to), commit, pull request, report with the next milestones
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

const { agentRig, call, done } = await import("./agent-rig.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const SPEC = {
  name: "Yoga Booker",
  summary: "A site where yoga studios list classes and people book a place.",
  users: ["studio owners", "people who book classes"],
  platforms: ["web"],
  features: [
    { name: "Class list", description: "Show the week's classes.", priority: "must" },
    { name: "Booking", description: "Book a place in a class.", priority: "must" },
    { name: "Payments", description: "Pay for a class.", priority: "later" },
  ],
  nonGoals: ["A mobile app"],
  dataModel: [{ entity: "Class", fields: ["title", "starts_at", "places"] }],
  screens: [{ name: "Home", purpose: "The week's classes" }],
  endpoints: [],
  risks: ["Taking payments needs a processor"],
  assumptions: ["One studio to begin with"],
  needs: { auth: false, database: false, payments: false, seo: true, realtime: false, files: false, ai: false },
};

const MILESTONE_PLAN = { steps: [{ do: "Show the list of classes on the home page", files: [{ path: "src/app/page.tsx", action: "create" as const }] }], notes: [] as string[] };

/** An empty repo (a README only), and a brain that agrees it is empty. */
async function emptyRig(): Promise<Rig> {
  const r = await agentRig({
    empty: true, rows: [{ path: "README.md", lang: "Markdown", summary: "The readme." }], features: [],
    structure: { fileCount: 1, analysedCount: 1 } as never,
  });
  r.json.on("work.spec", SPEC);
  r.json.on("work.plan", MILESTONE_PLAN);
  r.runner.changesFor = (run) => (run.commands.some((c) => /create-next-app|create vite|django-admin|express|fastify/i.test(c)) && !run.wrapped
    ? [{ path: "package.json", content: '{"name":"yoga-booker","scripts":{"build":"next build","lint":"next lint","test":"vitest run"}}\n' }, { path: "src/app/layout.tsx", content: "export default function Layout() { return null; }\n" }]
    : undefined);
  return r;
}

describe("an empty repo", () => {
  it("asks what the words do not answer, one question at a time, and each answer is the person's", async () => {
    const r = await emptyRig();
    const { job } = await r.start("I want an app");
    await r.orch.idle();

    let j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "answer", agentHolder: null });
    let s = await r.stateNow(job.id);
    expect(s).toMatchObject({ phase: "new_project", repoEmpty: true, newProject: { stage: "intake" }, waiting: { kind: "question", from: "intake" } });
    expect(s.classification!.type).toBe("plan_project");
    const first = s.waiting!.kind === "question" ? s.waiting!.question : "";
    expect(first.length).toBeGreaterThan(10);
    expect(r.toldOf("needs_you")).toHaveLength(1);
    // Nothing is built, committed or run while it waits.
    expect(r.runner.runs).toHaveLength(0);
    expect(r.fake.commitCount(r.repo)).toBe(1);

    // An answer in the person's own words is kept as theirs; what it does not answer is asked next, and "just start" ends the questions.
    await r.orch.answer("alice", job.id, "A booking site for yoga studios, on the web, something like Calendly");
    await r.orch.idle();
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "answer" });
    s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "question", from: "intake", question: expect.stringContaining("What must the first version be able to do?") });
    expect(s.newProject).toMatchObject({ stage: "intake" });
    expect(r.toldOf("needs_you")).toHaveLength(2);
    expect(r.fake.commitCount(r.repo)).toBe(1);

    r.model.push(call("write_file", { path: "src/app/page.tsx", content: "export default function Home() { return <main>Classes</main>; }\n" }), done("The home page lists the classes."));
    await r.orch.answer("alice", job.id, "just start");
    await r.orch.idle();
    j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    s = await r.stateNow(job.id);
    expect(s.newProject).toMatchObject({ stage: "ready", specName: "Yoga Booker" });
    // The intake was written down in the job's work log as the person's own words.
    const log = await r.worklog.list(job.id);
    expect(log.filter((e) => e.kind === "question").map((e) => e.data?.answer)).toEqual(["A booking site for yoga studios, on the web, something like Calendly", "just start"]);
  });

  it("writes the spec and PLAN.md, commits PLAN.md first, emits the starter as a step for a runner, and builds milestone 1 as an ordinary task", async () => {
    const r = await emptyRig();
    r.model.push(call("write_file", { path: "src/app/page.tsx", content: "export default function Home() { return <main>The week's classes</main>; }\n" }), done("The home page lists the week's classes."));
    const { job, branch } = await r.start("A booking site for yoga studios, on the web, something like Calendly");
    await r.orch.idle();
    expect((await r.stateNow(job.id)).waiting).toMatchObject({ kind: "question", from: "intake" });
    await r.orch.answer("alice", job.id, "just start");
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j.reason).toBe("");
    expect(j.state).toBe("done");

    const s = await r.stateNow(job.id);
    // PLAN.md is the first commit on the branch, made by the server as Blip.
    const files = r.fake.files(r.repo, branch);
    expect(files["PLAN.md"]).toContain("Yoga Booker");
    expect(files["PLAN.md"]).toMatch(/Milestone|milestone/);
    expect(s.newProject).toMatchObject({ stage: "ready", specName: "Yoga Booker", scaffold: { status: "done" } });
    expect(s.newProject!.planSha).toBe(s.commits[0]);
    // The starter was emitted as a step: its own commands, on a runner, not a model's idea of a layout.
    const starter = r.runner.runs.find((x) => !x.wrapped && x.commands.some((c) => /create-next-app|create vite|django-admin/.test(c)));
    expect(starter, JSON.stringify(r.runner.runs.map((x) => x.commands))).toBeDefined();
    // What the starter made is in the branch, committed by the server through the policy.
    expect(files["package.json"]).toContain("yoga-booker");
    expect(files["src/app/layout.tsx"]).toBeDefined();
    // Milestone 1 is a normal task on a project that has files now: its edits are staged and committed after the checks.
    expect(s.task).toMatch(/^Milestone \d/);
    expect(s.repoEmpty).toBe(false);
    expect(s.baseline).toMatchObject({ status: "unknown" });
    expect(s.pr).toMatchObject({ number: 1 });
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    expect(s.report!.text).toContain("Next milestone");
  });
  it("asks what to do when no computer can run the starter, and goes on without it when told to skip", async () => {
    const r = await emptyRig();
    r.model.push(call("write_file", { path: "src/app/page.tsx", content: "export default function Home() { return <main>Classes</main>; }\n" }), done("The home page lists the classes."));
    r.runner.open = false;
    const { job, branch } = await r.start("A booking site for yoga studios, on the web, something like Calendly");
    await r.orch.idle();
    await r.orch.answer("alice", job.id, "just start");
    await r.orch.idle();

    // PLAN.md was committed already; the starter could not be run, so the job asks, and nothing else has happened.
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "answer" });
    let s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "question", from: "scaffold", options: ["Try again", "Skip the setup"] });
    expect(s.newProject).toMatchObject({ stage: "scaffold" });
    expect(Object.keys(r.fake.files(r.repo, branch)).sort()).toEqual(["PLAN.md", "README.md"]);
    expect(s.commits).toHaveLength(1);

    r.runner.open = true;
    await r.orch.answer("alice", job.id, "Skip the setup");
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    s = await r.stateNow(job.id);
    expect(s.newProject).toMatchObject({ stage: "ready", scaffold: { status: "skipped" } });
    expect(s.notes.join(" ")).toContain("was skipped at your request");
    expect(r.fake.files(r.repo, branch)["src/app/page.tsx"]).toContain("Classes");
    // PLAN.md was committed once: asking again did not commit it again.
    expect(s.commits).toHaveLength(2);
  });
});

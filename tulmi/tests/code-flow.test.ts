process.env.OPENROUTER_API_KEY ??= "k";
process.env.OPENAI_API_KEY ??= "k";
process.env.GROQ_API_KEY ??= "k";
process.env.NODE_ENV = "test";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { MemoryThreadStore } from "../src/code/chat/threads.js";
import { gateOf, visionOf } from "../src/code/flow/gate.js";
import { keepPlan, openingPlan, planTask, type ProjectPlan } from "../src/code/flow/plan.js";
import { approvedNote, jobNote, triage } from "../src/code/flow/triage.js";
import { fakeCall } from "./work-fixtures.js";

// THE XODE FLOW (src/code/flow, routes/bots/botsXode.ts): read and hear the direction first, agree a plan, approve it, and judge every
// message sent during the work against the plan: only a change to the plan waits for a yes, and only the part it touches.

const ME = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => (h === `Bearer ${ME}` ? { id: ME, email: "aanya@example.in" } : null) };
});
const { registerXodeFlowRoutes } = await import("../src/routes/bots/botsXode.js");

const ctx = (call = fakeCall()) => ({ f: call, m: { userId: ME, budget: { maxPaise: 300 }, call: call.call } });
const PLAN: ProjectPlan = {
  v: 1, goal: "Add a results page for students", state: "A school site with login and a marks table.", direction: "Make results easy to check on phones.",
  suggested: false, steps: ["Add a results route", "Build the results page", "Link it from the dashboard", "Test it on a phone"], status: "proposed", at: 1,
};

describe("the gate: no chat until the project is read and the owner said where it goes", () => {
  it("opens only when both are done; a skipped vision counts, a stale brain counts as read", () => {
    expect(gateOf({ status: "building", progress: { pct: 42, phase: "reading each file" } }, null)).toEqual({ open: false, reading: { status: "building", pct: 42, phase: "reading each file" }, vision: "missing" });
    expect(gateOf({ status: "building", progress: { pct: 42 } }, { vision: "Results on phones", at: 1 }).open).toBe(false);
    expect(gateOf({ status: "ready" }, null).open).toBe(false);
    expect(gateOf({ status: "ready" }, { vision: "Results on phones", at: 1 })).toMatchObject({ open: true, vision: "given", reading: { pct: 100 } });
    expect(gateOf({ status: "stale" }, { skipped: true, at: 1 })).toMatchObject({ open: true, vision: "skipped" });
    expect(gateOf({ status: "failed" }, { vision: "x", at: 1 })).toMatchObject({ open: false, reading: { status: "failed" } });
    expect(visionOf({ for: "Teachers", at: 1 })).toBe("given");
  });
});

describe("the plan", () => {
  it("opens with where it stands, where it heads (the owner's words), the next piece and its steps", async () => {
    const { f, m } = ctx();
    f.on("flow.plan.open", { state: "A school site with login and a marks table.", direction: "Make results easy to check on phones.", suggested: false, goal: "Add a results page for students", steps: ["Add a results route", "Build the results page", "Link it from the dashboard"] });
    const p = await openingPlan(m, { name: "school-site", known: "## How it stands\n- Next.js app", owner: { vision: "Results on phones, fast" } }, 5);
    expect(p).toMatchObject({ v: 1, status: "proposed", suggested: false, goal: "Add a results page for students", at: 5 });
    expect(f.of("flow.plan.open")[0]!.user).toContain("Vision: Results on phones, fast");
    expect(f.of("flow.plan.open")[0]!.tier).toBe("cheap");
  });
  it("with no direction from the owner, Xode's own is marked a suggestion", async () => {
    const { f, m } = ctx();
    f.on("flow.plan.open", { state: "A site.", direction: "Tidy the sign-in first.", suggested: false, goal: "Tidy sign-in", steps: ["One"] });
    expect((await openingPlan(m, { name: "x", known: "", owner: null })).suggested).toBe(true);
  });
  it("a question leaves it as it is; asking for more work makes a new version that needs a new yes", async () => {
    const { f, m } = ctx();
    f.on("flow.plan.keep", (i) => (String(i.messages.at(-1)?.content).includes("dark mode")
      ? { kind: "revise", goal: "Add a results page, in dark mode too", steps: [...PLAN.steps, "Add dark mode to it"], change: "Added dark mode" }
      : { kind: "same" }));
    expect(await keepPlan(m, { plan: PLAN, message: "how long will it take?", answer: "About an hour." })).toEqual({ plan: PLAN, changed: false });
    const r = await keepPlan(m, { plan: { ...PLAN, status: "approved" }, message: "also make it dark mode", answer: "Sure." }, 9);
    expect(r.changed).toBe(true);
    expect(r.plan).toMatchObject({ v: 2, status: "proposed", change: "Added dark mode", at: 9 });
    expect(r.plan.steps.at(-1)).toBe("Add dark mode to it");
  });
  it("becomes the job's task: the goal, the approved steps in order, what must not change", () => {
    const t = planTask(PLAN, { keep: "The login page" });
    expect(t.split("\n")[0]).toBe("Add a results page for students");
    expect(t).toContain("1. Add a results route");
    expect(t).toContain("Must not change: The login page");
  });
});

describe("judging a message sent during the work", () => {
  const judge = (out: unknown, message: string, picture?: string) => {
    const { f, m } = ctx();
    f.on("flow.triage", out);
    return triage(m, { plan: PLAN, doing: "Working · step 2", message, ...(picture ? { picture } : {}) }, 7).then((t) => ({ t, f }));
  };
  it("a question is answered and the work goes on", async () => {
    const { t } = await judge({ kind: "question", affects: [], say: "It's on step 2: building the page." }, "where are you now?");
    expect(t).toMatchObject({ kind: "question", say: "It's on step 2: building the page.", affects: [] });
    expect(jobNote(t, "where are you now?")).toBeNull();
    // A picture always reaches the job, even with a question about it.
    expect(jobNote(t, "what does this mean?", "A screenshot of an App Store review")).toContain("They sent a picture with it");
  });
  it("a detail that fits (a colour, a picture to follow) goes to the job, nothing waits", async () => {
    const { t, f } = await judge({ kind: "addon", affects: [], say: "Got it: the school's blue." }, "use our school blue #1F4FA0", "A screenshot of the school logo, blue and white.");
    expect(t.kind).toBe("addon");
    expect(f.of("flow.triage")[0]!.user).toContain("A screenshot of the school logo");
    expect(jobNote(t, "use our school blue #1F4FA0", "A screenshot of the school logo")).toContain("They sent a picture with it");
  });
  it("a change to the plan makes its next version; only the steps it touches wait", async () => {
    const { t } = await judge({ kind: "change", affects: [3], say: "I'll put it in the menu instead. Approve the new plan?", goal: PLAN.goal, steps: ["Add a results route", "Build the results page", "Put it in the main menu", "Test it on a phone"], change: "Menu instead of the dashboard" }, "don't link it from the dashboard, put it in the menu");
    expect(t).toMatchObject({ kind: "change", affects: [3], plan: { v: 2, status: "proposed", change: "Menu instead of the dashboard" } });
    expect(jobNote(t, "x")).toContain("Hold off on that step until they approve the new plan; carry on with the others.");
    expect(approvedNote(t.plan!)).toContain("The person approved version 2 of the plan");
  });
  it("a change that only rewords one step is a detail: passed on, nothing waits", async () => {
    const { t } = await judge({ kind: "change", affects: [2], say: "Theek hai, text chhota kar denge.", goal: PLAN.goal, steps: ["Add a results route", "Build the results page with smaller text", "Link it from the dashboard", "Test it on a phone"] }, "text thoda chhota karo");
    expect(t).toMatchObject({ kind: "addon", affects: [] });
    expect(t.plan).toBeUndefined();
  });
  it("a change with no new plan is said back to, and never reaches the job (it would start on it unasked)", async () => {
    for (const out of [{ kind: "change", affects: [2], say: "That's new work: let's plan it once this is done." }, { kind: "change", affects: [], say: "Later.", goal: PLAN.goal, steps: PLAN.steps }]) {
      const { t } = await judge(out, "also redo the whole Google sign-in");
      expect(t).toMatchObject({ kind: "note", affects: [] });
      expect(jobNote(t, "also redo the whole Google sign-in")).toBeNull();
    }
  });
  it("a model that cannot answer passes the words on rather than dropping them", async () => {
    const { f, m } = ctx();
    f.down = true;
    expect((await triage(m, { plan: PLAN, doing: "x", message: "use blue" })).kind).toBe("addon");
  });
});

// ------------------------------------------------------------------ the routes, end to end, over stand-ins for the routes they build on

interface Rig { app: FastifyInstance; f: ReturnType<typeof fakeCall>; threads: MemoryThreadStore; brain: { status: string; pct: number; owner: Record<string, unknown> | null }; jobs: Array<{ id: string; task: string; planFirst: unknown; messages: string[]; state: string }>; asks: Array<Record<string, unknown>>; builds: string[] }

async function rig(): Promise<Rig> {
  const app = Fastify();
  const f = fakeCall();
  const threads = new MemoryThreadStore();
  const r: Omit<Rig, "app"> = { f, threads, brain: { status: "building", pct: 30, owner: null }, jobs: [], asks: [], builds: [] };
  // The routes the flow builds on, as the server has them.
  app.get(`/v1/code/projects/:id/brain`, async () => ({ status: r.brain.status, progress: { pct: r.brain.pct, phase: "reading each file" }, ...(r.brain.owner ? { owner: r.brain.owner } : {}) }));
  app.get(`/v1/code/projects/:id/book`, async (_q, reply) => (r.brain.status === "ready" ? { book: { version: 1, project: "school-site", commit: "c", builtAt: 1, facts: [], gaps: [], questions: [] } } : reply.code(409).send({ code: "brain_not_ready" })));
  app.post(`/v1/code/projects/:id/book`, async (q) => { r.brain.owner = { ...(r.brain.owner ?? {}), ...((q.body as { answers: Record<string, unknown> }).answers), at: 1 }; return { ok: true }; });
  app.post(`/v1/code/projects/:id/branches`, async () => ({ branch: "x0/results-page" }));
  app.post("/v1/code/jobs", async (q) => { const b = q.body as { task: string; planFirst: unknown }; r.jobs.push({ id: JOB, task: b.task, planFirst: b.planFirst, messages: [], state: "running" }); return { job: { id: JOB } }; });
  app.get(`/v1/code/jobs/:id`, async () => ({ job: { id: JOB, projectId: PROJECT, branch: "x0/results-page", task: r.jobs[0]?.task ?? "", state: r.jobs[0]?.state ?? "running" }, agent: { phase: "work" } }));
  app.post(`/v1/code/jobs/:id/message`, async (q) => { r.jobs[0]!.messages.push((q.body as { text: string }).text); return { ok: true }; });
  app.post("/v1/ask", async (q) => {
    const b = q.body as Record<string, unknown>;
    r.asks.push(b);
    return b.attachments ? { result: { text: "A screenshot of an App Store review: Guideline 4, sign in with Apple." } } : { result: { text: "Here's a mockup.", artifacts: [{ id: "art-1" }] } };
  });
  app.post(`/v1/artifacts/:id/build`, async (q) => { r.builds.push((q.params as { id: string }).id); r.jobs.push({ id: JOB, task: "build the design", planFirst: undefined, messages: [], state: "running" }); return { job: { id: JOB, branch: "x0/design" } }; });
  registerXodeFlowRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots: null, code: { store: { getProject: async () => ({ id: PROJECT, fullName: "aanya/school-site" }) } } as never, jobs: null, connectors: null, media: null, artifacts: null }, {
    call: f.call, threads, now: () => 1_000,
    answer: async (a) => ({ text: a.text.includes("long") ? "About an hour of work." : "Sure, I can do that.", next: [] }),
  });
  await app.ready();
  return { app, ...r };
}
const as = { authorization: `Bearer ${ME}` };
const get = (app: FastifyInstance, url: string) => app.inject({ method: "GET", url, headers: as }).then((x) => ({ status: x.statusCode, body: x.json() }));
const post = (app: FastifyInstance, url: string, payload: unknown) => app.inject({ method: "POST", url, headers: as, payload: payload as object }).then((x) => ({ status: x.statusCode, body: x.json() }));
const F = `/v1/bots/code/flow/${PROJECT}`;

describe("the flow's routes", () => {
  it("the chat stays shut while it reads; the owner's vision saved while it reads; then the opening plan, once", async () => {
    const s = await rig();
    expect((await get(s.app, `${F}/plan?thread=${THREAD}`)).body).toMatchObject({ gate: { open: false, reading: { pct: 30 }, vision: "missing" }, plan: null });
    expect((await post(s.app, `${F}/vision`, {})).status).toBe(400);
    expect((await post(s.app, `${F}/vision`, { vision: "Students check results on their phones", keep: "The login page" })).body).toMatchObject({ saved: "given", gate: { open: false, vision: "given" } });
    s.brain.status = "ready";
    s.f.on("flow.plan.open", { state: "A school site.", direction: "Results on phones.", suggested: false, goal: "Add a results page", steps: ["Route", "Page", "Link"] });
    const first = await get(s.app, `${F}/plan?thread=${THREAD}`);
    expect(first.body).toMatchObject({ gate: { open: true }, plan: { v: 1, status: "proposed", goal: "Add a results page" } });
    await get(s.app, `${F}/plan?thread=${THREAD}`);
    expect(s.f.of("flow.plan.open")).toHaveLength(1);
  });

  it("talks it over: a question keeps the plan, more work revises it, a mockup is kept with it; then one yes starts the work, no second approval", async () => {
    const s = await rig();
    Object.assign(s.brain, { status: "ready", pct: 100, owner: { skipped: true, at: 1 } });
    s.f.on("flow.plan.open", { state: "A school site.", direction: "Results on phones.", suggested: true, goal: "Add a results page", steps: ["Route", "Page"] });
    s.f.on("flow.plan.keep", (i) => (String(i.messages.at(-1)?.content).includes("export") ? { kind: "revise", goal: "Add a results page with export", steps: ["Route", "Page", "Export to PDF"], change: "Added PDF export" } : { kind: "same" }));
    await get(s.app, `${F}/plan?thread=${THREAD}`);
    const q = await post(s.app, `${F}/say`, { thread: THREAD, text: "how long will it take?" });
    expect(q.body).toMatchObject({ answer: "About an hour of work.", changed: false, plan: { v: 1 } });
    const more = await post(s.app, `${F}/say`, { thread: THREAD, text: "add an export to PDF too" });
    expect(more.body).toMatchObject({ changed: true, plan: { v: 2, change: "Added PDF export" } });
    // The old version can't be approved any more.
    expect((await post(s.app, `${F}/approve`, { thread: THREAD, v: 1 })).status).toBe(409);
    const go = await post(s.app, `${F}/approve`, { thread: THREAD, v: 2 });
    expect(go.body).toMatchObject({ plan: { v: 2, status: "working", jobId: JOB } });
    expect(s.jobs[0]!.planFirst).toBe(false);
    expect(s.jobs[0]!.task).toContain("3. Export to PDF");
  });

  it("asked for a mockup first: it is made in the project's look, and the plan's yes builds from it", async () => {
    const s = await rig();
    Object.assign(s.brain, { status: "ready", pct: 100, owner: { vision: "Results on phones", at: 1 } });
    s.f.on("flow.plan.open", { state: "A school site.", direction: "Results on phones.", suggested: false, goal: "Add a results page", steps: ["Route", "Page"] });
    s.f.on("flow.plan.keep", { kind: "same" });
    await get(s.app, `${F}/plan?thread=${THREAD}`);
    const m = await post(s.app, `${F}/say`, { thread: THREAD, text: "show me a mockup of the results page first" });
    expect(m.body).toMatchObject({ mockup: "art-1", plan: { mockup: "art-1" } });
    expect(String(s.asks[0]!.message)).toContain("only to look at");
    await post(s.app, `${F}/approve`, { thread: THREAD, v: 1 });
    expect(s.builds).toEqual(["art-1"]);
    expect(s.jobs[0]!.messages[0]).toContain("The plan the owner approved");
  });

  it("during the work: a picture is read and passed on; a change waits for a yes (only its step); the yes tells the same job", async () => {
    const s = await rig();
    Object.assign(s.brain, { status: "ready", pct: 100, owner: { vision: "v", at: 1 } });
    s.f.on("flow.plan.open", { state: "A school site.", direction: "Results on phones.", suggested: false, goal: "Fix sign in with Apple", steps: ["Remove the name step", "Add the later card", "Test"] });
    await get(s.app, `${F}/plan?thread=${THREAD}`);
    await post(s.app, `${F}/approve`, { thread: THREAD, v: 1 });
    // Nothing to judge until work runs: here it does.
    s.f.on("flow.triage", (i) => {
      const u = String(i.messages.at(-1)?.content);
      if (u.includes("App Store review")) return { kind: "addon", affects: [], say: "Got it: I'll follow the reviewer's note." };
      if (u.includes("drop the card")) return { kind: "change", affects: [2], say: "I'll drop the card. Approve the new plan?", goal: "Fix sign in with Apple", steps: ["Remove the name step", "Test"], change: "No later card" };
      return { kind: "question", affects: [], say: "On step 1." };
    });
    const pic = await post(s.app, `${F}/work`, { thread: THREAD, text: "this is what apple said", attachments: [{ id: "f-1", name: "review.png", mime: "image/png" }] });
    expect(pic.body).toMatchObject({ kind: "addon" });
    expect(s.jobs[0]!.messages.at(-1)).toContain("They sent a picture with it. What it shows: A screenshot of an App Store review");
    const q = await post(s.app, `${F}/work`, { thread: THREAD, text: "where are you?" });
    expect(q.body).toMatchObject({ kind: "question", say: "On step 1." });
    const before = s.jobs[0]!.messages.length;
    expect(s.jobs[0]!.messages).toHaveLength(before);
    const ch = await post(s.app, `${F}/work`, { thread: THREAD, text: "drop the card idea" });
    expect(ch.body).toMatchObject({ kind: "change", affects: [2], plan: { v: 2, status: "proposed", jobId: JOB } });
    expect(s.jobs[0]!.messages.at(-1)).toContain("Hold off on that step");
    const yes = await post(s.app, `${F}/approve`, { thread: THREAD, v: 2 });
    expect(yes.body).toMatchObject({ plan: { v: 2, status: "working", jobId: JOB } });
    expect(s.jobs).toHaveLength(1);
    expect(s.jobs[0]!.messages.at(-1)).toContain("The person approved version 2 of the plan (No later card)");
  });

  it("asked for a mockup mid-work: made beside the work, which goes on; asked to stop: confirmed, never done on a guess", async () => {
    const s = await rig();
    Object.assign(s.brain, { status: "ready", pct: 100, owner: { vision: "v", at: 1 } });
    s.f.on("flow.plan.open", { state: "A school site.", direction: "Results on phones.", suggested: false, goal: "Add a menu", steps: ["Make the menu", "Test it"] });
    await get(s.app, `${F}/plan?thread=${THREAD}`);
    await post(s.app, `${F}/approve`, { thread: THREAD, v: 1 });
    s.f.on("flow.triage", (i) => (String(i.messages.at(-1)?.content).includes("stop") ? { kind: "stop", affects: [], say: "Stop the work?" } : { kind: "mockup", affects: [], say: "Making a mockup." }));
    expect((await post(s.app, `${F}/work`, { thread: THREAD, text: "show me how the menu will look" })).body).toMatchObject({ kind: "mockup", artifact: "art-1" });
    expect((await post(s.app, `${F}/work`, { thread: THREAD, text: "stop everything" })).body).toMatchObject({ kind: "stop", stop: JOB });
    expect(s.jobs[0]!.state).toBe("running");
    // When the work has ended the chat plans the next piece; nothing is judged against finished work.
    s.jobs[0]!.state = "done";
    expect((await post(s.app, `${F}/work`, { thread: THREAD, text: "hi" })).status).toBe(409);
    expect((await get(s.app, `${F}/plan?thread=${THREAD}`)).body).toMatchObject({ plan: { status: "done" } });
  });

  it("someone else's request gets nothing", async () => {
    const s = await rig();
    expect((await s.app.inject({ method: "GET", url: `${F}/gate` })).statusCode).toBe(401);
  });
});

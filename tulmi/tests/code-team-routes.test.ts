/**
 * THE TEAM'S ROUTES AND THE PERSON'S WORD (src/routes/codeJobs.ts, src/code/agent/orchestrator.ts, docs/code-team.md sections 7 and 8): the team of a lead job, stopping one part,
 * running one again, the project's setting, a goal that is asked for or refused in words, and the stream's team board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

const { teamRig, call, done, edit, buildScript, settle, goodSplit, allGood, OVER, run, bigPlan } = await import("./team-rig.js");
const { resetSettingsStoreForTests, settingsStore } = await import("../src/code/agent/settings.js");
const { resetRewindStoreForTests } = await import("../src/code/agent/rewind.js");
const { resetConfigForTests } = await import("../src/config.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { createWorkBranch } = await import("../src/code/projects.js");
type Rig = Awaited<ReturnType<typeof teamRig>>;

beforeEach(() => { resetSettingsStoreForTests(); resetRewindStoreForTests(); });
afterEach(() => { delete process.env.CODE_TEAM_PARALLEL; resetConfigForTests(); });

const apps: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });
async function server(r: Rig) {
  const app = Fastify();
  apps.push(app);
  registerCodeJobRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, code: r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0, agent: r.lead });
  await app.ready();
  return (user: string | null, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: { authorization: `Bearer ${user}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
}

describe("GET /v1/code/jobs/:id/team", () => {
  it("shows a lead's team to its owner: why, the money, each part with its files, branch, review, fix rounds and cost, and every helper job", async () => {
    const r = await teamRig();
    allGood(r);
    const req = await server(r);
    const { job } = await r.startLead();
    await run(r, job.id);
    const res = await req("alice", "GET", `/v1/code/jobs/${job.id}/team`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job).toMatchObject({ id: job.id, state: "done" });
    expect(body.team).toMatchObject({ stage: "final", why: "files", parallel: 3 });
    expect(body.team.reason).toContain("more than 12");
    expect(body.team.budget.reservePaise).toBe(4000);
    expect(body.team.budget.poolPaise).toBeGreaterThan(14_000);
    expect(body.team.parts.map((p: { id: number; status: string }) => [p.id, p.status])).toEqual([[0, "merged"], [1, "merged"], [2, "merged"], [3, "merged"], [4, "merged"]]);
    const p1 = body.team.parts[1];
    expect(p1).toMatchObject({ title: "Export API", kind: "files", ownedPaths: ["src/api/**"], dependsOn: [0], fixRounds: 0 });
    expect(p1.branch).toMatch(/-p1$/);
    expect(p1.review).toMatchObject({ verdict: "pass", family: "anthropic", writerFamily: "z-ai", findings: 0, blockers: 0 });
    expect(p1.spentPaise).toBeGreaterThan(0);
    expect(p1.jobIds).toHaveLength(1);
    expect(body.children).toHaveLength(4);
    expect(body.children[0]).toMatchObject({ part: 1, state: "done" });
    expect(body.children.every((c: { spentPaise: number; budgetPaise: number }) => c.spentPaise > 0 && c.budgetPaise > c.spentPaise)).toBe(true);
    // No code in it: the team is words and numbers.
    expect(JSON.stringify(body)).not.toContain("export const");
  });

  it("is the owner's only, and 404 for a job that leads no team", async () => {
    const r = await teamRig();
    allGood(r);
    const req = await server(r);
    const { job } = await r.startLead();
    await run(r, job.id);
    expect((await req("bob", "GET", `/v1/code/jobs/${job.id}/team`)).statusCode).toBe(404);
    expect((await req(null, "GET", `/v1/code/jobs/${job.id}/team`)).statusCode).toBe(401);
    const helper = (await r.helpers(job.id))[0]!;
    const res = await req("alice", "GET", `/v1/code/jobs/${helper.id}/team`);
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toContain("not leading a team");
    // The lead's and the helper's job views say what they are.
    const lead = (await req("alice", "GET", `/v1/code/jobs/${job.id}`)).json();
    expect(lead.agent.team).toMatchObject({ stage: "final", why: "files" });
    expect(lead.agent.team.parts).toHaveLength(5);
    const h = (await req("alice", "GET", `/v1/code/jobs/${helper.id}`)).json();
    expect(h.agent.part).toMatchObject({ parentId: job.id, id: helper.state.part!.id });
  });
});

describe("stopping a part and running it again", () => {
  /** A team whose second part waits for the person (it asks a question), so the lead is alive when the person acts. */
  async function waiting(r: Rig) {
    allGood(r);
    r.scripts.set("p2", [call("ask_user", { question: "Which button style?", options: ["Primary", "Quiet"] }), ...buildScript(["src/web/NotePage.tsx", "src/web/NotePage.test.tsx", "src/web/api.ts"], "Added the export button.")]);
    const started = await r.startLead();
    await settle(r, async () => (await r.stateNow(started.job.id)).team?.parts.find((p) => p.id === 2)?.status === "blocked" && (await r.stateNow(started.job.id)).team!.parts.filter((p) => p.status === "merged").length === 4);
    return started;
  }

  it("stops one part: its helper is stopped, the lead leaves it out, and the pull request is a draft that says so", async () => {
    const r = await teamRig();
    const req = await server(r);
    const { job, branch } = await waiting(r);
    const before = await req("alice", "GET", `/v1/code/jobs/${job.id}/team`);
    const p2 = before.json().team.parts[2];
    expect(p2.status).toBe("blocked");
    expect(before.json().children.find((c: { part: number }) => c.part === 2)).toMatchObject({ state: "waiting_for_you", waitingOn: "answer" });
    const res = await req("alice", "POST", `/v1/code/jobs/${job.id}/team/parts/2/stop`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ queued: true, part: { id: 2 } });
    // The helper is stopped now, not at the lead's next look.
    expect((await r.jobNow(p2.jobId)).state).toBe("cancelled");
    await settle(r, async () => OVER.includes((await r.jobNow(job.id)).state));
    const s = await r.stateNow(job.id);
    expect((await r.jobNow(job.id)).state, s.report?.text).toBe("done");
    const part = s.team!.parts.find((p) => p.id === 2)!;
    expect(part).toMatchObject({ status: "stopped", reason: "You stopped it." });
    expect(r.fake.files(r.repo, branch)["src/web/NotePage.tsx"]).toBe('export const page = "v0";\n');
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
    expect(s.report!.text).toContain("Part 2, Note page: stopped");
    // The money of the part came back.
    expect(part.refundedPaise + part.spentPaise).toBe(part.reservedPaise);
  });

  it("refuses a stop of a part that is over, a rerun of one that is not, a part that is not there, and anyone else's word", async () => {
    const r = await teamRig();
    const req = await server(r);
    const { job } = await waiting(r);
    const url = (k: number | string, op: string) => `/v1/code/jobs/${job.id}/team/parts/${k}/${op}`;
    expect((await req("alice", "POST", url(1, "stop"))).json()).toMatchObject({ code: "part_over" });
    expect((await req("alice", "POST", url(2, "rerun"))).json()).toMatchObject({ code: "part_not_over" });
    expect((await req("alice", "POST", url(9, "stop"))).statusCode).toBe(404);
    expect((await req("alice", "POST", url("x", "stop"))).statusCode).toBe(400);
    expect((await req("alice", "POST", url(0, "stop"))).statusCode).toBe(400);
    expect((await req("alice", "POST", url(2, "rerun"), { addPaise: -5 })).statusCode).toBe(400);
    expect((await req("bob", "POST", url(2, "stop"))).statusCode).toBe(404);
    expect((await req(null, "POST", url(2, "stop"))).statusCode).toBe(401);
    expect((await req("alice", "POST", url(2, "rerun"), { addPaise: 1.5 })).statusCode).toBe(400);
  });

  it("runs a part that failed again, with the money it had left, once the others are going: the new job builds it and the lead merges it", async () => {
    process.env.CODE_TEAM_PARALLEL = "1";
    resetConfigForTests();
    const r = await teamRig();
    allGood(r);
    const req = await server(r);
    // Part 1's helper has no script: its model never answers, so the job fails (three errors in a row), and it is the first to start.
    r.scripts.delete("p1");
    r.scripts.set("p1.try1", buildScript(["src/api/notes.ts", "src/api/notes.test.ts", "src/api/routes.ts"], "Built the export endpoint, second try."));
    // The second part asks the person something, so the lead is still alive when part 1 has failed.
    r.scripts.set("p2", [call("ask_user", { question: "Which button style?" }), ...buildScript(["src/web/NotePage.tsx", "src/web/NotePage.test.tsx", "src/web/api.ts"], "Added the export button.")]);
    const { job } = await r.startLead();
    await settle(r, async () => {
      const t = (await r.stateNow(job.id)).team;
      return t?.parts.find((p) => p.id === 1)?.status === "failed" && t.parts.find((p) => p.id === 2)?.status === "blocked";
    });
    const failed = (await r.stateNow(job.id)).team!.parts.find((p) => p.id === 1)!;
    expect(failed.reason).toContain("Something went wrong on X0 Bot's side three times running");
    const res = await req("alice", "POST", `/v1/code/jobs/${job.id}/team/parts/1/rerun`, {});
    expect(res.statusCode, res.body).toBe(200);
    // The person answers the page's question; the lead goes on, and runs part 1 again once there is room.
    const p2job = (await r.stateNow(job.id)).team!.parts.find((p) => p.id === 2)!.jobId!;
    await r.lead.answer("alice", p2job, "Primary");
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    const p1 = s.team!.parts.find((p) => p.id === 1)!;
    expect(p1.status).toBe("merged");
    expect(p1.attempts).toBe(1);
    expect(p1.jobIds).toHaveLength(2);
    expect(p1.jobIds[0]).not.toBe(p1.jobIds[1]);
    // The same branch: the new job went on from where the failed one was.
    const hs = (await r.helpers(job.id)).filter((h) => h.state.part!.id === 1);
    expect(new Set(hs.map((h) => h.branch)).size).toBe(1);
    expect(hs.map((h) => h.state.part!.attempt ?? 0).sort()).toEqual([0, 1]);
    expect(s.team!.parts.every((p) => p.status === "merged")).toBe(true);
    // The money: a part is paid for once, however many tries.
    for (const p of s.team!.parts.filter((x) => x.id > 0)) expect(p.refundedPaise + p.spentPaise, `part ${p.id}`).toBe(p.reservedPaise);
  });

  it("brings a skipped part back when the part it waited for is run again", async () => {
    process.env.CODE_TEAM_PARALLEL = "1";
    resetConfigForTests();
    const r = await teamRig();
    allGood(r);
    const req = await server(r);
    const split = goodSplit();
    split.parts[2]!.dependsOn = [0, 1];
    r.json.on("team.split", split);
    r.scripts.delete("p1");
    r.scripts.set("p1.try1", buildScript(["src/api/notes.ts", "src/api/notes.test.ts", "src/api/routes.ts"], "Second try."));
    // Part 3 (the mail) asks a question, so the lead is alive after part 1 failed and part 2 was skipped.
    r.scripts.set("p3", [call("ask_user", { question: "Which sender?" }), ...buildScript(["src/mail/send.ts", "src/mail/send.test.ts"], "Mail.")]);
    const { job } = await r.startLead();
    await settle(r, async () => {
      const t = (await r.stateNow(job.id)).team;
      return t?.parts.find((p) => p.id === 1)?.status === "failed" && t.parts.find((p) => p.id === 2)?.status === "skipped" && t.parts.find((p) => p.id === 3)?.status === "blocked";
    });
    expect((await req("alice", "POST", `/v1/code/jobs/${job.id}/team/parts/1/rerun`, {})).statusCode).toBe(200);
    await r.lead.answer("alice", (await r.stateNow(job.id)).team!.parts.find((p) => p.id === 3)!.jobId!, "The default one");
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(s.team!.parts.map((p) => p.status)).toEqual(["merged", "merged", "merged", "merged", "merged"]);
  });
});

describe("making a lead job through the routes", () => {
  it("takes team and projects, refuses a team that is not one, and a project that is not the person's", async () => {
    const r = await teamRig();
    const req = await server(r);
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, "Do a big thing");
    const body = { projectId: r.project.id, branch, task: "Do a big thing" };
    expect((await req("alice", "POST", "/v1/code/jobs", { ...body, team: "sometimes" })).statusCode).toBe(400);
    expect((await req("alice", "POST", "/v1/code/jobs", { ...body, team: "off", projects: ["00000000-0000-4000-8000-000000000000"] })).statusCode).toBe(404);
    expect((await req("alice", "POST", "/v1/code/jobs", { ...body, team: "off", projects: "web" })).statusCode).toBe(400);
    r.scripts.set("lead", [done("Just did it.")]);
    const made = await req("alice", "POST", "/v1/code/jobs", { ...body, team: "off" });
    expect(made.statusCode, made.body).toBe(200);
    const id = made.json().job.id;
    await r.lead.idle();
    expect((await r.stateNow(id)).teamMode).toBe("off");
  });
});

describe("the project's setting", () => {
  it("is auto until the person says, takes on and off, refuses anything else, and is used by the next job and beaten by a job's own word", async () => {
    const r = await teamRig();
    const req = await server(r);
    const url = `/v1/code/projects/${r.project.id}/settings`;
    expect((await req("alice", "GET", url)).json().settings).toEqual({ mode: "guided", planFirst: false, team: "auto" });
    expect((await req("alice", "PUT", url, { team: "sometimes" })).statusCode).toBe(400);
    expect((await req("alice", "PUT", url, { team: "off" })).json().settings).toEqual({ mode: "guided", planFirst: false, team: "off" });
    expect((await req("bob", "GET", url)).statusCode).toBe(404);
    // A big plan, and the project says off: one job.
    r.scripts.set("lead", [done("Did it myself.")]);
    const a = await r.startLead();
    await r.lead.idle();
    expect((await r.stateNow(a.job.id)).team).toBeUndefined();
    expect((await r.stateNow(a.job.id)).teamMode).toBe("off");
    // The job's own word beats the project's.
    allGood(r);
    const b = await r.startLead(undefined, { team: "auto" });
    const { s } = await run(r, b.job.id);
    expect(s.team?.stage).toBe("final");
    // And "on" in the project makes a small plan a team's.
    await req("alice", "PUT", url, { team: "on" });
    expect((await req("alice", "GET", url)).json().settings.team).toBe("on");
    expect((await settingsStore().get(r.project.id))!.team).toBe("on");
  });
});

describe("a lead that cannot split", () => {
  it("does the work itself as one job when the parts overlap three times running, and says so", async () => {
    const r = await teamRig();
    r.json.on("team.split", { parts: [
      { id: 1, title: "A", goal: "Do a.", ownedPaths: ["src/api/", "src/web/"], dependsOn: [] },
      { id: 2, title: "B", goal: "Do b.", ownedPaths: ["src/web/", "src/mail/"], dependsOn: [] },
    ] });
    r.json.on("work.plan", bigPlan());
    r.scripts.set("lead", [...bigPlan().steps.flatMap((s) => s.files).filter((f) => f.path !== "src/types/note.ts").map((f) => edit(f.path, "v1")), done("Did all fourteen myself.")]);
    const { job } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(s.team).toBeUndefined();
    expect(s.teamMode).toBe("off");
    expect(r.json.of("team.split")).toHaveLength(3);
    expect(s.notes.join(" ")).toContain("could not divide this into parts that do not overlap");
    expect((await r.helpers(job.id))).toHaveLength(0);
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    expect(r.fake.pulls(r.repo)[0]!.body).not.toContain("## The team");
  });
});

describe("the stream's team board", () => {
  it("shows the parts with their status as they change, to a watcher, and nothing of the code", async () => {
    const events: Array<{ jobId: string; ev: { t: string; parts?: Array<{ id: number; status: string; title: string }> } }> = [];
    const r = await teamRig({ live: { progress: (jobId: string, ev: never) => { events.push({ jobId, ev }); } } as never });
    allGood(r);
    const { job } = await r.startLead();
    await run(r, job.id);
    const boards = events.filter((e) => e.jobId === job.id && e.ev.t === "team").map((e) => e.ev.parts!);
    expect(boards.length).toBeGreaterThan(5);
    // The first board has every part waiting (or part 0 running), the last has them all merged.
    expect(boards[0]!.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
    expect(boards.at(-1)!.map((p) => p.status)).toEqual(["merged", "merged", "merged", "merged", "merged"]);
    const seen = new Set(boards.flatMap((b) => b.map((p) => p.status)));
    for (const st of ["running", "reviewing", "merged"]) expect(seen.has(st), st).toBe(true);
    expect(JSON.stringify(boards)).not.toContain("export const");
    expect(boards.at(-1)![1]).toMatchObject({ title: "Export API", spentPaise: expect.any(Number), budgetPaise: expect.any(Number) });
  });
});

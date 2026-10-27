/**
 * A GOAL OVER SEVERAL PROJECTS (src/code/team, docs/code-team.md section 6): one lead job spans several of the person's projects, each project's share is its own part (built by that
 * project's own lead, with its own plan, helpers and checks), there is one pull request for each project, and each points at the others.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { teamRig, call, done, edit, buildScript, run, TEAM_FILES } = await import("./team-rig.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
const { resetRewindStoreForTests } = await import("../src/code/agent/rewind.js");
const { addProject } = await import("../src/code/projects.js");
const { LINKS_OPEN, LINKS_CLOSE, linkPulls } = await import("../src/code/team/report.js");
type Rig = Awaited<ReturnType<typeof teamRig>>;

beforeEach(() => { resetSettingsStoreForTests(); resetRewindStoreForTests(); });

const WEB_FILES: Record<string, string> = {
  "README.md": "# web\n",
  "package.json": JSON.stringify({ name: "web", scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } }, null, 2),
  "src/web/api.ts": TEAM_FILES["src/web/api.ts"]!,
  "src/web/NotePage.tsx": TEAM_FILES["src/web/NotePage.tsx"]!,
};
const TASK = "Let people export a note as a PDF: the API builds it (alice/app, src/api/notes.ts) and the web client asks for it (alice/web, src/web/api.ts).";

/** A second project of alice's: another repo, her own, with the permission to mark its pull requests ready. */
async function withWeb(r: Rig) {
  const repo = r.fake.addRepo(101, "alice/web", { files: WEB_FILES });
  const project = (await addProject(r.d, "alice", repo.id)).project;
  await r.store.addGrant(project.id, { action: "pr.ready", effect: "allow", branchPattern: "tailzu/*" });
  // The web project's share has a small plan of its own; the API's goal is the big plan's.
  r.json.on("work.plan", (_i: unknown, seen: { user: string }) => (seen.user.includes("share of a goal that spans several projects")
    ? { steps: [{ do: "Add exportNote() to the web client", files: [{ path: "src/web/api.ts", action: "edit" }] }], notes: [] }
    : { steps: [{ do: "Build the export endpoint", files: [{ path: "src/api/notes.ts", action: "edit" }] }], notes: [] }));
  r.json.on("team.split", { parts: [
    { id: 1, title: "Export API", goal: "Build the export endpoint in src/api/notes.ts.", ownedPaths: ["src/api/"], dependsOn: [], acceptance: ["The endpoint answers with a PDF"], budgetShare: 2 },
    { id: 2, title: "Web client", goal: "In src/web/api.ts add exportNote(), which asks the API for the PDF.", ownedPaths: [], dependsOn: [], acceptance: ["exportNote exists"], budgetShare: 2, repo: "alice/web" },
  ] });
  return { repo, project };
}

describe("a goal over several projects", () => {
  it("gets a part for each project, one pull request for each, and each pull request points at the other", async () => {
    const r = await teamRig();
    const web = await withWeb(r);
    r.scripts.set("p1", buildScript(["src/api/notes.ts"], "Built the export endpoint."));
    // The web project's own job: its own lead's ordinary phases, on its own branch, with its own plan.
    r.scripts.set("p2", [edit("src/web/api.ts", "v1"), done("Added exportNote().")]);
    const checkedBy: string[] = [];
    r.runner.checkResult = (_k, run) => { if (run.wrapped) checkedBy.push(run.jobId); return { exit: 0, text: "ok" }; };
    const { job, branch } = await r.startLead(TASK, { projects: [web.project.id] });
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(s.teamRepos).toEqual([web.project.id]);
    expect(s.team!.why).toBe("repos");
    // No locating or planning of its own for the primary: a goal over several projects is split by project first.
    expect(s.plan).toBeUndefined();
    const api = s.team!.parts.find((p) => p.id === 1)!;
    const wp = s.team!.parts.find((p) => p.id === 2)!;
    expect([api.status, wp.status]).toEqual(["merged", "merged"]);
    expect(wp.kind).toBe("repo");
    expect(wp.projectId).toBe(web.project.id);
    expect(wp.ownedPaths).toEqual([]);

    // The web project's share ran as a job of that project, on a branch of that project's, and opened that project's pull request.
    const webJob = (await r.helpers(job.id)).find((h) => h.state.part!.id === 2)!;
    expect((await r.jobNow(webJob.id)).projectId).toBe(web.project.id);
    expect(webJob.state.part!.repo).toBe(true);
    expect(r.fake.branches(web.repo)).toContain(webJob.branch);
    expect(r.fake.files(web.repo, webJob.branch)["src/web/api.ts"]).toBe('export const webApi = "v1";\n');
    expect(r.fake.files(r.repo, branch)["src/web/api.ts"]).toBe('export const webApi = "v0";\n');
    expect(webJob.state.pr).toBeTruthy();

    // One pull request in each repo.
    const apiPr = r.fake.pulls(r.repo);
    const webPr = r.fake.pulls(web.repo);
    expect(apiPr).toHaveLength(1);
    expect(webPr).toHaveLength(1);
    // Cross-linked: each body names the other's address, in a block that appears once.
    const apiUrl = `https://github.com/alice/app/pull/${apiPr[0]!.number}`;
    const webUrl = `https://github.com/alice/web/pull/${webPr[0]!.number}`;
    expect(apiPr[0]!.body).toContain(webUrl);
    expect(webPr[0]!.body).toContain(apiUrl);
    for (const body of [apiPr[0]!.body, webPr[0]!.body]) {
      expect(body.split(LINKS_OPEN)).toHaveLength(2);
      expect(body.split(LINKS_CLOSE)).toHaveLength(2);
      expect(body).toContain("## Related pull requests");
    }
    // The web pull request keeps what its own job wrote.
    expect(webPr[0]!.body).toContain("## What this does");
    expect(s.report!.text).toContain(webUrl);
    expect(s.pr!.url).toBe(apiUrl);
    expect(checkedBy.length).toBeGreaterThan(0);
  });

  it("links again without adding the block twice, and keeps what the person wrote in the description", async () => {
    const r = await teamRig();
    const web = await withWeb(r);
    r.scripts.set("p1", buildScript(["src/api/notes.ts"], "Built the export endpoint."));
    r.scripts.set("p2", [edit("src/web/api.ts", "v1"), done("Added exportNote().")]);
    const { job, branch } = await r.startLead(TASK, { projects: [web.project.id] });
    const { s } = await run(r, job.id);
    // The person adds a line to the web pull request's description; the lead links again (it does so every time its report is made).
    const webNumber = r.fake.pulls(web.repo)[0]!.number;
    r.fake.editPull(web.repo, webNumber, { body: `${r.fake.pulls(web.repo)[0]!.body}\n\nMy own note.` });
    const logged: string[] = [];
    const fakeRun = {
      state: s, projectId: r.project.id, project: r.project, userId: "alice", branch, deps: { projects: r.d }, note: () => undefined,
      log: { step: async (t: string) => { logged.push(t); } },
    };
    await linkPulls(fakeRun as never);
    await linkPulls(fakeRun as never);
    const body = r.fake.pulls(web.repo)[0]!.body;
    expect(body.split(LINKS_OPEN)).toHaveLength(2);
    expect(body).toContain("My own note.");
    expect(body).toContain(`https://github.com/alice/app/pull/${r.fake.pulls(r.repo)[0]!.number}`);
    expect(r.fake.pulls(r.repo)[0]!.body.split(LINKS_OPEN)).toHaveLength(2);
    expect(logged).toHaveLength(2);
  });

  it("stops with a reason, changing nothing, when the split cannot be made for a goal that needs one", async () => {
    const r = await teamRig();
    const web = await withWeb(r);
    r.json.on("team.split", { parts: [{ id: 1, title: "All", goal: "Everything.", ownedPaths: ["**"], dependsOn: [] }] });
    const { job } = await r.startLead(TASK, { projects: [web.project.id] });
    const { s, job: j } = await run(r, job.id);
    expect(j.state).toBe("failed");
    expect(s.report!.text).toContain("A goal over several projects needs the split");
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
    expect(r.fake.pulls(web.repo)).toHaveLength(0);
    expect(r.json.of("team.split")).toHaveLength(3);
  });

  it("checks the projects named: yours, not the job's own, and at most three", async () => {
    const r = await teamRig();
    const web = await withWeb(r);
    expect(await r.lead.teamProjects("alice", r.project.id, undefined)).toEqual([]);
    expect(await r.lead.teamProjects("alice", r.project.id, [web.project.id, web.project.id, r.project.id])).toEqual([web.project.id]);
    await expect(r.lead.teamProjects("alice", r.project.id, ["00000000-0000-4000-8000-000000000000"])).rejects.toMatchObject({ code: "not_found" });
    await expect(r.lead.teamProjects("bob", r.project.id, [web.project.id])).rejects.toMatchObject({ code: "not_found" });
    await expect(r.lead.teamProjects("alice", r.project.id, "web")).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.lead.teamProjects("alice", r.project.id, ["a", "b", "c", "d"])).rejects.toMatchObject({ code: "bad_request" });
  });
});

void [call];

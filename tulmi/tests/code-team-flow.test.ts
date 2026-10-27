/**
 * LEAD AND HELPERS, END TO END (src/code/team, docs/code-team.md): a big goal is split into parts, helpers build them side by side on their own branches, a
 * model of another family reviews each, the lead merges them in dependency order, checks the whole against the baseline, and opens ONE pull request.
 *
 * Over the team rig (tests/team-rig.ts): the real orchestrator, router, policy and workspace, a fake GitHub, and a model that takes each job's turns from its own script.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { teamRig, call, done, buildScript, settle, bigPlan, BIG_PLAN_FILES, allGood, CONTRACT_EDIT, OVER, run, chain } = await import("./team-rig.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
const { resetRewindStoreForTests } = await import("../src/code/agent/rewind.js");
const { resetConfigForTests } = await import("../src/config.js");
const { resetTierTableForTests } = await import("../src/code/brain/tiers.js");
type Rig = Awaited<ReturnType<typeof teamRig>>;

beforeEach(() => { resetSettingsStoreForTests(); resetRewindStoreForTests(); });
afterEach(() => {
  delete process.env.CODE_TEAM_PARALLEL;
  delete process.env.CODE_MODEL_TIERS;
  resetConfigForTests();
  resetTierTableForTests();
});

describe("a big goal", () => {
  it("is split, built by helpers, reviewed, merged in dependency order and opened as one pull request", async () => {
    const r = await teamRig();
    allGood(r);
    const { job, branch } = await r.startLead();
    const { job: end, s } = await run(r, job.id);
    expect(end.state, s.report?.text).toBe("done");
    expect(s.team?.stage).toBe("final");
    expect(s.team!.why).toBe("files");
    expect(s.team!.parts.map((p) => [p.id, p.status])).toEqual([[0, "merged"], [1, "merged"], [2, "merged"], [3, "merged"], [4, "merged"]]);

    // The whole goal is in the lead branch.
    const files = r.fake.files(r.repo, branch);
    expect(files["src/types/note.ts"]).toContain("pdfUrl");
    for (const p of ["src/api/notes.ts", "src/web/NotePage.tsx", "src/mail/send.ts", "src/tags/count.ts", "src/util/format.ts"]) expect(files[p], p).toContain('"v1"');

    // The helpers were cut from the lead branch AFTER part 0, each on a branch of its own named for the work and the part.
    const slug = "let-people-export-a-note-as-a-pd";
    const contracts = chain(r, branch).find((c) => c.message.startsWith("Add the export fields") || c.message.includes("Note type"));
    expect(contracts).toBeTruthy();
    for (const k of [1, 2, 3, 4]) {
      expect(r.fake.branches(r.repo)).toContain(`tailzu/${slug}-p${k}`);
      const own = chain(r, `tailzu/${slug}-p${k}`);
      expect(own.some((c) => c.sha === contracts!.sha), `p${k} is cut from the lead branch after part 0`).toBe(true);
      expect(own[0]!.message, `p${k}'s own commit`).not.toContain("Merge");
    }

    // Four merge commits, each with two parents (the lead branch's head, then the part branch's head), made by the server as Blip.
    const merges = chain(r, branch).filter((c) => c.parents.length === 2);
    expect(merges).toHaveLength(4);
    for (const m of merges) {
      expect(m.message).toMatch(/^Merge part \d \(/);
      expect(r.fake.headCommit(r.repo, branch)).toBeTruthy();
    }
    expect(merges.map((m) => r.fake.branches(r.repo).filter((b) => r.fake.head(r.repo, b) === m.parents[1]).join())).toEqual(
      expect.arrayContaining([expect.stringMatching(/-p[1-4]$/)]),
    );

    // One pull request: the table of parts, the review summary, the combined work log of the lead and its helpers.
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    const body = r.fake.pulls(r.repo)[0]!.body;
    expect(body).toContain("## The team");
    expect(body).toContain("| Part | What | Status | Reviewed by | Fix rounds | Cost |");
    for (const t of ["Export API", "Note page", "Mail", "Counts and stats"]) expect(body).toContain(t);
    expect(body).toContain("### What the reviewers found");
    expect(body).toContain("## The helpers' work logs");
    expect(body).toContain("### Part 1: Export API");
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(false);
    expect(s.pr).toMatchObject({ ready: true });
    expect(s.report!.text).toContain("The team");
    expect(s.report!.text).toContain("src/api/notes.ts (changed)");
  });

  it("makes the helpers' jobs: a branch each, their slice of the money, the lead's plan cut to their files, and the guard", async () => {
    const r = await teamRig();
    allGood(r);
    const { job } = await r.startLead();
    await run(r, job.id);
    const hs = await r.helpers(job.id);
    expect(hs).toHaveLength(4);
    const h1 = hs.find((h) => h.state.part!.id === 1)!;
    expect(h1.state.part).toMatchObject({ parentId: job.id, title: "Export API", ownedPaths: ["src/api/**"], round: 0 });
    expect(h1.state.teamMode).toBe("off");
    // It started at work with the lead's plan for its files, the lead's baseline, and nothing to locate or plan.
    expect(h1.state.plan!.steps.flatMap((s) => s.files.map((f) => f.path)).sort()).toEqual(["src/api/notes.test.ts", "src/api/notes.ts", "src/api/routes.ts"]);
    expect(h1.state.planOk).toBe(true);
    expect(h1.state.baseline?.status).toBe("recorded");
    expect(h1.state.commits).toHaveLength(1);
    // Its task says what it owns, and that the rest is refused.
    const t = await r.jobNow(h1.id);
    expect(t.task).toContain("Part 1, Export API");
    expect(t.task).toContain("src/api/**");
    // The first thing the model saw as a helper was its part, not the lead's whole plan.
    const seen = r.model.seen.find((x) => x.user.includes("Part 1, Export API"))!;
    expect(seen.user).toContain("You own, and may change, only these files: src/api/**");
    // The helper never opened a pull request or ran locate or plan.
    expect(h1.state.pr).toBeUndefined();
    expect(r.json.of("work.plan")).toHaveLength(1);
    // Pushes: no "job done" for a helper; one for the lead.
    expect(r.toldOf("job_done").map((n) => n.data.jobId)).toEqual([job.id]);
  });
});

describe("a small task", () => {
  it("is never a lead: the plan decides, and twelve files are not too many", async () => {
    const r = await teamRig();
    const twelve = BIG_PLAN_FILES.slice(0, 12);
    r.json.on("work.plan", bigPlan(twelve));
    r.scripts.set("lead", [...twelve.filter((p) => !p.includes("types")).map((p) => ({ calls: [{ name: "edit_file", args: { path: p, old: '"v0"', new: '"v1"' } }] })), done("All twelve.")]);
    const { job } = await r.startLead();
    await settle(r, async () => OVER.includes((await r.jobNow(job.id)).state));
    const s = await r.stateNow(job.id);
    expect(s.team).toBeUndefined();
    expect(r.json.of("team.split")).toHaveLength(0);
    expect((await r.helpers(job.id))).toHaveLength(0);
    expect(s.report!.outcome).toBe("done");
  });

  it("is not a lead when the person said off, however big the plan is", async () => {
    const r = await teamRig();
    r.scripts.set("lead", [done("Did it myself.")]);
    const { job } = await r.startLead(undefined, { team: "off" });
    await settle(r, async () => OVER.includes((await r.jobNow(job.id)).state));
    const s = await r.stateNow(job.id);
    expect(s.team).toBeUndefined();
    expect(s.teamMode).toBe("off");
    expect(r.json.of("team.split")).toHaveLength(0);
  });

  it("is a lead when the person asks for one, even for a small plan", async () => {
    const r = await teamRig();
    const small = BIG_PLAN_FILES.filter((p) => /^src\/(api|web)\//.test(p));
    r.json.on("work.plan", bigPlan(small));
    r.json.on("team.split", { parts: [
      { id: 1, title: "API", goal: "Build the API.", ownedPaths: ["src/api/"], dependsOn: [], acceptance: [], budgetShare: 1 },
      { id: 2, title: "Web", goal: "Build the page.", ownedPaths: ["src/web/"], dependsOn: [], acceptance: [], budgetShare: 1 },
    ] });
    r.scripts.set("p1", buildScript(["src/api/notes.ts"], "API."));
    r.scripts.set("p2", buildScript(["src/web/NotePage.tsx"], "Page."));
    const { job } = await r.startLead(undefined, { team: "on" });
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(s.team!.why).toBe("asked");
    // No shared contracts: the helpers start at once, from the branch as it is.
    expect(s.team!.parts.map((p) => p.id)).toEqual([1, 2]);
  });
});

describe("the owned-path guard", () => {
  it("refuses a helper's edit outside its files with a tool error that says to ask the lead, stages nothing, and tells the lead what it asked for", async () => {
    const r = await teamRig();
    allGood(r);
    // Part 1 (the API) tries to change the page, then does its own work.
    r.scripts.set("p1", [call("edit_file", { path: "src/web/NotePage.tsx", old: '"v0"', new: '"stolen"' }), ...buildScript(["src/api/notes.ts"], "Built the endpoint. I also needed a change in src/web/NotePage.tsx.")]);
    const { job, branch } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    const h1 = (await r.helpers(job.id)).find((h) => h.state.part!.id === 1)!;
    const result = h1.state.work.exchanges[0]!.results[0]!;
    expect(result.ok).toBe(false);
    expect(result.content).toContain("src/web/NotePage.tsx is not yours");
    expect(result.content).toContain("Ask the lead");
    // Nothing of it was staged or committed, in the helper's branch or the lead's: the page is the page's helper's.
    expect(h1.state.commits).toHaveLength(1);
    const web = (await r.helpers(job.id)).find((h) => h.state.part!.id === 2)!;
    expect(r.fake.files(r.repo, h1.branch)["src/web/NotePage.tsx"]).toBe('export const page = "v0";\n');
    expect(r.fake.files(r.repo, branch)["src/web/NotePage.tsx"]).toBe('export const page = "v1";\n');
    expect(web.state.part!.refused).toEqual([]);
    // The lead knows what the helper asked for: in the part, in the review it asked for, and in the work it does last.
    expect(h1.state.part!.refused).toEqual(["src/web/NotePage.tsx"]);
    expect(s.team!.parts.find((p) => p.id === 1)!.refused).toEqual(["src/web/NotePage.tsx"]);
    expect(r.reviews.find((x) => x.part === 1)!.user).toContain("asked for changes outside its files");
    expect(s.task).toContain("part 1 asked for a change there");
    expect(r.fake.pulls(r.repo)[0]!.body).toContain("src/web/NotePage.tsx");
  });

  it("holds the lead to the contracts while it does part 0, and to nothing after", async () => {
    const r = await teamRig();
    allGood(r);
    r.scripts.set("lead", [
      call("edit_file", { path: "src/api/notes.ts", old: '"v0"', new: '"lead was here"' }),
      call("edit_file", CONTRACT_EDIT), done("Contracts."),
    ]);
    const { job, branch } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    // The model was told, on its next turn, that the API is not the contracts' and the helpers own it; nothing of it was staged.
    const told = r.model.seen.find((x) => x.messages.includes("src/api/notes.ts is not part of the shared contracts"));
    expect(told).toBeTruthy();
    expect(told!.messages).toContain("While you do part 0, the shared contracts you change only src/types/**");
    expect(r.fake.files(r.repo, branch)["src/api/notes.ts"]).toBe('export const notes = "v1";\n');
    expect(r.fake.files(r.repo, branch)["src/types/note.ts"]).toContain("pdfUrl");
    expect(s.team!.parts[0]!.mergedSha).toBeTruthy();
  });
});

describe("helpers in parallel", () => {
  /** Peak number of helper jobs that are not over, measured on every write to a job. */
  function watchPeak(r: Rig, leadId: string) {
    const out = { peak: 0, starts: [] as string[] };
    const cas = r.jobStore.casJob.bind(r.jobStore);
    r.jobStore.casJob = async (id, e, p) => {
      const res = await cas(id, e, p);
      if (res) {
        const live = (await r.helpers(leadId)).filter((h) => !OVER.includes(h.jobState) && h.state.phase !== "done");
        out.peak = Math.max(out.peak, live.filter((h) => h.jobState === "running").length);
      }
      return res;
    };
    return out;
  }

  it("work at most three at once by default, the fourth when one is merged, and all four get done", async () => {
    const r = await teamRig();
    allGood(r);
    const { job } = await r.startLead();
    const peak = watchPeak(r, job.id);
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(peak.peak).toBeGreaterThan(1);
    expect(peak.peak).toBeLessThanOrEqual(3);
    expect(s.team!.parallel).toBe(3);
    // The fourth part started only once there was room.
    const started = s.team!.parts.filter((p) => p.id > 0).map((p) => p.startedAt!).sort((a, b) => a - b);
    expect(started).toHaveLength(4);
  });

  it("work one at a time when told to (CODE_TEAM_PARALLEL), and when nowhere is free to run more", async () => {
    process.env.CODE_TEAM_PARALLEL = "1";
    resetConfigForTests();
    const r = await teamRig();
    allGood(r);
    const { job } = await r.startLead();
    const peak = watchPeak(r, job.id);
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(peak.peak).toBe(1);
    expect(s.team!.parallel).toBe(1);
  });

  it("do not take a place among the jobs a server drives while the lead waits: a server that runs one job at a time still gets the team done", async () => {
    const r = await teamRig();
    allGood(r);
    const one = r.server({ instanceId: "one-at-a-time", concurrency: 1 });
    const { job } = await r.startLead(undefined, { orch: one });
    await settle(r, async () => OVER.includes((await r.jobNow(job.id)).state));
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(one.running).toBe(0);
  });
});

describe("the review", () => {
  it("is by a model of a different family from the helper's, named by the router and kept to by the gateway", async () => {
    const r = await teamRig();
    allGood(r);
    r.models.p1 = "anthropic/claude-haiku-5.5";
    r.models.p2 = "google/gemini-2.5-flash";
    const { job } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(r.reviews).toHaveLength(4);
    for (const rev of r.reviews) {
      expect(rev.tier).toBe("review");
      expect(rev.writerModel, `part ${rev.part}`).toBeTruthy();
      const family = (m: string) => m.split("/")[0];
      expect(family(rev.model!), `part ${rev.part}`).not.toBe(family(rev.writerModel!));
    }
    const of = (n: number) => r.reviews.find((x) => x.part === n)!;
    expect(of(1)).toMatchObject({ writerModel: "anthropic/claude-haiku-5.5" });
    expect(of(1).model).not.toMatch(/^anthropic\//);
    expect(of(2).model).not.toMatch(/^google\//);
    // The review says who wrote and who reviewed, in the part, and in the pull request.
    const rev = s.team!.parts.find((p) => p.id === 1)!.reviews[0]!;
    expect(rev.family).not.toBe(rev.writerFamily);
    expect(rev.writerFamily).toBe("anthropic");
    expect(r.fake.pulls(r.repo)[0]!.body).toMatch(/\| 1 \| Export API \| merged \| \w[\w-]* \(helper: anthropic\) \|/);
    // What the reviewer was shown: the goal, the acceptance, and the part's diff against the commit it was cut from, as data.
    const u = of(1).user;
    expect(u).toContain("<request>");
    expect(u).toContain("The endpoint answers with a PDF");
    expect(u).toContain("--- a/src/api/notes.ts\n+++ b/src/api/notes.ts");
    expect(u).toContain('-export const notes = "v0";\n+export const notes = "v1";');
  });

  it("is skipped, and says why, when no model of another family can be had: it is never by the helper's own", async () => {
    // The review pool holds only the helper's family.
    process.env.CODE_MODEL_TIERS = JSON.stringify({ review: { models: ["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5"] } });
    resetConfigForTests();
    resetTierTableForTests();
    const r = await teamRig();
    allGood(r);
    for (const k of ["p1", "p2", "p3", "p4"]) r.models[k] = "anthropic/claude-sonnet-5.5";
    const { job } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(r.reviews).toHaveLength(0);
    const revs = s.team!.parts.filter((p) => p.id > 0).map((p) => p.reviews[0]!);
    expect(revs.every((x) => x.verdict === "skipped" && /different family/.test(x.summary))).toBe(true);
    // The final check is what vouches for it, and the pull request says the parts were not reviewed.
    expect(r.fake.pulls(r.repo)[0]!.body).toContain("review skipped");
  });

  it("rejects an answer from the helper's own family even if the gateway moved down the pool to it", async () => {
    const r = await teamRig();
    allGood(r);
    r.models.p1 = "z-ai/glm-5.3-flash";
    r.hooks.review = (res) => ({ ...res, model: "z-ai/glm-5.3-flash" });
    const { job } = await r.startLead();
    await settle(r, async () => OVER.includes((await r.jobNow(job.id)).state));
    const s = await r.stateNow(job.id);
    const rev = s.team!.parts.find((p) => p.id === 1)!.reviews[0]!;
    expect(rev.verdict).toBe("skipped");
    expect(rev.summary).toContain("same family");
  });
});

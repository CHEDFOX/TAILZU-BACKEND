/**
 * THE SPLIT AND THE PURE PARTS OF LEAD AND HELPERS MODE (src/code/team): ownership globs, the validation of a split, asking again on an overlap, when a job becomes a lead,
 * the money (the reserve, the slices, the parallel cap), the diff a reviewer reads, and the owned-path guard. No model, no GitHub: everything here is a function of its inputs.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
  process.env.DEV_SKIP_AUTH = "true";
});

const { globsOverlap, normalizeGlob, owns, overlaps, expandBraces, ownsEverything } = await import("../src/code/team/globs.js");
const { validateSplit, splitWork, topoOrder, SplitReply } = await import("../src/code/team/split.js");
const { leadDecision, afterPlan } = await import("../src/code/team/when.js");
const { reserveOf, sliceBudgets, parallelCap, affordable, adjustSpend } = await import("../src/code/team/budget.js");
const { fileDiff, partDiff } = await import("../src/code/team/diff.js");
const { OwnedPaths } = await import("../src/code/team/guard.js");
const { Changeset, Refused } = await import("../src/code/agent/changeset.js");
const { initialState } = await import("../src/code/agent/types.js");
const { MemoryJobStore } = await import("../src/code/jobs/store.js");
const { fakeCall } = await import("./work-fixtures.js");
const { PART_PAISE_MIN, PARALLEL_DEFAULT, PARTS_MAX } = await import("../src/code/team/types.js");

type Reply = import("../src/code/team/split.js").SplitReply;
const part = (id: number, ownedPaths: string[], extra: Partial<Reply["parts"][number]> = {}): Reply["parts"][number] => ({
  id, title: `Part ${id}`, goal: `Do part ${id}.`, ownedPaths, dependsOn: id === 0 ? [] : [0], acceptance: [], ...extra,
});
const FILES = ["src/types/a.ts", "src/api/x.ts", "src/api/x.test.ts", "src/web/p.tsx", "src/web/p.test.tsx", "src/mail/m.ts"];
const PLAN = FILES.map((path) => ({ path, action: "edit" }));

describe("ownership globs", () => {
  it("reads the same globs the agent's glob tool does, and makes a trailing slash mean everything below", () => {
    expect(normalizeGlob("src/api/")).toBe("src/api/**");
    expect(normalizeGlob("./src/api/**")).toBe("src/api/**");
    expect(normalizeGlob("")).toBeNull();
    expect(normalizeGlob("src/{a,b/c")).toBeNull();
    expect(owns(["src/api/**"], "src/api/x.ts")).toBe(true);
    expect(owns(["src/api/**"], "src/web/x.ts")).toBe(false);
    expect(owns(["*.md"], "docs/deep/readme.md")).toBe(true);
    expect(owns(["src/{a,b}/*.ts"], "src/b/x.ts")).toBe(true);
    expect(owns(["src/{a,b}/*.ts"], "src/c/x.ts")).toBe(false);
  });

  it("decides whether two globs can reach one file by their patterns, so a file a helper has yet to make counts", () => {
    expect(globsOverlap("src/api/**", "src/web/**")).toBe(false);
    expect(globsOverlap("src/api/**", "src/api/new/*.ts")).toBe(true);
    expect(globsOverlap("src/api/*.ts", "src/api/sub/*.ts")).toBe(false);
    expect(globsOverlap("src/**/*.test.ts", "src/api/**")).toBe(true);
    expect(globsOverlap("src/**/*.test.ts", "src/web/*.tsx")).toBe(false);
    expect(globsOverlap("*.md", "docs/**")).toBe(true);
    expect(globsOverlap("src/a?.ts", "src/ab.ts")).toBe(true);
    expect(globsOverlap("src/a?.ts", "src/abc.ts")).toBe(false);
    expect(globsOverlap("src/{a,b}/**", "src/b/c.ts")).toBe(true);
    expect(globsOverlap("src/{a,b}/**", "src/c/**")).toBe(false);
    expect(globsOverlap("README.md", "docs/README.md")).toBe(true); // a name with no folder is that name at any depth
    expect(globsOverlap("/README.md", "docs/README.md")).toBe(false);
    expect(expandBraces("a/{b,c/{d,e}}/f").sort()).toEqual(["a/b/f", "a/c/d/f", "a/c/e/f"]);
  });

  it("lists the pairs of parts that overlap, and what owns every file is refused", () => {
    expect(overlaps([{ id: 1, ownedPaths: ["src/api/**"] }, { id: 2, ownedPaths: ["src/**/*.ts"] }, { id: 3, ownedPaths: ["docs/**"] }])).toEqual([{ a: 1, b: 2, globA: "src/api/**", globB: "src/**/*.ts" }]);
    for (const g of ["**", "*", "**/*", "*.*"]) expect(ownsEverything(g), g).toBe(true);
    expect(ownsEverything("src/**")).toBe(false);
  });
});

describe("validating a split", () => {
  it("accepts parts with disjoint files, part 0 first, and makes every helper depend on part 0", () => {
    const v = validateSplit({ parts: [
      part(2, ["src/web/"], { dependsOn: [] }), part(0, ["src/types/"]), part(1, ["src/api/"], { dependsOn: [] }), part(3, ["src/mail/"], { dependsOn: [0, 1] }),
    ] }, { files: FILES, planFiles: PLAN });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // Part 0 is first; the rest in an order they can run; every dependency has a smaller number.
    expect(v.parts.map((p) => p.id)).toEqual([0, 1, 2, 3]);
    expect(v.parts[0]!.title).toBe("Part 0");
    for (const p of v.parts) for (const d of p.dependsOn) expect(d).toBeLessThan(p.id);
    expect(v.parts.slice(1).every((p) => p.dependsOn.includes(0))).toBe(true);
    expect(v.parts.find((p) => p.title === "Part 3")!.dependsOn).toEqual([0, v.parts.find((p) => p.title === "Part 1")!.id]);
    // The folders are exact globs now.
    // (Ties keep the model's own order: it listed the page before the API.)
    expect(v.parts.map((p) => p.ownedPaths[0])).toEqual(["src/types/**", "src/web/**", "src/api/**", "src/mail/**"]);
  });

  it("numbers the helpers in the order they can run: a part comes after the parts it needs", () => {
    const v = validateSplit({ parts: [part(0, ["src/types/"]), part(1, ["src/mail/"], { dependsOn: [0, 2] }), part(2, ["src/api/"]), part(3, ["src/web/"])] }, { files: FILES });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const byTitle = Object.fromEntries(v.parts.map((p) => [p.title, p]));
    expect(byTitle["Part 2"]!.id).toBeLessThan(byTitle["Part 1"]!.id);
    expect(byTitle["Part 1"]!.dependsOn).toContain(byTitle["Part 2"]!.id);
    expect(topoOrder(v.parts)).toEqual(v.parts.map((p) => p.id));
  });

  it("REFUSES parts whose globs can reach the same file, and says which two and which globs", () => {
    const v = validateSplit({ parts: [part(0, ["src/types/"]), part(1, ["src/api/", "src/web/*.test.tsx"]), part(2, ["src/web/"])] }, { files: FILES });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.problems.join(" ")).toMatch(/Part 1 \(src\/web\/\*\.test\.tsx\) and part 2 \(src\/web\/\*\*\) can both change the same files/);
  });

  it("refuses a file in the plan that no part owns, a cycle, a missing dependency, no files, the whole repo, and a team of one", () => {
    const base = { files: FILES, planFiles: PLAN };
    const p = (r: Reply["parts"]) => { const v = validateSplit({ parts: r }, base); return v.ok ? [] : v.problems; };
    expect(p([part(0, ["src/types/"]), part(1, ["src/api/"]), part(2, ["src/web/"])]).join(" ")).toContain("belong to no part: src/mail/m.ts");
    expect(p([part(1, ["src/api/", "src/mail/", "src/types/"], { dependsOn: [2] }), part(2, ["src/web/"], { dependsOn: [1] })]).join(" ")).toContain("make a cycle");
    expect(p([part(1, ["src/api/"], { dependsOn: [7] }), part(2, ["src/web/", "src/mail/", "src/types/"])]).join(" ")).toContain("depends on part 7, which does not exist");
    expect(p([part(1, []), part(2, ["src/web/"])]).join(" ")).toContain("owns no files");
    expect(p([part(1, ["**"]), part(2, ["src/web/"])]).join(" ")).toContain("every file");
    expect(p([part(0, ["src/types/"]), part(1, ["src/api/", "src/web/", "src/mail/"])]).join(" ")).toContain("at least two parts");
    expect(p([part(1, ["src/api/"]), part(1, ["src/web/"]), part(2, ["src/mail/"])]).join(" ")).toContain("have the id 1");
    expect(p([part(1, ["src/api/", "src/types/"], { dependsOn: [1] }), part(2, ["src/web/", "src/mail/"])]).join(" ")).toContain("depends on itself");
    expect(p([part(0, ["src/types/"], { dependsOn: [1] }), part(1, ["src/api/", "src/mail/"]), part(2, ["src/web/"])]).join(" ")).toContain("Part 0 comes first");
  });

  it("allows at most eight helpers", () => {
    const many = Array.from({ length: PARTS_MAX + 1 }, (_, i) => part(i + 1, [`src/p${i}/`], { dependsOn: [] }));
    // The schema holds the id to PARTS_MAX, so the ninth helper is already refused by the shape; a list that fits the shape but not the rule is refused here.
    const r = SplitReply.safeParse({ parts: many });
    expect(r.success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => part(i === 0 ? 8 : i, [`src/p${i}/`], { dependsOn: [] }));
    const v = validateSplit({ parts: nine }, { files: [] });
    expect(v.ok).toBe(false);
  });

  it("normalises the money shares over the helpers and gives part 0 none", () => {
    const v = validateSplit({ parts: [part(0, ["src/types/"], { budgetShare: 9 }), part(1, ["src/api/"], { budgetShare: 3 }), part(2, ["src/web/"], { budgetShare: 1 })] }, { files: FILES });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parts.map((p) => p.budgetShare)).toEqual([0, 0.75, 0.25]);
  });

  it("notes a glob that matches no file yet, and leaves other projects' parts without files", () => {
    const v = validateSplit({ parts: [part(1, ["src/brand-new/"], { dependsOn: [] }), part(2, ["src/web/"], { dependsOn: [] }), part(3, [], { dependsOn: [], repo: "alice/web" })] },
      { files: FILES, repos: [{ projectId: "p2", name: "alice/web" }] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.notes.join(" ")).toContain("matches no file yet");
    const repo = v.parts.find((p) => p.kind === "repo")!;
    expect(repo.projectId).toBe("p2");
    expect(repo.ownedPaths).toEqual([]);
    // A name that is not one of the projects is refused.
    const bad = validateSplit({ parts: [part(1, ["src/api/"], { dependsOn: [] }), part(2, [], { dependsOn: [], repo: "alice/nope" })] }, { files: FILES, repos: [{ projectId: "p2", name: "alice/web" }] });
    expect(bad.ok).toBe(false);
  });
});

describe("asking for the split", () => {
  const model = (fake: ReturnType<typeof fakeCall>) => ({ call: fake.call, userId: "u1", jobId: "j1", budget: "job" as const });
  const input = { task: "Export notes.", files: FILES, plan: { steps: [{ n: 1, do: "all", files: PLAN }], impact: { files: FILES, importers: [], routes: [], tests: [], config: [], migrations: [], env: { reads: [], exampleChanged: [] }, publicApi: [], untested: [], hot: [], features: [] }, verify: [], risk: "low", riskReasons: [], notes: [], tier: "code", paise: 0 } as never };

  it("sends an answer with overlapping parts back with the problems, and takes the next one", async () => {
    const fake = fakeCall();
    const answers = [
      { parts: [part(0, ["src/types/"]), part(1, ["src/api/", "src/web/"]), part(2, ["src/web/", "src/mail/"])] },
      { parts: [part(0, ["src/types/"]), part(1, ["src/api/"]), part(2, ["src/web/", "src/mail/"])] },
    ];
    fake.on("team.split", () => answers.shift());
    const res = await splitWork(model(fake), input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rounds).toBe(2);
    expect(res.parts.map((p) => p.ownedPaths[0])).toEqual(["src/types/**", "src/api/**", "src/web/**"]);
    const [first, second] = fake.of("team.split");
    expect(first!.user).not.toContain("COULD NOT BE USED");
    expect(second!.user).toContain("YOUR LAST ANSWER COULD NOT BE USED");
    expect(second!.user).toMatch(/Part 1 \(src\/web\/\*\*\) and part 2 \(src\/web\/\*\*\) can both change the same files/);
    expect(fake.of("team.split").every((c) => c.tier === "strong")).toBe(true);
    // The plan's files, the project's files and what imports what are in the message, as data.
    expect(first!.user).toContain("src/api/x.ts");
    expect(first!.system).toContain("Part 0 is the shared contracts");
  });

  it("gives up after three answers that cannot be used, saying why, and charges what it asked", async () => {
    const fake = fakeCall();
    fake.on("team.split", { parts: [part(1, ["src/api/", "src/web/"]), part(2, ["src/web/"])] });
    const res = await splitWork(model(fake), input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.why).toBe("invalid");
    expect(res.rounds).toBe(3);
    expect(res.paise).toBe(9);
    expect(res.problems.join(" ")).toContain("can both change the same files");
  });

  it("does not ask when the money cannot pay even the cheaper tier, and tells a model that is down from one that is unaffordable", async () => {
    const fake = fakeCall();
    fake.on("team.split", { parts: [] });
    expect(await splitWork(model(fake), { ...input, remainingPaise: 0 })).toMatchObject({ ok: false, why: "budget", rounds: 0 });
    expect(fake.calls).toHaveLength(0);
    const down = fakeCall();
    down.down = true;
    expect(await splitWork(model(down), input)).toMatchObject({ ok: false, why: "down" });
  });

  it("withholds a request that looks like it holds a secret, and fences what it shows", async () => {
    const fake = fakeCall();
    fake.on("team.split", { parts: [part(0, ["src/types/"]), part(1, ["src/api/"]), part(2, ["src/web/", "src/mail/"])] });
    const key = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    await splitWork(model(fake), { ...input, task: `Export notes using ${key}.` });
    const sent = fake.of("team.split")[0]!.user;
    expect(sent).not.toContain(key);
    expect(sent).toContain("withheld");
    expect(sent).toContain("<request>");
  });
});

describe("when a job becomes a lead", () => {
  const plan = (files: number, features = 1) => ({ impact: { files: Array.from({ length: files }, (_, i) => `f${i}.ts`), features: Array.from({ length: features }, (_, i) => `feat${i}`) } }) as never;

  it("is a lead for a plan over 12 files, over 3 features, a goal over several projects, or when asked; and never for a small plan", () => {
    const d = (o: Parameters<typeof leadDecision>[0]) => leadDecision({ enabled: true, ...o });
    expect(d({ plan: plan(12) }).lead).toBe(false);
    expect(d({ plan: plan(13) })).toMatchObject({ lead: true, why: "files" });
    expect(d({ plan: plan(3, 3) }).lead).toBe(false);
    expect(d({ plan: plan(3, 4) })).toMatchObject({ lead: true, why: "features" });
    expect(d({ plan: plan(1), projects: 2 })).toMatchObject({ lead: true, why: "repos" });
    expect(d({ plan: plan(1), mode: "on" })).toMatchObject({ lead: true, why: "asked" });
    expect(d({ plan: plan(1) }).lead).toBe(false);
    expect(d({}).lead).toBe(false);
  });

  it("is never a lead when the person said off (even for several projects' worth of plan), or the server has it switched off", () => {
    expect(leadDecision({ enabled: true, plan: plan(40, 6), mode: "off" })).toMatchObject({ lead: false });
    expect(leadDecision({ enabled: true, plan: plan(2), mode: "off", projects: 3 }).lead).toBe(false);
    expect(leadDecision({ enabled: false, plan: plan(40, 6), mode: "on" }).lead).toBe(false);
  });

  it("sends the plan on to the split only for a big one, and never a helper", () => {
    const s = initialState("t", 1);
    s.plan = plan(20) as never;
    expect(afterPlan(s)).toBe("split");
    s.teamMode = "off";
    expect(afterPlan(s)).toBe("work");
    s.teamMode = undefined;
    s.plan = plan(2) as never;
    expect(afterPlan(s)).toBe("work");
    s.plan = plan(20) as never;
    s.part = { parentId: "p", id: 1, title: "t", goal: "g", ownedPaths: ["a/"], reads: [], acceptance: [], round: 0, refused: [] };
    expect(afterPlan(s)).toBe("work");
  });
});

describe("the money", () => {
  it("keeps 20% of the budget for the lead", () => {
    expect(reserveOf(3000)).toBe(600);
    expect(reserveOf(1)).toBe(1);
    expect(reserveOf(0)).toBe(0);
  });

  it("divides a pool among the parts by their shares, to the paise", () => {
    expect(sliceBudgets(1000, [3, 3, 2, 2])).toEqual([300, 300, 200, 200]);
    expect(sliceBudgets(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(sliceBudgets(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(sliceBudgets(10, [0, -2, Number.NaN])).toEqual([4, 3, 3]);
    expect(sliceBudgets(0, [1, 2])).toEqual([0, 0]);
    expect(sliceBudgets(5, [])).toEqual([]);
  });

  it("can pay a team only when the reserve and the least a helper needs are there", () => {
    expect(affordable(2000, 600, 4)).toEqual({ ok: true });
    expect(affordable(1000, 600, 4)).toEqual({ ok: false, needPaise: 600 + 4 * PART_PAISE_MIN - 1000 });
  });

  it("runs three helpers at once by default, fewer when the places to run them are few", () => {
    expect(parallelCap({})).toEqual({ cap: PARALLEL_DEFAULT, why: "" });
    expect(parallelCap({ configured: 5 }).cap).toBe(5);
    expect(parallelCap({ configured: 8, concurrency: 2 })).toMatchObject({ cap: 2 });
    // The person's PC is online: the configured number.
    expect(parallelCap({ capacity: { desktops: 1, githubEnabled: true, githubMinutesLeft: 10, paidAvailable: false } }).cap).toBe(3);
    // No PC, GitHub's free minutes are few: helpers go as the minutes allow.
    expect(parallelCap({ capacity: { desktops: 0, githubEnabled: true, githubMinutesLeft: 45, paidAvailable: false } })).toMatchObject({ cap: 2 });
    expect(parallelCap({ capacity: { desktops: 0, githubEnabled: true, githubMinutesLeft: 5, paidAvailable: false } }).cap).toBe(1);
    expect(parallelCap({ capacity: { desktops: 0, githubEnabled: true, githubMinutesLeft: 1000, paidAvailable: false } }).cap).toBe(3);
    // Nowhere to run: one at a time, and the reason is said.
    const none = parallelCap({ capacity: { desktops: 0, githubEnabled: false, githubMinutesLeft: 0, paidAvailable: false } });
    expect(none.cap).toBe(1);
    expect(none.why).toContain("one at a time");
  });

  it("takes from a job's spend and gives back, never below nothing, and loses no add to a race", async () => {
    const store = new MemoryJobStore();
    const job = await store.createJob({ userId: "u", projectId: "p", branch: "tailzu/x", task: "t", budgetPaise: 1000, agent: true });
    expect(await adjustSpend(store, job.id, 400)).toBe(400);
    expect(await adjustSpend(store, job.id, -150)).toBe(250);
    expect(await adjustSpend(store, job.id, -999)).toBe(0);
    await Promise.all([adjustSpend(store, job.id, 10), adjustSpend(store, job.id, 20), adjustSpend(store, job.id, 30)]);
    expect((await store.getJobById(job.id))!.spentPaise).toBe(60);
    expect(await adjustSpend(store, "00000000-0000-4000-8000-000000000000", 5)).toBeNull();
  });
});

describe("the diff a reviewer reads", () => {
  it("shows a changed file with hunks and context, an added file, a deleted one, and nothing for a file that is the same", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const before = lines.join("\n") + "\n";
    const after = [...lines.slice(0, 4), "line FOUR", ...lines.slice(5), "last"].join("\n") + "\n";
    const d = fileDiff({ path: "x.ts", before, after });
    expect(d).toContain("--- a/x.ts\n+++ b/x.ts");
    expect(d).toContain("-line 4\n+line FOUR");
    expect(d).toContain("+last");
    expect(d.match(/^@@/gm)).toHaveLength(2);
    expect(fileDiff({ path: "n.ts", before: null, after: "one\ntwo\n" })).toContain("--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+one\n+two");
    expect(fileDiff({ path: "d.ts", before: "gone\n", after: null })).toContain("+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone");
    expect(fileDiff({ path: "s.ts", before: "same\n", after: "same\n" })).toBe("");
  });

  it("is in path order, cut to a size, and names a file it did not show instead of half showing it", () => {
    const big = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    const r = partDiff([{ path: "z.ts", before: "z\n", after: "zz\n" }, { path: "big.ts", before: null, after: big }, { path: "a.ts", before: "a\n", after: "b\n" }], 600);
    expect(r.files).toBe(3);
    expect(r.omitted).toBe(1);
    expect(r.text.indexOf("a/a.ts")).toBeLessThan(r.text.indexOf("a/z.ts"));
    expect(r.text).toContain("(big.ts: +300 -0, not shown: the diff is too long)");
  });
});

describe("the owned-path guard", () => {
  it("lets a helper change its own files, refuses the rest with words that say what to do, and remembers what it asked for", () => {
    const refused: string[] = [];
    const g = new OwnedPaths({ label: "part 2 (the page)", globs: ["src/web/**"], refused });
    expect(g.check("src/web/p.tsx")).toBeNull();
    const why = g.check("src/api/x.ts")!;
    expect(why).toContain("src/api/x.ts is not yours");
    expect(why).toContain("part 2 (the page)");
    expect(why).toContain("src/web/**");
    expect(why).toContain("Ask the lead");
    g.check("src/api/x.ts");
    g.check("src/mail/m.ts");
    expect(refused).toEqual(["src/api/x.ts", "src/mail/m.ts"]);
  });

  it("holds the lead to the contracts while it does part 0", () => {
    const g = new OwnedPaths({ label: "part 0, the shared contracts", globs: ["src/types/**"], refused: [], lead: true });
    expect(g.check("src/types/a.ts")).toBeNull();
    expect(g.check("src/api/x.ts")).toContain("not part of the shared contracts");
  });

  it("is where every edit passes: the changeset refuses a path outside the part before anything is staged", () => {
    const staged: import("../src/code/agent/types.js").StagedFile[] = [];
    const refused: string[] = [];
    const guard = new OwnedPaths({ label: "part 1", globs: ["src/api/**"], refused });
    const c = new Changeset(staged, () => guard);
    expect(() => c.assertOwned("src/web/p.tsx")).toThrow(Refused);
    expect(() => c.stage("src/web/p.tsx", "x", { existed: true, original: "y" })).toThrow(/is not yours/);
    expect(staged).toHaveLength(0);
    expect(c.rev).toBe(0);
    c.stage("src/api/x.ts", "x", { existed: true, original: "y" });
    expect(staged.map((f) => f.path)).toEqual(["src/api/x.ts"]);
    // A deletion is an edit too.
    expect(() => c.stage("src/mail/m.ts", null, { existed: true, original: "m" })).toThrow(Refused);
    // A job that owns everything has no guard.
    const free = new Changeset([], () => undefined);
    expect(() => free.stage("anything.ts", "x", { existed: false, original: null })).not.toThrow();
    expect(refused).toEqual(["src/web/p.tsx", "src/mail/m.ts"]);
  });
});

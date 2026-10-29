/**
 * THE RESEARCH BRIEF (src/code/resources/brief.ts): layer 3's research, weighed against the project, rendered, and
 * committed to docs/research/<yyyy-mm-dd>-<slug>.md through workspace().commit so the policy applies.
 *
 * The model is a fake callModel, the web a fake search source and a fake internet, the workspace a spy; one test uses
 * the real workspace of the Acme Shop project against a fake GitHub to see the policy at work. Nothing reaches a network.
 *
 * What these hold down:
 *   - the brief's sections, in order: question, short answer, details, options compared, a recommendation for THIS project
 *     (the brain's stack is in it), gaps, numbered sources with the day each was read;
 *   - a citation to a source that does not exist is removed; a secret in the question or the answer is not kept;
 *   - the path and the commit: the date, a slug, -2 and -3 for a name that is taken, the message, one file;
 *   - the brief stands when the step that weighs the options cannot run, and says so;
 *   - the limit, a failed research, a dry run, and a commit that is a question for the person.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

noNetwork();

const { fakeCall, fixtureBrain, githubRig } = await import("./work-fixtures.js");
const { researchBrief, renderBrief, keepCitations, firstParagraph } = await import("../src/code/resources/brief.js");
const { resetWebCountersForTests, DailyCounter } = await import("../src/code/webTools.js");
const { MemoryWebCache, resetWebCacheForTests } = await import("../src/web/cache.js");
const { resetWebReaderForTests } = await import("../src/web/reader.js");
const { resetDdgForTests } = await import("../src/web/search/sources/ddg.js");
const { resetConfigForTests } = await import("../src/config.js");
type Source = import("../src/web/search/types.js").Source;
type FakeCall = ReturnType<typeof fakeCall>;

const T0 = Date.parse("2026-10-26T10:00:00.000Z");

beforeEach(() => {
  resetWebCountersForTests();
  resetWebCacheForTests();
  resetWebReaderForTests();
  resetDdgForTests();
  resetConfigForTests();
});

// ------------------------------------------------------------------ the fakes

const ARTICLE = `<!doctype html><html lang="en"><head><title>Choosing a date picker</title></head><body><main>
<h1>Choosing a date picker</h1><p>Intro paragraph that is long enough to be worth reading on its own, about date pickers.</p>
<h2>Options</h2><p>react-day-picker is small and maintained. ${"It is a good choice. ".repeat(30)}</p>
</main></body></html>`;

const src = (id: "ddg", n: number): Source => ({
  id, async search() { return Array.from({ length: n }, (_, i) => ({ title: `Page ${i}`, url: `https://blog${i}.example.com/post`, snippet: `about page ${i}`, source: id })); },
});
const internet = (n: number) => async (input: string | URL) => {
  const u = String(input);
  return /^https:\/\/blog\d+\.example\.com\/post/.test(u) ? new Response(ARTICLE, { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("no", { status: 404 });
};

const WEIGHED = {
  shortAnswer: "Use react-day-picker: it is small, maintained and fits React 18 [1].",
  options: [
    { name: "react-day-picker", what: "A small, unstyled date picker.", good: ["small [1]", "maintained"], watch: ["you style it yourself"], fit: "good" },
    { name: "react-datepicker", what: "A batteries-included picker.", good: ["styled"], watch: ["bigger bundle [9]"], fit: "good" },
  ],
  recommendation: { choice: "react-day-picker", because: "It fits the React 18 project and keeps the bundle small [1][7].", caveats: ["Check the licence of any add-on [2]."] },
};

function rig(o: { answer?: string; weighed?: unknown | null; pages?: number; extra?: Record<string, unknown> } = {}) {
  const fc = fakeCall();
  fc.on("web_research_answer", o.answer ?? "Date pickers differ in size [1]. react-day-picker is small and maintained [2]. Another claim [9].\n\nGAPS: none");
  if (o.weighed !== null) fc.on("work.brief", o.weighed ?? WEIGHED);
  const web = {
    userId: "alice", jobId: "job-1", budget: "job" as const, call: fc.call, store: null, cache: new MemoryWebCache(), now: () => T0,
    fetchFn: internet(o.pages ?? 6) as never, sources: { ddg: src("ddg", o.pages ?? 6) }, ...(o.extra ?? {}),
  };
  const commits: Array<{ files: Array<{ path: string; content?: string | null }>; message: string; opts: unknown }> = [];
  const taken = new Set<string>();
  const workspace = {
    read: vi.fn(async (p: string) => { if (taken.has(p)) return { path: p, size: 1, text: "x" }; throw new Error("not found"); }),
    commit: vi.fn(async (files: Array<{ path: string; content?: string | null }>, message: string, opts?: unknown) => { commits.push({ files, message, opts }); return { sha: "c".repeat(40), parentSha: "p".repeat(40) }; }),
  };
  return { fc, web, workspace, commits, taken };
}

async function project(workspace: ReturnType<typeof rig>["workspace"]) {
  const { brain } = await fixtureBrain({
    files: [{ path: "src/App.tsx" }],
    structure: {
      languages: [{ lang: "TypeScript", bytes: 1000, files: 3, pct: 100 }], frameworks: ["React", "Vite"], packageManagers: ["pnpm"],
      core: { "package.json": { sha: "x", kind: "npm", data: { name: "app", deps: ["react", "react-dom"], devDeps: [], depVersions: { react: "^18.2.0", "react-dom": "^18.2.0" } } } },
    },
  });
  return { brain, workspace: workspace as never };
}

const Q = "Which date picker should we use for the booking page?";

// ------------------------------------------------------------------ the brief

describe("researchBrief", () => {
  it("renders the question, a short answer, the details, the options, a recommendation for this project, and numbered sources with dates", async () => {
    const r = rig();
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    expect(out.markdown.match(/^#{1,2} .+$/gm)).toEqual(["# Which date picker should we use for the booking page?", "## Question", "## Short answer", "## Details", "## Options compared", "## Recommendation for this project", "## Sources"]);
    expect(out.markdown).toContain("_Research brief, 2026-10-26. Depth: quick. Confidence:");
    expect(out.markdown).toMatch(/## Short answer\n\nUse react-day-picker: it is small, maintained and fits React 18 \[1\]\./);
    expect(out.markdown).toContain("| Option | What it is | Good | Watch out | Fits this project |");
    expect(out.markdown).toContain("| react-day-picker | A small, unstyled date picker. | small [1]; maintained | you style it yourself | yes |");
    expect(out.markdown).toContain("_This project: TypeScript · React, Vite · pnpm._");
    expect(out.markdown).toContain("**react-day-picker.** It fits the React 18 project and keeps the bundle small [1].");
    expect(out.markdown).toContain("- Check the licence of any add-on [2].");
    expect(out.markdown).toMatch(/^1\. \[Choosing a date picker\]\(https:\/\/blog\d\.example\.com\/post\), read 2026-10-26/m);
  });

  it("removes a citation to a source that does not exist, in the details and in everything the weighing wrote", async () => {
    const r = rig();
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    expect(out.markdown).not.toMatch(/\[9\]/);
    expect(out.markdown).not.toMatch(/\[7\]/);
    expect(out.markdown).toContain("Another claim.");
    expect(out.markdown).toContain("| react-datepicker | A batteries-included picker. | styled | bigger bundle | yes |");
  });

  it("weighs the answer against the project: the cheap tier for a quick brief, the code tier for a standard one, charged to the job, and shown the stack", async () => {
    const r = rig();
    await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    await researchBrief(Q, await project(r.workspace), { depth: "standard", web: r.web });
    const calls = r.fc.of("work.brief");
    expect(calls.map((c) => c.tier)).toEqual(["cheap", "code"]);
    expect(calls[0]).toMatchObject({ jobId: "job-1", budget: "job", userId: "alice" });
    expect(calls[0]!.user).toContain("what the project is built with: TypeScript · React, Vite · pnpm");
    expect(calls[0]!.user).toContain("its dependencies: react, react-dom");
    expect(calls[0]!.user).toMatch(/the researched answer \(sources \[1, 2, 3\]\)/);
    expect(calls[0]!.system).toMatch(/Use only what the answer says/);
  });

  it("with the weighing unavailable it is still a brief: the research is the details, and it says what is missing", async () => {
    const r = rig({ weighed: null });
    r.fc.on("work.brief", () => { throw new Error("model down"); });
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    expect(out.markdown).toContain("_Not compared: the step that weighs the options could not run.");
    expect(out.markdown).toContain("## Details\n\nDate pickers differ in size [1].");
    expect(r.commits).toHaveLength(1);
  });

  it("a job that cannot afford the weighing gets the brief without it", async () => {
    const r = rig({ weighed: null });
    let n = 0;
    r.fc.on("work.brief", () => { n += 1; throw Object.assign(new Error("budget"), { code: "budget_exceeded" }); });
    // askJson treats a thrown budget error as "no help", exactly as the gateway's BudgetExceeded
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    expect(n).toBeGreaterThan(0);
    expect(out.markdown).toContain("_Not compared: the step that weighs the options could not run.");
    expect(out.markdown).toContain("_No recommendation was made: see the details._");
    expect(out.markdown).toMatch(/## Short answer\n\nDate pickers differ in size \[1\]\./);
    expect(r.commits).toHaveLength(1);
  });

  it("says when the research did not compare options or support a recommendation", async () => {
    const r = rig({ weighed: { shortAnswer: "It depends.", options: [], recommendation: null } });
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    expect(out.markdown).toContain("_The research did not compare options._");
    expect(out.markdown).toContain("_The research does not support a recommendation yet._");
  });

  it("keeps no secret: not in the question, not in what the model wrote", async () => {
    const key = ["gh", "p_"].join("") + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const r = rig({ answer: `Use the token ${key} to log in [1].\n\nGAPS: none` });
    const out = await researchBrief(`Which picker, given our key ${key}?`, await project(r.workspace), { depth: "quick", web: r.web });
    expect(out.markdown).not.toContain(key);
    expect(JSON.stringify(r.commits)).not.toContain(key);
    expect(out.path).not.toContain("ghp");
  });
});

describe("the path and the commit", () => {
  it("commits one file, docs/research/<date>-<slug>.md, with the brief in it, through the workspace", async () => {
    const r = rig();
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    expect(out.path).toBe("docs/research/2026-10-26-which-date-picker-should-we-use-for-the-booking.md");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]!.files).toEqual([{ path: out.path, content: out.markdown }]);
    expect(r.commits[0]!.message).toBe("docs: research brief on Which date picker should we use for the booking page?");
    expect(out.commit).toEqual({ sha: "c".repeat(40), parentSha: "p".repeat(40) });
  });

  it("a name that is taken gets -2, and -3 after that", async () => {
    const r = rig();
    const base = "docs/research/2026-10-26-which-date-picker-should-we-use-for-the-booking";
    r.taken.add(`${base}.md`);
    expect((await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web })).path).toBe(`${base}-2.md`);
    r.taken.add(`${base}-2.md`);
    expect((await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web })).path).toBe(`${base}-3.md`);
  });

  it("a slug is ASCII words, 48 characters at most, and 'research' when there are none", async () => {
    const r = rig();
    const long = await researchBrief("What is the best approach to structuring a very large monorepo with many teams and packages", await project(r.workspace), { depth: "quick", web: r.web });
    expect(long.path).toMatch(/^docs\/research\/2026-10-26-[a-z0-9-]{1,48}\.md$/);
    expect(long.path).not.toMatch(/-\.md$/);
    const hindi = await researchBrief("कौन सा पुस्तकालय बेहतर है", await project(r.workspace), { depth: "quick", web: r.web });
    expect(hindi.path).toBe("docs/research/2026-10-26-research.md");
  });

  it("a dry run commits nothing and says where it would go", async () => {
    const r = rig();
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web, dryRun: true });
    expect(out.commit).toBeNull();
    expect(out.path).toMatch(/^docs\/research\//);
    expect(r.workspace.commit).not.toHaveBeenCalled();
  });

  it("a commit that is a question for the person is returned as the question, and the yes is passed on", async () => {
    const r = rig();
    r.workspace.commit.mockResolvedValueOnce({ needsApproval: true, approvalId: "ap_1", action: "commit.other_branch", faceId: false, expiresAt: T0 + 60_000, summary: {} } as never);
    const out = await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    expect(out.commit).toMatchObject({ needsApproval: true, approvalId: "ap_1" });
    await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web, approvalId: "ap_1" });
    expect(r.commits[0]!.opts).toEqual({ approvalId: "ap_1" });
  });
});

describe("when it cannot be done", () => {
  it("is a BriefError when the daily number of research runs is used up", async () => {
    const r = rig({ extra: { counter: new DailyCounter(), caps: { research: 1 } } });
    await researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web });
    await expect(researchBrief(Q, await project(r.workspace), { depth: "quick", web: r.web })).rejects.toMatchObject({ name: "BriefError", code: "limit" });
    expect(r.commits).toHaveLength(1);
  });

  it("is a BriefError when the research cannot be set up, and nothing is committed", async () => {
    const r = rig();
    // a job budget with no job to charge is refused when the tools are made
    const web = { ...r.web, jobId: undefined };
    await expect(researchBrief(Q, await project(r.workspace), { depth: "quick", web: web as never })).rejects.toMatchObject({ name: "BriefError", code: "failed" });
    expect(r.commits).toHaveLength(0);
  });

  it("is a BriefError when nothing was found to read, and no brief is committed", async () => {
    const r = rig();
    const web = { ...r.web, sources: { ddg: { id: "ddg" as const, async search(): Promise<never> { throw new Error("search down"); } } } };
    await expect(researchBrief(Q, await project(r.workspace), { depth: "quick", web: web as never })).rejects.toMatchObject({ name: "BriefError", code: "empty" });
    expect(r.commits).toHaveLength(0);
    expect(r.fc.of("work.brief")).toHaveLength(0);
  });

  it("asks for a question", async () => {
    const r = rig();
    await expect(researchBrief("  ", await project(r.workspace), { depth: "quick", web: r.web })).rejects.toMatchObject({ code: "failed", message: "Say what to research." });
  });
});

describe("the pieces", () => {
  it("keepCitations keeps the numbers that name a source and the space before them only when it keeps them", () => {
    expect(keepCitations("a [1] b [4][2] c [9].", new Set([1, 2]))).toBe("a [1] b [2] c.");
    expect(keepCitations("no citations", new Set())).toBe("no citations");
  });

  it("firstParagraph skips headings and fences and is cut", () => {
    expect(firstParagraph("# Title\n\n```js\ncode\n```\n\nThe first real paragraph of the answer is here.\n\nSecond.")).toBe("The first real paragraph of the answer is here.");
    expect(firstParagraph("x ".repeat(500), 50).length).toBeLessThanOrEqual(50);
  });

  it("renderBrief puts gaps in when the research left any, and marks a partial run", () => {
    const md = renderBrief({
      question: "Q?", date: "2026-10-26", depth: "deep", stack: "",
      research: { answer: "An answer.", sources: [{ n: 1, title: "A [page]", url: "https://x.dev/a", fetchedAt: T0, cited: false }], confidence: 0.4, gaps: ["No benchmark was found."], pagesRead: 1, partial: true, stoppedBy: "budget" },
      weighed: null,
    });
    expect(md).toContain("Incomplete: it stopped on budget.");
    expect(md).toContain("## Gaps\n\n- No benchmark was found.");
    expect(md).toContain("1. [A page](https://x.dev/a), read 2026-10-26 (not cited)");
    expect(md.endsWith("\n")).toBe(true);
  });
});

// ------------------------------------------------------------------ with the real workspace

describe("committed through the real workspace, the policy applies", () => {
  it("a branch X0 Bot made takes the brief at once; the default branch is a question", async () => {
    const { createWorkBranch, workspace } = await import("../src/code/projects.js");
    const r = await githubRig();
    const { brain } = await fixtureBrain({ files: [{ path: "README.md" }] });
    const rg = rig();

    const branch = await createWorkBranch(r.d, "alice", r.projectId, "research date pickers");
    const own = await workspace(r.d, "alice", r.projectId, branch.branch);
    const out = await researchBrief(Q, { brain, workspace: own }, { depth: "quick", web: rg.web });
    expect(out.commit).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    const back = await own.read(out.path);
    expect(back.text).toBe(out.markdown);

    const onMain = await workspace(r.d, "alice", r.projectId, "main");
    const asked = await researchBrief(Q, { brain, workspace: onMain }, { depth: "quick", web: rg.web });
    expect(asked.commit).toMatchObject({ needsApproval: true, action: "commit.other_branch" });
  });
});

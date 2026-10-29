/**
 * THE BOTS APP'S CODE AREA (screens/code.ts, routes/botsCode.ts, src/botsCode):
 *
 *   - the pure parts: the line diff, the rules over grants, the estimate from past jobs, the brain's health and first tasks, intake answers
 *   - every screen for the phone and the window: lint-clean, the real numbers drawn, every button wired to its endpoint
 *   - the routes: a task starts plan-first on a new branch with the project's cap; picks add projects; rules and the cap are saved;
 *     merge answers the policy's questions with the person's press; a new project's answers go to the intake as words
 */
import { describe, expect, it, vi } from "vitest";
import type { Node } from "../../shared/types/sdui.js";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, supabase: () => null, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { diffLines, hunkRange } = await import("../src/botsCode/linediff.js");
const { rulesFrom, ruleChange, nextValue } = await import("../src/botsCode/rules.js");
const { estimate, typicalRange } = await import("../src/botsCode/history.js");
const { health, firstTasks, testsLine, isEmptyRepo, stackChips } = await import("../src/botsCode/brain.js");
const { answerText } = await import("../src/botsCode/intake.js");
const { resetCodeRulesStoreForTests, MemoryCodeRulesStore } = await import("../src/botsCode/store.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { registerBotsCodeRoutes } = await import("../src/routes/botsCode.js");

const P = "11111111-1111-4111-8111-111111111111";
const J = "7c1d2e3f-0000-4000-8000-0000000000aa";
const MIN = 60_000, H = 60 * MIN, D = 24 * H;
const NOW = FIXED_NOW;

// ---------------------------------------------------------------------------- the pure parts

describe("the line diff", () => {
  it("finds the changed lines with context, numbered as a person reads them", () => {
    const a = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].join("\n");
    const b = ["a", "b", "c", "D", "e", "f", "g", "h", "i", "j", "k", "l", "m"].join("\n");
    const hunks = diffLines(a, b)!;
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines.map((l) => `${l.kind}:${l.n}:${l.text}`)).toEqual(["ctx:2:b", "ctx:3:c", "del:4:d", "add:4:D", "ctx:5:e", "ctx:6:f"]);
    expect(hunks[1]!.lines.map((l) => `${l.kind}:${l.n}`)).toEqual(["ctx:11", "ctx:12", "add:13"]);
    expect(hunkRange(hunks[0]!)).toBe("L2–6");
  });
  it("a new file is all adds, an unchanged one has none, a huge one is not drawn", () => {
    expect(diffLines("", "x\ny")![0]!.lines.every((l) => l.kind === "add")).toBe(true);
    expect(diffLines("same\n", "same\n")).toEqual([]);
    expect(diffLines("x", Array.from({ length: 2000 }, (_, i) => String(i)).join("\n"))).toBeNull();
  });
});

describe("the project rules over the policy's grants", () => {
  const g = (id: string, action: string, effect: "allow" | "deny", branchPattern?: string) => ({ id, action, effect, ...(branchPattern ? { branchPattern } : {}) });
  it("reads each rule: a deny beats an allow, nothing is the policy's own default", () => {
    expect(rulesFrom([], "main")).toEqual({ prs: "yes", merge: "ask", main: "ask" });
    expect(rulesFrom([g("1", "commit.other_branch", "deny", "main"), g("2", "pr.merge", "allow"), g("3", "pr.merge", "deny")], "main")).toEqual({ prs: "yes", merge: "never", main: "never" });
    // A grant on another branch is not the "main" rule.
    expect(rulesFrom([g("1", "commit.other_branch", "deny", "develop")], "main").main).toBe("ask");
  });
  it("says what to take back and what to add", () => {
    const have = [g("1", "pr.merge", "deny"), g("2", "pr.merge", "allow")];
    expect(ruleChange("merge", "yes", have, "main")).toEqual({ remove: ["1", "2"], add: { action: "pr.merge", effect: "allow" } });
    expect(ruleChange("merge", "ask", have, "main")).toEqual({ remove: ["1", "2"], add: null });
    expect(ruleChange("main", "never", [], "main")).toEqual({ remove: [], add: { action: "commit.other_branch", branchPattern: "main", effect: "deny" } });
    expect(() => ruleChange("prs", "ask", [], "main")).toThrow();
    expect(nextValue("prs", "yes")).toBe("never");
    expect(nextValue("merge", "never")).toBe("yes");
  });
});

describe("what past jobs say", () => {
  const job = (spentPaise: number, minutes: number, projectId = P, state = "done") => ({ projectId, state, spentPaise, createdAt: NOW - minutes * MIN, updatedAt: NOW });
  it("nothing until three jobs are done; then the median, this project's first", () => {
    expect(estimate([job(500, 5), job(900, 9)], P)).toBeNull();
    expect(estimate([job(500, 5), job(900, 9), job(700, 30)], P)).toEqual({ costPaise: 700, minutes: 9, from: 3, here: true });
    expect(estimate([job(500, 5), job(900, 9), job(700, 30, "other")], P)).toMatchObject({ here: false, from: 3 });
    expect(typicalRange([job(400, 1), job(800, 1), job(1400, 1), job(2000, 1), job(100, 1, P, "failed")], P)).toEqual([800, 1400]);
  });
});

describe("the project brain in the home's words", () => {
  const brain = {
    status: "ready" as const,
    structure: { fileCount: 1284, frameworks: ["Next.js", "Supabase"], languages: [{ lang: "TypeScript", pct: 90 }], readme: { title: "x" }, testing: { frameworks: [], testFiles: 215, untestedHot: ["app/checkout/page.tsx"] } },
    features: [{ name: "Checkout", files: ["app/checkout/page.tsx"], fileCount: 22 }],
    baseline: { plan: [{ kind: "test", cmd: "pnpm test" }], recorded: { at: NOW, healthy: false, results: [{ kind: "test", exitCode: 1, summary: "212 passed, 3 failed", failing: ["a.test.ts", "b.test.ts", "c.test.ts"] }] } },
  };
  it("health, chips and first tasks from what was read", () => {
    expect(health(brain)).toMatchObject({ line: "212 of 215 tests pass", passed: 212, total: 215, failingCount: 3 });
    expect(stackChips(brain)).toEqual(["Next.js", "Supabase", "TypeScript", "1,284 files"]);
    expect(firstTasks(brain).map((t) => t.label)).toEqual(["Fix the 3 failing tests", "Add tests to Checkout"]);
    expect(testsLine({ status: "ready", structure: { fileCount: 3, testing: { frameworks: [], testFiles: 0, untestedHot: [] } } })).toBe("no tests yet · I can add some");
    expect(health({ status: "building" })).toBeNull();
    expect(isEmptyRepo({ status: "ready", structure: { fileCount: 0, note: "This repo has no commits yet." } })).toBe(true);
  });
  it("a new project's picks become words", () => {
    expect(answerText("platforms", { "phone-app": true, website: true }, "")).toBe("a phone app (one that can be added to the home screen), a website");
    expect(answerText("features", undefined, " Book a slot ")).toBe("Book a slot");
    expect(answerText("platforms", {}, "")).toBe("");
  });
});

// ---------------------------------------------------------------------------- the screens

const project = { id: P, fullName: "aanya-sharma/storefront", defaultBranch: "main", private: true, createdAt: NOW - 30 * D };
const job = (o: Record<string, unknown>) => ({
  id: J, projectId: P, branch: "tailzu/add-dark-mode-3f9a", task: "Add dark mode", state: "waiting_for_you", waitingOn: "approval", spentPaise: 120, budgetPaise: 4000,
  reason: "", createdAt: NOW - 5 * MIN, updatedAt: NOW - MIN, checkpoint: { notes: "" }, ...o,
});
const BRAIN = {
  status: "ready", builtAt: NOW - 5 * H,
  structure: { fileCount: 1284, frameworks: ["Next.js"], languages: [{ lang: "TypeScript", pct: 90 }], readme: { title: "x" }, testing: { frameworks: [], testFiles: 215, untestedHot: [] } },
  features: [{ name: "Payments", files: ["lib/upi.ts"], fileCount: 7 }],
  baseline: { plan: [{ kind: "lint", cmd: "pnpm lint" }], recorded: { at: NOW, healthy: false, results: [{ kind: "test", exitCode: 1, summary: "212 passed, 3 failed", failing: ["a.test.ts"] }] } },
};
const PLAN_AGENT = {
  phase: "plan", waiting: { kind: "approval", for: "plan", action: "job.plan", faceId: false },
  plan: { risk: "low", steps: [{ n: 1, do: "Add a light and a dark colour set", files: ["edit app/globals.css", "create lib/theme.ts"] }] },
};
const API: Record<string, unknown> = {
  "GET /v1/code/github": { connected: true, installations: [{ id: 1, account: "aanya-sharma", manageUrl: "https://github.com/settings/installations/1" }] },
  "GET /v1/code/projects": { projects: [project] },
  [`GET /v1/code/projects/${P}`]: { project },
  [`GET /v1/code/projects/${P}/brain`]: BRAIN,
  [`GET /v1/code/projects/${P}/branches`]: { branches: [{ branch: "tailzu/add-hindi-77aa", task: "Add Hindi to sign-up", prNumber: 126, prUrl: "u", state: "merged", createdAt: NOW - 2 * D }] },
  "GET /v1/code/jobs": { jobs: [job({}), job({ id: "7c1d2e3f-0000-4000-8000-0000000000bb", task: "Add Hindi to sign-up", branch: "tailzu/add-hindi-77aa", state: "done", waitingOn: null, updatedAt: NOW - 2 * D })] },
  [`GET /v1/code/jobs/${J}`]: { job: job({}), agent: PLAN_AGENT },
  "GET /v1/code/repos": { repos: [{ id: 101, fullName: "aanya-sharma/storefront", private: true, defaultBranch: "main" }, { id: 104, fullName: "aanya-sharma/api-server", private: true, defaultBranch: "develop" }], truncated: false },
  [`GET /v1/bots/code/projects/${P}/rules`]: {
    project, rules: { prs: "yes", merge: "ask", main: "never" }, capPaise: 4000, capSet: true, typical: [400, 1400], checks: ["pnpm lint", "pnpm test"],
    branchExample: "tailzu/add-dark-mode-3f9a", computers: [{ name: "Aanya's MacBook", on: true }],
  },
  [`GET /v1/bots/code/projects/${P}/intake`]: {
    project, request: "A booking app for my salon", answers: { what: "Customers of Glow Studio" }, answered: ["what"], state: "asking",
    questions: [{ id: "platforms", ask: "Where should it run?", why: "w" }, { id: "features", ask: "What must it do?", why: "w" }],
  },
};

async function build(screenId: string, client: "phone" | "desktop", params: Record<string, string | number> = {}, api: Record<string, unknown> = API, can: string[] = ["BotsKit"]) {
  const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(can), desk: { pages: false, notes: false } }, fakeDeps({ api }));
  const nodes = walk(s.root!);
  const words = nodes.map((n) => String(n.props?.content ?? "")).filter(Boolean);
  const json = JSON.stringify(s.root);
  return { s, words, json, lint: lintTree(s.root!) };
}

describe("the screens, for the phone and the window", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`bots.code (${client}): the project's real health, first tasks and jobs; a task starts plan-first`, async () => {
      const { words, json, lint } = await build("bots.code", client, { project: P });
      expect(lint).toEqual([]);
      expect(words).toContain(client === "phone" ? "212 of 215 tests pass" : "212");
      expect(words.some((w) => w.startsWith("Fix the 3 failing test"))).toBe(true);
      expect(words).toContain("Add dark mode");
      expect(json).toContain("/v1/bots/code/start");
      expect(json).toContain('"bots.code.rules"');
    });
    it(`bots.code.start meet / pick / read (${client})`, async () => {
      const meet = await build("bots.code.start", client, { step: "meet" }, { ...API, "GET /v1/code/github": { connected: false, installations: [] }, "POST /v1/code/github/connect": { installUrl: "https://github.com/apps/tailzu/installations/new?state=s" } });
      expect(meet.lint).toEqual([]);
      expect(meet.words).toContain("Hi, I'm Code bot.");
      expect(meet.json).toContain("https://github.com/apps/tailzu/installations/new?state=s");
      const pick = await build("bots.code.start", client, { step: "pick" });
      expect(pick.lint).toEqual([]);
      expect(pick.words).toContain("api-server");
      expect(pick.json).toContain("/v1/bots/code/projects/add");
      expect(pick.json).toContain("pick.104");
      const read = await build("bots.code.start", client, { step: "read", project: P });
      expect(read.lint).toEqual([]);
      expect(read.words).toContain("I've read storefront");
    });
    it(`bots.code.start meet (${client}): Connect GitHub signs in with GitHub where the server offers only that (no App)`, async () => {
      const authorizeUrl = "https://github.com/login/oauth/authorize?client_id=c&state=s";
      const oauthOnly = { ...API, "GET /v1/code/github": { configured: true, connected: false, installations: [], oauth: { connected: false } }, "POST /v1/code/github/signin": { authorizeUrl } };
      const meet = await build("bots.code.start", client, { step: "meet" }, oauthOnly);
      expect(meet.lint).toEqual([]);
      expect(meet.json).toContain(authorizeUrl);
      expect(meet.words).not.toContain("GitHub isn't set up on this server yet.");
      // Neither way set up: the button is there but can't be pressed, and it says why.
      const neither = await build("bots.code.start", client, { step: "meet" }, { ...API, "GET /v1/code/github": { configured: true, connected: false, installations: [] } });
      expect(neither.json).not.toContain("oauth/authorize");
      expect(neither.words).toContain("GitHub isn't set up on this server yet.");
    });
    it(`bots.code.start (${client}) with BotBuddy: one Code bot of his own across the steps, in one place, a moment per step`, async () => {
      const BUDDY = ["BotsKit", "BotsMotion", "BotBuddy"];
      const meetApi = { ...API, "GET /v1/code/github": { connected: false, installations: [] } };
      const steps = [["meet", "wave", meetApi], ["pick", "survey", API], ["read", "wave", API], ["home", "settle", API]] as const;
      const seen: Array<{ path: string; props: Record<string, unknown> }> = [];
      for (const [step, act, api] of steps) {
        const b = await build("bots.code.start", client, { step, ...(step === "read" ? { project: P } : {}) }, api, BUDDY);
        expect(b.lint, step).toEqual([]);
        const buddies = walk(b.s.root!).filter((n) => n.type === "BotBuddy");
        expect(buddies.map((n) => n.props?.life), step).toEqual(["code.setup"]);
        expect(buddies[0]!.props).toMatchObject({ kind: "code", color: "#4F7A3A", act });
        // Where he is in the tree: the same place on every step of the phone (under the back chevron).
        const path = (n: Node, target: Node, at = ""): string | null => n === target ? at : (n.children ?? []).reduce<string | null>((f, c, i) => f ?? path(c, target, `${at}/${i}`), null);
        seen.push({ path: path(b.s.root!, buddies[0]!)!, props: buddies[0]!.props as Record<string, unknown> });
      }
      for (const x of seen) expect({ width: x.props.width, height: x.props.height, size: x.props.size }).toEqual({ width: seen[0]!.props.width, height: seen[0]!.props.height, size: seen[0]!.props.size });
      if (client === "phone") expect(new Set(seen.map((x) => x.path)).size).toBe(1);
      // Meet: he is the one there, not the Blip; a build without BotBuddy keeps the Blip.
      const meet = await build("bots.code.start", client, { step: "meet" }, meetApi, BUDDY);
      expect(meet.json).not.toContain("/blip/");
      const plain = await build("bots.code.start", client, { step: "meet" }, meetApi, ["BotsKit", "BotsMotion"]);
      expect(plain.json).toContain("/blip/");
      expect(plain.json).not.toContain("BotBuddy");
    });
    it(`bots.code.new (${client}): the question, its quick answers and the plan so far`, async () => {
      const { words, json, lint } = await build("bots.code.new", client, { project: P });
      expect(lint).toEqual([]);
      expect(words).toContain("Where should it run?");
      expect(words).toContain("Question 2 of 3");
      expect(words).toContain("Website");
      expect(json).toContain(`/v1/bots/code/projects/${P}/intake/answer`);
    });
    it(`bots.code.plan (${client}): the steps, Start says yes in two steps`, async () => {
      const { words, json, lint } = await build("bots.code.plan", client, { id: J });
      expect(lint).toEqual([]);
      expect(words).toContain("Add a light and a dark colour set");
      expect(words).toContain("lib/theme.ts");
      expect(json).toContain(`/v1/code/jobs/${J}/approve`);
      expect(json).toContain("$state.q.approvalId");
      expect(json).toContain(`/v1/bots/code/jobs/${J}/replan`);
      expect(words).toContain("Payments");
    });
    it(`bots.code.rules (${client}): the rules, the cap and disconnect`, async () => {
      const { words, json, lint } = await build("bots.code.rules", client, { project: P });
      expect(lint).toEqual([]);
      expect(words).toEqual(expect.arrayContaining(["Checks with you", "Often", "Sometimes", "Rarely"]));
      expect(words.join(" ")).not.toMatch(/₹/);
      expect(words).toContain("pnpm lint");
      expect(json).toContain(`/v1/bots/code/projects/${P}/cap`);
      expect(json).toContain(`/v1/bots/code/projects/${P}/disconnect`);
      expect(json).toContain(`/v1/bots/code/projects/${P}/rules`);
    });
    it(`bots.code.review and bots.code.pr-care (${client}) with nothing to read: honest states`, async () => {
      const review = await build("bots.code.review", client, { id: J });
      expect(review.lint).toEqual([]);
      expect(review.words.some((w) => w.startsWith("I couldn't read the changes"))).toBe(true);
      const care = await build("bots.code.pr-care", client, { project: P, pr: 7 });
      expect(care.lint).toEqual([]);
      expect(care.words).toContain("I'm not looking after PR #7");
    });
  }

  it("bots.code.review draws the changed lines and merges through the Bots app's door", async () => {
    const enc = encodeURIComponent("tailzu/add-dark-mode-3f9a");
    const api = {
      ...API,
      [`GET /v1/code/jobs/${J}`]: { job: job({ state: "waiting_for_you" }), agent: { phase: "report", waiting: { kind: "approval", for: "ready" }, verify: { ran: true, ok: true, summary: "18 of 18 tests pass" } } },
      [`GET /v1/bots/code/projects/${P}/changes?branch=${enc}&job=${J}`]: {
        files: [{ path: "cart/total.ts", status: "modified", additions: 1, deletions: 1, why: "Rounds each line first.", hunks: diffLines("return round(sum);\n", "return items.reduce(add, 0);\n") }],
        totals: { files: 1, additions: 1, deletions: 1 }, commits: 1, truncated: false,
      },
      [`GET /v1/code/projects/${P}/branches/${enc}/pr`]: { number: 128, url: "https://github.com/x/y/pull/128", title: "t", state: "open", draft: true, mergeable: true, reviewDecision: null, reviewComments: 0 },
    };
    for (const client of ["phone", "desktop"] as const) {
      const { words, json, lint } = await build("bots.code.review", client, { id: J }, api);
      expect(lint).toEqual([]);
      expect(words).toContain("18 of 18 tests pass");
      expect(words.some((w) => w.includes("return items.reduce(add, 0);"))).toBe(true);
      expect(json).toContain("/v1/bots/code/merge");
      expect(json).toContain(`/v1/bots/code/jobs/${J}/change`);
    }
  });
});

// ---------------------------------------------------------------------------- the routes

/** The Code bot's own routes, faked, and its store: what the Bots app's doors call in-process. */
function served() {
  resetCodeRulesStoreForTests(new MemoryCodeRulesStore());
  const app = Fastify();
  const seen: Array<{ method: string; url: string; body: unknown }> = [];
  const grants: Array<{ id: string; action: string; branchPattern?: string; effect: "allow" | "deny" }> = [];
  let n = 0;
  const store = {
    getProject: async (userId: string, id: string) => (userId === "aanya" && id === P ? project : null),
    listGrants: async () => grants.slice(),
    deleteGrant: async (_p: string, id: string) => { const i = grants.findIndex((g) => g.id === id); if (i >= 0) grants.splice(i, 1); return i >= 0; },
    addGrant: async (_p: string, g: { action: string; branchPattern?: string; effect: "allow" | "deny" }) => { const row = { id: `g${++n}`, ...g }; grants.push(row); return row; },
    listBranches: async () => [],
  };
  const jobs = { listJobs: async () => [], defaultBudget: () => 3000, devices: { onlineFor: () => [] }, job: async () => null };
  registerBotsCodeRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots: null, code: { store, github: null, approvals: {}, oauth: null, oauthWanted: false, brain: null } as never, jobs: jobs as never, connectors: null, media: null, artifacts: null });
  const note = (method: string) => async (req: { url: string; body: unknown }) => { seen.push({ method, url: req.url, body: req.body }); };
  app.post(`/v1/code/projects/${P}/branches`, async (req) => { await note("POST")(req); return { branch: "tailzu/add-dark-mode-3f9a", baseSha: "abc" }; });
  app.post("/v1/code/jobs", async (req) => { await note("POST")(req); return { job: { id: J, ...(req.body as object) } }; });
  app.post("/v1/code/projects", async (req) => { await note("POST")(req); const id = (req.body as { repoId: number }).repoId; return { project: { id: `p-${id}`, fullName: `aanya/${id}` } }; });
  app.get(`/v1/code/projects/${P}/branches/:b/pr`, async () => ({ number: 128, state: "open", draft: true }));
  for (const path of [`/v1/code/projects/${P}/branches/:b/pr/ready`, `/v1/code/projects/${P}/branches/:b/pr/merge`]) {
    app.post(path, async (req) => {
      await note("POST")(req);
      const b = (req.body ?? {}) as { approvalId?: string };
      if (!b.approvalId) return { needsApproval: true, approvalId: `ok-${req.url.split("/").pop()}`, faceId: false };
      return req.url.endsWith("/merge") ? { merged: true, sha: "f00" } : { draft: false };
    });
  }
  app.post(`/v1/code/projects/${P}/intake`, async (req) => { await note("POST")(req); return { state: "asking", questions: [], answered: [] }; });
  return { app, seen, grants };
}
const who = (user: string) => ({ authorization: `Bearer ${user}` });

describe("Tell Code bot what to do, offline", () => {
  it("keeps the ask in the outbox for the Code bot (a build with one says it is offline); online, it asks as before", async () => {
    // Two projects: Code bot's overview, whose bar asks the bot (not one project's plan).
    const two = { ...API, "GET /v1/code/projects": { projects: [project, { ...project, id: "22222222-2222-4222-8222-222222222222", fullName: "aanya-sharma/salon-booking" }] } };
    for (const client of ["phone", "desktop"] as const) {
      const { json, lint } = await build("bots.code", client, {}, two);
      expect(lint, client).toEqual([]);
      expect(json, client).toContain('"if":{"eq":["online",false]},"then":{"kind":"sequence","actions":[{"kind":"outbox","op":"add","path":"/v1/shell/ask","body":{"message":"$state.task","bot":"code","device":"' + client + '","mode":"text"},"label":"$state.task","sub":"Code bot · asked {time}"},{"kind":"clearState","path":"task"},{"kind":"toast","message":"Kept. It will send when you\'re back."}]},"else":{"kind":"sequence","actions":[{"kind":"setState","path":"sent","value":"$state.task"},{"kind":"setState","path":"stopped","value":false},{"kind":"setState","path":"reply","value":null},{"kind":"clearState","path":"task"},{"kind":"setState","path":"asking","value":true},{"kind":"callEndpoint","method":"POST","path":"/v1/shell/ask"');
    }
    // In a project the bar starts a plan, which is not an ask: nothing is kept for it.
    const inProject = await build("bots.code", "phone", { project: P });
    expect(inProject.json).not.toContain('"sub":"Code bot · asked {time}"');
  });
});

describe("the Bots app's Code bot doors", () => {
  it("a task: a branch, then a plan-first job with the project's cap; another's project is a 404", async () => {
    const { app, seen } = served();
    await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/cap`, headers: who("aanya"), payload: { step: 1 } });
    const r = await app.inject({ method: "POST", url: "/v1/bots/code/start", headers: who("aanya"), payload: { projectId: P, task: "Add dark mode" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().job.id).toBe(J);
    expect(seen.map((s) => s.url)).toEqual([`/v1/code/projects/${P}/branches`, "/v1/code/jobs"]);
    expect(seen[1]!.body).toEqual({ projectId: P, branch: "tailzu/add-dark-mode-3f9a", task: "Add dark mode", planFirst: true, budgetPaise: 4000 });
    expect((await app.inject({ method: "POST", url: "/v1/bots/code/start", headers: who("bob"), payload: { projectId: P, task: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/bots/code/start", headers: who("aanya"), payload: { projectId: P } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/bots/code/start", payload: { projectId: P, task: "x" } })).statusCode).toBe(401);
  });

  it("picks add projects; rules become grants; the cap moves in ₹10 steps", async () => {
    const { app, grants } = served();
    const add = await app.inject({ method: "POST", url: "/v1/bots/code/projects/add", headers: who("aanya"), payload: { picks: { "101": true, "102": false, "nope": true } } });
    expect(add.json()).toEqual({ added: [{ id: "p-101", fullName: "aanya/101" }], failed: 0 });
    const r = await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/rules`, headers: who("aanya"), payload: { rule: "main", to: "never" } });
    expect(r.json().rules).toEqual({ prs: "yes", merge: "ask", main: "never" });
    expect(grants).toEqual([{ id: "g1", action: "commit.other_branch", branchPattern: "main", effect: "deny" }]);
    await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/rules`, headers: who("aanya"), payload: { rule: "main", to: "ask" } });
    expect(grants).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/rules`, headers: who("aanya"), payload: { rule: "prs", to: "ask" } })).statusCode).toBe(400);
    const cap = await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/cap`, headers: who("aanya"), payload: { step: -1 } });
    expect(cap.json()).toEqual({ capPaise: 2000 });
    const view = await app.inject({ method: "GET", url: `/v1/bots/code/projects/${P}/rules`, headers: who("aanya") });
    expect(view.json()).toMatchObject({ capPaise: 2000, capSet: true, rules: { main: "ask" }, branchExample: "tailzu/your-task" });
  });

  it("merge: a draft is marked ready, then merged, each question answered with the press", async () => {
    const { app, seen } = served();
    const r = await app.inject({ method: "POST", url: "/v1/bots/code/merge", headers: who("aanya"), payload: { projectId: P, branch: "tailzu/add-dark-mode-3f9a" } });
    expect(r.json()).toEqual({ merged: true, sha: "f00", prNumber: 128 });
    expect(seen.map((s) => `${s.url.split("/").slice(-2).join("/")} ${JSON.stringify(s.body ?? {})}`)).toEqual([
      'pr/ready {}', 'pr/ready {"approvalId":"ok-ready"}', 'pr/merge {}', 'pr/merge {"approvalId":"ok-merge"}',
    ]);
  });

  it("a new project's picks go to the intake as words", async () => {
    const { app, seen } = served();
    await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/intake/answer`, headers: who("aanya"), payload: { id: "platforms", picks: { website: true }, text: "" } });
    expect(seen[0]!.body).toEqual({ answers: { platforms: "a website" } });
    await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/intake/answer`, headers: who("aanya"), payload: { id: "features", skip: true } });
    expect(seen[1]!.body).toEqual({ answers: { features: "skip" } });
    expect((await app.inject({ method: "POST", url: `/v1/bots/code/projects/${P}/intake/answer`, headers: who("aanya"), payload: { id: "features", text: " " } })).statusCode).toBe(400);
  });
});

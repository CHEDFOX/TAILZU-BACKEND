/**
 * THE DESIGN ROUND (src/code/agent/design.ts, docs/artifacts.md section 11): after the checks pass, a job built from an approved design runs the app
 * on its runner, shoots it and the design, compares them, and sends MAJOR differences back to work (twice at most). Everything is the real loop over
 * the agent rig (a fake GitHub, a scripted runner and model); the preview is a fake room's, the shots are pictures made in memory, and the compare step
 * is the real one (artifacts/compare.ts) over a scripted vision model that is charged to the job. What these hold down:
 *
 *   - the happy path: session opened with the staged edits, the dev server started from the brain's scripts, the route found from where the design goes,
 *     both viewports shot and compared, the report carrying the match, the side-by-side links and the minor differences that remain, the preview closed;
 *   - major issues: back to work with the issues and fix hints in front of the model, the checks run again, a second look; the cap of two holds;
 *   - never blocking: no preview port, no compare step, not a web project, no dev script, no runner, a dev server that will not start or never answers,
 *     a shot step that is not set up, a budget too small: skipped with a sentence, and the job commits what the checks passed all the same;
 *   - the cost: each compare is charged to the job's budget; one the job cannot afford ends the check, not the job;
 *   - one advance at a time: a dev server that is still starting is waited for with the runner wait, and a viewport is an advance's work.
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

const { agentRig, call, done, APP_FILES, APP_STRUCTURE, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { sym, route } = await import("./work-fixtures.js");
const { createCompareHook } = await import("../src/artifacts/compare.js");
const { encodePng, fillRect, solid } = await import("../src/artifacts/pixels.js");
const { MemoryShotStore } = await import("../src/artifacts/shots.js");
const { ArtifactService } = await import("../src/artifacts/service.js");
const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
const { createAgent } = await import("../src/code/agent/index.js");
const { routerRunner } = await import("../src/code/agent/runner.js");
const { ApprovalBook } = await import("../src/code/approvals.js");
const { createWorkBranch } = await import("../src/code/projects.js");
const { designLines, previewCommand, targetRoute, viewportsFor, isWebProject } = await import("../src/code/agent/design.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;
type PreviewState = import("../src/code/live/ports.js").PreviewState;
type PreviewStarted = import("../src/code/live/ports.js").PreviewStarted;
type Advance = import("../src/code/agent/loop.js").Advance;

// ------------------------------------------------------------------ the project

const FILES: Record<string, string> = {
  ...APP_FILES,
  "package.json": JSON.stringify({ name: "app", scripts: { dev: "vite", test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } }, null, 2),
  "src/components/PricingCard.tsx": "export function PricingCard() { return null; }\n",
  "src/pages/Pricing.tsx": 'import { PricingCard } from "../components/PricingCard";\nexport default function Pricing() { return <PricingCard />; }\n',
};

const ROWS = [
  { path: "README.md", lang: "Markdown", summary: "What the app is." },
  { path: "src/util.ts", symbols: [sym("slug")], tests: ["src/util.test.ts"], summary: "String helpers: slug turns a title into a URL slug.", rank: 0.8 },
  { path: "src/util.test.ts", summary: "Tests for the string helpers." },
  { path: "src/index.ts", imports: ["src/util.ts"], symbols: [sym("title", "const")], summary: "The app's entry point." },
  { path: "src/legacy.ts", symbols: [sym("OLD", "const")], summary: "Old constants." },
  { path: "src/components/PricingCard.tsx", symbols: [sym("PricingCard", "component")], summary: "The pricing card." },
  { path: "src/pages/Pricing.tsx", imports: ["src/components/PricingCard.tsx"], symbols: [route("GET", "/pricing"), sym("Pricing", "component")], summary: "The pricing page." },
];

const structureWith = (o: { frameworks?: string[]; commands?: Array<{ kind: string; cmd: string; cwd: string; source: string }> } = {}) => ({
  ...APP_STRUCTURE,
  frameworks: o.frameworks ?? ["React", "Vite"],
  commands: o.commands ?? [...APP_STRUCTURE.commands, { kind: "dev" as const, cmd: "npm run dev", cwd: "", source: "package.json" }],
});

// -------------------------------------------------------------- the fake preview, shots and design

function fakePreview(script: PreviewState[] = [{ state: "ready", url: "https://tok.preview.example/" }]) {
  const p = {
    started: [] as Array<{ job: unknown; o: Record<string, any> }>,
    stopped: [] as string[],
    statusCalls: 0,
    startResult: { ok: true } as PreviewStarted,
    script,
    async start(job: unknown, o: Record<string, any>) { p.started.push({ job, o }); return p.startResult; },
    async status() { const s = p.script[Math.min(p.statusCalls, p.script.length - 1)]!; p.statusCalls += 1; return s; },
    async stop(_jobId: string, reason?: string) { p.stopped.push(reason ?? ""); },
  };
  return p;
}

function screen(o: { button?: [number, number, number]; w?: number; h?: number } = {}): Uint8Array {
  const w = o.w ?? 390;
  const h = o.h ?? 844;
  const r = solid(w, h, [255, 255, 255]);
  fillRect(r, 0, 0, w, 56, [24, 24, 27]);
  fillRect(r, 16, 80, w - 32, 180, [244, 244, 245]);
  fillRect(r, 32, 230, 120, 36, o.button ?? [37, 99, 235]);
  return encodePng(r);
}

const MINOR = { area: "the button", issue: "A slightly different blue.", severity: "minor", fixHint: "Use the primary token." };
const MAJOR = { area: "the card", issue: "The card has no padding; the text touches its edge.", severity: "major", fixHint: "Give the card p-4 and the radius token." };
const verdict = (match: number, ...issues: object[]) => ({ match, issues });

interface Setup {
  r: Rig;
  preview: ReturnType<typeof fakePreview>;
  compares: Array<{ jobId?: string; budget: unknown; viewport: string; images: number; user: string }>;
  verdicts: Array<ReturnType<typeof verdict> | Error>;
  shots: InstanceType<typeof MemoryShotStore>;
  jobId: string;
  branch: string;
  artifactId: string;
  /** The design deps the rig was made with, for an orchestrator of the test's own. */
  design: { compare: ReturnType<typeof createCompareHook> };
  /** Hands the job (with its design) to an orchestrator. */
  hand(orch: { enqueue(jobId: string, task: string, o: { spec: never; located: never }): Promise<unknown> }): Promise<unknown>;
}

/** A rig whose job was built from a design, with a scripted vision model; `verdicts` are what the vision tier says to each compare, in order (the last repeats). */
async function setup(o: {
  structure?: Parameters<typeof structureWith>[0]; preview?: ReturnType<typeof fakePreview> | null; design?: boolean; budgetPaise?: number; placeWaitMs?: number;
  shoot?: { viewerUrl?: string; accountId?: string };
  /** False: the job is made but handed to no orchestrator (the test hands it to its own). */
  enqueue?: boolean;
} = {}): Promise<Setup> {
  const preview = o.preview === null ? null : o.preview ?? fakePreview();
  const service = new ArtifactService({ store: new MemoryArtifactStore() });
  const made = await service.create("alice", { type: "react", title: "Pricing card", content: "export default function App() { return <h1>design</h1>; }" });
  const shots = new MemoryShotStore();
  const compares: Setup["compares"] = [];
  const verdicts: Setup["verdicts"] = [verdict(0.95, MINOR)];
  let rigRef: Rig | null = null;
  const hook = createCompareHook({
    shoot: { accountId: "a", apiToken: "t", viewerUrl: "https://shots.example", ...(o.shoot ?? {}) }, shots, artifacts: service,
    call: ((input: never, deps: never) => rigRef!.model.call(input, deps)) as never,
    shooter: {
      url: async (_u, opts) => screen({ button: [220, 38, 38], ...(opts.viewport === "desktop" ? { w: 1280, h: 800 } : {}) }),
      artifact: async (_a, _v, _k, viewport) => screen(viewport === "desktop" ? { w: 1280, h: 800 } : {}),
    },
  });
  const r = await agentRig({
    files: FILES, rows: ROWS, structure: structureWith(o.structure), ...(o.placeWaitMs ? { placeWaitMs: o.placeWaitMs } : {}),
    ...(preview ? { live: { preview } } : {}),
    ...(o.design === false ? {} : { design: { compare: hook, link: ({ artifactId, shotId }: { artifactId: string; shotId: string }) => `https://api.example/v1/artifacts/${artifactId}/shots/${shotId}?exp=9&sig=s` } }),
  });
  rigRef = r;
  let n = 0;
  r.json.on("artifact.compare", (input: any) => {
    const parts = (input.messages.find((m: any) => m.role === "user")?.content ?? []) as Array<{ type: string; text?: string }>;
    compares.push({
      jobId: input.jobId, budget: input.budget, viewport: /Viewport: (\w+)/.exec(parts.find((p) => p.type === "text")?.text ?? "")?.[1] ?? "", images: parts.filter((p) => p.type === "image_url").length, user: input.userId ?? "",
    });
    const v = verdicts[Math.min(n, verdicts.length - 1)]!;
    n += 1;
    if (v instanceof Error) throw v;
    return v;
  });
  r.json.on("work.plan", UTIL_PLAN);
  const { job, branch } = await r.start(UTIL_TASK, { enqueue: false, ...(o.budgetPaise ? { budgetPaise: o.budgetPaise } : {}) });
  const target = [{ path: "src/components/PricingCard.tsx", why: "the pricing card" }];
  const located = { targets: [{ path: target[0]!.path, why: target[0]!.why, signals: [], score: 1 }], related: [], tests: [], confidence: 0.9, used: { expanded: false, picked: false, paise: 0 } };
  const spec = { artifactId: made.artifact.id, version: 1, type: "react", title: "Pricing card", content: "export default function App() { return <h1>design</h1>; }", kit: "colors: primary #7c3aed", target, approvedAt: 1 };
  const hand: Setup["hand"] = (orch) => orch.enqueue(job.id, UTIL_TASK, { spec: spec as never, located: located as never });
  if (o.enqueue !== false) await hand(r.orch as never);
  return { r, preview: preview as never, compares, verdicts, shots, jobId: job.id, branch, artifactId: made.artifact.id, hand, design: { compare: hook } };
}

const edit = () => [call("edit_file", UTIL_EDIT), done("Built the card.")];

// ------------------------------------------------------------------ the pieces

describe("what to run, and where to look", () => {
  const cmd = (kind: string, c: string, cwd = "") => ({ kind: kind as never, cmd: c, cwd, source: "package.json" });

  it("takes the project's own dev script with its package manager's prefix, and the install to run before it", () => {
    expect(previewCommand([cmd("install", "npm ci"), cmd("dev", "npm run dev"), cmd("test", "npm test")])).toEqual({ cmd: "npm run dev", prepare: "npm ci" });
    expect(previewCommand([cmd("install", "pnpm install"), cmd("dev", "pnpm run dev")])).toEqual({ cmd: "pnpm run dev", prepare: "pnpm install" });
    expect(previewCommand([cmd("dev", "yarn dev")])).toEqual({ cmd: "yarn dev" });
    expect(previewCommand([cmd("install", "bun install"), cmd("dev", "bun run dev")])).toEqual({ cmd: "bun run dev", prepare: "bun install" });
    // start when there is no dev script; dev before start
    expect(previewCommand([cmd("run", "npm start")])).toEqual({ cmd: "npm start" });
    expect(previewCommand([cmd("run", "npm start"), cmd("dev", "npm run dev")])).toEqual({ cmd: "npm run dev" });
    // a package in a workspace is run from its folder, installed from the root
    expect(previewCommand([cmd("install", "pnpm install"), cmd("dev", "pnpm run dev", "apps/web")])).toEqual({ cmd: "cd apps/web && pnpm run dev", prepare: "pnpm install" });
    expect(previewCommand([cmd("dev", "npm run dev", "my app")])?.cmd).toBe("cd 'my app' && npm run dev");
    // the root's first
    expect(previewCommand([cmd("dev", "npm run dev", "apps/web"), cmd("dev", "npm run dev")])).toEqual({ cmd: "npm run dev" });
    // not a JavaScript project, or no script
    expect(previewCommand([cmd("test", "pytest"), cmd("run", "flutter run")])).toBeNull();
    expect(previewCommand([cmd("test", "npm test")])).toBeNull();
    expect(previewCommand([])).toBeNull();
  });

  it("knows a web project, and when mobile is the main target", () => {
    expect(isWebProject(["React", "Vite", "Tailwind CSS"])).toBe(true);
    expect(isWebProject(["Next.js"])).toBe(true);
    expect(isWebProject([])).toBe(true);
    expect(isWebProject(["Express", "Prisma"])).toBe(false);
    expect(isWebProject(["Electron"])).toBe(false);
    expect(viewportsFor(["React", "Vite"])).toEqual(["mobile", "desktop"]);
    expect(viewportsFor(["Next.js", "React"])).toEqual(["mobile", "desktop"]);
    expect(viewportsFor(["Expo", "React Native", "React"])).toEqual(["mobile"]);
    expect(viewportsFor(["React Native"])).toEqual(["mobile"]);
    expect(viewportsFor(["Expo", "Next.js"])).toEqual(["mobile", "desktop"]);
  });

  it("finds the page a design is shown on from the files that import it, else /", async () => {
    const s = await setup();
    // The route of the page that imports the card.
    const run = { brain: s.r.fixture.brain, ws: { read: async (p: string) => ({ text: FILES[p] ?? "" }) } } as never;
    expect(await targetRoute(run, [{ path: "src/components/PricingCard.tsx" }])).toEqual({ route: "/pricing", note: "the route /pricing of a page that shows it" });
    expect((await targetRoute(run, [{ path: "src/pages/Pricing.tsx" }])).route).toBe("/pricing");
    expect(await targetRoute(run, [{ path: "src/util.ts" }])).toMatchObject({ route: "/", note: expect.stringContaining("no page was found") });
    expect(await targetRoute(run, [])).toMatchObject({ route: "/" });
    // React Router: a <Route path element={<Name />}> in a file that imports it.
    const router = {
      brain: { file: async () => null, neighbors: async (p: string) => ({ imports: [], importedBy: p.endsWith("Card.tsx") ? ["src/App.tsx"] : [] }) },
      ws: { read: async () => ({ text: '<Routes><Route path="/plans" element={<Card />} /></Routes>' }) },
    } as never;
    expect(await targetRoute(router, [{ path: "src/components/Card.tsx" }])).toEqual({ route: "/plans", note: "the route /plans in src/App.tsx" });
    // A route that needs a value is not opened.
    const dyn = {
      brain: { file: async () => ({ symbols: [route("GET", "/users/[id]")] }), neighbors: async () => ({ imports: [], importedBy: [] }) }, ws: { read: async () => ({ text: "" }) },
    } as never;
    expect(await targetRoute(dyn, [{ path: "app/users/[id]/page.tsx" }])).toEqual({ route: "/", note: "its page (/users/[id]) needs a value, so the home page was used" });
    // An API route is not a page.
    const api = { brain: { file: async () => ({ symbols: [route("GET", "/api/items")] }), neighbors: async () => ({ imports: [], importedBy: [] }) }, ws: { read: async () => ({ text: "" }) } } as never;
    expect((await targetRoute(api, [{ path: "src/api.ts" }])).route).toBe("/");
  });
});

// ------------------------------------------------------------------ the happy path

describe("the design round", () => {
  it("opens the runner with the staged edits, starts the dev server, shoots both viewports, compares, and reports the match with side-by-side links", async () => {
    const s = await setup();
    s.verdicts[0] = verdict(0.93, MINOR);
    const { r } = s;
    r.model.push(...edit());
    await r.orch.idle();

    const j = await r.jobNow(s.jobId);
    expect(j.state).toBe("done");
    const st = await r.stateNow(s.jobId);
    expect(st.design).toMatchObject({ stage: "done", round: 0, route: "/pricing", viewports: ["mobile", "desktop"], history: [{ round: 0, major: 0, minor: 2 }] });

    // The runner was opened with the staged edit laid (the session command carries the overlay), after the checks.
    const session = r.runner.runs.find((x) => x.commands.some((c) => c.includes("process.exit(0)")))!;
    expect(session.overlay.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect(r.runner.runs.findIndex((x) => x === session)).toBeGreaterThan(r.runner.runs.findIndex((x) => x.wrapped && x.overlay.length));
    // The dev server: the project's own script, the install before it, the same staged edits, and then closed.
    expect(s.preview.started).toHaveLength(1);
    expect(s.preview.started[0]!.o).toMatchObject({ cmd: "npm run dev", prepare: "npm install", readySec: 90 });
    expect(s.preview.started[0]!.o.overlay.map((f: { path: string }) => f.path)).toEqual(["src/util.ts"]);
    expect(s.preview.started[0]!.job).toMatchObject({ id: s.jobId, userId: "alice" });
    expect(s.preview.stopped.at(-1)).toBe("done");

    // Both viewports, one compare each, with both pictures, metered in the job's budget.
    expect(s.compares.map((c) => [c.viewport, c.images, c.jobId, c.budget, c.user])).toEqual([["mobile", 2, s.jobId, "job", "alice"], ["desktop", 2, s.jobId, "job", "alice"]]);
    expect(s.shots.size).toBe(4);

    // The commit was made (the design round did not hold it), and the report carries the design check.
    expect(r.fake.commitCount(r.repo)).toBe(2);
    const report = st.report!.text;
    expect(report).toContain("The design");
    expect(report).toContain("Design check: the built page matches the approved design at 93%.");
    expect(report).toMatch(/- mobile: 93%\. Side by side: design https:\/\/api\.example\/v1\/artifacts\/[0-9a-f-]+\/shots\/[0-9a-f]{32}\?exp=9&sig=s \| built https:\/\/api\.example\/v1\/artifacts\/[0-9a-f-]+\/shots\/[0-9a-f]{32}/);
    expect(report).toContain("(the page /pricing: the route /pricing of a page that shows it)");
    expect(report).toContain("Still different (minor):");
    expect(report).toContain("mobile: the button: A slightly different blue.");
    expect(report).not.toContain("Still different (major)");
    // And the pull request says it too.
    expect(r.fake.pulls(r.repo)[0]!.body).toContain("## Design check");
    // The cost of the compares is in the job's spend.
    expect(j.spentPaise).toBeGreaterThanOrEqual(r.json.of("artifact.compare").length * r.json.paise);
    expect(r.model.seen.length).toBe(2); // the edit, and done: the design round asked the work model for nothing
  });

  it("is not asked about a job without a design: no preview, no session, nothing new in the report", async () => {
    const preview = fakePreview();
    const r = await agentRig({ files: FILES, rows: ROWS, structure: structureWith(), live: { preview } });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(...edit());
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    const st = await r.stateNow(job.id);
    expect(st.design).toBeUndefined();
    expect(preview.started).toEqual([]);
    expect(st.report!.text).not.toContain("Design check");
    expect(st.report!.text).not.toContain("The design");
  });

  it("goes back to work on MAJOR differences, with the issues and fix hints in front of the model, runs the checks again, and looks again", async () => {
    const s = await setup();
    s.verdicts.splice(0, s.verdicts.length, verdict(0.5, MAJOR, MINOR), verdict(0.5, MAJOR), verdict(0.96, MINOR), verdict(0.96, MINOR));
    const { r } = s;
    r.model.push(...edit(), done("Padded the card."));
    await r.orch.idle();

    const st = await r.stateNow(s.jobId);
    expect((await r.jobNow(s.jobId)).state).toBe("done");
    expect(st.design).toMatchObject({ stage: "done", round: 1 });
    expect(st.design!.history.map((h) => [h.round, h.major])).toEqual([[0, 2], [1, 0]]);
    // The model's next turn is shown what differs, as data, with the hint.
    const second = r.model.seen[2]!;
    expect(second.user).toContain("does not match the approved design yet (design round 1 of 2)");
    expect(second.user).toMatch(/<tool_data tool="design_check">[\s\S]*\[major\] mobile: the card: The card has no padding; the text touches its edge\. Fix: Give the card p-4 and the radius token\./);
    expect(second.user).toContain("[major] desktop: the card");
    // The checks ran again on the staged edits before the second look, and a second dev server was started.
    const verifies = r.runner.runs.filter((x) => x.wrapped && x.overlay.length);
    expect(verifies.length).toBe(2);
    expect(s.preview.started).toHaveLength(2);
    expect(s.preview.stopped).toContain("design round");
    expect(s.compares).toHaveLength(4);
    // After the second look nothing major is left, the feedback is gone, and the report tells the story.
    expect(st.work.designFeedback).toBeUndefined();
    expect(st.report!.text).toContain("matches the approved design at 96% after 1 round of fixes");
    expect(st.report!.text).toContain("Rounds: 50% → 96%");
    expect(r.fake.commitCount(r.repo)).toBe(2);
  });

  it("goes back to work at most twice: the third look is reported, with what still differs, and the job commits", async () => {
    const s = await setup({ structure: { frameworks: ["React", "Vite"] } });
    s.verdicts.splice(0, s.verdicts.length, verdict(0.4, MAJOR));
    const { r } = s;
    r.model.push(...edit(), done("Tried once."), done("Tried twice."));
    await r.orch.idle();

    const st = await r.stateNow(s.jobId);
    expect((await r.jobNow(s.jobId)).state).toBe("done");
    expect(st.design).toMatchObject({ stage: "done", round: 2 });
    expect(st.design!.history).toHaveLength(3);
    expect(s.compares).toHaveLength(6); // three looks, two viewports each: never a fourth
    expect(s.preview.started).toHaveLength(3);
    expect(r.model.seen.length).toBe(4); // the work (two turns), then one turn in each of the two rounds of fixes
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(st.report!.text).toContain("after 2 rounds of fixes");
    expect(st.report!.text).toContain("Still different (major):");
    expect(st.report!.text).toContain("mobile: the card: The card has no padding");
    expect(st.notes.join(" ")).toMatch(/still differs from the design in 2 major ways after 2 rounds of fixes/);
  });

  it("looks at mobile only when mobile is the project's main target", async () => {
    const s = await setup({ structure: { frameworks: ["Expo", "React Native", "React"] } });
    s.r.model.push(...edit());
    await s.r.orch.idle();
    expect(s.compares.map((c) => c.viewport)).toEqual(["mobile"]);
    expect((await s.r.stateNow(s.jobId)).design!.viewports).toEqual(["mobile"]);
  });

  it("does not ask the model about two shots that are the same, and says so", async () => {
    const s = await setup();
    // Re-make the hook's shooter so the shots are the same: replace the rig's design with one over alike pictures.
    const service = new ArtifactService({ store: new MemoryArtifactStore() });
    const made = await service.create("alice", { type: "react", title: "Pricing card", content: "export default function App() { return <h1>x</h1>; }" });
    const same = createCompareHook({
      shoot: { accountId: "a", apiToken: "t", viewerUrl: "https://shots.example" }, shots: new MemoryShotStore(), artifacts: service, call: s.r.model.call as never,
      shooter: { url: async () => screen(), artifact: async () => screen() },
    });
    const preview = fakePreview();
    const r = await agentRig({ files: FILES, rows: ROWS, structure: structureWith(), live: { preview }, design: { compare: same } });
    r.json.on("work.plan", UTIL_PLAN);
    r.json.on("artifact.compare", () => { throw new Error("the model should not be asked"); });
    r.model.push(...edit());
    const { job } = await r.start(UTIL_TASK, { enqueue: false });
    const spec = { artifactId: made.artifact.id, version: 1, type: "react", title: "Pricing card", content: "x", kit: "", target: [{ path: "src/components/PricingCard.tsx", why: "it" }], approvedAt: 1 };
    await r.orch.enqueue(job.id, UTIL_TASK, { spec });
    await r.orch.idle();
    const st = await r.stateNow(job.id);
    expect(st.design!.views.every((v) => v.gate === "same")).toBe(true);
    expect(st.report!.text).toContain("the two shots were alike, so no model was asked");
    expect(r.json.of("artifact.compare")).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ never blocking the commit

describe("a design round that cannot be done is skipped, with a sentence, and never blocks the commit", () => {
  /** The job ran to its end, committed, and the report says why there was no design check. */
  async function skipped(s: Setup, why: RegExp) {
    s.r.model.push(...edit());
    await s.r.orch.idle();
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
    expect(s.r.fake.files(s.r.repo, s.branch)["src/util.ts"]).toContain("^-+|-+$");
    const st = await s.r.stateNow(s.jobId);
    expect(st.design).toMatchObject({ stage: "done" });
    expect(st.design!.skipped).toMatch(why);
    expect(st.report!.text).toContain("Design check: not done.");
    expect(st.report!.text).toMatch(why);
    expect(s.compares).toEqual([]);
    return st;
  }

  it("when the server has no live preview (no runner kept open)", async () => {
    await skipped(await setup({ preview: null }), /no live runner to run the app on/);
  });

  it("when the server has no screenshot step", async () => {
    const s = await setup({ design: false });
    await skipped(s, /no screenshot step set up/);
    expect(s.preview.started).toEqual([]);
  });

  it("when the project is not a web app", async () => {
    const s = await setup({ structure: { frameworks: ["Express", "Prisma"] } });
    await skipped(s, /does not look like a web app \(Express, Prisma\)/);
    expect(s.preview.started).toEqual([]);
  });

  it("when there is no dev script to run it with", async () => {
    const s = await setup({ structure: { commands: APP_STRUCTURE.commands } });
    await skipped(s, /no dev script \(dev, serve or start\)/);
    expect(s.preview.started).toEqual([]);
  });

  it("when no computer is free for the runner", async () => {
    const s = await setup({ placeWaitMs: 4000 });
    s.r.runner.open = false;
    s.r.json.on("work.plan", UTIL_PLAN);
    // The checks need a computer too: they are "not run", and the job goes on; so does the design round, which says no computer was free.
    s.r.model.push(...edit());
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(st.design!.skipped).toMatch(/No computer was free to run the app on/);
    expect(s.preview.started).toEqual([]);
  });

  it("when the room says it cannot start the preview (previews are off on the Worker)", async () => {
    const preview = fakePreview();
    preview.startResult = { ok: false, reason: "off", message: "Previews are not set up on the Worker." };
    await skipped(await setup({ preview }), /could not be run for the design check \(Previews are not set up on the Worker\.\)/);
  });

  it("when the dev server will not start: its error is in the report, and the preview is closed", async () => {
    const preview = fakePreview([{ state: "starting" }, { state: "closed", error: "The dev server stopped (exit 1) before it answered. The end of what it printed: Error: Cannot find module 'vite'", closeReason: "failed" }]);
    const s = await setup({ preview });
    await skipped(s, /dev server did not start: The dev server stopped \(exit 1\) before it answered\. The end of what it printed: Error: Cannot find module 'vite'/);
    expect(preview.stopped.at(-1)).toBe("done");
  });

  it("when the dev server never answers in time", async () => {
    const preview = fakePreview([{ state: "starting" }]);
    const s = await setup({ preview });
    await skipped(s, /did not answer in time/);
  });

  it("when no browser is set up for shots: the compare step says so and the round ends", async () => {
    const s = await setup({ shoot: { accountId: "", viewerUrl: "https://shots.example" } });
    // accountId "" leaves no Cloudflare and no local browser.
    await skipped(s, /No browser is set up for screenshots/);
    expect(s.preview.started).toHaveLength(1);
  });

  it("when no viewer is set up for shots of a design", async () => {
    const s = await setup({ shoot: { viewerUrl: "" } });
    await skipped(s, /No viewer is set up for screenshots of a design/);
  });

  it("when the budget left is too small for it", async () => {
    // The work costs nearly all of the job's budget: less than two compares' worth is left.
    const s = await setup();
    s.r.model.paise = 1400;
    s.r.model.push(...edit());
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(st.design?.skipped ?? "").toMatch(/budget/);
    expect(s.compares).toEqual([]);
  });

  it("when CODE_DESIGN_CHECK is off the round is not even entered", async () => {
    process.env.CODE_DESIGN_CHECK = "false";
    const { resetConfigForTests } = await import("../src/config.js");
    resetConfigForTests();
    try {
      const s = await setup();
      s.r.model.push(...edit());
      await s.r.orch.idle();
      const st = await s.r.stateNow(s.jobId);
      expect((await s.r.jobNow(s.jobId)).state).toBe("done");
      expect(st.design).toBeUndefined();
      expect(s.preview.started).toEqual([]);
    } finally {
      delete process.env.CODE_DESIGN_CHECK;
      resetConfigForTests();
    }
  });
});

// ------------------------------------------------------------------ money

describe("the cost of the design check", () => {
  it("charges each compare to the job's budget, and a call the job cannot afford ends the check and not the job", async () => {
    const s = await setup();
    const { BudgetExceeded } = await import("../src/code/brain/gateway.js");
    s.verdicts.splice(0, s.verdicts.length, verdict(0.95, MINOR), new BudgetExceeded({ needPaise: 90, spentPaise: 2990, budgetPaise: 3000, scope: "job", purpose: "artifact.compare" }));
    s.r.model.push(...edit());
    await s.r.orch.idle();
    const j = await s.r.jobNow(s.jobId);
    const st = await s.r.stateNow(s.jobId);
    expect(j.state).toBe("done");
    // The first viewport was compared and charged; the second hit the job's limit, so the check ended there with a sentence.
    expect(s.compares.map((c) => c.viewport)).toEqual(["mobile", "desktop"]);
    expect(st.design!.views.map((v) => v.viewport)).toEqual(["mobile"]);
    expect(st.design!.skipped).toMatch(/budget ran out during the design check/);
    expect(st.design!.paise).toBeGreaterThan(0);
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
    // The one that was made is in the job's spend, as the work core's calls are.
    expect(j.spentPaise).toBeGreaterThanOrEqual(s.r.json.paise);
  });

  it("does not go back to work when the budget left cannot pay for another round: what differs is reported and the job commits", async () => {
    const s = await setup();
    s.verdicts.splice(0, s.verdicts.length, verdict(0.4, MAJOR));
    s.r.model.paise = 1100; // the work: two turns
    s.r.json.paise = 200; // each compare
    s.r.model.push(...edit());
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(s.compares).toHaveLength(2); // one look; no second round
    expect(st.design).toMatchObject({ stage: "done", round: 0 });
    expect(st.notes.join(" ")).toMatch(/the budget left was too small for another round/);
    expect(st.report!.text).toContain("Still different (major):");
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
  });
});

// ------------------------------------------------------------------ one advance at a time

describe("the design round, one advance at a time", () => {
  function worker(r: Rig, preview: ReturnType<typeof fakePreview>, design: NonNullable<Parameters<typeof agentRig>[0]>["design"]) {
    return createAgent({
      code: { ...r.code, approvals: new ApprovalBook({ now: r.now }) }, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog,
      intake: r.intake, routeStats: r.routeStats, notify: (u, k, d) => { r.told.push({ userId: u, kind: k, data: d }); }, now: r.now, sleep: r.sleep, log: r.log,
      web: { store: null, cache: null, fetchFn: (async () => new Response("no", { status: 404 })) as never },
      runner: routerRunner({ jobs: r.jobs, store: r.jobStore, now: r.now, sleep: r.sleep, placeWaitMs: 120_000, pollMs: 2000 }),
      passive: true, instanceId: "wf", live: { preview }, ...(design ? { design } : {}),
    })!;
  }

  it("waits for a dev server that is still starting with the runner wait (the room wakes the Workflow), and does one viewport per advance", async () => {
    const preview = fakePreview([{ state: "starting" }, { state: "starting" }, { state: "ready", url: "https://tok.preview.example/" }]);
    const s = await setup({ preview, enqueue: false });
    // The Worker's orchestrator: it does not poll, and takes the job only when it is handed it.
    const w = worker(s.r, preview, s.design as never);
    await s.hand(w as never);
    s.r.model.push(...edit());

    const seen: Advance[] = [];
    for (let i = 0; i < 300; i += 1) {
      const a = await w.advance(s.jobId, { holder: `wf-${i}`, turns: 2 });
      seen.push(a);
      if (a.next === "end") break;
      if (a.next === "wait") await s.r.sleep(a.waitMs ?? 1000);
    }
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(preview.statusCalls).toBeGreaterThanOrEqual(3);
    // A wait for the dev server is the runner wait, not a held step.
    expect(seen.filter((a) => a.next === "wait" && a.waitingOn === "runner").length).toBeGreaterThanOrEqual(2);
    const st = await s.r.stateNow(s.jobId);
    expect(st.design).toMatchObject({ stage: "done", round: 0 });
    expect(st.design!.views.map((v) => v.viewport)).toEqual(["mobile", "desktop"]);
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
  });
});

describe("designLines", () => {
  it("is empty for a job with no design check, says why a check did not run, and never makes up a match", () => {
    expect(designLines(undefined)).toEqual([]);
    expect(designLines({ stage: "done", round: 0, viewports: ["mobile"], views: [], history: [], paise: 0, skipped: "No computer was free." })).toEqual(["Design check: not done. No computer was free."]);
    expect(designLines({ stage: "done", round: 0, viewports: ["mobile"], views: [], history: [], paise: 0 })).toEqual([]);
    const out = designLines({
      stage: "done", round: 1, viewports: ["mobile"], paise: 4, history: [{ round: 0, match: 0.5, major: 1, minor: 0 }, { round: 1, match: 0.9, major: 0, minor: 1 }],
      views: [{ viewport: "mobile", match: 0.9, gate: "model", issues: [{ area: "button", issue: "shade", severity: "minor", fixHint: "token", viewport: "mobile" }], shots: { built: "b", approved: "a" } }],
    }, (id) => `https://l/${id}`);
    expect(out[0]).toBe("Design check: the built page matches the approved design at 90% after 1 round of fixes.");
    expect(out[1]).toBe("Rounds: 50% → 90%.");
    expect(out[2]).toContain("Side by side: design https://l/a | built https://l/b");
    expect(out.join("\n")).toContain("Still different (minor):");
  });
});

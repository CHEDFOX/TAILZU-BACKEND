/**
 * The screens round (src/code/agent/screens.ts) and a job's pictures (jobShots.ts, routes/code/jobShots.ts): a job that changed what people see runs
 * the app, keeps real screenshots of the page in its store and shows them by a signed link; one that changed nothing people see does not; one that
 * cannot says why, and the commit is never held.
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
const { MemoryBlobStore } = await import("../src/media/blob.js");
const { BlobJobShots, signJobShotPath, verifyJobShotLink, isJobShotId } = await import("../src/code/agent/jobShots.js");
const { seenFiles, screensLines } = await import("../src/code/agent/screens.js");
const { serveJobShot, isJobShotPath } = await import("../src/code/agent/jobShots.js");
type PreviewState = import("../src/code/live/ports.js").PreviewState;

const FILES: Record<string, string> = {
  ...APP_FILES,
  "package.json": JSON.stringify({ name: "app", scripts: { dev: "vite", test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } }, null, 2),
  "src/components/PricingCard.tsx": "export function PricingCard() { return <div className=\"card\">Pro</div>; }\n",
  "src/pages/Pricing.tsx": 'import { PricingCard } from "../components/PricingCard";\nexport default function Pricing() { return <PricingCard />; }\n',
};
const ROWS = [
  { path: "README.md", lang: "Markdown", summary: "What the app is." },
  { path: "src/util.ts", symbols: [sym("slug")], tests: ["src/util.test.ts"], summary: "String helpers.", rank: 0.8 },
  { path: "src/util.test.ts", summary: "Tests for the string helpers." },
  { path: "src/index.ts", imports: ["src/util.ts"], symbols: [sym("title", "const")], summary: "The app's entry point." },
  { path: "src/components/PricingCard.tsx", symbols: [sym("PricingCard", "component")], summary: "The pricing card." },
  { path: "src/pages/Pricing.tsx", imports: ["src/components/PricingCard.tsx"], symbols: [route("GET", "/pricing"), sym("Pricing", "component")], summary: "The pricing page." },
];
const STRUCTURE = { ...APP_STRUCTURE, frameworks: ["React", "Vite"], commands: [...APP_STRUCTURE.commands, { kind: "dev" as const, cmd: "npm run dev", cwd: "", source: "package.json" }] };
const CARD_EDIT = { path: "src/components/PricingCard.tsx", old: ">Pro<", new: ">Pro, ₹499 a month<" };
const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function fakePreview(script: PreviewState[] = [{ state: "ready", url: "https://tok.preview.example/" }]) {
  const p = {
    started: [] as Array<{ o: Record<string, any> }>, stopped: [] as string[], n: 0, script, ok: true,
    async start(_job: unknown, o: Record<string, any>) { p.started.push({ o }); return p.ok ? { ok: true as const } : { ok: false as const, reason: "no_session", message: "No runner is connected" }; },
    async status() { const s = p.script[Math.min(p.n, p.script.length - 1)]!; p.n += 1; return s; },
    async stop(_j: string, reason?: string) { p.stopped.push(reason ?? ""); },
  };
  return p;
}

async function setup(o: { preview?: ReturnType<typeof fakePreview> | null; shootFails?: boolean } = {}) {
  const preview = o.preview === null ? null : o.preview ?? fakePreview();
  const blobs = new MemoryBlobStore();
  const shot: Array<{ url: string; viewport: string }> = [];
  const screens = {
    shoot: async (url: string, viewport: "mobile" | "desktop") => { shot.push({ url, viewport }); if (o.shootFails) throw new Error("Browser Rendering said 429"); return PNG; },
    store: new BlobJobShots(blobs),
    link: ({ jobId, shotId }: { userId: string; jobId: string; shotId: string }) => `https://api.example/v1/code/shots/u/${jobId}/${shotId}?exp=9&sig=s`,
  };
  const r = await agentRig({ files: FILES, rows: ROWS, structure: STRUCTURE, ...(preview ? { live: { preview } } : {}), screens });
  r.json.on("work.plan", UTIL_PLAN);
  const { job } = await r.start(UTIL_TASK);
  return { r, preview, shot, blobs, jobId: job.id };
}

describe("what counts as something people see", () => {
  it("components, pages and styles; not tests, stories or plain code", () => {
    expect(seenFiles(["src/components/Card.tsx", "app/page.vue", "styles/site.css", "src/util.ts", "src/Card.test.tsx", "src/Card.stories.tsx", "tests/e2e/home.tsx", "types.d.ts"]))
      .toEqual(["src/components/Card.tsx", "app/page.vue", "styles/site.css"]);
  });

  it("the report's words: where the screens were taken, each link, or why there are none", () => {
    expect(screensLines({ stage: "done", route: "/pricing", viewports: ["mobile", "desktop"], shots: [{ id: "js_1", route: "/pricing", viewport: "mobile" }, { id: "js_2", route: "/pricing", viewport: "desktop" }] }, (id) => `https://x/${id}`))
      .toEqual(["Real screens: /pricing on a phone and a computer, taken from the running app.", "- Phone: https://x/js_1", "- Computer: https://x/js_2"]);
    expect(screensLines({ stage: "done", viewports: ["mobile"], shots: [], skipped: "the app's dev server did not start." })[0]).toMatch(/^No real screens: the app's dev server did not start\. Ask for a drawn one/);
    expect(screensLines(undefined)).toEqual([]);
  });
});

describe("the screens round", () => {
  it("a change people see: runs the app with the edit, shoots its page on a phone and a computer, keeps both, and the report shows them", async () => {
    const s = await setup();
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price on the card."));
    await s.r.orch.idle();
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    const st = await s.r.stateNow(s.jobId);
    expect(st.screens).toMatchObject({ stage: "done", route: "/pricing", viewports: ["mobile", "desktop"] });
    expect(s.preview!.started[0]!.o).toMatchObject({ cmd: "npm run dev", readySec: 90 });
    expect(s.preview!.started[0]!.o.overlay.map((f: { path: string }) => f.path)).toEqual(["src/components/PricingCard.tsx"]);
    expect(s.shot).toEqual([{ url: "https://tok.preview.example/pricing", viewport: "mobile" }, { url: "https://tok.preview.example/pricing", viewport: "desktop" }]);
    expect(s.preview!.stopped.at(-1)).toBe("screens");
    const shots = st.report!.shots!;
    expect(shots.map((x) => [x.route, x.viewport])).toEqual([["/pricing", "mobile"], ["/pricing", "desktop"]]);
    for (const x of shots) expect(isJobShotId(x.id)).toBe(true);
    expect(st.report!.text).toContain("The screens");
    expect(st.report!.text).toContain(`https://api.example/v1/code/shots/u/${s.jobId}/${shots[0]!.id}`);
    // Committed: the pictures never hold the change.
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
  });

  it("a change nobody sees: no app is run, no pictures", async () => {
    const s = await setup();
    s.r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed the dashes."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.screens).toBeUndefined();
    expect(s.preview!.started).toHaveLength(0);
    expect(st.report!.shots).toBeUndefined();
  });

  it("no runner to run the app on, or a dev server that never answers: one sentence in the report, and the commit goes on", async () => {
    const none = await setup({ preview: null });
    none.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await none.r.orch.idle();
    const a = await none.r.stateNow(none.jobId);
    expect(a.report!.text).toMatch(/No real screens: there is no live runner here to run the app on\./);
    expect(none.r.fake.commitCount(none.r.repo)).toBe(2);

    const dead = await setup({ preview: fakePreview([{ state: "closed", error: "vite: command not found" } as PreviewState]) });
    dead.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await dead.r.orch.idle();
    expect((await dead.r.stateNow(dead.jobId)).report!.text).toMatch(/No real screens: the app's dev server did not start: vite: command not found/);
  });

  it("a browser that fails: no pictures, said plainly", async () => {
    const s = await setup({ shootFails: true });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.report!.shots).toBeUndefined();
    expect(st.report!.text).toMatch(/No real screens: the screenshot failed \(Browser Rendering said 429\)/);
  });
});

describe("a job's pictures by their signed link", () => {
  it("are kept under the owner's key and read back", async () => {
    const blobs = new MemoryBlobStore();
    const store = new BlobJobShots(blobs);
    const { id } = await store.put(USER, JOB, PNG);
    expect(isJobShotId(id)).toBe(true);
    expect(await store.get(USER, JOB, id)).toEqual(PNG);
    expect(await store.get("33333333-3333-4333-8333-333333333333", JOB, id)).toBeNull();
  });

  it("a link opens for exactly its owner, job and picture, until it expires", () => {
    const path = signJobShotPath({ secret: "s3cret", userId: USER, jobId: JOB, shotId: "js_0123456789abcdef0123", now: 1000, ttlMs: 5000 });
    const q = new URL(path, "https://x").searchParams;
    const base = { secret: "s3cret", userId: USER, jobId: JOB, shotId: "js_0123456789abcdef0123", exp: q.get("exp"), sig: q.get("sig"), now: 2000 };
    expect(path.startsWith(`/v1/code/shots/${USER}/${JOB}/js_0123456789abcdef0123?`)).toBe(true);
    expect(verifyJobShotLink(base)).toBe(true);
    expect(verifyJobShotLink({ ...base, now: 7000 })).toBe(false);
    expect(verifyJobShotLink({ ...base, jobId: "33333333-3333-4333-8333-333333333333" })).toBe(false);
    expect(verifyJobShotLink({ ...base, secret: "other" })).toBe(false);
  });

  it("the Worker answers the picture for a good link, and the same 404 for anything else", async () => {
    const store = new BlobJobShots(new MemoryBlobStore());
    const { id } = await store.put(USER, JOB, PNG);
    const at = (path: string) => new URL(path, "https://jobs.example");
    const good = at(signJobShotPath({ secret: "s3cret", userId: USER, jobId: JOB, shotId: id }));
    expect(isJobShotPath(good.pathname)).toBe(true);
    const r = await serveJobShot({ url: good, store, secret: "s3cret" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    expect((await serveJobShot({ url: at(signJobShotPath({ secret: "wrong", userId: USER, jobId: JOB, shotId: id })), store, secret: "s3cret" })).status).toBe(404);
    expect((await serveJobShot({ url: at(`/v1/code/shots/${USER}/${JOB}/${id}`), store, secret: "s3cret" })).status).toBe(404);
    expect((await serveJobShot({ url: good, store: null, secret: "s3cret" })).status).toBe(404);
    expect(isJobShotPath("/v1/code/shots/../x/js_0")).toBe(false);
  });
});

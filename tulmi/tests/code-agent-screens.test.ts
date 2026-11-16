/**
 * The screens round (src/code/agent/screens.ts) and a job's pictures (jobShots.ts, routes/code/jobShots.ts): a job that changed what people see runs
 * the app, keeps real screenshots of the page in its store and shows them by a signed link; one that changed nothing people see does not; one that
 * cannot says why, and the commit is never held. And the floor (floor.ts): while the app is still up, the page is read as the browser drew it and
 * the things a page needs whatever its design says are checked on it — reported with the pictures, never blocking, and silent when it cannot be read.
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
const { noProbe } = await import("../src/code/agent/probe.js");
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

/** A page the floor has two things to say about: no viewport tag, and an image with no alt. */
const LOW_PAGE = '<!doctype html><html lang="en"><head><title>Pricing</title></head><body><h1>Pricing</h1><img src="/pro.png"></body></html>';
const SOUND_PAGE = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><h1>Pricing</h1></body></html>';

type Probe = import("../src/code/agent/probe.js").ProbeResult;

/**
 * A measurer that answers with a page that was drawn, used where a real Chrome would be. `then` is what the SECOND measurement sees, so a test can
 * say "the page was broken, the job fixed it, and the next look found it fixed" — which is the whole repair loop.
 */
function fakeMeasure(over: Partial<Probe> = {}, then?: Partial<Probe>) {
  const asked: Array<{ url: string; reduced: boolean }> = [];
  let pass = 0;
  const render = async (url: string, o: { reducedMotion?: boolean; script?: string }) => {
    asked.push({ url, reduced: o.reducedMotion === true });
    // One measurement is two loads; `then` takes over from the second measurement onward.
    const now = then && asked.length > 2 ? then : over;
    const base = {
      ...noProbe(), walked: 40, viewport: { w: 320, h: 720 }, doc: { scrollWidth: 320, clientWidth: 320 },
      text: [{ px: 16, weight: 400, chars: 300, fg: "17,24,39", bg: "255,255,255", at: "p" }], ...now,
    };
    if (!o.reducedMotion) pass += 1;
    // The motion pass is the only one that reports animations, as the real one does.
    return { value: o.reducedMotion ? { ...base, text: [], animations: now.animations ?? [] } : { ...base, animations: [] } };
  };
  return { render, asked, get passes() { return pass; } };
}

async function setup(o: { preview?: ReturnType<typeof fakePreview> | null; shootFails?: boolean; page?: string; readFails?: boolean; measure?: ReturnType<typeof fakeMeasure> } = {}) {
  const preview = o.preview === null ? null : o.preview ?? fakePreview();
  const blobs = new MemoryBlobStore();
  const shot: Array<{ url: string; viewport: string }> = [];
  const read: string[] = [];
  const screens = {
    shoot: async (url: string, viewport: "mobile" | "desktop") => { shot.push({ url, viewport }); if (o.shootFails) throw new Error("Browser Rendering said 429"); return PNG; },
    store: new BlobJobShots(blobs),
    link: ({ jobId, shotId }: { userId: string; jobId: string; shotId: string }) => `https://api.example/v1/code/shots/u/${jobId}/${shotId}?exp=9&sig=s`,
    ...(o.page || o.readFails
      ? { read: async (url: string) => { read.push(url); if (o.readFails) throw new Error("Browser Rendering said 429"); return o.page!; } }
      : {}),
    ...(o.measure ? { measure: o.measure.render as never } : {}),
  };
  const r = await agentRig({ files: FILES, rows: ROWS, structure: STRUCTURE, ...(preview ? { live: { preview } } : {}), screens });
  r.json.on("work.plan", UTIL_PLAN);
  const { job } = await r.start(UTIL_TASK);
  return { r, preview, shot, read, blobs, jobId: job.id };
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
    // The floor rides with the pictures, and a page with nothing wrong adds not one word.
    const withFloor = screensLines({ stage: "done", route: "/pricing", viewports: ["mobile"], shots: [{ id: "js_1", route: "/pricing", viewport: "mobile" }], floor: [{ rule: "viewport", count: 1, text: "The page has no viewport meta tag." }] }, () => null);
    expect(withFloor.at(-1)).toBe("- The page has no viewport meta tag.");
    expect(screensLines({ stage: "done", route: "/pricing", viewports: ["mobile"], shots: [{ id: "js_1", route: "/pricing", viewport: "mobile" }], floor: [] }, () => null)).toHaveLength(1);
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

  it("a browser that fails: no pictures, said plainly, and the floor it did read is still reported", async () => {
    const withPage = await setup({ shootFails: true, page: LOW_PAGE });
    withPage.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await withPage.r.orch.idle();
    const w = await withPage.r.stateNow(withPage.jobId);
    expect(w.report!.text).toMatch(/No real screens: the screenshot failed/);
    expect(w.report!.text).toContain("What the page needs whatever its design says");

    const s = await setup({ shootFails: true });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.report!.shots).toBeUndefined();
    expect(st.report!.text).toMatch(/No real screens: the screenshot failed \(Browser Rendering said 429\)/);
  });
});

describe("the floor, on the page that was shot", () => {
  it("reads the page the pictures were taken of, and the report says what it needs whatever its design says", async () => {
    const s = await setup({ page: LOW_PAGE });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price on the card."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    // The same address the pictures were taken of, read once, not once a size.
    expect(s.read).toEqual(["https://tok.preview.example/pricing"]);
    expect(st.screens!.floor!.map((f) => f.rule)).toEqual(["viewport", "img.alt"]);
    expect(st.report!.text).toContain("What the page needs whatever its design says");
    expect(st.report!.text).toMatch(/no viewport meta tag/);
    // And it held nothing up.
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
  });

  it("says nothing at all about a page with nothing wrong with it", async () => {
    const s = await setup({ page: SOUND_PAGE });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.screens!.floor).toEqual([]);
    expect(st.report!.text).not.toContain("What the page needs");
    expect(st.report!.text).toContain("Real screens");
  });

  it("a server with no renderer, or a page that will not answer: not checked, not mentioned, nothing held up", async () => {
    const none = await setup();
    none.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await none.r.orch.idle();
    const a = await none.r.stateNow(none.jobId);
    expect(a.screens!.floor).toBeUndefined();
    expect(a.report!.text).not.toContain("What the page needs");
    expect(a.report!.text).toContain("Real screens");

    const broken = await setup({ readFails: true });
    broken.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await broken.r.orch.idle();
    const b = await broken.r.stateNow(broken.jobId);
    expect(b.screens!.floor).toBeUndefined();
    expect(b.report!.text).not.toContain("What the page needs");
    expect(broken.r.fake.commitCount(broken.r.repo)).toBe(2);
  });
});

describe("the deeper look, on the page a browser drew", () => {
  it("measures the page twice — once as drawn, once with reduced motion — and reports what only a drawn page can show", async () => {
    // Two colours a person cannot tell apart: worth reporting, but not a fault to be repaired, so the job measures once and goes on.
    const m = fakeMeasure({ styles: { ...noProbe().styles, color: { "17,24,39": 90, "18,25,40": 2 }, fontSize: { "16px": 40, "13px": 1, "12px": 30 } } });
    const s = await setup({ measure: m });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    // One measurement is two loads of the same page, the second one telling it the person asked for less motion.
    expect(m.asked.map((a) => a.reduced)).toEqual([false, true]);
    expect(new Set(m.asked.map((a) => a.url))).toEqual(new Set(["https://tok.preview.example/pricing"]));
    expect(st.screens!.probe!.walked).toBe(40);
    expect(st.screens!.round, "nothing objective was wrong, so no round was spent").toBeUndefined();
    expect(st.report!.text).toMatch(/indistinguishable from another one already there/);
    expect(st.report!.text).toMatch(/13px is used once, 1px from 12px/);
    expect(st.report!.text).toMatch(/nobody knows what the right number is/);
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
  });

  it("says nothing when the page measures clean, and nothing at all where there is no browser to measure with", async () => {
    const clean = await setup({ measure: fakeMeasure() });
    clean.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await clean.r.orch.idle();
    const a = await clean.r.stateNow(clean.jobId);
    expect(a.screens!.probe).toBeTruthy();
    expect(a.report!.text).not.toContain("What the running page showed");

    const none = await setup();
    none.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await none.r.orch.idle();
    const b = await none.r.stateNow(none.jobId);
    expect(b.screens!.probe).toBeUndefined();
    expect(b.report!.text).toContain("Real screens");
  });

  it("a browser that throws mid-measure never costs the job anything", async () => {
    const broken = { render: async () => { throw new Error("Chrome closed under the page"); }, asked: [] };
    const s = await setup({ measure: broken as never });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.screens!.probe).toBeUndefined();
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
  });
});

describe("the repair round: what is objectively wrong gets fixed, not filed", () => {
  it("sends the job back with the measurements and the axis that fixes each one, then measures again and reports the before and after", async () => {
    // Broken first: text nobody can read. Clean on the second look, because the job fixed it.
    const m = fakeMeasure({ text: [{ px: 16, weight: 400, chars: 300, fg: "200,200,200", bg: "255,255,255", at: "p.hint" }] }, {});
    const s = await setup({ measure: m });
    s.r.model.push(
      call("edit_file", CARD_EDIT), done("Showed the price."),
      // The repair round: the job is back in work, and it is told what is wrong and how to fix it.
      call("edit_file", { path: "src/components/PricingCard.tsx", old: ">Pro, ₹499 a month<", new: ">Pro, ₹499 a month<" }), done("Darkened the hint text."),
    );
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);

    // It went back to work and was told the axis, not just the fault.
    const told = s.r.model.seen.map((t) => t.user).join("\n");
    expect(told).toContain("<tool_data tool=\"page_measured\">");
    expect(told).toMatch(/repair round 1 of 2/);
    expect(told).toMatch(/only the LIGHTNESS of the colour/);
    expect(told).toMatch(/not matters of taste/);

    // It measured again, and the report shows the before and the after rather than the list.
    expect(st.screens!.round).toBe(1);
    expect(m.passes).toBeGreaterThanOrEqual(2);
    expect(st.report!.text).toMatch(/measured, fixed and measured again: 1 thing\(s\) were wrong by any standard, 0 still are/);
    expect(st.report!.text).toContain("Fixed: text.contrast");
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
  });

  it("says honestly when the fix did not take, and stops after two rounds", async () => {
    // Broken, and still broken however many times it looks.
    const m = fakeMeasure({ focus: [{ at: "button.buy", changed: "", visible: true }] });
    const s = await setup({ measure: m });
    s.r.model.push(call("edit_file", CARD_EDIT), ...Array.from({ length: 8 }, () => done("Had a go at the focus ring.")));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.screens!.round).toBe(2);
    expect(st.report!.text).toMatch(/Still there: focus\.none/);
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    // Two rounds, and no more: a job cannot be held open by a page it cannot fix.
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
  });

  it("a page that measures clean costs the job nothing at all", async () => {
    const m = fakeMeasure();
    const s = await setup({ measure: m });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.screens!.round).toBeUndefined();
    expect(m.passes).toBe(1);
    expect(s.r.model.seen.map((t) => t.user).join("\n")).not.toContain("page_measured");
    expect(st.report!.text).not.toMatch(/measured, fixed and measured again/);
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

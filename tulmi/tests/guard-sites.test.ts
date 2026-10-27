/**
 * COALESCING AT THE SITES THAT USE IT (src/guard/coalesce.ts): the web tools' search and page read, a project's kit, the brain's queries.
 *
 * The coalescer itself is held down in guard-idempotency.test.ts. What is held down here is that each cheap read is wired to it, with a key that
 * tells the reads apart that are not the same one and joins the ones that are:
 *   - two jobs that search the same words at the same moment make one search (and spend one of the person's daily searches);
 *   - two jobs that read the same page make one request; a different page, or the same page cut differently, is its own;
 *   - two asks for one project's kit while it is being read are one read;
 *   - the brain's three searches are one query for the same question, and each caller gets a list of its own;
 *   - once a read has finished nothing is kept: the next one goes again (keeping is the cache's job).
 */
import { describe, expect, it, vi } from "vitest";
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

const { DailyCounter, makeWebTools } = await import("../src/code/webTools.js");
const { Coalescer, coalescer } = await import("../src/guard/coalesce.js");
const { designKit } = await import("../src/artifacts/kit.js");
const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
const { MemoryWebCache } = await import("../src/web/cache.js");
const { projectRig, built } = await import("./project-rig.js");
const { fixtureBrain, sym } = await import("./work-fixtures.js");
type CallInput = import("../src/code/brain/gateway.js").CallInput;
type CallResult = import("../src/code/brain/gateway.js").CallResult;
type FetchLike = import("../src/connectors/egress.js").FetchLike;
type Result = import("../src/web/search/types.js").Result;
type Source = import("../src/web/search/types.js").Source;
type ResultSource = import("../src/web/search/types.js").ResultSource;

const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const base = { userId: "user-1", jobId: "job-1", budget: "job" as const };

/** A promise held open until the test lets go: the read is "out" until then. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

// ------------------------------------------------------------------ the web tools

const res = (title: string, url: string, source: ResultSource): Result => ({ title, url, snippet: `about ${title}`, source });
const web = (n: number): Result[] => Array.from({ length: n }, (_, i) => res(`Page ${i}`, `https://blog${i}.example.com/post`, "ddg"));

/** A search source that waits at the gate and writes down every question it is asked. */
function source(id: ResultSource, held?: ReturnType<typeof gate>): Source & { calls: string[] } {
  const calls: string[] = [];
  return { id, calls, async search(q) { calls.push(q); if (held) await held.opened; return id === "ddg" ? web(3) : []; } };
}

const call = (async (input: CallInput) => ({
  text: "x", json: undefined, toolCalls: [], model: "m", paise: 1, costUsd: 0, promptTokens: 0, completionTokens: 0, costSource: "estimated", truncated: false, ms: 1, calls: 1, trail: [], purpose: input.purpose,
}) as unknown as CallResult) as typeof import("../src/code/brain/gateway.js").callModel;

const PAGE = `<!doctype html><html lang="en"><head><title>Guide</title></head><body><main><h1>Guide</h1><p>${"A paragraph of the guide. ".repeat(30)}</p><h2>Usage</h2><p>${"Use it. ".repeat(30)}</p></main></body></html>`;

function internet(held?: ReturnType<typeof gate>) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (input) => {
    calls.push(String(input));
    if (held) await held.opened;
    return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  return { calls, fetchFn };
}

function tools(o: { co: InstanceType<typeof Coalescer>; ddg: ReturnType<typeof source>; net?: ReturnType<typeof internet>; userId?: string; jobId?: string; counter?: InstanceType<typeof DailyCounter> }) {
  return makeWebTools({
    ...base, userId: o.userId ?? base.userId, jobId: o.jobId ?? base.jobId, call, gateway: { ledger: null } as never, store: null, cache: null, now: () => T0, coalesce: o.co,
    ...(o.counter ? { counter: o.counter } : {}), fetchFn: (o.net ?? internet()).fetchFn, sources: { ddg: o.ddg, github: source("github"), stackoverflow: source("stackoverflow") },
  });
}

describe("the web tools", () => {
  it("make one search for the same words asked by two jobs at once, and the second does not spend the person's allowance", async () => {
    const single = source("ddg");
    const spentOne = new DailyCounter();
    await tools({ co: new Coalescer(), ddg: single, counter: spentOne }).handlers.web_search({ query: "explain closures" });
    const perSearch = single.calls.length;
    expect(perSearch).toBeGreaterThan(0);
    const allowance = 200 - spentOne.left(base.userId, "search", 200, T0);
    expect(allowance).toBeGreaterThan(0);

    const co = new Coalescer();
    const held = gate();
    const ddg = source("ddg", held);
    const spentTwo = new DailyCounter();
    const a = tools({ co, ddg, jobId: "job-a", counter: spentTwo });
    const b = tools({ co, ddg, jobId: "job-b", counter: spentTwo });
    const first = a.handlers.web_search({ query: "explain closures" });
    const second = b.handlers.web_search({ query: "explain closures" });
    await tick();
    held.open();
    const [x, y] = await Promise.all([first, second]);
    expect(x.ok && y.ok).toBe(true);
    expect(y.content).toBe(x.content);
    expect(ddg.calls).toHaveLength(perSearch);
    expect(200 - spentTwo.left(base.userId, "search", 200, T0)).toBe(allowance);
    expect(co.stats()).toMatchObject({ started: 1, joined: 1, inflight: 0 });
  });

  it("keep searches apart that are not the same: other words, another depth, another person's own GitHub token", async () => {
    const co = new Coalescer();
    const held = gate();
    const ddg = source("ddg", held);
    const t = tools({ co, ddg });
    const runs = [
      t.handlers.web_search({ query: "explain closures" }),
      t.handlers.web_search({ query: "explain promises" }),
      t.handlers.web_search({ query: "explain closures", depth: "standard" }),
    ];
    await tick();
    expect(co.stats()).toMatchObject({ started: 3, joined: 0 });
    held.open();
    await Promise.all(runs);
    // a search made with a person's GitHub token is theirs: it is shared with no one else's
    const own = makeWebTools({ ...base, userId: "carol", githubToken: "ghp_x", call, store: null, cache: null, now: () => T0, coalesce: co, fetchFn: internet().fetchFn, sources: { ddg: source("ddg"), github: source("github"), stackoverflow: source("stackoverflow") } });
    const other = makeWebTools({ ...base, userId: "dave", githubToken: "ghp_y", call, store: null, cache: null, now: () => T0, coalesce: co, fetchFn: internet().fetchFn, sources: { ddg: source("ddg"), github: source("github"), stackoverflow: source("stackoverflow") } });
    const before = co.stats().started;
    await Promise.all([own.handlers.web_search({ query: "explain closures" }), other.handlers.web_search({ query: "explain closures" })]);
    expect(co.stats().started - before).toBe(2);
  });

  it("make one request for a page read by two jobs at once, and a different page, or the same page cut differently, is its own", async () => {
    const co = new Coalescer();
    const held = gate();
    const net = internet(held);
    const ddg = source("ddg");
    const a = tools({ co, ddg, net });
    const b = tools({ co, ddg, net });
    const url = "https://docs.example.com/guide";
    const same = [a.handlers.read_page({ url }), b.handlers.read_page({ url })];
    await tick();
    expect(co.stats()).toMatchObject({ started: 1, joined: 1 });
    held.open();
    const [x, y] = await Promise.all(same);
    expect(x.ok && y.ok).toBe(true);
    expect(y.content).toBe(x.content);
    expect(net.calls.filter((u) => u.startsWith(url))).toHaveLength(1);

    const held2 = gate();
    const net2 = internet(held2);
    const c = tools({ co: new Coalescer(), ddg, net: net2 });
    const apart = [
      c.handlers.read_page({ url }), c.handlers.read_page({ url: "https://docs.example.com/other" }), c.handlers.read_page({ url, section: "Usage" }),
    ];
    await tick();
    held2.open();
    await Promise.all(apart);
    expect(net2.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keep nothing once a read has finished: the next goes out again", async () => {
    const co = new Coalescer();
    const ddg = source("ddg");
    const net = internet();
    const t = tools({ co, ddg, net });
    const url = "https://docs.example.com/guide";
    await t.handlers.read_page({ url });
    const first = net.calls.length;
    await t.handlers.read_page({ url });
    expect(net.calls.length).toBeGreaterThan(first);
    expect(co.stats()).toMatchObject({ started: 2, joined: 0, inflight: 0 });
  });

  it("use the process's coalescer unless given another", async () => {
    const before = coalescer().stats().started;
    await makeWebTools({ ...base, call, store: null, cache: new MemoryWebCache(), now: () => T0, fetchFn: internet().fetchFn, sources: { ddg: source("ddg"), github: source("github"), stackoverflow: source("stackoverflow") } }).handlers.web_search({ query: "explain closures" });
    expect(coalescer().stats().started).toBeGreaterThan(before);
  });
});

// ------------------------------------------------------------------ the project's kit

describe("a project's kit", () => {
  const WEB = {
    "package.json": JSON.stringify({ name: "acme", dependencies: { react: "18.2.0", tailwindcss: "3.4.0" } }),
    "tailwind.config.js": `module.exports = { theme: { extend: { colors: { primary: "#7c3bed" } } } };\n`,
    "src/components/ui/button.tsx": `export function Button() { return <button className="rounded-md px-4">Go</button>; }\n`,
  } as Record<string, string>;
  const files = (held?: ReturnType<typeof gate>) => {
    const reads: string[] = [];
    return { reads, paths: async () => Object.keys(WEB), read: async (p: string) => { reads.push(p); if (held) await held.opened; return WEB[p] ?? null; } };
  };
  const project = (id: string) => ({ id, userId: "u1", name: "u1/app" });
  const P1 = "33333333-3333-4333-8333-333333333333";

  it("is one read for two asks while it is being read, and a forced read is its own", async () => {
    resetFor();
    const fb = await fixtureBrain({ files: [{ path: "src/components/ui/button.tsx", symbols: [sym("Button", "component")] }], structure: { frameworks: ["React", "Tailwind CSS"] } });
    const single = files();
    await designKit({ store: new MemoryArtifactStore(), files: single, brain: fb.brain }, project("44444444-4444-4444-8444-444444444444"));
    const perKit = single.reads.length;
    expect(perKit).toBeGreaterThan(0);

    const held = gate();
    const f = files(held);
    const deps = { store: new MemoryArtifactStore(), files: f, brain: fb.brain };
    const co = coalescer();
    const before = co.stats();
    const both = [designKit(deps, project(P1)), designKit(deps, project(P1))];
    await tick();
    expect(co.stats().started - before.started).toBe(1);
    expect(co.stats().joined - before.joined).toBe(1);
    held.open();
    const [a, b] = await Promise.all(both);
    expect(b.kit).toEqual(a.kit);
    expect(f.reads.length).toBe(perKit);
    // forced is a different read: it goes to the files even while an ordinary one is out
    const held2 = gate();
    const g = files(held2);
    const d2 = { store: new MemoryArtifactStore(), files: g, brain: fb.brain };
    const mixed = [designKit(d2, project(P1)), designKit(d2, project(P1), { force: true })];
    await tick();
    expect(co.stats().started - before.started).toBe(3);
    held2.open();
    await Promise.all(mixed);
  });

  it("keeps nothing once the read has finished: a project whose brain was never built is read again", async () => {
    resetFor();
    const f = files();
    const deps = { store: new MemoryArtifactStore(), files: f, brain: null };
    await designKit(deps, project(P1));
    const first = f.reads.length;
    await designKit(deps, project(P1));
    expect(f.reads.length).toBe(first * 2);
  });

  function resetFor() { coalescer().clear(); }
});

// ------------------------------------------------------------------ the brain's queries

describe("the brain's searches", () => {
  it("are one query for the same question asked while it is out, and each caller gets a list of its own", async () => {
    const r = await projectRig();
    await built(r);
    const b = await r.brain.open("alice", r.projectId);
    const store = r.brainStore;

    let queries = 0;
    const real = store.searchFiles.bind(store);
    const held = gate();
    store.searchFiles = (async (...args: Parameters<typeof real>) => { queries += 1; await held.opened; return real(...args); }) as typeof store.searchFiles;

    const [p1, p2, p3] = [b.findFiles("signup form"), b.findFiles("signup form"), b.findFiles("signup form", 3)];
    await tick();
    expect(queries).toBe(2);
    held.open();
    const [x, y, z] = await Promise.all([p1, p2, p3]);
    expect(x[0]).toMatchObject({ path: "src/components/SignupForm.tsx" });
    expect(y).toEqual(x);
    expect(y).not.toBe(x);
    expect(z.length).toBeLessThanOrEqual(3);
    // sorting one caller's list does not reorder another's
    x.reverse();
    expect(y[0]).toMatchObject({ path: "src/components/SignupForm.tsx" });
  });

  it("make the same query again once it has finished, and the symbol and text searches are coalesced the same way", async () => {
    const r = await projectRig();
    await built(r);
    const b = await r.brain.open("alice", r.projectId);
    const store = r.brainStore;
    let files = 0;
    let texts = 0;
    const realFiles = store.searchFiles.bind(store);
    const realTexts = store.searchTexts.bind(store);
    const held = gate();
    store.searchFiles = (async (...args: Parameters<typeof realFiles>) => { files += 1; await held.opened; return realFiles(...args); }) as typeof store.searchFiles;
    store.searchTexts = (async (...args: Parameters<typeof realTexts>) => { texts += 1; await held.opened; return realTexts(...args); }) as typeof store.searchTexts;

    const out = [b.findSymbols("fetchUsers"), b.findSymbols("fetchUsers"), b.findTexts("Sign up"), b.findTexts("Sign up")];
    await tick();
    expect([files, texts]).toEqual([1, 1]);
    held.open();
    await Promise.all(out);
    await b.findSymbols("fetchUsers");
    expect(files).toBe(2);
  });
});

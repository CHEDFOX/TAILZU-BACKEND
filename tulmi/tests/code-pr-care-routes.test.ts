/**
 * PR CARE OVER HTTP (src/routes/codeJobs.ts care routes, src/routes/code.ts webhook, src/code/webhook.ts): what the app calls to hand a pull request over, and
 * how GitHub's events reach the engine.
 *
 *   - the care routes want a session, are the owner's only, and answer 404 care_off on a server without the engine
 *   - handing over: open, in this repo, not the default branch; a fork's pull request is refused and its events are ignored
 *   - the webhook hands the seven events to PR care before anything else, whatever the rest of it does; a bad signature gets nothing; a failing hook never fails the delivery
 *   - a signed check_suite through the real route, to the real engine, ends in a fix job
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

const { call } = await import("./agent-rig.js");
const { careRig, CARE_EDIT } = await import("./care-rig.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { registerCodeRoutes } = await import("../src/routes/code.js");
const { handleWebhook, signatureFor } = await import("../src/code/webhook.js");
type Rig = Awaited<ReturnType<typeof careRig>>;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const SECRET = "whsec_" + "k".repeat(40);

const apps: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); resetSettingsStoreForTests(); });

async function jobsServer(r: Rig, o: { care?: boolean } = {}) {
  const app = Fastify();
  apps.push(app);
  registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0, agent: r.orch, ...(o.care === false ? {} : { care: r.care }) });
  await app.ready();
  const req = (user: string | null, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, req };
}

/** The webhook route on a bare Fastify, with the raw body kept as the real server keeps it. */
async function hookServer(r: Rig, hooks: Parameters<typeof registerCodeRoutes>[1]["hooks"]) {
  const app = Fastify();
  apps.push(app);
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error, undefined); }
  });
  registerCodeRoutes(app, { rateLimit: RL, code: r.code, ...(hooks ? { hooks } : {}) });
  await app.ready();
  const send = (event: string, payload: unknown, o: { signature?: string | null } = {}) => {
    const raw = JSON.stringify(payload);
    return app.inject({
      method: "POST", url: "/v1/code/github/webhook", payload: raw,
      headers: { "content-type": "application/json", "x-github-event": event, ...(o.signature === null ? {} : { "x-hub-signature-256": o.signature ?? signatureFor(raw, SECRET) }) },
    });
  };
  return { app, send };
}

describe("the care routes", () => {
  it("want a session, answer 404 care_off on a server without the engine, and are the owner's only", async () => {
    const r = await careRig();
    const s = await jobsServer(r);
    const url = `/v1/code/projects/${r.project.id}/care`;
    expect((await s.req(null, "GET", url)).statusCode).toBe(401);
    expect((await s.req(null, "POST", url, { prNumber: 1 })).statusCode).toBe(401);
    expect((await s.req(null, "DELETE", `${url}/1`)).statusCode).toBe(401);
    for (const [m, u] of [["GET", url], ["POST", url], ["DELETE", `${url}/1`]] as const) {
      const res = await s.req("bob", m, u, m === "POST" ? { prNumber: 1 } : undefined);
      expect(res.statusCode, `${m} ${u}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "not_found" });
    }
    const off = await jobsServer(r, { care: false });
    const res = await off.req("alice", "GET", url);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "care_off" });
  });

  it("hand a pull request over, list it with where it stands, and take it back", async () => {
    const r = await careRig();
    const s = await jobsServer(r);
    const url = `/v1/code/projects/${r.project.id}/care`;
    const repo = { installationId: 101, repoId: r.repo.id, fullName: r.repo.fullName, defaultBranch: "main" };
    await r.code.github!.createBranch(repo, "feature/x", "main");
    r.fake.push(r.repo, "feature/x", { "src/x.ts": "export const x = 1;\n" }, "add x");
    const opened = await r.code.github!.openDraftPr(repo, "feature/x", "Add x", "by a person");

    expect((await s.req("alice", "POST", url, { prNumber: "1" })).statusCode).toBe(400);
    const made = await s.req("alice", "POST", url, { prNumber: opened.number });
    expect(made.statusCode).toBe(200);
    expect(made.json().care).toMatchObject({ prNumber: opened.number, branch: "feature/x", origin: "handed", ended: null, working: [] });
    await r.settle();
    const list = (await s.req("alice", "GET", url)).json();
    expect(list.pulls).toEqual([expect.objectContaining({ prNumber: opened.number, origin: "handed", checks: { outcome: "green", names: [], note: "" } })]);
    // Handing it over twice is the same hand-over.
    expect((await s.req("alice", "POST", url, { prNumber: opened.number })).statusCode).toBe(200);
    expect((await s.req("alice", "GET", url)).json().pulls).toHaveLength(1);

    const gone = await s.req("alice", "DELETE", `${url}/${opened.number}`);
    expect(gone.json()).toEqual({ released: true });
    expect((await s.req("alice", "GET", url)).json().pulls).toEqual([]);
    expect((await s.req("alice", "DELETE", `${url}/${opened.number}`)).json()).toEqual({ released: false });
    expect((await s.req("alice", "DELETE", `${url}/0`)).statusCode).toBe(400);
  });

  it("refuse a pull request from a fork, which X0 Bot cannot push to, and ignore its events", async () => {
    const r = await careRig();
    const s = await jobsServer(r);
    const url = `/v1/code/projects/${r.project.id}/care`;
    const pr = await r.openPr();
    r.fake.editPull(r.repo, pr.number, { headRepoId: 424242 });
    const res = await s.req("alice", "POST", url, { prNumber: pr.number });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("fork");
    expect(await r.careStore.get(r.project.id, pr.number)).toBeNull();
    // Its events name a head in another repo: not looked at.
    const calls = r.fake.calls.length;
    r.care.onEvent("pull_request", { ...r.ev.pullRequest(pr.number, pr.branch), pull_request: { number: pr.number, head: { ref: pr.branch, repo: { id: 424242 } } } });
    // Checks on a fork's pull request are on this repo too, and the fork's branch may be named like one of ours: a head in another repo does not count.
    const forked = { number: 77, head: { ref: pr.branch, repo: { id: 424242 } }, base: { ref: "main", repo: { id: r.repo.id } } };
    r.care.onEvent("check_suite", { action: "completed", check_suite: { head_branch: pr.branch, pull_requests: [forked] }, repository: { id: r.repo.id }, sender: { login: "github-actions[bot]", type: "Bot" } });
    r.care.onEvent("check_run", { action: "completed", check_run: { check_suite: { head_branch: pr.branch }, pull_requests: [forked] }, repository: { id: r.repo.id }, sender: { login: "github-actions[bot]", type: "Bot" } });
    await r.settle();
    expect(r.fake.calls.length).toBe(calls);
    expect(await r.careStore.get(r.project.id, 77)).toBeNull();
  });
});

describe("GitHub's webhook", () => {
  it("hands the care events to PR care first, answers at once, and does not let a failing hook fail the delivery", async () => {
    const r = await careRig();
    const seen: string[] = [];
    const s = await hookServer(r, { care: (event) => { seen.push(event); throw new Error("boom"); } });
    for (const event of ["pull_request", "pull_request_review", "pull_request_review_comment", "issue_comment", "check_run", "check_suite", "status"]) {
      const res = await s.send(event, { action: "created", repository: { id: r.repo.id } });
      expect(res.statusCode, event).toBeLessThan(300);
    }
    expect(seen).toEqual(["pull_request", "pull_request_review", "pull_request_review_comment", "issue_comment", "check_run", "check_suite", "status"]);
    // Anything else is not PR care's.
    await s.send("installation", { action: "created", installation: { id: 101 } });
    expect(seen).toHaveLength(7);
  });

  it("gets nothing from a delivery with a bad signature", async () => {
    const r = await careRig();
    const seen: string[] = [];
    const s = await hookServer(r, { care: (event) => { seen.push(event); } });
    expect((await s.send("check_suite", {}, { signature: "sha256=" + "0".repeat(64) })).statusCode).toBe(401);
    expect((await s.send("check_suite", {}, { signature: null })).statusCode).toBe(401);
    expect(seen).toEqual([]);
  });

  it("hands a pull request on a branch that is not X0 Bot's to PR care too (a handed-over one), while its own bookkeeping stays for \"tailzu/\" branches", async () => {
    const r = await careRig();
    const seen: unknown[] = [];
    const payload = { action: "closed", number: 5, pull_request: { number: 5, merged: true, head: { ref: "feature/x", repo: { id: r.repo.id } } }, repository: { id: r.repo.id } };
    const out = await handleWebhook(r.code.store, "pull_request", payload, 1, { care: (_e, p) => { seen.push(p); } });
    expect(out).toBe("ignored");
    expect(seen).toEqual([payload]);
  });

  it("a push to the default branch reaches PR care, and a signed check_suite ends in a fix job", async () => {
    const r = await careRig();
    const pr = await r.openPr();
    r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch));
    await r.settle();
    const pushed: string[] = [];
    const s = await hookServer(r, { care: (e, p) => r.care.onEvent(e, p), pushed: async (project, after) => { pushed.push(`${project.fullName}@${after.slice(0, 7)}`); r.care.baseMoved(project); } });
    const sha = r.fake.push(r.repo, "main", { "README.md": "# app\n\nMore.\n" }, "main moves");
    const res = await s.send("push", { ref: "refs/heads/main", after: sha, repository: { id: r.repo.id } });
    expect(res.statusCode).toBe(200);
    expect(pushed).toEqual([`alice/app@${sha.slice(0, 7)}`]);
    // A red check arrives signed, through the route.
    const run = r.fake.addCheckRun(r.repo, pr.head(), { name: "test", conclusion: "failure" });
    r.fake.setJobLog(run.id, "AssertionError: expected 'a--b' to be 'a-b'");
    r.model.push(call("read_file", { path: "src/util.ts" }), call("edit_file", CARE_EDIT), call("done", { summary: "Trimmed." }));
    expect((await s.send("check_suite", r.ev.checkSuite(pr.number, pr.branch))).statusCode).toBeLessThan(300);
    await r.settle();
    expect(await r.careJobs()).toHaveLength(1);
    expect(r.fake.files(r.repo, pr.branch)["src/util.ts"]).toContain("s.trim()");
  });
});

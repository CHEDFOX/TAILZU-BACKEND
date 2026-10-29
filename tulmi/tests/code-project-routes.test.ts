/**
 * The project brain at the edges: its routes (202 and the status, owner-only
 * 404s, the first build when a project is added), GitHub's push webhook (stale at
 * once, built after a minute of quiet, never inline, other branches ignored),
 * the switch that keeps it off, and its migration.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// Whoever the test says is calling: the token is the user id; none is nobody.
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

const { projectRig, KEYS } = await import("./project-rig.js");
const { registerCodeRoutes } = await import("../src/routes/code.js");
const { signatureFor, handleWebhook } = await import("../src/code/webhook.js");
const { createCode } = await import("../src/code/index.js");
const { MemoryCodeStore } = await import("../src/code/store.js");
const { resetConfigForTests, getConfig } = await import("../src/config.js");
const { importBudgetFromEnv } = await import("../src/code/project/index.js");
const { FakeGithub } = await import("./github-fake.js");

type Rig = Awaited<ReturnType<typeof projectRig>>;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const SECRET = "whsec_" + "k".repeat(40);
const who = (user: string) => ({ authorization: `Bearer ${user}` });

/** The routes on a bare Fastify over the rig's Code object. */
async function served(r: Rig) {
  const app = Fastify();
  // The real server keeps the body GitHub signed, exactly as sent (server.ts does the same).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    done(null, JSON.parse((body as string) || "{}"));
  });
  registerCodeRoutes(app, { rateLimit: RL, code: r.code });
  await app.ready();
  const call = (user: string | null, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  const hook = (event: string, body: unknown) => {
    const raw = JSON.stringify(body);
    return app.inject({ method: "POST", url: "/v1/code/github/webhook", payload: raw, headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": signatureFor(raw, SECRET) } });
  };
  return { app, call, hook };
}

const push = (r: Rig, o: { ref?: string; deleted?: boolean; after?: string; repoId?: number } = {}) => ({
  ref: o.ref ?? "refs/heads/main", after: o.after ?? r.repo.head.sha, deleted: o.deleted ?? false, repository: { id: o.repoId ?? r.fakeRepo.id }, installation: { id: 101 },
});

/** The rig's project with its brain built, and the routes up. */
async function ready() {
  const r = await projectRig();
  await r.brain.build("alice", r.projectId, { mode: "full" });
  const s = await served(r);
  return { r, ...s };
}

describe("POST and GET /v1/code/projects/:id/brain", () => {
  it("starts a build and answers 202 with the status at once; the build goes on in the background", async () => {
    const r = await projectRig();
    const { call, app } = await served(r);
    let release!: () => void;
    r.gh.gate = new Promise<void>((res) => { release = res; });
    const res = await call("alice", "POST", `/v1/code/projects/${r.projectId}/brain`, {});
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "building", progress: { phase: "starting" }, structure: { fileCount: 0, languages: [] }, features: [] });
    const mid = await call("alice", "GET", `/v1/code/projects/${r.projectId}/brain`);
    expect(mid.statusCode).toBe(200);
    expect(mid.json().status).toBe("building");
    release();
    await vi.waitFor(async () => expect((await call("alice", "GET", `/v1/code/projects/${r.projectId}/brain`)).json().status).toBe("ready"));
    await app.close();
  });

  it("reports the status, progress, welcome, structure and features once built, and none of the build's own bookkeeping", async () => {
    const { r, call, app } = await ready();
    const res = await call("alice", "GET", `/v1/code/projects/${r.projectId}/brain`);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({ status: "ready", progress: { pct: 100, phase: "ready" }, headSha: r.repo.head.sha, summaries: "complete", error: "" });
    expect(b.welcome.length).toBeGreaterThan(40);
    expect(b.structure).toMatchObject({ mode: "full", frameworks: expect.arrayContaining(["Next.js"]) });
    expect(b.structure.core).toBeUndefined();
    expect(b.structure.skippedBlobs).toBeUndefined();
    expect(b.features.length).toBeGreaterThan(0);
    expect(b.conventions.rules.map((x: { path: string }) => x.path)).toEqual(["CLAUDE.md", "AGENTS.md"]);
    expect(b.baseline.plan.length).toBeGreaterThan(0);
    expect(typeof b.builtAt).toBe("number");
    expect(b.spentPaise).toBeGreaterThan(0);
    expect(JSON.stringify(b)).not.toMatch(/hunter2|sk_live|PRIVATE KEY/);
    await app.close();
  });

  it("says none for a project that has never been built, and builds incrementally when asked after a build", async () => {
    const r = await projectRig();
    const { call, app } = await served(r);
    const none = await call("alice", "GET", `/v1/code/projects/${r.projectId}/brain`);
    expect(none.json()).toMatchObject({ status: "none", structure: null, features: [], welcome: "" });
    // incremental with nothing built is a full build
    const first = await call("alice", "POST", `/v1/code/projects/${r.projectId}/brain`, { mode: "incremental" });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(async () => expect((await call("alice", "GET", `/v1/code/projects/${r.projectId}/brain`)).json().status).toBe("ready"));
    expect(r.logs.filter((l) => l.m === "code project brain built")[0]!.o).toMatchObject({ mode: "full" });
    r.repo.commit({ "src/lib/util.ts": "export const n = 1;\n" }, "change");
    expect((await call("alice", "POST", `/v1/code/projects/${r.projectId}/brain`, {})).statusCode).toBe(202);
    await vi.waitFor(() => expect(r.logs.filter((l) => l.m === "code project brain built")).toHaveLength(2));
    expect(r.logs.filter((l) => l.m === "code project brain built").pop()!.o).toMatchObject({ mode: "incremental", changed: 1 });
    await app.close();
  });

  it("returns the build that is running as it is, instead of starting another", async () => {
    const r = await projectRig();
    const { call, app } = await served(r);
    let release!: () => void;
    r.gh.gate = new Promise<void>((res) => { release = res; });
    await call("alice", "POST", `/v1/code/projects/${r.projectId}/brain`, { mode: "full" });
    const again = await call("alice", "POST", `/v1/code/projects/${r.projectId}/brain`, { mode: "full" });
    expect(again.statusCode).toBe(202);
    expect(again.json().status).toBe("building");
    release();
    await vi.waitFor(async () => expect((await call("alice", "GET", `/v1/code/projects/${r.projectId}/brain`)).json().status).toBe("ready"));
    expect(r.logs.filter((l) => l.m === "code project brain built")).toHaveLength(1);
    await app.close();
  });

  it("is the person's own: another person, an unknown id and a bad id are all a plain 404, and nothing is started", async () => {
    const r = await projectRig();
    const { call, app } = await served(r);
    r.gh.reset();
    for (const [user, id] of [["bob", r.projectId], ["alice", "00000000-0000-4000-8000-000000000000"], ["alice", "not-a-uuid"]] as const) {
      for (const method of ["GET", "POST"] as const) {
        const res = await call(user, method, `/v1/code/projects/${id}/brain`, method === "POST" ? {} : undefined);
        expect(res.statusCode, `${user} ${method} ${id}`).toBe(404);
        expect(res.json().code).toBe("not_found");
      }
    }
    expect(r.gh.calls).toHaveLength(0);
    expect(r.model.calls).toHaveLength(0);
    await app.close();
  });

  it("wants a session, and a mode that is one of the two", async () => {
    const r = await projectRig();
    const { call, app } = await served(r);
    for (const method of ["GET", "POST"] as const) expect((await call(null, method, `/v1/code/projects/${r.projectId}/brain`, method === "POST" ? {} : undefined)).statusCode).toBe(401);
    for (const bad of ["fast", 1, null, true, {}]) {
      const res = await call("alice", "POST", `/v1/code/projects/${r.projectId}/brain`, { mode: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json().code).toBe("bad_request");
    }
    await app.close();
  });

  it("is a 409 with the person's own words when GitHub has suspended the install, and starts nothing", async () => {
    const { r, call, app } = await ready();
    await r.store.setSuspended(101, r.fake.clock.t);
    r.gh.reset();
    const res = await call("alice", "POST", `/v1/code/projects/${r.projectId}/brain`, { mode: "full" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "suspended" });
    expect(r.gh.calls).toHaveLength(0);
    // The status is still the person's to read.
    expect((await call("alice", "GET", `/v1/code/projects/${r.projectId}/brain`)).statusCode).toBe(200);
    await app.close();
  });
});

describe("adding a project", () => {
  it("starts the first, full, build by itself, in the background, and says so", async () => {
    const r = await projectRig({ noProject: true });
    const { call, app } = await served(r);
    const repos = (await call("alice", "GET", "/v1/code/repos")).json().repos as Array<{ id: number }>;
    const added = await call("alice", "POST", "/v1/code/projects", { repoId: repos[0]!.id });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ created: true, brain: { status: "building" } });
    const id = added.json().project.id as string;
    await vi.waitFor(async () => expect((await call("alice", "GET", `/v1/code/projects/${id}/brain`)).json().status).toBe("ready"));
    expect(r.logs.filter((l) => l.m === "code project brain built")).toHaveLength(1);
    // Adding it again does not build again.
    const again = await call("alice", "POST", "/v1/code/projects", { repoId: repos[0]!.id });
    expect(again.json()).toEqual({ project: added.json().project, created: false });
    expect(r.logs.filter((l) => l.m === "code project brain built")).toHaveLength(1);
    await app.close();
  });

  it("forgets the brain with the project", async () => {
    const { r, call, app } = await ready();
    expect((await call("alice", "DELETE", `/v1/code/projects/${r.projectId}`)).statusCode).toBe(200);
    expect(await r.brainStore.getBrain(r.projectId)).toBeNull();
    expect(await r.brainStore.listFiles(r.projectId)).toEqual([]);
    await app.close();
  });
});

describe("with the project brain off", () => {
  it("answers 404 brain_off on both routes, before the session, and adding a project builds nothing", async () => {
    const r = await projectRig();
    const off = createCode({
      store: r.store, app: { slug: "s", clientId: r.fake.appClientId, clientSecret: r.fake.clientSecret, privateKey: KEYS.privateKeyPem }, oauth: null, webhookSecret: SECRET,
      fetchFn: r.gh.fetchFn, now: () => r.fake.clock.t, brain: false,
    });
    expect(off.brain).toBeNull();
    const app = Fastify();
    registerCodeRoutes(app, { rateLimit: RL, code: off });
    await app.ready();
    for (const method of ["GET", "POST"] as const) {
      for (const headers of [{}, who("alice")]) {
        const res = await app.inject({ method, url: `/v1/code/projects/${r.projectId}/brain`, headers, ...(method === "POST" ? { payload: {} } : {}) });
        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe("brain_off");
      }
    }
    r.gh.reset();
    const repos = (await app.inject({ method: "GET", url: "/v1/code/repos", headers: who("alice") })).json().repos as Array<{ id: number }>;
    const added = await app.inject({ method: "POST", url: "/v1/code/projects", headers: who("alice"), payload: { repoId: repos[0]!.id } });
    expect(added.json().brain).toBeUndefined();
    expect(r.gh.count(/\/tarball\//)).toBe(0);
    await app.close();
  });

  it("is off unless CODE_PROJECT_BRAIN is true, and a budget of 1,000 paise unless CODE_IMPORT_BUDGET_PAISE says otherwise", () => {
    const make = () => createCode({ store: new MemoryCodeStore(), app: { slug: "s", clientId: "c", clientSecret: "x", privateKey: KEYS.privateKeyPem }, oauth: null, webhookSecret: null, fetchFn: new FakeGithub(KEYS).fetchFn });
    resetConfigForTests();
    expect(getConfig().CODE_PROJECT_BRAIN).toBe(false);
    expect(make().brain).toBeNull();
    expect(importBudgetFromEnv()).toBe(1000);
    process.env.CODE_PROJECT_BRAIN = "true";
    process.env.CODE_IMPORT_BUDGET_PAISE = "250";
    resetConfigForTests();
    try {
      expect(make().brain).not.toBeNull();
      expect(importBudgetFromEnv()).toBe(250);
      process.env.CODE_IMPORT_BUDGET_PAISE = "0";
      resetConfigForTests();
      expect(importBudgetFromEnv()).toBe(0);
    } finally {
      delete process.env.CODE_PROJECT_BRAIN;
      delete process.env.CODE_IMPORT_BUDGET_PAISE;
      resetConfigForTests();
    }
  });
});

describe("GitHub's push webhook", () => {
  it("marks the brain stale at once, schedules an incremental build a minute later, and never calls GitHub while answering", async () => {
    const { r, hook, app } = await ready();
    r.repo.commit({ "src/lib/util.ts": "export const pushed = 1;\n" }, "someone pushed");
    r.gh.reset();
    const modelCalls = r.model.calls.length;
    const res = await hook("push", push(r));
    expect(res.statusCode).toBe(200);
    expect(r.gh.calls).toHaveLength(0);
    expect(r.model.calls).toHaveLength(modelCalls);
    expect((await r.brainStore.getBrain(r.projectId))!.status).toBe("stale");
    expect((await r.brain.get("alice", r.projectId)).status).toBe("stale");
    expect(r.timers.count).toBe(1);
    expect([...r.timers.pending.values()][0]!.ms).toBe(60_000);
    // Nothing has been built yet.
    expect((await r.brainStore.getBrain(r.projectId))!.headSha).not.toBe(r.repo.head.sha);

    r.timers.fire();
    await vi.waitFor(async () => expect((await r.brain.get("alice", r.projectId)).status).toBe("ready"));
    const row = (await r.brainStore.getBrain(r.projectId))!;
    expect(row.headSha).toBe(r.repo.head.sha);
    expect(r.logs.filter((l) => l.m === "code project brain built").pop()!.o).toMatchObject({ mode: "incremental", changed: 1 });
    expect(r.gh.count(/\/tarball\//)).toBe(0);
    await app.close();
  });

  it("waits for a minute of quiet: each push moves the timer, and only one build comes of three pushes", async () => {
    const { r, hook, app } = await ready();
    r.logs.length = 0;
    for (let i = 0; i < 3; i += 1) {
      r.repo.commit({ "src/lib/util.ts": `export const v = ${i};\n` }, `push ${i}`);
      expect((await hook("push", push(r))).statusCode).toBe(200);
      expect(r.timers.count).toBe(1);
    }
    expect(r.logs.filter((l) => l.m === "code project brain built")).toHaveLength(0);
    r.timers.fire();
    await vi.waitFor(async () => expect((await r.brain.get("alice", r.projectId)).headSha).toBe(r.repo.head.sha));
    expect(r.logs.filter((l) => l.m === "code project brain built")).toHaveLength(1);
    await app.close();
  });

  it("ignores a push to any other branch, a deleted branch, a repo nobody has a project on, and a delivery with no repo", async () => {
    const { r, hook, app } = await ready();
    const before = (await r.brainStore.getBrain(r.projectId))!.status;
    expect((await hook("push", push(r, { ref: "refs/heads/feature/x" }))).statusCode).toBe(202);
    expect((await hook("push", push(r, { ref: "refs/tags/v1" }))).statusCode).toBe(202);
    expect((await hook("push", push(r, { deleted: true }))).statusCode).toBe(202);
    expect((await hook("push", push(r, { repoId: 999_999 }))).statusCode).toBe(202);
    expect((await hook("push", { ref: "refs/heads/main" })).statusCode).toBe(202);
    expect((await hook("push", { ...push(r), ref: 5 })).statusCode).toBe(202);
    expect((await r.brainStore.getBrain(r.projectId))!.status).toBe(before);
    expect(r.timers.count).toBe(0);
    await app.close();
  });

  it("does nothing for a project that has no brain yet: its first build is the full one", async () => {
    const r = await projectRig();
    const { hook, app } = await served(r);
    const res = await hook("push", push(r));
    expect(res.statusCode).toBe(200);
    expect(r.timers.count).toBe(0);
    expect(await r.brainStore.getBrain(r.projectId)).toBeNull();
    await app.close();
  });

  it("follows every person's project on the repo", async () => {
    const { r, hook, app } = await ready();
    const bob = await r.store.createProject("bob", { installationId: 101, repoId: r.fakeRepo.id, fullName: "alice/acme", defaultBranch: "main", private: true });
    await r.brainStore.saveBrain(bob.id, { status: "ready", headSha: "a".repeat(40) });
    expect((await hook("push", push(r))).statusCode).toBe(200);
    expect((await r.brainStore.getBrain(bob.id))!.status).toBe("stale");
    expect((await r.brainStore.getBrain(r.projectId))!.status).toBe("stale");
    expect(r.timers.count).toBe(2);
    await app.close();
  });

  it("builds again after the build that was running when the push came", async () => {
    const { r, hook, app } = await ready();
    let release!: () => void;
    r.repo.commit({ "src/lib/util.ts": "export const one = 1;\n" }, "one");
    r.gh.gate = new Promise<void>((res) => { release = res; });
    // A full build is under way (held at the download)...
    const running = await r.brain.start("alice", r.projectId, { mode: "full" });
    await vi.waitFor(() => expect(r.gh.count(/\/tarball\//)).toBe(1));
    // ...and a push arrives: the brain is stale, the timer fires, and its build joins the queue.
    r.repo.commit({ "src/lib/util.ts": "export const two = 2;\n" }, "two");
    await hook("push", push(r));
    r.timers.fire();
    await vi.waitFor(() => expect(running.status.status).toBe("building"));
    release();
    await running.done;
    await vi.waitFor(async () => expect((await r.brainStore.getBrain(r.projectId))!.headSha).toBe(r.repo.head.sha));
    expect((await r.brainStore.getBrain(r.projectId))!.status).toBe("ready");
    await app.close();
  });

  it("is handled by handleWebhook alone, which only touches X0 Bot's own store and the hook it is given", async () => {
    const r = await projectRig();
    const seen: Array<[string, string]> = [];
    const hooks = { pushed: (p: { id: string }, after: string) => { seen.push([p.id, after]); } };
    expect(await handleWebhook(r.store, "push", push(r, { after: "b".repeat(40) }), Date.now(), hooks)).toBe("handled");
    expect(seen).toEqual([[r.projectId, "b".repeat(40)]]);
    // Without a hook there is nothing to do with a push.
    expect(await handleWebhook(r.store, "push", push(r))).toBe("ignored");
    // A malformed commit id is passed on as none.
    await handleWebhook(r.store, "push", { ...push(r), after: "nope" }, Date.now(), hooks);
    expect(seen[1]).toEqual([r.projectId, ""]);
    expect(r.gh.calls.filter((c) => c.path.includes("/repos/"))).toHaveLength(0);
  });

  it("dispose forgets the timers", async () => {
    const { r, hook, app } = await ready();
    await hook("push", push(r));
    expect(r.timers.count).toBe(1);
    r.brain.dispose();
    expect(r.timers.count).toBe(0);
    await app.close();
  });
});

// ------------------------------------------------------------------ migration

describe("migration 0028_code_project_brain.sql", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const supabaseDir = join(here, "..", "supabase");
  const migration = readFileSync(join(supabaseDir, "migrations", "0028_code_project_brain.sql"), "utf8");
  const full = readFileSync(join(supabaseDir, "full_schema.sql"), "utf8");
  const code = migration.replace(/--.*$/gm, "");

  it("makes code_brain with the columns the store reads and writes, one row to a project that goes with it", () => {
    expect(code).toMatch(/create table if not exists public\.code_brain\b/);
    for (const col of ["project_id", "head_sha", "tree_sha", "status", "progress", "structure", "conventions", "features", "memory", "welcome", "summaries_state", "baseline", "history", "spent_paise", "built_at", "error", "updated_at"]) {
      expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(code).toMatch(/project_id\s+uuid primary key references public\.code_projects \(id\) on delete cascade/);
    expect(code).toMatch(/status\s+text not null default 'building' check \(status in \('building', 'ready', 'failed', 'stale'\)\)/);
    expect(code).toMatch(/summaries_state text not null default 'none' check \(summaries_state in \('none', 'partial', 'complete'\)\)/);
  });

  it("makes code_brain_files keyed by (project, path), with the Merkle leaf, the symbols, the imports, and a generated search document with a GIN index", () => {
    expect(code).toMatch(/create table if not exists public\.code_brain_files/);
    for (const col of ["blob_sha", "lang", "bytes", "symbols", "imports", "rank", "hot", "todo", "tests", "summary", "tsv"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(code).toMatch(/imports\s+text\[\] not null default '\{\}'/);
    expect(code).toMatch(/tests\s+text\[\] not null default '\{\}'/);
    expect(code).toMatch(/primary key \(project_id, path\)/);
    expect(code).toMatch(/tsv\s+tsvector generated always as \([\s\S]*?to_tsvector\(\s*'simple'[\s\S]*?path[\s\S]*?jsonb_path_query_array\(symbols, '\$\[\*\]\.name'\)[\s\S]*?summary[\s\S]*?\) stored/);
    expect(code).toMatch(/create index if not exists code_brain_files_tsv_idx on public\.code_brain_files using gin \(tsv\)/);
    expect(code).toMatch(/create index if not exists code_brain_files_imports_idx on public\.code_brain_files using gin \(imports\)/);
  });

  it("makes code_brain_dirs and code_brain_texts, the second with a generated, indexed search document", () => {
    expect(code).toMatch(/create table if not exists public\.code_brain_dirs/);
    expect(code).toMatch(/tree_sha\s+text not null/);
    expect(code).toMatch(/create table if not exists public\.code_brain_texts/);
    for (const col of ["path", "line", "text", "kind", "tsv"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(code).toMatch(/tsv\s+tsvector generated always as \(\s*to_tsvector\('simple', regexp_replace\(text, '\[\^\[:alnum:\]\]\+', ' ', 'g'\)\)\s*\) stored/);
    expect(code).toMatch(/create index if not exists code_brain_texts_tsv_idx on public\.code_brain_texts using gin \(tsv\)/);
  });

  it("every table goes with its project", () => {
    expect(code.match(/references public\.code_projects \(id\) on delete cascade/g)).toHaveLength(4);
  });

  it("lets a person READ the rows of their own projects, as 0020 does, and nobody write: row-level security on, select policies only", () => {
    for (const t of ["code_brain", "code_brain_files", "code_brain_dirs", "code_brain_texts"]) {
      expect(code, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(code, t).toMatch(new RegExp(`create policy "users read own ${t.replace(/_/g, " ")}"\\s+on public\\.${t} for select\\s+using \\(exists \\(\\s+select 1 from public\\.code_projects p\\s+where p\\.id = ${t}\\.project_id and p\\.user_id = auth\\.uid\\(\\)`));
    }
    expect(code.match(/create policy/g)).toHaveLength(4);
    expect(code).not.toMatch(/for (insert|update|delete|all)/i);
    expect(code).not.toMatch(/grant /i);
  });

  it("follows 0027 in the migrations folder and can be run again: every create is guarded, every policy dropped first", () => {
    const names = readdirSync(join(supabaseDir, "migrations")).sort();
    const at = names.indexOf("0028_code_project_brain.sql");
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe("0027_web_search.sql");
    for (const st of code.split(";").map((x) => x.trim()).filter(Boolean)) {
      if (/^create (table|index)/i.test(st)) expect(st).toMatch(/if not exists/i);
      if (/^create policy/i.test(st)) expect(code).toContain(`drop policy if exists ${/create policy ("[^"]+")/i.exec(st)![1]}`);
    }
  });

  it("is in full_schema.sql, under its own heading, after 0027, and the same text", () => {
    expect(full).toContain("-- 0028_code_project_brain.sql");
    expect(full.indexOf("-- 0028_code_project_brain.sql")).toBeGreaterThan(full.indexOf("-- 0027_web_search.sql"));
    expect(full).toContain(migration.trim());
    for (const t of ["code_brain", "code_brain_files", "code_brain_dirs", "code_brain_texts"]) expect(full.match(new RegExp(`create table if not exists public\\.${t}\\b`, "g")), t).toHaveLength(1);
    expect(full.endsWith("\n")).toBe(true);
  });
});

/**
 * The Code bot's routes: off, not set up, behind a session, the install flow
 * from the install link to the done page, repos, projects, work branches and
 * draft PRs, and GitHub's webhook through the real server (so the raw body it
 * signs is the one the server keeps).
 *
 * GitHub is a fake behind an injected fetchFn (tests/github-fake.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

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
vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  resolveUser: async (h: string | undefined) => {
    const id = h?.replace(/^Bearer\s+/i, "").trim();
    return id ? { id } : null;
  },
}));

const { appKeys, FakeGithub } = await import("./github-fake.js");
const { createCode } = await import("../src/code/index.js");
const { MemoryCodeStore, codeStore, resetCodeStoreForTests } = await import("../src/code/store.js");
const { signatureFor } = await import("../src/code/webhook.js");
const { CODE_STATE_ID } = await import("../src/code/link.js");
const { registerCodeRoutes } = await import("../src/routes/code.js");
const { signState } = await import("../src/connectors/oauth.js");
const { ENV_KEYS, getConfig, resetConfigForTests } = await import("../src/config.js");
const { logUrl } = await import("../src/observability.js");

const KEYS = appKeys();
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const WEBHOOK_SECRET = "whsec_" + "k".repeat(40);
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const MIN = 60_000;

type Fake = InstanceType<typeof FakeGithub>;
type Store = InstanceType<typeof MemoryCodeStore>;

/** The routes on a bare Fastify, with a fake GitHub behind them. */
async function rig(o: { webhookSecret?: string | null; github?: boolean } = {}) {
  const fake: Fake = new FakeGithub(KEYS);
  const store: Store = new MemoryCodeStore();
  const code = createCode({
    store, webhookSecret: o.webhookSecret === undefined ? WEBHOOK_SECRET : o.webhookSecret,
    app: o.github === false ? null : { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem },
    fetchFn: fake.fetchFn, now: () => fake.clock.t,
  });
  const app = Fastify();
  registerCodeRoutes(app, { rateLimit: RL, code });
  await app.ready();
  const call = (user: string | null, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { fake, store, code, app, call };
}

type Rig = Awaited<ReturnType<typeof rig>>;

/** Alice has linked install 101 (with `repos` repos), and is on to the routes. */
async function linked(r: Rig, repos: Array<[string, Record<string, unknown>?]> = [["alice/app"]]) {
  r.fake.addInstall(101, "alice");
  const made = repos.map(([name, o]) => r.fake.addRepo(101, name, o as never));
  await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: 77, githubLogin: "alice" });
  return made;
}

const ALL_ROUTES: Array<["GET" | "POST" | "DELETE", string]> = [
  ["POST", "/v1/code/github/connect"], ["GET", "/v1/code/github"], ["DELETE", "/v1/code/github/installations/101"],
  ["GET", "/v1/code/repos"], ["POST", "/v1/code/projects"], ["GET", "/v1/code/projects"],
  ["DELETE", "/v1/code/projects/00000000-0000-4000-8000-000000000000"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches"],
  ["GET", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/pr"],
];

// ------------------------------------------------------------ off, not set up

describe("with the Code bot off", () => {
  it("answers 404 code_off on every route, with or without a session", async () => {
    const app = Fastify();
    registerCodeRoutes(app, { rateLimit: RL, code: null });
    await app.ready();
    for (const [method, url] of ALL_ROUTES) {
      for (const headers of [{}, who("alice")]) {
        const res = await app.inject({ method, url, headers, ...(method === "POST" ? { payload: {} } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json()).toMatchObject({ code: "code_off" });
      }
    }
    const hook = await app.inject({ method: "POST", url: "/v1/code/github/webhook", payload: "{}", headers: { "content-type": "application/json" } });
    expect(hook.statusCode).toBe(404);
    expect(hook.json().code).toBe("code_off");
    const cb = await app.inject({ method: "GET", url: "/v1/code/github/callback?code=a&state=b&installation_id=1" });
    expect(cb.statusCode).toBe(404);
    expect(cb.headers["content-type"]).toContain("text/html");
    await app.close();
  });

  it("is the default: no CODE_GITHUB in the environment is off", () => {
    expect(getConfig().CODE_GITHUB).toBe(false);
  });
});

describe("with the GitHub App not set up", () => {
  it("answers 503 not_configured on every route, before asking for a session", async () => {
    const r = await rig({ github: false, webhookSecret: null });
    for (const [method, url] of ALL_ROUTES) {
      for (const user of [null, "alice"]) {
        const res = await r.call(user, method, url, method === "POST" ? {} : undefined);
        expect(res.statusCode, `${method} ${url}`).toBe(503);
        expect(res.json()).toMatchObject({ code: "not_configured" });
      }
    }
    const cb = await r.app.inject({ method: "GET", url: "/v1/code/github/callback?code=a&state=b&installation_id=1" });
    expect(cb.statusCode).toBe(503);
    expect(cb.headers["content-type"]).toContain("text/html");
    await r.app.close();
  });

  it("is also not set up when the private key can't be read", async () => {
    const fake = new FakeGithub(KEYS);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = createCode({
      store: new MemoryCodeStore(), webhookSecret: null,
      app: { slug: "s", clientId: "c", clientSecret: "x", privateKey: "-----BEGIN RSA PRIVATE KEY-----\nnot a key\n-----END RSA PRIVATE KEY-----" },
      fetchFn: fake.fetchFn,
    });
    expect(code.github).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.not.stringContaining("not a key"));
    warn.mockRestore();
  });

  it("is not set up either without the key that signs the install link", async () => {
    const r = await rig();
    const saved = process.env.CONNECTOR_TOKEN_KEY;
    delete process.env.CONNECTOR_TOKEN_KEY;
    resetConfigForTests();
    try {
      const res = await r.call("alice", "POST", "/v1/code/github/connect", {});
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("not_configured");
    } finally {
      process.env.CONNECTOR_TOKEN_KEY = saved;
      resetConfigForTests();
    }
    await r.app.close();
  });
});

describe("the session", () => {
  it("is wanted on every route but GitHub's callback and webhook", async () => {
    const r = await rig();
    for (const [method, url] of ALL_ROUTES) {
      const res = await r.call(null, method, url, method === "POST" ? {} : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    await r.app.close();
  });

  it("is a person with an account: a caller without one is told to sign in, not given a 500", async () => {
    const r = await rig();
    // The Supabase store, which keeps rows by account id: a client with no network is enough, since
    // a caller that is not a UUID is turned away before any request is made.
    const { SupabaseCodeStore } = await import("../src/code/store.js");
    const { createClient } = await import("@supabase/supabase-js");
    const code = createCode({ store: new SupabaseCodeStore(createClient("http://127.0.0.1:1", "anon")), app: { slug: "s", clientId: r.fake.appClientId, clientSecret: "x", privateKey: KEYS.privateKeyPem }, webhookSecret: null });
    const app = Fastify();
    registerCodeRoutes(app, { rateLimit: RL, code });
    const res = await app.inject({ method: "GET", url: "/v1/code/github", headers: who("static-abc123") });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("needs_account");
    await app.close();
    await r.app.close();
  });
});

// ------------------------------------------------------------ the install flow

describe("connecting GitHub", () => {
  const parse = (installUrl: string) => new URL(installUrl).searchParams.get("state")!;

  it("goes from the install link to the done page to a connected account", async () => {
    const r = await rig();
    r.fake.addInstall(101, "alice", { selection: "all" });
    r.fake.addPerson("code-1", "gho_alice", [101]);

    const begin = await r.call("alice", "POST", "/v1/code/github/connect", {});
    expect(begin.statusCode).toBe(200);
    const { installUrl } = begin.json();
    expect(installUrl).toMatch(/^https:\/\/github\.com\/apps\/tailzu-test\/installations\/new\?state=/);

    // Before the install: nothing connected, nothing asked of GitHub.
    expect((await r.call("alice", "GET", "/v1/code/github")).json()).toEqual({ configured: true, connected: false, installations: [] });

    const back = await r.app.inject({
      method: "GET", url: `/v1/code/github/callback?code=code-1&installation_id=101&setup_action=install&state=${encodeURIComponent(parse(installUrl))}`,
    });
    expect(back.statusCode).toBe(200);
    expect(back.headers["content-type"]).toContain("text/html");
    expect(back.headers["cache-control"]).toBe("no-store");
    expect(back.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(back.headers["referrer-policy"]).toBe("no-referrer");
    expect(back.body).toContain("<h1>GitHub connected</h1>");
    expect(back.body).toContain('<a href="tulmi://">Open Tailzu</a>');
    expect(back.body).not.toContain("code-1");
    expect(back.body).not.toContain("gho_");

    expect((await r.call("alice", "GET", "/v1/code/github")).json()).toEqual({
      configured: true, connected: true,
      installations: [{ id: 101, account: "alice", accountType: "User", repositorySelection: "all", suspended: false, manageUrl: "https://github.com/settings/installations/101" }],
    });
    // It is alice's and nobody's else.
    expect((await r.call("bob", "GET", "/v1/code/github")).json().installations).toEqual([]);
    await r.app.close();
  });

  it("refuses an install that isn't the person's: a 403 page, and nothing linked", async () => {
    const r = await rig();
    r.fake.addInstall(101, "alice");
    r.fake.addInstall(202, "carol", { type: "Organization" });
    r.fake.addPerson("code-1", "gho_alice", [101]);
    // The route checks the state against the real clock, so it is signed with it.
    const state = await signState("alice", CODE_STATE_ID, Date.now());
    const res = await r.app.inject({ method: "GET", url: `/v1/code/github/callback?code=code-1&installation_id=202&setup_action=install&state=${state}` });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("That install isn't yours");
    expect(res.body).not.toContain("assistant_apps"); // it opens the app, not the Connected apps screen
    expect((await r.call("alice", "GET", "/v1/code/github")).json().installations).toEqual([]);
    await r.app.close();
  });

  it("refuses a bad, expired or other-app state with a 400 page", async () => {
    const r = await rig();
    r.fake.addInstall(101, "alice");
    r.fake.addPerson("code-1", "gho_alice", [101]);
    const states = [
      "garbage",
      await signState("alice", CODE_STATE_ID, Date.now() - 11 * MIN),
      await signState("alice", "notion", Date.now()),
    ];
    for (const state of states) {
      const res = await r.app.inject({ method: "GET", url: `/v1/code/github/callback?code=code-1&installation_id=101&state=${state}` });
      expect(res.statusCode, state).toBe(400);
      expect(res.body).toContain("That didn't work");
    }
    for (const url of [
      "/v1/code/github/callback?code=code-1&installation_id=101", // no state
      "/v1/code/github/callback?code=a&code=b&installation_id=101&state=x", // a code twice
      `/v1/code/github/callback?code=${"a".repeat(5000)}&state=x`,
      "/v1/code/github/callback?error=access_denied&state=x",
      "/v1/code/github/callback",
    ]) {
      const res = await r.app.inject({ method: "GET", url });
      expect(res.statusCode, url.slice(0, 60)).toBe(400);
    }
    expect(r.fake.calls).toHaveLength(0);
    await r.app.close();
  });

  it("tells a member of an organisation that its owner has to approve", async () => {
    const r = await rig();
    const res = await r.app.inject({ method: "GET", url: "/v1/code/github/callback?setup_action=request&state=anything" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Waiting for your organisation's owner to approve Tailzu");
    expect(r.fake.calls).toHaveLength(0);
    expect((await r.call("alice", "GET", "/v1/code/github")).json().installations).toEqual([]);
    await r.app.close();
  });

  it("with no code, refreshes what the person already linked", async () => {
    const r = await rig();
    await linked(r);
    r.fake.installs.get(101)!.login = "alice-new";
    const state = await signState("alice", CODE_STATE_ID, Date.now());
    const res = await r.app.inject({ method: "GET", url: `/v1/code/github/callback?installation_id=101&setup_action=update&state=${state}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("GitHub updated");
    expect((await r.call("alice", "GET", "/v1/code/github")).json().installations[0].account).toBe("alice-new");
    await r.app.close();
  });

  it("forgets a link and its projects here, and says where to uninstall; GitHub itself is not called", async () => {
    const r = await rig();
    await linked(r);
    const repoId = (await r.call("alice", "GET", "/v1/code/repos")).json().repos[0].id;
    await r.call("alice", "POST", "/v1/code/projects", { repoId });
    const before = r.fake.calls.length;

    expect((await r.call("bob", "DELETE", "/v1/code/github/installations/101")).statusCode).toBe(404);
    for (const bad of ["abc", "0", "-1", "1.5"]) expect((await r.call("alice", "DELETE", `/v1/code/github/installations/${bad}`)).statusCode).toBe(404);
    const res = await r.call("alice", "DELETE", "/v1/code/github/installations/101");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, manageUrl: "https://github.com/settings/installations/101" });
    expect(r.fake.calls.length).toBe(before);
    expect((await r.call("alice", "GET", "/v1/code/github")).json().connected).toBe(false);
    expect((await r.call("alice", "GET", "/v1/code/projects")).json()).toEqual({ projects: [] });
    expect(r.fake.installs.has(101)).toBe(true); // not uninstalled
    await r.app.close();
  });
});

// ------------------------------------------------------------ repos and projects

describe("repos and projects", () => {
  it("lists the repos across the person's installs, as the phone needs them", async () => {
    const r = await rig();
    const [a] = await linked(r, [["alice/app", { private: true, archived: false }], ["alice/old", { archived: true }]]);
    const res = await r.call("alice", "GET", "/v1/code/repos");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ repos: [{ id: a!.id, fullName: "alice/app", private: true, defaultBranch: "main", installationId: 101 }], truncated: false });
    expect((await r.call("bob", "GET", "/v1/code/repos")).json()).toEqual({ repos: [], truncated: false });
    await r.app.close();
  });

  it("says when the list was cut at 300", async () => {
    const r = await rig();
    r.fake.addInstall(101, "big");
    for (let i = 0; i < 305; i += 1) r.fake.addRepo(101, `big/r${i}`, { id: 100 + i, files: { a: "a" } });
    await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "big", accountType: "User", repositorySelection: "all", githubUserId: 77, githubLogin: "big" });
    const body = (await r.call("alice", "GET", "/v1/code/repos")).json();
    expect(body.repos).toHaveLength(300);
    expect(body.truncated).toBe(true);
    await r.app.close();
  });

  it("adds a project once, whatever the number of taps, and only from the person's own repos", async () => {
    const r = await rig();
    const [a] = await linked(r);
    r.fake.addInstall(202, "carol");
    const theirs = r.fake.addRepo(202, "carol/secret");

    const first = await r.call("alice", "POST", "/v1/code/projects", { repoId: a!.id });
    expect(first.statusCode).toBe(200);
    expect(first.json().created).toBe(true);
    expect(first.json().project).toMatchObject({ userId: "alice", installationId: 101, repoId: a!.id, fullName: "alice/app", defaultBranch: "main", private: true });
    expect(first.json().project.id).toMatch(/^[0-9a-f-]{36}$/);
    const again = await r.call("alice", "POST", "/v1/code/projects", { repoId: String(a!.id) });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ project: first.json().project, created: false });
    expect((await r.call("alice", "GET", "/v1/code/projects")).json().projects).toHaveLength(1);

    expect((await r.call("alice", "POST", "/v1/code/projects", { repoId: theirs.id })).statusCode).toBe(404);
    expect((await r.call("alice", "POST", "/v1/code/projects", { repoId: 987654 })).statusCode).toBe(404);
    for (const bad of [undefined, null, "", "abc", -1, 0, 1.5, {}, [1]]) {
      const res = await r.call("alice", "POST", "/v1/code/projects", bad === undefined ? {} : { repoId: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    await r.app.close();
  });

  it("lets only the owner see or delete a project", async () => {
    const r = await rig();
    const [a] = await linked(r);
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: a!.id })).json().project.id as string;
    expect((await r.call("bob", "GET", "/v1/code/projects")).json()).toEqual({ projects: [] });
    expect((await r.call("bob", "DELETE", `/v1/code/projects/${id}`)).statusCode).toBe(404);
    expect((await r.call("alice", "GET", "/v1/code/projects")).json().projects).toHaveLength(1);
    expect((await r.call("alice", "DELETE", "/v1/code/projects/not-a-uuid")).statusCode).toBe(404);
    expect((await r.call("alice", "DELETE", `/v1/code/projects/${id}`)).json()).toEqual({ ok: true });
    expect((await r.call("alice", "DELETE", `/v1/code/projects/${id}`)).statusCode).toBe(404);
    expect((await r.call("alice", "GET", "/v1/code/projects")).json()).toEqual({ projects: [] });
    await r.app.close();
  });
});

// ------------------------------------------------------------ branches and PRs

describe("work branches and draft PRs", () => {
  async function project(r: Rig) {
    const [a] = await linked(r, [["alice/app", { files: { "README.md": "# app\n" } }]]);
    const p = (await r.call("alice", "POST", "/v1/code/projects", { repoId: a!.id })).json().project as { id: string };
    return { repo: a!, id: p.id };
  }

  it("starts a branch from the default branch's head and lists it", async () => {
    const r = await rig();
    const { id, repo } = await project(r);
    const head = r.fake.head(repo, "main");
    const res = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "Fix the login bug" });
    expect(res.statusCode).toBe(200);
    const made = res.json();
    expect(made.branch).toMatch(/^tailzu\/fix-the-login-bug-[0-9a-f]{4}$/);
    expect(made).toEqual({ branch: made.branch, baseSha: head, url: `https://github.com/alice/app/tree/${made.branch}` });
    expect(r.fake.head(repo, made.branch)).toBe(head);

    const hindi = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "लॉगिन ठीक करो" })).json();
    expect(hindi.branch).toMatch(/^tailzu\/work-[0-9a-f]{4}$/);

    const list = (await r.call("alice", "GET", `/v1/code/projects/${id}/branches`)).json().branches;
    expect(list.map((b: { branch: string }) => b.branch)).toEqual([hindi.branch, made.branch]);
    expect(list[1]).toMatchObject({ projectId: id, branch: made.branch, task: "Fix the login bug", baseSha: head, prNumber: null, prUrl: null });
    await r.app.close();
  });

  it("refuses a missing task, and a project that isn't the person's", async () => {
    const r = await rig();
    const { id } = await project(r);
    for (const bad of [{}, { task: "" }, { task: "   " }, { task: 5 }]) {
      expect((await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, bad)).statusCode).toBe(400);
    }
    expect((await r.call("bob", "POST", `/v1/code/projects/${id}/branches`, { task: "x" })).statusCode).toBe(404);
    expect((await r.call("bob", "GET", `/v1/code/projects/${id}/branches`)).statusCode).toBe(404);
    expect((await r.call("alice", "POST", `/v1/code/projects/nope/branches`, { task: "x" })).statusCode).toBe(404);
    expect(r.fake.writes()).toHaveLength(0);
    await r.app.close();
  });

  it("opens a draft PR for a branch Tailzu made, with the branch URL-encoded, and records it", async () => {
    const r = await rig();
    const { id, repo } = await project(r);
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "ship it" })).json();
    r.fake.push(repo, branch, { "feature.txt": "done" }, "the work");
    const url = `/v1/code/projects/${id}/branches/${encodeURIComponent(branch)}/pr`;
    expect(url).toContain("%2F");

    const res = await r.call("alice", "POST", url, { title: "Ship it", body: "All done." });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ prNumber: 1, prUrl: "https://github.com/alice/app/pull/1", existing: false });
    expect(r.fake.pulls(repo)).toMatchObject([{ head: branch, base: "main", title: "Ship it", body: "All done.", draft: true }]);
    const rec = (await r.call("alice", "GET", `/v1/code/projects/${id}/branches`)).json().branches[0];
    expect(rec).toMatchObject({ prNumber: 1, prUrl: "https://github.com/alice/app/pull/1" });

    // Again: the open one, not an error.
    const again = await r.call("alice", "POST", url, { title: "Ship it", body: "All done." });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ prNumber: 1, prUrl: "https://github.com/alice/app/pull/1", existing: true });
    expect(r.fake.pulls(repo)).toHaveLength(1);
    await r.app.close();
  });

  it("does not open one for a branch that isn't recorded in this project, or someone else's project", async () => {
    const r = await rig();
    const { id, repo } = await project(r);
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "mine" })).json();
    r.fake.push(repo, branch, { "f": "x" });
    const pr = (b: string, user = "alice", payload: unknown = { title: "T", body: "B" }) =>
      r.call(user, "POST", `/v1/code/projects/${id}/branches/${encodeURIComponent(b)}/pr`, payload);
    expect((await pr("main")).statusCode).toBe(404);
    expect((await pr("tailzu/never-made-1234")).statusCode).toBe(404);
    expect((await pr(branch, "bob")).statusCode).toBe(404);
    // Not even a path: Fastify's own 400, before any of this.
    expect((await r.call("alice", "POST", `/v1/code/projects/${id}/branches/%E0%A4%A/pr`, { title: "T" })).statusCode).toBe(400);
    expect((await pr(branch, "alice", { body: "no title" })).statusCode).toBe(400);
    expect((await pr(branch, "alice", { title: "   " })).statusCode).toBe(400);
    expect(r.fake.pulls(repo)).toHaveLength(0);
    await r.app.close();
  });

  it("says so, and doesn't open an empty PR, when the branch has nothing on it", async () => {
    const r = await rig();
    const { id } = await project(r);
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "nothing yet" })).json();
    const res = await r.call("alice", "POST", `/v1/code/projects/${id}/branches/${encodeURIComponent(branch)}/pr`, { title: "T", body: "B" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("nothing_to_review");
    await r.app.close();
  });

  it("is turned away while GitHub has the install suspended", async () => {
    const r = await rig();
    const { id } = await project(r);
    await r.store.setSuspended(101, Date.now());
    const res = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("suspended");
    expect((await r.call("alice", "GET", "/v1/code/repos")).json().repos).toEqual([]);
    await r.app.close();
  });

  it("answers a GitHub that fails in plain words, 502, with no GitHub text or token", async () => {
    const r = await rig();
    const { id } = await project(r);
    r.fake.failWith = { prefix: "/repos", status: 500 };
    const res = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x" });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("failed");
    expect(res.body).not.toMatch(/boom|ghs_|Bearer/);
    await r.app.close();
  });
});

// ------------------------------------------------------------ whose repos

describe("an install is not access to every repo in it", () => {
  /** acme's install, linked by alice (write on api, read on docs) and bob (read on both). */
  async function acme() {
    const r = await rig();
    r.fake.addInstall(300, "acme", { type: "Organization", selection: "all" });
    const api = r.fake.addRepo(300, "acme/api", { files: { "README.md": "# api\n" } });
    const docs = r.fake.addRepo(300, "acme/docs");
    for (const user of ["alice", "bob"]) {
      await r.store.upsertInstallation(user, { installationId: 300, accountLogin: "acme", accountType: "Organization", repositorySelection: "all", githubUserId: user === "alice" ? 1 : 2, githubLogin: user });
    }
    r.fake.setPermission(api, "alice", "write");
    r.fake.setPermission(docs, "alice", "read");
    r.fake.setPermission(api, "bob", "read");
    r.fake.setPermission(docs, "bob", "read");
    return { ...r, api, docs };
  }

  it("lists only what the person can write to, and refuses a project from the rest", async () => {
    const r = await acme();
    expect((await r.call("alice", "GET", "/v1/code/repos")).json()).toEqual({
      repos: [{ id: r.api.id, fullName: "acme/api", private: true, defaultBranch: "main", installationId: 300 }], truncated: false,
    });
    expect((await r.call("bob", "GET", "/v1/code/repos")).json()).toEqual({ repos: [], truncated: false });

    expect((await r.call("alice", "POST", "/v1/code/projects", { repoId: r.api.id })).statusCode).toBe(200);
    expect((await r.call("alice", "POST", "/v1/code/projects", { repoId: r.docs.id })).statusCode).toBe(404);
    expect((await r.call("bob", "POST", "/v1/code/projects", { repoId: r.api.id })).statusCode).toBe(404);
    expect((await r.call("bob", "GET", "/v1/code/projects")).json()).toEqual({ projects: [] });
    await r.app.close();
  });

  it("turns away a branch, a commit's pull request and the rest once access is taken away, 403 no_access", async () => {
    const r = await acme();
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: r.api.id })).json().project.id as string;
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "while I could" })).json();
    r.fake.push(r.api, branch, { "f.txt": "x" });

    r.fake.setPermission(r.api, "alice", "read");
    const branchRes = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "too late" });
    expect(branchRes.statusCode).toBe(403);
    expect(branchRes.json().code).toBe("no_access");
    const pr = await r.call("alice", "POST", `/v1/code/projects/${id}/branches/${encodeURIComponent(branch)}/pr`, { title: "T", body: "B" });
    expect(pr.statusCode).toBe(403);
    expect(pr.json().code).toBe("no_access");
    expect(r.fake.pulls(r.api)).toEqual([]);
    expect(r.fake.branches(r.api).filter((b) => b.startsWith("tailzu/"))).toEqual([branch]);
    await r.app.close();
  });

  it("asks a person with an older link to connect GitHub again: 403 needs_reconnect, and says so in the list and the status", async () => {
    const r = await rig();
    r.fake.addInstall(101, "alice");
    const own = r.fake.addRepo(101, "alice/own");
    await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "all" });
    r.fake.calls.length = 0;

    expect((await r.call("alice", "GET", "/v1/code/repos")).json()).toEqual({ repos: [], truncated: false, needsReconnect: [101] });
    expect((await r.call("alice", "GET", "/v1/code/github")).json().installations[0]).toMatchObject({ id: 101, needsReconnect: true });
    const add = await r.call("alice", "POST", "/v1/code/projects", { repoId: own.id });
    expect(add.statusCode).toBe(403);
    expect(add.json().code).toBe("needs_reconnect");
    expect(r.fake.calls).toHaveLength(0);

    // Connecting again (the install step reads who they are) puts it right.
    r.fake.addPerson("code-9", "gho_alice", [101], "alice");
    const state = await signState("alice", CODE_STATE_ID, Date.now());
    expect((await r.app.inject({ method: "GET", url: `/v1/code/github/callback?code=code-9&installation_id=101&setup_action=install&state=${state}` })).statusCode).toBe(200);
    expect((await r.call("alice", "GET", "/v1/code/repos")).json().repos.map((x: { id: number }) => x.id)).toEqual([own.id]);
    expect((await r.call("alice", "GET", "/v1/code/github")).json().installations[0]).not.toHaveProperty("needsReconnect");
    await r.app.close();
  });
});

// ------------------------------------------------------------ no secrets in logs

describe("logs", () => {
  it("never carry the install callback's code or state", () => {
    expect(logUrl("/v1/code/github/callback?code=abc&installation_id=1&setup_action=install&state=eyJ.x.y")).toBe("/v1/code/github/callback");
    expect(logUrl("/v1/code/github/callback")).toBe("/v1/code/github/callback");
    expect(logUrl("/v1/code/github/callbackish?x=1")).toBe("/v1/code/github/callbackish?x=1");
    expect(logUrl("/v1/code/repos")).toBe("/v1/code/repos");
  });

  it("know the GitHub App's secrets as part of the environment the suite clears", () => {
    for (const k of ["CODE_GITHUB", "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"]) {
      expect(ENV_KEYS).toContain(k);
    }
  });
});

// ------------------------------------------------------------ the webhook, through the real server

describe("GitHub's webhook, through the server", () => {
  let app: FastifyInstance;
  const store = () => codeStore();
  const hook = (event: string, payload: unknown, o: { signature?: string | null; raw?: string } = {}) => {
    const raw = o.raw ?? JSON.stringify(payload);
    return app.inject({
      method: "POST", url: "/v1/code/github/webhook", payload: raw,
      headers: {
        "content-type": "application/json", "x-github-event": event, "x-github-delivery": "d-1",
        ...(o.signature === null ? {} : { "x-hub-signature-256": o.signature ?? signatureFor(raw, WEBHOOK_SECRET) }),
      },
    });
  };

  beforeAll(async () => {
    process.env.CODE_GITHUB = "true";
    process.env.GITHUB_APP_SLUG = "tailzu-test";
    process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
    process.env.GITHUB_APP_CLIENT_SECRET = "client-secret-xyz";
    process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(KEYS.privateKeyPem).toString("base64");
    process.env.GITHUB_APP_WEBHOOK_SECRET = WEBHOOK_SECRET;
    resetConfigForTests();
    resetCodeStoreForTests();
    const { buildApp } = await import("../src/server.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    for (const k of ["CODE_GITHUB", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"]) delete process.env[k];
    resetConfigForTests();
    resetCodeStoreForTests();
  });

  async function seed() {
    const s = store();
    for (const user of ["alice", "bob"]) {
      await s.upsertInstallation(user, { installationId: 101, accountLogin: "acme", accountType: "Organization", repositorySelection: "selected" });
      await s.createProject(user, { installationId: 101, repoId: 1, fullName: "acme/one", defaultBranch: "main", private: true });
      await s.createProject(user, { installationId: 101, repoId: 2, fullName: "acme/two", defaultBranch: "main", private: true });
    }
  }
  const reset = async () => { for (const u of ["alice", "bob"]) await store().removeInstallation(u, 101); };

  it("is on in the real server once the App is set up: the status route answers for the signed-in person", async () => {
    await seed();
    const res = await app.inject({ method: "GET", url: "/v1/code/github", headers: who("alice") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, connected: true, installations: [{ id: 101, account: "acme", accountType: "Organization" }] });
    expect(res.json().installations[0].manageUrl).toBe("https://github.com/organizations/acme/settings/installations/101");
    await reset();
  });

  it("answers 401 to a missing, wrong or malformed signature, and does nothing", async () => {
    await seed();
    const payload = { action: "deleted", installation: { id: 101 } };
    const good = signatureFor(JSON.stringify(payload), WEBHOOK_SECRET);
    for (const signature of [null, "", "sha256=", good.slice(7), good.replace(/.$/, good.endsWith("0") ? "1" : "0"), signatureFor(JSON.stringify(payload), "another-secret"), "sha1=" + good.slice(7)]) {
      const res = await hook("installation", payload, { signature });
      expect(res.statusCode, String(signature)).toBe(401);
    }
    // A good signature over a different body than the one sent.
    expect((await hook("installation", payload, { signature: signatureFor(JSON.stringify({ ...payload, x: 1 }), WEBHOOK_SECRET) })).statusCode).toBe(401);
    expect(await store().getInstallation("alice", 101)).not.toBeNull();
    expect(await store().listProjects("alice")).toHaveLength(2);
    await reset();
  });

  it("is signed over the body exactly as sent, whatever its spacing", async () => {
    await seed();
    const raw = '{ "action" :  "unsuspend",\n  "installation": {"id":101}  }';
    expect((await hook("installation", null, { raw })).statusCode).toBe(200);
    await reset();
  });

  it("installation deleted: drops every link to it and the projects on it", async () => {
    await seed();
    const res = await hook("installation", { action: "deleted", installation: { id: 101, account: { login: "acme" } }, sender: { login: "x" } });
    expect(res.statusCode).toBe(200);
    for (const u of ["alice", "bob"]) {
      expect(await store().getInstallation(u, 101)).toBeNull();
      expect(await store().listProjects(u)).toEqual([]);
    }
    expect((await app.inject({ method: "GET", url: "/v1/code/github", headers: who("alice") })).json().connected).toBe(false);
  });

  it("installation suspend and unsuspend: mark it and clear it", async () => {
    await seed();
    expect((await hook("installation", { action: "suspend", installation: { id: 101 } })).statusCode).toBe(200);
    let status = (await app.inject({ method: "GET", url: "/v1/code/github", headers: who("alice") })).json();
    expect(status.installations[0].suspended).toBe(true);
    expect(await store().listProjects("alice")).toHaveLength(2);
    expect((await hook("installation", { action: "unsuspend", installation: { id: 101 } })).statusCode).toBe(200);
    status = (await app.inject({ method: "GET", url: "/v1/code/github", headers: who("alice") })).json();
    expect(status.installations[0].suspended).toBe(false);
    await reset();
  });

  it("installation_repositories removed: drops the projects on the removed repos only", async () => {
    await seed();
    const res = await hook("installation_repositories", {
      action: "removed", installation: { id: 101 }, repository_selection: "selected", repositories_added: [], repositories_removed: [{ id: 2, name: "two", full_name: "acme/two" }],
    });
    expect(res.statusCode).toBe(200);
    for (const u of ["alice", "bob"]) {
      expect((await store().listProjects(u)).map((p) => p.repoId)).toEqual([1]);
      expect(await store().getInstallation(u, 101)).not.toBeNull();
    }
    await reset();
  });

  it("answers 202 and does nothing for any other event, signed or not malformed", async () => {
    await seed();
    for (const [event, payload] of [
      ["ping", { zen: "Design for failure.", hook_id: 1 }],
      ["push", { ref: "refs/heads/main" }],
      ["installation", { action: "created", installation: { id: 101 } }],
      ["installation_repositories", { action: "added", installation: { id: 101 }, repositories_added: [{ id: 9 }] }],
      ["installation", { action: "deleted" }],
      ["", {}],
    ] as const) {
      const res = await hook(event, payload);
      expect(res.statusCode, `${event} ${JSON.stringify(payload)}`).toBe(202);
    }
    expect(await store().listProjects("alice")).toHaveLength(2);
    expect(await store().getInstallation("bob", 101)).not.toBeNull();
    await reset();
  });

  it("never calls GitHub", async () => {
    await seed();
    const real = globalThis.fetch;
    const spy = vi.fn(real);
    globalThis.fetch = spy as typeof fetch;
    try {
      await hook("installation", { action: "suspend", installation: { id: 101 } });
      await hook("installation", { action: "deleted", installation: { id: 101 } });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = real;
    }
  });

  it("refuses everything with a 503 when no webhook secret is set", async () => {
    const r = await rig({ webhookSecret: null });
    const res = await r.app.inject({ method: "POST", url: "/v1/code/github/webhook", payload: "{}", headers: { "content-type": "application/json", "x-hub-signature-256": signatureFor("{}", "") } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("not_configured");
    await r.app.close();
  });
});

describe("the real server with the Code bot off", () => {
  // The default: no CODE_GITHUB line in the environment.
  it("answers 404 code_off on every route, the webhook and the callback included", async () => {
    const saved = process.env.CODE_GITHUB;
    delete process.env.CODE_GITHUB;
    resetConfigForTests();
    resetCodeStoreForTests();
    const { buildApp } = await import("../src/server.js");
    const app = await buildApp();
    await app.ready();
    try {
      for (const [method, url] of ALL_ROUTES) {
        const res = await app.inject({ method, url, headers: who("alice"), ...(method === "POST" ? { payload: {} } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().code).toBe("code_off");
      }
      const raw = "{}";
      const hook = await app.inject({
        method: "POST", url: "/v1/code/github/webhook", payload: raw,
        headers: { "content-type": "application/json", "x-hub-signature-256": signatureFor(raw, WEBHOOK_SECRET) },
      });
      expect(hook.statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/v1/code/github/callback?code=a&state=b&installation_id=1" })).statusCode).toBe(404);
    } finally {
      await app.close();
      if (saved !== undefined) process.env.CODE_GITHUB = saved;
      resetConfigForTests();
    }
  });
});

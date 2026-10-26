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
// Account deletion talks to Supabase's admin client: one test puts a stub there (and only then).
const stub = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    supabase: () => (stub.admin ?? real.supabase()) as ReturnType<typeof real.supabase>,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

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
async function rig(o: { webhookSecret?: string | null; github?: boolean; signin?: "on" | "off" | "unset" } = {}) {
  const fake: Fake = new FakeGithub(KEYS);
  const store: Store = new MemoryCodeStore(() => fake.clock.t);
  const code = createCode({
    store, webhookSecret: o.webhookSecret === undefined ? WEBHOOK_SECRET : o.webhookSecret,
    app: o.github === false ? null : { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem },
    // "Sign in with GitHub": on, set up but switched off, or (the default) not set up at all.
    ...(o.signin === "on" || o.signin === "off"
      ? { oauth: { clientId: fake.oauthClientId, clientSecret: fake.oauthClientSecret }, oauthEnabled: o.signin === "on" }
      : { oauth: null, oauthEnabled: false }),
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
  ["GET", "/v1/code/new-repo-link?name=my-app"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/init"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/sync"],
  ["GET", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/diff"],
  ["GET", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/pr"],
  ["GET", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/pr/comments"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/pr/ready"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/pr/close"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234/pr/merge"],
  ["DELETE", "/v1/code/projects/00000000-0000-4000-8000-000000000000/branches/tailzu%2Fx-1234"],
  ["GET", "/v1/code/projects/00000000-0000-4000-8000-000000000000/permissions"],
  ["POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/permissions"],
  ["DELETE", "/v1/code/projects/00000000-0000-4000-8000-000000000000/permissions/00000000-0000-4000-8000-000000000001"],
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

  it("does not open one from the default branch, a branch that isn't on GitHub, or someone else's project", async () => {
    const r = await rig();
    const { id, repo } = await project(r);
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "mine" })).json();
    r.fake.push(repo, branch, { "f": "x" });
    const pr = (b: string, user = "alice", payload: unknown = { title: "T", body: "B" }) =>
      r.call(user, "POST", `/v1/code/projects/${id}/branches/${encodeURIComponent(b)}/pr`, payload);
    expect((await pr("main")).statusCode).toBe(400);
    expect((await pr("main")).json().code).toBe("bad_branch");
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

// ------------------------------------------------------------ the rest of the git logic

describe("new repos, and a work branch's life", () => {
  const B = (id: string, branch: string) => `/v1/code/projects/${id}/branches/${encodeURIComponent(branch)}`;

  /** A request that may be a question: asks, and if it was one, says yes with what came back (in the body, or on the address for a DELETE). */
  async function sayYes(r: Rig, method: "POST" | "DELETE", url: string, payload: Record<string, unknown> = {}) {
    const ask = await r.call("alice", method, url, method === "POST" ? payload : undefined);
    const q = ask.json();
    if (!q.needsApproval) return ask;
    return method === "POST"
      ? r.call("alice", "POST", url, { ...payload, approvalId: q.approvalId })
      : r.call("alice", "DELETE", `${url}?approvalId=${encodeURIComponent(q.approvalId)}`);
  }

  /** Alice's project with a work branch that has a commit and a draft pull request. */
  async function withPr(o: { files?: Record<string, string> } = {}) {
    const r = await rig();
    const [repo] = await linked(r, [["alice/app", { files: o.files ?? { "README.md": "# app\n" } }]]);
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: repo!.id })).json().project.id as string;
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "ship it" })).json();
    r.fake.push(repo!, branch, { "feature.txt": "one\ntwo\n" }, "Add the feature");
    const pr = (await r.call("alice", "POST", `${B(id, branch)}/pr`, { title: "Add feature", body: "Does it." })).json();
    return { ...r, repo: repo!, id, branch, pr };
  }

  it("makes a link to GitHub's new-repo page, for a signed-in person", async () => {
    const r = await rig();
    expect((await r.call("alice", "GET", "/v1/code/new-repo-link?name=My%20Cool%20App")).json()).toEqual({
      url: "https://github.com/new?name=my-cool-app&visibility=private", name: "my-cool-app",
    });
    expect((await r.call("alice", "GET", "/v1/code/new-repo-link")).json().name).toBe("my-project");
    expect((await r.call(null, "GET", "/v1/code/new-repo-link?name=x")).statusCode).toBe(401);
    await r.app.close();
  });

  it("starts an empty repo with a README, and says 'repo_empty' to a branch before that", async () => {
    const r = await rig();
    r.fake.addInstall(101, "alice");
    const repo = r.fake.addRepo(101, "alice/idea", { empty: true });
    await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "all", githubUserId: 77, githubLogin: "alice" });
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: repo.id })).json().project.id as string;

    const early = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "first" });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("repo_empty");
    expect(early.json().message).toMatch(/README/);

    // Starting the repo is a write to the default branch: a question first, and nothing is written by asking.
    const ask = await r.call("alice", "POST", `/v1/code/projects/${id}/init`, { title: "Idea" });
    expect(ask.statusCode).toBe(200);
    expect(ask.json()).toMatchObject({ needsApproval: true, action: "repo.init", faceId: false, summary: { readme: "Idea" } });
    expect(r.fake.commitCount(repo)).toBe(0);
    expect((await r.call("alice", "POST", `/v1/code/projects/${id}/init`, { title: "Idea", approvalId: 5 })).statusCode).toBe(400);
    const init = await r.call("alice", "POST", `/v1/code/projects/${id}/init`, { title: "Idea", approvalId: ask.json().approvalId });
    expect(init.statusCode).toBe(200);
    expect(init.json().commitSha).toBe(r.fake.head(repo, "main"));
    expect(r.fake.files(repo, "main")).toEqual({ "README.md": "# Idea\n" });
    expect((await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "first" })).statusCode).toBe(200);

    // Not twice, and not in a repo with commits: refused before it asks.
    const again = await r.call("alice", "POST", `/v1/code/projects/${id}/init`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("repo_not_empty");
    expect((await r.call("bob", "POST", `/v1/code/projects/${id}/init`, {})).statusCode).toBe(404);
    expect(r.fake.files(repo, "main")).toEqual({ "README.md": "# Idea\n" });
    await r.app.close();
  });

  it("keeps a branch current, and answers a conflict with 409 'conflict' and the state 'conflict'", async () => {
    const r = await withPr();
    r.fake.push(r.repo, "main", { "from-main.txt": "hi" });
    const ok = await r.call("alice", "POST", `${B(r.id, r.branch)}/sync`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("merged");
    expect((await r.call("alice", "POST", `${B(r.id, r.branch)}/sync`)).json()).toEqual({ status: "up_to_date" });

    r.fake.push(r.repo, r.branch, { "README.md": "# mine\n" });
    r.fake.push(r.repo, "main", { "README.md": "# theirs\n" });
    const head = r.fake.head(r.repo, r.branch);
    const clash = await r.call("alice", "POST", `${B(r.id, r.branch)}/sync`);
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe("conflict");
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    const rec = (await r.call("alice", "GET", `/v1/code/projects/${r.id}/branches`)).json().branches.find((b: { branch: string }) => b.branch === r.branch);
    expect(rec.state).toBe("conflict");
    expect((await r.call("bob", "POST", `${B(r.id, r.branch)}/sync`)).statusCode).toBe(404);
    await r.app.close();
  });

  it("shows what changed, the pull request, and its comments", async () => {
    const r = await withPr();
    r.fake.editPull(r.repo, r.pr.prNumber, {
      reviewDecision: "APPROVED", reviewComments: [{ user: "rev", body: "ok", path: "feature.txt", line: 1, at: "2026-10-26T12:30:00Z" }],
      issueComments: [{ user: "bot[bot]", body: "hello", at: "2026-10-26T12:40:00Z" }],
    });
    const diff = (await r.call("alice", "GET", `${B(r.id, r.branch)}/diff`)).json();
    expect(diff).toMatchObject({ aheadBy: 1, behindBy: 0, truncated: false, totals: { files: 1, additions: 2, deletions: 0 } });
    expect(diff.files).toEqual([{ path: "feature.txt", status: "added", additions: 2, deletions: 0 }]);
    expect(diff.commits).toEqual([{ sha: expect.any(String), message: "Add the feature" }]);

    const status = (await r.call("alice", "GET", `${B(r.id, r.branch)}/pr`)).json();
    expect(status).toMatchObject({ number: r.pr.prNumber, state: "open", draft: true, mergeable: true, reviewDecision: "approved", reviewComments: 1, headSha: r.fake.head(r.repo, r.branch) });
    const comments = (await r.call("alice", "GET", `${B(r.id, r.branch)}/pr/comments`)).json();
    expect(comments.comments).toEqual([
      { author: "rev", body: "ok", path: "feature.txt", line: 1, createdAt: Date.parse("2026-10-26T12:30:00Z") },
      { author: "bot[bot]", body: "hello", createdAt: Date.parse("2026-10-26T12:40:00Z") },
    ]);
    expect(comments.truncated).toBe(false);
    for (const suffix of ["/diff", "/pr", "/pr/comments"]) expect((await r.call("bob", "GET", `${B(r.id, r.branch)}${suffix}`)).statusCode, suffix).toBe(404);
    await r.app.close();
  });

  it("takes a pull request out of draft, and closes one, each after a question", async () => {
    const r = await withPr();
    const ask = await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/ready`);
    expect(ask.statusCode).toBe(200);
    expect(ask.json()).toMatchObject({ needsApproval: true, action: "pr.ready", faceId: false, approvalId: expect.any(String), expiresAt: expect.any(Number) });
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
    // Somebody else's yes, a yes to a different thing, and a yes that is not an id: nothing happens.
    expect((await r.call("bob", "POST", `${B(r.id, r.branch)}/pr/ready`, { approvalId: ask.json().approvalId })).statusCode).toBe(404);
    expect((await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/close`, { approvalId: ask.json().approvalId })).json().code).toBe("approval_invalid");
    expect((await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/ready`, { approvalId: 7 })).statusCode).toBe(400);
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
    expect((await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/ready`, { approvalId: ask.json().approvalId })).json()).toEqual({ draft: false });
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(false);
    expect((await sayYes(r, "POST", `${B(r.id, r.branch)}/pr/close`)).json()).toEqual({ state: "closed" });
    expect(r.fake.pulls(r.repo)[0]).toMatchObject({ state: "closed", merged: false });
    const closed = await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/ready`);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe("pr_not_open");
    await r.app.close();
  });

  it("merges in two steps: no body asks, an approval id says yes", async () => {
    const r = await withPr();
    await sayYes(r, "POST", `${B(r.id, r.branch)}/pr/ready`);
    const mainHead = r.fake.head(r.repo, "main");

    const ask = await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`);
    expect(ask.statusCode).toBe(200);
    const body = ask.json();
    expect(body).toMatchObject({
      needsApproval: true, approvalId: expect.any(String), action: "pr.merge", faceId: false,
      summary: { title: "Add feature", into: "main", files: 1, additions: 2, deletions: 0, headSha: r.fake.head(r.repo, r.branch) },
    });
    expect(r.fake.head(r.repo, "main")).toBe(mainHead); // nothing merged yet
    expect(r.fake.pulls(r.repo)[0]!.merged).toBe(false);

    // Wrong person, wrong id, and a body that isn't an id: nothing merged.
    const notBobs = await r.call("bob", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId: body.approvalId });
    expect(notBobs.statusCode).toBe(404); // it isn't Bob's project: it doesn't say whose it is, or that there is an approval
    const stranger = await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId: "made-up" });
    expect(stranger.statusCode).toBe(409);
    expect(stranger.json().code).toBe("approval_invalid");
    expect((await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId: 5 })).statusCode).toBe(400);
    expect((await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId: "" })).statusCode).toBe(400);
    expect(r.fake.pulls(r.repo)[0]!.merged).toBe(false);

    const yes = await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId: body.approvalId });
    expect(yes.statusCode).toBe(200);
    expect(yes.json()).toEqual({ merged: true, sha: r.fake.head(r.repo, "main") });
    expect(r.fake.files(r.repo, "main")).toMatchObject({ "feature.txt": "one\ntwo\n" });
    // Used, and the pull request is merged: the second try finds out about the merge.
    const used = await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId: body.approvalId });
    expect(used.statusCode).toBe(409);
    expect(used.json().code).toBe("pr_merged");
    await r.app.close();
  });

  it("refuses the second step with 409 'changed_since_approval' when the branch has moved", async () => {
    const r = await withPr();
    await sayYes(r, "POST", `${B(r.id, r.branch)}/pr/ready`);
    const { approvalId } = (await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`)).json();
    r.fake.push(r.repo, r.branch, { "late.txt": "x" });
    const res = await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("changed_since_approval");
    expect(r.fake.pulls(r.repo)[0]!.merged).toBe(false);
    await r.app.close();
  });

  it("deletes the branch after the merge, and keeps the record", async () => {
    const r = await withPr();
    const early = await r.call("alice", "DELETE", B(r.id, r.branch));
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("branch_in_use");
    await sayYes(r, "POST", `${B(r.id, r.branch)}/pr/ready`);
    const { approvalId } = (await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`)).json();
    await r.call("alice", "POST", `${B(r.id, r.branch)}/pr/merge`, { approvalId });

    expect((await r.call("bob", "DELETE", B(r.id, r.branch))).statusCode).toBe(404);
    const ask = await r.call("alice", "DELETE", B(r.id, r.branch));
    expect(ask.json()).toMatchObject({ needsApproval: true, action: "branch.delete", faceId: false });
    expect(r.fake.branches(r.repo)).toContain(r.branch);
    expect((await r.call("alice", "DELETE", `${B(r.id, r.branch)}?approvalId=${"x".repeat(300)}`)).statusCode).toBe(400);
    const done = await r.call("alice", "DELETE", `${B(r.id, r.branch)}?approvalId=${encodeURIComponent(ask.json().approvalId)}`);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ state: "deleted" });
    expect(r.fake.branches(r.repo)).not.toContain(r.branch);
    const list = (await r.call("alice", "GET", `/v1/code/projects/${r.id}/branches`)).json().branches;
    expect(list.find((b: { branch: string }) => b.branch === r.branch)).toMatchObject({ state: "deleted", prNumber: r.pr.prNumber });
    expect((await r.call("alice", "POST", `${B(r.id, r.branch)}/sync`)).json().code).toBe("branch_deleted");
    await r.app.close();
  });

  it("turns a write away with 403 'no_access' once the person's access is gone", async () => {
    const r = await rig();
    r.fake.addInstall(300, "acme", { type: "Organization", selection: "all" });
    const api = r.fake.addRepo(300, "acme/api");
    await r.store.upsertInstallation("alice", { installationId: 300, accountLogin: "acme", accountType: "Organization", repositorySelection: "all", githubUserId: 1, githubLogin: "alice" });
    r.fake.setPermission(api, "alice", "write");
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: api.id })).json().project.id as string;
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x" })).json();
    r.fake.setPermission(api, "alice", "read");
    for (const [method, suffix] of [["POST", "/sync"], ["POST", "/pr/ready"], ["POST", "/pr/close"], ["POST", "/pr/merge"], ["DELETE", ""]] as const) {
      const res = await r.call("alice", method, `${B(id, branch)}${suffix}`, method === "POST" ? {} : undefined);
      expect(res.statusCode, `${method} ${suffix}`).toBe(403);
      expect(res.json().code).toBe("no_access");
    }
    expect((await r.call("alice", "POST", `/v1/code/projects/${id}/init`, {})).json().code).toBe("no_access");
    expect(r.fake.writes().filter((c) => !c.url.pathname.endsWith("/git/refs"))).toEqual([]);
    await r.app.close();
  });
});

// ------------------------------------------------------------ what the bot may do, and what it asks

describe("the project's standing permissions", () => {
  const P = (id: string) => `/v1/code/projects/${id}/permissions`;
  const B = (id: string, branch: string) => `/v1/code/projects/${id}/branches/${encodeURIComponent(branch)}`;

  async function withProject(r: Rig) {
    const [repo] = await linked(r, [["alice/app", { files: { "README.md": "# app\n" } }]]);
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: repo!.id })).json().project.id as string;
    return { repo: repo!, id };
  }

  it("lists none to begin with, with the catalog of actions for the screen that edits them", async () => {
    const r = await rig();
    const { id } = await withProject(r);
    const res = await r.call("alice", "GET", P(id));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.grants).toEqual([]);
    expect(body.actions).toHaveLength(19);
    expect(body.actions.find((a: { id: string }) => a.id === "push.force")).toMatchObject({ tier: "ask_strict", faceId: true, grantable: false });
    expect(body.actions.find((a: { id: string }) => a.id === "pr.merge")).toMatchObject({ tier: "ask", faceId: false, grantable: true, branchScoped: true });
    expect(body.actions.find((a: { id: string }) => a.id === "path.escape")).toMatchObject({ tier: "never", grantable: false });
    await r.app.close();
  });

  it("makes a grant, lists it, and takes it back", async () => {
    const r = await rig();
    const { id } = await withProject(r);
    const made = await r.call("alice", "POST", P(id), { action: "commit.other_branch", branchPattern: "release/*" });
    expect(made.statusCode).toBe(200);
    const grant = made.json().grant;
    expect(grant).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), projectId: id, action: "commit.other_branch", branchPattern: "release/*", effect: "allow", createdAt: expect.any(Number) });
    const deny = (await r.call("alice", "POST", P(id), { action: "pr.merge", effect: "deny", expiresAt: Date.now() + 3_600_000 })).json().grant;
    expect(deny).toMatchObject({ action: "pr.merge", effect: "deny", expiresAt: expect.any(Number) });
    expect(deny).not.toHaveProperty("branchPattern");

    expect((await r.call("alice", "GET", P(id))).json().grants).toEqual([grant, deny]);
    expect((await r.call("alice", "DELETE", `${P(id)}/${grant.id}`)).json()).toEqual({ ok: true });
    expect((await r.call("alice", "GET", P(id))).json().grants).toEqual([deny]);
    expect((await r.call("alice", "DELETE", `${P(id)}/${grant.id}`)).statusCode).toBe(404); // already gone
    await r.app.close();
  });

  it("makes the same grant once, with the latest expiry, and does not list one that has run out", async () => {
    const r = await rig();
    const { id } = await withProject(r);
    const a = (await r.call("alice", "POST", P(id), { action: "pr.ready", branchPattern: "tailzu/*" })).json().grant;
    const b = (await r.call("alice", "POST", P(id), { action: "pr.ready", branchPattern: "tailzu/*", expiresAt: Date.now() + 5000 })).json().grant;
    expect(b.id).toBe(a.id);
    expect(b.expiresAt).toBeGreaterThan(Date.now());
    expect((await r.call("alice", "GET", P(id))).json().grants).toHaveLength(1);
    // One that has run out is not shown (and does nothing).
    await r.store.addGrant(id, { action: "pr.close", effect: "allow", expiresAt: Date.now() - 1000 });
    expect((await r.call("alice", "GET", P(id))).json().grants.map((g: { action: string }) => g.action)).toEqual(["pr.ready"]);
    await r.app.close();
  });

  it("refuses an action that always asks or never happens, allow or deny, and anything that isn't a grant", async () => {
    const r = await rig();
    const { id } = await withProject(r);
    for (const action of ["push.force", "branch.delete_default", "commit.secret", "repo.visibility", "path.escape", "repo.delete"]) {
      for (const effect of ["allow", "deny"]) {
        const res = await r.call("alice", "POST", P(id), { action, effect });
        expect(res.statusCode, `${action} ${effect}`).toBe(400);
        expect(res.json().code).toBe("not_grantable");
      }
    }
    for (const body of [
      {}, { action: "nope" }, { action: 5 }, { action: "pr.merge", effect: "maybe" }, { action: "pr.merge", branchPattern: "a b" }, { action: "pr.merge", branchPattern: "../x" },
      { action: "repo.init", branchPattern: "main" }, { action: "pr.merge", expiresAt: Date.now() - 1 }, { action: "pr.merge", expiresAt: "never" },
    ]) {
      const res = await r.call("alice", "POST", P(id), body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().code).toBe("bad_request");
    }
    expect((await r.call("alice", "GET", P(id))).json().grants).toEqual([]);
    await r.app.close();
  });

  it("allows 100 to a project, and says so", async () => {
    const r = await rig();
    const { id } = await withProject(r);
    for (let i = 0; i < 100; i += 1) await r.store.addGrant(id, { action: "pr.merge", effect: "allow", branchPattern: `b${i}` });
    const res = await r.call("alice", "POST", P(id), { action: "pr.merge", branchPattern: "one-more" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("too_many");
    // Saying one that is there already is fine.
    expect((await r.call("alice", "POST", P(id), { action: "pr.merge", branchPattern: "b7" })).statusCode).toBe(200);
    await r.app.close();
  });

  it("is the project owner's alone: nobody else lists, makes or takes back its grants, and an unknown project or grant is not found", async () => {
    const r = await rig();
    const { id } = await withProject(r);
    const grant = (await r.call("alice", "POST", P(id), { action: "pr.ready" })).json().grant;
    expect((await r.call("bob", "GET", P(id))).statusCode).toBe(404);
    expect((await r.call("bob", "POST", P(id), { action: "pr.ready" })).statusCode).toBe(404);
    expect((await r.call("bob", "DELETE", `${P(id)}/${grant.id}`)).statusCode).toBe(404);
    for (const bad of ["not-a-uuid", "00000000-0000-4000-8000-000000000000"]) {
      expect((await r.call("alice", "GET", P(bad))).statusCode, bad).toBe(404);
      expect((await r.call("alice", "POST", P(bad), { action: "pr.ready" })).statusCode, bad).toBe(404);
      expect((await r.call("alice", "DELETE", `${P(bad)}/${grant.id}`)).statusCode, bad).toBe(404);
    }
    expect((await r.call("alice", "DELETE", `${P(id)}/not-a-uuid`)).statusCode).toBe(404);
    expect((await r.call("alice", "DELETE", `${P(id)}/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(404);
    expect((await r.call("alice", "GET", P(id))).json().grants).toEqual([grant]);
    // They go with the project.
    await r.call("alice", "DELETE", `/v1/code/projects/${id}`);
    expect(await r.store.listGrants(id)).toEqual([]);
    await r.app.close();
  });

  it("changes what the routes do: a standing allow skips the question, a deny is a 403 that says which action", async () => {
    const r = await rig();
    const { id, repo } = await withProject(r);
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "ship it" })).json();
    r.fake.push(repo, branch, { "feature.txt": "one\n" }, "Add the feature");
    await r.call("alice", "POST", `${B(id, branch)}/pr`, { title: "T", body: "B" });

    // Asks, first.
    expect((await r.call("alice", "POST", `${B(id, branch)}/pr/ready`)).json()).toMatchObject({ needsApproval: true, action: "pr.ready" });
    expect(r.fake.pulls(repo)[0]!.draft).toBe(true);
    // "Always, for the bot's own branches": it just does it.
    const allow = (await r.call("alice", "POST", P(id), { action: "pr.ready", branchPattern: "tailzu/*" })).json().grant;
    expect((await r.call("alice", "POST", `${B(id, branch)}/pr/ready`)).json()).toEqual({ draft: false });
    expect(r.fake.pulls(repo)[0]!.draft).toBe(false);
    // "Never merge": a 403, with the action, and not even a question.
    await r.call("alice", "POST", P(id), { action: "pr.merge", effect: "deny" });
    const merge = await r.call("alice", "POST", `${B(id, branch)}/pr/merge`);
    expect(merge.statusCode).toBe(403);
    expect(merge.json()).toMatchObject({ code: "policy_denied", action: "pr.merge", faceId: false });
    expect(merge.json().message).toMatch(/told Tailzu not to/);
    expect(r.fake.pulls(repo)[0]!.merged).toBe(false);
    // Taking the allow back: it asks again.
    await r.call("alice", "DELETE", `${P(id)}/${allow.id}`);
    r.fake.editPull(repo, 1, { draft: true });
    expect((await r.call("alice", "POST", `${B(id, branch)}/pr/ready`)).json()).toMatchObject({ needsApproval: true });
    await r.app.close();
  });

  it("answers a branch name that isn't one with not found, and a made-up approval with 409 approval_invalid", async () => {
    const r = await rig();
    const { id } = await withProject(r);
    expect((await r.call("alice", "POST", `/v1/code/projects/${id}/branches/${encodeURIComponent("a b")}/pr/ready`)).statusCode).toBe(404);
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x" })).json();
    r.fake.push(r.fake.repos[0]!, branch, { f: "x" });
    await r.call("alice", "POST", `${B(id, branch)}/pr`, { title: "T", body: "B" });
    const res = await r.call("alice", "POST", `${B(id, branch)}/pr/ready`, { approvalId: "made-up" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("approval_invalid");
    await r.app.close();
  });

  it("starts a branch from a ref, and says when there is none like it", async () => {
    const r = await rig();
    const { id, repo } = await withProject(r);
    const head = r.fake.head(repo, "main")!;
    r.fake.addTag(repo, "v1", head);
    r.fake.push(repo, "main", { "later.txt": "x" }, "later");
    const res = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "from the tag", from: "v1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().baseSha).toBe(head);
    expect((await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x", from: "nope" })).statusCode).toBe(404);
    for (const bad of [5, "", "a b", "x".repeat(300)]) {
      expect((await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x", from: bad })).statusCode, String(bad)).toBe(400);
    }
    await r.app.close();
  });

  it("says 409 protected_branch, in plain words, when GitHub's branch protection holds a merge back or refuses a delete", async () => {
    const r = await rig();
    const { id, repo } = await withProject(r);
    const { branch } = (await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "protected" })).json();
    r.fake.push(repo, branch, { "feature.txt": "one\n" }, "Add the feature");
    await r.call("alice", "POST", `${B(id, branch)}/pr`, { title: "T", body: "B" });
    await r.call("alice", "POST", P(id), { action: "pr.ready" });
    expect((await r.call("alice", "POST", `${B(id, branch)}/pr/ready`)).json()).toEqual({ draft: false });
    r.fake.protect(repo, "main", { checks: true });
    const ask = (await r.call("alice", "POST", `${B(id, branch)}/pr/merge`)).json();
    const res = await r.call("alice", "POST", `${B(id, branch)}/pr/merge`, { approvalId: ask.approvalId });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("protected_branch");
    expect(res.json().message).toMatch(/branch protection/);
    expect(res.body).not.toMatch(/status check|"ci"/);
    expect(r.fake.pulls(repo)[0]).toMatchObject({ state: "open", merged: false });
    await r.app.close();
  });
});

// ------------------------------------------------------------ Sign in with GitHub

describe("Sign in with GitHub, over HTTP", () => {
  const SIGNIN = "/v1/code/github/signin";
  const CALLBACK = "/v1/code/github/signin/callback";
  const B = (id: string, branch: string) => `/v1/code/projects/${id}/branches/${encodeURIComponent(branch)}`;

  /** Starts a sign-in over HTTP and has GitHub send the person back. Returns the token the code was traded for. */
  async function signIn(r: Rig, user = "alice", o: { scopes?: string[]; login?: string } = {}) {
    const begin = await r.call(user, "POST", SIGNIN, {});
    const u = new URL(begin.json().authorizeUrl);
    const token = `gho_${user}_route_token`;
    r.fake.addOAuthPerson(`code-${user}`, token, o.login ?? user, { scopes: o.scopes, challenge: u.searchParams.get("code_challenge")! });
    const back = await r.app.inject({ method: "GET", url: `${CALLBACK}?code=code-${user}&state=${encodeURIComponent(u.searchParams.get("state")!)}` });
    return { begin, back, token };
  }

  it("is off by default: 404 oauth_off on every sign-in route, and nothing about it in the status", async () => {
    const r = await rig();
    for (const [method, url] of [["POST", SIGNIN], ["DELETE", SIGNIN]] as const) {
      const res = await r.call("alice", method, url, method === "POST" ? {} : undefined);
      expect(res.statusCode, method).toBe(404);
      expect(res.json().code).toBe("oauth_off");
    }
    const cb = await r.app.inject({ method: "GET", url: `${CALLBACK}?code=a&state=b` });
    expect(cb.statusCode).toBe(404);
    expect(cb.headers["content-type"]).toContain("text/html");
    expect((await r.call("alice", "GET", "/v1/code/github")).json()).not.toHaveProperty("oauth");
    await r.app.close();
  });

  it("with the switch off but the OAuth App set up, sign-in is off and disconnecting (revoking) still works", async () => {
    const r = await rig({ signin: "off" });
    const res = await r.call("alice", "POST", SIGNIN, {});
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("oauth_off");
    expect((await r.app.inject({ method: "GET", url: `${CALLBACK}?code=a&state=b` })).statusCode).toBe(404);
    expect((await r.call("alice", "DELETE", SIGNIN)).json()).toEqual({ ok: true, revoked: false });
    await r.app.close();
  });

  it("answers 503 not_configured when it is switched on without the OAuth App's id and secret", async () => {
    const fake = new FakeGithub(KEYS);
    const code = createCode({
      store: new MemoryCodeStore(), webhookSecret: null, oauth: null, oauthEnabled: true,
      app: { slug: "s", clientId: fake.appClientId, clientSecret: "x", privateKey: KEYS.privateKeyPem }, fetchFn: fake.fetchFn,
    });
    const app = Fastify();
    registerCodeRoutes(app, { rateLimit: RL, code });
    for (const [method, url] of [["POST", SIGNIN], ["DELETE", SIGNIN]] as const) {
      const res = await app.inject({ method, url, headers: who("alice"), ...(method === "POST" ? { payload: {} } : {}) });
      expect(res.statusCode, method).toBe(503);
      expect(res.json().code).toBe("not_configured");
    }
    const cb = await app.inject({ method: "GET", url: `${CALLBACK}?code=a&state=b` });
    expect(cb.statusCode).toBe(503);
    await app.close();
  });

  it("wants a session to start or end a sign-in", async () => {
    const r = await rig({ signin: "on" });
    expect((await r.call(null, "POST", SIGNIN, {})).statusCode).toBe(401);
    expect((await r.call(null, "DELETE", SIGNIN)).statusCode).toBe(401);
    await r.app.close();
  });

  it("works with no GitHub App set up at all: sign-in is a way in of its own", async () => {
    const r = await rig({ signin: "on", github: false });
    const { back } = await signIn(r);
    expect(back.statusCode).toBe(200);
    // The App's own routes say the App isn't set up; the shared ones work.
    expect((await r.call("alice", "POST", "/v1/code/github/connect", {})).statusCode).toBe(503);
    expect((await r.call("alice", "DELETE", "/v1/code/github/installations/1")).statusCode).toBe(503);
    expect((await r.call("alice", "GET", "/v1/code/github")).json()).toMatchObject({ connected: true, oauth: { connected: true } });
    r.fake.addRepo(900, "alice/app");
    expect((await r.call("alice", "GET", "/v1/code/repos")).json().repos.map((x: { fullName: string }) => x.fullName)).toEqual(["alice/app"]);
    await r.app.close();
  });

  it("goes from the sign-in link to a merged pull request, and the token is in no reply at all", async () => {
    const r = await rig({ signin: "on" });
    const seen: string[] = [];
    const watch = async (res: ReturnType<Rig["call"]>) => { const x = await res; seen.push(x.body); return x; };

    const { begin, back, token } = await signIn(r);
    seen.push(begin.body, back.body);
    const u = new URL(begin.json().authorizeUrl);
    expect(u.searchParams.get("scope")).toBe("repo read:user");
    expect(back.statusCode).toBe(200);
    expect(back.headers["content-type"]).toContain("text/html");
    expect(back.headers["cache-control"]).toBe("no-store");
    expect(back.body).toContain("<h1>GitHub connected</h1>");
    expect(back.body).toContain('<a href="tulmi://">Open Tailzu</a>');

    const status = (await watch(r.call("alice", "GET", "/v1/code/github"))).json();
    expect(status).toMatchObject({ connected: true, installations: [], oauth: { connected: true, login: "alice", status: "active", workflow: false } });

    const repo = r.fake.addRepo(900, "alice/app", { files: { "README.md": "# app\n" } });
    const listed = (await watch(r.call("alice", "GET", "/v1/code/repos"))).json();
    expect(listed).toEqual({ repos: [{ id: repo.id, fullName: "alice/app", private: true, defaultBranch: "main", installationId: 0, source: "oauth" }], truncated: false });

    const added = (await watch(r.call("alice", "POST", "/v1/code/projects", { repoId: repo.id }))).json();
    expect(added.project).toMatchObject({ linkKind: "oauth", installationId: 0, fullName: "alice/app" });
    const id = added.project.id as string;
    const { branch } = (await watch(r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "ship it" }))).json();
    r.fake.push(repo, branch, { "feature.txt": "one\n" }, "Add the feature");
    expect((await watch(r.call("alice", "POST", `${B(id, branch)}/pr`, { title: "Add feature", body: "B" }))).json().prNumber).toBe(1);
    const readyAsk = (await watch(r.call("alice", "POST", `${B(id, branch)}/pr/ready`))).json();
    expect(readyAsk).toMatchObject({ needsApproval: true, action: "pr.ready" });
    expect((await watch(r.call("alice", "POST", `${B(id, branch)}/pr/ready`, { approvalId: readyAsk.approvalId }))).json()).toEqual({ draft: false });
    const ask = (await watch(r.call("alice", "POST", `${B(id, branch)}/pr/merge`))).json();
    expect(ask.needsApproval).toBe(true);
    expect((await watch(r.call("alice", "POST", `${B(id, branch)}/pr/merge`, { approvalId: ask.approvalId }))).json().merged).toBe(true);
    expect(r.fake.files(repo, "main")).toMatchObject({ "feature.txt": "one\n" });
    // The commits it made carry the trailer; the merge is the person's own, through their token.
    expect(r.fake.calls.filter((c) => c.headers.authorization === `Bearer ${token}`).length).toBeGreaterThan(5);

    // Tailzu only touched what was added: a repo that was not is out of reach, though the token reaches it.
    const other = r.fake.addRepo(900, "alice/other");
    const outsider = (await watch(r.call("alice", "POST", `/v1/code/projects/${other.id}/branches`, { task: "x" })));
    expect(outsider.statusCode).toBe(404);

    // Nothing the server sent, in any reply, held the token, the client secret, or the ciphertext.
    const link = (await r.store.getOAuthLink("alice"))!;
    for (const text of seen) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(r.fake.oauthClientSecret);
      expect(text).not.toContain(link.tokenEnc!);
    }

    // Disconnecting revokes at GitHub and forgets the link and its projects.
    const out = await r.call("alice", "DELETE", SIGNIN);
    expect(out.json()).toEqual({ ok: true, revoked: true });
    expect(r.fake.revoked).toEqual([token]);
    expect((await r.call("alice", "GET", "/v1/code/projects")).json()).toEqual({ projects: [] });
    expect((await r.call("alice", "GET", "/v1/code/github")).json().oauth).toEqual({ connected: false });
    await r.app.close();
  });

  it("refuses a token with scopes beyond what was asked: a 403 page, revoked, nothing connected", async () => {
    const r = await rig({ signin: "on" });
    const { back } = await signIn(r, "alice", { scopes: ["repo", "read:user", "delete_repo"] });
    expect(back.statusCode).toBe(403);
    expect(back.body).toContain("Nothing was connected");
    expect(back.body).not.toContain("gho_");
    expect(r.fake.revoked).toEqual(["gho_alice_route_token"]);
    expect((await r.call("alice", "GET", "/v1/code/github")).json().oauth).toEqual({ connected: false });
    await r.app.close();
  });

  it("answers a callback that is wrong, expired, replayed or declined with a 400 page", async () => {
    const r = await rig({ signin: "on" });
    const { back } = await signIn(r);
    expect(back.statusCode).toBe(200);
    const u = new URL((await r.call("alice", "POST", SIGNIN, {})).json().authorizeUrl);
    const state = u.searchParams.get("state")!;
    for (const url of [
      `${CALLBACK}?code=x&state=garbage`, `${CALLBACK}?state=${state}`, `${CALLBACK}?code=x`, `${CALLBACK}`,
      `${CALLBACK}?error=access_denied&state=${state}`, `${CALLBACK}?code=a&code=b&state=${state}`, `${CALLBACK}?code=${"a".repeat(5000)}&state=${state}`,
    ]) {
      const res = await r.app.inject({ method: "GET", url });
      expect(res.statusCode, url.slice(0, 70)).toBe(400);
      expect(res.headers["content-type"]).toContain("text/html");
    }
    // The state is spent only by an exchange that was tried; the one used above can't be used again.
    r.fake.addOAuthPerson("again", "gho_replay", "alice", { challenge: u.searchParams.get("code_challenge")! });
    expect((await r.app.inject({ method: "GET", url: `${CALLBACK}?code=again&state=${encodeURIComponent(state)}` })).statusCode).toBe(200);
    expect((await r.app.inject({ method: "GET", url: `${CALLBACK}?code=again&state=${encodeURIComponent(state)}` })).statusCode).toBe(400);
    await r.app.close();
  });

  it("tells the phone to sign in again when GitHub kills the token: 403 needs_signin everywhere, then back to normal", async () => {
    const r = await rig({ signin: "on" });
    const { token } = await signIn(r);
    const repo = r.fake.addRepo(900, "alice/app");
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: repo.id })).json().project.id as string;
    r.fake.killOAuthToken(token);
    const res = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("needs_signin");
    expect((await r.call("alice", "GET", "/v1/code/github")).json().oauth).toMatchObject({ connected: false, status: "needs_signin", login: "alice" });
    expect((await r.call("alice", "GET", "/v1/code/repos")).json()).toEqual({ repos: [], truncated: false, needsSignin: true });
    expect((await r.call("alice", "POST", "/v1/code/projects", { repoId: repo.id })).json().code).toBe("needs_signin");
    const { back } = await signIn(r);
    expect(back.statusCode).toBe(200);
    expect((await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x" })).statusCode).toBe(200);
    await r.app.close();
  });

  it("says 'org_blocked' with a hint when an organisation hasn't let the sign-in in", async () => {
    const r = await rig({ signin: "on" });
    await signIn(r);
    const acme = r.fake.addRepo(901, "acme/api");
    r.fake.setPermission(acme, "alice", "write");
    const id = (await r.call("alice", "POST", "/v1/code/projects", { repoId: acme.id })).json().project.id as string;
    r.fake.blockOrg(acme);
    const res = await r.call("alice", "POST", `/v1/code/projects/${id}/branches`, { task: "x" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("org_blocked");
    expect(res.json().message).toMatch(/organi[sz]ation/i);
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
    for (const k of [
      "CODE_GITHUB", "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET",
      "CODE_GITHUB_OAUTH", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET",
    ]) {
      expect(ENV_KEYS).toContain(k);
    }
  });
});

// ------------------------------------------------------------ the webhook, through the real server

describe("the real server with the Code bot on: GitHub's webhook, and deleting an account", () => {
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
    process.env.CODE_GITHUB_OAUTH = "true";
    process.env.GITHUB_OAUTH_CLIENT_ID = "Ov1.oauthclient";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "oauth-secret-xyz";
    resetConfigForTests();
    resetCodeStoreForTests();
    const { buildApp } = await import("../src/server.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    for (const k of ["CODE_GITHUB", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET", "CODE_GITHUB_OAUTH", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"]) delete process.env[k];
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

  it("follows a work branch's pull request: closed, merged, reopened, and a review coming in", async () => {
    const s = store();
    const p = await s.createProject("alice", { installationId: 101, repoId: 4242, fullName: "acme/app", defaultBranch: "main", private: true });
    await s.addBranch({ projectId: p.id, branch: "tailzu/fix-0001", task: "t", baseSha: "a".repeat(40) });
    await s.setBranchPr(p.id, "tailzu/fix-0001", 3, "https://github.com/acme/app/pull/3");
    const event = (name: string, action: string, extra: Record<string, unknown> = {}) => hook(name, {
      action, repository: { id: 4242 }, installation: { id: 101 }, ...extra,
      pull_request: { number: 3, merged: extra.merged === true, head: { ref: "tailzu/fix-0001", repo: { id: 4242 } } },
    });
    const state = async () => (await s.getBranch(p.id, "tailzu/fix-0001"))!;

    expect((await event("pull_request", "closed")).statusCode).toBe(200);
    expect((await state()).state).toBe("closed");
    expect((await event("pull_request", "reopened")).statusCode).toBe(200);
    expect((await state()).state).toBe("pr_open");
    expect((await event("pull_request", "closed", { merged: true })).statusCode).toBe(200);
    expect((await state()).state).toBe("merged");
    const review = await event("pull_request_review", "submitted", { review: { submitted_at: "2026-10-26T14:00:00Z" } });
    expect(review.statusCode).toBe(200);
    expect((await state()).lastReviewAt).toBe(Date.parse("2026-10-26T14:00:00Z"));
    // Not signed: not believed.
    const raw = JSON.stringify({ action: "reopened", repository: { id: 4242 }, pull_request: { head: { ref: "tailzu/fix-0001", repo: { id: 4242 } } } });
    expect((await hook("pull_request", null, { raw, signature: "sha256=" + "0".repeat(64) })).statusCode).toBe(401);
    expect((await state()).state).toBe("merged");
    // A pull request from a fork that names the same branch moves nothing.
    expect((await hook("pull_request", { action: "reopened", repository: { id: 4242 }, pull_request: { head: { ref: "tailzu/fix-0001", repo: { id: 9 } } } })).statusCode).toBe(202);
    expect((await state()).state).toBe("merged");
    await s.deleteProject("alice", p.id);
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

  it("revokes a person's GitHub sign-in token at GitHub when their account is deleted", async () => {
    const fake = new FakeGithub(KEYS);
    const { encrypt } = await import("../src/connectors/crypto.js");
    const token = "gho_doomed_token";
    fake.oauthTokens.set(token, { login: "alice", id: 1, scopes: ["repo", "read:user"] });
    await store().saveOAuthLink("alice", { githubUserId: 1, githubLogin: "alice", tokenEnc: encrypt(token), scope: "repo, read:user" });
    const deleted: string[] = [];
    stub.admin = {
      from: (table: string) => ({ delete: () => ({ eq: async () => { deleted.push(table); return { error: null, count: 0 }; } }) }),
      auth: { admin: { deleteUser: async () => ({ error: null }) } },
    };
    const real = globalThis.fetch;
    globalThis.fetch = fake.fetchFn;
    try {
      const res = await app.inject({ method: "DELETE", url: "/v1/account", headers: who("alice") });
      expect(res.statusCode).toBe(200);
      expect(fake.revoked).toEqual([token]);
      // And its rows were in the list of what is deleted.
      expect(deleted).toEqual(expect.arrayContaining(["code_oauth_links", "code_projects", "code_installations"]));
    } finally {
      globalThis.fetch = real;
      stub.admin = null;
    }
  });

  it("still deletes the account when GitHub can't be reached to revoke the sign-in token", async () => {
    const fake = new FakeGithub(KEYS);
    const { encrypt } = await import("../src/connectors/crypto.js");
    await store().saveOAuthLink("bob", { githubUserId: 2, githubLogin: "bob", tokenEnc: encrypt("gho_bob"), scope: "repo, read:user" });
    stub.admin = { from: () => ({ delete: () => ({ eq: async () => ({ error: null, count: 0 }) }) }), auth: { admin: { deleteUser: async () => ({ error: null }) } } };
    fake.failWith = { prefix: "/applications", status: 500 };
    const real = globalThis.fetch;
    globalThis.fetch = fake.fetchFn;
    try {
      // The account goes either way: a deletion is never held up by GitHub. The row (and so the token) goes with it.
      expect((await app.inject({ method: "DELETE", url: "/v1/account", headers: who("bob") })).statusCode).toBe(200);
    } finally {
      globalThis.fetch = real;
      stub.admin = null;
    }
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

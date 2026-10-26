/**
 * The Code bot's GitHub side, against a fake GitHub (tests/github-fake.ts):
 * the App's JWT and installation tokens, tying an install to a person,
 * listing repos, projects, work branches, the guard on every write, commits,
 * draft PRs, the workspace the bot will use, and what the webhook does.
 *
 * Nothing here reaches the network: GitHub is an injected fetchFn.
 */
import { createPrivateKey } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { appKeys, FakeGithub } = await import("./github-fake.js");
const { GithubApp, assertWorkBranch, assertRepoPath, parsePrivateKey, REPOS_MAX } = await import("../src/code/github.js");
const { MemoryCodeStore } = await import("../src/code/store.js");
const { beginConnect, completeCallback, CODE_STATE_ID, forgetInstallation, installationView, linkStatus, manageUrl } = await import("../src/code/link.js");
const {
  PROJECTS_MAX, addProject, branchSlug, createWorkBranch, listBranches, listRepos, newBranchName, openPr, workspace,
} = await import("../src/code/projects.js");
const { handleWebhook, signatureFor, signatureOk } = await import("../src/code/webhook.js");
const { signState, verifyState } = await import("../src/connectors/oauth.js");

type Fake = InstanceType<typeof FakeGithub>;

let KEYS: ReturnType<typeof appKeys>;
beforeAll(() => { KEYS = appKeys(); });

const MIN = 60_000;

/** A fake GitHub, a store, and the App client wired to the one through the other's clock. */
function rig(o: { clientId?: string; appId?: string; privateKey?: string } = {}) {
  const fake: Fake = new FakeGithub(KEYS);
  const store = new MemoryCodeStore();
  const github = new GithubApp(
    {
      slug: "tailzu-test", clientId: o.clientId ?? fake.appClientId, clientSecret: fake.clientSecret,
      privateKey: o.privateKey ?? KEYS.privateKeyPem, appId: o.appId ?? "123456",
    },
    { fetchFn: fake.fetchFn, now: () => fake.clock.t },
  );
  return { fake, store, github, d: { store, github } };
}

/** What the install step keeps of who the person is on GitHub. */
const asLinked = (login: string | null, id = 77) => ({ githubUserId: login === null ? null : id, githubLogin: login });

/** Alice, with an install that has a repo, linked on our side. */
async function withProject() {
  const r = rig();
  r.fake.addInstall(101, "alice");
  const repo = r.fake.addRepo(101, "alice/app", { files: { "README.md": "# app\n", "src/a.ts": "export const a = 1;\n" } });
  await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", ...asLinked("alice") });
  const { project } = await addProject(r.d, "alice", repo.id);
  return { ...r, repo, project };
}

// ---------------------------------------------------------------- the JWT

describe("the App's JWT", () => {
  const verify = async (jwt: string, now: number, iss: string) =>
    (await jwtVerify(jwt, await importSPKI(KEYS.publicKeyPem, "RS256"), { algorithms: ["RS256"], issuer: iss, currentDate: new Date(now) })).payload;

  it("is RS256, verifies with the public key, and has iss = the client id, iat = now - 60 and exp = now + 540", async () => {
    const { github, fake } = rig();
    const jwt = await github.appJwt();
    expect(decodeProtectedHeader(jwt).alg).toBe("RS256");
    const p = await verify(jwt, fake.clock.t, fake.appClientId);
    const now = Math.floor(fake.clock.t / 1000);
    expect(p.iss).toBe(fake.appClientId);
    expect(p.iat).toBe(now - 60);
    expect(p.exp).toBe(now + 540);
  });

  it("falls back to the App id as issuer when there is no client id", async () => {
    const { github, fake } = rig({ clientId: "", appId: "424242" });
    expect((await verify(await github.appJwt(), fake.clock.t, "424242")).iss).toBe("424242");
  });

  it("is kept for eight minutes, then made again", async () => {
    const { github, fake } = rig();
    const first = await github.appJwt();
    fake.clock.t += 7 * MIN;
    expect(await github.appJwt()).toBe(first);
    fake.clock.t += 2 * MIN;
    const next = await github.appJwt();
    expect(next).not.toBe(first);
    await verify(next, fake.clock.t, fake.appClientId);
  });

  it("reads the private key as raw PEM, base64 of the PEM, a PEM with \\n written out, and a quoted one", async () => {
    const pem = KEYS.privateKeyPem;
    expect(pem).toContain("BEGIN RSA PRIVATE KEY"); // GitHub's own PKCS#1
    const pkcs8 = createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString();
    const forms = [
      pem,
      Buffer.from(pem).toString("base64"),
      pem.trim().replace(/\n/g, "\\n"),
      `"${pem.trim().replace(/\n/g, "\\n")}"`,
      Buffer.from(pem.trim().replace(/\n/g, "\\n")).toString("base64"),
      pkcs8,
    ];
    for (const form of forms) {
      const { github, fake } = rig({ privateKey: form });
      await verify(await github.appJwt(), fake.clock.t, fake.appClientId);
    }
  });

  it("refuses a key it can't read, without repeating it", () => {
    for (const bad of ["", "not a key", Buffer.from("not a key").toString("base64")]) {
      try {
        parsePrivateKey(bad || "x");
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toMatchObject({ code: "not_configured" });
        if (bad) expect(String((e as Error).message)).not.toContain(bad);
      }
    }
    expect(() => rig({ privateKey: "garbage" })).toThrow(/private key/);
  });
});

// -------------------------------------------------------- installation tokens

describe("installation tokens", () => {
  it("lists repos with an unscoped token that can only read metadata, and everything else with a token for ONE repo", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "alice");
    const a = fake.addRepo(101, "alice/a"), b = fake.addRepo(101, "alice/b");
    await github.listRepos(101);
    await github.branchHead({ installationId: 101, repoId: a.id, fullName: a.fullName, defaultBranch: "main" }, "main");

    const mints = fake.calls.filter((c) => c.url.pathname === "/app/installations/101/access_tokens");
    expect(mints).toHaveLength(2);
    expect(mints[0]!.body).toEqual({ permissions: { metadata: "read" } });
    expect(mints[1]!.body).toEqual({ repository_ids: [a.id], permissions: { contents: "write", pull_requests: "write", metadata: "read" } });
    // The App's JWT is what asks for a token; the token is what then calls the repo.
    expect(mints.every((c) => /^Bearer eyJ/.test(c.headers.authorization!))).toBe(true);
    const repoCall = fake.calls.find((c) => c.url.pathname.includes("/git/ref/"))!;
    expect(repoCall.headers.authorization).toMatch(/^Bearer ghs_/);
    // The token for A is no good on B (the fake enforces it, as GitHub does).
    const tokenA = repoCall.headers.authorization!.slice(7);
    expect(fake.tokens.get(tokenA)!.repositoryIds).toEqual([a.id]);
    expect(b.id).not.toBe(a.id);
  });

  it("sends GitHub's three headers and a 15 second timeout on every call", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "alice");
    const a = fake.addRepo(101, "alice/a");
    await github.listRepos(101);
    await github.tree({ installationId: 101, repoId: a.id, fullName: a.fullName, defaultBranch: "main" }, "main");
    for (const c of fake.calls) {
      expect(c.headers.accept).toBe("application/vnd.github+json");
      expect(c.headers["x-github-api-version"]).toBe("2022-11-28");
      expect(c.headers["user-agent"]).toBe("tailzu");
      expect(c.signal).toBe(true);
    }
  });

  it("reuses a token until five minutes before it runs out, per install and repo", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "alice");
    const a = fake.addRepo(101, "alice/a"), b = fake.addRepo(101, "alice/b");
    const mints = () => fake.count("POST", /access_tokens/);
    const refA = { installationId: 101, repoId: a.id, fullName: a.fullName, defaultBranch: "main" };
    const refB = { installationId: 101, repoId: b.id, fullName: b.fullName, defaultBranch: "main" };

    await github.branchHead(refA, "main");
    await github.branchHead(refA, "main");
    expect(mints()).toBe(1);
    await github.branchHead(refB, "main"); // its own token
    expect(mints()).toBe(2);
    await github.listRepos(101); // and the unscoped one is another
    expect(mints()).toBe(3);

    fake.clock.t += 54 * MIN; // expires at 60: still good at 54
    await github.branchHead(refA, "main");
    expect(mints()).toBe(3);
    fake.clock.t += 2 * MIN; // 56: inside the five-minute margin
    await github.branchHead(refA, "main");
    expect(mints()).toBe(4);
  });

  it("makes one token for two calls that ask at once", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "alice");
    const a = fake.addRepo(101, "alice/a");
    const ref = { installationId: 101, repoId: a.id, fullName: a.fullName, defaultBranch: "main" };
    await Promise.all([github.branchHead(ref, "main"), github.tree(ref, "main"), github.readFile(ref, "main", "README.md")]);
    expect(fake.count("POST", /access_tokens/)).toBe(1);
  });

  it("turns a GitHub failure into plain words, never GitHub's own", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "alice");
    fake.failWith = { prefix: "/app/installations", status: 500 };
    const err = await github.listRepos(101).catch((e) => e);
    expect(err).toMatchObject({ code: "failed" });
    expect(err.message).not.toContain("boom");
    // An install that is gone (or suspended) is not a crash either.
    fake.failWith = null;
    await expect(github.listRepos(999)).rejects.toMatchObject({ code: "not_found" });
    fake.installs.get(101)!.suspendedAt = "2026-10-01T00:00:00Z";
    await expect(github.listRepos(101)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("answers a GitHub that doesn't answer, or isn't there, as 'failed'", async () => {
    const { fake } = rig();
    const dead = new GithubApp(
      { slug: "s", clientId: "c", clientSecret: "x", privateKey: KEYS.privateKeyPem },
      { fetchFn: (async () => { throw new TypeError("fetch failed: ECONNREFUSED secret-host"); }) as typeof fetch, now: () => fake.clock.t },
    );
    const err = await dead.listRepos(1).catch((e) => e);
    expect(err).toMatchObject({ code: "failed" });
    expect(err.message).not.toContain("secret-host");
  });
});

// ------------------------------------------------------------ linking

describe("tying an install to a person", () => {
  const url = (state: string, extra = "") => ({ state, ...Object.fromEntries(new URLSearchParams(extra)) });

  it("hands out GitHub's install link carrying a state that is that person's and nobody else's", async () => {
    const { d, fake } = rig();
    const { installUrl } = await beginConnect(d, "alice", fake.clock.t);
    const u = new URL(installUrl);
    expect(`${u.origin}${u.pathname}`).toBe("https://github.com/apps/tailzu-test/installations/new");
    const st = await verifyState(u.searchParams.get("state")!, fake.clock.t);
    expect(st).toMatchObject({ userId: "alice", connectorId: CODE_STATE_ID });
    expect(CODE_STATE_ID).toBe("code-github");
  });

  it("links the install GitHub says the person can reach, and keeps no GitHub token of theirs", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice-org", { type: "Organization", selection: "all" });
    fake.addPerson("code-1", "gho_alicetoken", [101], "alice-on-github");
    const state = await signState("alice", CODE_STATE_ID, fake.clock.t);

    const r = await completeCallback(d, { code: "code-1", installationId: "101", setupAction: "install", state }, fake.clock.t);
    expect(r.kind).toBe("connected");
    expect(await store.listInstallations("alice")).toMatchObject([
      {
        userId: "alice", installationId: 101, accountLogin: "alice-org", accountType: "Organization", repositorySelection: "all",
        suspendedAt: null, githubUserId: fake.profiles.get("gho_alicetoken")!.id, githubLogin: "alice-on-github",
      },
    ]);
    // The code was traded once; the person's token went to /user/installations and /user (who they are) and nowhere else; nothing kept it.
    expect(fake.codes.has("code-1")).toBe(false);
    const withUserToken = fake.calls.filter((c) => c.headers.authorization === "Bearer gho_alicetoken");
    expect(withUserToken.map((c) => c.url.pathname)).toEqual(["/user/installations", "/user"]);
    expect(withUserToken[0]!.url.search).toBe("?per_page=100");
    expect(JSON.stringify(await store.listInstallations("alice"))).not.toContain("gho_");
    // The code exchange sent the client id, secret and code as JSON, asking for JSON back.
    const ex = fake.calls.find((c) => c.url.hostname === "github.com")!;
    expect(ex.body).toEqual({ client_id: fake.appClientId, client_secret: fake.clientSecret, code: "code-1" });
    expect(ex.headers.accept).toBe("application/json");
  });

  it("refuses an install the person can't reach, even with a valid code and the right number", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice");
    fake.addInstall(202, "carol"); // somebody else's
    fake.addPerson("code-1", "gho_alice", [101]);
    const state = await signState("alice", CODE_STATE_ID, fake.clock.t);
    await expect(completeCallback(d, { code: "code-1", installationId: "202", setupAction: "install", state }, fake.clock.t))
      .rejects.toMatchObject({ code: "not_yours" });
    expect(await store.listInstallations("alice")).toEqual([]);
  });

  it("refuses a state that is missing, garbage, tampered, expired, or for something else, before calling GitHub", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice");
    fake.addPerson("code-1", "gho_alice", [101]);
    const good = await signState("alice", CODE_STATE_ID, fake.clock.t);
    const tampered = good.slice(0, -3) + (good.endsWith("AAA") ? "BBB" : "AAA");
    const expired = await signState("alice", CODE_STATE_ID, fake.clock.t - 11 * MIN);
    const otherApp = await signState("alice", "notion", fake.clock.t);
    for (const state of [undefined, "", "garbage", tampered, expired, otherApp]) {
      await expect(completeCallback(d, { code: "code-1", installationId: "101", setupAction: "install", state }, fake.clock.t), String(state))
        .rejects.toMatchObject({ code: "bad_state" });
    }
    expect(fake.calls).toHaveLength(0);
    expect(await store.listInstallations("alice")).toEqual([]);
    // And the good one still works: nothing above spent the code.
    expect((await completeCallback(d, { code: "code-1", installationId: "101", state: good }, fake.clock.t)).kind).toBe("connected");
  });

  it("refuses a code GitHub doesn't accept, and an install_id that isn't a number", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice");
    const state = await signState("alice", CODE_STATE_ID, fake.clock.t);
    await expect(completeCallback(d, { code: "used-up", installationId: "101", state }, fake.clock.t)).rejects.toMatchObject({ code: "bad_state" });
    fake.addPerson("code-1", "gho_alice", [101]);
    for (const bad of [undefined, "", "abc", "-1", "0", "1e3", "101; drop"]) {
      await expect(completeCallback(d, { code: "code-1", installationId: bad, state }, fake.clock.t)).rejects.toMatchObject({ code: "bad_request" });
    }
    expect(await store.listInstallations("alice")).toEqual([]);
  });

  it("says an organisation's owner has to approve when setup_action is request, and links nothing", async () => {
    const { d, fake, store } = rig();
    expect(await completeCallback(d, { setupAction: "request", state: "ignored" }, fake.clock.t)).toEqual({ kind: "waiting" });
    expect(fake.calls).toHaveLength(0);
    expect(await store.listInstallations("alice")).toEqual([]);
  });

  it("with no code, looks again at the installs already linked: new account, new repo choice, gone, suspended", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice-renamed", { selection: "all" });
    fake.addInstall(103, "alice", { suspended: true });
    for (const [id, login] of [[101, "alice"], [102, "gone-org"], [103, "alice"]] as const) {
      await store.upsertInstallation("alice", { installationId: id, accountLogin: login, accountType: "User", repositorySelection: "selected", ...asLinked("alice-gh", 55) });
    }
    await store.upsertInstallation("bob", { installationId: 102, accountLogin: "gone-org", accountType: "User", repositorySelection: "selected" });
    const state = await signState("alice", CODE_STATE_ID, fake.clock.t);

    const r = await completeCallback(d, { installationId: "101", setupAction: "update", state }, fake.clock.t);
    expect(r).toEqual({ kind: "synced", count: 2 });
    const mine = await store.listInstallations("alice");
    expect(mine.map((i) => i.installationId)).toEqual([101, 103]);
    expect(mine[0]).toMatchObject({ accountLogin: "alice-renamed", repositorySelection: "all", suspendedAt: null });
    // Who the person is on GitHub is kept as it was: looking again has no token of theirs to ask with.
    expect(mine.map((i) => [i.githubUserId, i.githubLogin])).toEqual([[55, "alice-gh"], [55, "alice-gh"]]);
    expect(mine[1]!.suspendedAt).not.toBeNull();
    // Bob's link to the install that is gone is bob's to find out about; only the person asking was looked at.
    expect(await store.getInstallation("bob", 102)).not.toBeNull();
    // It never needed the person's own token.
    expect(fake.calls.some((c) => c.url.pathname === "/user/installations")).toBe(false);
  });

  it("shows what is connected, with the page to manage each install on GitHub", async () => {
    const { d, store } = rig();
    expect(await linkStatus(d, "alice")).toEqual({ configured: true, connected: false, installations: [] });
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "all", ...asLinked("alice") });
    await store.upsertInstallation("alice", { installationId: 202, accountLogin: "acme", accountType: "Organization", repositorySelection: "selected", suspendedAt: 5, ...asLinked("alice") });
    // A link from before the GitHub login was kept says it has to be made again.
    await store.upsertInstallation("alice", { installationId: 303, accountLogin: "old", accountType: "User", repositorySelection: "all" });
    const s = await linkStatus(d, "alice");
    expect(s.connected).toBe(true);
    expect(s.installations).toEqual([
      { id: 101, account: "alice", accountType: "User", repositorySelection: "all", suspended: false, manageUrl: "https://github.com/settings/installations/101" },
      { id: 202, account: "acme", accountType: "Organization", repositorySelection: "selected", suspended: true, manageUrl: "https://github.com/organizations/acme/settings/installations/202" },
      { id: 303, account: "old", accountType: "User", repositorySelection: "all", suspended: false, manageUrl: "https://github.com/settings/installations/303", needsReconnect: true },
    ]);
    expect(manageUrl("acme", "Organization", 7)).toBe("https://github.com/organizations/acme/settings/installations/7");
    expect(installationView((await store.listInstallations("alice"))[0]!).manageUrl).toBe("https://github.com/settings/installations/101");
  });

  it("forgets a link and its projects here, only for the person who asked, and says where to uninstall", async () => {
    const { d, store, repo, project } = await withProject();
    await store.upsertInstallation("bob", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", ...asLinked("bob") });
    await expect(forgetInstallation(d, "carol", 101)).rejects.toMatchObject({ code: "not_found" });
    expect(await forgetInstallation(d, "alice", 101)).toEqual({ ok: true, manageUrl: "https://github.com/settings/installations/101" });
    expect(await store.getInstallation("alice", 101)).toBeNull();
    expect(await store.getProject("alice", project.id)).toBeNull();
    // The other person's link to the same install is theirs and is left.
    expect(await store.getInstallation("bob", 101)).not.toBeNull();
    expect(repo.id).toBe(project.repoId);
  });
});

// ------------------------------------------------------------ repos

describe("listing repos", () => {
  it("stops at 300 and says so", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "big");
    for (let i = 0; i < 350; i += 1) fake.addRepo(101, `big/r${i}`, { id: 5000 + i, files: { "a": "a" } });
    const r = await github.listRepos(101);
    expect(r.repos).toHaveLength(REPOS_MAX);
    expect(REPOS_MAX).toBe(300);
    expect(r.truncated).toBe(true);
    expect(fake.count("GET", /^\/installation\/repositories/)).toBe(3);
    expect(r.repos[0]).toMatchObject({ id: 5000, fullName: "big/r0", defaultBranch: "main", private: true, archived: false });
  });

  it("is not truncated at exactly 300, or below", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "exact");
    fake.addInstall(102, "few");
    for (let i = 0; i < 300; i += 1) fake.addRepo(101, `exact/r${i}`, { id: 7000 + i, files: { "a": "a" } });
    fake.addRepo(102, "few/one");
    expect(await github.listRepos(101)).toMatchObject({ truncated: false, repos: expect.any(Array) });
    expect((await github.listRepos(101)).repos).toHaveLength(300);
    expect(await github.listRepos(102)).toMatchObject({ truncated: false });
    expect(fake.calls.filter((c) => c.url.pathname === "/installation/repositories" && c.url.searchParams.get("page") === "4")).toHaveLength(0);
  });

  it("lists across the person's installs, leaves out archived repos and suspended installs, and says if any was cut", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice");
    fake.addInstall(102, "acme", { type: "Organization" });
    fake.addInstall(103, "frozen");
    fake.addRepo(101, "alice/one", { id: 11 });
    fake.addRepo(101, "alice/old", { id: 12, archived: true });
    const two = fake.addRepo(102, "acme/two", { id: 21, private: false, defaultBranch: "trunk" });
    fake.addRepo(103, "frozen/three", { id: 31 });
    fake.setPermission(two, "alice", "write"); // a member of acme who can push there
    for (const [id, login, type] of [[101, "alice", "User"], [102, "acme", "Organization"], [103, "frozen", "User"]] as const) {
      await store.upsertInstallation("alice", { installationId: id, accountLogin: login, accountType: type, repositorySelection: "all", suspendedAt: id === 103 ? 1 : undefined, ...asLinked("alice") });
    }
    expect(await listRepos(d, "alice")).toEqual({
      repos: [
        { id: 11, fullName: "alice/one", private: true, defaultBranch: "main", installationId: 101 },
        { id: 21, fullName: "acme/two", private: false, defaultBranch: "trunk", installationId: 102 },
      ],
      truncated: false,
    });
    expect(await listRepos(d, "nobody")).toEqual({ repos: [], truncated: false });
  });

  it("skips an install GitHub can't answer for while another works, and fails when none can", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice");
    fake.addRepo(101, "alice/one", { id: 11 });
    for (const [id, login] of [[101, "alice"], [404, "x"]] as const) {
      await store.upsertInstallation("alice", { installationId: id, accountLogin: login, accountType: "User", repositorySelection: "all", ...asLinked("alice") });
    }
    expect((await listRepos(d, "alice")).repos.map((r) => r.id)).toEqual([11]);
    await store.removeInstallation("alice", 101);
    await expect(listRepos(d, "alice")).rejects.toMatchObject({ code: "not_found" });
  });
});

// ------------------------------------------------------------ projects

describe("projects", () => {
  it("makes a repo from the person's installs a project, recording what the bot needs", async () => {
    const { project, repo } = await withProject();
    expect(project).toMatchObject({ userId: "alice", installationId: 101, repoId: repo.id, fullName: "alice/app", defaultBranch: "main", private: true });
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(project.createdAt).toBeGreaterThan(0);
  });

  it("gives the same project back for the same repo", async () => {
    const { d, repo, project, fake } = await withProject();
    const again = await addProject(d, "alice", repo.id);
    expect(again).toEqual({ project, created: false });
    expect(await d.store.listProjects("alice")).toHaveLength(1);
    // And it does not need to ask GitHub again.
    const before = fake.calls.length;
    await addProject(d, "alice", repo.id);
    expect(fake.calls.length).toBe(before);
  });

  it("is not found for a repo outside the person's installs, an archived one, or one on a suspended install", async () => {
    const { d, fake, store } = await withProject();
    fake.addInstall(202, "carol");
    const theirs = fake.addRepo(202, "carol/secret");
    const old = fake.addRepo(101, "alice/old", { archived: true });
    await expect(addProject(d, "alice", theirs.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(addProject(d, "alice", old.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(addProject(d, "alice", 123456789)).rejects.toMatchObject({ code: "not_found" });
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", suspendedAt: 1 });
    const fresh = fake.addRepo(101, "alice/fresh");
    await expect(addProject(d, "alice", fresh.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await store.listProjects("alice")).toHaveLength(1);
  });

  it("keeps people's projects apart: another person's is not theirs to read, make branches in, or delete", async () => {
    const { d, store, project } = await withProject();
    expect(await store.getProject("bob", project.id)).toBeNull();
    expect(await store.listProjects("bob")).toEqual([]);
    expect(await store.deleteProject("bob", project.id)).toBe(false);
    await expect(createWorkBranch(d, "bob", project.id, "x")).rejects.toMatchObject({ code: "not_found" });
    await expect(listBranches(d, "bob", project.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(workspace(d, "bob", project.id, "tailzu/x-1234")).rejects.toMatchObject({ code: "not_found" });
    expect(await store.getProject("alice", project.id)).not.toBeNull();
    expect(await store.deleteProject("alice", project.id)).toBe(true);
    expect(await store.listProjects("alice")).toEqual([]);
  });

  it("allows 50 projects a person and no more", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice");
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "all", ...asLinked("alice") });
    const repos = Array.from({ length: PROJECTS_MAX + 1 }, (_, i) => fake.addRepo(101, `alice/r${i}`, { id: 9000 + i, files: { a: "a" } }));
    for (const r of repos.slice(0, PROJECTS_MAX)) await addProject(d, "alice", r.id);
    await expect(addProject(d, "alice", repos[PROJECTS_MAX]!.id)).rejects.toMatchObject({ code: "too_many" });
    expect((await addProject(d, "alice", repos[0]!.id)).created).toBe(false);
    expect(await store.listProjects("alice")).toHaveLength(50);
  });
});

// ------------------------------------------------------------ branches

describe("work branches", () => {
  it("makes tailzu/<slug>-<4 hex> from the default branch's head and records it", async () => {
    const { d, fake, repo, project, store } = await withProject();
    const head = fake.head(repo, "main")!;
    const task = "Fix the login bug on the Settings page!!";
    const made = await createWorkBranch(d, "alice", project.id, task);

    expect(made.branch).toMatch(/^tailzu\/fix-the-login-bug-on-the-setting-[0-9a-f]{4}$/);
    expect(made.baseSha).toBe(head);
    expect(made.url).toBe(`https://github.com/alice/app/tree/${made.branch}`);
    expect(fake.head(repo, made.branch)).toBe(head);
    expect(await store.getBranch(project.id, made.branch)).toMatchObject({ projectId: project.id, branch: made.branch, task, baseSha: head, prNumber: null });
    expect((await listBranches(d, "alice", project.id)).map((b) => b.branch)).toEqual([made.branch]);
    // main itself was not touched.
    expect(fake.head(repo, "main")).toBe(head);
    expect(fake.writes().map((c) => `${c.method} ${c.url.pathname}`)).toEqual(["POST /repos/alice/app/git/refs"]);
    expect(fake.writes()[0]!.body).toEqual({ ref: `refs/heads/${made.branch}`, sha: head });
  });

  it("slugs a task: lower-case ASCII words joined by -, 32 characters at most, 'work' when none are left", () => {
    expect(branchSlug("Fix the login bug")).toBe("fix-the-login-bug");
    expect(branchSlug("  Add   dark_mode (v2) -- please  ")).toBe("add-dark-mode-v2-please");
    expect(branchSlug("Fix the login bug on the Settings page!!")).toBe("fix-the-login-bug-on-the-setting");
    expect(branchSlug("Fix the login bug on the Settings page!!")).toHaveLength(32);
    expect(branchSlug("a".repeat(31) + " bbb")).toBe("a".repeat(31)); // cut after the "-": no trailing dash
    expect(branchSlug("x".repeat(100))).toBe("x".repeat(32));
    expect(branchSlug("लॉगिन पेज ठीक करो")).toBe("work");
    expect(branchSlug("लॉगिन पेज fix करो")).toBe("fix");
    expect(branchSlug("🙂 !!! ---")).toBe("work");
    expect(branchSlug("")).toBe("work");
    for (const task of ["Fix the login bug", "लॉगिन ठीक करो", "x".repeat(500), "a b c"]) {
      expect(newBranchName(task)).toMatch(/^tailzu\/[a-z0-9][a-z0-9-]{0,31}-[0-9a-f]{4}$/);
      expect(() => assertWorkBranch(newBranchName(task), "main")).not.toThrow();
    }
  });

  it("names a Hindi task 'work' and keeps the first 200 characters of what was asked", async () => {
    const { d, project, store } = await withProject();
    const hindi = "लॉगिन पेज ठीक करो ".repeat(30);
    const made = await createWorkBranch(d, "alice", project.id, hindi);
    expect(made.branch).toMatch(/^tailzu\/work-[0-9a-f]{4}$/);
    const rec = (await store.getBranch(project.id, made.branch))!;
    expect([...rec.task]).toHaveLength(200);
    expect(hindi.trim().startsWith(rec.task)).toBe(true);
  });

  it("makes each branch from the default branch's head as it is NOW", async () => {
    const { d, fake, repo, project } = await withProject();
    const first = await createWorkBranch(d, "alice", project.id, "one");
    const moved = fake.push(repo, "main", { "new.txt": "x" }, "main moved");
    const second = await createWorkBranch(d, "alice", project.id, "two");
    expect(second.baseSha).toBe(moved);
    expect(second.baseSha).not.toBe(first.baseSha);
    expect((await listBranches(d, "alice", project.id)).map((b) => b.branch)).toEqual([second.branch, first.branch]);
  });

  it("picks another name when the four digits collide with a branch that is there", async () => {
    const { d, fake, repo, project } = await withProject();
    fake.refCollisions = 2;
    const made = await createWorkBranch(d, "alice", project.id, "same task");
    expect(fake.count("POST", /git\/refs$/)).toBe(3);
    expect(fake.head(repo, made.branch)).toBeDefined();
    fake.refCollisions = 99;
    await expect(createWorkBranch(d, "alice", project.id, "same task")).rejects.toMatchObject({ code: "branch_exists" });
  });

  it("wants a task, and an install that is linked and not suspended", async () => {
    const { d, project, store } = await withProject();
    for (const bad of [undefined, null, "", "   ", 42, {}]) {
      await expect(createWorkBranch(d, "alice", project.id, bad)).rejects.toMatchObject({ code: "bad_request" });
    }
    await store.setSuspended(101, 1);
    await expect(createWorkBranch(d, "alice", project.id, "x")).rejects.toMatchObject({ code: "suspended" });
    await store.setSuspended(101, null);
    await store.removeInstallation("alice", 101);
    await expect(createWorkBranch(d, "alice", project.id, "x")).rejects.toMatchObject({ code: "not_found" });
  });
});

// ------------------------------------------------------------ the guard

describe("the guard", () => {
  it("accepts tailzu/ branches and nothing else", () => {
    for (const ok of ["tailzu/fix-1a2b", "tailzu/work-0000", "tailzu/a", "tailzu/" + "a".repeat(49)]) {
      expect(() => assertWorkBranch(ok, "main"), ok).not.toThrow();
    }
    for (const bad of [
      "main", "master", "develop", "feature/x", "tailzu", "tailzu/", "tailzu//x", "tailzu/-x", "tailzu/Fix", "tailzu/a b",
      "tailzu/a..b", "tailzu/../main", "tailzu/x/y", "tailzu/" + "a".repeat(50), "refs/heads/main", "/tailzu/x", "xtailzu/x",
      "tailzu/x\n", "TAILZU/x", "", " tailzu/x", "tailzu/x.lock",
    ]) {
      expect(() => assertWorkBranch(bad, "main"), JSON.stringify(bad)).toThrowError(expect.objectContaining({ code: "bad_branch" }));
    }
    // Not even a work-branch-looking name when that IS the repo's default branch.
    expect(() => assertWorkBranch("tailzu/x-1234", "tailzu/x-1234")).toThrow();
    expect(() => assertWorkBranch(undefined as unknown as string, "main")).toThrow();
  });

  it("accepts only relative paths with no .. part, and writes nothing under .github/workflows or .git", () => {
    for (const ok of ["a.txt", "src/a/b.ts", "a..b.txt", ".github/CODEOWNERS", ".github/workflowsx/a", ".gitignore", "dir/.hidden", "ü/é.md"]) {
      expect(() => assertRepoPath(ok, true), ok).not.toThrow();
    }
    for (const bad of [
      "", "/etc/passwd", "../x", "a/../b", "a/..", "..", ".", "./a", "a//b", "a/", "C:\\x", "C:/x", "a\\b", "a\0b", "x".repeat(501),
      ".git/config", "a/.git/hooks/pre-commit", ".GIT/config", undefined, null, 7,
    ]) {
      expect(() => assertRepoPath(bad as string, true), JSON.stringify(bad)).toThrowError(expect.objectContaining({ code: "bad_path" }));
    }
    for (const wf of [".github/workflows/ci.yml", ".github/workflows/a/b.yml", ".GitHub/Workflows/ci.yml", ".github/workflows"]) {
      expect(() => assertRepoPath(wf, true), wf).toThrowError(expect.objectContaining({ code: "bad_path", message: expect.stringContaining("workflows") }));
      // Reading a workflow file is harmless.
      expect(() => assertRepoPath(wf, false), wf).not.toThrow();
    }
  });
});

// ------------------------------------------------------------ reading

describe("reading a branch", () => {
  it("reads the tree and files on the work branch", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "look around");
    const ws = await workspace(d, "alice", project.id, branch);
    const tree = await ws.tree();
    expect(tree.truncated).toBe(false);
    expect(tree.entries.map((e) => e.path).sort()).toEqual(["README.md", "src/a.ts"]);
    expect(tree.entries.find((e) => e.path === "src/a.ts")).toMatchObject({ type: "blob", size: 20 });
    expect(await ws.read("src/a.ts")).toEqual({ path: "src/a.ts", size: 20, text: "export const a = 1;\n" });
    // The ref of the file call is the branch.
    expect(fake.calls.find((c) => c.url.pathname.includes("/contents/"))!.url.searchParams.get("ref")).toBe(branch);
    expect(repo.fullName).toBe("alice/app");
  });

  it("reads the tree through the branch's commit and the commit's tree, never by the branch name", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "tree");
    const ws = await workspace(d, "alice", project.id, branch);
    fake.calls.length = 0;
    await ws.tree();

    const paths = fake.calls.filter((c) => c.url.hostname === "api.github.com" && !c.url.pathname.includes("/access_tokens")).map((c) => c.url.pathname + c.url.search);
    const head = fake.head(repo, branch)!;
    const treeSha = fake.treeOf(repo, branch);
    // The branch is resolved to a commit, the commit to its tree, the tree is read by its own sha.
    expect(paths).toContain(`/repos/alice/app/git/ref/heads/${branch}`);
    expect(paths.filter((p) => !p.includes("/collaborators/"))).toEqual([
      `/repos/alice/app/git/ref/heads/${branch}`,
      `/repos/alice/app/git/commits/${head}`,
      `/repos/alice/app/git/trees/${treeSha}?recursive=1`,
    ]);
    expect(paths.some((p) => p.includes("/git/trees/") && p.includes("tailzu"))).toBe(false);
    expect(treeSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("answers a branch that isn't there as not found, not as a crash", async () => {
    const { github, repo } = await withProject();
    const ref = { installationId: 101, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main" };
    await expect(github.tree(ref, "tailzu/never-0000")).rejects.toMatchObject({ code: "not_found" });
  });

  it("sees the branch's own files after a commit, not the default branch's", async () => {
    const { d, project } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "edit");
    const ws = await workspace(d, "alice", project.id, branch);
    await ws.commit([{ path: "src/a.ts", content: "export const a = 2;\n" }], "bump a");
    expect((await ws.read("src/a.ts")).text).toBe("export const a = 2;\n");
  });

  it("refuses a file over 1 MB, a file that isn't text, a folder, a missing file, and a bad path", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "read");
    fake.push(repo, branch, { "big.txt": "x".repeat(1024 * 1024 + 1), "ok.txt": "x".repeat(1024 * 1024), "blob.bin": "ab\u0000cd" });
    const ws = await workspace(d, "alice", project.id, branch);
    await expect(ws.read("big.txt")).rejects.toMatchObject({ code: "too_large" });
    expect((await ws.read("ok.txt")).size).toBe(1024 * 1024);
    await expect(ws.read("blob.bin")).rejects.toMatchObject({ code: "binary_file" });
    await expect(ws.read("src")).rejects.toMatchObject({ code: "not_a_file" });
    await expect(ws.read("nope.txt")).rejects.toMatchObject({ code: "not_found" });
    await expect(ws.read("../etc/passwd")).rejects.toMatchObject({ code: "bad_path" });
    await expect(ws.read("/etc/passwd")).rejects.toMatchObject({ code: "bad_path" });
  });
});

// ------------------------------------------------------------ committing

describe("committing", () => {
  it("makes one commit on the work branch and moves the branch to it, force: false", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch, baseSha } = await createWorkBranch(d, "alice", project.id, "add a file");
    const ws = await workspace(d, "alice", project.id, branch);
    fake.calls.length = 0;

    const r = await ws.commit([
      { path: "src/b.ts", content: "export const b = 1;\n" },
      { path: "README.md", content: "# app, changed\n" },
      { path: "src/a.ts", delete: true },
    ], "Add b, change the readme, drop a");

    expect(r.parentSha).toBe(baseSha);
    expect(fake.head(repo, branch)).toBe(r.sha);
    expect(fake.files(repo, branch)).toEqual({ "README.md": "# app, changed\n", "src/b.ts": "export const b = 1;\n" });
    // The default branch did not move.
    expect(fake.head(repo, "main")).toBe(baseSha);
    expect(fake.files(repo, "main")).toEqual({ "README.md": "# app\n", "src/a.ts": "export const a = 1;\n" });

    const writes = fake.writes().map((c) => `${c.method} ${c.url.pathname.replace("/repos/alice/app", "")}`);
    expect(writes).toEqual(["POST /git/trees", "POST /git/commits", `PATCH /git/refs/heads/${branch}`]);
    const [tree, commit, patch] = fake.writes();
    expect(tree!.body.tree).toEqual([
      { path: "src/b.ts", mode: "100644", type: "blob", content: "export const b = 1;\n" },
      { path: "README.md", mode: "100644", type: "blob", content: "# app, changed\n" },
      { path: "src/a.ts", mode: "100644", type: "blob", sha: null },
    ]);
    expect(commit!.body).toMatchObject({ message: "Add b, change the readme, drop a", parents: [baseSha] });
    expect(patch!.body).toEqual({ sha: r.sha, force: false });
  });

  it("answers branch_moved, and overwrites nothing, when the branch moved while it was committing", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "race");
    const ws = await workspace(d, "alice", project.id, branch);
    let theirs = "";
    fake.beforeRefUpdate = (r, b) => { fake.beforeRefUpdate = null; theirs = fake.push(r, b, { "theirs.txt": "kept" }, "pushed by someone else"); };
    await expect(ws.commit([{ path: "mine.txt", content: "mine" }], "mine")).rejects.toMatchObject({ code: "branch_moved" });
    expect(fake.head(repo, branch)).toBe(theirs);
    expect(fake.files(repo, branch)).toMatchObject({ "theirs.txt": "kept" });
    expect(fake.files(repo, branch)).not.toHaveProperty("mine.txt");
    // Read again, and it goes through.
    await ws.commit([{ path: "mine.txt", content: "mine" }], "mine, again");
    expect(fake.files(repo, branch)).toMatchObject({ "theirs.txt": "kept", "mine.txt": "mine" });
  });

  it("refuses the default branch, a branch outside tailzu/, .., and .github/workflows, without calling GitHub", async () => {
    const { github, fake, repo } = await withProject();
    const ref = { installationId: 101, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main" };
    const one = [{ path: "a.txt", content: "x" }];
    fake.calls.length = 0;
    for (const branch of ["main", "feature/x", "master", "tailzu/../main", "tailzu/a..b", "TAILZU/x", ""]) {
      await expect(github.commit(ref, branch, one, "m"), branch).rejects.toMatchObject({ code: "bad_branch" });
    }
    await expect(github.commit({ ...ref, defaultBranch: "tailzu/x-1234" }, "tailzu/x-1234", one, "m")).rejects.toMatchObject({ code: "bad_branch" });
    for (const path of ["../x", "a/../../b", "/abs", ".github/workflows/ci.yml", ".git/config", ""]) {
      await expect(github.commit(ref, "tailzu/ok-1234", [{ path, content: "x" }], "m"), path).rejects.toMatchObject({ code: "bad_path" });
    }
    // One bad path anywhere in the commit refuses the whole commit.
    await expect(github.commit(ref, "tailzu/ok-1234", [...one, { path: ".github/workflows/x.yml", content: "x" }], "m")).rejects.toMatchObject({ code: "bad_path" });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an empty commit, no message, the same path twice, too many files, and a file over 1 MB", async () => {
    const { d, project } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "checks");
    const ws = await workspace(d, "alice", project.id, branch);
    const f = (path: string, content = "x") => ({ path, content });
    await expect(ws.commit([], "m")).rejects.toMatchObject({ code: "bad_request" });
    await expect(ws.commit([f("a")], "  ")).rejects.toMatchObject({ code: "bad_request" });
    await expect(ws.commit([f("a")], undefined as unknown as string)).rejects.toMatchObject({ code: "bad_request" });
    await expect(ws.commit([f("a"), f("a")], "m")).rejects.toMatchObject({ code: "bad_path" });
    await expect(ws.commit(Array.from({ length: 201 }, (_, i) => f(`f${i}`)), "m")).rejects.toMatchObject({ code: "bad_request" });
    await expect(ws.commit([f("big", "x".repeat(1024 * 1024 + 1))], "m")).rejects.toMatchObject({ code: "too_large" });
    await expect(ws.commit([{ path: "a", content: 5 as unknown as string }], "m")).rejects.toMatchObject({ code: "bad_request" });
    expect((await ws.commit([f("big", "x".repeat(1024 * 1024))], "ok at the limit")).sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("can write no more than the token it holds: a token for another repo is turned down by GitHub", async () => {
    const { github, fake, repo } = await withProject();
    fake.addInstall(101, "alice");
    const other = fake.addRepo(101, "alice/other");
    // A ref that claims the other repo's id on this repo's name: the token minted is for `other`, and the repo is `app`.
    const confused = { installationId: 101, repoId: other.id, fullName: repo.fullName, defaultBranch: "main" };
    await expect(github.branchHead(confused, "main")).rejects.toMatchObject({ code: "not_found" });
  });
});

// ------------------------------------------------------------ draft PRs

describe("draft pull requests", () => {
  it("opens a draft PR from the work branch into the default branch and records it", async () => {
    const { d, project, fake, repo, store } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "ship it");
    const ws = await workspace(d, "alice", project.id, branch);
    await ws.commit([{ path: "x.txt", content: "x" }], "x");

    const pr = await ws.openDraftPr("Add x", "Does x.");
    expect(pr).toEqual({ prNumber: 1, prUrl: "https://github.com/alice/app/pull/1", existing: false });
    expect(fake.writes().at(-1)!.body).toEqual({ title: "Add x", head: branch, base: "main", body: "Does x.", draft: true });
    expect(fake.pulls(repo)).toMatchObject([{ head: branch, base: "main", draft: true }]);
    expect(await store.getBranch(project.id, branch)).toMatchObject({ prNumber: 1, prUrl: "https://github.com/alice/app/pull/1" });
  });

  it("returns the PR that is already open instead of failing", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "twice");
    const ws = await workspace(d, "alice", project.id, branch);
    await ws.commit([{ path: "x.txt", content: "x" }], "x");
    const first = await ws.openDraftPr("T", "B");
    const again = await ws.openDraftPr("T2", "B2");
    expect(again).toEqual({ prNumber: first.prNumber, prUrl: first.prUrl, existing: true });
    expect(fake.pulls(repo)).toHaveLength(1);
    // It looked the open one up by head, as owner:branch.
    const lookup = fake.calls.find((c) => c.method === "GET" && c.url.pathname === "/repos/alice/app/pulls")!;
    expect(lookup.url.searchParams.get("head")).toBe(`alice:${branch}`);
    expect(lookup.url.searchParams.get("state")).toBe("open");
  });

  it("says there is nothing to open yet when the branch has no commits of its own", async () => {
    const { d, project } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "empty");
    await expect(openPr(d, "alice", project.id, branch, "T", "B")).rejects.toMatchObject({ code: "nothing_to_review" });
  });

  it("only opens one from a branch Tailzu made in this person's project, with a title", async () => {
    const { d, github, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "pr");
    await expect(openPr(d, "bob", project.id, branch, "T", "B")).rejects.toMatchObject({ code: "not_found" });
    await expect(openPr(d, "alice", project.id, "tailzu/never-made-1234", "T", "B")).rejects.toMatchObject({ code: "not_found" });
    await expect(openPr(d, "alice", project.id, "main", "T", "B")).rejects.toMatchObject({ code: "not_found" });
    await expect(openPr(d, "alice", project.id, branch, "", "B")).rejects.toMatchObject({ code: "bad_request" });
    await expect(openPr(d, "alice", project.id, branch, undefined, "B")).rejects.toMatchObject({ code: "bad_request" });
    // And the GitHub call itself refuses the default branch as the head, whoever asks.
    const ref = { installationId: 101, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main" };
    fake.calls.length = 0;
    await expect(github.openDraftPr(ref, "main", "T", "B")).rejects.toMatchObject({ code: "bad_branch" });
    await expect(github.openDraftPr(ref, "feature/x", "T", "B")).rejects.toMatchObject({ code: "bad_branch" });
    expect(fake.calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------ the workspace

describe("the workspace", () => {
  it("is for the person's own project and a branch Tailzu recorded in it, nothing else", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "mine");
    // A branch that exists on GitHub but that Tailzu never recorded is not a work branch.
    fake.push(repo, "main", { "x": "y" });
    const { baseSha } = await createWorkBranch(d, "alice", project.id, "another");
    for (const [user, id, b] of [
      ["bob", project.id, branch], ["alice", "00000000-0000-4000-8000-000000000000", branch], ["alice", "not-a-uuid", branch],
      ["alice", project.id, "main"], ["alice", project.id, "tailzu/unrecorded-0000"], ["alice", project.id, ""],
    ] as const) {
      await expect(workspace(d, user, id, b), `${user} ${id} ${b}`).rejects.toMatchObject({ code: "not_found" });
    }
    const ws = await workspace(d, "alice", project.id, branch);
    expect(ws.branch).toBe(branch);
    expect(ws.project.fullName).toBe("alice/app");
    expect(baseSha).toBeDefined();
  });

  it("stops when GitHub has suspended the install", async () => {
    const { d, project, store } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "suspend me");
    await store.setSuspended(101, Date.now());
    await expect(workspace(d, "alice", project.id, branch)).rejects.toMatchObject({ code: "suspended" });
    await store.setSuspended(101, null);
    await expect(workspace(d, "alice", project.id, branch)).resolves.toBeDefined();
  });

  it("has a handle that can't be aimed at another branch", async () => {
    const { d, project, fake, repo } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "pinned");
    const ws = await workspace(d, "alice", project.id, branch);
    const main = fake.head(repo, "main");
    await ws.commit([{ path: "z.txt", content: "z" }], "z");
    expect(fake.head(repo, "main")).toBe(main);
    expect(Object.keys(ws).sort()).toEqual(["branch", "commit", "openDraftPr", "project", "read", "tree"]);
  });
});

// ------------------------------------------------------------ who may use a repo

describe("an install is not access to every repo in it", () => {
  /** Install 300 is the organisation acme's. Repos: api, docs, secret, tools. */
  async function org() {
    const r = rig();
    r.fake.addInstall(300, "acme", { type: "Organization", selection: "all" });
    const api = r.fake.addRepo(300, "acme/api", { files: { "README.md": "# api\n" } });
    const docs = r.fake.addRepo(300, "acme/docs");
    const secret = r.fake.addRepo(300, "acme/secret");
    const tools = r.fake.addRepo(300, "acme/tools");
    const link = (user: string, login: string | null) =>
      r.store.upsertInstallation(user, { installationId: 300, accountLogin: "acme", accountType: "Organization", repositorySelection: "all", ...asLinked(login) });
    return { ...r, api, docs, secret, tools, link };
  }
  const ids = (l: { repos: Array<{ id: number }> }) => l.repos.map((x) => x.id).sort((a, b) => a - b);

  it("shows an organisation member only the repos GitHub says they can write to, and not the ones they can only read", async () => {
    const { d, fake, link, api, docs, secret, tools } = await org();
    await link("alice", "alice");
    fake.setPermission(api, "alice", "write");
    fake.setPermission(docs, "alice", "read");
    fake.setPermission(secret, "alice", "none");
    fake.setPermission(tools, "alice", "admin");
    expect(ids(await listRepos(d, "alice"))).toEqual([api.id, tools.id].sort((a, b) => a - b));
    // It asked about each repo, for that login, with the install's token: nothing is taken from the install itself.
    const asked = fake.permissionCalls().map((c) => c.url.pathname).sort();
    expect(asked).toEqual(["api", "docs", "secret", "tools"].map((n) => `/repos/acme/${n}/collaborators/alice/permission`));
    expect(fake.permissionCalls().every((c) => /^Bearer ghs_/.test(c.headers.authorization!))).toBe(true);
  });

  it("gives a member with only read access nothing, and won't make a project of the repo", async () => {
    const { d, fake, link, api, docs, store } = await org();
    await link("bob", "bob");
    fake.setPermission(api, "bob", "read");
    fake.setPermission(docs, "bob", "read");
    expect(await listRepos(d, "bob")).toEqual({ repos: [], truncated: false });
    await expect(addProject(d, "bob", api.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(addProject(d, "bob", docs.id)).rejects.toMatchObject({ code: "not_found" });
    // GitHub having never heard of them there (404) is the same as none.
    fake.setPermission(api, "bob", null);
    await expect(addProject(d, "bob", api.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await store.listProjects("bob")).toEqual([]);
  });

  it("lets a member who can write make a project of the repo, and not of the one next to it", async () => {
    const { d, fake, link, api, docs } = await org();
    await link("alice", "alice");
    fake.setPermission(api, "alice", "write");
    fake.setPermission(docs, "alice", "read");
    expect((await addProject(d, "alice", api.id)).created).toBe(true);
    await expect(addProject(d, "alice", docs.id)).rejects.toMatchObject({ code: "not_found" });
    // The same login on the same repo is another person's business: carol linked the install too and can write nowhere.
    await link("carol", "carol");
    expect(await listRepos(d, "carol")).toEqual({ repos: [], truncated: false });
    await expect(addProject(d, "carol", api.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("filters a collaborator on another person's personal install, and shows the owner all of it", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(400, "carol"); // Carol's personal account
    const open = fake.addRepo(400, "carol/open");
    const hidden = fake.addRepo(400, "carol/hidden");
    const shared = fake.addRepo(400, "carol/shared");
    const mine = fake.addRepo(400, "carol/mine");
    for (const user of ["carol", "alice"]) {
      await store.upsertInstallation(user, { installationId: 400, accountLogin: "carol", accountType: "User", repositorySelection: "all", ...asLinked(user) });
    }
    fake.setPermission(open, "alice", "read"); // a public repo anyone may read
    fake.setPermission(hidden, "alice", "none");
    fake.setPermission(shared, "alice", "write"); // invited to this one with write
    // Alice, invited on one repo: the install is listed for her by GitHub, but only that repo is hers.
    expect(ids(await listRepos(d, "alice"))).toEqual([shared.id]);
    await expect(addProject(d, "alice", hidden.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(addProject(d, "alice", open.id)).rejects.toMatchObject({ code: "not_found" });
    // Carol, whose account it is: everything, with no question asked of GitHub about her.
    fake.calls.length = 0;
    expect(ids(await listRepos(d, "carol"))).toEqual([open.id, hidden.id, shared.id, mine.id].sort((a, b) => a - b));
    expect(fake.permissionCalls()).toHaveLength(0);
  });

  it("takes the owner of a personal account to be them whatever the case of the login", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "Alice");
    const one = fake.addRepo(101, "Alice/one");
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "Alice", accountType: "User", repositorySelection: "all", ...asLinked("alice") });
    expect(ids(await listRepos(d, "alice"))).toEqual([one.id]);
    expect(fake.permissionCalls()).toHaveLength(0);
  });

  it("never takes an organisation to be the person's own, even one called by their login", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice", { type: "Organization" }); // an organisation that happens to be called alice
    const one = fake.addRepo(101, "alice/one");
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "Organization", repositorySelection: "all", ...asLinked("alice") });
    expect(await listRepos(d, "alice")).toEqual({ repos: [], truncated: false });
    expect(fake.permissionCalls()).toHaveLength(1);
    fake.setPermission(one, "alice", "write");
    expect(ids(await listRepos(d, "alice"))).toEqual([]); // still kept: "none", for ten minutes
    fake.clock.t += 11 * MIN;
    expect(ids(await listRepos(d, "alice"))).toEqual([one.id]);
  });

  it("keeps each answer for ten minutes per install, repo and login, and asks again after", async () => {
    const { d, fake, link, api, docs } = await org();
    await link("alice", "alice");
    await link("bob", "bob");
    fake.setPermission(api, "alice", "write");
    fake.setPermission(api, "bob", "write");
    await listRepos(d, "alice");
    await listRepos(d, "alice");
    expect(fake.permissionCalls()).toHaveLength(4); // four repos, once each
    await listRepos(d, "bob"); // another login is another answer
    expect(fake.permissionCalls()).toHaveLength(8);
    fake.clock.t += 9 * MIN;
    await listRepos(d, "alice");
    expect(fake.permissionCalls()).toHaveLength(8);
    fake.clock.t += 2 * MIN;
    fake.setPermission(api, "alice", "read");
    expect(ids(await listRepos(d, "alice"))).toEqual([]);
    expect(fake.permissionCalls()).toHaveLength(12);
    expect(docs.id).toBeGreaterThan(0);
  });

  it("asks GitHub about at most eight repos at a time when listing", async () => {
    const { d, fake, link } = await org();
    const repos = Array.from({ length: 40 }, (_, i) => fake.addRepo(300, `acme/r${i}`, { files: { a: "a" } }));
    for (const r of repos) fake.setPermission(r, "alice", "write");
    await link("alice", "alice");
    fake.permissionDelayMs = 3;
    const listed = await listRepos(d, "alice");
    expect(listed.repos.length).toBe(40); // the four of the organisation's own were asked about too, and left out
    expect(fake.permissionCalls().length).toBe(44);
    expect(fake.permissionMaxInflight).toBeGreaterThan(1); // they do overlap...
    expect(fake.permissionMaxInflight).toBeLessThanOrEqual(8); // ...but not past eight
  });

  it("makes a link from before the login was kept ask the person to connect again, and asks GitHub nothing for it", async () => {
    const { d, fake, link, api, store } = await org();
    await link("alice", null);
    // Even an install that is the person's own can't be told apart without the login.
    fake.addInstall(101, "alice");
    fake.addRepo(101, "alice/own");
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "all" });
    fake.calls.length = 0;
    expect(await listRepos(d, "alice")).toEqual({ repos: [], truncated: false, needsReconnect: [300, 101] });
    expect(fake.calls).toHaveLength(0);
    await expect(addProject(d, "alice", api.id)).rejects.toMatchObject({ code: "needs_reconnect" });
    expect((await linkStatus(d, "alice")).installations.map((i) => (i as { needsReconnect?: boolean }).needsReconnect)).toEqual([true, true]);
  });

  it("keeps a project made before the login was kept from being used until the person connects again, and then it works", async () => {
    const { d, fake, store, repo, project } = await withProject();
    const { branch } = await createWorkBranch(d, "alice", project.id, "before");
    // The link as an older build wrote it.
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: null, githubLogin: null });
    await expect(createWorkBranch(d, "alice", project.id, "after")).rejects.toMatchObject({ code: "needs_reconnect" });
    await expect(workspace(d, "alice", project.id, branch)).rejects.toMatchObject({ code: "needs_reconnect" });
    await expect(openPr(d, "alice", project.id, branch, "T", "B")).rejects.toMatchObject({ code: "needs_reconnect" });
    await expect(addProject(d, "alice", repo.id)).rejects.toMatchObject({ code: "needs_reconnect" });
    // Connecting again reads the login (and the id) and everything works.
    fake.addPerson("code-2", "gho_alice2", [101], "alice");
    const state = await signState("alice", CODE_STATE_ID, fake.clock.t);
    await completeCallback(d, { code: "code-2", installationId: "101", setupAction: "install", state }, fake.clock.t);
    expect(await store.getInstallation("alice", 101)).toMatchObject({ githubLogin: "alice", githubUserId: expect.any(Number) });
    await expect(createWorkBranch(d, "alice", project.id, "after")).resolves.toMatchObject({ branch: expect.stringMatching(/^tailzu\/after-/) });
  });

  it("links nothing when GitHub won't say who the person is", async () => {
    const { d, fake, store } = rig();
    fake.addInstall(101, "alice");
    fake.addPerson("code-1", "gho_alice", [101]);
    fake.profiles.delete("gho_alice");
    const state = await signState("alice", CODE_STATE_ID, fake.clock.t);
    await expect(completeCallback(d, { code: "code-1", installationId: "101", state }, fake.clock.t)).rejects.toMatchObject({ code: "github_auth" });
    expect(await store.listInstallations("alice")).toEqual([]);
  });

  it("stops a person whose access was taken away since they added the project: a branch, a commit and a pull request at once", async () => {
    const { d, fake, link, api, store } = await org();
    await link("alice", "alice");
    fake.setPermission(api, "alice", "write");
    const { project } = await addProject(d, "alice", api.id);
    const { branch } = await createWorkBranch(d, "alice", project.id, "before it is taken away");
    const ws = await workspace(d, "alice", project.id, branch);
    await ws.commit([{ path: "a.txt", content: "a" }], "while they could");
    const head = fake.head(api, branch);
    const writesBefore = fake.writes().length;

    // Taken away on GitHub. No time passes: a write asks again, and is turned down.
    fake.setPermission(api, "alice", "read");
    await expect(createWorkBranch(d, "alice", project.id, "too late")).rejects.toMatchObject({ code: "no_access" });
    await expect(ws.commit([{ path: "b.txt", content: "b" }], "too late")).rejects.toMatchObject({ code: "no_access" });
    await expect(ws.openDraftPr("T", "B")).rejects.toMatchObject({ code: "no_access" });
    await expect(openPr(d, "alice", project.id, branch, "T", "B")).rejects.toMatchObject({ code: "no_access" });
    expect(fake.writes().length).toBe(writesBefore); // nothing written
    expect(fake.head(api, branch)).toBe(head);
    expect(fake.pulls(api)).toEqual([]);
    expect((await store.listBranches(project.id)).length).toBe(1); // no branch recorded either

    // What the write found out is kept, so the reads and the list now know it too.
    await expect(ws.read("a.txt")).rejects.toMatchObject({ code: "no_access" });
    await expect(ws.tree()).rejects.toMatchObject({ code: "no_access" });
    await expect(workspace(d, "alice", project.id, branch)).rejects.toMatchObject({ code: "no_access" });
    expect(ids(await listRepos(d, "alice"))).toEqual([]);

    // And when it is given back, it works again.
    fake.setPermission(api, "alice", "write");
    await expect(createWorkBranch(d, "alice", project.id, "welcome back")).resolves.toBeDefined();
  });

  it("lets a workspace's reads go by what was kept for ten minutes, then turns them down", async () => {
    const { d, fake, link, api } = await org();
    await link("alice", "alice");
    fake.setPermission(api, "alice", "write");
    const { project } = await addProject(d, "alice", api.id);
    const { branch } = await createWorkBranch(d, "alice", project.id, "reads");
    const ws = await workspace(d, "alice", project.id, branch);

    fake.setPermission(api, "alice", "none");
    fake.clock.t += 5 * MIN;
    expect((await ws.read("README.md")).text).toBe("# api\n"); // inside the ten minutes
    fake.clock.t += 6 * MIN;
    await expect(ws.read("README.md")).rejects.toMatchObject({ code: "no_access" });
    await expect(ws.tree()).rejects.toMatchObject({ code: "no_access" });
  });

  it("stops the same way when GitHub no longer knows the person in the repo (404)", async () => {
    const { d, fake, link, api } = await org();
    await link("alice", "alice");
    fake.setPermission(api, "alice", "admin");
    const { project } = await addProject(d, "alice", api.id);
    fake.setPermission(api, "alice", null);
    await expect(createWorkBranch(d, "alice", project.id, "x")).rejects.toMatchObject({ code: "no_access" });
  });

  it("treats a GitHub that is failing as 'none' for a write, but does not remember it", async () => {
    const { d, fake, link, api } = await org();
    await link("alice", "alice");
    fake.setPermission(api, "alice", "write");
    const { project } = await addProject(d, "alice", api.id);
    fake.failWith = { prefix: "/repos/acme/api/collaborators", status: 500 };
    await expect(createWorkBranch(d, "alice", project.id, "x")).rejects.toMatchObject({ code: "no_access" });
    fake.failWith = null;
    await expect(createWorkBranch(d, "alice", project.id, "x")).resolves.toBeDefined();
    // Listing during the outage leaves the repo out for that listing only.
    fake.clock.t += 11 * MIN;
    fake.failWith = { prefix: "/repos/acme/api/collaborators", status: 500 };
    expect(ids(await listRepos(d, "alice"))).toEqual([]);
    fake.failWith = null;
    expect(ids(await listRepos(d, "alice"))).toEqual([api.id]);
  });

  it("asks only about logins GitHub could have", async () => {
    const { github, fake } = rig();
    fake.addInstall(101, "acme", { type: "Organization" });
    const r = fake.addRepo(101, "acme/x");
    for (const bad of ["", "a/b", "../x", "a b", "-lead", "x".repeat(40), "a\u0000"]) {
      expect(await github.permissionOf({ installationId: 101, repoId: r.id, fullName: r.fullName }, bad), JSON.stringify(bad)).toBe("none");
    }
    expect(fake.permissionCalls()).toHaveLength(0);
  });
});

// ------------------------------------------------------------ the webhook

describe("the webhook", () => {
  const SECRET = "whsec_" + "x".repeat(32);
  const body = JSON.stringify({ action: "deleted", installation: { id: 101 } });

  it("accepts only sha256= and the hex HMAC-SHA256 of the body", () => {
    const good = signatureFor(body, SECRET);
    expect(good).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signatureOk(body, good, SECRET)).toBe(true);
    expect(signatureOk(body + " ", good, SECRET)).toBe(false); // the body is signed as sent
    expect(signatureOk(body, good, SECRET + "x")).toBe(false);
    expect(signatureOk(body, good.toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(false);
    for (const bad of ["", "sha256=", "sha256=00", good.slice(7), "sha1=" + good.slice(7), good + "0", " " + good]) {
      expect(signatureOk(body, bad, SECRET), bad).toBe(false);
    }
    expect(signatureOk(body, good, "")).toBe(false); // no secret set: nothing passes
    expect(signatureOk("", signatureFor("", ""), "")).toBe(false);
  });

  async function seeded() {
    const store = new MemoryCodeStore();
    for (const user of ["alice", "bob"]) {
      await store.upsertInstallation(user, { installationId: 101, accountLogin: "acme", accountType: "Organization", repositorySelection: "selected" });
      await store.createProject(user, { installationId: 101, repoId: 1, fullName: "acme/one", defaultBranch: "main", private: true });
      await store.createProject(user, { installationId: 101, repoId: 2, fullName: "acme/two", defaultBranch: "main", private: true });
    }
    await store.upsertInstallation("alice", { installationId: 202, accountLogin: "alice", accountType: "User", repositorySelection: "all" });
    const keep = await store.createProject("alice", { installationId: 202, repoId: 3, fullName: "alice/three", defaultBranch: "main", private: false });
    await store.addBranch({ projectId: keep.id, branch: "tailzu/keep-0000", task: "t", baseSha: "a".repeat(40) });
    return { store, keep };
  }

  it("deleted: drops everyone's links to that install and their projects on it, and nothing else", async () => {
    const { store, keep } = await seeded();
    const aliceOne = (await store.findProjectByRepo("alice", 1))!;
    await store.addBranch({ projectId: aliceOne.id, branch: "tailzu/gone-0000", task: "t", baseSha: "b".repeat(40) });
    expect(await handleWebhook(store, "installation", { action: "deleted", installation: { id: 101 } })).toBe("handled");
    for (const user of ["alice", "bob"]) {
      expect(await store.getInstallation(user, 101)).toBeNull();
      expect(await store.listProjects(user).then((p) => p.filter((x) => x.installationId === 101))).toEqual([]);
    }
    expect(await store.getBranch(aliceOne.id, "tailzu/gone-0000")).toBeNull();
    expect(await store.getInstallation("alice", 202)).not.toBeNull();
    expect(await store.getProject("alice", keep.id)).not.toBeNull();
    expect(await store.getBranch(keep.id, "tailzu/keep-0000")).not.toBeNull();
    // Again, as GitHub does when it retries: nothing more to do, no failure.
    expect(await handleWebhook(store, "installation", { action: "deleted", installation: { id: 101 } })).toBe("handled");
  });

  it("suspend and unsuspend: mark and clear the install for everyone who linked it", async () => {
    const { store } = await seeded();
    await handleWebhook(store, "installation", { action: "suspend", installation: { id: 101 } }, 1234);
    expect((await store.getInstallation("alice", 101))!.suspendedAt).toBe(1234);
    expect((await store.getInstallation("bob", 101))!.suspendedAt).toBe(1234);
    expect((await store.getInstallation("alice", 202))!.suspendedAt).toBeNull();
    expect(await store.listProjects("alice")).toHaveLength(3); // nothing dropped
    await handleWebhook(store, "installation", { action: "unsuspend", installation: { id: 101 } });
    expect((await store.getInstallation("alice", 101))!.suspendedAt).toBeNull();
    expect((await store.getInstallation("bob", 101))!.suspendedAt).toBeNull();
  });

  it("repositories removed: drops the projects on those repos, for everyone, and keeps the link and the other repos", async () => {
    const { store } = await seeded();
    expect(await handleWebhook(store, "installation_repositories", {
      action: "removed", installation: { id: 101 }, repositories_removed: [{ id: 2, name: "two" }, { id: 3 }], repositories_added: [],
    })).toBe("handled");
    for (const user of ["alice", "bob"]) {
      expect(await store.findProjectByRepo(user, 2)).toBeNull();
      expect(await store.findProjectByRepo(user, 1)).not.toBeNull();
      expect(await store.getInstallation(user, 101)).not.toBeNull();
    }
    // Repo 3 is on another install: the event named install 101, so it is left.
    expect(await store.findProjectByRepo("alice", 3)).not.toBeNull();
  });

  it("ignores everything else, and malformed payloads", async () => {
    const { store } = await seeded();
    const cases: Array<[string, unknown]> = [
      ["installation", { action: "created", installation: { id: 101 } }],
      ["installation", { action: "new_permissions_accepted", installation: { id: 101 } }],
      ["installation_repositories", { action: "added", installation: { id: 101 }, repositories_added: [{ id: 9 }] }],
      ["ping", { zen: "Keep it logically awesome.", hook_id: 1 }],
      ["push", { ref: "refs/heads/main", installation: { id: 101 } }],
      ["pull_request", { action: "closed" }],
      ["installation", null], ["installation", "x"], ["installation", {}], ["installation", { action: "deleted" }],
      ["installation", { action: "deleted", installation: { id: "101" } }], ["installation", { action: "deleted", installation: { id: -1 } }],
      ["installation_repositories", { action: "removed", installation: { id: 101 }, repositories_removed: "x" }],
    ];
    for (const [event, payload] of cases) {
      const r = await handleWebhook(store, event, payload);
      expect(r === "ignored" || (event === "installation_repositories" && r === "handled"), `${event} ${JSON.stringify(payload)}`).toBe(true);
    }
    expect(await store.listProjects("alice")).toHaveLength(3);
    expect(await store.listProjects("bob")).toHaveLength(2);
    expect(await store.getInstallation("alice", 101)).not.toBeNull();
  });
});

/**
 * "Sign in with GitHub" for the Code bot, against a fake GitHub
 * (tests/github-fake.ts): the second way to connect, a classic OAuth App whose
 * token reaches all of a person's repos, and the limits Tailzu puts on it.
 *
 * What is held here: the sign-in itself (scopes asked, scopes checked, PKCE,
 * the token stored encrypted), the allow-list (only repos added as projects),
 * the push re-check before every write, the commit trailer, runners never
 * getting the token, revoking (disconnect, account delete, 30 days unused, a
 * dead token, the kill switch), the App winning when it reaches the same repo,
 * and every guard of the git logic holding for a sign-in project as for an
 * App one. Nothing reaches the network.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { appKeys, FakeGithub } = await import("./github-fake.js");
const { GithubApp, assertRepoPath, TAILZU_WORKFLOW } = await import("../src/code/github.js");
const { MemoryCodeStore } = await import("../src/code/store.js");
const { ApprovalBook } = await import("../src/code/approvals.js");
const { COMMIT_TRAILER, OAuthAccess } = await import("../src/code/access.js");
const {
  GithubOAuth, IDLE_REVOKE_MS, OAUTH_AUTHORIZE_URL, OAUTH_STATE_ID, OAUTH_STATE_ID_WORKFLOW, startOAuthSweeper,
} = await import("../src/code/oauth.js");
const { addProject, createWorkBranch, listRepos, openPr, runnerAccess, initEmptyRepo, workspace } = await import("../src/code/projects.js");
const { closePr, confirmMerge, deleteWorkBranch, markReady, requestMerge, syncBranch } = await import("../src/code/pulls.js");
const { verifyState } = await import("../src/connectors/oauth.js");
const { decrypt } = await import("../src/connectors/crypto.js");

type Fake = InstanceType<typeof FakeGithub>;
let KEYS: ReturnType<typeof appKeys>;
beforeAll(() => { KEYS = appKeys(); });

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** A fake GitHub, a store on its clock, the git client, and the sign-in. */
function rig(o: { enabled?: boolean } = {}) {
  const fake: Fake = new FakeGithub(KEYS);
  const now = () => fake.clock.t;
  const store = new MemoryCodeStore(now);
  const github = new GithubApp(
    { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem },
    { fetchFn: fake.fetchFn, now },
  );
  const approvals = new ApprovalBook({ now });
  const oauth = new GithubOAuth({
    config: { clientId: fake.oauthClientId, clientSecret: fake.oauthClientSecret }, store, github, enabled: o.enabled ?? true, fetchFn: fake.fetchFn, now,
  });
  return { fake, store, github, approvals, oauth, d: { store, github, approvals, oauth } };
}
type Rig = ReturnType<typeof rig>;

/** The person signs in with GitHub. Returns their token (the one the code is traded for). */
async function signIn(r: Rig, user: string, o: { login?: string; scopes?: string[]; workflow?: boolean } = {}): Promise<string> {
  const { authorizeUrl } = o.workflow ? await r.oauth.beginWorkflow(user) : await r.oauth.begin(user);
  const url = new URL(authorizeUrl);
  const token = `gho_${user}_token`;
  r.fake.addOAuthPerson(`code-${user}`, token, o.login ?? user, { scopes: o.scopes, challenge: url.searchParams.get("code_challenge") ?? undefined });
  await r.oauth.complete(`code-${user}`, url.searchParams.get("state")!);
  return token;
}

/** A person who has signed in, and a repo of theirs added as a project. */
async function oauthProject(r: Rig, user = "alice", name = `${user}/app`, files?: Record<string, string>) {
  const token = await signIn(r, user);
  const repo = r.fake.addRepo(900, name, { files: files ?? { "README.md": "# app\n", "src/a.ts": "export const a = 1;\n" } });
  const { project } = await addProject(r.d, user, repo.id);
  return { token, repo, project };
}

/** The same through a GitHub App install. */
async function appProject(r: Rig, user = "alice") {
  r.fake.addInstall(101, user);
  const repo = r.fake.addRepo(101, `${user}/app`, { files: { "README.md": "# app\n", "src/a.ts": "export const a = 1;\n" } });
  await r.store.upsertInstallation(user, { installationId: 101, accountLogin: user, accountType: "User", repositorySelection: "selected", githubUserId: 1, githubLogin: user });
  const { project } = await addProject(r.d, user, repo.id);
  return { repo, project };
}

const refOf = (r: Rig, user: string, repo: { id: number; fullName: string }, project?: { installationId: number }) => ({
  installationId: project?.installationId ?? 0, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main", access: r.oauth.access(user),
});

// ------------------------------------------------------------ signing in

describe("signing in with GitHub", () => {
  it("sends the person to GitHub's authorize page asking for 'repo read:user' and nothing more, with a signed state and PKCE", async () => {
    const r = rig();
    const { authorizeUrl } = await r.oauth.begin("alice");
    const u = new URL(authorizeUrl);
    expect(`${u.origin}${u.pathname}`).toBe(OAUTH_AUTHORIZE_URL);
    expect(u.searchParams.get("client_id")).toBe(r.fake.oauthClientId);
    expect(u.searchParams.get("scope")).toBe("repo read:user");
    expect(u.searchParams.get("scope")).not.toMatch(/workflow/);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyState(u.searchParams.get("state")!, r.fake.clock.t)).toMatchObject({ userId: "alice", connectorId: "code-github-oauth" });
    expect(OAUTH_STATE_ID).toBe("code-github-oauth");
    // The client secret and the verifier are not in the address.
    expect(authorizeUrl).not.toContain(r.fake.oauthClientSecret);
  });

  it("has an incremental sign-in that adds 'workflow', for later, under a state of its own", async () => {
    const r = rig();
    const u = new URL((await r.oauth.beginWorkflow("alice")).authorizeUrl);
    expect(u.searchParams.get("scope")).toBe("repo read:user workflow");
    expect(await verifyState(u.searchParams.get("state")!, r.fake.clock.t)).toMatchObject({ connectorId: OAUTH_STATE_ID_WORKFLOW });
  });

  it("trades the code (with the PKCE verifier), reads who the person is, and keeps the token encrypted", async () => {
    const r = rig();
    const token = await signIn(r, "alice", { login: "alice-on-github" });
    const link = (await r.store.getOAuthLink("alice"))!;
    expect(link).toMatchObject({ userId: "alice", githubLogin: "alice-on-github", scope: "repo, read:user", status: "active", lastUsedAt: null });
    expect(link.githubUserId).toBe(r.fake.oauthTokens.get(token)!.id);
    // Encrypted at rest under the connector key: opens to the token, and the token is not in the row.
    expect(link.tokenEnc).toMatch(/^v1\./);
    expect(decrypt(link.tokenEnc!)).toBe(token);
    expect(JSON.stringify(link)).not.toContain(token);
    // The exchange carried the client id and secret, the code and a verifier; GitHub checked the verifier against the challenge.
    const ex = r.fake.calls.find((c) => c.url.pathname === "/login/oauth/access_token")!;
    expect(ex.body).toMatchObject({ client_id: r.fake.oauthClientId, client_secret: r.fake.oauthClientSecret, code: "code-alice" });
    expect(ex.body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ex.headers.accept).toBe("application/json");
    // And the token was used for /user, which is where the scopes are read from.
    expect(r.fake.calls.find((c) => c.url.pathname === "/user")!.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("refuses a state that is used up, never started, for another purpose, expired or not one", async () => {
    const r = rig();
    const state = (await r.oauth.begin("alice")).authorizeUrl.split("state=")[1]!.split("&")[0]!;
    const decoded = decodeURIComponent(state);
    r.fake.addOAuthPerson("c1", "gho_t1", "alice");
    await r.oauth.complete("c1", decoded);
    // Single use.
    r.fake.addOAuthPerson("c2", "gho_t2", "alice");
    await expect(r.oauth.complete("c2", decoded)).rejects.toMatchObject({ code: "bad_state" });
    // Never started (a verifier this server doesn't hold, e.g. after a restart).
    const { signState } = await import("../src/connectors/oauth.js");
    const orphan = await signState("alice", OAUTH_STATE_ID, r.fake.clock.t);
    await expect(r.oauth.complete("c2", orphan)).rejects.toMatchObject({ code: "bad_state" });
    // The App's own sign-in state is not this one.
    const appState = await signState("alice", "code-github", r.fake.clock.t);
    await expect(r.oauth.complete("c2", appState)).rejects.toMatchObject({ code: "bad_state" });
    // Expired.
    const old = (await r.oauth.begin("alice")).authorizeUrl.split("state=")[1]!.split("&")[0]!;
    r.fake.clock.t += 11 * MIN;
    await expect(r.oauth.complete("c2", decodeURIComponent(old))).rejects.toMatchObject({ code: "bad_state" });
    await expect(r.oauth.complete("c2", "garbage")).rejects.toMatchObject({ code: "bad_state" });
    // Nothing of that was traded: the grant is still there.
    expect(r.fake.oauthTokens.has("gho_t2")).toBe(false);
  });

  it("stores nothing when GitHub won't accept the code", async () => {
    const r = rig();
    const { authorizeUrl } = await r.oauth.begin("alice");
    await expect(r.oauth.complete("never-issued", new URL(authorizeUrl).searchParams.get("state")!)).rejects.toMatchObject({ code: "bad_state" });
    expect(await r.store.getOAuthLink("alice")).toBeNull();
  });

  it("refuses a token with scopes beyond what was asked, REVOKES it, and connects nothing", async () => {
    for (const extra of [["delete_repo"], ["admin:org"], ["user"], ["gist"]]) {
      const r = rig();
      const { authorizeUrl } = await r.oauth.begin("alice");
      const u = new URL(authorizeUrl);
      r.fake.addOAuthPerson("c1", "gho_broad", "alice", { scopes: ["repo", "read:user", ...extra] });
      await expect(r.oauth.complete("c1", u.searchParams.get("state")!), extra.join()).rejects.toMatchObject({ code: "scope_too_broad" });
      expect(r.fake.revoked, extra.join()).toEqual(["gho_broad"]);
      expect(r.fake.oauthTokens.size).toBe(0); // nothing left alive at GitHub
      expect(await r.store.getOAuthLink("alice")).toBeNull();
      // The revoke was made as the OAuth App, with its id and secret.
      const del = r.fake.calls.find((c) => c.method === "DELETE")!;
      expect(del.url.pathname).toBe(`/applications/${r.fake.oauthClientId}/token`);
      expect(del.headers.authorization).toBe(`Basic ${Buffer.from(`${r.fake.oauthClientId}:${r.fake.oauthClientSecret}`).toString("base64")}`);
      expect(del.body).toEqual({ access_token: "gho_broad" });
    }
  });

  it("also refuses a token that lacks 'repo' (nothing to work with), revoking it", async () => {
    const r = rig();
    const u = new URL((await r.oauth.begin("alice")).authorizeUrl);
    r.fake.addOAuthPerson("c1", "gho_narrow", "alice", { scopes: ["read:user"] });
    await expect(r.oauth.complete("c1", u.searchParams.get("state")!)).rejects.toMatchObject({ code: "scope_missing" });
    expect(r.fake.revoked).toEqual(["gho_narrow"]);
    expect(await r.store.getOAuthLink("alice")).toBeNull();
  });

  it("allows the scopes 'repo' brings with it, and 'workflow' only when the incremental sign-in asked for it", async () => {
    const r = rig();
    await signIn(r, "alice", { scopes: ["repo", "repo:status", "public_repo", "read:user"] });
    expect(await r.oauth.hasScope("alice", "workflow")).toBe(false);
    const w = rig();
    await signIn(w, "alice", { workflow: true, scopes: ["repo", "read:user", "workflow"] });
    expect(await w.oauth.hasScope("alice", "workflow")).toBe(true);
    expect((await w.store.getOAuthLink("alice"))!.scope).toBe("repo, read:user, workflow");
    // A plain sign-in that gets back an earlier grant of our own workflow scope is not a lockout.
    const plain = rig();
    await signIn(plain, "alice", { scopes: ["repo", "read:user", "workflow"] });
    expect(await plain.oauth.hasScope("alice", "workflow")).toBe(true);
  });

  it("replaces an earlier token on signing in again, and revokes the old one", async () => {
    const r = rig();
    const first = await signIn(r, "alice");
    const u = new URL((await r.oauth.begin("alice")).authorizeUrl);
    r.fake.addOAuthPerson("c-again", "gho_second", "alice");
    await r.oauth.complete("c-again", u.searchParams.get("state")!);
    expect(r.fake.revoked).toEqual([first]);
    expect(decrypt((await r.store.getOAuthLink("alice"))!.tokenEnc!)).toBe("gho_second");
  });

  it("is off with the switch: nothing starts or finishes", async () => {
    const r = rig({ enabled: false });
    await expect(r.oauth.begin("alice")).rejects.toMatchObject({ code: "oauth_off" });
    await expect(r.oauth.complete("c", "s")).rejects.toMatchObject({ code: "oauth_off" });
  });
});

// ------------------------------------------------------------ the repos to choose from

describe("the repos a sign-in can offer", () => {
  it("lists only the repos the person can PUSH to, not archived ones, from GET /user/repos", async () => {
    const r = rig();
    await signIn(r, "alice");
    const mine = r.fake.addRepo(900, "alice/mine");
    r.fake.addRepo(900, "alice/old", { archived: true });
    const writable = r.fake.addRepo(901, "acme/api");
    const readonly = r.fake.addRepo(901, "acme/docs");
    r.fake.addRepo(901, "acme/secret"); // no access at all
    r.fake.setPermission(writable, "alice", "write");
    r.fake.setPermission(readonly, "alice", "read");
    const listed = await listRepos(r.d, "alice");
    expect(listed.repos.map((x) => x.fullName).sort()).toEqual(["acme/api", "alice/mine"]);
    expect(listed.repos.find((x) => x.id === mine.id)).toEqual({ id: mine.id, fullName: "alice/mine", private: true, defaultBranch: "main", installationId: 0, source: "oauth" });
    const call = r.fake.calls.find((c) => c.url.pathname === "/user/repos")!;
    expect(call.url.search).toBe("?affiliation=owner,collaborator,organization_member&per_page=100");
    expect(call.headers.authorization).toBe("Bearer gho_alice_token");
    expect(listed.truncated).toBe(false);
  });

  it("stops at 300 and says so", async () => {
    const r = rig();
    await signIn(r, "alice");
    for (let i = 0; i < 350; i += 1) r.fake.addRepo(900, `alice/r${i}`, { id: 20000 + i, files: { a: "a" } });
    const listed = await listRepos(r.d, "alice");
    expect(listed.repos).toHaveLength(300);
    expect(listed.truncated).toBe(true);
  });

  it("offers nothing without a sign-in, with the switch off, or after the token died, and says to sign in again", async () => {
    const r = rig();
    r.fake.addRepo(900, "alice/mine");
    expect(await listRepos(r.d, "alice")).toEqual({ repos: [], truncated: false });
    expect(r.fake.calls).toHaveLength(0);
    const token = await signIn(r, "alice");
    r.fake.calls.length = 0;
    expect((await listRepos(r.d, "alice")).repos).toHaveLength(1);
    r.fake.killOAuthToken(token);
    expect(await listRepos(r.d, "alice")).toEqual({ repos: [], truncated: false, needsSignin: true });
    const off = rig({ enabled: false });
    expect(await listRepos(off.d, "alice")).toEqual({ repos: [], truncated: false });
    expect(off.fake.calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------ the allow-list

describe("the allow-list: only repos added as projects", () => {
  it("makes a repo a project with the sign-in as its link, and records which link it uses", async () => {
    const r = rig();
    const { project, repo } = await oauthProject(r);
    expect(project).toMatchObject({ userId: "alice", repoId: repo.id, fullName: "alice/app", linkKind: "oauth", installationId: 0 });
    // Adding it twice is the same project.
    expect(await addProject(r.d, "alice", repo.id)).toEqual({ project, created: false });
  });

  it("won't use the token on a repo that isn't a project, though GitHub would let it, and never sends it", async () => {
    const r = rig();
    const { repo } = await oauthProject(r);
    const other = r.fake.addRepo(900, "alice/other"); // the token reaches it; the person never added it
    const ref = refOf(r, "alice", other);
    r.fake.calls.length = 0;
    await expect(r.github.branchHead(ref, "main")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(r.github.tree(ref, "main")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(r.github.commit(ref, "tailzu/x-1234", [{ path: "a", content: "a" }], "m")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(r.github.openDraftPr(ref, "tailzu/x-1234", "T", "B")).rejects.toMatchObject({ code: "not_allowed" });
    expect(r.fake.calls).toHaveLength(0); // not one request, so the token was never sent anywhere
    // The same call on the project goes through.
    await expect(r.github.branchHead(refOf(r, "alice", repo), "main")).resolves.toMatch(/^[0-9a-f]{40}$/);
  });

  it("won't use the token on a repo that is a project of the GitHub App, or one that is somebody else's project", async () => {
    const r = rig();
    await signIn(r, "alice");
    const { repo: viaApp } = await appProject(r, "alice"); // alice/app, through the App
    const bobs = await oauthProject(r, "bob");
    r.fake.calls.length = 0;
    await expect(r.github.branchHead(refOf(r, "alice", viaApp), "main")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(r.github.branchHead(refOf(r, "alice", bobs.repo), "main")).rejects.toMatchObject({ code: "not_allowed" });
    expect(r.fake.calls).toHaveLength(0);
  });

  it("refuses by the repo's id, from the store, before looking at anything else about the token", async () => {
    const r = rig();
    await signIn(r, "alice");
    const stranger = r.fake.addRepo(900, "alice/stranger");
    await expect(r.oauth.tokenFor("alice", { repoId: stranger.id })).rejects.toMatchObject({ code: "not_allowed" });
    await expect(r.oauth.tokenFor("alice", { repoId: 123456789 })).rejects.toMatchObject({ code: "not_allowed" });
    await expect(r.oauth.tokenFor("nobody", { repoId: stranger.id })).rejects.toMatchObject({ code: "needs_signin" });
  });
});

// ------------------------------------------------------------ push access, before every write

describe("push access, checked again before every write", () => {
  it("asks GitHub afresh (GET /repos/{o}/{r}, permissions.push, with the person's token) and turns a write away once it's gone", async () => {
    const r = rig();
    const acme = r.fake.addRepo(901, "acme/api");
    r.fake.setPermission(acme, "alice", "write");
    await signIn(r, "alice");
    const { project } = await addProject(r.d, "alice", acme.id);
    r.fake.calls.length = 0;
    const made = await createWorkBranch(r.d, "alice", project.id, "first");
    const check = r.fake.calls.find((c) => c.method === "GET" && c.url.pathname === "/repos/acme/api")!;
    expect(check.headers.authorization).toBe("Bearer gho_alice_token");

    // Taken away on GitHub: the next write is refused, with nothing written.
    r.fake.setPermission(acme, "alice", "read");
    const writes = r.fake.writes().length;
    await expect(createWorkBranch(r.d, "alice", project.id, "second")).rejects.toMatchObject({ code: "no_access" });
    const ws = await workspace(r.d, "alice", project.id, made.branch).catch((e) => e);
    expect(ws).toMatchObject({ code: "no_access" }); // the result of the check just now is what a read goes by, too
    await expect(openPr(r.d, "alice", project.id, made.branch, "T", "B")).rejects.toMatchObject({ code: "no_access" });
    expect(r.fake.writes().length).toBe(writes);
  });

  it("lets a read go by what was kept for ten minutes, and a write ask again", async () => {
    const r = rig();
    const acme = r.fake.addRepo(901, "acme/api", { files: { "README.md": "# api\n" } });
    r.fake.setPermission(acme, "alice", "write");
    await signIn(r, "alice");
    const { project } = await addProject(r.d, "alice", acme.id);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "reads");
    const ws = await workspace(r.d, "alice", project.id, branch);
    r.fake.setPermission(acme, "alice", "read"); // can still look, can no longer push
    r.fake.clock.t += 5 * MIN;
    expect((await ws.read("README.md")).text).toBe("# api\n");
    await expect(ws.commit([{ path: "x.txt", content: "x" }], "m")).rejects.toMatchObject({ code: "no_access" });
    // The write found out, and what it found is kept: the read knows too.
    await expect(ws.read("README.md")).rejects.toMatchObject({ code: "no_access" });
  });

  it("treats a repo that is gone for the person (404) as no access", async () => {
    const r = rig();
    const acme = r.fake.addRepo(901, "acme/api");
    r.fake.setPermission(acme, "alice", "admin");
    await signIn(r, "alice");
    const { project } = await addProject(r.d, "alice", acme.id);
    r.fake.setPermission(acme, "alice", null);
    await expect(createWorkBranch(r.d, "alice", project.id, "x")).rejects.toMatchObject({ code: "no_access" });
  });
});

// ------------------------------------------------------------ the trailer

describe("the commit trailer", () => {
  it("ends every commit made with the person's token with Co-authored-by: Tailzu", async () => {
    const r = rig();
    const { project, repo } = await oauthProject(r);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "trailer");
    const ws = await workspace(r.d, "alice", project.id, branch);
    await ws.commit([{ path: "x.txt", content: "x" }], "Add x\n\nWhy.");
    expect(COMMIT_TRAILER).toBe("Co-authored-by: Tailzu <code@tailzu.space>");
    expect(r.fake.headMessage(repo, branch)).toBe("Add x\n\nWhy.\n\nCo-authored-by: Tailzu <code@tailzu.space>");
    // Not twice.
    await ws.commit([{ path: "y.txt", content: "y" }], `Add y\n\n${COMMIT_TRAILER}`);
    expect(r.fake.headMessage(repo, branch)).toBe(`Add y\n\n${COMMIT_TRAILER}`);
  });

  it("is not added to a commit made through the App", async () => {
    const r = rig();
    const { project, repo } = await appProject(r);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "no trailer");
    await (await workspace(r.d, "alice", project.id, branch)).commit([{ path: "x.txt", content: "x" }], "Add x");
    expect(r.fake.headMessage(repo, branch)).toBe("Add x");
  });
});

// ------------------------------------------------------------ runners

describe("access for runners", () => {
  it("gives a sign-in project a one-time download link for the branch's code, and never the token", async () => {
    const r = rig();
    const { project, repo, token } = await oauthProject(r);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "run");
    const head = r.fake.head(repo, branch);
    r.fake.calls.length = 0;
    const got = await runnerAccess(r.d, "alice", project.id, branch, "read");
    expect(got).toEqual({ kind: "oauth", tarballUrl: expect.stringMatching(new RegExp(`^https://codeload\\.github\\.com/alice/app/legacy\\.tar\\.gz/${head}\\?token=SHORT-LIVED`)) });
    expect(JSON.stringify(got)).not.toContain(token);
    expect(Object.keys(got)).toEqual(["kind", "tarballUrl"]);
    // The redirect GitHub answered with is what was returned: asked not to follow, and not followed.
    const tar = r.fake.calls.find((c) => c.url.pathname.includes("/tarball/"))!;
    expect(tar.redirect).toBe("manual");
    expect(tar.url.pathname).toBe(`/repos/alice/app/tarball/${head}`);
    expect(r.fake.calls.some((c) => c.url.hostname === "codeload.github.com")).toBe(false);
  });

  it("refuses push for a sign-in project: the server commits what the runner hands back", async () => {
    const r = rig();
    const { project, token } = await oauthProject(r);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "run");
    r.fake.calls.length = 0;
    const err = await runnerAccess(r.d, "alice", project.id, branch, "push").catch((e) => e);
    expect(err).toMatchObject({ code: "use_server_commit" });
    expect(String(err.message)).not.toContain(token);
    expect(r.fake.calls).toHaveLength(0);
  });

  it("still gives an App project its repo-scoped token, and says which kind it is", async () => {
    const r = rig();
    const { project } = await appProject(r);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "run");
    const got = await runnerAccess(r.d, "alice", project.id, branch, "push");
    expect(got).toMatchObject({ kind: "app", cloneUrl: "https://github.com/alice/app.git", token: expect.stringMatching(/^ghs_/) });
  });

  it("applies the rest of the rule to a sign-in project: recorded branch, the person, push access, a live link", async () => {
    const r = rig();
    const acme = r.fake.addRepo(901, "acme/api");
    r.fake.setPermission(acme, "alice", "write");
    await signIn(r, "alice");
    const { project } = await addProject(r.d, "alice", acme.id);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "run");
    await expect(runnerAccess(r.d, "bob", project.id, branch, "read")).rejects.toMatchObject({ code: "not_found" });
    await expect(runnerAccess(r.d, "alice", project.id, "main", "read")).rejects.toMatchObject({ code: "not_found" });
    r.fake.setPermission(acme, "alice", "read");
    await expect(runnerAccess(r.d, "alice", project.id, branch, "read")).rejects.toMatchObject({ code: "no_access" });
  });
});

// ------------------------------------------------------------ revoking

describe("revoking the token", () => {
  it("revokes at GitHub on disconnect, then forgets the link and the projects that went through it, and not the App's", async () => {
    const r = rig();
    const { project: viaApp } = await appProject(r);
    const { token, project: viaSignin } = await oauthProject(r, "alice", "alice/solo");
    const out = await r.oauth.disconnect("alice");
    expect(out).toEqual({ revoked: true });
    expect(r.fake.revoked).toEqual([token]);
    const del = r.fake.calls.find((c) => c.method === "DELETE")!;
    expect(del.url.pathname).toBe(`/applications/${r.fake.oauthClientId}/token`);
    expect(del.headers.authorization).toMatch(/^Basic /);
    expect(del.body).toEqual({ access_token: token });
    expect(await r.store.getOAuthLink("alice")).toBeNull();
    expect(await r.store.getProject("alice", viaSignin.id)).toBeNull();
    expect(await r.store.getProject("alice", viaApp.id)).not.toBeNull();
    // Nothing to disconnect now.
    expect(await r.oauth.disconnect("alice")).toEqual({ revoked: false });
  });

  it("does not drop the token if GitHub can't be reached to revoke it: the link is made unusable and the person tries again", async () => {
    const r = rig();
    const { token } = await oauthProject(r);
    r.fake.failWith = { prefix: "/applications", status: 500 };
    await expect(r.oauth.disconnect("alice")).rejects.toMatchObject({ code: "failed" });
    const link = (await r.store.getOAuthLink("alice"))!;
    expect(link.status).toBe("needs_signin");
    expect(decrypt(link.tokenEnc!)).toBe(token); // kept, so it can still be revoked
    await expect(r.oauth.listRepos("alice")).rejects.toMatchObject({ code: "needs_signin" }); // and unusable meanwhile
    r.fake.failWith = null;
    expect(await r.oauth.disconnect("alice")).toEqual({ revoked: true });
    expect(r.fake.revoked).toEqual([token]);
    expect(await r.store.getOAuthLink("alice")).toBeNull();
  });

  it("revokes when the account is deleted, without ever throwing", async () => {
    const r = rig();
    const { token } = await oauthProject(r);
    expect(await r.oauth.forAccountDelete("alice")).toBe(true);
    expect(r.fake.revoked).toEqual([token]);
    expect(await r.oauth.forAccountDelete("nobody")).toBe(true);
    r.fake.failWith = { prefix: "/applications", status: 500 };
    const second = rig();
    await oauthProject(second, "bob");
    second.fake.failWith = { prefix: "/applications", status: 500 };
    expect(await second.oauth.forAccountDelete("bob")).toBe(false); // GitHub down: told, not thrown
  });

  it("revokes a token unused for 30 days, and measures from the last use", async () => {
    const r = rig();
    const { token, project } = await oauthProject(r);
    expect(IDLE_REVOKE_MS).toBe(30 * DAY);
    r.fake.clock.t += 29 * DAY;
    expect(await r.oauth.expireUnused()).toBe(0);
    // Used on day 29: the 30 days start again.
    await createWorkBranch(r.d, "alice", project.id, "still here");
    r.fake.clock.t += 29 * DAY;
    expect(await r.oauth.expireUnused()).toBe(0);
    expect(r.fake.revoked).toEqual([]);
    r.fake.clock.t += 2 * DAY;
    expect(await r.oauth.expireUnused()).toBe(1);
    expect(r.fake.revoked).toEqual([token]);
    const link = (await r.store.getOAuthLink("alice"))!;
    expect(link).toMatchObject({ status: "needs_signin", tokenEnc: null });
    // The projects stay; signing in again brings them back.
    expect(await r.store.getProject("alice", project.id)).not.toBeNull();
    expect(await r.oauth.expireUnused()).toBe(0);
  });

  it("expires a token that was never used, from the day it was made, and retries one GitHub wouldn't revoke", async () => {
    const r = rig();
    await signIn(r, "alice");
    r.fake.clock.t += 30 * DAY + MIN;
    r.fake.failWith = { prefix: "/applications", status: 500 };
    expect(await r.oauth.expireUnused()).toBe(0);
    expect((await r.store.getOAuthLink("alice"))!.tokenEnc).not.toBeNull(); // kept, to try again
    r.fake.failWith = null;
    expect(await r.oauth.expireUnused()).toBe(1);
    expect((await r.store.getOAuthLink("alice"))!.tokenEnc).toBeNull();
  });

  it("runs the expiry on a timer", async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      await signIn(r, "alice");
      r.fake.clock.t += 31 * DAY;
      const stop = startOAuthSweeper({ oauth: r.oauth, everyMs: 10 * MIN });
      await vi.advanceTimersByTimeAsync(61_000);
      expect(r.fake.revoked).toHaveLength(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the link 'needs_signin' and drops the token when GitHub says 401, and fails fast after", async () => {
    const r = rig();
    const { token, project } = await oauthProject(r);
    r.fake.killOAuthToken(token); // the person revoked it on GitHub
    r.fake.calls.length = 0;
    await expect(createWorkBranch(r.d, "alice", project.id, "dead")).rejects.toMatchObject({ code: "needs_signin" });
    expect(await r.store.getOAuthLink("alice")).toMatchObject({ status: "needs_signin", tokenEnc: null });
    const calls = r.fake.calls.length;
    await expect(createWorkBranch(r.d, "alice", project.id, "again")).rejects.toMatchObject({ code: "needs_signin" });
    expect(r.fake.calls.length).toBe(calls); // no token, no request
    // Signing in again puts it right, and the project is still there.
    const fresh = new URL((await r.oauth.begin("alice")).authorizeUrl);
    r.fake.addOAuthPerson("c-new", "gho_new", "alice", { challenge: fresh.searchParams.get("code_challenge")! });
    await r.oauth.complete("c-new", fresh.searchParams.get("state")!);
    await expect(createWorkBranch(r.d, "alice", project.id, "back")).resolves.toBeDefined();
  });

  it("answers 'org_blocked', with a hint, when an organisation hasn't let the sign-in in", async () => {
    const r = rig();
    const acme = r.fake.addRepo(901, "acme/api");
    r.fake.setPermission(acme, "alice", "write");
    await signIn(r, "alice");
    const { project } = await addProject(r.d, "alice", acme.id);
    r.fake.blockOrg(acme);
    const err = await createWorkBranch(r.d, "alice", project.id, "blocked").catch((e) => e);
    expect(err).toMatchObject({ code: "org_blocked" });
    expect(err.message).toMatch(/organi[sz]ation/i);
    expect(err.message).toMatch(/approve|install the Tailzu GitHub App/i);
    expect(err.message).not.toMatch(/SAML enforcement|gho_/);
    // That is not a dead token: the link stays alive.
    expect((await r.store.getOAuthLink("alice"))!.status).toBe("active");
  });
});

// ------------------------------------------------------------ the kill switch

describe("the kill switch", () => {
  it("uses no stored token while CODE_GITHUB_OAUTH is off", async () => {
    const r = rig();
    const { project, token, repo } = await oauthProject(r);
    const made = await createWorkBranch(r.d, "alice", project.id, "before the switch");
    // The server restarts with the switch off: same store, same projects.
    const off = new GithubOAuth({ config: { clientId: r.fake.oauthClientId, clientSecret: r.fake.oauthClientSecret }, store: r.store, github: r.github, enabled: false, fetchFn: r.fake.fetchFn, now: () => r.fake.clock.t });
    const dOff = { ...r.d, oauth: off };
    r.fake.calls.length = 0;
    await expect(off.tokenFor("alice", { repoId: repo.id })).rejects.toMatchObject({ code: "oauth_off" });
    await expect(createWorkBranch(dOff, "alice", project.id, "x")).rejects.toMatchObject({ code: "oauth_off" });
    await expect(workspace(dOff, "alice", project.id, made.branch)).rejects.toMatchObject({ code: "oauth_off" });
    await expect(syncBranch(dOff, "alice", project.id, made.branch)).rejects.toMatchObject({ code: "oauth_off" });
    await expect(runnerAccess(dOff, "alice", project.id, made.branch, "read")).rejects.toMatchObject({ code: "oauth_off" });
    await expect(initEmptyRepo(dOff, "alice", project.id)).rejects.toMatchObject({ code: "oauth_off" });
    expect(await listRepos(dOff, "alice")).toEqual({ repos: [], truncated: false });
    expect(r.fake.calls.some((c) => c.headers.authorization === `Bearer ${token}`)).toBe(false);
    expect(r.fake.calls).toHaveLength(0);
    // With no sign-in client at all (not set up on this server) a sign-in project is just as unusable.
    const none = { ...r.d, oauth: null };
    await expect(createWorkBranch(none, "alice", project.id, "x")).rejects.toMatchObject({ code: "oauth_off" });
    // Back on, it works again.
    await expect(createWorkBranch(r.d, "alice", project.id, "x")).resolves.toBeDefined();
  });

  it("still revokes with the switch off: revoking only destroys", async () => {
    const r = rig();
    const { token } = await oauthProject(r);
    const off = new GithubOAuth({ config: { clientId: r.fake.oauthClientId, clientSecret: r.fake.oauthClientSecret }, store: r.store, github: r.github, enabled: false, fetchFn: r.fake.fetchFn, now: () => r.fake.clock.t });
    expect(await off.disconnect("alice")).toEqual({ revoked: true });
    expect(r.fake.revoked).toEqual([token]);
  });

  it("ends every stored token at once (revokeAll, what scripts/revoke-github-oauth.ts runs), whatever the switch says", async () => {
    const r = rig({ enabled: false });
    // Three people with tokens, in one store, signed in through an enabled hub.
    const store = r.store;
    const hub = new GithubOAuth({ config: { clientId: r.fake.oauthClientId, clientSecret: r.fake.oauthClientSecret }, store, github: r.github, enabled: true, fetchFn: r.fake.fetchFn, now: () => r.fake.clock.t });
    const tokens: string[] = [];
    for (const u of ["a1", "a2", "a3"]) {
      const url = new URL((await hub.begin(u)).authorizeUrl);
      const tok = `gho_${u}`;
      tokens.push(tok);
      r.fake.addOAuthPerson(`code-${u}`, tok, u, { challenge: url.searchParams.get("code_challenge")! });
      await hub.complete(`code-${u}`, url.searchParams.get("state")!);
    }
    expect(r.fake.revoked).toEqual([]);
    expect(await r.oauth.revokeAll()).toEqual({ revoked: 3, failed: 0 }); // r.oauth has the switch off
    expect(r.fake.revoked.sort()).toEqual(tokens.sort());
    for (const u of ["a1", "a2", "a3"]) expect(await store.getOAuthLink(u)).toMatchObject({ status: "needs_signin", tokenEnc: null });
    expect(await r.oauth.revokeAll()).toEqual({ revoked: 0, failed: 0 });
  });

  it("counts the tokens GitHub wouldn't revoke, and keeps them for another run", async () => {
    const r = rig();
    await signIn(r, "alice");
    await signIn(r, "bob");
    // GitHub fails for one of the two: the first revoke works, then it goes down.
    const real = r.fake.fetchFn;
    let n = 0;
    const flaky = (async (i: any, init: any) => (String(i).includes("/applications/") && ++n === 2 ? new Response("{}", { status: 500 }) : real(i, init))) as typeof fetch;
    const hub = new GithubOAuth({ config: { clientId: r.fake.oauthClientId, clientSecret: r.fake.oauthClientSecret }, store: r.store, github: r.github, enabled: true, fetchFn: flaky, now: () => r.fake.clock.t });
    expect(await hub.revokeAll()).toEqual({ revoked: 1, failed: 1 });
    expect(await r.oauth.revokeAll()).toEqual({ revoked: 1, failed: 0 });
    expect(r.fake.revoked).toHaveLength(2);
  });
});

// ------------------------------------------------------------ the App is preferred

describe("when the App reaches the same repo", () => {
  it("lists it once, as the App's, and makes the project through the App", async () => {
    const r = rig();
    await signIn(r, "alice");
    r.fake.addInstall(101, "alice");
    const shared = r.fake.addRepo(101, "alice/shared");
    const solo = r.fake.addRepo(900, "alice/solo"); // only the sign-in reaches this one
    await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "all", githubUserId: 1, githubLogin: "alice" });

    const listed = await listRepos(r.d, "alice");
    expect(listed.repos.filter((x) => x.id === shared.id)).toEqual([{ id: shared.id, fullName: "alice/shared", private: true, defaultBranch: "main", installationId: 101 }]);
    expect(listed.repos.find((x) => x.id === solo.id)).toMatchObject({ source: "oauth", installationId: 0 });
    expect(listed.repos).toHaveLength(2);

    const a = (await addProject(r.d, "alice", shared.id)).project;
    const b = (await addProject(r.d, "alice", solo.id)).project;
    expect(a).toMatchObject({ linkKind: "app", installationId: 101 });
    expect(b).toMatchObject({ linkKind: "oauth", installationId: 0 });

    // And the calls on the first never carry the person's token.
    r.fake.calls.length = 0;
    const { branch } = await createWorkBranch(r.d, "alice", a.id, "through the app");
    await (await workspace(r.d, "alice", a.id, branch)).commit([{ path: "x.txt", content: "x" }], "m");
    expect(r.fake.calls.some((c) => c.headers.authorization === "Bearer gho_alice_token")).toBe(false);
    expect(r.fake.calls.some((c) => /^Bearer ghs_/.test(c.headers.authorization ?? ""))).toBe(true);
    expect(r.fake.headMessage(shared, branch)).toBe("m"); // no trailer: it was the App
  });

  it("moves a project that was added through the sign-in over to the App once the App reaches the repo", async () => {
    const r = rig();
    const { project, repo } = await oauthProject(r);
    expect(project.linkKind).toBe("oauth");
    // Later the person installs the App on that repo.
    r.fake.addInstall(101, "alice");
    repo.installationId = 101;
    await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "all", githubUserId: 1, githubLogin: "alice" });
    const again = await addProject(r.d, "alice", repo.id);
    expect(again.created).toBe(false);
    expect(again.project).toMatchObject({ id: project.id, linkKind: "app", installationId: 101 });
    r.fake.calls.length = 0;
    await createWorkBranch(r.d, "alice", project.id, "now the app");
    expect(r.fake.calls.some((c) => c.headers.authorization === "Bearer gho_alice_token")).toBe(false);
  });
});

// ------------------------------------------------------------ every guard, for both ways in

describe.each(["app", "oauth"] as const)("every guard holds for a %s project", (kind) => {
  async function project(r: Rig) {
    return kind === "app" ? appProject(r) : oauthProject(r);
  }

  it("never writes to the default branch, or to a branch outside tailzu/, or with .. in it", async () => {
    const r = rig();
    const { project: p, repo } = await project(r);
    const ref = { installationId: p.installationId, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main", ...(kind === "oauth" ? { access: r.oauth.access("alice") } : {}) };
    const head = r.fake.head(repo, "main");
    r.fake.calls.length = 0;
    for (const branch of ["main", "feature/x", "tailzu/../main", "TAILZU/x", ""]) {
      await expect(r.github.commit(ref, branch, [{ path: "a.txt", content: "a" }], "m"), branch).rejects.toMatchObject({ code: "bad_branch" });
      await expect(r.github.openDraftPr(ref, branch, "T", "B"), branch).rejects.toMatchObject({ code: "bad_branch" });
      await expect(r.github.createBranch(ref, branch), branch).rejects.toMatchObject({ code: "bad_branch" });
      await expect(r.github.deleteBranch(ref, branch), branch).rejects.toMatchObject({ code: "bad_branch" });
      await expect(r.github.mergeDefaultInto(ref, branch), branch).rejects.toMatchObject({ code: "bad_branch" });
    }
    expect(r.fake.calls).toHaveLength(0);
    expect(r.fake.head(repo, "main")).toBe(head);
  });

  it("holds the path rules: relative, no .., nothing in .git, no workflow files", async () => {
    const r = rig();
    const { project: p } = await project(r);
    const { branch } = await createWorkBranch(r.d, "alice", p.id, "paths");
    const ws = await workspace(r.d, "alice", p.id, branch);
    for (const path of ["../x", "a/../../b", "/abs", ".git/config", "", ".github/workflows/ci.yml", ".github/workflows/tailzu.yml", ".GitHub/Workflows/tailzu.yml"]) {
      await expect(ws.commit([{ path, content: "x" }], "m"), path).rejects.toMatchObject({ code: "bad_path" });
    }
    await expect(ws.read("../etc/passwd")).rejects.toMatchObject({ code: "bad_path" });
  });

  it("writes the first README only into a repo with no commits", async () => {
    const r = rig();
    const { project: p, repo } = await project(r);
    const head = r.fake.head(repo, "main");
    await expect(initEmptyRepo(r.d, "alice", p.id, "T")).rejects.toMatchObject({ code: "repo_not_empty" });
    expect(r.fake.head(repo, "main")).toBe(head);
    expect(r.fake.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("merges only in two steps, only the commit that was approved, only into the default branch", async () => {
    const r = rig();
    const { project: p, repo } = await project(r);
    const { branch } = await createWorkBranch(r.d, "alice", p.id, "merge");
    const ws = await workspace(r.d, "alice", p.id, branch);
    await ws.commit([{ path: "f.txt", content: "one\n" }], "f");
    await ws.openDraftPr("T", "B");
    const mainHead = r.fake.head(repo, "main");

    await expect(requestMerge(r.d, "alice", p.id, branch)).rejects.toMatchObject({ code: "pr_draft" });
    await markReady(r.d, "alice", p.id, branch);
    const { approvalId, summary } = await requestMerge(r.d, "alice", p.id, branch);
    expect(r.fake.head(repo, "main")).toBe(mainHead); // step one merges nothing
    // The branch moves after the yes: nothing is merged.
    r.fake.push(repo, branch, { "late.txt": "x" });
    await expect(confirmMerge(r.d, "alice", p.id, branch, approvalId)).rejects.toMatchObject({ code: "changed_since_approval" });
    expect(r.fake.head(repo, "main")).toBe(mainHead);
    // A new look, a new yes: squash-merged at the sha that was looked at.
    const second = await requestMerge(r.d, "alice", p.id, branch);
    expect(second.summary.headSha).not.toBe(summary.headSha);
    await confirmMerge(r.d, "alice", p.id, branch, second.approvalId);
    const put = r.fake.calls.find((c) => c.method === "PUT" && c.url.pathname.endsWith("/merge"))!;
    expect(put.body).toEqual({ merge_method: "squash", sha: second.summary.headSha });
    await expect(confirmMerge(r.d, "alice", p.id, branch, second.approvalId)).rejects.toMatchObject({ code: "approval_invalid" });
    // And the finished branch can go; only a tailzu/ one.
    await closePr(r.d, "alice", p.id, branch).catch(() => undefined);
    await deleteWorkBranch(r.d, "alice", p.id, branch);
    expect(r.fake.branches(repo)).not.toContain(branch);
    expect(r.fake.branches(repo)).toContain("main");
  });

  it("only merges a pull request from its own work branch into the default branch", async () => {
    const r = rig();
    const { project: p, repo } = await project(r);
    const { branch } = await createWorkBranch(r.d, "alice", p.id, "merge");
    const ws = await workspace(r.d, "alice", p.id, branch);
    await ws.commit([{ path: "f.txt", content: "one\n" }], "f");
    const pr = await ws.openDraftPr("T", "B");
    await markReady(r.d, "alice", p.id, branch);
    const ref = { installationId: p.installationId, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main", ...(kind === "oauth" ? { access: r.oauth.access("alice") } : {}) };
    const head = r.fake.head(repo, branch)!;
    r.fake.calls.length = 0;
    await expect(r.github.mergePull(ref, "main", pr.prNumber, head)).rejects.toMatchObject({ code: "bad_branch" });
    await expect(r.github.mergePull(ref, "tailzu/other-0000", pr.prNumber, head)).rejects.toMatchObject({ code: "bad_branch" });
    await expect(r.github.mergePull(ref, branch, pr.prNumber, "0".repeat(40))).rejects.toMatchObject({ code: "changed_since_approval" });
    expect(r.fake.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("asks the access rule afresh before sync, ready, close, merge and delete, and writes nothing when it fails", async () => {
    const r = rig();
    let p: { id: string };
    let lose: () => Promise<void> | void;
    if (kind === "oauth") {
      // A repo of an organisation, pushed to by right of a permission that can be taken away.
      const acme = r.fake.addRepo(901, "acme/api");
      r.fake.setPermission(acme, "alice", "write");
      await signIn(r, "alice");
      p = (await addProject(r.d, "alice", acme.id)).project;
      lose = () => r.fake.setPermission(acme, "alice", "read");
    } else {
      p = (await appProject(r)).project;
      lose = () => r.store.setSuspended(101, 1);
    }
    const { branch } = await createWorkBranch(r.d, "alice", p.id, "gated");
    const ws = await workspace(r.d, "alice", p.id, branch);
    await ws.commit([{ path: "f.txt", content: "one\n" }], "f");
    await ws.openDraftPr("T", "B");
    await lose();
    const writes = r.fake.writes().length;
    for (const op of [syncBranch, markReady, closePr, requestMerge, deleteWorkBranch]) {
      await expect(op(r.d, "alice", p.id, branch), op.name).rejects.toMatchObject({ code: kind === "oauth" ? "no_access" : "suspended" });
    }
    expect(r.fake.writes().length).toBe(writes);
  });
});

// ------------------------------------------------------------ the one workflow file

describe("the one workflow file Tailzu may ever write", () => {
  it("is refused everywhere by default, with the single exception behind a flag", () => {
    for (const path of [TAILZU_WORKFLOW, ".github/workflows/ci.yml", ".github/workflows/tailzu.yml/x", ".github/workflows/Tailzu.yml", ".github/workflows/sub/tailzu.yml", ".github/workflows"]) {
      expect(() => assertRepoPath(path, true), path).toThrowError(expect.objectContaining({ code: "bad_path" }));
      expect(() => assertRepoPath(path, true, { workflow: false }), path).toThrowError(expect.objectContaining({ code: "bad_path" }));
    }
    expect(TAILZU_WORKFLOW).toBe(".github/workflows/tailzu.yml");
    expect(assertRepoPath(TAILZU_WORKFLOW, true, { workflow: true })).toBe(TAILZU_WORKFLOW);
    // Even with the flag, nothing else under workflows.
    for (const path of [".github/workflows/ci.yml", ".github/workflows/tailzu.yml/x", ".github/workflows/Tailzu.yml", ".github/workflows/sub/tailzu.yml", ".GitHub/workflows/tailzu.yml"]) {
      expect(() => assertRepoPath(path, true, { workflow: true }), path).toThrowError(expect.objectContaining({ code: "bad_path" }));
    }
    // Reading is not writing.
    expect(() => assertRepoPath(".github/workflows/ci.yml", false)).not.toThrow();
  });

  it("is allowed in a commit only on a work branch, with a token that has the workflow scope", async () => {
    // A sign-in made through the incremental flow, so the token has the scope.
    const r = rig();
    const token = await signIn(r, "alice", { workflow: true, scopes: ["repo", "read:user", "workflow"] });
    const repo = r.fake.addRepo(900, "alice/app");
    const { project } = await addProject(r.d, "alice", repo.id);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "ci");
    const ws = await workspace(r.d, "alice", project.id, branch);
    await ws.commit([{ path: ".github/workflows/tailzu.yml", content: "name: tailzu\n" }], "Add the workflow");
    expect(r.fake.files(repo, branch)[".github/workflows/tailzu.yml"]).toBe("name: tailzu\n");
    expect(token).toBeDefined();
    // Any other workflow file is still refused, with the scope.
    for (const path of [".github/workflows/ci.yml", ".github/workflows/other/tailzu.yml"]) {
      await expect(ws.commit([{ path, content: "x" }], "m"), path).rejects.toMatchObject({ code: "bad_path" });
    }
    // The default branch is still never written.
    const ref = { installationId: 0, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main", access: r.oauth.access("alice") };
    await expect(r.github.commit(ref, "main", [{ path: ".github/workflows/tailzu.yml", content: "x" }], "m")).rejects.toMatchObject({ code: "bad_branch" });
  });

  it("stays refused for a token without the scope, and for the App", async () => {
    const r = rig();
    const { project } = await oauthProject(r);
    const { branch } = await createWorkBranch(r.d, "alice", project.id, "ci");
    await expect((await workspace(r.d, "alice", project.id, branch)).commit([{ path: TAILZU_WORKFLOW, content: "x" }], "m")).rejects.toMatchObject({ code: "bad_path" });
    const app = rig();
    const { project: ap } = await appProject(app);
    const { branch: ab } = await createWorkBranch(app.d, "alice", ap.id, "ci");
    await expect((await workspace(app.d, "alice", ap.id, ab)).commit([{ path: TAILZU_WORKFLOW, content: "x" }], "m")).rejects.toMatchObject({ code: "bad_path" });
  });
});

describe("what GitHub says when an organisation hasn't let the sign-in in", () => {
  it("is 'org_blocked' however GitHub puts it, and never repeats GitHub's words", async () => {
    const { githubError, orgBlocked } = await import("../src/code/github.js");
    for (const said of [
      "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.",
      "Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.",
      "Third-party application access is restricted",
    ]) {
      const err = githubError(403, { message: said }, "that repo");
      expect(err).toMatchObject({ code: "org_blocked", message: orgBlocked().message });
      expect(err.message).not.toMatch(/SAML enforcement|correct authorization credentials/);
    }
    // An ordinary 403 is not that.
    expect(githubError(403, { message: "Resource not accessible by integration" }, "that repo").code).toBe("forbidden");
  });
});

describe("the access object", () => {
  it("is one interface with a kind, a token source, and for a person's own token a trailer", () => {
    const r = rig();
    const a = r.oauth.access("alice");
    expect(a).toBeInstanceOf(OAuthAccess);
    expect(a.kind).toBe("oauth");
    expect(a.commitTrailer).toBe(COMMIT_TRAILER);
  });
});

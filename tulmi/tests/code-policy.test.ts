/**
 * What Xode may do, what it asks about first, and what it never does
 * (src/code/policy.ts), and how that is put to work on a real repo (a fake
 * GitHub, tests/github-fake.ts): the tiers, the standing grants, the questions
 * and their yes (single use, ten minutes, bound to what was looked at), the
 * secret scan, force-pushes, the paths that are never right, and GitHub's
 * branch protection said in plain words.
 *
 * The engine (decide, the globs, the scan) is tested on its own, and then the
 * same behaviours are held for BOTH ways of connecting: a GitHub App install
 * and the person's own "Sign in with GitHub". Who commits (the bot as author,
 * the person as co-author) is in tests/code-oauth.test.ts. The routes for the
 * standing grants are in tests/code-routes.test.ts. Nothing reaches the network.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { appKeys, FakeGithub } = await import("./github-fake.js");
const { GithubApp, githubError, isProtectionRefusal } = await import("../src/code/github.js");
const { MemoryCodeStore } = await import("../src/code/store.js");
const { ApprovalBook, APPROVAL_TTL_MS } = await import("../src/code/approvals.js");
const { GithubOAuth } = await import("../src/code/oauth.js");
const { botFromEnv } = await import("../src/code/index.js");
const {
  ACTIONS, GIT_PRINCIPLES, GRANTS_MAX, PolicyError, actionCatalog, branchMatches, decide, isGrantable, isNeedsApproval, needsFaceId, parseGrant,
  scanForSecrets, isWorkflowPath,
} = await import("../src/code/policy.js");
const { addProject, commitToBranch, createWorkBranch, forceUpdateBranch, initEmptyRepo, openPr, workspace } = await import("../src/code/projects.js");
const { closePr, deleteWorkBranch, markReady, mergePr, syncBranch, branchDiff, prStatus } = await import("../src/code/pulls.js");
const { resetConfigForTests } = await import("../src/config.js");

type Fake = InstanceType<typeof FakeGithub>;
let KEYS: ReturnType<typeof appKeys>;
beforeAll(() => { KEYS = appKeys(); });
afterEach(() => { vi.restoreAllMocks(); });

const MIN = 60_000;

// ----------------------------------------------------------------- the rig

function rig() {
  const fake: Fake = new FakeGithub(KEYS);
  const now = () => fake.clock.t;
  const store = new MemoryCodeStore(now);
  const github = new GithubApp(
    { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem, appId: "123456" },
    { fetchFn: fake.fetchFn, now },
  );
  const approvals = new ApprovalBook({ now });
  const oauth = new GithubOAuth({
    config: { clientId: fake.oauthClientId, clientSecret: fake.oauthClientSecret }, store, github, enabled: true, fetchFn: fake.fetchFn, now,
  });
  return { fake, store, github, approvals, oauth, d: { store, github, approvals, oauth } };
}
type Rig = ReturnType<typeof rig>;

async function signIn(r: Rig, user: string): Promise<string> {
  const url = new URL((await r.oauth.begin(user)).authorizeUrl);
  const token = `gho_${user}_token`;
  r.fake.addOAuthPerson(`code-${user}`, token, user, { challenge: url.searchParams.get("code_challenge") ?? undefined });
  await r.oauth.complete(`code-${user}`, url.searchParams.get("state")!);
  return token;
}

const FILES = { "README.md": "# app\n", "src/a.ts": "export const a = 1;\n" };

/** A project through an App install ("app") or through the person's own sign-in ("oauth"). */
async function project(r: Rig, kind: "app" | "oauth", user = "alice") {
  if (kind === "oauth") {
    await signIn(r, user);
    const repo = r.fake.addRepo(900, `${user}/app`, { files: FILES });
    return { repo, project: (await addProject(r.d, user, repo.id)).project };
  }
  r.fake.addInstall(101, user);
  const repo = r.fake.addRepo(101, `${user}/app`, { files: FILES });
  await r.store.upsertInstallation(user, { installationId: 101, accountLogin: user, accountType: "User", repositorySelection: "selected", githubUserId: 1, githubLogin: user });
  return { repo, project: (await addProject(r.d, user, repo.id)).project };
}

/** The question answered yes: runs it; if it asked, runs it again with the approval it gave. */
const yes = async (run: (o: { approvalId?: string }) => Promise<any>): Promise<any> => {
  const first = await run({});
  return first?.needsApproval ? run({ approvalId: first.approvalId }) : first;
};

// Things that look like secrets, put together here so this file holds none whole.
const SECRET = {
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  ghp: "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
  gho: "gh" + "o_" + "R8q7P6o5N4m3L2k1J0i9H8g7F6e5D4c3B2a1",
  ghs: "gh" + "s_" + "Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8",
  pat: "github_" + "pat_" + "11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJ",
  pem: "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEowIBAAKCAQEA0123\n-----END RSA PRIVATE KEY-----\n",
  slack: "xo" + "xb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
  value: "Zk3QpW9xLm2VbN7tRy5HcD8sFgJ4aE1u",
};

// ------------------------------------------------------------- the catalog

describe("the catalog of actions", () => {
  it("puts every action in the tier the founder set", () => {
    const tier = (a: keyof typeof ACTIONS) => ACTIONS[a].tier;
    for (const a of ["read", "branch.create", "commit.own_branch", "pr.open_draft", "branch.sync", "pr.comment", "runner.shadow"] as const) expect(tier(a), a).toBe("free");
    for (const a of ["commit.other_branch", "pr.merge", "pr.ready", "pr.close", "branch.delete", "workflow.write", "repo.init"] as const) expect(tier(a), a).toBe("ask");
    for (const a of ["push.force", "branch.delete_default", "commit.secret", "repo.visibility"] as const) expect(tier(a), a).toBe("ask_strict");
    for (const a of ["path.escape", "repo.delete", "runner.reserved"] as const) expect(tier(a), a).toBe("never");
    expect(Object.keys(ACTIONS)).toHaveLength(21);
  });

  it("flags only the strict ones for Face ID, and lets only the free and ask ones be granted", () => {
    const rows = actionCatalog();
    expect(rows).toHaveLength(21);
    for (const row of rows) {
      expect(row.faceId, row.id).toBe(row.tier === "ask_strict");
      expect(row.grantable, row.id).toBe(row.tier === "free" || row.tier === "ask");
      expect(needsFaceId(row.id)).toBe(row.faceId);
      expect(isGrantable(row.id)).toBe(row.grantable);
      expect(row.label.length).toBeGreaterThan(5);
    }
    expect(rows.find((x) => x.id === "commit.other_branch")).toMatchObject({ tier: "ask", branchScoped: true, grantable: true, faceId: false });
    expect(rows.find((x) => x.id === "repo.init")).toMatchObject({ branchScoped: false });
  });

  it("has principles in plain words: own branch, small commits, no force, no skipped checks, no secrets, branch protection, pull requests", () => {
    expect(GIT_PRINCIPLES.length).toBeGreaterThanOrEqual(7);
    for (const rule of [/own branch/i, /small commits/i, /never force-push/i, /never skip checks/i, /never commit secrets/i, /branch protection/i, /never try to get round it/i, /pull request/i]) {
      expect(GIT_PRINCIPLES.some((line) => rule.test(line)), String(rule)).toBe(true);
    }
    for (const line of GIT_PRINCIPLES) {
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(20);
      expect(line.length).toBeLessThan(200);
    }
  });
});

// ------------------------------------------------------------- decide()

describe("decide()", () => {
  const project = { id: "p1" };
  const ctx = (o: Record<string, unknown> = {}) => ({
    project, defaultBranch: "main", attended: true, connection: "app" as const, scopes: [] as string[], grants: [], ...o,
  });
  const grant = (g: Record<string, unknown>) => ({ id: "g1", projectId: "p1", effect: "allow" as const, createdAt: 1, ...g }) as never;

  it("allows the free actions, with nobody to ask too", () => {
    for (const attended of [true, false]) {
      for (const [a, extra] of [
        ["read", {}], ["branch.create", {}], ["pr.open_draft", { branch: "feature/x" }],
        ["commit.own_branch", { branch: "tailzu/x-1", ownBranch: true }], ["branch.sync", { branch: "tailzu/x-1", ownBranch: true }], ["pr.comment", { branch: "tailzu/x-1", ownBranch: true }],
      ] as const) {
        expect(decide(a, ctx({ attended, ...extra })), `${a} ${attended}`).toEqual({ effect: "allow", tier: "free", reason: "free", faceId: false, action: a });
      }
    }
  });

  it("asks about committing to a branch the bot didn't make, the default branch included, and about the own-branch actions anywhere but a branch it made", () => {
    expect(decide("commit.own_branch", ctx({ branch: "feature/x", ownBranch: false }))).toEqual({ effect: "ask", tier: "ask", reason: "needs_approval", faceId: false, action: "commit.other_branch" });
    expect(decide("commit.other_branch", ctx({ branch: "main" }))).toMatchObject({ effect: "ask", tier: "ask", faceId: false });
    // The default branch is never "own", whatever the record says.
    expect(decide("commit.own_branch", ctx({ branch: "main", ownBranch: true }))).toMatchObject({ effect: "ask", action: "commit.other_branch" });
    expect(decide("branch.sync", ctx({ branch: "feature/x", ownBranch: false }))).toMatchObject({ effect: "ask", tier: "ask", action: "branch.sync" });
    expect(decide("pr.comment", ctx({ branch: "feature/x" }))).toMatchObject({ effect: "ask", tier: "ask" });
    expect(decide("commit.own_branch", ctx({ ownBranch: true }))).toMatchObject({ effect: "ask" }); // no branch named: not provably its own
  });

  it("asks about every action in the ask tier", () => {
    for (const a of ["pr.merge", "pr.ready", "pr.close", "branch.delete", "repo.init"] as const) {
      expect(decide(a, ctx({ branch: "tailzu/x-1", ownBranch: true })), a).toEqual({ effect: "ask", tier: "ask", reason: "needs_approval", faceId: false, action: a });
    }
  });

  it("asks the strict ones with Face ID, and denies them to nobody-is-here as 'needs_you', like the rest that ask", () => {
    for (const a of ["push.force", "branch.delete_default", "commit.secret", "repo.visibility"] as const) {
      expect(decide(a, ctx({ branch: "main" })), a).toEqual({ effect: "ask", tier: "ask_strict", reason: "needs_strict_approval", faceId: true, action: a });
      expect(decide(a, ctx({ branch: "main", attended: false })), a).toEqual({ effect: "deny", tier: "ask_strict", reason: "needs_you", faceId: true, action: a });
    }
    for (const a of ["commit.other_branch", "pr.merge", "repo.init"] as const) {
      expect(decide(a, ctx({ attended: false })), a).toEqual({ effect: "deny", tier: "ask", reason: "needs_you", faceId: false, action: a });
    }
  });

  it("denies the 'never' ones, whatever else is said", () => {
    for (const a of ["path.escape", "repo.delete"] as const) {
      expect(decide(a, ctx()), a).toEqual({ effect: "deny", tier: "never", reason: "never", faceId: false, action: a });
      expect(decide(a, ctx({ grants: [grant({ action: a, effect: "allow" })] })), a).toMatchObject({ effect: "deny", reason: "never" });
    }
    expect(decide("not.an.action" as never, ctx())).toMatchObject({ effect: "deny", reason: "unknown_action" });
  });

  it("lets a standing allow skip the ask: for the branch it names, not for the rest", () => {
    const g = [grant({ action: "commit.other_branch", branchPattern: "main" })];
    expect(decide("commit.other_branch", ctx({ branch: "main", grants: g }))).toEqual({ effect: "allow", tier: "ask", reason: "standing_permission", faceId: false, action: "commit.other_branch" });
    expect(decide("commit.other_branch", ctx({ branch: "develop", grants: g }))).toMatchObject({ effect: "ask" });
    expect(decide("commit.other_branch", ctx({ branch: "main-2", grants: g }))).toMatchObject({ effect: "ask" });
    expect(decide("pr.merge", ctx({ branch: "main", grants: g }))).toMatchObject({ effect: "ask" }); // another action
    // With nobody to ask, a standing allow is what lets the work go on.
    expect(decide("commit.other_branch", ctx({ branch: "main", attended: false, grants: g }))).toMatchObject({ effect: "allow", reason: "standing_permission" });
    // No pattern: every branch.
    const any = [grant({ action: "pr.merge" })];
    for (const b of ["main", "tailzu/x-1", "a/b/c"]) expect(decide("pr.merge", ctx({ branch: b, grants: any })), b).toMatchObject({ effect: "allow" });
    // Another project's grant is not this one's.
    expect(decide("pr.merge", ctx({ branch: "main", grants: [grant({ action: "pr.merge", projectId: "p2" })] }))).toMatchObject({ effect: "ask" });
  });

  it("lets nothing lift a strict ask", () => {
    for (const a of ["push.force", "branch.delete_default", "commit.secret", "repo.visibility"] as const) {
      expect(decide(a, ctx({ branch: "main", grants: [grant({ action: a })] })), a).toMatchObject({ effect: "ask", tier: "ask_strict", faceId: true });
    }
    // An allow for the ordinary commit doesn't cover the secret one.
    expect(decide("commit.secret", ctx({ branch: "main", grants: [grant({ action: "commit.other_branch", branchPattern: "main" })] }))).toMatchObject({ effect: "ask", faceId: true });
  });

  it("lets a deny beat everything except 'never': an allow, a free action, a branch of its own", () => {
    const deny = (o: Record<string, unknown>) => grant({ effect: "deny", ...o });
    expect(decide("commit.other_branch", ctx({ branch: "main", grants: [grant({ action: "commit.other_branch" }), deny({ action: "commit.other_branch", branchPattern: "main" })] })))
      .toEqual({ effect: "deny", tier: "ask", reason: "denied_by_grant", faceId: false, action: "commit.other_branch" });
    expect(decide("branch.create", ctx({ grants: [deny({ action: "branch.create" })] }))).toMatchObject({ effect: "deny", tier: "free", reason: "denied_by_grant" });
    expect(decide("commit.own_branch", ctx({ branch: "tailzu/x-1", ownBranch: true, grants: [deny({ action: "commit.own_branch", branchPattern: "tailzu/*" })] }))).toMatchObject({ effect: "deny", reason: "denied_by_grant" });
    expect(decide("commit.own_branch", ctx({ branch: "tailzu/x-1", ownBranch: true, grants: [deny({ action: "commit.own_branch", branchPattern: "release/*" })] }))).toMatchObject({ effect: "allow" });
    expect(decide("pr.merge", ctx({ branch: "main", attended: false, grants: [deny({ action: "pr.merge" })] }))).toMatchObject({ effect: "deny", reason: "denied_by_grant" }); // not "needs_you"
    expect(decide("repo.delete", ctx({ grants: [deny({ action: "repo.delete" })] }))).toMatchObject({ effect: "deny", reason: "never" });
  });

  it("ignores a grant that has run out", () => {
    const g = [grant({ action: "pr.merge", expiresAt: 5000 })];
    expect(decide("pr.merge", ctx({ branch: "main", grants: g, now: 4999 }))).toMatchObject({ effect: "allow" });
    expect(decide("pr.merge", ctx({ branch: "main", grants: g, now: 5000 }))).toMatchObject({ effect: "ask" });
    expect(decide("pr.merge", ctx({ branch: "main", grants: g, now: 9000 }))).toMatchObject({ effect: "ask" });
    const d = [grant({ action: "pr.merge", effect: "deny", expiresAt: 5000 })];
    expect(decide("pr.merge", ctx({ branch: "main", grants: d, now: 9000 }))).toMatchObject({ effect: "ask" });
  });

  it("wants the 'workflow' scope for a workflow file, and says so before it asks", () => {
    expect(decide("workflow.write", ctx({ branch: "tailzu/x-1", scopes: ["repo", "read:user"] }))).toEqual({ effect: "deny", tier: "ask", reason: "missing_scope", faceId: false, action: "workflow.write" });
    expect(decide("workflow.write", ctx({ branch: "tailzu/x-1", scopes: [] }))).toMatchObject({ reason: "missing_scope" });
    expect(decide("workflow.write", ctx({ branch: "tailzu/x-1", scopes: ["repo", "workflow"] }))).toMatchObject({ effect: "ask", reason: "needs_approval" });
    expect(decide("workflow.write", ctx({ branch: "tailzu/x-1", scopes: ["workflow"], grants: [grant({ action: "workflow.write" })] }))).toMatchObject({ effect: "allow" });
    // A standing allow can't give a token a permission it hasn't got.
    expect(decide("workflow.write", ctx({ branch: "tailzu/x-1", scopes: [], grants: [grant({ action: "workflow.write" })] }))).toMatchObject({ effect: "deny", reason: "missing_scope" });
  });
});

describe("branch patterns", () => {
  it("match a name exactly, or with * (not across a slash), ** (across) and ?", () => {
    const yesNo: Array<[string | undefined, string, boolean]> = [
      [undefined, "anything", true], ["", "anything", true],
      ["main", "main", true], ["main", "main2", false], ["main", "xmain", false], ["main", "Main", false],
      ["release/*", "release/1.0", true], ["release/*", "release/", true], ["release/*", "release/1.0/hotfix", false], ["release/*", "release", false], ["release/*", "prerelease/1", false],
      ["release/**", "release/1.0/hotfix", true], ["**", "a/b/c", true], ["*", "main", true], ["*", "a/b", false],
      ["tailzu/*", "tailzu/fix-1a2b", true], ["feature/?", "feature/a", true], ["feature/?", "feature/ab", false], ["feature/?", "feature//", false],
      ["v1.0", "v1.0", true], ["v1.0", "v1x0", false], ["a+b", "a+b", true], ["a+b", "aab", false], ["(x)", "(x)", true],
    ];
    for (const [pattern, branch, expected] of yesNo) expect(branchMatches(pattern, branch), `${pattern} ~ ${branch}`).toBe(expected);
    // An action with no branch is matched only by a grant with no pattern.
    expect(branchMatches(undefined, undefined)).toBe(true);
    expect(branchMatches("main", undefined)).toBe(false);
  });
});

describe("making a grant (parseGrant)", () => {
  const now = 1_000_000;

  it("takes an action that is free or asks, with a branch pattern, an effect and a time to run out", () => {
    expect(parseGrant({ action: "commit.other_branch", branchPattern: "release/*" }, now)).toEqual({ action: "commit.other_branch", effect: "allow", branchPattern: "release/*" });
    expect(parseGrant({ action: "pr.merge", effect: "deny", expiresAt: now + 1000 }, now)).toEqual({ action: "pr.merge", effect: "deny", expiresAt: now + 1000 });
    expect(parseGrant({ action: "pr.merge", expiresAt: new Date(now + 5000).toISOString() }, now)).toMatchObject({ expiresAt: now + 5000 });
    expect(parseGrant({ action: "repo.init", branchPattern: null, expiresAt: null }, now)).toEqual({ action: "repo.init", effect: "allow" });
    expect(parseGrant({ action: "branch.create", effect: "deny" }, now)).toEqual({ action: "branch.create", effect: "deny" });
  });

  it("will not grant an action that always asks or never happens, allow or deny", () => {
    for (const action of ["push.force", "branch.delete_default", "commit.secret", "repo.visibility", "path.escape", "repo.delete"]) {
      for (const effect of ["allow", "deny", undefined]) {
        expect(() => parseGrant({ action, effect }, now), `${action} ${effect}`).toThrowError(expect.objectContaining({ code: "not_grantable" }));
      }
    }
  });

  it("refuses what isn't a grant: no or unknown action, a bad effect, a bad pattern, a pattern on an action with no branch, a time in the past", () => {
    const bad = (body: unknown) => expect(() => parseGrant(body, now), JSON.stringify(body)).toThrowError(expect.objectContaining({ code: "bad_request" }));
    for (const body of [
      undefined, null, "x", {}, { action: 5 }, { action: "nope" }, { action: "__proto__" }, { action: "toString" },
      { action: "pr.merge", effect: "maybe" }, { action: "pr.merge", effect: 1 },
      { action: "pr.merge", branchPattern: 5 }, { action: "pr.merge", branchPattern: "a b" }, { action: "pr.merge", branchPattern: "a..b" },
      { action: "pr.merge", branchPattern: "/a" }, { action: "pr.merge", branchPattern: "x".repeat(201) }, { action: "pr.merge", branchPattern: "a;b" },
      { action: "repo.init", branchPattern: "main" }, { action: "branch.create", branchPattern: "main" },
      { action: "pr.merge", expiresAt: now }, { action: "pr.merge", expiresAt: now - 1 }, { action: "pr.merge", expiresAt: "soon" }, { action: "pr.merge", expiresAt: {} },
    ]) bad(body);
  });
});

// ------------------------------------------------------------- the secret scan

describe("the secret scan", () => {
  const scan = (path: string, content: string) => scanForSecrets([{ path, content }]);

  it("finds Stripe keys and webhook secrets, model API keys and Google API keys", () => {
    // Built at runtime so this file never holds a token-shaped literal (GitHub push protection).
    const j = (...p: string[]) => p.join("");
    const cases: Array<[string, string]> = [
      [j("sk_", "live_", "4eC39HqLyjWDarjtT1zdp7dc"), "a Stripe key"],
      [j("rk_", "test_", "51HxQ2kLmNoPqRsTuVwXyZ"), "a Stripe key"],
      [j("whsec_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"), "a Stripe webhook secret"],
      [j("sk-", "ant-", "api03-", "Zq8xY7wV6uT5sR4qP3oN2mL1kJ0iH9gF"), "a model API key"],
      [j("sk-", "or-v1-", "0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e"), "a model API key"],
      [j("AI", "za", "SyD3x9Kq2Lm8Np4Rt7Vw1Yz5Bc6Fg0Hj2Kl"), "a Google API key"],
    ];
    for (const [value, kind] of cases) {
      expect(scan("config.ts", `const k = "${value}";`), kind).toEqual([{ path: "config.ts", kinds: [kind] }]);
    }
    expect(scan("a.md", "sk_live_abc and sk-short and AIzaShort")).toEqual([]);
  });

  it("finds an AWS key, GitHub tokens, a private key, a Slack token, a long random value after api_key= or secret=, and .env files", () => {
    const cases: Array<[string, string, string]> = [
      ["aws.txt", `key ${SECRET.aws} here`, "an AWS access key"],
      ["a.md", `token ${SECRET.ghp}`, "a GitHub token"],
      ["b.md", `${SECRET.gho}`, "a GitHub token"],
      ["c.md", `x=${SECRET.ghs};`, "a GitHub token"],
      ["d.md", `${SECRET.pat}`, "a GitHub token"],
      ["id_rsa", SECRET.pem, "a private key"],
      ["k.pem", "-----BEGIN " + "PRIVATE KEY-----\nabc\n", "a private key"],
      ["k2", "-----BEGIN OPENSSH " + "PRIVATE KEY-----\nabc\n", "a private key"],
      ["slack.json", `{"t":"${SECRET.slack}"}`, "a Slack token"],
      ["conf.ini", `api_key = "${SECRET.value}"`, "a secret value"],
      ["conf.yml", `client_secret: ${SECRET.value}`, "a secret value"],
      ["c.json", `{ "apiKey": "${SECRET.value}" }`, "a secret value"],
      ["c.env.ts", `const SECRET=${SECRET.value}`, "a secret value"],
      [".env", "A=1\n", "an .env file"],
      [".env.production", "A=1\n", "an .env file"],
      ["config/.env.local", "A=1\n", "an .env file"],
    ];
    for (const [path, content, kind] of cases) {
      const hits = scan(path, content);
      expect(hits, path).toEqual([{ path, kinds: [kind] }]);
    }
  });

  it("leaves alone what isn't one: the example env files, short or word-like values, stand-ins, references, deleted files", () => {
    for (const [path, content] of [
      [".env.example", "API_KEY=\n"], [".env.sample", "A=1"], [".env.template", "A=1"], ["envelope.md", "x"], ["src/env.ts", "export const env = {};"],
      ["a.ts", "const apiKey = process.env.API_KEY_FOR_THE_APP_SERVER;"], ["a.py", "api_key = os.environ['API_KEY']"],
      ["b.ts", 'const secret = "short";'], ["c.ts", "api_key = 'your-api-key-goes-here-1234567890'"], ["d.ts", 'secret: "this-is-just-some-long-lower-case-words"'],
      ["e.ts", 'token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"'], ["f.md", "Set api_key= to your key."], ["g.md", "AKIA is a prefix; ghp_ too; xox is a family."],
      ["h.md", "password: hunter2 and a_secret_name_without_a_value"], ["i.ts", "const t = 'github_pat_short';"],
    ] as const) {
      expect(scan(path, content), path).toEqual([]);
    }
    // A deletion has no new contents.
    expect(scanForSecrets([{ path: ".env", delete: true }, { path: "k.pem", content: null }])).toEqual([]);
  });

  it("names the files and what kind of thing, in order, each file once, and never the thing itself", () => {
    const hits = scanForSecrets([
      { path: "ok.ts", content: "export const a = 1;" },
      { path: ".env", content: `A=${SECRET.ghp}\nB=${SECRET.aws}\n` },
      { path: "x.pem", content: SECRET.pem },
    ]);
    expect(hits).toEqual([
      { path: ".env", kinds: ["an .env file", "an AWS access key", "a GitHub token"] },
      { path: "x.pem", kinds: ["a private key"] },
    ]);
    const shown = JSON.stringify(hits);
    for (const v of Object.values(SECRET)) expect(shown).not.toContain(v);
    expect(shown).not.toContain("MIIEow");
  });

  it("copes with a file of the largest size and with junk in the list", () => {
    const big = "x".repeat(1024 * 1024);
    expect(scanForSecrets([{ path: "big.txt", content: big }])).toEqual([]);
    expect(scanForSecrets([null, undefined, { path: 5 }, { path: "a", content: 5 }] as never)).toEqual([]);
    expect(isWorkflowPath(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkflowPath(".GitHub/Workflows/ci.yml")).toBe(true);
    expect(isWorkflowPath(".github/workflowsx/a")).toBe(false);
    expect(isWorkflowPath("src/.github/workflows/a")).toBe(false);
  });
});

// =====================================================================
// The same behaviours, on a repo, for both ways of connecting
// =====================================================================

/** Alice's second repo, a second project, through the same kind of link. */
async function second(r: Rig, kind: "app" | "oauth") {
  const repo = r.fake.addRepo(kind === "app" ? 101 : 900, "alice/other", { files: FILES });
  return { repo, project: (await addProject(r.d, "alice", repo.id)).project };
}

/** A branch of the person's own on GitHub, which the bot never made. */
async function theirBranch(r: Rig, repo: ReturnType<Fake["addRepo"]>, name = "feature/x") {
  const ref = { installationId: repo.installationId, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main" };
  await r.github.createBranch({ ...ref, access: repo.installationId === 900 ? r.oauth.access("alice") : undefined }, name);
  r.fake.push(repo, name, { "feature.txt": "the person's work\n" }, "the person's work");
  return name;
}

describe.each(["app", "oauth"] as const)("on a repo, through a %s project", (kind) => {
  // ---------------------------------------------------------- the free tier

  describe("the free tier", () => {
    it("proceeds without asking: read, a branch from any ref, a commit to its own branch, a draft pull request, keeping it current", async () => {
      const r = rig();
      const issued = vi.spyOn(r.approvals, "issue");
      const { project: p, repo } = await project(r, kind);
      const mainHead = r.fake.head(repo, "main")!;

      // A branch from the default branch, from another branch, from a tag, from an annotated tag, and from a commit id.
      const a = await createWorkBranch(r.d, "alice", p.id, "from main");
      expect(a.baseSha).toBe(mainHead);
      r.fake.push(repo, a.branch, { "a.txt": "a" }, "work on a");
      const aHead = r.fake.head(repo, a.branch)!;
      const fromBranch = await createWorkBranch(r.d, "alice", p.id, "from a branch", { from: a.branch });
      expect(fromBranch.baseSha).toBe(aHead);
      expect(r.fake.head(repo, fromBranch.branch)).toBe(aHead);
      r.fake.addTag(repo, "v1", mainHead);
      expect((await createWorkBranch(r.d, "alice", p.id, "from a tag", { from: "v1" })).baseSha).toBe(mainHead);
      r.fake.addTag(repo, "v2", aHead, { annotated: true });
      expect((await createWorkBranch(r.d, "alice", p.id, "from an annotated tag", { from: "v2" })).baseSha).toBe(aHead);
      expect((await createWorkBranch(r.d, "alice", p.id, "from a commit", { from: mainHead })).baseSha).toBe(mainHead);
      expect((await createWorkBranch(r.d, "alice", p.id, "from refs/heads", { from: "refs/heads/main" })).baseSha).toBe(mainHead);
      await expect(createWorkBranch(r.d, "alice", p.id, "nothing", { from: "nope" })).rejects.toMatchObject({ code: "not_found" });
      await expect(createWorkBranch(r.d, "alice", p.id, "nothing", { from: "0".repeat(40) })).rejects.toMatchObject({ code: "not_found" });
      await expect(createWorkBranch(r.d, "alice", p.id, "bad name", { from: "a b" })).rejects.toMatchObject({ code: "bad_request" });

      // Commit to its own branch, open a draft, bring it up to date, look at it: no question.
      const ws = await workspace(r.d, "alice", p.id, a.branch);
      expect(ws.own).toBe(true);
      expect((await ws.tree()).entries.map((e) => e.path).sort()).toEqual(["README.md", "a.txt", "src/a.ts"]);
      const done = await ws.commit([{ path: "b.txt", content: "b" }], "Add b");
      expect(done).toMatchObject({ sha: r.fake.head(repo, a.branch), parentSha: aHead });
      expect(isNeedsApproval(done)).toBe(false);
      expect(await ws.openDraftPr("T", "B")).toMatchObject({ prNumber: 1, existing: false });
      r.fake.push(repo, "main", { "m.txt": "m" }, "main moves");
      expect(await syncBranch(r.d, "alice", p.id, a.branch)).toMatchObject({ status: "merged" });
      expect((await branchDiff(r.d, "alice", p.id, a.branch)).behindBy).toBe(0);
      expect(await prStatus(r.d, "alice", p.id, a.branch)).toMatchObject({ number: 1, draft: true });
      expect(issued).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------- asking

  describe("asking", () => {
    it("asks before committing to the default branch, writes nothing by asking, and does it after a yes", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const head = r.fake.head(repo, "main")!;
      r.fake.calls.length = 0;
      const files = [{ path: "docs/new.md", content: "hello\n" }, { path: "src/a.ts", delete: true }];
      const asked = await commitToBranch(r.d, "alice", p.id, "main", files, "Add docs\n\nAnd drop a.");
      expect(asked).toMatchObject({
        needsApproval: true, action: "commit.other_branch", faceId: false, approvalId: expect.stringMatching(/^[A-Za-z0-9_-]{20,}$/),
        expiresAt: r.fake.clock.t + APPROVAL_TTL_MS,
        summary: {
          project: "alice/app", branch: "main", fileCount: 2, message: "Add docs", at: head,
          files: [{ path: "docs/new.md", change: "write" }, { path: "src/a.ts", change: "delete" }],
          needs: [{ action: "commit.other_branch", label: expect.any(String), faceId: false }],
        },
      });
      // No file contents on the card.
      expect(JSON.stringify(asked)).not.toContain("hello");
      expect(r.fake.writes()).toHaveLength(0);
      expect(r.fake.head(repo, "main")).toBe(head);

      const done = await commitToBranch(r.d, "alice", p.id, "main", files, "Add docs\n\nAnd drop a.", { approvalId: (asked as { approvalId: string }).approvalId });
      expect(done).toMatchObject({ parentSha: head, sha: r.fake.head(repo, "main") });
      expect(r.fake.files(repo, "main")).toEqual({ "README.md": "# app\n", "docs/new.md": "hello\n" });
    });

    it("uses an approval once", async () => {
      const r = rig();
      const { project: p } = await project(r, kind);
      const files = [{ path: "x.txt", content: "x" }];
      const asked = await commitToBranch(r.d, "alice", p.id, "main", files, "m") as { approvalId: string };
      await commitToBranch(r.d, "alice", p.id, "main", files, "m", { approvalId: asked.approvalId });
      await expect(commitToBranch(r.d, "alice", p.id, "main", files, "m", { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "approval_invalid" });
    });

    it("lets an approval go stale when the branch head moves, and then it is a new question", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const files = [{ path: "x.txt", content: "x" }];
      const asked = await commitToBranch(r.d, "alice", p.id, "main", files, "m") as { approvalId: string };
      const moved = r.fake.push(repo, "main", { "someone.txt": "else" }, "someone else pushed");
      r.fake.calls.length = 0;
      await expect(commitToBranch(r.d, "alice", p.id, "main", files, "m", { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "changed_since_approval" });
      expect(r.fake.writes()).toHaveLength(0);
      expect(r.fake.head(repo, "main")).toBe(moved);
      // The approval is used up; look again, and say yes to what is there now.
      await expect(commitToBranch(r.d, "alice", p.id, "main", files, "m", { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "approval_invalid" });
      const done = await yes((o) => commitToBranch(r.d, "alice", p.id, "main", files, "m", o));
      expect(done.parentSha).toBe(moved);
    });

    it("also refuses to commit on a head that moved between the check and the write (the head is passed to the commit)", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const files = [{ path: "x.txt", content: "x" }];
      const asked = await commitToBranch(r.d, "alice", p.id, "main", files, "m") as { approvalId: string };
      // Someone pushes after the server's check and before its commit reads the branch.
      const real = r.fake.fetchFn;
      let armed = true;
      const racing = new GithubApp(
        { slug: "s", clientId: r.fake.appClientId, clientSecret: "x", privateKey: KEYS.privateKeyPem },
        {
          now: () => r.fake.clock.t,
          fetchFn: (async (input: any, init: any) => {
            const res = await real(input, init);
            if (armed && String(input).includes("/git/ref/heads/main") && init?.method === "GET" && r.fake.calls.filter((c) => c.url.pathname.endsWith("/git/ref/heads/main")).length === 2) {
              armed = false;
              r.fake.push(repo, "main", { "late.txt": "x" }, "late");
            }
            return res;
          }) as typeof fetch,
        },
      );
      const moved = r.fake.head(repo, "main");
      const err = await commitToBranch({ ...r.d, github: racing }, "alice", p.id, "main", files, "m", { approvalId: asked.approvalId }).catch((e) => e);
      expect(err).toMatchObject({ code: "changed_since_approval" });
      expect(r.fake.files(repo, "main")).not.toHaveProperty("x.txt");
      expect(r.fake.head(repo, "main")).not.toBe(moved); // the late push is there, and nothing of ours on top of it
    });

    it("is for exactly what was looked at: a yes for one set of files is no yes for another", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const head = r.fake.head(repo, "main");
      const files = [{ path: "x.txt", content: "x" }];
      for (const [f, m] of [
        [[{ path: "x.txt", content: "DIFFERENT" }], "m"], [[{ path: "y.txt", content: "x" }], "m"], [[...files, { path: "z.txt", content: "z" }], "m"], [files, "another message"],
      ] as const) {
        const asked = await commitToBranch(r.d, "alice", p.id, "main", files, "m") as { approvalId: string };
        await expect(commitToBranch(r.d, "alice", p.id, "main", [...f], m, { approvalId: asked.approvalId }), JSON.stringify([f, m])).rejects.toMatchObject({ code: "changed_since_approval" });
        // And it is spent by trying.
        await expect(commitToBranch(r.d, "alice", p.id, "main", files, "m", { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "approval_invalid" });
      }
      expect(r.fake.head(repo, "main")).toBe(head);
    });

    it("keeps an approval to the project, branch and action it was made for, and for ten minutes", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const other = await second(r, kind);
      const dev = await theirBranch(r, repo, "develop");
      await theirBranch(r, other.repo, "develop");
      const files = [{ path: "x.txt", content: "x" }];
      const asked = await commitToBranch(r.d, "alice", p.id, "main", files, "m") as { approvalId: string };
      // Not for another project's main, not for another branch of this one, not for another action.
      await expect(commitToBranch(r.d, "alice", other.project.id, "main", files, "m", { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "approval_invalid" });
      await expect(commitToBranch(r.d, "alice", p.id, dev, files, "m", { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "approval_invalid" });
      await expect(deleteWorkBranch(r.d, "alice", p.id, "main", { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "approval_invalid" });
      await expect(commitToBranch(r.d, "alice", p.id, "main", files, "m", { approvalId: "made-up" })).rejects.toMatchObject({ code: "approval_invalid" });
      // None of that used it up.
      r.fake.clock.t += APPROVAL_TTL_MS - 1000;
      expect(await commitToBranch(r.d, "alice", p.id, "main", files, "m", { approvalId: asked.approvalId })).toMatchObject({ sha: expect.any(String) });
      // And after ten minutes it is too late.
      const late = await commitToBranch(r.d, "alice", p.id, "main", [{ path: "y.txt", content: "y" }], "m") as { approvalId: string };
      r.fake.clock.t += APPROVAL_TTL_MS + 1;
      await expect(commitToBranch(r.d, "alice", p.id, "main", [{ path: "y.txt", content: "y" }], "m", { approvalId: late.approvalId })).rejects.toMatchObject({ code: "approval_expired" });
      expect(r.fake.files(repo, "main")).not.toHaveProperty("y.txt");
    });

    it("asks about everything else too on a branch the bot didn't make: keeping it current, its pull request, deleting it; and not about a draft", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const name = await theirBranch(r, repo);
      // A draft pull request: free, even for a branch that isn't the bot's.
      expect(await openPr(r.d, "alice", p.id, name, "Their work", "B")).toMatchObject({ prNumber: 1 });
      // Keeping it current: a question.
      r.fake.push(repo, "main", { "m.txt": "m" }, "main moves");
      const sync = await syncBranch(r.d, "alice", p.id, name);
      expect(sync).toMatchObject({ needsApproval: true, action: "branch.sync", summary: { branch: name, bringIn: "main" } });
      expect(r.fake.files(repo, name)).not.toHaveProperty("m.txt");
      expect(await syncBranch(r.d, "alice", p.id, name, { approvalId: (sync as { approvalId: string }).approvalId })).toMatchObject({ status: "merged" });
      expect(r.fake.files(repo, name)).toHaveProperty("m.txt");
      // Its pull request: ready, close, merge, each a question; nothing is recorded in the store about a branch that isn't the bot's.
      expect(await markReady(r.d, "alice", p.id, name)).toMatchObject({ needsApproval: true, action: "pr.ready" });
      expect(r.fake.pulls(repo)[0]!.draft).toBe(true);
      expect(await yes((o) => markReady(r.d, "alice", p.id, name, o))).toEqual({ draft: false });
      expect(await closePr(r.d, "alice", p.id, name)).toMatchObject({ needsApproval: true, action: "pr.close" });
      const merge = await mergePr(r.d, "alice", p.id, name);
      expect(merge).toMatchObject({ needsApproval: true, action: "pr.merge", summary: { into: "main" } });
      expect(await mergePr(r.d, "alice", p.id, name, { approvalId: (merge as { approvalId: string }).approvalId })).toMatchObject({ merged: true });
      expect(r.fake.files(repo, "main")).toHaveProperty("feature.txt");
      expect(await r.store.getBranch(p.id, name)).toBeNull();
      // Deleting it: a question.
      expect(await deleteWorkBranch(r.d, "alice", p.id, name)).toMatchObject({ needsApproval: true, action: "branch.delete" });
      expect(r.fake.branches(repo)).toContain(name);
      expect(await yes((o) => deleteWorkBranch(r.d, "alice", p.id, name, o))).toEqual({ state: "deleted" });
      expect(r.fake.branches(repo)).not.toContain(name);
    });
  });

  // ---------------------------------------------------------- standing grants

  describe("standing grants", () => {
    it("skips the ask for the branch a standing allow names, and only that one", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      await theirBranch(r, repo, "develop");
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow", branchPattern: "main" });
      const issued = vi.spyOn(r.approvals, "issue");
      const done = await commitToBranch(r.d, "alice", p.id, "main", [{ path: "x.txt", content: "x" }], "straight to main");
      expect(done).toMatchObject({ sha: r.fake.head(repo, "main") });
      expect(issued).not.toHaveBeenCalled();
      expect(r.fake.files(repo, "main")).toHaveProperty("x.txt");
      // Not for another branch, and not for another action on main.
      expect(await commitToBranch(r.d, "alice", p.id, "develop", [{ path: "y.txt", content: "y" }], "m")).toMatchObject({ needsApproval: true, action: "commit.other_branch" });
      expect(await deleteWorkBranch(r.d, "alice", p.id, "main")).toMatchObject({ needsApproval: true, action: "branch.delete_default", faceId: true });
      // A pattern with a star covers the branches under it.
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow", branchPattern: "dev*" });
      expect(await commitToBranch(r.d, "alice", p.id, "develop", [{ path: "y.txt", content: "y" }], "m")).toMatchObject({ sha: expect.any(String) });
    });

    it("lets a standing allow for a merge, a close, a ready, a delete or a sync skip the question, each for itself", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "grants");
      const ws = await workspace(r.d, "alice", p.id, branch);
      await ws.commit([{ path: "f.txt", content: "f\n" }], "f");
      await ws.openDraftPr("T", "B");
      await r.store.addGrant(p.id, { action: "pr.ready", effect: "allow", branchPattern: "tailzu/*" });
      expect(await markReady(r.d, "alice", p.id, branch)).toEqual({ draft: false });
      expect(await mergePr(r.d, "alice", p.id, branch)).toMatchObject({ needsApproval: true }); // ready was granted, merge was not
      await r.store.addGrant(p.id, { action: "pr.merge", effect: "allow" });
      expect(await mergePr(r.d, "alice", p.id, branch)).toMatchObject({ merged: true, sha: r.fake.head(repo, "main") });
      expect((await r.store.getBranch(p.id, branch))!.state).toBe("merged");
      await r.store.addGrant(p.id, { action: "branch.delete", effect: "allow", branchPattern: "tailzu/*" });
      expect(await deleteWorkBranch(r.d, "alice", p.id, branch)).toEqual({ state: "deleted" });
    });

    it("blocks with a deny, which beats an allow, an own branch and a free action", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "denied");
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow" });
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "deny", branchPattern: "main" });
      r.fake.calls.length = 0;
      const err = await commitToBranch(r.d, "alice", p.id, "main", [{ path: "x.txt", content: "x" }], "m").catch((e) => e);
      expect(err).toBeInstanceOf(PolicyError);
      expect(err).toMatchObject({ code: "policy_denied", info: { action: "commit.other_branch", reason: "denied_by_grant", branch: "main" } });
      expect(err.message).toMatch(/told X0 Bot not to/);
      expect(r.fake.writes()).toHaveLength(0);
      // The allow still covers the rest.
      await theirBranch(r, repo, "develop");
      expect(await commitToBranch(r.d, "alice", p.id, "develop", [{ path: "y.txt", content: "y" }], "m")).toMatchObject({ sha: expect.any(String) });

      // A deny on a branch of its own, and on making branches at all.
      await r.store.addGrant(p.id, { action: "commit.own_branch", effect: "deny", branchPattern: "tailzu/*" });
      await expect(commitToBranch(r.d, "alice", p.id, branch, [{ path: "z.txt", content: "z" }], "m")).rejects.toMatchObject({ code: "policy_denied" });
      await r.store.addGrant(p.id, { action: "branch.create", effect: "deny" });
      await expect(createWorkBranch(r.d, "alice", p.id, "one more")).rejects.toMatchObject({ code: "policy_denied", info: { action: "branch.create" } });
      await r.store.addGrant(p.id, { action: "pr.open_draft", effect: "deny" });
      await expect(openPr(r.d, "alice", p.id, branch, "T", "B")).rejects.toMatchObject({ code: "policy_denied" });
      // And not even attended-ness turns a deny into a question.
      await expect(commitToBranch(r.d, "alice", p.id, "main", [{ path: "x.txt", content: "x" }], "m", { attended: false })).rejects.toMatchObject({ code: "policy_denied" });
    });

    it("can forbid reading too", async () => {
      const r = rig();
      const { project: p } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "reads");
      const ws = await workspace(r.d, "alice", p.id, branch);
      expect((await ws.read("README.md")).text).toBe("# app\n");
      await r.store.addGrant(p.id, { action: "read", effect: "deny", branchPattern: "tailzu/*" });
      await expect(ws.read("README.md")).rejects.toMatchObject({ code: "policy_denied", info: { action: "read" } });
      await expect(ws.tree()).rejects.toMatchObject({ code: "policy_denied" });
      await expect(branchDiff(r.d, "alice", p.id, branch)).rejects.toMatchObject({ code: "policy_denied" });
      expect((await (await workspace(r.d, "alice", p.id, "main")).read("README.md")).text).toBe("# app\n"); // main isn't tailzu/*
    });

    it("ignores a grant that ran out, and a grant of another project", async () => {
      const r = rig();
      const { project: p } = await project(r, kind);
      const other = await second(r, kind);
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow", branchPattern: "main", expiresAt: Date.now() - 1000 });
      await r.store.addGrant(other.project.id, { action: "commit.other_branch", effect: "allow", branchPattern: "main" });
      const files = [{ path: "x.txt", content: "x" }];
      expect(await commitToBranch(r.d, "alice", p.id, "main", files, "m")).toMatchObject({ needsApproval: true });
      expect(await commitToBranch(r.d, "alice", other.project.id, "main", files, "m")).toMatchObject({ sha: expect.any(String) });
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow", branchPattern: "main", expiresAt: Date.now() + 60_000 });
      expect(await commitToBranch(r.d, "alice", p.id, "main", files, "m")).toMatchObject({ sha: expect.any(String) });
    });

    it("cannot be made for an action that always asks: the API refuses it, and a row that got in anyway is ignored", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      for (const action of ["push.force", "branch.delete_default", "commit.secret", "repo.visibility"]) {
        expect(() => parseGrant({ action }), action).toThrowError(expect.objectContaining({ code: "not_grantable" }));
        expect(decide(action as never, { project: p, defaultBranch: "main", attended: true, connection: kind, scopes: [], grants: [] }).faceId).toBe(true);
      }
      // Rows put in the store directly, bypassing the API, change nothing.
      for (const action of ["push.force", "branch.delete_default", "commit.secret"]) await r.store.addGrant(p.id, { action, effect: "allow" });
      const head = r.fake.head(repo, "main")!;
      expect(await commitToBranch(r.d, "alice", p.id, "main", [{ path: ".env", content: "A=1\n" }], "m")).toMatchObject({ needsApproval: true, action: "commit.secret", faceId: true });
      expect(await forceUpdateBranch(r.d, "alice", p.id, "main", head)).toMatchObject({ needsApproval: true, action: "push.force", faceId: true });
      expect(await deleteWorkBranch(r.d, "alice", p.id, "main")).toMatchObject({ needsApproval: true, action: "branch.delete_default", faceId: true });
    });
  });

  // ---------------------------------------------------------- nobody is there

  describe("unattended", () => {
    it("does the free things, and turns what would ask into 'needs_you', with what to show, and nothing written or kept", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "alone", { attended: false });
      const ws = await workspace(r.d, "alice", p.id, branch, { attended: false });
      await ws.commit([{ path: "f.txt", content: "f\n" }], "f");
      await ws.openDraftPr("T", "B");
      await syncBranch(r.d, "alice", p.id, branch, { attended: false });

      const issued = vi.spyOn(r.approvals, "issue");
      r.fake.calls.length = 0;
      const noOne = { attended: false };
      const wsMain = await workspace(r.d, "alice", p.id, "main", { attended: false });
      const tries: Array<[string, () => Promise<unknown>]> = [
        ["commit.other_branch", () => wsMain.commit([{ path: "x.txt", content: "x" }], "m")],
        ["pr.ready", () => markReady(r.d, "alice", p.id, branch, noOne)],
        ["pr.close", () => closePr(r.d, "alice", p.id, branch, noOne)],
        ["branch.delete_default", () => deleteWorkBranch(r.d, "alice", p.id, "main", noOne)],
        ["push.force", () => forceUpdateBranch(r.d, "alice", p.id, "main", r.fake.head(repo, "main")!, noOne)],
        ["commit.secret", () => ws.commit([{ path: "k.pem", content: SECRET.pem }], "m")],
      ];
      for (const [action, run] of tries) {
        const err = await run().catch((e) => e);
        expect(err, action).toBeInstanceOf(PolicyError);
        expect(err, action).toMatchObject({ code: "needs_you", info: { action, reason: "needs_you", faceId: action === "push.force" || action === "branch.delete_default" || action === "commit.secret" } });
        expect(err.info.summary, action).toMatchObject({ project: "alice/app" });
        expect(err.message).toMatch(/needs your OK/);
      }
      expect(issued).not.toHaveBeenCalled();
      expect(r.fake.writes()).toHaveLength(0);
      // A merge and a sync of somebody else's branch are the same.
      const name = await theirBranch(r, repo);
      await expect(syncBranch(r.d, "alice", p.id, name, noOne)).rejects.toMatchObject({ code: "needs_you", info: { action: "branch.sync" } });
    });

    it("goes on with what the person allowed for good", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow", branchPattern: "main" });
      const ws = await workspace(r.d, "alice", p.id, "main", { attended: false });
      expect(await ws.commit([{ path: "x.txt", content: "x" }], "m")).toMatchObject({ sha: r.fake.head(repo, "main") });
    });

    it("says it when an empty repo wants its first README and nobody is there", async () => {
      const r = rig();
      await project(r, kind);
      const repo = r.fake.addRepo(kind === "app" ? 101 : 900, "alice/idea", { empty: true });
      const { project: p } = await addProject(r.d, "alice", repo.id);
      await expect(initEmptyRepo(r.d, "alice", p.id, "Idea", { attended: false })).rejects.toMatchObject({ code: "needs_you", info: { action: "repo.init" } });
      expect(r.fake.commitCount(repo)).toBe(0);
    });
  });

  // ---------------------------------------------------------- secrets

  describe("a secret in a commit", () => {
    const leaky = [
      { path: "config/prod.env.ts", content: `export const k = { api_key: "${SECRET.value}" };\n` },
      { path: "deploy/id_rsa", content: SECRET.pem },
      { path: "README.md", content: "# fine\n" },
    ];

    it("makes it a strict question, with the files named and the Face ID flag, even on a branch of its own", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "leak");
      r.fake.calls.length = 0;
      const asked = await commitToBranch(r.d, "alice", p.id, branch, leaky, "Add config") as any;
      expect(asked).toMatchObject({
        needsApproval: true, action: "commit.secret", faceId: true,
        summary: {
          branch, fileCount: 3,
          flagged: [{ path: "config/prod.env.ts", looksLike: ["a secret value"] }, { path: "deploy/id_rsa", looksLike: ["a private key"] }],
          needs: [{ action: "commit.secret", faceId: true }],
        },
      });
      expect(r.fake.writes()).toHaveLength(0);
      expect(r.fake.files(repo, branch)).not.toHaveProperty("deploy/id_rsa");
      // Yes (with Face ID, on the phone): it is the person's call.
      await commitToBranch(r.d, "alice", p.id, branch, leaky, "Add config", { approvalId: asked.approvalId });
      expect(r.fake.files(repo, branch)).toHaveProperty("deploy/id_rsa");
    });

    it("is one question when it is also a commit to the default branch, for the strictest of them; and no standing allow lifts it", async () => {
      const r = rig();
      const { project: p } = await project(r, kind);
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow", branchPattern: "main" });
      const asked = await commitToBranch(r.d, "alice", p.id, "main", [{ path: ".env", content: "A=1\n" }], "m") as any;
      expect(asked).toMatchObject({ needsApproval: true, action: "commit.secret", faceId: true, summary: { flagged: [{ path: ".env", looksLike: ["an .env file"] }] } });
      // Without the allow: both are asked, once, and the approval is for the strict one.
      const r2 = rig();
      const { project: p2 } = await project(r2, kind);
      const both = await commitToBranch(r2.d, "alice", p2.id, "main", [{ path: ".env", content: "A=1\n" }], "m") as any;
      expect(both).toMatchObject({ action: "commit.secret", faceId: true, summary: { needs: [{ action: "commit.secret" }, { action: "commit.other_branch" }].map((x) => expect.objectContaining(x)) } });
      expect(both.summary.needs).toHaveLength(2);
      const done = await commitToBranch(r2.d, "alice", p2.id, "main", [{ path: ".env", content: "A=1\n" }], "m", { approvalId: both.approvalId });
      expect(done).toMatchObject({ sha: expect.any(String) });
    });

    it("does not flag a commit that only deletes such a file, or an example env file", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      r.fake.push(repo, "main", { ".env": "A=1\n" }, "oops, committed already");
      await r.store.addGrant(p.id, { action: "commit.other_branch", effect: "allow" });
      expect(await commitToBranch(r.d, "alice", p.id, "main", [{ path: ".env", delete: true }, { path: ".env.example", content: "A=\n" }], "Remove .env")).toMatchObject({ sha: expect.any(String) });
    });

    it("never lets the value into a question, an error, a log, the store or the book of approvals", async () => {
      const r = rig();
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "quiet");
      const all = { ghp: SECRET.ghp, aws: SECRET.aws, pem: "MIIEowIBAAKCAQEA0123", value: SECRET.value };
      const files = [
        { path: "a.txt", content: `${all.ghp} and ${all.aws}` }, { path: "b.pem", content: SECRET.pem }, { path: "c.ini", content: `api_key = "${all.value}"` },
      ];
      const seen: string[] = [];
      r.fake.calls.length = 0;
      const asked = await commitToBranch(r.d, "alice", p.id, branch, files, "m") as any;
      seen.push(JSON.stringify(asked));
      // Errors on every road out of the question.
      const errors: unknown[] = [];
      errors.push(await commitToBranch(r.d, "alice", p.id, branch, files, "m", { approvalId: "made-up" }).catch((e) => e));
      errors.push(await commitToBranch(r.d, "alice", p.id, branch, files, "m", { attended: false }).catch((e) => e));
      errors.push(await commitToBranch(r.d, "alice", p.id, branch, [...files, { path: "../escape", content: all.ghp }], "m").catch((e) => e));
      errors.push(await commitToBranch(r.d, "alice", p.id, branch, files, "another message", { approvalId: asked.approvalId }).catch((e) => e)); // changed since
      r.fake.push(repo, branch, { "moved.txt": "x" });
      const again = await commitToBranch(r.d, "alice", p.id, branch, files, "m") as any;
      r.fake.push(repo, branch, { "moved-again.txt": "x" });
      errors.push(await commitToBranch(r.d, "alice", p.id, branch, files, "m", { approvalId: again.approvalId }).catch((e) => e)); // stale
      for (const e of errors) {
        expect(e).toBeInstanceOf(Error);
        seen.push(String((e as Error).message), JSON.stringify(e), JSON.stringify((e as { info?: unknown }).info ?? null));
      }
      // The store, the book, the logs, and every call made to GitHub while it was only asking.
      seen.push(JSON.stringify([await r.store.listBranches(p.id), await r.store.listProjects("alice"), await r.store.listGrants(p.id)]));
      seen.push(JSON.stringify([...((r.approvals as unknown as { items: Map<string, unknown> }).items).values()]));
      seen.push(JSON.stringify(spies.flatMap((s) => s.mock.calls)));
      seen.push(JSON.stringify(r.fake.calls.filter((c) => c.method !== "GET").map((c) => c.body)));
      const text = seen.join("\n");
      for (const [name, v] of Object.entries(all)) expect(text, name).not.toContain(v);
      expect(text).not.toContain(SECRET.value);
      // Asked, not written.
      expect(r.fake.files(repo, branch)).not.toHaveProperty("b.pem");
      expect(spies.every((s) => s.mock.calls.length === 0)).toBe(true);
    });
  });

  // ---------------------------------------------------------- force

  describe("a force-push", () => {
    it("needs a strict approval, every time, and only then is the ref update forced", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "rewrite");
      const ws = await workspace(r.d, "alice", p.id, branch);
      const first = (await ws.commit([{ path: "one.txt", content: "1" }], "one")) as { sha: string; parentSha: string };
      await ws.commit([{ path: "two.txt", content: "2" }], "two");
      const head = r.fake.head(repo, branch)!;

      // The ordinary commits never force.
      const patches = () => r.fake.calls.filter((c) => c.method === "PATCH" && c.url.pathname.includes("/git/refs/heads/"));
      expect(patches().map((c) => c.body.force)).toEqual([false, false]);

      // Rewinding the branch to the first commit throws "two" away: a question, with Face ID, and nothing moves by asking.
      r.fake.calls.length = 0;
      const asked = await forceUpdateBranch(r.d, "alice", p.id, branch, first.sha) as any;
      expect(asked).toMatchObject({ needsApproval: true, action: "push.force", faceId: true, summary: { moveTo: first.sha, from: head, rewritesHistory: true } });
      expect(patches()).toHaveLength(0);
      expect(r.fake.head(repo, branch)).toBe(head);
      // The same call, unforced, is turned down by GitHub: it isn't a fast-forward.
      const ref = { installationId: p.installationId, repoId: repo.id, fullName: repo.fullName, defaultBranch: "main", ...(kind === "oauth" ? { access: r.oauth.access("alice") } : {}) };
      await expect(r.github.updateRef(ref, branch, first.sha)).rejects.toMatchObject({ code: "not_fast_forward" });
      expect(r.fake.head(repo, branch)).toBe(head);

      // A yes to a different place is no yes.
      await expect(forceUpdateBranch(r.d, "alice", p.id, branch, first.parentSha, { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "changed_since_approval" });
      const again = await forceUpdateBranch(r.d, "alice", p.id, branch, first.sha) as any;
      r.fake.calls.length = 0;
      expect(await forceUpdateBranch(r.d, "alice", p.id, branch, first.sha, { approvalId: again.approvalId })).toEqual({ sha: first.sha });
      expect(r.fake.head(repo, branch)).toBe(first.sha);
      expect(patches().map((c) => c.body)).toEqual([{ sha: first.sha, force: true }]);
    });

    it("goes stale when the branch moves, can't be allowed for good, and is refused when nobody is there", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "rewrite");
      const base = r.fake.head(repo, branch)!;
      r.fake.push(repo, branch, { "x.txt": "x" }, "x");
      const asked = await forceUpdateBranch(r.d, "alice", p.id, branch, base) as any;
      const moved = r.fake.push(repo, branch, { "y.txt": "y" }, "someone else");
      await expect(forceUpdateBranch(r.d, "alice", p.id, branch, base, { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "changed_since_approval" });
      expect(r.fake.head(repo, branch)).toBe(moved);
      await expect(forceUpdateBranch(r.d, "alice", p.id, branch, base, { attended: false })).rejects.toMatchObject({ code: "needs_you", info: { action: "push.force", faceId: true } });
      for (const bad of ["main", "", "xyz", base.toUpperCase()]) await expect(forceUpdateBranch(r.d, "alice", p.id, branch, bad)).rejects.toMatchObject({ code: "bad_request" });
      await expect(forceUpdateBranch(r.d, "alice", p.id, "a b", base)).rejects.toMatchObject({ code: "not_found" });
      await expect(forceUpdateBranch(r.d, "bob", p.id, branch, base)).rejects.toMatchObject({ code: "not_found" });
      expect(r.fake.head(repo, branch)).toBe(moved);
    });
  });

  // ---------------------------------------------------------- never

  describe("what never happens", () => {
    it("refuses a path that leaves the repo or goes inside .git, on any branch, with every allow in the world, and asks nothing", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "paths");
      for (const action of ["commit.own_branch", "commit.other_branch", "commit.secret", "path.escape", "workflow.write"]) await r.store.addGrant(p.id, { action, effect: "allow" });
      const issued = vi.spyOn(r.approvals, "issue");
      r.fake.calls.length = 0;
      for (const target of [branch, "main"]) {
        for (const path of ["../x", "a/../../b", "/etc/passwd", ".git/config", "src/.git/hooks/pre-commit", ".GIT/HEAD", "C:\\x", ""]) {
          await expect(commitToBranch(r.d, "alice", p.id, target, [{ path, content: "x" }], "m", { attended: false }), `${target} ${path}`).rejects.toMatchObject({ code: "bad_path" });
          await expect(commitToBranch(r.d, "alice", p.id, target, [{ path: "fine.txt", content: "x" }, { path, content: "x" }], "m"), `${target} ${path}`).rejects.toMatchObject({ code: "bad_path" });
        }
      }
      expect(issued).not.toHaveBeenCalled();
      expect(r.fake.writes()).toHaveLength(0);
      expect(r.fake.head(repo, "main")).toBeDefined();
    });
  });

  // ---------------------------------------------------------- protection

  describe("GitHub's branch protection", () => {
    it("is said plainly as 'protected_branch' for a commit, a delete and a merge, and is not worked round", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const head = r.fake.head(repo, "main")!;
      r.fake.protect(repo, "main");
      // A commit to the protected default branch, after the person said yes.
      const err = await yes((o) => commitToBranch(r.d, "alice", p.id, "main", [{ path: "x.txt", content: "x" }], "m", o)).catch((e) => e);
      expect(err).toMatchObject({ code: "protected_branch" });
      expect(err.message).toMatch(/branch protection/);
      expect(err.message).not.toMatch(/Cannot update this protected ref|422/);
      expect(r.fake.head(repo, "main")).toBe(head);
      expect(r.fake.calls.filter((c) => c.method === "PATCH" && c.body.force === true)).toHaveLength(0);
      // A branch of its own that a rule protects: the free path says the same.
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "ruled");
      r.fake.protect(repo, branch);
      await expect((await workspace(r.d, "alice", p.id, branch)).commit([{ path: "y.txt", content: "y" }], "m")).rejects.toMatchObject({ code: "protected_branch" });
      // Deleting a protected branch.
      await expect(yes((o) => deleteWorkBranch(r.d, "alice", p.id, "main", o))).rejects.toMatchObject({ code: "protected_branch" });
      expect(r.fake.branches(repo)).toContain("main");
      // A force-push to it is no way round: GitHub says the same.
      const asked = await forceUpdateBranch(r.d, "alice", p.id, "main", head) as any;
      await expect(forceUpdateBranch(r.d, "alice", p.id, "main", head, { approvalId: asked.approvalId })).rejects.toMatchObject({ code: "protected_branch" });
    });

    it("is said plainly when a merge is held back by a required check", async () => {
      const r = rig();
      const { project: p, repo } = await project(r, kind);
      const { branch } = await createWorkBranch(r.d, "alice", p.id, "checks");
      const ws = await workspace(r.d, "alice", p.id, branch);
      await ws.commit([{ path: "f.txt", content: "f" }], "f");
      await ws.openDraftPr("T", "B");
      await yes((o) => markReady(r.d, "alice", p.id, branch, o));
      r.fake.protect(repo, "main", { checks: true });
      const err = await yes((o) => mergePr(r.d, "alice", p.id, branch, o)).catch((e) => e);
      expect(err).toMatchObject({ code: "protected_branch" });
      expect(err.message).not.toMatch(/status check|"ci"/);
      expect(r.fake.pulls(repo)[0]).toMatchObject({ state: "open", merged: false });
    });
  });
});

// ------------------------------------------------------------ protection, by what GitHub says

describe("what GitHub says when a branch is protected", () => {
  it("is 'protected_branch' for a protected ref, a required check or review, a pull-request-only rule and a rule violation", () => {
    for (const [status, json] of [
      [422, { message: "Cannot update this protected ref." }],
      [422, { message: "Cannot delete this protected ref." }],
      [403, { message: "Protected branch update failed for refs/heads/main." }],
      [405, { message: 'Required status check "ci" is expected.' }],
      [405, { message: "At least 1 approving review is required by reviewers with write access." }],
      [403, { message: "Changes must be made through a pull request." }],
      [422, { message: "Validation Failed", errors: [{ message: "Repository rule violations found\n\nCannot update this protected ref." }] }],
      [422, { message: "Repository rule violations found", errors: ["Changes must be made through a pull request."] }],
      [403, { message: "remote: error: GH006: Protected branch update failed" }],
      [403, { message: "GH013: Repository rule violations found" }],
    ] as const) {
      expect(isProtectionRefusal(status, json), JSON.stringify(json)).toBe(true);
      const err = githubError(status, json, "the branch main");
      expect(err, JSON.stringify(json)).toMatchObject({ code: "protected_branch" });
      expect(err.message).toContain("the branch main");
      expect(err.message).not.toMatch(/GH00|GH013|status check|approving review|rule violation|Cannot update/);
    }
  });

  it("is not that for the other things GitHub says: a plain no, a not-a-fast-forward, an empty repo, a server error", () => {
    for (const [status, json, code] of [
      [403, { message: "Resource not accessible by integration" }, "forbidden"],
      [422, { message: "Update is not a fast forward" }, "rejected"],
      [422, { message: "Reference already exists" }, "rejected"],
      [404, { message: "Not Found" }, "not_found"],
      [409, { message: "Git Repository is empty." }, "conflict"],
      [500, { message: "protected branch somewhere" }, "failed"],
      [404, { message: "Protected branch" }, "not_found"],
    ] as const) {
      expect(isProtectionRefusal(status, json), `${status} ${json.message}`).toBe(false);
      expect(githubError(status, json, "x").code).toBe(code);
    }
  });

  it("is also what a workflow-file refusal says, in its own words: 'needs_workflow_scope'", () => {
    for (const [status, message] of [
      [403, "refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope"],
      [403, "refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission"],
      [404, "refusing to allow a Personal Access Token to create or update workflow `x` without `workflow` scope"],
    ] as const) {
      const err = githubError(status, { message }, "the branch");
      expect(err.code).toBe("needs_workflow_scope");
      expect(err.message).not.toMatch(/refusing to allow|Personal Access Token/);
    }
  });
});

// ------------------------------------------------------------ a workflow file, with a standing allow

describe("changing a workflow file with a standing permission", () => {
  it("skips the question but never the permission GitHub itself needs", async () => {
    const r = rig();
    await signIn(r, "alice");
    const repo = r.fake.addRepo(900, "alice/app", { files: FILES });
    const { project: p } = await addProject(r.d, "alice", repo.id);
    const { branch } = await createWorkBranch(r.d, "alice", p.id, "ci");
    const ws = await workspace(r.d, "alice", p.id, branch);
    const wf = [{ path: ".github/workflows/ci.yml", content: "name: ci\n" }];
    await r.store.addGrant(p.id, { action: "workflow.write", effect: "allow", branchPattern: "tailzu/*" });
    // No workflow scope on the token: the allow doesn't give it one.
    await expect(ws.commit(wf, "Add CI")).rejects.toMatchObject({ code: "needs_workflow_scope" });
    // With the scope (the person signed in again for it), the allow skips the question.
    const link = (await r.store.getOAuthLink("alice"))!;
    await r.fake.oauthTokens.get("gho_alice_token")!.scopes.push("workflow");
    await r.store.saveOAuthLink("alice", { githubUserId: link.githubUserId, githubLogin: link.githubLogin, tokenEnc: link.tokenEnc!, scope: "repo, read:user, workflow" });
    expect(await ws.commit(wf, "Add CI")).toMatchObject({ sha: expect.any(String) });
    expect(r.fake.files(repo, branch)).toHaveProperty([".github/workflows/ci.yml"]);
  });
});

// ------------------------------------------------------------ where the grants are kept

describe("the store's standing grants", () => {
  const pid = "11111111-1111-4111-8111-111111111111";

  it("keeps them in memory by project: the same grant once, with the new expiry; taken back only from its own project; gone with the project", async () => {
    const store = new MemoryCodeStore(() => 1000);
    const p = await store.createProject("alice", { installationId: 1, repoId: 1, fullName: "a/b", defaultBranch: "main", private: true });
    const q = await store.createProject("alice", { installationId: 1, repoId: 2, fullName: "a/c", defaultBranch: "main", private: true });
    const a = await store.addGrant(p.id, { action: "pr.merge", effect: "allow", branchPattern: "main" });
    expect(a).toEqual({ id: expect.any(String), projectId: p.id, action: "pr.merge", effect: "allow", branchPattern: "main", createdAt: 1000 });
    const again = await store.addGrant(p.id, { action: "pr.merge", effect: "allow", branchPattern: "main", expiresAt: 5000 });
    expect(again).toEqual({ ...a, expiresAt: 5000 });
    expect((await store.addGrant(p.id, { action: "pr.merge", effect: "allow", branchPattern: "main" })).expiresAt).toBeUndefined(); // moved back to "until taken back"
    // Another effect, another pattern, another project: other grants.
    await store.addGrant(p.id, { action: "pr.merge", effect: "deny", branchPattern: "main" });
    await store.addGrant(p.id, { action: "pr.merge", effect: "allow" });
    const other = await store.addGrant(q.id, { action: "pr.merge", effect: "allow", branchPattern: "main" });
    expect(await store.listGrants(p.id)).toHaveLength(3);
    expect(await store.listGrants(q.id)).toEqual([other]);
    expect(await store.deleteGrant(p.id, other.id)).toBe(false); // not this project's
    expect(await store.deleteGrant(q.id, other.id)).toBe(true);
    expect(await store.deleteGrant(q.id, other.id)).toBe(false);
    expect(await store.deleteProject("alice", p.id)).toBe(true);
    expect(await store.listGrants(p.id)).toEqual([]);
  });

  /** A Supabase client that records what is asked of it and answers every query with `answer`. */
  function stub(answer: unknown) {
    const log: Array<[string, unknown[]]> = [];
    const chain = (): unknown => new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answer);
        return (...args: unknown[]) => { log.push([String(prop), args]); return chain(); };
      },
    });
    return { sb: { from: (t: string) => { log.push(["from", [t]]); return chain(); } }, log };
  }

  it("keeps them in Supabase: the empty pattern is every branch, and a row with no time never runs out", async () => {
    const { SupabaseCodeStore } = await import("../src/code/store.js");
    const row = (o: Record<string, unknown>) => ({ id: "g", project_id: pid, action: "pr.merge", branch_pattern: "", effect: "allow", expires_at: null, created_at: "2026-10-26T12:00:00.000Z", ...o });

    const list = stub({ data: [row({}), row({ id: "h", branch_pattern: "release/*", effect: "deny", expires_at: "2026-11-01T00:00:00.000Z" })], error: null });
    const grants = await new SupabaseCodeStore(list.sb as never).listGrants(pid);
    expect(grants).toEqual([
      { id: "g", projectId: pid, action: "pr.merge", effect: "allow", createdAt: Date.parse("2026-10-26T12:00:00.000Z") },
      { id: "h", projectId: pid, action: "pr.merge", effect: "deny", branchPattern: "release/*", expiresAt: Date.parse("2026-11-01T00:00:00.000Z"), createdAt: Date.parse("2026-10-26T12:00:00.000Z") },
    ]);
    expect(list.log.slice(0, 3)).toEqual([["from", ["code_grants"]], ["select", ["*"]], ["eq", ["project_id", pid]]]);
    expect(await new SupabaseCodeStore(stub({ data: null, error: null }).sb as never).listGrants("not-a-uuid")).toEqual([]);

    const add = stub({ data: row({ branch_pattern: "main" }), error: null });
    const made = await new SupabaseCodeStore(add.sb as never).addGrant(pid, { action: "pr.merge", effect: "allow", branchPattern: "main", expiresAt: 5000 });
    expect(made).toMatchObject({ projectId: pid, branchPattern: "main" });
    const upsert = add.log.find(([m]) => m === "upsert")!;
    expect(upsert[1]).toEqual([
      { project_id: pid, action: "pr.merge", branch_pattern: "main", effect: "allow", expires_at: new Date(5000).toISOString() },
      { onConflict: "project_id,action,branch_pattern,effect" },
    ]);
    const bare = stub({ data: row({}), error: null });
    await new SupabaseCodeStore(bare.sb as never).addGrant(pid, { action: "pr.ready", effect: "deny" });
    expect(bare.log.find(([m]) => m === "upsert")![1][0]).toMatchObject({ branch_pattern: "", expires_at: null });

    const del = stub({ data: [{ id: "g" }], error: null });
    const store = new SupabaseCodeStore(del.sb as never);
    expect(await store.deleteGrant(pid, "22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(del.log.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["project_id", pid], ["id", "22222222-2222-4222-8222-222222222222"]]);
    expect(await store.deleteGrant(pid, "nope")).toBe(false);
    expect(await store.deleteGrant("nope", "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(await new SupabaseCodeStore(stub({ data: [], error: null }).sb as never).deleteGrant(pid, "22222222-2222-4222-8222-222222222222")).toBe(false);
    await expect(new SupabaseCodeStore(stub({ data: null, error: { message: "boom" } }).sb as never).listGrants(pid)).rejects.toThrow(/code store: boom/);
  });
});

// ------------------------------------------------------------ the bot's name from the settings

describe("who the bot is, from the settings", () => {
  const saved = { name: process.env.CODE_BOT_NAME, email: process.env.CODE_BOT_EMAIL };
  afterEach(() => {
    for (const [k, v] of [["CODE_BOT_NAME", saved.name], ["CODE_BOT_EMAIL", saved.email]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    resetConfigForTests();
  });

  it("is Blip <blip@x0bot.com> by default and CODE_BOT_NAME and CODE_BOT_EMAIL when they are set", () => {
    delete process.env.CODE_BOT_NAME;
    delete process.env.CODE_BOT_EMAIL;
    resetConfigForTests();
    expect(botFromEnv()).toEqual({ name: "Blip", email: "blip@x0bot.com" });
    process.env.CODE_BOT_NAME = "X0 Bot Bot";
    process.env.CODE_BOT_EMAIL = "98765+tailzu-bot@users.noreply.github.com";
    resetConfigForTests();
    expect(botFromEnv()).toEqual({ name: "X0 Bot Bot", email: "98765+tailzu-bot@users.noreply.github.com" });
    process.env.CODE_BOT_NAME = "";
    process.env.CODE_BOT_EMAIL = "not an email\nBcc: x@y.z";
    resetConfigForTests();
    expect(botFromEnv()).toEqual({ name: "Blip", email: "blip@x0bot.com" });
  });

  it("reaches the commits: the client created from the settings has it as its author", async () => {
    process.env.CODE_BOT_NAME = "X0 Bot Bot";
    process.env.CODE_BOT_EMAIL = "98765+tailzu-bot@users.noreply.github.com";
    resetConfigForTests();
    const { createCode } = await import("../src/code/index.js");
    const fake: Fake = new FakeGithub(KEYS);
    const code = createCode({ store: new MemoryCodeStore(), app: { slug: "s", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem }, oauth: null, webhookSecret: null, fetchFn: fake.fetchFn });
    expect(code.github!.bot).toEqual({ name: "X0 Bot Bot", email: "98765+tailzu-bot@users.noreply.github.com" });
    expect(createCode({ store: new MemoryCodeStore(), app: null, oauth: { clientId: "c", clientSecret: "s" }, fetchFn: fake.fetchFn, bot: { name: "X", email: "x@y.z" } }).github!.bot).toEqual({ name: "X", email: "x@y.z" });
    // Grants are capped per project, as the routes say.
    expect(GRANTS_MAX).toBe(100);
  });
});

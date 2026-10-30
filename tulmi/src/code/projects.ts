/**
 * PROJECTS, WORK BRANCHES, AND THE WORKSPACE THE CODE BOT WILL USE.
 *
 * A PROJECT is one repo a person picked from the repos their linked GitHub
 * installs can see. A WORK BRANCH is where Tailzu does the work for one task:
 * `tailzu/<slug>-<4 hex>`, made from the head of any ref (the default branch,
 * unless told otherwise), recorded here with the first 200 characters of the
 * task and the commit it started from. A recorded branch is one the bot MADE,
 * and that record is what makes it the bot's own: the bot commits to its own
 * branches without asking. It can work on any other branch too, but asks the
 * person first (policy.ts: the tiers, the standing grants, the approvals).
 *
 *   GET  /v1/code/repos                                   listRepos()
 *   POST /v1/code/projects {repoId}                       addProject()
 *   GET  /v1/code/projects                                store.listProjects
 *   POST /v1/code/projects/:id/branches {task, from?}     createWorkBranch()
 *   POST /v1/code/projects/:id/branches/:branch/pr        openPr()
 *
 * Every function takes the person's id and looks things up BY it, so a
 * project that is someone else's is simply not found (404), never "forbidden":
 * it doesn't say it exists.
 *
 * LINKING AN INSTALL IS NOT ACCESS TO ITS REPOS. GitHub lists an install for
 * everyone who can reach any repo in it: an organisation's members, someone
 * invited to a single repo on another person's account. So what a person may
 * use is decided per repo, from the GitHub login kept on their link (link.ts):
 *
 *   - an install of kind "User" whose account IS that login is the person's
 *     own: every repo in it;
 *   - any other install (an organisation, or a personal account that is
 *     someone else's): a repo counts only if GitHub says that login has write
 *     or admin there (github.ts permissionOf), and anything else, a 404 or an
 *     error, is "none";
 *   - a link from before the login was kept can't be told apart from either,
 *     so it counts for nothing and the person is asked to connect again
 *     ("needs_reconnect").
 *
 * The rule is applied when listing (answers are kept ten minutes), when adding
 * a project, and again, asking GitHub afresh, before every write: a branch, a
 * commit, a pull request. A workspace's reads check it too (with what is
 * kept), since access can be taken away after the project was added.
 *
 * ACCESS COMES FIRST, THEN THE POLICY. Whether the person may use the repo at
 * all is settled before anything is asked of policy.ts; a refusal for that is
 * no_access, and it is never turned into a question.
 *
 * Every write here goes through policy.ts gate(), which allows it, answers
 * with a question for the person (`{ needsApproval: true, approvalId, ... }`,
 * and the same call again with `approvalId` does it), or refuses. So the
 * functions that can be asked about return `Gated<...>`: what they did, or
 * the question. Each takes `{ approvalId?, attended? }` last.
 *
 * workspace() is what Xode's agent loop will call (there is no route
 * for it yet): the same checks, then a handle over one branch: tree, read,
 * commit and openDraftPr. The handle can't be pointed at any other branch. It
 * can be pointed at ANY branch of the project, not just one the bot made; a
 * commit to a branch the bot didn't make is a question, and a commit with
 * something that looks like a secret in it, or a workflow file, is a bigger
 * one (policy.ts).
 *
 * A project goes through one of two links (store.ts LinkKind): a GitHub App
 * install ("app"), or the person's own "Sign in with GitHub" ("oauth",
 * oauth.ts). Everything below is the same for both, and so is the policy: the
 * repo's RepoRef names the access (access.ts) and nothing else changes. What
 * differs is only the access rule. A sign-in token reaches ALL of the person's
 * repos, so a repo counts only if the person added it as a project, and a
 * write first asks GitHub afresh whether they can still push to it. When the
 * App reaches the same repo, the App is used.
 *
 * Also here: a link to make a new repo on GitHub (newRepoLink: the person
 * makes it, so Tailzu needs no permission to), the first README of a repo that
 * has no commits (initEmptyRepo; it asks), moving a branch with a force
 * (forceUpdateBranch; it asks every time, with Face ID), and runnerAccess, the
 * repo-scoped token a sandbox will clone with. Keeping a branch current,
 * reading what changed, and the pull request's life (ready, close, the
 * two-step merge, deleting the branch) are in pulls.ts.
 */
import { randomBytes } from "node:crypto";
import { ConnectorError, signState } from "../connectors/state.js";
import type { Person } from "./access.js";
import { COMMIT_FILES_MAX, commitTreeEntries, validBranchName, type CommitFile, type GithubApp, type RepoPermission, type RepoRef, type TreeEntry } from "./github.js";
import type { ApprovalBook } from "./approvals.js";
import type { GithubOAuth } from "./oauth.js";
import {
  assertNotRunnerBranch, checkCommit, commitFingerprint, fingerprintOf, gate, gateFree, guardRead,
  type CommitChecks, type GateOptions, type Gated, type PolicyCtx,
} from "./policy.js";
import type { CodeBranch, CodeInstallation, CodeProject, CodeStore } from "./store.js";

export interface ProjectDeps {
  store: CodeStore;
  github: GithubApp;
  approvals: ApprovalBook;
  /** "Sign in with GitHub" (oauth.ts). Absent: this server has none. */
  oauth?: GithubOAuth | null;
}

/** Projects one person may have. */
export const PROJECTS_MAX = 50;
/** The words of a task that are kept with its branch. */
export const TASK_KEEP = 200;
const SLUG_MAX = 32;
/** Questions about what a login may do that are out to GitHub at once, when listing. */
export const ACCESS_CHECKS_AT_ONCE = 8;

export interface ListedRepo {
  id: number; fullName: string; private: boolean; defaultBranch: string;
  /** The App install it is on; 0 for a repo reached through the person's sign-in. */
  installationId: number;
  /** Present, and "oauth", for a repo reached only through the person's sign-in. */
  source?: "oauth";
}

/**
 * The branch name for a task: its ASCII words in lower case joined by `-`, at
 * most 32 characters. A task with no ASCII word in it (Hindi, say) is "work".
 */
export function branchSlug(task: string): string {
  const slug = (String(task).match(/[A-Za-z0-9]+/g) ?? []).join("-").toLowerCase().slice(0, SLUG_MAX).replace(/-+$/, "");
  return slug || "work";
}

/** "tailzu/<slug>-<4 hex>". */
export const newBranchName = (task: string): string => `tailzu/${branchSlug(task)}-${randomBytes(2).toString("hex")}`;

export const notFound = (what: string) => new ConnectorError("not_found", `I couldn't find ${what}.`);

/** `fn` over `items`, never more than `limit` of them running at once, in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const writes = (p: RepoPermission) => p === "write" || p === "admin";

/** An install on the person's own GitHub account: all of it is theirs. Needs the login kept on the link. */
const isOwn = (link: CodeInstallation) => link.accountType === "User" && link.githubLogin !== null && same(link.accountLogin, link.githubLogin);

const reconnect = () => new ConnectorError("needs_reconnect", "Connect GitHub again so X0 Bot can check what you have access to.");

/**
 * Whether this person may work in a repo of one of their linked installs.
 * `fresh` asks GitHub instead of using an answer kept in the last ten minutes.
 * Throws "needs_reconnect" for a link that has no GitHub login on it.
 */
async function mayUse(d: ProjectDeps, link: CodeInstallation, repo: { repoId: number; fullName: string }, fresh = false): Promise<boolean> {
  if (link.githubLogin === null) throw reconnect();
  if (isOwn(link)) return true;
  return writes(await d.github.permissionOf({ installationId: link.installationId, ...repo }, link.githubLogin, fresh));
}

/**
 * The repos across this person's linked installs that they may use (suspended
 * installs are skipped, archived repos left out, other people's repos in a
 * shared install filtered out: see the top of this file), then those they can
 * push to through their own sign-in, if they have one and the switch is on (a
 * repo the App reaches is listed once, as the App's). An install or a sign-in
 * GitHub can't answer for is skipped too, unless nothing could be asked: then
 * the first failure is the answer. `needsReconnect` names the links made
 * before the GitHub login was kept, whose repos can't be told apart;
 * `needsSignin` says the sign-in token died. Each is there only when it applies.
 */
export async function listRepos(d: ProjectDeps, userId: string): Promise<{ repos: ListedRepo[]; truncated: boolean; needsReconnect?: number[]; needsSignin?: true }> {
  const live = (await d.store.listInstallations(userId)).filter((i) => i.suspendedAt === null);
  const old = live.filter((i) => i.githubLogin === null);
  const installs = live.filter((i) => i.githubLogin !== null);
  const results = await Promise.allSettled(installs.map((i) => d.github.listRepos(i.installationId)));
  const candidates: Array<{ link: CodeInstallation; repo: ListedRepo }> = [];
  let truncated = false;
  let failure: unknown;
  results.forEach((r, n) => {
    if (r.status === "rejected") { failure ??= r.reason; return; }
    truncated ||= r.value.truncated;
    for (const repo of r.value.repos) {
      if (!repo.archived) {
        candidates.push({
          link: installs[n]!,
          repo: { id: repo.id, fullName: repo.fullName, private: repo.private, defaultBranch: repo.defaultBranch, installationId: installs[n]!.installationId },
        });
      }
    }
  });
  const appFailed = installs.length > 0 && failure !== undefined && results.every((r) => r.status === "rejected");
  const allowed = await mapLimit(candidates, ACCESS_CHECKS_AT_ONCE, (c) => mayUse(d, c.link, { repoId: c.repo.id, fullName: c.repo.fullName }));
  const repos = candidates.filter((_, n) => allowed[n]).map((c) => c.repo);

  // The person's own sign-in: what they can push to, minus what the App already gave.
  let needsSignin = false;
  let signinOk = false;
  if (d.oauth) {
    const state = await d.oauth.state(userId);
    if (state === "needs_signin") needsSignin = true;
    if (state === "active") {
      try {
        const mine = await d.oauth.listRepos(userId);
        signinOk = true;
        truncated ||= mine.truncated;
        const have = new Set(repos.map((r) => r.id));
        for (const r of mine.repos) {
          if (!have.has(r.id)) repos.push({ id: r.id, fullName: r.fullName, private: r.private, defaultBranch: r.defaultBranch, installationId: 0, source: "oauth" });
        }
      } catch (err) {
        if (err instanceof ConnectorError && err.code === "needs_signin") needsSignin = true;
        else failure ??= err;
      }
    }
  }
  if ((appFailed || (installs.length === 0 && failure !== undefined)) && !signinOk) throw failure;
  return {
    repos, truncated,
    ...(old.length ? { needsReconnect: old.map((i) => i.installationId) } : {}),
    ...(needsSignin ? { needsSignin: true as const } : {}),
  };
}

/** Makes a repo a project. The same repo twice is the same project. A repo the person may not use is not found. */
export async function addProject(d: ProjectDeps, userId: string, repoId: number): Promise<{ project: CodeProject; created: boolean }> {
  const existing = await d.store.findProjectByRepo(userId, repoId);
  if (existing) {
    if (existing.linkKind === "oauth") {
      // The App may reach the repo now, and the App is the one to use.
      const there = (await listRepos(d, userId)).repos.find((r) => r.id === repoId);
      if (there && there.source !== "oauth") {
        const moved = await d.store.setProjectLink(userId, existing.id, { installationId: there.installationId, linkKind: "app" });
        return { project: moved ?? existing, created: false };
      }
    }
    await assertAccess(d, userId, existing);
    return { project: existing, created: false };
  }
  const listed = await listRepos(d, userId);
  const repo = listed.repos.find((r) => r.id === repoId);
  if (!repo) {
    if (listed.needsReconnect) throw reconnect();
    if (listed.needsSignin) throw new ConnectorError("needs_signin", "Sign in with GitHub again to see your repos.");
    throw notFound("that repo among the ones you gave X0 Bot access to");
  }
  if ((await d.store.listProjects(userId)).length >= PROJECTS_MAX) {
    throw new ConnectorError("too_many", `You have ${PROJECTS_MAX} projects, which is the most. Remove one first.`);
  }
  const project = await d.store.createProject(userId, {
    installationId: repo.installationId, linkKind: repo.source === "oauth" ? "oauth" : "app",
    repoId: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch, private: repo.private,
  });
  return { project, created: true };
}

/** The person's own project, or "not found". */
export async function ownProject(d: ProjectDeps, userId: string, projectId: string): Promise<CodeProject> {
  const p = await d.store.getProject(userId, projectId);
  if (!p) throw notFound("that project");
  return p;
}

/**
 * The project's link still works, and the person may still use the repo. For
 * an App project: the install is still linked and not suspended (GitHub would
 * turn every call down otherwise). For a sign-in project: the sign-in is on
 * and alive and GitHub says they can push. A write passes `fresh`, so access
 * taken away since is felt at once.
 */
export async function assertAccess(d: ProjectDeps, userId: string, p: CodeProject, fresh = false): Promise<void> {
  if (p.linkKind === "oauth") {
    // Through the person's own sign-in: it has to be on and alive, and GitHub has to say they can still push here.
    if (!d.oauth) throw new ConnectorError("oauth_off", "Sign in with GitHub isn't switched on.");
    if (!(await d.oauth.canPush(userId, repoRef(d, userId, p), fresh))) {
      throw new ConnectorError("no_access", "You don't have write access to that repo on GitHub any more, so X0 Bot won't work in it.");
    }
    return;
  }
  const link = await d.store.getInstallation(userId, p.installationId);
  if (!link) throw notFound("that project's GitHub install");
  if (link.suspendedAt !== null) throw new ConnectorError("suspended", "GitHub has suspended X0 Bot's access to this account. Unsuspend it on GitHub first.");
  if (!(await mayUse(d, link, p, fresh))) {
    throw new ConnectorError("no_access", "You don't have write access to that repo on GitHub any more, so X0 Bot won't work in it.");
  }
}

/** The repo as the git calls need it, carrying its access: the person's sign-in for a sign-in project, else none (the App's). */
export const repoRef = (d: ProjectDeps, userId: string, p: CodeProject): RepoRef => ({
  installationId: p.installationId, repoId: p.repoId, fullName: p.fullName, defaultBranch: p.defaultBranch,
  ...(p.linkKind === "oauth" && d.oauth ? { access: d.oauth.access(userId) } : {}),
});

/** A branch Tailzu recorded in this project, or "not found". */
export async function recordedBranch(d: ProjectDeps, project: CodeProject, branch: unknown): Promise<CodeBranch> {
  const rec = typeof branch === "string" && branch ? await d.store.getBranch(project.id, branch) : null;
  if (!rec) throw notFound("that branch in this project");
  return rec;
}

/**
 * A link that opens GitHub's "new repository" page with the name and
 * "private" filled in. The person makes the repo themselves, so Tailzu never
 * needs the Administration permission to. The name is made into what a repo
 * can be called: ASCII words joined by "-", 100 characters at most, "my-project"
 * when none are left.
 */
export function newRepoLink(name: unknown): { url: string; name: string } {
  const slug = (String(typeof name === "string" ? name.slice(0, 500) : "").match(/[A-Za-z0-9]+/g) ?? []).join("-").toLowerCase().slice(0, 100).replace(/-+$/, "") || "my-project";
  return { url: `https://github.com/new?${new URLSearchParams({ name: slug, visibility: "private" })}`, name: slug };
}

/** The signed state's id for "make a repo": `code-newrepo:<private|public>:<name>`. */
const NEW_REPO = "code-newrepo:";
export const isNewRepoState = (id: string): boolean => id.startsWith(NEW_REPO);

/** Making a repo from X0 Bot, step one: GitHub's page that hands back the person's token once, with the name and private-or-public signed into the state. */
export async function beginNewRepo(d: Pick<ProjectDeps, "github">, userId: string, name: unknown, visibility: unknown, now = Date.now()): Promise<{ url: string; name: string }> {
  const n = newRepoLink(name).name;
  return { url: d.github.authorizeUrl(await signState(userId, `${NEW_REPO}${visibility === "public" ? "public" : "private"}:${n}`, now)), name: n };
}

/**
 * Step two: GitHub sent the person back. The repo is made on their own account
 * with their one-moment token, put in their install when it has only some repos,
 * and added here. No `project` when the install can't see it yet.
 */
export async function finishNewRepo(d: ProjectDeps, userId: string, stateId: string, code: string): Promise<{ fullName: string; project?: CodeProject }> {
  const [vis, name = ""] = stateId.slice(NEW_REPO.length).split(":");
  const token = await d.github.exchangeUserCode(code);
  const repo = await d.github.createUserRepo(token, name, vis !== "public");
  const who = await d.github.userProfile(token).catch(() => null);
  const mine = who ? (await d.github.userInstallations(token).catch(() => [])).find((i) => i.accountLogin.toLowerCase() === who.login.toLowerCase()) : undefined;
  if (mine?.repositorySelection === "selected") await d.github.addToInstallation(token, mine.id, repo.id).catch(() => false);
  if (mine) d.github.dropTokens(mine.id);
  const added = await addProject(d, userId, repo.id).catch(() => null);
  return { fullName: repo.fullName, ...(added ? { project: added.project } : {}) };
}

/** What every gate needs of the person and the project. */
export const gateBase = (d: ProjectDeps, userId: string, project: CodeProject) =>
  ({ store: d.store, approvals: d.approvals, userId, project });

/** Whether the bot made this branch: Tailzu recorded it in this project. The default branch is never the bot's own. */
export async function isOwnBranch(d: ProjectDeps, project: CodeProject, branch: string): Promise<boolean> {
  return branch !== project.defaultBranch && (await d.store.getBranch(project.id, branch)) !== null;
}

/**
 * Who a project's work is for on GitHub (id and login), from the link the
 * project goes through: the sign-in's, or the install's. Null when it isn't
 * known (a link from before they were kept), and then no Co-authored-by line
 * is added.
 */
export async function personOf(d: ProjectDeps, userId: string, p: CodeProject): Promise<Person | null> {
  if (p.linkKind === "oauth") {
    const l = await d.store.getOAuthLink(userId);
    return l ? { id: l.githubUserId, login: l.githubLogin } : null;
  }
  const l = await d.store.getInstallation(userId, p.installationId);
  return l && l.githubUserId !== null && l.githubLogin !== null ? { id: l.githubUserId, login: l.githubLogin } : null;
}

/**
 * THE FIRST README OF A REPO WITH NO COMMITS (github.ts initEmptyRepo): one
 * README.md with the project's title, in a repo that has no commits, written
 * by the bot. It is a write to the default branch, so it asks (policy.ts
 * repo.init). A repo with commits is refused ("repo_not_empty") BEFORE any
 * question is asked, however it got here, so this can never add to or replace
 * anything. After it a work branch can be made as usual; before it,
 * createWorkBranch says "repo_empty".
 */
export async function initEmptyRepo(
  d: ProjectDeps, userId: string, projectId: string, title?: unknown, o: GateOptions = {},
): Promise<Gated<{ commitSha: string }>> {
  const project = await ownProject(d, userId, projectId);
  await assertAccess(d, userId, project, true);
  const repo = repoRef(d, userId, project);
  const heading = typeof title === "string" && title.trim() ? title : project.fullName.split("/")[1]!;
  if (!(await d.github.repoIsEmpty(repo))) {
    throw new ConnectorError("repo_not_empty", "This repo already has commits, so X0 Bot won't add a first file to its default branch.");
  }
  const person = await personOf(d, userId, project);
  return gate({
    ...gateBase(d, userId, project), ...o, action: "repo.init", fingerprint: fingerprintOf("init", heading),
    summary: () => ({ readme: heading.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100) }),
    run: async () => ({ commitSha: (await d.github.initEmptyRepo(repo, heading, { person })).sha }),
  });
}

/** What a runner gets: for an App project, a clone address and a token for that one repo; for a sign-in project, a one-time download link and never the token. */
export type RunnerAccess =
  | { kind: "app"; cloneUrl: string; token: string; expiresAt: number }
  | { kind: "oauth"; tarballUrl: string };

/**
 * What a sandbox needs to work on a work branch. There is no route for it yet.
 *
 * App project: the repo's address and a token for THAT REPO ONLY: contents:read
 * for "read", contents:write for "push", nothing else. It is given once and
 * kept nowhere: not in the store, not in the token cache, not in a log.
 *
 * Sign-in project: the person's own token is never given to a runner, to
 * anything. "read" is a short-lived download link for the branch's code (the
 * address GitHub redirects its tarball request to, not followed here); "push"
 * is refused ("use_server_commit"): the runner hands its changes back and the
 * server commits them through commitToBranch, under the same policy as any
 * other commit.
 *
 * The branch has to be one Tailzu recorded; the person has to be allowed in
 * the repo right now (a fresh check, read or push alike, since either is the
 * repo's contents). GitHub can't narrow a token to a branch, so a push token
 * can write anywhere in the repo: keeping a runner to its branch is the
 * runner's job, with branch protection behind it.
 */
export async function runnerAccess(
  d: ProjectDeps, userId: string, projectId: string, branch: string, mode: "read" | "push",
): Promise<RunnerAccess> {
  if (mode !== "read" && mode !== "push") throw new ConnectorError("bad_request", "Say whether the runner reads or pushes.");
  const project = await ownProject(d, userId, projectId);
  const rec = await recordedBranch(d, project, branch);
  if (rec.state === "deleted") throw new ConnectorError("branch_deleted", "That branch has been deleted from GitHub.");
  // No runner ever holds a token that can write: a repo-wide write token can't be fenced to one branch,
  // so it would step round every rule in policy.ts. The runner hands its changes back and the server
  // commits them through the policy, on either connection.
  if (mode === "push") {
    throw new ConnectorError("use_server_commit", "A runner doesn't get push access. Hand the changes back and the server will commit them.");
  }
  await assertAccess(d, userId, project, true);
  const repo = repoRef(d, userId, project);
  if (project.linkKind === "oauth") {
    // Pinned to the commit the branch is at now.
    return { kind: "oauth", tarballUrl: await d.github.tarballUrl(repo, await d.github.branchHead(repo, rec.branch)) };
  }
  const t = await d.github.runnerToken(repo, mode);
  return { kind: "app", cloneUrl: `https://github.com/${project.fullName}.git`, token: t.token, expiresAt: t.expiresAt };
}

/**
 * A work branch for a task: `tailzu/<slug>-<4 hex>`, at the head of `from` (a
 * branch, a tag or a commit id; the default branch when none is given). Making
 * a branch is free: it changes nothing that exists.
 */
export async function createWorkBranch(
  d: ProjectDeps, userId: string, projectId: string, task: unknown, o: GateOptions & { from?: string } = {},
): Promise<{ branch: string; baseSha: string; url: string }> {
  const text = typeof task === "string" ? task.trim() : "";
  if (!text) throw new ConnectorError("bad_request", "Say what the task is.");
  if (o.from !== undefined && !validBranchName(o.from)) throw new ConnectorError("bad_request", "from is a branch, a tag or a commit.");
  const project = await ownProject(d, userId, projectId);
  await assertAccess(d, userId, project, true);
  return gateFree({
    ...gateBase(d, userId, project), attended: o.attended, action: "branch.create",
    summary: () => ({ task: [...text].slice(0, TASK_KEEP).join(""), ...(o.from !== undefined ? { from: o.from } : {}) }),
    run: async () => {
      let made: { branch: string; baseSha: string } | null = null;
      // Four hex digits can collide with a branch from before: ask for another name, a few times.
      for (let attempt = 0; !made; attempt += 1) {
        const branch = newBranchName(text);
        try {
          made = { branch, baseSha: await d.github.createBranch(repoRef(d, userId, project), branch, o.from) };
        } catch (err) {
          if (!(err instanceof ConnectorError && err.code === "branch_exists" && attempt < 3)) throw err;
        }
      }
      await d.store.addBranch({ projectId, branch: made.branch, task: [...text].slice(0, TASK_KEEP).join(""), baseSha: made.baseSha });
      return { ...made, url: `https://github.com/${project.fullName}/tree/${made.branch}` };
    },
  });
}

/**
 * A work branch with a name the caller chose, cut from `from` (a branch or a commit): a helper's branch in a team (code/team), `tailzu/<slug>-p<k>`. Free like any
 * work branch, recorded like one (so the router runs jobs on it and the policy treats it as Tailzu's own). Throws "branch_exists" when the name is taken: the
 * caller asks for another.
 */
export async function createNamedBranch(
  d: ProjectDeps, userId: string, projectId: string, name: string, task: string, o: GateOptions & { from: string },
): Promise<{ branch: string; baseSha: string; url: string }> {
  if (!name.startsWith("tailzu/") || !validBranchName(name)) throw new ConnectorError("bad_request", "A work branch is tailzu/ and a name.");
  if (!validBranchName(o.from)) throw new ConnectorError("bad_request", "from is a branch, a tag or a commit.");
  const project = await ownProject(d, userId, projectId);
  await assertAccess(d, userId, project, true);
  return gateFree({
    ...gateBase(d, userId, project), attended: o.attended, action: "branch.create",
    summary: () => ({ task: [...task].slice(0, TASK_KEEP).join(""), from: o.from, branch: name }),
    run: async () => {
      const baseSha = await d.github.createBranch(repoRef(d, userId, project), name, o.from);
      await d.store.addBranch({ projectId, branch: name, task: [...task].slice(0, TASK_KEEP).join(""), baseSha });
      return { branch: name, baseSha, url: `https://github.com/${project.fullName}/tree/${name}` };
    },
  });
}

export async function listBranches(d: ProjectDeps, userId: string, projectId: string): Promise<CodeBranch[]> {
  await ownProject(d, userId, projectId);
  return d.store.listBranches(projectId);
}

/**
 * A draft PR from a branch of this project into the default branch. Free, on
 * any branch (a draft changes nothing until someone takes it out of draft).
 * When the bot made the branch, its number and link are recorded on it.
 */
export async function openPr(
  d: ProjectDeps, userId: string, projectId: string, branch: string, title: unknown, body: unknown, o: GateOptions = {},
): Promise<{ prNumber: number; prUrl: string; existing: boolean }> {
  const project = await ownProject(d, userId, projectId);
  if (!validBranchName(branch)) throw notFound("that branch in this project");
  const rec = await d.store.getBranch(projectId, branch);
  await assertAccess(d, userId, project, true);
  return gateFree({
    ...gateBase(d, userId, project), attended: o.attended, action: "pr.open_draft", branch, ownBranch: rec !== null,
    summary: () => ({ title: typeof title === "string" ? title.trim().slice(0, 256) : "" }),
    run: async () => {
      const repo = repoRef(d, userId, project);
      // A branch Tailzu made is known to be there; any other has to be looked for, so a name that isn't a branch is "not found".
      if (!rec) await d.github.branchHead(repo, branch);
      const pr = await d.github.openDraftPr(repo, branch, typeof title === "string" ? title : "", typeof body === "string" ? body : "");
      if (rec) await d.store.setBranchPr(projectId, branch, pr.number, pr.url);
      return { prNumber: pr.number, prUrl: pr.url, existing: pr.existing };
    },
  });
}

const firstLine = (s: string, max: number) => [...String(s).split("\n")[0]!.trim()].slice(0, max).join("");

/** What a commit's approval card shows: the files (names, never contents), the message's first line, and what made it a bigger question. */
function commitSummary(files: readonly CommitFile[], message: string, checks: CommitChecks, head?: string): Record<string, unknown> {
  return {
    fileCount: files.length,
    files: files.slice(0, 25).map((f) => ({ path: f.path, change: f.delete === true || f.content === null ? "delete" : "write" })),
    message: firstLine(message, 200),
    ...(head !== undefined ? { at: head } : {}),
    // Which files look like they hold a secret, and what kind of thing: never the thing.
    ...(checks.secrets.length ? { flagged: checks.secrets.map((h) => ({ path: h.path, looksLike: h.kinds })) } : {}),
    ...(checks.workflowPaths.length ? { workflowFiles: checks.workflowPaths } : {}),
  };
}

/**
 * One commit on a branch, by the bot (author: the bot; the person credited in
 * the message). What it takes:
 *
 *   - a branch the bot made, files with nothing in them to worry about:
 *     free, it is done;
 *   - any other branch, the default branch included: a question first
 *     (commit.other_branch), unless the person gave a standing permission;
 *   - a file under .github/workflows: also a question (workflow.write), and
 *     the token (or the App) has to be allowed to change workflows;
 *   - contents that look like a secret (policy.ts scanForSecrets): a strict
 *     question, with Face ID, every time. The approval says which files, never
 *     what was found;
 *   - a path outside the repo or inside .git: never ("bad_path").
 *
 * The approval is for exactly this: this branch at the commit it was at, these
 * files, this message. Anything else, and it is a new question. Throws
 * "branch_moved" if the branch moved on while committing.
 */
export async function commitToBranch(
  d: ProjectDeps, userId: string, projectId: string, branch: string, files: CommitFile[], message: string, o: GateOptions = {},
): Promise<Gated<{ sha: string; parentSha: string }>> {
  return commitCore(d, userId, projectId, branch, files, message, o);
}

/**
 * A MERGE COMMIT on a branch, through the same policy as any commit (prcare: a branch with a conflict with the default branch). Its parents are the
 * branch's head and `mergeParent` (the default branch's head that was merged in); its tree is the head's with `files` laid over it, the merge's result with
 * the conflicts resolved. Never a rebase and never a force: the head is the first parent, so the branch only moves forward. The same questions as a
 * commit: free on a branch the bot made, a question on any other, a bigger one for a workflow file or something that looks like a secret.
 */
export async function mergeCommitToBranch(
  d: ProjectDeps, userId: string, projectId: string, branch: string, files: CommitFile[], message: string, mergeParent: string, o: GateOptions = {},
): Promise<Gated<{ sha: string; parentSha: string }>> {
  return commitCore(d, userId, projectId, branch, files, message, o, mergeParent);
}

async function commitCore(
  d: ProjectDeps, userId: string, projectId: string, branch: string, files: CommitFile[], message: string, o: GateOptions, mergeParent?: string,
): Promise<Gated<{ sha: string; parentSha: string }>> {
  const project = await ownProject(d, userId, projectId);
  if (!validBranchName(branch)) throw notFound("that branch in this project");
  await assertAccess(d, userId, project, true);
  const own = await isOwnBranch(d, project, branch);
  const base = repoRef(d, userId, project);

  const ctx: PolicyCtx = { project, branch, defaultBranch: project.defaultBranch, attended: o.attended !== false, connection: project.linkKind, scopes: [], ownBranch: own };
  // The paths first (a path that leaves the repo is "never", whatever else is true), then the rest of what makes a commit a commit.
  if (!Array.isArray(files) || (!files.length && mergeParent === undefined)) throw new ConnectorError("bad_request", "There is nothing to commit.");
  if (files.length > COMMIT_FILES_MAX) throw new ConnectorError("bad_request", `A commit can have at most ${COMMIT_FILES_MAX} files.`);
  const checks = checkCommit(files, ctx);
  if (files.length) commitTreeEntries(files);
  if (typeof message !== "string" || !message.trim()) throw new ConnectorError("bad_request", "A commit needs a message.");

  // Only a commit that touches a workflow file needs to know what the token may do, and only then does the App's token ask for the Workflows permission.
  let scopes: string[] = [];
  let repo = base;
  if (checks.workflowPaths.length) {
    scopes = await d.github.scopesOf(base);
    if (scopes.includes("workflow")) repo = { ...base, workflows: true };
  }
  const person = await personOf(d, userId, project);

  return gate({
    ...gateBase(d, userId, project), ...o, action: own ? "commit.own_branch" : "commit.other_branch", also: checks.also,
    branch, ownBranch: own, scopes,
    head: () => d.github.branchHead(repo, branch),
    fingerprint: commitFingerprint(files, message, mergeParent),
    summary: (head) => ({ ...commitSummary(files, message, checks, head), ...(mergeParent !== undefined ? { mergesIn: mergeParent } : {}) }),
    run: (approved) => {
      const opts = { person, ...(approved?.headSha !== undefined ? { expectHead: approved.headSha } : {}) };
      return mergeParent === undefined ? d.github.commit(repo, branch, files, message, opts) : d.github.mergeCommit(repo, branch, files, message, mergeParent, opts);
    },
  });
}

/**
 * Moves a branch to a commit even if that throws commits away: a force-push,
 * the one way the bot can rewrite history. It always asks, with Face ID, and
 * no standing permission lifts that (policy.ts push.force). The approval is for
 * this branch at the commit it is at now, moving to exactly `sha`. Nothing
 * else uses `force`.
 */
export async function forceUpdateBranch(
  d: ProjectDeps, userId: string, projectId: string, branch: string, sha: string, o: GateOptions = {},
): Promise<Gated<{ sha: string }>> {
  const project = await ownProject(d, userId, projectId);
  if (!validBranchName(branch)) throw notFound("that branch in this project");
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) throw new ConnectorError("bad_request", "That isn't a commit.");
  assertNotRunnerBranch(branch);
  await assertAccess(d, userId, project, true);
  const repo = repoRef(d, userId, project);
  return gate({
    ...gateBase(d, userId, project), ...o, action: "push.force", branch, ownBranch: await isOwnBranch(d, project, branch),
    head: () => d.github.branchHead(repo, branch), fingerprint: fingerprintOf("force", sha),
    summary: (head) => ({ moveTo: sha, ...(head !== undefined ? { from: head } : {}), rewritesHistory: true }),
    run: async () => { await d.github.updateRef(repo, branch, sha, { force: true }); return { sha }; },
  });
}

/** The handle Xode has over one branch. */
export interface Workspace {
  readonly project: CodeProject;
  readonly branch: string;
  /** Whether the bot made this branch (so it commits here without asking). */
  readonly own: boolean;
  /** Every file and folder on the branch. */
  tree(): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  /** One file's text (1 MB at most, text only). */
  read(path: string): Promise<{ path: string; size: number; text: string }>;
  /** One commit on the branch (commitToBranch): done, or a question; pass the `approvalId` it gave to say yes. Throws "branch_moved" if the branch has moved on since it was read. */
  commit(files: CommitFile[], message: string, c?: { approvalId?: string }): Promise<Gated<{ sha: string; parentSha: string }>>;
  /** A merge commit with two parents (the branch's head and `mergeParent`), through the same policy as commit. Never a rebase, never a force. */
  mergeCommit(files: CommitFile[], message: string, mergeParent: string, c?: { approvalId?: string }): Promise<Gated<{ sha: string; parentSha: string }>>;
  /** A draft PR into the default branch (the open one, if there already is). */
  openDraftPr(title: string, body: string): Promise<{ prNumber: number; prUrl: string; existing: boolean }>;
}

/**
 * The workspace for a branch of a person's project: the project must be
 * theirs, the install live and the repo still one they may use. Throws "not
 * found" for anything else, with the same words whichever it was. The branch
 * can be any branch, not only one the bot made: reading is free, and what
 * writing there takes is in commitToBranch. Each verb checks again when it is
 * used: a commit and a pull request ask GitHub afresh, a read goes by what was
 * kept (ten minutes). `attended: false` is for a run nobody is watching: what
 * would ask is refused as "needs_you" instead.
 */
export async function workspace(d: ProjectDeps, userId: string, projectId: string, branch: string, o: { attended?: boolean } = {}): Promise<Workspace> {
  const project = await ownProject(d, userId, projectId);
  if (!validBranchName(branch)) throw notFound("that branch in this project");
  await assertAccess(d, userId, project);
  const repo = repoRef(d, userId, project);
  const own = await isOwnBranch(d, project, branch);
  return {
    project, branch, own,
    tree: async () => { await assertAccess(d, userId, project); await guardRead(d.store, project, branch); return d.github.tree(repo, branch); },
    read: async (path) => { await assertAccess(d, userId, project); await guardRead(d.store, project, branch); return d.github.readFile(repo, branch, path); },
    commit: (files, message, c = {}) => commitToBranch(d, userId, projectId, branch, files, message, { attended: o.attended, approvalId: c.approvalId }),
    mergeCommit: (files, message, mergeParent, c = {}) => mergeCommitToBranch(d, userId, projectId, branch, files, message, mergeParent, { attended: o.attended, approvalId: c.approvalId }),
    openDraftPr: (title, body) => openPr(d, userId, projectId, branch, title, body, { attended: o.attended }),
  };
}

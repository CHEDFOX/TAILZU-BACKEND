/**
 * PROJECTS, WORK BRANCHES, AND THE WORKSPACE THE CODE BOT WILL USE.
 *
 * A PROJECT is one repo a person picked from the repos their linked GitHub
 * installs can see. A WORK BRANCH is where Tailzu does the work for one task:
 * `tailzu/<slug>-<4 hex>`, made from the default branch's head, recorded here
 * with the first 200 characters of the task and the commit it started from.
 * Tailzu never writes anywhere else (github.ts assertWorkBranch).
 *
 *   GET  /v1/code/repos                                   listRepos()
 *   POST /v1/code/projects {repoId}                       addProject()
 *   GET  /v1/code/projects                                store.listProjects
 *   POST /v1/code/projects/:id/branches {task}            createWorkBranch()
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
 * workspace() is what the Code bot's agent loop will call (there is no route
 * for it yet): the same checks, then a handle with four verbs over one work
 * branch: tree, read, commit and openDraftPr. The handle can't be pointed at
 * any other branch, and the GitHub calls under it check the branch again.
 *
 * A project goes through one of two links (store.ts LinkKind): a GitHub App
 * install ("app"), or the person's own "Sign in with GitHub" ("oauth",
 * oauth.ts). Everything below is the same for both, and so are the guards in
 * github.ts and pulls.ts: the repo's RepoRef names the access (access.ts) and
 * nothing else changes. What differs is only the access rule. A sign-in token
 * reaches ALL of the person's repos, so a repo counts only if the person
 * added it as a project, and a write first asks GitHub afresh whether they can
 * still push to it. When the App reaches the same repo, the App is used.
 *
 * Also here: a link to make a new repo on GitHub (newRepoLink: the person
 * makes it, so Tailzu needs no permission to), the first README of a repo that
 * has no commits (initEmptyRepo, one of exactly two writes to a default
 * branch), and runnerAccess, the repo-scoped token a sandbox will clone with.
 * Keeping a branch current, reading what changed, and the pull request's life
 * (ready, close, the two-step merge, deleting the branch) are in pulls.ts.
 */
import { randomBytes } from "node:crypto";
import { ConnectorError } from "../connectors/oauth.js";
import { assertWorkBranch, type CommitFile, type GithubApp, type RepoPermission, type RepoRef, type TreeEntry } from "./github.js";
import type { ApprovalBook } from "./approvals.js";
import type { GithubOAuth } from "./oauth.js";
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

const reconnect = () => new ConnectorError("needs_reconnect", "Connect GitHub again so Tailzu can check what you have access to.");

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
    throw notFound("that repo among the ones you gave Tailzu access to");
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
      throw new ConnectorError("no_access", "You don't have write access to that repo on GitHub any more, so Tailzu won't work in it.");
    }
    return;
  }
  const link = await d.store.getInstallation(userId, p.installationId);
  if (!link) throw notFound("that project's GitHub install");
  if (link.suspendedAt !== null) throw new ConnectorError("suspended", "GitHub has suspended Tailzu's access to this account. Unsuspend it on GitHub first.");
  if (!(await mayUse(d, link, p, fresh))) {
    throw new ConnectorError("no_access", "You don't have write access to that repo on GitHub any more, so Tailzu won't work in it.");
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

/**
 * THE FIRST OF TWO WRITES TO A DEFAULT BRANCH (github.ts initEmptyRepo): one
 * README.md with the project's title, in a repo that has no commits. A repo
 * with commits is refused ("repo_not_empty"), however it got here, so this
 * can never add to or replace anything. After it a work branch can be made as
 * usual; before it, createWorkBranch says "repo_empty".
 */
export async function initEmptyRepo(d: ProjectDeps, userId: string, projectId: string, title?: unknown): Promise<{ commitSha: string }> {
  const project = await ownProject(d, userId, projectId);
  await assertAccess(d, userId, project, true);
  const heading = typeof title === "string" && title.trim() ? title : project.fullName.split("/")[1]!;
  return { commitSha: (await d.github.initEmptyRepo(repoRef(d, userId, project), heading)).sha };
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
 * server commits them through the workspace, under the same guards as any other
 * commit.
 *
 * The branch has to be one Tailzu recorded; the person has to be allowed in
 * the repo right now (a fresh check, read or push alike, since either is the
 * repo's contents).
 */
export async function runnerAccess(
  d: ProjectDeps, userId: string, projectId: string, branch: string, mode: "read" | "push",
): Promise<RunnerAccess> {
  if (mode !== "read" && mode !== "push") throw new ConnectorError("bad_request", "Say whether the runner reads or pushes.");
  const project = await ownProject(d, userId, projectId);
  const rec = await recordedBranch(d, project, branch);
  assertWorkBranch(rec.branch, project.defaultBranch);
  if (rec.state === "deleted") throw new ConnectorError("branch_deleted", "That branch has been deleted from GitHub.");
  if (project.linkKind === "oauth" && mode === "push") {
    throw new ConnectorError("use_server_commit", "A runner doesn't get push access to a repo reached through your own sign-in. Hand the changes back and the server will commit them.");
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

/** A work branch for a task, from the default branch's head. */
export async function createWorkBranch(d: ProjectDeps, userId: string, projectId: string, task: unknown): Promise<{ branch: string; baseSha: string; url: string }> {
  const text = typeof task === "string" ? task.trim() : "";
  if (!text) throw new ConnectorError("bad_request", "Say what the task is.");
  const project = await ownProject(d, userId, projectId);
  await assertAccess(d, userId, project, true);
  let made: { branch: string; baseSha: string } | null = null;
  // Four hex digits can collide with a branch from before: ask for another name, a few times.
  for (let attempt = 0; !made; attempt += 1) {
    const branch = newBranchName(text);
    try {
      made = { branch, baseSha: await d.github.createBranch(repoRef(d, userId, project), branch) };
    } catch (err) {
      if (!(err instanceof ConnectorError && err.code === "branch_exists" && attempt < 3)) throw err;
    }
  }
  await d.store.addBranch({ projectId, branch: made.branch, task: [...text].slice(0, TASK_KEEP).join(""), baseSha: made.baseSha });
  return { ...made, url: `https://github.com/${project.fullName}/tree/${made.branch}` };
}

export async function listBranches(d: ProjectDeps, userId: string, projectId: string): Promise<CodeBranch[]> {
  await ownProject(d, userId, projectId);
  return d.store.listBranches(projectId);
}

/** A draft PR from a branch Tailzu made in this project; its number and link are recorded on the branch. */
export async function openPr(
  d: ProjectDeps, userId: string, projectId: string, branch: string, title: unknown, body: unknown,
): Promise<{ prNumber: number; prUrl: string; existing: boolean }> {
  const project = await ownProject(d, userId, projectId);
  if (!(await d.store.getBranch(projectId, branch))) throw notFound("that branch in this project");
  await assertAccess(d, userId, project, true);
  const pr = await d.github.openDraftPr(repoRef(d, userId, project), branch, typeof title === "string" ? title : "", typeof body === "string" ? body : "");
  await d.store.setBranchPr(projectId, branch, pr.number, pr.url);
  return { prNumber: pr.number, prUrl: pr.url, existing: pr.existing };
}

/** The four verbs the Code bot has over one work branch. */
export interface Workspace {
  readonly project: CodeProject;
  readonly branch: string;
  /** Every file and folder on the branch. */
  tree(): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  /** One file's text (1 MB at most, text only). */
  read(path: string): Promise<{ path: string; size: number; text: string }>;
  /** One commit on the branch. Throws "branch_moved" if the branch has moved on since it was read. */
  commit(files: CommitFile[], message: string): Promise<{ sha: string; parentSha: string }>;
  /** A draft PR into the default branch (the open one, if there already is). */
  openDraftPr(title: string, body: string): Promise<{ prNumber: number; prUrl: string; existing: boolean }>;
}

/**
 * The workspace for a person's work branch: the project must be theirs, the
 * branch one Tailzu recorded in it, the install live and the repo still one
 * they may use. Throws "not found" for anything else, with the same words
 * whichever it was. Each verb checks again when it is used: a commit and a
 * pull request ask GitHub afresh, a read goes by what was kept (ten minutes).
 */
export async function workspace(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<Workspace> {
  const project = await ownProject(d, userId, projectId);
  if (typeof branch !== "string" || !(await d.store.getBranch(projectId, branch))) throw notFound("that branch in this project");
  await assertAccess(d, userId, project);
  const repo = repoRef(d, userId, project);
  return {
    project, branch,
    tree: async () => { await assertAccess(d, userId, project); return d.github.tree(repo, branch); },
    read: async (path) => { await assertAccess(d, userId, project); return d.github.readFile(repo, branch, path); },
    commit: async (files, message) => { await assertAccess(d, userId, project, true); return d.github.commit(repo, branch, files, message); },
    openDraftPr: (title, body) => openPr(d, userId, projectId, branch, title, body),
  };
}

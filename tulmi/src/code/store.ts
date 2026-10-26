/**
 * WHERE THE CODE BOT'S GITHUB LINKS, PROJECTS AND WORK BRANCHES ARE KEPT.
 *
 * Three tables (supabase/migrations/0020_code_github.sql), behind one
 * interface so everything above it runs against the in-memory twin in tests
 * and local runs, as connectors/store.ts does. Written with the service key:
 * the tables' policies only let a person READ their own rows.
 *
 *   code_installations  a person's link to a GitHub App install: whose it is,
 *                       the account it is on, which repos it can see
 *                       ("all" or "selected"), when GitHub suspended it, and
 *                       WHO THE PERSON IS ON GITHUB (id and login), read at the
 *                       moment of linking. GitHub lists an install for anyone
 *                       who can reach any repo in it, so being linked is not
 *                       access to every repo: projects.ts asks GitHub what
 *                       this login may do in each repo, and this is the login
 *   code_projects       a repo the person picked to work on
 *   code_branches       the work branches Tailzu made in a project, the words
 *                       of the task they were made for (200 characters), the
 *                       commit they started from, the draft PR once open, and
 *                       where the branch is in its life (state), when the last
 *                       review came in
 *
 *   code_oauth_links    the other way to connect, "Sign in with GitHub" (oauth.ts):
 *                       who the person is on GitHub, the scopes the token has,
 *                       and the token itself, ENCRYPTED (crypto.ts). The only
 *                       place a GitHub token is kept at all. A project records
 *                       which kind of link it uses (link_kind)
 *
 * What is NOT kept, on the App's side: any GitHub token. The person's own
 * token is used once, in the callback, and dropped; an installation token is
 * minted when it is needed and lives in the server's memory for under an hour
 * (github.ts). On the sign-in side the token is kept, encrypted, because it
 * is the only credential there is; it never leaves this file in the clear, is
 * never in a reply, and is revoked at GitHub when the link goes.
 *
 * Two kinds of write are not one person's: GitHub's webhook (webhook.ts) says
 * an installation was deleted or suspended, or that repos were taken off it,
 * and that is true for everyone who linked it, so those act across people.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

export interface CodeInstallation {
  userId: string;
  /** GitHub's id for the install. */
  installationId: number;
  /** The account it is on: the person's own login, or the organisation's. */
  accountLogin: string;
  /** "User" or "Organization", as GitHub says it. */
  accountType: string;
  repositorySelection: "all" | "selected";
  /** Epoch ms when GitHub suspended it, or null. */
  suspendedAt: number | null;
  /**
   * The person's own GitHub id and login, from when they linked it. Null on a
   * link made before these were kept: it has to be made again (projects.ts).
   */
  githubUserId: number | null;
  githubLogin: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewCodeInstallation {
  installationId: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: "all" | "selected";
  /** Left as it is when undefined. */
  suspendedAt?: number | null;
  /** Left as it is when undefined (a look at the install again has no GitHub token of the person's to read them with). */
  githubUserId?: number | null;
  githubLogin?: string | null;
}

/** Which link a project goes through: a GitHub App install, or the person's own "Sign in with GitHub". */
export type LinkKind = "app" | "oauth";

export interface CodeProject {
  id: string;
  userId: string;
  /** The App install it is on. 0 for an "oauth" project, which is on no install. */
  installationId: number;
  linkKind: LinkKind;
  repoId: number;
  /** "owner/name". */
  fullName: string;
  defaultBranch: string;
  private: boolean;
  createdAt: number;
}

export type NewCodeProject = Omit<CodeProject, "id" | "userId" | "createdAt" | "linkKind"> & { linkKind?: LinkKind };

/** "Sign in with GitHub": one per person. */
export interface CodeOAuthLink {
  userId: string;
  githubUserId: number;
  githubLogin: string;
  /** The token, encrypted (crypto.ts encrypt). Null once it has been revoked or found dead: the person has to sign in again. */
  tokenEnc: string | null;
  /** The scopes GitHub says the token has, as it said them ("repo, read:user"). */
  scope: string;
  status: "active" | "needs_signin";
  /** Epoch ms the token was last used (to the hour), or null. A token unused for 30 days is revoked. */
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewCodeOAuthLink { githubUserId: number; githubLogin: string; tokenEnc: string; scope: string }

/**
 * Where a work branch is in its life. `conflict`: merging the default branch
 * into it hit a conflict, which Tailzu never resolves. `merged` and `closed`
 * follow its pull request. `deleted`: the branch is gone from GitHub and the
 * record stays.
 */
export type BranchState = "active" | "pr_open" | "conflict" | "merged" | "closed" | "deleted";

export interface CodeBranch {
  projectId: string;
  /** "tailzu/<slug>-<4 hex>". */
  branch: string;
  /** What the person asked for, the first 200 characters. */
  task: string;
  /** The default branch's head when the branch was made. */
  baseSha: string;
  prNumber: number | null;
  prUrl: string | null;
  state: BranchState;
  /** Epoch ms of the last review GitHub told us about (pull_request_review), or null. */
  lastReviewAt: number | null;
  createdAt: number;
}

export type NewCodeBranch = Pick<CodeBranch, "projectId" | "branch" | "task" | "baseSha">;

/** Thrown when this caller has no account row for links to belong to (a static token, the dev user). */
export class CodeNeedsAccount extends Error {
  constructor() { super("Sign in to connect GitHub."); }
}

export interface CodeStore {
  /** Creates the link or updates the account it is on. Keeps `suspendedAt` unless one is given. */
  upsertInstallation(userId: string, i: NewCodeInstallation): Promise<CodeInstallation>;
  getInstallation(userId: string, installationId: number): Promise<CodeInstallation | null>;
  /** This person's links, oldest first. */
  listInstallations(userId: string): Promise<CodeInstallation[]>;
  /** Forgets this person's link and their projects on it. Returns whether there was a link. */
  removeInstallation(userId: string, installationId: number): Promise<boolean>;
  /** GitHub says the install is gone: every person's link to it, and their projects on it. Returns how many links went. */
  removeInstallationForAll(installationId: number): Promise<number>;
  /** GitHub suspended (a time) or unsuspended (null) the install. Returns how many links it touched. */
  setSuspended(installationId: number, at: number | null): Promise<number>;
  /** Projects on repos that were taken off the install, for everyone. Returns how many went. */
  removeReposForAll(installationId: number, repoIds: number[]): Promise<number>;

  /** This person's projects, oldest first. */
  listProjects(userId: string): Promise<CodeProject[]>;
  getProject(userId: string, id: string): Promise<CodeProject | null>;
  findProjectByRepo(userId: string, repoId: number): Promise<CodeProject | null>;
  /** The existing project when this person already has the repo (the table's unique (user_id, repo_id)). */
  createProject(userId: string, p: NewCodeProject): Promise<CodeProject>;
  /** Returns whether it was theirs to delete. Its branches go with it. */
  deleteProject(userId: string, id: string): Promise<boolean>;
  /** Moves a project to another link (the App, once it reaches a repo that sign-in reached first). */
  setProjectLink(userId: string, id: string, link: { installationId: number; linkKind: LinkKind }): Promise<CodeProject | null>;

  getOAuthLink(userId: string): Promise<CodeOAuthLink | null>;
  /** Makes or replaces the person's sign-in link: active, with this token. */
  saveOAuthLink(userId: string, l: NewCodeOAuthLink): Promise<CodeOAuthLink>;
  /** Sets the status; `dropToken` forgets the token with it. Returns null when there is no link. */
  setOAuthStatus(userId: string, status: "active" | "needs_signin", o?: { dropToken?: boolean }): Promise<CodeOAuthLink | null>;
  touchOAuthLink(userId: string, at: number): Promise<void>;
  /** Forgets the link and the person's projects that go through it. Returns whether there was a link. */
  deleteOAuthLink(userId: string): Promise<boolean>;
  /** Links that still hold a token and were last used (or made) before `before`: the ones to revoke. Oldest first. */
  listOAuthLinksIdleBefore(before: number, limit: number): Promise<CodeOAuthLink[]>;
  /** Every link that still holds a token (the kill switch's list), after the given user id, in order. */
  listOAuthLinksWithToken(after: string | null, limit: number): Promise<CodeOAuthLink[]>;

  /**
   * Branches are keyed by project and carry no owner: the caller has already
   * shown the project is the person's (getProject), as projects.ts does first.
   */
  addBranch(b: NewCodeBranch): Promise<CodeBranch>;
  getBranch(projectId: string, branch: string): Promise<CodeBranch | null>;
  /** Newest first. */
  listBranches(projectId: string): Promise<CodeBranch[]>;
  /** Records the PR, and the branch is `pr_open`. */
  setBranchPr(projectId: string, branch: string, prNumber: number, prUrl: string): Promise<CodeBranch | null>;
  setBranchState(projectId: string, branch: string, state: BranchState): Promise<CodeBranch | null>;
  /**
   * GitHub's webhook names a repo and a branch, not a person: this changes
   * that branch in every project on the repo. A `deleted` branch keeps its
   * state, and `onlyIn` (when given) limits which current states may change.
   * Returns how many branches it touched.
   */
  updateBranchesByHead(
    repoId: number, branch: string, patch: { state?: BranchState; lastReviewAt?: number }, o?: { onlyIn?: BranchState[] },
  ): Promise<number>;
}

// -------------------------------------------------------------------- memory

export class MemoryCodeStore implements CodeStore {
  private installs = new Map<string, CodeInstallation>();
  private projects = new Map<string, CodeProject>();
  private branches = new Map<string, CodeBranch>();
  private oauth = new Map<string, CodeOAuthLink>();

  /** `now` is for tests that move the clock (the 30-day expiry of a sign-in token). */
  constructor(private readonly now: () => number = Date.now) {}

  async upsertInstallation(userId: string, i: NewCodeInstallation) {
    const key = `${userId}|${i.installationId}`;
    const now = Date.now();
    const cur = this.installs.get(key);
    const next: CodeInstallation = {
      userId, installationId: i.installationId, accountLogin: i.accountLogin, accountType: i.accountType,
      repositorySelection: i.repositorySelection,
      suspendedAt: i.suspendedAt !== undefined ? i.suspendedAt : cur?.suspendedAt ?? null,
      githubUserId: i.githubUserId !== undefined ? i.githubUserId : cur?.githubUserId ?? null,
      githubLogin: i.githubLogin !== undefined ? i.githubLogin : cur?.githubLogin ?? null,
      createdAt: cur?.createdAt ?? now, updatedAt: now,
    };
    this.installs.set(key, next);
    return { ...next };
  }
  async getInstallation(userId: string, installationId: number) {
    const i = this.installs.get(`${userId}|${installationId}`);
    return i ? { ...i } : null;
  }
  async listInstallations(userId: string) {
    return [...this.installs.values()].filter((i) => i.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt).map((i) => ({ ...i }));
  }
  async removeInstallation(userId: string, installationId: number) {
    const had = this.installs.delete(`${userId}|${installationId}`);
    for (const p of [...this.projects.values()]) {
      if (p.userId === userId && p.installationId === installationId) this.dropProject(p.id);
    }
    return had;
  }
  async removeInstallationForAll(installationId: number) {
    let links = 0;
    for (const [key, i] of [...this.installs]) {
      if (i.installationId === installationId) { this.installs.delete(key); links += 1; }
    }
    for (const p of [...this.projects.values()]) if (p.installationId === installationId) this.dropProject(p.id);
    return links;
  }
  async setSuspended(installationId: number, at: number | null) {
    let n = 0;
    for (const i of this.installs.values()) {
      if (i.installationId === installationId) { Object.assign(i, { suspendedAt: at, updatedAt: Date.now() }); n += 1; }
    }
    return n;
  }
  async removeReposForAll(installationId: number, repoIds: number[]) {
    let n = 0;
    for (const p of [...this.projects.values()]) {
      if (p.installationId === installationId && repoIds.includes(p.repoId)) { this.dropProject(p.id); n += 1; }
    }
    return n;
  }

  private dropProject(id: string) {
    this.projects.delete(id);
    // on delete cascade
    for (const [key, b] of [...this.branches]) if (b.projectId === id) this.branches.delete(key);
  }

  async listProjects(userId: string) {
    return [...this.projects.values()].filter((p) => p.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt).map((p) => ({ ...p }));
  }
  async getProject(userId: string, id: string) {
    const p = this.projects.get(id);
    return p && p.userId === userId ? { ...p } : null;
  }
  async findProjectByRepo(userId: string, repoId: number) {
    const p = [...this.projects.values()].find((x) => x.userId === userId && x.repoId === repoId);
    return p ? { ...p } : null;
  }
  async createProject(userId: string, n: NewCodeProject) {
    const dupe = await this.findProjectByRepo(userId, n.repoId);
    if (dupe) return dupe;
    const p: CodeProject = { id: randomUUID(), userId, ...n, linkKind: n.linkKind ?? "app", createdAt: Date.now() };
    this.projects.set(p.id, p);
    return { ...p };
  }
  async deleteProject(userId: string, id: string) {
    if (this.projects.get(id)?.userId !== userId) return false;
    this.dropProject(id);
    return true;
  }

  async setProjectLink(userId: string, id: string, link: { installationId: number; linkKind: LinkKind }) {
    const p = this.projects.get(id);
    if (!p || p.userId !== userId) return null;
    Object.assign(p, link);
    return { ...p };
  }

  async getOAuthLink(userId: string) {
    const l = this.oauth.get(userId);
    return l ? { ...l } : null;
  }
  async saveOAuthLink(userId: string, n: NewCodeOAuthLink) {
    const now = this.now();
    const cur = this.oauth.get(userId);
    const l: CodeOAuthLink = { userId, ...n, status: "active", lastUsedAt: null, createdAt: cur?.createdAt ?? now, updatedAt: now };
    this.oauth.set(userId, l);
    return { ...l };
  }
  async setOAuthStatus(userId: string, status: "active" | "needs_signin", o: { dropToken?: boolean } = {}) {
    const l = this.oauth.get(userId);
    if (!l) return null;
    Object.assign(l, { status, ...(o.dropToken ? { tokenEnc: null } : {}), updatedAt: this.now() });
    return { ...l };
  }
  async touchOAuthLink(userId: string, at: number) {
    const l = this.oauth.get(userId);
    if (l) l.lastUsedAt = at;
  }
  async deleteOAuthLink(userId: string) {
    const had = this.oauth.delete(userId);
    for (const p of [...this.projects.values()]) if (p.userId === userId && p.linkKind === "oauth") this.dropProject(p.id);
    return had;
  }
  async listOAuthLinksIdleBefore(before: number, limit: number) {
    return [...this.oauth.values()].filter((l) => l.tokenEnc !== null && (l.lastUsedAt ?? l.createdAt) < before)
      .sort((a, b) => (a.lastUsedAt ?? a.createdAt) - (b.lastUsedAt ?? b.createdAt)).slice(0, limit).map((l) => ({ ...l }));
  }
  async listOAuthLinksWithToken(after: string | null, limit: number) {
    return [...this.oauth.values()].filter((l) => l.tokenEnc !== null && (after === null || l.userId > after))
      .sort((a, b) => (a.userId < b.userId ? -1 : 1)).slice(0, limit).map((l) => ({ ...l }));
  }

  async addBranch(n: NewCodeBranch) {
    const b: CodeBranch = { ...n, prNumber: null, prUrl: null, state: "active", lastReviewAt: null, createdAt: Date.now() };
    this.branches.set(`${b.projectId}|${b.branch}`, b);
    return { ...b };
  }
  async getBranch(projectId: string, branch: string) {
    const b = this.branches.get(`${projectId}|${branch}`);
    return b ? { ...b } : null;
  }
  async listBranches(projectId: string) {
    // Reversed first, so two made in the same millisecond still list the later one first.
    return [...this.branches.values()].reverse().filter((b) => b.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt).map((b) => ({ ...b }));
  }
  async setBranchPr(projectId: string, branch: string, prNumber: number, prUrl: string) {
    const b = this.branches.get(`${projectId}|${branch}`);
    if (!b) return null;
    Object.assign(b, { prNumber, prUrl, state: "pr_open" });
    return { ...b };
  }
  async setBranchState(projectId: string, branch: string, state: BranchState) {
    const b = this.branches.get(`${projectId}|${branch}`);
    if (!b) return null;
    b.state = state;
    return { ...b };
  }
  async updateBranchesByHead(repoId: number, branch: string, patch: { state?: BranchState; lastReviewAt?: number }, o: { onlyIn?: BranchState[] } = {}) {
    const projects = new Set([...this.projects.values()].filter((p) => p.repoId === repoId).map((p) => p.id));
    let n = 0;
    for (const b of this.branches.values()) {
      if (b.branch !== branch || !projects.has(b.projectId)) continue;
      if (patch.state !== undefined && (b.state === "deleted" || (o.onlyIn && !o.onlyIn.includes(b.state)))) continue;
      if (patch.state !== undefined) b.state = patch.state;
      if (patch.lastReviewAt !== undefined) b.lastReviewAt = patch.lastReviewAt;
      n += 1;
    }
    return n;
  }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: unknown): number | null => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

interface InstallRow {
  user_id: string; installation_id: number; account_login: string; account_type: string;
  repository_selection: "all" | "selected"; suspended_at: string | null; github_user_id: number | null;
  github_login: string | null; created_at: string; updated_at: string;
}
interface ProjectRow {
  id: string; user_id: string; installation_id: number; link_kind: LinkKind | null; repo_id: number; full_name: string;
  default_branch: string; private: boolean; created_at: string;
}
interface OAuthRow {
  user_id: string; github_user_id: number; github_login: string; token_enc: string | null; scope: string;
  status: "active" | "needs_signin"; last_used_at: string | null; created_at: string; updated_at: string;
}
interface BranchRow {
  project_id: string; branch: string; task: string; base_sha: string; pr_number: number | null; pr_url: string | null;
  state: BranchState | null; last_review_at: string | null; created_at: string;
}

const installOf = (r: InstallRow): CodeInstallation => ({
  userId: r.user_id, installationId: Number(r.installation_id), accountLogin: r.account_login, accountType: r.account_type,
  repositorySelection: r.repository_selection, suspendedAt: ms(r.suspended_at),
  githubUserId: r.github_user_id === null || r.github_user_id === undefined ? null : Number(r.github_user_id),
  githubLogin: r.github_login ?? null,
  createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
});
const oauthOf = (r: OAuthRow): CodeOAuthLink => ({
  userId: r.user_id, githubUserId: Number(r.github_user_id), githubLogin: r.github_login, tokenEnc: r.token_enc ?? null, scope: r.scope ?? "",
  status: r.status, lastUsedAt: ms(r.last_used_at), createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
});
const projectOf = (r: ProjectRow): CodeProject => ({
  id: r.id, userId: r.user_id, installationId: Number(r.installation_id), linkKind: r.link_kind ?? "app", repoId: Number(r.repo_id), fullName: r.full_name,
  defaultBranch: r.default_branch, private: r.private, createdAt: ms(r.created_at) ?? 0,
});
const branchOf = (r: BranchRow): CodeBranch => ({
  projectId: r.project_id, branch: r.branch, task: r.task, baseSha: r.base_sha,
  prNumber: r.pr_number ?? null, prUrl: r.pr_url ?? null, state: r.state ?? "active", lastReviewAt: ms(r.last_review_at),
  createdAt: ms(r.created_at) ?? 0,
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code store: ${res.error.message}`);
  return res.data;
}

export class SupabaseCodeStore implements CodeStore {
  constructor(private readonly sb: SupabaseClient) {}

  private who(userId: string): string {
    if (!UUID.test(userId)) throw new CodeNeedsAccount();
    return userId;
  }

  async upsertInstallation(userId: string, i: NewCodeInstallation) {
    const row: Record<string, unknown> = {
      user_id: this.who(userId), installation_id: i.installationId, account_login: i.accountLogin,
      account_type: i.accountType, repository_selection: i.repositorySelection, updated_at: iso(Date.now()),
    };
    if (i.suspendedAt !== undefined) row.suspended_at = i.suspendedAt === null ? null : iso(i.suspendedAt);
    if (i.githubUserId !== undefined) row.github_user_id = i.githubUserId;
    if (i.githubLogin !== undefined) row.github_login = i.githubLogin;
    const r = ok(await this.sb.from("code_installations").upsert(row, { onConflict: "user_id,installation_id" })
      .select("*").single<InstallRow>());
    return installOf(r!);
  }
  async getInstallation(userId: string, installationId: number) {
    const r = ok(await this.sb.from("code_installations").select("*")
      .eq("user_id", this.who(userId)).eq("installation_id", installationId).maybeSingle<InstallRow>());
    return r ? installOf(r) : null;
  }
  async listInstallations(userId: string) {
    const rows = ok(await this.sb.from("code_installations").select("*").eq("user_id", this.who(userId))
      .order("created_at", { ascending: true }).returns<InstallRow[]>());
    return (rows ?? []).map(installOf);
  }
  async removeInstallation(userId: string, installationId: number) {
    const who = this.who(userId);
    ok(await this.sb.from("code_projects").delete().eq("user_id", who).eq("installation_id", installationId));
    const gone = ok(await this.sb.from("code_installations").delete()
      .eq("user_id", who).eq("installation_id", installationId).select("installation_id").returns<Array<{ installation_id: number }>>());
    return (gone ?? []).length > 0;
  }
  async removeInstallationForAll(installationId: number) {
    ok(await this.sb.from("code_projects").delete().eq("installation_id", installationId));
    const gone = ok(await this.sb.from("code_installations").delete()
      .eq("installation_id", installationId).select("user_id").returns<Array<{ user_id: string }>>());
    return (gone ?? []).length;
  }
  async setSuspended(installationId: number, at: number | null) {
    const rows = ok(await this.sb.from("code_installations")
      .update({ suspended_at: at === null ? null : iso(at), updated_at: iso(Date.now()) })
      .eq("installation_id", installationId).select("user_id").returns<Array<{ user_id: string }>>());
    return (rows ?? []).length;
  }
  async removeReposForAll(installationId: number, repoIds: number[]) {
    if (!repoIds.length) return 0;
    const rows = ok(await this.sb.from("code_projects").delete()
      .eq("installation_id", installationId).in("repo_id", repoIds).select("id").returns<Array<{ id: string }>>());
    return (rows ?? []).length;
  }

  async listProjects(userId: string) {
    const rows = ok(await this.sb.from("code_projects").select("*").eq("user_id", this.who(userId))
      .order("created_at", { ascending: true }).returns<ProjectRow[]>());
    return (rows ?? []).map(projectOf);
  }
  async getProject(userId: string, id: string) {
    if (!UUID.test(id)) return null;
    const r = ok(await this.sb.from("code_projects").select("*").eq("user_id", this.who(userId)).eq("id", id).maybeSingle<ProjectRow>());
    return r ? projectOf(r) : null;
  }
  async findProjectByRepo(userId: string, repoId: number) {
    const r = ok(await this.sb.from("code_projects").select("*")
      .eq("user_id", this.who(userId)).eq("repo_id", repoId).maybeSingle<ProjectRow>());
    return r ? projectOf(r) : null;
  }
  async createProject(userId: string, n: NewCodeProject) {
    const who = this.who(userId);
    // Two taps at once: the table's unique (user_id, repo_id) keeps one, and both get it.
    ok(await this.sb.from("code_projects").upsert({
      user_id: who, installation_id: n.installationId, link_kind: n.linkKind ?? "app", repo_id: n.repoId, full_name: n.fullName,
      default_branch: n.defaultBranch, private: n.private,
    }, { onConflict: "user_id,repo_id", ignoreDuplicates: true }));
    return (await this.findProjectByRepo(who, n.repoId))!;
  }
  async deleteProject(userId: string, id: string) {
    if (!UUID.test(id)) return false;
    const rows = ok(await this.sb.from("code_projects").delete()
      .eq("user_id", this.who(userId)).eq("id", id).select("id").returns<Array<{ id: string }>>());
    return (rows ?? []).length > 0;
  }

  async setProjectLink(userId: string, id: string, link: { installationId: number; linkKind: LinkKind }) {
    if (!UUID.test(id)) return null;
    const r = ok(await this.sb.from("code_projects").update({ installation_id: link.installationId, link_kind: link.linkKind })
      .eq("user_id", this.who(userId)).eq("id", id).select("*").maybeSingle<ProjectRow>());
    return r ? projectOf(r) : null;
  }

  async getOAuthLink(userId: string) {
    const r = ok(await this.sb.from("code_oauth_links").select("*").eq("user_id", this.who(userId)).maybeSingle<OAuthRow>());
    return r ? oauthOf(r) : null;
  }
  async saveOAuthLink(userId: string, n: NewCodeOAuthLink) {
    const r = ok(await this.sb.from("code_oauth_links").upsert({
      user_id: this.who(userId), github_user_id: n.githubUserId, github_login: n.githubLogin, token_enc: n.tokenEnc, scope: n.scope,
      status: "active", last_used_at: null, updated_at: iso(Date.now()),
    }, { onConflict: "user_id" }).select("*").single<OAuthRow>());
    return oauthOf(r!);
  }
  async setOAuthStatus(userId: string, status: "active" | "needs_signin", o: { dropToken?: boolean } = {}) {
    const row: Record<string, unknown> = { status, updated_at: iso(Date.now()) };
    if (o.dropToken) row.token_enc = null;
    const r = ok(await this.sb.from("code_oauth_links").update(row).eq("user_id", this.who(userId)).select("*").maybeSingle<OAuthRow>());
    return r ? oauthOf(r) : null;
  }
  async touchOAuthLink(userId: string, at: number) {
    ok(await this.sb.from("code_oauth_links").update({ last_used_at: iso(at) }).eq("user_id", this.who(userId)));
  }
  async deleteOAuthLink(userId: string) {
    const who = this.who(userId);
    ok(await this.sb.from("code_projects").delete().eq("user_id", who).eq("link_kind", "oauth"));
    const gone = ok(await this.sb.from("code_oauth_links").delete().eq("user_id", who).select("user_id").returns<Array<{ user_id: string }>>());
    return (gone ?? []).length > 0;
  }
  async listOAuthLinksIdleBefore(before: number, limit: number) {
    // The oldest by last use, or by creation when never used: two reads, merged, since the column to compare is one of two.
    const b = iso(before);
    const [used, never] = await Promise.all([
      this.sb.from("code_oauth_links").select("*").not("token_enc", "is", null).lt("last_used_at", b).order("last_used_at").limit(limit).returns<OAuthRow[]>(),
      this.sb.from("code_oauth_links").select("*").not("token_enc", "is", null).is("last_used_at", null).lt("created_at", b).order("created_at").limit(limit).returns<OAuthRow[]>(),
    ]);
    return [...(ok(used) ?? []), ...(ok(never) ?? [])].map(oauthOf)
      .sort((x, y) => (x.lastUsedAt ?? x.createdAt) - (y.lastUsedAt ?? y.createdAt)).slice(0, limit);
  }
  async listOAuthLinksWithToken(after: string | null, limit: number) {
    let q = this.sb.from("code_oauth_links").select("*").not("token_enc", "is", null).order("user_id").limit(limit);
    if (after !== null) q = q.gt("user_id", after);
    return (ok(await q.returns<OAuthRow[]>()) ?? []).map(oauthOf);
  }

  async addBranch(n: NewCodeBranch) {
    const r = ok(await this.sb.from("code_branches").insert({
      project_id: n.projectId, branch: n.branch, task: n.task, base_sha: n.baseSha,
    }).select("*").single<BranchRow>());
    return branchOf(r!);
  }
  async getBranch(projectId: string, branch: string) {
    if (!UUID.test(projectId)) return null;
    const r = ok(await this.sb.from("code_branches").select("*").eq("project_id", projectId).eq("branch", branch).maybeSingle<BranchRow>());
    return r ? branchOf(r) : null;
  }
  async listBranches(projectId: string) {
    if (!UUID.test(projectId)) return [];
    const rows = ok(await this.sb.from("code_branches").select("*").eq("project_id", projectId)
      .order("created_at", { ascending: false }).returns<BranchRow[]>());
    return (rows ?? []).map(branchOf);
  }
  async setBranchPr(projectId: string, branch: string, prNumber: number, prUrl: string) {
    if (!UUID.test(projectId)) return null;
    const r = ok(await this.sb.from("code_branches").update({ pr_number: prNumber, pr_url: prUrl, state: "pr_open" })
      .eq("project_id", projectId).eq("branch", branch).select("*").maybeSingle<BranchRow>());
    return r ? branchOf(r) : null;
  }
  async setBranchState(projectId: string, branch: string, state: BranchState) {
    if (!UUID.test(projectId)) return null;
    const r = ok(await this.sb.from("code_branches").update({ state })
      .eq("project_id", projectId).eq("branch", branch).select("*").maybeSingle<BranchRow>());
    return r ? branchOf(r) : null;
  }
  async updateBranchesByHead(repoId: number, branch: string, patch: { state?: BranchState; lastReviewAt?: number }, o: { onlyIn?: BranchState[] } = {}) {
    const projects = ok(await this.sb.from("code_projects").select("id").eq("repo_id", repoId).returns<Array<{ id: string }>>());
    const ids = (projects ?? []).map((p) => p.id);
    if (!ids.length) return 0;
    const row: Record<string, unknown> = {};
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.lastReviewAt !== undefined) row.last_review_at = iso(patch.lastReviewAt);
    if (!Object.keys(row).length) return 0;
    let q = this.sb.from("code_branches").update(row).in("project_id", ids).eq("branch", branch);
    if (patch.state !== undefined) {
      q = q.neq("state", "deleted");
      if (o.onlyIn) q = q.in("state", o.onlyIn);
    }
    const rows = ok(await q.select("project_id").returns<Array<{ project_id: string }>>());
    return (rows ?? []).length;
  }
}

// ------------------------------------------------------------------ the one

let current: CodeStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function codeStore(): CodeStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseCodeStore(sb) : new MemoryCodeStore();
  }
  return current;
}

export function resetCodeStoreForTests(): void { current = null; }

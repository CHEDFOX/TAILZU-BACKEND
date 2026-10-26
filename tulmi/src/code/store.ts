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
 *                       commit they started from, and the draft PR once open
 *
 * What is NOT kept: any GitHub token. The person's own token is used once, in
 * the callback, and dropped; an installation token is minted when it is needed
 * and lives in the server's memory for under an hour (github.ts).
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

export interface CodeProject {
  id: string;
  userId: string;
  installationId: number;
  repoId: number;
  /** "owner/name". */
  fullName: string;
  defaultBranch: string;
  private: boolean;
  createdAt: number;
}

export type NewCodeProject = Omit<CodeProject, "id" | "userId" | "createdAt">;

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

  /**
   * Branches are keyed by project and carry no owner: the caller has already
   * shown the project is the person's (getProject), as projects.ts does first.
   */
  addBranch(b: NewCodeBranch): Promise<CodeBranch>;
  getBranch(projectId: string, branch: string): Promise<CodeBranch | null>;
  /** Newest first. */
  listBranches(projectId: string): Promise<CodeBranch[]>;
  setBranchPr(projectId: string, branch: string, prNumber: number, prUrl: string): Promise<CodeBranch | null>;
}

// -------------------------------------------------------------------- memory

export class MemoryCodeStore implements CodeStore {
  private installs = new Map<string, CodeInstallation>();
  private projects = new Map<string, CodeProject>();
  private branches = new Map<string, CodeBranch>();

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
    const p: CodeProject = { id: randomUUID(), userId, ...n, createdAt: Date.now() };
    this.projects.set(p.id, p);
    return { ...p };
  }
  async deleteProject(userId: string, id: string) {
    if (this.projects.get(id)?.userId !== userId) return false;
    this.dropProject(id);
    return true;
  }

  async addBranch(n: NewCodeBranch) {
    const b: CodeBranch = { ...n, prNumber: null, prUrl: null, createdAt: Date.now() };
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
    Object.assign(b, { prNumber, prUrl });
    return { ...b };
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
  id: string; user_id: string; installation_id: number; repo_id: number; full_name: string;
  default_branch: string; private: boolean; created_at: string;
}
interface BranchRow {
  project_id: string; branch: string; task: string; base_sha: string; pr_number: number | null; pr_url: string | null; created_at: string;
}

const installOf = (r: InstallRow): CodeInstallation => ({
  userId: r.user_id, installationId: Number(r.installation_id), accountLogin: r.account_login, accountType: r.account_type,
  repositorySelection: r.repository_selection, suspendedAt: ms(r.suspended_at),
  githubUserId: r.github_user_id === null || r.github_user_id === undefined ? null : Number(r.github_user_id),
  githubLogin: r.github_login ?? null,
  createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
});
const projectOf = (r: ProjectRow): CodeProject => ({
  id: r.id, userId: r.user_id, installationId: Number(r.installation_id), repoId: Number(r.repo_id), fullName: r.full_name,
  defaultBranch: r.default_branch, private: r.private, createdAt: ms(r.created_at) ?? 0,
});
const branchOf = (r: BranchRow): CodeBranch => ({
  projectId: r.project_id, branch: r.branch, task: r.task, baseSha: r.base_sha,
  prNumber: r.pr_number ?? null, prUrl: r.pr_url ?? null, createdAt: ms(r.created_at) ?? 0,
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
      user_id: who, installation_id: n.installationId, repo_id: n.repoId, full_name: n.fullName,
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
    const r = ok(await this.sb.from("code_branches").update({ pr_number: prNumber, pr_url: prUrl })
      .eq("project_id", projectId).eq("branch", branch).select("*").maybeSingle<BranchRow>());
    return r ? branchOf(r) : null;
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

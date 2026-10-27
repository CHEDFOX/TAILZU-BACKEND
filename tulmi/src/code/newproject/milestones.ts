/**
 * MILESTONES: EACH ONE ITS OWN BRANCH AND ITS OWN DRAFT PULL REQUEST, WITH THE CHECKLIST AND THE WORK LOG IN IT, AND A PREVIEW LINK IF THERE IS ONE.
 *
 * PLAN.md (planDoc.ts) cuts a new project into milestones, M0 (scaffold, CI, a preview)
 * to the last. Each is a unit a person can look at and say yes or no to:
 *
 *   branch   `tailzu/m<k>-<slug>`: m0-scaffold-ci-and-preview. A branch Tailzu makes is its own
 *            (code/projects.ts), so it commits to it freely; the policy still guards every
 *            other branch and every workflow file.
 *   PR       a DRAFT pull request into the default branch, whose description is the milestone's
 *            acceptance checklist (`- [ ]` lines), its checks, and the work log (work/worklog.ts),
 *            rewritten as the work goes on. Nothing merges without the person's yes.
 *   preview  the link a host (Vercel, Netlify, Cloudflare Pages) made for the pull request. It is
 *            looked for in the PR commit's deployments, then its statuses, then its check runs;
 *            a host's own dashboard link is not a preview (only a *.vercel.app, *.netlify.app,
 *            *.pages.dev or *.workers.dev address, or any other https address the deployment
 *            names). With none, the person gets a one-time tip, kept per project, to connect a host.
 *
 * Nothing here merges, force-pushes or touches a workflow file. What it does ask of GitHub: make a
 * branch, open a draft pull request, change the description of the pull request it opened, and read
 * (the App needs Deployments, Commit statuses and Checks: read for previews; without them the tip is shown).
 */
import { ConnectorError } from "../../connectors/state.js";
import { validBranchName, type PreviewSignals, type RepoRef } from "../github.js";
import { gateFree } from "../policy.js";
import {
  assertAccess, gateBase, openPr, ownProject, recordedBranch, repoRef, type ProjectDeps,
} from "../projects.js";
import type { GithubApp } from "../github.js";
import { cut } from "../work/model.js";
import { intakeStore, type IntakeStore } from "./intakeStore.js";
import { checksFor } from "./planDoc.js";
import type { PlanMilestone, StackKind } from "./types.js";

// ------------------------------------------------------------------- the branch

export const MILESTONE_BRANCH = /^tailzu\/m\d{1,2}-[a-z0-9][a-z0-9-]{0,40}$/;

/** The words of a title that make a branch name: ASCII words in lower case joined by "-", 32 characters at most; "work" when there are none. */
export function milestoneSlug(title: string): string {
  const slug = (String(title).match(/[A-Za-z0-9]+/g) ?? []).join("-").toLowerCase().slice(0, 32).replace(/-+$/, "");
  return slug || "work";
}

/** `tailzu/m<k>-<slug>`. */
export function milestoneBranch(k: number, title: string): string {
  const n = Number.isSafeInteger(k) && k >= 0 && k <= 99 ? k : 0;
  return `tailzu/m${n}-${milestoneSlug(title)}`;
}

// ------------------------------------------------------------------- previews

export type PreviewHost = "vercel" | "netlify" | "cloudflare" | "other";

export interface Preview { url: string; via: "deployment" | "status" | "check"; host: PreviewHost }

/** Addresses of a host's dashboard or of GitHub: a link to look at the deployment, not the deployment. */
const DASHBOARD = /^(?:vercel\.com|app\.netlify\.com|dash\.cloudflare\.com|github\.com|www\.github\.com|netlify\.com|www\.netlify\.com|render\.com|dashboard\.render\.com|railway\.app)$/i;
const PREVIEW_HOST = /(?:\.vercel\.app|\.netlify\.app|\.pages\.dev|\.workers\.dev|\.onrender\.com|\.up\.railway\.app|\.fly\.dev)$/i;
const HOSTISH = /vercel|netlify|cloudflare|pages|preview|deploy|render|railway|fly/i;

export function hostOf(url: string): PreviewHost {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.endsWith(".vercel.app")) return "vercel";
    if (h.endsWith(".netlify.app")) return "netlify";
    if (h.endsWith(".pages.dev") || h.endsWith(".workers.dev")) return "cloudflare";
  } catch { /* fall through */ }
  return "other";
}

/** An address that can be shown as a preview: https, no credentials, not a dashboard. */
function usable(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.href.length > 300 || DASHBOARD.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** The first preview-looking address inside a check run's own words. */
function inside(text: string): string | null {
  for (const m of text.matchAll(/https:\/\/[^\s)<>"'\]]+/g)) {
    const u = usable(m[0].replace(/[.,;]+$/, ""));
    if (u && PREVIEW_HOST.test(new URL(u).hostname)) return u;
  }
  return null;
}

/**
 * The preview from what GitHub knows about a commit: a successful deployment that is not
 * production, else a successful status from a host, else a successful check run from one.
 * A check run's own link (details_url) is usually the host's dashboard, so the address is looked
 * for in its words too. Null when there is none.
 */
export function detectPreview(sig: Pick<PreviewSignals, "deployments" | "statuses" | "checks">): Preview | null {
  const deployments = sig.deployments.filter((d) => d.state === "success" && !/^production$/i.test(d.environment.trim()));
  for (const d of deployments) { const u = usable(d.url); if (u) return { url: u, via: "deployment", host: hostOf(u) }; }
  for (const s of sig.statuses) {
    if (s.state !== "success" || !HOSTISH.test(s.context)) continue;
    const u = usable(s.url);
    if (u) return { url: u, via: "status", host: hostOf(u) };
  }
  for (const c of sig.checks) {
    if (c.status !== "completed" || c.conclusion !== "success" || !(HOSTISH.test(c.app) || HOSTISH.test(c.name))) continue;
    const u = usable(c.url) ?? inside(`${c.title}\n${c.summary}`);
    if (u) return { url: u, via: "check", host: hostOf(u) };
  }
  return null;
}

/** The preview of a commit, if the host made one; null on any failure (no host, no permission). */
export async function previewFor(github: Pick<GithubApp, "previewSignals">, repo: RepoRef, sha: string): Promise<Preview | null> {
  try { return detectPreview(await github.previewSignals(repo, sha)); } catch { return null; }
}

export const PREVIEW_TIP =
  "Tip: connect a host to this repo (Vercel, Netlify or Cloudflare Pages, all free to start) and every pull request gets its own preview link, so you can see each milestone running before you merge it. Tailzu shows the link here as soon as there is one.";

/**
 * The preview if there is one; otherwise the tip, once per project (it is remembered, so it is not repeated
 * on every milestone); otherwise nothing.
 */
export async function previewOrTip(preview: Preview | null, projectId: string, userId: string, store: IntakeStore = intakeStore()): Promise<{ preview?: Preview; tip?: string }> {
  if (preview) return { preview };
  try {
    const row = await store.get(projectId);
    if (row?.tips.includes("preview")) return {};
    await store.save(projectId, userId, { tips: [...(row?.tips ?? []), "preview"] });
  } catch { /* if it cannot be remembered it can be said again */ }
  return { tip: PREVIEW_TIP };
}

// ------------------------------------------------------------------ the body

export interface MilestoneBodyOptions {
  /** The work log section (work/worklog.ts worklogMarkdown). */
  worklog?: string;
  preview?: Preview | null;
  tip?: string;
  /** Where PLAN.md is, for the line that points to it. */
  planPath?: string;
}

/** The pull request's description: the checklist first, because it is what the person is asked to check. */
export function milestoneBody(m: PlanMilestone, o: MilestoneBodyOptions = {}): string {
  const out: string[] = [];
  out.push(`## M${m.k}: ${m.title}`, "");
  out.push(`This is one milestone of the plan${o.planPath ? ` in \`${o.planPath}\`` : ""}. It is a draft: nothing merges until you say so.`, "");
  if (o.preview) out.push(`**Preview:** [${o.preview.url}](${o.preview.url}) (${o.preview.host === "other" ? "from your host" : o.preview.host})`, "");
  else if (o.tip) out.push(`> ${o.tip}`, "");
  out.push("### Acceptance checklist", "", ...m.acceptance.map((a) => `- [ ] ${a}`), "");
  out.push("### Checks that must pass", "", ...m.checks.map((c) => `- \`${c}\``), "");
  out.push("### Scope", "", ...m.scope.map((s) => `- ${s}`), "");
  if (o.worklog?.trim()) out.push(o.worklog.trim(), "");
  return `${out.join("\n").trimEnd()}\n`;
}

/** The milestone's title as the pull request has it. */
export const milestoneTitle = (m: PlanMilestone): string => cut(`M${m.k}: ${m.title}`, 120);

// ------------------------------------------------------------------ on GitHub

export interface StartedMilestone { branch: string; baseSha: string; url: string; existing: boolean }

/**
 * Makes the milestone's branch, from the head of `from` (the default branch unless told otherwise), and records it as
 * Tailzu's own. Free (the policy's branch.create). A branch of that name that Tailzu already made is returned as it is;
 * one that is not Tailzu's is "branch_exists", never adopted.
 */
export async function startMilestone(
  d: ProjectDeps, userId: string, projectId: string, m: PlanMilestone, o: { from?: string; attended?: boolean } = {},
): Promise<StartedMilestone> {
  const branch = milestoneBranch(m.k, m.title);
  if (!validBranchName(branch) || !MILESTONE_BRANCH.test(branch)) throw new ConnectorError("bad_branch", "That isn't a milestone I can name a branch for.");
  if (o.from !== undefined && !validBranchName(o.from)) throw new ConnectorError("bad_request", "from is a branch, a tag or a commit.");
  const project = await ownProject(d, userId, projectId);
  await assertAccess(d, userId, project, true);
  return gateFree({
    ...gateBase(d, userId, project), attended: o.attended, action: "branch.create",
    summary: () => ({ milestone: milestoneTitle(m), branch, ...(o.from !== undefined ? { from: o.from } : {}) }),
    run: async () => {
      const url = `https://github.com/${project.fullName}/tree/${branch}`;
      const have = await d.store.getBranch(projectId, branch);
      if (have) return { branch, baseSha: have.baseSha, url, existing: true };
      try {
        const baseSha = await d.github.createBranch(repoRef(d, userId, project), branch, o.from);
        await d.store.addBranch({ projectId, branch, task: milestoneTitle(m), baseSha });
        return { branch, baseSha, url, existing: false };
      } catch (err) {
        if (err instanceof ConnectorError && err.code === "branch_exists") {
          throw new ConnectorError("branch_exists", "A branch with that name is already there and Tailzu did not make it, so it was left alone.");
        }
        throw err;
      }
    },
  });
}

export interface MilestonePr { prNumber: number; prUrl: string; existing: boolean; preview?: Preview; tip?: string }

/**
 * Opens the milestone's draft pull request, or, when it is open already, rewrites its description (so the work log and the
 * preview link are current). The branch has to be one Tailzu made, and to have commits on it (GitHub will not open an empty
 * pull request: "nothing_to_review"). Free.
 */
export async function openMilestonePr(
  d: ProjectDeps, userId: string, projectId: string, m: PlanMilestone,
  o: { worklog?: string; planPath?: string; attended?: boolean; intake?: IntakeStore } = {},
): Promise<MilestonePr> {
  const project = await ownProject(d, userId, projectId);
  const branch = milestoneBranch(m.k, m.title);
  await recordedBranch(d, project, branch);
  await assertAccess(d, userId, project, true);
  const repo = repoRef(d, userId, project);
  const head = await d.github.branchHead(repo, branch);
  const found = await previewFor(d.github, repo, head);
  const { preview, tip } = await previewOrTip(found, projectId, userId, o.intake);
  const body = milestoneBody(m, { worklog: o.worklog, preview, tip, planPath: o.planPath });
  const pr = await openPr(d, userId, projectId, branch, milestoneTitle(m), body, { attended: o.attended });
  if (pr.existing) {
    await gateFree({
      ...gateBase(d, userId, project), attended: o.attended, action: "pr.comment", branch, ownBranch: true,
      summary: () => ({ pullRequest: pr.prNumber, updates: "the description" }),
      run: () => d.github.updatePull(repo, pr.prNumber, { body }),
    });
  }
  return { ...pr, ...(preview ? { preview } : {}), ...(tip ? { tip } : {}) };
}

/** The checks a milestone of a stack runs, for a caller that has only the stack. */
export const checksOf = (kind: StackKind): string[] => checksFor(kind);

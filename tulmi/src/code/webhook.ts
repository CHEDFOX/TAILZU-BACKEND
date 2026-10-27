/**
 * GITHUB TELLING US THAT AN INSTALL CHANGED.
 *
 *   POST /v1/code/github/webhook
 *
 * GitHub is the caller, not a person, so there is no session: the request is
 * trusted only if X-Hub-Signature-256 is "sha256=" and the HMAC-SHA256 (hex)
 * of the raw body under GITHUB_APP_WEBHOOK_SECRET. The raw body is kept by the
 * server's JSON parser for this path (server.ts, as for Razorpay's), since a
 * signature is over the bytes as sent. The compare is timing-safe (auth/secret.ts). With no
 * secret set, every delivery is refused.
 *
 * What it does, and all it does:
 *
 *   installation               deleted    drop everyone's links to it, and their projects on it
 *   installation               suspend    mark it suspended: Tailzu makes no call under it (projects.ts)...
 *   installation               unsuspend  ...until the mark is cleared
 *   installation_repositories  removed    drop the projects on the repos taken off it
 *   pull_request               closed         the matching work branch is `merged` (if it was merged) or `closed`
 *   pull_request               reopened       ...`pr_open`
 *   pull_request               ready_for_review  ...`pr_open`, unless a sync found a conflict it still has
 *   pull_request_review        submitted      the matching work branch notes when the review came in
 *   push                       default branch the project brain of every project on the repo is marked stale, and an
 *                                             incremental build is scheduled after a minute of quiet (hooks.pushed;
 *                                             project/index.ts BrainSync); PR care looks again for a conflict on every
 *                                             pull request it looks after. Other branches, deleted branches: nothing
 *   pull_request (opened, reopened, synchronize, ready_for_review, closed), pull_request_review (submitted),
 *   pull_request_review_comment (created), issue_comment (created), check_run (completed), check_suite (completed),
 *   status                                    PR care (hooks.care, code/prcare): handed over to it as they are and answered at once,
 *                                             whatever else this file does with the same event. It is the care engine that decides the
 *                                             event is about a pull request Tailzu looks after; every other pull request is ignored there
 *
 * A pull request is matched to a branch by the repo's id and the branch name
 * ("tailzu/..." only, and only when the branch is in that same repo, not a
 * fork's: a stranger's fork can't name a branch to move one of ours), in every
 * project on that repo. A branch that was deleted stays deleted.
 *
 * Anything else is a 202 and nothing. It only touches Tailzu's own store: it
 * never calls GitHub, so it answers fast (GitHub gives up after ten seconds),
 * and a delivery that arrives twice or late does the same thing twice. PR care's
 * events are only QUEUED here (the work happens after the answer is sent), and what
 * they do is idempotent in the care row, so a delivery that comes twice does it once.
 */
import { createHmac } from "node:crypto";
import { sameSecret } from "../auth/secret.js";
import type { CodeProject, CodeStore } from "./store.js";

/** True when `header` is the signature of `raw` under `secret`. False for no secret, no header, or any other value. */
export function signatureOk(raw: string, header: string, secret: string): boolean {
  if (!secret || !header) return false;
  return sameSecret(header, "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
}

/** The signature GitHub would send for `raw` (for tests and for anyone wiring a fake). */
export const signatureFor = (raw: string, secret: string): string =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

const idOf = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

/** What the webhook hands on to other parts of Tailzu. Each only touches Tailzu's own store and timers: none calls GitHub. */
export interface WebhookHooks {
  /** Somebody pushed to the default branch of a project's repo. `after` is the commit the branch is at now. */
  pushed?: (project: CodeProject, after: string) => void | Promise<void>;
  /** One of the events PR care listens to (prcare/engine.ts CARE_EVENTS). Quick: it queues the work and returns. */
  care?: (event: string, payload: unknown) => void;
}

/** The events handed to `hooks.care` before anything else is done with them. */
const CARE_EVENTS = new Set(["pull_request", "pull_request_review", "pull_request_review_comment", "issue_comment", "check_run", "check_suite", "status"]);

/** What a delivery did: "handled" (a change was made, or there was nothing left to change), or "ignored". */
export async function handleWebhook(
  store: CodeStore, event: string, payload: unknown, now = Date.now(), hooks: WebhookHooks = {},
): Promise<"handled" | "ignored"> {
  // PR care first, whatever the rest does with the event (a handed-over pull request is not on a "tailzu/" branch). It queues; a failure here is never the delivery's.
  if (hooks.care && CARE_EVENTS.has(event)) {
    try { hooks.care(event, payload); } catch { /* the care engine's own log has it */ }
  }
  const p = (payload && typeof payload === "object" ? payload : {}) as {
    action?: unknown; installation?: { id?: unknown }; repositories_removed?: Array<{ id?: unknown }>;
    repository?: { id?: unknown }; pull_request?: { merged?: unknown; head?: { ref?: unknown; repo?: { id?: unknown } | null } };
    review?: { submitted_at?: unknown }; ref?: unknown; after?: unknown; deleted?: unknown;
  };

  if (event === "push") {
    const repoId = idOf(p.repository?.id);
    if (repoId === null || !hooks.pushed || typeof p.ref !== "string" || !p.ref.startsWith("refs/heads/") || p.deleted === true) return "ignored";
    const branch = p.ref.slice("refs/heads/".length);
    const after = typeof p.after === "string" && /^[0-9a-f]{40}$/.test(p.after) ? p.after : "";
    // Only the default branch is what a project's brain is built from; every person's project on this repo follows it.
    const mine = (await store.listProjectsByRepo(repoId)).filter((proj) => proj.defaultBranch === branch);
    for (const proj of mine) await hooks.pushed(proj, after);
    return mine.length ? "handled" : "ignored";
  }

  if (event === "pull_request" || event === "pull_request_review") {
    const repoId = idOf(p.repository?.id);
    const head = p.pull_request?.head;
    const ref = head?.ref;
    // A work branch, in the repo the event is about.
    if (repoId === null || typeof ref !== "string" || !ref.startsWith("tailzu/") || idOf(head?.repo?.id) !== repoId) return "ignored";
    if (event === "pull_request_review") {
      if (p.action !== "submitted") return "ignored";
      const at = typeof p.review?.submitted_at === "string" ? Date.parse(p.review.submitted_at) : NaN;
      await store.updateBranchesByHead(repoId, ref, { lastReviewAt: Number.isFinite(at) ? at : now });
      return "handled";
    }
    if (p.action === "closed") { await store.updateBranchesByHead(repoId, ref, { state: p.pull_request?.merged === true ? "merged" : "closed" }); return "handled"; }
    if (p.action === "reopened") { await store.updateBranchesByHead(repoId, ref, { state: "pr_open" }); return "handled"; }
    if (p.action === "ready_for_review") {
      await store.updateBranchesByHead(repoId, ref, { state: "pr_open" }, { onlyIn: ["active", "pr_open", "closed"] });
      return "handled";
    }
    return "ignored";
  }

  const installationId = idOf(p.installation?.id);
  if (installationId === null) return "ignored";

  if (event === "installation") {
    if (p.action === "deleted") { await store.removeInstallationForAll(installationId); return "handled"; }
    if (p.action === "suspend") { await store.setSuspended(installationId, now); return "handled"; }
    if (p.action === "unsuspend") { await store.setSuspended(installationId, null); return "handled"; }
    return "ignored";
  }
  if (event === "installation_repositories" && p.action === "removed") {
    const repoIds = (Array.isArray(p.repositories_removed) ? p.repositories_removed : [])
      .map((r) => idOf(r?.id)).filter((id): id is number => id !== null);
    await store.removeReposForAll(installationId, repoIds);
    return "handled";
  }
  return "ignored";
}

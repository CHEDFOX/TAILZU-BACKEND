/**
 * THE CODE BOT'S GITHUB ROUTES: CONNECT, PICK A PROJECT, START A BRANCH, AND SAY YES.
 *
 *   POST   /v1/code/github/connect            -> { installUrl }  the link that opens GitHub's install page
 *   GET    /v1/code/github/callback           GitHub sends the browser back here; no session, the signed state says who
 *   GET    /v1/code/github                    -> { configured, connected, installations: [{ id, account, accountType,
 *                                                  repositorySelection, suspended, manageUrl }] }
 *   DELETE /v1/code/github/installations/:id  forget the link and its projects here -> { ok, manageUrl }; GitHub's
 *                                                  install is not touched, manageUrl is where to remove it
 *   POST   /v1/code/github/signin             -> { authorizeUrl }  the other way to connect: "Sign in with GitHub" (code/oauth.ts),
 *                                                  a classic OAuth App with no install. 404 oauth_off unless CODE_GITHUB_OAUTH. With
 *                                                  { workflow: true } it is the incremental sign-in that also asks for the `workflow`
 *                                                  scope, which GitHub's free computers need (docs/github-app.md section 9)
 *   GET    /v1/code/github/signin/callback    GitHub sends the browser back here; no session, the signed state says who
 *   DELETE /v1/code/github/signin             -> { ok, revoked }  revokes the token at GitHub, then forgets the link and its projects
 *   GET    /v1/code/repos                     -> { repos: [{ id, fullName, private, defaultBranch, installationId }], truncated,
 *                                                  needsReconnect? }  only repos the person may write to on GitHub (below)
 *   POST   /v1/code/projects { repoId }       -> { project, created }; 404 for a repo outside the person's installs
 *   GET    /v1/code/projects                  -> { projects }
 *   DELETE /v1/code/projects/:id              -> { ok }
 *   POST   /v1/code/projects/:id/brain { mode? }
 *                                             -> 202 { status, progress: { pct, phase }, headSha, builtAt, summaries, welcome,
 *                                                  structure, features, ... }  starts, or refreshes, the project brain (code/project):
 *                                                  Tailzu reads the repo and keeps an understanding of it. It runs in the background;
 *                                                  `mode` is "full" or "incremental" (default: incremental, or full if nothing has been
 *                                                  built). A build already running is returned as it is. Adding a project (POST
 *                                                  /v1/code/projects) starts the first, full, build by itself
 *   GET    /v1/code/projects/:id/brain        -> { status: none | building | ready | failed | stale, progress, headSha, builtAt,
 *                                                  summaries: none | partial | complete, welcome, structure, features, conventions,
 *                                                  baseline, spentPaise, error }  404 for a project that isn't the person's, 404
 *                                                  brain_off while CODE_PROJECT_BRAIN is off
 *   POST   /v1/code/projects/:id/branches { task, from? }
 *                                             -> { branch, baseSha, url }  `tailzu/<slug>-<4 hex>` from the head of `from` (a branch,
 *                                                  tag or commit; the default branch when left out)
 *   GET    /v1/code/projects/:id/branches     -> { branches }
 *   POST   /v1/code/projects/:id/branches/:branch/pr { title, body }
 *                                             -> { prNumber, prUrl, existing }  a draft PR; :branch is URL-encoded
 *                                                  (tailzu%2Ffix-login-1a2b), since the branch has a "/" in it
 *   GET    /v1/code/new-repo-link?name=       -> { url, name }  GitHub's "new repository" page with the name and private filled
 *                                                  in; the person makes the repo, so Tailzu needs no permission to
 *   POST   /v1/code/projects/:id/init { title?, approvalId? }
 *                                             -> a QUESTION, then { commitSha }  one README.md as the first commit of a repo with NO
 *                                                  commits (409 repo_not_empty otherwise). createWorkBranch on an empty repo: 409 repo_empty
 *   GET    /v1/code/projects/:id/permissions  -> { grants: [{ id, action, branchPattern?, effect, expiresAt?, createdAt }], actions }
 *                                                  the project's standing permissions, and the catalog of actions (id, tier, label,
 *                                                  faceId, grantable, branchScoped) for the screen that edits them
 *   POST   /v1/code/projects/:id/permissions { action, branchPattern?, effect?, expiresAt? }
 *                                             -> { grant }  "always let the bot do <action> on <branch pattern>" (effect allow, the
 *                                                  default), or "never" (deny, which beats every allow). 400 not_grantable for an
 *                                                  action that always asks (Face ID) or never happens, 409 too_many at 100
 *   DELETE /v1/code/projects/:id/permissions/:grantId
 *                                             -> { ok }  takes a standing permission back (404 for one that isn't this project's)
 *
 * and, for a branch of the project (":branch" always URL-encoded; the bot's own, or any other), code/pulls.ts:
 *
 *   POST   .../branches/:branch/sync          -> { status: merged | up_to_date, sha? }  the default branch merged INTO
 *                                                  the branch; a conflict is 409 conflict and the branch's state
 *                                                  `conflict`: never resolved, never forced. A question on a branch the bot didn't make
 *   GET    .../branches/:branch/diff          -> { aheadBy, behindBy, commits: [{ sha, message }], files: [{ path, status,
 *                                                  additions, deletions }], totals, truncated }  300 files at most, no contents
 *   GET    .../branches/:branch/pr            -> { number, url, title, state: open | closed | merged, draft, mergeable,
 *                                                  mergeableState, headSha, reviewDecision, reviewComments, lastReviewAt }
 *   GET    .../branches/:branch/pr/comments   -> { comments: [{ author, body, path?, line?, createdAt }], truncated }
 *                                                  100 at most; the words are other people's (untrusted text)
 *   POST   .../branches/:branch/pr/ready      -> a QUESTION, then { draft: false }
 *   POST   .../branches/:branch/pr/close      -> a QUESTION, then { state: closed }  without merging
 *   POST   .../branches/:branch/pr/merge      -> a QUESTION, then { merged, sha }, a squash merge of exactly the commit
 *                                                  the approval was for (409 changed_since_approval if the branch moved)
 *   DELETE .../branches/:branch               -> a QUESTION, then { state: deleted }  removes the branch from GitHub once its
 *                                                  pull request is merged or closed; the record stays
 *
 * A QUESTION. Tailzu does some things on its own (read, make a branch, commit to its own branch, open a draft
 * pull request, bring its own branch up to date) and asks first about the rest (code/policy.ts: the tiers).
 * The first request does nothing and answers 200
 *
 *   { needsApproval: true, approvalId, action, faceId, expiresAt, summary }
 *
 * `summary` is what to show (the files' names, never their contents; for a merge: title, into, files, additions,
 * deletions, headSha). The same request again with `{ approvalId }` in the body (or ?approvalId= on a DELETE)
 * does it. An approval is single use, lasts ten minutes, is bound to the person, project, action and branch
 * (and the commit the branch was at, and what would be written), and does nothing if anything is different:
 * 409 approval_invalid, approval_expired or changed_since_approval. `faceId: true` is for the actions that
 * always ask and can never be allowed for good (a force-push, deleting the default branch, committing
 * something that looks like a secret): the phone puts Face ID in front of the yes. A standing permission
 * (the routes above) skips the question; a refusal is 403, with a code that says why: policy_denied (a
 * "never" the person set), needs_workflow_scope, never, needs_you (nobody was there to ask).
 *
 * GitHub's branch protection is respected, not worked round: a refusal because of it is 409 protected_branch.
 *
 *   POST   /v1/code/github/webhook            GitHub's own deliveries (code/webhook.ts); authenticated by signature. A push to a
 *                                                  project's default branch marks its brain stale and schedules an incremental build
 *                                                  a minute later; the delivery is answered at once and GitHub is never called inline
 *
 * The jobs the bot runs on a branch, the desktop runner protocol (/v1/code/runner/*) and the person's compute
 * settings (/v1/code/settings/compute) are in routes/codeJobs.ts; the router behind them is code/jobs/router.ts.
 *
 * Every route but the callback and the webhook authenticates exactly like the
 * rest of /v1. The answers to "is this on":
 *
 *   CODE_GITHUB off                         404 { code: "code_off" }, on every route
 *   on, the GitHub App not set up           503 { code: "not_configured" }
 *
 * and both are checked BEFORE the session, so a client can ask once and stop.
 * The webhook is the exception to the second: it needs only its own secret.
 *
 * What a person's mistake looks like: a project or branch that isn't theirs is
 * 404 (it doesn't say it exists), a bad body 400, a branch that moved under a
 * commit 409. A GitHub that fails is 502 with plain words, never its own.
 * Every write above asks GitHub afresh whether the person can still write to
 * the repo (403 no_access if not).
 *
 * "Sign in with GitHub" reaches ALL of a person's repos, which an App install
 * does not, so Tailzu limits it (code/oauth.ts): only repos added as projects,
 * push access re-checked before every write, the token encrypted at rest and
 * never in any reply, revoked on disconnect, on account delete and after 30
 * days unused. A token GitHub rejects is 403 needs_signin; an organisation that
 * hasn't let the sign-in in is 403 org_blocked.
 *
 * Linking an install is not access to every repo in it (code/projects.ts): a
 * repo is the person's to use if the install is on their own GitHub account,
 * or GitHub says their login can write to it. Otherwise it is left out of the
 * list and a project can't be made from it (404), and one that was made and
 * then lost its access is turned away: 403 no_access. A link from before their
 * login was kept answers 403 needs_reconnect ("connect GitHub again").
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { NoTokenKey, tokenKey } from "../connectors/crypto.js";
import { ConnectorError } from "../connectors/oauth.js";
import type { Code } from "../code/index.js";
import { beginConnect, completeCallback, forgetInstallation, linkStatus } from "../code/link.js";
import { GRANTS_MAX, PolicyError, actionCatalog, parseGrant, type GateOptions } from "../code/policy.js";
import { addProject, createWorkBranch, initEmptyRepo, listBranches, listRepos, newRepoLink, openPr, ownProject } from "../code/projects.js";
import { branchDiff, closePr, deleteWorkBranch, markReady, mergePr, prComments, prStatus, syncBranch } from "../code/pulls.js";
import { CodeNeedsAccount } from "../code/store.js";
import { handleWebhook, signatureOk } from "../code/webhook.js";
import { PAGE_CSP, page } from "./connectors.js";

export interface CodeRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when CODE_GITHUB is off. */
  code: Code | null;
}

/** Where the phone's app is opened from the done page. The Code screen comes with the phone's side; for now, the app. */
const OPEN_APP = "tulmi://";

/** The HTTP status of a ConnectorError, by its code. Anything not listed (GitHub failing, mostly) is a 502. */
export const STATUS: Record<string, number> = {
  bad_state: 400, bad_request: 400, bad_branch: 400, bad_path: 400, binary_file: 400, too_large: 400, not_a_file: 400,
  not_yours: 403, no_access: 403, needs_reconnect: 403, not_found: 404,
  branch_moved: 409, branch_exists: 409, conflict: 409, too_many: 409, suspended: 409, nothing_to_review: 409, no_drafts: 409,
  repo_empty: 409, repo_not_empty: 409, branch_deleted: 409, branch_in_use: 409, changed_since_approval: 409, approval_expired: 409,
  approval_invalid: 409, pr_draft: 409, pr_not_open: 409, pr_merged: 409, not_mergeable: 409, use_server_commit: 409,
  protected_branch: 409, not_fast_forward: 409, not_grantable: 400,
  needs_you: 403, policy_denied: 403, never: 403, needs_workflow_scope: 403,
  oauth_off: 404, brain_off: 404, needs_signin: 403, not_allowed: 403, org_blocked: 403, scope_too_broad: 403, scope_missing: 403,
  not_configured: 503, busy: 503,
  // The jobs and the runner protocol (routes/codeJobs.ts): a lease someone else holds now, a step still out, a job that is over,
  // a job that isn't waiting for what was said yes to, a PC that hasn't said hello, paid compute that is off or absent.
  stale_lease: 409, step_in_flight: 409, job_over: 409, not_waiting: 409, unknown_device: 409, paid_off: 409, paid_unavailable: 409,
  // The result of a step on GitHub's free computers (routes/codeJobs.ts gh-result): a token that isn't GitHub's, or is for something else.
  bad_runner_token: 401, runner_mismatch: 403,
};

/**
 * A failure as the answer to a request: the codes above by status, a refusal by
 * the policy with what to show the person, anything else (a bug) thrown on.
 * Shared with the jobs' routes (routes/codeJobs.ts).
 */
export function failCode(reply: FastifyReply, err: unknown) {
  if (err instanceof CodeNeedsAccount) return reply.code(403).send({ code: "needs_account", message: err.message });
  if (err instanceof NoTokenKey) return reply.code(503).send({ code: "not_configured", message: err.message });
  // A refusal by the policy says which action, and whether it is one that asks with Face ID; one that is waiting for the person carries what to show them.
  if (err instanceof PolicyError) {
    return reply.code(STATUS[err.code] ?? 403).send({
      code: err.code, message: err.message, action: err.info.action, faceId: err.info.faceId, ...(err.info.summary ? { summary: err.info.summary } : {}),
    });
  }
  if (err instanceof ConnectorError) return reply.code(STATUS[err.code] ?? 502).send({ code: err.code, message: err.message });
  throw err;
}

const POSITIVE = /^[0-9]{1,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A GitHub id from a path or a body: a positive whole number, as a number or as digits. Else null. */
function idOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && POSITIVE.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function registerCodeRoutes(app: FastifyInstance, deps: CodeRoutesDeps): void {
  const RL = { config: deps.rateLimit };
  const k = deps.code;

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "code_off", message: "The Code bot is not switched on." });
  const notConfigured = (reply: FastifyReply) => reply.code(503).send({ code: "not_configured", message: "GitHub isn't set up on this server yet." });
  const noSession = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  const fail = failCode;
  /** `approvalId` from the body, or the address for a request that has none: step two of a question. Anything but a non-empty string is a 400. */
  const gateOptions = (body: Record<string, unknown>, query: unknown): GateOptions => {
    const id = body.approvalId !== undefined ? body.approvalId : (query && typeof query === "object" ? (query as Record<string, unknown>).approvalId : undefined);
    if (id === undefined) return {};
    if (typeof id !== "string" || !id || id.length > 200) throw new ConnectorError("bad_request", "approvalId is the id the question gave.");
    return { approvalId: id };
  };
  /** Signing the install link needs CONNECTOR_TOKEN_KEY; without it nothing can be linked. */
  const stateKeyOk = () => { try { tokenKey(); return true; } catch { return false; } };

  /**
   * The Code bot, when it is on and whole. Otherwise the answer has been sent, and this is null.
   * `need` "app" is for what only the GitHub App does (the install flow).
   */
  const ready = (reply: FastifyReply, need: "any" | "app" = "any") => {
    if (!k) { off(reply); return null; }
    if (!k.github || !stateKeyOk() || (need === "app" && !k.appReady)) { notConfigured(reply); return null; }
    return { store: k.store, github: k.github, approvals: k.approvals, oauth: k.oauth };
  };
  /** `ready`, then the session. Null once the answer has been sent. */
  const begin = async (authorization: string | undefined, reply: FastifyReply, need: "any" | "app" = "any") => {
    const d = ready(reply, need);
    if (!d) return null;
    const user = await resolveUser(authorization);
    if (!user) { noSession(reply); return null; }
    return { d, user };
  };

  /** `begin`, for the project brain's routes: the brain being switched off is answered before the session, as "code off" is. */
  const beginBrain = async (authorization: string | undefined, reply: FastifyReply) => {
    const d = ready(reply);
    if (!d) return null;
    if (!k!.brain) { reply.code(404).send({ code: "brain_off", message: "The project brain isn't switched on." }); return null; }
    const user = await resolveUser(authorization);
    if (!user) { noSession(reply); return null; }
    return { d, user, brain: k!.brain };
  };

  app.post("/v1/code/github/connect", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply, "app");
    if (!s) return reply;
    try {
      return reply.send(await beginConnect(s.d, s.user.id));
    } catch (err) { return fail(reply, err); }
  });

  // GitHub's redirect after the install. A browser, no session: the signed state says whose it is.
  app.get<{ Querystring: { code?: unknown; installation_id?: unknown; setup_action?: unknown; state?: unknown; error?: unknown } }>(
    "/v1/code/github/callback", RL, async (req, reply) => {
      reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
        .header("content-security-policy", PAGE_CSP).header("content-type", "text/html; charset=utf-8");
      if (!k) return reply.code(404).send(page("Not available", "The Code bot is not switched on.", false));
      if (!k.github || !k.appReady || !stateKeyOk()) return reply.code(503).send(page("Not available", "GitHub isn't set up on this server yet.", false));
      const q = req.query ?? {};
      const again = (title: string, line: string) => page(title, line, true, OPEN_APP);
      if (q.error) return reply.code(400).send(again("Nothing was connected", "You can go back to Tailzu and try again any time."));
      const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
      const code = text(q.code, 4096), state = text(q.state, 4096), installationId = text(q.installation_id, 20), setupAction = text(q.setup_action, 32);
      if ((q.code !== undefined && code === undefined) || (q.state !== undefined && state === undefined)) {
        return reply.code(400).send(again("That link didn't work", "Go back to Tailzu and start connecting again."));
      }
      try {
        const r = await completeCallback({ store: k.store, github: k.github }, { code, installationId, setupAction, state });
        if (r.kind === "waiting") {
          return reply.send(page("Waiting for your organisation's owner to approve Tailzu", "Once they say yes, open Tailzu and connect GitHub again.", false));
        }
        if (r.kind === "synced") return reply.send(page("GitHub updated", "Tailzu has the latest from GitHub. You can go back to Tailzu.", true, OPEN_APP));
        return reply.send(page("GitHub connected", "Tailzu can now see the repos you chose. You can go back to Tailzu.", true, OPEN_APP));
      } catch (err) {
        // The code, the state and the installation are in the address: only what went wrong is logged.
        req.log.warn({ code: (err as { code?: string })?.code }, "github callback failed");
        const notYours = err instanceof ConnectorError && err.code === "not_yours";
        return reply.code(notYours ? 403 : 400).send(again(
          notYours ? "That install isn't yours" : "That didn't work",
          notYours ? "Your GitHub account can't reach it, so it wasn't connected." : "Go back to Tailzu and try connecting again.",
        ));
      }
    });

  app.get("/v1/code/github", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const status = await linkStatus(s.d, s.user.id);
      if (!k!.oauthWanted) return reply.send(status);
      // The other way in, when it is offered. Who they are and whether it works; never the token.
      const link = await s.d.store.getOAuthLink(s.user.id);
      const active = !!link && link.status === "active" && link.tokenEnc !== null;
      return reply.send({
        ...status, connected: status.connected || active,
        oauth: {
          connected: active, ...(link ? { login: link.githubLogin, status: link.status, workflow: link.scope.split(/[\s,]+/).includes("workflow") } : {}),
        },
      });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/code/github/installations/:id", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply, "app");
    if (!s) return reply;
    const id = idOf(req.params.id);
    if (id === null) return reply.code(404).send({ code: "not_found", message: "That GitHub install isn't connected." });
    try {
      return reply.send(await forgetInstallation(s.d, s.user.id, id));
    } catch (err) { return fail(reply, err); }
  });

  // --- Sign in with GitHub (code/oauth.ts): off unless CODE_GITHUB_OAUTH, and not set up without the OAuth App's id and secret.
  /** The sign-in, when the Code bot is on and it is offered and whole. Otherwise the answer has been sent, and this is null. */
  const signinReady = (reply: FastifyReply, o: { switchOff?: boolean } = {}) => {
    if (!k) { off(reply); return null; }
    // Disconnecting (revoking) still works with the switch off; everything else says it is off.
    if (!k.oauthWanted && !(o.switchOff && k.oauth)) { reply.code(404).send({ code: "oauth_off", message: "Sign in with GitHub isn't switched on." }); return null; }
    if (!k.oauth || !stateKeyOk()) { notConfigured(reply); return null; }
    return k.oauth;
  };

  app.post("/v1/code/github/signin", RL, async (req, reply) => {
    const oauth = signinReady(reply);
    if (!oauth) return reply;
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    try {
      // `{ workflow: true }` is the incremental sign-in that also asks for the `workflow` scope, which GitHub's free computers need to commit their workflow file (code/jobs/githubActions.ts).
      const body = req.body && typeof req.body === "object" ? (req.body as { workflow?: unknown }) : {};
      return reply.send(body.workflow === true ? await oauth.beginWorkflow(user.id) : await oauth.begin(user.id));
    } catch (err) { return fail(reply, err); }
  });

  // GitHub's redirect after the sign-in. A browser, no session: the signed state says whose it is.
  app.get<{ Querystring: { code?: unknown; state?: unknown; error?: unknown } }>("/v1/code/github/signin/callback", RL, async (req, reply) => {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
      .header("content-security-policy", PAGE_CSP).header("content-type", "text/html; charset=utf-8");
    if (!k) return reply.code(404).send(page("Not available", "The Code bot is not switched on.", false));
    if (!k.oauthWanted) return reply.code(404).send(page("Not available", "Sign in with GitHub isn't switched on.", false));
    if (!k.oauth || !stateKeyOk()) return reply.code(503).send(page("Not available", "GitHub isn't set up on this server yet.", false));
    const again = (title: string, line: string) => page(title, line, true, OPEN_APP);
    const q = req.query ?? {};
    if (q.error) return reply.code(400).send(again("Nothing was connected", "You can go back to Tailzu and try again any time."));
    const { code, state } = q;
    if (typeof code !== "string" || typeof state !== "string" || !code || code.length > 4096 || state.length > 4096) {
      return reply.code(400).send(again("That link didn't work", "Go back to Tailzu and start connecting again."));
    }
    try {
      await k.oauth.complete(code, state);
      return reply.send(page("GitHub connected", "You signed in. Add the repos you want Tailzu to work in, and only those are touched. You can go back to Tailzu.", true, OPEN_APP));
    } catch (err) {
      // The code and the state are in the address: only what went wrong is logged.
      req.log.warn({ code: (err as { code?: string })?.code }, "github sign-in callback failed");
      const broad = err instanceof ConnectorError && err.code === "scope_too_broad";
      return reply.code(broad ? 403 : 400).send(again(
        broad ? "Nothing was connected" : "That didn't work",
        broad ? "GitHub gave Tailzu more access than it asked for, so it was revoked." : "Go back to Tailzu and try connecting again.",
      ));
    }
  });

  app.delete("/v1/code/github/signin", RL, async (req, reply) => {
    const oauth = signinReady(reply, { switchOff: true });
    if (!oauth) return reply;
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return noSession(reply);
    try {
      return reply.send({ ok: true, ...(await oauth.disconnect(user.id)) });
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/code/repos", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await listRepos(s.d, s.user.id));
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Body: { repoId?: unknown } }>("/v1/code/projects", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    const repoId = idOf((req.body ?? {}).repoId);
    if (repoId === null) return reply.code(400).send({ code: "bad_request", message: "repoId is the repo's number from the list." });
    try {
      const added = await addProject(s.d, s.user.id, repoId);
      // The first, full, build of the project brain starts by itself, in the background. A project that already has one is left alone.
      const started = k!.brain ? await k!.brain.added(s.user.id, added.project).catch(() => false) : false;
      return reply.send(started ? { ...added, brain: { status: "building" } } : added);
    } catch (err) { return fail(reply, err); }
  });

  app.get("/v1/code/projects", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send({ projects: await s.d.store.listProjects(s.user.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string } }>("/v1/code/projects/:id", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      if (!UUID.test(req.params.id) || !(await s.d.store.deleteProject(s.user.id, req.params.id))) {
        return reply.code(404).send({ code: "not_found", message: "No such project" });
      }
      // The database cascades; the memory twin and any build timer are told.
      if (k!.brain) await k!.brain.forget(req.params.id).catch(() => undefined);
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  // --- the project brain (code/project): start or refresh a build, and read where it is.
  app.post<{ Params: { id: string }; Body: { mode?: unknown } | undefined }>("/v1/code/projects/:id/brain", RL, async (req, reply) => {
    const s = await beginBrain(req.headers["authorization"], reply);
    if (!s) return reply;
    const mode = (req.body && typeof req.body === "object" ? req.body : {}).mode;
    if (mode !== undefined && mode !== "full" && mode !== "incremental") {
      return reply.code(400).send({ code: "bad_request", message: 'mode is "full" or "incremental".' });
    }
    try {
      const started = await s.brain.start(s.user.id, req.params.id, { mode: mode as "full" | "incremental" | undefined });
      // The build goes on in the background; whoever asked has its status now.
      started.done.catch(() => undefined);
      return reply.code(202).send(started.status);
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/code/projects/:id/brain", RL, async (req, reply) => {
    const s = await beginBrain(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await s.brain.get(s.user.id, req.params.id));
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: { task?: unknown; from?: unknown } }>("/v1/code/projects/:id/branches", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    const { task, from } = req.body ?? {};
    if (from !== undefined && (typeof from !== "string" || !from || from.length > 255)) {
      return reply.code(400).send({ code: "bad_request", message: "from is a branch, a tag or a commit." });
    }
    try {
      return reply.send(await createWorkBranch(s.d, s.user.id, req.params.id, task, { from: from as string | undefined }));
    } catch (err) { return fail(reply, err); }
  });

  app.get<{ Params: { id: string } }>("/v1/code/projects/:id/branches", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send({ branches: await listBranches(s.d, s.user.id, req.params.id) });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string; branch: string }; Body: { title?: unknown; body?: unknown } }>(
    "/v1/code/projects/:id/branches/:branch/pr", RL, async (req, reply) => {
      const s = await begin(req.headers["authorization"], reply);
      if (!s) return reply;
      // The branch has a "/" in it, so it arrives percent-encoded. Decoding what is already
      // decoded changes nothing: a work branch never has a "%" in it.
      let branch: string;
      try { branch = decodeURIComponent(req.params.branch); } catch {
        return reply.code(404).send({ code: "not_found", message: "I couldn't find that branch in this project." });
      }
      const { title, body } = req.body ?? {};
      try {
        return reply.send(await openPr(s.d, s.user.id, req.params.id, branch, title, body));
      } catch (err) { return fail(reply, err); }
    });

  app.get<{ Querystring: { name?: unknown } }>("/v1/code/new-repo-link", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    return reply.send(newRepoLink((req.query ?? {}).name));
  });

  app.post<{ Params: { id: string }; Body: { title?: unknown; approvalId?: unknown } }>("/v1/code/projects/:id/init", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      return reply.send(await initEmptyRepo(s.d, s.user.id, req.params.id, body.title, gateOptions(body, req.query)));
    } catch (err) { return fail(reply, err); }
  });

  // --- the project's standing permissions (code/policy.ts): "always let the bot do this on these branches", or "never".
  app.get<{ Params: { id: string } }>("/v1/code/projects/:id/permissions", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const project = await ownProject(s.d, s.user.id, req.params.id);
      const now = Date.now();
      const grants = (await s.d.store.listGrants(project.id)).filter((g) => g.expiresAt === undefined || g.expiresAt > now);
      return reply.send({ grants, actions: actionCatalog() });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> | undefined }>("/v1/code/projects/:id/permissions", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const project = await ownProject(s.d, s.user.id, req.params.id);
      const wanted = parseGrant(req.body);
      const have = await s.d.store.listGrants(project.id);
      const same = have.some((g) => g.action === wanted.action && (g.branchPattern ?? "") === (wanted.branchPattern ?? "") && g.effect === wanted.effect);
      if (!same && have.length >= GRANTS_MAX) {
        throw new ConnectorError("too_many", `A project can have ${GRANTS_MAX} standing permissions, which is the most. Take one back first.`);
      }
      return reply.send({ grant: await s.d.store.addGrant(project.id, wanted) });
    } catch (err) { return fail(reply, err); }
  });

  app.delete<{ Params: { id: string; grantId: string } }>("/v1/code/projects/:id/permissions/:grantId", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      const project = await ownProject(s.d, s.user.id, req.params.id);
      if (!(await s.d.store.deleteGrant(project.id, req.params.grantId))) {
        return reply.code(404).send({ code: "not_found", message: "I couldn't find that permission." });
      }
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  /** A route on a branch of a project: the session, the branch decoded, what step two of a question carries, and the answer or the failure. */
  const onBranch = (
    method: "GET" | "POST" | "DELETE", url: string,
    run: (s: NonNullable<Awaited<ReturnType<typeof begin>>>, projectId: string, branch: string, o: GateOptions) => Promise<unknown>,
  ) => app.route<{ Params: { id: string; branch: string }; Body: Record<string, unknown> | undefined }>({
    method, url, ...RL,
    handler: async (req, reply) => {
      const s = await begin(req.headers["authorization"], reply);
      if (!s) return reply;
      let branch: string;
      try { branch = decodeURIComponent(req.params.branch); } catch {
        return reply.code(404).send({ code: "not_found", message: "I couldn't find that branch in this project." });
      }
      try {
        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
        return reply.send(await run(s, req.params.id, branch, gateOptions(body, req.query)));
      } catch (err) { return fail(reply, err); }
    },
  });
  const B = "/v1/code/projects/:id/branches/:branch";
  onBranch("POST", `${B}/sync`, (s, id, branch, o) => syncBranch(s.d, s.user.id, id, branch, o));
  onBranch("GET", `${B}/diff`, (s, id, branch) => branchDiff(s.d, s.user.id, id, branch));
  onBranch("GET", `${B}/pr`, (s, id, branch) => prStatus(s.d, s.user.id, id, branch));
  onBranch("GET", `${B}/pr/comments`, (s, id, branch) => prComments(s.d, s.user.id, id, branch));
  onBranch("POST", `${B}/pr/ready`, (s, id, branch, o) => markReady(s.d, s.user.id, id, branch, o));
  onBranch("POST", `${B}/pr/close`, (s, id, branch, o) => closePr(s.d, s.user.id, id, branch, o));
  // No approvalId: step one, which merges nothing. With one: step two.
  onBranch("POST", `${B}/pr/merge`, (s, id, branch, o) => mergePr(s.d, s.user.id, id, branch, o));
  onBranch("DELETE", B, (s, id, branch, o) => deleteWorkBranch(s.d, s.user.id, id, branch, o));

  // GitHub is the caller: no session, a signature over the raw body instead (code/webhook.ts).
  app.post("/v1/code/github/webhook", { config: { rateLimit: { max: 600, timeWindow: 60_000 } } }, async (req, reply) => {
    if (!k) return off(reply);
    if (!k.webhookSecret) {
      req.log.error("[code] github webhook hit with no GITHUB_APP_WEBHOOK_SECRET set");
      return notConfigured(reply);
    }
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
    if (!signatureOk(raw, String(req.headers["x-hub-signature-256"] ?? ""), k.webhookSecret)) {
      return reply.code(401).send({ code: "unauthorized" });
    }
    try {
      const brain = k.brain;
      const done = await handleWebhook(k.store, String(req.headers["x-github-event"] ?? ""), req.body, Date.now(), brain ? { pushed: (p) => brain.pushed(p) } : {});
      return reply.code(done === "handled" ? 200 : 202).send({ ok: true });
    } catch (err) {
      // 500, so GitHub shows the delivery as failed and it can be sent again.
      req.log.error({ err }, "[code] github webhook could not be applied");
      return reply.code(500).send({ ok: false });
    }
  });
}

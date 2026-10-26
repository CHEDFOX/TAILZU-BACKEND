/**
 * THE CODE BOT'S GITHUB ROUTES: CONNECT, PICK A PROJECT, START A BRANCH.
 *
 *   POST   /v1/code/github/connect            -> { installUrl }  the link that opens GitHub's install page
 *   GET    /v1/code/github/callback           GitHub sends the browser back here; no session, the signed state says who
 *   GET    /v1/code/github                    -> { configured, connected, installations: [{ id, account, accountType,
 *                                                  repositorySelection, suspended, manageUrl }] }
 *   DELETE /v1/code/github/installations/:id  forget the link and its projects here -> { ok, manageUrl }; GitHub's
 *                                                  install is not touched, manageUrl is where to remove it
 *   POST   /v1/code/github/signin             -> { authorizeUrl }  the other way to connect: "Sign in with GitHub" (code/oauth.ts),
 *                                                  a classic OAuth App with no install. 404 oauth_off unless CODE_GITHUB_OAUTH
 *   GET    /v1/code/github/signin/callback    GitHub sends the browser back here; no session, the signed state says who
 *   DELETE /v1/code/github/signin             -> { ok, revoked }  revokes the token at GitHub, then forgets the link and its projects
 *   GET    /v1/code/repos                     -> { repos: [{ id, fullName, private, defaultBranch, installationId }], truncated,
 *                                                  needsReconnect? }  only repos the person may write to on GitHub (below)
 *   POST   /v1/code/projects { repoId }       -> { project, created }; 404 for a repo outside the person's installs
 *   GET    /v1/code/projects                  -> { projects }
 *   DELETE /v1/code/projects/:id              -> { ok }
 *   POST   /v1/code/projects/:id/branches { task }
 *                                             -> { branch, baseSha, url }  `tailzu/<slug>-<4 hex>` from the default branch's head
 *   GET    /v1/code/projects/:id/branches     -> { branches }
 *   POST   /v1/code/projects/:id/branches/:branch/pr { title, body }
 *                                             -> { prNumber, prUrl, existing }  a draft PR; :branch is URL-encoded
 *                                                  (tailzu%2Ffix-login-1a2b), since the branch has a "/" in it
 *   GET    /v1/code/new-repo-link?name=       -> { url, name }  GitHub's "new repository" page with the name and private filled
 *                                                  in; the person makes the repo, so Tailzu needs no permission to
 *   POST   /v1/code/projects/:id/init { title? }
 *                                             -> { commitSha }  one README.md as the first commit of a repo with NO commits
 *                                                  (409 repo_not_empty otherwise). createWorkBranch on an empty repo: 409 repo_empty
 *
 * and, for a work branch the project recorded (":branch" always URL-encoded), code/pulls.ts:
 *
 *   POST   .../branches/:branch/sync          -> { status: merged | up_to_date, sha? }  the default branch merged INTO
 *                                                  the work branch; a conflict is 409 conflict and the branch's state
 *                                                  `conflict`: never resolved, never forced
 *   GET    .../branches/:branch/diff          -> { aheadBy, behindBy, commits: [{ sha, message }], files: [{ path, status,
 *                                                  additions, deletions }], totals, truncated }  300 files at most, no contents
 *   GET    .../branches/:branch/pr            -> { number, url, title, state: open | closed | merged, draft, mergeable,
 *                                                  mergeableState, headSha, reviewDecision, reviewComments, lastReviewAt }
 *   GET    .../branches/:branch/pr/comments   -> { comments: [{ author, body, path?, line?, createdAt }], truncated }
 *                                                  100 at most; the words are other people's (untrusted text)
 *   POST   .../branches/:branch/pr/ready      -> { draft: false }
 *   POST   .../branches/:branch/pr/close      -> { state: closed }  without merging
 *   POST   .../branches/:branch/pr/merge      no body: -> { needsApproval, approvalId, expiresAt, summary: { title, into,
 *                                                  files, additions, deletions, headSha } }, and nothing is merged;
 *                                                  { approvalId }: -> { merged, sha }, a squash merge of exactly the commit
 *                                                  the approval was for (409 changed_since_approval if the branch moved).
 *                                                  An approval is single-use and lasts ten minutes
 *   DELETE .../branches/:branch               -> { state: deleted }  removes the branch from GitHub once its pull request
 *                                                  is merged or closed; the record stays
 *
 *   POST   /v1/code/github/webhook            GitHub's own deliveries (code/webhook.ts); authenticated by signature
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
import { addProject, createWorkBranch, initEmptyRepo, listBranches, listRepos, newRepoLink, openPr } from "../code/projects.js";
import { branchDiff, closePr, confirmMerge, deleteWorkBranch, markReady, prComments, prStatus, requestMerge, syncBranch } from "../code/pulls.js";
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
const STATUS: Record<string, number> = {
  bad_state: 400, bad_request: 400, bad_branch: 400, bad_path: 400, binary_file: 400, too_large: 400, not_a_file: 400,
  not_yours: 403, no_access: 403, needs_reconnect: 403, not_found: 404,
  branch_moved: 409, branch_exists: 409, conflict: 409, too_many: 409, suspended: 409, nothing_to_review: 409, no_drafts: 409,
  repo_empty: 409, repo_not_empty: 409, branch_deleted: 409, branch_in_use: 409, changed_since_approval: 409, approval_expired: 409,
  approval_invalid: 409, pr_draft: 409, pr_not_open: 409, pr_merged: 409, not_mergeable: 409, use_server_commit: 409,
  oauth_off: 404, needs_signin: 403, not_allowed: 403, org_blocked: 403, scope_too_broad: 403, scope_missing: 403,
  not_configured: 503, busy: 503,
};

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
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof CodeNeedsAccount) return reply.code(403).send({ code: "needs_account", message: err.message });
    if (err instanceof NoTokenKey) return reply.code(503).send({ code: "not_configured", message: err.message });
    if (err instanceof ConnectorError) return reply.code(STATUS[err.code] ?? 502).send({ code: err.code, message: err.message });
    throw err;
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
      return reply.send(await oauth.begin(user.id));
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
      return reply.send(await addProject(s.d, s.user.id, repoId));
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
      return reply.send({ ok: true });
    } catch (err) { return fail(reply, err); }
  });

  app.post<{ Params: { id: string }; Body: { task?: unknown } }>("/v1/code/projects/:id/branches", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await createWorkBranch(s.d, s.user.id, req.params.id, (req.body ?? {}).task));
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

  app.post<{ Params: { id: string }; Body: { title?: unknown } }>("/v1/code/projects/:id/init", RL, async (req, reply) => {
    const s = await begin(req.headers["authorization"], reply);
    if (!s) return reply;
    try {
      return reply.send(await initEmptyRepo(s.d, s.user.id, req.params.id, (req.body ?? {}).title));
    } catch (err) { return fail(reply, err); }
  });

  /** A route on a work branch of a project: the session, the branch decoded, and the answer or the failure. */
  const onBranch = (
    method: "GET" | "POST" | "DELETE", url: string,
    run: (s: NonNullable<Awaited<ReturnType<typeof begin>>>, projectId: string, branch: string, body: Record<string, unknown>) => Promise<unknown>,
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
        return reply.send(await run(s, req.params.id, branch, (req.body && typeof req.body === "object" ? req.body : {})));
      } catch (err) { return fail(reply, err); }
    },
  });
  const B = "/v1/code/projects/:id/branches/:branch";
  onBranch("POST", `${B}/sync`, (s, id, branch) => syncBranch(s.d, s.user.id, id, branch));
  onBranch("GET", `${B}/diff`, (s, id, branch) => branchDiff(s.d, s.user.id, id, branch));
  onBranch("GET", `${B}/pr`, (s, id, branch) => prStatus(s.d, s.user.id, id, branch));
  onBranch("GET", `${B}/pr/comments`, (s, id, branch) => prComments(s.d, s.user.id, id, branch));
  onBranch("POST", `${B}/pr/ready`, (s, id, branch) => markReady(s.d, s.user.id, id, branch));
  onBranch("POST", `${B}/pr/close`, (s, id, branch) => closePr(s.d, s.user.id, id, branch));
  onBranch("POST", `${B}/pr/merge`, (s, id, branch, body) => {
    // No approval: step one, which merges nothing. With one: step two.
    if (body.approvalId === undefined) return requestMerge(s.d, s.user.id, id, branch);
    if (typeof body.approvalId !== "string" || !body.approvalId || body.approvalId.length > 200) {
      throw new ConnectorError("bad_request", "approvalId is the id step one gave.");
    }
    return confirmMerge(s.d, s.user.id, id, branch, body.approvalId);
  });
  onBranch("DELETE", B, (s, id, branch) => deleteWorkBranch(s.d, s.user.id, id, branch));

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
      const done = await handleWebhook(k.store, String(req.headers["x-github-event"] ?? ""), req.body);
      return reply.code(done === "handled" ? 200 : 202).send({ ok: true });
    } catch (err) {
      // 500, so GitHub shows the delivery as failed and it can be sent again.
      req.log.error({ err }, "[code] github webhook could not be applied");
      return reply.code(500).send({ ok: false });
    }
  });
}

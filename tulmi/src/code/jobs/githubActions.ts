/**
 * GITHUB'S FREE COMPUTERS AS A PLACE TO RUN A STEP: A WORKFLOW RUN IN THE PERSON'S OWN REPO, WITH NO TAPS.
 *
 * GithubActionsProvider is the real second place of the router (placement.ts):
 * when no PC of the person's is there, an exec step runs on GitHub Actions in
 * the person's own repo, on the free minutes GitHub gives them, and never
 * touches their work branch.
 *
 * ONE STEP IS ONE SHADOW BRANCH. For exec step N of job J under lease epoch E,
 * dispatch() makes `tailzu-run/<jobShort>-<N>-<E>` (shadow.ts): a new branch at
 * ONE new commit whose parent is the work branch's checkpoint, adding exactly
 * three files the server wrote (workflow.ts): the workflow, `.tailzu/step.json`
 * and `.tailzu/run.mjs`. GitHub sees a push to `tailzu-run/**` and runs the
 * workflow; the script runs the commands and reports back. Making the branch,
 * and deleting it when the step is over, are the policy's narrow free action
 * `runner.shadow` (policy.ts), which only the server can reach.
 *
 * THE LEASE'S HOLDER is `<branch>@<commit>`: the one record the job store
 * already keeps carries the shadow commit's id, which is what the result is
 * checked against. A restart of the server forgets nothing.
 *
 * WHEN IT IS AVAILABLE. Only if the connection may do it: the App's install has
 * Workflows: write (to commit the workflow file) and Actions: read (to see a
 * run), or a sign-in token has the `workflow` scope (oauth.beginWorkflow, the
 * incremental sign-in). Without them `available()` says no with the reason
 * `needs_workflow_permission` and the router moves on to the next place. Before a
 * project is used its `.github/workflows/*` on the default branch are read: a
 * workflow that runs on every push (with no branch filter) would also run on
 * the shadow branch and spend the person's minutes. That is recorded (`ciNoise`,
 * ciNoise.ts), counted as an estimate of extra minutes, and shown on the
 * project; it never blocks. A public repo's minutes aren't metered, so they
 * don't count toward the free estimate.
 *
 * THE RESULT comes back to POST /v1/code/runner/gh-result with an OIDC identity
 * token, and handleResult() accepts it only if ALL of these hold: GitHub signed
 * it (RS256, the key from GitHub's JWKS, or the injected resolver in tests);
 * `iss` is GitHub's Actions issuer; `aud` is CODE_RUNNER_OIDC_AUDIENCE;
 * `exp`/`nbf` are fine; `repository_id` is the project's repo; `event_name` is
 * push; `ref` is exactly the shadow branch of that job, step and epoch;
 * `workflow_ref` ends with our workflow file at that branch; and `sha` is the
 * commit this provider recorded (so nobody with push access can mint a token
 * for a branch of the same name holding a different commit). Then the result
 * goes to the router's own path (submitResult), epoch fence and all: a stale
 * epoch is refused as stale_lease, and the server commits the changes through
 * the policy as for a PC's, where any change touching the runner's files is
 * refused ("never"). Whatever happens, the shadow branch is deleted after.
 *
 * MINUTES are rounded up to whole minutes per job, as GitHub bills (at least
 * one). A public repo counts 0; a private one counts the minutes plus the
 * estimate for the person's own CI that the push also started.
 *
 * THE TICKER looks at each step that is out (check(), called by the router's
 * tick every 15 seconds; the router renews the lease while the answer is
 * "waiting"): no run three minutes after the push, or a run that ended without
 * reporting, is taken as the free minutes being used up or Actions being off
 * (the router marks the person's GitHub minutes used up for the month, and
 * moves the step); a run still going two minutes past the step's own timeout
 * is cancelled (cancel(), if the App has Actions: write; else GitHub's own
 * timeout-minutes ends it) and the step moved.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { ConnectorError } from "../../connectors/state.js";
import type { GithubRun } from "../github.js";
import { gateFree } from "../policy.js";
import { assertAccess, gateBase, ownProject, repoRef, type ProjectDeps } from "../projects.js";
import { SHADOW_WORKFLOW, holderOf, parseHolder, shadowBranchName } from "../shadow.js";
import type { CodeProject } from "../store.js";
import { CI_WORKFLOWS_MAX, ciNoiseOf, type CiNoise } from "./ciNoise.js";
import { NoPlace, type Availability, type AvailabilityCtx, type ComputeProvider, type RunCheck } from "./providers.js";
import { readResult, type JobRouter, type ResultAck } from "./router.js";
import type { JobStore } from "./store.js";
import { GITHUB_NO_RUN_MS, GITHUB_OVERRUN_MS, type CodeJob, type JobStep } from "./types.js";
import { shadowFiles } from "./workflow.js";

export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const OIDC_JWKS_URL = `${OIDC_ISSUER}/.well-known/jwks`;
export const OIDC_AUDIENCE_DEFAULT = "tailzu";
/** What the commit on a shadow branch says. */
const SHADOW_MESSAGE = "Tailzu: run a step on GitHub (a temporary branch, deleted when the step is over)";
/** What the install's permissions are kept for, so asking whether the provider is available is not a call to GitHub every time. */
const PERMS_KEEP_MS = 2 * 60_000;
/** What a read of the repo's workflows is kept for. */
const CI_KEEP_MS = 60 * 60_000;
const WORKFLOWS_DIR = ".github/workflows";

export interface GithubActionsOptions {
  /** The Code bot's own pieces (projects.ts): the store of projects, GitHub, the approvals. */
  d: ProjectDeps;
  /** The jobs' store: a result names a job, and the job says whose it is. */
  jobs: JobStore;
  /** The audience of the identity token (CODE_RUNNER_OIDC_AUDIENCE, "tailzu"). */
  audience?: string;
  /** Where the script reports: the address of POST /v1/code/runner/gh-result. */
  resultUrl: string;
  /** Finds the key an identity token was signed with. Default: GitHub's own JWKS, fetched when first needed. Tests pass local keys. */
  keys?: JWTVerifyGetKey;
  /** Epoch ms. Tests move it. */
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** What the person has let Tailzu do on GitHub, as far as this provider is concerned. */
interface Perms { workflows: boolean; actionsRead: boolean; actionsWrite: boolean }

const badToken = (m: string) => new ConnectorError("bad_runner_token", m);
const mismatch = (m: string) => new ConnectorError("runner_mismatch", m);
const missing = () => new ConnectorError("not_found", "I couldn't find that job.");

export class GithubActionsProvider implements ComputeProvider {
  readonly kind = "github" as const;
  private readonly audience: string;
  private readonly keys: JWTVerifyGetKey;
  private remote: JWTVerifyGetKey | null = null;
  private readonly perms_ = new Map<string, { perms: Perms; until: number }>();
  private readonly ci_ = new Map<string, { noise: CiNoise; checkedAt: number }>();

  constructor(private readonly o: GithubActionsOptions) {
    this.audience = o.audience ?? OIDC_AUDIENCE_DEFAULT;
    this.keys = o.keys ?? ((header, token) => (this.remote ??= createRemoteJWKSet(new URL(OIDC_JWKS_URL)))(header, token));
  }

  private now(): number { return (this.o.now ?? Date.now)(); }

  // ----------------------------------------------------------- permissions

  /** Whether the connection that reaches this project may commit a workflow file and read a run (and cancel one). Kept two minutes. */
  private async perms(userId: string, project: CodeProject): Promise<Perms> {
    const key = project.linkKind === "oauth" ? `o|${userId}` : `a|${project.installationId}`;
    const hit = this.perms_.get(key);
    if (hit && hit.until > this.now()) return hit.perms;
    const { github } = this.o.d;
    let perms: Perms;
    if (project.linkKind === "oauth") {
      // The person's own token: the incremental sign-in adds `workflow`; `repo` covers reading and cancelling runs.
      const scopes = await github.scopesOf(repoRef(this.o.d, userId, project));
      perms = { workflows: scopes.includes("workflow"), actionsRead: scopes.includes("repo"), actionsWrite: scopes.includes("repo") };
    } else {
      const given = await github.installationPermissions(project.installationId);
      perms = {
        workflows: given.workflows === "write",
        actionsRead: given.actions === "read" || given.actions === "write" || given.actions === "admin",
        actionsWrite: given.actions === "write" || given.actions === "admin",
      };
    }
    if (this.perms_.size > 1000) this.perms_.clear();
    this.perms_.set(key, { perms, until: this.now() + PERMS_KEEP_MS });
    return perms;
  }

  // ------------------------------------------------------ the person's own CI

  /**
   * The project's `.github/workflows/*` on the default branch, read for
   * workflows that would also run on a shadow branch (ciNoise.ts). Kept an
   * hour; a repo that can't be read says nothing (null) rather than guessing.
   */
  async ciNoiseFor(userId: string, project: CodeProject): Promise<(CiNoise & { checkedAt: number }) | null> {
    const hit = this.ci_.get(project.id);
    if (hit && this.now() - hit.checkedAt < CI_KEEP_MS) return { ...hit.noise, checkedAt: hit.checkedAt };
    try {
      const { github } = this.o.d;
      const repo = repoRef(this.o.d, userId, project);
      const entries = (await github.listDir(repo, WORKFLOWS_DIR, project.defaultBranch))
        .filter((e) => e.type === "file" && /\.ya?ml$/i.test(e.name)).slice(0, CI_WORKFLOWS_MAX);
      const files: Array<{ path: string; text: string }> = [];
      for (const e of entries) {
        try { files.push({ path: e.path, text: (await github.readFile(repo, project.defaultBranch, e.path)).text }); } catch { /* one that can't be read says nothing */ }
      }
      const noise = ciNoiseOf(files);
      if (this.ci_.size > 1000) this.ci_.clear();
      const checkedAt = this.now();
      this.ci_.set(project.id, { noise, checkedAt });
      return { ...noise, checkedAt };
    } catch {
      return hit ? { ...hit.noise, checkedAt: hit.checkedAt } : null;
    }
  }

  // ------------------------------------------------------- ComputeProvider

  async available(ctx: AvailabilityCtx): Promise<Availability> {
    try {
      const project = await this.o.d.store.getProject(ctx.userId, ctx.projectId);
      if (!project) return { ok: false, reason: "not_found" };
      await assertAccess(this.o.d, ctx.userId, project);
      const perms = await this.perms(ctx.userId, project);
      if (!perms.workflows || !perms.actionsRead) return { ok: false, reason: "needs_workflow_permission" };
      const noise = project.private ? await this.ciNoiseFor(ctx.userId, project) : null;
      return {
        ok: true, places: 1,
        // A public repo's minutes are free without limit: they don't count, and nothing else the person runs matters.
        ...(project.private ? {} : { unmetered: true }),
        ...(noise?.ciNoise ? { extraMinutes: noise.extraMinutes } : {}),
      };
    } catch (err) {
      return { ok: false, reason: err instanceof ConnectorError ? err.code : "unavailable" };
    }
  }

  async dispatch(job: CodeJob, step: JobStep): Promise<{ holder: string }> {
    const { d } = this.o;
    const project = await ownProject(d, job.userId, job.projectId);
    await assertAccess(d, job.userId, project, true);
    const perms = await this.perms(job.userId, project);
    if (!perms.workflows || !perms.actionsRead) throw new NoPlace("needs_workflow_permission");
    // The commit file is a workflow: the App's token for this call also carries Workflows: write.
    const repo = { ...repoRef(d, job.userId, project), workflows: true };
    const baseSha = job.checkpoint.headSha || (await d.github.branchHead(repo, job.branch));
    const branch = shadowBranchName(job.id, step.idx, job.leaseEpoch);
    const files = shadowFiles({
      jobId: job.id, stepIdx: step.idx, epoch: job.leaseEpoch, commands: step.commands, timeoutSec: step.timeoutSec,
      baseSha, resultUrl: this.o.resultUrl, audience: this.audience, overlay: step.overlay, discard: step.discard,
    });
    const made = await gateFree({
      ...gateBase(d, job.userId, project), attended: false, action: "runner.shadow", branch, server: true, paths: files.map((f) => f.path),
      summary: () => ({ branch }),
      run: () => d.github.createShadowBranch(repo, branch, baseSha, files, SHADOW_MESSAGE),
    });
    return { holder: holderOf(branch, made.sha) };
  }

  /** Cancels the run (if the connection may), then deletes the shadow branch. Best effort: the router has fenced the step already, and nothing here throws. */
  async cancel(job: CodeJob): Promise<void> {
    const held = parseHolder(job.leaseHolder);
    if (!held) return;
    try {
      const { d } = this.o;
      const project = await ownProject(d, job.userId, job.projectId);
      const perms = await this.perms(job.userId, project);
      if (perms.actionsWrite) {
        try {
          const repo = { ...repoRef(d, job.userId, project), actions: "write" as const };
          const run = await d.github.latestRun(repo, held.branch);
          if (run && run.status !== "completed" && run.headSha === held.sha) await d.github.cancelRun(repo, run.id);
        } catch (err) {
          this.o.log?.warn({ jobId: job.id, error: (err as { code?: string })?.code }, "github actions: could not cancel a run");
        }
      }
      await this.removeBranch(job.userId, project, held.branch);
    } catch (err) {
      this.o.log?.warn({ jobId: job.id, error: (err as { code?: string })?.code }, "github actions: could not let go of a step");
    }
  }

  /** Where a step that is out has got to (see the top of this file). */
  async check(job: CodeJob, step: JobStep): Promise<RunCheck> {
    const now = this.now();
    const started = step.startedAt ?? now;
    const pastTime = now > started + step.timeoutSec * 1000 + GITHUB_OVERRUN_MS;
    const overrun: RunCheck = {
      state: "lost", why: "overrun", exhausted: false,
      reason: "The run on GitHub went on well past the time it was given. Finding another place.",
    };
    const waiting: RunCheck = { state: "waiting" };
    const held = parseHolder(job.leaseHolder);
    if (!held) return pastTime ? overrun : waiting;
    let run: GithubRun | null;
    try {
      const { d } = this.o;
      const project = await ownProject(d, job.userId, job.projectId);
      run = await d.github.latestRun({ ...repoRef(d, job.userId, project), actions: "read" }, held.branch);
    } catch {
      // GitHub can't be asked just now: only the clock can tell.
      return pastTime ? overrun : waiting;
    }
    if (run && run.headSha !== held.sha) run = null;
    if (!run) {
      return now - started > GITHUB_NO_RUN_MS
        ? {
          state: "lost", why: "no_run", exhausted: true,
          reason: "GitHub didn't start the run, which usually means this month's free minutes are used up or Actions is switched off for the repo. Finding another place.",
        }
        : waiting;
    }
    if (run.status === "completed") {
      return {
        state: "lost", why: "no_result",
        // Someone cancelling it by hand is not the minutes running out; anything else that ends a run before it reports is.
        exhausted: run.conclusion !== "cancelled",
        reason: run.conclusion === "cancelled"
          ? "The run on GitHub was cancelled before it reported. Finding another place."
          : "The run on GitHub ended without reporting back, which usually means a limit on the free minutes. Finding another place.",
      };
    }
    return pastTime ? overrun : waiting;
  }

  // ------------------------------------------------------------ the result

  /**
   * A result from the script on the person's runner: POST
   * /v1/code/runner/gh-result with `Authorization: Bearer <identity token>`.
   * Everything is checked before anything is counted (the top of this file);
   * then it goes to the router's own result path, and the shadow branch is
   * deleted whatever the router said. Throws ConnectorError: bad_runner_token
   * (401), runner_mismatch (403), bad_request, not_found, stale_lease (409).
   */
  async handleResult(router: JobRouter, authorization: string | undefined, body: unknown): Promise<ResultAck> {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw badToken("A runner's result carries the identity token GitHub gave its run.");
    const claims = await this.verify(token);
    // Read as a desktop's would be: the body can't say what counts (a `billable` or `paise` in it is not read), the server works that out below.
    const r = readResult(body, "desktop");
    const job = await this.o.jobs.getJobById(r.jobId);
    if (!job) throw missing();
    const project = await this.o.d.store.getProject(job.userId, job.projectId);
    if (!project) throw missing();

    const branch = shadowBranchName(job.id, r.stepIdx, r.epoch);
    if (String(claims.repository_id) !== String(project.repoId)) throw mismatch("That token is for another repo.");
    if (claims.event_name !== "push") throw mismatch("That token is not from a push.");
    if (claims.ref !== `refs/heads/${branch}`) throw mismatch("That token is not from this step's branch.");
    if (typeof claims.workflow_ref !== "string" || !claims.workflow_ref.endsWith(`${SHADOW_WORKFLOW}@refs/heads/${branch}`)) {
      throw mismatch("That token is not from Tailzu's workflow.");
    }
    // The commit it ran must be the one made for this lease. When the step is no longer out under this epoch there is nothing to compare it to, and the router refuses it (stale) or recognises it (duplicate).
    const held = parseHolder(job.leaseHolder);
    if (job.state === "running" && job.placement === "github" && job.leaseEpoch === r.epoch) {
      if (!held || held.branch !== branch || claims.sha !== held.sha) throw mismatch("That token is not for the commit made for this step.");
    }

    // Whole minutes per job, as GitHub bills (at least one). A public repo counts none; a private one also the person's own CI this push started.
    const minutes = Math.max(1, r.minutes);
    let billable = 0;
    if (project.private) {
      const noise = await this.ciNoiseFor(job.userId, project);
      billable = minutes + (noise?.ciNoise ? noise.extraMinutes : 0);
    }
    try {
      return await router.submitResult(job.userId, {
        jobId: r.jobId, stepIdx: r.stepIdx, epoch: r.epoch, exitCode: r.exitCode, outputTail: r.outputTail, minutes, billable,
        ...(r.changes ? { changes: r.changes } : {}),
      }, "github");
    } finally {
      await this.removeBranch(job.userId, project, branch);
    }
  }

  /** The identity token's claims, once GitHub's signature, issuer, audience and times have checked out. */
  private async verify(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: OIDC_ISSUER, audience: this.audience, algorithms: ["RS256"], currentDate: new Date(this.now()), clockTolerance: 5,
        requiredClaims: ["exp", "iat"],
      });
      return payload;
    } catch {
      throw badToken("That isn't an identity token GitHub issued for Tailzu, or it has expired.");
    }
  }

  // ---------------------------------------------------------- the branch

  /** Deletes a shadow branch through the policy (runner.shadow, free for the server). A branch that is already gone is fine; a failure is logged, never thrown. */
  private async removeBranch(userId: string, project: CodeProject, branch: string): Promise<void> {
    const { d } = this.o;
    try {
      const repo = repoRef(d, userId, project);
      await gateFree<boolean>({
        ...gateBase(d, userId, project), attended: false, action: "runner.shadow", branch, server: true,
        summary: () => ({ branch, delete: true }),
        run: () => d.github.deleteBranch(repo, branch),
      });
    } catch (err) {
      this.o.log?.warn({ branch, error: (err as { code?: string })?.code }, "github actions: could not delete a shadow branch");
    }
  }
}

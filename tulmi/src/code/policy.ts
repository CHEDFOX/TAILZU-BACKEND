/**
 * WHAT THE CODE BOT MAY DO, WHAT IT ASKS ABOUT, AND WHAT IT NEVER DOES.
 *
 * The bot is not fenced into one corner of a repo. It works the way Claude Code
 * works with git: it has principles (GIT_PRINCIPLES, below), and a permission
 * system that decides, for each thing it is about to do, whether to just do it,
 * ask the person first, or refuse. The person can answer an "ask" once and for
 * all (a STANDING GRANT, kept per project), and can forbid something for good
 * (a "deny" grant). This file is that system. Nothing in it touches GitHub.
 *
 * FOUR TIERS. Every action in the catalog (ACTIONS) has one:
 *
 *   free         just do it:  read; make a branch (from any ref); commit and
 *                push to a branch the bot made; open a DRAFT pull request;
 *                bring its own branch up to date with the default branch;
 *                comment on its own pull request
 *   ask          do it only after the person says yes:  commit or push to any
 *                other existing branch, the default branch included; merge a
 *                pull request; mark one ready or close one; delete a branch;
 *                change a `.github/workflows/*` file (which also needs the
 *                token or the App to be allowed to: the "workflow" scope);
 *                start an empty repo with a first README
 *   ask_strict   ask EVERY time, with Face ID on the phone (`faceId: true`),
 *                and no standing grant can ever lift it:  a force-push or
 *                anything that is not a fast-forward; deleting the default
 *                branch; committing something the secret scanner flags;
 *                changing a repo's visibility (nothing does that yet)
 *   never        refuse, whatever anyone says:  a path that escapes the repo
 *                or writes inside `.git/`; deleting the repo; touching the
 *                runner's own files (`.tailzu/`, the workflow `tailzu-run.yml`)
 *                or a `tailzu-run/` branch (shadow.ts)
 *
 * ONE FREE ACTION IS THE SERVER'S ALONE. `runner.shadow` is how the provider
 * for GitHub's free computers (jobs/githubActions.ts) makes, and later deletes,
 * the throwaway `tailzu-run/` branch a step runs on. It is free, and it is
 * narrow: only a ref starting `tailzu-run/`, only the three exact files the
 * server wrote, and only when the caller says it is the server (`server: true`,
 * which no commit of an agent and no result of a runner ever sets). Anything
 * else is a denial. The other side of the same rule is `runner.reserved`
 * ("never"): an agent's commit, and the changes a runner hands back, can never
 * write those paths or create or move such a ref.
 *
 * decide() is the ONE function that turns an action and a situation into
 * "allow", "ask" or "deny". Its order, which is the whole policy:
 *
 *   1. a "never" action is denied, and nothing below can change that;
 *   2. an action that is only free on a branch the bot made (committing,
 *      syncing, commenting) is "ask" on any other branch;
 *   3. an action that needs a token permission the token lacks is denied
 *      ("missing_scope");
 *   4. a live DENY grant that matches (this action, this branch) denies it. A
 *      deny beats everything except step 1, and it beats a free action too;
 *   5. a free action is allowed;
 *   6. an "ask" action with a live ALLOW grant that matches is allowed
 *      ("standing_permission"). An "ask_strict" action ignores allow grants;
 *   7. otherwise it asks. With nobody there to ask (attended: false) that is
 *      a denial with the reason "needs_you", so whoever called can tell the
 *      person "this needs your OK" (a notification) instead of failing.
 *
 * gate() is how an operation (a commit, a merge, a delete...) uses decide():
 *
 *   - allowed: it runs;
 *   - ask: nothing is done. The first call answers `{ needsApproval: true,
 *     approvalId, action, summary, faceId, expiresAt }`, and the approval book
 *     (approvals.ts) writes down what was looked at: this person, project,
 *     action and branch, and where it matters the commit the branch was at and
 *     a fingerprint of what would be written. Repeating the call with that
 *     `approvalId` does it, once, within ten minutes, and ONLY if the branch is
 *     still at that commit and the thing to be done is still that thing;
 *   - denied: a PolicyError says why, in plain words, with a code the phone
 *     can act on (needs_you, policy_denied, needs_workflow_scope, never).
 *
 * THE SECRET SCAN. Before any commit the new contents (not deletions) are read
 * by scanForSecrets: AWS keys, GitHub tokens, private-key headers, Slack
 * tokens, a long random value after `api_key=` or `secret=`, `.env` files,
 * and Gitleaks' default rules (secrets/gitleaks.ts: about 220 providers, each
 * behind its keywords, an entropy floor and its allowlists; MIT, see
 * THIRD_PARTY_NOTICES.md).
 * A hit makes that commit "commit.secret", which is ask_strict, and the
 * approval card shows which files and what kind of thing, never the value. The
 * values are not kept, not logged and not put in any error, anywhere.
 *
 * GIT_PRINCIPLES is the policy's statement of them in plain words, for the person
 * and the tests. The agent's prompt no longer carries the list as it stands: the agent
 * cannot touch git (the server commits what it staged), and what a model can act on
 * (no secrets, no workflow edits, green tests, the permission rules decide) is said
 * once in the principles library (principles/library.ts). The permission system is
 * what makes the principles hold when a prompt doesn't.
 */
import { createHash } from "node:crypto";
import { ConnectorError } from "../connectors/state.js";
import type { Approval, ApprovalBook } from "./approvals.js";
import { FILE_MAX_BYTES, assertRepoPath, type CommitFile } from "./github.js";
import { gitleaksKinds } from "./secrets/gitleaks.js";
import { SHADOW_PREFIX, isExactShadowSet, isReservedPath, isShadowBranch } from "./shadow.js";
import type { CodeGrant, CodeProject, CodeStore, NewCodeGrant } from "./store.js";

// ---------------------------------------------------------------- principles

/** The rules of working with git, in plain English: the policy's own statement of what the permission system enforces. */
export const GIT_PRINCIPLES: readonly string[] = [
  "Work on your own branch by default: start a tailzu/ branch for each task instead of changing someone else's.",
  "Make small commits with clear messages that say what changed and why.",
  "Never force-push or rewrite history unless the person asked for exactly that.",
  "Never skip checks: no bypassing hooks, tests, reviews or required status checks to get something through.",
  "Never commit secrets: keys, tokens, passwords and .env files stay out of git. If one slipped in, say so.",
  "Respect branch protection. If GitHub refuses because of it, report that plainly and never try to get round it.",
  "Prefer a pull request for anything bigger than a small fix, so a person can look before it lands.",
];

// ------------------------------------------------------------------ the catalog

export type Tier = "free" | "ask" | "ask_strict" | "never";

export interface ActionDef {
  tier: Tier;
  /** A few words, for the approval card and the permissions screen. */
  label: string;
  /** Whether the action is about one branch (so a grant can name branches). */
  branchScoped: boolean;
  /** Free only on a branch the bot made; "ask" on any other. */
  ownOnly?: boolean;
  /** A scope the token (or the App) must have for the action to be possible at all. */
  needsScope?: string;
}

export const ACTIONS = {
  // --- free
  "read": { tier: "free", label: "Read the repo", branchScoped: true },
  "branch.create": { tier: "free", label: "Make a branch", branchScoped: false },
  "commit.own_branch": { tier: "free", label: "Commit to a branch X0 Bot made", branchScoped: true },
  "pr.open_draft": { tier: "free", label: "Open a draft pull request", branchScoped: true },
  "branch.sync": { tier: "free", label: "Bring a branch up to date with the default branch", branchScoped: true, ownOnly: true },
  "pr.comment": { tier: "free", label: "Comment on a pull request", branchScoped: true, ownOnly: true },
  // The server's alone (see runner.shadow above): a throwaway tailzu-run/ branch with three files, to run a step on GitHub's free computers.
  "runner.shadow": { tier: "free", label: "Run a step on GitHub's free computers (a tailzu-run/ branch)", branchScoped: true },
  // --- ask
  "commit.other_branch": { tier: "ask", label: "Commit to a branch X0 Bot didn't make", branchScoped: true },
  "pr.merge": { tier: "ask", label: "Merge a pull request", branchScoped: true },
  "pr.ready": { tier: "ask", label: "Mark a pull request ready for review", branchScoped: true },
  "pr.close": { tier: "ask", label: "Close a pull request", branchScoped: true },
  "branch.delete": { tier: "ask", label: "Delete a branch", branchScoped: true },
  "workflow.write": { tier: "ask", label: "Change a GitHub Actions workflow file", branchScoped: true, needsScope: "workflow" },
  "repo.init": { tier: "ask", label: "Start an empty repo with a README", branchScoped: false },
  // --- ask, every time, with Face ID
  "push.force": { tier: "ask_strict", label: "Force-push, or rewrite history", branchScoped: true },
  "branch.delete_default": { tier: "ask_strict", label: "Delete the default branch", branchScoped: true },
  "commit.secret": { tier: "ask_strict", label: "Commit something that looks like a secret", branchScoped: true },
  "repo.visibility": { tier: "ask_strict", label: "Change who can see the repo", branchScoped: false },
  // --- never
  "path.escape": { tier: "never", label: "Write outside the repo or inside .git", branchScoped: false },
  "repo.delete": { tier: "never", label: "Delete the repo", branchScoped: false },
  "runner.reserved": { tier: "never", label: "Write X0 Bot's runner files or a tailzu-run/ branch", branchScoped: false },
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;

export const isActionId = (v: unknown): v is ActionId => typeof v === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, v);

const def = (a: ActionId): ActionDef => ACTIONS[a];
/** Needs Face ID on the phone, every time. */
export const needsFaceId = (a: ActionId): boolean => def(a).tier === "ask_strict";
/** A standing grant (allow or deny) may be made for it: the tier is free or ask. */
export const isGrantable = (a: ActionId): boolean => def(a).tier === "free" || def(a).tier === "ask";

/** The catalog as the phone's permissions screen needs it. */
export function actionCatalog(): Array<{ id: ActionId; tier: Tier; label: string; faceId: boolean; grantable: boolean; branchScoped: boolean }> {
  return (Object.keys(ACTIONS) as ActionId[]).map((id) => ({
    id, tier: def(id).tier, label: def(id).label, faceId: needsFaceId(id), grantable: isGrantable(id), branchScoped: def(id).branchScoped,
  }));
}

// ----------------------------------------------------------------------- grants

/** Standing grants one project can have. */
export const GRANTS_MAX = 100;
const PATTERN_OK = /^[A-Za-z0-9._\-/*?]{1,200}$/;

/**
 * A branch name against a grant's pattern: "main" is exactly main, "release/*"
 * is release/ and anything without a slash after it, "**" crosses slashes, "?"
 * is one character that is not a slash. No pattern is every branch; a pattern
 * can't match no branch at all (an action with no branch).
 */
export function branchMatches(pattern: string | undefined, branch: string | undefined): boolean {
  if (pattern === undefined || pattern === "") return true;
  if (branch === undefined) return false;
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") { re += ".*"; i += 1; } else re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`).test(branch);
}

/**
 * A new grant from a request body, checked: a known action whose tier can be
 * granted (never an "ask_strict" or a "never" one, for allow or deny alike), a
 * pattern only for an action about a branch, an expiry in the future. Throws a
 * ConnectorError: bad_request, or not_grantable.
 */
export function parseGrant(body: unknown, now = Date.now()): NewCodeGrant {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const bad = (why: string) => new ConnectorError("bad_request", why);
  if (!isActionId(b.action)) throw bad("Say which action: one of the names in the list of actions.");
  const action = b.action;
  if (!isGrantable(action)) {
    throw new ConnectorError(
      "not_grantable",
      def(action).tier === "never" ? "X0 Bot never does that, so there is nothing to allow or forbid." : "That always asks you, with Face ID, every time. It can't be allowed for good.",
    );
  }
  const effect = b.effect === undefined ? "allow" : b.effect;
  if (effect !== "allow" && effect !== "deny") throw bad("effect is allow or deny.");
  let branchPattern: string | undefined;
  if (b.branchPattern !== undefined && b.branchPattern !== null && b.branchPattern !== "") {
    if (typeof b.branchPattern !== "string" || !PATTERN_OK.test(b.branchPattern) || b.branchPattern.includes("..") || b.branchPattern.startsWith("/")) {
      throw bad("branchPattern is a branch name, or a pattern with * and ? in it (like release/*).");
    }
    if (!def(action).branchScoped) throw bad("That action isn't about a branch, so it can't name one.");
    branchPattern = b.branchPattern;
  }
  let expiresAt: number | undefined;
  if (b.expiresAt !== undefined && b.expiresAt !== null) {
    const t = typeof b.expiresAt === "number" ? b.expiresAt : typeof b.expiresAt === "string" ? Date.parse(b.expiresAt) : NaN;
    if (!Number.isFinite(t) || t <= now) throw bad("expiresAt is a time in the future.");
    expiresAt = Math.floor(t);
  }
  return { action, effect, ...(branchPattern !== undefined ? { branchPattern } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}) };
}

// ----------------------------------------------------------------------- decide

export interface PolicyCtx {
  /** The project the action is in. */
  project: Pick<CodeProject, "id">;
  /** The branch it is about, if it is about one. */
  branch?: string;
  defaultBranch: string;
  /** Whether a person is there to be asked. False: anything that would ask is refused as "needs_you". */
  attended: boolean;
  /** Which way the project is connected. */
  connection: "app" | "oauth";
  /** What the token may do on GitHub (access.ts): has "workflow" when it may change workflow files. */
  scopes: readonly string[];
  /** The project's standing permissions (store.listGrants). Left out: none. */
  grants?: readonly CodeGrant[];
  /** Whether the branch is one the bot made (a branch Tailzu recorded). */
  ownBranch?: boolean;
  /** Epoch ms, for the expiry of grants. */
  now?: number;
  /** The server itself is acting (its own runner provider), not an agent and not a runner's result. Only runner.shadow looks at it. */
  server?: boolean;
  /** The paths a runner.shadow commit would hold. Left out for a delete, which holds none. */
  paths?: readonly string[];
}

export type Reason =
  | "free" | "standing_permission"
  | "needs_approval" | "needs_strict_approval"
  | "never" | "denied_by_grant" | "missing_scope" | "needs_you" | "unknown_action";

export interface Decision {
  effect: "allow" | "ask" | "deny";
  tier: Tier;
  reason: Reason;
  /** The phone puts Face ID in front of it. */
  faceId: boolean;
  /** The action that was decided: the one asked about, or the stricter one it fell to (committing to a branch the bot didn't make). */
  action: ActionId;
}

/** The one function that says what happens: see the top of this file for the order. */
export function decide(action: ActionId, ctx: PolicyCtx): Decision {
  if (!isActionId(action)) return { effect: "deny", tier: "never", reason: "unknown_action", faceId: false, action };
  const d = def(action);
  const own = ctx.ownBranch === true && ctx.branch !== undefined && ctx.branch !== ctx.defaultBranch;
  const out = (effect: Decision["effect"], tier: Tier, reason: Reason, a: ActionId = action): Decision => ({ effect, tier, reason, faceId: needsFaceId(a), action: a });

  if (d.tier === "never") return out("deny", "never", "never");
  // The server's own narrow action: a tailzu-run/ ref, the exact three files, and only when the server says it is the one acting.
  if (action === "runner.shadow" && !(ctx.server === true && typeof ctx.branch === "string" && ctx.branch.startsWith(SHADOW_PREFIX)
    && !ctx.branch.includes("..") && (ctx.paths === undefined || isExactShadowSet(ctx.paths)))) {
    return out("deny", "never", "never");
  }
  // Committing to a branch the bot didn't make is a different, asking action.
  if (action === "commit.own_branch" && !own) return decide("commit.other_branch", ctx);
  let tier: Tier = d.tier;
  if (d.ownOnly && !own) tier = "ask";

  if (d.needsScope && !ctx.scopes.includes(d.needsScope)) return out("deny", tier, "missing_scope");

  const now = ctx.now ?? Date.now();
  const live = (ctx.grants ?? []).filter((g) => g.projectId === ctx.project.id && g.action === action
    && (g.expiresAt === undefined || g.expiresAt > now) && safeMatch(g.branchPattern, ctx.branch));
  if (live.some((g) => g.effect === "deny")) return out("deny", tier, "denied_by_grant");

  if (tier === "free") return out("allow", tier, "free");
  if (tier === "ask" && live.some((g) => g.effect === "allow")) return out("allow", tier, "standing_permission");
  if (!ctx.attended) return out("deny", tier, "needs_you");
  return out("ask", tier, tier === "ask_strict" ? "needs_strict_approval" : "needs_approval");
}

function safeMatch(pattern: string | undefined, branch: string | undefined): boolean {
  try { return branchMatches(pattern, branch); } catch { return false; }
}

// --------------------------------------------------------------- the secret scan

export interface SecretHit {
  path: string;
  /** What kind of thing it looks like ("an AWS access key"), never the thing. */
  kinds: string[];
}

/** Shannon entropy of a string, in bits per character. */
function entropy(s: string): number {
  const n = new Map<string, number>();
  for (const c of s) n.set(c, (n.get(c) ?? 0) + 1);
  let h = 0;
  for (const k of n.values()) { const p = k / s.length; h -= p * Math.log2(p); }
  return h;
}

const FIXED: Array<{ kind: string; re: RegExp }> = [
  { kind: "an AWS access key", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/ },
  { kind: "a GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  { kind: "a GitHub token", re: /\bgithub_pat_[A-Za-z0-9_]{22,255}/ },
  { kind: "a private key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: "a Slack token", re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "a Slack token", re: /\bxapp-[0-9]-[A-Za-z0-9-]{10,}/ },
  { kind: "a Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: "a Stripe webhook secret", re: /\bwhsec_[A-Za-z0-9]{24,}\b/ },
  { kind: "a model API key", re: /\bsk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "a Slack webhook address", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{16,}/ },
];

/** `api_key = "..."`, `"secret": "..."`, `CLIENT_SECRET=...`: a name that says it is a secret, then a long value. */
const GENERIC = /(?:api[_-]?key|apikey|secret(?:[_-]?key)?|client[_-]?secret|auth[_-]?token|access[_-]?token|private[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=]{20,})/gi;
/** Words that mean the value is a stand-in, not a secret. */
const PLACEHOLDER = /example|placeholder|changeme|change[_-]me|your|replace|dummy|sample|redacted|xxxx|0000|1234567890abcdef/i;

/** A long value that looks random: has letters and digits, enough variety, not a stand-in. */
function looksRandom(v: string): boolean {
  return /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !PLACEHOLDER.test(v) && entropy(v) >= 3.2;
}

/** `.env`, `.env.local`, `.env.production`...; not the committed examples (`.env.example`, `.env.sample`, ...). */
function isEnvFile(path: string): boolean {
  const base = path.split("/").pop()!.toLowerCase();
  return /^\.env(\..+)?$/.test(base) && !/\.(?:example|sample|template|dist|defaults?|schema)$/.test(base);
}

/**
 * Which of the files' NEW contents look like they hold a secret. A deletion has
 * no new contents and is never flagged. Returns the paths (each once, in order)
 * and what kind of thing each looked like; the matched text is thrown away the
 * moment it is matched. `{ gitleaks: false }` leaves out the Gitleaks rules (the benchmark compares the scan with and without them).
 */
export function scanForSecrets(files: readonly CommitFile[], opts: { gitleaks?: boolean } = {}): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const f of files) {
    if (!f || typeof f.path !== "string" || f.delete === true || f.content === null || typeof f.content !== "string") continue;
    // A file over the size a commit may carry is refused before it is written (github.ts commitTreeEntries): not worth reading.
    if (f.content.length > FILE_MAX_BYTES) continue;
    const kinds = new Set<string>();
    if (isEnvFile(f.path)) kinds.add("an .env file");
    for (const { kind, re } of FIXED) if (re.test(f.content)) kinds.add(kind);
    GENERIC.lastIndex = 0;
    for (const m of f.content.matchAll(GENERIC)) {
      if (m[1] && looksRandom(m[1])) { kinds.add("a secret value"); break; }
    }
    // Then Gitleaks' default rules (secrets/gitleaks.ts): ~220 providers, each behind its keywords, an entropy floor and its allowlists.
    if (opts.gitleaks !== false) for (const kind of gitleaksKinds(f.path, f.content, kinds.size === 0)) kinds.add(kind);
    if (kinds.size) hits.push({ path: f.path, kinds: [...kinds] });
  }
  return hits;
}

/** Whether a repo path is under `.github/workflows` (a path that was already checked, or not: case doesn't matter). */
export const isWorkflowPath = (path: string): boolean => /^\.github\/workflows(\/|$)/i.test(path);

export interface CommitChecks {
  /** The further actions this commit makes it: "commit.secret", "workflow.write". */
  also: ActionId[];
  secrets: SecretHit[];
  workflowPaths: string[];
}

/**
 * What a commit's files add to the question. Every path is checked first for
 * the structural rules (github.ts assertRepoPath: relative, no `..`, nothing in
 * .git): one that fails is the "never" action path.escape, and decide() has
 * the last word on that, which is "deny", so the original error is thrown.
 */
export function checkCommit(files: readonly CommitFile[], ctx: PolicyCtx): CommitChecks {
  if (!Array.isArray(files)) return { also: [], secrets: [], workflowPaths: [] };
  // The runner's own ref and files are the server's alone: whatever the files are, a commit to such a ref is "never".
  if (isShadowBranch(ctx.branch)) throw reservedRefusal();
  for (const f of files) {
    try {
      assertRepoPath(f?.path);
    } catch (err) {
      if (decide("path.escape", ctx).effect === "deny") throw err;
    }
    if (isReservedPath(f?.path)) throw reservedRefusal();
  }
  const secrets = scanForSecrets(files);
  const workflowPaths = files.map((f) => f.path).filter(isWorkflowPath);
  const also: ActionId[] = [];
  if (workflowPaths.length) also.push("workflow.write");
  if (secrets.length) also.push("commit.secret");
  return { also, secrets, workflowPaths };
}

/** A digest of whatever parts, for an approval to be bound to exactly them. */
export function fingerprintOf(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** The digest of a commit: its files (paths, and the digest of each text) and its message. */
export function commitFingerprint(files: readonly CommitFile[], message: string, mergeParent?: string): string {
  return fingerprintOf(
    files.map((f) => [f.path, f.delete === true || f.content === null || f.content === undefined ? null : createHash("sha256").update(String(f.content)).digest("hex")]),
    message,
    // A merge commit is a different thing from a commit of the same files: a yes to one is not a yes to the other. (Left out for a plain commit, so every earlier fingerprint is unchanged.)
    ...(mergeParent !== undefined ? [mergeParent] : []),
  );
}

/**
 * The refusal for the runner's own files and refs (runner.reserved, "never"):
 * what an agent's commit, a runner's changes, a force-push or a sync meets when
 * it reaches for `.tailzu/`, the workflow `tailzu-run.yml` or a `tailzu-run/`
 * branch. Those are written by the server alone (shadow.ts).
 */
export function reservedRefusal(): PolicyError {
  return new PolicyError("never", "Those files and branches belong to X0 Bot's own runner, so nothing else can write them.", {
    action: "runner.reserved", tier: "never", reason: "never", faceId: false,
  });
}

/** Throws the runner.reserved refusal for a branch in the runner's namespace; any other branch passes. */
export function assertNotRunnerBranch(branch: unknown): void {
  if (isShadowBranch(branch)) throw reservedRefusal();
}

// ------------------------------------------------------------------------ the gate

/** What a caller of any gated operation can pass: the id the first step gave, and whether a person is there. */
export interface GateOptions {
  /** Step two: do what step one asked about. */
  approvalId?: string;
  /** Whether a person is there to be asked. Default true: every route has one. Pass false from a run nobody is watching. */
  attended?: boolean;
}

/** The answer to step one: nothing has been done, and this is what to show the person. */
export interface NeedsApproval {
  needsApproval: true;
  approvalId: string;
  action: ActionId;
  /** Plain data for the approval card. Never file contents, never a secret. */
  summary: Record<string, unknown>;
  /** Put Face ID in front of saying yes. */
  faceId: boolean;
  /** Epoch ms after which the approval is no good. */
  expiresAt: number;
}

/** What a gated operation gives: what it does, or a question about it. */
export type Gated<T> = T | NeedsApproval;

export const isNeedsApproval = (x: unknown): x is NeedsApproval =>
  !!x && typeof x === "object" && (x as { needsApproval?: unknown }).needsApproval === true;

/** A refusal by the policy: the ConnectorError the routes already know how to show, with what a caller needs to act on it. */
export class PolicyError extends ConnectorError {
  constructor(
    code: string, message: string,
    readonly info: { action: ActionId; tier: Tier; reason: Reason; faceId: boolean; branch?: string; summary?: Record<string, unknown> },
  ) { super(code, message); }
}

const changedSince = () => new ConnectorError("changed_since_approval", "Things changed after you looked at it. Nothing was done; look at it again.");

export interface GateRequest<T> extends GateOptions {
  store: CodeStore;
  approvals: ApprovalBook;
  userId: string;
  project: CodeProject;
  /** The action; `also` for the further ones the same step makes it (a secret in a commit, a workflow file). */
  action: ActionId;
  also?: readonly ActionId[];
  branch?: string;
  ownBranch?: boolean;
  scopes?: readonly string[];
  /** The server itself is acting (runner.shadow only; see PolicyCtx). */
  server?: boolean;
  /** The paths a runner.shadow commit holds. */
  paths?: readonly string[];
  /** What the approval card shows, besides the action and the branch (plain data). Gets the head that was read, when there is one. */
  summary: (head?: string) => Record<string, unknown>;
  /** Where the thing is now (a branch's head, a pull request's head), when an approval is to be bound to it. Read when asking and again when approved. */
  head?: () => Promise<string>;
  prNumber?: number;
  /** A digest of what would be done, when an approval is to be bound to it. */
  fingerprint?: string;
  /** Does it. Gets the approval that was used, or null when no asking was needed. */
  run: (approved: Approval | null) => Promise<T>;
}

/** The order refusals are reported in. */
const WORST: Reason[] = ["never", "unknown_action", "denied_by_grant", "missing_scope"];

/**
 * Asks the policy about an operation and does what it says: runs it, or
 * answers with the question (NeedsApproval), or refuses (PolicyError). See the
 * top of this file. Its checks come before `run` and `run` is called once at
 * most. Several actions at once (a commit that changes a workflow file and
 * holds a secret) are one question: any refusal refuses, otherwise anything
 * that asks asks, once, and the strictest of them is what the approval is for.
 */
export async function gate<T>(q: GateRequest<T>): Promise<Gated<T>> {
  const grants = await q.store.listGrants(q.project.id);
  const ctx: PolicyCtx = {
    project: q.project, ...(q.branch !== undefined ? { branch: q.branch } : {}), defaultBranch: q.project.defaultBranch,
    attended: q.attended !== false, connection: q.project.linkKind, scopes: q.scopes ?? [], grants, ownBranch: q.ownBranch === true,
    ...(q.server === true ? { server: true } : {}), ...(q.paths !== undefined ? { paths: q.paths } : {}),
  };
  const decisions = [q.action, ...(q.also ?? [])].map((a) => decide(a, ctx));

  const refused = decisions.filter((x) => x.effect === "deny" && x.reason !== "needs_you")
    .sort((a, b) => WORST.indexOf(a.reason) - WORST.indexOf(b.reason))[0];
  if (refused) throw refusal(refused, q);

  const asking = decisions.filter((x) => x.effect !== "allow");
  if (!asking.length) return q.run(null);

  // The strictest of the questions is the one the approval is for; a yes to it covers the rest.
  const top = asking.find((x) => x.tier === "ask_strict") ?? asking[0]!;
  const ordered = [top, ...asking.filter((x) => x !== top)];
  if (!ctx.attended) throw refusal(top, q);

  const key = { userId: q.userId, projectId: q.project.id, action: top.action, branch: q.branch ?? "" };
  if (q.approvalId === undefined) {
    const head = q.head ? await q.head() : undefined;
    const a = q.approvals.issue({
      ...key, ...(head !== undefined ? { headSha: head } : {}),
      ...(q.prNumber !== undefined ? { prNumber: q.prNumber } : {}), ...(q.fingerprint !== undefined ? { fingerprint: q.fingerprint } : {}),
    });
    return {
      needsApproval: true, approvalId: a.id, action: top.action, faceId: top.faceId, expiresAt: a.expiresAt,
      summary: { ...summaryHead(q, ordered), ...q.summary(head) },
    };
  }

  const taken = q.approvals.take(q.approvalId, key);
  if (!taken.ok) {
    throw taken.reason === "expired"
      ? new ConnectorError("approval_expired", "That approval ran out. Ask again, and say yes within ten minutes.")
      : new ConnectorError("approval_invalid", "That isn't an approval I have for this. Ask again to get one.");
  }
  const a = taken.approval;
  // Anything that is not exactly what was looked at is a new question, not a yes.
  if (q.head && (await q.head()) !== a.headSha) throw changedSince();
  if (a.fingerprint !== q.fingerprint || a.prNumber !== q.prNumber) throw changedSince();
  return q.run(a);
}

/**
 * `gate` for an operation whose actions are all free (making a branch, opening
 * a draft pull request): it can be refused, but it never asks, so what comes
 * back is what the operation returns.
 */
export async function gateFree<T>(q: GateRequest<T>): Promise<T> {
  const r = await gate(q);
  if (isNeedsApproval(r)) throw new Error(`policy: ${q.action} asked, but it is a free action`);
  return r;
}

/** A read is free, but a person can forbid it (a deny grant on "read"): this refuses it then. */
export async function guardRead(store: CodeStore, project: CodeProject, branch?: string): Promise<void> {
  const d = decide("read", {
    project, ...(branch !== undefined ? { branch } : {}), defaultBranch: project.defaultBranch, attended: true,
    connection: project.linkKind, scopes: [], grants: await store.listGrants(project.id),
  });
  if (d.effect === "deny") throw refusal(d, { project, ...(branch !== undefined ? { branch } : {}), summary: () => ({}) });
}

/** What every approval card starts with. */
function summaryHead(q: { project: CodeProject; branch?: string }, asking: readonly Decision[]): Record<string, unknown> {
  return {
    project: q.project.fullName, ...(q.branch !== undefined ? { branch: q.branch } : {}),
    needs: asking.map((x) => ({ action: x.action, label: def(x.action).label, faceId: x.faceId })),
  };
}

/** A decision that stops the operation, as an error a person can read. */
function refusal(x: Decision, q: { project: CodeProject; branch?: string; summary: () => Record<string, unknown> }): PolicyError {
  const info = { action: x.action, tier: x.tier, reason: x.reason, faceId: x.faceId, ...(q.branch !== undefined ? { branch: q.branch } : {}) };
  const label = def(x.action).label;
  const what = label.charAt(0).toLowerCase() + label.slice(1);
  switch (x.reason) {
    case "needs_you":
      return new PolicyError("needs_you", `This needs your OK before X0 Bot can ${what}, and nobody is here to give it. It's waiting for you.`, { ...info, summary: { ...summaryHead(q, [x]), ...q.summary() } });
    case "denied_by_grant":
      return new PolicyError("policy_denied", `You told X0 Bot not to ${what} in this project, so it won't. You can take that back in the project's permissions.`, info);
    case "missing_scope":
      return new PolicyError(
        "needs_workflow_scope",
        q.project.linkKind === "oauth"
          ? "Changing GitHub Actions workflow files needs one more permission from GitHub. Sign in with GitHub again and allow it."
          : "Changing GitHub Actions workflow files needs the X0 Bot GitHub App to have the Workflows permission. Add it in the App's settings and accept the new permission.",
        info,
      );
    default:
      return new PolicyError("never", "X0 Bot never does that.", info);
  }
}

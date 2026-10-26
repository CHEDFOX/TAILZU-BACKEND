/**
 * WHERE THE TOKEN FOR A GITHUB CALL COMES FROM: ONE INTERFACE, TWO WAYS IN.
 *
 * Everything the Code bot does to a repo (read a branch, commit, open or merge
 * a pull request) is one set of calls in github.ts, behind one set of guards
 * (tailzu/ branches only, never the default branch but the two named
 * exceptions, the path rules, the two-step merge). The only thing that differs
 * between the two ways a person can connect GitHub is which token those calls
 * carry, and that is all a GitAccess is:
 *
 *   AppAccess    the GitHub App's installation token: an hour long, minted
 *                for ONE repo, kept in memory (github.ts installationToken);
 *   OAuthAccess  the person's own "Sign in with GitHub" token: stored
 *                encrypted, reaches everything the person can, so every use
 *                first passes Tailzu's own limits (oauth.ts tokenFor: the
 *                switch is on, the link is alive, and the repo is one the
 *                person added as a project).
 *
 * A call with no access named goes by the App. When the same repo is
 * reachable both ways the App is the one used (projects.ts).
 */
import type { RepoRef } from "./github.js";

/** Added to the end of every commit made with a person's own token, so it shows which commits were Tailzu's. */
export const COMMIT_TRAILER = "Co-authored-by: Tailzu <code@tailzu.space>";

export interface GitAccess {
  readonly kind: "app" | "oauth";
  /** A bearer token for a call on this repo. Throws, before any token is used, when this access may not touch the repo. */
  token(repo: RepoRef): Promise<string>;
  /** GitHub answered 401 to a call made with this access's token: it is no good any more. */
  rejected?(): Promise<void>;
  /** Added to the end of every commit message made through this access. */
  readonly commitTrailer?: string;
  /** Whether the token may change `.github/workflows/tailzu.yml` (the one workflow file ever allowed): it has the `workflow` scope. */
  allowsWorkflow?(repo: RepoRef): Promise<boolean>;
}

/** The GitHub App's installation token for the repo. */
export class AppAccess implements GitAccess {
  readonly kind = "app" as const;
  constructor(private readonly mint: (installationId: number, repoId?: number) => Promise<string>) {}
  token(repo: RepoRef): Promise<string> { return this.mint(repo.installationId, repo.repoId); }
}

/** What OAuthAccess needs of the sign-in (oauth.ts GithubOAuth). */
export interface OAuthTokens {
  tokenFor(userId: string, repo: { repoId: number }): Promise<string>;
  markRejected(userId: string): Promise<void>;
  hasScope(userId: string, scope: string): Promise<boolean>;
}

/** The person's own sign-in token, behind Tailzu's limits. One per person. */
export class OAuthAccess implements GitAccess {
  readonly kind = "oauth" as const;
  readonly commitTrailer = COMMIT_TRAILER;
  constructor(private readonly source: OAuthTokens, private readonly userId: string) {}
  token(repo: RepoRef): Promise<string> { return this.source.tokenFor(this.userId, repo); }
  rejected(): Promise<void> { return this.source.markRejected(this.userId); }
  allowsWorkflow(): Promise<boolean> { return this.source.hasScope(this.userId, "workflow"); }
}

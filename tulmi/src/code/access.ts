/**
 * WHERE THE TOKEN FOR A GITHUB CALL COMES FROM, AND WHO THE BOT SIGNS COMMITS AS.
 *
 * Everything the Code bot does to a repo (read a branch, commit, open or merge
 * a pull request) is one set of calls in github.ts, behind one set of rules
 * (policy.ts: what is free, what asks, what never happens). The only thing that
 * differs between the two ways a person can connect GitHub is which token those
 * calls carry, and that is all a GitAccess is:
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
 *
 * An access also says what its token is ALLOWED to do on GitHub, as a plain
 * list of scopes (`scopes`), because the policy needs one fact from it: whether
 * the token may change a workflow file (github.com/.../.github/workflows).
 * For the person's own token that is the "workflow" OAuth scope; for the App it
 * is the "Workflows: write" permission on the install. Either way the list
 * says "workflow" when it may.
 *
 * WHO THE BOT IS. Every commit Tailzu makes has the bot as its AUTHOR: a name
 * and an email from CODE_BOT_NAME and CODE_BOT_EMAIL ("Blip" and
 * "blip@x0bot.com" unless set), whichever way the person connected. The
 * COMMITTER is left alone, so GitHub fills it in as whoever the token is. The
 * person the work was for is credited in the message instead, with a trailer
 * that GitHub understands and shows on the commit:
 *
 *   Co-authored-by: <login> <id+login@users.noreply.github.com>
 *
 * It is added only when the person's GitHub id and login are known (the link
 * keeps them), and never twice. If the bot has a GitHub account of its own and
 * its noreply address is the email, GitHub shows that account's avatar on every
 * commit.
 */
import type { RepoRef } from "./github.js";

/** Who the bot is in git: the author of every commit it makes. */
export interface BotIdentity { name: string; email: string }

export const DEFAULT_BOT: Readonly<BotIdentity> = { name: "Blip", email: "blip@x0bot.com" };

/** The person a piece of work was for, as GitHub knows them. */
export interface Person { id: number; login: string }

const NAME_OK = /^[^<>\r\n\u0000-\u001f\u007f]{1,100}$/;
const EMAIL_OK = /^[^\s<>@]{1,100}@[^\s<>@]{1,100}$/;

/**
 * The bot's identity from the settings, each part falling back to the default
 * when it is missing, empty, too long, or has a character a git identity can't
 * have (`<`, `>`, a line break).
 */
export function botIdentity(name?: string | null, email?: string | null): BotIdentity {
  const n = (name ?? "").trim();
  const e = (email ?? "").trim();
  return { name: NAME_OK.test(n) ? n : DEFAULT_BOT.name, email: EMAIL_OK.test(e) ? e : DEFAULT_BOT.email };
}

/** A GitHub login as GitHub allows one (the same test permissionOf uses). */
const LOGIN_OK = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * The Co-authored-by line for a person, or null when their id or login isn't
 * one GitHub could have given (so a bad value can never put a second line, or
 * a second address, into a commit message).
 */
export function coAuthorTrailer(person: Person | null | undefined): string | null {
  if (!person || !Number.isSafeInteger(person.id) || person.id <= 0 || typeof person.login !== "string" || !LOGIN_OK.test(person.login)) return null;
  return `Co-authored-by: ${person.login} <${person.id}+${person.login}@users.noreply.github.com>`;
}

/** `message` with the person's trailer at the end, as a paragraph of its own. Left alone when there is no trailer to add or it is there already. */
export function withCoAuthor(message: string, person: Person | null | undefined): string {
  const trailer = coAuthorTrailer(person);
  if (!trailer || message.split("\n").some((line) => line.trim() === trailer)) return message;
  return `${message}\n\n${trailer}`;
}

export interface GitAccess {
  readonly kind: "app" | "oauth";
  /** A bearer token for a call on this repo. Throws, before any token is used, when this access may not touch the repo. */
  token(repo: RepoRef): Promise<string>;
  /** GitHub answered 401 to a call made with this access's token: it is no good any more. */
  rejected?(): Promise<void>;
  /** What this token may do on GitHub, as plain words. Has "workflow" when it may change `.github/workflows/*`. */
  scopes(repo: RepoRef): Promise<string[]>;
}

/** The GitHub App's installation token for the repo. */
export class AppAccess implements GitAccess {
  readonly kind = "app" as const;
  constructor(
    private readonly mint: (installationId: number, repoId?: number, workflows?: boolean, actions?: "read" | "write", ci?: boolean) => Promise<string>,
    private readonly permissions: (installationId: number) => Promise<string[]>,
  ) {}
  token(repo: RepoRef): Promise<string> { return this.mint(repo.installationId, repo.repoId, repo.workflows === true, repo.actions, repo.ci === true); }
  scopes(repo: RepoRef): Promise<string[]> { return this.permissions(repo.installationId); }
}

/** What OAuthAccess needs of the sign-in (oauth.ts GithubOAuth). */
export interface OAuthTokens {
  tokenFor(userId: string, repo: { repoId: number }): Promise<string>;
  markRejected(userId: string): Promise<void>;
  scopesOf(userId: string): Promise<string[]>;
}

/** The person's own sign-in token, behind Tailzu's limits. One per person. */
export class OAuthAccess implements GitAccess {
  readonly kind = "oauth" as const;
  constructor(private readonly source: OAuthTokens, private readonly userId: string) {}
  token(repo: RepoRef): Promise<string> { return this.source.tokenFor(this.userId, repo); }
  rejected(): Promise<void> { return this.source.markRejected(this.userId); }
  scopes(): Promise<string[]> { return this.source.scopesOf(this.userId); }
}

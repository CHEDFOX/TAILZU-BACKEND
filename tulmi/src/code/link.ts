/**
 * TYING A GITHUB INSTALL TO A TAILZU PERSON.
 *
 * Installing the Tailzu App happens on GitHub, in the person's browser, with
 * no Tailzu session on that page. Two things have to be true afterwards: the
 * install is recorded against the right Tailzu account, and nobody can claim
 * an install that isn't theirs. The flow:
 *
 *   POST /v1/code/github/connect     beginConnect()      -> the install link, carrying a signed `state`
 *   GET  /v1/code/github/callback    completeCallback()  <- GitHub sends them back
 *
 * The state is the connectors' own (connectors/oauth.ts signState and
 * verifyState: a JWT signed with a key derived from CONNECTOR_TOKEN_KEY, ten
 * minutes, the user in it), with "code-github" where an app's id goes, so a
 * state from a connected app's sign-in is refused here and the other way round.
 *
 * The App has "Request user authorization (OAuth) during installation" on, so
 * GitHub also sends a one-time `code`. It is traded for the PERSON's own
 * GitHub token, which lists the installs that person can reach; the link is
 * made only if `installation_id` is one of them. That is what stops one
 * person writing another person's install (a number anyone can put in a URL)
 * into their own account. The same token says who the person is on GitHub
 * (GET /user: id and login), which is kept on the link, and is then dropped.
 *
 * Linking is NOT access to every repo in the install: GitHub lists an install
 * for an organisation member, or for someone invited to one repo on another
 * person's account, as well as for its owner. What the person may touch is
 * decided per repo, from that login, in projects.ts.
 *
 * Two other ways back are handled:
 *   - setup_action=request: the person is not an owner of the organisation,
 *     so the owner has to approve first. Nothing is linked and nothing needs
 *     the state; the page says so;
 *   - no `code` (the person only changed which repos the App sees): the state
 *     still says who it is, and the installs they already linked are looked at
 *     again with the App's own key (account, repos, suspended or gone).
 */
import { ConnectorError, signState, verifyState } from "../connectors/state.js";
import type { GithubApp } from "./github.js";
import type { CodeInstallation, CodeStore } from "./store.js";

/** What goes where a connected app's id goes in the signed state. */
export const CODE_STATE_ID = "code-github";

export interface LinkDeps { store: CodeStore; github: GithubApp }

/** Where the person manages an install on GitHub: change its repos, suspend it, uninstall it. */
export function manageUrl(accountLogin: string, accountType: string, installationId: number): string {
  return accountType === "Organization"
    ? `https://github.com/organizations/${encodeURIComponent(accountLogin)}/settings/installations/${installationId}`
    : `https://github.com/settings/installations/${installationId}`;
}

/** An install as the API shows it. `needsReconnect` is there only when true: the link predates the GitHub login it needs. */
export function installationView(i: CodeInstallation) {
  return {
    id: i.installationId, account: i.accountLogin, accountType: i.accountType, repositorySelection: i.repositorySelection,
    suspended: i.suspendedAt !== null, manageUrl: manageUrl(i.accountLogin, i.accountType, i.installationId),
    ...(i.githubLogin === null ? { needsReconnect: true } : {}),
  };
}

/** Step one: the link that opens GitHub's install page, with the person's signed state in it. */
export async function beginConnect(d: LinkDeps, userId: string, now = Date.now()): Promise<{ installUrl: string }> {
  const slug = d.github.slug;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(slug)) throw new ConnectorError("not_configured", "GitHub isn't set up on this server (the App's name is missing).");
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  url.searchParams.set("state", await signState(userId, CODE_STATE_ID, now));
  return { installUrl: url.toString() };
}

export interface CallbackQuery {
  code?: string;
  installationId?: string;
  setupAction?: string;
  state?: string;
}

export type CallbackResult =
  | { kind: "connected"; installation: CodeInstallation }
  /** An organisation's owner has to approve; nothing was linked. */
  | { kind: "waiting" }
  /** No code: the person's existing links were looked at again. */
  | { kind: "synced"; count: number };

/** Step two: GitHub sent the person back. Throws ConnectorError (bad_state, not_yours, bad_request, ...) when nothing should be linked. */
export async function completeCallback(d: LinkDeps, q: CallbackQuery, now = Date.now()): Promise<CallbackResult> {
  // An organisation member asked its owner to install: there is nothing of ours to check or keep yet.
  if (q.setupAction === "request") return { kind: "waiting" };

  if (!q.state) throw new ConnectorError("bad_state", "That link has expired or isn't valid. Start again from X0 Bot.");
  const st = await verifyState(q.state, now);
  if (st.connectorId !== CODE_STATE_ID) throw new ConnectorError("bad_state", "That link has expired or isn't valid. Start again from X0 Bot.");
  const userId = st.userId;

  if (!q.code) return { kind: "synced", count: await resyncInstallations(d, userId) };

  const installationId = /^[0-9]{1,15}$/.test(q.installationId ?? "") ? Number(q.installationId) : 0;
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new ConnectorError("bad_request", "GitHub didn't say which install this was. Start again from X0 Bot.");
  }
  // The person's own GitHub token: used for the installs they reach and for who they are, then gone.
  const userToken = await d.github.exchangeUserCode(q.code);
  const mine = (await d.github.userInstallations(userToken)).find((i) => i.id === installationId);
  if (!mine) throw new ConnectorError("not_yours", "That GitHub install isn't one your GitHub account can reach, so I didn't connect it.");
  const who = await d.github.userProfile(userToken);
  const installation = await d.store.upsertInstallation(userId, {
    installationId, accountLogin: mine.accountLogin, accountType: mine.accountType,
    repositorySelection: mine.repositorySelection, suspendedAt: mine.suspendedAt,
    githubUserId: who.id, githubLogin: who.login,
  });
  return { kind: "connected", installation };
}

/**
 * Looks again at the installs this person linked, with the App's own key: the
 * account and the repo choice as GitHub has them now, suspended or not, and a
 * link whose install is gone is dropped with its projects. An install GitHub
 * can't be asked about right now is left as it is. Who the person is on GitHub
 * is kept as it was: that needs their own token, which only the install step
 * has. Returns how many links remain.
 */
export async function resyncInstallations(d: LinkDeps, userId: string): Promise<number> {
  const links = await d.store.listInstallations(userId);
  let left = links.length;
  for (const link of links) {
    try {
      const now = await d.github.getInstallation(link.installationId);
      if (!now) { await d.store.removeInstallation(userId, link.installationId); left -= 1; continue; }
      await d.store.upsertInstallation(userId, {
        installationId: link.installationId, accountLogin: now.accountLogin, accountType: now.accountType,
        repositorySelection: now.repositorySelection, suspendedAt: now.suspendedAt,
      });
    } catch {
      // Not answered right now: the link stays, and the next look tries again.
    }
  }
  return left;
}

/** GET /v1/code/github */
export async function linkStatus(d: Pick<LinkDeps, "store">, userId: string) {
  const installations = (await d.store.listInstallations(userId)).map(installationView);
  return { configured: true, connected: installations.length > 0, installations };
}

/** DELETE /v1/code/github/installations/:id: forget the link and its projects here. GitHub's own install is untouched. */
export async function forgetInstallation(d: Pick<LinkDeps, "store">, userId: string, installationId: number): Promise<{ ok: true; manageUrl: string }> {
  const link = await d.store.getInstallation(userId, installationId);
  if (!link) throw new ConnectorError("not_found", "That GitHub install isn't connected.");
  await d.store.removeInstallation(userId, installationId);
  return { ok: true, manageUrl: manageUrl(link.accountLogin, link.accountType, link.installationId) };
}

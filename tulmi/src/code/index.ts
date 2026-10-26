/**
 * THE CODE BOT'S GITHUB SIDE, WIRED FROM THE ENVIRONMENT.
 *
 * Off (CODE_GITHUB=false, the default) there is no `Code` at all and the
 * routes say so (routes/code.ts). On, `Code` is the store, the GitHub client,
 * and the webhook secret. There are two ways a person can connect, and a
 * server may offer either or both:
 *   - the GitHub App (`appReady`): set up when the App has a name, client id,
 *     client secret and a readable private key;
 *   - "Sign in with GitHub" (`oauth`): set up when the OAuth App's client id
 *     and secret are there. CODE_GITHUB_OAUTH (`oauthWanted`) is its kill
 *     switch: off, no stored token is used.
 * `github` is the one client for both and is null when neither is set up: the
 * routes then answer 503 not_configured instead of failing halfway through a
 * person's install.
 *
 * `github` also carries WHO THE BOT IS in git (CODE_BOT_NAME and CODE_BOT_EMAIL,
 * "Blip" and "blip@tailzu.space" by default): the author of every commit it
 * makes, on either way of connecting (access.ts).
 *
 * Tests pass their own store, App config and fake `fetchFn`, so nothing here
 * reads the environment or reaches GitHub unless it is asked to.
 */
import { getConfig } from "../config.js";
import { botIdentity, type BotIdentity } from "./access.js";
import { ApprovalBook } from "./approvals.js";
import { GithubApp, type GithubAppConfig } from "./github.js";
import { GithubOAuth, type GithubOAuthConfig } from "./oauth.js";
import { codeStore, type CodeStore } from "./store.js";

export interface Code {
  store: CodeStore;
  /** The GitHub client, for both ways in. Null: neither the App nor the sign-in is set up on this server. */
  github: GithubApp | null;
  /** The GitHub App is set up (its calls, the install flow, work). */
  appReady: boolean;
  /** "Sign in with GitHub", when the OAuth App's id and secret are set. It exists even while the switch is off, so a token can still be revoked. */
  oauth: GithubOAuth | null;
  /** CODE_GITHUB_OAUTH: the sign-in is offered, and stored tokens are used. */
  oauthWanted: boolean;
  /** Null: no webhook secret, so the webhook refuses everything. */
  webhookSecret: string | null;
  /** The actions waiting for a yes (approvals.ts): in memory, ten minutes each. */
  approvals: ApprovalBook;
}

export interface CreateCodeOptions {
  store?: CodeStore;
  /** The App, instead of GITHUB_APP_*. Null: not set up. */
  app?: GithubAppConfig | null;
  /** The OAuth App, instead of GITHUB_OAUTH_CLIENT_*. Null: not set up. */
  oauth?: GithubOAuthConfig | null;
  /** Instead of CODE_GITHUB_OAUTH. */
  oauthEnabled?: boolean;
  /** Instead of GITHUB_APP_WEBHOOK_SECRET. */
  webhookSecret?: string | null;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Instead of CODE_BOT_NAME and CODE_BOT_EMAIL. */
  bot?: BotIdentity;
}

/** The App from GITHUB_APP_*, or null when any part of it is missing. */
export function appConfigFromEnv(): GithubAppConfig | null {
  const cfg = getConfig();
  if (!cfg.GITHUB_APP_SLUG || !cfg.GITHUB_APP_CLIENT_ID || !cfg.GITHUB_APP_CLIENT_SECRET || !cfg.GITHUB_APP_PRIVATE_KEY) return null;
  return {
    appId: cfg.GITHUB_APP_ID, slug: cfg.GITHUB_APP_SLUG, clientId: cfg.GITHUB_APP_CLIENT_ID,
    clientSecret: cfg.GITHUB_APP_CLIENT_SECRET, privateKey: cfg.GITHUB_APP_PRIVATE_KEY,
  };
}

/** The OAuth App from GITHUB_OAUTH_CLIENT_*, or null when either is missing. */
export function oauthConfigFromEnv(): GithubOAuthConfig | null {
  const cfg = getConfig();
  return cfg.GITHUB_OAUTH_CLIENT_ID && cfg.GITHUB_OAUTH_CLIENT_SECRET
    ? { clientId: cfg.GITHUB_OAUTH_CLIENT_ID, clientSecret: cfg.GITHUB_OAUTH_CLIENT_SECRET }
    : null;
}

/** Who the bot is in git, from CODE_BOT_NAME and CODE_BOT_EMAIL (access.ts botIdentity: a bad or missing value is the default). */
export function botFromEnv(): BotIdentity {
  const cfg = getConfig();
  return botIdentity(cfg.CODE_BOT_NAME, cfg.CODE_BOT_EMAIL);
}

export function createCode(o: CreateCodeOptions = {}): Code {
  const app = o.app !== undefined ? o.app : appConfigFromEnv();
  const oauthConfig = o.oauth !== undefined ? o.oauth : oauthConfigFromEnv();
  const store = o.store ?? codeStore();
  const bot = o.bot ?? botFromEnv();
  let github: GithubApp | null = null;
  let appReady = false;
  if (app) {
    try {
      github = new GithubApp(app, { fetchFn: o.fetchFn, now: o.now, bot });
      appReady = true;
    } catch {
      // The key is what could not be read: say which setting, never its contents.
      console.warn("[code] GITHUB_APP_PRIVATE_KEY can't be read as a private key (raw PEM, or base64 of the PEM): the Code bot answers not_configured.");
    }
  }
  // A server with only the sign-in still needs the client for the git calls; it just has no App behind it.
  if (!github && oauthConfig) github = new GithubApp(null, { fetchFn: o.fetchFn, now: o.now, bot });
  const oauthWanted = o.oauthEnabled !== undefined ? o.oauthEnabled : getConfig().CODE_GITHUB_OAUTH;
  const oauth = github && oauthConfig
    ? new GithubOAuth({ config: oauthConfig, store, github, enabled: oauthWanted, fetchFn: o.fetchFn, now: o.now })
    : null;
  const secret = o.webhookSecret !== undefined ? o.webhookSecret : getConfig().GITHUB_APP_WEBHOOK_SECRET ?? null;
  return { store, github, appReady, oauth, oauthWanted, webhookSecret: secret || null, approvals: new ApprovalBook({ now: o.now }) };
}

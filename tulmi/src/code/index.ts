/**
 * THE CODE BOT'S GITHUB SIDE, WIRED FROM THE ENVIRONMENT.
 *
 * Off (CODE_GITHUB=false, the default) there is no `Code` at all and the
 * routes say so (routes/code.ts). On, `Code` is the store, the GitHub App
 * client, and the webhook secret. The client is null while the App isn't fully
 * set up (no name, client id, client secret or readable private key): the
 * routes then answer 503 not_configured instead of failing halfway through a
 * person's install.
 *
 * Tests pass their own store, App config and fake `fetchFn`, so nothing here
 * reads the environment or reaches GitHub unless it is asked to.
 */
import { getConfig } from "../config.js";
import { ApprovalBook } from "./approvals.js";
import { GithubApp, type GithubAppConfig } from "./github.js";
import { codeStore, type CodeStore } from "./store.js";

export interface Code {
  store: CodeStore;
  /** Null: the GitHub App isn't set up on this server. */
  github: GithubApp | null;
  /** Null: no webhook secret, so the webhook refuses everything. */
  webhookSecret: string | null;
  /** The merges waiting for a yes (approvals.ts): in memory, ten minutes each. */
  approvals: ApprovalBook;
}

export interface CreateCodeOptions {
  store?: CodeStore;
  /** The App, instead of GITHUB_APP_*. Null: not set up. */
  app?: GithubAppConfig | null;
  /** Instead of GITHUB_APP_WEBHOOK_SECRET. */
  webhookSecret?: string | null;
  fetchFn?: typeof fetch;
  now?: () => number;
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

export function createCode(o: CreateCodeOptions = {}): Code {
  const app = o.app !== undefined ? o.app : appConfigFromEnv();
  let github: GithubApp | null = null;
  if (app) {
    try {
      github = new GithubApp(app, { fetchFn: o.fetchFn, now: o.now });
    } catch {
      // The key is what could not be read: say which setting, never its contents.
      console.warn("[code] GITHUB_APP_PRIVATE_KEY can't be read as a private key (raw PEM, or base64 of the PEM): the Code bot answers not_configured.");
    }
  }
  const secret = o.webhookSecret !== undefined ? o.webhookSecret : getConfig().GITHUB_APP_WEBHOOK_SECRET ?? null;
  return { store: o.store ?? codeStore(), github, webhookSecret: secret || null, approvals: new ApprovalBook({ now: o.now }) };
}

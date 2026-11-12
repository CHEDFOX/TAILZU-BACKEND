// Everything the mail worker reads from its environment, checked once at start. docker-compose gives it the server's tulmi/.env
// (deploy/mail-up.sh puts the mail server's values there). From Xooteq Mail's dashboard (xooteq-mail dashboard/server/config.ts),
// cut to what the mail does: no dashboard login, web app, or Postal sending apps.
import path from "node:path";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set (tulmi/.env, see deploy/mail-up.sh)`);
}

const mailDomain = env("MAIL_DOMAIN", "mail.example.com");

export const config = {
  port: Number(env("MAIL_WORKER_PORT", "5300")),
  /** Stalwart's HTTP listener, on its own Docker network: JMAP for mail and for its own settings. */
  stalwartUrl: env("STALWART_URL", "http://stalwart:8080").replace(/\/+$/, ""),
  /** The mail server's admin login; it can impersonate a business's mailbox, so no mailbox password is ever stored. */
  stalwartAdminUser: env("STALWART_ADMIN_USER", ""),
  stalwartAdminSecret: env("STALWART_ADMIN_SECRET", ""),
  /** Stalwart signs its new-mail webhook to this worker with it (deploy/mail-up.sh registers the webhook). */
  webhookSecret: env("MAIL_WEBHOOK_SECRET", ""),
  /** X0 Bot's server signs every call to this worker with it, the media and Oracle workers' way (security.ts). */
  workerSecret: env("MAIL_WORKER_SECRET", ""),
  /** The platform domain: mx.<it> receives, smtp.<it> sends, spf.<it> lists the IP. */
  mailDomain,
  vpsIp: env("VPS_IP", ""),
  dataDir: env("DATA_DIR", path.resolve("data")),
  /** Our AI (nobody brings a key): OpenRouter, best model first; "model@low" sets its thinking effort. */
  openrouterKey: env("OPENROUTER_API_KEY", ""),
  openrouterUrl: env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
  models: env("MAIL_MODELS", "anthropic/claude-sonnet-5.5@low,google/gemini-3.8-flash@low").split(",").map((m) => m.trim()).filter(Boolean),
  /** What one business's AI may spend in a day, in US dollars, unless X0's server sets its own (the plan's). */
  dailyUsd: Number(env("MAIL_DAILY_USD", "1")),
};

export function assertReady(): string[] {
  const missing: string[] = [];
  if (!config.stalwartAdminUser || !config.stalwartAdminSecret) missing.push("STALWART_ADMIN_USER / STALWART_ADMIN_SECRET");
  if (config.workerSecret.length < 32) missing.push("MAIL_WORKER_SECRET (32+ characters)");
  if (!config.webhookSecret) missing.push("MAIL_WEBHOOK_SECRET");
  if (!config.openrouterKey) missing.push("OPENROUTER_API_KEY");
  if (!config.vpsIp) missing.push("VPS_IP");
  return missing;
}

/** The hosts mail apps and DNS records point at. */
export const hosts = {
  mx: `mx.${mailDomain}`,
  smtp: `smtp.${mailDomain}`,
  imap: `mx.${mailDomain}`,
  spfInclude: `spf.${mailDomain}`,
};

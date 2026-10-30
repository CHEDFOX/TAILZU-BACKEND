/**
 * DELETE ACCOUNT WITH SEVEN DAYS TO UNDO (src/you/deletion.ts, migration 0045): what the Bots app's Delete account and Home use.
 *
 *   POST   /v1/account/deletion   -> 202 { scheduled: { requestedAt, deleteAt }, graceDays }   the date is set (asking twice keeps the
 *                                    first), the person is signed out everywhere and their pings stop (push tokens go; signing in
 *                                    brings them back). Their bots stop right away: Xode jobs that are running are stopped
 *                                    (as Stop job does), and while the date stands no job or bot answer starts and their bots' API
 *                                    keys do not work (you/deletion.ts isLeaving). 503 delete_unavailable when this server cannot
 *                                    delete anyone (no service key): a deletion that could never run must not be promised.
 *   GET    /v1/account/deletion   -> { scheduled: null | { requestedAt, deleteAt }, graceDays, deleteAtIfNow }
 *   DELETE /v1/account/deletion   -> { ok, kept }   Keep my account: the date is taken away, and the bots and keys work again
 *
 * DELETE /v1/account (server.ts) still deletes at once, for today's app and anyone who must have it gone now. The sweep that does
 * the real delete on the date runs here, once the server is ready, while the server can delete (`erase`).
 *
 * ON THE WEB, WITHOUT THE APP (Google Play's account deletion link; policies/deleteAccount.ts):
 *
 *   GET    /delete-account                        the page (x0bot.com/delete-account through the site's proxy)
 *   POST   /v1/account/deletion/web/code { email, captcha? }   -> { sent: true }   Supabase mails the address a sign-in code, as the
 *                                                  app's sign-in does, never making an account; the answer is the same whether
 *                                                  or not an account uses the address
 *   POST   /v1/account/deletion/web/verify { email, code }     -> { token, expiresIn }   the session's access token, for the page to call
 *                                                  the three routes above with (it is held in the page's memory only)
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser, supabase, type AuthedUser } from "../auth/supabase.js";
import { cleanEmail } from "../botsBots/mail.js";
import { getConfig } from "../config.js";
import { deleteAccountHtml, deletePageCsp } from "./policies/deleteAccount.js";
import type { AgentOrchestrator } from "../code/agent/orchestrator.js";
import type { JobRouter } from "../code/jobs/router.js";
import { isEnded } from "../code/jobs/types.js";
import { deletionStore, forgetLeaving, GRACE_DAYS, GRACE_MS, startDeletionSweep, STOPPED_MESSAGE, type DeletionStore, type Erase } from "../you/deletion.js";

export interface AccountDeletionDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** The real delete, or null when this server cannot delete (no service key). */
  erase: Erase | null;
  store?: DeletionStore;
  now?: () => number;
  /** How often the sweep looks; null: it does not run (tests). */
  sweepEveryMs?: number | null;
  /** After the date is set: sign out everywhere and stop pings. Tests hand in their own. */
  leave?: (user: AuthedUser) => Promise<void>;
  /** Xode's jobs and the agent that drives them: the person's running jobs are stopped when the date is set. Null: none here. */
  jobs?: Pick<JobRouter, "listJobs" | "cancelJob"> | null;
  agent?: Pick<AgentOrchestrator, "stopJob"> | null;
  /** Signing in on the web page by a mailed code. Absent: Supabase's (supabaseOtp); null: not possible on this server. */
  otp?: WebOtp | null;
  /** The web page's Turnstile site key, for when Supabase's attack protection is on. Absent: from the environment. */
  captchaKey?: string;
}

/** The web page's sign-in: a code mailed to an address, and the code traded for a session. */
export interface WebOtp {
  /** Mails a code to an existing account's address; never makes an account. Throws on a refusal (the route says nothing of it). */
  send(email: string, captchaToken?: string): Promise<void>;
  /** The session's access token, or null when the code is wrong or spent. */
  verify(email: string, code: string): Promise<{ token: string; expiresIn: number } | null>;
}

/**
 * Supabase's own email code, as the app uses it (signInWithOtp / verifyOtp), with the public anon key (or the service key when that
 * is all there is). A client per call, so no session is ever kept on the server. Null without Supabase.
 */
export function supabaseOtp(): WebOtp | null {
  const cfg = getConfig();
  const key = cfg.SUPABASE_ANON_KEY ?? cfg.SUPABASE_SERVICE_KEY;
  if (!cfg.SUPABASE_URL || !key) return null;
  const client = () => createClient(cfg.SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return {
    async send(email, captchaToken) {
      const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: false, ...(captchaToken ? { captchaToken } : {}) } });
      if (error) throw error;
    },
    async verify(email, code) {
      const { data, error } = await client().auth.verifyOtp({ email, token: code, type: "email" });
      if (error || !data.session) return null;
      return { token: data.session.access_token, expiresIn: data.session.expires_in };
    },
  };
}

/** How many of a person's jobs are looked at when their bots stop: more than can be going at once (LIVE_JOBS_MAX), helpers included. */
const JOBS_LOOKED_AT = 100;

/**
 * The person's bots stop: each job still going is stopped the way Stop job stops it (the agent's loop is told, a step that is out is
 * dropped, a late result is refused), with a reason that says nothing about the account. Best effort, one at a time; returns how many.
 */
export async function stopJobsOf(userId: string, o: Pick<AccountDeletionDeps, "jobs" | "agent">, log?: { warn: (o: object, m: string) => void }): Promise<number> {
  if (!o.jobs) return 0;
  const going = (await o.jobs.listJobs(userId, JOBS_LOOKED_AT).catch(() => [])).filter((j) => !isEnded(j.state));
  let stopped = 0;
  for (const j of going) {
    try {
      if (o.agent) await o.agent.stopJob(userId, j.id, STOPPED_MESSAGE);
      else await o.jobs.cancelJob(j.id, STOPPED_MESSAGE);
      stopped++;
    } catch (err) { log?.warn({ error: (err as Error)?.name }, "account deletion: a job did not stop"); }
  }
  return stopped;
}

/** Signed out on every device (their refresh tokens revoked) and no pings while the date stands. Best effort: never fails the ask. */
async function leaveDevices(user: AuthedUser, log: { warn: (o: object, m: string) => void }): Promise<void> {
  const admin = supabase();
  if (!admin) return;
  try {
    const { error } = await admin.from("push_tokens").delete().eq("user_id", user.id);
    if (error) log.warn({ error: error.message }, "account deletion: push tokens stayed");
  } catch (err) { log.warn({ error: (err as Error)?.name }, "account deletion: push tokens stayed"); }
  if (!user.token) return;
  try {
    const { error } = await admin.auth.admin.signOut(user.token, "global");
    if (error) log.warn({ error: error.name }, "account deletion: sessions stayed");
  } catch (err) { log.warn({ error: (err as Error)?.name }, "account deletion: sessions stayed"); }
}

export function registerAccountDeletionRoutes(app: FastifyInstance, deps: AccountDeletionDeps): void {
  const RL = { config: deps.rateLimit };
  const store = (): DeletionStore => deps.store ?? deletionStore();
  const now = deps.now ?? Date.now;
  const leave = deps.leave ?? ((u: AuthedUser) => leaveDevices(u, app.log));

  const who = async (authorization: unknown, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolveUser(typeof authorization === "string" ? authorization : undefined).catch(() => null);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return user;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    app.log.error({ error: (err as Error)?.message }, "account deletion: route failed");
    return reply.code(500).send({ code: "internal", message: "That didn't work. Try again." });
  };

  app.get("/v1/account/deletion", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const scheduled = await store().get(user.id);
      return reply.header("cache-control", "no-store").send({ scheduled, graceDays: GRACE_DAYS, deleteAtIfNow: now() + GRACE_MS });
    } catch (err) { return fail(reply, err); }
  });

  app.post("/v1/account/deletion", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    if (!deps.erase) {
      app.log.error("account deletion asked for with no way to delete");
      return reply.code(503).send({ code: "delete_unavailable", message: "Account deletion is temporarily unavailable. Please try again shortly." });
    }
    try {
      const t = now();
      const scheduled = await store().schedule(user.id, t, t + GRACE_MS);
      // From here every bot run of theirs is refused (isLeaving); what is already going is stopped.
      forgetLeaving(user.id, store());
      await leave(user).catch(() => undefined);
      await stopJobsOf(user.id, deps, app.log).catch(() => 0);
      return reply.code(202).send({ scheduled, graceDays: GRACE_DAYS });
    } catch (err) { return fail(reply, err); }
  });

  app.delete("/v1/account/deletion", RL, async (req, reply) => {
    const user = await who(req.headers["authorization"], reply);
    if (!user) return reply;
    try {
      const kept = await store().cancel(user.id);
      forgetLeaving(user.id, store());
      return reply.send({ ok: true, kept });
    } catch (err) { return fail(reply, err); }
  });

  // ------------------------------------------------------------------ on the web, without the app

  const otp = deps.otp === undefined ? supabaseOtp() : deps.otp;
  const captchaKey = (deps.captchaKey ?? process.env.DELETE_PAGE_TURNSTILE_SITE_KEY ?? process.env.TURNSTILE_SITE_KEY ?? "").trim();
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const body = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
  const noSignIn = (reply: FastifyReply) => reply.code(503).send({ code: "unavailable", message: "Signing in here isn't available right now. Use the app, or email privacy@x0bot.com." });

  app.get("/delete-account", async (_req, reply) => {
    const nonce = randomBytes(16).toString("base64");
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-store")
      .header("content-security-policy", deletePageCsp(nonce, !!captchaKey)).header("referrer-policy", "no-referrer")
      .send(deleteAccountHtml({ nonce, graceDays: GRACE_DAYS, captchaKey }));
  });

  app.post("/v1/account/deletion/web/code", tight(5), async (req, reply) => {
    const b = body(req.body);
    const email = cleanEmail(b.email);
    if (!email) return reply.code(400).send({ code: "bad_email", message: "That doesn't look like an email address." });
    if (!otp) return noSignIn(reply);
    const captcha = typeof b.captcha === "string" && b.captcha.length <= 4096 ? b.captcha : undefined;
    try { await otp.send(email, captcha); } catch (err) {
      // No account, too soon, a captcha: the answer is the same, so it can't tell anyone whether an address has an account.
      app.log.warn({ error: (err as { name?: string })?.name, status: (err as { status?: number })?.status }, "account deletion: web code not sent");
    }
    return reply.header("cache-control", "no-store").send({ sent: true });
  });

  app.post("/v1/account/deletion/web/verify", tight(10), async (req, reply) => {
    const b = body(req.body);
    const email = cleanEmail(b.email);
    const code = String(b.code ?? "").replace(/\D/g, "");
    if (!email || code.length < 6 || code.length > 10) return reply.code(400).send({ code: "bad_request", message: "Enter your email address and the code from the email." });
    if (!otp) return noSignIn(reply);
    const s = await otp.verify(email, code).catch(() => null);
    if (!s) return reply.code(401).send({ code: "invalid_code", message: "That code didn't work. Check it, or send a new one." });
    return reply.header("cache-control", "no-store").send({ token: s.token, expiresIn: s.expiresIn });
  });

  const erase = deps.erase;
  if (erase && deps.sweepEveryMs !== null) {
    let stop: (() => void) | undefined;
    app.addHook("onReady", async () => {
      stop = startDeletionSweep({ store: store(), erase, now, log: app.log, ...(deps.sweepEveryMs ? { everyMs: deps.sweepEveryMs } : {}) });
    });
    app.addHook("onClose", async () => { stop?.(); });
  }
}

/**
 * DELETE ACCOUNT WITH SEVEN DAYS TO UNDO (src/you/deletion.ts, migration 0045): what the Bots app's Delete account and Home use.
 *
 *   POST   /v1/account/deletion   -> 202 { scheduled: { requestedAt, deleteAt }, graceDays }   the date is set (asking twice keeps the
 *                                    first), the person is signed out everywhere and their pings stop (push tokens go; signing in
 *                                    brings them back). Their bots stop right away: the Code bot jobs that are running are stopped
 *                                    (as Stop job does), and while the date stands no job or bot answer starts and their bots' API
 *                                    keys do not work (you/deletion.ts isLeaving). 503 delete_unavailable when this server cannot
 *                                    delete anyone (no service key): a deletion that could never run must not be promised.
 *   GET    /v1/account/deletion   -> { scheduled: null | { requestedAt, deleteAt }, graceDays, deleteAtIfNow }
 *   DELETE /v1/account/deletion   -> { ok, kept }   Keep my account: the date is taken away, and the bots and keys work again
 *
 * DELETE /v1/account (server.ts) still deletes at once, for today's app and anyone who must have it gone now. The sweep that does
 * the real delete on the date runs here, once the server is ready, while the server can delete (`erase`).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser, supabase, type AuthedUser } from "../auth/supabase.js";
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
  /** The Code bot's jobs and the agent that drives them: the person's running jobs are stopped when the date is set. Null: none here. */
  jobs?: Pick<JobRouter, "listJobs" | "cancelJob"> | null;
  agent?: Pick<AgentOrchestrator, "stopJob"> | null;
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

  const erase = deps.erase;
  if (erase && deps.sweepEveryMs !== null) {
    let stop: (() => void) | undefined;
    app.addHook("onReady", async () => {
      stop = startDeletionSweep({ store: store(), erase, now, log: app.log, ...(deps.sweepEveryMs ? { everyMs: deps.sweepEveryMs } : {}) });
    });
    app.addHook("onClose", async () => { stop?.(); });
  }
}

/**
 * Deleting an account: right away from the app, or scheduled with a grace period.
 */

import type { FastifyRequest, FastifyInstance } from "fastify";
import { deleteViewerData } from "../../artifacts/index.js";
import { forgetInvitesOf } from "../../botsBots/inviteSweeper.js";
import { planFollows } from "../../botsBots/planFollow.js";
import type { AppleSignIn } from "../../auth/appleSignIn.js";
import { resolveUser, supabase } from "../../auth/supabase.js";
import type { AgentOrchestrator } from "../../code/agent/orchestrator.js";
import type { Code } from "../../code/index.js";
import type { JobRouter } from "../../code/jobs/router.js";
import type { MediaService } from "../../media/service.js";
import { registerAccountDeletionRoutes } from "./accountDeletion.js";
import { mailForAccountDelete } from "../../mail/worker.js";
import { meetService } from "../../meet/service.js";
import { unauthorized } from "../../http/helpers.js";

export interface AccountRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  code: Code | null;
  appleSignIn: AppleSignIn | null;
  media: MediaService | null;
  jobs: JobRouter | null;
  agent: AgentOrchestrator | null;
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const { rateLimit: AUTHED_RL, code, appleSignIn, media, jobs: codeJobs, agent: codeAgent } = deps;
  // --- Account: delete everything we hold about a user ------------------------
  //
  // The Settings screen's "Delete account" button fires this. We remove the
  // user's saved personality, profile, and usage_events, then ask Supabase Auth
  // to delete the account itself (requires the service-role key; falls back to a
  // "please email us" message when only the anon key is configured).
  //
  // This is intentionally destructive and irreversible — we don't hold a
  // tombstone. The endpoint returns a small JSON summary of what was deleted so
  // the client can show a receipt.

  app.delete("/v1/account", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    const admin = supabase();

    // NO SERVICE KEY, NO DELETION, AND SAY SO.
    //
    // supabase() returns null whenever SUPABASE_SERVICE_KEY is unset, and the
    // whole block below was simply skipped — then answered 200 with a cheerful
    // summary of six things that did not happen. The app reads 200 as success:
    // it showed "Your account has been deleted." and signed the user out, and
    // the account was still there to sign back into.
    //
    // That is the exact failure Apple's 5.1.1(v) is written about, and it is
    // worse than having no delete button, because the user believes it is done.
    // A deletion that cannot run must fail in front of the person who asked.
    if (!admin) {
      req.log.error("account delete attempted with no service-role key");
      return reply.code(503).send({
        code: "delete_unavailable",
        message: "Account deletion is temporarily unavailable. Please try again shortly.",
      });
    }

    const summary = await eraseAccount(admin, user, req);

    // The auth record IS the account. Everything above is data the account
    // owned; if this one did not go, the account did not go, and the only
    // honest answer is an error — the app then keeps the user signed in and
    // tells them it failed, which is recoverable. Reporting success here is
    // not: it signs them out believing they are gone.
    if (!summary.authAccount) {
      req.log.error({ summary }, "account delete: auth record survived");
      return reply.code(500).send({
        code: "delete_incomplete",
        message: "We could not finish deleting the account. Please try again.",
      });
    }

    return reply.send({
      status: "deleted",
      ...summary,
      message: "Your account and all associated data have been deleted.",
    });
  });

  /**
   * EVERYTHING THE ACCOUNT HOLDS, THEN THE ACCOUNT. DELETE /v1/account runs it at
   * once; the Bots app's Delete account sets a date seven days out and the sweep
   * runs it on that day (routes/account/accountDeletion.ts, src/you/deletion.ts). `req`
   * is only where it logs. `summary.authAccount` says whether the account went.
   */
  async function eraseAccount(admin: NonNullable<ReturnType<typeof supabase>>, user: { id: string }, req: { log: FastifyRequest["log"] }) {
    // Every table holding this user's rows. Each also cascades from auth.users,
    // but they are cleared first and one at a time, so a table whose foreign key
    // was never given ON DELETE CASCADE cannot make the auth delete below fail.
    // cleanup_history is the verbatim dictated input + output — the most
    // sensitive per-user data, and once silently left behind. Errors are logged
    // and do not abort the sequence.
    // A GitHub sign-in token is revoked at GitHub before its row goes; the rows go with the account either way.
    await code?.oauth?.forAccountDelete(user.id);
    // Their projects' code copies (code/project/copies.ts) are on disk, not in the database: they go first.
    if (code?.copies) {
      try {
        const { data } = await admin.from("code_projects").select("id").eq("user_id", user.id);
        for (const p of (data ?? []) as Array<{ id: string }>) await code.copies.drop(p.id);
      } catch (err) { req.log.error({ err }, "delete code copies"); }
    }
    // So is the Apple sign-in, at Apple (App Review 5.1.1(v)); its row goes with the account below.
    if (appleSignIn && !(await appleSignIn.forAccountDelete(user.id))) req.log.warn("account delete: the Apple sign-in could not be revoked at Apple");
    // The bytes of their files are in a bucket, not in the database: they go first (the rows go with the account just below).
    try { await media?.forAccountDelete(user.id); } catch (err) { req.log.error({ err }, "delete media bytes"); }
    // Their businesses' mailboxes and mail are on our mail server, kept by the mail worker (src/mail): they go too.
    if (!(await mailForAccountDelete(user.id))) req.log.error("account delete: the mail worker could not remove the businesses' mailboxes");
    // Their meetings' bots are called off and their notes' calls forgotten (src/meet); best effort, it never fails the delete.
    try { await meetService()?.forAccountDelete(user.id); } catch (err) { req.log.error({ err: (err as Error)?.message }, "account delete: the meeting bot could not be called off"); }

    const summary = {
      personality: false, profile: false, usageEvents: 0,
      history: false, pushTokens: false, authAccount: false,
    };
    const tables: Array<[string, keyof typeof summary | null]> = [
      ["usage_events", "usageEvents"], ["personalities", "personality"], ["profiles", "profile"],
      ["cleanup_history", "history"], ["push_tokens", "pushTokens"],
      ["keyboard_telemetry", null], ["push_log", null], ["entitlements", null],
      // Xode's GitHub links and projects (a project's branches go with it: code_branches
      // has no user_id, and cascades from code_projects, as do the project brain's four tables,
      // code_brain, code_brain_files, code_brain_dirs and code_brain_texts: migration 0028).
      ["code_installations", null], ["code_projects", null], ["code_oauth_links", null],
      // Artifacts (migration 0032): a person's artifacts take their versions and saved data with them (both cascade from artifacts); the
      // look kept for their projects goes too. What they saved in OTHER people's artifacts (scope = their id) is cleared just after.
      ["artifacts", null], ["artifact_kits", null],
      // The front door's decision log (migration 0033): categories and numbers about their messages, never a word of them.
      ["front_decisions", null],
      // Media and files (migration 0035): what was read from their files, and the text in pieces (media_chunks cascades from media_items).
      ["media_items", null],
      // Talking about code, a project's settings and PR care (migration 0034): the conversations' short summaries, how a person likes a job worked, and the pull requests
      // Tailzu looks after. A job's rewind points go with the job (code_job_checkpoints cascades from code_jobs).
      ["code_chat_threads", null], ["code_project_settings", null], ["code_pr_care", null],
      // The bots platform (migration 0038): their bots, the API keys (only hashes), saved commands, and what their bots remember of them.
      ["bots", null], ["bot_keys", null], ["bot_commands", null], ["bot_facts", null], ["bot_threads", null],
      // A fitness bot's daily steps and workouts (migration 0090). It cascades from the account and from the bot; it is listed
      // here so the most sensitive thing X0 Bot holds goes first and by name, not only by a cascade nobody can see.
      ["bot_health_days", null],
      // The Oracle (migration 0078): when and where they were born, and the route of their last question.
      ["oracle_people", null],
      // The mail bot (migration 0080): the hash its worker knows their account by, for the push.
      ["mail_owners", null],
      // Lingo (migration 0087): the languages they were learning, and every word and phrase with it.
      ["lingo_items", null], ["lingo_learners", null],
      // Apple's token for revoking the sign-in (migration 0061), revoked just above.
      ["apple_sign_in", null],
    ];
    for (const [table, key] of tables) {
      try {
        const { error, count } = await admin.from(table).delete({ count: "exact" }).eq("user_id", user.id);
        if (error) req.log.error({ err: error }, `delete ${table}`);
        if (key === "usageEvents") summary.usageEvents = count ?? 0;
        else if (key) summary[key] = !error;
      } catch (err) { req.log.error({ err }, `delete ${table}`); }
    }

    try { await deleteViewerData(admin, user.id); } catch (err) { req.log.error({ err }, "delete artifact_data"); }
    // Plan Ease's follow-through (migration 0081): numbers other people kept for this person go (plan_numbers.member_id also cascades),
    // and their name leaves other people's follows. Their own follows, steps and phone go with the account just below.
    try { await planFollows().forget(user.id); } catch (err) { req.log.error({ err }, "forget follow person"); }
    // The invites they sent and the mail those invites queued (botsBots/inviteSweeper.ts). Neither goes with the account on its
    // own: an invite cascades from its SPACE, and an outbox row has no foreign key to anyone. Both hold someone else's address,
    // kept only because this person typed or picked it, so both go with this person.
    try { await forgetInvitesOf(user.id); } catch (err) { req.log.error({ err }, "forget invites and their mail"); }

    // Deleting the auth user takes anything missed above with it (cascade).
    try {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      summary.authAccount = !error;
    } catch (err) {
      req.log.error({ err }, "delete auth user");
    }

    return summary;
  }

  // Delete account with seven days to undo (the Bots app): set the date, read it, keep the account, and the sweep that runs
  // eraseAccount on the day. No service key, no deleting: the ask is refused (503), as DELETE /v1/account is above.
  registerAccountDeletionRoutes(app, {
    rateLimit: AUTHED_RL,
    // The person's bots stop when the date is set: their running Xode jobs are stopped.
    jobs: codeJobs, agent: codeAgent,
    erase: supabase() ? async (userId) => {
      const admin = supabase();
      if (!admin) return false;
      const summary = await eraseAccount(admin, { id: userId }, { log: app.log });
      if (!summary.authAccount) app.log.error({ summary }, "scheduled account delete: auth record survived");
      return summary.authAccount;
    } : null,
  });
}

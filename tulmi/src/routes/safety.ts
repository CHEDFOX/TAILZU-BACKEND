/**
 * Bots app · reporting and blocking (src/botsBots/{safety,blocks}.ts, migration 0057; screens in experience/bots/screens/safety.ts).
 * Registered by routes/botsSpaces.ts, around the same Spaces, chats and shared things. Every check is in src/botsBots.
 *
 *   GET    /v1/botsapp/bots/people/:id                 -> { person: { userId, name, spaces, blockedByYou, canMessage } }
 *   GET    /v1/botsapp/bots/blocks                     -> { blocked: [{ userId, name, at }] }   (You › Blocked people)
 *   POST   /v1/botsapp/bots/blocks { person }          -> { ok, name, already }
 *   DELETE /v1/botsapp/bots/blocks/:person             unblock
 *   GET    /v1/botsapp/bots/reports/preview?kind=&id=&thread=   -> { kind, what, text, person }   what a report would be about
 *   POST   /v1/botsapp/bots/reports { kind: message|item|person, id, thread?, reason, note?, block? }
 *                                                      -> 201 { report: { id, dueBy }, blocked, again, message }
 *
 * The admin (header x-admin-secret, ADMIN_SECRET; the console's Reports tab at GET /admin):
 *
 *   GET    /v1/admin/reports?status=open|actioned|dismissed|all   -> { reports, open, overdue }
 *   PUT    /v1/admin/reports/:id { status: actioned|dismissed|open, remove?, suspend?, note? }   -> { report }
 *          remove: the message or shared thing goes for everyone; suspend: the reported account can't sign in again.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, supabase, type AuthedUser } from "../auth/supabase.js";
import { isBotError } from "../bots/index.js";
import { requireAdmin } from "../control/index.js";
import { REASON_WORDS } from "../botsBots/safety.js";
import type { BotsAreaDeps } from "./botsArea.js";
import type { SpaceParts } from "./botsSpaces.js";
import { AREA, shownName } from "./botsBots.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
const queryOf = (req: FastifyRequest): Record<string, unknown> => (req.query as Record<string, unknown> | undefined) ?? {};

/** About a hundred years: Supabase's way of saying "banned". The account can't sign in or refresh its session. */
const BAN = "876000h";

/** The admin's suspend: the reported account is banned in Supabase Auth (no new sign-in, no session refresh). False when it didn't take. */
export async function suspendWithSupabase(userId: string): Promise<boolean> {
  const admin = supabase();
  if (!admin) return false;
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN } as never);
  return !error;
}

export function registerSafetyRoutes(app: FastifyInstance, deps: BotsAreaDeps, p: SpaceParts): void {
  const { safety } = p;
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    req.log.error({ err: (err as Error)?.message?.slice(0, 160) }, "safety: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };
  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) { return fail(req, reply, err); }
    };

  // ------------------------------------------------------------------ people and blocks

  app.get(`${AREA}/people/:id`, RL, run(async (user, req) => ({ person: await safety.person(user.id, param(req, "id")) })));
  app.get(`${AREA}/blocks`, RL, run(async (user) => ({ blocked: await safety.blocked(user.id) })));
  app.post(`${AREA}/blocks`, tight(30), run(async (user, req) => {
    const r = await safety.block(user.id, String(bodyOf(req.body).person ?? ""));
    return { ok: true, ...r };
  }));
  app.delete(`${AREA}/blocks/:person`, RL, run(async (user, req) => { await safety.unblock(user.id, param(req, "person")); return { ok: true }; }));

  // ------------------------------------------------------------------ reports

  app.get(`${AREA}/reports/preview`, RL, run(async (user, req) => {
    const q = queryOf(req);
    return { ...(await safety.preview(user.id, { kind: q.kind, id: q.id, thread: q.thread })), reasons: Object.entries(REASON_WORDS).map(([id, label]) => ({ id, label })) };
  }));
  app.post(`${AREA}/reports`, tight(20), run(async (user, req, reply) => {
    const r = await safety.report({ id: user.id, name: shownName(user) }, bodyOf(req.body));
    reply.code(r.again ? 200 : 201);
    return { ...r, message: r.blocked ? "Thanks. We'll look at it within 24 hours, and you've blocked them." : "Thanks. We'll look at it within 24 hours." };
  }));

  // ------------------------------------------------------------------ the admin

  app.get("/v1/admin/reports", RL, async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    try {
      const q = queryOf(req);
      return reply.header("cache-control", "no-store").send(await safety.reports({ status: q.status, limit: q.limit }));
    } catch (err) { return fail(req, reply, err); }
  });
  app.put("/v1/admin/reports/:id", RL, async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    try {
      const b = bodyOf(req.body);
      const by = String(req.headers["x-admin-name"] ?? "admin").slice(0, 60) || "admin";
      return reply.send({ report: await safety.resolve(param(req, "id"), { status: b.status, remove: b.remove, suspend: b.suspend, note: b.note, by }) });
    } catch (err) { return fail(req, reply, err); }
  });
}

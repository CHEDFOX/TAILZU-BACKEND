/**
 * THE GUARDS AT THE DOOR OF A ROUTE: ONE REQUEST, ONE RUN, UNDER A PERMIT.
 *
 * A route that spends money (a model call, a job, a making) runs its work through guarded(): the guard (src/guard) takes the request's
 * idempotency key, so a double tap joins the run that is out or gets the answer it had; takes a permit, so no person and not the server as a whole
 * runs more at once than the limits allow, and a request that cannot wait is turned away with 429, Retry-After and its place in the
 * queue; and tells the work to stop when every request waiting on it has gone.
 *
 *   return guarded(deps.guard, req, reply, user, "artifact", async (stop) => ({ status: 201, body: ... }));
 *
 * The work returns what to send; the status below 400 is what a repeat is shown (an error is run again). The work throws what it always
 * threw: Overloaded and IdempotencyConflict are turned into their answers by failCode (routes/code.ts), which every route already uses.
 * The 400s a route can see from the body alone are sent before this, so a bad request never takes a permit.
 *
 * `{ replayUnkeyed: false }` is for a route whose answer depends on what the server holds, not only on the body (an edit moves the artifact
 * on, "build it" builds the head, an intake asks the next question): a double tap still joins the run that is out, but the same body sent after
 * it finished is a new request. A client's Idempotency-Key still makes it a repeat.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthedUser } from "../auth/supabase.js";
import { isEntitled } from "../billing/entitlements.js";
import { defaultGuard, type Guard, type Lane, type Plan } from "../guard/index.js";

/** Whether the person pays, as the server knows it (the entitlement, cached for a minute). A failure to find out is "free": the tighter limit. */
export async function planOf(user: AuthedUser): Promise<Plan> {
  try { return (await isEntitled(user)) ? "paid" : "free"; } catch { return "free"; }
}

export interface Answer { status: number; body: unknown }

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === "AbortError";

export const idempotencyHeader = (req: FastifyRequest): string | null => {
  const h = req.headers["idempotency-key"];
  return typeof h === "string" && h.trim() ? h : null;
};

/**
 * Runs `work` under the guard and sends its answer. `guard` is the route's own, or the process's. A person who has gone away is sent
 * nothing. Throws what the work throws, and Overloaded / IdempotencyConflict.
 */
export async function guarded(
  guard: Guard | undefined, req: FastifyRequest, reply: FastifyReply, user: AuthedUser, lane: Lane, work: (stop: AbortSignal) => Promise<Answer>,
  o: { replayUnkeyed?: boolean } = {},
): Promise<FastifyReply> {
  const g = guard ?? defaultGuard();
  const gone = new AbortController();
  reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
  try {
    const out = await g.run<Answer>({
      userId: user.id, plan: await planOf(user), route: `${req.method} ${req.routeOptions?.url ?? req.url}`,
      body: { params: req.params ?? null, query: req.query ?? null, body: req.body ?? null }, header: idempotencyHeader(req), lane, signal: gone.signal,
      keep: (a: Answer) => a.status < 400, ...(o.replayUnkeyed === false ? { replayUnkeyed: false } : {}),
    }, (_emit, stop) => work(stop));
    if (out.replay) reply.header("idempotent-replayed", "true");
    return reply.code(out.result.status).send(out.result.body);
  } catch (err) {
    if (isAbort(err) && gone.signal.aborted) return reply;
    throw err;
  }
}

/**
 * The person's history: GET /v1/history and DELETE /v1/history/:id.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HistoryListResponse } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
import { MAX_LIMIT as HISTORY_MAX_LIMIT, listHistory, deleteHistoryEntry } from "../../history/store.js";
import { unauthorized } from "../../http/helpers.js";

export interface HistoryRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
}

export function registerHistoryRoutes(app: FastifyInstance, deps: HistoryRouteDeps): void {
  const { rateLimit: AUTHED_RL } = deps;
  // --- History (REST) ---------------------------------------------------------
  //
  // Opt-in per-user history log. Storage is gated by personality.learnFromSent /
  // personality.retainHistory; these endpoints only ever touch the caller's own
  // rows (listHistory/deleteHistoryEntry filter by the authenticated user id).

  const historyListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(HISTORY_MAX_LIMIT).optional(),
    before: z.string().datetime().optional(),
    // Row-id tie-breaker echoed back alongside `before` (see nextBeforeId).
    beforeId: z.string().uuid().optional(),
    kind: z.enum(["voice", "typing", "draft"]).optional(),
  });

  const historyIdParamsSchema = z.object({
    id: z.string().uuid(),
  });
  /**
   * Why a card was removed from History, when the app says: "it doesn't sound
   * like me" or "just a clean-up". Either way it is deleted; the reason is
   * logged so the first can be counted apart from tidying up. Anything else is
   * ignored rather than refused — a delete never fails over its reason.
   */
  const historyDeleteQuerySchema = z.object({
    reason: z.enum(["not_me", "cleanup"]).optional(),
  });

  app.get("/v1/history", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    const parsed = historyListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid query" });
    }

    try {
      const { entries, nextBefore, nextBeforeId } = await listHistory(user, parsed.data);
      const res: HistoryListResponse = { entries };
      if (nextBefore) res.nextBefore = nextBefore;
      if (nextBeforeId) res.nextBeforeId = nextBeforeId;
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to load history" });
    }
  });

  app.delete("/v1/history/:id", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    const parsed = historyIdParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: "invalid id" });
    }

    const why = historyDeleteQuerySchema.safeParse(req.query ?? {});
    const reason = why.success ? why.data.reason : undefined;

    try {
      const ok = await deleteHistoryEntry(user, parsed.data.id);
      if (!ok) return reply.code(404).send({ code: "bad_request", message: "not found" });
      if (reason) req.log.info({ event: "history.delete", reason }, "history entry removed");
      return reply.send({ ok: true, ...(reason ? { reason } : {}) });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to delete entry" });
    }
  });
}

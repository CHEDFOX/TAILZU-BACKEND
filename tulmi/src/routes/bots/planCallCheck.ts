/**
 * THE PHONE'S ANSWER TO THE PRE-RING CHECK (botsBots/planCallCheck.ts; docs: perms2 §5.3).
 *
 *   POST /v1/botsapp/plan/calls/:id/check { driving?, focus? }  -> { ok: true, heard }
 *
 * The phone's background task was woken about 30 seconds before a Plan Ease call would ring, by a silent push carrying the
 * check's id; it reads Motion & Fitness (driving: an `automotive` activity in the last 3 minutes) and the Focus state, and
 * posts the two words back here. The session's own token: a bot API key is 403, and nothing else may answer for a person.
 *
 * TWO WORDS, AND NOTHING ELSE. `driving` and `focus` are booleans or absent. No place, no speed, no time, no Focus name: the
 * body cannot carry one, and nothing from here is stored — the answer goes straight to the call being placed and is gone.
 *
 * `heard: false` means the wait had already ended (the 20 seconds went, or this server never asked): the call rang as it does
 * today, and a late answer changes nothing. Logged by that word alone.
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { looksLikeKey } from "../../bots/keys.js";
import { answerCheck } from "../../botsBots/planCallCheck.js";
import type { BotsAreaDeps } from "./botsArea.js";

const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

export function registerPlanCallCheckRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">): void {
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  app.post("/v1/botsapp/plan/calls/:id/check", tight(60), async (req, reply) => {
    const auth = req.headers["authorization"];
    if (looksLikeKey(auth)) return reply.code(403).send({ code: "not_for_keys", message: "This is only for your phone." });
    const user = await resolveUser(auth).catch(() => null);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const b = bodyOf(req.body);
    for (const k of ["driving", "focus"] as const) {
      if (b[k] !== undefined && typeof b[k] !== "boolean") return reply.code(400).send({ code: "bad_request", message: `${k} is true or false.` });
    }
    const heard = answerCheck(user.id, (req.params as { id?: unknown }).id, {
      ...(typeof b.driving === "boolean" ? { driving: b.driving } : {}),
      ...(typeof b.focus === "boolean" ? { focus: b.focus } : {}),
    });
    req.log.info({ heard }, "plan: pre-ring check answered");
    return reply.header("cache-control", "no-store").send({ ok: true, heard });
  });
}

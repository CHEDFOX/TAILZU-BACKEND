/**
 * "HOLD CALLS DURING A FOCUS": THE APP'S OWN DOOR (src/widgets/focus.ts; docs: perms2 §4.5).
 *
 *   POST /v1/botsapp/plan/focus { on, hold?, source? }  -> { ok: true, on }
 *
 * The phone's `focus.sync` posts here on Plan Ease page appear, with the person's own session. It exists for two reasons: the
 * iPhone's Focus Filter posts with the WIDGETS' token, which a phone only gets at its next reissue (so the first days after
 * 8.9.1 the filter's own post is 403 and this is what the server hears), and Android has no filter at all — it reads Do Not
 * Disturb with no permission and says so here.
 *
 * Only the session: a bot API key is 403 (the key works, this is not for it). Never which Focus: the body cannot carry one.
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { looksLikeKey } from "../../bots/keys.js";
import type { PlanPrefs } from "../../botsBots/planPrefs.js";
import { readFocusPost, setFocus } from "../../widgets/focus.js";
import { focusLive } from "../../experience/bots/kit.js";
import { focusEnded } from "../../botsBots/planCallCheck.js";
import type { BotsAreaDeps } from "./botsArea.js";

export const FOCUS_PATH = "/v1/botsapp/plan/focus";

export function registerPlanFocusRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, o: { prefs: PlanPrefs; now?: () => number }): void {
  const now = o.now ?? Date.now;
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  app.post(FOCUS_PATH, tight(60), async (req, reply) => {
    const auth = req.headers["authorization"];
    if (looksLikeKey(auth)) return reply.code(403).send({ code: "not_for_keys", message: "This is only for you, in the app." });
    const user = await resolveUser(auth).catch(() => null);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    if (!focusLive()) return reply.code(403).send({ code: "focus_off", message: "This isn't switched on yet." });
    const post = readFocusPost(req.body);
    if ("error" in post) return reply.code(400).send({ code: "bad_request", message: post.error });
    try {
      const r = await setFocus(o.prefs, user.id, post, now());
      // The Focus has just ended: the one notice about what waited goes now, and nothing else waits on it.
      if (r.ended) void focusEnded(user.id, now()).catch(() => undefined);
      req.log.info({ on: r.on }, "plan: focus said");
      return reply.header("cache-control", "no-store").send({ ok: true, on: r.on });
    } catch (err) {
      req.log.error({ err: (err as Error)?.name }, "plan: focus failed");
      return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
    }
  });
}

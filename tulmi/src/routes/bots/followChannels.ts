/**
 * FOLLOW-THROUGH'S REAL PHONE CALL: ITS ROUTES (CHANNEL_PHONE_CALLS, off by default; botsBots/followPhone.ts, docs/follow-channels.md).
 *
 * The person's own number (signed in; the setup screen bots.plan.phone):
 *   GET    /v1/botsapp/bots/plan/phone            PhoneView: whether calls can go here, their switch, their number (masked) and its state,
 *                                                 X0's number to call once to prove it
 *   PUT    /v1/botsapp/bots/plan/phone            { phone } their own mobile number (waits for its proving call), or { again: true } the
 *                                                 number they gave, proved again; 400 { code, message } for a number that won't do
 *   DELETE /v1/botsapp/bots/plan/phone            their number taken away, their switch off (works even with calls off here)
 *
 * Plivo's callbacks (form posts; every one signed by Plivo, X-Plivo-Signature-V3 over PUBLIC_ORIGIN + the path; a call's own also carry our
 * MAC for that step; else 403). Off (not ready): 404. Their query is never logged (observability.ts logUrl).
 *   POST   /v1/channels/plivo/answer              the call picked up: the reminder and its keys (XML); ?try=2 hangs up
 *   POST   /v1/channels/plivo/input               a key: 1 done, 2 later, 3 can't (the one reply door, via "call"), 9 stop, else once more
 *   POST   /v1/channels/plivo/hangup              the call ended: "no answer" unless a key was pressed
 *   POST   /v1/channels/plivo/inbound             X0's number called (its Plivo application's answer URL): the proof that a number is theirs
 *   POST   /v1/channels/plivo/inbound/input       the setup screen's 4-digit code proves it (that account only), 9 stops calls to it
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import {
  PHONE, PLIVO, callQueryOf, followPhone, phoneCallsReady, plivoSigned, plugFollowChannels, type CallQuery,
} from "../../botsBots/followPhone.js";
import { formOf, hangupXml, type Form } from "../../botsBots/followPhoneWords.js";
import { setFollowChannels } from "../../botsBots/planFollowChannels.js";
import type { BotsAreaDeps } from "./botsArea.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const OFF = { code: "off", message: "Phone calls aren't switched on here." };
const NOT_PLIVO = { code: "forbidden", message: "Not signed." };

export function registerFollowChannelRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">): void {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const phone = plugFollowChannels(followPhone());
  app.addHook("onClose", async () => { setFollowChannels(null); });

  // ------------------------------------------------------------------ the person's own number

  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]).catch(() => null);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      void reply.header("cache-control", "no-store");
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) {
        req.log.error({ err: (err as Error)?.name }, "phone: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };

  app.get(PHONE, RL, run(async (user) => phone.view(user.id)));

  app.put(PHONE, tight(10), run(async (user, req, reply) => {
    if (!phoneCallsReady()) { reply.code(404); return OFF; }
    const b = bodyOf(req.body);
    const out = b.again === true ? await phone.again(user.id) : await phone.setNumber(user.id, b.phone);
    if (!out.ok) { reply.code(out.code === "off" ? 404 : 400); return { code: out.code, message: out.message }; }
    return out.view;
  }));

  app.delete(PHONE, tight(10), run(async (user) => phone.remove(user.id)));

  // ------------------------------------------------------------------ Plivo's callbacks (their own form parser, here only)

  void app.register(async (p) => {
    p.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, String(body)));
    const xml = (reply: FastifyReply, s: string) => reply.header("content-type", "application/xml; charset=utf-8").header("cache-control", "no-store").send(s);

    /** Plivo's signature first, then (a call's own callbacks) our MAC for that step. Null when it was answered already. */
    const gate = (req: FastifyRequest, reply: FastifyReply, mine: boolean): { form: Form; call: CallQuery | null } | null => {
      if (!phoneCallsReady()) { void reply.code(404).send(OFF); return null; }
      const form = formOf(req.body);
      if (!plivoSigned({ url: req.url, body: form, headers: req.headers as Record<string, unknown> })) { void reply.code(403).send(NOT_PLIVO); return null; }
      if (!mine) return { form, call: null };
      const call = callQueryOf(req.query);
      if (!call || !phone.macOk(call)) { void reply.code(403).send(NOT_PLIVO); return null; }
      return { form, call };
    };
    /** A callback that fails ends the call quietly, never a stack trace to Plivo. */
    const safe = async (req: FastifyRequest, reply: FastifyReply, fn: () => Promise<string>) => {
      try { return xml(reply, await fn()); } catch (err) {
        req.log.warn({ err: (err as Error)?.name }, "phone: callback failed");
        return xml(reply, hangupXml());
      }
    };

    p.post(`${PLIVO}/answer`, RL, async (req, reply) => {
      const g = gate(req, reply, true);
      return g ? safe(req, reply, () => phone.answer(g.call!, g.form)) : reply;
    });
    p.post(`${PLIVO}/input`, RL, async (req, reply) => {
      const g = gate(req, reply, true);
      return g ? safe(req, reply, () => phone.input(g.call!, g.form)) : reply;
    });
    p.post(`${PLIVO}/hangup`, RL, async (req, reply) => {
      const g = gate(req, reply, true);
      if (!g) return reply;
      await phone.hangup(g.call!, g.form).catch(() => undefined);
      return reply.code(200).send({ ok: true });
    });
    p.post(`${PLIVO}/inbound`, RL, async (req, reply) => {
      const g = gate(req, reply, false);
      return g ? safe(req, reply, () => phone.inbound(g.form)) : reply;
    });
    p.post(`${PLIVO}/inbound/input`, RL, async (req, reply) => {
      const g = gate(req, reply, false);
      return g ? safe(req, reply, () => phone.inboundInput(g.form)) : reply;
    });
  });
}

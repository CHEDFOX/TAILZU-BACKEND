/**
 * WHAT AN ADMIN CAN SEE AND DO ABOUT ONE ACCOUNT'S SCORE (docs/trust.md §admin). Behind x-admin-secret, like the control
 * plane's own routes.
 *
 *   GET  /v1/admin/trust/:userId          the score, its reasons, the verdict summaries and COUNTS
 *   POST /v1/admin/trust/:userId/clear    takes the score away, and the hold or slow with it
 *
 * COUNTS ONLY (docs/trust.md rule 9). The answer never lists the other accounts behind a network key, an install key or an
 * email hash — there is no query in the store that could, and no action on one account ever spreads to the accounts that
 * shared a key with it. There is no "ban the cluster" here, and nothing here can close an account.
 *
 * `clear` is for the honest cases: a second-hand phone whose previous owner started a free account on it, or a score we got
 * wrong. It clears what WE hold, and leaves a mark on the account saying Apple's own two bits are to be cleared too: the
 * next DeviceCheck pass from that phone is the only moment we hold a token for the device, so that is where it happens
 * (routes/trust/trust.ts), and only with `TRUST_ATTEST=on`. Google's device recall is not implemented, so there is nothing
 * to clear there yet, and the privacy policy says "Apple and Google can keep a mark … we clear it if you ask" — true for
 * Apple's bits from here, and for Google's once recall exists.
 */
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../control/index.js";
import { clearLive, trustMode, trustSurface } from "../../trust/actions.js";
import { attestMode } from "../../trust/ask.js";
import { lists } from "../../trust/lists.js";
import { trustStore } from "../../trust/store.js";

export interface AdminTrustRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
}

export function registerAdminTrustRoutes(app: FastifyInstance, deps: AdminTrustRoutesDeps): void {
  const RL = { config: deps.rateLimit };
  const idOf = (req: { params: unknown }) => String((req.params as { userId?: unknown }).userId ?? "").slice(0, 60);

  app.get("/v1/admin/trust/:userId", RL, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const userId = idOf(req);
    if (!userId) return reply.code(400).send({ code: "invalid", message: "userId?" });
    const row = await trustStore().score(userId).catch(() => null);
    const installs = await trustStore().installKeysOf(userId).catch(() => [] as Buffer[]);
    const attestKeys = await trustStore().countAttestKeys(userId).catch(() => 0);
    return reply.send({
      userId,
      mode: trustMode(),
      attest: attestMode(),
      score: row?.score ?? 0,
      reasons: row?.reasons ?? [],
      action: row?.action ?? "none",
      verdicts: row?.verdicts ?? {},
      updatedAt: row?.updatedAt ?? null,
      // Counts, and nothing that could name another account.
      counts: { installs: installs.length, attestKeys },
      surface: trustSurface(),
      listsLoaded: lists().counts,
    });
  });

  app.post("/v1/admin/trust/:userId/clear", RL, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const userId = idOf(req);
    if (!userId) return reply.code(400).send({ code: "invalid", message: "userId?" });
    const now = Date.now();
    await trustStore().clearScore(userId).catch(() => undefined);
    clearLive(userId);
    // The score is gone; what is left is the one instruction the phone has to carry out for us. It holds no answer, no
    // address and no id — just "clear Apple's bits next time this phone says hello" — and it goes with the account.
    await trustStore().putScore({
      userId, score: 0, reasons: [], action: "none", verdicts: { deviceReset: true }, updatedAt: now,
    }).catch(() => undefined);
    req.log.info({ user: userId }, "trust: an admin cleared a score, and Apple's bits are to be cleared at the next pass");
    return reply.send({ ok: true, deviceReset: true });
  });
}

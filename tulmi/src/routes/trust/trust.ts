/**
 * WHAT THE PHONE POSTS WHEN IT HAS PROVED ITSELF (docs/trust.md §the ask; spec 9.3).
 *
 *   POST /v1/trust/challenge              -> { challenge }     a fresh one, when the first has run out
 *   POST /v1/trust/ios/attest             -> 204               App Attest: the key's attestation
 *   POST /v1/trust/ios/assert             -> 204               App Attest: that key signing a challenge
 *   POST /v1/trust/ios/devicecheck        -> 204               DeviceCheck: the device token, for Apple's two bits
 *   POST /v1/trust/android/integrity      -> 204               Play Integrity: the token, for Google to decode
 *
 * Every route needs the person's own signed-in session (no bot API key, no widget token), and every one answers 204 with an
 * empty body: nothing comes back for the phone to act on, so a modified app learns nothing by calling them, and there is no
 * screen, prompt or refusal anywhere in this flow.
 *
 * A phone that could not do its step posts { challenge, failed: "<code>" } to the same route. Codes like `unsupported`,
 * `throttled`, `no_play` and `timeout` are NO SIGNAL and score nothing (docs/trust.md rule 6); anything else is a build that
 * claimed it could attest and did not.
 *
 * With TRUST_ATTEST=off (the default) every route answers 404, and nothing is stored. In `shadow` the answers are verified
 * and kept as verdicts, but nothing is ever written back to Apple or Google.
 *
 * WHAT /ios/devicecheck WRITES BACK, AND FOR WHOM (docs/trust.md §DeviceCheck). bit0 says "a free account was already
 * started on this phone", and Apple keeps it on the device for us. So: only an account that may be acted on at all marks
 * a device (never a payer, the review account or an exempt id — rule 5), only with the mode `on`, and the write is
 * remembered against that account (`verdicts.deviceCheck.setByUs`) so the bit we just wrote is never scored against the
 * very account that caused it. And when an admin has cleared a second-hand phone, this is the one moment we hold a token
 * for the device, so the bits are cleared here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { getEntitlement } from "../../billing/entitlements.js";
import { getConfig } from "../../config.js";
import { attestMode, markAttested, newChallenge, takeChallenge } from "../../trust/ask.js";
import { neverActOn, noteVerdicts } from "../../trust/actions.js";
import { verifyAssertion, verifyAttestation } from "../../trust/apple/appAttest.js";
import { queryTwoBits, updateTwoBits } from "../../trust/apple/deviceCheck.js";
import { decodeIntegrityToken } from "../../trust/google/playIntegrity.js";
import { trustStore } from "../../trust/store.js";

export interface TrustRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
}

/** Reason codes that mean the phone could not answer, which is never a penalty. */
const NO_SIGNAL = new Set(["unsupported", "throttled", "no_play", "timeout", "cancelled", "offline", "refused", "no_key"]);

const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Whether this account has a payment, which rule 5 needs before a device is ever marked. Never throws. */
const hasPayment = async (userId: string): Promise<boolean> =>
  !!(await getEntitlement({ id: userId }).catch(() => null))?.active;

export function registerTrustRoutes(app: FastifyInstance, deps: TrustRoutesDeps): void {
  const RL = { config: deps.rateLimit };

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "trust_off", message: "Not switched on." });
  const noSession = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });

  /** The session, or null. A `static-*` desktop token is nobody's phone, so it is turned away here too. */
  async function who(req: FastifyRequest): Promise<{ id: string; email?: string } | null> {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user || user.id.startsWith("static-")) return null;
    return { id: user.id, ...(user.email ? { email: user.email } : {}) };
  }

  app.post("/v1/trust/challenge", RL, async (req, reply) => {
    if (attestMode() === "off") return off(reply);
    const user = await who(req);
    if (!user) return noSession(reply);
    return reply.send({ challenge: newChallenge(user.id) });
  });

  app.post("/v1/trust/ios/attest", RL, async (req, reply) => {
    if (attestMode() === "off") return off(reply);
    const user = await who(req);
    if (!user) return noSession(reply);
    const b = bodyOf(req.body);
    if (!takeChallenge(b.challenge, user.id)) return reply.code(400).send({ code: "stale_challenge" });
    const failed = text(b.failed, 40);
    if (failed) {
      await noteVerdicts(user.id, { appAttest: NO_SIGNAL.has(failed) ? "none" : "fail" }).catch(() => undefined);
      return reply.code(204).send();
    }
    const cfg = getConfig();
    const got = verifyAttestation({
      attestation: text(b.attestation, 20_000),
      keyId: text(b.keyId, 100),
      challenge: text(b.challenge, 200),
      appId: `${cfg.APPLE_SIWA_TEAM_ID}.${cfg.APPLE_SIWA_CLIENT_ID}`,
    });
    if (!got.ok) {
      req.log.info({ user: user.id, why: got.why }, "trust: an App Attest attestation did not verify");
      await noteVerdicts(user.id, { appAttest: "fail" }).catch(() => undefined);
      return reply.code(204).send();
    }
    const now = Date.now();
    await trustStore().putAttestKey({
      keyId: got.keyId, userId: user.id, publicKey: got.publicKey, signCount: got.counter,
      env: got.env, receipt: got.receipt, createdAt: now, lastUsedAt: now,
    }).catch(() => undefined);
    await noteVerdicts(user.id, { appAttest: "ok" }, { now }).catch(() => undefined);
    markAttested(user.id, now);
    return reply.code(204).send();
  });

  app.post("/v1/trust/ios/assert", RL, async (req, reply) => {
    if (attestMode() === "off") return off(reply);
    const user = await who(req);
    if (!user) return noSession(reply);
    const b = bodyOf(req.body);
    if (!takeChallenge(b.challenge, user.id)) return reply.code(400).send({ code: "stale_challenge" });
    const failed = text(b.failed, 40);
    if (failed) {
      await noteVerdicts(user.id, { appAttest: NO_SIGNAL.has(failed) ? "none" : "fail" }).catch(() => undefined);
      return reply.code(204).send();
    }
    const keyId = text(b.keyId, 100);
    const held = await trustStore().attestKey(keyId).catch(() => null);
    // A key we do not hold, or one of somebody else's: nothing to check against, and never another account's key.
    if (!held || held.userId !== user.id) return reply.code(204).send();
    const cfg = getConfig();
    const got = verifyAssertion({
      assertion: text(b.assertion, 20_000),
      challenge: text(b.challenge, 200),
      appId: `${cfg.APPLE_SIWA_TEAM_ID}.${cfg.APPLE_SIWA_CLIENT_ID}`,
      publicKey: held.publicKey,
      signCount: held.signCount,
    });
    const now = Date.now();
    if (!got.ok) {
      req.log.info({ user: user.id, why: got.why }, "trust: an App Attest assertion did not verify");
      await noteVerdicts(user.id, { appAttest: "fail" }, { now }).catch(() => undefined);
      return reply.code(204).send();
    }
    await trustStore().usedAttestKey(keyId, got.counter, now).catch(() => undefined);
    await noteVerdicts(user.id, { appAttest: "ok" }, { now }).catch(() => undefined);
    markAttested(user.id, now);
    return reply.code(204).send();
  });

  app.post("/v1/trust/ios/devicecheck", RL, async (req, reply) => {
    if (attestMode() === "off") return off(reply);
    const user = await who(req);
    if (!user) return noSession(reply);
    const b = bodyOf(req.body);
    // The challenge is taken when the phone sent one; DeviceCheck's own token is Apple's, not ours, so it may come alone.
    if (b.challenge !== undefined && !takeChallenge(b.challenge, user.id)) return reply.code(400).send({ code: "stale_challenge" });
    const failed = text(b.failed, 40);
    if (failed) return reply.code(204).send();
    const token = text(b.token, 10_000);
    if (!token) return reply.code(204).send();
    const store = trustStore();
    const had = await store.score(user.id).catch(() => null);
    // A SECOND-HAND PHONE (docs/trust.md §admin). An admin cleared this account, which means Apple's own two bits are to
    // be cleared as well: this is the only moment we hold a token for that device, so it happens here, and the mark goes.
    if (had?.verdicts?.deviceReset) {
      if (attestMode() === "on") await updateTwoBits({ token, bits: { bit0: false, bit1: false } }).catch(() => false);
      await noteVerdicts(user.id, { deviceCheck: { bit0: false, bit1: false }, deviceReset: false }).catch(() => undefined);
      markAttested(user.id);
      req.log.info({ user: user.id }, "trust: Apple's two bits were cleared for a phone an admin reset");
      return reply.code(204).send();
    }
    const got = await queryTwoBits({ token });
    // WHO MAY NEVER MARK A DEVICE (docs/trust.md rule 5). Writing bit0 says "a free account was started on this phone",
    // so it is only ever written for an account that is on the free plan and may be acted on at all: never a payer,
    // never the review account, never an exempt id. The entitlement is read here because that rule needs it.
    const paid = await hasPayment(user.id);
    const mayMark = attestMode() === "on" && !neverActOn({ userId: user.id, email: user.email, paid });
    if (!got.ok) {
      // "not found" is a device Apple holds nothing for yet: no signal, and the bit is written below only when on.
      req.log.info({ user: user.id, why: got.why }, "trust: DeviceCheck answered nothing to score");
      if (got.why === "not_found" && mayMark) {
        await updateTwoBits({ token, bits: { bit0: true, bit1: false } }).catch(() => false);
        await noteVerdicts(user.id, { deviceCheck: { bit0: true, bit1: false, setByUs: true } }).catch(() => undefined);
      }
      return reply.code(204).send();
    }
    // Apple keeps the bits on the device, so the next query reads back whatever we wrote. `setByUs` remembers that this
    // account's own pass set bit0, and the score then ignores it for this account (and only this one): otherwise an
    // honest new iPhone would flag itself on its second launch.
    const ours = had?.verdicts?.deviceCheck?.setByUs === true;
    const writing = mayMark && !got.bits.bit0;
    const bits = writing ? { ...got.bits, bit0: true } : got.bits;
    await noteVerdicts(user.id, { deviceCheck: { ...bits, ...(writing || ours ? { setByUs: true } : {}) } }).catch(() => undefined);
    markAttested(user.id);
    // This device has now started a free account. Written only when the mode is on, and bit1 only ever by an admin.
    if (writing) await updateTwoBits({ token, bits: { bit0: true, bit1: got.bits.bit1 } }).catch(() => false);
    return reply.code(204).send();
  });

  app.post("/v1/trust/android/integrity", RL, async (req, reply) => {
    if (attestMode() === "off") return off(reply);
    const user = await who(req);
    if (!user) return noSession(reply);
    const b = bodyOf(req.body);
    const challenge = text(b.challenge, 200);
    if (!takeChallenge(challenge, user.id)) return reply.code(400).send({ code: "stale_challenge" });
    const failed = text(b.failed, 40);
    if (failed) return reply.code(204).send();
    const got = await decodeIntegrityToken({ token: text(b.token, 20_000), challenge });
    if (!got.ok) {
      req.log.info({ user: user.id, why: got.why }, "trust: a Play Integrity token did not decode");
      if (got.why === "package" || got.why === "hash" || got.why === "certificate") {
        await noteVerdicts(user.id, { integrity: { app: "UNRECOGNIZED_VERSION" } }).catch(() => undefined);
      }
      return reply.code(204).send();
    }
    await noteVerdicts(user.id, { integrity: got.verdict }).catch(() => undefined);
    markAttested(user.id);
    return reply.code(204).send();
  });
}

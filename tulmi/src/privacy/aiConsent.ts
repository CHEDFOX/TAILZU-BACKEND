/**
 * THE PERSON'S PERMISSION TO SEND WHAT THEY GIVE X0 BOT TO AI SERVICES (App Review 5.1.1(i), 5.1.2(i)). The gate is aiGate.ts;
 * this is whether they said yes, kept on their personality (aiConsentAt, aiConsentVersion), whether they answered this wording at all
 * (aiConsentAskedVersion), and the route that changes it.
 *
 *   GET /v1/you/ai-consent                         -> { agreed, at, version, services, asked }   (the Home card, You › Privacy)
 *   PUT /v1/you/ai-consent { agree }               -> { agreed, at }   Agree on the card (true), or the switch in You › Privacy
 *   PUT /v1/you/ai-consent { agree: false, later } -> { agreed, at }   Not now on the card: the answer only, a yes is never taken back
 *
 * Asked once per wording, on Home (screens/firstRun/aiConsentCard.ts), before anything is sent. Agree, Not now and the switch off are
 * each an answer, kept: the card does not come back until the wording (AI_CONSENT_VERSION) changes. Not now sends nothing, and every
 * bot, dictation and Ask waits until they turn it on in You › Privacy. Withdrawn there at any time: from then on nothing more is sent.
 * What was asked before stays as the privacy policy says (section 4).
 *
 * Read once a minute per person (a no every few seconds), since the gate asks on every AI call; a change here is seen at once on this server.
 */
import type { FastifyInstance } from "fastify";
import type { Personality } from "../../../shared/types/api.js";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { getPersonality, updatePersonality } from "../personality/store.js";
import { AI_SERVICES, installAiCheck } from "./aiGate.js";

/** The wording agreed to. Raise it when what is sent, or to whom, changes: everyone is asked again. */
export const AI_CONSENT_VERSION = 1;
export const AI_CONSENT_PATH = "/v1/you/ai-consent";


export const agreedIn = (p: Personality | null | undefined): boolean =>
  !!p?.aiConsentAt && (p.aiConsentVersion ?? 0) >= AI_CONSENT_VERSION;

/** The personality with the wording they last answered (Agree, Not now or off), kept in the same JSON beside aiConsentVersion. */
export type AiAnswered = Personality & { aiConsentAskedVersion?: number };

/**
 * Whether they answered this wording: Home does not ask again until AI_CONSENT_VERSION goes up. A yes to it counts, and so does a yes to
 * it switched off since (from before the answer was kept, the withdrawal says so).
 */
export const answeredIn = (p: Personality | null | undefined): boolean => {
  const q = p as AiAnswered | null | undefined;
  return agreedIn(q) || (q?.aiConsentAskedVersion ?? 0) >= AI_CONSENT_VERSION
    || (!!q?.aiConsentWithdrawnAt && (q.aiConsentVersion ?? 0) >= AI_CONSENT_VERSION);
};

const TTL_MS = 60_000;
const NO_TTL_MS = 10_000;
const known = new Map<string, { ok: boolean; at: number }>();
const whoIs = new Map<string, { id: string | null; at: number }>();
const KEEP = 5000;

function remember<V>(m: Map<string, V>, k: string, v: V): void {
  if (m.size >= KEEP) m.delete(m.keys().next().value as string);
  m.set(k, v);
}

/** Whether this person has agreed (to the current wording). */
export async function hasAiConsent(userId: string): Promise<boolean> {
  const hit = known.get(userId);
  // A yes is kept a minute; a no only a few seconds (a yes given on another server, or a read that failed, is seen soon).
  if (hit && Date.now() - hit.at < (hit.ok ? TTL_MS : NO_TTL_MS)) return hit.ok;
  const ok = agreedIn(await getPersonality({ id: userId }));
  remember(known, userId, { ok, at: Date.now() });
  return ok;
}

/** Agree, or switch it off (You › Privacy). Either is their answer to this wording. Seen by the gate at once. */
export async function setAiConsent(user: AuthedUser, agree: boolean, now = new Date()): Promise<Personality> {
  const at = now.toISOString();
  const asked = { aiConsentAskedVersion: AI_CONSENT_VERSION };
  const next = await updatePersonality(user, (p): AiAnswered => (agree
    ? { ...p, ...asked, aiConsentAt: at, aiConsentVersion: AI_CONSENT_VERSION, aiConsentWithdrawnAt: null }
    // Off grants nothing. Withdrawn only when there was a yes to take back.
    : { ...p, ...asked, aiConsentAt: null, ...(p.aiConsentAt ? { aiConsentWithdrawnAt: at } : {}) }));
  remember(known, user.id, { ok: agreedIn(next), at: Date.now() });
  return next;
}

/** Not now on Home's card: kept as their answer to this wording, and nothing else (a yes given on another device stays). */
export async function setAiLater(user: AuthedUser): Promise<Personality> {
  const next = await updatePersonality(user, (p): AiAnswered => ({ ...p, aiConsentAskedVersion: AI_CONSENT_VERSION }));
  remember(known, user.id, { ok: agreedIn(next), at: Date.now() });
  return next;
}

/** The person a request or a piece of work is for (a sign-in read once a minute), and whether they agreed. No person: nothing to ask. */
async function allowed(who: { auth?: string; userId?: string }): Promise<boolean> {
  let id = who.userId ?? null;
  if (!id && who.auth) {
    const hit = whoIs.get(who.auth);
    if (hit && Date.now() - hit.at < TTL_MS) id = hit.id;
    else {
      id = (await resolveUser(who.auth).catch(() => null))?.id ?? null;
      remember(whoIs, who.auth, { id, at: Date.now() });
    }
  }
  return id ? hasAiConsent(id) : true;
}

/** The server's start: the gate asks this. */
export function installAiConsent(): void { installAiCheck(allowed); }

/** Forget what was read (tests). */
export function forgetAiConsent(): void { known.clear(); whoIs.clear(); }

export function registerAiConsentRoutes(app: FastifyInstance, o: { rateLimit: object }): void {
  const rl = { config: o.rateLimit };
  app.get(AI_CONSENT_PATH, rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Sign in first." });
    const p = await getPersonality(user);
    const agreed = agreedIn(p);
    return reply.send({ agreed, at: agreed ? p.aiConsentAt : null, version: AI_CONSENT_VERSION, services: AI_SERVICES, asked: answeredIn(p) });
  });
  app.put(AI_CONSENT_PATH, rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Sign in first." });
    const body = req.body as { agree?: unknown; later?: unknown } | null;
    const agree = body?.agree;
    if (typeof agree !== "boolean") return reply.code(400).send({ code: "bad_request", message: "agree must be true or false." });
    // Not now on the card is only an answer; the switch's off takes a yes back.
    const later = !agree && body?.later === true;
    try {
      const p = later ? await setAiLater(user) : await setAiConsent(user, agree);
      req.log.info({ userId: user.id, agree, later }, "ai consent changed");
      return reply.send({ agreed: agreedIn(p), at: agreedIn(p) ? p.aiConsentAt : null });
    } catch (err) {
      req.log.error({ err }, "ai consent: could not save");
      return reply.code(500).send({ code: "internal", message: "Couldn't save that. Try again." });
    }
  });
}

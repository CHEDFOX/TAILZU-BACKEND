/**
 * WHEN THE PHONE IS ASKED TO PROVE IT IS THE REAL APP, AND THE ONE-USE CHALLENGE IT PROVES IT WITH (docs/trust.md §the ask).
 *
 * The phone never attests on its own. The bootstrap's answer carries a `trust` ask only when the server wants something: a
 * new account, a score that has gone up, a session that has not been attested for a week, or a free-plan claim. The phone
 * runs each step in the background, once, never blocking a screen, and only the steps its own capabilities allow — so an
 * older binary, which declares none of them, is never asked for anything (and answering is never required: a phone that
 * cannot answer is "no signal", never a penalty).
 *
 * The challenge is 32 random bytes, good for five minutes and one use, kept in memory with the account it was made for. A
 * reply that carries somebody else's challenge, an expired one or one already used is refused before any verification runs.
 *
 * TRUST_ATTEST=off (the default) means no ask is ever sent, whatever the capabilities say.
 */
import { randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { trustSurface } from "./actions.js";
import type { ControlCtx } from "../control/rules.js";
// The contract itself, not a copy of it: `TrustAsk` is what the bootstrap carries and the capabilities are what the phone
// declares, so both live in the one file both ends read. A second copy here is a second thing to keep in step.
import {
  APP_ATTEST_CAPABILITY, DEVICE_CHECK_CAPABILITY, PLAY_INTEGRITY_CAPABILITY, type TrustAsk,
} from "../../../shared/types/sdui.js";

export type { TrustAsk };
export { APP_ATTEST_CAPABILITY, DEVICE_CHECK_CAPABILITY, PLAY_INTEGRITY_CAPABILITY };

/** One step of an ask: the member type of `TrustAsk["do"]`, so it cannot drift from the contract either. */
export type TrustStep = TrustAsk["do"][number];

export type AttestMode = "off" | "shadow" | "on";
export const attestMode = (): AttestMode => getConfig().TRUST_ATTEST;

// ------------------------------------------------------------------ challenges

/** Five minutes is plenty for a background step, and short enough that a copied challenge is worthless. */
export const CHALLENGE_MS = 5 * 60_000;
const CHALLENGE_MAX = 20_000;
const challenges = new Map<string, { userId: string; at: number }>();

/** A fresh challenge for this account. */
export function newChallenge(userId: string, now = Date.now()): string {
  if (challenges.size >= CHALLENGE_MAX) challenges.clear();
  const challenge = randomBytes(32).toString("base64url");
  challenges.set(challenge, { userId, at: now });
  return challenge;
}

/** Spends a challenge: it must be this account's, unexpired and unused. Once taken it is gone. */
export function takeChallenge(challenge: unknown, userId: string, now = Date.now()): boolean {
  const key = typeof challenge === "string" ? challenge : "";
  const row = challenges.get(key);
  if (!row) return false;
  challenges.delete(key);
  return row.userId === userId && now - row.at <= CHALLENGE_MS;
}

/** Tests. */
export function forgetChallengesForTests(): void { challenges.clear(); }

// ------------------------------------------------------------------ attested lately

/** How long one pass counts for, so a phone is not asked on every launch. */
export const ATTESTED_MS = 7 * 86_400_000;
const attested = new Map<string, number>();

/** This account's session has proved itself: it is not asked again for a week. */
export function markAttested(userId: string, now = Date.now()): void {
  if (attested.size >= CHALLENGE_MAX) attested.clear();
  attested.set(userId, now);
}
export function attestedLately(userId: string, now = Date.now()): boolean {
  const at = attested.get(userId);
  return !!at && now - at < ATTESTED_MS;
}
/** Tests. */
export function forgetAttestedForTests(): void { attested.clear(); }

// ------------------------------------------------------------------ the ask

export interface AskInput {
  userId: string;
  platform: string;
  /** What this build declared it can draw and do (the bootstrap's capabilities.components). */
  components?: readonly string[] | undefined;
  /** This account's last score, when there is one. */
  score?: number | undefined;
  /**
   * Whether this account already has an App Attest key stored for it. One key per account per install (docs/trust.md
   * §App Attest), so once there is one the phone is asked to SIGN with it (`appAssert`) and never to make another.
   */
  hasAttestKey?: boolean | undefined;
  createdAt?: string | undefined;
  /** True just before a free-plan claim: the one moment it is worth asking whatever the score says. */
  claiming?: boolean;
  now?: number;
  ctx?: Partial<ControlCtx>;
}

/**
 * The ask for this bootstrap, or nothing. Which steps: whatever this build can do on this platform. Whether at all: the
 * ramps in the trust surface (`attest.percent`, `integrity.percent`, both 0 today, so nothing is asked until they are moved).
 */
export function askFor(i: AskInput): TrustAsk | undefined {
  if (attestMode() === "off" || !i.userId) return undefined;
  const now = i.now ?? Date.now();
  const surface = trustSurface(i.ctx);
  const has = (name: string) => (i.components ?? []).includes(name);
  const ageMs = i.createdAt ? now - (Date.parse(i.createdAt) || now) : null;
  const isNew = ageMs !== null && ageMs < surface.newAccount.hours * 3600_000;
  const wanted = i.claiming || isNew || (i.score ?? 0) >= surface.thresholds.log || !attestedLately(i.userId, now);
  if (!wanted) return undefined;

  const ios = String(i.platform).toLowerCase() === "ios";
  const steps: TrustStep[] = [];
  // The share of accounts asked, worked out from the account's own id so one account's answer is the same every launch.
  const share = bucketOf(i.userId);
  // A key is made once and then signs: the first ask is `appAttest`, every ask after it is `appAssert` with that key.
  if (ios && has(APP_ATTEST_CAPABILITY) && share < surface.attest.percent) steps.push(i.hasAttestKey ? "appAssert" : "appAttest");
  if (ios && has(DEVICE_CHECK_CAPABILITY) && share < surface.attest.percent) steps.push("deviceCheck");
  if (!ios && has(PLAY_INTEGRITY_CAPABILITY) && share < surface.integrity.percent) steps.push("playIntegrity");
  if (!steps.length) return undefined;
  const cloudProject = getConfig().PLAY_INTEGRITY_CLOUD_PROJECT;
  return {
    challenge: newChallenge(i.userId, now),
    do: steps,
    ...(steps.includes("playIntegrity") && cloudProject ? { cloudProject } : {}),
  };
}

/** 0-99 from an account id, steady over time: the same account is always in the same share of the ramp. */
export function bucketOf(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/**
 * ONE SCORE, MADE OF REASONS YOU CAN READ (docs/trust.md §score).
 *
 * Every signal adds (or takes away) a fixed number of points with a short reason code, and the score is their sum. Nothing
 * here is a model, a threshold learnt from data or a black box: the admin view shows the same reasons this function used, so
 * "why was this account slowed" always has an answer in words.
 *
 * Pure: no clock of its own, no store, no config. The weights and thresholds come in from the control surface
 * (trust/defaults.ts), so they move from the console without a deploy, and every rule below is a test.
 *
 * TWO RULES THAT ARE NOT ARITHMETIC (docs/trust.md rule 6, §8.5):
 *   - A MISSING answer is never a penalty. A simulator, an old phone, a phone without Google Play services, a custom ROM and
 *     our own internal builds all give "no signal", and no signal scores nothing. What scores is a build that CLAIMED it can
 *     attest and then failed.
 *   - DeviceCheck's bit0 is Apple's own memory of the device, kept beyond any account of ours. It counts only while Apple's
 *     own last_update_time is inside the last 12 months; older reads as unset (and is cleared at the next write).
 */
import { DEVICE_BIT_MONTHS, TRUST_DEFAULTS, type TrustPayload, type TrustReason } from "./defaults.js";
import { netClassReason } from "./netClass.js";
import type { NetClass } from "./netKey.js";
import type { Verdicts } from "./store.js";

export type TrustAction = "none" | "log" | "slow" | "hold" | "ask";

export interface ScoreInput {
  netClass: NetClass;
  /** Different accounts seen on this network key in the last 24 hours and 7 days. Always 0 on a mobile network's IPv4. */
  accountsOnNet?: { day: number; week: number };
  disposableEmail?: boolean;
  tombstoneMatch?: boolean;
  /** What the request's own shape said (signals.ts). */
  shape?: readonly ("script" | "mismatch")[];
  /** One session seen from a data centre and a home or mobile network within the hour, or from four or more networks. */
  sessionMoved?: boolean;
  /** Different accounts on this install key in the last 30 days (8.4, behind its flag). */
  accountsOnInstall?: number;
  /** How old the account is, in milliseconds, or null when it is not known. */
  accountAgeMs?: number | null;
  /** An account over 30 days old that has really been used: the one signal that says "a person", not "a sign-up". */
  realUse?: boolean;
  /** How they signed in: "apple" and "google" cost a would-be abuser a real account, so they take points off. */
  provider?: string;
  /** What Apple and Google answered, as summaries. */
  verdicts?: Verdicts;
  /** What this build said it can do (its capabilities). A claim that then fails is the strong signal. */
  claimed?: { appAttest?: boolean; deviceCheck?: boolean; playIntegrity?: boolean };
  /** How many App Attest keys this device has made in 30 days (the receipt's own metric), or null when not asked. */
  attestKeys?: number | null;
  /** Now, for the 12-month rule on DeviceCheck's bits. */
  now?: number;
}

export interface Decision {
  score: number;
  reasons: TrustReason[];
  /** What the score reaches. Whether it HAPPENS is actions.ts's answer (each action has its own switch, all off today). */
  action: TrustAction;
}

/** Apple's `last_update_time` ("2026-11") against now: whether the bit was last written inside the 12 months that count. */
export function bitStillCounts(month: string | undefined, now: number): boolean {
  if (!month) return false;
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) return false;
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  const months = (now - then) / (30.44 * 86_400_000);
  return months >= 0 && months <= DEVICE_BIT_MONTHS;
}

/** The score, its reasons and the action it reaches. */
export function scoreOf(i: ScoreInput, p: TrustPayload = TRUST_DEFAULTS): Decision {
  const now = i.now ?? Date.now();
  const reasons: TrustReason[] = [];
  const add = (r: TrustReason) => { if (!reasons.includes(r)) reasons.push(r); };

  // The network.
  const net = netClassReason(i.netClass);
  if (net) add(net);

  // How many accounts came from it. Never counted per IPv4 on a mobile network: the caller passes zeros there.
  const day = i.accountsOnNet?.day ?? 0;
  const week = i.accountsOnNet?.week ?? 0;
  if (day >= 5 || week >= 8) add("net5");
  else if (day >= 3 || week >= 5) add("net3");

  if (i.disposableEmail) add("disposable");
  if (i.tombstoneMatch) add("tombstone");
  for (const s of i.shape ?? []) add(s);
  if (i.sessionMoved) add("sessionMoved");

  const installs = i.accountsOnInstall ?? 0;
  if (installs >= 5) add("install5");
  else if (installs >= 3) add("install3");

  // What Apple answered.
  const v = i.verdicts ?? {};
  const age = i.accountAgeMs ?? null;
  const young = age !== null && age < p.newAccount.hours * 3600_000;
  if (v.deviceCheck?.bit1) add("dcBit1");
  // bit0 says "a free account was already started on this phone" — by somebody. If WE set it for this very account, it
  // says only that this account exists, so it scores nothing here: an honest new iPhone must not flag itself on its
  // second launch. The next account that signs in on that phone has no mark of its own, so the bit counts for it.
  if (v.deviceCheck?.bit0 && !v.deviceCheck.setByUs && young && bitStillCounts(v.deviceCheck.month, now)) add("dcBit0");
  if ((i.attestKeys ?? 0) > 3) add("attestKeys");
  if (v.appAttest === "fail" && i.claimed?.appAttest) add("attestFailed");

  // What Google answered.
  const app = v.integrity?.app;
  const labels = v.integrity?.device;
  if (app === "UNRECOGNIZED_VERSION" && i.claimed?.playIntegrity) add("integrityUnrecognised");
  if (app && app !== "UNRECOGNIZED_VERSION" && Array.isArray(labels) && !labels.includes("MEETS_DEVICE_INTEGRITY")) add("noDeviceIntegrity");

  // The three that take points off.
  const passedApple = v.appAttest === "ok";
  const passedPlay = app === "PLAY_RECOGNIZED" && Array.isArray(labels) && labels.includes("MEETS_DEVICE_INTEGRITY");
  if (passedApple || passedPlay) add("attestPassed");
  const how = String(i.provider ?? "").toLowerCase();
  if (how === "apple" || how === "google") add("signedInWithApple");
  if (i.realUse && age !== null && age > 30 * 86_400_000) add("settledAccount");

  let score = reasons.reduce((n, r) => n + (p.weights[r] ?? 0), 0);
  // A new account is where free-plan abuse lives, so its score counts for more. Only ever applied to a score above zero.
  if (young && score > 0) score = Math.round(score * p.newAccount.times);

  const t = p.thresholds;
  const action: TrustAction = score >= t.ask ? "ask" : score >= t.hold ? "hold" : score >= t.slow ? "slow" : score >= t.log ? "log" : "none";
  return { score, reasons, action };
}

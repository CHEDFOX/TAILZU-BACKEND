/**
 * WHAT HAPPENS TO A SCORE, AND WHO IT MAY NEVER HAPPEN TO (docs/trust.md §actions).
 *
 *   trustMode()        off | shadow | on. Off: nothing at all. Shadow: rows, scores and a log line saying what it WOULD do.
 *   look()             one request's whole pass: collect, score, write the score, and (on `on`) take the action
 *   heldFreeUse(id)    whether this account is on the $3 free month instead of Lite's stretches right now (you/usage.ts)
 *   slowedDown(id)     whether this account keeps the free plan's single slot and a lower rate limit (guard, http/plugins.ts)
 *   clear(id)          an admin took the score away (a second-hand phone, a mistake)
 *
 * WHO IS NEVER ACTED ON (docs/trust.md rule 5): anyone with a payment, the review account, the ids in
 * QUOTA_EXEMPT_USER_IDS, and the desktop's `static-*` tokens. They are scored (so the shadow data is honest) and the score is
 * written, but no action is ever applied to them. And nothing here can close an account: the strongest action is to hold the
 * free plan, which answers the 429 the apps have always shown.
 *
 * The hold and the slow live in memory, with their own clock, so a restart forgets them and nothing we hold is permanent.
 * Each is read by the code that already decides those two things; there is no new refusal, no new screen and no app update.
 */
import { applyRules, type ControlCtx } from "../control/rules.js";
import { controlStore } from "../control/index.js";
import { getConfig } from "../config.js";
import { TRUST_DEFAULTS, type TrustPayload } from "./defaults.js";
import { collect, shapeOf, NEW_ACCOUNT_DAYS, type TlsHints } from "./signals.js";
import { emailKey } from "./email.js";
import { lists } from "./lists.js";
import { scoreOf, type Decision, type ScoreInput, type TrustAction } from "./score.js";
import { trustStore, type TrustStore, type Verdicts } from "./store.js";
import { keyOf } from "./netKey.js";
import { trustMode, type TrustMode } from "./mode.js";

// The kill switch is its own file (mode.ts), so the store can read it without importing this one. Re-exported here
// because this is where every caller already looks for it.
export { trustMode, type TrustMode };

/** The weights and switches for this request: the defaults with the control plane's "trust" rules applied. Never throws. */
export function trustSurface(ctx: Partial<ControlCtx> = {}): TrustPayload {
  const base = structuredClone(TRUST_DEFAULTS) as TrustPayload;
  const store = controlStore();
  if (!store) return base;
  try {
    return applyRules(base, store.rules(), { ...ctx, surface: "trust" }).payload;
  } catch {
    return base;
  }
}

// ------------------------------------------------------------------ never acted on

/** The accounts no action may ever touch. `paid` is the caller's own read of the entitlement, so this file reads no billing. */
export function neverActOn(o: { userId: string; email?: string | undefined; paid?: boolean }): boolean {
  if (!o.userId) return true;
  if (o.paid) return true;
  if (o.userId.startsWith("static-") || o.userId === "dev-user") return true;
  const cfg = getConfig();
  const exempt = (cfg.QUOTA_EXEMPT_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (exempt.includes(o.userId)) return true;
  const review = cfg.REVIEW_EMAIL?.trim().toLowerCase();
  return !!review && !!o.email && o.email.trim().toLowerCase() === review;
}

// ------------------------------------------------------------------ the two registries

/** The bands, weakest first: what a score reaches, and what it has therefore also passed. */
const BANDS: readonly TrustAction[] = ["none", "log", "slow", "hold", "ask"];

interface Until { until: number }
const held = new Map<string, Until>();
const slowed = new Map<string, Until>();
const MOST = 20_000;

const liveIn = (m: Map<string, Until>, userId: string, now: number): boolean => {
  const row = m.get(userId);
  if (!row) return false;
  if (row.until <= now) { m.delete(userId); return false; }
  return true;
};
const put = (m: Map<string, Until>, userId: string, until: number): void => {
  if (m.size >= MOST) m.clear();
  m.set(userId, { until });
};

/**
 * Whether this account's free use is held right now: planOf gives it the free month's one allowance instead of Lite's five
 * stretches, and no words are earned (usage/allowance.ts). Nothing else changes, and the refusal is the 429 the apps know.
 */
export const heldFreeUse = (userId: string, now = Date.now()): boolean => liveIn(held, userId, now);

/** Whether this account is slowed right now: the free plan's single slot, and a lower rate limit. */
export const slowedDown = (userId: string, now = Date.now()): boolean => liveIn(slowed, userId, now);

/** An admin cleared the score (docs/trust.md §admin): the hold and the slow go with it. */
export function clearLive(userId: string): void {
  held.delete(userId);
  slowed.delete(userId);
}

/** Tests. */
export function forgetActionsForTests(): void { held.clear(); slowed.clear(); }

/**
 * What Apple or Google just answered, kept with this account's score (summaries only: "ok", "fail", two bits, three labels).
 * The score itself is left as it was; the next pass over a request works it out again with the new verdicts in hand.
 */
export async function noteVerdicts(userId: string, patch: Verdicts, o: { now?: number; store?: TrustStore } = {}): Promise<void> {
  const store = o.store ?? trustStore();
  const now = o.now ?? Date.now();
  const had = await store.score(userId).catch(() => null);
  // Each answer is stamped with when it was given, so the sweeper can keep the policy's promise: Apple's and Google's
  // answers go after 30 days, while the score row itself lives as long as the account (and is worked out again anyway).
  const at = { ...(had?.verdicts?.at ?? {}) };
  for (const kind of ["appAttest", "deviceCheck", "integrity"] as const) {
    if (patch[kind] !== undefined) at[kind] = now;
  }
  await store.putScore({
    userId,
    score: had?.score ?? 0,
    reasons: had?.reasons ?? [],
    action: had?.action ?? "none",
    verdicts: { ...(had?.verdicts ?? {}), ...patch, ...(Object.keys(at).length ? { at } : {}) },
    updatedAt: now,
  });
}

// ------------------------------------------------------------------ one request's pass

export interface LookInput {
  userId: string;
  ip: unknown;
  email?: string | undefined;
  /** Whether they have a payment. The caller reads the entitlement; this file never does. */
  paid?: boolean;
  /** When the account was made, as Supabase gives it (resolveUser().createdAt). */
  createdAt?: string | undefined;
  provider?: string | undefined;
  /** What the request's own shape said (signals.ts shapeOf). */
  shape?: readonly ("script" | "mismatch")[];
  sessionMoved?: boolean;
  disposableEmail?: boolean;
  tombstoneMatch?: boolean;
  accountsOnInstall?: number;
  verdicts?: Verdicts;
  claimed?: ScoreInput["claimed"];
  attestKeys?: number | null;
  realUse?: boolean;
  /**
   * True for the hook that sees every signed-in request (http/hooks.ts): the row and the score are written, and NO action is
   * ever applied. The reason is rule 5 — that hook knows the account id and nothing else, and an action must never be taken
   * without knowing whether this is a payer, the review account or an exempt id. The bootstrap, which has read the
   * entitlement and the email already, is where an action can be decided.
   */
  collectOnly?: boolean;
  now?: number;
  store?: TrustStore;
  ctx?: Partial<ControlCtx>;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export interface Looked extends Decision {
  /** What was actually done. "none" in shadow, whatever the switches allow when the mode is on. */
  applied: TrustAction | "none";
  mode: TrustMode;
}

/**
 * The whole pass for one request: collect the row and the counts, score it, write the score, and apply the action when the
 * mode is `on` AND that action's own switch is true. Never throws: abuse prevention must not be able to fail a request.
 */
export async function look(i: LookInput): Promise<Looked | null> {
  const mode = trustMode();
  if (mode === "off" || !i.userId) return null;
  const now = i.now ?? Date.now();
  const store = i.store ?? trustStore();
  const surface = trustSurface(i.ctx);
  const ageMs = i.createdAt ? now - (Date.parse(i.createdAt) || now) : null;
  // Only a NEW account's row is counted (docs/trust.md §score), so the row says whether this account was new when it was
  // written. The background hook does not know the account's age, so its rows are never counted — the launch writes those.
  const newAcct = ageMs !== null && ageMs < NEW_ACCOUNT_DAYS * 86_400_000;
  const got = await collect({ ip: i.ip, userId: i.userId, newAcct, now, store });
  if (!got) return null;
  const decision = scoreOf({
    netClass: got.netClass,
    accountsOnNet: got.accountsOnNet,
    disposableEmail: i.disposableEmail,
    tombstoneMatch: i.tombstoneMatch,
    shape: i.shape,
    sessionMoved: i.sessionMoved,
    accountsOnInstall: i.accountsOnInstall,
    accountAgeMs: ageMs,
    realUse: i.realUse,
    provider: i.provider,
    verdicts: i.verdicts,
    claimed: i.claimed,
    attestKeys: i.attestKeys ?? null,
    now,
  }, surface);

  const exempt = neverActOn({ userId: i.userId, email: i.email, paid: i.paid });
  const mayAct = mode === "on" && !exempt && i.collectOnly !== true;
  let applied: TrustAction | "none" = "none";
  if (mayAct) {
    const young = ageMs !== null && ageMs < surface.hold.maxAccountDays * 86_400_000;
    // THE BANDS ARE A LADDER, NOT A CHOICE. A score that reaches `ask` has passed `hold` and `slow` on the way, so when
    // the band it reached is switched off the strongest one BELOW it that is on still applies. Otherwise `ask`, which
    // has no screen and stays off in 8.9.1, would let the very worst scores through untouched while a lesser one is held.
    const reached = BANDS.indexOf(decision.action);
    const at = (band: TrustAction) => reached >= BANDS.indexOf(band);
    if (at("ask") && surface.actions.ask) applied = "ask";
    else if (at("hold") && surface.actions.hold && young && !i.paid) {
      put(held, i.userId, now + surface.hold.minutes * 60_000);
      applied = "hold";
    } else if (at("slow") && surface.actions.slow) {
      put(slowed, i.userId, now + surface.slow.minutes * 60_000);
      applied = "slow";
    }
  }

  if (decision.score >= surface.thresholds.log || applied !== "none") {
    // Ids and counts only: no address, no email, no token, and never the other accounts behind a key.
    i.log?.info({
      user: i.userId, score: decision.score, reasons: decision.reasons, net: got.netClass,
      accounts: got.accountsOnNet.day, would: decision.action, applied, mode, exempt, mayAct,
    }, mode === "on" ? "trust: a score was acted on" : "trust: a score, shadow only");
  }

  // THE BACKGROUND PASS WRITES NO SCORE. It sees one request's network and nothing else — no email, no tombstone, no
  // install, no verdicts, not even the account's age — so its score is always the poorer one, and writing it would
  // overwrite what the launch worked out with everything in hand (and would wipe Apple's and Google's answers with it).
  // The row it came for is already written by collect() above, which is all this pass is for.
  if (i.collectOnly !== true) {
    // The answers from Apple and Google belong to the account, not to this request: a pass that was not given any keeps
    // the ones already stored, with their own times (noteVerdicts stamps them).
    const kept = i.verdicts ?? (await store.score(i.userId).catch(() => null))?.verdicts ?? {};
    await store.putScore({
      userId: i.userId, score: decision.score, reasons: decision.reasons,
      action: applied === "none" ? (decision.action === "none" ? "none" : "log") : applied,
      verdicts: kept, updatedAt: now,
    }).catch(() => undefined);
  }

  return { ...decision, applied, mode };
}

// ------------------------------------------------------------------ the launch

export interface LaunchLook {
  userId: string;
  ip: unknown;
  email?: string | undefined;
  /** Whether they have a payment. Read by the caller, which has the entitlement in hand already. */
  paid: boolean;
  createdAt?: string | undefined;
  provider?: string | undefined;
  /** What the bootstrap's own body said about this build. Only these four fields are ever read (docs/trust.md rule 7). */
  platform?: string | undefined;
  bundle?: string | undefined;
  appVersion?: string | undefined;
  hasCapabilities: boolean;
  userAgent?: string | undefined;
  /** The coarse TLS hints the proxy forwarded (signals.ts tlsHints). This request's own score only, never stored. */
  tls?: TlsHints | undefined;
  /** The X-App-Install header (8.4): a random number the app made at first launch. Read only while the flag is on. */
  install?: string | undefined;
  /** Whether this account has really been used (it has said something to a bot before). */
  realUse?: boolean;
  /** What this build declared it can do (the bootstrap's capabilities.components): a claim that then fails is the signal. */
  components?: readonly string[] | undefined;
  now?: number;
  store?: TrustStore;
  ctx?: Partial<ControlCtx>;
  log?: LookInput["log"];
}

/** A random v4 UUID, which is all the install id may ever be: made by the app, never derived from the phone (8.4). */
const INSTALL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * THE ONE PLACE AN ACTION CAN BE DECIDED (the bootstrap, docs/trust.md §collection): it is the only request that has already
 * read the entitlement and the account's address, which rule 5 needs before anything is ever applied.
 *
 * It gathers what a launch can see — the network, the email's shape, a deletion tombstone, the install id while its flag is
 * on — scores it and applies whatever the switches allow. Never throws; a launch is never held up or failed by this.
 */
export async function lookAtLaunch(i: LaunchLook): Promise<Looked | null> {
  if (trustMode() === "off" || !i.userId) return null;
  const now = i.now ?? Date.now();
  const store = i.store ?? trustStore();
  const surface = trustSurface(i.ctx);
  const key = i.email ? emailKey(i.email) : null;
  const tombstoneMatch = key ? await store.tombstoned(key, "email").catch(() => false) : false;
  const disposableEmail = i.email ? lists().disposable.has(i.email) : false;

  // The install id: counted, never joined (rule 9), and only while the flag is on and it really is a made-up random number.
  let accountsOnInstall = 0;
  if (surface.installId && i.install && INSTALL_RE.test(i.install)) {
    const deviceKey = keyOf("install", i.install.toLowerCase());
    if (deviceKey) {
      await store.seeDevice({ deviceKey, kind: "install", userId: i.userId, at: now }).catch(() => undefined);
      accountsOnInstall = await store.countAccountsOnDevice(deviceKey).catch(() => 0);
    }
  }

  const had = await store.score(i.userId).catch(() => null);
  return look({
    userId: i.userId,
    ip: i.ip,
    email: i.email,
    paid: i.paid,
    createdAt: i.createdAt,
    provider: i.provider,
    shape: shapeOf({
      userAgent: i.userAgent,
      platform: i.platform,
      bundle: i.bundle,
      appVersion: i.appVersion,
      hasCapabilities: i.hasCapabilities,
      appRoute: true,
      tls: i.tls,
    }),
    disposableEmail,
    tombstoneMatch,
    accountsOnInstall,
    verdicts: had?.verdicts ?? {},
    // What this build SAID it can do. A step that was never claimed is never a penalty when it is missing (rule 6).
    claimed: {
      appAttest: (i.components ?? []).includes("AppAttest1"),
      deviceCheck: (i.components ?? []).includes("DeviceCheck1"),
      playIntegrity: (i.components ?? []).includes("PlayIntegrity1"),
    },
    // Apple's "how many keys has this DEVICE made" metric comes from the attestation receipt, which we do not ask for
    // yet (docs/trust.md §App Attest). Our own count is how many keys THIS ACCOUNT has made, which is a different
    // number — an honest person who reinstalls four times would be scored for it — so nothing is passed until the real
    // metric exists.
    attestKeys: null,
    realUse: i.realUse,
    now,
    store,
    ctx: i.ctx,
    log: i.log,
  });
}

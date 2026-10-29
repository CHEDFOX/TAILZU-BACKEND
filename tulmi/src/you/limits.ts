/**
 * THE USAGE LIMITS, KEPT: what the person has used of this stretch and this month (usage.ts, over the real records), and every place the bots
 * spend, held to it. The limits are ours, per plan (config.ts USAGE_*); the person only ever sees how much is used and when it resets.
 *
 *   A Code bot job     POST /v1/code/jobs: its budget is held to what is left of the stretch. A job that reaches it pauses and asks "This job
 *                      has used a lot of this stretch. Keep going?"; a yes (POST /v1/code/jobs/:id/budget, a team part's rerun) is held to what
 *                      is left too. With nothing left the job is not started, and the answer says when it resets.
 *   A bot's answer     Bots.ask / test / askWithKey (the bots platform's three ways in, and so Ask's answers): refused once the stretch is used
 *                      up, with the sentence. What each answer cost is written to you_spend when it comes back, so the meter counts every bot.
 *   Ask and Keybot     metering.enforceQuota asks the gate set here (setUsageGate) before any paid upstream: Keybot's dictation and rewrites,
 *                      the old Ask, the front door. Keybot's words count at USAGE_KEYBOT_PAISE_PER_1000_WORDS.
 *
 * Every refusal is 429 { code: "quota_exceeded", reason: "usage_limit", message, resetsAt, upgrade }: "You've reached this stretch's limit.
 * It resets Thu 9 am." The apps open the bootstrap's quota.screenId on it (the Bots app's Usage page).
 *
 * Plugged in from outside (install()), on the services the server already made: request hooks for the job routes, and a wrapper around the
 * Bots instance's three methods. A failure to read the meter never stops a bot: the limit is a guard rail, not a reason for an outage.
 *
 * What the meter reads is kept for a short while per person (and grown by every answer recorded), so a busy bot does not read the records on
 * every turn.
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { getEntitlement, type Entitlement } from "../billing/entitlements.js";
import { BotError, type Bots } from "../bots/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import { getConfig } from "../config.js";
import { usageMomentsSince } from "../usage/metering.js";
import { spendReport, type SpendReport } from "./spend.js";
import type { YouStore } from "./store.js";
import type { YouSettings } from "./settings.js";
import { planOf, refusalOf, usageNow, type UsageEvent, type UsageNow, type UsagePlan, type UsageRefusal } from "./usage.js";

/** India first: the month turns at midnight IST until the person's own offset is known (the screens send it). */
export const DEFAULT_TZ = 330;
const CACHE_MS = 30_000;
const JOBS_READ = 200;
/** The meter reads this far back: a billing month and a day or two either side. */
const READ_BACK_MS = 33 * 86_400_000;

/** What the meter adds up, read once and kept for CACHE_MS. */
interface MeterRead { at: number; events: UsageEvent[]; plan: UsagePlan; anchor: number | null }

export class Spending {
  private readonly cache = new Map<string, { at: number; report: SpendReport; settings: YouSettings }>();
  private readonly meters = new Map<string, MeterRead>();
  private readonly tz = new Map<string, number>();
  readonly now: () => number;

  constructor(private readonly o: {
    store: YouStore;
    jobs: JobRouter | null;
    now?: () => number;
    /** The person's entitlement (billing/entitlements.ts unless a test says). */
    entitlement?: (userId: string) => Promise<Entitlement | null>;
    /** Keybot's words since a moment (usage_events unless a test says). */
    words?: (userId: string, since: number) => Promise<Array<{ at: number; words: number }>>;
  }) {
    this.now = o.now ?? Date.now;
  }

  get store(): YouStore { return this.o.store; }

  /** The person's offset from UTC in minutes, as their screens last said it. */
  tzOf(userId: string): number { return this.tz.get(userId) ?? DEFAULT_TZ; }
  noteTz(userId: string, tz: unknown): number {
    const n = Number(tz);
    if (Number.isFinite(n) && n >= -840 && n <= 840) this.tz.set(userId, Math.round(n));
    return this.tzOf(userId);
  }

  /** The month as it stands, from the records (fresh: the screens ask for it). Ours: costs, for the logs and the admin; no screen shows it. */
  async report(userId: string, tz = this.tzOf(userId)): Promise<{ report: SpendReport; settings: YouSettings }> {
    const now = this.now();
    const [settings, jobs, rows] = await Promise.all([
      this.o.store.getSettings(userId),
      this.o.jobs ? this.o.jobs.listJobs(userId, JOBS_READ).catch(() => []) : Promise.resolve([]),
      this.o.store.spendSince(userId, now - 40 * 86_400_000).catch(() => []),
    ]);
    const report = spendReport({
      jobs: jobs.map((j) => ({ id: j.id, task: j.task, state: j.state, spentPaise: j.spentPaise, createdAt: j.createdAt, updatedAt: j.updatedAt })),
      rows, limitPaise: settings.monthLimitPaise, stopAtLimit: settings.stopAtLimit, now, tzOffsetMinutes: tz,
    });
    this.cache.set(userId, { at: now, report, settings });
    return { report, settings };
  }

  /** The month, from the short cache when it is fresh. */
  async month(userId: string): Promise<{ report: SpendReport; settings: YouSettings }> {
    const hit = this.cache.get(userId);
    if (hit && this.now() - hit.at < CACHE_MS) return hit;
    return this.report(userId);
  }

  forget(userId: string): void { this.cache.delete(userId); this.meters.delete(userId); }

  /** What the meter adds up: the Code bot's jobs, every bot's answers and Keybot's words, with the plan and the billing month's anchor. */
  private async read(userId: string, fresh = false): Promise<MeterRead> {
    const hit = this.meters.get(userId);
    const now = this.now();
    if (hit && !fresh && now - hit.at < CACHE_MS) return hit;
    const c = getConfig();
    const since = now - READ_BACK_MS;
    const rate = c.USAGE_KEYBOT_PAISE_PER_1000_WORDS;
    const [ent, jobs, rows, words] = await Promise.all([
      (this.o.entitlement ?? ((id: string) => getEntitlement({ id })))(userId).catch(() => null),
      this.o.jobs ? this.o.jobs.listJobs(userId, JOBS_READ).catch(() => []) : Promise.resolve([]),
      this.o.store.spendSince(userId, since).catch(() => []),
      rate > 0 ? (this.o.words ?? keybotWords)(userId, since).catch(() => []) : Promise.resolve([]),
    ]);
    const events: UsageEvent[] = [
      ...jobs.filter((j) => j.spentPaise > 0 && j.updatedAt >= since).map((j) => ({ at: j.updatedAt, paise: j.spentPaise })),
      ...rows.map((r) => ({ at: r.at, paise: r.paise })),
      ...words.filter((w) => w.words > 0).map((w) => ({ at: w.at, paise: (w.words * rate) / 1000 })),
    ];
    const anchor = ent?.active && ent.expiresAt ? Date.parse(ent.expiresAt) || null : null;
    const read: MeterRead = { at: now, events, plan: planOf(ent, c), anchor };
    this.meters.set(userId, read);
    return read;
  }

  /** The meter, now: how much of this stretch and this month is used, and when each resets. Fresh when the screens ask. */
  async usage(userId: string, o: { tz?: number; fresh?: boolean } = {}): Promise<UsageNow> {
    const r = await this.read(userId, o.fresh);
    return usageNow({ events: r.events, now: this.now(), tzOffsetMinutes: o.tz ?? this.tzOf(userId), anchor: r.anchor, plan: r.plan, nearAt: getConfig().USAGE_NEAR });
  }

  /** What may still be used this stretch, ours, in paise; null when the limits are off (or the meter could not be read). */
  async leftToSpend(userId: string): Promise<number | null> {
    if (!getConfig().USAGE_LIMITS) return null;
    try { return (await this.usage(userId)).leftPaise; } catch { return null; }
  }

  /** The refusal when the stretch (or the month) is used up, else null. Never throws. */
  async refusal(userId: string): Promise<UsageRefusal | null> {
    if (!getConfig().USAGE_LIMITS) return null;
    try {
      const u = await this.usage(userId);
      return u.state === "out" ? refusalOf(u, this.now(), this.tzOf(userId)) : null;
    } catch { return null; }
  }

  /** One answer's cost, written down. Never throws: a lost row is a gap in a chart, not a failed answer. */
  record(userId: string, bot: string, paise: number): void {
    if (!(paise > 0) || !userId) return;
    const at = this.now();
    const hit = this.cache.get(userId);
    if (hit) {
      hit.report.monthPaise += paise;
      hit.report.leftPaise = Math.max(0, hit.report.limitPaise - hit.report.monthPaise);
    }
    this.meters.get(userId)?.events.push({ at, paise });
    void this.o.store.addSpend(userId, bot, paise, at).catch(() => undefined);
  }

  /** Refuses a bot's answer once the stretch is used up. */
  async gate(userId: string): Promise<void> {
    const r = await this.refusal(userId);
    if (r) throw new BotError("quota_exceeded", r.message, 429, { reason: r.reason, resetsAt: r.resetsAt, upgrade: r.upgrade });
  }
}

/** Keybot's words since a moment, from usage_events (a person's own rows; none when they cannot be read). */
async function keybotWords(userId: string, since: number): Promise<Array<{ at: number; words: number }>> {
  const rows = await usageMomentsSince({ id: userId }, new Date(since).toISOString());
  return (rows ?? []).map((r) => ({ at: r.at, words: r.words }));
}

const WRAPPED = Symbol.for("tailzu.you.limits");

/** The bots platform's three ways in, held to the meter and written down. Once per instance. */
export function wrapBots(bots: Bots, spending: Spending): void {
  const b = bots as Bots & { [WRAPPED]?: true };
  if (b[WRAPPED]) return;
  b[WRAPPED] = true;
  const ask = bots.ask.bind(bots), test = bots.test.bind(bots), withKey = bots.askWithKey.bind(bots), ownerOfKey = bots.ownerOfKey.bind(bots);
  bots.ask = async (userId, ref, input) => {
    await spending.gate(userId);
    const a = await ask(userId, ref, input);
    spending.record(userId, a.bot.slug, a.paise);
    return a;
  };
  bots.test = async (userId, definition, input) => {
    await spending.gate(userId);
    const a = await test(userId, definition, input);
    // A draft has no bot of its own yet: what talking to it cost is Tailzu's, making the bot.
    spending.record(userId, "tailzu", a.paise);
    return a;
  };
  bots.askWithKey = async (authorization, slug, input) => {
    const owner = await ownerOfKey(authorization).catch(() => null);
    if (owner) await spending.gate(owner);
    const r = await withKey(authorization, slug, input);
    if (owner) spending.record(owner, r.answer.bot.slug, r.answer.paise);
    return r;
  };
}

/** The job routes that spend more: a new job, "Keep going", a part run again. */
const NEW_JOB = /^\/v1\/code\/jobs$/;
const MORE = /^\/v1\/code\/jobs\/[^/]+\/(?:budget|team\/parts\/[^/]+\/rerun)$/;

/**
 * The job routes, held to the meter: a request hook (it runs before the route's own handler) that lowers the budget a new job asks for, or
 * the more a "Keep going" adds, to what is left of the stretch, or answers the refusal (429) when nothing is.
 */
export function holdJobsToUsage(app: FastifyInstance, spending: Spending, jobs: JobRouter): void {
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "POST") return;
    const path = req.url.split("?")[0]!;
    const isNew = NEW_JOB.test(path);
    if (!isNew && !MORE.test(path)) return;
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return; // the route answers 401 itself
    const refused = await spending.refusal(user.id);
    if (refused) return reply.code(429).send(refused);
    const left = await spending.leftToSpend(user.id);
    if (left === null) return;
    const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    if (isNew) {
      const asked = typeof body.budgetPaise === "number" ? body.budgetPaise : jobs.defaultBudget();
      if (asked > left) req.body = { ...body, budgetPaise: Math.floor(left) };
    } else if (typeof body.addPaise === "number" && body.addPaise > left) {
      req.body = { ...body, addPaise: Math.max(1, Math.floor(left)) };
    }
  });
}

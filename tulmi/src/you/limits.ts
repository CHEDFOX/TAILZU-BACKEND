/**
 * THE USAGE LIMITS, KEPT: what the person has used of this month (usage.ts, over the real records), and every place the bots spend, held to
 * it. The limits are ours, per plan (config.ts USAGE_*); the person only ever sees how much is used and when it starts again.
 *
 *   A Xode job     POST /v1/code/jobs: its budget is held to what is left of the month. A job that reaches it pauses and asks "This job
 *                      has used a lot of this month. Keep going?"; a yes (POST /v1/code/jobs/:id/budget, a team part's rerun) is held to what
 *                      is left too. With nothing left the job is not started, and the answer says when it resets.
 *   A bot's answer     Bots.ask / test / askWithKey (the bots platform's three ways in, and so Ask's answers): refused once the month is used
 *                      up, with the sentence. What each answer cost is written to you_spend when it comes back, so the meter counts every bot.
 *   Ask and Keylessbord     metering.enforceQuota asks the gate set here (setUsageGate) before any paid upstream: Keylessbord's dictation and rewrites,
 *                      the old Ask, the front door. What each of those really cost (OpenRouter's charge, the speech engines' and the voice's
 *                      list prices: usage/cost.ts) is written to you_spend through the sink set here (setCostSink, recordUsd).
 *
 * The limits are in US dollars (config.ts USAGE_*_USD); the records keep paise, counted at CODE_USD_INR, and the plans' dollars become paise at
 * the same rate (usage.ts planOf), so the meter counts dollars.
 *
 * Every refusal is 429 { code: "quota_exceeded", reason: "usage_limit", message, resetsAt, upgrade }: "You've reached this month's limit.
 * It resets Sun 1 Nov." The apps open the bootstrap's quota.screenId on it (the Bots app's Usage page).
 *
 * THE BURN BRAKE (`burning`, below) is the other half, and it is NOT a limit the person has: it only says no to a person spending faster in
 * one hour than any real person does, and it says it in the overload guard's words. The month itself is theirs to spend whenever.
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
import { membersOn, payerFor, payerNow, planShareOn, type Payer } from "../billing/planShare.js";
import { BotError, type Bots } from "../bots/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import { getConfig } from "../config.js";
import { SpendMeter } from "../code/brain/spend.js";
import type { Quota } from "../usage/metering.js";
import { spendReport, type SpendReport } from "./spend.js";
import type { YouStore } from "./store.js";
import type { YouSettings } from "./settings.js";
import { burnCapPaise, cycleOf, planOf, refusalOf, spentSince, usageNow, type UsageEvent, type UsageNow, type UsagePlan, type UsageRefusal } from "./usage.js";

/** India first: the month turns at midnight IST until the person's own offset is known (the screens send it). */
const DEFAULT_TZ = 330;
const CACHE_MS = 30_000;
const JOBS_READ = 200;
/** The meter reads this far back: a billing month and a day or two either side. */
const READ_BACK_MS = 33 * 86_400_000;
/** The burn brake's window: what one person spent in the hour just gone. */
const BURN_WINDOW_MS = 3_600_000;
/** How many people on one shared plan have their Xode jobs read into the owner's month (`jobsOf`). A bound, not a seat count. */
const MEMBER_JOBS = 25;

/**
 * WHAT SOMEBODY WHO MEETS THE BURN BRAKE IS TOLD, and why it is these words.
 *
 * They have not run out: their month is theirs and most of it is probably still there. What has happened, from where they stand, is that
 * the server will not take any more from them for a minute — which is exactly what the overload guard says when the server itself is
 * loaded (src/guard/limiter.ts `Overloaded`), so they get the same sentence and the same 429 `overloaded`. Saying "you've reached this
 * month's limit" would be false, would send them to the Usage screen to look at a meter that is nowhere near full, and would read as a
 * nudge to buy a bigger plan — selling someone a plan to get around our own runaway is not something we do. Nothing about the brake is
 * advertised, drawn on the Usage screen, or mentioned in any plan.
 */
const BUSY = "X0 Bot is busy right now. Try again in a moment.";
const BUSY_REASON = "too_fast";
const BUSY_RETRY_SEC = 60;
/** The 429 a route sends, shaped like the overload guard's own (routes/code/code.ts failCode), so no app needs to learn anything. */
const busyBody = { code: "overloaded", reason: BUSY_REASON, message: BUSY, retryAfterSec: BUSY_RETRY_SEC };

/** What the meter adds up, read once and kept for CACHE_MS. `payer` is whose month this is: the person, unless they are on someone else's plan. */
interface MeterRead { at: number; events: UsageEvent[]; plan: UsagePlan; anchor: number | null; payer: Payer }

export class Spending {
  private readonly cache = new Map<string, { at: number; report: SpendReport; settings: YouSettings }>();
  private readonly meters = new Map<string, MeterRead>();
  private readonly tz = new Map<string, number>();
  /** What each person's uses outside the gateway came to exactly, against the whole paise written (recordUsd). */
  private readonly carry = new SpendMeter();
  readonly now: () => number;

  constructor(private readonly o: {
    store: YouStore;
    jobs: JobRouter | null;
    now?: () => number;
    /** The person's entitlement (billing/entitlements.ts unless a test says). */
    entitlement?: (userId: string) => Promise<Entitlement | null>;
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

  forget(userId: string): void {
    // Keyed on the payer, so forgetting a member must forget the month they are drawing on too, else their next read is stale.
    const payer = payerNow(userId)?.userId;
    this.cache.delete(userId);
    this.meters.delete(userId);
    if (payer && payer !== userId) { this.cache.delete(payer); this.meters.delete(payer); }
  }

  /**
   * WHOSE MONTH IS THIS? The one place a user id becomes a payer, and the reason it is here rather than at each caller.
   *
   * Every read of the meter in this class goes through `read()` and every write through `record()` — there is no other way to
   * reach the events, the plan or the records — so resolving the payer at those two points means it happens exactly once per
   * request and cannot be forgotten by a method written later: a new method that does not call one of them has no meter to key
   * wrongly. `refusal`, `gate`, `burning`, `leftToSpend`, `usage` and `holdJobsToUsage` all land here without knowing about it.
   *
   * With PLAN_SHARE off (the default) this answers "themselves" before any read, so nothing about the meter changes at all.
   */
  private async payerOf(userId: string): Promise<Payer> { return payerFor(userId); }

  /**
   * What the meter adds up, with the plan and the billing month's anchor: Xode's jobs (code_jobs.spent_paise) and you_spend, where every
   * bot's answer, the front door's messages and Keylessbord's, Ask's and notes' real costs (usage/cost.ts) are written.
   *
   * Read, kept and keyed under the PAYER: someone on another person's plan reads that person's month, their plan and their
   * anchor, which is what "one shared pot" means — thirty people on one plan share one cached read of one month.
   */
  private async read(userId: string, fresh = false): Promise<MeterRead> {
    const payer = await this.payerOf(userId);
    const id = payer.userId;
    const hit = this.meters.get(id);
    const now = this.now();
    if (hit && !fresh && now - hit.at < CACHE_MS) return hit;
    const c = getConfig();
    const since = now - READ_BACK_MS;
    const [ent, jobs, rows] = await Promise.all([
      (this.o.entitlement ?? ((x: string) => getEntitlement({ id: x })))(id).catch(() => null),
      this.jobsOf(id),
      this.o.store.spendSince(id, since).catch(() => []),
    ]);
    const events: UsageEvent[] = [
      ...jobs.filter((j) => j.spentPaise > 0 && j.updatedAt >= since).map((j) => ({ at: j.updatedAt, paise: j.spentPaise })),
      ...rows.map((r) => ({ at: r.at, paise: r.paise })),
    ];
    const anchor = ent?.active && ent.expiresAt ? Date.parse(ent.expiresAt) || null : null;
    // The payer's id is what lets abuse prevention's hold reach the meter (src/trust, docs/trust.md §actions): while an
    // account's free use is held, planOf gives it the free month's $3 instead of Lite's $35. This is the only place the
    // plan is read, so without it the hold would change nothing about what may be spent. A payer is never held (planOf
    // reaches the paid branches first), and the read is kept for CACHE_MS like everything here.
    const read: MeterRead = { at: now, events, plan: planOf(ent, c, { userId: id }), anchor, payer };
    this.meters.set(id, read);
    return read;
  }

  /**
   * A Xode job's spend is not written to you_spend: it lives on the job's own row (code_jobs.spent_paise), under the person who
   * started it. So when this month is a SHARED one, the jobs of everyone on it count against it too, or a member could start a
   * job the size of the whole remaining month while another did the same. At most MEMBER_JOBS so one plan cannot turn one meter
   * read into an unbounded fan-out; beyond that many people, a member's job is held only by the clamp when it starts.
   */
  private async jobsOf(payerId: string): Promise<Array<{ spentPaise: number; updatedAt: number }>> {
    const jobs = this.o.jobs;
    if (!jobs) return [];
    const own = await jobs.listJobs(payerId, JOBS_READ).catch(() => []);
    if (!planShareOn(payerId)) return own;
    const members = (await membersOn(payerId)).slice(0, MEMBER_JOBS);
    if (!members.length) return own;
    const theirs = await Promise.all(members.map((m) => jobs.listJobs(m.memberId, JOBS_READ).catch(() => [])));
    return [...own, ...theirs.flat()];
  }

  /** Who this person's spend is metered against: themselves, or whoever shares a plan with them (billing/planShare.ts). */
  async payer(userId: string): Promise<Payer> { return this.payerOf(userId); }

  /**
   * The meter, now: how much of this month is used, and when it starts again. Fresh when the screens ask.
   *
   * On someone else's plan it is the OWNER'S month, on the owner's own clock: one pot cannot turn over at two different moments,
   * so the month's boundary follows the person whose month it is. Their own month is on their own clock, exactly as before.
   */
  async usage(userId: string, o: { tz?: number; fresh?: boolean } = {}): Promise<UsageNow> {
    const r = await this.read(userId, o.fresh);
    const tz = r.payer.sharedFrom ? this.tzOf(r.payer.userId) : o.tz ?? this.tzOf(userId);
    return usageNow({ events: r.events, now: this.now(), tzOffsetMinutes: tz, anchor: r.anchor, plan: r.plan, nearAt: getConfig().USAGE_NEAR });
  }

  /**
   * What ONE person on a shared plan has used of this month, as a fraction of it: the row "Used 12% this month".
   *
   * Read off the owner's own rows, where every member's spend is written with `by` naming them (you/store.ts). Never an amount:
   * a share of the month is the only thing any screen is given.
   */
  async shareOfMonth(ownerId: string, memberId: string): Promise<number> {
    try {
      const r = await this.read(ownerId);
      if (!(r.plan.monthPaise > 0)) return 0;
      const cycle = cycleOf(this.now(), this.tzOf(ownerId), r.anchor);
      const rows = await this.o.store.spendSince(ownerId, cycle.startsAt).catch(() => []);
      const mine = memberId === ownerId ? (x: { by?: string }) => !x.by || x.by === ownerId : (x: { by?: string }) => x.by === memberId;
      let paise = 0;
      for (const x of rows) if (x.paise > 0 && x.at >= cycle.startsAt && x.at < cycle.endsAt && mine(x)) paise += x.paise;
      return Math.min(1, paise / r.plan.monthPaise);
    } catch { return 0; }
  }

  /**
   * IS THIS PERSON BURNING THROUGH THEIR MONTH FASTER THAN ANY REAL PERSON DOES?
   *
   * The month is one allowance now, spent on whatever days the person likes, so nothing on the calendar stops a loop with a bug from
   * eating all of it in an afternoon. This is what stops it: a ceiling on what one person may spend in the hour just gone, worked out
   * from their own plan's month (usage.ts `burnCapPaise`, USAGE_BURN_TIMES), so it rises with the plan and nobody has to keep a number
   * in step with the prices. At the default it is about ten times a heavy real hour, so a person working flat out never meets it.
   *
   * It is not a plan rule and the person is never told about it; what they are told when they meet it is BUSY, above. The spend events
   * are the ones the meter already holds in memory (`read`, grown by `record`), so this costs nothing extra to ask.
   */
  async burning(userId: string): Promise<boolean> {
    const c = getConfig();
    if (!c.USAGE_LIMITS || !(c.USAGE_BURN_TIMES > 0)) return false;
    try {
      const r = await this.read(userId);
      const cap = burnCapPaise(r.plan.monthPaise, c.USAGE_BURN_TIMES);
      return cap > 0 && spentSince(r.events, this.now() - BURN_WINDOW_MS) >= cap;
    } catch { return false; }
  }

  /** What may still be used this month, ours, in paise; null when the limits are off (or the meter could not be read). */
  async leftToSpend(userId: string): Promise<number | null> {
    if (!getConfig().USAGE_LIMITS) return null;
    try { return (await this.usage(userId)).leftPaise; } catch { return null; }
  }

  /** The refusal when the month is used up, else null. Never throws. */
  async refusal(userId: string): Promise<UsageRefusal | null> {
    if (!getConfig().USAGE_LIMITS) return null;
    try {
      const u = await this.usage(userId);
      return u.state === "out" ? refusalOf(u, this.now(), this.tzOf(userId)) : null;
    } catch { return null; }
  }

  /**
   * One answer's cost, written down, ON THE PAYER'S MONTH. Never throws: a lost row is a gap in a chart, not a failed answer.
   *
   * The other half of the one chokepoint (`read` is the first): every cost this class ever writes goes through here, so a member's
   * spend lands on the owner's meter without a single caller knowing that shared plans exist. The row keeps who it was really for
   * (`by`), so the owner's screen can say "Rahul · Used 12% this month" without the member's own account being charged.
   *
   * It stays synchronous where it can: with PLAN_SHARE off the payer is known without a round trip (`payerNow`), and with it on the
   * gate that ran moments ago has warmed the answer. Only an unwarmed cache defers the write by a tick.
   */
  record(userId: string, bot: string, paise: number): void {
    if (!(paise > 0) || !userId) return;
    const at = this.now();
    const known = payerNow(userId);
    if (known) this.recordOn(known.userId, userId, bot, paise, at);
    else void payerFor(userId).then((p) => this.recordOn(p.userId, userId, bot, paise, at)).catch(() => this.recordOn(userId, userId, bot, paise, at));
  }

  /** `payerId` is whose month it comes off; `userId` is whose use it was. The same account unless a plan is shared. */
  private recordOn(payerId: string, userId: string, bot: string, paise: number, at: number): void {
    const hit = this.cache.get(payerId);
    if (hit) {
      hit.report.monthPaise += paise;
      hit.report.leftPaise = Math.max(0, hit.report.limitPaise - hit.report.monthPaise);
    }
    this.meters.get(payerId)?.events.push({ at, paise });
    void this.o.store.addSpend(payerId, bot, paise, at, userId).catch(() => undefined);
  }

  /**
   * What a use really cost, in US dollars, written down as paise at CODE_USD_INR (the rate the plans' dollars are turned at). A cheap use is a
   * fraction of a paise: the exact amounts are kept per person and only the whole paise they come to are written (SpendMeter, rounded up once,
   * never low and never more than one paise high), so a thousand dictations at a third of a paise each are not a thousand paise.
   */
  recordUsd(userId: string, bot: string, usd: number): void {
    if (!(usd > 0) || !userId) return;
    const paise = this.carry.charge(userId, usd * getConfig().CODE_USD_INR * 100);
    if (paise > 0) this.record(userId, bot, paise);
  }

  /**
   * Refuses a bot's answer once the month is used up, and holds back one that is being spent far too fast.
   *
   * The month's own refusal is asked first: when a runaway really has spent the lot, "you've reached this month's limit" is the true
   * and useful thing to say, and the brake's "busy" would hide it.
   */
  async gate(userId: string): Promise<void> {
    const r = await this.refusal(userId);
    if (r) throw new BotError("quota_exceeded", r.message, 429, { reason: r.reason, resetsAt: r.resetsAt, upgrade: r.upgrade });
    if (await this.burning(userId)) throw new BotError("overloaded", BUSY, 429, { reason: BUSY_REASON, retryAfterSec: BUSY_RETRY_SEC });
  }

  /**
   * THE SAME TWO ANSWERS, FOR THE GATE Keylessbord, Ask, notes and the front door ask (metering.setUsageGate, enforceQuota).
   *
   * That gate used to answer with a SENTENCE, and every caller turned a sentence into `quota_exceeded`. The burn brake could
   * therefore never be asked on that path: its words sent down it would have worn the quota code, and the person would have been
   * sent to a Usage screen showing a meter nowhere near full, with a plan to buy for a runaway that was ours. So the gate answers
   * a whole 429 body now (a string still works, and still means `quota_exceeded`), and the brake can finally guard the front door,
   * dictation and the rewrites as it already guards the bots platform and Xode's jobs.
   *
   * The month's own refusal is asked first and keeps its own words: when a runaway really has spent the lot, "you've reached this
   * month's limit" is the true and useful thing to say, and the brake's "busy" would hide it. Never throws.
   */
  async quota(userId: string): Promise<Quota | null> {
    const r = await this.refusal(userId);
    if (r) return r;
    return (await this.burning(userId)) ? { ...busyBody } : null;
  }
}

const WRAPPED = Symbol.for("tailzu.you.limits");

/**
 * The bots platform's three ways in, held to the meter and written down. Once per instance. `voiceKit` is NOT wrapped: it hands a
 * call its bot's own voice and tools and spends nothing of its own, and a call is never held to the meter anyway.
 */
export function wrapBots(bots: Bots, spending: Spending): void {
  const b = bots as Bots & { [WRAPPED]?: true };
  if (b[WRAPPED]) return;
  b[WRAPPED] = true;
  const ask = bots.ask.bind(bots), test = bots.test.bind(bots), withKey = bots.askWithKey.bind(bots), ownerOfKey = bots.ownerOfKey.bind(bots);
  bots.ask = async (userId, ref, input) => {
    // A turn of a call X0 made, where the live call is switched on for the person (the route sets the flag), is never held to their
    // spend gate and never recorded on it: such a call is not refused, shortened or stopped for money (the owner's answer). What it
    // cost is on the call's own row instead (plan_calls.cost_usd). Without the flag the turn is gated and recorded like any other.
    if (input.call) return ask(userId, ref, input);
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
 * the more a "Keep going" adds, to what is LEFT OF THE MONTH, or answers the refusal (429) when nothing is. A job is the biggest single
 * spender there is, so the burn brake is asked here too, in its own words (BUSY, above): a job started by a loop is the runaway this is for.
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
    if (await spending.burning(user.id)) {
      reply.header("retry-after", String(BUSY_RETRY_SEC));
      return reply.code(429).send(busyBody);
    }
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

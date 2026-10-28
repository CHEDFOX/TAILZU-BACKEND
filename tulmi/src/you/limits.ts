/**
 * THE MONTHLY LIMIT, KEPT: what the month has cost so far (spend.ts over the real records), and the two places the bots spend, held to it when the
 * person turned on "Stop bots at the limit".
 *
 *   A Code bot job     POST /v1/code/jobs: its budget is held to what is left of the month. A job that reaches it pauses and asks for more, the way
 *                      it does when its own budget runs out ("Continue with ₹X more?"): a yes is the person's own, and goes past the limit on
 *                      purpose. With nothing left the job is not started, and the answer says why.
 *   A bot's answer     Bots.ask / test / askWithKey (the bots platform's three ways in): refused once the month is used up, with a sentence. What
 *                      each answer cost is written to you_spend when it comes back, so the month counts every bot, not only the Code bot.
 *
 * Both are plugged in from outside (install()), on the services the server already made: a request hook for the job route, and a wrapper around
 * the Bots instance's three methods. Neither changes what those do while the switch is off, and a failure to read the month never stops a bot:
 * the limit is the person's guard rail, not a reason for an outage.
 *
 * The month's totals are kept for a short while per person (and grown by every answer recorded), so a busy bot does not read the records on
 * every turn.
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { BotError, type Bots } from "../bots/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import { spendReport, type SpendReport } from "./spend.js";
import type { YouStore } from "./store.js";
import type { YouSettings } from "./settings.js";

/** India first: the month turns at midnight IST until the person's own offset is known (the screens send it). */
export const DEFAULT_TZ = 330;
const CACHE_MS = 30_000;
const JOBS_READ = 200;

export const rupeesOf = (paise: number): string => {
  const r = Math.round(paise) / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString("en-IN") : r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export class Spending {
  private readonly cache = new Map<string, { at: number; report: SpendReport; settings: YouSettings }>();
  private readonly tz = new Map<string, number>();
  readonly now: () => number;

  constructor(private readonly o: { store: YouStore; jobs: JobRouter | null; now?: () => number }) {
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

  /** The month as it stands, from the records (fresh: the screens ask for it). */
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

  forget(userId: string): void { this.cache.delete(userId); }

  /** What may still be spent this month when the person stops at the limit; null when they don't (or the month could not be read). */
  async leftToSpend(userId: string): Promise<number | null> {
    try {
      const { report, settings } = await this.month(userId);
      return settings.stopAtLimit ? Math.max(0, settings.monthLimitPaise - report.monthPaise) : null;
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
    void this.o.store.addSpend(userId, bot, paise, at).catch(() => undefined);
  }

  /** Refuses a bot's answer once the month is used up, when the person said so. */
  async gate(userId: string): Promise<void> {
    const left = await this.leftToSpend(userId);
    if (left !== null && left <= 0) {
      const { settings } = await this.month(userId);
      throw new BotError("month_limit", `Your bots have used this month's ${rupeesOf(settings.monthLimitPaise)}. Raise the limit in Budget, or turn off Stop bots at the limit.`, 429);
    }
  }
}

const WRAPPED = Symbol.for("tailzu.you.limits");

/** The bots platform's three ways in, held to the month and written down. Once per instance. */
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

/**
 * The job route, held to the month: a request hook (it runs before the route's own handler) that lowers the budget a new job asks for to what is
 * left, or answers 429 month_limit when nothing is.
 */
export function holdJobsToMonth(app: FastifyInstance, spending: Spending, jobs: JobRouter): void {
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "POST" || req.url.split("?")[0] !== "/v1/code/jobs") return;
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return; // the route answers 401 itself
    const left = await spending.leftToSpend(user.id);
    if (left === null) return;
    const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    if (left <= 0) {
      const { settings } = await spending.month(user.id);
      return reply.code(429).send({
        code: "month_limit",
        message: `Your bots have used this month's ${rupeesOf(settings.monthLimitPaise)}. Raise the limit in Budget, or turn off Stop bots at the limit.`,
      });
    }
    const asked = typeof body.budgetPaise === "number" ? body.budgetPaise : jobs.defaultBudget();
    if (asked > left) req.body = { ...body, budgetPaise: Math.floor(left) };
  });
}

/**
 * THE ONLY PLACE A BOT AND ITS HEALTH DAYS MEET (docs: perms §4.5, §4.6).
 *
 *   sync(userId, slug, body, { enable })   the phone's POST: the switch on (first call only) and the days, together
 *   moves(userId, botId)                   the counts for that bot's Moves line, and nothing finer than a day
 *   exportOf(userId)                       the days in Download my data
 *   dropFor(userId, botId)                 every day of one bot: the switch going off, in the same request
 *
 * WHY THIS FILE EXISTS AT ALL. `bots/service.ts` runs models (`runBot`) and `routes/bots/bots.ts` hosts `POST .../ask`, which
 * sends a turn to an AI service. While either of them could read `bots/healthDays.ts`, "health never reaches a model" rested
 * on nobody editing those two files carelessly. Now neither imports the store, and `tests/health-never.test.ts` names them on
 * its NEVER list, so the rule is held up by the import graph again.
 *
 * What this file asks of `Bots` is deliberately health-free: find my bot, write the one switch, list the bots that have it on.
 * Nothing here is reachable from a prompt, a tool, memory or a push builder.
 */
import { isFitnessBot } from "./door.js";
import { healthDays, movesOf, readHealthDays, type HealthDay, type Moves } from "./healthDays.js";
import { BotError } from "./types.js";

/** One of the person's own bots, as this file needs it: no skills but the switch, and no days. */
export interface HealthBotRef { id: string; slug: string; name: string; purpose: string; healthOn: boolean }

/** What `Bots` lends the health flow. Every one of these is plain bot work; none of them touches a number. */
export interface HealthBots {
  /** The person's own bot by slug or id. Throws the platform's own 404 / 403, as every owner-only path does. */
  forHealth(userId: string, ref: string): Promise<HealthBotRef>;
  /** Writes `skills.health` and nothing else: no parse, no check, no merge of any other field. */
  setHealthSkill(userId: string, ref: string, on: boolean): Promise<boolean>;
  /** The person's own bots whose switch is on, for the export. */
  botsCounting(userId: string): Promise<Array<{ id: string; slug: string }>>;
  /** The two hooks this file fills in, so `bots/service.ts` can switch health off without ever reaching the days. */
  useHealth(o: { off: (userId: string, botId: string) => Promise<void>; exportOf: (userId: string) => Promise<unknown[]> }): void;
}

export class BotHealth {
  constructor(private readonly bots: HealthBots, private readonly now: () => number = Date.now) {}

  /**
   * THE ONLY WAY `skills.health` IS EVER TURNED ON, and the only way a day is ever stored.
   *
   * The phone reads the person's daily steps and workouts from Apple Health or Health Connect, sums them in its own time
   * zone, and posts them here. Nothing finer than a day arrives, and nothing but steps and `{kind, minutes}`.
   *
   *   `enable: true`   the first call, right after the person answered their phone's own prompt. The switch goes on AND the
   *                    days are stored together, so a refused prompt never leaves the switch on with no data.
   *   no `enable`      a later visit. The switch must already be on; a call for a bot whose switch is off is refused.
   *
   * Only the owner's own signed-in session gets here (the route turns a bot API key away), only a bot they made, and only
   * one whose name or purpose says it is about fitness.
   */
  async sync(userId: string, ref: string, body: unknown, o: { enable?: boolean } = {}): Promise<{ on: true; kept: number }> {
    const bot = await this.bots.forHealth(userId, ref);
    const enable = o.enable === true;
    if (!enable && !bot.healthOn) throw new BotError("health_off", "Turn this on from the switch in the app.", 409);
    if (enable && !isFitnessBot(bot.name, bot.purpose)) {
      throw new BotError("not_fitness", "This bot isn't about fitness, so it can't count workouts.", 403);
    }
    let days: HealthDay[];
    try { days = readHealthDays(body, this.now()); } catch (err) { throw new BotError("bad_request", (err as Error).message, 400); }
    if (enable && !bot.healthOn) {
      // Both, or neither: the days first, then the switch, and the days are dropped again if the switch cannot be set.
      await healthDays().put(userId, bot.id, days);
      if (!(await this.bots.setHealthSkill(userId, ref, true))) {
        await healthDays().dropBot(userId, bot.id);
        throw new BotError("not_found", "There is no such bot.", 404);
      }
    } else {
      await healthDays().put(userId, bot.id, days);
    }
    return { on: true, kept: days.length };
  }

  /** The counts for one bot's Moves line: how many workouts, the last one, the steps. Never a raw day. */
  async moves(userId: string, botId: string): Promise<Moves> {
    return movesOf(await healthDays().list(userId, botId));
  }

  /** Every day of one bot, for Download my data: the person's own, so they are in their download. */
  async exportOf(userId: string): Promise<Array<{ bot: string; days: HealthDay[] }>> {
    const out: Array<{ bot: string; days: HealthDay[] }> = [];
    for (const b of await this.bots.botsCounting(userId)) {
      const days = await healthDays().list(userId, b.id);
      if (days.length) out.push({ bot: b.slug, days });
    }
    return out;
  }

  /** Every day of one bot goes: the switch going off, in the same request. The row's own words promise this. */
  async dropFor(userId: string, botId: string): Promise<void> {
    await healthDays().dropBot(userId, botId);
  }
}

/**
 * Makes the health service for one `Bots` and hands it the two hooks, so a switch going off takes the days with it however
 * it was turned off (the row's PUT, a PATCH, link/unlink) and the export carries them. Called once, where `Bots` is made.
 */
export function attachHealth(bots: HealthBots, now?: () => number): BotHealth {
  const health = new BotHealth(bots, now);
  bots.useHealth({
    off: (userId, botId) => health.dropFor(userId, botId),
    exportOf: (userId) => health.exportOf(userId),
  });
  return health;
}

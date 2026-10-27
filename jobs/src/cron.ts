/**
 * THE TICKER, EVERY MINUTE: WHAT THE VPS'S TIMER USED TO DO, AND ONE THING MORE.
 *
 *   router tick       leases that ran out are taken back and their step placed again (a PC that went quiet, a run that never
 *                     reported); a job that lost its lease five times is failed; the steps out on GitHub's computers are
 *                     looked at (a run that never appeared, or ran far past its time, marks GitHub used up for the month and
 *                     the step moves: "runner timeouts"); jobs waiting for a place are looked at again
 *   agent tick        claims that ran out are handed back (the epoch goes up, which fences the old holder for good)
 *   rescue            an agent job that nobody is driving and that has not changed for five minutes is given a nudge: its
 *                     Workflow is woken, made if it was never made (the VPS's start never arrived), or run again if it ended.
 *                     This is what makes a lost /v1/event harmless
 *
 * Cron Triggers run on UTC time and take a minute or more to propagate after a deploy
 * (developers.cloudflare.com/workers/configuration/cron-triggers/). A pass that fails is logged and the next one tries again;
 * nothing here is in anyone's way.
 */
import type { Env } from "./env.js";
import { rescueAgentJob } from "./workflows.js";
import { getWorld, type TickSummary } from "./world.js";

/** A job nobody has touched for this long, and that nobody drives, is nudged. */
export const RESCUE_IDLE_MS = 5 * 60_000;
/** Nudged at most this many in one pass. */
export const RESCUE_PER_TICK = 10;

export interface CronReport {
  tick: TickSummary | null;
  rescued: Array<{ jobId: string; how: string }>;
  errors: string[];
}

export async function runCron(env: Env, o: { idleMs?: number; limit?: number } = {}): Promise<CronReport> {
  const report: CronReport = { tick: null, rescued: [], errors: [] };
  const world = await getWorld(env);
  try {
    report.tick = await world.ticker.tick();
  } catch (err) {
    report.errors.push(`tick: ${(err as Error)?.name ?? "error"}`);
  }
  try {
    for (const jobId of await world.ticker.idle(o.idleMs ?? RESCUE_IDLE_MS, o.limit ?? RESCUE_PER_TICK)) {
      try {
        const how = await rescueAgentJob(env, jobId);
        if (how !== "alive") report.rescued.push({ jobId, how });
      } catch (err) {
        report.errors.push(`rescue: ${(err as Error)?.name ?? "error"}`);
      }
    }
  } catch (err) {
    report.errors.push(`idle: ${(err as Error)?.name ?? "error"}`);
  }
  if (report.errors.length) console.warn("jobs worker: the ticker had trouble", JSON.stringify({ errors: report.errors }));
  return report;
}

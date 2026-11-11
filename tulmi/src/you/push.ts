/**
 * WHAT PINGS THE PERSON, AS THEY SAID ON "WHAT PINGS YOU": the push engine asks verdict() before it claims any push (push/engine.ts setPushGate),
 * and the daily summary is sent from here, at the hour they chose.
 *
 *   needs you    a bot is waiting on their answer or their yes: always sent; in quiet hours without a sound
 *   done         a job finished, stopped or moved: "ping" as before, "quiet" without a sound; in quiet hours not sent (it waits in Activity);
 *                not sent for a bot they turned off
 *   the rest     the engine's own reminders (Keylessbord's streak, the week): not sent in quiet hours, nor with Keylessbord turned off
 *   summary      one note a day at their hour, only when they turned it on and something happened that day
 *   reminders    what they asked to be reminded of (their calendar, a to-do): sent; in quiet hours without a sound; not with Plan Ease off.
 *                Plan Ease's own kinds (botsBots/planKinds.ts: plan_event, plan_todo, the day notes...) are told apart there, each
 *                with its group: Plan Ease's (as the reminders), a person's word (as people), or never a sound (the morning note)
 *   routines     a routine they set up ran, or paused itself: sent (they asked for it at that time); in quiet hours without a sound
 *   people       someone in a space gave them a task, planned something for them, messaged them, asked to join or let them in: sent;
 *                in quiet hours without a sound. A person's word, not a bot's: no bot being off stops it (a muted chat sends none:
 *                botsBots/threads.ts)
 *
 * A person who never opened the screen has the defaults (settings.ts), which are what the pushes did before it: nothing changes for them.
 */
import type { JobRouter } from "../code/jobs/router.js";
import type { Connectors } from "../connectors/index.js";
import type { PushVerdict } from "../push/engine.js";
import { pushEngine } from "../push/index.js";
import { clock, inQuietHours, type YouSettings } from "./settings.js";
import { planVerdictGroup } from "../botsBots/planKinds.js";
import type { Spending } from "./limits.js";

const NEEDS_YOU = new Set(["approval", "code_needs_you", "code_compute_ask", "code_commit_ask"]);
const DONE = new Set(["code_job_done", "code_job_failed", "code_job_moved", "code_compute_paused", "code_minutes_low"]);
/** From people in a space (push/defaults.ts): quiet hours apply, Keylessbord being off does not. */
const PEOPLE = new Set(["space_task", "space_plan", "space_message", "space_joined", "space_request", "space_accepted", "space_feed"]);

/** The person's minute of the day, in their own time. */
const minuteOf = (now: number, tzOffsetMinutes: number): number => {
  const d = new Date(now + tzOffsetMinutes * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** Pure: what to do with one push of `kind` at this minute of the person's day. */
export function verdict(s: YouSettings, kind: string, minute: number): PushVerdict {
  const n = s.notify;
  const quiet = inQuietHours(n, minute);
  if (NEEDS_YOU.has(kind)) return quiet ? "silent" : "send";
  if (kind === "bots_summary") return !n.summary ? "drop" : quiet ? "silent" : "send";
  if (kind === "plan_reminder") return n.botsOff.includes("plan") ? "drop" : quiet ? "silent" : "send";
  // A call (botsBots/planCall.ts): only with Calls on, Plan Ease on, and never in quiet hours (then the push goes, without a sound).
  if (kind === "plan_call") return n.calls && !n.botsOff.includes("plan") && !quiet ? "send" : "drop";
  if (kind === "plan_call_missed") return "send";
  // Every kind of Plan Ease's, from its one list (planKinds.ts), so a new one is never left to the Keylessbord branch below.
  const plan = planVerdictGroup(kind);
  if (plan === "plan") return n.botsOff.includes("plan") ? "drop" : quiet ? "silent" : "send";
  if (plan === "silent") return n.botsOff.includes("plan") ? "drop" : "silent";
  if (plan === "people") return quiet ? "silent" : "send";
  // A person's word that never makes a sound (who took a family ask, the one nudge): sent, whatever Plan Ease's switch says.
  if (plan === "quiet") return "silent";
  if (PEOPLE.has(kind)) return quiet ? "silent" : "send";
  if (kind === "routine_done" || kind === "routine_failed") return quiet ? "silent" : "send";
  if (kind === "ops_alert") return "send";
  if (DONE.has(kind)) {
    if (quiet || n.botsOff.includes("code")) return "drop";
    return n.done === "quiet" ? "silent" : "send";
  }
  // The engine's own reminders are Keylessbord's (streak, refill, the week).
  if (quiet || n.botsOff.includes("keybot")) return "drop";
  return "send";
}

/** The gate the push engine asks, over the stored settings. */
export function pushGate(spending: Spending) {
  return async (p: { userId: string; kind: string; tzOffsetMin: number | null; now: number }): Promise<PushVerdict> => {
    const s = await spending.store.getSettings(p.userId);
    const tz = p.tzOffsetMin ?? spending.tzOf(p.userId);
    return verdict(s, p.kind, minuteOf(p.now, tz));
  };
}

/** "5 things done, 1 needs you." The day in a line, or null when nothing happened. What the day cost is ours: never in the line. */
export function summaryLine(d: { done: number; needs: number; spentPaise?: number }): string | null {
  const parts: string[] = [];
  if (d.done) parts.push(`${d.done} ${d.done === 1 ? "thing" : "things"} done`);
  if (d.needs) parts.push(`${d.needs} ${d.needs === 1 ? "needs" : "need"} you`);
  return parts.length ? `${parts.join(", ")}.` : null;
}

/** What one person's day was, from the records. */
export async function dayOf(userId: string, o: { spending: Spending; jobs: JobRouter | null; connectors: Connectors | null; now: number; tz: number }): Promise<{ done: number; needs: number; spentPaise: number }> {
  const local = new Date(o.now + o.tz * 60_000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - o.tz * 60_000;
  const [jobs, tasks, month] = await Promise.all([
    o.jobs ? o.jobs.listJobs(userId, 50).catch(() => []) : Promise.resolve([]),
    o.connectors ? o.connectors.tasks.list(userId, 20).catch(() => []) : Promise.resolve([]),
    o.spending.report(userId, o.tz).then((r) => r.report).catch(() => null),
  ]);
  const done = jobs.filter((j) => j.state === "done" && j.updatedAt >= start).length + tasks.filter((t) => t.state === "done" && t.updatedAt >= start).length;
  const needs = jobs.filter((j) => j.state === "waiting_for_you").length + tasks.filter((t) => t.state === "waiting").length;
  const spentPaise = month ? month.byDay[month.today - 1] ?? 0 : 0;
  return { done, needs, spentPaise };
}

/**
 * Whether today's summary rides in Plan Ease's evening note instead (botsBots/planEase.ts rides): then it isn't sent on its own. Set by
 * routes/bots/botsBots.ts; unset, every summary goes as before.
 */
let summaryRide: ((userId: string, day: string) => Promise<boolean>) | null = null;
export function setSummaryRide(fn: ((userId: string, day: string) => Promise<boolean>) | null): void { summaryRide = fn; }

const TICK_MS = 5 * 60_000;
/** A summary is sent in the half hour after the chosen minute; the engine's claim makes it once a day. */
const WINDOW_MIN = 30;

/** Every five minutes: the people whose summary hour has come. Returns the stop. */
export function startSummaries(o: { spending: Spending; jobs: JobRouter | null; connectors: Connectors | null; log?: { warn: (o: object, m: string) => void } }): () => void {
  let busy = false;
  const tick = async () => {
    const engine = pushEngine();
    if (!engine || busy) return;
    busy = true;
    try {
      const now = o.spending.now();
      for (const p of await o.spending.store.summaryPeople(2000)) {
        const tz = o.spending.tzOf(p.userId);
        const minute = minuteOf(now, tz);
        const since = (minute - p.settings.notify.summaryAt + 1440) % 1440;
        if (since >= WINDOW_MIN) continue;
        const local = new Date(now + tz * 60_000).toISOString().slice(0, 10);
        // One evening push, not two: Plan Ease's evening note carries the line tonight.
        if (summaryRide && await summaryRide(p.userId, local).catch(() => false)) continue;
        const line = summaryLine(await dayOf(p.userId, { ...o, now, tz }));
        if (!line) continue;
        await engine.notify(p.userId, { kind: "bots_summary", key: local, vars: { time: clock(p.settings.notify.summaryAt), line } }, now).catch(() => null);
      }
    } catch (err) {
      o.log?.warn({ err: (err as Error)?.message }, "you: summaries");
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

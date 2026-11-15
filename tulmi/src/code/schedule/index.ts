/**
 * SCHEDULED CODE WORK: A PROJECT'S OWN STANDING JOB, STARTED BY THE CLOCK INSTEAD OF BY A PERSON ASKING (docs/code-schedule.md).
 *
 * "Every Monday, update the dependencies, run the tests, and open a pull request if they pass." Nobody has to be there. It is the
 * thing a bot that lives on a server can do and a bot that lives in a terminal cannot: the job outlives the person's attention.
 *
 * WHY IT IS NOT A ROUTINE. A routine (`src/routines/`, migration 0062) runs a BOT'S TURN: one ask, one answer, a few paise, and
 * the row says in so many words that Xode is not one of them, because "its work is a job". A job is longer, spends real money,
 * runs commands on a computer and ends in a pull request. So this is routines' sibling, not a case of it: its own table with its
 * own budget a run, and the whole of the agent's guards underneath, unchanged.
 *
 * WHAT IS REUSED, AND WHAT IS NOT. The schedule itself is routines' (`routines/words.ts`: `Schedule`, `nextRun`, `scheduleWords`),
 * because the maths of "every Monday at 9 in the person's own time" is the same maths and was already right. Nothing else is: a
 * run here makes a job through the ordinary door (`POST /v1/code/jobs`'s own code path), so the policy, the budget, the staged
 * changeset, the checks before the commit, the review and the pull request are exactly a person's job's.
 *
 * WHAT ONE RUN DOES
 *   1. the project is still there and still the person's, or the schedule pauses itself with the reason;
 *   2. a run already working is not started again: one job at a time a schedule, so a weekly job that takes two days cannot pile up;
 *   3. a run more than LATE_MS late (the server was down) is SKIPPED, not run hours after it meant anything, and the next is from now;
 *      (the run is TAKEN first, in one write that holds only while its time is still what the tick read, so two servers cannot both start it);
 *   4. the job is started with this schedule's own budget, and the schedule remembers which job it was;
 *   5. three runs in a row that could not start pause it, with why. The person is pushed only when the job itself needs them, by the
 *      job's own road: a schedule is not a second voice for the same work.
 *
 * It never pushes a commit of its own and has no powers a person's job lacks. `CODE_SCHEDULES=false` turns the whole thing off:
 * the routes answer 404 and the tick does nothing.
 */
import { LATE_MS } from "../../routines/service.js";
import { cleanSchedule, nextRun, scheduleWords, TASK_MAX, type Schedule } from "../../routines/words.js";
import type { CodeSchedule, CodeScheduleStore, RunStatus } from "./store.js";

export { codeScheduleStore, resetCodeScheduleStoreForTests, MemoryCodeScheduleStore, SupabaseCodeScheduleStore, type CodeSchedule, type CodeScheduleStore } from "./store.js";

/** The most standing pieces of work one person may keep. */
export const SCHEDULES_MAX = 20;
/** Runs that could not start, in a row, before it pauses itself. */
export const FAILS_TO_PAUSE = 3;
/** The most a tick starts at once, so one pass cannot flood the router. */
export const DUE_PER_TICK = 5;
/** What one run may spend when nothing is said, in paise. */
export const DEFAULT_BUDGET_PAISE = 3_000;
/** The least and the most a run may be given. */
export const BUDGET_MIN_PAISE = 100;
export const BUDGET_MAX_PAISE = 100_000;

/** How often the clock is looked at: a schedule's time is a minute, so a minute is often enough. */
export const TICK_MS = 60_000;

/**
 * The clock, every minute, once the server is ready. A pass that fails is logged and the next one tries again; a pass never starts
 * while the one before it is still going, and the timer never keeps the process alive. Returns the stop.
 */
export function startCodeSchedules(s: CodeSchedules, log?: { warn: (o: object, m: string) => void }): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await s.tick(); } catch (err) { log?.warn({ err: (err as Error)?.message }, "code schedules: tick"); } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export class ScheduleError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ScheduleError";
  }
}

/** What the service needs of the rest: the projects it may use, and the door a job is made through. */
export interface ScheduleDeps {
  store: CodeScheduleStore;
  /** The project, when it is this person's and still there; null otherwise. */
  project(userId: string, projectId: string): Promise<{ id: string; fullName: string; defaultBranch: string } | null>;
  /** Makes a job exactly as `POST /v1/code/jobs` does. Throws what that throws. */
  startJob(o: { userId: string; projectId: string; task: string; budgetPaise: number }): Promise<{ id: string }>;
  /** Whether a job of this schedule's is still working: one at a time. */
  jobRunning(jobId: string, userId: string): Promise<boolean>;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** A schedule as a person reads it. */
export interface ScheduleView {
  id: string;
  projectId: string;
  task: string;
  /** The schedule in words: "every Monday at 9:00 am". */
  when: string;
  status: CodeSchedule["status"];
  pausedWhy: string;
  budgetPaise: number;
  nextAt: number | null;
  lastAt: number | null;
  lastJobId: string | null;
  lastStatus: RunStatus | null;
  lastText: string;
  runs: number;
}

export const viewOf = (s: CodeSchedule): ScheduleView => ({
  id: s.id, projectId: s.projectId, task: s.task, when: scheduleWords(s.schedule), status: s.status, pausedWhy: s.pausedWhy,
  budgetPaise: s.budgetPaise, nextAt: s.nextAt, lastAt: s.lastAt, lastJobId: s.lastJobId, lastStatus: s.lastStatus,
  lastText: s.lastText, runs: s.runs,
});

const budgetOf = (v: unknown): number => {
  if (v === undefined || v === null) return DEFAULT_BUDGET_PAISE;
  const n = Number(v);
  if (!Number.isInteger(n) || n < BUDGET_MIN_PAISE || n > BUDGET_MAX_PAISE) {
    throw new ScheduleError("bad_budget", `A run's budget is between ${BUDGET_MIN_PAISE} and ${BUDGET_MAX_PAISE} paise.`);
  }
  return n;
};

const taskOf = (v: unknown): string => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 8) throw new ScheduleError("bad_task", "Say what to do each time, in a sentence.");
  return t.slice(0, TASK_MAX);
};

export class CodeSchedules {
  private readonly now: () => number;

  constructor(private readonly d: ScheduleDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Kept, on, with its first run worked out. */
  async create(userId: string, o: { projectId: string; task: unknown; schedule: unknown; tz?: unknown; budgetPaise?: unknown }): Promise<ScheduleView> {
    const schedule = cleanSchedule(o.schedule);
    if (!schedule) throw new ScheduleError("bad_schedule", "That schedule could not be read.");
    const project = await this.d.project(userId, o.projectId);
    if (!project) throw new ScheduleError("not_found", "That project is not one of yours.", 404);
    const mine = await this.d.store.list(userId);
    if (mine.length >= SCHEDULES_MAX) throw new ScheduleError("too_many", `You already have ${SCHEDULES_MAX} standing jobs, which is as many as one account keeps.`);
    const tz = Number.isInteger(o.tz) ? Math.max(-840, Math.min(840, Number(o.tz))) : 0;
    const now = this.now();
    const row = await this.d.store.create({
      userId, projectId: project.id, task: taskOf(o.task), schedule, tz, budgetPaise: budgetOf(o.budgetPaise), nextAt: nextRun(schedule, tz, now),
    });
    return viewOf(row);
  }

  async list(userId: string): Promise<ScheduleView[]> {
    return (await this.d.store.list(userId)).map(viewOf);
  }

  /** One of the person's own, or a refusal: another person's is not found, never forbidden. */
  private async mine(userId: string, id: string): Promise<CodeSchedule> {
    const row = await this.d.store.byId(id);
    if (!row || row.userId !== userId) throw new ScheduleError("not_found", "There is no standing job of yours with that id.", 404);
    return row;
  }

  /** A new task, time or budget; paused, or resumed (its next run from now, and its failures forgotten). */
  async update(userId: string, id: string, patch: { task?: unknown; schedule?: unknown; budgetPaise?: unknown; status?: unknown }): Promise<ScheduleView> {
    const row = await this.mine(userId, id);
    const next: Parameters<CodeScheduleStore["update"]>[1] = {};
    if (patch.task !== undefined) next.task = taskOf(patch.task);
    if (patch.budgetPaise !== undefined) next.budgetPaise = budgetOf(patch.budgetPaise);
    let schedule: Schedule = row.schedule;
    if (patch.schedule !== undefined) {
      const read = cleanSchedule(patch.schedule);
      if (!read) throw new ScheduleError("bad_schedule", "That schedule could not be read.");
      schedule = read;
      next.schedule = read;
    }
    if (patch.status !== undefined) {
      if (patch.status !== "on" && patch.status !== "paused") throw new ScheduleError("bad_status", 'A standing job is "on" or "paused".');
      next.status = patch.status;
      // Resumed, or its time changed: the next run is worked out from now, and what failed before is forgotten.
      if (patch.status === "on") { next.pausedWhy = ""; next.fails = 0; }
      next.nextAt = patch.status === "on" ? nextRun(schedule, row.tz, this.now()) : null;
    } else if (patch.schedule !== undefined && row.status === "on") {
      next.nextAt = nextRun(schedule, row.tz, this.now());
    }
    const saved = await this.d.store.update(id, next);
    if (!saved) throw new ScheduleError("not_found", "There is no standing job of yours with that id.", 404);
    return viewOf(saved);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.mine(userId, id);
    await this.d.store.remove(id);
  }

  /** Once now, its schedule untouched: the "Run now" on the list. */
  async runNow(userId: string, id: string): Promise<ScheduleView> {
    const row = await this.mine(userId, id);
    return viewOf(await this.runOne(row, { onSchedule: false }));
  }

  /** Every schedule that is due, at most DUE_PER_TICK. Never throws: a pass that fails is logged and the next one tries again. */
  async tick(): Promise<{ started: number; skipped: number; failed: number }> {
    const out = { started: 0, skipped: 0, failed: 0 };
    let due: CodeSchedule[];
    try { due = await this.d.store.due(this.now(), DUE_PER_TICK); } catch (err) {
      this.d.log?.warn({ error: (err as Error)?.name }, "code schedules: what is due could not be read");
      return out;
    }
    for (const row of due) {
      try {
        const after = await this.runOne(row, { onSchedule: true });
        if (after.lastStatus === "started") out.started += 1;
        else if (after.lastStatus === "skipped") out.skipped += 1;
        else out.failed += 1;
      } catch (err) {
        out.failed += 1;
        this.d.log?.warn({ scheduleId: row.id, error: (err as Error)?.name }, "code schedules: a run could not be made");
      }
    }
    return out;
  }

  /**
   * One run. The schedule's own clock moves whatever happens, so a run that cannot be made never blocks the next one; only a run
   * that could not be STARTED counts as a failure.
   */
  private async runOne(row: CodeSchedule, o: { onSchedule: boolean }): Promise<CodeSchedule> {
    const now = this.now();
    const nextAt = row.status === "on" ? nextRun(row.schedule, row.tz, now) : row.nextAt;
    // TAKEN FIRST, so two servers ticking the same minute cannot both start it: the clock moves in one write that holds only while
    // next_at is still what this tick read. "Run now" is the person's own press and takes nothing.
    if (o.onSchedule) {
      if (row.nextAt === null) return row;
      const took = await this.d.store.claim(row.id, row.nextAt, nextAt ?? now).catch(() => false);
      if (!took) {
        this.d.log?.info({ scheduleId: row.id }, "code schedules: another pass had already taken this run");
        return row;
      }
    }
    const done = async (status: RunStatus, text: string, extra: Parameters<CodeScheduleStore["update"]>[1] = {}): Promise<CodeSchedule> => {
      const fails = status === "failed" ? row.fails + 1 : 0;
      const stop = fails >= FAILS_TO_PAUSE && o.onSchedule;
      const saved = await this.d.store.update(row.id, {
        lastAt: now, lastStatus: status, lastText: text.slice(0, 4000), fails,
        ...(status === "started" ? { runs: row.runs + 1 } : {}),
        ...(stop ? { status: "paused" as const, nextAt: null, pausedWhy: `Paused after ${FAILS_TO_PAUSE} runs in a row could not start. ${text}`.slice(0, 400) } : {}),
        ...extra,
      });
      return saved ?? { ...row, lastAt: now, lastStatus: status, lastText: text };
    };

    // The project has gone, or is not this person's any more: there is nothing for this to run on.
    const project = await this.d.project(row.userId, row.projectId).catch(() => null);
    if (!project) {
      const saved = await this.d.store.update(row.id, {
        status: "paused", nextAt: null, pausedWhy: "The project this ran on is gone.", lastAt: now, lastStatus: "failed", lastText: "The project is gone.",
      });
      return saved ?? row;
    }

    // Still working from last time: one job at a time, so slow work cannot pile up behind the clock.
    if (row.lastJobId && (await this.d.jobRunning(row.lastJobId, row.userId).catch(() => false))) {
      return done("skipped", "The job this started last time is still working, so this run was skipped.");
    }

    // Hours late (the server was down): not run long after it meant anything.
    if (o.onSchedule && row.nextAt !== null && now - row.nextAt > LATE_MS) {
      return done("skipped", "This run was missed by more than three hours, so it was skipped; the next one is as usual.");
    }

    try {
      const job = await this.d.startJob({ userId: row.userId, projectId: row.projectId, task: row.task, budgetPaise: row.budgetPaise });
      this.d.log?.info({ scheduleId: row.id, jobId: job.id }, "code schedules: a standing job was started");
      return done("started", "Started.", { lastJobId: job.id });
    } catch (err) {
      const why = err instanceof Error && err.message ? err.message.slice(0, 300) : "it could not be started";
      return done("failed", why);
    }
  }
}

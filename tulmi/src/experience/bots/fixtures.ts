/**
 * FAKES FOR THE BOTS APP: deps with the design's own sample day (Aanya, the cart rounding question, Xode
 * working), for tests and the render check (scripts/bots-render.ts). Nothing here is used by the server.
 *
 *   fakeDeps()                       the boards' day: Xode asks about rounding, 4 things done, a third of the month used
 *   fakeDeps({ jobs: [], tasks: [] }) a quiet day
 *   fakeDeps({ api: { "GET /v1/bots/plan/memory": { facts: [...] } } })  answers for a screen's own `load`
 *   ctxFor("bots.home", "phone", live)   a BotsCtx for a builder
 */
import type { BotsCtx, Client } from "./kit.js";
import { liveFrom, type BotLite, type BotsDeps, type BotsLive, type JobLite, type TaskLite } from "./live.js";

/** Tuesday 28 October 2026, 19:40 in India (UTC+5:30): "Good evening". */
export const FIXED_NOW = Date.UTC(2026, 9, 28, 14, 10);
export const IST = 330;
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const SAMPLE_BOTS: BotLite[] = [
  { slug: "code", name: "Xode", colour: "pine", purpose: "Reads your projects, answers questions about the code, and changes it through pull requests.", builtin: true },
  { slug: "keybot", name: "Keylessbord", colour: "ochre", purpose: "Writes, rewrites and replies in your own voice, in any language you mix.", builtin: true },
  { slug: "plan", name: "Plan Ease", colour: "sea", purpose: "Turns a goal into short ordered steps with timings, and puts them on your calendar and task list.", builtin: true },
  { slug: "travel", name: "Travel bot", colour: "clay", purpose: "Plans trips: routes, stays and timings, with sources.", builtin: true },
  { slug: "gym-bot", name: "Gym bot", colour: "pine", purpose: "Plans your workouts around your week.", builtin: false },
];

export const SAMPLE_JOBS: JobLite[] = [
  {
    id: "7c1d2e3f-0000-4000-8000-000000000001", task: "Fix cart total rounding", state: "waiting_for_you", waitingOn: "answer",
    question: { text: "Round the cart total per item, or once at the end?", options: ["Per item", "At the end"] },
    spentPaise: 640, createdAt: FIXED_NOW - 40 * MIN, updatedAt: FIXED_NOW - 2 * MIN,
  },
  {
    id: "7c1d2e3f-0000-4000-8000-000000000002", task: "Fixing cart. Checkout redesign, team of 3", state: "running", waitingOn: null,
    spentPaise: 1960, createdAt: FIXED_NOW - 3 * HOUR, updatedAt: FIXED_NOW - 5 * MIN,
  },
  { id: "7c1d2e3f-0000-4000-8000-000000000003", task: "Move sign-in to phone OTP", state: "done", waitingOn: null, spentPaise: 1420, createdAt: FIXED_NOW - 2 * DAY, updatedAt: FIXED_NOW - 2 * DAY + HOUR },
  { id: "7c1d2e3f-0000-4000-8000-000000000004", task: "Answer the review on PR #128", state: "done", waitingOn: null, spentPaise: 110, createdAt: FIXED_NOW - 9 * HOUR, updatedAt: FIXED_NOW - 8 * HOUR },
  { id: "7c1d2e3f-0000-4000-8000-000000000005", task: "Upgrade to Next 15", state: "done", waitingOn: null, spentPaise: 940, createdAt: FIXED_NOW - 30 * HOUR, updatedAt: FIXED_NOW - 29 * HOUR },
  { id: "7c1d2e3f-0000-4000-8000-000000000006", task: "Old job from last month", state: "done", waitingOn: null, spentPaise: 12000, createdAt: FIXED_NOW - 40 * DAY, updatedAt: FIXED_NOW - 40 * DAY },
];

export const SAMPLE_TASKS: TaskLite[] = [
  { id: "a1b2c3d4-0000-4000-8000-000000000001", state: "done", title: "Added 3 workouts to your calendar", createdAt: FIXED_NOW - 12 * HOUR, updatedAt: FIXED_NOW - 12 * HOUR },
];

export interface FakeOpts {
  bots?: BotLite[];
  jobs?: JobLite[];
  tasks?: TaskLite[];
  minutesSaved?: number;
  budgetPaise?: number;
  now?: number;
  /** Answers for `api`, by "METHOD /path". A missing one throws a 404, as the route would. */
  api?: Record<string, unknown>;
  /** Every call made through `api`, for a test to check. */
  calls?: Array<{ method: string; path: string; body?: unknown }>;
}

/** Deps that read from memory. Defaults: the sample day (with 6,200 paise of jobs this month, ours: never shown). */
export function fakeDeps(o: FakeOpts = {}): BotsDeps {
  return {
    bots: async () => o.bots ?? SAMPLE_BOTS,
    jobs: async () => o.jobs ?? SAMPLE_JOBS,
    tasks: async () => o.tasks ?? SAMPLE_TASKS,
    minutesSaved: async () => o.minutesSaved ?? 124,
    budgetPaise: async () => o.budgetPaise ?? 50_000,
    now: () => o.now ?? FIXED_NOW,
    api: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      o.calls?.push({ method, path, ...(body === undefined ? {} : { body }) });
      const k = `${method} ${path}`;
      if (o.api && k in o.api) return o.api[k] as T;
      throw Object.assign(new Error(`api: ${k} → 404`), { status: 404 });
    },
  };
}

/** The sample day's live state, without deps. */
export function sampleLive(o: Omit<FakeOpts, "api" | "calls"> = {}): BotsLive {
  return liveFrom({
    bots: o.bots ?? SAMPLE_BOTS, jobs: o.jobs ?? SAMPLE_JOBS, tasks: o.tasks ?? SAMPLE_TASKS,
    minutesSaved: o.minutesSaved ?? 124, budgetPaise: o.budgetPaise ?? 50_000, now: o.now ?? FIXED_NOW, tzOffsetMinutes: IST,
  });
}

/** A builder's ctx for a test or the render check. */
export function ctxFor(screenId: string, client: Client, live: BotsLive = sampleLive(), o: Partial<BotsCtx> = {}): BotsCtx {
  return {
    screenId, client, params: {}, live,
    user: { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya Sharma", email: "aanya@example.in" },
    can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: client === "desktop" }, tzOffsetMinutes: IST,
    ...o,
  };
}

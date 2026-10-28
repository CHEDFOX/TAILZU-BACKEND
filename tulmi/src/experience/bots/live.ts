/**
 * WHAT IS GOING ON RIGHT NOW: the person's bots, which are working, what needs them, the week, the month's spend.
 *
 * Every Bots app screen gets this (ctx.live): the tab bar and the sidebar draw it, and Home is mostly it. It is read
 * through BotsDeps, which the server builds per request from the real services (deps.ts) and a test or the render
 * check builds from fakes (fixtures.ts). `liveFrom` turns what the deps returned into the model, with no I/O, so
 * it is tested directly.
 *
 * What feeds what (all real records):
 *   bots        GET /v1/bots's list (BOTS on), else the four built-ins
 *   working     a Code bot job that is queued / running / waiting for a computer; a connected-app task that is running
 *   needs you   a Code bot job waiting for the person's answer (its question and options) or yes; a task waiting for approval
 *   the week    jobs and tasks that ended done since Monday, and the minutes writing by voice saved (history stats)
 *   spend       what the month's jobs spent, against the monthly limit (DEFAULT_MONTH_BUDGET_PAISE until a Budget screen stores one)
 */
import type { ActionSpec } from "../../../../shared/types/sdui.js";
import type { TabLive } from "./glyphs.js";
import { SCREENS } from "./ids.js";
import { BUILTIN_SLUGS, botLook, type BotLook } from "./palette.js";

// ------------------------------------------------------------------ what the deps return

/** A bot, as the list gives it. `colour` is a palette name (moss, clay…). */
export interface BotLite {
  slug: string;
  name: string;
  colour: string;
  purpose: string;
  builtin: boolean;
}

/** A Code bot job: its state, and the question its agent is waiting on (if any). */
export interface JobLite {
  id: string;
  task: string;
  state: "queued" | "running" | "waiting_for_compute" | "waiting_for_you" | "paused" | "done" | "failed" | "cancelled";
  waitingOn: "paid" | "commit" | "answer" | "approval" | "budget" | null;
  question?: { text: string; options?: string[] };
  /** The approval waiting on a yes (a plan, a commit): what it is about, in a line. */
  approval?: { summary: string };
  spentPaise: number;
  createdAt: number;
  updatedAt: number;
}

/** A connected-app task (connectors/tasks.ts TaskView, narrowed). */
export interface TaskLite {
  id: string;
  state: "running" | "waiting" | "done" | "failed" | "cancelled";
  title: string;
  /** Waiting for the person's yes: which app, which approval, what it would do. */
  approval?: { id: string; connector: string; preview: string };
  createdAt: number;
  updatedAt: number;
}

/**
 * The reads a Bots app screen may make, for ONE signed-in person. Built per request (deps.ts) or from fakes
 * (fixtures.ts). Every read may fail; liveFrom draws what it has.
 */
export interface BotsDeps {
  bots(): Promise<BotLite[]>;
  jobs(): Promise<JobLite[]>;
  tasks(): Promise<TaskLite[]>;
  /** Minutes writing by voice saved in the last seven days (history stats). 0 when unknown. */
  minutesSaved(): Promise<number>;
  /** The monthly limit in paise (the person's own once a Budget screen stores it). */
  budgetPaise(): Promise<number>;
  now(): number;
  /**
   * Any of the app's own routes, as the signed-in person ("GET", "/v1/bots/plan/memory"). A screen's `load` reads
   * what it needs through this, so a new screen needs no new plumbing. Throws on a non-2xx answer (`status` on the error).
   */
  api<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T>;
}

/** ₹500 a month: the limit until the person sets their own (the Budget board's example). */
export const DEFAULT_MONTH_BUDGET_PAISE = 50_000;

// ------------------------------------------------------------------ the model

export type BotState = "needs" | "working" | "idle";

export interface LiveBot extends BotLook {
  slug: string;
  name: string;
  builtin: boolean;
  /** needs if anything of its needs the person, else working if it is busy, else idle. */
  state: BotState;
  /** Busy right now (a bot can be busy AND waiting on the person: Home's Code bot is both). */
  working: boolean;
  /** How many of its things wait on the person. */
  needs: number;
  /** What it is doing ("fixing cart"), when working. */
  doing?: string;
  purpose: string;
}

export interface Choice {
  label: string;
  /** primary (one per card), secondary (outline), quiet (text only). */
  kind: "primary" | "secondary" | "quiet";
  action: ActionSpec;
}

/** One thing that needs the person: a question with its choices, or a yes. */
export interface NeedsItem {
  id: string;
  /** The bot it is from (its slug, or "tailzu"). */
  bot: string;
  botName: string;
  color: string;
  question: string;
  /** A line under the question (what a yes would do). */
  detail?: string;
  choices: Choice[];
  at: number;
}

export interface WorkingItem {
  id: string;
  bot: string;
  title: string;
  at: number;
}

export interface BotsLive {
  /** Needs-you first, then working, then the built-ins in their order, then the person's own. */
  bots: LiveBot[];
  needs: NeedsItem[];
  working: WorkingItem[];
  week: { done: number; minutesSaved: number };
  spend: { monthPaise: number; budgetPaise: number };
  /** What the living tab icons and the sidebar show (glyphs.ts). */
  tab: TabLive;
  /** "Good morning" / "Good afternoon" / "Good evening", in the person's own day. */
  greeting: string;
  now: number;
}

// ------------------------------------------------------------------ reading

/** Reads everything at once; a read that fails counts as empty. */
export async function loadLive(deps: BotsDeps, tzOffsetMinutes = 0): Promise<BotsLive> {
  const safe = <T>(p: Promise<T>, empty: T): Promise<T> => p.catch(() => empty);
  const [bots, jobs, tasks, saved, budget] = await Promise.all([
    safe(deps.bots(), [] as BotLite[]), safe(deps.jobs(), [] as JobLite[]), safe(deps.tasks(), [] as TaskLite[]),
    safe(deps.minutesSaved(), 0), safe(deps.budgetPaise(), DEFAULT_MONTH_BUDGET_PAISE),
  ]);
  return liveFrom({ bots, jobs, tasks, minutesSaved: saved, budgetPaise: budget, now: deps.now(), tzOffsetMinutes });
}

const ACTIVE_JOB = new Set<JobLite["state"]>(["queued", "running", "waiting_for_compute"]);

/** Which bot a connected app's task belongs to: the built-in whose skills name the app, else Tailzu itself. */
export const CONNECTOR_BOT: Record<string, string> = {
  "google-calendar": "plan", "google-tasks": "plan", maps: "travel", booking: "travel",
};

/** A job's task, as a short "doing" line: the first clause, lower-cased, at most 28 characters. */
export function doingLine(task: string): string {
  const first = task.split(/[.\n]/)[0]!.trim();
  const s = first.charAt(0).toLowerCase() + first.slice(1);
  return s.length > 28 ? s.slice(0, 27).trimEnd() + "…" : s;
}

/** Monday 00:00 of the person's week, and the 1st of their month, as epoch ms. */
export function weekAndMonthStart(now: number, tzOffsetMinutes: number): { week: number; month: number } {
  const local = new Date(now + tzOffsetMinutes * 60_000);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const week = midnight - sinceMonday * 86_400_000 - tzOffsetMinutes * 60_000;
  const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - tzOffsetMinutes * 60_000;
  return { week, month };
}

export function greetingAt(now: number, tzOffsetMinutes: number): string {
  const h = new Date(now + tzOffsetMinutes * 60_000).getUTCHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The choices for a job's question: its options (two at most, the first primary), then "You decide". */
function jobChoices(job: JobLite): Choice[] {
  const answer = (text: string): ActionSpec => ({
    kind: "callEndpoint", method: "POST", path: `/v1/code/jobs/${job.id}/answer`, body: { answer: text },
    onSuccess: { kind: "sequence", actions: [{ kind: "toast", message: "Sent to Code bot" }, { kind: "refresh" }] },
    onError: { kind: "toast", message: "Couldn't send that. Try again.", tone: "error" },
  });
  const opts = (job.question?.options ?? []).filter((o) => o.trim()).slice(0, 2);
  if (!opts.length) {
    return [{ label: "Answer", kind: "primary", action: { kind: "navigate", screenId: SCREENS.codeJob, params: { id: job.id } } }];
  }
  return [
    ...opts.map((o, i): Choice => ({ label: o, kind: i === 0 ? "primary" : "secondary", action: answer(o) })),
    { label: "You decide", kind: "quiet", action: answer("You decide. Pick what fits the code best and say which you chose.") },
  ];
}

function taskChoices(task: TaskLite): Choice[] {
  const call = (verb: "approve" | "deny", ok: string): ActionSpec => ({
    kind: "callEndpoint", method: "POST", path: `/v1/tasks/${task.id}/${verb}`,
    ...(verb === "approve" ? { body: { approvalId: task.approval!.id } } : {}),
    onSuccess: { kind: "sequence", actions: [{ kind: "toast", message: ok }, { kind: "refresh" }] },
    onError: { kind: "toast", message: "Couldn't do that. Try again.", tone: "error" },
  });
  return [
    { label: "Yes, do it", kind: "primary", action: call("approve", "Done") },
    { label: "No", kind: "secondary", action: call("deny", "Left it") },
  ];
}

export interface LiveInput {
  bots: BotLite[];
  jobs: JobLite[];
  tasks: TaskLite[];
  minutesSaved: number;
  budgetPaise: number;
  now: number;
  tzOffsetMinutes?: number;
}

/** The model from what the deps returned. Pure. */
export function liveFrom(i: LiveInput): BotsLive {
  const tz = i.tzOffsetMinutes ?? 0;
  const { week, month } = weekAndMonthStart(i.now, tz);
  // The four built-ins are always there, even with the bots platform off or its read failed.
  const listed = new Map(i.bots.map((b) => [b.slug, b]));
  const bots: BotLite[] = [
    ...BUILTIN_SLUGS.map((s) => listed.get(s) ?? builtinLite(s)),
    ...i.bots.filter((b) => !BUILTIN_SLUGS.includes(b.slug as (typeof BUILTIN_SLUGS)[number])),
  ];
  const look = (slug: string, colour?: string) => botLook(slug, colour);
  const nameOf = (slug: string) => bots.find((b) => b.slug === slug)?.name ?? (slug === "tailzu" ? "Tailzu" : slug);

  const needs: NeedsItem[] = [];
  const working: WorkingItem[] = [];
  for (const j of i.jobs) {
    if (j.state === "waiting_for_you" && (j.waitingOn === "answer" || j.waitingOn === "approval") && (j.question || j.approval)) {
      needs.push({
        id: `job:${j.id}`, bot: "code", botName: nameOf("code"), color: look("code").color,
        question: j.question?.text ?? j.approval!.summary,
        ...(j.question ? {} : { detail: doingLine(j.task) }),
        choices: j.question ? jobChoices(j) : [{ label: "Look and decide", kind: "primary", action: { kind: "navigate", screenId: SCREENS.codeJob, params: { id: j.id } } }],
        at: j.updatedAt,
      });
    } else if (ACTIVE_JOB.has(j.state)) {
      working.push({ id: `job:${j.id}`, bot: "code", title: j.task, at: j.updatedAt });
    }
  }
  for (const t of i.tasks) {
    const bot = t.approval ? (CONNECTOR_BOT[t.approval.connector] ?? "tailzu") : "tailzu";
    if (t.state === "waiting" && t.approval) {
      needs.push({
        id: `task:${t.id}`, bot, botName: nameOf(bot), color: look(bot).color,
        question: t.title, detail: t.approval.preview, choices: taskChoices(t), at: t.updatedAt,
      });
    } else if (t.state === "running") {
      working.push({ id: `task:${t.id}`, bot, title: t.title, at: t.updatedAt });
    }
  }
  needs.sort((a, b) => b.at - a.at);
  working.sort((a, b) => b.at - a.at);

  const stateOf = (slug: string): BotState =>
    needs.some((n) => n.bot === slug) ? "needs" : working.some((w) => w.bot === slug) ? "working" : "idle";
  const live: LiveBot[] = bots.map((b) => {
    const state = stateOf(b.slug);
    const w = working.find((x) => x.bot === b.slug);
    return {
      ...look(b.slug, b.colour), slug: b.slug, name: b.name, builtin: b.builtin, state, purpose: b.purpose,
      working: !!w, needs: needs.filter((n) => n.bot === b.slug).length,
      ...(w ? { doing: doingLine(w.title) } : {}),
    };
  });
  const rank = (b: LiveBot) => (b.state === "needs" ? 0 : b.state === "working" ? 1 : 2);
  live.sort((a, b) => rank(a) - rank(b) || bots.findIndex((x) => x.slug === a.slug) - bots.findIndex((x) => x.slug === b.slug));

  const done = i.jobs.filter((j) => j.state === "done" && j.updatedAt >= week).length
    + i.tasks.filter((t) => t.state === "done" && t.updatedAt >= week).length;
  const monthPaise = i.jobs.filter((j) => j.updatedAt >= month).reduce((n, j) => n + Math.max(0, j.spentPaise || 0), 0);
  const budgetPaise = i.budgetPaise > 0 ? i.budgetPaise : DEFAULT_MONTH_BUDGET_PAISE;
  // The tab icons' four dots are the first four bots in their own order, so a dot never moves when a bot gets busy.
  const tab: TabLive = {
    dots: bots.slice(0, 4).map((b) => ({ color: look(b.slug, b.colour).color, working: working.some((w) => w.bot === b.slug) })),
    needs: needs.length,
    ...(live.find((b) => b.working) ? { workingColor: live.find((b) => b.working)!.color } : {}),
    spent: monthPaise / budgetPaise,
  };

  return {
    bots: live, needs, working, tab,
    week: { done, minutesSaved: Math.max(0, Math.round(i.minutesSaved)) },
    spend: { monthPaise, budgetPaise },
    greeting: greetingAt(i.now, tz),
    now: i.now,
  };
}

/** The built-ins' own words, for when the bots platform is off (src/bots/builtin.ts is the source when it is on). */
const BUILTIN_LITE: Record<(typeof BUILTIN_SLUGS)[number], { name: string; purpose: string }> = {
  code: { name: "Code bot", purpose: "Reads your projects, answers questions about the code, and changes it through pull requests." },
  keybot: { name: "Keybot", purpose: "Writes, rewrites and replies in your own voice, in any language you mix." },
  plan: { name: "Plan bot", purpose: "Turns a goal into short ordered steps with timings, and puts them on your calendar and task list." },
  travel: { name: "Travel bot", purpose: "Plans trips: routes, stays, timings and costs, with sources." },
};

function builtinLite(slug: (typeof BUILTIN_SLUGS)[number]): BotLite {
  return { slug, ...BUILTIN_LITE[slug], colour: "", builtin: true };
}

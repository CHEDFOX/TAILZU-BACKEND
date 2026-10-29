/**
 * ONE ACTIVITY FEED ACROSS EVERYTHING THE PERSON'S BOTS DID (bots.activity, bots.tasks, Today, the glance).
 *
 *   feedOf(input) -> FeedRow[]      newest first: what needs them and what is working is the screen's to lift to the top
 *
 * Every row is a real record, read by routes/botsShell.ts and handed in here, so this file is pure and tested directly:
 *   job       a Code bot job (code/jobs): its task, its state, the stage its agent is in, what it spent
 *   task      a connected-app task (connectors/tasks.ts): a change waiting for a yes, running, done, refused
 *   ask       an answer a bot gave through the Bots app's Ask (shell/events.ts): which bot, what was asked, what it cost
 *   payment   a payment the person said they made in their UPI app from bots.approve (shell/events.ts): never one we made
 *   words     Keybot: the words they spoke instead of typed on a day (history), and in which apps
 *
 * No money on any row: what a bot's work cost stays ours (`paise`, for the logs; no screen draws it), and a payment says who and
 * what it was for, never the amount.
 */
import { CONNECTOR_BOT } from "../experience/bots/live.js";

export type FeedType = "job" | "task" | "ask" | "payment" | "words";
export type FeedMark = "working" | "needs" | "done" | "failed" | "waiting";

/** Where a row goes when it is tapped: a Bots app screen and its params. */
export interface FeedOpen { screenId: string; params?: Record<string, string> }

export interface FeedRow {
  /** "job:<id>", "task:<id>", "ask:<id>", "pay:<id>", "words:<YYYY-MM-DD>". */
  id: string;
  type: FeedType;
  /** The bot's slug ("code", "keybot", a person's own), or "tailzu" for the assistant itself. */
  bot: string;
  title: string;
  /** A second line: where, how, when. */
  sub?: string;
  at: number;
  mark: FeedMark;
  /** What the bot's work cost, in paise, when it is known. */
  paise?: number;
  /** No longer filled: the screens show no money. Kept for older readers. */
  money?: string;
  /** A running Code bot job: which of the five stages it is in. */
  stage?: { at: number; of: number; name: string };
  open?: FeedOpen;
}

/** A Code bot job, as much as the feed reads (code/jobs/types.ts CodeJob, with its agent's phase read out). */
export interface FeedJob {
  id: string;
  task: string;
  state: "queued" | "running" | "waiting_for_compute" | "waiting_for_you" | "paused" | "done" | "failed" | "cancelled";
  spentPaise: number;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  /** The agent's phase (code/agent/types.ts PHASES), when it has one. */
  phase?: string;
}

/** A connected-app task (connectors/tasks.ts TaskView). */
export interface FeedTask {
  id: string;
  state: "running" | "waiting" | "done" | "failed" | "cancelled";
  title: string;
  steps: Array<{ at: number; text: string }>;
  approval: { id: string; connector: string; preview: string } | null;
  createdAt: number;
  updatedAt: number;
}

/** A row of shell/events.ts. */
export interface FeedEvent {
  id: string;
  kind: "ask" | "paid";
  bot: string;
  title: string;
  paise: number;
  amountPaise: number;
  payee: string;
  at: number;
}

/** Keybot on one day: the words spoken and the apps they went into (history). */
export interface FeedWords { day: string; at: number; words: number; apps: string[] }

export interface FeedInput {
  now: number;
  tzOffsetMinutes: number;
  jobs: FeedJob[];
  tasks: FeedTask[];
  events: FeedEvent[];
  words: FeedWords[];
  /** project id -> its name ("Salon booking app"), for a job's second line. */
  projects?: Record<string, string>;
  /** How far back, in days (7). */
  days?: number;
}

// ------------------------------------------------------------------ words and numbers

/** Money as a person reads it: "₹184", "₹6.40" (the kit's rupees(), here so the domain does not import the screens' kit). */
export function rupeesOf(paise: number): string {
  const r = Math.round(paise) / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString("en-IN") : r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "4:02 pm", in the person's own day. */
export function clockOf(at: number, tzOffsetMinutes: number): string {
  const d = new Date(at + tzOffsetMinutes * 60_000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The person's local date, "2026-10-28". */
export function dayKeyOf(at: number, tzOffsetMinutes: number): string {
  return new Date(at + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Midnight of the person's day, as epoch ms. */
export function dayStartOf(at: number, tzOffsetMinutes: number): number {
  const local = at + tzOffsetMinutes * 60_000;
  return local - (local % 86_400_000) - tzOffsetMinutes * 60_000;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", "Monday" (this past week), else "Fri 23 Oct". */
export function dayLabel(at: number, now: number, tzOffsetMinutes: number): string {
  const days = Math.round((dayStartOf(now, tzOffsetMinutes) - dayStartOf(at, tzOffsetMinutes)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(at + tzOffsetMinutes * 60_000);
  if (days < 7) return WEEKDAYS[d.getUTCDay()]!;
  return `${WEEKDAYS[d.getUTCDay()]!.slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Wednesday, 28 October". */
export function longDate(at: number, tzOffsetMinutes: number): string {
  const d = new Date(at + tzOffsetMinutes * 60_000);
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()];
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${month}`;
}

const clip = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1).trimEnd() + "…" : one;
};

// ------------------------------------------------------------------ a job's stage

/** The five stages a person sees (Kit3: Understand · Plan · Build · Check · Ship). */
export const STAGES = ["Understand", "Plan", "Build", "Check", "Ship"] as const;

const PHASE_STAGE: Record<string, number> = {
  prepare: 0, new_project: 0, baseline: 0, merge: 0, locate: 0,
  plan: 1, split: 1, team: 1,
  work: 2, design: 2,
  verify: 3,
  commit: 4, pr: 4, report: 4, done: 4,
};

/** Which of the five stages an agent's phase is: 0..4, and its name. A job with no agent yet is understanding. */
export function stageOf(phase: string | undefined): { at: number; of: number; name: string } {
  const at = phase && phase in PHASE_STAGE ? PHASE_STAGE[phase]! : 0;
  return { at, of: STAGES.length, name: STAGES[at]! };
}

// ------------------------------------------------------------------ whose a connected app's task is

const APP_BOT: Array<[RegExp, string]> = [
  [/calendar|google tasks|todoist|reminder/i, "plan"],
  [/maps|uber|ola|irctc|booking|flight|train|airbnb|makemytrip/i, "travel"],
];

/** The bot a connected-app task belongs to: by the app it is waiting on, else by the app its steps name, else Tailzu. */
export function taskBot(t: Pick<FeedTask, "approval" | "steps" | "title">): string {
  if (t.approval) return CONNECTOR_BOT[t.approval.connector] ?? "tailzu";
  const words = `${t.steps.map((s) => s.text).join(" ")} ${t.title}`;
  for (const [re, bot] of APP_BOT) if (re.test(words)) return bot;
  return "tailzu";
}

// ------------------------------------------------------------------ the feed

const JOB_MARK: Record<FeedJob["state"], FeedMark> = {
  queued: "working", running: "working", waiting_for_compute: "working", waiting_for_you: "needs", paused: "waiting",
  done: "done", failed: "failed", cancelled: "failed",
};

function jobRow(j: FeedJob, i: FeedInput): FeedRow {
  const mark = JOB_MARK[j.state];
  const project = j.projectId ? i.projects?.[j.projectId] : undefined;
  const when = clockOf(j.updatedAt, i.tzOffsetMinutes);
  const spent = Math.max(0, j.spentPaise || 0);
  const stage = mark === "working" ? stageOf(j.phase) : undefined;
  const sub = mark === "working" ? `Doing it for you · step ${stage!.at + 1} of ${stage!.of}${project ? ` · ${project}` : ""}`
    : mark === "needs" ? `Needs you${project ? ` · ${project}` : ""}`
      : j.state === "paused" ? `Paused · ${when}`
        : j.state === "failed" ? `Couldn't finish · ${when}`
          : j.state === "cancelled" ? `Stopped · ${when}`
            : [project, "On its own", when].filter(Boolean).join(" · ");
  return {
    id: `job:${j.id}`, type: "job", bot: "code", title: clip(j.task, 120), sub, at: j.updatedAt, mark, paise: spent,
    ...(stage ? { stage } : {}),
    open: { screenId: "bots.code.job", params: { id: j.id } },
  };
}

function taskRow(t: FeedTask, i: FeedInput): FeedRow {
  const last = t.steps[t.steps.length - 1]?.text ?? "";
  const when = clockOf(t.updatedAt, i.tzOffsetMinutes);
  const mark: FeedMark = t.state === "waiting" ? "needs" : t.state === "running" ? "working" : t.state === "done" ? "done" : "failed";
  const sub = t.state === "waiting" && t.approval ? clip(t.approval.preview, 90)
    : t.state === "running" ? "Doing it for you"
      : t.state === "done" ? `Done for you · ${last ? `${clip(last, 50)} · ` : ""}${when}`
        : t.state === "cancelled" ? `Left it · ${when}` : `Couldn't finish · ${when}`;
  return {
    id: `task:${t.id}`, type: "task", bot: taskBot(t), title: clip(t.title, 120), sub, at: t.updatedAt, mark,
    ...(t.state === "waiting" ? { open: { screenId: "bots.approve", params: { task: t.id } } } : {}),
  };
}

function eventRow(e: FeedEvent, i: FeedInput): FeedRow {
  const when = clockOf(e.at, i.tzOffsetMinutes);
  if (e.kind === "paid") {
    return {
      id: `pay:${e.id}`, type: "payment", bot: e.bot, title: `${clip(e.title, 90)}. You pressed pay by UPI.`,
      sub: `${e.payee ? `${clip(e.payee, 40)} · ` : ""}${when}`, at: e.at, mark: "done",
      open: { screenId: "bots.approve", params: { receipt: e.id } },
    };
  }
  return {
    id: `ask:${e.id}`, type: "ask", bot: e.bot, title: `“${clip(e.title, 110)}”`, sub: `You asked · ${when}`, at: e.at, mark: "done",
    paise: e.paise,
    open: { screenId: "bots.ask", params: { message: e.title, bot: e.bot } },
  };
}

function wordsRow(w: FeedWords): FeedRow {
  const apps = w.apps.slice(0, 2).join(", ");
  return {
    id: `words:${w.day}`, type: "words", bot: "keybot", title: `Wrote ${w.words.toLocaleString("en-IN")} ${w.words === 1 ? "word" : "words"} by voice`,
    sub: apps ? `Keybot · ${apps}` : "Keybot", at: w.at, mark: "done",
    open: { screenId: "bots.keybot.history" },
  };
}

/** The feed, newest first, the last `days` days (what waits for the person or is working is kept whatever its age). */
export function feedOf(i: FeedInput): FeedRow[] {
  const since = dayStartOf(i.now, i.tzOffsetMinutes) - ((i.days ?? 7) - 1) * 86_400_000;
  const rows: FeedRow[] = [
    ...i.jobs.map((j) => jobRow(j, i)),
    ...i.tasks.map((t) => taskRow(t, i)),
    ...i.events.map((e) => eventRow(e, i)),
    ...i.words.filter((w) => w.words > 0).map(wordsRow),
  ];
  return rows
    .filter((r) => r.at >= since || r.mark === "needs" || r.mark === "working")
    .sort((a, b) => b.at - a.at);
}

/** The week in three numbers: things done, what the bots spent, and what writing by voice saved (minutes, from history). */
export function weekOf(rows: readonly FeedRow[], weekStart: number, minutesSaved: number): { done: number; paise: number; minutesSaved: number } {
  const mine = rows.filter((r) => r.at >= weekStart);
  return {
    done: mine.filter((r) => r.mark === "done" && r.type !== "words").length,
    paise: mine.reduce((n, r) => n + (r.paise ?? 0), 0),
    minutesSaved: Math.max(0, Math.round(minutesSaved)),
  };
}

/** The filters the feed offers, by type: Jobs (the work bots did), Payments, Words. */
export const FEED_KINDS: Record<"jobs" | "payments" | "words", FeedType[]> = {
  jobs: ["job", "task", "ask"],
  payments: ["payment"],
  words: ["words"],
};

/** A feed narrowed by bot and by kind ("all" for either keeps everything). */
export function filterFeed(rows: readonly FeedRow[], o: { bot?: string; kind?: string }): FeedRow[] {
  const kinds = o.kind && o.kind !== "all" ? FEED_KINDS[o.kind as keyof typeof FEED_KINDS] : undefined;
  return rows.filter((r) => (!o.bot || o.bot === "all" || r.bot === o.bot) && (!kinds || kinds.includes(r.type)));
}

/** Keybot's day from the history rows of that day: words, by hour, by app (the words a row wrote, out). */
export function wordsDay(rows: ReadonlyArray<{ at: number; words: number; app?: string }>, tzOffsetMinutes: number): {
  words: number; byHour: Array<{ hour: number; words: number }>; byApp: Array<{ app: string; words: number }>;
} {
  const hours = new Map<number, number>();
  const apps = new Map<string, number>();
  let words = 0;
  for (const r of rows) {
    const w = Math.max(0, r.words || 0);
    words += w;
    const h = new Date(r.at + tzOffsetMinutes * 60_000).getUTCHours();
    hours.set(h, (hours.get(h) ?? 0) + w);
    const app = appName(r.app);
    if (app) apps.set(app, (apps.get(app) ?? 0) + w);
  }
  return {
    words,
    byHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, w]) => ({ hour, words: w })),
    byApp: [...apps.entries()].sort((a, b) => b[1] - a[1]).map(([app, w]) => ({ app, words: w })),
  };
}

/** A history row's target app as a person names it ("gmail" -> "Gmail"); none for the generic ones. */
export function appName(app: string | undefined): string {
  if (!app) return "";
  const known: Record<string, string> = {
    whatsapp: "WhatsApp", gmail: "Gmail", email: "Email", slack: "Slack", linkedin: "LinkedIn", twitter: "X", x: "X", notes: "Notes",
    instagram: "Instagram", telegram: "Telegram", messages: "Messages", sms: "Messages", docs: "Docs", chatgpt: "ChatGPT", tailzu: "X0 Bot",
  };
  const k = app.toLowerCase().trim();
  if (!k || k === "generic" || k === "default" || k === "other" || k === "auto") return "";
  return known[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
}

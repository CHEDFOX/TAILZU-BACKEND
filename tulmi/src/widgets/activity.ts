/**
 * THE "BOTS AT WORK" LIVE ACTIVITY, FROM THE SERVER (docs/widget-glance-v2.md section 6): when a Xode job's stage, its question or its end
 * changes, the activity on the person's Lock Screen is updated by an APNs push (apns.ts), so it moves while the app is shut.
 *
 *   contentStateOf(job)    the activity's ContentState, the same shape the app writes from glance v2 (phase working | needs | done), with a
 *                          signature of what a person would see change (phase, stage, the question, the result)
 *   ActivityPusher         told of every change to a job (live/writes.ts liveJob → setJobChangeHook), a little after the last of a burst:
 *                          reads the job, and pushes when a token is registered for it (POST /v1/widgets/activity-token) and what it
 *                          shows changed since the last push. A question is an alert (priority 10); the end shows the result for 15
 *                          minutes, then the activity is dismissed, and the token is forgotten; a step is a quiet update (priority 5)
 *
 * PRIVATE-SAFE: the activity is on the Lock Screen, so a question the bot marked private (or a kind in x0.needs.private) shows only that
 * the bot needs the person, with no answers to tap. Off unless APNs is configured (apns.ts): nothing is registered, read or sent.
 */
import type { JobLite } from "../experience/bots/live.js";
import { stageOf, STAGES } from "../shell/feed.js";
import { questionMark } from "./items.js";
import type { ApnsResult, LiveActivityPush } from "./apns.js";
import { clauseOf, eventLine } from "./botWords.js";
import { faceOf, jobNeedsItem, taskLine, type GlanceChoice, type X0Words } from "./glance.js";
import type { ActivityTokenStore } from "./glanceStore.js";
import { linkOf } from "./now.js";

/** How long the done state stays on the Lock Screen before the activity is dismissed. */
export const DONE_SHOWN_MS = 15 * 60_000;

export interface ContentState {
  bot: string;
  botName: string;
  face: string | null;
  task: string;
  stage: number;
  of: number;
  stageName: string;
  stages: string[];
  startedAt: number;
  phase: "working" | "needs" | "done";
  question?: string;
  choices?: GlanceChoice[];
  /** The needs item the activity answers (phase needs): the /v1/widgets/act item and its kind, and where "You decide" opens. */
  itemId?: string;
  itemKind?: "question" | "approval";
  decideLink?: string;
  /** The question's words are kept off the Lock Screen: `question` is only that the bot needs the person. */
  private?: true;
  result?: string;
  pr?: { number: number; url: string };
  /** It ended with a problem (or was stopped): `result` says so. */
  failed?: true;
  /** Done: how long it took, in whole minutes. */
  minutes?: number;
  link: string;
}

export interface ActivityUpdate {
  state: ContentState;
  event: "update" | "end";
  priority: 5 | 10;
  alert?: { title: string; body: string };
  /** What a person would see change. Two updates with the same signature are one. */
  sig: string;
}

/** The activity's state for a job, or null for a job a person does not follow (a team's helper). */
export function contentStateOf(job: JobLite, w: X0Words, botName: string): ActivityUpdate | null {
  if (job.helper) return null;
  const k = w.k;
  const link = linkOf(k, "question", { jobId: job.id });
  const ended = job.state === "done" || job.state === "failed" || job.state === "cancelled";
  const stage = stageOf(ended && job.state === "done" ? "done" : job.phase);
  const base = {
    bot: "code", botName, face: faceOf("code"), task: taskLine(job.task) || eventLine("working", undefined, { bot: botName }, w.fill),
    stage: stage.at + 1, of: stage.of, stageName: stage.name, stages: [...STAGES], startedAt: job.startedAt ?? job.createdAt, link,
  };
  if (ended) {
    const failed = job.state !== "done";
    const result = failed ? eventLine("failed", job.reason, { bot: botName }, w.fill) : eventLine("done", job.result, { bot: botName, task: clauseOf(job.task) }, w.fill);
    const minutes = Math.max(1, Math.round((job.updatedAt - base.startedAt) / 60_000));
    const state: ContentState = { ...base, phase: "done", result, minutes, ...(job.pr ? { pr: job.pr } : {}), ...(failed ? { failed: true as const } : {}) };
    return { state, event: "end", priority: 10, sig: sigOf(["done", job.state, result]) };
  }
  const item = jobNeedsItem(job, w, botName, link);
  if (item) {
    const hidden = item.private;
    const question = hidden ? eventLine("needs", undefined, { bot: botName }, w.fill) : item.question;
    const state: ContentState = {
      ...base, phase: "needs", question, itemId: item.id, itemKind: item.kind, decideLink: item.decideLink,
      ...(!hidden && item.choices.length ? { choices: item.choices } : {}), ...(hidden ? { private: true as const } : {}),
    };
    const title = eventLine("needs", undefined, { bot: botName }, w.fill);
    return {
      state, event: "update", priority: 10, alert: { title, body: hidden ? w.word("x0.lock.answer", "Open X0 to answer") : question },
      sig: sigOf(["needs", item.id, question]),
    };
  }
  return { state: { ...base, phase: "working" }, event: "update", priority: 5, sig: sigOf(["working", String(base.stage)]) };
}

const sigOf = (parts: string[]): string => questionMark(parts.join("\u0000"));

export interface ActivityLog { info(msg: string): void; warn(msg: string): void }

export interface ActivityPusherDeps {
  tokens: ActivityTokenStore;
  sender: { send(token: string, p: LiveActivityPush, env?: "production" | "sandbox"): Promise<ApnsResult> };
  /** The person's job as the Bots app reads it, or null. */
  readJob(userId: string, jobId: string): Promise<JobLite | null>;
  /** The words for this person (the widgets knobs, in their language). */
  words(userId: string, hg: boolean): X0Words;
  now?: () => number;
  /** A burst of changes is one push this long after its last (ms). */
  delayMs?: number;
  log?: ActivityLog;
}

export class ActivityPusher {
  private due = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly log: ActivityLog;

  constructor(private readonly d: ActivityPusherDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? { info: () => {}, warn: (m) => console.warn(m) };
  }

  /** A job changed: its activity hears of it after the burst (never in the writer's way, never throws). */
  jobChanged(userId: string, jobId: string): void {
    const key = `${userId}\u0000${jobId}`;
    const had = this.due.get(key);
    if (had) clearTimeout(had);
    const t = setTimeout(() => { this.due.delete(key); void this.flush(userId, jobId).catch(() => undefined); }, Math.max(0, this.d.delayMs ?? 1500));
    t.unref?.();
    this.due.set(key, t);
  }

  /** Push the job's state to its activity now, if it has one and the state changed. Returns what was done, for the log and the tests. */
  async flush(userId: string, jobId: string): Promise<"none" | "same" | "sent" | "ended" | "failed" | "gone"> {
    const t = await this.d.tokens.get(userId, jobId).catch(() => null);
    if (!t) return "none";
    const job = await this.d.readJob(userId, jobId).catch(() => null);
    if (!job) return "none";
    const words = this.d.words(userId, t.hg === true);
    const name = words.k.label("widgets.who.code", "Xode");
    const u = contentStateOf(job, words, name);
    if (!u) return "none";
    if (u.sig === t.sent) return "same";
    const at = this.now();
    let r: ApnsResult;
    try {
      r = await this.d.sender.send(t.token, {
        event: u.event, contentState: u.state as unknown as Record<string, unknown>, at, priority: u.priority,
        ...(u.event === "end" ? { dismissAt: at + DONE_SHOWN_MS } : {}), ...(u.alert ? { alert: u.alert } : {}),
      }, t.env);
    } catch (err) {
      this.log.warn(`widgets: live activity push failed (${(err as Error)?.message?.slice(0, 80) ?? "error"})`);
      return "failed";
    }
    if (r.gone || (r.ok && u.event === "end")) {
      await this.d.tokens.drop(userId, jobId).catch(() => undefined);
      return r.gone ? "gone" : "ended";
    }
    if (!r.ok) {
      this.log.warn(`widgets: live activity push refused (${r.status}${r.reason ? ` ${r.reason}` : ""})`);
      return "failed";
    }
    await this.d.tokens.sent(userId, jobId, u.sig, at).catch(() => undefined);
    return "sent";
  }

  /** Drop what is waiting (tests, shutdown). */
  clear(): void { for (const t of this.due.values()) clearTimeout(t); this.due.clear(); }
}

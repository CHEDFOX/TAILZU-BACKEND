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
import { START_TOKEN_JOB, type ActivityTokenStore } from "./glanceStore.js";
import { linkOf } from "./now.js";
import { activityVars } from "../experience/native/bind.js";
import { fitActivityBody } from "../experience/native/size.js";
import { pickDesign } from "../experience/native/target.js";
import { NLOOK_CAPS } from "../../../shared/types/nlook.js";
import { getConfig } from "../config.js";

/** How long the done state stays on the Lock Screen before the activity is dismissed. */
export const DONE_SHOWN_MS = 15 * 60_000;

/**
 * The push-to-start mark, kept in the START row's own `sent` field (which is otherwise unused: nothing is ever pushed to a
 * start token twice). `start:<jobId>` means "an activity for that job is on their Lock Screen and has not registered a token
 * of its own yet". It lasts as long as an activity does — iOS ends one after 8 hours — and is cleared when the job ends.
 */
const START_MARK = "start:";
const START_MARK_MS = 8 * 3600_000;

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
  /**
   * THE SERVER DESIGN this activity draws, by id ("bots.night"). The design itself already waits in the App Group, which the
   * activity's views can read, so a 4 KB push only has to NAME it: the cap limits the DATA, never the design. Named only when the
   * phone told us (on its token) that it holds a catalog at least as new as the design's `since`, so a push can never name
   * something the phone has not downloaded. Unknown, missing or too new: today's own hand-drawn regions, region by region.
   */
  look?: string;
  /**
   * The one way a later design binds data this frozen struct has no field for (experience/native/bind.ts). Free strings nobody
   * can classify, so they count as private words on a lock root, and the server leaves the unsafe ones out while a job's
   * question is private.
   */
  vars?: Record<string, string>;
}

export interface ActivityUpdate {
  state: ContentState;
  event: "update" | "end";
  priority: 5 | 10;
  alert?: { title: string; body: string };
  /** What a person would see change. Two updates with the same signature are one. */
  sig: string;
}

export interface ContentStateOptions {
  /** The design this phone may be told to draw (experience/native/target.ts pickDesign). Absent: today's regions. */
  look?: string | null;
  /** Now, for the vars that count minutes. Defaults to the job's own last change, so a pure function stays pure in a test. */
  now?: number;
}

/** The activity's state for a job, or null for a job a person does not follow (a team's helper). */
export function contentStateOf(job: JobLite, w: X0Words, botName: string, o: ContentStateOptions = {}): ActivityUpdate | null {
  if (job.helper) return null;
  const k = w.k;
  const link = linkOf(k, "question", { jobId: job.id });
  const ended = job.state === "done" || job.state === "failed" || job.state === "cancelled";
  const stage = stageOf(ended && job.state === "done" ? "done" : job.phase);
  const base = {
    bot: "code", botName, face: faceOf("code"), task: taskLine(job.task) || eventLine("working", undefined, { bot: botName }, w.fill),
    stage: stage.at + 1, of: stage.of, stageName: stage.name, stages: [...STAGES], startedAt: job.startedAt ?? job.createdAt, link,
  };
  // The design and the free map ride along, then the whole body is measured and trimmed until it fits (size.ts). Apple's cap is
  // 4 KB and a body over it fails SILENTLY, so this is measured rather than trusted — three times, here and on both readers.
  const dress = (u: ActivityUpdate, isPrivate: boolean): ActivityUpdate => {
    const at = o.now ?? job.updatedAt;
    // `vars` ride WITH a design and only with one. Nothing else can read them — the hand-drawn regions have no idea they
    // exist — so sending them to a phone that is drawing those regions would be bytes off the 4 KB for nothing, and would
    // change today's pushes while the whole feature is switched off.
    const vars = o.look ? activityVars({ now: at, startedAt: base.startedAt, stage: base.stage, of: base.of, phase: u.state.phase }, { private: isPrivate }) : undefined;
    const full: ContentState = { ...u.state, ...(o.look ? { look: o.look } : {}), ...(vars ? { vars } : {}) };
    const fitted = fitActivityBody(full as unknown as Record<string, unknown>);
    // The look is part of what a person sees, so it belongs in the signature; `vars` is not, so an ETA ticking over never
    // spends one of the day's pushes on its own.
    return { ...u, state: fitted.state as unknown as ContentState, sig: o.look ? sigOf([u.sig, o.look]) : u.sig };
  };

  if (ended) {
    const failed = job.state !== "done";
    const result = failed ? eventLine("failed", job.reason, { bot: botName }, w.fill) : eventLine("done", job.result, { bot: botName, task: clauseOf(job.task) }, w.fill);
    const minutes = Math.max(1, Math.round((job.updatedAt - base.startedAt) / 60_000));
    const state: ContentState = { ...base, phase: "done", result, minutes, ...(job.pr ? { pr: job.pr } : {}), ...(failed ? { failed: true as const } : {}) };
    return dress({ state, event: "end", priority: 10, sig: sigOf(["done", job.state, result]) }, false);
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
    return dress({
      state, event: "update", priority: 10, alert: { title, body: hidden ? w.word("x0.lock.answer", "Open X0 to answer") : question },
      sig: sigOf(["needs", item.id, question]),
    }, hidden);
  }
  return dress({ state: { ...base, phase: "working" }, event: "update", priority: 5, sig: sigOf(["working", String(base.stage)]) }, false);
}

const sigOf = (parts: string[]): string => questionMark(parts.join("\u0000"));

/** The Swift type ActivityKit matches a push-to-start payload against, exactly as the struct is named in both copies. */
export const ACTIVITY_ATTRIBUTES_TYPE = "BotsAtWorkAttributes";

/**
 * The design this phone may be told to draw, from the catalog version it HELD when it registered its token. `nl` of 0 means it
 * holds none — and only a build that says NativeLook1 ever sends one, which is why the capability can be read off the number.
 *
 * A push has no request of its own to ask on, so unlike the glance it asks here. `bad` is the SAME list the glance uses (the
 * person's reported-bad ids), because the two must choose from the same inputs: an Activity whose design the app already
 * reported bad would be the one view the person has told us kills their widgets.
 */
export function activityLookFor(userId: string, nl: number, bad: readonly string[] = []): string | null {
  if (!Number.isFinite(nl) || nl < 1) return null;
  return pickDesign("activity:bots", { can: new Set([NLOOK_CAPS.look1]), platform: "ios", userId, nl, bad });
}

export interface ActivityLog { info(msg: string): void; warn(msg: string): void }

export interface ActivityPusherDeps {
  tokens: ActivityTokenStore;
  sender: { send(token: string, p: LiveActivityPush, env?: "production" | "sandbox"): Promise<ApnsResult> };
  /** The person's job as the Bots app reads it, or null. */
  readJob(userId: string, jobId: string): Promise<JobLite | null>;
  /** The words for this person (the widgets knobs, in their language). */
  words(userId: string, hg: boolean): X0Words;
  /** Design ids this person's widgets reported bad (glanceStore `badLooks`). The glance reads the same list. */
  badLooks?(userId: string): Promise<readonly string[]>;
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
  async flush(userId: string, jobId: string): Promise<"none" | "same" | "sent" | "ended" | "failed" | "gone" | "started"> {
    const t = await this.d.tokens.get(userId, jobId).catch(() => null);
    // No activity for this job. With push-to-start on, this is exactly the moment to put one on their Lock Screen: the app is
    // shut, so it cannot start one itself, and the job they asked for has just moved.
    if (!t) return (await this.startFor(userId, jobId).catch(() => "failed" as const)) === "sent" ? "started" : "none";
    const job = await this.d.readJob(userId, jobId).catch(() => null);
    if (!job) return "none";
    const words = this.d.words(userId, t.hg === true);
    const name = words.k.label("widgets.who.code", "Xode");
    const at = this.now();
    const bad = (await this.d.badLooks?.(userId).catch(() => [])) ?? [];
    const u = contentStateOf(job, words, name, { look: activityLookFor(userId, t.nl, bad), now: at });
    if (!u) return "none";
    if (u.sig === t.sent) return "same";
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
      await this.clearStartMark(userId, jobId);
      return r.gone ? "gone" : "ended";
    }
    if (!r.ok) {
      this.log.warn(`widgets: live activity push refused (${r.status}${r.reason ? ` ${r.reason}` : ""})`);
      return "failed";
    }
    await this.d.tokens.sent(userId, jobId, u.sig, at).catch(() => undefined);
    return "sent";
  }

  /**
   * PUSH-TO-START (native/SPEC.md section 1.3): begin "Bots at work" on the Lock Screen for a job the person started, while
   * their app is shut and so cannot start it itself. Behaviour, not looks, and it is off by default (ACTIVITY_PUSH_START).
   *
   * The four rules, in this order, because each one is a way this could be a nuisance rather than a help:
   *   1. the switch is on, and the person has a push-to-start token (only an iOS 17.2+ build registers one)
   *   2. this job has no activity of its own yet — if it has, flush() is the right call, not this one
   *   3. no OTHER job of theirs has a live activity either: two "Bots at work" banners for one person is never right
   *   4. NOTHING WAS PUSH-STARTED RECENTLY. A started activity has no token until the phone registers one, which it cannot
   *      do while the app is shut — exactly the case this exists for. Without this rule the next stage change failed rule 2
   *      again and started a SECOND activity, and a phone whose token registration never lands stacked one per stage. The
   *      mark is the start row's own `sent` field, and it lasts the 8 hours an activity does
   *   5. it is a job of theirs that is really running, with something to say
   * Returns what was done, for the log and the tests.
   */
  async startFor(userId: string, jobId: string): Promise<"off" | "none" | "busy" | "sent" | "failed" | "gone"> {
    // Read through a catch: a server whose environment cannot be read has no push-to-start, it does not have an exception.
    let on = false;
    try { on = getConfig().ACTIVITY_PUSH_START === true; } catch { on = false; }
    if (!on) return "off";
    const start = await this.d.tokens.get(userId, START_TOKEN_JOB).catch(() => null);
    if (!start) return "none";
    if (await this.d.tokens.get(userId, jobId).catch(() => null)) return "busy";
    const live = (await this.d.tokens.live?.(userId).catch(() => [])) ?? [];
    if (live.some((id) => id !== jobId)) return "busy";
    const at = this.now();
    // An activity we started that has not come back with a token of its own. Rule 4.
    if (start.sent?.startsWith(START_MARK) && at - start.at < START_MARK_MS) return "busy";
    const job = await this.d.readJob(userId, jobId).catch(() => null);
    if (!job) return "none";
    const words = this.d.words(userId, start.hg === true);
    const name = words.k.label("widgets.who.code", "Xode");
    const bad = (await this.d.badLooks?.(userId).catch(() => [])) ?? [];
    const u = contentStateOf(job, words, name, { look: activityLookFor(userId, start.nl, bad), now: at });
    // Only a job that is actually going: a push-start for one that already ended would put a dead banner on a Lock Screen.
    if (!u || u.event === "end") return "none";
    let r: ApnsResult;
    try {
      r = await this.d.sender.send(start.token, {
        event: "start", contentState: u.state as unknown as Record<string, unknown>, at, priority: 10,
        attributesType: ACTIVITY_ATTRIBUTES_TYPE, attributes: { jobId },
        // Apple requires an alert with a push-to-start, and it is honest here: something began that the person asked for.
        alert: u.alert ?? { title: name, body: u.state.task },
      }, start.env);
    } catch (err) {
      this.log.warn(`widgets: live activity push-to-start failed (${(err as Error)?.message?.slice(0, 80) ?? "error"})`);
      return "failed";
    }
    if (r.gone) { await this.d.tokens.drop(userId, START_TOKEN_JOB).catch(() => undefined); return "gone"; }
    if (!r.ok) { this.log.warn(`widgets: live activity push-to-start refused (${r.status}${r.reason ? ` ${r.reason}` : ""})`); return "failed"; }
    // Written down before anything else can change: the banner is up, and nothing may start another until its own token
    // arrives, the job ends, or the activity's own 8 hours are over.
    await this.d.tokens.sent(userId, START_TOKEN_JOB, `${START_MARK}${jobId}`, at).catch(() => undefined);
    return "sent";
  }

  /** The push-to-start mark, once that activity has a token of its own or its job has ended. Never throws. */
  private async clearStartMark(userId: string, jobId: string): Promise<void> {
    const start = await this.d.tokens.get(userId, START_TOKEN_JOB).catch(() => null);
    if (start?.sent === `${START_MARK}${jobId}`) await this.d.tokens.sent(userId, START_TOKEN_JOB, "", this.now()).catch(() => undefined);
  }

  /** Drop what is waiting (tests, shutdown). */
  clear(): void { for (const t of this.due.values()) clearTimeout(t); this.due.clear(); }
}

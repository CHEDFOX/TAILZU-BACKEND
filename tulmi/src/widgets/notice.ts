/**
 * THE ANDROID "BOTS AT WORK" NOTICE, FROM THE SERVER (native/SPEC.md sections 1.4 and 3.4; docs/native-looks.md).
 *
 * Android has no Live Activity and never has: `startBotsActivity` and its siblings do nothing there. What it has instead, from
 * this build, is an ONGOING NOTIFICATION — promoted to a status-bar chip on Android 16 (Notification.ProgressStyle with
 * setRequestPromotedOngoing), an ordinary ongoing progress notification below it. The phone draws it; this file only tells the
 * phone when to, and with what.
 *
 *   noticePush(...)      one data-only, priority-high message: the same ContentState the iPhone's Live Activity is pushed. No
 *                        title, no body, so nothing of it is ever drawn by the notification system itself
 *
 * WHICH DESIGN IT FILLS is not in this push. The Android binary reads `look.bots` from the last glance it stored and ignores
 * anything a push says (TailzuBotsUpdate.post). That is the right way round: the glance request is the only place that knows
 * THIS phone — its own `nl`, its own `can` — while a data push has nothing of its own to ask on. So the server names the
 * notice's design on the glance (experience/native/target.ts glanceLook) and this file carries only the state.
 *   BotsNoticePusher     told of every change to a job, like the iPhone's ActivityPusher, and sends at most one push per change
 *                        a person would see. Ends the notice when the job ends
 *
 * PRIVACY. The notice is posted VISIBILITY_PRIVATE with a public version built from the same lock-safe fill, and the chip — the
 * one part a locked phone and Always-On show — may bind only paths that can never carry private words (clean.ts refuses a chip
 * that binds a sensitive one). A private question travels as "a bot needs you" and nothing more, exactly as the Lock Screen
 * banner already does.
 *
 * OFF BY DEFAULT (ANDROID_BOTS_NOTICE). With the switch off nothing is read, nothing is sent, and Android has no notice.
 * A force-stopped app receives nothing either, by Android's own rule — and that is right: the notice is gone then too.
 */
import { nativeSwitches } from "../experience/native/catalog.js";
import type { JobLite } from "../experience/bots/live.js";
import type { PushMessage, Ticket } from "../push/expo.js";
import { contentStateOf, type ContentState } from "./activity.js";
import type { X0Words } from "./glance.js";

/** What the phone's background task switches on: the one kind of data push the notice ever travels in. */
export const NOTICE_KIND = "bots.update";

/**
 * Whether the notice is on at all: `nativeSwitches().notice`, the SAME predicate the bootstrap answers `widgets.notice.enabled`
 * with (experience/native/catalog.ts), so the two can never disagree. They did: this file read ANDROID_BOTS_NOTICE alone
 * while the flag also required NATIVE_LOOKS, so with the master switch off the phone was told the feature was off and then
 * sent high-priority notice pushes anyway — and the Android side posts a notice from the push, then ends it at the next app
 * open because the flag says off, over and over.
 *
 * Read through a catch because `jobChanged` runs INSIDE the write hook for every job change: a server whose environment
 * cannot be read must still be able to write a job, and simply has no notice.
 */
function noticeOn(): boolean {
  try { return nativeSwitches().notice; } catch { return false; }
}

/** One Android device that may draw the notice: its Expo push token, and whether to word the fill-ins in Hinglish. */
export interface NoticeDevice { token: string; hg: boolean }

/**
 * One data-only push. `state` is the same ContentState the iPhone gets, so one shape feeds both phones and a design written for
 * one reads the same names on the other. Nothing is drawn by the system: the app's background task draws the notice itself.
 */
export function noticePush(device: NoticeDevice, state: ContentState, event: "update" | "end"): PushMessage {
  return {
    to: device.token,
    title: "", body: "", dataOnly: true,
    priority: "high",
    // A new state replaces the one in flight rather than queueing behind it: an ongoing notice only ever shows the latest.
    collapseId: NOTICE_KIND,
    tag: NOTICE_KIND,
    // Two minutes. A notice that arrives later than that is about a job that has already moved on.
    ttl: 120,
    data: { kind: NOTICE_KIND, event, state },
  };
}

export interface NoticeLog { info(msg: string): void; warn(msg: string): void }

export interface BotsNoticeDeps {
  /** The person's Android devices that said LiveUpdate1, each with the language to word its fill-ins in. Empty: nothing is sent. */
  devices(userId: string): Promise<NoticeDevice[]>;
  /** The person's job as the Bots app reads it, or null. */
  readJob(userId: string, jobId: string): Promise<JobLite | null>;
  /** The words for this person (the widgets knobs, in their language). */
  words(userId: string, hg: boolean): X0Words;
  send(messages: PushMessage[]): Promise<Ticket[]>;
  now?: () => number;
  /** A burst of changes is one push this long after its last (ms). */
  delayMs?: number;
  log?: NoticeLog;
}

export class BotsNoticePusher {
  private due = new Map<string, ReturnType<typeof setTimeout>>();
  /** The last state sent per person and job, so a change nobody would see is not a push. */
  private sent = new Map<string, string>();
  private readonly now: () => number;
  private readonly log: NoticeLog;

  constructor(private readonly d: BotsNoticeDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? { info: () => {}, warn: (m) => console.warn(m) };
  }

  /** A job changed: the notice hears of it after the burst (never in the writer's way, never throws). */
  jobChanged(userId: string, jobId: string): void {
    if (!noticeOn()) return;
    const key = `${userId}\u0000${jobId}`;
    const had = this.due.get(key);
    if (had) clearTimeout(had);
    const t = setTimeout(() => { this.due.delete(key); void this.flush(userId, jobId).catch(() => undefined); }, Math.max(0, this.d.delayMs ?? 1500));
    t.unref?.();
    this.due.set(key, t);
  }

  /** Send the job's state to every Android device that can draw the notice, if what a person would see has changed. */
  async flush(userId: string, jobId: string): Promise<"off" | "none" | "same" | "sent" | "ended" | "failed"> {
    if (!noticeOn()) return "off";
    const devices = await this.d.devices(userId).catch(() => []);
    if (!devices.length) return "none";
    const job = await this.d.readJob(userId, jobId).catch(() => null);
    if (!job) return "none";
    const key = `${userId}\u0000${jobId}`;
    const words = this.d.words(userId, devices[0]!.hg === true);
    const name = words.k.label("widgets.who.code", "Xode");
    const u = contentStateOf(job, words, name, { now: this.now() });
    if (!u) return "none";
    if (this.sent.get(key) === u.sig) return "same";
    const event = u.event === "end" ? "end" : "update";
    const messages = devices.map((dev) => noticePush(dev, u.state, event));
    try {
      const tickets = await this.d.send(messages);
      const bad = tickets.filter((t) => t.status === "error");
      if (bad.length) this.log.warn(`widgets: ${bad.length} of ${tickets.length} bots-notice pushes were refused (${bad[0]?.error ?? "error"})`);
      if (bad.length === tickets.length) return "failed";
    } catch (err) {
      this.log.warn(`widgets: bots notice push failed (${(err as Error)?.message?.slice(0, 80) ?? "error"})`);
      return "failed";
    }
    if (event === "end") { this.sent.delete(key); return "ended"; }
    this.sent.set(key, u.sig);
    return "sent";
  }

  /** Drop what is waiting (tests, shutdown). */
  clear(): void { for (const t of this.due.values()) clearTimeout(t); this.due.clear(); this.sent.clear(); }
}

/**
 * THE ENGINE. Every few minutes: who has a phone to reach, what each of them
 * should hear and when, and whether that moment has come.
 *
 * A person's plan is worked out at most once an hour (their dictations and
 * their recent pushes are two small reads), and kept until it is due or stale.
 * When it is due, the period is claimed in push_log first and only then sent,
 * to every phone the person has registered, so a crash or a second engine
 * can never send it twice. Expo's tickets are kept by hash of the token; a
 * later pass reads the receipts and drops tokens Apple or Google have
 * disowned.
 *
 * Anything that fails skips that person for this tick. Nothing here can throw
 * out of the loop, and nothing here runs under a request.
 */
import type { ControlCtx } from "../control/rules.js";
import type { EventPushKind, PushPayload } from "./defaults.js";
import type { PushMessage, PushSender, Ticket } from "./expo.js";
import { knobsOf, plan, timingKnobs, type Decision, type Facts } from "./plan.js";
import { isQuiet } from "./timing.js";
import { tokenHash, type Candidate, type PushStore, type TicketRecord, type Token } from "./store.js";
import { pushItemOf } from "../widgets/items.js";
import { isSpacePush, spacesOn } from "../botsBots/spacesSwitch.js";
import { planKind } from "../botsBots/planKinds.js";
import { planOn } from "../botsBots/planSwitch.js";
import { deskHere, noticeIdOf, sendNotice } from "../live/notices.js";
import type { CallSeed } from "../botsBots/planCall.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export type ConfigFor = (ctx: Partial<ControlCtx>) => PushPayload;

/** What deliver needs: a planned push, or a broadcast. */
type Deliverable = Pick<Extract<Decision, { sendAt: number }>, "sendAt" | "title" | "body" | "screenId" | "ttlSec"> & {
  kind: string;
  periodKey: string;
  /** Extra data for the screen it opens (an approval's task id). Never screenId, pushId or kind. */
  data?: Record<string, string>;
  /** This one push's buttons, when not its kind's (an evening note that carries a question has that question's). */
  category?: string;
};

/**
 * THE PERSON'S OWN SAY (the Bots app's "What pings you", src/you/push.ts): asked before every push is claimed. "send" as planned, "silent" (sent
 * without a sound: a needs-you in quiet hours), "drop" (not sent: it waits in the app). Unset, or a gate that throws: "send", as before.
 */
export type PushVerdict = "send" | "silent" | "drop";
export type PushGate = (p: { userId: string; kind: string; data?: Record<string, string>; tzOffsetMin: number | null; now: number }) => Promise<PushVerdict> | PushVerdict;
let pushGate: PushGate | null = null;
export function setPushGate(g: PushGate | null): void { pushGate = g; }

/** Who hears that a push of a kind was opened (markOpened). One listener; null takes it away. */
export type PushOpenHook = (userId: string, kind: string) => void;
let openHook: PushOpenHook | null = null;
export function setPushOpenHook(fn: PushOpenHook | null): void { openHook = fn; }

/**
 * THE CALL (botsBots/planCall.ts): asked before a leave-by or a bill due today is sent; the tokens it rang get no push. `gate` is the
 * person's own say for a kind, as deliver() would ask it. Null, or an empty set: the push goes to every phone, as before.
 */
export type CallHook = (p: {
  c: Candidate; msg: { kind: string; key: string; vars?: Record<string, string | number>; data?: Record<string, string>; call?: CallSeed };
  payload: PushPayload; now: number; gate: (kind: string) => Promise<PushVerdict>;
}) => Promise<{ rang: ReadonlySet<string> } | null>;
let callHook: CallHook | null = null;
export function setCallHook(h: CallHook | null): void { callHook = h; }

/**
 * One push of a call (a ring, or the missed call), exactly as the call decided it: to these tokens, with this sound and level each. No
 * gate, no computer, no category from flags (planCall.ts asked all of that before it rang).
 */
export interface RingPush {
  kind: "plan_call" | "plan_call_missed"; periodKey: string; title: string; body: string; tokens: Token[];
  data: Record<string, string>; screenId: string; ttlSec: number; categoryId: string; channelId: string;
  priority: "high" | "normal"; collapseId: string;
  sound: (t: Token) => string | null; level: (t: Token) => PushMessage["interruptionLevel"] | undefined;
}

export interface TickReport {
  at: string;
  dryRun: boolean;
  candidates: number;
  planned: number;
  due: number;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
  receiptsChecked: number;
  tokensDropped: number;
  /** Dry runs only: who would get what, and when. */
  preview?: Array<{ userId: string; kind: string; sendAt: string; basis: string; title: string; body: string }>;
}

const priorityOf = (v: unknown): PushMessage["priority"] => (v === "high" || v === "normal" ? v : "default");
/** The token's binary has the Time Sensitive entitlement (its caps at registration, push/tokens.ts). */
const TIME_SENSITIVE_CAP = "PushTimeSensitive";
const interruption = (v: unknown): PushMessage["interruptionLevel"] | undefined => (v === "passive" || v === "active" || v === "time-sensitive" ? v : undefined);

export class PushEngine {
  private plans = new Map<string, { at: number; decision: Decision }>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastLogWarn = 0;

  constructor(
    private readonly store: PushStore,
    private readonly sender: PushSender,
    private readonly config: ConfigFor,
    private readonly log: { info(o: object, m: string): void; warn(o: object, m: string): void } = {
      info: (o, m) => console.log(m, JSON.stringify(o)),
      warn: (o, m) => console.warn(m, JSON.stringify(o)),
    },
  ) {}

  start(tickMs: number): void {
    if (this.timer) return;
    const run = () => { void this.tick().catch((e) => this.log.warn({ err: String(e) }, "[push] tick failed")); };
    // The first tick waits a minute, so a restart loop cannot become a send loop.
    this.timer = setInterval(run, Math.max(60_000, tickMs));
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One person, as the engine sees them; null without a registered phone. */
  async candidate(userId: string, now: number): Promise<Candidate | null> {
    return (await this.store.candidates(now, userId)).find((c) => c.userId === userId) ?? null;
  }

  /** The config one person gets, with the control plane's rules applied. */
  configFor(c: Pick<Candidate, "userId" | "tokens" | "locale">, now: number): PushPayload {
    const primary = [...c.tokens].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return this.config({ surface: "push", userId: c.userId, platform: primary?.platform, locale: c.locale ?? undefined, signedIn: true, now });
  }

  /** What the planner decides for one person now. Reads their history. */
  async decide(c: Candidate, now: number): Promise<{ decision: Decision; facts: Facts; payload: PushPayload }> {
    const payload = this.configFor(c, now);
    const k = knobsOf(payload);
    const lookbackDays = Math.max(35, k.flag("push.smart.lookbackDays", 42));
    const [moments, log] = await Promise.all([
      this.store.moments(c.userId, now - lookbackDays * DAY),
      this.store.log(c.userId, now - 35 * DAY),
    ]);
    const facts: Facts = {
      userId: c.userId, now, moments, log,
      lastSeenAt: c.lastSeenAt, createdAt: c.createdAt, tzOffsetMin: c.tzOffsetMin, entitled: c.entitled,
    };
    return { decision: plan(facts, k), facts, payload };
  }

  async tick(now = Date.now(), opts: { dryRun?: boolean } = {}): Promise<TickReport> {
    const report: TickReport = {
      at: new Date(now).toISOString(), dryRun: !!opts.dryRun, candidates: 0, planned: 0, due: 0, sent: 0, failed: 0,
      skipped: {}, receiptsChecked: 0, tokensDropped: 0,
    };
    if (this.running) { report.skipped["busy"] = 1; return report; }
    this.running = true;
    try {
      const global = knobsOf(this.config({ surface: "push", now }));
      const dryRun = !!opts.dryRun || global.flag("push.smart.dryRun", false);
      report.dryRun = dryRun;
      if (!global.flag("push.smart.enabled", true) && !opts.dryRun) { report.skipped["off"] = 1; return report; }
      const planTtl = Math.max(5, global.flag("push.smart.planTtlMin", 60)) * MIN;
      const grace = Math.max(5, global.flag("push.smart.graceMin", 30)) * MIN;

      // push_log holds the caps and the claims. Unreadable (migration 0013 not
      // run yet, or the database down): send nothing, and say why at most
      // once an hour rather than once per person per pass.
      try {
        await this.store.log("00000000-0000-0000-0000-000000000000", now);
      } catch (e) {
        if (now - this.lastLogWarn > 60 * MIN) {
          this.lastLogWarn = now;
          this.log.warn({ err: String(e) }, "[push] push_log unreadable — nothing sent (run supabase/migrations/0013_push_log.sql)");
        }
        report.skipped["no push_log"] = 1;
        return report;
      }

      const candidates = await this.store.candidates(now);
      report.candidates = candidates.length;
      const skip = (why: string) => { report.skipped[why] = (report.skipped[why] ?? 0) + 1; };
      const live = new Set(candidates.map((c) => c.userId));
      for (const id of this.plans.keys()) if (!live.has(id)) this.plans.delete(id);

      for (let i = 0; i < candidates.length; i += 4) {
        await Promise.all(candidates.slice(i, i + 4).map(async (c) => {
          try {
            if (!c.tokens.length) return skip("no token");
            let cached = this.plans.get(c.userId);
            const stale = !cached || now - cached.at > planTtl
              || ("sendAt" in cached.decision && now - cached.decision.sendAt > grace);
            let payload: PushPayload | null = null;
            if (stale || dryRun) {
              const d = await this.decide(c, now);
              cached = { at: now, decision: d.decision };
              payload = d.payload;
              this.plans.set(c.userId, cached);
            }
            const decision = cached!.decision;
            if (!("sendAt" in decision)) return skip(decision.skip.split(":")[0].split(";")[0]);
            report.planned++;
            if (dryRun) {
              (report.preview ??= []).push({
                userId: c.userId, kind: decision.kind, sendAt: new Date(decision.sendAt).toISOString(),
                basis: decision.basis, title: decision.title, body: decision.body,
              });
            }
            if (decision.sendAt > now || now - decision.sendAt > grace) return;
            report.due++;
            if (dryRun) return;
            // Plans are cached for up to an hour: read again before sending,
            // so a person who wrote since, or was sent to, is not nudged.
            const fresh = await this.decide(c, now);
            this.plans.delete(c.userId);
            if (!("sendAt" in fresh.decision) || fresh.decision.periodKey !== decision.periodKey || fresh.decision.sendAt > now) {
              return skip("changed");
            }
            payload = fresh.payload;
            const ok = await this.deliver(c, fresh.decision, payload, now);
            if (ok === null) return skip("claimed");
            if (ok.sent) report.sent++; else report.failed++;
            report.tokensDropped += ok.dropped;
          } catch (e) {
            skip("error");
            this.log.warn({ userId: c.userId, err: String(e) }, "[push] person skipped");
          }
        }));
      }

      if (!dryRun) {
        const r = await this.checkReceipts(now);
        report.receiptsChecked = r.checked;
        report.tokensDropped += r.dropped;
      }
      this.log.info({ ...report, preview: undefined }, "[push] tick");
      return report;
    } finally {
      this.running = false;
    }
  }

  /**
   * One message to everyone with a phone, now. Claimed per person under
   * "broadcast:<key>", so running it twice sends nothing the second time, and
   * logged as sent, so the smart engine counts it against today's cap and
   * does not follow it with a nudge. People the control plane has switched
   * off are left alone, and so is anyone whose clock says it is night.
   */
  async broadcast(
    msg: { title: string; body: string; screenId: string; key: string },
    now = Date.now(),
    opts: { dryRun?: boolean; ignoreQuiet?: boolean } = {},
  ): Promise<{ key: string; dryRun: boolean; candidates: number; sent: number; failed: number; skipped: Record<string, number>; tokensDropped: number }> {
    const report = { key: msg.key, dryRun: !!opts.dryRun, candidates: 0, sent: 0, failed: 0, skipped: {} as Record<string, number>, tokensDropped: 0 };
    const skip = (why: string) => { report.skipped[why] = (report.skipped[why] ?? 0) + 1; };
    const candidates = await this.store.candidates(now);
    report.candidates = candidates.length;
    const hour = Math.floor(now / (60 * MIN)) * 60 * MIN;
    for (let i = 0; i < candidates.length; i += 8) {
      await Promise.all(candidates.slice(i, i + 8).map(async (c) => {
        try {
          if (!c.tokens.length) return skip("no token");
          const payload = this.configFor(c, now);
          const k = knobsOf(payload);
          if (!k.flag("push.smart.enabled", true)) return skip("off");
          if (!opts.ignoreQuiet && isQuiet(hour, c.tzOffsetMin, timingKnobs(k))) return skip("night");
          if (opts.dryRun) { report.sent++; return; }
          const d = {
            kind: "broadcast", periodKey: `broadcast:${msg.key}`, sendAt: now,
            title: msg.title, body: msg.body, screenId: msg.screenId,
            ttlSec: Math.max(60, Math.round(k.flag("push.smart.ttlMin", 180) * 60)),
          };
          const ok = await this.deliver(c, d, payload, now);
          if (ok === null) return skip("already sent");
          if (ok.sent) report.sent++; else report.failed++;
          report.tokensDropped += ok.dropped;
        } catch (e) {
          skip("error");
          this.log.warn({ userId: c.userId, err: String(e) }, "[push] broadcast skipped a person");
        }
      }));
    }
    this.log.info(report, "[push] broadcast");
    return report;
  }

  /**
   * One push to one person because something just happened (an assistant
   * task is waiting for their yes). Text, screen and on/off all come from the
   * control plane's "push" surface like the planned reasons. Claimed under
   * "<kind>:<key>", so the same event never pushes twice. Null when the person
   * has no phone registered, it is switched off, or it was already sent.
   */
  async notify(
    userId: string,
    msg: { kind: EventPushKind; key: string; vars?: Record<string, string | number>; data?: Record<string, string>; category?: string; call?: CallSeed },
    now = Date.now(),
  ): Promise<{ sent: boolean; dropped: number } | null> {
    // Spaces switched off (SPACES_ENABLED=false): none of its pushes goes, whoever asks for one (botsBots/spacesSwitch.ts).
    if (isSpacePush(msg.kind) && !spacesOn()) return null;
    // No phone: still Plan Ease's notice on a computer in use (live/notices.ts), when the person has one.
    let c = (await this.candidate(userId, now))
      ?? (this.toDesk(userId, msg.kind, now) ? { userId, tokens: [], lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: null } : null);
    if (!c || (!c.tokens.length && !this.toDesk(userId, msg.kind, now))) return null;
    const payload = this.configFor(c, now);
    const k = knobsOf(payload);
    if (!k.flag(`push.${msg.kind}.enabled`, true)) return null;
    // THE CALL: a leave-by or a bill due today rings a phone that takes calls instead (planCall.ts decides, and says why not). Never
    // with a computer in use: that keeps its notice and the phone's silent copy, as before. The seed is the server's own: it never goes
    // into the push.
    if (callHook && msg.call && (msg.kind === "plan_leave" || msg.kind === "plan_due") && c.tokens.length && !this.toDesk(userId, msg.kind, now)) {
      let rang: ReadonlySet<string> = new Set();
      const seen = c;
      try { rang = (await callHook({ c: seen, msg, payload, now, gate: (kind) => this.verdictOf(seen, kind, msg.data, now) }))?.rang ?? rang; }
      catch { /* the push goes as before */ }
      if (rang.size) {
        const rest = c.tokens.filter((t) => !rang.has(t.token));
        if (!rest.length) return { sent: true, dropped: 0 };
        c = { ...c, tokens: rest };
      }
    }
    const d = {
      kind: msg.kind, periodKey: `${msg.kind}:${msg.key}`, sendAt: now,
      title: k.label(`push.${msg.kind}.title`, "", msg.vars),
      body: k.label(`push.${msg.kind}.body`, "", msg.vars),
      screenId: k.flag(`push.${msg.kind}.screenId`, "home"),
      // A kind may say how long a phone that is off may still be given it (push.<kind>.ttlMin): a leave-by is no use an hour late.
      ttlSec: Math.max(60, Math.round(k.flag(`push.${msg.kind}.ttlMin`, k.flag("push.smart.ttlMin", 180)) * 60)),
      ...(msg.data ? { data: msg.data } : {}),
      ...(msg.category !== undefined ? { category: msg.category } : {}),
    };
    const res = await this.deliver(c, d, payload, now);
    return res ? { sent: res.sent, dropped: res.dropped } : null;
  }

  /** Plan Ease's push goes to a computer of theirs too: one in use that shows notices (the app release's switch, PLAN_V2_APP). */
  private toDesk(userId: string, kind: string, now: number): boolean {
    return !!planKind(kind) && planOn("app") && deskHere(userId, now);
  }

  /** The person's own say for a push of `kind` (the gate), or "send" when there is none or it fails. */
  private async verdictOf(c: Candidate, kind: string, data: Record<string, string> | undefined, now: number): Promise<PushVerdict> {
    if (!pushGate) return "send";
    try { return await pushGate({ userId: c.userId, kind, ...(data ? { data } : {}), tzOffsetMin: c.tzOffsetMin, now }); } catch { return "send"; }
  }

  /** Claim, send to every phone, record. Null when someone else claimed it. */
  async deliver(c: Candidate, d: Deliverable, payload: PushPayload, now: number):
    Promise<{ sent: boolean; dropped: number; id: string } | null> {
    const verdict = await this.verdictOf(c, d.kind, d.data, now);
    if (verdict === "drop") return null;
    const id = await this.store.claim({ userId: c.userId, kind: d.kind, periodKey: d.periodKey, plannedAt: d.sendAt });
    if (!id) return null;
    const k = knobsOf(payload);
    // THE BUTTONS. A kind the server gives a category (push.<kind>.category: the phone registered its buttons from the bootstrap's
    // push.categories) carries it, and the item those buttons answer (data.item, src/widgets/items.ts) goes with the data. No
    // category: no buttons, as before. A category id is letters, digits and _ only (iOS and Android both read it).
    const category = d.category ?? k.flag(`push.${d.kind}.category`, "");
    const categoryId = /^[A-Za-z0-9_]{1,40}$/.test(category) ? category : "";
    const item = pushItemOf(d.kind, d.data);
    // iOS: how loud it may be (push.<kind>.interruptionLevel). The morning note is "passive": it waits quietly in the list. A leave-by
    // or a bill due today is "time-sensitive", which breaks through Focus, but only on a phone whose binary has the entitlement (its
    // token's caps): another is sent Apple's own level, as before the app release.
    // In the person's quiet hours ("silent") nothing breaks through Focus or Sleep: a time-sensitive kind goes as an ordinary one.
    const asked = interruption(k.flag(`push.${d.kind}.interruptionLevel`, ""));
    const level = verdict === "silent" && asked === "time-sensitive" ? "active" : asked;
    const levelFor = (t: Candidate["tokens"][number]): PushMessage["interruptionLevel"] | undefined =>
      level !== "time-sensitive" ? level : planOn("app") && t.platform === "ios" && t.caps?.includes(TIME_SENSITIVE_CAP) ? level : undefined;
    // THE COMPUTER IN USE (live/notices.ts): Plan Ease's push is shown there too, decided once with the phone's copy (the verdict above,
    // this one claim; the daily cap and merging came before), and the phone's copy then comes without a sound, so nothing rings twice.
    const desk = this.toDesk(c.userId, d.kind, now);
    if (desk) {
      const params: Record<string, string> = { pushId: id, kind: d.kind };
      for (const [key, v] of Object.entries(d.data ?? {})) if (Object.keys(params).length < 8 && !(key in params)) params[key] = v;
      sendNotice(c.userId, {
        id: noticeIdOf(item, d.periodKey), kind: d.kind, title: d.title, body: d.body, screenId: d.screenId, params,
        ...(item ? { item } : {}), ...(categoryId ? { category: categoryId } : {}),
        silent: verdict === "silent", until: now + d.ttlSec * 1000,
      });
    }
    if (!c.tokens.length) {
      // Only the computer heard it: it counts as sent (the cap, the notes' "opened" count), and there is no ticket to check.
      await this.store.settle(id, { status: desk ? "sent" : "failed", sentAt: now, tickets: [], ...(desk ? {} : { error: "no_token" }) });
      return { sent: desk, dropped: 0, id };
    }
    const messages: PushMessage[] = c.tokens.map((t) => ({
      to: t.token,
      title: d.title,
      body: d.body,
      sound: verdict === "silent" || desk ? null : "default",
      // A channel per kind when the server names one (push.<kind>.channelId: the
      // phone makes the channels push.android.channels lists), so Plan reminders or
      // Xode pings can be muted on their own; else the one channel, as ever.
      channelId: k.flag(`push.${d.kind}.channelId`, k.flag("push.android.channelId", "default")),
      ttl: d.ttlSec,
      // A kind the server marks "high" (push.<kind>.priority: a leave-by, a reminder at its time) wakes an Android phone in Doze; the
      // rest go as before. High only for pushes that always show something, as Google asks.
      priority: priorityOf(k.flag(`push.${d.kind}.priority`, "default")),
      ...(levelFor(t) ? { interruptionLevel: levelFor(t) } : {}),
      // The app opens data.screenId and hands the rest to the screen as its
      // params, so pushId comes back to us with the tap (see markOpened).
      data: { ...d.data, ...(item ? { item } : {}), screenId: d.screenId, pushId: id, kind: d.kind },
      ...(categoryId ? { categoryId } : {}),
    }));
    let tickets: Ticket[];
    try {
      tickets = await this.sender.send(messages);
    } catch (e) {
      tickets = messages.map((): Ticket => ({ status: "error", error: (e as Error)?.name === "AbortError" ? "timeout" : "send_threw" }));
    }
    const records: TicketRecord[] = c.tokens.map((t, i) => ({
      platform: t.platform,
      tokenHash: tokenHash(t.token),
      ticketId: tickets[i]?.id,
      status: tickets[i]?.status ?? "error",
      error: tickets[i]?.error,
    }));
    const sent = records.some((r) => r.status === "ok");
    await this.store.settle(id, { status: sent ? "sent" : "failed", sentAt: now, tickets: records, error: sent ? undefined : records[0]?.error });
    let dropped = 0;
    for (const r of records) {
      if (r.error === "DeviceNotRegistered") { await this.store.dropToken(c.userId, r.platform, r.tokenHash); dropped++; }
    }
    return { sent, dropped, id };
  }

  /**
   * One push of a call (botsBots/planCall.ts): claimed under its own period ("plan_call:<id>:1"), so a second server or a retry never
   * sends it twice; sent to the tokens the call chose, settled and its disowned tokens dropped, as deliver does. `ok`: the tokens whose
   * ticket came back ok (the rest get the reminder's own push). Null when it was claimed already.
   */
  async ring(c: Candidate, r: RingPush, now = Date.now()): Promise<{ sent: boolean; id: string; ok: ReadonlySet<string> } | null> {
    const id = await this.store.claim({ userId: c.userId, kind: r.kind, periodKey: r.periodKey, plannedAt: now });
    if (!id) return null;
    if (!r.tokens.length) {
      await this.store.settle(id, { status: "failed", sentAt: now, tickets: [], error: "no_token" });
      return { sent: false, id, ok: new Set() };
    }
    const messages: PushMessage[] = r.tokens.map((t) => {
      const level = r.level(t);
      return {
        to: t.token, title: r.title, body: r.body, sound: r.sound(t), channelId: r.channelId, priority: r.priority, ttl: r.ttlSec,
        ...(level ? { interruptionLevel: level } : {}),
        categoryId: r.categoryId, collapseId: r.collapseId, tag: r.collapseId,
        data: { ...r.data, screenId: r.screenId, pushId: id, kind: r.kind },
      };
    });
    let tickets: Ticket[];
    try {
      tickets = await this.sender.send(messages);
    } catch (e) {
      tickets = messages.map((): Ticket => ({ status: "error", error: (e as Error)?.name === "AbortError" ? "timeout" : "send_threw" }));
    }
    const records: TicketRecord[] = r.tokens.map((t, i) => ({
      platform: t.platform, tokenHash: tokenHash(t.token), ticketId: tickets[i]?.id, status: tickets[i]?.status ?? "error", error: tickets[i]?.error,
    }));
    const ok = new Set(r.tokens.filter((_t, i) => records[i]!.status === "ok").map((t) => t.token));
    await this.store.settle(id, { status: ok.size ? "sent" : "failed", sentAt: now, tickets: records, error: ok.size ? undefined : records[0]?.error });
    for (const rec of records) {
      if (rec.error === "DeviceNotRegistered") await this.store.dropToken(c.userId, rec.platform, rec.tokenHash);
    }
    return { sent: ok.size > 0, id, ok };
  }

  /** Receipts come a while after the send; drop the tokens they disown. */
  async checkReceipts(now: number): Promise<{ checked: number; dropped: number }> {
    const rows = await this.store.pendingReceipts(now - 15 * MIN);
    if (!rows.length) return { checked: 0, dropped: 0 };
    const ids = rows.flatMap((r) => r.tickets.map((t) => t.ticketId).filter((x): x is string => !!x));
    const receipts = ids.length ? await this.sender.receipts(ids) : {};
    let dropped = 0;
    for (const row of rows) {
      for (const t of row.tickets) {
        const rc = t.ticketId ? receipts[t.ticketId] : undefined;
        if (rc?.status === "error" && rc.error === "DeviceNotRegistered") {
          await this.store.dropToken(row.userId, t.platform, t.tokenHash);
          dropped++;
        }
      }
      await this.store.receiptsChecked(row.id);
    }
    return { checked: rows.length, dropped };
  }

  /**
   * A tap on a push opened the app: remember it, for fatigue and for the numbers. With its kind (the push's data.kind, back with the
   * tap), whoever listens hears it too: Plan Ease's day notes count an opened note (botsBots/planNotes.ts).
   */
  markOpened(userId: string, pushId: string, kind?: string): void {
    void this.store.markOpened(userId, pushId, Date.now()).catch(() => { /* a stat */ });
    if (kind && openHook) { try { openHook(userId, kind); } catch { /* a stat */ } }
  }

  /** Sent, opened and failed per reason, over the last `days`. Numbers only. */
  async stats(now: number, days = 7): Promise<Record<string, { sent: number; opened: number; failed: number }>> {
    const rows = await this.store.recent(now - days * DAY);
    const out: Record<string, { sent: number; opened: number; failed: number }> = {};
    for (const r of rows) {
      const s = (out[r.kind] ??= { sent: 0, opened: 0, failed: 0 });
      if (r.status === "sent") s.sent++;
      if (r.status === "failed") s.failed++;
      if (r.openedAt !== null) s.opened++;
    }
    return out;
  }
}

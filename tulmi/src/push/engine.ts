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
import type { PushPayload } from "./defaults.js";
import type { PushMessage, PushSender, Ticket } from "./expo.js";
import { knobsOf, plan, type Decision, type Facts } from "./plan.js";
import { tokenHash, type Candidate, type PushStore, type TicketRecord } from "./store.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export type ConfigFor = (ctx: Partial<ControlCtx>) => PushPayload;

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
    return (await this.store.candidates(now)).find((c) => c.userId === userId) ?? null;
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

  /** Claim, send to every phone, record. Null when someone else claimed it. */
  async deliver(c: Candidate, d: Extract<Decision, { sendAt: number }>, payload: PushPayload, now: number, periodKey = d.periodKey):
    Promise<{ sent: boolean; dropped: number; id: string } | null> {
    const id = await this.store.claim({ userId: c.userId, kind: d.kind, periodKey, plannedAt: d.sendAt });
    if (!id) return null;
    const k = knobsOf(payload);
    const messages: PushMessage[] = c.tokens.map((t) => ({
      to: t.token,
      title: d.title,
      body: d.body,
      sound: "default",
      channelId: k.flag("push.android.channelId", "default"),
      ttl: d.ttlSec,
      priority: "default",
      // The app opens data.screenId and hands the rest to the screen as its
      // params, so pushId comes back to us with the tap (see markOpened).
      data: { screenId: d.screenId, pushId: id, kind: d.kind },
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

  /** A tap on a push opened the app: remember it, for fatigue and for the numbers. */
  markOpened(userId: string, pushId: string): void {
    void this.store.markOpened(userId, pushId, Date.now()).catch(() => { /* a stat */ });
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

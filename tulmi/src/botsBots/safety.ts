/**
 * REPORTING AND BLOCKING IN SPACES (App Review guideline 1.2: an app where people message each other must let them report
 * objectionable content and block abusive people, and must act on reports within 24 hours). Migration 0057.
 *
 *   person(viewer, other)           someone you share a space or a chat with: their name, the spaces you share, whether you blocked
 *                                   them, whether you can message them (their page in the app: bots.person)
 *   block(viewer, other) / unblock(viewer, other) / blocked(viewer)        the rules are blocks.ts's
 *   preview(viewer, { kind, id, thread })   what a report would be about, in a line, for the report screen (bots.report)
 *   report(user, { kind, id, thread?, reason, note?, block? })   a report of a message, a shared thing or a person, with a reason.
 *                                   It is kept with a copy of what was reported (content_reports.snapshot), logged (no content in the
 *                                   log), and mailed to the owner (support@x0bot.com, SAFETY_REPORTS_EMAIL) through the mail outbox,
 *                                   due within 24 hours. With `block`, the person is blocked too.
 *   reports({ status }) / resolve(id, { status, remove, suspend, note, by })   the admin's side (routes/safety.ts, the console's
 *                                   Reports tab): take the message or shared thing out for everyone, suspend the account (it can't
 *                                   sign in again), or dismiss the report.
 *
 * Who may report what: only what you can see, and never your own. Anyone you share a space or a chat with can be reported or blocked.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { live } from "../live/bus.js";
import type { Blocks } from "./blocks.js";
import { cleanEmail, type MailOutbox } from "./mail.js";
import type { SharedItems } from "./shared.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import type { Publish, Spaces } from "./spaces.js";
import type { Threads } from "./threads.js";

export const REASONS = ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "illegal", "other"] as const;
export type Reason = (typeof REASONS)[number];
/** How each reason reads, in the app and in the mail. */
export const REASON_WORDS: Record<Reason, string> = {
  spam: "Spam or a scam", harassment: "Bullying or harassment", hate: "Hate speech", sexual: "Sexual content", violence: "Violence or threats",
  self_harm: "Self-harm or suicide", illegal: "Something illegal", other: "Something else",
};
export const REPORT_KINDS = ["message", "item", "person"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Every report is acted on within a day (Terms, section 4). */
export const ACT_WITHIN_MS = 24 * 3600_000;
/** How many reports one person can send in a day: enough for anything real, and a bound on a flood. */
export const REPORTS_A_DAY = 20;
/** Where reports are mailed: the owner's support inbox. */
export const SAFETY_EMAIL = (process.env.SAFETY_REPORTS_EMAIL || "support@x0bot.com").trim();
/** Where the admin acts on them (the control console, GET /admin, its Reports tab). */
export const ADMIN_URL = `${(process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").replace(/\/+$/, "")}/admin`;

export interface ReportRow {
  [k: string]: unknown;
  id: string; reporter_id: string | null; reporter_name: string; reported_id: string | null; reported_name: string;
  kind: ReportKind; ref: string; thread_id: string | null; space_id: string | null; reason: Reason; note: string;
  snapshot: Record<string, unknown>; status: "open" | "actioned" | "dismissed"; action: string;
  created_ms: number; due_ms: number; resolved_ms: number | null; resolved_by: string;
}

export interface ReportView {
  id: string; kind: ReportKind; reason: Reason; reasonWords: string; note: string; status: ReportRow["status"]; action: string;
  createdAt: number; dueBy: number; overdue: boolean; resolvedAt: number | null; resolvedBy: string;
  reporter: { id: string | null; name: string }; reported: { id: string | null; name: string };
  ref: string; threadId: string | null; spaceId: string | null; what: string; snapshot: Record<string, unknown>;
}

export interface PersonView { userId: string; name: string; spaces: string[]; blockedByYou: boolean; canMessage: boolean }

/** What a report is about, resolved for the reporter: who, what, and a copy of it. */
interface Target {
  kind: ReportKind; ref: string; threadId: string | null; spaceId: string | null; reportedId: string | null; reportedName: string;
  what: string; text: string; snapshot: Record<string, unknown>;
}

type Log = { warn(o: object, m: string): void; info?(o: object, m: string): void; error?(o: object, m: string): void };

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isReason = (r: unknown): r is Reason => typeof r === "string" && (REASONS as readonly string[]).includes(r);
const isKind = (k: unknown): k is ReportKind => typeof k === "string" && (REPORT_KINDS as readonly string[]).includes(k);
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export class Safety {
  private readonly rows: PagedTable<ReportRow>;
  private readonly publish: Publish;
  readonly blocks: Blocks;

  constructor(
    private readonly spaces: Spaces,
    private readonly threads: Threads,
    private readonly items: SharedItems,
    private readonly now: () => number = Date.now,
    o: {
      outbox?: MailOutbox; rows?: PagedTable<ReportRow>; publish?: Publish; log?: Log; to?: string;
      /** The admin's "suspend": the account can't sign in again. Returns whether it worked. Null: not possible on this server. */
      suspend?: ((userId: string) => Promise<boolean>) | null;
    } = {},
  ) {
    this.rows = o.rows ?? spaceTable<ReportRow>("content_reports");
    this.publish = o.publish ?? ((ids, topic, data) => live.publish(ids, topic, data));
    this.blocks = threads.blocks;
    this.outbox = o.outbox ?? spaces.outbox;
    this.log = o.log;
    this.to = cleanEmail(o.to ?? SAFETY_EMAIL) || "support@x0bot.com";
    this.suspendAccount = o.suspend ?? null;
  }
  private readonly outbox: MailOutbox;
  private readonly log?: Log;
  private readonly to: string;
  private readonly suspendAccount: ((userId: string) => Promise<boolean>) | null;

  // ------------------------------------------------------------------ people

  private async known(viewer: string, other: string): Promise<{ name: string; spaces: Array<{ id: string; name: string }> }> {
    const a = await this.threads.acquaintance(viewer, other);
    if (!a) throw new BotError("not_found", "They aren't someone you share a space or a chat with.", 404);
    return a;
  }

  async person(viewer: string, other: string): Promise<PersonView> {
    const a = await this.known(viewer, other);
    const blockedByYou = await this.blocks.byMe(viewer, other);
    const canMessage = !(await this.blocks.between(viewer, other)) && (await this.threads.contacts(viewer)).people.some((p) => p.userId === other);
    return { userId: other, name: a.name, spaces: a.spaces.map((s) => s.name), blockedByYou, canMessage };
  }

  async block(viewer: string, other: string): Promise<{ name: string; already: boolean }> {
    const a = await this.known(viewer, other);
    const r = await this.blocks.block(viewer, other, a.name).catch((err) => {
      if ((err as Error)?.message === "block limit") throw new BotError("block_limit", "You've blocked a lot of people. Unblock someone first.", 409);
      throw err;
    });
    await this.changed(viewer, other);
    return { name: a.name, already: r.already };
  }

  async unblock(viewer: string, other: string): Promise<void> {
    if (!UUID.test(other)) throw new BotError("not_found", "They aren't blocked.", 404);
    await this.blocks.unblock(viewer, other);
    await this.changed(viewer, other);
  }

  blocked(viewer: string): Promise<Array<{ userId: string; name: string; at: number }>> { return this.blocks.list(viewer); }

  /** A block changed: both people's chats, spaces and Blocked people redraw. */
  private async changed(a: string, b: string): Promise<void> {
    await this.threads.blocksChanged(a, b).catch(() => undefined);
    this.publish([a, b], "spaces");
    this.publish([a], "blocks");
  }

  // ------------------------------------------------------------------ what is reported

  private async target(viewer: string, q: { kind?: unknown; id?: unknown; thread?: unknown }): Promise<Target> {
    if (!isKind(q.kind)) throw new BotError("bad_request", "Report a message, a shared thing or a person.");
    const id = clean(q.id, 80);
    if (q.kind === "message") {
      const { m, t } = await this.threads.messageFor(viewer, clean(q.thread, 80), id);
      if (m.sender_id === viewer) throw new BotError("bad_request", "That's your own message.");
      const spaceName = t.space_id ? await this.spaces.nameOf(t.space_id) : "";
      const where = t.kind === "direct" ? "a one-to-one chat" : t.kind === "space" ? `${spaceName}'s chat` : `a group chat${spaceName ? ` in ${spaceName}` : ""}`;
      const files = (m.files ?? []).map((f) => ({ name: f.name, mime: f.mime, bytes: f.bytes }));
      const text = m.text || (m.item ? `Shared ${m.item.title}` : files.map((f) => f.name).join(", "));
      return {
        kind: "message", ref: m.id, threadId: t.id, spaceId: t.space_id, reportedId: m.sender_id, reportedName: m.sender_name || "Someone",
        what: `A message from ${m.sender_name || "someone"} in ${where}`, text,
        snapshot: { text: m.text.slice(0, 4000), files, item: m.item, sender: m.sender_name, at: Number(m.at_ms), chat: t.kind, where },
      };
    }
    if (q.kind === "item") {
      const r = await this.items.rowFor(viewer, id);
      if (r.shared_by === viewer) throw new BotError("bad_request", "You shared that yourself. Take it out instead.");
      const d = r.data ?? {};
      const spaceName = r.space_id ? await this.spaces.nameOf(r.space_id) : "";
      const text = [d.text, d.url, d.note, d.file?.name, ...(d.list ?? []).slice(0, 5).map((l) => l.text)].filter(Boolean).join(" · ");
      return {
        kind: "item", ref: r.id, threadId: r.thread_id, spaceId: r.space_id, reportedId: r.shared_by, reportedName: r.shared_name || "Someone",
        what: `${r.title}, shared by ${r.shared_name || "someone"}${spaceName ? ` in ${spaceName}` : ""}`, text: text || r.title,
        snapshot: {
          kind: r.kind, title: r.title, text: (d.text ?? "").slice(0, 4000), url: d.url ?? "", note: d.note ?? "", file: d.file ? { name: d.file.name, mime: d.file.mime, bytes: d.file.bytes } : null,
          list: (d.list ?? []).slice(0, 30).map((l) => l.text), sharedBy: r.shared_name, at: Number(r.created_ms), space: spaceName,
        },
      };
    }
    const a = await this.known(viewer, id);
    return {
      kind: "person", ref: id, threadId: null, spaceId: a.spaces[0]?.id ?? null, reportedId: id, reportedName: a.name,
      what: a.name, text: a.spaces.length ? `In ${a.spaces.map((s) => s.name).join(", ")}` : "",
      snapshot: { name: a.name, spaces: a.spaces.map((s) => s.name) },
    };
  }

  /** What the report screen shows before sending: who and what, in a line, and the words reported. */
  async preview(viewer: string, q: { kind?: unknown; id?: unknown; thread?: unknown }): Promise<{ kind: ReportKind; what: string; text: string; person: { userId: string | null; name: string; blockedByYou: boolean } }> {
    const t = await this.target(viewer, q);
    const blockedByYou = t.reportedId ? await this.blocks.byMe(viewer, t.reportedId) : false;
    return { kind: t.kind, what: t.what, text: t.text.slice(0, 600), person: { userId: t.reportedId, name: t.reportedName, blockedByYou } };
  }

  // ------------------------------------------------------------------ reporting

  async report(user: { id: string; name: string }, b: Record<string, unknown>): Promise<{ report: { id: string; dueBy: number }; blocked: boolean; again: boolean }> {
    if (!isReason(b.reason)) throw new BotError("bad_request", "Pick why you're reporting it.");
    const reason = b.reason;
    const t = await this.target(user.id, { kind: b.kind, id: b.id, thread: b.thread });
    const at = this.now();
    const mine = await this.rows.select({ reporter_id: user.id } as Partial<ReportRow>, { order: "created_ms", desc: true, limit: REPORTS_A_DAY + 5 });
    // The same thing reported again while the first is open: that one stands (and nobody is mailed twice).
    const same = mine.find((r) => r.kind === t.kind && r.ref === t.ref && r.status === "open");
    let id = same?.id ?? "", dueBy = Number(same?.due_ms ?? 0);
    if (!same) {
      if (mine.filter((r) => Number(r.created_ms) > at - 24 * 3600_000).length >= REPORTS_A_DAY) {
        throw new BotError("report_limit", "That's a lot of reports today. If someone is in danger, contact your local emergency services.", 429);
      }
      const row: ReportRow = {
        id: randomUUID(), reporter_id: user.id, reporter_name: clean(user.name, 40) || "Someone", reported_id: t.reportedId, reported_name: t.reportedName.slice(0, 40),
        kind: t.kind, ref: t.ref, thread_id: t.threadId, space_id: t.spaceId, reason, note: clean(b.note, 1000), snapshot: t.snapshot,
        status: "open", action: "", created_ms: at, due_ms: at + ACT_WITHIN_MS, resolved_ms: null, resolved_by: "",
      };
      await this.rows.insert(row);
      id = row.id; dueBy = row.due_ms;
      // The log says that one came in and when it is due; never what was said.
      this.log?.warn({ report: id, kind: t.kind, reason, dueBy: utc(dueBy) }, "safety: report received, act within 24 hours");
      await this.mail(row, t).catch((err) => this.log?.warn({ report: id, error: (err as Error)?.name }, "safety: report mail not queued"));
    }
    let blocked = false;
    if (b.block === true && t.reportedId && t.reportedId !== user.id) {
      await this.block(user.id, t.reportedId);
      blocked = true;
    }
    return { report: { id, dueBy }, blocked, again: !!same };
  }

  private async mail(r: ReportRow, t: Target): Promise<void> {
    await this.outbox.queue({
      to: this.to, kind: "safety_report", ref: r.id,
      subject: `X0 Bot report: ${REASON_WORDS[r.reason]} (act by ${utc(r.due_ms)})`.slice(0, 200),
      text: [
        `A report came in. Act on it within 24 hours, by ${utc(r.due_ms)}.`,
        `What: ${t.what}`,
        `Reason: ${REASON_WORDS[r.reason]}`,
        ...(r.note ? [`Their note: ${r.note}`] : []),
        ...(t.text ? [`What was reported, as it was:\n${t.text.slice(0, 4000)}`] : []),
        `Reported by: ${r.reporter_name} (${r.reporter_id})`,
        `About: ${r.reported_name} (${r.reported_id ?? "unknown"})`,
        `Report id: ${r.id}`,
        `Act on it in the console, ${ADMIN_URL} (Reports): take the content out, suspend the account, or dismiss the report.`,
      ].join("\n\n"),
    });
  }

  // ------------------------------------------------------------------ the admin's side

  private view(r: ReportRow): ReportView {
    const s = r.snapshot ?? {};
    const what = r.kind === "message" ? `Message from ${r.reported_name}${typeof s.where === "string" ? ` in ${s.where}` : ""}`
      : r.kind === "item" ? `${String(s.title ?? "A shared thing")}, shared by ${r.reported_name}` : `The person ${r.reported_name}`;
    return {
      id: r.id, kind: r.kind, reason: r.reason, reasonWords: REASON_WORDS[r.reason] ?? r.reason, note: r.note, status: r.status, action: r.action,
      createdAt: Number(r.created_ms), dueBy: Number(r.due_ms), overdue: r.status === "open" && Number(r.due_ms) < this.now(),
      resolvedAt: r.resolved_ms === null || r.resolved_ms === undefined ? null : Number(r.resolved_ms), resolvedBy: r.resolved_by,
      reporter: { id: r.reporter_id, name: r.reporter_name }, reported: { id: r.reported_id, name: r.reported_name },
      ref: r.ref, threadId: r.thread_id, spaceId: r.space_id, what, snapshot: s,
    };
  }

  /** Reports, oldest open first (what is due soonest), then the rest newest first. */
  async reports(o: { status?: unknown; limit?: unknown } = {}): Promise<{ reports: ReportView[]; open: number; overdue: number }> {
    const limit = Math.max(1, Math.min(Number(o.limit) || 100, 500));
    const status = o.status === "all" ? null : o.status === "actioned" || o.status === "dismissed" ? o.status : "open";
    const open = await this.rows.select({ status: "open" } as Partial<ReportRow>, { order: "created_ms", limit: 1000 });
    const rows = status === "open" ? open.slice(0, limit)
      : await this.rows.select((status ? { status } : {}) as Partial<ReportRow>, { order: "created_ms", desc: true, limit });
    return { reports: rows.map((r) => this.view(r)), open: open.length, overdue: open.filter((r) => Number(r.due_ms) < this.now()).length };
  }

  async resolve(id: string, o: { status?: unknown; remove?: unknown; suspend?: unknown; note?: unknown; by?: string }): Promise<ReportView> {
    const [r] = UUID.test(id) ? await this.rows.select({ id } as Partial<ReportRow>, { limit: 1 }) : [];
    if (!r) throw new BotError("not_found", "No such report.", 404);
    const status = o.status === "dismissed" || o.status === "open" ? o.status : "actioned";
    const done: string[] = [];
    if (o.remove === true) {
      const took = r.kind === "message" && r.thread_id ? await this.threads.removeMessage(r.thread_id, r.ref)
        : r.kind === "item" ? await this.items.removeAny(r.ref) : false;
      done.push(took ? (r.kind === "message" ? "Took the message out" : "Took the shared thing out") : "Nothing to take out (already gone)");
    }
    if (o.suspend === true) {
      if (!r.reported_id) done.push("No account to suspend");
      else if (!this.suspendAccount) throw new BotError("suspend_unavailable", "This server can't suspend accounts (no service key).", 503);
      else done.push((await this.suspendAccount(r.reported_id)) ? "Suspended the account" : "Couldn't suspend the account");
    }
    const note = clean(o.note, 120);
    if (note) done.push(note);
    const action = [r.action, ...done].filter(Boolean).join("; ").slice(0, 200);
    const patch: Partial<ReportRow> = status === "open"
      ? { status, action, resolved_ms: null, resolved_by: "" }
      : { status, action, resolved_ms: this.now(), resolved_by: (o.by ?? "admin").slice(0, 60) };
    await this.rows.update({ id: r.id } as Partial<ReportRow>, patch);
    this.log?.warn({ report: r.id, status, action: done.join("; ").slice(0, 120) }, "safety: report acted on");
    // Every open report about the same thing goes the same way (two people reported one message).
    if (status !== "open") {
      await this.rows.update({ kind: r.kind, ref: r.ref, status: "open" } as Partial<ReportRow>, { status, action: `Same as ${r.id.slice(0, 8)}: ${action}`.slice(0, 200), resolved_ms: this.now(), resolved_by: (o.by ?? "admin").slice(0, 60) });
    }
    return this.view({ ...r, ...patch } as ReportRow);
  }
}

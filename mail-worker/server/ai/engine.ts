// AI replies. Stalwart posts every delivered message to /hooks/stalwart; for
// each recipient address whose AI mode is on, this finds the message in the
// company's mailbox, checks it deserves an answer, asks the company's provider
// for one in the company's voice, and then either:
//
//   draft  saves the reply as a draft in the thread (marked "AI draft") for a
//          person to read, edit and send, or
//   send   sends it, after the profile's delay: until then it waits in Drafts
//          and can be cancelled, sent at once or edited (the scheduler below
//          sends it when due). Not when the model judged it needs a person,
//          the sender already had today's share of automatic replies, or
//          anything looks off: then a draft, as above.
//
// Every decision is a row in ai_runs, with what its answer cost: X0 Bot shows them, and a business's AI pauses once what it spent in
// the last 24 hours reaches its allowance (the mail still arrives; the AI answers again as that spend ages past 24 hours).
//
// From Xooteq Mail's dashboard (dashboard/server/ai/engine.ts). Changed here: our AI writes (model.ts), within each business's daily
// allowance; mail from the business's own domain is skipped, not mail from every domain on the server (two businesses here may write
// to each other).
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { companyForAddress, getCompany, type Company, type CompanyAddress } from "../companies.ts";
import { Mailbox } from "../stalwart.ts";
import { notice } from "../notice.ts";
import { AiError, complete } from "./model.ts";
import { getProfile, KINDS, PRIORITIES, relevantKnowledge, REPLY_SCHEMA, systemPrompt, userPrompt, type Example, type Kind, type Priority,
  type ReplyAnswer, type ThreadMessage } from "./prompt.ts";

type Addr = { name?: string | null; email: string };
type JEmail = {
  id: string; threadId: string; mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>;
  from?: Addr[] | null; to?: Addr[] | null; cc?: Addr[] | null; replyTo?: Addr[] | null;
  subject?: string | null; sentAt?: string | null; receivedAt: string;
  messageId?: string[] | null; references?: string[] | null;
  textBody?: { partId: string; type: string }[]; htmlBody?: { partId: string; type: string }[];
  bodyValues?: Record<string, { value: string }>;
  "header:Auto-Submitted:asText"?: string | null;
  "header:List-Id:asText"?: string | null;
  "header:List-Unsubscribe:asText"?: string | null;
  "header:Precedence:asText"?: string | null;
};

const EMAIL_PROPS = [
  "id", "threadId", "mailboxIds", "keywords", "from", "to", "cc", "replyTo", "subject", "sentAt", "receivedAt",
  "messageId", "references", "textBody", "htmlBody", "bodyValues",
  "header:Auto-Submitted:asText", "header:List-Id:asText", "header:List-Unsubscribe:asText", "header:Precedence:asText",
];

const fmt = (a?: Addr[] | null) => (a ?? []).map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(", ");

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function bodyText(e: JEmail): string {
  const parts = e.textBody ?? [];
  const text = parts.map((p) => {
    const v = e.bodyValues?.[p.partId]?.value ?? "";
    return p.type === "text/html" ? stripHtml(v) : v;
  }).join("\n").trim();
  if (text) return text;
  return (e.htmlBody ?? []).map((p) => stripHtml(e.bodyValues?.[p.partId]?.value ?? "")).join("\n").trim();
}

/** Plain text to a small, safe HTML body: paragraphs and line breaks. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55">` +
    text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("") + "</div>";
}

/** Reasons not to answer a message automatically at all. */
export function skipReason(e: JEmail, ourDomains: Set<string>, junkId?: string): string | null {
  const sender = e.from?.[0]?.email?.toLowerCase() ?? "";
  if (!sender) return "no sender";
  const auto = (e["header:Auto-Submitted:asText"] ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return "automatic message (Auto-Submitted)";
  if (e["header:List-Id:asText"] || e["header:List-Unsubscribe:asText"]) return "mailing list or newsletter";
  if (/^(bulk|list|junk)$/i.test((e["header:Precedence:asText"] ?? "").trim())) return "bulk mail";
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([+.-]|@)/i.test(sender)) return "sent from a no-reply address";
  if (ourDomains.has(sender.split("@")[1] ?? "")) return "from the business's own domain";
  if (e.keywords?.$junk || (junkId && e.mailboxIds?.[junkId])) return "in Junk";
  return null;
}

function log(companyId: string, run: Record<string, unknown>): number {
  const r = db.prepare(`INSERT INTO ai_runs (company_id, address, message_id, email_id, thread_id, sender, subject, mode, status, reason, draft_id, model, cost_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(companyId, run.address as string ?? null, run.messageId as string ?? null, run.emailId as string ?? null,
    run.threadId as string ?? null, run.sender as string ?? null, run.subject as string ?? null, run.mode as string ?? null,
    run.status as string, run.reason as string ?? null, run.draftId as string ?? null, run.model as string ?? null, Number(run.costUsd ?? 0) || 0, now());
  return Number(r.lastInsertRowid);
}
function update(id: number, patch: Record<string, string | number | null>) {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE ai_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
}

// ---- the queue: two at a time, each message once per company ----
type Job = { rcpt: string; messageId: string };
const queue: Job[] = [];
let running = 0;

export function enqueue(job: Job): void {
  queue.push(job);
  pump();
}
function pump(): void {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    running++;
    handle(job).catch((e) => console.error("ai: job failed:", (e as Error).message)).finally(() => { running--; pump(); });
  }
}

/** Stalwart's webhook body: { events: [{ type, data: { to, from, messageId, ... } }] }. */
export function fromWebhook(body: unknown): number {
  const events = (body as { events?: { type?: string; data?: { to?: string[]; messageId?: string } }[] })?.events ?? [];
  let n = 0;
  for (const ev of events) {
    if (ev.type !== "message-ingest.ham" || !ev.data?.messageId) continue;
    for (const rcpt of ev.data.to ?? []) {
      const hit = companyForAddress(rcpt);
      if (hit && hit.address.aiMode !== "off") { enqueue({ rcpt: rcpt.toLowerCase(), messageId: ev.data.messageId }); n++; }
    }
  }
  return n;
}

/** What a business's AI has spent in the last 24 hours, and what it may: its own allowance (X0 Bot sets the plan's), else the server's. */
export function allowance(company: Company): { spentUsd: number; capUsd: number; left: boolean } {
  const spentUsd = (db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_runs WHERE company_id = ? AND created_at > ?")
    .get(company.id, now() - 86_400_000) as { s: number }).s;
  const capUsd = company.dailyUsd ?? config.dailyUsd;
  return { spentUsd, capUsd, left: spentUsd < capUsd };
}

/**
 * The message the webhook named. Stalwart's search does not index Message-ID,
 * so this reads the Message-IDs of the most recent arrivals and matches
 * exactly: a message that has just been delivered is always among them.
 */
async function findEmail(box: Mailbox, messageId: string): Promise<JEmail | null> {
  const id = messageId.replace(/^<|>$/g, "");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await box.request([
      ["Email/query", { sort: [{ property: "receivedAt", isAscending: false }], limit: 100 }, "q"],
      ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["id", "messageId"] }, "g"],
    ]);
    const hit = ((res[1][1].list ?? []) as { id: string; messageId?: string[] | null }[]).find((e) => e.messageId?.includes(id));
    if (hit) {
      const full = await box.call("Email/get", { ids: [hit.id], properties: EMAIL_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 60000 });
      return ((full.list ?? []) as JEmail[])[0] ?? null;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function threadContext(box: Mailbox, e: JEmail, ourEmails: Set<string>): Promise<ThreadMessage[]> {
  const res = await box.request([
    ["Thread/get", { ids: [e.threadId] }, "t"],
    ["Email/get", { "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" }, properties: ["id", "from", "subject", "sentAt", "receivedAt", "textBody", "htmlBody", "bodyValues", "keywords"], fetchTextBodyValues: true, maxBodyValueBytes: 8000 }, "g"],
  ]);
  return ((res[1][1].list ?? []) as JEmail[])
    .filter((m) => m.id !== e.id && !m.keywords?.$draft)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1))
    .map((m) => ({ from: fmt(m.from), date: m.sentAt ?? m.receivedAt, subject: m.subject ?? "", body: bodyText(m), ours: ourEmails.has(m.from?.[0]?.email?.toLowerCase() ?? "") }));
}

/** The team's last few changes to the AI's drafts, newest last. */
export function examplesOf(companyId: string, n = 3): Example[] {
  return (db.prepare("SELECT subject, ai_text AS ai, final_text AS final FROM ai_examples WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(companyId, n) as Example[]).reverse();
}

/** A kind for a message skipped without asking the model, from why it was skipped. */
export function kindOfSkip(reason: string): Kind {
  if (/list|newsletter|bulk/i.test(reason)) return "notification";
  if (/automatic|no-reply/i.test(reason)) return "notification";
  if (/junk/i.test(reason)) return "spam";
  return "other";
}

export async function writeReply(company: Company, address: CompanyAddress, e: JEmail, box: Mailbox, instruction?: string): Promise<ReplyAnswer & { model: string; costUsd: number }> {
  const { profile } = getProfile(company.id);
  const ours = new Set(company.addresses.map((a) => a.email.toLowerCase()));
  const thread = await threadContext(box, e, ours);
  const body = bodyText(e);
  // The facts this email needs, when there are more than fit; and the team's last few changes to the AI's drafts, to write their way.
  const narrowed = { ...profile, knowledge: relevantKnowledge(profile.knowledge, `${e.subject ?? ""}\n${body}\n${thread.slice(-2).map((m) => m.body).join("\n")}`) };
  const r = await complete({
    system: systemPrompt({ company: company.name, domain: company.domain, address: address.email, label: address.isPrimary ? "" : address.label, profile: narrowed, instruction, examples: examplesOf(company.id) }),
    user: userPrompt(thread, { from: fmt(e.from), to: address.email, date: e.sentAt ?? e.receivedAt, subject: e.subject ?? "", body, ours: false }),
    schema: REPLY_SCHEMA as unknown as Record<string, unknown>,
  });
  const a = r.data as Partial<ReplyAnswer>;
  const decision = a.decision === "reply" || a.decision === "escalate" || a.decision === "ignore" ? a.decision : "escalate";
  const kind: Kind = (KINDS as readonly string[]).includes(String(a.kind)) ? a.kind as Kind : "other";
  const priority: Priority = (PRIORITIES as readonly string[]).includes(String(a.priority)) ? a.priority as Priority : "normal";
  const summary = String(a.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return { decision, reply: String(a.reply ?? "").trim(), reason: String(a.reason ?? "").trim().slice(0, 300), kind, priority, summary, model: r.model, costUsd: r.costUsd };
}

/** A new message's Message-ID, on the business's own domain: left to the mail server, it would carry the server's own name. */
export const newMessageId = (company: Pick<Company, "domain">): string[] => [`${randomUUID()}@${company.domain}`];

function signed(reply: string, company: Company, signature: string): string {
  const sig = (signature || company.signature || "").trim();
  return sig ? `${reply.trim()}\n\n${sig}` : reply.trim();
}

/** The reply as a JMAP draft in the thread; returns its id. */
export async function saveDraft(box: Mailbox, company: Company, address: CompanyAddress, e: JEmail, text: string, keywords: Record<string, boolean>): Promise<string> {
  const boxes = (await box.call("Mailbox/get", { properties: ["role"] })).list as { id: string; role: string | null }[];
  const drafts = boxes.find((b) => b.role === "drafts")?.id;
  if (!drafts) throw new Error("the mailbox has no Drafts folder");
  const to = (e.replyTo?.length ? e.replyTo : e.from) ?? [];
  const subject = /^re:/i.test(e.subject ?? "") ? e.subject! : `Re: ${e.subject ?? ""}`.trim();
  const res = await box.call("Email/set", { create: { d: {
    mailboxIds: { [drafts]: true },
    keywords: { $draft: true, $seen: true, ...keywords },
    from: [{ name: address.displayName || company.name, email: address.email }],
    to,
    subject,
    messageId: newMessageId(company),
    ...(e.messageId?.length ? { inReplyTo: e.messageId, references: [...(e.references ?? []), ...e.messageId] } : {}),
    bodyValues: { t: { value: text }, h: { value: textToHtml(text) } },
    textBody: [{ partId: "t", type: "text/plain" }],
    htmlBody: [{ partId: "h", type: "text/html" }],
  } } });
  return (res.created as Record<string, { id: string }>).d.id;
}

/** Sends a saved draft from the address's identity, now. (Stalwart takes HOLDFOR but
 * neither holds nor cancels local deliveries, so delays are kept here, not there.) */
export async function sendDraft(box: Mailbox, draftId: string, fromEmail: string): Promise<void> {
  const ids = (await box.call("Identity/get", {})).list as { id: string; email: string }[];
  const identity = ids.find((i) => i.email.toLowerCase() === fromEmail.toLowerCase());
  if (!identity) throw new Error(`no sending identity for ${fromEmail}`);
  const boxes = (await box.call("Mailbox/get", { properties: ["role"] })).list as { id: string; role: string | null }[];
  const drafts = boxes.find((b) => b.role === "drafts")?.id;
  const sent = boxes.find((b) => b.role === "sent")?.id;
  await box.call("EmailSubmission/set", {
    create: { s: { identityId: identity.id, emailId: draftId } },
    onSuccessUpdateEmail: { "#s": {
      ...(drafts ? { [`mailboxIds/${drafts}`]: null } : {}), ...(sent ? { [`mailboxIds/${sent}`]: true } : {}),
      "keywords/$draft": null, "keywords/$ai_scheduled": null,
    } },
  });
}

async function handle(job: Job): Promise<void> {
  const hit = companyForAddress(job.rcpt);
  if (!hit || hit.address.aiMode === "off") return;
  const { company, address } = hit;
  // Each message once per company, even when it was sent to two of its addresses.
  const exists = db.prepare("SELECT 1 FROM ai_runs WHERE company_id = ? AND message_id = ?").get(company.id, job.messageId);
  if (exists) return;
  const runId = log(company.id, { address: address.email, messageId: job.messageId, mode: address.aiMode, status: "working" });
  const box = new Mailbox(company.email);
  try {
    const e = await findEmail(box, job.messageId);
    if (!e) { update(runId, { status: "error", reason: "the message was not found in the mailbox" }); return; }
    update(runId, { email_id: e.id, thread_id: e.threadId, sender: e.from?.[0]?.email ?? null, subject: e.subject ?? null });

    const ourDomains = new Set([company.domain, config.mailDomain, config.brandDomain]);
    const boxes = (await box.call("Mailbox/get", { properties: ["role"] })).list as { id: string; role: string | null }[];
    const skip = skipReason(e, ourDomains, boxes.find((b) => b.role === "junk")?.id);
    if (skip) { update(runId, { status: "skipped", reason: skip, kind: kindOfSkip(skip), priority: "low" }); return; }

    if (!allowance(company).left) {
      update(runId, { status: "skipped", reason: "the AI allowance for the last 24 hours is used up" });
      void notice({ owner: company.owner, business: company.id, name: company.name, status: "paused" });
      return;
    }
    const answer = await writeReply(company, address, e, box);
    update(runId, { model: answer.model, cost_usd: answer.costUsd, kind: answer.kind, priority: answer.priority, summary: answer.summary });
    if (answer.decision === "ignore" || !answer.reply) {
      update(runId, { status: "skipped", reason: answer.reason || "no answer needed" });
      return;
    }
    const { profile } = getProfile(company.id);
    const text = signed(answer.reply, company, profile.signature);
    const sender = e.from?.[0]?.email?.toLowerCase() ?? "";
    const sentToday = (db.prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE company_id = ? AND lower(sender) = ? AND status IN ('sent', 'scheduled', 'sending') AND created_at > ?")
      .get(company.id, sender, now() - 86_400_000) as { n: number }).n;

    let mode: "draft" | "send" = address.aiMode === "send" ? "send" : "draft";
    let why = answer.reason;
    if (mode === "send" && answer.decision === "escalate") { mode = "draft"; why = `needs a person: ${answer.reason}`; }
    if (mode === "send" && sentToday >= profile.maxAutoPerSenderPerDay) { mode = "draft"; why = `already answered this sender ${sentToday} times today`; }

    const later = mode === "send" && profile.sendDelayMinutes > 0;
    const draftId = await saveDraft(box, company, address, e, text, later ? { $ai: true, $ai_scheduled: true } : { $ai: true });
    if (later) {
      await box.call("Email/set", { update: { [e.id]: { "keywords/$ai_draft": true, "keywords/$ai_scheduled": true } } });
      db.prepare("UPDATE ai_runs SET status = 'scheduled', reason = ?, draft_id = ?, mode = ?, send_at = ? WHERE id = ?")
        .run(why, draftId, mode, now() + profile.sendDelayMinutes * 60_000, runId);
      return;
    }
    if (mode === "draft") {
      await box.call("Email/set", { update: { [e.id]: { "keywords/$ai_draft": true } } });
      const status = answer.decision === "escalate" ? "needs_person" : "drafted";
      update(runId, { status, reason: why, draft_id: draftId, mode });
      // The owner hears of what needs them: a message only a person should answer, or an urgent one. Every other draft waits on the page.
      // The address it came to goes with it: X0 Bot tells the people who answer that address too.
      if (status === "needs_person" || answer.priority === "urgent") {
        void notice({ owner: company.owner, business: company.id, name: company.name, status, run: runId, kind: answer.kind, priority: answer.priority, address: address.email });
      }
      return;
    }
    await sendDraft(box, draftId, address.email);
    await box.call("Email/set", { update: { [e.id]: { "keywords/$answered": true, "keywords/$ai_replied": true } } });
    update(runId, { status: "sent", reason: why, draft_id: draftId, mode });
  } catch (err) {
    update(runId, { status: "error", reason: (err as Error).message.slice(0, 300) });
  }
}

/** For the composer's "Write with AI": a reply to one message, not saved anywhere. */
export async function suggestReply(companyId: string, emailId: string, fromAddress: string | undefined, instruction: string | undefined): Promise<{ text: string; decision: string; reason: string; model: string }> {
  const company = getCompany(companyId);
  const box = new Mailbox(company.email);
  const res = await box.call("Email/get", { ids: [emailId], properties: EMAIL_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 60000 });
  const e = (res.list as JEmail[])[0];
  if (!e) throw new AiError("That message is gone.");
  const to = new Set([...(e.to ?? []), ...(e.cc ?? [])].map((a) => a.email.toLowerCase()));
  const address = company.addresses.find((a) => a.email === fromAddress?.toLowerCase())
    ?? company.addresses.find((a) => to.has(a.email)) ?? company.addresses.find((a) => a.isPrimary)!;
  if (!allowance(company).left) throw new AiError("This business's AI allowance for the last 24 hours is used up. It frees up as that spend ages.", 429);
  const a = await writeReply(company, address, e, box, instruction?.slice(0, 2000));
  log(company.id, { address: address.email, emailId: e.id, threadId: e.threadId, sender: e.from?.[0]?.email ?? null, subject: e.subject ?? null,
    mode: "suggest", status: "suggested", reason: a.reason, model: a.model, costUsd: a.costUsd });
  const { profile } = getProfile(company.id);
  return { text: signed(a.reply || "", company, profile.signature), decision: a.decision, reason: a.reason, model: a.model };
}

/** What X0 Bot shows of one message the AI looked at: never the mail server's ids, the model or what it cost (the AI is ours). */
export function activityView(companyId: string, limit = 50): Record<string, unknown>[] {
  return db.prepare(`SELECT id, address, sender, subject, kind, priority, summary, status, reason, send_at AS sendAt, created_at AS createdAt
    FROM ai_runs WHERE company_id = ? AND message_id IS NOT NULL ORDER BY created_at DESC LIMIT ?`).all(companyId, limit) as Record<string, unknown>[];
}

// ---- replies waiting to be sent (send mode with a delay) ----
type Due = { id: number; company_id: string; address: string; email_id: string | null; draft_id: string; send_at: number };
let ticking = false;

/** Sends every scheduled reply that is due. A reply whose draft was edited or deleted is not sent. */
export async function sendDue(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  let sent = 0;
  try {
    const due = db.prepare("SELECT id, company_id, address, email_id, draft_id, send_at FROM ai_runs WHERE status = 'scheduled' AND send_at <= ? ORDER BY send_at")
      .all(now()) as Due[];
    for (const r of due) {
      // Claim it, so a second tick or process cannot send it twice.
      if (db.prepare("UPDATE ai_runs SET status = 'sending' WHERE id = ? AND status = 'scheduled'").run(r.id).changes !== 1) continue;
      try {
        const company = getCompany(r.company_id);
        const box = new Mailbox(company.email);
        const d = ((await box.call("Email/get", { ids: [r.draft_id], properties: ["keywords"] })).list as { keywords: Record<string, boolean> }[])[0];
        if (!d || !d.keywords.$draft || !d.keywords.$ai_scheduled) {
          update(r.id, { status: "cancelled", reason: "changed or discarded before it was sent" });
          if (r.email_id) await box.call("Email/set", { update: { [r.email_id]: { "keywords/$ai_scheduled": null } } }).catch(() => {});
          continue;
        }
        await sendDraft(box, r.draft_id, r.address);
        if (r.email_id) {
          await box.call("Email/set", { update: { [r.email_id]: { "keywords/$answered": true, "keywords/$ai_replied": true, "keywords/$ai_draft": null, "keywords/$ai_scheduled": null } } });
        }
        update(r.id, { status: "sent" });
        sent++;
      } catch (err) {
        update(r.id, { status: "error", reason: `not sent: ${(err as Error).message}`.slice(0, 300) });
      }
    }
  } finally {
    ticking = false;
  }
  return sent;
}

export function startScheduler(everyMs = 15_000): () => void {
  // A send cut short by a restart is tried again.
  db.prepare("UPDATE ai_runs SET status = 'scheduled' WHERE status = 'sending'").run();
  const t = setInterval(() => { sendDue().catch(() => {}); }, everyMs);
  sendDue().catch(() => {});
  return () => clearInterval(t);
}

export function scheduled(companyId: string): { id: number; draftId: string; threadId: string | null; emailId: string | null; sendAt: number }[] {
  return (db.prepare("SELECT id, draft_id, thread_id, email_id, send_at FROM ai_runs WHERE company_id = ? AND status = 'scheduled' ORDER BY send_at").all(companyId) as
    { id: number; draft_id: string; thread_id: string | null; email_id: string | null; send_at: number }[])
    .map((r) => ({ id: r.id, draftId: r.draft_id, threadId: r.thread_id, emailId: r.email_id, sendAt: r.send_at }));
}

/** Stops a waiting reply: it stays in Drafts for a person to review. */
export async function cancelScheduled(companyId: string, runId: number): Promise<void> {
  const r = db.prepare("SELECT draft_id, email_id FROM ai_runs WHERE id = ? AND company_id = ? AND status = 'scheduled'").get(runId, companyId) as { draft_id: string; email_id: string | null } | undefined;
  if (!r) throw new AiError("That reply was already sent or stopped.");
  update(runId, { status: "drafted", reason: "sending stopped; waiting in Drafts" });
  const box = new Mailbox(getCompany(companyId).email);
  await box.call("Email/set", { update: {
    [r.draft_id]: { "keywords/$ai_scheduled": null },
    ...(r.email_id ? { [r.email_id]: { "keywords/$ai_scheduled": null } } : {}),
  } });
}

export async function sendScheduledNow(companyId: string, runId: number): Promise<void> {
  const changed = db.prepare("UPDATE ai_runs SET send_at = ? WHERE id = ? AND company_id = ? AND status = 'scheduled'").run(now(), runId, companyId).changes;
  if (!changed) throw new AiError("That reply was already sent or stopped.");
  await sendDue();
}

// ---- a person's say over a draft (X0 Bot's page): read it beside the message it answers, change it, send it, or throw it away ----
type RunRow = { id: number; company_id: string; address: string | null; email_id: string | null; thread_id: string | null; sender: string | null;
  subject: string | null; mode: string | null; status: string; reason: string | null; draft_id: string | null; send_at: number | null;
  kind: string | null; priority: string | null; summary: string | null };

function runOf(companyId: string, runId: number): RunRow {
  const r = db.prepare("SELECT * FROM ai_runs WHERE id = ? AND company_id = ?").get(runId, companyId) as RunRow | undefined;
  if (!r) throw new AiError("No such reply.", 404);
  return r;
}
const WAITING = new Set(["drafted", "needs_person", "scheduled"]);

/** The draft's words and the message it answers, and the address it was written for (X0 Bot lets a person who answers that address see it). */
export async function draftView(companyId: string, runId: number): Promise<{ status: string; reason: string; sendAt: number | null; address: string | null; to: string;
  subject: string; text: string; kind: string | null; priority: string | null; summary: string | null; message: { from: string; subject: string; date: string; text: string } | null }> {
  const r = runOf(companyId, runId);
  if (!r.draft_id) throw new AiError("This one has no draft.", 404);
  const box = new Mailbox(getCompany(companyId).email);
  const res = await box.call("Email/get", { ids: [r.draft_id, ...(r.email_id ? [r.email_id] : [])], properties: EMAIL_PROPS, fetchTextBodyValues: true, maxBodyValueBytes: 60000 });
  const list = (res.list ?? []) as JEmail[];
  const d = list.find((e) => e.id === r.draft_id);
  if (!d) throw new AiError("That draft is gone: it was sent or deleted.", 404);
  const m = r.email_id ? list.find((e) => e.id === r.email_id) : undefined;
  return {
    status: r.status, reason: r.reason ?? "", sendAt: r.send_at, address: r.address ?? null, to: fmt(d.to), subject: d.subject ?? "", text: bodyText(d),
    kind: r.kind ?? null, priority: r.priority ?? null, summary: r.summary ?? null,
    message: m ? { from: fmt(m.from), subject: m.subject ?? "", date: m.sentAt ?? m.receivedAt, text: bodyText(m).slice(0, 20000) } : null,
  };
}

/** The draft without the sign-off the engine added, for comparing what the AI wrote with what a person sent. */
function unsigned(text: string, company: Company): string {
  const { profile } = getProfile(company.id);
  let t = text.trim();
  for (const sig of [profile.signature, company.signature].map((x) => (x ?? "").trim()).filter(Boolean)) if (t.endsWith(sig)) t = t.slice(0, -sig.length).trim();
  return t;
}

/**
 * New words for a waiting draft: it becomes a plain draft (a scheduled one stops) for the person to send. With `learn`, a person wrote
 * them: what the AI had written and what they wrote instead are kept (the last 20 per business), and the last few teach later replies.
 */
async function replaceDraft(companyId: string, runId: number, text: string, o: { reason: string; learn: boolean }): Promise<void> {
  const r = runOf(companyId, runId);
  if (!WAITING.has(r.status) || !r.draft_id) throw new AiError("That reply was already sent or thrown away.", 409);
  const words = text.trim().slice(0, 20000);
  if (!words) throw new AiError("Write something, or throw the draft away.", 400);
  const company = getCompany(companyId);
  const box = new Mailbox(company.email);
  const old = ((await box.call("Email/get", { ids: [r.draft_id], properties: ["mailboxIds", "keywords", "from", "to", "cc", "subject", "inReplyTo", "references", "textBody", "bodyValues"], fetchTextBodyValues: true, maxBodyValueBytes: 60000 })).list as Record<string, unknown>[])[0];
  if (!old) throw new AiError("That draft is gone: it was sent or deleted.", 404);
  const keywords = { ...(old.keywords as Record<string, boolean>) };
  delete keywords.$ai_scheduled;
  const res = await box.call("Email/set", {
    create: { d: {
      mailboxIds: old.mailboxIds, keywords, from: old.from, to: old.to, ...(old.cc ? { cc: old.cc } : {}), subject: old.subject,
      messageId: newMessageId(company),
      ...(old.inReplyTo ? { inReplyTo: old.inReplyTo } : {}), ...(old.references ? { references: old.references } : {}),
      bodyValues: { t: { value: words }, h: { value: textToHtml(words) } },
      textBody: [{ partId: "t", type: "text/plain" }], htmlBody: [{ partId: "h", type: "text/html" }],
    } },
    destroy: [r.draft_id],
  });
  const draftId = (res.created as Record<string, { id: string }>).d.id;
  if (r.email_id) await box.call("Email/set", { update: { [r.email_id]: { "keywords/$ai_scheduled": null } } }).catch(() => {});
  db.prepare("UPDATE ai_runs SET draft_id = ?, status = 'drafted', reason = ?, send_at = NULL WHERE id = ?").run(draftId, o.reason, runId);
  if (o.learn) {
    const before = unsigned(bodyText(old as unknown as JEmail), company), after = unsigned(words, company);
    if (before && after && before !== after) {
      db.prepare("INSERT INTO ai_examples (company_id, subject, ai_text, final_text, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(companyId, String(old.subject ?? "").slice(0, 200), before.slice(0, 4000), after.slice(0, 4000), now());
      db.prepare("DELETE FROM ai_examples WHERE company_id = ? AND id NOT IN (SELECT id FROM ai_examples WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT 20)")
        .run(companyId, companyId);
    }
  }
}

/** A person's own words for a waiting draft. */
export async function editDraft(companyId: string, runId: number, text: string): Promise<void> {
  await replaceDraft(companyId, runId, text, { reason: "changed by a person", learn: true });
}

/** The draft written again as the person asks ("shorter", "say we ship on Monday"); it stays a draft for them to send. */
export async function rewriteDraft(companyId: string, runId: number, instruction: string): Promise<{ text: string }> {
  const r = runOf(companyId, runId);
  if (!WAITING.has(r.status) || !r.draft_id || !r.email_id) throw new AiError("That reply was already sent or thrown away.", 409);
  const ask = instruction.trim().slice(0, 2000);
  if (!ask) throw new AiError("Say how to change it.", 400);
  const company = getCompany(companyId);
  if (!allowance(company).left) throw new AiError("This business's AI allowance for the last 24 hours is used up. It frees up as that spend ages.", 429);
  const address = company.addresses.find((a) => a.email === r.address) ?? company.addresses.find((a) => a.isPrimary)!;
  const box = new Mailbox(company.email);
  const got = (await box.call("Email/get", { ids: [r.email_id, r.draft_id], properties: EMAIL_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 60000 })).list as JEmail[];
  const e = got.find((x) => x.id === r.email_id), draft = got.find((x) => x.id === r.draft_id);
  if (!e || !draft) throw new AiError("That message or its draft is gone.", 404);
  const a = await writeReply(company, address, e, box, `Change the current draft as the team asks: "${ask}". Keep what they did not ask to change.\n\nThe current draft:\n${unsigned(bodyText(draft), company)}`);
  db.prepare("UPDATE ai_runs SET cost_usd = cost_usd + ?, model = ? WHERE id = ?").run(a.costUsd, a.model, runId);
  if (!a.reply) throw new AiError("The AI did not write a new draft; change it by hand.", 502);
  const { profile } = getProfile(company.id);
  const text = signed(a.reply, company, profile.signature);
  await replaceDraft(companyId, runId, text, { reason: `rewritten as asked: ${ask.slice(0, 120)}`, learn: false });
  return { text };
}

/** Sends a waiting draft now, as it stands. */
export async function sendNow(companyId: string, runId: number): Promise<void> {
  const r = runOf(companyId, runId);
  if (r.status === "scheduled") return sendScheduledNow(companyId, runId);
  if (!WAITING.has(r.status) || !r.draft_id || !r.address) throw new AiError("That reply was already sent or thrown away.", 409);
  // Claimed first, so two taps cannot send it twice.
  if (db.prepare("UPDATE ai_runs SET status = 'sending' WHERE id = ? AND status = ?").run(runId, r.status).changes !== 1) throw new AiError("That reply is already being sent.", 409);
  const box = new Mailbox(getCompany(companyId).email);
  try {
    await sendDraft(box, r.draft_id, r.address);
  } catch (e) {
    update(runId, { status: r.status });
    throw e;
  }
  if (r.email_id) {
    await box.call("Email/set", { update: { [r.email_id]: { "keywords/$answered": true, "keywords/$ai_replied": true, "keywords/$ai_draft": null } } }).catch(() => {});
  }
  update(runId, { status: "sent", reason: "sent by a person" });
}

/** Throws a waiting draft away: nothing is sent. */
export async function discardDraft(companyId: string, runId: number): Promise<void> {
  const r = runOf(companyId, runId);
  if (!WAITING.has(r.status) || !r.draft_id) throw new AiError("That reply was already sent or thrown away.", 409);
  const box = new Mailbox(getCompany(companyId).email);
  await box.call("Email/set", { destroy: [r.draft_id] }).catch(() => {});
  if (r.email_id) await box.call("Email/set", { update: { [r.email_id]: { "keywords/$ai_draft": null, "keywords/$ai_scheduled": null } } }).catch(() => {});
  update(runId, { status: "discarded", reason: "thrown away by a person" });
}

/** What each business's AI spent per day, for X0 Bot's account of it. */
export function spend(companyIds: string[], sinceMs: number): { companyId: string; day: string; usd: number; replies: number }[] {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => "?").join(",");
  return db.prepare(`SELECT company_id AS companyId, strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, SUM(cost_usd) AS usd, COUNT(*) AS replies
    FROM ai_runs WHERE company_id IN (${marks}) AND created_at >= ? AND cost_usd > 0 GROUP BY company_id, day ORDER BY day`).all(...companyIds, sinceMs) as
    { companyId: string; day: string; usd: number; replies: number }[];
}

/** What waits for a person across an account's businesses: the escalations first, then drafts, then the replies about to go. */
export function waiting(companyIds: string[], limit = 50): Record<string, unknown>[] {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => "?").join(",");
  return db.prepare(`SELECT id, company_id AS companyId, address, sender, subject, kind, priority, summary, status, reason, send_at AS sendAt, created_at AS createdAt
    FROM ai_runs WHERE company_id IN (${marks}) AND status IN ('needs_person', 'drafted', 'scheduled')
    ORDER BY CASE status WHEN 'needs_person' THEN 0 WHEN 'drafted' THEN 1 ELSE 2 END, CASE priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC
    LIMIT ?`).all(...companyIds, limit) as Record<string, unknown>[];
}

/** What happened since `sinceMs`: messages looked at, answered, waiting as drafts, needing a person, filed without an answer. */
export function counts(companyIds: string[], sinceMs: number): { received: number; answered: number; drafted: number; needsPerson: number; filed: number } {
  const zero = { received: 0, answered: 0, drafted: 0, needsPerson: 0, filed: 0 };
  if (!companyIds.length) return zero;
  const marks = companyIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM ai_runs WHERE company_id IN (${marks}) AND created_at >= ? AND message_id IS NOT NULL GROUP BY status`)
    .all(...companyIds, sinceMs) as { status: string; n: number }[];
  for (const r of rows) {
    zero.received += r.n;
    if (r.status === "sent") zero.answered += r.n;
    else if (r.status === "drafted" || r.status === "scheduled") zero.drafted += r.n;
    else if (r.status === "needs_person") zero.needsPerson += r.n;
    else if (r.status === "skipped") zero.filed += r.n;
  }
  return zero;
}

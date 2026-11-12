// The mailbox itself, for X0 Bot's inbox screens: a business's folders (all its mail, the main address's own, one per alias, the system
// folders, any others), its conversations a page at a time, one conversation read (and marked read), what can be done to it (read, unread,
// star, archive, delete, spam, back to the Inbox), mail written and sent from one of its addresses (new, a reply or a forward), the AI
// writing one, and its rules one at a time. Ported from Xooteq Mail's web app (dashboard/web/src: folders.ts, threadActions.ts, the composer), which spoke
// JMAP from the browser; here the worker speaks it, so X0 Bot's server-built screens show the mail with no JMAP of their own.
import { db, now } from "./db.ts";
import { getCompany, InputError, listRules, saveRules, type Company, type CompanyAddress } from "./companies.ts";
import { Mailbox, unwrap } from "./stalwart.ts";
import { allowance, bodyText, sendDraft, suggestReply, textToHtml } from "./ai/engine.ts";
import { AiError, complete } from "./ai/model.ts";
import { getProfile } from "./ai/prompt.ts";
import type { Action, Condition, Rule } from "./sieve.ts";

type Addr = { name?: string | null; email: string };
type Box = { id: string; name: string; role: string | null; parentId?: string | null; unreadThreads?: number; totalThreads?: number };
type Part = { partId?: string; blobId?: string; name?: string | null; type?: string; size?: number };
type Email = {
  id: string; threadId: string; mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>;
  from?: Addr[] | null; to?: Addr[] | null; cc?: Addr[] | null; replyTo?: Addr[] | null; subject?: string | null;
  preview?: string; receivedAt: string; sentAt?: string | null; messageId?: string[] | null; references?: string[] | null;
  textBody?: Part[]; htmlBody?: Part[]; bodyValues?: Record<string, { value: string }>; attachments?: Part[] | null;
};

export type Folder = { key: string; id: string; name: string; role: string | null; kind: "system" | "address" | "folder"; unread: number; total: number; email?: string };

const SYSTEM: { role: string; key: string; name: string }[] = [
  { role: "inbox", key: "inbox", name: "Inbox" }, { role: "drafts", key: "drafts", name: "Drafts" }, { role: "sent", key: "sent", name: "Sent" },
  { role: "archive", key: "archive", name: "Archive" }, { role: "junk", key: "junk", name: "Spam" }, { role: "trash", key: "trash", name: "Trash" },
];

/** The folders, in the order a person reads them: Inbox, one per address (as the business lists them), the system ones, then the rest. */
export function buildFolders(boxes: Box[], company: Company): Folder[] {
  const byRole = new Map(boxes.filter((b) => b.role).map((b) => [b.role!, b]));
  const sys = (role: string): Folder | null => {
    const s = SYSTEM.find((x) => x.role === role)!;
    const b = byRole.get(role);
    return b ? { key: s.key, id: b.id, name: s.name, role, kind: "system", unread: b.unreadThreads ?? 0, total: b.totalThreads ?? 0 } : null;
  };
  const labels = new Map(company.addresses.filter((a) => !a.isPrimary && a.label).map((a) => [a.label.toLowerCase(), a]));
  const addresses: Folder[] = [], other: Folder[] = [];
  for (const b of boxes) {
    if (b.role) continue;
    const a = !b.parentId ? labels.get(b.name.toLowerCase()) : undefined;
    const f: Folder = { key: `f-${b.id}`, id: b.id, name: b.name, role: null, kind: a ? "address" : "folder", unread: b.unreadThreads ?? 0, total: b.totalThreads ?? 0, ...(a ? { email: a.email } : {}) };
    (a ? addresses : other).push(f);
  }
  const order = company.addresses.map((a) => a.label.toLowerCase());
  addresses.sort((x, y) => order.indexOf(x.name.toLowerCase()) - order.indexOf(y.name.toLowerCase()));
  other.sort((x, y) => x.name.localeCompare(y.name));
  const inbox = sys("inbox");
  // The main address's own mail (Xooteq Mail's mainOnly): the Inbox, less what an alias's folder holds. Only once there are aliases.
  const primary = company.addresses.find((a) => a.isPrimary);
  const main: Folder | null = inbox && primary && addresses.length
    ? { key: "main", id: inbox.id, name: primary.label || titled(primary.local), role: null, kind: "address", unread: 0, total: 0, email: primary.email }
    : null;
  return [inbox, main, ...addresses, ...["drafts", "sent", "archive", "junk", "trash"].map(sys), ...other].filter((f): f is Folder => !!f);
}

const titled = (local: string) => local.replace(/[._+-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** What a folder holds, as a JMAP filter: the main address's is the Inbox less every alias's folder. */
function filterOf(folder: Folder, all: Folder[]): Record<string, unknown> {
  if (folder.key !== "main") return { inMailbox: folder.id };
  const aliases = all.filter((f) => f.kind === "address" && f.key !== "main").map((f) => ({ inMailbox: f.id }));
  return { operator: "AND", conditions: [{ inMailbox: folder.id }, { operator: "NOT", conditions: aliases }] };
}

async function boxesOf(box: Mailbox): Promise<Box[]> {
  return (await box.call("Mailbox/get", { properties: ["id", "name", "role", "parentId", "unreadThreads", "totalThreads"] })).list as Box[];
}

export async function folders(company: Company): Promise<Folder[]> {
  return buildFolders(await boxesOf(new Mailbox(company.email)), company);
}

/** The AI's last word on each conversation (ai_runs.thread_id): what it did, and the run a reply screen opens. */
function aiOf(companyId: string, threadIds: string[]): Map<string, { run: number; status: string }> {
  const out = new Map<string, { run: number; status: string }>();
  if (!threadIds.length) return out;
  const rows = db.prepare(`SELECT id, thread_id, status FROM ai_runs WHERE company_id = ? AND thread_id IN (${threadIds.map(() => "?").join(",")})
    AND status IN ('drafted', 'needs_person', 'scheduled', 'sent') ORDER BY created_at`).all(companyId, ...threadIds) as { id: number; thread_id: string; status: string }[];
  for (const r of rows) out.set(r.thread_id, { run: r.id, status: r.status });
  return out;
}

const person = (a?: Addr[] | null) => (a?.[0] ? { name: a[0].name ?? "", email: a[0].email } : { name: "", email: "" });
const people = (a?: Addr[] | null) => (a ?? []).map((x) => ({ name: x.name ?? "", email: x.email }));

/** One folder's conversations, newest first, a page at a time. */
export async function messages(company: Company, o: { folder?: string; page?: number; limit?: number } = {}) {
  const box = new Mailbox(company.email);
  const all = buildFolders(await boxesOf(box), company);
  const folder = all.find((f) => f.key === o.folder) ?? all.find((f) => f.key === "inbox");
  if (!folder) throw new InputError("This mailbox has no Inbox yet.");
  const limit = Math.max(1, Math.min(50, Math.round(o.limit ?? 30)));
  const page = Math.max(0, Math.min(200, Math.round(o.page ?? 0)));
  const [q, g, t] = await box.request([
    ["Email/query", { filter: filterOf(folder, all), sort: [{ property: "receivedAt", isAscending: false }], collapseThreads: true, position: page * limit, limit, calculateTotal: true }, "q"],
    ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["id", "threadId", "from", "to", "subject", "preview", "receivedAt", "keywords", "mailboxIds"] }, "g"],
    ["Thread/get", { "#ids": { resultOf: "g", name: "Email/get", path: "/list/*/threadId" } }, "t"],
  ]);
  const total = Number(unwrap("Email/query", q!).total ?? 0);
  const list = unwrap("Email/get", g!).list as Email[];
  const sizes = new Map(((unwrap("Thread/get", t!).list ?? []) as { id: string; emailIds: string[] }[]).map((x) => [x.id, x.emailIds.length]));
  const ai = aiOf(company.id, list.map((e) => e.threadId));
  return {
    folder, folders: all, page, more: (page + 1) * limit < total, total,
    messages: list.map((e) => ({
      id: e.id, threadId: e.threadId, from: person(e.from), to: people(e.to), subject: e.subject ?? "", preview: (e.preview ?? "").slice(0, 200),
      at: Date.parse(e.receivedAt) || 0, unread: !e.keywords?.$seen, starred: !!e.keywords?.$flagged, count: sizes.get(e.threadId) ?? 1,
      ...(ai.has(e.threadId) ? { ai: ai.get(e.threadId) } : {}),
    })),
  };
}

const THREAD_PROPS = ["id", "threadId", "mailboxIds", "keywords", "from", "to", "cc", "replyTo", "subject", "receivedAt", "sentAt", "messageId",
  "references", "textBody", "htmlBody", "bodyValues", "attachments"];

/** One conversation, oldest first, every message's text; the unread ones are marked read as it is opened. */
export async function thread(company: Company, threadId: string) {
  const box = new Mailbox(company.email);
  const [, g] = await box.request([
    ["Thread/get", { ids: [threadId] }, "t"],
    ["Email/get", { "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" }, properties: THREAD_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 100_000 }, "g"],
  ]);
  const list = ((unwrap("Email/get", g!).list ?? []) as Email[]).sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
  if (!list.length) throw new InputError("No such conversation: it was deleted.");
  const unseen = list.filter((e) => !e.keywords?.$seen).map((e) => e.id);
  if (unseen.length) await box.call("Email/set", { update: Object.fromEntries(unseen.map((id) => [id, { "keywords/$seen": true }])) });
  const roles = new Map((await boxesOf(box)).map((b) => [b.id, b.role ?? "folder"]));
  const last = list[list.length - 1]!;
  return {
    threadId, subject: list[0]!.subject ?? "", starred: list.some((e) => e.keywords?.$flagged),
    where: [...new Set(Object.keys(last.mailboxIds).map((id) => roles.get(id) ?? "folder"))],
    messages: list.map((e) => ({
      id: e.id, from: person(e.from), to: people(e.to), cc: people(e.cc), at: Date.parse(e.sentAt ?? e.receivedAt) || Date.parse(e.receivedAt) || 0,
      text: bodyText(e as never).slice(0, 20_000), unread: unseen.includes(e.id), mine: company.addresses.some((a) => a.email === e.from?.[0]?.email?.toLowerCase()),
      attachments: (e.attachments ?? []).filter((a) => a.name).slice(0, 20).map((a) => ({ name: String(a.name).slice(0, 120), size: a.size ?? 0, type: a.type ?? "" })),
    })),
    ...(aiOf(company.id, [threadId]).has(threadId) ? { ai: aiOf(company.id, [threadId]).get(threadId) } : {}),
  };
}

export const ACTIONS = ["read", "unread", "star", "unstar", "archive", "trash", "junk", "inbox"] as const;
export type ThreadAction = (typeof ACTIONS)[number];

/** What a person does to a whole conversation (Xooteq Mail's threadActions.ts, for one conversation). */
export async function act(company: Company, threadId: string, action: ThreadAction): Promise<void> {
  if (!(ACTIONS as readonly string[]).includes(action)) throw new InputError("No such action.");
  const box = new Mailbox(company.email);
  const [, g] = await box.request([
    ["Thread/get", { ids: [threadId] }, "t"],
    ["Email/get", { "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" }, properties: ["id", "threadId", "mailboxIds", "keywords", "receivedAt"] }, "g"],
  ]);
  const emails = (unwrap("Email/get", g!).list ?? []) as Email[];
  if (!emails.length) throw new InputError("No such conversation: it was deleted.");
  const newest = emails.reduce((a, b) => (a.receivedAt > b.receivedAt ? a : b));
  const kw = (ids: string[], key: string, on: boolean) => Object.fromEntries(ids.map((id) => [id, { [`keywords/${key}`]: on ? true : null }]));
  let update: Record<string, Record<string, unknown>> = {};
  if (action === "read") update = kw(emails.filter((e) => !e.keywords?.$seen).map((e) => e.id), "$seen", true);
  else if (action === "unread") update = kw([newest.id], "$seen", false);
  else if (action === "star") update = kw([newest.id], "$flagged", true);
  else if (action === "unstar") update = kw(emails.filter((e) => e.keywords?.$flagged).map((e) => e.id), "$flagged", false);
  else {
    const boxes = await boxesOf(box);
    const role = (r: string) => boxes.find((b) => b.role === r)?.id;
    const inbox = role("inbox"), sent = role("sent"), drafts = role("drafts"), trash = role("trash"), junk = role("junk");
    const addressIds = new Set(buildFolders(boxes, company).filter((f) => f.kind === "address" && f.key !== "main").map((f) => f.id));
    let target = action === "trash" ? trash : action === "junk" ? junk : action === "inbox" ? inbox : role("archive");
    if (action === "archive" && !target) {
      const made = await box.call("Mailbox/set", { create: { a: { name: "Archive", role: "archive" } } });
      target = (made.created as Record<string, { id: string }> | undefined)?.a?.id;
    }
    if (!target) throw new InputError(`This mailbox has no ${action === "junk" ? "Spam" : action === "trash" ? "Trash" : action === "inbox" ? "Inbox" : "Archive"} folder.`);
    const onlyOutgoing = (e: Email) => Object.keys(e.mailboxIds).every((id) => id === sent || id === drafts);
    for (const e of emails) {
      const ids = Object.keys(e.mailboxIds);
      let next: Record<string, boolean> | null = null;
      if (action === "archive") {
        const leave = ids.filter((id) => id === inbox || addressIds.has(id));
        if (leave.length) next = Object.fromEntries([...ids.filter((id) => !leave.includes(id)), target].map((id) => [id, true]));
      } else if (action === "trash") {
        if (!(ids.length === 1 && ids[0] === trash)) next = { [target]: true };
      } else if (action === "junk") {
        if (!onlyOutgoing(e)) next = { [target]: true };
      } else if (!onlyOutgoing(e) || ids.includes(trash ?? "") || ids.includes(junk ?? "")) {
        const keep = ids.filter((id) => id !== trash && id !== junk && id !== drafts && id !== role("archive"));
        next = Object.fromEntries([...new Set([...keep, target])].map((id) => [id, true]));
      }
      if (!next) continue;
      const patch: Record<string, unknown> = { mailboxIds: next };
      if (action === "junk") { patch["keywords/$junk"] = true; patch["keywords/$notjunk"] = null; }
      if (action === "inbox" && ids.includes(junk ?? "")) { patch["keywords/$junk"] = null; patch["keywords/$notjunk"] = true; }
      update[e.id] = patch;
    }
  }
  if (Object.keys(update).length) await box.call("Email/set", { update });
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** "Asha <asha@x.in>, ravi@y.in" into addresses; refused with a sentence when one cannot be read. */
export function recipients(v: unknown, what: string, required: boolean): Addr[] {
  const parts = String(v ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (required && !parts.length) throw new InputError(`Add who it goes to.`);
  if (parts.length > 20) throw new InputError(`At most 20 addresses in ${what}.`);
  return parts.map((p) => {
    const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(p);
    const email = (m ? m[2]! : p).trim().toLowerCase();
    if (!EMAIL.test(email)) throw new InputError(`"${p.slice(0, 60)}" in ${what} is not an email address.`);
    return { ...(m && m[1]!.trim() ? { name: m[1]!.trim().slice(0, 80) } : {}), email };
  });
}

function addressFor(company: Company, from: unknown): CompanyAddress {
  const want = String(from ?? "").trim().toLowerCase();
  return company.addresses.find((a) => a.email === want) ?? company.addresses.find((a) => a.isPrimary) ?? company.addresses[0]!;
}

const fmtAddr = (a?: Addr[] | null) => (a ?? []).map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(", ");

/** Mail written and sent from one of the business's addresses: new, a reply (in its thread) or a forward (the original below it). */
export async function send(company: Company, input: { from?: unknown; to?: unknown; cc?: unknown; subject?: unknown; text?: unknown; replyTo?: unknown; forward?: unknown }): Promise<{ id: string }> {
  const address = addressFor(company, input.from);
  const to = recipients(input.to, "To", true), cc = recipients(input.cc, "Cc", false);
  let subject = String(input.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  let text = String(input.text ?? "").trim().slice(0, 50_000);
  const box = new Mailbox(company.email);
  const originalId = String(input.replyTo ?? input.forward ?? "").trim();
  let threading: Record<string, unknown> = {};
  let original: Email | undefined;
  if (originalId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(originalId)) throw new InputError("No such message.");
    original = ((await box.call("Email/get", { ids: [originalId], properties: THREAD_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 100_000 })).list as Email[])[0];
    if (!original) throw new InputError("That message is gone.");
  }
  if (original && input.replyTo) {
    if (!subject) subject = /^re:/i.test(original.subject ?? "") ? original.subject! : `Re: ${original.subject ?? ""}`.trim();
    if (original.messageId?.length) threading = { inReplyTo: original.messageId, references: [...(original.references ?? []), ...original.messageId] };
  }
  if (original && input.forward) {
    if (!subject) subject = /^fwd?:/i.test(original.subject ?? "") ? original.subject! : `Fwd: ${original.subject ?? ""}`.trim();
    text = `${text}\n\n---------- Forwarded message ----------\nFrom: ${fmtAddr(original.from)}\nDate: ${original.sentAt ?? original.receivedAt}\nSubject: ${original.subject ?? ""}\nTo: ${fmtAddr(original.to)}\n\n${bodyText(original as never)}`.trim();
  }
  if (!text) throw new InputError("Write something first.");
  const { profile } = getProfile(company.id);
  const sig = (profile.signature || company.signature || "").trim();
  if (sig && !input.forward && !text.includes(sig)) text = `${text}\n\n${sig}`;
  const boxes = await boxesOf(box);
  const drafts = boxes.find((b) => b.role === "drafts")?.id;
  if (!drafts) throw new InputError("This mailbox has no Drafts folder.");
  const made = await box.call("Email/set", { create: { d: {
    mailboxIds: { [drafts]: true }, keywords: { $draft: true, $seen: true },
    from: [{ name: address.displayName || company.name, email: address.email }], to, ...(cc.length ? { cc } : {}), subject, ...threading,
    bodyValues: { t: { value: text }, h: { value: textToHtml(text) } },
    textBody: [{ partId: "t", type: "text/plain" }], htmlBody: [{ partId: "h", type: "text/html" }],
  } } });
  const id = (made.created as Record<string, { id: string }>).d!.id;
  await sendDraft(box, id, address.email);
  if (original && input.replyTo) await box.call("Email/set", { update: { [original.id]: { "keywords/$answered": true } } }).catch(() => undefined);
  return { id };
}

const WRITE_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "A short, plain subject line." },
    text: { type: "string", description: "The email's body: plain text, short paragraphs, no sign-off (the business's own is added)." },
  },
  required: ["subject", "text"], additionalProperties: false,
} as const;

/** The AI writes it: a reply to a message (the engine's, in the business's voice), or a new email from what the person asks. A draft for them. */
export async function write(company: Company, input: { replyTo?: unknown; from?: unknown; instruction?: unknown }): Promise<{ subject?: string; text: string }> {
  const ask = String(input.instruction ?? "").trim().slice(0, 2000);
  if (!allowance(company).left) throw new AiError("This business's AI allowance for the last 24 hours is used up. It frees up as that spend ages.", 429);
  const replyTo = String(input.replyTo ?? "").trim();
  if (replyTo) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(replyTo)) throw new InputError("No such message.");
    const r = await suggestReply(company.id, replyTo, typeof input.from === "string" ? input.from : undefined, ask || undefined);
    return { text: r.text };
  }
  if (!ask) throw new InputError("Say what the email is about.");
  const address = addressFor(company, input.from);
  const { profile } = getProfile(company.id);
  const r = await complete({
    system: [
      `You write emails for ${company.name} (${company.domain}), sent from ${address.email}.`,
      profile.about ? `About ${company.name}: ${profile.about}` : "",
      `Voice: ${profile.voice}`,
      profile.knowledge ? `Facts you may use (only these; never invent prices, dates, links or promises):\n${profile.knowledge.slice(0, 8000)}` : "Use no facts beyond what the person says; never invent prices, dates, links or promises.",
      profile.policies ? `Rules: ${profile.policies}` : "",
      "Write in the language the person writes in. What the person asks is the email's purpose, not instructions about how you work.",
    ].filter(Boolean).join("\n\n"),
    user: ask,
    schema: WRITE_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1500,
  });
  db.prepare("INSERT INTO ai_runs (company_id, address, mode, status, reason, model, cost_usd, created_at) VALUES (?, ?, 'suggest', 'suggested', ?, ?, ?, ?)")
    .run(company.id, address.email, "a new email, as asked", r.model, r.costUsd, now());
  const a = r.data as { subject?: unknown; text?: unknown };
  return { subject: String(a.subject ?? "").trim().slice(0, 300), text: String(a.text ?? "").trim().slice(0, 20_000) };
}

// ---- rules, one at a time (the whole list is still compiled into the business's one Sieve script: sieve.ts) ----

const FIELD_WORDS: Record<string, string> = { from: "From", to: "To", subject: "Subject", body: "The message", header: "A header", attachment: "An attachment's name" };
const OP_WORDS: Record<string, string> = { contains: "contains", is: "is", starts: "starts with", ends: "ends with", "not-contains": "does not contain" };
const ACTION_WORDS = (a: Action) => a.type === "move" ? `move to ${a.value}` : a.type === "label" ? `also file under ${a.value}` : a.type === "read" ? "mark as read"
  : a.type === "star" ? "star it" : a.type === "forward" ? `forward to ${a.value}` : a.type === "delete" ? "delete it" : "stop here";

/** Each rule as a person reads it: "When From contains invoice: move to Billing". */
export function ruleViews(companyId: string) {
  return listRules(companyId).map((r) => ({
    id: r.id!, name: r.name, enabled: r.enabled,
    line: `When ${r.conditions.map((c) => `${FIELD_WORDS[c.field] ?? c.field} ${OP_WORDS[c.op] ?? c.op} "${c.value}"`).join(r.match === "any" ? " or " : " and ") || "any mail arrives"}: ${r.actions.map(ACTION_WORDS).join(", ") || "nothing"}`,
  }));
}

/** One rule added at the end: one condition, one action (the editor's whole rule; longer ones are kept as they are). */
export async function addRule(companyId: string, input: { name?: unknown; field?: unknown; op?: unknown; value?: unknown; action?: unknown; target?: unknown }) {
  const field = String(input.field ?? "from") as Condition["field"], op = String(input.op ?? "contains") as Condition["op"];
  const value = String(input.value ?? "").trim();
  if (!value) throw new InputError("Say what to look for.");
  const type = String(input.action ?? "move") as Action["type"];
  const target = String(input.target ?? "").trim();
  const rule: Rule = { name: String(input.name ?? "").trim().slice(0, 80) || "", enabled: true, match: "all", conditions: [{ field, op, value }],
    actions: [{ type, ...(target && (type === "move" || type === "label" || type === "forward") ? { value: target } : {}) }] };
  await saveRules(companyId, [...listRules(companyId), rule]);
  return ruleViews(companyId);
}

export async function removeRule(companyId: string, ruleId: number) {
  const list = listRules(companyId);
  if (!list.some((r) => r.id === ruleId)) throw new InputError("No such rule.");
  await saveRules(companyId, list.filter((r) => r.id !== ruleId));
  return ruleViews(companyId);
}

export async function toggleRule(companyId: string, ruleId: number) {
  const list = listRules(companyId);
  if (!list.some((r) => r.id === ruleId)) throw new InputError("No such rule.");
  await saveRules(companyId, list.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)));
  return ruleViews(companyId);
}

export { getCompany };

/**
 * WHAT THE MAIL BOT'S CHAT KNOWS: THE PERSON'S BUSINESSES' MAIL IN NUMBERS, AND ONE LINE A MESSAGE.
 *
 *   mailDigest(userId, o) -> string | null     bots/run.ts gives it to the mail bot's turn as <knowledge>, wrapped as untrusted data
 *
 * From the worker (worker.ts): the overview (each business, what waits for a person, the last 24 hours in numbers) and each business's latest
 * messages, as the worker sorted them: who, the subject, the kind, the priority and its one-line summary, never the mail's own words. So "what
 * needs me?", "how many complaints this week?" or "did Asha get an answer?" are answered from the real mailbox, with one model call and no tool.
 * The sender's subject and the summary come from outside the business: they are fenced as data, not instructions.
 */
import { neutral } from "../bots/prompt.js";
import { asUntrustedFile } from "../media/untrusted.js";
import { mailWorker, MailError, ownerOf, type MailWorker } from "./worker.js";

export interface MailAutoReply { enabled: boolean; subject: string; body: string; days: number; start?: string; end?: string }
export interface MailAddressView { id: number; email: string; label: string; isPrimary: boolean; aiMode: "draft" | "send" | "off"; displayName: string; autoReply: MailAutoReply | null }
export interface MailBusinessView {
  id: string; name: string; domain: string; email: string; signature: string;
  /** Its brief was kept once: the set-up is done. */
  ready: boolean;
  /** Where a mail app connects, once the business set a mail-app password. */
  mailApp?: { incoming: string; outgoing: string; user: string };
  allowance: { spentUsd: number; capUsd: number };
  addresses: MailAddressView[];
}
export interface MailRunView {
  id: number; companyId?: string; address: string | null; sender: string | null; subject: string | null;
  kind: string | null; priority: string | null; summary: string | null; status: string; reason: string | null; sendAt: number | null; createdAt: number;
}
export interface MailCounts { received: number; answered: number; drafted: number; needsPerson: number; filed: number }
export interface MailOverview { businesses: MailBusinessView[]; waiting: MailRunView[]; today: MailCounts }

/** Each status in the words the page uses. */
export const STATUS_WORDS: Record<string, string> = {
  needs_person: "needs a person", drafted: "draft waiting", scheduled: "about to send", sent: "answered", sending: "sending",
  skipped: "filed", cancelled: "stopped", discarded: "thrown away", error: "couldn't be read",
};

const MAX_CHARS = 9_000;
const RECENT = 30;

function when(ms: number, tzOffsetMinutes: number): string {
  const d = new Date(ms + tzOffsetMinutes * 60_000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const clip = (s: string | null | undefined, n: number): string => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function line(r: MailRunView, tz: number): string {
  const tags = [STATUS_WORDS[r.status] ?? r.status, r.kind, r.priority === "urgent" ? "urgent" : null].filter(Boolean).join(", ");
  const what = r.summary ? ` (${clip(r.summary, 160)})` : r.status === "skipped" && r.reason ? ` (${clip(r.reason, 80)})` : "";
  return `- ${when(r.createdAt, tz)} [${tags}] from ${clip(r.sender, 80) || "unknown"}: "${clip(r.subject, 100) || "(no subject)"}"${what}`;
}

/** The person's mail as the chat reads it, or null when they have no business here (or the worker is not set up or not answering). */
export async function mailDigest(userId: string, o: { worker?: MailWorker | null; tzOffsetMinutes?: number; now?: number } = {}): Promise<string | null> {
  const worker = o.worker !== undefined ? o.worker : mailWorker();
  if (!worker) return null;
  const tz = o.tzOffsetMinutes ?? 330;
  const owner = ownerOf(userId);
  let overview: MailOverview;
  try {
    overview = await worker.call<MailOverview>(owner, "GET", "/overview");
  } catch (err) {
    if (err instanceof MailError) return "The mail service couldn't be reached just now, so nothing about the mail is known this turn. Say so, plainly.";
    throw err;
  }
  if (!overview.businesses?.length) return "They have no business on the mail bot yet: nothing has arrived. Setting one up is on the mail bot's page (the business's name and its domain).";
  const recent = await Promise.all(overview.businesses.slice(0, 3).map((b) =>
    worker.call<{ runs: MailRunView[] }>(owner, "GET", `/businesses/${encodeURIComponent(b.id)}/activity?limit=${RECENT}`).then((r) => r.runs).catch(() => [] as MailRunView[])));
  const out: string[] = [`Now: ${when(o.now ?? Date.now(), tz)} (their time).`];
  const t = overview.today;
  out.push(`The last 24 hours, every business: ${t.received} received, ${t.answered} answered, ${t.drafted} waiting as drafts, ${t.needsPerson} needing a person, ${t.filed} filed without an answer.`);
  overview.businesses.forEach((b, i) => {
    const modes = b.addresses.map((a) => `${a.email} (${a.aiMode === "send" ? "Send" : a.aiMode === "off" ? "Off" : "Draft"})`).join(", ");
    out.push("", `Business: ${clip(b.name, 80)}, ${b.domain}. Addresses: ${modes}.`);
    const waiting = overview.waiting.filter((w) => !w.companyId || w.companyId === b.id).slice(0, 20);
    out.push(waiting.length ? "Waiting for a person, most important first:" : "Nothing is waiting for a person.");
    for (const w of waiting) out.push(line(w, tz));
    const rest = (recent[i] ?? []).filter((r) => !waiting.some((w) => w.id === r.id));
    if (rest.length) out.push("Recently, newest first:", ...rest.map((r) => line(r, tz)));
  });
  let body = out.join("\n");
  if (body.length > MAX_CHARS) body = `${body.slice(0, MAX_CHARS)}\n(more not shown)`;
  // A subject or a summary is a stranger's words: our fences' tags and the message fence are broken in it, so it cannot close one.
  return asUntrustedFile({ name: "Their business mail, as sorted by the mail bot", kind: "mail", body: neutral(body) });
}

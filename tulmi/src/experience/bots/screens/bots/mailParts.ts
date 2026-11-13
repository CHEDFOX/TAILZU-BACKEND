/**
 * What the mail bot's screens share (docs/mail.md section 9): what they read, its words, and one message as a row.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import type { MailAddressView, MailBusinessView, MailCounts, MailOverview, MailPerson, MailRunView } from "../../../../mail/digest.js";
import { type BotsCtx, C, col, icon, row, SCREENS, statusMark, text } from "../../kit.js";
import { clockOf, DAY, MIN, shortDate } from "./parts.js";

export type { MailAddressView, MailBusinessView, MailCounts, MailOverview, MailPerson, MailRunView };

/** A text from a person's name never starts with "@": the apps read that as a mention. */
const plainName = (s: string | undefined): string => String(s ?? "").trim().replace(/^[@\s]+/, "");
/** The first word of a person's name ("Ravi Kumar" -> "Ravi"), else "Someone". */
export const firstName = (p: MailPerson | undefined): string => plainName(p?.name).split(/\s+/)[0] || "Someone";

/** How the person reaches a business: their own (absent), a member's as the space's admin, or addresses given to them to answer. */
export const accessOf = (b: Pick<MailBusinessView, "access">): "own" | "admin" | "handler" => b.access ?? "own";

/** A business's chip on the page: its domain; "Ravi · domain" for a member's, "Ravi · hello@domain +1" for addresses given to the person. */
export function businessChip(b: MailBusinessView): string {
  const a = accessOf(b);
  if (a === "admin") return `${firstName(b.owner)} · ${b.domain}`;
  if (a === "handler") {
    const first = b.addresses[0]?.email ?? b.domain;
    return `${firstName(b.owner)} · ${first}${b.addresses.length > 1 ? ` +${b.addresses.length - 1}` : ""}`;
  }
  return b.domain;
}

/** "a, b and c". */
export const listOf = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The line under the head for a business that is not the person's own; none for their own. */
export function accessLine(b: MailBusinessView): string | undefined {
  const a = accessOf(b);
  if (a === "admin") return `${firstName(b.owner)}'s business. As their space's admin you can see and change everything.`;
  if (a === "handler") return `${firstName(b.owner)} gave you ${listOf(b.addresses.map((x) => x.email))} to answer.`;
  return undefined;
}

/** The mail bot's routes (routes/bots/mail.ts). */
export const MAIL = "/v1/mail";
export const MAIL_SLUG = "mail";

export interface DnsRecordView {
  kind: string; type: string; name: string; host: string; value: string; priority?: number; required: boolean; why: string;
  status?: "ok" | "missing" | "differs" | "unknown"; note?: string;
}
export interface DnsView { domain: string; records: DnsRecordView[] }
export interface BriefView { about: string; voice: string; knowledge: string; policies: string; signature: string; replyLanguage: string; sendDelayMinutes: number }
export interface ReplyView {
  status: string; reason: string; sendAt: number | null; to: string; subject: string; text: string;
  kind: string | null; priority: string | null; summary: string | null;
  message: { from: string; subject: string; date: string; text: string } | null;
}

/** The mailbox (the worker's inbox.ts): its folders, a folder's conversations, one conversation, its rules. */
export interface FolderView { key: string; id: string; name: string; role: string | null; kind: "system" | "address" | "folder"; unread: number; total: number; email?: string }
export interface Person { name: string; email: string }
export interface MessageRow { id: string; threadId: string; from: Person; to: Person[]; subject: string; preview: string; at: number; unread: boolean; starred: boolean; count: number; ai?: { run: number; status: string } }
export interface MessagesView { folder: FolderView; folders: FolderView[]; page: number; more: boolean; total: number; messages: MessageRow[] }
export interface ThreadMessage { id: string; from: Person; to: Person[]; cc: Person[]; at: number; text: string; unread: boolean; mine: boolean; attachments: Array<{ name: string; size: number; type: string }> }
export interface ThreadView { threadId: string; subject: string; starred: boolean; where: string[]; messages: ThreadMessage[]; ai?: { run: number; status: string } }
export interface RuleView { id: number; name: string; enabled: boolean; line: string }

/** A folder's name as the person reads it: the Inbox is all the mail. */
export const folderName = (f: Pick<FolderView, "key" | "name">): string => (f.key === "inbox" ? "All mail" : f.name);

/** What the mail bot's page reads besides the bot (bots.ts loadBot): the overview, the business shown, its latest, and its set-up's needs. */
export interface MailData {
  overview?: MailOverview;
  /** The latest messages of the business shown, as the AI sorted them. */
  runs?: MailRunView[];
  /** Read only while its set-up is due: the records to add, each checked. */
  dns?: DnsView;
  brief?: { profile: BriefView; saved: boolean };
  /** The worker could not be reached. */
  down?: boolean;
  /** The business shown's folders, for its mailbox's rows (all mail, the main address's, each alias's). */
  folders?: FolderView[];
}

/** A business id as it may stand in a path or a param. */
export const bizParam = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);

/** The business shown: the one asked for, else the first of their own still being set up, else their first, else the first. */
export function shownBusiness(ctx: BotsCtx, o: MailOverview | undefined): MailBusinessView | undefined {
  const list = o?.businesses ?? [];
  const asked = bizParam(ctx.params.b);
  // Unasked, their own come first: a member's business (seen as their admin) or one they answer for never opens on its own.
  const own = list.filter((b) => !b.access || b.access === "own");
  return list.find((b) => b.id === asked) ?? own.find((b) => !b.ready) ?? own[0] ?? list[0];
}

export const KIND_LABEL: Record<string, string> = {
  question: "Question", support: "Support", sales: "Sales", order: "Order", billing: "Billing", complaint: "Complaint",
  partnership: "Partnership", job: "Job", personal: "Personal", notification: "Notice", spam: "Spam", other: "Other",
};

/** How an address answers, in a few words. */
export const MODE_WORDS: Record<string, string> = { draft: "Drafts for you", send: "Sends by itself", off: "AI off" };

/** "just now", "5 min ago", "3:40 pm", "Yesterday", "12 Nov". */
export function ago(ctx: BotsCtx, ms: number): string {
  const d = ctx.live.now - ms;
  if (d < MIN) return "just now";
  if (d < 60 * MIN) return `${Math.floor(d / MIN)} min ago`;
  if (d < 12 * 60 * MIN) return clockOf(ctx, ms);
  if (d < 2 * DAY) return "Yesterday";
  return shortDate(ctx, ms);
}

/** Why a message was filed, in a few words (the worker's reasons are longer). */
export function filedWhy(reason: string | null): string {
  const r = (reason ?? "").toLowerCase();
  if (/allowance/.test(r)) return "AI paused for the day";
  if (/newsletter|mailing list|list-|bulk|unsubscribe/.test(r)) return "Newsletter";
  if (/no-?reply|robot|automatic|auto-?repl/.test(r)) return "Automatic mail";
  if (/junk|spam/.test(r)) return "Junk";
  if (/own domain|your own|from the business/.test(r)) return "From your own domain";
  return "No answer needed";
}

const WAITING = new Set(["needs_person", "drafted", "scheduled"]);
export const isWaiting = (r: Pick<MailRunView, "status">): boolean => WAITING.has(r.status);

/** The reply's own screen (mailScreens.ts): a draft beside the message it answers. */
export const openReply = (business: string, run: number): ActionSpec => ({ kind: "navigate", screenId: SCREENS.mailReply, params: { b: business, run: String(run) } });

/** The sender as people read it: the name before the address, else the address. */
export const senderOf = (s: string | null | undefined): string => {
  const t = String(s ?? "").trim();
  const named = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(t);
  return (named?.[1] ?? t) || "Unknown sender";
};

/**
 * One message as a row: what the sender wants (the AI's one line, else the subject), who and what kind under it, and on the right when it
 * came and its state. Waiting ones open the reply; the others are a record. An urgent one carries the ink dot.
 */
export function runRow(ctx: BotsCtx, business: string, r: MailRunView): Node {
  const waiting = isWaiting(r);
  const what = r.summary?.trim() || r.subject?.trim() || "(no subject)";
  const kind = r.kind ? KIND_LABEL[r.kind] ?? "" : "";
  const sub = [senderOf(r.sender), kind].filter(Boolean).join(" · ");
  // An answered one needs no word: its section says it.
  const state = r.status === "needs_person" ? "Needs you"
    : r.status === "drafted" ? "Draft"
    : r.status === "scheduled" ? (r.sendAt ? `Sends ${clockOf(ctx, r.sendAt)}` : "Sending soon")
    : r.status === "skipped" ? filedWhy(r.reason)
    : "";
  return row([
    col([r.priority === "urgent" && waiting ? statusMark("needs", { size: 8 }) : statusMark(waiting ? "waiting" : "done", { size: 8 })], { width: 10, paddingTop: 6, alignItems: "center" }),
    col([
      text(what, { size: 15, weight: waiting ? 500 : 400, lineHeight: 20, lines: 2 }),
      text(sub, { size: 12, color: C.meta, lineHeight: 16, lines: 1 }),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
    col([
      text(ago(ctx, r.createdAt), { size: 12, color: C.meta, lineHeight: 16 }),
      ...(state ? [text(state, { size: 12, weight: r.status === "needs_person" ? 600 : 400, color: r.status === "needs_person" ? C.ink : C.meta, lineHeight: 16 })] : []),
    ], { alignItems: "flex-end", gap: 2, flexShrink: 0, paddingTop: 2 }),
    ...(waiting ? [col([icon("chevron", { size: 16, color: C.meta })], { paddingTop: 2 })] : []),
  ], { gap: 10, paddingVertical: 12, paddingHorizontal: 16, minHeight: 56, alignItems: "flex-start" }, waiting ? openReply(business, r.id) : undefined);
}

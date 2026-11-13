/**
 * THE MAIL BOT'S MAILBOX (docs/mail.md section 9), as Xooteq Mail shows it: every folder of a domain, its conversations, one read whole,
 * and mail written from any of its addresses.
 *
 *   bots.mail.inbox     params b, folder, page: a chip per domain (when there are several) and per folder (all mail, the main address's own,
 *                       each alias's, Sent, Drafts, Archive, Spam, Trash, any other), then the folder's conversations, newest first, 30 a page:
 *                       who, the subject, the start of the last message, when, how many, unread, starred, and what the AI did with it
 *   bots.mail.thread    params b, tid, folder: one conversation, oldest first, each message whole with its attachments' names; Reply,
 *                       Forward, Archive, Delete, Spam (or Back to inbox), Unread, Star, and Share with a space or person (the conversation as
 *                       text, oldest first; none while Spaces is off); the AI's draft a tap away
 *   bots.mail.compose   params b, tid, re | fwd: new mail, a reply or a forward, from any of the domain's addresses; Write with AI writes it
 *                       (a reply in the business's voice, or a new email from what they ask), and they send it. A reply and a forward send
 *                       the conversation's tid with the mail and with the AI's write, so the server files them in it
 *
 * Every call goes to routes/bots/mail.ts, which passes it to the worker (its inbox.ts) inside the person's own account.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, C, card, chip, chips, meta, notice, primaryButton, secondaryButton, quietButton, listCard, sectionLabel,
  call, seq, when, SCREENS, icon, statusMark, infoChip, divider, labelled,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import {
  ago, bizParam, folderName, MAIL, MAIL_SLUG, type MailBusinessView, type MessageRow, type MessagesView, openReply, type ThreadView,
} from "./mailParts.js";
import { clockOf, isDesk, setState, shortDate } from "./parts.js";
import { shareButtonsFor } from "../../shareAction.js";

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const tidParam = (v: unknown): string => (/^[A-Za-z0-9_-]{1,64}$/.test(String(v ?? "")) ? String(v) : "");
const folderParam = (v: unknown): string => (/^(inbox|main|drafts|sent|archive|junk|trash|f-[A-Za-z0-9_-]{1,64})$/.test(String(v ?? "")) ? String(v) : "inbox");
const pageParam = (v: unknown): number => Math.max(0, Math.min(200, Math.floor(Number(v) || 0)));
const nameOf = (p: { name: string; email: string }) => p.name.trim() || p.email;

/** The mailbox, at a folder (and a page): the screen replaces itself, so going back leaves it. */
export const openInbox = (b: string, folder = "inbox", pageNo = 0, replace = false): ActionSpec =>
  ({ kind: "navigate", screenId: SCREENS.mailInbox, params: { b, folder, ...(pageNo ? { page: String(pageNo) } : {}) }, ...(replace ? { replace: true } : {}) });
export const openThread = (b: string, tid: string, folder: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.mailThread, params: { b, tid, folder } });
export const openCompose = (b: string, o: { tid?: string; re?: string; fwd?: string } = {}): ActionSpec =>
  ({ kind: "navigate", screenId: SCREENS.mailCompose, params: { b, ...o } });

/** "Write": new mail from any of the domain's addresses (the mailbox's head, and the mail bot's page). */
export const writeButton = (b: string): Node => labelled(row([icon("plus", { size: 18, color: C.paper }), text("Write", { size: 14, weight: 600, color: C.paper, lineHeight: 18 })],
  { gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.ink, alignItems: "center", alignSelf: "center" }, openCompose(b)), "Write an email");

/** What the AI did with a conversation, in two words. */
const AI_TAG: Record<string, string> = { needs_person: "Needs you", drafted: "AI draft", scheduled: "Sends soon", sent: "AI answered" };

// ===================================================================== the mailbox

export type InboxData = { messages?: MessagesView; businesses?: MailBusinessView[] };

function messageRow(ctx: BotsCtx, b: string, folder: string, m: MessageRow): Node {
  const who = m.from.email ? nameOf(m.from) : m.to[0] ? `To ${nameOf(m.to[0])}` : "(no sender)";
  return row([
    col([m.unread ? statusMark("needs", { size: 8 }) : { type: "Stack", style: { width: 8, height: 8 } }], { width: 10, paddingTop: 7, alignItems: "center" }),
    col([
      row([
        text(who, { size: 15, weight: m.unread ? 600 : 400, lineHeight: 20, lines: 1, style: { flexShrink: 1 } }),
        ...(m.count > 1 ? [text(String(m.count), { size: 12, color: C.meta, lineHeight: 16 })] : []),
        { type: "Stack", style: { flexGrow: 1 } },
        text(ago(ctx, m.at), { size: 12, color: C.meta, lineHeight: 16, style: { flexShrink: 0 } }),
      ], { gap: 6, alignItems: "center" }),
      text(m.subject || "(no subject)", { size: 14, weight: m.unread ? 500 : 400, lineHeight: 19, lines: 1 }),
      text(m.preview, { size: 13, color: C.meta, lineHeight: 18, lines: 1 }),
      ...(m.ai || m.starred ? [row([
        ...(m.ai && AI_TAG[m.ai.status] ? [infoChip(AI_TAG[m.ai.status]!)] : []),
        ...(m.starred ? [infoChip("Starred")] : []),
      ], { gap: 6, paddingTop: 2 })] : []),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
  ], { gap: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "flex-start" }, openThread(b, m.threadId, folder));
}

export function inboxPage(ctx: BotsCtx, d: InboxData | undefined) {
  const b = bizParam(ctx.params.b);
  const v = d?.messages;
  const desk = isDesk(ctx);
  const toMailPage: ActionSpec = { kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, b }, replace: true };
  if (!v) {
    return page(ctx, { back: toMailPage, backTitle: "Mail", title: "Mail", body: [notice("The mailbox couldn't be read just now. Pull to try again.")] });
  }
  const f = v.folder;
  const businesses = d?.businesses ?? [];
  const domains: Node[] = businesses.length > 1 ? [row(businesses.map((x) => chip(x.domain, { selected: x.id === b, onPress: openInbox(x.id, "inbox", 0, true) })), { gap: 8, flexWrap: "wrap" })] : [];
  const folders = row(v.folders.map((x) => chip(`${folderName(x)}${x.unread ? ` ${x.unread}` : ""}`, { selected: x.key === f.key, onPress: openInbox(b, x.key, 0, true) })), { gap: 8, flexWrap: "wrap" });
  const list = v.messages.length
    ? listCard(v.messages.map((m) => messageRow(ctx, b, f.key, m)))
    : card([text(`Nothing in ${folderName(f)}.`, { size: 15, weight: 500, lineHeight: 20 }), ...(f.key === "inbox" ? [meta("Mail sent to any of its addresses arrives here.", { size: 13 })] : [])], { gap: 6 });
  const pager: Node[] = v.page > 0 || v.more ? [row([
    ...(v.page > 0 ? [secondaryButton("Newer", openInbox(b, f.key, v.page - 1, true), { size: "md" })] : []),
    { type: "Stack", style: { flexGrow: 1 } },
    ...(v.more ? [secondaryButton("Older", openInbox(b, f.key, v.page + 1, true), { size: "md" })] : []),
  ], { gap: 8, alignItems: "center" })] : [];
  return page(ctx, {
    back: toMailPage, backTitle: folderName(f), backRight: writeButton(b), title: folderName(f), ...(desk ? { maxWidth: 760 } : {}),
    pullBot: { top: true, items: v.messages.map((m) => m.threadId) },
    body: [
      ...domains,
      folders,
      ...(f.email ? [meta(`Mail to ${f.email}`, { size: 12 })] : []),
      list,
      ...pager,
    ],
    gap: 14,
  });
}

// ===================================================================== one conversation

export type ThreadData = { thread?: ThreadView; gone?: string };

const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The conversation oldest first, "name, date:" then the text of each, cut to what a share keeps (about 4000 characters). */
function conversationText(ctx: BotsCtx, t: ThreadView): string {
  const out = [...t.messages].sort((a, b) => a.at - b.at).map((m) => `${nameOf(m.from)}, ${shortDate(ctx, m.at)}:\n${m.text.trim() || "(no text)"}`).join("\n\n");
  return out.slice(0, 4000);
}

export function threadPage(ctx: BotsCtx, d: ThreadData | undefined) {
  const b = bizParam(ctx.params.b), tid = tidParam(ctx.params.tid), folder = folderParam(ctx.params.folder);
  const back = openInbox(b, folder, 0, true);
  const t = d?.thread;
  if (!t || !tid) {
    return page(ctx, { back, backTitle: "Mail", title: "Mail", body: [card([text(d?.gone ?? "This conversation was deleted.", { size: 15, weight: 500 }), secondaryButton("Back to the mail", back, { size: "md" })], { gap: 12 })] });
  }
  const T = `${MAIL}/businesses/${b}/threads/${tid}`;
  const doIt = (action: string, done: string, leave = true): ActionRef => call("POST", `${T}/${action}`, {}, {
    ok: seq(said(done), leave ? back : ({ kind: "refresh" } as ActionSpec)), fail: toast("Couldn't do that. Try again."),
  });
  const binned = t.where.includes("trash") || t.where.includes("junk");
  const actions = row([
    ...(binned
      ? [chip("Back to inbox", { onPress: doIt("inbox", "Back in the inbox.") })]
      : [chip("Archive", { onPress: doIt("archive", "Archived.") }), chip("Delete", { onPress: doIt("trash", "In Trash.") }), chip("Spam", { onPress: doIt("junk", "Marked as spam.") })]),
    chip("Mark unread", { onPress: doIt("unread", "Marked unread.") }),
    chip(t.starred ? "Unstar" : "Star", { onPress: doIt(t.starred ? "unstar" : "star", t.starred ? "Unstarred." : "Starred.", false) }),
    ...shareButtonsFor(ctx, { kind: "text", title: t.subject || "Conversation", text: conversationText(ctx, t), bot: "mail" }, { size: "md" }),
  ], { gap: 8, flexWrap: "wrap" });

  const ai: Node[] = t.ai ? [row([
    notice(t.ai.status === "needs_person" ? "A person should answer this. The AI drafted a holding reply."
      : t.ai.status === "drafted" ? "The AI drafted a reply." : t.ai.status === "scheduled" ? "The AI's reply goes by itself soon." : "The AI answered this.", { mark: "spark" }),
    ...(t.ai.status !== "sent" ? [quietButton("See the draft", openReply(b, t.ai.run), { size: "md" })] : []),
  ], { gap: 8, alignItems: "center", flexWrap: "wrap" })] : [];

  const messages = t.messages.map((m) => card([
    row([
      col([
        text(nameOf(m.from), { size: 15, weight: 600, lineHeight: 20, lines: 1 }),
        meta(`${m.from.email}${m.to.length ? ` · to ${m.to.map(nameOf).join(", ")}` : ""}${m.cc.length ? ` · cc ${m.cc.map(nameOf).join(", ")}` : ""}`, { size: 12, lines: 2 }),
      ], { gap: 2, flexShrink: 1, minWidth: 0 }),
      { type: "Stack", style: { flexGrow: 1 } },
      text(ctx.live.now - m.at < 86_400_000 ? clockOf(ctx, m.at) : shortDate(ctx, m.at), { size: 12, color: C.meta, lineHeight: 16, style: { flexShrink: 0 } }),
    ], { gap: 8, alignItems: "flex-start" }),
    divider(),
    text(m.text.trim() || "(no text)", { size: 14, color: C.grey70, lineHeight: 20 }),
    ...(m.attachments.length ? [col([sectionLabel(m.attachments.length === 1 ? "1 attachment" : `${m.attachments.length} attachments`),
      ...m.attachments.map((a) => row([icon("clip", { size: 14, color: C.meta }), text(a.name, { size: 13, lineHeight: 18, lines: 1, style: { flexShrink: 1 } }), meta(size(a.size), { size: 12 })], { gap: 6, alignItems: "center" }))], { gap: 6 })] : []),
  ], { gap: 10, ...(m.mine ? { style: { backgroundColor: C.surface } } : {}) }));

  // A reply goes to the last message someone else sent; a forward carries the last message.
  const lastIn = [...t.messages].reverse().find((m) => !m.mine) ?? t.messages[t.messages.length - 1]!;
  const last = t.messages[t.messages.length - 1]!;
  return page(ctx, {
    back, backTitle: "Conversation", title: t.subject || "Conversation", ...(isDesk(ctx) ? { maxWidth: 760 } : {}),
    body: [
      text(t.subject || "(no subject)", { size: 20, weight: 600, lineHeight: 26, tracking: -0.3 }),
      actions,
      ...ai,
      ...messages,
    ],
    footer: [row([
      primaryButton("Reply", openCompose(b, { tid, re: lastIn.id }), { size: "md", icon: "back" }),
      secondaryButton("Forward", openCompose(b, { tid, fwd: last.id }), { size: "md" }),
    ], { gap: 8, alignItems: "center" })],
    gap: 14,
  });
}

// ===================================================================== write

export type ComposeData = { business?: MailBusinessView; thread?: ThreadView };

const REPLY_ASKS = ["Answer it", "Say no, kindly", "Ask for their order number"];

export function composePage(ctx: BotsCtx, d: ComposeData | undefined) {
  const b = bizParam(ctx.params.b), tid = tidParam(ctx.params.tid);
  const re = tidParam(ctx.params.re), fwd = tidParam(ctx.params.fwd);
  const desk = isDesk(ctx);
  const biz = d?.business;
  if (!biz) return page(ctx, { back: true, backTitle: "Write", title: "Write", body: [notice("This couldn't be read just now. Try again in a moment.")] });
  const original = (re || fwd) ? d?.thread?.messages.find((m) => m.id === (re || fwd)) : undefined;
  const mode = re && original ? "reply" : fwd && original ? "forward" : "new";
  // From: the address the original was sent to, when it is one of theirs; else the main address.
  const ours = new Set(biz.addresses.map((a) => a.email));
  const to0 = original?.to.find((p) => ours.has(p.email.toLowerCase()))?.email.toLowerCase();
  const from = to0 ?? biz.addresses.find((a) => a.isPrimary)?.email ?? biz.email;
  const subject = mode === "reply" ? (/^re:/i.test(d!.thread!.subject) ? d!.thread!.subject : `Re: ${d!.thread!.subject}`)
    : mode === "forward" ? (/^fwd?:/i.test(d!.thread!.subject) ? d!.thread!.subject : `Fwd: ${d!.thread!.subject}`) : "";
  const toPerson = mode === "reply" && original ? (original.from.name ? `${original.from.name} <${original.from.email}>` : original.from.email) : "";
  // New mail: the AI may write its subject too, so the subject field reads the AI's answer (cmw.subject); a reply's subject is fixed.
  const subjectPath = mode === "new" ? "cmw.subject" : "cm_subject";

  const busy = (on: boolean) => setState("cm_busy", on);
  const writeAI = (instruction: string): ActionRef => seq(busy(true), call("POST", `${MAIL}/businesses/${b}/write`, {
    instruction, from: "$state.cm_from", ...(mode === "reply" ? { replyTo: re } : {}), ...(mode !== "new" && tid ? { tid } : {}),
  }, { assignTo: "cmw", ok: busy(false), fail: seq(busy(false), toast("The AI couldn't write it just now. Write it yourself, or try again.")) }));
  const asked: ActionSpec = { kind: "condition", if: { truthy: "cm_ask" }, then: seq(writeAI("$state.cm_ask"), setState("cm_ask", "")), else: toast("Say what it should say.") } as ActionSpec;
  const done = tid ? { kind: "navigate", screenId: SCREENS.mailThread, params: { b, tid, folder: "inbox" }, replace: true } as ActionSpec : openInbox(b, "sent", 0, true);
  const send = call("POST", `${MAIL}/businesses/${b}/send`, {
    from: "$state.cm_from", to: "$state.cm_to", cc: "$state.cm_cc", subject: `$state.${subjectPath}`, text: "$state.cmw.text",
    ...(mode === "reply" ? { replyTo: re } : mode === "forward" ? { forward: fwd } : {}),
    ...(mode !== "new" && tid ? { tid } : {}),
  }, { ok: seq(said("Sent."), done), fail: toast("Couldn't send it. Check the addresses and try again.") });

  const label = (s: string) => text(s, { size: 12, weight: 600, tracking: 0.4, upper: true, color: C.meta, lineHeight: 15 });
  return page(ctx, {
    back: true, backTitle: mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "New email", title: mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "New email",
    ...(desk ? { maxWidth: 760 } : {}),
    body: [
      col([label("From"), chips(biz.addresses.map((a) => ({ label: a.email, value: a.email })), "cm_from")], { gap: 8 }),
      col([label("To"), mailField("cm_to", "name@example.com, another@example.com", desk, { label: "who it goes to", keyboard: "email" })], { gap: 8 }),
      col([label("Cc"), mailField("cm_cc", "Optional", desk, { label: "copies", keyboard: "email" })], { gap: 8 }),
      col([label("Subject"), mailField(subjectPath, "What it is about", desk, { label: "the subject", capitalize: false })], { gap: 8 }),
      col([label(mode === "forward" ? "Your note" : "Message"), mailField("cmw.text", mode === "forward" ? "Add a note above the forwarded message" : "Write your message", desk, { label: "the message", multiline: true, minHeight: 200 })], { gap: 8 }),
      ...(mode !== "forward" ? [col([
        row([icon("spark", { size: 16, color: C.ink }), text("Write with AI", { size: 14, weight: 600, lineHeight: 18 })], { gap: 6, alignItems: "center" }),
        ...(mode === "reply" ? [row(REPLY_ASKS.map((x) => chip(x, { onPress: writeAI(x) })), { gap: 8, flexWrap: "wrap" })] : []),
        mailField("cm_ask", mode === "reply" ? "Or say what to answer" : "What should it say?", desk, { label: "what to write", onSubmit: asked }),
        when({ truthy: "cm_busy" }, meta("Writing…", { size: 13 })),
      ], { gap: 8 })] : []),
      ...(original ? [card([
        meta(`${mode === "reply" ? "Replying to" : "Forwarding"} ${nameOf(original.from)}, ${shortDate(ctx, original.at)}`, { size: 12 }),
        text(original.text.slice(0, 1500), { size: 13, color: C.grey70, lineHeight: 18, lines: 12 }),
      ], { gap: 6, style: { backgroundColor: C.surface } })] : []),
    ],
    footer: [primaryButton("Send", send, { wide: true })],
    state: { cm_from: from, cm_to: toPerson, cm_cc: "", cm_subject: subject, cmw: { text: "", ...(mode === "new" ? { subject: "" } : {}) }, cm_ask: "", cm_busy: false },
    gap: 16,
  });
}

// ===================================================================== the screens

export const mailInboxScreens: BotsScreen[] = [
  screen<InboxData>({
    id: SCREENS.mailInbox,
    load: async (ctx, deps: Deps) => {
      const b = bizParam(ctx.params.b);
      if (!b) return {};
      const folder = folderParam(ctx.params.folder), pageNo = pageParam(ctx.params.page);
      const [messages, businesses] = await Promise.all([
        deps.api<MessagesView>("GET", `${MAIL}/businesses/${b}/messages?folder=${folder}${pageNo ? `&page=${pageNo}` : ""}`).catch(() => undefined),
        deps.api<{ businesses: MailBusinessView[] }>("GET", `${MAIL}/businesses`).then((r) => r.businesses).catch(() => undefined),
      ]);
      return { ...(messages ? { messages } : {}), ...(businesses ? { businesses } : {}) };
    },
    build: (ctx, d) => inboxPage(ctx, d),
  }),
  screen<ThreadData>({
    id: SCREENS.mailThread,
    load: async (ctx, deps: Deps) => {
      const b = bizParam(ctx.params.b), tid = tidParam(ctx.params.tid);
      if (!b || !tid) return {};
      try {
        return { thread: await deps.api<ThreadView>("GET", `${MAIL}/businesses/${b}/threads/${tid}`) };
      } catch {
        return { gone: "This conversation was deleted." };
      }
    },
    build: (ctx, d) => threadPage(ctx, d),
  }),
  screen<ComposeData>({
    id: SCREENS.mailCompose,
    load: async (ctx, deps: Deps) => {
      const b = bizParam(ctx.params.b), tid = tidParam(ctx.params.tid);
      if (!b) return {};
      const [business, thread] = await Promise.all([
        deps.api<{ business: MailBusinessView }>("GET", `${MAIL}/businesses/${b}`).then((r) => r.business).catch(() => undefined),
        tid ? deps.api<ThreadView>("GET", `${MAIL}/businesses/${b}/threads/${tid}`).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      return { ...(business ? { business } : {}), ...(thread ? { thread } : {}) };
    },
    build: (ctx, d) => composePage(ctx, d),
  }),
];


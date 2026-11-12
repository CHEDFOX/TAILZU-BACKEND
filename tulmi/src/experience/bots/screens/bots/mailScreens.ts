/**
 * THE MAIL BOT'S SCREENS BEHIND ITS PAGE (docs/mail.md section 9), and what its page reads.
 *
 *   bots.mail.reply      params b, run: the message, how the AI sorted it, and its draft to change. Shorter, Warmer, More formal, or in their
 *                        own words, writes it again (still a draft). Send sends it (their changes first, which the AI learns from); Keep
 *                        keeps it as a draft; Throw away. A reply about to go by itself says when, with Stop. A push opens it
 *   bots.mail.dns        params b: the records to add at the domain's DNS, each checked live, with Copy; Check again
 *   bots.mail.brief      params b, from?: the company personality: how it sounds and what it knows (about, voice, facts, rules, sign-off),
 *                        with Fill from the website. Opened from the set-up's card (from=setup), Keep and Back go on to its last step
 *   bots.mail.settings   params b: the domain's addresses (mailAliases.ts), its personality, its rules and its records, the AI's day, set-up
 *                        again, another domain, a mail app's password and servers, and removing the business
 *
 * Every write goes to routes/bots/mail.ts, which passes it to the worker inside the person's own account.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, C, card, chip, meta, notice, primaryButton, secondaryButton, quietButton, listCard, listRow, sectionLabel,
  call, seq, when, SCREENS, infoChip, meter, statusMark, divider,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { addBusiness, mailField, needsBusiness, needsSetup, openSetup, recordRow, toModeStep } from "./mailCards.js";
import { openAddresses, openRules } from "./mailAliases.js";
import {
  bizParam, type BriefView, type DnsView, type FolderView, KIND_LABEL, MAIL, MAIL_SLUG, type MailBusinessView, type MailData, type MailOverview, type MailRunView,
  type ReplyView, senderOf, shownBusiness,
} from "./mailParts.js";
import { clockOf, isDesk, setState } from "./parts.js";

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

const runParam = (v: unknown): string => (/^[1-9][0-9]{0,11}$/.test(String(v ?? "")) ? String(v) : "");
const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
/** The mail bot's page, for the business (replacing this screen: a push may have opened it with nothing behind). */
const toPage = (business: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, b: business }, replace: true });
const refresh: ActionSpec = { kind: "refresh" };

// ===================================================================== what the page reads

/** The mail bot's page: the overview, the business shown, its latest, and (while its set-up is due) its records and brief. */
export async function loadMail(ctx: BotsCtx, deps: Deps): Promise<MailData> {
  const overview = await deps.api<MailOverview>("GET", `${MAIL}/overview`).catch(() => undefined);
  if (!overview) return { down: true };
  const b = shownBusiness(ctx, overview);
  if (!b) return { overview };
  const setup = !needsBusiness(ctx, { overview }) && needsSetup(ctx, { overview });
  const [runs, dns, brief, folders] = await Promise.all([
    deps.api<{ runs: MailRunView[] }>("GET", `${MAIL}/businesses/${b.id}/activity?limit=40`).then((r) => r.runs).catch(() => [] as MailRunView[]),
    setup ? deps.api<DnsView>("GET", `${MAIL}/businesses/${b.id}/dns`).catch(() => undefined) : Promise.resolve(undefined),
    setup ? deps.api<{ profile: BriefView; saved: boolean }>("GET", `${MAIL}/businesses/${b.id}/brief`).catch(() => undefined) : Promise.resolve(undefined),
    // The mailbox's rows on the page: all mail, the main address's, each alias's, with what is unread.
    deps.api<{ folders: FolderView[] }>("GET", `${MAIL}/businesses/${b.id}/folders`).then((r) => r.folders).catch(() => undefined),
  ]);
  return { overview, runs, ...(dns ? { dns } : {}), ...(brief ? { brief } : {}), ...(folders ? { folders } : {}) };
}

// ===================================================================== a reply

export type ReplyData = { reply?: ReplyView; gone?: string };

const REWRITES: Array<[string, string]> = [
  ["Shorter", "Make it shorter."], ["Warmer", "Make it warmer and friendlier."], ["More formal", "Make it more formal."],
  ["Offer a call", "Offer to talk on a call, without promising a time."],
];

export function replyPage(ctx: BotsCtx, d: ReplyData | undefined) {
  const b = bizParam(ctx.params.b), run = runParam(ctx.params.run);
  const r = d?.reply;
  if (!r || !b || !run) {
    return page(ctx, {
      back: toPage(b), backTitle: "Reply", title: "Reply",
      body: [card([
        text(d?.gone ?? "This reply was sent or thrown away.", { size: 15, weight: 500, lineHeight: 21 }),
        secondaryButton("Back to the mail", toPage(b), { size: "md" }),
      ], { gap: 12 })],
    });
  }
  const R = `${MAIL}/businesses/${b}/replies/${run}`;
  const m = r.message;
  const tags = [r.kind ? KIND_LABEL[r.kind] : null, r.priority === "urgent" ? "Urgent" : null].filter((x): x is string => !!x);

  const message = card([
    row([
      text(senderOf(m?.from), { size: 15, weight: 600, lineHeight: 20, lines: 1, style: { flexShrink: 1 } }),
      text(m?.date ? clockOf(ctx, Date.parse(m.date) || ctx.live.now) : "", { size: 12, color: C.meta, lineHeight: 16, style: { flexShrink: 0 } }),
    ], { gap: 8, justifyContent: "space-between" }),
    text(m?.subject || r.subject || "(no subject)", { size: 15, weight: 500, lineHeight: 20 }),
    ...(tags.length || r.summary ? [col([
      ...(tags.length ? [row(tags.map(infoChip), { gap: 6, flexWrap: "wrap" })] : []),
      ...(r.summary ? [meta(r.summary, { size: 13, lineHeight: 18 })] : []),
    ], { gap: 6 })] : []),
    divider(),
    text(m?.text?.trim() || "(the message has no text)", { size: 14, color: C.grey70, lineHeight: 20 }),
  ], { gap: 10 });

  const state: Node[] = [];
  if (r.status === "needs_person") state.push(notice(`A person should answer this. ${r.reason}`.trim(), { mark: "person" }));
  if (r.status === "scheduled" && r.sendAt) {
    state.push(row([
      notice(`Sends by itself at ${clockOf(ctx, r.sendAt)}.`),
      quietButton("Stop", call("POST", `${R}/stop`, {}, { ok: seq(said("Stopped: it waits as a draft."), refresh), fail: toast("Couldn't stop it. It may have gone.") }), { size: "md" }),
    ], { gap: 8, alignItems: "center", flexWrap: "wrap" }));
  }

  const busy = (on: boolean) => setState("mr_busy", on);
  const rewrite = (instruction: string): ActionRef => seq(busy(true), call("POST", `${R}/rewrite`, { instruction }, {
    assignTo: "mr", ok: busy(false), fail: seq(busy(false), toast("Couldn't write it again. Change it by hand, or try again.")),
  }));
  const asked: ActionSpec = { kind: "condition", if: { truthy: "mr_ask" }, then: seq(rewrite("$state.mr_ask"), setState("mr_ask", "")), else: toast("Say how to change it.") } as ActionSpec;

  const draft = col([
    sectionLabel("Your reply"),
    meta(`To ${r.to || "the sender"} · ${r.subject}`, { size: 12, lines: 1 }),
    mailField("mr.text", "Write the reply", isDesk(ctx), { label: "the reply", multiline: true, minHeight: 200 }),
    row(REWRITES.map(([label, ask]) => chip(label, { onPress: rewrite(ask) })), { gap: 8, flexWrap: "wrap" }),
    mailField("mr_ask", "Or say how to change it", isDesk(ctx), { label: "how to change it", onSubmit: asked }),
    when({ truthy: "mr_busy" }, meta("Writing it again…", { size: 13 })),
  ], { gap: 10 });

  // Their words first when they changed them (the AI learns from what they changed), then sent.
  const send = call("POST", `${R}/send`, {}, { ok: seq(said("Sent."), toPage(b)), fail: toast("Couldn't send it. Try again.") });
  const sendAction: ActionSpec = {
    kind: "condition", if: { eq: ["mr.text", r.text] }, then: send,
    else: call("PUT", R, { text: "$state.mr.text" }, { ok: send, fail: toast("Couldn't save your changes. Try again.") }),
  } as ActionSpec;
  const keep = call("PUT", R, { text: "$state.mr.text" }, { ok: said("Kept as a draft."), fail: toast("Couldn't save it. Try again.") });
  const discard = call("DELETE", R, undefined, { ok: seq(said("Thrown away."), toPage(b)), fail: toast("Couldn't throw it away. Try again.") });

  return page(ctx, {
    back: toPage(b), backTitle: "Reply", title: "Reply", ...(isDesk(ctx) ? { maxWidth: 720 } : {}),
    body: [message, ...state, draft],
    footer: [row([
      primaryButton("Send", sendAction, { size: "md" }),
      secondaryButton("Keep", keep, { size: "md" }),
      quietButton("Throw away", discard, { size: "md" }),
    ], { gap: 8, alignItems: "center" })],
    state: { mr: { text: r.text }, mr_busy: false, mr_ask: "" },
    gap: 16,
  });
}

// ===================================================================== the domain's records

export type DnsData = { dns?: DnsView };

export function dnsPage(ctx: BotsCtx, d: DnsData | undefined) {
  const b = bizParam(ctx.params.b);
  const recs = d?.dns?.records ?? [];
  const required = recs.filter((r) => r.required), optional = recs.filter((r) => !r.required);
  const found = required.filter((r) => r.status === "ok").length;
  return page(ctx, {
    back: true, backTitle: "Domain records", title: "Domain records", ...(isDesk(ctx) ? { maxWidth: 720 } : {}),
    body: d?.dns ? [
      col([
        text(`${found} of ${required.length} in place`, { size: 20, weight: 600, lineHeight: 25, tracking: -0.3 }),
        meta(`Add these where ${d.dns.domain} was bought (GoDaddy, Namecheap, Cloudflare…). Mail arrives once the MX is in; sending is trusted once SPF, DKIM and DMARC are.`, { size: 13, lineHeight: 18 }),
      ], { gap: 6 }),
      card(required.map((r) => recordRow(ctx, r)), { gap: 0, padding: 16 }),
      ...(optional.length ? [col([sectionLabel("Optional: mail apps find the servers by themselves"), card(optional.map((r) => recordRow(ctx, r)), { gap: 0, padding: 16 })], { gap: 8 })] : []),
    ] : [notice("The records couldn't be read just now. Try again in a moment.")],
    footer: [primaryButton("Check again", refresh, { wide: true })],
    state: { b },
  });
}

// ===================================================================== what it knows

export type BriefData = { brief?: { profile: BriefView; saved: boolean }; business?: MailBusinessView };

export function briefPage(ctx: BotsCtx, d: BriefData | undefined) {
  const b = bizParam(ctx.params.b);
  const desk = isDesk(ctx);
  const p = d?.brief?.profile;
  const biz = d?.business;
  if (!p || !biz) return page(ctx, { back: true, backTitle: "Company personality", title: "Company personality", body: [notice("This couldn't be read just now. Try again in a moment.")] });
  const B = `${MAIL}/businesses/${b}/brief`;
  // From the set-up's card: kept or not, the set-up goes on to how it answers (the card's page was replaced by this one).
  const fromSetup = ctx.params.from === "setup";
  const fill = seq(setState("mb_busy", true), call("POST", `${B}/draft`, {}, {
    assignTo: "mb", ok: seq(setState("mb_busy", false), said("Drafted from the website. Read it, then keep it.")),
    fail: seq(setState("mb_busy", false), toast(`Couldn't read ${biz.domain}. Write it yourself, or try again later.`)),
  }));
  const keep = call("PUT", B, {
    about: "$state.mb.draft.about", voice: "$state.mb.draft.voice", knowledge: "$state.mb.draft.knowledge", policies: "$state.mb.draft.policies",
    signature: "$state.mb_sig",
  }, { ok: fromSetup ? seq(said("Kept."), toModeStep(b)) : said("Kept. The next replies use it."), fail: toast("Couldn't save it. Try again.") });
  const field = (label: string, sub: string, path: string, placeholder: string, minHeight: number): Node => col([
    text(label, { size: 15, weight: 600, lineHeight: 20 }), meta(sub, { size: 12, lineHeight: 16 }),
    mailField(path, placeholder, desk, { label, multiline: true, minHeight }),
  ], { gap: 6 });
  return page(ctx, {
    back: fromSetup ? toModeStep(b) : true, backTitle: "Company personality", title: "Company personality", ...(desk ? { maxWidth: 720 } : {}),
    body: [
      col([
        text(biz.name, { size: 20, weight: 600, lineHeight: 25, tracking: -0.3 }),
        meta("How the business sounds and what it knows. The AI writes every email with it, answers only from it and from the email, and asks a person when these don't say.", { size: 13, lineHeight: 18 }),
      ], { gap: 6 }),
      row([secondaryButton(`Fill from ${biz.domain}`, fill, { size: "md", icon: "spark" })], { gap: 8 }),
      when({ truthy: "mb_busy" }, meta(`Reading ${biz.domain}…`, { size: 13 })),
      field("About", "What the business does, and for whom.", "mb.draft.about", "What it does, and for whom", 90),
      field("Voice", "How its replies sound.", "mb.draft.voice", "Warm, clear and brief", 60),
      field("Facts", "Prices, hours, delivery, returns, links: what a reply may use.", "mb.draft.knowledge", "One fact a line", 160),
      field("Rules", "What a reply never promises, and what always goes to a person.", "mb.draft.policies", "Never promise refunds…", 90),
      field("Sign-off", "Added under every reply.", "mb_sig", "Warmly, the Leaf & Co team", 60),
    ],
    footer: [primaryButton("Keep", keep, { wide: true })],
    state: { mb: { draft: { about: p.about, voice: p.voice, knowledge: p.knowledge, policies: p.policies } }, mb_sig: p.signature, mb_busy: false },
    gap: 18,
  });
}

// ===================================================================== a business's settings

export type SettingsData = { business?: MailBusinessView };

export function settingsPage(ctx: BotsCtx, d: SettingsData | undefined) {
  const b = bizParam(ctx.params.b);
  const biz = d?.business;
  if (!biz) return page(ctx, { back: true, backTitle: "Business", title: "Business", body: [notice("This couldn't be read just now. Try again in a moment.")] });
  const desk = isDesk(ctx);
  const BZ = `${MAIL}/businesses/${b}`;
  const used = biz.allowance.capUsd > 0 ? Math.min(1, biz.allowance.spentUsd / biz.allowance.capUsd) : 0;
  const mailApp = biz.mailApp;
  const setPassword: ActionSpec = {
    kind: "condition", if: { truthy: "ms_pw" },
    then: call("POST", `${BZ}/mail-app-password`, { password: "$state.ms_pw" }, { ok: seq(setState("ms_pw", ""), said("Set. Use it in your mail app.")), fail: toast("Use at least 10 characters.") }),
    else: toast("Type a password for the mail app."),
  } as ActionSpec;
  const remove = call("DELETE", BZ, undefined, {
    ok: seq(said(`${biz.name} was removed.`), { kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG }, replace: true } as ActionSpec),
    fail: toast("Couldn't remove it. Try again."),
  });

  return page(ctx, {
    back: true, backTitle: biz.name, title: biz.name, ...(desk ? { maxWidth: 720 } : {}),
    body: [
      listCard([
        listRow({ label: "Addresses", sub: `${biz.addresses.map((a) => a.email.split("@")[0] + "@").join(", ")}: folders, names, how each answers, auto-replies`, onPress: openAddresses(b) }),
        listRow({ label: "Company personality", sub: "About, voice, facts, rules, sign-off", onPress: { kind: "navigate", screenId: SCREENS.mailBrief, params: { b } } }),
        listRow({ label: "Rules", sub: "What happens to mail as it arrives", onPress: openRules(b) }),
        listRow({ label: "Domain records", sub: `What ${biz.domain} needs, each checked`, onPress: { kind: "navigate", screenId: SCREENS.mailDns, params: { b } } }),
      ], { title: biz.domain }),
      col([
        sectionLabel("The AI, last 24 hours"),
        meter(used, 1, { label: used >= 1 ? "Paused until its use ages: new mail waits for you" : "Its allowance", valueText: `${Math.round(used * 100)}%` }),
      ], { gap: 8 }),
      listCard([
        listRow({ label: "Set it up again", sub: "Records, personality, how it answers", onPress: openSetup(b) }),
        listRow({ label: "Add a domain", sub: "Another domain, with its own mailbox, addresses and personality", onPress: addBusiness() }),
      ]),
      col([
        sectionLabel("A mail app too"),
        meta(mailApp ? `Incoming ${mailApp.incoming} (IMAP, 993), outgoing ${mailApp.outgoing} (SMTP, 465), user ${mailApp.user}.` : "Set a password to read the mail in a phone's or a computer's mail app.", { size: 13, lineHeight: 18 }),
        mailField("ms_pw", "A password for the mail app", desk, { label: "the password", onSubmit: setPassword }),
        secondaryButton("Set password", setPassword, { size: "md" }),
      ], { gap: 8 }),
      col([
        when({ falsy: "ms_sure" }, quietButton(`Remove ${biz.name}`, setState("ms_sure", true), { size: "md" })),
        when({ truthy: "ms_sure" }, card([
          row([statusMark("failed", { size: 10 }), text(`Remove ${biz.name}, its mailbox and all its mail?`, { size: 15, weight: 600, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 8, alignItems: "center" }),
          meta("This can't be undone. Mail sent to it afterwards is not received.", { size: 13, lineHeight: 18 }),
          row([primaryButton("Remove", remove, { size: "md" }), quietButton("Cancel", setState("ms_sure", false), { size: "md" })], { gap: 8 }),
        ], { gap: 10 })),
      ], { gap: 8 }),
    ],
    state: { ms_pw: "", ms_sure: false },
    gap: 20,
  });
}

// ===================================================================== the screens

export const mailScreens: BotsScreen[] = [
  screen<ReplyData>({
    id: SCREENS.mailReply,
    load: async (ctx, deps) => {
      const b = bizParam(ctx.params.b), run = runParam(ctx.params.run);
      if (!b || !run) return {};
      try {
        return { reply: await deps.api<ReplyView>("GET", `${MAIL}/businesses/${b}/replies/${run}`) };
      } catch (err) {
        const message = (err as { message?: unknown } | null)?.message;
        return { gone: typeof message === "string" && message.length < 200 && /draft|reply|gone|sent/i.test(message) ? message : "This reply was sent or thrown away." };
      }
    },
    build: (ctx, d) => replyPage(ctx, d),
  }),
  screen<DnsData>({
    id: SCREENS.mailDns,
    load: async (ctx, deps) => {
      const b = bizParam(ctx.params.b);
      return b ? { dns: await deps.api<DnsView>("GET", `${MAIL}/businesses/${b}/dns`).catch(() => undefined) } : {};
    },
    build: (ctx, d) => dnsPage(ctx, d),
  }),
  screen<BriefData>({
    id: SCREENS.mailBrief,
    load: async (ctx, deps) => {
      const b = bizParam(ctx.params.b);
      if (!b) return {};
      const [brief, business] = await Promise.all([
        deps.api<{ profile: BriefView; saved: boolean }>("GET", `${MAIL}/businesses/${b}/brief`).catch(() => undefined),
        deps.api<{ business: MailBusinessView }>("GET", `${MAIL}/businesses/${b}`).then((r) => r.business).catch(() => undefined),
      ]);
      return { ...(brief ? { brief } : {}), ...(business ? { business } : {}) };
    },
    build: (ctx, d) => briefPage(ctx, d),
  }),
  screen<SettingsData>({
    id: SCREENS.mailSettings,
    load: async (ctx, deps) => {
      const b = bizParam(ctx.params.b);
      if (!b) return {};
      const business = await deps.api<{ business: MailBusinessView }>("GET", `${MAIL}/businesses/${b}`).then((r) => r.business).catch(() => undefined);
      return business ? { business } : {};
    },
    build: (ctx, d) => settingsPage(ctx, d),
  }),
];

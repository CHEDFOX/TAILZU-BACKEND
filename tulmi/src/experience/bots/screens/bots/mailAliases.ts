/**
 * A DOMAIN'S ADDRESSES (ALIASES) AND ITS RULES (docs/mail.md section 9), as Xooteq Mail's settings have them.
 *
 *   bots.mail.addresses  params b: every address of the domain (the main one, then each alias), each with its folder, how it answers and
 *                        whether it auto-replies; another alias added with its folder's name. Mail to any of them arrives in All mail and in
 *                        that address's folder
 *   bots.mail.address    params b, aid: one address: its folder's name (an alias's), the name people see it from, how the AI answers it
 *                        (Drafts, Sends, Off), its auto-reply (on or off, subject, message, once per sender every 1, 3 or 7 days); an alias is
 *                        removed on a second yes
 *   bots.mail.rules      params b: each rule as a sentence ("When From contains invoice: move to Billing"), on or off, removed; another added
 *                        from one condition and one action. Rules run on each message as it arrives, in order, before the AI reads it
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, row, col, text, C, card, chip, chips, meta, notice, primaryButton, secondaryButton, quietButton, listCard, listRow,
  sectionLabel, call, seq, when, SCREENS, statusMark, switchRow,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import { bizParam, MAIL, type MailAddressView, type MailBusinessView, MODE_WORDS, type RuleView } from "./mailParts.js";
import { isDesk, setState } from "./parts.js";

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];
const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const aidParam = (v: unknown): string => (/^[1-9][0-9]{0,11}$/.test(String(v ?? "")) ? String(v) : "");
const openAddress = (b: string, aid: number): ActionSpec => ({ kind: "navigate", screenId: SCREENS.mailAddress, params: { b, aid: String(aid) } });
export const openAddresses = (b: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.mailAddresses, params: { b } });
export const openRules = (b: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.mailRules, params: { b } });

/** "Support folder · Drafts for you · Auto-reply on": an address in a line. */
function addressLine(a: MailAddressView): string {
  return [a.isPrimary ? "The main address" : `${a.label || "Its"} folder`, MODE_WORDS[a.aiMode] ?? "", a.autoReply?.enabled ? "Auto-reply on" : ""].filter(Boolean).join(" · ");
}

export type AddressesData = { business?: MailBusinessView };

export function addressesPage(ctx: BotsCtx, d: AddressesData | undefined) {
  const b = bizParam(ctx.params.b);
  const biz = d?.business;
  const desk = isDesk(ctx);
  if (!biz) return page(ctx, { back: true, backTitle: "Addresses", title: "Addresses", body: [notice("This couldn't be read just now. Try again in a moment.")] });
  const add: ActionSpec = {
    kind: "condition", if: { truthy: "ma_local" },
    then: call("POST", `${MAIL}/businesses/${b}/addresses`, { local: "$state.ma_local", label: "$state.ma_label" }, {
      ok: seq(setState("ma_local", ""), setState("ma_label", ""), said("Added. Its mail has a folder of its own."), refresh),
      fail: toast("Couldn't add it. Use letters, numbers, dots or dashes before the @."),
    }),
    else: toast(`Type the part before @${biz.domain}, like support.`),
  } as ActionSpec;
  return page(ctx, {
    back: true, backTitle: "Addresses", title: `Addresses of ${biz.domain}`, ...(desk ? { maxWidth: 720 } : {}),
    body: [
      col([
        text(biz.domain, { size: 20, weight: 600, lineHeight: 25, tracking: -0.3 }),
        meta("Mail to any of these arrives in All mail and in that address's own folder. Each can answer in its own way.", { size: 13, lineHeight: 18 }),
      ], { gap: 6 }),
      listCard(biz.addresses.map((a) => listRow({ label: a.email, sub: addressLine(a), onPress: openAddress(b, a.id) }))),
      col([
        sectionLabel("Another address"),
        // A text that starts with "@" is read as a mention by the apps: the domain is named in a sentence instead.
        meta(`The part before @${biz.domain}, and its folder's name. Add as many as you need.`, { size: 13, lineHeight: 18 }),
        mailField("ma_local", "support", desk, { label: "the part before the @", keyboard: "email" }),
        mailField("ma_label", "Its folder's name, like Support", desk, { label: "the folder's name", capitalize: true }),
        secondaryButton("Add address", add, { size: "md" }),
      ], { gap: 8 }),
    ],
    state: { ma_local: "", ma_label: "" },
    gap: 18,
  });
}

export type AddressData = { business?: MailBusinessView };

export function addressPage(ctx: BotsCtx, d: AddressData | undefined) {
  const b = bizParam(ctx.params.b), aid = aidParam(ctx.params.aid);
  const desk = isDesk(ctx);
  const a = d?.business?.addresses.find((x) => String(x.id) === aid);
  if (!d?.business || !a) return page(ctx, { back: true, backTitle: "Address", title: "Address", body: [notice("This address couldn't be found. It may have been removed.")] });
  const A = `${MAIL}/businesses/${b}/addresses/${a.id}`;
  const mode = (m: "draft" | "send" | "off"): ActionSpec => call("PUT", A, { aiMode: m }, { ok: seq(said(`${MODE_WORDS[m]}.`), refresh), fail: toast("Couldn't change that. Try again.") }) as ActionSpec;
  const save = call("PUT", A, {
    ...(a.isPrimary ? {} : { label: "$state.ma_label" }), displayName: "$state.ma_name",
    autoReplyEnabled: "$state.ma_auto", autoReplySubject: "$state.ma_subject", autoReplyBody: "$state.ma_body", autoReplyDays: "$state.ma_days",
  }, { ok: said("Saved."), fail: toast("Couldn't save it. An auto-reply that is on needs a message.") });
  const remove = call("DELETE", A, undefined, {
    ok: seq(said("Removed."), { kind: "navigate", screenId: SCREENS.mailAddresses, params: { b }, replace: true } as ActionSpec),
    fail: toast("Couldn't remove it. Try again."),
  });
  const r = a.autoReply;
  const label = (s: string, sub?: string): Node => col([text(s, { size: 15, weight: 600, lineHeight: 20 }), ...(sub ? [meta(sub, { size: 12, lineHeight: 16 })] : [])], { gap: 2 });
  return page(ctx, {
    back: true, backTitle: a.email, title: a.email, ...(desk ? { maxWidth: 720 } : {}),
    body: [
      ...(a.isPrimary ? [] : [col([label("Folder", "Its mail is filed here, and stays in All mail."), mailField("ma_label", "Support", desk, { label: "the folder's name", capitalize: true })], { gap: 8 })]),
      col([label("Sends as", "The name people see it from. Empty: the business's name."), mailField("ma_name", d.business.name, desk, { label: "the name it sends as", capitalize: true })], { gap: 8 }),
      col([label("How the AI answers it"), row((["draft", "send", "off"] as const).map((m) => chip(MODE_WORDS[m]!, { selected: a.aiMode === m, onPress: mode(m) })), { gap: 6, flexWrap: "wrap" })], { gap: 8 }),
      col([
        listCard([switchRow("Auto-reply", "ma_auto", { sub: "A short note back to everyone who writes, even while the AI drafts or a person is away." })]),
        when({ truthy: "ma_auto" }, col([
          mailField("ma_subject", "Subject, like Thanks, we've got your message", desk, { label: "the auto-reply's subject" }),
          mailField("ma_body", "We usually answer within a working day.", desk, { label: "the auto-reply's message", multiline: true, minHeight: 110 }),
          col([meta("Once per sender every", { size: 12 }), chips([{ label: "Day", value: "1" }, { label: "3 days", value: "3" }, { label: "Week", value: "7" }], "ma_days")], { gap: 6 }),
        ], { gap: 10 })),
      ], { gap: 10 }),
      ...(a.isPrimary ? [] : [col([
        when({ falsy: "ma_sure" }, quietButton(`Remove ${a.email}`, setState("ma_sure", true), { size: "md" })),
        when({ truthy: "ma_sure" }, card([
          row([statusMark("failed", { size: 10 }), text(`Remove ${a.email}?`, { size: 15, weight: 600, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 8, alignItems: "center" }),
          meta("Mail sent to it afterwards is not received. Its folder and the mail in it stay.", { size: 13, lineHeight: 18 }),
          row([primaryButton("Remove", remove, { size: "md" }), quietButton("Cancel", setState("ma_sure", false), { size: "md" })], { gap: 8 }),
        ], { gap: 10 })),
      ], { gap: 8 })]),
    ],
    footer: [primaryButton("Save", save, { wide: true })],
    state: {
      ma_label: a.label, ma_name: a.displayName, ma_auto: !!r?.enabled, ma_subject: r?.subject ?? "", ma_body: r?.body ?? "",
      ma_days: String(r?.days && [1, 3, 7].includes(r.days) ? r.days : 1), ma_sure: false,
    },
    gap: 20,
  });
}

export type RulesData = { rules?: RuleView[]; business?: MailBusinessView };

const FIELDS = [{ label: "From", value: "from" }, { label: "To", value: "to" }, { label: "Subject", value: "subject" }, { label: "Message", value: "body" }];
const DOS = [{ label: "Move to folder", value: "move" }, { label: "Mark as read", value: "read" }, { label: "Star", value: "star" }, { label: "Forward to", value: "forward" }, { label: "Delete", value: "delete" }];

export function rulesPage(ctx: BotsCtx, d: RulesData | undefined) {
  const b = bizParam(ctx.params.b);
  const desk = isDesk(ctx);
  if (!d?.rules) return page(ctx, { back: true, backTitle: "Rules", title: "Rules", body: [notice("The rules couldn't be read just now. Try again in a moment.")] });
  const R = `${MAIL}/businesses/${b}/rules`;
  const add: ActionSpec = {
    kind: "condition", if: { truthy: "mr_value" },
    then: call("POST", R, { field: "$state.mr_field", op: "contains", value: "$state.mr_value", action: "$state.mr_action", target: "$state.mr_target" }, {
      ok: seq(setState("mr_value", ""), setState("mr_target", ""), said("Added. It runs on new mail from now on."), refresh),
      fail: toast("Couldn't add it. Moving needs a folder's name; forwarding needs an email address."),
    }),
    else: toast("Say what to look for."),
  } as ActionSpec;
  const rows = d.rules.map((r) => card([
    row([
      statusMark(r.enabled ? "done" : "waiting", { size: 9 }),
      text(r.line, { size: 14, lineHeight: 19, style: { flexShrink: 1, color: r.enabled ? C.ink : C.meta } }),
    ], { gap: 10, alignItems: "flex-start" }),
    row([
      quietButton(r.enabled ? "Turn off" : "Turn on", call("POST", `${R}/${r.id}/toggle`, {}, { ok: refresh, fail: toast("Couldn't change it. Try again.") }), { size: "md" }),
      quietButton("Remove", call("DELETE", `${R}/${r.id}`, undefined, { ok: seq(said("Removed."), refresh), fail: toast("Couldn't remove it. Try again.") }), { size: "md" }),
    ], { gap: 4 }),
  ], { gap: 6, padding: 14 }));
  const label = (s: string) => text(s, { size: 12, weight: 600, tracking: 0.4, upper: true, color: C.meta, lineHeight: 15 });
  return page(ctx, {
    back: true, backTitle: "Rules", title: "Rules", ...(desk ? { maxWidth: 720 } : {}),
    body: [
      col([
        text(`Rules for ${d.business?.domain ?? "this domain"}`, { size: 20, weight: 600, lineHeight: 25, tracking: -0.3 }),
        meta("Each runs on every message as it arrives, in this order, before the AI reads it.", { size: 13, lineHeight: 18 }),
      ], { gap: 6 }),
      ...(rows.length ? rows : [meta("No rules yet.", { size: 13 })]),
      col([
        sectionLabel("Another rule"),
        label("When"), chips(FIELDS, "mr_field"),
        mailField("mr_value", "contains… like invoice", desk, { label: "what to look for" }),
        label("Then"), chips(DOS, "mr_action"),
        when({ any: [{ eq: ["mr_action", "move"] }, { eq: ["mr_action", "forward"] }] }, mailField("mr_target", "A folder's name, or an email address to forward to", desk, { label: "where to" })),
        secondaryButton("Add rule", add, { size: "md" }),
      ], { gap: 8 }),
    ],
    state: { mr_field: "from", mr_value: "", mr_action: "move", mr_target: "" },
    gap: 16,
  });
}

export const mailAliasScreens: BotsScreen[] = [
  screen<AddressesData>({
    id: SCREENS.mailAddresses,
    load: async (ctx, deps: Deps) => {
      const b = bizParam(ctx.params.b);
      const business = b ? await deps.api<{ business: MailBusinessView }>("GET", `${MAIL}/businesses/${b}`).then((r) => r.business).catch(() => undefined) : undefined;
      return business ? { business } : {};
    },
    build: (ctx, d) => addressesPage(ctx, d),
  }),
  screen<AddressData>({
    id: SCREENS.mailAddress,
    load: async (ctx, deps: Deps) => {
      const b = bizParam(ctx.params.b);
      const business = b ? await deps.api<{ business: MailBusinessView }>("GET", `${MAIL}/businesses/${b}`).then((r) => r.business).catch(() => undefined) : undefined;
      return business ? { business } : {};
    },
    build: (ctx, d) => addressPage(ctx, d),
  }),
  screen<RulesData>({
    id: SCREENS.mailRules,
    load: async (ctx, deps: Deps) => {
      const b = bizParam(ctx.params.b);
      if (!b) return {};
      const [rules, business] = await Promise.all([
        deps.api<{ rules: RuleView[] }>("GET", `${MAIL}/businesses/${b}/rules`).then((r) => r.rules).catch(() => undefined),
        deps.api<{ business: MailBusinessView }>("GET", `${MAIL}/businesses/${b}`).then((r) => r.business).catch(() => undefined),
      ]);
      return { ...(rules ? { rules } : {}), ...(business ? { business } : {}) };
    },
    build: (ctx, d) => rulesPage(ctx, d),
  }),
];

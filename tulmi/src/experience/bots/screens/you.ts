/**
 * THE YOU TAB AND WHAT HANGS OFF IT: You, Usage, Billing, What pings you, Privacy, Delete account, Connected apps, Connect an
 * app, and the window's Settings (You.dc.html, Billing, Notify, Privacy, DeleteAcct, Apps, AppConnect and their D* / Desk* desktop
 * boards; Usage takes the Budget board's place, at bots.usage and the old bots.budget). Plans and Language are built in screens/firstRun.ts
 * (once first-run steps, now pages); they are linked, not built, here.
 *
 * NO MONEY ON ANY OF THEM: no cost, no price, no amount. Use is the usage meter (src/you/usage.ts), the way other AI assistants show it: "This stretch ·
 * 64% used · resets Thu 9 am", "This month · 40% used", a calm line near the limit, and at it a bigger plan offered as an action (the store's
 * own sheet shows its price). Every number is the person's own, from the routes in routes/bots/botsYou.ts (src/you): the meter, the plan and its
 * dates from billing, the connected apps from connectors. A read that fails draws the honest empty state
 * (or ctx.live's meter), never a sample. Every control writes: PUT /v1/you/settings, the existing connector, job, billing and account routes,
 * then a refresh and a short ink toast.
 *
 * Built with the kit (../kit.ts) the way screens/shell.ts builds bots.home; one id serves the phone and the window (ctx.client).
 */

import { spaceScreens } from "./you/space.js";
import type { Node, ActionRef } from "../../../../../shared/types/sdui.js";
import {
  type BotsCtx, type IconName, box, icon, C, row, FACE, text, whenEq, seq, botAvatar, percent, primaryButton, open, SCREENS, usageMeter,
  whenWords, card, divider, notice, page, title, col, meta, call, listCard, listRow, quietButton, secondaryButton, switchMark, when,
  sectionLabel, switchRow, body, grow, table, button, back, emptyState, shapes, botLook, botRoute,
} from "../kit.js";
import { type BotsScreen, screen } from "../registry.js";
import { type DeletionState, dayMonthOf, goneAt, daysStrip, GRACE_DAYS, keepAccount, scheduleDeletion, DELETION_PATH } from "./accountGrace.js";
import { PUSH_STATE, withPushCheck, pushOffRow } from "./pushAsk.js";
import { type DeleteData, goesAway, planWarning, type AccountData, deleteDesk } from "./you/deleteDesk.js";
import {
  when2, type NotifyData, notifyState, alwaysOn, doneSeg, timeChip, summarySwitch, timePicker, summaryPreview, botSwitch, botSub,
  quietSwitch, quietTimes, save, notifyDesk,
} from "./you/notifyDesk.js";
import { type SettingsData, settingsCard } from "./you/settingsCard.js";
import { glyph, G, couldNot, heading, columns, openUrl, toast, refresh, oops, dayMonth, exportAction, plural } from "./you/parts.js";
import {
  type UsageMeter, spanLabel, resetsLine, meterOf, ring, type YouData, ago, face, youName, signOut, appsLine, youDesk,
  youPhone,
} from "./you/you.js";

interface UsagePage { usage: UsageMeter; near: string | null; out: string | null; how: string }

/** An invoice, as much as the screens show: when, which, what for, Razorpay's own page. No amount. */
interface Invoice { id: string; number: string; date: number; status: string; url: string | null; what: string }
interface BillingData {
  plan: { name: string; active: boolean; store: string | null; renews: boolean; until: number | null; since: number | null; paidBy: string | null; cancel: "razorpay" | "store" | null; manageUrl: string | null };
  invoices: Invoice[];
  usage: UsageMeter | null;
  email: string | null;
}

interface AppsData {
  enabled: boolean;
  connected: Array<{ id: string; name: string; category: string; level: string; lastUsedAt: number | null; usedBy: string[]; needsSignIn?: boolean }>;
  more: Array<{ id: string; name: string; category: string; oneLine: string; usedBy: string[] }>;
  github: { repos: number } | null;
}
interface AppData {
  app: { id: string; name: string; category: string; oneLine: string; auth: "oauth" | "url"; provider: string | null; connected: boolean; level: string; lastUsedAt: number | null };
  bots: Array<{ slug: string; name: string; colour: string; purpose: string; builtin: boolean; linked: boolean }>;
  can: string[];
  cant: string[];
}

const botByName = (ctx: BotsCtx, name: string) => ctx.live.bots.find((b) => b.name === name);

const APP_ICON: Record<string, IconName> = { Calendar: "calendar", Tasks: "check", Docs: "notes", Code: "code", School: "book", Projects: "today", Notes: "notes", "Meeting notes": "notes" };
function appIcon(category: string, size = 20): Node {
  return box([category === "Email" ? glyph(G.mail, size) : icon(APP_ICON[category] ?? "link", { size })], {
    width: size + 16, height: size + 16, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

/** A text input in an outlined box, into a state path. */
function field(path: string, placeholder: string, o: { keyboard?: "numeric" | "url" } = {}): Node {
  return row([{
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 40, color: C.ink,
      ...(o.keyboard === "numeric" ? { keyboardType: "number-pad" } : o.keyboard === "url" ? { keyboardType: "url", autoCapitalize: "none" } : {}),
    },
    style: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 40, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 15, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none" },
  }], { borderWidth: 1, borderColor: C.outline, borderRadius: 12, paddingHorizontal: 14, minHeight: 44 });
}

/** A selected-or-not pill that saves on press (the state follows on both clients). */
function pills(options: Array<{ label: string; value: string }>, path: string, onPick: (value: string) => ActionRef): Node {
  return row(options.map((opt) => row([text(opt.label, { size: 13, lineHeight: 17, style: { color: whenEq(path, opt.value, C.paper, C.ink) } })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq(path, opt.value, C.ink, C.outline), backgroundColor: whenEq(path, opt.value, C.ink, C.paper),
  }, seq({ kind: "setState", path, value: opt.value }, onPick(opt.value)))), { gap: 8, flexWrap: "wrap" });
}

/** A row of overlapping-free little avatars for bots named in a list ("Plan Ease", "Gym bot"). */
const avatarsOf = (ctx: BotsCtx, names: string[], size = 16): Node[] =>
  names.slice(0, 4).map((n) => { const b = botByName(ctx, n); return b ? botAvatar(b, size) : box([], { width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface }); });

/** "64% of this stretch". */
const usedLine = (m: { used: number; windows: boolean }) => `${percent(m.used)} of this ${m.windows ? "stretch" : "month"}`;

// ===================================================================== bots.usage (and bots.budget, its old link)

/** The five stretches of the month as one bar: each as wide as its days, the ones gone in ink, this one half. */

/** The way out at the limit: a bigger plan, as an action (the store's own sheet shows its price). None while nothing is for sale. */
const upgradeButton = (u: UsageMeter, o: { wide?: boolean; size?: "md" | "lg" } = {}): Node[] =>
  u.plan.upgrade ? [primaryButton("Get more with a plan", open(SCREENS.plans), { wide: o.wide ?? true, ...(o.size ? { size: o.size } : {}) })] : [];

function usageBody(ctx: BotsCtx, d: UsagePage): Node[] {
  const u = d.usage;
  const stretch = usageMeter(spanLabel(u.plan.windows), u.stretch.used, { resets: resetsLine(ctx, u.stretch.resetsAt) });
  const month = u.plan.windows ? [usageMeter("This month", u.month.used, { resets: `Starts again ${whenWords(u.month.resetsAt, ctx.live.now, ctx.tzOffsetMinutes)}` })] : [];
  // The meters, and a word when it is nearly or all used. Nothing explaining how it works: the meters say it.
  return [
    card([stretch, ...month.flatMap((m) => [divider(), m])], { gap: 16, padding: 18 }),
    ...(d.out ? [notice(d.out, { ink: true })] : d.near ? [notice(d.near)] : []),
  ];
}

function usagePhone(ctx: BotsCtx, d: UsagePage | undefined) {
  if (!d) {
    const m = meterOf(ctx, null);
    return page(ctx, { back: true, nav: "you", title: "Usage", body: [title("Usage"), usageMeter(spanLabel(m.windows), m.used, { resets: resetsLine(ctx, m.resetsAt) }), couldNot("your usage")] });
  }
  return page(ctx, {
    back: true, nav: "you", title: "Usage", gap: 18,
    body: [col([title("Usage"), meta(`${d.usage.plan.name} plan`, { size: 14, color: C.grey70 })], { gap: 4 }), ...usageBody(ctx, d)],
    ...(d.usage.plan.upgrade && d.usage.state !== "ok" ? { footer: upgradeButton(d.usage) } : {}),
  });
}

function usageDesk(ctx: BotsCtx, d: UsagePage | undefined) {
  if (!d) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Usage", maxWidth: 1040, body: [heading(ctx, "Usage"), couldNot("your usage")] });
  const u = d.usage;
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Usage", maxWidth: 1040, gap: 20,
    body: [
      heading(ctx, "Usage", `${u.plan.name} plan · how much of it is used`),
      columns(usageBody(ctx, d), [
        card([
          row([ring(u.stretch.used, 132), col([
            text(spanLabel(u.plan.windows), { size: 15, weight: 600 }),
            meta(resetsLine(ctx, u.stretch.resetsAt), { size: 13 }),
            ...(u.plan.windows ? [meta(`This month · ${percent(u.month.used)} used`, { size: 13 })] : []),
          ], { gap: 4, flexShrink: 1 })], { gap: 18, alignItems: "center" }),
          ...(u.plan.upgrade ? [divider(), ...upgradeButton(u, { wide: false, size: "md" })] : []),
        ], { padding: 20, gap: 14 }),
      ], { rightWidth: 360 }),
    ],
  });
}

// ===================================================================== bots.billing

function cancelAction(p: BillingData["plan"]): ActionRef | undefined {
  if (p.cancel === "store" && p.manageUrl) return openUrl(p.manageUrl);
  if (p.cancel !== "razorpay") return undefined;
  return when2("cancelSure",
    call("POST", "/v1/billing/razorpay/cancel", {}, { ok: seq(toast(`Cancelled. ${p.name} stays till the end of what you paid for.`), refresh), fail: oops("cancel the plan") }),
    seq({ kind: "setState", path: "cancelSure", value: true }, toast("Tap Cancel plan again to cancel")));
}
const cancelLine = (ctx: BotsCtx, p: BillingData["plan"]) =>
  p.cancel === "store" ? `Cancel in ${p.paidBy ?? "your app store"}. Your bots and projects stay.`
    : `Two taps. ${p.until ? `${p.name} stays till ${dayMonth(ctx, p.until)}, ` : ""}your bots and projects stay too.`;


function billingPhone(ctx: BotsCtx, d: BillingData | undefined) {
  if (!d) return page(ctx, { back: true, nav: "you", title: "Plan and billing", body: [title("Plan and billing"), couldNot("your plan")] });
  const p = d.plan;
  const cancel = cancelAction(p);
  // The least there is: the plan, when it renews, how much is used. Receipts and reminders come from whoever took the
  // payment (the App Store, Google Play, Razorpay, the UPI app), so none of that is repeated here.
  return page(ctx, {
    back: true, nav: "you", title: "Plan and billing", gap: 18, state: { cancelSure: false },
    body: [
      title("Plan and billing"),
      listCard([
        listRow({ label: "Plan", value: p.name }),
        ...(p.active && p.until ? [listRow({ label: p.renews ? "Renews" : "Ends", value: dayMonth(ctx, p.until) })] : []),
        ...(d.usage ? [listRow({ label: "Usage", value: usedLine(meterOf(ctx, d.usage)), onPress: open(SCREENS.usage) })] : []),
      ]),
    ],
    footer: [
      primaryButton(p.active ? "Change plan" : "See plans", open(SCREENS.plans), { wide: true }),
      ...(cancel ? [col([quietButton("Cancel plan", cancel, { wide: true }), meta(cancelLine(ctx, p), { size: 12, align: "center" })], { gap: 2 })] : []),
    ],
  });
}

function billingDesk(ctx: BotsCtx, d: BillingData | undefined) {
  if (!d) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Plan and billing", maxWidth: 1040, body: [heading(ctx, "Plan and billing"), couldNot("your plan")] });
  const p = d.plan;
  const cancel = cancelAction(p);
  // As on the phone: the plan, when it renews, how much is used; change it or cancel it. Receipts are Razorpay's.
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Plan and billing", maxWidth: 640, gap: 20, state: { cancelSure: false },
    body: [
      heading(ctx, "Plan and billing"),
      listCard([
        listRow({ label: "Plan", value: p.name }),
        ...(p.active && p.until ? [listRow({ label: p.renews ? "Renews" : "Ends", value: dayMonth(ctx, p.until) })] : []),
        ...(d.usage ? [listRow({ label: "Usage", value: usedLine(meterOf(ctx, d.usage)), onPress: open(SCREENS.usage) })] : []),
      ]),
      row([
        secondaryButton(p.active ? "Change plan" : "See plans", open(SCREENS.plans), { size: "md" }),
        ...(cancel ? [quietButton("Cancel plan", cancel, { size: "md" })] : []),
        ...(cancel ? [meta(cancelLine(ctx, p), { size: 12, style: { flexShrink: 1 } })] : []),
      ], { gap: 10 }),
    ],
  });
}

function notifyPhone(ctx: BotsCtx, d: NotifyData | undefined) {
  if (!d) return page(ctx, { back: true, nav: "you", title: "What pings you", body: [title("What pings you"), couldNot("your settings")] });
  const s = d.settings;
  return page(ctx, {
    back: true, nav: "you", title: "What pings you", gap: 18, state: { ...notifyState(s, ctx), ...PUSH_STATE },
    body: [
      // While this phone does not allow notifications, it says so first (screens/pushAsk.ts); the title reads the phone's answer.
      withPushCheck(ctx, title("What pings you")),
      ...pushOffRow(ctx),
      listCard([
        listRow({ left: box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ink }), label: "Needs you", sub: "A bot is waiting on your answer", right: alwaysOn(), chevron: false }),
        listRow({ left: box([], { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.ink }), label: "Done", sub: "Quiet: no sound. Ping: with sound", right: doneSeg(116), chevron: false }),
        row([
          glyph(G.rules, 18),
          col([text("Daily summary", { size: 15 }), row([meta("One note at", { size: 12 }), timeChip("sum", s.notify.summaryAt)], { gap: 8 })], { flexGrow: 1, flexShrink: 1, gap: 6 }),
          box([switchMark("summary")], { minHeight: 44, justifyContent: "center" }, summarySwitch()),
        ], { gap: 12, paddingVertical: 10, paddingHorizontal: 16 }),
      ]),
      timePicker("sum", "summaryAt", "Summary time changed"),
      when({ truthy: "summary" }, summaryPreview(ctx, d)),
      col([
        sectionLabel("By bot"),
        listCard(ctx.live.bots.map((b) => { const sw = botSwitch(b.slug); return switchRow(b.name, sw.path, { left: botAvatar(b, 28), ...(botSub(b.slug) ? { sub: botSub(b.slug)! } : {}), onChange: sw.saveIt }); })),
        meta("A bot turned off still reaches you when it needs you.", { size: 12 }),
      ], { gap: 8 }),
      card([
        row([glyph(G.moon, 18), col([text("Quiet hours", { size: 15, weight: 500 }), meta("Every night", { size: 12 })], { flexGrow: 1, gap: 2 }), switchMark("quiet")], { gap: 12 }, quietSwitch()),
        quietTimes(s),
        meta("Bots keep working. Done waits in Activity. Needs you still reaches you, without sound.", { size: 12, lineHeight: 17 }),
      ], { gap: 10, padding: 16 }),
    ],
  });
}

// ===================================================================== bots.privacy
const KEPT: Array<[string, string, string]> = [
  ["Chats with your bots", "What they remember. Forget any of it", "Till you delete"],
  ["What you ask on your phone", "The first 80 characters, for Activity", "30 days"],
  ["Keylessbord voice", "Only the text stays, if you keep history", "Not kept"],
  ["Screen pictures", "Only ones you allowed, while answering", "Not kept"],
  ["Your account and bots", "Projects, settings, connected apps", "Till you delete"],
];
const NEVER = ["Sell your data, to anyone", "Train AI models on your data", "Open folders you didn't share"];

const deleteData: ActionRef = when2("sureData",
  call("POST", "/v1/you/data/delete", {}, { ok: seq(toast("Chats, notes and files deleted"), { kind: "setState", path: "sureData", value: false }, refresh), fail: oops("delete that") }),
  seq({ kind: "setState", path: "sureData", value: true }, toast("Tap Delete my data again to delete")));

function neverList(): Node {
  return col(NEVER.map((n) => row([glyph(G.never, 16), body(n, { size: 14 })], { gap: 10 })), { gap: 10 });
}

const clearPersonal: ActionRef = when2("surePersonal",
  call("POST", "/v1/you/personal/clear", {}, { ok: seq(toast("Cleared"), { kind: "setState", path: "surePersonal", value: false }), fail: oops("clear that") }),
  seq({ kind: "setState", path: "surePersonal", value: true }, toast("Tap Clear again to clear")));

/** What the person told their bots, used by all of them (src/bots/shared.ts): on unless they turn it off, and cleared here. */
function personalCard(d: YouData | undefined): Node {
  const on = d?.settings.privacy.personalise !== false;
  return col([
    listCard([switchRow("Use what you've told your bots", "personal", {
      sub: "Every bot's answers fit you. Never health, religion, politics or money.",
      onChange: save({ privacy: { personalise: !on } }, on ? "Turned off" : "Turned on"),
    })]),
    row([quietButton("See what they know", open(SCREENS.youSpace), { size: "md" }), grow(), quietButton("Clear", clearPersonal, { size: "md" })]),
  ], { gap: 4 });
}

function privacyPhone(ctx: BotsCtx, d: YouData | undefined) {
  return page(ctx, {
    back: true, nav: "you", title: "Privacy", gap: 18, state: { sureData: false, surePersonal: false, personal: d?.settings.privacy.personalise !== false },
    body: [
      title("Privacy"),
      col([sectionLabel("What we keep, and for how long"), listCard(KEPT.map(([l, , v]) => listRow({ label: l, value: v })))], { gap: 8 }),
      col([sectionLabel("What we never do"), neverList()], { gap: 10 }),
      personalCard(d),
    ],
    footer: [
      secondaryButton("Download my data", exportAction(d?.exportUrl ?? null), { wide: true, icon: undefined }),
      col([quietButton("Delete my data", deleteData, { wide: true }), meta("Chats, notes and files go. Your account and plan stay.", { size: 12, align: "center" })], { gap: 0 }),
      // The whole account, from the phone too (App Store guideline 5.1.1(v)): You › Your data › Delete account.
      col([quietButton("Delete account", open(SCREENS.deleteAccount), { wide: true }), meta("Your whole account, with 7 days to change your mind.", { size: 12, align: "center" })], { gap: 0 }),
    ],
  });
}

function privacyDesk(ctx: BotsCtx, d: YouData | undefined) {
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Privacy", maxWidth: 1040, gap: 20, state: { sureData: false, surePersonal: false, personal: d?.settings.privacy.personalise !== false },
    body: [
      heading(ctx, "Privacy", "What we keep, and for how long"),
      columns([
        table([{ label: "What", flex: 2 }, { label: "Kept for", flex: 1 }], KEPT.map(([l, s, v]) => [col([text(l, { size: 14 }), meta(s, { size: 12 })], { gap: 2 }), text(v, { size: 14, weight: 500 })])),
        card([
          sectionLabel("Your data"),
          row([
            button("Download my data", exportAction(d?.exportUrl ?? null), { kind: "secondary", size: "md" }),
            button("Delete my data", deleteData, { kind: "secondary", size: "md" }),
          ], { gap: 10 }),
          meta("Delete: chats, notes and files go. Your account and plan stay.", { size: 12 }),
          divider(),
          row([text("Delete the whole account instead", { size: 14 }), grow(), icon("chevron", { size: 16, color: C.meta })], {}, open(SCREENS.deleteAccount)),
        ], { padding: 20, gap: 12 }),
      ], [
        card([sectionLabel("What we never do"), neverList()], { padding: 20, gap: 12 }),
        personalCard(d),
      ]),
    ],
  });
}

/** The seven days under their strip: from today (or the day they asked) to the day it goes, and what that means. */
function graceBlock(ctx: BotsCtx, del: DeletionState | undefined): Node {
  const s = del?.scheduled;
  const from = s?.requestedAt ?? ctx.live.now, gone = dayMonthOf(ctx, goneAt(ctx, del));
  return col([
    daysStrip(ctx, from),
    row([meta(`${s ? "Asked on" : "Today,"} ${dayMonthOf(ctx, from)}`, { size: 12 }), grow(), meta(`Gone for good, ${gone}`, { size: 12 })]),
    text(s ? "Until then everything is kept, and your bots are stopped. Keep your account and they start again."
      : `You have ${GRACE_DAYS} days to change your mind. Sign in before ${gone} and everything comes back as it was.`, { size: 14, lineHeight: 20 }),
  ], { gap: 8 });
}

function deletePhone(ctx: BotsCtx, data: DeleteData | undefined) {
  const d = data?.account, del = data?.deletion;
  const gone = dayMonthOf(ctx, goneAt(ctx, del));
  if (del?.scheduled) {
    return page(ctx, {
      back: true, nav: "you", title: "Delete account", gap: 18,
      body: [
        heading(ctx, "Delete account", `Your account will be deleted on ${gone}.`),
        graceBlock(ctx, del),
        ...(d ? [col([sectionLabel("What goes then"), listCard(goesAway(ctx, d))], { gap: 8 })] : []),
      ],
      footer: [primaryButton("Keep my account", keepAccount, { wide: true })],
    });
  }
  const holdButton: Node = {
    ...button("Hold to delete", undefined, { wide: true }),
    on: { onPress: { kind: "toast", message: "Press and hold to delete" }, onLongPress: scheduleDeletion(gone) },
  };
  return page(ctx, {
    back: true, nav: "you", title: "Delete account", gap: 18,
    body: [
      heading(ctx, "Delete account", "Here is exactly what happens, so there are no surprises."),
      ...(d ? [
        col([sectionLabel("What goes away"), listCard(goesAway(ctx, d))], { gap: 8 }),
        graceBlock(ctx, del),
        ...planWarning(ctx, d),
        row([meta("Want a copy first? ", { size: 13 }), text("Download my data", { size: 13, weight: 500, style: { textDecorationLine: "underline" } })], {}, exportAction(d.exportUrl)),
      ] : [couldNot("what your account holds"), graceBlock(ctx, del)]),
    ],
    footer: [holdButton, meta("Press and hold. Let go any time to stop.", { size: 12, align: "center" }), secondaryButton("Keep my account", back(), { wide: true })],
  });
}

// ===================================================================== bots.apps
const LEVEL_WORDS: Record<string, string> = { look: "Reads only", draft: "Reads, drafts for your yes", send: "Reads and acts, asking first" };

function usedByNode(ctx: BotsCtx, names: string[], extra?: string): Node {
  return row([
    ...(names.length ? [row(avatarsOf(ctx, names, 14), { gap: 2 })] : []),
    meta(names.length ? `${names.map((n) => n.replace(/ bot$/i, "")).join(", ")}${extra ? ` · ${extra}` : ""}` : extra ?? "No bot uses it yet", { size: 12, lines: 1, style: { flexShrink: 1 } }),
  ], { gap: 6 });
}

function appsPhone(ctx: BotsCtx, d: AppsData | undefined) {
  const head = [title("Connected apps"), meta("Bots only use what you allowed. Tap one to change it.", { size: 14, color: C.grey70 })];
  if (!d) return page(ctx, { back: true, nav: "you", title: "Connected apps", body: [...head, couldNot("your apps")] });
  if (!d.enabled) return page(ctx, { back: true, nav: "you", title: "Connected apps", body: [...head, emptyState({ pose: "think", title: "Connected apps aren't on yet", body: "When they are, your bots can use GitHub, Docs and more." })] });
  const rows: Node[] = [
    ...(d.github ? [listRow({ left: appIcon("Code"), label: "GitHub", sub: `Used by Code · ${plural(d.github.repos, "repo")}`, onPress: open(SCREENS.code) })] : []),
    ...d.connected.map((a) => row([
      appIcon(a.category),
      col([text(a.name, { size: 15, lineHeight: 20 }), usedByNode(ctx, a.usedBy)], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 3 }),
      meta(a.needsSignIn ? "Sign in again" : ago(ctx, a.lastUsedAt), { size: 12 }),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }, open(SCREENS.appConnect, { id: a.id }))),
  ];
  return page(ctx, {
    back: true, nav: "you", title: "Connected apps", gap: 18,
    body: [
      ...head,
      rows.length ? col([sectionLabel(`Connected · ${rows.length}`), listCard(rows)], { gap: 8 })
        : emptyState({ pose: "hello", title: "No apps yet", body: "Connect one and your bots can work in it for you." }),
      ...(d.more.length ? [col([sectionLabel("Connect more"), listCard(d.more.slice(0, 4).map((a) => row([
        appIcon(a.category),
        col([text(a.name, { size: 15 }), meta(a.oneLine, { size: 12, lines: 1 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
        text("Connect", { size: 14, weight: 600 }),
      ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }, open(SCREENS.appConnect, { id: a.id }))))], { gap: 8 })] : []),
      meta("Disconnecting an app stops every bot that uses it.", { size: 12, align: "center" }),
    ],
  });
}

function appsDesk(ctx: BotsCtx, d: AppsData | undefined) {
  const head = heading(ctx, "Connected apps", "Bots only use what you allowed. Click one to change it.");
  if (!d) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Connected apps", maxWidth: 1040, body: [head, couldNot("your apps")] });
  if (!d.enabled) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "Connected apps", maxWidth: 1040, body: [head, emptyState({ pose: "think", title: "Connected apps aren't on yet", body: "When they are, your bots can use GitHub, Docs and more." })] });
  const list = [
    ...(d.github ? [{ id: "", name: "GitHub", category: "Code", usedBy: ["Xode"], extra: plural(d.github.repos, "repo"), can: "Read code, open pull requests. Never merges.", last: "", go: open(SCREENS.code) }] : []),
    ...d.connected.map((a) => ({ id: a.id, name: a.name, category: a.category, usedBy: a.usedBy, extra: undefined as string | undefined, can: LEVEL_WORDS[a.level] ?? "Reads only", last: a.needsSignIn ? "Sign in again" : ago(ctx, a.lastUsedAt), go: open(SCREENS.appConnect, { id: a.id }) })),
  ];
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "Connected apps", maxWidth: 1040, gap: 20,
    body: [
      head,
      list.length ? table([{ label: `Connected · ${list.length}`, flex: 2 }, { label: "Used by", flex: 2 }, { label: "Bots can", flex: 3 }, { label: "Last used", flex: 1 }],
        list.map((a) => [
          row([appIcon(a.category, 18), text(a.name, { size: 14, weight: 500, style: { flexShrink: 1 } })], { gap: 10 }),
          usedByNode(ctx, a.usedBy, a.extra), a.can, a.last,
        ]), { onRow: (i) => list[i]!.go })
        : emptyState({ pose: "hello", title: "No apps yet", body: "Connect one and your bots can work in it for you." }),
      ...(d.more.length ? [col([sectionLabel("Connect more"), row(d.more.slice(0, 3).map((a) => card([
        row([appIcon(a.category, 18), col([text(a.name, { size: 14, weight: 500 }), meta(a.oneLine, { size: 12, lines: 2 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 })], { gap: 10, alignItems: "flex-start" }),
        button("Connect", open(SCREENS.appConnect, { id: a.id }), { kind: "secondary", size: "md" }),
      ], { padding: 16, gap: 12, style: { flexGrow: 1, flexBasis: 0 } })), { gap: 14, alignItems: "stretch" })], { gap: 8 })] : []),
      meta("Disconnecting an app stops every bot that uses it.", { size: 12 }),
    ],
  });
}

// ===================================================================== bots.app-connect

/** Connect: the phone opens the sign-in page the route names; the window does it all with its own action. A pasted link goes in the body. */
function connectAction(ctx: BotsCtx, a: AppData["app"]): ActionRef {
  const done = seq(toast(`${a.name} connected`), refresh);
  if (ctx.client === "desktop") {
    return { kind: "connector.connect", id: a.id, ...(a.auth === "url" ? { urlPath: "url" } : {}), onSuccess: done, onError: oops("connect it") };
  }
  return call("POST", `/v1/connectors/${encodeURIComponent(a.id)}/connect`, a.auth === "url" ? { url: "$state.url" } : {}, {
    assignTo: "link",
    ok: when2("link.authorizeUrl", { kind: "openUrl", url: "$state.link.authorizeUrl" }, done),
    fail: oops("connect it"),
  });
}
const disconnect = (a: AppData["app"]): ActionRef =>
  call("DELETE", `/v1/connectors/${encodeURIComponent(a.id)}`, undefined, { ok: seq(toast(`${a.name} disconnected`), back()), fail: oops("disconnect it") });

function appHeader(a: AppData["app"]): Node {
  return row([
    box([shapes([{ circle: [12, 12, 2.2], fill: C.ink }, ...[[12, 4.5], [17.3, 6.7], [19.5, 12], [17.3, 17.3], [12, 19.5], [6.7, 17.3], [4.5, 12], [6.7, 6.7]].map(([x, y]) => ({ circle: [x!, y!, 1.2] as [number, number, number], fill: C.ink }))], { size: 22 })],
      { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" }),
    icon("more", { size: 18, color: C.meta }),
    appIcon(a.category, 22),
  ], { gap: 10 });
}

function canCards(d: AppData): Node {
  const list = (head: string, items: string[], mark: "check" | "close") => card([
    sectionLabel(head),
    ...items.map((x) => row([icon(mark, { size: 14 }), text(x, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" })),
  ], { padding: 14, gap: 10, style: { flexGrow: 1, flexBasis: 0 } });
  return row([list("It can", d.can, "check"), list("It can't", d.cant, "close")], { gap: 10, alignItems: "stretch" });
}

function botsUsing(d: AppData): Node {
  const rows = d.bots.map((b) => {
    const look = botLook(b.slug, b.colour);
    const path = `link_${b.slug.replace(/-/g, "_")}`;
    const toggle = seq({ kind: "toggleState", path }, when2(path,
      call("PUT", `/v1/bots/${b.slug}/connectors/${encodeURIComponent(d.app.id)}`, {}, { ok: seq(toast(`${b.name} can use it`), refresh), fail: oops() }),
      call("DELETE", `/v1/bots/${b.slug}/connectors/${encodeURIComponent(d.app.id)}`, undefined, { ok: seq(toast(`${b.name} won't use it`), refresh), fail: oops() })));
    return b.builtin
      ? listRow({ left: botAvatar(look, 28), label: b.name, sub: b.purpose.length > 44 ? `${b.purpose.slice(0, 43).trimEnd()}…` : b.purpose, right: alwaysOn("Always"), chevron: false })
      : listRow({ left: botAvatar(look, 28), label: b.name, sub: b.purpose.length > 44 ? `${b.purpose.slice(0, 43).trimEnd()}…` : b.purpose, right: switchMark(path), chevron: false, onPress: toggle });
  });
  return col([sectionLabel("Bots that will use it"), rows.length ? listCard(rows) : meta("No bot uses it yet. Make one that does, or ask any bot.", { size: 13 })], { gap: 8 });
}

function appConnectBody(ctx: BotsCtx, d: AppData): Node[] {
  const a = d.app;
  return [
    appHeader(a),
    heading(ctx, a.connected ? a.name : `Connect ${a.name}`, a.connected ? `Connected · last used ${ago(ctx, a.lastUsedAt).toLowerCase()}` : `${a.oneLine} Here is exactly what your bots get.`),
    canCards(d),
    botsUsing(d),
    ...(a.connected ? [col([
      sectionLabel("What bots may do"),
      pills([{ label: "Read only", value: "look" }, { label: "Draft for me", value: "draft" }, { label: "Act, asking first", value: "send" }], "level",
        (v) => call("POST", `/v1/connectors/${encodeURIComponent(a.id)}/level`, { level: v }, { ok: seq(toast("Changed"), refresh), fail: oops() })),
    ], { gap: 8 })] : []),
    ...(!a.connected && a.auth === "url" ? [col([sectionLabel("Its link"), field("url", "Paste the link from the app", { keyboard: "url" })], { gap: 8 })] : []),
  ];
}

function appConnect(ctx: BotsCtx, d: AppData | undefined) {
  const desk = ctx.client === "desktop";
  if (!d) {
    return page(ctx, { back: true, backTitle: desk ? "Connected apps" : undefined, nav: "you", title: "Connect an app", ...(desk ? { maxWidth: 1040 } : {}), body: [title("Connect an app"), couldNot("this app")] });
  }
  const a = d.app;
  const primary = a.connected ? secondaryButton("Disconnect", disconnect(a), { wide: !desk, size: desk ? "md" : "lg" })
    : primaryButton(a.provider === "google" ? "Connect with Google" : "Connect", connectAction(ctx, a), { wide: !desk, size: desk ? "md" : "lg" });
  const foot = meta(a.connected ? "Disconnecting stops every bot that uses it." : "Disconnect any time in You", { size: 12, align: desk ? "left" : "center" });
  const state = { url: "", level: a.level, ...Object.fromEntries(d.bots.map((b) => [`link_${b.slug.replace(/-/g, "_")}`, b.linked])) };
  if (!desk) return page(ctx, { back: true, nav: "you", title: `Connect ${a.name}`, gap: 18, state, body: appConnectBody(ctx, d), footer: [primary, foot] });
  return page(ctx, {
    back: true, backTitle: "Connected apps", nav: "you", title: `Connect ${a.name}`, maxWidth: 1040, gap: 20, state,
    body: [columns([...appConnectBody(ctx, d), row([primary, foot], { gap: 14 })], [
      card([
        sectionLabel("How it works"),
        ...[
          ["You connect it yourself", `${a.provider === "google" ? "Google" : a.name} asks you what to allow.`],
          ["Reading just happens", "A change asks you the first time, every time until you say it may."],
          ["Off any time", "Disconnect here or in You. Every bot stops using it at once."],
        ].map(([h, s]) => row([icon("check", { size: 14 }), col([text(h!, { size: 14, weight: 500 }), meta(s!, { size: 12, lineHeight: 17 })], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" })),
      ], { padding: 20, gap: 14 }),
    ], { rightWidth: 340 })],
  });
}

// ===================================================================== bots.settings (the window's)

/** The phone's Settings (the window's is a card of its own: you/settingsCard.ts). */
function settingsPage(ctx: BotsCtx, d: YouData | undefined) {
  const account = card([
    sectionLabel("Account"),
    row([face(ctx, 40), col([text(youName(ctx), { size: 15, weight: 600 }), meta(ctx.user?.email ?? "", { size: 12 })], { flexGrow: 1, flexShrink: 1, gap: 2 }), button("Sign out", signOut, { kind: "secondary", size: "md" })], { gap: 12 }),
    divider(),
    row([text("Plan", { size: 14 }), grow(), meta(d ? d.plan.name : "", { size: 13 }), icon("chevron", { size: 16, color: C.meta })], { gap: 8, minHeight: 32 }, open(SCREENS.billing)),
  ], { padding: 18, gap: 12 });
  const yours = listCard([
    listRow({ label: "Spaces and chats", value: "Family and friends", onPress: open(SCREENS.spaces) }),
    listRow({ label: "Usage", value: usedLine(meterOf(ctx, d?.usage)), onPress: open(SCREENS.usage) }),
    listRow({ label: "What pings you", value: d?.settings.notify.quiet ? "Quiet hours on" : "", onPress: open(SCREENS.notify) }),
    listRow({ label: "Connected apps", value: appsLine(d), onPress: open(SCREENS.apps) }),
  ]);
  const privacy = listCard([
    listRow({ label: "Privacy", onPress: open(SCREENS.privacy) }),
    listRow({ label: "Blocked people", onPress: open(SCREENS.blocked) }),
    listRow({ label: "Download my data", chevron: false, right: glyph(G.download, 18, C.meta), onPress: exportAction(d?.exportUrl ?? null) }),
    listRow({ label: "Delete account", onPress: open(SCREENS.deleteAccount) }),
  ]);
  const local = card([
    sectionLabel("On this phone"),
    meta("Your keyboard: its keys, haptics and how Keylessbord types.", { size: 13, lineHeight: 18 }),
    button("Keyboard settings", botRoute("keybot"), { kind: "secondary", size: "md" }),
  ], { padding: 18, gap: 10 });
  return page(ctx, {
    back: true, nav: "settings", title: "Settings", gap: 20,
    body: [title("Settings"), account, col([sectionLabel("Your bots"), yours], { gap: 8 }), col([sectionLabel("Your data"), privacy], { gap: 8 }), local],
  });
}

// ===================================================================== the list

const tz = (ctx: BotsCtx) => `tz=${Math.round(ctx.tzOffsetMinutes)}`;

export const youScreens: BotsScreen[] = [
  ...spaceScreens, // Your space (screens/you/space.ts)
  screen<YouData>({ id: SCREENS.you, load: (ctx, deps) => deps.api<YouData>("GET", `/v1/you?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? youDesk(ctx, d) : youPhone(ctx, d)) }),
  ...[SCREENS.usage, SCREENS.budget].map((id) => screen<UsagePage>({ id, load: (ctx, deps) => deps.api<UsagePage>("GET", `/v1/you/usage?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? usageDesk(ctx, d) : usagePhone(ctx, d)) })),
  screen<BillingData>({ id: SCREENS.billing, load: (ctx, deps) => deps.api<BillingData>("GET", `/v1/you/billing?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? billingDesk(ctx, d) : billingPhone(ctx, d)) }),
  screen<NotifyData>({ id: SCREENS.notify, load: (ctx, deps) => deps.api<NotifyData>("GET", `/v1/you/notify?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? notifyDesk(ctx, d) : notifyPhone(ctx, d)) }),
  screen<YouData>({ id: SCREENS.privacy, load: (ctx, deps) => deps.api<YouData>("GET", `/v1/you?${tz(ctx)}`), build: (ctx, d) => (ctx.client === "desktop" ? privacyDesk(ctx, d) : privacyPhone(ctx, d)) }),
  screen<DeleteData>({
    id: SCREENS.deleteAccount,
    load: async (_ctx, deps) => {
      const [account, deletion] = await Promise.all([
        deps.api<AccountData>("GET", "/v1/you/account").catch(() => undefined),
        deps.api<DeletionState>("GET", DELETION_PATH).catch(() => undefined),
      ]);
      return { account, deletion };
    },
    build: (ctx, d) => (ctx.client === "desktop" ? deleteDesk(ctx, d) : deletePhone(ctx, d)),
  }),
  screen<AppsData>({ id: SCREENS.apps, load: (_ctx, deps) => deps.api<AppsData>("GET", "/v1/you/apps"), build: (ctx, d) => (ctx.client === "desktop" ? appsDesk(ctx, d) : appsPhone(ctx, d)) }),
  screen<AppData>({
    id: SCREENS.appConnect,
    load: async (ctx, deps) => {
      const id = String(ctx.params.id ?? "");
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new Error("no app");
      return deps.api<AppData>("GET", `/v1/you/apps/${encodeURIComponent(id)}`);
    },
    build: (ctx, d) => appConnect(ctx, d),
  }),
  // The phone: its page, from the You page's answer. The window: a card with everything on it (you/settingsCard.ts), its apps too.
  screen<YouData | SettingsData>({
    id: SCREENS.settings,
    load: async (ctx, deps) => {
      if (ctx.client !== "desktop") return deps.api<YouData>("GET", `/v1/you?${tz(ctx)}`);
      const [you, apps] = await Promise.all([
        deps.api<SettingsData["you"]>("GET", `/v1/you?${tz(ctx)}`).catch(() => undefined),
        deps.api<SettingsData["apps"]>("GET", "/v1/you/apps?all=1").catch(() => undefined),
      ]);
      return { you, apps };
    },
    build: (ctx, d) => (ctx.client === "desktop" ? settingsCard(ctx, d as SettingsData | undefined) : settingsPage(ctx, d as YouData | undefined)),
  }),
];

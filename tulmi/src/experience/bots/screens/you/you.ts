/**
 * The You area's you screen, on the phone and in the window (youPhone, youDesk).
 */

import { type ActionSpec, type Node, BOT_SOUNDS_CAPABILITY, type ActionRef } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, box, shapes, C, percent, text, meta, whenWords, listCard, switchRow, page, row, col, open, SCREENS, card, usageMeter,
  listRow, icon, secondaryButton, grow, sectionLabel, button,
} from "../../kit.js";
import { type Settings, local, DAY_MS, dayMonth, clock, plural, columns, glyph, G, exportAction } from "./parts.js";

/** The usage meter (GET /v1/you/usage, src/you/usage.ts): fractions used (0.64 is 64%) and when each resets. Never an amount. */
export interface UsageMeter {
  plan: { id: string; name: string; paid: boolean; windows: boolean; carryOver: boolean; upgrade: boolean };
  stretch: { used: number; startsAt: number; resetsAt: number; n: number; of: number; days: number };
  month: { used: number; startsAt: number; resetsAt: number; days: number };
  state: "ok" | "near" | "out";
}

export interface YouData {
  plan: { name: string; active: boolean };
  usage: UsageMeter | null;
  apps: { enabled: boolean; connected: Array<{ id: string; name: string; usedBy: string[]; lastUsedAt: number | null }>; github: { repos: number } | null; alone: number } | null;
  settings: Settings;
  exportUrl: string | null;
  language: string | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const hhmm = (ctx: BotsCtx, t: number) => { const d = local(ctx, t); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
/** "In use now", "2 min ago", "Today 10:40", "Yesterday", "Mon", "14 Oct". */
export function ago(ctx: BotsCtx, t: number | null): string {
  if (!t) return "Not used yet";
  const now = ctx.live.now, mins = Math.floor((now - t) / 60_000);
  if (mins < 2) return "In use now";
  if (mins < 60) return `${mins} min ago`;
  const dayOf = (x: number) => Math.floor((x + ctx.tzOffsetMinutes * 60_000) / DAY_MS);
  const days = dayOf(now) - dayOf(t);
  if (days === 0) return `Today ${hhmm(ctx, t)}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return DAYS[local(ctx, t).getUTCDay()]!;
  return dayMonth(ctx, t);
}

/** Help: the whole app's, kept here (Keylessbord links nothing account-wide). */
const HELP = [
  { label: "Write to us", value: "support@x0bot.com", url: "mailto:support@x0bot.com" },
  { label: "Privacy policy", value: "", url: "https://x0bot.com/privacy" },
  { label: "Terms of use", value: "", url: "https://x0bot.com/terms" },
] as const;
const helpAction = (url: string): ActionSpec => ({ kind: "openUrl", url, external: true });

/** This stretch's ring: how much of it is used, with the share in the middle. Never an amount. */
export function ring(used: number, size: number, label = "used"): Node {
  const r = 15.5, circ = 2 * Math.PI * r, part = Math.max(0, Math.min(1, used));
  return box([
    box([shapes([
      { circle: [18, 18, r], stroke: C.divider, strokeWidth: 3 },
      ...(part > 0 ? [{ circle: [18, 18, r] as [number, number, number], stroke: C.ink, strokeWidth: 3, linecap: "round" as const, dash: `${(part * circ).toFixed(2)} ${circ.toFixed(2)}`, rotate: -90 }] : []),
    ], { size, viewBox: "0 0 36 36", label: `${percent(part)} ${label}` })], { position: "absolute", top: 0, left: 0 }),
    text(percent(part), { size: Math.round(size / 4.6), weight: 700, tracking: -0.6, align: "center" }),
    meta(label, { size: 12, align: "center" }),
  ], { width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 });
}

const youInitial = (ctx: BotsCtx) => (ctx.user?.name ?? ctx.user?.email ?? "Y").trim().charAt(0).toUpperCase() || "Y";
export const youName = (ctx: BotsCtx) => ctx.user?.name ?? ctx.user?.email?.split("@")[0] ?? "You";
export const face = (ctx: BotsCtx, size: number): Node =>
  box([text(youInitial(ctx), { size: Math.round(size * 0.4), weight: 600, align: "center" })], {
    width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });


export const signOut: ActionSpec = { kind: "signOut" };

// ===================================================================== bots.you

/** The meter the You page and Settings show: from the You page's read, else the live one every screen has. */
export function meterOf(ctx: BotsCtx, u: UsageMeter | null | undefined): { used: number; month: number; windows: boolean; resetsAt: number | null; monthResets: number | null; state: UsageMeter["state"] } {
  if (u) return { used: u.stretch.used, month: u.month.used, windows: u.plan.windows, resetsAt: u.stretch.resetsAt, monthResets: u.month.resetsAt, state: u.state };
  const l = ctx.live.usage;
  return { used: l.used, month: l.month, windows: l.windows, resetsAt: l.resetsAt, monthResets: null, state: l.state };
}
/** "This stretch" or "This month", as the plan is used. */
export const spanLabel = (windows: boolean) => (windows ? "This stretch" : "This month");
/** "Resets Thu 9 am", on the person's clock. */
export const resetsLine = (ctx: BotsCtx, at: number | null) => (at ? `Resets ${whenWords(at, ctx.live.now, ctx.tzOffsetMinutes)}` : "");

/** Near the limit, or at it: the calm line, else nothing. */
function limitLine(ctx: BotsCtx, m: ReturnType<typeof meterOf>): string {
  const span = m.windows ? "this stretch" : "this month";
  const when = m.resetsAt ? ` It resets ${whenWords(m.resetsAt, ctx.live.now, ctx.tzOffsetMinutes)}.` : "";
  if (m.state === "out") return `You've reached ${span}'s limit.${when}`;
  if (m.state === "near") return `You've used most of ${span}.${when}`;
  return "";
}

export function appsLine(d: YouData | undefined): string {
  const names = [...(d?.apps?.github ? ["GitHub"] : []), ...(d?.apps?.connected ?? []).map((a) => a.name.replace(/^Google /, ""))];
  return names.length ? (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")) : "None yet";
}
const pingsLine = (s: Settings | undefined) => {
  if (!s) return "";
  const parts = ["Needs you always", ...(s.notify.summary ? [`summary at ${clock(s.notify.summaryAt, true)}`] : [])];
  return parts.join(" · ");
};

/**
 * The phone's Sounds switch (shared/types/sdui.ts 3h): pull-a-bot's and the bots' moments' sounds, on or off. Kept on the
 * device, not the account (devicePref "sounds"; the phone puts `soundsOn` in the screen's state). Only for a build that
 * plays them.
 */
function soundsCard(ctx: BotsCtx): Node[] {
  if (ctx.client !== "phone" || !ctx.can.has(BOT_SOUNDS_CAPABILITY)) return [];
  const keep: ActionSpec = { kind: "devicePref", key: "sounds", value: "$state.soundsOn" };
  return [listCard([switchRow("Sound", "soundsOn", { sub: "Bots might tell you something", onChange: keep })])];
}

export function youPhone(ctx: BotsCtx, d: YouData | undefined) {
  const m = meterOf(ctx, d?.usage);
  const line = limitLine(ctx, m);
  const planLine = `${d?.plan.name ?? "Your plan"} · ${plural(ctx.live.bots.length, "bot")}`;
  return page(ctx, {
    tab: "you", title: "You", gap: 18,
    // On until this phone says otherwise (it writes its own `soundsOn` over this).
    ...(soundsCard(ctx).length ? { state: { soundsOn: true } } : {}),
    body: [
      row([
        face(ctx, 48),
        col([text(youName(ctx), { size: 20, weight: 600, tracking: -0.3, lineHeight: 25, lines: 1 }), meta(planLine, { size: 13 })], { gap: 2, flexShrink: 1, minWidth: 0 }),
      ], { gap: 12 }, open(SCREENS.billing)),
      card([
        usageMeter(spanLabel(m.windows), m.used, { resets: line || resetsLine(ctx, m.resetsAt) }),
      ], { gap: 12, padding: 16, onPress: open(SCREENS.usage) }),
      listCard([
        // What your bots know about you, in sections (screens/you/space.ts).
        listRow({ label: "Your space", value: "What bots know", onPress: open(SCREENS.youSpace) }),
        // Family and friends: spaces, what's shared, tasks, payment requests and chats (screens/spaces.ts).
        listRow({ label: "Spaces and chats", value: "Family and friends", onPress: open(SCREENS.spaces) }),
        listRow({ label: "Connected apps", value: appsLine(d), onPress: open(SCREENS.apps) }),
        // Sign in on a computer by scanning its code (screens/link.ts).
        listRow({ label: "Link a computer", value: "Scan to sign in", onPress: open(SCREENS.link) }),
        listRow({ label: "What pings you", value: d ? (d.settings.notify.quiet ? "Quiet hours on" : "Needs you always") : "", onPress: open(SCREENS.notify) }),
      ]),
      ...soundsCard(ctx),
      listCard([
        listRow({ label: "Plan and billing", value: d?.plan.name ?? "", onPress: open(SCREENS.billing) }),
        listRow({ label: "Your data", value: "Download · Delete", onPress: open(SCREENS.privacy) }),
        listRow({ label: "Privacy", onPress: open(SCREENS.privacy) }),
        // Reporting and blocking in Spaces (screens/safety.ts): who you blocked, each with Unblock.
        listRow({ label: "Blocked people", onPress: open(SCREENS.blocked) }),
      ]),
      listCard(HELP.map((h) => listRow({ label: h.label, value: h.value || undefined, onPress: helpAction(h.url) })), { title: "Help" }),
    ],
  });
}

/** One row of the window's settings card: an icon, a label with a line under it, and what is on the right. */
function deskRow(o: { glyphNode: Node; label: string; sub?: string; right?: Node; value?: string; onPress?: ActionRef; chevron?: boolean }): Node {
  return row([
    box([o.glyphNode], { width: 22, alignItems: "center" }),
    col([text(o.label, { size: 14, weight: 500, lineHeight: 19 }), ...(o.sub ? [meta(o.sub, { size: 12 })] : [])], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
    ...(o.value ? [text(o.value, { size: 13, color: C.meta, align: "right", style: { flexShrink: 0 } })] : []),
    ...(o.right ? [o.right] : []),
    ...((o.chevron ?? !!o.onPress) ? [icon("chevron", { size: 16, color: C.meta })] : []),
  ], { gap: 12, paddingVertical: 13, paddingHorizontal: 16, minHeight: 52 }, o.onPress);
}
const deskList = (rows: Node[]): Node => listCard(rows);

export function youDesk(ctx: BotsCtx, d: YouData | undefined) {
  const m = meterOf(ctx, d?.usage);
  const line = limitLine(ctx, m);
  const apps = d?.apps;
  const appRows: Node[] = [
    ...(apps?.github ? [deskRow({
      glyphNode: icon("code", { size: 18 }), label: "GitHub", sub: `Used by Code · ${plural(apps.github.repos, "repo")}`, onPress: open(SCREENS.code),
    })] : []),
    ...(apps?.connected ?? []).slice(0, 3).map((a) => deskRow({
      glyphNode: icon("link", { size: 18 }), label: a.name, sub: a.usedBy.length ? `Used by ${a.usedBy.map((n) => n.replace(/ bot$/i, "")).join(", ")}` : "Not used by a bot yet",
      value: ago(ctx, a.lastUsedAt), onPress: open(SCREENS.appConnect, { id: a.id }),
    })),
  ];
  const moreApps = (apps?.connected.length ?? 0) - 3;
  return page(ctx, {
    tab: "you", title: "You", maxWidth: 1040, gap: 22,
    body: [
      row([
        face(ctx, 52),
        col([
          text(youName(ctx), { size: 24, weight: 700, tracking: -0.5, lineHeight: 30 }),
          meta([`${d?.plan.name ?? "Your plan"} · ${plural(ctx.live.bots.length, "bot")}`, ...(ctx.user?.email ? [ctx.user.email] : [])].join(" · "), { size: 13 }),
        ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        secondaryButton("Plan and billing", open(SCREENS.billing), { size: "md" }),
        secondaryButton("Sign out", signOut, { size: "md" }),
      ], { gap: 14 }),
      columns([
        card([
          row([
            ring(m.used, 132),
            col([
              row([text(spanLabel(m.windows), { size: 14, weight: 600 }), grow(), text("Usage", { size: 13, weight: 500, style: { textDecorationLine: "underline" } })], {}, open(SCREENS.usage)),
              meta(resetsLine(ctx, m.resetsAt), { size: 12 }),
              ...(m.windows ? [usageMeter("This month", m.month, { height: 4 })] : []),
              ...(line ? [meta(line, { size: 12 })] : []),
            ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 10 }),
          ], { gap: 22, alignItems: "center" }),
        ], { padding: 20 }),
        col([
          row([sectionLabel(`Connected apps · ${(apps?.connected.length ?? 0) + (apps?.github ? 1 : 0)}`), grow(), text("Manage", { size: 13, weight: 500, style: { textDecorationLine: "underline" } })], {}, open(SCREENS.apps)),
          appRows.length ? deskList([...appRows, ...(moreApps > 0 ? [deskRow({ glyphNode: box([]), label: `${plural(moreApps, "more app")}`, onPress: open(SCREENS.apps) })] : [])])
            : card([meta(apps && !apps.enabled ? "Connected apps aren't on yet." : "No apps connected yet. Your bots can use GitHub, Docs and more.", { size: 13 }), button("Connect an app", open(SCREENS.apps), { kind: "secondary", size: "md" })], { gap: 10 }),
        ], { gap: 8 }),
      ], [
        deskList([
          deskRow({ glyphNode: glyph(G.bell, 18), label: "What pings you", sub: pingsLine(d?.settings) || "Needs you always", value: d?.settings.notify.quiet ? "Quiet hours on" : "", onPress: open(SCREENS.notify) }),
        ]),
        deskList([
          deskRow({ glyphNode: icon("person", { size: 18 }), label: "Your space", sub: "What your bots know about you, in one place", onPress: open(SCREENS.youSpace) }),
        ]),
        deskList([
          deskRow({ glyphNode: icon("shield", { size: 18 }), label: "Privacy", sub: "What we keep, and for how long", onPress: open(SCREENS.privacy) }),
          deskRow({ glyphNode: icon("lock", { size: 18 }), label: "Blocked people", sub: "People you blocked in Spaces", onPress: open(SCREENS.blocked) }),
          deskRow({
            glyphNode: glyph(G.download, 18), label: "Your data", sub: "Chats, notes and files", chevron: false,
            right: row([button("Download", exportAction(d?.exportUrl ?? null), { kind: "secondary", size: "md" }), button("Delete", open(SCREENS.privacy), { kind: "secondary", size: "md" })], { gap: 8 }),
          }),
          deskRow({ glyphNode: glyph(G.trash, 18), label: "Delete account", sub: "7 days to change your mind", onPress: open(SCREENS.deleteAccount) }),
        ]),
        deskList(HELP.map((h) => deskRow({ glyphNode: icon(h.url.startsWith("mailto:") ? "send" : "book", { size: 18 }), label: h.label, value: h.value || undefined, onPress: helpAction(h.url) }))),
      ], { rightWidth: 380 }),
    ],
  });
}

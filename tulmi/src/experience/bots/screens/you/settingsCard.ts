/**
 * THE WINDOW'S SETTINGS, ON A CARD (bots.settings, client desktop).
 *
 * Opened from the sidebar, it sits on a card over a soft wash beside the sidebar (kit.ts PageOpts.sheet), not across the whole
 * window, and closes with its own ×. Every part is in a light box of its own, in two columns, with the connected apps across the
 * foot. Everything the phone's You and Settings offer that a computer can use is here: the account and plan, usage, what pings
 * you, your space, spaces and chats, privacy, blocked people, your data, deleting the account, help; and what only a computer has:
 * the Keylessbord key and its switches (desktop.config, kept by the app). Ask and Xode on this computer have no switches here:
 * they are on from the start, and the privacy policy says what each does (10.5, 12.6).
 *
 * Connected apps are one tile each: the app's icon, its name, and Connect (or Connected, which opens it). Hovering the icon shows a
 * small card with all it does and what happens to what X0 Bot reads there, for a window that draws one (HOVER_HINT); any other
 * window gets the tiles without it.
 *
 * Its data: GET /v1/you (plan, usage, settings, the download link, language) and GET /v1/you/apps?all=1 (every app, with its line).
 */

import type { Node, ActionRef } from "../../../../../../shared/types/sdui.js";
import { en as connectorWords } from "../../../../connectors/words.js";
import { LANGUAGE_NAMES } from "../../../../history/writtenIn.js";
import { appIconNode } from "../../../appIcons.js";
import {
  type BotsCtx, box, icon, C, row, text, open, SCREENS, page, col, meta, secondaryButton, switchMark, when, back, seq, percent,
} from "../../kit.js";
import { kbd } from "../keybotParts.js";
import { glyph, G, openUrl, toast, refresh, oops, exportAction, type Settings } from "./parts.js";
import { type UsageMeter, meterOf, face, youName, signOut } from "./you.js";

/** A window that draws a stack's `hint` as a small card while the pointer is on it (the app's sdui/nodes.js hintOf). */
export const HOVER_HINT = "HoverHint";

export interface SettingsApp {
  id: string;
  name: string;
  category: string;
  oneLine: string;
  auth?: "oauth" | "url" | "none";
  connected?: boolean;
  needsSignIn?: boolean;
}
export interface SettingsData {
  you?: {
    plan: { name: string; active: boolean };
    usage: UsageMeter | null;
    settings: Settings;
    exportUrl: string | null;
    language: string | null;
  };
  apps?: {
    enabled: boolean;
    connected: Array<SettingsApp & { usedBy: string[] }>;
    more: Array<SettingsApp & { usedBy: string[] }>;
    github: { repos: number } | null;
  };
}

const HELP = { mail: "mailto:support@x0bot.com", privacy: "https://x0bot.com/privacy", terms: "https://x0bot.com/terms" };

// ===================================================================== the parts

/** One light box: a small heading, an optional line under it, its rows. */
function part(heading: string, rows: Node[], line?: string): Node {
  return col([
    col([
      text(heading, { size: 13, weight: 600, lineHeight: 17, color: C.ink }),
      ...(line ? [meta(line, { size: 12, lineHeight: 16 })] : []),
    ], { gap: 2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }),
    ...rows,
  ], { backgroundColor: BOX, borderWidth: 1, borderColor: BOX_LINE, borderRadius: 16, paddingBottom: 6 });
}
const BOX = "#fafaf9";
const BOX_LINE = "#ececea";

/** A row in a box: a label, a line under it, what is on the right; tighter than a list card's. */
function line(o: { label: string; sub?: string; value?: string; right?: Node; onPress?: ActionRef; danger?: boolean }): Node {
  return row([
    col([
      text(o.label, { size: 14, weight: 500, lineHeight: 19, ...(o.danger ? { color: DANGER } : {}) }),
      ...(o.sub ? [meta(o.sub, { size: 12, lineHeight: 16 })] : []),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
    ...(o.value ? [text(o.value, { size: 13, color: C.meta, align: "right", lines: 1, style: { flexShrink: 0, maxWidth: 180 } })] : []),
    ...(o.right ? [o.right] : []),
    ...(o.onPress && !o.right ? [icon("chevron", { size: 15, color: C.idle })] : []),
  ], { gap: 12, paddingVertical: 9, paddingHorizontal: 16, minHeight: 44, borderRadius: 10 }, o.onPress);
}
const DANGER = "#b42318";

/** A switch the app keeps (desktop.<key>, written by desktop.config). */
function toggle(label: string, key: string, sub: string): Node {
  return line({ label, sub, right: switchMark(`desktop.${key}`), onPress: { kind: "desktop.config", key, value: "$toggle" } as ActionRef });
}

const usedLine = (m: { used: number; windows: boolean }) => `${percent(m.used)} of this ${m.windows ? "stretch" : "month"}`;

function account(ctx: BotsCtx, d: SettingsData): Node {
  const you = d.you;
  return part("Account", [
    row([
      face(ctx, 40),
      col([text(youName(ctx), { size: 15, weight: 600, lineHeight: 20 }), meta(ctx.user?.email ?? "", { size: 12 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
      secondaryButton("Sign out", signOut, { size: "md" }),
    ], { gap: 12, paddingHorizontal: 16, paddingVertical: 8 }),
    line({ label: "Plan and billing", value: you?.plan.name ?? "", onPress: open(SCREENS.billing) }),
    line({ label: "Usage", value: you?.usage ? usedLine(meterOf(ctx, you.usage)) : "", onPress: open(SCREENS.usage) }),
  ]);
}

function thisComputer(): Node {
  return part("This computer", [
    line({
      label: "Keylessbord key", sub: "Hold it and speak, in any app",
      right: row([when({ truthy: "desktop.hold" }, kbd("Fn", "desktop.holdKey")), when({ falsy: "desktop.hold" }, kbd("Ctrl+Space", "desktop.hotkey"))]),
    }),
    when({ truthy: "desktop.oneKey" }, toggle("Tap to keep listening", "tap", "Hands free. Tap the key again to stop")),
    when({ falsy: "desktop.oneKey" }, toggle("Tap twice to keep listening", "tap", "Hands free. Tap the key again to stop")),
    toggle("Show the pill", "pill", "By your text cursor while Keylessbord listens"),
    toggle("Show the words as I speak", "live", "A line of what it heard, as you say it"),
    toggle("Write while I pause", "pauseFlush", "Each pause puts in what you said so far"),
    toggle("Start with the computer", "autoStart", "Ready when you sign in"),
    line({ label: "More keyboard settings", sub: "The key, the pill and your languages", onPress: open(SCREENS.keySettings) }),
  ], "Ask and Xode work here while X0 Bot is open. Pause Xode from the X0 Bot menu.");
}

function writing(d: SettingsData): Node {
  const lang = d.you?.language;
  return part("Talking and writing", [
    line({ label: "Languages", value: lang ? (Object.hasOwn(LANGUAGE_NAMES, lang) ? LANGUAGE_NAMES[lang]! : lang) : "Found as you talk", onPress: open(SCREENS.language) }),
    line({ label: "How it writes", sub: "The voices it writes in", onPress: open(SCREENS.keyStyle) }),
    line({ label: "Your words", sub: "Names and words it should spell your way", onPress: open(SCREENS.keyWords) }),
    line({ label: "What you call it", sub: "X0, or a name of your own", onPress: open(SCREENS.keyName) }),
  ]);
}

function pings(d: SettingsData): Node {
  const n = d.you?.settings.notify;
  return part("Notifications", [
    line({ label: "What pings you", value: n ? (n.quiet ? "Quiet hours on" : "Needs you always") : "", onPress: open(SCREENS.notify) }),
  ]);
}

function yourData(d: SettingsData): Node {
  return part("Privacy and your data", [
    line({ label: "Your space", sub: "What your bots know about you", onPress: open(SCREENS.youSpace) }),
    line({ label: "Spaces and chats", sub: "Family and friends", onPress: open(SCREENS.spaces) }),
    line({ label: "Privacy", sub: "What we keep, and for how long", onPress: open(SCREENS.privacy) }),
    line({ label: "Blocked people", onPress: open(SCREENS.blocked) }),
    line({ label: "Download my data", right: glyph(G.download, 16, C.meta), onPress: exportAction(d.you?.exportUrl ?? null) }),
    line({ label: "Delete account", danger: true, onPress: open(SCREENS.deleteAccount) }),
  ]);
}

function help(): Node {
  return part("Help", [
    line({ label: "Write to us", value: "support@x0bot.com", onPress: openUrl(HELP.mail) }),
    line({ label: "Privacy policy", onPress: openUrl(HELP.privacy) }),
    line({ label: "Terms of use", onPress: openUrl(HELP.terms) }),
  ]);
}

// ===================================================================== connected apps

/** Connect from here: the window's own action opens the app's sign-in; an app that takes a pasted link opens its page instead. */
function connect(a: SettingsApp): ActionRef {
  if (a.auth === "url") return open(SCREENS.appConnect, { id: a.id });
  return { kind: "connector.connect", id: a.id, onSuccess: seq(toast(`${a.name} connected`), refresh), onError: oops("connect it") } as ActionRef;
}

/** The small card on the icon: what the app is for, and where what X0 Bot reads there goes. */
function hintCard(a: SettingsApp): Node {
  return col([
    text(a.name, { size: 14, weight: 600, lineHeight: 18 }),
    text(a.oneLine, { size: 13, lineHeight: 18, color: C.grey70 }),
    meta(connectorWords("a2.ai", { app: a.name }), { size: 11, lineHeight: 15 }),
  ], { gap: 6, width: 260, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, boxShadow: "0 12px 32px rgba(10,10,10,.12)" });
}

function appTile(ctx: BotsCtx, a: SettingsApp): Node {
  const art = appIconNode(a.id, 26) ?? icon("link", { size: 20 });
  const mark: Node = {
    ...box([art], { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
    ...(ctx.can.has(HOVER_HINT) ? { props: { hint: hintCard(a), hintLabel: a.oneLine } } : {}),
  };
  const on = !!a.connected && !a.needsSignIn;
  const right: Node = on
    ? row([box([], { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2e9e5b" }), text("Connected", { size: 12, color: C.meta })], { gap: 6 }, open(SCREENS.appConnect, { id: a.id }))
    : secondaryButton(a.connected ? "Sign in again" : "Connect", a.connected ? open(SCREENS.appConnect, { id: a.id }) : connect(a), { size: "md" });
  return row([
    mark,
    text(a.name, { size: 14, weight: 500, lineHeight: 18, lines: 2, style: { flexGrow: 1, flexShrink: 1, minWidth: 0 } }),
    right,
  ], { gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: BOX_LINE, backgroundColor: C.paper, minWidth: 0 });
}

function apps(ctx: BotsCtx, d: SettingsData): Node {
  const a = d.apps;
  if (!a) return part("Connected apps", [line({ label: "Couldn't load your apps", sub: "Close this and open it again in a moment." })]);
  if (!a.enabled) return part("Connected apps", [line({ label: "Connected apps aren't on yet", sub: "When they are, your bots can use GitHub, Docs and more." })]);
  const all = [...a.connected.map((x) => ({ ...x, connected: true })), ...a.more];
  const hover = ctx.can.has(HOVER_HINT);
  return part("Connected apps", [
    // Three across, every tile the same width (a Grid with columns; the window draws it as a CSS grid).
    { type: "Grid", props: { columns: 3, gap: 10 }, style: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6 }, children: all.map((x) => appTile(ctx, x)) },
  ], `Your bots use an app only when you ask.${hover ? " Point at an app's icon to see what it does." : ""}`);
}

// ===================================================================== the card

export function settingsCard(ctx: BotsCtx, d: SettingsData | undefined): ReturnType<typeof page> {
  const data = d ?? {};
  const close = back();
  return page(ctx, {
    nav: "settings", title: "Settings", sheet: true, maxWidth: 980, gap: 14,
    body: [
      row([
        col([text("Settings", { size: 24, weight: 700, tracking: -0.5, lineHeight: 30 }), meta("X0 Bot on this computer, and your account", { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        box([icon("close", { size: 18 })], { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0 }, close),
      ], { gap: 12, paddingBottom: 4 }),
      row([
        col([account(ctx, data), thisComputer(), pings(data)], { gap: 14, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        col([writing(data), yourData(data), help()], { gap: 14, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
      ], { gap: 14, alignItems: "flex-start" }),
      apps(ctx, data),
    ],
  });
}

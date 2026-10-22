/**
 * THE ASSISTANT ON THE PHONE: Connected apps, Tasks, and the confirm sheet.
 *
 * Built here and only drawn by the app, like every other screen: the tiles,
 * their states, the sheets, the words and the route each button calls are the
 * server's. The app has no screen of its own for any of it, only the generic
 * pieces these use (Grid, BottomSheet, Stack, Text, TextField, and the
 * actions callEndpoint, biometricPrompt, openUrl, setState, navigate).
 *
 *   assistant_apps      the tile grid: Suggested for you first, each tile's
 *                       state, a sheet per app with Can look / Can draft /
 *                       Can send and Disconnect (or the link to paste, for an
 *                       app that takes one)
 *   assistant_tasks     Waiting for you / Running / Done, in plain words
 *   assistant_approve   the confirm card as a bottom sheet; where the
 *                       "approval" push lands (push.approval.screenId)
 *   assistant_app_tools an app the person added by link: what it can do,
 *                       tool by tool, as Allow / Ask first / Off, and the
 *                       "This app changed" banner (params.id)
 *   (You tab)           youCard: "Hand it to me", the same Ask in a card on
 *                       the You tab, with the next three tasks and the apps
 *   assistant_ask       Ask on the phone: a field, the mic, Do it, and a few
 *                       examples to tap. The answer comes from
 *                       POST /v1/assistant/ask and is acted on with the
 *                       actions every build runs: its line is shown, a
 *                       hand-off is opened, an approval goes to the sheet
 *
 * APPS ADDED BY LINK (only while CUSTOM_CONNECTORS is on: assistant.custom).
 * Connected apps then also has an "Add by link" tile and its sheet (Name,
 * Link, a folded Advanced with the person's own client ID and secret, and the
 * trust line), and under More apps a search over the MCP Registry
 * (connectors/registry.ts), every result outside our catalog marked
 * Unverified with its host. Nobody is sent to sign in without first reading
 * "You'll sign in at {host}": after Add, the sheet turns to that line and a
 * Continue; an added app's own sheet says it above its Connect. Search
 * results arrive by a GET into state (`dir`) and are drawn into twenty slots
 * already on the screen, since a screen cannot grow nodes of its own.
 *
 * WORDS. One table with the desk and the agent's confirm card
 * (connectors/words.ts), in English; a Hinglish profile gets the design's own
 * Hinglish for every line through the translator's seeds (experience/i18n.ts).
 * That only works while a string reaches the translator as the table wrote it,
 * so these screens opt out of the catalog's capitalising pass (props.keepCase
 * on the root, titleCase.ts) and ask the phone to capitalise instead
 * (textTransform), which gives the app's every-word-capitalised look without
 * changing a letter of the words.
 *
 * WHAT IS THE PERSON'S OR THE APP'S, NOT OURS: an app's name, a task's title,
 * its steps and above all the exact preview. They are put in the screen's
 * state and drawn from there, never written into a node: the translator only
 * ever sees nodes, so what the person is about to approve cannot be reworded,
 * and a stranger's text is never mistaken for a word of ours.
 *
 * NOTHING IS APPROVED WITHOUT THE PERSON'S OWN CHECK. Approve runs
 * biometricPrompt first (Face ID or fingerprint, or the phone's passcode).
 * A phone with none of them asks once more with a plain tap and says why; a
 * bundle too old to know that case ends the prompt as an error and nothing is
 * sent.
 */
import type { ActionRef, ActionSpec, Node, ScreenResponse } from "../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../shared/types/sdui.js";
import type { AgentApproval, ApprovalCard, AssistantTask, ConnectorInfo, ConnectorTool } from "../../../shared/types/api.js";
import { approvalCard } from "../connectors/card.js";
import type { AssistantView } from "../connectors/list.js";
import { en, wordsFor, type WordKey } from "../connectors/words.js";
import { PHONE_LOOK, label, t } from "./phoneLook.js";
import { NEON, blipBox, blipPicture, neonDot } from "./touches.js";
import type { BlipLoop } from "./blipLoops.js";
import { sw } from "./settingsWords.js";
import { appIconNode } from "./appIcons.js";

type You = typeof import("./catalog.js").YOU_UI;
type Style = Record<string, unknown>;
type Face = Parameters<typeof t>[1];
type CallEndpoint = Extract<ActionSpec, { kind: "callEndpoint" }>;

export const ASSISTANT_SCREENS: ReadonlySet<string> = new Set(["assistant_apps", "assistant_tasks", "assistant_approve", "assistant_app_tools", "assistant_ask"]);
const ASK = "assistant_ask";

export interface AssistantScreenCtx {
  /** The apps and tasks, read for this screen. Absent: off, or the read failed. */
  assistant?: AssistantView;
  params?: Record<string, unknown>;
  /** What this build of the app says it can draw and do. */
  can?: ReadonlySet<string>;
  /** Connected apps are switched on (CONNECTORS): Ask has something to answer with. */
  connectorsOn?: boolean;
  /** Their app language: Ask's examples are in their voice. */
  language?: string;
  /** The phone asking, sent on with each ask. */
  platform?: "ios" | "android";
  /** The phone's UTC offset when the screen was asked for, sent on with each ask so "tomorrow" is its tomorrow. */
  tzOffsetMinutes?: number;
}

/** The ctx each builder gets: `lone` = the stack under this screen is empty (a push or a link opened it), so a back arrow would go nowhere. */
type Ctx = AssistantScreenCtx & { lone: boolean };
const LONE_KEYS = ["pushId", "entry", "alone"];

const LEVELS = ["look", "draft", "send"] as const;
type Level = (typeof LEVELS)[number];
const TASKS = "assistant_tasks";

/** Words of ours, capitalised by the phone (see WORDS above). */
const word = (content: string, face: Face, size: number, style: Style = {}): Node =>
  t(content, face, size, { textTransform: "capitalize", ...style });

/**
 * Blip, centred, with the lines under him: an empty state's one warm line, or
 * an error's words and then its fix. The lines are sentences, set as written.
 * One of these a screen, never in a list or a row (touches.ts).
 */
const empty = (loop: BlipLoop, lines: string[], ui: You, first: Style = {}): Node => ({
  type: "Stack",
  style: { alignItems: "center", marginTop: 28 },
  children: [
    blipPicture(loop, 0.9),
    ...lines.map((line, i) => t(line, "ui", 15, {
      lineHeight: 23, color: i === 0 ? ui.text : ui.textDim, textAlign: "center", marginTop: i === 0 ? 14 : 6, maxWidth: 300, ...(i === 0 ? first : {}),
    })),
  ],
});

/** A screen that cannot reach the apps: Blip, what is so, and the fix in one line. */
const cannotReach = (ui: You): Node => empty("think-s", [en("apps.off"), sw("x.apps")], ui);

/** Text drawn from the screen's state: never translated, never recased. */
const fromState = (path: string, face: Face, size: number, style: Style = {}): Node =>
  ({ ...t("", face, size, style), bind: { content: path } });

const toast = (message: string, tone: "success" | "error" | "info" = "info"): ActionSpec => ({ kind: "toast", message, tone });
const haptic = (style: "selection" | "success" | "error"): ActionSpec => ({ kind: "haptic", style });
const seq = (...actions: ActionRef[]): ActionSpec => ({ kind: "sequence", actions });
const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const call = (method: CallEndpoint["method"], path: string, rest: Partial<CallEndpoint> = {}): ActionSpec =>
  ({ kind: "callEndpoint", method, path, body: method === "GET" ? undefined : {}, ...rest });

export function buildAssistantScreen(screenId: string, ctx: AssistantScreenCtx, ui: You): ScreenResponse | null {
  const c: Ctx = { ...ctx, lone: LONE_KEYS.some((k) => ctx.params?.[k] !== undefined) };
  switch (screenId) {
    case "assistant_apps": return appsScreen(c, ui);
    case "assistant_tasks": return tasksScreen(c, ui);
    case "assistant_approve": return approveScreen(c, ui);
    case "assistant_app_tools": return toolsScreen(c, ui);
    case ASK: return askScreen(c, ui);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const GAP = (h: number): Node => ({ type: "Spacer", style: { height: h } });

function back(ui: You): Node {
  return {
    type: "Stack",
    on: { onPress: seq(haptic("selection"), { kind: "navigateBack" }) },
    props: { pressOpacity: 0.55, hitSlop: ui.head.controlSlop },
    style: {
      width: ui.head.controlSize, height: ui.head.controlSize, borderRadius: ui.head.controlSize / 2,
      alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)",
    },
    children: [{
      type: "SVG",
      props: {
        viewBox: "0 0 24 24", d: "M14.5 5 L8 12 L14.5 19", fill: "none", stroke: ui.text, strokeWidth: 2.3,
        strokeLinecap: "round", strokeLinejoin: "round",
      },
      style: { width: 14, height: 14 },
    }],
  };
}

/** The block every inside screen opens with (the same as the You screens'). */
function head(ui: You, kicker: string, title: string, lone: boolean): Node {
  return {
    type: "Stack",
    style: {
      backgroundColor: ui.ground, paddingTop: ui.head.paddingTop, paddingBottom: 20,
      paddingHorizontal: PHONE_LOOK.side, borderBottomLeftRadius: ui.head.radius, borderBottomRightRadius: ui.head.radius,
    },
    children: [
      { type: "Stack", style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, children: lone ? [] : [back(ui)] },
      label(kicker, { marginTop: 18 }),
      // The page title in the onboarding's heading face (touches.ts).
      word(title, "grotesk", 26, { letterSpacing: -0.6, marginTop: 8 }),
    ],
  };
}

/** The screen: the head, then a scrolling body. */
function page(c: Ctx, screenId: string, ui: You, kicker: string, title: string, body: Node[], extra: Partial<ScreenResponse> = {}): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId,
    title: "",
    hideHeader: true,
    ...extra,
    root: {
      type: "Stack",
      // keepCase: see WORDS in the header of this file.
      props: { keepCase: true },
      style: { flex: 1, backgroundColor: ui.ground },
      children: [
        head(ui, kicker, title, c.lone),
        {
          type: "Screen",
          style: { backgroundColor: "transparent", paddingHorizontal: PHONE_LOOK.side, paddingTop: 8, paddingBottom: 48 },
          children: body,
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** A pill you press. `primary` is the one that does the thing; `grow` shares a row. */
function pill(ui: You, text: string, on: ActionRef, kind: "primary" | "outline" | "quiet" = "outline", grow = false): Node {
  const fill = kind === "primary";
  return {
    type: "Stack",
    on: { onPress: on },
    props: { pressOpacity: 0.7 },
    style: {
      minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 22,
      backgroundColor: fill ? ui.text : "transparent",
      ...(kind === "outline" ? { borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" } : {}),
      ...(grow ? { flex: 1 } : {}),
    },
    children: [word(text, "uiMedium", 15, { color: fill ? ui.onAccent : kind === "quiet" ? ui.textDim : ui.text, textAlign: "center" })],
  };
}

/**
 * The app's mark: its company's logo when it has one (appIcons.ts), else its
 * first letter on a rounded square. An app added by link keeps the letter.
 */
function mark(ui: You, id: string, size = 42, custom?: boolean): Node {
  const logo = appIconNode(id, size, custom);
  if (logo) return logo;
  return {
    type: "Stack",
    style: { width: size, height: size, borderRadius: size * 0.29, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
    children: [fromState(`ini.${id}`, "uiBold", Math.round(size * 0.42), { color: ui.text })],
  };
}

const ink = (ui: You, dim = false): Style => ({ color: dim ? ui.textDim : ui.text });

// ---------------------------------------------------------------------------
// Connected apps
// ---------------------------------------------------------------------------

function appsScreen(ctx: Ctx, ui: You): ScreenResponse {
  const apps = ctx.assistant?.apps;
  const canOpen = ctx.can?.has("ActionUrl") === true;
  const custom = ctx.assistant?.custom === true;
  const body: Node[] = [];

  if (!apps) {
    body.push(cannotReach(ui));
    return page(ctx, "assistant_apps", ui, en("apps.h"), en("apps.p"), body, { state: {} });
  }

  const state: Record<string, unknown> = { sheet: {}, lvl: {}, paste: {}, n: {}, ini: {}, link: {}, res: {}, host: {}, si: {} };
  const set = (k: string, id: string, v: unknown) => { (state[k] as Record<string, unknown>)[id] = v; };
  for (const a of apps) {
    set("sheet", a.id, false); set("lvl", a.id, a.level); set("n", a.id, a.name);
    set("ini", a.id, a.name.trim().charAt(0).toUpperCase() || "?"); set("paste", a.id, "");
    // Where an added app lives and where it signs you in: the person's own text, so from state.
    if (a.custom) { set("host", a.id, a.host ?? ""); set("si", a.id, a.signInHost ?? ""); }
  }
  if (custom) Object.assign(state, addState(), { q: "", dir: {} });

  // Not connected first, as the apps to start with; then what is connected
  // (and every app the person added, connected yet or not: theirs either
  // way); then the rest. (Suggested = the first few of the catalog not yet
  // connected, in its order, which is its order of usefulness.)
  const todo = apps.filter((a) => !a.connected && !a.custom);
  const done = apps.filter((a) => a.connected || a.custom);
  const suggested = todo.slice(0, 4);
  const more = todo.slice(4);

  // BLIP AT THE TOP, presenting the apps. While none is connected he has one
  // warm line to say; once one is, he stands there quietly. The one Blip here.
  body.push(empty("present-s", done.some((a) => a.connected) ? [] : [sw("e.apps")], ui));
  // Ask is where these apps are used from the phone.
  body.push(GAP(14), pill(ui, en("ask.h"), seq(haptic("selection"), { kind: "navigate", screenId: ASK }), "outline"));

  const sections: Array<[WordKey, ConnectorInfo[]]> = [["s6.sug", suggested], ["apps.h", done], ["s6.more", more]];
  for (const [key, list] of sections) {
    // More apps is always there while apps can be added by link: it holds the Add tile and the search.
    if (!list.length && !(key === "s6.more" && custom)) continue;
    body.push(label(en(key), { marginTop: 28, marginBottom: 12 }));
    const tiles = list.map((a) => tile(a, ui, canOpen));
    if (key === "s6.more" && custom) tiles.push(addTile(ui, canOpen));
    body.push({ type: "Grid", props: { columns: 3, gap: 8 }, children: tiles });
    if (key === "s6.more" && custom) body.push(GAP(18), ...directoryBlock(ui, canOpen));
  }
  // A bundle that cannot open a sign-in page is told so, once, in our words.
  if (!canOpen && (todo.some((a) => a.auth === "oauth") || custom)) {
    body.push(GAP(18), word(en("apps.update"), "ui", 13.5, { lineHeight: 20, color: ui.textDim }));
  }
  // One sheet per app that has something to show.
  for (const a of apps) {
    if (a.custom) body.push(customSheet(a, ui, canOpen));
    else if (a.connected) body.push(levelSheet(a, ui, canOpen));
    else if (a.auth === "url") body.push(pasteSheet(a, ui));
    else if (canOpen) body.push(connectSheet(a, ui));
  }
  if (custom && canOpen) body.push(addSheet(ui));

  return page(ctx, "assistant_apps", ui, en("apps.h"), en("apps.p"), body, { state });
}

/** Start an app's sign-in: ask the server for the page, open it in the system browser. */
function connectFlow(a: ConnectorInfo): ActionSpec {
  return seq(haptic("selection"), call("POST", `/v1/connectors/${a.id}/connect`, {
    assignTo: "link",
    onSuccess: { kind: "openUrl", url: "$state.link.authorizeUrl" },
    onError: toast(en("err.connect"), "error"),
  }));
}

function tile(a: ConnectorInfo, ui: You, canOpen: boolean): Node {
  const open = seq(haptic("selection"), setState(`sheet.${a.id}`, true));
  // An app the person added always opens its sheet first: where it signs in is said there, before anything opens.
  const press: ActionRef =
    a.connected || a.auth === "url" || a.custom ? open
      // The sheet first: what Tailzu does with the app is said before its sign-in page opens.
      : canOpen ? open
        : toast(en("apps.update"), "info");
  const state: WordKey = !a.connected ? "connect" : a.needsSignIn ? "st.re" : "st.ok";
  const on = a.connected && !a.needsSignIn;
  return {
    type: "Stack",
    on: { onPress: press },
    props: { pressOpacity: 0.7 },
    style: {
      minHeight: 132, alignItems: "center", gap: 7, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16,
      backgroundColor: ui.pill.background, borderWidth: 1, borderColor: on ? "rgba(255,255,255,0.3)" : ui.rule,
    },
    children: [
      mark(ui, a.id, 42, a.custom),
      fromState(`n.${a.id}`, "uiMedium", 13.5, { ...ink(ui), textAlign: "center", lineHeight: 18 }),
      {
        type: "Stack",
        style: {
          borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
          flexDirection: "row", alignItems: "center", gap: 6,
          backgroundColor: a.connected ? "transparent" : ui.text,
          ...(a.connected ? { borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" } : {}),
        },
        // Connected is a state that is on: the onboarding's neon dot, here and
        // nowhere else on this screen (touches.ts).
        children: [...(on ? [neonDot(6)] : []), word(en(state), "uiBold", 11, { color: a.connected ? ui.text : ui.onAccent })],
      },
      // How far it may go, under a connected app's name. Three lines, one
      // shown, so a change made in its sheet shows here without a reload.
      // An added app has no level: it says it is unverified, or that it changed.
      ...(a.custom
        ? [word(en(a.toolsChanged ? "changed.tag" : "custom.tag"), "ui", 11.5, { color: ui.textDim })]
        : a.connected ? LEVELS.map((l): Node => ({
          ...word(en(`lv.${l}` as WordKey), "ui", 11.5, { color: ui.textDim }),
          visibleIf: { eq: [`lvl.${a.id}`, l] },
        })) : []),
    ],
  };
}

const sheetProps = (ui: You): Record<string, unknown> => ({
  background: ui.pill.background, radius: 26, padding: 20, paddingBottom: 34,
  handleColor: "rgba(255,255,255,0.22)", scrimColor: "rgba(0,0,0,0.6)",
});

function sheetHead(a: ConnectorInfo, ui: You, line: string): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
    children: [
      mark(ui, a.id, 46, a.custom),
      { type: "Stack", style: { flex: 1, gap: 2 }, children: [
        fromState(`n.${a.id}`, "uiBold", 19, ink(ui)),
        word(line, "ui", 13, { color: ui.textDim }),
      ] },
    ],
  };
}

/** An app that is connected: how far it may go, and Disconnect. */
function levelSheet(a: ConnectorInfo, ui: You, canOpen: boolean): Node {
  const row = (l: Level): Node => ({
    type: "Stack",
    on: {
      onPress: seq(
        haptic("selection"),
        setState(`lvl.${a.id}`, l),
        call("POST", `/v1/connectors/${a.id}/level`, {
          body: { level: l },
          onError: seq(toast(en("err.level"), "error"), setState(`lvl.${a.id}`, a.level)),
        }),
      ),
    },
    props: { pressOpacity: 0.7 },
    style: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, marginBottom: 8, backgroundColor: "rgba(255,255,255,0.05)" },
    children: [
      {
        type: "Stack",
        style: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "rgba(255,255,255,0.4)", alignItems: "center", justifyContent: "center" },
        children: [{
          type: "Stack",
          style: { width: 10, height: 10, borderRadius: 5, backgroundColor: ui.text },
          visibleIf: { eq: [`lvl.${a.id}`, l] },
        }],
      },
      { type: "Stack", style: { flex: 1, gap: 2 }, children: [
        word(en(`lv.${l}` as WordKey), "uiMedium", 15, ink(ui)),
        word(en(`lv.${l}.d` as WordKey), "ui", 13, { lineHeight: 19, color: ui.textDim }),
      ] },
    ],
  });
  return {
    type: "BottomSheet",
    bind: { open: `sheet.${a.id}` },
    props: sheetProps(ui),
    children: [
      sheetHead(a, ui, a.needsSignIn ? en("st.re") : en("st.ok")),
      ...(a.needsSignIn && a.auth === "oauth" && canOpen ? [pill(ui, en("st.re"), connectFlow(a), "primary"), GAP(14)] : []),
      word(en("a2.q", { app: a.name }), "uiMedium", 15, { ...ink(ui), marginBottom: 10 }),
      ...LEVELS.map(row),
      word(en("a2.foot"), "ui", 12.5, { lineHeight: 19, color: ui.textDim, marginTop: 4 }),
      GAP(10),
      pill(ui, en("a2.dis", { app: a.name }), call("DELETE", `/v1/connectors/${a.id}`, {
        onSuccess: seq(setState(`sheet.${a.id}`, false), { kind: "refresh" }),
        onError: toast(en("err.generic"), "error"),
      }), "quiet"),
    ],
  };
}

/** Before an app's sign-in page opens: what it is, what Tailzu does with it, and Connect. */
function connectSheet(a: ConnectorInfo, ui: You): Node {
  return {
    type: "BottomSheet",
    bind: { open: `sheet.${a.id}` },
    props: sheetProps(ui),
    children: [
      sheetHead(a, ui, en("st.no")),
      word(a.oneLine, "ui", 14, { lineHeight: 20, ...ink(ui), marginBottom: 10 }),
      word(en("a2.ai", { app: a.name }), "ui", 12.5, { lineHeight: 19, color: ui.textDim, marginBottom: 14 }),
      pill(ui, en("connect"), seq(setState(`sheet.${a.id}`, false), connectFlow(a)), "primary"),
    ],
  };
}

/** An app that takes a link (Zapier): paste it here. */
function pasteSheet(a: ConnectorInfo, ui: You): Node {
  return {
    type: "BottomSheet",
    bind: { open: `sheet.${a.id}` },
    props: sheetProps(ui),
    children: [
      sheetHead(a, ui, en("st.no")),
      { type: "TextField", bind: { value: `paste.${a.id}` }, props: { placeholder: en("link.ph", { app: a.name }), autoCapitalize: "none", autoCorrect: false } },
      GAP(14),
      pill(ui, en("connect"), seq(haptic("selection"), call("POST", `/v1/connectors/${a.id}/connect`, {
        body: { url: `$state.paste.${a.id}` },
        onSuccess: seq(haptic("success"), setState(`sheet.${a.id}`, false), { kind: "refresh" }),
        onError: toast(en("err.connect"), "error"),
      })), "primary"),
    ],
  };
}

// ---------------------------------------------------------------------------
// Apps added by link (only while CUSTOM_CONNECTORS is on)
// ---------------------------------------------------------------------------

const TOOLS_SCREEN = "assistant_app_tools";
/** Search results drawn at once: one page of the directory (registry.ts SEARCH_LIMIT). */
const DIR_SLOTS = 20;

/** The add sheet's fields, empty, and what the last Add answered. */
const addState = (): Record<string, unknown> => ({
  addOpen: false, added: {}, add: { name: "", url: "", clientId: "", clientSecret: "", adv: false },
});

/** The mark, read from any state path. */
function markAt(ui: You, path: string, size = 42): Node {
  return { ...mark(ui, "", size), children: [fromState(path, "uiBold", Math.round(size * 0.42), { color: ui.text })] };
}

/** The Add mark: a plus where an app's letter would be. */
function plusMark(ui: You, size = 42): Node {
  return { ...mark(ui, "", size), children: [t("+", "uiBold", Math.round(size * 0.48), { color: ui.text })] };
}

/** "Unverified · host": our word, then the host from state. */
function unverifiedLine(ui: You, hostPath: string): Node {
  return {
    type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
    children: [
      word(en("custom.tag"), "uiBold", 11.5, { color: ui.textDim, letterSpacing: 0.3 }),
      t("·", "ui", 12, { color: ui.textDim }),
      fromState(hostPath, "ui", 12.5, { color: ui.textDim }),
    ],
  };
}

/** "You'll sign in at" over the host it names, from state. */
function signInAt(ui: You, hostPath: string): Node {
  return {
    type: "Stack", style: { gap: 2, padding: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 12 },
    children: [word(en("add.at"), "ui", 13, { color: ui.textDim }), fromState(hostPath, "uiBold", 16, ink(ui))],
  };
}

/**
 * The add sheet's answer: not added, and the server's reason (already added,
 * too many, a link it won't take...: the route answers those 200, as
 * `refused`, so they can be read here); added and connected (no sign-in); or
 * on to "You'll sign in at".
 */
const afterAdd = (): ActionSpec => ({
  kind: "condition", if: { truthy: "added.refused" },
  // The server's own words, from state: the form stays as it was typed.
  then: seq(haptic("error"), toast("$state.added.refused.message", "error")),
  else: {
    kind: "condition", if: { truthy: "added.connected" },
    then: seq(haptic("success"), toast(en("add.done"), "success"), setState("addOpen", false), setState("added", {}), { kind: "refresh" }),
    // The sheet turns to its sign-in step by itself: added.authorizeUrl is set.
    else: seq(haptic("selection"), setState("addOpen", true)),
  },
});

const addCall = (body: Record<string, string>): ActionSpec => call("POST", "/v1/connectors/custom", {
  // onError is only for an answer with no reason in it: no connection, or the server fell over.
  body, assignTo: "added", onSuccess: afterAdd(), onError: seq(haptic("error"), toast(en("err.add"), "error")),
});

/** The tile that opens the add sheet. */
function addTile(ui: You, canOpen: boolean): Node {
  return {
    type: "Stack",
    on: { onPress: canOpen ? seq(haptic("selection"), setState("addOpen", true)) : toast(en("apps.update"), "info") },
    props: { pressOpacity: 0.7 },
    style: {
      minHeight: 132, alignItems: "center", justifyContent: "center", gap: 9, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16,
      borderWidth: 1, borderColor: ui.rule, borderStyle: "dashed",
    },
    children: [
      plusMark(ui),
      word(en("add.tile"), "uiMedium", 13.5, { ...ink(ui), textAlign: "center", lineHeight: 18 }),
    ],
  };
}

const field = (path: string, placeholder: string, extra: Record<string, unknown> = {}): Node => ({
  type: "TextField", bind: { value: path }, props: { placeholder, autoCapitalize: "none", autoCorrect: false, ...extra },
});

/** Add an app by link: the form, then, once the server has it, where they'll sign in. */
function addSheet(ui: You): Node {
  const dim = (size = 13): Style => ({ lineHeight: Math.round(size * 1.45), color: ui.textDim });
  const form: Node = {
    type: "Stack", visibleIf: { falsy: "added.authorizeUrl" },
    children: [
      label(en("add.name"), { marginBottom: 6 }), field("add.name", en("add.name.ph"), { autoCapitalize: "words" }), GAP(12),
      label(en("add.link"), { marginBottom: 6 }), field("add.url", en("add.link.ph")), GAP(12),
      {
        type: "Stack", on: { onPress: { kind: "toggleState", path: "add.adv" } }, props: { pressOpacity: 0.6 },
        style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
        children: [
          word(en("add.adv"), "uiMedium", 14, ink(ui)),
          { ...t("+", "uiBold", 16, { color: ui.textDim }), visibleIf: { falsy: "add.adv" } },
          { ...t("–", "uiBold", 16, { color: ui.textDim }), visibleIf: { truthy: "add.adv" } },
        ],
      },
      {
        type: "Stack", visibleIf: { truthy: "add.adv" }, style: { gap: 8, marginBottom: 6 },
        children: [
          word(en("add.adv.d"), "ui", 12.5, dim(12.5)),
          field("add.clientId", en("add.cid")),
          field("add.clientSecret", en("add.csec")),
        ],
      },
      GAP(10),
      word(en("add.trust"), "ui", 13, dim()),
      GAP(14),
      pill(ui, en("add.go"), seq(haptic("selection"), addCall({
        name: "$state.add.name", url: "$state.add.url", clientId: "$state.add.clientId", clientSecret: "$state.add.clientSecret",
      })), "primary"),
    ],
  };
  const signIn: Node = {
    type: "Stack", visibleIf: { truthy: "added.authorizeUrl" },
    children: [
      signInAt(ui, "added.signInHost"),
      word(en("add.trust"), "ui", 13, dim()),
      GAP(14),
      pill(ui, en("add.cont"), seq(
        haptic("selection"), { kind: "openUrl", url: "$state.added.authorizeUrl" },
        setState("addOpen", false), setState("added", {}), { kind: "refresh" },
      ), "primary"),
      GAP(8),
      // Not now: it stays in their apps, waiting to be connected.
      pill(ui, en("a3.later"), seq(setState("addOpen", false), setState("added", {}), { kind: "refresh" }), "quiet"),
    ],
  };
  return {
    type: "BottomSheet",
    bind: { open: "addOpen" },
    props: sheetProps(ui),
    children: [
      {
        type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
        children: [
          plusMark(ui, 46),
          { type: "Stack", style: { flex: 1, gap: 2 }, children: [
            word(en("add.h"), "uiBold", 19, ink(ui)),
            word(en("add.p"), "ui", 13, { color: ui.textDim }),
          ] },
        ],
      },
      form,
      signIn,
    ],
  };
}

/** An app the person added: where it signs in, what it can do, and Remove. */
function customSheet(a: ConnectorInfo, ui: You, canOpen: boolean): Node {
  const close = setState(`sheet.${a.id}`, false);
  const toTools: ActionSpec = seq(haptic("selection"), close, { kind: "navigate", screenId: TOOLS_SCREEN, params: { id: a.id } });
  const signIn = !a.connected || a.needsSignIn === true;
  // Connect, here, is the sign-in the sheet just named. A server that moved
  // its sign-in is refused by the route; the refreshed sheet names the new one.
  const connect = seq(haptic("selection"), call("POST", `/v1/connectors/${a.id}/connect`, {
    assignTo: "link",
    onSuccess: {
      kind: "condition", if: { truthy: "link.connected" },
      then: seq(haptic("success"), close, { kind: "refresh" }),
      else: { kind: "openUrl", url: "$state.link.authorizeUrl" },
    },
    onError: seq(toast(en("err.connect"), "error"), { kind: "refresh" }),
  }));
  const banner: Node = {
    type: "Stack", style: { gap: 4, padding: 14, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
    children: [
      word(en("changed.h"), "uiBold", 15, ink(ui)),
      word(en("changed.p"), "ui", 13, { lineHeight: 19, color: ui.textDim }),
    ],
  };
  return {
    type: "BottomSheet",
    bind: { open: `sheet.${a.id}` },
    props: sheetProps(ui),
    children: [
      {
        type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
        children: [
          mark(ui, a.id, 46, true),
          { type: "Stack", style: { flex: 1, gap: 3 }, children: [fromState(`n.${a.id}`, "uiBold", 19, ink(ui)), unverifiedLine(ui, `host.${a.id}`)] },
        ],
      },
      word(en("custom.note"), "ui", 13, { lineHeight: 19, color: ui.textDim, marginBottom: 14 }),
      ...(signIn
        ? [
          ...(a.signInHost ? [signInAt(ui, `si.${a.id}`)] : []),
          canOpen ? pill(ui, en(a.connected ? "st.re" : "connect"), connect, "primary") : word(en("apps.update"), "ui", 13, { color: ui.textDim }),
        ]
        : [
          ...(a.toolsChanged ? [banner, pill(ui, en("changed.look"), toTools, "primary"), GAP(8)] : []),
          pill(ui, en("tools.h"), toTools, a.toolsChanged ? "outline" : "primary"),
        ]),
      GAP(10),
      pill(ui, en("custom.remove"), call("DELETE", `/v1/connectors/custom/${a.id}`, {
        onSuccess: seq(close, { kind: "refresh" }),
        onError: toast(en("err.generic"), "error"),
      }), "quiet"),
    ],
  };
}

/**
 * More apps, searched: the field, then twenty slots that fill from the
 * answer (`dir.apps.<i>`). Ours say so and point to their tile; the rest are
 * Unverified, with their host, and Add sends them through the same add as a
 * pasted link, named by the registry entry they came from.
 */
function directoryBlock(ui: You, canOpen: boolean): Node[] {
  const search = seq(haptic("selection"), call("GET", "/v1/connectors/directory?q=$state.q", {
    assignTo: "dir", onError: toast(en("dir.err"), "error"),
  }));
  const slot = (i: number): Node => {
    const at = `dir.apps.${i}`;
    return {
      type: "Stack", visibleIf: { truthy: `${at}.id` },
      style: { gap: 8, padding: 14, borderRadius: 18, marginBottom: 8, backgroundColor: ui.pill.background },
      children: [
        {
          type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 12 },
          children: [
            markAt(ui, `${at}.initial`, 38),
            { type: "Stack", style: { flex: 1, gap: 3 }, children: [
              fromState(`${at}.name`, "uiMedium", 15, ink(ui)),
              { ...unverifiedLine(ui, `${at}.host`), visibleIf: { truthy: `${at}.unverified` } },
              { ...word(en("dir.ours"), "uiBold", 11.5, { color: ui.text, letterSpacing: 0.3 }), visibleIf: { eq: [`${at}.source`, "catalog"] } },
            ] },
            ...(canOpen ? [{
              ...pill(ui, en("dir.add"), seq(haptic("selection"), addCall({ name: `$state.${at}.name`, url: `$state.${at}.url`, from: `$state.${at}.id` }))),
              visibleIf: { truthy: `${at}.unverified` },
            } as Node] : []),
          ],
        },
        fromState(`${at}.description`, "ui", 13, { lineHeight: 19, color: ui.textDim }),
        { ...word(en("dir.ours.d"), "ui", 12.5, { color: ui.textDim }), visibleIf: { eq: [`${at}.source`, "catalog"] } },
      ],
    };
  };
  return [
    word(en("dir.p"), "ui", 13, { lineHeight: 19, color: ui.textDim, marginBottom: 10 }),
    {
      type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
      children: [
        { ...field("q", en("dir.ph")), style: { flex: 1 } },
        pill(ui, en("dir.go"), search),
      ],
    },
    ...Array.from({ length: DIR_SLOTS }, (_, i) => slot(i)),
    { ...word(en("dir.none"), "ui", 13.5, { color: ui.textDim }), visibleIf: { eq: ["dir.count", 0] } },
  ];
}

/** One choice of Allow / Ask first / Off: filled when it is the one set. */
function choice(ui: You, text: string, selected: boolean, on?: ActionRef): Node {
  return {
    type: "Stack",
    ...(on ? { on: { onPress: on } } : {}),
    props: { pressOpacity: 0.7 },
    style: {
      minHeight: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 14,
      backgroundColor: selected ? ui.text : "transparent", ...(selected ? {} : { borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" }),
    },
    children: [word(text, "uiMedium", 13, { color: selected ? ui.onAccent : ui.text })],
  };
}

const POLICY_WORD = { allow: "pol.allow", ask: "pol.ask", off: "pol.off" } as const;

function toolsScreen(ctx: Ctx, ui: You): ScreenResponse {
  const app = ctx.assistant?.custom ? ctx.assistant.app : undefined;
  if (!app) {
    return page(ctx, TOOLS_SCREEN, ui, en("tools.h"), en("tools.p"), [word(en("apps.off"), "ui", 15, { lineHeight: 23, color: ui.text })], { state: {} });
  }
  const a = app.info;
  const tools = app.tools ?? [];
  // The app's words (a tool's name and description) live in state, never in a node.
  const state: Record<string, unknown> = {
    n: { [a.id]: a.name }, ini: { [a.id]: a.name.trim().charAt(0).toUpperCase() || "?" }, host: { [a.id]: a.host ?? "" },
    tools: tools.map((x) => ({ label: x.title || x.name, description: x.description })),
    pol: Object.fromEntries(tools.map((x, i) => [i, x.policy])),
  };
  const body: Node[] = [{
    type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18, marginBottom: 6 },
    children: [
      mark(ui, a.id, 46, a.custom),
      { type: "Stack", style: { flex: 1, gap: 3 }, children: [fromState(`n.${a.id}`, "uiBold", 19, ink(ui)), unverifiedLine(ui, `host.${a.id}`)] },
    ],
  }];
  const say = (key: WordKey) => body.push(GAP(14), word(en(key), "ui", 15, { lineHeight: 23, color: ui.textDim }));
  if (!a.connected) say("st.no");
  else if (!app.tools) say("tools.err");
  else {
    if (a.toolsChanged) {
      body.push(GAP(14), {
        type: "Stack", style: { gap: 6, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
        children: [
          word(en("changed.h"), "uiBold", 15.5, ink(ui)),
          word(en("changed.p"), "ui", 13, { lineHeight: 19, color: ui.textDim }),
          GAP(4),
          pill(ui, en("changed.ok"), seq(haptic("selection"), call("POST", `/v1/connectors/${a.id}/tools/accept`, {
            body: app.version ? { version: app.version } : {},
            onSuccess: seq(haptic("success"), { kind: "refresh" }),
            onError: seq(toast(en("err.generic"), "error"), { kind: "refresh" }),
          })), "primary"),
        ],
      });
    }
    if (!tools.length) say("tools.none");
    tools.forEach((x, i) => body.push(toolCard(ui, a.id, x, i)));
    if (tools.some((x) => x.risk === "destructive" || x.risk === "pay")) {
      body.push(GAP(6), word(en("tools.always"), "ui", 12.5, { lineHeight: 18, color: ui.textDim }));
    }
  }
  return page(ctx, TOOLS_SCREEN, ui, en("tools.h"), en("tools.p"), body, { state });
}

/** One tool: its name and words from state, and the choices it may have. */
function toolCard(ui: You, id: string, x: ConnectorTool, i: number): Node {
  const set = (p: ConnectorTool["policy"]): ActionSpec => seq(
    haptic("selection"),
    setState(`pol.${i}`, p),
    call("POST", `/v1/connectors/${id}/tools/policy`, {
      body: { tool: x.name, policy: p },
      // Whatever went wrong, the screen shows what the server holds.
      onError: seq(toast(en("err.level"), "error"), { kind: "refresh" }),
    }),
  );
  const choices = (x.choices ?? [x.policy]).map((p): Node => ({
    type: "Stack",
    children: [
      { ...choice(ui, en(POLICY_WORD[p]), true), visibleIf: { eq: [`pol.${i}`, p] } },
      { ...choice(ui, en(POLICY_WORD[p]), false, set(p)), visibleIf: { neq: [`pol.${i}`, p] } },
    ],
  }));
  return {
    type: "Stack",
    style: { gap: 6, padding: 14, borderRadius: 18, marginTop: 8, backgroundColor: ui.pill.background },
    children: [
      {
        type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 8 },
        children: [
          fromState(`tools.${i}.label`, "uiMedium", 15, { ...ink(ui), flex: 1 }),
          ...(x.changed ? [word(en("changed.tag"), "uiBold", 11, { color: ui.text })] : []),
        ],
      },
      fromState(`tools.${i}.description`, "ui", 13, { lineHeight: 19, color: ui.textDim }),
      { type: "Stack", style: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" }, children: choices },
    ],
  };
}

// ---------------------------------------------------------------------------
// The confirm card, as actions
// ---------------------------------------------------------------------------

/** The card for a waiting task, built by the same code as the agent's. */
function cardOf(task: AssistantTask, names: Record<string, string>): ApprovalCard | undefined {
  const a: AgentApproval | null = task.approval;
  if (task.state !== "waiting" || !a) return undefined;
  return approvalCard(task.id, a, names[a.connector] ?? a.connector);
}

const button = (card: ApprovalCard, id: "approve" | "edit" | "deny") => card.buttons.find((b) => b.id === id)!;

function callOf(card: ApprovalCard, id: "approve" | "edit" | "deny", rest: Partial<CallEndpoint>): ActionSpec {
  const b = button(card, id);
  return { kind: "callEndpoint", method: b.call.method, path: b.call.path, body: b.call.body ?? {}, ...rest };
}

/** The yes: the call, and what is said after it, whichever way it went. */
function approveCall(card: ApprovalCard, then: ActionRef): ActionSpec {
  return callOf(card, "approve", {
    assignTo: "res",
    onSuccess: {
      kind: "condition", if: { truthy: "res.ok" },
      then: seq(haptic("success"), toast(card.after.done, "success"), then),
      else: seq(haptic("error"), toast(card.after.failed, "error"), then),
    },
    onError: seq(toast(card.after.failed, "error"), then),
  });
}

/** Approve with Face ID or a fingerprint. Nothing is sent unless it passes. */
function approveChecked(card: ApprovalCard, then: ActionRef, unavailable: ActionRef): ActionSpec {
  return {
    kind: "biometricPrompt",
    reason: en("a3.reason", { app: card.app }),
    onSuccess: approveCall(card, then),
    // Cancelled or failed: stay where you are. (onError is left out on purpose.)
    onUnavailable: unavailable,
  };
}

function denyCall(card: ApprovalCard, id: "edit" | "deny", said: string, then: ActionRef): ActionSpec {
  return callOf(card, id, {
    onSuccess: seq(haptic("selection"), toast(said), then),
    onError: seq(toast(card.after.failed, "error"), then),
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const lastStep = (task: AssistantTask): string => task.steps[task.steps.length - 1]?.text ?? "";

/** An app's logo beside the line that names it (just the line when the app keeps its badge). */
const withLogo = (logo: Node | undefined, line: Node): Node => logo
  ? { type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 8 }, children: [logo, { ...line, style: { ...line.style, flex: 1 } }] }
  : line;

/** Is this connector id an app a person added by link? (Then it never gets a logo.) */
const customApp = (ctx: AssistantScreenCtx, id: string): boolean => ctx.assistant?.apps?.find((x) => x.id === id)?.custom === true;

function tasksScreen(ctx: Ctx, ui: You): ScreenResponse {
  const tasks = ctx.assistant?.tasks;
  const names = ctx.assistant?.names ?? {};
  const body: Node[] = [];
  if (!tasks) {
    body.push(cannotReach(ui));
    return page(ctx, TASKS, ui, en("a4.h"), en("tasks.h"), body, { state: {} });
  }
  if (!tasks.length) {
    body.push(empty("think-s", [en("tasks.empty")], ui));
    return page(ctx, TASKS, ui, en("a4.h"), en("tasks.h"), body, { state: {} });
  }

  // Everything the person or the app wrote lives in state, row by row.
  const rows: Array<{ title: string; step: string; preview: string; app: string }> = [];
  const waiting = tasks.filter((x) => x.state === "waiting" && x.approval);
  const running = tasks.filter((x) => x.state === "running");
  const finished = tasks.filter((x) => x.state === "done" || x.state === "failed" || x.state === "cancelled");
  const slot = (x: AssistantTask): number => {
    rows.push({ title: x.title, step: lastStep(x), preview: x.approval?.preview ?? "", app: x.approval ? names[x.approval.connector] ?? x.approval.connector : "" });
    return rows.length - 1;
  };

  const lead = (on: Node): Node => ({ type: "Stack", style: { width: 26, alignItems: "center", paddingTop: 2 }, children: [on] });
  const dot = (filled: boolean): Node => ({
    type: "Stack",
    style: { width: 10, height: 10, borderRadius: 5, marginTop: 5, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", backgroundColor: filled ? "rgba(255,255,255,0.5)" : "transparent" },
  });
  const card = (kids: Node[]): Node => ({
    type: "Stack",
    style: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 18, marginBottom: 8, backgroundColor: ui.pill.background },
    children: kids,
  });
  // THE ONE BLIP, beside the heading of what matters most: pointing at what
  // waits for an OK, else carrying what is running, else thumbs-up on what is
  // done. Never in a card.
  const pose: [WordKey, BlipLoop] | undefined = waiting.length ? ["a4.w", "pointd-s"]
    : running.length ? ["a4.r", "carry-s"]
    : tasks.some((x) => x.state === "done") ? ["a4.d", "thumbs-s"] : undefined;
  const section = (key: WordKey, list: AssistantTask[], draw: (x: AssistantTask, i: number) => Node) => {
    if (!list.length) return;
    body.push(pose?.[0] === key
      ? {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 8 },
          children: [label(en(key)), blipBox(pose[1], 0.55)],
        } as Node
      : label(en(key), { marginTop: 28, marginBottom: 12 }));
    for (const x of list) body.push(draw(x, slot(x)));
  };

  section("a4.w", waiting, (x, i) => {
    const c = cardOf(x, names);
    const stay: ActionRef = { kind: "refresh" };
    return card([
      lead(dot(false)),
      { type: "Stack", style: { flex: 1, gap: 6 }, children: [
        fromState(`t.${i}.title`, "uiMedium", 15, ink(ui)),
        withLogo(
          appIconNode(x.approval!.connector, 20, customApp(ctx, x.approval!.connector)),
          word(en("a4.wm", { app: names[x.approval!.connector] ?? x.approval!.connector }), "ui", 12.5, { color: ui.textDim }),
        ),
        // The exact words, as they will go: from state, so nothing rewords them.
        { type: "Stack", style: { padding: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)" }, children: [
          fromState(`t.${i}.preview`, "ui", 14, { lineHeight: 20, color: ui.text }),
        ] },
        ...(c ? [{
          type: "Stack", style: { flexDirection: "row", gap: 8, marginTop: 4 },
          children: [
            pill(ui, c.buttons[0]!.label, approveChecked(c, stay, { kind: "navigate", screenId: "assistant_approve", params: { taskId: x.id, ...(ctx.lone ? { alone: "1" } : {}) } }), "primary", true),
            pill(ui, c.buttons[2]!.label, denyCall(c, "deny", c.after.left, stay), "outline", true),
          ],
        } as Node] : []),
      ] },
    ]);
  });

  section("a4.r", running, (_x, i) => card([
    lead(dot(true)),
    { type: "Stack", style: { flex: 1, gap: 3 }, children: [
      fromState(`t.${i}.title`, "uiMedium", 15, ink(ui)),
      fromState(`t.${i}.step`, "ui", 12.5, { color: ui.textDim }),
    ] },
  ]));

  section("a4.d", finished, (_x, i) => card([
    lead(word("✓", "uiBold", 15, { color: ui.text, textTransform: "none" })),
    { type: "Stack", style: { flex: 1, gap: 3 }, children: [
      fromState(`t.${i}.title`, "uiMedium", 15, ink(ui)),
      fromState(`t.${i}.step`, "ui", 12.5, { color: ui.textDim }),
    ] },
  ]));

  if (rows.length) body.push(GAP(10), word(en("a4.end"), "ui", 13.5, { color: ui.textFaint, textAlign: "center" }));
  return page(ctx, TASKS, ui, en("a4.h"), en("tasks.h"), body, { state: { t: rows, res: {} } });
}

// ---------------------------------------------------------------------------
// The confirm sheet
// ---------------------------------------------------------------------------

function approveScreen(ctx: Ctx, ui: You): ScreenResponse {
  const names = ctx.assistant?.names ?? {};
  const waiting = (ctx.assistant?.tasks ?? []).filter((x) => x.state === "waiting" && x.approval);
  const asked = typeof ctx.params?.taskId === "string" ? ctx.params.taskId : undefined;
  const task = asked ? waiting.find((x) => x.id === asked) : waiting[0];
  const card = task && cardOf(task, names);
  const toTasks: ActionSpec = { kind: "navigate", screenId: TASKS, replace: true, ...(ctx.lone ? { params: { alone: "1" } } : {}) };

  if (!task || !card) {
    return page(ctx, "assistant_approve", ui, en("a4.h"), en("a4.w"), [
      // All answered: Blip with a thumbs-up, and the line that was always here.
      empty("thumbs-s", [en("a3.none")], ui),
      GAP(18),
      pill(ui, en("a4.h"), toTasks),
    ], { state: {} });
  }

  const sheet: Node = {
    type: "BottomSheet",
    bind: { open: "open" },
    props: sheetProps(ui),
    // Dismissed without an answer: it stays waiting, in Tasks.
    on: { onDismiss: toTasks },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
        children: [
          appIconNode(task.approval!.connector, 46, customApp(ctx, task.approval!.connector)) ?? {
            type: "Stack",
            style: { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
            children: [fromState("ini", "uiBold", 19, ink(ui))],
          },
          { type: "Stack", style: { flex: 1, gap: 2 }, children: [
            word(card.title, "uiBold", 19, ink(ui)),
            fromState("app", "ui", 13, { color: ui.textDim }),
          ] },
        ],
      },
      label(card.label, { marginBottom: 8 }),
      // The exact words. From state, never from a node.
      { type: "Stack", style: { padding: 14, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)", marginBottom: 12 }, children: [
        fromState("preview", "ui", 15.5, { lineHeight: 23, color: ui.text }),
      ] },
      word(card.note, "ui", 13, { lineHeight: 19, color: ui.textDim, marginBottom: 14 }),
      // A phone with nothing to check against says so, and asks with a tap.
      { ...word(en("a3.nobio"), "ui", 12.5, { lineHeight: 18, color: ui.textDim, marginBottom: 10 }), visibleIf: { truthy: "plain" } },
      { ...pill(ui, button(card, "approve").label, approveChecked(card, toTasks, setState("plain", true)), "primary"), visibleIf: { falsy: "plain" } },
      { ...pill(ui, button(card, "approve").label, seq(haptic("selection"), approveCall(card, toTasks)), "primary"), visibleIf: { truthy: "plain" } },
      GAP(8),
      {
        type: "Stack", style: { flexDirection: "row", gap: 8 },
        children: [
          pill(ui, button(card, "edit").label, denyCall(card, "edit", card.after.change, toTasks), "outline", true),
          pill(ui, button(card, "deny").label, denyCall(card, "deny", card.after.left, toTasks), "quiet", true),
        ],
      },
    ],
  };

  return page(ctx, "assistant_approve", ui, en("a4.h"), en("a4.w"), [sheet], {
    state: {
      open: true, plain: false, res: {},
      app: card.app, ini: card.app.trim().charAt(0).toUpperCase() || "?", preview: card.preview,
    },
  });
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

/**
 * What one tap of Do it runs, from actions every build has: the ask, then its
 * answer acted on. The line is drawn from state (ask.res.say); a hand-off is
 * opened (openUrl resolves the state reference and, with `handoff`, holds it
 * to the phone's own copy of the hand-off list; a build without that list
 * holds it to the links it opens at all); an approval goes to the confirm sheet. The
 * sheet is opened without the task's id, since `navigate` does not fill state
 * into its params: with none it shows the newest waiting task, which is the
 * one this ask just made.
 */
export function askAction(ctx: Pick<AssistantScreenCtx, "platform" | "tzOffsetMinutes">): ActionSpec {
  return {
    kind: "condition", if: { truthy: "ask.text" },
    then: seq(
      haptic("selection"), setState("ask.busy", true), setState("ask.res", {}),
      call("POST", "/v1/assistant/ask", {
        body: {
          text: "$state.ask.text", ...(ctx.platform ? { platform: ctx.platform } : {}),
          ...(typeof ctx.tzOffsetMinutes === "number" ? { tzOffsetMinutes: ctx.tzOffsetMinutes } : {}),
        },
        assignTo: "ask.res",
        onSuccess: seq(
          setState("ask.busy", false),
          setState("ask.text", ""),
          { kind: "condition", if: { truthy: "ask.res.open.url" }, then: { kind: "openUrl", url: "$state.ask.res.open.url", handoff: true } },
          { kind: "condition", if: { truthy: "ask.res.taskId" }, then: { kind: "navigate", screenId: "assistant_approve" } },
        ),
        onError: seq(setState("ask.busy", false), toast(en("err.generic"), "error")),
      }),
    ),
    else: toast(en("ask.empty")),
  };
}

/** The three examples, in their voice. They live in state (ask.ex), so a chip shows exactly what it fills in: a translated node would not match its value. */
export function askExamples(language?: string): string[] {
  const w = wordsFor(language);
  return [w("ask.ex1"), w("ask.ex2"), w("ask.ex3")];
}

/** One example to tap: it fills the field with the very words it shows. */
function askChip(ui: You, examples: readonly string[], i: number): Node {
  return {
    type: "Stack",
    on: { onPress: seq(haptic("selection"), setState("ask.text", examples[i])) },
    props: { pressOpacity: 0.7 },
    style: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
    children: [fromState(`ask.ex.${i}`, "ui", 13.5, { color: ui.text })],
  };
}

/** What Ask is made of, for the Ask screen and for the You tab's card: one builder, so the two cannot drift apart. */
const askParts = {
  field: (): Node => ({ type: "TextField", bind: { value: "ask.text" }, props: { placeholder: en("ask.ph"), multiline: true } }),
  /** The mic that writes into the field, and Do it. */
  controls: (ctx: Pick<AssistantScreenCtx, "platform" | "tzOffsetMinutes">, ui: You): Node => ({
    type: "Stack", style: { flexDirection: "row", gap: 8, alignItems: "center" },
    children: [
      {
        type: "VoiceButton", bind: { value: "ask.text" },
        props: { targetApp: "Tailzu", language: "auto", label: en("ask.mic"), background: ui.pill.background, radius: 999, paddingVertical: 14 },
        style: { flex: 1 },
      },
      pill(ui, en("ask.go"), askAction(ctx), "primary", true),
    ],
  }),
  /** The answer: its words are the server's and theirs, from state, never reworded. */
  answer: (ui: You, fill: string, top: number): Node => ({
    type: "Stack",
    visibleIf: { truthy: "ask.res.say" },
    style: { padding: 14, borderRadius: 16, marginTop: top, backgroundColor: fill },
    children: [fromState("ask.res.say", "ui", 15.5, { lineHeight: 23, color: ui.text })],
  }),
  chips: (ui: You, examples: readonly string[]): Node =>
    ({ type: "Stack", style: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, children: examples.map((_, i) => askChip(ui, examples, i)) }),
  state: (examples: readonly string[]) => ({ ask: { text: "", busy: false, res: {}, ex: examples } }),
};

function askScreen(ctx: Ctx, ui: You): ScreenResponse {
  if (!ctx.connectorsOn) {
    return page(ctx, ASK, ui, en("ask.h"), en("ask.p"), [cannotReach(ui)], { state: {} });
  }
  const examples = askExamples(ctx.language);
  const body: Node[] = [
    GAP(18),
    askParts.field(),
    GAP(12),
    askParts.controls(ctx, ui),
    // WORKING: Blip thinking, beside the line that was always here. The one Blip here.
    {
      type: "Stack",
      visibleIf: { truthy: "ask.busy" },
      style: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
      children: [blipBox("think-s", 0.5), word(en("ask.busy"), "ui", 13.5, { color: ui.textDim, flex: 1 })],
    },
    askParts.answer(ui, ui.pill.background, 16),
    label(en("ask.try"), { marginTop: 28, marginBottom: 12 }),
    askParts.chips(ui, examples),
  ];
  return page(ctx, ASK, ui, en("ask.h"), en("ask.p"), body, { state: askParts.state(examples) });
}

// ---------------------------------------------------------------------------
// The You tab's card: hand a task over, and see what is coming up
// ---------------------------------------------------------------------------

/** Rows in "Coming up", and logos in the card's foot. */
const UP_ROWS = 3;
const UP_APPS = 5;

/**
 * The next tasks, as the You tab shows them: what waits for the person's OK
 * first, then what is running, then the latest one done. At most three.
 */
export function comingUp(tasks: readonly AssistantTask[]): AssistantTask[] {
  const waiting = tasks.filter((x) => x.state === "waiting" && x.approval);
  const running = tasks.filter((x) => x.state === "running");
  const done = tasks.filter((x) => x.state === "done").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return [...waiting, ...running, ...(done ? [done] : [])].slice(0, UP_ROWS);
}

/** The assistant's pages, in the cream ink the You tab's cards are set in. */
const cream = (ui: You): You => ({
  ...ui, text: PHONE_LOOK.ink, textDim: PHONE_LOOK.ink2, textFaint: PHONE_LOOK.ink3,
  pill: { ...ui.pill, background: PHONE_LOOK.track },
});

/** A small arrow that says a line goes somewhere. */
const goes = (ui: You): Node => ({
  type: "SVG",
  props: { viewBox: "0 0 24 24", d: "M9 5 L16 12 L9 19", fill: "none", stroke: ui.textDim, strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" },
  style: { width: 11, height: 11 },
});

/** A line you press that goes to another page, with the arrow after it. */
const link = (ui: You, text: string, screenId: string, style: Style = {}): Node => ({
  type: "Stack",
  on: { onPress: seq(haptic("selection"), { kind: "navigate", screenId }) },
  props: { pressOpacity: 0.6, hitSlop: 10 },
  style: { flexDirection: "row", alignItems: "center", gap: 6, ...style },
  children: [word(text, "uiMedium", 13, { color: ui.text }), goes(ui)],
});

/**
 * HAND IT TO ME: a card on the You tab, only while connected apps are on.
 *
 * It does what Ask does, from the tab: a field, the mic, Do it (the very
 * actions assistant_ask runs, built by the same code), and a few examples
 * to tap. Under them, Coming up, the person's next three tasks (the same
 * data as Tasks), and in the foot the apps that are connected and a way to
 * add more. No Blip: the greeting above has the one this tab gets.
 *
 * Everything the person or an app wrote (a task's title, its step, an app's
 * letter) is drawn from this card's state, never from a node, as on Tasks.
 * A read of the assistant that failed leaves the card without Coming up (it
 * would say "Nothing" about a list that was never read), and the rest works.
 */
export function youCard(
  ctx: AssistantScreenCtx, base: You, o: { marginBottom?: number } = {},
): { node: Node; state: Record<string, unknown> } | null {
  if (!ctx.connectorsOn) return null;
  const ui = cream(base);
  const names = ctx.assistant?.names ?? {};
  const apps = ctx.assistant?.apps;
  const tasks = ctx.assistant?.tasks;
  const examples = askExamples(ctx.language);
  const rows: Array<{ title: string; sub: string }> = [];
  const ini: Record<string, string> = {};
  const letter = (name: string): string => name.trim().charAt(0).toUpperCase() || "?";

  const toTasks: ActionSpec = { kind: "navigate", screenId: TASKS };
  const open = (x: AssistantTask): ActionSpec => ({ kind: "navigate", screenId: "assistant_approve", params: { taskId: x.id } });

  const status = (x: AssistantTask): Node => {
    if (x.state === "waiting") {
      const id = x.approval!.connector;
      ini[id] = letter(names[id] ?? id);
      return mark(ui, id, 34, customApp(ctx, id));
    }
    const box: Style = { width: 34, height: 34, alignItems: "center", justifyContent: "center" };
    // Done: a neon tick, which is what neon is for here.
    if (x.state === "done") {
      return {
        type: "Stack", style: box,
        children: [{
          type: "SVG",
          props: { viewBox: "0 0 24 24", d: "M5 12.5 L10 17.5 L19 7", fill: "none", stroke: NEON, strokeWidth: 2.8, strokeLinecap: "round", strokeLinejoin: "round" },
          style: { width: 20, height: 20 },
        }],
      };
    }
    // Running: the dot Tasks draws for it.
    return {
      type: "Stack", style: box,
      children: [{ type: "Stack", style: { width: 10, height: 10, borderRadius: 5, backgroundColor: ui.textDim } }],
    };
  };

  const rowOf = (x: AssistantTask, i: number): Node => {
    const waits = x.state === "waiting";
    rows.push({ title: x.title, sub: waits ? names[x.approval!.connector] ?? x.approval!.connector : lastStep(x) });
    const line = (n: Node): Node => ({ ...n, props: { ...n.props, numberOfLines: 1 } });
    return {
      type: "Stack",
      on: { onPress: seq(haptic("selection"), waits ? open(x) : toTasks) },
      props: { pressOpacity: 0.7 },
      style: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 10, paddingRight: 12, borderRadius: 16, backgroundColor: PHONE_LOOK.track },
      children: [
        status(x),
        { type: "Stack", style: { flex: 1, gap: 2 }, children: [
          line(fromState(`up.${i}.title`, "uiMedium", 14.5, { color: ui.text })),
          line(fromState(`up.${i}.sub`, "ui", 12, { color: ui.textDim })),
        ] },
        ...(waits ? [{
          type: "Stack",
          on: { onPress: seq(haptic("selection"), open(x)) },
          props: { pressOpacity: 0.7 },
          style: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(243,226,198,0.5)" },
          children: [word(sw("y.ok"), "uiMedium", 12, { color: ui.text })],
        } as Node] : []),
      ],
    };
  };

  const next = tasks ? comingUp(tasks) : undefined;
  const comingSection: Node[] = next ? [
    {
      type: "Stack", style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 26, marginBottom: 12 },
      children: [label(sw("y.up")), link(ui, sw("y.all"), TASKS)],
    },
    next.length
      ? { type: "Stack", style: { gap: 8 }, children: next.map(rowOf) }
      : {
          type: "Stack", style: { padding: 14, borderRadius: 16, backgroundColor: PHONE_LOOK.track },
          children: [t(sw("y.none"), "ui", 14.5, { lineHeight: 21, color: ui.textDim })],
        },
  ] : [];

  // The foot: the apps that are connected (their logos or letters), and the way to more.
  const shown = (apps ?? []).filter((a) => a.connected).slice(0, UP_APPS);
  for (const a of shown) ini[a.id] = letter(a.name);
  const foot: Node = {
    type: "Stack",
    style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14 },
    children: [
      {
        type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
        children: shown.length ? [
          // Connected: neon, once, before the logos.
          { type: "Stack", style: { marginRight: 4 }, children: [neonDot(7)] },
          ...shown.map((a) => mark(ui, a.id, 28, a.custom)),
        ] : [],
      },
      link(ui, sw("y.more"), "assistant_apps"),
    ],
  };

  const node: Node = {
    type: "Stack",
    // keepCase: the words are set as written; the phone capitalises its own (word).
    props: { keepCase: true },
    style: {
      borderRadius: 20, padding: 20, backgroundColor: "#1A1611", borderWidth: 1, borderColor: "rgba(243,226,198,0.12)",
      ...(o.marginBottom !== undefined ? { marginBottom: o.marginBottom } : {}),
    },
    children: [
      // The onboarding's heading face, and one warm line.
      word(sw("y.h"), "grotesk", 26, { letterSpacing: -0.6 }),
      t(sw("y.p"), "ui", 14.5, { lineHeight: 21, color: ui.textDim, marginTop: 6 }),
      GAP(16),
      askParts.field(),
      GAP(10),
      askParts.controls(ctx, ui),
      {
        type: "Stack", visibleIf: { truthy: "ask.busy" },
        style: { marginTop: 12 },
        children: [word(en("ask.busy"), "ui", 13.5, { color: ui.textDim })],
      },
      askParts.answer(ui, PHONE_LOOK.track, 12),
      { type: "Stack", style: { marginTop: 16 }, children: [askParts.chips(ui, examples)] },
      ...comingSection,
      { type: "Stack", style: { height: 1, backgroundColor: PHONE_LOOK.rule, marginTop: 22 } },
      foot,
    ],
  };
  return { node, state: { ...askParts.state(examples), up: rows, ini } };
}

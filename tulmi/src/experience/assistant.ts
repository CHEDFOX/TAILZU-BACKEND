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
import type { AgentApproval, ApprovalCard, AssistantTask, ConnectorInfo } from "../../../shared/types/api.js";
import { approvalCard } from "../connectors/card.js";
import type { AssistantView } from "../connectors/list.js";
import { en, type WordKey } from "../connectors/words.js";
import { PHONE_LOOK, label, t } from "./phoneLook.js";

type You = typeof import("./catalog.js").YOU_UI;
type Style = Record<string, unknown>;
type Face = Parameters<typeof t>[1];
type CallEndpoint = Extract<ActionSpec, { kind: "callEndpoint" }>;

export const ASSISTANT_SCREENS: ReadonlySet<string> = new Set(["assistant_apps", "assistant_tasks", "assistant_approve"]);

export interface AssistantScreenCtx {
  /** The apps and tasks, read for this screen. Absent: off, or the read failed. */
  assistant?: AssistantView;
  params?: Record<string, unknown>;
  /** What this build of the app says it can draw and do. */
  can?: ReadonlySet<string>;
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
      word(title, "writtenLight", 22, { letterSpacing: -0.3, marginTop: 8 }),
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

/** The app's mark: its first letter on a rounded square (no logos to carry). */
function mark(ui: You, id: string, size = 42): Node {
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
  const body: Node[] = [];

  if (!apps) {
    body.push(word(en("apps.off"), "ui", 15, { lineHeight: 23, color: ui.text }));
    return page(ctx, "assistant_apps", ui, en("apps.h"), en("apps.p"), body, { state: {} });
  }

  const state: Record<string, unknown> = { sheet: {}, lvl: {}, paste: {}, n: {}, ini: {}, link: {}, res: {} };
  const set = (k: string, id: string, v: unknown) => { (state[k] as Record<string, unknown>)[id] = v; };
  for (const a of apps) {
    set("sheet", a.id, false); set("lvl", a.id, a.level); set("n", a.id, a.name);
    set("ini", a.id, a.name.trim().charAt(0).toUpperCase() || "?"); set("paste", a.id, "");
  }

  // Not connected first, as the apps to start with; then what is connected;
  // then the rest. (Suggested = the first few not yet connected, in the
  // catalog's order, which is its order of usefulness.)
  const todo = apps.filter((a) => !a.connected);
  const done = apps.filter((a) => a.connected);
  const suggested = todo.slice(0, 4);
  const more = todo.slice(4);

  const sections: Array<[WordKey, ConnectorInfo[]]> = [["s6.sug", suggested], ["apps.h", done], ["s6.more", more]];
  for (const [key, list] of sections) {
    if (!list.length) continue;
    body.push(label(en(key), { marginTop: 28, marginBottom: 12 }));
    body.push({ type: "Grid", props: { columns: 3, gap: 8 }, children: list.map((a) => tile(a, ui, canOpen)) });
  }
  // A bundle that cannot open a sign-in page is told so, once, in our words.
  if (!canOpen && todo.some((a) => a.auth === "oauth")) {
    body.push(GAP(18), word(en("apps.update"), "ui", 13.5, { lineHeight: 20, color: ui.textDim }));
  }
  // One sheet per app that has something to show.
  for (const a of apps) {
    if (a.connected) body.push(levelSheet(a, ui, canOpen));
    else if (a.auth === "url") body.push(pasteSheet(a, ui));
  }

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
  const press: ActionRef =
    a.connected || a.auth === "url" ? open
      : canOpen ? connectFlow(a)
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
      mark(ui, a.id),
      fromState(`n.${a.id}`, "uiMedium", 13.5, { ...ink(ui), textAlign: "center", lineHeight: 18 }),
      {
        type: "Stack",
        style: {
          borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
          backgroundColor: a.connected ? "transparent" : ui.text,
          ...(a.connected ? { borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" } : {}),
        },
        children: [word(en(state), "uiBold", 11, { color: a.connected ? ui.text : ui.onAccent })],
      },
      // How far it may go, under a connected app's name. Three lines, one
      // shown, so a change made in its sheet shows here without a reload.
      ...(a.connected ? LEVELS.map((l): Node => ({
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
      mark(ui, a.id, 46),
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

function tasksScreen(ctx: Ctx, ui: You): ScreenResponse {
  const tasks = ctx.assistant?.tasks;
  const names = ctx.assistant?.names ?? {};
  const body: Node[] = [];
  if (!tasks) {
    body.push(word(en("apps.off"), "ui", 15, { lineHeight: 23, color: ui.text }));
    return page(ctx, TASKS, ui, en("a4.h"), en("tasks.h"), body, { state: {} });
  }
  if (!tasks.length) {
    body.push(word(en("tasks.empty"), "ui", 15, { lineHeight: 23, color: ui.textDim }));
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
  const section = (key: WordKey, list: AssistantTask[], draw: (x: AssistantTask, i: number) => Node) => {
    if (!list.length) return;
    body.push(label(en(key), { marginTop: 28, marginBottom: 12 }));
    for (const x of list) body.push(draw(x, slot(x)));
  };

  section("a4.w", waiting, (x, i) => {
    const c = cardOf(x, names);
    const stay: ActionRef = { kind: "refresh" };
    return card([
      lead(dot(false)),
      { type: "Stack", style: { flex: 1, gap: 6 }, children: [
        fromState(`t.${i}.title`, "uiMedium", 15, ink(ui)),
        word(en("a4.wm", { app: names[x.approval!.connector] ?? x.approval!.connector }), "ui", 12.5, { color: ui.textDim }),
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
      word(en("a3.none"), "ui", 15, { lineHeight: 23, color: ui.textDim }),
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
          {
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

/**
 * Connected apps: the tile grid, each app's sheet, adding one by link and the directory of more.
 */

import type { ConnectorInfo } from "../../../../shared/types/api.js";
import type { ScreenResponse, Node, ActionSpec, ActionRef } from "../../../../shared/types/sdui.js";
import { en, type WordKey } from "../../connectors/words.js";
import { label, t } from "../phoneLook.js";
import { sw } from "../settingsWords.js";
import { neonDot } from "../touches.js";
import {
  type You, cannotReach, page, empty, GAP, pill, seq, haptic, ASK, word, call, toast, setState, mark, fromState, ink, sheetProps,
  sheetHead, type Style, TOOLS_SCREEN, unverifiedLine,
} from "./kit.js";
import type { Ctx } from "./screens.js";

const LEVELS = ["look", "draft", "send"] as const;
type Level = (typeof LEVELS)[number];

// ---------------------------------------------------------------------------
// Connected apps
// ---------------------------------------------------------------------------
export function appsScreen(ctx: Ctx, ui: You): ScreenResponse {
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

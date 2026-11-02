/**
 * The parts the assistant's screens share: words, actions, the page and its head, pills, marks and sheets.
 */

import type { ConnectorInfo, AssistantTask } from "../../../../shared/types/api.js";
import { type ActionSpec, type Node, type ActionRef, type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { en } from "../../connectors/words.js";
import { appIconNode } from "../appIcons.js";
import type { BlipLoop } from "../blipLoops.js";
import { t, PHONE_LOOK, label } from "../phoneLook.js";
import { sw } from "../settingsWords.js";
import { blipPicture } from "../touches.js";
import type { Ctx, AssistantScreenCtx } from "./screens.js";

export type You = typeof import("../phone/you/copy.js").YOU_UI;
export type Style = Record<string, unknown>;
type Face = Parameters<typeof t>[1];
export type CallEndpoint = Extract<ActionSpec, { kind: "callEndpoint" }>;

export const ASK = "assistant_ask";

export const TASKS = "assistant_tasks";

/** Words of ours, capitalised by the phone (see WORDS above). */
export const word = (content: string, face: Face, size: number, style: Style = {}): Node =>
  t(content, face, size, { textTransform: "capitalize", ...style });

/**
 * Blip, centred, with the lines under him: an empty state's one warm line, or
 * an error's words and then its fix. The lines are sentences, set as written.
 * One of these a screen, never in a list or a row (touches.ts).
 */
export const empty = (loop: BlipLoop, lines: string[], ui: You, first: Style = {}): Node => ({
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
export const cannotReach = (ui: You): Node => empty("think-s", [en("apps.off"), sw("x.apps")], ui);

/** Text drawn from the screen's state: never translated, never recased. */
export const fromState = (path: string, face: Face, size: number, style: Style = {}): Node =>
  ({ ...t("", face, size, style), bind: { content: path } });

export const toast = (message: string, tone: "success" | "error" | "info" = "info"): ActionSpec => ({ kind: "toast", message, tone });
export const haptic = (style: "selection" | "success" | "error"): ActionSpec => ({ kind: "haptic", style });
export const seq = (...actions: ActionRef[]): ActionSpec => ({ kind: "sequence", actions });
export const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
export const call = (method: CallEndpoint["method"], path: string, rest: Partial<CallEndpoint> = {}): ActionSpec =>
  ({ kind: "callEndpoint", method, path, body: method === "GET" ? undefined : {}, ...rest });

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
export const GAP = (h: number): Node => ({ type: "Spacer", style: { height: h } });

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
export function page(c: Ctx, screenId: string, ui: You, kicker: string, title: string, body: Node[], extra: Partial<ScreenResponse> = {}): ScreenResponse {
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
export function pill(ui: You, text: string, on: ActionRef, kind: "primary" | "outline" | "quiet" = "outline", grow = false): Node {
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
export function mark(ui: You, id: string, size = 42, custom?: boolean, tile = "rgba(255,255,255,0.08)"): Node {
  const logo = appIconNode(id, size, custom);
  if (logo) return logo;
  return {
    type: "Stack",
    style: { width: size, height: size, borderRadius: size * 0.29, alignItems: "center", justifyContent: "center", backgroundColor: tile },
    children: [fromState(`ini.${id}`, "uiBold", Math.round(size * 0.42), { color: ui.text })],
  };
}

export const ink = (ui: You, dim = false): Style => ({ color: dim ? ui.textDim : ui.text });

export const sheetProps = (ui: You): Record<string, unknown> => ({
  background: ui.pill.background, radius: 26, padding: 20, paddingBottom: 34,
  handleColor: "rgba(255,255,255,0.22)", scrimColor: "rgba(0,0,0,0.6)",
});

export function sheetHead(a: ConnectorInfo, ui: You, line: string): Node {
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

// ---------------------------------------------------------------------------
// Apps added by link (only while CUSTOM_CONNECTORS is on)
// ---------------------------------------------------------------------------
export const TOOLS_SCREEN = "assistant_app_tools";

/** "Unverified · host": our word, then the host from state. */
export function unverifiedLine(ui: You, hostPath: string): Node {
  return {
    type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
    children: [
      word(en("custom.tag"), "uiBold", 11.5, { color: ui.textDim, letterSpacing: 0.3 }),
      t("·", "ui", 12, { color: ui.textDim }),
      fromState(hostPath, "ui", 12.5, { color: ui.textDim }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export const lastStep = (task: AssistantTask): string => task.steps[task.steps.length - 1]?.text ?? "";

/** Is this connector id an app a person added by link? (Then it never gets a logo.) */
export const customApp = (ctx: AssistantScreenCtx, id: string): boolean => ctx.assistant?.apps?.find((x) => x.id === id)?.custom === true;

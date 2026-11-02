/**
 * An app added by link, tool by tool: Allow, Ask first or Off.
 */

import type { ConnectorTool } from "../../../../shared/types/api.js";
import type { ActionRef, Node, ScreenResponse, ActionSpec } from "../../../../shared/types/sdui.js";
import { en, type WordKey } from "../../connectors/words.js";
import { type You, word, page, TOOLS_SCREEN, mark, fromState, ink, unverifiedLine, GAP, pill, seq, haptic, call, toast, setState } from "./kit.js";
import type { Ctx } from "./screens.js";

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

export function toolsScreen(ctx: Ctx, ui: You): ScreenResponse {
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

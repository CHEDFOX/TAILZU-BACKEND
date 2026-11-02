/**
 * The confirm card, as a bottom sheet: where an approval push lands.
 */

import type { ScreenResponse, ActionSpec, Node } from "../../../../shared/types/sdui.js";
import { en } from "../../connectors/words.js";
import { appIconNode } from "../appIcons.js";
import { label } from "../phoneLook.js";
import { type You, TASKS, page, empty, GAP, pill, sheetProps, customApp, fromState, ink, word, setState, seq, haptic } from "./kit.js";
import type { Ctx } from "./screens.js";
import { cardOf, button, approveChecked, approveCall, denyCall } from "./tasks.js";

// ---------------------------------------------------------------------------
// The confirm sheet
// ---------------------------------------------------------------------------
export function approveScreen(ctx: Ctx, ui: You): ScreenResponse {
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

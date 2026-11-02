/**
 * The assistant's tasks: waiting for the person, running, done, and approving or denying one.
 */

import type { AssistantTask, ApprovalCard, AgentApproval } from "../../../../shared/types/api.js";
import type { ActionSpec, ActionRef, Node, ScreenResponse } from "../../../../shared/types/sdui.js";
import { approvalCard } from "../../connectors/card.js";
import { en, type WordKey } from "../../connectors/words.js";
import { appIconNode } from "../appIcons.js";
import type { BlipLoop } from "../blipLoops.js";
import { label } from "../phoneLook.js";
import { blipBox } from "../touches.js";
import {
  type CallEndpoint, seq, haptic, toast, type You, cannotReach, page, TASKS, empty, lastStep, fromState, ink, customApp, word, pill, GAP,
} from "./kit.js";
import type { Ctx } from "./screens.js";

// ---------------------------------------------------------------------------
// The confirm card, as actions
// ---------------------------------------------------------------------------

/** The card for a waiting task, built by the same code as the agent's. */
export function cardOf(task: AssistantTask, names: Record<string, string>): ApprovalCard | undefined {
  const a: AgentApproval | null = task.approval;
  if (task.state !== "waiting" || !a) return undefined;
  return approvalCard(task.id, a, names[a.connector] ?? a.connector);
}

export const button = (card: ApprovalCard, id: "approve" | "edit" | "deny") => card.buttons.find((b) => b.id === id)!;

function callOf(card: ApprovalCard, id: "approve" | "edit" | "deny", rest: Partial<CallEndpoint>): ActionSpec {
  const b = button(card, id);
  return { kind: "callEndpoint", method: b.call.method, path: b.call.path, body: b.call.body ?? {}, ...rest };
}

/** The yes: the call, and what is said after it, whichever way it went. */
export function approveCall(card: ApprovalCard, then: ActionRef): ActionSpec {
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
export function approveChecked(card: ApprovalCard, then: ActionRef, unavailable: ActionRef): ActionSpec {
  return {
    kind: "biometricPrompt",
    reason: en("a3.reason", { app: card.app }),
    onSuccess: approveCall(card, then),
    // Cancelled or failed: stay where you are. (onError is left out on purpose.)
    onUnavailable: unavailable,
  };
}

export function denyCall(card: ApprovalCard, id: "edit" | "deny", said: string, then: ActionRef): ActionSpec {
  return callOf(card, id, {
    onSuccess: seq(haptic("selection"), toast(said), then),
    onError: seq(toast(card.after.failed, "error"), then),
  });
}

/** An app's logo beside the line that names it (just the line when the app keeps its badge). */
const withLogo = (logo: Node | undefined, line: Node): Node => logo
  ? { type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 8 }, children: [logo, { ...line, style: { ...line.style, flex: 1 } }] }
  : line;

export function tasksScreen(ctx: Ctx, ui: You): ScreenResponse {
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

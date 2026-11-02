/**
 * The assistant's tasks: what it is doing, and what waits for the person.
 */

import type { AssistantTask } from "../../../../shared/types/api.js";
import type { ScreenResponse, Node, ActionRef } from "../../../../shared/types/sdui.js";
import { en as w } from "../../connectors/words.js";
import { appIconNode } from "../appIcons.js";
import type { BlipLoop } from "../blipLoops.js";
import type { DeskContext } from "./context.js";
import { row, stack, text, failToast, blip, screen, page, link, emptyState } from "./kit.js";

/** The newest step, in the words the server wrote it in. */
const lastStep = (t: AssistantTask): string => t.steps[t.steps.length - 1]?.text ?? "";

/**
 * TASKS: what the assistant is doing in the person's apps, grouped Waiting for
 * you, Running and Done, each with what happened in plain words. A waiting one
 * shows the exact words and answers to Approve or Not now, the same two the
 * confirm card gives (routes/connectors.ts approve and deny).
 */
export function deskTasks(ctx: DeskContext): ScreenResponse {
  const tasks = ctx.assistant?.tasks ?? [];
  const names = ctx.assistant?.names ?? {};
  const waiting = tasks.filter((t) => t.state === "waiting" && t.approval);
  const running = tasks.filter((t) => t.state === "running");
  const done = tasks.filter((t) => t.state === "done" || t.state === "failed" || t.state === "cancelled");
  const item = (t: AssistantTask, body: Node[], right?: Node): Node => row([
    stack([text(t.title, "d-v"), ...body], { flex: 1, minWidth: 0, gap: 4 }),
    ...(right ? [right] : []),
  ], { align: "center", gap: 28, paddingTop: 18, paddingBottom: 18, flexWrap: "wrap" }, "d-entry");
  // "Waiting in Notion", with Notion's logo beside it when it has one (never for an app added by link).
  const named = (t: AssistantTask): Node => {
    const id = t.approval!.connector;
    const line = text(w("a4.wm", { app: names[id] ?? id }), "d-margin");
    const logo = appIconNode(id, 20, ctx.assistant?.apps?.find((x) => x.id === id)?.custom);
    return logo ? row([logo, line], { gap: 8, align: "center" }) : line;
  };
  const answer = (t: AssistantTask, route: "approve" | "deny"): ActionRef => ({
    kind: "callEndpoint", method: "POST", path: `/v1/tasks/${t.id}/${route}`,
    ...(route === "approve" ? { body: { approvalId: t.approval!.id } } : {}),
    // An answer that came too late is gone; the list says so by redrawing.
    onError: { kind: "sequence", actions: [failToast("err.generic"), { kind: "refresh" }] },
  } as ActionRef);
  // THE ONE BLIP, beside the heading of what matters most: pointing at what
  // waits for an OK, else carrying what is running, else thumbs-up on what is
  // done. Never inside a row of the list.
  const pose: [string, BlipLoop] | undefined = waiting.length ? [w("a4.w"), "pointd-s"]
    : running.length ? [w("a4.r"), "carry-s"]
    : tasks.some((t) => t.state === "done") ? [w("a4.d"), "thumbs-s"] : undefined;
  const group = (title: string, rows: Node[]): Node[] => rows.length
    ? [stack([
        pose?.[0] === title
          ? row([text(title, "d-h2"), blip(pose[1], 0.55)], { align: "center", justify: "between", marginBottom: 8 })
          : text(title, "d-h2", { marginBottom: 8 }),
        ...rows,
      ], { marginBottom: 40 })]
    : [];
  return screen("desk_tasks", w("a4.h"), [page([
    text(w("a4.h"), "d-eyebrow"),
    text(w("tasks.h"), "d-h1", { marginTop: 6, marginBottom: 26 }),
    ...group(w("a4.w"), waiting.map((t) => item(
      t,
      [named(t), text(t.approval!.preview, "d-written")],
      row([link(w("a3.ok"), answer(t, "approve"), "d-btn"), link(w("a3.later"), answer(t, "deny"))], { gap: 14, align: "center" }),
    ))),
    ...group(w("a4.r"), running.map((t) => item(t, lastStep(t) ? [text(lastStep(t), "d-margin")] : []))),
    ...group(w("a4.d"), done.map((t) => item(t, lastStep(t) ? [text(t.state === "done" ? `${w("a3.done")} ${lastStep(t)}` : lastStep(t), "d-margin")] : []))),
    tasks.length ? text(w("a4.end"), "d-margin") : emptyState("think-s", w("tasks.empty")),
  ], { maxWidth: 820 })]);
}

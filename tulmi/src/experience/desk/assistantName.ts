/**
 * What the person calls the assistant.
 */

import type { ScreenResponse, ActionRef, Node } from "../../../../shared/types/sdui.js";
import { nicknameOf } from "../assistantName.js";
import type { DeskContext } from "./context.js";
import { screen, page, text, row, link } from "./kit.js";

/**
 * ITS NAME, on the desk. Tailzu always answers; a name of their own beside it
 * is saved to personality.assistantName, which the writer and the recognizer
 * both read (experience/assistantName). One field, Save, and "Tailzu only".
 */
export function deskAssistantName(ctx: DeskContext): ScreenResponse {
  const nick = nicknameOf(ctx.personality);
  const put = (assistantName: string): ActionRef => ({
    kind: "callEndpoint", method: "PUT", path: "/v1/personality",
    body: { assistantName },
    onSuccess: { kind: "sequence", actions: [{ kind: "toast", message: "Saved." }, { kind: "refresh" }] },
    onError: { kind: "toast", message: "A name is letters, spaces, ' and -, up to 24 characters." },
  } as ActionRef);
  return screen("desk_assistant_name", "Its name", [page([
    text("Its name", "d-eyebrow"),
    text(nick ? `X0, or ${nick}` : "X0", "d-h1", { marginTop: 6 }),
    text("X0 is its name, and always works. Give it a name of your own too, and call it either while you talk: \u201cZara, make it formal.\u201d",
      "d-lede", { marginTop: 10, maxWidth: "52ch" }),
    row([
      { type: "TextField", props: { cls: "d-input", placeholder: "A name of your own", maxLength: 24 }, bind: { value: "nick" }, on: { onSubmit: put("$state.nick") } } as Node,
      link("Save", put("$state.nick"), "d-btn"),
    ], { gap: 12, align: "center", marginTop: 26, maxWidth: 520 }),
    ...(nick ? [row([link("X0 only", put(""))], { marginTop: 14 })] : []),
    row([link("Back to Settings", { kind: "navigate", screenId: "desk_settings" })], { marginTop: 28 }, "d-tools"),
  ], { maxWidth: 820 })], { nick: nick ?? "" });
}

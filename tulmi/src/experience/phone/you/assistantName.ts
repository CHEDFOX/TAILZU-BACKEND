/**
 * What the person calls the assistant.
 */

import { type ScreenResponse, type Node, type ActionSpec, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { nicknameOf } from "../../assistantName.js";
import { PHONE_LOOK } from "../../phoneLook.js";
import type { ScreenContext } from "../../screens.js";
import { YOU_UI, youHead } from "./copy.js";

/**
 * ITS NAME. Tailzu is the keyboard's name for everyone and always answers.
 * Beside it a person can give it a name of their own and call it either while
 * they talk ("Zara, make it formal"): saved to personality.assistantName,
 * which the writer and the recognizer both read (experience/assistantName).
 * One field and Save; "Tailzu only" clears it.
 */
export function assistantNameScreen(ctx: ScreenContext): ScreenResponse {
  const nick = nicknameOf(ctx.personality);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });
  const put = (body: Record<string, unknown>): ActionSpec => ({ kind: "sequence", actions: [
    { kind: "haptic", style: "selection" },
    { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body, onSuccess: "saved", onError: "err" },
  ] });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "assistant_name",
    title: "",
    state: { name: nick ?? "" },
    actions: {
      save: put({ assistantName: "$state.name" }),
      ...(nick ? { clear: put({ assistantName: "" }) } : {}),
      saved: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "toast", message: "Saved.", tone: "success" },
        { kind: "refresh" },
      ] },
      err: { kind: "toast", message: "A name is letters, spaces, ' and -, up to 24 characters.", tone: "error" },
    },
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        youHead("Its name", nick ? `X0, or ${nick}` : "X0"),
        {
          type: "Screen",
          style: { backgroundColor: "transparent", paddingHorizontal: PHONE_LOOK.side, paddingTop: 8, paddingBottom: 40 },
          children: [
            { type: "Text", props: { content: "X0 is its name, and always works. Give it a name of your own too, and call it either while you talk: \u201cZara, make it formal.\u201d" },
              style: { fontSize: 15, lineHeight: 23, color: PHONE_LOOK.ink2 } },
            gap(20),
            { type: "TextField", bind: { value: "name" }, props: { placeholder: "A name of your own", maxLength: 24, autoCapitalize: "words" } },
            gap(16),
            { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
            ...(nick ? [gap(10), { type: "Button", props: { label: "X0 only", variant: "secondary" }, on: { onPress: "clear" } } as Node] : []),
          ],
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

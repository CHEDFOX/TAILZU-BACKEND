/**
 * One connected app: what it may do, tool by tool.
 */

import type { ConnectorTool } from "../../../../shared/types/api.js";
import type { Node, ActionRef, ScreenResponse } from "../../../../shared/types/sdui.js";
import { en as w } from "../../connectors/words.js";
import { bound, unverified } from "./connectedApps.js";
import type { DeskContext } from "./context.js";
import { row, link, failToast, stack, text, screen, page } from "./kit.js";

const POLICY_WORD = { allow: "pol.allow", ask: "pol.ask", off: "pol.off" } as const;

/** One tool: its name and words from state, then its choices of Allow / Ask first / Off. */
function toolRow(id: string, t: ConnectorTool, i: number): Node {
  const seg = row((t.choices ?? [t.policy]).map((p) => p === t.policy
    ? ({ type: "Button", props: { label: w(POLICY_WORD[p]), cls: "d-seg-item d-seg-on" } } as Node)
    : link(w(POLICY_WORD[p]), {
        kind: "callEndpoint", method: "POST", path: `/v1/connectors/${id}/tools/policy`, body: { tool: t.name, policy: p },
        onError: failToast("err.level"),
      } as ActionRef, "d-seg-item")), { alignSelf: "flex-start", flex: "none" }, "d-seg");
  return row([
    stack([
      row([bound(`tools.${i}.label`, "d-v"), ...(t.changed ? [text(w("changed.tag"), "d-margin-strong")] : [])], { gap: 10, align: "center" }),
      bound(`tools.${i}.description`, "d-margin"),
    ], { flex: 1, minWidth: 0, gap: 3 }),
    seg,
  ], { align: "center", gap: 28, paddingTop: 16, paddingBottom: 16, flexWrap: "wrap" }, "d-entry");
}

/**
 * AN APP ADDED BY LINK, ITS OWN PAGE: what it can do, tool by tool, each
 * Allow / Ask first / Off (a delete or a payment only Ask first or Off), and,
 * when its server changed its tools since the person last looked, "This app
 * changed. Have a look." with Looks right. The tools are the app's own words:
 * from state, never translated.
 */
export function deskConnector(ctx: DeskContext): ScreenResponse {
  const app = ctx.assistant?.custom ? ctx.assistant.app : undefined;
  const back = row([link(w("tools.back"), { kind: "navigate", screenId: "desk_settings" })], { marginTop: 28 }, "d-tools");
  if (!app) {
    return screen("desk_connector", w("tools.h"), [page([
      text(w("tools.h"), "d-eyebrow"),
      text(w("apps.off"), "d-lede", { marginTop: 8 }),
      back,
    ], { maxWidth: 820 })]);
  }
  const a = app.info;
  const tools = app.tools ?? [];
  const body: Node[] = [
    text(w("tools.h"), "d-eyebrow"),
    bound(`n.${a.id}`, "d-h1", { marginTop: 6 }),
    row([unverified(`host.${a.id}`)], { marginTop: 8 }),
    text(w("tools.p"), "d-lede", { marginTop: 10, marginBottom: 18, maxWidth: "52ch" }),
  ];
  if (!a.connected) body.push(text(w("st.no"), "d-lede"));
  else if (!app.tools) body.push(text(w("tools.err"), "d-lede"));
  else {
    if (a.toolsChanged) {
      body.push(stack([
        text(w("changed.h"), "d-h2"),
        text(w("changed.p"), "d-lede", { marginTop: 4 }),
        row([link(w("changed.ok"), {
          kind: "callEndpoint", method: "POST", path: `/v1/connectors/${a.id}/tools/accept`,
          body: app.version ? { version: app.version } : {}, onError: failToast("err.generic"),
        } as ActionRef, "d-btn")], { marginTop: 12 }),
      ], { padding: 20, marginBottom: 18, border: "1px solid var(--d-rule)", radius: 12 }));
    }
    if (!tools.length) body.push(text(w("tools.none"), "d-lede"));
    body.push(...tools.map((t, i) => toolRow(a.id, t, i)));
    if (tools.some((t) => t.risk === "destructive" || t.risk === "pay")) body.push(text(w("tools.always"), "d-margin", { marginTop: 14 }));
  }
  body.push(back);
  return screen("desk_connector", w("tools.h"), [page(body, { maxWidth: 820 })], {
    n: { [a.id]: a.name }, host: { [a.id]: a.host ?? "" },
    tools: tools.map((t) => ({ label: t.title || t.name, description: t.description })),
  });
}

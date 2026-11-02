/**
 * The connected apps in Settings: each one's row, the custom ones, and adding more.
 */

import type { ConnectorInfo } from "../../../../shared/types/api.js";
import type { Node, ActionRef } from "../../../../shared/types/sdui.js";
import type { AssistantView } from "../../connectors/list.js";
import { en as w } from "../../connectors/words.js";
import { appIconNode } from "../appIcons.js";
import { neonDot } from "../touches.js";
import { text, row, link, failToast, defRow, stack, type Style } from "./kit.js";

// ---- CONNECTED APPS and TASKS ---------------------------------------------------------
//
// The assistant's side of the desk, built here and only drawn by the window:
// the words are connectors/words.ts (the approved design's, in English; the
// translator has the design's Hinglish for them), the rows are the plain nodes
// above, and every button is an action the window already has (callEndpoint to
// the routes in routes/connectors/connectors.ts) plus "connector.connect", which opens the
// sign-in page that route answers with. Nothing here is decided on the device.
const LEVELS = ["look", "draft", "send"] as const;

/** One app: its state, how far the assistant may go in it, and the way out. */
function appRow(c: ConnectorInfo): Node {
  const again = c.connected && c.needsSignIn === true;
  const on = c.connected && !again;
  const detail: Node[] = [text(c.oneLine, "d-v")];
  // What Tailzu does with the app, said before its sign-in page opens.
  if (!c.connected && c.auth === "oauth") detail.push(text(w("a2.ai", { app: c.name }), "d-margin", { marginTop: 4 }));
  // An app that takes a pasted link (Zapier) asks for it before the button.
  if (c.auth === "url" && !on) {
    detail.push({
      type: "TextField", props: { cls: "d-input", placeholder: w("link.ph", { app: c.name }) },
      bind: { value: `link.${c.id}` }, style: { marginTop: 6, maxWidth: 420 },
    } as Node);
  }
  if (c.connected) {
    const level = LEVELS.includes(c.level) ? c.level : "look";
    detail.push(
      text(w("a2.q", { app: c.name }), "d-margin", { marginTop: 10 }),
      row(LEVELS.map((l) => l === level
        ? ({ type: "Button", props: { label: w(`lv.${l}`), cls: "d-seg-item d-seg-on" } } as Node)
        : link(w(`lv.${l}`), {
            kind: "callEndpoint", method: "POST", path: `/v1/connectors/${c.id}/level`, body: { level: l },
            onError: failToast("err.level"),
          } as ActionRef, "d-seg-item")), { alignSelf: "flex-start" }, "d-seg"),
      text(w(`lv.${level}.d`), "d-lede", { marginTop: 2 }),
      text(w("a2.foot"), "d-margin", { marginTop: 6 }),
      row([link(w("a2.dis", { app: c.name }), {
        kind: "callEndpoint", method: "DELETE", path: `/v1/connectors/${c.id}`, onError: failToast("err.generic"),
      } as ActionRef)], { marginTop: 4 }),
    );
  }
  const state = on ? w("st.ok") : again ? w("st.re") : w("st.no");
  // CONNECTED is a state that is on: it wears the onboarding's neon dot, and
  // nothing else here does.
  const right = on
    ? row([neonDot(), text(state, "d-margin")], { gap: 8, align: "center" })
    : row([
        text(state, "d-margin"),
        link(w("connect"), {
          kind: "connector.connect", id: c.id, ...(c.auth === "url" ? { urlPath: `link.${c.id}` } : {}),
          onError: failToast("err.connect"),
        } as ActionRef, "d-btn"),
      ], { gap: 14, align: "center" });
  // Its company's logo beside its name, when it has one (appIcons.ts); else the name alone, as before.
  const logo = appIconNode(c.id, 32, c.custom);
  const name: string | Node = logo
    ? row([logo, text(c.name, "d-k", { flex: 1, minWidth: 0 })], { width: 220, flex: "none", gap: 12, align: "center" })
    : c.name;
  return defRow(name, stack(detail, { gap: 2, flex: 1, minWidth: 0 }), right);
}

/**
 * Settings > Connected apps: every app switched on, with its state, its level
 * and its button; then, while apps can be added by link, the ones this person
 * added, Add an app by link, and More apps.
 */
export function connectedApps(view: AssistantView): Node {
  const apps = view.apps ?? [];
  return stack([
    text(w("apps.h"), "d-h2", { marginBottom: 4 }),
    text(w("apps.p"), "d-lede", { marginBottom: 8 }),
    ...apps.map((c) => (c.custom ? customRow(c) : appRow(c))),
    ...(view.custom ? [addByLink(), moreApps()] : []),
  ], { marginBottom: 40 });
}

// ---- APPS ADDED BY LINK (only while CUSTOM_CONNECTORS is on) ----------------------------
//
// An app a person added is nobody's we checked, so its row says Unverified and
// its host, and has no level: what it may do is set tool by tool on its own
// page (desk_connector). Its name and host are the person's own text and stay
// in the page's state, drawn from there, so the translator never sees them.
// Before Connect, the row says where they'll sign in; the route refuses a
// sign-in that has moved since, and the page redrawn says the new place.
//
// Every write repaints the page from the server (the window does that after
// any POST or DELETE), so a new app simply appears in the list above, and the
// add form and the search start empty again. A search is a GET, which the
// window keeps in state and draws into twenty rows already on the page.

const DIR_SLOTS = 20;
/** Text drawn from the page's state: the person's or an app's words, never ours to translate. */
export const bound = (path: string, cls: string, style?: Style): Node => ({ ...text("", cls, style), bind: { content: path } });
const field = (path: string, placeholder: string, extra: Partial<Node> = {}): Node =>
  ({ type: "TextField", props: { cls: "d-input", placeholder }, bind: { value: path }, style: { maxWidth: 420 }, ...extra } as Node);

/** "Unverified · host", the host from state. */
export const unverified = (hostPath: string): Node =>
  row([text(w("custom.tag"), "d-margin-strong"), text("·", "d-margin"), bound(hostPath, "d-margin")], { gap: 6, align: "center", flexWrap: "wrap" });

/** One app the person added: where it signs in, what it can do, and Remove. */
function customRow(c: ConnectorInfo): Node {
  const again = c.connected && c.needsSignIn === true;
  const on = c.connected && !again;
  const page: ActionRef = { kind: "navigate", screenId: "desk_connector", params: { id: c.id } };
  const remove = link(w("custom.remove"), {
    kind: "callEndpoint", method: "DELETE", path: `/v1/connectors/custom/${c.id}`, onError: failToast("err.generic"),
  } as ActionRef);
  const detail: Node[] = [unverified(`host.${c.id}`), text(w("custom.note"), "d-lede", { marginTop: 2 })];
  if (!on && c.signInHost) {
    detail.push(row([text(w("add.at"), "d-margin"), bound(`si.${c.id}`, "d-margin-strong")], { gap: 6, align: "center", marginTop: 6 }));
  }
  if (on && c.toolsChanged) {
    detail.push(row([text(w("changed.h"), "d-v"), link(w("changed.look"), page)], { gap: 14, align: "center", marginTop: 8, flexWrap: "wrap" }));
  }
  detail.push(row(on ? [link(w("tools.h"), page), remove] : [remove], { gap: 18, marginTop: 6 }));
  const right = on
    ? text(w("st.ok"), "d-margin")
    : row([
        text(again ? w("st.re") : w("st.no"), "d-margin"),
        link(w("connect"), {
          kind: "connector.connect", id: c.id,
          // A refusal (a sign-in that moved) is shown by the page drawn again.
          onError: { kind: "sequence", actions: [failToast("err.connect"), { kind: "refresh" }] },
        } as ActionRef, "d-btn"),
      ], { gap: 14, align: "center" });
  return row([
    bound(`n.${c.id}`, "d-k", { width: 220, flex: "none" }),
    stack(detail, { gap: 2, flex: 1, minWidth: 0 }),
    right,
  ], { align: "center", gap: 28, paddingTop: 20, paddingBottom: 20, flexWrap: "wrap" }, "d-entry");
}

/**
 * What an add answered. A no comes back 200 with the server's reason in
 * `refused` (routes/connectors/connectorsCustom.ts), since a failed call's onError has
 * nothing from the answer to say: that reason is the toast. failToast("err.add")
 * is left for an answer with no reason in it (no connection, a server error).
 */
const afterAdd: ActionRef = {
  kind: "condition", if: { truthy: "added.refused" },
  then: { kind: "toast", message: "$state.added.refused.message" },
  else: { kind: "toast", message: w("add.done") },
} as ActionRef;

/** Add an app by link: folded until asked for, then Name, Link, a folded Advanced, the trust line and Add app. */
function addByLink(): Node {
  const add: ActionRef = {
    kind: "callEndpoint", method: "POST", path: "/v1/connectors/custom",
    body: { name: "$state.add.name", url: "$state.add.url", clientId: "$state.add.clientId", clientSecret: "$state.add.clientSecret" },
    assignTo: "added", onSuccess: afterAdd, onError: failToast("err.add"),
  } as ActionRef;
  return stack([
    row([text(w("add.h"), "d-v"), link(w("add.tile"), { kind: "toggleState", path: "addOpen" } as ActionRef, "d-btn")],
      { justify: "between", align: "center", gap: 14, flexWrap: "wrap" }),
    stack([
      text(w("add.p"), "d-lede"),
      text(w("add.name"), "d-margin", { marginTop: 12 }),
      field("add.name", w("add.name.ph")),
      text(w("add.link"), "d-margin", { marginTop: 10 }),
      field("add.url", w("add.link.ph")),
      row([link(w("add.adv"), { kind: "toggleState", path: "add.adv" } as ActionRef)], { marginTop: 12 }),
      stack([
        text(w("add.adv.d"), "d-margin"),
        field("add.clientId", w("add.cid")),
        field("add.clientSecret", w("add.csec")),
      ], { gap: 6, marginTop: 6 }, undefined, { visibleIf: { truthy: "add.adv" } }),
      text(w("add.trust"), "d-lede", { marginTop: 14 }),
      row([link(w("add.go"), add, "d-btn")], { marginTop: 12 }),
    ], { gap: 4, marginTop: 8, maxWidth: 520 }, undefined, { visibleIf: { truthy: "addOpen" } }),
  ], { paddingTop: 20, paddingBottom: 20 }, "d-entry");
}

/** More apps: search ours and the MCP Registry; the answer fills the rows below. */
function moreApps(): Node {
  const search: ActionRef = {
    kind: "callEndpoint", method: "GET", path: "/v1/connectors/directory?q=$state.q", assignTo: "dir", onError: failToast("dir.err"),
  } as ActionRef;
  const slot = (i: number): Node => {
    const at = `dir.apps.${i}`;
    const addIt: ActionRef = {
      kind: "callEndpoint", method: "POST", path: "/v1/connectors/custom",
      body: { name: `$state.${at}.name`, url: `$state.${at}.url`, from: `$state.${at}.id` },
      assignTo: "added", onSuccess: afterAdd, onError: failToast("err.add"),
    } as ActionRef;
    return row([
      stack([
        bound(`${at}.name`, "d-v"),
        { ...unverified(`${at}.host`), visibleIf: { truthy: `${at}.unverified` } },
        { ...text(w("dir.ours"), "d-margin-strong"), visibleIf: { eq: [`${at}.source`, "catalog"] } },
        bound(`${at}.description`, "d-margin"),
      ], { flex: 1, minWidth: 0, gap: 3 }),
      { ...link(w("dir.add"), addIt, "d-btn"), visibleIf: { truthy: `${at}.unverified` } },
      { ...text(w("dir.ours.d"), "d-margin"), visibleIf: { eq: [`${at}.source`, "catalog"] } },
    ], { align: "center", gap: 24, paddingTop: 14, paddingBottom: 14, flexWrap: "wrap" }, "d-entry", { visibleIf: { truthy: `${at}.id` } });
  };
  return stack([
    text(w("s6.more"), "d-v"),
    text(w("dir.p"), "d-lede", { marginTop: 2 }),
    row([
      field("q", w("dir.ph"), { on: { onSubmit: search } }),
      link(w("dir.go"), search, "d-btn"),
    ], { gap: 12, align: "center", marginTop: 12, marginBottom: 6 }),
    ...Array.from({ length: DIR_SLOTS }, (_, i) => slot(i)),
    { ...text(w("dir.none"), "d-margin", { marginTop: 8 }), visibleIf: { eq: ["dir.count", 0] } },
  ], { paddingTop: 20 });
}

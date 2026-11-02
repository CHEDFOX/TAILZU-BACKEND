/**
 * The desk's building blocks: its type scale and the plain nodes every page is composed of.
 */

import { type Node, type ActionRef, type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { en as w } from "../../connectors/words.js";
import type { BlipLoop } from "../blipLoops.js";
import { blipPicture } from "../touches.js";

// ---- nodes ---------------------------------------------------------------------
export type Style = Record<string, unknown>;

/**
 * THE DESK'S TYPE AND AIR — lighter than the first release, set from here.
 *
 * app.html's classes carry the sizes the 0.2 installer shipped with, and they
 * read bulky: 40pt titles, 19pt notes, tight pages. Every node below passes
 * through this table, and an inline style wins over a class, so the pages are
 * refined from the server with no installer: one step smaller everywhere,
 * wider margins, more room between sections. Explicit styles on a node still
 * win over the table.
 */
const DESK_TYPE: Record<string, Style> = {
  "d-h1": { fontSize: 30, lineHeight: "36px" },
  "d-h2": { fontSize: 19, lineHeight: "25px" },
  "d-statement": { fontSize: 26, lineHeight: "35px", maxWidth: "32ch" },
  "d-lede": { fontSize: 13, lineHeight: "21px" },
  "d-eyebrow": { fontSize: 10 },
  "d-count": { fontSize: 10.5 },
  "d-said": { fontSize: 16, lineHeight: "22px" },
  "d-written": { fontSize: 16.5, lineHeight: "25px" },
  "d-margin": { fontSize: 10, lineHeight: "16px" },
  "d-margin-strong": { fontSize: 10, lineHeight: "16px" },
  "d-link": { fontSize: 10.5 },
  "d-btn": { fontSize: 10.5, paddingTop: 9, paddingBottom: 9, paddingLeft: 15, paddingRight: 15 },
  "d-price": { fontSize: 26, lineHeight: "30px" },
  "d-k": { fontSize: 13, lineHeight: "19px" },
  "d-v": { fontSize: 15, lineHeight: "22px" },
  "d-num": { fontSize: 11 },
  "d-lane-label": { fontSize: 10 },
  "d-input": { fontSize: 16 },
  "d-seg-item": { fontSize: 10 },
  "d-world-text": { fontSize: 16, lineHeight: "23px" },
  "d-world-name": { fontSize: 9.5 },
  "d-world-use": { fontSize: 9.5 },
  "d-world": { minHeight: 170, paddingTop: 18, paddingBottom: 18, paddingLeft: 18, paddingRight: 18 },
  // The page and the room: wider margins, a narrower column, more air.
  "d-page": { maxWidth: 920, paddingTop: 52, paddingLeft: 56, paddingRight: 56, paddingBottom: 96 },
  "d-room-inner": { maxWidth: 920, paddingTop: 40, paddingLeft: 56, paddingRight: 56, paddingBottom: 34 },
};
export const typeFor = (cls?: string): Style =>
  Object.assign({}, ...String(cls ?? "").split(/\s+/).map((c) => DESK_TYPE[c] ?? {}));
const styled = (cls: string | undefined, style?: Style): Style | undefined => {
  const merged = { ...typeFor(cls), ...(style ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
};

export const text = (content: string, cls: string, style?: Style): Node => {
  const st = styled(cls, style);
  return { type: "Text", props: { content, cls }, ...(st ? { style: st } : {}) };
};
export const stack = (children: Node[], style: Style = {}, cls?: string, extra: Partial<Node> = {}): Node =>
  ({ type: "Stack", props: cls ? { cls } : {}, style: { ...typeFor(cls), ...style }, children, ...extra });
export const row = (children: Node[], style: Style = {}, cls?: string, extra: Partial<Node> = {}): Node =>
  stack(children, { direction: "row", ...style }, cls, extra);
export const inline = (children: Node[], cls: string, style: Style = {}): Node => stack(children, { display: "block", ...style }, cls);
export const link = (label: string, onPress: ActionRef, cls = "d-link", style?: Style): Node => {
  const st = styled(cls, style);
  return { type: "Button", props: { label, cls }, on: { onPress }, ...(st ? { style: st } : {}) };
};

export const keys = (source: "tap" | "hotkey" | "notes", small = false): Node => ({ type: "Keys", props: { source, cls: small ? "d-keys-small" : "" }, ...(small ? { style: {} } : {}) });

export const page = (children: Node[], style: Style = {}): Node => stack(children, { gap: 0, ...style }, "d-page");

export function screen(screenId: string, title: string, children: Node[], state: Record<string, unknown> = {}): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId,
    title,
    look: "desk",
    root: { type: "Screen", props: { layout: "full" }, children },
    state,
    cacheTtlSeconds: 0,
  };
}

export const n = (v: number) => Math.round(v).toLocaleString("en-US");

/**
 * Blip, for an empty state: his loop in a box exactly his size. The Image node
 * centres itself with auto margins, which in a row would push him away from the
 * line beside him; in a box of his own width there is nothing to centre in.
 */
export const blip = (loop: BlipLoop, scale = 0.8): Node => {
  const pic = blipPicture(loop, scale);
  return stack([pic], { width: (pic.style as Style).width, flexShrink: 0 });
};
/** An empty state: Blip, and one warm line beside him. */
export const emptyState = (loop: BlipLoop, line: string, rest: Node[] = []): Node =>
  row([
    blip(loop),
    stack([text(line, "d-written", { fontSize: 19, lineHeight: "27px", maxWidth: "34ch" }), ...rest], { flex: 1, minWidth: 0 }),
  ], { align: "center", gap: 22, paddingBottom: 26 });

/** A section of a desk page: a heading in the written face, a line of what it
 *  shows, then the chart. */
export function section(title: string, caption: string | undefined, body: Node[], style: Style = {}): Node {
  return stack([
    text(title, "d-h2"),
    ...(caption ? [text(caption, "d-lede", { marginTop: 6 })] : []),
    ...body,
  ], { flex: 1, minWidth: 0, ...style });
}
/** Two sections side by side where the window is wide, stacked where not. */
export const twoUp = (a: Node | null, b: Node | null, style: Style = {}): Node[] => {
  const cols = [a, b].filter((x): x is Node => !!x);
  return cols.length ? [row(cols, { gap: 64, marginTop: 52, align: "start", flexWrap: "wrap", ...style }, "d-wrap-narrow")] : [];
};

/**
 * THE ROOM — the band under the tabs. It was a violet gradient, the one colour
 * on the desk that belonged to nothing else in it. It is the brand's own now:
 * a warm espresso ink, lit from the top right by the amber the product uses
 * for whatever is live, with a breath of the typed rose low on the left. The
 * room's cream type (.d-on-room) reads on it unchanged. Inline, so it wins over
 * app.html's .d-room on every installed build.
 */
export const ROOM: Style = {
  background: "#17120E",
  backgroundImage: "radial-gradient(70% 160% at 94% -30%, rgba(232,162,60,.34), rgba(232,162,60,0) 62%), radial-gradient(50% 130% at -6% 135%, rgba(214,69,110,.12), rgba(214,69,110,0) 60%), linear-gradient(180deg, #221A13 0%, #14100C 100%)",
  color: "#F3E2C6",
  borderBottom: "1px solid rgba(243,226,198,.08)",
};
export const room = (inner: Node[], style: Style = {}): Node =>
  stack([row(inner, { justify: "between", align: "end", gap: 24, flexWrap: "wrap", ...style }, "d-room-inner")], ROOM, "d-room");

// ---- SETTINGS and PLAN ----------------------------------------------------------------

/** A node shown only while `c` holds (the window's state). */
export const shownIf = (n: Node, c: NonNullable<Node["visibleIf"]>): Node => ({ ...n, visibleIf: c });
export const defRow = (k: string | Node, v: Node | string, right?: Node): Node => row([
  typeof k === "string" ? text(k, "d-k", { width: 220, flex: "none" }) : k,
  typeof v === "string" ? text(v, "d-v", { flex: 1, minWidth: 0 }) : stack([v], { flex: 1, minWidth: 0 }),
  ...(right ? [right] : []),
], { align: "center", gap: 28, paddingTop: 20, paddingBottom: 20, flexWrap: "wrap" }, "d-entry");

export const failToast = (key: "err.level" | "err.connect" | "err.generic" | "err.add" | "dir.err"): ActionRef => ({ kind: "toast", message: w(key) });

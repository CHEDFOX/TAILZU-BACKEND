/**
 * THE KIT'S RULES, AS A CHECK: what keeps a Bots app screen drawing the same on the phone and in the window.
 *
 *   expect(lintTree(screen.root!)).toEqual([]);   // in every screen's test
 *
 * It finds: a node type outside the kit's set (the core types both clients draw), text not set in a Geist face
 * or with a weight of its own or no line height, a border width with no colour, an image without a { url } source,
 * and a pressable inside a pressable (the window would run both).
 */
import type { Node } from "../../../../shared/types/sdui.js";
import { FACE } from "./kit.js";

/** Every node of a tree, depth first. */
export function walk(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
}

/** The node types the kit uses: core types both clients draw (desktop/sdui.js COMPONENTS, the phone's REGISTRY). */
export const KIT_TYPES: ReadonlySet<string> = new Set(["Stack", "Text", "SVG", "Image", "Grid", "Screen", "SafeArea", "TextField"]);

export function lintTree(root: Node): string[] {
  const bad: string[] = [];
  const faces = new Set<string>(Object.values(FACE));
  const visit = (n: Node, pressed: boolean) => {
    if (!KIT_TYPES.has(n.type)) bad.push(`type ${n.type}`);
    const st = (n.style ?? {}) as Record<string, unknown>;
    if (n.type === "Text") {
      const what = `text "${String(n.props?.content ?? "").slice(0, 30)}"`;
      if (!faces.has(String(st.fontFamily))) bad.push(`${what} has no Geist face`);
      if (st.fontWeight !== "normal") bad.push(`${what} sets a weight`);
      if (typeof st.lineHeight !== "number") bad.push(`${what} has no line height`);
    }
    for (const k of Object.keys(st)) {
      const m = /^border(Top|Right|Bottom|Left)?Width$/.exec(k);
      if (m && Number(st[k]) > 0 && !st[`border${m[1] ?? ""}Color`] && !st.borderColor) bad.push(`${n.type} has ${k} without a colour`);
    }
    if (n.type === "Image" && !(n.props?.source as { url?: string } | undefined)?.url) bad.push("an image without a { url } source");
    const press = !!n.on?.onPress;
    if (press && pressed) bad.push(`a pressable inside a pressable (${n.type})`);
    for (const c of n.children ?? []) visit(c, pressed || press);
  };
  visit(root, false);
  return bad;
}

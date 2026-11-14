/**
 * THE KIT'S RULES, AS A CHECK: what keeps a Bots app screen drawing the same on the phone and in the window.
 *
 *   expect(lintTree(screen.root!)).toEqual([]);   // in every screen's test
 *
 * It finds: a node type outside the kit's set (the core types both clients draw), text not set in one of the kit's faces (Geist,
 * or Bricolage for a space's messages) or with a weight of its own or no line height, a border width with no colour, an image without a { url } source,
 * and a pressable inside a pressable (the window would run both; a BotStage's own press is on the bot, so its thought may hold buttons).
 */
import { BLOCK_NODES, type Node } from "../../../../shared/types/sdui.js";
import { BRICOLAGE, FACE } from "./kit.js";

/** Every node of a tree, depth first. */
export function walk(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
}

/** The node types the kit uses: core types both clients draw (desktop src/app/sdui/core.js COMPONENTS, the phone's REGISTRY), and the
 *  living tiles' two (BotTiles, BotCard), which the kit sends only to a build that declares BotsMotion, and BotBuddy and Home's live header (WriteOn, LiveMark, HeadBar) with it,
 *  and Home's welcome (Rise: Home coming in; BlipWalkOut: Blip walking off, or MorphOut sliding him off where a build lacks it), with it too,
 *  and the new Spaces' and Home's Ask blocks (BotStage, BotCrowd, Vanish, MentionField, LiveWords: sdui 3i), sent only to a build that
 *  declares them (kit canSpaces2, canHomeThought, canVoice), and a person's own tiny bot (PersonBot: sdui 3j, kit canPersonBot). */
const KIT_TYPES: ReadonlySet<string> = new Set([
  "Stack", "Text", "SVG", "Image", "Grid", "Screen", "SafeArea", "TextField", "Scroll", "BotTiles", "BotCard", "BotBuddy", "WriteOn", "LiveMark",
  "HeadBar", "LiveView", "Rise", "MorphOut", "BlipWalkOut", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "PersonBot",
]);

/**
 * The vocabulary-2 nodes, and the block each one needs (shared/types/sdui.ts BLOCK_NODES, which mirrors the phone's
 * v3Spec). They are NOT in KIT_TYPES: one is drawn only by a screen that states it needs that block, and only for a
 * client that declared it (pure/SPEC.md 2.0 principle 2). A screen that sends one without saying so is refused here,
 * because the clients that have no blocks — every one of them today — would draw nothing in its place.
 */
const BLOCK_OF_TYPE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(BLOCK_NODES).flatMap(([block, types]) => types.map((t) => [t, block]))),
);

/** A BotStage's press is on the bot (his hit area), never on the thought it holds: a button in the box is not inside a pressable. */
const PRESS_ON_ITSELF: ReadonlySet<string> = new Set(["BotStage"]);

export interface LintOpts {
  /** The screen's `needs` (ScreenResponse.needs). A block named here lets its own node types through. */
  needs?: readonly string[];
}

export function lintTree(root: Node, opts: LintOpts = {}): string[] {
  const bad: string[] = [];
  const faces = new Set<string>([...Object.values(FACE), ...Object.values(BRICOLAGE)]);
  const needs = new Set(opts.needs ?? []);
  const visit = (n: Node, pressed: boolean) => {
    const block = BLOCK_OF_TYPE[n.type];
    if (block) { if (!needs.has(block)) bad.push(`type ${n.type} needs the ${block} block in the screen's needs`); }
    else if (!KIT_TYPES.has(n.type)) bad.push(`type ${n.type}`);
    const st = (n.style ?? {}) as Record<string, unknown>;
    if (n.type === "Text") {
      const what = `text "${String(n.props?.content ?? "").slice(0, 30)}"`;
      if (!faces.has(String(st.fontFamily))) bad.push(`${what} has no kit face`);
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
    const inside = pressed || (press && !PRESS_ON_ITSELF.has(n.type));
    for (const c of n.children ?? []) visit(c, inside);
    // A row template and a Use's slots are drawn like any other node, so they are held to the same rules.
    const item = n.props?.item as Node | undefined;
    if (item && typeof item.type === "string") visit(item, inside);
    for (const s of Object.values(n.slots ?? {})) for (const c of Array.isArray(s) ? s : [s]) {
      if (c && typeof c.type === "string") visit(c, inside);
    }
  };
  visit(root, false);
  return bad;
}

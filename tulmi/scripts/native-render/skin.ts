/**
 * SEE A KEYBOARD SKIN BEFORE A PHONE HAS IT (native/SPEC.md section 5.4, §1.6).
 *
 *   cd tulmi && npx tsx scripts/native-render/render.ts --skin clay-dusk
 *
 * Draws the EXPANDED tree — the one the phone actually receives, from `buildKeyboardConfig` through `withKeySkin` — in both
 * appearances, plus a frame with one key held down. Nothing here invents a look: every colour comes from the expanded
 * `themeDark` / `themeLight`, every print from the key node's own `props.face`, and the pressed frame from `style.press`.
 * If the skin would print nothing on a key, this draws nothing on it either.
 *
 * HONESTY, the same as render.ts's: the browser is not UIKit and not an Android IME. Metrics differ by a point or two, and
 * the real press is a Core Animation / ValueAnimator curve rather than a CSS transform. Shapes, colour, which keys print
 * what, and where a print sits are the real rules.
 */
import type { KeyFace, KeyMark, KeyMarkShape, KeyPress } from "../../../shared/types/keyboardFace.js";
import type { KeyboardConfigResponse, KeyboardNode } from "../../../shared/types/sdui.js";
import { buildKeyboardConfig } from "../../src/experience/keyboard/config.js";
import { allSkins, withKeySkin } from "../../src/experience/keyboard/skin.js";
import { KEY_SKIN_1 } from "../../../shared/types/keyboardFace.js";
import { page } from "./ref.js";

type Theme = KeyboardConfigResponse["theme"];

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The faces the preview can name, mapped to something a browser has. A hooked font is drawn in the fallback, labelled. */
const FONT_OF: Record<string, string> = {
  sans: "-apple-system, system-ui, sans-serif",
  brand: "Georgia, 'Times New Roman', serif",
  display: "Georgia, serif",
  dots: "ui-monospace, monospace",
  mono: "ui-monospace, monospace",
};

/** The keys the keyboard draws, and roughly how wide each is in a row. The real widths come from the binary's own layout. */
const WIDE: Record<string, number> = { SpaceKey: 5, ShiftKey: 1.5, BackspaceKey: 1.5, ReturnKey: 2, GlobeKey: 1.2, MicKey: 1.2, RefineKey: 1.2 };

const KEY_H = 42;
const UNIT = 32;

function markSvg(mark: KeyMark, colour: string): string {
  const [x, y, w, h] = mark.viewBox;
  const shape = (s: KeyMarkShape): string => {
    const stroke = s.color ?? colour;
    const width = s.width ?? 1.5;
    const cap = s.cap ?? "round";
    switch (s.kind) {
      case "path": return `<path d="${esc(String(s.d ?? ""))}" fill="none" stroke="${esc(stroke)}" stroke-width="${width}" stroke-linecap="${esc(cap)}"/>`;
      case "rect": return `<rect x="${s.x ?? 0}" y="${s.y ?? 0}" width="${s.w ?? 0}" height="${s.h ?? 0}" fill="${esc(stroke)}"/>`;
      case "circle": return `<circle cx="${s.cx ?? 0}" cy="${s.cy ?? 0}" r="${s.r ?? 0}" fill="${esc(stroke)}"/>`;
      case "line": return `<line x1="${s.x1 ?? 0}" y1="${s.y1 ?? 0}" x2="${s.x2 ?? 0}" y2="${s.y2 ?? 0}" stroke="${esc(stroke)}" stroke-width="${width}" stroke-linecap="${esc(cap)}"/>`;
      case "bars": return (s.heights ?? []).map((bh, i) => `<rect x="${(s.x ?? 0) + i * ((s.w ?? 4) + 2)}" y="${(s.y ?? 0) - bh}" width="${s.w ?? 4}" height="${bh}" fill="${esc(stroke)}"/>`).join("");
      default: return "";
    }
  };
  return `<svg viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%">${mark.shapes.map(shape).join("")}</svg>`;
}

/** One key cap, with whatever its own node carries: a face behind or instead of the title, and the press state when held. */
function cap(node: KeyboardNode, theme: Theme, held: boolean): string {
  const face = (node.props as { face?: KeyFace } | undefined)?.face;
  const style = (node.style ?? {}) as { fontFamily?: string; press?: KeyPress };
  const press = style.press;
  const title = String((node.props as { char?: unknown } | undefined)?.char ?? "") || LABEL_OF[node.type] || "";
  const units = WIDE[node.type] ?? 1;
  const radius = theme.keyRadius ?? 6;
  const back = held ? theme.keyPressed : theme.key;
  const font = FONT_OF[String(face?.font ?? style.fontFamily ?? "sans")] ?? FONT_OF.sans;
  const ink = face?.color ?? theme.keyText;

  const bits: string[] = [];
  if (face?.mark) bits.push(`<div style="position:absolute;inset:${face.inset ?? 0}px;opacity:${face.opacity ?? 1}">${markSvg(face.mark, ink!)}</div>`);
  if (face?.art) bits.push(`<div style="position:absolute;inset:4px;border:1px dashed ${esc(String(theme.accent))};opacity:0.5"></div>`);
  // `instead` replaces the key's own title; `behind` (the default) leaves it and prints under it.
  if (face?.layer !== "instead" || !face?.label) bits.push(`<div style="position:relative;font:400 17px ${font};color:${esc(String(theme.keyText))}">${esc(face?.label ?? title)}</div>`);
  if (face?.sub) {
    const pos = face.subPos ?? "top-right";
    const [v, hz] = pos.split("-");
    bits.push(`<div style="position:absolute;${v}:3px;${hz}:4px;font:400 9px ${font};color:${esc(String(ink))};opacity:${face.opacity ?? 0.4}">${esc(face.sub)}</div>`);
  }
  if (face?.corner) bits.push(`<div style="position:absolute;bottom:3px;right:4px;font:400 10px ${font};color:${esc(String(ink))};opacity:${face.opacity ?? 0.4}">${esc(face.corner)}</div>`);

  // The pressed state as the skin asks for it: `pop` eases to (scale, dy) and HOLDS while the finger is down. The key's own
  // frame never moves — the paint does — which is why the transform sits on an inner layer.
  const lift = held && press?.kind === "pop" ? `transform:scale(${press.scale ?? 1.08}) translateY(${press.dy ?? 0}px);` : "";
  const glow = held && press?.kind === "glow" ? `box-shadow:0 0 10px 2px ${esc(String(press.color ?? theme.accent))};` : "";
  return `<div style="width:${units * UNIT}px;height:${KEY_H}px;flex:0 0 auto;position:relative;display:grid;place-items:center;border-radius:${radius}px;background:${esc(String(back))};${lift}${glow}${theme.keyShadow ? "box-shadow:0 1px 0 rgba(0,0,0,0.35);" : ""}">${bits.join("")}</div>`;
}

const LABEL_OF: Record<string, string> = {
  SpaceKey: "", ShiftKey: "⇧", BackspaceKey: "⌫", ReturnKey: "return", GlobeKey: "🌐", MicKey: "mic", RefineKey: "✨",
};

const KEY_TYPES = new Set(["LetterKey", "IconKey", "SpaceKey", "ShiftKey", "ReturnKey", "BackspaceKey", "GlobeKey", "MicKey", "RefineKey"]);

/** The expanded tree, drawn. Rows are laid out as rows; everything else is walked through. */
function plane(node: KeyboardNode | undefined, theme: Theme, heldChar: string | null): string {
  if (!node) return "";
  if (KEY_TYPES.has(node.type)) {
    const char = String((node.props as { char?: unknown } | undefined)?.char ?? "");
    return cap(node, theme, heldChar !== null && char === heldChar);
  }
  const inside = (node.children ?? []).map((k) => plane(k, theme, heldChar)).join("");
  if (node.type === "Row") return `<div style="display:flex;gap:5px;justify-content:center">${inside}</div>`;
  return `<div style="display:flex;flex-direction:column;gap:7px">${inside}</div>`;
}

/** One appearance of the expanded tree, in its own keyboard background. */
function board(root: KeyboardNode | undefined, theme: Theme, heldChar: string | null): string {
  return `<div style="width:360px;padding:8px 4px 10px;background:${esc(String(theme.background))};border-radius:10px">${plane(root, theme, heldChar)}</div>`;
}

/**
 * The whole sheet for one skin: the expanded tree in both appearances, and a frame with one key held down, so the press
 * effect is something you can look at rather than three numbers in a JSON file.
 */
export function skinSheet(id: string): string {
  const picked = allSkins().get(id);
  if (!picked) throw new Error(`native-render: no skin "${id}". This release has: ${[...allSkins().keys()].join(", ") || "none"}`);
  const base = buildKeyboardConfig();
  const out = withKeySkin(base, { can: new Set([KEY_SKIN_1]), skin: id });
  if (!out.skin) {
    throw new Error("native-render: the skin did not expand — KEYBOARD_SKINS must be on for the preview (KEYBOARD_SKINS=true), and KEYBOARD_SKINS_USERS empty.");
  }
  const dark = (out.themeDark ?? out.theme) as Theme;
  const light = (out.themeLight ?? out.theme) as Theme;
  const press = (picked.press?.kind ?? "fade") as string;
  return page(`${id} — keyboard skin`, [
    { label: `${id} · dark · the expanded tree`, html: board(out.root, dark, null), dark: true },
    { label: `${id} · light · the expanded tree`, html: board(out.root, light, null), dark: false },
    { label: `${id} · dark · "a" held down (${press})`, html: board(out.root, dark, "a"), dark: true },
    { label: `${id} · light · "a" held down (${press})`, html: board(out.root, light, "a"), dark: false },
  ]);
}

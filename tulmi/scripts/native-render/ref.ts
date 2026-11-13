/**
 * THE REFERENCE RENDERER: one nlook design, drawn as HTML and CSS, so a person can SEE a design before a phone ever has it
 * (native/SPEC.md section 5.4).
 *
 * It is a reference, not a second implementation of the truth. SwiftUI measures text differently from a browser, and
 * RemoteViews differently again, so the shapes and the spacing here are right and the line breaks are approximately right.
 * The device snapshot tests are the truth; this is for looking at a design and saying yes or no to it.
 *
 * What it is honest about, because being wrong about these would make the preview worse than nothing:
 *   - every colour comes from the catalog's own palette, through the same role table the phones read (ROLE_FALLBACK and all)
 *   - every bound path is resolved by the same closed rules (an unknown path is EMPTY, and a Text whose every slot resolved
 *     empty HIDES, exactly as it will on the phone)
 *   - a word's slots are filled by WORD_SLOTS, per surface, so "{n} working" shows as a number on a widget and vanishes on a
 *     Live Activity, which is the thing nobody believes until they see it
 *   - accessory roots are drawn MONOCHROME and tinted mode desaturated, because that is what the system does to them
 *   - a `Bot` still is drawn as a plain disc with the bot's own colour: the real one is rendered on the phone from the bots'
 *     catalog, and faking it prettier here would hide how much room it needs
 */
import {
  ROLE_FALLBACK, WORD_SLOTS, bindPathInfo, eachListKey, wordSlotFill,
  type NLookDesign, type NLookNode, type NLookPalette, type NLookScheme, type NLookSurface,
} from "../../../shared/types/nlook.js";

export type Scheme = "dark" | "light";
/** What the system does to the colours of a root: `full` is a Home Screen, the other two are not. */
export type Mode = "full" | "accented" | "vibrant" | "mono";

export interface RefOptions {
  design: NLookDesign;
  root: string;
  palette: NLookPalette;
  scheme: Scheme;
  mode?: Mode;
  /** The glance (widget) or the ContentState (activity / notice) this design is drawn against. */
  data: Record<string, unknown>;
  /** Always-On: the system dims everything and stops every timer. */
  reduced?: boolean;
  /** StandBy and the Lock Screen: !showsWidgetContainerBackground. */
  standby?: boolean;
  platform?: "ios" | "android";
  /** Whether the widget's own token could answer a needs item from here. */
  canAnswer?: boolean;
  /** The moment the sample is "now". Without it a timer in a preview counts from the sample's date to today, which is years. */
  now?: number;
  width: number;
  height: number;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---------------------------------------------------------------- colour

const FONTS: Record<string, string> = {
  sans: "-apple-system, 'Segoe UI', system-ui, sans-serif",
  brand: "'Geist', -apple-system, system-ui, sans-serif",
  display: "'Bricolage Grotesque', 'Geist', system-ui, sans-serif",
  dots: "'Doto', 'Courier New', monospace",
  mono: "ui-monospace, 'SF Mono', 'Courier New', monospace",
};

/** The role table every renderer reads, resolved the same way: a missing role falls back by ROLE_FALLBACK, never to nothing. */
function roleColour(role: string, s: NLookScheme): string | null {
  const direct = (s as unknown as Record<string, unknown>)[role];
  if (typeof direct === "string") return direct;
  const back = ROLE_FALLBACK[role as keyof typeof ROLE_FALLBACK];
  return back ? roleColour(back, s) : null;
}

/** Grey, by luminance: what the system does to an accessory family and to Always-On. */
function grey(hex: string): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2) || "ff", 16));
  const y = Math.round(0.2126 * r! + 0.7152 * g! + 0.0722 * b!);
  return `rgb(${y}, ${y}, ${y})`;
}

export interface Paint { scheme: NLookScheme; mode: Mode; botColour: string }

/**
 * THE COLOUR OF WORDS — nlook's one rule, the same here as in all three renderers (shared/types/nlook.ts, above NLOOK_PROPS):
 *   - `tint` given: that colour.
 *   - no tint: `ground` when the NEAREST `bg` at or above the node (its own, else its closest ancestor's) is the ROLE `ink`
 *     or `accent`, with or without an @alpha. Otherwise `ink`.
 * ROLES, never luma. This renderer used to switch on luma against the nearest background, which gives a different answer in
 * the two schemes and so could not be what a phone does; the reason it gave for having no text colour at all ("two colours
 * the wrong way round in the other scheme") is true of raw hex and not of roles, which resolve per scheme.
 */
const FILLED_ROLES = new Set(["ink", "accent"]);

export function inkFor(tint: unknown, onRole: string | null, p: Paint): string {
  if (typeof tint === "string" && tint) return colourOf(tint, p);
  return onRole && FILLED_ROLES.has(onRole) ? colourOf("ground", p) : colourOf("ink", p);
}

/** The ROLE half of a colour token ("ink@0.6" → "ink"); null for a hex, a bot colour or nothing. */
export function roleOf(token: unknown): string | null {
  const raw = typeof token === "string" ? token : "";
  const base = raw.lastIndexOf("@") > 0 ? raw.slice(0, raw.lastIndexOf("@")) : raw;
  return base && !base.startsWith("#") && !base.startsWith("$") ? base : null;
}

/** One colour token to CSS: a hex, a role, $color, $bot.<slug>, any of them with an @alpha. Unknown becomes `ink`. */
export function colourOf(token: unknown, p: Paint): string {
  const raw = typeof token === "string" ? token : "";
  const at = raw.lastIndexOf("@");
  const base = at > 0 ? raw.slice(0, at) : raw;
  const alpha = at > 0 ? Math.max(0, Math.min(1, Number(raw.slice(at + 1)))) : 1;
  let hex = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(base) ? base
    : base === "$color" || base.startsWith("$bot.") ? p.botColour
      : roleColour(base, p.scheme) ?? p.scheme.ink;
  if (p.mode === "mono" || p.mode === "vibrant") hex = grey(hex);
  const out = hex.startsWith("rgb") ? hex : hex.slice(0, 7);
  if (alpha >= 1) return out;
  return out.startsWith("rgb") ? out.replace("rgb(", "rgba(").replace(")", `, ${alpha})`) : `${out}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- binding

interface Bound {
  data: Record<string, unknown>;
  surface: NLookSurface;
  item?: Record<string, unknown> | string;
  /** The moment this sample is "now". Without it a timer counts from the sample's date to today, which is years, not minutes. */
  now?: number;
}

/** One path against the data. `it` and `it.<name>` read the Each's current item. Unknown gives "", exactly as on the phone. */
function valueAt(path: string, b: Bound): unknown {
  if (path === "it") return typeof b.item === "string" ? b.item : "";
  if (path.startsWith("it.")) return isObj(b.item) ? b.item[path.slice(3)] : "";
  let at: unknown = b.data;
  for (const part of path.split(".")) {
    const m = /^([a-zA-Z]+)\[(\d+)\]$/.exec(part);
    if (m) {
      const list = isObj(at) ? at[m[1]!] : undefined;
      at = Array.isArray(list) ? list[Number(m[2])] : undefined;
      continue;
    }
    at = isObj(at) ? at[part] : undefined;
  }
  return at ?? "";
}

/** The sample's own "now" (`now`, else its `at`), else the clock. A preview's timer must read like a timer. */
const atOf = (b: Bound): number => b.now || num(b.data.at) || Date.now();

/** A word's own slots ({n}, {stage}, {of}), filled by the closed table. A slot this surface cannot fill makes the word empty. */
function fillWord(word: string, text: string, b: Bound): string {
  const slots = WORD_SLOTS[word];
  if (!slots) return text;
  let out = text;
  for (const slot of Object.keys(slots)) {
    const fill = wordSlotFill(word, slot, b.surface);
    if (!fill) return "";
    const v = "path" in fill ? valueAt(fill.path, b)
      : Math.max(0, Math.round((atOf(b) - num(valueAt(fill.minutesSince, b))) / 60_000));
    out = out.split(`{${slot}}`).join(String(v ?? ""));
  }
  return out;
}

/** A template: the words with every `{{path}}` resolved. `hid` is true when EVERY slot resolved empty, and the Text hides. */
export function template(text: string, b: Bound): { text: string; hid: boolean } {
  let slots = 0;
  let filled = 0;
  const out = text.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    slots++;
    const path = raw.trim();
    if (!bindPathInfo(path) && !path.startsWith("it")) return "";
    let v = valueAt(path, b);
    if (path.startsWith("words.")) v = fillWord(path.slice(6), String(v ?? ""), b);
    const s = v === null || v === undefined ? "" : String(v);
    if (s) filled++;
    return s;
  });
  return { text: out, hid: slots > 0 && filled === 0 };
}

// ---------------------------------------------------------------- the tree

interface Ctx extends Bound {
  o: RefOptions;
  paint: Paint;
  /** The ROLE of the nearest `bg` at or above this node ("ink", "surface", …); absent on the root. */
  on?: string | null;
  /** Which way the parent stacks. "fill" means ACROSS the parent, so in a row it is width and in a column it is height. */
  dir?: "row" | "col";
}



/** `if`: an AND over keys, each key an OR over its values, exactly as the phones read it. An unknown key is already gone. */
function shows(node: NLookNode, c: Ctx): boolean {
  const cond = node.if as Record<string, unknown> | undefined;
  if (!cond) return true;
  const one = (v: unknown, want: unknown): boolean => (Array.isArray(want) ? want.includes(v) : want === undefined || want === v);
  if (cond.family !== undefined && !one(c.o.root, cond.family)) return false;
  if (cond.appearance !== undefined && !one(c.o.scheme, cond.appearance)) return false;
  if (cond.mode !== undefined && !one(c.o.mode ?? "full", cond.mode)) return false;
  if (cond.reduced !== undefined && cond.reduced !== (c.o.reduced === true)) return false;
  if (cond.standby !== undefined && cond.standby !== (c.o.standby === true)) return false;
  if (cond.platform !== undefined && !one(c.o.platform ?? "ios", cond.platform)) return false;
  if (cond.canAnswer !== undefined && cond.canAnswer !== (c.o.canAnswer !== false)) return false;
  if (cond.case !== undefined && !one(c.data.case, cond.case)) return false;
  if (cond.phase !== undefined && !one(c.data.phase, cond.phase)) return false;
  if (cond.has !== undefined) {
    const v = valueAt(String(cond.has), c);
    if (v === "" || v === undefined || v === null || (Array.isArray(v) && !v.length)) return false;
  }
  return true;
}

const px = (v: unknown): string => (typeof v === "number" ? `${v}px` : v === "fill" ? "100%" : "auto");

/** The style keys of format 1 as CSS. An unknown key never reaches here: clean() has already dropped it. */
function styleOf(node: NLookNode, c: Ctx): string {
  const s = (node.style ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  if (s.pad !== undefined) out.push(`padding:${Array.isArray(s.pad) ? s.pad.map((n) => `${n}px`).join(" ") : `${num(s.pad)}px`}`);
  // "fill" takes the room the PARENT has spare, on the parent's own axis. In a column, w:"fill" is simply full width — it must
  // never also grow downwards, which is how a 1px rule ends up a 100px band.
  const row = c.dir !== "col";
  if (s.w !== undefined) out.push(s.w === "fill" ? `width:100%${row ? ";flex:1 1 auto" : ""}` : s.w === "fit" ? "width:max-content" : `width:${px(s.w)};flex:0 0 auto`);
  if (s.h !== undefined) out.push(s.h === "fill" ? `height:100%${row ? "" : ";flex:1 1 auto"}` : s.h === "fit" ? "height:max-content" : `height:${px(s.h)};flex:0 0 auto`);
  if (s.maxW !== undefined) out.push(`max-width:${num(s.maxW)}px`);
  if (s.maxH !== undefined) out.push(`max-height:${num(s.maxH)}px`);
  if (s.bg !== undefined) out.push(`background:${colourOf(s.bg, c.paint)}`);
  if (s.corner !== undefined) out.push(`border-radius:${num(s.corner)}px`);
  if (isObj(s.border)) out.push(`border:${num(s.border.width, 1)}px solid ${colourOf(s.border.color, c.paint)}`);
  if (s.opacity !== undefined) out.push(`opacity:${num(s.opacity, 1)}`);
  if (Array.isArray(s.offset) && c.o.platform !== "android") out.push(`transform:translate(${num(s.offset[0])}px, ${num(s.offset[1])}px)`);
  if (s.align !== undefined) out.push(`align-self:${s.align === "start" ? "flex-start" : s.align === "end" ? "flex-end" : "center"}`);
  // A sensitive line on a lock or accessory root is drawn redacted, because that is what the phone does with it.
  if (s.sensitive === true && (c.o.mode === "mono" || c.o.root === "lock") && c.data.private === true) out.push("filter:blur(4px)");
  return out.join(";");
}

const flexAlign = (v: unknown): string => (v === "end" ? "flex-end" : v === "center" ? "center" : "flex-start");

/** One node. Returns "" when it draws nothing, which is never an error: a sibling still draws. */
function draw(node: NLookNode, c: Ctx, depth = 0): string {
  if (depth > 12 || !node || typeof node !== "object") return "";
  if (!shows(node, c)) return "";
  const p = (node.props ?? {}) as Record<string, unknown>;
  const st = styleOf(node, c);
  // The nearest `bg` at or above this node, by ROLE: what a Text with no `tint` reads to decide between ink and ground.
  const bg = (node.style as Record<string, unknown> | undefined)?.bg;
  if (bg !== undefined) c = { ...c, on: roleOf(bg) };
  const inner: Ctx = { ...c, dir: node.type === "V" || node.type === "Grid" ? "col" : node.type === "H" ? "row" : c.dir };
  const kids = (node.children ?? []).map((k) => draw(k, inner, depth + 1)).join("");

  switch (node.type) {
    case "V": return `<div style="display:flex;flex-direction:column;gap:${num(p.gap)}px;align-items:${flexAlign(p.align)};${st}">${kids}</div>`;
    case "H": return `<div style="display:flex;flex-direction:row;gap:${num(p.gap)}px;align-items:${flexAlign(p.align)};${st}">${kids}</div>`;
    case "Z": return `<div style="position:relative;display:grid;place-items:${p.align === "end" ? "end" : p.align === "center" ? "center" : "start"};${st}">${(node.children ?? []).map((k) => `<div style="grid-area:1/1;width:100%;height:100%">${draw(k, inner, depth + 1)}</div>`).join("")}</div>`;
    case "Spacer": return `<div style="flex:1 1 auto;min-height:${num(p.min)}px;min-width:${num(p.min)}px"></div>`;
    case "Grid": return `<div style="display:grid;grid-template-columns:repeat(${Math.max(1, Math.min(4, num(p.cols, 1)))},1fr);gap:${num(p.gap)}px;${st}">${kids}</div>`;
    case "Text": return text(p, c, st);
    case "Image": return image(p, c, st);
    case "Bot": return bot(p, c, st);
    case "Shape": return shape(p, c, st);
    case "Bar": return bar(p, c, st);
    case "Ring": return ring(p, c, st);
    case "Kit": return kit(p, c, st);
    case "Each": return each(node, inner, depth);
    // A Button is its child with a press target around it: the action is compiled into the binary, never drawn.
    case "Button": return `<div style="cursor:pointer;${st}">${kids}</div>`;
    default: return node.fallback ? draw(node.fallback, c, depth + 1) : "";
  }
}

function text(p: Record<string, unknown>, c: Ctx, st: string): string {
  // A timer is a clock the system runs; Always-On stops it, so it is drawn at its own start.
  const timer = p.timer ?? p.countdown ?? p.relative;
  let body: string;
  if (timer) {
    const from = num(valueAt(String(timer), c));
    const at = atOf(c);
    const mins = from ? Math.max(0, Math.min(12 * 60, Math.floor((at - from) / 60_000))) : 0;
    body = p.relative ? `${mins}m ago` : `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  } else {
    const t = template(String(p.text ?? ""), c);
    if (t.hid || !t.text.trim()) return "";
    body = t.text;
  }
  const lines = Math.max(1, num(p.lines, 1));
  const css = [
    `font-family:${FONTS[String(p.font ?? "sans")] ?? FONTS.sans}`,
    `font-size:${num(p.size, 13)}px`,
    `font-weight:${num(p.weight, 400)}`,
    `line-height:${Math.round(num(p.size, 13) * 1.25)}px`,
    `color:${inkFor(p.tint, c.on ?? null, c.paint)}`,
    p.track !== undefined ? `letter-spacing:${num(p.track)}px` : "",
    p.digits === "mono" ? "font-variant-numeric:tabular-nums" : "",
    p.case === "upper" ? "text-transform:uppercase" : "",
    `text-align:${p.align === "end" ? "right" : p.align === "center" ? "center" : "left"}`,
    `display:-webkit-box;-webkit-line-clamp:${lines};-webkit-box-orient:vertical;overflow:hidden`,
    // Never squeezed by the column it sits in. A -webkit-box shrinks to any height at all, so a line in a design that is
    // a little too tall came out cut in HALF, which reads as a renderer bug rather than as "this design does not fit".
    // Held at its own height, the overflow goes where it belongs: off the bottom of the card, which is what you must see.
    `flex:0 0 auto`,
    st,
  ].filter(Boolean).join(";");
  return `<div style="${css}">${esc(body)}</div>`;
}

function image(p: Record<string, unknown>, c: Ctx, st: string): string {
  const src = template(String(p.src ?? ""), c).text;
  const size = num(p.size, 28);
  const fit = p.fit === "fit" ? "contain" : p.fit === "stretch" ? "fill" : "cover";
  // Art and faces are files the phone already holds; the preview shows the SHAPE and the room they take, with their key on them.
  const label = src.split(":").pop() ?? "";
  return `<div style="width:${size}px;height:${size}px;flex:0 0 auto;display:grid;place-items:center;background:${colourOf("surface", c.paint)};color:${colourOf("meta", c.paint)};font:500 ${Math.max(7, Math.round(size / 4))}px ${FONTS.mono};overflow:hidden;object-fit:${fit};${st}">${esc(label.slice(0, 6))}</div>`;
}

function bot(p: Record<string, unknown>, c: Ctx, st: string): string {
  const size = num(p.size, 32);
  return `<div style="width:${size}px;height:${size}px;flex:0 0 auto;border-radius:50%;background:${c.paint.botColour};opacity:0.9;display:grid;place-items:center;color:${colourOf("ground", c.paint)};font:600 ${Math.max(7, Math.round(size / 3.5))}px ${FONTS.mono};${st}">${esc(String(p.moment ?? "").slice(0, 4))}</div>`;
}

function shape(p: Record<string, unknown>, c: Ctx, st: string): string {
  const fill = p.fill !== undefined ? colourOf(p.fill, c.paint) : "transparent";
  const stroke = p.stroke !== undefined ? colourOf(p.stroke, c.paint) : "none";
  const width = num(p.width, 1);
  switch (p.kind) {
    case "capsule": return `<div style="background:${fill};border-radius:999px;${st}"></div>`;
    case "circle": return `<div style="background:${fill};border-radius:50%;${st}"></div>`;
    case "ring": return `<div style="border:${width}px solid ${stroke === "none" ? fill : stroke};border-radius:50%;${st}"></div>`;
    case "path": {
      const vb = Array.isArray(p.viewBox) ? p.viewBox.map((n) => num(n)).join(" ") : "0 0 100 100";
      return `<svg viewBox="${vb}" preserveAspectRatio="none" style="display:block;${st}"><path d="${esc(String(p.d ?? ""))}" fill="${p.fill ? fill : "none"}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/></svg>`;
    }
    case "dots": {
      const gap = num(p.spacing, 6);
      const dot = num(p.dot, 2);
      return `<div style="background-image:radial-gradient(${fill} ${dot / 2}px, transparent ${dot / 2}px);background-size:${gap}px ${gap}px;${st}"></div>`;
    }
    default: return `<div style="background:${fill};${st}"></div>`;
  }
}

/**
 * The one Bar rule (shared/types/nlook.ts, above NLOOK_PROPS): one segment per stage with `of` clamped to 1-8, the current
 * one striped, and the stage names under it ONLY when `segments` resolves to exactly `of` of them. iOS StageBar and
 * Android NLookPlan.bar draw the same lines, so what you see here is what a phone draws.
 */
function bar(p: Record<string, unknown>, c: Ctx, st: string): string {
  const value = num(template(String(p.value ?? ""), c).text || p.value);
  const of = Math.max(1, Math.min(8, num(template(String(p.of ?? ""), c).text || p.of, 1)));
  const track = colourOf(p.track ?? "line", c.paint);
  const fill = colourOf(p.color ?? "ink", c.paint);
  const now = Math.max(0, Math.min(of, Math.round(value)));
  const list = p.segments !== undefined && eachListKey(String(p.segments)) ? valueAt(String(p.segments), c) : null;
  const names = Array.isArray(list) && list.length === of ? list.map((n) => String(n)) : null;
  const cells: string[] = [];
  for (let i = 1; i <= of; i += 1) {
    const back = i < now ? fill
      : i === now ? `repeating-linear-gradient(135deg, ${fill} 0 3px, ${track} 3px 6px)`
        : track;
    cells.push(`<div style="flex:1 1 0;border-radius:inherit;background:${back}"></div>`);
  }
  const strip = `<div style="display:flex;gap:2px;overflow:hidden;background:transparent;${st}">${cells.join("")}</div>`;
  if (!names) return strip;
  // The names row is EXTRA height: the bar keeps its own `h`, as it does on both phones.
  const labels = names.map((name, i) => {
    const step = i + 1;
    const role = step === now ? "ink" : step < now ? "meta" : "dim";
    const weight = step === now ? 600 : 400;
    return `<div style="flex:1 1 0;min-width:0;font-family:${FONTS.sans};font-size:11px;font-weight:${weight};line-height:14px;color:${colourOf(role, c.paint)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>`;
  }).join("");
  return `<div style="display:flex;flex-direction:column;gap:3px;flex:0 0 auto;width:100%">${strip}<div style="display:flex;gap:2px">${labels}</div></div>`;
}

function ring(p: Record<string, unknown>, c: Ctx, st: string): string {
  const value = num(template(String(p.value ?? ""), c).text || p.value);
  const of = Math.max(1, num(template(String(p.of ?? ""), c).text || p.of, 1));
  const w = num(p.width, 4);
  const deg = Math.max(0, Math.min(360, (value / of) * 360));
  return `<div style="width:100%;height:100%;border-radius:50%;background:conic-gradient(${colourOf("ink", c.paint)} ${deg}deg, ${colourOf("hollow", c.paint)} 0);-webkit-mask:radial-gradient(circle, transparent calc(50% - ${w}px), #000 calc(50% - ${w}px));${st}"></div>`;
}

/** The named parts today's native views already draw. Sketched here, drawn for real by X0Parts.swift and its Android twin. */
function kit(p: Record<string, unknown>, c: Ctx, st: string): string {
  const inner = (p.props ?? {}) as Record<string, unknown>;
  switch (p.name) {
    case "askBar":
      return `<div style="display:flex;align-items:center;gap:6px;padding:0 10px;border-radius:999px;border:1px solid ${colourOf("outline", c.paint)};color:${colourOf("meta", c.paint)};font:400 12px ${FONTS.sans};${st}">${esc(String((c.data.words as Record<string, string> | undefined)?.ask ?? "Ask any bot…"))}</div>`;
    case "beads": {
      const n = Math.max(0, Math.min(7, num(template(String(inner.value ?? ""), c).text || inner.value)));
      const dots = Array.from({ length: 7 }, (_, i) => `<div style="width:8px;height:8px;border-radius:50%;background:${i < n ? colourOf("ink", c.paint) : colourOf("hollow", c.paint)}"></div>`).join("");
      return `<div style="display:flex;gap:5px;align-items:center;${st}">${dots}</div>`;
    }
    case "stripes":
      return `<div style="background:repeating-linear-gradient(90deg, ${colourOf("line", c.paint)} 0 2px, transparent 2px 6px);${st}"></div>`;
    case "pill":
      return `<div style="border-radius:999px;background:${colourOf("surface", c.paint)};${st}"></div>`;
    default:
      return `<div style="display:grid;place-items:center;color:${colourOf("ink", c.paint)};font:600 14px ${FONTS.brand};${st}">X0</div>`;
  }
}

function each(node: NLookNode, c: Ctx, depth: number): string {
  const p = (node.props ?? {}) as Record<string, unknown>;
  const key = eachListKey(String(p.of ?? ""));
  if (!key) return "";
  const list = valueAt(String(p.of ?? "").replace(/\[(\d+)\]/g, "[$1]"), c);
  const items = Array.isArray(list) ? list.slice(0, Math.max(1, num(p.max, 3))) : [];
  return items.map((item) => (node.children ?? []).map((k) => draw(k, { ...c, item: item as Record<string, unknown> }, depth + 1)).join("")).join("");
}

// ---------------------------------------------------------------- one root, as a page

/** The chrome around a root: the family's real point size, the container background, and what the system does to colour. */
export function renderRoot(o: RefOptions): string {
  const scheme = o.palette[o.scheme];
  const mode: Mode = o.mode ?? "full";
  const botColour = String((o.data.bots as Array<{ color?: string }> | undefined)?.[0]?.color ?? scheme.accent);
  const paint: Paint = { scheme, mode, botColour };
  // The root sits in the family's own frame, which stacks downwards.
  const c: Ctx = { o, paint, data: o.data, surface: o.design.surface, dir: "col", now: o.now ?? num(o.data.at) ?? undefined };
  const node = o.design.roots?.[o.root as keyof NonNullable<NLookDesign["roots"]>];
  const body = node ? draw(node, c) : `<div style="color:${colourOf("meta", paint)};font:400 11px ${FONTS.mono};padding:8px">no ${esc(o.root)} root</div>`;
  // An accessory family and StandBy have NO container background: the system draws the words straight onto the wallpaper.
  // The preview keeps that honest and outlines where the root's edge is, so nobody reads the sheet's own padding as the widget.
  const bare = mode === "mono" || o.standby;
  const ground = bare ? "transparent" : colourOf("ground", paint);
  // The island itself is the rounded black pill; its REGIONS are rectangles inside it, so rounding each one would both look
  // wrong and crop a word at the corner. Only a widget family and the lock banner have a corner of their own.
  const region = o.design.surface === "activity" && o.root !== "lock";
  // An ACCESSORY family (rect, inline, circle) is drawn straight onto the Lock Screen with no container of its own: the
  // system gives it no corner and clips nothing. A 22 pt corner with overflow:hidden on a 160x72 rect ate the first glyph
  // of its line, which read as a layout bug in the design rather than in this preview.
  const accessory = o.root === "rect" || o.root === "inline" || o.root === "circle";
  const radius = o.root === "circle" ? "50%" : region || accessory ? "0" : "22px";
  const clip = accessory && o.root !== "circle" ? "visible" : "hidden";
  return `<div class="root" style="width:${o.width}px;height:${o.height}px;border-radius:${radius};background:${ground};overflow:${clip};position:relative;${bare ? "outline:1px dashed rgba(255,255,255,0.28);outline-offset:0;" : ""}${o.reduced ? "opacity:0.55;" : ""}"><div style="width:100%;height:100%;display:flex;flex-direction:column">${body}</div></div>`;
}

/** The real point sizes each root is drawn at, on a 390 pt phone. The preview is worthless at the wrong size. */
export const ROOT_SIZES: Readonly<Record<string, { w: number; h: number }>> = {
  small: { w: 158, h: 158 },
  medium: { w: 338, h: 158 },
  large: { w: 338, h: 354 },
  inline: { w: 338, h: 26 },
  rect: { w: 160, h: 72 },
  circle: { w: 76, h: 76 },
  lock: { w: 364, h: 160 },
  "island.leading": { w: 110, h: 44 },
  "island.trailing": { w: 110, h: 44 },
  "island.center": { w: 120, h: 44 },
  "island.bottom": { w: 364, h: 80 },
  "compact.leading": { w: 44, h: 36 },
  "compact.trailing": { w: 44, h: 36 },
  minimal: { w: 36, h: 36 },
};

/** A whole page of roots, for a screenshot or for the picker. */
export function page(title: string, cards: Array<{ label: string; html: string; dark: boolean }>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #fff; font: 400 12px -apple-system, system-ui, sans-serif; padding: 20px; }
  .sheet { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .cell { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .cap { color: #666; font: 500 11px ui-monospace, monospace; }
  /* Enough room that the sheet's own rounded corner never crops a word at the root's corner and reads as a clipping bug. */
  .pad { padding: 18px; border-radius: 20px; align-self: flex-start; }
  .pad.dark { background: #2b2b2e; }
  .pad.light { background: #d9d9d6; }
</style></head><body><div class="sheet">
${cards.map((c) => `<div class="cell"><div class="pad ${c.dark ? "dark" : "light"}">${c.html}</div><div class="cap">${esc(c.label)}</div></div>`).join("\n")}
</div></body></html>`;
}

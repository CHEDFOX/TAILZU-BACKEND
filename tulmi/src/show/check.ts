/**
 * WHAT A MODEL DREW, CHECKED: ONLY BLOCKS WE KNOW, ONLY WITHIN THE CAPS, ONLY ADDRESSES THE TURN SAW.
 *
 *   checkShown(raw, { seen }) -> Shown | null
 *
 * The model's blocks are data like any other model output, so nothing in them is trusted: an unknown type, a field of the wrong
 * kind or a value out of range drops that block alone (the rest stay); a long text is cut; boxes nest three deep at most; a link
 * or a picture whose address this turn never saw is dropped (links.ts says why); anything that looks like a secret drops the
 * whole drawing, as a reply's words would be (bots/run.ts scrub). Each choice and form gets a `key`, where the screen keeps what
 * the person picks or types (answer.ts turns it back into words). Null when nothing is left to draw.
 *
 * Pure: the same input gives the same output.
 */
import { scanForSecrets } from "../code/policy.js";
import { safeUrl } from "./links.js";
import {
  BLIP_ACTS, BOXES, CHART_KINDS, DRAW_COLOURS, FIELD_KINDS, LIST_STYLES, SHOW_LIMITS as L, STEP_STATES, TEXT_STYLES, TONES,
  type Block, type DrawShape, type Field, type Option, type Shown,
} from "./types.js";

type Raw = Record<string, unknown>;

const KEY_SHAPE = /\btzb_[A-Za-z0-9_-]{16,}/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
/** The blocks whose items can stand for the answer's own lists. */
const LISTY = new Set(["choice", "table", "steps", "list", "facts", "chart"]);

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list as readonly unknown[]).includes(v) ? (v as T) : undefined;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** A piece of text: control characters out, markdown's bold marks out, spaces made single, cut to `max`. `lines` keeps line breaks. */
function words(v: unknown, max: number, lines = false): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  let s = String(v).replace(CONTROL, " ").replace(/\*\*|__/g, "").replace(/\r/g, "");
  s = lines ? s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
const label = (v: unknown): string => words(v, L.label);
const opt = (v: unknown, max: number = L.label): string | undefined => { const s = words(v, max); return s || undefined; };

/** Strings from a list, each a label, the empty and the repeated ones left out, at most `n`. */
function labels(v: unknown, n: number, max: number = L.label): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = words(x, max);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

const colour = (v: unknown): string | undefined => (typeof v === "string" && (HEX.test(v.trim()) || oneOf(DRAW_COLOURS, v.trim())) ? v.trim() : undefined);

function shapeOf(v: unknown, w: number, h: number): DrawShape | null {
  if (!isObj(v)) return null;
  const paint: Omit<DrawShape, "circle" | "d"> = {};
  const fill = colour(v.fill), stroke = colour(v.stroke), width = num(v.width);
  if (fill) paint.fill = fill;
  if (stroke) paint.stroke = stroke;
  if (width !== null && width > 0) paint.width = Math.min(width, Math.max(w, h) / 4);
  if (!paint.fill && !paint.stroke) paint.stroke = "ink";
  if (Array.isArray(v.circle) && v.circle.length === 3) {
    const [cx, cy, r] = v.circle.map(num);
    if (cx === null || cy === null || r === null || cx === undefined || cy === undefined || r === undefined || r <= 0) return null;
    return { circle: [cx, cy, Math.min(r, Math.max(w, h))], ...paint };
  }
  if (typeof v.d === "string") {
    const d = v.d.trim();
    if (!d || d.length > L.path || !PATH.test(d)) return null;
    return { d, ...paint };
  }
  return null;
}

interface Walk {
  seen: { has(url: string): boolean };
  /** Blocks so far, nested ones included. */
  count: number;
  links: number;
  keys: number;
  asks: number;
  suggests: number;
}

function blockOf(v: unknown, depth: number, w: Walk): Block | null {
  if (!isObj(v) || w.count >= L.total) return null;
  const b = ((): Block | null => {
    switch (v.type) {
      case "text": {
        const text = words(v.text, L.text, true);
        const style = oneOf(TEXT_STYLES, v.style);
        return text ? { type: "text", text, ...(style ? { style } : {}) } : null;
      }
      case "callout": {
        const text = words(v.text, L.text, true);
        const title = opt(v.title);
        return text || title ? { type: "callout", text, ...(title ? { title } : {}), tone: oneOf(TONES, v.tone) ?? "info" } : null;
      }
      case "list": {
        const items = labels(v.items, L.items, 200);
        return items.length ? { type: "list", items, style: oneOf(LIST_STYLES, v.style) ?? "bullet" } : null;
      }
      case "facts": {
        const items = (Array.isArray(v.items) ? v.items : []).filter(isObj)
          .map((x) => ({ label: label(x.label), value: words(x.value, 200) })).filter((x) => x.label && x.value).slice(0, L.items);
        return items.length ? { type: "facts", items } : null;
      }
      case "table": {
        const columns = labels(v.columns, L.columns, 40);
        if (!columns.length) return null;
        const rows = (Array.isArray(v.rows) ? v.rows : []).filter(Array.isArray).slice(0, L.rows)
          .map((r) => columns.map((_c, i) => label((r as unknown[])[i] ?? ""))).filter((r) => r.some(Boolean));
        return rows.length ? { type: "table", columns, rows } : null;
      }
      case "stat": {
        const lab = label(v.label), value = words(v.value, 24), note = opt(v.note);
        return lab && value ? { type: "stat", label: lab, value, ...(note ? { note } : {}) } : null;
      }
      case "progress": {
        const value = num(v.value);
        if (value === null) return null;
        const given = num(v.max);
        const max = given !== null && given > 0 ? given : value <= 1 ? 1 : 100;
        const lab = opt(v.label);
        return { type: "progress", value: Math.max(0, Math.min(value, max)), max, ...(lab ? { label: lab } : {}) };
      }
      case "steps": {
        const items = (Array.isArray(v.items) ? v.items : []).map((x) => (typeof x === "string" ? { title: x } : x)).filter(isObj).map((x) => {
          const title = label(x.title), note = opt(x.note, 160), state = oneOf(STEP_STATES, x.state);
          return { title, ...(note ? { note } : {}), ...(state ? { state } : {}) };
        }).filter((x) => x.title).slice(0, L.items);
        return items.length ? { type: "steps", items } : null;
      }
      case "chart": {
        const items = (Array.isArray(v.items) ? v.items : []).filter(isObj)
          .map((x) => ({ label: words(x.label, 24), value: num(x.value) })).filter((x): x is { label: string; value: number } => !!x.label && x.value !== null).slice(0, L.items);
        if (items.length < 2) return null;
        const unit = opt(v.unit, 12);
        return { type: "chart", kind: oneOf(CHART_KINDS, v.kind) ?? "bar", items, ...(unit ? { unit } : {}) };
      }
      case "draw": {
        const width = num(v.width), height = num(v.height);
        if (width === null || height === null || width <= 0 || height <= 0 || width > L.canvas || height > L.canvas) return null;
        const shapes = (Array.isArray(v.shapes) ? v.shapes : []).slice(0, L.shapes).map((s) => shapeOf(s, width, height)).filter((s): s is DrawShape => !!s);
        const lab = opt(v.label);
        return shapes.length ? { type: "draw", width, height, shapes, ...(lab ? { label: lab } : {}) } : null;
      }
      case "image": case "link": {
        const url = safeUrl(v.url);
        if (!url || !w.seen.has(url) || w.links >= L.links) return null;
        w.links += 1;
        return v.type === "image" ? { type: "image", url, alt: label(v.alt) || "Picture" } : { type: "link", url, label: label(v.label) || new URL(url).hostname };
      }
      case "divider": return { type: "divider" };
      case "row": case "grid": case "card": {
        if (depth >= L.depth) return null;
        // The box takes its own place before its children take theirs, so a full tree is the total, not one over it.
        w.count += 1;
        const kids: Block[] = [];
        for (const c of Array.isArray(v.children) ? v.children : []) {
          const k = blockOf(c, depth + 1, w);
          if (k) kids.push(k);
        }
        if (!kids.length) { w.count -= 1; return null; }
        if (v.type === "row") return { type: "row", children: kids };
        if (v.type === "grid") return { type: "grid", columns: Math.max(1, Math.min(L.grid, Math.round(num(v.columns) ?? 2))), children: kids };
        const title = opt(v.title), tone = oneOf(TONES, v.tone);
        return { type: "card", ...(title ? { title } : {}), ...(tone ? { tone } : {}), children: kids };
      }
      case "choice": {
        if (w.asks >= 3) return null;
        const options: Option[] = [];
        for (const x of Array.isArray(v.options) ? v.options : []) {
          const o = isObj(x) ? { label: label(x.label), note: opt(x.note, 120) } : { label: label(x) };
          if (o.label && !options.some((p) => p.label === o.label)) options.push(o.note ? { label: o.label, note: o.note } : { label: o.label });
          if (options.length >= L.options) break;
        }
        if (!options.length) return null;
        const question = opt(v.question, 160);
        w.asks += 1;
        return { type: "choice", key: `k${w.keys++}`, ...(question ? { question } : {}), options, multi: v.multi === true && options.length > 1, send: words(v.send, 24) || "Send" };
      }
      case "suggest": {
        if (w.suggests >= 1) return null;
        const items = labels(v.items, L.suggest);
        if (!items.length) return null;
        w.suggests += 1;
        return { type: "suggest", items };
      }
      case "form": {
        if (w.asks >= 3) return null;
        const fields: Field[] = [];
        for (const x of Array.isArray(v.fields) ? v.fields : []) {
          if (!isObj(x)) continue;
          const lab = label(x.label);
          if (!lab || fields.some((f) => f.label === lab)) continue;
          const options = labels(x.options, L.options);
          const kind = oneOf(FIELD_KINDS, x.kind) === "choice" && options.length >= 2 ? "choice" : oneOf(FIELD_KINDS, x.kind) === "number" ? "number" : "text";
          const placeholder = opt(x.placeholder, 60);
          fields.push({ label: lab, kind, ...(kind === "choice" ? { options } : {}), ...(placeholder && kind !== "choice" ? { placeholder } : {}) });
          if (fields.length >= L.fields) break;
        }
        if (!fields.length) return null;
        const title = opt(v.title, 160);
        w.asks += 1;
        return { type: "form", key: `k${w.keys++}`, ...(title ? { title } : {}), fields, send: words(v.send, 24) || "Send" };
      }
      default: return null;
    }
  })();
  if (b && !BOXES.has(b.type)) w.count += 1;
  return b;
}

/** Whether any text of the drawing looks like a secret or one of our keys. */
function holdsSecret(blocks: Block[]): boolean {
  const all = JSON.stringify(blocks);
  return KEY_SHAPE.test(all) || scanForSecrets([{ path: "show.json", content: all }]).length > 0;
}

const listy = (b: Block): boolean => LISTY.has(b.type) || (BOXES.has(b.type) && (b as { children: Block[] }).children.some(listy));

/** The model's `blocks` and `lists`, checked. Null when nothing is left to draw. */
export function checkShown(raw: { blocks?: unknown; lists?: unknown; blip?: unknown } | null | undefined, o: { seen: { has(url: string): boolean } }): Shown | null {
  if (!raw || !Array.isArray(raw.blocks)) return null;
  const w: Walk = { seen: o.seen, count: 0, links: 0, keys: 0, asks: 0, suggests: 0 };
  const blocks: Block[] = [];
  for (const v of raw.blocks) {
    if (blocks.length >= L.top) break;
    const b = blockOf(v, 0, w);
    if (b) blocks.push(b);
  }
  if (!blocks.length || holdsSecret(blocks)) return null;
  const blip = oneOf(BLIP_ACTS, raw.blip);
  return { blocks, ...(raw.lists === "drawn" && blocks.some(listy) ? { lists: "drawn" as const } : {}), ...(blip ? { blip } : {}) };
}

/** A drawing kept with a turn, read back: checked again (a row is data too), with every address it holds counted as seen. */
export function keptShown(raw: unknown): Shown | null {
  if (!isObj(raw)) return null;
  return checkShown(raw, { seen: { has: () => true } });
}

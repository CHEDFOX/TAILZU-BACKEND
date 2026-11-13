/**
 * CLEANING AN nlook DESIGN (shared/types/nlook.ts; native/SPEC.md section 2). The first of the three checks: the server cleans on
 * publish, the phone cleans again before it writes anything native, and native code clamps a third time.
 *
 * The rule the whole format rests on: UNKNOWN DEGRADES, NEVER THROWS. An unknown node draws its `fallback`, then nothing; an unknown
 * style key is ignored; an unknown colour becomes `ink`; a design whose `format` is too new is skipped ALONE and the catalog around it
 * is served as usual. Only four things refuse a whole design, because each one would be a key in a file path, a loop at render time or
 * a tree no phone can hold: a bad id, a fallback cycle, more nodes than the cap, and more bytes than the cap.
 *
 * Every verdict here is a case in shared/native/fixtures/designs.json and activity.json. If this file and a fixture disagree, the
 * fixture is the referee (fixtures/index.json).
 */
import {
  BIND_CLOSE, BIND_OPEN, BIND_PATHS, CONDITION_KEYS, EACH_ITEM_PREFIX, IMAGE_FITS, IMAGE_SRC_PREFIXES, KIT_NAMES, LINK_ALLOW,
  NLOOK_LIMITS, NLOOK_PROPS, NLOOK_STYLE_KEYS, NLOOK_SURFACES, NLOOK_TYPES, PALETTE_ROLES, SHAPE_KINDS, TEXT_CHANGES, TEXT_WEIGHTS,
  TYPE_TOKENS, activityNodeCap, bindPathInfo, bindsOn, eachItemInfo, eachListKey,
  type NLookArt, type NLookDesign, type NLookNode, type NLookSurface, type NLookType,
} from "../../../../shared/types/nlook.js";

/** What a case in the fixtures expects. `skipped` is not a problem: the design is simply not for this build. */
export type Verdict = "ok" | "clamped" | "dropped" | "skipped";

/** Something that was dropped, cut or ignored, in plain words, so a failing publish says where to look. */
export interface CleanIssue { at: string; why: string }

export interface CleanResult {
  id: string;
  verdict: Verdict;
  /** The design as it may be served. Absent when the verdict is `dropped` or `skipped`. */
  design?: NLookDesign;
  issues: CleanIssue[];
  /**
   * Bound paths this build knows nothing about. NOT a problem at render time — they resolve to an empty string and the Text hides,
   * which is how an older build degrades quietly — so they never change the verdict. They are listed because a design in OUR OWN
   * catalog that binds nothing is a typo, and lintCatalog refuses to publish one.
   */
  binds: string[];
}

export interface CleanOptions {
  /** The highest design format this reader draws. A design above it is skipped alone. Default: the contract's own format. */
  drawsFormat?: number;
  /** Palette names the catalog holds. A design naming one it does not hold keeps drawing, in the default palette. */
  palettes?: readonly string[];
  /** Art keys the catalog holds, with their sizes. An Image pointing at anything else falls to its `alt`. */
  art?: readonly NLookArt[];
  /** Every design id in the catalog, so a `fallback` that names nothing (or rings) is caught on publish. */
  designIds?: readonly string[];
  /** id -> its own `fallback`, for the cycle walk. */
  fallbackOf?: Readonly<Record<string, string | undefined>>;
}

const NODE_TYPES = new Set<string>(NLOOK_TYPES);
const STYLE_KEYS = new Set<string>(NLOOK_STYLE_KEYS);
const ROLES = new Set<string>(PALETTE_ROLES);
const CONDS = new Set<string>(CONDITION_KEYS);
const ALIGNS = new Set(["start", "center", "end"]);
const FITS = new Set<string>(IMAGE_FITS);
const KITS = new Set<string>(KIT_NAMES);
const SHAPES = new Set<string>(SHAPE_KINDS);
const CHANGES = new Set<string>(TEXT_CHANGES);
const FONTS = new Set<string>(TYPE_TOKENS);
const WEIGHTS = new Set<number>(TEXT_WEIGHTS);

/** How many numbers each path command takes. Anything else drops only that path (never the shape, never the design). */
const PATH_ARGS: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6, Z: 0, O: 3 };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ---------------------------------------------------------------- the small pieces

/**
 * The path grammar, M L Q C Z O (shared with the bots' looks, the animation format and the keyboard's `path` mark). Returns the `d` as
 * it may be drawn, or null when the whole path is refused. Over twelve subpaths the extras are cut and the shape still draws.
 */
export function cleanPathD(d: string): { d: string; cut: boolean } | null {
  if (!d || d.length > NLOOK_LIMITS.path.dChars) return null;
  const tokens = d.trim().split(/[\s,]+/).filter(Boolean);
  const out: string[] = [];
  let cmd = "";
  let subpaths = 0;
  let cut = false;
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i]!;
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t.toUpperCase();
      if (!(cmd in PATH_ARGS)) return null;
      i++;
    } else if (!cmd) {
      return null;
    }
    const n = PATH_ARGS[cmd]!;
    const args = tokens.slice(i, i + n);
    if (args.length < n) return null;
    for (const a of args) if (!Number.isFinite(Number(a))) return null;
    if (cmd === "M") {
      subpaths++;
      if (subpaths > NLOOK_LIMITS.path.perShape) { cut = true; break; }
    }
    out.push(cmd, ...args);
    i += n;
    // A bare Z repeats nothing: the next token must name a command again.
    if (n === 0 && i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) return null;
  }
  if (!out.length) return null;
  return { d: out.join(" "), cut };
}

/** A colour the grammar allows: a hex, a palette role, $color or $bot.<slug>, any of them with an @alpha suffix. */
export function isColour(v: unknown): boolean {
  const s = str(v);
  if (!s) return false;
  const at = s.lastIndexOf("@");
  const base = at > 0 ? s.slice(0, at) : s;
  if (at > 0) {
    const a = Number(s.slice(at + 1));
    if (!Number.isFinite(a) || a < 0 || a > 1) return false;
  }
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(base)) return true;
  if (ROLES.has(base)) return true;
  if (base === "$color") return true;
  return /^\$bot\.[a-z0-9_-]{1,40}$/.test(base);
}

/** A link a design may open: our own scheme, or the one https shape today's allow-list permits. Checked again natively. */
export function isAllowedLink(v: unknown): boolean {
  const s = str(v).trim();
  if (!s) return false;
  if (s.startsWith(`${LINK_ALLOW.scheme}://`)) return true;
  return s.startsWith(LINK_ALLOW.httpsPrefix);
}

/** Every `{{path}}` a template names. "face:{{it.face}}" names one; plain words name none. */
export function templatePaths(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf(BIND_OPEN, from);
    if (open < 0) break;
    const close = text.indexOf(BIND_CLOSE, open + BIND_OPEN.length);
    if (close < 0) break;
    out.push(text.slice(open + BIND_OPEN.length, close).trim());
    from = close + BIND_CLOSE.length;
  }
  return out;
}

/**
 * Whether a bound path resolves on this surface, inside (or outside) an `Each`. An unknown one is not an error — it resolves to an
 * empty string and the Text hides — but the publish lint lists it, because a design in our own catalog that binds nothing is a typo.
 */
export function bindResolves(path: string, surface: NLookSurface, inEach: string | null): boolean {
  if (path.startsWith(EACH_ITEM_PREFIX) || path === "it") return inEach ? !!eachItemInfo(inEach, path) : false;
  return bindsOn(path, surface);
}

/**
 * What `if.has` may name: a path this build knows, or the START of one. "lastDone.pr" is not a path of its own — the table holds
 * lastDone.pr.number and lastDone.pr.url — but "has: lastDone.pr" is the plain way to ask whether there is a pull request at all.
 */
export function hasPathKnown(path: string, surface: NLookSurface): boolean {
  if (bindsOn(path, surface)) return true;
  const under = `${path}.`;
  return Object.entries(BIND_PATHS).some(([key, info]) => key.startsWith(under) && info.on.includes(surface));
}

// ---------------------------------------------------------------- one node

interface Ctx {
  surface: NLookSurface;
  issues: CleanIssue[];
  art: Map<string, NLookArt>;
  /** Nodes kept so far in this root, so the per-root cap can stop counting. */
  count: { n: number };
  /** Bind paths that name nothing this build knows, for the publish lint. */
  unknownBinds: string[];
}

/** A node the surface cannot draw: its `fallback`, cleaned, else nothing. */
function fallbackOf(node: NLookNode, depth: number, ctx: Ctx, at: string, why: string): NLookNode | null {
  ctx.issues.push({ at, why });
  const fb = isObj(node.fallback) ? cleanNode(node.fallback as NLookNode, depth, ctx, `${at}.fallback`, null) : null;
  return fb;
}

/** One node, cleaned in place of itself. Null means nothing is drawn there, which is never a blank widget: a sibling still draws. */
function cleanNode(raw: NLookNode, depth: number, ctx: Ctx, at: string, inEach: string | null): NLookNode | null {
  if (!isObj(raw)) return null;
  if (depth > NLOOK_LIMITS.widget.depth) {
    ctx.issues.push({ at, why: `deeper than ${NLOOK_LIMITS.widget.depth}: everything below is dropped` });
    return null;
  }
  const type = str(raw.type);
  const surface = NLOOK_SURFACES[ctx.surface];
  if (!NODE_TYPES.has(type)) return fallbackOf(raw, depth, ctx, at, `unknown node type "${type || "?"}"`);
  if (surface.without.includes(type as NLookType)) return fallbackOf(raw, depth, ctx, at, `a ${ctx.surface} has no ${type}`);

  const props: Record<string, unknown> = {};
  const known = new Set(NLOOK_PROPS[type as NLookType]);
  for (const [k, v] of Object.entries(isObj(raw.props) ? raw.props : {})) {
    if (!known.has(k)) { ctx.issues.push({ at: `${at}.props.${k}`, why: "not a prop of this node type: ignored" }); continue; }
    props[k] = v;
  }

  // Per-type props, each clamped rather than guessed at.
  let each: string | null = inEach;
  switch (type) {
    case "V": case "H": case "Z": {
      if (props.align !== undefined && !ALIGNS.has(str(props.align))) {
        ctx.issues.push({ at: `${at}.props.align`, why: `align is start | center | end (across the stack); "${str(props.align)}" is dropped and the node draws as start` });
        delete props.align;
      }
      break;
    }
    case "Text": {
      const text = str(props.text);
      if (text.length > NLOOK_LIMITS.textChars) {
        ctx.issues.push({ at: `${at}.props.text`, why: `over ${NLOOK_LIMITS.textChars} characters: cut` });
        props.text = text.slice(0, NLOOK_LIMITS.textChars);
      }
      for (const p of templatePaths(str(props.text))) {
        if (!bindResolves(p, ctx.surface, each)) ctx.unknownBinds.push(`${at}.props.text: {{${p}}}`);
      }
      if (props.align !== undefined && !ALIGNS.has(str(props.align))) { ctx.issues.push({ at: `${at}.props.align`, why: "text align is start | center | end" }); delete props.align; }
      if (props.font !== undefined && !FONTS.has(str(props.font))) { ctx.issues.push({ at: `${at}.props.font`, why: `unknown type token "${str(props.font)}": sans` }); delete props.font; }
      if (props.weight !== undefined && !WEIGHTS.has(Number(props.weight))) { ctx.issues.push({ at: `${at}.props.weight`, why: "weight is 400 to 800 in hundreds" }); delete props.weight; }
      if (props.change !== undefined && !CHANGES.has(str(props.change))) { ctx.issues.push({ at: `${at}.props.change`, why: "change is numeric | fade | push | none" }); delete props.change; }
      // A timer needs a date path: pointed at words it would draw a nonsense clock, so it draws nothing instead.
      for (const key of ["timer", "countdown", "relative"] as const) {
        const p = str(props[key]);
        if (!p) continue;
        if (bindPathInfo(p)?.kind !== "date" || !bindsOn(p, ctx.surface)) {
          ctx.issues.push({ at: `${at}.props.${key}`, why: `${key} needs a date path; "${p}" is not one` });
          delete props[key];
        }
      }
      // The colour of the words. Missing is not an error: the nearest bg decides (NLOOK_PROPS' rule), the same on all three.
      if (props.tint !== undefined && !isColour(props.tint)) { ctx.issues.push({ at: `${at}.props.tint`, why: "unknown colour: ink" }); props.tint = "ink"; }
      break;
    }
    case "Image": {
      const src = str(props.src);
      const ok = IMAGE_SRC_PREFIXES.some((p) => src.startsWith(p));
      // The alt becomes the src when the src is refused, so it is held to the SAME rule. An alt of
      // "https://tracker.example/p.png" was once copied straight into src, which is the one thing this whole check exists
      // to stop: an Image is art:, face:, pose: or sym: and never an address.
      const altRaw = str(props.alt);
      const alt = IMAGE_SRC_PREFIXES.some((p) => altRaw.startsWith(p)) ? altRaw : "";
      if (altRaw && !alt) { ctx.issues.push({ at: `${at}.props.alt`, why: `"${altRaw}" is not art:, face:, pose: or sym:` }); delete props.alt; }
      const bad = (why: string): NLookNode | null => {
        if (!alt) return fallbackOf(raw, depth, ctx, at, `${why}, and no alt`);
        ctx.issues.push({ at: `${at}.props.src`, why: `${why}: the alt draws` });
        props.src = alt;
        delete props.alt;
        return null;
      };
      if (!ok) { const r = bad(`"${src}" is not art:, face:, pose: or sym:`); if (r || !alt) return r; }
      if (src.startsWith("art:")) {
        const key = src.slice(4);
        const file = ctx.art.get(key);
        // A bot still is drawn on the phone from the bots' own catalog, so it is never a file this catalog lists.
        if (!key.startsWith("bot:") && !file) { const r = bad(`art "${key}" is not in the catalog`); if (r || !alt) return r; }
        if (file && Math.max(file.w, file.h) > NLOOK_LIMITS.art.longEdgePx) { const r = bad(`art "${key}" is ${Math.max(file.w, file.h)} px on the long edge`); if (r || !alt) return r; }
        // Every scale is a file of its own, so the cap is per file, not per entry.
        const heaviest = file ? Math.max(0, ...(file.files ?? []).map((f) => Number(f?.bytes) || 0)) : 0;
        if (file && heaviest > NLOOK_LIMITS.art.fileBytes) { const r = bad(`art "${key}" is over ${NLOOK_LIMITS.art.fileBytes} bytes`); if (r || !alt) return r; }
      }
      for (const p of templatePaths(src)) if (!bindResolves(p, ctx.surface, each)) ctx.unknownBinds.push(`${at}.props.src: {{${p}}}`);
      if (props.fit !== undefined && !FITS.has(str(props.fit))) { ctx.issues.push({ at: `${at}.props.fit`, why: "fit is fill | fit | stretch" }); delete props.fit; }
      if (props.tint !== undefined && !isColour(props.tint)) { ctx.issues.push({ at: `${at}.props.tint`, why: "unknown colour: ink" }); props.tint = "ink"; }
      break;
    }
    case "Shape": {
      if (!SHAPES.has(str(props.kind))) return fallbackOf(raw, depth, ctx, at, `unknown shape kind "${str(props.kind)}"`);
      for (const key of ["fill", "stroke"] as const) {
        if (props[key] !== undefined && !isColour(props[key])) { ctx.issues.push({ at: `${at}.props.${key}`, why: "unknown colour: ink" }); props[key] = "ink"; }
      }
      if (str(props.kind) === "path") {
        const cleaned = cleanPathD(str(props.d));
        if (!cleaned) return fallbackOf(raw, depth, ctx, at, "the path's d is not in the M L Q C Z O grammar");
        if (cleaned.cut) ctx.issues.push({ at: `${at}.props.d`, why: `over ${NLOOK_LIMITS.path.perShape} paths: the extras are dropped` });
        props.d = cleaned.d;
      }
      break;
    }
    case "Kit": {
      if (!KITS.has(str(props.name))) return fallbackOf(raw, depth, ctx, at, `unknown kit part "${str(props.name)}"`);
      break;
    }
    case "Bar": case "Ring": {
      for (const key of ["color", "track"] as const) {
        if (props[key] !== undefined && !isColour(props[key])) { ctx.issues.push({ at: `${at}.props.${key}`, why: "unknown colour: ink" }); props[key] = "ink"; }
      }
      if (type === "Bar" && props.segments !== undefined && !eachListKey(str(props.segments))) {
        ctx.issues.push({ at: `${at}.props.segments`, why: `"${str(props.segments)}" is not a list this build knows` });
        delete props.segments;
      }
      break;
    }
    case "Grid": {
      const cols = Math.round(Number(props.cols));
      props.cols = Number.isFinite(cols) ? Math.max(1, Math.min(4, cols)) : 1;
      break;
    }
    case "Each": {
      const list = eachListKey(str(props.of));
      if (!list) return fallbackOf(raw, depth, ctx, at, `Each walks only a list this build knows; "${str(props.of)}" is not one`);
      const cap = Math.min(NLOOK_LIMITS.eachMax, surface.eachMax);
      const want = Math.round(Number(props.max));
      if (!Number.isFinite(want) || want > cap) {
        if (Number.isFinite(want)) ctx.issues.push({ at: `${at}.props.max`, why: `at most ${cap} copies on a ${ctx.surface}` });
        props.max = cap;
      } else {
        props.max = Math.max(1, want);
      }
      props.of = list === "needs.items[].choices" ? str(props.of) : list;
      each = list;
      break;
    }
    case "Button": {
      const act = isObj(props.act) ? props.act : null;
      const open = props.open;
      if (!act && open === undefined) return fallbackOf(raw, depth, ctx, at, "a Button answers an item or opens a link, and this one does neither");
      // A literal link is checked here; a TEMPLATED one is checked by what it binds — every slot must be a path the table marks
      // as a link, which is a path the server itself wrote. Either way the phone checks the resolved string again natively,
      // because a design must never be able to make a widget open someone else's app (guideline 4.4.1 and its widget cousins).
      if (open !== undefined) {
        const link = str(open);
        const ok = link.includes(BIND_OPEN)
          ? templatePaths(link).length > 0 && templatePaths(link).every((pth) => bindPathInfo(pth)?.kind === "link" && bindResolves(pth, ctx.surface, each))
          : isAllowedLink(link);
        if (!ok) return fallbackOf(raw, depth, ctx, at, `a link opens only ${LINK_ALLOW.scheme}:// or ${LINK_ALLOW.httpsPrefix}, or binds a link path`);
      }
      if (act && (str(act.item) === "" || str(act.action) === "")) return fallbackOf(raw, depth, ctx, at, "act needs an item and an action");
      break;
    }
    default: break;
  }

  // Style: an unknown key is ignored, an unknown colour becomes ink, and align is the three values.
  const style: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(isObj(raw.style) ? raw.style : {})) {
    if (!STYLE_KEYS.has(k)) { ctx.issues.push({ at: `${at}.style.${k}`, why: "not a style key of format 1: ignored" }); continue; }
    if ((k === "bg") && !isColour(v)) { ctx.issues.push({ at: `${at}.style.${k}`, why: "unknown colour: ink" }); style[k] = "ink"; continue; }
    if (k === "border") {
      if (!isObj(v) || !isColour(v.color)) { ctx.issues.push({ at: `${at}.style.border`, why: "a border is { color, width }" }); continue; }
      style[k] = { color: v.color, width: Number(v.width) || 1 };
      continue;
    }
    if (k === "align" && !ALIGNS.has(str(v))) { ctx.issues.push({ at: `${at}.style.align`, why: "align is start | center | end" }); continue; }
    if (k === "offset" && ctx.surface !== "widget") { ctx.issues.push({ at: `${at}.style.offset`, why: "offset is iOS-only and ignored here" }); continue; }
    style[k] = v;
  }

  // `if`: an AND over keys, each key an OR over its values. An unknown key is ignored, never a reason to vanish.
  let cond: Record<string, unknown> | undefined;
  if (isObj(raw.if)) {
    cond = {};
    for (const [k, v] of Object.entries(raw.if)) {
      if (!CONDS.has(k)) { ctx.issues.push({ at: `${at}.if.${k}`, why: "not a condition key of format 1: ignored" }); continue; }
      if (k === "has" && !hasPathKnown(str(v), ctx.surface)) { ctx.issues.push({ at: `${at}.if.has`, why: `"${str(v)}" is not a path this build knows` }); continue; }
      cond[k] = v;
    }
    if (!Object.keys(cond).length) cond = undefined;
  }

  ctx.count.n++;
  const children: NLookNode[] = [];
  for (const [n, child] of (Array.isArray(raw.children) ? raw.children : []).entries()) {
    const c = cleanNode(child as NLookNode, depth + 1, ctx, `${at}.children[${n}]`, each);
    if (c) children.push(c);
  }
  const fb = isObj(raw.fallback) ? cleanNode(raw.fallback as NLookNode, depth, ctx, `${at}.fallback`, each) : null;

  return {
    type: type as NLookType,
    ...(Object.keys(props).length ? { props } : {}),
    ...(Object.keys(style).length ? { style: style as NLookNode["style"] } : {}),
    ...(cond ? { if: cond as NLookNode["if"] } : {}),
    ...(children.length ? { children } : {}),
    ...(fb ? { fallback: fb } : {}),
  };
}

// ---------------------------------------------------------------- one design

/** How many nodes a tree holds, for the per-root and per-design caps. */
function countNodes(n: NLookNode | undefined): number {
  if (!n) return 0;
  let total = 1;
  for (const c of n.children ?? []) total += countNodes(c);
  if (n.fallback) total += countNodes(n.fallback);
  return total;
}

/** Keep the first `cap` nodes of a tree, breadth by depth, so a region that is too busy still draws its first lines. */
function capNodes(n: NLookNode, cap: number): NLookNode {
  let left = cap;
  const walk = (node: NLookNode): NLookNode | null => {
    if (left <= 0) return null;
    left--;
    const children: NLookNode[] = [];
    for (const c of node.children ?? []) { const k = walk(c); if (k) children.push(k); }
    const rest: NLookNode = { ...node };
    delete rest.children;
    return { ...rest, ...(children.length ? { children } : {}) };
  };
  return walk(n) ?? { type: "Spacer", props: { min: 0 } };
}

/** The `fallback` chain from this id: true when it rings or runs past every design in the catalog. */
function cycles(id: string, of: Readonly<Record<string, string | undefined>>): boolean {
  const seen = new Set<string>([id]);
  let at = of[id];
  while (at) {
    if (seen.has(at)) return true;
    seen.add(at);
    at = of[at];
  }
  return false;
}

/** One design, cleaned on its own. A bad one is dropped ALONE: the rest of the catalog is kept and served as usual. */
export function cleanDesign(raw: unknown, o: CleanOptions = {}): CleanResult {
  const issues: CleanIssue[] = [];
  const unknownBinds: string[] = [];
  const d = isObj(raw) ? raw : {};
  const id = str(d.id);
  if (!NLOOK_LIMITS.idPattern.test(id)) {
    return { id: id || "(no id)", verdict: "dropped", issues: [{ at: "id", why: "an id is [a-z0-9._-], 1 to 40 characters" }], binds: [] };
  }
  const format = Number(d.format);
  if (!Number.isFinite(format) || format < 1) return { id, verdict: "dropped", issues: [{ at: "format", why: "format is a whole number from 1" }], binds: [] };
  const draws = o.drawsFormat ?? 1;
  if (format > draws) return { id, verdict: "skipped", issues: [{ at: "format", why: `format ${format} is above the ${draws} this build draws: skipped alone` }], binds: [] };

  const surface = str(d.surface) as NLookSurface;
  if (!Object.prototype.hasOwnProperty.call(NLOOK_SURFACES, surface)) {
    return { id, verdict: "dropped", issues: [{ at: "surface", why: "surface is widget, activity or liveupdate" }], binds: [] };
  }
  const fb = str(d.fallback);
  if (fb) {
    if (o.designIds && !o.designIds.includes(fb)) issues.push({ at: "fallback", why: `"${fb}" is not a design in this catalog` });
    if (o.fallbackOf && cycles(id, { ...o.fallbackOf, [id]: fb })) {
      return { id, verdict: "dropped", issues: [{ at: "fallback", why: "the fallback chain rings, which would be a loop at render time" }], binds: [] };
    }
  }
  let palette = str(d.palette);
  if (palette && o.palettes && !o.palettes.includes(palette)) {
    issues.push({ at: "palette", why: `"${palette}" is not in the catalog: the default palette draws` });
    palette = o.palettes[0] ?? "";
  }

  const art = new Map((o.art ?? []).map((a) => [a.key, a]));
  const out: NLookDesign = {
    id, format, surface,
    ...(fb ? { fallback: fb } : {}),
    ...(palette ? { palette } : {}),
    ...(typeof d.note === "string" ? { note: d.note } : {}),
    ...(Array.isArray(d.art) ? { art: d.art.filter((k): k is string => typeof k === "string") } : {}),
  };

  if (surface === "liveupdate") {
    const fill = cleanFill(d.fill, issues, unknownBinds);
    if (!fill) return { id, verdict: "dropped", issues: [...issues, { at: "fill", why: "a liveupdate design is a fill, and this one has none" }], binds: unknownBinds };
    out.fill = fill;
  } else {
    const roots = isObj(d.roots) ? d.roots : {};
    const allowed = new Set<string>(NLOOK_SURFACES[surface].roots);
    const kept: Partial<Record<string, NLookNode>> = {};
    let total = 0;
    for (const [name, tree] of Object.entries(roots)) {
      if (!allowed.has(name)) { issues.push({ at: `roots.${name}`, why: `a ${surface} design has no "${name}" root` }); continue; }
      const ctx: Ctx = { surface, issues, art, count: { n: 0 }, unknownBinds };
      const node = cleanNode(tree as NLookNode, 1, ctx, `roots.${name}`, null);
      if (!node) { issues.push({ at: `roots.${name}`, why: "nothing in this root could be drawn" }); continue; }
      const n = countNodes(node);
      if (surface === "widget" && n > NLOOK_LIMITS.widget.nodesPerRoot) {
        return { id, verdict: "dropped", issues: [...issues, { at: `roots.${name}`, why: `${n} nodes, over the ${NLOOK_LIMITS.widget.nodesPerRoot} a root may hold` }], binds: unknownBinds };
      }
      if (surface === "activity") {
        const cap = activityNodeCap(name);
        if (n > cap) {
          issues.push({ at: `roots.${name}`, why: `${n} nodes, over the ${cap} this region may hold: the first ${cap} are kept` });
          kept[name] = capNodes(node, cap);
          total += cap;
          continue;
        }
      }
      kept[name] = node;
      total += n;
    }
    if (!Object.keys(kept).length) return { id, verdict: "dropped", issues: [...issues, { at: "roots", why: "a design needs at least one root this surface draws" }], binds: unknownBinds };
    if (surface === "widget" && total > NLOOK_LIMITS.widget.nodes) {
      return { id, verdict: "dropped", issues: [...issues, { at: "roots", why: `${total} nodes in all, over the ${NLOOK_LIMITS.widget.nodes} a design may hold` }], binds: unknownBinds };
    }
    out.roots = kept as NLookDesign["roots"];
  }

  const bytes = Buffer.byteLength(JSON.stringify(out), "utf8");
  const cap = surface === "activity" ? NLOOK_LIMITS.activity.designBytes : NLOOK_LIMITS.widget.designBytes;
  if (bytes > cap) return { id, verdict: "dropped", issues: [...issues, { at: "(whole design)", why: `${bytes} bytes, over the ${cap} a ${surface} design may hold` }], binds: unknownBinds };

  return { id, verdict: issues.length ? "clamped" : "ok", design: out, issues, binds: unknownBinds };
}

/** The Android notice's template fill: no canvas, only these slots, and the chip may never carry words that can be private. */
function cleanFill(raw: unknown, issues: CleanIssue[], unknownBinds: string[]): NLookDesign["fill"] | null {
  if (!isObj(raw)) return null;
  const fill: NonNullable<NLookDesign["fill"]> = {};
  const text = (key: "title" | "text" | "sub" | "chip") => {
    const v = str(raw[key]);
    if (!v) return;
    const cut = v.slice(0, NLOOK_LIMITS.textChars);
    for (const p of templatePaths(cut)) {
      if (!bindResolves(p, "liveupdate", null)) { unknownBinds.push(`fill.${key}: {{${p}}}`); continue; }
      // The chip is the status bar and Always-On: it may bind only paths that can never carry private words.
      if (key === "chip" && bindPathInfo(p)?.sensitive) {
        issues.push({ at: "fill.chip", why: `"${p}" can carry private words, and the chip shows on a locked phone` });
        return;
      }
    }
    fill[key] = cut;
  };
  text("title"); text("text"); text("sub"); text("chip");
  if (isObj(raw.progress)) {
    const p = raw.progress;
    fill.progress = {
      ...(eachListKey(str(p.segments)) ? { segments: eachListKey(str(p.segments))! } : {}),
      ...(str(p.at) ? { at: str(p.at) } : {}),
      ...(isColour(p.color) ? { color: str(p.color) } : {}),
      ...(isColour(p.track) ? { track: str(p.track) } : {}),
    };
  }
  for (const key of ["tracker", "large"] as const) if (str(raw[key])) fill[key] = str(raw[key]);
  if (isColour(raw.color)) fill.color = str(raw.color);
  const acts = Array.isArray(raw.actions) ? raw.actions : [];
  type FillAction = NonNullable<NonNullable<NLookDesign["fill"]>["actions"]>[number];
  const kept: FillAction[] = acts.filter(isObj).slice(0, 3).flatMap((a): FillAction[] => {
    const label = str(a.label).slice(0, NLOOK_LIMITS.textChars);
    if (!label) return [];
    if (a.open !== undefined) {
      // A templated link is checked on the phone against the same allow-list; a literal one is checked here.
      const open = str(a.open);
      if (!open.includes(BIND_OPEN) && !isAllowedLink(open)) { issues.push({ at: "fill.actions", why: `a link opens only ${LINK_ALLOW.scheme}://` }); return []; }
      return [{ label, open }];
    }
    if (isObj(a.act) && str(a.act.item) && str(a.act.action)) return [{ label, act: { item: str(a.act.item), action: str(a.act.action) } }];
    return [];
  });
  if (acts.length > 3) issues.push({ at: "fill.actions", why: "at most 3 actions: the extras are dropped" });
  if (kept.length) fill.actions = kept;
  return fill;
}

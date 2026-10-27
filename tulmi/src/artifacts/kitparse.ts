/**
 * THE KIT'S READERS: HOW A PROJECT'S LOOK IS READ OUT OF ITS FILES, WITH NO MODEL.
 *
 * kit.ts decides which few files to read; this file turns each kind of file into design tokens (colours,
 * fonts, a radius, spacing, breakpoints) and nothing else. Every reader is a pure function of a file's text, so
 * each has a fixture in the tests, and none of them runs the project's code: a Tailwind config or a MUI theme is
 * READ by a small tolerant reader of JavaScript object literals (below), never evaluated.
 *
 *   CSS            variables in :root and .dark (also inside @layer and @media), Tailwind v4's @theme, @font-face
 *   Tailwind       theme.extend (or theme) colors, fontFamily, borderRadius, spacing, screens, darkMode
 *   shadcn         components.json: the style, the icon library, the CSS file the variables are in
 *   MUI / Chakra   createTheme / extendTheme: palette or colors, typography or fonts, shape or radii
 *   styled         a `theme` object with colors, fonts and radii
 *   Flutter        ThemeData and ColorScheme: Color(0xAARRGGBB), fromSeed, fontFamily, GoogleFonts, BorderRadius
 *   Android        res/values colors.xml and themes.xml (and the night ones), Compose's Color.kt
 *   iOS            Assets.xcassets *.colorset/Contents.json, with a dark appearance when there is one
 *   fonts          next/font/google, Google Fonts <link> and @import (Google addresses only), CSS font-family
 *   icons          the icon library the dependencies say is in use
 *
 * Nothing here reaches a network or a store.
 */

// ------------------------------------------------------------------ colours

const NAMED: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080",
  gray: "#808080", grey: "#808080", pink: "#ffc0cb", teal: "#008080", navy: "#000080", cyan: "#00ffff", magenta: "#ff00ff", brown: "#a52a2a",
};

const h2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const num = (s: string, scale = 255): number => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s / 100));
  const ll = Math.max(0, Math.min(1, l / 100));
  const k = (n: number) => (n + hh / 30) % 12;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${h2(f(0) * 255)}${h2(f(8) * 255)}${h2(f(4) * 255)}`;
}

function oklchToHex(L: number, C: number, hDeg: number): string {
  const a = C * Math.cos((hDeg * Math.PI) / 180);
  const b = C * Math.sin((hDeg * Math.PI) / 180);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
  const g = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };
  return `#${lin.map((v) => h2(g(v) * 255)).join("")}`;
}

/** A CSS colour as "#rrggbb" (or "#rrggbbaa" when it is not opaque), or null when it is not one this can read. */
export function colorToHex(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/\s*!important$/, "");
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(v))) {
    const x = m[1]!;
    if (x.length === 3 || x.length === 4) { const e = [...x].map((c) => c + c).join(""); return e.length === 8 && e.endsWith("ff") ? `#${e.slice(0, 6)}` : `#${e}`; }
    if (x.length === 6) return `#${x}`;
    if (x.length === 8) return x.endsWith("ff") ? `#${x.slice(0, 6)}` : `#${x}`;
    return null;
  }
  if ((m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v))) {
    const base = `#${h2(num(m[1]!))}${h2(num(m[2]!))}${h2(num(m[3]!))}`;
    const alpha = m[4] === undefined ? 1 : num(m[4], 1);
    return alpha >= 0.995 ? base : `${base}${h2(alpha * 255)}`;
  }
  if ((m = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v)) || (m = /^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%$/.exec(v))) {
    const base = hslToHex(parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!));
    const alpha = m[4] === undefined ? 1 : num(m[4], 1);
    return alpha >= 0.995 ? base : `${base}${h2(alpha * 255)}`;
  }
  if ((m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+(-?[\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(v))) {
    const base = oklchToHex(num(m[1]!, 1), m[2]!.endsWith("%") ? (parseFloat(m[2]!) / 100) * 0.4 : parseFloat(m[2]!), parseFloat(m[3]!));
    const alpha = m[4] === undefined ? 1 : num(m[4], 1);
    return alpha >= 0.995 ? base : `${base}${h2(alpha * 255)}`;
  }
  return NAMED[v] ?? null;
}

/** `var(--x)` replaced by its value from `vars`, up to three deep, so `hsl(var(--primary))` reads as a colour. */
export function resolveVars(value: string, vars: Readonly<Record<string, string>>): string {
  let out = value;
  for (let i = 0; i < 3 && /var\(/.test(out); i += 1) {
    out = out.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback?: string) => vars[name] ?? fallback ?? "");
  }
  return out.trim();
}

/** A colour value as hex, through variables. */
export const hexOf = (value: unknown, vars: Readonly<Record<string, string>> = {}): string | null =>
  typeof value === "string" ? colorToHex(resolveVars(value, vars)) : null;

// ------------------------------------------------------------------ tokens

export interface KitTokens {
  colors: Record<string, string>;
  dark: Record<string, string>;
  /** sans, serif, mono, heading, body and others by role. */
  fonts: Record<string, string>;
  radius: string | null;
  spacing: string | null;
  screens: Record<string, string>;
}

export const emptyTokens = (): KitTokens => ({ colors: {}, dark: {}, fonts: {}, radius: null, spacing: null, screens: {} });

/** Folds `from` into `into` without overwriting what is already set: readers are applied in order of trust. */
export function mergeTokens(into: KitTokens, from: Partial<KitTokens>): void {
  for (const k of ["colors", "dark", "fonts", "screens"] as const) for (const [n, v] of Object.entries(from[k] ?? {})) if (!(n in into[k])) into[k][n] = v;
  if (!into.radius && from.radius) into.radius = from.radius;
  if (!into.spacing && from.spacing) into.spacing = from.spacing;
}

/** The first family of a font stack, unquoted: `"Inter", system-ui, sans-serif` is Inter. Generic families and variables give null. */
export function firstFamily(stack: string): string | null {
  for (const part of stack.split(",")) {
    const f = part.trim().replace(/^["']|["']$/g, "").trim();
    if (!f || /^var\(/.test(f) || /^(?:ui-|-apple-system|blinkmacsystemfont|system-ui|sans-serif|serif|monospace|cursive|fantasy|inherit)/i.test(f)) continue;
    if (/^[\w .-]{1,60}$/.test(f)) return f;
  }
  return null;
}

// ------------------------------------------------------------------ a tolerant reader of JavaScript object literals

const UNRESOLVED = Symbol("unresolved");
type Lit = unknown;

/**
 * Reads a JavaScript object or array LITERAL from `src` at `at`, without running anything. Strings, numbers, booleans, null, nested
 * objects and arrays are kept; anything that needs running (a call, a variable, a spread, a function, a template with ${}) is dropped,
 * along with the property it was the value of. Comments, unquoted and quoted keys, trailing commas and `as const` are fine.
 */
export function readLiteral(src: string, at: number): Lit {
  let i = at;
  let budget = 40_000;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i += 1;
      if (src.startsWith("//", i)) { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl; continue; }
      if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
      return;
    }
  };
  const string = (q: string): string => {
    let out = "";
    i += 1;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      out += src[i]!;
      i += 1;
    }
    i += 1;
    return out;
  };
  /** Skips an expression that cannot be read, to the next top-level , } or ]. */
  const skip = () => {
    let depth = 0;
    while (i < src.length) {
      budget -= 1;
      if (budget < 0) throw new Error("too big");
      const c = src[i]!;
      if (c === '"' || c === "'" || c === "`") { string(c); continue; }
      if (c === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) { ws(); continue; }
      if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return; depth -= 1; }
      else if (c === "," && depth === 0) return;
      i += 1;
    }
  };
  const value = (depth: number): Lit => {
    budget -= 1;
    if (budget < 0 || depth > 12) throw new Error("too big");
    ws();
    const c = src[i];
    let out: Lit = UNRESOLVED;
    if (c === "{") {
      i += 1;
      const o: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (i >= src.length) break;
        if (src[i] === "}") { i += 1; break; }
        if (src[i] === ",") { i += 1; continue; }
        if (src.startsWith("...", i)) { i += 3; skip(); continue; }
        let key: string;
        if (src[i] === '"' || src[i] === "'") key = string(src[i]!);
        else if (src[i] === "[") { skip(); continue; }
        else {
          const m = /[\w$-]+/y;
          m.lastIndex = i;
          const k = m.exec(src);
          if (!k) { i += 1; continue; }
          key = k[0];
          i += key.length;
        }
        ws();
        if (src[i] === "(") {
          // A method: skip its parameters and its body.
          for (const [open, close] of [["(", ")"], ["{", "}"]] as const) {
            ws();
            if (src[i] !== open) break;
            let d = 0;
            do { if (src[i] === open) d += 1; else if (src[i] === close) d -= 1; i += 1; } while (d > 0 && i < src.length);
          }
          continue;
        }
        if (src[i] !== ":") { continue; }
        i += 1;
        const v = value(depth + 1);
        if (v !== UNRESOLVED) o[key] = v;
        ws();
        if (src[i] !== "," && src[i] !== "}") skip();
      }
      return o;
    }
    if (c === "[") {
      i += 1;
      const a: unknown[] = [];
      for (;;) {
        ws();
        if (i >= src.length) break;
        if (src[i] === "]") { i += 1; break; }
        if (src[i] === ",") { i += 1; continue; }
        const v = value(depth + 1);
        if (v !== UNRESOLVED) a.push(v);
        ws();
        if (src[i] !== "," && src[i] !== "]") skip();
      }
      return a;
    }
    if (c === '"' || c === "'") { out = string(c); }
    else if (c === "`") {
      const start = i;
      const s = string("`");
      out = src.slice(start, i).includes("${") ? UNRESOLVED : s;
    } else {
      const m = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy;
      m.lastIndex = i;
      const n = m.exec(src);
      if (n && !/[\w$]/.test(src[i + n[0].length] ?? "")) { i += n[0].length; out = Number(n[0]); }
      else {
        const w = /[A-Za-z_$][\w$]*/y;
        w.lastIndex = i;
        const id = w.exec(src);
        if (id && (id[0] === "true" || id[0] === "false" || id[0] === "null") && !/[\w$.(]/.test(src[i + id[0].length] ?? "")) { i += id[0].length; out = id[0] === "null" ? null : id[0] === "true"; }
      }
    }
    // Whatever follows the value that is not the end of it (a call, `as const`, an operator) makes it unreadable.
    const before = i;
    ws();
    if (src[i] !== "," && src[i] !== "}" && src[i] !== "]" && i < src.length) {
      skip();
      if (out !== UNRESOLVED && /^\s*(?:as|satisfies)\b/.test(src.slice(before, i + 1))) return out;
      return UNRESOLVED;
    }
    if (out === UNRESOLVED) return UNRESOLVED;
    return out;
  };
  try { return value(0); } catch { return UNRESOLVED; }
}

/** The object literal that follows the first match of any of `patterns` (the pattern ends just before the `{`), or null. */
export function objectAfter(src: string, patterns: readonly RegExp[]): Record<string, unknown> | null {
  for (const re of patterns) {
    const m = re.exec(src);
    if (!m) continue;
    const brace = src.indexOf("{", m.index + m[0].length - 1);
    if (brace < 0) continue;
    const v = readLiteral(src, brace);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ------------------------------------------------------------------ CSS

export interface CssRead {
  tokens: Partial<KitTokens>;
  /** Every variable in :root, and in the dark block, as written: the CSS the viewer gets. */
  rootVars: Record<string, string>;
  darkVars: Record<string, string>;
  /** Google Fonts stylesheet addresses from @import. */
  fontUrls: string[];
  /** @font-face rules whose sources are all Google's. */
  fontFaces: string[];
  /** Font families named by the body's font-family. */
  bodyFont: string | null;
}

export interface CssBlock { selector: string; body: string; at: string[] }

/** The rule blocks of a stylesheet, descending into @layer, @media, @supports and @container. */
export function cssBlocks(css: string, at: string[] = []): CssBlock[] {
  const text = at.length ? css : css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssBlock[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const head = text.slice(i, open);
    const selector = head.slice(Math.max(head.lastIndexOf(";"), head.lastIndexOf("}")) + 1).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      const c = text[j]!;
      if (c === '"' || c === "'") { const e = text.indexOf(c, j + 1); j = e < 0 ? text.length : e + 1; continue; }
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      j += 1;
    }
    const body = text.slice(open + 1, j - 1);
    if (/^@(?:media|layer|supports|container)\b/i.test(selector)) out.push(...cssBlocks(body, [...at, selector]));
    else out.push({ selector, body, at });
    i = j;
  }
  return out;
}

export function declarations(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of body.matchAll(/(--?[\w-]+)\s*:\s*((?:[^;{}"']|"[^"]*"|'[^']*')+?)\s*(?:;|$)/g)) out.push([m[1]!, m[2]!.trim()]);
  return out;
}

const GOOGLE_CSS = /^https:\/\/fonts\.googleapis\.com\/css2?\?[\w%+:;@,.=&~!*'()/-]{1,480}$/;
export const googleFontUrl = (u: string): string | null => {
  const url = u.trim().replace(/&amp;/g, "&");
  return GOOGLE_CSS.test(url) ? url : null;
};

const isDarkSelector = (sel: string, at: string[]): boolean =>
  /\.dark\b|\[data-theme\s*=\s*["']?dark["']?\]|\[data-mode\s*=\s*["']?dark["']?\]|\.dark-(?:mode|theme)\b|\[data-bs-theme\s*=\s*["']?dark["']?\]/.test(sel)
  || (at.some((a) => /prefers-color-scheme\s*:\s*dark/.test(a)) && /:root|html|body/.test(sel));
const isRootSelector = (sel: string): boolean => sel.split(",").some((s) => /^\s*(?::root|html|body|\*)\s*$/.test(s) || /^\s*html\s*,/.test(s));

export function readCss(css: string): CssRead {
  const rootVars: Record<string, string> = {};
  const darkVars: Record<string, string> = {};
  const fontUrls: string[] = [];
  const fontFaces: string[] = [];
  let bodyFont: string | null = null;
  const tokens: Partial<KitTokens> = { colors: {}, dark: {}, fonts: {}, screens: {} };
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?(https:\/\/fonts\.googleapis\.com\/[^"')\s]+)/gi)) {
    const u = googleFontUrl(m[1]!);
    if (u) fontUrls.push(u);
  }
  for (const b of cssBlocks(css)) {
    const sel = b.selector;
    if (/^@font-face\b/i.test(sel)) {
      const urls = [...b.body.matchAll(/url\(\s*["']?([^"')]+)/gi)].map((u) => u[1]!);
      if (urls.length && urls.every((u) => /^https:\/\/fonts\.gstatic\.com\//.test(u))) fontFaces.push(`@font-face{${b.body.replace(/\s+/g, " ").trim()}}`);
      continue;
    }
    if (/^@theme\b/i.test(sel)) {
      // Tailwind v4: --color-*, --font-*, --radius-*, --breakpoint-*, --spacing
      for (const [n, v] of declarations(b.body)) {
        if (n.startsWith("--color-")) { const h = colorToHex(resolveVars(v, rootVars)); if (h) tokens.colors![n.slice(8)] = h; }
        else if (n.startsWith("--font-")) { const f = firstFamily(v); if (f) tokens.fonts![n.slice(7)] = f; }
        else if (n === "--radius" || n === "--radius-md" || n === "--radius-lg") tokens.radius ??= v;
        else if (n.startsWith("--breakpoint-")) tokens.screens![n.slice(13)] = v;
        else if (n === "--spacing") tokens.spacing ??= v;
      }
      continue;
    }
    if (isDarkSelector(sel, b.at)) { for (const [n, v] of declarations(b.body)) if (n.startsWith("--")) darkVars[n.slice(2)] = v; continue; }
    if (isRootSelector(sel)) {
      for (const [n, v] of declarations(b.body)) {
        if (n.startsWith("--")) rootVars[n.slice(2)] = v;
        else if (n === "font-family" && /^\s*(?:html|body)\b/.test(sel)) bodyFont ??= firstFamily(v);
      }
    }
    if (/^\s*(?:html|body)\b/.test(sel) && !isRootSelector(sel)) {
      for (const [n, v] of declarations(b.body)) if (n === "font-family") bodyFont ??= firstFamily(v);
    }
  }
  // Colours, radius and fonts out of the variables.
  const take = (vars: Record<string, string>, into: Record<string, string>) => {
    for (const [n, v] of Object.entries(vars)) {
      const name = n.replace(/^(?:color|tw-color|clr|c)-/, "");
      const hex = colorToHex(resolveVars(v, vars));
      if (hex && !/^(?:radius|spacing|shadow|font|text|leading|tracking|z|duration)\b/.test(name)) into[name] = hex;
    }
  };
  take(rootVars, tokens.colors!);
  take(darkVars, tokens.dark!);
  for (const [n, v] of Object.entries(rootVars)) {
    if (/^(?:radius|border-radius|rounded)(?:-md|-lg|-base)?$/.test(n)) tokens.radius ??= resolveVars(v, rootVars);
    else if (/^font(?:-family)?-(sans|serif|mono|heading|body|display|base)$/.test(n)) {
      const f = firstFamily(v);
      if (f) tokens.fonts![n.replace(/^font(?:-family)?-/, "")] = f;
    } else if (/^(?:spacing|space|spacing-unit)$/.test(n)) tokens.spacing ??= v;
  }
  if (bodyFont) tokens.fonts!.body ??= bodyFont;
  return { tokens, rootVars, darkVars, fontUrls, fontFaces, bodyFont };
}

// ------------------------------------------------------------------ Tailwind

export interface TailwindRead {
  tokens: Partial<KitTokens>;
  /** The parts of the config the viewer's Tailwind needs, as plain JSON. */
  config: Record<string, unknown>;
}

function flattenColors(obj: Record<string, unknown>, vars: Readonly<Record<string, string>>, prefix = "", out: Record<string, string> = {}, depth = 0): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? (k === "DEFAULT" ? prefix : `${prefix}-${k}`) : k;
    if (typeof v === "string") { const h = hexOf(v, vars); if (h) out[name] = h; }
    else if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) flattenColors(v as Record<string, unknown>, vars, name, out, depth + 1);
  }
  return out;
}

export function readTailwind(src: string, vars: Readonly<Record<string, string>> = {}, fontVars: Readonly<Record<string, string>> = {}): TailwindRead | null {
  const cfg = objectAfter(src, [
    /module\.exports\s*=\s*(?:\w+\s*\(\s*)?\{/, /export\s+default\s+(?:\w+\s*\(\s*)?\{/, /(?:const|let|var)\s+\w+\s*(?::\s*[\w.<>]+)?\s*=\s*\{/,
  ]);
  if (!cfg) return null;
  const theme = asObj(cfg.theme);
  const ext = asObj(theme.extend);
  const pick = (k: string): Record<string, unknown> => ({ ...asObj(theme[k]), ...asObj(ext[k]) });
  const colors = flattenColors(pick("colors"), vars);
  const tokens: Partial<KitTokens> = { colors, fonts: {}, screens: {} };
  for (const [role, stack] of Object.entries(pick("fontFamily"))) {
    const joined = Array.isArray(stack) ? stack.filter((x) => typeof x === "string").join(", ") : asStr(stack) ?? "";
    const direct = firstFamily(joined);
    const viaVar = !direct ? /var\(--([\w-]+)\)/.exec(joined)?.[1] : undefined;
    const f = direct ?? (viaVar ? fontVars[viaVar] ?? firstFamily(vars[viaVar] ?? "") : null);
    if (f) tokens.fonts![role] = f;
  }
  const radii = pick("borderRadius");
  const r = asStr(radii.DEFAULT) ?? asStr(radii.lg) ?? asStr(radii.md) ?? asStr(radii.xl);
  if (r) tokens.radius = resolveVars(r, vars).replace(/calc\(([^)]*)\)/, "calc($1)") || r;
  const spacing = pick("spacing");
  const sp = asStr(spacing.DEFAULT) ?? asStr(spacing["1"]) ?? asStr(spacing.px);
  if (sp) tokens.spacing = sp;
  for (const [n, v] of Object.entries(pick("screens"))) if (typeof v === "string") tokens.screens![n] = v;
  const keep = (o: Record<string, unknown>) => (Object.keys(o).length ? o : undefined);
  const config: Record<string, unknown> = {
    ...(typeof cfg.darkMode === "string" || Array.isArray(cfg.darkMode) ? { darkMode: cfg.darkMode } : {}),
    theme: { extend: Object.fromEntries(Object.entries({
      colors: keep(pick("colors")), fontFamily: keep(pick("fontFamily")), borderRadius: keep(radii), spacing: keep(spacing), screens: keep(pick("screens")),
    }).filter(([, v]) => v !== undefined)) },
  };
  return { tokens, config };
}

// ------------------------------------------------------------------ shadcn

export interface ShadcnRead { style: string | null; baseColor: string | null; icons: string | null; css: string | null; ui: string | null }

export function readShadcn(json: string): ShadcnRead | null {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return null; }
  const o = asObj(v);
  if (!("tailwind" in o) && !("aliases" in o) && !("style" in o)) return null;
  const tw = asObj(o.tailwind);
  const al = asObj(o.aliases);
  return { style: asStr(o.style), baseColor: asStr(tw.baseColor), icons: asStr(o.iconLibrary), css: asStr(tw.css), ui: asStr(al.ui) ?? asStr(al.components) };
}

// ------------------------------------------------------------------ MUI, Chakra, styled

export type ThemeKind = "MUI" | "Chakra UI" | "styled-components" | "theme";

export function readJsTheme(src: string): { kind: ThemeKind; tokens: Partial<KitTokens> } | null {
  const mui = /@mui\/|createTheme\s*\(/.test(src);
  const chakra = /@chakra-ui\/|extendTheme\s*\(/.test(src) && /chakra/i.test(src);
  const obj = objectAfter(src, [
    /\b(?:createTheme|extendTheme|createMuiTheme)\s*\(\s*\{/, /(?:const|let|var)\s+(?:theme|lightTheme|baseTheme|defaultTheme|\w*Theme)\s*(?::\s*[\w.<>]+)?\s*=\s*\{/,
    /(?:const|let|var)\s+(?:colors|palette)\s*(?::\s*[\w.<>]+)?\s*=\s*\{/,
  ]);
  if (!obj) return null;
  const kind: ThemeKind = chakra ? "Chakra UI" : mui ? "MUI" : /styled-components|DefaultTheme/.test(src) ? "styled-components" : "theme";
  const tokens: Partial<KitTokens> = { colors: {}, dark: {}, fonts: {}, screens: {} };
  const palette = asObj(obj.palette);
  const scheme = (p: Record<string, unknown>, into: Record<string, string>) => {
    for (const k of ["primary", "secondary", "error", "warning", "info", "success"]) {
      const o = asObj(p[k]);
      const h = hexOf(o.main ?? o.DEFAULT ?? o["500"] ?? p[k]);
      if (h) into[k === "error" ? "destructive" : k] = h;
      const cf = hexOf(o.contrastText);
      if (cf) into[`${k === "error" ? "destructive" : k}-foreground`] = cf;
    }
    const bg = asObj(p.background);
    const bgd = hexOf(bg.default ?? bg.DEFAULT ?? (typeof p.background === "string" ? p.background : undefined));
    if (bgd) into.background = bgd;
    const paper = hexOf(bg.paper ?? bg.card);
    if (paper) into.card = paper;
    const tx = asObj(p.text);
    const fg = hexOf(tx.primary ?? (typeof p.text === "string" ? p.text : undefined) ?? p.foreground);
    if (fg) into.foreground = fg;
    const mute = hexOf(tx.secondary);
    if (mute) into["muted-foreground"] = mute;
  };
  scheme(palette, tokens.colors!);
  const schemes = asObj(obj.colorSchemes);
  if (Object.keys(schemes).length) {
    scheme(asObj(asObj(schemes.light).palette), tokens.colors!);
    scheme(asObj(asObj(schemes.dark).palette), tokens.dark!);
  }
  // Chakra and the styled-components kind: colors: { brand: { 500: "#..." }, primary: "#..." }
  const colorsObj = asObj(obj.colors);
  if (Object.keys(colorsObj).length) Object.assign(tokens.colors!, flattenColors(colorsObj, {}));
  if (Object.keys(asObj(obj.palette)).length === 0 && Object.keys(colorsObj).length === 0 && /(?:colors|palette)\s*(?::[^=]+)?=\s*\{/.test(src)) {
    Object.assign(tokens.colors!, flattenColors(obj, {}));
  }
  const typo = asObj(obj.typography);
  const fam = firstFamily(asStr(typo.fontFamily) ?? "");
  if (fam) tokens.fonts!.sans = fam;
  const fonts = asObj(obj.fonts);
  for (const [role, v] of Object.entries(fonts)) { const f = firstFamily(asStr(v) ?? ""); if (f) tokens.fonts![role === "heading" ? "heading" : role === "body" ? "body" : role] = f; }
  const shape = asObj(obj.shape);
  if (typeof shape.borderRadius === "number") tokens.radius = `${shape.borderRadius}px`;
  else if (asStr(shape.borderRadius)) tokens.radius = asStr(shape.borderRadius)!;
  const radii = asObj(obj.radii ?? obj.borderRadius ?? obj.radius);
  const rv = radii.md ?? radii.base ?? radii.DEFAULT ?? radii.lg;
  if (!tokens.radius && (typeof rv === "string" || typeof rv === "number")) tokens.radius = typeof rv === "number" ? `${rv}px` : rv;
  if (!tokens.radius && (typeof obj.radius === "string" || typeof obj.borderRadius === "string")) tokens.radius = String(obj.radius ?? obj.borderRadius);
  if (typeof obj.spacing === "number") tokens.spacing = `${obj.spacing}px`;
  const hasAny = Object.keys(tokens.colors!).length || Object.keys(tokens.dark!).length || Object.keys(tokens.fonts!).length || tokens.radius;
  return hasAny ? { kind, tokens } : null;
}

// ------------------------------------------------------------------ Flutter

const MATERIAL: Record<string, string> = {
  red: "#f44336", pink: "#e91e63", purple: "#9c27b0", deepPurple: "#673ab7", indigo: "#3f51b5", blue: "#2196f3", lightBlue: "#03a9f4", cyan: "#00bcd4",
  teal: "#009688", green: "#4caf50", lightGreen: "#8bc34a", lime: "#cddc39", yellow: "#ffeb3b", amber: "#ffc107", orange: "#ff9800", deepOrange: "#ff5722",
  brown: "#795548", grey: "#9e9e9e", blueGrey: "#607d8b", white: "#ffffff", black: "#000000",
};

/** `0xFF6750A4` (ARGB) as hex. */
export function argbToHex(argb: string): string {
  const x = argb.replace(/^0x/i, "").padStart(8, "0").toLowerCase();
  const a = x.slice(0, 2);
  return a === "ff" ? `#${x.slice(2)}` : `#${x.slice(2)}${a}`;
}

const camelWords = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export function readFlutter(src: string): { tokens: Partial<KitTokens>; fontUrls: string[] } | null {
  if (!/ThemeData|ColorScheme|Color\(0x|Colors\./.test(src)) return null;
  const tokens: Partial<KitTokens> = { colors: {}, dark: {}, fonts: {}, screens: {} };
  const colors = tokens.colors!;
  const dark = tokens.dark!;
  // static const Color primary = Color(0xFF...);   final kBrand = Color(0xFF...);
  for (const m of src.matchAll(/(?:static\s+)?(?:const|final)\s+(?:Color\s+)?(\w+)\s*=\s*(?:const\s+)?Color\(\s*(0x[0-9a-fA-F]{8})\s*\)/g)) colors[m[1]!.replace(/^k(?=[A-Z])/, "").replace(/^./, (c) => c.toLowerCase())] = argbToHex(m[2]!);
  // primary: Color(0xFF...), primary: const Color(0xFF...), surface: Colors.white, primary: Colors.blue
  const inDark = (idx: number): boolean => {
    const head = src.slice(Math.max(0, idx - 400), idx);
    const d = Math.max(head.lastIndexOf("dark"), head.lastIndexOf("Dark"), head.lastIndexOf("Brightness.dark"));
    const l = Math.max(head.lastIndexOf("light"), head.lastIndexOf("Light"), head.lastIndexOf("Brightness.light"));
    return d > l;
  };
  for (const m of src.matchAll(/\b(\w+)\s*:\s*(?:const\s+)?Color\(\s*(0x[0-9a-fA-F]{8})\s*\)/g)) {
    (inDark(m.index!) ? dark : colors)[m[1]!] = argbToHex(m[2]!);
  }
  for (const m of src.matchAll(/\b(\w+)\s*:\s*Colors\.(\w+)(?:\[(\d+)\])?/g)) {
    const hex = MATERIAL[m[2]!];
    if (hex && m[1] !== "colorSchemeSeed") (inDark(m.index!) ? dark : colors)[m[1]!] ??= hex;
  }
  const seed = /seedColor\s*:\s*(?:const\s+)?(?:Color\(\s*(0x[0-9a-fA-F]{8})\s*\)|Colors\.(\w+))/.exec(src);
  if (seed) { const h = seed[1] ? argbToHex(seed[1]) : MATERIAL[seed[2]!]; if (h) colors.primary ??= h; }
  const ff = /fontFamily\s*:\s*["']([^"']+)["']/.exec(src);
  if (ff) tokens.fonts!.sans = ff[1]!;
  const gf = /GoogleFonts\.(\w+?)(?:TextTheme)?\s*\(/.exec(src);
  const fontUrls: string[] = [];
  if (gf && !tokens.fonts!.sans) {
    const fam = camelWords(gf[1]!);
    tokens.fonts!.sans = fam;
    fontUrls.push(`https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, "+")}:wght@400;500;600;700&display=swap`);
  }
  const rad = /BorderRadius\.circular\(\s*([\d.]+)\s*\)/.exec(src) ?? /Radius\.circular\(\s*([\d.]+)\s*\)/.exec(src);
  if (rad) tokens.radius = `${rad[1]}px`;
  // Flutter's names for the roles the other readers name (a Color named scaffoldBackgroundColor is the background).
  const FLUTTER_NAMES: Record<string, string> = {
    scaffoldBackgroundColor: "background", primaryColor: "primary", onPrimary: "primary-foreground", onSecondary: "secondary-foreground", onSurface: "foreground",
    surface: "card", error: "destructive", onError: "destructive-foreground", tertiary: "accent",
  };
  for (const set of [colors, dark]) {
    for (const [from, to] of Object.entries(FLUTTER_NAMES)) {
      if (from in set && !(to in set)) set[to] = set[from]!;
      if (from in set) delete set[from];
    }
  }
  return Object.keys(colors).length || Object.keys(dark).length || tokens.fonts!.sans || tokens.radius ? { tokens, fontUrls } : null;
}

// ------------------------------------------------------------------ Android

export function readAndroidColors(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<color\s+name="([^"]+)"[^>]*>\s*(#[0-9a-fA-F]{3,8})\s*<\/color>/g)) {
    const raw = m[2]!.slice(1);
    // Android writes #AARRGGBB.
    const h = raw.length === 8 ? argbToHex(raw) : colorToHex(`#${raw}`);
    if (h) out[m[1]!] = h;
  }
  return out;
}

/** themes.xml: `<item name="colorPrimary">@color/purple_500</item>` resolved through colors.xml, to the names the other readers use. */
export function readAndroidThemes(xml: string, colors: Readonly<Record<string, string>>): Record<string, string> {
  const map: Record<string, string> = {
    colorPrimary: "primary", colorOnPrimary: "primary-foreground", colorSecondary: "secondary", colorOnSecondary: "secondary-foreground",
    colorSurface: "card", colorOnSurface: "card-foreground", colorError: "destructive", colorBackground: "background", colorOnBackground: "foreground",
    colorPrimaryVariant: "primary-dark", colorTertiary: "accent",
  };
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<item\s+name="(?:android:)?(\w+)"[^>]*>\s*([^<]+?)\s*<\/item>/g)) {
    const name = map[m[1]!];
    if (!name) continue;
    const v = m[2]!;
    const ref = /^@(?:color|android:color)\/([\w.]+)$/.exec(v);
    const hex = ref ? colors[ref[1]!] : colorToHex(v.startsWith("#") && v.length === 9 ? argbToHex(v.slice(1)) : v);
    if (hex) out[name] = hex;
  }
  return out;
}

/** Compose: `val Purple80 = Color(0xFFD0BCFF)` and `lightColorScheme(primary = Purple40, ...)`. */
export function readCompose(src: string): { colors: Record<string, string>; scheme: { light: Record<string, string>; dark: Record<string, string> } } {
  const colors: Record<string, string> = {};
  for (const m of src.matchAll(/val\s+(\w+)\s*=\s*Color\(\s*(0x[0-9a-fA-F]{8})\s*\)/g)) colors[m[1]!] = argbToHex(m[2]!);
  const scheme = { light: {} as Record<string, string>, dark: {} as Record<string, string> };
  for (const [fn, into] of [["lightColorScheme", scheme.light], ["darkColorScheme", scheme.dark]] as const) {
    const m = new RegExp(`${fn}\\s*\\(([^)]*)\\)`).exec(src);
    if (!m) continue;
    for (const p of m[1]!.matchAll(/(\w+)\s*=\s*(\w+)/g)) if (colors[p[2]!]) into[p[1]!.replace(/^on(?=[A-Z])/, "").replace(/^./, (c) => c.toLowerCase()) + (/^on[A-Z]/.test(p[1]!) ? "-foreground" : "")] = colors[p[2]!]!;
  }
  return { colors, scheme };
}

// ------------------------------------------------------------------ iOS

/** A colorset's Contents.json: the light colour, and the dark one when it has one. */
export function readColorset(json: string): { light?: string; dark?: string } | null {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return null; }
  const out: { light?: string; dark?: string } = {};
  for (const entry of Array.isArray(asObj(v).colors) ? (asObj(v).colors as unknown[]) : []) {
    const e = asObj(entry);
    const c = asObj(asObj(e.color).components);
    const comp = (k: string): number | null => {
      const raw = c[k];
      if (typeof raw === "number") return raw <= 1 && !Number.isInteger(raw) ? raw * 255 : raw;
      if (typeof raw !== "string") return null;
      if (/^0x/i.test(raw)) return parseInt(raw, 16);
      const n = parseFloat(raw);
      return Number.isFinite(n) ? (n <= 1 && /\./.test(raw) ? n * 255 : n) : null;
    };
    const r = comp("red"), g = comp("green"), b = comp("blue");
    if (r === null || g === null || b === null) continue;
    const a = comp("alpha");
    const hex = `#${h2(r)}${h2(g)}${h2(b)}${a !== null && a < 254 && a > 0 ? h2(a <= 1 ? a * 255 : a) : ""}`;
    const apps = Array.isArray(e.appearances) ? (e.appearances as unknown[]).map(asObj) : [];
    if (apps.some((x) => x.value === "dark")) out.dark ??= hex;
    else if (!apps.length) out.light ??= hex;
  }
  return out.light || out.dark ? out : null;
}

// ------------------------------------------------------------------ fonts and icons

export interface FontsRead { families: string[]; vars: Record<string, string>; urls: string[] }

/** Fonts a source file names: next/font/google imports (with their CSS variables), Google Fonts <link>s, and @import. */
export function readFonts(src: string): FontsRead {
  const out: FontsRead = { families: [], vars: {}, urls: [] };
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)) {
    for (const name of m[1]!.split(",")) {
      const n = name.trim().split(/\s+as\s+/)[0]!.trim();
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(n)) continue;
      const fam = n.replace(/_/g, " ");
      out.families.push(fam);
      const local = name.trim().split(/\s+as\s+/).pop()!;
      const call = new RegExp(`\\b${local}\\s*\\(\\s*\\{[^}]*?variable\\s*:\\s*["']--([\\w-]+)["']`).exec(src);
      if (call) out.vars[call[1]!] = fam;
    }
  }
  for (const m of src.matchAll(/href\s*=\s*["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/g)) {
    const u = googleFontUrl(m[1]!);
    if (u) out.urls.push(u);
  }
  for (const m of src.matchAll(/@import\s+(?:url\(\s*)?["']?(https:\/\/fonts\.googleapis\.com\/[^"')\s]+)/gi)) {
    const u = googleFontUrl(m[1]!);
    if (u) out.urls.push(u);
  }
  // The family names inside a Google Fonts address.
  for (const u of out.urls) for (const f of u.matchAll(/family=([^:&]+)/g)) out.families.push(decodeURIComponent(f[1]!.replace(/\+/g, " ")));
  out.families = [...new Set(out.families)];
  out.urls = [...new Set(out.urls)];
  return out;
}

/** The Google Fonts stylesheet for families. */
export function googleFontsUrl(families: readonly string[]): string | null {
  const f = families.filter((x) => /^[A-Za-z0-9 ]{2,40}$/.test(x)).slice(0, 4);
  return f.length ? `https://fonts.googleapis.com/css2?${f.map((x) => `family=${x.replace(/ /g, "+")}:wght@400;500;600;700`).join("&")}&display=swap` : null;
}

const ICON_LIBS: Array<[RegExp, string, boolean]> = [
  [/^lucide-react$/, "lucide-react", true], [/^lucide-(?:vue-next|svelte|react-native)$/, "lucide", false], [/^react-icons$/, "react-icons", false],
  [/^@heroicons\/react$/, "Heroicons", false], [/^@tabler\/icons-react$/, "Tabler Icons", false], [/^@phosphor-icons\/react$/, "Phosphor", false],
  [/^@mui\/icons-material$/, "Material icons", false], [/^@fortawesome\//, "Font Awesome", false], [/^@radix-ui\/react-icons$/, "Radix icons", false],
  [/^@expo\/vector-icons$/, "Expo vector icons", false], [/^react-native-vector-icons$/, "vector icons", false], [/^bootstrap-icons$/, "Bootstrap icons", false],
  [/^feather-icons$|^react-feather$/, "Feather", false], [/^remixicon$|^@remixicon\//, "Remix icons", false], [/^cupertino_icons$/, "Cupertino icons", false],
  [/^font_awesome_flutter$/, "Font Awesome", false], [/^phosphor_flutter$/, "Phosphor", false], [/^lucide_icons$/, "lucide", false],
];

/** The icon library in use, from dependency names: its name, and whether an artifact can import it. */
export function iconLibrary(deps: readonly string[]): { name: string; available: boolean } | null {
  for (const [re, name, available] of ICON_LIBS) if (deps.some((d) => re.test(d))) return { name, available };
  return null;
}

// ------------------------------------------------------------------ components

/** The props of a component, by name, out of its source: `interface ButtonProps {…}`, `type ButtonProps = {…}`, a destructured parameter, or a Flutter constructor. */
export function readProps(name: string, src: string): string[] {
  const props: string[] = [];
  const add = (p: string) => { if (/^[a-z_][\w]*$/i.test(p) && p !== "key" && p !== "ref" && p !== "children" && !props.includes(p)) props.push(p); };
  const iface = new RegExp(`(?:interface\\s+${name}Props|type\\s+${name}Props\\s*=|interface\\s+Props|type\\s+Props\\s*=)[^{]*\\{([^}]*)\\}`).exec(src);
  if (iface) for (const m of iface[1]!.matchAll(/(?:^|[;,\n])\s*(?:readonly\s+)?(\w+)\??\s*:/g)) add(m[1]!);
  if (!props.length) {
    // A function or an arrow (also inside memo or forwardRef) whose first parameter is a destructured object.
    const d = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(?:React\\.)?(?:memo\\(|forwardRef(?:<[^>]*>)?\\()?\\s*\\(\\s*)\\s*\\{([^}]*)\\}`).exec(src);
    if (d) for (const p of d[1]!.split(",")) add(p.trim().split(/[=:\s]/)[0]!);
  }
  if (!props.length) {
    const f = new RegExp(`\\b${name}\\s*\\(\\s*\\{([^}]*)\\}\\s*\\)`).exec(src);
    if (f) for (const m of f[1]!.matchAll(/(?:required\s+)?(?:this|super)\.(\w+)/g)) add(m[1]!);
  }
  return props.slice(0, 6);
}

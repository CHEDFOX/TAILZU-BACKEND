/**
 * Tailwind, only when it is wanted. The runtime (Tailwind's browser build, ~280 KB) is fetched when an artifact's classes
 * look like Tailwind utilities, or when the design kit says the project uses it, and never otherwise: its base styles
 * (preflight) would reset an artifact that styles itself.
 *
 * "Looks like Tailwind" is deliberately strict: three different utilities that only Tailwind has (`p-4`, `text-gray-600`,
 * `md:flex`, `rounded-lg`, `w-1/2`…). `flex` or `container` on their own prove nothing.
 */

const STRONG = [
  /^-?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|gap|gap-x|gap-y|space-x|space-y|inset|top|left|right|bottom|min-w|min-h|max-w|max-h|size|z)-(?:\d+(?:\.\d+)?|px|auto|full|screen|\[[^\]]+\]|\d+\/\d+|xs|sm|md|lg|xl|\dxl|min|max|fit|prose)$/,
  /^(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|accent|shadow)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black|transparent|current)(?:\/\d+)?$/,
  /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/,
  /^font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?$/,
  /^shadow-(?:sm|md|lg|xl|2xl|none|inner)$/,
  /^(?:items|justify|content|self)-(?:start|end|center|between|around|evenly|stretch|baseline)$/,
  /^grid-cols-\d+$/,
  /^(?:sm|md|lg|xl|2xl|dark|hover|focus|active|group-hover|disabled|focus-visible):\S+$/,
];

const CLASS_ATTR = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/g;
const CLASS_EXPR = /\bclassName\s*=\s*\{([^]{0,400})/g;
const QUOTED = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

export function looksLikeTailwind(source: string): boolean {
  const found = new Set<string>();
  const consider = (classes: string): void => {
    for (const tok of classes.split(/\s+/)) {
      if (tok && STRONG.some((re) => re.test(tok))) found.add(tok);
    }
  };
  for (const m of source.matchAll(CLASS_ATTR)) consider(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "");
  for (const m of source.matchAll(CLASS_EXPR)) {
    for (const q of m[1]!.matchAll(QUOTED)) consider(q[1] ?? q[2] ?? q[3] ?? "");
  }
  return found.size >= 3;
}

const NAME = /^[A-Za-z0-9_-]+$/;
const clean = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && !/[;{}<>\n\r\\]/.test(t) ? t : null;
};

/** `theme` section name → the Tailwind 4 theme variable namespace. */
const NAMESPACES: Record<string, string> = {
  colors: "color",
  fontFamily: "font",
  fontSize: "text",
  fontWeight: "font-weight",
  letterSpacing: "tracking",
  lineHeight: "leading",
  borderRadius: "radius",
  boxShadow: "shadow",
  dropShadow: "drop-shadow",
  screens: "breakpoint",
  maxWidth: "container",
  spacing: "spacing",
  blur: "blur",
  animation: "animate",
  transitionTimingFunction: "ease",
};

function emit(section: string, value: unknown, path: string[], out: string[]): void {
  const ns = NAMESPACES[section]!;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!NAME.test(k)) continue;
      emit(section, v, k === "DEFAULT" ? path : [...path, k], out);
    }
    return;
  }
  const name = [ns, ...path].join("-");
  if (path.length === 0 && section !== "colors" && section !== "boxShadow" && section !== "borderRadius") return;
  if (section === "fontFamily") {
    const list = Array.isArray(value) ? value : [value];
    const fams = list.map((f) => clean(f)).filter((f): f is string => !!f).map((f) => (/^[\w-]+$/.test(f) || f.includes(",") || f.startsWith('"') ? f : `"${f}"`));
    if (fams.length) out.push(`--${name}: ${fams.join(", ")};`);
    return;
  }
  if (section === "fontSize" && Array.isArray(value)) {
    const size = clean(value[0]);
    if (size) out.push(`--${name}: ${size};`);
    const meta = value[1];
    const lh = typeof meta === "string" || typeof meta === "number" ? clean(meta) : meta && typeof meta === "object" ? clean((meta as Record<string, unknown>).lineHeight) : null;
    if (size && lh) out.push(`--${name}--line-height: ${lh};`);
    return;
  }
  const v = Array.isArray(value) ? value.map(clean).filter(Boolean).join(", ") : clean(value);
  if (v) out.push(`--${name}: ${v};`);
}

/**
 * A (Tailwind 3 style) `tailwind.config` object → the CSS Tailwind 4's browser build reads: its default theme import, the
 * `dark` variant bound to the `.dark` class the viewer sets from the app's theme, and an `@theme` block made of
 * `theme` and `theme.extend` (colors, fonts, font sizes, spacing, radii, shadows, breakpoints…). Plugins, content and
 * safelist are ignored: the browser build scans the page itself.
 */
export function tailwindConfigToCss(config: Record<string, unknown> | undefined): string {
  const lines: string[] = [];
  const reset: string[] = [];
  const theme = config && typeof config === "object" ? (config.theme as Record<string, unknown> | undefined) : undefined;
  if (theme && typeof theme === "object") {
    const extend = theme.extend as Record<string, unknown> | undefined;
    for (const section of Object.keys(NAMESPACES)) {
      if (theme[section] !== undefined && section !== "extend") {
        if (section === "colors" || section === "fontFamily" || section === "boxShadow" || section === "borderRadius" || section === "screens") reset.push(`--${NAMESPACES[section]}-*: initial;`);
        emit(section, theme[section], [], lines);
      }
      if (extend && typeof extend === "object" && extend[section] !== undefined) emit(section, extend[section], [], lines);
    }
  }
  return ['@import "tailwindcss";', "@custom-variant dark (&:where(.dark, .dark *));", `@theme {\n${[...reset, ...lines].map((l) => "  " + l).join("\n")}\n}`].join("\n");
}

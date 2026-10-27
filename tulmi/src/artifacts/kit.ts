/**
 * PROJECT-STYLED ARTIFACTS: THE KIT, AND A COMPONENT SHOWN IN PLACE.
 *
 * "Make me a pricing card" is better when the card looks like the person's project: its colours, its fonts,
 * its radius, its Button. So an artifact can be made in the style of a project, from two things this file builds:
 *
 *   designKit(project)      what the project looks like, read from at most KIT_FILES_MAX (12) of its files, with no
 *                           model: Tailwind config and CSS variables, shadcn, a MUI, Chakra or styled theme,
 *                           Flutter's ThemeData, Android's colors.xml and themes.xml (and Compose's Color.kt),
 *                           iOS colour assets, the fonts (next/font, Google Fonts), the icon library, and a
 *                           catalog of the project's own UI components (names and props, from the project
 *                           brain's symbols under components/ or ui/). Two outputs:
 *                             css     a DesignKitCss for the viewer (protocol.ts): the project's own CSS
 *                                     variables, `--tz-*` aliases, Google font addresses, and the Tailwind config
 *                           prompt    at most 2,000 characters for a model: tokens, the component list, and "use
 *                                     these names, colours and radius"
 *                           It is kept per project and the head it was read at (artifact_kits), and read again only
 *                           when the brain's head has moved: a kit costs a few file reads, once per change.
 *   componentArtifact(...)  "make this component": locate() says where it would go in the project; the surrounding
 *                           section is read; and a react (or, for a project that is not React, html) artifact is made
 *                           in the project's style that recreates just enough of that section around the new part
 *                           that the person sees it in place. A sketch or a screenshot goes to the VISION tier first,
 *                           for a layout description, which then goes in with the request.
 *
 * WHAT IT NEVER DOES: read an env file or a key (isSecretPath), keep a file the secret scan flags, load a font or
 * a stylesheet from anywhere but Google Fonts, or run any of the project's code.
 *
 * Every dependency is injectable. Files come through `KitFiles` (the workspace, or the job's room).
 */
import type { GatewayDeps } from "../code/brain/gateway.js";
import { scanForSecrets } from "../code/policy.js";
import type { BrainHandle } from "../code/project/index.js";
import { baseName, isVendoredPath } from "../code/project/lang.js";
import type { Workspace } from "../code/projects.js";
import { locate, type LocateBrain, type Located } from "../code/work/locate.js";
import type { CallFn } from "../code/work/model.js";
import type { LiveFiles } from "../code/live/ports.js";
import {
  colorToHex, emptyTokens, googleFontsUrl, iconLibrary, mergeTokens, readAndroidColors, readAndroidThemes, readColorset, readCompose, readCss, readFlutter, readFonts, readJsTheme,
  readProps, readShadcn, readTailwind, type KitTokens,
} from "./kitparse.js";
import type { DesignKitCss } from "./protocol.js";
import type { ArtifactService } from "./service.js";
import type { ArtifactStore } from "./store.js";
import { CAP_PAISE, ArtifactError, type ArtifactType, type Change } from "./types.js";

// ------------------------------------------------------------------ numbers

/** The most files the kit reads. */
export const KIT_FILES_MAX = 12;
/** The model's kit. */
export const KIT_PROMPT_MAX = 2000;
/** The CSS the viewer gets. */
export const KIT_CSS_MAX = 12_000;
/** The Tailwind config the viewer gets, as JSON. */
export const KIT_TAILWIND_MAX = 8_000;
const FILE_CHARS = 200_000;
/** Component files looked at in the brain, and how many have their props read. */
const COMPONENT_FILES = 80;
const COMPONENTS_LISTED = 30;

// ------------------------------------------------------------------ shapes

export interface ComponentInfo { name: string; path: string; props: string[] }

export interface DesignKit {
  /** The project's head the kit was read at ("" when the project has no brain yet: then it is not cached). */
  headSha: string;
  /** What the look is made with: "Tailwind CSS", "shadcn/ui", "MUI", "Flutter"... */
  systems: string[];
  tokens: KitTokens;
  components: ComponentInfo[];
  icons: { name: string; available: boolean } | null;
  /** The files that were read, at most KIT_FILES_MAX. */
  sources: string[];
  /** The project's frameworks, from its brain. */
  frameworks: string[];
  css: DesignKitCss;
  /** At most KIT_PROMPT_MAX characters. */
  prompt: string;
}

/** The project's files: every path, and one file's text (null when it cannot be read). */
export interface KitFiles {
  paths(): Promise<string[]>;
  read(path: string): Promise<string | null>;
}

export type KitBrain = Pick<BrainHandle, "status" | "paths" | "file" | "deps">;

export interface KitDeps {
  store: Pick<ArtifactStore, "getKit" | "putKit">;
  files: KitFiles;
  /** The project brain, or none (a project that has not been read: the kit then has no component catalog and is not cached). */
  brain?: KitBrain | null;
}

// ------------------------------------------------------------------ the files a project's files come through

/** A workspace (code/projects.ts): the tree and GitHub's read, which keeps a file ten minutes. */
export function workspaceFiles(ws: Pick<Workspace, "read" | "tree">): KitFiles {
  return {
    async paths() {
      const t = await ws.tree();
      return t.entries.filter((e) => e.type === "blob").map((e) => e.path);
    },
    async read(path) {
      try { return (await ws.read(path)).text; } catch { return null; }
    },
  };
}

/** A job's room (code/live): reads come back numbered `12: text`, which is taken off. Its paths are the brain's, plus the few the glob finds. */
export function liveFiles(files: Pick<LiveFiles, "read" | "glob">, brain: Pick<BrainHandle, "paths"> | null): KitFiles {
  return {
    async paths() {
      const known = new Set(brain ? await brain.paths(5000).catch(() => []) : []);
      for (const g of ["**/tailwind.config.*", "**/components.json", "**/*.colorset/Contents.json", "**/res/values*/colors.xml", "**/res/values*/themes.xml"]) {
        const r = await files.glob(g).catch(() => null);
        if (r?.kind === "ok") for (const p of r.out.paths) known.add(p);
      }
      return [...known];
    },
    async read(path) {
      const r = await files.read(path, { offset: 1, limit: 600 }).catch(() => null);
      return r?.kind === "ok" ? r.out.text.split("\n").map((l) => l.replace(/^\s*\d+: ?/, "")).join("\n") : null;
    },
  };
}

// ------------------------------------------------------------------ which files

export type Role = "shadcn" | "tailwind" | "css" | "theme" | "layout" | "html" | "flutter" | "android-colors" | "android-themes" | "compose" | "ios" | "package";

export interface Picked { path: string; role: Role }

const CSS_NAMES = ["globals.css", "global.css", "index.css", "app.css", "main.css", "styles.css", "style.css", "variables.css", "theme.css", "tokens.css", "base.css"];
const depth = (p: string): number => p.split("/").length;

/** The files worth reading, best first within a role, roles in the order of how much they say; at most `max` in all. */
export function pickSources(paths: readonly string[], o: { max?: number; cssHint?: string | null; skip?: ReadonlySet<string>; wantPackage?: boolean } = {}): Picked[] {
  const max = o.max ?? KIT_FILES_MAX;
  const usable = paths.filter((p) => !isVendoredPath(p) && !/\.min\./.test(p) && !o.skip?.has(p));
  const best = (re: RegExp | ((p: string) => boolean), n: number, rank?: (p: string) => number): string[] =>
    usable.filter((p) => (typeof re === "function" ? re(p) : re.test(p)))
      .sort((a, b) => (rank ? rank(a) - rank(b) : 0) || depth(a) - depth(b) || a.length - b.length || (a < b ? -1 : 1)).slice(0, n);
  const out: Picked[] = [];
  const add = (role: Role, list: string[]) => { for (const path of list) if (!out.some((x) => x.path === path)) out.push({ path, role }); };

  add("shadcn", best(/(?:^|\/)components\.json$/, 1));
  add("tailwind", best(/(?:^|\/)tailwind\.config\.(?:[cm]?js|[cm]?ts)$/, 1));
  const hint = o.cssHint ? usable.find((p) => p === o.cssHint || p.endsWith(`/${o.cssHint!.replace(/^\.?\//, "")}`)) : undefined;
  const cssRank = (p: string): number => { const i = CSS_NAMES.indexOf(baseName(p).toLowerCase()); return i < 0 ? 99 : i; };
  add("css", [...(hint ? [hint] : []), ...best((p) => /\.css$/i.test(p) && CSS_NAMES.includes(baseName(p).toLowerCase()), 2, cssRank)].slice(0, 2));
  add("theme", best(/(?:^|\/)(?:theme|themes|tokens|design-tokens|colors?|palette)(?:\/index)?\.(?:[jt]sx?)$|(?:^|\/)theme\/[\w-]+\.[jt]sx?$/i, 2));
  add("layout", best(/(?:^|\/)(?:app\/layout|pages\/_app|pages\/_document|src\/main|main)\.(?:tsx|jsx|ts|js)$/, 1));
  add("html", best(/(?:^|\/)(?:public\/)?index\.html$/, 1));
  add("flutter", best(/(?:^|\/)lib\/.*(?:theme|colors?|palette)[^/]*\.dart$|(?:^|\/)lib\/main\.dart$/, 2, (p) => (/main\.dart$/.test(p) ? 1 : 0)));
  add("android-colors", best(/\/res\/values\/colors\.xml$/, 1));
  add("android-themes", [...best(/\/res\/values\/(?:themes|styles)\.xml$/, 1), ...best(/\/res\/values-night\/(?:themes|colors)\.xml$/, 1)]);
  add("compose", best(/\/ui\/theme\/(?:Color|Theme)\.kt$/, 2));
  add("ios", best(/\.xcassets\/(?!AppIcon)[^/]*\.colorset\/Contents\.json$/, 3));
  if (o.wantPackage) add("package", best(/^package\.json$/, 1));
  return out.slice(0, max);
}

// ------------------------------------------------------------------ building the kit

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const COLOR_ORDER = ["primary", "primary-foreground", "secondary", "accent", "background", "foreground", "card", "muted", "muted-foreground", "border", "input", "ring", "destructive", "success", "warning", "info"];

/** Colour names in the order a model should see them: the usual semantic ones first, then the rest by name. */
function orderedColors(c: Readonly<Record<string, string>>): Array<[string, string]> {
  const names = Object.keys(c);
  const first = COLOR_ORDER.filter((n) => n in c);
  return [...first, ...names.filter((n) => !first.includes(n)).sort()].map((n) => [n, c[n]!]);
}

/** Project variables that are safe to hand to the viewer: no url(), no import, no braces, short. */
function cssVars(vars: Readonly<Record<string, string>>): string[] {
  return Object.entries(vars).filter(([n, v]) => /^[\w-]{1,60}$/.test(n) && v.length <= 200 && !/url\(|@import|[{}<>]|expression\(/i.test(v)).slice(0, 120).map(([n, v]) => `--${n}: ${v};`);
}

export interface KitInput {
  headSha: string;
  name: string;
  files: KitFiles;
  deps?: readonly string[];
  frameworks?: readonly string[];
  /** The components the brain knows (name, path, rank), best first. */
  components?: ReadonlyArray<{ name: string; path: string }>;
}

/** Reads the files and makes the kit. No cache here (designKit). */
export async function buildKit(input: KitInput): Promise<DesignKit> {
  const all = (await input.files.paths()).filter((p) => typeof p === "string" && p.length < 400);
  let budget = KIT_FILES_MAX;
  const texts = new Map<string, string>();
  const read = async (path: string): Promise<string | null> => {
    if (budget <= 0) return null;
    budget -= 1;
    const t = await input.files.read(path).catch(() => null);
    if (t === null || typeof t !== "string") return null;
    const text = t.slice(0, FILE_CHARS);
    // A file that holds something that looks like a secret is not used, and not looked at again.
    if (scanForSecrets([{ path: baseName(path) || "file", content: text }]).length) return null;
    texts.set(path, text);
    return text;
  };

  // The shadcn file first: it says which CSS file the variables are in.
  const shadcnPath = pickSources(all, { max: 1 }).find((p) => p.role === "shadcn")?.path;
  const shadcn = shadcnPath ? readShadcn((await read(shadcnPath)) ?? "") : null;
  const picks = pickSources(all, { max: Math.max(0, budget), cssHint: shadcn?.css ?? null, skip: new Set(shadcnPath ? [shadcnPath] : []), wantPackage: !input.deps?.length });
  const roleOf = new Map<string, Role>();
  for (const p of picks) {
    if (p.role === "shadcn") continue;
    roleOf.set(p.path, p.role);
  }
  // Reserve a few reads for the components' props.
  const reserve = Math.min(4, input.components?.length ? 4 : 0);
  for (const p of picks) {
    if (budget <= reserve) break;
    await read(p.path);
  }

  const by = (role: Role) => [...texts.entries()].filter(([p]) => (role === "shadcn" ? p === shadcnPath : roleOf.get(p) === role));
  const tokens = emptyTokens();
  const systems: string[] = [];
  const sys = (s: string) => { if (!systems.includes(s)) systems.push(s); };
  const deps = [...(input.deps ?? [])];
  const rootVars: Record<string, string> = {};
  const darkVars: Record<string, string> = {};
  const fontUrls: string[] = [];
  const fontFaces: string[] = [];
  const fontFamilies: string[] = [];
  const fontVars: Record<string, string> = {};
  let tailwindConfig: Record<string, unknown> | null = null;

  // CSS first: its variables are what Tailwind's and the themes' references resolve through.
  for (const [, text] of by("css")) {
    const r = readCss(text);
    mergeTokens(tokens, r.tokens);
    for (const [n, v] of Object.entries(r.rootVars)) if (!(n in rootVars)) rootVars[n] = v;
    for (const [n, v] of Object.entries(r.darkVars)) if (!(n in darkVars)) darkVars[n] = v;
    fontUrls.push(...r.fontUrls);
    fontFaces.push(...r.fontFaces);
    if (Object.keys(r.rootVars).length || Object.keys(r.tokens.colors ?? {}).length) sys("CSS variables");
  }
  for (const [, text] of [...by("layout"), ...by("html")]) {
    const f = readFonts(text);
    fontFamilies.push(...f.families);
    Object.assign(fontVars, f.vars);
    fontUrls.push(...f.urls);
  }
  for (const [, text] of by("tailwind")) {
    const t = readTailwind(text, rootVars, fontVars);
    if (!t) continue;
    mergeTokens(tokens, t.tokens);
    tailwindConfig ??= t.config;
    sys("Tailwind CSS");
  }
  if (!tailwindConfig && (deps.includes("tailwindcss") || input.frameworks?.includes("Tailwind CSS") || Object.keys(rootVars).some((n) => /^color-/.test(n)))) {
    if (deps.includes("tailwindcss") || input.frameworks?.includes("Tailwind CSS")) sys("Tailwind CSS");
  }
  if (shadcn) sys("shadcn/ui");
  for (const [, text] of by("theme")) {
    const t = readJsTheme(text);
    if (!t) continue;
    mergeTokens(tokens, t.tokens);
    sys(t.kind === "theme" ? "a theme file" : t.kind);
  }
  for (const [, text] of by("flutter")) {
    const t = readFlutter(text);
    if (!t) continue;
    mergeTokens(tokens, t.tokens);
    fontUrls.push(...t.fontUrls);
    sys("Flutter");
  }
  const androidColors: Record<string, string> = {};
  for (const [, text] of by("android-colors")) Object.assign(androidColors, readAndroidColors(text));
  for (const [path, text] of by("android-themes")) {
    const t = readAndroidThemes(text, androidColors);
    if (Object.keys(t).length) { mergeTokens(tokens, /values-night/.test(path) ? { dark: t } : { colors: t }); sys("Android"); }
  }
  if (Object.keys(androidColors).length) { mergeTokens(tokens, { colors: androidColors }); sys("Android"); }
  for (const [, text] of by("compose")) {
    const c = readCompose(text);
    mergeTokens(tokens, { colors: Object.keys(c.scheme.light).length ? c.scheme.light : c.colors, dark: c.scheme.dark });
    if (Object.keys(c.colors).length) sys("Jetpack Compose");
  }
  for (const [path, text] of by("ios")) {
    const m = /([^/]+)\.colorset\/Contents\.json$/.exec(path);
    const c = m ? readColorset(text) : null;
    if (!m || !c) continue;
    const name = m[1]!.replace(/^./, (x) => x.toLowerCase());
    mergeTokens(tokens, { colors: c.light ? { [name]: c.light } : {}, dark: c.dark ? { [name]: c.dark } : {} });
    sys("iOS");
  }
  for (const [, text] of by("package")) {
    try { const j = JSON.parse(text) as { dependencies?: object; devDependencies?: object }; deps.push(...Object.keys({ ...j.dependencies, ...j.devDependencies })); } catch { /* not JSON */ }
  }
  // pubspec for Flutter icon packages is the brain's dependency list (input.deps) when it has one.
  const icons = iconLibrary(deps) ?? (shadcn?.icons ? { name: shadcn.icons === "lucide" ? "lucide-react" : shadcn.icons, available: shadcn.icons === "lucide" } : null);

  // Fonts the project names, as a Google address, when no stylesheet gave one.
  if (!tokens.fonts.sans && fontFamilies[0]) tokens.fonts.sans = fontFamilies[0];
  for (const [v, fam] of Object.entries(fontVars)) if (!Object.values(tokens.fonts).includes(fam)) tokens.fonts[v.replace(/^font-/, "")] ??= fam;
  const fonts = [...new Set(fontUrls)];
  if (!fonts.length && !fontFaces.length) {
    // Only families the project itself takes from Google (next/font/google, a Google Fonts <link>) are asked of Google: a family name from a
    // config or a stylesheet may be a font the project hosts or pays for, and one family Google does not know fails the whole stylesheet.
    const url = googleFontsUrl([...new Set(fontFamilies)]);
    if (url) fonts.push(url);
  }

  // Components: the brain's catalog, with props for the first few files the reserve allows.
  const components: ComponentInfo[] = [];
  const seen = new Set<string>();
  for (const c of input.components ?? []) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    components.push({ name: c.name, path: c.path, props: [] });
    if (components.length >= COMPONENTS_LISTED) break;
  }
  for (const c of components) {
    if (budget <= 0) break;
    if (c.props.length) continue;
    const text = texts.get(c.path) ?? (await read(c.path));
    if (text) c.props = readProps(c.name, text);
  }

  const css = buildCss({ rootVars, darkVars, tokens, fontFaces, fonts, tailwind: tailwindConfig });
  const kit: DesignKit = {
    headSha: input.headSha, systems, tokens, components, icons, sources: [...texts.keys()].slice(0, KIT_FILES_MAX), frameworks: [...(input.frameworks ?? [])].slice(0, 12), css, prompt: "",
  };
  kit.prompt = compactPrompt(kit, input.name);
  return kit;
}

/** The CSS for the viewer: the project's own variables, `--tz-*` aliases for the tokens, base element styles, fonts and the Tailwind config. */
export function buildCss(o: {
  rootVars: Readonly<Record<string, string>>; darkVars: Readonly<Record<string, string>>; tokens: KitTokens; fontFaces: readonly string[]; fonts: readonly string[]; tailwind: Record<string, unknown> | null;
}): DesignKitCss {
  const alias = (vars: Record<string, string>, colors: Readonly<Record<string, string>>) => {
    for (const [n, v] of Object.entries(colors)) if (/^[\w-]{1,40}$/.test(n)) vars[`tz-${n}`] = v;
  };
  const root: Record<string, string> = {};
  alias(root, o.tokens.colors);
  if (o.tokens.radius) root["tz-radius"] = o.tokens.radius;
  if (o.tokens.spacing) root["tz-spacing"] = o.tokens.spacing;
  for (const [role, f] of Object.entries(o.tokens.fonts)) if (/^[\w-]{1,20}$/.test(role)) root[`tz-font-${role}`] = `"${f}"`;
  const dark: Record<string, string> = {};
  alias(dark, o.tokens.dark);
  const mine = cssVars(o.rootVars);
  const mineDark = cssVars(o.darkVars);
  const sans = o.tokens.fonts.sans ?? o.tokens.fonts.body;
  const lines = [
    ...o.fontFaces,
    `:root {\n${[...mine, ...Object.entries(root).map(([n, v]) => `--${n}: ${v};`)].map((l) => `  ${l}`).join("\n")}\n}`,
    ...(mineDark.length || Object.keys(dark).length ? [`.dark, [data-theme="dark"] {\n${[...mineDark, ...Object.entries(dark).map(([n, v]) => `--${n}: ${v};`)].map((l) => `  ${l}`).join("\n")}\n}`] : []),
    `body { margin: 0;${sans ? ` font-family: var(--tz-font-sans, ${JSON.stringify(sans)}), system-ui, sans-serif;` : ""}${o.tokens.colors.foreground ? " color: var(--tz-foreground);" : ""}${o.tokens.colors.background ? " background: var(--tz-background);" : ""} }`,
  ];
  let css = lines.join("\n");
  if (css.length > KIT_CSS_MAX) css = cut(css, KIT_CSS_MAX);
  // Nothing in the kit's CSS may hold a secret or point at the network.
  if (scanForSecrets([{ path: "kit.css", content: css }]).length) css = "";
  const out: DesignKitCss = { css, ...(o.fonts.length ? { fonts: [...o.fonts].slice(0, 4) } : {}) };
  if (o.tailwind) {
    const json = JSON.stringify(o.tailwind);
    if (json.length <= KIT_TAILWIND_MAX) out.tailwind = { config: o.tailwind };
    else {
      // Over the cap: drop the biggest part (spacing, then screens), keep the colours.
      const t = JSON.parse(json) as { theme?: { extend?: Record<string, unknown> } };
      for (const k of ["spacing", "screens", "borderRadius"]) { if (t.theme?.extend) delete t.theme.extend[k]; if (JSON.stringify(t).length <= KIT_TAILWIND_MAX) break; }
      if (JSON.stringify(t).length <= KIT_TAILWIND_MAX) out.tailwind = { config: t as Record<string, unknown> };
    }
  }
  return out;
}

/** The kit for a model, at most KIT_PROMPT_MAX characters: tokens, the component list, and what to do with them. */
export function compactPrompt(kit: Pick<DesignKit, "systems" | "tokens" | "components" | "icons">, name: string): string {
  const t = kit.tokens;
  const colors = orderedColors(t.colors);
  const darkOrdered = orderedColors(t.dark).filter(([n]) => ["background", "foreground", "primary", "card"].includes(n));
  const tw = kit.systems.includes("Tailwind CSS");
  const build = (nColors: number, nComponents: number, extras: boolean): string => {
    const lines: string[] = [];
    lines.push(`${name || "This project"}${kit.systems.length ? ` (${kit.systems.slice(0, 4).join(", ")})` : ""}. Use these names, colours and radius.`);
    if (colors.length) lines.push(`colors: ${colors.slice(0, nColors).map(([n, v]) => `${n} ${v}`).join(", ")}`);
    if (darkOrdered.length) lines.push(`dark: ${darkOrdered.map(([n, v]) => `${n} ${v}`).join(", ")}`);
    const fonts = Object.entries(t.fonts).slice(0, 4).map(([r, f]) => `${r} ${f}`);
    if (fonts.length) lines.push(`fonts: ${fonts.join(", ")}`);
    if (t.radius) lines.push(`radius: ${t.radius}`);
    if (extras && t.spacing) lines.push(`spacing: ${t.spacing}`);
    if (extras && Object.keys(t.screens).length) lines.push(`screens: ${Object.entries(t.screens).slice(0, 5).map(([n, v]) => `${n} ${v}`).join(", ")}`);
    if (kit.icons) lines.push(`icons: ${kit.icons.name}${kit.icons.available ? " (import it)" : " (not available here: use lucide-react or inline SVG that looks like it)"}`);
    if (kit.components.length && nComponents > 0) {
      lines.push(`components: ${kit.components.slice(0, nComponents).map((c) => (c.props.length ? `${c.name}(${c.props.join(",")})` : c.name)).join(" ")}`);
    }
    lines.push(`Rules: the colours above are the project's, by name; keep the radius; name its components when they fit${tw ? "; use Tailwind classes (bg-primary, text-muted-foreground, rounded-lg) where the names above match" : ""}.`);
    return lines.join("\n");
  };
  // Trim in order of how little each part is worth until it fits.
  const tries: Array<[number, number, boolean]> = [[16, 20, true], [14, 16, true], [12, 12, false], [10, 8, false], [8, 5, false], [6, 3, false]];
  for (const [c, k, e] of tries) {
    const p = build(c, k, e);
    if (p.length <= KIT_PROMPT_MAX) return p;
  }
  return cut(build(4, 0, false), KIT_PROMPT_MAX);
}

// ------------------------------------------------------------------ the brain's component catalog

const COMPONENT_DIR = /(?:^|\/)(?:components?|ui|widgets?|design-system|shared\/ui)\//i;
const COMPONENT_EXT = /\.(?:tsx|jsx|vue|svelte|dart|kt|swift)$/;
const PASCAL = /^[A-Z][A-Za-z0-9]{1,40}$/;

/** The project's UI components from its brain: exported component-like symbols in files under components/ or ui/, most central first. */
export async function brainComponents(brain: Pick<BrainHandle, "paths" | "file">): Promise<Array<{ name: string; path: string }>> {
  const paths = (await brain.paths(5000).catch(() => [] as string[]))
    .filter((p) => COMPONENT_DIR.test(p) && COMPONENT_EXT.test(p) && !/\.(?:test|spec|stories)\.|__tests__|\/tests?\//i.test(p));
  const rows = (await Promise.all(paths.slice(0, COMPONENT_FILES * 3).map((p) => brain.file(p).catch(() => null)))).filter((r): r is NonNullable<typeof r> => !!r);
  rows.sort((a, b) => b.rank - a.rank || (a.path < b.path ? -1 : 1));
  const out: Array<{ name: string; path: string }> = [];
  for (const f of rows.slice(0, COMPONENT_FILES)) {
    const syms = f.symbols.filter((s) => (s.kind === "component" || s.kind === "class" || s.kind === "function" || s.kind === "const") && s.exported !== false);
    let named = syms.filter((s) => PASCAL.test(s.name) && (s.kind === "component" || f.lang === "TypeScript" || f.lang === "JavaScript" || f.lang === "Dart" || f.lang === "Vue" || f.lang === "Svelte"));
    // `export default function () {}` has no name of its own: the file's name is the component's.
    if (!named.length && syms.some((s) => s.name === "default")) {
      const base = baseName(f.path).replace(/\.[^.]+$/, "");
      if (PASCAL.test(base)) named = [{ name: base, kind: "component", line: 1 }];
      else if (/^[a-z][a-z0-9-]*$/.test(base) && base !== "index") named = [{ name: base.replace(/(^|-)(\w)/g, (_m, _a, c: string) => c.toUpperCase()), kind: "component", line: 1 }];
    }
    for (const s of named.slice(0, 3)) out.push({ name: s.name, path: f.path });
  }
  return out;
}

// ------------------------------------------------------------------ designKit

export interface KitProject { id: string; userId: string; name?: string }

/**
 * The project's kit: from the cache when the brain's head is where the cached one was read; else read afresh and kept.
 * A project with no brain yet has no head: its kit is made and returned but not kept.
 */
export async function designKit(deps: KitDeps, project: KitProject, o: { force?: boolean } = {}): Promise<{ kit: DesignKit; cached: boolean }> {
  const status = deps.brain ? await deps.brain.status().catch(() => null) : null;
  const head = status && status.status !== "none" ? status.headSha : "";
  if (head && !o.force) {
    const hit = await deps.store.getKit(project.id).catch(() => null);
    if (hit && hit.headSha === head && hit.kit && typeof (hit.kit as DesignKit).prompt === "string") return { kit: hit.kit as DesignKit, cached: true };
  }
  const brainDeps = deps.brain ? await deps.brain.deps().catch(() => []) : [];
  const kit = await buildKit({
    headSha: head, name: project.name ?? "", files: deps.files, deps: brainDeps.filter((d) => d.ecosystem === "npm" || /icons|awesome|phosphor|lucide|flutter/.test(d.name)).map((d) => d.name),
    frameworks: status?.structure?.frameworks ?? [], components: deps.brain ? await brainComponents(deps.brain) : [],
  });
  if (head) await deps.store.putKit(project.id, project.userId, head, kit).catch(() => undefined);
  return { kit, cached: false };
}

// ------------------------------------------------------------------ componentArtifact

const VISION_SYSTEM = [
  "You describe a sketch or a screenshot of a screen, or of a part of one, for a developer who will build it. Describe the LAYOUT from top to bottom: each section, how it is arranged (rows, columns, a grid, a stack), what each element is (heading, button, input, card, image, list...), the visible words, relative sizes, any colours you can see, and what looks interactive.",
  "At most 250 words. Plain prose, no code. If the picture is not a screen or a sketch of one, say so in one line.",
].join("\n");

export interface ComponentDeps {
  service: ArtifactService;
  kit: KitDeps;
  brain: KitBrain & LocateBrain;
  call?: CallFn;
  gateway?: GatewayDeps;
}

export interface ComponentResult {
  change: Change;
  type: ArtifactType;
  located: Pick<Located, "targets" | "confidence" | "question" | "related">;
  kit: { headSha: string; cached: boolean; chars: number; systems: string[] };
  /** The vision tier's description of the picture, when one was given. */
  layout?: string;
  /** What the pieces cost: the picture, the search, the making. */
  paise: { vision: number; locate: number; make: number };
}

const REACT_FRAMEWORKS = ["React", "Next.js", "Remix", "Gatsby", "Preact", "React Native", "Expo"];

/** The part of a file around where the evidence points, numbered, for the model to recreate. */
function surroundingOf(text: string, lines?: [number, number]): string {
  const all = text.split("\n");
  const from = lines ? Math.max(1, lines[0] - 25) : 1;
  const to = Math.min(all.length, lines ? lines[1] + 25 : 90);
  const body = all.slice(from - 1, to).map((l, i) => `${from + i}: ${l.length > 200 ? `${l.slice(0, 199)}…` : l}`).join("\n");
  return cut(body, 3500);
}

/**
 * Makes a component artifact for a request, in a project's style and in place. `image` is a data URL of a sketch or a screenshot.
 * Throws the service's ArtifactError for what the person should hear (the request, the model, the money).
 */
export async function componentArtifact(
  d: ComponentDeps, project: KitProject, request: string, o: { image?: string; signal?: AbortSignal } = {},
): Promise<ComponentResult> {
  const userId = project.userId;
  const ask = typeof request === "string" ? request.trim() : "";
  if (ask.length < 3) throw new ArtifactError("bad_request", "Say what the component is.");
  const paise = { vision: 0, locate: 0, make: 0 };

  // The picture first: a layout in words is what the search and the maker work from.
  let layout: string | undefined;
  if (o.image) {
    try {
      const seen = await d.service.model.run<string>({
        userId, tier: "vision", purpose: "artifact.vision", system: VISION_SYSTEM, artifact: "<picture/>", instruction: "Describe this screen's layout.",
        image: o.image, maxTokens: 700, capPaise: CAP_PAISE.vision, noClimb: true, ...(o.signal ? { signal: o.signal } : {}),
        accept: (t) => (t.trim() ? { ok: true, value: cut(t.trim(), 1800) } : { ok: false, reason: "the description is empty" }),
      });
      layout = seen.value;
      paise.vision = seen.paise;
    } catch (err) {
      if (!(err instanceof ArtifactError) || err.code === "limit_reached") throw err;
      // The picture could not be read: go on with the words.
    }
  }
  const words = layout ? `${ask}\n\nThe person's sketch, described: ${layout}` : ask;

  const { kit, cached } = await designKit(d.kit, project);
  const located = await locate(words, d.brain, {
    model: { userId, budget: { maxPaise: 100 }, ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), ...(o.signal ? { signal: o.signal } : {}) },
    read: (p) => d.kit.files.read(p),
  });
  paise.locate = located.used.paise;
  const top = located.targets[0];
  let surroundings = "";
  if (top) {
    const text = await d.kit.files.read(top.path).catch(() => null);
    if (text) surroundings = `${top.path}\n${surroundingOf(text, top.lines)}`;
  }

  const type: ArtifactType = kit.frameworks.some((f) => REACT_FRAMEWORKS.includes(f)) ? "react" : "html";
  const sure = located.confidence >= 0.45;
  const where = top
    ? sure ? `It goes in ${top.path} (${cut(top.why, 120)}).` : `It probably goes in ${top.path} (${cut(top.why, 120)}), but that is not certain: show it there, in the style of the project.`
    : "No place in the project stood out, so make it stand alone in the project's style.";
  const made = await d.service.generate(userId, {
    request: `${words}\n\n${where}`, type, projectId: project.id, kit: kit.prompt, ...(surroundings ? { context: surroundings } : {}),
    title: cut(ask.replace(/\s+/g, " "), 60), note: `Component: ${cut(ask, 80)}`, ...(o.signal ? { signal: o.signal } : {}),
  });
  paise.make = made.paise;
  return {
    change: made, type,
    located: { targets: located.targets, confidence: located.confidence, related: located.related, ...(located.question ? { question: located.question } : {}) },
    kit: { headSha: kit.headSha, cached, chars: kit.prompt.length, systems: kit.systems },
    ...(layout ? { layout } : {}), paise,
  };
}

// Kept for tests and the docs: a colour in the form the kit prints.
export { colorToHex };

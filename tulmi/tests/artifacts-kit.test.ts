/**
 * The project kit (src/artifacts/kit.ts, kitparse.ts): a project's look read out of at most 12 of its files with no model, for the viewer (css)
 * and for a model (at most 2,000 characters), cached per project and head; and a component artifact made in the project's style, in place,
 * from locate() and the kit, with a picture described by the vision tier first.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { buildKit, designKit, brainComponents, pickSources, compactPrompt, buildCss, componentArtifact, workspaceFiles, liveFiles, KIT_FILES_MAX, KIT_PROMPT_MAX } = await import("../src/artifacts/kit.js");
const P = await import("../src/artifacts/kitparse.js");
const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
const { rig, FAKE_STRIPE } = await import("./artifacts-rig.js");
const { fixtureBrain, sym, text } = await import("./work-fixtures.js");

/** KitFiles over a map of path to text, counting reads. */
function files(map: Record<string, string>) {
  const reads: string[] = [];
  return { reads, paths: async () => Object.keys(map), read: async (p: string) => { reads.push(p); return map[p] ?? null; } };
}
const kitOf = (map: Record<string, string>, o: { deps?: string[]; frameworks?: string[]; components?: Array<{ name: string; path: string }> } = {}) =>
  buildKit({ headSha: "h1", name: "acme", files: files(map), deps: o.deps ?? [], frameworks: o.frameworks ?? [], components: o.components ?? [] });

// ---------------------------------------------------------------- the fixtures

const SHADCN_CSS = `@tailwind base;
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 262 83% 58%;
    --primary-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 263 70% 70%;
  }
}
body { font-family: "Inter", system-ui, sans-serif; }`;

const TAILWIND = `import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        brand: { 500: "#7c3aed", 600: '#6d28d9' },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)" },
      fontFamily: { sans: ["var(--font-inter)", ...fontFamily.sans], mono: ['"Geist Mono"', "monospace"] },
      screens: { sm: "640px", md: "768px", "2xl": "1400px" },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
export default config;`;

const WEB: Record<string, string> = {
  "components.json": JSON.stringify({ style: "new-york", tailwind: { baseColor: "slate", cssVariables: true, css: "src/app/globals.css", config: "tailwind.config.ts" }, aliases: { ui: "@/components/ui" }, iconLibrary: "lucide" }),
  "tailwind.config.ts": TAILWIND,
  "src/app/globals.css": SHADCN_CSS,
  "src/app/layout.tsx": `import { Inter, Roboto_Mono } from "next/font/google";\nconst inter = Inter({ subsets: ["latin"], variable: "--font-inter" });\nexport default function Layout() { return null; }`,
  "src/components/ui/button.tsx": `export interface ButtonProps { variant?: "default" | "outline"; size?: "sm" | "lg"; asChild?: boolean }\nexport function Button({ variant, size }: ButtonProps) { return null; }`,
  "src/components/ui/card.tsx": `export function Card({ title, footer }: { title: string; footer?: string }) { return null; }`,
};

describe("colours", () => {
  it("reads hex, rgb, hsl (also bare, as shadcn writes it), oklch and names, with alpha kept only when there is some", () => {
    expect(P.colorToHex("#abc")).toBe("#aabbcc");
    expect(P.colorToHex("#AABBCCFF")).toBe("#aabbcc");
    expect(P.colorToHex("#11223380")).toBe("#11223380");
    expect(P.colorToHex("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(P.colorToHex("rgb(0 0 0 / 50%)")).toBe("#00000080");
    expect(P.colorToHex("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(P.colorToHex("hsl(120 100% 25%)")).toBe("#008000");
    expect(P.colorToHex("222.2 84% 4.9%")).toBe("#020817");
    expect(P.colorToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(P.colorToHex("oklch(0 0 0)")).toBe("#000000");
    expect(P.colorToHex("oklch(0.205 0 0)")).toMatch(/^#1[5-9a-f]1[5-9a-f]1[5-9a-f]$/);
    expect(P.colorToHex("white")).toBe("#ffffff");
    for (const no of ["0.5rem", "transparent", "var(--x)", "12px", ""]) expect(P.colorToHex(no), no).toBeNull();
    expect(P.hexOf("hsl(var(--primary))", { primary: "262 83% 58%" })).toBe("#7c3bed");
    expect(P.argbToHex("0xFF6750A4")).toBe("#6750a4");
    expect(P.argbToHex("0x806750A4")).toBe("#6750a480");
  });
});

describe("the reader of object literals", () => {
  it("keeps what is plain and drops what needs running, with comments, quoted keys and trailing commas", () => {
    const src = `module.exports = {
      // a comment
      a: 1, 'b-c': "two", "d": [1, 'x', { e: true },],
      f: require("x"), g: someVar, h: fn(1, 2), i: \`t\${x}\`, j: \`plain\`, k: 3 * 4, ...spread,
      method() { return { not: "this" }; },
      l: { m: null, } as const,
    }`;
    expect(P.objectAfter(src, [/module\.exports\s*=\s*\{/])).toEqual({ a: 1, "b-c": "two", d: [1, "x", { e: true }], j: "plain", l: { m: null } });
  });

  it("finds a config under `export default`, `defineConfig(` or a named const", () => {
    expect(P.objectAfter("export default { x: 1 }", [/export\s+default\s+(?:\w+\s*\(\s*)?\{/])).toEqual({ x: 1 });
    expect(P.objectAfter("export default defineConfig({ x: 2 })", [/export\s+default\s+(?:\w+\s*\(\s*)?\{/])).toEqual({ x: 2 });
    expect(P.objectAfter("nothing here", [/export default \{/])).toBeNull();
  });
});

describe("Tailwind with shadcn and CSS variables", () => {
  it("reads the colours through the variables, the dark scheme, fonts, radius and screens, and names what the look is made with", async () => {
    const kit = await kitOf(WEB, { deps: ["next", "react", "tailwindcss", "lucide-react"], frameworks: ["Next.js", "React", "Tailwind CSS"] });
    expect(kit.tokens.colors).toMatchObject({ background: "#ffffff", foreground: "#020817", primary: "#7c3bed", "primary-foreground": "#f8fafc", border: "#e2e8f0", "brand-500": "#7c3aed", "brand-600": "#6d28d9" });
    expect(kit.tokens.dark).toMatchObject({ background: "#020817", foreground: "#f8fafc" });
    expect(kit.tokens.fonts).toMatchObject({ sans: "Inter", mono: "Geist Mono" });
    expect(kit.tokens.radius).toBe("0.5rem");
    expect(kit.tokens.screens).toEqual({ sm: "640px", md: "768px", "2xl": "1400px" });
    expect(kit.systems).toEqual(["CSS variables", "Tailwind CSS", "shadcn/ui"]);
    expect(kit.icons).toEqual({ name: "lucide-react", available: true });
  });

  it("gives the viewer the project's own variables, aliases for the tokens, base styles, the Google font and the Tailwind config", async () => {
    const kit = await kitOf(WEB, { deps: ["tailwindcss"], frameworks: ["Tailwind CSS"] });
    expect(kit.css.css).toContain(":root {");
    expect(kit.css.css).toContain("--primary: 262 83% 58%;");
    expect(kit.css.css).toContain("--tz-primary: #7c3bed;");
    expect(kit.css.css).toContain("--tz-radius: 0.5rem;");
    expect(kit.css.css).toMatch(/\.dark, \[data-theme="dark"\] \{[\s\S]*--tz-background: #020817;/);
    expect(kit.css.css).toMatch(/body \{ margin: 0; font-family: var\(--tz-font-sans, "Inter"\)/);
    expect(kit.css.fonts).toEqual(["https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;600;700&display=swap"]);
    expect(kit.css.tailwind!.config).toMatchObject({ darkMode: ["class"], theme: { extend: { colors: { primary: { DEFAULT: "hsl(var(--primary))" } }, screens: { md: "768px" } } } });
    expect(JSON.stringify(kit.css.tailwind)).not.toContain("require");
  });

  it("makes a prompt of at most 2,000 characters with the tokens, the components by name and props, and the rule to use them", async () => {
    const kit = await kitOf(WEB, {
      deps: ["tailwindcss", "lucide-react"], frameworks: ["Tailwind CSS"],
      components: [{ name: "Button", path: "src/components/ui/button.tsx" }, { name: "Card", path: "src/components/ui/card.tsx" }],
    });
    expect(kit.prompt.length).toBeLessThanOrEqual(KIT_PROMPT_MAX);
    expect(kit.prompt).toMatch(/^acme \(CSS variables, Tailwind CSS, shadcn\/ui\)\. Use these names, colours and radius\./);
    expect(kit.prompt).toContain("colors: primary #7c3bed, primary-foreground #f8fafc, background #ffffff");
    expect(kit.prompt).toContain("dark: primary #a67de8, background #020817, foreground #f8fafc");
    expect(kit.prompt).toContain("fonts: sans Inter, mono Geist Mono");
    expect(kit.prompt).toContain("radius: 0.5rem");
    expect(kit.prompt).toContain("icons: lucide-react (import it)");
    expect(kit.prompt).toContain("components: Button(variant,size,asChild) Card(title,footer)");
    expect(kit.prompt).toMatch(/Rules: .*keep the radius.*use Tailwind classes \(bg-primary/);
  });
});

describe("a project with CSS variables only", () => {
  it("reads :root, a dark block and prefers-color-scheme, and Tailwind v4's @theme", async () => {
    const kit = await kitOf({
      "styles/global.css": `:root { --brand: #112233; --bg: rgb(250, 250, 250); --radius-md: 6px; --font-sans: 'Poppins', sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #101010; } }
@theme { --color-accent: oklch(1 0 0); --font-display: "Playfair Display", serif; --breakpoint-lg: 1024px; --radius: 12px; }`,
    });
    expect(kit.tokens.colors).toMatchObject({ brand: "#112233", bg: "#fafafa", accent: "#ffffff" });
    expect(kit.tokens.dark).toMatchObject({ bg: "#101010" });
    expect(kit.tokens.fonts).toMatchObject({ sans: "Poppins", display: "Playfair Display" });
    expect(kit.tokens.screens).toEqual({ lg: "1024px" });
    expect(kit.tokens.radius).toBe("12px");
    expect(kit.systems).toContain("CSS variables");
  });

  it("keeps only Google Fonts: an @import of Google's is loaded, an @font-face from anywhere else is dropped", async () => {
    const kit = await kitOf({
      "src/index.css": `@import url("https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap");
@font-face { font-family: Mine; src: url(https://cdn.example.com/mine.woff2); }
@font-face { font-family: Gs; src: url(https://fonts.gstatic.com/s/gs/v1/a.woff2); }
:root { --c: #fff; }`,
    });
    expect(kit.css.fonts).toEqual(["https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap"]);
    expect(kit.css.css).toContain("font-family: Gs");
    expect(kit.css.css).not.toContain("cdn.example.com");
    expect(P.googleFontUrl("https://evil.example/css2?family=X")).toBeNull();
    expect(P.googleFontUrl("https://fonts.googleapis.com.evil.example/css2?family=X")).toBeNull();
    expect(P.googleFontUrl("https://fonts.googleapis.com/css2?family=Inter&display=swap")).not.toBeNull();
    expect(P.readFonts(`<link href="https://evil.example/f.css"><link href="https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400&amp;display=swap">`).urls).toEqual(["https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400&display=swap"]);
  });

  it("asks Google only for families the project takes from Google, never for one named in a config", async () => {
    const kit = await kitOf({ "tailwind.config.js": `module.exports = { theme: { extend: { fontFamily: { sans: ['"Proxima Nova"', 'sans-serif'] } } } }` });
    expect(kit.tokens.fonts.sans).toBe("Proxima Nova");
    expect(kit.css.fonts).toBeUndefined();
  });
});

describe("MUI, Chakra and styled-components themes", () => {
  it("reads MUI's palette, typography, shape and spacing", async () => {
    const kit = await kitOf({
      "src/theme.ts": `import { createTheme } from "@mui/material/styles";
export const theme = createTheme({
  palette: { mode: "light", primary: { main: "#1976d2", contrastText: "#fff" }, secondary: { main: "rgb(220, 0, 78)" }, error: { main: "#d32f2f" }, background: { default: "#fafafa", paper: "#ffffff" } },
  typography: { fontFamily: '"Roboto", "Helvetica", sans-serif', button: { textTransform: "none" } },
  shape: { borderRadius: 12 }, spacing: 8,
  components: { MuiButton: { styleOverrides: { root: { borderRadius: 8 } } } },
});`,
    }, { deps: ["@mui/material"] });
    expect(kit.systems).toEqual(["MUI"]);
    expect(kit.tokens.colors).toMatchObject({ primary: "#1976d2", "primary-foreground": "#ffffff", secondary: "#dc004e", destructive: "#d32f2f", background: "#fafafa", card: "#ffffff" });
    expect(kit.tokens.fonts.sans).toBe("Roboto");
    expect(kit.tokens.radius).toBe("12px");
    expect(kit.tokens.spacing).toBe("8px");
  });

  it("reads Chakra's colors, fonts and radii, and a styled-components theme object", async () => {
    const chakra = await kitOf({
      "src/theme.js": `import { extendTheme } from '@chakra-ui/react'\nconst theme = extendTheme({ colors: { brand: { 100: '#f7fafc', 500: '#319795' } }, fonts: { heading: 'Poppins, sans-serif', body: 'Inter, sans-serif' }, radii: { md: '6px' } })\nexport default theme`,
    }, { deps: ["@chakra-ui/react"] });
    expect(chakra.systems).toEqual(["Chakra UI"]);
    expect(chakra.tokens.colors).toMatchObject({ "brand-100": "#f7fafc", "brand-500": "#319795" });
    expect(chakra.tokens.fonts).toMatchObject({ heading: "Poppins", body: "Inter" });
    expect(chakra.tokens.radius).toBe("6px");
    const styled = await kitOf({ "src/styles/theme.ts": `export const theme = { colors: { primary: '#ff5a5f', text: '#222' }, fonts: { body: "'Lato', sans-serif" }, radii: { md: 4 } };` }, { deps: ["styled-components"] });
    expect(styled.tokens.colors).toMatchObject({ primary: "#ff5a5f", text: "#222222" });
    expect(styled.tokens.radius).toBe("4px");
  });
});

describe("Flutter, Android and iOS", () => {
  it("reads Flutter's ThemeData and ColorScheme: colours (light and dark), a Google font, a radius", async () => {
    const kit = await kitOf({
      "lib/theme/app_theme.dart": `import 'package:google_fonts/google_fonts.dart';
class AppTheme {
  static const Color brand = Color(0xFF6750A4);
  static ThemeData light = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.light(primary: const Color(0xFF6750A4), secondary: Color(0xFF625B71), surface: Colors.white, error: Color(0xFFB3261E)),
    scaffoldBackgroundColor: const Color(0xFFFFFBFE),
    textTheme: GoogleFonts.poppinsTextTheme(),
    cardTheme: CardTheme(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
  );
  static ThemeData dark = ThemeData(brightness: Brightness.dark, colorScheme: ColorScheme.dark(primary: Color(0xFFD0BCFF), surface: Color(0xFF1C1B1F)));
}`,
    }, { deps: ["cupertino_icons"], frameworks: ["Flutter"] });
    expect(kit.systems).toEqual(["Flutter"]);
    expect(kit.tokens.colors).toMatchObject({ brand: "#6750a4", primary: "#6750a4", secondary: "#625b71", destructive: "#b3261e", background: "#fffbfe", card: "#ffffff" });
    expect(kit.tokens.dark).toMatchObject({ primary: "#d0bcff", card: "#1c1b1f" });
    expect(kit.tokens.fonts.sans).toBe("Poppins");
    expect(kit.tokens.radius).toBe("16px");
    expect(kit.css.fonts).toEqual(["https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"]);
    expect(kit.icons).toEqual({ name: "Cupertino icons", available: false });
    expect(kit.prompt).toContain("icons: Cupertino icons (not available here: use lucide-react or inline SVG");
  });

  it("reads Android's colors.xml and themes.xml (and the night theme), and Compose's Color.kt", async () => {
    const kit = await kitOf({
      "app/src/main/res/values/colors.xml": `<resources><color name="purple_500">#FF6200EE</color><color name="purple_700">#FF3700B3</color><color name="teal_200">#FF03DAC5</color><color name="white">#FFFFFFFF</color></resources>`,
      "app/src/main/res/values/themes.xml": `<resources><style name="Theme.App" parent="Theme.MaterialComponents.DayNight"><item name="colorPrimary">@color/purple_500</item><item name="colorSecondary">@color/teal_200</item><item name="colorOnPrimary">@color/white</item></style></resources>`,
      "app/src/main/res/values-night/themes.xml": `<resources><style name="Theme.App"><item name="colorPrimary">#FFBB86FC</item></style></resources>`,
      "app/src/main/java/ui/theme/Color.kt": `val Purple80 = Color(0xFFD0BCFF)\nval Purple40 = Color(0xFF6650A4)`,
      "app/src/main/java/ui/theme/Theme.kt": `private val Dark = darkColorScheme(primary = Purple80)\nprivate val Light = lightColorScheme(primary = Purple40, onPrimary = Purple80)`,
    });
    expect(kit.systems).toEqual(expect.arrayContaining(["Android", "Jetpack Compose"]));
    expect(kit.tokens.colors).toMatchObject({ primary: "#6200ee", secondary: "#03dac5", "primary-foreground": "#ffffff" });
    expect(kit.tokens.dark).toMatchObject({ primary: "#bb86fc" });
    expect(P.readAndroidColors(`<color name="a">#80FF0000</color>`)).toEqual({ a: "#ff000080" });
    expect(P.readCompose(`val A = Color(0xFF112233)\nlightColorScheme(primary = A)`).scheme.light).toEqual({ primary: "#112233" });
  });

  it("reads iOS colour assets, with the dark appearance, and skips the app icon", async () => {
    const kit = await kitOf({
      "App/Assets.xcassets/BrandPrimary.colorset/Contents.json": JSON.stringify({
        colors: [
          { color: { "color-space": "srgb", components: { red: "0.200", green: "0.400", blue: "0.900", alpha: "1.000" } }, idiom: "universal" },
          { appearances: [{ appearance: "luminosity", value: "dark" }], color: { "color-space": "srgb", components: { red: "0x80", green: "0xA0", blue: "0xFF", alpha: "1.000" } }, idiom: "universal" },
        ],
      }),
      "App/Assets.xcassets/AppIcon.appiconset/Contents.json": "{}",
    });
    expect(kit.systems).toEqual(["iOS"]);
    expect(kit.tokens.colors).toEqual({ brandPrimary: "#3366e6" });
    expect(kit.tokens.dark).toEqual({ brandPrimary: "#80a0ff" });
    expect(P.readColorset("not json")).toBeNull();
  });
});

describe("where the files come from", () => {
  it("reads a workspace's blobs, and a file that will not read is null", async () => {
    const ws = {
      tree: async () => ({ entries: [{ path: "a.css", type: "blob", sha: "1" }, { path: "src", type: "tree", sha: "2" }, { path: "src/b.ts", type: "blob", sha: "3" }], truncated: false }),
      read: async (p: string) => { if (p === "a.css") return { path: p, size: 3, text: ":root{}" }; throw new Error("not found"); },
    };
    const f = workspaceFiles(ws as never);
    expect(await f.paths()).toEqual(["a.css", "src/b.ts"]);
    expect(await f.read("a.css")).toBe(":root{}");
    expect(await f.read("src/b.ts")).toBeNull();
  });

  it("reads a job's room: numbered lines taken off, and its paths from the brain plus the few the glob finds", async () => {
    const room = {
      read: async (p: string) => (p === "tailwind.config.js" ? { kind: "ok", out: { text: "1: module.exports = {\n2:   theme: {}\n3: }", from: 1, to: 3, total: 3, truncated: false }, staged: false } : { kind: "missing", deleted: false }),
      glob: async (g: string) => (g === "**/tailwind.config.*" ? { kind: "ok", out: { ok: true, paths: ["tailwind.config.js"], total: 1, partial: false } } : { kind: "unavailable" }),
    };
    const f = liveFiles(room as never, { paths: async () => ["src/a.tsx"] });
    expect((await f.paths()).sort()).toEqual(["src/a.tsx", "tailwind.config.js"]);
    expect(await f.read("tailwind.config.js")).toBe("module.exports = {\n  theme: {}\n}");
    expect(await f.read("nope")).toBeNull();
  });
});

describe("what it will and will not read", () => {
  it("reads at most 12 files, the most telling first, however many a project has", async () => {
    const map: Record<string, string> = { ...WEB, "package.json": '{"dependencies":{"react":"1"}}' };
    for (let i = 0; i < 8; i += 1) map[`src/theme/t${i}.ts`] = `export const theme = { colors: { c${i}: "#00000${i}" } }`;
    for (let i = 0; i < 12; i += 1) map[`ios/A.xcassets/C${i}.colorset/Contents.json`] = "{}";
    for (const css of ["globals.css", "global.css", "index.css", "app.css", "main.css"]) map[`web/${css}`] = ":root{--a:#fff}";
    map["app/src/main/res/values/colors.xml"] = "<resources/>";
    map["app/src/main/res/values/themes.xml"] = "<resources/>";
    map["lib/theme/app_theme.dart"] = "ThemeData()";
    map["lib/main.dart"] = "ThemeData()";
    const f = files(map);
    const kit = await buildKit({ headSha: "h", name: "x", files: f, deps: [], frameworks: [], components: [{ name: "Button", path: "src/components/ui/button.tsx" }, { name: "Card", path: "src/components/ui/card.tsx" }] });
    expect(KIT_FILES_MAX).toBe(12);
    expect(f.reads.length).toBeLessThanOrEqual(12);
    expect(kit.sources.length).toBeLessThanOrEqual(12);
    // the shadcn file and the config come first
    expect(f.reads.slice(0, 2)).toEqual(["components.json", "tailwind.config.ts"]);
    expect(new Set(f.reads).size).toBe(f.reads.length);
  });

  it("never reads an env file, a key or a vendored folder, and picks the shallowest of several candidates", () => {
    const picks = pickSources([".env", ".env.local", "server.key", "node_modules/tailwindcss/tailwind.config.js", "apps/web/tailwind.config.js", "tailwind.config.js", "dist/theme.ts", "src/vendor/theme.ts", "src/app/globals.css", "pkg/src/app/globals.css"]);
    expect(picks.map((p) => p.path)).toEqual(["tailwind.config.js", "src/app/globals.css", "pkg/src/app/globals.css"]);
    expect(pickSources(["components.json", "src/styles/theme.css", "src/app/globals.css"], { cssHint: "src/styles/theme.css" }).filter((p) => p.role === "css").map((p) => p.path)).toEqual(["src/styles/theme.css", "src/app/globals.css"]);
  });

  it("does not use a file that holds a secret, and leaves it out of every output", async () => {
    const kit = await kitOf({
      "src/theme.ts": `export const theme = { colors: { primary: "#ff0000" }, key: "${FAKE_STRIPE}" };`,
      "src/app/globals.css": ":root { --primary: #00ff00; }",
    });
    expect(kit.tokens.colors).toEqual({ primary: "#00ff00" });
    expect(JSON.stringify(kit)).not.toContain(FAKE_STRIPE);
  });

  it("is not thrown by a file that will not read, or by a project with nothing in it", async () => {
    const bad = { paths: async () => ["tailwind.config.js", "src/app/globals.css"], read: async (p: string) => { if (p === "tailwind.config.js") throw new Error("boom"); return null; } };
    const kit = await buildKit({ headSha: "", name: "", files: bad });
    expect(kit.tokens.colors).toEqual({});
    expect(kit.prompt.length).toBeLessThanOrEqual(KIT_PROMPT_MAX);
    expect(kit.css.css).toContain(":root");
  });
});

describe("the prompt", () => {
  it("never passes 2,000 characters, however much the project has, and keeps the rule", () => {
    const colors = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`color-${i}`, "#123456"]));
    const components = Array.from({ length: 60 }, (_, i) => ({ name: `Component${i}`, path: `src/components/c${i}.tsx`, props: ["alpha", "beta", "gamma", "delta"] }));
    const t = { colors, dark: colors, fonts: { sans: "Inter", mono: "Geist Mono" }, radius: "8px", spacing: "4px", screens: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, "100px"])) };
    const p = compactPrompt({ systems: ["Tailwind CSS", "shadcn/ui", "MUI", "Flutter", "Android"], tokens: t, components, icons: { name: "lucide-react", available: true } }, "a-very-long-project-name");
    expect(p.length).toBeLessThanOrEqual(KIT_PROMPT_MAX);
    expect(p).toMatch(/Use these names, colours and radius\./);
    expect(p).toContain("radius: 8px");
    expect(p).toContain("Rules:");
  });

  it("keeps the semantic colours first and the rest by name", () => {
    const p = compactPrompt({ systems: [], tokens: { colors: { zzz: "#000000", border: "#111111", primary: "#222222", aaa: "#333333" }, dark: {}, fonts: {}, radius: null, spacing: null, screens: {} }, components: [], icons: null }, "p");
    expect(p).toContain("colors: primary #222222, border #111111, aaa #333333, zzz #000000");
  });

  it("gives the viewer no CSS at all if it would hold a secret, and caps the Tailwind config it sends", () => {
    const tokens = { colors: { primary: "#000000" }, dark: {}, fonts: {}, radius: null, spacing: null, screens: {} };
    expect(buildCss({ rootVars: { key: FAKE_STRIPE }, darkVars: {}, tokens, fontFaces: [], fonts: [], tailwind: null }).css).toBe("");
    const big = { theme: { extend: { colors: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`c${i}`, "#aabbcc"])), screens: { sm: "1px" }, spacing: { 1: "1px" } } } };
    const out = buildCss({ rootVars: {}, darkVars: {}, tokens, fontFaces: [], fonts: [], tailwind: big });
    expect(out.tailwind === undefined || JSON.stringify(out.tailwind).length <= 8000).toBe(true);
    // a variable that points at the network is not handed over
    expect(buildCss({ rootVars: { bg: "url(https://x.test/a.png)", ok: "#fff" }, darkVars: {}, tokens, fontFaces: [], fonts: [], tailwind: null }).css).not.toContain("x.test");
  });
});

describe("the components, from the brain's symbols", () => {
  it("lists exported components under components/ or ui/, most central first, and names a default export by its file", async () => {
    const { brain } = await fixtureBrain({
      files: [
        { path: "src/components/ui/button.tsx", symbols: [sym("Button", "component"), sym("buttonVariants", "const")], rank: 0.9 },
        { path: "src/components/ui/card.tsx", symbols: [sym("Card", "component"), sym("CardTitle", "component")], rank: 0.5 },
        { path: "src/components/pricing-table.tsx", symbols: [sym("default", "component")], rank: 0.4 },
        { path: "src/components/Card.test.tsx", symbols: [sym("CardTest", "component")], rank: 0.9 },
        { path: "src/lib/utils.ts", symbols: [sym("cn", "function")], rank: 0.95 },
        { path: "lib/widgets/primary_button.dart", symbols: [sym("PrimaryButton", "component"), sym("_Private", "component", 1, false)], lang: "Dart", rank: 0.3 },
      ],
    });
    const list = await brainComponents(brain);
    expect(list.map((c) => c.name)).toEqual(["Button", "Card", "CardTitle", "PricingTable", "PrimaryButton"]);
    expect(list.find((c) => c.name === "Button")!.path).toBe("src/components/ui/button.tsx");
  });

  it("reads props from an interface, a destructured parameter and a Flutter constructor", () => {
    expect(P.readProps("Button", `interface ButtonProps { variant?: "a"; size?: "b"; onClick: () => void }\nexport function Button() {}`)).toEqual(["variant", "size", "onClick"]);
    expect(P.readProps("Card", `export function Card({ title, footer = "x", ...rest }) {}`)).toEqual(["title", "footer"]);
    expect(P.readProps("Tile", `class Tile extends StatelessWidget { const Tile({super.key, required this.title, this.onTap}); }`)).toEqual(["title", "onTap"]);
  });
});

describe("the cache, keyed by the brain's head", () => {
  async function setup() {
    const f = files(WEB);
    const fb = await fixtureBrain({ files: [{ path: "src/components/ui/button.tsx", symbols: [sym("Button", "component")] }], structure: { frameworks: ["Next.js", "React", "Tailwind CSS"] } });
    const store = new MemoryArtifactStore();
    return { f, fb, store, deps: { store, files: f, brain: fb.brain } };
  }
  const project = { id: "33333333-3333-4333-8333-333333333333", userId: "u1", name: "u1/app" };

  it("reads the files once, serves the same kit while the head stays, and reads again only when the head moves", async () => {
    const { f, fb, store, deps } = await setup();
    const first = await designKit(deps, project);
    expect(first.cached).toBe(false);
    expect(first.kit.headSha).toBe("a".repeat(40));
    const reads = f.reads.length;
    expect(reads).toBeGreaterThan(0);
    expect((await store.getKit(project.id))!.headSha).toBe("a".repeat(40));

    const second = await designKit(deps, project);
    expect(second.cached).toBe(true);
    expect(f.reads.length).toBe(reads);
    expect(second.kit.prompt).toBe(first.kit.prompt);

    await fb.setRow({ headSha: "b".repeat(40) });
    const third = await designKit(deps, project);
    expect(third.cached).toBe(false);
    expect(f.reads.length).toBeGreaterThan(reads);
    expect(third.kit.headSha).toBe("b".repeat(40));
    expect((await store.getKit(project.id))!.headSha).toBe("b".repeat(40));
    expect((await designKit(deps, project)).cached).toBe(true);
  });

  it("can be forced, and does not keep a kit for a project whose brain was never built", async () => {
    const { f, deps, store } = await setup();
    await designKit(deps, project);
    const reads = f.reads.length;
    expect((await designKit(deps, project, { force: true })).cached).toBe(false);
    expect(f.reads.length).toBeGreaterThan(reads);
    const loose = await designKit({ store, files: files(WEB), brain: null }, { ...project, id: "44444444-4444-4444-8444-444444444444" });
    expect(loose.kit.headSha).toBe("");
    expect(loose.kit.tokens.colors.primary).toBe("#7c3bed");
    expect(await store.getKit("44444444-4444-4444-8444-444444444444")).toBeNull();
  });
});

describe("componentArtifact", () => {
  const SECTION = `export default function Checkout() {
  return (
    <section className="checkout">
      <h1>Checkout</h1>
      <OrderSummary />
      <Button>Pay now</Button>
    </section>
  );
}
`;
  const PAGE_FILES: Record<string, string> = { ...WEB, "src/app/checkout/page.tsx": SECTION };

  async function project() {
    const fb = await fixtureBrain({
      files: [
        { path: "src/app/checkout/page.tsx", symbols: [sym("default", "component")], summary: "The checkout page: the order summary and the pay button.", rank: 0.6 },
        { path: "src/components/ui/button.tsx", symbols: [sym("Button", "component")], summary: "The button.", rank: 0.9 },
        { path: "src/components/ui/card.tsx", symbols: [sym("Card", "component")], summary: "A card.", rank: 0.5 },
      ],
      texts: [text("src/app/checkout/page.tsx", 4, "Checkout"), text("src/app/checkout/page.tsx", 6, "Pay now")],
      structure: { frameworks: ["Next.js", "React", "Tailwind CSS"] },
    });
    return fb;
  }

  const classified = (difficulty: "low" | "high") => ({
    type: "feature", difficulty, risk: "low", needs: { web: false, exec: false, vision: false, indic: false }, language: "en", confidence: 0.95, signals: ["test"],
  });

  function deps(fb: Awaited<ReturnType<typeof project>>, r: ReturnType<typeof rig>, f = files(PAGE_FILES)) {
    return { service: r.service, kit: { store: r.store, files: f, brain: fb.brain }, brain: fb.brain, call: r.model.call, f };
  }

  const answerFor = (difficulty: "low" | "high" = "low") => (s: import("./artifacts-rig.js").Sent): import("./artifacts-rig.js").Answer => {
    if (s.purpose === "classify") return { json: classified(difficulty) };
    if (s.purpose === "artifact.vision") return "A header with a title, below it a two-column row: an order list on the left and a pay button on the right.";
    if (s.purpose === "artifact.generate") return "```jsx\nexport default function Preview() { return <section className=\"checkout\"><h1>Checkout</h1><div>Pricing card</div></section>; }\n```";
    return new Error("no model for that");
  };

  it("finds where the component goes with locate(), reads the surrounding section and the kit, and makes a react artifact in the project's style", async () => {
    const fb = await project();
    const r = rig(answerFor());
    const d = deps(fb, r);
    const out = await componentArtifact(d, { id: fb.projectId, userId: "u1", name: "u1/app" }, "the checkout page with a pricing card");
    expect(out.type).toBe("react");
    expect(out.located.targets[0]!.path).toBe("src/app/checkout/page.tsx");
    const made = r.model.of("artifact.generate")[0]!;
    // the code tier, with the kit first, then the surroundings of where it goes, then the request last
    expect(made.tier).toBe("code");
    expect(made.user.startsWith("PROJECT STYLE\nu1/app (CSS variables, Tailwind CSS, shadcn/ui)")).toBe(true);
    expect(made.user).toContain("colors: primary #7c3bed");
    expect(made.user).toContain("components: Button(variant,size,asChild)");
    expect(made.user).toMatch(/<surroundings>\nsrc\/app\/checkout\/page\.tsx\n1: export default function Checkout/);
    expect(made.user).toContain("5:       <OrderSummary />");
    expect(made.user).toMatch(/It probably goes in src\/app\/checkout\/page\.tsx \(.*but that is not certain/);
    expect(made.user.trimEnd().endsWith("in the style of the project.")).toBe(true);
    expect(made.system).toMatch(/recreate just enough of it around the new part/);
    // the artifact is kept, in the project, with the code unfenced, and its cost is the sum of its parts
    const got = await r.service.get("u1", out.change.artifact.id);
    expect(got.artifact.projectId).toBe(fb.projectId);
    expect(got.content).toMatch(/^export default function Preview\(\)/);
    expect(out.change.how.mode).toBe("generate");
    expect(out.paise.make).toBe(out.change.paise);
    expect(out.kit).toMatchObject({ cached: false, systems: ["CSS variables", "Tailwind CSS", "shadcn/ui"] });
    // and the viewer gets the project's look with the artifact
    expect(got.kit!.css).toContain("--tz-primary: #7c3bed;");
  });

  it("reuses the cached kit for the second component, and reads no file twice for it", async () => {
    const fb = await project();
    const r = rig(answerFor());
    const f = files(PAGE_FILES);
    const d = deps(fb, r, f);
    await componentArtifact(d, { id: fb.projectId, userId: "u1" }, "a pricing card");
    const kitReads = f.reads.filter((p) => p !== "src/app/checkout/page.tsx").length;
    const again = await componentArtifact(d, { id: fb.projectId, userId: "u1" }, "a plan comparison");
    expect(again.kit.cached).toBe(true);
    expect(f.reads.filter((p) => p !== "src/app/checkout/page.tsx").length).toBe(kitReads);
  });

  it("uses the strong tier when the classifier says the request is complex", async () => {
    const fb = await project();
    const r = rig(answerFor("high"));
    await componentArtifact(deps(fb, r), { id: fb.projectId, userId: "u1" }, "rebuild the whole checkout with a pricing card");
    expect(r.model.of("artifact.generate")[0]!.tier).toBe("strong");
    expect(r.model.of("artifact.generate")[0]!.capPaise).toBeGreaterThan(500);
  });

  it("sends a picture to the vision tier FIRST for a layout description, and goes on with the words", async () => {
    const fb = await project();
    const r = rig(answerFor());
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const out = await componentArtifact(deps(fb, r), { id: fb.projectId, userId: "u1" }, "build this sketch", { image });
    const order = r.model.sent.map((s) => s.purpose);
    expect(order.indexOf("artifact.vision")).toBe(0);
    expect(order.indexOf("artifact.vision")).toBeLessThan(order.indexOf("artifact.generate"));
    const vision = r.model.of("artifact.vision")[0]!;
    expect(vision.tier).toBe("vision");
    expect(JSON.stringify(vision.messages)).toContain(image);
    // the description is what the maker and the search work from; the picture itself is not sent again
    const made = r.model.of("artifact.generate")[0]!;
    expect(made.user).toContain("The person's sketch, described: A header with a title");
    expect(JSON.stringify(made.messages)).not.toContain("iVBORw0KGgo");
    expect(out.layout).toMatch(/^A header with a title/);
    expect(out.paise.vision).toBeGreaterThan(0);
  });

  it("goes on without the picture if the vision tier cannot read it", async () => {
    const fb = await project();
    const r = rig((s) => (s.purpose === "artifact.vision" ? new Error("down") : answerFor()(s)));
    const out = await componentArtifact(deps(fb, r), { id: fb.projectId, userId: "u1" }, "a pricing card", { image: "data:image/png;base64,AAAA" });
    expect(out.layout).toBeUndefined();
    expect(out.change.version).toBe(1);
  });

  it("makes an html artifact for a project that is not React, and stands alone when nothing in the project stood out", async () => {
    const fb = await fixtureBrain({ files: [{ path: "lib/main.dart", symbols: [sym("MyApp", "component")], lang: "Dart", summary: "App" }], structure: { frameworks: ["Flutter"] } });
    const r = rig(answerFor());
    const out = await componentArtifact(
      { service: r.service, kit: { store: r.store, files: files({ "lib/main.dart": "ThemeData(colorScheme: ColorScheme.light(primary: Color(0xFF6750A4)))" }), brain: fb.brain }, brain: fb.brain, call: r.model.call },
      { id: fb.projectId, userId: "u1" }, "zzz qqq", {},
    );
    expect(out.type).toBe("html");
    expect(r.model.of("artifact.generate")[0]!.user).toContain("colors: primary #6750a4");
  });

  it("refuses a request with nothing in it, and is the person's: the cost and the artifact are theirs", async () => {
    const fb = await project();
    const r = rig(answerFor());
    await expect(componentArtifact(deps(fb, r), { id: fb.projectId, userId: "u1" }, "  ")).rejects.toMatchObject({ code: "bad_request" });
    const out = await componentArtifact(deps(fb, r), { id: fb.projectId, userId: "u1" }, "a pricing card");
    expect(r.model.sent.every((s) => s.userId === "u1")).toBe(true);
    await expect(r.service.get("u2", out.change.artifact.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

/**
 * THE RENDER CHECK: a Bots app screen drawn by the apps' own renderers, beside the board it was built from.
 *
 *   cd tulmi && npx tsx scripts/bots-render/render.ts bots.home --board Main --desk-board DeskHome
 *
 * For each client it writes, in scripts/bots-render/out/ (or --out):
 *   <id>.<client>.json          the screen, as the server would send it
 *   <id>.<client>.png           the screen drawn by the client's renderer
 *   <id>.<client>.board.png     the board (bots-design/project/<Board>.dc.html), when one is named
 *   <id>.<client>.compare.png   the two side by side: look at this one
 *
 * Every screen at once, with the sample data, on both clients, laid out for review: showcase.ts.
 *
 * THE RENDERERS ARE THE REAL ONES.
 *   desktop  TAILZU-DESKTOP/app.html + sdui.js in Chromium at 1280 x 800, signed in against a stand-in API that
 *            answers /v1/app/bootstrap and /v1/app/screen (with the builder below) and serves Blip and the fonts.
 *   phone    TAILZU-FRONTEND/app/src/sdui (Renderer, components, componentsV3, SvgShapes) bundled with
 *            react-native-web at 390 x 844, a 12 pt status bar inset. Native-only modules (Skia, video, haptics…)
 *            are stubbed to draw nothing; the Bots kit uses none of them. Text is set by the browser, so a line
 *            can break a word earlier or later than on a device; layout, colour, type and spacing are the app's.
 * The first run installs react-native-web, react-dom and esbuild into scripts/bots-render/.deps (about 5 s).
 *
 * Options:
 *   --client phone|desktop|both     default both
 *   --board <Name>                  the phone board (Main for Main.dc.html)
 *   --desk-board <Name>             the window's board (DeskHome)
 *   --params '{"slug":"plan"}'      navigation params
 *   --quiet                         the quiet day: nothing working, nothing waiting (default: the boards' day)
 *   --json <file>                   draw this screen JSON (e.g. one a running server served) instead of building one
 *   --motion                        let the motions run (default: Reduce Motion, so every shot is the same)
 *   --out <dir>   --design <bots-design dir, default $BOTS_DESIGN>
 *
 * The data is fixtures.ts's (fakeDeps); a screen's own `load` gets its answers from yours
 * (--api '{"GET /v1/bots/plan/memory": {...}}'). The sample answers for every screen are in samples/ (showcase.ts uses them).
 *
 * As a module: launchBrowser() and renderClient() draw one screen on one client (showcase.ts runs many at once).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FakeOpts } from "../../src/experience/bots/fixtures.js";

process.env.PUBLIC_ORIGIN = "https://api.local";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const TULMI = path.resolve(HERE, "../..");
const DESKTOP = path.resolve(TULMI, "../../TAILZU-DESKTOP");
const APP = path.resolve(TULMI, "../../TAILZU-FRONTEND/app");
const DEPS = path.join(HERE, ".deps");
const DEP_VERSIONS = ["react-native-web@0.21.2", "react-dom@19.2.3", "react@19.2.3", "esbuild@0.25.10"];
export const DEFAULT_DESIGN = process.env.BOTS_DESIGN ?? "/tmp/claude-0/-home-user/36aabdc6-23c5-5bb4-b965-f6afd0072759/scratchpad/bots-design";

export type Client = "phone" | "desktop";
export type Params = Record<string, string | number | boolean>;

// ------------------------------------------------------------------ tools

function ensureDeps(): void {
  if (fs.existsSync(path.join(DEPS, "node_modules/react-native-web")) && fs.existsSync(path.join(DEPS, "node_modules/esbuild"))) return;
  console.log("bots-render: installing react-native-web, react-dom and esbuild into scripts/bots-render/.deps (once)…");
  fs.mkdirSync(DEPS, { recursive: true });
  fs.writeFileSync(path.join(DEPS, "package.json"), JSON.stringify({ name: "bots-render-deps", private: true, version: "0.0.0" }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", DEPS, ...DEP_VERSIONS], { stdio: "inherit" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function playwright(): any {
  const roots = [...(process.env.NODE_PATH ?? "").split(":").filter(Boolean), "/opt/node-tools/node_modules", path.join(TULMI, "node_modules")];
  for (const r of roots) {
    try { return createRequire(path.join(r, "x.js"))("playwright"); } catch { /* next */ }
  }
  throw new Error("bots-render: Playwright not found (set NODE_PATH to a node_modules that has it)");
}

/** Chromium, with the phone's deps in place. One browser serves any number of renders at once. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function launchBrowser(): Promise<any> {
  ensureDeps();
  return playwright().chromium.launch();
}

const EXT = ["", ".web.ts", ".web.tsx", ".web.js", ".web.jsx", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];

/** The phone's renderer, bundled for the browser with react-native-web (once per process). */
let bundled: Promise<string> | undefined;
function phoneBundle(): Promise<string> {
  bundled ??= buildPhoneBundle();
  return bundled;
}

/**
 * The phone's renderer bundled from `entry` (default phone/entry.jsx, which draws window.__SCREEN__). preview.ts bundles
 * phone/preview.jsx, the same renderer with a navigator around it.
 */
export async function buildPhoneBundle(entry = path.join(HERE, "phone/entry.jsx")): Promise<string> {
  ensureDeps();
  const req = createRequire(path.join(DEPS, "node_modules", "x.js"));
  const esbuild = req("esbuild");
  const own: Record<string, string> = {
    "react-native-safe-area-context": path.join(HERE, "phone/safe-area.jsx"),
    "expo-image": path.join(HERE, "phone/expo-image.jsx"),
    "expo-linear-gradient": path.join(HERE, "phone/views.jsx"),
    "expo-blur": path.join(HERE, "phone/views.jsx"),
    "@supabase/supabase-js": path.join(HERE, "phone/supabase.js"),
    // The microphone's prompt, answered yes (the preview's stand-in for the system's).
    "expo-audio": path.join(HERE, "phone/expo-audio.js"),
    // Remembers only the living cards' "once", in the page (BotCard).
    "@react-native-async-storage/async-storage": path.join(HERE, "phone/async-storage.js"),
  };
  const plugin = {
    name: "phone",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setup(b: any) {
      // Exact-case resolution: esbuild matches names case-insensitively (BlipRoam.tsx and blipRoam.ts both exist).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.onResolve({ filter: /^\.\.?\// }, (a: any) => {
        const base = path.resolve(a.resolveDir, a.path);
        for (const e of EXT) if (fs.existsSync(base + e) && fs.statSync(base + e).isFile()) return { path: base + e };
        for (const e of EXT) if (fs.existsSync(path.join(base, "index" + e))) return { path: path.join(base, "index" + e) };
        return undefined;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.onResolve({ filter: /^[^./]/ }, (a: any) => {
        const name = a.path.startsWith("@") ? a.path.split("/").slice(0, 2).join("/") : a.path.split("/")[0];
        if (a.path === "react-native" || a.path.startsWith("react-native/")) return { path: req.resolve("react-native-web") };
        if (own[name]) return { path: own[name] };
        if (name === "react" || name === "react-dom" || name === "scheduler") return { path: req.resolve(a.path) };
        if (name === "react-native-web" || name === "react-native-svg" || a.path.startsWith("@app/")) return undefined;
        if (/\/(react-native-web|react-native-svg|\.deps)\//.test(a.importer)) return undefined;
        return { path: path.join(HERE, "phone/stub.js") };
      });
    },
  };
  const out = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    logLevel: "error", alias: { "@app": path.join(APP, "src") }, nodePaths: [path.join(DEPS, "node_modules"), path.join(APP, "node_modules")],
    resolveExtensions: EXT.slice(1), mainFields: ["browser", "module", "main"],
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".gif": "dataurl", ".webp": "dataurl", ".ttf": "empty", ".otf": "empty", ".mp4": "empty", ".mov": "empty", ".wav": "empty", ".mp3": "empty", ".lottie": "empty", ".html": "text" },
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false", "process.env.EXPO_OS": '"web"', global: "window" },
    plugins: [plugin],
  });
  return out.outputFiles[0].text as string;
}

// ------------------------------------------------------------------ the screens

const { buildBotsScreen, botsNav } = await import("../../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../../src/experience/bots/fixtures.js");
const { FACE, botsFonts, BOTS_THEME } = await import("../../src/experience/bots/kit.js");

/** What one render reads: the sample day (fixtures.ts), answers for the screens' own `load`, or a served screen. */
export interface ScreenData {
  /** Answers for deps.api, by "METHOD /path". */
  api?: Record<string, unknown>;
  /** fakeDeps overrides (bots, jobs, tasks, …). */
  fake?: Omit<FakeOpts, "api" | "calls">;
  /** The quiet day: nothing working, nothing waiting. */
  quiet?: boolean;
  /** Draw this screen JSON for the screen asked for instead of building it. */
  served?: unknown;
}

const USER = { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya Sharma", email: "aanya@example.in" };
export const DESKTOP_COMPONENTS = ["DeskShell", "DeskNotes", "DeskConnectors", "BotsKit", "BotsMotion", "BotBuddy", "WriteOn", "LiveMark", "HeadBar"];
/** What the phone build declares beyond BotsKit, for the screens drawn here: the living tiles. */
export const PHONE_COMPONENTS = ["BotsMotion", "BotBuddy", "WriteOn", "LiveMark", "HeadBar"];

/**
 * The builder the stand-in server uses. `misses` collects the api calls the target screen made that had no answer
 * (each answers 404, as a missing route would): a sign the sample data has a gap.
 */
function builder(target: string, data: ScreenData, misses: string[]) {
  return async (id: string, client: Client, p: Record<string, unknown> = {}, comps: string[] = []): Promise<unknown> => {
    if (data.served && id === target) return data.served;
    const deps = fakeDeps({ ...(data.quiet ? { jobs: [], tasks: [] } : {}), ...data.fake, api: data.api ?? {} });
    if (id === target) {
      const api = deps.api;
      deps.api = (async (method: string, route: string, body?: unknown) => {
        try { return await api(method as "GET", route, body); } catch (e) { misses.push(`${method} ${route}`); throw e; }
      }) as typeof deps.api;
    }
    return buildBotsScreen({
      screenId: id, client, params: p as Record<string, string>, tzOffsetMinutes: IST, user: USER,
      can: new Set(["BotsKit", ...comps]), desk: { pages: comps.includes("DeskShell"), notes: comps.includes("DeskNotes") },
    }, deps);
  };
}
type Build = ReturnType<typeof builder>;

/** Fonts and Blip, from tulmi/fonts and tulmi/blip, for https://api.local. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serveAssets(route: any): Promise<void> | void {
  const u = new URL(route.request().url());
  const file = path.join(TULMI, u.pathname);
  if (/^\/(fonts|blip)\//.test(u.pathname) && fs.existsSync(file)) {
    return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "font/ttf" });
  }
  return route.fulfill({ status: 404, body: "" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function settle(page: any, motion: boolean): Promise<void> {
  // Browser code goes in as strings: this file is type-checked without the DOM, and tsx would wrap a function.
  await page.evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  })()`);
  await page.waitForTimeout(motion ? 900 : 250);
}

/**
 * What spills: anything past the window's right edge, and anything below its foot that is not inside something that
 * scrolls (a footer or a tab bar pushed off the screen). The lines check.cjs prints for a board, for the app's render.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function spills(page: any, rootSelector: string): Promise<string[]> {
  return page.evaluate(`(() => {
    const W = innerWidth, H = innerHeight, out = [];
    const scrolls = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowY; if (o === "auto" || o === "scroll") return true; } return false; };
    for (const el of document.querySelectorAll(${JSON.stringify(rootSelector)} + " *")) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const what = el.tagName.toLowerCase() + ' "' + (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40) + '"';
      if (b.right > W + 1) out.push(what + " right=" + Math.round(b.right));
      else if (b.bottom > H + 1 && !scrolls(el)) out.push(what + " bottom=" + Math.round(b.bottom));
      if (out.length >= 6) break;
    }
    return out;
  })()`);
}

interface Drawn { errors: string[]; spills: string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPhone(browser: any, screen: unknown, file: string, motion: boolean): Promise<Drawn> {
  const errors: string[] = [];
  const bundle = await phoneBundle();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: motion ? "no-preference" : "reduce" });
  try {
    page.on("pageerror", (e: Error) => errors.push(e.message));
    const fonts = botsFonts();
    const faces = Object.values(FACE).map((f) => `@font-face{font-family:"${f}";src:url(${fonts[f]})}`).join("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.route("https://phone.local/**", (r: any) => new URL(r.request().url()).pathname === "/bundle.js"
      ? r.fulfill({ body: bundle, contentType: "text/javascript" })
      : r.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;overflow:hidden}${faces}</style></head><body><div id="root"></div><script>window.__SCREEN__=${JSON.stringify(screen).replace(/</g, "\\u003c")};window.__INSETS__={top:12,bottom:0,left:0,right:0};</script><script src="/bundle.js"></script></body></html>` }));
    await page.route("https://api.local/**", serveAssets);
    await page.goto("https://phone.local/index.html");
    try {
      await page.waitForFunction("window.__RENDERED__ === true", null, { timeout: 15_000 });
    } catch (e) {
      throw new Error(`the phone drew nothing (${(e as Error).message.split("\n")[0]}). ${errors.join(" | ")}`);
    }
    await settle(page, motion);
    const sp = await spills(page, "#root");
    await page.screenshot({ path: file });
    return { errors, spills: sp };
  } finally {
    await page.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderDesktop(browser: any, screenId: string, params: Params, build: Build, file: string, motion: boolean): Promise<Drawn> {
  const errors: string[] = [];
  // bypassCSP: the window's policy refuses the checks this script runs in the page (it allows its own scripts only).
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, bypassCSP: true, reducedMotion: motion ? "no-preference" : "reduce" });
  try {
    page.on("pageerror", (e: Error) => errors.push(e.message));
    const session = { access_token: "render-check", refresh_token: "render-check", expires_at: 4_102_444_800 };
    // A string, not a function: tsx would wrap a function's inner names in a helper the page does not have.
    await page.addInitScript({ content: `(() => {
      const s = ${JSON.stringify(session)};
      const noop = () => undefined;
      const known = {
        env: async () => ({ baseUrl: "https://api.local", session: s, appVersion: "0.4.4", os: "mac", launchCount: 3, notes: true }),
        session: async () => s, setSession: async (x) => x, config: async () => ({}), askSetup: async () => null,
        folders: async () => ({ custom: false, folders: [], error: "" }),
      };
      window.tailzuApp = new Proxy(known, { get: (t, k) => (k in t ? t[k] : noop) });
    })();` });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.route("https://desk.local/**", (r: any) => {
      const f = path.join(DESKTOP, new URL(r.request().url()).pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      const type = f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".woff2") ? "font/woff2" : f.endsWith(".png") ? "image/png" : "application/octet-stream";
      return r.fulfill({ body: fs.readFileSync(f), contentType: type });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.route("https://api.local/**", async (r: any) => {
      const u = new URL(r.request().url());
      if (u.pathname === "/v1/app/bootstrap") {
        return r.fulfill({ contentType: "application/json", body: JSON.stringify({
          schemaVersion: 1, theme: { ...BOTS_THEME, space: {}, radius: {}, font: { sizes: {}, weights: {} } }, navigation: botsNav(),
          initialScreenId: "bots.home", flags: { "bots.app": true, "desktop.desk": true }, labels: {},
        }) });
      }
      if (u.pathname === "/v1/app/screen") {
        const body = JSON.parse(r.request().postData() || "{}");
        const sc = await build(body.screenId, "desktop", body.params ?? {}, body.capabilities?.components ?? DESKTOP_COMPONENTS);
        return r.fulfill({ contentType: "application/json", body: JSON.stringify(sc) });
      }
      return serveAssets(r);
    });
    page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
    await page.goto("https://desk.local/app.html");
    try {
      await page.waitForFunction("!!document.querySelector('#view [data-h]')", null, { timeout: 15_000 });
    } catch (e) {
      const seen = await page.evaluate("document.body.innerText.slice(0, 400)").catch(() => "");
      throw new Error(`the window drew no screen (${(e as Error).message.split("\n")[0]}). It shows: ${JSON.stringify(seen)}. ${errors.join(" | ")}`);
    }
    if (screenId !== "bots.home" || Object.keys(params).length) {
      // Not the landing page: open it the way a tap does.
      await page.evaluate(`go(${JSON.stringify(screenId)}, ${JSON.stringify(params)})`);
      await page.waitForTimeout(400);
    }
    await settle(page, motion);
    const sp = await spills(page, "#view");
    await page.screenshot({ path: file });
    return { errors, spills: sp };
  } finally {
    await page.close();
  }
}

/** A board, drawn the way bots-design/check.cjs draws it. False when there is no such board. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderBoard(browser: any, name: string, file: string, design = DEFAULT_DESIGN): Promise<boolean> {
  const src = path.join(design, "project", `${name}.dc.html`);
  if (!fs.existsSync(src)) { console.warn(`bots-render: no board ${src}`); return false; }
  const html = fs.readFileSync(src, "utf8");
  const inner = html.split("<x-dc>")[1]!.split("</x-dc>")[0]!;
  const helmet = (inner.match(/<helmet>([\s\S]*?)<\/helmet>/) ?? [, ""])[1];
  const bodyHtml = inner.replace(/<helmet>[\s\S]*?<\/helmet>/, "");
  const size = html.match(/"\$preview":\{"width":(\d+),"height":(\d+)\}/);
  const [w, h] = size ? [Number(size[1]), Number(size[2])] : [390, 844];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  try {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body>${bodyHtml}</body></html>`, { waitUntil: "load", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: file });
  } finally {
    await page.close();
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function compose(browser: any, shots: Array<{ file: string; label: string }>, file: string, width: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: width * shots.length + 24 * (shots.length + 1), height: 400 }, deviceScaleFactor: 1 });
  try {
    const imgs = shots.map((s) => `<figure><figcaption>${s.label}</figcaption><img src="data:image/png;base64,${fs.readFileSync(s.file).toString("base64")}" style="width:${width}px"></figure>`).join("");
    await page.setContent(`<!doctype html><html><body style="margin:0;padding:24px;display:flex;gap:24px;align-items:flex-start;background:#e9e9e9;font:13px system-ui">${imgs.replace(/<figure>/g, '<figure style="margin:0">').replace(/<figcaption>/g, '<figcaption style="margin:0 0 8px;color:#333">')}</body></html>`);
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await page.close();
  }
}

export interface RenderOptions extends ScreenData {
  screenId: string;
  client: Client;
  params?: Params;
  /** Write <base>.json, <base>.png (and <base>.board.png, <base>.compare.png) here. */
  out: string;
  /** File name stem (default "<id>.<client>"). */
  base?: string;
  /** The board to draw beside it, by name (Main for Main.dc.html). */
  board?: string;
  /** Also write <base>.compare.png, the render and its board side by side (default true). */
  compare?: boolean;
  motion?: boolean;
  design?: string;
}

export interface Rendered {
  client: Client;
  json: string;
  png: string;
  /** The board's PNG, when one was named and found. */
  board?: string;
  compare?: string;
  /** The screen as built (the JSON written). */
  screen: unknown;
  /** Page errors and console errors. */
  errors: string[];
  spills: string[];
  /** The target screen's api calls that had no answer. */
  misses: string[];
}

/** One screen on one client: built with the sample day and `api`, drawn by the client's own renderer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderClient(browser: any, o: RenderOptions): Promise<Rendered> {
  const params = o.params ?? {};
  const misses: string[] = [];
  const build = builder(o.screenId, o, misses);
  const base = path.join(o.out, o.base ?? `${o.screenId}.${o.client}`);
  fs.mkdirSync(o.out, { recursive: true });
  const screen = await build(o.screenId, o.client, params, o.client === "desktop" ? DESKTOP_COMPONENTS : PHONE_COMPONENTS);
  // The window builds the screen again when it asks for it: count the first build's misses only.
  const missed = [...new Set(misses)];
  fs.writeFileSync(`${base}.json`, JSON.stringify(screen, null, 1));
  const drawn = o.client === "phone"
    ? await renderPhone(browser, screen, `${base}.png`, !!o.motion)
    : await renderDesktop(browser, o.screenId, params, build, `${base}.png`, !!o.motion);
  const r: Rendered = { client: o.client, json: `${base}.json`, png: `${base}.png`, screen, ...drawn, misses: missed };
  if (o.board && await renderBoard(browser, o.board, `${base}.board.png`, o.design)) r.board = `${base}.board.png`;
  if (o.compare ?? true) {
    const shots = [{ file: r.png, label: `${o.screenId} · ${o.client} renderer` }, ...(r.board ? [{ file: r.board, label: `${o.board}.dc.html` }] : [])];
    await compose(browser, shots, `${base}.compare.png`, o.client === "phone" ? 390 : 900);
    r.compare = `${base}.compare.png`;
  }
  return r;
}

// ------------------------------------------------------------------ the command

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (name: string): boolean => argv.includes(`--${name}`);
  const screenId = argv[0];
  if (!screenId || screenId.startsWith("--")) {
    console.error("usage: npx tsx scripts/bots-render/render.ts <bots.screen> [--board Main] [--desk-board DeskHome] [--client phone|desktop|both] [--params JSON] [--quiet] [--json file] [--motion]");
    process.exit(1);
  }
  const clients: Client[] = (flag("client") ?? "both") === "both" ? ["phone", "desktop"] : [flag("client") as Client];
  const params = flag("params") ? JSON.parse(flag("params")!) as Params : {};
  const out = path.resolve(flag("out") ?? path.join(HERE, "out"));
  const boards: Record<Client, string | undefined> = { phone: flag("board"), desktop: flag("desk-board") };
  const data: ScreenData = {
    api: flag("api") ? JSON.parse(flag("api")!) as Record<string, unknown> : {},
    quiet: has("quiet"),
    ...(flag("json") ? { served: JSON.parse(fs.readFileSync(flag("json")!, "utf8")) } : {}),
  };
  const browser = await launchBrowser();
  let failed = false;
  try {
    for (const client of clients) {
      const r = await renderClient(browser, { ...data, screenId, client, params, out, board: boards[client], motion: has("motion"), design: flag("design") ?? DEFAULT_DESIGN });
      for (const sp of r.spills) console.log(`  ${client}: spill: ${sp}`);
      for (const e of r.errors) { failed = true; console.error(`  ${client}: page error: ${e}`); }
      console.log(`${r.errors.length ? "ERRORS " : "OK     "} ${client}: ${path.relative(process.cwd(), r.compare!)}`);
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

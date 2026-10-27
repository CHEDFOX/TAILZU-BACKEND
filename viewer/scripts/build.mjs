#!/usr/bin/env node
/**
 * Build the viewer's static assets into public/:
 *
 *   public/assets/<name>.<hash>.js   the runtime (main), and the pieces loaded only when needed (compile, react-host), bundled by esbuild
 *   public/shell.html                the page `GET /` serves: inline CSS, the import map, the <script type=module> for main.
 *                                    The Worker fills in two things at request time: the allowed parent origins (meta tz-parents) and the CSP.
 *   public/vendor/…                  the pinned libraries (scripts/vendor.mjs; fetched first if missing)
 *
 * Run by `wrangler dev` / `wrangler deploy` (wrangler.jsonc: build.command) and by `npm run build`.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(root, "public");
const ASSETS = join(PUBLIC, "assets");

// 1. The vendored libraries (a no-op when public/vendor is complete).
execFileSync(process.execPath, [join(root, "scripts", "vendor.mjs"), ...process.argv.slice(2).filter((a) => a.startsWith("--react="))], { stdio: "inherit" });
const vendor = JSON.parse(readFileSync(join(PUBLIC, "vendor", "manifest.json"), "utf8"));

// 2. The runtime.
rmSync(ASSETS, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { main: "web/main.ts", compile: "web/compile.ts", "react-host": "web/react-host.ts" },
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: true,
  legalComments: "none",
  outdir: ASSETS,
  entryNames: "[name].[hash]",
  chunkNames: "chunk.[hash]",
  // Resolved by the page's import map at run time, not bundled.
  external: ["@tz/*", "react", "react-dom/client", "mermaid"],
  metafile: true,
  logLevel: "warning",
});

// The bootstrap of an html artifact's frame: a classic script (it must run, in order, while the frame's document is still being read).
const frame = await build({
  absWorkingDir: root,
  entryPoints: { frame: "web/frame.ts" },
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  minify: true,
  legalComments: "none",
  outdir: ASSETS,
  entryNames: "[name].[hash]",
  metafile: true,
  logLevel: "warning",
});

const outputs = { ...result.metafile.outputs, ...frame.metafile.outputs };
const byEntry = {};
for (const [file, meta] of Object.entries(outputs)) {
  if (meta.entryPoint) byEntry[meta.entryPoint] = "/assets/" + file.split("/").pop();
}
const imports = {
  ...vendor.imports,
  "@tz/compile": byEntry["web/compile.ts"],
  "@tz/react-host": byEntry["web/react-host.ts"],
  "@tz/frame": byEntry["web/frame.ts"],
};

// 3. The shell page.
const css = readFileSync(join(root, "web", "shell.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s*\n\s*/g, "")
  .replace(/\s*([{};:,])\s*/g, "$1");
const importMap = JSON.stringify({ imports });
const shell = readFileSync(join(root, "web", "shell.html"), "utf8")
  .replace("__CSS__", () => css)
  .replace("__IMPORTMAP__", () => importMap)
  .replace("__MAIN__", () => byEntry["web/main.ts"])
  .replace(/\n(?=<)/g, "\n");
writeFileSync(join(PUBLIC, "shell.html"), shell);

// 4. What a first-time visitor downloads before any library: the shell and the runtime it loads at once.
const mainOut = Object.entries(outputs).find(([, m]) => m.entryPoint === "web/main.ts");
const staticDeps = new Set();
const walk = (file) => {
  if (staticDeps.has(file)) return;
  staticDeps.add(file);
  for (const imp of outputs[file]?.imports ?? []) if (imp.kind === "import-statement" && outputs[imp.path]) walk(imp.path);
};
walk(mainOut[0]);
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const shellGz = gz(Buffer.from(shell.replace("__TZ_PARENTS__", "https://tailzu.space")));
let runtimeGz = 0;
let runtimeRaw = 0;
for (const f of staticDeps) {
  const buf = readFileSync(join(root, f));
  runtimeGz += gz(buf);
  runtimeRaw += buf.length;
}
const lazy = Object.entries(outputs)
  .filter(([f]) => !staticDeps.has(f))
  .map(([f, m]) => `${relative(ASSETS, join(root, f))} ${(gz(readFileSync(join(root, f))) / 1024).toFixed(1)} KB gz`);
console.log(`build: shell ${(shellGz / 1024).toFixed(1)} KB gz + runtime ${(runtimeGz / 1024).toFixed(1)} KB gz (${(runtimeRaw / 1024).toFixed(1)} KB raw) = ${((shellGz + runtimeGz) / 1024).toFixed(1)} KB gz before any library`);
console.log(`build: loaded on demand: ${lazy.join(", ")}`);

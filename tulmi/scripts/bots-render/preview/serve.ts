/**
 * Try the preview locally the way an Artifact serves it: the folder preview.ts wrote, every response under the Artifact's
 * content policy, and index.html wrapped in the skeleton an Artifact adds at publish.
 *
 *   cd tulmi && npx tsx scripts/bots-render/preview/serve.ts [--port 8787] [--dir scripts/bots-render/out/preview]
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const DIR = path.resolve(flag("dir") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../out/preview"));
const PORT = Number(flag("port") ?? 8787);
export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'self'";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css",
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const file = path.join(DIR, p === "/" ? "index.html" : p);
  if (!file.startsWith(DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { "Content-Security-Policy": CSP }); res.end(); return; }
  let body: Buffer | string = fs.readFileSync(file);
  if (p === "/" || p === "/index.html") {
    body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body.toString("utf8")}</body></html>`;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Content-Security-Policy": CSP });
  res.end(body);
}).listen(PORT, () => console.log(`preview: http://localhost:${PORT}/  (${DIR})`));

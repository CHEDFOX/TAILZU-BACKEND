/**
 * The artifact viewer Worker.
 *
 * Almost everything it serves is a static asset (Workers Static Assets: the runtime, the vendored libraries), answered by the
 * platform without running this code. The Worker runs for three paths only:
 *
 *   GET /          the shell page, with a Content-Security-Policy that depends on configuration (who may embed it), and that list
 *                  handed to the page so it can check the origin of every message
 *   GET /__host    a test stand-in for the app. Only when ENV is not production.
 *   /shell.html    the shell's template. Not public: the page without its CSP must not be reachable.
 *
 * It sets no cookie, reads no cookie, and holds no secret.
 */
import { OPAQUE, originAllowed, parseOrigins } from "../lib/origins.js";
import { buildCsp, sha256Base64, shellHeaders } from "./csp.js";
import { HOST_CSP, hostPage } from "./host-page.js";

export interface Env {
  /** Workers Static Assets binding (wrangler.jsonc: assets.binding). */
  ASSETS: { fetch(input: Request | string | URL): Promise<Response> };
  /** "production" turns the test host off. Anything but development / dev / test / local counts as production. */
  ENV?: string;
  /** Comma-separated origins of the app pages that may embed the viewer: https://x0bot.com,https://*.preview.x0bot.com. `null` is for the viewer kept for screenshots (docs section 14). */
  VIEWER_PARENT_ORIGINS?: string;
}

const DEV_ENVS = new Set(["development", "dev", "test", "local"]);
export const isProduction = (env: Env): boolean => !DEV_ENVS.has((env.ENV ?? "production").toLowerCase());

const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>/;

/**
 * `GET /?type=react`: the app knows the artifact's type before it opens the frame, so it can say so, and the page asks the browser for
 * everything that type will need at once instead of finding it out one file after another (compiler → Sucrase → React host → React → React DOM:
 * four round trips otherwise). Other types load nothing extra: Markdown and SVG need no library at all.
 */
const PRELOAD: Record<string, string[]> = {
  react: ["@tz/compile", "@tz/sucrase", "@tz/react-host", "react", "react/jsx-runtime", "react-dom"],
};

function preloadHints(type: string | null, importMap: string | undefined): string {
  const wanted = type ? PRELOAD[type] : undefined;
  if (!wanted || !importMap) return "";
  try {
    const imports = (JSON.parse(importMap) as { imports: Record<string, string> }).imports;
    return [...new Set(wanted.map((spec) => imports[spec]).filter((u): u is string => typeof u === "string" && u.startsWith("/")))].map((u) => `<link rel="modulepreload" href="${u}">`).join("");
  } catch {
    return "";
  }
}

/**
 * The origins allowed to embed the viewer. Outside production the test host (this Worker's own origin) is one of them. `null` in the list means a parent
 * with an opaque origin (a screenshot's host page, docs section 14): it is kept in the list the page checks messages against.
 */
export function parentOrigins(env: Env, requestUrl: URL): string[] {
  const list = parseOrigins(env.VIEWER_PARENT_ORIGINS, { opaque: true });
  if (!isProduction(env) && !originAllowed(requestUrl.origin, list)) list.push(requestUrl.origin.toLowerCase());
  return list;
}

async function shell(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const template = await env.ASSETS.fetch(new Request(new URL("/shell.html", url)));
  if (!template.ok) return new Response("The viewer has not been built (public/shell.html is missing). Run `npm run build`.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const parents = parentOrigins(env, url);
  const source = await template.text();
  const map = IMPORT_MAP.exec(source);
  const hints = preloadHints(url.searchParams.get("type"), map?.[1]);
  const html = source.replace("__TZ_PARENTS__", () => parents.join(",")).replace("</head>", () => hints + "</head>");
  // `frame-ancestors` cannot name an opaque origin, so a viewer that lists `null` (kept for screenshots) is framed by any page and says no more of it.
  const anyParent = parents.includes(OPAQUE);
  const csp = buildCsp({ parents: parents.filter((p) => p !== OPAQUE), importMapHash: map ? await sha256Base64(map[1]!) : null, anyParent });
  return new Response(request.method === "HEAD" ? null : html, { headers: shellHeaders(csp) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/":
        return shell(request, env);
      case "/__host":
        if (isProduction(env)) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
        return new Response(request.method === "HEAD" ? null : hostPage(), {
          headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": HOST_CSP, "cache-control": "no-store", "x-content-type-options": "nosniff" },
        });
      case "/shell.html":
        return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
      default:
        // Reached only for a path with no asset: the platform answers asset paths itself.
        return env.ASSETS.fetch(request);
    }
  },
};

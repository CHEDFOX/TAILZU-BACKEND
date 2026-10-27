/** The Worker in workerd: the shell page's headers and CSP, the origin list, the /__host gate. */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ARTIFACT_LIBS } from "../../tulmi/src/artifacts/protocol.js";
import worker, { type Env } from "../src/index.js";

const call = (path: string, over: Partial<Env> = {}, init?: RequestInit): Promise<Response> =>
  worker.fetch(new Request(`https://viewer.example${path}`, init), { ...env, ...over });

const csp = async (over: Partial<Env> = {}): Promise<string> => (await call("/", over)).headers.get("content-security-policy")!;
const directive = (policy: string, name: string): string => policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ") || d === name) ?? "";

const PROD: Partial<Env> = { ENV: "production", VIEWER_PARENT_ORIGINS: "https://tailzu.space,https://www.tailzu.space" };

describe("GET /", () => {
  it("serves the shell page as html, with no cookie", async () => {
    const res = await call("/", PROD);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<script type="module" src="/assets/main.');
    expect(html).toContain('<script type="importmap">');
  });

  it("has the strict CSP", async () => {
    const p = await csp(PROD);
    expect(directive(p, "default-src")).toBe("default-src 'none'");
    expect(directive(p, "connect-src")).toBe("connect-src 'none'");
    expect(directive(p, "form-action")).toBe("form-action 'none'");
    expect(directive(p, "base-uri")).toBe("base-uri 'none'");
    expect(directive(p, "sandbox")).toBe("sandbox allow-scripts");
    expect(directive(p, "font-src")).toBe("font-src https://fonts.gstatic.com");
    expect(directive(p, "img-src")).toBe("img-src data: blob: https:");
    expect(directive(p, "style-src")).toBe("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    // Scripts: this origin, blobs (the compiled artifact), and the one inline script, by hash. Never eval, never 'unsafe-inline'.
    expect(directive(p, "script-src")).toMatch(/^script-src 'self' blob: 'sha256-[A-Za-z0-9+/]+=*'$/);
    expect(p).not.toContain("unsafe-eval");
    expect(directive(p, "script-src")).not.toContain("unsafe-inline");
    expect(p).not.toMatch(/\*(?![.])/); // no bare wildcard source anywhere
  });

  it("names the import map by its hash, so the CSP matches the page byte for byte", async () => {
    const res = await call("/", PROD);
    const html = await res.text();
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(map)));
    const b64 = btoa(String.fromCharCode(...digest));
    expect(res.headers.get("content-security-policy")).toContain(`'sha256-${b64}'`);
    // and the map is JSON that names the libraries of protocol.ts
    const imports = (JSON.parse(map) as { imports: Record<string, string> }).imports;
    for (const lib of ARTIFACT_LIBS) expect(imports[lib], lib).toMatch(/^\/vendor\//);
    for (const sub of ["react/jsx-runtime", "react-dom/client"]) expect(imports[sub], sub).toMatch(/^\/vendor\//);
    expect(imports["@tz/compile"]).toMatch(/^\/assets\/compile\.[A-Z0-9]+\.js$/);
  });

  it("asks the browser for what a react artifact needs up front when the app says the type: /?type=react", async () => {
    const html = await (await call("/?type=react", PROD)).text();
    const links = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]!);
    expect(links.length).toBe(6);
    for (const spec of ["react", "react-dom", "react/jsx-runtime", "@tz/compile", "@tz/sucrase", "@tz/react-host"]) {
      const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!).imports as Record<string, string>;
      expect(links, spec).toContain(map[spec]);
    }
    // Nothing for the types that need no library, nothing for a type that is not one, no way to inject through it.
    for (const q of ["/", "/?type=markdown", "/?type=svg", "/?type=nope", '/?type="><script>x</script>']) {
      const body = await (await call(q, PROD)).text();
      expect(body, q).not.toContain("modulepreload");
      expect(body, q).not.toContain("<script>x</script>");
    }
  });

  it("lets only the configured app embed it (frame-ancestors), and tells the page who that is", async () => {
    const res = await call("/", PROD);
    expect(directive(res.headers.get("content-security-policy")!, "frame-ancestors")).toBe("frame-ancestors https://tailzu.space https://www.tailzu.space");
    expect(await res.text()).toContain('<meta name="tz-parents" content="https://tailzu.space,https://www.tailzu.space">');
  });

  it("fails closed: no valid origin configured, nobody may embed it", async () => {
    for (const bad of [undefined, "", "   ", "*", "nul", "javascript:alert(1)", "https://evil.example/path", "https://*.com"]) {
      expect(directive(await csp({ ENV: "production", VIEWER_PARENT_ORIGINS: bad }), "frame-ancestors"), String(bad)).toBe("frame-ancestors 'none'");
    }
    const html = await (await call("/", { ENV: "production", VIEWER_PARENT_ORIGINS: "*" })).text();
    expect(html).toContain('<meta name="tz-parents" content="">');
  });

  it("shot mode: `null` in the list means a parent with an opaque origin, which frame-ancestors cannot name, so the directive is left out", async () => {
    const res = await call("/", { ENV: "production", VIEWER_PARENT_ORIGINS: "null" });
    const policy = res.headers.get("content-security-policy")!;
    expect(policy).not.toContain("frame-ancestors");
    // The rest of the policy is the strict one, unchanged.
    expect(directive(policy, "default-src")).toBe("default-src 'none'");
    expect(directive(policy, "connect-src")).toBe("connect-src 'none'");
    expect(directive(policy, "sandbox")).toBe("sandbox allow-scripts");
    expect(policy).not.toContain("unsafe-eval");
    // The page is told who may talk to it: opaque parents, and nobody else.
    expect(await res.text()).toContain('<meta name="tz-parents" content="null">');
    // Named origins next to it are still handed to the page, but only `null` has a say in the (absent) header.
    const both = await call("/", { ENV: "production", VIEWER_PARENT_ORIGINS: "https://tailzu.space, null" });
    expect(directive(both.headers.get("content-security-policy")!, "frame-ancestors")).toBe("");
    expect(await both.text()).toContain('content="https://tailzu.space,null"');
  });

  it("the normal viewer (no `null`) still names its parents, and /__host stays off in production in either mode", async () => {
    expect(directive(await csp(PROD), "frame-ancestors")).toBe("frame-ancestors https://tailzu.space https://www.tailzu.space");
    expect((await call("/__host", { ENV: "production", VIEWER_PARENT_ORIGINS: "null" })).status).toBe(404);
  });

  it("keeps wildcard subdomain entries, drops junk, and cannot be broken out of with a crafted value", async () => {
    const res = await call("/", { ENV: "production", VIEWER_PARENT_ORIGINS: 'https://*.preview.tailzu.space, https://a.b"><script>x</script>, http://localhost:3000;sandbox' });
    expect(directive(res.headers.get("content-security-policy")!, "frame-ancestors")).toBe("frame-ancestors https://*.preview.tailzu.space");
    expect(await res.text()).not.toContain("<script>x</script>");
  });

  it("outside production, the page's own origin may embed it too (for /__host); in production it may not", async () => {
    expect(directive(await csp({ ENV: "development", VIEWER_PARENT_ORIGINS: "https://tailzu.space" }), "frame-ancestors")).toBe("frame-ancestors https://tailzu.space https://viewer.example");
    expect(directive(await csp(PROD), "frame-ancestors")).not.toContain("viewer.example");
  });

  it("carries the other protective headers", async () => {
    const h = (await call("/", PROD)).headers;
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-robots-tag")).toContain("noindex");
    expect(h.get("permissions-policy")).toMatch(/camera=\(\)/);
    expect(h.get("permissions-policy")).toMatch(/geolocation=\(\)/);
    expect(h.get("x-frame-options")).toBeNull(); // frame-ancestors decides; a DENY here would stop the app too
    expect(h.get("cache-control")).toBe("public, max-age=300");
  });

  it("answers HEAD with the headers and no body, and refuses everything but GET and HEAD", async () => {
    const head = await call("/", PROD, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-security-policy")).toBeTruthy();
    expect(await head.text()).toBe("");
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await call("/", PROD, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  it("does not expose the shell's template (the page without its CSP)", async () => {
    expect((await call("/shell.html", PROD)).status).toBe(404);
  });

  it("is a clear 503 when the viewer was not built", async () => {
    const res = await call("/", { ...PROD, ASSETS: { fetch: async () => new Response("no", { status: 404 }) } });
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/npm run build/);
  });
});

describe("GET /__host (the test stand-in for the app)", () => {
  it("is served in development with its own tight CSP", async () => {
    for (const e of ["development", "dev", "test", "local", "Development"]) {
      const res = await call("/__host", { ENV: e });
      expect(res.status, e).toBe(200);
      const html = await res.text();
      expect(html).toContain('sandbox');
      expect(html).toContain("window.host");
      const p = res.headers.get("content-security-policy")!;
      expect(p).toContain("default-src 'none'");
      expect(p).toContain("frame-src 'self'");
      expect(p).not.toContain("connect-src https");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("is a 404 in production, whatever the case, and when ENV is anything else or missing", async () => {
    for (const e of ["production", "Production", "PRODUCTION", "prod", "staging", "", undefined]) {
      const res = await call("/__host", { ENV: e });
      expect(res.status, String(e)).toBe(404);
      expect(await res.text()).not.toContain("window.host");
    }
    // The wrangler.jsonc default is production.
    const fromConfig = await worker.fetch(new Request("https://viewer.example/__host"), { ...env, ENV: undefined });
    expect(fromConfig.status).toBe(404);
  });

  it("mounts the viewer in an iframe with exactly sandbox=allow-scripts", async () => {
    const html = await (await call("/__host", { ENV: "development" })).text();
    expect(html).toContain("setAttribute('sandbox', 'allow-scripts')");
    expect(html).not.toContain("allow-same-origin");
  });
});

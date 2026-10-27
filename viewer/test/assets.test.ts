/** The static assets as the platform serves them: found, typed, cached for ever, readable from a sandboxed frame. */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const IMMUTABLE = "public, max-age=31536000, immutable";

async function importMap(): Promise<Record<string, string>> {
  const html = await (await SELF.fetch("https://viewer.example/")).text();
  return (JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!) as { imports: Record<string, string> }).imports;
}

describe("assets served by Workers Static Assets", () => {
  it("every file the import map names exists, is JavaScript, is cached for ever and carries CORS (the frame's origin is opaque)", async () => {
    const imports = await importMap();
    const urls = [...new Set(Object.values(imports))];
    expect(urls.length).toBeGreaterThanOrEqual(12);
    for (const url of urls) {
      const res = await SELF.fetch(`https://viewer.example${url}`);
      expect(res.status, url).toBe(200);
      expect(res.headers.get("content-type"), url).toMatch(/javascript/);
      expect(res.headers.get("cache-control"), url).toBe(IMMUTABLE);
      expect(res.headers.get("access-control-allow-origin"), url).toBe("*");
      expect(res.headers.get("x-content-type-options"), url).toBe("nosniff");
      await res.arrayBuffer();
    }
  });

  it("the file names carry a hash of their content (so 'immutable' is true)", async () => {
    const imports = await importMap();
    for (const [spec, url] of Object.entries(imports)) {
      if (spec === "mermaid") expect(url, spec).toMatch(/^\/vendor\/mermaid@[\d.]+\.[0-9a-f]{10}\/mermaid\.esm\.min\.mjs$/);
      else if (url.startsWith("/vendor/")) expect(url, spec).toMatch(/^\/vendor\/[\w.@-]+\.[0-9a-f]{10}\.js$/);
      else expect(url, spec).toMatch(/^\/assets\/[\w-]+\.[A-Z0-9]{8}\.js$/);
    }
  });

  it("a lazily loaded mermaid chunk is cached for ever too", async () => {
    const main = (await importMap())["mermaid"]!;
    const dir = main.slice(0, main.lastIndexOf("/"));
    const src = await (await SELF.fetch(`https://viewer.example${main}`)).text();
    const chunk = /from"\.\/(chunks\/mermaid\.esm\.min\/chunk-[A-Z0-9]+\.mjs)"/.exec(src)![1]!;
    const res = await SELF.fetch(`https://viewer.example${dir}/${chunk}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    await res.arrayBuffer();
  });

  it("answers a conditional request with 304 (the platform's ETag)", async () => {
    const url = `https://viewer.example${(await importMap())["react"]}`;
    const first = await SELF.fetch(url);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    await first.arrayBuffer();
    const second = await SELF.fetch(url, { headers: { "if-none-match": etag! } });
    expect(second.status).toBe(304);
  });

  it("does not serve the build's own bookkeeping, and an unknown path is a plain 404", async () => {
    expect((await SELF.fetch("https://viewer.example/vendor/manifest.json")).status).toBe(404);
    expect((await SELF.fetch("https://viewer.example/assets/nothing.js")).status).toBe(404);
    expect((await SELF.fetch("https://viewer.example/index.html")).status).toBe(404);
    expect((await SELF.fetch("https://viewer.example/_headers")).status).toBe(404);
  });

  it("publishes the integrity list of the vendored files, without the forever-cache (its name does not change)", async () => {
    const res = await SELF.fetch("https://viewer.example/vendor/integrity.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const list = (await res.json()) as { algorithm: string; files: Record<string, string> };
    expect(list.algorithm).toBe("sha384");
    expect(Object.keys(list.files).length).toBeGreaterThan(100);
    for (const h of Object.values(list.files)) expect(h).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
  });
});

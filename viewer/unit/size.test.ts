import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const gz = (b: Buffer | string): number => gzipSync(b, { level: 9 }).length;

/** The built shell page and the runtime it loads at once (not what is loaded later, when an artifact needs it). */
function firstLoad(): { shell: number; runtime: number; files: string[] } {
  const shell = readFileSync(join(pub, "shell.html"), "utf8");
  const main = /<script type="module" src="(\/assets\/main\.[^"]+)">/.exec(shell)![1]!;
  const seen = new Set<string>();
  const walk = (url: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    const code = readFileSync(join(pub, url), "utf8");
    for (const m of code.matchAll(/(?:from|import)\s*["'](\.\/[^"']+)["']/g)) walk("/assets/" + m[1]!.slice(2));
  };
  walk(main);
  const runtime = [...seen].reduce((n, f) => n + gz(readFileSync(join(pub, f))), 0);
  return { shell: gz(shell.replace("__TZ_PARENTS__", "https://tailzu.space")), runtime, files: [...seen] };
}

describe("size of what the viewer loads first", () => {
  it("the shell page plus the runtime is under 60 KB gzipped, before any library", () => {
    const { shell, runtime, files } = firstLoad();
    console.log(`first load: shell ${(shell / 1024).toFixed(1)} KB + runtime ${(runtime / 1024).toFixed(1)} KB gzip (${files.join(", ")})`);
    expect((shell + runtime) / 1024).toBeLessThan(60);
  });

  it("the compiler, React's host, the frame bootstrap and the libraries are separate files, loaded only when needed", () => {
    const { files } = firstLoad();
    const all = readdirSync(join(pub, "assets"));
    for (const lazy of ["compile", "react-host", "frame"]) {
      expect(all.some((f) => f.startsWith(lazy + ".")), lazy).toBe(true);
      expect(files.some((f) => f.includes(`/${lazy}.`)), `${lazy} is not in the first load`).toBe(false);
    }
    // Nothing from vendor is in the first load, and the biggest vendored files are the ones that are not.
    const main = readFileSync(join(pub, files[0]!), "utf8");
    expect(main).not.toContain("sucrase");
    expect(main).not.toMatch(/\/vendor\//);
  });

  it("has no source maps or other extras in the served assets", () => {
    for (const f of readdirSync(join(pub, "assets"))) expect(f).toMatch(/\.js$/);
    expect(statSync(join(pub, "shell.html")).size).toBeLessThan(8 * 1024);
  });
});

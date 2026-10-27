import { describe, expect, it } from "vitest";
import { originAllowed, parseOrigins } from "../lib/origins.js";
import { decodeMappings, makeLookup } from "../lib/srcmap.js";
import { looksLikeTailwind, tailwindConfigToCss } from "../lib/tailwind.js";

describe("parseOrigins", () => {
  it("keeps valid origins, lower-cased, without duplicates, and drops the rest", () => {
    expect(parseOrigins(" https://Tailzu.space, https://www.tailzu.space/ ,https://tailzu.space http://localhost:3000")).toEqual([
      "https://tailzu.space",
      "https://www.tailzu.space",
      "http://localhost:3000",
    ]);
    expect(parseOrigins("*, null, https://*.com, https://a.b/path, ftp://x.y, https://x.y:99999, javascript:alert(1)")).toEqual([]);
    expect(parseOrigins("https://*.preview.tailzu.space")).toEqual(["https://*.preview.tailzu.space"]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins("")).toEqual([]);
  });
});

describe("originAllowed", () => {
  const allowed = ["https://tailzu.space", "https://*.preview.tailzu.space", "http://localhost:3000"];
  it("matches exactly, by scheme, host and port", () => {
    expect(originAllowed("https://tailzu.space", allowed)).toBe(true);
    expect(originAllowed("https://TAILZU.space", allowed)).toBe(true);
    expect(originAllowed("http://tailzu.space", allowed)).toBe(false);
    expect(originAllowed("https://tailzu.space:8443", allowed)).toBe(false);
    expect(originAllowed("https://tailzu.space.evil.example", allowed)).toBe(false);
    expect(originAllowed("https://eviltailzu.space", allowed)).toBe(false);
    expect(originAllowed("http://localhost:3000", allowed)).toBe(true);
    expect(originAllowed("http://localhost:3001", allowed)).toBe(false);
    expect(originAllowed("null", allowed)).toBe(false);
    expect(originAllowed("", allowed)).toBe(false);
  });
  it("wildcards match subdomains only", () => {
    expect(originAllowed("https://pr-12.preview.tailzu.space", allowed)).toBe(true);
    expect(originAllowed("https://a.b.preview.tailzu.space", allowed)).toBe(true);
    expect(originAllowed("https://preview.tailzu.space", allowed)).toBe(false);
    expect(originAllowed("https://xpreview.tailzu.space", allowed)).toBe(false);
    expect(originAllowed("https://*.preview.tailzu.space", allowed)).toBe(false);
    expect(originAllowed("https://tailzu.space", [])).toBe(false);
  });
});

describe("source maps", () => {
  it("decodes VLQ mappings and finds the source position", () => {
    // "AAAA,SAASA;AACT" : line 1 col 0 -> (0,0); col 9 -> (0,9); line 2 col 0 -> (1,~)
    const decoded = decodeMappings("AAAA,SAASA;AACT");
    expect(decoded).toHaveLength(2);
    expect(decoded[0]![0]).toEqual([0, 0, 0]);
    expect(decoded[0]![1]![0]).toBe(9);
    const look = makeLookup({ mappings: "AAAA,SAASA;AACT" });
    expect(look(1, 1)).toEqual({ line: 1, col: 1 });
    expect(look(1, 12)).toEqual({ line: 1, col: 12 });
    expect(look(2, 1)!.line).toBe(2);
    expect(look(5, 1)).toBeUndefined();
    expect(makeLookup(undefined)(1, 1)).toBeUndefined();
  });
  it("does not choke on garbage", () => {
    expect(() => decodeMappings("!!!;;;,,,AAAA;;;")).not.toThrow();
  });
});

describe("tailwind helpers", () => {
  it("recognises Tailwind classes, but not words that merely look like them", () => {
    expect(looksLikeTailwind(`<div className="flex items-center gap-4 p-4 text-gray-600 rounded-lg"/>`)).toBe(true);
    expect(looksLikeTailwind(`<div class="md:flex bg-blue-500 text-white font-bold"></div>`)).toBe(true);
    expect(looksLikeTailwind(`<div className={cn("w-1/2 mt-4", active && "bg-blue-500")}>`)).toBe(true);
    expect(looksLikeTailwind(`<div className={cn("w-1/2", active && "flex")}>`)).toBe(false);
    expect(looksLikeTailwind(`<div className={isOn ? "p-4 text-sm" : "p-2 text-gray-500 bg-white"} />`)).toBe(true);
    expect(looksLikeTailwind(`<div className="container flex card" /><span class="hidden grid block">x</span>`)).toBe(false);
    expect(looksLikeTailwind(`const x = "p-4 m-2 w-3";`)).toBe(false);
  });
  it("turns a tailwind.config into CSS for Tailwind 4's browser build", () => {
    const css = tailwindConfigToCss({
      darkMode: "class",
      content: ["./src/**/*.tsx"],
      plugins: [() => 1],
      theme: {
        extend: {
          colors: { brand: { DEFAULT: "#123456", 500: "#654321" }, ink: "#111", "bad name": "red" },
          fontFamily: { display: ["Space Grotesk", "sans-serif"] },
          borderRadius: { card: "14px" },
          spacing: { gutter: "2rem" },
          fontSize: { huge: ["4rem", { lineHeight: "1" }] },
          screens: { tablet: "800px" },
        },
      },
    });
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain("@custom-variant dark (&:where(.dark, .dark *));");
    expect(css).toContain("--color-brand: #123456;");
    expect(css).toContain("--color-brand-500: #654321;");
    expect(css).toContain("--color-ink: #111;");
    expect(css).not.toContain("bad name");
    expect(css).toContain('--font-display: "Space Grotesk", sans-serif;');
    expect(css).toContain("--radius-card: 14px;");
    expect(css).toContain("--spacing-gutter: 2rem;");
    expect(css).toContain("--text-huge: 4rem;");
    expect(css).toContain("--text-huge--line-height: 1;");
    expect(css).toContain("--breakpoint-tablet: 800px;");
    expect(css).not.toContain("--color-*: initial");
  });
  it("a theme that replaces the default colors clears the default palette, and a value cannot break out of the block", () => {
    const css = tailwindConfigToCss({ theme: { colors: { x: "red; } body { display:none", y: "#fff" } } });
    expect(css).toContain("--color-*: initial;");
    expect(css).toContain("--color-y: #fff;");
    expect(css).not.toContain("display:none");
    expect(tailwindConfigToCss(undefined)).toContain("@theme");
  });
});

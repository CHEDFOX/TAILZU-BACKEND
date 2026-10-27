import { expect, test } from "@playwright/test";
import { htmlDoc, load, openHost, viewer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

const KIT = {
  css: ":root{--tz-brand:#ff0066;--tz-radius:12px;--tz-ink:#112233} body{font-family:'Fraunces',serif;color:var(--tz-ink)} .kit-note{outline:3px solid var(--tz-brand)}\n@import url('https://evil.example/steal.css');",
  fonts: ["https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap", "https://evil.example/fonts.css", "http://fonts.googleapis.com/css2?family=Inter"],
};

test.describe("design kit", () => {
  test("kit CSS is applied before the artifact: its variables and base styles are there, and the artifact's own styles still win", async ({ page }) => {
    const content = `export default function App() {
  return (
    <div>
      <p id="brand" style={{ background: "var(--tz-brand)", borderRadius: "var(--tz-radius)" }}>brand</p>
      <p id="ink">ink</p>
      <style>{".mine{color:rgb(1,2,3)} body{color:rgb(9,9,9)}"}</style>
      <p id="mine" className="mine">mine</p>
    </div>
  );
}`;
    const out = await load(page, { type: "react", content }, { kit: KIT });
    expect(out.errors).toEqual([]);
    const v = viewer(page);
    await expect(v.locator("#brand")).toHaveCSS("background-color", "rgb(255, 0, 102)");
    await expect(v.locator("#brand")).toHaveCSS("border-top-left-radius", "12px");
    await expect(v.locator("#mine")).toHaveCSS("color", "rgb(1, 2, 3)");
    // The kit's style element comes before everything the artifact added.
    expect(
      await v.locator("body").evaluate(() => {
        const kit = document.querySelector("style[data-tz-kit]")!;
        const mine = Array.from(document.querySelectorAll("style")).find((s) => s.textContent!.includes(".mine"))!;
        return !!(kit.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
  });

  test("fonts are loaded only from the Google Fonts CSS host (https), and no other @import survives", async ({ page }) => {
    await load(page, { type: "react", content: `export default () => <p>x</p>;` }, { kit: KIT });
    const v = viewer(page);
    const links = await v.locator("body").evaluate(() => Array.from(document.querySelectorAll("link[rel=stylesheet]")).map((l) => (l as HTMLLinkElement).href));
    expect(links).toEqual(["https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap"]);
    const css = await v.locator("style[data-tz-kit]").first().textContent();
    expect(css).not.toContain("evil.example");
    expect(css).toContain("--tz-brand:#ff0066");
  });

  test("a new kit replaces the old one; no kit removes it", async ({ page }) => {
    await load(page, { type: "react", content: `export default () => <p id="p" style={{ color: "var(--tz-x, red)" }}>x</p>;` }, { kit: { css: ":root{--tz-x:blue}" } });
    const v = viewer(page);
    await expect(v.locator("#p")).toHaveCSS("color", "rgb(0, 0, 255)");
    await load(page, { type: "react", content: `export default () => <p id="p" style={{ color: "var(--tz-x, red)" }}>x</p>;` }, { kit: { css: ":root{--tz-x:green}" }, version: 2 });
    await expect(v.locator("#p")).toHaveCSS("color", "rgb(0, 128, 0)");
    await load(page, { type: "react", content: `export default () => <p id="p" style={{ color: "var(--tz-x, red)" }}>x</p>;` }, { version: 3 });
    await expect(v.locator("#p")).toHaveCSS("color", "rgb(255, 0, 0)");
  });

  test("html: the kit is in the artifact's document, before its own styles", async ({ page }) => {
    const content = `<!doctype html><html><head><style>.own{color:rgb(4,5,6)} .kit-note{outline-width:5px}</style></head><body><p id="a" style="background:var(--tz-brand)">a</p><p id="b" class="own kit-note">b</p></body></html>`;
    const out = await load(page, { type: "html", content }, { kit: KIT });
    expect(out.errors).toEqual([]);
    const d = htmlDoc(page);
    await expect(d.locator("#a")).toHaveCSS("background-color", "rgb(255, 0, 102)");
    await expect(d.locator("#b")).toHaveCSS("color", "rgb(4, 5, 6)");
    await expect(d.locator("#b")).toHaveCSS("outline-width", "5px"); // the artifact's rule beats the kit's
    await expect(d.locator("#b")).toHaveCSS("outline-color", "rgb(255, 0, 102)");
  });

  test("the theme reaches the artifact: color-scheme, data-theme and a .dark class", async ({ page }) => {
    await load(page, { type: "react", content: `export default () => <p id="p">x</p>;` }, { theme: "dark" });
    const v = viewer(page);
    expect(await v.locator("html").evaluate((h) => [h.getAttribute("data-theme"), h.classList.contains("dark"), getComputedStyle(h).colorScheme])).toEqual(["dark", true, "dark"]);
    await load(page, { type: "html", content: `<p id="p">x</p>` }, { theme: "dark", id: "h" });
    expect(await htmlDoc(page).locator("html").evaluate((h) => [h.getAttribute("data-theme"), h.classList.contains("dark")])).toEqual(["dark", true]);
  });

  test("mermaid follows the theme", async ({ page }) => {
    await load(page, { type: "mermaid", content: "graph LR; A-->B" }, { theme: "dark" });
    const dark = await viewer(page).locator(".tz-mermaid svg").evaluate((s) => s.outerHTML.length);
    expect(dark).toBeGreaterThan(500);
  });
});

test.describe("Tailwind", () => {
  const tw = `export default function App() {
  return (
    <div id="card" className="p-4 flex items-center gap-2 rounded-lg bg-blue-100 text-xl font-bold dark:bg-slate-800">
      <span id="a" className="px-2 py-1 text-gray-600">hello</span>
      <span id="b" className="ml-auto w-1/2">right</span>
    </div>
  );
}`;

  test("classes that look like Tailwind get Tailwind's CSS", async ({ page }) => {
    const out = await load(page, { type: "react", content: tw });
    expect(out.errors).toEqual([]);
    const v = viewer(page);
    await expect(v.locator("#card")).toHaveCSS("padding-top", "16px");
    await expect(v.locator("#card")).toHaveCSS("display", "flex");
    await expect(v.locator("#card")).toHaveCSS("border-top-left-radius", "8px");
    await expect(v.locator("#card")).toHaveCSS("font-weight", "700");
    await expect(v.locator("#a")).toHaveCSS("padding-left", "8px");
    await expect(v.locator("#b")).toHaveCSS("margin-left", /^[1-9]/); // ml-auto: the free space
    expect(await v.locator("#card").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("it is fetched only when wanted: not for an artifact whose classes are its own", async ({ page }) => {
    const seen: string[] = [];
    page.on("request", (r) => seen.push(new URL(r.url()).pathname));
    await load(page, { type: "react", content: `export default () => <div className="container flex card"><p className="hidden grid">x</p></div>;` });
    expect(seen.some((p) => /tailwind-browser/.test(p))).toBe(false);
    await load(page, { type: "react", content: tw }, { id: "tw" });
    await expect(viewer(page).locator("#card")).toHaveCSS("padding-top", "16px");
    expect(seen.some((p) => /tailwind-browser/.test(p))).toBe(true);
  });

  test("the kit says tailwind: its config is applied (colors, fonts, radii) and dark: follows the app's theme", async ({ page }) => {
    const kit = {
      css: ":root{--tz-x:1}",
      tailwind: { config: { theme: { extend: { colors: { brand: { DEFAULT: "#ff0066", dark: "#220011" } }, borderRadius: { card: "14px" }, fontFamily: { display: ["Fraunces", "serif"] } } } } },
    };
    const content = `export default () => (
  <div>
    <p id="a" className="bg-brand text-white">a</p>
    <p id="b" className="bg-brand-dark">b</p>
    <p id="c" className="rounded-card">c</p>
    <p id="d" className="font-display">d</p>
    <p id="e" className="bg-white dark:bg-brand">e</p>
  </div>
);`;
    await load(page, { type: "react", content }, { kit, theme: "dark" });
    const v = viewer(page);
    await expect(v.locator("#a")).toHaveCSS("background-color", "rgb(255, 0, 102)");
    await expect(v.locator("#b")).toHaveCSS("background-color", "rgb(34, 0, 17)");
    await expect(v.locator("#c")).toHaveCSS("border-top-left-radius", "14px");
    expect(await v.locator("#d").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("Fraunces");
    await expect(v.locator("#e")).toHaveCSS("background-color", "rgb(255, 0, 102)"); // dark: applies, because the theme is dark
    await load(page, { type: "react", content }, { kit, theme: "light", version: 2 });
    await expect(v.locator("#e")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  });

  test("html: classes, and a Tailwind CDN <script>, get Tailwind (the bundled build)", async ({ page }) => {
    const content = `<script src="https://cdn.tailwindcss.com"></script>
<div id="card" class="p-6 bg-green-100 rounded-xl text-lg flex gap-3"><b id="x" class="font-bold text-red-600">hi</b></div>`;
    const out = await load(page, { type: "html", content });
    expect(out.errors).toEqual([]);
    const d = htmlDoc(page);
    await expect(d.locator("#card")).toHaveCSS("padding-top", "24px");
    await expect(d.locator("#card")).toHaveCSS("display", "flex");
    await expect(d.locator("#x")).toHaveCSS("font-weight", "700");
  });
});

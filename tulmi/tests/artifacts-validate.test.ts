/**
 * Validation (src/artifacts/validate.ts): size, secrets (refused, by kind, never the value), react imports and the default export, network
 * calls (a warning: the viewer blocks them anyway), and html that must be self-contained.
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

const { validateArtifact, assertValid, importsOf, packageOf, hasDefaultExport } = await import("../src/artifacts/validate.js");
const { LIMITS, ARTIFACT_LIBS } = await import("../src/artifacts/protocol.js");
const { FAKE_AWS, FAKE_GH, FAKE_STRIPE } = await import("./artifacts-rig.js");

const react = (body: string) => validateArtifact({ type: "react", content: body });
const html = (body: string) => validateArtifact({ type: "html", content: body });

describe("size", () => {
  it("allows up to the protocol's limit and refuses past it, in KB, before anything else is read", () => {
    const ok = "a".repeat(LIMITS.contentBytes - 10);
    expect(validateArtifact({ type: "markdown", content: ok }).ok).toBe(true);
    const big = validateArtifact({ type: "markdown", content: "a".repeat(LIMITS.contentBytes + 1) });
    expect(big.ok).toBe(false);
    expect(big.errors[0]).toMatch(/512 KB an artifact may be/);
    // bytes, not characters: a text of 3-byte characters is over at a third of the length
    expect(validateArtifact({ type: "markdown", content: "€".repeat(Math.ceil(LIMITS.contentBytes / 3) + 1) }).ok).toBe(false);
    expect(() => assertValid({ type: "markdown", content: "a".repeat(LIMITS.contentBytes + 1) })).toThrowError(expect.objectContaining({ code: "too_large" }));
  });

  it("refuses an empty artifact and a NUL", () => {
    expect(validateArtifact({ type: "html", content: "   \n" }).errors[0]).toMatch(/empty/);
    expect(validateArtifact({ type: "html", content: "<p>a\u0000b</p>" }).errors.join(" ")).toMatch(/NUL/);
  });
});

describe("secrets", () => {
  it("are refused by kind, and the value is never repeated", () => {
    for (const [secret, kind] of [[FAKE_AWS, /AWS access key/], [FAKE_GH, /GitHub token/], [FAKE_STRIPE, /Stripe key/]] as const) {
      const r = html(`<script>const key = "${secret}";</script>`);
      expect(r.ok).toBe(false);
      expect(r.errors.join(" ")).toMatch(kind);
      expect(JSON.stringify(r)).not.toContain(secret);
    }
    expect(react(`export default function A() { const k = "${FAKE_AWS}"; return <p>{k}</p>; }`).ok).toBe(false);
  });

  it("are refused with words for the bot, as a secret error", () => {
    try {
      assertValid({ type: "html", content: `<p>${FAKE_STRIPE}</p>` });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toMatchObject({ code: "secret", status: 422 });
      expect((err as Error).message).toMatch(/not kept.*Anyone who opens an artifact can read it.*no environment/);
      expect((err as Error).message).not.toContain(FAKE_STRIPE);
    }
  });

  it("do not catch ordinary text", () => {
    expect(html("<p>The api key goes in your settings. Tokens: ABC.</p>").ok).toBe(true);
  });
});

describe("react imports", () => {
  it("allows every library the protocol lists, subpaths included", () => {
    const lines = ARTIFACT_LIBS.map((l) => `import * as x_${l.replace(/\W/g, "_")} from "${l}";`).join("\n");
    expect(react(`${lines}\nimport { createRoot } from "react-dom/client";\nexport default function A() { return null; }`).ok).toBe(true);
    expect(react(`import {\n  LineChart,\n  Line,\n} from "recharts";\nimport { Search } from 'lucide-react'\nexport default () => null`).ok).toBe(true);
  });

  it("refuses a library that is not on the list, naming it and listing what is", () => {
    const r = react(`import moment from "moment";\nimport _ from "lodash/fp";\nexport default function A() { return null; }`);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/import "moment" is not available; import "lodash\/fp" is not available\. An artifact may import only react, react-dom, recharts, lucide-react, d3, three, mermaid/);
  });

  it("refuses a relative import and a web address: an artifact is one file with no network", () => {
    const r = react(`import x from "./other";\nimport y from "https://esm.sh/z";\nexport default function A() { return null; }`);
    expect(r.errors[0]).toMatch(/is a file.*one file by itself/);
    expect(r.errors[0]).toMatch(/web address.*no network/);
  });

  it("sees dynamic imports and requires, and does not mistake a type import, a comment or a word for one", () => {
    expect(react(`export default function A() { const m = import("axios"); return null; }`).errors[0]).toMatch(/axios/);
    expect(react(`const x = require("fs");\nexport default function A() { return null; }`).errors[0]).toMatch(/"fs"/);
    expect(react(`import type { Foo } from "some-types";\nexport default function A() { return null; }`).ok).toBe(true);
    expect(react(`// import x from "nope"\nexport default function A() { return <p>Data from "us"</p>; }`).ok).toBe(true);
    expect(importsOf(`import a, * as b from "one";\nexport { c } from "two";\nexport * from "three";\nimport "four";`).sort()).toEqual(["four", "one", "three", "two"]);
    expect(packageOf("react-dom/client")).toBe("react-dom");
    expect(packageOf("@scope/pkg/deep")).toBe("@scope/pkg");
  });

  it("needs a default export, in any of its forms", () => {
    const r = react(`import { useState } from "react";\nexport function App() { return null; }`);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/needs a default export/);
    for (const src of ["export default function A() {}", "const A = () => null;\nexport default A;", "const A = () => null;\nexport { A as default };", "export default class A {}"]) {
      expect(hasDefaultExport(src), src).toBe(true);
    }
    expect(hasDefaultExport("export const x = 1;")).toBe(false);
  });
});

describe("the network", () => {
  it("is a warning for fetch, XMLHttpRequest, WebSocket, EventSource and sendBeacon: the artifact is kept", () => {
    const r = react(`export default function A() { fetch("/api"); new WebSocket("wss://x"); new EventSource("/e"); navigator.sendBeacon("/b"); const x = new XMLHttpRequest(); return null; }`);
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/fetch\(\), XMLHttpRequest, WebSocket, EventSource, navigator\.sendBeacon\(\).*blocks all network access/);
    expect(html("<script>fetch('x')</script>").warnings[0]).toMatch(/fetch\(\)/);
    expect(react(`export default function A() { return <p>fetching soon</p>; }`).warnings).toEqual([]);
  });

  it("warns that storage of the page's own does not work in the sandbox", () => {
    expect(html("<script>localStorage.setItem('a','b')</script>").warnings.join(" ")).toMatch(/localStorage.*do not work/);
  });
});

describe("html is self-contained", () => {
  it("refuses a script, stylesheet, image, frame or font from another address", () => {
    for (const src of [
      `<script src="https://cdn.example.com/lib.js"></script>`, `<link rel="stylesheet" href="//cdn.example.com/a.css">`, `<img src="https://x.test/a.png">`,
      `<iframe src="https://x.test"></iframe>`, `<style>@import url("https://fonts.googleapis.com/css?family=Inter");</style>`,
      `<style>p { background: url(https://x.test/bg.png); }</style>`, `<img srcset="https://x.test/a.png 1x, b.png 2x">`,
    ]) {
      const r = html(src);
      expect(r.ok, src).toBe(false);
      expect(r.errors[0], src).toMatch(/has no network.*inline.*data: URIs/);
    }
  });

  it("allows inline everything, data: images, fragments, and a module script that imports an allowed library", () => {
    expect(html(`<style>p{color:red}</style><img src="data:image/png;base64,AAAA"><a href="#top">top</a><script>let a=1</script>`).ok).toBe(true);
    expect(html(`<script type="module">import { select } from "d3"; select("body");</script>`).ok).toBe(true);
    const bad = html(`<script type="module">import _ from "lodash";</script>`);
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatch(/"lodash" is not available/);
  });

  it("only warns about a link a person would click", () => {
    const r = html(`<a href="https://example.com/docs">docs</a>`);
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/example\.com.*cannot be followed/);
  });

  it("holds an svg to the same, and wants an <svg>", () => {
    expect(validateArtifact({ type: "svg", content: `<svg viewBox="0 0 10 10"><image href="https://x.test/a.png"/></svg>` }).ok).toBe(false);
    expect(validateArtifact({ type: "svg", content: `<svg viewBox="0 0 10 10"><circle r="4"/></svg>` }).ok).toBe(true);
    expect(validateArtifact({ type: "svg", content: `<div/>` }).errors[0]).toMatch(/one <svg>/);
  });
});

describe("the other types", () => {
  it("keep a mermaid artifact to diagram text, and let markdown be anything", () => {
    expect(validateArtifact({ type: "mermaid", content: "flowchart TD\n  A --> B" }).ok).toBe(true);
    expect(validateArtifact({ type: "mermaid", content: "<svg></svg>" }).errors[0]).toMatch(/mermaid diagram text/);
    expect(validateArtifact({ type: "markdown", content: "# Hi\n\n[link](https://example.com) fetch(" }).warnings).toEqual([]);
  });
});

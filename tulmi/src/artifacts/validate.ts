/**
 * VALIDATION: WHAT AN ARTIFACT MAY BE BEFORE IT IS KEPT.
 *
 * Every text that becomes an artifact version (a bot's create, edit or rewrite, a model's element
 * edit or fix, a revert) is checked here, and a text that fails is refused with words the bot can
 * act on. The viewer runs an artifact in a sandbox with no network, so most of this is about
 * catching, here and in words, what the viewer would only show as a blank frame:
 *
 *   SIZE      at most LIMITS.contentBytes (512 KB), and no NUL character: it is text
 *   SECRETS   the same scan a commit gets (code/policy.ts scanForSecrets). An artifact is read by
 *             whoever opens it (a share link makes that anyone), and has no environment to read a
 *             key from, so a secret in one is always wrong. Refused; the answer names the KIND of
 *             secret, never the value, and says what to do instead
 *   IMPORTS   (react) every bare import must be one of ARTIFACT_LIBS, subpaths included
 *             ("react-dom/client" is react-dom), and there must be a default export, the component
 *             the viewer mounts. A relative or URL import is refused: an artifact is one file with
 *             no network. (html) a module script's bare imports are held to the same list
 *   NETWORK   fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon: a WARNING, not a refusal.
 *             The viewer blocks them whatever is written, so the artifact will show an error when it
 *             runs, and the bot is told now. Some artifacts only reach for the network on a path that
 *             is never taken, and those still work
 *   SELF-CONTAINED  (html, svg) a script, stylesheet, image, frame or font from another address is
 *             refused: only ARTIFACT_LIBS (by bare import) and data: URIs are available. A link a
 *             person would click (an <a>) is only a warning
 *
 * Nothing here reaches a network or a store.
 */
import { scanForSecrets } from "../code/policy.js";
import { ARTIFACT_LIBS, LIMITS, type ArtifactType } from "./protocol.js";
import { ArtifactError } from "./types.js";

export interface Checked {
  ok: boolean;
  /** Why it was refused, one reason a line, in words for the bot. */
  errors: string[];
  /** What will not work, or will not work as written, but is kept. */
  warnings: string[];
}

const EXT: Record<ArtifactType, string> = { html: "html", react: "jsx", svg: "svg", mermaid: "mmd", markdown: "md" };
const LIBS: readonly string[] = ARTIFACT_LIBS;
const MAX_REASONS = 8;

/** The package a bare import names: "react-dom/client" is "react-dom", "@scope/x/y" is "@scope/x". */
export function packageOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

const isBare = (spec: string): boolean => !/^(?:\.{0,2}\/|[a-z][a-z0-9+.-]*:|\/\/)/i.test(spec);

/** Every module specifier the source imports: static, side-effect, re-export and dynamic. `import type` is erased by the compile and is not one. */
export function importsOf(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/^[ \t]*(?:import|export)\s+(?!type\b)[\w$\s{},*]+?\bfrom\s*["']([^"'\n]+)["']/gm)) found.add(m[1]!);
  for (const m of source.matchAll(/^[ \t]*import\s*["']([^"'\n]+)["']/gm)) found.add(m[1]!);
  for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) found.add(m[1]!);
  for (const m of source.matchAll(/\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) found.add(m[1]!);
  return [...found];
}

/** Whether a react artifact exports its component by default. */
export const hasDefaultExport = (source: string): boolean =>
  /\bexport\s+default\b/.test(source) || /\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(source);

const NETWORK: Array<[RegExp, string]> = [
  [/\bfetch\s*\(/, "fetch()"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bnew\s+WebSocket\s*\(/, "WebSocket"],
  [/\bnew\s+EventSource\s*\(/, "EventSource"],
  [/\bnavigator\s*\.\s*sendBeacon\s*\(/, "navigator.sendBeacon()"],
  [/\bimportScripts\s*\(/, "importScripts()"],
];

const STORAGE = /\b(?:localStorage|sessionStorage|indexedDB)\b|\bdocument\s*\.\s*cookie\b/;

const hostOf = (url: string): string => {
  try { return new URL(url.startsWith("//") ? `https:${url}` : url).host; } catch { return url.slice(0, 40); }
};
const external = (v: string): boolean => /^\s*(?:https?:)?\/\//i.test(v);

/** Resources a markup artifact would load from another address, and links it would only point at. */
function markupRefs(source: string): { loads: string[]; links: string[] } {
  const loads = new Set<string>();
  const links = new Set<string>();
  for (const m of source.matchAll(/<([a-zA-Z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2]!;
    const get = (name: string): string | null => {
      const a = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
      return a ? (a[1] ?? a[2] ?? a[3] ?? "") : null;
    };
    if (tag === "a" || tag === "area") { const h = get("href"); if (h && external(h)) links.add(hostOf(h)); continue; }
    if (tag === "form") { const h = get("action"); if (h && external(h)) links.add(hostOf(h)); continue; }
    const names = tag === "link" || tag === "base" ? ["href"] : tag === "object" ? ["data"] : tag === "image" || tag === "use" ? ["href", "xlink:href"] : ["src", "poster", "srcset"];
    for (const n of names) {
      const v = get(n);
      if (v === null) continue;
      for (const part of n === "srcset" ? v.split(",").map((s) => s.trim().split(/\s+/)[0] ?? "") : [v]) if (external(part)) loads.add(hostOf(part));
    }
  }
  for (const m of source.matchAll(/url\(\s*["']?\s*((?:https?:)?\/\/[^)"'\s]+)/gi)) loads.add(hostOf(m[1]!));
  for (const m of source.matchAll(/@import\s+(?:url\(\s*)?["']?\s*((?:https?:)?\/\/[^)"'\s;]+)/gi)) loads.add(hostOf(m[1]!));
  return { loads: [...loads], links: [...links] };
}

/** The module scripts of an html artifact, where bare imports are allowed (the viewer maps ARTIFACT_LIBS for them). */
function moduleScripts(html: string): string {
  return [...html.matchAll(/<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
}

export function validateArtifact(input: { type: ArtifactType; content: string }): Checked {
  const { type, content } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const done = (): Checked => ({ ok: errors.length === 0, errors: errors.slice(0, MAX_REASONS), warnings: warnings.slice(0, MAX_REASONS) });

  if (typeof content !== "string" || !content.trim()) {
    errors.push("The artifact is empty. Write its content.");
    return done();
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > LIMITS.contentBytes) {
    errors.push(`The artifact is ${Math.ceil(bytes / 1024)} KB, which is over the ${LIMITS.contentBytes / 1024} KB an artifact may be. Make it smaller (less inline data, shorter text).`);
    return done();
  }
  if (content.includes("\u0000")) errors.push("The artifact holds a NUL character, so it is not text.");

  // Secrets first, and by kind: the value is never repeated.
  const hits = scanForSecrets([{ path: `artifact.${EXT[type]}`, content }]);
  if (hits.length) {
    errors.push(`This looks like it holds ${[...new Set(hits.flatMap((h) => h.kinds))].join(" and ")}. Anyone who opens an artifact can read it, and an artifact has no environment to read a key from, so a secret never belongs in one. Take it out; if the artifact needs the thing the key opens, it cannot have it.`);
  }

  if (type === "react") {
    const bad: string[] = [];
    for (const spec of importsOf(content)) {
      if (!isBare(spec)) {
        bad.push(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(spec)
          ? `import "${spec.slice(0, 60)}" is from a web address, and an artifact has no network`
          : `import "${spec.slice(0, 60)}" is a file, and an artifact is one file by itself`);
      } else if (!LIBS.includes(packageOf(spec))) {
        bad.push(`import "${spec.slice(0, 60)}" is not available`);
      }
    }
    if (bad.length) errors.push(`${[...new Set(bad)].join("; ")}. An artifact may import only ${ARTIFACT_LIBS.join(", ")}. Write the rest yourself in the same file.`);
    if (!hasDefaultExport(content)) errors.push("A react artifact needs a default export: the component to show, like `export default function App() { ... }`.");
  } else if (type === "html" || type === "svg") {
    if (type === "svg" && !/<svg\b/i.test(content)) errors.push("An svg artifact is one <svg>…</svg> element.");
    const { loads, links } = markupRefs(content);
    if (loads.length) {
      errors.push(`It loads from ${loads.slice(0, 4).join(", ")}${loads.length > 4 ? " and more" : ""}, and an artifact has no network. Put styles and scripts inline, use data: URIs for images, and for libraries import only ${ARTIFACT_LIBS.join(", ")} in a <script type="module">.`);
    }
    if (links.length) warnings.push(`A link or form points at ${links.slice(0, 3).join(", ")}: it cannot be followed from inside the viewer.`);
    if (type === "html") {
      const bad = importsOf(moduleScripts(content)).filter((s) => !isBare(s) || !LIBS.includes(packageOf(s)));
      if (bad.length) errors.push(`import "${bad[0]!.slice(0, 60)}" is not available. A module script may import only ${ARTIFACT_LIBS.join(", ")}.`);
    }
  } else if (type === "mermaid" && /^\s*<(?:!doctype|html|svg)/i.test(content)) {
    errors.push("A mermaid artifact is mermaid diagram text (like `flowchart TD` ...), not HTML or SVG.");
  }

  if (type === "react" || type === "html" || type === "svg") {
    const net = NETWORK.filter(([re]) => re.test(content)).map(([, name]) => name);
    if (net.length) warnings.push(`It uses ${net.join(", ")}. The viewer blocks all network access, so those calls will fail when the artifact runs. Keep the data inside the artifact.`);
    if (STORAGE.test(content)) warnings.push("localStorage, sessionStorage, IndexedDB and cookies do not work in the viewer's sandbox. Keep state in memory, or use the artifact's saved data.");
  }
  return done();
}

/** `validateArtifact`, throwing: a secret is `secret`, a size is `too_large`, anything else `invalid`; the message is every reason, for the bot. Returns the warnings. */
export function assertValid(input: { type: ArtifactType; content: string }): string[] {
  const r = validateArtifact(input);
  if (r.ok) return r.warnings;
  const secret = r.errors.some((e) => e.startsWith("This looks like it holds"));
  const big = r.errors.some((e) => /KB, which is over/.test(e));
  throw new ArtifactError(secret ? "secret" : big ? "too_large" : "invalid", `The artifact was not kept. ${r.errors.join(" ")}`, { errors: r.errors, warnings: r.warnings });
}

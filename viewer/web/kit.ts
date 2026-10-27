/**
 * The design kit and the theme. A kit is CSS the viewer adds BEFORE the artifact, so the artifact can use the project's
 * `--tz-…` variables and base styles; fonts come from Google Fonts only (the CSP allows no other host).
 */
import type { DesignKitCss } from "../../tulmi/src/artifacts/protocol.js";

const FONT_CSS_HOST = "fonts.googleapis.com";

/** A stylesheet URL on the Google Fonts CSS host, or null. */
export function safeFontUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === FONT_CSS_HOST && /^\/css2?$/.test(u.pathname) ? u.href : null;
  } catch {
    return null;
  }
}

/** The kit's CSS with every `@import` of a stylesheet from anywhere but Google Fonts removed (the CSP would refuse it anyway). */
export function sanitizeKitCss(css: string): string {
  return css.replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?[^;]*;?/gi, (whole, _q: string, url: string) => (safeFontUrl(url) ? whole : ""));
}

export function applyTheme(doc: Document, theme: "light" | "dark"): void {
  const root = doc.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
}

export const KIT_ATTR = "data-tz-kit";

/** The elements for a kit: its style and its font links. Not yet in any document. */
export function kitNodes(doc: Document, kit: DesignKitCss | undefined): HTMLElement[] {
  if (!kit) return [];
  const nodes: HTMLElement[] = [];
  for (const f of kit.fonts ?? []) {
    const href = safeFontUrl(f);
    if (!href) continue;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(KIT_ATTR, "");
    nodes.push(link);
  }
  if (typeof kit.css === "string" && kit.css.trim()) {
    const style = doc.createElement("style");
    style.setAttribute(KIT_ATTR, "");
    style.textContent = sanitizeKitCss(kit.css);
    nodes.push(style);
  }
  return nodes;
}

/** Put the kit in the document, replacing the previous one. In the shell the kit goes at the end of the head; an html artifact's own
 *  document gets it before its head, so the artifact's own styles still win. */
export function installKit(doc: Document, kit: DesignKitCss | undefined, where: "head" | "before-head" = "head"): void {
  for (const old of Array.from(doc.querySelectorAll(`[${KIT_ATTR}]`))) {
    if (!old.matches('style[type="text/tailwindcss"]')) old.remove();
  }
  const nodes = kitNodes(doc, kit);
  if (where === "head") {
    for (const n of nodes) doc.head.appendChild(n);
  } else {
    const before = doc.head ?? doc.documentElement.firstChild;
    for (const n of nodes) doc.documentElement.insertBefore(n, before);
  }
}

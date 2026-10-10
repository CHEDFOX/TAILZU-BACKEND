/**
 * THE SITE'S OWN ROOM, for every page tailzu.space links to.
 *
 * The landing page is one hand-built file on Vercel; the pages it links to
 * (/pricing, /pay, /privacy, /terms, /download) are rendered here and served
 * through it. They used to be plain white documents, a visible change of
 * room between a link and the page it opens. This is the landing page's own
 * material, lifted: the warm near-black ground and its pale, Newsreader over
 * Instrument Sans with IBM Plex Mono for the small labels, the mark at the
 * top, the same footer, and the price's own sun-yellow field.
 *
 * Every word opens with a capital, as on the site; long legal prose is the
 * one exception, because a contract set in title case cannot be read.
 * The amber stays out: on the site it means "the microphone is open".
 */
import { headTags } from "../../seo/head.js";

const MARK = `<svg viewBox="170 228 680 512" aria-hidden="true"> <line x1="346" y1="402" x2="270" y2="598" stroke="#E9CBA2" stroke-width="9" stroke-linecap="round"/> <line x1="444" y1="394" x2="554" y2="486" stroke="#E8A23C" stroke-width="30" stroke-dasharray="9 11"/> <line x1="668" y1="478" x2="828" y2="243" stroke="#C77A3A" stroke-width="9" stroke-linecap="round"/> <circle cx="828" cy="243" r="11" fill="#B06240"/> <rect x="308" y="269" width="132" height="132" rx="28" fill="#F4F1EA"/> <rect x="558" y="478" width="132" height="132" rx="28" fill="#F4F1EA"/> <rect x="178" y="598" width="132" height="132" rx="28" fill="#F4F1EA"/> </svg>`;

// ONE LINK IN for everything written for search and answer engines: the FAQ,
// and through it the languages. The footer stays what it was plus one word;
// the rest is reached from there and from the sitemap.
const NAV: Array<[string, string]> = [
  ["/pricing", "Pricing"], ["/faq", "FAQ"],
  ["/privacy", "Privacy"], ["/terms", "Terms"], ["/download", "Download"],
];

const CSS = `
  :root {
    --ink: #0F0D0B; --card: #211C17; --raise: rgba(243,226,198,.055); --rule: rgba(243,226,198,.15);
    --white: #F3E2C6; --grey: rgba(243,226,198,.66); --dim: rgba(243,226,198,.52);
    --sun: #F7CF4A; --ink2: #1B1712; --ink2-soft: rgba(27,23,18,.7); --line: rgba(27,23,18,.16);
    --serif: 'Newsreader', Georgia, 'Times New Roman', serif;
    --sans: 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html { background: var(--ink); }
  body { margin: 0; background: var(--ink); color: var(--white); font: 17px/1.7 var(--sans); -webkit-font-smoothing: antialiased; text-transform: capitalize; }
  button, input { font-family: inherit; text-transform: inherit; }
  a { color: inherit; }
  a[href^="mailto:"], code { text-transform: none; }
  :focus-visible { outline: 2px solid var(--white); outline-offset: 3px; }
  .wrap { width: 100%; max-width: 1040px; margin: 0 auto; padding: 0 24px; }
  .mast { padding: 22px 0 0; }
  .mast .wrap { display: flex; justify-content: center; }
  .mark { display: inline-flex; padding: 6px 10px; border-radius: 12px; }
  .mark svg { height: 28px; width: auto; display: block; }
  main { padding: 64px 0 80px; }
  .eye { font-family: var(--mono); font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin: 0 0 16px; }
  h1 { font-family: var(--serif); font-weight: 350; font-size: clamp(40px, 6.4vw, 68px); line-height: 1.03; letter-spacing: -.028em; margin: 0 0 18px; text-wrap: balance; }
  .lede { color: var(--grey); font-size: 19px; max-width: 44ch; margin: 0; }
  .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 50px; padding: 0 28px; border-radius: 999px; border: 0; font-size: 15px; font-weight: 500; text-decoration: none; cursor: pointer; background: var(--white); color: var(--ink); transition: opacity .2s, transform .12s; }
  .btn:hover { opacity: .9; }
  .btn:active { transform: scale(.98); }
  .btn.disabled, .btn:disabled { opacity: .35; pointer-events: none; }
  footer { color: var(--dim); border-top: 1px solid var(--rule); }
  footer .in { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 28px 0 44px; font-size: 14px; }
  footer nav { display: flex; gap: 24px; flex-wrap: wrap; }
  footer nav a { text-decoration: none; transition: color .2s; }
  footer nav a:hover, footer nav a[aria-current] { color: var(--white); }

  /* The price's room: the landing page's sun field. */
  .field { background: var(--sun); color: var(--ink2); border-radius: 28px; padding: 28px; margin: 48px 0 0; }
  .field .eye { color: var(--ink2-soft); }

  /* Long reading. */
  .prose { max-width: 720px; }
  .prose h1 { margin-bottom: 10px; }
  .prose .effective { font-family: var(--mono); font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin: 0 0 40px; }
  .prose h2 { font-family: var(--serif); font-weight: 400; font-size: 28px; line-height: 1.2; letter-spacing: -.01em; margin: 52px 0 12px; }
  .prose h3 { font-size: 17px; font-weight: 500; margin: 30px 0 6px; }
  .prose p, .prose li { color: var(--grey); text-transform: none; }
  .prose strong { color: var(--white); font-weight: 500; }
  .prose ul { padding-left: 22px; }
  .prose li { margin-bottom: 6px; }
  .prose a { text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
  .prose a:hover { text-decoration-color: var(--white); }
  .prose hr { border: 0; border-top: 1px solid var(--rule); margin: 44px 0; }
  .prose code { font-family: var(--mono); font-size: 14px; background: var(--raise); padding: 2px 6px; border-radius: 6px; }

  @media (max-width: 640px) {
    main { padding: 40px 0 56px; }
    .field { padding: 18px; border-radius: 22px; }
    .lede { font-size: 17px; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

export function siteShell(o: {
  /** The tab title, before " — Tailzu". */
  title: string;
  /** The whole <title> instead, when the page's search title says more. */
  headTitle?: string;
  description?: string;
  /** Structured data for this page (seo/facts.ts builds it). */
  ld?: object[];
  /** More Google Fonts families, as the css2 query wants them. */
  fonts?: string;
  /** Which footer link this page is. */
  path?: string;
  /** Everything between the header and the footer. */
  main: string;
  /** This page's own rules, after the shared ones. */
  css?: string;
  /** An inline script, placed before </body>. */
  script?: string;
  /** The CSP nonce the inline script carries, when the page is served with
   *  a policy that names one (the pay page). */
  nonce?: string;
  noindex?: boolean;
}): string {
  const here = (href: string) => o.path === href || (o.path ?? "").startsWith(`${href}/`);
  const nav = NAV.map(([href, label]) =>
    `<a href="${href}"${here(href) ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags({
  path: o.path ?? "/",
  title: o.headTitle ?? `${o.title} — Tailzu`,
  description: o.description ?? "",
  noindex: o.noindex || !o.path,
  ld: o.ld,
})}
<meta name="theme-color" content="#0F0D0B">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300..500&family=Instrument+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400${o.fonts ? `&${o.fonts}` : ""}&display=swap">
<style>${CSS}${o.css ?? ""}</style>
</head>
<body>
<header class="mast"><div class="wrap"><a class="mark" href="/" aria-label="Tailzu">${MARK}</a></div></header>
<main><div class="wrap">
${o.main}
</div></main>
<footer><div class="wrap"><div class="in"><span>© 2026 Tailzu</span><nav>${nav}</nav></div></div></footer>
${o.script ? `<script${o.nonce ? ` nonce="${o.nonce}"` : ""}>${o.script}</script>\n` : ""}</body>
</html>`;
}

/**
 * THE SITE'S OWN ROOM, for every page x0bot.com links to.
 *
 * The landing page is one hand-built file on Vercel; the pages it links to (/pricing, /pay, /privacy, /terms, /support, /download,
 * /delete-account, the FAQ and the guides) are rendered here and served through it. They wear the APP's look, so a link from the app
 * to its own policy never changes room: the Bots app's white (bots-design STYLE.md, experience/bots/palette.ts): paper and ink,
 * its greys and hairlines, Geist and Geist Mono, the X0 dot mark (eight dots in a ring, two eyes) with its name, and the bots'
 * natural colours as the only colour, in small doses.
 *
 * The token names are the old dark room's, kept so every page's own rules still work, with the app's values: --ink is the PAGE
 * (paper), --white is the TEXT (ink), --sun is the price's field (the app's surface grey), --ink2 the ink on it. Sentence case, as
 * in the app.
 */
import { headTags } from "../../../seo/head.js";
import { gtmBody, gtmHead } from "../../../ads/gtm.js";

/** The X0 dot mark (experience/bots/glyphs.ts tailzuMark): eight dots in a ring, two eyes. */
const DOTS: Array<[number, number, number]> = [
  [17, 4, 2], [26, 7, 2], [30, 16, 2], [27, 25, 2], [17, 30, 2], [7, 25, 2], [4, 16, 2], [8, 7, 2], [13, 15, 2.6], [21, 15, 2.6],
];
const MARK = `<svg viewBox="0 0 34 34" aria-hidden="true">${DOTS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("")}</svg>`;

/** The bots' natural colours, one dot each, under the footer's name (the app's living tab icon, still). */
const BOT_DOTS = ["#2F5D50", "#A9573A", "#8F6A1F", "#3E6E8E", "#6E4A6B"].map((c) => `<i style="background:${c}"></i>`).join("");

// ONE LINK IN for everything written for search and answer engines: the FAQ,
// and through it the languages. The footer stays what it was plus one word;
// the rest is reached from there and from the sitemap.
const NAV: Array<[string, string]> = [
  ["/pricing", "Pricing"], ["/faq", "FAQ"],
  ["/privacy", "Privacy"], ["/terms", "Terms"], ["/support", "Support"], ["/download", "Download"],
];

const CSS = `
  :root {
    /* The app's white (experience/bots/palette.ts), under the names every page's rules already use. */
    --ink: #FFFFFF; --white: #0A0A0A; --grey: #3D3D3D; --dim: #5C5C5C; --rule: #E6E6E6; --raise: #F5F5F5; --card: #F5F5F5;
    --sun: #F5F5F5; --ink2: #0A0A0A; --ink2-soft: #5C5C5C; --line: #E0E0E0;
    --outline: #D4D4D4; --moss: #4F7A3A; --clay: #A9573A; --sea: #3E6E8E;
    --serif: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --sans: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html { background: var(--ink); }
  body { margin: 0; background: var(--ink); color: var(--white); font: 16px/1.65 var(--sans); -webkit-font-smoothing: antialiased; }
  button, input { font-family: inherit; }
  a { color: inherit; }
  :focus-visible { outline: 2px solid var(--white); outline-offset: 3px; border-radius: 6px; }
  .wrap { width: 100%; max-width: 1040px; margin: 0 auto; padding: 0 24px; }

  .mast { position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,.86); backdrop-filter: saturate(1.6) blur(16px); -webkit-backdrop-filter: saturate(1.6) blur(16px); border-bottom: 1px solid transparent; }
  .mast .wrap { display: flex; align-items: center; gap: 16px; height: 64px; }
  .mark { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 700; font-size: 17px; letter-spacing: -.02em; }
  .mark svg { height: 28px; width: 28px; display: block; fill: var(--white); }
  .mast nav { margin-left: auto; display: flex; align-items: center; gap: 22px; font-size: 14px; }
  .mast nav a { text-decoration: none; color: var(--grey); }
  .mast nav a:hover, .mast nav a[aria-current] { color: var(--white); }
  .mast nav .get { color: var(--ink); background: var(--white); padding: 8px 16px; border-radius: 999px; font-weight: 500; }
  .mast nav .get:hover { color: var(--ink); opacity: .88; }

  main { padding: 56px 0 88px; }
  .eye { font: 600 11px/1 var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin: 0 0 14px; }
  h1 { font-family: var(--serif); font-weight: 700; font-size: clamp(36px, 5.6vw, 56px); line-height: 1.05; letter-spacing: -.035em; margin: 0 0 16px; text-wrap: balance; }
  .lede { color: var(--grey); font-size: 18px; max-width: 48ch; margin: 0; }
  .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 24px; border-radius: 999px; border: 0; font-size: 15px; font-weight: 500; text-decoration: none; cursor: pointer; background: var(--white); color: var(--ink); transition: opacity .2s, transform .12s; }
  .btn:hover { opacity: .88; }
  .btn:active { transform: scale(.98); }
  .btn.disabled, .btn:disabled { opacity: .35; pointer-events: none; }

  footer { color: var(--dim); border-top: 1px solid var(--rule); background: var(--ink); }
  footer .in { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; padding: 28px 0 44px; font-size: 14px; }
  footer .who { display: inline-flex; align-items: center; gap: 10px; }
  footer .dots { display: inline-flex; gap: 4px; }
  footer .dots i { width: 7px; height: 7px; border-radius: 50%; display: block; }
  footer nav { display: flex; gap: 22px; flex-wrap: wrap; }
  footer nav a { text-decoration: none; transition: color .2s; }
  footer nav a:hover, footer nav a[aria-current] { color: var(--white); }

  /* The price's room: the app's surface, a card on the page. */
  .field { background: var(--sun); color: var(--ink2); border-radius: 24px; padding: 28px; margin: 44px 0 0; }
  .field .eye { color: var(--ink2-soft); }

  /* Long reading: the app's type, a column a person can read, the section headings as the app sets a page's. */
  .prose { max-width: 700px; }
  .prose h1 { margin-bottom: 10px; }
  .prose .effective { display: inline-flex; align-items: center; gap: 8px; font: 500 12px/1 var(--mono); color: var(--dim); background: var(--raise); border-radius: 999px; padding: 8px 12px; margin: 6px 0 36px; }
  .prose .effective::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--moss); }
  .prose h2 { font-weight: 600; font-size: 24px; line-height: 1.25; letter-spacing: -.02em; margin: 52px 0 12px; padding-top: 28px; border-top: 1px solid var(--rule); }
  .prose h3 { font-size: 17px; font-weight: 600; letter-spacing: -.01em; margin: 30px 0 6px; }
  .prose p, .prose li { color: var(--grey); }
  .prose strong { color: var(--white); font-weight: 600; }
  .prose ul, .prose ol { padding-left: 22px; }
  .prose li { margin-bottom: 6px; }
  .prose li::marker { color: var(--dim); }
  .prose a { text-decoration: underline; text-decoration-color: var(--outline); text-underline-offset: 3px; }
  .prose a:hover { text-decoration-color: var(--white); }
  .prose hr { border: 0; border-top: 1px solid var(--rule); margin: 44px 0; }
  .prose hr + h2, .prose h1 + h2, .prose .effective + h2 { border-top: 0; padding-top: 0; margin-top: 0; }
  .prose code { font-family: var(--mono); font-size: 13.5px; background: var(--raise); padding: 2px 6px; border-radius: 6px; }
  .prose table { width: 100%; border-collapse: collapse; font-size: 15px; margin: 18px 0; display: block; overflow-x: auto; }
  .prose th, .prose td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; color: var(--grey); }
  .prose th { color: var(--white); font-weight: 600; background: var(--raise); }

  @media (max-width: 640px) {
    main { padding: 36px 0 56px; }
    .mast nav a:not(.get) { display: none; }
    .field { padding: 18px; border-radius: 20px; }
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
  /** Load the site's Meta pixel (/site-events.js, src/ads/meta.ts) and
   *  Google Tag Manager (src/ads/gtm.ts). Every page does but the pay page:
   *  no third party's script runs beside a checkout, and the server reports
   *  what is bought there. */
  pixel?: boolean;
}): string {
  const here = (href: string) => o.path === href || (o.path ?? "").startsWith(`${href}/`);
  const nav = NAV.map(([href, label]) =>
    `<a href="${href}"${here(href) ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
${o.pixel === false ? "" : gtmHead()}<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags({
  path: o.path ?? "/",
  title: o.headTitle ?? `${o.title} — X0 Bot`,
  description: o.description ?? "",
  noindex: o.noindex || !o.path,
  ld: o.ld,
})}
<meta name="theme-color" content="#FFFFFF">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500${o.fonts ? `&${o.fonts}` : ""}&display=swap">
<style>${CSS}${o.css ?? ""}</style>
${o.pixel === false ? "" : `<script src="/site-events.js" async></script>\n`}</head>
<body>
${o.pixel === false ? "" : gtmBody()}<header class="mast"><div class="wrap"><a class="mark" href="/" aria-label="X0 Bot home">${MARK}<span>X0 Bot</span></a><nav aria-label="Site"><a href="/pricing"${here("/pricing") ? ' aria-current="page"' : ""}>Pricing</a><a href="/faq"${here("/faq") ? ' aria-current="page"' : ""}>FAQ</a><a href="/support"${here("/support") ? ' aria-current="page"' : ""}>Support</a><a class="get" href="/download">Get X0 Bot</a></nav></div></header>
<main><div class="wrap">
${o.main}
</div></main>
<footer><div class="wrap"><div class="in"><span class="who"><span class="dots" aria-hidden="true">${BOT_DOTS}</span>© 2026 X0 Bot</span><nav aria-label="Footer">${nav}</nav></div></div></footer>
${o.script ? `<script${o.nonce ? ` nonce="${o.nonce}"` : ""}>${o.script}</script>\n` : ""}</body>
</html>`;
}

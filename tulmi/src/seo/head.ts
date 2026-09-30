/**
 * WHAT A CRAWLER READS BEFORE THE PAGE: the <head> every tailzu.space page
 * carries, built in one place.
 *
 * Search engines and answer engines judge a page on a few lines a visitor
 * never sees: the canonical address, the title and summary, the card a link
 * unfurls into, and the structured description of what the thing is. Written
 * by hand on each page they drift, and a drifted canonical quietly splits a
 * page's ranking in two. So every page asks for them here.
 *
 * Pure: no catalog, no config. The facts it is given are someone else's.
 */

/** The one address every page is canonical to. api.tailzu.space serves the
 *  same pages for the site's proxy, and must never be the one that ranks. */
export const ORIGIN = "https://tailzu.space";

/** The card a shared link unfurls into, and the picture answer engines show
 *  beside a citation. Rendered once (tools/media/og.html) and served by the
 *  site as a static file. */
export const OG_IMAGE = {
  url: `${ORIGIN}/og.png`,
  width: 1200,
  height: 630,
  alt: "Tailzu. Talk. It writes. A sentence said roughly, written clean.",
};

/** The App Store id, for Safari's install banner. */
export const APP_STORE_ID = "6784811357";

/** Text or a double-quoted attribute value, safe in HTML and in XML. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A path on the site as its absolute, canonical URL. */
export const abs = (path: string) => (/^https?:/.test(path) ? path : `${ORIGIN}${path === "/" ? "/" : path.replace(/\/+$/, "")}`);

/**
 * JSON-LD as one @graph. Every "<" is written as \u003c — the same string to
 * a JSON parser — so nothing in the data can close the script element
 * ("</script") or open a comment that changes how it is parsed ("<!--").
 */
export function ldScript(graph: object[]): string {
  if (!graph.length) return "";
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph })
    .replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

export interface HeadOpts {
  /** The page's path on tailzu.space, "/" for the home page. */
  path: string;
  /** The whole <title>, brand included. */
  title: string;
  description: string;
  /** The link card's own words, when they should differ from the SERP's. */
  ogTitle?: string;
  ogDescription?: string;
  noindex?: boolean;
  ld?: object[];
}

/**
 * Everything after the charset and viewport: title, summary, canonical,
 * robots, the link card, the icons and the structured data.
 */
export function headTags(o: HeadOpts): string {
  const url = esc(abs(o.path));
  const ogTitle = o.ogTitle ?? o.title;
  const ogDescription = o.ogDescription ?? o.description;
  return [
    `<title>${esc(o.title)}</title>`,
    `<meta name="description" content="${esc(o.description)}">`,
    o.noindex
      ? `<meta name="robots" content="noindex, follow">`
      // Let the result show a big image and as much text as it likes: an
      // answer engine that may only quote a line quotes someone else.
      : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">\n<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Tailzu">`,
    `<meta property="og:locale" content="en_IN">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(ogTitle)}">`,
    `<meta property="og:description" content="${esc(ogDescription)}">`,
    `<meta property="og:image" content="${OG_IMAGE.url}">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(ogTitle)}">`,
    `<meta name="twitter:description" content="${esc(ogDescription)}">`,
    `<meta name="twitter:image" content="${OG_IMAGE.url}">`,
    `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}">`,
    // Real files, not a data: URI. A search result's favicon is fetched by a
    // crawler, and a crawler cannot fetch a data: URI.
    `<link rel="icon" href="${ORIGIN}/favicon.ico" sizes="48x48">`,
    `<link rel="icon" href="${ORIGIN}/favicon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="${ORIGIN}/apple-touch-icon.png">`,
    ldScript(o.ld ?? []),
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- entities

/** One id per thing, so every page's graph points at the same entities. */
export const ID = {
  org: `${ORIGIN}/#org`,
  site: `${ORIGIN}/#website`,
  app: `${ORIGIN}/#app`,
};

export function crumbsLd(trail: Array<[string, string]>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(path) })),
  };
}

export function pageLd(path: string, name: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    "@type": "WebPage",
    "@id": abs(path),
    url: abs(path),
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": ID.site },
    about: { "@id": ID.app },
    ...extra,
  };
}

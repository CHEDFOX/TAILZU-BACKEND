/** Libraries an HTML page may ask for from a CDN. They are not fetched: the vendored build is put on the page under the usual global. */

export type CdnLib = "d3" | "three" | "tailwind";

const CDN_LIBS: { match: RegExp; lib: CdnLib }[] = [
  { match: /(?:^|\/)cdn\.tailwindcss\.com|@tailwindcss\/browser/i, lib: "tailwind" },
  { match: /(?:\/|@)d3(?:@[\w.-]+)?(?:\/dist)?\/d3(?:\.v\d+)?(?:\.min)?\.js|d3js\.org\/d3\.v\d|\/ajax\/libs\/d3\/[\w.]+\/d3(?:\.min)?\.js/i, lib: "d3" },
  { match: /\/three(?:@[\w.-]+)?\/build\/three(?:\.module)?(?:\.min)?\.js|\/ajax\/libs\/three\.js\/[\w.]+\/three(?:\.min)?\.js/i, lib: "three" },
];

export const cdnLib = (src: string): CdnLib | undefined => CDN_LIBS.find((c) => c.match.test(src))?.lib;

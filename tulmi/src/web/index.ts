/**
 * THE WEB, FOR TAILZU: reading pages. See docs/web-reader.md.
 *
 *   readPage(url, opts)   a page as text, headings and links (reader.ts)
 *   asUntrusted(page)     that page, wrapped for a prompt
 *   getRenderer()         the server's own browser for pages that need scripts, or null
 *   webCache()            where read pages are kept
 *
 * Shared code: layer 3 (search tools), the agent loop and later web tasks for
 * a person all use it. It has no HTTP routes.
 */
export { asUntrusted, readPage, resetWebReaderForTests, WebError } from "./reader.js";
export type { ReadOptions, ReadPurpose, WebPage } from "./reader.js";
export { extract, type Extracted, type Heading, type PageLink } from "./extract.js";
export { webCache, MemoryWebCache, SupabaseWebCache, resetWebCacheForTests, type WebCache } from "./cache.js";
export { getRenderer, closeBrowser } from "./browser/index.js";
export type { Renderer } from "./browser/engine.js";
export { webErrorWords, type WebErrorCode } from "./error.js";

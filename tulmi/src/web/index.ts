/**
 * THE WEB, FOR TAILZU: reading pages (docs/web-reader.md) and searching and
 * researching (docs/web-search.md).
 *
 *   readPage(url, opts)       a page as text, headings and links (reader.ts)
 *   asUntrusted(page)         that page, wrapped for a prompt
 *   getRenderer()             the server's own browser for pages that need scripts, or null
 *   webCache()                where read pages are kept
 *   search(question, opts)    ranked results from the cheapest places first (search/engine.ts)
 *   planSearch(question)      what kind of question it is, and what to ask where (search/plan.ts)
 *   research(question, opts)  search, read, and an answer that cites its pages (research.ts)
 *   indexPage(page)           a read page into our own searchable index (search/index.ts)
 *
 * Shared code: the Code bot's web tools (code/webTools.ts), the agent loop and
 * later web tasks for a person all use it. It has no HTTP routes.
 */
export { asUntrusted, readPage, resetWebReaderForTests, WebError } from "./reader.js";
export type { ReadOptions, ReadPurpose, WebPage } from "./reader.js";
export { extract, type Extracted, type Heading, type PageLink } from "./extract.js";
export { webCache, MemoryWebCache, SupabaseWebCache, resetWebCacheForTests, type WebCache } from "./cache.js";
export { getRenderer, closeBrowser } from "./browser/index.js";
export type { Renderer } from "./browser/engine.js";
export { webErrorWords, type WebErrorCode } from "./error.js";
export { search, searchEnvFromConfig, type SearchOptions, type SearchOutcome } from "./search/engine.js";
export { planByRules, planSearch, scrubQuery } from "./search/plan.js";
export { indexPage, searchIndex, searchStore, MemorySearchStore, SupabaseSearchStore, resetSearchStoreForTests, type SearchStore } from "./search/index.js";
export type { AskFn, AskRequest, AskReply, Intent, PlanCtx, Ranked, Result, SearchEnv, SearchPlan, SourceId } from "./search/types.js";
export { research, type ResearchOptions, type ResearchResult } from "./research.js";
